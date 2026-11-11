'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const host=require('./helpers/operation-history25-host.cjs'),{currentFixture}=require('./helpers/schema-format-support.cjs');
const {storage,sqlite,path,actor,A,B,AB,now}=host,store=require('../electron/operation-store.cjs'),ledger=require('../electron/operation-ledger.cjs'),format=require('../electron/storage-format.cjs');
const identity=require('../electron/database-identity.cjs'),commands=require('../assets/core/platform-commands.js'),fingerprint=require('../assets/core/request-fingerprint.js');
const clone=value=>JSON.parse(JSON.stringify(value));
const legacyRows=count=>Array.from({length:count},(_,index)=>({id:'synthetic-old-'+index,section:'vehicles',recordId:0,before:{id:0,org:'A',site:'Synthetic site'},after:{id:0,org:'A',site:'Synthetic site',note:'Original literal event '+index}}));

// Keep genuine modern receipts/proofs in the old prefix, then extend its
// immutable graph through the production legacy planner. No test edits live
// JSON/SQLite or fabricates a modern proof/receipt.
function richFixture(t,kind,{record=false}={}){
 const base=host.fixture(t,kind),mixed=host.commit(base.dir,actor,'synthetic-before-retention-mixed-'+kind),own=host.commit(base.dir,A,'synthetic-before-retention-A-'+kind);
 const snapshot=storage.readSnapshot(base.dir),closure=store.exportClosure(base.dir),objects=new Map(closure.objects.map(object=>[object.id,object.json]));
 const api=ledger.createOperationLedger({readObject:id=>objects.get(id),cursorKey:Buffer.alloc(32)}),hot=clone(snapshot.data.auditLog);let head=closure.head;
 const extra=legacyRows(1200).map((row,index)=>index%2?{...row,recordId:'0',before:{...row.before,id:'0',org:'B'},after:{...row.after,id:'0',org:'B'}}:row);
 for(let index=0;index<extra.length;index+=256){const plan=api.prepareLegacy({head,auditEntries:extra.slice(index,index+256),reservations:[]});api.putObjects(plan,(id,bytes)=>objects.set(id,typeof bytes==='string'?bytes:bytes.toString('utf8')));head=plan.head;hot.push(...plan.auditEntries);}
 const data={...snapshot.data,auditLog:hot};
 if(record){data.records=[{id:'synthetic-r',vehicleId:0,date:'2026-09-05',km:1,note:'Before'}];data.vehicles=data.vehicles.map(row=>({...row,orgHistory:[{from:'2026-01-01',to:'',org:row.org}]}));}
 const sourceIdentity=kind==='sqlite'?sqlite.readIdentity(base.dir):identity.readOrCreate(base.dir,{create:false});
 // The origin token also pins its physical path. Rebuild only this helper's
 // verified disposable target at that same path; retain its original files in
 // the same owned temporary root for the duration of the test.
 const destination=path.join(base.root,'synthetic-source-before-extension');
 assert.equal(path.dirname(path.resolve(base.dir)),path.resolve(base.root));assert.match(path.basename(base.root),/^tvs-schema25-independent-/);assert.equal(host.fs.lstatSync(base.dir).isSymbolicLink(),false);
 assert.equal(path.dirname(destination),base.root);host.fs.renameSync(base.dir,destination);
 const seed={data,revisions:snapshot.revisions,identity:sourceIdentity,operationState:format.createOperationState(head),operationObjects:[...objects].map(([id,json])=>({id,json}))};
 if(kind==='sqlite')sqlite.create(base.dir,seed);else storage.createJson(base.dir,seed);
 assert.equal(storage.readSnapshot(base.dir).databaseToken,snapshot.databaseToken);
 assert.equal(storage.readAll(base.dir).auditLog.length,1205);
 return {...base,mixed,own,initial:hot};
}
function write(dir,id,change){const request=host.intent(dir,actor,id,change),result=storage.writeSections(dir,request.payload,{principal:actor,now,compactAck:true});assert.equal(result.ok,true,JSON.stringify(result));return {...request,result};}
function commandIntent(dir,id,note){const snapshot=storage.readSnapshot(dir),command={type:'VehicleRecordAction',version:1,input:{action:'save',record:{id:'synthetic-r',vehicleId:0,date:'2026-09-05',km:1,note}}},request={protocolVersion:1,databaseToken:snapshot.databaseToken,base:Object.fromEntries(commands.dependencies(command).map(name=>[name,snapshot.revisions[name]])),operation:{id},command};request.operation.digest=fingerprint.requestDigest(request);return request;}
function allPages(dir){const rows=[];let cursor;do{const page=host.page(dir,actor,{query:{},limit:127,...(cursor?{cursor}:{})});rows.push(...page.rows);cursor=page.nextCursor;}while(cursor);return rows;}

test('foreground policy leaves physical/bootstrap ceilings and old database readability unchanged',()=>{
 assert.equal(store.HOT_LIMIT,5000);assert.equal(store.AUTO_ARCHIVE_THRESHOLD,256);assert.equal(store.HOT_KEEP,128);
 const events=legacyRows(5000),seed=store.bootstrap({auditRows:events});assert.equal(seed.hotRows.length,5000);assert.deepEqual(seed.hotRows,events);
 assert.throws(()=>store.bootstrap({auditRows:[...events,events[0]]}),{code:'OPERATION_BOOTSTRAP_LIMIT'});
});

for(const kind of ['json','sqlite']){
 test(kind+': foreground compaction preserves complete literal history, current-ACL receipt lookup/replay and paged ordering',t=>{
  const f=richFixture(t,kind),beforeRead=store.readState(f.dir);
  assert.deepEqual(store.readLogicalHistory(f.dir),f.initial);assert.deepEqual(store.readState(f.dir),beforeRead,'reading cannot archive or change the service head');
  const oldReceipt=storage.readOperation(f.dir,f.mixed.query,AB),ownReceipt=storage.readOperation(f.dir,f.own.query,A);
  assert.equal(oldReceipt.operationReceipt.status,'committed');assert.equal(ownReceipt.operationReceipt.status,'committed');
  const saved=write(f.dir,'synthetic-compaction-'+kind,rows=>rows.map(row=>row.id===0?{...row,note:'After compaction'}:row)),hot=storage.readAll(f.dir).auditLog;
  assert.equal(hot.length,130);assert.deepEqual(hot.slice(0,128),f.initial.slice(-128));
  assert.equal(saved.result.auditDelta.invalidated,true,'ordinary section writes retain their established invalidation response');assert.equal(Object.hasOwn(saved.result.canonicalSections,'auditLog'),false);
  const full=store.readLogicalHistory(f.dir);assert.deepEqual(full.slice(0,f.initial.length),f.initial);assert.deepEqual(full.slice(-2),hot.slice(-2));
  assert.deepEqual(storage.readOperation(f.dir,f.mixed.query,AB),oldReceipt);assert.deepEqual(storage.readOperation(f.dir,f.own.query,A),ownReceipt);
  assert.equal(storage.readOperation(f.dir,f.mixed.query,A).operationReceipt,null);assert.equal(storage.readOperation(f.dir,f.own.query,B).operationReceipt,null);
  const denied={...A,readable:['auditLog']};assert.equal(storage.readOperation(f.dir,f.own.query,denied).operationReceipt,null);
  const state=store.readState(f.dir),snapshot=storage.readSnapshot(f.dir),replay=storage.writeSections(f.dir,f.own.payload,{principal:A,now:'not a new clock',requireWriterSchema:true,writerSchemaVersion:3});
  assert.equal(replay.replayed,true);assert.equal(replay.operationReceipt.digest,f.own.digest);assert.deepEqual(store.readState(f.dir),state);assert.deepEqual(storage.readSnapshot(f.dir),snapshot);
  const publicRows=allPages(f.dir);assert.equal(publicRows.length,full.length);assert.deepEqual(publicRows.map(row=>row.id),full.slice().reverse().map(row=>row.id));
  const warm=write(f.dir,'synthetic-warm-'+kind,rows=>rows.map(row=>row.id===0?{...row,note:'Warm save'}:row));assert.equal(storage.readAll(f.dir).auditLog.length,132);assert.equal(warm.result.auditDelta.appended.length,2);assert.equal(warm.result.auditDelta.invalidated,undefined);
 });

 test(kind+': portable backup and restore retain archived events, exact receipts/proofs and typed IDs',t=>{
  const f=richFixture(t,kind);write(f.dir,'synthetic-before-backup-'+kind,rows=>rows.map(row=>row.id===0?{...row,note:'Archived before backup'}:row));
  const backup=require('../electron/backup-service.cjs'),archivePath=path.join(f.root,'synthetic-complete-history.zip'),targetDir=path.join(f.root,'restored'),full=store.readLogicalHistory(f.dir),expectedReceipt=store.engine(f.dir).inspectReceipt(store.readState(f.dir).head,f.own.payload.operation.id);
  backup.createPackage({sourceDir:f.dir,archivePath});backup.verifyPackage({archivePath});backup.restorePackage({archivePath,targetDir,format:kind,protectedDir:f.dir});
  assert.deepEqual(store.readLogicalHistory(targetDir),full);assert.deepEqual(storage.readAll(targetDir),storage.readAll(f.dir));
  assert.deepEqual(store.engine(targetDir).inspectReceipt(store.readState(targetDir).head,f.own.payload.operation.id),expectedReceipt);
  assert.deepEqual(store.exportClosure(targetDir),store.exportClosure(f.dir));
  assert.notEqual(storage.readSnapshot(targetDir).databaseToken,storage.readSnapshot(f.dir).databaseToken,'portable restore keeps the existing origin/generation boundary');
 });

 test(kind+': compaction preserves every event in a current batch larger than foreground retention',t=>{
  const vehicles=Array.from({length:200},(_,index)=>({id:index,org:'A',site:'Synthetic site',note:'Before'})),events=legacyRows(1200),f=currentFixture(t,kind,{data:{vehicles,auditLog:events}});
  const saved=write(f.dir,'synthetic-bulk-'+kind,rows=>rows.map(row=>({...row,note:'Changed '+row.id}))),hot=storage.readAll(f.dir).auditLog,newEvents=hot.filter(row=>row.operationId===saved.payload.operation.id);
  assert.equal(newEvents.length,201);assert.equal(hot.length,128+201);assert.deepEqual(hot.slice(0,128),events.slice(-128));assert.deepEqual(hot.slice(128),newEvents);
  assert.deepEqual(store.readLogicalHistory(f.dir),[...events,...newEvents]);
  write(f.dir,'synthetic-bulk-follow-up-'+kind,rows=>rows.map(row=>row.id===0?{...row,note:'Follow up'}:row));assert.equal(storage.readAll(f.dir).auditLog.length,130);
  assert.deepEqual(store.readLogicalHistory(f.dir).slice(1200,1401),newEvents);
 });

 test(kind+': history plans still reject stale service state, changed hot bytes and forged publication heads',t=>{
  const f=currentFixture(t,kind,{data:{vehicles:[{id:0,org:'A'}],auditLog:legacyRows(1200)}}),state=store.readState(f.dir),hot=storage.readAll(f.dir).auditLog,before=storage.readSnapshot(f.dir);
  const stale=clone(state);stale.transactionId='f'.repeat(64);
  assert.throws(()=>store.prepareCommit(f.dir,{expectedOperationState:stale,previousHotRows:hot}),error=>/OPERATION_STATE/.test(error.code));
  const wrong=clone(hot);wrong[0].after.note='forged';assert.throws(()=>store.prepareCommit(f.dir,{expectedOperationState:state,previousHotRows:wrong}),error=>/LEDGER_HOT_VIEW/.test(error.code));
  const plan=store.prepareCommit(f.dir,{expectedOperationState:state,previousHotRows:hot,archiveThroughSeq:1});assert.equal(plan.hotRows.length,1199,'manual one-row archival does not apply foreground save policy');
  const forged=clone(plan);forged.nextOperationState.head.lastSeq++;
  assert.throws(()=>store.validateCommit(f.dir,forged,{previousHotRows:hot,nextHotRows:plan.hotRows}));assert.deepEqual(storage.readSnapshot(f.dir),before);assert.deepEqual(store.readState(f.dir),state);
 });

 test(kind+': mileage compaction ACK replaces the renderer hot mirror and a lost ACK replays the same current view',t=>{
  const f=richFixture(t,kind,{record:true}),request=commandIntent(f.dir,'synthetic-record-compaction-'+kind,'First'),result=storage.executeCommand(f.dir,request,{principal:actor,now,compactAck:true}),hot=storage.readAll(f.dir).auditLog;
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(hot.length,130);assert.equal(result.auditDelta,undefined);assert.deepEqual(result.canonicalSections.auditLog.map(row=>row.id),hot.map(row=>row.id));
  const state=store.readState(f.dir),before=storage.readSnapshot(f.dir),replayed=storage.executeCommand(f.dir,request,{principal:actor,now:'invalid on replay',compactAck:true});
  assert.equal(replayed.replayed,true);assert.equal(replayed.operationReceipt.id,request.operation.id);assert.equal(replayed.operationReceipt.digest,request.operation.digest);assert.equal(replayed.auditDelta,undefined);assert.deepEqual(replayed.canonicalSections.auditLog,result.canonicalSections.auditLog);assert.deepEqual(store.readState(f.dir),state);assert.deepEqual(storage.readSnapshot(f.dir),before);
  const next=storage.executeCommand(f.dir,commandIntent(f.dir,'synthetic-record-warm-'+kind,'Second'),{principal:actor,now,compactAck:true});assert.equal(next.ok,true);assert.equal(next.auditDelta.appended.length,2);assert.equal(Object.hasOwn(next.canonicalSections,'auditLog'),false);
  const restricted=storage.executeCommand(f.dir,request,{principal:A,now,compactAck:true});assert.equal(restricted.replayed,true);assert.equal(restricted.auditDelta,undefined);assert.equal(restricted.canonicalSections.auditLog.length,4,'only the two authorized sealed operations are visible; the legacy prefix remains unverified for a narrowed reader');assert.deepEqual(restricted.canonicalSections.auditLog,storage.readSnapshot(f.dir,{principal:A}).data.auditLog);assert.equal(restricted.canonicalSections.auditLog.some(row=>row.after?.org==='B'||row.before?.org==='B'),false);
  const denied={...actor,readable:['records','vehicles','appMeta','fuelCards','fuelPeriods']},withoutAudit=storage.executeCommand(f.dir,request,{principal:denied,now,compactAck:true});assert.equal(withoutAudit.auditDelta,undefined);assert.equal(Object.hasOwn(withoutAudit.canonicalSections||{},'auditLog'),false);
 });
}
