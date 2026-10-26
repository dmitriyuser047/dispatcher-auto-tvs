'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),AdmZip=require('adm-zip');
const documents=require('../electron/inventory-documents.cjs'),inventory=require('../electron/inventory-database.cjs'),storage=require('../electron/storage'),sqlite=require('../electron/sqlite-storage.cjs'),backup=require('../electron/backup-service.cjs');
const admin={id:'document-admin',role:'admin',name:'Synthetic document administrator'},viewer={id:'document-viewer',role:'viewer'},hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(t){const parent=fs.realpathSync.native(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'tvs-inventory-documents-')),pin=fs.lstatSync(root),dir=path.join(root,'db');sqlite.create(dir,{data:{}});t.after(()=>{const info=fs.lstatSync(root);assert.equal(path.dirname(root),parent);assert.match(path.basename(root),/^tvs-inventory-documents-/);assert.equal(info.isSymbolicLink(),false);assert.equal(info.dev,pin.dev);assert.equal(info.ino,pin.ino);fs.rmSync(root,{recursive:true,force:true});});return {root,dir};}
const file=(name,bytes)=>({name,base64:Buffer.from(bytes).toString('base64')});
const upload=(dir,files,id='synthetic-upload',user=admin,options={})=>documents.upload(dir,{databaseToken:storage.databaseToken(dir),files,operationId:id},user,options);
const list=(dir,user=admin)=>documents.list(dir,{databaseToken:storage.databaseToken(dir)},user);
const read=(dir,id,user=admin)=>documents.read(dir,{databaseToken:storage.databaseToken(dir),id},user);
test('every original is saved without converting orders, scans, unknown extensions or empty files into inventory',async t=>{
 const {dir}=fixture(t),before=storage.readSnapshot(dir),items=[file('приказ.xlsx','SYNTHETIC ORDER'),file('акт списания.pdf','%PDF-synthetic-scan'),file('unknown.exe',[0,1,2,3]),file('README',[])];
 const result=await upload(dir,items);assert.equal(result.ok,true);assert.equal(result.addedCount,4);assert.equal(result.reusedCount,0);assert.equal(result.uploaded.length,4);assert.deepEqual(result.uploaded.map(d=>d.kind),['order','act','other','other']);
 assert.deepEqual(storage.readSnapshot(dir),before);assert.equal(list(dir).documents.length,4);assert.equal(list(dir,viewer).documents.length,4);
 for(let index=0;index<items.length;index++){const document=result.uploaded[index],original=read(dir,document.id);assert.equal(original.base64,items[index].base64);assert.equal(original.sha256,hash(Buffer.from(items[index].base64,'base64')));assert.equal(original.name,items[index].name);}
 const repeated=await upload(dir,items);assert.equal(repeated.replayed,true);assert.equal(repeated.addedCount,0);assert.equal(repeated.reusedCount,4);assert.deepEqual(repeated.uploaded.map(d=>d.id),result.uploaded.map(d=>d.id));
 const otherOperation=await upload(dir,items,'second-operation');assert.equal(otherOperation.addedCount,0);assert.equal(list(dir).documents.length,4);
 await assert.rejects(upload(dir,[file('other.pdf','DIFFERENT')],'synthetic-upload'),{code:'INVENTORY_DOCUMENT_OPERATION'});
 const backupName=fs.readdirSync(path.join(dir,'backups')).find(name=>/^data_.*\.zip$/.test(name));assert.ok(backupName);assert.ok(backup.verifyPackage({archivePath:path.join(dir,'backups',backupName)}).fileCount>4);
});
test('archive upload keeps original container and every member with original paths and safe deduplication',async t=>{
 const {dir}=fixture(t),zip=new AdmZip();zip.addFile('КП3/Сличительная ведомость.xls',Buffer.from('SYNTHETIC INVENTORY'));zip.addFile('Приказы/приказ.xlsx',Buffer.from('SYNTHETIC ORDER'));zip.addFile('КП3/акт.pdf',Buffer.from('%PDF-synthetic'));zip.addFile('other/empty',Buffer.alloc(0));
 const raw=zip.toBuffer(),result=await upload(dir,[file('documents.zip',raw)]);assert.equal(result.uploaded.length,5);assert.equal(result.addedCount,5);assert.equal(result.uploaded[0].kind,'archive');assert.ok(result.uploaded.some(doc=>doc.path==='documents.zip/КП3/Сличительная ведомость.xls'&&doc.container==='documents.zip'));
 const restored=read(dir,result.uploaded[0].id);assert.equal(restored.base64,raw.toString('base64'));for(const doc of result.uploaded)assert.equal(read(dir,doc.id).sha256,doc.sha256);
 const second=await upload(dir,[file('documents.zip',raw)],'new-intent');assert.equal(second.addedCount,0);assert.equal(second.reusedCount,5);assert.equal(list(dir).documents.length,5);
 const broken=new AdmZip();broken.addFile('safe.txt',Buffer.from('safe'));const traversal=Buffer.from(broken.toBuffer());let offset=0;while((offset=traversal.indexOf('safe.txt',offset,'utf8'))>=0){traversal.write('../x.txt',offset,'utf8');offset+=8;}
 await assert.rejects(upload(dir,[file('unsafe.zip',traversal)],'unsafe'),error=>error.code==='ARCHIVE_PATH');assert.equal(list(dir).documents.length,5);
 await assert.rejects(upload(dir,[file('bad.rar','NOT RAR')],'bad-rar'));assert.equal(list(dir).documents.length,5);
});
test('nested archives keep their container originals and files without selecting types',async t=>{
 const {dir}=fixture(t),inner=new AdmZip();inner.addFile('unknown.dat',Buffer.from('nested bytes'));const outer=new AdmZip();outer.addFile('folder/inside.zip',inner.toBuffer());outer.addFile('outside.csv',Buffer.from('name,qty\npart,0'));
 const result=await upload(dir,[file('outer.zip',outer.toBuffer())]);assert.equal(result.uploaded.length,4);assert.ok(result.uploaded.some(doc=>doc.path==='outer.zip/folder/inside.zip/unknown.dat'));assert.equal(result.uploaded.filter(doc=>doc.kind==='archive').length,2);
});
test('inventory original registry follows read/write ceilings, stale tokens and async principal revocation',async t=>{
 const {dir}=fixture(t);await assert.rejects(upload(dir,[file('a.pdf','bytes')],'viewer',viewer),{code:'ACCESS_DENIED'});assert.equal(fs.existsSync(path.join(dir,'inventory-documents')),false);
 const narrowed={...admin,accessPolicy:{version:1,grants:[{org:'only organisation',site:{any:true}}]}};assert.throws(()=>list(dir,narrowed),{code:'ACCESS_DENIED'});
 await assert.rejects(documents.upload(dir,{databaseToken:'stale',files:[file('a.pdf','bytes')],operationId:'stale'},admin),{code:'DATABASE_CHANGED'});
 let checks=0;await assert.rejects(upload(dir,[file('a.pdf','bytes')],'revoked',admin,{getPrincipal:()=>++checks>2?viewer:admin}),{code:'ACCESS_DENIED'});assert.equal(list(dir).documents.length,0);
 await assert.rejects(upload(dir,[{name:'bad.pdf',base64:'ab=c'}],'invalid-base64'),{code:'INVENTORY_DOCUMENT_BYTES'});assert.equal(list(dir).documents.length,0);
});
test('a revoked acknowledgement retains one committed upload for exact retry and backup failures remain honest',async t=>{
 const {dir}=fixture(t),items=[file('retained.pdf','SYNTHETIC ORIGINAL')];
 const committed=()=>fs.existsSync(path.join(dir,'inventory-documents'))&&fs.readdirSync(path.join(dir,'inventory-documents')).some(name=>name.startsWith('batch-'));
 await assert.rejects(upload(dir,items,'lost-ack',admin,{getPrincipal:()=>committed()?viewer:admin}),error=>error.unknown===true&&error.definitive===false);
 assert.equal(list(dir).documents.length,1);const retried=await upload(dir,items,'lost-ack');assert.equal(retried.replayed,true);assert.equal(retried.addedCount,0);assert.equal(list(dir).documents.length,1);
 const originalBackup=storage.makeDailyBackup;storage.makeDailyBackup=()=>{throw Error('Synthetic unavailable backup disk');};
 try{const saved=await upload(dir,[file('second.pdf','SECOND ORIGINAL')],'backup-unavailable');assert.equal(saved.ok,true);assert.equal(saved.addedCount,1);assert.equal(saved.warnings[0].code,'INVENTORY_DOCUMENT_BACKUP');assert.equal(list(dir).documents.length,2);}finally{storage.makeDailyBackup=originalBackup;}
});
test('backups retain registry originals and manifests, restore reads verified bytes, and reject corruption',async t=>{
 const {root,dir}=fixture(t),bytes=Buffer.from('%PDF-verified-original'),result=await upload(dir,[file('акт.pdf',bytes)]),id=result.uploaded[0].id,archive=path.join(root,'backup.zip');
 const created=backup.createPackage({sourceDir:dir,archivePath:archive});assert.equal(created.ok,true);const restored=path.join(root,'restored');backup.restorePackage({archivePath:archive,targetDir:restored,protectedDir:dir});assert.equal(list(restored).documents[0].id,id);assert.equal(read(restored,id).base64,bytes.toString('base64'));
 const originalPath=path.join(dir,'inventory-documents','blob-'+hash(bytes)+'.bin');fs.writeFileSync(originalPath,'CORRUPTED');assert.throws(()=>list(dir),{code:'INVENTORY_DOCUMENT_CORRUPT'});assert.throws(()=>backup.createPackage({sourceDir:dir,archivePath:path.join(root,'corrupt-backup.zip')}),{code:'INVENTORY_DOCUMENT_CORRUPT'});
});
test('parent facade fences originals independently while preserving main data and selected profile',async t=>{
 const {root}=fixture(t),parent=path.join(root,'main');storage.createJson(parent,{data:{vehicles:[{id:'fleet',plate:'KEEP'}]}});const token=storage.databaseToken(parent),before=storage.readSnapshot(parent),snapshot=await inventory.handle(parent,{action:'snapshot',parentDatabaseToken:token},admin);
 const call=(action,request)=>inventory.handle(parent,{action,parentDatabaseToken:token,request:{databaseToken:snapshot.databaseToken,...request}},admin);
 const saved=await call('documentsUpload',{files:[file('anything.bin',[7,8,9])],operationId:'facade'});assert.equal(saved.addedCount,1);assert.equal((await call('documentsList',{})).documents.length,1);assert.equal((await call('documentRead',{id:saved.uploaded[0].id})).base64,file('anything.bin',[7,8,9]).base64);assert.deepEqual(storage.readSnapshot(parent),before);
 await assert.rejects(inventory.handle(parent,{action:'documentsList',parentDatabaseToken:'wrong',request:{databaseToken:snapshot.databaseToken}},admin),{code:'DATABASE_CHANGED'});
});
