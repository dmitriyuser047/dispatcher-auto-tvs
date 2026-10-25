'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const storage=require('../electron/storage'),schema=require('../assets/core/platform-schema'),compatibility=require('../assets/core/platform-compatibility'),timesheets=require('../assets/core/personnel-timesheet'),documents=require('../assets/core/personnel-timesheet-document'),roster=require('../assets/core/personnel-timesheet-roster');
const {createStorageExecutor}=require('../electron/storage-executor.cjs'),{createWriteProof}=require('../electron/write-proof.cjs'),{createCommandOutbox}=require('../electron/command-outbox.cjs'),{createOperationRecovery}=require('../electron/operation-recovery.cjs');
const principal={id:'synthetic-postcommit-admin',name:'Synthetic postcommit administrator',role:'admin'},now='2026-10-25T20:32:00.000Z';
const archive=require('../electron/document-archive.cjs');
function tree(root){const rows=[];function walk(dir){for(const name of fs.readdirSync(dir).sort()){const file=path.join(dir,name),info=fs.lstatSync(file);assert.equal(info.isSymbolicLink(),false);if(info.isDirectory())walk(file);else rows.push([path.relative(root,file),info.size,crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]);}}walk(root);return rows;}
async function printedFixture(t){
 const parent=fs.realpathSync.native(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'tvs-roster-archive-')),pin=fs.lstatSync(root),dir=path.join(root,'db');
 t.after(()=>{const after=fs.lstatSync(root);assert.equal(path.dirname(path.resolve(root)),parent);assert.match(path.basename(root),/^tvs-roster-archive-/);assert.equal(after.isSymbolicLink(),false);assert.equal(after.dev,pin.dev);assert.equal(after.ino,pin.ino);fs.rmSync(root,{recursive:true,force:true});});
 storage.createJson(dir,{data:{...Object.fromEntries(schema.sections.map(name=>[name,[]])),vehicles:[{id:0,plate:'SYNTHETIC ARCHIVE',org:'Synthetic organization'}]}});
 const request={mode:'manual',form:'waybill',target:{section:'vehicles',id:0},fields:{number:'0',qty:0,amount:0,description:'Synthetic archive fixture'},templateVersion:1},preview=await archive.handle(dir,{action:'preview',request},{principal,now});assert.equal(preview.prepared.canCapture,true);
 const captured=storage.executeCommand(dir,{protocolVersion:1,databaseToken:preview.databaseToken,base:preview.base,operation:{id:'synthetic-existing-archive'},command:{type:'PrintAction',version:1,input:{request,reviewFingerprint:preview.reviewFingerprint}}},{principal,now});assert.equal(captured.ok,true);
 await archive.handle(dir,{action:'export',archiveId:captured.archive.id,format:'pdf'},{principal,now,renderPdf:async()=>Buffer.from('%PDF-synthetic-existing-archive')});
 return {root,dir,data:storage.readAll(dir)};
}
const expired=()=>Object.assign(Error('Synthetic expired transport proof'),{code:'PROTOCOL_RENEGOTIATE',status:428});

test('JSON roster without print archives acknowledges its committed receipt when a transport proof expires after preparation',async t=>{
 const parent=fs.realpathSync.native(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'tvs-roster-postcommit-')),pin=fs.lstatSync(root),dir=path.join(root,'db'),executor=createStorageExecutor();
 t.after(async()=>{await executor.close();const after=fs.lstatSync(root);assert.equal(path.dirname(path.resolve(root)),parent);assert.match(path.basename(root),/^tvs-roster-postcommit-/);assert.equal(after.isSymbolicLink(),false);assert.equal(after.dev,pin.dev);assert.equal(after.ino,pin.ino);fs.rmSync(root,{recursive:true,force:true});});
 const model=timesheets.create({kind:'driver',from:'2026-10-01',to:'2026-10-15',org:'Synthetic organization',rows:[{id:0,name:'Synthetic imported employee',position:'Водитель',personnelNumber:'0007',department:'Synthetic organization',site:'Synthetic site',days:{'2026-10-01':11,'2026-10-02':0,'2026-10-03':'МВ'}}]});
 const original=documents.makeRecord(model,{id:0,now}),data={...Object.fromEntries(schema.sections.map(name=>[name,[]])),assetDocuments:[original]};storage.createJson(dir,{data});
 const before=storage.readSnapshot(dir),plan=roster.preview(before.data,model,{createIds:[{rowId:0,id:'synthetic-new-driver'}]}),record=documents.makeRecord(plan.model,{id:0,previous:original,now});assert.equal(plan.canApply,true);
 const payload={databaseToken:before.databaseToken,base:{drivers:before.revisions.drivers,assetDocuments:before.revisions.assetDocuments},sections:{drivers:plan.drivers,assetDocuments:[record]},operation:{id:'synthetic-roster-postcommit-proof'}};
 let clock=1800000000000,advanced=false,sends=0;const phases=[],proof=createWriteProof({compatibility,now:()=>clock}),credential='synthetic-local-proof-credential';
 const issued=proof.negotiate(compatibility.describe().hello,{databaseToken:before.databaseToken,principal,descriptor:storage.descriptor(dir),credential}),writeOptions={principal,now,requireWriterSchema:true,writerSchemaVersion:6,...proof.writeOptions(issued.writeTicket,{credential})};
 const context={scope:crypto.createHash('sha256').update('synthetic-roster-postcommit-scope').digest('hex'),databaseToken:before.databaseToken,supportsOperations:true},outbox=createCommandOutbox({rootDir:path.join(root,'outbox')});
 const recovery=createOperationRecovery({outbox,send:async(_context,json)=>{sends++;return executor.run('writeSections',dir,JSON.parse(json),writeOptions,{assertCurrent({phase}){phases.push(phase);if(phase==='afterBackup'&&!advanced){advanced=true;clock+=60000;}}});},lookup:async(_context,id,digest)=>storage.readOperation(dir,{id,digest},principal)});
 const response=await recovery.execute(context,payload),queued=outbox.list(context.scope).find(row=>row.id===payload.operation.id),after=storage.readSnapshot(dir),saved=after.data.assetDocuments.find(row=>row.id===0);
 assert.equal(advanced,true);assert.equal(after.data.drivers.length,1);assert.equal(after.data.drivers[0].id,'synthetic-new-driver');assert.equal(saved.personnelTimesheet.rows[0].employeeId,'synthetic-new-driver');
 assert.deepEqual(saved.personnelTimesheet.rows.map(({employeeId,...row})=>row),model.rows);for(const name of schema.sections)if(!['drivers','assetDocuments','auditLog'].includes(name))assert.deepEqual(after.data[name],before.data[name],name);
 const receipt=storage.readOperation(dir,{id:payload.operation.id,digest:outbox.getForRetry(context.scope,payload.operation.id).requestDigest},principal);assert.equal(receipt.operationReceipt?.id,payload.operation.id);assert.ok(['committed','replayed'].includes(receipt.operationReceipt?.status));
 const resolved=await recovery.reconcile(context,payload.operation.id);assert.equal(resolved.committed,true);assert.equal(sends,1);assert.deepEqual(storage.readSnapshot(dir),after,'Receipt lookup must not send or change the committed business data');
 t.diagnostic(JSON.stringify({response:{ok:response.ok,code:response.code,queued:response.queued},initialQueueStatus:queued.status,receiptStatus:receipt.operationReceipt.status,phases,sends}));
 assert.equal(response.ok,true,'The roster was committed; an expired proof must not create an unknown operation when archive recovery has no work');
});

test('a fully published print archive is validated without using an expired write proof or changing files',async t=>{
 const f=await printedFixture(t),before=tree(f.dir);let checks=0;
 assert.deepEqual(archive.recover(f.dir,f.data,{principal,requireNegotiatedWriter:true,assertWriteCompatibility(){checks++;throw expired();}}),{ok:true});
 assert.equal(checks,0);assert.deepEqual(tree(f.dir),before);
});

test('a staged print archive still requires a valid write proof before publishing or cleaning up',async t=>{
 const f=await printedFixture(t),head=archive.head(f.data),final=path.join(f.dir,archive.DIR,head+'.json'),staged=path.join(f.dir,archive.DIR,head+'.stage');fs.renameSync(final,staged);const before=tree(f.dir);let checks=0;
 assert.throws(()=>archive.recover(f.dir,f.data,{principal,requireNegotiatedWriter:true,assertWriteCompatibility(){checks++;throw expired();}}),{code:'PROTOCOL_RENEGOTIATE'});
 assert.equal(checks,1);assert.deepEqual(tree(f.dir),before);assert.equal(fs.existsSync(staged),true);assert.equal(fs.existsSync(final),false);
 assert.equal(archive.recover(f.dir,f.data,{principal,requireNegotiatedWriter:true,assertWriteCompatibility(){return {valid:true};}}).ok,true);assert.equal(fs.existsSync(staged),false);assert.equal(fs.existsSync(final),true);
});

test('corrupt published archive bytes still fail validation even when recovery would otherwise do no work',async t=>{
 const f=await printedFixture(t),file=path.join(f.dir,archive.DIR,archive.head(f.data)+'.json');fs.writeFileSync(file,'Synthetic damaged capsule');const before=tree(f.dir);let checks=0;
 assert.throws(()=>archive.recover(f.dir,f.data,{principal,requireNegotiatedWriter:true,assertWriteCompatibility(){checks++;throw expired();}}),{code:'DOCUMENT_ARCHIVE_HASH'});
 assert.equal(checks,0);assert.deepEqual(tree(f.dir),before);
});
