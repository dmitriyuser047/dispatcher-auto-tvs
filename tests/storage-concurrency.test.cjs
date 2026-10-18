const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const storage = require('../electron/storage');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tvs-lock-test-'));
  t.after(() => { assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir())); assert.ok(path.basename(dir).startsWith('tvs-lock-test-')); fs.rmSync(dir, { recursive:true, force:true }); });
  const data = { vehicles:[{id:'v', fuelBalance:0}], records:[{id:'r', date:'2026-09-01', vehicleId:'v', km:1}] };
  storage.writeAll(dir,data);
  return { dir, data:storage.readAll(dir), revisions:storage.readRevisions(dir) };
}
const writerCode = String.raw`
const fs=require('node:fs'),path=require('node:path');
const storage=require(process.argv[1]),dir=process.argv[2],stage=process.argv[3],release=process.argv[4];
const snapshot=storage.readSnapshot(dir),rename=fs.renameSync;
fs.renameSync=(src,dst)=>{rename(src,dst);if(dst===storage.sectionFile(dir,stage)||stage==='revisions'&&dst===storage.revisionsFile(dir)){process.stdout.write('HALFWAY\n');while(!fs.existsSync(release))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,25);}};
const result=storage.writeSections(dir,{base:snapshot.revisions,databaseToken:snapshot.databaseToken,sections:{vehicles:[{id:'v',fuelBalance:0,note:'new'}],records:[{id:'r',date:'2026-09-01',vehicleId:'v',km:2}]}});
if(!result.ok)throw Error(JSON.stringify(result));
`;
async function suspendedWriter(t, dir, stage) {
  const release=path.join(dir,'release-writer');
  const child=spawn(process.execPath,['-e',writerCode,require.resolve('../electron/storage'),dir,stage,release],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let error='';child.stderr.on('data',part=>{error+=part;});
  const exited=once(child,'exit');
  t.after(async()=>{if(child.exitCode==null&&child.signalCode==null)child.kill('SIGKILL');await exited;});
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Writer did not reach checkpoint: '+error)),10000);child.stdout.on('data',part=>{if(String(part).includes('HALFWAY')){clearTimeout(timeout);resolve();}});child.once('exit',(code)=>{clearTimeout(timeout);reject(Error('Writer exited '+code+': '+error));});});
  return {child,exited,release};
}

test('a second process cannot read, recover or write a live transaction', async t => {
  const {dir,revisions}=fixture(t), writer=await suspendedWriter(t,dir,'vehicles');
  assert.equal(JSON.parse(fs.readFileSync(storage.sectionFile(dir,'vehicles'),'utf8'))[0].note,'new');
  assert.equal(JSON.parse(fs.readFileSync(storage.sectionFile(dir,'records'),'utf8'))[0].km,1);
  assert.throws(()=>storage.readAll(dir),error=>error.code==='DB_BUSY');
  assert.throws(()=>storage.writeSections(dir,{base:revisions,sections:{records:[]}}),error=>error.code==='DB_BUSY');
  assert.ok(fs.existsSync(path.join(storage.sectionsDir(dir),'.transaction.json')));
  fs.writeFileSync(writer.release,'release');
  const [code]=await writer.exited;assert.equal(code,0);
  const final=storage.readSnapshot(dir);
  assert.equal(final.data.vehicles[0].note,'new');assert.equal(final.data.records[0].km,2);
  assert.equal(final.revisions.records,revisions.records+1);
  assert.equal(fs.existsSync(path.join(dir,'.tvs-database.lock')),false);
});

test('a crashed writer lock is reclaimed on the same host and incomplete data rolls back', async t => {
  const {dir,data,revisions}=fixture(t), writer=await suspendedWriter(t,dir,'vehicles');
  writer.child.kill('SIGKILL');await writer.exited;
  assert.ok(fs.existsSync(path.join(dir,'.tvs-database.lock')));
  assert.deepEqual(storage.readAll(dir),data);
  assert.deepEqual(storage.readRevisions(dir),revisions);
  assert.equal(fs.existsSync(path.join(dir,'.tvs-database.lock')),false);
  assert.equal(fs.existsSync(path.join(dir,'.tvs-database.lock.recovery')),false);
});

test('a crash after the revision commit point preserves the complete new transaction', async t => {
  const {dir,revisions}=fixture(t), writer=await suspendedWriter(t,dir,'revisions');
  writer.child.kill('SIGKILL');await writer.exited;
  const recovered=storage.readSnapshot(dir);
  assert.equal(recovered.data.vehicles[0].note,'new');assert.equal(recovered.data.records[0].km,2);
  assert.equal(recovered.revisions.records,revisions.records+1);
  assert.equal(fs.existsSync(path.join(storage.sectionsDir(dir),'.transaction.json')),false);
});

test('unknown and foreign host locks are never automatically removed', t => {
  const {dir}=fixture(t),file=path.join(dir,'.tvs-database.lock');
  const foreign={host:os.hostname()+'-other',pid:99999999,nonce:'foreign'};
  fs.writeFileSync(file,JSON.stringify(foreign));
  assert.throws(()=>storage.readAll(dir),error=>error.code==='DB_BUSY'&&error.message.toLowerCase().includes(file.toLowerCase()));
  assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),foreign);
});

test('database tokens bind physical directories including directory aliases', t => {
  const {dir}=fixture(t),other=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-lock-test-'));
  t.after(()=>{assert.equal(path.dirname(path.resolve(other)),path.resolve(os.tmpdir()));assert.ok(path.basename(other).startsWith('tvs-lock-test-'));fs.rmSync(other,{recursive:true,force:true});});
  const alias=path.join(other,'alias');fs.symlinkSync(dir,alias,process.platform==='win32'?'junction':'dir');
  assert.equal(storage.databaseToken(dir),storage.databaseToken(alias));
  assert.notEqual(storage.databaseToken(dir),storage.databaseToken(other));
  const snapshot=storage.readSnapshot(dir);
  const rejected=storage.writeSections(dir,{base:snapshot.revisions,databaseToken:storage.databaseToken(other),sections:{records:[]}});
  assert.equal(rejected.databaseChanged,true);assert.equal(storage.readAll(dir).records.length,1);
});
