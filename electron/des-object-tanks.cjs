'use strict';
// Pure host-side handover frames. The service persists frames privately and
// signs their public marker as part of the ordinary DES snapshot.
const exchange=require('../assets/core/des-object-exchange.js');
const contracts=require('../assets/core/platform-contracts.js');
const schema=require('../assets/core/platform-schema.js');
const stock=require('../assets/core/fuel-stock.js');
const scopeApi=require('../assets/core/access-scope.js');
const access=require('./access-context.cjs');
const evidence=require('./operation-evidence.cjs');
const calendar=require('../assets/core/business-calendar.js');
const generatorMaintenance=require('../assets/core/generator-maintenance.js');
const generatorFuel=require('../assets/core/generator-fuel.js');
const movementPolicy=require('../assets/core/fuel-movement-policy.js');
const accounting=require('../assets/core/accounting-boundary.js');
const decimal=require('../assets/core/decimal-core.js');
const own=(row,key)=>Object.prototype.hasOwnProperty.call(row,key);
const object=row=>row!==null&&typeof row==='object'&&!Array.isArray(row);
const same=(a,b)=>exchange.digest(a)===exchange.digest(b);
const key=id=>JSON.stringify([typeof id,id]);
const fuelSources=new Set(['tankIncomes','genRecords','fuelMovements']);
const tankFields=['org','site','object','location','owner','fuel','fuelGrade','orgHistory','fuelAccounting','balanceInit','desObjectTankTransfer'];
const generatorFields=['org','site','object','location','orgHistory','tankId','hoursInit','fuelAccounting','fuelBalance','desObjectTankTransfer','desObjectGeneratorTransfer'];
function fail(code,message){throw Object.assign(Error(message),{code,status:400});}
function copy(value){exchange.digest(value);return JSON.parse(JSON.stringify(value));}
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
function text(value,label){if(typeof value!=='string'||!value.trim()||value.length>1000||value.includes('\0'))fail('DES_TANK_INPUT','Проверьте '+label);return value;}
function scopeOf(value){if(!object(value)||Object.keys(value).some(k=>!['org','site'].includes(k)))fail('DES_TANK_SCOPE','Укажите организацию и объект ёмкости');return{org:text(value.org,'организацию'),site:text(value.site,'объект')};}
function date(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;}
function state(row,fields){return Object.fromEntries(fields.map(field=>[field,own(row,field)?{present:true,value:copy(row[field])}:{present:false}]));}
function apply(row,fields){const output=copy(row);for(const[field,slot]of Object.entries(fields)){if(slot.present)output[field]=copy(slot.value);else delete output[field];}return output;}
function locate(database,name,id){const rows=(database[name]||[]).filter(row=>row.id===id);if(rows.length!==1)fail('DES_TANK_ID','Неоднозначная или отсутствующая строка ёмкости/источника');return rows[0];}
function inputDatabase(value){const input=copy(value);contracts.validateSections(input,schema.sections);return Object.fromEntries(schema.sections.map(name=>[name,input[name]||[]]));}
function principalAllowed(value){try{const principal=access.normalizePrincipal(value);return principal.role==='admin'&&evidence.isGloballyUnrestricted(principal)&&stock.readSections.every(name=>!principal.readable||principal.readable.includes('*')||principal.readable.includes(name));}catch{return false;}}
function requirePrincipal(value){if(!principalAllowed(value))fail('ACCESS_DENIED','Передачу ёмкости с расчётным остатком подтверждает администратор центра с полным доступом к источникам запаса');}
function siteOf(row){for(const field of ['site','object','location'])if(own(row,field))return typeof row[field]==='string'?row[field]:null;return null;}
function matchesScope(resolver,section,row,scope){const fact=resolver.resolve(section,row);return fact.kind==='owned'&&fact.owners.length===1&&fact.readRequirements?.complete!==false&&fact.owners.every(owner=>owner.org.state==='known'&&owner.org.value===scope.org&&owner.site.state==='known'&&owner.site.value===scope.site);}
function choices(database,scope){
 const resolver=scopeApi.createResolver(database),counts=new Map();for(const row of database.tanks)counts.set(key(row.id),(counts.get(key(row.id))||0)+1);
 return database.tanks.map(tank=>{
  let reason='';if(!contracts.identifier(tank.id)||counts.get(key(tank.id))!==1)reason='ID ёмкости неоднозначен';
  else if(siteOf(tank)!==scope.site)reason='Объект ёмкости не совпадает с выбранным объектом';
  else if(own(tank,'org')&&typeof tank.org==='string'&&tank.org.trim()&&tank.org!==scope.org)reason='Организация ёмкости отличается от выбранной';
  else if(own(tank,'org')&&tank.org!==null&&typeof tank.org!=='string')reason='Организация ёмкости не подтверждена';
  const consumers=['generators','vehicles'].flatMap(section=>database[section].filter(row=>row.tankId===tank.id).map(row=>({section,row})));
  if(!reason&&consumers.some(({section,row})=>!matchesScope(resolver,section,row,scope)))reason='Ёмкость связана с техникой другой или неподтверждённой организации/площадки';
  if(!reason&&own(tank,'desObjectTankTransfer'))reason='Нельзя повторно передавать уже преобразованную локальную ёмкость как центральную';
  const linkedGeneratorCount=consumers.filter(item=>item.section==='generators').length;
  return{id:tank.id,name:typeof tank.name==='string'?tank.name:'Ёмкость',object:siteOf(tank),scope:{...scope},eligible:!reason,reason,recommended:!reason&&linkedGeneratorCount>0,linkedGeneratorCount,capacity:typeof tank.capacity==='number'?tank.capacity:null};
 });
}
function candidates(database,{scope,principal}={}){if(!principalAllowed(principal))return[];const selected=scopeOf(scope);return choices(inputDatabase(database),selected).filter(row=>row.object===selected.site);}
function digestFrame(frame){const body=copy(frame);delete body.digest;return'sha256:'+exchange.digest(body);}
function validateFrame(value){
 const frame=copy(value),allowed=['version','kind','frameId','scope','sourceDatabaseToken','today','asOf','tanks','generators','sources','digest'];
 if(!object(frame)||Object.keys(frame).some(k=>!allowed.includes(k))||frame.version!==1||frame.kind!=='des-object-tank-frame'||typeof frame.frameId!=='string'||!/^destank:[a-f0-9]{64}$/.test(frame.frameId)||frame.digest!==digestFrame(frame)||!date(frame.today)||typeof frame.asOf!=='string'||!Number.isFinite(Date.parse(frame.asOf)))fail('DES_TANK_FRAME','Не подтверждён документ передачи ёмкости');
 scopeOf(frame.scope);text(frame.sourceDatabaseToken,'исходную базу');
 if(!Array.isArray(frame.tanks)||!frame.tanks.length||frame.tanks.length>100||!Array.isArray(frame.generators)||!Array.isArray(frame.sources))fail('DES_TANK_FRAME','Неверный состав документа передачи');
 const ids=new Set();for(const item of [...frame.tanks.map(row=>({...row,section:'tanks'})),...frame.generators.map(row=>({...row,section:'generators'}))]){
  const token=item.section+':'+key(item.id);if(!contracts.identifier(item.id)||ids.has(token)||!object(item.hostFields)||!object(item.overlayFields))fail('DES_TANK_FRAME','Не подтверждены поля документа передачи');ids.add(token);
  const expected=item.section==='tanks'?tankFields:generatorFields;if(Object.keys(item.hostFields).sort().join('|')!==expected.slice().sort().join('|')||Object.keys(item.overlayFields).sort().join('|')!==expected.slice().sort().join('|'))fail('DES_TANK_FRAME','Не подтверждены поля документа передачи');
  for(const slots of [item.hostFields,item.overlayFields])for(const slot of Object.values(slots))if(!object(slot)||typeof slot.present!=='boolean'||Object.keys(slot).some(k=>!['present','value'].includes(k))||slot.present!==own(slot,'value'))fail('DES_TANK_FRAME','Не подтверждены исходные поля документа передачи');
 }
 const sourceIds=new Set();for(const source of frame.sources){const token=source.section+':'+key(source.id);if(!fuelSources.has(source.section)||!contracts.identifier(source.id)||sourceIds.has(token)||!/^sha256:[a-f0-9]{64}$/.test(source.digest))fail('DES_TANK_FRAME','Не подтверждены источники начального остатка');sourceIds.add(token);}
 for(const item of frame.tanks){
  const row=apply({id:item.id},item.overlayFields),marker=row.desObjectTankTransfer;
  if(typeof item.opening!=='number'||!Number.isFinite(item.opening)||item.opening<0||typeof item.openingDecimal!=='string'||!/^sha256:[a-f0-9]{64}$/.test(item.sourceFingerprint)||!Number.isSafeInteger(item.sourceCount)||item.sourceCount<0||row.org!==frame.scope.org||row.site!==frame.scope.site||!object(marker))fail('DES_TANK_FRAME','Не подтверждён начальный остаток передачи');
  const expectedMarker={version:1,frameId:frame.frameId,sourceDatabaseToken:frame.sourceDatabaseToken,sourceFingerprint:item.sourceFingerprint,asOf:frame.asOf,from:frame.today,opening:item.opening,openingDecimal:item.openingDecimal,basis:marker.basis};
  if(!same(marker,expectedMarker)||typeof marker.basis!=='string'||!marker.basis.includes(item.sourceFingerprint))fail('DES_TANK_FRAME','Не подтверждено основание передачи');
  const boundary=accounting.resolve('tanks',row);if(boundary.mode!=='explicit'||boundary.from!==frame.today||boundary.opening!==item.opening||boundary.basis!==marker.basis||decimal.compare(item.openingDecimal,item.opening)!==0)fail('DES_TANK_FRAME','Не подтверждена граница переданного остатка');
 }
 for(const item of frame.generators){
  const row=apply({id:item.id},item.overlayFields),marker=row.desObjectGeneratorTransfer,meter=marker?.meter;
  if(!object(marker)||Object.keys(marker).some(field=>!['version','frameId','asOf','from','meter','openingFuel','sourceFingerprint'].includes(field))||marker.version!==1||marker.frameId!==frame.frameId||marker.asOf!==frame.asOf||marker.from!==frame.today||!/^sha256:[a-f0-9]{64}$/.test(marker.sourceFingerprint)||typeof marker.openingFuel!=='number'||!Number.isFinite(marker.openingFuel)||marker.openingFuel<0||!object(meter)||!['known','initial','unknown'].includes(meter.status)||row.org!==frame.scope.org||row.site!==frame.scope.site)fail('DES_TANK_FRAME','Не подтверждён перенос счётчика или остатка связанной ДЭС');
  if(meter.status==='known'&&(!contracts.identifier(meter.recordId)||!date(meter.date)||meter.date>frame.today||typeof meter.value!=='number'||!Number.isFinite(meter.value)||meter.value<0||row.hoursInit!==meter.value)||meter.status==='initial'&&meter.value!==null&&(typeof meter.value!=='number'||!Number.isFinite(meter.value)||meter.value<0))fail('DES_TANK_FRAME','Не подтверждён источник счётчика связанной ДЭС');
  if(meter.status==='unknown'&&(meter.value!==null||typeof meter.reason!=='string'||!meter.reason.trim()||meter.reason.length>2000))fail('DES_TANK_FRAME','Не указана причина отсутствия подтверждённого счётчика');
  const boundary=accounting.resolve('generators',row);if(boundary.mode!=='explicit'||boundary.from!==frame.today||boundary.opening!==marker.openingFuel||!boundary.basis.includes(marker.sourceFingerprint))fail('DES_TANK_FRAME','Не подтверждён перенос остатка топлива связанной ДЭС');
 }
 return freeze(frame);
}
function sourceRows(database,tankIds,today){
 const projection=stock.project(database,{tankIds,to:today}),found=new Map();
 for(const entry of projection.rows)for(const event of entry.events){if(event.date>today)continue;const name=event.source.section,id=event.source.id;if(!fuelSources.has(name)||!contracts.identifier(id))fail('DES_TANK_SOURCE','Источник запаса не имеет однозначного ID');const row=locate(database,name,id);found.set(name+':'+key(id),{section:name,id,digest:'sha256:'+exchange.digest(row)});}
 return[...found.values()];
}
function activeJournal(row){return !row.deleted&&!row.cancelled&&!row.void&&row.posted!==false&&!['draft','cancelled','void','discarded','unposted'].includes(String(row.status))&&!(object(row.lifecycle)&&(own(row.lifecycle,'void')||row.lifecycle.posted===false||['draft','cancelled','void','discarded','unposted'].includes(String(row.lifecycle.state))));}
function generatorCarry(database,generator,today){
 const all=database.genRecords.filter(row=>row.generatorId===generator.id),active=all.filter(activeJournal);
 if(active.some(row=>!date(row.date)))fail('DES_TANK_GENERATOR_SOURCE','В журнале связанной ДЭС есть запись без действительной даты. Исправьте источник перед передачей');
 const included=active.filter(row=>row.date<=today).slice().sort((a,b)=>a.date.localeCompare(b.date)),counter=generatorMaintenance.journalCounter(database,{generatorId:generator.id,throughDate:today});let meter;
 if(counter.status==='known')meter={status:'known',value:counter.currentHours,recordId:counter.source.recordId,date:counter.source.date};
 else if(counter.issues.every(issue=>issue.code==='MAINTENANCE_COUNTER_EMPTY'))meter={status:'initial',value:typeof generator.hoursInit==='number'&&Number.isFinite(generator.hoursInit)&&generator.hoursInit>=0?generator.hoursInit:null};
 else meter={status:'unknown',value:null,reason:counter.reason};
 let boundary,balance;try{boundary=accounting.resolve('generators',generator);if(boundary.mode==='explicit'&&boundary.from>today)throw Error();balance=decimal.parse(boundary.mode==='explicit'?boundary.opening:generator.fuelBalance,{nonNegative:true});}catch{fail('DES_TANK_GENERATOR_FUEL','Не подтверждён исходный остаток топлива связанной ДЭС');}
 for(const row of included){if(boundary.mode==='explicit'&&row.date<boundary.from)continue;let spent;
  try{const explicitActual=row.fuelActual!==undefined&&row.fuelActual!==null&&row.fuelActual!=='',explicitUsed=row.fuelUsed!==undefined&&row.fuelUsed!==null&&row.fuelUsed!=='';spent=movementPolicy.generatorSpent(generator,row);if(!explicitActual&&!explicitUsed&&Number(row.hours)>0&&!generatorFuel.generatorIssueOnly(row)){const parameters=generatorFuel.generatorParameters(generator,row);if(parameters===null||generatorFuel.generatorRate(parameters,row)===null)spent=null;}if(spent===null)throw Error();const issued=row.fuelIssued===undefined||row.fuelIssued===null||row.fuelIssued===''?'0':decimal.parse(row.fuelIssued,{nonNegative:true});balance=decimal.sub(decimal.add(balance,issued),decimal.parse(spent,{nonNegative:true}));}catch{fail('DES_TANK_GENERATOR_FUEL','В журнале связанной ДЭС не подтверждены получение или расход топлива');}
 }
 if(decimal.compare(balance,0)<0)fail('DES_TANK_GENERATOR_FUEL','Расчётный остаток топлива связанной ДЭС отрицателен; передача остановлена');
 let openingFuel;try{openingFuel=decimal.toNumberExact(balance);}catch{fail('DES_TANK_GENERATOR_FUEL','Остаток топлива связанной ДЭС нельзя передать без потери точности');}
 const sourceFingerprint='sha256:'+exchange.digest({version:1,generatorId:generator.id,through:today,hoursInit:generator.hoursInit??null,fuelBalance:generator.fuelBalance??null,fuelAccounting:generator.fuelAccounting??null,meter,records:included});
 return{meter,openingFuel,sourceFingerprint,sources:all.filter(row=>!date(row.date)||row.date<=today).map(row=>{if(!contracts.identifier(row.id)||all.filter(other=>other.id===row.id).length!==1)fail('DES_TANK_GENERATOR_SOURCE','В журнале связанной ДЭС неоднозначный ID источника');return{section:'genRecords',id:row.id,digest:'sha256:'+exchange.digest(row)};})};
}
function prepare(database,options={}){
 requirePrincipal(options.principal);const db=inputDatabase(database),scope=scopeOf(options.scope),now=text(options.now||options.createdAt,'дату передачи'),resolved=calendar.resolve(db,now),today=options.today??resolved.today;
 if(!date(today)||!Number.isFinite(Date.parse(now))||today!==resolved.today)fail('DES_TANK_TIME','Дата передачи не совпадает с учётным календарём');
 const databaseToken=text(options.databaseToken??options.sourceDatabaseToken,'исходную базу'),tankIds=options.tankIds;
 if(!Array.isArray(tankIds)||!tankIds.length||tankIds.length>100||tankIds.some(id=>!contracts.identifier(id))||new Set(tankIds.map(key)).size!==tankIds.length)fail('DES_TANK_SELECTION','Явно выберите ёмкости для передачи');
 const available=choices(db,scope);for(const id of tankIds){const candidate=available.find(row=>row.id===id);if(!candidate?.eligible)fail('DES_TANK_SCOPE',candidate?.reason||'Выбранная ёмкость не найдена');}
 const projection=stock.project(db,{tankIds,to:today}),sources=sourceRows(db,tankIds,today),tankSeed=[];
 for(const id of tankIds){const tank=locate(db,'tanks',id),row=stock.at(projection,{section:'tanks',id},today,{includeEvents:true});if(row.status!=='known'||row.balance===null||row.balance<0||row.balanceDecimal===null||row.diagnostics.some(issue=>issue.severity==='error'))fail('DES_TANK_STOCK','Расчётный остаток ёмкости неизвестен или отрицателен; сначала проверьте источники в центре');const sourceFingerprint=stock.sourceFingerprint(db,{section:'tanks',id},today),sourceCount=sources.filter(source=>row.events.some(event=>event.source.section===source.section&&event.source.id===source.id)).length;tankSeed.push({id,name:typeof tank.name==='string'?tank.name:'Ёмкость',hostFields:state(tank,tankFields),opening:row.balance,openingDecimal:row.balanceDecimal,sourceFingerprint,sourceCount});}
 const generatorSeed=[],sourceIds=new Set(sources.map(source=>source.section+':'+key(source.id)));for(const generator of db.generators)if(tankIds.some(id=>id===generator.tankId)){
  const history=generator.orgHistory;if(history!==undefined&&(!Array.isArray(history)||history.length&&!matchesScope(scopeApi.createResolver(db),'genRecords',{id:'handover-check',generatorId:generator.id,date:today},scope)))fail('DES_TANK_GENERATOR_HISTORY','Принадлежность ДЭС на дату передачи неоднозначна или отличается от выбранного объекта');
  if(own(generator,'desObjectTankTransfer')||own(generator,'desObjectGeneratorTransfer'))fail('DES_TANK_SCOPE','Центральная ДЭС уже содержит локальный документ передачи');
  const carry=generatorCarry(db,generator,today);for(const source of carry.sources){const id=source.section+':'+key(source.id);if(!sourceIds.has(id)){sources.push(source);sourceIds.add(id);}}
  const next=copy(generator);next.org=scope.org;next.site=scope.site;if(!Array.isArray(history)||!history.length)next.orgHistory=[{from:today,to:'',org:scope.org,site:scope.site}];if(carry.meter.status==='known')next.hoursInit=carry.meter.value;
  next.fuelAccounting={version:1,from:today,opening:carry.openingFuel,basis:'Расчётный остаток топлива ДЭС при передаче; источник '+carry.sourceFingerprint};
  generatorSeed.push({id:generator.id,hostFields:state(generator,generatorFields),overlayFields:state(next,generatorFields),carry:{meter:carry.meter,openingFuel:carry.openingFuel,sourceFingerprint:carry.sourceFingerprint}});
 }
 const seed={version:1,kind:'des-object-tank-frame',scope,sourceDatabaseToken:databaseToken,today,asOf:now,tanks:tankSeed,generators:generatorSeed,sources},frameId='destank:'+exchange.digest(seed),tanks=tankSeed.map(item=>{
  const basis='Расчётный остаток при передаче данных ДЭС объекта; источник '+item.sourceFingerprint;
  const marker={version:1,frameId,sourceDatabaseToken:databaseToken,sourceFingerprint:item.sourceFingerprint,asOf:now,from:today,opening:item.opening,openingDecimal:item.openingDecimal,basis};
  const next=apply(locate(db,'tanks',item.id),item.hostFields),history=next.orgHistory;
  if(history!==undefined&&(!Array.isArray(history)||history.length&&!matchesScope(scopeApi.createResolver(db),'tankIncomes',{id:'tank-handover-check',tankId:item.id,date:today},scope)))fail('DES_TANK_HISTORY','Принадлежность ёмкости на дату передачи неоднозначна или отличается от выбранного объекта');
  next.org=scope.org;next.site=scope.site;if(!Array.isArray(history)||!history.length)next.orgHistory=[{from:today,to:'',org:scope.org,site:scope.site}];next.fuelAccounting={version:1,from:today,opening:item.opening,basis};next.desObjectTankTransfer=marker;
  return{...item,overlayFields:state(next,tankFields)};
 });
 const generators=generatorSeed.map(item=>{const next=apply(locate(db,'generators',item.id),item.overlayFields);next.desObjectGeneratorTransfer={version:1,frameId,asOf:now,from:today,...item.carry};return{id:item.id,hostFields:item.hostFields,overlayFields:state(next,generatorFields)};});
 const body={...seed,frameId,tanks,generators},frame=validateFrame({...body,digest:digestFrame(body)}),logical=overlay(db,frame),summary={tanks:tanks.map(item=>({id:item.id,name:item.name,opening:item.opening,openingDecimal:item.openingDecimal,asOf:now,from:today,sourceCount:item.sourceCount,sourceFingerprint:item.sourceFingerprint})),generators:generatorSeed.map(item=>({id:item.id,name:locate(db,'generators',item.id).name||'ДЭС',meter:item.carry.meter,openingFuel:item.carry.openingFuel}))};
 return{frame,database:logical,summary};
}
function assertCurrent(database,frame){
 for(const item of frame.tanks)if(!choices(database,frame.scope).find(row=>row.id===item.id)?.eligible)fail('DES_TANK_FRAME_STALE','Область или потребители ёмкости изменились. Нужна новая передача');
 for(const [section,items]of [['tanks',frame.tanks],['generators',frame.generators]])for(const item of items){const row=locate(database,section,item.id);if(!same(state(row,Object.keys(item.hostFields)),item.hostFields))fail('DES_TANK_FRAME_STALE','Поля передачи ёмкости изменились в центре. Выгрузите свежие начальные данные');}
 for(const source of frame.sources){const rows=database[source.section].filter(row=>row.id===source.id);if(rows.length!==1||'sha256:'+exchange.digest(rows[0])!==source.digest)fail('DES_TANK_FRAME_STALE','Источник начального остатка изменён или удалён. Выгрузите свежие начальные данные');}
 const captured=new Set(frame.sources.map(source=>source.section+':'+key(source.id))),current=stock.project(database,{tankIds:frame.tanks.map(row=>row.id)});
 for(const row of database.genRecords)if(frame.generators.some(generator=>generator.id===row.generatorId)&&activeJournal(row)&&(!date(row.date)||row.date<frame.today)&&!captured.has('genRecords:'+key(row.id)))fail('DES_TANK_FRAME_STALE','В центре добавлена запись связанной ДЭС до передачи или без даты. Выгрузите свежие начальные данные');
 if(current.rows.length!==frame.tanks.length||current.rows.some(row=>row.status!=='known'||row.balance===null||row.balance<0||row.diagnostics.some(issue=>issue.severity==='error')))fail('DES_TANK_FRAME_STALE','Текущий запас ёмкости нельзя подтвердить. Проверьте источники в центре и выгрузите свежие начальные данные');
 for(const row of current.rows)for(const event of row.events)if(event.date<frame.today&&!captured.has(event.source.section+':'+key(event.source.id)))fail('DES_TANK_FRAME_STALE','В центре добавлен источник до даты передачи. Нужен новый расчёт начального остатка');
}
function overlay(database,frameValue){
 const db=inputDatabase(database),frame=validateFrame(frameValue);assertCurrent(db,frame);for(const [section,items]of [['tanks',frame.tanks],['generators',frame.generators]]){const map=new Map(items.map(item=>[key(item.id),item]));db[section]=db[section].map(row=>map.has(key(row.id))?apply(row,map.get(key(row.id)).overlayFields):row);}
 for(const section of fuelSources){const hidden=new Set(frame.sources.filter(source=>source.section===section).map(source=>key(source.id)));db[section]=db[section].filter(row=>!hidden.has(key(row.id)));}return db;
}
function restoreSections(database,sectionsValue,frameValue){
 const db=inputDatabase(database),sections=copy(sectionsValue),frame=validateFrame(frameValue);contracts.validateSections(sections,schema.sections);assertCurrent(db,frame);
 const transferred=new Set(frame.tanks.map(item=>key(item.id)));
 const transferredGenerators=new Set(frame.generators.map(row=>key(row.id)));
 function markers(value,allowed=null){if(Array.isArray(value)){for(const item of value)markers(item);return;}if(!object(value))return;for(const[name,item]of Object.entries(value)){if(name==='desObjectTankTransfer'||name==='desObjectGeneratorTransfer'){if(allowed!==name)fail('DES_TANK_FRAME_PROTECTED','Нельзя создавать собственный документ передачи ёмкости или ДЭС');continue;}markers(item);}}
 for(const[section,rows]of Object.entries(sections))for(const row of rows)markers(row,section==='tanks'&&transferred.has(key(row.id))?'desObjectTankTransfer':section==='generators'&&transferredGenerators.has(key(row.id))?'desObjectGeneratorTransfer':null);
 for(const [section,items]of [['tanks',frame.tanks],['generators',frame.generators]])if(own(sections,section)){
  const map=new Map(items.map(item=>[key(item.id),item]));
  for(const item of items){const matches=sections[section].filter(row=>row.id===item.id);if(matches.length!==1||!same(state(matches[0],Object.keys(item.overlayFields)),item.overlayFields))fail('DES_TANK_FRAME_PROTECTED','Документ передачи, начальный остаток и закреплённые связи нельзя изменить или удалить из программы объекта');}
  sections[section]=sections[section].map(row=>map.has(key(row.id))?apply(row,map.get(key(row.id)).hostFields):row);
 }
 for(const section of fuelSources)if(own(sections,section)){
  const captured=new Set(frame.sources.filter(source=>source.section===section).map(source=>key(source.id)));if(sections[section].some(row=>captured.has(key(row.id))))fail('DES_TANK_SOURCE_PROTECTED','Исходную запись начального остатка нельзя выдать за новую операцию объекта');
  const incoming=new Map();for(const row of sections[section]){const id=key(row.id);if(incoming.has(id))fail('DES_TANK_ID','ID результата неоднозначен');incoming.set(id,row);}
  const restored=[];for(const original of db[section]){const id=key(original.id);if(captured.has(id))restored.push(copy(original));else if(incoming.has(id)){restored.push(incoming.get(id));incoming.delete(id);}}
  restored.push(...incoming.values());sections[section]=restored;
 }
 return sections;
}
module.exports=Object.freeze({apiVersion:1,candidates,prepare,overlay,restoreSections,validateFrame});
