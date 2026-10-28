'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {currentFixture}=require('./helpers/schema-format-support.cjs'),storage=require('../electron/storage'),store=require('../electron/operation-store.cjs'),ledger=require('../electron/operation-ledger.cjs'),safe=require('../electron/safe-file.cjs');
const fixtures=require('./helpers/operation-history25-fixtures.cjs'),{actor,principal,database,row,prepared,memory}=fixtures;
const clone=value=>JSON.parse(JSON.stringify(value));
function sample(){return database({vehicles:[row(0,'A'),row('0','B')]});}
function ui(){const context={window:{},console,setInterval:()=>1,clearInterval(){},document:{querySelector:()=>null},PlatformContracts:require('../assets/core/platform-contracts.js')};vm.createContext(context);vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../assets/js/25f-sync.js'),'utf8')+'\nglobalThis.state=_sync;globalThis.delta=syncAuditDelta;',context);return context;}
for(const kind of ['json','sqlite'])for(const who of [actor,principal(['A'])])test(kind+' compact ACK projects only the new visible events, updates a revision-bound baseline and replays without a second write '+(who.accessPolicy?'scoped':'full'),t=>{
 const {dir}=currentFixture(t,kind,{data:sample()}),before=storage.readSnapshot(dir,{principal:who}),next=clone(before.data.vehicles);next[0].note='Synthetic compact edit';
 const request={databaseToken:before.databaseToken,base:{vehicles:before.revisions.vehicles},sections:{vehicles:next},operation:{id:'compact-own'},...(before.scopeViews?{scopeViews:before.scopeViews}:{})};
 const result=storage.writeSections(dir,request,{principal:who,compactAck:true});assert.equal(result.ok,true);assert.equal(result.operationReceipt.status,'committed');assert.equal(Object.hasOwn(result.canonicalSections,'auditLog'),false);assert.equal(result.auditDelta.version,1);assert.equal(result.auditDelta.baseRevision,before.revisions.auditLog);assert.equal(result.auditDelta.revision,result.revisions.auditLog);
 const context=ui();context.state.revs=before.revisions;context.state.synced={auditLog:JSON.stringify(before.data.auditLog)};
 const installed=clone(context.delta(result,result.canonicalSections)),canonical=storage.readSnapshot(dir,{principal:who});assert.deepEqual(installed.auditLog,canonical.data.auditLog);assert.deepEqual(installed.vehicles,canonical.data.vehicles);
 if(who.accessPolicy)assert.equal(JSON.stringify(result).includes('"org":"B"'),false);
 const replay=storage.writeSections(dir,request,{principal:who,compactAck:true,now:'Never replan'});assert.equal(replay.operationReceipt.status,'replayed');assert.equal(replay.auditDelta.invalidated,true);assert.equal(Object.hasOwn(replay.canonicalSections,'auditLog'),false);assert.deepEqual(storage.readSnapshot(dir,{principal:who}),canonical);
});

test('compact history changes never attach to a different baseline or accept malformed canonical acknowledgements',()=>{
 const context=ui();context.state.revs={auditLog:5};context.state.synced={auditLog:'[{"id":"old","section":"vehicles"}]'};
 const response={revisions:{auditLog:6},auditDelta:{version:1,baseRevision:5,revision:6,appended:[{id:'new',section:'vehicles'}]}},canonical={vehicles:[]};
 assert.equal(context.delta({...response,auditDelta:{...response.auditDelta,baseRevision:4,revision:5},revisions:{auditLog:5}},canonical),canonical);
 for(const patch of [{version:2},{revision:7},{baseRevision:-1},{appended:{}},{extra:'Forbidden'},{appended:Array(2001).fill({})}])assert.throws(()=>context.delta({...response,auditDelta:{...response.auditDelta,...patch}},canonical),{code:'AUDIT_ACK_INVALID'});
 assert.throws(()=>context.delta(response,{auditLog:[]}),{code:'AUDIT_ACK_INVALID'});
 assert.equal(context.delta({revisions:{auditLog:6},auditDelta:{version:1,revision:6,invalidated:true}},canonical),canonical);assert.equal(context.state.revs.auditLog,5);
});

test('worker read sessions reuse immutable decodes across jobs but check fresh bytes, missing objects and current grants',()=>{
 const previous=database({vehicles:[row(0,'A')]}),next=clone(previous);next.vehicles[0].note='Changed';const value=prepared('session-verified',previous,next,{targets:[{section:'vehicles',id:0}]}),data=memory();data.append(value);
 const session=ledger.createReadSession(),read=who=>session.run(()=>ledger.withReadScope(()=>data.lookup(value.receipt.operation.id,who)));
 assert.equal(read(principal(['A'])).status,'committed');assert.equal(read(principal(['B'])),null);
 const id=data.engine.inspectReceipt(data.head,value.receipt.operation.id).proofHash,original=Buffer.from(data.objects.get(id));data.objects.get(id)[0]^=1;
 assert.throws(()=>read(actor),{code:'LEDGER_HASH'});data.objects.set(id,original);assert.equal(read(actor).status,'committed');data.objects.delete(id);assert.throws(()=>read(actor),{code:'LEDGER_MISSING'});
 session.close();assert.throws(()=>read(actor),{code:'LEDGER_PROVIDER'});
});

test('pinned file reads reuse bounded descriptors, read current bytes, reject forged pins and close every descriptor',t=>{
 const {root}=currentFixture(t,'json',{data:sample()}),dir=path.join(root,'hash-files');fs.mkdirSync(dir);const first=path.join(dir,crypto.createHash('sha256').update('ONE').digest('hex')+'.json'),second=path.join(dir,crypto.createHash('sha256').update('TWO').digest('hex')+'.json');fs.writeFileSync(first,'ONE');fs.writeFileSync(second,'TWO');let opened=0,closed=0;
 const reader=safe.createSafeFileReader({...fs,openSync(...args){opened++;return fs.openSync(...args);},closeSync(fd){closed++;return fs.closeSync(fd);}}),pin=reader.verifiedDirectory(dir),session=reader.createReadSession({maxFiles:1}),options={directory:pin,maxBytes:100};
 assert.equal(session.readRegularFileSync(first,options).toString(),'ONE');assert.equal(session.readRegularFileSync(first,options).toString(),'ONE');assert.equal(opened,1);
 assert.throws(()=>session.readRegularFileSync(first,{...options,directory:{...pin}}),{code:'SAFE_FILE_INVALID'});
 assert.equal(session.readRegularFileSync(second,options).toString(),'TWO');assert.equal(closed,1);fs.writeFileSync(second,'BAD');fs.utimesSync(second,new Date(0),new Date(0));assert.throws(()=>session.readRegularFileSync(second,options),{code:'SAFE_FILE_CHANGED'});
 session.close();assert.equal(opened,closed);assert.throws(()=>session.readRegularFileSync(first,options),{code:'SAFE_FILE_INVALID'});
});

test('a private commit witness verifies actual durable objects and cannot be forged, moved or used for another hot view',t=>{
 const previous=sample(),{dir,root}=currentFixture(t,'json',{data:previous}),next=clone(previous);next.vehicles[0].note='Synthetic planned edit';const value=prepared('private-witness',previous,next),state=store.readState(dir),plan=store.prepareCommit(dir,{expectedOperationState:state,previousHotRows:[],newEvents:value.events,receipt:value.receipt,evidence:value.proof});
 const views={previousHotRows:[],nextHotRows:plan.hotRows},validated=store.validateCommit(dir,plan,views);store.putObjects(dir,validated.objects);const expected={...views,expectedOperationState:plan.expectedOperationState,nextOperationState:plan.nextOperationState};
 assert.equal(store.verifyCommitWitness(dir,validated,expected),true);assert.equal(store.verifyCommitWitness(dir,Object.freeze(clone(validated)),expected),false);
 assert.throws(()=>store.verifyCommitWitness(dir,validated,{...expected,nextHotRows:[]}),{code:'OPERATION_STATE_CONFLICT'});
 const other=path.join(root,'other');fs.cpSync(dir,other,{recursive:true});assert.throws(()=>store.verifyCommitWitness(other,validated,expected),{code:'OPERATION_STATE_CONFLICT'});
 const object=validated.objects.find(object=>JSON.parse(object.json).status==='verified'),file=path.join(dir,'operation-ledger/objects',object.id+'.json'),bytes=fs.readFileSync(file);fs.writeFileSync(file,'{}');assert.throws(()=>store.verifyCommitWitness(dir,validated,expected),{code:'OPERATION_OBJECT_HASH'});fs.writeFileSync(file,bytes);assert.equal(store.verifyCommitWitness(dir,validated,expected),true);
 assert.equal(storage.readSnapshot(dir).data.vehicles[0].note,previous.vehicles[0].note);
});

test('the persistent worker warms a snapshot once and retains no authorization when reused for another principal',async t=>{
 const {dir}=currentFixture(t,'sqlite',{data:sample()}),threads=require('node:worker_threads'),Actual=threads.Worker;let started=0;
 threads.Worker=class extends Actual{constructor(...args){started++;super(...args);}};t.after(()=>{threads.Worker=Actual;});
 const executor=require('../electron/storage-executor.cjs').createStorageExecutor(),guard={assertCurrent:()=>true};t.after(()=>executor.close());
 const snapshot=await executor.run('readSnapshot',dir,{}, {},guard),rows=clone(snapshot.data.vehicles);rows[0].note='Worker commit';
 const result=await executor.run('writeSections',dir,{databaseToken:snapshot.databaseToken,base:{vehicles:snapshot.revisions.vehicles},sections:{vehicles:rows},operation:{id:'persistent-worker-edit'}},{principal:actor,compactAck:true},guard);assert.equal(result.ok,true);
 const restricted=await executor.run('readSnapshot',dir,{}, {principal:principal(['B'])},guard);assert.deepEqual(restricted.data.vehicles.map(row=>row.id),['0']);assert.equal(started,1);await executor.close();assert.equal(executor.status().active,0);
});

test('normal JSON fast validation still rejects an old object changed after the durable journal and recovers without applying business data',t=>{
 const {dir}=currentFixture(t,'json',{data:sample()}),initial=storage.readSnapshot(dir),first={databaseToken:initial.databaseToken,base:{vehicles:initial.revisions.vehicles},sections:{vehicles:initial.data.vehicles.map(row=>({...row,note:'Confirmed old note'}))},operation:{id:'witness-initial'}};
 storage.writeSections(dir,first,{principal:actor,compactAck:true});const before=storage.readSnapshot(dir),saved=store.engine(dir).inspectReceipt(store.readState(dir).head,'witness-initial'),file=path.join(dir,'operation-ledger/objects',saved.proofHash+'.json'),bytes=fs.readFileSync(file),link=fs.linkSync;let injected=false;
 const payload={databaseToken:before.databaseToken,base:{vehicles:before.revisions.vehicles},sections:{vehicles:before.data.vehicles.map(row=>({...row,note:'MUST NOT COMMIT'}))},operation:{id:'witness-rejected'}};
 fs.linkSync=function(source,destination,...args){const result=link.call(this,source,destination,...args);if(!injected&&path.basename(String(destination))==='.transaction.json'){injected=true;fs.writeFileSync(file,'{}');}return result;};
 try{assert.throws(()=>storage.writeSections(dir,payload,{principal:actor,compactAck:true}),error=>/^(LEDGER_|OPERATION_|SAFE_)/.test(error.code));}finally{fs.linkSync=link;}
 assert.equal(injected,true);assert.equal(JSON.parse(fs.readFileSync(storage.sectionFile(dir,'vehicles')))[0].note,'Confirmed old note');fs.writeFileSync(file,bytes);
 const recovered=storage.readSnapshot(dir);assert.equal(recovered.data.vehicles[0].note,'Confirmed old note');assert.equal(storage.readOperation(dir,{id:'witness-rejected',digest:require('../assets/core/platform-kernel.js').requestDigest(payload)},actor).operationReceipt,null);
});
