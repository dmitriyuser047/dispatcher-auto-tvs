'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const storage=require('../electron/storage.js'),sqlite=require('../electron/sqlite-storage.cjs'),ledger=require('../electron/operation-ledger.cjs'),format=require('../electron/storage-format.cjs'),multipart=require('../electron/multipart-backup.cjs');
for(const kind of ['json','sqlite'])test(kind+' checkpoint captures a real hot history without reading or decoding any historical proof',t=>{
 const parent=fs.realpathSync.native(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'tvs-hot-checkpoint-')),source=path.join(root,'source'),checkpoint=path.join(root,'checkpoint.json'),objects=new Map(),api=ledger.createOperationLedger({readObject:id=>objects.get(id),cursorKey:Buffer.alloc(32)}),events=[];let head=api.genesis();
 t.after(()=>{assert.equal(path.dirname(root),parent);assert.match(path.basename(root),/^tvs-hot-checkpoint-/);assert.equal(fs.lstatSync(root).isSymbolicLink(),false);fs.rmSync(root,{recursive:true,force:true});});
 for(let i=0;i<2;i++){
  const event={section:'vehicles',before:null,after:{id:i,note:'Actual hot event '+i}},operation={id:'hot-'+i,digest:'sha256:'+'a'.repeat(64),actorId:'synthetic',actorRole:'admin',databaseToken:'original-literal-token'},proof={version:1,status:'verified',requiredSections:['vehicles'],subjects:[],request:{selectedTargets:[],operation,padding:'x'.repeat(1024*1024)}},plan=api.prepareAppend({head,receipt:{operation,at:'2026-11-08',changedSections:['vehicles'],revisions:{vehicles:i+1},result:{}},auditEntries:[event],accessProof:proof});
  for(const object of plan.objects)objects.set(object.id,object.json);head=plan.head;events.push(event);
 }
 const data=Object.fromEntries(storage.SECTIONS.map(n=>[n,[]]));data.vehicles=[{id:0,plate:'NUMERIC',fuelBalance:923.537},{id:1,plate:'OTHER',fuelBalance:0}];data.auditLog=events;
 const operationState=format.createOperationState(head);(kind==='sqlite'?sqlite.create:storage.createJson)(source,{data,operationState,operationProvider:{readObject:id=>objects.get(id)}});assert.equal(head.hot.length,2);
 const original={readAll:storage.readAll,openSync:fs.openSync,readOperationText:sqlite.readOperationText,readOperationObject:sqlite.readOperationObject};let historyReads=0;
 const denied=()=>{historyReads++;throw Object.assign(Error('Checkpoint must defer historical proof reads to its background job'),{code:'SYNTHETIC_HISTORY_READ'});};
 try{
  storage.readAll=denied;sqlite.readOperationText=denied;sqlite.readOperationObject=denied;fs.openSync=function(filename,...args){if(String(filename).includes('operation-ledger')&&String(filename).includes('objects'))return denied();return original.openSync.call(this,filename,...args);};
  const result=storage.withDatabaseLock(source,physical=>{const capture=()=>multipart.capture(physical,checkpoint);return kind==='sqlite'?sqlite.transaction(physical,capture,{readOnly:true}):capture();});
  assert.equal(historyReads,0);assert.deepEqual(result.checkpoint.operationState,operationState);assert.deepEqual(result.checkpoint.data.auditLog,events);assert.equal(result.checkpoint.data.vehicles[0].fuelBalance,923.537);
 }finally{storage.readAll=original.readAll;sqlite.readOperationText=original.readOperationText;sqlite.readOperationObject=original.readOperationObject;fs.openSync=original.openSync;}
 assert.deepEqual(storage.readSnapshot(source).data,data);
});
