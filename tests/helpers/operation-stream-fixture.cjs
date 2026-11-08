'use strict';
// Synthetic cold history regenerated one immutable object at a time. Its
// serialized size can exceed the child JavaScript heap without a huge fixture
// map. There are no business rows and no reads of an actual user database.
const ledger=require('../../electron/operation-ledger.cjs'),format=require('../../electron/storage-format.cjs');
function makeProvider(count=86,paddingBytes=6*1024*1024){
 if(!Number.isSafeInteger(count)||count<0||!Number.isSafeInteger(paddingBytes)||paddingBytes<0)throw TypeError('Invalid synthetic history size');
 const objects=new Map(),padding='x'.repeat(paddingBytes),proof=index=>({version:1,status:'verified',requiredSections:['vehicles'],subjects:[],request:{selectedTargets:[],index,padding}});
 const readObject=id=>{const value=objects.get(id);return typeof value==='function'?value():value;},api=ledger.createOperationLedger({readObject,cursorKey:Buffer.alloc(32)});let head=api.genesis(),minimumBytes=0;
 for(let index=0;index<count;index++){
  const receipt={operation:{id:'large-'+index,digest:'sha256:'+'a'.repeat(64),actorId:'synthetic',actorRole:'admin',databaseToken:'original-literal-token'},at:'2026-11-08',changedSections:['vehicles'],revisions:{vehicles:1},result:{}},value=proof(index),plan=api.prepareAppend({head,receipt,auditEntries:[],accessProof:value}),proofJSON=JSON.stringify(value);
  minimumBytes+=Buffer.byteLength(proofJSON);
  for(const object of plan.objects)objects.set(object.id,object.json===proofJSON?()=>JSON.stringify(proof(index)):object.json);
  head=plan.head;
 }
 return Object.freeze({operationState:format.createOperationState(head),readObject,head,minimumBytes,estimatedBytes:minimumBytes+count*2048,expectedReceipts:count});
}
module.exports={makeProvider};
