'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const storage=require('../electron/storage');
const server=require('../electron/server');
const access=require('../electron/access-control');
const adapter=()=>require('../electron/sqlite-storage.cjs');
const admin={id:'sqlite-admin',name:'Synthetic SQLite admin',role:'admin'};
const now='2026-10-21T12:00:00.000Z';
function temp(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-sqlite-platform-'));
  t.after(()=>{
    const resolved=path.resolve(dir);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('tvs-sqlite-platform-'));fs.rmSync(resolved,{recursive:true,force:true});
  });return dir;
}
function data(){
  return {...Object.fromEntries(storage.SECTIONS.map(section=>[section,[]])),
    vehicles:[{id:7,plate:'SYNTHETIC NUMBER',fuel:'diesel',fuelGrade:'ДТ',fuelBalance:923.537,norm:10,org:'Synthetic organization'},
      {id:'7',plate:'SYNTHETIC STRING',fuel:'diesel',fuelGrade:'ДТ',fuelBalance:0,norm:10,org:'Synthetic organization'}],
    records:[{id:1,vehicleId:7,date:'2026-08-31',km:100.125,fuelActual:1.001},
      {id:'1',vehicleId:'7',date:'2026-09-01',km:2.5,fuelActual:0}],
    payments:[{id:'payment',date:'2026-10-01',sum:1234.56,description:'Synthetic private finance'}]};
}
function fixture(t,change=()=>{}){
  const dir=temp(t),initial=data();change(initial);
  const revisions=Object.fromEntries(storage.SECTIONS.map((section,index)=>[section,index+10]));
  const report=adapter().create(dir,{data:initial,revisions});
  assert.equal(report.ok,true);return {dir,initial,revisions};
}
function payload(dir,sections,id){
  const snapshot=storage.readSnapshot(dir);
  return {databaseToken:snapshot.databaseToken,base:snapshot.revisions,sections,...(id?{operation:{id}}:{})};
}
const changedRecords=(dir,patch)=>storage.readAll(dir).records.map((row,index)=>index===0?{...row,...patch}:row);
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function assertGuardOnly(dir,expected){
  assert.deepEqual(fs.readdirSync(storage.sectionsDir(dir)),['revisions.json']);
  const raw=fs.readFileSync(storage.revisionsFile(dir));if(expected)assert.deepEqual(raw,expected);
  const marker=JSON.parse(raw.toString('utf8'));assert.equal(marker.format,'sqlite');assert.equal(marker.vehicles,null);assert.equal(marker.records,null);
  assert.equal(Number.isSafeInteger(marker.vehicles),false);assert.equal(Number.isSafeInteger(marker.records),false);
  assert.equal(fs.existsSync(path.join(dir,'data.json')),false);return raw;
}
function request(port,route,token,body){
  return new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port,path:route,method:body===undefined?'GET':'POST',agent:false,
      headers:{Authorization:'Bearer '+token}},res=>{
      let raw='';res.setEncoding('utf8');res.on('data',part=>{raw+=part;});
      res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(raw)});}catch(error){reject(error);}});
    });req.setTimeout(5000,()=>req.destroy(Error('Synthetic HTTP request timed out')));req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
  });
}
async function httpFixture(t){
  const result=fixture(t),tokens={admin:'sqlite-synthetic-admin-token-123456',other:'sqlite-synthetic-other-token-123456',dispatcher:'sqlite-synthetic-dispatcher-token-123456'};
  let settings={serverAccessConfigured:true,serverUsers:access.normalizeServerUsers([
    {...admin,enabled:true,tokenHash:access.hashToken(tokens.admin)},
    {id:'other',name:'Other synthetic admin',role:'admin',enabled:true,tokenHash:access.hashToken(tokens.other)},
    {id:'dispatcher',name:'Synthetic dispatcher',role:'dispatcher',enabled:true,tokenHash:access.hashToken(tokens.dispatcher)},
  ])};
  let onSettingsRead,backups=0;
  const started=await server.start({port:0,dataDir:result.dir,settings:()=>{
    const value=settings,notify=onSettingsRead;onSettingsRead=null;if(notify)notify();return value;
  },backupFn:()=>{backups++;}});
  assert.equal(started.ok,true);t.after(()=>server.stop());
  return {...result,tokens,port:started.port,get backups(){return backups;},
    changeUser(change){settings={...settings,serverUsers:access.normalizeServerUsers(settings.serverUsers.map(user=>user.id===admin.id?{...user,...change}:user))};},
    async uploadThenChange(route,body,change){
      const raw=JSON.stringify(body),authenticated=new Promise(resolve=>{onSettingsRead=resolve;});
      let finish;
      const response=new Promise((resolve,reject)=>{
        const req=http.request({host:'127.0.0.1',port:started.port,path:route,method:'POST',agent:false,
          headers:{Authorization:'Bearer '+tokens.admin,'Content-Length':Buffer.byteLength(raw)}},res=>{
          let text='';res.setEncoding('utf8');res.on('data',part=>{text+=part;});
          res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(text)});}catch(error){reject(error);}});
        });req.setTimeout(5000,()=>req.destroy(Error('Synthetic slow upload timed out')));req.on('error',reject);
        finish=()=>req.end(raw.slice(-1));req.write(raw.slice(0,-1));
      });
      await authenticated;this.changeUser(change);finish();return response;
    }};
}

test('SQLite remains opt-in and ordinary synthetic JSON directories are not converted',t=>{
  const dir=temp(t);storage.writeAll(dir,{vehicles:[{id:'legacy'}],records:[]});
  assert.equal(fs.existsSync(path.join(dir,'platform.sqlite')),false);
  assert.equal(storage.readAll(dir).vehicles[0].id,'legacy');assert.equal(adapter().exists(dir),false);
});

test('shared storage reads exact SQLite sections, revisions, typed IDs and 923.537 litre values without JSON shadows',t=>{
  const {dir,initial,revisions}=fixture(t),file=adapter().filename(dir),before=hash(file),guard=assertGuardOnly(dir),snapshot=storage.readSnapshot(dir);
  assert.deepEqual(snapshot.data,initial);assert.deepEqual(snapshot.revisions,revisions);assert.deepEqual(snapshot.platform,{apiVersion:1,operations:1});
  assert.equal(snapshot.data.vehicles[0].fuelBalance,923.537);assert.equal(typeof snapshot.data.vehicles[0].id,'number');assert.equal(typeof snapshot.data.vehicles[1].id,'string');
  assert.equal(storage.readSection(dir,'records').rows[0].vehicleId,7);assert.equal(storage.readSection(dir,'records').rows[1].vehicleId,'7');
  assert.equal(hash(file),before);assertGuardOnly(dir,guard);
  // Exercise the actual legacy JSON branch with only the synthetic marker:
  // an old client must reject it instead of creating empty business sections.
  const oldClient=temp(t);fs.mkdirSync(storage.sectionsDir(oldClient));fs.writeFileSync(storage.revisionsFile(oldClient),guard);
  assert.throws(()=>storage.readRevisions(oldClient),/Повреждены версии разделов/);
  assertGuardOnly(oldClient,guard);
});

test('SQLite section writes retain canonical audit and advance only changed section revisions',t=>{
  const {dir}=fixture(t),guard=assertGuardOnly(dir),before=storage.readSnapshot(dir),request=payload(dir,{records:changedRecords(dir,{note:'Synthetic reviewed note'})},'sqlite-section-commit');
  const result=storage.writeSections(dir,request,{principal:admin,now}),after=storage.readSnapshot(dir);
  assert.equal(result.ok,true);assert.equal(result.operationReceipt.status,'committed');assert.deepEqual(result.changed.sort(),['auditLog','records']);
  assert.equal(after.revisions.records,before.revisions.records+1);assert.equal(after.revisions.vehicles,before.revisions.vehicles);
  assert.deepEqual(result.canonicalSections.records,after.data.records);
  const event=after.data.auditLog.find(row=>row.operationId==='sqlite-section-commit'&&row.section==='records');
  assert.equal(event.actorId,admin.id);assert.equal(event.at,now);assert.equal(event.after.note,'Synthetic reviewed note');
  assert.equal(after.data.vehicles[0].fuelBalance,923.537);assertGuardOnly(dir,guard);
});

test('SQLite CAS conflicts produce no partial rows, revisions, audit or receipt in section and full protocols',t=>{
  const {dir}=fixture(t),stale=storage.readSnapshot(dir),section=payload(dir,{records:changedRecords(dir,{note:'Stale'})},'sqlite-conflict');
  storage.writeSections(dir,payload(dir,{records:changedRecords(dir,{note:'Colleague'})},'sqlite-colleague'),{principal:admin});
  const before=storage.readSnapshot(dir),rejected=storage.writeSections(dir,section,{principal:admin});
  assert.equal(rejected.ok,false);assert.deepEqual(rejected.conflicts,['records']);
  const full=storage.writeAll(dir,{...stale.data,records:stale.data.records.map(row=>({...row,note:'Stale full'}))},
    {principal:admin,databaseToken:stale.databaseToken,base:stale.revisions,requireBase:true,operation:{id:'sqlite-full-conflict'}});
  assert.equal(full.ok,false);assert.deepEqual(full.conflicts,['records']);assert.deepEqual(storage.readSnapshot(dir),before);
});

test('a SQLite command replays after another Node process reopens the database without advancing revisions',t=>{
  const {dir}=fixture(t),original=payload(dir,{records:changedRecords(dir,{note:'Committed once'})},'sqlite-restart-replay');
  storage.writeSections(dir,original,{principal:admin,now});const before=storage.readSnapshot(dir);
  const code="const s=require(process.argv[1]);const result=s.writeSections(process.argv[2],JSON.parse(process.argv[3]),{principal:JSON.parse(process.argv[4])});process.stdout.write(JSON.stringify(result));";
  const child=spawnSync(process.execPath,['-e',code,require.resolve('../electron/storage'),dir,JSON.stringify(original),JSON.stringify(admin)],{encoding:'utf8',windowsHide:true,timeout:10000});
  assert.equal(child.status,0,child.stderr);const replay=JSON.parse(child.stdout);
  assert.equal(replay.ok,true);assert.equal(replay.replayed,true);assert.equal(replay.operationReceipt.status,'replayed');assert.deepEqual(replay.changed,[]);
  assert.deepEqual(storage.readSnapshot(dir),before);assert.equal(before.data.auditLog.filter(row=>row.type==='transaction'&&row.operationId==='sqlite-restart-replay').length,1);
});

test('SQLite operation identity remains bound to request body and trusted principal',t=>{
  const {dir}=fixture(t),original=payload(dir,{records:changedRecords(dir,{note:'Bound'})},'sqlite-bound-operation');
  storage.writeSections(dir,original,{principal:admin});const before=storage.readSnapshot(dir),different=structuredClone(original);different.sections.records[0].note='Different';
  assert.throws(()=>storage.writeSections(dir,different,{principal:admin}),error=>error.code==='OPERATION_REUSED');
  assert.throws(()=>storage.writeSections(dir,original,{principal:{...admin,id:'another-admin'}}),error=>error.code==='OPERATION_REUSED');
  assert.deepEqual(storage.readSnapshot(dir),before);
});

test('SQLite storage rejects new dangling links and unauthorized roles atomically',t=>{
  const {dir}=fixture(t),before=storage.readSnapshot(dir);
  assert.throws(()=>storage.writeSections(dir,payload(dir,{records:changedRecords(dir,{vehicleId:'new-missing'})},'sqlite-new-orphan'),{principal:admin}),error=>error.code==='INTEGRITY_VIOLATION');
  assert.throws(()=>storage.writeSections(dir,payload(dir,{records:changedRecords(dir,{note:'Forbidden'})}),{principal:{id:'viewer',name:'Viewer',role:'viewer'}}),error=>error.code==='ACCESS_DENIED');
  assert.deepEqual(storage.readSnapshot(dir),before);
});

test('SQLite preserves imported legacy orphan/value defects and permits separate descriptive and corrective edits',t=>{
  const {dir,initial}=fixture(t,db=>{db.records.push({id:'orphan',vehicleId:'missing-legacy',date:'2026-09-02',km:'Legacy invalid number'});});
  assert.deepEqual(storage.readAll(dir),initial);assert.ok(adapter().inspect(dir).legacyIssues.length>0);
  let records=storage.readAll(dir).records.map(row=>row.id==='orphan'?{...row,note:'Needs reconciliation'}:row);
  assert.equal(storage.writeSections(dir,payload(dir,{records}),{principal:admin}).ok,true);
  let orphan=storage.readAll(dir).records.find(row=>row.id==='orphan');assert.equal(orphan.vehicleId,'missing-legacy');assert.equal(orphan.km,'Legacy invalid number');
  records=storage.readAll(dir).records.map(row=>row.id==='orphan'?{...row,vehicleId:7}:row);
  assert.equal(storage.writeSections(dir,payload(dir,{records}),{principal:admin}).ok,true);
  records=storage.readAll(dir).records.map(row=>row.id==='orphan'?{...row,km:0}:row);
  assert.equal(storage.writeSections(dir,payload(dir,{records}),{principal:admin}).ok,true);
  orphan=storage.readAll(dir).records.find(row=>row.id==='orphan');assert.equal(orphan.vehicleId,7);assert.equal(orphan.km,0);
  assert.equal(storage.readAll(dir).vehicles[0].fuelBalance,923.537);
});

test('SQLite transaction failure rolls back rows, revision counters, canonical history and operation receipt together',t=>{
  const {dir}=fixture(t),before=storage.readSnapshot(dir),request=payload(dir,{records:changedRecords(dir,{note:'Should roll back'})},'sqlite-failed-commit');
  assert.throws(()=>adapter().transaction(dir,()=>storage.writeSections(dir,request,{principal:admin}),{
    beforeCommit(){throw Error('Synthetic SQLite commit failure');},
  }),/Synthetic SQLite commit failure/);
  assert.deepEqual(storage.readSnapshot(dir),before);
  assert.equal(storage.writeSections(dir,request,{principal:admin}).ok,true,'the same command must remain retryable after rollback');
});

test('an explicit read-only SQLite transaction cannot be upgraded through shared storage writes',t=>{
  const {dir}=fixture(t),before=storage.readSnapshot(dir),request=payload(dir,{records:changedRecords(dir,{note:'Forbidden read-only upgrade'})},'sqlite-readonly');
  assert.throws(()=>adapter().transaction(dir,()=>storage.writeSections(dir,request,{principal:admin}),{readOnly:true}),error=>/read.?only|чтен/i.test(error.code+' '+error.message));
  assert.deepEqual(storage.readSnapshot(dir),before);
  const missing=temp(t);assert.throws(()=>adapter().readAll(missing));assert.equal(fs.existsSync(path.join(missing,'platform.sqlite')),false);
});

test('SQLite uses the same closed-period guards while later records remain editable',t=>{
  const {dir}=fixture(t,db=>{db.fuelPeriods=[{month:'2026-09',closed:true}];});const before=storage.readSnapshot(dir);
  assert.throws(()=>storage.writeSections(dir,payload(dir,{records:changedRecords(dir,{km:101})}),{principal:admin}),/закрыт|начальн/i);
  const vehicles=before.data.vehicles.map((row,index)=>index===0?{...row,fuelBalance:924}:row);
  assert.throws(()=>storage.writeSections(dir,payload(dir,{vehicles}),{principal:admin}),/закрыт/i);assert.deepEqual(storage.readSnapshot(dir),before);
  const records=[...before.data.records,{id:'future',vehicleId:7,date:'2026-10-21',km:3.75,fuelActual:0}];
  assert.equal(storage.writeSections(dir,payload(dir,{records}),{principal:admin}).ok,true);
});

for(const format of ['SQLite','JSON']){
  test('closed '+format+' periods distinguish numeric/textual IDs: descriptive edits pass, actual fuel edits fail',t=>{
    let dir;
    if(format==='SQLite')dir=fixture(t,db=>{db.fuelPeriods=[{month:'2026-09',closed:true}];}).dir;
    else{dir=temp(t);const initial=data();initial.fuelPeriods=[{month:'2026-09',closed:true}];storage.writeAll(dir,initial,{principal:admin});}
    const before=storage.readSnapshot(dir),vehicles=before.data.vehicles.map((row,index)=>index===0?{...row,note:'Description only for numeric ID'}:row);
    const result=storage.writeSections(dir,payload(dir,{vehicles}),{principal:admin});assert.equal(result.ok,true);
    const current=storage.readSnapshot(dir);assert.equal(current.data.vehicles[0].id,7);assert.equal(current.data.vehicles[0].fuelBalance,923.537);
    assert.equal(current.data.vehicles[1].id,'7');assert.equal(current.data.vehicles[1].fuelBalance,0);assert.deepEqual(current.data.records,before.data.records);
    const changed=current.data.vehicles.map((row,index)=>index===0?{...row,fuelBalance:924}:row);
    assert.throws(()=>storage.writeSections(dir,payload(dir,{vehicles:changed}),{principal:admin}),/закрыт/i);
    assert.deepEqual(storage.readSnapshot(dir),current);
  });
}

test('a missing SQLite file leaves its fail-closed marker intact and cannot trigger empty JSON initialization',t=>{
  const {dir}=fixture(t),guard=assertGuardOnly(dir),file=adapter().filename(dir),backup=path.join(dir,'platform.sqlite.synthetic-unavailable');
  assert.equal(path.dirname(file),dir);assert.equal(path.dirname(backup),dir);fs.renameSync(file,backup);
  assert.throws(()=>storage.readSnapshot(dir),/Повреждены версии разделов/);
  assert.throws(()=>storage.writeAll(dir,{vehicles:[],records:[]}),/Повреждены версии разделов/);
  assertGuardOnly(dir,guard);assert.equal(fs.existsSync(file),false);assert.equal(fs.existsSync(backup),true);
});

test('a damaged existing SQLite file fails closed instead of loading or rewriting a nearby JSON database',t=>{
  const dir=temp(t),legacy=JSON.stringify({vehicles:[{id:'legacy-never-fallback'}],records:[]});
  fs.writeFileSync(path.join(dir,'data.json'),legacy);fs.writeFileSync(path.join(dir,'platform.sqlite'),'Synthetic corrupt database');
  const sqliteHash=hash(path.join(dir,'platform.sqlite'));
  assert.throws(()=>storage.readSnapshot(dir));assert.throws(()=>storage.writeAll(dir,{vehicles:[],records:[]}));
  assert.equal(fs.readFileSync(path.join(dir,'data.json'),'utf8'),legacy);assert.equal(hash(path.join(dir,'platform.sqlite')),sqliteHash);
  assert.equal(fs.existsSync(storage.sectionsDir(dir)),false);
});

test('HTTP SQLite section and full protocols share CAS, durable replay, role projection and trusted history',async t=>{
  const h=await httpFixture(t),loaded=await request(h.port,'/api/snapshot',h.tokens.admin);
  assert.equal(loaded.status,200);assert.deepEqual(loaded.body.data,storage.readAll(h.dir));
  const original=payload(h.dir,{records:changedRecords(h.dir,{note:'HTTP SQLite commit'})},'sqlite-http-operation');
  const first=await request(h.port,'/api/sections',h.tokens.admin,original);assert.equal(first.status,200);assert.equal(first.body.operationReceipt.status,'committed');
  const committed=storage.readSnapshot(h.dir),replay=await request(h.port,'/api/sections',h.tokens.admin,original);
  assert.equal(replay.status,200);assert.equal(replay.body.operationReceipt.status,'replayed');assert.deepEqual(storage.readSnapshot(h.dir),committed);
  const forged=await request(h.port,'/api/sections',h.tokens.other,original);assert.equal(forged.status,409);assert.equal(forged.body.code,'OPERATION_REUSED');
  const full={databaseToken:committed.databaseToken,base:committed.revisions,data:{...committed.data,records:committed.data.records.map((row,index)=>index===0?{...row,note:'HTTP full commit'}:row)},operation:{id:'sqlite-http-full'}};
  assert.equal((await request(h.port,'/api/data',h.tokens.admin,full)).status,200);const after=storage.readSnapshot(h.dir);
  assert.equal((await request(h.port,'/api/data',h.tokens.admin,full)).body.operationReceipt.status,'replayed');
  const stale={...full,operation:{id:'sqlite-http-stale'},data:{...full.data,records:full.data.records.map(row=>({...row,note:'Stale'}))}};
  assert.equal((await request(h.port,'/api/data',h.tokens.admin,stale)).status,409);assert.deepEqual(storage.readSnapshot(h.dir),after);
  const hidden=await request(h.port,'/api/snapshot',h.tokens.dispatcher);assert.deepEqual(hidden.body.data.payments,[]);assert.equal(hidden.body.revisions.payments,0);
  const event=after.data.auditLog.find(row=>row.operationId==='sqlite-http-operation'&&row.section==='records');assert.equal(event.actorId,admin.id);
});

for(const route of ['/api/sections','/api/data']){
  test('revoking a principal during a real HTTP SQLite upload prevents '+route+' commit and backup',async t=>{
    const h=await httpFixture(t),before=storage.readSnapshot(h.dir),body=payload(h.dir,{records:changedRecords(h.dir,{note:'Revoked upload'})},'sqlite-http-revoked');
    if(route==='/api/data'){body.data={...before.data,...body.sections};delete body.sections;}
    const result=await h.uploadThenChange(route,body,{enabled:false});assert.equal(result.status,401);assert.equal(h.backups,0);
    assert.deepEqual(storage.readSnapshot(h.dir),before);
  });
}
