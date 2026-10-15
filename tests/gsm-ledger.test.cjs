const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ctx = vm.createContext({ console, window: {}, document: { addEventListener() {}, documentElement: { removeAttribute() {} }, getElementById() {} }, localStorage: { getItem() {} } });
for (const file of ['assets/js/01-core.js', 'vendor/xlsx.bundle.js', 'assets/js/10-pdf-reports.js', 'assets/js/25-fuel-report.js', 'assets/js/25b-fuel-purchases.js', 'assets/js/25c-fuel-control.js', 'assets/js/25i-gsm-ledger.js', 'assets/js/25k-gsm-export.js']) {
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
  assert.equal(JSON.stringify(db), before); const rows = ctx.XLSX.utils.sheet_to_json(wb.Sheets['Акт 1'], { header: 1 });
  assert.equal(rows[2][2], 'RECEIVER'); assert.equal(rows[2][19], 30); assert.equal(rows[2][21], 10); assert.equal(rows[2][23], 20);
  assert.ok(wb.Sheets['Поступления']); assert.ok(wb.Sheets['Расход по партиям']);
});
test('legacy act export works without optional settings and does not modify the journal', () => {
  const db = base(); record(db, 'r', '2026-08-01', 30, 10); purchase(db, 'p', 'r', '2026-08-01', 30, '222222');
  ctx.inputData = db; vm.runInContext('data=inputData', ctx);
  const before = JSON.stringify(db), originalWrite = ctx.XLSX.writeFile;
  let exported = null;
  ctx.XLSX.writeFile = wb => { exported = wb; };
  try {
    assert.equal(ctx.exportFuelWriteOffAct('2026-08-01', '2026-08-31'), exported);
    assert.ok(exported.Sheets['Акт 1']);
    assert.equal(JSON.stringify(db), before);
  } finally { ctx.XLSX.writeFile = originalWrite; }
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
  const rows = ctx.XLSX.utils.sheet_to_json(wb.Sheets['Акт 1'], { header: 1 }); assert.equal(rows[2][4], 'АИ-92'); assert.equal(rows[3][19], 40);
  const receipts = ctx.XLSX.utils.sheet_to_json(wb.Sheets['Поступления'], { header: 1 }); assert.equal(receipts.length, 2); assert.equal(receipts[1][7], 40);
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
    const local = vm.createContext({ settings: {}, __dirname: '/app/electron', path: path.posix, console: { log() {}, error() {} },
      getDataDir: () => '/active', getBackupDir: () => '/active/backups', ensureDirs() {}, storage: { readAll: () => ({}), writeAll() { writes++; } },
      fs: { existsSync: f => f.includes('bundled-data') || existing === 'legacy' && f.endsWith('/data.json') || existing === 'sections' && f.endsWith('/sections'),
        readdirSync: () => ['records.json'], mkdirSync() {}, writeFileSync() { throw Error('disk full'); }, readFileSync: () => '{}' } });
    vm.runInContext(fn + 'applyBundledDataSeedOnce()', local); assert.equal(writes, 0, existing);
  }
});
