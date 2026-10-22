const { test } = require('node:test');
const assert = require('node:assert/strict');
const policies = require('../assets/core/platform-policies.js');
const calendar = require('../assets/core/business-calendar.js');
const repairs = require('../assets/core/repair-operations.js'),documents = require('../assets/core/document-engine.js');
const at = {id:'synthetic-readiness-proof',now:'2026-10-21T12:00:00.000Z',today:'2026-10-21',actor:{id:'synthetic-admin',name:'Synthetic admin',role:'admin'}};
function fixture() { return { vehicles:[{id:'v'},{id:'v2'}],drivers:[{id:'d'},{id:'d2'}],parts:[{id:'p'}],dispatchJobs:[],workOrders:[],partMovements:[] }; }
function job(patch = {}) { return { id:'job',status:'assigned',assetRef:'v:v',driverId:'d',start:'2026-10-21T09:00',end:'2026-10-21T11:00',...patch }; }
function movement(patch = {}) { return { id:'issue',partId:'p',date:'2026-10-20',kind:'issue',qty:3,...patch }; }
function confirmedJobs(db) {
  return {...db,...calendar.canonicalizeIntervals({...db,dispatchJobs:[]},{dispatchJobs:db.dispatchJobs},at)};
}

test('assigned work requires a valid interval, asset and driver but adjacent work can share resources', () => {
  const before = fixture();
  for (const patch of [{assetRef:''},{driverId:''}])
    assert.throws(() => policies.validateChanges(before,confirmedJobs({...before,dispatchJobs:[job(patch)]}),at),{code:'POLICY_VIOLATION'});
  for(const patch of [{start:'2026-10-21T12:00'},{end:'2026-02-30T12:00'}])
    assert.throws(()=>policies.validateChanges(before,{...before,dispatchJobs:[job(patch)]},at),error=>/^CALENDAR_/.test(error.code));
  assert.equal(policies.validateChanges(before,confirmedJobs({...before,dispatchJobs:[job(),job({id:'adjacent',start:'2026-10-21T11:00',end:'2026-10-21T13:00'})]}),at),true);
});

test('simultaneous reservations cannot double-book either equipment or a driver', () => {
  const before = fixture();
  for (const patch of [{id:'second',driverId:'d2'},{id:'second',assetRef:'v:v2'}])
    assert.throws(() => policies.validateChanges(before,confirmedJobs({...before,dispatchJobs:[job(),job(patch)]}),at),error=>error.issues.some(issue=>/OVERLAP/.test(issue.code)));
  assert.equal(policies.validateChanges(before,confirmedJobs({...before,dispatchJobs:[job(),job({id:'cancelled',status:'cancelled'})]}),at),true);
  assert.equal(policies.validateChanges(before,confirmedJobs({...before,dispatchJobs:[job(),job({id:'archived',archived:true})]}),at),true);
});

test('confirmed work and accepted repairs retain their existing required acceptance details', () => {
  const before = fixture();
  assert.throws(() => policies.validateChanges(before,{...before,dispatchJobs:[job({status:'confirmed'})]},at));
  let db=before;const context=id=>({id,now:'2026-10-21T12:00:00.000Z',today:'2026-10-21',actor:{id:'synthetic-mechanic',name:'Synthetic mechanic',role:'mechanic'}});
  for(const [id,input]of [['order',{action:'saveOrder',payload:{title:'Actual synthetic repair',target:{section:'vehicles',id:'v'},downtime:{mode:'interval',from:'2026-10-20T09:00'}},reason:'Actual user entered defect'}],['approve',{action:'approve',orderId:'order',reason:'Explicit approved repair'}],['start',{action:'start',orderId:'order',reason:'Actual repair started'}]]){
    const review=repairs.preview(db,input,{today:'2026-10-21'});assert.equal(review.canApply,true,JSON.stringify(review.issues));const command={type:'RepairAction',version:1,input:{...input,reviewFingerprint:review.fingerprint}},plan=repairs.plan(db,command.input,context(id)),next={...db,...plan.sections};assert.equal(policies.validateChanges(db,next,{...context(id),commandIntent:{command}}),true);db=next;
  }
  const payload={acceptedBy:'Inspector',result:'Done',downtimeTo:'2026-10-20T12:00',completedAt:'2026-10-20T12:00'},input={action:'post',section:'workOrders',id:'order',payload},snapshot=JSON.stringify(db);
  for(const field of ['acceptedBy','result','downtimeTo','completedAt'])assert.equal(documents.preview(db,{...input,payload:{...payload,[field]:''}},{today:'2026-10-21'}).canPost,false,field);
  assert.equal(JSON.stringify(db),snapshot);const review=documents.preview(db,input,{today:'2026-10-21'});assert.equal(review.canPost,true,JSON.stringify(review.issues));const command={type:'DocumentAction',version:1,input:{...input,reviewFingerprint:review.fingerprint}},plan=documents.plan(db,command.input,context('accept')),next={...db,...plan.sections};assert.equal(policies.validateChanges(db,next,{...context('accept'),commandIntent:{command}}),true);assert.equal(next.workOrders[0].status,'accepted');assert.equal(next.workOrders[0].acceptedBy,'Inspector');assert.equal(next.workOrders[0].acceptedAt,'2026-10-21T12:00:00.000Z');
});

test('unchanged historical deficiencies permit attachments and independent work while accepted content stays frozen', () => {
  const before = fixture(); before.workOrders=[{id:'legacy',status:'accepted',result:'Historical'}];
  before.dispatchJobs=[job({id:'legacy-job',driverId:''})];
  const note=structuredClone(before);note.workOrders[0].note='Clarified description';assert.throws(()=>policies.validateChanges(before,note,at));
  const after=structuredClone(before);after.workOrders[0].attachments=[{id:'evidence',name:'Подтверждение'}];after.dispatchJobs[0].title='Clarified title';
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
