'use strict';
// A genuine ledger with a hot event for every distinct, dense historical
// proof. Synthetic JSON only; no files or actual application databases.
const crypto=require('node:crypto'),ledger=require('../../electron/operation-ledger.cjs');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function makeHotProofFixture({count=48,rows=12000,tag='hot-proof-benchmark'}={}){
 const objects=new Map(),proofHashes=new Set(),hotRows=[],stats={proofReads:0},metadata=Array.from({length:rows},(_,id)=>({id,section:'records',org:'Synthetic organisation',site:'Synthetic object',qty:1.001,note:'Synthetic frozen historical evidence row'}));
 const readObject=id=>{if(proofHashes.has(id))stats.proofReads++;return objects.get(id);},engine=ledger.createOperationLedger({readObject,cursorKey:Buffer.alloc(32)});let head=engine.genesis(),proofBytes=0;
 for(let index=0;index<count;index++){
  const operation={id:tag+'-'+index,digest:'sha256:'+'a'.repeat(64),actorId:'synthetic',actorRole:'admin',databaseToken:'synthetic-hot-db'},proof={version:1,status:'verified',requiredSections:['vehicles'],subjects:[],request:{operation,selectedTargets:[],tag,index,metadata}},event={section:'vehicles',before:null,after:{id:index,note:'Synthetic historical event '+index}},plan=engine.prepareAppend({head,receipt:{operation,at:'2026-11-08T09:00:00.000Z',changedSections:['vehicles'],revisions:{vehicles:index+1},result:{}},auditEntries:[event],accessProof:proof}),proofJSON=JSON.stringify(proof);
  for(const object of plan.objects)objects.set(object.id,object.json);const proofHash=hash(proofJSON);if(!objects.has(proofHash))throw Error('Synthetic proof canonical bytes differ');proofHashes.add(proofHash);proofBytes+=Buffer.byteLength(proofJSON);head=plan.head;hotRows.push(event);
 }
 return{engine,head,hotRows,objects,proofHashes,proofBytes,stats,readObject};
}
module.exports={makeHotProofFixture};
