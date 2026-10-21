const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const engine = require('../assets/core/fuel-engine.js');

// Only synthetic records are used. This module never opens an application profile.
const period = { from: '2026-09-01', to: '2026-09-30' };
function database() {
  return {
    vehicles: [{ id: 'vehicle', org: 'A', fuel: 'gasoline', fuelGrade: 'АИ-95', fuelBalance: 100 }],
    records: [{ id: 'record', vehicleId: 'vehicle', date: '2026-09-05', fuelGrade: 'АИ-95', fuelIssued: 20, fuelActual: 10 }],
    fuelPurchases: [], fuelCards: [], monthlyFuel: [],
  };
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
}
function ending(ledger) { return engine.gsmRound(ledger.rows.reduce((sum, row) => sum + row.end, 0)); }
function assertBalanced(ledger) {
  for (const row of [...ledger.rows, ...ledger.barrels]) {
    assert.equal(engine.gsmRound(row.start + row.issued + row.correction - row.spent), row.end);
  }
}
function calculate(db, range = period) {
  const before = JSON.stringify(db);
  freeze(db);
  const ledger = engine.buildLedger(db, range), balances = engine.recordBalances(db, 'vehicle', range);
  assert.equal(JSON.stringify(db), before, 'calculations must not rewrite source records');
  assertBalanced(ledger);
  return { ledger, balances };
}

test('CommonJS fuel engine has a versioned immutable API and needs no browser globals', () => {
  assert.equal(engine.apiVersion, 1);
  assert.ok(Object.isFrozen(engine));
  for (const name of ['buildLedger', 'recordBalances', 'parseFuelGrade', 'vehicleFuelGrade', 'recordFuelGrade', 'fqRecord', 'fqMeasurementPlan']) {
    assert.equal(typeof engine[name], 'function', name);
  }
  const db = freeze(database());
  assert.equal(engine.recordFuelGrade({ vehicleId: 'vehicle' }, undefined, db), 'АИ-95');
  assert.equal(engine.recordBalances(db, 'vehicle').record, 110);
  assert.equal(engine.recordBalances(db, 'missing').record, undefined);
});

test('standalone browser build executes calculations without document, window, storage or global data', () => {
  const sandbox = {};
  for (const key of ['document', 'window', 'localStorage', 'data']) {
    Object.defineProperty(sandbox, key, { get() { throw new Error('Unexpected global access: ' + key); } });
  }
  const context = vm.createContext(sandbox), source = fs.readFileSync(path.join(__dirname, '../assets/core/fuel-engine.js'), 'utf8');
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/core/decimal-core.js'),'utf8'),context);
  vm.runInContext(source, context, { filename: 'assets/core/fuel-engine.js' });
  const browser = context.TvsFuelEngine, db = freeze(database());
  assert.equal(browser.apiVersion, 1);
  assert.equal(browser.recordBalances(db, 'vehicle').record, 110);
  assert.equal(ending(browser.buildLedger(db, period)), 110);
  assert.equal(browser.parseFuelGrade('AI 95 20 л'), 'АИ-95');
});

test('journal balance and source ledger intentionally retain their distinct receipt priorities', () => {
  const db = database();
  db.fuelPurchases.push({ id: 'purchase', recordId: 'record', vehicleId: 'vehicle', date: '2026-09-05', grade: 'АИ-95', qty: 25, manual: true, sourceOrg: 'A' });
  const { ledger, balances } = calculate(db);
  assert.equal(balances.record, 110, 'journal: opening 100 + entered receipt 20 - spending 10');
  assert.equal(ending(ledger), 115, 'ledger: opening 100 + source purchase 25 - spending 10');
  const discrepancy = ledger.errors.find(issue => issue.code === 'journal-difference');
  assert.equal(discrepancy.qty, 25);
  assert.equal(discrepancy.journalQty, 20);
  assert.equal(ledger.receipts.length, 1, 'the journal receipt must not duplicate its linked purchase');
});

test('conflicting opening totals are exposed while both established calculation contracts are preserved', () => {
  const db = database();
  db.vehicles[0].fuelBalanceSources = [{ org: 'A', grade: 'АИ-95', qty: 80 }];
  const { ledger, balances } = calculate(db);
  assert.equal(balances.record, 110, 'journal keeps its vehicle opening total of 100');
  assert.equal(ending(ledger), 90, 'ledger keeps source allocation 80 + receipt 20 - spending 10');
  assert.ok(ledger.errors.some(issue => issue.code === 'opening-difference'));
});

test('negative source consumption remains diagnosable without silently creating ledger stock', () => {
  const db = database(); db.records[0].fuelActual = -10;
  const { ledger, balances } = calculate(db);
  assert.equal(balances.record, 130, 'legacy journal semantics are not changed by extracting the engine');
  assert.equal(ending(ledger), 120, 'ledger rejects negative consumption as additional stock');
  assert.ok(ledger.errors.some(issue => issue.code === 'negative-input' && issue.recordId === 'record'));
  assert.equal(ledger.rows.reduce((sum, row) => sum + row.spent, 0), 0);
});

test('v2 source ledger and journal retain millilitres while explicit v1 keeps the old journal precision', () => {
  const db = database(); Object.assign(db.records[0], { fuelIssued: 20.555, fuelActual: 10.223 });
  const { ledger, balances } = calculate(db);
  assert.equal(balances.record, 110.332);
  assert.equal(engine.forVersion(1).recordBalances(db,'vehicle').record,110.33);
  assert.equal(ending(ledger), 110.332);
  assert.equal(ledger.rows[0].issued, 20.555);
  assert.equal(ledger.rows[0].spent, 10.223);
});

test('a September period carries actual earlier history and excludes future operations', () => {
  const db = database();
  db.records.unshift({ id: 'august', vehicleId: 'vehicle', date: '2026-08-31', fuelGrade: 'АИ-95', fuelIssued: 40, fuelActual: 5 });
  db.records.push({ id: 'future', vehicleId: 'vehicle', date: '2026-10-01', fuelGrade: 'АИ-95', fuelIssued: 1000, fuelActual: 0 });
  const { ledger, balances } = calculate(db);
  assert.equal(ledger.rows[0].start, 135);
  assert.equal(ending(ledger), 145);
  assert.equal(balances.record, 145);
  assert.equal(balances.future, undefined);
  assert.equal(ledger.receipts.reduce((sum, row) => sum + row.qty, 0), 20);
});

test('zero is entered consumption, blank is missing consumption, and idle remains separate', () => {
  const zero = engine.fqRecord(freeze({ km: 100, fuelActual: 0, fuelIdle: 2 }), freeze({ norm: 10 }));
  assert.equal(zero.source, 'actual'); assert.equal(zero.actual, 0); assert.equal(zero.total, 2); assert.equal(zero.norm, 10);
  const fallback = engine.fqRecord(freeze({ km: 100, fuelActual: ' ', fuelIdle: 2 }), freeze({ norm: 10 }));
  assert.equal(fallback.source, 'norm'); assert.equal(fallback.actual, null); assert.equal(fallback.total, 12);
  const missing = engine.fqRecord(freeze({ km: 100, fuelActual: '' }), freeze({}));
  assert.equal(missing.source, 'missing'); assert.equal(missing.total, null); assert.equal(missing.norm, null);
  assert.equal(engine.fqValue('0'), 0); assert.equal(engine.fqValue(''), null); assert.equal(engine.fqValue(Infinity), null);
});

test('same-day petrol measurement does not reset the gas tank', () => {
  const db = database(); db.vehicles[0].fuelBalance = 0;
  db.records = [
    { id: 'petrol', vehicleId: 'vehicle', date: '2026-09-05', fuelGrade: 'АИ-95', fuelIssued: 100, fuelActual: 20, tankMeasured: 60 },
    { id: 'gas', vehicleId: 'vehicle', date: '2026-09-05', fuelGrade: 'Газ', fuelIssued: 50, fuelActual: 10 },
  ];
  const { ledger, balances } = calculate(db);
  assert.equal(ledger.rows.find(row => row.grade === 'АИ-95').end, 60);
  assert.equal(ledger.rows.find(row => row.grade === 'Газ').end, 40);
  assert.equal(ending(ledger), 100); assert.equal(balances.gas, 100);
});

test('the final measurement of each family is applied once across petrol grades', () => {
  const db = database(); db.vehicles[0].fuelBalance = 0;
  db.records = [
    { id: 'p1', vehicleId: 'vehicle', date: '2026-09-05', fuelGrade: 'АИ-95', fuelIssued: 100, fuelActual: 20, tankMeasured: 70 },
    { id: 'gas', vehicleId: 'vehicle', date: '2026-09-05', fuelGrade: 'Газ', fuelIssued: 30, fuelActual: 4, tankMeasured: 22 },
    { id: 'p2', vehicleId: 'vehicle', date: '2026-09-05', fuelGrade: 'АИ-92', fuelActual: 5, tankMeasured: 60 },
    { id: 'p3', vehicleId: 'vehicle', date: '2026-09-05', fuelGrade: 'АИ-95', fuelActual: 3 },
  ];
  const { ledger, balances } = calculate(db);
  assert.equal(ledger.rows.filter(row => row.grade !== 'Газ').reduce((sum, row) => sum + row.end, 0), 60);
  assert.equal(ledger.rows.find(row => row.grade === 'Газ').end, 22);
  assert.equal(ending(ledger), 82); assert.equal(balances.p3, 82);
  assert.equal(ledger.rows.reduce((sum, row) => sum + row.spent, 0), 48);
});

test('historical card ownership determines source allocations without rewriting card history', () => {
  const db = database(); db.vehicles[0].fuelBalance = 0;
  db.fuelCards = [{ number: '123 456', org: 'B', orgHistory: [{ org: 'A', from: '', to: '2026-09-10' }, { org: 'B', from: '2026-09-11', to: '' }], assignments: [{ vehicleId: 'vehicle', from: '', to: '' }] }];
  db.records = [
    { id: 'early', vehicleId: 'vehicle', date: '2026-09-05', fuelGrade: 'АИ-95', fuelIssued: 20, fuelActual: 0 },
    { id: 'late', vehicleId: 'vehicle', date: '2026-09-15', fuelGrade: 'АИ-95', fuelIssued: 30, fuelActual: 0 },
  ];
  db.fuelPurchases = db.records.map((row, index) => ({ id: 'purchase-' + index, recordId: row.id, vehicleId: row.vehicleId, date: row.date, grade: row.fuelGrade, qty: row.fuelIssued, cardNo: '123456' }));
  const { ledger } = calculate(db);
  assert.equal(ledger.barrels.find(row => row.org === 'A').end, 20);
  assert.equal(ledger.barrels.find(row => row.org === 'B').end, 30);
  assert.equal(engine.gsmCardAt(db, '123-456', '2026-09-05').org, 'A');
});

test('repeated calculations are deterministic and diesel cannot erase a petrol shortage', () => {
  const db = database();
  Object.assign(db.vehicles[0], { fuelBalance: 50, fuelBalanceSources: [{ org: 'A', grade: 'ДТ', qty: 50 }] });
  Object.assign(db.records[0], { fuelIssued: 0, fuelActual: 10 });
  const { ledger } = calculate(db), again = engine.buildLedger(db, period);
  assert.deepEqual(again, ledger);
  assert.equal(ledger.rows.find(row => row.grade === 'ДТ').end, 50);
  assert.equal(ledger.rows.find(row => row.grade === 'АИ-95').end, -10);
  assert.ok(ledger.errors.some(issue => issue.code === 'shortage' && issue.grade === 'АИ-95'));
});
