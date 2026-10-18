const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createRequire } = require('node:module');
let pw;
try { pw = require('playwright'); } catch { pw = createRequire(path.join(process.env.TVS_PLAYWRIGHT_MODULES || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'), 'package.json'))('playwright'); }
let browser, page, errors;
before(async () => {
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await pw.chromium.launch({ headless: true, executablePath: process.env.TVS_TEST_BROWSER || (!process.env.CI && fs.existsSync(edge) ? edge : undefined) });
});
after(async () => browser?.close());
beforeEach(async () => {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); errors = [];
  page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
  await page.addInitScript(() => {
    window.__writes = 0; window.__identity = 'A';
    window.__disk = JSON.stringify({ vehicles: [{ id: 'v', plate: 'Х123АА716', make: 'Нива', fuelGrade: 'АИ-95', org: 'A', norm: 10 }], records: [],
      generators: [], genRecords: [], fuelCards: [], fuelPurchases: [], fuelImports: [], fuelPeriods: [], appMeta: [{ id: 'meta', toPlanInit: 'test' }] });
    window.electronAPI = { readData: async () => window.__disk, getDataIdentity: async () => window.__identity,
      writeData: async json => { window.__writes++; window.__disk = json; return true; } };
  });
  await page.goto(pathToFileURL(path.join(__dirname, '../index.html')).href);
  await page.waitForFunction(() => typeof data !== 'undefined' && data.vehicles.length === 1);
  await page.evaluate(() => { toAutoSetupOnce = async () => {}; showFuelImportReport = report => { window.__report = report; }; });
});
afterEach(async () => { await page.close(); assert.deepEqual(errors, []); });
async function importRows(rows, kind = 'vehicles', fileName = 'supplier.xlsx') {
  await page.evaluate(({ rows, kind, fileName }) => {
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
    const input = { files: [new File([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], fileName)], value: '' };
    if (kind === 'vehicles') importVehiclesFromXls(input); else importFuelFromXls(input, kind);
  }, { rows, kind, fileName });
  await page.locator('#importMappingContinue').waitFor();
}
async function showDiff() {
  await page.locator('#importMappingContinue').click(); await page.locator('#importReviewApply').waitFor();
}
test('vehicle import is read-only through mapping and diff; only explicit apply persists', async () => {
  await importRows([['Марка ТС', 'Госномер', 'ФИО'], ['УАЗ', 'Р999РР716', 'Водитель']]);
  assert.deepEqual(await page.evaluate(() => ({ count: data.vehicles.length, writes: window.__writes })), { count: 1, writes: 0 });
  await showDiff();
  assert.deepEqual(await page.evaluate(() => ({ count: data.vehicles.length, writes: window.__writes })), { count: 1, writes: 0 });
  assert.match(await page.locator('#importReviewSummary').innerText(), /Добавится: 1/);
  await page.locator('#importReviewApply').click();
  await page.waitForFunction(() => data.vehicles.length === 2);
  assert.equal(await page.evaluate(() => window.__writes), 1);
  assert.equal(await page.evaluate(() => data.appMeta.filter(row => row.type === 'importBatch').length), 1);
});
test('cancelled import does not save template, rows, or batch; within-file duplicate is skipped', async () => {
  await importRows([['Марка ТС', 'Госномер'], ['УАЗ', 'Р999РР716'], ['УАЗ', 'Р999РР716']]);
  await page.locator('#importSaveTemplate').check(); await page.locator('#importTemplateName').fill('Supplier'); await showDiff();
  assert.match(await page.locator('#importReviewSummary').innerText(), /дубликатов по госномеру: 1/);
  await page.getByRole('button', { name: 'Отмена', exact: true }).last().click();
  assert.equal(await page.evaluate(() => window.__writes), 0);
  assert.equal(await page.evaluate(() => data.appMeta.some(row => row.type === 'importTemplate' || row.type === 'importBatch')), false);
});
test('fuel preview preserves existing manual litres and reports ambiguity after apply', async () => {
  await page.evaluate(() => { data.records = [{ id: 'r', vehicleId: 'v', date: '2026-10-01', km: 0, fuelIssued: 40, fuelGrade: 'АИ-95', note: 'ручная выдача' }]; rebuildIndex(); });
  await importRows([['Дата транзакции', 'Тип транзакции', 'Количество', 'Товар', 'Комментарий', 'Номер карты'], ['01.10.2026 14:00', 'Покупка', 30, 'АИ-95', 'Х123АА716', '123456']], 'fuel');
  await showDiff(); assert.equal(await page.evaluate(() => data.fuelPurchases.length), 0);
  await page.locator('#importReviewApply').click(); await page.waitForFunction(() => !!window.__report);
  assert.deepEqual(await page.evaluate(() => ({ issued: data.records[0].fuelIssued, qty: data.fuelPurchases[0].qty, action: window.__report.reportRows[0].action })), { issued: 40, qty: 30, action: 'review' });
});
test('supplier template restores reordered custom columns and stays scoped to import kind', async () => {
  await importRows([['Авто', 'Регномер'], ['УАЗ', 'Р999РР716']]);
  await page.locator('#importCol_make').selectOption('0'); await page.locator('#importCol_plate').selectOption('1');
  await page.locator('#importSaveTemplate').check(); await page.locator('#importTemplateName').fill('Custom supplier'); await showDiff();
  await page.locator('#importReviewApply').click(); await page.waitForFunction(() => data.vehicles.length === 2);
  const id = await page.evaluate(() => data.appMeta.find(row => row.type === 'importTemplate').id);
  await importRows([['Регномер', 'Авто'], ['Р888РР716', 'ГАЗ']]); await page.locator('#importColumnTemplate').selectOption(id);
  assert.equal(await page.locator('#importCol_plate').inputValue(), '0'); assert.equal(await page.locator('#importCol_make').inputValue(), '1');
  await showDiff(); await page.locator('#importReviewApply').click(); await page.waitForFunction(() => data.vehicles.length === 3);
  assert.equal(await page.evaluate(() => data.vehicles.find(row => row.plate === 'Р888РР716').make), 'ГАЗ');
});
test('database switch after preview rejects apply without touching the selected database', async () => {
  await importRows([['Марка ТС', 'Госномер'], ['УАЗ', 'Р999РР716']]); await showDiff();
  await page.evaluate(() => { window.__identity = 'B'; }); await page.locator('#importReviewApply').click();
  await page.waitForFunction(() => document.getElementById('importReviewError').textContent.length > 0);
  assert.match(await page.locator('#importReviewError').innerText(), /другая база/);
  assert.equal(await page.evaluate(() => window.__writes), 0);
});
test('archive merge and PDF selection also stop at an exact diff before writing', async () => {
  await page.evaluate(async () => {
    showImportPreview({ fileName: 'archive.json', main: { vehicles: [{ id: 'archive-v', plate: 'ARCHIVE', make: 'УАЗ' }] }, backupExtra: {}, backupCount: 0 });
    await doRarMerge();
  });
  await page.locator('#importReviewApply').waitFor(); assert.equal(await page.evaluate(() => window.__writes), 0);
  await page.locator('#importReviewApply').click(); await page.waitForFunction(() => data.vehicles.length === 2);
  await page.evaluate(async () => {
    _svodkaParsed = [{ plate: 'PDF', make: 'ГАЗ', driver: '', fuel: 'diesel', date: '2026-10-03', km: 20, fuelIssued: 0, fuelActual: 0 }];
    showSvodkaPreview(_svodkaParsed, 'summary.pdf'); await doSvodkaImport();
  });
  assert.equal(await page.evaluate(() => window.__writes), 1); assert.equal(await page.evaluate(() => data.vehicles.length), 2);
  await page.locator('#importReviewApply').click(); await page.waitForFunction(() => data.vehicles.length === 3);
  assert.equal(await page.evaluate(() => data.records.length), 1);
});
test('history undo requires confirmation and restores an applied vehicle batch', async () => {
  await importRows([['Марка ТС', 'Госномер'], ['УАЗ', 'Р999РР716']]); await showDiff();
  await page.locator('#importReviewApply').click(); await page.waitForFunction(() => data.vehicles.length === 2);
  await page.evaluate(() => importReviewHistory());
  await page.getByRole('button', { name: 'Отменить пакет', exact: true }).click();
  await page.locator('#confirmYes').click(); await page.waitForFunction(() => data.vehicles.length === 1);
  assert.equal(await page.evaluate(() => window.__writes), 2);
  assert.equal(await page.evaluate(() => data.appMeta.find(row => row.type === 'importBatch').status), 'undone');
  assert.match(await page.locator('#genericModalBody').innerText(), /Отменён/);
});
test('invalid rows and closed months are reported; decimal litres retain the full amount', async () => {
  await page.evaluate(() => { data.fuelPeriods = [{ month: '2026-09', closed: true }]; });
  await importRows([['Дата транзакции', 'Тип транзакции', 'Количество', 'Товар', 'Комментарий'],
    ['01.09.2026', 'Покупка', 10, 'АИ-95', 'Х123АА716'], ['31.02.2026', 'Покупка', 5, 'АИ-95', 'Х123АА716'],
    ['03.10.2026', 'Покупка', '1 000,50', 'АИ-95', 'Х123АА716']], 'fuel');
  await showDiff(); const text = await page.locator('#importReviewSummary').innerText();
  assert.match(text, /пропущено 1 операций/); assert.match(text, /Неверные дата\/количество: 1/);
  await page.locator('#importReviewApply').click(); await page.waitForFunction(() => !!window.__report);
  assert.deepEqual(await page.evaluate(() => ({ purchases: data.fuelPurchases.length, qty: data.fuelPurchases[0].qty, records: data.records.length, date: data.records[0].date })),
    { purchases: 1, qty: 1000.5, records: 1, date: '2026-10-03' });
});
test('GLONASS matching and preview write nothing; explicit apply and undo include its alias and trip', async () => {
  await page.evaluate(async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Объект', 'Дата', 'Пробег, км'], ['Неизвестный объект', '03.10.2026', 125.5]]), 'Trips');
    window.electronAPI.importGlonassFile = async () => ({ ok: true, kind: 'xlsx', fileName: 'glonass.xlsx', base64: XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }) });
    await importGlonassTrips();
  });
  assert.equal(await page.evaluate(() => window.__writes), 0);
  await page.locator('#fgAssign_0').selectOption('v');
  await page.getByRole('button', { name: 'Сопоставить', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__writes), 0);
  assert.equal(await page.evaluate(() => data.vehicles[0].glonassAliases), undefined);
  assert.equal(await page.evaluate(() => data.records.length), 0);
  await page.getByRole('button', { name: 'Показать изменения', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__writes), 0);
  await page.locator('#importReviewApply').click(); await page.waitForFunction(() => data.records.length === 1);
  assert.equal(await page.evaluate(() => data.records[0].kmGlonass), 125.5);
  assert.equal(await page.evaluate(() => data.vehicles[0].glonassAliases.length), 1);
  await page.evaluate(() => importReviewHistory()); await page.getByRole('button', { name: 'Отменить пакет', exact: true }).click();
  await page.locator('#confirmYes').click(); await page.waitForFunction(() => data.records.length === 0);
  assert.equal(await page.evaluate(() => data.vehicles[0].glonassAliases), undefined);
  assert.equal(await page.evaluate(() => window.__writes), 2);
});
