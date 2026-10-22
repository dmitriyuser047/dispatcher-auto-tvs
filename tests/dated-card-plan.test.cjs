'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const fuel=require('../assets/core/fuel-engine.js');
function app(){const ctx=vm.createContext({console,dispatcherLocalDate:()=> '2026-10-22',gsmValidDate:fuel.gsmValidDate,fqShiftDate:fuel.fqShiftDate});vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/js/25c-fuel-control.js'),'utf8'),ctx);return ctx;}
const original=()=>({id:7,number:'111111',org:'A',limit:0,provider:'Synthetic provider',assignments:[{vehicleId:0,from:'2026-09-01',to:''}]});
const input=patch=>({id:7,number:'111111',org:'A',originalOrg:'A',vehicleId:0,originalVehicle:0,from:'',basis:'',preserveLegacy:false,provider:'Synthetic provider',limit:0,status:'active',note:'Description only',...patch});

test('dated ownership requires explicit date, basis and retained legacy meaning instead of an implicit today',()=>{
  const api=app(),before=original(),raw=JSON.stringify(before);
  assert.throws(()=>api.fcPlanCard(before,input({org:'B'})),/дату/);
  assert.throws(()=>api.fcPlanCard(before,input({org:'B',from:'2026-11-01'})),/основание/);
  assert.throws(()=>api.fcPlanCard(before,input({org:'B',from:'2026-11-01',basis:'Synthetic contract'})),/Подтвердите/);
  const result=api.fcPlanCard(before,input({org:'B',from:'2026-11-01',basis:'Synthetic contract',preserveLegacy:true}));
  assert.equal(result.card.org,'A');assert.equal(result.card.orgHistory[0].from,'');assert.equal(result.card.orgHistory[0].to,'2026-10-31');assert.equal(result.card.orgHistory[1].org,'B');assert.equal(result.card.orgHistory[1].from,'2026-11-01');assert.equal(result.card.orgHistory[1].basis,'Synthetic contract');assert.equal(JSON.stringify(before),raw);
});
test('descriptive edits preserve zero, exact typed assignment and all future dated periods',()=>{
  const api=app(),before=original();before.assignments[0].to='2026-10-31';before.assignments.push({vehicleId:1,from:'2026-11-01',to:''});
  const result=api.fcPlanCard(before,input());assert.equal(result.card.limit,0);assert.equal(JSON.stringify(result.card.assignments),JSON.stringify(before.assignments));assert.equal(api.fcCurrentVehicleId(before),0);assert.equal(result.dated,false);
});
test('assignment change retains its previous interval and cannot erase it without a date',()=>{
  const api=app(),before=original();assert.throws(()=>api.fcPlanCard(before,input({vehicleId:1})),/дату/);
  const result=api.fcPlanCard(before,input({vehicleId:1,from:'2026-11-01',basis:'Synthetic assignment'}));
  assert.equal(result.card.assignments[0].vehicleId,0);assert.equal(result.card.assignments[0].to,'2026-10-31');assert.equal(result.card.assignments[1].vehicleId,1);assert.equal(result.card.assignments[1].basis,'Synthetic assignment');
  assert.throws(()=>api.fcPlanCard(before,input({vehicleId:1,from:'2026-09-01',basis:'No overwrite'})),/уже содержит/);
});
test('ownership intervals cannot cut through a future period or silently choose overlapping open rows',()=>{
  const api=app(),before=original();before.orgHistory=[{org:'A',from:'2026-09-01',to:''},{org:'B',from:'2026-11-01',to:''}];
  assert.throws(()=>api.fcPlanCard(before,input({org:'C',from:'2026-10-01',basis:'Synthetic'})),/более поздней/);
  assert.throws(()=>api.fcPlanCard(before,input({org:'C',from:'2026-12-01',basis:'Synthetic'})),/несколько открытых/);
});
