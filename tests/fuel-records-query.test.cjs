const { test } = require('node:test');
const assert = require('node:assert/strict');
const application = require('../assets/core/application-engine.js');

function fixture() {
  return {
    vehicles:[{ id:'target', fuelGrade:'ДТ', fuelBalance:50, norm:10 }, { id:'other', fuelGrade:'ДТ', fuelBalance:100, norm:20 }],
    records:[{ id:'target-one', vehicleId:'target', date:'2026-09-01', fuelActual:5 },
      { id:'other-one', vehicleId:'other', date:'2026-09-01', fuelActual:10 }]
  };
}

test('vehicle journal cache ignores other vehicles and recalculates for a fresh own operation', () => {
  const engine = application.create(), db = fixture(), options = { vehicleId:'target' };
  const original = JSON.stringify(db);
  assert.deepEqual(engine.query('fuelRecords', db, options), { 'target-one':45 });
  assert.equal(JSON.stringify(db), original);
  db.records.push({ id:'other-two', vehicleId:'other', date:'2026-09-02', fuelActual:25 });
  db.vehicles[1].fuelBalance = 200;
  let before = JSON.stringify(db);
  assert.deepEqual(engine.query('fuelRecords', db, options), { 'target-one':45 });
  assert.equal(JSON.stringify(db), before);
  assert.equal(engine.stats().calculations, 1); assert.equal(engine.stats().hits, 1);
  db.records.push({ id:'target-two', vehicleId:'target', date:'2026-09-02', fuelActual:2 });
  before = JSON.stringify(db);
  assert.deepEqual(engine.query('fuelRecords', db, options), { 'target-one':45, 'target-two':43 });
  assert.equal(JSON.stringify(db), before); assert.equal(engine.stats().calculations, 2);
  db.records[0].fuelActual = 7;
  assert.deepEqual(engine.query('fuelRecords', db, options), { 'target-one':43, 'target-two':41 });
  assert.equal(engine.stats().calculations, 3);
});

test('vehicle journal projection preserves runtime argument and section validation', () => {
  const engine = application.create(), options = { vehicleId:'target' };
  assert.throws(() => engine.query('fuelRecords', { ...fixture(), records:{} }, options), { code:'INVALID_SNAPSHOT' });
  assert.throws(() => engine.query('fuelRecords', { ...fixture(), vehicles:'invalid' }, options), { code:'INVALID_SNAPSHOT' });
  assert.throws(() => engine.query('fuelRecords', fixture(), []), { code:'INVALID_ARGUMENT' });
  assert.throws(() => engine.query('fuelRecords', null, options), { code:'INVALID_ARGUMENT' });
});

test('vehicle journal projection retains identity and permission boundaries', () => {
  const engine = application.create(), db = fixture(), options = { vehicleId:'target' };
  const context = { identity:'database-one', readable:['vehicles', 'records'] };
  assert.deepEqual(engine.query('fuelRecords', db, options, context), { 'target-one':45 });
  assert.deepEqual(engine.query('fuelRecords', db, options, { ...context, readable:['vehicles'] }), {});
  assert.deepEqual(engine.query('fuelRecords', db, options, { ...context, identity:'database-two' }), { 'target-one':45 });
  assert.equal(engine.stats().calculations, 3);
});
