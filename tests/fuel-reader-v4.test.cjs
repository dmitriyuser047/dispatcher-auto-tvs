'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const fuelRoot=require('../assets/core/fuel-engine'),fuel={...fuelRoot.forVersion(4),forVersion:fuelRoot.forVersion},writeoff=require('../assets/core/writeoff-engine').forVersion(4),audit=require('../assets/core/fuel-audit'),sources=require('../assets/core/financial-recognition');
const period={from:'2026-09-01',to:'2026-09-30'},request={month:'2026-09',date:'2026-09-30',org:'A',grade:'ДТ'},metadata={id:'v4-posted',number:'Synthetic',postedAt:'2026-10-22T12:00:00.000Z',postedBy:{id:'synthetic',name:'Synthetic'}};
function fixture(){return {vehicles:[{id:0,org:'A',fuel:'diesel',fuelGrade:'ДТ',fuelBalance:923.537,norm:0},{id:'0',org:'B',fuel:'diesel',fuelGrade:'ДТ',fuelBalance:0,norm:0}],records:[{id:0,vehicleId:0,date:'2026-09-10',km:0,fuelIssued:10,fuelActual:1}],fuelPurchases:[{id:0,vehicleId:0,recordId:0,date:'2026-09-10',qty:10,grade:'ДТ',sourceOrg:'A'}],fuelCards:[],monthlyFuel:[],fuelWriteoffs:[]};}

test('v4 preserves numeric zero purchase/record/card targets and separates string zero without editing any facts',()=>{
 const db=fixture(),before=JSON.stringify(db),value=fuel.buildLedger(db,period),receipt=value.receipts[0];assert.equal(fuel.calculationVersion,4);assert.equal(receipt.vehicleId,0);assert.equal(receipt.recordId,0);assert.equal(value.rows.find(row=>row.vehicleId===0).end,932.537);assert.equal(value.issues.some(issue=>issue.code==='vehicle'),false);
 assert.equal(fuel.forVersion(3).buildLedger(db,period).issues.some(issue=>issue.code==='vehicle'),true);
 const preview=writeoff.prepare(db,request);assert.equal(preview.canPost,true,JSON.stringify(preview.issues));assert.equal(preview.calculationVersion,4);assert.ok(preview.sourceRefs.some(ref=>ref.section==='records'&&ref.id===0));assert.ok(preview.sourceRefs.some(ref=>ref.section==='fuelPurchases'&&ref.id===0));const posted=writeoff.post(db,request,{...metadata,expectedFingerprint:preview.sourceFingerprint});assert.equal(writeoff.validateDocuments(db,{...db,fuelWriteoffs:[posted]}),true);
 assert.equal(fuel.gsmCardAt({...db,fuelCards:[{id:'card',number:'123',org:'A',assignments:[{vehicleId:0}]}]},'123','2026-09-10').vehicleId,0);assert.equal(JSON.stringify(db),before);
});

test('v4 live readers consistently exclude cancelled/deleted sources and retain all frozen readers',()=>{
 for(const marker of [{deleted:true},{cancelled:true},{status:'cancelled'}]){
  const db=fixture();db.records[0]={...db.records[0],...marker};db.fuelPurchases[0]={...db.fuelPurchases[0],...marker};db.monthlyFuel=[{vehicleId:0,month:'2026-09',liters:999,...marker}];const result=fuel.buildLedger(db,period);assert.equal(result.receipts.length,0);assert.equal(result.journal.length,0);assert.equal(result.rows.find(row=>row.vehicleId===0).end,923.537);assert.deepEqual(fuel.recordBalances(db,0),{});assert.equal(result.issues.some(issue=>issue.code==='monthly-difference'),false);
  assert.equal(audit.buildModel(db,period).items.some(item=>item.code==='monthly-difference'||item.code==='journal-difference'),false);
 }
});

test('v4 recognizes exact raw legacy quantities when statements and journal agree, including monthly reconciliation',()=>{
 const db=fixture();db.vehicles[0].fuelBalance=1;db.records[0].fuelIssued=.0004;db.records[0].fuelActual=0;db.fuelPurchases[0].qty=.0004;db.monthlyFuel=[{vehicleId:0,month:'2026-09',liters:.0004}];const result=fuel.buildLedger(db,period);assert.equal(result.journal[0].statement,.0004);assert.equal(result.issues.some(issue=>['journal-difference','monthly-difference'].includes(issue.code)),false);assert.equal(fuel.recordBalances(db,0)[0],1.0004);
 const wrong=structuredClone(db);wrong.monthlyFuel[0].liters=.0004000000001;assert.equal(fuel.buildLedger(wrong,period).issues.some(issue=>issue.code==='monthly-difference'),true);
});

test('v4 unknown source organization remains unknown even when recipient organization is known',()=>{
 const db=fixture();db.fuelPurchases=[];db.records[0].fuelOrg='';db.records[0].fuelActual=0;db.records[0].fuelSourceSnapshot={tankOrg:'',assetOrg:'A'};const before=JSON.stringify(db),result=fuel.buildLedger(db,period);assert.equal(result.receipts[0].org,fuel.constants.unknownOrg);assert.ok(result.errors.some(issue=>issue.code==='source-org'&&issue.recordId===0));assert.equal(result.issues.some(issue=>issue.code==='manual-source'),false);assert.equal(writeoff.prepare(db,request).canPost,false);assert.equal(fuel.forVersion(3).buildLedger(db,period).receipts[0].org,'A');assert.equal(JSON.stringify(db),before);
});

test('v4 retains a real sub-epsilon deficit in exact journal balances and blocks an act rather than hiding it',()=>{
 const db=fixture();db.fuelPurchases=[];db.vehicles[0].fuelBalance=.0009999999999;db.records=[{id:0,vehicleId:0,date:'2026-09-01',km:0,fuelActual:.001}];const result=fuel.buildLedger(db,period);assert.equal(fuel.recordBalances(db,0)[0],-1e-13);assert.ok(result.errors.some(issue=>issue.code==='shortage'&&issue.qty===1e-13));assert.equal(writeoff.prepare(db,request).canPost,false);assert.equal(fuel.forVersion(3).recordBalances(db,0)[0],0);
});

test('accounting TankFlows reuses stock projection, cancels internal legs exactly and rejects unknown partial sources',()=>{
 const db={tanks:[{id:0,balanceInit:1},{id:'0',balanceInit:0}],tankIncomes:[{id:'receipt',tankId:0,date:'2026-09-01',amount:.3}],generators:[],genRecords:[],fuelMovements:[{id:'transfer',kind:'transfer',fromTankId:0,toTankId:'0',date:'2026-09-02',qty:.1}]};
 const both=sources.projectTankFlows(db,[0,'0'],{accounting:true,...period});assert.equal(both.length,1);assert.equal(both[0].amount,.3);const one=sources.projectTankFlows(db,[0],{accounting:true,...period});assert.equal(one.find(row=>row.sourceId==='transfer').amount,-.1);assert.throws(()=>sources.projectTankFlows({...db,tankIncomes:[{...db.tankIncomes[0],liters:.4}]},[0],{accounting:true,...period}),{code:'FUEL_STOCK_UNKNOWN'});
});

test('v4 browser UMD ledger, diagnostics and act output match CommonJS',()=>{
 const context=vm.createContext({});for(const file of ['decimal-core.js','accounting-boundary.js','effective-periods.js','fuel-engine.js','writeoff-engine.js','fuel-audit.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/core',file),'utf8'),context,{filename:file});const db=fixture();assert.equal(JSON.stringify(context.TvsFuelEngine.forVersion(4).buildLedger(db,period)),JSON.stringify(fuel.buildLedger(db,period)));assert.equal(JSON.stringify(context.TvsWriteoffEngine.forVersion(4).prepare(db,request)),JSON.stringify(writeoff.prepare(db,request)));
});
