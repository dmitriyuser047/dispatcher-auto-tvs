'use strict';
// Trusted process boundary. No caller can choose worker code or a storage method.
const path=require('node:path');
const kinds=new Set(['writeSections','executeCommand','writeAll','readSnapshot']);
const optionNames=new Set(['principal','now','requireNegotiatedWriter','requireWriterSchema','writerSchemaVersion','databaseToken','base','scopeViews','requireBase','replace','operation','history','compactAck']);
const RPC_BYTES=32768;
function failure(code,message,extra={}){return Object.assign(Error(message),{code,...extra});}
function copy(value,depth=0,parents=new Set()){
 if(value===null||value===undefined||typeof value==='string'||typeof value==='boolean')return value;
 if(typeof value==='number'&&Number.isFinite(value))return value;
 if(depth>128||typeof value!=='object'||(!Array.isArray(value)&&![Object.prototype,null].includes(Object.getPrototypeOf(value)))||parents.has(value)||Object.getOwnPropertySymbols(value).length)throw failure('STORAGE_EXECUTOR_INPUT','Операция должна содержать только данные.',{definitive:true});
 parents.add(value);const out=Array.isArray(value)?new Array(value.length):{};
 for(const [key,descriptor]of Object.entries(Object.getOwnPropertyDescriptors(value))){
  if(Array.isArray(value)&&key==='length')continue;
  if(!Object.hasOwn(descriptor,'value')||['__proto__','prototype','constructor'].includes(key))throw failure('STORAGE_EXECUTOR_INPUT','Недопустимое поле операции.',{definitive:true});
  Object.defineProperty(out,key,{value:copy(descriptor.value,depth+1,parents),enumerable:descriptor.enumerable,writable:true,configurable:true});
 }
 parents.delete(value);return out;
}
function packedError(error){
 const out={name:typeof error?.name==='string'?error.name:'Error',message:String(error?.message||'Не удалось выполнить операцию.')};
 for(const key of ['code','status','definitive','unknown','issues','details','causeCode','databaseChanged','databaseToken'])if(error?.[key]!==undefined)try{out[key]=copy(error[key]);}catch{}
 return out;
}
function unpackedError(value){const error=Error(typeof value?.message==='string'?value.message:'Не удалось выполнить операцию.');for(const key of ['name','code','status','definitive','unknown','issues','details','causeCode','databaseChanged','databaseToken'])if(value?.[key]!==undefined)error[key]=value[key];return error;}
function synchronous(callback,...args){const value=callback(...args);if(value&&typeof value.then==='function'){Promise.resolve(value).catch(()=>{});throw failure('STORAGE_EXECUTOR_ASYNC_GUARD','Проверка сеанса должна быть синхронной.',{definitive:true});}if(value===false)throw failure('SESSION_CHANGED','Сеанс операции больше не действует.',{definitive:true});return value;}
function diagnostic(value,observer){
 if(!value||!['commit-started','commit-finished','backup-failed'].includes(value.phase)||typeof value.code!=='string'||!/^[a-zA-Z0-9_.:-]{1,100}$/.test(value.code)||!['json','sqlite','local'].includes(value.backend))return;
 const event={phase:value.phase,code:value.code,backend:value.backend};
 if(typeof value.operationId==='string'&&/^[a-zA-Z0-9_.:-]{1,200}$/.test(value.operationId))event.operationId=value.operationId;
 if(typeof value.databaseToken==='string'&&value.databaseToken.length<=500)event.databaseToken=value.databaseToken;
 if(Number.isSafeInteger(value.durationMs)&&value.durationMs>=0&&value.durationMs<=3600000)event.durationMs=value.durationMs;
 try{const pending=observer(Object.freeze(event));if(pending?.then)Promise.resolve(pending).catch(()=>{});}catch{}
}
function createStorageExecutor({maxPending=16,maxPayloadBytes=64*1024*1024,maxPendingBytes=128*1024*1024,onEvent=require('./diagnostic-boundary.cjs').record}={}){
 if(!Number.isSafeInteger(maxPending)||maxPending<1||maxPending>128||!Number.isSafeInteger(maxPayloadBytes)||maxPayloadBytes<1||maxPayloadBytes>256*1024*1024||!Number.isSafeInteger(maxPendingBytes)||maxPendingBytes<maxPayloadBytes||maxPendingBytes>512*1024*1024||typeof onEvent!=='function')throw TypeError('Некорректные настройки исполнителя хранилища.');
 const queue=[],waiters=[];let active=null,closing=false,pendingBytes=0,processSlot=null,sequence=0;const workers=new Set();
 function drained(){if(active||queue.length)return;if(closing&&processSlot){const record=processSlot;processSlot=null;record.unusable=true;void record.worker.terminate();}if(closing&&workers.size)return;for(const resolve of waiters.splice(0))resolve();}
 function finish(job,error,value){if(active!==job)return;active=null;pendingBytes-=job.bytes;job.input=null;job.options=null;job.backup=null;try{if(error)job.reject(error);else job.resolve(value);}finally{drain();drained();}}
 function drain(){
  if(active||!queue.length){drained();return;}
  const job=queue.shift();active=job;
  try{synchronous(job.assertCurrent,{phase:'dispatch'});}catch(error){finish(job,error);return;}
  const {Worker,MessageChannel}=require('node:worker_threads'),{port1,port2}=new MessageChannel();
  let record,reply=null,workerError=null,exited=false,ready=false,portClosed=false,finished=false;
  // Both the drained data port and the worker's per-job ready signal are
  // required. Closing the executor only terminates a worker proven idle.
  const completed=()=>{
   if(finished||!portClosed||!ready&&!exited)return;finished=true;
   if(record){record.onReady=null;record.onExit=null;record.worker.unref();}
   if(record?.error||workerError||exited||!reply||typeof reply.ok!=='boolean'){
    if(record&&processSlot===record){processSlot=null;record.unusable=true;if(ready)void record.worker.terminate();}
    finish(job,failure('STORAGE_WORKER_EXIT','Результат записи не подтверждён. Проверьте операцию в очереди перед повтором.',{definitive:false,unknown:true}));return;
   }
   if(!reply.ok){finish(job,unpackedError(reply.error));return;}
   try{synchronous(job.assertCurrent,{phase:'ack'});}
   catch(error){finish(job,failure('STORAGE_ACK_STALE','База или сеанс изменились после выполнения записи. Проверьте результат в исходной базе.',{definitive:false,unknown:true,...(typeof error.code==='string'?{causeCode:error.code}:{})}));return;}
   finish(job,null,reply.value);
  };
  const answer=(message,result)=>{
   if(!(message.signal instanceof SharedArrayBuffer)||message.signal.byteLength!==8+RPC_BYTES)return;
   let bytes=Buffer.from(JSON.stringify(result));if(bytes.length>RPC_BYTES)bytes=Buffer.from(JSON.stringify({ok:false,error:{code:'STORAGE_EXECUTOR_GUARD',message:'Не удалось подтвердить сеанс.',definitive:true}}));
   new Uint8Array(message.signal,8).set(bytes);const state=new Int32Array(message.signal,0,2);Atomics.store(state,1,bytes.length);Atomics.store(state,0,1);Atomics.notify(state,0);
  };
  port1.on('message',message=>{
   if(message?.type==='diagnostic'){diagnostic(message.event,onEvent);return;}
   if(message?.type==='result'){
    if(reply!==null){workerError=failure('STORAGE_WORKER_PROTOCOL','Хранилище вернуло неоднозначный ответ.');return;}
    reply=message;return;
   }
   if(message?.type!=='rpc')return;
   try{
    if(!['locked','compatibility','beforeCommit','afterBackup'].includes(message.action))throw failure('STORAGE_WORKER_PROTOCOL','Неизвестная проверка хранилища.',{definitive:true});
    synchronous(job.assertCurrent,{phase:message.action});
    let value=true;
    if(message.action==='compatibility'){
     if(typeof job.assertWriteCompatibility!=='function')throw failure('PROTOCOL_RENEGOTIATE','Совместимость записи не подтверждена.',{status:428,definitive:true});
     value=synchronous(()=>{const checked=job.assertWriteCompatibility(message.context);if(checked===false)throw failure('PROTOCOL_RENEGOTIATE','Совместимость записи не подтверждена.',{status:428,definitive:true});return checked;});
    }
    answer(message,{ok:true,value:value===false?false:true});
   }catch(error){answer(message,{ok:false,error:packedError(error)});}
  });
  port1.once('close',()=>{portClosed=true;completed();});
  const request={sequence:++sequence,kind:job.kind,dataDir:job.dataDir,input:job.input,options:job.options,backup:job.backup,hasCompatibility:!!job.assertWriteCompatibility,port:port2};
  try{
   if(!processSlot||processSlot.unusable){
    const worker=new Worker(path.join(__dirname,'storage-executor-worker.cjs'),{workerData:request,transferList:[port2]});
    record={worker,unusable:false,onReady:null,onExit:null,error:null};processSlot=record;workers.add(record);
    worker.on('message',message=>{if(message?.type==='ready')record.onReady?.(message);});
    worker.once('error',error=>{record.error=error;record.unusable=true;});
    worker.once('exit',()=>{record.unusable=true;workers.delete(record);if(processSlot===record)processSlot=null;record.onExit?.();drained();});
   }else{record=processSlot;record.worker.ref();record.worker.postMessage(request,[port2]);}
   record.onReady=message=>{if(message.sequence!==request.sequence)workerError=failure('STORAGE_WORKER_PROTOCOL','Неоднозначный ответ хранилища.');ready=true;completed();};
   record.onExit=()=>{exited=true;workerError=record.error;completed();};
  }catch(error){port1.close();port2.close();finish(job,error);}

 }
 function run(kind,dataDir,input,options={},controls={}){
  return new Promise((resolve,reject)=>{
   try{
    if(closing)throw failure('STORAGE_EXECUTOR_CLOSED','Хранилище завершает работу.',{definitive:true});
    if(!kinds.has(kind)||typeof dataDir!=='string'||!path.isAbsolute(dataDir)||!dataDir)throw failure('STORAGE_EXECUTOR_INPUT','Неизвестная операция или каталог хранилища.',{definitive:true});
    if(queue.length+(active?1:0)>=maxPending)throw failure('STORAGE_EXECUTOR_LIMIT','Дождитесь завершения ожидающих операций.',{definitive:true});
    if(!options||typeof options!=='object'||Array.isArray(options)||!controls||typeof controls!=='object'||Array.isArray(controls)||typeof controls.assertCurrent!=='function'||Object.keys(controls).some(key=>!['assertCurrent','backup'].includes(key)))throw failure('STORAGE_EXECUTOR_INPUT','Нужна доверенная проверка сеанса записи.',{definitive:true});
    const serialized={};let assertWriteCompatibility;
    for(const key of Object.keys(options)){
     const descriptor=Object.getOwnPropertyDescriptor(options,key);if(!Object.hasOwn(descriptor,'value'))throw failure('STORAGE_EXECUTOR_INPUT','Параметры записи должны содержать данные.',{definitive:true});
     if(key==='assertWriteCompatibility'){if(descriptor.value!==undefined&&typeof descriptor.value!=='function')throw failure('STORAGE_EXECUTOR_INPUT','Нужна доверенная проверка совместимости.',{definitive:true});assertWriteCompatibility=descriptor.value;continue;}
     if(!optionNames.has(key))throw failure('STORAGE_EXECUTOR_INPUT','Недопустимый параметр записи: '+key,{definitive:true});serialized[key]=copy(descriptor.value);
    }
    let backup=null;
    if(controls.backup!==undefined&&controls.backup!==null){const value=copy(controls.backup);if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['directory','keep','optional'].includes(key))||typeof value.directory!=='string'||!path.isAbsolute(value.directory)||value.keep!==undefined&&(!Number.isSafeInteger(value.keep)||value.keep<1||value.keep>10000)||value.optional!==undefined&&typeof value.optional!=='boolean')throw failure('STORAGE_EXECUTOR_INPUT','Некорректные параметры резервной копии.',{definitive:true});backup={directory:path.resolve(value.directory),keep:value.keep??30,optional:value.optional===true};}
    const ownedInput=copy(input),bytes=Buffer.byteLength(JSON.stringify({kind,dataDir,input:ownedInput,options:serialized,backup}));
    if(bytes>maxPayloadBytes)throw failure('STORAGE_EXECUTOR_PAYLOAD_LIMIT','Операция превышает допустимый объём данных.',{definitive:true});
    if(pendingBytes+bytes>maxPendingBytes)throw failure('STORAGE_EXECUTOR_BYTE_LIMIT','Дождитесь сохранения данных: очередь достигла ограничения объёма.',{definitive:true});
    const job={kind,dataDir:path.resolve(dataDir),input:ownedInput,options:serialized,assertWriteCompatibility,assertCurrent:controls.assertCurrent,backup,resolve,reject,bytes};pendingBytes+=bytes;queue.push(job);drain();
   }catch(error){reject(error);}
  });
 }
 function close(){closing=true;const result=new Promise(resolve=>waiters.push(resolve));drained();return result;}
 return Object.freeze({run,close,status:()=>Object.freeze({active:active?1:0,queued:queue.length,maxPending,closing,pendingBytes,maxPayloadBytes,maxPendingBytes})});
}
module.exports=Object.freeze({createStorageExecutor});
