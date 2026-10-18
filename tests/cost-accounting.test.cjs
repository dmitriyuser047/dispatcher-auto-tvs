const {test}=require('node:test');
const assert=require('node:assert/strict');
const cost=require('../assets/js/45-cost-engine.js');
const period={from:'2026-10-01',to:'2026-10-31'};
const base=()=>({vehicles:[{id:'a',plate:'А001'},{id:'b',plate:'Б002'}],generators:[{id:'g',name:'Г1'}],records:[{id:'r',vehicleId:'a',date:'2026-10-18',km:100}],genRecords:[{id:'gr',generatorId:'g',date:'2026-10-18',hours:10}],costEntries:[],costProfiles:[]});
const manual=(id,kind,amount,extra={})=>({id,kind,amount,assetRef:'v:a',date:'2026-10-18',title:id,category:'Прочее',independent:true,...extra});
const report=(db,options={})=>cost.buildReport(db,{...period,...options});
const row=(db,ref='v:a',options={})=>report(db,options).rows.find(row=>row.assetRef===ref);

test('known actual document costs and income use journal units and do not fabricate full profitability',()=>{
 const db=base();db.costEntries=[manual('rent','expense',1000),manual('revenue','income',1500)];
 db.shiftReports=[{assetRef:'v:a',odoStart:0,odoEnd:100}];db.dispatchJobs=[{assetRef:'v:a',actualKm:100,cost:1000}];
 const value=row(db);assert.equal(value.expenses,1000);assert.equal(value.quantity,100);assert.equal(value.rate,10);assert.equal(value.income,1500);assert.equal(value.result,500);assert.equal(value.margin,500/1500*100);
 db.costEntries=[manual('revenue','income',1500)];assert.equal(row(db).result,null);assert.equal(row(db).expenses,null);
});
test('explicit zero is preserved but missing costs or denominator remain unknown',()=>{
 const db=base();db.costEntries=[manual('free','expense',0),manual('no-revenue','income',0)];
 assert.equal(row(db).rate,0);assert.equal(row(db).result,null);
 db.records[0].km=0;assert.equal(row(db).quantity,0);assert.equal(row(db).rate,null);
 db.records[0].km=null;assert.equal(row(db).quantity,null);assert.equal(row(db).rate,null);assert.equal(row(db).unknownQuantityRows,1);
 db.repairs=[{id:'rp',vehicleId:'b',invoiceDate:'2026-10-18',cost:null}];assert.equal(row(db,'v:b').expenses,null);assert.ok(row(db,'v:b').issues.some(issue=>issue.code==='amount'));
});
test('partly missing journal distance cannot produce a misleading per-kilometre value',()=>{
 const db=base();db.records.push({id:'missing',vehicleId:'a',date:'2026-10-19',km:null});db.costEntries=[manual('e','expense',100)];
 const value=row(db);assert.equal(value.quantity,100);assert.equal(value.quantityComplete,false);assert.equal(value.rate,null);
});
test('journal row with an unknown date makes denominator coverage uncertain instead of silently understating units',()=>{
 const db=base();db.records.push({id:'undated',vehicleId:'a',date:'2026-02-30',km:50});db.costEntries=[manual('e','expense',100)];
 const value=row(db);assert.equal(value.quantity,100);assert.equal(value.rate,null);assert.ok(value.issues.some(issue=>issue.code==='date'));
});
test('period is inclusive, source dates are respected, asset/type scopes do not mix kilometre and hour',()=>{
 const db=base();db.costEntries=[manual('one','expense',10,{date:'2026-10-01'}),manual('two','expense',20,{date:'2026-10-31'}),manual('old','expense',900,{date:'2026-09-30'}),manual('other','expense',100,{assetRef:'v:b'}),manual('gen','expense',500,{assetRef:'g:g'})];
 assert.equal(row(db).expenses,30);assert.equal(row(db,'g:g').rate,50);assert.equal(row(db,'g:g').unit,'ч');
 assert.equal(report(db,{assetRef:'v:a'}).totals.expenses,30);assert.deepEqual(report(db,{kind:'generator'}).rows.map(row=>row.assetRef),['g:g']);
 assert.throws(()=>report(db,{from:'2026-10-31',to:'2026-10-01'}),/период/);assert.throws(()=>report(db,{from:'2026-02-30'}),/период/);
});
test('repair, completed maintenance and accepted actual work-order facts exclude linked finance payments',()=>{
 const db=base();db.repairs=[{id:'repair',vehicleId:'a',invoiceDate:'2026-10-10',cost:200,invoiceNo:'R1'}];
 db.vehicleTo=[{id:'to',vehicleId:'a',date:'2026-10-11',cost:300},{id:'plan',vehicleId:'a',date:'2026-10-12',cost:900,planned:true}];
 db.toRecords=[{id:'gto',generatorId:'g',date:'2026-10-18',cost:80}];
 db.workOrders=[{id:'wo',assetRef:'v:a',status:'accepted',actualCost:400,cost:999,downtimeTo:'2026-10-13T12:00'},{id:'proposal',assetRef:'v:a',status:'approved',cost:700,downtimeTo:'2026-10-13T13:00'}];
 db.payments=[{id:'p1',vehicleId:'a',date:'2026-10-14',sum:200,source:'repair',sourceId:'repair'},{id:'p2',vehicleId:'a',date:'2026-10-15',sum:300,source:'to',sourceId:'to'},{id:'p3',assetRef:'v:a',date:'2026-10-16',sum:400,source:'workOrder',sourceId:'wo'}];
 const value=row(db);assert.equal(value.expenses,900);assert.equal(value.entries.length,3);assert.equal(value.exclusions.length,5);assert.equal(row(db,'g:g').expenses,80);
});
test('same invoice and suspicious unlinked maintenance payments require review instead of duplicate cost',()=>{
 const db=base();db.repairs=[{id:'r1',vehicleId:'a',invoiceDate:'2026-10-18',cost:200,invoiceNo:'A 12'}];
 db.payments=[{id:'p1',vehicleId:'a',date:'2026-10-18',sum:200,invoiceNo:'a12',category:'Прочее'},{id:'p2',vehicleId:'a',date:'2026-10-18',sum:200,category:'Ремонт'},{id:'p3',vehicleId:'a',date:'2026-10-18',sum:50,category:'Страхование'}];
 assert.equal(row(db).expenses,250);assert.equal(row(db).exclusions.length,2);assert.ok(row(db).issues.some(issue=>issue.code==='review'));
});
test('same invoice repeated across primary repair and work-order is not added twice',()=>{
 const db=base();db.repairs=[{id:'r1',vehicleId:'a',invoiceDate:'2026-10-18',cost:200,invoiceNo:'A1'}];db.workOrders=[{id:'wo',assetRef:'v:a',downtimeTo:'2026-10-18T12:00',status:'accepted',actualCost:200,invoiceNo:'A1'}];
 assert.equal(row(db).expenses,200);assert.equal(row(db).exclusions.length,1);
 db.workOrders[0].invoiceNo='';assert.equal(row(db).expenses,200);assert.ok(row(db).exclusions[0].reason.includes('самостоятельный'));
});
test('reused invoice numbers on different dates or from different suppliers are separate expenses',()=>{
 const db=base();db.repairs=[
  {id:'r1',vehicleId:'a',invoiceDate:'2026-10-10',cost:200,invoiceNo:'1',contragent:'Поставщик А'},
  {id:'r2',vehicleId:'a',invoiceDate:'2026-10-11',cost:200,invoiceNo:'1',contragent:'Поставщик А'},
  {id:'r3',vehicleId:'a',invoiceDate:'2026-10-11',cost:200,invoiceNo:'1',contragent:'Поставщик Б'}];
 assert.equal(row(db).expenses,600);assert.equal(row(db).exclusions.length,0);
});
test('accepted work order without confirmed actual cost is unknown; proposed cost is never converted to fact',()=>{
 const db=base();db.workOrders=[{id:'wo',assetRef:'v:a',downtimeTo:'2026-10-18T12:00',status:'accepted',cost:800}];
 assert.equal(row(db).expenses,null);assert.ok(row(db).issues.some(issue=>issue.code==='amount'));
 db.workOrders[0].incurred=true;assert.equal(row(db).expenses,800);
});
test('linked purchases are counted once, not again as fuelSum; discrepancies are explicit',()=>{
 const db=base();db.records[0].fuelSum=300;db.records[0].fuelIssued=5;
 db.fuelPurchases=[{id:'p1',vehicleId:'a',recordId:'r',date:'2026-10-18',qty:2,sum:120},{id:'p2',vehicleId:'a',recordId:'r',date:'2026-10-18',qty:3,sum:180}];
 assert.equal(row(db).expenses,300);assert.equal(row(db).entries.length,2);
 db.records[0].fuelSum=400;assert.equal(row(db).expenses,300);assert.ok(row(db).issues.some(issue=>issue.code==='fuel-sum'));
 db.fuelPurchases[1].deleted=true;assert.equal(row(db).expenses,120);
});
test('restored fuel estimates and fuel with unknown amounts are not invented as factual zero',()=>{
 const db=base();db.records[0].fuelIssued=5;db.records[0].fuelSum=300;
 db.fuelPurchases=[{id:'p1',vehicleId:'a',recordId:'r',date:'2026-10-18',qty:5,sum:300,restored:true}];
 assert.equal(row(db).expenses,300);assert.equal(row(db).estimates.length,1);assert.ok(row(db).issues.some(issue=>issue.code==='fuel-restored'));
 db.fuelPurchases[0].restored=false;db.fuelPurchases[0].sum=null;assert.equal(row(db).expenses,null);assert.ok(row(db).issues.some(issue=>issue.code==='amount'));
 db.fuelPurchases=[];db.records[0].fuelSum=null;assert.equal(row(db).expenses,null);assert.ok(row(db).issues.some(issue=>issue.code==='fuel-price'));
});
test('restored purchase splits preserve the known journal aggregate without adding exact purchases twice',()=>{
 const db=base();db.records[0].fuelSum=300;db.fuelPurchases=[{id:'exact',vehicleId:'a',recordId:'r',date:'2026-10-18',qty:2,sum:120},{id:'restored',vehicleId:'a',recordId:'r',date:'2026-10-18',qty:3,sum:180,restored:true}];
 const value=row(db);assert.equal(value.expenses,300);assert.equal(value.rate,3);assert.equal(value.entries.length,1);assert.equal(value.entries[0].sourceKey,'records:r');assert.match(value.entries[0].note,/fuelPurchases:exact.*fuelPurchases:restored/);assert.equal(value.estimates.length,1);assert.equal(value.exclusions.length,1);assert.ok(value.issues.some(issue=>issue.code==='fuel-restored'));
 db.records[0].fuelSum=0;assert.equal(row(db).expenses,0);assert.equal(row(db).rate,0);
 db.records[0].fuelSum=null;assert.equal(row(db).expenses,120);assert.equal(row(db).estimates.length,1);
});
test('ambiguous purchase links suppress journal aggregates while preserving primary purchase amount',()=>{
 const db=base();db.records[0].fuelSum=300;db.records.push({id:'r2',vehicleId:'a',date:'2026-10-18',km:0,fuelSum:300});
 db.fuelPurchases=[{id:'p1',vehicleId:'a',date:'2026-10-18',qty:5,sum:300}];
 assert.equal(row(db).expenses,300);assert.ok(row(db).issues.some(issue=>issue.code==='fuel-link'));
});
test('unassigned general expenses are visible separately and never arbitrarily distributed over fleet',()=>{
 const db=base();db.payments=[{id:'p',date:'2026-10-18',sum:999,category:'Связь',description:'Общие расходы'}];
 const result=report(db);assert.equal(result.totals.expenses,null);assert.equal(result.unassigned.length,1);assert.equal(result.unassigned[0].amount,999);assert.equal(row(db).expenses,null);
});
test('orphan repair and payment documents remain unassigned with review, while filtered existing assets stay out of scope',()=>{
 const db=base();db.repairs=[{id:'orphanRepair',vehicleId:'missing',invoiceDate:'2026-10-18',cost:300},{id:'knownOther',vehicleId:'b',invoiceDate:'2026-10-18',cost:70}];db.payments=[{id:'orphanPayment',vehicleId:'missing',date:'2026-10-18',sum:200,category:'Страхование'}];
 const result=report(db);assert.equal(result.unassigned.length,2);assert.equal(result.unassigned.reduce((sum,entry)=>sum+entry.amount,0),500);assert.equal(result.totals.expenses,70);assert.equal(result.totals.review,2);assert.equal(result.issues.filter(issue=>issue.code==='orphan-asset').length,2);assert.ok(result.unassigned.every(entry=>entry.review&&entry.note.includes('v:missing')));
 const scoped=report(db,{assetRef:'v:a'});assert.equal(scoped.unassigned.length,0);assert.equal(scoped.issues.length,0);assert.equal(scoped.totals.expenses,null);
 const generators=report(db,{kind:'generator'});assert.equal(generators.unassigned.length,0);assert.equal(generators.issues.length,0);assert.equal(generators.totals.expenses,null);
 db.repairs=db.repairs.slice(0,1);assert.equal(report(db).totals.expenses,null);assert.equal(report(db).unassigned.length,2);
});
test('unknown part prices and orphan source payments are visible for reconciliation without inferred amounts',()=>{
 const db=base();db.partMovements=[{id:'pm',assetRef:'v:a',date:'2026-10-18',kind:'issue',qty:1}];db.payments=[{id:'orphan',vehicleId:'a',date:'2026-10-18',source:'repair',sourceId:'missing',sum:300}];
 assert.equal(row(db).expenses,null);assert.ok(row(db).issues.some(issue=>issue.code==='parts-price'));assert.ok(row(db).issues.some(issue=>issue.code==='review'));
});
test('rate scenarios use litres/100km or litres/hour, remain separate from facts and retain zero/unknown rates',()=>{
 const db=base();db.costEntries=[manual('e','expense',1000)];db.costProfiles=[{id:'cp',assetRef:'v:a',salaryRate:5,depreciationRate:0,fuelRate:10,fuelPrice:60},{id:'cg',assetRef:'g:g',salaryRate:0,depreciationRate:null,fuelRate:2,fuelPrice:60}];
 const value=row(db);assert.equal(value.expenses,1000);assert.equal(value.rate,10);assert.equal(value.scenario.rate,11);assert.equal(value.scenario.amount,1100);assert.equal(value.scenario.complete,true);
 assert.equal(row(db,'g:g').scenario.rate,120);assert.equal(row(db,'g:g').scenario.complete,false);assert.equal(row(db,'g:g').scenario.pieces[1].rate,null);
});
test('inaccessible financial sources are not read even if stale cache contains them',()=>{
 const db=base();db.payments=[{id:'private',vehicleId:'a',date:'2026-10-18',sum:999,category:'Аренда'}];db.costEntries=[manual('e','expense',100)];
 const result=report(db,{readable:['vehicles','records','costEntries']});assert.equal(result.rows[0].expenses,100);assert.equal(result.rows.length,2);assert.ok(result.unavailable.includes('payments'));assert.equal(JSON.stringify(result).includes('private'),false);
 const noDistance=report(db,{readable:['vehicles','costEntries']}).rows[0];assert.equal(noDistance.rate,null);
});
test('backend validation accepts independent zero facts and optional zero/null profiles',()=>{
 const db=base();assert.equal(cost.validateSection('costEntries',[manual('e','expense',0)],db),true);
 assert.equal(cost.validateSection('costProfiles',[{id:'p',assetRef:'g:g',salaryRate:0,fuelRate:null,fuelPrice:0}],db),true);
});
test('backend rejects invalid dates, negative/missing/string amounts, references, kinds, duplicates and unconfirmed manual operations',()=>{
 const db=base();for(const patch of [{date:'2026-02-30'},{date:'18.10.2026'},{amount:-1},{amount:null},{amount:'2'},{amount:Infinity},{assetRef:'v:missing'},{assetRef:'t:tank'},{kind:'profit'},{independent:false},{title:''}]) assert.throws(()=>cost.validateSection('costEntries',[manual('e','expense',5,patch)],db));
 assert.throws(()=>cost.validateSection('costEntries',[manual('e','expense',5),manual('e','expense',10)],db));
 assert.throws(()=>cost.validateSection('costProfiles',[{id:'p',assetRef:'v:a',salaryRate:-1}],db));
 assert.throws(()=>cost.validateSection('costProfiles',[{id:'p',assetRef:'v:a',salaryRate:''}],db));
 assert.throws(()=>cost.validateSection('costProfiles',[{id:'p',assetRef:'v:a'},{id:'p2',assetRef:'v:a'}],db));
 const malicious=JSON.parse('{"id":"x","date":"2026-10-18","assetRef":"v:a","kind":"expense","amount":1,"title":"x","independent":true,"__proto__":{}}');assert.throws(()=>cost.validateSection('costEntries',[malicious],db));
});
test('calculation is pure and keeps archived historical assets in the selected period',()=>{
 const db=base();db.vehicles[0].archived=true;db.costEntries=[manual('e','expense',10)];const original=JSON.stringify(db);assert.equal(row(db).expenses,10);assert.equal(JSON.stringify(db),original);
});
