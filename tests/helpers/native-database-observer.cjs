'use strict';
const {performance}=require('node:perf_hooks');
const {setTimeout:delay}=require('node:timers/promises');

// Observe synthetic storage while the actual app may hold its physical lock.
// Keep assertions and writes outside this callback: only DB_BUSY is retried.
async function observeDatabase(read,{timeoutMs=5000,pollMs=25}={}){
 if(typeof read!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<0||!Number.isSafeInteger(pollMs)||pollMs<=0)throw new TypeError('A reader and finite observation bounds are required');
 const deadline=performance.now()+timeoutMs;
 for(;;){
  try{return await read();}
  catch(error){
   if(error?.code!=='DB_BUSY')throw error;
   const remaining=deadline-performance.now();
   if(remaining<=0)throw error;
   await delay(Math.min(pollMs,remaining));
   if(performance.now()>=deadline)throw error;
  }
 }
}

module.exports={observeDatabase};
