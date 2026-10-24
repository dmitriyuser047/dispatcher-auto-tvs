'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const commands=require('../assets/core/platform-commands.js'),contracts=require('../assets/core/platform-contracts.js');
const schema=require('../assets/core/platform-schema.js'),kernel=require('../assets/core/platform-kernel.js');
const policy=require('../assets/core/fuel-movement-policy.js'),sources=require('../assets/core/financial-recognition.js');
const copy=value=>JSON.parse(JSON.stringify(value));
const actor={id:'synthetic-admin',name:'Synthetic account',role:'admin'};
const ctx=(id='semantic-test')=>({id,now:'2026-10-22T10:11:12.000Z',today:'2026-10-22',actor:{...actor}});
function db(){return {...Object.fromEntries(schema.sections.map(name=>[name,[]])),
  vehicles:[{id:7,plate:'SYNTHETIC',org:'Asset org',fuelGrade:'ДТ',fuelBalance:923.537}],
  generators:[{id:9,name:'Synthetic DES',tankId:5,fuel:'diesel',org:'DES org',fuelBalance:20}],
  tanks:[{id:5,name:'Synthetic tank',org:'Tank org',fuel:'diesel',balanceInit:923.537}],
  drivers:[{id:3,name:'Synthetic driver',personnelRoles:['driver','operator'],employmentStatus:'active'}],
  records:[{id:'original-journal',vehicleId:7,date:'2026-10-01',km:150,hours:4,fuelIssued:10,fuelActual:25,fuelUsed:20}],
  shiftReports:[{id:'shift',title:'Synthetic shift',date:'2026-10-21',assetRef:'v:7',driverId:3,status:'sent',odoStart:100,odoEnd:250,hours:4,fuelIssued:30,result:'Actual work',attachments:[{name:'Evidence',id:'file'}]}]};}
const issue=(section='vehicles',id=7)=>({type:'IssueFuel',version:1,input:{tankId:5,target:{section,id},date:'2026-10-22',qty:100,reason:'Synthetic issue'}});
const accept=()=>({type:'AcceptShift',version:1,input:{shiftId:'shift',changes:{acceptedBy:'Manual recipient',result:'Reviewed work'}}});
const assign=()=>({type:'AssignPerson',version:1,input:{driverId:3,target:{section:'vehicles',id:7},from:'2026-10-22',site:'Synthetic site',reason:'Synthetic appointment'}});
function fullPlan(source,command,metadata=ctx()){
  const planned=commands.plan(source,command,metadata);
  kernel.prepare(source,planned.sections,{id:metadata.id,identity:'synthetic-db',now:metadata.now,today:metadata.today,actor:metadata.actor,
    revisions:Object.fromEntries(schema.sections.map(name=>[name,1])),readable:schema.sections,writable:schema.sections});
  return planned;
}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

test('strict command DTOs own their input and expose only explicit types, versions and allowed business fields',()=>{
  for(const original of [issue(),accept(),assign()]){
    const parsed=commands.parseCommand(freeze(original));assert.deepEqual(parsed,original);assert.notEqual(parsed,original);assert.notEqual(parsed.input,original.input);
  }
  const variants=[null,[],{}, {type:'Other',version:1,input:{}},{...issue(),version:2},{...issue(),actor:'forged'},
    {...issue(),input:{...issue().input,qty:'100'}},{...issue(),input:{...issue().input,qty:NaN}},
    {...issue(),input:{...issue().input,qty:-1}},{...issue(),input:{...issue().input,date:'2026-02-30'}},
    {...issue(),input:{...issue().input,target:{section:'tanks',id:5}}},
    {...accept(),input:{shiftId:'shift',changes:{acceptedBy:'',status:'accepted'}}},
    {...accept(),input:{shiftId:'shift',changes:{acceptedBy:'Manual',acceptedActor:actor}}},
    {...assign(),input:{...assign().input,archived:true}},
    {...assign(),input:{...assign().input,to:'2026-01-01'}}];
  for(const value of variants)assert.throws(()=>commands.parseCommand(value),error=>typeof error.code==='string');
});

test('command JSON boundaries reject getters, hidden/symbol properties, cycles and forbidden keys without executing hooks',()=>{
  let hooks=0;const getter=issue();Object.defineProperty(getter.input,'qty',{enumerable:true,get(){hooks++;return 100;}});
  const hidden=issue();Object.defineProperty(hidden.input,'hidden',{value:'secret'});
  const symbol=issue();symbol.input[Symbol('private')]='secret';
  const cycle=issue();cycle.input.self=cycle;
  const dangerous=JSON.parse('{"type":"IssueFuel","version":1,"input":{"__proto__":{}}}');
  for(const value of [getter,hidden,symbol,cycle,dangerous])assert.throws(()=>commands.parseCommand(value));
  assert.equal(hooks,0);
  const inherited=Object.assign(Object.create({toJSON(){hooks++;return issue();}}),issue());
  assert.throws(()=>commands.parseCommand(inherited));assert.equal(hooks,0);
});

test('strict envelopes require identity, operation and explicit numeric section versions and reject transport metadata injection',()=>{
  const original={protocolVersion:1,databaseToken:'synthetic-db',operation:{id:'command-1'},base:{tanks:7},command:issue()};
  const parsed=contracts.parseCommandEnvelope(freeze(original),schema.sections);assert.deepEqual(parsed,original);
  for(const patch of [{actor},{now:ctx().now},{protocolVersion:2},{databaseToken:''},{base:{tanks:'7'}},{base:{unknown:1}},{operation:{id:'a',actor}},{sections:{}}])
    assert.throws(()=>contracts.parseCommandEnvelope({...original,...patch},schema.sections));
  const nullable=accept();Object.assign(nullable.input.changes,{odoStart:null,hours:null,jobId:'',defect:'',result:''});
  assert.equal(commands.parseCommand(nullable).input.changes.jobId,null);
});

test('write footprints are data independent and dependency closures cover read and write state without audit hints',()=>{
  assert.deepEqual(commands.footprint(issue()),['fuelMovements','records']);
  assert.deepEqual(commands.footprint(issue('generators',9)),['fuelMovements','genRecords']);
  assert.deepEqual(commands.footprint(accept()),['shiftReports']);assert.deepEqual(commands.footprint(assign()),['assetAssignments']);
  for(const command of [issue(),issue('generators',9),accept(),assign()]){
    const deps=commands.dependencies(command);assert.deepEqual(deps,[...new Set(deps)].sort());
    assert.ok(commands.footprint(command).every(name=>deps.includes(name)));assert.ok(!deps.includes('auditLog'));
  }
  assert.ok(['tanks','tankIncomes','genRecords','generators','fuelPeriods','assetAssignments'].every(name=>commands.dependencies(issue()).includes(name)));
});

test('IssueFuel writes one reciprocal pair with actual typed IDs and leaves previous mileage, hours, consumption and balances intact',()=>{
  const source=freeze(db()),before=JSON.stringify(source),command=freeze(issue()),metadata=freeze(ctx());
  const result=fullPlan(source,command,metadata),movement=result.sections.fuelMovements[0],record=result.sections.records[1];
  assert.deepEqual(Object.keys(result.sections).sort(),['fuelMovements','records']);
  assert.equal(movement.id,metadata.id);assert.equal(movement.recordId,record.id);assert.equal(record.fuelMovementId,movement.id);
  assert.equal(movement.fromTankId,5);assert.equal(record.vehicleId,7);assert.equal(typeof record.vehicleId,'number');
  assert.equal(movement.qty,100);assert.equal(record.fuelIssued,100);assert.equal(record.km,0);assert.equal(record.fuelUsed,0);assert.equal(record.fuelActual,null);
  assert.equal(record.fuelSourceSnapshot.tankOrg,'Tank org');assert.equal(record.fuelOrg,'Tank org');assert.equal(movement.sourceSnapshot.assetOrg,'Asset org');
  assert.deepEqual(result.sections.records[0],source.records[0]);assert.equal(JSON.stringify(source),before);
  result.sections.records[0].km=999;assert.equal(source.records[0].km,150);assert.equal(source.vehicles[0].fuelBalance,923.537);
});

test('DES issue explicitly detaches linked receipt from the tank so the same 100 litres debit exactly once',()=>{
  const source=db(),result=fullPlan(source,issue('generators',9)),next={...source,...result.sections},record=result.sections.genRecords[0];
  assert.equal(record.generatorId,9);assert.equal(typeof record.generatorId,'number');assert.equal(record.tankId,null);assert.equal(record.hours,0);
  const flows=sources.projectTankFlows(next,[5]);assert.equal(flows.reduce((sum,row)=>sum+row.amount,0),-100);
  assert.equal(policy.inspect(next).counts.error,0);assert.equal(next.tanks[0].balanceInit,923.537);assert.equal(next.generators[0].fuelBalance,20);
});

test('fuel source uses the effective assignment organisation and explicit source grade without rewriting old rows',()=>{
  const source=db();source.assetAssignments=[{id:'assignment',assetRef:'v:7',driverId:3,from:'2026-10-01',org:'Assignment org',site:'Site',reason:'Reason'}];
  source.tanks[0].fuel='gasoline';source.tanks[0].fuelGrade='АИ-95';source.vehicles[0].fuelGrade='АИ-95';
  const result=fullPlan(source,issue());assert.equal(result.sections.records[1].fuelGrade,'АИ-95');
  assert.equal(result.sections.fuelMovements[0].sourceSnapshot.assetOrg,'Assignment org');assert.equal(result.sections.fuelMovements[0].sourceSnapshot.fuel,'gasoline');
});
test('a new issue retains unknown fuel ownership instead of assigning the recipient organisation or tank owner',()=>{
 for(const value of [undefined,'']){const source=db();if(value===undefined)delete source.tanks[0].org;else source.tanks[0].org=value;source.tanks[0].owner='Separate tank owner';const before=JSON.stringify(source),result=fullPlan(source,issue()),movement=result.sections.fuelMovements[0],record=result.sections.records.at(-1);
  assert.equal(movement.sourceSnapshot.assetOrg,'Asset org');assert.equal(movement.sourceSnapshot.tankOrg,'');assert.equal(record.fuelOrg,'');assert.equal(JSON.stringify(source),before);
 }
});

test('fuel planners reuse shared conservation rules for insufficient stock now and at later dates, grade mismatch and closed months',()=>{
  for(const transform of [source=>{source.tanks[0].balanceInit=99;},source=>{source.tankIncomes=[{id:'later-transfer',tankId:5,date:'2026-10-23',kind:'out',amount:-900}];},
    source=>{source.vehicles[0].fuelGrade='АИ-92';},source=>{source.tanks[0].fuel='unknown';},source=>{source.fuelPeriods=[{month:'2026-10',closed:true}];}]){
    const source=db();transform(source);const before=JSON.stringify(source);assert.throws(()=>commands.plan(source,issue(),ctx()));assert.equal(JSON.stringify(source),before);
  }
});

test('legacy DES overlap requires explicit confirmation and does not alter the old receipt or duplicate its fuel',()=>{
  const source=db();source.genRecords=[{id:'legacy',generatorId:9,date:'2026-10-22',fuelIssued:80,hours:4,fuelUsed:20}];
  assert.throws(()=>commands.plan(source,issue('generators',9),ctx()),error=>error.issues?.some(issue=>issue.code==='FUEL_LEGACY_ISSUE_OVERLAP'));
  const command=issue('generators',9);command.input.legacyOverlapConfirmed=true;
  const result=fullPlan(source,command);assert.deepEqual(result.sections.genRecords[0],source.genRecords[0]);assert.equal(result.sections.genRecords.length,2);
});

test('planners reject missing, duplicate and ambiguous string asset links instead of coercing numeric and string IDs',()=>{
  for(const command of [issue(),assign()]){
    const source=db();source.vehicles.push({...source.vehicles[0],id:'7'});
    assert.throws(()=>commands.plan(source,command,ctx()),{code:'AMBIGUOUS_ASSET'});
  }
  const duplicate=db();duplicate.tanks.push({...duplicate.tanks[0]});assert.throws(()=>commands.plan(duplicate,issue(),ctx()),{code:'AMBIGUOUS_REFERENCE'});
  const missing=issue();missing.input.target.id='7';assert.throws(()=>commands.plan(db(),missing,ctx()),{code:'COMMAND_NOT_FOUND'});
  const archived=db();archived.tanks[0].archived=true;assert.throws(()=>commands.plan(archived,issue(),ctx()),{code:'COMMAND_ARCHIVED'});
});

test('derived row collisions never overwrite or append another reciprocal receipt',()=>{
  for(const transform of [source=>source.fuelMovements.push({id:'semantic-test'}),source=>source.records.push({id:'fuel-movement:semantic-test'}),
    source=>source.genRecords.push({id:'prior',fuelMovementId:'semantic-test'})]){
    const source=db();transform(source);assert.throws(()=>commands.plan(source,issue(),ctx()),{code:'COMMAND_ID_EXISTS'});
  }
});

test('AcceptShift atomically stores allowed corrections and acceptance, preserves manual recipient and uses only trusted author/time',()=>{
  const source=freeze(db()),command=accept();Object.assign(command.input.changes,{odoEnd:260,hours:5,fuelIssued:40,tankMeasured:15,defect:'Defect checked'});
  const result=fullPlan(source,command),row=result.sections.shiftReports[0];
  assert.deepEqual(Object.keys(result.sections),['shiftReports']);assert.equal(row.status,'accepted');assert.equal(row.acceptedBy,'Manual recipient');
  assert.deepEqual(row.acceptedActor,actor);assert.equal(row.acceptedAt,ctx().now);assert.equal(row.hours,5);assert.equal(row.odoEnd,260);
  assert.deepEqual(row.attachments,source.shiftReports[0].attachments);assert.equal(source.shiftReports[0].status,'sent');
  assert.equal(result.sections.records,undefined);assert.equal(result.sections.genRecords,undefined);assert.equal(result.sections.fuelMovements,undefined);
});

test('prepared, accepted, rejected or archived shifts cannot be accepted and invalid odometers are rejected before any write',()=>{
  for(const state of ['prepared','accepted','rejected']){const source=db();source.shiftReports[0].status=state;assert.throws(()=>commands.plan(source,accept(),ctx()),{code:'INVALID_TRANSITION'});}
  const archived=db();archived.shiftReports[0].archived=true;assert.throws(()=>commands.plan(archived,accept(),ctx()),{code:'INVALID_TRANSITION'});
  const command=accept();command.input.changes.odoEnd=50;assert.throws(()=>commands.plan(db(),command,ctx()),{code:'INVALID_SHIFT'});
  const broken=db();broken.shiftReports[0].hours=-1;assert.throws(()=>commands.plan(broken,accept(),ctx()),{code:'INVALID_SHIFT'});
});

test('acceptance may keep a historical archived link but a newly selected employee must have the correct active role',()=>{
  const source=db();source.vehicles[0].archived=true;source.drivers[0].employmentStatus='vacation';
  assert.equal(commands.plan(source,accept(),ctx()).sections.shiftReports[0].status,'accepted');
  const changed=db();changed.drivers.push({id:4,name:'Operator only',personnelRoles:['operator']});const command=accept();command.input.changes.driverId=4;
  assert.throws(()=>commands.plan(changed,command,ctx()),error=>error.issues?.some(issue=>issue.code==='PERSONNEL_ROLE_MISMATCH'));
});

test('AssignPerson creates one typed personal assignment and validates role and availability through shared personnel rules',()=>{
  const result=fullPlan(freeze(db()),freeze(assign())),row=result.sections.assetAssignments[0];
  assert.equal(row.id,ctx().id);assert.equal(row.driverId,3);assert.equal(row.assetRef,'v:7');assert.equal(row.from,'2026-10-22');
  assert.equal(row.to,'');assert.equal(row.createdAt,ctx().now);assert.deepEqual(Object.keys(result.sections),['assetAssignments']);
  for(const transform of [source=>{source.drivers[0].employmentStatus='sick';},source=>{source.drivers[0].personnelRoles=['operator'];},source=>{source.drivers[0].archived=true;}]){
    const source=db();transform(source);assert.throws(()=>commands.plan(source,assign(),ctx()),error=>['PERSONNEL_VALIDATION','PERSONNEL_PLANNING_VIOLATION'].includes(error.code));
  }
});

test('explicit replacement closes only the chosen former assignment on the day before the new start',()=>{
  const source=db();source.assetAssignments=[{id:'former',assetRef:'v:7',driverId:3,from:'2026-01-01',to:'',site:'Old site',org:'Old org',reason:'Old reason'},
    {id:'other',assetRef:'g:9',driverId:3,from:'2026-01-01',to:'',site:'DES site',reason:'DES reason'}];
  const before=JSON.stringify(source),command=assign();command.input.from='2026-03-01';command.input.replacesAssignmentId='former';
  const result=fullPlan(source,command),[former,other,added]=result.sections.assetAssignments;
  assert.equal(former.to,'2026-02-28');assert.equal(added.from,'2026-03-01');assert.deepEqual(other,source.assetAssignments[1]);
  assert.equal(former.reason,'Old reason');assert.equal(former.driverId,3);assert.equal(JSON.stringify(source),before);
});

test('replacement cannot silently shorten another assignment or hide a remaining overlap',()=>{
  for(const replacement of [undefined,'other','too-late','ended']){
    const source=db();source.assetAssignments=[{id:'former',assetRef:'v:7',driverId:3,from:'2026-01-01',to:'',site:'Site',reason:'Reason'},
      {id:'other',assetRef:'g:9',driverId:3,from:'2026-01-01',site:'Site',reason:'Reason'},
      {id:'too-late',assetRef:'v:7',driverId:3,from:'2026-11-01',site:'Site',reason:'Reason'},
      {id:'ended',assetRef:'v:7',driverId:3,from:'2025-01-01',to:'2025-01-31',site:'Site',reason:'Reason'}];
    const command=assign();if(replacement!==undefined)command.input.replacesAssignmentId=replacement;
    assert.throws(()=>commands.plan(source,command,ctx()));
  }
});

test('editing an assignment repairs incomplete legacy fields, keeps typed ID and supports explicit open end',()=>{
  const source=db();source.assetAssignments=[{id:17,assetRef:'v:7',driverId:3,from:'',site:'',reason:'',to:'2026-12-01',org:'Historical org'}];
  source.drivers[0].employmentStatus='vacation';source.vehicles[0].archived=true;
  const command=assign();command.input.assignmentId=17;
  assert.throws(()=>commands.plan(source,command,ctx()),{code:'PERSONNEL_PLANNING_VIOLATION'});
  source.drivers[0].employmentStatus='active';
  const kept=commands.plan(source,command,ctx()).sections.assetAssignments[0];assert.equal(kept.id,17);assert.equal(kept.to,'2026-12-01');assert.equal(kept.org,'Historical org');
  command.input.to='';const opened=fullPlan(source,command).sections.assetAssignments[0];assert.equal(opened.to,'');assert.equal(opened.site,'Synthetic site');assert.equal(opened.reason,'Synthetic appointment');
});

test('pure plan clock, metadata and source boundaries do not execute getters or accept forged contexts',()=>{
  let calls=0;const source=db();Object.defineProperty(source,'tanks',{get(){calls++;return [];}});
  assert.throws(()=>commands.plan(source,issue(),ctx()),{code:'INVALID_COMMAND_SOURCE'});assert.equal(calls,0);
  for(const change of [{now:'2026-02-30T10:11:12Z'},{now:'2026-10-22T30:11:12Z'},{today:'2026-02-30'},{actor:{id:'a',name:'',role:'admin'}},{id:'bad operation id'}])
    assert.throws(()=>commands.plan(db(),issue(),{...ctx(),...change}));
});

test('browser UMD dependencies execute the same planners as CommonJS without I/O, application state or clock reads',()=>{
  const browser=vm.createContext({});const files=['platform-contracts','command-source','entity-identity','decimal-core','accounting-boundary','effective-periods','generator-fuel','business-calendar','personnel-kinds','personnel-planning','fuel-stock','personnel-engine','fuel-engine','fuel-movement-policy','issue-fuel','platform-commands'];
  for(const name of files){const file=path.join(__dirname,'../assets/core',name+'.js');vm.runInContext(fs.readFileSync(file,'utf8'),browser,{filename:file});}
  assert.ok(Object.isFrozen(browser.PlatformCommands));assert.deepEqual(Object.keys(browser.PlatformCommands),Object.keys(commands));
  for(const command of [issue(),issue('generators',9),accept(),assign()])assert.deepEqual(copy(browser.PlatformCommands.plan(db(),command,ctx())),commands.plan(db(),command,ctx()));
  assert.equal(browser.document,undefined);assert.equal(browser.require,undefined);assert.equal(browser.data,undefined);assert.equal(browser.localStorage,undefined);
});

test('all semantic commands carry the calendar dependency and validate its civil day after midnight',()=>{
 const calendar=require('../assets/core/business-calendar.js'),operations=require('../assets/core/calendar-operations.js'),source=db(),input={action:'configure',timeZone:'Europe/Moscow',reason:'Explicit synthetic accounting calendar'};
 const review=operations.preview(source,input,{today:ctx().today}),configured=commands.plan(source,{type:'CalendarAction',version:1,input:{...input,reviewFingerprint:review.fingerprint}},ctx('configure-calendar'));
 const next={...source,...configured.sections},now='2026-10-22T21:30:00.000Z',clock=calendar.resolve(next,now);
 assert.equal(clock.today,'2026-10-23');
 for(const command of [issue(),assign(),accept()]){
  assert.ok(commands.dependencies(command).includes('appMeta'));
  assert.throws(()=>commands.plan(next,command,{...ctx(),now,today:'2026-10-22'}),{code:'CALENDAR_DATE_CHANGED'});
 }
 const accepted=commands.plan(next,accept(),{...ctx(),now,today:clock.today,calendar:clock}).sections.shiftReports[0];
 assert.equal(accepted.personnelSnapshot.calendar.timeZone,'Europe/Moscow');assert.equal(accepted.personnelSnapshot.date,'2026-10-21');assert.equal(source.shiftReports[0].personnelSnapshot,undefined);
});

test('semantic confirmation adds evidence only to the selected typed legacy interval and retains literal values',()=>{
 const operations=require('../assets/core/calendar-operations.js'),source=db();source.dispatchJobs=[{id:0,title:'Numeric legacy interval',assetRef:'v:7',driverId:3,status:'new',start:'2026-10-22T08:00',end:'2026-10-22T18:00'},{id:'0',title:'Text legacy interval',assetRef:'v:7',driverId:3,status:'new',start:'2026-10-23T08:00',end:'2026-10-23T18:00'}];
 const input={action:'confirmInterval',target:{section:'dispatchJobs',id:0},reason:'Explicit verified legacy interval'},review=operations.preview(source,input,{today:ctx().today}),before=JSON.stringify(source);
 assert.equal(review.canApply,true,JSON.stringify(review.issues));const planned=commands.plan(freeze(source),{type:'CalendarAction',version:1,input:{...input,reviewFingerprint:review.fingerprint}},ctx('confirm-interval'));
 assert.equal(planned.sections.dispatchJobs[0].start,source.dispatchJobs[0].start);assert.ok(planned.sections.dispatchJobs[0].timeContext.fields.start.instant);assert.deepEqual(planned.sections.dispatchJobs[1],source.dispatchJobs[1]);assert.equal(JSON.stringify(source),before);
});
