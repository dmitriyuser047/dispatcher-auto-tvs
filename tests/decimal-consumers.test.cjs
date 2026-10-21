'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const DecimalCore=require('../assets/core/decimal-core.js'),policy=require('../assets/core/fuel-movement-policy.js');
const procurement=require('../assets/js/47-procurement-engine.js');
function app(){
  const ctx=vm.createContext({DecimalCore,FuelMovementPolicy:policy,console,data:{vehicles:[{id:7,fuel:'diesel'}],records:[],fuelPurchases:[]},
    window:{},document:{addEventListener(){}},plateKey:value=>String(value||'').toUpperCase(),
    fuelGradeFromTransactions:()=> 'ДТ',recordFuelGrade:()=> 'ДТ'});
  for(const file of ['11-import.js','16-generators.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/js',file),'utf8'),ctx,{filename:file});
  return ctx;
}
const tx=qty=>({date:'2026-09-01',time:'12:30',cardNo:'111111',fuel:'ДТ',plate:'A001AA',comment:'Source row',qty});
function keys(ctx,quantity,patch={}){const row={...tx(quantity),...patch};row.importKey='old-marker';row.importKeyV2=ctx.fuelImportKeyV2(row);row.importKeyV3=ctx.fuelImportKeyV3(row);return row;}

test('import V2 remains frozen while V3 distinguishes each source millilitre',()=>{
  const ctx=app(),a=keys(ctx,2.001),b=keys(ctx,2.004);
  assert.equal(a.importKeyV2,b.importKeyV2);assert.notEqual(a.importKeyV3,b.importKeyV3);
  assert.match(a.importKeyV3,/2\.001/);assert.equal(ctx.fuelImportRoundLitres(923.537),923.537);
  assert.throws(()=>ctx.fuelImportRoundLitres(923.5371),{code:'PRECISION'});
});
test('legacy rounded matches require exact source quantity proof and preserve corrected facts',()=>{
  const ctx=app(),a=keys(ctx,2.001),b=keys(ctx,2.004),old={id:'p',importKeyV2:a.importKeyV2,qty:2,sourceTransaction:{qty:2.001}};
  const before=JSON.stringify(old),index=ctx.fuelImportKnownIndex([old]);
  assert.equal(ctx.fuelImportMatchKnown(a,index,new Set()).purchase,old);
  assert.equal(ctx.fuelImportMatchKnown(b,index,new Set()).ambiguous,true);
  assert.equal(ctx.fuelImportMatchKnown(a,index,new Set([old])).purchase,undefined);
  assert.equal(JSON.stringify(old),before);
  delete old.sourceTransaction;assert.equal(ctx.fuelImportMatchKnown(a,[old],new Set()).ambiguous,true);
});
test('supplier identity permits change detection without duplicating a known source operation',()=>{
  const ctx=app(),a=keys(ctx,2.001,{supplierTransactionId:'TX-1'}),b=keys(ctx,2.004,{supplierTransactionId:'TX-1'});
  assert.equal(a.importKeyV3,b.importKeyV3);
  const old={id:'p',qty:1.999,importKeyV2:a.importKeyV2,sourceTransaction:{qty:2.001}};
  assert.equal(ctx.fuelImportMatchKnown(b,[old],new Set()).purchase,old);
});
test('repeated supplier IDs are singular while contradictory rows all require reconciliation',()=>{
  const ctx=app(),a=keys(ctx,2.001,{supplierTransactionId:'TX-1',sourceRow:1}),b={...a,sourceRow:2};
  const repeated=ctx.fuelImportRepeatedSources([a,b]);assert.equal(repeated.has(1),false);assert.equal(repeated.has(2),true);
  const conflicting=ctx.fuelImportRepeatedSources([a,{...b,qty:2.004}]);assert.equal(conflicting.has(1),true);assert.equal(conflicting.has(2),true);
  assert.equal(ctx.fuelImportRepeatedSources([keys(ctx,2.001,{sourceRow:1}),keys(ctx,2.001,{sourceRow:2})]).size,0);
});
test('actual import posting and subtraction preserve 923.537 and exact millilitre deltas',()=>{
  const ctx=app();ctx.fuelImportApplyFuelToVehicle(7,'2026-09-01',923.537,[{qty:923.537,sum:10}]);
  ctx.fuelImportApplyFuelToVehicle(7,'2026-09-01',0.001,[{qty:0.001,sum:0.01}]);
  assert.equal(ctx.data.records[0].fuelIssued,923.538);assert.equal(ctx.data.records[0].fuelSum,10.01);
  ctx.fuelImportSubtractFromRecord({recordId:ctx.data.records[0].id,qty:0.001,transactions:[{sum:0.01}]});
  assert.equal(ctx.data.records[0].fuelIssued,923.537);assert.equal(ctx.data.records[0].fuelSum,10);
});
test('procurement coverage, stock and suggested quantity retain millilitres',()=>{
  assert.deepEqual(procurement.orderState({quantity:0.001,receivedQty:0,stockPostedQty:0,status:'ordered'}),{undelivered:0.001,pendingPosting:0,coverage:0.001,draft:0});
  const db={tanks:[{id:'t',name:'Tank',balanceInit:0,reserveLevel:0.001}],procurementOrders:[],procurementRules:[]};
  assert.equal(procurement.plan(db,{date:'2026-09-01'})[0].suggestedQty,0.001);
  db.tanks[0].balanceInit=923.537;db.tankIncomes=[{tankId:'t',date:'2026-09-01',amount:0.001}];
  assert.equal(procurement.balance(db,'tank','t','2026-09-01'),923.538);
});
test('renderer and trusted generator consumption share decimal arithmetic',()=>{
  const ctx=app(),g={power:100,norm100:2.675},r={hours:1,load:100};
  assert.equal(ctx.genActualSpent(g,r),2.675);assert.equal(ctx.genActualSpent(g,r),policy.generatorSpent(g,r));
  assert.equal(ctx.genNormSpent(g,{...r,fuelActual:0}),2.675);
  assert.equal(ctx.genActualSpent(g,{...r,fuelActual:0}),0);
});
test('financial groups add the same exact legacy amounts and debts that their source rows expose',()=>{
  const ctx=vm.createContext({DecimalCore,console,data:{vehicles:[],contragents:[],payments:[
    {id:'a',date:'2026-09-01',category:'Synthetic',sum:0.1},
    {id:'b',date:'2026-09-01',category:'Synthetic',sum:0.2,paid:true},
    {id:'c',date:'2026-09-01',category:'Synthetic',sum:0.105,paidAmount:0.005}
  ]}});
  for(const file of ['21-finances.js','23-reports.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/js',file),'utf8'),ctx,{filename:file});
  const before=JSON.stringify(ctx.data),group=ctx.reportsPaymentGroups(ctx.data.payments)[0];
  assert.equal(group.sum,0.405);assert.equal(group.paid,0.205);assert.equal(group.debt,0.2);assert.equal(JSON.stringify(ctx.data),before);
  assert.throws(()=>ctx.reportsPaymentGroups([{category:'Synthetic',sum:Infinity}]),/число|диапазон/i);
});
