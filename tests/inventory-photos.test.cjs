'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const photos=require('../electron/inventory-photos.cjs'),inventory=require('../electron/inventory-database.cjs'),storage=require('../electron/storage'),sqlite=require('../electron/sqlite-storage.cjs'),backup=require('../electron/backup-service.cjs'),core=require('../assets/core/asset-inventory.js'),{createCanvas}=require('@napi-rs/canvas');
const admin={id:'photo-admin',name:'Synthetic photo administrator',role:'admin'},viewer={id:'photo-viewer',role:'viewer'},hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const context=id=>({id,now:'2026-10-26T12:00:00.000Z',today:'2026-10-26',actor:admin});
function action(db,input,id){const preview=core.preview(db,input,{today:context(id).today});assert.equal(preview.canApply,true,JSON.stringify(preview.issues));const result=core.plan(db,{...input,reviewFingerprint:preview.fingerprint},context(id));return {...db,...structuredClone(result.sections)};}
function data(){let db={inventoryOrgs:[{id:0,name:'Photo organization',note:''}],inventoryObjects:[{id:0,name:'Photo object',note:''}],inventoryMols:[{id:0,orgId:0,objectId:0,name:'Photo MOL',accountCode:'01',note:''}],inventoryItems:[{id:0,molId:0,name:'Numeric asset',code:'ZERO',unit:'шт',qty:2,cost:10,note:''},{id:'0',molId:0,name:'String asset',code:'STRING',unit:'шт',qty:1,cost:10,note:''}],inventorySessions:[]};db=action(db,{action:'createSession',objectId:0,date:'2026-10-26',title:'Synthetic count with photographs',reason:'Synthetic photo evidence count'},'synthetic-session');const session=db.inventorySessions[0];session.id=0;session.rootId=0;session.rows[0].id=0;session.rows[1].id='0';db.inventorySessions.push({...structuredClone(session),id:'0',rootId:'0',title:'Different typed session'});return db;}
function fixture(t){const parent=fs.realpathSync.native(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'tvs-inventory-photos-')),pin=fs.lstatSync(root),dir=path.join(root,'db');sqlite.create(dir,{data:data()});t.after(()=>{const current=fs.lstatSync(root);assert.equal(path.dirname(root),parent);assert.match(path.basename(root),/^tvs-inventory-photos-/);assert.equal(current.isSymbolicLink(),false);assert.equal(current.dev,pin.dev);assert.equal(current.ino,pin.ino);fs.rmSync(root,{recursive:true,force:true});});return {root,dir};}
const image=(type='image/png')=>{const canvas=createCanvas(2,2),ctx=canvas.getContext('2d');ctx.fillStyle='#3688c8';ctx.fillRect(0,0,2,2);return canvas.toBuffer(type);};
const file=(name,bytes)=>({name,base64:Buffer.from(bytes).toString('base64')});
const request=(dir,extra={})=>({databaseToken:storage.databaseToken(dir),sessionId:0,...extra});
const upload=(dir,files=[file('synthetic.png',image())],extra={},user=admin,options={})=>photos.upload(dir,request(dir,{rowId:0,files,operationId:'photo-upload',...extra}),user,options);
const list=(dir,extra={},user=admin)=>photos.list(dir,request(dir,extra),user);
const read=(dir,id,extra={},user=admin)=>photos.read(dir,request(dir,{rowId:0,id,...extra}),user);

test('real raster photographs retain bytes and typed row/session binding without changing count facts or revisions',async t=>{
 const {dir}=fixture(t),before=storage.readSnapshot(dir),original=image();
 const saved=await upload(dir,[file('image with unknown extension.bin',original)]);assert.equal(saved.ok,true);assert.equal(saved.addedCount,1);const photo=saved.uploaded[0];assert.equal(photo.rowId,0);assert.equal(photo.sessionId,0);assert.equal(photo.mimeType,'image/png');assert.equal(read(dir,photo.id).base64,original.toString('base64'));assert.equal(read(dir,photo.id).sha256,hash(original));
 assert.equal(list(dir).photos.length,1);assert.deepEqual(list(dir,{sessionId:'0'}).photos,[]);assert.throws(()=>read(dir,photo.id,{rowId:'0'}),{code:'INVENTORY_PHOTO_BINDING'});assert.throws(()=>read(dir,photo.id,{sessionId:'0'}),{code:'INVENTORY_PHOTO_BINDING'});
 const same=await upload(dir,[file('image with unknown extension.bin',original)]);assert.equal(same.replayed,true);assert.equal(same.addedCount,0);assert.equal(same.uploaded[0].id,photo.id);
 const sameNewOperation=await upload(dir,[file('image with unknown extension.bin',original)],{operationId:'different-photo-operation'});assert.equal(sameNewOperation.addedCount,0);assert.equal(list(dir).photos.length,1);
 const otherRow=await upload(dir,[file('image with unknown extension.bin',original)],{rowId:'0',operationId:'string-row'});assert.notEqual(otherRow.uploaded[0].id,photo.id);assert.equal(otherRow.uploaded[0].rowId,'0');assert.equal(list(dir).photos.length,2);
 assert.deepEqual(storage.readSnapshot(dir),before,'Photo evidence changed saved count data or its revision');
 await assert.rejects(upload(dir,[file('other.png',image())],{rowId:'0'}),{code:'INVENTORY_PHOTO_OPERATION'});
});

test('photo decoding trusts raster bytes, rejects executable formats, invalid images and oversized dimensions',async t=>{
 const {dir}=fixture(t);for(const [index,mime]of ['image/jpeg','image/webp'].entries()){const result=await upload(dir,[file('renamed.png',image(mime))],{operationId:'raster-'+index});assert.equal(result.uploaded[0].mimeType,mime);}
 const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');const loaded=await upload(dir,[file('animated.dat',gif)],{operationId:'gif'});assert.equal(loaded.uploaded[0].mimeType,'image/gif');
 for(const [name,bytes]of [['fake.jpg',Buffer.from('MZ not a photograph')],['vector.png',Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>evil()</script></svg>')],['phone.heic',Buffer.from('0000ftypheic')]])await assert.rejects(upload(dir,[file(name,bytes)],{operationId:'invalid-'+name}),{code:'INVENTORY_PHOTO_FORMAT'});
 const broken=Buffer.from(image());broken.fill(0,33,broken.length-12);await assert.rejects(upload(dir,[file('broken.png',broken)],{operationId:'broken'}),{code:'INVENTORY_PHOTO_IMAGE'});
 const huge=Buffer.from(image());huge.writeUInt32BE(15000,16);huge.writeUInt32BE(15000,20);await assert.rejects(upload(dir,[file('huge.png',huge)],{operationId:'huge'}),{code:'INVENTORY_PHOTO_DIMENSIONS'});assert.equal(list(dir).photos.length,3);
});

test('photo uploads enforce draft rows, role ceilings, token fences and principal revocation before publication',async t=>{
 const {root,dir}=fixture(t);await assert.rejects(upload(dir,undefined,{},viewer),{code:'ACCESS_DENIED'});assert.equal(fs.existsSync(path.join(dir,'inventory-photos')),false);
 const narrowed={...admin,accessPolicy:{version:1,grants:[{org:'Photo organization',site:{any:true}}]}};assert.throws(()=>list(dir,{},narrowed),{code:'ACCESS_DENIED'});
 await assert.rejects(upload(dir,undefined,{rowId:'missing'}),{code:'INVENTORY_PHOTO_ROW'});await assert.rejects(upload(dir,undefined,{sessionId:'missing'}),{code:'INVENTORY_PHOTO_SESSION'});await assert.rejects(upload(dir,undefined,{databaseToken:'stale'}),{code:'DATABASE_CHANGED'});
 let checks=0;await assert.rejects(upload(dir,undefined,{},admin,{getPrincipal:()=>++checks>2?viewer:admin}),{code:'ACCESS_DENIED'});assert.equal(list(dir).photos.length,0);
 const saved=await upload(dir);let db=storage.readAll(dir),session=db.inventorySessions.find(value=>value.id===0);db=action(db,{action:'saveDraft',sessionId:0,payload:{date:session.date,title:session.title,note:'Synthetic inspected count',commission:{chairman:{name:'Synthetic chairman',position:'Synthetic post'},members:[]},facts:session.rows.map(row=>({rowId:row.id,qtyFact:row.qtyAcct,costFact:row.costAcct,action:'',note:''}))},reason:'Synthetic observed quantities'},'count');db=action(db,{action:'approve',sessionId:0,date:'2026-10-26',document:'Synthetic approval with existing photo evidence',reason:'Synthetic approved count'},'approve');
 const revisions=storage.readRevisions(dir);sqlite.transaction(dir,()=>sqlite.commitSections(dir,{inventorySessions:db.inventorySessions},{...revisions,inventorySessions:revisions.inventorySessions+1}));const approved=structuredClone(storage.readSnapshot(dir));
 assert.equal(list(dir,{},viewer).photos.length,1);assert.equal(read(dir,saved.uploaded[0].id,{},viewer).sha256,saved.uploaded[0].sha256);await assert.rejects(upload(dir,undefined,{operationId:'after-approval'}),{code:'INVENTORY_PHOTO_APPROVED'});assert.deepEqual(storage.readSnapshot(dir),approved,'Viewing approved evidence changed its frozen count');
 const archive=path.join(root,'approved-photo.zip'),restored=path.join(root,'approved-restored');backup.createPackage({sourceDir:dir,archivePath:archive});backup.restorePackage({archivePath:archive,targetDir:restored,protectedDir:dir});assert.deepEqual(storage.readSnapshot(restored).data.inventorySessions,approved.data.inventorySessions);assert.equal(read(restored,saved.uploaded[0].id,{},viewer).sha256,saved.uploaded[0].sha256);
});

test('photo backup and restore retain exact originals and row associations while detecting corruption',async t=>{
 const {root,dir}=fixture(t),saved=await upload(dir),photo=saved.uploaded[0],archive=path.join(root,'photos.zip');const created=backup.createPackage({sourceDir:dir,archivePath:archive});assert.equal(created.ok,true);const restored=path.join(root,'restored');backup.restorePackage({archivePath:archive,targetDir:restored,protectedDir:dir});assert.equal(list(restored).photos[0].id,photo.id);assert.equal(read(restored,photo.id).sha256,photo.sha256);assert.equal(read(restored,photo.id).base64,read(dir,photo.id).base64);
 fs.writeFileSync(path.join(dir,'inventory-photos','blob-'+photo.sha256+'.bin'),'CORRUPTED');assert.throws(()=>list(dir),{code:'INVENTORY_PHOTO_CORRUPT'});assert.throws(()=>backup.createPackage({sourceDir:dir,archivePath:path.join(root,'corrupt.zip')}),{code:'INVENTORY_PHOTO_CORRUPT'});
});

test('lost photo acknowledgement retries exactly one association and backup failures report a saved original honestly',async t=>{
 const {dir}=fixture(t),committed=()=>fs.existsSync(path.join(dir,'inventory-photos'))&&fs.readdirSync(path.join(dir,'inventory-photos')).some(name=>name.startsWith('batch-'));
 await assert.rejects(upload(dir,undefined,{},admin,{getPrincipal:()=>committed()?viewer:admin}),error=>error.unknown===true&&error.definitive===false);assert.equal(list(dir).photos.length,1);const retry=await upload(dir);assert.equal(retry.replayed,true);assert.equal(retry.addedCount,0);assert.equal(list(dir).photos.length,1);
 const original=storage.makeDailyBackup;storage.makeDailyBackup=()=>{throw Error('synthetic backup unavailable');};try{const saved=await upload(dir,[file('second.png',image())],{operationId:'backup-warning'});assert.equal(saved.ok,true);assert.equal(saved.warnings[0].code,'INVENTORY_PHOTO_BACKUP');assert.equal(list(dir).photos.length,2);}finally{storage.makeDailyBackup=original;}
});

test('inventory parent facade fences photo evidence and never writes its main fleet database',async t=>{
 const {root}=fixture(t),parent=path.join(root,'main');sqlite.create(parent,{data:data()});const parentDatabaseToken=storage.databaseToken(parent),before=storage.readSnapshot(parent),snapshot=await inventory.handle(parent,{action:'snapshot',parentDatabaseToken},admin),call=(action,request)=>inventory.handle(parent,{action,parentDatabaseToken,request:{databaseToken:snapshot.databaseToken,...request}},admin);
 const result=await call('photosUpload',{sessionId:0,rowId:'0',files:[file('facade.png',image())],operationId:'facade-photo'});assert.equal(result.addedCount,1);assert.equal((await call('photosList',{sessionId:0})).photos[0].rowId,'0');assert.equal((await call('photoRead',{sessionId:0,rowId:'0',id:result.uploaded[0].id})).mimeType,'image/png');assert.deepEqual(storage.readSnapshot(parent),before);await assert.rejects(inventory.handle(parent,{action:'photosList',parentDatabaseToken:'stale',request:{databaseToken:snapshot.databaseToken,sessionId:0}},admin),{code:'DATABASE_CHANGED'});
});

test('opening a restored inventory backup as a profile seeds all original documents and typed row photos into its child store',async t=>{
 const {root,dir}=fixture(t),documents=require('../electron/inventory-documents.cjs'),saved=await upload(dir),photo=saved.uploaded[0],original=Buffer.from('Synthetic retained inventory source document');
 const document=await documents.upload(dir,{databaseToken:storage.databaseToken(dir),files:[file('original-source.bin',original)],operationId:'restored-source-document'},admin),archive=path.join(root,'inventory-with-evidence.zip');backup.createPackage({sourceDir:dir,archivePath:archive});
 const restored=path.join(root,'restored-profile');backup.restorePackage({archivePath:archive,targetDir:restored,protectedDir:dir});const before=storage.readSnapshot(restored),parentToken=before.databaseToken;
 const snapshot=await inventory.handle(restored,{action:'snapshot',parentDatabaseToken:parentToken},admin),call=(action,request)=>inventory.handle(restored,{action,parentDatabaseToken:parentToken,request:{databaseToken:snapshot.databaseToken,...request}},admin);
 assert.notEqual(snapshot.databaseToken,parentToken);assert.equal((await call('photosList',{sessionId:0})).photos[0].id,photo.id);assert.equal((await call('photoRead',{sessionId:0,rowId:0,id:photo.id})).base64,read(dir,photo.id).base64);
 assert.equal((await call('documentsList',{})).documents[0].id,document.uploaded[0].id);assert.equal((await call('documentRead',{id:document.uploaded[0].id})).base64,original.toString('base64'));assert.deepEqual(storage.readSnapshot(restored),before);
 const child=inventory.directory(restored),childArchive=path.join(root,'child-copy.zip');assert.equal(backup.createPackage({sourceDir:child,archivePath:childArchive}).ok,true);assert.equal(backup.verifyPackage({archivePath:childArchive}).ok,true);
});
