'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const schema=require('../assets/core/platform-schema.js'),sources=require('../assets/core/financial-recognition.js'),costs=require('../assets/js/45-cost-engine.js');
function fixture(explicit){const db=Object.fromEntries(schema.sections.map(name=>[name,[]]));db.vehicles=[{id:0,plate:'SYNTHETIC COST DATE',fuel:'diesel',fuelGrade:'ДТ',fuelBalance:0,norm:0,costValuation:{version:1,from:'2026-09-01',method:'fifo',taxBasis:'gross',opening:{qty:0,amount:0,basis:'Synthetic empty physical opening'},basis:'Synthetic confirmed valuation'}}];db.workOrders=[{id:0,assetRef:'v:0',title:'Synthetic actual repair',status:'accepted',actualCost:100,downtimeFrom:'2026-09-29T10:00',downtimeTo:'2026-09-30T18:00',completedAt:'2026-10-01T09:00',acceptedBy:'Synthetic receiver',result:'Actual completed work',...(explicit?{downtime:{version:1,mode:'interval'}}:{})}];return db;}
const september={from:'2026-09-01',to:'2026-09-30'},october={from:'2026-10-01',to:'2026-10-31'};

test('new repair recognition follows the actual completion month in both cost reports and its canonical expense source',()=>{
 const db=fixture(true),before=JSON.stringify(db),source=sources.projectExpenses(db).sources[0];assert.deepEqual(source.root,{section:'workOrders',id:0});assert.equal(source.date,'2026-10-01');assert.equal(costs.buildReport(db,september).totals.expenses,null);assert.equal(costs.buildReport(db,october).totals.expenses,100);assert.equal(costs.buildFullReport(db,september).totals.recognizedAmount,0);assert.equal(costs.buildFullReport(db,october).totals.recognizedAmount,100);assert.equal(JSON.stringify(db),before);
});

test('old accepted repairs retain their original downtime-end recognition date without retroactive normalization',()=>{
 const db=fixture(false),before=JSON.stringify(db);assert.equal(sources.projectExpenses(db).sources[0].date,'2026-09-30');assert.equal(costs.buildReport(db,september).totals.expenses,100);assert.equal(costs.buildReport(db,october).totals.expenses,null);assert.equal(costs.buildFullReport(db,september).totals.recognizedAmount,100);assert.equal(costs.buildFullReport(db,october).totals.recognizedAmount,0);assert.equal(JSON.stringify(db),before);
});

test('a confirmed repair without downtime uses completion evidence and never creates a fabricated downtime interval',()=>{
 const db=fixture(true),row=db.workOrders[0];row.downtime={version:1,mode:'none',basis:'Synthetic actual work without stopping equipment'};delete row.downtimeFrom;delete row.downtimeTo;const before=JSON.stringify(db);assert.equal(sources.workOrderDate(row),'2026-10-01');assert.equal(costs.buildReport(db,october).totals.expenses,100);assert.equal(costs.buildFullReport(db,october).totals.recognizedAmount,100);assert.equal(JSON.stringify(db),before);
});
