'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fuel=require('../assets/core/fuel-engine.js'),writeoff=require('../assets/core/writeoff-engine.js');
const period={from:'2026-09-01',to:'2026-09-30'},request={month:'2026-09',org:'A',grade:'АИ-95',date:'2026-09-30'},clone=value=>structuredClone(value);
const returnRow=(changes={})=>({id:'return',vehicleId:0,date:'2026-09-11',time:'12:00',grade:'АИ-95',product:'АИ-95',qty:-10,sum:-700,price:70,operationKind:'return',sourceOrg:'A',sourceProvider:'Synthetic provider',...changes});
function database(){return{vehicles:[{id:0,plate:'Synthetic',org:'A',fuel:'gasoline',fuelGrade:'АИ-95',fuelBalance:0,norm:10}],records:[{id:'r',vehicleId:0,date:'2026-09-10',fuelGrade:'АИ-95',fuelIssued:50,fuelActual:0,km:0}],fuelPurchases:[{id:'purchase',vehicleId:0,recordId:'r',date:'2026-09-10',time:'12:00',grade:'АИ-95',product:'АИ-95',qty:50,sum:3500,price:70,sourceOrg:'A',sourceProvider:'Synthetic provider'},returnRow()],fuelCards:[],monthlyFuel:[],fuelWriteoffs:[]};}
function ending(ledger){return ledger.rows.reduce((sum,row)=>sum+row.end,0);}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function balanced(ledger){for(const row of ledger.rows)assert.equal(fuel.gsmRound(row.start+row.issued+row.correction-row.spent),row.end);}

test('a signed supplier return reduces receipts once without changing the daily journal or combustion',()=>{
 const db=database(),before=JSON.stringify(db),ledger=fuel.buildLedger(freeze(db),period);assert.equal(fuel.calculationVersion,7);assert.equal(writeoff.calculationVersion,7);assert.equal(ending(ledger),40);assert.equal(ledger.rows[0].issued,40);assert.equal(ledger.rows[0].spent,0);assert.equal(ledger.rows[0].providers['Synthetic provider'],40);assert.equal(ledger.receipts.length,2);assert.equal(ledger.movements.filter(row=>row.kind==='return').length,1);assert.equal(ledger.movements.find(row=>row.kind==='return').qty,-10);assert.equal(ledger.receipts.find(row=>row.operationKind==='return').recordId,'');assert.deepEqual(ledger.errors,[]);assert.equal(JSON.stringify(db),before);balanced(ledger);
});

test('dated returns affect later balances and period carry, without rewriting an earlier journal row',()=>{
 const db=database();db.records[0].fuelActual=10;db.records[0].km=100;db.records.push({id:'after',vehicleId:0,date:'2026-09-12',fuelGrade:'АИ-95',fuelIssued:0,fuelActual:5,km:50});db.fuelPurchases.push(returnRow({id:'late',date:'2026-09-13',qty:-5,sum:-350}));
 const balances=fuel.recordBalances(db,0),ledger=fuel.buildLedger(db,period);assert.equal(fuel.recordBalanceAt(balances,'r'),40);assert.equal(fuel.recordBalanceAt(balances,'after'),25);assert.equal(ending(ledger),20);assert.equal(ledger.rows[0].spent,15);assert.equal(ledger.rows[0].km,150);
 const next=fuel.buildLedger(db,{from:'2026-10-01',to:'2026-10-31'});assert.equal(next.rows[0].start,20);assert.equal(next.rows[0].issued,0);assert.equal(next.rows[0].end,20);assert.equal(ending(fuel.buildLedger(db,{to:'2026-09-10'})),40);balanced(ledger);
});

test('a return never consumes another organization or grade and reports an actual shortage',()=>{
 for(const mixed of ['org','grade']){const db=database();db.records=[];db.fuelPurchases=[returnRow({qty:-35,sum:-2450})];db.vehicles[0].fuelBalance=50;db.vehicles[0].fuelBalanceSources=[{org:'A',grade:'АИ-95',qty:30},mixed==='org'?{org:'B',grade:'АИ-95',qty:20}:{org:'A',grade:'АИ-92',qty:20}];const ledger=fuel.buildLedger(db,period),own=ledger.rows.find(row=>row.org==='A'&&row.grade==='АИ-95'),other=ledger.rows.find(row=>row!==own);assert.equal(own.end,-5);assert.equal(other.end,20);assert.equal(ending(ledger),15);assert.equal(ledger.errors.find(row=>row.code==='return-source-shortage').qty,5);assert.equal(ledger.rows.reduce((sum,row)=>sum+row.spent,0),0);balanced(ledger);}
});

test('returns from mixed providers can use only the same organization and fuel pool, including opening stock',()=>{
 const db=database();db.records=[];db.fuelPurchases=[returnRow()];db.vehicles[0].fuelBalance=50;const ledger=fuel.buildLedger(db,period);assert.equal(ending(ledger),40);assert.deepEqual(ledger.errors,[]);balanced(ledger);
});

test('typed zero identities and separate gasoline grades remain distinct',()=>{
 const db=database();db.vehicles[0].fuelBalance=50;db.vehicles.push({...db.vehicles[0],id:'0',plate:'Other'});db.records=[{id:0,vehicleId:0,date:'2026-09-12',fuelIssued:0,fuelActual:0,km:0},{id:'0',vehicleId:'0',date:'2026-09-12',fuelIssued:0,fuelActual:0,km:0}];db.fuelPurchases=[returnRow()];const ledger=fuel.buildLedger(db,period);assert.equal(ledger.rows.find(row=>row.vehicleId===0).end,40);assert.equal(ledger.rows.find(row=>row.vehicleId==='0').end,50);const numeric=fuel.recordBalances(db,0),text=fuel.recordBalances(db,'0');assert.equal(fuel.recordBalanceAt(numeric,0),40);assert.equal(fuel.recordBalanceAt(text,'0'),50);assert.equal(fuel.recordBalanceAt(numeric,'0'),undefined);
});

test('returns preserve millilitre precision and source money signs; negative journal/price remain errors',()=>{
 const db=database();db.records[0].fuelIssued=50.123;db.fuelPurchases[0].qty=50.123;db.fuelPurchases[1].qty=-10.007;const ledger=fuel.buildLedger(db,period);assert.equal(ending(ledger),40.116);assert.equal(ledger.rows[0].issued,40.116);assert.deepEqual(ledger.errors,[]);
 for(const change of [{qty:10},{qty:0},{qty:-10,price:-70}]){const bad=clone(db);Object.assign(bad.fuelPurchases[1],change);assert.ok(fuel.buildLedger(bad,period).errors.length);}
 const journal=clone(db);journal.records[0].fuelIssued=-10;assert.ok(fuel.buildLedger(journal,period).errors.some(row=>row.code==='source-number'||row.code==='negative-input'));
 const positiveMoney=clone(db);positiveMoney.fuelPurchases[1].sum=700;assert.equal(fuel.buildLedger(positiveMoney,period).receipts.find(row=>row.operationKind==='return').sum,700);assert.ok(fuel.buildLedger(positiveMoney,period).issues.some(row=>row.code==='return-positive-sum'));
});

test('explicit accounting excludes older returns and measured end-of-day balances reset later journal carry',()=>{
 const db=database();db.vehicles[0].fuelAccounting={version:1,from:'2026-09-01',opening:50,basis:'Synthetic measured opening'};db.records=[{id:'measurement',vehicleId:0,date:'2026-09-12',fuelGrade:'АИ-95',fuelIssued:0,fuelActual:0,km:0,tankMeasured:30},{id:'after',vehicleId:0,date:'2026-09-13',fuelGrade:'АИ-95',fuelIssued:0,fuelActual:0,km:0}];db.fuelPurchases=[returnRow({id:'older',date:'2026-08-31',qty:-100,sum:-7000}),returnRow({date:'2026-09-11'})];const ledger=fuel.buildLedger(db,period);assert.equal(ledger.rows[0].start,50);assert.equal(ledger.rows[0].issued,-10);assert.equal(ledger.rows[0].end,30);assert.equal(ledger.receipts.length,1);const balances=fuel.recordBalances(db,0);assert.equal(fuel.recordBalanceAt(balances,'measurement'),30);assert.equal(fuel.recordBalanceAt(balances,'after'),30);
});

test('v7 acts include signed return receipts with unchanged consumption and keep posted v6 acts verifiable',()=>{
 const db=database();db.records[0].fuelActual=10;db.records[0].km=100;const prepared=writeoff.prepare(db,request);assert.equal(prepared.canPost,true,JSON.stringify(prepared.issues));assert.equal(prepared.calculationVersion,7);assert.equal(prepared.totals.issued,40);assert.equal(prepared.totals.spent,10);assert.equal(prepared.totals.end,30);assert.equal(prepared.snapshot.ledger.movements.filter(row=>row.kind==='return').length,1);
 const metadata={id:'act',number:'Synthetic-1',postedAt:'2026-11-08T12:00:00.000Z',postedBy:{id:0,name:'Synthetic',role:'admin'},expectedFingerprint:prepared.sourceFingerprint},posted=writeoff.post(db,request,metadata);assert.equal(posted.calculationVersion,7);assert.equal(writeoff.validateWriteoffChanges(db,{...db,fuelWriteoffs:[posted]}),true);
 const old=database();old.fuelPurchases.pop();const v6=writeoff.forVersion(6),oldReview=v6.prepare(old,request),oldAct=v6.post(old,request,{...metadata,id:'old',expectedFingerprint:oldReview.sourceFingerprint}),oldStored={...old,fuelWriteoffs:[oldAct]};assert.equal(oldAct.calculationVersion,6);assert.equal(writeoff.validateWriteoffChanges(oldStored,clone(oldStored)),true);assert.equal(writeoff.forVersion(6).fingerprint(old,request),oldAct.sourceFingerprint);
});

test('v7 accepts signed monthly net control for a month containing only returns, with strict finite values',()=>{
 const db=database();db.vehicles[0].fuelBalance=50;db.records=[];db.fuelPurchases=[returnRow()];db.monthlyFuel=[{id:'net-control',vehicleId:0,month:'2026-09',liters:-10,sum:-700}];const ledger=fuel.buildLedger(db,period),prepared=writeoff.prepare(db,request);assert.deepEqual(ledger.errors,[]);assert.equal(prepared.canPost,true,JSON.stringify(prepared.issues));assert.equal(prepared.totals.start,50);assert.equal(prepared.totals.issued,-10);assert.equal(prepared.totals.spent,0);assert.equal(prepared.totals.end,40);assert.equal(prepared.snapshot.ledger.receipts[0].sum,-700);
 for(const change of [{liters:'not a number'},{sum:true}]){const bad=clone(db);Object.assign(bad.monthlyFuel[0],change);assert.ok(writeoff.prepare(bad,request).issues.some(row=>row.code==='invalid-number'&&row.field===Object.keys(change)[0]));}
 assert.ok(writeoff.forVersion(6).prepare(db,request).issues.some(row=>row.code==='invalid-number'&&row.field==='liters'));
});

test('all six reserved fuel and act readers match the pre-return literal golden results',()=>{
 const fixture=require('./fixtures/fuel-return-legacy-versions.json');for(const sample of fixture.samples)for(const expected of sample.versions){const reader=fuel.forVersion(expected.version),act=writeoff.forVersion(expected.version),result={ledger:reader.buildLedger(sample.database,period),balances:reader.recordBalances(sample.database,0),act:act.prepare(sample.database,request)},digest=crypto.createHash('sha256').update(JSON.stringify(result)).digest('hex');assert.equal(digest,expected.sha256,sample.label+' version '+expected.version);}
});
