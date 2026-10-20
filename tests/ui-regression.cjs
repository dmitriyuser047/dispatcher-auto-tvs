const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createRequire } = require('node:module');
let pw;
try { pw = require('playwright'); }
catch {
  const modules = process.env.TVS_PLAYWRIGHT_MODULES || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
  pw = createRequire(path.join(modules, 'package.json'))('playwright');
}
let browser, page, errors;
const fixture = () => ({
  vehicles: [{ id: 'v', plate: 'Х123АА716', make: 'Нива', driver: 'Тест', org: 'A', fuelGrade: 'АИ-95', fuel: 'gasoline', norm: 10, fuelBalance: 100, toIntervalKm: 10000, toIntervalMonths: 12 }],
  records: [{ id: 'r1', vehicleId: 'v', date: '2026-10-01', km: 100, odoStart: 1000, odoEnd: 1100, fuelIssued: 30, fuelUsed: 12, fuelActual: 10 },
    { id: 'r2', vehicleId: 'v', date: '2026-10-02', km: 50, fuelUsed: 5, fuelActual: 5 }],
  generators: [], genRecords: [], tanks: [], tankIncomes: [], toRecords: [], vehicleTo: [], repairs: [], payments: [], budget: [], contragents: [],
  fuelCards: [], fuelPurchases: [], fuelImports: [], monthlyFuel: [], fuelPeriods: [], appMeta: [{ id: 'meta', toPlanInit: 'test' }],
});
before(async () => {
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await pw.chromium.launch({ headless: true, executablePath: process.env.TVS_TEST_BROWSER || (!process.env.CI && fs.existsSync(edge) ? edge : undefined) });
});
after(async () => { await browser?.close(); });
beforeEach(async () => {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
  await page.addInitScript(db => {
    window.__disk = JSON.stringify(db);
    window.electronAPI = { readData: async () => window.__disk, writeData: async json => { window.__disk = json; return true; } };
  }, fixture());
  await page.goto(pathToFileURL(path.join(__dirname, '../index.html')).href);
  await page.waitForFunction(() => typeof data !== 'undefined' && data.records.length === 2);
  await page.evaluate(() => { toAutoSetupOnce = async () => {}; selectedVehicleId = 'v'; switchSection('vehicles'); selectedVehicleId = 'v'; });
});
afterEach(async () => { await page?.close(); assert.deepEqual(errors, []); });

async function openManualStatement() {
  await page.evaluate(() => { fpMonth = '2026-10'; fpView = 'receipts'; gsmOrg = ''; switchSection('fuelPurchases'); });
  await page.getByRole('button', { name: 'Добавить вручную', exact: true }).click();
  await page.getByRole('combobox', { name: 'Организация выписки', exact: true }).selectOption('A');
}
async function fillManualReceipt(date = '2026-10-03', qty = '45.5') {
  await page.getByRole('textbox', { name: 'Комментарий 1', exact: true }).fill('Manual receipt');
  await page.getByLabel('Дата 1', { exact: true }).fill(date);
  await page.getByRole('combobox', { name: 'Машина 1', exact: true }).selectOption('v');
  await page.getByRole('spinbutton', { name: 'Литры 1', exact: true }).fill(qty);
}
async function reviewManualReceipt() { await page.locator('#fpBody').getByRole('button', { name: 'Заправить', exact: true }).click(); }
test('text drag outside a form keeps it open; a genuine backdrop click closes it', async () => {
  await page.evaluate(() => { openEditRecord('r1'); document.getElementById('rec_note').value = 'Unsaved selected text'; });
  const f = await page.locator('#rec_note').boundingBox(), m = await page.locator('#recordModal .modal').boundingBox();
  await page.mouse.move(f.x + 12, f.y + 12); await page.mouse.down(); await page.mouse.move(m.x - 20, f.y + 12, { steps: 12 }); await page.mouse.up();
  assert.equal(await page.locator('#recordModal').evaluate(el => el.classList.contains('open')), true);
  assert.equal(await page.locator('#rec_note').inputValue(), 'Unsaved selected text');
  await page.mouse.move(5, 5); await page.mouse.down(); await page.mouse.move(f.x + 10, f.y + 10, { steps: 10 }); await page.mouse.up();
  assert.equal(await page.locator('#recordModal').evaluate(el => el.classList.contains('open')), true);
  await page.mouse.click(5, 5); assert.equal(await page.locator('#recordModal').evaluate(el => el.classList.contains('open')), false);
});
test('dynamic generic forms also survive text selection beyond their bounds', async () => {
  await page.evaluate(() => openGenericModal('Test', '<textarea id="genericText">Selected text</textarea>'));
  const f = await page.locator('#genericText').boundingBox(), m = await page.locator('#genericModal .modal').boundingBox();
  await page.mouse.move(f.x + 10, f.y + 10); await page.mouse.down(); await page.mouse.move(m.x - 10, f.y + 10, { steps: 10 }); await page.mouse.up();
  assert.equal(await page.locator('#genericModal').evaluate(el => el.classList.contains('open')), true);
});

test('vehicle act button opens the original period dialog and exports its selected dates and organization', async () => {
  await page.getByRole('button', { name: 'Акт ГСМ', exact: true }).click();
  assert.equal(await page.locator('#actGsmModal').evaluate(el => el.classList.contains('open')), true);
  assert.equal(await page.evaluate(() => activeSection), 'vehicles');
  await page.locator('#ag_range').check();
  assert.equal(await page.locator('#ag_range_inputs').isVisible(), true);
  await page.locator('#ag_date_from').fill('01.09.2026'); await page.locator('#ag_date_to').fill('30.09.2026');
  await page.locator('#ag_date').fill('01.10.2026'); await page.locator('#ag_no').fill('25');
  await page.locator('#ag_org').selectOption('A');
  await page.evaluate(() => { exportFuelWriteOffAct = (from, to, opts) => { window.__act = { from, to, opts }; return {}; }; });
  await page.locator('#actGsmModal').getByRole('button', { name: 'Сформировать акт' }).click();
  assert.deepEqual(await page.evaluate(() => window.__act), { from: '2026-09-01', to: '2026-09-30', opts: { actNo: '25', actDate: '2026-10-01', org: 'A' } });
  assert.equal(await page.locator('#actGsmModal').evaluate(el => el.classList.contains('open')), false);
});

test('act dialog rejects invalid dates without exporting or closing', async () => {
  await page.evaluate(() => { openActGsmModal(); window.__actExports = 0; exportFuelWriteOffAct = () => { window.__actExports++; }; });
  await page.locator('#ag_range').check(); await page.locator('#ag_date_from').fill('31.02.2026'); await page.locator('#ag_date_to').fill('01.03.2026');
  await page.locator('#actGsmModal').getByRole('button', { name: 'Сформировать акт' }).click();
  assert.equal(await page.evaluate(() => window.__actExports), 0);
  assert.equal(await page.locator('#actGsmModal').evaluate(el => el.classList.contains('open')), true);
});

test('GSM workspace exports the restored act and does not change the database', async () => {
  await page.evaluate(() => { fpMonth = '2026-10'; fpView = 'writeoff'; switchSection('fuelPurchases'); window.__actBefore = JSON.stringify(data);
    XLSX.writeFile = (wb, name) => { window.__actWorkbook = wb; window.__actFilename = name; }; });
  await page.getByRole('button', { name: 'Выгрузить акт', exact: true }).click();
  const out = await page.evaluate(() => {
    const wb = window.__actWorkbook, ws = wb.Sheets['Акт списания ГСМ'];
    return { names: wb.SheetNames, approval: ws.S1.v, title: ws.A4.v, header: ws.O6.v,
      signatures: XLSX.utils.sheet_to_json(ws, { header: 1 }).filter(r => /Главный механик|Управляющий директор/.test(r[0])).length,
      same: window.__actBefore === JSON.stringify(data), filename: window.__actFilename };
  });
  assert.deepEqual(out, { names: ['Акт списания ГСМ'], approval: 'Утверждаю:', title: 'Акт списания ГСМ по A за октябрь 2026г.',
    header: 'Получено, л', signatures: 2, same: true, filename: 'Акт_ГСМ_2026-10-01_2026-10-31.xlsx' });
});

test('receipt overview shows organization totals for all fuels and drills into the selected operations', async () => {
  await page.evaluate(() => {
    data.fuelPurchases = [{ id: 'diesel', date: '2026-10-03', vehicleId: '', cardNo: '123', grade: 'ДТ', qty: 40, sourceOrg: ' B ' },
      { id: 'gas', date: '2026-10-04', vehicleId: '', grade: 'Газ', qty: 5, sourceOrg: ' B ' },
      { id: 'deleted', date: '2026-10-04', grade: 'ДТ', qty: 1000, sourceOrg: 'B', deleted: true },
      { id: 'september', date: '2026-09-01', grade: 'АИ-92', qty: 100, sourceOrg: 'B' }];
    rebuildIndex(); window.__receiptBefore = JSON.stringify(data); window.__receiptDiskBefore = window.__disk;
    gsmOrg = ''; gsmFuel = ''; fpMonth = '2026-10'; fpView = 'receipts'; switchSection('fuelPurchases');
  });
  const summary = page.locator('#gsmIncomeSummary'), a = summary.locator('tbody tr[data-org="A"]'), b = summary.locator('tbody tr[data-org="B"]');
  assert.equal(await a.locator('[data-grade="АИ-95"]').innerText(), '30,000');
  assert.equal(await b.locator('[data-grade="ДТ"]').innerText(), '40,000');
  assert.equal(await b.locator('[data-grade="Газ"]').innerText(), '5,000');
  assert.equal(await summary.locator('tfoot td').last().innerText(), '75,000');
  await b.locator('[data-grade="ДТ"] button').click();
  assert.deepEqual(await page.evaluate(() => ({ org: gsmOrg, grade: gsmFuel, view: fpView })), { org: 'B', grade: 'ДТ', view: 'receipts' });
  assert.equal(await page.locator('#fpBody tbody tr').count(), 1);
  assert.equal(await summary.locator('tbody tr[data-org="B"] [data-grade="Газ"]').innerText(), '5,000');
  await summary.locator('tbody tr[data-org="B"] td').last().locator('button').click();
  assert.equal(await page.evaluate(() => gsmFuel), ''); assert.equal(await page.locator('#fpBody tbody tr').count(), 2);
  await page.getByRole('combobox', { name: 'Месяц', exact: true }).selectOption('2026-09');
  assert.equal(await summary.locator('tfoot td').last().innerText(), '100,000');
  const preserved = await page.evaluate(() => ({ memory: window.__receiptBefore === JSON.stringify(data), disk: window.__receiptDiskBefore === window.__disk }));
  assert.deepEqual(preserved, { memory: true, disk: true });
});

test('manual statement selects the vehicle and grade immediately, saves fuel and exposes it in the act', async () => {
  await openManualStatement();
  const before = await page.evaluate(() => window.__disk);
  await fillManualReceipt();
  assert.equal(await page.getByRole('combobox', { name: 'Топливо 1', exact: true }).inputValue(), 'АИ-95');
  assert.equal(await page.evaluate(() => window.__disk), before);
  await reviewManualReceipt();
  const dialog = await page.locator('#genericModal .modal').evaluate(el => ({ width: el.clientWidth, background: getComputedStyle(el).backgroundColor }));
  assert.ok(dialog.width >= 900); assert.match(dialog.background, /^rgb\(/);
  await page.locator('#gsmManualCommit').click();
  await page.waitForFunction(() => data.fuelPurchases.length === 1);
  const out = await page.evaluate(() => {
    const p = data.fuelPurchases[0], r = data.records.find(r => r.id === p.recordId), l = gsmBuildLedger(data, gsmMonthRange('2026-10'));
    const wb = gsmActWorkbook(l, 'A', {}), rows = XLSX.utils.sheet_to_json(wb.Sheets['Акт списания ГСМ'], { header: 1 });
    return { date: p.date, vehicle: p.vehicleId, grade: p.grade, qty: p.qty, org: p.sourceOrg, km: r.km,
      total: rows.find(r => r[0] === 'ИТОГО:')[19], saved: JSON.parse(window.__disk).fuelPurchases.length };
  });
  assert.deepEqual(out, { date: '2026-10-03', vehicle: 'v', grade: 'АИ-95', qty: 45.5, org: 'A', km: 0, total: 75.5, saved: 1 });
  assert.equal(await page.locator('#fpBody').getByRole('button', { name: 'Изменить', exact: true }).count(), 2);
});

async function openLoadedStatement() {
  await page.evaluate(() => {
    data.vehicles.push({ id: 'trekol', plate: '6763АА', make: 'ТРЭКОЛ', org: 'B', object: 'УНГКМ', fuel: 'diesel', fuelGrade: 'ДТ', norm: 30 },
      { id: 'diesel', plate: 'Р559НВ', make: 'УАЗ', org: 'A', object: 'УНГКМ', fuel: 'diesel', fuelGrade: 'ДТ', norm: 12 },
      { id: 'nng', plate: 'ННГ', make: 'УАЗ', org: 'A', object: 'ННГ', fuel: 'diesel', fuelGrade: 'ДТ' });
    data.fuelCards = [{ number: '444444', org: 'A', assignments: [{ vehicleId: 'diesel', from: '', to: '' }] }];
    data.fuelPurchases = [{ id: 'loaded1', importId: 'file1', importKey: 'original-key-1', date: '2026-09-02', time: '12:00', grade: 'ДТ', qty: 58, sum: 5800, cardNo: '444444', vehicleText: 'Из исходной выписки', sourceOrg: 'A', vehicleId: '' },
      { id: 'loaded2', importId: 'file1', importKey: 'original-key-2', date: '2026-09-03', grade: 'ДТ', qty: 40, sum: 4000, cardNo: '444444', sourceOrg: 'A', vehicleId: '' }];
    data.fuelImports = [{ id: 'file1', fileName: 'Report.xlsx' }]; rebuildIndex();
    fpMonth = ''; fpView = 'receipts'; gsmOrg = ''; gsmFuel = ''; switchSection('fuelPurchases');
  });
}

test('loaded statement opens all months and fuels TREKOL and another car from separate original operations', async () => {
  await openLoadedStatement();
  assert.equal(await page.getByRole('combobox', { name: 'Месяц', exact: true }).inputValue(), 'all');
  assert.equal(await page.locator('[data-purchase-id]').count(), 2);
  const first = page.locator('[data-purchase-id="loaded1"]');
  await first.getByRole('combobox', { name: 'Заправленная машина', exact: true }).selectOption('trekol');
  await first.getByRole('button', { name: 'Заправить', exact: true }).click();
  await page.locator('#gsmStatementCommit').click();
  await page.waitForFunction(() => data.fuelPurchases[0].vehicleId === 'trekol');
  const second = page.locator('[data-purchase-id="loaded2"]');
  await second.getByRole('combobox', { name: 'Заправленная машина', exact: true }).selectOption('diesel');
  await second.getByRole('spinbutton', { name: 'Литры операции', exact: true }).fill('45');
  await second.getByRole('button', { name: 'Заправить', exact: true }).click(); await page.locator('#gsmStatementCommit').click();
  await page.waitForFunction(() => data.fuelPurchases[1].vehicleId === 'diesel');
  const result = await page.evaluate(() => {
    const l = gsmBuildLedger(data, gsmMonthRange('2026-09'));
    return { count: data.fuelPurchases.length, keys: data.fuelPurchases.map(p => p.importKey),
      rows: l.rows.map(r => ({ car: r.vehicleId, org: r.org, issued: r.issued })),
      journal: data.records.filter(r => r.date.startsWith('2026-09')).map(r => ({ km: r.km, qty: r.fuelIssued })), disk: JSON.parse(window.__disk).fuelPurchases.length };
  });
  assert.equal(result.count, 2); assert.equal(result.disk, 2); assert.deepEqual(result.keys, ['original-key-1', 'original-key-2']);
  assert.ok(result.rows.some(r => r.car === 'trekol' && r.org === 'A' && r.issued === 58));
  assert.ok(result.rows.some(r => r.car === 'diesel' && r.issued === 45));
  assert.deepEqual(result.journal, [{ km: 0, qty: 58 }, { km: 0, qty: 45 }]);
  assert.match(await first.innerText(), /В журнале/);
  await first.getByRole('button', { name: 'Заправить', exact: true }).click(); await page.locator('#gsmStatementCommit').click();
  await page.waitForFunction(() => !document.getElementById('genericModal').classList.contains('open'));
  assert.equal(await page.evaluate(() => data.records.find(r => r.vehicleId === 'trekol').fuelIssued), 58);
});

test('loaded statement refuses cross-object assignment and retains input after a failed save', async () => {
  await openLoadedStatement(); const row = page.locator('[data-purchase-id="loaded1"]');
  await row.getByRole('combobox', { name: 'Заправленная машина', exact: true }).selectOption('nng');
  await row.getByRole('button', { name: 'Заправить', exact: true }).click(); assert.match(await row.locator('[data-row-error]').innerText(), /объект/);
  await row.getByRole('combobox', { name: 'Заправленная машина', exact: true }).selectOption('trekol');
  await row.getByRole('button', { name: 'Заправить', exact: true }).click();
  await page.evaluate(() => { window.electronAPI.writeData = async () => false; });
  await page.locator('#gsmStatementCommit').click(); await page.waitForFunction(() => document.getElementById('gsmStatementError').textContent.includes('Не записано'));
  assert.equal(await page.evaluate(() => data.fuelPurchases[0].vehicleId), '');
  assert.equal(await row.getByRole('combobox', { name: 'Заправленная машина', exact: true }).inputValue(), 'trekol');
  await page.evaluate(() => { window.electronAPI.writeData = async json => { window.__disk = json; return true; }; });
  await page.locator('#gsmStatementCommit').click(); await page.waitForFunction(() => data.fuelPurchases[0].vehicleId === 'trekol');
  assert.equal(await page.evaluate(() => data.fuelPurchases.length), 2);
});

test('loaded statement keeps row edits while changing organization and exposes invalid-date purchases for correction', async () => {
  await openLoadedStatement();
  await page.evaluate(() => { data.fuelPurchases.push({ id: 'bad-date', date: 'bad', qty: 12, grade: 'ДТ', sourceOrg: 'A' }); renderFuelPurchases(); });
  assert.equal(await page.locator('[data-purchase-id]').count(), 3);
  const row = page.locator('[data-purchase-id="loaded1"]');
  await row.getByRole('combobox', { name: 'Заправленная машина', exact: true }).selectOption('trekol');
  await row.getByRole('spinbutton', { name: 'Литры операции', exact: true }).fill('60');
  await page.getByRole('combobox', { name: 'Организация', exact: true }).selectOption('B');
  await page.getByRole('combobox', { name: 'Организация', exact: true }).selectOption('A');
  assert.equal(await row.getByRole('spinbutton', { name: 'Литры операции', exact: true }).inputValue(), '60');
  assert.equal(await row.getByRole('combobox', { name: 'Заправленная машина', exact: true }).inputValue(), 'trekol');
});

test('reimport keeps the allocated statement vehicle, date, litres and an explicitly corrected zero amount', async () => {
  await page.evaluate(() => {
    data.records = []; data.fuelPurchases = []; data.fuelImports = [];
    data.vehicles[0].object = 'УНГКМ';
    data.vehicles.push({ id: 'recipient', plate: 'А001АА716', make: 'Нива', org: 'A', object: 'УНГКМ', fuel: 'gasoline', fuelGrade: 'АИ-95' });
    data.fuelCards = [{ number: '111111', org: 'A', assignments: [{ vehicleId: 'v', from: '', to: '' }] }];
    rebuildIndex(); window.__importReport = null;
    showFuelImportReport = report => { window.__importReport = report; };
    window.__repeatStatementImport = async () => {
      window.__importReport = null;
      const rows = [['Дата транзакции', 'Тип транзакции', 'Количество', 'Товар', 'Комментарий', 'Номер карты', 'Сумма к оплате', 'Цена клиента'],
        ['01.09.2026 14:00', 'Покупка', 30, 'АИ-95', 'Х123АА716', '111111', 3000, 100]];
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
      importFuelFromXls({ files: [new File([XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })], 'repeat-statement.xlsx')], value: '' });
      for (let i = 0; i < 100 && !window.__importReport; i++) {
        document.getElementById('importPlanCommit')?.click();
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      if (!window.__importReport) throw Error('Statement import did not finish');
    };
  });
  await page.evaluate(() => window.__repeatStatementImport());
  const original = await page.evaluate(() => ({ id: data.fuelPurchases[0].id, source: data.fuelPurchases[0].sourceTransaction, key: data.fuelPurchases[0].importKeyV2 }));
  assert.equal(original.source.sum, 3000);
  await page.evaluate(() => fpEdit(data.fuelPurchases[0].id));
  await page.locator('#fpe_date').fill('03.09.2026');
  await page.locator('#fpe_vehicle').selectOption('recipient');
  await page.locator('#fpe_qty').fill('35');
  await page.locator('#fpe_sum').fill('0');
  await page.locator('#genericModal').getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.waitForFunction(() => data.fuelPurchases[0].vehicleId === 'recipient');
  await page.evaluate(() => window.__repeatStatementImport());
  const result = await page.evaluate(() => ({
    purchases: data.fuelPurchases.length,
    purchase: { id: data.fuelPurchases[0].id, vehicleId: data.fuelPurchases[0].vehicleId, date: data.fuelPurchases[0].date, qty: data.fuelPurchases[0].qty, sum: data.fuelPurchases[0].sum, price: data.fuelPurchases[0].price,
      source: data.fuelPurchases[0].sourceTransaction, key: data.fuelPurchases[0].importKeyV2 },
    issued: data.records.reduce((sum, record) => sum + (+record.fuelIssued || 0), 0),
    journalMoney: data.records.reduce((sum, record) => sum + (+record.fuelSum || 0), 0)
  }));
  assert.equal(result.purchases, 1);
  assert.deepEqual(result.purchase, { id: original.id, vehicleId: 'recipient', date: '2026-09-03', qty: 35, sum: 0, price: 0, source: original.source, key: original.key });
  assert.equal(result.issued, 35);
  assert.equal(result.journalMoney, 0);
});

test('manual statement links existing issued litres without changing mileage or odometers', async () => {
  await openManualStatement(); const before = await page.evaluate(() => JSON.stringify(data.records));
  await fillManualReceipt('2026-10-01', '30'); await reviewManualReceipt();
  assert.equal(await page.getByRole('combobox', { name: 'Запись в журнал 1', exact: true }).inputValue(), 'link:r1');
  await page.locator('#gsmManualCommit').click(); await page.waitForFunction(() => data.fuelPurchases.length === 1);
  assert.equal(await page.evaluate(() => JSON.stringify(data.records)), before);
  assert.equal(await page.evaluate(() => data.fuelPurchases[0].recordId), 'r1');
});

test('manual statement adds separate rows, keeps chosen grades and saves the batch once', async () => {
  await openManualStatement(); await fillManualReceipt();
  await page.getByRole('button', { name: '+ Строка', exact: true }).click();
  assert.equal(await page.getByRole('combobox', { name: 'Машина 2', exact: true }).evaluate(el => document.activeElement === el), true);
  assert.equal(await page.getByLabel('Дата 2', { exact: true }).inputValue(), '2026-10-03');
  await page.getByRole('combobox', { name: 'Машина 2', exact: true }).selectOption('v');
  await page.getByRole('combobox', { name: 'Топливо 2', exact: true }).selectOption('АИ-92');
  await page.getByRole('spinbutton', { name: 'Литры 2', exact: true }).fill('20');
  await reviewManualReceipt(); await page.locator('#gsmManualCommit').click(); await page.waitForFunction(() => data.fuelPurchases.length === 2);
  assert.deepEqual(await page.evaluate(() => data.fuelPurchases.map(p => ({ grade: p.grade, qty: p.qty }))), [{ grade: 'АИ-95', qty: 45.5 }, { grade: 'АИ-92', qty: 20 }]);
  assert.equal(await page.evaluate(() => data.records.length), 4);
});

test('failed manual batch persistence keeps typed rows and retry creates no duplicate purchases', async () => {
  await openManualStatement(); await fillManualReceipt(); await reviewManualReceipt();
  await page.evaluate(() => { window.electronAPI.writeData = async () => false; });
  await page.locator('#gsmManualCommit').click();
  await page.waitForFunction(() => document.getElementById('gsmManualReviewError').textContent.includes('Не записано'));
  assert.equal(await page.evaluate(() => data.fuelPurchases.length), 0);
  assert.equal(await page.getByRole('spinbutton', { name: 'Литры 1', exact: true }).inputValue(), '45.5');
  await page.evaluate(() => { window.electronAPI.writeData = async json => { window.__disk = json; return true; }; });
  await page.locator('#gsmManualCommit').click(); await page.waitForFunction(() => data.fuelPurchases.length === 1);
  assert.equal(await page.evaluate(() => data.records.length), 3);
});

test('saved manual receipt remains editable after failed persistence and removable without blocking later input', async () => {
  await openManualStatement(); await fillManualReceipt(); await reviewManualReceipt(); await page.locator('#gsmManualCommit').click();
  await page.waitForFunction(() => data.fuelPurchases.length === 1);
  await page.evaluate(() => { fpEdit(data.fuelPurchases[0].id); window.electronAPI.writeData = async () => false; });
  await page.locator('#fpe_qty').fill('50'); await page.locator('#genericModal').getByRole('button', { name: 'Сохранить', exact: true }).click();
  assert.equal(await page.locator('#genericModal').evaluate(el => el.classList.contains('open')), true);
  assert.equal(await page.locator('#fpe_qty').inputValue(), '50'); assert.equal(await page.evaluate(() => data.fuelPurchases[0].qty), 45.5);
  await page.evaluate(() => { window.electronAPI.writeData = async json => { window.__disk = json; return true; }; });
  await page.locator('#genericModal').getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.waitForFunction(() => data.fuelPurchases[0].qty === 50);
  assert.equal(await page.evaluate(() => data.records.find(r => r.id === data.fuelPurchases[0].recordId).fuelIssued), 50);
  await page.locator('#fpBody').getByRole('button', { name: 'Удалить', exact: true }).click();
  await page.locator('#fpd_reason').fill('Ошибочная ручная заправка'); await page.locator('#fpd_confirm').check(); await page.locator('#fpd_commit').click();
  await page.waitForFunction(() => data.fuelPurchases[0].deleted);
  await fillManualReceipt('2026-10-04', '10'); await reviewManualReceipt(); await page.locator('#gsmManualCommit').click();
  await page.waitForFunction(() => data.fuelPurchases.filter(p => !p.deleted).length === 1);
  assert.equal(await page.evaluate(() => data.records.length), 3);
});

test('manual review refuses stale data and concurrent server changes instead of auto-merging new receipts', async () => {
  await openManualStatement(); await fillManualReceipt(); await reviewManualReceipt();
  await page.evaluate(() => { data.vehicles[0].driver = 'Remote driver'; });
  await page.locator('#gsmManualCommit').click(); assert.match(await page.locator('#gsmManualReviewError').innerText(), /Данные изменились/);
  await page.locator('#genericModal').getByRole('button', { name: 'Назад', exact: true }).click(); await reviewManualReceipt();
  await page.evaluate(() => {
    _sync.enabled = true; _sync.revs = Object.fromEntries(SYNC_SECTIONS.map(n => [n, 1]));
    SYNC_SECTIONS.forEach(n => _sync.synced[n] = JSON.stringify(data[n] || [])); window.__mergeReads = 0;
    window.electronAPI.writeSections = async () => ({ ok: false, conflicts: ['fuelPurchases'] });
    window.electronAPI.readSection = async () => { window.__mergeReads++; return { rev: 2, rows: [] }; };
  });
  await page.locator('#gsmManualCommit').click(); await page.waitForFunction(() => document.getElementById('gsmManualReviewError').textContent.includes('Не записано'));
  assert.equal(await page.evaluate(() => window.__mergeReads), 0); assert.equal(await page.evaluate(() => data.fuelPurchases.length), 0);
});

async function openPreciseHistoricalPurchase() {
  await page.evaluate(() => {
    data.vehicles[0].object = 'Site';
    data.records = [{ id: 'precise-r', vehicleId: 'v', date: '2026-09-01', fuelGrade: 'АИ-95', fuelIssued: 55.563, fuelSum: 5000.34,
      km: 123, odoStart: 1000, odoEnd: 1123, fuelActual: 17.256, tankMeasured: 138.307, note: 'Original journal' }];
    data.fuelPurchases = [{ id: 'precise-p', recordId: 'precise-r', vehicleId: 'v', date: '2026-09-01', grade: 'АИ-95', product: 'АИ-95',
      qty: 45.562, sum: 4556.2, price: 100, cardNo: '111111', sourceOrg: 'A', restored: true,
      sourceTransaction: { qty: 45.562, sum: 4556.2, product: 'АИ-95' } }];
    data.fuelCards = [{ number: '111111', org: 'A', assignments: [{ vehicleId: 'v', from: '', to: '' }] }];
    rebuildIndex(); _lastPersisted = JSON.stringify(data); fpEdit('precise-p');
  });
}

test('historical comment form preserves millilitres, measured stock, actual consumption and restoration provenance', async () => {
  await openPreciseHistoricalPurchase(); const before = await page.evaluate(() => JSON.stringify(data.records));
  assert.equal(await page.locator('#fpe_qty').getAttribute('step'), '0.001'); assert.equal(await page.locator('#fpe_sum').getAttribute('step'), '0.01');
  await page.locator('#fpe_comment').fill('Сверено с оригиналом'); await page.locator('#fpe_save').click();
  await page.waitForFunction(() => !document.getElementById('genericModal').classList.contains('open'));
  assert.equal(await page.evaluate(() => JSON.stringify(data.records)), before);
  assert.deepEqual(await page.evaluate(() => ({ qty: data.fuelPurchases[0].qty, restored: data.fuelPurchases[0].restored,
    sourceQty: data.fuelPurchases[0].sourceTransaction.qty })), { qty: 45.562, restored: true, sourceQty: 45.562 });
});

test('explicit historical organization correction requires a reason and retains all inputs across failed persistence', async () => {
  await openPreciseHistoricalPurchase(); await page.locator('#fpe_org').fill('B'); await page.locator('#fpe_correct_org').check();
  assert.equal(await page.locator('#fpe_org_reason').isEnabled(), true);
  await page.locator('#fpe_save').click(); assert.equal(await page.evaluate(() => data.fuelPurchases[0].sourceOrg), 'A');
  assert.equal(await page.locator('#genericModal').evaluate(el => el.classList.contains('open')), true);
  await page.locator('#fpe_org_reason').fill('Организация B в первичном документе'); await page.locator('#fpe_qty').fill('45.564');
  await page.evaluate(() => { window.electronAPI.writeData = async () => false; }); await page.locator('#fpe_save').click();
  await page.waitForFunction(() => !fpEditSaving);
  assert.equal(await page.locator('#fpe_qty').inputValue(), '45.564'); assert.equal(await page.locator('#fpe_org_reason').inputValue(), 'Организация B в первичном документе');
  assert.deepEqual(await page.evaluate(() => ({ qty: data.fuelPurchases[0].qty, org: data.fuelPurchases[0].sourceOrg })), { qty: 45.562, org: 'A' });
  await page.evaluate(() => { window.electronAPI.writeData = async json => { window.__disk = json; return true; }; }); await page.locator('#fpe_save').click();
  await page.waitForFunction(() => !document.getElementById('genericModal').classList.contains('open'));
  assert.deepEqual(await page.evaluate(() => ({ qty: data.fuelPurchases[0].qty, org: data.fuelPurchases[0].sourceOrg, history: data.fuelPurchases[0].sourceOrgCorrections.length,
    issued: data.records[0].fuelIssued, km: data.records[0].km, measured: data.records[0].tankMeasured, actual: data.records[0].fuelActual,
    sourceQty: data.fuelPurchases[0].sourceTransaction.qty })),
    { qty: 45.564, org: 'B', history: 1, issued: 55.565, km: 123, measured: 138.307, actual: 17.256, sourceQty: 45.562 });
});

test('confirmed redundant purchase deletion previews and preserves correct journal after failure and retry', async () => {
  await openPreciseHistoricalPurchase(); const before = await page.evaluate(() => JSON.stringify(data.records));
  await page.evaluate(() => {
    data.fuelPurchases.push({ ...data.fuelPurchases[0], id: 'correct-original', restored: false });
    _lastPersisted = JSON.stringify(data); fpDelete('precise-p');
  }); await page.locator('#fpd_mode').selectOption('keep');
  assert.match(await page.locator('#fpd_preview').innerText(), /55,563 → 55,563/);
  await page.locator('#fpd_reason').fill('Лишняя восстановленная строка, оригинал проверен'); await page.locator('#fpd_confirm').check();
  await page.evaluate(() => { window.electronAPI.writeData = async () => false; }); await page.locator('#fpd_commit').click();
  await page.waitForFunction(() => document.getElementById('fpd_error').textContent.includes('Не записано'));
  assert.equal(await page.evaluate(() => JSON.stringify(data.records)), before); assert.equal(await page.evaluate(() => data.fuelPurchases[0].deleted), undefined);
  assert.equal(await page.locator('#fpd_mode').inputValue(), 'keep');
  await page.evaluate(() => { window.electronAPI.writeData = async json => { window.__disk = json; return true; }; }); await page.locator('#fpd_commit').click();
  await page.waitForFunction(() => data.fuelPurchases[0].deleted);
  assert.equal(await page.evaluate(() => JSON.stringify(data.records)), before);
  assert.equal(await page.evaluate(() => data.fuelPurchases[0].deletion.mode), 'preserve-journal');
});

test('old purchase modal refuses to overwrite changed quantities from a newer snapshot', async () => {
  await openPreciseHistoricalPurchase(); await page.locator('#fpe_comment').fill('Комментарий из старой формы');
  await page.evaluate(() => { data.fuelPurchases[0].qty = 50.564; data.records[0].fuelIssued = 60.565; window.__preciseWrites = 0;
    window.electronAPI.writeData = async () => { window.__preciseWrites++; return true; }; });
  await page.locator('#fpe_save').click();
  assert.deepEqual(await page.evaluate(() => ({ qty: data.fuelPurchases[0].qty, issued: data.records[0].fuelIssued, writes: window.__preciseWrites })),
    { qty: 50.564, issued: 60.565, writes: 0 });
  assert.equal(await page.locator('#fpe_comment').inputValue(), 'Комментарий из старой формы');
  assert.equal(await page.locator('#genericModal').evaluate(el => el.classList.contains('open')), true);
});
test('note-only edit preserves manually stored normative fuel and zero mileage', async () => {
  const out = await page.evaluate(async () => {
    openEditRecord('r1'); document.getElementById('rec_note').value = 'Note'; await saveRecord(); const norm = data.records[0].fuelUsed;
    data.records[1].km = 0; openEditRecord('r2'); const field = document.getElementById('rec_km').value;
    document.getElementById('rec_note').value = 'Zero note'; await saveRecord(); return { norm, field, note: data.records[1].note };
  }); assert.deepEqual(out, { norm: 12, field: '0', note: 'Zero note' });
});
test('failed record save retains form input, rolls back memory and does not replace backup', async () => {
  const out = await page.evaluate(async () => {
    const disk = window.__disk, cached = localStorage.getItem(STORAGE_KEY);
    window.electronAPI.writeData = async () => false; openEditRecord('r1'); document.getElementById('rec_note').value = 'Retry'; await saveRecord();
    await new Promise(r => setTimeout(r, 20));
    return { open: document.getElementById('recordModal').classList.contains('open'), field: document.getElementById('rec_note').value,
      savedInMemory: data.records[0].note === 'Retry', diskUnchanged: disk === window.__disk, backupUnchanged: cached === localStorage.getItem(STORAGE_KEY) };
  }); assert.deepEqual(out, { open: true, field: 'Retry', savedInMemory: false, diskUnchanged: true, backupUnchanged: true });
});
test('failed creation can be retried without making duplicate records', async () => {
  const out = await page.evaluate(async () => {
    window.electronAPI.writeData = async () => false; openAddRecord(); document.getElementById('rec_date').value = '03.10.2026'; document.getElementById('rec_km').value = '0'; await saveRecord();
    const countAfterFailure = data.records.length; window.electronAPI.writeData = async json => { window.__disk = json; return true; }; await saveRecord();
    return { countAfterFailure, countAfterRetry: data.records.length };
  }); assert.deepEqual(out, { countAfterFailure: 2, countAfterRetry: 3 });
});
test('invalid date, negative distance and inconsistent edited odometer are rejected', async () => {
  const out = await page.evaluate(async () => {
    const before = JSON.stringify(data.records); openEditRecord('r1'); document.getElementById('rec_date').value = '31.02.2026'; await saveRecord(); const dateOk = before === JSON.stringify(data.records);
    document.getElementById('rec_date').value = '01.10.2026'; document.getElementById('rec_km').value = '-1'; await saveRecord(); const negativeOk = before === JSON.stringify(data.records);
    document.getElementById('rec_km').value = '100'; document.getElementById('rec_odo_end').value = '900'; await saveRecord();
    return { dateOk, negativeOk, odoOk: before === JSON.stringify(data.records) };
  }); assert.deepEqual(out, { dateOk: true, negativeOk: true, odoOk: true });
});
test('custom delete confirmation does not freeze later edits; cancellation and Escape resolve', async () => {
  await page.evaluate(() => { window.__deletion = deleteRecord('r1'); });
  await page.locator('#confirmNo').click(); await page.evaluate(() => window.__deletion);
  assert.equal(await page.evaluate(() => data.records.length), 2);
  await page.evaluate(() => { window.__deletion = deleteRecord('r1'); }); await page.keyboard.press('Escape'); await page.evaluate(() => window.__deletion);
  await page.evaluate(() => { window.__deletion = deleteRecord('r1'); }); await page.locator('#confirmYes').click(); await page.evaluate(() => window.__deletion);
  const out = await page.evaluate(async () => { openEditRecord('r2'); document.getElementById('rec_note').value = 'After deletion'; await saveRecord(); return { count: data.records.length, note: data.records[0].note }; });
  assert.deepEqual(out, { count: 1, note: 'After deletion' });
});
test('bulk deletion respects closed months without changing any record', async () => {
  const out = await page.evaluate(async () => {
    data.fuelPeriods = [{ month: '2026-10', closed: true }]; const before = JSON.stringify(data.records);
    const cb = document.createElement('input'); Object.assign(cb, { type: 'checkbox', checked: true, className: 'rec-check' }); cb.dataset.recid = 'r1'; document.body.append(cb);
    await recDeleteSelected(); return before === JSON.stringify(data.records);
  }); assert.equal(out, true);
});
test('polling defers while a form is open and field-wise conflict merge preserves remote mileage', async () => {
  const out = await page.evaluate(async () => {
    _sync.enabled = true; _sync.revs = { records: 1 }; SYNC_SECTIONS.forEach(n => _sync.synced[n] = JSON.stringify(data[n] || []));
    const remote = data.records.map(r => r.id === 'r1' ? { ...r, km: 200, odoEnd: 1200 } : { ...r }); let writes = 0;
    window.electronAPI.getRevisions = async () => ({ records: 2 }); window.electronAPI.readSection = async () => ({ rev: 2, rows: remote });
    window.electronAPI.writeSections = async json => { writes++; return writes === 1 ? { ok: false, conflicts: ['records'] } : { ok: true, revisions: { records: 3 } }; };
    openEditRecord('r1'); await syncPoll(); const whileEditing = data.records[0].km;
    document.getElementById('rec_note').value = 'Note only'; await saveRecord(); _sync.enabled = false;
    return { whileEditing, after: data.records[0].km, note: data.records[0].note, norm: data.records[0].fuelUsed };
  }); assert.deepEqual(out, { whileEditing: 100, after: 200, note: 'Note only', norm: 12 });
});
test('retry after a failed conflict merge retains the original baseline and preserves remote fields', async () => {
  const out = await page.evaluate(async () => {
    _sync.enabled = true; _sync.revs = Object.fromEntries(SYNC_SECTIONS.map(n => [n, 1]));
    SYNC_SECTIONS.forEach(n => _sync.synced[n] = JSON.stringify(data[n] || []));
    const remote = data.records.map(r => r.id === 'r1' ? { ...r, km: 200, odoEnd: 1200 } : { ...r });
    window.electronAPI.readSection = async () => ({ rev: 2, rows: remote });
    let attempts = 0;
    window.electronAPI.writeSections = async json => {
      attempts++; const payload = JSON.parse(json);
      if (payload.base.records === 1) return { ok: false, conflicts: ['records'] };
      if (attempts === 2) return { ok: false, error: 'offline' };
      return { ok: true, revisions: { records: 3 } };
    };
    openEditRecord('r1'); document.getElementById('rec_note').value = 'Retried note'; await saveRecord();
    const revisionAfterFailure = _sync.revs.records, stayedOpen = document.getElementById('recordModal').classList.contains('open');
    await saveRecord(); _sync.enabled = false;
    return { revisionAfterFailure, stayedOpen, km: data.records[0].km, note: data.records[0].note };
  }); assert.deepEqual(out, { revisionAfterFailure: 1, stayedOpen: true, km: 200, note: 'Retried note' });
});
test('payments, budget and counterparties are persisted immediately and survive reload', async () => {
  const out = await page.evaluate(async () => {
    openAddContragent(); document.getElementById('caName').value = 'Company'; await saveContragent();
    await openAddPayment(); document.getElementById('pay_date').value = '01.10.2026'; document.getElementById('pay_description').value = 'Payment'; document.getElementById('pay_sum').value = '1234'; await savePayment();
    finView = 'budget'; renderFinancesSection(); document.getElementById('budg_company').value = 'Company'; document.getElementById('budg_sum').value = '1234'; await addBudgetEntry();
    data = await loadData(); return { payments: data.payments.length, budget: data.budget.length, contragents: data.contragents.length };
  }); assert.deepEqual(out, { payments: 1, budget: 1, contragents: 1 });
});
test('an unrelated save never advances revisions of sections that were not read', async () => {
  const out = await page.evaluate(async () => {
    _sync.enabled = true; _sync.revs = Object.fromEntries(SYNC_SECTIONS.map(n => [n, 1]));
    SYNC_SECTIONS.forEach(n => _sync.synced[n] = JSON.stringify(data[n] || []));
    window.electronAPI.writeSections = async () => ({ ok: true, revisions: { vehicles: 2, records: 99 } });
    data.vehicles[0].make = 'Changed'; await saveData(data); _sync.enabled = false;
    return { vehicles: _sync.revs.vehicles, records: _sync.revs.records };
  }); assert.deepEqual(out, { vehicles: 2, records: 1 });
});
test('an older form preserves fields refreshed after opening it', async () => {
  const out = await page.evaluate(async () => {
    openEditRecord('r1'); data.records[0].km = 200; data.records[0].odoEnd = 1200;
    document.getElementById('rec_note').value = 'Only note'; await saveRecord();
    return { km: data.records[0].km, odoEnd: data.records[0].odoEnd, note: data.records[0].note };
  }); assert.deepEqual(out, { km: 200, odoEnd: 1200, note: 'Only note' });
});
test('period balance includes opening stock and all previous movements', async () => {
  const out = await page.evaluate(() => {
    data.records = [{ id: 'a', vehicleId: 'v', date: '2026-09-01', fuelActual: 10 }, { id: 'b', vehicleId: 'v', date: '2026-10-01', fuelIssued: 30, fuelActual: 10 }]; rebuildIndex();
    return computeFuelBalances('v', '2026-10-01', '2026-10-31').b;
  }); assert.equal(out, 110);
});
test('generator zero values are retained and both balance calculations agree', async () => {
  const out = await page.evaluate(async () => {
    data.generators = [{ id: 'g', name: 'Generator', power: 100, norm100: 10, norm50: 6, normIdle: 2 }];
    data.genRecords = [{ id: 'gr', generatorId: 'g', date: '2026-10-01', hours: 10, load: 50, fuelActual: 0, fuelIssued: 100 }]; selectedGeneratorId = 'g'; rebuildIndex();
    openEditGenRecord('gr'); await saveGenRecord(); const zero = data.genRecords[0].fuelActual;
    delete data.genRecords[0].fuelActual; rebuildIndex(); return { zero, journal: computeGenFuelBalances('g').gr, act: computeGenBalanceAt('g', '2026-10-31', true) };
  }); assert.deepEqual(out, { zero: 0, journal: 40, act: 40 });
});
test('changing a generator tank preserves its previous source without changing quantities', async () => {
  const out = await page.evaluate(async () => {
    data.tanks = [{ id: 'a', name: 'A', balanceInit: 1000 }, { id: 'b', name: 'B', balanceInit: 1000 }];
    data.generators = [{ id: 'g', name: 'Generator', location: 'Object', tankId: 'a' }]; data.genRecords = [{ id: 'gr', generatorId: 'g', date: '2026-09-01', hours: 1, fuelIssued: 100 }]; rebuildIndex();
    selectedGeneratorId = 'g'; openEditGenerator('g'); document.getElementById('gm_tank').value = 'b'; await saveGenerator();
    return { source: data.genRecords[0].tankId, qty: data.genRecords[0].fuelIssued, a: computeTankBalance('a').balance, b: computeTankBalance('b').balance };
  }); assert.deepEqual(out, { source: 'a', qty: 100, a: 900, b: 1000 });
});
test('ambiguous manual fuel is reported for review, not mislabeled duplicate or silently changed', async () => {
  const out = await page.evaluate(async () => {
    data.records = [{ id: 'r', vehicleId: 'v', date: '2026-10-01', km: 0, fuelIssued: 40, fuelGrade: 'АИ-95', note: 'заправка: 40л' }];
    data.fuelCards = [{ id: 'fc', number: '123456', org: 'A', status: 'active', assignments: [{ vehicleId: 'v' }] }]; rebuildIndex();
    window.__report = null; showFuelImportReport = r => { window.__report = r; };
    const rows = [['Дата транзакции','Тип транзакции','Количество','Товар','Комментарий','Номер карты'], ['01.10.2026 14:00','Покупка',30,'АИ-95','Х123АА716','123456']];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
    importFuelFromXls({ files: [new File([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], 'test.xlsx')], value: '' });
    for (let i = 0; i < 100 && !window.__report; i++) { document.getElementById('importPlanCommit')?.click(); await new Promise(r => setTimeout(r, 20)); }
    return { issued: data.records[0].fuelIssued, purchase: data.fuelPurchases[0].qty, action: window.__report.reportRows[0].action, duplicates: window.__report.duplicates };
  }); assert.deepEqual(out, { issued: 40, purchase: 30, action: 'review', duplicates: 0 });
});
test('counterparty table shows actual document count and amount', async () => {
  const out = await page.evaluate(() => {
    data.contragents = [{ id: 'c', name: 'Company' }]; data.payments = [{ id: 'p', sum: 1234, contragent: 'Company' }]; renderContragentsSection();
    const cells=document.querySelector('#mainContent tbody tr').cells;
    return [cells[5].textContent,cells[6].textContent].map(value=>value.replace(/\D/g,''));
  }); assert.deepEqual(out, ['1', '1234']);
});
test('a distinct equal-volume purchase is added when previous journal litres are already accounted for', async () => {
  const out = await page.evaluate(async () => {
    data.records = [{ id: 'r', vehicleId: 'v', date: '2026-10-01', km: 0, fuelIssued: 40, fuelGrade: 'АИ-95', note: 'заправка: 40л' }];
    data.fuelPurchases = [{ id: 'old', vehicleId: 'v', recordId: 'r', date: '2026-10-01', qty: 40, cardNo: '111111', grade: 'АИ-95', sourceOrg: 'A', importKey: 'old-operation' }];
    data.fuelCards = [{ id: 'fc', number: '222222', org: 'A', status: 'active', assignments: [{ vehicleId: 'v' }] }]; rebuildIndex();
    window.__report = null; showFuelImportReport = r => { window.__report = r; };
    const rows = [['Дата транзакции','Тип транзакции','Количество','Товар','Комментарий','Номер карты'], ['01.10.2026 15:00','Покупка',40,'АИ-95','Х123АА716','222222']];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
    importFuelFromXls({ files: [new File([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], 'new.xlsx')], value: '' });
    for (let i = 0; i < 100 && !window.__report; i++) { document.getElementById('importPlanCommit')?.click(); await new Promise(r => setTimeout(r, 20)); }
    return { issued: data.records[0].fuelIssued, purchases: data.fuelPurchases.length, action: window.__report.reportRows[0].action };
  }); assert.deepEqual(out, { issued: 80, purchases: 2, action: 'updated' });
});
test('untrusted counterparties and vehicle text stay literal and cannot execute handlers', async () => {
  const out = await page.evaluate(async () => {
    window.__bad = 0; const attack = '<img src="bad" onerror="window.__bad=1">';
    data.contragents = [{ id: 'c', name: attack, note: attack, inn: attack, phone: attack, category: attack, contact: attack }]; renderContragentsSection();
    await new Promise(r => setTimeout(r, 50)); const company = document.getElementById('mainContent').querySelectorAll('img').length;
    for (const f of ['plate','make','driver','org','status','responsible','object','note']) data.vehicles[0][f] = attack;
    renderVehicleCards(); await new Promise(r => setTimeout(r, 50)); const cards = document.getElementById('mainContent').querySelectorAll('img').length;
    renderDetail(data.vehicles[0]); await new Promise(r => setTimeout(r, 50));
    return { company, cards, executed: window.__bad, detail: document.getElementById('mainContent').querySelectorAll('img').length };
  }); assert.deepEqual(out, { company: 0, cards: 0, executed: 0, detail: 0 });
});
