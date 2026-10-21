'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {DatabaseSync}=require('node:sqlite');
const sqlite=require('../electron/sqlite-storage.cjs');
const schema=require('../assets/core/platform-schema.js');
const clone=value=>structuredClone(value);
function temp(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-sqlite-adapter-'));t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('tvs-sqlite-adapter-'));fs.rmSync(dir,{recursive:true,force:true});});return dir;}
function sample(){return {vehicles:[{id:7,plate:'NUMERIC',fuelBalance:923.537},{id:'7',plate:'STRING'},{id:0.5,plate:'FRACTION'},{id:1e20,plate:'LARGE'}],records:[{id:'number-record',vehicleId:7,date:'2026-10-01',km:1},{id:'string-record',vehicleId:'7',date:'2026-10-02',km:2},{id:'fraction-record',vehicleId:0.5,date:'2026-10-03',km:3},{id:'large-record',vehicleId:1e20,date:'2026-10-04',km:4}],fuelCards:[{number:'444 444'},{number:'444444',note:'Legacy duplicate natural identity'}],monthlyFuel:[{vehicleId:7,month:'2026-10',cardNumber:'444444',liters:1},{vehicleId:'7',month:'2026-10',cardNumber:'444444',liters:2}]};}
function snapshot(dir){return {data:sqlite.readAll(dir),revisions:sqlite.readRevisions(dir),inspection:sqlite.inspect(dir)};}
function raw(dir,action,readOnly=false){const db=new DatabaseSync(sqlite.filename(dir),{readOnly,enableForeignKeyConstraints:true});try{return action(db);}finally{db.close();}}
function make(t,input=sample()){const root=temp(t),dir=path.join(root,'database');sqlite.create(dir,{data:input,revisions:{vehicles:11,records:23}});return {root,dir};}

test('reads never create SQLite and corrupt presence never silently falls back to JSON',t=>{
  const root=temp(t),empty=path.join(root,'empty');fs.mkdirSync(empty);
  assert.equal(sqlite.exists(empty),false);assert.throws(()=>sqlite.readAll(empty),{code:'SQLITE_NOT_FOUND'});assert.deepEqual(fs.readdirSync(empty),[]);
  const corrupt=path.join(root,'corrupt');fs.mkdirSync(corrupt);fs.writeFileSync(sqlite.filename(corrupt),'invalid SQLite');
  assert.equal(sqlite.exists(corrupt),true);assert.throws(()=>sqlite.readAll(corrupt));assert.equal(fs.readFileSync(sqlite.filename(corrupt),'utf8'),'invalid SQLite');
});

test('explicit creation preserves typed finite IDs, decimals, key order, natural identities and original positions',t=>{
  const root=temp(t),dir=path.join(root,'database'),data=sample(),before=JSON.stringify(data);
  const report=sqlite.create(dir,{data,revisions:{vehicles:11,records:23}});
  assert.equal(report.ok,true);assert.equal(report.sections.length,schema.sections.length);assert.deepEqual(report.integrity,['ok']);assert.deepEqual(report.foreignKeyErrors,[]);
  assert.equal(JSON.stringify(data),before);
  for(const [section,rows]of Object.entries(data))assert.equal(JSON.stringify(sqlite.readRows(dir,section)),JSON.stringify(rows));
  const ids=raw(dir,db=>db.prepare("SELECT id_type,id_value FROM section_rows WHERE section='vehicles' ORDER BY position").all(),true);
  assert.deepEqual(ids.map(row=>row.id_type),['number','string','number','number']);
  assert.equal(ids[0].id_value,'7');assert.equal(ids[1].id_value,'"7"');assert.equal(sqlite.readRows(dir,'vehicles')[0].fuelBalance,923.537);
  assert.equal(sqlite.inspect(dir).linkCount,6);
  assert.equal(sqlite.readRevisions(dir).records,23);assert.equal(sqlite.readRevisions(dir).parts,0);
});

test('duplicate or missing legacy IDs and unresolved links are retained and reported without inventing rows',t=>{
  const root=temp(t),dir=path.join(root,'database');
  const data={vehicles:[{id:'duplicate',plate:'A'},{id:'duplicate',plate:'B'},{plate:'No ID'}],records:[{id:'ambiguous',vehicleId:'duplicate',date:'2026-10-01'},{id:'orphan',vehicleId:'missing',date:'2026-10-02',km:'old invalid'}],auditLog:[{id:'old',section:'vehicles',recordId:'deleted',before:{id:'deleted'}}]};
  const report=sqlite.create(dir,{data});
  assert.deepEqual(sqlite.readRows(dir,'vehicles'),data.vehicles);assert.deepEqual(sqlite.readRows(dir,'records'),data.records);
  assert.equal(report.rowCount,6);assert.equal(report.linkCount,0);
  assert.equal(report.legacyIssues.some(issue=>issue.code==='reference-ambiguous'),true);assert.equal(report.legacyIssues.some(issue=>issue.code==='reference-missing'&&issue.targetId==='missing'),true);
  assert.equal(report.legacyIssues.some(issue=>issue.section==='auditLog'),false);
  const keys=raw(dir,db=>db.prepare("SELECT row_key FROM section_rows WHERE section='vehicles'").all(),true);assert.equal(new Set(keys.map(row=>row.row_key)).size,3);
});

test('polymorphic, nested and legacy-resolved references have SQL foreign keys while historical and advisory references do not',t=>{
  const root=temp(t),dir=path.join(root,'database'),data={vehicles:[{id:'v'}],records:[{id:'r',vehicleId:'v',date:'2026-10-01',fuelGrade:'ДТ'}],fuelCards:[{number:'123',assignments:[{vehicleId:'v'}]}],fuelPurchases:[{id:'p',vehicleId:'v',recordId:'stale',date:'2026-10-01',grade:'ДТ'}],assetAssignments:[{id:'a',assetRef:'v:v'}],auditLog:[{id:'history',section:'records',recordId:'removed'}]};
  const report=sqlite.create(dir,{data});assert.equal(report.linkCount,5);assert.equal(report.legacyIssues.filter(issue=>issue.code==='reference-resolved-legacy').length,1);
  assert.equal(sqlite.readRows(dir,'fuelPurchases')[0].recordId,'stale');
  assert.throws(()=>raw(dir,db=>db.exec("DELETE FROM section_rows WHERE section='vehicles'")),/FOREIGN KEY/);
  assert.deepEqual(sqlite.readRows(dir,'vehicles'),data.vehicles);
});

test('section commits preserve untouched sections, supplied revisions and complete reference projections',t=>{
  const {dir}=make(t),before=sqlite.readAll(dir),revisions=sqlite.readRevisions(dir),records=clone(before.records);records[0].note='Комментарий';
  sqlite.commitSections(dir,{records},{...revisions,records:24});
  assert.deepEqual(sqlite.readRows(dir,'records'),records);assert.deepEqual(sqlite.readRows(dir,'vehicles'),before.vehicles);assert.equal(sqlite.readRevisions(dir).records,24);assert.equal(sqlite.readRevisions(dir).vehicles,11);
  assert.equal(sqlite.inspect(dir).linkCount,6);assert.deepEqual(sqlite.inspect(dir).foreignKeyErrors,[]);
});

test('empty section commit performs no SQL transaction or revision change',t=>{
  const {dir}=make(t),before=snapshot(dir),bytes=fs.readFileSync(sqlite.filename(dir));let called=false;
  sqlite.commitSections(dir,{},Object.fromEntries(schema.sections.map(name=>[name,999])),{beforeCommit(){called=true;throw Error('Should not be called');}});
  assert.equal(called,false);assert.deepEqual(snapshot(dir),before);assert.deepEqual(fs.readFileSync(sqlite.filename(dir)),bytes);
});

test('an injected commit failure rolls source rows, revisions, resolved links and old issue evidence back together',t=>{
  const {dir}=make(t),before=snapshot(dir),records=clone(before.data.records);records[0].vehicleId='missing';
  assert.throws(()=>sqlite.commitSections(dir,{records},{...before.revisions,records:24},{beforeCommit(){throw Error('Synthetic fault before COMMIT');}}),/Synthetic fault/);
  assert.deepEqual(snapshot(dir),before);
});

test('outer transaction includes nested writes and rolls them all back on a later failure',t=>{
  const {dir}=make(t),before=snapshot(dir),records=clone(before.data.records);records[0].note='Not committed';
  assert.throws(()=>sqlite.transaction(dir,()=>{
    sqlite.commitSections(dir,{records},{...before.revisions,records:24});assert.equal(sqlite.readRows(dir,'records')[0].note,'Not committed');throw Error('Outer failure');
  }),/Outer failure/);
  assert.deepEqual(snapshot(dir),before);
});

test('other SQLite readers see the committed snapshot until the outer transaction commits',t=>{
  const {dir}=make(t),versions=sqlite.readRevisions(dir),records=sqlite.readRows(dir,'records');records[0].note='Committed once';
  sqlite.transaction(dir,()=>{
    sqlite.commitSections(dir,{records},{...versions,records:24});
    const outside=raw(dir,db=>db.prepare("SELECT row_json FROM section_rows WHERE section='records' AND position=0").get(),true);
    assert.equal(JSON.parse(outside.row_json).note,undefined);
  });
  assert.equal(sqlite.readRows(dir,'records')[0].note,'Committed once');
});

test('read-only outer and nested scopes cannot commit and swallowed nested failure aborts the outer transaction',t=>{
  const {dir}=make(t),before=snapshot(dir),records=clone(before.data.records);records[0].note='Forbidden';
  assert.throws(()=>sqlite.transaction(dir,()=>sqlite.commitSections(dir,{records},{records:24}),{readOnly:true}),{code:'SQLITE_READ_ONLY'});
  assert.throws(()=>sqlite.transaction(dir,()=>{
    try{sqlite.transaction(dir,()=>sqlite.commitSections(dir,{records},{records:24}),{readOnly:true});}catch(error){assert.equal(error.code,'SQLITE_READ_ONLY');}
  }),{code:'SQLITE_READ_ONLY'});
  assert.deepEqual(snapshot(dir),before);
});

test('async transaction callbacks are rejected without dispatching their work',t=>{
  const {dir}=make(t),before=snapshot(dir);let started=false;
  assert.throws(()=>sqlite.transaction(dir,async()=>{started=true;return 1;}),{code:'SQLITE_ASYNC_TRANSACTION'});assert.equal(started,false);assert.deepEqual(snapshot(dir),before);
});

test('a transaction can reassign a reference and remove its old target atomically',t=>{
  const root=temp(t),dir=path.join(root,'database');sqlite.create(dir,{data:{vehicles:[{id:'old'}],records:[{id:'r',vehicleId:'old',date:'2026-10-01'}]}});
  sqlite.transaction(dir,()=>sqlite.commitSections(dir,{vehicles:[{id:'new'}],records:[{id:'r',vehicleId:'new',date:'2026-10-01'}]},{vehicles:1,records:1}));
  assert.deepEqual(sqlite.readRows(dir,'vehicles'),[{id:'new'}]);assert.equal(sqlite.inspect(dir).linkCount,1);assert.deepEqual(sqlite.inspect(dir).foreignKeyErrors,[]);
});

test('SQLite uses WAL, FULL durability, foreign keys and useful date/asset/target indexes',t=>{
  const {dir}=make(t);
  const config=raw(dir,db=>({wal:db.prepare('PRAGMA journal_mode').get(),keys:db.prepare('PRAGMA foreign_keys').get(),indexes:db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all()}),true);
  assert.equal(config.wal.journal_mode,'wal');assert.equal(config.keys.foreign_keys,1);
  for(const name of ['rows_by_identity','rows_by_date','rows_by_asset','links_to_target'])assert.equal(config.indexes.some(index=>index.name===name),true);
  assert.equal(raw(dir,db=>db.prepare('PRAGMA integrity_check').get(),true).integrity_check,'ok');
});

test('future and invalid SQLite format metadata is rejected even for read-only inspection',t=>{
  const {dir}=make(t);raw(dir,db=>db.exec("UPDATE metadata SET value='999' WHERE key='format_version'"));
  assert.equal(sqlite.exists(dir),true);assert.throws(()=>sqlite.readAll(dir),{code:'SQLITE_FUTURE_FORMAT'});assert.throws(()=>sqlite.inspect(dir),{code:'SQLITE_FUTURE_FORMAT'});
  raw(dir,db=>db.exec("UPDATE metadata SET value='1' WHERE key='format_version';UPDATE metadata SET value='unknown' WHERE key='format'"));
  assert.throws(()=>sqlite.readRevisions(dir),{code:'SQLITE_FORMAT'});
});

test('future file versions and conflicting header identifiers cannot bypass metadata version checks',t=>{
  const {dir}=make(t);raw(dir,db=>db.exec('PRAGMA user_version=999;'));assert.throws(()=>sqlite.readAll(dir),{code:'SQLITE_FUTURE_FORMAT'});
  raw(dir,db=>db.exec('PRAGMA user_version=0;'));assert.throws(()=>sqlite.inspect(dir),{code:'SQLITE_FORMAT'});
  raw(dir,db=>db.exec('PRAGMA user_version=1;PRAGMA application_id=0;'));assert.throws(()=>sqlite.readAll(dir),{code:'SQLITE_FORMAT'});
});

test('an incomplete section catalogue and invalid creation inputs fail instead of being replaced with empty sections',t=>{
  const {root,dir}=make(t);raw(dir,db=>db.exec("DELETE FROM sections WHERE name='budget'"));assert.throws(()=>sqlite.readAll(dir),{code:'SQLITE_REVISIONS'});
  for(const input of [{data:{records:null}},{data:{records:[{id:'bad',km:Infinity}]}},{data:{},revisions:null}]){
    const target=path.join(root,'invalid');assert.throws(()=>sqlite.create(target,input));assert.equal(fs.existsSync(target),false);
  }
});

test('creation never overwrites a populated directory or existing SQLite database and leaves an explicit old-app guard',t=>{
  const root=temp(t),nonempty=path.join(root,'nonempty');fs.mkdirSync(nonempty);fs.writeFileSync(path.join(nonempty,'keep.txt'),'Keep');
  assert.throws(()=>sqlite.create(nonempty,{data:sample()}),{code:'SQLITE_TARGET_NOT_EMPTY'});assert.equal(fs.readFileSync(path.join(nonempty,'keep.txt'),'utf8'),'Keep');assert.equal(sqlite.exists(nonempty),false);
  const dir=path.join(root,'database');sqlite.create(dir,{data:sample()});const before=snapshot(dir);assert.throws(()=>sqlite.create(dir,{data:{}}),{code:'SQLITE_TARGET_NOT_EMPTY'});assert.deepEqual(snapshot(dir),before);
  const guard=JSON.parse(fs.readFileSync(path.join(dir,'sections','revisions.json'),'utf8'));assert.equal(guard.format,'sqlite');assert.equal(guard.vehicles,null);assert.equal(guard.records,null);
  assert.deepEqual(fs.readdirSync(path.join(dir,'sections')),['revisions.json']);
});

test('failed explicit creation cleans only the files it created and can be retried in the same empty target',t=>{
  const root=temp(t),dir=path.join(root,'database');fs.mkdirSync(dir);
  assert.throws(()=>sqlite.create(dir,{data:sample()},{beforeCommit(){throw Error('Create failure');}}),/Create failure/);
  assert.deepEqual(fs.readdirSync(dir),[]);assert.equal(sqlite.create(dir,{data:sample()}).ok,true);
});

test('UNC paths and aliased database files cannot open another database through a selected directory',t=>{
  for(const name of ['\\\\server\\share\\db','//server/share/db'])assert.throws(()=>sqlite.exists(name),{code:'SQLITE_NETWORK_PATH'});
  const {root,dir}=make(t),alias=path.join(root,'alias');fs.mkdirSync(alias);fs.linkSync(sqlite.filename(dir),path.join(alias,'platform.sqlite'));
  assert.equal(sqlite.exists(alias),true);assert.throws(()=>sqlite.readAll(alias),{code:'SQLITE_PATH_ESCAPE'});fs.unlinkSync(path.join(alias,'platform.sqlite'));
  try{fs.symlinkSync(sqlite.filename(dir),path.join(alias,'platform.sqlite'),'file');}
  catch(error){if(error.code==='EPERM'||error.code==='EACCES')return;throw error;}
  assert.equal(sqlite.exists(alias),true);assert.throws(()=>sqlite.readAll(alias),{code:'SQLITE_PATH_ESCAPE'});
  fs.unlinkSync(path.join(alias,'platform.sqlite'));fs.symlinkSync(path.join(root,'does-not-exist.sqlite'),path.join(alias,'platform.sqlite'),'file');
  assert.equal(sqlite.exists(alias),true);assert.throws(()=>sqlite.readAll(alias),{code:'SQLITE_PATH_ESCAPE'});
});

test('all adapter connections close before returning so a completed stage directory can be renamed on Windows',t=>{
  const {root,dir}=make(t);sqlite.readAll(dir);sqlite.readRows(dir,'records');sqlite.readRevisions(dir);sqlite.inspect(dir);
  const published=path.join(root,'published');fs.renameSync(dir,published);assert.equal(sqlite.inspect(published).ok,true);
  const wal=sqlite.filename(published)+'-wal';if(fs.existsSync(wal))assert.equal(fs.statSync(wal).size,0);
});
