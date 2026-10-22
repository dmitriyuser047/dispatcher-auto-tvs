const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../assets/core/dispatcher-core.js');
const application = require('../assets/core/application-engine.js');
const fuel = require('../assets/core/fuel-engine.js');
const costs = require('../assets/js/45-cost-engine.js');
const procurement = require('../assets/js/47-procurement-engine.js');

function fixture() {
  return { vehicles: [{ id: 'v', plate: 'SYNTHETIC', org: 'A', fuelGrade: 'АИ-95', fuelBalance: 100, norm: 10 }],
    records: [{ id: 'r', vehicleId: 'v', date: '2026-09-01', fuelGrade: 'АИ-95', fuelIssued: 20, fuelActual: 10, km: 100 }],
    fuelPurchases: [{ id: 'p', recordId: 'r', vehicleId: 'v', date: '2026-09-01', grade: 'АИ-95', qty: 20, sourceOrg: 'A' }],
    costEntries: [{ id: 'c', assetRef: 'v:v', date: '2026-09-01', kind: 'expense', category: 'Прочее', title: 'Synthetic', amount: 100, independent: true }],
    tanks: [{ id: 't', name: 'Synthetic fuel', balanceInit: 100 }], parts: [], generators: [], genRecords: [],
    fuelCards: [], monthlyFuel: [], procurementOrders: [], procurementRules: [], tankIncomes: [], fuelMovements: [], partMovements: [] };
}
function counterEngine(options = {}) {
  let calls = 0;
  const engine = core.createEngine({ ...options, modules: { amount: { version: '1', sections: ['rows'], calculate(db, query) {
    calls++; return { value: db.rows.reduce((sum, row) => sum + row.value, 0) * (query.factor || 1), row: db.rows[0] };
  } } } });
  return { engine, calls: () => calls };
}
function frozen(value) { if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); } return value; }

test('the standalone application catalog exposes current calculations and a distinct valuation service without a DOM', () => {
  assert.equal(core.apiVersion, 1); assert.equal(application.apiVersion, 1);
  assert.ok(Object.isFrozen(core)); assert.ok(Object.isFrozen(application));
  const engine = application.create(), db = frozen(fixture()), range = { from: '2026-09-01', to: '2026-09-30' };
  assert.deepEqual(engine.describe().map(row => row.name), ['fuel', 'fuelRecords', 'fuelAudit', 'writeoff', 'writeoffPost', 'costs', 'costValuation', 'procurement']);
  assert.deepEqual(engine.query('fuel', db, range), fuel.buildLedger(db, range));
  assert.deepEqual(engine.query('fuelRecords', db, { ...range, vehicleId: 'v' }), fuel.recordBalances(db, 'v', range));
  assert.deepEqual(engine.query('costs', db, range), costs.buildReport(db, range));
  assert.deepEqual(engine.query('costValuation',db,range),costs.buildFullReport(db,range));
  assert.deepEqual(engine.query('procurement', db, { date: '2026-09-30' }), procurement.plan(db, { date: '2026-09-30' }));
});

test('repeated identical queries calculate once and return independently editable results', () => {
  const { engine, calls } = counterEngine(), db = { rows: [{ value: 10 }] }, before = JSON.stringify(db);
  const first = engine.query('amount', db); first.value = 999; first.row.value = 999;
  const second = engine.query('amount', db); assert.equal(second.value, 10); assert.equal(second.row.value, 10);
  second.row.value = -1;
  assert.equal(engine.query('amount', db).value, 10); assert.equal(calls(), 1);
  assert.equal(engine.stats().hits, 2); assert.equal(JSON.stringify(db), before);
});

test('an in-place source edit recalculates despite retaining the same database and array references', () => {
  const { engine, calls } = counterEngine(), db = { rows: [{ value: 10 }] }, rows = db.rows;
  assert.equal(engine.query('amount', db).value, 10); db.rows[0].value = 25;
  assert.equal(engine.query('amount', db).value, 25); assert.equal(db.rows, rows); assert.equal(calls(), 2);
});

test('only declared dependencies affect a calculation and object key order does not create false misses', () => {
  const { engine, calls } = counterEngine();
  const db = { rows: [{ value: 10, id: 'a' }], unrelated: [{ hidden: 1 }] };
  engine.query('amount', db, { factor: 2, label: 'x' }); db.unrelated[0].hidden = 2;
  db.rows = [{ id: 'a', value: 10 }];
  assert.equal(engine.query('amount', db, { label: 'x', factor: 2 }).value, 20);
  assert.equal(calls(), 1);
});

test('array order is preserved as part of the fingerprint because measurement order matters', () => {
  let calls = 0;
  const engine = core.createEngine({ modules: { first: { sections: ['rows'], calculate(db) { calls++; return db.rows[0].id; } } } });
  const db = { rows: [{ id: 'a' }, { id: 'b' }] };
  assert.equal(engine.query('first', db), 'a'); db.rows.reverse(); assert.equal(engine.query('first', db), 'b');
  assert.equal(calls, 2);
});

test('permissions are intersected before calculation and closed sources never reach the service', () => {
  const engine = core.createEngine({ modules: { visible: { sections: ['publicRows', 'privateRows'], calculate: (db, query) => ({ db, readable: query.readable }) } } });
  const db = { publicRows: [{ value: 1 }], privateRows: [{ secret: 7 }] };
  const restricted = engine.query('visible', db, { readable: ['publicRows', 'privateRows'] }, { identity: 'A', readable: ['publicRows'] });
  assert.deepEqual(restricted.db.privateRows, []); assert.deepEqual(restricted.readable, ['publicRows']);
  const empty = engine.query('visible', db, { readable: [] }, { identity: 'A', readable: ['publicRows'] });
  assert.deepEqual(empty.db.publicRows, []);
  const unrestricted = engine.query('visible', db, {}, { identity: 'B' });
  assert.equal(unrestricted.db.privateRows[0].secret, 7); assert.equal(engine.stats().calculations, 3);
});

test('database and principal identities get separate cache entries even with identical source contents', () => {
  const { engine, calls } = counterEngine(), db = { rows: [{ value: 10 }] };
  for (const identity of ['database-A:operator-A', 'database-B:operator-A', 'database-A:operator-B'])
    engine.query('amount', db, {}, { identity });
  assert.equal(calls(), 3);
  engine.query('amount', db, {}, { identity: 'database-A:operator-A' }); assert.equal(calls(), 3);
});

test('LRU capacity and explicit invalidation bound storage without retaining stale results', () => {
  const { engine, calls } = counterEngine({ maxEntries: 2 }), db = { rows: [{ value: 10 }] };
  for (const factor of [1, 2, 1, 3, 2]) engine.query('amount', db, { factor });
  assert.equal(calls(), 4); assert.equal(engine.stats().hits, 1); assert.equal(engine.stats().entries, 2); assert.equal(engine.stats().evictions, 2);
  engine.clear(); assert.equal(engine.stats().entries, 0); engine.query('amount', db, { factor: 2 }); assert.equal(calls(), 5);
  const disabled = counterEngine({ maxEntries: 0 }); disabled.engine.query('amount', db); disabled.engine.query('amount', db);
  assert.equal(disabled.calls(), 2); assert.equal(disabled.engine.stats().entries, 0);
});

test('the content budget evicts cached periods and oversized queries still calculate correctly', () => {
  const { engine, calls } = counterEngine({ maxCacheCharacters: 300 }), db = { rows: [{ value: 10 }] };
  engine.query('amount', db, { label: 'x'.repeat(100) });
  engine.query('amount', db, { label: 'y'.repeat(100) });
  assert.ok(engine.stats().cachedCharacters <= 300); assert.ok(engine.stats().evictions > 0);
  const result = engine.query('amount', db, { label: 'z'.repeat(1000) }); assert.equal(result.value, 10);
  assert.ok(engine.stats().uncached > 0); assert.equal(calls(), 3);
  engine.clear(); assert.equal(engine.stats().cachedCharacters, 0);
});

test('maps, sets and shared references survive copying without letting a caller poison cache or inputs', () => {
  const engine = core.createEngine({ modules: { structures: { sections: ['rows'], calculate(db) {
    const row = db.rows[0]; return { row, map: new Map([[row, row]]), set: new Set([row]), date: new Date('2026-09-30T12:00:00Z') };
  } } } });
  const db = { rows: [{ id: 'a' }] }, result = engine.query('structures', db);
  assert.equal(result.map.get(result.row), result.row); assert.ok(result.set.has(result.row));
  result.map.clear(); result.set.clear(); result.row.id = 'changed'; result.date.setUTCFullYear(2000);
  const next = engine.query('structures', db);
  assert.equal(next.map.size, 1); assert.equal(next.set.size, 1); assert.equal(next.row.id, 'a');
  assert.equal(next.date.getUTCFullYear(), 2026); assert.equal(db.rows[0].id, 'a');
});

test('calculators receive an owned frozen snapshot and cannot mutate the live database', () => {
  const db = { rows: [{ value: 10 }] };
  const engine = core.createEngine({ modules: { broken: { sections: ['rows'], calculate(snapshot) {
    'use strict'; snapshot.rows[0].value = 200; return snapshot;
  } } } });
  assert.throws(() => engine.query('broken', db), TypeError); assert.equal(db.rows[0].value, 10);
  assert.equal(engine.stats().entries, 0); assert.equal(engine.stats().failures, 1);
});

test('invalid snapshots fail explicitly rather than being silently converted into zeroes', () => {
  const { engine } = counterEngine();
  for (const value of [NaN, Infinity, 1n, () => 1])
    assert.throws(() => engine.query('amount', { rows: [{ value }] }), { code: 'INVALID_SNAPSHOT' });
  const circular = {}; circular.self = circular;
  assert.throws(() => engine.query('amount', { rows: [circular] }), { code: 'INVALID_SNAPSHOT' });
  assert.throws(() => engine.query('amount', { rows: {} }), { code: 'INVALID_SNAPSHOT' });
  const poisoned = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.throws(() => engine.query('amount', { rows: [poisoned] }), { code: 'INVALID_SNAPSHOT' });
  assert.equal({}.polluted, undefined); assert.equal(engine.stats().entries, 0);
});

test('configuration, access and service errors remain actionable and never populate the cache', () => {
  assert.throws(() => core.createEngine({ maxEntries: 65 }), { code: 'INVALID_CONFIGURATION' });
  assert.throws(() => core.createEngine({ modules: { broken: { sections: [], calculate() {} } } }), { code: 'INVALID_CONFIGURATION' });
  const { engine } = counterEngine();
  assert.throws(() => engine.query('missing', {}), { code: 'UNKNOWN_MODULE' });
  assert.throws(() => engine.query('amount', {}, {}, { readable: 'all' }), { code: 'INVALID_ACCESS' });
  assert.throws(() => engine.query('amount', {}, false), { code: 'INVALID_ARGUMENT' });
  const asynchronous = core.createEngine({ modules: { later: { sections: ['rows'], calculate: () => Promise.resolve(1) } } });
  assert.throws(() => asynchronous.query('later', {}), { code: 'ASYNC_RESULT' }); assert.equal(asynchronous.stats().entries, 0);
  const nonfinite = core.createEngine({ modules: { badNumber: { sections: ['rows'], calculate: () => ({ total: Infinity }) } } });
  assert.throws(() => nonfinite.query('badNumber', {}), { code: 'INVALID_RESULT' }); assert.equal(nonfinite.stats().entries, 0);
});

test('the Node procurement API requires a date and never caches a hidden moving clock', () => {
  const engine = application.create(), db = fixture();
  assert.throws(() => engine.query('procurement', db), /Укажите дату/); assert.equal(engine.stats().entries, 0);
  const first = engine.query('procurement', db, { date: '2026-09-30' }), next = engine.query('procurement', db, { date: '2026-10-01' });
  assert.equal(first[0].recent.to, '2026-09-30'); assert.equal(next[0].recent.to, '2026-10-01');
});

test('fuel runtime retains the intentional journal and statement projections and the ledger millilitres', () => {
  const db = fixture(), before = JSON.stringify(db), engine = application.create(); db.fuelPurchases[0].qty = 25;
  assert.equal(engine.query('fuelRecords', db, { vehicleId: 'v' }).r, 110);
  const result = engine.query('fuel', db, { from: '2026-09-01', to: '2026-09-30' });
  assert.equal(result.rows[0].end, 115); assert.ok(result.issues.some(row => row.code === 'journal-difference'));
  result.rows[0].vehicle.fuelBalance = 0; result.rows[0].cards.add('fake-card');
  const again = engine.query('fuel', db, { from: '2026-09-01', to: '2026-09-30' });
  assert.equal(again.rows[0].vehicle.fuelBalance, 100); assert.equal(again.rows[0].cards.has('fake-card'), false);
  db.fuelPurchases[0].qty = 20; assert.equal(JSON.stringify(db), before);
});
