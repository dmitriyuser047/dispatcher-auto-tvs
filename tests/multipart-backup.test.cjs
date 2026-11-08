'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),Zip=require('adm-zip');
const {spawnSync}=require('node:child_process');
const storage=require('../electron/storage.js'),sqlite=require('../electron/sqlite-storage.cjs'),ledger=require('../electron/operation-ledger.cjs'),store=require('../electron/operation-store.cjs'),format=require('../electron/storage-format.cjs'),multipart=require('../electron/multipart-backup.cjs'),backup=require('../electron/backup-service.cjs');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex'),copy=value=>JSON.parse(JSON.stringify(value)),principal={id:'multipart-author',name:'Synthetic author',role:'admin'};
function temporary(t){const parent=fs.realpathSync.native(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'tvs-multipart-test-')),pin=fs.lstatSync(root);t.after(()=>{assert.equal(path.dirname(root),parent);assert.match(path.basename(root),/^tvs-multipart-test-/);const current=fs.lstatSync(root);assert.equal(current.isSymbolicLink(),false);assert.equal(current.dev,pin.dev);assert.equal(current.ino,pin.ino);fs.rmSync(root,{recursive:true,force:true});});return root;}
function fixture(t,{kind='json',padding=0,count=2}={}){
 const root=temporary(t),dir=path.join(root,'source'),objects=new Map(),api=ledger.createOperationLedger({readObject:id=>objects.get(id),cursorKey:Buffer.alloc(32)});let head=api.genesis();const events=[];
 for(let n=0;n<count;n++){const operation={id:'multipart-'+n,digest:'sha256:'+sha('literal intent '+n),actorId:principal.id,actorRole:principal.role,databaseToken:'literal-original-token'},event={section:'vehicles',before:null,after:{id:n%2?'0':0,note:'Literal event '+n}},plan=api.prepareAppend({head,receipt:{operation,at:'2026-11-08T09:00:00.000Z',changedSections:['vehicles'],revisions:{vehicles:n+1},result:{number:n}},auditEntries:[event],accessProof:{version:1,status:'verified',requiredSections:['vehicles'],subjects:[],request:{selectedTargets:[],operation,padding:'x'.repeat(padding)}}});for(const object of plan.objects)objects.set(object.id,object.json);head=plan.head;events.push(event);}
 const data=Object.fromEntries(storage.SECTIONS.map(name=>[name,[]]));data.vehicles=[{id:0,plate:'NUMERIC ZERO',fuelBalance:923.537},{id:'0',plate:'STRING ZERO',fuelBalance:0}];data.records=[{id:0,vehicleId:0,date:'2026-09-01',km:0,fuelActual:0.001}];data.auditLog=events;const revisions=Object.fromEntries(storage.SECTIONS.map(name=>[name,7])),operationState=format.createOperationState(head);
 (kind==='sqlite'?sqlite.create:storage.createJson)(dir,{data,revisions,operationState,operationProvider:{readObject:id=>objects.get(id)}});
 fs.mkdirSync(path.join(dir,'migration-history'));const document=Buffer.from('{"literal":"prior migration report","unchanged":true}');fs.writeFileSync(path.join(dir,'migration-history','prior.json'),document);
 const capturePath=path.join(root,'checkpoint.json'),archivePath=path.join(root,'backup.zip');storage.withDatabaseLock(dir,physical=>multipart.capture(physical,capturePath,{settings:{theme:'synthetic'}}));return{root,dir,kind,api,head,data,revisions,operationState,objects,document,capturePath,archivePath};
}
function create(f,options={}){const result=multipart.createFromCapture({sourceDir:f.dir,capturePath:f.capturePath,archivePath:f.archivePath,partBytes:8*1024*1024,...options});assert.equal(result.ok,true);return result;}
function manifest(f){return JSON.parse(new Zip(f.archivePath).getEntry('manifest.json').getData());}
function writeManifest(f,m){const zip=new Zip();zip.addFile('manifest.json',Buffer.from(JSON.stringify(m)));fs.writeFileSync(f.archivePath,zip.toBuffer());}
function rewritePart(f,index,mutate,alterManifest=()=>{}){const m=manifest(f),p=m.parts[index],directory=path.join(f.root,m.partsDirectory),oldFile=path.join(directory,p.name),zip=new Zip(oldFile);mutate(zip);const bytes=zip.toBuffer(),digest=sha(bytes),entries=zip.getEntries();p.name='part-'+String(index).padStart(8,'0')+'-'+digest+'.zip';p.sha256=digest;p.size=bytes.length;p.entries=entries.length;p.rawBytes=entries.reduce((sum,e)=>sum+e.getData().length,0);fs.unlinkSync(oldFile);fs.writeFileSync(path.join(directory,p.name),bytes);alterManifest(m);writeManifest(f,m);}
function failure(action){assert.throws(action,error=>/^(BACKUP_|SAFE_FILE_|ARCHIVE_|LEDGER_|OPERATION_|ENOENT)/.test(error.code||''));}

for(const kind of ['json','sqlite'])test(kind+' multipart checkpoint publishes bounded verified parts and exact immutable history',t=>{
 const f=fixture(t,{kind,padding:4*1024*1024,count:3}),result=create(f),m=manifest(f);assert.equal(result.version,4);assert.ok(m.parts.length>=3);assert.ok(m.parts.every(part=>part.rawBytes<=8*1024*1024&&part.entries<=1000));assert.equal(multipart.probe(f.archivePath),true);assert.equal(multipart.verifyPackage({archivePath:f.archivePath}).ok,true);
 const reader=multipart.openPackage(f.archivePath);try{reader.verify();assert.deepEqual(reader.data,f.data);assert.deepEqual(reader.revisions,f.revisions);assert.deepEqual(reader.operationState,f.operationState);assert.deepEqual(reader.readFile('migration-history/prior.json'),f.document);const received=new Map();store.verifyProvider({operationState:reader.operationState,readObject:reader.readObject,hotRows:reader.data.auditLog},object=>received.set(object.id,object.json));assert.deepEqual([...received].sort(([a],[b])=>a.localeCompare(b)),f.api.exportClosure(f.head).objects.map(object=>[object.id,object.json]));}finally{reader.close();}
});

for(const sourceFormat of ['json','sqlite'])for(const targetFormat of ['json','sqlite'])test(sourceFormat+' multipart restore to '+targetFormat+' preserves exact data, revisions, receipts and managed bytes',t=>{
 const f=fixture(t,{kind:sourceFormat});create(f);const targetDir=path.join(f.root,'restored'),result=backup.restorePackage({archivePath:f.archivePath,targetDir,format:targetFormat,protectedDir:f.dir}),actual=storage.readSnapshot(targetDir);assert.equal(result.restoredFormat,targetFormat);assert.deepEqual(actual.data,f.data);assert.deepEqual(actual.revisions,f.revisions);assert.deepEqual(store.readState(targetDir),f.operationState);assert.notEqual(actual.databaseToken,storage.databaseToken(f.dir));assert.deepEqual(fs.readFileSync(path.join(targetDir,'migration-history','prior.json')),f.document);assert.deepEqual(store.exportClosure(targetDir),f.api.exportClosure(f.head));for(let n=0;n<2;n++)assert.equal(store.engine(targetDir).inspectReceipt(f.head,'multipart-'+n).receipt.operation.databaseToken,'literal-original-token');
});

for(const kind of ['json','sqlite'])test(kind+' later genuine saves do not change an already captured head or snapshot',t=>{
 const f=fixture(t,{kind}),before=storage.readSnapshot(f.dir),saved=storage.writeSections(f.dir,{databaseToken:before.databaseToken,base:before.revisions,sections:{vehicles:before.data.vehicles.map(row=>({...row,note:'Later saved edit'}))},operation:{id:'later-operation'}},{principal});assert.equal(saved.ok,true);fs.writeFileSync(path.join(f.dir,'migration-history','newer.json'),'newer');assert.notDeepEqual(store.readState(f.dir),f.operationState);create(f);const reader=multipart.openPackage(f.archivePath);try{reader.verify();assert.deepEqual(reader.data,f.data);assert.deepEqual(reader.operationState,f.operationState);assert.equal(reader.files.some(file=>file.name==='migration-history/newer.json'),false);assert.equal(store.readState(f.dir).head.lastSeq>reader.operationState.head.lastSeq,true);}finally{reader.close();}
});

for(const journalMode of ['WAL','DELETE','PERSIST'])test('SQLite '+journalMode+' packing does not block a concurrent genuine save',t=>{
 const f=fixture(t,{kind:'sqlite',padding:4*1024*1024,count:3}),original=fs.openSync,program=String.raw`const storage=require(process.argv[1]),dir=process.argv[2],snapshot=storage.readSnapshot(dir),saved=storage.writeSections(dir,{databaseToken:snapshot.databaseToken,base:snapshot.revisions,sections:{vehicles:snapshot.data.vehicles.map(row=>({...row,note:'Concurrent saved change'}))},operation:{id:'concurrent-during-backup'}},{principal:{id:'multipart-author',name:'Synthetic author',role:'admin'}});if(!saved.ok)throw Error(JSON.stringify(saved));process.stdout.write('committed');`;let child=null;
 const native=new (require('node:sqlite').DatabaseSync)(sqlite.filename(f.dir));try{assert.equal(native.prepare('PRAGMA journal_mode='+journalMode).get().journal_mode,journalMode.toLowerCase());}finally{native.close();}
 // Trigger a separate writer when a packed history part is first published to
 // the private staging directory, inside the real graph-walk call stack.
 fs.openSync=function(file,...args){if(!child&&typeof file==='string'&&path.basename(path.dirname(file)).startsWith('.tvs-backup-parts-')&&/^part-\d{8}-[a-f0-9]{64}\.zip$/.test(path.basename(file)))child=spawnSync(process.execPath,['-e',program,require.resolve('../electron/storage.js'),f.dir],{encoding:'utf8',timeout:15000,windowsHide:true,maxBuffer:1024*1024});return original.call(fs,file,...args);};
 try{create(f);}finally{fs.openSync=original;}
 assert.ok(child,'The real multipart writer must flush a history part');assert.equal(child.status,0,child.stderr||child.error?.message);assert.equal(child.stdout,'committed');assert.equal(storage.readAll(f.dir).vehicles[0].note,'Concurrent saved change');const reader=multipart.openPackage(f.archivePath);try{reader.verify();assert.deepEqual(reader.data,f.data);assert.deepEqual(reader.operationState,f.operationState);}finally{reader.close();}
});

test('creation requires a captured lock and refuses changed managed files or an existing target',t=>{
 const f=fixture(t);assert.throws(()=>multipart.capture(f.dir,path.join(f.root,'unlocked.json')),{code:'BACKUP_LOCK_REQUIRED'});fs.writeFileSync(path.join(f.dir,'migration-history','prior.json'),'changed');assert.throws(()=>create(f),{code:'BACKUP_SOURCE_CHANGED'});assert.equal(fs.existsSync(f.archivePath),false);
 const other=fixture(t);create(other);assert.throws(()=>create(other),{code:'BACKUP_TARGET_EXISTS'});
});

test('missing or modified parts never verify or publish a restored database',t=>{
 for(const type of ['missing','tampered','extra']){const f=fixture(t);create(f);const m=manifest(f),directory=path.join(f.root,m.partsDirectory),file=path.join(directory,m.parts[0].name);if(type==='missing')fs.unlinkSync(file);else if(type==='tampered')fs.appendFileSync(file,'changed');else fs.writeFileSync(path.join(directory,'unexpected.zip'),'extra');failure(()=>multipart.verifyPackage({archivePath:f.archivePath}));const targetDir=path.join(f.root,'must-not-exist');failure(()=>backup.restorePackage({archivePath:f.archivePath,targetDir}));assert.equal(fs.existsSync(targetDir),false);}
});

test('valid ZIP hashes cannot hide changed or missing history objects or an unreachable object',t=>{
 for(const type of ['changed','missing','extra']){const f=fixture(t);create(f);rewritePart(f,0,zip=>{const entry=zip.getEntries().find(entry=>entry.entryName.startsWith('objects/'));assert.ok(entry);if(type==='changed')zip.updateFile(entry.entryName,Buffer.from('{}'));else if(type==='missing')zip.deleteFile(entry.entryName);else{const bytes=Buffer.from('{"unexpected":"history object"}');zip.addFile('objects/'+sha(bytes)+'.json',bytes);}},m=>{if(type==='missing')m.historyObjects--;if(type==='extra')m.historyObjects++;});failure(()=>multipart.verifyPackage({archivePath:f.archivePath}));}
});

test('every managed file is verified even when it is not referenced by a current database row',t=>{
 for(const type of ['digest','missing-chunk']){const f=fixture(t);create(f);let m=manifest(f),file=m.files.find(file=>file.name==='migration-history/prior.json');assert.ok(file);if(type==='digest'){file.sha256='0'.repeat(64);writeManifest(f,m);}else{const chunk=copy(file.chunks[0]);rewritePart(f,chunk.part,zip=>zip.deleteFile(chunk.entry));}assert.throws(()=>multipart.verifyPackage({archivePath:f.archivePath}),error=>['BACKUP_HASH','BACKUP_FILE_MISSING','BACKUP_MANIFEST'].includes(error.code));}
});

test('current schema backups require complete sections, complete revisions and an established source format',t=>{
 for(const type of ['missing-section','missing-revision','source-format']){const f=fixture(t);create(f);const m=manifest(f);if(type==='missing-section'){const file=m.files.find(file=>file.name==='database.json'),chunk=file.chunks[0],data=copy(f.data);assert.equal(file.chunks.length,1);delete data.inventoryItems;const bytes=Buffer.from(JSON.stringify(data));rewritePart(f,chunk.part,zip=>zip.updateFile(chunk.entry,bytes),changed=>{const file=changed.files.find(file=>file.name==='database.json');file.size=bytes.length;file.sha256=sha(bytes);file.chunks[0].size=bytes.length;});}else{if(type==='missing-revision')delete m.revisions.inventoryItems;else m.sourceFormat='unknown-executable-format';writeManifest(f,m);}assert.throws(()=>multipart.verifyPackage({archivePath:f.archivePath}),error=>/^BACKUP_/.test(error.code||''));}
});

test('settings must remain a plain safe JSON object rather than an array or unsafe property graph',t=>{
 for(const raw of ['[]','{"__proto__":{"unexpected":true}}']){const f=fixture(t);create(f);const m=manifest(f),file=m.files.find(file=>file.name==='settings.json'),chunk=file.chunks[0],bytes=Buffer.from(raw);rewritePart(f,chunk.part,zip=>zip.updateFile(chunk.entry,bytes),changed=>{const file=changed.files.find(file=>file.name==='settings.json');file.size=bytes.length;file.sha256=sha(bytes);file.chunks[0].size=bytes.length;});assert.throws(()=>multipart.verifyPackage({archivePath:f.archivePath}),error=>/^(BACKUP_|INVALID_JSON$)/.test(error.code||''));}
});

test('unsafe file, part and directory names are rejected without leaking a reader work directory',t=>{
 const f=fixture(t);create(f);const original=manifest(f);for(const mutate of [m=>m.files[0].name='../escaped.json',m=>m.files[0].chunks[0].entry='../escaped.json',m=>m.parts[0].name='../escaped.zip',m=>m.partsDirectory='../outside']){const m=copy(original);mutate(m);writeManifest(f,m);const before=fs.readdirSync(fs.realpathSync.native(os.tmpdir())).filter(name=>name.startsWith('.tvs-backup-reader-')).sort();failure(()=>multipart.openPackage(f.archivePath));const after=fs.readdirSync(fs.realpathSync.native(os.tmpdir())).filter(name=>name.startsWith('.tvs-backup-reader-')).sort();assert.deepEqual(after,before);assert.equal(fs.existsSync(path.join(f.root,'escaped.json')),false);}
});

test('hard-linked parts and a linked parts directory are rejected',t=>{
 const f=fixture(t);create(f);const m=manifest(f),directory=path.join(f.root,m.partsDirectory),part=path.join(directory,m.parts[0].name),external=path.join(f.root,'external.zip');fs.linkSync(part,external);failure(()=>multipart.verifyPackage({archivePath:f.archivePath}));fs.unlinkSync(external);
 const real=path.join(f.root,'real-parts');fs.renameSync(directory,real);fs.symlinkSync(real,directory,process.platform==='win32'?'junction':'dir');failure(()=>multipart.verifyPackage({archivePath:f.archivePath}));fs.unlinkSync(directory);fs.renameSync(real,directory);
});

test('a previously opened reader detects replacement of its package before restoration',t=>{
 const f=fixture(t);create(f);const reader=multipart.openPackage(f.archivePath);try{fs.appendFileSync(f.archivePath,'changed after review');assert.throws(()=>reader.assertCurrent(),{code:'BACKUP_SOURCE_CHANGED'});}finally{reader.close();}
});

test('a false small ZIP size cannot bypass the bounded index inflater',t=>{
 const f=fixture(t);create(f);const m=manifest(f);m.padding='x'.repeat(9*1024*1024);const zip=new Zip();zip.addFile('manifest.json',Buffer.from(JSON.stringify(m)));const bytes=zip.toBuffer();
 // Both advertised sizes lie, while the actual deflate stream remains larger
 // than the index budget. It must be stopped during inflation, before JSON.
 for(let offset=0;offset<bytes.length-46;offset++){const signature=bytes.readUInt32LE(offset);if(signature===0x04034b50)bytes.writeUInt32LE(64,offset+22);else if(signature===0x02014b50)bytes.writeUInt32LE(64,offset+24);}
 fs.writeFileSync(f.archivePath,bytes);assert.equal(multipart.probe(f.archivePath),false);assert.throws(()=>multipart.openPackage(f.archivePath),error=>['BACKUP_MANIFEST','BACKUP_LIMIT','BACKUP_ARCHIVE','ARCHIVE_LIMIT','ARCHIVE_INVALID'].includes(error.code));
});

test('more than512MiB of immutable history backs up and restores with bounded parts under a128MiB heap',()=>{
 const program=String.raw`
 const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),repo=process.argv[1],storage=require(path.join(repo,'electron/storage.js')),sqlite=require(path.join(repo,'electron/sqlite-storage.cjs')),multipart=require(path.join(repo,'electron/multipart-backup.cjs')),backup=require(path.join(repo,'electron/backup-service.cjs')),store=require(path.join(repo,'electron/operation-store.cjs')),makeProvider=require(path.join(repo,'tests/helpers/operation-stream-fixture.cjs')).makeProvider;
 const parent=fs.realpathSync.native(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'tvs-large-multipart-'));
 try{
  const provider=makeProvider(),sourceDir=path.join(root,'source'),data=Object.fromEntries(storage.SECTIONS.map(name=>[name,[]]));sqlite.create(sourceDir,{data,operationState:provider.operationState,operationProvider:{readObject:provider.readObject}});const sourceBytes=fs.statSync(sqlite.filename(sourceDir)).size;assert.ok(sourceBytes>512*1024*1024);
  const capturePath=path.join(root,'checkpoint.json'),archivePath=path.join(root,'backup.zip');storage.withDatabaseLock(sourceDir,pin=>multipart.capture(pin,capturePath));const made=multipart.createFromCapture({sourceDir,capturePath,archivePath,partBytes:8*1024*1024});assert.ok(made.parts>64);const report=multipart.verifyPackage({archivePath});assert.equal(report.ok,true);assert.equal(report.version,4);
  const targetDir=path.join(root,'restored');backup.restorePackage({archivePath,targetDir,format:'sqlite',protectedDir:sourceDir});const summary=store.walkClosure(targetDir,()=>{});assert.equal(summary.receipts,provider.expectedReceipts);assert.ok(summary.bytesVisited>512*1024*1024);assert.deepEqual(store.readState(targetDir),provider.operationState);assert.equal(sqlite.inspect(targetDir).ok,true);process.stdout.write(JSON.stringify({sourceBytes,parts:made.parts,bytesVisited:summary.bytesVisited,receipts:summary.receipts}));
 }finally{assert.equal(path.dirname(root),parent);assert.match(path.basename(root),/^tvs-large-multipart-/);assert.equal(fs.lstatSync(root).isSymbolicLink(),false);fs.rmSync(root,{recursive:true,force:true});}`;
 const child=spawnSync(process.execPath,['--max-old-space-size=128','-e',program,path.resolve(__dirname,'..')],{encoding:'utf8',timeout:240000,windowsHide:true,maxBuffer:1024*1024});assert.equal(child.status,0,child.stderr||child.error?.message);const result=JSON.parse(child.stdout);assert.ok(result.bytesVisited>512*1024*1024);assert.equal(result.receipts,86);
});
