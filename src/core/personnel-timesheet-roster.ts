import type {Identifier,JsonRow,JsonValue,SectionRows} from './platform-contracts';
import type {PersonnelKindsAPI,PersonnelKind} from './personnel-kinds';
import type {RequestFingerprintAPI} from './request-fingerprint';

export interface PersonnelTimesheetRosterRow extends JsonRow {id:Identifier;name:string;days:JsonRow;employeeId?:Identifier}
export interface PersonnelTimesheetRosterModel extends JsonRow {version:1;kind:PersonnelKind;rows:PersonnelTimesheetRosterRow[]}
export interface PersonnelTimesheetRosterOptions {createIds:{rowId:Identifier;id:Identifier}[];skipRowIds?:Identifier[]}
export interface PersonnelTimesheetRosterCandidate {id:Identifier;name:string;org:string;personnelNumber:string}
export interface PersonnelTimesheetRosterItem {rowId:Identifier;status:'matched'|'create'|'skip'|'blocked';employeeId?:Identifier;reason:string;warnings:string[];candidates:PersonnelTimesheetRosterCandidate[]}
export interface PersonnelTimesheetRosterPreview {canApply:boolean;items:PersonnelTimesheetRosterItem[];model:PersonnelTimesheetRosterModel;drivers:JsonRow[];createdIds:Identifier[];fingerprint:string}
interface Contracts {apiVersion:number;identifier(value:unknown):value is Identifier;validateSections(value:unknown,names:readonly string[]):SectionRows}
interface Timesheet {apiVersion?:number;validate(value:unknown):unknown}
interface RosterError extends Error {code:string;status:number}
interface Source {row:PersonnelTimesheetRosterRow;item:PersonnelTimesheetRosterItem;name:string;org:string;orgKey:string;number:string;site:string;target?:JsonRow}

/** A review proposal only. Existing cards and timesheet facts are never rewritten.
 * Persist the proposed directory and linked document together after a fresh review. */
export function createPersonnelTimesheetRoster(contracts:Contracts,personnelKinds:PersonnelKindsAPI,getTimesheet:()=>Timesheet,fingerprint:RequestFingerprintAPI){
 const own=(value:object,key:PropertyKey):boolean=>Object.prototype.hasOwnProperty.call(value,key);
 const object=(value:unknown):value is JsonRow=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 function fail(code:string,message:string):never {const error=new Error(message) as RosterError;error.name='PersonnelTimesheetRosterError';error.code=code;error.status=400;throw error;}
 if(contracts?.apiVersion!==1||personnelKinds?.apiVersion!==1||typeof getTimesheet!=='function'||typeof fingerprint?.stableSerialize!=='function'||typeof fingerprint.sha256!=='function')fail('MODULE_UNAVAILABLE','Не загружено ядро переноса сотрудников из табеля');
 const clean=(value:unknown):string=>typeof value==='string'?value.trim().replace(/\s+/gu,' '):'';
 const normalized=(value:unknown):string=>clean(value).toLocaleLowerCase('ru');
 // Personnel numbers retain leading zeroes, punctuation and internal spaces.
 const number=(value:unknown):string=>typeof value==='string'?value.trim():typeof value==='number'&&Number.isSafeInteger(value)?String(value):'';
 const key=(value:Identifier):string=>typeof value+':'+String(value);
 const validId=(value:unknown):value is Identifier=>contracts.identifier(value)&&(typeof value!=='number'||Number.isSafeInteger(value));
 const groupKey=(org:string,value:string):string=>JSON.stringify([org,value]);
 const personnelNumber=(person:JsonRow):string=>number(person.personnelNumber)||number(person.employeeNumber);
 function freeze<T>(value:T):T {if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const nested of Object.values(value))freeze(nested);Object.freeze(value);}return value;}
 function safe(value:unknown):JsonValue {
  const parents=new Set<object>();let nodes=0;
  function visit(item:unknown,depth:number):JsonValue {
   if(++nodes>1000000||depth>100)fail('TIMESHEET_ROSTER_LIMIT','Слишком большой табель или справочник сотрудников');
   if(item===null||typeof item==='string'||typeof item==='boolean'||typeof item==='number'&&Number.isFinite(item))return item;
   if(typeof item!=='object'||parents.has(item))fail('TIMESHEET_ROSTER_JSON','Нужны обычные данные JSON без циклов');
   const array=Array.isArray(item),prototype:unknown=Object.getPrototypeOf(item);
   if(!array&&!(prototype===null||typeof prototype==='object'&&prototype!==null&&Object.getPrototypeOf(prototype)===null))fail('TIMESHEET_ROSTER_JSON','Недопустимый объект данных');
   parents.add(item);
   for(const property of Reflect.ownKeys(item)){
    if(array&&property==='length')continue;
    const descriptor=Object.getOwnPropertyDescriptor(item,property);
    if(typeof property!=='string'||!descriptor?.enumerable||descriptor.get||descriptor.set||['toJSON','__proto__','constructor','prototype'].includes(property)||array&&(!/^(?:0|[1-9]\d*)$/.test(property)||Number(property)>=item.length))fail('TIMESHEET_ROSTER_JSON','Исполняемые и скрытые свойства данных запрещены');
   }
   let result:JsonValue;
   if(array){if(item.length>200000)fail('TIMESHEET_ROSTER_LIMIT','Слишком много строк');const output:JsonValue[]=[];for(let index=0;index<item.length;index++){const descriptor=Object.getOwnPropertyDescriptor(item,String(index));if(!descriptor)fail('TIMESHEET_ROSTER_JSON','Пропуск элемента массива');output.push(visit(descriptor.value,depth+1));}result=output;}
   else {const output:JsonRow={};for(const property of Object.keys(item))output[property]=visit(Object.getOwnPropertyDescriptor(item,property)!.value,depth+1);result=output;}
   parents.delete(item);return result;
  }
  return visit(value,0);
 }
 function row(value:unknown):JsonRow {const cloned=safe(value);if(!object(cloned))fail('TIMESHEET_ROSTER_JSON','Нужен объект данных');return cloned;}
 function preview(databaseValue:unknown,modelValue:unknown,optionsValue:unknown):PersonnelTimesheetRosterPreview {
  if(!object(databaseValue))fail('TIMESHEET_ROSTER_DATABASE','Не загружен справочник сотрудников');
  const descriptor=Object.getOwnPropertyDescriptor(databaseValue,'drivers');
  if(descriptor&&(descriptor.get||descriptor.set||!descriptor.enumerable))fail('TIMESHEET_ROSTER_JSON','Справочник сотрудников должен содержать обычные данные');
  const section=safe(descriptor?descriptor.value:[]);
  if(!Array.isArray(section))fail('TIMESHEET_ROSTER_DATABASE','Справочник сотрудников должен быть списком');
  const drivers=contracts.validateSections({drivers:section},['drivers']).drivers!;
  const rawModel=row(modelValue);let timesheet:Timesheet;
  try {timesheet=getTimesheet();}catch {fail('MODULE_UNAVAILABLE','Не загружено ядро табелей');}
  if(typeof timesheet?.validate!=='function')fail('MODULE_UNAVAILABLE','Не загружено ядро табелей');
  timesheet.validate(rawModel);
  const model=rawModel as PersonnelTimesheetRosterModel,options=row(optionsValue);
  const sourceSnapshot=fingerprint.stableSerialize({drivers,model});
  for(const field of Object.keys(options))if(!['createIds','skipRowIds'].includes(field))fail('TIMESHEET_ROSTER_OPTION','Неизвестное поле переноса: '+field);
  if(!Array.isArray(options.createIds))fail('TIMESHEET_ROSTER_IDS','Для новых карточек нужны заранее выделенные ID');
  const rowIds=new Set(model.rows.map(entry=>key(entry.id))),createIds=new Map<string,Identifier>(),allocatedIds=new Set<string>();
  for(const value of options.createIds){
   if(!object(value)||Object.keys(value).some(field=>!['rowId','id'].includes(field))||!validId(value.rowId)||!validId(value.id)||!rowIds.has(key(value.rowId))||createIds.has(key(value.rowId))||allocatedIds.has(key(value.id)))fail('TIMESHEET_ROSTER_IDS','Проверьте уникальные ID строк и новых карточек сотрудников');
   createIds.set(key(value.rowId),value.id);allocatedIds.add(key(value.id));
  }
  if(own(options,'skipRowIds')&&!Array.isArray(options.skipRowIds))fail('TIMESHEET_ROSTER_SKIP','Нужен список пропускаемых строк');
  const skipped=new Set<string>();
  for(const value of (options.skipRowIds||[]) as JsonValue[]){if(!validId(value)||!rowIds.has(key(value))||skipped.has(key(value)))fail('TIMESHEET_ROSTER_SKIP','Проверьте ID пропускаемых строк');skipped.add(key(value));}
  const byId=new Map<string,JsonRow[]>(),byNumber=new Map<string,JsonRow[]>(),byName=new Map<string,JsonRow[]>(),allNumbers=new Map<string,JsonRow[]>(),allNames=new Map<string,JsonRow[]>();
  const add=(map:Map<string,JsonRow[]>,index:string,person:JsonRow):void=>{const values=map.get(index)||[];values.push(person);map.set(index,values);};
  for(const person of drivers){
   if(validId(person.id))add(byId,key(person.id),person);
   const org=normalized(person.org),name=normalized(person.name),num=personnelNumber(person);
   if(num){add(byNumber,groupKey(org,num),person);add(allNumbers,num,person);}
   if(name){add(byName,groupKey(org,name),person);add(allNames,name,person);}
  }
  const candidate=(person:JsonRow):PersonnelTimesheetRosterCandidate|null=>validId(person.id)?{id:person.id,name:clean(person.name),org:clean(person.org),personnelNumber:personnelNumber(person)}:null;
  function block(source:Source,reason:string,people:JsonRow[]=[]):void {source.item.status='blocked';source.item.reason=reason;delete source.item.employeeId;delete source.target;source.item.candidates=people.map(candidate).filter((value):value is PersonnelTimesheetRosterCandidate=>value!==null);}
  const sources:Source[]=model.rows.map(entry=>({row:entry,item:{rowId:entry.id,status:skipped.has(key(entry.id))?'skip':'create',reason:skipped.has(key(entry.id))?'Оставить строку только в табеле':'Будет создана новая карточка',warnings:[],candidates:[]},name:normalized(entry.name),org:clean(entry.department)||clean(model.org),orgKey:normalized(clean(entry.department)||clean(model.org)),number:number(entry.personnelNumber),site:clean(entry.site)}));
  function accept(source:Source,person:JsonRow,reason:string):void {
   if(!validId(person.id)||(byId.get(key(person.id))||[]).length!==1){block(source,'У найденной карточки нет однозначного ID. Исправьте справочник или пропустите строку',[person]);return;}
   if(normalized(person.org)!==source.orgKey){block(source,'У карточки указана другая организация. Проверьте организацию или пропустите строку',[person]);return;}
   if(person.archived||person.deleted||person.cancelled||person.status==='cancelled'||own(person,'mergedInto')){block(source,'Карточка сотрудника в архиве или объединена. Восстановите карточку либо пропустите строку',[person]);return;}
   if(!personnelKinds.matchesRole(person,model.kind)){block(source,'У карточки нет роли '+(model.kind==='driver'?'водителя':'оператора ДЭС')+'. Исправьте карточку либо пропустите строку',[person]);return;}
   source.target=person;source.item.status='matched';source.item.employeeId=person.id;source.item.reason=reason;source.item.candidates=[candidate(person)!];
  }
  for(const source of sources){
   if(source.item.status==='skip')continue;
   if(!source.orgKey){block(source,'Укажите организацию в строке или в шапке табеля либо пропустите строку');continue;}
   if(own(source.row,'employeeId')){
    const employeeId=source.row.employeeId;
    if(!validId(employeeId)){block(source,'Некорректная ссылка на сотрудника. Исправьте строку табеля или пропустите её');continue;}
    const found=byId.get(key(employeeId))||[];
    if(found.length!==1){block(source,'Сотрудник по сохранённой ссылке не найден однозначно. Исправьте ссылку или пропустите строку',found);continue;}
    accept(source,found[0]!,'Сопоставлен по сохранённому ID сотрудника');
    continue;
   }
   const numbered=source.number?byNumber.get(groupKey(source.orgKey,source.number))||[]:[];
   if(numbered.length){
    if(numbered.length!==1){block(source,'Табельный номер повторяется в организации. Уточните карточки или пропустите строку',numbered);continue;}
    if(normalized(numbered[0]!.name)!==source.name){block(source,'По табельному номеру найдено другое ФИО. Проверьте номер и ФИО или пропустите строку',numbered);continue;}
    accept(source,numbered[0]!,'Сопоставлен по табельному номеру и организации');continue;
   }
   const named=byName.get(groupKey(source.orgKey,source.name))||[];
   if(named.length){
    if(named.length!==1){block(source,'В организации есть несколько карточек с этим ФИО. Уточните табельный номер или пропустите строку',named);continue;}
    if(source.number&&personnelNumber(named[0]!)&&source.number!==personnelNumber(named[0]!)){block(source,'ФИО совпадает, но табельные номера различаются. Проверьте номер или пропустите строку',named);continue;}
    accept(source,named[0]!,'Сопоставлен по точному ФИО и организации');continue;
   }
   const elsewhere=[...(source.number?allNumbers.get(source.number)||[]:[]),...(allNames.get(source.name)||[])].filter(person=>normalized(person.org)!==source.orgKey);
   if(elsewhere.length){block(source,'Совпадение найдено в другой организации. Проверьте организацию, ФИО и номер или пропустите строку',[...new Set(elsewhere)]);continue;}
  }
  // Resolve repeated source rows as a set, so the result never depends on which
  // occurrence happens to be listed first for identity or conflict detection.
  const sourceNumbers=new Map<string,Source[]>(),sourceNames=new Map<string,Source[]>();
  const addSource=(map:Map<string,Source[]>,index:string,source:Source):void=>{const values=map.get(index)||[];values.push(source);map.set(index,values);};
  for(const source of sources)if(source.item.status!=='skip'&&source.orgKey){if(source.number)addSource(sourceNumbers,groupKey(source.orgKey,source.number),source);addSource(sourceNames,groupKey(source.orgKey,source.name),source);}
  for(const members of sourceNumbers.values()){
   const names=new Set(members.map(source=>source.name)),targets=new Set(members.filter(source=>source.target).map(source=>key(source.target!.id as Identifier)));
   // Explicit IDs have already been validated and remain authoritative even
   // when a historical document repeats a number or an old display name.
   if(names.size>1||targets.size>1)for(const source of members)if(!own(source.row,'employeeId'))block(source,'Один табельный номер относится к разным сотрудникам в табеле. Исправьте строки или пропустите лишние');
  }
  for(const members of sourceNames.values()){
   const targetNumbers=new Map<string,Set<string>>();
   for(const source of members)if(source.target&&source.number){const index=key(source.target.id as Identifier),values=targetNumbers.get(index)||new Set<string>();values.add(source.number);targetNumbers.set(index,values);}
   for(const source of members)if(source.target&&!own(source.row,'employeeId')&&(targetNumbers.get(key(source.target.id as Identifier))?.size||0)>1)block(source,'Разные табельные номера ведут к одной карточке без однозначного номера. Уточните карточку или пропустите строку');
  }
  const groups=new Map<string,Source[]>();
  for(const source of sources){
   if(source.item.status!=='create')continue;
   const named=sourceNames.get(groupKey(source.orgKey,source.name))||[],numbers=[...new Set(named.map(entry=>entry.number).filter(Boolean))];
   if(!source.number&&numbers.length>1){block(source,'У одинакового ФИО в табеле несколько табельных номеров. Укажите номер в этой строке или пропустите её');continue;}
   const selectedNumber=source.number||numbers[0]||'',members=selectedNumber?sourceNumbers.get(groupKey(source.orgKey,selectedNumber))||named:named;
   if(members.some(entry=>entry.item.status==='blocked')){block(source,'Связанная строка табеля содержит противоречие. Исправьте её или пропустите конфликтующие строки');continue;}
   const targets=[...new Set(members.map(entry=>entry.target).filter((value):value is JsonRow=>!!value))];
   if(targets.length===1){accept(source,targets[0]!,'Сопоставлен с повторной строкой того же сотрудника');continue;}
   if(targets.length>1){block(source,'Повторные строки относятся к разным карточкам. Уточните номера или пропустите строку',targets);continue;}
   const index=selectedNumber?groupKey(source.orgKey,'number:'+selectedNumber):groupKey(source.orgKey,'name:'+source.name),values=groups.get(index)||[];values.push(source);groups.set(index,values);
  }
  const createdIds:Identifier[]=[],usedIds=new Set(byId.keys());
  for(const members of groups.values()){
   const first=members[0]!,identifier=createIds.get(key(first.row.id));
   if(identifier===undefined||usedIds.has(key(identifier))){for(const source of members)block(source,identifier===undefined?'Не выделен ID новой карточки. Откройте проверку переноса повторно':'ID новой карточки уже занят. Откройте проверку переноса повторно');continue;}
   const sites=[...new Set(members.map(source=>normalized(source.site)))],num=members.find(source=>source.number)?.number||'';
   const person:JsonRow={id:identifier,name:clean(first.row.name),org:first.org,site:sites.length===1?first.site:'',personnelNumber:num,personnelRoles:[model.kind],employmentStatus:'active'};
   drivers.push(person);createdIds.push(identifier);usedIds.add(key(identifier));
   for(const source of members){source.item.employeeId=identifier;source.item.reason=members.length>1?'Новая карточка для повторных строк одного сотрудника':'Будет создана новая карточка';if(sites.length>1)source.item.warnings.push('В табеле несколько объектов: карточка будет создана без текущего объекта');}
  }
  for(const source of sources)if(source.item.status==='matched'||source.item.status==='create')if(source.item.employeeId!==undefined)source.row.employeeId=source.item.employeeId;
  const items=sources.map(source=>source.item),canApply=items.every(item=>item.status!=='blocked');
  const review={version:1,source:sourceSnapshot,createIds:model.rows.filter(entry=>createIds.has(key(entry.id))).map(entry=>({rowId:entry.id,id:createIds.get(key(entry.id))!})),skipRowIds:model.rows.filter(entry=>skipped.has(key(entry.id))).map(entry=>entry.id),items:items.map(item=>({rowId:item.rowId,status:item.status,...(item.employeeId===undefined?{}:{employeeId:item.employeeId})}))};
  const digest='sha256:'+fingerprint.sha256(fingerprint.stableSerialize(review));
  return freeze({canApply,items,model,drivers,createdIds,fingerprint:digest});
 }
 return Object.freeze({apiVersion:1 as const,preview});
}
export type PersonnelTimesheetRosterAPI=ReturnType<typeof createPersonnelTimesheetRoster>;
