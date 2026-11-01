'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { Worker } = require('node:worker_threads'), { DatabaseSync } = require('node:sqlite');
const storage = require('../electron/storage.js'), sqlite = require('../electron/sqlite-storage.cjs');
const format = require('../electron/storage-format.cjs'), compatibility = require('../assets/core/platform-compatibility.js');
const { withStorageStatus } = require('../web/status.cjs');

function owned(t) {
  const parent = fs.realpathSync.native(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'tvs-web-status-synthetic-')), identity = fs.lstatSync(root);
  t.after(() => {
    const actual = fs.lstatSync(root); assert.equal(path.dirname(path.resolve(root)), parent); assert.match(path.basename(root), /^tvs-web-status-synthetic-/);
    assert.equal(actual.isSymbolicLink(), false); assert.equal(actual.dev, identity.dev); assert.equal(actual.ino, identity.ino); fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}
function fixture(t) { const root = owned(t), dataDir = path.join(root, 'db'); sqlite.create(dataDir, { data: { vehicles: [{ id: 'status-v', note: 'Synthetic business row must not be loaded' }], records: [] } }); return { root, dataDir }; }
function edit(dataDir, action) { const db = new DatabaseSync(sqlite.filename(dataDir)); try { return action(db); } finally { db.close(); } }
const read = dataDir => withStorageStatus(dataDir, status => status);
function tree(directory) {
  const result = {};
  function walk(current) { for (const entry of fs.readdirSync(current, { withFileTypes: true })) { const filename = path.join(current, entry.name); assert.equal(entry.isSymbolicLink(), false); if (entry.isDirectory()) walk(filename); else result[path.relative(directory, filename)] = crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'); } }
  walk(directory); return result;
}

test('storage status reads only fresh SQLite metadata in one view and consumes after SQL closes under its physical lock', t => {
  const f = fixture(t), expectedToken = storage.databaseToken(f.dataDir), expectedDescriptor = storage.descriptor(f.dataDir);
  require('../electron/document-archive.cjs');
  const restorations = [];
  function replace(target, name, replacement) { const original = target[name]; target[name] = replacement(original); restorations.push(() => { target[name] = original; }); }
  for (const name of ['readAll', 'readRows', 'readRawSections']) replace(sqlite, name, () => () => { throw Error('Business rows must not be read by status'); });
  for (const name of ['readAll', 'readSnapshot']) replace(storage, name, () => () => { throw Error('Business snapshot must not be read by status'); });
  let metadataCalls = 0;
  for (const name of ['descriptor', 'databaseToken']) replace(storage, name, original => directory => {
    metadataCalls++; assert.equal(storage.isDatabaseLockHeld(directory), true); assert.equal(sqlite.inTransaction(directory), true); return original(directory);
  });
  const archiveModule = require.cache[require.resolve('../electron/document-archive.cjs')], originalArchive = archiveModule.exports;
  archiveModule.exports = { ...originalArchive, validateState() { throw Error('Status must not validate archive rows'); } };
  let result;
  try {
    result = withStorageStatus(f.dataDir, status => {
      assert.equal(storage.isDatabaseLockHeld(f.dataDir), true); assert.equal(sqlite.inTransaction(f.dataDir), false);
      assert.deepEqual(Object.keys(status).sort(), ['databaseToken', 'platform', 'version']); assert.equal(Object.isFrozen(status), true); assert.equal(Object.isFrozen(status.platform), true);
      return status;
    });
  } finally { restorations.reverse().forEach(restore => restore()); archiveModule.exports = originalArchive; }
  assert.equal(metadataCalls, 2); assert.equal(result.databaseToken, expectedToken); assert.deepEqual(result.platform.descriptor, expectedDescriptor);
  assert.equal(result.platform.readOnly, false); assert.deepEqual(result.platform.compatibility, compatibility.describe().serverProfile); assert.equal(result.version, require('../package.json').version);
  assert.equal(storage.isDatabaseLockHeld(f.dataDir), false); assert.equal(sqlite.inTransaction(f.dataDir), false);
});

test('status never reuses an earlier database identity, descriptor or schema admission', t => {
  const f = fixture(t), first = read(f.dataDir);
  edit(f.dataDir, db => db.prepare("UPDATE metadata SET value='2' WHERE key='generation'").run());
  const second = read(f.dataDir); assert.notEqual(second.databaseToken, first.databaseToken); assert.deepEqual(second.platform.descriptor, first.platform.descriptor);
  const damaged = { ...format.describe(format.SCHEMA_VERSION), minWriter: 1 };
  edit(f.dataDir, db => db.prepare("UPDATE metadata SET value=? WHERE key='compatibility'").run(JSON.stringify(damaged)));
  let consumed = 0; assert.throws(() => withStorageStatus(f.dataDir, () => { consumed++; }), { code: 'STORAGE_COMPATIBILITY' }); assert.equal(consumed, 0);
  edit(f.dataDir, db => { db.prepare("UPDATE metadata SET value=? WHERE key='compatibility'").run(JSON.stringify(format.describe(format.SCHEMA_VERSION))); db.exec('PRAGMA user_version=65535;'); });
  assert.throws(() => withStorageStatus(f.dataDir, () => { consumed++; }), { code: 'SQLITE_FUTURE_FORMAT' }); assert.equal(consumed, 0);
});

test('a damaged SQLite or JSON identity fails closed before invoking the consumer', t => {
  const f = fixture(t), jsonDir = path.join(f.root, 'json'); storage.createJson(jsonDir, { data: { vehicles: [], records: [] } });
  read(f.dataDir); read(jsonDir);
  edit(f.dataDir, db => db.prepare("UPDATE metadata SET value='0' WHERE key='generation'").run());
  const identityFile = path.join(jsonDir, 'database-identity.json'), identity = JSON.parse(fs.readFileSync(identityFile, 'utf8')); identity.generation = 0; fs.writeFileSync(identityFile, JSON.stringify(identity));
  let consumed = 0;
  for (const directory of [f.dataDir, jsonDir]) assert.throws(() => withStorageStatus(directory, () => { consumed++; }), { code: 'DATABASE_IDENTITY' });
  assert.equal(consumed, 0);
});

test('current JSON, unversioned legacy JSON and actual schema5 SQLite keep exact metadata and source bytes', t => {
  const root = owned(t), jsonDir = path.join(root, 'json'), legacyDir = path.join(root, 'legacy'), oldDir = path.join(root, 'old5');
  storage.createJson(jsonDir, { data: { vehicles: [{ id: 'json-v' }], records: [] } });
  fs.mkdirSync(legacyDir); fs.writeFileSync(path.join(legacyDir, 'data.json'), JSON.stringify({ vehicles: [{ id: 'legacy-v' }], records: [] }));
  const old = require('./helpers/schema5-frozen.cjs').frozen5(); old.sqlite.create(oldDir, { data: { vehicles: [{ id: 'old-v' }], records: [] } });
  for (const [directory, schemaVersion] of [[jsonDir, 6], [legacyDir, 1], [oldDir, 5]]) {
    const before = tree(directory), descriptor = storage.descriptor(directory), token = storage.databaseToken(directory), status = read(directory);
    assert.deepEqual(status.platform.descriptor, descriptor); assert.equal(status.databaseToken, token); assert.equal(status.platform.descriptor.schemaVersion, schemaVersion);
    assert.equal(status.platform.readOnly, schemaVersion !== format.SCHEMA_VERSION); assert.deepEqual(tree(directory), before);
    assert.deepEqual(read(directory), status); assert.deepEqual(tree(directory), before);
  }
});

test('another managed writer remains blocked throughout synchronous status consumption', async t => {
  const f = fixture(t), memory = new SharedArrayBuffer(8), signal = new Int32Array(memory);
  const worker = new Worker("const{workerData,parentPort}=require('node:worker_threads');const state=new Int32Array(workerData.memory);parentPort.postMessage('ready');Atomics.wait(state,0,0,10000);let result=2;try{require(workerData.storage).withDatabaseLock(workerData.dataDir,()=>{});}catch(error){result=error.code==='DB_BUSY'?1:3;}Atomics.store(state,1,result);Atomics.notify(state,1);parentPort.close();", { eval: true, workerData: { memory, dataDir: f.dataDir, storage: require.resolve('../electron/storage.js') } });
  const exited = new Promise((resolve, reject) => { worker.once('exit', code => code === 0 ? resolve() : reject(Error('Synthetic status lock contender failed'))); worker.once('error', reject); });
  await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
  let consumed = 0;
  try {
    assert.equal(withStorageStatus(f.dataDir, status => {
      consumed++; assert.equal(storage.isDatabaseLockHeld(f.dataDir), true); assert.equal(sqlite.inTransaction(f.dataDir), false);
      Atomics.store(signal, 0, 1); Atomics.notify(signal, 0); assert.notEqual(Atomics.wait(signal, 1, 0, 5000), 'timed-out'); assert.equal(Atomics.load(signal, 1), 1);
      return status.version;
    }), require('../package.json').version);
    assert.equal(consumed, 1); await exited;
  } finally { await worker.terminate(); }
  assert.equal(storage.isDatabaseLockHeld(f.dataDir), false);
});

test('status rejects asynchronous consumers and releases its physical lock after failures', t => {
  const f = fixture(t);
  for (const consume of [undefined, null, async () => {}]) assert.throws(() => withStorageStatus(f.dataDir, consume), { code: 'STORAGE_STATUS_CONSUMER_ASYNC' });
  for (const consume of [() => Promise.resolve(), () => Promise.reject(Error('Synthetic rejected consumer'))]) assert.throws(() => withStorageStatus(f.dataDir, consume), { code: 'STORAGE_STATUS_CONSUMER_ASYNC' });
  let calls = 0; assert.throws(() => withStorageStatus(f.dataDir, () => { calls++; throw Object.assign(Error('Synthetic consumer failure'), { code: 'SYNTHETIC_CONSUMER_FAILURE' }); }), { code: 'SYNTHETIC_CONSUMER_FAILURE' });
  assert.equal(calls, 1); assert.equal(storage.isDatabaseLockHeld(f.dataDir), false); assert.equal(sqlite.inTransaction(f.dataDir), false); assert.equal(read(f.dataDir).platform.readOnly, false);
});
