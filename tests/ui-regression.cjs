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
test('text drag outside a form keeps it open; a genuine backdrop click closes it', async () => {
  await page.evaluate(() => { openEditRecord('r1'); document.getElementById('rec_note').value = 'Unsaved selected text'; });
  const f = await page.locator('#rec_note').boundingBox(), m = await page.locator('#recordModal .modal').boundingBox();
  await page.mouse.move(f.x + 12, f.y + 12); await page.mouse.down(); await page.mouse.move(m.x - 20, f.y + 12, { steps: 12 }); await page.mouse.up();
  assert.equal(await page.locator('#recordModal').evaluate(el => el.classList.contains('open')), true);
  assert.equal(await page.locator('#rec_note').inputValue(), 'Unsaved selected text');
  await page.mouse.click(5, 5); assert.equal(await page.locator('#recordModal').evaluate(el => el.classList.contains('open')), false);
});
test('dynamic generic forms also survive text selection beyond their bounds', async () => {
  await page.evaluate(() => openGenericModal('Test', '<textarea id="genericText">Selected text</textarea>'));
  const f = await page.locator('#genericText').boundingBox(), m = await page.locator('#genericModal .modal').boundingBox();
  await page.mouse.move(f.x + 10, f.y + 10); await page.mouse.down(); await page.mouse.move(m.x - 10, f.y + 10, { steps: 10 }); await page.mouse.up();
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
    for (let i = 0; i < 100 && !window.__report; i++) await new Promise(r => setTimeout(r, 20));
    return { issued: data.records[0].fuelIssued, purchase: data.fuelPurchases[0].qty, action: window.__report.reportRows[0].action, duplicates: window.__report.duplicates };
  }); assert.deepEqual(out, { issued: 40, purchase: 30, action: 'review', duplicates: 0 });
});
test('counters show actual totals without animation', async () => {
  const out = await page.evaluate(() => {
    data.contragents = [{ id: 'c', name: 'Company' }]; data.payments = [{ id: 'p', sum: 1234, contragent: 'Company' }]; renderContragentsSection();
    return [...document.querySelectorAll('.counter')].map(el => el.textContent.replace(/\D/g, ''));
  }); assert.deepEqual(out, ['1', '1', '1234']);
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
    for (let i = 0; i < 100 && !window.__report; i++) await new Promise(r => setTimeout(r, 20));
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
