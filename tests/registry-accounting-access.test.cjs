'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const schema=require('../assets/core/platform-schema.js'),core=require('../assets/core/registry-import.js');
const accounting=require('../assets/core/registry-accounting.js'),platform=require('../electron/platform-service.cjs');
const sqlite=require('../electron/sqlite-storage.cjs'),query=require('../electron/data-query.cjs');
const storage=require('../electron/storage.js');
const actor={id:'synthetic-accounting-admin',name:'Synthetic',role:'admin'},any={any:true};
const limited={...actor,accessPolicy:{version:1,grants:[{org:'A',site:any}]}};
const database=extra=>({...Object.fromEntries(schema.sections.map(name=>[name,[]])),...extra});
const clone=structuredClone,hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function registry(id,org,number='1'){
 const bytes=Buffer.from('%PDF-SYNTHETIC-REGISTRY-'+id),sha256=hash(bytes);
 const source={id:sha256+'.pdf',sha256,name:id+'.pdf',size:bytes.length};
 return core.buildRegister({id,org,number,date:'2026-11-01',source,declaredTotal:100,reason:'Synthetic reviewed source',duplicateReason:'Synthetic source version retained',invoices:[{supplier:'Synthetic supplier',invoiceNo:'SYNTHETIC-BILL-1',date:'2026-10-31',description:'Synthetic invoice',sum:100,allocations:[{kind:'unassigned',sum:100}]}]},database());
}
function fixture(){return database({savedReestrs:[registry('registry-visible','A','1'),registry('registry-private','B','2')]});}
function resolve(db){const group=accounting.project(db,{ignoreView:true}).groups[0];assert.ok(group);return accounting.resolve(db,{groupId:group.id,basis:group.basis,includedKeys:[group.members[0].key],separate:false,reason:'Synthetic comparison of originals'});}
function directory(t,db){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-registry-accounting-access-')),owned=fs.lstatSync(root);fs.mkdirSync(path.join(root,'import-sources'));
 for(const entry of db.savedReestrs)fs.writeFileSync(path.join(root,'import-sources',entry.source.id),Buffer.from('%PDF-SYNTHETIC-REGISTRY-'+entry.id));
 t.after(()=>{const now=fs.lstatSync(root);assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.match(path.basename(root),/^tvs-registry-accounting-access-/);assert.equal(now.isSymbolicLink(),false);assert.equal(now.dev,owned.dev);assert.equal(now.ino,owned.ino);fs.rmSync(root,{recursive:true,force:true});});return root;
}
const options=(db,principal=actor,extra={})=>({principal,now:'2026-11-10T12:00:00.000Z',databaseToken:'synthetic-accounting-db',revisions:{savedReestrs:1},...extra});

test('a hidden competing invoice stays in review without disclosing the other registry',()=>{
 const db=fixture(),before=JSON.stringify(db),rows=platform.visibleRows('savedReestrs',db.savedReestrs,limited,db);
 assert.equal(rows.length,1);assert.equal(rows[0].id,'registry-visible');
 assert.deepEqual(rows[0].registryAccountingView,{version:1,restricted:true,invoices:[{invoiceId:db.savedReestrs[0].rows[0].registryInvoiceId,state:'review',reason:'Требуется сверка повторов или версий реестра.'}]});
 assert.doesNotMatch(JSON.stringify(rows),/registry-private|groupId|basis/);
 assert.equal(accounting.project({...db,savedReestrs:rows}).invoices[0].state,'review');assert.equal(JSON.stringify(db),before);
});

test('authoritative reads ignore forged stored views and full readers receive all current statuses',()=>{
 const db=fixture();db.savedReestrs[0].registryAccountingView={version:1,restricted:false,invoices:[{invoiceId:db.savedReestrs[0].rows[0].registryInvoiceId,state:'included',reason:'FORGED'}]};
 const rows=platform.visibleRows('savedReestrs',db.savedReestrs,actor,db);
 assert.equal(rows.length,2);assert.ok(rows.every(entry=>entry.registryAccountingView.restricted===false));
 assert.ok(rows.every(entry=>entry.registryAccountingView.invoices[0].state==='review'));assert.doesNotMatch(JSON.stringify(rows),/FORGED/);
});

test('a restricted view redacts saved decisions and peer keys after access narrows',()=>{
 const db=fixture();db.savedReestrs=resolve(db);const rows=platform.visibleRows('savedReestrs',db.savedReestrs,limited,db);
 assert.equal(rows.length,1);assert.equal(Object.hasOwn(rows[0],'registryAccounting'),false);
 assert.equal(rows[0].registryAccountingView.invoices[0].state,accounting.project(db,{ignoreView:true}).invoices[0].state);
 assert.doesNotMatch(JSON.stringify(rows),/registry-private|includedKeys|Synthetic comparison|groupId|basis/);
});

test('field masking also marks accounting views as restricted',()=>{
 const db=fixture(),principal={...actor,accessPolicy:{version:1,grants:[{org:any,site:any}],sections:{savedReestrs:{readFields:['id','kind','registryVersion','rows']}}}};
 const rows=platform.visibleRows('savedReestrs',db.savedReestrs,principal,db);
 assert.equal(rows.length,2);assert.ok(rows.every(entry=>entry.registryAccountingView.restricted));assert.equal(Object.hasOwn(rows[0],'source'),false);
});

test('client-supplied derived inclusion never becomes stored data or a new accounting fact',()=>{
 const db=fixture(),before=JSON.stringify(db),supplied={savedReestrs:clone(db.savedReestrs)};
 for(const entry of supplied.savedReestrs)entry.registryAccountingView={version:1,restricted:false,invoices:[{invoiceId:entry.rows[0].registryInvoiceId,state:'included',reason:'FORGED'}]};
 const result=platform.prepareTransaction(db,supplied,options(db));assert.deepEqual(result.sections,{});assert.equal(JSON.stringify(db),before);
 assert.doesNotMatch(JSON.stringify(result.plan.sections),/registryAccountingView|FORGED/);
});

test('reconciliation with hidden participants is denied on the canonical write path',()=>{
 const db=fixture(),savedReestrs=resolve(db),revisions={savedReestrs:1},scopeViews=platform.scopeViews(db,revisions,limited,['savedReestrs']);
 assert.throws(()=>platform.prepareTransaction(db,{savedReestrs:[savedReestrs[0]]},options(db,limited,{revisions,base:{savedReestrs:1},scopeViews})),error=>error.code==='REGISTRY_ACCOUNTING_ACCESS'&&error.status===403);
});

test('a restricted ordinary edit retains private accounting evidence without accepting forged decisions',t=>{
 const db=fixture();db.savedReestrs=resolve(db);const root=directory(t,db),revisions={savedReestrs:1},scopeViews=platform.scopeViews(db,revisions,limited,['savedReestrs']);
 const rows=platform.visibleRows('savedReestrs',db.savedReestrs,limited,db);rows[0].reason='Synthetic ordinary allocation note';
 const result=platform.prepareTransaction(db,{savedReestrs:rows},options(db,limited,{dataDir:root,revisions,base:{savedReestrs:1},scopeViews}));
 assert.equal(result.sections.savedReestrs.length,2);assert.deepEqual(result.sections.savedReestrs[0].registryAccounting,db.savedReestrs[0].registryAccounting);assert.deepEqual(result.sections.savedReestrs[1],db.savedReestrs[1]);
 assert.ok(result.sections.savedReestrs.every(entry=>!Object.hasOwn(entry,'registryAccountingView')));
 const forged=clone(rows);forged[0].registryAccounting={version:1,decisions:[]};
 assert.throws(()=>platform.prepareTransaction(db,{savedReestrs:forged},options(db,limited,{dataDir:root,revisions,base:{savedReestrs:1},scopeViews})),error=>error.code==='REGISTRY_ACCOUNTING_ACCESS'&&error.status===403);
});

test('all participant registries require update permission even if every invoice is readable',()=>{
 const db=fixture(),savedReestrs=resolve(db),principal={...actor,accessPolicy:{version:1,grants:[{org:'A',site:any},{org:'B',site:any,actions:['read']}]}};
 const revisions={savedReestrs:1},scopeViews=platform.scopeViews(db,revisions,principal,['savedReestrs']);
 assert.throws(()=>platform.prepareTransaction(db,{savedReestrs},options(db,principal,{revisions,base:{savedReestrs:1},scopeViews})),error=>['ACCESS_DENIED','REGISTRY_ACCOUNTING_ACCESS'].includes(error.code)&&error.status===403);
});

test('a complete authorized reconciliation retains originals and excludes one invoice in the trusted ACK',t=>{
 const db=fixture(),root=directory(t,db),savedReestrs=resolve(db),result=platform.prepareTransaction(db,{savedReestrs},options(db,actor,{dataDir:root}));
 assert.equal(result.sections.savedReestrs.length,2);assert.deepEqual(result.sections.savedReestrs.map(entry=>entry.rows),db.savedReestrs.map(entry=>entry.rows));
 const acknowledged=platform.filteredResult({ok:true,canonicalSections:result.sections},actor,{...db,...result.sections});
 const states=acknowledged.canonicalSections.savedReestrs.map(entry=>entry.registryAccountingView.invoices[0].state).sort();assert.deepEqual(states,['excluded','included']);
 assert.ok(result.sections.savedReestrs.every(entry=>!Object.hasOwn(entry,'registryAccountingView')));
});

test('a broad paginated query resolves duplicates from the complete section rather than the current page',t=>{
 const db=fixture(),root=directory(t,db),dir=path.join(root,'db');sqlite.create(dir,{data:db});
 const result=query.queryRows(dir,{section:'savedReestrs',limit:1},actor);
 assert.equal(result.rows.length,1);assert.equal(result.total,2);assert.equal(result.rows[0].registryAccountingView.invoices[0].state,'review');
 assert.equal(result.rows[0].registryAccountingView.restricted,false);
});

test('real SQLite commit and exact replay retain the raw request identity without persisting derived views',t=>{
 const db=fixture(),root=directory(t,db),dir=path.join(root,'db');sqlite.create(dir,{data:db});fs.cpSync(path.join(root,'import-sources'),path.join(dir,'import-sources'),{recursive:true});
 const initial=storage.readSnapshot(dir,{principal:actor}),savedReestrs=resolve(initial.data);
 const payload={databaseToken:initial.databaseToken,base:{savedReestrs:initial.revisions.savedReestrs},operation:{id:'synthetic-registry-accounting-commit'},sections:{savedReestrs}};
 const result=storage.writeSections(dir,payload,{principal:actor,now:'2026-11-10T12:00:00.000Z',compactAck:true});
 assert.equal(result.ok,true);assert.equal(result.operationReceipt.status,'committed');
 const current=storage.readSnapshot(dir),stored=current.data.savedReestrs;assert.equal(stored.length,2);assert.ok(stored.every(entry=>!Object.hasOwn(entry,'registryAccountingView')));
 assert.deepEqual(stored.map(entry=>entry.rows),db.savedReestrs.map(entry=>entry.rows));
 const replay=storage.writeSections(dir,payload,{principal:actor,compactAck:true});assert.equal(replay.ok,true);assert.equal(replay.replayed,true);assert.equal(replay.operationReceipt.digest,result.operationReceipt.digest);
 assert.deepEqual(storage.readSnapshot(dir).revisions,current.revisions);
 const narrowed=storage.readSnapshot(dir,{principal:limited}),history=platform.queryHistory(dir,{limit:25},limited);
 assert.ok(narrowed.data.auditLog.some(row=>row.section==='savedReestrs'));
 assert.doesNotMatch(JSON.stringify(narrowed.data),/registry-private|includedKeys|Synthetic comparison/);
 assert.doesNotMatch(JSON.stringify(history),/registry-private|includedKeys|Synthetic comparison/);
});
