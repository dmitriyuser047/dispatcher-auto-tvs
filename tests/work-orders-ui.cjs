const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
let pw;
try { pw = require('playwright'); } catch { pw = createRequire(path.join(process.env.TVS_PLAYWRIGHT_MODULES || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'), 'package.json'))('playwright'); }
let browser, page, errors;
before(async () => {
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await pw.chromium.launch({ headless: true, executablePath: process.env.TVS_TEST_BROWSER || (!process.env.CI && fs.existsSync(edge) ? edge : undefined) });
});
after(async () => { await browser?.close(); });
beforeEach(async () => {
  errors = []; page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
  await page.addInitScript(() => {
    const db = { vehicles: [{ id: 'v', plate: 'А001АА716', make: 'Нива', fuel: 'gasoline', fuelGrade: 'АИ-95', norm: 10, fuelBalance: 50 }],
      generators: [{ id: 'g', name: 'ДЭС-1', fuelBalance: 100 }], records: [], genRecords: [], vehicleTo: [], toRecords: [], repairs: [], payments: [],
      tanks: [], tankIncomes: [], contragents: [], budget: [], fuelCards: [], fuelPurchases: [], fuelImports: [], monthlyFuel: [], fuelPeriods: [], appMeta: [{ id: 'meta', toPlanInit: 'test' }] };
    window.__disk = JSON.stringify(db);
    window.electronAPI = { readData: async () => window.__disk, writeData: async json => { window.__disk = json; return true; } };
  });
  await page.goto(pathToFileURL(path.join(__dirname, '../index.html')).href);
  await page.waitForFunction(() => typeof woOpen === 'function' && typeof data !== 'undefined' && data.vehicles?.length === 1);
  await page.evaluate(() => { toAutoSetupOnce = async () => {}; });
});
afterEach(async () => { await page?.close(); assert.deepEqual(errors, []); });

test('repair work order progresses to completion and linked partial settlements update the source', async () => {
  const order = await page.evaluate(async () => {
    switchSection('vehicles'); selectVehicle('v'); openAddRepair('v');
    document.getElementById('rp_invoice_date').value = '01.10.2026'; document.getElementById('rp_description').value = 'Замена насоса';
    document.getElementById('rp_cost').value = '100'; document.getElementById('rp_wo_serviceCenter').value = 'СТО';
    document.getElementById('rp_wo_materials').value = '<img src=x onerror=alert(1)>'; document.getElementById('rp_wo_paymentDueDate').value = '2026-10-02';
    await saveRepair(); const r = data.repairs[0]; await woSetStatus('repairs', r.id, 'in_progress');
    return { id: r.id, status: r.workStatus, service: r.serviceCenter, downtimeStart: r.downtimeStart, images: document.querySelectorAll('#genericModalBody img').length };
  });
  assert.equal(order.status, 'in_progress'); assert.equal(order.service, 'СТО'); assert.ok(order.downtimeStart); assert.equal(order.images, 0);
  await page.evaluate(async id => { await woEnsurePayment('repairs', id); }, order.id);
  await page.waitForSelector('#paymentModal.open #pay_paid_amount');
  const paymentId = await page.evaluate(() => data.payments[0].id);
  const first = await page.evaluate(async id => {
    woPaymentDialog(id); document.getElementById('wo_settlement_amount').value = '40'; await woSaveSettlement(id);
    return { paid: data.repairs[0].paid, amount: data.payments[0].paidAmount, balance: woPaymentBalance(data.payments[0]), entries: data.payments[0].settlements.length };
  }, paymentId);
  assert.deepEqual(first, { paid: false, amount: 40, balance: 60, entries: 1 });
  await page.waitForSelector('#paymentModal.open #pay_paid_amount');
  const last = await page.evaluate(async id => {
    woPaymentDialog(id); document.getElementById('wo_settlement_amount').value = '60'; await woSaveSettlement(id);
    await woSetStatus('repairs', data.repairs[0].id, 'completed');
    return { paid: data.repairs[0].paid, invoicePaid: data.payments[0].paid, amount: data.payments[0].paidAmount,
      status: data.repairs[0].workStatus, end: data.repairs[0].downtimeEnd, start: data.repairs[0].downtimeStart };
  }, paymentId);
  assert.equal(last.paid, true); assert.equal(last.invoicePaid, true); assert.equal(last.amount, 100); assert.equal(last.status, 'completed'); assert.equal(last.end, last.start);
});

test('source cost changes show invoice discrepancies, retain links, and prevent dangling deletion', async () => {
  const result = await page.evaluate(async () => {
    data.repairs.push({ id: 'r', vehicleId: 'v', invoiceDate: '2026-10-01', description: 'Ремонт', cost: 100, paid: false });
    data.payments.push(woInvoiceFromSource(data, 'repairs', 'r', 'p', todayIso())); rebuildIndex();
    openEditRepair('r'); document.getElementById('rp_cost').value = '150'; await saveRepair();
    const state = woPaymentState(data.payments[0], data, todayIso());
    await deleteRepair('r');
    switchSection('finances'); finPaidFilter = 'mismatch'; renderFinancesSection();
    return { mismatch: state.amountMismatch, invoice: data.payments[0].sum, cost: data.repairs[0].cost, count: data.repairs.length,
      text: document.getElementById('mainContent').textContent, source: data.payments[0].sourceId };
  });
  assert.equal(result.mismatch, true); assert.equal(result.invoice, 100); assert.equal(result.cost, 150); assert.equal(result.count, 1); assert.equal(result.source, 'r');
  assert.match(result.text, /Сумма заявки/);
});

test('generator maintenance and schedule forms persist work fields and preserve maintenance intervals', async () => {
  const result = await page.evaluate(async () => {
    selectedGeneratorId = 'g'; openAddToRecord('g'); document.getElementById('to_type').value = 'Масло';
    document.getElementById('to_hours').value = '100'; document.getElementById('to_next_hours').value = '250'; document.getElementById('to_cost').value = '0';
    document.getElementById('to_wo_serviceCenter').value = 'Энерго'; await saveToRecord();
    const id = data.toRecords[0].id; tssEditRecord(id, 'toRecords'); document.getElementById('tss_wo_workStatus').value = 'completed'; await tssSaveRecord();
    tssOpenAdd();
    return { record: data.toRecords[0], enabled: !document.getElementById('tss_obj_type').disabled };
  });
  assert.equal(result.record.workStatus, 'completed'); assert.equal(result.record.planned, false); assert.equal(result.record.serviceCenter, 'Энерго');
  assert.equal(result.record.nextHours, 250); assert.equal(result.record.nextHoursAbs, 350); assert.equal(result.record.cost, 0); assert.equal(result.enabled, true);
});

test('invalid downtime and excessive partial payment do not change persisted data', async () => {
  const result = await page.evaluate(async () => {
    data.repairs.push({ id: 'r', vehicleId: 'v', invoiceDate: '2026-10-01', description: 'Ремонт', cost: 100 }); rebuildIndex();
    openEditRepair('r'); document.getElementById('rp_wo_downtimeStart').value = '2026-10-18'; document.getElementById('rp_wo_downtimeEnd').value = '2026-10-01';
    const before = JSON.stringify(data); await saveRepair(); const orderUnchanged = JSON.stringify(data) === before;
    data.payments.push(woInvoiceFromSource(data, 'repairs', 'r', 'p', todayIso())); await openEditPayment('p');
    document.getElementById('pay_paid_amount').value = '200'; const prior = JSON.stringify(data); await savePayment();
    return { orderUnchanged, paymentUnchanged: prior === JSON.stringify(data), repairOpen: document.getElementById('repairModal').classList.contains('open'), invoiceOpen: document.getElementById('paymentModal').classList.contains('open') };
  });
  assert.deepEqual(result, { orderUnchanged: true, paymentUnchanged: true, repairOpen: true, invoiceOpen: true });
});

test('stale work and payment forms preserve refreshed fields and refuse competing edits of the same field', async () => {
  const result = await page.evaluate(async () => {
    data.repairs.push({ id: 'r', vehicleId: 'v', invoiceDate: '2026-10-01', description: 'Ремонт', cost: 100, serviceCenter: 'Старый сервис' }); rebuildIndex();
    openEditRepair('r'); data.repairs[0].cost = 150; data.repairs[0].serviceCenter = 'Новый сервис';
    document.getElementById('rp_description').value = 'Мои работы'; await saveRepair();
    const preserved = { cost: data.repairs[0].cost, service: data.repairs[0].serviceCenter, description: data.repairs[0].description };
    openEditRepair('r'); document.getElementById('rp_cost').value = '180'; data.repairs[0].cost = 200;
    const before = JSON.stringify(data); await saveRepair(); const refused = JSON.stringify(data) === before;
    closeModal('repairModal'); data.payments.push(woInvoiceFromSource(data, 'repairs', 'r', 'p', todayIso()));
    await openEditPayment('p'); data.payments[0].sum = 250; data.payments[0].dueDate = '2026-11-01';
    document.getElementById('pay_note').value = 'Мой комментарий'; await savePayment();
    return { preserved, refused, sum: data.payments[0].sum, due: data.payments[0].dueDate, note: data.payments[0].note, source: data.payments[0].sourceId };
  });
  assert.deepEqual(result.preserved, { cost: 150, service: 'Новый сервис', description: 'Мои работы' });
  assert.equal(result.refused, true); assert.equal(result.sum, 250); assert.equal(result.due, '2026-11-01'); assert.equal(result.note, 'Мой комментарий'); assert.equal(result.source, 'r');
});
