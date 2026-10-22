const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const storage = require('../electron/storage');
const access = require('../electron/access-control');
const server = require('../electron/server');
const writeoff = require('../assets/core/writeoff-engine.js');

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tvs-writeoff-test-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('tvs-writeoff-test-'));
    fs.rmSync(dir, { recursive:true, force:true });
  });
  return dir;
}
function fixture() {
  return {
    vehicles:[{ id:'v', plate:'ТЕСТ001', org:'A', fuelGrade:'ДТ', fuelBalance:100, norm:10, fuelcard:'123' }],
    records:[{ id:'r', vehicleId:'v', date:'2026-09-10', km:100, fuelGrade:'ДТ', fuelIssued:20, fuelActual:10, fuelCardNum:'123' }],
    fuelPurchases:[{ id:'p', recordId:'r', vehicleId:'v', date:'2026-09-10', grade:'ДТ', cardNo:'123', qty:20, sourceOrg:'A' }],
    fuelCards:[{ id:'c', number:'123', org:'A', assignments:[{ from:'2026-06-01', vehicleId:'v', org:'A' }] }]
  };
}
const requestScope = { month:'2026-09', org:'A', grade:'ДТ', date:'2026-09-30' };
const forged = { id:'client-choice', name:'Client supplied actor', role:'admin' };
function document(db, patch = {}) {
  const request = { ...requestScope, ...patch }, prepared = writeoff.prepare(db, request);
  assert.equal(prepared.canPost, true, JSON.stringify(prepared.issues));
  return structuredClone(writeoff.post(db, request, { id:'w', number:'TEST-1',
    postedAt:'2026-10-01T00:00:00.000Z', postedBy:forged, expectedFingerprint:prepared.sourceFingerprint }));
}
function save(dir, sections, options) {
  return storage.writeSections(dir, { base:storage.readRevisions(dir), databaseToken:storage.databaseToken(dir), sections }, options);
}
function posted(t) {
  const dir = temp(t); storage.writeAll(dir, fixture());
  save(dir, { fuelWriteoffs:[document(storage.readAll(dir))] }, { now:'2026-10-21T12:00:00.000Z' });
  return { dir, doc:storage.readAll(dir).fuelWriteoffs[0] };
}

test('old databases gain an empty writeoff section and backups preserve posted snapshots', t => {
  const root = temp(t), dir=path.join(root,'source'), source = fixture(); storage.writeAll(dir, source);
  assert.deepEqual(storage.readAll(dir).fuelWriteoffs, []);
  assert.deepEqual(storage.readAll(dir).records, source.records);
  const result = save(dir, { fuelWriteoffs:[document(storage.readAll(dir))] });
  assert.ok(result.changed.includes('fuelWriteoffs'));
  const backup = storage.makeDailyBackup(dir, path.join(root, 'backups'));
  assert.match(backup,/\.zip$/);
  const recovery=require('../electron/backup-service.cjs'),restored=path.join(root,'restored');
  assert.equal(recovery.verifyPackage({archivePath:backup}).ok,true);
  recovery.restorePackage({archivePath:backup,targetDir:restored,protectedDir:dir});
  assert.deepEqual(storage.readSnapshot(restored).data.fuelWriteoffs, storage.readAll(dir).fuelWriteoffs);
  assert.equal(require('../electron/document-archive.cjs').head(storage.readAll(restored)),require('../electron/document-archive.cjs').head(storage.readAll(dir)));
});

test('storage validates a post and replaces client authors and timestamps with trusted metadata', t => {
  const dir = temp(t); storage.writeAll(dir, fixture());
  const before = storage.readAll(dir), principal = { id:'bookkeeper', name:'Тестовый бухгалтер', role:'accountant' };
  const result = save(dir, { fuelWriteoffs:[document(before)] }, { principal, now:'2026-10-21T12:00:00.000Z' });
  const current = storage.readAll(dir), doc = current.fuelWriteoffs[0];
  assert.deepEqual(doc.postedBy, principal); assert.equal(doc.postedAt, '2026-10-21T12:00:00.000Z');
  assert.deepEqual(doc.events[0], { type:'posted', at:doc.postedAt, by:principal });
  assert.deepEqual(result.canonicalSections.fuelWriteoffs, [doc]);
  for (const name of ['vehicles', 'records', 'fuelPurchases', 'fuelCards']) assert.deepEqual(current[name], before[name], name);
});

test('a forged new snapshot or stale preview cannot become a posted document', t => {
  const dir = temp(t); storage.writeAll(dir, fixture());
  const before = storage.readSnapshot(dir), doc = document(before.data);
  const bad = structuredClone(doc); bad.totals = { ...bad.totals, spent:9999 };
  assert.throws(() => save(dir, { fuelWriteoffs:[bad] }));
  const changedRecords = structuredClone(before.data.records); changedRecords[0].fuelActual = 11;
  assert.throws(() => save(dir, { records:changedRecords, fuelWriteoffs:[doc] }));
  assert.deepEqual(storage.readSnapshot(dir), before);
});

test('posted documents cannot be edited, deleted or silently replaced by a full database write', t => {
  const { dir, doc } = posted(t), before = storage.readSnapshot(dir);
  const changes = [
    { ...doc, number:'DIFFERENT' },
    { ...doc, status:'draft' },
    { ...doc, sourceFingerprint:'sha256:' + '0'.repeat(64) },
    { ...doc, events:[] },
    { ...doc, snapshot:{ ...doc.snapshot, vehicles:[] } }
  ];
  for (const changed of changes) assert.throws(() => save(dir, { fuelWriteoffs:[changed] }));
  assert.throws(() => save(dir, { fuelWriteoffs:[] }));
  assert.throws(() => storage.writeAll(dir, { ...before.data, fuelWriteoffs:[] }));
  assert.deepEqual(storage.readSnapshot(dir), before);
});

test('every source change affecting a posted act is rejected before rows or revisions are committed', t => {
  const { dir } = posted(t), before = storage.readSnapshot(dir);
  const changes = [
    ['records', row => { row.fuelActual = 11; }],
    ['records', row => { row.km = 101; }],
    ['fuelPurchases', row => { row.qty = 21; }],
    ['fuelCards', row => { row.org = 'B'; row.assignments[0].org = 'B'; }],
    ['vehicles', row => { row.fuelBalance = 101; }]
  ];
  for (const [name, mutate] of changes) {
    const rows = structuredClone(before.data[name]); mutate(rows[0]);
    assert.throws(() => save(dir, { [name]:rows }), name);
    assert.deepEqual(storage.readSnapshot(dir), before, name);
  }
});

test('future unrelated operations do not freeze the rest of the database', t => {
  const { dir, doc } = posted(t), db = storage.readAll(dir);
  db.records.push({ id:'future', vehicleId:'v', date:'2026-10-01', km:25, fuelActual:2 });
  assert.equal(save(dir, { records:db.records }).ok, true);
  assert.deepEqual(storage.readAll(dir).fuelWriteoffs[0], doc);
});

test('unrelated cost and procurement saves preserve posted acts without recalculating their fuel sources', t => {
  const { dir, doc } = posted(t), before = storage.readAll(dir);
  const engineModule = require.cache[require.resolve('../assets/core/writeoff-engine.js')], original = engineModule.exports;
  let recalculations = 0;
  engineModule.exports = { ...original, validateWriteoffChanges(...args) { recalculations++; return original.validateWriteoffChanges(...args); } };
  try {
    const result = save(dir, {
      costEntries:[{ id:'independent-cost',assetRef:'v:v',date:'2026-10-21',kind:'expense',amount:10,title:'Synthetic expense',independent:true }],
      parts:[{ id:'part',name:'Synthetic part' }]
    });
    assert.equal(result.ok, true); assert.equal(recalculations, 0);
    const operations=require('../assets/core/procurement-operations'),commands=require('../assets/core/platform-commands'),snapshot=storage.readSnapshot(dir),input={action:'saveOrder',payload:{kind:'part',itemId:'part',supplier:'Synthetic supplier',quantity:1,deliveryDate:'2026-10-22',status:'ordered',note:''},reason:'Explicit reviewed independent procurement'},review=operations.preview(snapshot.data,input,{today:'2026-10-22'}),command={type:'ProcurementAction',version:1,input:{...input,reviewFingerprint:review.fingerprint}};
    const planned=storage.executeCommand(dir,{protocolVersion:1,databaseToken:snapshot.databaseToken,base:Object.fromEntries(commands.dependencies(command).map(name=>[name,snapshot.revisions[name]])),operation:{id:'order'},command},{principal:{id:'procurement-admin',name:'Synthetic administrator',role:'admin'},now:'2026-10-22T12:00:00.000Z'});
    assert.equal(planned.ok,true);assert.equal(recalculations,0);
  } finally { engineModule.exports = original; }
  const current = storage.readAll(dir);
  assert.deepEqual(current.fuelWriteoffs, [doc]); assert.deepEqual(current.records, before.records);
  assert.equal(current.costEntries[0].amount, 10); assert.equal(current.procurementOrders[0].quantity, 1);
  assert.throws(() => save(dir, { costEntries:[{ ...current.costEntries[0], amount:20 }] },
    { principal:{ id:'viewer',name:'Viewer',role:'viewer' } }), /Роль/);
});

test('an explicit void keeps the original snapshot and permits a later source correction', t => {
  const { dir, doc } = posted(t), principal = { id:'dispatcher', name:'Тестовый диспетчер', role:'dispatcher' };
  const cancelled = writeoff.voidDocument(doc, { voidedAt:'2026-10-21T13:00:00.000Z', voidedBy:forged, reason:'Уточнение первичного документа' });
  const result = save(dir, { fuelWriteoffs:[cancelled] }, { principal, now:'2026-10-21T13:00:00.000Z' });
  const current = storage.readAll(dir), saved = current.fuelWriteoffs[0];
  assert.equal(saved.status, 'void'); assert.deepEqual(saved.snapshot, doc.snapshot);
  assert.deepEqual(saved.voidedBy, principal); assert.equal(saved.voidedAt, '2026-10-21T13:00:00.000Z');
  assert.deepEqual(saved.events[0], doc.events[0]); assert.equal(saved.events[1].type, 'void');
  assert.deepEqual(result.canonicalSections.fuelWriteoffs, [saved]);
  current.records[0].fuelActual = 11;
  assert.equal(save(dir, { records:current.records }).ok, true);
  assert.throws(() => save(dir, { fuelWriteoffs:[doc] }));
  assert.throws(() => save(dir, { fuelWriteoffs:[{ ...saved, voidReason:'Другая причина' }] }));
});

test('atomic void and source correction still require permission for every changed section', t => {
  const { dir, doc } = posted(t), before = storage.readSnapshot(dir), records = structuredClone(before.data.records);
  records[0].fuelActual = 11;
  const cancelled = writeoff.voidDocument(doc, { voidedAt:new Date(Date.parse(doc.postedAt) + 1000).toISOString(), voidedBy:forged, reason:'Уточнение расхода' });
  for (const role of ['accountant', 'mechanic', 'viewer']) {
    assert.throws(() => save(dir, { records, fuelWriteoffs:[cancelled] }, { principal:{ id:role, name:role, role } }), /Роль/);
    assert.deepEqual(storage.readSnapshot(dir), before);
  }
  assert.equal(save(dir, { records, fuelWriteoffs:[cancelled] }, { principal:{ id:'dispatcher', name:'Dispatcher', role:'dispatcher' } }).ok, true);
});

function request(port, token, route, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host:'127.0.0.1', port, path:route, method:body ? 'POST' : 'GET',
      headers:{ Authorization:'Bearer ' + token, 'Content-Type':'application/json' } }, res => {
      let raw = ''; res.setEncoding('utf8'); res.on('data', part => { raw += part; });
      res.on('end', () => resolve({ status:res.statusCode, body:JSON.parse(raw) }));
    });
    req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
  });
}
test('authenticated HTTP saves own document authors and history; role checks cannot be bypassed with atomic payloads', async t => {
  const dir = temp(t); storage.writeAll(dir, fixture());
  const tokens = Object.fromEntries(['admin', 'dispatcher', 'accountant', 'mechanic', 'viewer'].map(role => [role, access.issueToken()]));
  const users = Object.entries(tokens).map(([role, token]) => ({ id:role, name:'Test ' + role, role, enabled:true, tokenHash:token.tokenHash }));
  const started = await server.start({ port:0, dataDir:dir, settings:{ serverUsers:users } });
  assert.equal(started.ok, true); t.after(() => server.stop());
  const payload = sections => ({ databaseToken:storage.databaseToken(dir), base:storage.readRevisions(dir), sections });
  const created = await request(started.port, tokens.accountant.token, '/api/sections', payload({ fuelWriteoffs:[document(storage.readAll(dir))] }));
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const db = storage.readAll(dir), doc = db.fuelWriteoffs[0];
  assert.equal(doc.postedBy.id, 'accountant'); assert.equal(doc.postedBy.role, 'accountant');
  assert.deepEqual(created.body.canonicalSections.fuelWriteoffs, [doc]);
  const audit = db.auditLog.find(row => row.section === 'fuelWriteoffs');
  assert.equal(audit.actorId, 'accountant'); assert.deepEqual(audit.after, doc);
  const cancelled = writeoff.voidDocument(doc, { voidedAt:new Date(Date.parse(doc.postedAt) + 1000).toISOString(), voidedBy:forged, reason:'Уточнение расхода' });
  const records = structuredClone(db.records); records[0].fuelActual = 11;
  for (const role of ['accountant', 'mechanic', 'viewer']) {
    const result = await request(started.port, tokens[role].token, '/api/sections', payload({ records, fuelWriteoffs:[cancelled] }));
    assert.equal(result.status, 403, role); assert.deepEqual(storage.readAll(dir).fuelWriteoffs, [doc]);
  }
  const accepted = await request(started.port, tokens.dispatcher.token, '/api/sections', payload({ records, fuelWriteoffs:[cancelled] }));
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(storage.readAll(dir).fuelWriteoffs[0].voidedBy.id, 'dispatcher');
});
