'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const storage=require('../electron/storage');
const sqlite=require('../electron/sqlite-storage.cjs');
const identity=require('../electron/database-identity.cjs');
const admin={id:'identity-admin',name:'Synthetic identity administrator',role:'admin'};
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function temp(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-database-identity-'));
  t.after(()=>{const resolved=path.resolve(root);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('tvs-database-identity-'));fs.rmSync(resolved,{recursive:true,force:true});});return root;
}
function initial(){return {...Object.fromEntries(storage.SECTIONS.map(name=>[name,[]])),
  vehicles:[{id:7,plate:'SYNTHETIC NUMBER',fuelBalance:923.537,norm:10},{id:'7',plate:'SYNTHETIC STRING',fuelBalance:0,norm:10}],
  records:[{id:'identity-row',vehicleId:7,date:'2026-09-01',km:10.125,fuelActual:1.001}],
  repairs:[{id:'legacy-orphan',vehicleId:'missing-synthetic-vehicle',status:'planned'}]};}
function create(dir,format,data=initial(),revisions=Object.fromEntries(storage.SECTIONS.map(name=>[name,11]))){
  // A trusted new-target builder preserves the intentional historical orphan
  // and honestly bootstraps current history without an ordinary-command bypass.
  if(format==='sqlite')sqlite.create(dir,{data,revisions});else storage.createJson(dir,{data,revisions});
}
function fixture(t,format){const root=temp(t),dir=path.join(root,'database');create(dir,format);return {root,dir};}
function readIdentity(dir,format){return format==='sqlite'?sqlite.readIdentity(dir):identity.readOrCreate(dir);}
function changeIdentity(dir,format,patch){
  if(format==='sqlite'){
    const db=new DatabaseSync(sqlite.filename(dir));try{for(const [key,value]of Object.entries(patch))db.prepare('UPDATE metadata SET value=? WHERE key=?').run(String(value),key==='uuid'?'database_uuid':key);}finally{db.close();}
  }else{const file=path.join(dir,identity.FILE);fs.writeFileSync(file,JSON.stringify({...JSON.parse(fs.readFileSync(file,'utf8')),...patch}));}
}
function assertAccounting(dir,expected){
  assert.deepEqual(storage.readAll(dir),expected);const rows=storage.readAll(dir).vehicles;
  assert.equal(rows[0].fuelBalance,923.537);assert.equal(typeof rows[0].id,'number');assert.equal(typeof rows[1].id,'string');
}

test('database identity validation accepts only a versioned UUID and a positive safe generation',()=>{
  const good={format:'tvs-database-identity',version:1,uuid:'8b76c383-e57b-44d8-929b-1e36a8c7c046',generation:1};
  assert.deepEqual(identity.validate(good),good);assert.equal(Object.isFrozen(identity.validate(good)),true);
  for(const value of [null,[],{}, {...good,version:2},{...good,format:'other'},{...good,uuid:'../unsafe'},
    {...good,uuid:good.uuid.toUpperCase()},{...good,generation:0},{...good,generation:-1},{...good,generation:1.5},{...good,generation:'1'},{...good,generation:Number.MAX_SAFE_INTEGER+1}])
    assert.throws(()=>identity.validate(value),error=>error.code==='DATABASE_IDENTITY');
});

for(const format of ['json','sqlite']){
  test(format+': stable identity and database token survive reads without changing typed IDs, litres or legacy orphans',t=>{
    const {dir}=fixture(t,format),expected=storage.readAll(dir),snapshot=storage.readSnapshot(dir),first=readIdentity(dir,format);
    const file=format==='sqlite'?sqlite.filename(dir):path.join(dir,identity.FILE),before=hash(file);
    assert.match(snapshot.databaseToken,/^[a-f0-9]{64}$/);assert.equal(first.generation,1);assert.equal(Object.isFrozen(first),true);
    for(let i=0;i<3;i++){assert.equal(storage.databaseToken(dir),snapshot.databaseToken);assert.deepEqual(readIdentity(dir,format),first);assert.deepEqual(storage.readSnapshot(dir),snapshot);}
    assert.equal(hash(file),before);assertAccounting(dir,expected);
    if(format==='sqlite')assert.equal(fs.existsSync(path.join(dir,identity.FILE)),false);
    else assert.equal(fs.existsSync(sqlite.filename(dir)),false);
  });

  test(format+': replacing a database at the same path changes its token even with identical accounting rows and revisions',t=>{
    const {root,dir}=fixture(t,format),before=storage.readSnapshot(dir),oldIdentity=readIdentity(dir,format),retired=path.join(root,'retired-database');
    const pending={databaseToken:before.databaseToken,base:before.revisions,sections:{records:before.data.records.map(row=>({...row,note:'Old database pending change'}))},operation:{id:'identity-old-pending'}};
    // Both exact paths are under this test-owned temp directory.
    for(const candidate of [dir,retired])assert.equal(path.dirname(path.resolve(candidate)),path.resolve(root));
    fs.renameSync(dir,retired);create(dir,format,before.data,before.revisions);const replacement=storage.readSnapshot(dir);
    assert.notEqual(replacement.databaseToken,before.databaseToken);assert.notEqual(readIdentity(dir,format).uuid,oldIdentity.uuid);
    assert.deepEqual(replacement.data,before.data);assert.deepEqual(replacement.revisions,before.revisions);
    const result=storage.writeSections(dir,pending,{principal:admin});assert.equal(result.ok,false);assert.equal(result.databaseChanged,true);assert.equal(result.databaseToken,replacement.databaseToken);
    assert.deepEqual(storage.readSnapshot(dir),replacement);assertAccounting(dir,before.data);
  });

  test(format+': increasing the identity generation invalidates pending requests without rewriting accounting rows',t=>{
    const {dir}=fixture(t,format),before=storage.readSnapshot(dir),first=readIdentity(dir,format);
    changeIdentity(dir,format,{generation:2});const token=storage.databaseToken(dir),changed=readIdentity(dir,format);
    assert.notEqual(token,before.databaseToken);assert.equal(changed.uuid,first.uuid);assert.equal(changed.generation,2);assertAccounting(dir,before.data);assert.deepEqual(storage.readRevisions(dir),before.revisions);
    const result=storage.writeSections(dir,{databaseToken:before.databaseToken,base:before.revisions,sections:{records:before.data.records},operation:{id:'old-generation'}},{principal:admin});
    assert.equal(result.databaseChanged,true);assertAccounting(dir,before.data);
  });

  test(format+': corrupt persistent identity fails closed and is never silently replaced',t=>{
    const {dir}=fixture(t,format),expected=storage.readAll(dir);storage.databaseToken(dir);changeIdentity(dir,format,{uuid:'invalid-identity',generation:0});
    const file=format==='sqlite'?sqlite.filename(dir):path.join(dir,identity.FILE),before=fs.readFileSync(file);
    for(const action of [()=>storage.databaseToken(dir),()=>storage.readSnapshot(dir),()=>storage.writeSections(dir,{base:{records:0},sections:{records:[]},operation:{id:'corrupt-identity'}},{principal:admin})])
      assert.throws(action,error=>error.code==='DATABASE_IDENTITY');
    assert.deepEqual(fs.readFileSync(file),before);assert.deepEqual(storage.readAll(dir),expected);
  });

  test(format+': different physical path binds a clone to a different token despite an identical persistent identity',t=>{
    const {root,dir}=fixture(t,format),snapshot=storage.readSnapshot(dir),first=readIdentity(dir,format),clone=path.join(root,'cloned-database');
    fs.cpSync(dir,clone,{recursive:true});assert.deepEqual(readIdentity(clone,format),first);
    assert.notEqual(storage.databaseToken(clone),snapshot.databaseToken);assertAccounting(clone,snapshot.data);assertAccounting(dir,snapshot.data);
  });
}

for(const kind of ['malformed-json','oversized','directory','hardlink'])test('JSON identity rejects '+kind+' without replacing the unsafe file',t=>{
  const root=temp(t),dir=path.join(root,'database');fs.mkdirSync(dir);const file=path.join(dir,identity.FILE);
  if(kind==='directory')fs.mkdirSync(file);
  else if(kind==='hardlink'){const source=path.join(root,'linked-identity.json');fs.writeFileSync(source,JSON.stringify({format:'tvs-database-identity',version:1,uuid:crypto.randomUUID(),generation:1}));fs.linkSync(source,file);}
  else fs.writeFileSync(file,kind==='oversized'?' '.repeat(4097):'{broken synthetic json');
  const before=fs.lstatSync(file),bytes=before.isFile()?fs.readFileSync(file):null;
  assert.throws(()=>identity.readOrCreate(dir),error=>error.code==='DATABASE_IDENTITY');
  if(bytes)assert.deepEqual(fs.readFileSync(file),bytes);else assert.equal(fs.statSync(file).isDirectory(),true);
});

test('a junction alias to the same physical JSON database has the same token',t=>{
  const {root,dir}=fixture(t,'json'),alias=path.join(root,'alias'),before=storage.readSnapshot(dir);
  fs.symlinkSync(dir,alias,process.platform==='win32'?'junction':'dir');assert.equal(storage.databaseToken(alias),before.databaseToken);assert.deepEqual(storage.readSnapshot(alias),before);
});

test('SQLite identity requires both persistent metadata keys without synthesizing a replacement',t=>{
  const {dir}=fixture(t,'sqlite'),expected=storage.readAll(dir),db=new DatabaseSync(sqlite.filename(dir));
  try{db.prepare("DELETE FROM metadata WHERE key='database_uuid'").run();}finally{db.close();}
  const before=hash(sqlite.filename(dir));assert.throws(()=>storage.databaseToken(dir),error=>error.code==='DATABASE_IDENTITY');assert.equal(hash(sqlite.filename(dir)),before);assert.deepEqual(storage.readAll(dir),expected);
});
