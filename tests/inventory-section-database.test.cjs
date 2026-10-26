'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const store=require('../electron/inventory-database.cjs'),storage=require('../electron/storage'),sqlite=require('../electron/sqlite-storage.cjs'),core=require('../assets/core/asset-inventory.js'),commands=require('../assets/core/platform-commands.js');
const admin={id:'inventory-section-admin',name:'Synthetic inventory administrator',role:'admin'},today='2026-10-26';
function fixture(t){const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'tvs-inventory-section-')),pin=fs.lstatSync(root),parent=path.join(root,'main');fs.mkdirSync(parent);fs.writeFileSync(path.join(parent,'data.json'),JSON.stringify({vehicles:[{id:'vehicle',plate:'FLEET KEEP'}],records:[],generators:[{id:'generator',name:'KEEP'}]}));t.after(()=>{const current=fs.lstatSync(root);assert.equal(current.isSymbolicLink(),false);assert.equal(current.dev,pin.dev);assert.equal(current.ino,pin.ino);assert.equal(path.dirname(root),fs.realpathSync(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});return {root,parent};}
function tree(dir,excludeSidecar=true){const result={};for(const name of fs.readdirSync(dir).sort()){if(excludeSidecar&&name==='inventory-data')continue;const full=path.join(dir,name),info=fs.lstatSync(full);assert.equal(info.isSymbolicLink(),false);if(info.isDirectory())for(const [key,value]of Object.entries(tree(full,false)))result[name+'/'+key]=value;else result[name]=crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');}return result;}
function command(snapshot,input,id){const review=core.preview(snapshot.data,input,{today});assert.equal(review.canApply,true,JSON.stringify(review.issues));const command={type:'AssetInventoryAction',version:1,input:{...input,reviewFingerprint:review.fingerprint}};return {protocolVersion:1,databaseToken:snapshot.databaseToken,operation:{id},base:Object.fromEntries(commands.dependencies(command).map(name=>[name,snapshot.revisions[name]])),command};}
function legacy(){return {orgs:[{id:'org',name:'Own organisation'}],objects:[{id:'object',name:'Own object'}],mols:[{id:'mol',orgId:'org',objectId:'object',name:'Own MOL',accountCode:'01',items:[{id:'item',name:'Zero property',code:'000001',unit:'шт',qty:0,cost:0}]}],inventories:[],locGroupNames:{}};}
function stage(snapshot){return {action:'stage',profile:'asset-inventory',databaseToken:snapshot.databaseToken,parser:{id:'asset-inventory',version:1},sections:store.SECTIONS.slice(),source:{name:'Synthetic.json',base64:Buffer.from(JSON.stringify(legacy())).toString('base64')},mapping:{format:'legacy'}};}

test('opening inventory creates a private SQLite6 while legacy JSON fleet and identity remain byte-identical',t=>{
 const {parent}=fixture(t),before=tree(parent),snapshot=store.snapshot(parent,admin),dir=store.directory(parent);
 assert.equal(snapshot.ok,true);assert.deepEqual(Object.keys(snapshot.data).filter(name=>name!=='appMeta'),store.SECTIONS);assert.equal(snapshot.platform.storageKind,'sqlite');assert.equal(snapshot.platform.schemaVersion,6);assert.equal(snapshot.platform.readOnly,false);assert.ok(snapshot.platform.negotiation.selectedProfile.capabilities.some(cap=>cap.name==='inventoryV1'&&cap.version===1));
 assert.deepEqual(tree(parent),before);assert.equal(fs.existsSync(path.join(parent,'database-identity.json')),false);assert.ok(Object.values(sqlite.readAll(dir)).every(rows=>rows.length===0));assert.equal(store.snapshot(parent,admin).databaseToken,snapshot.databaseToken);
 const input={action:'saveCatalog',section:'inventoryOrgs',payload:{name:'Independent organisation',note:''},reason:'Synthetic own register'},envelope=command(snapshot,input,'independent-org'),ack=store.execute(parent,envelope,admin);
 assert.equal(ack.ok,true);assert.equal(ack.operationReceipt.id,'independent-org');assert.deepEqual(ack.canonicalSections.inventoryOrgs.map(row=>row.name),['Independent organisation']);assert.equal(ack.canonicalSections.auditLog,undefined);assert.deepEqual(tree(parent),before);
 const backups=fs.readdirSync(path.join(dir,'backups'));assert.equal(backups.length,1);assert.match(backups[0],/^data_\d{4}-\d{2}-\d{2}\.zip$/);assert.equal(require('../electron/backup-service.cjs').verifyPackage({archivePath:path.join(dir,'backups',backups[0])}).sourceDescriptor.schemaVersion,6);
 const all=sqlite.readAll(dir);for(const [name,rows]of Object.entries(all))if(!store.SECTIONS.includes(name)&&name!=='auditLog')assert.deepEqual(rows,[],name);
});

test('facade requires current parent token and independent inventory token for every mutation',async t=>{
 const {parent}=fixture(t),before=tree(parent),parentDatabaseToken=storage.databaseToken(parent),snapshot=await store.handle(parent,{action:'snapshot',parentDatabaseToken},admin);
 await assert.rejects(store.handle(parent,{action:'snapshot',parentDatabaseToken:'wrong-parent'},admin),{code:'DATABASE_CHANGED'});
 await assert.rejects(store.handle(parent,{action:'snapshot'},admin),{code:'INVENTORY_REQUEST'});
 const envelope=command(snapshot,{action:'saveCatalog',section:'inventoryOrgs',payload:{name:'Token fenced',note:''},reason:'Synthetic test'},'token-org');
 await assert.rejects(store.handle(parent,{action:'execute',parentDatabaseToken,request:{...envelope,databaseToken:parentDatabaseToken}},admin),{code:'DATABASE_CHANGED'});
 const ack=await store.handle(parent,{action:'execute',parentDatabaseToken,request:envelope},admin);assert.equal(ack.ok,true);
 assert.throws(()=>store.execute(parent,{...envelope,command:{type:'FuelAction',version:1,input:{}}},admin),{code:'INVENTORY_COMMAND'});
 assert.throws(()=>store.execute(parent,{...envelope,base:{...envelope.base,vehicles:0}},admin),{code:'INVENTORY_COMMAND'});
 await assert.rejects(store.importSource(parent,{...stage(snapshot),profile:'vehicles'},admin),{code:'INVENTORY_IMPORT'});assert.deepEqual(tree(parent),before);
});

test('real signed legacy source stages, previews and commits into sidecar only',async t=>{
 const {parent}=fixture(t),before=tree(parent),parentDatabaseToken=storage.databaseToken(parent),initial=await store.handle(parent,{action:'snapshot',parentDatabaseToken},admin),call=(action,request)=>store.handle(parent,{action,parentDatabaseToken,request},admin);
 const staged=await call('importSource',stage(initial));assert.equal(staged.canImport,true);
 const review=await call('importSource',{action:'preview',profile:'asset-inventory',databaseToken:initial.databaseToken,sourceId:staged.sourceId,reason:'Synthetic own source import'});assert.equal(review.preview.canApply,true,JSON.stringify(review.preview.issues));
 const input={...review.input,reviewFingerprint:review.reviewFingerprint},commandValue={type:'AssetInventoryAction',version:1,input},envelope={protocolVersion:1,databaseToken:initial.databaseToken,operation:{id:'sidecar-import'},base:review.base,command:commandValue};
 const ack=await call('execute',envelope);assert.equal(ack.ok,true);const after=store.snapshot(parent,admin);assert.equal(after.data.inventoryItems.length,1);assert.equal(after.data.inventoryItems[0].qty,0);assert.equal(after.data.inventoryItems[0].cost,0);assert.equal(require('../electron/import-source.cjs').validateState(store.directory(parent),sqlite.readAll(store.directory(parent))),true);assert.deepEqual(tree(parent),before);
 const replay=await call('execute',envelope);assert.equal(replay.replayed,true);assert.equal(store.snapshot(parent,admin).data.inventoryItems.length,1);
});

test('role ceilings, narrowed inventory owners and principal changes retain canonical access checks',async t=>{
 const {parent}=fixture(t);assert.throws(()=>store.snapshot(parent,{id:'mechanic',role:'mechanic'}),{code:'ACCESS_DENIED'});assert.equal(fs.existsSync(path.join(parent,'inventory-data')),false);
 const snapshot=store.snapshot(parent,admin),staged=await store.importSource(parent,stage(snapshot),admin),review=await store.importSource(parent,{action:'preview',profile:'asset-inventory',databaseToken:snapshot.databaseToken,sourceId:staged.sourceId,reason:'Synthetic scope seed'},admin);
 store.execute(parent,{protocolVersion:1,databaseToken:snapshot.databaseToken,operation:{id:'scope-seed'},base:review.base,command:{type:'AssetInventoryAction',version:1,input:{...review.input,reviewFingerprint:review.reviewFingerprint}}},admin);
 const fleetOnly={id:'scoped-accountant',role:'accountant',accessPolicy:{version:1,grants:[{org:'Own organisation',site:{any:true}}]}};
 const hidden=store.snapshot(parent,fleetOnly);assert.deepEqual(hidden.data.inventoryItems,[]);assert.deepEqual(hidden.data.inventoryMols,[]);await assert.rejects(store.importSource(parent,stage(hidden),fleetOnly),{code:'ACCESS_DENIED'});
 const viewer={id:'viewer',role:'viewer'},view=store.snapshot(parent,viewer);assert.deepEqual(view.access.writable,[]);const change=command(view,{action:'saveCatalog',section:'inventoryOrgs',payload:{name:'Forbidden',note:''},reason:'Synthetic viewer deny'},'viewer-deny');assert.throws(()=>store.execute(parent,change,viewer),{code:'ACCESS_DENIED'});
 const parentDatabaseToken=storage.databaseToken(parent);await assert.rejects(store.handle(parent,{action:'snapshot',parentDatabaseToken},admin,{getPrincipal:()=>({...admin,role:'viewer'})}),{code:'ACCESS_DENIED'});
});

test('initial seed copies only own five sections from existing SQLite and preserves signed source originals',async t=>{
 const {root}=fixture(t),sourceParent=path.join(root,'source-parent');sqlite.create(sourceParent,{data:{vehicles:[{id:'fleet',plate:'KEEP FLEET'}],records:[]}});
 const source=require('../electron/import-source.cjs'),snapshot=storage.readSnapshot(sourceParent),staged=await source.handle(sourceParent,stage(snapshot),{principal:admin}),review=await source.handle(sourceParent,{action:'preview',profile:'asset-inventory',databaseToken:snapshot.databaseToken,sourceId:staged.sourceId,reason:'Synthetic parent seed'},{principal:admin});
 storage.executeCommand(sourceParent,{protocolVersion:1,databaseToken:snapshot.databaseToken,operation:{id:'parent-seed'},base:{...review.base,appMeta:snapshot.revisions.appMeta},command:{type:'AssetInventoryAction',version:1,input:{...review.input,reviewFingerprint:review.reviewFingerprint}}},{principal:admin});const before=tree(sourceParent),copied=store.snapshot(sourceParent,admin),dir=store.directory(sourceParent);
 assert.equal(copied.data.inventoryItems.length,1);assert.notEqual(copied.databaseToken,snapshot.databaseToken);assert.deepEqual(sqlite.readAll(dir).vehicles,[]);assert.equal(source.validateState(dir,sqlite.readAll(dir)),true);assert.deepEqual(tree(sourceParent),before);
 assert.deepEqual(fs.readFileSync(path.join(dir,'import-sources',staged.source.sourceArchive.id)),fs.readFileSync(path.join(sourceParent,'import-sources',staged.source.sourceArchive.id)));
});

test('sidecar links and unknown existing folders are rejected without touching destinations',t=>{
 const {root,parent}=fixture(t),outside=path.join(root,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'keep.txt'),'KEEP');
 try{fs.symlinkSync(outside,path.join(parent,'inventory-data'),process.platform==='win32'?'junction':'dir');}catch(error){if(['EPERM','EACCES'].includes(error.code)){t.skip('Creating test directory links is unavailable');return;}throw error;}
 assert.throws(()=>store.snapshot(parent,admin),{code:'INVENTORY_DIRECTORY'});assert.deepEqual(fs.readdirSync(outside),['keep.txt']);fs.unlinkSync(path.join(parent,'inventory-data'));fs.mkdirSync(path.join(parent,'inventory-data'));fs.writeFileSync(path.join(parent,'inventory-data','keep.txt'),'KEEP');assert.throws(()=>store.snapshot(parent,admin),{code:'INVENTORY_DATABASE_FORMAT'});assert.equal(fs.readFileSync(path.join(parent,'inventory-data','keep.txt'),'utf8'),'KEEP');
});

test('concurrent first opens publish one complete SQLite identity and remove only their own stages',async t=>{
 const {parent}=fixture(t),before=tree(parent),{spawn}=require('node:child_process'),moduleFile=path.resolve(__dirname,'../electron/inventory-database.cjs');
 const open=()=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,['-e',"void(async()=>{try{const store=require(process.argv[1]);let snapshot;for(let attempt=0;attempt<100;attempt++){try{snapshot=store.snapshot(process.argv[2],{id:'concurrent-admin',role:'admin'});break;}catch(error){if(error.code!=='DB_BUSY'||attempt===99)throw error;await new Promise(resolve=>setTimeout(resolve,50));}}process.stdout.write(JSON.stringify({token:snapshot.databaseToken}));}catch(error){process.stderr.write(error.stack);process.exitCode=1;}})();",moduleFile,parent],{stdio:['ignore','pipe','pipe'],windowsHide:true});let output='',error='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>error+=chunk);child.once('error',reject);child.once('exit',code=>code===0?resolve(JSON.parse(output)):reject(Error(error||'Child exited '+code)));});
 const results=await Promise.allSettled([open(),open()]);for(const result of results)assert.equal(result.status,'fulfilled',result.reason?.stack);const [first,second]=results.map(result=>result.value);assert.equal(first.token,second.token);assert.equal(fs.readdirSync(parent).some(name=>name.startsWith('.inventory-data-')),false);assert.deepEqual(tree(parent),before);assert.equal(sqlite.inspect(store.directory(parent)).ok,true);
});
