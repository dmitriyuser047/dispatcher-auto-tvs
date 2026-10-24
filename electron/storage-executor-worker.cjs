'use strict';
// One trusted transaction per worker. Closing never interrupts an active commit.
const {workerData}=require('node:worker_threads'),storage=require('./storage'),boundary=require('./diagnostic-boundary.cjs');
const {performance}=require('node:perf_hooks');
const {kind,dataDir,input,options,backup,hasCompatibility,port}=workerData;
const RPC_BYTES=32768;
let commitMayHaveStarted=false;
function rpc(action,context){
 const signal=new SharedArrayBuffer(8+RPC_BYTES),state=new Int32Array(signal,0,2),deadline=performance.now()+30000;port.postMessage({type:'rpc',action,context,signal});
 while(Atomics.load(state,0)===0){const remaining=deadline-performance.now();if(remaining<=0)throw Object.assign(Error('Проверка сеанса не ответила. Проверьте состояние операции перед повтором.'),{code:'STORAGE_GUARD_TIMEOUT',definitive:false,unknown:true});Atomics.wait(state,0,0,remaining);}
 const length=Atomics.load(state,1);if(length<1||length>RPC_BYTES)throw Object.assign(Error('Не подтверждена проверка записи.'),{code:'STORAGE_EXECUTOR_GUARD',definitive:true});
 const reply=JSON.parse(Buffer.from(new Uint8Array(signal,8,length)).toString('utf8'));
 if(reply.ok!==true)throw Object.assign(Error(reply.error?.message||'Сеанс записи изменился.'),reply.error);
 return reply.value;
}
function errorValue(error){const value={name:error?.name||'Error',message:String(error?.message||'Запись не подтверждена.')};for(const key of ['code','status','definitive','unknown','issues','details','causeCode','databaseChanged','databaseToken'])if(error?.[key]!==undefined)value[key]=error[key];return value;}
boundary.configure(event=>port.postMessage({type:'diagnostic',event}));
try{
 if(!['writeSections','executeCommand','writeAll'].includes(kind))throw Object.assign(Error('Неизвестная операция хранилища.'),{code:'STORAGE_EXECUTOR_INPUT',definitive:true});
 const value=storage.withDatabaseLock(dataDir,physical=>{
  rpc('locked');
  const trusted={...options,...(hasCompatibility?{assertWriteCompatibility:context=>rpc('compatibility',context)}:{}),beforeCommit:()=>{
   rpc('beforeCommit');
   if(backup)try{storage.makeDailyBackup(physical,backup.directory,backup.keep);}catch(error){if(!backup.optional)throw error;boundary.record({phase:'backup-failed',code:'BACKUP_FAILED',backend:'local'});}
   rpc('afterBackup');
   // Storage has finished validation and is about to enter its durable write.
   // A later failure can occur after the revision/SQLite commit point.
   commitMayHaveStarted=true;
  }};
  return storage[kind](physical,input,trusted);
 });
 port.postMessage({type:'result',ok:true,value});
}catch(error){port.postMessage({type:'result',ok:false,error:{...errorValue(error),...(commitMayHaveStarted?{unknown:true,definitive:false}:{})}});}
finally{port.close();}
