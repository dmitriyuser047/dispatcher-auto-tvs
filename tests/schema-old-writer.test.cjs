'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
const {fixture,tree,oldFormat,oldSqlite,oldStorage,removeEmptySqliteSidecars}=require('./helpers/schema-format-support.cjs');
const descriptor={schemaVersion:3,minReader:3,minWriter:3,features:['controlled-import-v1','document-lifecycle-v1','row-scope-v1','sealed-print-v1']};
for(const kind of ['json','sqlite'])test(kind+' exact pinned old version 2 storage cannot alter new version 3 primary/business/managed bytes or run commit hooks',t=>{
 const f=fixture(t,kind);
 if(kind==='json'){const file=path.join(f.dir,'sections/revisions.json'),versions=oldFormat.encodeRevisions(Object.fromEntries(require('../electron/storage-format.cjs').sectionsFor(2).map(name=>[name,f.revisions[name]])));versions.schemaVersion=3;versions.compatibility=descriptor;fs.writeFileSync(file,JSON.stringify(versions));}
 else{const db=new DatabaseSync(path.join(f.dir,'platform.sqlite'));try{db.prepare('INSERT OR REPLACE INTO metadata(key,value)VALUES(?,?)').run('compatibility',JSON.stringify(descriptor));db.exec("UPDATE metadata SET value='3' WHERE key='schema_version';PRAGMA user_version=3;PRAGMA wal_checkpoint(TRUNCATE);");}finally{db.close();}removeEmptySqliteSidecars(f.dir);}
 const before=tree(f.dir),errorCode=kind==='json'?'STORAGE_FORMAT':'SQLITE_FUTURE_FORMAT',rows=f.data.vehicles.map(row=>({...row,plate:'OLD CLIENT MUST NOT WRITE'}));let hooks=0;
 for(const action of [()=>oldStorage.writeAll(f.dir,{...f.data,vehicles:rows},{beforeCommit:()=>hooks++}),()=>oldStorage.writeSections(f.dir,{base:f.revisions,sections:{vehicles:rows}},{beforeCommit:()=>hooks++}),...(kind==='sqlite'?[()=>oldSqlite.commitSections(f.dir,{vehicles:rows},f.revisions)]:[])]){assert.throws(action,{code:errorCode});assert.equal(hooks,0);const actual=tree(f.dir);if(kind==='sqlite'){
  // A shipped v2 binary cannot be changed: its read-only metadata probe can
  // create SQLite coordination files before rejecting version 3. No pages may
  // reach WAL, and every primary/business/managed byte remains exact.
  const wal=path.join(f.dir,'platform.sqlite-wal');if(fs.existsSync(wal))assert.equal(fs.statSync(wal).size,0);assert.deepEqual(actual.filter(([name])=>!['platform.sqlite-wal','platform.sqlite-shm'].includes(name)),before);
 }else assert.deepEqual(actual,before);}
});
