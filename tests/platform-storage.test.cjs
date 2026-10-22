const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const storage = require('../electron/storage');
const server = require('../electron/server');
const principal = { id:'trusted-admin', name:'Trusted administrator', role:'admin' };
const at = '2026-10-21T12:00:00.000Z';
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tvs-platform-storage-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('tvs-platform-storage-'));
    fs.rmSync(dir, { recursive:true, force:true });
  });
  storage.writeAll(dir, { vehicles:[{ id:'v', plate:'SYNTHETIC', fuelBalance:50, fuelGrade:'ДТ', org:'Synthetic organization', norm:10 }],
    records:[{ id:'r', vehicleId:'v', date:'2026-09-10', km:100, fuelActual:10 }] }, { principal, now:at });
  return dir;
}
function payload(dir, sections, id) {
  return { databaseToken:storage.databaseToken(dir), base:storage.readRevisions(dir), sections,
    ...(id ? { operation:{ id } } : {}) };
}
function records(dir, patch = {}) { return storage.readAll(dir).records.map(row => ({ ...row, ...patch })); }
function audits(dir, operationId) { return storage.readAll(dir).auditLog.filter(row => row.operationId === operationId); }
const key = 'platform-test-only-access-123456';
function request(port, route, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host:'127.0.0.1', port, path:route, method:body === undefined ? 'GET' : 'POST', headers:{ Authorization:'Bearer ' + key } }, res => {
      let raw = ''; res.setEncoding('utf8'); res.on('data', part => { raw += part; }); res.on('end', () => resolve({ status:res.statusCode, body:JSON.parse(raw) }));
    });
    req.on('error', reject); req.end(JSON.stringify(body));
  });
}

test('storage uses the same authoritative section registry as the platform kernel', () => {
  assert.deepEqual(storage.SECTIONS, require('../assets/core/platform-schema.js').sections);
});

test('native snapshots explicitly advertise transactional operation acknowledgement support', t => {
  const dir = fixture(t);
  assert.deepEqual(storage.readSnapshot(dir).platform, { apiVersion:1, operations:1,outbox:1,receiptQuery:1,commands:1,schemaVersion:2,documentDrafts:1,periods:1,fuelOperations:1,procurement:1,costAccounting:1,repairs:1,calendar:1,personnelPlanning:1,documentPrint:1,controlledImports:1,needsSchemaUpgrade:false });
});

test('operational roles do not receive financial row history or mixed transaction metadata', () => {
  const service = require('../electron/platform-service.cjs');
  const rows = [{ id:'operational', section:'records' }, { id:'financial', section:'payments' },
    { id:'operational-receipt', section:'auditLog', type:'transaction', changedSections:['records'] },
    { id:'mixed-receipt', section:'auditLog', type:'transaction', changedSections:['records', 'payments'], revisions:{ payments:42 } }];
  assert.deepEqual(service.visibleAudit(rows, { role:'dispatcher' }).map(row => row.id), ['operational', 'operational-receipt']);
});

test('local full saves replace renderer audit claims with trusted row changes and a durable receipt', t => {
  const dir = fixture(t), previous = storage.readAll(dir), submitted = structuredClone(previous);
  submitted.records[0].note = 'Synthetic local change';
  submitted.auditLog.push({ id:'forged-client-event', section:'records', actor:'Spoofed actor', at:'1900-01-01', action:'delete' });
  const saved = storage.writeAll(dir, submitted, { principal, now:at, operation:{ id:'local-full-operation' } });
  const current = storage.readAll(dir), row = current.auditLog.find(item => item.operationId === 'local-full-operation' && item.section === 'records');
  assert.equal(row.actorId, principal.id); assert.equal(row.actor, principal.name); assert.equal(row.at, at);
  assert.equal(row.before.note, undefined); assert.equal(row.after.note, 'Synthetic local change');
  assert.equal(current.auditLog.some(item => item.id === 'forged-client-event'), false);
  assert.equal(current.auditLog.filter(item => item.operationId === 'local-full-operation' && item.type === 'transaction').length, 1);
  assert.deepEqual(saved.canonicalSections.auditLog, current.auditLog); assert.equal(saved.operationReceipt.status, 'committed');
});

test('every local section save applies role and field permissions before changing rows or revisions', t => {
  const dir = fixture(t), before = storage.readSnapshot(dir);
  assert.throws(() => storage.writeSections(dir, payload(dir, { records:records(dir, { km:101 }) }), { principal:{ id:'reader', name:'Reader', role:'viewer' } }), /Роль/);
  assert.throws(() => storage.writeSections(dir, payload(dir, { vehicles:before.data.vehicles.map(row => ({ ...row, plate:'FORBIDDEN' })) }), { principal:{ id:'mechanic', name:'Mechanic', role:'mechanic' } }), /механик|механика/i);
  assert.deepEqual(storage.readSnapshot(dir), before);
});

test('new dangling links and invalid values are rejected atomically through full and section protocols', t => {
  const dir = fixture(t), before = storage.readSnapshot(dir);
  assert.throws(() => storage.writeSections(dir, payload(dir, { records:records(dir, { vehicleId:'missing' }) })));
  assert.throws(() => storage.writeAll(dir, { ...before.data, records:records(dir, { km:-1 }) }));
  assert.deepEqual(storage.readSnapshot(dir), before);
});

test('legacy invalid fields remain repairable without silently rewriting them during a comment edit', t => {
  const dir = fixture(t);
  // Simulate an existing imported legacy row in this temporary profile only.
  fs.writeFileSync(storage.sectionFile(dir, 'records'), JSON.stringify([{ id:'r', vehicleId:'missing-legacy', date:'2026-09-10', km:'legacy invalid value' }]));
  const before = storage.readAll(dir).records[0];
  const result = storage.writeSections(dir, payload(dir, { records:[{ ...before, note:'Manual review requested' }] }));
  assert.equal(result.ok, true); const row = storage.readAll(dir).records[0];
  assert.equal(row.vehicleId, 'missing-legacy'); assert.equal(row.km, 'legacy invalid value'); assert.equal(row.note, 'Manual review requested');
});

test('atomic reassignment and target removal work as one validated transaction', t => {
  const dir = fixture(t), before = storage.readAll(dir);
  const result = storage.writeSections(dir, payload(dir, { vehicles:[{ ...before.vehicles[0], id:'new-v' }], records:records(dir, { vehicleId:'new-v' }) }));
  assert.equal(result.ok, true); assert.equal(storage.readAll(dir).records[0].vehicleId, 'new-v');
  assert.equal(storage.readAll(dir).vehicles[0].id, 'new-v');
});

test('a lost acknowledgement can be retried with its old base without applying the transaction twice', t => {
  const dir = fixture(t), original = payload(dir, { records:records(dir, { km:101 }) }, 'retry-operation-001');
  const first = storage.writeSections(dir, original, { principal, now:at }), snapshot = storage.readSnapshot(dir);
  const second = storage.writeSections(dir, structuredClone(original), { principal, now:'2026-10-22T00:00:00.000Z' });
  assert.equal(first.ok, true); assert.equal(second.ok, true); assert.equal(second.replayed, true); assert.deepEqual(second.changed, []);
  assert.equal(second.operationReceipt.status, 'replayed'); assert.deepEqual(second.revisions, snapshot.revisions);
  assert.deepEqual(storage.readSnapshot(dir), snapshot);
  assert.equal(audits(dir, 'retry-operation-001').filter(row => row.type === 'transaction').length, 1);
  assert.equal(audits(dir, 'retry-operation-001').filter(row => row.section === 'records').length, 1);
});

test('an operation id is bound to its exact body and authenticated principal', t => {
  const dir = fixture(t), original = payload(dir, { records:records(dir, { km:101 }) }, 'bound-operation-001');
  storage.writeSections(dir, original, { principal, now:at }); const before = storage.readSnapshot(dir);
  const changed = structuredClone(original); changed.sections.records[0].km = 102;
  assert.throws(() => storage.writeSections(dir, changed, { principal }), error => error.code === 'OPERATION_REUSED');
  assert.throws(() => storage.writeSections(dir, original, { principal:{ ...principal, id:'other-principal' } }), error => error.code === 'OPERATION_REUSED');
  assert.deepEqual(storage.readSnapshot(dir), before);
});

test('client audit hint randomness does not turn an identical retry into a different transaction', t => {
  const dir = fixture(t), previous = storage.readAll(dir);
  const original = payload(dir, { records:records(dir, { km:101 }), auditLog:[...previous.auditLog, { id:'hint-one', section:'records' }] }, 'hint-retry-operation');
  storage.writeSections(dir, original, { principal });
  const retry = structuredClone(original); retry.sections.auditLog.push({ id:'another-untrusted-hint', section:'records' }); retry.base.auditLog = 0;
  const result = storage.writeSections(dir, retry, { principal });
  assert.equal(result.replayed, true); assert.equal(storage.readAll(dir).auditLog.some(row => row.id === 'hint-one'), false);
});

test('a revision conflict creates neither partial source changes nor an operation receipt', t => {
  const dir = fixture(t), pending = payload(dir, { records:records(dir, { km:102 }) }, 'conflicted-operation');
  storage.writeSections(dir, payload(dir, { records:records(dir, { km:101 }) })); const before = storage.readSnapshot(dir);
  const result = storage.writeSections(dir, pending);
  assert.equal(result.ok, false); assert.ok(result.conflicts.includes('records')); assert.deepEqual(storage.readSnapshot(dir), before);
  assert.equal(audits(dir, 'conflicted-operation').length, 0);
});

test('source rows, trusted audit and receipt roll back together after an interrupted multi-file commit', t => {
  const dir = fixture(t), before = storage.readSnapshot(dir), rename = fs.renameSync;
  const submitted = payload(dir, { records:records(dir, { km:101 }) }, 'interrupted-operation');
  try {
    fs.renameSync = (from, to) => { if (to === storage.sectionFile(dir, 'auditLog')) throw Error('Synthetic commit interruption'); return rename(from, to); };
    assert.throws(() => storage.writeSections(dir, submitted), /Synthetic commit interruption/);
  } finally { fs.renameSync = rename; }
  assert.deepEqual(storage.readSnapshot(dir), before); assert.equal(audits(dir, 'interrupted-operation').length, 0);
});

test('stored audit history cannot be changed or deleted through native saves', t => {
  const dir = fixture(t), before = storage.readSnapshot(dir);
  assert.throws(() => storage.writeSections(dir, payload(dir, { auditLog:[] })), /историю/i);
  assert.throws(() => storage.writeAll(dir, { ...before.data, auditLog:[] }), /историю/i);
  assert.deepEqual(storage.readSnapshot(dir), before);
});

test('unchanged historical audit rows from obsolete sections survive a native descriptive edit', t => {
  const dir = fixture(t), previous = storage.readAll(dir);
  const historical = { id:'old-history-row', section:'obsoleteSection', action:'import', note:'Synthetic historical evidence' };
  fs.writeFileSync(storage.sectionFile(dir, 'auditLog'), JSON.stringify([historical, ...previous.auditLog]));
  const submitted = storage.readAll(dir); submitted.records[0].note = 'Descriptive edit';
  storage.writeAll(dir, submitted);
  assert.deepEqual(storage.readAll(dir).auditLog[0], historical);
});

test('HTTP section and full writes share native integrity, trusted audit and replay protection', async t => {
  const dir = fixture(t), started = await server.start({ port:0, dataDir:dir, key }); t.after(() => server.stop()); assert.equal(started.ok, true);
  const protocol = await request(started.port, '/api/snapshot');
  assert.deepEqual(protocol.body.platform, storage.readSnapshot(dir).platform);
  const submitted = payload(dir, { records:records(dir, { km:101 }) }, 'http-retry-operation');
  const first = await request(started.port, '/api/sections', submitted), before = storage.readSnapshot(dir);
  assert.equal(first.status, 200); assert.equal(first.body.operationReceipt.status, 'committed');
  assert.equal(audits(dir, 'http-retry-operation').find(row => row.section === 'records').actorId, 'legacy-shared-key');
  const repeated = await request(started.port, '/api/sections', submitted); assert.equal(repeated.status, 200); assert.equal(repeated.body.replayed, true);
  const invalid = await request(started.port, '/api/data', { databaseToken:storage.databaseToken(dir), base:storage.readRevisions(dir), data:{ ...before.data, records:records(dir, { vehicleId:'missing' }) } });
  assert.equal(invalid.status, 400); assert.deepEqual(storage.readSnapshot(dir), before);
});
