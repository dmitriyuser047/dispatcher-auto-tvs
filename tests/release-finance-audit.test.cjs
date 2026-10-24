'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const schema=require('../assets/core/platform-schema'),fuel=require('../assets/core/fuel-engine'),valuation=require('../assets/core/cost-valuation'),cost=require('../assets/js/45-cost-engine'),ops=require('../assets/core/cost-operations'),docs=require('../assets/core/document-engine'),sources=require('../assets/core/financial-recognition'),procurement=require('../assets/core/procurement-operations'),D=require('../assets/core/decimal-core');
const today='2026-10-22',actor={id:'release-finance-synthetic',name:'Synthetic accountant',role:'accountant'},context=id=>({id,today,now:today+'T12:00:00.000Z',actor});
const policy=(qty=0,amount=0)=>({version:1,from:'2026-09-01',method:'fifo',taxBasis:'net',opening:{qty,amount,basis:'Synthetic measured opening'},basis:'Explicit synthetic valuation'});
const database=(patch={})=>({...Object.fromEntries(schema.sections.map(name=>[name,[]])),...patch});
function documentAction(db,input,id){const review=docs.preview(db,input,{today});assert.equal(review.canPost,true,JSON.stringify(review.issues));return {...db,...docs.plan(db,{...input,reviewFingerprint:review.fingerprint},context(id)).sections};}
function procurementAction(db,input,id){const review=procurement.preview(db,input,{today});assert.equal(review.canApply,true,JSON.stringify(review.issues));return {...db,...procurement.plan(db,{...input,reviewFingerprint:review.fingerprint},context(id)).sections};}
const report=db=>cost.buildFullReport(db,{from:'2026-09-01',to:'2026-09-30'});

function splitFuelFixture(){return database({vehicles:[{id:'v',plate:'SYNTHETIC',org:'A',fuel:'diesel',fuelGrade:'ДТ',fuelBalance:3,fuelBalanceSources:[{org:'A',grade:'ДТ',qty:1},{org:'B',grade:'ДТ',qty:2}],norm:10,costValuation:policy(3,30)}],records:[{id:'first',vehicleId:'v',date:'2026-09-01',km:1,kmGlonass:1,fuelActual:3},{id:'later',vehicleId:'v',date:'2026-09-02',km:10000,kmGlonass:10000,fuelIssued:20,fuelOrg:'A',fuelActual:20,fuelSum:200}]});}
test('current vehicle valuation uses current physical arithmetic for split source thirds followed by large mileage',()=>{
 const db=splitFuelFixture(),before=JSON.stringify(db),target={section:'vehicles',id:'v'};
 assert.doesNotThrow(()=>fuel.buildLedger(db));
 const row=valuation.project(db,{targets:[target],to:'2026-09-30'}).rows[0];
 assert.equal(row.closing.qtyDecimal,'0');assert.equal(row.closing.amountDecimal,'0');assert.equal(D.sum(row.consumptions.map(value=>value.amountDecimal)),'230');
 const opening=valuation.openingAt(db,target,'2026-09-03');assert.equal(opening.qtyDecimal,'0');
 const full=report(db);assert.equal(full.rows[0].quantity,10001);assert.equal(full.rows[0].consumptionAmount,230);assert.equal(full.totals.stock,0);assert.equal(JSON.stringify(db),before);
});

test('actual cents remain cash after an obligation correction without duplicating recognized expenses',()=>{
 let db=database({contragents:[{id:'c',name:'Synthetic supplier'}],payments:[{id:0,date:'2026-09-01',sum:.30,description:'Synthetic obligation',contragentId:'c',paidAmount:.10,paidDate:'2026-09-01'}]});
 const original=JSON.stringify(db.payments[0]),sourceFingerprint=sources.resolveExpense(db,{section:'payments',id:0}).fingerprint;
 db=documentAction(db,{action:'settle',section:'payments',id:0,amount:.20,date:'2026-09-02',reason:'Actual synthetic bank transfer'},'payment');
 assert.equal(sources.resolveExpense(db,{section:'payments',id:0}).fingerprint,sourceFingerprint);
 const beforeCorrection=report(db);assert.equal(beforeCorrection.totals.recognizedAmount,.30);assert.equal(beforeCorrection.totals.cash,.30);
 const draft=docs.plan(db,{action:'saveDraft',section:'payments',correctionOf:{section:'payments',id:0},payload:{sum:.25,description:'Corrected obligation'},reason:'Synthetic correction'},context('draft'));db={...db,...draft.sections};
 db=documentAction(db,{action:'postDraft',section:'payments',draftId:'draft'},'corrected');
 const result=report(db),effective=docs.effectiveRow(db,'payments','corrected');
 assert.equal(result.totals.recognizedAmount,.25);assert.equal(result.cash.knownTotal,.30);assert.equal(result.cash.rows.length,2);assert.equal(effective.paidAmount,.30);assert.equal(D.sub(effective.paidAmount,effective.sum),'0.05');
 assert.equal(JSON.stringify(Object.fromEntries(Object.keys(JSON.parse(original)).map(key=>[key,db.payments[0][key]]))),original);
 assert.equal(result.recognized.sources.length,1);assert.equal(result.recognized.sources[0].root.id,0);
});

test('weighted shared expense allocates indivisible cents exactly across typed IDs',()=>{
 const targets=[{section:'vehicles',id:0},{section:'vehicles',id:'0'},{section:'vehicles',id:2},{section:'vehicles',id:3}],db=database({vehicles:targets.map(value=>({id:value.id,plate:'Synthetic '+typeof value.id+value.id})),records:targets.map((value,index)=>({id:'km'+index,vehicleId:value.id,date:'2026-09-02',km:[1,2,3,7][index]})),payments:[{id:'cost',date:'2026-09-01',sum:.05,description:'Five indivisible cents'}]});
 const before=JSON.stringify(db),input={action:'saveAllocation',payload:{source:{section:'payments',id:'cost'},method:'km',from:'2026-09-01',to:'2026-09-30',targets,basis:'Actual synthetic mileage'},reason:'Synthetic full cost split'},review=ops.preview(db,input,{today});
 assert.equal(review.canApply,true,JSON.stringify(review.issues));const plan=ops.plan(db,{...input,reviewFingerprint:review.fingerprint},context('allocation')),assigned=plan.sections.costEntries[0].costAllocation.targets;
 assert.deepEqual(assigned.map(value=>value.amount),[0,.01,.01,.03]);assert.equal(assigned.reduce((sum,value)=>sum+BigInt(Math.round(value.amount*100)),0n),5n);
 assert.deepEqual(assigned.map(value=>[typeof value.id,value.id]),[['number',0],['string','0'],['number',2],['number',3]]);assert.equal(JSON.stringify(db),before);
});

test('supplier return and actual inverse conserve original cents and never manufacture cash',()=>{
 let db=database({parts:[{id:'p',name:'Synthetic part',costValuation:policy()}]});
 db=procurementAction(db,{action:'saveOrder',reason:'Synthetic order',payload:{kind:'part',itemId:'p',supplier:'Synthetic supplier',quantity:7,deliveryDate:'2026-09-01',status:'ordered',note:''}},'order');
 db.partMovements.push({id:'receipt',partId:'p',date:'2026-09-01',kind:'receipt',qty:7,sum:.07,procurementReceipt:{version:1,orderId:'order'}});
 const receipt=JSON.stringify(db.partMovements[0]);db=procurementAction(db,{action:'supplierReturn',kind:'part',orderId:'order',receipt:{section:'partMovements',id:'receipt'},qty:2,date:'2026-09-02',reason:'Actual synthetic return'},'return');
 let value=report(db);assert.equal(value.totals.stock,.05);assert.equal(value.totals.cash,0);assert.equal(value.valuation.rows[0].supplierReturns[0].amount,.02);
 db=documentAction(db,{action:'reverse',section:'partMovements',id:'return',reason:'Actual reversal of supplier return'},'inverse');value=report(db);
 assert.equal(value.totals.stock,.07);assert.equal(value.totals.cash,0);assert.equal(D.sum(value.valuation.rows[0].supplierReturns.map(entry=>entry.amountDecimal)),'0');assert.equal(JSON.stringify(db.partMovements[0]),receipt);assert.deepEqual(db.payments,[]);
});

test('unknown value or payment date remains incomplete while explicit zero is authoritative',()=>{
 for(const amount of [null,0]){const db=database({parts:[{id:'p',price:999,costValuation:policy()}],partMovements:[{id:'receipt',partId:'p',date:'2026-09-01',kind:'receipt',qty:1,sum:amount}]}),before=JSON.stringify(db),result=report(db);assert.equal(result.totals.stock,amount);assert.equal(result.valuation.rows[0].closing.qty,1);assert.equal(JSON.stringify(db),before);if(amount===null)assert.equal(result.totals.complete,false);}
 const undated=report(database({payments:[{id:'p',date:'2026-09-01',sum:.10,paid:true}]}));assert.equal(undated.totals.cash,null);assert.equal(undated.cash.complete,false);assert.equal(undated.cash.rows[0].date,null);assert.equal(undated.cash.rows[0].amount,.10);
});
