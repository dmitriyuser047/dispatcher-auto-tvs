import {errorOf,fail,object,type Database,type Options,type Persist,type SavePorts} from './contracts';
import type {Repository} from './repository';

/** The existing checked transaction runtime remains the sole write authority. */
export function createSaveService(repository:Repository,ports:SavePorts){
 async function save(database:Database,options:Options|undefined,persist:Persist):Promise<boolean>{
  const context=ports.context(),sameSession=():boolean=>context.identity===ports.context().identity;let submitted:string;
  try{
   if(context.blocked)throw Error('Основная база не прочитана. Сначала восстановите подключение или базу.');
   if(ports.capabilities().needsSchemaUpgrade)fail('SCHEMA_UPGRADE_REQUIRED','База открыта только для чтения. В разделе «Состояние программы» создайте отдельную обновлённую копию; исходная база останется прежней.');
   submitted=JSON.stringify(database);const previous=repository.baseline(),operation=object(options?.operation)?options.operation:undefined;
   if(['dispatchJobs','workOrders'].some(name=>JSON.stringify(previous[name]||[])!==JSON.stringify(database[name]||[]))&&ports.capabilities().calendar!==1)fail('UNSUPPORTED_CALENDAR','Подключение не поддерживает проверку учётного календаря. Загрузите данные из совместимой версии программы.');
   // The runtime accepts a patch over the complete previous snapshot. Keep its
   // entire read context, but do not repeatedly clone unrelated sections as writes.
   // The host's strict serializer still examines every supplied value, including
   // unchanged/unknown fields that JSON.stringify alone could silently coerce.
   let next=database;
   if(ports.serializeSnapshot){
    const normalized:unknown=JSON.parse(ports.serializeSnapshot(database));
    if(!object(normalized))fail('INVALID_SNAPSHOT','Источник изменений должен быть объектом');
    next={};for(const [name,rows]of Object.entries(normalized))
     if(JSON.stringify(previous[name])!==JSON.stringify(database[name]))next[name]=rows as Database[string];
   }
   const result=await ports.run({id:operation?.id,previous,next,identity:context.identity,options:{allowLegacy:true,...options,requireOperationReceipt:!!ports.capabilities().operations}},async plan=>{
    if(!sameSession())fail('SESSION_CHANGED','База или пользователь изменились. Откройте форму заново.');
    if(ports.accessStamp(ports.context())!==ports.accessStamp(context))fail('STALE_ACCESS','Права или учётный календарь изменились. Проверьте форму заново.');
    if(JSON.stringify(database)!==submitted)fail('STALE_DRAFT','Данные изменились в ожидании сохранения. Повторите проверку формы.');
    ports.clearAck();const saved=await persist({...options,_platformManaged:true,requireOperationReceipt:!!ports.capabilities().operations,operation:{id:plan.id}});
    if(saved!==true)throw Error('Сохранение не подтверждено. Проверьте подключение и состояние базы.');
    if(!sameSession())fail('SESSION_CHANGED','База изменилась во время сохранения. Проверьте результат в исходной базе.');
    const ack=ports.ack();return ack?.ok?{...ack,identity:context.identity,operationId:object(ack.operationReceipt)?ack.operationReceipt.id:undefined}:true;
   });ports.setError(null);return !!result;
  }catch(error){
   if(sameSession()&&repository.isLive(database))ports.rollback(database);
   const failure=errorOf(error),issues=object(error)&&Array.isArray(error.issues)?error.issues:[],detail=issues.slice(0,3).map(issue=>object(issue)?issue.message:null).filter((message):message is string=>typeof message==='string').join('; '),message=failure.message+(detail&&!failure.message.includes(detail)?': '+detail:'');
   if(sameSession())ports.setError({code:failure.code,message,at:ports.now()});ports.toast('Сохранение остановлено: '+message);return false;
  }
 }
 return Object.freeze({save});
}
export type SaveService=ReturnType<typeof createSaveService>;
