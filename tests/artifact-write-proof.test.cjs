'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const {ROOT}=require('./helpers/source-harness.cjs');
const safeFiles=require('../electron/safe-file.cjs'),writeProof=require('../electron/write-proof.cjs'),format=require('../electron/storage-format.cjs');

// Use the actual artifacts handlers and atomic writer. Only Electron, authority
// and the filesystem await boundary are controlled; no database is opened.
function fixture(t,{expireAfter,expireDuringRead=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-artifact-proof24-')),owned=fs.lstatSync(root),handlers=new Map();
 const state={valid:true,proofChecks:0,optionsCalls:0,opens:0,renames:0,expiredAt:null};
 const directory=path.join(root,'import-sources');fs.mkdirSync(directory);
 const sentinel=path.join(directory,'SYNTHETIC-preserved.txt'),sentinelBytes=Buffer.from('Existing synthetic original must remain byte exact');fs.writeFileSync(sentinel,sentinelBytes);
 const expire=phase=>{if(expireAfter===phase){state.valid=false;state.expiredAt=phase;}};
 const io=Object.create(fs),promises=Object.create(fs.promises);Object.defineProperty(io,'promises',{value:promises});
 promises.open=async(...args)=>{
  const handle=await fs.promises.open(...args);state.opens++;expire('open');
  return {stat:()=>handle.stat(),async writeFile(...values){const result=await handle.writeFile(...values);expire('write');return result;},async sync(){const result=await handle.sync();expire('sync');return result;},async close(){const result=await handle.close();expire('close');return result;}};
 };
 promises.rename=async(...args)=>{state.renames++;return fs.promises.rename(...args);};
 io.readSync=(...args)=>{const count=fs.readSync(...args);if(expireDuringRead&&count>0){state.valid=false;state.expiredAt='read';}return count;};
 const safeFile=safeFiles.createSafeFileReader(io),principal={id:'synthetic-artifact-actor',name:'Synthetic',role:'admin'};
 const authority={principal,requireNegotiatedWriter:true,assertWriteCompatibility(context){state.proofChecks++;assert.equal(context.requiredCapability,'controlledImports');if(!state.valid)throw Object.assign(Error('Synthetic compatibility proof expired'),{code:'PROTOCOL_RENEGOTIATE'});return {valid:true};}};
 const storage={assertWritable(){},assertWriteCompatibility(_directory,options,requiredCapability){assert.equal(_directory,root);return writeProof.assertWriteCompatibility(options,{databaseToken:'synthetic-db-token',principal:options.principal,descriptor:format.describe(format.SCHEMA_VERSION),requiredCapability});}};
 const sender={id:7,mainFrame:{synthetic:true},isDestroyed:()=>false,getURL:()=> 'file:///synthetic/index.html'};
 const context={Buffer,module:{exports:{}},exports:{},require(name){if(name==='electron')return {dialog:{},shell:{},BrowserWindow:{}};if(name==='./safe-file.cjs')return safeFile;if(name==='./storage')return storage;if(name==='./import-source.cjs')return {actions:()=>['stage']};if(name==='./attachment-access.cjs'||name==='./backup-service.cjs')return {};return require(name);}};
 vm.runInNewContext(fs.readFileSync(path.join(ROOT,'electron/artifacts.js'),'utf8'),context,{filename:'electron/artifacts.js'});
 context.module.exports.register({ipcMain:{handle:(name,handler)=>handlers.set(name,handler)},getDataDir:()=>root,isClientMode:()=>false,getSettings:()=>({}),knowledgeDir:()=>root,getPrincipal:()=>principal,getContext:()=>({scope:'synthetic-owned-scope'}),assertContext(){},getWriteOptions(){state.optionsCalls++;return authority;}});
 t.after(()=>{const current=fs.lstatSync(root);assert.equal(path.dirname(root),fs.realpathSync(os.tmpdir()));assert.match(path.basename(root),/^tvs-artifact-proof24-/);assert.equal(current.isSymbolicLink(),false);assert.equal(current.dev,owned.dev);assert.equal(current.ino,owned.ino);fs.rmSync(root,{recursive:true,force:true});});
 const bytes=Buffer.from('Synthetic original import source'),hash=crypto.createHash('sha256').update(bytes).digest('hex'),id=hash+'.csv',dest=path.join(directory,id);
 return {state,bytes,id,dest,directory,sentinel,sentinelBytes,invoke:()=>handlers.get('archive-import-source')({sender},{name:'Synthetic.csv',bytes:Array.from(bytes)})};
}

for(const phase of ['open','write','sync','close'])test('raw source proof expiry after atomic '+phase+' refuses publication and cleans its temporary file',async t=>{
 const f=fixture(t,{expireAfter:phase}),result=await f.invoke();
 assert.equal(f.state.expiredAt,phase);assert.equal(result.ok,false);assert.match(result.error,/proof expired/);assert.ok(f.state.proofChecks>2);assert.equal(f.state.optionsCalls,1);
 assert.equal(f.state.renames,0);assert.equal(fs.existsSync(f.dest),false);assert.deepEqual(fs.readFileSync(f.sentinel),f.sentinelBytes);assert.deepEqual(fs.readdirSync(f.directory),[path.basename(f.sentinel)]);
});

test('valid raw source publication keeps authority outside the result and reuses exact existing bytes',async t=>{
 const f=fixture(t),first=await f.invoke();assert.equal(first.ok,true);assert.equal(first.id,f.id);assert.equal(first.sha256,f.id.slice(0,64));assert.equal(first.size,f.bytes.length);assert.deepEqual(fs.readFileSync(f.dest),f.bytes);assert.equal(f.state.renames,1);
 const second=await f.invoke();assert.equal(second.ok,true);assert.equal(second.id,f.id);assert.equal(f.state.opens,1);assert.equal(f.state.renames,1);assert.doesNotMatch(JSON.stringify(first),/ticket|assertWriteCompatibility|requireNegotiatedWriter/);assert.deepEqual(fs.readFileSync(f.sentinel),f.sentinelBytes);assert.equal(fs.readdirSync(f.directory).some(name=>name.endsWith('.tmp')),false);
});

test('authority revoked while checking a cached raw original returns no success and preserves all existing bytes',async t=>{
 const f=fixture(t,{expireDuringRead:true});fs.writeFileSync(f.dest,f.bytes);const result=await f.invoke();
 assert.equal(f.state.expiredAt,'read');assert.equal(result.ok,false);assert.match(result.error,/proof expired/);assert.equal(f.state.opens,0);assert.equal(f.state.renames,0);assert.deepEqual(fs.readFileSync(f.dest),f.bytes);assert.deepEqual(fs.readFileSync(f.sentinel),f.sentinelBytes);assert.equal(fs.readdirSync(f.directory).some(name=>name.endsWith('.tmp')),false);
});
