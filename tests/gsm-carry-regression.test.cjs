const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ctx = vm.createContext({ console, window: {}, document: { addEventListener() {}, documentElement: { removeAttribute() {} }, getElementById() {} }, localStorage: { getItem() {} } });
for(const file of ['assets/core/decimal-core.js','assets/js/55-precision-input.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx,{filename:file});
for (const file of ['assets/core/fuel-engine.js', 'assets/js/01-core.js', 'assets/js/29-fuel-quality.js', 'vendor/xlsx.bundle.js', 'assets/js/10-pdf-reports.js', 'assets/js/25-fuel-report.js', 'assets/js/25b-fuel-purchases.js', 'assets/js/25c-fuel-control.js', 'assets/js/25i-gsm-ledger.js', 'assets/js/25j-gsm-workspace.js', 'assets/js/25k-gsm-export.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
}

// Synthetic fixtures only: no working database, snapshot or personal data.
function database(org = 'A') {
  return {
    vehicles: [{ id: 'synthetic-vehicle', plate: 'SYNTHETIC', org, fuel: 'gasoline', fuelGrade: 'АИ-100', fuelBalance: 0, norm: 10 }],
    fuelCards: [
      { number: '111111', org, provider: 'Synthetic supplier A', assignments: [{ vehicleId: 'synthetic-vehicle', from: '', to: '' }] },
      { number: '222222', org: 'B', provider: 'Synthetic supplier B', assignments: [] },
    ],
    records: [], fuelPurchases: [], monthlyFuel: [],
  };
}
function record(db, id, date, { grade = 'АИ-100', issued = 0, spent = 0, ...extra } = {}) {
  db.records.push({ id, vehicleId: 'synthetic-vehicle', date, fuelGrade: grade, fuelIssued: issued, fuelActual: spent, km: 0, ...extra });
}
function receipt(db, id, recordId, date, qty, { grade = 'АИ-95', cardNo = '111111', ...extra } = {}) {
  db.fuelPurchases.push({ id, recordId, vehicleId: 'synthetic-vehicle', date, qty, grade, cardNo, ...extra });
}
function ledger(db, from = '2026-08-01', to = '2026-08-31') { return ctx.gsmBuildLedger(db, { from, to }); }
function amount(rows, field, org, grade) {
  return rows.filter(row => (!org || ctx.gsmOrgKey(row.org) === ctx.gsmOrgKey(org)) && (!grade || row.grade === grade)).reduce((sum, row) => sum + row[field], 0);
}
function close(actual, expected, message) { assert.ok(Math.abs(actual - expected) <= 0.002, `${message || 'quantity'}: ${actual} != ${expected}`); }
function balanced(result, totalCorrection = 0) {
  for (const row of [...result.rows, ...result.barrels]) close(row.start + row.issued + row.correction - row.spent, row.end, `${row.org}/${row.grade}`);
  close(amount(result.rows, 'correction'), totalCorrection, 'paired corrections must not create stock');
}
function pairs(result) {
  const movements = result.movements.filter(movement => movement.kind === 'grade-reconciliation');
  const groups = new Map();
  for (const movement of movements) {
    assert.ok(movement.pairId, 'each adjustment identifies its counterpart');
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(movement.date));
    assert.ok(Number.isFinite(movement.delta) && movement.delta !== 0);
    close(movement.qty, Math.abs(movement.delta), 'the two adjustment sides share one quantity');
    assert.notEqual(movement.fromGrade, movement.toGrade);
    assert.equal(movement.org, 'A');
    assert.equal(movement.vehicleId, 'synthetic-vehicle');
    assert.ok([movement.fromGrade, movement.toGrade].includes(movement.grade));
    if (!groups.has(movement.pairId)) groups.set(movement.pairId, []);
    groups.get(movement.pairId).push(movement);
  }
  for (const group of groups.values()) {
    assert.equal(group.length, 2, 'each reallocation has exactly two visible sides');
    close(group.reduce((sum, movement) => sum + movement.delta, 0), 0);
    assert.equal(new Set(group.map(movement => movement.grade)).size, 2);
    assert.equal(new Set(group.map(movement => movement.date)).size, 1);
    assert.equal(new Set(group.map(movement => movement.fromGrade)).size, 1);
    assert.equal(new Set(group.map(movement => movement.toGrade)).size, 1);
  }
  return movements;
}
function measuredCarry() {
  const db = database();
  record(db, 'synthetic-debt', '2026-08-01', { spent: 210.588 });
  record(db, 'synthetic-measurement', '2026-08-20', { grade: 'АИ-95', issued: 256.15, tankMeasured: 45.562 });
  receipt(db, 'synthetic-august-receipt', 'synthetic-measurement', '2026-08-20', 256.15);
  record(db, 'synthetic-september', '2026-09-10', { grade: 'АИ-95', issued: 289.99, spent: 318.3 });
  receipt(db, 'synthetic-september-receipt', 'synthetic-september', '2026-09-10', 289.99);
  return db;
}

test('a measured gasoline carry is preserved without a phantom negative grade in the following month', () => {
  const db = measuredCarry(), original = JSON.stringify(db);
  const august = ledger(db), september = ledger(db, '2026-09-01', '2026-09-30');
  close(amount(august.rows, 'end'), 45.562);
  close(amount(august.rows, 'issued'), 256.15);
  close(amount(august.rows, 'spent'), 210.588);
  close(amount(august.rows, 'end', 'A', 'АИ-100'), 0);
  close(amount(august.rows, 'end', 'A', 'АИ-95'), 45.562);
  close(august.journal.find(row => row.recordId === 'synthetic-measurement').balance, 45.562);
  close(amount(september.rows, 'start'), 45.562);
  close(amount(september.rows, 'issued'), 289.99);
  close(amount(september.rows, 'spent'), 318.3);
  close(amount(september.rows, 'end'), 17.252);
  close(amount(september.rows, 'end', 'A', 'АИ-95'), 17.252);
  assert.ok(september.rows.every(row => row.end >= -0.001));
  assert.equal(september.issues.some(issue => issue.code === 'carry-shortage'), false);
  balanced(august); balanced(september);
  assert.equal(JSON.stringify(db), original, 'calculating either month is read-only');
});

test('a cross-grade repayment emits paired adjustments without rewriting receipts or consumption tags', () => {
  const result = ledger(measuredCarry());
  const adjustments = pairs(result);
  assert.equal(adjustments.length, 2);
  for (const adjustment of adjustments) {
    assert.equal(adjustment.date, '2026-08-20');
    assert.equal(adjustment.purchaseId, 'synthetic-august-receipt');
    assert.equal(adjustment.recordId, 'synthetic-measurement');
    assert.equal(adjustment.debtRecordId, 'synthetic-debt');
    assert.equal(adjustment.debtDate, '2026-08-01');
  }
  close(adjustments.find(row => row.grade === 'АИ-100').delta, 210.588);
  close(adjustments.find(row => row.grade === 'АИ-95').delta, -210.588);
  close(amount(result.rows, 'correction', 'A', 'АИ-100'), 210.588);
  close(amount(result.rows, 'correction', 'A', 'АИ-95'), -210.588);
  assert.equal(result.receipts[0].grade, 'АИ-95');
  assert.equal(result.receipts[0].provider, 'Synthetic supplier A');
  close(result.receipts[0].qty, 256.15);
  const historicalConsumption = result.movements.filter(row => row.kind === 'consumption' && row.recordId === 'synthetic-debt');
  assert.ok(historicalConsumption.every(row => row.grade === 'АИ-100'));
  close(historicalConsumption.reduce((sum, row) => sum + row.qty, 0), 210.588);
  close(amount(result.rows, 'issued', 'A', 'АИ-100'), 0);
  close(result.rows.find(row => row.grade === 'АИ-95').providers['Synthetic supplier A'], 256.15);
  balanced(result);
});

test('a partial repayment leaves the genuine shortage negative and visible', () => {
  const db = database();
  record(db, 'debt', '2026-08-01', { spent: 30 });
  record(db, 'partial', '2026-08-02', { grade: 'АИ-95', issued: 10 });
  receipt(db, 'partial-receipt', 'partial', '2026-08-02', 10);
  const result = ledger(db);
  close(amount(result.rows, 'end'), -20);
  close(amount(result.rows, 'end', 'A', 'АИ-100'), -20);
  close(amount(result.rows, 'end', 'A', 'АИ-95'), 0);
  assert.ok(result.errors.some(issue => issue.code === 'carry-shortage' && Math.abs(issue.qty - 20) < 0.002));
  assert.equal(pairs(result).length, 2);
  balanced(result);
});

test('same-grade debt is repaid before other gasoline grades regardless of debt order', () => {
  const db = database();
  record(db, 'older-grade-debt', '2026-08-01', { spent: 10 });
  record(db, 'same-grade-debt', '2026-08-02', { grade: 'АИ-95', spent: 10 });
  record(db, 'repayment', '2026-08-03', { grade: 'АИ-95', issued: 15 });
  receipt(db, 'repayment-receipt', 'repayment', '2026-08-03', 15);
  const result = ledger(db);
  close(amount(result.rows, 'end', 'A', 'АИ-95'), 0);
  close(amount(result.rows, 'end', 'A', 'АИ-100'), -5);
  close(amount(result.rows, 'correction', 'A', 'АИ-100'), 5);
  close(amount(result.rows, 'correction', 'A', 'АИ-95'), -5);
  assert.equal(pairs(result).length, 2);
  balanced(result);
});

test('a surplus measurement can reconcile grade debt without hiding its unexplained physical gain', () => {
  const db = database();
  record(db, 'debt', '2026-08-01', { spent: 20 });
  record(db, 'surplus', '2026-08-02', { grade: 'АИ-95', tankMeasured: 10 });
  const result = ledger(db);
  close(amount(result.rows, 'end', 'A', 'АИ-100'), 0);
  close(amount(result.rows, 'end', 'A', 'АИ-95'), 10);
  close(amount(result.rows, 'issued'), 0, 'measurement cannot become a statement receipt');
  close(amount(result.rows, 'spent'), 20);
  assert.ok(result.errors.some(issue => issue.code === 'measurement-surplus' && Math.abs(issue.qty - 30) < 0.002));
  assert.equal(pairs(result).length, 2);
  balanced(result, 30);
});

test('a matching physical measurement cannot transfer a shortage between organizations', () => {
  const db = database();
  record(db, 'debt', '2026-08-01', { spent: 20 });
  record(db, 'foreign', '2026-08-02', { grade: 'АИ-95', issued: 80, tankMeasured: 60 });
  receipt(db, 'foreign-receipt', 'foreign', '2026-08-02', 80, { cardNo: '222222' });
  const result = ledger(db);
  close(amount(result.rows, 'end', 'A'), -20);
  close(amount(result.rows, 'end', 'B'), 80);
  close(amount(result.rows, 'end'), 60);
  assert.equal(pairs(result).length, 0);
  assert.ok(result.errors.some(issue => issue.code === 'carry-shortage' && issue.org === 'A'));
  balanced(result);
});

test('a supply from another fuel family cannot cover a gasoline debt', () => {
  const db = database();
  record(db, 'debt', '2026-08-01', { spent: 20 });
  record(db, 'diesel', '2026-08-02', { grade: 'ДТ', issued: 80 });
  receipt(db, 'diesel-receipt', 'diesel', '2026-08-02', 80, { grade: 'ДТ' });
  const result = ledger(db);
  close(amount(result.rows, 'end', 'A', 'АИ-100'), -20);
  close(amount(result.rows, 'end', 'A', 'ДТ'), 80);
  assert.equal(pairs(result).length, 0);
  balanced(result);
});

test('an unknown organization cannot authorize cross-grade repayment', () => {
  const db = database('Организация не определена');
  record(db, 'debt', '2026-08-01', { spent: 20 });
  record(db, 'unknown-owner', '2026-08-02', { grade: 'АИ-95', issued: 30 });
  receipt(db, 'unknown-owner-receipt', 'unknown-owner', '2026-08-02', 30);
  const result = ledger(db);
  close(amount(result.rows, 'end', null, 'АИ-100'), -20);
  close(amount(result.rows, 'end', null, 'АИ-95'), 30);
  assert.equal(pairs(result).length, 0);
  assert.ok(result.errors.some(issue => issue.code === 'source-org'));
  balanced(result);
});

test('a receipt with an unknown fuel family cannot cover a known gasoline debt', () => {
  const db = database();
  record(db, 'debt', '2026-08-01', { spent: 20 });
  record(db, 'unknown-grade', '2026-08-02', { issued: 30 });
  receipt(db, 'unknown-grade-receipt', 'unknown-grade', '2026-08-02', 30, { grade: 'SYNTHETIC UNRECOGNIZED PRODUCT' });
  const result = ledger(db);
  close(amount(result.rows, 'end', 'A', 'АИ-100'), -20);
  close(amount(result.rows, 'end', 'A', 'Не указано'), 30);
  assert.equal(pairs(result).length, 0);
  assert.ok(result.errors.some(issue => issue.code === 'unknown-grade'));
  balanced(result);
});

test('negative opening allocations are not mistaken for calculated shortage debt', () => {
  const db = database();
  db.vehicles[0].fuelBalance = 10;
  db.vehicles[0].fuelBalanceSources = [{ org: 'A', grade: 'АИ-100', qty: -20 }, { org: 'A', grade: 'АИ-95', qty: 30 }];
  record(db, 'measurement', '2026-08-02', { grade: 'АИ-95', tankMeasured: 10 });
  const result = ledger(db);
  close(amount(result.rows, 'end', 'A', 'АИ-100'), -20);
  close(amount(result.rows, 'end', 'A', 'АИ-95'), 30);
  close(amount(result.rows, 'end'), 10);
  assert.equal(pairs(result).length, 0);
  assert.ok(result.errors.some(issue => issue.code === 'carry-shortage'));
  balanced(result);
});

test('normal positive FIFO lots keep their actual grade and supplier allocation', () => {
  const db = database();
  record(db, 'first', '2026-08-01', { grade: 'АИ-92', issued: 30, spent: 20 });
  receipt(db, 'first-receipt', 'first', '2026-08-01', 30, { grade: 'АИ-92', cardNo: '222222' });
  record(db, 'second', '2026-08-02', { grade: 'АИ-95', issued: 20, spent: 15 });
  receipt(db, 'second-receipt', 'second', '2026-08-02', 20, { cardNo: '222222' });
  const result = ledger(db);
  close(amount(result.rows, 'spent', 'B', 'АИ-92'), 30);
  close(amount(result.rows, 'spent', 'B', 'АИ-95'), 5);
  close(amount(result.rows, 'end', 'B', 'АИ-95'), 15);
  assert.equal(pairs(result).length, 0);
  close(result.rows.find(row => row.grade === 'АИ-92').providers['Synthetic supplier B'], 30);
  close(result.rows.find(row => row.grade === 'АИ-95').providers['Synthetic supplier B'], 20);
  balanced(result);
});

test('reconciliation is replayed before a period opening and recorded only in its own period', () => {
  const db = measuredCarry();
  const august = ledger(db), after = ledger(db, '2026-08-21', '2026-08-31');
  const september = ledger(db, '2026-09-01', '2026-09-30');
  close(amount(after.rows, 'start'), 45.562);
  close(amount(after.rows, 'end'), 45.562);
  close(amount(after.rows, 'start', 'A', 'АИ-100'), 0);
  close(amount(after.rows, 'correction'), 0);
  assert.equal(pairs(after).length, 0);
  assert.equal(pairs(september).length, 0);
  for (const grade of ['АИ-100', 'АИ-95']) close(amount(august.rows, 'end', 'A', grade), amount(september.rows, 'start', 'A', grade));
  balanced(after); balanced(september);
});

test('one-grade exports retain real receipts and spending while exposing the analytical correction', () => {
  const db = measuredCarry(), original = JSON.stringify(db);
  ctx.syntheticInputData = db;
  vm.runInContext('data = syntheticInputData', ctx);
  const august = ledger(db), september = ledger(db, '2026-09-01', '2026-09-30');
  const workbook = ctx.XLSX.utils.book_new();
  ctx.gsmAppendReconciliation(workbook, august, 'A', 'АИ-95');
  const barrelRows = ctx.XLSX.utils.sheet_to_json(workbook.Sheets['Бочки организаций'], { header: 1 });
  assert.equal(barrelRows.length, 2);
  assert.equal(barrelRows[1][1], 'АИ-95');
  close(barrelRows[1][3], 256.15); close(barrelRows[1][4], 0);
  close(barrelRows[1][5], -210.588); close(barrelRows[1][6], 45.562);
  const receiptRows = ctx.XLSX.utils.sheet_to_json(workbook.Sheets['Поступления'], { header: 1 });
  assert.equal(receiptRows.length, 2);
  assert.equal(receiptRows[1][5], 'АИ-95'); close(receiptRows[1][7], 256.15);
  const act = ctx.gsmActWorkbook(september, 'A', { fuelGrade: 'АИ-95' });
  const actData = ctx.XLSX.utils.sheet_to_json(act.Sheets['Акт списания ГСМ'], { header: 1 }).filter(row => typeof row[0] === 'number');
  assert.equal(actData.length, 1);
  assert.equal(actData[0][4], 'АИ-95');
  close(actData[0][13], 45.562); close(actData[0][19], 289.99);
  close(actData[0][21], 318.3); close(actData[0][23], 17.252);
  assert.equal(JSON.stringify(db), original);
});

test('a physical surplus has one traceable movement in addition to its paired grade reallocation', () => {
  const db = database();
  record(db, 'debt', '2026-08-01', { spent: 20 });
  record(db, 'measurement-source', '2026-08-02', { grade: 'АИ-95', tankMeasured: 10 });
  record(db, 'applied-last-row', '2026-08-02', { grade: 'АИ-95' });
  record(db, 'ordinary-consumption', '2026-08-03', { grade: 'АИ-95', issued: 20, spent: 5 });
  receipt(db, 'ordinary-receipt', 'ordinary-consumption', '2026-08-03', 20);
  const original = JSON.stringify(db), result = ledger(db);
  const corrections = result.movements.filter(movement => movement.kind === 'measurement-correction');
  assert.equal(corrections.length, 1);
  const correction = corrections[0];
  assert.equal(correction.source, 'measurement'); assert.equal(correction.date, '2026-08-02');
  assert.equal(correction.vehicleId, 'synthetic-vehicle'); assert.equal(correction.org, 'A'); assert.equal(correction.grade, 'АИ-95');
  assert.equal(correction.recordId, 'applied-last-row'); assert.equal(correction.measurementRecordId, 'measurement-source');
  close(correction.qty, 30); close(correction.delta, 30); assert.match(correction.reason, /замеру/);
  assert.equal(pairs(result).length, 2, 'physical gain does not replace or duplicate its cross-grade pair');
  close(amount(result.rows, 'issued'), 20); close(amount(result.rows, 'spent'), 25); close(amount(result.rows, 'end'), 25);
  close(result.receipts.reduce((sum, row) => sum + row.qty, 0), 20, 'a measured correction is not a fuel purchase');
  assert.ok(result.errors.some(issue => issue.code === 'measurement-surplus' && Math.abs(issue.qty - 30) < .002));
  balanced(result, 30); assert.equal(JSON.stringify(db), original);
});

test('measurement correction replay affects period opening without duplicate movements for known or unknown owners', () => {
  for (const org of ['A', 'Организация не определена']) {
    const db = database(org);
    record(db, 'before-period', '2026-07-31', { grade: 'АИ-95', tankMeasured: 8 });
    record(db, 'august-gain', '2026-08-02', { grade: 'АИ-95', tankMeasured: 10 });
    record(db, 'september-gain', '2026-09-02', { grade: 'АИ-95', tankMeasured: 15 });
    const original = JSON.stringify(db), august = ledger(db), after = ledger(db, '2026-08-03', '2026-08-31');
    const september = ledger(db, '2026-09-01', '2026-09-30');
    for (const [result, expected, sourceId] of [[august, 2, 'august-gain'], [september, 5, 'september-gain']]) {
      const corrections = result.movements.filter(movement => movement.kind === 'measurement-correction');
      assert.equal(corrections.length, 1); close(corrections[0].qty, expected); close(corrections[0].delta, expected);
      assert.equal(corrections[0].org, org); assert.equal(corrections[0].recordId, sourceId); assert.equal(corrections[0].measurementRecordId, sourceId);
      assert.ok(corrections.every(movement => movement.date >= result.from && movement.date <= result.to));
      assert.equal(result.receipts.length, 0); balanced(result, expected);
    }
    close(amount(august.rows, 'start'), 8); close(amount(august.rows, 'end'), 10);
    close(amount(september.rows, 'start'), 10); close(amount(september.rows, 'end'), 15);
    close(amount(after.rows, 'start'), 10); close(amount(after.rows, 'end'), 10); balanced(after);
    assert.equal(after.movements.some(movement => movement.kind === 'measurement-correction'), false);
    assert.equal(JSON.stringify(db), original);
  }
});
