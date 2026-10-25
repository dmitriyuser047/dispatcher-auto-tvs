/* Complete, read-only reference inventory. It never resolves an alias or rewrites evidence. */
(function(root,factory){'use strict';if(typeof module==='object'&&module.exports)module.exports=factory(require('./platform-schema.js'),require('./entity-identity.js'));else root.ReferenceGraph=factory(root.PlatformSchema,root.EntityIdentity);})(typeof globalThis==='object'?globalThis:this,function(schema,identity){
 'use strict';
 const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key),catalogSections=Object.freeze(['vehicles','generators','tanks','drivers','parts','contragents','fuelCards']);
 // Stock ownership and maintenance revisions are changed by their own reviewed
 // operations, never by moving references during a catalogue merge.
 const pinned=new Set(['records','genRecords','toRecords','tankIncomes','vehicleTo','repairs','reestrRows','payments','budget','fuelPurchases','fuelImports','fuelPeriods','monthlyFuel','fuelMovements','parts','partMovements','glonassTrips','glonassImports','costEntries','documentDrafts','generatorMaintenancePlans','inventoryOrgs','inventoryObjects','inventoryMols','inventoryItems','inventorySessions']);
 const historical=new Set(['auditLog','fuelWriteoffs','savedReestrs']);
 const operational=new Set(['dispatchJobs','assetAssignments','workOrders','opsTasks','assetDocuments','shiftReports','procurementOrders','procurementRules','generators','fuelCards','costProfiles','vehicles']);
 const aliases={vehicleId:'vehicles',cardVehicleId:'vehicles',generatorId:'generators',tankId:'tanks',fromTankId:'tanks',toTankId:'tanks',counterTankId:'tanks',driverId:'drivers',personId:'drivers',partId:'parts',contragentId:'contragents'};
 function fail(code,message){throw Object.assign(Error(message),{name:'ReferenceGraphError',code,status:400});}
 function dependencies(){if(schema?.apiVersion!==1||identity?.apiVersion!==1)fail('MODULE_UNAVAILABLE','Не загружены реестр связей и типизированные идентификаторы');}
 function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
 function plain(value){if(value===null||typeof value!=='object'||Array.isArray(value))return false;const prototype=Object.getPrototypeOf(value);return prototype===null||typeof prototype==='object'&&prototype!==null&&Object.getPrototypeOf(prototype)===null;}
 function copyJSON(value){
  const parents=new Set();let nodes=0,characters=0;
  function copy(item,depth){
   if(++nodes>1000000||depth>100)fail('GRAPH_LIMIT','Снимок слишком велик или глубоко вложен для контролируемого объединения');
   if(item===null||typeof item==='boolean')return item;
   if(typeof item==='string'){characters+=item.length;if(characters>67108864)fail('GRAPH_LIMIT','Превышен предел объёма снимка');return item;}
   if(typeof item==='number'&&Number.isFinite(item))return item;
   if(!Array.isArray(item)&&!plain(item)||parents.has(item))fail('INVALID_GRAPH','Для графа связей нужны обычные данные JSON без циклов');parents.add(item);
   const array=Array.isArray(item),out=array?[]:{};
   if(array&&item.length>200000)fail('GRAPH_LIMIT','Слишком много строк в одном списке');
   const keys=Reflect.ownKeys(item);for(const key of keys){
    if(array&&key==='length')continue;
    if(typeof key!=='string'||['__proto__','constructor','prototype'].includes(key)||array&&(!/^(?:0|[1-9]\d*)$/.test(key)||Number(key)>=item.length))fail('INVALID_GRAPH','Недопустимые поля снимка');
    const descriptor=Object.getOwnPropertyDescriptor(item,key);if(!descriptor?.enumerable||descriptor.get||descriptor.set)fail('INVALID_GRAPH','Исполняемые или скрытые поля снимка недопустимы');out[key]=copy(descriptor.value,depth+1);
   }
   if(array&&Object.keys(out).length!==item.length)fail('INVALID_GRAPH','Пропуски в массивах связей недопустимы');parents.delete(item);return out;
  }return copy(value,0);
 }
 function date(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const parsed=new Date(value+'T12:00:00Z');return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;}
 function context(value={}){const ctx=copyJSON(value);if(!plain(ctx)||!date(ctx.today))fail('INVALID_CONTEXT','Укажите действительную дату проверки связей');if(ctx.readable!=null&&(!Array.isArray(ctx.readable)||ctx.readable.some(name=>typeof name!=='string')))fail('INVALID_CONTEXT','Некорректные права чтения');if(Array.isArray(ctx.readable)&&!ctx.readable.includes('*')&&schema.sections.some(name=>!ctx.readable.includes(name)))fail('ACCESS_DENIED','Для полного плана объединения нужен доступ ко всем разделам');return ctx;}
 function database(value){const db=copyJSON(value);if(!plain(db))fail('INVALID_GRAPH','Нужен снимок разделов базы');for(const name of schema.sections){if(db[name]==null)db[name]=[];if(!Array.isArray(db[name])||db[name].some(row=>!plain(row)))fail('INVALID_GRAPH','Повреждён раздел '+name);}return db;}
 function values(row,field){
  const result=[],parts=field.split('.');
  function walk(value,index,path){if(index===parts.length){result.push({value,path});return;}if(value==null)return;if(!plain(value)){result.push({shape:true,value,path});return;}const token=parts[index],many=token.endsWith('[]'),name=many?token.slice(0,-2):token,current=path?path+'.'+name:name,child=value[name];if(many){if(child==null)return;if(!Array.isArray(child)){result.push({shape:true,value:child,path:current});return;}child.forEach((entry,position)=>walk(entry,index+1,current+'['+position+']'));}else walk(child,index+1,current);}
  walk(row,0,'');return result;
 }
 const normalizedCard=value=>typeof value==='string'||typeof value==='number'?String(value).replace(/\D/g,'')||String(value).trim().toUpperCase():'';
 function classification(section,row,path,today,genRecords){
  if(historical.has(section))return {classification:'historical',reason:'Историческое свидетельство сохраняется без изменений'};
  if(section==='drivers'&&/^personnelPlanning\.qualifications\[\d+\]\.documentId$/.test(path))return {classification:'pinned',reason:'Датированный допуск сохраняет явную связь с подтверждающим документом'};
  if(pinned.has(section)||row.archived||row.deleted||row.cancelled)return {classification:'pinned',reason:'Исходный факт или архивная запись сохраняет прежнюю ссылку'};
  let mutable=false;
  if(section==='dispatchJobs')mutable=['new','assigned'].includes(row.status)&&typeof row.start==='string'&&date(row.start.slice(0,10))&&row.start.slice(0,10)>=today&&!row.actualStart&&!row.actualEnd;
  else if(section==='assetAssignments')mutable=date(row.from)&&row.from>today&&!row.archived&&!row.deleted;
  else if(section==='workOrders')mutable=row.status==='new'&&!row.actualCost&&!row.downtimeFrom&&!row.downtimeTo;
  else if(section==='opsTasks')mutable=row.status==='open';
  else if(section==='shiftReports')mutable=row.status==='prepared'&&date(row.date)&&row.date>=today;
  else if(section==='procurementOrders')mutable=row.procurement?.mode!=='linked'&&row.status==='draft'&&!(row.receivedQty>0)&&!(row.stockPostedQty>0);
  else if(section==='procurementRules')mutable=true;
  else if(section==='generators'){
   if(path==='tankId'&&genRecords?.some(record=>record.generatorId===row.id&&!own(record,'tankId')))return {classification:'pinned',reason:'Старые записи ДЭС наследуют эту ёмкость: изменение привязки переподчинит историю',implicitTankHistory:true};
   mutable=path==='tankId';
  }
  else if(section==='fuelCards'){
   const index=/^assignments\[(\d+)\]\.vehicleId$/.exec(path),assignment=index?row.assignments?.[Number(index[1])]:null;mutable=!!assignment&&date(assignment.from)&&assignment.from>today;
  }
  // Documents, cost profiles and actual/current assignments carry historical
  // meaning. Relabelling them is a separate correction, not a catalog merge.
  if(!operational.has(section))return {classification:'pinned',reason:'Класс связи не описан: требуется отдельное решение',unclassified:true};
  return {classification:mutable?'mutable':'pinned',reason:mutable?'Будущая или черновая рабочая связь; перенос только по явному выбору':'Действующая или завершённая связь остаётся с исходной карточкой'};
 }
 function classify(section,value,path,today,database){
  dependencies();if(!schema.sections.includes(section)||typeof path!=='string'||!path||path.length>1000||!date(today))fail('INVALID_CONTEXT','Нужны раздел, путь и дата классификации связи');
  const row=copyJSON(value);if(!plain(row))fail('INVALID_GRAPH','Нужна исходная запись связи');let records;
  if(database!==undefined&&section==='generators'&&path==='tankId'){
   if(!plain(database))fail('INVALID_GRAPH','Нужна база исторических связей');const descriptor=Object.getOwnPropertyDescriptor(database,'genRecords');if(descriptor?.get||descriptor?.set)fail('INVALID_GRAPH','Исполняемая история ДЭС недопустима');records=copyJSON(descriptor?.value??[]);if(!Array.isArray(records))fail('INVALID_GRAPH','Повреждена история ДЭС');
  }
  return freeze(classification(section,row,path,today,records));
 }
 function inspect(input,options={}){
  dependencies();const ctx=context(options),db=database(input),references=[],issues=[],indexes=new Map(),seen=new Set();
  for(const section of schema.sections){const byId=new Map(),byString=new Map();db[section].forEach((row,index)=>{if(!identity.identifier(row.id))return;const key=identity.typedKey(section,row.id);if(!byId.has(key))byId.set(key,[]);byId.get(key).push({id:row.id,index});const text=String(row.id);if(!byString.has(text))byString.set(text,[]);byString.get(text).push({id:row.id,index});});indexes.set(section,{byId,byString});}
  function addIssue(code,ref,message,severity='error'){issues.push({code,severity,section:ref.section,rowId:ref.rowId,path:ref.path,relationId:ref.relationId,targetSection:ref.targetSection??null,targetId:identity.identifier(ref.targetId)?ref.targetId:null,message});}
  function push(ref){if(references.length>=100000)fail('GRAPH_LIMIT','Слишком много связей: объединение требует отдельной обработки');const key=JSON.stringify([ref.relationId,ref.section,ref.rowIndex,ref.path,ref.targetSection,ref.targetId]);if(seen.has(key))return;seen.add(key);references.push(ref);}
  for(const relation of schema.relations){
   for(const [rowIndex,row]of db[relation.from].entries())for(const entry of values(row,relation.field)){
    if(!identity.presentId(entry.value)&&!entry.shape)continue;
    const ref={relationId:relation.id,section:relation.from,rowId:identity.identifier(row.id)?row.id:null,rowIndex,path:entry.path,field:relation.field,value:identity.identifier(entry.value)?entry.value:null,...classification(relation.from,row,entry.path,ctx.today,db.genRecords),mutable:false};
    if(relation.kind==='lookup')Object.assign(ref,{classification:'advisory',reason:'Сопоставление по номеру не переписывается при объединении'});
    if(relation.kind==='historical')Object.assign(ref,{classification:'historical',reason:'Записанная история сохраняет исходную идентичность'});
    ref.mutable=ref.classification==='mutable';let targetSection=relation.target,targetId=entry.value,string=false,lookup=relation.kind==='lookup';
    if(entry.shape||!identity.identifier(entry.value)){push(ref);addIssue('INVALID_REFERENCE',ref,'Некорректная структура или тип идентификатора связи');continue;}
    if(relation.kind==='assetRef'){
     const resolved=identity.resolveAsset(db,entry.value,relation.targets);targetSection=resolved.section;targetId=typeof entry.value==='string'?entry.value.slice(2):entry.value;string=true;
    }else if(relation.kind==='discriminator'){const selector=relation.selectorAligned===true?schema.referenceSelector(row,relation,entry.path):values(row,relation.selector)[0]?.value,key=relation.prefix&&typeof selector==='string'?selector.split(':')[0]:selector;targetSection=relation.targets?.[key];}
    else if(relation.kind==='historical')targetSection=relation.target||(relation.selector?values(row,relation.selector)[0]?.value:undefined);
    else if(relation.kind!=='id'&&relation.kind!=='lookup'){push(ref);addIssue('UNCLASSIFIED_REFERENCE',ref,'Неизвестный вид связи');continue;}
    if(!schema.sections.includes(targetSection)){push(ref);if(relation.unknownPolicy!=='advisory'&&relation.kind!=='historical')addIssue('UNCLASSIFIED_REFERENCE',ref,'Не удалось определить раздел назначения связи');continue;}
    ref.targetSection=targetSection;ref.targetId=targetId;
    let candidates=lookup?db[targetSection].filter(target=>normalizedCard(target[relation.targetField])===normalizedCard(targetId)).map(target=>({id:target.id})):string?indexes.get(targetSection).byString.get(String(targetId))||[]:indexes.get(targetSection).byId.get(identity.typedKey(targetSection,targetId))||[];
    if(relation.kind==='historical'&&!candidates.length)candidates=indexes.get(targetSection).byString.get(String(targetId))||[];
    ref.candidates=candidates.filter(candidate=>identity.identifier(candidate.id)).map(candidate=>({section:targetSection,id:candidate.id}));
    if(candidates.length===1&&identity.identifier(candidates[0].id))ref.target={section:targetSection,id:candidates[0].id};
    else if(candidates.length!==1&&relation.kind!=='historical')addIssue(candidates.length?'AMBIGUOUS_REFERENCE':'MISSING_REFERENCE',ref,candidates.length?'Ссылка имеет несколько возможных карточек':'Связанная карточка не найдена',lookup?'warning':'error');
    if(ref.implicitTankHistory)addIssue('IMPLICIT_TANK_HISTORY',ref,'Сначала отдельно подтвердите исторические привязки ДЭС; объединение не меняет источник старых выдач');
    if(ref.mutable&&(!identity.identifier(ref.rowId)||(indexes.get(ref.section)?.byId.get(identity.typedKey(ref.section,ref.rowId))||[]).length!==1)){ref.classification='pinned';ref.mutable=false;ref.reason='У исходной записи нет единственного типизированного ID';addIssue('AMBIGUOUS_SOURCE_ROW',ref,'Сначала исправьте идентификатор записи, содержащей связь');}
    if(ref.unclassified)addIssue('UNCLASSIFIED_REFERENCE',ref,'Для этой связи не определён безопасный порядок обработки');push(ref);
   }
  }
  // Snapshot payloads and unregistered catalog-shaped fields must remain visible.
  // Historical copies are evidence. New unknown live links are blockers, not an
  // invitation to guess their meaning or silently leave them out of a preview.
  const registered=new Set(references.map(ref=>JSON.stringify([ref.section,ref.rowIndex,ref.path])));
  function supplemental(section,row,rowIndex,value,path,containerSection,proof,depth){
   if(depth>100||value===null||typeof value!=='object')return;
   if(Array.isArray(value)){value.forEach((child,index)=>supplemental(section,row,rowIndex,child,path+'['+index+']',containerSection,proof,depth+1));return;}
   for(const [key,child]of Object.entries(value)){
    const current=path?path+'.'+key:key,knownPath=registered.has(JSON.stringify([section,rowIndex,current]));let targetSection=aliases[key],targetId=child,legacyString=false;
    // These identifiers belong exclusively to the standalone inventory. Never
    // guess fleet, generator or spare-stock ownership from their values/names.
    if(section.startsWith('inventory'))targetSection=({orgId:'inventoryOrgs',objectId:'inventoryObjects',molId:'inventoryMols',itemId:'inventoryItems',sessionId:'inventorySessions',rootId:'inventorySessions',previousId:'inventorySessions'})[key]||targetSection;
    if(key==='id'&&catalogSections.includes(containerSection)&&path)targetSection=containerSection;
    if(key==='id'&&path.split('.').at(-1)==='mergedInto'&&catalogSections.includes(value.section))targetSection=value.section;
    if((key==='recordId'||key==='id'&&['before','after'].includes(path.split('.').at(-1)))&&schema.sections.includes(value.section||row.section))targetSection=value.section||row.section;
    if((key==='assetRef'||/AssetRef$/.test(key))&&typeof child==='string'){const resolved=identity.resolveAsset(db,child);targetSection=resolved.section;targetId=child.slice(2);legacyString=true;}
    if(!targetSection&&/Id$/.test(key)){const lower=key.toLowerCase();targetSection=/vehicle/.test(lower)?'vehicles':/generator/.test(lower)?'generators':/driver|person/.test(lower)?'drivers':/tank/.test(lower)?'tanks':/part/.test(lower)?'parts':/contragent/.test(lower)?'contragents':undefined;}
    const historicalPath=proof||['snapshot','personnelSnapshot','timeContext','before','after','sourceSnapshot','fuelSourceSnapshot','sourceTransaction','provenance'].includes(key),knownAlias=path.split('.').at(-1)==='mergedInto'&&key==='id'&&catalogSections.includes(value.section);
    if(!knownPath&&targetSection&&identity.identifier(targetId)){
     const candidates=legacyString?indexes.get(targetSection)?.byString.get(String(targetId))||[]:indexes.get(targetSection)?.byId.get(identity.typedKey(targetSection,targetId))||[];
     const ref={relationId:(knownAlias?'alias:':historicalPath||historical.has(section)?'history:':'unknown:')+section+'.'+current,section,rowId:identity.identifier(row.id)?row.id:null,rowIndex,path:current,field:current,value:child,targetSection,targetId,candidates:candidates.map(candidate=>({section:targetSection,id:candidate.id})),classification:historicalPath||historical.has(section)?'historical':'pinned',mutable:false,reason:knownAlias?'Неизменяемая связь архивного дубля с основной карточкой':historicalPath||historical.has(section)?'Неизменяемая копия исходной связи':'Связь вне реестра требует явного описания перед объединением',unclassified:!knownAlias&&!historicalPath&&!historical.has(section)};
     if(candidates.length===1)ref.target={section:targetSection,id:candidates[0].id};push(ref);if(ref.unclassified)addIssue('UNCLASSIFIED_REFERENCE',ref,'Обнаружена связь со справочником вне общего реестра');
    }
    if(child&&typeof child==='object')supplemental(section,row,rowIndex,child,current,schema.sections.includes(key)?key:containerSection,historicalPath,depth+1);
   }
  }
  for(const section of schema.sections)db[section].forEach((row,index)=>supplemental(section,row,index,row,'',null,historical.has(section),0));
  // Object property order is not a fact. In particular, renderer and storage
  // may retain different before/after key orders in the same historical row.
  // A review digest must never depend on that traversal order or host locale.
  const order=ref=>JSON.stringify([ref.relationId,ref.section,ref.rowIndex,ref.path,ref.targetSection??null,typeof ref.targetId,ref.targetId??null]);
  references.sort((a,b)=>{const left=order(a),right=order(b);return left<right?-1:left>right?1:0;});
  const counts={mutable:0,pinned:0,advisory:0,historical:0,total:references.length};references.forEach(ref=>counts[ref.classification]++);
  return freeze({apiVersion:1,references,issues,counts,relationCount:schema.relations.length});
 }
 return Object.freeze({apiVersion:1,catalogSections,inspect,classify});
});
