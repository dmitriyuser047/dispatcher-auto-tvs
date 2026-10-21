const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function fixture() {
  return {
    vehicles: [{ id: 'v', plate: 'CAR', org: 'A', object: 'Site', fuel: 'gasoline', fuelGrade: 'АИ-95', fuelBalance: 100 }],
    records: [{ id: 'r', vehicleId: 'v', date: '2026-09-01', fuelGrade: 'АИ-95', fuelIssued: 55.563, fuelSum: 5000.34,
      km: 123, odoStart: 1000, odoEnd: 1123, fuelActual: 17.256, fuelIdle: 0.123, tankMeasured: 138.307, note: 'Original journal' }],
    fuelPurchases: [{ id: 'p', recordId: 'r', vehicleId: 'v', date: '2026-09-01', grade: 'АИ-95', product: 'АИ-95',
      qty: 45.562, sum: 4556.2, price: 100, cardNo: '111111', sourceOrg: 'A', restored: true,
      importKey: '2026-09-01|45.562|111111||source', sourceTransaction: { qty: 45.562, sum: 4556.2, product: 'АИ-95' } }],
    fuelCards: [{ number: '111111', org: 'A', assignments: [{ vehicleId: 'v', from: '', to: '' }] }], fuelPeriods: [],
  };
}
function context(db = fixture()) {
  const fields = new Map();
  const ctx = vm.createContext({ console, window: {}, document: { addEventListener() {}, documentElement: { removeAttribute() {} },
    getElementById(id) { return fields.get(id); } }, localStorage: { getItem() {} } });
  vm.runInContext(fs.readFileSync(path.join(root, 'assets/core/decimal-core.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'assets/core/fuel-engine.js'), 'utf8'), ctx, { filename: 'assets/core/fuel-engine.js' });
  for (const file of ['55-precision-input.js', '01-core.js', '29-fuel-quality.js', '25b-fuel-purchases.js', '25c-fuel-control.js', '25i-gsm-ledger.js', '25l-manual-fuel.js'])
    vm.runInContext(fs.readFileSync(path.join(root, 'assets/js', file), 'utf8'), ctx, { filename: file });
  ctx.input = db; vm.runInContext('data=input', ctx);
  Object.assign(ctx, {
    rebuildIndex() {}, showToast() {}, closeModal() { ctx.closed = true; }, renderFuelPurchases() {},
    openGenericModal(title, html) { ctx.modal = { title, html }; }, alert(message) { ctx.alertMessage = message; },
    fuelImportVehicleOptions() { return ''; },
    showFieldError(message, field) { ctx.fieldError = { message, field }; },
    optionalNumber(id) { const value = fields.get(id)?.value; return value === '' || value == null ? null : Number(value); },
    saveData: async () => true,
  });
  const p = db.fuelPurchases[0];
  const values = { date: '01.09.2026', time: '', qty: p.qty, price: p.price, sum: p.sum, comment: '', card: p.cardNo,
    org: p.sourceOrg, grade: p.grade, vehicle: p.vehicleId, org_reason: '' };
  for (const [key, value] of Object.entries(values)) fields.set('fpe_' + key, { value: String(value ?? '') });
  fields.set('fpe_correct_org', { checked: false }); fields.set('fpe_save', { disabled: false });
  for (const [id, value] of Object.entries({ fpd_mode: 'remove', fpd_reason: '', fpd_preview: '', fpd_error: '', fpd_commit: '' }))
    fields.set(id, { value, textContent: '', disabled: false });
  fields.set('fpd_confirm', { checked: false });
  ctx.fpEdit('p'); for(const input of fields.values())input._precisionInitial=input.value;
  return { ctx, fields, current: () => vm.runInContext('data', ctx) };
}
function statement(ctx, db, changes = {}) {
  return ctx.gsmStatementApply(db, ctx.gsmStatementPlan(db, 'p', { ...db.fuelPurchases[0], ...changes }));
}

test('source quantities, explicit money and price retain their decimals in purchase and journal without rewriting the source', () => {
  const db = fixture(), { ctx } = context(db);
  const tx=Object.freeze({ date: '2026-09-02', qty: 45.562, sum: 3100.125, price: 68.045, fuel: 'АИ-95' }),before=JSON.stringify(tx);
  const p = ctx.fpCreate(tx, { vehicleId: 'v' });
  assert.equal(JSON.stringify(tx),before);assert.equal(p.qty, 45.562); assert.equal(p.sum, 3100.125); assert.equal(p.price, 68.045);
  const r = ctx.fpApply(p, 1).record;
  assert.equal(r.fuelIssued, 45.562); assert.equal(r.fuelSum, 3100.125);
  ctx.fpApply(p, -1); assert.equal(r.fuelIssued, null);
  assert.equal(db.records[0].km, 123); assert.equal(db.records[0].tankMeasured, 138.307);
});

test('read-only calculations do not normalize raw quantities, measurements or source transactions', () => {
  const db = fixture(), { ctx } = context(db), before = JSON.stringify(db);
  ctx.fpStats(); ctx.fpJournalState(db.fuelPurchases[0], ctx.fpStats());
  ctx.gsmBuildLedger(db, { from: '2026-09-01', to: '2026-09-30' });
  assert.equal(JSON.stringify(db), before);
});

test('monthly control view explains operation-based acts and does not initialize or fill source data', () => {
  const db = fixture(), { ctx } = context(db), before = JSON.stringify(db);
  ctx.recsFor = id => db.records.filter(r => r.vehicleId === id);
  const html = ctx.fpMonthlyHtml();
  assert.match(html, /Месячные поля — контрольные/); assert.match(html, /заполненное поле «Получено» их не заменяет/);
  assert.equal(JSON.stringify(db), before); assert.equal(db.monthlyFuel, undefined);
});

test('manual and statement entries accept three quantity decimals and reject four; amounts stay two decimals', () => {
  const db = fixture(), { ctx } = context(db);
  const draft = qty => ({ org: 'A', month: '2026-09', rows: [{ id: 'draft', date: '2026-09-02', vehicleId: 'v', grade: 'АИ-95', cardNo: '111111', qty, sum: '3100.12', comment: '' }] });
  const plan = ctx.gsmManualPlan(db, draft('45.562')), next = ctx.gsmManualApply(db, plan, false);
  assert.equal(plan.total, 45.562); assert.equal(next.records.at(-1).fuelIssued, 45.562); assert.equal(next.fuelPurchases.at(-1).qty, 45.562);
  assert.throws(() => ctx.gsmManualPlan(db, draft('45.5621')), /трёх/);
  const badMoney = draft('45.562'); badMoney.rows[0].sum = '3100.125'; assert.throws(() => ctx.gsmManualPlan(db, badMoney), /копеек/);
  assert.equal(statement(ctx, db, { qty: 45.564 }).records[0].fuelIssued, 55.565);
  assert.throws(() => statement(ctx, db, { qty: 45.5621 }), error=>error.code==='PRECISION');
});

test('millilitre differences do not become duplicate keys or false exact journal matches', () => {
  const db = fixture(), { ctx } = context(db);
  const draft = { org: 'A', month: '2026-09', rows: [{ id: 'draft', date: '2026-09-01', vehicleId: 'v', grade: 'АИ-95', cardNo: '111111', qty: '45.564', sum: '', comment: '' }] };
  assert.equal(ctx.gsmManualPlan(db, draft).entries[0].duplicate, false);
  db.records[0].fuelIssued = 91.124; // Manual remainder 45.562 differs from the new 45.564 receipt.
  const plan = ctx.gsmManualPlan(db, draft);
  assert.equal(plan.groups[0].choices.some(choice => choice.value.startsWith('link:')), false);
});

test('restoration keys distinguish 45.562 from 45.564 litres and retain exact source quantities', () => {
  const db = fixture(); db.records[0].note = 'заправка: АИ-95 45.564л; импорт заправок: 2026-09-01|45.564|111111||other';
  const { ctx } = context(db);
  assert.equal(ctx.fpRestoreFromJournal(), 1); assert.equal(db.fuelPurchases.at(-1).qty, 45.564);
  assert.equal(ctx.fpRestoreFromJournal(), 0);
});

test('comment-only edit preserves journal, source transaction, exact litres and restored provenance', async () => {
  const db = fixture(), { ctx, fields, current } = context(db), journal = JSON.stringify(db.records), source = JSON.stringify(db.fuelPurchases[0].sourceTransaction);
  fields.get('fpe_comment').value = 'Checked document';
  await ctx.fpEditSave('p');
  assert.equal(JSON.stringify(current().records), journal); assert.equal(current().fuelPurchases[0].qty, 45.562);
  assert.equal(current().fuelPurchases[0].restored, true); assert.equal(JSON.stringify(current().fuelPurchases[0].sourceTransaction), source);
  assert.equal(current().fuelPurchases[0].comment, 'Checked document'); assert.equal(ctx.closed, true);
  ctx.fpRefreshFromTx(current().fuelPurchases[0], { qty: 45.562, sum: 4556.2 });
  assert.equal(current().fuelPurchases[0].restored, false); // Only a matched original import resolves reconstruction provenance.
});

test('failed and thrown edit persistence roll back data and retain typed quantity and reason', async () => {
  for (const throws of [false, true]) {
    const db = fixture(), before = JSON.stringify(db), { ctx, fields, current } = context(db);
    fields.get('fpe_qty').value = '45.564'; fields.get('fpe_org').value = 'B';
    fields.get('fpe_correct_org').checked = true; fields.get('fpe_org_reason').value = 'Original receipt';
    ctx.saveData = async () => { if (throws) throw Error('Offline'); return false; };
    await ctx.fpEditSave('p');
    assert.equal(JSON.stringify(current()), before); assert.equal(fields.get('fpe_qty').value, '45.564');
    assert.equal(fields.get('fpe_org_reason').value, 'Original receipt'); assert.equal(ctx.closed, undefined); assert.equal(fields.get('fpe_save').disabled, false);
    ctx.saveData = async () => true; await ctx.fpEditSave('p');
    assert.equal(current().fuelPurchases.length, 1); assert.equal(current().records[0].fuelIssued, 55.565);
  }
});

test('failed edit does not overwrite a newer canonical snapshot returned by persistence', async () => {
  const db = fixture(), { ctx, fields, current } = context(db), remote = fixture(); remote.vehicles[0].driver = 'Remote change';
  fields.get('fpe_qty').value = '45.564'; ctx.remote = remote;
  ctx.saveData = async () => { vm.runInContext('data=remote', ctx); return false; };
  await ctx.fpEditSave('p'); assert.equal(current(), remote); assert.equal(current().vehicles[0].driver, 'Remote change');
});

test('old open purchase form cannot restore earlier litres over newer purchase or linked journal data', async () => {
  for (const changed of ['purchase', 'journal', 'principal']) {
    const db = fixture(), { ctx, fields, current } = context(db); let writes = 0;
    ctx.saveData = async () => { writes++; return true; }; fields.get('fpe_comment').value = 'Old form comment';
    if (changed === 'purchase') { db.fuelPurchases[0].qty = 50.564; db.records[0].fuelIssued = 60.565; }
    else if (changed === 'journal') db.records[0].fuelActual = 21.123;
    else vm.runInContext('localCacheKey="different-account-cache"', ctx);
    const newer = JSON.stringify(current()); await ctx.fpEditSave('p');
    assert.equal(writes, 0); assert.equal(JSON.stringify(current()), newer); assert.match(ctx.fieldError.message, /изменились/);
    assert.equal(fields.get('fpe_comment').value, 'Old form comment');
  }
});

test('concurrent edit submits persist once and keep exact quantity', async () => {
  const { ctx, fields, current } = context(); fields.get('fpe_comment').value = 'Comment';
  let resolve, count = 0; ctx.saveData = () => { count++; return new Promise(done => { resolve = done; }); };
  const pending = ctx.fpEditSave('p'); await ctx.fpEditSave('p'); assert.equal(count, 1);
  resolve(true); await pending; assert.equal(current().fuelPurchases[0].qty, 45.562);
});

test('historical source organization stays fixed unless explicitly corrected with a reason', async () => {
  const db = fixture(), { ctx, fields, current } = context(db), journal = JSON.stringify(db.records);
  assert.equal(statement(ctx, db, { sourceOrg: 'B' }).fuelPurchases[0].sourceOrg, 'A');
  assert.throws(() => statement(ctx, db, { sourceOrg: 'B', sourceOrgOverride: true }), /основание/);
  fields.get('fpe_org').value = 'B'; fields.get('fpe_correct_org').checked = true;
  await ctx.fpEditSave('p'); assert.equal(current().fuelPurchases[0].sourceOrg, 'A'); assert.equal(ctx.fieldError.field, 'fpe_org_reason');
  fields.get('fpe_org_reason').value = 'Receipt 17 names B'; await ctx.fpEditSave('p');
  const p = current().fuelPurchases[0];
  assert.equal(p.sourceOrg, 'B'); assert.equal(p.sourceOrgCorrections.length, 1); assert.equal(p.sourceOrgCorrections[0].from, 'A');
  assert.equal(p.sourceOrgCorrections[0].to, 'B'); assert.equal(p.sourceOrgCorrections[0].reason, 'Receipt 17 names B');
  assert.match(p.sourceOrgCorrections[0].at, /^\d{4}-\d{2}-\d{2}T/); assert.equal(JSON.stringify(current().records), journal);
  assert.equal(p.restored, true); assert.equal(p.sourceTransaction.qty, 45.562); assert.equal(p.cardNo, '111111');
});

test('unknown card organization can be filled normally; closed periods reject explicit overrides', () => {
  const db = fixture(); db.fuelPurchases[0].cardNo = 'unknown'; db.fuelPurchases[0].sourceOrg = '';
  const { ctx } = context(db); assert.equal(statement(ctx, db, { sourceOrg: 'B' }).fuelPurchases[0].sourceOrg, 'B');
  db.fuelPeriods.push({ month: '2026-09', closed: true });
  assert.throws(() => statement(ctx, db, { sourceOrg: 'B', sourceOrgOverride: true, sourceOrgReason: 'Original receipt' }), /закрыт/);
});

test('stale purchase reference resolves the same unique journal row without a false missing or difference alert', () => {
  const db = fixture(); db.fuelPurchases[0].recordId = 'old-deleted-id'; db.records[0].fuelIssued = 45.562;
  const { ctx } = context(db), before = JSON.stringify(db), stats = ctx.fpStats();
  assert.equal(stats.get('r'), 45.562); assert.equal(ctx.fpJournalState(db.fuelPurchases[0], stats).state, 'ok');
  assert.equal(JSON.stringify(db), before);
  db.records.push({ ...db.records[0], id: 'second' });
  assert.equal(ctx.fpJournalState(db.fuelPurchases[0], ctx.fpStats()).state, 'missing');
});

async function deleteSetup(mode = 'keep') {
  const db = fixture();
  if (mode === 'keep') db.fuelPurchases.push({ ...db.fuelPurchases[0], id: 'correct-original', importKey: 'original-file-row', restored: false });
  const env = context(db); await env.ctx.fpDelete('p');
  env.fields.get('fpd_mode').value = mode; env.fields.get('fpd_reason').value = 'Duplicate confirmed against original file';
  env.fields.get('fpd_confirm').checked = true; return { ...env, db };
}
test('deleting a confirmed redundant statement row preserves the entire correct journal and records the reason', async () => {
  const { ctx, db, fields, current } = await deleteSetup(), before = JSON.stringify(db.records);
  assert.equal(db.fuelPurchases[0].deleted, undefined); ctx.fpDeletePreview(); assert.match(fields.get('fpd_preview').textContent, /55,563 → 55,563/);
  await ctx.fpDeleteCommit();
  assert.equal(JSON.stringify(current().records), before); const p = current().fuelPurchases[0];
  assert.equal(p.deleted, true); assert.equal(p.deletion.mode, 'preserve-journal'); assert.equal(p.deletion.recordId, 'r');
  assert.equal(p.deletion.journalIssuedBefore, 55.563); assert.equal(p.deletion.journalIssuedAfter, 55.563);
  assert.equal(p.deletion.reason, 'Duplicate confirmed against original file'); assert.equal(p.restored, true);
});

test('ordinary confirmed deletion subtracts only exact purchase litres and money while preserving actuals and mileage', async () => {
  const { ctx, current, fields } = await deleteSetup('remove'); ctx.fpDeletePreview(); assert.match(fields.get('fpd_preview').textContent, /55,563 → 10,001/);
  await ctx.fpDeleteCommit(); const r = current().records[0];
  assert.equal(r.fuelIssued, 10.001); assert.equal(r.fuelSum, 444.14); assert.equal(r.km, 123); assert.equal(r.fuelActual, 17.256);
  assert.equal(r.tankMeasured, 138.307); assert.equal(current().fuelPurchases[0].deletion.mode, 'remove-journal');
});

test('keeping the journal while deleting its last purchase is blocked before its source organization can change', async () => {
  const db = fixture(); db.fuelPurchases[0].sourceOrg = 'B';
  const { ctx, fields, current } = context(db); await ctx.fpDelete('p');
  assert.match(ctx.modal.html, /Последнюю связанную покупку нельзя убрать/); assert.doesNotMatch(ctx.modal.html, /<option value="keep">/);
  fields.get('fpd_mode').value = 'keep'; fields.get('fpd_reason').value = 'Possible duplicate'; fields.get('fpd_confirm').checked = true;
  let writes = 0; ctx.saveData = async () => { writes++; return true; };
  const before = JSON.stringify(current()); await ctx.fpDeleteCommit();
  assert.equal(writes, 0); assert.equal(JSON.stringify(current()), before); assert.match(fields.get('fpd_error').textContent, /последнюю/);
});

test('removing the last receipt does not delete a zero-mileage journal with an explicit zero measurement or actual', () => {
  for (const fact of [{ tankMeasured: 0 }, { fuelActual: 0 }, { tankMeasured: 12.345 }]) {
    const db = fixture(); db.records = [{ id: 'r', vehicleId: 'v', date: '2026-09-01', km: 0, fuelIssued: 45.562, ...fact }];
    const { ctx } = context(db); ctx.fpApply(db.fuelPurchases[0], -1);
    assert.equal(db.records.length, 1); assert.equal(db.records[0].fuelIssued, null);
    for (const [key, value] of Object.entries(fact)) assert.equal(db.records[0][key], value);
  }
});

test('deletion requires reason and confirmation, rejects stale or closed data, and rolls back persistence failure', async () => {
  const { ctx, current, fields } = await deleteSetup(); const before = JSON.stringify(current());
  fields.get('fpd_reason').value = ''; await ctx.fpDeleteCommit(); assert.match(fields.get('fpd_error').textContent, /причину/);
  fields.get('fpd_reason').value = 'Duplicate'; fields.get('fpd_confirm').checked = false;
  await ctx.fpDeleteCommit(); assert.match(fields.get('fpd_error').textContent, /Подтвердите/); assert.equal(JSON.stringify(current()), before);
  fields.get('fpd_confirm').checked = true; ctx.saveData = async () => false; await ctx.fpDeleteCommit();
  assert.equal(JSON.stringify(current()), before); assert.equal(fields.get('fpd_reason').value, 'Duplicate'); assert.equal(ctx.closed, undefined);
  ctx.saveData = async () => { throw Error('Offline'); }; await ctx.fpDeleteCommit(); assert.equal(JSON.stringify(current()), before);
  current().records[0].km = 124; await ctx.fpDeleteCommit(); assert.match(fields.get('fpd_error').textContent, /изменились/);
  current().fuelPeriods.push({ month: '2026-09', closed: true }); await ctx.fpDelete('p'); assert.match(ctx.alertMessage, /закрыт/);
});
