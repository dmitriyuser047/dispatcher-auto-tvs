const { test } = require('node:test');
const assert = require('node:assert/strict');
const policies = require('../assets/core/platform-policies.js');
const at = { now:'2026-10-21T12:00:00Z' };
function fixture() { return { vehicles:[{id:'v'},{id:'v2'}],drivers:[{id:'d'},{id:'d2'}],parts:[{id:'p'}],dispatchJobs:[],workOrders:[],partMovements:[] }; }
function job(patch = {}) { return { id:'job',status:'assigned',assetRef:'v:v',driverId:'d',start:'2026-10-21T09:00',end:'2026-10-21T11:00',...patch }; }
function movement(patch = {}) { return { id:'issue',partId:'p',date:'2026-10-20',kind:'issue',qty:3,...patch }; }

test('assigned work requires a valid interval, asset and driver but adjacent work can share resources', () => {
  const before = fixture();
  for (const patch of [{assetRef:''},{driverId:''},{start:'2026-10-21T12:00'},{end:'2026-02-30T12:00'}])
    assert.throws(() => policies.validateChanges(before,{...before,dispatchJobs:[job(patch)]},at),{code:'POLICY_VIOLATION'});
  assert.equal(policies.validateChanges(before,{...before,dispatchJobs:[job(),job({id:'adjacent',start:'2026-10-21T11:00',end:'2026-10-21T13:00'})]},at),true);
});

test('simultaneous reservations cannot double-book either equipment or a driver', () => {
  const before = fixture();
  for (const patch of [{id:'second',driverId:'d2'},{id:'second',assetRef:'v:v2'}])
    assert.throws(() => policies.validateChanges(before,{...before,dispatchJobs:[job(),job(patch)]},at),error=>error.issues.some(issue=>/OVERLAP/.test(issue.code)));
  assert.equal(policies.validateChanges(before,{...before,dispatchJobs:[job(),job({id:'cancelled',status:'cancelled'})]},at),true);
  assert.equal(policies.validateChanges(before,{...before,dispatchJobs:[job(),job({id:'archived',archived:true})]},at),true);
});

test('confirmed work and accepted repairs retain their existing required acceptance details', () => {
  const before = fixture();
  assert.throws(() => policies.validateChanges(before,{...before,dispatchJobs:[job({status:'confirmed'})]},at));
  const accepted = {id:'order',status:'accepted',assetRef:'v:v',acceptedBy:'Inspector',result:'Done',downtimeFrom:'2026-10-20T09:00',downtimeTo:'2026-10-20T12:00'};
  assert.equal(policies.validateChanges(before,{...before,workOrders:[accepted]},at),true);
  for(const field of ['acceptedBy','result','downtimeTo']) assert.throws(() => policies.validateChanges(before,{...before,workOrders:[{...accepted,[field]:''}]},at));
});

test('unchanged historical deficiencies do not block descriptive edits or independent valid work', () => {
  const before = fixture(); before.workOrders=[{id:'legacy',status:'accepted',result:'Historical'}];
  before.dispatchJobs=[job({id:'legacy-job',driverId:''})];
  const after=structuredClone(before);after.workOrders[0].note='Clarified description';after.dispatchJobs[0].title='Clarified title';
  assert.equal(policies.validateChanges(before,after,at),true);
  after.workOrders[0].result='';assert.throws(()=>policies.validateChanges(before,after,at));
});

test('an atomic batch cannot spend the same warehouse receipt twice', () => {
  const before=fixture();before.partMovements=[movement({id:'receipt',kind:'receipt',qty:5,date:'2026-10-01'})];
  const after=structuredClone(before);after.partMovements.push(movement(),movement({id:'issue-two'}));
  assert.throws(()=>policies.validateChanges(before,after,at),error=>error.issues.some(issue=>issue.code==='PART_STOCK_DEFICIT'));
  after.partMovements[2].qty=2;assert.equal(policies.validateChanges(before,after,at),true);
});

test('backdated issues cannot rely on later receipts and removal of a consumed receipt cannot create a deficit', () => {
  const before=fixture();before.partMovements=[movement({id:'receipt',kind:'receipt',qty:5,date:'2026-10-21'})];
  assert.throws(()=>policies.validateChanges(before,{...before,partMovements:[...before.partMovements,movement()]},at));
  before.partMovements[0].date='2026-10-01';before.partMovements.push(movement());
  assert.throws(()=>policies.validateChanges(before,{...before,partMovements:[before.partMovements[1]]},at));
});

test('zero and negative warehouse quantities are rejected; receipt plus issue can be one balanced command', () => {
  const before=fixture();
  for(const qty of [0,-1])assert.throws(()=>policies.validateChanges(before,{...before,partMovements:[movement({kind:'receipt',qty})]},at));
  assert.equal(policies.validateChanges(before,{...before,partMovements:[movement({id:'receipt',kind:'receipt',qty:3}),movement()]},at),true);
});

test('legacy negative stock can be improved without fabricating the remaining correction', () => {
  const before=fixture();before.partMovements=[movement({qty:10})];
  const after=structuredClone(before);after.partMovements.push(movement({id:'return',kind:'return',qty:3,date:'2026-10-01'}));
  assert.equal(policies.validateChanges(before,after,at),true);
  after.partMovements[1].kind='writeoff';assert.throws(()=>policies.validateChanges(before,after,at));
});
