const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '..');
// Synthetic fixtures only. No application profile or working database is opened.
const ctx = vm.createContext({ console, window: {}, document: { addEventListener() {}, documentElement: { removeAttribute() {} }, getElementById() {} }, localStorage: { getItem() {} } });
for (const file of ['assets/js/01-core.js', 'assets/js/29-fuel-quality.js', 'vendor/xlsx.bundle.js', 'assets/js/10-pdf-reports.js', 'assets/js/25-fuel-report.js',
  'assets/js/25b-fuel-purchases.js', 'assets/js/25c-fuel-control.js', 'assets/js/25i-gsm-ledger.js', 'assets/js/25j-gsm-workspace.js', 'assets/js/25k-gsm-export.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
}
function database() {
  return { vehicles: [{ id: 'synthetic-v', plate: 'SYNTHETIC', make: 'Synthetic car', org: 'A', fuel: 'gasoline', fuelGrade: 'АИ-100', fuelBalance: 0, norm: 10 }],
    fuelCards: [{ number: '111111', org: 'A', provider: 'Synthetic supplier', assignments: [{ vehicleId: 'synthetic-v', from: '', to: '' }] }],
    records: [], fuelPurchases: [], monthlyFuel: [] };
}
function setDatabase(db) { ctx.inputData = db; vm.runInContext('data=inputData;gsmOrg="";gsmFuel=""', ctx); }
function ledger(db) { return ctx.gsmBuildLedger(db, { from: '2026-10-01', to: '2026-10-31' }); }
function sheetRows(wb, sheet) { return ctx.XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: '' }); }
function actRows(wb) { return sheetRows(wb, 'Акт списания ГСМ').filter(row => typeof row[0] === 'number'); }
function close(actual, expected) { assert.ok(Math.abs(actual - expected) < 0.002, `${actual} != ${expected}`); }
function pairedDatabase() {
  const db = database();
  db.records = [
    { id: 'synthetic-debt', vehicleId: 'synthetic-v', date: '2026-10-01', fuelGrade: 'АИ-100', km: 300, fuelActual: 30 },
    { id: 'synthetic-supply', vehicleId: 'synthetic-v', date: '2026-10-02', fuelGrade: 'АИ-95', km: 0, fuelActual: 0, fuelIssued: 50 },
  ];
  db.fuelPurchases = [{ id: 'synthetic-purchase', vehicleId: 'synthetic-v', recordId: 'synthetic-supply', date: '2026-10-02', grade: 'АИ-95', cardNo: '111111', qty: 50 }];
  return db;
}
function provenanceDatabase() {
  const db = database(); Object.assign(db.vehicles[0], { fuelGrade: 'АИ-95', fuelBalance: 100 });
  db.records = [
    { id: 'synthetic-norm', vehicleId: 'synthetic-v', date: '2026-10-01', fuelGrade: 'АИ-95', km: 100, fuelIdle: 2 },
    { id: 'synthetic-actual', vehicleId: 'synthetic-v', date: '2026-10-02', fuelGrade: 'АИ-95', km: 100, fuelActual: 5, fuelIdle: 1 },
    { id: 'synthetic-measurement', vehicleId: 'synthetic-v', date: '2026-10-03', fuelGrade: 'АИ-95', km: 0, fuelActual: 0, tankMeasured: 70 },
  ];
  return db;
}

test('grade reconciliation UI exposes neutral signed corrections and pair basis without changing receipts', () => {
  const db = pairedDatabase(); setDatabase(db); const before = JSON.stringify(db), result = ledger(db);
  const html = ctx.gsmBarrelsHtml(result);
  assert.match(html, /Корректировка\/сверка/); assert.doesNotMatch(html, /Неразобранный приход/);
  assert.match(html, /Сверка марок/); assert.match(html, /\+30,000/); assert.match(html, /-30,000/);
  assert.match(html, /АИ-95 → АИ-100/); assert.match(html, /synthetic-purchase/); assert.match(html, /synthetic-debt/);
  assert.match(html, /не меняют марку покупки, приход или расход/);
  vm.runInContext('gsmFuel="АИ-95"', ctx);
  const filtered = ctx.gsmGradeReconciliationHtml(result);
  assert.equal((filtered.match(/synthetic-purchase/g) || []).length, 1);
  assert.match(filtered, /-30,000/); assert.doesNotMatch(filtered, /\+30,000/); assert.match(filtered, /АИ-95 → АИ-100/);
  assert.equal(result.receipts[0].grade, 'АИ-95'); close(result.receipts[0].qty, 50);
  assert.equal(JSON.stringify(db), before);
});

test('reconciliation workbook contains two opposite numeric sides with the original source grade unchanged', () => {
  const db = pairedDatabase(); setDatabase(db); const before = JSON.stringify(db), result = ledger(db), wb = ctx.XLSX.utils.book_new();
  ctx.gsmAppendReconciliation(wb, result, 'A', '');
  const pairs = sheetRows(wb, 'Сверка марок').slice(1);
  assert.equal(pairs.length, 2); assert.equal(new Set(pairs.map(row => row[9])).size, 1);
  close(pairs.reduce((sum, row) => sum + row[6], 0), 0);
  assert.deepEqual(new Set(pairs.map(row => row[6])), new Set([30, -30]));
  assert.ok(pairs.every(row => row[0] === '2026-10-02' && row[1] === 'A' && row[2].includes('SYNTHETIC') && row[3] === 'АИ-95' && row[4] === 'АИ-100'));
  assert.ok(pairs.every(row => row[10] === 'synthetic-purchase' && row[11] === 'synthetic-supply' && row[12] === 'synthetic-debt'));
  assert.match(wb.Sheets['Сверка марок'].G2.z, /^\+/);
  const receipts = sheetRows(wb, 'Поступления').slice(1);
  assert.equal(receipts.length, 1); assert.equal(receipts[0][5], 'АИ-95'); close(receipts[0][7], 50);
  close(sheetRows(wb, 'Расход по партиям').slice(1).reduce((sum, row) => sum + row[4], 0), 30);
  assert.equal(JSON.stringify(db), before);
});

test('grade-filtered workbooks keep one signed side but preserve the counterpart grade and identifiers', () => {
  const db = pairedDatabase(); setDatabase(db); const result = ledger(db);
  for (const [grade, delta, issued] of [['АИ-95', -30, 50], ['АИ-100', 30, 0]]) {
    const wb = ctx.gsmActWorkbook(result, 'A', { fuelGrade: grade });
    const pairs = sheetRows(wb, 'Сверка марок').slice(1); assert.equal(pairs.length, 1);
    assert.equal(pairs[0][5], grade); close(pairs[0][6], delta); assert.equal(pairs[0][3], 'АИ-95'); assert.equal(pairs[0][4], 'АИ-100');
    assert.match(pairs[0][8], /synthetic-purchase.*synthetic-debt/);
    const rows = actRows(wb); assert.equal(rows.length, 1); assert.equal(rows[0][4], grade); close(rows[0][19], issued);
    const note = sheetRows(wb, 'Акт списания ГСМ').flat().find(value => typeof value === 'string' && value.startsWith('Корректировка/сверка марок:'));
    assert.match(note, /не приход и не расход/); assert.ok(note.includes((delta > 0 ? '+' : '') + delta));
  }
  const otherOrg = ctx.XLSX.utils.book_new(); ctx.gsmAppendReconciliation(otherOrg, result, 'B', '');
  assert.equal(otherOrg.SheetNames.includes('Сверка марок'), false);
});

test('act retains its 26-column accounting values and explains why grade totals differ from receipt minus expense', () => {
  const db = pairedDatabase(); setDatabase(db); const result = ledger(db), wb = ctx.gsmActWorkbook(result, 'A', {});
  const ws = wb.Sheets['Акт списания ГСМ']; assert.equal(ctx.XLSX.utils.decode_range(ws['!ref']).e.c, 25); assert.equal(ws['!cols'].length, 26);
  const rows = actRows(wb), incoming = rows.find(row => row[4] === 'АИ-95'), debt = rows.find(row => row[4] === 'АИ-100');
  close(incoming[19], 50); close(incoming[21], 0); close(incoming[23], 20);
  close(debt[19], 0); close(debt[21], 30); close(debt[23], 0);
  const labels = sheetRows(wb, 'Акт списания ГСМ').flat();
  assert.ok(labels.includes('к списанию')); assert.ok(labels.includes('в т.ч. х/х')); assert.equal(labels.includes('по факту'), false);
  assert.ok(labels.some(value => typeof value === 'string' && value.includes('АИ-95: -30 л') && value.includes('АИ-100: +30 л')));
});

test('norm and tank measurement consumption retain their true basis and do not double idle litres', () => {
  const db = provenanceDatabase(); setDatabase(db); const before = JSON.stringify(db), result = ledger(db), wb = ctx.gsmActWorkbook(result, 'A', {});
  const basis = sheetRows(wb, 'Основание расхода').slice(1);
  assert.deepEqual(new Set(basis.map(row => row[7])), new Set(['actual', 'norm', 'measurement']));
  const norm = basis.find(row => row[8] === 'synthetic-norm'), actual = basis.find(row => row[8] === 'synthetic-actual'), measurement = basis.find(row => row[8] === 'synthetic-measurement');
  close(norm[4], 12); close(norm[5], 2); assert.equal(norm[6], 'Расчёт по норме');
  close(actual[4], 6); close(actual[5], 1); assert.equal(actual[6], 'Введённый факт');
  close(measurement[4], 12); assert.equal(measurement[6], 'Расчёт по замеру остатка');
  const act = actRows(wb)[0]; close(act[21], 30); close(act[22], 3); close(act[23], 70);
  close(basis.reduce((sum, row) => sum + row[4], 0), act[21]);
  const labels = sheetRows(wb, 'Акт списания ГСМ').flat();
  assert.ok(labels.some(value => typeof value === 'string' && value.includes('холостой ход') && value.includes('повторно не прибавляется')));
  assert.ok(labels.some(value => typeof value === 'string' && value.includes('Основание расхода')));
  const html = ctx.gsmJournalHtml(result); assert.match(html, /Расчёт по норме/); assert.match(html, /Расчёт по замеру остатка/); assert.match(html, /Введённый факт/);
  assert.equal(JSON.stringify(db), before);
});

test('provenance sheets respect organization and grade filters and persist through XLSX readback', () => {
  const db = provenanceDatabase(); setDatabase(db); const result = ledger(db), wb = ctx.XLSX.utils.book_new();
  ctx.gsmAppendReconciliation(wb, result, 'A', 'АИ-95');
  assert.ok(wb.SheetNames.includes('Основание расхода'));
  assert.ok(sheetRows(wb, 'Основание расхода').slice(1).every(row => row[1] === 'A' && row[3] === 'АИ-95'));
  const excluded = ctx.XLSX.utils.book_new(); ctx.gsmAppendReconciliation(excluded, result, 'A', 'ДТ');
  assert.equal(excluded.SheetNames.includes('Основание расхода'), false);
  const act = ctx.gsmActWorkbook(result, 'A', {}), bytes = ctx.XLSX.write(act, { type: 'buffer', bookType: 'xlsx' });
  const restored = ctx.XLSX.read(bytes, { type: 'buffer', cellStyles: true });
  assert.deepEqual(Array.from(restored.SheetNames), ['Акт списания ГСМ', 'Основание расхода']);
  close(actRows(restored)[0][21], 30); assert.equal(sheetRows(restored, 'Основание расхода').slice(1).length, 3);
});

test('ordinary actual-only exports retain one original act sheet with the same fuel numbers', () => {
  const db = database(); db.vehicles[0].fuelBalance = 50;
  db.records = [{ id: 'synthetic-actual-only', vehicleId: 'synthetic-v', date: '2026-10-01', fuelGrade: 'АИ-100', km: 100, fuelActual: 10, fuelIdle: 2 }];
  setDatabase(db); const result = ledger(db), wb = ctx.gsmActWorkbook(result, 'A', {});
  assert.deepEqual(Array.from(wb.SheetNames), ['Акт списания ГСМ']);
  const row = actRows(wb)[0]; close(row[13], 50); close(row[19], 0); close(row[21], 12); close(row[22], 2); close(row[23], 38);
});
