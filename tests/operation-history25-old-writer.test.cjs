'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {frozen3,manifest}=require('./helpers/operation-history25-frozen3.cjs'),{currentFixture,tree,schema,removeEmptySqliteSidecars}=require('./helpers/schema-format-support.cjs');

test('previous actual schema3 fixture pins exact Git blob bytes and keeps the original four-feature descriptor',()=>{
 assert.equal(new Set(manifest.map(entry=>entry.commit)).size,1);assert.match(manifest[0].commit,/^d527ddf[0-9a-f]{33}$/);assert.deepEqual(manifest.map(entry=>entry.source).sort(),['electron/sqlite-storage.cjs','electron/storage-format.cjs','electron/storage.js']);const old=frozen3();assert.equal(old.format.SCHEMA_VERSION,3);assert.equal(old.format.describe(3).minWriter,3);assert.equal(old.format.describe(3).features.length,4);
});

test('actual previous schema3 JSON decoder, readers and writers reject current4 before loading business rows or creating service files',t=>{
 const f=currentFixture(t,'json'),before=tree(f.dir),old=frozen3(),revisions=JSON.parse(fs.readFileSync(path.join(f.dir,'sections/revisions.json'),'utf8'));assert.equal(revisions.schemaVersion,4);assert.throws(()=>old.format.decodeRevisions(revisions),{code:'STORAGE_FORMAT'});const read=fs.readFileSync;let businessReads=0;
 try{fs.readFileSync=function(filename){if(schema.sections.some(name=>path.resolve(String(filename))===path.resolve(f.dir,'sections',name+'.json')))businessReads++;return read.apply(this,arguments);};for(const action of [()=>old.storage.readAll(f.dir),()=>old.storage.readSnapshot(f.dir),()=>old.storage.readSection(f.dir,'vehicles'),()=>old.storage.writeAll(f.dir,f.data),()=>old.storage.writeSections(f.dir,{databaseToken:'untrusted-old-writer',base:f.revisions,sections:{vehicles:[]},operation:{id:'forbidden-schema3'}})])assert.throws(action,{code:'STORAGE_FORMAT'});}finally{fs.readFileSync=read;}
 assert.equal(businessReads,0);assert.deepEqual(tree(f.dir),before);assert.equal(fs.existsSync(path.join(f.dir,'.tvs-database.lock')),false);assert.equal(fs.existsSync(path.join(f.dir,'sections/.transaction.json')),false);
});

test('actual previous schema3 SQLite readers and writers reject the current4 header before opening any SQLite connection or producing sidecars',t=>{
 const f=currentFixture(t,'sqlite');removeEmptySqliteSidecars(f.dir);const before=tree(f.dir);let opened=0,businessReads=0;const old=frozen3({DatabaseSync:class{constructor(){opened++;throw Error('Forbidden old connection opened');}}}),read=fs.readFileSync;
 try{fs.readFileSync=function(filename){if(String(filename)===path.join(f.dir,'platform.sqlite'))businessReads++;return read.apply(this,arguments);};for(const action of [()=>old.sqlite.readAll(f.dir),()=>old.sqlite.readRows(f.dir,'vehicles'),()=>old.sqlite.readRevisions(f.dir),()=>old.sqlite.commitSections(f.dir,{vehicles:[]},f.revisions),()=>old.storage.readSnapshot(f.dir),()=>old.storage.writeAll(f.dir,f.data),()=>old.storage.writeSections(f.dir,{databaseToken:'untrusted-old-writer',base:f.revisions,sections:{vehicles:[]},operation:{id:'forbidden-schema3'}})])assert.throws(action,{code:'SQLITE_FUTURE_FORMAT'});}finally{fs.readFileSync=read;}
 assert.equal(opened,0);assert.equal(businessReads,0,'Header checks must not read the complete business container');assert.deepEqual(tree(f.dir),before);for(const name of ['platform.sqlite-wal','platform.sqlite-shm','platform.sqlite-journal','.tvs-database.lock'])assert.equal(fs.existsSync(path.join(f.dir,name)),false,name);
});
