import type {Identifier,JsonRow,JsonValue,SectionRows,createPlatformContracts} from './platform-contracts';
import type {EntityIdentityAPI} from './entity-identity';

type Contracts=ReturnType<typeof createPlatformContracts>;
const sections=['parts','partMovements','generators','workOrders','generatorMaintenancePlans'] as const;

/** A stock position has one physical owner; historical quantities never move with a card edit. */
export function createGeneratorSpares(contracts:Contracts,identity:EntityIdentityAPI){
 const own=(row:object,key:string):boolean=>Object.prototype.hasOwnProperty.call(row,key);
 const object=(value:unknown):value is JsonRow=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 function fail(code:string,message:string,field?:string):never {throw Object.assign(Error(message),{code,status:409,...(field?{field}:{})});}
 function database(value:unknown):SectionRows{
  if(!object(value))fail('SPARES_SOURCE','Нужен снимок запасов ДЭС');const result:Record<string,unknown>={};
  for(const name of sections){const descriptor=Object.getOwnPropertyDescriptor(value,name);if(descriptor?.get||descriptor?.set)fail('SPARES_SOURCE','Исполняемые свойства запаса недопустимы');const list=descriptor?.value??[];if(!Array.isArray(list))fail('SPARES_SOURCE','Неверный раздел запаса');for(let index=0;index<list.length;index++){const item=Object.getOwnPropertyDescriptor(list,String(index));if(!item||item.get||item.set)fail('SPARES_SOURCE','Неверная строка запаса');}result[name]=list;}
  return contracts.validateSections(result,sections);
 }
 const key=(id:unknown):string=>JSON.stringify([typeof id,id]);
 const stable=(value:unknown):string=>value===undefined?'undefined':value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(stable).join(',')+']':'{'+Object.keys(value).sort().map(field=>JSON.stringify(field)+':'+stable((value as JsonRow)[field])).join(',')+'}';
 function find(db:SectionRows,name:string,id:unknown):JsonRow|null{const matches=(db[name]||[]).filter(row=>row.id===id);return matches.length===1?matches[0]!:null;}
 function owned(row:JsonRow|null):boolean{return !!row&&own(row,'generatorId');}
 function referenced(db:SectionRows,id:JsonValue|undefined):boolean{
  return (db.partMovements||[]).some(row=>row.partId===id)||(db.generatorMaintenancePlans||[]).some(plan=>plan.status==='approved'&&Array.isArray(plan.rows)&&plan.rows.some(row=>object(row)&&Array.isArray(row.components)&&row.components.some(component=>object(component)&&component.partId===id)));
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
 function validateChanges(previous:unknown,next:unknown):true{
  const before=database(previous),after=database(next),oldParts=new Map((before.parts||[]).map(row=>[key(row.id),row])),oldMovements=new Map((before.partMovements||[]).map(row=>[key(row.id),row]));
  for(const part of after.parts||[]){const old=oldParts.get(key(part.id));
   if(owned(part)){
    if(!contracts.identifier(part.generatorId))fail('SPARES_OWNER','Укажите типизированного владельца запаса','generatorId');
    const generator=find(after,'generators',part.generatorId);
    if(!generator||(!old||old.generatorId!==part.generatorId)&&(generator.archived||generator.deleted||own(generator,'mergedInto')))fail('SPARES_OWNER','Для новой позиции выберите действующую ДЭС','generatorId');
   }
   const changed=!!old&&(own(old,'generatorId')!==own(part,'generatorId')||old.generatorId!==part.generatorId);
   if(changed&&(referenced(before,old!.id)||referenced(after,part.id)))fail('SPARES_OWNER_LOCKED','У позиции уже есть движения или утверждённый график. Владельца менять нельзя; создайте отдельную позицию','generatorId');
   if(old&&stable(old)!==stable(part)&&owned(part)&&owned(old)&&part.generatorId!==old.generatorId&&own(old,'mergedInto'))fail('SPARES_OWNER_LOCKED','Принадлежность архивной позиции сохраняется','generatorId');
   if(object(part.mergedInto)&&part.mergedInto.section==='parts'){
    const destination=find(after,'parts',part.mergedInto.id);
    if(!destination||own(part,'generatorId')!==own(destination,'generatorId')||part.generatorId!==destination.generatorId)fail('SPARES_MERGE_OWNER','Нельзя объединять позиции разных складов','mergedInto');
   }
  }
  for(const movement of after.partMovements||[]){const old=oldMovements.get(key(movement.id));if(stable(old)===stable(movement))continue;const part=find(after,'parts',movement.partId);if(part&&owned(part))target(after,movement,part.generatorId as Identifier);}
  return true;
 }
 return Object.freeze({apiVersion:1 as const,dependencies:()=>sections.slice(),validateChanges});
}
