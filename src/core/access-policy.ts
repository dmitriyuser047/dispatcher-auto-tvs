import type {JsonRow,JsonValue} from './platform-contracts';
import type {EntityIdentityAPI} from './entity-identity';

export type AccessMatch=string|Readonly<{any:true}>;
export interface AccessGrant {org:AccessMatch;site:AccessMatch;actions?:readonly string[]}
export interface AccessSectionRule {actions?:readonly string[];readFields?:readonly string[];writeFields?:readonly string[]}
export interface AccessPolicyDescriptor {version:1;grants:readonly AccessGrant[];sections?:Readonly<Record<string,AccessSectionRule>>;sharedWrite?:readonly string[]}
export type AccessFact=Readonly<{state:'known';value:string}>|Readonly<{state:'unknown'}>;
export interface AccessOwnerFacts {org:AccessFact;site:AccessFact}
export interface AccessReadRequirement {sections:readonly string[];owners:readonly AccessOwnerFacts[];complete:boolean}
export interface AccessFieldGuard {path:readonly string[];requires:AccessReadRequirement;deniedValue?:JsonValue}
export interface AccessRowFacts {kind:'owned'|'shared'|'unknown';owners:readonly AccessOwnerFacts[];readRequirements?:AccessReadRequirement;fieldGuards?:readonly AccessFieldGuard[]}
export type AccessPhase='before'|'after';
export interface AccessCeiling {
 readable:readonly string[];writable:readonly string[];
 actions?:Readonly<Record<string,readonly string[]>>;
 readFields?:Readonly<Record<string,readonly string[]>>;
 writeFields?:Readonly<Record<string,readonly string[]>>;
}
export interface AccessContext extends AccessCeiling {resolve(section:string,row:Readonly<JsonRow>,phase:AccessPhase):AccessRowFacts}
interface Contracts {apiVersion:number;identifier(value:unknown):boolean}
interface Registry {apiVersion:number;sections:readonly string[]}
interface Hash {sha256(value:string):string}
interface AccessError extends Error {code:string;status:number}
interface Prepared {policy:AccessPolicyDescriptor|null;ceiling:AccessCeiling;resolve:AccessContext['resolve']}
const dangerous=['__proto__','constructor','prototype','toJSON'];
const readerActions=['read','print','export','print:capture','print:export'];

/** Pure row/field policy. Only its caller can supply ownership and role ceilings. */
export function createAccessPolicy(contracts:Contracts,schema:Registry,identity:EntityIdentityAPI,getHash?:()=>Hash){
 function fail(code:string,message:string,status=400):never {const error=new Error(message) as AccessError;error.name='AccessPolicyError';error.code=code;error.status=status;throw error;}
 const denied=():never=>fail('ACCESS_DENIED','Недостаточно прав для выбранных данных и действия',403);
 if(contracts?.apiVersion!==1||schema?.apiVersion!==1||identity?.apiVersion!==1||!Array.isArray(schema.sections))fail('MODULE_UNAVAILABLE','Не загружены правила доступа');
 const sections=new Set(schema.sections);
 const own=(value:object,key:string):boolean=>Object.prototype.hasOwnProperty.call(value,key);
 const object=(value:unknown):value is JsonRow=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 function safe(value:unknown,code='ACCESS_POLICY_INVALID'):JsonValue {
  const parents=new Set<object>();let count=0;
  function read(item:unknown,depth:number):JsonValue {
   if(++count>1000000||depth>80)fail(code,'Превышен размер данных правил доступа');
   if(item===null||typeof item==='string'||typeof item==='boolean'||typeof item==='number'&&Number.isFinite(item))return item;
   if(!item||typeof item!=='object'||parents.has(item))fail(code,'Нужны конечные данные JSON');
   const array=Array.isArray(item),proto:unknown=Object.getPrototypeOf(item);
   if(!array&&!(proto===null||typeof proto==='object'&&proto!==null&&Object.getPrototypeOf(proto)===null))fail(code,'Недопустимый объект правил доступа');
   for(const key of Reflect.ownKeys(item)){
    if(array&&key==='length')continue;
    const descriptor=Object.getOwnPropertyDescriptor(item,key);
    if(typeof key!=='string'||!descriptor?.enumerable||descriptor.get||descriptor.set||dangerous.includes(key)||array&&!/^(0|[1-9]\d*)$/.test(key))fail(code,'Исполняемые и скрытые свойства запрещены');
   }
   parents.add(item);let result:JsonValue;
   if(array){if(item.length>100000)fail(code,'Слишком много строк');const list:JsonValue[]=[];for(let index=0;index<item.length;index++){const descriptor=Object.getOwnPropertyDescriptor(item,String(index));if(!descriptor)fail(code,'Пропуск строки массива');list.push(read(descriptor.value,depth+1));}result=list;}
   else{const row:JsonRow={};for(const key of Object.keys(item))row[key]=read(Object.getOwnPropertyDescriptor(item,key)!.value,depth+1);result=row;}
   parents.delete(item);return result;
  }
  return read(value,0);
 }
 function record(value:unknown,code='ACCESS_POLICY_INVALID'):JsonRow {const result=safe(value,code);if(!object(result))fail(code,'Нужен объект правил доступа');return result;}
 function frozen<T>(value:T):T {if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))frozen(child);Object.freeze(value);}return value;}
 function stable(value:unknown):string {if(value===undefined)return 'undefined';if(value===null||typeof value!=='object')return JSON.stringify(value);return Array.isArray(value)?'['+value.map(stable).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable((value as Record<string,unknown>)[key])).join(',')+'}';}
 function keys(row:JsonRow,allowed:readonly string[],code='ACCESS_POLICY_INVALID'):void {if(Object.keys(row).some(key=>!allowed.includes(key)))fail(code,'Неизвестное поле правил доступа');}
 function list(value:unknown,kind:'sections'|'actions'|'fields',code='ACCESS_POLICY_INVALID'):string[] {
  if(!Array.isArray(value)||value.length>500||value.some(item=>typeof item!=='string'||!item||item.length>200||item.includes('\0')||dangerous.includes(item)||kind==='actions'&&item!=='*'&&!/^[a-zA-Z][a-zA-Z0-9:_-]*$/.test(item)||kind==='sections'&&item!=='*'&&!sections.has(item)))fail(code,'Некорректный список разрешений');
  const result=[...new Set(value as string[])].sort();return result.includes('*')?['*']:result;
 }
 function match(value:JsonValue|undefined):AccessMatch {if(typeof value==='string'&&value.length<=500&&!value.includes('\0'))return value;if(object(value)){keys(value,['any']);if(value.any===true)return {any:true};}return fail('ACCESS_POLICY_INVALID','Укажите точную область или явный wildcard');}
 function normalize(value:unknown):AccessPolicyDescriptor|null {
  if(value===undefined||value===null)return null;
  const input=record(value);keys(input,['version','grants','sections','sharedWrite']);
  if(input.version!==1||!Array.isArray(input.grants)||input.grants.length>200)fail('ACCESS_POLICY_INVALID','Неизвестная версия или состав правил доступа');
  const grants:AccessGrant[]=input.grants.map(item=>{if(!object(item))fail('ACCESS_POLICY_INVALID','Некорректная область доступа');keys(item,['org','site','actions']);const grant:AccessGrant={org:match(item.org),site:match(item.site)};if(own(item,'actions'))grant.actions=list(item.actions,'actions');return grant;});
  const unique=[...new Map(grants.map(grant=>[stable(grant),grant])).entries()].sort(([left],[right])=>left<right?-1:left>right?1:0).map(([,grant])=>grant);
  const result:AccessPolicyDescriptor={version:1,grants:unique};
  if(own(input,'sections')){
   if(!object(input.sections))fail('ACCESS_POLICY_INVALID','Некорректные разделы правил доступа');const rules:Record<string,AccessSectionRule>={};
   for(const name of Object.keys(input.sections).sort()){
    const source=input.sections[name];if(!sections.has(name)||!object(source))fail('ACCESS_POLICY_INVALID','Неизвестный раздел правил доступа');keys(source,['actions','readFields','writeFields']);const rule:AccessSectionRule={};
    for(const field of ['actions','readFields','writeFields'] as const)if(own(source,field))rule[field]=list(source[field],field==='actions'?'actions':'fields');rules[name]=rule;
   }result.sections=rules;
  }
  if(own(input,'sharedWrite'))result.sharedWrite=list(input.sharedWrite,'sections');return frozen(result);
 }
 function ceiling(value:unknown):AccessCeiling {
  if(!value||typeof value!=='object'||Array.isArray(value))fail('ACCESS_CONTEXT_INVALID','Не подтверждены права роли');
  // The resolver is an explicitly injected capability, never serialized data.
  const descriptors=Object.getOwnPropertyDescriptors(value),input:JsonRow={};
  for(const field of ['readable','writable','actions','readFields','writeFields']){
   const descriptor=descriptors[field];if(descriptor?.get||descriptor?.set)fail('ACCESS_CONTEXT_INVALID','Не подтверждены права роли');if(descriptor&&descriptor.value!==undefined)input[field]=safe(descriptor.value,'ACCESS_CONTEXT_INVALID');
  }
  const out:AccessCeiling={readable:list(input.readable,'sections','ACCESS_CONTEXT_INVALID'),writable:list(input.writable,'sections','ACCESS_CONTEXT_INVALID')};
  for(const field of ['actions','readFields','writeFields'] as const)if(own(input,field)){
   const source=input[field];if(!object(source))fail('ACCESS_CONTEXT_INVALID','Не подтверждены ограничения роли');const map:Record<string,string[]>={};
   for(const name of Object.keys(source).sort()){if(!sections.has(name))fail('ACCESS_CONTEXT_INVALID','Неизвестный раздел роли');map[name]=list(source[name],field==='actions'?'actions':'fields','ACCESS_CONTEXT_INVALID');}out[field]=map;
  }
  return frozen(out);
 }
 function policyStamp(value:unknown,role:AccessCeiling):string {const policy=normalize(value),base=ceiling(role),hash=getHash?.();if(typeof hash?.sha256!=='function')fail('MODULE_UNAVAILABLE','Не загружена проверка отпечатка доступа');const digest=hash.sha256(stable({version:1,policy,ceiling:base}));if(!/^[a-f0-9]{64}$/.test(digest))fail('MODULE_UNAVAILABLE','Некорректный отпечаток доступа');return 'sha256:'+digest;}
 function prepare(value:unknown,context:AccessContext):Prepared {
  const base=ceiling(context),descriptor=Object.getOwnPropertyDescriptor(context,'resolve');
  if(!descriptor||descriptor.get||descriptor.set||typeof descriptor.value!=='function')fail('ACCESS_CONTEXT_INVALID','Не подтверждено разрешение областей строк');
  return {policy:normalize(value),ceiling:base,resolve:descriptor.value as AccessContext['resolve']};
 }
 const includes=(values:readonly string[]|undefined,value:string):boolean=>values===undefined||values.includes('*')||values.includes(value);
 function sectionAllowed(prepared:Prepared,section:string,action:string):boolean {
  if(!sections.has(section)||typeof action!=='string'||!action||action.length>200||!/^[a-zA-Z][a-zA-Z0-9:_-]*$/.test(action))return false;
  return includes(readerActions.includes(action)?prepared.ceiling.readable:prepared.ceiling.writable,section)&&includes(prepared.ceiling.actions?.[section],action)&&includes(prepared.policy?.sections?.[section]?.actions,action);
 }
 const any=(value:AccessMatch):boolean=>typeof value!=='string';
 const unrestricted=(policy:AccessPolicyDescriptor|null,action:string):boolean=>policy===null||policy.grants.some(grant=>any(grant.org)&&any(grant.site)&&includes(grant.actions,action));
 function ownerAllowed(policy:AccessPolicyDescriptor|null,owner:AccessOwnerFacts,action:string):boolean {
  if(policy===null)return true;
  return policy.grants.some(grant=>{
   if(!includes(grant.actions,action))return false;if(any(grant.org)&&any(grant.site))return true;
   if(owner.org.state!=='known'||!owner.org.value.trim())return false;
   if(typeof grant.org==='string'&&owner.org.value!==grant.org)return false;
   return any(grant.site)||owner.site.state==='known'&&!!owner.site.value.trim()&&owner.site.value===grant.site;
  });
 }
 function factValue(value:JsonValue|undefined):AccessFact {
  if(!object(value))fail('ACCESS_CONTEXT_INVALID','Некорректное доказательство области');keys(value,['state','value'],'ACCESS_CONTEXT_INVALID');
  if(value.state==='known'&&typeof value.value==='string')return {state:'known',value:value.value};
  if(value.state==='unknown'&&!own(value,'value'))return {state:'unknown'};return fail('ACCESS_CONTEXT_INVALID','Некорректный факт области');
 }
 function owners(value:JsonValue|undefined):AccessOwnerFacts[] {
  if(!Array.isArray(value)||value.length>10000)fail('ACCESS_CONTEXT_INVALID','Некорректные области строки');return value.map(item=>{if(!object(item))fail('ACCESS_CONTEXT_INVALID','Некорректная область строки');keys(item,['org','site'],'ACCESS_CONTEXT_INVALID');return {org:factValue(item.org),site:factValue(item.site)};});
 }
 function requirement(value:JsonValue|undefined):AccessReadRequirement {
  if(!object(value))fail('ACCESS_CONTEXT_INVALID','Некорректное требование источника');keys(value,['sections','owners','complete'],'ACCESS_CONTEXT_INVALID');if(typeof value.complete!=='boolean')fail('ACCESS_CONTEXT_INVALID','Не подтверждена полнота источников');const required=list(value.sections,'sections','ACCESS_CONTEXT_INVALID');return {sections:required.includes('*')?[...sections].sort():required,owners:owners(value.owners),complete:value.complete};
 }
 function facts(prepared:Prepared,section:string,row:JsonRow,phase:AccessPhase):AccessRowFacts {
  const input=record(prepared.resolve(section,frozen(record(row,'ACCESS_ROW_INVALID')),phase),'ACCESS_CONTEXT_INVALID');keys(input,['kind','owners','readRequirements','fieldGuards'],'ACCESS_CONTEXT_INVALID');
  if(!['owned','shared','unknown'].includes(input.kind as string))fail('ACCESS_CONTEXT_INVALID','Не определён вид области строки');
  const out:AccessRowFacts={kind:input.kind as AccessRowFacts['kind'],owners:owners(input.owners)};
  if(own(input,'readRequirements'))out.readRequirements=requirement(input.readRequirements);
  if(own(input,'fieldGuards')){
   if(!Array.isArray(input.fieldGuards)||input.fieldGuards.length>500)fail('ACCESS_CONTEXT_INVALID','Некорректные защищённые поля');
   out.fieldGuards=input.fieldGuards.map(item=>{if(!object(item))fail('ACCESS_CONTEXT_INVALID','Некорректная защита поля');keys(item,['path','requires','deniedValue'],'ACCESS_CONTEXT_INVALID');
    if(!Array.isArray(item.path)||!item.path.length||item.path.length>40||item.path.some(token=>typeof token!=='string'||!token||token.length>200||dangerous.includes(token)))fail('ACCESS_CONTEXT_INVALID','Некорректный путь поля');
    const guard:AccessFieldGuard={path:item.path as string[],requires:requirement(item.requires)};if(own(item,'deniedValue'))guard.deniedValue=item.deniedValue!;return guard;
   });
  }return out;
 }
 function reads(prepared:Prepared,needed:AccessReadRequirement):boolean {
  return needed.sections.every(section=>sectionAllowed(prepared,section,'read'))&&
   (needed.complete||unrestricted(prepared.policy,'read'))&&needed.owners.every(owner=>ownerAllowed(prepared.policy,owner,'read'));
 }
 function rowAllowed(prepared:Prepared,section:string,action:string,value:AccessRowFacts):boolean {
  if(!sectionAllowed(prepared,section,action)||prepared.policy?.grants.length===0)return false;
  if(value.readRequirements&&!reads(prepared,value.readRequirements))return false;
  if(value.kind==='shared')return (prepared.policy===null||prepared.policy.grants.some(grant=>includes(grant.actions,action)))&&(readerActions.includes(action)||prepared.policy===null||includes(prepared.policy.sharedWrite??[],section));
  if(value.kind==='unknown'||!value.owners.length)return unrestricted(prepared.policy,action);
  return value.owners.every(owner=>ownerAllowed(prepared.policy,owner,action));
 }
 function fieldAllowed(prepared:Prepared,section:string,field:string,action:'read'|'write'):boolean {
  return field==='id'&&action==='read'||includes(prepared.ceiling[action==='read'?'readFields':'writeFields']?.[section],field)&&includes(prepared.policy?.sections?.[section]?.[action==='read'?'readFields':'writeFields'],field);
 }
 interface PathValue {present:boolean;value?:JsonValue}
 function at(row:JsonRow,path:readonly string[]):PathValue {
  let current:JsonValue=row;for(const token of path){if(!current||typeof current!=='object'||!own(current,token))return {present:false};current=(current as JsonRow)[token]!;}return {present:true,value:current};
 }
 function equalPath(left:PathValue,right:PathValue):boolean {return left.present===right.present&&(!left.present||stable(left.value)===stable(right.value));}
 function setPath(row:JsonRow,path:readonly string[],value:PathValue):void {
  let current:JsonRow=row;
  for(let index=0;index<path.length-1;index++){
   const token=path[index]!,next=current[token];if(!next||typeof next!=='object'){if(!value.present)return;current[token]={};}current=current[token] as JsonRow;
  }
  const last=path[path.length-1]!;if(value.present)current[last]=safe(value.value,'ACCESS_ROW_INVALID');else delete current[last];
 }
 function projectOne(prepared:Prepared,section:string,row:JsonRow,value:AccessRowFacts):JsonRow {
  const result:JsonRow={};for(const field of Object.keys(row))if(fieldAllowed(prepared,section,field,'read'))result[field]=safe(row[field],'ACCESS_ROW_INVALID');
  for(const guard of [...(value.fieldGuards||[])].sort((left,right)=>right.path.length-left.path.length))if(!reads(prepared,guard.requires)&&at(result,guard.path).present)setPath(result,guard.path,own(guard,'deniedValue')?{present:true,value:guard.deniedValue!}:{present:false});
  return result;
 }
 function rows(value:unknown):JsonRow[] {const result=safe(value,'ACCESS_ROW_INVALID');if(!Array.isArray(result)||result.some(item=>!object(item)))fail('ACCESS_ROW_INVALID','Нужен массив строк');return result as JsonRow[];}
 function permits(value:unknown,section:string,action:string,input:unknown,context:AccessContext,phase:AccessPhase='before'):boolean {if(phase!=='before'&&phase!=='after')fail('ACCESS_CONTEXT_INVALID','Некорректная фаза области');const prepared=prepare(value,context),row=record(input,'ACCESS_ROW_INVALID');return sectionAllowed(prepared,section,action)&&prepared.policy?.grants.length!==0&&rowAllowed(prepared,section,action,facts(prepared,section,row,phase));}
 function projectRows(value:unknown,section:string,input:readonly Readonly<JsonRow>[],context:AccessContext):JsonRow[] {const prepared=prepare(value,context),source=rows(input);if(!sectionAllowed(prepared,section,'read')||prepared.policy?.grants.length===0)return [];return source.flatMap(row=>{const scope=facts(prepared,section,row,'before');return rowAllowed(prepared,section,'read',scope)?[projectOne(prepared,section,row,scope)]:[];});}
 function rowKey(section:string,row:JsonRow,index:number):string {return contracts.identifier(row.id)?identity.typedKey(section,row.id):'legacy-position:'+index;}
 function groups(section:string,input:JsonRow[]):Map<string,{row:JsonRow;index:number}[]> {const result=new Map<string,{row:JsonRow;index:number}[]>();input.forEach((row,index)=>{const key=rowKey(section,row,index),members=result.get(key)||[];members.push({row,index});result.set(key,members);});return result;}
 function restore(prepared:Prepared,section:string,before:JsonRow,submitted:JsonRow,scope:AccessRowFacts):JsonRow {
  const result=record(submitted,'ACCESS_ROW_INVALID'),projected=projectOne(prepared,section,before,scope);
  for(const field of new Set([...Object.keys(before),...Object.keys(result)])){
   if(field==='id')continue;const old=at(before,[field]),received=at(result,[field]);
   if(!fieldAllowed(prepared,section,field,'write')){
    if(received.present&&!equalPath(received,old)&&!equalPath(received,at(projected,[field])))denied();setPath(result,[field],old);
   }else if(!fieldAllowed(prepared,section,field,'read')&&!received.present)setPath(result,[field],old);
  }
  for(const guard of [...(scope.fieldGuards||[])].sort((left,right)=>right.path.length-left.path.length))if(!reads(prepared,guard.requires)){
   const received=at(result,guard.path),old=at(before,guard.path),visible=at(projected,guard.path);
   if(received.present&&!equalPath(received,old)&&!equalPath(received,visible))denied();
   // A scalar cannot replace an ancestor that contains a private saved fact.
   for(let length=1;length<guard.path.length;length++){const ancestor=at(submitted,guard.path.slice(0,length));if(ancestor.present&&(!ancestor.value||typeof ancestor.value!=='object'))denied();}
   setPath(result,guard.path,old);
  }return result;
 }
 function assertChanged(prepared:Prepared,section:string,before:JsonRow|undefined,after:JsonRow|undefined):void {
  if(before&&after&&stable(before)===stable(after))return;
  if(before){const old=facts(prepared,section,before,'before');if(!rowAllowed(prepared,section,'read',old)||!rowAllowed(prepared,section,after?'update':'delete',old))denied();}
  if(after){const next=facts(prepared,section,after,'after');if(!rowAllowed(prepared,section,before?'update':'create',next))denied();
   for(const field of new Set([...Object.keys(before||{}),...Object.keys(after)]))if(field!=='id'&&!equalPath(at(before||{},[field]),at(after,[field]))&&!fieldAllowed(prepared,section,field,'write'))denied();
   for(const guard of [...(before?facts(prepared,section,before,'before').fieldGuards||[]:[]),...(next.fieldGuards||[])])if(!reads(prepared,guard.requires)&&!equalPath(at(before||{},guard.path),at(after,guard.path)))denied();
  }
 }
 function validatePrepared(prepared:Prepared,section:string,previous:JsonRow[],next:JsonRow[]):void {
  const old=groups(section,previous),after=groups(section,next);
  for(const key of new Set([...old.keys(),...after.keys()])){
   const left=old.get(key)||[],right=after.get(key)||[];
   if(left.length>1||right.length>1){if(stable(left.map(item=>item.row))!==stable(right.map(item=>item.row)))denied();continue;}
   assertChanged(prepared,section,left[0]?.row,right[0]?.row);
  }
  // An unchanged private row must keep its place among surviving old rows.
  // Deleting an authorised predecessor may shift its numeric array index.
  const tokens=(source:JsonRow[]):string[]=>{const seen=new Map<string,number>();return source.map((row,index)=>{const key=rowKey(section,row,index),occurrence=seen.get(key)||0;seen.set(key,occurrence+1);return stable([key,occurrence]);});};
  const prior=tokens(previous),later=tokens(next),oldTokens=new Set(prior),positions=new Map(later.map((token,index)=>[token,index]));
  const suffix:number[]=Array(prior.length+1).fill(Infinity);for(let index=prior.length-1;index>=0;index--)suffix[index]=Math.min(suffix[index+1]!,positions.get(prior[index]!)??Infinity);
  let prefix=-1;const firstNew=later.findIndex(token=>!oldTokens.has(token));
  for(let index=0;index<prior.length;index++){
   const position=positions.get(prior[index]!);if(position!==undefined){const scope=facts(prepared,section,previous[index]!,'before');if(!rowAllowed(prepared,section,'read',scope)&&(prefix>=position||suffix[index+1]!<=position||firstNew!==-1&&firstNew<position))denied();prefix=Math.max(prefix,position);}
  }
 }
 function mergeVisibleChanges(value:unknown,section:string,beforeValue:readonly Readonly<JsonRow>[],submittedValue:readonly Readonly<JsonRow>[],context:AccessContext):JsonRow[] {
  const prepared=prepare(value,context),previous=rows(beforeValue),submitted=rows(submittedValue),old=groups(section,previous),incoming=groups(section,submitted),resolved=new Map<string,JsonRow[]>();
  for(const [key,members]of old){
   const candidates=incoming.get(key)||[];
   if(members.length>1||candidates.length>1){
    const visible=members.filter(item=>rowAllowed(prepared,section,'read',facts(prepared,section,item.row,'before')));
    const unchanged=(expected:typeof members):boolean=>expected.length===candidates.length&&expected.every((item,index)=>{
     const received=candidates[index]!.row;if(stable(received)===stable(item.row))return true;const scope=facts(prepared,section,item.row,'before');return rowAllowed(prepared,section,'read',scope)&&stable(received)===stable(projectOne(prepared,section,item.row,scope));
    });
    if(!unchanged(members)&&!unchanged(visible))denied();
    resolved.set(key,members.map(item=>item.row));continue;
   }
   const before=members[0]!.row,scope=facts(prepared,section,before,'before'),candidate=candidates[0]?.row;
   if(!rowAllowed(prepared,section,'read',scope)){if(candidate&&stable(candidate)!==stable(before))denied();resolved.set(key,[before]);continue;}
   if(!candidate){assertChanged(prepared,section,before,undefined);resolved.set(key,[]);continue;}
   const next=restore(prepared,section,before,candidate,scope);assertChanged(prepared,section,before,next);resolved.set(key,[next]);
  }
  const result:JsonRow[]=[],used=new Map<string,number>();
  for(let index=0;index<previous.length;index++){const key=rowKey(section,previous[index]!,index),position=used.get(key)||0,member=resolved.get(key)?.[position];used.set(key,position+1);if(member)result.push(member);}
  for(const [key,members]of incoming)if(!old.has(key)){if(members.length!==1||!contracts.identifier(members[0]!.row.id))denied();const next=members[0]!.row;assertChanged(prepared,section,undefined,next);result.push(next);}
  validatePrepared(prepared,section,previous,result);return result;
 }
 function validateChanges(value:unknown,section:string,before:readonly Readonly<JsonRow>[],after:readonly Readonly<JsonRow>[],context:AccessContext):void {validatePrepared(prepare(value,context),section,rows(before),rows(after));}
 function fact(orderedSources:readonly Readonly<Record<string,unknown>>[],aliases:readonly string[]):AccessFact {
  if(!Array.isArray(orderedSources)||!Array.isArray(aliases)||!aliases.length||aliases.some(alias=>typeof alias!=='string'||!alias||dangerous.includes(alias)))fail('ACCESS_CONTEXT_INVALID','Некорректные источники факта');
  for(const source of orderedSources){if(!source||typeof source!=='object'||Array.isArray(source))fail('ACCESS_CONTEXT_INVALID','Некорректный источник факта');
   for(const alias of aliases){const descriptor=Object.getOwnPropertyDescriptor(source,alias);if(!descriptor)continue;if(descriptor.get||descriptor.set||!descriptor.enumerable)fail('ACCESS_CONTEXT_INVALID','Исполняемые и скрытые факты запрещены');return frozen(typeof descriptor.value==='string'?{state:'known' as const,value:descriptor.value}:{state:'unknown' as const});}
  }return frozen({state:'unknown' as const});
 }
 return Object.freeze({apiVersion:1 as const,normalize,policyStamp,permits,projectRows,mergeVisibleChanges,validateChanges,fact});
}
export type AccessPolicyAPI=ReturnType<typeof createAccessPolicy>;
