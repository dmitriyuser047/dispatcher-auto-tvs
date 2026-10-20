'use strict';
// Standalone synthetic demonstration. Does not read databases, settings or files.
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const application = require('../assets/core/application-engine.js');
const db = { vehicles: [], records: [], fuelPurchases: [], fuelCards: [], monthlyFuel: [],
  tanks: [{ id: 'tank', name: 'Synthetic tank', balanceInit: 500 }], parts: [{ id: 'part', name: 'Synthetic part', unit: 'шт' }],
  partMovements: [{ id: 'stock', kind: 'receipt', partId: 'part', date: '2026-09-01', qty: 5 }],
  procurementRules: [{ id: 'rule', kind: 'part', itemId: 'part', leadDays: 2, coverDays: 7, reserveQty: 2, expectedDaily: 1 }],
  procurementOrders: [], costEntries: [], costProfiles: [] };
for (let index = 0; index < 52; index++) {
  const id = 'synthetic-v' + index;
  db.vehicles.push({ id, plate: 'SYNTHETIC-' + index, org: 'Synthetic A', fuelGrade: 'АИ-95', fuelBalance: 500, norm: 12 });
  for (let day = 1; day <= 30; day++) {
    const recordId = id + '-day' + day, date = '2026-09-' + String(day).padStart(2, '0'), issued = day % 5 ? 0 : 20;
    db.records.push({ id: recordId, vehicleId: id, date, fuelGrade: 'АИ-95', km: 100, fuelActual: 10, fuelIssued: issued });
    if (issued) db.fuelPurchases.push({ id: 'receipt-' + recordId, recordId, vehicleId: id, date, qty: issued,
      grade: 'АИ-95', sourceOrg: 'Synthetic A', sourceProvider: 'Synthetic supplier', sum: issued * 60 });
  }
}
const before = JSON.stringify(db), range = { from: '2026-09-01', to: '2026-09-30' };
const engine = application.create({ maxEntries: 64 }), context = { identity: 'synthetic-demo-only' };
const started = performance.now(), ledger = engine.query('fuel', db, range, context), firstQueryMs = performance.now() - started;
const cachedStarted = performance.now(), cached = engine.query('fuel', db, range, context), repeatedQueryMs = performance.now() - cachedStarted;
assert.equal(ledger.rows.length, 52); assert.ok(ledger.rows.every(row => row.start + row.issued + row.correction - row.spent === row.end));
assert.deepEqual(cached, ledger);
const listStarted = performance.now();
for (const vehicle of db.vehicles) {
  const balances = engine.query('fuelRecords', db, { vehicleId: vehicle.id }, context);
  assert.equal(balances[vehicle.id + '-day30'], 320);
}
const fleetQueriesMs = performance.now() - listStarted;
const report = engine.query('costs', db, range, context), plan = engine.query('procurement', db, { date: '2026-09-30' }, context);
assert.equal(plan.find(row => row.itemId === 'part').suggestedQty, 6);
assert.equal(JSON.stringify(db), before);
console.log(JSON.stringify({ syntheticOnly: true, sourceRecords: db.records.length, vehicles: db.vehicles.length,
  registeredModules: engine.describe().map(module => module.name), ledgerRows: ledger.rows.length,
  costAssets: report.rows.length, suggestedParts: 6, inputUnchanged: true,
  timingsMs: { firstFuelQuery: +firstQueryMs.toFixed(2), repeatedFuelQuery: +repeatedQueryMs.toFixed(2), allVehicleBalances: +fleetQueriesMs.toFixed(2) },
  cache: engine.stats() }, null, 2));
