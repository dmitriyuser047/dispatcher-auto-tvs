/* Reviewable catalog aliasing. Physical facts and historical identities are never merged. */
(function(root,factory){'use strict';if(typeof module==='object'&&module.exports)module.exports=factory(require('./platform-schema.js'),require('./entity-identity.js'),require('./reference-graph.js'),()=>require('./platform-kernel.js'),()=>require('./writeoff-engine.js'),()=>require('./fuel-engine.js'));else root.MergeCatalog=factory(root.PlatformSchema,root.EntityIdentity,root.ReferenceGraph,()=>root.PlatformKernel,()=>root.TvsWriteoffEngine,()=>root.TvsFuelEngine);})(typeof globalThis==='object'?globalThis:this,function(schema,identity,graph,getKernel,getWriteoff,getFuel){
 'use strict';
 const catalogSections=Object.freeze(['vehicles','generators','tanks','drivers','parts','contragents','fuelCards']),own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key),clone=value=>JSON.parse(JSON.stringify(value));
 function fail(code,message,issues){throw Object.assign(Error(message),{name:'CatalogMergeError',code,status:400,...(issues?{issues,details:{issues}}:{})});}
 function dependencies(){if(schema?.apiVersion!==1||identity?.apiVersion!==1||graph?.apiVersion!==1)fail('MODULE_UNAVAILABLE','Не загружены типизированные справочники и граф связей');}
 function plain(value){if(value===null||typeof value!=='object'||Array.isArray(value))return false;const prototype=Object.getPrototypeOf(value);return prototype===null||typeof prototype==='object'&&prototype!==null&&Object.getPrototypeOf(prototype)===null;}
 function fields(value,allowed){if(!plain(value))fail('INVALID_MERGE','Нужны параметры объединения');for(const key of Reflect.ownKeys(value)){const descriptor=Object.getOwnPropertyDescriptor(value,key);if(typeof key!=='string'||!allowed.includes(key)||!descriptor?.enumerable||descriptor.get||descriptor.set)fail('INVALID_MERGE','Недопустимые поля объединения');}}
 function input(value,requireFingerprint=false){
  fields(value,['section','sourceId','targetId','reason','mutableRefs','reviewFingerprint']);
  if(!catalogSections.includes(value.section)||!identity.identifier(value.sourceId)||!identity.identifier(value.targetId)||value.sourceId===value.targetId)fail('INVALID_MERGE','Выберите две разные карточки одного справочника');
  if(typeof value.reason!=='string'||!value.reason.trim()||value.reason.length>4000)fail('INVALID_MERGE','Укажите основание объединения');
  if(!Array.isArray(value.mutableRefs)||value.mutableRefs.length>1000)fail('INVALID_MERGE','Некорректный список переносимых связей');
  const selected=[],seen=new Set();for(let index=0;index<value.mutableRefs.length;index++){
   const descriptor=Object.getOwnPropertyDescriptor(value.mutableRefs,String(index));if(!descriptor||descriptor.get||descriptor.set)fail('INVALID_MERGE','Пропуски и исполняемые ссылки недопустимы');const ref=descriptor.value;fields(ref,['relationId','rowId','path']);
   if(typeof ref.relationId!=='string'||ref.relationId.length>500||typeof ref.path!=='string'||!ref.path||ref.path.length>1000||!identity.identifier(ref.rowId))fail('INVALID_MERGE','Неверная выбранная связь');
   const item={relationId:ref.relationId,rowId:ref.rowId,path:ref.path},key=JSON.stringify([item.relationId,typeof item.rowId,item.rowId,item.path]);if(seen.has(key))fail('INVALID_MERGE','Одна связь выбрана несколько раз');seen.add(key);selected.push(item);
  }
  selected.sort((a,b)=>{const left=JSON.stringify([a.relationId,typeof a.rowId,a.rowId,a.path]),right=JSON.stringify([b.relationId,typeof b.rowId,b.rowId,b.path]);return left<right?-1:left>right?1:0;});
  if(requireFingerprint&&(typeof value.reviewFingerprint!=='string'||!/^sha256:[a-f0-9]{64}$/.test(value.reviewFingerprint)))fail('REVIEW_REQUIRED','Сначала проверьте полный план объединения');
  return {section:value.section,sourceId:value.sourceId,targetId:value.targetId,reason:value.reason.trim(),mutableRefs:selected,...(value.reviewFingerprint===undefined?{}:{reviewFingerprint:value.reviewFingerprint})};
 }
 function footprint(value){dependencies();const request=input(value),names=new Set([request.section]);for(const selected of request.mutableRefs){const relation=schema.relations.find(item=>item.id===selected.relationId);if(!relation)fail('INVALID_MERGE','Выбрана связь вне общего реестра');names.add(relation.from);}return [...names].sort();}
 const refKey=ref=>JSON.stringify([ref.relationId,typeof ref.rowId,ref.rowId,ref.path]);
 const matches=(ref,section,id)=>ref.target?.section===section&&ref.target.id===id||ref.candidates?.some(target=>target.section===section&&target.id===id)||!ref.target&&!(ref.candidates?.length)&&ref.targetSection===section&&identity.identifier(ref.targetId)&&String(ref.targetId)===String(id);
 function title(row){return [row.plate,row.name,row.number,row.make].find(value=>typeof value==='string'&&value.trim())||String(row.id);}
 function context(value){if(!plain(value)||typeof value.today!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value.today))fail('INVALID_CONTEXT','Укажите дату проверки объединения');return value;}
 function registrySnapshot(value){
  if(!plain(value))fail('INVALID_GRAPH','Нужны разделы базы');const result={};
  for(const name of schema.sections){const descriptor=Object.getOwnPropertyDescriptor(value,name);if(descriptor?.get||descriptor?.set)fail('INVALID_GRAPH','Исполняемый раздел базы недопустим');result[name]=descriptor?.value??[];}
  return result;
 }
 function physicalBlock(db,request,source){
  if(!['vehicles','generators','tanks','parts'].includes(request.section))return null;
  const field=request.section==='tanks'?'balanceInit':'fuelBalance',raw=own(source,'fuelAccounting')?source.fuelAccounting?.opening:source[field];
  if(raw!=null&&raw!==''&&(typeof raw!=='number'||!Number.isFinite(raw)||raw!==0))return {code:'PHYSICAL_CARRY',message:'В исходной карточке есть остаток или неподтверждённое начальное значение. Сначала выполните отдельную физическую сверку; объединение не переносит и не складывает остатки.'};
  const refs=({vehicles:[['records','vehicleId'],['fuelPurchases','vehicleId']],generators:[['genRecords','generatorId']],tanks:[['tankIncomes','tankId'],['genRecords','tankId'],['fuelMovements','fromTankId'],['fuelMovements','toTankId']],parts:[['partMovements','partId']]})[request.section];
  if(request.section==='tanks'&&(db.genRecords||[]).some(record=>!own(record,'tankId')&&(db.generators||[]).some(generator=>generator.id===record.generatorId&&generator.tankId===request.sourceId)))return {code:'PHYSICAL_HISTORY_REQUIRES_REVIEW',message:'Старые записи ДЭС наследуют исходную ёмкость без собственной ссылки. Сначала подтвердите их исторические источники отдельной сверкой; объединение не перенаправляет старые выдачи.'};
  if(refs.some(([section,field])=>(db[section]||[]).some(row=>row[field]===request.sourceId&&!row.deleted&&!row.cancelled)))return {code:'PHYSICAL_HISTORY_REQUIRES_REVIEW',message:'У исходной карточки есть история топлива или складских движений. Она сохраняется отдельно; перед объединением нужна отдельная физическая сверка и подтверждённое исправление.'};
  return null;
 }
 function compatibility(section,source,target){
  const blockers=[],warnings=[],text=value=>typeof value==='string'?value.trim().replace(/\s+/g,' ').toUpperCase():'';
  if(section==='parts'){
   const left=text(source.unit),right=text(target.unit);if(left&&right&&left!==right)blockers.push({code:'INCOMPATIBLE_UNIT',field:'unit',message:'Единицы измерения номенклатуры различаются. Сначала подтвердите совместимые единицы; объединение не пересчитывает количество.'});
   else if(left!==right)warnings.push({code:'UNKNOWN_UNIT',field:'unit',message:'У одной карточки не указана единица измерения. Она не подставляется и не копируется автоматически; подтвердите номенклатуру перед дальнейшими операциями.'});
  }
  for(const field of section==='contragents'?['inn']:section==='vehicles'?['vin']:section==='generators'?['serial']:[]){if(text(source[field])&&text(target[field])&&text(source[field])!==text(target[field]))blockers.push({code:'INCOMPATIBLE_CATALOG_METADATA',field,message:'Идентифицирующий реквизит «'+field+'» различается. Сначала отдельно подтвердите, что карточки описывают один объект.'});}
  if(['vehicles','generators','tanks'].includes(section)){
   const fuel=getFuel();if(fuel?.apiVersion!==1)fail('MODULE_UNAVAILABLE','Не загружена проверка видов топлива');
   const describe=row=>{const grade=fuel.parseFuelGrade(row.fuelGrade),scalar=['diesel','gasoline','gas'].includes(row.fuel)?row.fuel:null,family=grade?fuel.fuelTypeFromGrade(grade):scalar;return {grade,family,contradiction:grade&&scalar&&family!==scalar};},left=describe(source),right=describe(target);
   if(left.contradiction||right.contradiction)blockers.push({code:'INCONSISTENT_FUEL_METADATA',field:'fuelGrade',message:'В одной карточке вид топлива противоречит марке. Сначала отдельно исправьте подтверждённые реквизиты.'});
   else if(left.family&&right.family&&left.family!==right.family||left.grade&&right.grade&&left.grade!==right.grade)blockers.push({code:'INCOMPATIBLE_FUEL',field:'fuelGrade',message:'Вид или марка топлива различаются. Объединение не меняет физическое топливо и его назначение.'});
   else if(left.family!==right.family||left.grade!==right.grade)warnings.push({code:'UNKNOWN_FUEL_METADATA',field:'fuelGrade',message:'Топливные реквизиты заданы неполно. Значения основной карточки не заменяют исходные факты архивного дубля.'});
  }
  const fields=section==='vehicles'?['fuelAccounting','fuelNorms','orgHistory']:section==='generators'?['power','fuelAccounting','fuelNorms']:section==='tanks'?['capacity','fuelAccounting']:section==='fuelCards'?['orgHistory','assignments']:section==='drivers'?['personnelRoles']:[];
  const different=fields.filter(field=>JSON.stringify(source[field])!==JSON.stringify(target[field]));if(different.length)warnings.push({code:'CATALOG_METADATA_RETAINED',fields:different,message:'Параметры карточек различаются. Они не копируются и не складываются; история сохраняет исходную карточку, выбранные будущие связи используют основную.'});
  return {blockers,warnings};
 }
 function setPath(row,path,value){const tokens=path.match(/[A-Za-z_$][\w$]*|\d+/g)||[];let parent=row;for(let index=0;index<tokens.length-1;index++){if(['__proto__','constructor','prototype'].includes(tokens[index]))fail('INVALID_MERGE','Небезопасный путь связи');parent=parent[tokens[index]];if(parent===null||typeof parent!=='object')fail('STALE_REVIEW','Структура выбранной связи изменилась');}const last=tokens.at(-1);if(!last||['__proto__','constructor','prototype'].includes(last))fail('INVALID_MERGE','Небезопасный путь связи');parent[last]=value;}
 function changes(db,request,source,references,metadata){
  const sections={};for(const name of footprint(request))sections[name]=clone(db[name]||[]);
  const candidates=sections[request.section].filter(row=>row.id===request.sourceId);if(candidates.length!==1)fail('AMBIGUOUS_ENTITY','Исходная карточка неоднозначна');
  Object.assign(candidates[0],{archived:true,archivedAt:metadata.now,mergedInto:{version:1,section:request.section,id:request.targetId,reason:request.reason,at:metadata.now,actor:{id:metadata.actor.id,name:metadata.actor.name,role:metadata.actor.role},operationId:metadata.id}});
  for(const selected of request.mutableRefs){
   const ref=references.find(item=>refKey(item)===refKey(selected));if(!ref||!ref.mutable||!matches(ref,request.section,request.sourceId))fail('INVALID_MERGE_SELECTION','Выбрана неизменяемая или уже другая связь');
   const rows=sections[ref.section].filter(row=>row.id===ref.rowId);if(rows.length!==1)fail('AMBIGUOUS_ENTITY','Запись выбранной связи не имеет единственного типизированного ID');
   const relation=schema.relations.find(item=>item.id===ref.relationId),replacement=relation.kind==='assetRef'?identity.assetRef(db,request.section,request.targetId):request.targetId;setPath(rows[0],ref.path,replacement);
  }
  return sections;
 }
 function preview(database,value,options={}){
  dependencies();const request=input(value),ctx=context(options),db=registrySnapshot(database),report=graph.inspect(db,ctx),blockers=[],warnings=[];
  const records=db[request.section]||[],sources=records.filter(row=>row.id===request.sourceId),targets=records.filter(row=>row.id===request.targetId);
  if(sources.length!==1||targets.length!==1)fail(sources.length>1||targets.length>1?'AMBIGUOUS_ENTITY':'ENTITY_NOT_FOUND','Выберите единственные существующие типизированные карточки');
  const source=sources[0],target=targets[0],references=report.references.filter(ref=>matches(ref,request.section,request.sourceId)||matches(ref,request.section,request.targetId)||ref.section===request.section&&(ref.rowId===request.sourceId||ref.rowId===request.targetId));
  if(source.deleted||source.archived||own(source,'mergedInto'))blockers.push({code:'SOURCE_NOT_ACTIVE',message:'Исходная карточка уже архивная или является ссылкой. Сначала проверьте её историю.'});
  if(target.deleted||target.archived||own(target,'mergedInto'))blockers.push({code:'TARGET_NOT_ACTIVE',message:'Основная карточка должна быть действующей и самостоятельной.'});
  if(records.some(row=>row.mergedInto?.section===request.section&&row.mergedInto.id===request.sourceId))blockers.push({code:'SOURCE_HAS_ALIASES',message:'На исходную основную карточку уже ссылаются архивные дубли. Цепочка объединений не создаётся; выберите её основной карточкой.'});
  if(['vehicles','generators','tanks'].includes(request.section))for(const row of [source,target])try{identity.assetRef(db,request.section,row.id);}catch(error){blockers.push({code:error.code,message:error.message});}
  const relevant=new Set(references.map(ref=>JSON.stringify([ref.relationId,ref.section,ref.rowId,ref.path])));
  for(const issue of report.issues)if(issue.severity==='error'&&relevant.has(JSON.stringify([issue.relationId,issue.section,issue.rowId,issue.path])))blockers.push({...issue});
  const physical=physicalBlock(db,request,source);if(physical)blockers.push(physical);
  const compatible=compatibility(request.section,source,target);blockers.push(...compatible.blockers);warnings.push(...compatible.warnings);
  const selected=new Set(request.mutableRefs.map(refKey));
  for(const choice of request.mutableRefs){const ref=references.find(item=>refKey(item)===refKey(choice));if(!ref||!ref.mutable||!matches(ref,request.section,request.sourceId))blockers.push({code:'INVALID_MERGE_SELECTION',message:'Перенос допускается только для явно выбранной черновой или будущей связи исходной карточки.',...choice});else if((db[ref.section]||[]).filter(row=>row.id===ref.rowId).length!==1)blockers.push({code:'AMBIGUOUS_ENTITY',message:'Выбранная связь не имеет единственного ID.',...choice});}
  if(request.section==='drivers')for(const ref of references.filter(item=>matches(item,request.section,request.sourceId)&&['assetAssignments','dispatchJobs','shiftReports'].includes(item.section))){const row=db[ref.section]?.[ref.rowIndex];const unfinished=ref.section==='dispatchJobs'?!['done','confirmed','cancelled'].includes(row?.status):ref.section==='shiftReports'?!['accepted','rejected'].includes(row?.status):!row?.to||row.to>=ctx.today;if(unfinished&&!row?.archived&&!row?.deleted&&!selected.has(refKey(ref)))blockers.push({code:'PERSONNEL_STILL_ASSIGNED',message:'Сначала завершите действующее назначение, задание или непринятую смену сотрудника либо явно выберите допустимую будущую связь.',relationId:ref.relationId,rowId:ref.rowId,path:ref.path});}
  for(const ref of references)if(matches(ref,request.section,request.sourceId)&&!selected.has(refKey(ref)))warnings.push({code:'REFERENCE_RETAINED',classification:ref.classification,relationId:ref.relationId,rowId:ref.rowId,path:ref.path,message:'Ссылка останется на исходную архивную карточку; исходный факт и история не изменяются.'});
  if(!blockers.length&&(db.fuelWriteoffs||[]).some(doc=>doc.status==='posted')){
   const writeoff=getWriteoff();if(writeoff?.apiVersion!==1)fail('MODULE_UNAVAILABLE','Не загружена защита проведённых актов');
   try{const sections=changes(db,request,source,references,{id:'merge-preview',now:ctx.today+'T12:00:00.000Z',actor:{id:'preview',name:'Preview',role:'preview'}});writeoff.validateDocuments(db,{...db,...sections});}catch(error){blockers.push({code:error.code||'POSTED_SOURCE_LOCKED',message:'Объединение затрагивает источник проведённого акта. Сначала проверьте защищённый документ; его данные и отпечаток не обходятся.'});}
  }
  const kernel=getKernel();if(kernel?.apiVersion!==1)fail('MODULE_UNAVAILABLE','Не загружен расчёт отпечатка плана');
  const intent={section:request.section,sourceId:request.sourceId,targetId:request.targetId,reason:request.reason,mutableRefs:request.mutableRefs};
  const fingerprint=kernel.requestDigest({protocolVersion:1,base:{},command:{type:'MergeCatalogReview',version:1,input:intent,today:ctx.today,database:db,references:report.references}});
  return {apiVersion:1,source:{section:request.section,id:source.id,label:title(source)},target:{section:request.section,id:target.id,label:title(target)},references,blockers,warnings,fingerprint,canMerge:blockers.length===0,readSections:[...schema.sections],writeSections:footprint(request)};
 }
 function plan(database,value,options){
  const request=input(value,true),ctx=context(options),review=preview(database,request,ctx);if(request.reviewFingerprint!==review.fingerprint)fail('STALE_REVIEW','Данные или план изменились после просмотра. Проверьте полный план заново');if(!review.canMerge)fail('CATALOG_MERGE_BLOCKED','План объединения содержит препятствия',review.blockers);
  if(typeof ctx.id!=='string'||!/^[a-zA-Z0-9._:-]{1,200}$/.test(ctx.id)||typeof ctx.now!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(ctx.now)||!Number.isFinite(Date.parse(ctx.now))||ctx.now.slice(0,10)!==ctx.today||!plain(ctx.actor)||typeof ctx.actor.id!=='string'||!ctx.actor.id.trim()||typeof ctx.actor.name!=='string'||!ctx.actor.name.trim()||ctx.actor.role!=='admin')fail('INVALID_CONTEXT','Нужны идентификатор операции, время и доверенный автор-администратор');
  const source=database[request.section].find(row=>row.id===request.sourceId),sections=changes(database,request,source,review.references,ctx);
  return {sections,readSections:review.readSections,writeSections:review.writeSections,entityIds:{sourceId:request.sourceId,targetId:request.targetId},reviewFingerprint:review.fingerprint};
 }
 return Object.freeze({apiVersion:1,catalogSections,footprint,preview,plan});
});
