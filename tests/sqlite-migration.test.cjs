'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const { createRequire } = Module;
const { spawnSync } = require('node:child_process');
const schema = require('../assets/core/platform-schema.js');
const sqlite = require('../electron/sqlite-storage.cjs');
const migration = require('../electron/sqlite-migration.cjs');
const cli = require('../scripts/migrate-sqlite.cjs');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function directories(t) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(),'tvs-sqlite-migration-'));
  t.after(() => {
    const resolved = path.resolve(parent);
    assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('tvs-sqlite-migration-'));
    fs.rmSync(resolved,{recursive:true,force:true});
  });
  const sourceDir = path.join(parent,'source'), targetDir = path.join(parent,'target');
  fs.mkdirSync(sourceDir);
  return {parent,sourceDir,targetDir};
}
function data() {
  return { vehicles:[{id:7,plate:'SYNTHETIC',fuelBalance:-12.345,extra:{nil:null,empty:'',flag:false}},
    {id:'7',plate:'SYNTHETIC-STRING',privateValue:'PRIVATE_PAYLOAD_MUST_NOT_APPEAR_IN_REPORT'}],
    records:[{id:2,vehicleId:7,date:'2026-09-01',km:1.125},{id:'2',vehicleId:'missing-legacy-vehicle',date:'old date',km:-1}],
    monthlyFuel:[{vehicleId:7,month:'2026-09',cardNumber:'123',liters:2.375},{vehicleId:'7',month:'2026-09',cardNumber:'123',liters:3.875}],
    auditLog:[{id:'historical',section:'vehicles',recordId:7,action:'update',before:{id:7,fuelBalance:0},after:{id:7,fuelBalance:-12.345}},
      {id:'operation:legacy',type:'transaction',source:'platform',operationId:'legacy-operation',requestDigest:'sha256:'+ 'a'.repeat(64),databaseToken:'old-database',actorId:'old-user',actorRole:'admin',changedSections:['vehicles'],revisions:{vehicles:9},at:'2026-10-01T00:00:00Z'}] };
}
function split(sourceDir, input = data()) {
  fs.mkdirSync(path.join(sourceDir,'sections'));
  const revisions = {};
  for (const [name,rows] of Object.entries(input)) {
    fs.writeFileSync(path.join(sourceDir,'sections',name+'.json'),JSON.stringify(rows));
    revisions[name] = 10 + Object.keys(revisions).length;
  }
  fs.writeFileSync(path.join(sourceDir,'sections/revisions.json'),JSON.stringify(revisions));
  return { data:Object.fromEntries(schema.sections.map(name=>[name,input[name] || []])),
    revisions:Object.fromEntries(schema.sections.map(name=>[name,revisions[name] ?? 0])) };
}
function tree(directory) {
  const entries = [];
  const visit = (current,relative='') => {
    for (const name of fs.readdirSync(current).sort()) {
      const filename=path.join(current,name),info=fs.lstatSync(filename),key=relative?relative+'/'+name:name;
      if (info.isSymbolicLink()) entries.push({path:key,link:fs.readlinkSync(filename)});
      else if (info.isDirectory()) { entries.push({path:key,type:'directory'});visit(filename,key); }
      else entries.push({path:key,size:info.size,mtimeMs:info.mtimeMs,sha256:hash(fs.readFileSync(filename))});
    }
  };
  visit(directory);return entries;
}
function noStage(parent) {
  assert.deepEqual(fs.readdirSync(parent).filter(name=>name.startsWith('.tvs-sqlite-stage-')),[]);
  const journals=fs.readdirSync(parent).filter(name=>/^\.tvs-migration-[a-f0-9]{64}\.json$/.test(name)).map(name=>JSON.parse(fs.readFileSync(path.join(parent,name),'utf8')));
  for(const name of fs.readdirSync(parent).filter(name=>name.startsWith('.tvs-copy-'))){
    const directory=path.join(parent,name),journal=journals.find(item=>[item.stage,...(item.retainedStages||[])].some(stage=>stage.path===directory));assert.ok(journal,'A retained copy must have its durable journal');const stage=[journal.stage,...(journal.retainedStages||[])].find(item=>item.path===directory);
    const info=fs.lstatSync(directory),owner=JSON.parse(fs.readFileSync(path.join(directory,'.tvs-migration-owner.json'),'utf8'));
    assert.equal(info.isSymbolicLink(),false);assert.equal(String(info.ino),stage.ino);assert.equal(owner.migrationId,journal.migrationId);assert.equal(owner.uuid,journal.identity.uuid);
  }
}
function faultAdapter(overrides) {
  const filename = path.join(__dirname,'../electron/sqlite-migration.cjs'), localRequire = createRequire(filename), instance = new Module(filename,module);
  instance.filename=filename;instance.paths=Module._nodeModulePaths(path.dirname(filename));
  instance.require=name=>name==='./sqlite-storage.cjs'?{...sqlite,...overrides}:localRequire(name);
  instance._compile(fs.readFileSync(filename,'utf8'),filename);
  return instance.exports;
}
function managedFile(sourceDir,directory,bytes,extension) {
  const sha256=hash(bytes),id=sha256+extension;
  fs.mkdirSync(path.join(sourceDir,directory),{recursive:true});
  fs.writeFileSync(path.join(sourceDir,directory,id),bytes);
  return {id,sha256,size:bytes.length,name:'Synthetic source'+extension};
}

test('explicit split JSON copy preserves all 40 sections, typed IDs, order, values, revisions and legacy audit',t=>{
  const paths=directories(t),expected=split(paths.sourceDir),before=tree(paths.sourceDir);
  const report=migration.migrateCopy(paths);
  assert.equal(report.ok,true);assert.equal(report.sourceFormat,'split-json');assert.equal(report.sections.length,schema.sections.length);
  assert.deepEqual(sqlite.readAll(paths.targetDir),expected.data);assert.deepEqual(sqlite.readRevisions(paths.targetDir),expected.revisions);
  assert.deepEqual(tree(paths.sourceDir),before);assert.ok(report.legacyIssueCount>0);
  assert.equal(report.sections.find(section=>section.name==='fuelPurchases').revision,0);
  assert.deepEqual(report.integrity,['ok']);assert.equal(report.foreignKeyErrorCount,0);
  assert.equal(JSON.stringify(report).includes('PRIVATE_PAYLOAD_MUST_NOT_APPEAR_IN_REPORT'),false);
  assert.equal(JSON.stringify(report).includes('missing-legacy-vehicle'),false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(paths.targetDir,'migration-report.json'),'utf8')),report);
  assert.equal(hash(fs.readFileSync(path.join(paths.targetDir,'platform.sqlite'))),report.databaseSha256);
  assert.deepEqual(fs.readdirSync(path.join(paths.targetDir,'sections')),['revisions.json']);
  const guard=JSON.parse(fs.readFileSync(path.join(paths.targetDir,'sections/revisions.json'),'utf8'));
  assert.equal(guard.format,'sqlite');assert.equal(guard.vehicles,null);assert.equal(guard.records,null);
  noStage(paths.parent);
});

test('legacy JSON remains byte-for-byte unchanged while its new copy receives zero initial revisions',t=>{
  const paths=directories(t),input=data();fs.writeFileSync(path.join(paths.sourceDir,'data.json'),JSON.stringify(input,null,2));
  const before=tree(paths.sourceDir),report=migration.migrateCopy(paths);
  assert.equal(report.sourceFormat,'legacy-json');assert.deepEqual(tree(paths.sourceDir),before);
  for (const name of schema.sections) { assert.deepEqual(sqlite.readRows(paths.targetDir,name),input[name] || []);assert.equal(sqlite.readRevisions(paths.targetDir)[name],0); }
  noStage(paths.parent);
});

test('managed attachments, archived import sources and registry knowledge copy with identical bytes and hashes',t=>{
  const paths=directories(t),input=data(),attachmentBytes=Buffer.from('SYNTHETIC ATTACHMENT'),sourceBytes=Buffer.from('SYNTHETIC IMPORT SOURCE');
  const attachment=managedFile(paths.sourceDir,'attachments',attachmentBytes,'.pdf'),source=managedFile(paths.sourceDir,'import-sources',sourceBytes,'.xlsx');
  input.vehicles[0].attachments=[attachment];input.auditLog[0].before.attachments=[attachment];
  input.vehicles[0].importSource={sourceArchive:{available:true,...source}};
  input.records[0].sourceArchives=[{available:true,...source}];
  fs.mkdirSync(path.join(paths.sourceDir,'reestr-knowledge'));
  fs.writeFileSync(path.join(paths.sourceDir,'reestr-knowledge/knowledge.json'),' {"synthetic":"knowledge"}\n');
  fs.writeFileSync(path.join(paths.sourceDir,'attachments/unreferenced-safe.txt'),'Retain orphaned managed files conservatively');
  const expected=split(paths.sourceDir,input),before=tree(paths.sourceDir),report=migration.migrateCopy(paths);
  assert.equal(report.referencedFileCount,2);assert.equal(report.copiedFileCount,4);
  assert.deepEqual(fs.readFileSync(path.join(paths.targetDir,'attachments',attachment.id)),attachmentBytes);
  assert.deepEqual(fs.readFileSync(path.join(paths.targetDir,'import-sources',source.id)),sourceBytes);
  for (const file of report.copiedFiles) assert.equal(hash(fs.readFileSync(path.join(paths.targetDir,...file.path.split('/')))),file.sha256);
  assert.deepEqual(sqlite.readAll(paths.targetDir),expected.data);assert.deepEqual(tree(paths.sourceDir),before);noStage(paths.parent);
});

test('migration rejects existing targets and same, nested or ancestor source/target paths without changing either',t=>{
  const paths=directories(t);split(paths.sourceDir);const before=tree(paths.sourceDir);
  for (const targetDir of [paths.sourceDir,path.join(paths.sourceDir,'nested'),paths.parent])
    assert.throws(()=>migration.migrateCopy({...paths,targetDir}),{code:'MIGRATION_PATH'});
  fs.mkdirSync(paths.targetDir);fs.writeFileSync(path.join(paths.targetDir,'keep.txt'),'Existing target must survive');
  const targetBefore=tree(paths.targetDir);
  assert.throws(()=>migration.migrateCopy(paths),{code:'MIGRATION_TARGET_EXISTS'});
  assert.deepEqual(tree(paths.targetDir),targetBefore);assert.deepEqual(tree(paths.sourceDir),before);noStage(paths.parent);
});

test('UNC, device, drive-relative and implicit paths are rejected before any source data is opened',t=>{
  const paths=directories(t);split(paths.sourceDir);
  for (const sourceDir of ['',undefined,'\\\\server\\share\\database','//server/share/database','\\\\?\\C:\\database','C:database'])
    assert.throws(()=>migration.migrateCopy({...paths,sourceDir}),{code:'MIGRATION_PATH'});
  assert.throws(()=>migration.migrateCopy({...paths,targetDir:'\\\\server\\share\\target'}),{code:'MIGRATION_PATH'});
  assert.equal(fs.existsSync(paths.targetDir),false);noStage(paths.parent);
});

test('source directory aliases and managed-directory links are rejected without following their contents',t=>{
  const paths=directories(t);split(paths.sourceDir);
  const alias=path.join(paths.parent,'alias');
  try { fs.symlinkSync(paths.sourceDir,alias,process.platform==='win32'?'junction':'dir'); }
  catch(error) { if (['EPERM','EACCES'].includes(error.code)) { t.skip('Directory links unavailable');return; } throw error; }
  assert.throws(()=>migration.migrateCopy({...paths,sourceDir:alias}),{code:'MIGRATION_PATH'});
  const outside=path.join(paths.parent,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'untouched.txt'),'Untouched');
  fs.symlinkSync(outside,path.join(paths.sourceDir,'attachments'),process.platform==='win32'?'junction':'dir');
  assert.throws(()=>migration.migrateCopy(paths),{code:'MIGRATION_SOURCE_FILE'});
  assert.equal(fs.readFileSync(path.join(outside,'untouched.txt'),'utf8'),'Untouched');assert.equal(fs.existsSync(paths.targetDir),false);noStage(paths.parent);
});

for (const relative of ['.tvs-database.lock','.tvs-database.lock.recovery','sections/.transaction.json','platform.sqlite']) {
  test('migration refuses a busy, interrupted or already-SQLite source: '+relative,t=>{
    const paths=directories(t);split(paths.sourceDir);fs.writeFileSync(path.join(paths.sourceDir,...relative.split('/')),'{}');const before=tree(paths.sourceDir);
    assert.throws(()=>migration.migrateCopy(paths),{code:relative==='platform.sqlite'?'MIGRATION_SOURCE_SQLITE':'MIGRATION_SOURCE_BUSY'});
    assert.deepEqual(tree(paths.sourceDir),before);assert.equal(fs.existsSync(paths.targetDir),false);noStage(paths.parent);
  });
}

test('missing or malformed split files are not replaced with legacy data or silent empty sections',t=>{
  const cases=[
    source=>fs.unlinkSync(path.join(source,'sections/revisions.json')),
    source=>fs.unlinkSync(path.join(source,'sections/records.json')),
    source=>fs.writeFileSync(path.join(source,'sections/vehicles.json'),'[null]'),
    source=>fs.writeFileSync(path.join(source,'sections/revisions.json'),'{"vehicles":1,"records":-1}'),
    source=>fs.writeFileSync(path.join(source,'sections/unknown-future.json'),'[]'),
  ];
  for (const corrupt of cases) {
    const paths=directories(t);split(paths.sourceDir);fs.writeFileSync(path.join(paths.sourceDir,'data.json'),JSON.stringify(data()));corrupt(paths.sourceDir);
    const before=tree(paths.sourceDir);assert.throws(()=>migration.migrateCopy(paths),error=>error.code.startsWith('MIGRATION_SOURCE_'));
    assert.deepEqual(tree(paths.sourceDir),before);assert.equal(fs.existsSync(paths.targetDir),false);noStage(paths.parent);
  }
});

test('unsafe JSON fields, numeric overflow and excessive depth are rejected without domain normalization',t=>{
  const deep={};let cursor=deep;for(let index=0;index<105;index++){cursor.next={};cursor=cursor.next;}
  for (const raw of ['{"vehicles":[{"id":"v","fuelBalance":1e400}],"records":[]}',
    '{"vehicles":[{"id":"v","__proto__":{"unsafe":true}}],"records":[]}',
    JSON.stringify({vehicles:[{id:'v',deep}],records:[]})]) {
    const paths=directories(t);fs.writeFileSync(path.join(paths.sourceDir,'data.json'),raw);const before=tree(paths.sourceDir);
    assert.throws(()=>migration.migrateCopy(paths),{code:'MIGRATION_SOURCE_JSON_SHAPE'});
    assert.deepEqual(tree(paths.sourceDir),before);assert.equal(fs.existsSync(paths.targetDir),false);noStage(paths.parent);
  }
});

test('missing attachments, traversal references and mismatched managed file hashes cannot produce a partial target',t=>{
  for (const kind of ['missing','traversal','hash']) {
    const paths=directories(t),input=data();let attachment;
    if(kind==='traversal')attachment={id:'../../outside.pdf'};
    else if(kind==='missing')attachment={id:'a'.repeat(64)+'.pdf'};
    else {attachment=managedFile(paths.sourceDir,'attachments',Buffer.from('Original'),'.pdf');fs.writeFileSync(path.join(paths.sourceDir,'attachments',attachment.id),'Changed');}
    input.vehicles[0].attachments=[attachment];split(paths.sourceDir,input);const before=tree(paths.sourceDir);
    assert.throws(()=>migration.migrateCopy(paths),error=>error.code.startsWith('MIGRATION_FILE_'));
    assert.deepEqual(tree(paths.sourceDir),before);assert.equal(fs.existsSync(paths.targetDir),false);noStage(paths.parent);
  }
});

test('a failed SQLite creation retains only a journal-owned resumable stage',t=>{
  const paths=directories(t);split(paths.sourceDir);const before=tree(paths.sourceDir);
  const failing=faultAdapter({create(stage,payload){sqlite.create(stage,payload);throw Error('Synthetic failure after SQLite commit');}});
  assert.throws(()=>failing.migrateCopy(paths),{code:'MIGRATION_FAILED'});
  assert.deepEqual(tree(paths.sourceDir),before);assert.equal(fs.existsSync(paths.targetDir),false);noStage(paths.parent);
});

test('parity and SQLite integrity failures retain owned staging without publishing a destination',t=>{
  for (const mode of ['parity','integrity']) {
    const paths=directories(t);split(paths.sourceDir);const before=tree(paths.sourceDir);
    const failing=mode==='parity'?faultAdapter({readAll(stage){const result=sqlite.readAll(stage);result.vehicles.reverse();return result;}}):
      faultAdapter({inspect(stage){return {...sqlite.inspect(stage),foreignKeyErrors:[{synthetic:true}]};}});
    assert.throws(()=>failing.migrateCopy(paths),{code:mode==='parity'?'MIGRATION_PARITY':'MIGRATION_SQLITE_INTEGRITY'});
    assert.deepEqual(tree(paths.sourceDir),before);assert.equal(fs.existsSync(paths.targetDir),false);noStage(paths.parent);
  }
});

test('any source file change during migration is detected and never overwritten or published',t=>{
  const paths=directories(t);split(paths.sourceDir);const filename=path.join(paths.sourceDir,'sections/records.json'),original=fs.readFileSync(filename,'utf8');
  const racing=faultAdapter({create(stage,payload){sqlite.create(stage,payload);fs.appendFileSync(filename,'\n');}});
  assert.throws(()=>racing.migrateCopy(paths),{code:'MIGRATION_SOURCE_CHANGED'});
  assert.equal(fs.readFileSync(filename,'utf8'),original+'\n');assert.equal(fs.existsSync(paths.targetDir),false);noStage(paths.parent);
});

test('CLI requires explicit source and target and does not default to any application profile',t=>{
  for (const args of [[],['--source','a'],['--target','b'],['--source','a','--target','b','--force'],['--source','a','--source','b','--target','c']])
    assert.throws(()=>cli.parseArgs(args));
  assert.deepEqual(cli.parseArgs(['--source','a','--target','b']),{sourceDir:'a',targetDir:'b'});
  const paths=directories(t);split(paths.sourceDir);const before=tree(paths.sourceDir);
  const result=spawnSync(process.execPath,[path.join(__dirname,'../scripts/migrate-sqlite.cjs'),'--source',paths.sourceDir,'--target',paths.targetDir],
    {encoding:'utf8',windowsHide:true,env:{...process.env,NODE_NO_WARNINGS:'1'}});
  assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).ok,true);
  assert.deepEqual(tree(paths.sourceDir),before);noStage(paths.parent);
});
