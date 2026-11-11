'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {currentFixture}=require('./helpers/schema-format-support.cjs'),host=require('./helpers/operation-history25-host.cjs'),store=require('../electron/operation-store.cjs'),safe=require('../electron/safe-file.cjs');
function inside(root,target){assert.equal(path.dirname(path.resolve(target)),path.resolve(root));assert.match(path.basename(path.resolve(root)),/^tvs-schema25-independent-/);}

test('a lock-scoped directory proof avoids repeated ancestor walks while canonical routes remain fresh',t=>{
 const f=currentFixture(t,'json',{data:{vehicles:[{id:0,org:'A'}]}}),verified=safe.verifiedDirectory,realpath=fs.realpathSync.native;let walks=0,rootResolutions=0;
 try{
  safe.verifiedDirectory=function(directory){if(path.resolve(directory)===path.resolve(f.dir))walks++;return verified.apply(this,arguments);};
  fs.realpathSync.native=function(directory){if(path.resolve(directory)===path.resolve(f.dir))rootResolutions++;return realpath.apply(this,arguments);};
  store.withFileReadScope(()=>{const first=store.readState(f.dir);assert.deepEqual(store.readState(f.dir),first);store.withFileReadScope(()=>assert.deepEqual(store.readState(f.dir),first));});
  assert.equal(walks,1);assert.ok(rootResolutions>=5,'each use still freshly resolves the selected route and rechecks its directory pin');
  store.withFileReadScope(()=>store.readState(f.dir));assert.equal(walks,2,'the next lock cannot reuse a former proof');
 }finally{safe.verifiedDirectory=verified;fs.realpathSync.native=realpath;}
});

test('replacing a same-name physical directory invalidates its active pin and a new scope verifies the replacement afresh',t=>{
 const f=currentFixture(t,'json',{data:{vehicles:[{id:0,org:'A'}]}}),parked=path.join(f.root,'synthetic-parked-db');inside(f.root,f.dir);inside(f.root,parked);
 store.withFileReadScope(()=>{store.readState(f.dir);assert.equal(fs.lstatSync(f.dir).isSymbolicLink(),false);fs.renameSync(f.dir,parked);fs.cpSync(parked,f.dir,{recursive:true});assert.throws(()=>store.readState(f.dir),{code:'SAFE_FILE_CHANGED'});});
 assert.deepEqual(store.withFileReadScope(()=>store.readState(f.dir)),store.readState(parked));
});

test('history read sessions still reject linked object folders and changed object bytes after a directory proof was reused',t=>{
 const f=host.fixture(t,'json'),saved=host.commit(f.dir,host.actor,'synthetic-path-session'),head=store.readState(f.dir).head,folder=path.join(f.dir,'operation-ledger/objects'),parked=path.join(f.dir,'operation-ledger/synthetic-parked-objects');
 assert.equal(path.dirname(folder),path.join(f.dir,'operation-ledger'));assert.equal(path.dirname(parked),path.dirname(folder));inside(f.root,f.dir);
 store.withFileReadScope(()=>{
  // Populate the directory proof without retaining an object descriptor:
  // Windows prevents renaming a directory containing active read handles.
  const open=fs.openSync;
  try{fs.openSync=function(file){if(typeof file==='string'&&path.dirname(file)===folder)throw Object.assign(Error('Synthetic first open interruption'),{code:'SYNTHETIC_FIRST_OPEN'});return open.apply(this,arguments);};assert.throws(()=>store.engine(f.dir).inspectReceipt(head,saved.payload.operation.id),{code:'SYNTHETIC_FIRST_OPEN'});}finally{fs.openSync=open;}
  fs.renameSync(folder,parked);fs.symlinkSync(parked,folder,process.platform==='win32'?'junction':'dir');
  try{assert.throws(()=>store.engine(f.dir).inspectReceipt(head,saved.payload.operation.id),error=>/^SAFE_FILE_/.test(error.code));}
  finally{fs.unlinkSync(folder);fs.renameSync(parked,folder);}
 });
 store.withFileReadScope(()=>{
  const api=store.engine(f.dir),receipt=api.inspectReceipt(head,saved.payload.operation.id),file=path.join(folder,receipt.proofHash+'.json'),original=fs.readFileSync(file);
  try{fs.writeFileSync(file,'{}');assert.throws(()=>api.inspectReceipt(head,saved.payload.operation.id),error=>/^(SAFE_FILE_|LEDGER_)/.test(error.code));}
  finally{fs.writeFileSync(file,original);}
 });
 assert.equal(store.engine(f.dir).inspectReceipt(head,saved.payload.operation.id).kind,'receipt');
});
