const { test } = require('node:test');
const assert = require('node:assert/strict');
const application = require('../assets/core/application-engine.js');
const fuel = require('../assets/core/fuel-engine.js');
const balances = values => fuel.recordBalanceMap(Object.entries(values));

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
  assert.deepEqual(engine.query('fuelRecords', db, options), balances({ 'target-one':45 }));
  assert.equal(JSON.stringify(db), original);
  db.records.push({ id:'other-two', vehicleId:'other', date:'2026-09-02', fuelActual:25 });
  db.vehicles[1].fuelBalance = 200;
  let before = JSON.stringify(db);
  assert.deepEqual(engine.query('fuelRecords', db, options), balances({ 'target-one':45 }));
  assert.equal(JSON.stringify(db), before);
  assert.equal(engine.stats().calculations, 1); assert.equal(engine.stats().hits, 1);
  db.records.push({ id:'target-two', vehicleId:'target', date:'2026-09-02', fuelActual:2 });
  before = JSON.stringify(db);
  assert.deepEqual(engine.query('fuelRecords', db, options), balances({ 'target-one':45, 'target-two':43 }));
  assert.equal(JSON.stringify(db), before); assert.equal(engine.stats().calculations, 2);
  db.records[0].fuelActual = 7;
  assert.deepEqual(engine.query('fuelRecords', db, options), balances({ 'target-one':43, 'target-two':41 }));
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
  const context = { identity:'database-one', readable:['vehicles', 'records', 'fuelPurchases'] };
  assert.deepEqual(engine.query('fuelRecords', db, options, context), balances({ 'target-one':45 }));
  assert.deepEqual(engine.query('fuelRecords', db, options, { ...context, readable:['vehicles'] }), {});
  assert.deepEqual(engine.query('fuelRecords', db, options, { ...context, identity:'database-two' }), balances({ 'target-one':45 }));
  assert.equal(engine.stats().calculations, 3);
});

test('journal cache observes own supplier returns without invalidating another vehicle or changing consumption',()=>{
  const engine=application.create(),db={...fixture(),fuelPurchases:[]},options={vehicleId:'target'},context={identity:'returns-db',readable:['vehicles','records','fuelPurchases']};
  assert.deepEqual(engine.query('fuelRecords',db,options,context),balances({'target-one':45}));
  db.fuelPurchases.push({id:'other-return',operationKind:'return',vehicleId:'other',date:'2026-09-01',qty:-10,grade:'ДТ'});
  assert.deepEqual(engine.query('fuelRecords',db,options,context),balances({'target-one':45}));assert.equal(engine.stats().calculations,1);assert.equal(engine.stats().hits,1);
  db.fuelPurchases.push({id:0,operationKind:'return',vehicleId:'target',date:'2026-09-01',qty:-10,grade:'ДТ'});
  assert.deepEqual(engine.query('fuelRecords',db,options,context),balances({'target-one':35}));assert.equal(engine.stats().calculations,2);
  db.fuelPurchases[1].qty=-12;
  assert.deepEqual(engine.query('fuelRecords',db,options,context),balances({'target-one':33}));assert.equal(engine.stats().calculations,3);assert.equal(db.records[0].fuelActual,5);assert.equal(Object.hasOwn(db.records[0],'fuelIssued'),false);
  assert.throws(()=>engine.query('fuelRecords',{...db,fuelPurchases:{}},options,context),{code:'INVALID_SNAPSHOT'});
});

test('captured and permission-limited journal queries retain the supplier-return dependency',()=>{
  const engine=application.create(),db={...fixture(),fuelPurchases:[{id:'refund',operationKind:'return',vehicleId:'target',date:'2026-09-01',qty:-10,grade:'ДТ'}]},options={vehicleId:'target'},context={identity:'returns-db',readable:['vehicles','records','fuelPurchases']},snapshot=engine.capture(db,context);
  assert.ok(snapshot.sections.includes('fuelPurchases'));assert.deepEqual(engine.querySnapshot('fuelRecords',snapshot,options),balances({'target-one':35}));
  db.fuelPurchases[0].qty=-12;assert.deepEqual(engine.querySnapshot('fuelRecords',snapshot,options),balances({'target-one':35}));assert.deepEqual(engine.querySnapshot('fuelRecords',engine.capture(db,context),options),balances({'target-one':33}));
  const restricted={...context,readable:['vehicles','records']},unknown=balances({'target-one':null});assert.deepEqual(engine.query('fuelRecords',db,options,restricted),unknown);assert.deepEqual(engine.querySnapshot('fuelRecords',engine.capture(db,restricted),options),unknown);assert.deepEqual(engine.query('fuelRecords',db,{...options,readable:['vehicles','records']},context),unknown);
  const wildcard={...context,readable:['*']};assert.deepEqual(engine.query('fuelRecords',db,options,wildcard),balances({'target-one':33}));assert.deepEqual(engine.querySnapshot('fuelRecords',engine.capture(db,wildcard),options),balances({'target-one':33}));assert.deepEqual(engine.query('fuelRecords',db,{...options,readable:['*']},restricted),unknown);
});
