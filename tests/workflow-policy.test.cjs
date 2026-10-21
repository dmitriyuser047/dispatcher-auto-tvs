'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const policy = require('../assets/core/workflow-policy.js');
const schema = require('../assets/core/platform-schema.js');

function fixture() {
  return { ...Object.fromEntries(schema.sections.map(section => [section,[]])),
    vehicles:[{id:'v',status:'На ходу'},{id:'other',status:'На ходу'}], generators:[{id:'g',status:'В работе'}],
    drivers:[{id:'d',skills:'B, C'},{id:'other',skills:'C, CE'}] };
}
function job(patch = {}) {
  return { id:'job',status:'assigned',assetRef:'v:v',driverId:'d',start:'2026-10-21T09:00',end:'2026-10-21T18:00',...patch };
}
function violation(callback, code) {
  assert.throws(callback, error => error.code === 'WORKFLOW_VIOLATION' && error.issues.some(issue => issue.code === code));
}
function frozen(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
}
const codes = { status:'WORKFLOW_DISPATCH_ASSET_STATUS', repair:'WORKFLOW_DISPATCH_REPAIR_DOWNTIME',
  document:'WORKFLOW_DISPATCH_DOCUMENT_EXPIRED',skills:'WORKFLOW_DISPATCH_SKILLS_REQUIRED',maintenance:'WORKFLOW_DISPATCH_MAINTENANCE' };

test('CommonJS and standalone browser expose one frozen pure workflow policy API', () => {
  assert.equal(policy.apiVersion,1); assert.equal(Object.isFrozen(policy),true);
  const context = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assets/core/workflow-policy.js'),'utf8'),context);
  assert.equal(context.WorkflowPolicy.apiVersion,1); assert.equal(Object.isFrozen(context.WorkflowPolicy),true);
  const before = frozen(fixture()), next = frozen({ ...fixture(),dispatchJobs:[job()] });
  assert.equal(policy.validateChanges(before,next),true);
  assert.equal(context.WorkflowPolicy.validateChanges(before,next),true);
  assert.equal(policy.inspect(next).issues.length,0);
});

test('all assigned states reject a newly used vehicle in repair, written off, sold or damaged', () => {
  for (const status of ['assigned','started','done','confirmed']) for (const assetStatus of ['В ремонте','Списан','После ДТП','Продан']) {
    const before = fixture();before.vehicles[0].status = assetStatus;
    violation(() => policy.validateChanges(before,{...before,dispatchJobs:[job({status})]}),codes.status);
  }
  for (const status of ['new','cancelled']) {
    const before = fixture();before.vehicles[0].status='В ремонте';
    assert.equal(policy.validateChanges(before,{...before,dispatchJobs:[job({status})]}),true);
  }
});

test('effective equipment status uses the most recent assignment covering the job start date', () => {
  const before = fixture();
  before.assetAssignments=[
    {id:'old',assetRef:'v:v',from:'2026-10-01',status:'В ремонте'},
    {id:'current',assetRef:'v:v',from:'2026-10-21',to:'2026-10-21',status:'На ходу'},
    {id:'future',assetRef:'v:v',from:'2026-10-22',status:'Списан'},
  ];
  const next={...before,dispatchJobs:[job()]};
  assert.equal(policy.validateChanges(before,next),true);
  next.assetAssignments=next.assetAssignments.map(row => row.id==='current'?{...row,archived:true}:row);
  violation(() => policy.validateChanges(before,next),codes.status);
});

test('editing a vehicle or an assignment cannot newly make existing assigned work unavailable', () => {
  const before = fixture();before.dispatchJobs=[job()];
  const next=structuredClone(before);next.vehicles[0].status='В ремонте';
  violation(() => policy.validateChanges(before,next),codes.status);
  next.vehicles[0].status='На ходу';next.assetAssignments=[{id:'a',assetRef:'v:v',from:'2026-10-21',status:'Продан'}];
  violation(() => policy.validateChanges(before,next),codes.status);
});

test('an old equipment-status problem allows descriptions and narrowing, but not a new time or asset use', () => {
  const before=fixture();before.vehicles[0].status='В ремонте';before.dispatchJobs=[job()];
  const next=structuredClone(before);next.dispatchJobs[0].title='Historical clarification';next.vehicles[0].note='Investigating';
  assert.equal(policy.validateChanges(before,next),true);
  next.dispatchJobs[0].start='2026-10-21T10:00';next.dispatchJobs[0].end='2026-10-21T17:00';
  assert.equal(policy.validateChanges(before,next),true);
  next.dispatchJobs[0].end='2026-10-21T19:00';violation(() => policy.validateChanges(before,next),codes.status);
});

test('approved and repairing downtime blocks new dispatch work while boundaries and other equipment remain usable', () => {
  for (const status of ['approved','repairing']) {
    const before=fixture();before.workOrders=[{id:'repair',assetRef:'v:v',status,downtimeFrom:'2026-10-21T10:00',downtimeTo:'2026-10-21T11:00'}];
    violation(() => policy.validateChanges(before,{...before,dispatchJobs:[job()]}),codes.repair);
    assert.equal(policy.validateChanges(before,{...before,dispatchJobs:[job({end:'2026-10-21T10:00'})]}),true);
    assert.equal(policy.validateChanges(before,{...before,dispatchJobs:[job({start:'2026-10-21T11:00'})]}),true);
    assert.equal(policy.validateChanges(before,{...before,dispatchJobs:[job({assetRef:'v:other'})]}),true);
  }
  const before=fixture();before.workOrders=[{id:'repair',assetRef:'v:v',status:'accepted',downtimeFrom:'2026-10-21T10:00'}];
  assert.equal(policy.validateChanges(before,{...before,dispatchJobs:[job()]}),true);
});

test('downtime uses actual instants across offsets and open-ended repair periods', () => {
  const before=fixture();before.workOrders=[{id:'repair',assetRef:'v:v',status:'approved',downtimeFrom:'2026-10-21T10:00+03:00',downtimeTo:'2026-10-21T11:00+03:00'}];
  violation(() => policy.validateChanges(before,{...before,dispatchJobs:[job({start:'2026-10-21T07:30Z',end:'2026-10-21T08:30Z'})]}),codes.repair);
  before.workOrders[0].downtimeTo='';
  violation(() => policy.validateChanges(before,{...before,dispatchJobs:[job({start:'2026-10-22T07:30Z',end:'2026-10-22T08:30Z'})]}),codes.repair);
});

test('old repair conflicts can shrink, and changing the repair schedule cannot introduce or expand conflicts', () => {
  const before=fixture();before.dispatchJobs=[job()];
  before.workOrders=[{id:'repair',assetRef:'v:v',status:'approved',downtimeFrom:'2026-10-21T10:00',downtimeTo:'2026-10-21T12:00'}];
  const next=structuredClone(before);next.workOrders[0].downtimeFrom='2026-10-21T11:00';
  assert.equal(policy.validateChanges(before,next),true);
  next.workOrders[0].downtimeTo='2026-10-21T13:00';violation(() => policy.validateChanges(before,next),codes.repair);
  const valid=fixture();valid.dispatchJobs=[job()];
  violation(() => policy.validateChanges(valid,{...valid,workOrders:before.workOrders}),codes.repair);
});

test('mandatory documents are checked through job end and match only present asset or employee references', () => {
  const before=fixture();before.assetDocuments=[{id:'asset-doc',assetRef:'v:v',mandatory:true,expires:'2026-10-20'}];
  violation(() => policy.validateChanges(before,{...before,dispatchJobs:[job()]}),codes.document);
  before.assetDocuments[0]={id:'driver-doc',driverId:'d',mandatory:true,expires:'2026-10-20'};
  violation(() => policy.validateChanges(before,{...before,dispatchJobs:[job()]}),codes.document);
  before.assetDocuments[0].expires='2026-10-21';assert.equal(policy.validateChanges(before,{...before,dispatchJobs:[job()]}),true);
  before.assetDocuments=[{id:'unrelated',assetRef:'v:other',mandatory:true,expires:'2020-01-01'},
    {id:'unbound',mandatory:true,expires:'2020-01-01'},{id:'optional',driverId:'d',mandatory:false,expires:'2020-01-01'}];
  assert.equal(policy.validateChanges(before,{...before,dispatchJobs:[job({driverId:undefined})]}),true);
  before.assetDocuments=[{id:'unbound-driver',driverId:'other',mandatory:true,expires:'2020-01-01'}];
  assert.equal(policy.validateChanges(before,{...before,dispatchJobs:[job({assetRef:undefined})]}),true);
});

test('archived documents are excluded and old expirations permit partial corrections without being worsened', () => {
  const before=fixture();before.dispatchJobs=[job()];before.assetDocuments=[{id:'doc',driverId:'d',mandatory:true,expires:'2020-01-01'}];
  const next=structuredClone(before);next.assetDocuments[0].expires='2026-10-20';next.dispatchJobs[0].title='Clarified';
  assert.equal(policy.validateChanges(before,next),true);
  next.assetDocuments[0].expires='2019-01-01';violation(() => policy.validateChanges(before,next),codes.document);
  next.assetDocuments[0].archived=true;assert.equal(policy.validateChanges(before,next),true);
  const valid=fixture();valid.dispatchJobs=[job()];
  violation(() => policy.validateChanges(valid,{...valid,assetDocuments:before.assetDocuments}),codes.document);
});

test('employee skill requirements use comma-separated case-insensitive distinct tokens', () => {
  const before=fixture();before.drivers[0].skills=' B , C, c ';
  assert.equal(policy.validateChanges(before,{...before,dispatchJobs:[job({requirements:'c, b, C'})]}),true);
  violation(() => policy.validateChanges(before,{...before,dispatchJobs:[job({requirements:'C, CE'})]}),codes.skills);
  before.dispatchJobs=[job({requirements:'C'})];
  const next=structuredClone(before);next.drivers[0].skills='B';
  violation(() => policy.validateChanges(before,next),codes.skills);
});

test('legacy skill gaps can be reduced independently while new missing skills or reassignment are blocked', () => {
  const before=fixture();before.dispatchJobs=[job({requirements:'C, CE, ADR'})];
  const next=structuredClone(before);next.drivers[0].skills='B, C, CE';
  assert.equal(policy.validateChanges(before,next),true);
  next.dispatchJobs[0].requirements='C, CE, ADR, D';violation(() => policy.validateChanges(before,next),codes.skills);
  next.dispatchJobs[0].requirements='C, CE, ADR';next.dispatchJobs[0].driverId='other';
  violation(() => policy.validateChanges(before,next),codes.skills);
});

test('planned unfinished vehicle and generator maintenance block every overlapping calendar day', () => {
  for (const [section,field,ref] of [['vehicleTo','vehicleId','v:v'],['toRecords','generatorId','g:g']]) {
    const before=fixture();before[section]=[{id:'to',[field]:ref.slice(2),planned:true,date:'2026-10-21'}];
    violation(() => policy.validateChanges(before,{...before,dispatchJobs:[job({assetRef:ref})]}),codes.maintenance);
    const next={...before,dispatchJobs:[job({assetRef:ref})],[section]:before[section].map(row=>({...row,completedAt:'2026-10-21'}))};
    assert.equal(policy.validateChanges(before,next),true);
    next[section][0].completedAt='';next[section][0].date='2026-10-22';
    assert.equal(policy.validateChanges(before,next),true);
    next[section][0].date='2026-10-21';next[section][0].planned=false;
    assert.equal(policy.validateChanges(before,next),true);
  }
});

test('maintenance changes cannot create a conflict in an unchanged dispatch job', () => {
  const before=fixture();before.dispatchJobs=[job()];before.vehicleTo=[{id:'to',vehicleId:'v',date:'2026-10-22',planned:true}];
  const next=structuredClone(before);next.vehicleTo[0].date='2026-10-21';
  violation(() => policy.validateChanges(before,next),codes.maintenance);
  const old=structuredClone(next);next.vehicleTo[0].note='Historical clarification';
  assert.equal(policy.validateChanges(old,next),true);
});

test('archived jobs do not participate in resource-readiness checks, but reopening them rechecks current conditions', () => {
  const before=fixture();before.vehicles[0].status='Списан';
  const next={...before,dispatchJobs:[job({archived:true})]};assert.equal(policy.validateChanges(before,next),true);
  violation(() => policy.validateChanges(next,{...next,dispatchJobs:[job({archived:false})]}),codes.status);
});

test('only completion details in scope are required; minimal legacy headers remain valid', () => {
  const before=fixture();
  for (const [section,row,field,code] of [
    ['opsTasks',{id:'task',status:'closed'},'result','WORKFLOW_TASK_RESULT_REQUIRED'],
    ['shiftReports',{id:'shift',status:'accepted'},'acceptedBy','WORKFLOW_SHIFT_ACCEPTANCE_REQUIRED'],
    ['shiftReports',{id:'shift',status:'rejected'},'rejectionReason','WORKFLOW_SHIFT_REJECTION_REQUIRED'],
  ]) {
    for (const value of [undefined,'','   ',null]) violation(() => policy.validateChanges(before,{...before,[section]:[{...row,[field]:value}]}),code);
    assert.equal(policy.validateChanges(before,{...before,[section]:[{...row,[field]:'Documented'}]}),true);
    const old={...before,[section]:[row]}, next={...old,[section]:[{...row,note:'Clarify legacy record'}]};
    assert.equal(policy.validateChanges(old,next),true);
  }
});

test('unchanged unrelated deficiencies never block an independent valid update', () => {
  const before=fixture();before.vehicles[0].status='В ремонте';before.dispatchJobs=[job({requirements:'CE'})];
  before.opsTasks=[{id:'task',status:'closed'}];before.shiftReports=[{id:'shift',status:'rejected'}];
  const next=structuredClone(before);next.generators[0].name='Generator description';next.drivers[0].phone='123';
  assert.equal(policy.validateChanges(before,next),true);
});

test('unreadable dependencies reveal no row IDs, values or proofs, including when full hidden data is supplied', () => {
  const before=fixture();before.workOrders=[{id:'SECRET-REPAIR',assetRef:'v:v',status:'repairing',downtimeFrom:'2026-10-21T10:00'}];
  before.assetDocuments=[{id:'SECRET-DOCUMENT',driverId:'d',mandatory:true,expires:'2020-01-01',number:'SECRET-NUMBER'}];
  before.drivers[0].skills='SECRET-SKILLS';before.dispatchJobs=[job({requirements:'C'})];
  const context={readable:schema.sections.filter(section=>!['workOrders','assetDocuments','drivers'].includes(section))};
  const report=policy.inspect(before,context), serialized=JSON.stringify(report);
  for (const secret of ['SECRET-REPAIR','SECRET-DOCUMENT','SECRET-NUMBER','SECRET-SKILLS','proof','evidence']) assert.equal(serialized.includes(secret),false);
  assert.equal(report.counts.error,0);assert.equal(report.counts.warning,3);
  const next=structuredClone(before);next.dispatchJobs[0].title='Unrelated clarification';
  assert.equal(policy.validateChanges(before,next,context),true);
  next.dispatchJobs[0].end='2026-10-21T19:00';
  assert.throws(()=>policy.validateChanges(before,next,context),error=>{
    assert.equal(error.code,'WORKFLOW_VIOLATION');assert.equal(error.issues.every(issue=>issue.code==='WORKFLOW_DEPENDENCY_UNAVAILABLE'),true);
    assert.equal(JSON.stringify(error.issues).includes('SECRET-'),false);return true;
  });
});

test('schema-projected snapshots report unavailable checks rather than fabricating missing dependency rows', () => {
  const full=fixture();full.dispatchJobs=[job({requirements:'C'})];
  const readable=['dispatchJobs','vehicles','assetAssignments','opsTasks','shiftReports'];
  const projected=Object.fromEntries(schema.sections.map(section=>[section,readable.includes(section)?full[section]:[]]));
  const report=policy.inspect(projected,{readable});
  assert.equal(report.counts.error,0);assert.equal(report.counts.warning,4);
  assert.equal(policy.validateChanges(projected,structuredClone(projected),{readable}),true);
  const blank=fixture();violation(()=>policy.validateChanges(blank,projected,{readable}),'WORKFLOW_DEPENDENCY_UNAVAILABLE');
  assert.equal(policy.inspect(full,{readable:['opsTasks']}).issues.length,0);
});

test('invalid legacy timestamps or unbound document references do not throw or invent readiness failures', () => {
  const before=fixture(), next=structuredClone(before);
  next.dispatchJobs=[job({start:'bad legacy time'})];next.assetDocuments=[{id:'doc',mandatory:true,expires:'bad legacy date'}];
  assert.equal(policy.validateChanges(before,next),true);
  next.dispatchJobs=[job()];next.workOrders=[{id:'order',status:'approved',assetRef:'v:v',downtimeFrom:'bad'}];
  assert.equal(policy.validateChanges(before,next),true);
});
