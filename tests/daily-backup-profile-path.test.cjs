'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const storage=require('../electron/storage'),sqlite=require('../electron/sqlite-storage.cjs'),backup=require('../electron/backup-service.cjs'),{createStorageExecutor}=require('../electron/storage-executor.cjs');
const principal={id:'path-test',name:'Synthetic path check',role:'admin'};
function fixture(t){
 const parent=fs.realpathSync.native(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'tvs-daily-profile-path-')),dir=path.join(root,'database'),alias=path.join(root,'selected-profile'),data=Object.fromEntries(storage.SECTIONS.map(n=>[n,[]]));
 data.vehicles=[{id:'v',plate:'SYNTHETIC',org:'A',note:''}];sqlite.create(dir,{data,revisions:Object.fromEntries(storage.SECTIONS.map(n=>[n,1]))});
 const links=[],executors=[];t.after(async()=>{await Promise.all(executors.map(x=>x.close()));assert.equal(path.dirname(path.resolve(root)),parent);assert.match(path.basename(root),/^tvs-daily-profile-path-/);assert.equal(fs.lstatSync(root).isSymbolicLink(),false);for(const p of links)if(fs.existsSync(p)){assert.equal(path.dirname(p)===root||path.dirname(p)===dir,true);assert.equal(fs.lstatSync(p).isSymbolicLink(),true);fs.unlinkSync(p);}fs.rmSync(root,{recursive:true,force:true});});
 try{fs.symlinkSync(dir,alias,process.platform==='win32'?'junction':'dir');links.push(alias);}catch(e){if(['EPERM','EACCES','ENOTSUP'].includes(e.code)){t.skip('Directory links unavailable');return null;}throw e;}
 const executor=()=>{const e=createStorageExecutor();executors.push(e);return e;};return{root,dir,alias,data,links,executor};
}
test('daily backup rebases the selected profile alias, verifies the package and preserves data',t=>{
 const f=fixture(t);if(!f)return;const before=storage.readSnapshot(f.dir),archive=storage.makeDailyBackup(f.alias,path.join(f.alias,'backups'),30);
 assert.equal(path.dirname(archive),path.join(f.dir,'backups'));assert.equal(backup.verifyPackage({archivePath:archive}).ok,true);assert.deepEqual(storage.readSnapshot(f.dir),before);assert.equal(storage.makeDailyBackup(f.alias,path.join(f.alias,'backups'),30),null);
});
test('worker saves through a profile alias with its mandatory verified daily backup',async t=>{
 const f=fixture(t);if(!f)return;const before=storage.readSnapshot(f.dir),payload={databaseToken:before.databaseToken,base:before.revisions,operation:{id:'alias-save'},sections:{vehicles:[{...before.data.vehicles[0],note:'Saved through selected alias'}]}};
 const result=await f.executor().run('writeSections',f.alias,payload,{principal},{assertCurrent:()=>{},backup:{directory:path.join(f.alias,'backups'),keep:30}});
 assert.equal(result.operationReceipt.status,'committed');assert.equal(storage.readSnapshot(f.dir).data.vehicles[0].note,'Saved through selected alias');const files=fs.readdirSync(path.join(f.dir,'backups'));assert.equal(files.length,1);assert.equal(backup.verifyPackage({archivePath:path.join(f.dir,'backups',files[0])}).ok,true);
});
test('junction inside the profile backup folder remains blocked before business commit with a definite result',async t=>{
 const f=fixture(t);if(!f)return;const outside=path.join(f.root,'unrelated'),link=path.join(f.dir,'backups');fs.mkdirSync(outside);fs.symlinkSync(outside,link,process.platform==='win32'?'junction':'dir');f.links.push(link);
 const before=storage.readSnapshot(f.dir),payload={databaseToken:before.databaseToken,base:before.revisions,operation:{id:'blocked-path'},sections:{vehicles:[{...before.data.vehicles[0],note:'Must not save'}]}};
 await assert.rejects(f.executor().run('writeSections',f.alias,payload,{principal},{assertCurrent:()=>{},backup:{directory:path.join(f.alias,'backups'),keep:30}}),e=>e.code==='BACKUP_PATH'&&e.definitive===true&&e.unknown===false);
 assert.deepEqual(storage.readSnapshot(f.dir),before);assert.deepEqual(fs.readdirSync(outside),[]);
});
