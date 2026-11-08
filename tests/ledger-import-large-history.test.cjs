'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const ledger=require('../electron/operation-ledger.cjs'),store=require('../electron/operation-store.cjs');
const storage=require('../electron/storage'),backup=require('../electron/backup-service.cjs');
const principal={id:'history-import-admin',role:'admin'},sha=value=>crypto.createHash('sha256').update(value).digest('hex');

function temporary(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-ledger-large-import-')),pin=fs.lstatSync(root);
 t.after(()=>{const current=fs.lstatSync(root);assert.equal(path.dirname(root),fs.realpathSync(os.tmpdir()));assert.match(path.basename(root),/^tvs-ledger-large-import-/);assert.equal(current.isSymbolicLink(),false);assert.equal(current.dev,pin.dev);assert.equal(current.ino,pin.ino);fs.rmSync(root,{recursive:true,force:true});});
 return root;
}
function history(){
 // Each persisted segment is within the existing JSON/8 MiB object budgets.
 // The combined hot view has over one million nodes, but only about 2.3 MiB.
 return Array.from({length:512},(_,index)=>({id:'old-event-'+index,section:'vehicles',type:'update',before:{id:'old-vehicle-'+index,org:'Synthetic',cells:Array(2200).fill(0)},after:null}));
}
function source(root){
 const rows=history(),seed=store.bootstrap({auditRows:rows}),directory=path.join(root,'source');
 storage.createJson(directory,{data:{vehicles:[{id:'v',plate:'SYNTHETIC',org:'Synthetic',fuelBalance:0}],auditLog:seed.hotRows},operationState:seed.operationState,operationObjects:seed.objects});
 return {directory,rows,seed};
}
function tree(directory){const result={};for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())for(const [name,digest]of Object.entries(tree(file)))result[entry.name+'/'+name]=digest;else result[entry.name]=sha(fs.readFileSync(file));}return result;}

for(const format of ['json','sqlite'])test('transferred '+format+' database with large valid history opens, saves and replays without losing history',t=>{
 const root=temporary(t),original=source(root),before=tree(original.directory),archivePath=path.join(root,'transfer.zip'),targetDir=path.join(root,'target');
 backup.createPackage({sourceDir:original.directory,archivePath});
 const imported=backup.restorePackage({archivePath,targetDir,format});assert.equal(imported.path,targetDir);
 const snapshot=storage.readSnapshot(targetDir);assert.deepEqual(snapshot.data.auditLog,original.rows);
 const request={databaseToken:snapshot.databaseToken,base:snapshot.revisions,sections:{vehicles:snapshot.data.vehicles.map(row=>({...row,note:'one ordinary edit'}))},operation:{id:'edit-after-transfer'}};
 const saved=storage.writeSections(targetDir,request,{principal});assert.equal(saved.ok,true);assert.equal(saved.operationReceipt.status,'committed');
 const after=storage.readSnapshot(targetDir);assert.equal(after.data.vehicles[0].note,'one ordinary edit');assert.deepEqual(after.data.auditLog.slice(0,original.rows.length),original.rows);
 const replay=storage.writeSections(targetDir,structuredClone(request),{principal});assert.equal(replay.replayed,true);assert.deepEqual(storage.readSnapshot(targetDir),after);
 assert.deepEqual(store.readLogicalHistory(targetDir).slice(0,original.rows.length),original.rows);assert.deepEqual(tree(original.directory),before);
});

test('large history archive plans round trip and still reject tampering and getters',()=>{
 const rows=history(),seed=store.bootstrap({auditRows:rows}),objects=new Map(seed.objects.map(row=>[row.id,row.json]));
 const api=ledger.createOperationLedger({readObject:id=>objects.get(id),cursorKey:Buffer.alloc(32,11)});
 const retained=api.planArchive({head:seed.operationState.head,throughSeq:0,hotRows:rows});
 assert.deepEqual(api.resolvePlan(api.referencePlan(retained)),retained);
 const archived=api.planArchive({head:seed.operationState.head,throughSeq:256,hotRows:rows});assert.equal(archived.hotRows.length,256);assert.equal(archived.head.lastSeq,512);assert.equal(archived.head.auditHead,seed.operationState.head.auditHead);
 const changed=rows.slice();changed[0]={...rows[0],after:{id:'forged'}};assert.throws(()=>api.planArchive({head:seed.operationState.head,throughSeq:0,hotRows:changed}),{code:'LEDGER_HOT_VIEW'});
 let invoked=0;const getterRows=rows.slice();Object.defineProperty(getterRows,'0',{enumerable:true,get(){invoked++;return rows[0];}});assert.throws(()=>api.planArchive({head:seed.operationState.head,throughSeq:0,hotRows:getterRows}),{code:'LEDGER_JSON'});assert.equal(invoked,0);
 const sparse=rows.slice();delete sparse[0];assert.throws(()=>api.planArchive({head:seed.operationState.head,throughSeq:0,hotRows:sparse}),{code:'LEDGER_JSON'});
});
