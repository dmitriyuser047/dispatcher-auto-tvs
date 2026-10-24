const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { pathToFileURL } = require('node:url'), { createRequire } = require('node:module');
let pw;
try { pw = require('playwright'); }
catch { pw = createRequire(path.join(process.env.TVS_PLAYWRIGHT_MODULES || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'), 'package.json'))('playwright'); }
const root = path.resolve(__dirname, '..');
let browser, page, errors;

before(async () => {
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await pw.chromium.launch({ headless:true, executablePath:process.env.TVS_TEST_BROWSER || (!process.env.CI && fs.existsSync(edge) ? edge : undefined) });
});
after(async () => { await browser?.close(); });
beforeEach(async () => {
  page = await browser.newPage({ viewport:{ width:1280, height:900 } });
  errors = []; page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.addInitScript(() => {
    // A wholly synthetic profile; neither installed settings nor a working database is accessed.
    const db = {
      vehicles:[{ id:'writeoff-v', plate:'SYNTHETIC-001', make:'Synthetic car', org:'Synthetic organization', fuel:'diesel', fuelGrade:'ДТ', norm:10,
        fuelBalance:50, fuelBalanceSources:[{ org:'Synthetic organization', grade:'ДТ', qty:50 }] }],
      records:[{ id:'writeoff-r', vehicleId:'writeoff-v', date:'2026-09-10', fuelGrade:'ДТ', fuelIssued:40, fuelActual:20, fuelIdle:2, km:100,
        odoStart:1000, odoEnd:1100, fuelCardNum:'123456' }],
      fuelPurchases:[{ id:'writeoff-p', recordId:'writeoff-r', vehicleId:'writeoff-v', date:'2026-09-10', grade:'ДТ', qty:40, sum:2400, price:60, cardNo:'123456', sourceOrg:'Synthetic organization', sourceProvider:'Synthetic supplier' }],
      fuelCards:[{ id:'writeoff-c', number:'123456', org:'Synthetic organization', provider:'Synthetic supplier', assignments:[{ vehicleId:'writeoff-v', from:'', to:'' }] },
        { id:'fc_cash', number:'НАЛИЧКА', provider:'Наличка', org:'', status:'active', limit:null, assignments:[], note:'Для учёта наличных закупок топлива' }],
      fuelImports:[], fuelPeriods:[], monthlyFuel:[], fuelWriteoffs:[], generators:[], genRecords:[],
      appMeta:[{ id:'meta', toPlanInit:'test' }]
    };
    window.__disk = JSON.stringify(db); window.__writes = 0; window.__legacyWrites = 0; window.__reject = false; window.__defer = false; window.__exports = [];
    window.__missingCanonical = false; window.__unsupported = false;
    window.__databaseToken = 'synthetic-writeoff-database';
    window.__revisions = Object.fromEntries(Object.keys(db).map(name => [name, 1]));
    window.electronAPI = {
      readData:async () => window.__disk,
      readSnapshot:async () => JSON.stringify({ data:JSON.parse(window.__disk), revisions:window.__revisions, databaseToken:window.__databaseToken }),
      writeData:async json => {
        window.__writes++; window.__legacyWrites++;
        if (window.__reject) return false;
        if (window.__defer) await new Promise(resolve => { window.__releaseWrite = resolve; });
        const payload = JSON.parse(json); window.__disk = JSON.stringify(payload.databaseToken ? payload.data : payload); return true;
      },
      writeSections:async json => {
        window.__writes++;
        if (window.__reject) return false;
        if (window.__unsupported) return { unsupported:true };
        if (window.__defer) await new Promise(resolve => { window.__releaseWrite = resolve; });
        const payload = JSON.parse(json), next = JSON.parse(window.__disk);
        for (const [name, rows] of Object.entries(payload.sections)) {
          if (name === 'fuelWriteoffs' && window.__missingCanonical) continue;
          next[name] = rows; window.__revisions[name] = (window.__revisions[name] || 0) + 1;
        }
        window.__disk = JSON.stringify(next);
        return { ok:true, databaseToken:window.__databaseToken, revisions:{ ...window.__revisions },
          ...(window.__missingCanonical ? {} : { canonicalSections:{ fuelWriteoffs:next.fuelWriteoffs } }) };
      }
    };
  });
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
  await page.waitForFunction(() => typeof gsmPostWriteoffDialog === 'function' && typeof data !== 'undefined' && data.vehicles[0]?.id === 'writeoff-v');
  await page.evaluate(() => {
    fpMonth = '2026-09'; fpView = 'writeoff'; gsmOrg = ''; gsmFuel = ''; gsmActNo = 'SYNTHETIC-2026-09'; gsmActDate = '2026-09-30';
    switchSection('fuelPurchases');
    XLSX.writeFile = (workbook, filename) => { window.__exports.push({ workbook:JSON.parse(JSON.stringify(workbook)), filename }); };
    window.__sourceBytes = JSON.stringify({ vehicles:data.vehicles, records:data.records, fuelPurchases:data.fuelPurchases, fuelCards:data.fuelCards, monthlyFuel:data.monthlyFuel, fuelPeriods:data.fuelPeriods });
  });
  await openFinalStage();
});
afterEach(async () => { await page?.close(); assert.deepEqual(errors, []); });

async function openFinalStage() {
  await page.locator('.gsm-act-steps').waitFor();
  await page.locator('[data-gsm-act-step="4"]').click();
  await page.locator('.gsm-writeoff').waitFor();
}
async function sourceBytes() {
  return page.evaluate(() => JSON.stringify({ vehicles:data.vehicles, records:data.records, fuelPurchases:data.fuelPurchases, fuelCards:data.fuelCards, monthlyFuel:data.monthlyFuel, fuelPeriods:data.fuelPeriods }));
}
async function registeredRows() { return page.evaluate(() => data.fuelWriteoffs || []); }

async function openPost(note = 'Synthetic checked sources') {
  await page.evaluate(() => gsmPostWriteoffDialog());
  await page.locator('#gsmWriteoffPostForm').waitFor();
  await page.locator('#gsmWriteoffPostForm [name="actNo"]').fill('SYNTHETIC-2026-09');
  await page.locator('#gsmWriteoffPostForm [name="actDate"]').fill('2026-09-30');
  await page.locator('#gsmWriteoffPostForm [name="basisNote"]').fill(note);
}
async function submitPost() { await page.locator('#gsmWriteoffPostForm [type="submit"]').click(); }
async function post() {
  await openPost(); await submitPost();
  await page.waitForFunction(() => data.fuelWriteoffs?.length === 1 && !document.querySelector('#genericModal.open #gsmWriteoffPostForm'));
  return (await registeredRows())[0];
}

test('posting registers a traceable act and leaves mileage, receipts, measurements and periods unchanged', async () => {
  const before = await sourceBytes(), doc = await post();
  assert.equal(await sourceBytes(), before);
  assert.equal(doc.status, 'posted'); assert.ok(doc.id); assert.ok(doc.sourceFingerprint);
  assert.equal(doc.totals.start, 50); assert.equal(doc.totals.issued, 40); assert.equal(doc.totals.spent, 22);
  assert.equal(doc.totals.idle, 2); assert.equal(doc.totals.end, 68); assert.equal(doc.totals.km, 100);
  assert.ok(doc.consumption.some(row => row.recordId === 'writeoff-r' && row.source === 'actual' && row.qty === 22));
  assert.deepEqual(await page.evaluate(() => JSON.parse(window.__disk).fuelWriteoffs), [doc]);
  await page.evaluate(() => gsmWriteoffDetails('writeoff-v', 'Synthetic organization', 'ДТ'));
  const detail = await page.locator('#genericModal').innerText();
  assert.match(detail, /факт|Факт/); assert.match(detail, /writeoff-r|10\.09\.2026/);
  assert.equal(await page.evaluate(() => window.__writes), 1);
});

test('a changed source after opening the posting preview cannot be registered', async () => {
  await openPost(); await page.evaluate(() => { data.records[0].fuelActual = 21; });
  await submitPost();
  await page.waitForFunction(() => !!document.getElementById('gsmWriteoffPostError')?.textContent.trim());
  assert.match(await page.locator('#gsmWriteoffPostError').innerText(), /измен|устар|обнов/i);
  assert.equal((await registeredRows()).length, 0); assert.equal(await page.evaluate(() => window.__writes), 0);
  assert.equal(await page.locator('#gsmWriteoffPostForm [name="basisNote"]').inputValue(), 'Synthetic checked sources');
});

test('a cancelled posting preview cannot be submitted through its retained hidden form', async () => {
  await openPost(); await page.evaluate(async () => { closeModal('genericModal'); await gsmPostWriteoff(); });
  assert.equal((await registeredRows()).length, 0); assert.equal(await page.evaluate(() => window.__writes), 0);
});

test('invalid source litres, unknown fuel and orphan records cannot be posted through a direct submit', async () => {
  const variants = ['purchase-quantity', 'negative-actual', 'negative-measurement', 'unknown-grade', 'orphan-record'];
  const result = await page.evaluate(async variants => {
    const original = structuredClone(data), outcomes = [];
    for (const variant of variants) {
      data = structuredClone(original);
      if (variant === 'purchase-quantity') data.fuelPurchases[0].qty = 'invalid';
      if (variant === 'negative-actual') data.records[0].fuelActual = -5;
      if (variant === 'negative-measurement') data.records[0].tankMeasured = -1;
      if (variant === 'unknown-grade') data.fuelPurchases[0].grade = 'Unknown synthetic product';
      if (variant === 'orphan-record') data.records.push({ id:'orphan-source', vehicleId:'missing-v', date:'2026-09-12', km:5, fuelActual:1 });
      rebuildIndex(); renderFuelPurchases(); gsmPostWriteoffDialog();
      const form = document.getElementById('gsmWriteoffPostForm');
      if (form) {
        form.elements.actNo.value = 'SYNTHETIC-2026-09'; form.elements.actDate.value = '2026-09-30'; form.elements.basisNote.value = 'Synthetic verification';
        await gsmPostWriteoff({ preventDefault() {}, target:form, currentTarget:form });
      }
      outcomes.push({ variant, posted:(data.fuelWriteoffs || []).length, writes:window.__writes });
      if (document.getElementById('genericModal')) closeModal('genericModal');
    }
    return outcomes;
  }, variants);
  for (const outcome of result) { assert.equal(outcome.posted, 0, outcome.variant); assert.equal(outcome.writes, 0, outcome.variant); }
});

test('a norm-based expense requires an explicit basis before posting and retains that source', async () => {
  await page.evaluate(() => { data.records[0].fuelActual = null; data.records[0].fuelUsed = 10; rebuildIndex(); renderFuelPurchases(); });
  await openPost('');
  await page.evaluate(() => document.getElementById('gsmWriteoffPostForm').dispatchEvent(new Event('submit', { bubbles:true, cancelable:true })));
  await page.waitForFunction(() => !!document.getElementById('gsmWriteoffPostError')?.textContent.trim());
  assert.equal((await registeredRows()).length, 0); assert.equal(await page.evaluate(() => window.__writes), 0);
  await page.locator('#gsmWriteoffPostForm [name="basisNote"]').fill('Synthetic approved norm basis'); await submitPost();
  await page.waitForFunction(() => data.fuelWriteoffs?.length === 1 && !document.querySelector('#genericModal.open #gsmWriteoffPostForm'));
  const doc = (await registeredRows())[0]; assert.equal(doc.totals.spent, 12);
  assert.equal(doc.basisNote, 'Synthetic approved norm basis');
  assert.ok(doc.consumption.some(row => row.recordId === 'writeoff-r' && row.source === 'norm'));
});

test('a rejected native save rolls back the act, retains entered metadata and permits one clean retry', async () => {
  const before = await sourceBytes(); await openPost('Synthetic retry basis'); await page.evaluate(() => { window.__reject = true; }); await submitPost();
  await page.waitForFunction(() => window.__writes === 1 && !!document.getElementById('gsmWriteoffPostError')?.textContent.trim());
  assert.equal((await registeredRows()).length, 0); assert.equal(await page.evaluate(() => JSON.parse(window.__disk).fuelWriteoffs.length), 0);
  assert.equal(await sourceBytes(), before); assert.equal(await page.locator('#gsmWriteoffPostForm [name="basisNote"]').inputValue(), 'Synthetic retry basis');
  await page.evaluate(() => { window.__reject = false; }); await submitPost();
  await page.waitForFunction(() => data.fuelWriteoffs?.length === 1 && !document.querySelector('#genericModal.open #gsmWriteoffPostForm'));
  assert.equal(await page.evaluate(() => window.__writes), 2); assert.equal(await sourceBytes(), before);
});

test('thrown persistence rolls back its own rows without restoring an older canonical server snapshot', async () => {
  await openPost();
  await page.evaluate(() => { saveData = async () => { throw Error('Synthetic write failure'); }; }); await submitPost();
  await page.waitForFunction(() => document.getElementById('gsmWriteoffPostError')?.textContent.includes('Synthetic write failure'));
  assert.equal((await registeredRows()).length, 0);
  await page.evaluate(() => {
    saveData = async () => {
      const provisional = structuredClone(data.fuelWriteoffs[0]);
      data = { ...data, records:data.records.map(row => ({ ...row, note:'Canonical server source' })), fuelWriteoffs:[{ ...provisional, id:'canonical-remote-act' }] };
      throw Error('Synthetic canonical replacement');
    };
  });
  await submitPost();
  await page.waitForFunction(() => document.getElementById('gsmWriteoffPostError')?.textContent.includes('Synthetic canonical replacement'));
  assert.deepEqual((await registeredRows()).map(row => row.id), ['canonical-remote-act']);
  assert.equal(await page.evaluate(() => data.records[0].note), 'Canonical server source');
});

test('successful canonical persistence is preserved instead of restoring the provisional local row', async () => {
  await openPost();
  await page.evaluate(() => {
    saveData = async () => {
      data = { ...data, fuelWriteoffs:data.fuelWriteoffs.map(row => ({ ...row, canonicalMarker:'saved by server' })) };
      return true;
    };
  });
  await submitPost(); await page.waitForFunction(() => !document.querySelector('#genericModal.open #gsmWriteoffPostForm'));
  const rows = await registeredRows(); assert.equal(rows.length, 1); assert.equal(rows[0].canonicalMarker, 'saved by server');
});

test('concurrent submit and a later overlapping filtered posting create one active act and one native write', async () => {
  await openPost();
  await page.evaluate(() => {
    window.__defer = true;
    const form = document.getElementById('gsmWriteoffPostForm');
    form.dispatchEvent(new Event('submit', { bubbles:true, cancelable:true })); form.dispatchEvent(new Event('submit', { bubbles:true, cancelable:true }));
  });
  await page.waitForFunction(() => window.__writes === 1 && typeof window.__releaseWrite === 'function');
  assert.equal(await page.locator('#gsmWriteoffPostForm [type="submit"]').isDisabled(), true);
  await page.evaluate(() => window.__releaseWrite());
  await page.waitForFunction(() => data.fuelWriteoffs?.length === 1 && !document.querySelector('#genericModal.open #gsmWriteoffPostForm'));
  await page.evaluate(async () => {
    gsmOrg = 'Synthetic organization'; gsmFuel = 'ДТ'; gsmActNo = 'SYNTHETIC-SECOND';
    gsmPostWriteoffDialog(); const form = document.getElementById('gsmWriteoffPostForm');
    if (form) {
      form.elements.actNo.value = 'SYNTHETIC-SECOND'; form.elements.actDate.value = '2026-09-30'; form.elements.basisNote.value = 'Synthetic overlapping attempt';
      await gsmPostWriteoff({ preventDefault() {}, target:form, currentTarget:form });
    }
  });
  assert.equal((await registeredRows()).length, 1); assert.equal(await page.evaluate(() => window.__writes), 1);
});

test('registered export is identical after later changes to source quantities, names and cards', async () => {
  const doc = await post();
  await page.evaluate(id => gsmExportPostedWriteoff(id), doc.id);
  const first = await page.evaluate(() => window.__exports[0]);
  assert.ok(first?.workbook?.Sheets?.['Акт списания ГСМ']);
  await page.evaluate(() => {
    data.vehicles[0].plate = 'CHANGED SOURCE'; data.vehicles[0].org = 'Changed organization'; data.records[0].fuelActual = -999;
    data.records[0].km = 900; data.fuelPurchases = []; data.fuelCards = []; rebuildIndex();
  });
  await page.evaluate(id => gsmExportPostedWriteoff(id), doc.id);
  const second = await page.evaluate(() => window.__exports[1]);
  assert.deepEqual(second, first); assert.equal((await registeredRows())[0].totals.spent, 22);
  assert.equal(await page.evaluate(() => window.__writes), 1);
});

test('annulment requires a reason, preserves the registered source snapshot and cannot be repeated', async () => {
  const doc = await post(), snapshot = JSON.stringify(doc.snapshot), before = await sourceBytes();
  await page.evaluate(id => gsmVoidWriteoffDialog(id), doc.id); await page.locator('#gsmWriteoffVoidForm').waitFor();
  await page.evaluate(() => document.getElementById('gsmWriteoffVoidForm').dispatchEvent(new Event('submit', { bubbles:true, cancelable:true })));
  await page.waitForFunction(() => !!document.getElementById('gsmWriteoffVoidError')?.textContent.trim());
  assert.equal((await registeredRows())[0].status, 'posted'); assert.equal(await page.evaluate(() => window.__writes), 1);
  await page.locator('#gsmWriteoffVoidForm [name="reason"]').fill('Synthetic correction confirmed from source');
  await page.locator('#gsmWriteoffVoidForm [type="submit"]').click();
  await page.waitForFunction(() => data.fuelWriteoffs?.[0]?.status !== 'posted' && !document.querySelector('#genericModal.open #gsmWriteoffVoidForm'));
  const voided = (await registeredRows())[0]; assert.equal(JSON.stringify(voided.snapshot), snapshot);
  assert.match(JSON.stringify(voided), /Synthetic correction confirmed from source/); assert.equal(await sourceBytes(), before);
  await page.evaluate(id => gsmExportPostedWriteoff(id), doc.id);
  const copy = await page.evaluate(() => window.__exports.at(-1));
  assert.match(copy.filename, /^Аннулированный_акт_ГСМ_/);
  assert.match(copy.workbook.Sheets['Акт списания ГСМ'].A1.v, /^АННУЛИРОВАН.*Synthetic correction confirmed from source/);
  await page.evaluate(id => gsmVoidWriteoffDialog(id), doc.id);
  assert.equal(await page.locator('#genericModal.open #gsmWriteoffVoidForm').count(), 0); assert.equal(await page.evaluate(() => window.__writes), 2);
});

test('read-only role cannot post or annul through hidden routes or direct function invocation', async () => {
  const doc = await post();
  await page.evaluate(() => { _sync.access = { user:{ id:'synthetic-reader', role:'viewer' }, readable:Object.keys(data), writable:[] }; renderFuelPurchases(); });
  await openFinalStage();
  assert.equal(await page.locator('[data-writeoff-action="post"]:not(:disabled),[data-writeoff-action="void"]').count(), 0);
  await page.evaluate(async id => {
    gsmPostWriteoffDialog(); gsmVoidWriteoffDialog(id);
    await gsmPostWriteoff({ preventDefault() {} }); await gsmVoidWriteoff({ preventDefault() {} });
  }, doc.id);
  assert.equal(await page.locator('#genericModal.open #gsmWriteoffPostForm,#genericModal.open #gsmWriteoffVoidForm').count(), 0);
  assert.equal((await registeredRows())[0].status, 'posted'); assert.equal(await page.evaluate(() => window.__writes), 1);
});

test('an account change inside the same database invalidates an already open posting form', async () => {
  await page.evaluate(() => { _sync.databaseToken = 'synthetic-same-db'; _sync.access = { user:{ id:'synthetic-first', role:'admin' }, readable:Object.keys(data), writable:Object.keys(data) }; });
  await openPost('Synthetic identity check');
  await page.evaluate(() => { _sync.access.user = { id:'synthetic-second', role:'admin' }; }); await submitPost();
  await page.waitForFunction(() => !!document.getElementById('gsmWriteoffPostError')?.textContent.trim());
  assert.match(await page.locator('#gsmWriteoffPostError').innerText(), /учётн|пользоват|профил|измен/i);
  assert.equal((await registeredRows()).length, 0); assert.equal(await page.evaluate(() => window.__writes), 0);
});

test('an unreadable source section prevents posting even if cached local rows remain present', async () => {
  await page.evaluate(async () => {
    _sync.access = { user:{ id:'synthetic-partial', role:'admin' }, readable:Object.keys(data).filter(name => name !== 'fuelPurchases'), writable:['fuelWriteoffs'] };
    renderFuelPurchases(); gsmPostWriteoffDialog();
    const form = document.getElementById('gsmWriteoffPostForm');
    if (form) {
      form.elements.actNo.value = 'SYNTHETIC-PARTIAL'; form.elements.actDate.value = '2026-09-30'; form.elements.basisNote.value = 'Synthetic partial access';
      await gsmPostWriteoff({ preventDefault() {}, target:form, currentTarget:form });
    }
  });
  assert.equal((await registeredRows()).length, 0); assert.equal(await page.evaluate(() => window.__writes), 0);
  assert.equal(await page.evaluate(() => data.fuelPurchases.length), 1, 'permission checks must not delete inaccessible source rows');
});

test('a backend without the act section cannot post through the legacy boolean write protocol', async () => {
  await page.evaluate(async () => {
    delete _sync.revs.fuelWriteoffs; renderFuelPurchases(); gsmPostWriteoffDialog();
    const form = document.getElementById('gsmWriteoffPostForm');
    if (form) await gsmPostWriteoff({ preventDefault() {}, target:form, currentTarget:form });
  });
  assert.equal((await registeredRows()).length, 0); assert.equal(await page.evaluate(() => window.__writes), 0);
  assert.equal(await page.evaluate(() => window.__legacyWrites), 0);
});

test('an unsupported section response cannot fall back to an unverified whole-database write', async () => {
  await openPost(); await page.evaluate(() => { window.__unsupported = true; }); await submitPost();
  await page.waitForFunction(() => window.__writes === 1 && !!document.getElementById('gsmWriteoffPostError')?.textContent.trim());
  assert.equal((await registeredRows()).length, 0); assert.equal(await page.evaluate(() => JSON.parse(window.__disk).fuelWriteoffs.length), 0);
  assert.equal(await page.evaluate(() => window.__legacyWrites), 0);
});

test('posting requires the canonical saved act instead of accepting a bare success response', async () => {
  await openPost(); await page.evaluate(() => { window.__missingCanonical = true; }); await submitPost();
  await page.waitForFunction(() => window.__writes === 1 && !!document.getElementById('gsmWriteoffPostError')?.textContent.trim());
  assert.equal((await registeredRows()).length, 0); assert.equal(await page.evaluate(() => JSON.parse(window.__disk).fuelWriteoffs.length), 0);
  assert.equal(await page.evaluate(() => window.__legacyWrites), 0);
  assert.equal(await page.locator('#gsmWriteoffPostForm [name="basisNote"]').inputValue(), 'Synthetic checked sources');
});
