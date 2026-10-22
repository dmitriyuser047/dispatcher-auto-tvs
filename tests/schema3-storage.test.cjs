'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const storage = require('../electron/storage.js'), sqlite = require('../electron/sqlite-storage.cjs'), format = require('../electron/storage-format.cjs');
const principal = { id: 'synthetic-admin', name: 'Synthetic administrator', role: 'admin' }, now = '2026-10-22T12:00:00.000Z';
const empty = () => Object.fromEntries(storage.SECTIONS.map(name => [name, []]));
const versions = () => Object.fromEntries(storage.SECTIONS.map(name => [name, 7]));
function temporary(t) { const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'tvs-format3-staging-')); t.after(() => { assert.equal(path.dirname(folder), fs.realpathSync(os.tmpdir())); assert.ok(path.basename(folder).startsWith('tvs-format3-staging-')); fs.rmSync(folder, { recursive: true, force: true }); }); return folder; }
function tree(directory) { const out = {}; function visit(folder) { for (const item of fs.readdirSync(folder, { withFileTypes: true })) { const file = path.join(folder, item.name); if (item.isDirectory()) visit(file); else out[path.relative(directory, file)] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } } visit(directory); return out; }
function json2(dir, data = empty()) { fs.mkdirSync(path.join(dir, 'sections'), { recursive: true }); for (const name of storage.SECTIONS) fs.writeFileSync(storage.sectionFile(dir, name), JSON.stringify(data[name])); fs.writeFileSync(storage.revisionsFile(dir), JSON.stringify({ format: 'tvs-platform-json', formatVersion: 1, schemaVersion: 2, vehicles: null, records: null, revisions: versions() })); }
function downgradeSql(dir, missingIdentity = false) { const db = new DatabaseSync(sqlite.filename(dir)); try { db.prepare("DELETE FROM metadata WHERE key='compatibility'").run(); if (missingIdentity) db.prepare("DELETE FROM metadata WHERE key IN('database_uuid','generation')").run(); db.prepare("UPDATE metadata SET value='2' WHERE key='schema_version'").run(); db.exec('PRAGMA user_version=2; PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;'); } finally { db.close(); } }
function downgradeJson(dir) { const value = JSON.parse(fs.readFileSync(storage.revisionsFile(dir))); value.schemaVersion = 2; delete value.compatibility; fs.writeFileSync(storage.revisionsFile(dir), JSON.stringify(value)); }
function request(dir, sections, id = 'safe-operation') { return { databaseToken: storage.databaseToken(dir), base: storage.readRevisions(dir), sections, operation: { id } }; }

test('canonical descriptors accept old computed versions and reject missing, unknown and weakened current requirements', () => {
  for (const version of [1, 2, 3]) assert.deepEqual(format.validateDescriptor(format.describe(version)), format.describe(version));
  assert.equal(format.SCHEMA_VERSION, 3); assert.deepEqual(format.SUPPORTED_READ_SCHEMAS, [1, 2, 3]);
  for (const patch of [{ features: [] }, { features: [...format.FEATURES, 'unknown-v9'] }, { minReader: 2 }, { minWriter: 2 }, { extra: true }]) assert.throws(() => format.validateDescriptor({ ...format.describe(3), ...patch }));
  const revisions = format.encodeRevisions(versions()); assert.equal(revisions.vehicles, null); assert.equal(revisions.records, null); assert.deepEqual(format.decodeRevisions(revisions).descriptor, format.describe(3));
  assert.throws(() => format.decodeRevisions({ ...revisions, compatibility: format.describe(2) }), { code: 'STORAGE_COMPATIBILITY' });
  delete revisions.compatibility; assert.throws(() => format.decodeRevisions(revisions), { code: 'STORAGE_COMPATIBILITY' });
});
test('SQLite format3 cannot declare a weaker schema2 compatibility descriptor', t => {
  const dir = path.join(temporary(t), 'weakened-sql'); sqlite.create(dir, { data: empty() });
  const db = new DatabaseSync(sqlite.filename(dir)); try { db.prepare("UPDATE metadata SET value=? WHERE key='compatibility'").run(JSON.stringify(format.describe(2))); db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;'); } finally { db.close(); }
  const before = tree(dir); assert.throws(() => storage.readSnapshot(dir), { code: 'STORAGE_COMPATIBILITY' }); assert.deepEqual(tree(dir), before);
});
test('JSON schema2 remains byte-exact and identity-free during reads and refused writes', t => {
  const dir = path.join(temporary(t), 'old-json'), data = empty(); data.vehicles = [{ id: 0, plate: 'NUMERIC' }, { id: '0', plate: 'TEXT' }]; data.payments = [{ id: 'legacy-paid', sum: '10.1234', paidAmount: 0, paid: false }]; json2(dir, data); const before = tree(dir);
  const snapshot = storage.readSnapshot(dir); assert.equal(snapshot.platform.schemaVersion, 2); assert.equal(snapshot.platform.currentSchemaVersion, 3); assert.equal(snapshot.platform.readOnly, true); assert.equal(snapshot.platform.needsSchemaUpgrade, true); assert.deepEqual(snapshot.data, data); assert.deepEqual(snapshot.platform.descriptor, format.describe(2));
  assert.equal(fs.existsSync(path.join(dir, 'database-identity.json')), false);
  assert.throws(() => storage.writeSections(dir, request(dir, { drivers: [{ id: 'new', name: 'Synthetic' }] })), { code: 'SCHEMA_UPGRADE_REQUIRED' });
  assert.throws(() => storage.commitPrintArtifact(dir, { archiveId: 'bad', format: 'pdf', bytes: Buffer.from('x') }, { principal }), { code: 'SCHEMA_UPGRADE_REQUIRED' });
  assert.deepEqual(tree(dir), before);
});
test('SQLite schema2 reads from a separate copy and never creates or repairs source identity or WAL', t => {
  const dir = path.join(temporary(t), 'old-sql'), data = empty(); data.vehicles = [{ id: 0, plate: 'NUMERIC' }, { id: '0', plate: 'TEXT' }]; sqlite.create(dir, { data, revisions: versions() }); downgradeSql(dir, true); const before = tree(dir);
  const snapshot = storage.readSnapshot(dir); assert.equal(snapshot.platform.readOnly, true); assert.deepEqual(snapshot.data, data); assert.equal(sqlite.readIdentity(dir), null); assert.deepEqual(sqlite.readDescriptor(dir), format.describe(2));
  assert.throws(() => storage.writeSections(dir, request(dir, { drivers: [{ id: 'new', name: 'Synthetic' }] })), { code: 'SCHEMA_UPGRADE_REQUIRED' });
  assert.deepEqual(tree(dir), before); assert.equal(fs.existsSync(sqlite.filename(dir) + '-wal'), false); assert.equal(fs.existsSync(sqlite.filename(dir) + '-shm'), false);
});

test('SQLite schema2 reads a completed PERSIST journal without modifying any source byte',t=>{
 const dir=path.join(temporary(t),'old-cold-persist'),data=empty();data.vehicles=[{id:0,plate:'SYNTHETIC COMMITTED',fuelBalance:923.537}];sqlite.create(dir,{data});downgradeSql(dir);
 const db=new DatabaseSync(sqlite.filename(dir));try{db.exec('PRAGMA journal_mode=PERSIST;');db.prepare("UPDATE metadata SET value='2' WHERE key='generation'").run();db.prepare("UPDATE metadata SET value='1' WHERE key='generation'").run();}finally{db.close();}
 const journal=sqlite.filename(dir)+'-journal';assert.ok(fs.statSync(journal).size>=28);assert.deepEqual(fs.readFileSync(journal).subarray(0,28),Buffer.alloc(28));const before=tree(dir);const snapshot=storage.readSnapshot(dir);assert.deepEqual(snapshot.data,data);assert.equal(snapshot.platform.readOnly,true);assert.deepEqual(tree(dir),before);
});
test('SQLite schema2 refuses a real active rollback journal before copying or recovering any source bytes', t => {
  const dir = path.join(temporary(t), 'old-rollback'); sqlite.create(dir, { data: empty() }); downgradeSql(dir);
  const db = new DatabaseSync(sqlite.filename(dir));
  try {
    db.exec('PRAGMA journal_mode=DELETE; PRAGMA cache_size=1; BEGIN EXCLUSIVE;');
    db.prepare("UPDATE metadata SET value='9' WHERE key='generation'").run();
    const insert = db.prepare('INSERT INTO metadata(key,value) VALUES(?,?)');
    for (let index = 0; index < 100; index++) insert.run('synthetic-spill-' + index, 'x'.repeat(8192));
    assert.ok(fs.statSync(sqlite.filename(dir) + '-journal').size > 0);
    const before = tree(dir);
    assert.throws(() => storage.readSnapshot(dir), { code: 'SQLITE_LEGACY_BUSY' });
    assert.throws(() => sqlite.transaction(dir, () => assert.fail('the source must not be opened'), { readOnly: true }), { code: 'SQLITE_LEGACY_BUSY' });
    assert.deepEqual(tree(dir), before);
  } finally { if (db.isTransaction) db.exec('ROLLBACK;'); db.close(); }
  const settled = tree(dir); assert.equal(storage.readSnapshot(dir).platform.schemaVersion, 2); assert.deepEqual(tree(dir), settled);
});
test('new JSON/SQLite use format3, explicit descriptor and pinned identity, old JSON reader rejects their barrier', t => {
  const root = temporary(t), json = path.join(root, 'new-json'); fs.mkdirSync(json); storage.migrate(json); const snapshot = storage.readSnapshot(json);
  assert.equal(snapshot.platform.schemaVersion, 3); assert.equal(snapshot.platform.readOnly, false); assert.equal(snapshot.platform.needsSchemaUpgrade, false); const envelope = JSON.parse(fs.readFileSync(storage.revisionsFile(json))); assert.equal(envelope.schemaVersion, 3); assert.deepEqual(envelope.compatibility, format.describe(3));
  // Evaluate the unchanged v2 decoder source independently from the staging overlay.
  const vm = require('node:vm'), mod = { exports: {} }, source = fs.readFileSync(path.resolve(__dirname, 'fixtures/storage-format-v2.cjs'), 'utf8');
  vm.runInNewContext(source, { module: mod, exports: mod.exports, require: name => name.includes('platform-schema') ? require('../assets/core/platform-schema.js') : require(name) }); assert.throws(() => mod.exports.decodeRevisions(envelope));
  const identity = { format: 'tvs-database-identity', version: 1, uuid: crypto.randomUUID(), generation: 9 }, dir = path.join(root, 'new-sql'); sqlite.create(dir, { data: empty(), descriptor: format.describe(3), identity }); assert.equal(sqlite.schemaVersion(dir), 3); assert.deepEqual(sqlite.readIdentity(dir), identity); assert.deepEqual(sqlite.readDescriptor(dir), format.describe(3));
});
for (const kind of ['json', 'sqlite']) test('safe exact receipt replay precedes writer proof, schema upgrade, stale CAS and bad clock: ' + kind, t => {
  const dir = path.join(temporary(t), kind); if (kind === 'sqlite') sqlite.create(dir, { data: empty() }); else { fs.mkdirSync(dir); storage.migrate(dir); }
  const input = request(dir, { drivers: [{ id: 'employee', name: 'Synthetic employee', role: 'driver' }] });
  const saved = storage.writeSections(dir, input, { principal, now, requireWriterSchema: true, writerSchemaVersion: 3 }); assert.equal(saved.ok, true);
  const current = storage.readSnapshot(dir); assert.throws(() => storage.writeSections(dir, request(dir, { drivers: [{ ...current.data.drivers[0], name: 'Blocked' }] }, 'blocked'), { principal, requireWriterSchema: true, writerSchemaVersion: 2 }), { code: 'WRITER_SCHEMA_REQUIRED' });
  if (kind === 'sqlite') downgradeSql(dir); else downgradeJson(dir); const before = tree(dir);
  const repeated = storage.writeSections(dir, input, { principal, now: 'invalid-clock', requireWriterSchema: true }); assert.equal(repeated.replayed, true); assert.equal(repeated.ok, true); assert.deepEqual(tree(dir), before);
  assert.throws(() => storage.writeSections(dir, { ...input, operation: { id: 'new-intent' } }, { principal, now: 'invalid-clock', requireWriterSchema: true, writerSchemaVersion: 3 }), { code: 'SCHEMA_UPGRADE_REQUIRED' }); assert.deepEqual(tree(dir), before);
});
test('old JSON recovery journal remains untouched and cannot be replayed by a new reader', t => {
  const dir = path.join(temporary(t), 'old'); json2(dir); fs.writeFileSync(path.join(dir, 'sections/.transaction.json'), JSON.stringify({ schemaVersion: 2, sections: { vehicles: [{ id: 'forbidden' }] } })); const before = tree(dir);
  assert.throws(() => storage.readSnapshot(dir), { code: 'SCHEMA_RECOVERY_REQUIRED' }); assert.deepEqual(tree(dir), before);
});
test('an interrupted first format3 commit recovers only its explicit empty-before journal', t => {
  const dir = path.join(temporary(t), 'fresh'); fs.mkdirSync(path.join(dir, 'sections'), { recursive: true });
  const rows = empty(), before = Object.fromEntries(storage.SECTIONS.map(name => [name, null])), revisions = format.encodeRevisions(versions());
  fs.writeFileSync(path.join(dir, 'sections/.transaction.json'), JSON.stringify({ schemaVersion: 3, base: null, before, sections: rows, revisions }));
  fs.writeFileSync(storage.sectionFile(dir, 'documentDrafts'), '[]'); fs.writeFileSync(storage.sectionFile(dir, 'vehicles'), '[]');
  const snapshot = storage.readSnapshot(dir); assert.equal(snapshot.platform.schemaVersion, 3); assert.equal(fs.existsSync(path.join(dir, 'sections/.transaction.json')), false); assert.deepEqual(snapshot.data, rows);
});
test('an unversioned old data.json cannot be reclassified by a current-looking recovery journal', t => {
  const dir = path.join(temporary(t), 'legacy'); fs.mkdirSync(path.join(dir, 'sections'), { recursive: true }); const data = { vehicles: [{ id: 'old', plate: 'KEEP' }], records: [] };
  fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify(data)); fs.writeFileSync(path.join(dir, 'sections/.transaction.json'), JSON.stringify({ schemaVersion: 3, base: null, before: Object.fromEntries(storage.SECTIONS.map(name => [name, null])), sections: empty(), revisions: format.encodeRevisions(versions()) })); const before = tree(dir);
  assert.throws(() => storage.readSnapshot(dir), { code: 'SCHEMA_RECOVERY_REQUIRED' }); assert.deepEqual(tree(dir), before);
});
for (const kind of ['json', 'sqlite']) test('historical print read/cached export stays exact but uncached render and archive recovery refuse old schema: ' + kind, async t => {
  const dir = path.join(temporary(t), kind), data = empty(); data.vehicles = [{ id: 0, plate: 'HISTORICAL', org: 'Synthetic' }];
  if (kind === 'sqlite') sqlite.create(dir, { data }); else { fs.mkdirSync(dir); storage.writeAll(dir, data, { principal, now }); }
  const archive = require('../electron/document-archive.cjs'), form = { mode: 'manual', form: 'waybill', target: { section: 'vehicles', id: 0 }, fields: { number: '0', qty: 0, amount: 0 }, templateVersion: 1 };
  const preview = await archive.handle(dir, { action: 'preview', request: form }, { principal, now }); assert.equal(preview.prepared.canCapture, true);
  const envelope = { protocolVersion: 1, databaseToken: preview.databaseToken, operation: { id: 'print-schema-replay' }, base: preview.base, command: { type: 'PrintAction', version: 1, input: { request: form, reviewFingerprint: preview.reviewFingerprint } } };
  const posted = storage.executeCommand(dir, envelope, { principal, now, requireWriterSchema: true, writerSchemaVersion: 3 }); assert.equal(posted.ok, true);
  const exported = await archive.handle(dir, { action: 'export', archiveId: posted.archive.id, format: 'pdf' }, { principal, now, requireWriterSchema: true, writerSchemaVersion: 3, renderPdf: async () => Buffer.from('%PDF-frozen-synthetic') });
  if (kind === 'sqlite') downgradeSql(dir); else downgradeJson(dir);
  fs.unlinkSync(path.join(dir, archive.DIR, posted.archive.id + '.pdf.json')); const before = tree(dir);
  const replay = storage.executeCommand(dir, envelope, { principal, now: 'invalid-clock', requireWriterSchema: true }); assert.equal(replay.replayed, true);
  const cached = await archive.handle(dir, { action: 'export', archiveId: posted.archive.id, format: 'pdf' }, { principal, now, requireWriterSchema: true, renderPdf: () => assert.fail('cached artifact must not render') }); assert.equal(cached.base64, exported.base64);
  await assert.rejects(archive.handle(dir, { action: 'export', archiveId: posted.archive.id, format: 'xlsx' }, { principal, now, requireWriterSchema: true }), { code: 'SCHEMA_UPGRADE_REQUIRED' });
  assert.throws(() => archive.recover(dir), { code: 'SCHEMA_UPGRADE_REQUIRED' }); assert.deepEqual(tree(dir), before);
});
