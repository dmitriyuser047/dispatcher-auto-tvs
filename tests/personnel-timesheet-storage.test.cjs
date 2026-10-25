'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const documents=require('../assets/core/personnel-timesheet-document'),storage=require('../electron/storage'),sqlite=require('../electron/sqlite-storage.cjs'),schema=require('../assets/core/platform-schema'),scope=require('../assets/core/access-scope'),policy=require('../assets/core/access-policy'),integrity=require('../assets/core/platform-integrity'),access=require('../electron/access-control');
const now='2026-10-25T18:30:00.000Z',admin={id:'synthetic-timesheet-admin',name:'Synthetic admin',role:'admin'},dispatcher={id:'synthetic-timesheet-dispatcher',name:'Synthetic dispatcher',role:'dispatcher'};
const database=extra=>({...Object.fromEntries(schema.sections.map(name=>[name,[]])),...extra});
function model(kind='operator',site='North'){return {version:1,kind,from:'2026-10-01',to:'2026-10-15',org:'Synthetic organization',title:'Synthetic personnel timesheet',rows:[{id:'synthetic-row',name:'Synthetic employee',position:kind==='operator'?'Машинист ДЭС':'Водитель',personnelNumber:'001',department:'ОП ИКГ',site,days:{'2026-10-01':11,'2026-10-02':'МВ','2026-10-15':'Д','2026-10-16':11},note:''}]};}
function record(kind='operator',id='synthetic-timesheet'){return documents.makeRecord(model(kind),{id,now});}
function fixture(t,format,extra={}){const parent=fs.realpathSync.native(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'tvs-timesheet-storage-')),pin=fs.lstatSync(root),dir=path.join(root,'db'),data=database({drivers:[{id:0,name:'Unchanged synthetic employee',personnelRoles:['operator']}],shiftReports:[],genRecords:[],records:[],...extra});if(format==='sqlite')sqlite.create(dir,{data});else storage.createJson(dir,{data});t.after(()=>{const after=fs.lstatSync(root);assert.equal(path.dirname(root),parent);assert.match(path.basename(root),/^tvs-timesheet-storage-/);assert.equal(after.isSymbolicLink(),false);assert.equal(after.dev,pin.dev);assert.equal(after.ino,pin.ino);fs.rmSync(root,{recursive:true,force:true});});return {dir,data};}
function write(dir,rows,principal=dispatcher,base=storage.readSnapshot(dir)){return storage.writeSections(dir,{databaseToken:base.databaseToken,base:base.revisions,sections:{assetDocuments:rows}},{principal,now});}

test('timesheet document owns a clone and preserves typed document IDs without creating employees or shift facts',()=>{
 const value=model(),doc=documents.makeRecord(value,{id:0,now});value.rows[0].days['2026-10-01']=24;assert.equal(doc.id,0);assert.equal(doc.personnelTimesheet.rows[0].days['2026-10-01'],11);assert.equal(doc.date,'2026-10-01');assert.equal(doc.org,value.org);assert.equal(doc.kind,'personnel-timesheet');assert.equal(documents.validateRecord(doc),doc);const next=documents.makeRecord(doc.personnelTimesheet,{previous:doc,id:0,now:'2026-10-26T00:00:00.000Z'});assert.equal(next.createdAt,now);assert.equal(next.updatedAt,'2026-10-26T00:00:00.000Z');
 const db=database({assetDocuments:[doc,record('driver','drivers-document'),{id:'ordinary',title:'Ordinary document'}]});assert.equal(documents.list(db,'operator').length,1);assert.equal(documents.list(db,'driver').length,1);assert.equal(documents.list(db).length,2);
});

test('trusted workflow rejects malformed payloads, inconsistent owner metadata and conversion to an ordinary document',()=>{
 const doc=record(),before=database({assetDocuments:[doc]});
 for(const mutate of [row=>{row.kind='ordinary';delete row.personnelTimesheet;},row=>{delete row.personnelTimesheet;},row=>{row.org='Forged owner';},row=>{row.date='2026-10-16';},row=>{row.personnelTimesheet.to='2026-11-01';},row=>{row.personnelTimesheet.rows[0].days['2026-10-01']=-1;},row=>{row.driverId=0;}]){
  const changed=structuredClone(doc);mutate(changed);assert.throws(()=>integrity.validateChanges(before,{...before,assetDocuments:[changed]}));
 }
 assert.equal(integrity.validateChanges(before,{...before,assetDocuments:[{...doc,note:'Ordinary attachment note'}]}),true);
 const broken=structuredClone(doc);delete broken.personnelTimesheet.rows;const legacy=database({assetDocuments:[broken]});assert.equal(documents.validateChanges(legacy,structuredClone(legacy)),true,'Unchanged deficiencies do not block independent work');
});

test('all row sites belong to the same document access decision and a supplied scope snapshot cannot bypass it',()=>{
 const doc=record(),south={...structuredClone(doc.personnelTimesheet.rows[0]),id:'south',site:'South'};doc.personnelTimesheet.rows.push(south);doc.scopeSnapshot={version:1,complete:true,owners:[{org:'Synthetic organization',site:'North'}]};
 const db=database({assetDocuments:[doc]}),bound=scope.createResolver(db),ctx={readable:schema.sections,writable:schema.sections,resolve:(name,row)=>bound.resolve(name,row)},north={version:1,grants:[{org:'Synthetic organization',site:'North'}]},whole={version:1,grants:[{org:'Synthetic organization',site:{any:true}}]};
 assert.equal(policy.permits(north,'assetDocuments','read',doc,ctx),false);assert.equal(policy.permits(whole,'assetDocuments','read',doc,ctx),true);assert.deepEqual(policy.projectRows(north,'assetDocuments',[doc],ctx),[]);
 doc.personnelTimesheet.rows=[{...south,site:''}];const blankCtx={...ctx,resolve:(name,row)=>scope.resolve(database(),'assetDocuments',row)};assert.equal(policy.permits(north,'assetDocuments','read',doc,blankCtx),false);assert.equal(policy.permits(whole,'assetDocuments','read',doc,blankCtx),true);
 doc.personnelTimesheet.org='Other owner';assert.equal(policy.permits(whole,'assetDocuments','read',doc,blankCtx),false);
});

for(const format of ['json','sqlite'])test(format+' persists and reopens both kinds, rejects stale edits, read-only roles and malformed writes atomically',t=>{
 const {dir}=fixture(t,format),initial=storage.readSnapshot(dir),operator=record(),driver=record('driver','synthetic-drivers');
 assert.equal(write(dir,[operator,driver]).ok,true);const saved=storage.readSnapshot(dir);assert.deepEqual(saved.data.assetDocuments,[operator,driver]);assert.ok(saved.revisions.assetDocuments>initial.revisions.assetDocuments);for(const name of schema.sections)if(!['assetDocuments','auditLog'].includes(name))assert.deepEqual(saved.data[name],initial.data[name],name);
 assert.equal(documents.list(storage.readAll(dir),'operator')[0].personnelTimesheet.rows[0].days['2026-10-01'],11);
 const update=documents.makeRecord({...operator.personnelTimesheet,title:'Revised synthetic timesheet'},{previous:operator,id:operator.id,now});assert.equal(write(dir,[update,driver]).ok,true);const revised=storage.readSnapshot(dir),stale=write(dir,[operator,driver],dispatcher,saved);assert.equal(stale.ok,false);assert.ok(stale.conflicts.includes('assetDocuments'));assert.deepEqual(storage.readSnapshot(dir),revised);
 assert.throws(()=>write(dir,[operator,driver],{...dispatcher,role:'viewer'}),{code:'ACCESS_DENIED'});assert.deepEqual(storage.readSnapshot(dir),revised);
 const malformed=structuredClone(update);malformed.personnelTimesheet.rows[0].days['2026-10-01']=-1;assert.throws(()=>write(dir,[malformed,driver]));assert.deepEqual(storage.readSnapshot(dir),revised);
});

test('timesheets use current document permissions and do not widen access ceilings',()=>{
 for(const role of ['admin','dispatcher','mechanic'])assert.equal(access.authorize({role},'write','assetDocuments'),true,role);
 for(const role of ['viewer','accountant'])assert.equal(access.authorize({role},'write','assetDocuments'),false,role);
 assert.equal(access.authorize({...admin,writable:['drivers']},'write','assetDocuments'),false);
});

test('generic employee exchange cannot introduce a timesheet payload through ordinary document fields',()=>{
 const planner=require('../assets/core/import-planner'),fixture=require('./fixtures/import-v1-before-planner-extraction.json'),source=structuredClone(fixture.cases.find(value=>value.profile==='personnel').decoded);
 source.sections=['assetDocuments'];source.rows=[{rowId:'synthetic-timesheet-source',section:'assetDocuments',normalized:record(),raw:{title:'Synthetic imported timesheet'}}];
 const normalized=planner.normalize('personnel',source);assert.ok(normalized.rows[0].issues.some(issue=>issue.code==='IMPORT_CANONICAL_METADATA'&&issue.severity==='error'));
});

function rosterFixtureData(){
 const org='Synthetic organization',drivers=[
  {id:0,name:'Numeric zero employee',org,site:'North',personnelNumber:'0001',personnelRoles:['driver'],employmentStatus:'active',phone:'Unchanged phone',note:'Unchanged card'},
  {id:'0',name:'String zero employee',org,site:'North',personnelNumber:'0002',personnelRoles:['driver'],employmentStatus:'active',driverLicenseNumber:'Unchanged licence'},
 ];
 const value=model('driver');value.rows=[
  {...value.rows[0],id:0,name:drivers[0].name,employeeId:0,personnelNumber:'0001',department:org},
  {...value.rows[0],id:'0',name:drivers[1].name,employeeId:'0',personnelNumber:'0002',department:org},
  {...value.rows[0],id:'new-person-row',name:'New synthetic driver',personnelNumber:'0003',department:org},
 ];
 return {drivers,assetDocuments:[documents.makeRecord(value,{id:0,now}),{id:'0',title:'Unchanged ordinary document',note:'Unchanged attachment metadata'}]};
}
function rosterRequest(base,id='synthetic-timesheet-roster'){
 const core=require('../assets/core/personnel-timesheet-roster'),source=base.data.assetDocuments.find(row=>row.id===0);
 const plan=core.preview(base.data,source.personnelTimesheet,{createIds:[{rowId:0,id:'unused-zero-number'},{rowId:'0',id:'unused-zero-string'},{rowId:'new-person-row',id:'synthetic-new-driver'}]});
 assert.equal(plan.canApply,true,JSON.stringify(plan.items));assert.deepEqual(plan.createdIds,['synthetic-new-driver']);
 const linked=documents.makeRecord(plan.model,{previous:source,id:0,now:'2026-10-25T18:31:00.000Z'});
 return {plan,payload:{databaseToken:base.databaseToken,base:base.revisions,operation:{id},sections:{drivers:plan.drivers,assetDocuments:base.data.assetDocuments.map(row=>row.id===0?linked:row)}}};
}
for(const format of ['json','sqlite']){
 test(format+' roster creates cards and links the saved timesheet in one durable replayable transaction',t=>{
  const {dir}=fixture(t,format,rosterFixtureData()),before=storage.readSnapshot(dir),{plan,payload}=rosterRequest(before);
  const ack=storage.writeSections(dir,payload,{principal:dispatcher,now});assert.equal(ack.ok,true);assert.equal(ack.operationReceipt.id,payload.operation.id);
  assert.deepEqual(ack.canonicalSections.drivers,plan.drivers);assert.deepEqual(ack.canonicalSections.assetDocuments,payload.sections.assetDocuments);
  const after=storage.readSnapshot(dir);assert.equal(after.data.drivers.length,3);assert.deepEqual(after.data.drivers.slice(0,2),before.data.drivers);
  assert.deepEqual(after.data.assetDocuments.find(row=>row.id===0).personnelTimesheet.rows.map(row=>row.employeeId),[0,'0','synthetic-new-driver']);
  assert.deepEqual(after.data.assetDocuments.find(row=>row.id==='0'),before.data.assetDocuments.find(row=>row.id==='0'));
  assert.deepEqual(after.data.assetDocuments[0].personnelTimesheet.rows.map(({employeeId,...row})=>row),before.data.assetDocuments[0].personnelTimesheet.rows.map(({employeeId,...row})=>row),'Actual hours, attendance codes, names, sites and personnel numbers are unchanged');
  for(const name of schema.sections)if(!['drivers','assetDocuments','auditLog'].includes(name))assert.deepEqual(after.data[name],before.data[name],name+' is not a timesheet-to-roster result');
  assert.ok(after.revisions.drivers>before.revisions.drivers);assert.ok(after.revisions.assetDocuments>before.revisions.assetDocuments);
  const reopened=storage.readAll(dir);assert.deepEqual(reopened.drivers,after.data.drivers);assert.deepEqual(reopened.assetDocuments,after.data.assetDocuments);
  const replay=storage.writeSections(dir,payload,{principal:dispatcher,now:'invalid clock is not consulted for an exact durable replay'});assert.equal(replay.ok,true);assert.equal(replay.operationReceipt.status,'replayed');assert.deepEqual(storage.readSnapshot(dir),after,'A retried acknowledgement creates no second card, revision or audit entry');
  const reused=structuredClone(payload);reused.sections.drivers[2].name='Different intent';assert.throws(()=>storage.writeSections(dir,reused,{principal:dispatcher,now}),{code:'OPERATION_REUSED'});assert.deepEqual(storage.readSnapshot(dir),after);
  const repeated=require('../assets/core/personnel-timesheet-roster').preview(after.data,after.data.assetDocuments[0].personnelTimesheet,{createIds:[{rowId:0,id:'unused-1'},{rowId:'0',id:'unused-2'},{rowId:'new-person-row',id:'unused-3'}]});assert.equal(repeated.canApply,true);assert.deepEqual(repeated.createdIds,[]);assert.deepEqual(repeated.drivers,after.data.drivers);
 });
 test(format+' roster rejects a denied, stale or malformed half of the combined write without partially adding employees',t=>{
  const {dir}=fixture(t,format,rosterFixtureData()),before=storage.readSnapshot(dir),{payload}=rosterRequest(before,'synthetic-roster-rejected');
  assert.throws(()=>storage.writeSections(dir,payload,{principal:{...dispatcher,writable:['assetDocuments']},now}),{code:'ACCESS_DENIED'});assert.deepEqual(storage.readSnapshot(dir),before);
  const bad=structuredClone(payload);bad.sections.assetDocuments[0].personnelTimesheet.rows[2].days['2026-10-01']=-1;assert.throws(()=>storage.writeSections(dir,bad,{principal:dispatcher,now}));assert.deepEqual(storage.readSnapshot(dir),before,'Invalid document leaves both document and roster untouched');
  const edited=structuredClone(before.data.drivers);edited[0].phone='Concurrent approved phone change';const concurrent=storage.writeSections(dir,{databaseToken:before.databaseToken,base:before.revisions,sections:{drivers:edited}},{principal:dispatcher,now});assert.equal(concurrent.ok,true);
  const changed=storage.readSnapshot(dir),stale=storage.writeSections(dir,payload,{principal:dispatcher,now});assert.equal(stale.ok,false);assert.ok(stale.conflicts.includes('drivers'));assert.deepEqual(storage.readSnapshot(dir),changed,'Stale roster prevents the linked document from committing');
  assert.equal(changed.data.drivers.some(row=>row.id==='synthetic-new-driver'),false);assert.equal(Object.hasOwn(changed.data.assetDocuments[0].personnelTimesheet.rows[2],'employeeId'),false);
 });
}
