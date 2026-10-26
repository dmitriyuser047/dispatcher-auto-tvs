'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{performance}=require('node:perf_hooks');
const storage=require('../electron/storage'),sqlite=require('../electron/sqlite-storage.cjs'),archive=require('../electron/document-archive.cjs'),schema=require('../assets/core/platform-schema');
const principal={id:'synthetic-recovery-admin',name:'Synthetic recovery administrator',role:'admin'},now='2026-10-26T12:00:00.000Z';
function tree(root){const rows=[];function walk(dir){for(const name of fs.readdirSync(dir).sort()){const file=path.join(dir,name),info=fs.lstatSync(file);assert.equal(info.isSymbolicLink(),false);if(info.isDirectory())walk(file);else rows.push([path.relative(root,file),info.size,crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]);}}walk(root);return rows;}
function fixture(t,format,count=0){
 const parent=fs.realpathSync.native(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'tvs-archive-projection-')),pin=fs.lstatSync(root),dir=path.join(root,'db');
 t.after(()=>{const current=fs.lstatSync(root);assert.equal(path.dirname(path.resolve(root)),parent);assert.match(path.basename(root),/^tvs-archive-projection-/);assert.equal(current.isSymbolicLink(),false);assert.equal(current.dev,pin.dev);assert.equal(current.ino,pin.ino);fs.rmSync(root,{recursive:true,force:true});});
 const data={...Object.fromEntries(schema.sections.map(name=>[name,[]])),vehicles:[{id:0,plate:'SYNTHETIC RECOVERY',org:'Synthetic organization'}],records:Array.from({length:count},(_,i)=>({id:'synthetic-'+i,vehicleId:0,date:'2026-10-'+String(i%26+1).padStart(2,'0'),km:10,fuelIssued:5,fuelActual:1,note:'Synthetic performance record '+i}))};
 if(format==='sqlite')sqlite.create(dir,{data});else storage.createJson(dir,{data});
 return {dir};
}
async function printed(t,format){
 const f=fixture(t,format),request={mode:'manual',form:'waybill',target:{section:'vehicles',id:0},fields:{number:'0',qty:0,amount:0,description:'Synthetic recovery fixture'},templateVersion:1};
 const preview=await archive.handle(f.dir,{action:'preview',request},{principal,now});assert.equal(preview.prepared.canCapture,true);
 const captured=storage.executeCommand(f.dir,{protocolVersion:1,databaseToken:preview.databaseToken,base:preview.base,operation:{id:'synthetic-recovery-print'},command:{type:'PrintAction',version:1,input:{request,reviewFingerprint:preview.reviewFingerprint}}},{principal,now});assert.equal(captured.ok,true);
 await archive.handle(f.dir,{action:'export',archiveId:captured.archive.id,format:'pdf'},{principal,now,renderPdf:async()=>Buffer.from('%PDF-synthetic-projection-recovery')});
 return {...f,head:archive.head(storage.readAll(f.dir))};
}
function observeProjection(t,dir){
 let reads=0;const readSection=storage.readSection;
 t.mock.method(storage,'readAll',()=>{assert.fail('Archive recovery must not reload all business sections');});
 t.mock.method(storage,'readSection',(directory,name,...args)=>{reads++;assert.equal(directory,dir);assert.equal(name,'appMeta');assert.equal(storage.isDatabaseLockHeld(dir),true);assert.deepEqual(args,[]);return readSection(directory,name,...args);});
 return ()=>reads;
}
function recover(dir,options){return storage.withDatabaseLock(dir,()=>archive.recover(dir,undefined,options));}
const expired=()=>Object.assign(Error('Synthetic expired proof'),{code:'PROTOCOL_RENEGOTIATE',status:428});
for(const format of ['json','sqlite']){
 test(format+' archive recovery reads only appMeta and leaves a large completed database unchanged',t=>{
  const {dir}=fixture(t,format,2000),before=tree(dir),runs=5;
  // Model the previous implementation under the same database lock. This is
  // diagnostic evidence, not a timing threshold dependent on the test host.
  const baseline=performance.now();for(let i=0;i<runs;i++)storage.withDatabaseLock(dir,()=>archive.recover(dir,storage.readAll(dir)));const beforeMs=(performance.now()-baseline)/runs;
  const reads=observeProjection(t,dir),start=performance.now();for(let i=0;i<runs;i++)assert.deepEqual(recover(dir),{ok:true});const afterMs=(performance.now()-start)/runs;
  assert.equal(reads(),runs);assert.deepEqual(tree(dir),before);t.diagnostic(JSON.stringify({format,records:2000,runs,fullSnapshotMs:beforeMs,archiveHeadOnlyMs:afterMs}));
 });
 test(format+' projected recovery preserves published validation and staged publication proof checks',async t=>{
  const {dir,head}=await printed(t,format),before=tree(dir),reads=observeProjection(t,dir);let checks=0;
  const options={principal,requireNegotiatedWriter:true,assertWriteCompatibility(){checks++;throw expired();}};
  assert.deepEqual(recover(dir,options),{ok:true});assert.equal(checks,0);assert.equal(reads(),1);assert.deepEqual(tree(dir),before);
  const final=path.join(dir,archive.DIR,head+'.json'),stage=path.join(dir,archive.DIR,head+'.stage');fs.renameSync(final,stage);const pending=tree(dir);
  assert.throws(()=>recover(dir,options),{code:'PROTOCOL_RENEGOTIATE'});assert.equal(checks,1);assert.deepEqual(tree(dir),pending);assert.equal(fs.existsSync(stage),true);assert.equal(fs.existsSync(final),false);
  assert.equal(recover(dir,{principal,requireNegotiatedWriter:true,assertWriteCompatibility(){return {valid:true};}}).ok,true);assert.equal(reads(),3);assert.equal(fs.existsSync(stage),false);assert.equal(fs.existsSync(final),true);assert.deepEqual(tree(dir),before);
 });
 test(format+' projected recovery still rejects a corrupt published capsule before any publication',async t=>{
  const {dir,head}=await printed(t,format),file=path.join(dir,archive.DIR,head+'.json');fs.writeFileSync(file,'Synthetic corrupt capsule');const before=tree(dir),reads=observeProjection(t,dir);let checks=0;
  assert.throws(()=>recover(dir,{principal,requireNegotiatedWriter:true,assertWriteCompatibility(){checks++;throw expired();}}),{code:'DOCUMENT_ARCHIVE_HASH'});assert.equal(reads(),1);assert.equal(checks,0);assert.deepEqual(tree(dir),before);
 });
}
