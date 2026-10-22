'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const policy=require('../assets/core/temporal-policy.js'),cost=require('../assets/js/45-cost-engine.js');
const clone=value=>structuredClone(value),codes=code=>error=>!!(error.code===code||error.issues?.some(issue=>issue.code===code)||error.details?.issues?.some(issue=>issue.code===code));
const parameters=norm=>({norm,normCity:null,normHighway:null,normIdle:null}),period=(from,norm,id=from)=>({id,from,basis:'Synthetic signed norm document',parameters:parameters(norm)}),history=(...periods)=>({version:1,periods});
function base(){return {vehicles:[{id:'v',org:'A',norm:10}],records:[{id:'r',vehicleId:'v',date:'2026-09-10',km:100,fuelActual:5}],generators:[{id:'g',norm:2,power:100}],genRecords:[],fuelCards:[],costProfiles:[],fuelPeriods:[],fuelWriteoffs:[]};}

test('new histories require the complete dated contract while unchanged malformed legacy metadata remains diagnosable',()=>{
 const before=base(),next=clone(before);next.vehicles[0].fuelNorms=history(period('2026-09-01',10));assert.equal(policy.validateChanges(before,next),true);assert.equal(before.vehicles[0].fuelNorms,undefined);
 for(const invalid of [null,{},history(),history({...period('2026-09-01',10),basis:''}),history(period('2026-02-30',10)),history(period('2026-09-01',10),period('2026-09-01',20))])assert.throws(()=>policy.validateChanges(before,{...before,vehicles:[{...before.vehicles[0],fuelNorms:invalid}]}),codes('TEMPORAL_INVALID'));
 const old=base();old.vehicles[0].fuelNorms={version:99};const comment=clone(old);comment.vehicles[0].note='Keep malformed legacy history';assert.equal(policy.validateChanges(old,comment),true);assert.equal(policy.inspect(old).issues[0].code,'TEMPORAL_INVALID');assert.equal(policy.inspect(old,{readable:['records']}).issues.length,0);
});

test('closed history rejects first future activation with missing earlier values, permits explicit equal bridges and later appends',()=>{
 const before=base();before.fuelPeriods=[{month:'2026-09',closed:true}];const future=clone(before);future.vehicles[0].fuelNorms=history(period('2026-10-01',20));assert.throws(()=>policy.validateChanges(before,future),codes('TEMPORAL_CLOSED_IMPACT'));
 const bridge=clone(before);bridge.vehicles[0].fuelNorms=history(period('2026-09-01',10),period('2026-10-01',20));assert.equal(policy.validateChanges(before,bridge),true);const append=clone(bridge);append.vehicles[0].fuelNorms.periods.push(period('2026-11-01',30));assert.equal(policy.validateChanges(bridge,append),true);
 const changed=clone(bridge);changed.vehicles[0].fuelNorms.periods[0].parameters.norm=11;assert.throws(()=>policy.validateChanges(bridge,changed),codes('TEMPORAL_CLOSED_IMPACT'));const gap=clone(bridge);gap.vehicles[0].fuelNorms.periods[0].from='2026-09-11';assert.throws(()=>policy.validateChanges(bridge,gap),codes('TEMPORAL_CLOSED_IMPACT'));
 const unknown=clone(before);delete unknown.vehicles[0].norm;const later=clone(unknown);later.vehicles[0].fuelNorms=history(period('2026-10-01',20));assert.equal(policy.validateChanges(unknown,later),true,'Already unknown historical norms stay unknown without an invented bridge');
});

test('scalar norms and rates cannot bypass an active dated history, including remove-and-change in one operation',()=>{
 for(const section of ['vehicles','costProfiles']){
  const before=base(),kind=section==='vehicles'?'fuelNorms':'ratePeriods',field=section==='vehicles'?'norm':'salaryRate';before[section]=[{id:'v',[field]:10,[kind]:section==='vehicles'?history(period('2026-09-01',10)):history({id:'p',from:'2026-09-01',basis:'Synthetic',parameters:{salaryRate:10,depreciationRate:null,fuelRate:null,fuelPrice:null}})}];
  for(const remove of [false,true]){const next=clone(before);next[section][0][field]=11;if(remove)delete next[section][0][kind];assert.throws(()=>policy.validateChanges(before,next),codes('TEMPORAL_SCALAR_LOCKED'));}
 }
});

test('protected old posted scopes preserve both known and missing norm values, including earlier carry rows and generator closed curves',()=>{
 const before=base();before.records.unshift({id:'early',vehicleId:'v',date:'2026-08-05',km:1});before.fuelWriteoffs=[{id:'posted-v1',status:'posted',scope:{month:'2026-09',org:'A'},rows:[{vehicleId:'v'}]}];const next=clone(before);next.vehicles[0].fuelNorms=history(period('2026-09-01',10));assert.throws(()=>policy.validateChanges(before,next),codes('TEMPORAL_POSTED_IMPACT'));
 next.vehicles[0].fuelNorms.periods.unshift(period('2026-08-01',10));assert.equal(policy.validateChanges(before,next),true);const fakeV2=clone(before);fakeV2.fuelWriteoffs[0].calculationVersion=2;assert.throws(()=>policy.validateChanges(fakeV2,{...next,vehicles:[{...next.vehicles[0],fuelNorms:history(period('2026-08-01',11))}]}),codes('TEMPORAL_POSTED_IMPACT'));
 const generators=base();generators.fuelPeriods=[{month:'2026-09',closed:true}];const generatorNext=clone(generators);generatorNext.generators[0].fuelNorms=history({id:'g-period',from:'2026-09-01',basis:'Synthetic',parameters:{power:100,norm:2,norm100:null,norm50:null,normIdle:null}});assert.equal(policy.validateChanges(generators,generatorNext),true);generatorNext.generators[0].fuelNorms.periods[0].parameters.norm=3;assert.throws(()=>policy.validateChanges(generators,generatorNext),codes('TEMPORAL_CLOSED_IMPACT'));
});

test('an unrelated organization or fuel grade does not acquire another act scope merely by adding norm metadata',()=>{
 const before=base();before.vehicles[0].fuelGrade='АИ-95';before.fuelWriteoffs=[{id:'diesel-act',status:'posted',scope:{month:'2026-09',org:'A',grade:'ДТ'},rows:[{vehicleId:'other'}]}];const next=clone(before);next.vehicles[0].fuelNorms=history(period('2026-09-01',20));assert.equal(policy.validateChanges(before,next),true);
 before.fuelWriteoffs[0].scope.grade='АИ-95';before.fuelWriteoffs[0].scope.org='B';assert.equal(policy.validateChanges(before,next),true);
});

test('organization deltas reject new overlaps and unreviewed dates, preserve a reviewed scalar baseline and cannot alter protected ownership',()=>{
 const before=base(),future=clone(before);future.fuelPeriods=[{month:'2026-09',closed:true}];before.fuelPeriods=clone(future.fuelPeriods);future.vehicles[0].orgHistory=[{from:'',to:'2026-09-30',org:'A'},{from:'2026-10-01',to:'',org:'B',basis:'Synthetic transfer'}];assert.equal(policy.validateChanges(before,future),true);
 const wrong=clone(future);wrong.vehicles[0].orgHistory[0].org='C';assert.throws(()=>policy.validateChanges(before,wrong),codes('TEMPORAL_BASELINE'));
 const overlap=clone(future);overlap.vehicles[0].orgHistory[0].to='2026-10-01';assert.throws(()=>policy.validateChanges(before,overlap),codes('TEMPORAL_OVERLAP'));
 const oldOverlap=clone(before);oldOverlap.vehicles[0].orgHistory=[{from:'2026-09-01',to:'',org:'A'},{from:'2026-09-02',to:'',org:'B'}];const comment=clone(oldOverlap);comment.vehicles[0].note='Old overlap stays visible';assert.equal(policy.validateChanges(oldOverlap,comment),true);assert.ok(policy.inspect(oldOverlap).issues.some(issue=>issue.code==='TEMPORAL_OVERLAP'));
 const retained=clone(before);retained.vehicles[0].orgHistory=[{from:'',to:'',org:'A'}];assert.equal(policy.validateChanges(retained,future),true,'A saved legacy baseline can be closed by a future dated transfer');
 const past=clone(future);past.vehicles[0].orgHistory[0].to='2026-09-14';past.vehicles[0].orgHistory[1].from='2026-09-15';assert.throws(()=>policy.validateChanges(before,past),codes('TEMPORAL_CLOSED_IMPACT'));
});

test('compatibility projection proves semantics itself and changes only computational organization history, never source facts',()=>{
 const before=base();before.fuelWriteoffs=[{id:'old',status:'posted',scope:{month:'2026-09',org:'A'},rows:[{vehicleId:'v'}]}];const next=clone(before);next.vehicles[0].orgHistory=[{from:'',to:'2026-09-30',org:'A'},{from:'2026-10-01',to:'',org:'B',basis:'Synthetic future transfer'}];next.records[0].note='Preserved new fact description';const raw=JSON.stringify(next),snapshot=policy.compatibilitySnapshot(before,next);assert.equal(snapshot.vehicles[0].orgHistory,undefined);assert.equal(snapshot.vehicles[0].org,'A');assert.equal(snapshot.records[0].note,'Preserved new fact description');assert.equal(JSON.stringify(next),raw);
 const changed=clone(next);changed.vehicles[0].orgHistory[0].org='B';assert.throws(()=>policy.compatibilitySnapshot(before,changed));
});

test('server origins prove first activation, remain immutable and restore the exact absent versus empty shape on later saves',()=>{
 for(const empty of [false,true]){
  const before=base();if(empty)before.vehicles[0].orgHistory=[];before.fuelWriteoffs=[{id:'old',status:'posted',scope:{month:'2026-09',org:'A'},rows:[{vehicleId:'v'}]}];const next=clone(before);next.vehicles[0].orgHistory=[{from:'',to:'2026-09-30',org:'A'},{from:'2026-10-01',to:'',org:'B',basis:'Synthetic future owner'}];
  const canonical=policy.canonicalizeOrigins(before,{vehicles:next.vehicles});assert.deepEqual(canonical.vehicles[0].orgHistoryOrigin,{version:1,previous:empty?'empty':'absent'});assert.equal(next.vehicles[0].orgHistoryOrigin,undefined);const saved={...next,...canonical},later=clone(saved);later.vehicles[0].note='Later save';const compatibility=policy.compatibilitySnapshot(saved,later);assert.equal(Object.hasOwn(compatibility.vehicles[0],'orgHistory'),empty);if(empty)assert.deepEqual(compatibility.vehicles[0].orgHistory,[]);assert.equal(Object.hasOwn(compatibility.vehicles[0],'orgHistoryOrigin'),false);
  for(const value of [undefined,{version:1,previous:empty?'absent':'empty'},{version:99,previous:'absent'}]){const forged=clone(later);if(value===undefined)delete forged.vehicles[0].orgHistoryOrigin;else forged.vehicles[0].orgHistoryOrigin=value;assert.throws(()=>policy.validateChanges(saved,forged),codes('TEMPORAL_ORIGIN_IMMUTABLE'));}
 }
 const before=base(),forged=clone(before);forged.vehicles[0].orgHistoryOrigin={version:1,previous:'absent'};assert.throws(()=>policy.validateChanges(before,forged),codes('TEMPORAL_ORIGIN_FORGED'));assert.throws(()=>policy.canonicalizeOrigins(before,{vehicles:forged.vehicles}),codes('TEMPORAL_ORIGIN_FORGED'));
});

test('dated cost scenarios split journal quantities by their dates and keep actual amounts and manual source prices authoritative',()=>{
 const rates=(from,salaryRate,id=from)=>({id,from,basis:'Synthetic rate agreement',parameters:{salaryRate,depreciationRate:0,fuelRate:0,fuelPrice:0}}),db={vehicles:[{id:'v'}],records:[{id:'s',vehicleId:'v',date:'2026-09-10',km:100},{id:'o',vehicleId:'v',date:'2026-10-10',km:100}],costProfiles:[{id:'profile',assetRef:'v:v',salaryRate:99,ratePeriods:history(rates('2026-09-01',1),rates('2026-10-01',2))}],costEntries:[{id:'actual',assetRef:'v:v',date:'2026-09-10',kind:'expense',amount:0.105,title:'Legacy explicit amount',independent:true}]},raw=JSON.stringify(db),build=(from,to)=>cost.buildReport(db,{from,to}).rows[0];
 const all=build('2026-09-01','2026-10-31');assert.equal(all.scenario.amount,300);assert.equal(all.scenario.rate,null);assert.equal(all.scenario.periods[0].amount,100);assert.equal(all.scenario.periods[1].amount,200);assert.equal(all.expenses,0.105);assert.equal(build('2026-09-01','2026-09-30').scenario.amount,100);assert.equal(build('2026-10-01','2026-10-31').scenario.amount,200);assert.equal(JSON.stringify(db),raw);
 db.records.unshift({id:'pre',vehicleId:'v',date:'2026-08-31',km:10});const missing=build('2026-08-01','2026-10-31').scenario;assert.equal(missing.amount,null);assert.equal(missing.knownAmount,300);assert.equal(missing.uncoveredQuantity,10);assert.equal(missing.coverageComplete,false);assert.throws(()=>cost.scenario(db.costProfiles[0],100,'км'),{code:'INVALID_DATE'});
});

test('dated cost money rounds each period piece once and sums the same displayed values without resetting journal quantity',()=>{
 const p=(from)=>({id:from,from,basis:'Synthetic',parameters:{salaryRate:2.675,depreciationRate:1.005,fuelRate:null,fuelPrice:null}}),profile={id:'p',ratePeriods:history(p('2026-09-01'),p('2026-10-01'))},result=cost.datedScenario(profile,[{date:'2026-09-01',quantity:1},{date:'2026-10-01',quantity:1}],'ч',true);assert.equal(result.amount,7.38);assert.equal(result.pieces[0].amount,5.36);assert.equal(result.pieces[1].amount,2.02);assert.equal(result.complete,false);assert.equal(result.coverageComplete,true);
});

test('TemporalPolicy browser diagnostics and delta checks use the same strict dependencies and do not publish hidden section data',()=>{
 const context=vm.createContext({});for(const file of ['decimal-core.js','effective-periods.js','temporal-policy.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/core',file),'utf8'),context);const db=base();db.costProfiles=[{id:'PRIVATE',ratePeriods:{version:99}}];assert.deepEqual(JSON.parse(JSON.stringify(context.TemporalPolicy.inspect(db,{readable:['vehicles']}))),policy.inspect(db,{readable:['vehicles']}));
});
