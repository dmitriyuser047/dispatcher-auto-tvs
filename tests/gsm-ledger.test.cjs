const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ctx = vm.createContext({ console, window: {}, document: { addEventListener() {}, documentElement: { removeAttribute() {} }, getElementById() {} }, localStorage: { getItem() {} } });
for (const file of ['assets/js/01-core.js', 'assets/js/29-fuel-quality.js', 'vendor/xlsx.bundle.js', 'assets/js/10-pdf-reports.js', 'assets/js/25-fuel-report.js', 'assets/js/25b-fuel-purchases.js', 'assets/js/25c-fuel-control.js', 'assets/js/25i-gsm-ledger.js', 'assets/js/25j-gsm-workspace.js', 'assets/js/25k-gsm-export.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
}
function base() {
  return { vehicles: [{ id: 'v', plate: 'RECEIVER', org: 'A', fuelGrade: 'АИ-95', fuelBalance: 0, norm: 10 }, { id: 'holder', plate: 'HOLDER', org: 'B', fuelGrade: 'АИ-95', fuelBalance: 0 }],
    fuelCards: [{ number: '111111', org: 'A', provider: 'Газпром', assignments: [{ vehicleId: 'v', from: '', to: '' }] },
      { number: '222222', org: 'B', provider: 'Лукойл', assignments: [{ vehicleId: 'holder', from: '', to: '' }] }],
    records: [], fuelPurchases: [], monthlyFuel: [] };
}
function record(db, id, date, issued, spent, extra = {}) { db.records.push({ id, vehicleId: 'v', date, fuelIssued: issued, fuelActual: spent, km: spent * 10, fuelGrade: 'АИ-95', ...extra }); }
function purchase(db, id, recordId, date, qty, cardNo, extra = {}) { db.fuelPurchases.push({ id, recordId, vehicleId: 'v', date, qty, cardNo, grade: 'АИ-95', ...extra }); }
function ledger(db, from = '2026-08-01', to = '2026-08-31') { return ctx.gsmBuildLedger(db, { from, to }); }
function barrel(l, org, grade = 'АИ-95') { return l.barrels.find(b => b.org === org && b.grade === grade); }
function close(a, b) { assert.ok(Math.abs(a - b) <= 0.002, `${a} != ${b}`); }
function balances(l) { l.rows.forEach(r => close(r.start + r.issued + r.correction - r.spent, r.end)); l.barrels.forEach(b => close(b.start + b.issued + b.correction - b.spent, b.end)); }
function actRows(wb) { return ctx.XLSX.utils.sheet_to_json(wb.Sheets['Акт списания ГСМ'], { header: 1 }); }
function actDataRows(wb) { return actRows(wb).filter(row => typeof row[0] === 'number'); }

test('two cards in one journal row: exact receipts, FIFO consumption, no duplicated mileage', () => {
  const db = base(); record(db, 'r', '2026-08-01', 100, 70); purchase(db, 'p1', 'r', '2026-08-01', 60, '111111'); purchase(db, 'p2', 'r', '2026-08-01', 40, '222222');
  const before = JSON.stringify(db), l = ledger(db);
  assert.equal(JSON.stringify(db), before); assert.equal(l.errors.length, 0);
  assert.equal(barrel(l, 'A').spent, 60); assert.equal(barrel(l, 'B').spent, 10); assert.equal(barrel(l, 'B').end, 30);
  close(l.rows.reduce((s, r) => s + r.km, 0), 700); balances(l);
});
test('foreign card: actual purchase is not replaced with inflated journal litres', () => {
  const db = base(); record(db, 'r', '2026-08-25', 88.32, 29.4); purchase(db, 'p', 'r', '2026-08-25', 30, '222222');
  const l = ledger(db); assert.equal(barrel(l, 'B').issued, 30); assert.equal(barrel(l, 'B').spent, 29.4);
  assert.ok(l.errors.some(i => i.code === 'journal-difference')); balances(l);
});
test('month carry retains card organization and fuel grade', () => {
  const db = base(); record(db, 'r1', '2026-08-31', 100, 20); purchase(db, 'p', 'r1', '2026-08-31', 100, '222222'); record(db, 'r2', '2026-09-02', 0, 30);
  const aug = ledger(db), sep = ledger(db, '2026-09-01', '2026-09-30');
  assert.equal(barrel(aug, 'B').end, 80); assert.equal(barrel(sep, 'B').start, 80); assert.equal(barrel(sep, 'B').spent, 30); assert.equal(barrel(sep, 'B').end, 50); balances(sep);
});
test('manual receipts coexist with statements; monthly override cannot invent stock', () => {
  const db = base(); record(db, 'r1', '2026-08-01', 80, 0); purchase(db, 'p', 'r1', '2026-08-01', 80, '111111'); record(db, 'r2', '2026-08-02', 20, 0);
  db.monthlyFuel.push({ vehicleId: 'v', month: '2026-08', cardNumber: '222222', liters: 500 });
  const l = ledger(db); assert.equal(barrel(l, 'A').issued, 100); assert.ok(l.errors.some(i => i.code === 'monthly-difference')); assert.equal(barrel(l, 'B'), undefined); balances(l);
});
test('deleted purchases do not enter barrels', () => {
  const db = base(); purchase(db, 'deleted', null, '2026-08-01', 100, '222222', { deleted: true });
  assert.equal(ledger(db).receipts.length, 0); assert.equal(ledger(db).barrels.length, 0);
});

test('receipt summary separates every grade by the source organization and includes purchases without a vehicle', () => {
  const db = base(); db.vehicles[0].fuelBalance = 100;
  record(db, 'r1', '2026-08-01', 50, 20);
  purchase(db, 'p1', 'r1', '2026-08-01', 20, '111111', { grade: 'АИ-92' });
  purchase(db, 'p2', 'r1', '2026-08-01', 30, '222222');
  record(db, 'r2', '2026-08-02', 12, 0, { fuelGrade: 'ДТ', fuelOrg: 'B' });
  purchase(db, 'unassigned', null, '2026-08-03', 5, '111111', { vehicleId: '', grade: 'ДТ' });
  purchase(db, 'unknown-owner', null, '2026-08-04', 7, '', { vehicleId: '', grade: 'Газ' });
  purchase(db, 'deleted', null, '2026-08-04', 999, '111111', { deleted: true });
  purchase(db, 'september', null, '2026-09-01', 800, '111111');
  const before = JSON.stringify(db), l = ledger(db), summary = ctx.gsmReceiptSummary(l);
  const qty = (org, grade) => summary.rows.find(r => r.org === org).quantities[summary.grades.indexOf(grade)];
  assert.equal(summary.total, 74); assert.equal(summary.count, 5);
  assert.equal(qty('A', 'АИ-92'), 20); assert.equal(qty('A', 'АИ-95'), 0); assert.equal(qty('A', 'ДТ'), 5);
  assert.equal(qty('B', 'АИ-95'), 30); assert.equal(qty('B', 'ДТ'), 12); assert.equal(qty('Организация не определена', 'Газ'), 7);
  assert.equal(summary.rows.find(r => r.org === 'B').total, 42);
  assert.equal(summary.totals.reduce((sum, q) => sum + q, 0), 74);
  assert.equal(l.barrels.reduce((sum, b) => sum + b.issued, 0), 62);
  assert.equal(JSON.stringify(db), before);
});

test('receipt summary applies organization and period filters but retains all supported grades', () => {
  const db = base(); record(db, 'a', '2026-08-01', 10, 0); purchase(db, 'a', 'a', '2026-08-01', 10, '111111');
  record(db, 'b', '2026-08-02', 20, 0); purchase(db, 'b', 'b', '2026-08-02', 20, '222222', { grade: 'АИ-92' });
  purchase(db, 'next', null, '2026-09-01', 30, '222222', { grade: 'АИ-100' });
  const august = ctx.gsmReceiptSummary(ledger(db), ' b '), all = ctx.gsmReceiptSummary(ledger(db, '', ''));
  assert.equal(august.total, 20); assert.equal(august.rows.length, 1); assert.equal(august.rows[0].org, 'B');
  assert.deepEqual(Array.from(august.grades), ['ДТ', 'АИ-92', 'АИ-95', 'АИ-98', 'АИ-100', 'Газ']);
  assert.equal(all.total, 60);
});

test('receipt summary normalizes organization spelling, handles decimal litres and preserves unknown grades', () => {
  const l = { organizations: [' A ', 'a'], receipts: [
    { org: 'A', grade: 'ДТ', qty: 0.1 }, { org: ' a ', grade: 'ДТ', qty: 0.2 },
    { org: 'A', grade: 'Бензин', qty: 1.125 }, { org: '', grade: '', qty: 2.5 },
  ] };
  const summary = ctx.gsmReceiptSummary(l);
  assert.equal(summary.rows.length, 2); assert.equal(summary.total, 3.925);
  assert.equal(summary.totals[summary.grades.indexOf('ДТ')], 0.3);
  assert.equal(summary.totals[summary.grades.indexOf('Бензин')], 1.125);
  assert.equal(summary.totals[summary.grades.indexOf('Не указано')], 2.5);
});

test('receipt summary HTML keeps every grade visible while detail fuel filters change and escapes organization text', () => {
  const db = base(); record(db, 'r', '2026-08-01', 20, 0); purchase(db, 'p', 'r', '2026-08-01', 20, '111111');
  purchase(db, 'diesel', null, '2026-08-02', 15, '222222', { grade: 'ДТ', sourceOrg: '<img src=x onerror=alert(1)>' });
  ctx.inputData = db; vm.runInContext('data=inputData;gsmOrg="";gsmFuel="АИ-95"', ctx);
  try {
    const html = ctx.gsmReceiptSummaryHtml(ledger(db));
    assert.ok(html.includes('Приход топлива по организациям'));
    assert.ok(html.includes('data-grade="ДТ"')); assert.ok(html.includes('15,000'));
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;')); assert.ok(!html.includes('<img'));
    assert.ok(html.includes('gsmShowReceipts(')); assert.ok(html.includes('<tfoot>'));
    const empty = ctx.gsmReceiptSummary({ receipts: [], organizations: [] });
    assert.equal(empty.total, 0); assert.equal(empty.count, 0); assert.equal(empty.rows.length, 0);
  } finally { vm.runInContext('gsmOrg="";gsmFuel=""', ctx); }
});
test('ownership is resolved on purchase date, including blocked cards', () => {
  const db = base(), c = db.fuelCards[1]; c.status = 'blocked'; c.org = 'A'; c.orgHistory = [{ org: 'B', from: '', to: '2026-08-15' }, { org: 'A', from: '2026-08-16', to: '' }];
  record(db, 'r1', '2026-08-10', 30, 0); purchase(db, 'p1', 'r1', '2026-08-10', 30, c.number);
  record(db, 'r2', '2026-08-20', 40, 0); purchase(db, 'p2', 'r2', '2026-08-20', 40, c.number);
  const l = ledger(db); assert.equal(barrel(l, 'B').issued, 30); assert.equal(barrel(l, 'A').issued, 40);
});
test('card deletion and reassignment do not rewrite stamped past purchases', () => {
  const db = base(); record(db, 'r', '2026-08-01', 30, 10); purchase(db, 'p', 'r', '2026-08-01', 30, '222222');
  ctx.gsmPreserveCardHistory(db, '222222'); db.fuelCards = []; db.vehicles[1].org = 'A';
  const l = ledger(db); assert.equal(barrel(l, 'B').issued, 30); assert.equal(l.receipts[0].cardVehicleId, 'holder'); assert.equal(l.receipts[0].provider, 'Лукойл');
});
test('real fuel grades and suppliers remain separate', () => {
  const db = base(); record(db, 'r1', '2026-08-01', 30, 20); purchase(db, 'p1', 'r1', '2026-08-01', 30, '222222', { grade: 'АИ-92' });
  record(db, 'r2', '2026-08-02', 20, 15); purchase(db, 'p2', 'r2', '2026-08-02', 20, '222222', { grade: 'АИ-95' });
  const l = ledger(db); assert.equal(barrel(l, 'B', 'АИ-92').spent, 30); assert.equal(barrel(l, 'B', 'АИ-95').spent, 5);
  assert.equal(l.rows.find(r => r.grade === 'АИ-92').providers['Лукойл'], 30); balances(l);
});
test('tank measurement includes idle once, and surplus requires reconciliation', () => {
  const db = base(); record(db, 'r', '2026-08-01', 100, 20, { fuelIdle: 5, tankMeasured: 65 }); purchase(db, 'p', 'r', '2026-08-01', 100, '222222');
  let l = ledger(db); assert.equal(barrel(l, 'B').spent, 35); assert.equal(l.rows[0].idle, 5); balances(l);
  db.records[0].tankMeasured = 110; l = ledger(db); assert.ok(l.errors.some(i => i.code === 'measurement-surplus')); balances(l);
});
test('missing sources and negative carry are explicit errors, never negative consumption', () => {
  const db = base(); record(db, 'r', '2026-08-01', 0, 20);
  const l = ledger(db); assert.ok(l.errors.some(i => i.code === 'shortage')); assert.ok(l.errors.some(i => i.code === 'carry-shortage')); assert.equal(barrel(l, 'A').spent, 20); balances(l);
});
test('ambiguous journal matching does not duplicate the same purchase as manual stock', () => {
  const db = base(); record(db, 'r1', '2026-08-01', 50, 0); record(db, 'r2', '2026-08-01', 50, 0); purchase(db, 'p', null, '2026-08-01', 50, '222222');
  const l = ledger(db); assert.equal(l.receipts.reduce((s, p) => s + p.qty, 0), 50); assert.ok(l.errors.some(i => i.code === 'journal-ambiguous'));
});
test('opening sources split between organization barrels and reconcile', () => {
  const db = base(); db.vehicles[0].fuelBalance = 100; db.vehicles[0].fuelBalanceSources = [{ org: 'A', grade: 'АИ-95', qty: 60 }, { org: 'B', grade: 'АИ-95', qty: 40 }]; record(db, 'r', '2026-08-01', 0, 70);
  const l = ledger(db); assert.equal(barrel(l, 'A').start, 60); assert.equal(barrel(l, 'B').start, 40); assert.equal(barrel(l, 'B').end, 30); balances(l);
});
test('export is read-only and includes recipient in foreign organization act', () => {
  const db = base(); record(db, 'r', '2026-08-01', 30, 10); purchase(db, 'p', 'r', '2026-08-01', 30, '222222'); ctx.inputData = db; vm.runInContext('data = inputData', ctx);
  const before = JSON.stringify(db), wb = ctx.gsmActWorkbook(ledger(db), 'B', {});
  assert.equal(JSON.stringify(db), before); const row = actDataRows(wb).find(r => r[2] === 'RECEIVER');
  assert.equal(row[19], 30); assert.equal(row[21], 10); assert.equal(row[23], 20);
  assert.deepEqual(Array.from(wb.SheetNames), ['Акт списания ГСМ']);
});
test('legacy act export works without optional settings and does not modify the journal', () => {
  const db = base(); record(db, 'r', '2026-08-01', 30, 10); purchase(db, 'p', 'r', '2026-08-01', 30, '222222');
  ctx.inputData = db; vm.runInContext('data=inputData', ctx);
  const before = JSON.stringify(db), originalWrite = ctx.XLSX.writeFile;
  let exported = null;
  ctx.XLSX.writeFile = wb => { exported = wb; };
  try {
    assert.equal(ctx.exportFuelWriteOffAct('2026-08-01', '2026-08-31'), exported);
    assert.ok(exported.Sheets['Акт списания ГСМ']);
    assert.equal(JSON.stringify(db), before);
  } finally { ctx.XLSX.writeFile = originalWrite; }
});

test('write-off button stays clickable when validation reports errors', () => {
  const db = base(); record(db, 'r', '2026-08-01', 100, 20); purchase(db, 'p', 'r', '2026-08-01', 30, '111111');
  ctx.inputData = db; vm.runInContext('data=inputData;gsmOrg="";gsmFuel=""', ctx);
  const html = ctx.gsmWriteoffHtml(ledger(db));
  assert.ok(html.includes('Акт требует проверки'));
  assert.match(html, /onclick="gsmExportCurrentAct\(\)">Выгрузить акт/);
  assert.doesNotMatch(html, /\sdisabled(?:[\s>]|$)/);
});

test('validation opens an actionable review; explicit draft export preserves the journal and marks every act', () => {
  const db = base(); record(db, 'r', '2026-08-01', 100, 20); purchase(db, 'p', 'r', '2026-08-01', 30, '111111');
  ctx.inputData = db; vm.runInContext('data=inputData', ctx);
  const before = JSON.stringify(db), originalWrite = ctx.XLSX.writeFile;
  let modal = null, saved = null, closed = false;
  ctx.openGenericModal = (title, html) => { modal = { title, html }; };
  ctx.closeModal = () => { closed = true; };
  ctx.XLSX.writeFile = (wb, filename) => { saved = { wb, filename }; };
  try {
    assert.equal(ctx.exportFuelWriteOffAct('2026-08-01', '2026-08-31', { org: 'A', actNo: '123' }), null);
    assert.equal(saved, null);
    assert.ok(modal.html.includes('Выгрузить черновик'));
    assert.ok(modal.html.includes('Выгрузить сверку'));
    const wb = ctx.gsmExportActDraft();
    assert.equal(wb, saved.wb);
    assert.match(saved.filename, /^Черновик_акта_ГСМ_A_2026-08-01_2026-08-31\.xlsx$/);
    const rows = actRows(wb);
    assert.match(wb.Sheets['Акт списания ГСМ'].A1.v, /ЧЕРНОВИК.*Не утверждён/);
    assert.ok(rows.some(r => /^Акт списания ГСМ по A за /.test(r[0])));
    assert.ok(rows.some(r => /^Акт № 123/.test(r[0])));
    assert.deepEqual(Array.from(wb.SheetNames), ['Акт списания ГСМ']);
    assert.equal(JSON.stringify(db), before);
    assert.equal(closed, true);
    assert.equal(ctx.gsmExportActDraft(), null);
  } finally { ctx.XLSX.writeFile = originalWrite; ctx.gsmCancelActExport(); }
});

test('pending export keeps its period, organization and fuel filters after screen selection changes', () => {
  const db = base(); record(db, 'r1', '2026-08-01', 70, 0); purchase(db, 'p1', 'r1', '2026-08-01', 30, '111111');
  record(db, 'r2', '2026-08-02', 20, 0, { fuelGrade: 'АИ-92' }); purchase(db, 'p2', 'r2', '2026-08-02', 20, '222222', { grade: 'АИ-92' });
  ctx.inputData = db; vm.runInContext('data=inputData', ctx);
  const originalWrite = ctx.XLSX.writeFile;
  let saved = null;
  ctx.openGenericModal = () => {}; ctx.closeModal = () => {};
  ctx.XLSX.writeFile = wb => { saved = wb; };
  try {
    ctx.exportFuelWriteOffAct('2026-08-01', '2026-08-31', { org: 'A', fuelGrade: 'АИ-95' });
    vm.runInContext('fpMonth="2026-09";gsmOrg="B";gsmFuel="АИ-92"', ctx);
    ctx.gsmExportPendingActReconciliation();
    const receipts = ctx.XLSX.utils.sheet_to_json(saved.Sheets['Поступления'], { header: 1 });
    assert.equal(receipts.length, 2);
    assert.equal(receipts[1][2], 'A'); assert.equal(receipts[1][5], 'АИ-95');
    ctx.gsmExportActDraft();
    const titles = actRows(saved).filter(r => /^Акт списания ГСМ по /.test(r[0]));
    assert.equal(titles.length, 1); assert.equal(titles[0][0], 'Акт списания ГСМ по A за август 2026г.');
  } finally { ctx.XLSX.writeFile = originalWrite; ctx.gsmCancelActExport(); vm.runInContext('gsmOrg="";gsmFuel=""', ctx); }
});

test('failed file saving reports the error and keeps the draft review available for retry', () => {
  const db = base(); record(db, 'r', '2026-08-01', 100, 20); purchase(db, 'p', 'r', '2026-08-01', 30, '111111');
  ctx.inputData = db; vm.runInContext('data=inputData', ctx);
  const before = JSON.stringify(db), originalWrite = ctx.XLSX.writeFile, originalConsole = ctx.console;
  const alerts = [];
  ctx.openGenericModal = () => {}; ctx.closeModal = () => {};
  ctx.alert = text => alerts.push(text); ctx.console = { error() {} };
  ctx.XLSX.writeFile = () => { throw Error('disk full'); };
  try {
    ctx.exportFuelWriteOffAct('2026-08-01', '2026-08-31', {});
    assert.equal(ctx.gsmExportActDraft(), null);
    assert.match(alerts[0], /Не удалось сохранить.*disk full/);
    let saved = false; ctx.XLSX.writeFile = () => { saved = true; };
    assert.ok(ctx.gsmExportActDraft()); assert.equal(saved, true);
    assert.equal(JSON.stringify(db), before);
  } finally { ctx.XLSX.writeFile = originalWrite; ctx.console = originalConsole; ctx.gsmCancelActExport(); }
});

test('release version matches the lockfile and has readable in-app release notes', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  const changelog = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(root, 'assets/js/25h-changelog.js'), 'utf8'), changelog);
  const current = changelog.clParse(fs.readFileSync(path.join(root, 'assets/CHANGELOG.md'), 'utf8')).find(entry => entry.version === pkg.version);
  assert.ok(current && current.items.length > 0);
});

test('date validation rejects impossible dates without throwing', () => {
  assert.equal(ctx.gsmValidDate('2026-13-01'), false); assert.equal(ctx.gsmValidDate('2026-02-30'), false); assert.equal(ctx.gsmValidDate('2026-08-01'), true);
});
test('card mentioned in manual note must not be silently assigned to vehicle organization', () => {
  const db = base(); record(db, 'r', '2026-08-01', 58, 0, { note: 'Карта трекол' });
  const l = ledger(db); assert.ok(l.errors.some(i => i.code === 'manual-card-reference')); assert.notEqual(l.receipts[0].org, 'A');
});
test('corrupt fuel text is flagged and cannot become gasoline in a diesel car', () => {
  const db = base(); db.vehicles[0].fuelGrade = 'ДТ'; record(db, 'r', '2026-08-01', 25, 20, { fuelGrade: 'Д\uFFFD\uFFFD' });
  purchase(db, 'p', 'r', '2026-08-01', 25, '111111', { grade: 'ДТ' });
  const l = ledger(db); assert.equal(l.rows[0].grade, 'ДТ'); assert.equal(l.rows[0].spent, 20); assert.ok(l.errors.some(i => i.code === 'unknown-grade'));
});
test('restored duplicate is visible and keeps blocking carry periods until reviewed', () => {
  const db = base(); record(db, 'r', '2026-08-01', 30, 0); purchase(db, 'p1', 'r', '2026-08-01', 30, '111111'); purchase(db, 'p2', 'r', '2026-08-01', 30, '111111', { restored: true });
  assert.ok(ledger(db, '2026-09-01', '2026-09-30').errors.some(i => i.code === 'purchase-duplicate'));
});
test('changed note text cannot restore an already imported purchase twice', () => {
  const db = base(); record(db, 'r', '2026-08-01', 60, 0, { note: 'заправка: АИ-95 60л; импорт заправок: 2026-08-01|60|111111||повреждённый текст' });
  purchase(db, 'p', 'r', '2026-08-01', 60, '111111', { importKey: '2026-08-01|60|111111||другой текст' });
  ctx.inputData = db; vm.runInContext('data=inputData', ctx); assert.equal(ctx.fpRestoreFromJournal(), 0); assert.equal(db.fuelPurchases.length, 1);
});
test('restoring a missing second purchase allocates only its share of journal money', () => {
  const db = base(); record(db, 'r', '2026-08-01', 100, 0, { fuelSum: 10000, note: 'заправка: АИ-95 40л, АИ-95 60л; импорт заправок: 2026-08-01|40|111111||один | 2026-08-01|60|111111||два' });
  purchase(db, 'p', 'r', '2026-08-01', 40, '111111', { sum: 4000, importKey: '2026-08-01|40|111111||один' });
  ctx.inputData = db; vm.runInContext('data=inputData', ctx); assert.equal(ctx.fpRestoreFromJournal(), 1); assert.equal(db.fuelPurchases[1].sum, 6000); assert.equal(ctx.fpRestoreFromJournal(), 0);
});
test('updating a purchase with a stale recordId removes old litres before adding new', () => {
  const db = base(); record(db, 'r', '2026-08-01', 30, 0); purchase(db, 'p', 'missing', '2026-08-01', 30, '111111');
  ctx.inputData = db; vm.runInContext('data=inputData', ctx); ctx.fpUpdate(db.fuelPurchases[0], { qty: 40 });
  assert.equal(db.records.reduce((s, r) => s + Number(r.fuelIssued || 0), 0), 40);
});
test('annual report shares the same actual fuel and tank measurement calculation', () => {
  const db = base(); record(db, 'r', '2026-08-01', 100, 20, { fuelIdle: 5, tankMeasured: 65 }); purchase(db, 'p', 'r', '2026-08-01', 100, '222222', { sum: 9000 });
  ctx.inputData = db; vm.runInContext('data=inputData', ctx); const rows = ctx.frRows('veh', '2026');
  close(rows.reduce((s, r) => s + r.cells[7].act, 0), 35); close(rows.reduce((s, r) => s + r.cells[7].iss, 0), 100);
});
test('non-numeric card names are not normalized to an empty card', () => { assert.equal(ctx.fcNorm('Наличка'), 'НАЛИЧКА'); });
test('card seeding uses the declared holder, not the majority recipient', () => {
  const db = base(); db.fuelCards = []; db.vehicles[0].fuelcard = '1111111111';
  purchase(db, 'p', null, '2026-08-01', 60, '1111111111', { vehicleId: 'holder' });
  ctx.inputData = db; vm.runInContext('data=inputData', ctx); ctx.fcSeed();
  assert.equal(db.fuelCards[0].assignments[0].vehicleId, 'v');
});
test('fuel filter applies to the act and all reconciliation sheets', () => {
  const db = base(); record(db, 'r1', '2026-08-01', 30, 0); purchase(db, 'p1', 'r1', '2026-08-01', 30, '222222');
  record(db, 'r2', '2026-08-02', 40, 0, { fuelGrade: 'АИ-92' }); purchase(db, 'p2', 'r2', '2026-08-02', 40, '222222', { grade: 'АИ-92' });
  ctx.inputData = db; vm.runInContext('data=inputData', ctx); const wb = ctx.gsmActWorkbook(ledger(db), 'B', { fuelGrade: 'АИ-92' });
  const rows = actDataRows(wb); assert.equal(rows.length, 1); assert.equal(rows[0][4], 'АИ-92');
  assert.equal(actRows(wb).find(r => r[0] === 'ИТОГО:')[19], 40);
  const reconciliation = ctx.XLSX.utils.book_new(); ctx.gsmAppendReconciliation(reconciliation, ledger(db), 'B', 'АИ-92');
  const receipts = ctx.XLSX.utils.sheet_to_json(reconciliation.Sheets['Поступления'], { header: 1 }); assert.equal(receipts.length, 2); assert.equal(receipts[1][7], 40);
});

test('act keeps the original approval, two-level headings, column widths and commission signatures', () => {
  const db = base(); Object.assign(db.vehicles[0], { make: 'Нива', object: 'УНГКМ', driver: 'Водитель', odometer: 0 });
  record(db, 'r', '2026-08-01', 30, 10, { odoStart: 0, odoEnd: 100 }); purchase(db, 'p', 'r', '2026-08-01', 30, '111111');
  ctx.inputData = db; vm.runInContext('data=inputData', ctx);
  const wb = ctx.gsmActWorkbook(ledger(db), 'A', { actNo: '15', actDate: '2026-09-01' }), ws = wb.Sheets['Акт списания ГСМ'];
  assert.equal(ws.S1.v, 'Утверждаю:'); assert.equal(ws.S2.v, 'Руководитель A');
  assert.equal(ws.A4.v, 'Акт списания ГСМ по A за август 2026г.'); assert.match(ws.A5.v, /Акт № 15.*01\.09\.2026/);
  assert.equal(ws.A7.v, '№ п/п'); assert.equal(ws.D7.v, 'Объект'); assert.equal(ws.G7.v, 'Спидометр');
  assert.equal(ws.G8.v, 'на нач'); assert.equal(ws.H8.v, 'на кон');
  assert.equal(ws.O7.v, 'Получено, л'); assert.equal(ws.O8.v, 'Газпром'); assert.equal(ws.T8.v, 'Всего');
  assert.equal(ws.U7.v, 'Списано, л'); assert.equal(ws.U8.v, 'по норме'); assert.equal(ws.V8.v, 'по факту'); assert.equal(ws.W8.v, 'х/х');
  assert.equal(ws.D9.v, 'УНГКМ'); assert.equal(ws.G9.v, 0); assert.equal(ws.H9.v, 100);
  assert.equal(ws.O9.v, 30); assert.equal(ws.T9.v, 30); assert.equal(ws.V9.v, 10); assert.equal(ws.X9.v, 20);
  assert.equal(ws.A10.v, 'ИТОГО:'); assert.equal(ws.T10.v, 30);
  assert.equal(ws.A12.v, 'Комиссия:   Главный механик _______________ / ________________ /');
  assert.equal(ws.A13.v, 'Управляющий директор _______________ / ________________ /');
  assert.deepEqual(Array.from(ws['!cols'], c => c.wch), [4, 18, 12, 14, 8, 18, 9, 9, 7, 7, 6, 9, 10, 9, 9, 10, 8, 8, 8, 9, 9, 9, 8, 9, 11, 13]);
  assert.ok(ws['!merges'].some(m => ctx.XLSX.utils.encode_range(m) === 'O7:T7'));
  assert.ok(ws['!merges'].some(m => ctx.XLSX.utils.encode_range(m) === 'A10:K10'));
  assert.equal(ws.A7.s.fill.fgColor.rgb, '2D5A8E'); assert.equal(ws['!autofilter'], undefined);
  assert.deepEqual(Array.from(wb.SheetNames), ['Акт списания ГСМ']);
});

test('all organization acts keep separate totals on the original single sheet without duplicating fuel', () => {
  const db = base(); record(db, 'r', '2026-08-01', 100, 70); purchase(db, 'p1', 'r', '2026-08-01', 60, '111111'); purchase(db, 'p2', 'r', '2026-08-01', 40, '222222');
  ctx.inputData = db; vm.runInContext('data=inputData', ctx);
  const before = JSON.stringify(db), wb = ctx.gsmActWorkbook(ledger(db), '', {}), rows = actRows(wb);
  const totals = rows.filter(r => r[0] === 'ИТОГО:');
  assert.equal(totals.length, 2); assert.equal(totals[0][19], 60); assert.equal(totals[0][21], 60);
  assert.equal(totals[1][19], 40); assert.equal(totals[1][21], 10); assert.equal(totals[1][23], 30);
  assert.equal(rows.filter(r => r[18] === 'Утверждаю:').length, 2);
  assert.equal(rows.filter(r => /Главный механик/.test(r[0])).length, 2);
  assert.equal(JSON.stringify(db), before);
});

test('stationary vehicles remain in the act with zeros, gas vehicles remain excluded', () => {
  const db = base(); db.vehicles.push({ id: 'gas', plate: 'GAS', fuel: 'gas', org: 'A' });
  ctx.inputData = db; vm.runInContext('data=inputData', ctx);
  const before = JSON.stringify(db), wb = ctx.gsmActWorkbook(ledger(db), 'A', {}), rows = actDataRows(wb);
  assert.equal(rows.length, 1); assert.equal(rows[0][2], 'RECEIVER'); assert.equal(rows[0][19], 0); assert.equal(rows[0][21], 0);
  assert.equal(JSON.stringify(db), before);
});

test('an exported file preserves the original merged headings and numeric totals after readback', () => {
  const db = base(); record(db, 'r', '2026-08-01', 30, 10); purchase(db, 'p', 'r', '2026-08-01', 30, '111111');
  ctx.inputData = db; vm.runInContext('data=inputData', ctx);
  const wb = ctx.gsmActWorkbook(ledger(db), 'A', {}), bytes = ctx.XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const restored = ctx.XLSX.read(bytes, { type: 'buffer', cellStyles: true }), rows = actRows(restored);
  assert.deepEqual(Array.from(restored.SheetNames), ['Акт списания ГСМ']);
  assert.equal(actDataRows(restored)[0][19], 30); assert.equal(rows.find(r => r[0] === 'ИТОГО:')[21], 10);
  assert.ok(restored.Sheets['Акт списания ГСМ']['!merges'].some(m => ctx.XLSX.utils.encode_range(m) === 'O6:T6'));
});
test('import uses the actual vehicle before the assigned card vehicle', () => {
  const source = fs.readFileSync(path.join(root, 'assets/js/11-import.js'), 'utf8');
  const helpers = source.slice(source.indexOf('      const plateChars'), source.indexOf('      const transactions = []'));
  const matcher = source.slice(source.indexOf('      function matchVehicle(tx)'), source.indexOf('      // Покупки из выписок'));
  const a = { id: 'a', plate: 'Р559НВ716', make: 'УАЗ' }, b = { id: 'b', plate: '6763АА16', make: 'Трэкол' };
  const local = vm.createContext({ data: { vehicles: [a, b] }, cVehicle: 0, headers: ['автомобиль'], fcVehicleAt: () => a });
  vm.runInContext(helpers + matcher, local);
  assert.equal(local.matchVehicle({ date: '2026-08-01', vehicleText: 'Трэкол 6763', comment: '', cardNo: '111111' }).id, 'b');
  assert.equal(local.matchVehicle({ date: '2026-08-01', vehicleText: 'Р999РР716', comment: '', cardNo: '111111' }), null);
  local.headers = ['закреплена']; assert.equal(local.matchVehicle({ date: '2026-08-01', vehicleText: 'Р559НВ716', comment: '6763АА16', cardNo: '111111' }).id, 'b');
});
test('existing working databases are never overwritten by a bundled seed', () => {
  const source = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');
  const fn = source.slice(source.indexOf('function applyBundledDataSeedOnce()'), source.indexOf('function createWindow()'));
  for (const existing of ['legacy', 'sections', 'backup-fails']) {
    let writes = 0;
    const local = vm.createContext({ settings: {}, prototypeBuild:false, __dirname: '/app/electron', path: path.posix, console: { log() {}, error() {} },
      getDataDir: () => '/active', getBackupDir: () => '/active/backups', ensureDirs() {}, storage: { readAll: () => ({}), writeAll() { writes++; } },
      fs: { existsSync: f => f.includes('bundled-data') || existing === 'legacy' && f.endsWith('/data.json') || existing === 'sections' && f.endsWith('/sections'),
        readdirSync: () => ['records.json'], mkdirSync() {}, writeFileSync() { throw Error('disk full'); }, readFileSync: () => '{}' } });
    vm.runInContext(fn + 'applyBundledDataSeedOnce()', local); assert.equal(writes, 0, existing);
  }
});
