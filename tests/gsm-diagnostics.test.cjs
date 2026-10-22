const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ctx = vm.createContext({ console, window: {}, document: { addEventListener() {}, documentElement: { removeAttribute() {} }, getElementById() {} }, localStorage: { getItem() {} } });
for(const file of ['assets/core/decimal-core.js','assets/core/effective-periods.js','assets/js/55-precision-input.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx,{filename:file});
vm.runInContext(fs.readFileSync(path.join(root, 'assets/core/fuel-engine.js'), 'utf8'), ctx, { filename: 'assets/core/fuel-engine.js' });
vm.runInContext(fs.readFileSync(path.join(root, 'assets/core/fuel-audit.js'), 'utf8'), ctx, { filename: 'assets/core/fuel-audit.js' });
for (const file of ['01-core.js', '29-fuel-quality.js', '25b-fuel-purchases.js', '25c-fuel-control.js', '25i-gsm-ledger.js', '25m-gsm-diagnostics.js'])
  vm.runInContext(fs.readFileSync(path.join(root, 'assets/js', file), 'utf8'), ctx, { filename: file });

// These fixtures are synthetic and independent of the user's accounting database.
function database() {
  return { vehicles: [{ id: 'v', plate: 'SYNTHETIC', org: 'A', fuel: 'gasoline', fuelGrade: 'АИ-95', fuelBalance: 0, norm: 10 }],
    fuelCards: [{ id: 'c', number: '111111', org: 'A', assignments: [{ vehicleId: 'v' }] }],
    records: [], fuelPurchases: [], monthlyFuel: [] };
}
function record(db, id, date, extra = {}) { db.records.push({ id, vehicleId: 'v', date, fuelGrade: 'АИ-95', km: 0, fuelActual: 0, ...extra }); }
function purchase(db, id, date, extra = {}) { db.fuelPurchases.push({ id, vehicleId: 'v', date, grade: 'АИ-95', cardNo: '111111', qty: 10, ...extra }); }
function model(db, options = {}) { return ctx.gsmAuditModel(db, { from: '2026-09-01', to: '2026-09-30', coverage: false, ...options }); }
function codes(result, code) { return result.items.filter(item => item.code === code); }
function freeze(value) { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); } return value; }

test('diagnosis never mutates frozen sources or treats a large valid measurement as a size error', () => {
  const db = database(); db.vehicles[0].fuelBalance = 1000;
  record(db, 'anchor', '2026-08-31', { tankMeasured: 923.537 });
  const before = JSON.stringify(db), result = model(freeze(db));
  assert.equal(JSON.stringify(db), before);
  assert.equal(result.items.length, 0);
});

test('negative September carry identifies its unresolved August source rather than the export date', () => {
  const db = database(); record(db, 'august-cause', '2026-08-12', { fuelActual: 25 });
  record(db, 'september-cause', '2026-09-02', { fuelActual: 5 });
  const item = codes(model(db), 'negative-ending')[0];
  assert.equal(item.earliestCauseDate, '2026-08-12');
  assert.equal(item.observedDate, '2026-09-30');
  assert.equal(item.impact.opening, -25); assert.equal(item.impact.closing, -30);
  assert.ok(item.repairRefs.some(ref => ref.type === 'record' && ref.id === 'august-cause'));
  assert.equal(codes(model(db), 'unfunded-consumption').length, 0, 'do not count the same ending deficit twice');
});

test('a recovered stock traces the current deficit after the recovery', () => {
  const db = database(); record(db, 'old', '2026-08-01', { fuelActual: 10 });
  record(db, 'recovery', '2026-08-02', { fuelIssued: 20, fuelCardNum: '111111' });
  record(db, 'new', '2026-09-05', { fuelActual: 15 });
  const item = codes(model(db), 'negative-ending')[0];
  assert.equal(item.earliestCauseDate, '2026-09-05');
  assert.ok(item.chronology.every(event => event.date === '2026-09-05'));
  assert.equal(item.impact.closing, -5);
});

test('a negative opening repaired later still points to its earlier cause', () => {
  const db = database(); record(db, 'old', '2026-08-15', { fuelActual: 10 });
  record(db, 'later', '2026-09-05', { fuelIssued: 30, fuelCardNum: '111111' });
  const item = codes(model(db), 'negative-opening')[0];
  assert.equal(item.earliestCauseDate, '2026-08-15'); assert.equal(item.impact.closing, 20);
  assert.equal(codes(model(db), 'negative-ending').length, 0);
});

test('intraperiod shortages with a nonnegative ending are grouped and retain source links', () => {
  const db = database(); record(db, 'first', '2026-09-01', { fuelActual: 10 });
  record(db, 'second', '2026-09-02', { fuelActual: 5 });
  record(db, 'supply', '2026-09-03', { fuelIssued: 20, fuelCardNum: '111111' });
  const items = codes(model(db), 'unfunded-consumption');
  assert.equal(items.length, 1); assert.equal(items[0].chronologyCount, 2);
  assert.ok(items[0].repairRefs.some(ref => ref.id === 'first'));
});

test('restoration candidates remain visible with missing time or different vehicle metadata', () => {
  const db = database(); record(db, 'r', '2026-08-10', { fuelIssued: 10 });
  purchase(db, 'original', '2026-08-10', { recordId: 'r', time: '12:00' });
  purchase(db, 'restored', '2026-08-10', { recordId: 'r', time: '', restored: true });
  assert.equal(codes(model(db), 'possible-duplicate').length, 0, 'the selected month does not become a separate audit of older purchases');
  const items = codes(model(db, { from: '2026-08-01', to: '2026-08-31' }), 'possible-duplicate');
  assert.equal(items.length, 1);
  assert.equal(items[0].category, 'evidence');
  assert.equal(items[0].sourceRefs.filter(ref => ref.type === 'purchase').length, 2);
});

test('ordinary equal-volume purchases at different times are not presumed duplicates', () => {
  const db = database(); purchase(db, 'one', '2026-09-10', { time: '10:00' });
  purchase(db, 'two', '2026-09-10', { time: '14:00' });
  assert.equal(codes(model(db), 'possible-duplicate').length, 0);
  db.fuelPurchases[1].time = '10:00';
  assert.equal(codes(model(db), 'possible-duplicate').length, 1);
});

test('journal difference links every contributing purchase and the journal', () => {
  const db = database(); record(db, 'r', '2026-09-10', { fuelIssued: 10 });
  purchase(db, 'one', '2026-09-10', { recordId: 'r', qty: 10 });
  purchase(db, 'two', '2026-09-10', { recordId: 'r', qty: 5 });
  const item = codes(model(db), 'journal-difference')[0];
  assert.equal(item.impact.qty, 15); assert.equal(item.impact.journalQty, 10);
  assert.ok(item.repairRefs.some(ref => ref.id === 'r'));
  assert.ok(item.repairRefs.some(ref => ref.id === 'one'));
  assert.ok(item.repairRefs.some(ref => ref.id === 'two'));
});

test('an unambiguous legacy link is a warning and does not claim an unrecorded receipt', () => {
  const db = database(); record(db, 'actual', '2026-09-10', { fuelIssued: 10 });
  purchase(db, 'p', '2026-09-10', { recordId: 'gone' });
  const result = model(db), item = codes(result, 'stale-record-link')[0];
  assert.equal(item.category, 'warning');
  assert.equal(codes(result, 'journal-missing').length, 0);
  assert.ok(item.sourceRefs.some(ref => ref.id === 'actual'));
});

test('invalid source values and unsupported grades retain editable source references', () => {
  const db = database(); purchase(db, 'bad', 'invalid', { qty: 'bad', sum: -2, grade: 'old-text' });
  record(db, 'orphan', '2026-09-01', { vehicleId: 'missing', km: 1 });
  const result = model(db);
  assert.equal(codes(result, 'invalid-value').length, 2);
  assert.ok(codes(result, 'invalid-value').every(item => item.sourceRefs.some(ref => ref.type === 'purchase' && ref.id === 'bad')));
  assert.equal(codes(result, 'unsupported-grade').length, 1);
  assert.equal(codes(result, 'record-vehicle-missing').length, 1);
});

test('measurement coverage is a warning and does not invent a measurement or target balance', () => {
  const db = database(); db.vehicles[0].fuelBalance = 30;
  record(db, 'midmonth', '2026-09-10', { fuelActual: 5 });
  const result = model(db, { coverage: true }), items = codes(result, 'ending-unmeasured');
  assert.equal(items.length, 1); assert.equal(items[0].category, 'warning');
  assert.ok(items[0].repairRefs.some(ref => ref.type === 'journal'));
  assert.equal(db.records[0].tankMeasured, undefined);
  record(db, 'measured', '2026-09-30', { tankMeasured: 25 });
  assert.equal(codes(model(db, { coverage: true }), 'ending-unmeasured').length, 0);
});

test('invalid dates retain the possible historical organization scope and editable source', () => {
  const db = database(); db.vehicles[0].orgHistory = [{ org: 'B', from: '', to: '2026-08-31' }];
  record(db, 'bad-date', 'invalid');
  const item = codes(model(db), 'date')[0];
  assert.equal(item.org, '');
  assert.deepEqual(new Set(item.orgs), new Set(['A', 'B']));
  assert.equal(item.grade, 'АИ-95');
  assert.ok(item.repairRefs.some(ref => ref.id === 'bad-date'));
});

test('valid historical records use their dated organization instead of the current card', () => {
  const db = database(); db.vehicles[0].orgHistory = [{ org: 'B', from: '', to: '2026-08-31' }];
  record(db, 'bad-number', '2026-08-01', { fuelIdle: -1 });
  const item = codes(model(db, { from: '', to: '' }), 'invalid-value')[0];
  assert.equal(item.org, 'B');
  assert.match(item.message, /Холостой ход/);
});

test('orphan records expose the dedicated repair route rather than an ordinary journal editor', () => {
  const db = database(); record(db, 'orphan', '2026-09-10', { vehicleId: 'gone' });
  const item = codes(model(db), 'record-vehicle-missing')[0];
  assert.ok(item.repairRefs.some(ref => ref.type === 'orphan-record' && ref.id === 'orphan'));
  assert.equal(item.repairRefs.some(ref => ref.type === 'record'), false);
});
