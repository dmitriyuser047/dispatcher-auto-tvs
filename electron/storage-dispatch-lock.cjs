'use strict';
// Wait only for ownership before dispatch. Once the callback has been entered,
// neither a storage action nor any of its guards may be executed a second time.
const {performance}=require('node:perf_hooks');
function acquireForDispatch(dataDir,action,{acquire=require('./storage').withDatabaseLock,waitMs=5000}={}){
 if(typeof action!=='function'||typeof acquire!=='function'||!Number.isSafeInteger(waitMs)||waitMs<0||waitMs>5000)throw TypeError('Некорректное ожидание блокировки перед записью.');
 const deadline=performance.now()+waitMs,signal=new Int32Array(new SharedArrayBuffer(4));let backoff=10;
 for(;;){let entered=false;
  try{return acquire(dataDir,physical=>{entered=true;return action(physical);});}
  catch(error){
   if(error?.code!=='DB_BUSY'||entered)throw error;
   const remaining=deadline-performance.now();
   if(remaining<=0)throw Object.assign(error,{status:503,definitive:true,unknown:false});
   Atomics.wait(signal,0,0,Math.min(backoff,remaining));backoff=Math.min(backoff*2,100);
  }
 }
}
module.exports=Object.freeze({acquireForDispatch});
