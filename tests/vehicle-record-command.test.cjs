'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const commands=require('../assets/core/platform-commands.js'),contracts=require('../assets/core/platform-contracts.js'),fingerprint=require('../assets/core/request-fingerprint.js'),service=require('../electron/command-service.cjs'),store=require('../electron/operation-store.cjs');
const {currentFixture,storage,schema}=require('./helpers/schema-format-support.cjs');
const actor={id:'synthetic-journal-admin',name:'Synthetic journal admin',role:'admin'},now='2026-11-11T12:00:00.000Z';
function data(){const db=Object.fromEntries(schema.sections.map(name=>[name,[]]));db.vehicles=[{id:0,plate:'NUMERIC',org:'A',site:'North',orgHistory:[{from:'2026-01-01',to:'',org:'A'}]},{id:'0',plate:'TEXT',org:'B',site:'South',orgHistory:[{from:'2026-01-01',to:'',org:'B'}]}];db.records=[{id:0,vehicleId:0,date:'2026-09-05',km:10,odoStart:100,odoEnd:110,fuelGrade:'ДТ',fuelIssued:0,fuelActual:1.12345,fuelCardNum:null,fuelOrg:'Frozen historical organisation',fuelProvider:'Frozen provider',route:'Synthetic legacy route',note:'Original',legacyMetadata:{source:'Synthetic source retained'}},{id:'0',vehicleId:'0',date:'2026-09-06',km:20,note:'Untouched typed string ID'}];db.fuelCards=[{id:'cash',number:'НАЛИЧКА',org:'A',provider:'Synthetic provider',orgHistory:[{from:'2026-01-01',to:'',org:'A'}]}];return db;}
const command=record=>({type:'VehicleRecordAction',version:1,input:{action:'save',record}});
function intent(directory,record,id='synthetic-record-save'){const snap=storage.readSnapshot(directory),cmd=command(record),value={protocolVersion:1,databaseToken:snap.databaseToken,base:Object.fromEntries(commands.dependencies(cmd).map(name=>[name,snap.revisions[name]])),command:cmd,operation:{id}};value.operation.digest=fingerprint.requestDigest(value);return {snap,value};}
const options=()=>({principal:actor,now,compactAck:true});

test('record command contracts accept exact typed IDs and reject unknown fields, derived attribution and executable input',()=>{
 for(const id of [0,'0'])assert.equal(contracts.validateCommand(command({id,vehicleId:id,date:'2026-09-05',km:0})).input.record.id,id);
 for(const extra of [{fuelOrg:'forged'},{fuelProvider:'forged'},{fuelMovementId:'forged'},{importProvenance:{}},{deleted:true},{legacyMetadata:{overwrite:true}}])assert.throws(()=>contracts.validateCommand(command({id:'new',vehicleId:0,date:'2026-09-05',km:1,...extra})),{code:'INVALID_COMMAND'});
 assert.throws(()=>contracts.validateCommand(command({vehicleId:0,date:'2026-09-05',km:1})));assert.throws(()=>contracts.validateCommand(command({id:'new',vehicleId:0,date:'2026-02-31',km:1})));
 let getters=0;const record={id:'new',vehicleId:0,date:'2026-09-05',km:1};Object.defineProperty(record,'note',{enumerable:true,get(){getters++;return 'Never execute';}});assert.throws(()=>contracts.validateCommand(command(record)));assert.equal(getters,0);
});

test('exact read closure retains one record and vehicle instead of the entire vehicle journal',()=>{
 const db=data();db.records.push(...Array.from({length:2200},(_,index)=>({id:'synthetic-history-'+index,vehicleId:0,date:'2026-09-10',km:1})));
 const cmd=command({id:0,vehicleId:0,date:'2026-09-05',km:10,note:'Changed'}),closure=service.collectCommandEvidence(db,cmd,commands.dependencies(cmd));assert.equal(closure.complete,true);assert.deepEqual(closure.selectedTargets.map(item=>[item.section,item.id]),[['records',0],['vehicles',0]]);assert.equal(closure.rows.length,2);assert.deepEqual(commands.footprint(cmd),['records']);
 const created=command({id:'new',vehicleId:0,date:'2026-09-05',km:1,fuelCardNum:'НАЛИЧКА'}),selected=service.collectCommandEvidence(db,created,commands.dependencies(created));assert.equal(selected.selectedTargets.some(item=>item.section==='records'),false);assert.equal(selected.selectedTargets.some(item=>item.section==='fuelCards'&&item.id==='cash'),true);
});

for(const kind of ['sqlite','json']){
 test(kind+': targeted save preserves unknown source fields, exact 0/string identities and historical attribution with durable replay',t=>{
  const source=data(),{dir}=currentFixture(t,kind,{data:source}),request=intent(dir,{id:0,vehicleId:0,date:'2026-09-05',km:10,note:'Reviewed',fuelActual:1.12345,route:'Synthetic legacy route'}),before=request.snap;
  const result=storage.executeCommand(dir,request.value,options());assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.command,true);assert.equal(result.operationReceipt.digest,request.value.operation.digest);const after=storage.readSnapshot(dir);assert.equal(after.data.records[0].note,'Reviewed');assert.equal(after.data.records[0].fuelActual,1.12345);assert.deepEqual(after.data.records[0].legacyMetadata,source.records[0].legacyMetadata);assert.equal(after.data.records[0].fuelOrg,source.records[0].fuelOrg);assert.equal(after.data.records[0].fuelProvider,source.records[0].fuelProvider);assert.deepEqual(after.data.records[1],source.records[1]);assert.equal(after.revisions.records,before.revisions.records+1);
  const receipt=store.engine(dir).inspectReceipt(store.readState(dir).head,request.value.operation.id);assert.equal(receipt.proof.status,'verified');assert.equal(receipt.proof.request.selectedTargets.length,2);
  const replay=storage.executeCommand(dir,request.value,{...options(),now:'not a clock'});assert.equal(replay.ok,true);assert.equal(replay.replayed,true);assert.deepEqual(storage.readSnapshot(dir).data,after.data);assert.equal(storage.readSnapshot(dir).revisions.records,after.revisions.records);
 });
 test(kind+': creation uses the supplied stable ID and computes attribution on the server',t=>{
  const {dir}=currentFixture(t,kind,{data:data()}),request=intent(dir,{id:'new-stable-id',vehicleId:0,date:'2026-10-01',km:2,odoStart:100,odoEnd:102,fuelCardNum:'НАЛИЧКА',route:['Synthetic route']},'synthetic-create-'+kind),result=storage.executeCommand(dir,request.value,options());assert.equal(result.ok,true,JSON.stringify(result));const rows=storage.readSnapshot(dir).data.records;assert.equal(rows.length,3);assert.equal(rows[2].id,'new-stable-id');assert.equal(rows[2].vehicleId,0);assert.equal(rows[2].fuelOrg,'A');assert.equal(rows[2].fuelProvider,'Synthetic provider');assert.equal(storage.executeCommand(dir,request.value,options()).replayed,true);assert.equal(storage.readSnapshot(dir).data.records.length,3);
 });
 test(kind+': stale records CAS never overwrites a concurrent unrelated journal edit',t=>{
  const {dir}=currentFixture(t,kind,{data:data()}),request=intent(dir,{id:0,vehicleId:0,date:'2026-09-05',km:10,note:'Would overwrite'},'synthetic-stale-'+kind),rows=structuredClone(request.snap.data.records);rows[1].note='Concurrent edit';const raw=storage.writeSections(dir,{databaseToken:request.snap.databaseToken,base:{records:request.snap.revisions.records},sections:{records:rows},operation:{id:'synthetic-concurrent-'+kind}},options());assert.equal(raw.ok,true);const before=storage.readSnapshot(dir),result=storage.executeCommand(dir,request.value,options());assert.equal(result.ok,false);assert.equal(result.code,'COMMAND_CONFLICT');assert.deepEqual(storage.readSnapshot(dir).data,before.data);
 });
 test(kind+': changed precision, negative mileage, odometer mismatch and vehicle transfer are rejected atomically',t=>{
  const {dir}=currentFixture(t,kind,{data:data()}),before=storage.readSnapshot(dir);for(const [index,extra]of [{fuelActual:1.12346},{km:-1},{odoEnd:120},{vehicleId:'0'},{route:{forged:true}}].entries()){
   const request=intent(dir,{id:0,vehicleId:0,date:'2026-09-05',km:10,...extra},'synthetic-invalid-'+kind+'-'+index);assert.throws(()=>storage.executeCommand(dir,request.value,options()));assert.deepEqual(storage.readSnapshot(dir).data,before.data);
  }
 });
 test(kind+': linked movements, cancelled records and closed fuel periods use guarded correction paths',t=>{
  for(const [index,alter]of [db=>{db.records[0].fuelMovementId='synthetic-linked';},db=>{db.records[0].deleted=true;},db=>{db.records[0].status='posted';},db=>{db.fuelPeriods=[{month:'2026-09',closed:true}];}].entries()){
   const source=data();alter(source);const {dir}=currentFixture(t,kind,{data:source}),request=intent(dir,{id:0,vehicleId:0,date:'2026-09-05',km:10,note:'Forbidden'},'synthetic-protected-'+kind+'-'+index),before=storage.readSnapshot(dir);assert.throws(()=>storage.executeCommand(dir,request.value,options()));assert.deepEqual(storage.readSnapshot(dir).data,before.data);
  }
 });
 test(kind+': current standard create/update ACL denies a viewer, hidden source and changed field mask',t=>{
  const {dir}=currentFixture(t,kind,{data:data()}),request=intent(dir,{id:0,vehicleId:0,date:'2026-09-05',km:10,note:'Denied'},'synthetic-acl-'+kind),before=storage.readSnapshot(dir);
  for(const principal of [{...actor,role:'viewer'},{...actor,accessPolicy:{version:1,grants:[{org:'B',site:'South'}]}},{...actor,writeFields:{records:['km']}}]){assert.throws(()=>storage.executeCommand(dir,request.value,{...options(),principal}),{code:'ACCESS_DENIED'});assert.deepEqual(storage.readSnapshot(dir).data,before.data);}
 });
 test(kind+': an existing standard update grant can edit its own journal without a new custom action grant',t=>{
  const {dir}=currentFixture(t,kind,{data:data()}),request=intent(dir,{id:0,vehicleId:0,date:'2026-09-05',km:10,note:'Scoped reviewed'},'synthetic-standard-grant-'+kind),principal={...actor,accessPolicy:{version:1,grants:[{org:'A',site:{any:true},actions:['read','update']}],sections:{records:{writeFields:['note']}}}};const result=storage.executeCommand(dir,request.value,{...options(),principal});assert.equal(result.ok,true,JSON.stringify(result));assert.equal(storage.readSnapshot(dir).data.records[0].note,'Scoped reviewed');
 });
 test(kind+': posted fuel acts still protect their journal sources through the shared kernel',t=>{
  const source={vehicles:[{id:'v',org:'A',fuel:'gasoline',fuelGrade:'АИ-95',fuelBalance:50}],records:[{id:'r',vehicleId:'v',date:'2026-09-05',fuelGrade:'АИ-95',fuelIssued:40,fuelActual:20,fuelIdle:2,km:100}],fuelPurchases:[{id:'p',vehicleId:'v',recordId:'r',date:'2026-09-05',grade:'АИ-95',qty:40,manual:true,sourceOrg:'A'}],fuelCards:[],monthlyFuel:[],fuelWriteoffs:[]},engine=require('../assets/core/writeoff-engine.js'),request={month:'2026-09',org:'A',grade:'АИ-95',date:'2026-09-30'},preview=engine.prepare(source,request);source.fuelWriteoffs=[engine.post(source,request,{id:'act',number:'Synthetic posted',postedAt:'2026-10-21T10:00:00.000Z',postedBy:actor,expectedFingerprint:preview.sourceFingerprint})];
  const {dir}=currentFixture(t,kind,{data:source}),operation=intent(dir,{id:'r',vehicleId:'v',date:'2026-09-05',km:100,fuelActual:21},'synthetic-posted-source-'+kind),before=storage.readSnapshot(dir);assert.throws(()=>storage.executeCommand(dir,operation.value,options()),{code:'POSTED_SOURCE_LOCKED'});assert.deepEqual(storage.readSnapshot(dir).data,before.data);
 });
}
