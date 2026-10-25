import type {Identifier,JsonRow,JsonValue,SectionRows,createPlatformContracts} from './platform-contracts';
import type {EntityIdentityAPI} from './entity-identity';
import type {InventoryStockAPI,InventoryRow} from './inventory-stock';

type Contracts=ReturnType<typeof createPlatformContracts>;
const sections=['parts','partMovements','generators','workOrders','generatorMaintenancePlans'] as const;
const lifecycleSections=[...sections,'documentDrafts','dispatchJobs','procurementOrders','procurementRules','costProfiles','costEntries','toRecords','vehicleTo','repairs','payments','savedReestrs'] as const;
export type GeneratorSpareLifecycleAction='delete'|'archive'|'restore';
export interface GeneratorSpareLifecycleReference {section:string;id:Identifier|null;rowIndex:number;path:string;active:boolean}
export interface GeneratorSpareLifecycleState {
 partId:Identifier;generatorId:Identifier;archived:boolean;canDelete:boolean;canArchive:boolean;canRestore:boolean;
 balance:number|null;balanceDecimal:string|null;deleteBlockers:string[];archiveBlockers:string[];restoreBlockers:string[];
 references:GeneratorSpareLifecycleReference[];
}

/** A stock position has one physical owner; historical quantities never move with a card edit. */
export function createGeneratorSpares(contracts:Contracts,identity:EntityIdentityAPI,getInventory?:()=>InventoryStockAPI){
 const own=(row:object,key:string):boolean=>Object.prototype.hasOwnProperty.call(row,key);
 const object=(value:unknown):value is JsonRow=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 function fail(code:string,message:string,field?:string):never {throw Object.assign(Error(message),{code,status:409,...(field?{field}:{})});}
 function database(value:unknown,names:readonly string[]=sections):SectionRows{
  if(!object(value))fail('SPARES_SOURCE','Нужен снимок запасов ДЭС');const result:Record<string,unknown>={};
  for(const name of names){const descriptor=Object.getOwnPropertyDescriptor(value,name);if(descriptor?.get||descriptor?.set)fail('SPARES_SOURCE','Исполняемые свойства запаса недопустимы');const list=descriptor?.value??[];if(!Array.isArray(list))fail('SPARES_SOURCE','Неверный раздел запаса');for(let index=0;index<list.length;index++){const item=Object.getOwnPropertyDescriptor(list,String(index));if(!item||item.get||item.set)fail('SPARES_SOURCE','Неверная строка запаса');}result[name]=list;}
  return contracts.validateSections(result,names);
 }
 const key=(id:unknown):string=>JSON.stringify([typeof id,id]);
 const stable=(value:unknown):string=>value===undefined?'undefined':value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(stable).join(',')+']':'{'+Object.keys(value).sort().map(field=>JSON.stringify(field)+':'+stable((value as JsonRow)[field])).join(',')+'}';
 const clone=(value:JsonValue):JsonValue=>Array.isArray(value)?value.map(clone):object(value)?Object.fromEntries(Object.entries(value).map(([name,child])=>[name,clone(child)])):value;
 function find(db:SectionRows,name:string,id:unknown):JsonRow|null{const matches=(db[name]||[]).filter(row=>row.id===id);return matches.length===1?matches[0]!:null;}
 function owned(row:JsonRow|null):boolean{return !!row&&own(row,'generatorId');}
 function referenced(db:SectionRows,id:JsonValue|undefined):boolean{
  return (db.partMovements||[]).some(row=>row.partId===id)||(db.generatorMaintenancePlans||[]).some(plan=>plan.status==='approved'&&Array.isArray(plan.rows)&&plan.rows.some(row=>object(row)&&Array.isArray(row.components)&&row.components.some(component=>object(component)&&component.partId===id)));
 }
 function lifecycleContext(value:unknown):{today:string;now:string|null;readable:readonly string[]|null}{
  const input=object(value)?value:{},fields:Record<string,unknown>={};
  for(const name of ['today','now','readable']){const descriptor=Object.getOwnPropertyDescriptor(input,name);if(descriptor?.get||descriptor?.set)fail('SPARES_CONTEXT','Исполняемые свойства контекста недопустимы');fields[name]=descriptor?.value;}
  const now=typeof fields.now==='string'?fields.now:null,today=fields.today??now?.slice(0,10)??new Date().toISOString().slice(0,10);
  if(typeof today!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(today)||!Number.isFinite(Date.parse(today+'T12:00:00Z'))||new Date(today+'T12:00:00Z').toISOString().slice(0,10)!==today)fail('SPARES_CONTEXT','Укажите действительную дату проверки запаса');
  // PlatformKernel normalizes an absent access list to null. Both forms mean
  // unrestricted section access; an explicit empty array still grants nothing.
  const readable=fields.readable;if(readable!==undefined&&readable!==null&&(!Array.isArray(readable)||readable.some(name=>typeof name!=='string')))fail('SPARES_CONTEXT','Неверный список доступных разделов');
  return {today,now,readable:Array.isArray(readable)?readable as string[]:null};
 }
 function activeReference(section:string,row:JsonRow):boolean{
  if(row.deleted||row.archived||row.cancelled||row.status==='cancelled')return false;
  if(section==='generatorMaintenancePlans')return row.status!=='approved';
  if(section==='documentDrafts')return !['posted','discarded'].includes(row.status as string);
  if(section==='procurementOrders')return row.status!=='received';
  if(section==='procurementRules'||section==='costProfiles')return true;
  if(section==='workOrders')return row.status!=='accepted';
  if(section==='dispatchJobs')return row.status!=='confirmed';
  return false;
 }
 function lifecycleReferences(db:SectionRows,id:Identifier):GeneratorSpareLifecycleReference[]{
  const found:GeneratorSpareLifecycleReference[]=[],seen=new Set<string>();
  for(const section of lifecycleSections)for(const [rowIndex,row]of (db[section]||[]).entries()){
   const add=(path:string):void=>{const token=JSON.stringify([section,rowIndex,path]);if(!seen.has(token)){seen.add(token);found.push({section,id:contracts.identifier(row.id)?row.id:null,rowIndex,path,active:activeReference(section,row)});}};
   function visit(value:JsonValue|undefined,path:string,container:string,kind:JsonValue|undefined,depth:number):void{
    if(depth>100)fail('SPARES_SOURCE','Слишком глубокие связи номенклатуры');
    if(Array.isArray(value)){for(const [index,child]of value.entries())visit(child,path+'['+index+']',container,kind,depth+1);return;}
    if(!object(value))return;
    const currentKind=value.kind??kind;
    for(const [field,child]of Object.entries(value)){
     const current=path?path+'.'+field:field;
     if(child===id&&(/partId$/i.test(field)||field==='itemId'&&currentKind==='part'||field==='id'&&path!==''&&(value.section==='parts'||container==='part'||container==='parts')))add(current);
     if(child!==null&&typeof child==='object')visit(child,current,field,currentKind,depth+1);
    }
   }
   visit(row,'','',row.kind,0);
  }
  return found;
 }
 function legacyOpening(part:JsonRow):boolean{
  for(const name of ['qty','quantity','balance','balanceInit','stockInit','openingQty','stockQty','stock'])if(own(part,name)&&part[name]!==0&&part[name]!=='0')return true;
  if(own(part,'opening')){const opening=part.opening;if(!object(opening)||opening.qty!==0)return true;}
  if(own(part,'costValuation')){const policy=part.costValuation;if(!object(policy)||!object(policy.opening)||policy.opening.qty!==0||policy.opening.amount!==null&&policy.opening.amount!==0)return true;}
  return false;
 }
 function lifecycleDatabase(value:unknown):SectionRows{
  if(!object(value)||lifecycleSections.some(name=>!Object.getOwnPropertyDescriptor(value,name)))fail('SPARES_SOURCE_INCOMPLETE','Для удаления или архива нужен полный снимок источников запаса и его связей');
  return database(value,lifecycleSections);
 }
 function lifecycleState(databaseValue:unknown,targetValue:unknown,contextValue:unknown={}):GeneratorSpareLifecycleState{
  const context=lifecycleContext(contextValue);
  if(context.readable&&!context.readable.includes('*')&&lifecycleSections.some(name=>!context.readable!.includes(name)))fail('ACCESS_DENIED','Для удаления или архива позиции нужны все источники её связей и запаса');
  const db=lifecycleDatabase(databaseValue);
  if(!object(targetValue)||!contracts.identifier(targetValue.generatorId)||!contracts.identifier(targetValue.partId))fail('SPARES_TARGET','Укажите типизированные ДЭС и позицию склада');
  const {generatorId,partId}=targetValue,part=find(db,'parts',partId);
  if(!part||!owned(part)||part.generatorId!==generatorId)fail('SPARES_TARGET','Позиция не найдена однозначно на складе выбранной ДЭС');
  const references=lifecycleReferences(db,partId),deleteBlockers:string[]=[],archiveBlockers:string[]=[],restoreBlockers:string[]=[];
  const archived=!!part.archived,alias=own(part,'mergedInto');
  if(part.deleted){const text='Позиция помечена удалённой; сначала исправьте её состояние';deleteBlockers.push(text);archiveBlockers.push(text);restoreBlockers.push(text);}
  if(alias){const text='Позиция участвует в объединении справочника; исходную идентичность нужно сохранить';deleteBlockers.push(text);archiveBlockers.push(text);restoreBlockers.push(text);}
  const generator=find(db,'generators',generatorId);
  if(!generator){const text='ДЭС — владелец позиции не найдена однозначно';deleteBlockers.push(text);archiveBlockers.push(text);restoreBlockers.push(text);}
  else if(generator.archived||generator.deleted||own(generator,'mergedInto'))restoreBlockers.push('Сначала восстановите действующую ДЭС — владельца запаса');
  if(references.length)deleteBlockers.push('У позиции есть движения, документы или ссылки в ТО. Удаление истории недоступно; используйте архив после закрытия запаса.');
  if(own(part,'costValuation'))deleteBlockers.push('У позиции сохранена политика оценки стоимости; сохраните её историю через архив.');
  const active=references.some(reference=>reference.active);if(active)archiveBlockers.push('Позиция используется в незавершённом заказе, черновике ТО, документе или правиле закупок. Сначала завершите либо исправьте эти ссылки.');
  let balance:number|null=null,balanceDecimal:string|null=null,zero=false;
  try{
   const inventory=getInventory?.();if(inventory?.apiVersion!==1)throw Error('module');
   const projection=inventory.project(db,{partIds:[partId]}),all=projection.rows.filter(row=>row.target.id===partId);
   if(all.length!==1)throw Error('ambiguous');const full=all[0]!,current=inventory.at(projection,{section:'parts',id:partId},context.today);
   balance=current.balance;balanceDecimal=current.balanceDecimal;
   const empty=(value:InventoryRow):boolean=>value.status==='known'&&value.balanceDecimal==='0';
   zero=empty(full)&&empty(current)&&full.events.every(event=>event.balanceDecimal!==null&&!event.balanceDecimal.startsWith('-'));
  }catch{}
  if(!zero){const text='Для удаления или архива нужен подтверждённый нулевой остаток без отрицательных, неизвестных и будущих незакрытых движений';deleteBlockers.push(text);archiveBlockers.push(text);}
  if(legacyOpening(part)){const text='В карточке есть ненулевой или неизвестный начальный запас. Сначала проверьте его фактические источники';deleteBlockers.push(text);archiveBlockers.push(text);}
  if(archived)archiveBlockers.push('Позиция уже находится в архиве');else restoreBlockers.push('Позиция уже находится в действующем списке');
  return {partId,generatorId,archived,canDelete:deleteBlockers.length===0,canArchive:archiveBlockers.length===0,canRestore:restoreBlockers.length===0,balance,balanceDecimal,deleteBlockers,archiveBlockers,restoreBlockers,references};
 }
 function previewLifecycle(databaseValue:unknown,inputValue:unknown,contextValue:unknown={}):{canApply:boolean;state:GeneratorSpareLifecycleState;parts:JsonRow[]}{
  if(!object(inputValue)||!['delete','archive','restore'].includes(inputValue.action as string))fail('SPARES_ACTION','Выберите удаление, архив или восстановление позиции');
  const state=lifecycleState(databaseValue,inputValue,contextValue),db=database(databaseValue,lifecycleSections),action=inputValue.action as GeneratorSpareLifecycleAction;
  const canApply=action==='delete'?state.canDelete:action==='archive'?state.canArchive:state.canRestore;
  const parts=(db.parts||[]).filter(part=>!canApply||action!=='delete'||part.id!==state.partId).map(part=>{
   const next=clone(part) as JsonRow;if(canApply&&part.id===state.partId&&action!=='delete'){
    next.archived=action==='archive';const context=lifecycleContext(contextValue);
    if(action==='archive'){if(context.now!==null)next.archivedAt=context.now;else delete next.archivedAt;}
    if(action==='restore')delete next.archivedAt;
   }return next;
  });
  return {canApply,state,parts};
 }
 function lifecycleTransition(previous:unknown,next:unknown,old:JsonRow,saved:JsonRow|undefined,action:GeneratorSpareLifecycleAction,context:unknown):void{
  // Validation owns the complete trusted snapshot. A client's narrower read
  // grants must not suppress a hidden reference; errors never include its IDs.
  const supplied=lifecycleContext(context),trustedContext={today:supplied.today,...(supplied.now!==null?{now:supplied.now}:{})};
  const target={generatorId:old.generatorId,partId:old.id},before=lifecycleState(previous,target,trustedContext),allowed=(state:GeneratorSpareLifecycleState):boolean=>action==='delete'?state.canDelete:action==='archive'?state.canArchive:state.canRestore;
  const blockers=(state:GeneratorSpareLifecycleState):string[]=>action==='delete'?state.deleteBlockers:action==='archive'?state.archiveBlockers:state.restoreBlockers;
  if(!allowed(before))fail('SPARES_'+action.toUpperCase()+'_BLOCKED',blockers(before).join('; '));
  const after=lifecycleDatabase(next),restored={...(saved||old)};
  if(action==='delete')after.parts=[...(after.parts||[]).filter(part=>part.id!==old.id),{...old}];
  else {restored.archived=action==='restore';after.parts=(after.parts||[]).map(part=>part.id===old.id?restored:part);}
  const checked=lifecycleState(after,target,trustedContext);if(!allowed(checked))fail('SPARES_'+action.toUpperCase()+'_BLOCKED',blockers(checked).join('; '));
  if(action!=='delete'){
   const source=lifecycleDatabase(previous);
   for(const reference of before.references){
    const original=source[reference.section]?.[reference.rowIndex];
    if(original&&!(after[reference.section]||[]).some(row=>stable(row)===stable(original)))fail('SPARES_HISTORY_LOCKED','Архив и восстановление не изменяют связанные документы и движения запаса');
   }
  }
  if(saved&&action!=='delete'){
   const business=(part:JsonRow):JsonRow=>Object.fromEntries(Object.entries(part).filter(([name])=>!['archived','archivedAt','updatedAt'].includes(name)));
   if(stable(business(old))!==stable(business(saved)))fail('SPARES_LIFECYCLE_FIELDS','Архив и восстановление меняют только состояние позиции; остальные реквизиты сохраняются');
  }
 }
 function catalogMergeArchive(old:JsonRow,saved:JsonRow,context:unknown):boolean{
  if(own(old,'mergedInto')||!object(saved.mergedInto)||saved.mergedInto.section!=='parts'||!object(context))return false;
  const intent=context.commandIntent,actor=context.actor;if(!object(intent)||!object(actor)||actor.role!=='admin'||!object(intent.command)||!object(intent.operation)||intent.operation.id!==context.id)return false;
  const command=intent.command,input=command.input;
  // CatalogPolicy separately recomputes and verifies the entire merge. This
  // only avoids treating its reviewed alias operation as a plain archive.
  return command.type==='MergeCatalog'&&command.version===1&&object(input)&&input.section==='parts'&&input.sourceId===old.id&&input.targetId===saved.mergedInto.id;
 }
 function target(db:SectionRows,row:JsonRow,owner:Identifier):void{
  if(own(row,'generatorId')&&row.generatorId!==owner)fail('SPARES_TARGET','Запас и операция относятся к разным ДЭС','generatorId');
  if(row.assetRef!==undefined&&row.assetRef!==null&&row.assetRef!==''){
   const resolved=identity.resolveAsset(db,row.assetRef);
   if(resolved.status!=='known'||resolved.section!=='generators'||resolved.id!==owner)fail('SPARES_TARGET','Запчасть можно выдать только той ДЭС, которой принадлежит запас','assetRef');
  }else if(row.kind==='issue')fail('SPARES_TARGET','Для выдачи укажите ДЭС — владельца запаса','assetRef');
  if(contracts.identifier(row.workOrderId)){
   const order=find(db,'workOrders',row.workOrderId);if(!order)fail('SPARES_ORDER','Не найден единственный ремонтный заказ','workOrderId');
   const resolved=identity.resolveAsset(db,order.assetRef);
   if(resolved.status!=='known'||resolved.section!=='generators'||resolved.id!==owner)fail('SPARES_TARGET','Запас и ремонтный заказ относятся к разным ДЭС','workOrderId');
  }
 }
 function validateChanges(previous:unknown,next:unknown,context:unknown={}):true{
  const before=database(previous),after=database(next),oldParts=new Map((before.parts||[]).map(row=>[key(row.id),row])),oldMovements=new Map((before.partMovements||[]).map(row=>[key(row.id),row]));
  const group=(parts:JsonRow[]):Map<string,JsonRow[]>=>{const groups=new Map<string,JsonRow[]>();for(const part of parts){const token=key(part.id),rows=groups.get(token)||[];rows.push(part);groups.set(token,rows);}return groups;};
  const oldGroups=group(before.parts||[]),newGroups=group(after.parts||[]);
  for(const [token,originals]of oldGroups)if(originals.some(owned)){
   const matches=newGroups.get(token)||[];
   if(originals.length>1||matches.length>1){if(stable(originals)===stable(matches))continue;fail('SPARES_TARGET','Типизированный ID позиции склада повторяется; сначала исправьте неоднозначность');}
   const old=originals[0]!,saved=matches[0];
   if(!saved||!old.deleted&&!!saved.deleted)lifecycleTransition(previous,next,old,saved,'delete',context);
   else if(!!old.archived!==!!saved.archived&&!catalogMergeArchive(old,saved,context))lifecycleTransition(previous,next,old,saved,saved.archived?'archive':'restore',context);
  }
  for(const part of after.parts||[]){const old=oldParts.get(key(part.id));
   if(owned(part)){
    if(!contracts.identifier(part.generatorId))fail('SPARES_OWNER','Укажите типизированного владельца запаса','generatorId');
    const generator=find(after,'generators',part.generatorId);
    if(!generator||(!old||old.generatorId!==part.generatorId)&&(generator.archived||generator.deleted||own(generator,'mergedInto')))fail('SPARES_OWNER','Для новой позиции выберите действующую ДЭС','generatorId');
   }
   const changed=!!old&&(own(old,'generatorId')!==own(part,'generatorId')||old.generatorId!==part.generatorId);
   if(changed){
    const beforeLinks=lifecycleDatabase(previous),afterLinks=lifecycleDatabase(next);
    if(referenced(before,old!.id)||referenced(after,part.id)||lifecycleReferences(beforeLinks,old!.id as Identifier).length||lifecycleReferences(afterLinks,part.id as Identifier).length||own(old!,'costValuation')||own(part,'costValuation')||legacyOpening(old!)||legacyOpening(part))fail('SPARES_OWNER_LOCKED','У позиции уже есть движения, документы, начальный запас или настройки оценки. Владельца менять нельзя; создайте отдельную позицию','generatorId');
   }
   if(old&&stable(old)!==stable(part)&&owned(part)&&owned(old)&&part.generatorId!==old.generatorId&&own(old,'mergedInto'))fail('SPARES_OWNER_LOCKED','Принадлежность архивной позиции сохраняется','generatorId');
   if(object(part.mergedInto)&&part.mergedInto.section==='parts'){
    const destination=find(after,'parts',part.mergedInto.id);
    if(!destination||own(part,'generatorId')!==own(destination,'generatorId')||part.generatorId!==destination.generatorId)fail('SPARES_MERGE_OWNER','Нельзя объединять позиции разных складов','mergedInto');
   }
  }
  for(const movement of after.partMovements||[]){const old=oldMovements.get(key(movement.id));if(stable(old)===stable(movement))continue;const part=find(after,'parts',movement.partId);if(part&&owned(part)){if(part.archived||part.deleted)fail('SPARES_ARCHIVED','Для нового или изменённого движения сначала восстановите позицию собственного склада','partId');target(after,movement,part.generatorId as Identifier);}}
  return true;
 }
 return Object.freeze({apiVersion:1 as const,dependencies:()=>sections.slice(),lifecycleDependencies:()=>lifecycleSections.slice(),lifecycleState,previewLifecycle,validateChanges});
}
