'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const valuation=require('../assets/core/cost-valuation'),schema=require('../assets/core/platform-schema');
const policy=(method='fifo')=>({version:1,from:'2026-09-01',method,taxBasis:'net',opening:{qty:0,amount:0,basis:'Synthetic confirmed opening'},basis:'Synthetic explicit valuation'});
function fixture(method='fifo'){
 return {...Object.fromEntries(schema.sections.map(section=>[section,[]])),vehicles:[{id:0,org:'A',fuel:'diesel',fuelGrade:'ДТ',fuelBalance:0,norm:0,costValuation:policy(method)}]};
}
function receipt(db,id,date,qty,sum,vehicleId=0,org='A'){
 const recordId='journal-'+id;
 db.fuelPurchases.push({id,vehicleId,recordId,date,qty,sum,grade:'ДТ',sourceOrg:org});
 db.records.push({id:recordId,vehicleId,date,fuelIssued:qty,fuelGrade:'ДТ',fuelOrg:org,fuelActual:0});
}
function refund(db,date,qty,sum,extra={}){db.fuelPurchases.push({id:'refund',vehicleId:0,date,qty,operationKind:'return',grade:'ДТ',sourceOrg:'A',...(sum===undefined?{}:{sum}),...extra});}
function project(db,options={}){return valuation.project(db,{targets:[{section:'vehicles',id:0}],to:'2026-09-30',...options}).rows[0];}

test('vehicle fuel refunds remove stock book value once under FIFO and weighted average without creating consumption',()=>{
 for(const method of ['fifo','weightedAverage']){
  const db=fixture(method);receipt(db,'first','2026-09-01',10,100);receipt(db,'second','2026-09-02',20,400);refund(db,'2026-09-03',-6,-999);
  db.records.push({id:'burn',vehicleId:0,date:'2026-09-04',km:100,fuelIssued:0,fuelActual:6});const original=JSON.stringify(db),row=project(db);
  assert.equal(row.status,'known',JSON.stringify(row.diagnostics));assert.equal(row.closing.qty,18);assert.equal(row.closing.amount,method==='fifo'?360:300);
  assert.equal(row.acquisitions.length,2);assert.equal(row.supplierReturns.length,1);assert.equal(row.supplierReturns[0].source.section,'fuelPurchases');assert.equal(row.supplierReturns[0].source.id,'refund');
  assert.equal(row.supplierReturns[0].qtyDecimal,'6');assert.equal(row.supplierReturns[0].amount,method==='fifo'?60:100);assert.match(row.supplierReturns[0].basis,/возмещение не/);
  const consumed=row.consumptions.filter(item=>item.qtyDecimal!=='0');assert.equal(consumed.length,1);assert.equal(consumed[0].source.id,'burn');assert.equal(consumed[0].qtyDecimal,'6');assert.equal(consumed[0].amount,method==='fifo'?80:100);
  assert.equal(row.variances.length,0);assert.equal(JSON.stringify(db),original);assert.equal(db.fuelPurchases.at(-1).sum,-999);assert.equal(db.records.at(-1).km,100);
 }
});

test('refund cash amount is kept separate from outgoing book value including zero, missing and positive source sums',()=>{
 for(const sum of [undefined,null,0,-1,-900,900]){
  const db=fixture();receipt(db,'first','2026-09-01',50,500);refund(db,'2026-09-02',-10,sum);const original=JSON.stringify(db),row=project(db);
  assert.equal(row.closing.qty,40);assert.equal(row.closing.amount,400);assert.equal(row.supplierReturns[0].amount,100);assert.equal(row.consumptions.some(item=>item.qtyDecimal!=='0'),false);assert.equal(row.acquisitions.length,1);assert.equal(JSON.stringify(db),original);
 }
});

test('report opening includes earlier refunds and its period contains no duplicate variance or prior refund',()=>{
 const db=fixture();receipt(db,'first','2026-09-01',50,500);refund(db,'2026-09-02',-10,-100);db.records.push({id:'burn',vehicleId:0,date:'2026-09-04',fuelIssued:0,fuelActual:5});
 const row=project(db,{from:'2026-09-03'});assert.equal(row.opening.qty,40);assert.equal(row.opening.amount,400);assert.equal(row.closing.qty,35);assert.equal(row.closing.amount,350);assert.equal(row.supplierReturns.length,0);assert.equal(row.variances.length,0);assert.equal(row.consumptions.length,1);
 assert.equal(valuation.openingAt(db,{section:'vehicles',id:0},'2026-09-03').qty,40);
});

test('mixed fuel organizations never lend a known foreign price to a refund and typed asset zero stays separate',()=>{
 for(const method of ['fifo','weightedAverage']){
  const db=fixture(method);db.vehicles.push({id:'0',org:'Other',fuel:'diesel',fuelGrade:'ДТ',fuelBalance:0,norm:0,costValuation:policy(method)});
  receipt(db,'A','2026-09-01',20,200);receipt(db,'B','2026-09-02',30,900,0,'B');receipt(db,'other','2026-09-01',30,1200,'0','Other');refund(db,'2026-09-03',-10,-100);db.records.push({id:'burn',vehicleId:0,date:'2026-09-04',fuelIssued:0,fuelActual:5});
  const result=valuation.project(db,{targets:[{section:'vehicles',id:0},{section:'vehicles',id:'0'}],to:'2026-09-30'}),row=result.rows[0],other=result.rows[1];
  assert.equal(row.closing.qty,35);assert.equal(row.supplierReturns[0].amount,null);assert.equal(row.consumptions.find(item=>item.source.id==='burn').amount,null);assert.equal(row.closing.amount,null);assert.equal(row.status,'unknown');assert.ok(row.diagnostics.some(issue=>issue.code==='VALUATION_RETURN_SCOPE_UNKNOWN'));
  assert.equal(other.status,'known');assert.equal(other.closing.qty,30);assert.equal(other.closing.amount,1200);assert.equal(other.supplierReturns.length,0);
 }
});

test('a later different-organization receipt does not erase the proven book value of an earlier refund',()=>{
 const db=fixture();receipt(db,'A','2026-09-01',20,200);refund(db,'2026-09-02',-10,-100);receipt(db,'later-B','2026-09-03',30,900,0,'B');
 const row=project(db,{to:'2026-09-02'});assert.equal(row.status,'known');assert.equal(row.closing.qty,10);assert.equal(row.closing.amount,100);assert.equal(row.supplierReturns[0].amount,100);assert.equal(row.diagnostics.some(issue=>issue.code==='VALUATION_RETURN_SCOPE_UNKNOWN'),false);
});

test('explicit opening fuel origin permits book value, while an undivided opening never supplies an assumed organization price',()=>{
 for(const explicit of [true,false]){
  const db=fixture();db.vehicles[0].fuelAccounting={version:1,from:'2026-09-01',opening:10,basis:'Synthetic measured stock',...(explicit?{sources:[{org:'A',grade:'ДТ',qty:10}]}:{})};db.vehicles[0].costValuation={...policy(),opening:{qty:10,amount:100,basis:'Synthetic opening value'}};refund(db,'2026-09-02',-2,-20);
  const row=project(db);assert.equal(row.closing.qty,8);assert.equal(row.supplierReturns[0].amount,explicit?20:null);assert.equal(row.closing.amount,explicit?80:null);assert.equal(row.status,explicit?'known':'unknown');
  assert.equal(row.diagnostics.some(issue=>issue.code==='VALUATION_RETURN_SCOPE_UNKNOWN'),!explicit);
 }
});

test('a mixed fuel grade pool does not supply another grade price to the returned diesel',()=>{
 const db=fixture();receipt(db,'diesel','2026-09-01',20,200);receipt(db,'gasoline','2026-09-02',30,900);db.fuelPurchases[1].grade='АИ-92';db.records[1].fuelGrade='АИ-92';refund(db,'2026-09-03',-10,-100);
 const row=project(db);assert.equal(row.closing.qty,40);assert.equal(row.supplierReturns[0].amount,null);assert.equal(row.closing.amount,null);assert.ok(row.diagnostics.some(issue=>issue.code==='VALUATION_RETURN_SCOPE_UNKNOWN'));
});
