const { test } = require('node:test');
const assert = require('node:assert/strict');
const wo = require('../assets/js/25o-work-orders.js');
const today = '2026-10-18';
const fixture = () => ({ repairs: [{ id: 'r', cost: 100, invoiceDate: '2026-10-01', description: 'Ремонт', paid: false }], vehicleTo: [{ id: 'r', cost: 200, date: today, planned: true }], toRecords: [], payments: [] });

test('work order states preserve the meaning of legacy planned and completed records', () => {
  assert.equal(wo.woStatus({ planned: true }), 'assigned');
  assert.equal(wo.woStatus({ paid: false }), 'completed');
  const planned = { id: 't', planned: true, date: '2026-10-12', nextKm: 10000 };
  const assigned = wo.woApplyFields(planned, { workStatus: 'in_progress', downtimeStart: '2026-10-16' }, 'vehicleTo', today);
  const completed = wo.woApplyFields(assigned, { workStatus: 'completed' }, 'vehicleTo', today);
  assert.equal(assigned.planned, true);
  assert.equal(completed.planned, false);
  assert.equal(completed.completedAt, today);
  assert.equal(completed.downtimeEnd, today);
  assert.equal(completed.nextKm, 10000);
  assert.equal(wo.woDowntime(completed, today), 2);
  assert.equal(planned.workStatus, undefined);
});

test('invalid dates and impossible downtime are rejected before changing a work order', () => {
  for (const fields of [{ workStatus: 'bad' }, { workStatus: 'assigned', expectedReady: '2026-02-30' },
    { workStatus: 'completed', downtimeEnd: today }, { workStatus: 'completed', downtimeStart: today, downtimeEnd: '2026-10-01' },
    { workStatus: 'in_progress', downtimeStart: '2026-10-01', downtimeEnd: today }]) assert.throws(() => wo.woApplyFields({}, fields, 'repairs', today));
  assert.equal(wo.woValidDate('2024-02-29'), true);
  assert.equal(wo.woValidDate('2026-02-29'), false);
  assert.equal(wo.woDowntime({}, today), null);
});

test('legacy invoice links remain scoped to their section even when IDs are equal', () => {
  const db = fixture();
  db.payments = [{ id: 'p', source: 'repair', sourceId: 'r', sum: 100 }];
  assert.equal(wo.woSource(db.payments[0], db), db.repairs[0]);
  assert.equal(wo.woLinkedPayments(db, 'vehicleTo', 'r').length, 0);
  assert.equal(wo.woLinkedPayments(db, 'repairs', 'r').length, 1);
  assert.equal(wo.woSourceSection({ source: 'generatorTo' }, db), 'toRecords');
});

test('source invoices carry accounting identifiers, due dates and generator links without mutating the source', () => {
  const db = fixture();
  db.toRecords.push({ id: 'gto', generatorId: 'g', cost: 1234.56, type: 'Замена масла', date: today, invoiceNo: 'A-1', serviceCenter: 'Сервис', paymentDueDate: '2026-11-01', paid: true });
  const before = JSON.stringify(db), invoice = wo.woInvoiceFromSource(db, 'toRecords', 'gto', 'p', today);
  assert.equal(invoice.source, 'generatorTo');
  assert.equal(invoice.sourceSection, 'toRecords');
  assert.equal(invoice.generatorId, 'g');
  assert.equal(invoice.invoiceNo, 'A-1');
  assert.equal(invoice.paidAmount, 1234.56);
  assert.equal(invoice.dueDate, '2026-11-01');
  assert.equal(JSON.stringify(db), before);
  db.payments.push(invoice);
  assert.throws(() => wo.woInvoiceFromSource(db, 'toRecords', 'gto', 'p2', today), /уже существует/);
});

test('partial settlements accumulate exact cents, retain entries and never exceed the invoice', () => {
  const invoice = { id: 'p', sum: 100.3, paid: false };
  const first = wo.woAddSettlement(invoice, { id: 's1', amount: '30.10', date: today, note: 'Аванс' });
  assert.equal(first.paidAmount, 30.1);
  assert.equal(first.paid, false);
  assert.equal(wo.woPaymentBalance(first), 70.2);
  const final = wo.woAddSettlement(first, { id: 's2', amount: '70.20', date: today });
  assert.equal(final.paidAmount, 100.3);
  assert.equal(final.paid, true);
  assert.equal(final.settlements.length, 2);
  assert.equal(invoice.settlements, undefined);
  for (const amount of [-1, 0, 'bad', 71]) assert.throws(() => wo.woAddSettlement(first, { amount, date: today }));
  assert.throws(() => wo.woAddSettlement(first, { amount: 1, date: '2026-02-30' }));
});

test('legacy paid flags, explicit partial payments and overdue invoices calculate correctly', () => {
  const db = fixture();
  assert.equal(wo.woPaidAmount({ sum: 100, paid: true }), 100);
  assert.equal(wo.woPaidAmount({ sum: 100, paid: true, paidAmount: 20 }), 20);
  const invoice = { sum: 100, paidAmount: 20, dueDate: '2026-10-17' };
  assert.equal(wo.woPaymentState(invoice, db, today).overdue, true);
  assert.equal(wo.woPaymentState({ ...invoice, dueDate: today }, db, today).overdue, false);
  assert.equal(wo.woPaymentState({ ...invoice, paidAmount: 100 }, db, today).overdue, false);
});

test('settlements update source paid only after full agreement; cost discrepancies stay explicit', () => {
  const db = fixture();
  db.payments.push({ id: 'p', source: 'repair', sourceId: 'r', sum: 100, paidAmount: 40 });
  wo.woSyncSourcePaid(db, 'repairs', 'r'); assert.equal(db.repairs[0].paid, false);
  assert.equal(wo.woSourceBalance(db.repairs[0], 'repairs', db), 60);
  db.payments[0].paidAmount = 100;
  wo.woSyncSourcePaid(db, 'repairs', 'r'); assert.equal(db.repairs[0].paid, true);
  db.repairs[0].cost = 150;
  wo.woSyncSourcePaid(db, 'repairs', 'r'); assert.equal(db.repairs[0].paid, false);
  assert.equal(wo.woPaymentState(db.payments[0], db, today).amountMismatch, true);
  assert.equal(db.payments[0].sum, 100);
});

test('missing sources and duplicate links remain visible rather than silently merging invoices', () => {
  const db = fixture(), invoice = { id: 'p', sourceSection: 'vehicleTo', sourceId: 'missing', sum: 200 };
  assert.equal(wo.woPaymentState(invoice, db, today).sourceMissing, true);
  invoice.sourceId = 'r'; db.payments.push(invoice, { ...invoice, id: 'p2' });
  assert.equal(wo.woPaymentState(invoice, db, today).duplicateLink, true);
  wo.woSyncSourcePaid(db, 'vehicleTo', 'r');
  assert.equal(db.vehicleTo[0].paid, undefined);
});

test('plan rebuilding may replace untouched automatic forecasts but must retain operational work and linked invoices', () => {
  const db = fixture(), auto = { id: 'auto', planned: true, note: 'Регламент' };
  assert.equal(wo.woKeepPlanned(auto, db), false);
  for (const field of [{ workStatus: 'assigned' }, { workStatus: 'in_progress' }, { performer: 'Иванов' }, { serviceCenter: 'СТО' }, { materials: 'Масло' }]) {
    assert.equal(wo.woKeepPlanned({ ...auto, ...field }, db), true);
  }
  db.payments.push({ source: 'to', sourceId: 'auto', sum: 50 });
  assert.equal(wo.woKeepPlanned(auto, db), true);
  assert.equal(wo.woKeepPlanned({ ...auto, planned: false }, db), true);
});

test('completing an automatic forecast advances the next service and records the actual completion date', () => {
  const plan = { id: 't', planned: true, date: '2026-11-01', odometer: 10000, nextKm: 10000, nextOdometerAbs: 10000, nextDate: '2026-11-01' };
  const done = wo.woFinishRecord(plan, wo.woApplyFields(plan, { workStatus: 'completed' }, 'vehicleTo', today), 'vehicleTo', today);
  assert.equal(done.date, today); assert.equal(done.completedAt, today); assert.equal(done.plannedFor, '2026-11-01');
  assert.equal(done.nextOdometerAbs, 20000); assert.equal(done.nextDate, null); assert.equal(done.planned, false);
  assert.equal(plan.nextOdometerAbs, 10000);
});
