'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const {currentFixture,storage}=require('./helpers/schema-format-support.cjs'),sqlite=require('../electron/sqlite-storage.cjs');
const commands=require('../assets/core/platform-commands.js'),fingerprint=require('../assets/core/request-fingerprint.js');
const actor={id:'synthetic-snapshot-admin',name:'Synthetic snapshot admin',role:'admin'},now='2026-11-11T12:00:00.000Z';
const sample=()=>({vehicles:[{id:0,org:'A',note:'Original vehicle'}],records:[{id:0,vehicleId:0,date:'2026-09-05',km:1,note:'Original record'}],auditLog:[{id:'synthetic-old',section:'vehicles',before:{id:0,org:'A'},after:{id:0,org:'A'}}]});
function withConnection(dir,action){const prepare=DatabaseSync.prototype.prepare;let active;try{DatabaseSync.prototype.prepare=function(){active=this;return prepare.apply(this,arguments);};return sqlite.transaction(dir,()=>action(active));}finally{DatabaseSync.prototype.prepare=prepare;}}
function intent(dir,id){const snapshot=storage.readSnapshot(dir),command={type:'VehicleRecordAction',version:1,input:{action:'save',record:{id:0,vehicleId:0,date:'2026-09-05',km:1,note:'Reviewed record'}}},request={protocolVersion:1,databaseToken:snapshot.databaseToken,base:Object.fromEntries(commands.dependencies(command).map(name=>[name,snapshot.revisions[name]])),command,operation:{id}};request.operation.digest=fingerprint.requestDigest(request);return request;}

test('only a fully validated immutable command read can be reused inside its unchanged SQLite connection',t=>{
 const {dir}=currentFixture(t,'sqlite',{data:sample()});let captured;
 withConnection(dir,db=>{
  captured=sqlite.captureCommandRows(dir);assert.equal(Object.isFrozen(captured),true);assert.equal(Object.isFrozen(captured.records),true);assert.equal(Object.isFrozen(captured.records[0]),true);
  assert.throws(()=>{captured.records[0].note='Untrusted mutation';},TypeError);
  assert.equal(sqlite.reuseCommandRows(dir,captured),captured);assert.equal(sqlite.reuseCommandRows(dir,structuredClone(captured)),null);assert.equal(sqlite.reuseCommandRows(dir,sqlite.readAll(dir)),null);
  sqlite.transaction(dir,()=>assert.equal(sqlite.reuseCommandRows(dir,captured),captured),{readOnly:true});
  db.prepare("UPDATE section_rows SET row_json=? WHERE section='vehicles' AND position=0").run(JSON.stringify({...captured.vehicles[0],note:'Intervening write'}));
  assert.equal(sqlite.reuseCommandRows(dir,captured),null,'any SQL write invalidates the source witness');assert.equal(sqlite.readAll(dir).vehicles[0].note,'Intervening write');
 });
 assert.equal(sqlite.reuseCommandRows(dir,captured),null,'a closed connection cannot lend a source to the next operation');
 sqlite.transaction(dir,()=>assert.equal(sqlite.reuseCommandRows(dir,captured),null));
});

test('schema edits, rolled-back writes, another active database and failed nested scopes cannot reuse a source',t=>{
 const a=currentFixture(t,'sqlite',{data:sample()}),b=currentFixture(t,'sqlite',{data:sample()});
 withConnection(a.dir,db=>{
  const source=sqlite.captureCommandRows(a.dir);sqlite.transaction(b.dir,()=>assert.equal(sqlite.reuseCommandRows(b.dir,source),null));assert.equal(sqlite.reuseCommandRows(a.dir,source),source);
  db.exec('CREATE TABLE synthetic_empty_schema_change(value TEXT)');assert.equal(sqlite.reuseCommandRows(a.dir,source),null,'DDL can change the source even without total_changes');
  const afterDDL=sqlite.captureCommandRows(a.dir);db.exec('SAVEPOINT synthetic_source_change');db.prepare("UPDATE section_rows SET row_json=? WHERE section='vehicles' AND position=0").run(JSON.stringify({...afterDDL.vehicles[0],note:'Rolled back'}));db.exec('ROLLBACK TO synthetic_source_change; RELEASE synthetic_source_change');assert.equal(sqlite.reuseCommandRows(a.dir,afterDDL),null,'a reverted write still invalidates its earlier witness');
 });
 assert.throws(()=>withConnection(a.dir,()=>{const source=sqlite.captureCommandRows(a.dir);try{sqlite.transaction(a.dir,()=>{throw Object.assign(Error('Synthetic nested failure'),{code:'SYNTHETIC_NESTED_FAILURE'});});}catch{}assert.equal(sqlite.reuseCommandRows(a.dir,source),null);}),{code:'SYNTHETIC_NESTED_FAILURE'});
});

test('mileage command avoids the duplicate planning read and keeps the fresh post-hook physical read',t=>{
 const {dir}=currentFixture(t,'sqlite',{data:sample()}),request=intent(dir,'synthetic-snapshot-command'),prepare=DatabaseSync.prototype.prepare;let fullReads=0,active;
 try{
  DatabaseSync.prototype.prepare=function(sql){active=this;if(/^SELECT section,row_json FROM section_rows ORDER BY section,position$/.test(sql))fullReads++;return prepare.apply(this,arguments);};
  const result=storage.executeCommand(dir,request,{principal:actor,now,compactAck:true,beforeCommit(){assert.equal(fullReads,1,'the validated planner source is reused before the hook');active.prepare("UPDATE section_rows SET row_json=? WHERE section='vehicles' AND position=0").run(JSON.stringify({id:0,org:'A',note:'Fresh post-hook vehicle'}));}});
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(fullReads,2,'physical commit still rereads the actual locked rows after the hook');
 }finally{DatabaseSync.prototype.prepare=prepare;}
 const after=storage.readSnapshot(dir);assert.equal(after.data.records[0].note,'Reviewed record');assert.equal(after.data.vehicles[0].note,'Fresh post-hook vehicle');assert.equal(after.data.auditLog.length,3);
 const replay=storage.executeCommand(dir,request,{principal:actor,now:'invalid new replay clock',compactAck:true});assert.equal(replay.replayed,true);assert.deepEqual(storage.readSnapshot(dir),after);
});

test('an altered hot row after the hook is still rejected and the entire SQLite operation rolls back',t=>{
 const {dir}=currentFixture(t,'sqlite',{data:sample()}),before=storage.readSnapshot(dir),request=intent(dir,'synthetic-snapshot-hot-guard'),prepare=DatabaseSync.prototype.prepare;let active;
 try{DatabaseSync.prototype.prepare=function(){active=this;return prepare.apply(this,arguments);};assert.throws(()=>storage.executeCommand(dir,request,{principal:actor,now,compactAck:true,beforeCommit(){active.prepare("UPDATE section_rows SET row_json=? WHERE section='auditLog' AND position=0").run(JSON.stringify({...before.data.auditLog[0],after:{id:0,org:'B',note:'Forged hook source'}}));}}),error=>/^(LEDGER_|OPERATION_)/.test(error.code));}finally{DatabaseSync.prototype.prepare=prepare;}
 assert.deepEqual(storage.readSnapshot(dir),before);assert.equal(storage.readOperation(dir,{id:request.operation.id,digest:request.operation.digest},actor).operationReceipt,null);
});

test('JSON mileage commands retain their independent fresh source read',t=>{
 const {dir}=currentFixture(t,'json',{data:sample()}),request=intent(dir,'synthetic-json-fresh-source'),capture=sqlite.captureCommandRows;
 try{sqlite.captureCommandRows=()=>assert.fail('JSON has no transaction-bound SQLite witness');const result=storage.executeCommand(dir,request,{principal:actor,now,compactAck:true});assert.equal(result.ok,true,JSON.stringify(result));assert.equal(storage.readSnapshot(dir).data.records[0].note,'Reviewed record');}finally{sqlite.captureCommandRows=capture;}
});
