const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { pathToFileURL } = require('node:url'), { createRequire } = require('node:module');
let pw;
try { pw = require('playwright'); }
catch { pw = createRequire(path.join(process.env.TVS_PLAYWRIGHT_MODULES || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'), 'package.json'))('playwright'); }
let browser, page, errors;
before(async () => {
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await pw.chromium.launch({ headless:true, executablePath:process.env.TVS_TEST_BROWSER || (!process.env.CI && fs.existsSync(edge) ? edge : undefined) });
});
after(async () => { await browser?.close(); });
beforeEach(async () => {
  page = await browser.newPage({ viewport:{ width:1280, height:900 } });
  errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.addInitScript(() => {
    const db = {
      vehicles:[{ id:'engine-v', plate:'ТЕСТ001', make:'Тест', org:'Тестовая организация', fuel:'diesel', fuelGrade:'ДТ', norm:10 }],
      records:[{ id:'engine-r', vehicleId:'engine-v', date:'2026-10-18', km:100, fuelActual:10 }],
      generators:[], genRecords:[],
      costEntries:[{ id:'engine-expense', assetRef:'v:engine-v', date:'2026-10-18', kind:'expense', amount:100, title:'Тестовый расход', independent:true }],
      tanks:[{ id:'engine-t', name:'Тестовая ёмкость', balanceInit:100, reserveLevel:20 }],
      procurementRules:[{ id:'engine-rule', kind:'tank', itemId:'engine-t', leadDays:2, coverDays:7, reserveQty:20, expectedDaily:10 }],
      appMeta:[{ id:'meta', toPlanInit:'test' }]
    };
    window.__disk = JSON.stringify(db); window.__writes = 0;
    window.electronAPI = {
      readData:async () => window.__disk,
      writeData:async json => { window.__writes++; window.__disk = json; return true; }
    };
  });
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  await page.waitForFunction(() => typeof dispatcherQuery === 'function' && typeof data !== 'undefined' && data.vehicles[0]?.id === 'engine-v');
});
afterEach(async () => { await page?.close(); assert.deepEqual(errors, []); });

test('cost workspace uses fresh isolated calculations after an in-place journal and expense edit', async () => {
  const result = await page.evaluate(() => {
    costPeriodFrom = '2026-10-01'; costPeriodTo = '2026-10-31'; switchSection('costs');
    const options = { from:costPeriodFrom, to:costPeriodTo };
    const before = JSON.stringify(data);
    const first = dispatcherQuery('costs', options);
    first.rows[0].row.plate = 'LOCAL RESULT';
    first.rows[0].entries[0].amount = 9999;
    const second = dispatcherQuery('costs', options);
    const isolated = second.rows[0].row.plate === 'ТЕСТ001' && second.totals.expenses === 100;
    const readsPreservedData = before === JSON.stringify(data);
    const sameRows = [data.records, data.costEntries];
    data.records[0].km = 125; data.costEntries[0].amount = 250;
    renderCostsSection();
    const updated = dispatcherQuery('costs', options);
    return { isolated, readsPreservedData, sameRows:sameRows[0] === data.records && sameRows[1] === data.costEntries,
      expenses:updated.totals.expenses, quantity:updated.rows[0].quantity, rate:updated.rows[0].rate,
      frozen:Object.isFrozen(data.vehicles[0]), text:document.querySelector('.cost-workspace').textContent, writes:window.__writes };
  });
  assert.equal(result.isolated, true); assert.equal(result.readsPreservedData, true); assert.equal(result.sameRows, true);
  assert.equal(result.expenses, 250); assert.equal(result.quantity, 125); assert.equal(result.rate, 2);
  assert.equal(result.frozen, false); assert.equal(result.writes, 0); assert.match(result.text, /250/);
});

test('procurement workspace detects an in-place stock edit and default plan date advances', async () => {
  const result = await page.evaluate(() => {
    switchSection('procurement');
    const options = { date:'2026-10-21' }, first = dispatcherQuery('procurement', options);
    const tank = data.tanks[0]; tank.balanceInit = 20;
    renderProcurementSection();
    const changed = dispatcherQuery('procurement', options);
    const oldToday = wfToday;
    let dayOne, dayTwo;
    try {
      wfToday = () => '2026-10-20'; dayOne = dispatcherQuery('procurement');
      wfToday = () => '2026-10-21'; dayTwo = dispatcherQuery('procurement');
    } finally { wfToday = oldToday; }
    return { before:first[0].stock, after:changed[0].stock, need:changed[0].suggestedQty,
      sameTank:tank === data.tanks[0], dates:[dayOne[0].recent.to, dayTwo[0].recent.to], writes:window.__writes };
  });
  assert.equal(result.before, 100); assert.equal(result.after, 20); assert.equal(result.need, 90);
  assert.equal(result.sameTank, true); assert.deepEqual(result.dates, ['2026-10-20', '2026-10-21']); assert.equal(result.writes, 0);
});

test('live principal permissions constrain both engines even when query options request more', async () => {
  const result = await page.evaluate(() => {
    const all = Object.keys(data), options = { from:'2026-10-01', to:'2026-10-31', readable:all };
    const before = dispatcherQuery('costs', options);
    const originalIdentity = dispatcherContext().identity;
    _sync.databaseToken = 'test-db-two';
    _sync.access = { user:{ id:'test-reader', role:'observer' }, readable:all.filter(name => !['costEntries', 'tanks'].includes(name)), writable:[] };
    const after = dispatcherQuery('costs', options);
    const procurement = dispatcherQuery('procurement', { date:'2026-10-21', readable:all });
    return { before:before.totals.expenses, after:after.totals.expenses, missing:after.unavailable,
      procurementCount:procurement.length, changedIdentity:dispatcherContext().identity !== originalIdentity, writes:window.__writes };
  });
  assert.equal(result.before, 100); assert.equal(result.after, null); assert.ok(result.missing.includes('costEntries'));
  assert.equal(result.procurementCount, 0); assert.equal(result.changedIdentity, true); assert.equal(result.writes, 0);
});

test('canonical save and failed-save rollback both discard intermediate calculations', async () => {
  const result = await page.evaluate(async () => {
    const options = { date:'2026-10-21' }, originalSave = syncSave, originallyEnabled = _sync.enabled;
    let saved, rejected, successEntries, rollbackEntries, actualStock, canonicalJournalKm;
    try {
      _sync.enabled = true;
      syncSave = async submitted => {
        submitted.tanks[0].balanceInit = 55;
        submitted.records = submitted.records.map(row => ({ ...row, km:150 }));
        dispatcherQuery('procurement', options);
        return true;
      };
      saved = await saveData(data);
      successEntries = dispatcherEngineStats().entries;
      canonicalJournalKm = recsFor('engine-v')[0].km;
      actualStock = dispatcherQuery('procurement', options)[0].stock;
      syncSave = async submitted => {
        submitted.tanks[0].balanceInit = 70;
        dispatcherQuery('procurement', options);
        return false;
      };
      rejected = await saveData(data);
      rollbackEntries = dispatcherEngineStats().entries;
    } finally { syncSave = originalSave; _sync.enabled = originallyEnabled; }
    return { saved, rejected, successEntries, rollbackEntries, actualStock, canonicalJournalKm,
      restoredStock:dispatcherQuery('procurement', options)[0].stock, writes:window.__writes };
  });
  assert.equal(result.saved, true); assert.equal(result.rejected, false);
  assert.equal(result.successEntries, 0); assert.equal(result.rollbackEntries, 0);
  assert.equal(result.actualStock, 55); assert.equal(result.restoredStock, 55); assert.equal(result.writes, 0);
  assert.equal(result.canonicalJournalKm, 150);
});
