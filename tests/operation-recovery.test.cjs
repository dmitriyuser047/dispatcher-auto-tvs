'use strict';
const {writerHeaders}=require('./helpers/http-writer.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),http=require('node:http');
const {spawnSync}=require('node:child_process');
const storage=require('../electron/storage');
const sqlite=require('../electron/sqlite-storage.cjs');
const server=require('../electron/server');
const access=require('../electron/access-control');
const {createCommandOutbox}=require('../electron/command-outbox.cjs');
const {createOperationRecovery}=require('../electron/operation-recovery.cjs');
const admin={id:'recovery-admin',name:'Synthetic recovery administrator',role:'admin'};
const privateText='PRIVATE-SYNTHETIC-RECOVERY-FINANCE';
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
function temp(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-operation-recovery-'));
  t.after(()=>{const target=path.resolve(root);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith('tvs-operation-recovery-'));fs.rmSync(target,{recursive:true,force:true});});return root;
}
function fixture(t,format='json',prepare=()=>{}){
  const root=temp(t),dir=path.join(root,'database'),rootDir=path.join(root,'local-client','outbox');
  const data={...Object.fromEntries(storage.SECTIONS.map(name=>[name,[]])),
    vehicles:[{id:7,plate:'SYNTHETIC NUMBER',fuel:'diesel',fuelGrade:'ДТ',fuelBalance:923.537,norm:10},{id:'7',plate:'SYNTHETIC STRING',fuelBalance:0,norm:10}],
    records:[{id:'recovery-record',vehicleId:7,date:'2026-09-01',km:10,fuelActual:1,note:'Before'}],
    payments:[{id:'recovery-payment',date:'2026-09-01',sum:12.5,description:privateText}]};
  require('./helpers/literal-history25-seed.cjs').seedWithLiteralHistory(dir,format,{data,revisions:Object.fromEntries(storage.SECTIONS.map(name=>[name,10])),prepare});
  const databaseToken=storage.databaseToken(dir),ctx={scope:sha(JSON.stringify([databaseToken,admin.id,admin.role,'access-v1'])),databaseToken,supportsOperations:true};
  const config={rootDir},box=createCommandOutbox(config);
  const send=async(context,json)=>storage.writeSections(dir,JSON.parse(json),{principal:admin});
  const lookup=async(context,id,digest)=>storage.readOperation(dir,{id,digest},admin);
  function payload(id='recovery-operation',note='Reviewed synthetic change'){
    const snapshot=storage.readSnapshot(dir);
    return {databaseToken:snapshot.databaseToken,base:snapshot.revisions,sections:{records:snapshot.data.records.map(row=>({...row,note}))},operation:{id}};
  }
  return {root,dir,rootDir,config,box,ctx,send,lookup,payload};
}
function timeout(){return Object.assign(Error('Synthetic transport timeout'),{code:'ETIMEDOUT'});}
function transactions(dir,id){return storage.readAll(dir).auditLog.filter(row=>row.source==='platform'&&row.type==='transaction'&&row.operationId===id);}
function receipt(box,ctx,id,patch={}){return {id,status:'committed',digest:box.getForRetry(ctx.scope,id).requestDigest,...patch};}
function failingOutcome(box){return {...box,updateOutcome(){throw Object.assign(Error('Synthetic durable outcome failure'),{code:'ENOSPC'});}};}
for(const uncertainty of [{unknown:true},{definitive:false}])test('explicit uncertainty overrides a retained 400 status and validation-shaped details '+Object.keys(uncertainty)[0],async t=>{
 const f=fixture(t),body=f.payload('explicit-uncertain-'+Object.keys(uncertainty)[0]);let sends=0;
 const recovery=createOperationRecovery({outbox:f.box,lookup:f.lookup,send:async(ctx,json)=>{sends++;await f.send(ctx,json);throw Object.assign(Error('Synthetic error after commit'),{code:'EIO',status:400,issues:[],details:{issues:[]},...uncertainty});}});
 const result=await recovery.execute(f.ctx,body);assert.equal(result.queued,true);assert.equal(recovery.list(f.ctx)[0].status,'unknown');
 const before=storage.readSnapshot(f.dir),blocked=await recovery.execute(f.ctx,f.payload('do-not-duplicate-uncertain'));assert.equal(blocked.code,'PENDING_OPERATION');assert.equal(sends,1);
 assert.equal((await recovery.reconcile(f.ctx,body.operation.id)).committed,true);assert.deepEqual(storage.readSnapshot(f.dir),before);assert.equal(transactions(f.dir,body.operation.id).length,1);
});
async function request(port,route,token,body){
 const currentBody=JSON.stringify(body);
 const proofHeaders=await writerHeaders({host:'127.0.0.1',port:port,headers:{Authorization:'Bearer '+token},method:body===undefined?'GET':'POST'});

  return new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port,path:route,method:body===undefined?'GET':'POST',agent:false,headers:{...proofHeaders,Authorization:'Bearer '+token}},res=>{
    let text='';res.setEncoding('utf8');res.on('data',part=>{text+=part;});res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(text)});}catch(error){reject(error);}});
  });req.setTimeout(5000,()=>req.destroy(timeout()));req.on('error',reject);req.end(body===undefined?undefined:currentBody);});
}

for(const format of ['json','sqlite']){
  test(format+': a lost committed ACK blocks a new document ID in the same section until reconcile and reload',async t=>{
    const f=fixture(t,format),body=f.payload('uncertain-new-document');body.sections.records.push({...body.sections.records[0],id:'first-new-document'});
    let sends=0,lose=true;const recovery=createOperationRecovery({outbox:f.box,lookup:f.lookup,send:async(ctx,json)=>{sends++;const result=await f.send(ctx,json);if(lose){lose=false;throw timeout();}return result;}});
    assert.equal((await recovery.execute(f.ctx,body)).queued,true);const saved=f.box.getForRetry(f.ctx.scope,body.operation.id),before=storage.readSnapshot(f.dir);
    const duplicate=f.payload('new-id-from-repeated-form');duplicate.sections.records.push({...duplicate.sections.records[0],id:'accidental-second-document'});
    const blocked=await recovery.execute(f.ctx,duplicate);assert.equal(blocked.ok,false);assert.equal(blocked.code,'PENDING_OPERATION');assert.equal(blocked.needsReload,true);assert.equal(sends,1);
    assert.equal(f.box.getForRetry(f.ctx.scope,duplicate.operation.id),null);assert.deepEqual(f.box.getForRetry(f.ctx.scope,body.operation.id),saved);assert.deepEqual(storage.readSnapshot(f.dir),before);
    assert.equal((await recovery.reconcile(f.ctx,body.operation.id)).committed,true);assert.equal(sends,1);
    const reviewedAfterReload=f.payload('explicit-new-action-after-reload');reviewedAfterReload.sections.records.push({...reviewedAfterReload.sections.records[0],id:'intentional-second-document'});
    assert.equal((await recovery.execute(f.ctx,reviewedAfterReload)).ok,true);assert.equal(sends,2);const rows=storage.readAll(f.dir).records;
    assert.equal(rows.length,3);assert.equal(rows.some(row=>row.id==='accidental-second-document'),false);assert.equal(rows.some(row=>row.id==='intentional-second-document'),true);assert.equal(transactions(f.dir,body.operation.id).length,1);
  });

  test(format+': an unresolved section allows unrelated work despite shared auditLog and permits the identical operation ID retry',async t=>{
    const f=fixture(t,format),body=f.payload('uncertain-records');body.sections.auditLog=storage.readAll(f.dir).auditLog;
    let sends=0,lose=true;const recovery=createOperationRecovery({outbox:f.box,lookup:f.lookup,send:async(ctx,json)=>{sends++;const result=await f.send(ctx,json);if(lose){lose=false;throw timeout();}return result;}});
    assert.equal((await recovery.execute(f.ctx,body)).queued,true);const original=f.box.getForRetry(f.ctx.scope,body.operation.id),before=storage.readSnapshot(f.dir);
    const independent={databaseToken:before.databaseToken,base:before.revisions,sections:{vehicles:before.data.vehicles.map(row=>({...row,note:'Independent reviewed vehicle note'})),auditLog:before.data.auditLog},operation:{id:'independent-vehicle-action'}};
    assert.equal((await recovery.execute(f.ctx,independent)).ok,true);assert.equal(sends,2);assert.equal(f.box.getForRetry(f.ctx.scope,body.operation.id).metadata.status,'unknown');
    const afterIndependent=storage.readSnapshot(f.dir),replay=await recovery.execute(f.ctx,body);assert.equal(replay.ok,true);assert.equal(replay.operationReceipt.status,'replayed');assert.equal(sends,3);
    assert.equal(f.box.getForRetry(f.ctx.scope,body.operation.id).bodyHash,original.bodyHash);assert.deepEqual(storage.readSnapshot(f.dir),afterIndependent);assert.equal(transactions(f.dir,body.operation.id).length,1);
  });

  test(format+': a real full-snapshot save through the outbox preserves historical audit property order',async t=>{
    const f=fixture(t,format);await f.send(f.ctx,JSON.stringify(f.payload('seed-audit','First review')));
    const before=storage.readSnapshot(f.dir),body={databaseToken:before.databaseToken,base:before.revisions,
      sections:{...before.data,records:before.data.records.map(row=>({...row,note:'Second review'}))},operation:{id:'full-snapshot-audit'}};
    assert.ok(before.data.auditLog.length>0);let actual;
    const recovery=createOperationRecovery({outbox:f.box,lookup:f.lookup,send:async(ctx,json)=>{actual=json;return f.send(ctx,json);}});
    const result=await recovery.execute(f.ctx,body);assert.equal(result.ok,true,result.error);assert.equal(actual,JSON.stringify(body));
    const after=storage.readSnapshot(f.dir);assert.equal(after.data.records[0].note,'Second review');
    assert.equal(JSON.stringify(after.data.auditLog.slice(0,before.data.auditLog.length)),JSON.stringify(before.data.auditLog));assert.equal(transactions(f.dir,'full-snapshot-audit').length,1);
  });

  test(format+': a lost ACK after COMMIT is reconciled after a separate-process restart without another write',async t=>{
    const f=fixture(t,format),body=f.payload('lost-ack'),sent=[];
    const recovery=createOperationRecovery({outbox:f.box,send:async(ctx,json)=>{sent.push(json);await f.send(ctx,json);throw timeout();},lookup:f.lookup});
    const result=await recovery.execute(f.ctx,body);assert.equal(result.ok,false);assert.equal(result.queued,true);
    assert.equal(f.box.list(f.ctx.scope)[0].status,'unknown');assert.equal(transactions(f.dir,'lost-ack').length,1);
    const before=storage.readSnapshot(f.dir),saved=f.box.getForRetry(f.ctx.scope,'lost-ack');assert.equal(sent[0],saved.json);
    const code="const {createCommandOutbox}=require(process.argv[1]);const {createOperationRecovery}=require(process.argv[2]);const s=require(process.argv[3]);const box=createCommandOutbox({rootDir:process.argv[4]});const ctx=JSON.parse(process.argv[5]);const principal=JSON.parse(process.argv[6]);createOperationRecovery({outbox:box,send(){throw Error('Reconcile must be read-only');},lookup:async(c,id,digest)=>s.readOperation(process.argv[7],{id,digest},principal)}).reconcile(ctx,'lost-ack').then(r=>process.stdout.write(JSON.stringify(r))).catch(e=>{console.error(e);process.exitCode=1;});";
    const child=spawnSync(process.execPath,['-e',code,require.resolve('../electron/command-outbox.cjs'),require.resolve('../electron/operation-recovery.cjs'),require.resolve('../electron/storage'),f.rootDir,JSON.stringify(f.ctx),JSON.stringify(admin),f.dir],{encoding:'utf8',windowsHide:true,timeout:15000});
    assert.equal(child.status,0,child.stderr);assert.equal(JSON.parse(child.stdout).committed,true);
    assert.deepEqual(storage.readSnapshot(f.dir),before);assert.equal(transactions(f.dir,'lost-ack').length,1);
    const restarted=createCommandOutbox(f.config);assert.equal(restarted.list(f.ctx.scope)[0].status,'committed');assert.equal(restarted.getForRetry(f.ctx.scope,'lost-ack').json,null);
    assert.equal(before.data.vehicles[0].fuelBalance,923.537);assert.equal(typeof before.data.vehicles[0].id,'number');assert.equal(typeof before.data.vehicles[1].id,'string');
  });

  test(format+': timeout before COMMIT retains exact body and stale caller edits cannot alter the retry',async t=>{
    const f=fixture(t,format),body=f.payload('before-commit'),before=storage.readSnapshot(f.dir),sent=[];let lose=true;
    const recovery=createOperationRecovery({outbox:f.box,send:async(ctx,json)=>{sent.push(json);if(lose){lose=false;throw timeout();}return f.send(ctx,json);},lookup:f.lookup});
    assert.equal((await recovery.execute(f.ctx,body)).queued,true);const original=f.box.getForRetry(f.ctx.scope,body.operation.id);
    assert.deepEqual(storage.readSnapshot(f.dir),before);body.sections.records[0].note='Unreviewed later caller mutation';body.base.records=999;
    const changed=await recovery.execute(f.ctx,body);assert.equal(changed.ok,false);assert.equal(changed.code,'OUTBOX_OPERATION_REUSED');assert.equal(sent.length,1);
    const restarted=createOperationRecovery({outbox:createCommandOutbox(f.config),send:async(ctx,json)=>{sent.push(json);return f.send(ctx,json);},lookup:f.lookup});
    const retried=await restarted.retry(f.ctx,'before-commit');assert.equal(retried.ok,true);assert.deepEqual(sent,[original.json,original.json]);
    assert.equal(storage.readAll(f.dir).records[0].note,'Reviewed synthetic change');assert.equal(transactions(f.dir,'before-commit').length,1);
    const after=storage.readSnapshot(f.dir);assert.equal((await restarted.retry(f.ctx,'before-commit')).committed,true);assert.deepEqual(storage.readSnapshot(f.dir),after);assert.equal(sent.length,2);
  });

  test(format+': a definite CAS conflict permits only a reviewed rebase and records the prior request hash',async t=>{
    const f=fixture(t,format),stale=f.payload('reviewed-rebase','Own edit'),colleague=f.payload('colleague','Colleague edit');
    await f.send(f.ctx,JSON.stringify(colleague));const before=storage.readSnapshot(f.dir);
    const recovery=createOperationRecovery({outbox:f.box,send:f.send,lookup:f.lookup});const result=await recovery.execute(f.ctx,stale);
    assert.equal(result.ok,false);assert.deepEqual(result.conflicts,['records']);assert.deepEqual(storage.readSnapshot(f.dir),before);
    const failed=f.box.getForRetry(f.ctx.scope,'reviewed-rebase');assert.equal(failed.metadata.status,'conflict');
    const reviewed=f.payload('reviewed-rebase','Explicit reviewed merged edit');let staged;
    const second=createOperationRecovery({outbox:f.box,lookup:f.lookup,send:async(ctx,json)=>{staged=f.box.getForRetry(ctx.scope,'reviewed-rebase');return f.send(ctx,json);}});
    assert.equal((await second.execute(f.ctx,reviewed)).ok,true);assert.equal(staged.priorBodyHash,failed.bodyHash);assert.equal(staged.metadata.attempts,2);assert.notEqual(staged.bodyHash,failed.bodyHash);
    assert.equal(transactions(f.dir,'reviewed-rebase').length,1);assert.equal(storage.readAll(f.dir).records[0].note,'Explicit reviewed merged edit');
  });

  test(format+': definite backend policy rejection is rejected, remains visible, and changes no accounting data',async t=>{
    const f=fixture(t,format),before=storage.readSnapshot(f.dir),viewer={...admin,role:'viewer'};
    const recovery=createOperationRecovery({outbox:f.box,send:async(ctx,json)=>storage.writeSections(f.dir,JSON.parse(json),{principal:viewer}),lookup:f.lookup});
    const result=await recovery.execute(f.ctx,f.payload('policy-rejection'));assert.equal(result.ok,false);assert.equal(result.queued,false);assert.equal(result.code,'ACCESS_DENIED');
    assert.equal(recovery.list(f.ctx)[0].status,'rejected');assert.deepEqual(storage.readSnapshot(f.dir),before);assert.ok(!JSON.stringify(recovery.list(f.ctx)).includes(privateText));
  });

  test(format+': a native domain validation failure with details.issues is a definite rejection',async t=>{
    const f=fixture(t,format),body=f.payload('domain-rejection'),before=storage.readSnapshot(f.dir);body.sections.records[0].vehicleId='missing-synthetic-vehicle';
    const recovery=createOperationRecovery({outbox:f.box,send:f.send,lookup:f.lookup}),result=await recovery.execute(f.ctx,body);
    assert.equal(result.ok,false);assert.equal(result.code,'INTEGRITY_VIOLATION');assert.equal(result.queued,false);assert.equal(recovery.list(f.ctx)[0].status,'rejected');assert.deepEqual(storage.readSnapshot(f.dir),before);
  });

  test(format+': a changed role cannot adopt an old command or receive its receipt under a stale client binding',async t=>{
    const f=fixture(t,format),body=f.payload('role-changed'),actor={...admin,role:'dispatcher'};
    const first=createOperationRecovery({outbox:f.box,send:async(ctx,json)=>{await f.send(ctx,json);throw timeout();},lookup:f.lookup});
    await first.execute(f.ctx,body);const before=storage.readSnapshot(f.dir),saved=f.box.getForRetry(f.ctx.scope,body.operation.id);
    assert.equal(storage.readOperation(f.dir,{id:body.operation.id,digest:saved.requestDigest},actor).operationReceipt,null);
    // Main normally switches to a different verified scope first. Even an old
    // binding cannot bypass the backend's independent actor-and-role check.
    const recovery=createOperationRecovery({outbox:f.box,send:async(ctx,json)=>storage.writeSections(f.dir,JSON.parse(json),{principal:actor}),lookup:async(ctx,id,digest)=>storage.readOperation(f.dir,{id,digest},actor)});
    const result=await recovery.retry(f.ctx,body.operation.id);assert.equal(result.ok,false);assert.equal(result.code,'OPERATION_REUSED');assert.equal(result.queued,false);
    assert.equal(recovery.list(f.ctx)[0].status,'rejected');assert.ok(!JSON.stringify(recovery.list(f.ctx)).includes(privateText));assert.deepEqual(storage.readSnapshot(f.dir),before);assert.equal(transactions(f.dir,body.operation.id).length,1);
  });

  test(format+': known valid COMMIT remains successful when persisting the local outcome fails',async t=>{
    const f=fixture(t,format),warnings=[],recovery=createOperationRecovery({outbox:failingOutcome(f.box),send:f.send,lookup:f.lookup,onWarning:code=>warnings.push(code)});
    const result=await recovery.execute(f.ctx,f.payload('outcome-disk-full'));assert.equal(result.ok,true);assert.deepEqual(warnings,['ENOSPC']);assert.equal(transactions(f.dir,'outcome-disk-full').length,1);
    assert.equal(f.box.list(f.ctx.scope)[0].status,'pending');const before=storage.readSnapshot(f.dir);
    const fresh=createOperationRecovery({outbox:createCommandOutbox(f.config),send(){throw Error('Must not resend a committed operation');},lookup:f.lookup});
    assert.equal((await fresh.reconcile(f.ctx,'outcome-disk-full')).committed,true);assert.deepEqual(storage.readSnapshot(f.dir),before);
  });

  test(format+': database replacement is rejected before any queued operation can reach the new database',async t=>{
    const f=fixture(t,format),body=f.payload('database-changed'),before=storage.readSnapshot(f.dir);
    const recovery=createOperationRecovery({outbox:f.box,send:async()=>({ok:false,databaseChanged:true,databaseToken:'replacement-token'}),lookup:f.lookup});
    const result=await recovery.execute(f.ctx,body);assert.equal(result.ok,false);assert.equal(result.databaseChanged,true);assert.equal(f.box.list(f.ctx.scope)[0].status,'rejected');assert.deepEqual(storage.readSnapshot(f.dir),before);
    const foreign={...f.ctx,scope:sha('different database/account/access binding')};assert.deepEqual(recovery.list(foreign),[]);assert.equal(recovery.discard(foreign,body.operation.id),false);
    await assert.rejects(recovery.retry(foreign,body.operation.id),/Операция не найдена/);assert.equal(recovery.list(f.ctx).length,1);
  });
}

for(const bad of ['missing','wrong-id','wrong-digest','wrong-status']){
  for(const failing of [false,true])test('malformed '+bad+' ACK remains unconfirmed'+(failing?' even if writing its outcome fails':''),async t=>{
    const f=fixture(t),id='malformed-ack',before=storage.readSnapshot(f.dir),warnings=[];
    const recovery=createOperationRecovery({outbox:failing?failingOutcome(f.box):f.box,lookup:f.lookup,onWarning:code=>warnings.push(code),send:async()=>{
      const proof=receipt(f.box,f.ctx,id,bad==='wrong-id'?{id:'another-operation'}:bad==='wrong-digest'?{digest:'sha256:'+'0'.repeat(64)}:bad==='wrong-status'?{status:'accepted'}:{});
      return {ok:true,databaseToken:f.ctx.databaseToken,...(bad==='missing'?{}:{operationReceipt:proof})};
    }});
    const result=await recovery.execute(f.ctx,f.payload(id));assert.equal(result.ok,false);assert.equal(result.queued,true);assert.notEqual(f.box.list(f.ctx.scope)[0].status,'committed');assert.deepEqual(storage.readSnapshot(f.dir),before);
    if(failing)assert.deepEqual(warnings,['ENOSPC']);else assert.equal(f.box.list(f.ctx.scope)[0].status,'unknown');
  });
}

test('a negative or malformed receipt lookup cannot mark a request committed or trigger a retry',async t=>{
  const f=fixture(t),id='bad-lookup';f.box.stage(f.ctx.scope,f.payload(id),{supportsOperations:true});let sends=0;
  for(const bad of ['negative','wrong-id','wrong-digest','wrong-status','database']){
    const recovery=createOperationRecovery({outbox:failingOutcome(f.box),send(){sends++;throw Error('Must not send after an invalid lookup');},lookup:async()=>({ok:bad!=='negative',databaseToken:bad==='database'?'other-token':f.ctx.databaseToken,
      operationReceipt:receipt(f.box,f.ctx,id,bad==='wrong-id'?{id:'other'}:bad==='wrong-digest'?{digest:'sha256:'+'0'.repeat(64)}:bad==='wrong-status'?{status:'pending'}:{})})});
    await assert.rejects(recovery.retry(f.ctx,id),error=>['LOOKUP_UNCONFIRMED','ACK_MISMATCH','DATABASE_CHANGED'].includes(error.code));assert.equal(sends,0);assert.notEqual(f.box.list(f.ctx.scope)[0].status,'committed');
  }
});

test('valid receipt lookup remains committed when only local outcome durability fails',async t=>{
  const f=fixture(t),id='lookup-disk-full',body=f.payload(id);f.box.stage(f.ctx.scope,body,{supportsOperations:true});await f.send(f.ctx,f.box.getForRetry(f.ctx.scope,id).json);
  const before=storage.readSnapshot(f.dir),warnings=[],recovery=createOperationRecovery({outbox:failingOutcome(f.box),send(){throw Error('Must not send');},lookup:f.lookup,onWarning:code=>warnings.push(code)});
  const result=await recovery.reconcile(f.ctx,id);assert.equal(result.committed,true);assert.deepEqual(warnings,['ENOSPC']);assert.deepEqual(storage.readSnapshot(f.dir),before);
});

test('legacy transport without operation receipts bypasses the durable queue',async t=>{
  const f=fixture(t),body=f.payload('legacy'),sent=[],recovery=createOperationRecovery({outbox:f.box,lookup:f.lookup,send:async(ctx,json)=>{sent.push(json);return {ok:true,legacy:true};}});
  assert.equal((await recovery.execute({...f.ctx,supportsOperations:false},body)).ok,true);assert.deepEqual(f.box.list(f.ctx.scope),[]);assert.deepEqual(JSON.parse(sent[0]),body);
});

test('real HTTP receipt lookup is compact, read-only and bound to the current actor, role, digest and section visibility',async t=>{
  const f=fixture(t,'sqlite'),tokens={admin:'synthetic-recovery-admin-token-123456',other:'synthetic-recovery-other-token-123456'};
  let settings={serverAccessConfigured:true,serverUsers:access.normalizeServerUsers([
    {...admin,enabled:true,tokenHash:access.hashToken(tokens.admin)},
    {id:'recovery-other-admin',name:'Other synthetic administrator',role:'admin',enabled:true,tokenHash:access.hashToken(tokens.other)}])};
  const started=await server.start({port:0,dataDir:f.dir,settings:()=>settings,backupFn:()=>{}});assert.equal(started.ok,true);t.after(()=>server.stop());
  const id='http-receipt',body=f.payload(id),posted=await request(started.port,'/api/sections',tokens.admin,body);assert.equal(posted.status,200);assert.equal(posted.body.ok,true);
  const proof=posted.body.operationReceipt,route='/api/operation?id='+id+'&digest='+encodeURIComponent(proof.digest),before=storage.readSnapshot(f.dir),fileBefore=sha(fs.readFileSync(sqlite.filename(f.dir)));
  const good=await request(started.port,route,tokens.admin);assert.equal(good.status,200);assert.equal(good.body.operationReceipt.id,id);assert.deepEqual(Object.keys(good.body.operationReceipt).sort(),['id','digest','status','at'].sort());
  for(const [url,token]of [[route,tokens.other],['/api/operation?id='+id+'&digest='+encodeURIComponent('sha256:'+'0'.repeat(64)),tokens.admin]]){
    const result=await request(started.port,url,token);assert.equal(result.status,200);assert.equal(result.body.operationReceipt,null);assert.ok(!JSON.stringify(result).includes(privateText));assert.ok(!Object.hasOwn(result.body,'data'));
  }
  settings={...settings,serverUsers:access.normalizeServerUsers(settings.serverUsers.map(user=>user.id===admin.id?{...user,role:'dispatcher'}:user))};
  const roleChanged=await request(started.port,route,tokens.admin);assert.equal(roleChanged.status,200);assert.equal(roleChanged.body.operationReceipt,null);
  assert.deepEqual(storage.readSnapshot(f.dir),before);assert.equal(sha(fs.readFileSync(sqlite.filename(f.dir))),fileBefore);
  settings={...settings,serverUsers:access.normalizeServerUsers(settings.serverUsers.map(user=>user.id===admin.id?{...user,enabled:false}:user))};
  const revoked=await request(started.port,route,tokens.admin);assert.equal(revoked.status,401);assert.ok(!JSON.stringify(revoked).includes(privateText));
  assert.deepEqual(storage.readSnapshot(f.dir),before);assert.equal(transactions(f.dir,id).length,1);
  assert.equal((await request(started.port,route,'invalid-token')).status,401);
});

test('real HTTP imported literal legacy receipt remains unavailable to its current dispatcher even when actor and digest match',async t=>{
 const digest='sha256:'+'a'.repeat(64),id='hidden-financial-receipt',f=fixture(t,'sqlite',({data,revisions,databaseToken})=>{data.auditLog=[{id:'operation:'+id,source:'platform',type:'transaction',action:'transaction',section:'auditLog',operationId:id,recordId:id,actor:admin.name,actorId:admin.id,actorRole:'dispatcher',databaseToken,requestDigest:digest,at:'2026-09-01T00:00:00.000Z',changedSections:['payments'],revisions}];}),token='synthetic-legacy-dispatcher-123456789',settings={serverAccessConfigured:true,serverUsers:access.normalizeServerUsers([{...admin,role:'dispatcher',enabled:true,tokenHash:access.hashToken(token)},{id:'legacy-recovery-owner',name:'Synthetic active owner',role:'admin',enabled:true,tokenHash:access.hashToken('synthetic-legacy-owner-token-12345')}])},started=await server.start({port:0,dataDir:f.dir,settings,backupFn:()=>{}});assert.equal(started.ok,true);t.after(()=>server.stop());const before=storage.readSnapshot(f.dir),fileBefore=sha(fs.readFileSync(sqlite.filename(f.dir))),stored=require('../electron/operation-store.cjs'),entry=stored.engine(f.dir).inspectReceipt(stored.readState(f.dir).head,id);assert.equal(entry.proof.status,'legacy-unverified');assert.equal(entry.receipt.operation.actorRole,'dispatcher');const hidden=await request(started.port,'/api/operation?id='+id+'&digest='+encodeURIComponent(digest),token);assert.equal(hidden.status,200);assert.equal(hidden.body.operationReceipt,null);assert.ok(!JSON.stringify(hidden).includes(privateText));assert.deepEqual(storage.readSnapshot(f.dir),before);assert.equal(sha(fs.readFileSync(sqlite.filename(f.dir))),fileBefore);
});
