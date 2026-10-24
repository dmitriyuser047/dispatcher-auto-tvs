'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process'),{isMainThread}=require('node:worker_threads');
const storage=require('../electron/storage'),sqlite=require('../electron/sqlite-storage.cjs'),commands=require('../assets/core/platform-commands.js');
const {createStorageExecutor}=require('../electron/storage-executor.cjs');
const principal={id:'executor-admin',name:'Synthetic executor administrator',role:'admin'},now='2026-10-23T12:00:00.000Z';
function fixture(t,format='json',{rows=1}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-storage-executor-')),dir=path.join(root,'db'),data=Object.fromEntries(storage.SECTIONS.map(name=>[name,[]]));
 Object.assign(data,{vehicles:[{id:'v',plate:'SYNTHETIC EXECUTOR',org:'A',fuel:'diesel',fuelGrade:'ДТ',fuelBalance:100,norm:10}],tanks:[{id:'t',name:'Synthetic source',org:'A',fuel:'diesel',balanceInit:1000}],records:Array.from({length:rows},(_,index)=>({id:'r-'+index,vehicleId:'v',date:'2026-09-10',km:1,fuelActual:0.1}))});
 const revisions=Object.fromEntries(storage.SECTIONS.map(name=>[name,1]));if(format==='sqlite')sqlite.create(dir,{data,revisions});else storage.createJson(dir,{data,revisions});
 const executors=[];t.after(async()=>{await Promise.all(executors.map(executor=>executor.close()));const target=path.resolve(root);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith('tvs-storage-executor-'));fs.rmSync(target,{recursive:true,force:true});});
 const executor=options=>{const value=createStorageExecutor(options);executors.push(value);return value;};return{root,dir,executor};
}
function request(dir,sections,id){const snap=storage.readSnapshot(dir);return{databaseToken:snap.databaseToken,base:snap.revisions,sections,operation:{id}};}
function edit(dir,field,value,id){const snap=storage.readSnapshot(dir);return request(dir,{vehicles:snap.data.vehicles.map(row=>({...row,[field]:value}))},id);}
const guard=()=>{};
for(const format of ['json','sqlite']){
 test(format+' worker commits sections, retains CAS conflicts and replays the exact original operation',async t=>{
  const {dir,executor}=fixture(t,format),run=executor(),before=storage.readSnapshot(dir),payload=edit(dir,'note','Captured comment','executor-first');let proofs=0;
  const options={principal,now,requireNegotiatedWriter:true,assertWriteCompatibility:context=>{proofs++;assert.equal(isMainThread,true);assert.equal(context.databaseToken,before.databaseToken);assert.equal(context.descriptor.schemaVersion,require('../electron/storage-format.cjs').SCHEMA_VERSION);assert.deepEqual(context.principal,principal);assert.equal(fs.existsSync(path.join(dir,'.tvs-database.lock')),true);return true;}};
  const result=await run.run('writeSections',dir,payload,options,{assertCurrent:guard});assert.equal(result.ok,true);assert.equal(result.operationReceipt.status,'committed');assert.ok(proofs>0);assert.equal(storage.readSnapshot(dir).data.vehicles[0].note,'Captured comment');
  const conflict=await run.run('writeSections',dir,{...payload,operation:{id:'executor-stale'},sections:{vehicles:before.data.vehicles.map(row=>({...row,note:'Stale comment'}))}},{principal,now},{assertCurrent:guard});assert.equal(conflict.ok,false);assert.deepEqual(conflict.conflicts,['vehicles']);
  const replay=await run.run('writeSections',dir,payload,{...options,assertWriteCompatibility:()=>{throw Object.assign(Error('Expired proof'),{code:'PROTOCOL_RENEGOTIATE',status:428});}},{assertCurrent:guard});assert.equal(replay.ok,true);assert.equal(replay.operationReceipt.status,'replayed');assert.equal(storage.readSnapshot(dir).data.vehicles[0].note,'Captured comment');
 });
 test(format+' semantic command and full write use the actual guarded storage implementations',async t=>{
  const {dir,executor}=fixture(t,format),run=executor(),snapshot=storage.readSnapshot(dir),command={type:'IssueFuel',version:1,input:{tankId:'t',target:{section:'vehicles',id:'v'},date:'2026-09-11',qty:2.25,reason:'Synthetic source document'}},envelope={protocolVersion:1,databaseToken:snapshot.databaseToken,operation:{id:'executor-command'},base:Object.fromEntries(commands.dependencies(command).map(name=>[name,snapshot.revisions[name]])),command};
  const result=await run.run('executeCommand',dir,envelope,{principal,now},{assertCurrent:guard});assert.equal(result.ok,true);assert.equal(result.command,true);assert.equal(storage.readSnapshot(dir).data.fuelMovements[0].qty,2.25);
  const replay=await run.run('executeCommand',dir,envelope,{principal,now:'invalid-after-committed-receipt'},{assertCurrent:guard});assert.equal(replay.operationReceipt.status,'replayed');
  const current=storage.readSnapshot(dir),next=structuredClone(current.data);next.vehicles[0].note='Full guarded write';const full=await run.run('writeAll',dir,next,{principal,now,databaseToken:current.databaseToken,base:current.revisions,requireBase:true,operation:{id:'executor-full'}},{assertCurrent:guard});assert.equal(full.ok,true);assert.equal(storage.readSnapshot(dir).data.vehicles[0].note,'Full guarded write');
 });
 for(const rejectedPhase of ['locked','beforeCommit','afterBackup'])test(format+' revoked session at '+rejectedPhase+' never commits business data',async t=>{
  const {root,dir,executor}=fixture(t,format),run=executor(),before=storage.readSnapshot(dir),payload=edit(dir,'note','Must not commit','executor-revoked-'+rejectedPhase),phases=[];
  await assert.rejects(run.run('writeSections',dir,payload,{principal,now},{assertCurrent:({phase})=>{phases.push(phase);if(phase===rejectedPhase)throw Object.assign(Error('Synthetic revoked session'),{code:'ACCESS_REVOKED',status:403,definitive:true});},backup:{directory:path.join(root,'backups'),keep:2}}),error=>error.code==='ACCESS_REVOKED'&&error.status===403&&error.definitive===true);
  assert.deepEqual(storage.readSnapshot(dir),before);assert.ok(phases.includes(rejectedPhase));assert.equal(fs.existsSync(path.join(dir,'.tvs-database.lock')),false);
  assert.equal(fs.existsSync(path.join(root,'backups')),rejectedPhase==='afterBackup');
 });
 test(format+' backup is made in the worker and a final ACK revocation retains an unknown committed outcome',async t=>{
  const {root,dir,executor}=fixture(t,format),run=executor(),payload=edit(dir,'note','Committed before ACK','executor-stale-ack');
  await assert.rejects(run.run('writeSections',dir,payload,{principal,now},{backup:{directory:path.join(root,'backups'),keep:3},assertCurrent:({phase})=>{if(phase==='ack')throw Object.assign(Error('Window changed after commit'),{code:'SESSION_CHANGED',status:409,definitive:true});}}),error=>error.code==='STORAGE_ACK_STALE'&&error.unknown===true&&error.definitive===false&&error.status===undefined&&error.causeCode==='SESSION_CHANGED');
  assert.equal(storage.readSnapshot(dir).data.vehicles[0].note,'Committed before ACK');assert.equal(fs.readdirSync(path.join(root,'backups')).filter(file=>file.endsWith('.zip')).length,1);
 });
}
test('queued input, principal and callback references are captured, FIFO is bounded and close drains every accepted operation',async t=>{
 const {dir,executor}=fixture(t),run=executor({maxPending:2}),before=storage.readSnapshot(dir),phases=[];
 const first=request(dir,{records:before.data.records.map(row=>({...row,note:'First FIFO edit'}))},'executor-fifo-first'),second=edit(dir,'note','Second captured FIFO edit','executor-fifo-second');
 const options={principal:{...principal},now},controls={assertCurrent:({phase})=>phases.push('second:'+phase)};
 const a=run.run('writeSections',dir,first,{principal,now},{assertCurrent:({phase})=>phases.push('first:'+phase)}),b=run.run('writeSections',dir,second,options,controls);
 second.sections.vehicles[0].note='Mutated after enqueue';options.principal.role='viewer';controls.assertCurrent=()=>{throw Error('Replaced callback must not run');};
 await assert.rejects(run.run('writeSections',dir,second,{principal,now},{assertCurrent:guard}),{code:'STORAGE_EXECUTOR_LIMIT'});
 const closing=run.close();await assert.rejects(run.run('writeSections',dir,second,{principal,now},{assertCurrent:guard}),{code:'STORAGE_EXECUTOR_CLOSED'});
 const results=await Promise.all([a,b,closing]);assert.ok(results[0].ok&&results[1].ok);const current=storage.readSnapshot(dir);assert.equal(current.data.records[0].note,'First FIFO edit');assert.equal(current.data.vehicles[0].note,'Second captured FIFO edit');assert.ok(phases.indexOf('first:ack')<phases.indexOf('second:dispatch'));assert.deepEqual(run.status(),{active:0,queued:0,maxPending:2,closing:true,pendingBytes:0,maxPayloadBytes:64*1024*1024,maxPendingBytes:128*1024*1024});
});
test('a cancelled queued operation fails before worker dispatch and cannot create its target directory',async t=>{
 const {root,dir,executor}=fixture(t),run=executor(),other=path.join(root,'never-dispatched'),before=storage.readSnapshot(dir);let current=true;
 const first=run.run('writeSections',dir,edit(dir,'note','First only','executor-dispatch-first'),{principal,now},{assertCurrent:guard});
 const second=run.run('writeAll',other,before.data,{principal,now},{assertCurrent:()=>{if(!current)throw Object.assign(Error('Cancelled before dispatch'),{code:'SESSION_CHANGED',definitive:true});}});current=false;
 await assert.rejects(second,{code:'SESSION_CHANGED',definitive:true});await first;assert.equal(fs.existsSync(other),false);
});
test('payload and total queued bytes are bounded and every finished or rejected dispatch releases its reservation',async t=>{
 const {dir,executor}=fixture(t,'sqlite'),run=executor({maxPayloadBytes:4096,maxPendingBytes:4096}),payload=edit(dir,'note','x'.repeat(2000),'executor-byte-budget');
 const active=run.run('writeSections',dir,payload,{principal,now},{assertCurrent:guard});assert.ok(run.status().pendingBytes>2000);
 await assert.rejects(run.run('writeSections',dir,payload,{principal,now},{assertCurrent:guard}),{code:'STORAGE_EXECUTOR_BYTE_LIMIT',definitive:true});
 await assert.rejects(run.run('writeSections',dir,{...payload,extra:'x'.repeat(6000)},{principal,now},{assertCurrent:guard}),{code:'STORAGE_EXECUTOR_PAYLOAD_LIMIT',definitive:true});
 await active;assert.equal(run.status().pendingBytes,0);
 await assert.rejects(run.run('writeSections',dir,edit(dir,'note','Rejected at dispatch','executor-byte-released'),{principal,now},{assertCurrent:()=>{throw Object.assign(Error('No longer current'),{code:'SESSION_CHANGED'});}}),{code:'SESSION_CHANGED'});assert.equal(run.status().pendingBytes,0);
});
test('main timers continue during actual worker preparation and diagnostics never carry source facts',async t=>{
 const {dir,executor}=fixture(t,'json',{rows:2000}),events=[],run=executor({onEvent:event=>events.push(event)}),payload=edit(dir,'note','SYNTHETIC-PRIVATE-BUSINESS-PAYLOAD','executor-heartbeat');let ticks=0;
 const timer=setInterval(()=>{if(events.some(event=>event.phase==='commit-started')&&!events.some(event=>event.phase==='commit-finished'))ticks++;},1);
 try{const result=await run.run('writeSections',dir,payload,{principal,now},{assertCurrent:guard});assert.equal(result.ok,true);}finally{clearInterval(timer);}
 assert.ok(ticks>=5,'Main timers must run inside the storage commit span; ticks='+ticks);assert.ok(events.some(event=>event.phase==='commit-finished'&&event.code==='committed'));assert.doesNotMatch(JSON.stringify(events),/SYNTHETIC-PRIVATE-BUSINESS-PAYLOAD|SYNTHETIC EXECUTOR|executor-admin/);for(const event of events)assert.ok(Object.keys(event).every(key=>['phase','code','backend','operationId','databaseToken','durationMs'].includes(key)));
});
test('fifty short-lived workers drain their transferred-port replies before executor shutdown',async t=>{
 const {dir,executor}=fixture(t,'sqlite'),run=executor({maxPending:64}),before=storage.readSnapshot(dir);let acks=0;
 const pending=Array.from({length:50},()=>run.run('writeSections',dir,{databaseToken:before.databaseToken,base:{},sections:{}},{principal,now},{assertCurrent:({phase})=>{if(phase==='ack')acks++;}}));
 const closing=run.close(),results=await Promise.all(pending);await closing;assert.equal(results.length,50);assert.ok(results.every(result=>result.ok===true));assert.equal(acks,50);assert.deepEqual(storage.readSnapshot(dir),before);
});
test('backup failures block required copies and optional copies still preserve the post-backup guard',async t=>{
 const {root,dir,executor}=fixture(t),events=[],run=executor({onEvent:event=>events.push(event)}),before=storage.readSnapshot(dir),directory=path.join(root,'not-a-directory');fs.writeFileSync(directory,'Synthetic obstacle');
 await assert.rejects(run.run('writeSections',dir,edit(dir,'note','Required backup must stop','executor-required-backup'),{principal,now},{assertCurrent:guard,backup:{directory}}));assert.deepEqual(storage.readSnapshot(dir),before);
 const phases=[],result=await run.run('writeSections',dir,edit(dir,'note','Optional backup failure is reported','executor-optional-backup'),{principal,now},{assertCurrent:({phase})=>phases.push(phase),backup:{directory,optional:true}});assert.equal(result.ok,true);assert.ok(phases.includes('afterBackup'));assert.ok(events.some(event=>event.phase==='backup-failed'&&event.code==='BACKUP_FAILED'));
});
test('storage validation issues and proof refusals survive the worker boundary',async t=>{
 const {dir,executor}=fixture(t,'sqlite'),run=executor(),before=storage.readSnapshot(dir),payload=request(dir,{records:before.data.records.map(row=>({...row,km:-1}))},'executor-invalid');
 await assert.rejects(run.run('writeSections',dir,payload,{principal,now},{assertCurrent:guard}),error=>typeof error.code==='string'&&(Array.isArray(error.issues)||Array.isArray(error.details?.issues)));
 for(const callback of [()=>false,async()=>true])await assert.rejects(run.run('writeSections',dir,edit(dir,'note','Invalid proof','executor-refused-proof'),{principal,now,requireNegotiatedWriter:true,assertWriteCompatibility:callback},{assertCurrent:guard}),error=>['PROTOCOL_RENEGOTIATE','STORAGE_EXECUTOR_ASYNC_GUARD'].includes(error.code));
 assert.deepEqual(storage.readSnapshot(dir),before);
});
test('unknown methods, functions, accessors and asynchronous guards are rejected without target IO',async t=>{
 const {root,dir,executor}=fixture(t),run=executor(),other=path.join(root,'no-input-io'),snapshot=storage.readSnapshot(dir);
 for(const options of [{principal,beforeCommit:()=>{}},{principal,getPrincipal:()=>principal},{principal,unsupported:true},{principal:{...principal,nested:()=>{}}}])await assert.rejects(run.run('writeAll',other,snapshot.data,options,{assertCurrent:guard}),{code:'STORAGE_EXECUTOR_INPUT'});
 await assert.rejects(run.run('readSnapshot',other,{}, {principal},{assertCurrent:guard}),{code:'STORAGE_EXECUTOR_INPUT'});
 await assert.rejects(run.run('writeAll',other,snapshot.data,{principal},{assertCurrent:async()=>true}),{code:'STORAGE_EXECUTOR_ASYNC_GUARD'});
 const options={principal};Object.defineProperty(options,'now',{enumerable:true,get(){throw Error('Accessor was evaluated');}});await assert.rejects(run.run('writeAll',other,snapshot.data,options,{assertCurrent:guard}),{code:'STORAGE_EXECUTOR_INPUT'});assert.equal(fs.existsSync(other),false);
});
test('unexpected worker exit reports an unknown outcome and never removes the existing owner lock',async t=>{
 const {root,dir}=fixture(t),script=String.raw`
const threads=require('node:worker_threads'),ActualWorker=threads.Worker;
threads.Worker=class extends ActualWorker{constructor(file,options){super("const {workerData}=require('node:worker_threads');require('node:fs').writeFileSync(require('node:path').join(workerData.dataDir,'.tvs-database.lock'),JSON.stringify({host:require('node:os').hostname(),pid:process.pid,nonce:'synthetic-owner'}));process.exit(9);",{eval:true,...options});}};
const {createStorageExecutor}=require(process.argv[1]),fs=require('node:fs'),path=require('node:path'),executor=createStorageExecutor();executor.run('writeAll',process.argv[2],{vehicles:[],records:[]},{},{assertCurrent:()=>{}}).then(()=>{throw Error('Unexpected success');},error=>{process.stdout.write(JSON.stringify({code:error.code,definitive:error.definitive,unknown:error.unknown,lockExists:fs.existsSync(path.join(process.argv[2],'.tvs-database.lock'))}));}).finally(()=>executor.close());`;
 const child=spawn(process.execPath,['-e',script,require.resolve('../electron/storage-executor.cjs'),dir],{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',stderr='';child.stdout.on('data',part=>output+=part);child.stderr.on('data',part=>stderr+=part);
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});assert.equal(code,0,stderr);assert.deepEqual(JSON.parse(output),{code:'STORAGE_WORKER_EXIT',definitive:false,unknown:true,lockExists:true});const lock=JSON.parse(fs.readFileSync(path.join(root,'db','.tvs-database.lock'),'utf8'));assert.equal(lock.nonce,'synthetic-owner');
});
