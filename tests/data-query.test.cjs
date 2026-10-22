'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {DatabaseSync}=require('node:sqlite');
const sqlite=require('../electron/sqlite-storage.cjs');
const storage=require('../electron/storage');
const query=require('../electron/data-query.cjs');
const schema=require('../assets/core/platform-schema.js');
const admin={id:'synthetic-admin',role:'admin'},dispatcher={id:'synthetic-dispatcher',role:'dispatcher'};
function temp(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-data-query-'));t.after(()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('tvs-data-query-'));fs.rmSync(root,{recursive:true,force:true});});return root;}
function sample(){return {
 vehicles:[{id:7,plate:'КАМАЗ НОМЕР',fuelBalance:923.537,price:765432.1},{id:'7',plate:'STRING'},{id:'duplicate',plate:'DUP-A'},{id:'duplicate',plate:'DUP-B'},{plate:'NO-ID'}],
 records:[{id:7,vehicleId:7,date:'2026-09-01',km:1.125,note:'КамАЗ на объекте'},{id:'7',vehicleId:'7',date:'2026-09-01',km:2.125,note:'Second'},{id:'old',vehicleId:7,date:'2026-08-31',km:3},{id:'last-day',vehicleId:7,date:'2026-09-30',km:4},{id:'oct',vehicleId:7,date:'2026-10-01',km:5},{id:'missing-date',vehicleId:7,km:6}],
 monthlyFuel:[{vehicleId:7,month:'2026-09',liters:923.537},{vehicleId:'7',month:'2026-10',liters:1}],
 payments:[{id:'confidential-payment',sum:1122334455,date:'2026-09-01',note:'FINANCIAL-SECRET'}],
 auditLog:[{id:'hidden-financial-audit',section:'payments',at:'2026-09-01T12:00:00Z',after:{sum:1122334455,note:'FINANCIAL-SECRET'}},{id:'nested-finance',section:'vehicles',before:{payment:{sum:1122334455}}}],
 generators:[{id:'g'}],genRecords:[{id:'g-row',generatorId:'g',date:'2026-09-01',hours:1}]
};}
function fixture(t,data=sample()){
 const root=temp(t),json=path.join(root,'json'),sql=path.join(root,'sql'),all=Object.fromEntries(schema.sections.map(section=>[section,data[section]||[]])),revisions=Object.fromEntries(schema.sections.map((section,index)=>[section,index+1]));
 fs.mkdirSync(path.join(json,'sections'),{recursive:true});for(const section of schema.sections)fs.writeFileSync(path.join(json,'sections',section+'.json'),JSON.stringify(all[section]));fs.writeFileSync(path.join(json,'sections','revisions.json'),JSON.stringify(revisions));
 sqlite.create(sql,{data:all,revisions});return {root,json,sql,all,revisions};
}
function rows(dir,request,principal=admin){return query.queryRows(dir,request,principal);}
function readAllPages(dir,request,principal=admin){const seen=[];let cursor=null,pages=0,total;do{const page=rows(dir,{...request,cursor},principal);seen.push(...page.rows);cursor=page.nextCursor;total=page.total;assert.ok(++pages<1000);}while(cursor);return {rows:seen,total,pages};}

test('JSON and SQLite pages preserve typed IDs, decimals, legacy duplicate and missing IDs in source order',t=>{
 const f=fixture(t);
 for(const dir of [f.json,f.sql]){
  const page=readAllPages(dir,{section:'vehicles',limit:2});assert.deepEqual(page.rows,f.all.vehicles);assert.equal(page.total,5);assert.equal(page.pages,3);assert.equal(page.rows[0].id,7);assert.equal(page.rows[1].id,'7');assert.equal(page.rows[0].fuelBalance,923.537);
  const response=rows(dir,{section:'vehicles',limit:2});assert.equal(response.ok,true);assert.equal(response.revision,f.revisions.vehicles);assert.match(response.databaseToken,/^[a-f0-9]{64}$/);assert.equal(response.backend,dir===f.sql?'sqlite':'json');assert.ok(response.nextCursor);
 }
});

test('date, month and asset filters have identical inclusive results on both backends',t=>{
 const f=fixture(t);
 const requests=[{section:'records',limit:2,from:'2026-09-01',to:'2026-09-30'},{section:'records',limit:1,from:'2026-09',to:'2026-09'},{section:'monthlyFuel',limit:1,from:'2026-09',to:'2026-09'},{section:'genRecords',limit:1,assetRef:'g:g'}];
 for(const request of requests)assert.deepEqual(readAllPages(f.sql,request),readAllPages(f.json,request));
 assert.deepEqual(readAllPages(f.sql,requests[0]).rows.map(row=>row.id),[7,'7','last-day']);
 assert.equal(rows(f.sql,{section:'records',from:'2026-09-30',to:'2026-09-30'}).total,1);
 for(const dir of [f.json,f.sql])assert.throws(()=>rows(dir,{section:'records',assetRef:'v:7'}),{code:'QUERY_ASSET_AMBIGUOUS'});
});

test('legacy asset query ambiguity is rejected equally for zero, fractional numeric and invalid old textual identities',t=>{
 const data=sample();data.vehicles=[{id:0},{id:'0'},{id:1.5},{id:'1.5'},{id:'__proto__'},{id:'__proto__'}];const f=fixture(t,data);
 for(const dir of [f.json,f.sql])for(const ref of ['v:0','v:1.5','v:__proto__'])assert.throws(()=>rows(dir,{section:'records',assetRef:ref}),{code:'QUERY_ASSET_AMBIGUOUS'});
});

test('Unicode case-insensitive search uses only fixed bounded scalar text with JSON/SQLite parity',t=>{
 const f=fixture(t);
 for(const dir of [f.json,f.sql]){
  assert.deepEqual(rows(dir,{section:'records',search:'  КАМАЗ  '}).rows,[f.all.records[0]]);
  assert.deepEqual(rows(dir,{section:'vehicles',search:'камаз'}).rows,[f.all.vehicles[0]]);
  assert.equal(rows(dir,{section:'vehicles',search:'765432.1'}).total,0);
  assert.equal(rows(dir,{section:'records',search:'missing-date'}).total,1);
 }
});

test('search cannot reach nested histories, financial scalars or text outside its documented bound',t=>{
 const input=sample();input.vehicles.push({id:'bounded',plate:'X',note:'a'.repeat(500)+'OUTSIDE-BOUND',history:{note:'NESTED-SECRET'}});const f=fixture(t,input);
 for(const dir of [f.json,f.sql])for(const search of ['OUTSIDE-BOUND','NESTED-SECRET','1122334455'])assert.equal(rows(dir,{section:'vehicles',search}).total,0);
});

test('empty pages have exact authorised count and no continuation cursor',t=>{
 const f=fixture(t);
 for(const dir of [f.json,f.sql]){const empty=rows(dir,{section:'records',limit:1,search:'not-present'});assert.deepEqual(empty.rows,[]);assert.equal(empty.total,0);assert.equal(empty.nextCursor,null);assert.equal(rows(dir,{section:'parts'}).total,0);}
});

test('hidden financial section requests reject before any database read, count, search or cursor disclosure',t=>{
 const root=temp(t),missing=path.join(root,'must-not-be-created');
 for(const section of ['payments','budget','contragents','costEntries','costProfiles'])for(const principal of [dispatcher,{id:'synthetic-mechanic',role:'mechanic'}])assert.throws(()=>rows(missing,{section,search:'FINANCIAL-SECRET',cursor:'bad'},principal),{code:'ACCESS_DENIED',status:403});
 assert.equal(fs.existsSync(missing),false);
});

test('roles match existing read policy; query-only vehicle field redaction is not introduced',t=>{
 const f=fixture(t);
 for(const dir of [f.json,f.sql]){
  for(const role of ['admin','accountant','viewer'])assert.equal(rows(dir,{section:'payments'},{id:'reader-'+role,role}).total,1);
  assert.deepEqual(rows(dir,{section:'vehicles'},dispatcher).rows,f.all.vehicles);
 }
});

test('audit queries reject for every role before scanning nested financial evidence',t=>{
 const f=fixture(t);
 for(const dir of [f.json,f.sql])for(const role of ['admin','dispatcher','mechanic','viewer'])assert.throws(()=>rows(dir,{section:'auditLog',search:'FINANCIAL-SECRET'},{id:'audit-'+role,role}),{code:'QUERY_UNSUPPORTED'});
 assert.throws(()=>sqlite.queryRows(f.sql,{section:'auditLog',limit:1}),{code:'QUERY_UNSUPPORTED'});
});

test('principal is mandatory and an explicit readable set can only narrow role access',t=>{
 const f=fixture(t);
 for(const dir of [f.json,f.sql]){
  assert.throws(()=>rows(dir,{section:'vehicles'},null),{code:'ACCESS_DENIED'});
  assert.throws(()=>rows(dir,{section:'vehicles'},{id:'u',role:'invented'}),{code:'ACCESS_DENIED'});
  assert.throws(()=>rows(dir,{section:'vehicles'},{...admin,readable:['records']}),{code:'ACCESS_DENIED'});
  assert.throws(()=>rows(dir,{section:'payments'},{...dispatcher,readable:['payments']}),{code:'ACCESS_DENIED'});
  assert.equal(rows(dir,{section:'vehicles'},{...dispatcher,readable:['vehicles']}).total,5);
 }
});

test('cursor becomes stale after the selected section changes',t=>{
 const f=fixture(t);
 for(const dir of [f.json,f.sql]){
  const page=rows(dir,{section:'vehicles',limit:1});const changed=[...f.all.vehicles,{id:'new',plate:'NEW'}];
  if(dir===f.sql)sqlite.commitSections(dir,{vehicles:changed},{...f.revisions,vehicles:f.revisions.vehicles+1});
  else{fs.writeFileSync(path.join(dir,'sections','vehicles.json'),JSON.stringify(changed));fs.writeFileSync(path.join(dir,'sections','revisions.json'),JSON.stringify({...f.revisions,vehicles:f.revisions.vehicles+1}));}
  assert.throws(()=>rows(dir,{section:'vehicles',limit:1,cursor:page.nextCursor}),{code:'CURSOR_STALE',status:409});assert.equal(rows(dir,{section:'vehicles',limit:1}).total,6);
 }
});

test('unrelated section changes do not invalidate a stable keyset cursor',t=>{
 const f=fixture(t);
 for(const dir of [f.json,f.sql]){
  const page=rows(dir,{section:'vehicles',limit:1});
  if(dir===f.sql)sqlite.commitSections(dir,{parts:[{id:'independent'}]},{...f.revisions,parts:f.revisions.parts+1});
  else fs.writeFileSync(path.join(dir,'sections','revisions.json'),JSON.stringify({...f.revisions,parts:f.revisions.parts+1}));
  assert.deepEqual(rows(dir,{section:'vehicles',limit:1,cursor:page.nextCursor}).rows,[f.all.vehicles[1]]);
 }
});

test('cursor is bound to database generation, filters, page size, section and current principal/access',t=>{
 const f=fixture(t);
 for(const dir of [f.json,f.sql]){
  const initial=rows(dir,{section:'vehicles',limit:1}),cursor=initial.nextCursor;
  for(const changes of [{search:'STRING'},{assetRef:'v:7'},{section:'records'},{limit:2},{from:'2026-09'}])assert.throws(()=>rows(dir,{section:'vehicles',limit:1,cursor,...changes}),{code:'CURSOR_STALE'});
  for(const principal of [{...admin,id:'another'},{...admin,role:'viewer'},{...admin,readable:['vehicles']}])assert.throws(()=>rows(dir,{section:'vehicles',limit:1,cursor},principal),{code:'CURSOR_STALE'});
  if(dir===f.sql){const db=new DatabaseSync(sqlite.filename(dir));try{db.prepare("UPDATE metadata SET value='2' WHERE key='generation'").run();}finally{db.close();}}
  else{const file=path.join(dir,'database-identity.json'),identity=JSON.parse(fs.readFileSync(file));fs.writeFileSync(file,JSON.stringify({...identity,generation:identity.generation+1}));}
  assert.throws(()=>rows(dir,{section:'vehicles',limit:1,cursor}),{code:'CURSOR_STALE'});
 }
});

test('cursor from another database and malformed or modified cursors are rejected',t=>{
 const f=fixture(t),initial=rows(f.json,{section:'vehicles',limit:1}),cursor=initial.nextCursor;
 assert.throws(()=>rows(f.sql,{section:'vehicles',limit:1,cursor}),{code:'CURSOR_STALE'});
 for(const invalid of ['not-a-cursor','a'.repeat(4097),cursor+'=',Buffer.from('{"payload":{"position":999}}').toString('base64url')])assert.throws(()=>rows(f.json,{section:'vehicles',limit:1,cursor:invalid}),error=>['QUERY_INVALID','CURSOR_INVALID'].includes(error.code));
 const decoded=JSON.parse(Buffer.from(cursor,'base64url'));decoded.payload.position=999;
 assert.throws(()=>rows(f.json,{section:'vehicles',limit:1,cursor:Buffer.from(JSON.stringify(decoded)).toString('base64url')}),{code:'CURSOR_INVALID'});
});

test('SQL metacharacters are literal search values and caller-supplied SQL/columns/JSON paths reject',t=>{
 const f=fixture(t);
 for(const dir of [f.json,f.sql]){
  assert.equal(rows(dir,{section:'vehicles',search:"' OR 1=1; DROP TABLE sections; --"}).total,0);
  assert.equal(rows(dir,{section:'records',assetRef:"v:7' OR 1=1 --"}).total,0);
  for(const request of [{section:'vehicles; DROP TABLE section_rows'},{section:'vehicles',sql:'SELECT *'},{section:'vehicles',orderBy:'price'},{section:'vehicles',columns:['price']},{section:'vehicles',jsonPath:'$.price'}])assert.throws(()=>rows(dir,request),{code:'QUERY_INVALID'});
  assert.equal(rows(dir,{section:'vehicles'}).total,5);
 }
});

test('invalid dates, ranges, page bounds and unsupported query shapes reject consistently',t=>{
 const f=fixture(t);
 for(const dir of [f.json,f.sql])for(const request of [null,[],{section:'records',limit:0},{section:'records',limit:201},{section:'records',limit:1.5},{section:'records',limit:'5'},{section:'records',from:'2026-02-30'},{section:'records',from:'2026-13'},{section:'records',from:'2026-10-02',to:'2026-10-01'},{section:'records',search:{}},{section:'records',assetRef:'arbitrary'},{section:'records',search:'x'.repeat(201)}])assert.throws(()=>rows(dir,request),{code:'QUERY_INVALID'});
 for(const dir of [f.json,f.sql])assert.equal(rows(dir,{section:'records',from:'2024-02-29',to:'2026-09'}).total,4);
});

test('SQLite query reads only one limited page and counts; it never materialises complete sections or database',t=>{
 const input=sample();input.vehicles=input.vehicles.filter(row=>row.id!=='7');input.records=Array.from({length:410},(_,index)=>({id:'r'+index,vehicleId:7,date:'2026-09-01',note:'КамАЗ '+index}));const f=fixture(t,input);
 const originals={readAll:sqlite.readAll,readRows:sqlite.readRows,storageAll:storage.readAll,storageSnapshot:storage.readSnapshot,prepare:DatabaseSync.prototype.prepare},sql=[];
 try{
  sqlite.readAll=sqlite.readRows=storage.readAll=storage.readSnapshot=()=>{throw Error('A full read was attempted');};
  DatabaseSync.prototype.prepare=function(statement){sql.push(statement);return originals.prepare.call(this,statement);};
  const page=rows(f.sql,{section:'records',limit:7,assetRef:'v:7',from:'2026-09',to:'2026-09',search:'камаз'});assert.equal(page.rows.length,7);assert.equal(page.total,410);assert.ok(page.nextCursor);
  const bodies=sql.filter(statement=>/^SELECT .*row_json.*FROM section_rows/i.test(statement));assert.equal(bodies.length,1);assert.match(bodies[0],/position>\? ORDER BY position LIMIT \?/);assert.ok(sql.some(statement=>/^SELECT count\(\*\)/i.test(statement)));
 }finally{sqlite.readAll=originals.readAll;sqlite.readRows=originals.readRows;storage.readAll=originals.storageAll;storage.readSnapshot=originals.storageSnapshot;DatabaseSync.prototype.prepare=originals.prepare;}
});

test('SQL date/asset selection plans use their static indexes and page queries close the connection',t=>{
 const f=fixture(t);const db=new DatabaseSync(sqlite.filename(f.sql),{readOnly:true});try{
  const date=db.prepare('EXPLAIN QUERY PLAN SELECT count(*) FROM section_rows WHERE section=? AND date_value>=? AND date_value<=?').all('records','2026-09','2026-10');
  const asset=db.prepare('EXPLAIN QUERY PLAN SELECT count(*) FROM section_rows WHERE section=? AND asset_ref=? AND date_value>=?').all('records','v:7','2026-09');
  assert.match(date.map(row=>row.detail).join('\n'),/rows_by_date/);assert.match(asset.map(row=>row.detail).join('\n'),/rows_by_asset/);
 }finally{db.close();}
 rows(f.sql,{section:'records',limit:1});const moved=path.join(f.root,'moved-sql');fs.renameSync(f.sql,moved);assert.equal(rows(moved,{section:'records',limit:1}).rows.length,1);
});

test('corrupt existing SQLite is never replaced by JSON fallback or an empty successful result',t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.json,'platform.sqlite'),'not sqlite');const before=fs.readFileSync(path.join(f.json,'platform.sqlite'));
 assert.throws(()=>rows(f.json,{section:'vehicles'}));assert.deepEqual(fs.readFileSync(path.join(f.json,'platform.sqlite')),before);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.json,'sections','vehicles.json'))),f.all.vehicles);
});
