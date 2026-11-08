'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const ledger=require('../electron/operation-ledger.cjs'),store=require('../electron/operation-store.cjs'),storage=require('../electron/storage.js'),sqlite=require('../electron/sqlite-storage.cjs'),format=require('../electron/storage-format.cjs');
const principal={id:'seed-author',name:'Synthetic author',role:'admin'};
function fixture(t){
 const parent=fs.realpathSync.native(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'tvs-provider-seed-')),objects=new Map(),api=ledger.createOperationLedger({readObject:id=>objects.get(id),cursorKey:Buffer.alloc(32)});let head=api.genesis();
 const rows=[{section:'vehicles',before:null,after:{id:0,note:'Literal original event'}},{section:'vehicles',before:{id:0,note:'Literal original event'},after:{id:0,note:'Exact second event'}}];
 for(let i=0;i<2;i++){const operation={id:'literal-'+i,digest:'sha256:'+'a'.repeat(64),actorId:principal.id,actorRole:principal.role,databaseToken:'original-literal-token'},plan=api.prepareAppend({head,receipt:{operation,at:'2026-11-08T09:00:00.000Z',changedSections:['vehicles'],revisions:{vehicles:i+1},result:{}},auditEntries:[rows[i]],accessProof:{version:1,status:'verified',requiredSections:['vehicles'],subjects:[],request:{selectedTargets:[],operation}}});for(const o of plan.objects)objects.set(o.id,o.json);head=plan.head;}
 const operationState=format.createOperationState(head),data=Object.fromEntries(storage.SECTIONS.map(n=>[n,[]]));data.vehicles=[{id:0,plate:'NUMERIC ZERO',org:'Synthetic A',fuelBalance:923.537},{id:'0',plate:'STRING ZERO',org:'Synthetic B',fuelBalance:0}];data.records=[{id:'literal-record',vehicleId:0,date:'2026-09-10',km:1.001,fuelActual:0.001}];data.auditLog=rows;
 const revisions=Object.fromEntries(storage.SECTIONS.map(n=>[n,7])),input={data,revisions,operationState,operationProvider:{readObject:id=>objects.get(id)}};
 t.after(()=>{assert.equal(path.dirname(path.resolve(root)),parent);assert.match(path.basename(root),/^tvs-provider-seed-/);assert.equal(fs.lstatSync(root).isSymbolicLink(),false);fs.rmSync(root,{recursive:true,force:true});});
 return{root,objects,api,head,operationState,data,revisions,input};
}
for(const kind of ['json','sqlite']){
 const create=kind==='sqlite'?sqlite.create:storage.createJson;
 test(kind+' provider seed preserves all literal history, typed identities, exact decimals and receipt tokens',t=>{
  const f=fixture(t),dir=path.join(f.root,'restored');create(dir,f.input);const snap=storage.readSnapshot(dir);assert.deepEqual(snap.data,f.data);assert.deepEqual(snap.revisions,f.revisions);assert.deepEqual(store.readState(dir),f.operationState);
  for(const id of ['literal-0','literal-1'])assert.deepEqual(store.engine(dir).inspectReceipt(f.head,id).receipt,f.api.inspectReceipt(f.head,id).receipt);
  const received=new Map();store.walkClosure(dir,o=>received.set(o.id,o.json));assert.deepEqual([...received].sort(([a],[b])=>a.localeCompare(b)),f.api.exportClosure(f.head).objects.map(o=>[o.id,o.json]));
  if(kind==='sqlite'){assert.equal(sqlite.inspect(dir).ok,true);const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(sqlite.filename(dir),{readOnly:true});try{assert.equal(db.prepare('SELECT count(*) AS n FROM operation_ledger_receipts').get().n,2);}finally{db.close();}}
 });
 test(kind+' missing, corrupt and partial provider seeds fail before creating a target',t=>{
  const f=fixture(t);let getterCalled=false;const accessor={};Object.defineProperty(accessor,'readObject',{enumerable:true,get(){getterCalled=true;throw Error('Must not invoke');}});
  const cases=[{...f.input,operationProvider:{readObject:()=>null}},{...f.input,operationProvider:{readObject:()=> '{}'}},{...f.input,operationObjects:[]},{data:f.data,revisions:f.revisions,operationProvider:f.input.operationProvider},{...f.input,operationProvider:accessor},{...f.input,operationProvider:{readObject:async()=>null}},{...f.input,data:{...f.data,auditLog:[]}}];
  for(let i=0;i<cases.length;i++){const target=path.join(f.root,'invalid-'+i);assert.throws(()=>create(target,cases[i]));assert.equal(fs.existsSync(target),false);}assert.equal(getterCalled,false);
 });
 test(kind+' provider failure on the second pass publishes no database commit point',t=>{
  const f=fixture(t),target=path.join(f.root,'interrupted'),root=JSON.parse(f.objects.get(f.head.receiptRoot)),firstLeaf=JSON.parse(f.objects.get(Object.values(root.children).at(-1)));let passes=0;
  const input={...f.input,operationProvider:{readObject:id=>{if(id===f.head.receiptRoot)passes++;return passes>1&&id===firstLeaf.receiptHash?'{}':f.objects.get(id);}}};
  assert.throws(()=>create(target,input),{code:'LEDGER_HASH'});assert.equal(fs.existsSync(path.join(target,'platform.sqlite')),false);assert.equal(fs.existsSync(path.join(target,'sections','revisions.json')),false);
 });
 test(kind+' an older captured head remains exportable after a later genuine save',t=>{
  const f=fixture(t),dir=path.join(f.root,'later');create(dir,f.input);const before=storage.readSnapshot(dir),saved=storage.writeSections(dir,{databaseToken:before.databaseToken,base:before.revisions,sections:{vehicles:before.data.vehicles.map(row=>({...row,note:'Later edit'}))},operation:{id:'later-operation'}},{principal});assert.equal(saved.ok,true);
  const earlier=new Map(),summary=store.walkClosure(dir,o=>earlier.set(o.id,o.json),{operationState:f.operationState});assert.equal(summary.operationState.transactionId,f.operationState.transactionId);assert.deepEqual([...earlier].sort(([a],[b])=>a.localeCompare(b)),f.api.exportClosure(f.head).objects.map(o=>[o.id,o.json]));assert.equal(store.readState(dir).head.lastSeq>summary.head.lastSeq,true);
 });
}
test('a staged SQLite provider seed above512MiB restores under a128MiB JavaScript heap',()=>{
 const program=String.raw`
 const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),repo=process.argv[1],ledger=require(path.join(repo,'electron/operation-ledger.cjs')),sqlite=require(path.join(repo,'electron/sqlite-storage.cjs')),format=require(path.join(repo,'electron/storage-format.cjs')),schema=require(path.join(repo,'assets/core/platform-schema.js'));
 const parent=fs.realpathSync.native(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'tvs-large-provider-')),fixture=require(path.join(repo,'tests/helpers/operation-stream-fixture.cjs')).makeProvider();
 try{
 const directory=path.join(root,'db'),data=Object.fromEntries(schema.sections.map(n=>[n,[]]));sqlite.create(directory,{data,operationState:fixture.operationState,operationProvider:{readObject:fixture.readObject}});const size=fs.statSync(sqlite.filename(directory)).size;assert.ok(size>512*1024*1024);assert.equal(sqlite.inspect(directory).ok,true);process.stdout.write(JSON.stringify({bytes:size}));
 }finally{assert.equal(path.dirname(root),parent);assert.ok(path.basename(root).startsWith('tvs-large-provider-'));assert.equal(fs.lstatSync(root).isSymbolicLink(),false);fs.rmSync(root,{recursive:true,force:true});}`;
 const child=spawnSync(process.execPath,['--max-old-space-size=128','-e',program,path.resolve(__dirname,'..')],{encoding:'utf8',timeout:180000,windowsHide:true,maxBuffer:1024*1024});assert.equal(child.status,0,child.stderr||child.error?.message);assert.ok(JSON.parse(child.stdout).bytes>512*1024*1024);
});
