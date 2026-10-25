'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const api=require('../assets/core/asset-inventory.js'),decode=require('../assets/core/asset-inventory-import.js'),hash=require('../assets/core/request-fingerprint.js');
const names=['inventoryOrgs','inventoryObjects','inventoryMols','inventoryItems','inventorySessions'],clone=value=>JSON.parse(JSON.stringify(value)),empty=()=>Object.fromEntries(names.map(name=>[name,[]]));
function raw(){return {orgs:[{id:0,name:'Batch organization'}],objects:[{id:0,name:'Batch object'}],mols:[{id:0,name:'Batch keeper',orgId:0,objectId:0,accountCode:'10',items:[{id:0,name:'Known zero',code:'000001',unit:'шт',qty:0,cost:0},{id:'0',name:'Historical unknown',code:'000002',unit:'м',qty:null,cost:null,archived:true}]}],inventories:[{id:0,objectId:0,orgId:0,date:'2026-01-26',title:'First batch document',rows:[{id:'r0',itemId:0,molId:0,qtyFact:0,costFact:0}]},{id:'0',objectId:0,orgId:0,date:'2025-05-31',title:'Historical batch document',rows:[{id:'r1',itemId:'0',molId:0,qtyFact:0.5,costFact:null}]}],locGroupNames:{}};}
function source(value=raw()){const result=decode.legacy(value);assert.equal(result.canImport,true,JSON.stringify(result.issues));const bytes=JSON.stringify(value),sha=hash.sha256(bytes),id=hash.sha256('batch-source '+bytes);return {version:1,id,sourceId:id,sha256:sha,format:'inventory-legacy-json',parserVersion:1,name:'batch-source.json',data:result.data,sections:names,sourceScopes:names,sourceArchive:{id:sha+'.json',sha256:sha,size:Buffer.byteLength(bytes),name:'batch-source.json'},sourceManifest:{id:id+'.json',sha256:id,size:100,name:'batch-manifest.json'},warnings:result.warnings};}
const context=id=>({id,now:'2026-10-25T12:00:00.000Z',today:'2026-10-25',actor:{id:'batch-clerk',name:'Batch clerk',role:'admin'}});
const input=(src,sessionIds)=>({action:'importLegacy',sourceId:src.sourceId,reason:'Reviewed bounded source document import',...(sessionIds===undefined?{}:{sessionIds})});
const preview=(db,src,ids)=>api.preview(db,input(src,ids),{today:'2026-10-25',importSource:src});
function apply(db,src,ids,id){const reviewed=preview(db,src,ids);assert.equal(reviewed.canApply,true,JSON.stringify(reviewed.issues));const planned=api.plan(db,{...input(src,ids),reviewFingerprint:reviewed.fingerprint},{...context(id),importSource:src});return {db:{...db,...clone(planned.sections)},planned};}
const clean=value=>Array.isArray(value)?value.map(clean):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>key!=='createdAt'&&key!=='updatedAt').map(([key,value])=>[key,clean(value)])):value;

test('independent document batches preserve one source namespace and shared catalogs without duplicate parents',()=>{
 const src=source(),first=apply(empty(),src,[0],'batch-first');assert.deepEqual(names.map(name=>first.db[name].length),[1,1,1,1,1]);
 const parents=JSON.stringify(names.slice(0,3).map(name=>first.db[name]));
 const second=apply(first.db,src,['0'],'batch-second');assert.deepEqual(names.map(name=>second.db[name].length),[1,1,1,2,2]);assert.equal(JSON.stringify(names.slice(0,3).map(name=>second.db[name])),parents);
 assert.equal(second.planned.changed.filter(row=>names.slice(0,3).includes(row.section)).length,0);
 const full=apply(empty(),src,undefined,'full-source');assert.deepEqual(clean(second.db),clean(full.db));
 assert.equal(second.db.inventoryItems.find(row=>row.sourceMeta.externalId===0).qty,0);
 const historical=second.db.inventoryItems.find(row=>row.sourceMeta.externalId==='0');assert.equal(historical.archived,true);assert.equal(historical.qty,null);assert.equal(historical.cost,null);
 const historicSession=second.db.inventorySessions.find(row=>row.sourceMeta.externalId==='0');assert.equal(historicSession.status,'draft');assert.equal(historicSession.rows[0].qtyFact,0.5);assert.equal(historicSession.rows[0].costFact,null);assert.equal(historicSession.approval,undefined);
});

test('batch selection is typed and explicit, duplicate documents and default whole-source reimport remain blocked',()=>{
 const src=source(),first=apply(empty(),src,[0],'first').db;
 assert.equal(preview(first,src,[0]).canApply,false);assert.equal(preview(first,src,[0]).issues[0].code,'INVENTORY_SOURCE_REPEATED');
 assert.equal(preview(first,src,undefined).issues[0].code,'INVENTORY_SOURCE_REPEATED');assert.equal(preview(empty(),src,['missing']).issues[0].code,'INVENTORY_IMPORT_BATCH');
 for(const selected of [[],[0,0],[null],'0'])assert.throws(()=>preview(empty(),src,selected));
 const command=input(src,[0]),review=preview(empty(),src,[0]);assert.throws(()=>api.plan(empty(),{...command,sessionIds:['0'],reviewFingerprint:review.fingerprint},{...context('changed-selection'),importSource:src}),error=>error.code==='STALE_REVIEW');
});

test('foreign collisions, changed imported parents and source aliases cannot be silently reused',()=>{
 const src=source(),first=apply(empty(),src,[0],'first').db,changed=clone(first);changed.inventoryMols[0].note='Independent later catalog change';
 const before=JSON.stringify(changed),blocked=preview(changed,src,['0']);assert.equal(blocked.canApply,false);assert.equal(blocked.issues[0].code,'INVENTORY_IMPORT_COLLISION');assert.equal(JSON.stringify(changed),before);
 const foreign=clone(first);foreign.inventoryOrgs[0].sourceMeta.importSourceId='f'.repeat(64);assert.equal(preview(foreign,src,['0']).canApply,false);
 const aliased=source();aliased.id=aliased.sourceId='e'.repeat(64);aliased.sourceManifest={...aliased.sourceManifest,id:aliased.sourceId+'.json',sha256:aliased.sourceId};assert.equal(preview(first,aliased,['0']).issues[0].code,'INVENTORY_SOURCE_REPEATED');
});

test('batch eligibility fails for shared or orphan source cards and validates unselected documents too',()=>{
 const shared=raw();shared.inventories[1].rows[0].itemId=0;assert.equal(preview(empty(),source(shared),[0]).issues[0].code,'INVENTORY_IMPORT_BATCH');
 const orphan=raw();orphan.mols[0].items.push({id:2,name:'Orphan card',unit:'шт',qty:1,cost:null});assert.equal(preview(empty(),source(orphan),[0]).issues[0].code,'INVENTORY_IMPORT_BATCH');
 const invalid=clone(source());invalid.data.inventoryItems[1].qty=-1;assert.equal(preview(empty(),invalid,[0]).canApply,false);
 const forged=clone(source());forged.data.inventorySessions[1].status='approved';assert.equal(preview(empty(),forged,[0]).issues[0].code,'INVENTORY_IMPORT_APPROVAL');
});

test('a source batch cannot exceed the unchanged ledger event ceiling',()=>{
 const value=raw();value.mols[0].items=[];value.inventories=value.inventories.slice(0,1);value.inventories[0].rows=[];
 for(let n=0;n<1996;n++){value.mols[0].items.push({id:'item'+n,name:'Item '+n,unit:'шт',qty:1,cost:null});value.inventories[0].rows.push({id:'row'+n,itemId:'item'+n,molId:0,qtyFact:null,costFact:null});}
 assert.equal(preview(empty(),source(value),[0]).issues[0].code,'INVENTORY_IMPORT_BATCH_LIMIT');
 value.mols[0].items.pop();value.inventories[0].rows.pop();const boundary=preview(empty(),source(value),[0]);assert.equal(boundary.canApply,true);assert.equal(boundary.changed.length,1999);
});

test('real signed-source preview selects documents, command replay never adds duplicate rows, and final backup verifies',async t=>{
 const storage=require('../electron/storage'),sqlite=require('../electron/sqlite-storage.cjs'),sources=require('../electron/import-source.cjs'),compatibility=require('../assets/core/platform-compatibility.js'),commands=require('../assets/core/platform-commands.js'),backup=require('../electron/backup-service.cjs');
 const parent=fs.realpathSync.native(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'tvs-inventory-batch-')),dir=path.join(root,'db');sqlite.create(dir,{data:{}});const principal={id:'local-profile',name:'Synthetic bounded import',role:'admin'},token=storage.databaseToken(dir),options={principal,now:'2026-10-25T12:00:00.000Z',...require('../electron/server').localWriteOptions({hello:compatibility.describe().hello,databaseToken:token,principal})};
 t.after(()=>{assert.equal(path.dirname(root),parent);assert.match(path.basename(root),/^tvs-inventory-batch-/);assert.equal(fs.lstatSync(root).isSymbolicLink(),false);fs.rmSync(root,{recursive:true,force:true});});
 const bytes=Buffer.from(JSON.stringify(raw())),staged=await sources.handle(dir,{action:'stage',profile:'asset-inventory',databaseToken:token,parser:{id:'asset-inventory',version:1},sections:names,source:{name:'batch.json',base64:bytes.toString('base64')},mapping:{format:'legacy'}},options);assert.equal(staged.canImport,true);
 let firstEnvelope;
 for(const [index,sessionId]of [0,'0'].entries()){
  const reviewed=await sources.handle(dir,{action:'preview',profile:'asset-inventory',databaseToken:token,sourceId:staged.sourceId,sessionIds:[sessionId],reason:'Synthetic bounded source document'},options);assert.equal(reviewed.preview.canApply,true,JSON.stringify(reviewed.preview.issues));assert.deepEqual(reviewed.input.sessionIds,[sessionId]);
  const current=storage.readSnapshot(dir),command={type:'AssetInventoryAction',version:1,input:{...reviewed.input,reviewFingerprint:reviewed.reviewFingerprint}},envelope={protocolVersion:1,databaseToken:token,operation:{id:'synthetic-batch-'+index},base:Object.fromEntries(commands.dependencies(command).map(name=>[name,current.revisions[name]])),command};
  const result=storage.executeCommand(dir,envelope,options);assert.equal(result.ok,true);if(index===0)firstEnvelope=envelope;
 }
 const before=storage.readAll(dir),replayed=storage.executeCommand(dir,firstEnvelope,options);assert.equal(replayed.replayed,true);assert.deepEqual(storage.readAll(dir),before);assert.deepEqual(names.map(name=>before[name].length),[1,1,1,2,2]);
 const repeated=await sources.handle(dir,{action:'preview',profile:'asset-inventory',databaseToken:token,sourceId:staged.sourceId,sessionIds:[0],reason:'Synthetic repeated batch'},options);assert.equal(repeated.preview.canApply,false);assert.equal(repeated.preview.issues[0].code,'INVENTORY_SOURCE_REPEATED');
 assert.equal(sources.validateState(dir,before),true);const file=path.join(root,'verified.zip');backup.createPackage({sourceDir:dir,archivePath:file});assert.equal(backup.verifyPackage({archivePath:file}).sourceDescriptor.schemaVersion,6);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),staged.source.sha256);
});
