'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process'),{DatabaseSync}=require('node:sqlite');
const daily=require('../electron/daily-backup.cjs'),multipart=require('../electron/multipart-backup.cjs'),storage=require('../electron/storage'),sqlite=require('../electron/sqlite-storage.cjs'),backup=require('../electron/backup-service.cjs');
const principal={id:'background-test',name:'Synthetic background test',role:'admin'},now='2026-11-08T12:00:00.000Z',sha=b=>crypto.createHash('sha256').update(b).digest('hex'),today=()=>new Date().toISOString().slice(0,10);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(check,label,timeout=15000){const until=Date.now()+timeout;while(Date.now()<until){const value=check();if(value)return value;await pause(15);}throw Error('Timed out: '+label);}
function jobFolders(dir){return fs.existsSync(dir)?fs.readdirSync(dir).filter(n=>n.startsWith('.backup-job-')).map(n=>path.join(dir,n)):[];}
async function settled(backupDir){const result=await waitFor(()=>{const status=daily.status(backupDir);return ['complete','failed'].includes(status?.state)&&jobFolders(backupDir).every(dir=>!fs.existsSync(path.join(dir,'worker.lock')))?status:null;},'background worker completion');assert.equal(result.state,'complete',JSON.stringify(result));return result;}
function fixture(t,seed){
 const parent=fs.realpathSync.native(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'tvs-background-daily-')),pin=fs.lstatSync(root),dir=path.join(root,'database'),backupDir=path.join(dir,'backups'),data=Object.fromEntries(storage.SECTIONS.map(n=>[n,[]]));data.vehicles=[{id:'v',plate:'SYNTHETIC',org:'A',note:'captured before save'}];sqlite.create(dir,seed??{data});
 t.after(async()=>{await waitFor(()=>jobFolders(backupDir).every(d=>!fs.existsSync(path.join(d,'worker.lock'))),'private fixture worker release',10000);assert.equal(path.dirname(root),parent);assert.match(path.basename(root),/^tvs-background-daily-/);const current=fs.lstatSync(root);assert.equal(current.isSymbolicLink(),false);assert.equal(current.dev,pin.dev);assert.equal(current.ino,pin.ino);fs.rmSync(root,{recursive:true,force:true});});return{root,dir,backupDir};
}
function locked(f,action){return storage.withDatabaseLock(f.dir,()=>sqlite.transaction(f.dir,action,{readOnly:true}));}
function schedule(f,keep=30){return locked(f,()=>daily.schedule(f.dir,f.backupDir,keep));}
function change(f,note,id='new-business-change'){
 const snap=storage.readSnapshot(f.dir),result=storage.writeSections(f.dir,{databaseToken:snap.databaseToken,base:snap.revisions,operation:{id},sections:{vehicles:snap.data.vehicles.map(r=>({...r,note}))}},{principal,now});assert.equal(result.ok,true,JSON.stringify(result));return storage.readSnapshot(f.dir);
}
function persisted(f,options={}){
 fs.mkdirSync(f.backupDir,{recursive:true});const directory=path.join(f.backupDir,'.backup-job-'+today()+'-'+crypto.randomUUID());fs.mkdirSync(directory);const captured=locked(f,()=>multipart.capture(f.dir,path.join(directory,'checkpoint.json'))),job={version:1,source:fs.realpathSync.native(f.dir),archive:'data_'+today()+'.zip',snapshot:'checkpoint.json',sha256:captured.sha256,keep:options.keep??30,createdAt:new Date().toISOString()};fs.writeFileSync(path.join(directory,'job.json'),JSON.stringify(job));fs.writeFileSync(path.join(directory,'status.json'),JSON.stringify({state:options.state??'queued',updatedAt:new Date().toISOString()}));return{directory,job,captured};
}

test('scheduling requires ownership of the database lock before any checkpoint can be captured',t=>{
 const f=fixture(t);assert.throws(()=>daily.schedule(f.dir,f.backupDir),{code:'BACKUP_LOCK_REQUIRED'});assert.equal(fs.existsSync(f.backupDir),false);
});

test('one queued checkpoint completes outside the write lock while a new save commits and the backup retains exactly the old checkpoint',async t=>{
 const f=fixture(t),before=storage.readSnapshot(f.dir),queued=schedule(f);assert.equal(queued.state,'queued');assert.equal(storage.isDatabaseLockHeld(f.dir),false);assert.equal(fs.existsSync(path.join(f.dir,'.tvs-database.lock')),false);
 const duplicate=schedule(f);assert.equal(duplicate.jobDir,queued.jobDir);assert.equal(jobFolders(f.backupDir).length,1);
 const after=change(f,'saved while backup runs');await settled(f.backupDir);const reader=multipart.openPackage(queued.path);try{reader.verify();assert.deepEqual(reader.data,before.data);assert.deepEqual(reader.revisions,before.revisions);}finally{reader.close();}
 assert.deepEqual(storage.readSnapshot(f.dir),after);assert.equal(after.data.vehicles[0].note,'saved while backup runs');assert.equal(fs.existsSync(path.join(f.dir,'.tvs-database.lock')),false);
});

test('a persisted running job resumes after restart without substituting the newer business snapshot',async t=>{
 const f=fixture(t),before=storage.readSnapshot(f.dir),job=persisted(f,{state:'running'});change(f,'newer than persisted checkpoint');const resumed=schedule(f);assert.equal(resumed.jobDir,job.directory);assert.equal(jobFolders(f.backupDir).length,1);await settled(f.backupDir);
 const reader=multipart.openPackage(resumed.path);try{reader.verify();assert.deepEqual(reader.data,before.data);}finally{reader.close();}assert.equal(storage.readSnapshot(f.dir).data.vehicles[0].note,'newer than persisted checkpoint');
});

for(const damage of ['missing','tampered'])test(damage+' checkpoint reports a failed background job and does not affect a new save',t=>{
 const f=fixture(t),job=persisted(f);if(damage==='missing')fs.unlinkSync(path.join(job.directory,'checkpoint.json'));else fs.appendFileSync(path.join(job.directory,'checkpoint.json'),' ');
 const before=storage.readSnapshot(f.dir),result=daily.execute(job.directory,fs.realpathSync.native(f.dir));assert.equal(result.state,'failed');assert.ok(['ENOENT','BACKUP_CHECKPOINT'].includes(result.code));assert.equal(daily.status(f.backupDir).state,'failed');assert.deepEqual(storage.readSnapshot(f.dir),before);
 assert.equal(change(f,'save after failed background '+damage,'after-failure-'+damage).data.vehicles[0].note,'save after failed background '+damage);assert.equal(fs.existsSync(path.join(f.backupDir,job.job.archive)),false);
});

test('dead worker ownership is recovered, while a live unrelated owner is never stolen',t=>{
 const f=fixture(t),job=persisted(f),lock=path.join(job.directory,'worker.lock'),child=spawnSync(process.execPath,['-e',''],{windowsHide:true});assert.equal(child.status,0);assert.ok(Number.isSafeInteger(child.pid));
 fs.writeFileSync(lock,JSON.stringify({pid:process.pid,nonce:'synthetic-live-owner'}));assert.equal(daily.execute(job.directory,fs.realpathSync.native(f.dir)).state,'running');assert.equal(JSON.parse(fs.readFileSync(lock)).nonce,'synthetic-live-owner');fs.unlinkSync(lock);
 fs.writeFileSync(lock,JSON.stringify({pid:child.pid,nonce:'synthetic-dead-owner'}));const result=daily.execute(job.directory,fs.realpathSync.native(f.dir));assert.equal(result.ok,true,JSON.stringify(result));assert.equal(daily.status(f.backupDir).state,'complete');assert.equal(fs.existsSync(lock),false);
});

test('an existing damaged index is checked in the background instead of being reported as a completed daily backup',async t=>{
 const f=fixture(t);fs.mkdirSync(f.backupDir,{recursive:true});const archive=path.join(f.backupDir,'data_'+today()+'.zip');fs.writeFileSync(archive,'damaged synthetic backup index');const result=schedule(f);assert.notEqual(result.state,'complete');await waitFor(()=>daily.status(f.backupDir)?.state==='failed','existing corrupt index reported');assert.equal(change(f,'save despite damaged older copy').data.vehicles[0].note,'save despite damaged older copy');
});

test('cold history is not copied or traversed while capturing the business checkpoint under the save lock',async t=>{
 const provider=require('./helpers/operation-stream-fixture.cjs').makeProvider(3,2*1024*1024),data=Object.fromEntries(storage.SECTIONS.map(n=>[n,[]])),f=fixture(t,{data,operationState:provider.operationState,operationProvider:{readObject:provider.readObject}});let coldReads=0;const original=DatabaseSync.prototype.prepare;
 let queued;try{DatabaseSync.prototype.prepare=function(sql){const statement=original.call(this,sql);if(/FROM\s+operation_ledger_objects/i.test(sql)){const get=statement.get;statement.get=function(...args){const row=get.apply(this,args);if(typeof row?.json==='string'&&row.json.length>1024*1024)coldReads++;return row;};}return statement;};queued=schedule(f);}finally{DatabaseSync.prototype.prepare=original;}
 assert.equal(queued.state,'queued');assert.equal(coldReads,0,'The large immutable proof objects belong to the background traversal');assert.ok(fs.statSync(path.join(queued.jobDir,'checkpoint.json')).size<128*1024);assert.equal(fs.existsSync(path.join(f.dir,'.tvs-database.lock')),false);await settled(f.backupDir);assert.equal(backup.verifyPackage({archivePath:queued.path}).ok,true);
});

test('a part containing an incompressible managed document larger than 8MiB remains bounded and verifiable',async t=>{
 const f=fixture(t),knowledge=path.join(f.dir,'reestr-knowledge');fs.mkdirSync(knowledge);const bytes=crypto.randomBytes(10*1024*1024);fs.writeFileSync(path.join(knowledge,'synthetic-opaque.bin'),bytes);const queued=schedule(f);change(f,'save while a larger document is packed');await settled(f.backupDir);
 const reader=multipart.openPackage(queued.path);try{reader.verify();assert.deepEqual(reader.readFile('reestr-knowledge/synthetic-opaque.bin'),bytes);assert.ok(reader.manifest.parts.some(p=>p.size>8*1024*1024));assert.ok(reader.manifest.parts.every(p=>p.rawBytes<=32*1024*1024));}finally{reader.close();}
});

test('a managed file changed after capture fails the old job visibly without blocking new business changes',async t=>{
 const f=fixture(t),knowledge=path.join(f.dir,'reestr-knowledge');fs.mkdirSync(knowledge);const file=path.join(knowledge,'synthetic-original.txt');fs.writeFileSync(file,'Exact captured original');const job=persisted(f);fs.writeFileSync(file,'Changed after checkpoint');const queued=schedule(f);assert.equal(queued.jobDir,job.directory);
 await waitFor(()=>daily.status(f.backupDir)?.state==='failed','managed file mutation reported');assert.equal(daily.status(f.backupDir).code,'BACKUP_SOURCE_CHANGED');assert.equal(change(f,'save after changed original').data.vehicles[0].note,'save after changed original');assert.equal(fs.existsSync(queued.path),false);
});

test('retention removes the old multipart index with its owned parts and preserves unrelated files',t=>{
 const f=fixture(t),job=persisted(f,{keep:1}),old=path.join(f.backupDir,'data_2000-01-01.zip');multipart.createFromCapture({sourceDir:f.dir,capturePath:path.join(job.directory,'checkpoint.json'),archivePath:old});const legacy=path.join(f.backupDir,'data_2000-01-02.json'),unrelated=path.join(f.backupDir,'leave-this-file.txt');fs.writeFileSync(legacy,'{}');fs.writeFileSync(unrelated,'Keep this');
 assert.equal(daily.execute(job.directory,fs.realpathSync.native(f.dir)).ok,true);assert.equal(fs.existsSync(old),false);assert.equal(fs.existsSync(old+'.parts'),false);assert.equal(fs.existsSync(legacy),false);assert.equal(fs.readFileSync(unrelated,'utf8'),'Keep this');assert.equal(backup.verifyPackage({archivePath:path.join(f.backupDir,job.job.archive)}).ok,true);
});

test('a completed backup whose part changes is rechecked in the background and no longer reported as complete',async t=>{
 const f=fixture(t),queued=schedule(f);await settled(f.backupDir);const part=fs.readdirSync(queued.path+'.parts').find(n=>/^part-/.test(n));assert.ok(part);fs.appendFileSync(path.join(queued.path+'.parts',part),'changed after completion');const recheck=schedule(f);assert.notEqual(recheck.state,'complete');await waitFor(()=>daily.status(f.backupDir)?.state==='failed','completed part mutation reported');assert.equal(change(f,'save after old part damage').data.vehicles[0].note,'save after old part damage');
});

test('an interrupted final index publication resumes its own persisted checkpoint instead of failing forever on the existing parts folder',t=>{
 const f=fixture(t),job=persisted(f),archive=path.join(f.backupDir,job.job.archive),original=fs.linkSync;
 try{fs.linkSync=function(from,to,...rest){if(path.resolve(to)===path.resolve(archive))throw Object.assign(Error('Synthetic interrupted index publication'),{code:'SYNTHETIC_PUBLICATION'});return original.call(this,from,to,...rest);};const failed=daily.execute(job.directory,fs.realpathSync.native(f.dir));assert.equal(failed.state,'failed');assert.equal(failed.code,'SYNTHETIC_PUBLICATION');}finally{fs.linkSync=original;}
 assert.equal(fs.existsSync(archive),false);const retained=fs.readdirSync(f.backupDir).filter(n=>n.startsWith('.tvs-backup-retained-parts-'));assert.equal(retained.length,1);assert.equal(JSON.parse(fs.readFileSync(path.join(f.backupDir,retained[0],'owner.json'))).checkpointSha256,job.job.sha256);change(f,'newer than the interrupted checkpoint');const retry=daily.execute(job.directory,fs.realpathSync.native(f.dir));assert.ok(retry.ok===true||retry.state==='complete',JSON.stringify(retry));assert.equal(backup.verifyPackage({archivePath:archive}).ok,true);
 const reader=multipart.openPackage(archive);try{assert.equal(reader.data.vehicles[0].note,'captured before save');}finally{reader.close();}
});

test('retry never clears a foreign parts directory merely because its basename matches the intended daily archive',t=>{
 const f=fixture(t),job=persisted(f),parts=path.join(f.backupDir,job.job.archive+'.parts');fs.mkdirSync(parts);const owner={format:'tvs-backup-parts',version:1,index:job.job.archive,checkpointSha256:'a'.repeat(64)};fs.writeFileSync(path.join(parts,'owner.json'),JSON.stringify(owner));fs.writeFileSync(path.join(parts,'private-file.txt'),'Foreign data must remain');const before=fs.readFileSync(path.join(parts,'owner.json'),'utf8'),result=daily.execute(job.directory,fs.realpathSync.native(f.dir));assert.equal(result.state,'failed');assert.equal(fs.readFileSync(path.join(parts,'owner.json'),'utf8'),before);assert.equal(fs.readFileSync(path.join(parts,'private-file.txt'),'utf8'),'Foreign data must remain');
});

test('closing the production storage executor does not terminate or strand the independent background backup worker',async t=>{
 const f=fixture(t),knowledge=path.join(f.dir,'reestr-knowledge');fs.mkdirSync(knowledge);fs.writeFileSync(path.join(knowledge,'synthetic-running.bin'),crypto.randomBytes(20*1024*1024));const before=storage.readSnapshot(f.dir),{createStorageExecutor}=require('../electron/storage-executor.cjs'),executor=createStorageExecutor();
 try{
  const result=await executor.run('writeSections',f.dir,{databaseToken:before.databaseToken,base:before.revisions,operation:{id:'executor-background'},sections:{vehicles:before.data.vehicles.map(r=>({...r,note:'new save while old backup runs'}))}},{principal,now},{assertCurrent:()=>{},backup:{directory:f.backupDir,keep:30,background:true}});assert.equal(result.operationReceipt.status,'committed');
  const job=await waitFor(()=>jobFolders(f.backupDir).find(d=>fs.existsSync(path.join(d,'worker.lock'))),'independent backup worker acquired job');assert.ok(job);await executor.close();await settled(f.backupDir);
  const archive=path.join(f.backupDir,'data_'+today()+'.zip'),reader=multipart.openPackage(archive);try{reader.verify();assert.deepEqual(reader.data,before.data);}finally{reader.close();}assert.equal(storage.readSnapshot(f.dir).data.vehicles[0].note,'new save while old backup runs');
 }finally{await executor.close();}
});

test('an orphan checkpoint directory from an interrupted enqueue does not prevent a fresh complete job',async t=>{
 const f=fixture(t);fs.mkdirSync(f.backupDir);const orphan=path.join(f.backupDir,'.backup-job-'+today()+'-'+crypto.randomUUID());fs.mkdirSync(orphan);fs.writeFileSync(path.join(orphan,'checkpoint.json'),'Retain orphan data for diagnosis');const queued=schedule(f);assert.equal(queued.state,'queued');assert.notEqual(queued.jobDir,orphan);await waitFor(()=>fs.existsSync(queued.path)&&jobFolders(f.backupDir).every(d=>!fs.existsSync(path.join(d,'worker.lock'))),'fresh backup after an interrupted enqueue');assert.equal(backup.verifyPackage({archivePath:queued.path}).ok,true);assert.equal(fs.readFileSync(path.join(orphan,'checkpoint.json'),'utf8'),'Retain orphan data for diagnosis');
});

test('an optional local background enqueue failure emits a warning but the original business operation still commits once',async t=>{
 const f=fixture(t),before=storage.readSnapshot(f.dir),events=[],{createStorageExecutor}=require('../electron/storage-executor.cjs'),executor=createStorageExecutor({onEvent:e=>events.push(e)});fs.writeFileSync(f.backupDir,'Synthetic path obstruction');
 try{const request={databaseToken:before.databaseToken,base:before.revisions,operation:{id:'background-enqueue-failed'},sections:{vehicles:before.data.vehicles.map(r=>({...r,note:'Save must not depend on backup enqueue'}))}},options={principal,now},controls={assertCurrent:()=>{},backup:{directory:f.backupDir,keep:30,background:true,optional:true}};const saved=await executor.run('writeSections',f.dir,request,options,controls);assert.equal(saved.operationReceipt.status,'committed');const after=storage.readSnapshot(f.dir);assert.equal(after.data.vehicles[0].note,'Save must not depend on backup enqueue');assert.ok(events.some(e=>e.phase==='backup-failed'));const replay=await executor.run('writeSections',f.dir,request,options,controls);assert.equal(replay.operationReceipt.status,'replayed');assert.deepEqual(storage.readSnapshot(f.dir),after);}finally{await executor.close();fs.unlinkSync(f.backupDir);}
});
