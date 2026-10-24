const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const personnel = require('../assets/core/personnel-engine.js');
const policies = require('../assets/core/platform-policies.js');
const integrity = require('../assets/core/platform-integrity.js');
const at = { today:'2026-10-21', now:'2026-10-21T09:00:00Z' };
function fixture() {
  return { vehicles:[{id:'v'}], generators:[{id:'g'}], drivers:[
    {id:'d',name:'Водитель'}, {id:'o',name:'Оператор',personnelRoles:['operator']},
    {id:'both',name:'Совместитель',personnelRoles:['operator','driver']}
  ], assetAssignments:[],dispatchJobs:[],shiftReports:[] };
}
function assignment(patch = {}) { return {id:'a',assetRef:'v:v',driverId:'d',from:'2026-10-21',...patch}; }
function expectPersonnelFailure(callback, code) {
  assert.throws(callback, error => error.code==='PERSONNEL_VALIDATION' && (error.issues||error.details?.issues||[]).some(issue=>issue.code===code));
}

test('legacy personnel remain drivers without rewriting their stored rows', () => {
  const row = {id:'legacy',name:'Сотрудник',skills:'B, C'}, original = structuredClone(row);
  assert.deepEqual(personnel.rolesOf(row),['driver']);
  const roles=personnel.rolesOf(row);roles.push('operator');
  assert.deepEqual(personnel.rolesOf(row),['driver']);
  assert.deepEqual(row,original);
  assert.equal(personnel.matchesRole(row,'operator'),false);
  assert.equal(personnel.matchesRole({personnelRoles:['driver','operator']},'operator'),true);
  assert.deepEqual(personnel.rolesOf({personnelRoles:null}),[]);
  assert.deepEqual(personnel.rolesOf(null),[]);
  assert.equal(personnel.kindForAsset('v:v'),'driver');
  assert.equal(personnel.kindForAsset('g:g'),'operator');
  for(const ref of ['t:t','g:','vehicles:v',null]) assert.equal(personnel.kindForAsset(ref),null);
});

test('availability respects employee state but does not turn expired informational dates into a universal ban', () => {
  assert.deepEqual(personnel.availability({id:'old'}),{available:true,status:'active',reason:''});
  for(const status of ['vacation','sick','unavailable']) assert.equal(personnel.availability({employmentStatus:status}).available,false);
  assert.equal(personnel.availability({employmentStatus:'active',archived:true}).status,'archived');
  assert.equal(personnel.availability({employmentStatus:'active',deleted:true}).available,false);
  assert.equal(personnel.availability(null).available,false);
  assert.equal(personnel.availability({employmentStatus:'active',medicalExpires:'2020-01-01'},at.today).available,true);
});

test('new and edited personnel require names, valid distinct roles, a known state and actual ISO dates', () => {
  const before=fixture();
  for(const patch of [
    {name:''},{name:'   '},{name:42},{personnelRoles:[]},{personnelRoles:['operator','operator']},
    {personnelRoles:['admin']},{personnelRoles:'driver'},{personnelRoles:null},{employmentStatus:'busy'},
    {employmentStatus:null},{medicalExpires:'2026-02-30'},{driverLicenseExpires:'21.10.2026'},
    {briefingExpires:'2026-10-21T00:00:00Z'},{certificateExpires:123}
  ]) {
    const next=structuredClone(before);next.drivers.push({id:'new',name:'Новый сотрудник',personnelRoles:['driver'],...patch});
    assert.throws(()=>personnel.validateChanges(before,next,at),{code:'PERSONNEL_VALIDATION'});
  }
  const next=structuredClone(before);next.drivers.push({id:'new',name:'Новый оператор',personnelRoles:['operator'],employmentStatus:'active',medicalExpires:'2028-02-29',certificateExpires:''});
  assert.equal(personnel.validateChanges(before,next,at),true);
  next.drivers[0].name='';expectPersonnelFailure(()=>personnel.validateChanges(before,next,at),'PERSONNEL_NAME');
});

test('unchanged malformed legacy fields can be corrected independently, with name required when an employee is edited', () => {
  const before=fixture();before.drivers[0].medicalExpires='old date';before.drivers[0].personnelRoles=['legacy'];
  const next=structuredClone(before);next.drivers[0].phone='123';
  assert.equal(personnel.validateChanges(before,next,at),true);
  next.drivers[0].medicalExpires='another bad date';expectPersonnelFailure(()=>personnel.validateChanges(before,next,at),'PERSONNEL_DATE');
  const nameless=fixture();nameless.drivers[0].name='';
  assert.equal(personnel.validateChanges(nameless,structuredClone(nameless),at),true);
  const touched=structuredClone(nameless);touched.drivers[0].note='Описание';expectPersonnelFailure(()=>personnel.validateChanges(nameless,touched,at),'PERSONNEL_NAME');
});

test('new personnel references match the equipment role in assignments, dispatch and shift forms', () => {
  const before=fixture();
  for(const section of ['assetAssignments','dispatchJobs','shiftReports']) {
    const next=structuredClone(before);next[section]=[assignment({assetRef:'g:g',driverId:'d'})];
    expectPersonnelFailure(()=>personnel.validateChanges(before,next,at),'PERSONNEL_ROLE_MISMATCH');
    next[section][0].driverId='o';assert.equal(personnel.validateChanges(before,next,at),true);
    next[section][0].assetRef='v:v';expectPersonnelFailure(()=>personnel.validateChanges(before,next,at),'PERSONNEL_ROLE_MISMATCH');
    next[section][0].driverId='both';assert.equal(personnel.validateChanges(before,next,at),true);
  }
});

test('a new assignment cannot use a missing, archived or unavailable employee, including an atomic directory update', () => {
  const before=fixture();
  const missing=structuredClone(before);missing.assetAssignments=[assignment({driverId:'missing'})];
  expectPersonnelFailure(()=>personnel.validateChanges(before,missing,at),'PERSONNEL_NOT_FOUND');
  for(const patch of [{archived:true},{deleted:true},{employmentStatus:'vacation'},{employmentStatus:'sick'},{employmentStatus:'unavailable'}]) {
    const next=structuredClone(before);Object.assign(next.drivers[0],patch);next.assetAssignments=[assignment()];
    expectPersonnelFailure(()=>personnel.validateChanges(before,next,at),'PERSONNEL_UNAVAILABLE');
  }
  const atomic=structuredClone(before);atomic.drivers.push({id:'new',name:'Новый оператор',personnelRoles:['operator']});
  atomic.assetAssignments=[assignment({assetRef:'g:g',driverId:'new'})];assert.equal(personnel.validateChanges(before,atomic,at),true);
});

test('old generator links remain usable, while explicit reassignment or reopening requires a suitable employee', () => {
  const before=fixture();before.assetAssignments=[assignment({assetRef:'g:g'})];
  const next=structuredClone(before);next.assetAssignments[0].to='2026-10-21';next.assetAssignments[0].reason='Завершение назначения';
  assert.equal(personnel.validateChanges(before,next,at),true);
  next.assetAssignments[0].assetRef='g:other';expectPersonnelFailure(()=>personnel.validateChanges(before,next,at),'PERSONNEL_ROLE_MISMATCH');
  const archived=structuredClone(before);archived.assetAssignments[0].archived=true;
  expectPersonnelFailure(()=>personnel.validateChanges(archived,before,at),'PERSONNEL_ROLE_MISMATCH');
  const cancelled=structuredClone(before);cancelled.assetAssignments[0].status='cancelled';
  expectPersonnelFailure(()=>personnel.validateChanges(cancelled,before,at),'PERSONNEL_ROLE_MISMATCH');
});

test('employee availability changes preserve history and surface current assignment warnings', () => {
  const before=fixture();before.assetAssignments=[assignment(),assignment({id:'ended',to:'2026-10-20'})];
  before.dispatchJobs=[assignment({id:'finished',status:'confirmed'})];
  const next=structuredClone(before);next.drivers[0].employmentStatus='vacation';
  assert.equal(personnel.validateChanges(before,next,at),true);
  const issues=personnel.inspect(next,at).issues;
  assert.equal(issues.filter(issue=>issue.code==='PERSONNEL_ROLE_MISMATCH').length,0);
  assert.equal(issues.filter(issue=>issue.code==='PERSONNEL_UNAVAILABLE').length,1);
  assert.equal(issues.every(issue=>issue.severity==='warning'),true);
  next.assetAssignments[0].to='2026-10-21';assert.equal(personnel.validateChanges(before,next,at),true);
});

test('a role in use by current or future equipment links cannot be removed, including one role of a dual-role employee', () => {
  for (const [section,link] of [
    ['assetAssignments',assignment({from:'2026-12-01'})],
    ['dispatchJobs',assignment({status:'assigned',start:'2026-12-01T08:00',end:'2026-12-01T16:00'})],
    ['shiftReports',assignment({date:'2026-12-01',status:'prepared'})]
  ]) {
    const before=fixture();before.drivers[0].personnelRoles=['driver','operator'];before[section]=[link];
    const next=structuredClone(before);next.drivers[0].personnelRoles=['operator'];
    expectPersonnelFailure(()=>personnel.validateChanges(before,next,at),'PERSONNEL_ROLE_IN_USE');
    next.drivers[0].personnelRoles=['driver'];assert.equal(personnel.validateChanges(before,next,at),true);
  }
});

test('archiving requires future assignments, unfinished jobs and unaccepted past shifts to be resolved', () => {
  for (const [section,link] of [
    ['assetAssignments',assignment({from:'2026-12-01'})],
    ['assetAssignments',assignment({from:'2026-10-01',to:'2026-10-21'})],
    ['dispatchJobs',assignment({status:'assigned',start:'2026-09-01T08:00',end:'2026-09-01T16:00'})],
    ['dispatchJobs',assignment({status:'new',start:'2026-12-01T08:00',end:'2026-12-01T16:00'})],
    ['shiftReports',assignment({date:'2026-09-01',status:'prepared'})],
    ['shiftReports',assignment({date:'2026-09-01',status:'sent'})],
    ['shiftReports',assignment({date:'2026-09-01',status:'rejected'})]
  ]) {
    const before=fixture();before[section]=[link];const next=structuredClone(before);next.drivers[0].archived=true;
    expectPersonnelFailure(()=>personnel.validateChanges(before,next,at),'PERSONNEL_ARCHIVE_IN_USE');
  }
});

test('resolved historical documents do not prevent archive or role removal, and atomic close or reassignment is supported', () => {
  const before=fixture();before.assetAssignments=[assignment({from:'2026-10-01'})];
  before.dispatchJobs=[assignment({id:'done',status:'done'}),assignment({id:'confirmed',status:'confirmed'}),assignment({id:'cancelled',status:'cancelled'})];
  before.shiftReports=[assignment({id:'accepted',status:'accepted',date:'2026-12-01'})];
  const next=structuredClone(before);next.assetAssignments[0].to='2026-10-20';next.drivers[0].personnelRoles=['operator'];next.drivers[0].archived=true;
  assert.equal(personnel.validateChanges(before,next,at),true);
  next.assetAssignments[0].to='2026-10-21';expectPersonnelFailure(()=>personnel.validateChanges(before,next,at),'PERSONNEL_ARCHIVE_IN_USE');
  next.assetAssignments[0].driverId='both';assert.equal(personnel.validateChanges(before,next,at),true);
  const legacy=fixture();legacy.assetAssignments=[assignment({assetRef:'g:g'})];
  const clarified=structuredClone(legacy);clarified.drivers[0].note='Старое назначение будет проверено отдельно';
  assert.equal(personnel.validateChanges(legacy,clarified,at),true);
  assert.equal(personnel.inspect(clarified,at).issues.some(issue=>issue.code==='PERSONNEL_ROLE_MISMATCH'),true);
});

test('equipment assignment intervals are inclusive and cannot overlap through the shared engine', () => {
  const before=fixture();before.assetAssignments=[assignment({from:'2026-10-01',to:'2026-10-20'})];
  const next=structuredClone(before);next.assetAssignments.push(assignment({id:'second',driverId:'both',from:'2026-10-20'}));
  expectPersonnelFailure(()=>personnel.validateChanges(before,next,at),'PERSONNEL_ASSIGNMENT_OVERLAP');
  next.assetAssignments[1].from='2026-10-21';assert.equal(personnel.validateChanges(before,next,at),true);
  next.assetAssignments[1].from='2026-10-20';next.assetAssignments[1].assetRef='g:g';assert.equal(personnel.validateChanges(before,next,at),true);
  next.assetAssignments[1].assetRef='v:v';next.assetAssignments[1].archived=true;assert.equal(personnel.validateChanges(before,next,at),true);
});

test('historical overlap can remain during unrelated edits or shrink, but newly overlapping days are rejected', () => {
  const before=fixture();before.assetAssignments=[assignment({from:'2026-10-01',to:'2026-10-31'}),assignment({id:'second',driverId:'both',from:'2026-10-15',to:'2026-11-10'})];
  const next=structuredClone(before);next.drivers[0].phone='Контакт';next.assetAssignments[0].reason='Уточнение';
  assert.equal(personnel.validateChanges(before,next,at),true);
  next.assetAssignments[1].from='2026-10-20';assert.equal(personnel.validateChanges(before,next,at),true);
  next.assetAssignments[1].from='2026-10-14';expectPersonnelFailure(()=>personnel.validateChanges(before,next,at),'PERSONNEL_ASSIGNMENT_OVERLAP');
  next.assetAssignments[1].from='2026-10-20';next.assetAssignments[0].to='2026-11-01';expectPersonnelFailure(()=>personnel.validateChanges(before,next,at),'PERSONNEL_ASSIGNMENT_OVERLAP');
  assert.equal(personnel.inspect(before,at).issues.some(issue=>issue.code==='PERSONNEL_ASSIGNMENT_OVERLAP'),true);
  assert.equal(personnel.inspect(before,{...at,readable:['drivers']}).issues.some(issue=>issue.code==='PERSONNEL_ASSIGNMENT_OVERLAP'),false);
});

test('atomic close and replacement makes a continuous equipment assignment without double booking', () => {
  const before=fixture();before.assetAssignments=[assignment({from:'2026-10-01'})];
  const next=structuredClone(before);next.assetAssignments[0].to='2026-10-20';next.assetAssignments.push(assignment({id:'replacement',driverId:'both'}));
  assert.equal(personnel.validateChanges(before,next,at),true);
  next.assetAssignments[0].to='2026-10-21';expectPersonnelFailure(()=>personnel.validateChanges(before,next,at),'PERSONNEL_ASSIGNMENT_OVERLAP');
});

test('expiry diagnostics use the supplied calendar date and honor readable section boundaries', () => {
  const db=fixture();db.drivers[0].medicalExpires='2026-10-20';db.drivers[0].driverLicenseExpires='2026-10-21';
  db.assetAssignments=[assignment({assetRef:'g:g'})];
  const report=personnel.inspect(db,at);
  assert.equal(report.issues.filter(issue=>issue.code==='PERSONNEL_DOCUMENT_EXPIRED').length,1);
  assert.equal(report.issues.some(issue=>issue.code==='PERSONNEL_ROLE_MISMATCH'),true);
  assert.equal(personnel.inspect(db,{...at,readable:['assetAssignments']}).issues.length,0);
  assert.equal(personnel.inspect(db,{...at,readable:['drivers']}).issues.length,1);
  const next=structuredClone(db);next.assetAssignments.push(assignment({id:'new'}));
  expectPersonnelFailure(()=>personnel.validateChanges(db,next,{...at,readable:['assetAssignments']}),'PERSONNEL_ACCESS_DENIED');
});

test('shared storage policies and integrity invoke the same personnel validation', () => {
  const before=fixture(), next=structuredClone(before);next.assetAssignments=[assignment({assetRef:'g:g'})];
  expectPersonnelFailure(()=>policies.validateChanges(before,next,at),'PERSONNEL_ROLE_MISMATCH');
  expectPersonnelFailure(()=>integrity.validateChanges(before,next,at),'PERSONNEL_ROLE_MISMATCH');
  next.assetAssignments[0].driverId='o';assert.equal(integrity.validateChanges(before,next,at),true);
  const beforeText=JSON.stringify(before), nextText=JSON.stringify(next);
  personnel.inspect(next,at);personnel.validateChanges(before,next,at);
  assert.equal(JSON.stringify(before),beforeText);assert.equal(JSON.stringify(next),nextText);
});

test('native full and section writes enforce assignment and archive guards atomically before audit or revision changes', t => {
  const os=require('node:os'), path=require('node:path'), storage=require('../electron/storage.js');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-personnel-test-'));
  t.after(()=>{
    assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('tvs-personnel-test-'));
    fs.rmSync(dir,{recursive:true,force:true});
  });
  const principal={id:'test-admin',name:'Проверка',role:'admin'};
  storage.writeAll(dir,{...fixture(),records:[]},{principal,now:at.now});
  const before=storage.readSnapshot(dir), incompatible=assignment({assetRef:'g:g'});
  expectPersonnelFailure(()=>storage.writeAll(dir,{...before.data,assetAssignments:[incompatible]},{principal,now:at.now}),'PERSONNEL_ROLE_MISMATCH');
  const payload={databaseToken:storage.databaseToken(dir),base:before.revisions,sections:{assetAssignments:[incompatible]}};
  expectPersonnelFailure(()=>storage.writeSections(dir,payload,{principal,now:at.now}),'PERSONNEL_ROLE_MISMATCH');
  assert.deepEqual(storage.readSnapshot(dir),before);
  payload.sections.assetAssignments[0].driverId='o';
  assert.equal(storage.writeSections(dir,payload,{principal,now:at.now}).ok,true);
  assert.equal(storage.readAll(dir).assetAssignments[0].driverId,'o');
  const assigned=storage.readSnapshot(dir), employeeRows=structuredClone(assigned.data.drivers);
  employeeRows.find(row=>row.id==='o').archived=true;
  const archivePayload={databaseToken:storage.databaseToken(dir),base:assigned.revisions,sections:{drivers:employeeRows}};
  expectPersonnelFailure(()=>storage.writeSections(dir,archivePayload,{principal,now:at.now}),'PERSONNEL_ARCHIVE_IN_USE');
  const roles=structuredClone(assigned.data);roles.drivers.find(row=>row.id==='o').personnelRoles=['driver'];
  expectPersonnelFailure(()=>storage.writeAll(dir,roles,{principal,now:at.now}),'PERSONNEL_ROLE_IN_USE');
  assert.deepEqual(storage.readSnapshot(dir),assigned);
  archivePayload.sections.assetAssignments=assigned.data.assetAssignments.map(row=>({...row,driverId:'both'}));
  assert.equal(storage.writeSections(dir,archivePayload,{principal,now:at.now}).ok,true);
  const final=storage.readAll(dir);
  assert.equal(final.drivers.find(row=>row.id==='o').archived,true);
  assert.equal(final.assetAssignments[0].driverId,'both');
  const overlapBefore=storage.readSnapshot(dir), overlapPayload={databaseToken:storage.databaseToken(dir),base:overlapBefore.revisions,sections:{assetAssignments:[...overlapBefore.data.assetAssignments,assignment({id:'overlap',assetRef:'g:g',driverId:'both'})]}};
  expectPersonnelFailure(()=>storage.writeSections(dir,overlapPayload,{principal,now:at.now}),'PERSONNEL_ASSIGNMENT_OVERLAP');
  assert.deepEqual(storage.readSnapshot(dir),overlapBefore);
  overlapPayload.sections.assetAssignments[1].from='2026-10-22';overlapPayload.sections.assetAssignments[0].to='2026-10-21';
  assert.equal(storage.writeSections(dir,overlapPayload,{principal,now:at.now}).ok,true);
});

test('the browser and CommonJS entry points expose the same pure API', () => {
  const context=vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../assets/core/personnel-kinds.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(require.resolve('../assets/core/personnel-engine.js'),'utf8'),context);
  assert.equal(context.TvsPersonnelEngine.apiVersion,1);
  assert.equal(context.TvsPersonnelEngine.kindForAsset('g:one'),'operator');
  assert.deepEqual(Array.from(context.TvsPersonnelEngine.rolesOf({id:'old'})),['driver']);
  assert.equal(Object.isFrozen(context.TvsPersonnelEngine),true);
});
