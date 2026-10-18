const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../assets/js/25p-import-review.js'), 'utf8');
function fixture() {
  return { vehicles: [{ id: 'v', plate: 'Х123АА716', make: 'Нива' }], records: [{ id: 'r', vehicleId: 'v', date: '2026-10-01', fuelIssued: 10 }],
    fuelPurchases: [], fuelImports: [], fuelCards: [], fuelPeriods: [], payments: [], appMeta: [] };
}
function runtime() {
  let next = 0;
  const nodes = new Map();
  const ctx = vm.createContext({ console, data: fixture(), window: { electronAPI: { getDataIdentity: async () => ctx.identity } }, identity: 'database-A',
    newId: prefix => prefix + (++next), _activeSaves: 0, rebuildIndex() {}, htmlEsc: x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    htmlJs: x => JSON.stringify(x), fuelImportVehicleTitle: id => id,
    document: { getElementById(id) { if (!nodes.has(id)) nodes.set(id, { textContent: '', disabled: false }); return nodes.get(id); } },
    openGenericModal(title, html) { ctx.lastHtml = html; }, closeModal() {}, showToast(text) { ctx.toast = text; }, confirmAction: async () => true,
    saveData: async (db, options) => { ctx.writes++; ctx.saved = JSON.stringify(db); ctx.options = options; return ctx.persist; }, writes: 0, persist: true });
  vm.runInContext(source, ctx);
  return ctx;
}
function planFuel(ctx) {
  return vm.runInContext(`importReviewBuildPlan({ identity:'database-A', fileName:'fuel.xlsx', kind:'fuel' }, () => {
    data.records[0].fuelIssued = 40;
    data.fuelPurchases.push({id:'p',recordId:'r',vehicleId:'v',date:'2026-10-01',qty:30});
  })`, ctx);
}
function pending(ctx, plan) { ctx.plan = plan; vm.runInContext('_importReviewPending={plan}', ctx); }

test('planning never changes live data or writes, including exceptions and async misuse', () => {
  const ctx = runtime(), original = ctx.data, json = JSON.stringify(ctx.data), plan = planFuel(ctx);
  assert.equal(ctx.data, original); assert.equal(JSON.stringify(ctx.data), json); assert.equal(ctx.writes, 0);
  assert.equal(plan.changes.length, 2); assert.equal(plan.changes.find(x => x.id === 'r').after.fuelIssued, 40);
  assert.throws(() => vm.runInContext("importReviewBuildPlan({},()=>{data.records[0].fuelIssued=999;throw Error('bad file')})", ctx), /bad file/);
  assert.throws(() => vm.runInContext('importReviewBuildPlan({},async()=>{data.records.length=0})', ctx), /синхронной/);
  assert.equal(ctx.data, original); assert.equal(JSON.stringify(ctx.data), json);
});
test('explicit apply saves the diff and a bounded batch record, preserving unrelated changes', async () => {
  const ctx = runtime(), plan = planFuel(ctx); pending(ctx, plan);
  ctx.data.payments.push({ id: 'unrelated', sum: 100 });
  assert.equal(await ctx.importReviewApply(), true); assert.equal(ctx.writes, 1);
  assert.equal(ctx.data.records[0].fuelIssued, 40); assert.equal(ctx.data.payments[0].sum, 100);
  const batch = ctx.data.appMeta[0]; assert.equal(batch.type, 'importBatch'); assert.equal(batch.changes.length, 2);
  assert.equal(batch.changes.some(x => x.section === 'appMeta'), false); assert.equal('afterDatabase' in batch, false);
  assert.equal(ctx.options.noMerge, true); assert.match(ctx.options.history.action, /fuel.xlsx/);
});
test('apply refuses a changed source row and a changed linked vehicle without writing', async () => {
  for (const edit of [ctx => ctx.data.records[0].fuelIssued = 20, ctx => ctx.data.vehicles[0].make = 'Changed']) {
    const ctx = runtime(), plan = planFuel(ctx); pending(ctx, plan); edit(ctx);
    assert.equal(await ctx.importReviewApply(), false); assert.equal(ctx.writes, 0); assert.equal(ctx.data.fuelPurchases.length, 0);
  }
});
test('a review cannot be applied to another database identity, even with identical rows', async () => {
  const ctx = runtime(), plan = planFuel(ctx); pending(ctx, plan); ctx.identity = 'database-B';
  assert.equal(await ctx.importReviewApply(), false); assert.equal(ctx.writes, 0); assert.equal(ctx.data.records[0].fuelIssued, 10);
});
test('a concurrent matching vehicle prevents duplicate additions after preview', async () => {
  const ctx = runtime(); const plan = vm.runInContext("importReviewBuildPlan({identity:'database-A'},()=>data.vehicles.push({id:'new',plate:'NEW'}))", ctx);
  pending(ctx, plan); ctx.data.vehicles.push({ id: 'other', plate: 'NEW' });
  assert.equal(await ctx.importReviewApply(), false); assert.equal(ctx.writes, 0); assert.equal(ctx.data.vehicles.length, 2);
});
test('a dependent document created after preview blocks the stale diff', async () => {
  const ctx = runtime(), plan = planFuel(ctx); pending(ctx, plan);
  ctx.data.repairs = [{ id: 'later', recordId: 'r' }];
  assert.equal(await ctx.importReviewApply(), false); assert.equal(ctx.writes, 0);
});
test('period closure after preview prevents import and batch undo', async () => {
  const ctx = runtime(), plan = planFuel(ctx); pending(ctx, plan);
  ctx.data.fuelPeriods.push({ month: '2026-10', closed: true });
  assert.equal(await ctx.importReviewApply(), false); assert.equal(ctx.writes, 0);
  ctx.data.fuelPeriods = []; pending(ctx, plan); await ctx.importReviewApply();
  ctx.data.fuelPeriods.push({ month: '2026-10', closed: true });
  assert.throws(() => ctx.importReviewUndoCheck(ctx.data, ctx.data.appMeta[0]), /закрытый месяц/);
});
test('failed persistence leaves neither imported rows, template, nor batch in memory', async () => {
  const ctx = runtime(), plan = planFuel(ctx); plan.template = { name: 'Supplier', kind: 'fuel', columns: {} }; pending(ctx, plan); ctx.persist = false;
  const original = ctx.data; assert.equal(await ctx.importReviewApply(), false); assert.equal(ctx.data, original);
  assert.equal(ctx.data.records[0].fuelIssued, 10); assert.equal(ctx.data.fuelPurchases.length, 0); assert.equal(ctx.data.appMeta.length, 0);
});
test('undo restores only its exact rows and preserves unrelated rows and saved templates', async () => {
  const ctx = runtime(), plan = planFuel(ctx); plan.template = { name: 'Supplier', kind: 'fuel', columns: {} }; pending(ctx, plan); await ctx.importReviewApply();
  ctx.data.payments.push({ id: 'later', sum: 200 }); const batch = ctx.data.appMeta.find(x => x.type === 'importBatch');
  assert.equal(await ctx.importReviewUndo(batch.id), true);
  assert.equal(ctx.data.records[0].fuelIssued, 10); assert.equal(ctx.data.fuelPurchases.length, 0); assert.equal(ctx.data.payments[0].sum, 200);
  assert.equal(ctx.data.appMeta.find(x => x.type === 'importTemplate').name, 'Supplier');
  assert.equal(ctx.data.appMeta.find(x => x.type === 'importBatch').status, 'undone');
});
test('a failed undo save restores both imported data and applied batch status', async () => {
  const ctx = runtime(), plan = planFuel(ctx); pending(ctx, plan); await ctx.importReviewApply();
  const batch = ctx.data.appMeta[0], before = JSON.stringify(ctx.data); ctx.persist = false;
  assert.equal(await ctx.importReviewUndo(batch.id), false); assert.equal(JSON.stringify(ctx.data), before);
});
test('undo rejects subsequent edits to any batch row and newly added dependent rows', async () => {
  for (const edit of [ctx => ctx.data.records[0].note = 'later edit', ctx => ctx.data.repairs = [{ id: 'later', recordId: 'r', note: 'new dependency' }]]) {
    const ctx = runtime(), plan = planFuel(ctx); pending(ctx, plan); await ctx.importReviewApply(); const batch = ctx.data.appMeta[0]; edit(ctx);
    const before = JSON.stringify(ctx.data); assert.equal(await ctx.importReviewUndo(batch.id), false); assert.equal(ctx.writes, 1); assert.equal(JSON.stringify(ctx.data), before);
  }
});
test('undoing a created vehicle is blocked when a later trip references it', async () => {
  const ctx = runtime(); const plan = vm.runInContext("importReviewBuildPlan({identity:'database-A'},()=>data.vehicles.push({id:'new',plate:'NEW'}))", ctx);
  pending(ctx, plan); await ctx.importReviewApply(); const batch = ctx.data.appMeta[0];
  ctx.data.records.push({ id: 'later', vehicleId: 'new', date: '2026-10-03' });
  assert.equal(await ctx.importReviewUndo(batch.id), false); assert.equal(ctx.data.vehicles.length, 2);
});
test('provider templates map by header and occurrence across reordered columns', () => {
  const ctx = runtime();
  const columns = ctx.importReviewTemplateColumns(['Дата', 'Сумма', 'Сумма', 'Литры'], { date: 0, sum: 2, qty: 3, ignored: -1 });
  const mapping = ctx.importReviewTemplateMapping({ columns }, ['Литры', 'Сумма', 'Дата', 'Сумма']);
  assert.deepEqual(JSON.parse(JSON.stringify(mapping)), { date: 2, sum: 3, qty: 0 });
  assert.equal(ctx.importReviewTemplateMapping({ columns }, ['Дата', 'Литры']).sum, -1);
});
test('preview and history escape untrusted filenames and values', () => {
  const ctx = runtime(), attack = '<img src=x onerror="bad()">';
  ctx.attack = attack;
  const plan = vm.runInContext("importReviewBuildPlan({identity:'database-A',fileName:attack},()=>{data.vehicles[0].make=attack})", ctx);
  ctx.importReviewPresent(plan);
  assert.equal(ctx.lastHtml.includes('<img'), false); assert.ok(ctx.lastHtml.includes('&lt;img'));
});
