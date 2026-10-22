'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const schema=require('../assets/core/platform-schema.js');
const integrity=require('../assets/core/platform-integrity.js');
const clone=value=>JSON.parse(JSON.stringify(value));
const violation=expected=>error=>error.name==='PlatformIntegrityError'&&Array.isArray(error.issues)&&(!expected||error.issues.some(issue=>issue.code===expected));
function validGraph(){
  const db=Object.fromEntries(schema.sections.map(section=>[section,[]]));
  db.vehicles=[{id:'v',fuelBalance:100}];db.generators=[{id:'g',tankId:'t'}];db.tanks=[{id:'t',capacity:1000,balanceInit:100}];db.parts=[{id:'p',minStock:1}];db.drivers=[{id:'d',name:'Тестовый сотрудник',personnelRoles:['driver','operator']}];db.contragents=[{id:'c'}];
  db.records=[{id:'r',vehicleId:'v',date:'2026-09-01',km:100,fuelActual:10,fuelIssued:20,fuelMovementId:'fm',glonassProvenance:{importId:'gi',rawIds:['gt']}}];
  db.genRecords=[{id:'gr',generatorId:'g',tankId:'t',date:'2026-09-01',hours:10}];db.vehicleTo=[{id:'vt',vehicleId:'v',date:'2026-09-01'}];db.toRecords=[{id:'tr',generatorId:'g',date:'2026-09-01'}];db.repairs=[{id:'rp',vehicleId:'v',invoiceDate:'2026-09-01',cost:10}];
  db.fuelImports=[{id:'fi',at:'2026-10-01T10:00:00.000Z'}];db.fuelPurchases=[{id:'fp',vehicleId:'v',recordId:'r',importId:'fi',date:'2026-09-01',grade:'АИ-95',qty:20,cardNo:'123'}];db.fuelCards=[{id:'fc',number:'123',assignments:[{vehicleId:'v',from:'2026-09-01',to:''}]}];db.fuelPeriods=[{month:'2026-09'}];db.monthlyFuel=[{vehicleId:'v',month:'2026-09',liters:20}];
  db.dispatchJobs=[{id:'j',status:'new',assetRef:'v:v',driverId:'d',start:'2026-10-21T08:00',end:'2026-10-21T16:00',partRequirements:[{partId:'p',qty:1}]}];db.assetAssignments=[{id:'a',assetRef:'g:g',driverId:'d',from:'2026-09-01'}];
  db.workOrders=[{id:'w',assetRef:'v:v',repairId:'rp',status:'new'}];db.opsTasks=[{id:'task',assetRef:'v:v',status:'open',due:'2026-10-21'}];db.assetDocuments=[{id:'doc',assetRef:'v:v',driverId:'d',date:'2026-01-01',expires:'2026-12-31'}];
  db.fuelMovements=[{id:'fm',kind:'issue',reason:'Синтетическая выдача',assetRef:'v:v',fromTankId:'t',recordId:'r',qty:20,date:'2026-09-01'}];db.partMovements=[{id:'pm',partId:'p',workOrderId:'w',assetRef:'v:v',kind:'receipt',qty:1,date:'2026-09-01'}];db.shiftReports=[{id:'sr',jobId:'j',driverId:'d',assetRef:'v:v',status:'prepared',date:'2026-09-01'}];
  db.payments=[{id:'pay',vehicleId:'v',contragentId:'c',source:'repair',sourceId:'rp',sum:10,date:'2026-09-01'}];db.budget=[{id:'b',contragentId:'c',year:2026,month:9,sum:10}];db.costEntries=[{id:'ce',assetRef:'v:v',source:'workOrder',sourceId:'w',amount:10,date:'2026-09-01'}];db.costProfiles=[{id:'cp',assetRef:'g:g',fuelPrice:10}];
  db.procurementRules=[{id:'rule',kind:'tank',itemId:'t',leadDays:3}];db.procurementOrders=[{id:'order',kind:'part',itemId:'p',status:'draft',quantity:3,deliveryDate:'2026-10-23'}];
  db.glonassImports=[{id:'gi',at:'2026-10-21T10:00:00Z'}];db.glonassTrips=[{id:'gt',vehicleId:'v',importId:'gi',importIds:['gi'],date:'2026-09-01',km:100}];
  db.dispatchJobs=require('../assets/core/business-calendar.js').canonicalizeIntervals({appMeta:db.appMeta},{dispatchJobs:db.dispatchJobs},{id:'synthetic-confirmed-calendar',now:'2026-10-21T12:00:00.000Z',today:'2026-10-21',actor:{id:'synthetic',name:'Synthetic author',role:'admin'}}).dispatchJobs;
  return db;
}

test('one immutable platform registry covers every current section and ten application modules',()=>{
  assert.equal(schema.apiVersion,1);assert.equal(schema.sections.length,41);assert.ok(Object.isFrozen(schema.relations));
  assert.deepEqual([...new Set(schema.modules.flatMap(module=>module.sections))].sort(),[...schema.sections].sort());
  assert.equal(schema.modules.flatMap(module=>module.sections).length,schema.sections.length);assert.ok(schema.relations.length>=70);
  const description=schema.describe();description.sections.pop();assert.equal(schema.sections.length,41);
  assert.deepEqual(integrity.inspect(validGraph()).counts,{error:0,warning:0,total:0});
});

test('CommonJS and browser modules inspect a graph without DOM, storage or global application data',()=>{
  const context=vm.createContext({}),scripts=[...fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8').matchAll(/<script src="assets\/core\/([^"]+)"/g)].map(match=>match[1]);
  for(const name of scripts.slice(0,scripts.indexOf('platform-integrity.js')+1))vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/core',name),'utf8'),context);
  const db=validGraph(),before=JSON.stringify(db);assert.equal(context.PlatformIntegrity.inspect(db).counts.error,0);assert.equal(JSON.stringify(db),before);
  assert.equal(integrity.inspect([]).issues[0].code,'invalid-database');
});

test('finite numeric legacy identifiers and equivalent numeric strings retain their representation',()=>{
  const db={vehicles:[{id:7,fuelBalance:'10'}],records:[{id:9,vehicleId:7,date:'2026-09-01',fuelActual:'1.25'}]};
  assert.equal(integrity.validateChanges({},db),true);assert.equal(db.vehicles[0].fuelBalance,'10');assert.equal(integrity.inspect(db).counts.error,0);
  const wrong=clone(db);wrong.records[0].vehicleId='7';assert.throws(()=>integrity.validateChanges(db,wrong),violation('missing-reference'));
});

test('legacy bad fields and links are grandfathered individually during unrelated edits',()=>{
  const previous={records:[{id:'old',vehicleId:'missing',date:'bad-date',fuelActual:'old-bad'}]};
  const next=clone(previous);next.records[0].note='A reversible correction';assert.equal(integrity.validateChanges(previous,next),true);
  const changedBad=clone(next);changedBad.records[0].fuelActual='new-bad';assert.throws(()=>integrity.validateChanges(next,changedBad),violation('invalid-number'));
  const fixed=clone(next);fixed.records[0].fuelActual=3;assert.equal(integrity.validateChanges(next,fixed),true);
  const additional=clone(previous);additional.records.push({id:'new',vehicleId:'another-missing',fuelActual:'old-bad'});assert.throws(()=>integrity.validateChanges(previous,additional),violation('missing-reference'));
});

test('new finite/date corruption is rejected without normalizing either input',()=>{
  const db={vehicles:[{id:'v'}],records:[{id:'r',vehicleId:'v',date:'2026-09-01',fuelActual:1}]};
  for(const value of ['garbage',true,{},-1,Infinity,NaN]){const next={...db,records:[{...db.records[0],fuelActual:value}]};assert.throws(()=>integrity.validateChanges(db,next),violation());assert.equal(next.records[0].fuelActual,value);}
  for(const date of ['2026-02-30','2026-13-01','01.09.2026']){const next=clone(db);next.records[0].date=date;assert.throws(()=>integrity.validateChanges(db,next),violation('invalid-date'));}
  const unknown={...db,vehicles:[{id:'v',legacyPayload:{futureVersion:'keep',customValue:NaN}}]};assert.throws(()=>integrity.validateChanges(db,unknown),violation('invalid-json-number'));
});

test('duplicates introduced in any registered section are rejected and old duplicate groups remain repairable',()=>{
  for(const section of schema.sections){if(!schema.descriptors[section].identity.requiredForNew)continue;const field=schema.descriptors[section].identity.field,value=field==='month'?'2026-09':'same';
    assert.throws(()=>integrity.validateChanges({}, {[section]:[{[field]:value},{[field]:value}]}),violation('duplicate-id'));
  }
  const previous={vehicles:[{id:'duplicate'},{id:'duplicate'}]},next=clone(previous);next.vehicles[0].note='Repair one row';assert.equal(integrity.validateChanges(previous,next),true);
  next.vehicles.push({id:'duplicate'});assert.throws(()=>integrity.validateChanges(previous,next),violation('duplicate-id'));
});

test('a valid target cannot be deleted while records or other business documents retain its link',()=>{
  const db=validGraph(),next=clone(db);next.vehicles=[];assert.throws(()=>integrity.validateChanges(db,next),violation('missing-reference'));
  const generator=clone(db);generator.generators=[];assert.throws(()=>integrity.validateChanges(db,generator),violation('missing-reference'));
  const part=clone(db);part.parts=[];assert.throws(()=>integrity.validateChanges(db,part),violation('missing-reference'));
  const party=clone(db);party.contragents=[];assert.throws(()=>integrity.validateChanges(db,party),violation('missing-reference'));
});

test('atomic linked deletion or reassignment keeps referential integrity',()=>{
  const previous={vehicles:[{id:'v'}],records:[{id:'r',vehicleId:'v'}]};
  assert.equal(integrity.validateChanges(previous,{vehicles:[],records:[]}),true);
  assert.equal(integrity.validateChanges(previous,{vehicles:[{id:'replacement'}],records:[{id:'r',vehicleId:'replacement'}]}),true);
});

test('archival preserves history while newly selected archived cards are rejected',()=>{
  const previous={vehicles:[{id:'v'}],records:[{id:'r',vehicleId:'v'}]},archived=clone(previous);archived.vehicles[0].archived=true;
  assert.equal(integrity.validateChanges(previous,archived),true);assert.equal(integrity.inspect(archived).counts.error,0);
  const newRow=clone(archived);newRow.records.push({id:'new',vehicleId:'v'});assert.throws(()=>integrity.validateChanges(archived,newRow),violation('archived-reference'));
});

test('polymorphic assets, procurement objects and nested relationships use their actual sections',()=>{
  const previous=validGraph();
  for(const change of [db=>db.dispatchJobs[0].assetRef='v:absent',db=>db.procurementOrders[0].itemId='absent',db=>db.fuelCards[0].assignments[0].vehicleId='absent',db=>db.dispatchJobs[0].partRequirements[0].partId='absent',db=>db.records[0].glonassProvenance.rawIds=['absent']]){
    const next=clone(previous);change(next);assert.throws(()=>integrity.validateChanges(previous,next),violation('missing-reference'));
  }
  const invalid=clone(previous);invalid.dispatchJobs[0].assetRef='x:v';assert.throws(()=>integrity.validateChanges(previous,invalid),violation('invalid-reference'));
});

test('section write rights are checked for actual changes and keep atomicity',()=>{
  const previous={vehicles:[{id:'v'}]},next={vehicles:[{id:'v',note:'changed'}]};
  assert.throws(()=>integrity.validateChanges(previous,next,{readable:['vehicles'],writable:[]}),violation('section-write-denied'));
  assert.equal(integrity.validateChanges(previous,clone(previous),{readable:[],writable:[]}),true);
  assert.equal(integrity.validateChanges(previous,next,{readable:['vehicles'],writable:['vehicles']}),true);
});

test('unreadable financial sections are opaque and hidden references are not falsely orphaned',()=>{
  const db=validGraph(),report=integrity.inspect(db,{readable:['vehicles','records']});
  assert.equal(report.sections.find(section=>section.section==='payments').rows,null);assert.ok(!report.issues.some(issue=>issue.section==='payments'&&issue.recordId));
  assert.ok(!report.issues.some(issue=>issue.code==='missing-reference'));assert.ok(report.issues.some(issue=>issue.code==='reference-unavailable'));
  assert.ok(!report.issues.some(issue=>issue.code==='reference-unavailable'&&Object.prototype.hasOwnProperty.call(issue,'targetId')));
  const next=clone(db);next.vehicles=[];let error;try{integrity.validateChanges(db,next,{readable:['vehicles'],writable:['vehicles']});}catch(value){error=value;}
  assert.ok(error);const financial=error.issues.find(issue=>issue.section==='payments');assert.equal(financial.recordId,'');assert.equal(financial.targetId,undefined);
});

test('legacy stale purchase pointers are explained but creating or damaging a new pointer fails',()=>{
  const previous={vehicles:[{id:'v'}],records:[{id:'r',vehicleId:'v',date:'2026-09-01',fuelGrade:'АИ-95'}],fuelPurchases:[{id:'p',vehicleId:'v',recordId:'stale',date:'2026-09-01',grade:'АИ-95'}]};
  assert.ok(integrity.inspect(previous).issues.some(issue=>issue.code==='reference-resolved-legacy'));
  const note=clone(previous);note.fuelPurchases[0].comment='keep proof';assert.equal(integrity.validateChanges(previous,note),true);
  const newPointer=clone(previous);newPointer.fuelPurchases.push({...newPointer.fuelPurchases[0],id:'new'});assert.throws(()=>integrity.validateChanges(previous,newPointer),violation('new-stale-reference'));
  const valid=clone(previous);valid.fuelPurchases[0].recordId='r';const damaged=clone(valid);damaged.records=[{...damaged.records[0],id:'replacement'}];assert.throws(()=>integrity.validateChanges(valid,damaged),violation('new-stale-reference'));
});

test('monthly fuel composite identities and completed service timestamps match existing formats',()=>{
  const previous={vehicles:[{id:'v'}],monthlyFuel:[{vehicleId:'v',month:'2026-09',liters:10}]},next=clone(previous);next.monthlyFuel[0].liters=11;
  assert.equal(integrity.validateChanges(previous,next),true);assert.equal(integrity.inspect(next).counts.error,0);
  assert.equal(integrity.rowIdentity('monthlyFuel',next.monthlyFuel[0],0),integrity.rowIdentity('monthlyFuel',next.monthlyFuel[0],7));
  assert.equal(integrity.inspect({vehicles:[{id:'v'}],vehicleTo:[{id:'to',vehicleId:'v',completedAt:'2026-10-21T12:00:00.000Z'}]}).counts.error,0);
});

test('signed legacy tank transfer is valid while ordinary negative receipts remain invalid',()=>{
  const db={tanks:[{id:'a',balanceInit:20},{id:'b'}],tankIncomes:[{id:'out',tankId:'a',counterTankId:'b',kind:'out',linkId:'pair',amount:-20,date:'2026-09-01'},{id:'in',tankId:'b',counterTankId:'a',kind:'in',linkId:'pair',amount:20,date:'2026-09-01'}]};
  assert.equal(integrity.validateChanges({},db),true);const next=clone(db);delete next.tankIncomes[0].kind;assert.throws(()=>integrity.validateChanges(db,next),violation('invalid-number'));
});

test('terminal workflow status changes follow existing forms without inventing vehicle status policy',()=>{
  const previous={dispatchJobs:[{id:'j',status:'confirmed'}],vehicles:[{id:'v',status:'В ремонте'}]},next=clone(previous);next.dispatchJobs[0].status='new';assert.throws(()=>integrity.validateChanges(previous,next),violation('terminal-state-change'));
  const vehicle=clone(previous);vehicle.vehicles[0].status='На ходу';assert.equal(integrity.validateChanges(previous,vehicle),true);
  const tasks={opsTasks:[{id:'t',status:'closed'}]};assert.equal(integrity.validateChanges(tasks,{opsTasks:[{id:'t',status:'open'}]}),true);
});

test('number-only fuel cards have a stable natural identity and normalized duplicate numbers are rejected',()=>{
  const db={fuelCards:[{number:'444 444',assignments:[]}]};assert.equal(integrity.validateChanges({},db),true);assert.equal(integrity.inspect(db).counts.error,0);
  assert.equal(integrity.rowIdentity('fuelCards',db.fuelCards[0],0),integrity.rowIdentity('fuelCards',db.fuelCards[0],4));
  const duplicate=clone(db);duplicate.fuelCards.push({id:'other',number:'444444'});assert.throws(()=>integrity.validateChanges(db,duplicate),violation('duplicate-business-key'));
  const edit=clone(db);edit.fuelCards[0].note='Owner clarified';assert.equal(integrity.validateChanges(db,edit),true);
});

test('health includes workflow and inventory violations without publishing proof or unreadable dependency data',()=>{
  const db={dispatchJobs:[{id:'j',status:'assigned',start:'2026-10-21T08:00',end:'2026-10-21T09:00',assetRef:'v:hidden',driverId:'hidden-driver'}]};
  const full=integrity.inspect(db);assert.ok(full.issues.some(issue=>issue.code==='DISPATCH_DRIVER_REQUIRED'));assert.ok(!full.issues.some(issue=>Object.prototype.hasOwnProperty.call(issue,'proof')));
  const limited=integrity.inspect(db,{readable:['dispatchJobs']});assert.ok(limited.issues.some(issue=>issue.code==='policy-reference-unavailable'));
  assert.ok(!limited.issues.some(issue=>issue.code==='DISPATCH_DRIVER_REQUIRED'||issue.code==='DISPATCH_ASSET_REQUIRED'));
  assert.ok(!limited.issues.some(issue=>Object.prototype.hasOwnProperty.call(issue,'proof')));
});
