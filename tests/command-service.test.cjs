'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const storage=require('../electron/storage');
const sqlite=require('../electron/sqlite-storage.cjs');
const service=require('../electron/command-service.cjs');
const commands=require('../assets/core/platform-commands.js');
const kernel=require('../assets/core/platform-kernel.js');
const fuel=require('../assets/core/fuel-engine.js');
const procurement=require('../assets/js/47-procurement-engine.js');
const admin={id:'command-admin',name:'Synthetic current account',role:'admin'},now='2026-10-22T09:00:00.000Z';
function sample(){return {vehicles:[{id:'v',plate:'SYNTHETIC-COMMAND',org:'A',fuel:'diesel',fuelGrade:'ДТ',norm:10,fuelBalance:0}],records:[],generators:[{id:'g',name:'Synthetic generator',org:'A',fuel:'diesel',fuelBalance:0,tankId:'t'}],genRecords:[],tanks:[{id:'t',name:'Synthetic tank',org:'A',fuel:'diesel',balanceInit:923.537}],tankIncomes:[],fuelMovements:[],drivers:[{id:'d',name:'Synthetic driver',personnelRoles:['driver'],employmentStatus:'active'},{id:'o',name:'Synthetic operator',personnelRoles:['operator'],employmentStatus:'active'}],assetAssignments:[],shiftReports:[{id:'s',title:'Synthetic sent shift',date:'2026-09-10',assetRef:'v:v',driverId:'d',status:'sent',hours:2}],dispatchJobs:[]};}
function fixture(t,format,change=()=>{}){const root=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-command-service-')),dir=path.join(root,'db'),data=sample();change(data);t.after(()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('tvs-command-service-'));fs.rmSync(root,{recursive:true,force:true});});if(format==='sqlite')sqlite.create(dir,{data});else storage.writeAll(dir,data);return{root,dir,data};}
function issue(input={}){return {type:'IssueFuel',version:1,input:{tankId:'t',target:{section:'vehicles',id:'v'},date:'2026-09-10',qty:23.537,reason:'Synthetic transfer document',...input}};}
function accept(changes={}){return {type:'AcceptShift',version:1,input:{shiftId:'s',changes:{acceptedBy:'Manual business recipient',...changes}}};}
function assign(input={}){return {type:'AssignPerson',version:1,input:{driverId:'d',target:{section:'vehicles',id:'v'},from:'2026-10-01',site:'Synthetic site',reason:'Synthetic assignment document',...input}};}
function envelope(dir,command,id='semantic-once'){const snap=storage.readSnapshot(dir),base=Object.fromEntries(commands.dependencies(command).map(name=>[name,snap.revisions[name]]));return {protocolVersion:1,databaseToken:snap.databaseToken,operation:{id},base,command};}
const execute=(dir,payload,options={})=>storage.executeCommand(dir,payload,{principal:admin,now,...options});
const snapshot=dir=>storage.readSnapshot(dir);
function patch(dir,sections){const snap=snapshot(dir);return storage.writeSections(dir,{databaseToken:snap.databaseToken,base:snap.revisions,sections},{principal:admin,now});}
const policyCode=expected=>error=>error.code===expected||error.issues?.some(issue=>issue.code===expected)||error.details?.issues?.some(issue=>issue.code===expected);
function assertPostingArchive(dir,result,after,section,id){const head=after.data.appMeta.find(row=>row.id==='document-archive-head');assert.equal(result.archiveHeadChanged,true);assert.match(head.head,/^[a-f0-9]{64}$/);assert.deepEqual(Object.keys(head).sort(),['head','id','kind','version']);const seal=JSON.parse(fs.readFileSync(path.join(dir,'document-archive',head.head+'.json'),'utf8'));assert.deepEqual(seal.snapshot.source.revision,{section,id});assert.equal(seal.snapshot.capture.timing,'posting');assert.deepEqual(seal.snapshot.sourceRecord,after.data[section].find(row=>row.id===id));}

for(const format of ['json','sqlite']){
 test(format+' IssueFuel commits only reciprocal receipt, movement and trusted audit, conserving fractional litres',t=>{
  const f=fixture(t,format),before=snapshot(f.dir),request=envelope(f.dir,issue()),result=execute(f.dir,request),after=snapshot(f.dir);
  assert.equal(result.ok,true);assert.deepEqual(result.changed.slice().sort(),['appMeta','auditLog','fuelMovements','records']);assert.equal(result.operationReceipt.id,request.operation.id);assert.equal(result.operationReceipt.digest,kernel.requestDigest(request));assert.equal(result.operationReceipt.status,'committed');
  const movement=after.data.fuelMovements[0],record=after.data.records[0];assert.equal(movement.id,request.operation.id);assert.equal(movement.recordId,record.id);assert.equal(record.fuelMovementId,movement.id);assert.equal(record.fuelIssued,23.537);assert.equal(movement.qty,23.537);assertPostingArchive(f.dir,result,after,'fuelMovements',movement.id);assert.equal(record.km,0);assert.equal(record.fuelActual,null);
  assert.equal(procurement.balance(after.data,'tank','t','2026-09-30'),900);assert.equal(fuel.buildLedger(after.data,{from:'2026-09-01',to:'2026-09-30'}).rows[0].end,23.537);
  for(const name of storage.SECTIONS.filter(name=>!result.changed.includes(name)))assert.deepEqual(after.data[name],before.data[name],name);
  for(const name of result.changed)assert.equal(after.revisions[name],before.revisions[name]+1);
  const events=after.data.auditLog.filter(row=>row.operationId===request.operation.id);assert.equal(events.filter(row=>row.type==='transaction').length,1);assert.ok(events.every(row=>row.actorId===admin.id&&row.actor===admin.name&&row.actorRole===admin.role&&row.at===now));assert.equal(after.data.tanks[0].balanceInit,923.537);
 });

 test(format+' generator issue uses explicit null source and does not double-debit an existing legacy receipt',t=>{
  const f=fixture(t,format,data=>{data.genRecords=[{id:'old-gen',generatorId:'g',date:'2026-09-01',hours:0,fuelIssued:20,fuelActual:0}];}),before=snapshot(f.dir);
  const denied=execute.bind(null,f.dir,envelope(f.dir,issue({target:{section:'generators',id:'g'},date:'2026-09-01'})));assert.throws(denied,policyCode('FUEL_LEGACY_ISSUE_OVERLAP'));assert.deepEqual(snapshot(f.dir),before);
  const result=execute(f.dir,envelope(f.dir,issue({target:{section:'generators',id:'g'},date:'2026-09-01',legacyOverlapConfirmed:true}))),after=snapshot(f.dir);assert.equal(result.ok,true);assert.deepEqual(result.changed.slice().sort(),['appMeta','auditLog','fuelMovements','genRecords']);const linked=after.data.genRecords.find(row=>row.fuelMovementId);assert.equal(Object.hasOwn(linked,'tankId'),true);assert.equal(linked.tankId,null);assert.equal(linked.generatorId,'g');assertPostingArchive(f.dir,result,after,'fuelMovements',after.data.fuelMovements[0].id);assert.deepEqual(after.data.genRecords[0],before.data.genRecords[0]);assert.equal(procurement.balance(after.data,'tank','t','2026-09-30'),880);assert.equal(after.data.genRecords.reduce((sum,row)=>sum+row.fuelIssued,0),43.537);
 });

 test(format+' replay precedes stale dependencies, planning and clock and returns usable current canonical state',t=>{
  const f=fixture(t,format),request=envelope(f.dir,issue());assert.equal(execute(f.dir,request).ok,true);const current=snapshot(f.dir);assert.equal(patch(f.dir,{tanks:current.data.tanks.map(row=>({...row,name:'Renamed after commit'}))}).ok,true);const beforeReplay=snapshot(f.dir);
  const replay=execute(f.dir,request,{now:'invalid-clock-that-must-not-be-consulted'});assert.equal(replay.ok,true);assert.equal(replay.replayed,true);assert.deepEqual(replay.changed,[]);assert.equal(replay.operationReceipt.status,'replayed');assert.equal(replay.operationReceipt.digest,kernel.requestDigest(request));assert.deepEqual(replay.canonicalSections.records,beforeReplay.data.records);assert.deepEqual(replay.canonicalSections.fuelMovements,beforeReplay.data.fuelMovements);assert.ok(Array.isArray(replay.canonicalSections.auditLog));assert.deepEqual(snapshot(f.dir),beforeReplay);
  assert.throws(()=>execute(f.dir,{...request,command:issue({qty:1})}),{code:'OPERATION_REUSED'});assert.deepEqual(snapshot(f.dir),beforeReplay);
 });

 test(format+' all declared dependency revisions are required and read-only dependency changes conflict atomically',t=>{
  const f=fixture(t,format),request=envelope(f.dir,issue()),before=snapshot(f.dir);
  for(const name of commands.dependencies(request.command)){const missing=structuredClone(request);delete missing.base[name];assert.throws(()=>execute(f.dir,missing),{code:'COMMAND_BASE_REQUIRED',status:428});}
  assert.deepEqual(snapshot(f.dir),before);assert.equal(patch(f.dir,{tanks:before.data.tanks.map(row=>({...row,name:'Concurrent source name'}))}).ok,true);const current=snapshot(f.dir),result=execute(f.dir,request);assert.equal(result.ok,false);assert.equal(result.code,'COMMAND_CONFLICT');assert.deepEqual(result.conflicts,['tanks']);assert.deepEqual(snapshot(f.dir),current);
 });

 test(format+' source defects, incompatible fuel and closed historical periods never create half an issue',t=>{
  const f=fixture(t,format),before=snapshot(f.dir);
  for(const command of [issue({qty:1000}),issue({tankId:'missing'}),issue({target:{section:'vehicles',id:'missing'}})]){assert.throws(()=>execute(f.dir,envelope(f.dir,command)));assert.deepEqual(snapshot(f.dir),before);}
  assert.equal(patch(f.dir,{tanks:before.data.tanks.map(row=>({...row,fuel:'gasoline'}))}).ok,true);const wrongFuel=snapshot(f.dir);assert.throws(()=>execute(f.dir,envelope(f.dir,issue())),policyCode('FUEL_GRADE_MISMATCH'));assert.deepEqual(snapshot(f.dir),wrongFuel);
  assert.equal(patch(f.dir,{tanks:before.data.tanks}).ok,true);require('./period-test-support.cjs').seedSections(f.dir,{fuelPeriods:[{month:'2026-09',closed:true}]});const closed=snapshot(f.dir);
  for(const date of ['2026-09-10','2026-08-31']){assert.throws(()=>execute(f.dir,envelope(f.dir,issue({date}))));assert.deepEqual(snapshot(f.dir),closed);}
 });

 test(format+' typed target IDs remain typed and ambiguous persisted string references reject',t=>{
  const f=fixture(t,format,data=>{data.vehicles[0].id=7;data.shiftReports=[];});const result=execute(f.dir,envelope(f.dir,issue({target:{section:'vehicles',id:7}})));assert.equal(result.ok,true);assert.equal(snapshot(f.dir).data.records[0].vehicleId,7);
  const other=fixture(t,format,data=>{data.vehicles.push({...data.vehicles[0],id:7},{...data.vehicles[0],id:'7'});});const before=snapshot(other.dir);assert.throws(()=>execute(other.dir,envelope(other.dir,issue({target:{section:'vehicles',id:7}}))),{code:'AMBIGUOUS_ASSET'});assert.deepEqual(snapshot(other.dir),before);
 });

 test(format+' AcceptShift preserves manual acceptedBy, stamps trusted actor/time and creates no operating facts',t=>{
  const f=fixture(t,format),before=snapshot(f.dir),request=envelope(f.dir,accept()),result=execute(f.dir,request),after=snapshot(f.dir);assert.equal(result.ok,true);assert.deepEqual(result.changed.slice().sort(),['appMeta','auditLog','shiftReports']);const shift=after.data.shiftReports[0];assert.equal(shift.status,'accepted');assert.equal(shift.acceptedBy,'Manual business recipient');assert.deepEqual(shift.acceptedActor,admin);assert.equal(shift.acceptedAt,now);assertPostingArchive(f.dir,result,after,'shiftReports',shift.id);assert.deepEqual(after.data.records,before.data.records);assert.deepEqual(after.data.genRecords,before.data.genRecords);assert.deepEqual(after.data.fuelMovements,before.data.fuelMovements);assert.equal(execute(f.dir,request).replayed,true);
  const frozen=snapshot(f.dir);assert.throws(()=>patch(f.dir,{shiftReports:[{...shift,acceptedActor:{id:'forged',name:'Forged',role:'admin'}}]}));assert.deepEqual(snapshot(f.dir),frozen);
 });

 test(format+' raw full and section acceptance paths canonicalize metadata and refuse prepared-to-accepted bypass',t=>{
  const f=fixture(t,format),initial=snapshot(f.dir),fake={...initial.data.shiftReports[0],status:'accepted',acceptedBy:'Business approver, not account',acceptedActor:{id:'forged',name:'Forged',role:'admin'},acceptedAt:'2000-01-01T00:00:00.000Z'};
  const result=patch(f.dir,{shiftReports:[fake]});assert.equal(result.ok,true);const accepted=snapshot(f.dir).data.shiftReports[0];assert.equal(accepted.acceptedBy,fake.acceptedBy);assert.deepEqual(accepted.acceptedActor,admin);assert.equal(accepted.acceptedAt,now);
  const prepared=fixture(t,format,data=>{data.shiftReports[0].status='prepared';}),before=snapshot(prepared.dir);const next={...before.data.shiftReports[0],status:'accepted',acceptedBy:'Business approver'};
  assert.throws(()=>patch(prepared.dir,{shiftReports:[next]}),{code:'SHIFT_ACCEPTANCE_TRANSITION'});assert.deepEqual(snapshot(prepared.dir),before);
  assert.throws(()=>storage.writeAll(prepared.dir,{...before.data,shiftReports:[next]},{principal:admin,now,base:before.revisions,requireBase:true}),{code:'SHIFT_ACCEPTANCE_TRANSITION'});assert.deepEqual(snapshot(prepared.dir),before);
  assert.throws(()=>patch(prepared.dir,{shiftReports:[{...before.data.shiftReports[0],acceptedAt:now,acceptedActor:admin}]}),{code:'SHIFT_ACCEPTANCE_METADATA'});assert.deepEqual(snapshot(prepared.dir),before);
  const full=fixture(t,format),snap=snapshot(full.dir);assert.equal(storage.writeAll(full.dir,{...snap.data,shiftReports:[{...snap.data.shiftReports[0],status:'accepted',acceptedBy:'Full manual approver',acceptedActor:{id:'fake'},acceptedAt:'1999-01-01'}]},{principal:admin,now,base:snap.revisions,requireBase:true}).ok,true);assert.deepEqual(snapshot(full.dir).data.shiftReports[0].acceptedActor,admin);
 });

 test(format+' raw new accepted seeds are refused while physically existing legacy acceptance remains byte-for-byte historical',t=>{
  const f=fixture(t,format,data=>{data.shiftReports=[];}),before=snapshot(f.dir),legacy={id:'legacy-accepted',title:'Imported accepted shift',date:'2026-09-01',assetRef:'v:v',driverId:'d',status:'accepted',acceptedBy:'Historical business recipient',acceptedActor:{id:'spoofed-import'},acceptedAt:'2000-01-01'};
  assert.throws(()=>patch(f.dir,{shiftReports:[legacy]}),{code:'SHIFT_ACCEPTANCE_COMMAND'});assert.deepEqual(snapshot(f.dir),before);require('./period-test-support.cjs').seedSections(f.dir,{shiftReports:[legacy]});assert.equal(patch(f.dir,{opsTasks:[{id:'unrelated',title:'Unrelated safe update',status:'open'}]}).ok,true);const after=snapshot(f.dir);assert.deepEqual(after.data.shiftReports[0],legacy);assert.deepEqual(after.data.records,before.data.records);
 });

 test(format+' AssignPerson atomically closes the old assignment without changing either person or asset',t=>{
  const f=fixture(t,format,data=>{data.drivers.push({id:'d2',name:'Second synthetic driver',personnelRoles:['driver'],employmentStatus:'active'});data.assetAssignments=[{id:'old-assignment',assetRef:'v:v',driverId:'d',from:'2026-09-01',to:'',site:'Old site',reason:'Old document'}];}),before=snapshot(f.dir),request=envelope(f.dir,assign({driverId:'d2',replacesAssignmentId:'old-assignment'}),'new-assignment');
  const result=execute(f.dir,request),after=snapshot(f.dir);assert.equal(result.ok,true);assert.deepEqual(result.changed.slice().sort(),['assetAssignments','auditLog']);assert.equal(after.data.assetAssignments.find(row=>row.id==='old-assignment').to,'2026-09-30');assert.equal(after.data.assetAssignments.find(row=>row.id==='new-assignment').driverId,'d2');assert.deepEqual(after.data.drivers,before.data.drivers);assert.deepEqual(after.data.vehicles,before.data.vehicles);assert.deepEqual(after.data.records,before.data.records);
 });

 test(format+' command ACL, token/digest binding and malformed DTOs reject without audit or data writes',t=>{
  const f=fixture(t,format),request=envelope(f.dir,issue()),before=snapshot(f.dir);
  for(const role of ['viewer','accountant','mechanic'])assert.throws(()=>execute(f.dir,request,{principal:{id:role,name:role,role}}),{code:'ACCESS_DENIED'});
  assert.throws(()=>service.execute(f.dir,request),{code:'ACCESS_DENIED'});assert.throws(()=>execute(f.dir,request,{principal:{...admin,readable:['records','fuelMovements']}}),{code:'ACCESS_DENIED'});
  assert.equal(execute(f.dir,{...request,databaseToken:'different-database'}).databaseChanged,true);assert.throws(()=>execute(f.dir,{...request,operation:{id:request.operation.id,digest:'sha256:'+'a'.repeat(64)}}),{code:'OPERATION_DIGEST'});
  for(const change of [{sections:{records:[]}},{command:{...request.command,input:{...request.command.input,actor:admin}}},{protocolVersion:2},{base:null}])assert.throws(()=>execute(f.dir,{...request,...change}));assert.deepEqual(snapshot(f.dir),before);
 });

 test(format+' trusted precommit backup runs once only for a new validated command and failure leaves no receipt',t=>{
  const f=fixture(t,format),request=envelope(f.dir,issue()),before=snapshot(f.dir);let calls=0;
  const rejected=()=>{calls++;throw Error('Synthetic backup unavailable');};
  assert.throws(()=>execute(f.dir,{...request,command:issue({qty:1000})},{beforeCommit:rejected}));assert.equal(calls,0);assert.deepEqual(snapshot(f.dir),before);
  assert.throws(()=>execute(f.dir,request,{principal:{id:'viewer',name:'Viewer',role:'viewer'},beforeCommit:rejected}),{code:'ACCESS_DENIED'});assert.equal(calls,0);
  assert.throws(()=>execute(f.dir,request,{beforeCommit:rejected}),/Synthetic backup unavailable/);assert.equal(calls,1);assert.deepEqual(snapshot(f.dir),before);
  assert.throws(()=>execute(f.dir,request,{beforeCommit:()=>Promise.resolve()}),/синхронной/);assert.deepEqual(snapshot(f.dir),before);
  const result=execute(f.dir,request,{beforeCommit:()=>{calls++;assert.deepEqual(snapshot(f.dir),before);}});assert.equal(result.ok,true);assert.equal(calls,2);const after=snapshot(f.dir);
  assert.equal(execute(f.dir,request,{beforeCommit:rejected}).replayed,true);assert.equal(calls,2);assert.deepEqual(snapshot(f.dir),after);
  const raw=fixture(t,format,data=>{data.shiftReports[0].status='prepared';}),initial=snapshot(raw.dir);
  assert.throws(()=>storage.writeSections(raw.dir,{databaseToken:initial.databaseToken,base:initial.revisions,sections:{shiftReports:[{...initial.data.shiftReports[0],status:'accepted',acceptedBy:'Manual'}]}},{principal:admin,now,beforeCommit:rejected}),{code:'SHIFT_ACCEPTANCE_TRANSITION'});assert.equal(calls,2);assert.deepEqual(snapshot(raw.dir),initial);
 });

 test(format+' narrowed command read permissions hide nested row history and mixed transaction receipts on commit and replay',t=>{
  const f=fixture(t,format),old=snapshot(f.dir);assert.equal(patch(f.dir,{drivers:old.data.drivers.map((row,index)=>index?row:{...row,note:'NARROW-DRIVER-AUDIT-SECRET'}),payments:[{id:'hidden',sum:9988776655,note:'NARROW-PAYMENT-AUDIT-SECRET'}]}).ok,true);
  const request=envelope(f.dir,issue()),principal={...admin,readable:[...commands.dependencies(request.command),'auditLog'],writable:commands.footprint(request.command)};
  for(const result of [execute(f.dir,request,{principal}),execute(f.dir,request,{principal})]){
   assert.equal(result.ok,true);assert.equal(Object.hasOwn(result.revisions,'drivers'),false);assert.equal(Object.hasOwn(result.revisions,'payments'),false);assert.ok(result.canonicalSections.auditLog.some(row=>row.operationId===request.operation.id));
   for(const row of result.canonicalSections.auditLog){assert.ok(principal.readable.includes(row.section));if(row.type==='transaction')assert.ok(row.changedSections.every(name=>principal.readable.includes(name)));}
   assert.doesNotMatch(JSON.stringify(result),/NARROW-DRIVER-AUDIT-SECRET|NARROW-PAYMENT-AUDIT-SECRET|9988776655/);
  }
 });
}

test('failed JSON publication rolls back both business sides, audit and receipt together',t=>{
 const f=fixture(t,'json'),before=snapshot(f.dir),request=envelope(f.dir,issue()),original=fs.renameSync;let injected=false;
 try{fs.renameSync=function(from,to){if(!injected&&path.resolve(to)===path.join(f.dir,'sections','auditLog.json')){injected=true;throw Object.assign(Error('Synthetic audit publication fault'),{code:'EIO'});}return original.apply(this,arguments);};assert.throws(()=>execute(f.dir,request),/Synthetic audit publication fault/);}finally{fs.renameSync=original;}
 assert.equal(injected,true);assert.deepEqual(snapshot(f.dir),before);assert.equal(execute(f.dir,request).ok,true);assert.equal(snapshot(f.dir).data.fuelMovements.length,1);
});

test('failed SQLite COMMIT rolls back business rows, links, revisions, audit and receipt together',t=>{
 const f=fixture(t,'sqlite'),before=snapshot(f.dir),inspection=sqlite.inspect(f.dir),request=envelope(f.dir,issue()),original=sqlite.commitSections;let injected=false;
 try{sqlite.commitSections=function(dir,sections,revisions){return original(dir,sections,revisions,{beforeCommit(){injected=true;throw Error('Synthetic SQL before-COMMIT fault');}});};assert.throws(()=>execute(f.dir,request),/Synthetic SQL before-COMMIT fault/);}finally{sqlite.commitSections=original;}
 assert.equal(injected,true);assert.deepEqual(snapshot(f.dir),before);assert.deepEqual(sqlite.inspect(f.dir),inspection);assert.equal(execute(f.dir,request).ok,true);
});
