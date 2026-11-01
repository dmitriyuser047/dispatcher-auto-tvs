'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const sqlite=require('../electron/sqlite-storage.cjs'),access=require('../electron/access-control.js');
const backupService=require('../electron/backup-service.cjs'),backend=require('../electron/server.js');
const {buildRuntime,startRuntime}=require('../web/local-runtime.cjs');
const {DatabaseSync}=require('node:sqlite');

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-web-local-runtime-'));
  const dataDir=path.join(root,'db'),usersFile=path.join(root,'users.json'),stateDir=path.join(root,'state'),configPath=path.join(root,'config.json');
  sqlite.create(dataDir,{data:{vehicles:[{id:0,plate:'SYNTHETIC-LOCAL-ZERO',odometer:0}],records:[{id:'local-zero',vehicleId:0,date:'2026-10-26',km:0,odoStart:0,odoEnd:0}]}});
  const issued=access.issueToken();
  const users=[{id:'local-admin',name:'Synthetic local owner',role:'admin',enabled:true,tokenHash:issued.tokenHash}];
  fs.writeFileSync(usersFile,JSON.stringify(users));
  const config={dataDir,usersFile,stateDir,port:0};
  const writeConfig=patch=>fs.writeFileSync(configPath,JSON.stringify({...config,...patch}));
  writeConfig({});
  t.after(()=>{
    const absolute=fs.realpathSync(root),parent=fs.realpathSync(os.tmpdir());
    assert.equal(path.dirname(absolute),parent);
    assert.match(path.basename(absolute),/^tvs-web-local-runtime-/);
    assert.equal(fs.lstatSync(root).isSymbolicLink(),false);
    fs.rmSync(absolute,{recursive:true,force:true});
  });
  return {root,...config,configPath,token:issued.token,writeConfig};
}
function call(port,route,{payload,cookie}={}) {
  return new Promise((resolve,reject)=>{
    const raw=payload===undefined?null:JSON.stringify(payload);
    const req=http.request({host:'127.0.0.1',port,path:route,method:raw?'POST':'GET',headers:{...(raw?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(raw)}:{}),...(cookie?{Cookie:cookie}:{})}},res=>{
      let text='';res.setEncoding('utf8');res.on('data',part=>text+=part);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text),headers:res.headers}));
    });
    req.setTimeout(10000,()=>req.destroy(Error('Synthetic local runtime timeout')));req.on('error',reject);req.end(raw);
  });
}

test('local runtime preflight checks explicit private paths and makes no state or backup directories',t=>{
  const f=fixture(t),before=fs.readFileSync(path.join(f.dataDir,'platform.sqlite'));
  const built=buildRuntime(f.configPath);
  assert.equal(built.config.dataDir,f.dataDir);
  assert.deepEqual(built.backup,{directory:path.join(f.dataDir,'backups'),keep:30});
  assert.equal(built.settings().serverUsers.length,1);
  assert.equal(fs.existsSync(f.stateDir),false);
  assert.equal(fs.existsSync(path.join(f.dataDir,'backups')),false);
  assert.deepEqual(fs.readFileSync(path.join(f.dataDir,'platform.sqlite')),before);
  f.writeConfig({stateDir:path.resolve(__dirname,'../web/public/private-state')});
  assert.throws(()=>buildRuntime(f.configPath),{code:'WEB_CONFIG_PUBLIC_PATH'});
  f.writeConfig({stateDir:path.join(f.dataDir,'pending')});
  assert.throws(()=>buildRuntime(f.configPath),{code:'WEB_CONFIG_STATE'});
  f.writeConfig({host:'0.0.0.0'});
  assert.throws(()=>buildRuntime(f.configPath),{code:'WEB_NETWORK_CONFIG'});
  f.writeConfig({exposeWithoutLogin:true});
  assert.throws(()=>buildRuntime(f.configPath),{code:'WEB_CONFIG_INVALID'});
});

test('an old or invalid database stops before backup creation and HTTP startup without auto migration',async t=>{
  const f=fixture(t),filename=path.join(f.dataDir,'platform.sqlite');
  const db=new DatabaseSync(filename);db.exec('PRAGMA user_version=5');db.close();
  const before=fs.readFileSync(filename);
  await assert.rejects(startRuntime(f.configPath),{code:'WEB_DATABASE_SCHEMA'});
  assert.equal(backend.isRunning(),false);
  assert.equal(fs.existsSync(f.stateDir),false);
  assert.equal(fs.existsSync(path.join(f.dataDir,'backups')),false);
  assert.deepEqual(fs.readFileSync(filename),before);
});

test('a verified real backup precedes live startup and business rows remain unchanged',async t=>{
  const f=fixture(t),before=sqlite.readAll(f.dataDir),revisions=sqlite.readRevisions(f.dataDir);
  const runtime=await startRuntime(f.configPath);t.after(()=>runtime.close());
  assert.equal(runtime.config.dataDir,f.dataDir);
  const checked=backupService.verifyPackage({archivePath:runtime.backupPath});
  assert.equal(checked.ok,true);assert.equal(checked.sourceFormat,'sqlite');
  assert.deepEqual(sqlite.readAll(f.dataDir),before);assert.deepEqual(sqlite.readRevisions(f.dataDir),revisions);
  const login=await call(runtime.port,'/web-api/login',{payload:{token:f.token}});
  assert.equal(login.status,200);
  const cookie=login.headers['set-cookie'][0].split(';')[0];
  const boot=await call(runtime.port,'/web-api/bootstrap',{cookie});
  assert.equal(boot.status,200);assert.equal(boot.body.demo,false);
  assert.doesNotMatch(JSON.stringify(boot.body),new RegExp(f.token));
  fs.writeFileSync(f.usersFile,'invalid accounts');
  const revoked=await call(runtime.port,'/web-api/bootstrap',{cookie});
  assert.equal(revoked.status,401);
  assert.deepEqual(sqlite.readAll(f.dataDir),before);
});

test('a corrupt existing daily backup refuses startup instead of silently bypassing backup',async t=>{
  const f=fixture(t),folder=path.join(f.dataDir,'backups');fs.mkdirSync(folder);
  const archive=path.join(folder,'data_'+new Date().toISOString().slice(0,10)+'.zip');
  fs.writeFileSync(archive,'SYNTHETIC-CORRUPT-BACKUP');
  const before=sqlite.readAll(f.dataDir);
  await assert.rejects(startRuntime(f.configPath));
  assert.equal(backend.isRunning(),false);assert.equal(fs.existsSync(f.stateDir),false);
  assert.equal(fs.readFileSync(archive,'utf8'),'SYNTHETIC-CORRUPT-BACKUP');
  assert.deepEqual(sqlite.readAll(f.dataDir),before);
});
