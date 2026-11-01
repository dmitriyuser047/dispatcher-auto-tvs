'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const { Worker } = require('node:worker_threads');
const sqlite = require('../electron/sqlite-storage.cjs'), storage = require('../electron/storage.js');
const { readWorkspace, DEFAULT_SECTIONS } = require('../web/workspace.cjs');
const schema = require('../assets/core/platform-schema.js');
const admin = { id: 'workspace-admin', name: 'Synthetic workspace admin', role: 'admin' };
function fixture(t, extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tvs-web-workspace-synthetic-'));
  t.after(() => { assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir())); assert.match(path.basename(root), /^tvs-web-workspace-synthetic-/); fs.rmSync(root, { recursive: true, force: true }); });
  const dataDir = path.join(root, 'db');
  sqlite.create(dataDir, { data: {
    vehicles: [{ id: 'v1', plate: 'SYNTHETIC-WORKSPACE', org: 'A', site: 'north', note: 'Canonical note' }, { id: 'v2', plate: 'SYNTHETIC-HIDDEN', org: 'B', site: 'south' }],
    records: [{ id: 'r1', vehicleId: 'v1', date: '2026-10-26', km: 10 }],
    payments: [{ id: 'private', sum: 123456, note: 'SYNTHETIC-FINANCE-PRIVATE' }],
    ...extra,
  } });
  return { dataDir };
}

test('canonical default workspace bypasses audit proof traversal and declares precisely loaded sections', t => {
  const f = fixture(t), originalRows = sqlite.readRawSections, originalAll = sqlite.readAll, read = [];
  sqlite.readRawSections = (dir, names) => { read.push(...names); assert.equal(storage.isDatabaseLockHeld(dir), true); assert.equal(sqlite.inTransaction(dir), true); return originalRows(dir, names); };
  sqlite.readAll = () => { throw Error('History-bearing full read must not run for default workspace'); };
  try {
    const result = readWorkspace(f.dataDir, { principal: admin });
    assert.deepEqual(result.loadedSections, DEFAULT_SECTIONS);
    assert.equal(Object.hasOwn(result.data, 'auditLog'), false);
    assert.equal(read.includes('auditLog'), false);
    assert.equal(result.data.vehicles.length, 2); assert.equal(result.platform.storageKind, 'sqlite');
    assert.match(result.databaseToken, /^[a-f0-9]{64}$/); assert.match(result.access.policyStamp, /^sha256:[a-f0-9]{64}$/);
    assert.equal(result.access.user.id, admin.id); assert.equal(result.platform.descriptor.schemaVersion, result.platform.schemaVersion);
    assert.deepEqual(result.scopeViews, {});
  } finally { sqlite.readRawSections = originalRows; sqlite.readAll = originalAll; }
});

function rawEdit(dataDir, action) { const db = new DatabaseSync(sqlite.filename(dataDir)); try { return action(db); } finally { db.close(); } }
function freshWorkspace() { const filename = require.resolve('../web/workspace.cjs'); delete require.cache[filename]; return require(filename); }
const wireJSON = frame => '{"data":' + frame.dataJSON + ',' + JSON.stringify(frame.envelope).slice(1);

test('trusted frame is exact response JSON without parsing the warm projected data and without mutable aliases', t => {
  const f = fixture(t), workspace = freshWorkspace(), normal = workspace.readWorkspace(f.dataDir, { principal: admin });
  const frame = workspace.readWorkspaceFrame(f.dataDir, { principal: admin });
  assert.equal(Object.isFrozen(frame), true); assert.equal(wireJSON(frame), JSON.stringify(normal));
  let dataParses = 0; const original = JSON.parse;
  JSON.parse = function (value, ...rest) { if (value === frame.dataJSON) dataParses++; return original.call(this, value, ...rest); };
  let next;
  try { next = workspace.readWorkspaceFrame(f.dataDir, { principal: { ...admin, id: 'frame-other-admin', name: 'Frame other admin' } }); }
  finally { JSON.parse = original; }
  assert.equal(dataParses, 0); assert.equal(next.dataJSON, frame.dataJSON); assert.equal(next.envelope.access.user.id, 'frame-other-admin');
  normal.data.vehicles[0].note = 'Caller mutation'; frame.envelope.revisions.vehicles = 999; frame.envelope.platform.readOnly = true;
  const fresh = workspace.readWorkspace(f.dataDir, { principal: admin });
  assert.equal(fresh.data.vehicles[0].note, 'Canonical note'); assert.notEqual(fresh.revisions.vehicles, 999); assert.equal(fresh.platform.readOnly, false);
  assert.throws(() => { frame.dataJSON = '{"vehicles":[]}'; }, TypeError);
});

test('frame rechecks raw bytes and ACL and never serializes invalid raw JSON from a new fingerprint', t => {
  const f = fixture(t), workspace = freshWorkspace(), first = workspace.readWorkspaceFrame(f.dataDir, { principal: admin });
  const modified = { ...JSON.parse(first.dataJSON).vehicles[0], note: 'Frame direct SQL edit' };
  rawEdit(f.dataDir, db => db.prepare("UPDATE section_rows SET row_json=? WHERE section='vehicles' AND position=0").run(JSON.stringify(modified)));
  const updated = workspace.readWorkspaceFrame(f.dataDir, { principal: admin });
  assert.notEqual(updated.dataJSON, first.dataJSON); assert.equal(JSON.parse(updated.dataJSON).vehicles[0].note, 'Frame direct SQL edit'); assert.equal(updated.envelope.revisions.vehicles, first.envelope.revisions.vehicles);
  const dispatcher = workspace.readWorkspaceFrame(f.dataDir, { principal: { ...admin, role: 'dispatcher' } });
  assert.deepEqual(JSON.parse(dispatcher.dataJSON).payments, []); assert.equal(dispatcher.dataJSON.includes('SYNTHETIC-FINANCE-PRIVATE'), false);
  const scopedPrincipal = { ...admin, accessPolicy: { version: 1, grants: [{ org: 'A', site: 'north' }] } };
  const scoped = workspace.readWorkspaceFrame(f.dataDir, { principal: scopedPrincipal });
  assert.deepEqual(JSON.parse(scoped.dataJSON).vehicles.map(row => row.id), ['v1']); assert.ok(scoped.envelope.scopeViews.vehicles); assert.equal(wireJSON(scoped), JSON.stringify(workspace.readWorkspace(f.dataDir, { principal: scopedPrincipal })));
  rawEdit(f.dataDir, db => { db.exec('PRAGMA ignore_check_constraints=ON;'); db.prepare("UPDATE section_rows SET row_json=? WHERE section='vehicles' AND position=0").run('{"synthetic-invalid"'); });
  assert.throws(() => workspace.readWorkspaceFrame(f.dataDir, { principal: admin }), SyntaxError);
});

test('serialized history, JSON and legacy fallbacks preserve full canonical reader metadata exactly', t => {
  const f = fixture(t), workspace = freshWorkspace();
  const historyOptions = { principal: admin, sections: ['auditLog'] };
  const history = workspace.readWorkspaceFrame(f.dataDir, historyOptions);
  assert.equal(history.envelope.loadedSections.includes('auditLog'), true); assert.equal(wireJSON(history), JSON.stringify(workspace.readWorkspace(f.dataDir, historyOptions)));
  const jsonDir = path.join(path.dirname(f.dataDir), 'json'), legacyDir = path.join(path.dirname(f.dataDir), 'legacy');
  storage.createJson(jsonDir, { data: { vehicles: [{ id: 'json-v', plate: 'SYNTHETIC-JSON' }], records: [] } });
  fs.mkdirSync(legacyDir); fs.writeFileSync(path.join(legacyDir, 'data.json'), JSON.stringify({ vehicles: [{ id: 'legacy-v', plate: 'SYNTHETIC-LEGACY' }], records: [] }));
  for (const dataDir of [jsonDir, legacyDir]) {
    const frame = workspace.readWorkspaceFrame(dataDir, { principal: admin });
    assert.equal(frame.envelope.loadedSections.includes('auditLog'), true); assert.equal(wireJSON(frame), JSON.stringify(workspace.readWorkspace(dataDir, { principal: admin })));
  }
});

test('withWorkspaceFrame publishes once under the existing physical lock and rejects asynchronous consumers', async t => {
  const f = fixture(t), workspace = freshWorkspace(), memory = new SharedArrayBuffer(8), signal = new Int32Array(memory);
  const worker = new Worker("const{workerData,parentPort}=require('node:worker_threads');const state=new Int32Array(workerData.memory);parentPort.postMessage('ready');Atomics.wait(state,0,0,10000);let outcome=2;try{require(workerData.storage).withDatabaseLock(workerData.dataDir,()=>{});}catch(error){outcome=error.code==='DB_BUSY'?1:3;}Atomics.store(state,1,outcome);Atomics.notify(state,1);parentPort.close();", { eval: true, workerData: { memory, dataDir: f.dataDir, storage: require.resolve('../electron/storage.js') } });
  const exited = new Promise((resolve, reject) => { worker.once('exit', code => code === 0 ? resolve() : reject(Error('Synthetic lock contender failed'))); worker.once('error', reject); });
  await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
  let calls = 0;
  try {
    const value = workspace.withWorkspaceFrame(f.dataDir, { principal: admin }, frame => {
      calls++; assert.equal(storage.isDatabaseLockHeld(f.dataDir), true); assert.equal(sqlite.inTransaction(f.dataDir), false);
      Atomics.store(signal, 0, 1); Atomics.notify(signal, 0); assert.notEqual(Atomics.wait(signal, 1, 0, 5000), 'timed-out');
      assert.equal(Atomics.load(signal, 1), 1, 'Another managed writer must remain blocked throughout publication.');
      return JSON.parse(frame.dataJSON).vehicles.length;
    });
    assert.equal(value, 2); assert.equal(calls, 1); assert.equal(storage.isDatabaseLockHeld(f.dataDir), false);
    await exited;
  } finally { await worker.terminate(); }
  assert.throws(() => workspace.withWorkspaceFrame(f.dataDir, { principal: admin }, async () => {}), { code: 'WORKSPACE_CONSUMER_ASYNC' });
  assert.throws(() => workspace.withWorkspaceFrame(f.dataDir, { principal: admin }, () => Promise.resolve()), { code: 'WORKSPACE_CONSUMER_ASYNC' });
  let failedCalls = 0;
  assert.throws(() => workspace.withWorkspaceFrame(f.dataDir, { principal: admin }, () => { failedCalls++; throw Object.assign(Error('Synthetic consumer failure'), { code: 'DB_BUSY' }); }), { code: 'DB_BUSY' });
  assert.equal(failedCalls, 1); assert.equal(storage.isDatabaseLockHeld(f.dataDir), false);
});

test('raw section fingerprint covers exact stored bytes and row positions before row parsing', t => {
  const f = fixture(t), first = sqlite.readRawSections(f.dataDir, ['vehicles']);
  assert.equal(typeof first.rows[0].row_json, 'string'); assert.deepEqual(first.rows.map(row => row.position), [0, 1]);
  const revisions = sqlite.readRevisions(f.dataDir);
  rawEdit(f.dataDir, db => db.prepare("UPDATE section_rows SET row_json=row_json || ' ' WHERE section='vehicles' AND position=0").run());
  const whitespace = sqlite.readRawSections(f.dataDir, ['vehicles']);
  assert.notEqual(whitespace.fingerprint, first.fingerprint); assert.deepEqual(JSON.parse(whitespace.rows[0].row_json), JSON.parse(first.rows[0].row_json));
  rawEdit(f.dataDir, db => db.prepare("UPDATE section_rows SET position=99 WHERE section='vehicles' AND position=0").run());
  const moved = sqlite.readRawSections(f.dataDir, ['vehicles']);
  assert.notEqual(moved.fingerprint, whitespace.fingerprint); assert.deepEqual(moved.rows.map(row => row.position), [1, 99]); assert.deepEqual(sqlite.readRevisions(f.dataDir), revisions);
  assert.throws(() => sqlite.readRawSections(f.dataDir, ['vehicles', 'vehicles']), { code: 'SQLITE_SECTION' });
});

test('same-rights administrators share owned projection bytes and each receive independent mutable trees', t => {
  const f = fixture(t), workspace = freshWorkspace(), platform = require('../electron/platform-service.cjs'), original = platform.visibleRows;
  let projections = 0, storedReads = 0; const originalRead = sqlite.readRawSections;
  platform.visibleRows = (...args) => { projections++; return original(...args); };
  sqlite.readRawSections = (...args) => { storedReads++; return originalRead(...args); };
  try {
    const first = workspace.readWorkspace(f.dataDir, { principal: admin }), afterCold = projections;
    first.data.vehicles[0].note = 'Caller modification'; first.data.vehicles.push({ id: 'caller-only' });
    Object.freeze(first.data.vehicles); Object.freeze(first.data);
    const second = workspace.readWorkspace(f.dataDir, { principal: { ...admin, id: 'other-admin', name: 'Other synthetic admin' } });
    assert.ok(afterCold > 0); assert.equal(projections, afterCold); assert.equal(storedReads, 2);
    assert.equal(second.access.user.id, 'other-admin'); assert.equal(second.data.vehicles.length, 2); assert.equal(second.data.vehicles[0].note, 'Canonical note');
    assert.equal(Object.isFrozen(second.data), false); second.data.vehicles[0].note = 'Second caller';
    assert.equal(workspace.readWorkspace(f.dataDir, { principal: admin }).data.vehicles[0].note, 'Canonical note');
    assert.equal(projections, afterCold); assert.equal(storedReads, 3);
  } finally { platform.visibleRows = original; sqlite.readRawSections = originalRead; }
});

test('same-revision raw row changes and appMeta outside the selected response invalidate the projection', t => {
  const f = fixture(t, { appMeta: [{ id: 'synthetic-meta', note: 'Original metadata' }] }), workspace = freshWorkspace(), platform = require('../electron/platform-service.cjs'), original = platform.visibleRows;
  let projections = 0; platform.visibleRows = (...args) => { projections++; return original(...args); };
  try {
    const initial = workspace.readWorkspace(f.dataDir, { principal: admin, sections: ['vehicles'] }), revisions = sqlite.readRevisions(f.dataDir);
    const before = sqlite.readRawSections(f.dataDir, ['vehicles', 'appMeta']).fingerprint, count = projections;
    rawEdit(f.dataDir, db => db.prepare("UPDATE section_rows SET row_json=? WHERE section='vehicles' AND position=0").run(JSON.stringify({ ...initial.data.vehicles[0], note: 'Direct stored change without revision' })));
    const changed = workspace.readWorkspace(f.dataDir, { principal: admin, sections: ['vehicles'] });
    assert.equal(changed.data.vehicles[0].note, 'Direct stored change without revision'); assert.ok(projections > count);
    assert.deepEqual(sqlite.readRevisions(f.dataDir), revisions); assert.notEqual(sqlite.readRawSections(f.dataDir, ['vehicles', 'appMeta']).fingerprint, before);
    const secondCount = projections;
    rawEdit(f.dataDir, db => db.prepare("UPDATE section_rows SET row_json=? WHERE section='appMeta' AND position=0").run(JSON.stringify({ id: 'synthetic-meta', note: 'Changed metadata without revision' })));
    const afterMeta = workspace.readWorkspace(f.dataDir, { principal: admin, sections: ['vehicles'] });
    assert.equal(Object.hasOwn(afterMeta.data, 'appMeta'), false); assert.ok(projections > secondCount); assert.deepEqual(sqlite.readRevisions(f.dataDir), revisions);
  } finally { platform.visibleRows = original; }
});

test('cached data never reuses revisions, database identity, schema validity or archive validation', t => {
  const f = fixture(t), workspace = freshWorkspace(), archiveModule = require.cache[require.resolve('../electron/document-archive.cjs')], originalArchive = archiveModule.exports;
  let validations = 0, rejectArchive = false;
  archiveModule.exports = { ...originalArchive, validateState(...args) { validations++; if (rejectArchive) throw Object.assign(Error('Synthetic archive bytes changed'), { code: 'DOCUMENT_ARCHIVE_HASH' }); return originalArchive.validateState(...args); } };
  try {
    const first = workspace.readWorkspace(f.dataDir, { principal: admin });
    rawEdit(f.dataDir, db => { db.prepare("UPDATE sections SET revision=revision+1 WHERE name='vehicles'").run(); db.prepare("UPDATE metadata SET value='2' WHERE key='generation'").run(); });
    const second = workspace.readWorkspace(f.dataDir, { principal: admin });
    assert.equal(second.revisions.vehicles, first.revisions.vehicles + 1); assert.notEqual(second.databaseToken, first.databaseToken); assert.equal(validations, 2);
    rejectArchive = true; assert.throws(() => workspace.readWorkspace(f.dataDir, { principal: admin }), { code: 'DOCUMENT_ARCHIVE_HASH' }); assert.equal(validations, 3); rejectArchive = false;
    rawEdit(f.dataDir, db => db.exec('PRAGMA user_version=65535;'));
    assert.throws(() => workspace.readWorkspace(f.dataDir, { principal: admin }), { code: 'SQLITE_FUTURE_FORMAT' });
  } finally { archiveModule.exports = originalArchive; }
});

test('a warmed unrestricted projection never bypasses newly narrowed grants or role ceilings', t => {
  const f = fixture(t), workspace = freshWorkspace(); workspace.readWorkspace(f.dataDir, { principal: admin });
  const narrowed = workspace.readWorkspace(f.dataDir, { principal: { ...admin, accessPolicy: { version: 1, grants: [{ org: 'A', site: 'north' }] } } });
  assert.deepEqual(narrowed.data.vehicles.map(row => row.id), ['v1']); assert.ok(narrowed.scopeViews.vehicles); assert.equal(narrowed.loadedSections.includes('auditLog'), true);
  const dispatcher = workspace.readWorkspace(f.dataDir, { principal: { ...admin, role: 'dispatcher' } });
  assert.deepEqual(dispatcher.data.payments, []); assert.equal(dispatcher.access.readable.includes('payments'), false); assert.doesNotMatch(JSON.stringify(dispatcher), /SYNTHETIC-FINANCE-PRIVATE/);
});

test('shared projected JSON uses bounded LRU entries rather than retaining all section combinations', t => {
  const f = fixture(t), workspace = freshWorkspace(), platform = require('../electron/platform-service.cjs'), original = platform.visibleRows;
  let projections = 0; platform.visibleRows = (...args) => { projections++; return original(...args); };
  try {
    workspace.readWorkspace(f.dataDir, { principal: admin, sections: ['vehicles'] });
    const additions = DEFAULT_SECTIONS.filter(name => !['vehicles', 'appMeta'].includes(name)).slice(0, 16);
    for (const name of additions) workspace.readWorkspace(f.dataDir, { principal: admin, sections: ['vehicles', name] });
    const before = projections; workspace.readWorkspace(f.dataDir, { principal: admin, sections: ['vehicles'] });
    assert.ok(projections > before, 'The oldest of 17 projection variants must have been evicted.');
  } finally { platform.visibleRows = original; }
});

test('requested canonical sections stay complete and current role still hides finance', t => {
  const f = fixture(t), principal = { id: 'dispatcher', name: 'Synthetic dispatcher', role: 'dispatcher' };
  const result = readWorkspace(f.dataDir, { principal, sections: ['vehicles', 'payments'] });
  assert.deepEqual(result.loadedSections, ['vehicles', 'payments']);
  assert.deepEqual(Object.keys(result.data), ['vehicles', 'payments']);
  assert.equal(result.data.vehicles.length, 2); assert.deepEqual(result.data.payments, []);
  assert.equal(result.revisions.payments, 0); assert.equal(result.access.readable.includes('payments'), false);
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC-FINANCE-PRIVATE|123456/);
  assert.throws(() => readWorkspace(f.dataDir, { principal, sections: ['vehicles', 'vehicles'] }), { code: 'WORKSPACE_SECTIONS_INVALID' });
  assert.throws(() => readWorkspace(f.dataDir, { sections: ['vehicles'] }), { code: 'ACCESS_DENIED' });
});

test('scoped access and canonical history hydration retain established full reader and witnesses', t => {
  const f = fixture(t), original = storage.readSnapshot, fallbacks = [];
  storage.readSnapshot = (dir, options) => { fallbacks.push(options.principal); return original(dir, options); };
  try {
    const scoped = readWorkspace(f.dataDir, { principal: { ...admin, accessPolicy: { version: 1, grants: [{ org: 'A', site: 'north' }] } } });
    assert.equal(fallbacks.length, 1); assert.deepEqual(scoped.data.vehicles.map(row => row.id), ['v1']);
    assert.ok(scoped.scopeViews.vehicles.visibleFingerprint); assert.equal(scoped.loadedSections.includes('auditLog'), true);
    const full = readWorkspace(f.dataDir, { principal: admin, sections: ['auditLog'] });
    assert.equal(fallbacks.length, 2); assert.deepEqual(full.loadedSections, schema.sections); assert.ok(Array.isArray(full.data.auditLog));
    readWorkspace(f.dataDir, { principal: { ...admin, readable: ['vehicles'], writable: [] }, sections: ['vehicles'] });
    assert.equal(fallbacks.length, 3);
  } finally { storage.readSnapshot = original; }
});

test('workspace canonical revisions and database token retain existing CAS semantics', t => {
  const f = fixture(t), before = readWorkspace(f.dataDir, { principal: admin });
  const first = storage.writeSections(f.dataDir, { databaseToken: before.databaseToken, base: { vehicles: before.revisions.vehicles }, sections: { vehicles: before.data.vehicles.map(row => ({ ...row, note: 'Synthetic first edit' })) } }, { principal: admin });
  assert.equal(first.ok, true);
  const stale = storage.writeSections(f.dataDir, { databaseToken: before.databaseToken, base: { vehicles: before.revisions.vehicles }, sections: { vehicles: before.data.vehicles } }, { principal: admin });
  assert.equal(stale.ok, false); assert.deepEqual(stale.conflicts, ['vehicles']);
  assert.equal(readWorkspace(f.dataDir, { principal: admin, sections: ['vehicles'] }).data.vehicles[0].note, 'Synthetic first edit');
  const after = readWorkspace(f.dataDir, { principal: admin }); assert.equal(after.databaseToken, before.databaseToken); assert.equal(after.revisions.vehicles, first.revisions.vehicles);
});

function syncFixture(options = {}) {
  const writes = [], reads = [];
  const actor = { user: { id: 'synthetic-ui', role: 'admin' }, policyStamp: 'sha256:' + 'a'.repeat(64), readable: ['vehicles', 'records', 'auditLog', 'appMeta'], writable: ['vehicles', 'records', 'auditLog', 'appMeta'] };
  const snap = { data: { vehicles: [{ id: 'v1', note: 'Original' }] }, loadedSections: ['vehicles'], databaseToken: 'synthetic-workspace-db', revisions: { vehicles: 4, records: 7, auditLog: 9, appMeta: 2 }, access: actor, platform: { apiVersion: 1, negotiation: { writeCompatible: true } } };
  const context = vm.createContext({ window: { electronAPI: {
    readSnapshot: async () => JSON.stringify(snap),
    ensureSections: async names => { reads.push(names); return options.hydrate ? options.hydrate(names, snap) : { ...snap, data: { vehicles: [{ id: 'v1', note: 'Remote newer' }], auditLog: [{ id: 'old-history', section: 'vehicles', action: 'update' }] }, loadedSections: ['vehicles', 'auditLog'], revisions: { ...snap.revisions, vehicles: 5 } }; },
    writeSections: async raw => { const value = JSON.parse(raw); writes.push(value); return { ok: true, databaseToken: snap.databaseToken, revisions: { vehicles: 5, auditLog: 10 }, canonicalSections: value.sections }; },
  } }, document: { getElementById: () => null, querySelector: () => null }, showToast() {}, rebuildIndex() {}, console, setInterval, clearInterval,
    PlatformSchema: { sections: ['vehicles', 'records', 'auditLog', 'appMeta'] },
  });
  vm.runInContext('let data = {}, _lastPersisted = null, _loadWriteBlocked = false;', context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/js/25f-sync.js'), 'utf8'), context, { filename: '25f-sync.js' });
  const run = code => vm.runInContext(code, context);
  return { context, run, writes, reads, snap };
}

test('unloaded arrays never acquire empty baselines or appear in a replacement payload', async () => {
  const f = syncFixture(); await f.run('syncLoad().then(value => { data=value; data.records=[]; data.auditLog=[]; _lastPersisted=JSON.stringify(data); })');
  assert.equal(f.run('syncSectionLoaded("auditLog")'), false);
  assert.deepEqual(Array.from(f.run('_sync.loadedSections')), ['vehicles']);
  f.run('data.vehicles[0].note="Dirty"; data.records=[{id:"incomplete-new-row"}]');
  await assert.rejects(f.run('syncSaveNow(data,{})'), { code: 'SECTION_NOT_LOADED' }); assert.equal(f.writes.length, 0);
  f.run('data.records=[]'); await f.run('syncSaveNow(data,{})');
  assert.equal(f.writes.length, 1); assert.deepEqual(Object.keys(f.writes[0].sections), ['vehicles']);
  assert.deepEqual(f.writes[0].base, { vehicles: 4 }); assert.equal(f.writes[0].databaseToken, f.snap.databaseToken);
});

test('hydrating canonical history preserves dirty edits and updates only the missing baseline', async () => {
  const f = syncFixture(); await f.run('syncLoad().then(value => { data=value; data.records=[]; data.auditLog=[]; _lastPersisted=JSON.stringify(data); })');
  f.run('data.vehicles[0].note="Unsaved local edit"; var reviewedDraft=JSON.parse(JSON.stringify(data));');
  await f.run('syncEnsureLoaded(["auditLog"],reviewedDraft)');
  assert.equal(f.run('data.vehicles[0].note'), 'Unsaved local edit'); assert.equal(f.run('reviewedDraft.vehicles[0].note'), 'Unsaved local edit');
  assert.equal(f.run('JSON.parse(_sync.synced.vehicles)[0].note'), 'Original'); assert.equal(f.run('_sync.revs.vehicles'), 4);
  assert.equal(f.run('JSON.parse(_lastPersisted).vehicles[0].note'), 'Original');
  assert.equal(f.run('data.auditLog[0].id'), 'old-history'); assert.equal(f.run('reviewedDraft.auditLog[0].id'), 'old-history');
  assert.equal(f.run('JSON.parse(_lastPersisted).auditLog[0].id'), 'old-history'); assert.equal(f.run('_sync.revs.auditLog'), 9);
  assert.equal(f.run('syncSectionLoaded("auditLog")'), true); assert.equal(f.reads.length, 1);
  await f.run('syncEnsureLoaded(["auditLog"],reviewedDraft)'); assert.equal(f.reads.length, 1);
});

test('reviewed draft keeps canonical audit prefix and operation metadata while live dirty rows survive ACK', async () => {
  const f = syncFixture(); await f.run('syncLoad().then(value => { data=value; data.auditLog=[]; _lastPersisted=JSON.stringify(data); })');
  f.run('var reviewedDraft=JSON.parse(JSON.stringify(data)); reviewedDraft.vehicles[0].note="Reviewed edit";');
  await f.run('syncEnsureLoaded(["auditLog"],reviewedDraft)');
  f.run('data.vehicles[0].note="Other unsaved editor"; reviewedDraft.auditLog.push({id:"new-audit",section:"vehicles",action:"update"})');
  const operation = { id: 'synthetic-reviewed-intent', digest: 'sha256:' + 'c'.repeat(64) };
  f.context.reviewedOperation = operation;
  await f.run('syncSaveNow(reviewedDraft,{operation:reviewedOperation})');
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.writes[0].operation, operation);
  assert.deepEqual(f.writes[0].sections.auditLog.map(row => row.id), ['old-history', 'new-audit']);
  assert.equal(f.writes[0].base.auditLog, 9);
  assert.equal(f.run('data.vehicles[0].note'), 'Other unsaved editor');
  assert.equal(f.run('data.auditLog[1].id'), 'new-audit');
  assert.equal(f.run('JSON.stringify(data.auditLog)===_sync.synced.auditLog'), true);
});

test('initial sync uses workspace reader while explicit full snapshot reader stays available', async () => {
  const f = syncFixture(); let workspaceCalls = 0, snapshotCalls = 0;
  f.context.window.electronAPI.readWorkspace = async () => { workspaceCalls++; return JSON.stringify(f.snap); };
  f.context.window.electronAPI.readSnapshot = async () => { snapshotCalls++; throw Error('Full snapshot should stay deferred'); };
  await f.run('syncLoad()');
  assert.equal(workspaceCalls, 1); assert.equal(snapshotCalls, 0);
});

test('revision polling leaves deferred history deferred even when its revision changes', async () => {
  const f = syncFixture(); await f.run('syncLoad().then(value => { data=value; data.auditLog=[]; _lastPersisted=JSON.stringify(data); })');
  let sectionReads = 0;
  f.context.window.electronAPI.getRevisions = async () => ({ vehicles: 4, records: 100, auditLog: 200, appMeta: 7, databaseToken: f.snap.databaseToken });
  f.context.window.electronAPI.readSection = async () => { sectionReads++; throw Error('Deferred history was polled'); };
  await f.run('syncPoll()');
  assert.equal(sectionReads, 0); assert.equal(f.run('syncSectionLoaded("auditLog")'), false);
});

test('history hydration rejects changed rights, query pages and unreviewed edits without touching draft', async () => {
  for (const mode of ['rights', 'partial', 'dirty']) {
    const f = syncFixture({ hydrate: (names, snap) => ({ ...snap, access: mode === 'rights' ? { ...snap.access, policyStamp: 'sha256:' + 'b'.repeat(64) } : snap.access, data: { auditLog: [{ id: 'history' }] }, loadedSections: mode === 'partial' ? [] : ['auditLog'] }) });
    await f.run('syncLoad().then(value => { data=value; data.auditLog=[]; _lastPersisted=JSON.stringify(data); })');
    if (mode === 'dirty') f.run('data.auditLog.push({id:"unreviewed-history"})');
    await assert.rejects(f.run('syncEnsureLoaded(["auditLog"],data)'), error => error.code === (mode === 'rights' ? 'SESSION_CHANGED' : 'SECTION_NOT_LOADED'));
    assert.equal(f.run('syncSectionLoaded("auditLog")'), false); assert.equal(f.writes.length, 0);
    assert.equal(f.run('data.auditLog.length'), mode === 'dirty' ? 1 : 0);
  }
});
