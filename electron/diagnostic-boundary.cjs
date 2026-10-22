'use strict';
// Process-local observer only. It never participates in commit or ACK policy.
let observer=null,commitDepth=0;
function configure(next){if(next!==null&&typeof next!=='function')throw TypeError('Diagnostic observer required');const previous=observer;observer=next;return()=>{if(observer===next)observer=previous;};}
function record(value){try{observer?.(value);}catch{} }
function outcome(result){if(result?.ok===true&&['committed','replayed'].includes(result.operationReceipt?.status))return result.operationReceipt.status;if(result?.conflicts?.length||result?.code==='COMMAND_CONFLICT')return 'conflict';if(result?.unknown||result?.queued)return 'unknown';if(result?.ok===false)return 'denied';return 'unknown';}
function withCommit(payload,databaseToken,backend,callback){
 if(commitDepth)return callback();
 const operationId=payload?.operation?.id,event={...(typeof operationId==='string'?{operationId}:{}),...(typeof databaseToken==='string'?{databaseToken}:{}),backend};
 record({...event,phase:'commit-started',code:'pending'});commitDepth++;
 try{const result=callback();record({...event,...(!operationId&&result?.operationReceipt?.id?{operationId:result.operationReceipt.id}:{}),phase:'commit-finished',code:outcome(result)});return result;}
 catch(error){record({...event,phase:'commit-finished',code:'unknown'});throw error;}
 finally{commitDepth--;}
}
module.exports=Object.freeze({configure,record,outcome,withCommit});
