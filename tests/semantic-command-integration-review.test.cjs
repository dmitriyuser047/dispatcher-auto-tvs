'use strict';
// Independent review harness: actual renderer bridge + durable recovery + real
// temporary storage. No application profile or working database is opened.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),crypto=require('node:crypto');
const storage=require('../electron/storage'),sqlite=require('../electron/sqlite-storage.cjs');
const kernel=require('../assets/core/platform-kernel.js'),commands=require('../assets/core/platform-commands.js'),contracts=require('../assets/core/platform-contracts.js'),schema=require('../assets/core/platform-schema.js');
const {createCommandOutbox}=require('../electron/command-outbox.cjs'),{createOperationRecovery}=require('../electron/operation-recovery.cjs');
const copy=value=>JSON.parse(JSON.stringify(value)),turn=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function fixture(t,format='json'){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-semantic-review-')),dir=path.join(directory,'db');
  t.after(()=>{const target=path.resolve(directory);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith('tvs-semantic-review-'));fs.rmSync(target,{recursive:true,force:true});});
  const database={...Object.fromEntries(schema.sections.map(name=>[name,[]])),vehicles:[{id:7,plate:'Synthetic review',fuelGrade:'ДТ',fuel:'diesel',fuelBalance:923.537}],
    tanks:[{id:5,name:'Synthetic review tank',fuel:'diesel',balanceInit:923.537}],drivers:[{id:3,name:'Synthetic driver',personnelRoles:['driver']}],
    shiftReports:[{id:'shift',title:'Synthetic sent shift',date:'2026-10-21',assetRef:'v:7',driverId:3,status:'sent',hours:4}]};
  if(format==='sqlite')sqlite.create(dir,{data:database});else storage.writeAll(dir,database);
  const snapshot=storage.readSnapshot(dir),scope='c'.repeat(64),principal={id:'review-user',name:'Synthetic review account',role:'admin'},config={rootDir:path.join(directory,'outbox')};
  const box=createCommandOutbox(config),context={scope,databaseToken:snapshot.databaseToken,supportsOperations:true,supportsCommands:true};
  const calls=[];let sendHook=null,readHook=null,service;
  function freshService(outbox=box){return createOperationRecovery({outbox,send:async(ctx,json)=>{calls.push(json);if(sendHook)return sendHook(ctx,json);return storage.executeCommand(dir,JSON.parse(json),{principal,now:'2026-10-22T12:00:00.000Z'});},lookup:async(ctx,id,digest)=>storage.readOperation(dir,{id,digest},principal)});}
  service=freshService();
  const sandbox={console,PlatformKernel:kernel,PlatformCommands:commands,PlatformContracts:contracts,PlatformSchema:schema,
    data:copy(snapshot.data),_lastPersisted:JSON.stringify(snapshot.data),_pendingSaveOperations:new Set(),
    crypto:{randomUUID:()=>crypto.randomUUID()},structuredClone,setTimeout,clearTimeout,setInterval,clearInterval,
    document:{querySelector:()=>null,activeElement:null},showToast:()=>{},rebuildIndex:()=>{},dispatcherInvalidate:()=>{},
    __identity:'synthetic-review-A',__backups:[],dispatcherLocalDate:()=> '2026-10-22',
    scheduleLocalBackup:json=>sandbox.__backups.push(json),
    window:{electronAPI:{executeCommand:json=>service.execute(context,JSON.parse(json)),readSnapshot:async()=>readHook?readHook():JSON.stringify(storage.readSnapshot(dir))}},
  };
  sandbox.dispatcherContext=()=>({identity:sandbox.__identity,readable:schema.sections.slice()});
  const realm=vm.createContext(sandbox);
  vm.runInContext('let _loadWriteBlocked=false;\n'+fs.readFileSync(path.join(__dirname,'../assets/js/25f-sync.js'),'utf8')+'\n'+fs.readFileSync(path.join(__dirname,'../assets/js/51-platform-bridge.js'),'utf8')+
    '\nglobalThis.state=_sync;globalThis.entries=_platformCommandIntents;globalThis.runCommand=platformExecuteCommand;globalThis.getBaseline=()=>JSON.parse(_lastPersisted);'+
    'globalThis.replaceData=(database,baseline)=>{data=database;_lastPersisted=JSON.stringify(baseline);};',realm);
  const state=realm.state;state.enabled=true;state.databaseToken=snapshot.databaseToken;state.platform={...snapshot.platform};state.revs={...snapshot.revisions};
  state.synced=Object.fromEntries(schema.sections.map(name=>[name,JSON.stringify(snapshot.data[name]||[])]));
  return {dir,box,realm,state,context,calls,config,principal,command:{type:'IssueFuel',version:1,input:{tankId:5,target:{section:'vehicles',id:7},date:'2026-10-22',qty:100,reason:'Synthetic independent review'}},
    setSend:hook=>{sendHook=hook;},setRead:hook=>{readHook=hook;},restart:()=>{service=freshService(createCommandOutbox(config));},
    send:json=>storage.executeCommand(dir,JSON.parse(json),{principal,now:'2026-10-22T12:00:00.000Z'}),
    reconcile:id=>service.reconcile(context,id),retry:id=>service.retry(context,id),disk:()=>storage.readSnapshot(dir)};
}

for(const format of ['json','sqlite']){
  test(format+' actual bridge applies acknowledged command while keeping unrelated dirty editors out of the persisted baseline',async t=>{
    const f=fixture(t,format),before=copy(f.realm.getBaseline());f.realm.data.parts.push({id:'unsaved-part',name:'Unrelated local editor'});
    const result=await f.realm.runCommand(f.command,{operationId:'review-known'});assert.equal(result.ok,true,JSON.stringify(result));
    assert.equal(f.realm.data.records.length,1);assert.equal(f.realm.data.fuelMovements.length,1);assert.equal(f.realm.data.parts.length,1);
    assert.deepEqual(copy(f.realm.getBaseline().parts),before.parts);assert.deepEqual(f.disk().data.parts,before.parts);
    assert.equal(f.realm.getBaseline().records.length,1);assert.equal(f.realm.__backups.length,1);assert.deepEqual(JSON.parse(f.realm.__backups[0]).parts,before.parts);
    assert.equal(f.box.list(f.context.scope)[0].status,'committed');
  });
  test(format+' a dirty read dependency prevents command transport and never overwrites its editor',async t=>{
    const f=fixture(t,format);f.realm.data.tanks[0].name='Unsaved edited tank';
    const result=await f.realm.runCommand(f.command,{operationId:'review-dirty'});assert.equal(result.ok,false);assert.equal(result.code,'UNSAVED_COMMAND_SOURCE');assert.equal(f.calls.length,0);
    assert.equal(f.realm.data.tanks[0].name,'Unsaved edited tank');assert.equal(f.disk().data.fuelMovements.length,0);assert.deepEqual(f.box.list(f.context.scope),[]);
  });
  test(format+' related local edits during a committed ACK wait remain intact and retry replays the same ID after reload',async t=>{
    const f=fixture(t,format),gate=deferred();f.setSend(async(ctx,json)=>{const result=f.send(json);await gate.promise;return result;});
    const promise=f.realm.runCommand(f.command,{operationId:'review-edited-in-flight'});await turn();assert.equal(f.disk().data.fuelMovements.length,1);
    f.realm.data.records.push({id:'unsaved-journal',vehicleId:7,date:'2026-10-22',km:1});gate.resolve();const result=await promise;
    assert.equal(result.ok,false);assert.equal(result.committed,true);assert.equal(result.needsReload,true);assert.equal(f.realm.data.records[0].id,'unsaved-journal');assert.equal(f.realm.getBaseline().records.length,0);
    const snap=f.disk();f.realm.replaceData(copy(snap.data),copy(snap.data));f.state.revs={...snap.revisions};f.state.synced=Object.fromEntries(schema.sections.map(name=>[name,JSON.stringify(snap.data[name])]));f.setSend(null);
    const replay=await f.realm.runCommand(f.command,{operationId:'review-edited-in-flight'});assert.equal(replay.ok,true);assert.equal(replay.operationReceipt.status,'replayed');assert.equal(f.disk().data.fuelMovements.length,1);
  });
  test(format+' lost ACK after COMMIT keeps UI unchanged and reconciles after coordinator restart exactly once',async t=>{
    const f=fixture(t,format);f.setSend(async(ctx,json)=>{f.send(json);throw Object.assign(Error('Synthetic lost ACK'),{code:'ETIMEDOUT'});});
    const result=await f.realm.runCommand(f.command,{operationId:'review-lost-commit'});assert.equal(result.ok,false);assert.equal(result.unknown,true);assert.equal(f.realm.data.fuelMovements.length,0);assert.equal(f.disk().data.fuelMovements.length,1);
    f.restart();f.setSend(null);assert.equal((await f.reconcile('review-lost-commit')).committed,true);assert.equal((await f.retry('review-lost-commit')).committed,true);assert.equal(f.calls.length,1);assert.equal(f.disk().data.fuelMovements.length,1);
  });
  test(format+' a timeout before commit retries the exact staged JSON and one ID despite request object aliases being changed',async t=>{
    const f=fixture(t,format);f.setSend(async()=>{throw Object.assign(Error('Synthetic pre-commit timeout'),{code:'ETIMEDOUT'});});
    const result=await f.realm.runCommand(f.command,{operationId:'review-precommit'});assert.equal(result.unknown,true);const exact=f.calls[0];f.command.input.qty=1;f.restart();f.setSend(null);
    const retried=await f.retry('review-precommit');assert.equal(retried.ok,true);assert.deepEqual(f.calls,[exact,exact]);assert.equal(f.disk().data.fuelMovements.length,1);assert.equal(f.disk().data.fuelMovements[0].qty,100);
  });
  test(format+' a late command ACK cannot apply rows, versions or backups to a newly selected session',async t=>{
    const f=fixture(t,format),gate=deferred();f.setSend(async(ctx,json)=>{const result=f.send(json);await gate.promise;return result;});
    const promise=f.realm.runCommand(f.command,{operationId:'review-session-switch'});await turn();f.realm.__identity='synthetic-review-B';const target=copy(f.realm.data);target.vehicles[0].plate='Different selected session';f.realm.replaceData(target,target);const before=JSON.stringify(f.realm.data),versions={...f.state.revs};
    gate.resolve();const result=await promise;assert.equal(result.ok,false);assert.equal(result.unknown,true);assert.equal(JSON.stringify(f.realm.data),before);assert.deepEqual(f.state.revs,versions);assert.equal(f.realm.__backups.length,0);assert.equal(f.disk().data.fuelMovements.length,1);
  });
}

test('a mismatched committed receipt cannot apply canonical rows or turn the durable unknown entry into success',async t=>{
  const f=fixture(t);f.setSend(async(ctx,json)=>({...f.send(json),operationReceipt:{id:'wrong-ID',digest:'sha256:'+'0'.repeat(64),status:'committed'}}));
  const result=await f.realm.runCommand(f.command,{operationId:'review-wrong-receipt'});assert.equal(result.ok,false);assert.equal(result.unknown,true);assert.equal(f.realm.data.records.length,0);assert.equal(f.realm.__backups.length,0);assert.equal(f.box.list(f.context.scope)[0].status,'unknown');
  assert.equal((await f.reconcile('review-wrong-receipt')).committed,true);assert.equal(f.disk().data.fuelMovements.length,1);
});
test('a malformed canonical payload after a valid commit receipt reports needsReload and never partially applies its sections',async t=>{
  const f=fixture(t),before=JSON.stringify(f.realm.data);f.setSend(async(ctx,json)=>{const result=f.send(json);return{...result,canonicalSections:{...result.canonicalSections,unknown:[]}};});
  const result=await f.realm.runCommand(f.command,{operationId:'review-bad-canonical'});assert.equal(result.ok,false);assert.equal(result.committed,true);assert.equal(result.needsReload,true);assert.equal(JSON.stringify(f.realm.data),before);assert.equal(f.realm.__backups.length,0);assert.equal(f.box.list(f.context.scope)[0].status,'committed');
});
test('a missing canonical ACK triggers readSnapshot and rechecks local dependencies after that second await',async t=>{
  const f=fixture(t),gate=deferred();let reading=false;f.setSend(async(ctx,json)=>{const result=f.send(json);delete result.canonicalSections;return result;});
  f.setRead(async()=>{reading=true;await gate.promise;return JSON.stringify(f.disk());});const promise=f.realm.runCommand(f.command,{operationId:'review-snapshot-wait'});await turn();assert.equal(reading,true);
  f.realm.data.tanks[0].name='Local edit during canonical reload';gate.resolve();const result=await promise;assert.equal(result.ok,false);assert.equal(result.committed,true);assert.equal(f.realm.data.records.length,0);assert.equal(f.realm.data.tanks[0].name,'Local edit during canonical reload');assert.equal(f.realm.__backups.length,0);
});
test('two identical renderer calls share one pending request and a changed body never reuses its operation ID',async t=>{
  const f=fixture(t),gate=deferred();f.setSend(async(ctx,json)=>{await gate.promise;return f.send(json);});
  const first=f.realm.runCommand(f.command,{operationId:'review-join'}),second=f.realm.runCommand(copy(f.command),{operationId:'review-join'});assert.equal(first,second);await turn();
  const changed=copy(f.command);changed.input.qty=1;const rejected=await f.realm.runCommand(changed,{operationId:'review-join'});assert.equal(rejected.code,'COMMAND_ID_REUSED');gate.resolve();assert.equal((await first).ok,true);assert.equal(f.calls.length,1);assert.equal(f.disk().data.fuelMovements.length,1);
});
test('completed renderer command history retains only a compact proof and an exact small intent, while an already-applied repeat performs no I/O',async t=>{
  const f=fixture(t),result=await f.realm.runCommand(f.command,{operationId:'review-compact'});assert.equal(result.ok,true,JSON.stringify(result));assert.ok(result.canonicalSections.records.length);
  const entry=f.realm.entries.get('review-compact');assert.equal(entry.pending,null);
  for(const name of ['canonicalSections','revisions','changed','issues','sections'])assert.equal(Object.hasOwn(entry.result,name),false);
  assert.ok(JSON.stringify(entry.result).length<2048);assert.deepEqual(copy(entry.envelope.command),f.command);assert.equal(entry.envelope.operation.digest,result.operationReceipt.digest);
  const replay=await f.realm.runCommand(f.command,{operationId:'review-compact'});assert.equal(replay.ok,true);assert.equal(replay.alreadyApplied,true);assert.equal(f.calls.length,1);assert.equal(replay.canonicalSections,undefined);
});
