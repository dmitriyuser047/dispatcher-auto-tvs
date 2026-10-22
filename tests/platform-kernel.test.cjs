const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const kernel = require('../assets/core/platform-kernel.js');
const schema = require('../assets/core/platform-schema.js');

const now = () => '2026-10-21T18:00:00.000Z';
function fixture() { return { vehicles:[{ id:'v',plate:'SYNTHETIC',org:'A',fuelGrade:'ДТ',fuelBalance:100,norm:10 }], records:[] }; }
function context(patch = {}) {
  return { identity:'session-A', actor:{ id:'synthetic-user',name:'Synthetic user',role:'admin' },
    readable:schema.sections.slice(), writable:schema.sections.slice(), revisions:{ vehicles:5,records:8 }, ...patch };
}
function changed(note = 'Checked') { const db = fixture(); db.vehicles[0].note = note; return db; }
function command(id = 'operation-one', note = 'Checked') { return { id, previous:fixture(), next:changed(note), options:{} }; }
function runtime(config = {}) { return kernel.createRuntime({ getContext:() => context(), now, ...config }); }
function deferred() { let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes; reject=no; }); return { promise,resolve,reject }; }

test('a portable immutable plan records only changed sections, row fields and expected revisions', () => {
  const before = fixture(), next = changed(), sourceBytes = JSON.stringify(before), targetBytes = JSON.stringify(next);
  const plan = kernel.prepare(before, next, { ...context(),id:'prepare-one',now:now() });
  assert.deepEqual(plan.changed, ['vehicles']); assert.deepEqual(plan.base, { vehicles:5 });
  assert.deepEqual(plan.sourceSnapshot, { vehicles:before.vehicles });
  assert.deepEqual(plan.rowChanges.map(row => ({ section:row.section,recordId:row.recordId,action:row.action,fields:row.fields })),
    [{ section:'vehicles',recordId:'v',action:'update',fields:['note'] }]);
  assert.ok(Object.isFrozen(plan)); assert.ok(Object.isFrozen(plan.sections.vehicles[0]));
  assert.equal(JSON.stringify(before), sourceBytes); assert.equal(JSON.stringify(next), targetBytes);
  next.vehicles[0].note = 'Later edit'; before.vehicles[0].plate = 'Later source';
  assert.equal(plan.sections.vehicles[0].note, 'Checked'); assert.equal(plan.sourceSnapshot.vehicles[0].plate, 'SYNTHETIC');
});

test('a section patch retains unchanged relations and supports finite numeric legacy identities', () => {
  const before = fixture(); before.vehicles[0].id = 7;
  const plan = kernel.prepare(before, { records:[{ id:9,vehicleId:7,date:'2026-10-01',km:10,fuelActual:1 }] }, { ...context(),id:'numeric',now:now() });
  assert.deepEqual(plan.changed, ['records']); assert.equal(plan.rowChanges[0].recordId, 9);
  assert.equal(plan.rowChanges[0].action, 'create'); assert.deepEqual(plan.base, { records:8 });
});

test('natural monthly identities remain stable when rows without explicit IDs are reordered', () => {
  const before = fixture(); before.monthlyFuel = [{ vehicleId:'v',month:'2026-09',cardNumber:'123',liters:1 },{ vehicleId:'v',month:'2026-09',cardNumber:'456',liters:2 }];
  const plan = kernel.prepare(before, { monthlyFuel:[before.monthlyFuel[1],{ ...before.monthlyFuel[0],liters:3 }] }, { ...context(),id:'natural-month',now:now() });
  assert.equal(plan.rowChanges.length, 1); assert.equal(plan.rowChanges[0].action, 'update');
  assert.match(plan.rowChanges[0].key, /composite:/); assert.deepEqual(plan.rowChanges[0].fields, ['liters']);
});

test('shared integrity rejects a broken multi-section command without modifying either input', () => {
  const previous = fixture(), next = changed(); next.records.push({ id:'new',vehicleId:'missing',date:'2026-10-01',km:1 });
  const before = JSON.stringify(previous), target = JSON.stringify(next);
  assert.throws(() => kernel.prepare(previous, next, { ...context(),id:'broken',now:now() }), error => typeof error.code === 'string');
  assert.equal(JSON.stringify(previous), before); assert.equal(JSON.stringify(next), target);
});

test('section rights, malformed data and unknown writes fail with structured reasons', () => {
  assert.throws(() => kernel.prepare(fixture(), changed(), { ...context({ writable:[] }),id:'denied' }), { code:'ACCESS_DENIED' });
  assert.throws(() => kernel.prepare(fixture(), { records:{} }, { ...context(),id:'bad-section' }), { code:'INVALID_SECTION' });
  assert.throws(() => kernel.prepare(fixture(), { unregistered:[] }, { ...context(),id:'unknown' }), { code:'UNKNOWN_SECTION' });
  assert.throws(() => kernel.prepare(fixture(), changed(), { ...context({ revisions:{ vehicles:-1 } }),id:'bad-revision' }), { code:'INVALID_REVISION' });
  const cyclic = changed(); cyclic.vehicles[0].loop = cyclic;
  assert.throws(() => kernel.prepare(fixture(), cyclic, { ...context(),id:'cycle' }), { code:'INVALID_SNAPSHOT' });
});

test('canonical SHA256 digests agree with Node and ignore client audit hints in both maps', () => {
  const payload = { base:{ vehicles:5,auditLog:999 },sections:{ vehicles:[{ id:'v',note:'Синтетика 🚚' }],auditLog:[{ actor:'client-choice' }] } };
  const expectedBody = { base:{ vehicles:5 },sections:{ vehicles:payload.sections.vehicles } };
  const expected = 'sha256:' + crypto.createHash('sha256').update(kernel.stableSerialize(expectedBody), 'utf8').digest('hex');
  assert.equal(kernel.requestDigest(payload), expected);
  assert.equal(kernel.requestDigest({ sections:payload.sections,base:payload.base }), expected);
  assert.notEqual(kernel.requestDigest({ ...payload,base:{ vehicles:6 } }), expected);
});

test('semantic command digest binds immutable intent and every dependency revision with a distinct protocol domain',()=>{
  const command={type:'IssueFuel',version:1,input:{tankId:7,target:{section:'vehicles',id:'7'},date:'2026-09-01',qty:923.537,reason:'Synthetic issue'}};
  const payload={protocolVersion:1,base:{tanks:3,records:4,vehicles:5},command,databaseToken:'synthetic-A',operation:{id:'intent-1'}};
  const expected='sha256:'+crypto.createHash('sha256').update(kernel.stableSerialize({kind:'semantic-command',version:1,base:payload.base,command}),'utf8').digest('hex');
  assert.equal(kernel.requestDigest(payload),expected);
  assert.equal(kernel.requestDigest({...payload,databaseToken:'synthetic-B',operation:{id:'different-transport-id'}}),expected);
  assert.notEqual(kernel.requestDigest({...payload,base:{...payload.base,tanks:4}}),expected);
  assert.notEqual(kernel.requestDigest({...payload,command:{...command,input:{...command.input,qty:923.538}}}),expected);
  assert.notEqual(kernel.requestDigest({...payload,command:{...command,input:{...command.input,target:{section:'vehicles',id:7}}}}),expected);
  assert.throws(()=>kernel.requestDigest({...payload,sections:{records:[]}}),{code:'INVALID_ARGUMENT'});
  assert.throws(()=>kernel.requestDigest({...payload,protocolVersion:2}),{code:'INVALID_ARGUMENT'});
});

test('commands persist serially and duplicate in-flight operation IDs write and emit once', async () => {
  const bus = runtime(), gate = deferred(), events = [], writes = [];
  bus.subscribe(event => events.push(event));
  const first = bus.run(command('same'), async plan => { writes.push(plan.id); await gate.promise; return { ok:true,operationId:plan.id }; });
  const duplicate = bus.run(command('same'), () => { throw Error('Duplicate must not persist'); });
  const second = bus.run(command('second','Another'), async plan => { writes.push(plan.id); return { ok:true,operationId:plan.id }; });
  await Promise.resolve(); assert.deepEqual(writes, ['same']);
  gate.resolve();
  const results = await Promise.all([first, duplicate, second]);
  assert.deepEqual(writes, ['same','second']); assert.deepEqual(results.map(row => row.duplicate), [false,true,false]);
  assert.deepEqual(events.map(row => row.id), ['same','second']); assert.equal(bus.status().committed, 2); assert.equal(bus.status().deduplicated, 1);
});

test('reusing an operation ID for another body fails even while the first write is pending', async () => {
  const bus = runtime(), gate = deferred();
  const first = bus.run(command('unique','First'), async () => { await gate.promise; return { ok:true }; });
  await assert.rejects(bus.run(command('unique','Different'), () => ({ ok:true })), { code:'OPERATION_ID_REUSE' });
  gate.resolve(); await first;
});

test('a persistence failure emits no commit event and permits a deliberate retry of the same command', async () => {
  const bus = runtime(), events = []; bus.subscribe(event => events.push(event));
  await assert.rejects(bus.run(command('retry'), () => { throw Error('Synthetic disk failure'); }), { code:'PERSIST_FAILED' });
  assert.deepEqual(events, []); assert.equal(bus.status().committed, 0); assert.equal(bus.status().failed, 1);
  const receipt = await bus.run(command('retry'), () => ({ ok:true,operationId:'retry' }));
  assert.equal(receipt.duplicate, false); assert.equal(events.length, 1); assert.equal(bus.status().committed, 1);
});

test('false and ambiguous acknowledgements never count as successful writes', async () => {
  for (const ack of [false, undefined, null, {}, { ok:false }, true]) {
    const bus = runtime(), events = []; bus.subscribe(event => events.push(event));
    await assert.rejects(bus.run(command(), () => ack), { code:'UNCONFIRMED_COMMIT' });
    assert.equal(bus.status().committed, 0); assert.equal(events.length, 0);
  }
  const legacy = await runtime().run({ ...command(),options:{ allowLegacy:true } }, () => true);
  assert.equal(legacy.result, true);
});

test('canonical commands require real rows and numeric revisions even when legacy ACKs are allowed', async () => {
  const options = { allowLegacy:true,requiredCanonicalSections:['vehicles'] };
  for (const ack of [true, { ok:true }, { ok:true,canonicalSections:{ vehicles:[] },revisions:{ vehicles:'6' } }]) {
    await assert.rejects(runtime().run({ ...command(),options }, () => ack), error => ['UNCONFIRMED_COMMIT','CANONICAL_ACK_REQUIRED'].includes(error.code));
  }
  const canonical = changed('Server canonical').vehicles;
  const ack = { ok:true,operationId:'canonical',revisions:{ vehicles:6 },canonicalSections:{ vehicles:canonical } };
  const receipt = await runtime().run({ ...command('canonical'),options }, () => ack);
  canonical[0].note = 'Outside mutation';
  assert.equal(receipt.ack.canonicalSections.vehicles[0].note, 'Server canonical'); assert.ok(Object.isFrozen(receipt.ack));
});

test('a database switch while waiting for ACK or queue dispatch cannot emit events for the old session', async () => {
  let current = context(); const bus = runtime({ getContext:() => current }), gate = deferred(), writes = [], events = [];
  bus.subscribe(event => events.push(event));
  const first = bus.run(command('inflight'), async plan => { writes.push(plan.id); await gate.promise; return { ok:true }; });
  const second = bus.run(command('queued','Second'), async plan => { writes.push(plan.id); return { ok:true }; });
  await Promise.resolve(); current = context({ identity:'session-B' }); gate.resolve();
  const results = await Promise.allSettled([first,second]);
  assert.deepEqual(results.map(row => row.reason.code), ['STALE_IDENTITY','STALE_IDENTITY']);
  assert.deepEqual(writes, ['inflight']); assert.deepEqual(events, []); assert.equal(bus.status().committed, 0);
});

test('changed rights or mutable command aliases are rejected before any persistence', async () => {
  let current = context(), writes = 0;
  const bus = runtime({ getContext:() => current });
  const rights = bus.run(command('rights'), () => { writes++; return { ok:true }; });
  current = context({ writable:[] }); await assert.rejects(rights, { code:'STALE_ACCESS' });
  current = context(); const mutable = command('mutable');
  const edited = bus.run(mutable, () => { writes++; return { ok:true }; });
  mutable.next.vehicles[0].note = 'Changed while queued'; await assert.rejects(edited, { code:'STALE_COMMAND' });
  assert.equal(writes, 0);
});

test('mismatched ACK identities and operation IDs are rejected', async () => {
  for (const ack of [{ ok:true,identity:'other' }, { ok:true,operationId:'other' }])
    await assert.rejects(runtime().run(command(), () => ack), { code:'MISMATCHED_ACK' });
});

test('modern storage requires a matching committed or replayed operation receipt', async () => {
  const options = { allowLegacy:true,requireOperationReceipt:true };
  for (const ack of [true,{ok:true},{ok:true,operationReceipt:{id:'modern',status:'pending'}}])
    await assert.rejects(runtime().run({...command('modern'),options},()=>ack),error=>['UNCONFIRMED_COMMIT','OPERATION_RECEIPT_REQUIRED'].includes(error.code));
  await assert.rejects(runtime().run({...command('modern'),options},()=>({ok:true,operationReceipt:{id:'another',status:'committed'}})),{code:'MISMATCHED_ACK'});
  for (const status of ['committed','replayed']) {
    const receipt=await runtime().run({...command('modern'),options},()=>({ok:true,operationReceipt:{id:'modern',status}}));
    assert.equal(receipt.ack.operationReceipt.status,status);
  }
});

test('an unchanged modern command performs no I/O, invents no receipt and emits no commit event', async () => {
  const bus=runtime(),events=[];let writes=0;bus.subscribe(event=>events.push(event));
  const receipt=await bus.run({id:'unchanged',previous:fixture(),next:fixture(),options:{requireOperationReceipt:true}},()=>{writes++;return false;});
  assert.equal(writes,0);assert.deepEqual(events,[]);assert.deepEqual(receipt.ack,{ok:true,unchanged:true});
  assert.equal(receipt.ack.operationReceipt,undefined);assert.equal(bus.status().unchanged,1);assert.equal(bus.status().committed,0);
});

test('commit telemetry is bounded and contains no entity, financial, actor or identity payload', async () => {
  const bus = runtime({ maxReceipts:2,getContext:() => context({ identity:'CONFIDENTIAL_PROFILE',actor:{ id:'private-user',name:'PRIVATE PERSON',role:'admin' } }) });
  let calls = 0;
  const unsubscribe = bus.subscribe(() => { calls++; });
  bus.subscribe(() => { throw Error('Observer failure must not fail a committed command'); });
  for (let i = 0; i < 4; i++) await bus.run(command('limited-' + i, 'CONFIDENTIAL ENTITY ' + i), () => ({ ok:true }));
  unsubscribe(); await bus.run(command('limited-last'), () => ({ ok:true }));
  const status = bus.status(); assert.equal(calls, 4); assert.equal(status.committed, 5); assert.equal(status.recent.length, 2); assert.ok(status.retained <= 2);
  assert.ok(status.recent.every(row => row.status === 'committed'));
  assert.doesNotMatch(JSON.stringify(status), /CONFIDENTIAL|PRIVATE PERSON|private-user|fuelBalance|note/);
});

test('large completed canonical ACKs are not retained beyond the receipt content budget', async () => {
  const bus = runtime({ maxReceiptCharacters:500,maxReceipts:64 });
  const large = { ok:true,canonicalSections:{ auditLog:[{ id:'large',note:'x'.repeat(10000) }] } };
  const receipt = await bus.run(command('large'), () => large);
  assert.equal(receipt.ack.canonicalSections.auditLog[0].note.length, 10000);
  assert.equal(bus.status().retained, 0); assert.equal(bus.status().retainedCharacters, 0);
  assert.equal(bus.status().recent[0].status, 'committed');
  await bus.run(command('small'), () => ({ ok:true }));
  assert.equal(bus.status().retained, 1); assert.ok(bus.status().retainedCharacters <= 500);
});

test('a blocked database stops both new and already queued commands before any further write', async () => {
  let current = context(), writes = 0;
  const bus = runtime({ getContext:() => current });
  const pending = bus.run(command('blocked-later'), () => { writes++; return { ok:true }; });
  current = context({ blocked:true });
  await assert.rejects(pending, { code:'LOAD_BLOCKED' });
  await assert.rejects(bus.run(command('blocked-now'), () => { writes++; return { ok:true }; }), { code:'LOAD_BLOCKED' });
  assert.equal(writes, 0); assert.equal(bus.status().committed, 0);
});

test('the browser UMD build plans changes without filesystem, DOM or storage globals', () => {
  const sandbox = {}; vm.createContext(sandbox);
  for (const name of ['decimal-core.js','effective-periods.js','temporal-policy.js','platform-schema.js','platform-contracts.js','precision-policy.js','personnel-engine.js','fuel-engine.js','fuel-movement-policy.js','document-lifecycle.js','workflow-policy.js','platform-policies.js','platform-integrity.js','platform-kernel.js'])
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/core', name), 'utf8'), sandbox);
  const plan = sandbox.PlatformKernel.prepare(fixture(), changed(), { ...context(),id:'browser',now:now() });
  assert.equal(plan.changed[0], 'vehicles'); assert.equal(plan.rowChanges[0].recordId, 'v'); assert.equal(sandbox.document, undefined);
});
