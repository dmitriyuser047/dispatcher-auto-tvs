'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const storage=require('../electron/storage.js'),store=require('../electron/operation-store.cjs'),format=require('../electron/storage-format.cjs'),ledger=require('../electron/operation-ledger.cjs'),sqlite=require('../electron/sqlite-storage.cjs'),{currentFixture,schema}=require('./helpers/schema-format-support.cjs'),host=require('./helpers/operation-history25-host.cjs'),{makeHotProofFixture}=require('./helpers/hot-proof-fixture.cjs');
function data(hotRows){return{...Object.fromEntries(schema.sections.map(name=>[name,[]])),vehicles:[{id:0,plate:'SYNTHETIC',org:'A',site:'Synthetic site'}],auditLog:hotRows};}
function maintenance(dir,hotRows){const expectedOperationState=store.readState(dir),nextOperationState=format.createOperationState(expectedOperationState.head),input={expectedOperationState,nextOperationState,operationPlans:[]},views={previousHotRows:hotRows,nextHotRows:hotRows};return{input,views,validated:store.validateCommit(dir,input,views)};}
function largeHot(){
 const objects=new Map(),proofHashes=[],hotRows=[],api=require('./helpers/hot-proof-fixture.cjs').createLegacyRawLedger({readObject:id=>objects.get(id),cursorKey:Buffer.alloc(32)}),padding='x'.repeat(6*1024*1024);let head=api.genesis(),proofBytes=0;
 for(let index=0;index<12;index++){
  const operation={id:'compact-witness-'+index,digest:'sha256:'+'a'.repeat(64),actorId:'synthetic',actorRole:'admin',databaseToken:'synthetic-original'},proof={version:1,status:'verified',requiredSections:['vehicles'],subjects:[],request:{operation,index,padding}},event={section:'vehicles',before:null,after:{id:index,note:'Synthetic hot event'}},plan=api.prepareAppend({head,receipt:{operation,at:host.now,changedSections:['vehicles'],revisions:{vehicles:index+1},result:{}},auditEntries:[event],accessProof:proof});
  for(const object of plan.objects){objects.set(object.id,object.json);if(object.json.includes('"padding"')){proofHashes.push(object.id);proofBytes+=Buffer.byteLength(object.json);}}head=plan.head;hotRows.push(event);
 }return{objects,proofHashes,proofBytes,hotRows,head,operationState:format.createOperationState(head)};
}

test('JSON private commit witness stays compact beyond64MiB and rereads every current proof before accepting it',t=>{
 const f=largeHot();assert.ok(f.proofBytes>64*1024*1024);const {dir}=currentFixture(t,'json',{data:data(f.hotRows),operationState:f.operationState,operationProvider:{readObject:id=>f.objects.get(id)}}),checked=maintenance(dir,f.hotRows),verify=extra=>store.verifyCommitWitness(dir,checked.validated,{...checked.input,...checked.views,...extra});
 const open=fs.openSync,seen=new Set();try{fs.openSync=function(file){const name=path.basename(String(file),'.json');if(f.proofHashes.includes(name))seen.add(name);return open.apply(this,arguments);};assert.equal(verify(),true);}finally{fs.openSync=open;}assert.equal(seen.size,f.proofHashes.length);
 assert.throws(()=>verify({nextHotRows:f.hotRows.slice(1)}),{code:'OPERATION_STATE_CONFLICT'});assert.throws(()=>verify({expectedOperationState:format.createOperationState(f.head)}),{code:'OPERATION_STATE_CONFLICT'});
 const id=f.proofHashes[0],file=path.join(dir,'operation-ledger/objects',id+'.json'),original=f.objects.get(id);
 for(const changed of [original.replace('"padding":"x','"padding":"y'),'{}']){fs.writeFileSync(file,changed);assert.throws(()=>verify(),{code:'OPERATION_OBJECT_HASH'});fs.writeFileSync(file,original);}
 fs.unlinkSync(file);assert.throws(()=>verify(),{code:'OPERATION_OBJECT_HASH'});fs.writeFileSync(file,original);fs.writeFileSync(file,'x'.repeat(8*1024*1024+1));assert.throws(()=>verify());fs.writeFileSync(file,original);assert.equal(verify(),true);
 // A caller cannot forge the private capability; recovery validates its full
 // durable reference instead. A large witness stores no portable raw graph.
 assert.equal(store.verifyCommitWitness(dir,structuredClone(checked.validated),{...checked.input,...checked.views}),false);
 assert.deepEqual(store.validateCommit(dir,checked.validated.reference,{...checked.views,recovery:true}).nextOperationState,checked.input.nextOperationState);
});

test('compact commit witnesses retain the512-object bound and fall back to full recovery validation',t=>{
 const f=makeHotProofFixture({count:257,rows:0,tag:'bounded-compact-witness'}),{dir}=currentFixture(t,'sqlite',{data:data(f.hotRows),operationState:format.createOperationState(f.head),operationProvider:{readObject:id=>f.objects.get(id)}}),checked=maintenance(dir,f.hotRows);
 assert.equal(store.verifyCommitWitness(dir,checked.validated,{...checked.input,...checked.views}),false);assert.deepEqual(store.validateCommit(dir,checked.validated.reference,{...checked.views,recovery:true}).nextOperationState,checked.input.nextOperationState);
});

test('SQLite commit reads fresh rows after a trusted hook and rolls back an inconsistent hot view',t=>{
 const {dir}=host.fixture(t,'sqlite');host.commit(dir,host.actor,'seed-fresh-hot-view');const before=storage.readSnapshot(dir),value=host.intent(dir,host.actor,'changed-after-read'),{DatabaseSync}=require('node:sqlite'),prepare=DatabaseSync.prototype.prepare;let current,hook=false;
 try{DatabaseSync.prototype.prepare=function(sql){if(/FROM section_rows ORDER BY/.test(sql))current=this;return prepare.apply(this,arguments);};assert.throws(()=>storage.writeSections(dir,value.payload,{principal:host.actor,now:host.now,beforeCommit:()=>{assert.ok(current);hook=true;current.prepare("UPDATE section_rows SET row_json=? WHERE section='auditLog' AND position=0").run(JSON.stringify({section:'vehicles',after:{id:0,note:'Unbound hook mutation'}}));}}),{code:'LEDGER_HOT_VIEW'});}finally{DatabaseSync.prototype.prepare=prepare;}
 assert.equal(hook,true);assert.deepEqual(storage.readSnapshot(dir),before);assert.equal(storage.readOperation(dir,{id:value.payload.operation.id,digest:value.digest},host.actor).operationReceipt,null);
});

test('SQLite ordinary save authenticates old provider bytes without an extra commit readAll traversal',t=>{
 const {dir}=host.fixture(t,'sqlite'),first=host.commit(dir,host.actor,'seed-old-proof'),record=store.engine(dir).inspectReceipt(store.readState(dir).head,first.query.id),proof=sqlite.readOperationText(dir,record.proofHash),value=host.intent(dir,host.actor,'count-old-proof'),createHash=crypto.createHash;let authenticated=0;
 try{crypto.createHash=function(){const hash=createHash.apply(this,arguments),update=hash.update;hash.update=function(bytes){if(bytes===proof||Buffer.isBuffer(bytes)&&bytes.equals(Buffer.from(proof)))authenticated++;return update.apply(this,arguments);};return hash;};assert.equal(storage.writeSections(dir,value.payload,{principal:host.actor,now:host.now,compactAck:true}).ok,true);}finally{crypto.createHash=createHash;}
 assert.ok(authenticated>=4,'every remaining hot-view boundary authenticates current bytes');assert.equal(authenticated,4,'the redundant pre-validation traversal must stay removed');
});
