'use strict';

// A bounded read queue. Batching decides only which requests share a read;
// authentication, source selection and publishing remain the host's job.
function createReadCohorts({key,run,maxPending=512,maxBatch=64,isCancelled=()=>false}={}){
 if(typeof key!=='function'||typeof run!=='function'||typeof isCancelled!=='function'||!Number.isSafeInteger(maxPending)||maxPending<1||!Number.isSafeInteger(maxBatch)||maxBatch<1)throw TypeError('Некорректные параметры очереди чтения.');
 const failure=(code,status,message)=>Object.assign(Error(message),{code,status});
 const stopped=()=>failure('SERVER_STOPPED',503,'Сервер завершает работу.');
 const aborted=()=>failure('REQUEST_ABORTED',499,'Запрос отменён.');
 let queued=[],active=null,scheduled=null,closed=false,closing=null;
 function cancelled(value){const result=isCancelled(value);if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});throw TypeError('Проверка отмены должна быть синхронной.');}return !!result;}
 function pruneRecord(record){if(record.entry.settled)return true;try{if(!cancelled(record.entry.value))return false;record.entry.reject(aborted());}catch(error){record.entry.reject(error);}return true;}
 function prune(){queued=queued.filter(record=>!pruneRecord(record));if(active)for(const record of active.records)pruneRecord(record);if(!queued.length&&scheduled){clearImmediate(scheduled);scheduled=null;}}
 function schedule(){if(!closed&&!active&&!scheduled&&queued.length)scheduled=setImmediate(drain);}
 function finish(cohort,error){
  if(active!==cohort)return;
  for(const record of cohort.records)if(!record.entry.settled)record.entry.reject(error||failure('READ_COHORT_INCOMPLETE',500,'Чтение не завершило запрос.'));
  active=null;cohort.complete();schedule();
 }
 function drain(){
  scheduled=null;if(closed||active)return;prune();if(!queued.length)return;
  const head=queued.shift(),records=[head];
  if(head.key!==null)for(let index=0;index<queued.length&&records.length<maxBatch;){if(queued[index].key===head.key)records.push(queued.splice(index,1)[0]);else index++;}
  // Detach before run: new arrivals can only belong to a later batch.
  const batch=Object.freeze(records.map(record=>record.entry));let complete;
  const done=new Promise(resolve=>{complete=resolve;}),cohort={records,batch,done,complete};active=cohort;
  try{Promise.resolve(run(batch)).then(()=>finish(cohort),error=>finish(cohort,error));}catch(error){finish(cohort,error);}
 }
 function enqueue(value){return new Promise((resolve,reject)=>{
  if(closed){reject(stopped());return;}
  let selected;
  try{if(cancelled(value)){reject(aborted());return;}selected=key(value);if(selected!==null&&typeof selected!=='string'){if(selected&&typeof selected.then==='function')Promise.resolve(selected).catch(()=>{});throw TypeError('Ключ чтения должен быть строкой или null.');}prune();}
  catch(error){reject(error);return;}
  if(closed){reject(stopped());return;}
  // Keep reservations until the active run releases its complete batch, even
  // when a member has already settled or the caller cancelled it.
  if(queued.length+(active?.records.length||0)>=maxPending){reject(failure('READ_QUEUE_FULL',503,'Очередь чтения заполнена. Повторите запрос позже.'));return;}
  let settled=false;
  const entry=Object.freeze({value,resolve(result){if(settled)return false;settled=true;resolve(result);return true;},reject(error){if(settled)return false;settled=true;reject(error);return true;},get settled(){return settled;}});
  queued.push({key:selected,entry});schedule();
 });}
 function close(){
  if(closing)return closing;closed=true;if(scheduled){clearImmediate(scheduled);scheduled=null;}
  const waiting=queued;queued=[];for(const record of waiting)record.entry.reject(stopped());
  const running=active;if(running)for(const record of running.records)record.entry.reject(stopped());
  closing=running?running.done:Promise.resolve();return closing;
 }
 return Object.freeze({enqueue,close});
}

module.exports=Object.freeze({createReadCohorts});
