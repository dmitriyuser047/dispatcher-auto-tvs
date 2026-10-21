const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const storage = require('../electron/storage');
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
test('loss of revisions preserves newer split data instead of rerunning legacy migration', t => {
  const dir = temp(t), db = database(); storage.writeAll(dir, db);
  fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify({ ...db, records: [{ id: 'OLD' }] }));
  fs.unlinkSync(storage.revisionsFile(dir));
  assert.equal(storage.readAll(dir).records[0].id, 'r');
  assert.ok(storage.readRevisions(dir).records > 1000);
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
  const revs = storage.readRevisions(dir); let fail = true;
  const proxy = new Proxy(fs, { get(target, key) {
    if (key === 'renameSync') return (src, dst) => { if (fail && dst === storage.sectionFile(dir, 'records')) { fail = false; throw Error('disk failure'); } return fs.renameSync(src, dst); };
    return target[key];
  } });
  const storageRequire = createRequire(path.join(__dirname, '../electron/storage.js'));
  const ctx = { require: id => id === 'fs' ? proxy : storageRequire(id), module: { exports: {} }, console };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron/storage.js'), 'utf8'), ctx);
  assert.throws(() => ctx.module.exports.writeSections(dir, { base: revs, sections: { vehicles: [{ id: 'changed' }], records: [{ id: 'new' }] } }), /disk failure/);
  assert.deepEqual(storage.readAll(dir), baseline);
  assert.deepEqual(storage.readRevisions(dir), revs);
});
test('restart rolls back an interrupted transaction before exposing sections', t => {
  const dir = temp(t), db = database(); storage.writeAll(dir, db);
  const baseline = storage.readAll(dir);
  const base = storage.readRevisions(dir), revisions = { ...base, vehicles: base.vehicles + 1, records: base.records + 1 };
  const tx = { before: { vehicles: db.vehicles, records: db.records }, sections: { vehicles: [{ id: 'new-v' }], records: [{ id: 'new-r' }] }, base, revisions };
  fs.writeFileSync(path.join(storage.sectionsDir(dir), '.transaction.json'), JSON.stringify(tx));
  fs.writeFileSync(storage.sectionFile(dir, 'vehicles'), JSON.stringify(tx.sections.vehicles));
  assert.deepEqual(storage.readAll(dir), baseline); assert.deepEqual(storage.readRevisions(dir), base);
});
test('restart finishes a transaction only after its revision commit point', t => {
  const dir = temp(t), db = database(); storage.writeAll(dir, db);
  const base = storage.readRevisions(dir), revisions = { ...base, vehicles: base.vehicles + 1 };
  const tx = { before: { vehicles: db.vehicles }, sections: { vehicles: [{ id: 'committed' }] }, base, revisions };
  fs.writeFileSync(path.join(storage.sectionsDir(dir), '.transaction.json'), JSON.stringify(tx));
  fs.writeFileSync(storage.revisionsFile(dir), JSON.stringify(revisions));
  assert.equal(storage.readAll(dir).vehicles[0].id, 'committed');
  assert.deepEqual(storage.readRevisions(dir), revisions);
});
test('closed periods are guarded in storage, including bulk and legacy writes', t => {
  const dir = temp(t), db = database(); db.fuelPeriods = [{ month: '2026-09', closed: true }]; storage.writeAll(dir, db);
  assert.throws(() => storage.writeAll(dir, { ...storage.readAll(dir), records: [] }), /закрыт/);
  assert.throws(() => storage.writeSections(dir, { base: storage.readRevisions(dir), sections: { records: [] } }), /закрыт/);
  storage.writeSections(dir, { base: storage.readRevisions(dir), sections: { fuelPeriods: [] } });
  assert.equal(storage.writeSections(dir, { base: storage.readRevisions(dir), sections: { records: [] } }).ok, true);
});

const key = 'test-key-not-a-real-secret-123456';
function request(port, route, body, headers = { Authorization: 'Bearer ' + key }, split) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: route, method: body == null ? 'GET' : 'POST', headers }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', part => { text += part; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    });
    req.on('error', reject);
    if (body == null) req.end();
    else if (split != null) { const b = Buffer.from(JSON.stringify(body)); req.write(b.subarray(0, split)); setTimeout(() => req.end(b.subarray(split)), 10); }
    else req.end(JSON.stringify(body));
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
  await new Promise(resolve => {
    const req = http.request({ host: '127.0.0.1', port, path: '/api/sections', method: 'POST', headers: { Authorization: 'Bearer ' + key } });
    req.on('error', () => {}); req.on('close', resolve); req.write('{'); setTimeout(() => req.destroy(), 20);
  });
  const payload = { databaseToken:storage.databaseToken(dir), base: storage.readRevisions(dir), sections: { records: [] } };
  assert.equal((await request(port, '/api/sections', payload)).status, 200);
  server.configureKey(key); assert.ok(JSON.parse(await server.fetchData('127.0.0.1', port)).vehicles.length);
  server.configureKey('wrong'); await assert.rejects(server.fetchData('127.0.0.1', port), /401/);
});
