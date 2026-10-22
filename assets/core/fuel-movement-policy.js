/* Fuel conservation and journal linkage rules shared by native, API and UI saves. */
(function(root,factory){'use strict';if(typeof module==='object'&&module.exports)module.exports=factory(()=>require('./fuel-engine.js'),()=>require('./accounting-boundary.js'),()=>require('./decimal-core.js'),()=>require('./effective-periods.js'),()=>require('./fuel-stock.js'));else root.FuelMovementPolicy=factory(()=>root.TvsFuelEngine,()=>root.AccountingBoundary,()=>root.DecimalCore,()=>root.EffectivePeriods,()=>root.FuelStock);})(typeof globalThis==='object'?globalThis:this,function(getFuel,getAccounting,getDecimal,getPeriods,getStock){
  'use strict';
  const own=(row,key)=>Object.prototype.hasOwnProperty.call(row,key);
  const rows=(db,section)=>Array.isArray(db?.[section])?db[section].filter(row=>row&&typeof row==='object'&&!Array.isArray(row)):[];
  const present=value=>value!==undefined&&value!==null&&String(value).trim()!=='';
  const idKey=value=>typeof value+':'+String(value);
  const live=row=>!row.cancelled&&!row.deleted;
  const canRead=(context,section)=>!Array.isArray(context?.readable)||context.readable.includes('*')||context.readable.includes(section);
  const number=value=>typeof value==='number'&&Number.isFinite(value)?value:typeof value==='string'&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())&&Number.isFinite(Number(value))?Number(value):NaN;
  const amount=row=>number(row.liters??row.litres??row.amount??row.qty);
  const quantity=value=>Number.isFinite(number(value))?number(value):0;
  const sameQty=(a,b)=>{if(!Number.isFinite(number(a))||!Number.isFinite(number(b)))return false;try{return decimal().compare(a,b)===0;}catch{return false;}};
  const sameRef=(a,b)=>!present(a)&&!present(b)||a===b;
  function stable(value){if(value===undefined)return 'undefined';if(value===null||typeof value!=='object')return JSON.stringify(value);return Array.isArray(value)?'['+value.map(stable).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}';}
  function dateValid(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T12:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;}
  const find=(db,section,id)=>rows(db,section).find(row=>row.id===id);
  function accounting(section,row){
    if(!row||!own(row,'fuelAccounting'))return {mode:'legacy'};
    const api=getAccounting();
    if(!api||api.apiVersion!==1||typeof api.resolve!=='function')throw Object.assign(Error('Не загружены правила начала учёта топлива'),{code:'MODULE_UNAVAILABLE'});
    return api.resolve(section,row);
  }
  function accountingState(section,row){try{return accounting(section,row);}catch(error){return {mode:'invalid',error};}}
  function asset(db,ref){const match=typeof ref==='string'&&ref.match(/^([vg]):(.+)$/);if(!match)return null;const matches=rows(db,match[1]==='v'?'vehicles':'generators').filter(row=>String(row.id)===match[2]);return matches.length===1?matches[0]:null;}
  function family(row){
    if(!row)return null;
    const fuel=getFuel(),grade=typeof fuel?.parseFuelGrade==='function'?fuel.parseFuelGrade(row.fuelGrade):'';
    if(grade==='ДТ')return 'diesel';if(grade==='Газ')return 'gas';if(/^АИ-/.test(grade)||/^бензин$/i.test(String(row.fuelGrade||'').trim()))return 'gasoline';
    if(['diesel','gasoline','gas'].includes(row.fuel))return row.fuel;
    return present(row.fuel)?null:'diesel';
  }
  function recordTank(db,row){return own(row,'tankId')?row.tankId:find(db,'generators',row.generatorId)?.tankId??null;}
  function stockModule(){const api=getStock();if(api?.apiVersion!==1)throw Object.assign(Error('Не загружен общий проектор топливного запаса'),{code:'MODULE_UNAVAILABLE'});return api;}
  function isValidReversal(db,original){
    const list=rows(db,'fuelMovements'),inverse=list.find(row=>row.id===original?.reversedBy),active=stockModule().live;
    return !!original&&!!inverse&&list.filter(row=>row.id===original.id).length===1&&stable(list.find(row=>row.id===original.id))===stable(original)&&list.filter(row=>row.id===inverse.id).length===1&&original.id!==inverse.id&&active(original)&&active(inverse)&&
      !present(original.originalMovementId)&&!present(inverse.reversedBy)&&inverse.originalMovementId===original.id&&list.filter(row=>row.originalMovementId===original.id).length===1&&
      sameQty(original.qty,inverse.qty)&&number(original.qty)>0&&present(inverse.reason)&&present(original.reversedAt)&&original.reversedAt===inverse.createdAt&&Number.isFinite(Date.parse(original.reversedAt))&&
      inverse.kind==='adjustment'&&inverse.date===original.date&&sameRef(inverse.fromTankId,original.toTankId)&&sameRef(inverse.toTankId,original.fromTankId)&&sameRef(inverse.assetRef,original.assetRef)&&stable(inverse.sourceSnapshot??null)===stable(original.sourceSnapshot??null);
  }
  function tankTimeline(db){
    const timelines=new Map();if(!rows(db,'tanks').length)return timelines;
    const projected=stockModule().project(db);
    for(const entry of projected.rows){const tank=rows(db,'tanks').find(row=>row.id===entry.target.id),events=new Map();for(const event of entry.events)if(event.stockAffects)events.set(event.date,event.balanceDecimal);timelines.set(idKey(entry.target.id),{tank,initial:entry.openingDecimal,from:entry.accountingFrom,events,entry});}
    return timelines;
  }
  function balancesAt(timeline,dates){
    const balances=new Map(),events=timeline?[...timeline.events].sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0):[];let position=0,balance=timeline?.initial??'0';
    for(const day of dates){while(position<events.length&&events[position][0]<=day){balance=events[position][1];position++;}const invalid=timeline?.entry.diagnostics.some(issue=>issue.date==null||issue.date<=day);balances.set(day,timeline?.from&&day<timeline.from||invalid||balance===null?null:balance);}
    return balances;
  }
  function analyze(db,context={}){
    const issues=[];
    const add=(section,row,code,field,message,proof,extra={})=>issues.push({severity:'error',section,recordId:row.id??'',code,field,message,proof,...extra});
    for(const section of ['vehicles','generators','tanks'])if(canRead(context,section))for(const row of rows(db,section)){
      const boundary=accountingState(section,row);
      if(boundary.mode==='invalid')add(section,row,'FUEL_ACCOUNTING_INVALID','fuelAccounting',boundary.error.message,[row.fuelAccounting]);
    }
    const movements=rows(db,'fuelMovements');
    if(canRead(context,'fuelMovements'))for(const row of movements){
      if(row.kind==='measurement'){
        const value=row.measurement,target=value?.target;let valid=row.qty===0&&!present(row.fromTankId)&&!present(row.toTankId)&&dateValid(row.date)&&value?.version===1&&value.position==='end-of-day'&&target?.section==='tanks'&&rows(db,'tanks').filter(tank=>tank.id===target.id).length===1&&typeof value.observedQty==='number'&&present(row.reason)&&/^sha256:[a-f0-9]{64}$/.test(value.sourceFingerprint||'');
        try{decimal().parse(value?.observedQty,{scale:3,max:'1000000000000',nonNegative:true});if(value?.calculatedQty===null){if(value.differenceQty!==null)valid=false;}else{if(typeof value?.calculatedQty!=='string'||decimal().parse(value.calculatedQty)!==value.calculatedQty||typeof value?.differenceQty!=='string'||decimal().parse(value.differenceQty)!==value.differenceQty||decimal().sub(value.observedQty,value.calculatedQty)!==value.differenceQty)valid=false;}}catch{valid=false;}
        if(!valid)add('fuelMovements',row,'FUEL_MEASUREMENT_INVALID','measurement','Замер должен хранить неотрицательный факт, точную разницу и источник без движения топлива',[row.qty,row.date,row.fromTankId,row.toTankId,value]);continue;
      }
      const qty=number(row.qty),from=present(row.fromTankId),to=present(row.toTankId);
      if(!(qty>0))add('fuelMovements',row,'FUEL_QUANTITY','qty','Количество топлива должно быть больше нуля',[row.qty]);
      if(!dateValid(row.date))add('fuelMovements',row,'FUEL_DATE','date','Укажите действительную дату движения топлива',[row.date]);
      if(!['receipt','return','issue','transfer','adjustment','supplierReturn'].includes(row.kind))add('fuelMovements',row,'FUEL_KIND','kind','Неизвестный вид движения топлива',[row.kind]);
      const direction=row.kind==='transfer'?from&&to&&row.fromTankId!==row.toTankId:['receipt','return'].includes(row.kind)?!from&&to:['issue','supplierReturn'].includes(row.kind)?from&&!to:row.kind==='adjustment'?row.originalMovementId?(from||to)&&(!from||!to||row.fromTankId!==row.toTankId):from!==to:false;
      if(!direction)add('fuelMovements',row,'FUEL_DIRECTION','fromTankId/toTankId','Проверьте направление: приход в ёмкость, выдача из ёмкости, перемещение между двумя разными ёмкостями',[row.kind,row.fromTankId,row.toTankId]);
      if(!present(row.reason))add('fuelMovements',row,'FUEL_REASON','reason','Укажите документ или основание движения топлива',[row.reason]);
      if(row.kind==='return'&&present(row.assetRef))add('fuelMovements',row,'FUEL_ASSET_RETURN','assetRef','Возврат из бака техники требует отдельного поддерживаемого документа; обычный возврат считается внешним',[row.kind,row.assetRef]);
      if(row.kind==='supplierReturn'&&present(row.assetRef))add('fuelMovements',row,'FUEL_SUPPLIER_RETURN_ASSET','assetRef','Возврат поставщику выводит топливо из ёмкости и не создаёт приход в технику',[row.kind,row.assetRef]);
      if(row.kind==='issue'&&present(row.assetRef)&&!(typeof row.assetRef==='string'&&/^[vg]:.+$/.test(row.assetRef)))add('fuelMovements',row,'FUEL_ISSUE_ASSET','assetRef','Выдачу можно связать с транспортом или ДЭС; для ёмкости используйте перемещение',[row.kind,row.assetRef]);
      if(!canRead(context,'tanks'))continue;
      const source=find(db,'tanks',row.fromTankId),target=find(db,'tanks',row.toTankId);
      if(source&&!family(source)||target&&!family(target))add('fuelMovements',row,'FUEL_TYPE_UNKNOWN','fromTankId/toTankId','Укажите известный вид топлива у используемой ёмкости',[source?.fuel,source?.fuelGrade,target?.fuel,target?.fuelGrade]);
      if(source&&target&&family(source)!==family(target))add('fuelMovements',row,'FUEL_GRADE_MISMATCH','fromTankId/toTankId','Виды топлива исходной и принимающей ёмкостей не совпадают',[row.fromTankId,row.toTankId,family(source),family(target)]);
      if(source&&row.sourceSnapshot?.fuel&&row.sourceSnapshot.fuel!==family(source))add('fuelMovements',row,'FUEL_SOURCE_MISMATCH','sourceSnapshot.fuel','Вид топлива снимка источника не совпадает с ёмкостью',[row.sourceSnapshot.fuel,family(source)]);
      if(row.kind==='issue'&&source&&present(row.assetRef)&&canRead(context,String(row.assetRef).startsWith('v:')?'vehicles':'generators')){
        const recipient=asset(db,row.assetRef);
        if(recipient&&(!family(source)||family(source)!==family(recipient)))add('fuelMovements',row,'FUEL_GRADE_MISMATCH','assetRef','Вид выданного топлива не соответствует выбранной технике',[row.assetRef,family(source),family(recipient)]);
      }
      if(row.kind!=='issue'||!present(row.assetRef))continue;
      const section=String(row.assetRef).startsWith('v:')?'records':'genRecords',other=section==='records'?'genRecords':'records';
      if(!canRead(context,section))continue;
      if(section==='genRecords'&&!row.legacyOverlapConfirmed&&rows(db,'genRecords').some(record=>String(record.generatorId)===String(row.assetRef).slice(2)&&record.date===row.date&&recordTank(db,record)===row.fromTankId&&quantity(record.fuelIssued)>0&&record.fuelMovementId!==row.id))add('fuelMovements',row,'FUEL_LEGACY_ISSUE_OVERLAP','legacyOverlapConfirmed','За эту дату уже есть выдача из той же ёмкости в журнале ДЭС. Подтвердите отдельную дополнительную выдачу',[row.assetRef,row.date,row.fromTankId,row.legacyOverlapConfirmed]);
      const matches=rows(db,section).filter(record=>record.id===row.recordId||record.fuelMovementId===row.id);
      if(matches.length!==1||!present(row.recordId)||matches[0]?.id!==row.recordId||matches[0]?.fuelMovementId!==row.id){add('fuelMovements',row,'FUEL_JOURNAL_LINK','recordId','Выдача в технику должна иметь единственную связанную запись журнала с обратной ссылкой',[row.recordId,matches.map(record=>[record.id,record.fuelMovementId])]);continue;}
      const record=matches[0],assetField=section==='records'?'vehicleId':'generatorId';
      if(String(record[assetField])!==String(row.assetRef).slice(2)||record.date!==row.date)add(section,record,'FUEL_JOURNAL_TARGET',assetField+'/date','Техника и дата связанного прихода должны совпадать с выдачей',[record[assetField],record.date,row.assetRef,row.date]);
      if(section==='genRecords'&&(!own(record,'tankId')||present(record.tankId)))add(section,record,'FUEL_JOURNAL_DOUBLE_DEBIT','tankId','Связанный приход ДЭС не должен повторно списывать ту же выдачу из ёмкости',[record.tankId,own(record,'tankId')]);
      const issued=row.reversedBy?0:qty;
      if(!sameQty(record.fuelIssued,issued)||row.reversedBy&&(!sameQty(record.originalFuelIssued,qty)||record.reversalId!==row.reversedBy||record.reversedAt!==row.reversedAt)||!row.reversedBy&&present(record.reversalId))add(section,record,'FUEL_JOURNAL_QUANTITY','fuelIssued/reversalId','Литры связанного прихода и данные сторно должны точно соответствовать движению',[record.fuelIssued,record.originalFuelIssued,record.reversalId,record.reversedAt,row.qty,row.reversedBy,row.reversedAt]);
      if(section==='records'&&source&&family({...record,fuel:asset(db,row.assetRef)?.fuel})!==family(source))add(section,record,'FUEL_JOURNAL_GRADE','fuelGrade','Марка связанного прихода не соответствует виду топлива ёмкости',[record.fuelGrade,family(source)]);
      if(canRead(context,other)&&rows(db,other).some(record=>record.fuelMovementId===row.id))add('fuelMovements',row,'FUEL_JOURNAL_DUPLICATE','recordId','Одна выдача не может создавать приходы в двух журналах',[row.id]);
    }
    if(canRead(context,'fuelMovements'))for(const section of ['records','genRecords'])if(canRead(context,section))for(const record of rows(db,section))if(present(record.fuelMovementId)){
      const movement=movements.find(row=>row.id===record.fuelMovementId);
      if(!movement||movement.kind!=='issue'||!movement.assetRef||movement.recordId!==record.id||!live(movement))add(section,record,'FUEL_JOURNAL_ORPHAN','fuelMovementId','Связанный приход должен ссылаться на действующую выдачу с той же записью журнала',[record.fuelMovementId,movement?.kind,movement?.recordId,movement?.cancelled,movement?.deleted]);
    }
    if(['genRecords','generators','tanks'].every(section=>canRead(context,section)))for(const record of rows(db,'genRecords'))if(quantity(record.fuelIssued)>0){
      const generator=find(db,'generators',record.generatorId),tank=find(db,'tanks',recordTank(db,record));
      if(generator&&tank&&(!family(tank)||family(generator)!==family(tank)))add('genRecords',record,'FUEL_GENERATOR_GRADE','tankId','Вид топлива ёмкости не соответствует выбранной ДЭС',[record.generatorId,recordTank(db,record),family(tank),family(generator)]);
    }
    if(canRead(context,'tankIncomes')&&canRead(context,'tanks'))for(const row of rows(db,'tankIncomes'))if(['in','out'].includes(row.kind)){
      const peers=rows(db,'tankIncomes').filter(other=>other.linkId===row.linkId),counter=peers.find(other=>other.id!==row.id),from=row.kind==='out'?row:counter,to=row.kind==='in'?row:counter;
      if(!present(row.linkId)||peers.length!==2||!from||!to||from.kind!=='out'||to.kind!=='in'||!(amount(from)<0)||!(amount(to)>0)||!sameQty(-amount(from),amount(to))||from.date!==to.date||from.tankId===to.tankId||from.counterTankId!==to.tankId||to.counterTankId!==from.tankId)add('tankIncomes',row,'FUEL_LEGACY_TRANSFER_PAIR','linkId','Старое перемещение должно содержать согласованные расходную и приходную строки',[row.linkId,peers.map(peer=>[peer.id,peer.kind,peer.tankId,peer.counterTankId,peer.date,amount(peer)])]);
      const source=from&&find(db,'tanks',from.tankId),target=to&&find(db,'tanks',to.tankId);
      if(source&&target&&family(source)!==family(target))add('tankIncomes',row,'FUEL_LEGACY_TRANSFER_GRADE','counterTankId','Нельзя перемещать топливо между ёмкостями разных видов',[family(source),family(target)]);
    }
    const stockReadable=['tanks','tankIncomes','genRecords','generators','fuelMovements'].every(section=>canRead(context,section));
    if(stockReadable)for(const timeline of tankTimeline(db).values()){for(const issue of timeline.entry.diagnostics)add(issue.section,{id:issue.recordId},'FUEL_'+issue.code,'stock',issue.message,[issue.code,issue.date,issue.tankId],{date:issue.date});for(const [day,balance]of balancesAt(timeline,[...timeline.events.keys()].sort()))if(balance!==null&&decimal().compare(balance,0)<0)add('tanks',timeline.tank,'FUEL_STOCK_DEFICIT','balance','Недостаточно расчётного топлива в ёмкости на '+day,[timeline.tank.id,day],{date:day,deficit:-Number(balance),deficitDecimal:decimal().sub(0,balance)});}
    return issues;
  }
  function inspect(db,context={}){const issues=analyze(db,context);return {issues,counts:{error:issues.filter(issue=>issue.severity==='error').length,warning:issues.filter(issue=>issue.severity==='warning').length,total:issues.length}};}
  function decimal(){const api=getDecimal();if(api?.apiVersion!==1)throw Object.assign(Error('Не загружена десятичная арифметика'),{code:'MODULE_UNAVAILABLE'});return api;}
  function generatorParameters(generator,row){
    if(!generator||!own(generator,'fuelNorms'))return generator;
    const api=getPeriods();if(api?.apiVersion!==1)throw Object.assign(Error('Не загружены датированные нормы'),{code:'MODULE_UNAVAILABLE'});
    const selected=api.resolve('generators',generator,row.date,'fuelNorms');return selected.status==='known'?selected.parameters:null;
  }
  function generatorRate(generator,row){
    const d=decimal(),power=number(generator?.power),n100=number(generator?.norm100),load=number(row.load),n50=number(generator?.norm50),idle=number(generator?.normIdle);
    if(!(power>0)||!Number.isFinite(n100)||!Number.isFinite(load))return null;
    const share=d.div(load,power,{scale:12,rounding:'half-away-from-zero'}),twice=d.mul(share,2);
    const rate=Number.isFinite(n50)?d.compare(share,'0.5')<=0&&Number.isFinite(idle)
      ?d.add(idle,d.mul(d.sub(n50,idle),twice))
      :d.add(n50,d.mul(d.sub(n100,n50),d.sub(twice,1)))
      :d.mul(n100,share);
    return d.compare(rate,0)<0?'0':rate;
  }
  function generatorRounded(value){const d=decimal();return d.toNumberExact(d.quantize(value,{scale:3,rounding:'half-away-from-zero'}));}
  function generatorIssueOnly(row){return row?.hours===0&&!present(row.fuelUsed)&&!present(row.fuelActual)&&
    (typeof row.fuelMovementId==='string'&&row.fuelMovementId.trim()!==''||typeof row.fuelMovementId==='number'&&Number.isFinite(row.fuelMovementId));}
  function generatorSpent(generator,row){
    if(!row)return 0;
    if(present(row.fuelActual))return quantity(row.fuelActual);if(present(row.fuelUsed))return quantity(row.fuelUsed);
    if(generatorIssueOnly(row))return 0;
    const parameters=generatorParameters(generator,row);if(parameters===null)return null;
    const hours=quantity(row.hours);if(!generator||!hours)return 0;const rate=generatorRate(parameters,row);
    return rate===null?(own(generator,'fuelNorms')?null:0):generatorRounded(decimal().mul(rate,hours));
  }
  function generatorNormSpent(generator,row){
    if(!generator||!row)return 0;if(present(row.fuelUsed))return quantity(row.fuelUsed);
    if(generatorIssueOnly(row))return 0;
    const parameters=generatorParameters(generator,row);if(parameters===null)return null;
    const hours=quantity(row.hours);if(!hours)return 0;
    const rate=present(row.load)?generatorRate(parameters,row):null;
    if(rate!==null)return generatorRounded(decimal().mul(rate,hours));
    const flat=present(parameters.norm)?number(parameters.norm):number(parameters.norm100);
    return Number.isFinite(flat)?generatorRounded(decimal().mul(flat,hours)):(own(generator,'fuelNorms')?null:0);
  }
  function generatorNormKnown(generator,row){
    if(!generator||!row)return false;if(present(row.fuelUsed)&&Number.isFinite(number(row.fuelUsed)))return true;
    if(generatorIssueOnly(row))return true;
    const parameters=generatorParameters(generator,row);return parameters!==null&&(Number.isFinite(number(parameters.norm))||Number.isFinite(number(parameters.norm100)));
  }
  function assetBalances(db,ref){
    const target=asset(db,ref),vehicle=String(ref).startsWith('v:'),section=vehicle?'records':'genRecords',assetField=vehicle?'vehicleId':'generatorId';
    const boundary=accounting(vehicle?'vehicles':'generators',target);
    const records=rows(db,section).filter(row=>(target?row[assetField]===target.id:String(row[assetField])===String(ref).slice(2))&&dateValid(row.date)&&(boundary.mode!=='explicit'||row.date>=boundary.from)).slice().sort((a,b)=>a.date.localeCompare(b.date));
    const d=decimal(),balances=new Map(),byId=new Map(),value=input=>present(input)?d.parse(input):'0';
    for(const record of records){const key=idKey(record.id),peers=byId.get(key)||[];peers.push(record);byId.set(key,peers);}
    let opening='0',known=!!target;try{opening=value(boundary.mode==='explicit'?boundary.opening:target?.fuelBalance);}catch{known=false;}
    // Trusted reversals must not use the rounded journal presentation. Preserve
    // its family/order/measurement rules while retaining exact persisted facts.
    if(vehicle){
      const engine=getFuel();if(!engine||typeof engine.fqRecord!=='function'||typeof engine.fqMeasurementPlan!=='function')throw Error('Не загружено ядро расчёта ГСМ для проверки сторно');
      const familyBalances=new Map([[engine.fqFuelFamily(engine.vehicleFuelGrade(target)),opening]]),sources=boundary.mode==='explicit'?boundary.sources:target?.fuelBalanceSources,unknownFamilies=new Set();
      if(Array.isArray(sources)&&sources.length){try{if(d.compare(d.sum(sources.map(source=>value(source.qty))),opening)===0){familyBalances.clear();for(const source of sources){const family=engine.fqRecordFuelFamily({fuelGrade:source.grade},target);familyBalances.set(family,d.add(familyBalances.get(family)||'0',value(source.qty)));}}}catch{known=false;}}
      const {keyFor,lastOnDate,measurements}=engine.fqMeasurementPlan(records,target);
      for(const record of records){
        const fuel=engine.fqRecord(record,target),family=engine.fqRecordFuelFamily(record,target);let balance=familyBalances.get(family)||'0';
        if(fuel.driving==null&&quantity(record.km)>0)unknownFamilies.add(family);
        try{const driving=present(record.fuelActual)?record.fuelActual:present(record.fuelUsed)?record.fuelUsed:fuel.driving,spent=d.add(value(driving),value(record.fuelIdle));balance=d.sub(d.add(balance,value(record.fuelIssued)),spent);const key=keyFor(record);if(lastOnDate.get(key)===record.id&&measurements.has(key)){balance=value(measurements.get(key).tankMeasured);unknownFamilies.delete(family);}}catch{unknownFamilies.add(family);}
        familyBalances.set(family,balance);balances.set(record,known&&!unknownFamilies.size?d.sum([...familyBalances.values()]):null);
      }
      return {records,balances,byId};
    }
    let balance=opening;
    for(const record of records){let spent=present(record.fuelActual)?record.fuelActual:present(record.fuelUsed)?record.fuelUsed:generatorSpent(target,record);if(!present(record.fuelActual)&&!present(record.fuelUsed)&&quantity(record.hours)>0){const parameters=generatorParameters(target,record);if(parameters===null||generatorRate(parameters,record)===null)spent=null;}if(spent===null)known=false;try{if(known)balance=d.sub(d.add(balance,value(record.fuelIssued)),value(spent));}catch{known=false;}balances.set(record,known?balance:null);}return {records,balances,byId};
  }
  // Compare only facts used by fuel calculations. Legacy malformed settings
  // remain repairable during descriptive edits; they cannot authorize a new
  // fuel calculation by silently falling back to the old opening balance.
  function changedFuelRows(previous,next,section,fields){
    const project=row=>stable(Object.fromEntries(['id',...fields].map(field=>[field,row[field]])));
    const unmatched=new Map();
    for(const row of rows(previous,section)){const key=project(row);if(!unmatched.has(key))unmatched.set(key,[]);unmatched.get(key).push(row);}
    const changed=[];
    for(const row of rows(next,section)){const peers=unmatched.get(project(row));if(peers?.length)peers.pop();else changed.push({row,current:true});}
    for(const peers of unmatched.values())for(const row of peers)changed.push({row,current:false});
    return changed;
  }
  function accountingContextIssues(previous,next){
    if(!['vehicles','generators','tanks'].some(section=>rows(previous,section).some(row=>own(row,'fuelAccounting'))||rows(next,section).some(row=>own(row,'fuelAccounting'))))return [];
    const issues=[],seen=new Set(),states=new Map();
    const state=(section,id)=>{const key=section+':'+idKey(id);if(!states.has(key)){const row=find(next,section,id);states.set(key,{row,boundary:accountingState(section,row)});}return states.get(key);};
    const invalid=(section,id,origin)=>{
      const entry=state(section,id);if(entry.boundary.mode!=='invalid')return;
      const key=section+':'+idKey(id);if(seen.has(key))return;seen.add(key);
      issues.push({severity:'error',section,recordId:id??'',code:'FUEL_ACCOUNTING_CONTEXT_INVALID',field:'fuelAccounting',message:'Сначала исправьте начало учёта топлива: '+entry.boundary.error.message,relatedRecordId:origin.id??''});
    };
    const referenced=(row,section,field)=>{if(present(row[field]))invalid(section,row[field],row);};
    const movementAssets=row=>{
      const entries=[['tanks',row.fromTankId],['tanks',row.toTankId]];
      const target=asset(next,row.assetRef);if(target)entries.push([String(row.assetRef).startsWith('v:')?'vehicles':'generators',target.id]);
      return entries.filter(([,id])=>present(id));
    };
    const specs={
      records:['vehicleId','date','km','fuelIssued','fuelActual','fuelUsed','fuelIdle','tankMeasured','fuelGrade','fuelOrg','fuelMovementId'],
      genRecords:['generatorId','tankId','date','hours','load','fuelIssued','fuelActual','fuelUsed','fuelMovementId'],
      tankIncomes:['tankId','date','amount','liters','litres','qty','kind','deleted','cancelled'],
      fuelMovements:['fromTankId','toTankId','assetRef','recordId','date','qty','kind','deleted','cancelled','originalMovementId','reversedBy'],
    };
    for(const [section,fields]of Object.entries(specs))for(const change of changedFuelRows(previous,next,section,fields)){
      const row=change.row;
      if(section==='records')referenced(row,'vehicles','vehicleId');
      else if(section==='genRecords'){referenced(row,'generators','generatorId');invalid('tanks',recordTank(change.current?next:previous,row),row);}
      else if(section==='tankIncomes')referenced(row,'tanks','tankId');
      else for(const [target,id]of movementAssets(row)){
        invalid(target,id,row);
        const boundary=state(target,id).boundary;
        if(change.current&&live(row)&&dateValid(row.date)&&boundary.mode==='explicit'&&row.date<boundary.from)
          issues.push({severity:'error',section:'fuelMovements',recordId:row.id??'',code:'FUEL_BEFORE_ACCOUNTING',field:'date',date:row.date,message:'Дата нового движения топлива раньше начала учёта источника или получателя',proof:[target,id,boundary.from,row.date]});
      }
    }
    for(const [section,fields]of Object.entries({vehicles:['fuelAccounting','fuelBalance','fuelBalanceSources','fuel','fuelGrade','norm','normCity','normHighway','normIdle','org','orgHistory'],generators:['fuelAccounting','fuelBalance','fuel','fuelGrade','power','norm','norm100','norm50','normIdle','tankId'],tanks:['fuelAccounting','balanceInit','fuel','fuelGrade']}))
      for(const {row}of changedFuelRows(previous,next,section,fields))invalid(section,row.id,row);
    return issues;
  }
  function validateChanges(previous,next){
    const issues=[],oldIssues=analyze(previous),current=analyze(next),signature=issue=>stable([issue.section,issue.recordId,issue.code,issue.field,issue.proof]);
    const existing=new Set(oldIssues.map(signature));
    issues.push(...current.filter(issue=>issue.code!=='FUEL_STOCK_DEFICIT'&&!existing.has(signature(issue))));
    issues.push(...accountingContextIssues(previous,next));
    const beforeTimelines=tankTimeline(previous),afterTimelines=tankTimeline(next);
    for(const [key,timeline]of afterTimelines){const before=beforeTimelines.get(key),dates=[...new Set([...(before?.events.keys()||[]),...timeline.events.keys()])].sort(),oldBalances=balancesAt(before,dates),newBalances=balancesAt(timeline,dates);for(const day of dates){const value=newBalances.get(day),old=oldBalances.get(day);if(value!==null&&decimal().compare(value,0)<0&&(old===null||decimal().compare(value,old)<0))issues.push({severity:'error',section:'tanks',recordId:timeline.tank.id??'',code:'FUEL_STOCK_DEFICIT',field:'balance',date:day,deficit:-Number(value),deficitDecimal:decimal().sub(0,value),message:'Операция создаёт или увеличивает нехватку топлива в ёмкости на '+day});}}
    const oldMovements=new Map(rows(previous,'fuelMovements').map(row=>[idKey(row.id),row]));
    for(const movement of rows(next,'fuelMovements'))if(present(movement.fromTankId)&&number(movement.qty)>0&&stable(oldMovements.get(idKey(movement.id)))!==stable(movement)){
      const timeline=afterTimelines.get(idKey(movement.fromTankId));if(!timeline||timeline.entry.status!=='known')issues.push({severity:'error',section:'fuelMovements',recordId:movement.id??'',code:'FUEL_STOCK_UNKNOWN',field:'fromTankId',message:'Нельзя выдать или переместить топливо: источник запаса требует сверки'});
    }
    const protectedFields=['fuelIssued','fuelMovementId','date','vehicleId','generatorId','tankId','fuelGrade','fuelOrg','fuelProvider','fuelSourceSnapshot','originalFuelIssued','reversalId','reversedAt'];
    for(const section of ['records','genRecords'])for(const before of rows(previous,section))if(present(before.fuelMovementId)){
      const after=find(next,section,before.id),movement=find(next,'fuelMovements',before.fuelMovementId),oldMovement=find(previous,'fuelMovements',before.fuelMovementId);
      if(!after){issues.push({severity:'error',section,recordId:before.id??'',code:'FUEL_JOURNAL_DELETE',field:'id',message:'Связанный приход нельзя удалить отдельно от исходного движения'});continue;}
      const changed=protectedFields.filter(field=>stable(before[field])!==stable(after[field]));
      const reversal=movement?.reversedBy&&!oldMovement?.reversedBy&&after.reversalId===movement.reversedBy;
      const allowed=reversal?new Set(['fuelIssued','originalFuelIssued','reversalId','reversedAt']):new Set();
      if(changed.some(field=>!allowed.has(field)))issues.push({severity:'error',section,recordId:before.id??'',code:'FUEL_JOURNAL_FROZEN',field:changed.join(','),message:'Источник, дата и литры связанного прихода защищены. Исправьте выдачу согласованным сторно'});
    }
    for(const movement of rows(next,'fuelMovements'))if(present(movement.originalMovementId)&&!find(previous,'fuelMovements',movement.id)){
      const original=find(next,'fuelMovements',movement.originalMovementId);
      if(!original?.assetRef||original.kind!=='issue')continue;
      const after=assetBalances(next,original.assetRef),before=assetBalances(previous,original.assetRef);
      for(const record of after.records)if(record.date>=original.date&&after.balances.get(record)===null)issues.push({severity:'error',section:String(original.assetRef).startsWith('v:')?'records':'genRecords',recordId:record.id??'',code:'FUEL_REVERSAL_ASSET_UNKNOWN',field:'fuelIssued',message:'Нельзя доказать остаток после сторно: нет нормы или факта расхода на '+record.date,date:record.date});
      for(const record of after.records){const value=after.balances.get(record),peers=before.byId.get(idKey(record.id))||[],old=peers.length===1?before.balances.get(peers[0]):null;if(record.date>=original.date&&value!==null&&value!==undefined&&decimal().compare(value,0)<0&&(old==null||decimal().compare(value,old)<0))issues.push({severity:'error',section:String(original.assetRef).startsWith('v:')?'records':'genRecords',recordId:record.id??'',code:'FUEL_REVERSAL_ASSET_DEFICIT',field:'fuelIssued',message:'Сторно создаёт нехватку топлива у техники на '+record.date,date:record.date});}
    }
    if(issues.length){const error=new Error(issues.slice(0,5).map(issue=>issue.message).join('; '));error.name='FuelMovementPolicyError';error.code='POLICY_VIOLATION';error.issues=issues;error.details={issues};throw error;}
    return true;
  }
  return Object.freeze({apiVersion:1,inspect,validateChanges,generatorSpent,generatorNormSpent,generatorNormKnown,isValidReversal});
});
