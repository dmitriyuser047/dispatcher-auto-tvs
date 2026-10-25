import type {Identifier,JsonRow,JsonValue,SectionRows} from './platform-contracts';
import type {DecimalCoreAPI} from './decimal-core';

export type AssetInventoryCatalogSection='inventoryOrgs'|'inventoryObjects'|'inventoryMols'|'inventoryItems';
export interface AssetInventoryNamedPayload {name:string;note:string}
export interface AssetInventoryMolPayload extends AssetInventoryNamedPayload {orgId:Identifier;objectId:Identifier;accountCode:string}
export interface AssetInventoryItemPayload extends AssetInventoryNamedPayload {molId:Identifier;code:string;unit:string;qty:number|null;cost:number|null}
export type AssetInventoryCatalogPayload=AssetInventoryNamedPayload|AssetInventoryMolPayload|AssetInventoryItemPayload;
export interface AssetInventoryPerson {name:string;position:string}
export interface AssetInventoryCommission {chairman:AssetInventoryPerson;members:AssetInventoryPerson[]}
export interface AssetInventoryFact {rowId:Identifier;qtyFact:number|null;costFact:number|null;action:''|'writeoff'|'transfer';note:string}
export interface AssetInventoryDraftPayload {date:string;title:string;note:string;commission:AssetInventoryCommission;facts:AssetInventoryFact[]}
export interface AssetInventoryCorrection {rowId:Identifier;unit:string;qtyAcct:number|null;costAcct:number|null}
export type AssetInventoryActionInput=
 |{action:'saveCatalog';section:AssetInventoryCatalogSection;id?:Identifier;payload:AssetInventoryCatalogPayload;reason:string;reviewFingerprint:string}
 |{action:'archiveCatalog';section:AssetInventoryCatalogSection;id:Identifier;reason:string;reviewFingerprint:string}
 |{action:'createSession';objectId:Identifier;orgId?:Identifier;date:string;title:string;reason:string;reviewFingerprint:string}
 |{action:'saveDraft';sessionId:Identifier;payload:AssetInventoryDraftPayload;reason:string;reviewFingerprint:string}
 |{action:'approve';sessionId:Identifier;date:string;document:string;reason:string;reviewFingerprint:string}
 |{action:'revise';sessionId:Identifier;reason:string;reviewFingerprint:string}
 |{action:'amendDraft';sessionId:Identifier;corrections:AssetInventoryCorrection[];reason:string;reviewFingerprint:string}
 |{action:'importLegacy';sourceId:string;sessionIds?:Identifier[];reason:string;reviewFingerprint:string}
 |{action:'importRows';sourceId:string;sessionIds?:Identifier[];reason:string;reviewFingerprint:string};
export interface AssetInventoryContext {id:string;now:string;today:string;actor:{id:string;name:string;role:string};readable?:string[];writable?:string[];importSource?:JsonRow}
export interface AssetInventoryIssue {severity:'error'|'warning';section:string;recordId:Identifier|null;code:string;message:string;field?:string;rowId?:Identifier}
export interface AssetInventoryResult {canApply:boolean;readSections:string[];writeSections:string[];sections:SectionRows;changed:{section:string;id:Identifier;type:'create'|'update'}[];issues:AssetInventoryIssue[];warnings:AssetInventoryIssue[];fingerprint:string;reviewFingerprint:string;session:JsonRow|null;entityIds:Record<string,Identifier>}
interface Contracts {apiVersion:number;identifier(value:unknown):value is Identifier;validateSections(value:unknown,names:readonly string[]):SectionRows;validateOperation(value:unknown):{id:string}}
interface Fingerprint {stableSerialize(value:unknown):string;sha256(value:string):string}
interface InventoryError extends Error {code:string;status:number;issues:AssetInventoryIssue[]}
interface BuiltInventory {sections:SectionRows;changed:AssetInventoryResult['changed'];session:JsonRow|null;entityIds:Record<string,Identifier>;issues:AssetInventoryIssue[];warnings:AssetInventoryIssue[]}
const CATALOGS=['inventoryOrgs','inventoryObjects','inventoryMols','inventoryItems'] as const;
const SESSION='inventorySessions';
const SECTIONS=[...CATALOGS,SESSION] as const;

/** Independent property counting. No fleet, stock movement, finance, filesystem,
 * database or wall-clock API belongs to this model. */
export function createAssetInventory(contracts:Contracts,decimal:DecimalCoreAPI,fingerprint:Fingerprint){
 const own=(value:object,key:PropertyKey):boolean=>Object.prototype.hasOwnProperty.call(value,key);
 const object=(value:unknown):value is JsonRow=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 function fail(code:string,message:string,issues:AssetInventoryIssue[]=[]):never {const error=new Error(message) as InventoryError;error.name='AssetInventoryError';error.code=code;error.status=400;error.issues=issues;throw error;}
 if(contracts?.apiVersion!==1||decimal?.apiVersion!==1||typeof fingerprint?.stableSerialize!=='function'||typeof fingerprint.sha256!=='function')fail('MODULE_UNAVAILABLE','Не загружено независимое ядро инвентаризации');
 const stable=(value:unknown):string=>value===undefined?'undefined':fingerprint.stableSerialize(value);
 const equal=(a:unknown,b:unknown):boolean=>stable(a)===stable(b);
 const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
 const typed=(value:Identifier):string=>JSON.stringify([typeof value,value]);
 function freeze<T>(value:T):T {if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
 function safe(value:unknown):JsonValue {
  const parents=new Set<object>();let nodes=0;
  function visit(item:unknown,depth:number):JsonValue {
   if(++nodes>2000000||depth>100)fail('INVENTORY_LIMIT','Слишком большой снимок инвентаризации');
   if(item===null||typeof item==='string'||typeof item==='boolean'||typeof item==='number'&&Number.isFinite(item))return item;
   if(typeof item!=='object'||item===null||parents.has(item))fail('INVENTORY_JSON','Нужны конечные JSON-значения без циклов');
   const array=Array.isArray(item),prototype:unknown=Object.getPrototypeOf(item);
   if(!array&&!(prototype===null||typeof prototype==='object'&&prototype!==null&&Object.getPrototypeOf(prototype)===null))fail('INVENTORY_JSON','Недопустимый объект инвентаризации');
   parents.add(item);
   for(const key of Reflect.ownKeys(item)){
    if(array&&key==='length')continue;const d=Object.getOwnPropertyDescriptor(item,key);
    if(typeof key!=='string'||!d?.enumerable||d.get||d.set||['toJSON','__proto__','constructor','prototype'].includes(key)||array&&(!/^(?:0|[1-9]\d*)$/.test(key)||Number(key)>=item.length))fail('INVENTORY_JSON','Исполняемые, скрытые и неизвестные свойства запрещены');
   }
   let result:JsonValue;
   if(array){if(item.length>200000)fail('INVENTORY_LIMIT','Слишком много строк инвентаризации');const out:JsonValue[]=[];for(let i=0;i<item.length;i++){const d=Object.getOwnPropertyDescriptor(item,String(i));if(!d)fail('INVENTORY_JSON','Пропуск элемента массива');out.push(visit(d.value,depth+1));}result=out;}
   else {const out:JsonRow={};for(const key of Object.keys(item))out[key]=visit(Object.getOwnPropertyDescriptor(item,key)!.value,depth+1);result=out;}
   parents.delete(item);return result;
  }
  return visit(value,0);
 }
 function row(value:unknown):JsonRow {const result=safe(value);if(!object(result))fail('INVENTORY_JSON','Нужен обычный объект JSON');return result;}
 function fields(value:JsonRow,allowed:readonly string[]):void {for(const key of Object.keys(value))if(!allowed.includes(key))fail('INVENTORY_FIELD','Неизвестное поле инвентаризации: '+key);}
 function id(value:unknown):Identifier {if(!contracts.identifier(value)||typeof value==='string'&&(value.length>500||['__proto__','constructor','prototype'].includes(value)))fail('INVENTORY_ID','Нужен устойчивый типизированный идентификатор');return value;}
 function text(value:unknown,label:string,max=4000):string {if(typeof value!=='string'||value.length>max)fail('INVENTORY_TEXT','Проверьте поле «'+label+'»');return value;}
 function day(value:unknown):value is string {return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&value>='1900-01-01'&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;}
 function date(value:unknown,label:string):string {if(!day(value))fail('INVENTORY_DATE','Укажите действительную дату: '+label);return value;}
 function numeric(value:unknown,label:string,scale:number):number|null {
  if(value===null)return null;if(typeof value!=='number'||!Number.isFinite(value))fail('INVENTORY_NUMBER','В поле «'+label+'» нужно число или явно неизвестное null');
  try{return decimal.toNumberExact(decimal.parse(value,{scale,nonNegative:true,max:scale===2?'1000000000000000':'1000000000000'}));}catch{ return fail('INVENTORY_NUMBER','Проверьте неотрицательное значение и точность поля «'+label+'»');}
 }
 function catalogSection(value:unknown):AssetInventoryCatalogSection {if(typeof value!=='string'||!(CATALOGS as readonly string[]).includes(value))fail('INVENTORY_SECTION','Выберите собственный справочник инвентаризации');return value as AssetInventoryCatalogSection;}
 function catalogPayload(section:AssetInventoryCatalogSection,value:unknown):JsonRow {
  const source=row(value),allowed=section==='inventoryMols'?['name','note','orgId','objectId','accountCode']:section==='inventoryItems'?['name','note','molId','code','unit','qty','cost']:['name','note'];fields(source,allowed);
  const name=text(source.name,'Наименование',2000);if(!name.trim())fail('INVENTORY_REQUIRED','Укажите наименование');const result:JsonRow={name,note:text(source.note,'Примечание',20000)};
  if(section==='inventoryMols')Object.assign(result,{orgId:id(source.orgId),objectId:id(source.objectId),accountCode:text(source.accountCode,'Счёт',100)});
  if(section==='inventoryItems')Object.assign(result,{molId:id(source.molId),code:text(source.code,'Код',1000),unit:text(source.unit,'Единица измерения',100),qty:numeric(source.qty,'Учётное количество',3),cost:numeric(source.cost,'Учётная стоимость',2)});
  return result;
 }
 function person(value:unknown):AssetInventoryPerson {const source=row(value);fields(source,['name','position']);return {name:text(source.name,'ФИО',500),position:text(source.position,'Должность',500)};}
 function commission(value:unknown):AssetInventoryCommission {const source=row(value);fields(source,['chairman','members']);if(!Array.isArray(source.members)||source.members.length>100)fail('INVENTORY_COMMISSION','Нужен список членов комиссии');return {chairman:person(source.chairman),members:source.members.map(person)};}
 function fact(value:unknown):AssetInventoryFact {const source=row(value);fields(source,['rowId','qtyFact','costFact','action','note']);if(!['','writeoff','transfer'].includes(source.action as string))fail('INVENTORY_ACTION','Неизвестное решение по позиции');return {rowId:id(source.rowId),qtyFact:numeric(source.qtyFact,'Фактическое количество',3),costFact:numeric(source.costFact,'Фактическая стоимость',2),action:source.action as AssetInventoryFact['action'],note:text(source.note,'Примечание строки',20000)};}
 function draftPayload(value:unknown):AssetInventoryDraftPayload {const source=row(value);fields(source,['date','title','note','commission','facts']);if(!Array.isArray(source.facts)||source.facts.length>100000)fail('INVENTORY_FACTS','Нужны фактические данные всех строк описи');const facts=source.facts.map(fact),seen=new Set<Identifier>();for(const item of facts){if(seen.has(item.rowId))fail('INVENTORY_ROW_ID','Фактические данные строки повторяются');seen.add(item.rowId);}return {date:date(source.date,'Дата описи'),title:text(source.title,'Название',2000),note:text(source.note,'Примечание',20000),commission:commission(source.commission),facts};}
 function parse(value:unknown,preview=false):AssetInventoryActionInput {
  const source=row(value),action=source.action;
  const allowed=action==='saveCatalog'?['action','section','id','payload','reason','reviewFingerprint']:action==='archiveCatalog'?['action','section','id','reason','reviewFingerprint']:action==='createSession'?['action','objectId','orgId','date','title','reason','reviewFingerprint']:action==='saveDraft'?['action','sessionId','payload','reason','reviewFingerprint']:action==='approve'?['action','sessionId','date','document','reason','reviewFingerprint']:action==='amendDraft'?['action','sessionId','corrections','reason','reviewFingerprint']:action==='importLegacy'||action==='importRows'?['action','sourceId','sessionIds','reason','reviewFingerprint']:['action','sessionId','reason','reviewFingerprint'];fields(source,allowed);
  const reason=text(source.reason,'Основание',20000);if(reason.trim().length<3)fail('INVENTORY_REASON','Укажите основание действия не короче трёх символов');
  const review=source.reviewFingerprint;if(!(preview&&review===undefined)&&(typeof review!=='string'||!/^sha256:[a-f0-9]{64}$/.test(review)))fail('INVENTORY_REVIEW','Сначала проверьте действие инвентаризации');const common={reason,reviewFingerprint:typeof review==='string'?review:'sha256:'+'0'.repeat(64)};
  if(action==='saveCatalog'){const section=catalogSection(source.section);return {action,section,...(own(source,'id')?{id:id(source.id)}:{}),payload:catalogPayload(section,source.payload) as unknown as AssetInventoryCatalogPayload,...common};}
  if(action==='archiveCatalog')return {action,section:catalogSection(source.section),id:id(source.id),...common};
  if(action==='createSession')return {action,objectId:id(source.objectId),...(own(source,'orgId')?{orgId:id(source.orgId)}:{}),date:date(source.date,'Дата описи'),title:text(source.title,'Название',2000),...common};
  if(action==='saveDraft')return {action,sessionId:id(source.sessionId),payload:draftPayload(source.payload),...common};
  if(action==='approve'){const document=text(source.document,'Решение об утверждении',4000);if(!document.trim())fail('INVENTORY_APPROVAL','Укажите решение или документ утверждения');return {action,sessionId:id(source.sessionId),date:date(source.date,'Дата утверждения'),document,...common};}
  if(action==='revise')return {action,sessionId:id(source.sessionId),...common};
  if(action==='amendDraft'){
   if(!Array.isArray(source.corrections)||!source.corrections.length||source.corrections.length>100000)fail('INVENTORY_CORRECTIONS','Укажите исправляемые строки черновика');const seen=new Set<Identifier>();
   const corrections=source.corrections.map(value=>{const entry=row(value);fields(entry,['rowId','unit','qtyAcct','costAcct']);const rowId=id(entry.rowId),unit=text(entry.unit,'Единица измерения',100);if(seen.has(rowId))fail('INVENTORY_ROW_ID','Исправление строки повторяется');seen.add(rowId);if(!unit.trim())fail('INVENTORY_UNIT_REQUIRED','Укажите единицу измерения исправляемой строки');return {rowId,unit,qtyAcct:numeric(entry.qtyAcct,'Учётное количество',3),costAcct:numeric(entry.costAcct,'Учётная стоимость',2)};});return {action,sessionId:id(source.sessionId),corrections,...common};
  }
  if(action==='importLegacy'||action==='importRows'){
   if(typeof source.sourceId!=='string'||!/^[a-f0-9]{64}$/.test(source.sourceId))fail('INVENTORY_IMPORT_SOURCE','Нужен отпечаток проверенного источника');
   let sessionIds:Identifier[]|undefined;if(own(source,'sessionIds')){if(!Array.isArray(source.sessionIds)||!source.sessionIds.length||source.sessionIds.length>1000)fail('INVENTORY_IMPORT_BATCH','Выберите от одной до 1000 исходных описей');sessionIds=source.sessionIds.map(id);if(new Set(sessionIds).size!==sessionIds.length)fail('INVENTORY_IMPORT_BATCH','Исходная опись повторяется в выбранном пакете');}
   return {action,sourceId:source.sourceId,...(sessionIds?{sessionIds}:{}),...common};
  }
  return fail('INVENTORY_ACTION','Неизвестное действие инвентаризации');
 }
 function sectionRows(value:unknown,name:string):JsonRow[] {if(!object(value))fail('INVENTORY_DATABASE','Нужен снимок инвентаризации');const d=Object.getOwnPropertyDescriptor(value,name);if(d&&(!d.enumerable||d.get||d.set))fail('INVENTORY_JSON','Исполняемые и скрытые разделы запрещены');const list=safe(d?.value??[]);if(!Array.isArray(list))fail('INVENTORY_DATABASE','Нужен список строк раздела '+name);return contracts.validateSections({[name]:list},[name])[name]||[];}
 function database(value:unknown):SectionRows {const result:SectionRows={};for(const name of SECTIONS)result[name]=sectionRows(value,name);return result;}
 function find(db:SectionRows,section:string,selected:Identifier):JsonRow {const matches=(db[section]||[]).filter(value=>value.id===selected);if(matches.length!==1)fail('INVENTORY_REFERENCE','Запись не найдена однозначно: '+section);return matches[0]!;}
 function available(db:SectionRows,section:string,selected:Identifier):JsonRow {const result=find(db,section,selected);if(result.archived)fail('INVENTORY_ARCHIVED','Нельзя выбрать архивную запись: '+section);return result;}
 function unique(values:JsonRow[],label:string):void {const seen=new Set<Identifier>();for(const value of values){const selected=id(value.id);if(seen.has(selected))fail('INVENTORY_DUPLICATE','Повторяется типизированный ID: '+label);seen.add(selected);}}
 function catalogRow(section:AssetInventoryCatalogSection,value:JsonRow):void {
  const source=copy(value);id(source.id);for(const field of ['id','archived','createdAt','updatedAt','sourceMeta','importProvenance'])delete source[field];catalogPayload(section,source);if(own(value,'sourceMeta'))row(value.sourceMeta);if(own(value,'importProvenance'))row(value.importProvenance);
  if(own(value,'archived')&&typeof value.archived!=='boolean')fail('INVENTORY_ARCHIVED','Архивный признак должен быть логическим');
  for(const key of ['createdAt','updatedAt'])if(own(value,key)&&(typeof value[key]!=='string'||!Number.isFinite(Date.parse(value[key] as string))))fail('INVENTORY_TIME','Некорректная дата изменения справочника');
 }
 const ROW_FIELDS=['id','itemId','molId','orgId','objectId','orgName','objectName','molName','name','code','accountCode','unit','qtyAcct','costAcct','qtyFact','costFact','action','note','sourceMeta','importProvenance'] as const;
 function sessionRow(value:unknown):JsonRow {
  const source=row(value);fields(source,ROW_FIELDS);const result:JsonRow={};for(const key of ['id','itemId','molId','orgId','objectId'])result[key]=id(source[key]);for(const key of ['orgName','objectName','molName','name','code','accountCode','unit'])result[key]=text(source[key],key,2000);
  Object.assign(result,{qtyAcct:numeric(source.qtyAcct,'Учётное количество',3),costAcct:numeric(source.costAcct,'Учётная стоимость',2),qtyFact:numeric(source.qtyFact,'Фактическое количество',3),costFact:numeric(source.costFact,'Фактическая стоимость',2)});
  if(!['','writeoff','transfer'].includes(source.action as string))fail('INVENTORY_ACTION','Неизвестное решение по позиции');result.action=source.action!;result.note=text(source.note,'Примечание строки',20000);if(own(source,'sourceMeta'))result.sourceMeta=row(source.sourceMeta);if(own(source,'importProvenance'))result.importProvenance=row(source.importProvenance);return result;
 }
 function sessionContent(value:JsonRow):JsonRow {
  const result:JsonRow={version:1,sessionId:value.id!,objectId:value.objectId!,objectName:value.objectName!,date:value.date!,title:value.title!,note:value.note!,rows:copy(value.rows!),commission:copy(value.commission!),rootId:value.rootId!,revision:value.revision!};
  if(own(value,'orgId')){result.orgId=value.orgId!;result.orgName=value.orgName!;}if(own(value,'previousId'))result.previousId=value.previousId!;if(own(value,'approval'))result.approval=copy(value.approval!);for(const key of ['sourceMeta','legacyStatus','amendments','importProvenance'])if(own(value,key))result[key]=copy(value[key]!);return result;
 }
 function snapshotDigest(value:unknown):string {return 'sha256:'+fingerprint.sha256(stable(row(value)));}
 function sourceLocator(value:unknown):JsonRow {
  const source=object(value)?value:{},result:JsonRow={};
  for(const key of ['path','sheet','cell','decoderId','option','legacyStatus'])if(typeof source[key]==='string'&&(source[key] as string).length<=4000)result[key]=source[key]!;
  for(const key of ['row','column','decoderVersion','parserVersion'])if(typeof source[key]==='number'&&Number.isSafeInteger(source[key])&&(source[key] as number)>=0)result[key]=source[key]!;
  for(const key of ['sourceRecord','explicitDefault'])if(typeof source[key]==='boolean')result[key]=source[key]!;
  for(const key of ['legacyMolId','externalId'])if(contracts.identifier(source[key]))result[key]=source[key]!;
  return result;
 }
 function fileReference(value:unknown):JsonRow {const source=row(value);return {id:source.id!,sha256:source.sha256!,size:source.size!,name:source.name!};}
 function storedSession(value:unknown):JsonRow {
  const source=row(value);fields(source,['id','objectId','objectName','orgId','orgName','date','title','note','status','rows','commission','rootId','revision','previousId','approval','snapshot','fingerprint','createdAt','updatedAt','sourceMeta','legacyStatus','amendments','importProvenance']);id(source.id);id(source.objectId);id(source.rootId);text(source.objectName,'Объект',2000);date(source.date,'Дата описи');text(source.title,'Название',2000);text(source.note,'Примечание',20000);
  if(own(source,'orgId')){id(source.orgId);text(source.orgName,'Организация',2000);}else if(own(source,'orgName'))fail('INVENTORY_SCOPE','Название организации без её ID недопустимо');
  if(source.status!=='draft'&&source.status!=='approved'||typeof source.revision!=='number'||!Number.isSafeInteger(source.revision)||source.revision<1)fail('INVENTORY_SESSION','Неверное состояние или номер редакции описи');if(own(source,'previousId'))id(source.previousId);
  if(!Array.isArray(source.rows)||source.rows.length>100000)fail('INVENTORY_ROWS','Нужен список строк описи');const rows=source.rows.map(sessionRow);unique(rows,'строки описи');const itemIds=new Set<Identifier>();for(const entry of rows){if(entry.objectId!==source.objectId||own(source,'orgId')&&entry.orgId!==source.orgId)fail('INVENTORY_SCOPE','Строка относится к другому объекту или организации');if(itemIds.has(entry.itemId as Identifier))fail('INVENTORY_ITEM_DUPLICATE','Одна карточка имущества повторяется в описи');itemIds.add(entry.itemId as Identifier);}
  commission(source.commission);for(const key of ['createdAt','updatedAt'])if(typeof source[key]!=='string'||!Number.isFinite(Date.parse(source[key] as string)))fail('INVENTORY_TIME','Не указано действительное время документа');
  if(own(source,'sourceMeta'))row(source.sourceMeta);if(own(source,'importProvenance'))row(source.importProvenance);if(own(source,'legacyStatus'))text(source.legacyStatus,'Состояние в прежней программе',500);
  if(own(source,'amendments')){if(!Array.isArray(source.amendments)||source.amendments.length>100000)fail('INVENTORY_CORRECTIONS','Неверная история исправлений');for(const value of source.amendments){const entry=row(value);fields(entry,['rowId','before','after','reason','at','actor']);if(!rows.some(value=>value.id===id(entry.rowId)))fail('INVENTORY_CORRECTIONS','Исправление относится к неизвестной строке');for(const key of ['before','after']){const values=row(entry[key]);fields(values,['unit','qtyAcct','costAcct']);text(values.unit,'Единица измерения',100);numeric(values.qtyAcct,'Учётное количество',3);numeric(values.costAcct,'Учётная стоимость',2);}text(entry.reason,'Основание',20000);text(entry.actor,'Автор',1000);if(typeof entry.at!=='string'||!Number.isFinite(Date.parse(entry.at)))fail('INVENTORY_TIME','Неверное время исправления');}}
  if(source.status==='approved'){
   const approval=row(source.approval);fields(approval,['date','document','at','actor']);date(approval.date,'Дата утверждения');if(!text(approval.document,'Решение',4000).trim()||!text(approval.actor,'Утвердивший',1000).trim()||typeof approval.at!=='string'||!Number.isFinite(Date.parse(approval.at)))fail('INVENTORY_APPROVAL','Не заполнено утверждение описи');
   if(String(approval.date)<String(source.date))fail('INVENTORY_APPROVAL','Утверждение не может предшествовать дате описи');
   if(typeof source.fingerprint!=='string'||source.fingerprint!==snapshotDigest(source.snapshot)||!equal(source.snapshot,sessionContent(source)))fail('INVENTORY_SNAPSHOT','Утверждённая опись не совпадает с собственным снимком');
   if(physicalIssues(source).length)fail('INVENTORY_APPROVAL','Утверждённая опись должна содержать полные физические данные');
  }else if(['approval','snapshot','fingerprint'].some(key=>own(source,key)))fail('INVENTORY_PROOF','Черновик не может содержать поддельное утверждение или снимок');
  return source;
 }
 function validateDatabase(db:SectionRows):void {
  for(const section of SECTIONS)unique(db[section]||[],section);
  for(const section of CATALOGS)for(const value of db[section]||[])catalogRow(section,value);
  for(const value of db.inventoryMols||[]){find(db,'inventoryOrgs',value.orgId as Identifier);find(db,'inventoryObjects',value.objectId as Identifier);}
  for(const value of db.inventoryItems||[])find(db,'inventoryMols',value.molId as Identifier);
  const children=new Set<Identifier>(),revisions=new Set<string>();for(const value of db[SESSION]||[]){storedSession(value);const selected=id(value.id),root=id(value.rootId),key=typed(root)+':'+String(value.revision);if(revisions.has(key))fail('INVENTORY_REVISION','Номер редакции повторяется');revisions.add(key);
   if(value.revision===1){if(root!==selected||own(value,'previousId'))fail('INVENTORY_REVISION','Первая редакция должна быть самостоятельным корнем');}
   else {const previous=id(value.previousId),prior=find(db,SESSION,previous);if(prior.status!=='approved'||prior.rootId!==root||Number(prior.revision)+1!==value.revision||prior.objectId!==value.objectId||prior.orgId!==value.orgId||children.has(previous))fail('INVENTORY_REVISION','Нарушена последовательность редакций описи');children.add(previous);}
  }
 }
 function issue(code:string,message:string,field?:string,rowId?:Identifier,severity:'error'|'warning'='error'):AssetInventoryIssue {return {severity,section:SESSION,recordId:null,code,message,...(field?{field}:{}),...(rowId===undefined?{}:{rowId})};}
 function physicalIssues(session:JsonRow):AssetInventoryIssue[] {
  const issues:AssetInventoryIssue[]=[];if(!(session.title as string).trim())issues.push(issue('INVENTORY_TITLE_REQUIRED','Укажите название описи','title'));const rows=session.rows as JsonRow[];if(!rows.length)issues.push(issue('INVENTORY_EMPTY','В описи нет имущества','rows'));
  for(const entry of rows){for(const key of ['qtyAcct','qtyFact'] as const)if(entry[key]===null)issues.push(issue('INVENTORY_QUANTITY_REQUIRED',key==='qtyAcct'?'Укажите учётное количество':'Укажите фактическое наличие',key,entry.id as Identifier));if(!(entry.unit as string).trim())issues.push(issue('INVENTORY_UNIT_REQUIRED','Укажите единицу измерения','unit',entry.id as Identifier));}
  const c=commission(session.commission);for(const [index,person]of [c.chairman,...c.members].entries())if(!person.name.trim()||!person.position.trim())issues.push(issue('INVENTORY_COMMISSION_REQUIRED','Укажите ФИО и должность '+(index?'члена комиссии':'председателя комиссии'),'commission'));
  return issues;
 }
 function draftWarnings(session:JsonRow):AssetInventoryIssue[] {return physicalIssues(session).map(value=>({...value,severity:'warning'}));}
 function rights(context:JsonRow,write?:string[]):void {
  for(const key of ['readable','writable'])if(own(context,key)&&(!Array.isArray(context[key])||(context[key] as JsonValue[]).some(value=>typeof value!=='string')))fail('ACCESS_DENIED','Некорректные полномочия инвентаризации');
  const readable=context.readable as string[]|undefined;if(readable&&!readable.includes('*')&&SECTIONS.some(name=>!readable.includes(name)))fail('ACCESS_DENIED','Нет доступа ко всем собственным источникам инвентаризации');
  if(write){const writable=context.writable as string[]|undefined;if(writable&&!writable.includes('*')&&write.some(name=>!writable.includes(name)))fail('ACCESS_DENIED','Нет права записи выбранного раздела инвентаризации');}
 }
 function previewContext(value:unknown):{today:string;source:JsonRow} {const source=row(value);rights(source);return {today:date(source.today,'Рабочая дата'),source};}
 function context(value:unknown,write:string[]):AssetInventoryContext {
  const source=row(value);rights(source,write);const actor=row(source.actor);for(const key of ['id','name','role'])if(typeof actor[key]!=='string'||!(actor[key] as string).trim())fail('INVENTORY_ACTOR','Нужен действующий автор действия');if(actor.role==='readonly'||actor.role==='viewer')fail('ACCESS_DENIED','Доступ только для просмотра');
  if(typeof source.now!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(source.now)||!day(source.now.slice(0,10))||Number(source.now.slice(11,13))>23||Number(source.now.slice(14,16))>59||Number(source.now.slice(17,19))>59||!Number.isFinite(Date.parse(source.now)))fail('INVENTORY_TIME','Нужно точное время действия');
  const result:AssetInventoryContext={id:contracts.validateOperation({id:source.id}).id,now:source.now,today:date(source.today,'Рабочая дата'),actor:{id:actor.id as string,name:actor.name as string,role:actor.role as string}};for(const key of ['readable','writable'] as const)if(own(source,key))result[key]=(source[key] as string[]).slice();if(own(source,'importSource'))result.importSource=row(source.importSource);return result;
 }
 function dependencies(value?:unknown):string[] {if(value!==undefined)parse(value,true);return [...SECTIONS];}
 function footprint(value:unknown):string[] {const input=parse(value,true);return input.action==='importLegacy'||input.action==='importRows'?[...SECTIONS]:[input.action==='saveCatalog'||input.action==='archiveCatalog'?input.section:SESSION];}
 function importBuild(db:SectionRows,input:Extract<AssetInventoryActionInput,{sourceId:string}>,ctx:AssetInventoryContext):BuiltInventory {
  const source=row(ctx.importSource),digest=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
  if(source.version!==1||source.parserVersion!==1||source.sourceId!==input.sourceId||source.id!==input.sourceId||!digest(source.sha256)||typeof source.name!=='string'||!['inventory-legacy-json','inventory-osv','inventory-comparison'].includes(source.format as string))fail('INVENTORY_IMPORT_SOURCE','Источник не подтверждён сервером или имеет другой формат');
  if(input.action==='importLegacy'&&source.format!=='inventory-legacy-json'||input.action==='importRows'&&source.format==='inventory-legacy-json')fail('INVENTORY_IMPORT_SOURCE','Формат источника не соответствует выбранному импорту');
  for(const field of ['sections','sourceScopes'])if(!Array.isArray(source[field])||!equal([...(source[field] as string[])].sort(),[...SECTIONS].sort()))fail('INVENTORY_IMPORT_SOURCE','Источник должен содержать только собственные разделы инвентаризации');
  for(const field of ['sourceArchive','sourceManifest']){const ref=row(source[field]);if(typeof ref.id!=='string'||!/^[a-f0-9]{64}\.[a-z0-9]{1,6}$/.test(ref.id)||!digest(ref.sha256)||ref.sha256!==ref.id.slice(0,64)||typeof ref.size!=='number'||!Number.isSafeInteger(ref.size)||ref.size<=0||typeof ref.name!=='string')fail('INVENTORY_IMPORT_SOURCE','Не подтверждён оригинал или манифест источника');if(field==='sourceArchive'&&ref.sha256!==source.sha256||field==='sourceManifest'&&ref.id!==input.sourceId+'.json')fail('INVENTORY_IMPORT_SOURCE','Отпечаток источника не совпадает с подтверждёнными файлами');}
  const batching=input.sessionIds!==undefined;
  for(const section of SECTIONS)for(const value of db[section]||[])if(object(value.sourceMeta)&&(value.sourceMeta.importSourceId===input.sourceId||value.sourceMeta.originalSha256===source.sha256&&value.sourceMeta.format===source.format)&&(!batching||value.sourceMeta.importSourceId!==input.sourceId))fail('INVENTORY_SOURCE_REPEATED','Этот источник уже импортирован; повторное добавление запрещено');
  const sourceData=row(source.data);fields(sourceData,SECTIONS);const incoming=database(sourceData),maps=new Map<string,Map<Identifier,Identifier>>(),targets=new Map<string,JsonRow>(),namespace=(section:string,external:Identifier,scope?:Identifier):Identifier=>'inventory:'+fingerprint.sha256(stable({version:1,sourceId:input.sourceId,section,id:[typeof external,external],...(scope===undefined?{}:{scope:[typeof scope,scope]})}));
  if(own(source,'target')){
   if(input.action!=='importRows')fail('INVENTORY_IMPORT_TARGET','Полный перенос прежней базы не объединяется с существующими справочниками');const target=row(source.target);fields(target,['orgId','objectId','molId']);
   for(const[field,section]of [['orgId','inventoryOrgs'],['objectId','inventoryObjects'],['molId','inventoryMols']] as const)if(own(target,field))targets.set(section,available(db,section,id(target[field])));
   const mol=targets.get('inventoryMols');if(mol){for(const[field,section]of [['orgId','inventoryOrgs'],['objectId','inventoryObjects']] as const){const owner=available(db,section,id(mol[field])),given=targets.get(section);if(given&&given.id!==owner.id)fail('INVENTORY_IMPORT_TARGET','Выбранный МОЛ относится к другой организации или объекту');targets.set(section,owner);}const sourceMol=incoming.inventoryMols?.[0];if(sourceMol&&typeof sourceMol.accountCode==='string'&&sourceMol.accountCode.trim()&&typeof mol.accountCode==='string'&&mol.accountCode.trim()&&sourceMol.accountCode!==mol.accountCode)fail('INVENTORY_IMPORT_TARGET','Счёт выбранного МОЛ отличается от счёта источника');}
   for(const[section]of targets)if((incoming[section]||[]).length>1)fail('INVENTORY_IMPORT_TARGET','Нельзя неявно объединять несколько организаций, объектов или МОЛ в одну запись');
  }
  for(const section of SECTIONS){unique(incoming[section]||[],section);const map=new Map<Identifier,Identifier>(),target=targets.get(section);for(const value of incoming[section]||[]){const external=id(value.id),mapped=target?id(target.id):namespace(section,external);if(!batching&&!target&&(db[section]||[]).some(value=>value.id===mapped))fail('INVENTORY_IMPORT_COLLISION','Идентификатор импорта уже занят');map.set(external,mapped);}maps.set(section,map);}
  function linked(section:string,external:unknown):Identifier {const selected=id(external),mapped=maps.get(section)?.get(selected);if(mapped===undefined)fail('INVENTORY_IMPORT_REFERENCE','Источник ссылается на отсутствующую запись: '+section);return mapped;}
  function meta(value:JsonRow):JsonRow {return {...sourceLocator(value.sourceMeta),importSourceId:input.sourceId,originalSha256:source.sha256!,format:source.format!,name:source.name!,externalId:copy(value.id!),sourceArchive:fileReference(source.sourceArchive),sourceManifest:fileReference(source.sourceManifest)};}
  const provenance:JsonRow={version:1,sourceId:input.sourceId,sourceManifest:fileReference(source.sourceManifest),sourceArchive:fileReference(source.sourceArchive)};
  // A bounded batch consists of complete, independent source documents. The
  // same source namespace is retained across batches, including shared owners.
  const selected=new Map<string,Set<Identifier>>(SECTIONS.map(section=>[section,new Set<Identifier>()]));
  if(batching){
   const chosen=selected.get(SESSION)!,itemUses=new Map<Identifier,number>();for(const selectedId of input.sessionIds!)chosen.add(selectedId);
   for(const selectedId of chosen)if(!(incoming[SESSION]||[]).some(value=>value.id===selectedId))fail('INVENTORY_IMPORT_BATCH','Выбранная опись отсутствует в подтверждённом источнике');
   for(const session of incoming[SESSION]||[]){if(!Array.isArray(session.rows))fail('INVENTORY_ROWS','Источник не содержит строки описи');for(const raw of session.rows){const entry=sessionRow(raw),itemId=id(entry.itemId);itemUses.set(itemId,(itemUses.get(itemId)||0)+1);if(chosen.has(id(session.id))){selected.get('inventoryItems')!.add(itemId);selected.get('inventoryMols')!.add(id(entry.molId));selected.get('inventoryOrgs')!.add(id(entry.orgId));selected.get('inventoryObjects')!.add(id(entry.objectId));}}if(chosen.has(id(session.id))){selected.get('inventoryObjects')!.add(id(session.objectId));if(own(session,'orgId'))selected.get('inventoryOrgs')!.add(id(session.orgId));}}
   if(itemUses.size!==(incoming.inventoryItems||[]).length||(incoming.inventoryItems||[]).some(value=>itemUses.get(id(value.id))!==1))fail('INVENTORY_IMPORT_BATCH','Пакетный импорт требует, чтобы каждая карточка источника относилась ровно к одной описи');
   for(const item of incoming.inventoryItems||[])if(selected.get('inventoryItems')!.has(id(item.id)))selected.get('inventoryMols')!.add(id(item.molId));
   for(const mol of incoming.inventoryMols||[])if(selected.get('inventoryMols')!.has(id(mol.id))){selected.get('inventoryOrgs')!.add(id(mol.orgId));selected.get('inventoryObjects')!.add(id(mol.objectId));}
  }
  const full:SectionRows={};
  for(const section of SECTIONS){const values:JsonRow[]=[];for(const original of targets.has(section)?[]:incoming[section]||[]){const value=copy(original);value.id=linked(section,original.id);value.sourceMeta=meta(original);value.importProvenance=copy(provenance);value.createdAt=ctx.now;value.updatedAt=ctx.now;
    if(section==='inventoryMols'){value.orgId=linked('inventoryOrgs',value.orgId);value.objectId=linked('inventoryObjects',value.objectId);}
    if(section==='inventoryItems')value.molId=linked('inventoryMols',value.molId);
    if(section===SESSION){
     if(value.status!=='draft'||['approval','snapshot','fingerprint','previousId','amendments'].some(key=>own(value,key))||own(value,'revision')&&value.revision!==1)fail('INVENTORY_IMPORT_APPROVAL','Исторический источник импортируется черновиком без поддельного утверждения');
     value.objectId=linked('inventoryObjects',value.objectId);if(targets.has('inventoryObjects'))value.objectName=targets.get('inventoryObjects')!.name!;if(own(value,'orgId')){value.orgId=linked('inventoryOrgs',value.orgId);if(targets.has('inventoryOrgs'))value.orgName=targets.get('inventoryOrgs')!.name!;}value.rootId=value.id;value.revision=1;
     if(!Array.isArray(value.rows))fail('INVENTORY_ROWS','Источник не содержит строки описи');const seen=new Set<Identifier>();
     value.rows=value.rows.map(raw=>{const entry=sessionRow(raw),external=id(entry.id);if(seen.has(external))fail('INVENTORY_ROW_ID','ID строки источника повторяется');seen.add(external);const clean={...entry};delete clean.importProvenance;return {...clean,id:namespace('inventoryRows',external,id(original.id)),itemId:linked('inventoryItems',entry.itemId),molId:linked('inventoryMols',entry.molId),orgId:linked('inventoryOrgs',entry.orgId),objectId:linked('inventoryObjects',entry.objectId),...(targets.has('inventoryOrgs')?{orgName:targets.get('inventoryOrgs')!.name!}:{}),...(targets.has('inventoryObjects')?{objectName:targets.get('inventoryObjects')!.name!}:{}),...(targets.has('inventoryMols')?{molName:targets.get('inventoryMols')!.name!}:{}),sourceMeta:{...sourceLocator(entry.sourceMeta),externalId:external,importSourceId:input.sourceId}};});
    }
    values.push(value);
   }full[section]=values;}
  // Validate every record in the signed source, including unselected documents.
  // Existing records are replaced only in this disposable validation snapshot.
  const validation:SectionRows={};for(const section of SECTIONS){const ids=new Set((full[section]||[]).map(value=>id(value.id)));validation[section]=[...(db[section]||[]).filter(value=>!ids.has(id(value.id))),...(full[section]||[])];}validateDatabase(validation);
  const withoutTimes=(value:JsonRow):JsonRow=>{const result=copy(value);delete result.createdAt;delete result.updatedAt;return result;};
  const appended:SectionRows={},changed:AssetInventoryResult['changed']=[];let count=0;
  for(const section of SECTIONS){const values:JsonRow[]=[],existing=new Map((db[section]||[]).map(value=>[id(value.id),value]));for(const value of full[section]||[]){const external=id((value.sourceMeta as JsonRow).externalId),included=!batching||selected.get(section)!.has(external),prior=existing.get(id(value.id));
    if(prior){if(!batching||!object(prior.sourceMeta)||prior.sourceMeta.importSourceId!==input.sourceId||!equal(withoutTimes(prior),withoutTimes(value)))fail('INVENTORY_IMPORT_COLLISION','Существующая запись не совпадает с подтверждённой записью этого источника');if(included&&(section==='inventoryItems'||section===SESSION))fail('INVENTORY_SOURCE_REPEATED','Выбранная опись или её имущество уже импортированы');continue;}
    if(!included)continue;values.push(value);changed.push({section,id:id(value.id),type:'create'});count++;
   }appended[section]=[...(db[section]||[]),...values];}
  if(batching&&count>1999)fail('INVENTORY_IMPORT_BATCH_LIMIT','В пакете больше 1999 новых записей; выберите меньше исходных описей');
  if(!count)fail('INVENTORY_IMPORT_EMPTY','В источнике нет записей инвентаризации');validateDatabase({...db,...appended});
  const warnings:AssetInventoryIssue[]=[];if(Array.isArray(source.warnings))for(const raw of source.warnings){const value=row(raw);warnings.push(issue(typeof value.code==='string'?value.code:'INVENTORY_IMPORT_WARNING',typeof value.message==='string'?value.message:'Источник требует сверки',typeof value.path==='string'?value.path:undefined,undefined,'warning'));}
  for(const value of appended[SESSION]||[])if(object(value.sourceMeta)&&value.sourceMeta.importSourceId===input.sourceId)warnings.push(...draftWarnings(value));
  return {sections:appended,changed,session:null,entityIds:{},issues:[],warnings};
 }
 function build(db:SectionRows,input:AssetInventoryActionInput,ctx:AssetInventoryContext):BuiltInventory {
  if(input.action==='importLegacy'||input.action==='importRows')return importBuild(db,input,ctx);
  const section=input.action==='saveCatalog'||input.action==='archiveCatalog'?input.section:SESSION,list=db[section]||[];let changed:JsonRow,prior:JsonRow|undefined;
  if(input.action==='saveCatalog'){
   prior=own(input,'id')?find(db,section,input.id!):undefined;if(prior?.archived)fail('INVENTORY_ARCHIVED','Архивную запись нельзя редактировать');const body=catalogPayload(input.section,input.payload);
   if(section==='inventoryMols'){available(db,'inventoryOrgs',body.orgId as Identifier);available(db,'inventoryObjects',body.objectId as Identifier);}if(section==='inventoryItems'){const mol=available(db,'inventoryMols',body.molId as Identifier);available(db,'inventoryOrgs',mol.orgId as Identifier);available(db,'inventoryObjects',mol.objectId as Identifier);}
   changed={...body,id:prior?prior.id!:ctx.id,createdAt:prior?.createdAt??ctx.now,updatedAt:ctx.now,...(prior&&own(prior,'sourceMeta')?{sourceMeta:copy(prior.sourceMeta!)}:{}),...(prior&&own(prior,'importProvenance')?{importProvenance:copy(prior.importProvenance!)}:{})};
  }else if(input.action==='archiveCatalog'){prior=find(db,section,input.id);changed={...copy(prior),archived:true,updatedAt:ctx.now};}
  else if(input.action==='createSession'){
   const target=available(db,'inventoryObjects',input.objectId),org=own(input,'orgId')?available(db,'inventoryOrgs',input.orgId!):null,rows:JsonRow[]=[];
   for(const item of db.inventoryItems||[]){if(item.archived)continue;const mol=find(db,'inventoryMols',item.molId as Identifier);if(mol.archived||mol.objectId!==target.id||org&&mol.orgId!==org.id)continue;const owner=find(db,'inventoryOrgs',mol.orgId as Identifier);if(owner.archived)continue;
    rows.push({id:ctx.id+':row:'+rows.length,itemId:item.id!,molId:mol.id!,orgId:owner.id!,objectId:target.id!,orgName:owner.name!,objectName:target.name!,molName:mol.name!,name:item.name!,code:item.code!,accountCode:mol.accountCode!,unit:item.unit!,qtyAcct:item.qty!,costAcct:item.cost!,qtyFact:null,costFact:null,action:'',note:''});
   }
   changed={id:ctx.id,objectId:target.id!,objectName:target.name!,...(org?{orgId:org.id!,orgName:org.name!}:{}),date:input.date,title:input.title,note:'',status:'draft',rows,commission:{chairman:{name:'',position:''},members:[]},rootId:ctx.id,revision:1,createdAt:ctx.now,updatedAt:ctx.now};
  }else {
   prior=find(db,SESSION,input.sessionId);storedSession(prior);
   if(input.action==='revise'){
    if(prior.status!=='approved')fail('INVENTORY_REVISION','Новую редакцию создают только из утверждённой описи');if(list.some(value=>value.previousId===prior!.id))fail('INVENTORY_REVISION','У этой описи уже есть следующая редакция');
    changed={...copy(prior),id:ctx.id,status:'draft',revision:Number(prior.revision)+1,previousId:prior.id!,createdAt:ctx.now,updatedAt:ctx.now};for(const key of ['approval','snapshot','fingerprint'])delete changed[key];prior=undefined;
   }else {
    if(prior.status!=='draft')fail('INVENTORY_FROZEN','Утверждённая опись неизменяема. Создайте новую редакцию');changed={...copy(prior),updatedAt:ctx.now};
    if(input.action==='saveDraft'){
     const body=input.payload,rows=changed.rows as JsonRow[];if(body.facts.length!==rows.length)fail('INVENTORY_FACTS','Передайте фактические данные каждой строки описи');const facts=new Map(body.facts.map(value=>[value.rowId,value]));
     changed.rows=rows.map(value=>{const entry=facts.get(value.id as Identifier);if(!entry)fail('INVENTORY_FACTS','Не найдены фактические данные строки описи');return {...value,qtyFact:entry.qtyFact,costFact:entry.costFact,action:entry.action,note:entry.note};});Object.assign(changed,{date:body.date,title:body.title,note:body.note,commission:copy(body.commission) as unknown as JsonValue});
    }else if(input.action==='approve'){
     if(input.date>ctx.today||String(changed.date)>ctx.today||input.date<String(changed.date))fail('INVENTORY_APPROVAL_DATE','Дата утверждения должна быть не раньше описи и не позже рабочей даты');
     const issues=physicalIssues(changed);if(issues.length)return {sections:{},changed:[],session:changed,entityIds:{sessionId:id(changed.id)},issues,warnings:[]};
     changed.status='approved';changed.approval={date:input.date,document:input.document,at:ctx.now,actor:ctx.actor.name};changed.snapshot=sessionContent(changed);changed.fingerprint=snapshotDigest(changed.snapshot);
    }else if(input.action==='amendDraft'){
     const corrections=new Map(input.corrections.map(value=>[value.rowId,value])),rows=changed.rows as JsonRow[];for(const key of corrections.keys())if(!rows.some(value=>value.id===key))fail('INVENTORY_CORRECTIONS','Исправление относится к неизвестной строке');const history=Array.isArray(changed.amendments)?copy(changed.amendments):[];
     changed.rows=rows.map(value=>{const correction=corrections.get(value.id as Identifier);if(!correction)return value;const before:JsonRow={unit:value.unit!,qtyAcct:value.qtyAcct!,costAcct:value.costAcct!},after:JsonRow={unit:correction.unit,qtyAcct:correction.qtyAcct,costAcct:correction.costAcct};if(!equal(before,after))history.push({rowId:value.id!,before,after,reason:input.reason,at:ctx.now,actor:ctx.actor.name});return {...value,...after};});changed.amendments=history;
    }
   }
  }
  if(!prior&&list.some(value=>value.id===changed.id))fail('INVENTORY_ID_CONFLICT','Новый идентификатор уже занят');
  const sections:SectionRows={[section]:prior?list.map(value=>value===prior?changed:value):[...list,changed]};validateDatabase({...db,...sections});
  const session=section===SESSION?changed:null,warnings=session?draftWarnings(session):[];if(session)for(const value of session.rows as JsonRow[])if(value.costAcct===null||value.costFact===null)warnings.push(issue('INVENTORY_COST_UNKNOWN','Стоимость неизвестна; полный денежный итог не рассчитывается','cost',value.id as Identifier,'warning'));
  return {sections,changed:[{section,id:id(changed.id),type:prior?'update':'create'}],session,entityIds:section===SESSION?{sessionId:id(changed.id)}:{id:id(changed.id)},issues:[],warnings};
 }
 function preview(databaseValue:unknown,inputValue:unknown,contextValue:unknown):AssetInventoryResult {
  const input=parse(inputValue,true),clock=previewContext(contextValue),db=database(databaseValue);validateDatabase(db);const intent=copy(input) as Partial<AssetInventoryActionInput>;delete intent.reviewFingerprint;
  const importContext=input.action==='importLegacy'||input.action==='importRows'?{importSource:clock.source.importSource??null}:{};
  const review='sha256:'+fingerprint.sha256(stable({version:1,input:intent,today:clock.today,source:db,...importContext}));let previewId='asset-inventory-preview',index=0;const writes=footprint(input);while((db[writes[0]!]||[]).some(value=>value.id===previewId))previewId='asset-inventory-preview-'+(++index);
  const result:AssetInventoryResult={canApply:false,readSections:dependencies(),writeSections:writes,sections:{},changed:[],issues:[],warnings:[],fingerprint:review,reviewFingerprint:review,session:null,entityIds:{}};
  try{const built=build(db,input,{id:previewId,now:clock.today+'T12:00:00.000Z',today:clock.today,actor:{id:'preview',name:'Предварительная проверка',role:'admin'},...(own(clock.source,'importSource')?{importSource:row(clock.source.importSource)}:{})});Object.assign(result,built);result.canApply=!result.issues.length;}catch(error){const e=error as InventoryError;result.issues=e.issues?.length?e.issues:[issue(e.code||'INVENTORY_BLOCKED',e.message)];}
  return freeze(result);
 }
 function plan(databaseValue:unknown,inputValue:unknown,contextValue:unknown):AssetInventoryResult {
  const input=parse(inputValue),db=database(databaseValue),ctx=context(contextValue,footprint(input));validateDatabase(db);const reviewed=preview(db,input,{today:ctx.today,...(ctx.readable?{readable:ctx.readable}:{}),...(ctx.importSource?{importSource:ctx.importSource}:{})});
  if(reviewed.fingerprint!==input.reviewFingerprint)fail('STALE_REVIEW','Справочники, опись или рабочая дата изменились после проверки');if(!reviewed.canApply)fail('INVENTORY_BLOCKED',reviewed.issues.map(value=>value.message).join('; '),reviewed.issues);
  const built=build(db,input,ctx);if(built.issues.length)fail('INVENTORY_BLOCKED',built.issues.map(value=>value.message).join('; '),built.issues);
  return freeze({canApply:true,readSections:dependencies(),writeSections:footprint(input),...built,fingerprint:reviewed.fingerprint,reviewFingerprint:reviewed.fingerprint});
 }
 function protectChanges(previous:unknown,next:unknown,contextValue:unknown={}):true {
  const before=database(previous),after=database(next);if(equal(before,after))return true;
  const ctx=row(contextValue),intent=object(ctx.commandIntent)?ctx.commandIntent:null,command=intent&&object(intent.command)?intent.command:intent;
  if(command?.type!=='AssetInventoryAction')fail('INVENTORY_PROOF','Справочники и описи изменяются только подтверждённым действием инвентаризации');
  const proof=plan(before,command.input,ctx);for(const section of SECTIONS)if(!equal(after[section],proof.sections[section]??before[section]))fail('INVENTORY_PROOF','Изменения не совпадают с проверенным действием инвентаризации');return true;
 }
 function exactNumber(value:string|null):number|null {if(value===null)return null;try{return decimal.toNumberExact(value);}catch{return null;}}
 function total(values:(number|null)[]):{decimal:string|null;value:number|null;known:number;unknown:number} {const known=values.filter((value):value is number=>value!==null),unknown=values.length-known.length,result=unknown?null:decimal.sum(known);return {decimal:result,value:exactNumber(result),known:known.length,unknown};}
 function summary(rows:JsonRow[]):JsonRow {
  const groups=new Map<string,{unit:string|null;rows:JsonRow[]}>();for(const value of rows){const unit=(value.unit as string).trim(),key=unit?'unit:'+unit:'unknown:'+typed(value.id as Identifier);const group=groups.get(key)||{unit:unit||null,rows:[]};group.rows.push(value);groups.set(key,group);}
  const quantities=[...groups.values()].map(group=>{const acct=total(group.rows.map(value=>value.qtyAcct as number|null)),fact=total(group.rows.map(value=>value.qtyFact as number|null)),difference=acct.decimal===null||fact.decimal===null?null:decimal.sub(fact.decimal,acct.decimal);return {unit:group.unit,rowIds:group.rows.map(value=>value.id!),qtyAcct:acct.value,qtyAcctDecimal:acct.decimal,qtyFact:fact.value,qtyFactDecimal:fact.decimal,difference:exactNumber(difference),differenceDecimal:difference,unknownAcct:acct.unknown,unknownFact:fact.unknown};});
  const acct=total(rows.map(value=>value.costAcct as number|null)),fact=total(rows.map(value=>value.costFact as number|null)),difference=acct.decimal===null||fact.decimal===null?null:decimal.sub(fact.decimal,acct.decimal),diffs=rows.map(value=>value.qtyAcct===null||value.qtyFact===null?null:decimal.sub(value.qtyFact,value.qtyAcct));
  return {rows:rows.length,checked:rows.filter(value=>value.qtyFact!==null).length,unknownAcct:rows.filter(value=>value.qtyAcct===null).length,unknownFact:rows.filter(value=>value.qtyFact===null).length,match:diffs.filter(value=>value!==null&&decimal.compare(value,0)===0).length,shortage:diffs.filter(value=>value!==null&&decimal.compare(value,0)<0).length,surplus:diffs.filter(value=>value!==null&&decimal.compare(value,0)>0).length,quantities,costs:{costAcct:acct.value,costAcctDecimal:acct.decimal,costFact:fact.value,costFactDecimal:fact.decimal,difference:exactNumber(difference),differenceDecimal:difference,unknownAcct:acct.unknown,unknownFact:fact.unknown}};
 }
 function exportModel(sessionValue:unknown):JsonRow {
  const stored=storedSession(sessionValue),source=stored.status==='approved'?row(stored.snapshot):sessionContent(stored),rows:JsonRow[]=(source.rows as JsonRow[]).map(value=>{const qtyDiff=value.qtyAcct===null||value.qtyFact===null?null:decimal.sub(value.qtyFact,value.qtyAcct),costDiff=value.costAcct===null||value.costFact===null?null:decimal.sub(value.costFact,value.costAcct);return {...copy(value),qtyDifference:exactNumber(qtyDiff),qtyDifferenceDecimal:qtyDiff,costDifference:exactNumber(costDiff),costDifferenceDecimal:costDiff};}),groups=new Map<Identifier,JsonRow[]>();
  for(const value of rows){const list=groups.get(value.orgId as Identifier)||[];list.push(value);groups.set(value.orgId as Identifier,list);}
  const model:JsonRow={...copy(source),status:stored.status!,rows,summary:summary(rows),organizations:[...groups].map(([orgId,values])=>({orgId,name:values[0]!.orgName!,rows:copy(values),summary:summary(values)}))};if(stored.status==='approved')model.fingerprint=stored.fingerprint!;return freeze(model);
 }
 /** Current catalog quantities and the last approved observation are separate
  * measures. A projection never posts inventory differences to the catalog. */
 function quantityModel(databaseValue:unknown,optionsValue:unknown={},contextValue:unknown={}):JsonRow {
  const options=row(optionsValue),ctx=row(contextValue);rights(ctx);fields(options,['objectId','orgId','molId','account','search','asOf']);
  for(const key of ['objectId','orgId','molId'])if(own(options,key))id(options[key]);
  for(const key of ['account','search'])if(own(options,key))text(options[key],key,2000);
  const asOf=own(options,'asOf')?date(options.asOf,'Дата сверки'):null,db=database(databaseValue);validateDatabase(db);
  const search=String(options.search??'').trim().toLocaleLowerCase('ru-RU');
  const index=(section:string):Map<Identifier,JsonRow>=>new Map((db[section]||[]).map(value=>[value.id as Identifier,value]));
  const orgs=index('inventoryOrgs'),objects=index('inventoryObjects'),mols=index('inventoryMols');
  const approved=(db[SESSION]||[]).filter(value=>value.status==='approved'&&(asOf===null||String(value.date)<=asOf&&String((value.approval as JsonRow).date)<=asOf));
  // Draft revisions leave their last approved predecessor effective.
  const roots=new Map<Identifier,JsonRow>();for(const value of approved){const previous=roots.get(value.rootId as Identifier);if(!previous||Number(value.revision)>Number(previous.revision))roots.set(value.rootId as Identifier,value);}
  const observed=new Map<Identifier,{session:JsonRow;entry:JsonRow}[]>();for(const session of roots.values())for(const entry of session.rows as JsonRow[]){const values=observed.get(entry.itemId as Identifier)||[];values.push({session,entry});observed.set(entry.itemId as Identifier,values);}
  const result:JsonRow[]=[];
  for(const item of db.inventoryItems||[]){
   const mol=mols.get(item.molId as Identifier)!,org=orgs.get(mol.orgId as Identifier)!,object=objects.get(mol.objectId as Identifier)!;
   if(item.archived||mol.archived||org.archived||object.archived)continue;
   if(own(options,'objectId')&&object.id!==options.objectId||own(options,'orgId')&&org.id!==options.orgId||own(options,'molId')&&mol.id!==options.molId||options.account&&mol.accountCode!==options.account)continue;
   if(search&&![item.name,item.code,mol.name,org.name,object.name].some(value=>String(value).toLocaleLowerCase('ru-RU').includes(search)))continue;
   const candidates=observed.get(item.id as Identifier)||[],latest=candidates.reduce((latest,value)=>String(value.session.date)>latest?String(value.session.date):latest,''),sameDate=candidates.filter(value=>value.session.date===latest);
   sameDate.sort((a,b)=>String((b.session.approval as JsonRow).at).localeCompare(String((a.session.approval as JsonRow).at))||typed(a.session.id as Identifier).localeCompare(typed(b.session.id as Identifier)));
   const selected=sameDate[0],entry=selected?.entry;
   const signatures=new Set(sameDate.map(value=>stable([value.entry.objectId,value.entry.orgId,value.entry.molId,String(value.entry.unit).trim(),value.entry.qtyFact])));
   const status=!entry?'unrecorded':signatures.size>1?'ambiguous':entry.objectId!==object.id||entry.orgId!==org.id||entry.molId!==mol.id?'scopeChanged':String(entry.unit).trim()!==String(item.unit).trim()?'unitChanged':'known';
   const qtyAcct=item.qty as number|null,qtyFact=status==='known'?entry!.qtyFact as number|null:null,difference=qtyAcct===null||qtyFact===null?null:decimal.sub(qtyFact,qtyAcct);
   result.push({id:item.id!,itemId:item.id!,objectId:object.id!,objectName:object.name!,orgId:org.id!,orgName:org.name!,molId:mol.id!,molName:mol.name!,accountCode:mol.accountCode!,name:item.name!,code:item.code!,unit:item.unit!,note:item.note!,qtyAcct,qtyAcctDecimal:qtyAcct===null?null:decimal.parse(qtyAcct),qtyFact,qtyFactDecimal:qtyFact===null?null:decimal.parse(qtyFact),difference:exactNumber(difference),differenceDecimal:difference,inventoryDate:selected?.session.date??null,sessionId:signatures.size>1?null:selected?.session.id??null,sessionTitle:signatures.size>1?null:selected?.session.title??null,comparisonStatus:status});
  }
  const groups=new Map<string,JsonRow[]>();for(const value of result){const unit=String(value.unit).trim(),key=stable([value.objectId,value.orgId,unit||['unknown',typeof value.itemId,value.itemId]]),group=groups.get(key)||[];group.push(value);groups.set(key,group);}
  const totals:JsonRow[]=[...groups.values()].map(values=>{const first=values[0]!,acct=total(values.map(value=>value.qtyAcct as number|null)),fact=total(values.map(value=>value.qtyFact as number|null)),difference=acct.decimal===null||fact.decimal===null?null:decimal.sub(fact.decimal,acct.decimal),dates=values.map(value=>value.inventoryDate).filter((value):value is string=>typeof value==='string').sort();return {objectId:first.objectId!,objectName:first.objectName!,orgId:first.orgId!,orgName:first.orgName!,unit:String(first.unit).trim()||null,rows:values.length,qtyAcct:acct.value,qtyAcctDecimal:acct.decimal,qtyFact:fact.value,qtyFactDecimal:fact.decimal,difference:exactNumber(difference),differenceDecimal:difference,unknownAcct:acct.unknown,unknownFact:fact.unknown,inventoryDate:dates.length===values.length&&dates[0]===dates[dates.length-1]?dates[0]!:null,inventoryDateFrom:dates[0]??null,inventoryDateTo:dates[dates.length-1]??null};});
  return freeze({rows:result,totals,summary:{rows:result.length,objects:new Set(result.map(value=>typed(value.objectId as Identifier))).size,mols:new Set(result.map(value=>typed(value.molId as Identifier))).size,unknownAcct:result.filter(value=>value.qtyAcct===null).length,unknownFact:result.filter(value=>value.qtyFact===null).length},issues:[]});
 }
 function validate(value:unknown):{valid:true;issues:AssetInventoryIssue[];warnings:AssetInventoryIssue[]} {const db=database(value);validateDatabase(db);const warnings:AssetInventoryIssue[]=[];for(const session of db[SESSION]||[])if(session.status==='draft')warnings.push(...draftWarnings(session));return freeze({valid:true as const,issues:[],warnings});}
 return Object.freeze({apiVersion:1 as const,parse,dependencies,footprint,preview,plan,apply:plan,protectChanges,validateChanges:protectChanges,validate,snapshotDigest,exportModel,quantityModel});
}
export type AssetInventoryAPI=ReturnType<typeof createAssetInventory>;
