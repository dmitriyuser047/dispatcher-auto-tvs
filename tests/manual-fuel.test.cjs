const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ctx = vm.createContext({ console, window: {}, document: { addEventListener() {}, documentElement: { removeAttribute() {} }, getElementById() {} }, localStorage: { getItem() {} } });
for (const file of ['01-core.js', '29-fuel-quality.js', '10-pdf-reports.js', '25b-fuel-purchases.js', '25c-fuel-control.js', '25i-gsm-ledger.js', '25j-gsm-workspace.js', '25k-gsm-export.js', '25l-manual-fuel.js'])
  vm.runInContext(fs.readFileSync(path.join(root, 'assets/js', file), 'utf8'), ctx, { filename: file });
vm.runInContext(fs.readFileSync(path.join(root, 'vendor/xlsx.bundle.js'), 'utf8'), ctx);
function base() {
  return { vehicles: [{ id: 'v', plate: 'CAR', org: 'A', object: 'УНГКМ', fuel: 'gasoline', fuelGrade: 'АИ-95', fuelBalance: 0 },
    { id: 'holder', plate: 'HOLDER', org: 'B', object: 'УНГКМ', fuel: 'gasoline', fuelGrade: 'АИ-95' }],
    records: [], fuelPurchases: [], fuelPeriods: [], fuelCards: [{ number: '111111', org: 'A', assignments: [{ vehicleId: 'v', from: '', to: '' }] },
      { number: '222222', org: 'B', assignments: [{ vehicleId: 'holder', from: '', to: '' }] }] };
}
function row(extra = {}) { return { id: 'draft1', date: '2026-10-01', vehicleId: 'v', grade: 'АИ-95', cardNo: '111111', qty: '30', sum: '', comment: '', ...extra }; }
function draft(rows = [row()], org = 'A') { return { org, month: '2026-10', rows }; }
function ledger(db) { return ctx.gsmBuildLedger(db, { from: '2026-10-01', to: '2026-10-31' }); }
function statement(db, changes = {}) {
  const p = db.fuelPurchases[0];
  return ctx.gsmStatementPlan(db, p.id, { ...p, vehicleId: 'v', ...changes });
}
function imported(db, extra = {}) {
  db.fuelPurchases.push({ id: 'imported', importId: 'file1', importKey: 'source-row-key', sourceRow: 17,
    date: '2026-10-01', vehicleId: '', cardNo: '111111', sourceOrg: 'A', grade: 'АИ-95', qty: 30, sum: 3000, ...extra });
  return db;
}

test('an imported statement row fuels the selected car without creating another purchase and is included in the act', () => {
  const db = imported(base()), before = JSON.stringify(db), plan = statement(db);
  const next = ctx.gsmStatementApply(db, plan), p = next.fuelPurchases[0];
  assert.equal(JSON.stringify(db), before); assert.equal(next.fuelPurchases.length, 1);
  assert.equal(p.id, 'imported'); assert.equal(p.importId, 'file1'); assert.equal(p.importKey, 'source-row-key'); assert.equal(p.sourceRow, 17);
  assert.equal(p.vehicleId, 'v'); assert.equal(next.records[0].km, 0); assert.equal(next.records[0].fuelIssued, 30);
  assert.equal(ledger(next).barrels[0].issued, 30);
});

test('allocating a loaded operation links matching manual fuel without changing journal mileage, litres or money', () => {
  const db = imported(base());
  db.records.push({ id: 'r', vehicleId: 'v', date: '2026-10-01', km: 120, odoStart: 100, odoEnd: 220, fuelIssued: 30, fuelSum: 3000, note: 'Manual' });
  const before = JSON.stringify(db.records), plan = statement(db);
  assert.equal(plan.mode, 'link:r');
  const next = ctx.gsmStatementApply(db, plan);
  assert.equal(JSON.stringify(next.records), before); assert.equal(next.fuelPurchases[0].recordId, 'r');
  assert.equal(ledger(next).barrels[0].issued, 30);
});

test('confirming an already allocated operation repeatedly does not change the journal or double any litres', () => {
  let db = imported(base(), { vehicleId: 'v', recordId: 'r', sum: undefined });
  db.records.push({ id: 'r', vehicleId: 'v', date: '2026-10-01', fuelIssued: 30, km: 12, odoStart: 100, odoEnd: 112 });
  const before = JSON.stringify(db.records);
  for (let i = 0; i < 3; i++) db = ctx.gsmStatementApply(db, statement(db));
  assert.equal(JSON.stringify(db.records), before); assert.equal(db.fuelPurchases.length, 1); assert.equal(ledger(db).barrels[0].issued, 30);
});

test('moving a statement purchase preserves manual remainder, odometers, source organization and import identity', () => {
  const db = imported(base(), { vehicleId: 'holder', recordId: 'old', cardNo: '222222', sourceOrg: 'B', cardVehicleId: 'holder' });
  db.records.push({ id: 'old', vehicleId: 'holder', date: '2026-10-01', fuelIssued: 40, fuelSum: 4000, km: 40, odoStart: 200, odoEnd: 240 });
  const next = ctx.gsmStatementApply(db, statement(db)), old = next.records.find(r => r.id === 'old');
  assert.equal(old.fuelIssued, 10); assert.equal(old.fuelSum, 1000); assert.equal(old.km, 40); assert.equal(old.odoEnd, 240);
  assert.equal(next.fuelPurchases[0].sourceOrg, 'B'); assert.equal(next.fuelPurchases[0].cardVehicleId, 'holder');
  assert.equal(next.fuelPurchases[0].importKey, 'source-row-key');
  assert.equal(ledger(next).rows.find(r => r.vehicleId === 'v').org, 'B');
});

test('editing a posted operation changes only its quantity and money delta in the journal', () => {
  const db = imported(base(), { vehicleId: 'v', recordId: 'r' });
  db.records.push({ id: 'r', vehicleId: 'v', date: '2026-10-01', fuelIssued: 40, fuelSum: 4000, km: 110, fuelActual: 15 });
  const next = ctx.gsmStatementApply(db, statement(db, { qty: 35, sum: 3500 }));
  assert.equal(next.records[0].fuelIssued, 45); assert.equal(next.records[0].fuelSum, 4500);
  assert.equal(next.records[0].km, 110); assert.equal(next.records[0].fuelActual, 15);
});

test('loaded operations reject incompatible fuel, cross-object moves, closed months and stale review', () => {
  const db = imported(base());
  assert.throws(() => statement(db, { grade: 'ДТ' }), /топлива/);
  db.vehicles[0].object = 'ННГ'; db.fuelPurchases[0].cardNo = '222222';
  assert.throws(() => statement(db), /объект/);
  db.vehicles[0].object = 'УНГКМ'; db.fuelPurchases[0].cardNo = '111111';
  db.fuelPeriods.push({ month: '2026-10', closed: true }); assert.throws(() => statement(db), /закрыт/);
  db.fuelPeriods = []; const plan = statement(db); db.records.push({ id: 'changed' });
  assert.throws(() => ctx.gsmStatementApply(db, plan), /изменилась/);
});

test('allocating a purchase keeps a different manual quantity in a separate journal receipt', () => {
  const db = imported(base()); db.records.push({ id: 'r', vehicleId: 'v', date: '2026-10-01', fuelIssued: 10, km: 70 });
  const next = ctx.gsmStatementApply(db, statement(db));
  assert.equal(next.records.length, 2); assert.equal(next.records[0].fuelIssued, 10); assert.equal(next.records[0].km, 70);
  assert.equal(ledger(next).barrels[0].issued, 40);
});

test('legacy source identity prevents restoration after editing date, quantity, card and fuel grade', () => {
  const db = base();
  db.fuelPurchases.push({ id: 'edited', importKey: '2026-10-01|30|111111||source',
    date: '2026-10-03', qty: 35, cardNo: '222222', grade: 'ДТ', product: 'АИ-95', vehicleId: 'holder' });
  db.records.push({ id: 'old', vehicleId: 'v', date: '2026-10-01', fuelIssued: 0, fuelGrade: 'АИ-95',
    note: 'заправка: АИ-95 30л; импорт заправок: 2026-10-01|30|111111||source' });
  ctx.inputData = db; vm.runInContext('data=inputData', ctx);
  assert.equal(ctx.fpRestoreFromJournal(), 0);
  assert.equal(db.fuelPurchases.length, 1);
});

test('edited source identity still restores a genuinely missing equal-volume second purchase once', () => {
  const db = base();
  db.fuelPurchases.push({ id: 'edited', importKey: '2026-10-01|30|111111||first',
    date: '2026-10-03', qty: 35, cardNo: '111111', grade: 'АИ-95', product: 'АИ-95', vehicleId: 'v' });
  db.records.push({ id: 'old', vehicleId: 'v', date: '2026-10-01', fuelIssued: 30, fuelSum: 3000, fuelGrade: 'АИ-95',
    note: 'заправка: АИ-95 30л, АИ-95 30л; импорт заправок: 2026-10-01|30|111111||first | 2026-10-01|30|111111||second' });
  ctx.inputData = db; vm.runInContext('data=inputData', ctx);
  assert.equal(ctx.fpRestoreFromJournal(), 1);
  assert.equal(db.fuelPurchases.length, 2);
  assert.equal(db.fuelPurchases[1].importKey, '2026-10-01|30|111111||second');
  assert.equal(ctx.fpRestoreFromJournal(), 0);
});

test('manual daily statement creates purchases and zero-mileage receipt rows, visible in the original act', () => {
  const db = base(), before = JSON.stringify(db), plan = ctx.gsmManualPlan(db, draft());
  assert.equal(JSON.stringify(db), before);
  const next = ctx.gsmManualApply(db, plan, false);
  assert.equal(JSON.stringify(db), before); assert.equal(next.fuelPurchases.length, 1); assert.equal(next.records.length, 1);
  assert.equal(next.records[0].km, 0); assert.equal(next.records[0].fuelIssued, 30); assert.equal(next.records[0].odoStart, undefined);
  const l = ledger(next); assert.equal(l.errors.length, 0); assert.equal(l.barrels[0].issued, 30);
  ctx.input = next; vm.runInContext('data=input', ctx);
  const wb = ctx.gsmActWorkbook(l, 'A', {}), rows = ctx.XLSX.utils.sheet_to_json(wb.Sheets['Акт списания ГСМ'], { header: 1 });
  assert.equal(rows.find(r => r[0] === 'ИТОГО:')[19], 30);
});

test('linking a manual journal receipt records its card without adding litres, money or changing mileage', () => {
  const db = base(); db.records.push({ id: 'r', vehicleId: 'v', date: '2026-10-01', km: 125, odoStart: 1000, odoEnd: 1125, fuelIssued: 30, fuelActual: 10, fuelSum: 3000, note: 'Manual' });
  const before = JSON.stringify(db.records), plan = ctx.gsmManualPlan(db, draft([row({ sum: '3000' })]));
  assert.equal(plan.groups[0].mode, 'link:r');
  const next = ctx.gsmManualApply(db, plan, false);
  assert.equal(JSON.stringify(next.records), before); assert.equal(next.fuelPurchases[0].recordId, 'r');
  assert.equal(ledger(next).barrels[0].issued, 30); assert.equal(ledger(next).errors.length, 0);
});

test('new litres do not erase or reinterpret an unmatched earlier manual receipt on the same day', () => {
  const db = base(); db.records.push({ id: 'r', vehicleId: 'v', date: '2026-10-01', km: 100, fuelIssued: 50, fuelActual: 10, note: 'Original manual receipt' });
  const before = JSON.stringify(db.records[0]), plan = ctx.gsmManualPlan(db, draft());
  assert.equal(plan.groups[0].mode, 'new');
  const next = ctx.gsmManualApply(db, plan, false);
  assert.equal(JSON.stringify(next.records[0]), before); assert.equal(next.records.length, 2);
  assert.equal(ledger(next).barrels[0].issued, 80); assert.equal(ledger(next).errors.length, 0);
});

test('a new distinct purchase adds to an already accounted journal row and preserves odometers', () => {
  const db = base(); db.records.push({ id: 'r', vehicleId: 'v', date: '2026-10-01', km: 100, odoStart: 0, odoEnd: 100, fuelIssued: 20, fuelActual: 5 });
  db.fuelPurchases.push({ id: 'old', vehicleId: 'v', recordId: 'r', date: '2026-10-01', grade: 'АИ-95', qty: 20, cardNo: '111111' });
  const plan = ctx.gsmManualPlan(db, draft()); assert.equal(plan.groups[0].mode, 'add:r');
  const next = ctx.gsmManualApply(db, plan, false);
  assert.equal(next.records.length, 1); assert.equal(next.records[0].fuelIssued, 50); assert.equal(next.records[0].odoStart, 0); assert.equal(next.records[0].odoEnd, 100);
  assert.equal(ledger(next).barrels[0].issued, 50);
});

test('review resolves stale purchase links by the same unique vehicle, date and grade as accounting', () => {
  const db = base(); db.records.push({ id: 'r', vehicleId: 'v', date: '2026-10-01', km: 100, fuelIssued: 20, fuelActual: 5 },
    { id: 'wrong', vehicleId: 'holder', date: '2026-10-01', km: 0, fuelIssued: 0 });
  db.fuelPurchases.push({ id: 'old', vehicleId: 'v', recordId: 'wrong', date: '2026-10-01', grade: 'АИ-95', qty: 20, cardNo: '111111' });
  const plan = ctx.gsmManualPlan(db, draft()); assert.equal(plan.groups[0].mode, 'add:r');
  const next = ctx.gsmManualApply(db, plan, false);
  assert.equal(next.records.find(r => r.id === 'r').fuelIssued, 50); assert.equal(ledger(next).barrels.find(b => b.org === 'A').issued, 50);
  assert.equal(ledger(next).errors.length, 0);
});

test('equal-volume same-day transactions require explicit confirmation instead of automatic deletion', () => {
  const db = base(), plan = ctx.gsmManualPlan(db, draft([row(), row({ id: 'draft2' })]));
  assert.equal(plan.entries[1].duplicate, true);
  assert.throws(() => ctx.gsmManualApply(db, plan, false), /Подтвердите/);
  const next = ctx.gsmManualApply(db, plan, true);
  assert.equal(next.fuelPurchases.length, 2); assert.equal(next.records.length, 1); assert.equal(ledger(next).barrels[0].issued, 60);
  assert.throws(() => ctx.gsmManualApply(next, plan, true), /изменились/);
});

test('card ownership, receiving car and actual grade are preserved independently', () => {
  const db = base(), plan = ctx.gsmManualPlan(db, draft([row({ cardNo: '222222', grade: 'АИ-92' })], 'B'));
  const next = ctx.gsmManualApply(db, plan, false), l = ledger(next);
  assert.equal(next.fuelPurchases[0].vehicleId, 'v'); assert.equal(next.fuelPurchases[0].sourceOrg, 'B'); assert.equal(next.fuelPurchases[0].cardVehicleId, 'holder');
  const received = l.barrels.find(b => b.org === 'B'); assert.equal(received.grade, 'АИ-92'); assert.equal(received.issued, 30);
});

test('cross-object recipients and unknown objects cannot be used for another car card', () => {
  const db = base(); db.vehicles[1].object = 'ННГ';
  assert.throws(() => ctx.gsmManualPlan(db, draft([row({ cardNo: '222222' })], 'B')), /разным объектам/);
  db.vehicles[1].object = ''; assert.throws(() => ctx.gsmManualPlan(db, draft([row({ cardNo: '222222' })], 'B')), /указать объект/);
});

test('invalid dates, invalid amounts, incompatible fuel and closed months are rejected before mutation', () => {
  const db = base(), before = JSON.stringify(db);
  for (const change of [{ date: '2026-10-32' }, { date: '2026-09-30' }, { qty: '-1' }, { qty: 'Infinity' }, { qty: '0' }, { qty: '1.2345' }, { sum: '-1' }, { sum: 'NaN' }, { grade: 'ДТ' }, { vehicleId: '' }, { cardNo: '222222' }])
    assert.throws(() => ctx.gsmManualPlan(db, draft([row(change)])));
  assert.equal(JSON.stringify(db), before);
  db.fuelPeriods.push({ month: '2026-10', closed: true }); assert.throws(() => ctx.gsmManualPlan(db, draft()), /закрыт/);
});

test('an unrelated edit after review blocks committing an outdated plan', () => {
  const db = base(), plan = ctx.gsmManualPlan(db, draft()); db.vehicles[0].object = 'ННГ';
  const before = JSON.stringify(db); assert.throws(() => ctx.gsmManualApply(db, plan, false), /изменились/); assert.equal(JSON.stringify(db), before);
});

test('cash receipts preserve the selected source organization and zero money', () => {
  const db = base(), next = ctx.gsmManualApply(db, ctx.gsmManualPlan(db, draft([row({ cardNo: '', sum: '0' })], 'B')), false);
  assert.equal(next.fuelPurchases[0].sourceOrg, 'B'); assert.equal(next.fuelPurchases[0].sum, 0); assert.equal(next.fuelPurchases[0].manualStatement, true);
  assert.equal(ledger(next).barrels.find(b => b.org === 'B').issued, 30);
});

test('card organization history is evaluated on the transaction date', () => {
  const db = base(); db.fuelCards[0].orgHistory = [{ org: 'A', from: '', to: '2026-10-15' }, { org: 'B', from: '2026-10-16', to: '' }];
  assert.throws(() => ctx.gsmManualPlan(db, draft([row({ date: '2026-10-20' })])), /организации/);
  const plan = ctx.gsmManualPlan(db, draft([row({ date: '2026-10-20' })], 'B')); assert.equal(plan.entries[0].org, 'B');
});
