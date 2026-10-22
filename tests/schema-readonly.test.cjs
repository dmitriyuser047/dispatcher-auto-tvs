'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
const {ROOT,storage,fixture,tree}=require('./helpers/schema-format-support.cjs'),query=require(path.join(ROOT,'electron/data-query.cjs'));
const admin={id:'schema22-admin',name:'Synthetic schema 22 administrator',role:'admin'};
for(const kind of ['json','sqlite'])test(kind+' genuine complete schema 2 is readable without identity/recovery/managed/WAL/SHM writes',t=>{
 const f=fixture(t,kind),before=tree(f.dir),snapshot=storage.readSnapshot(f.dir,{principal:admin});
 assert.equal(snapshot.platform.schemaVersion,2);assert.equal(snapshot.platform.readOnly,true);assert.equal(snapshot.platform.needsSchemaUpgrade,true);assert.equal(snapshot.platform.descriptor.schemaVersion,2);
 assert.deepEqual(snapshot.data,f.data);assert.deepEqual(snapshot.revisions,f.revisions);assert.equal(snapshot.data.documentDrafts[0].id,'frozen-draft');
 assert.deepEqual(storage.readAll(f.dir),f.data);assert.deepEqual(storage.readRevisions(f.dir),f.revisions);assert.deepEqual(storage.readSection(f.dir,'vehicles',{principal:admin}).rows,f.data.vehicles);assert.equal(query.queryRows(f.dir,{section:'records',limit:1},admin).rows[0].id,'frozen-record');
 assert.equal(storage.readOperation(f.dir,{id:'not-committed',digest:'sha256:'+'a'.repeat(64)},admin).operationReceipt,null);assert.deepEqual(tree(f.dir),before);
 if(kind==='json')assert.equal(fs.existsSync(path.join(f.dir,'database-identity.json')),false);
 for(const name of ['platform.sqlite-wal','platform.sqlite-shm','document-archive','attachments','import-sources','backups'])assert.equal(fs.existsSync(path.join(f.dir,name)),false,name);
});
test('schema 2 SQLite with missing identity stays readonly without inventing identity or source sidecars',t=>{
 const f=fixture(t,'sqlite'),database=path.join(f.dir,'platform.sqlite'),db=new DatabaseSync(database);try{db.exec("DELETE FROM metadata WHERE key IN('database_uuid','generation');PRAGMA wal_checkpoint(TRUNCATE);");}finally{db.close();}require('./helpers/schema-format-support.cjs').removeEmptySqliteSidecars(f.dir);const before=tree(f.dir),snapshot=storage.readSnapshot(f.dir);assert.equal(snapshot.platform.readOnly,true);assert.deepEqual(snapshot.data,f.data);assert.equal(require(path.join(ROOT,'electron/sqlite-storage.cjs')).readIdentity(f.dir),null);assert.deepEqual(tree(f.dir),before);
});
test('schema 2 interrupted JSON transaction is never recovered during a read or copy preview',t=>{
 const f=fixture(t,'json'),journal=path.join(f.dir,'sections/.transaction.json');fs.writeFileSync(journal,JSON.stringify({schemaVersion:2,before:{vehicles:f.data.vehicles},base:f.revisions,sections:{vehicles:[]},revisions:{...f.revisions,vehicles:f.revisions.vehicles+1}}));const before=tree(f.dir);assert.throws(()=>storage.readSnapshot(f.dir),{code:'SCHEMA_RECOVERY_REQUIRED'});assert.throws(()=>require(path.join(ROOT,'electron/schema-upgrade.cjs')).inspectSource({sourceDir:f.dir}),{code:'SCHEMA_UPGRADE_SOURCE_BUSY'});assert.deepEqual(tree(f.dir),before);
});
