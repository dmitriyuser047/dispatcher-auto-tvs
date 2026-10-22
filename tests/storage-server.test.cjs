const {writerHeaders}=require('./helpers/http-writer.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const storage = require('../electron/storage');
const operationStore = require('../electron/operation-store.cjs');
const server = require('../electron/server');

function database() {
  return { ...Object.fromEntries(storage.SECTIONS.map(n => [n, []])), vehicles: [{ id: 'v', driver: 'Уренгой' }], records: [{ id: 'r', vehicleId: 'v', date: '2026-09-01', km: 100 }] };
}
function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tvs-storage-test-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('tvs-storage-test-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
test('corrupt or missing working section never becomes empty or writable', t => {
  const dir = temp(t); storage.writeAll(dir, database());
  const file = storage.sectionFile(dir, 'records'), bad = '[{"id":"important"}';
  fs.writeFileSync(file, bad);
  assert.throws(() => storage.readAll(dir), /records/);
  assert.throws(() => storage.writeAll(dir, database()), /records/);
  assert.throws(() => storage.writeSections(dir, { sections: { records: [] }, base: {} }), /records/);
  assert.equal(fs.readFileSync(file, 'utf8'), bad);
  fs.unlinkSync(file); assert.throws(() => storage.readAll(dir), /records/);
});
test('loss of current-schema revisions stops reads and preserves newer split data instead of reconstructing metadata or replaying old legacy data', t => {
  const dir = temp(t), db = database(); storage.writeAll(dir, db);
  fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify({ ...db, records: [{ id: 'OLD' }] }));
  fs.unlinkSync(storage.revisionsFile(dir));
  const bytes=fs.readFileSync(storage.sectionFile(dir,'records'));
  assert.throws(()=>storage.readAll(dir),{code:'STORAGE_REVISIONS'});
  assert.throws(()=>storage.readRevisions(dir),{code:'STORAGE_REVISIONS'});
  assert.deepEqual(fs.readFileSync(storage.sectionFile(dir,'records')),bytes);assert.equal(JSON.parse(bytes)[0].id,'r');assert.equal(fs.existsSync(storage.revisionsFile(dir)),false);
});
test('incomplete split database cannot be replaced by legacy or empty data', t => {
  const dir = temp(t); fs.mkdirSync(storage.sectionsDir(dir));
  fs.writeFileSync(storage.sectionFile(dir, 'vehicles'), '[{"id":"keep"}]');
  assert.throws(() => storage.readAll(dir), /Неполный/);
  assert.equal(fs.readFileSync(storage.sectionFile(dir, 'vehicles'), 'utf8'), '[{"id":"keep"}]');
});
test('older split schema gains only new optional sections without losing existing data', t => {
  const dir = temp(t); fs.mkdirSync(storage.sectionsDir(dir));
  fs.writeFileSync(storage.sectionFile(dir, 'vehicles'), '[{"id":"v"}]');
  fs.writeFileSync(storage.sectionFile(dir, 'records'), '[{"id":"r"}]');
  fs.writeFileSync(storage.revisionsFile(dir), '{"vehicles":4,"records":7}');
  const loaded = storage.readAll(dir);
  assert.equal(loaded.records[0].id, 'r'); assert.equal(loaded.vehicles[0].id, 'v');
  assert.deepEqual(loaded.appMeta, []); assert.equal(storage.readRevisions(dir).records, 7);
});
test('invalid full writes are rejected and absent optional sections are preserved', t => {
  const dir = temp(t), db = database(); db.repairs = [{ id: 'repair' }]; storage.writeAll(dir, db);
  assert.throws(() => storage.writeAll(dir, {}), /Неполная/);
  assert.throws(() => storage.writeAll(dir, { ...db, records: null }), /Неполная/);
  storage.writeAll(dir, { vehicles: db.vehicles, records: db.records });
  assert.equal(storage.readAll(dir).repairs[0].id, 'repair');
});
test('disk error during multi-section commit rolls back rows and revisions', t => {
  const dir = temp(t), db = database(); storage.writeAll(dir, db);
  const baseline = storage.readAll(dir);
  const revs = storage.readRevisions(dir),state=operationStore.readState(dir),rename=fs.renameSync;let injected=false;
  try{fs.renameSync=function(src,dst){if(!injected&&path.resolve(dst)===path.resolve(storage.sectionFile(dir,'records'))){injected=true;throw Error('disk failure');}return rename.apply(this,arguments);};assert.throws(()=>storage.writeSections(dir,{base:revs,sections:{vehicles:baseline.vehicles.map(row=>({...row,note:'Synthetic next vehicle'})),records:baseline.records.map(row=>({...row,km:101}))}}),/disk failure/);}finally{fs.renameSync=rename;}
  assert.equal(injected,true);
  assert.deepEqual(storage.readAll(dir), baseline);
  assert.deepEqual(storage.readRevisions(dir), revs);
  assert.deepEqual(operationStore.readState(dir),state);
});
function interruptedSave(dir,phase){const before=storage.readSnapshot(dir),payload={databaseToken:before.databaseToken,base:before.revisions,sections:{vehicles:before.data.vehicles.map(row=>({...row,note:'committed'})),records:before.data.records.map(row=>({...row,km:101}))},operation:{id:'restart-'+phase}},script=String.raw`const storage=require(process.argv[1]),fs=require('node:fs'),path=require('node:path'),dir=process.argv[2],payload=JSON.parse(process.argv[3]),phase=process.argv[4],rename=fs.renameSync,target=phase==='before'?storage.sectionFile(dir,'vehicles'):storage.revisionsFile(dir);fs.renameSync=function(src,dst){const result=rename.apply(this,arguments);if(path.resolve(dst)===path.resolve(target))process.exit(71);return result;};storage.writeSections(dir,payload);process.exit(99);`,result=spawnSync(process.execPath,['-e',script,require.resolve('../electron/storage.js'),dir,JSON.stringify(payload),phase],{windowsHide:true,timeout:30000,encoding:'utf8',maxBuffer:1024*1024});assert.equal(result.status,71,result.stderr||result.error?.message||result.stdout);assert.equal(fs.existsSync(path.join(storage.sectionsDir(dir),'.transaction.json')),true);return payload;}
test('restart rolls back an interrupted transaction before exposing sections', t => {
  const dir = temp(t), db = database(); storage.writeAll(dir, db);
  const baseline = storage.readAll(dir),base=storage.readRevisions(dir),state=operationStore.readState(dir);interruptedSave(dir,'before');
  assert.equal(JSON.parse(fs.readFileSync(storage.sectionFile(dir,'vehicles')))[0].note,'committed');assert.equal(JSON.parse(fs.readFileSync(storage.sectionFile(dir,'records')))[0].km,100);
  assert.deepEqual(storage.readAll(dir), baseline); assert.deepEqual(storage.readRevisions(dir), base);
  assert.deepEqual(operationStore.readState(dir),state);assert.equal(operationStore.engine(dir).inspectReceipt(state.head,'restart-before'),null);
});
test('restart finishes a transaction only after its revision commit point', t => {
  const dir = temp(t), db = database(); storage.writeAll(dir, db);
  const base=storage.readRevisions(dir),state=operationStore.readState(dir);interruptedSave(dir,'after');const revisions={...base,vehicles:base.vehicles+1,records:base.records+1,auditLog:base.auditLog+1};
  assert.equal(storage.readAll(dir).vehicles[0].note,'committed');assert.equal(storage.readAll(dir).records[0].km,101);
  assert.deepEqual(storage.readRevisions(dir), revisions);
  const committed=operationStore.readState(dir);assert.notEqual(committed.transactionId,state.transactionId);assert.equal(operationStore.engine(dir).inspectReceipt(committed.head,'restart-after').kind,'receipt');assert.equal(storage.readAll(dir).auditLog.filter(row=>row.type==='transaction'&&row.operationId==='restart-after').length,1);
});
test('closed periods are guarded in storage, including bulk and legacy writes', t => {
  const dir = temp(t), db = database(); db.fuelPeriods = [{ month: '2026-09', closed: true }]; require('./period-test-support.cjs').seedDatabase(dir,db);
  const before=storage.readSnapshot(dir);
  assert.throws(() => storage.writeAll(dir, { ...storage.readAll(dir), records: [] }), /закрыт/);
  assert.throws(() => storage.writeSections(dir, { base: storage.readRevisions(dir), sections: { records: [] } }), /закрыт/);
  assert.throws(()=>storage.writeSections(dir, { base: storage.readRevisions(dir), sections: { fuelPeriods: [] } }));
  assert.deepEqual(storage.readSnapshot(dir),before);
});

const key = 'test-key-not-a-real-secret-123456';
async function request(port, route, body, headers = { Authorization: 'Bearer ' + key }, split) {
 const currentBody=JSON.stringify(body);
 const proofHeaders=await writerHeaders({host:'127.0.0.1',port:port,headers:headers,method:body==null?'GET':'POST'});

  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: route, method: body == null ? 'GET' : 'POST', headers:{...proofHeaders,...headers} }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', part => { text += part; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    });
    req.on('error', reject);
    if (body == null) req.end();
    else if (split != null) { const b = Buffer.from(currentBody); req.write(b.subarray(0, split)); setTimeout(() => req.end(b.subarray(split)), 10); }
    else req.end(currentBody);
  });
}
test('authenticated server preserves split UTF-8 and survives malformed and aborted POSTs', async t => {
  const dir = temp(t), db = database(); storage.writeAll(dir, db);
  const started = await server.start({ port: 0, dataDir: dir, key }); assert.equal(started.ok, true);
  t.after(() => server.stop()); const port = started.port;
  assert.equal((await request(port, '/api/data', null, {})).status, 401);
  assert.equal((await request(port, '/api/data', {}, {})).status, 401);
  assert.equal((await request(port, '/api/data', null, { Authorization: 'Bearer ' + key, Origin: 'https://untrusted.invalid' })).status, 401);
  assert.equal((await request(port, '/api/data', {})).status, 400);
  for (const route of ['/api/data', '/api/sections']) {
    const rows = [{ id: 'v', driver: 'Уренгой Ёж 中文' }];
    const payload = route.endsWith('sections') ? { databaseToken:storage.databaseToken(dir), base: storage.readRevisions(dir), sections: { vehicles: rows } } : { databaseToken:storage.databaseToken(dir), base:storage.readRevisions(dir), data:{ ...storage.readAll(dir), vehicles: rows } };
    const bytes = Buffer.from(JSON.stringify(payload)), split = bytes.indexOf(Buffer.from('У')) + 1;
    assert.equal((await request(port, route, payload, undefined, split)).status, 200);
    assert.equal(storage.readAll(dir).vehicles[0].driver, rows[0].driver);
  }
  const abortedProofHeaders=await writerHeaders({port,headers:{Authorization:'Bearer '+key}});
  await new Promise(resolve => {
    const req = http.request({ host: '127.0.0.1', port, path: '/api/sections', method: 'POST', headers: {...abortedProofHeaders, Authorization: 'Bearer ' + key } });
    req.on('error', () => {}); req.on('close', resolve); req.write('{'); setTimeout(() => req.destroy(), 20);
  });
  const payload = { databaseToken:storage.databaseToken(dir), base: storage.readRevisions(dir), sections: { records: [] } };
  assert.equal((await request(port, '/api/sections', payload)).status, 200);
  server.configureKey(key); assert.ok(JSON.parse(await server.fetchData('127.0.0.1', port)).vehicles.length);
  server.configureKey('wrong'); await assert.rejects(server.fetchData('127.0.0.1', port), /401/);
});
