'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const fuel=require('../assets/core/fuel-engine.js'),writeoff=require('../assets/core/writeoff-engine.js');
const range={from:'2026-09-01',to:'2026-09-30'},request={month:'2026-09',date:'2026-09-30'};
const metadata={id:'release-golden',number:'SYNTHETIC-1',postedAt:'2026-10-24T00:00:00Z',postedBy:{id:'release-synthetic',name:'Synthetic calculation audit'}};
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fixtures(){
  const base=()=>({vehicles:[{id:'v',plate:'SYNTHETIC GOLDEN',org:'A',fuel:'diesel',fuelGrade:'ДТ',norm:10}],records:[],fuelPurchases:[],fuelCards:[],monthlyFuel:[],fuelWriteoffs:[]});
  const normal=base();Object.assign(normal.vehicles[0],{fuelBalance:3,fuelBalanceSources:[{org:'A',grade:'ДТ',qty:1},{org:'B',grade:'ДТ',qty:2}]});
  normal.records=[{id:'a',vehicleId:'v',date:'2026-09-01',km:1,fuelActual:3},{id:'b',vehicleId:'v',date:'2026-09-02',km:100,fuelIssued:20,fuelOrg:'A',fuelActual:20}];
  const missing=base();missing.records=[{id:'r',vehicleId:'v',date:'2026-09-01',km:100,fuelIssued:20,fuelOrg:'A',fuelActual:10}];
  const conflict=base();conflict.vehicles[0].fuelBalance=10;conflict.records=[{id:'r',vehicleId:'v',date:'2026-09-01',km:10,fuelActual:0,fuelIdle:2,tankMeasured:9}];
  return {normal,missing,conflict};
}
// Captured BEFORE any v6 production edits. Each digest covers the complete
// ordered [ledger, preview, posted act, historical recordBalances] JSON bytes.
// Baseline fuel sha256:4966f7b7ad7b5a1559c1a086a9e26fbb1001031645cb8172969610ece8600e2a
// Baseline writeoff sha256:cca3d3f1e551fae7948be28d7458a887c4a011cf784380bbf0e3689e3c7c20ad
const golden={
  normal:{1:'a10c75d5678c2ab693ff151d34dac0703e04658794cae22eb2313aacb003cfe7',2:'d4a580ef1f31237b4c291f0cd1011e948996d8c2b0323373e81c3a64d82ec726',3:'fdaa23be353529f7bdfbbdfa3b0cfb5e2d3ac5214ba676801c40aa2a4b5ee817',4:'7eb28d4f6aa3397a699298ffb5bcb5f9afb4c8af6a92414ab590b36fe0eaa5dc',5:'34500c23e3532dfa726b829caea1b09a87626687733058440da38527f468fa9f'},
  missing:{1:'543b5d02aee60bf414788daccd3df70552a3e76ec980dca8f70e020d231218b8',2:'40bafc91d976a0a98b6a354227d0fff6f5befe063f21268d040a03e5ec8e6aa9',3:'0871ed6c62c12bf0f0f6c9204da6f77fdbc339a4f0f08b1ab3ff9e27b7f78ca2',4:'e488c9edd8966915be9bb9447521310113cae6c040a66173112e22e16da83a16',5:'9c3c541ebfac0f799256f3410eea53fa28918785d1631798c959df2975d01a8a'},
  conflict:{1:'80e8c6582940c705bf9340b9b4c2a4343f568f9ea8482610ab53e3aff44ed74c',2:'b8c31864ddf75c3c31bd3c460cfd7651ccc1c1aacca823b212bfc12b7c5f3c57',3:'9b81e2a0266185dad9d68badfbf2e7d4045b6cdb5b332376745bcb69bc43f0a3',4:'e286120ebde1d5f224403d453c3c253bdd1e7a85d63116576414a2aada726d6d',5:'47f8afee5dcd5fd9a4f8350ce937c77c01cb9acfda6387a3839adcdd9ea721a2'}
};
test('all v1-v5 ledger, preview, posted act and journal bytes remain frozen across the v6 release',()=>{
  for(const [name,db]of Object.entries(fixtures()))for(const version of [1,2,3,4,5]){
    const f=fuel.forVersion(version),w=writeoff.forVersion(version),preview=w.prepare(db,request),document=w.post(db,request,{...metadata,expectedFingerprint:preview.sourceFingerprint});
    assert.equal(hash([f.buildLedger(db,range),preview,document,f.recordBalances(db,'v',{to:range.to})]),golden[name][version],name+' v'+version);
  }
});

test('v6 rejects an unconfirmed opening even when the assumed zero gives a positive closing',()=>{
  for(const value of [undefined,null,'', ' ',false]){
    const db=fixtures().missing;if(value!==undefined)db.vehicles[0].fuelBalance=value;
    const before=JSON.stringify(db),preview=writeoff.prepare(db,request),ledger=fuel.buildLedger(db,range);
    assert.equal(fuel.calculationVersion,6);assert.equal(preview.calculationVersion,6);assert.equal(preview.canPost,false);
    assert.ok(preview.issues.some(issue=>issue.code==='opening-missing'&&issue.severity==='error'&&issue.vehicleId==='v'&&issue.section==='vehicles'));
    assert.ok(ledger.issues.some(issue=>issue.code==='opening-missing'));
    assert.equal(fuel.recordBalanceAt(fuel.recordBalances(db,'v',{to:range.to}),'r'),null);
    assert.throws(()=>writeoff.post(db,request,{...metadata,expectedFingerprint:preview.sourceFingerprint}),{code:'WRITE_OFF_BLOCKED'});
    assert.equal(JSON.stringify(db),before);
  }
});

test('v6 treats an explicitly confirmed zero and a dated zero boundary as known facts',()=>{
  for(const mode of ['number','string','boundary']){
    const db=fixtures().missing;
    if(mode==='boundary')db.vehicles[0].fuelAccounting={version:1,from:'2026-09-01',opening:0,basis:'Synthetic confirmed zero observation'};
    else db.vehicles[0].fuelBalance=mode==='number'?0:'0';
    const preview=writeoff.prepare(db,request);assert.equal(preview.canPost,true,JSON.stringify(preview.issues));assert.equal(preview.totals.start,0);assert.equal(preview.totals.end,10);
    assert.equal(fuel.openingEvidence(db,'v',{before:range.from,family:'diesel'}).status,'known');
    assert.equal(fuel.recordBalanceAt(fuel.forVersion(6).recordBalances(db,'v',{to:range.to}),'r'),10);
  }
});

test('only a valid live prior same-family observation can confirm the missing monthly opening',()=>{
  const valid={id:0,vehicleId:'v',date:'2026-08-31',fuelGrade:'ДТ',km:0,tankMeasured:10};
  for(const change of [{date:'2026-09-01'},{date:'2026-10-01'},{date:'2026-08-32'},{fuelGrade:'Газ'},{tankMeasured:-1},{tankMeasured:true},{tankMeasured:[]},{tankMeasured:'bad'},{tankMeasured:'0x10'},{tankMeasured:'1.234567890123456789'},{deleted:true},{cancelled:true},{status:'cancelled'}]){
    const db=fixtures().missing;db.records.unshift({...valid,...change});
    assert.ok(writeoff.prepare(db,request).issues.some(issue=>issue.code==='opening-missing'),JSON.stringify(change));
  }
  const db=fixtures().missing;db.records.unshift(valid);const before=JSON.stringify(db),preview=writeoff.prepare(db,request);
  assert.equal(preview.canPost,true,JSON.stringify(preview.issues));assert.equal(preview.totals.start,10);assert.equal(preview.totals.end,20);
  assert.equal(fuel.openingEvidence(db,'v',{before:range.from,family:'diesel'}).recordId,0);
  const balances=fuel.recordBalances(db,'v',{to:range.to});assert.equal(fuel.recordBalanceAt(balances,0),10);assert.equal(fuel.recordBalanceAt(balances,'r'),20);
  assert.equal(JSON.stringify(db),before);
});

test('v6 blocks a measured total below entered idle without clipping either entered fact',()=>{
  const db=fixtures().conflict,before=JSON.stringify(db),preview=writeoff.prepare(db,request),issue=preview.issues.find(row=>row.code==='measurement-idle-conflict');
  assert.equal(preview.canPost,false);assert.equal(issue.severity,'error');assert.equal(issue.recordId,'r');assert.equal(issue.measurementRecordId,'r');
  assert.equal(preview.totals.spent,1);assert.equal(preview.totals.idle,2);assert.equal(preview.consumption[0].idle,2);assert.equal(preview.consumption[0].enteredIdle,2);
  assert.equal(preview.snapshot.records[0].tankMeasured,9);assert.equal(preview.snapshot.records[0].fuelIdle,2);
  assert.throws(()=>writeoff.post(db,request,{...metadata,expectedFingerprint:preview.sourceFingerprint}),{code:'WRITE_OFF_BLOCKED'});
  assert.equal(JSON.stringify(db),before);
});

test('idle contradiction diagnostics retain both the final journal row and a distinct numeric-zero measurement source',()=>{
  const audit=require('../assets/core/fuel-audit.js'),db=fixtures().conflict;
  db.records=[{id:0,vehicleId:'v',date:'2026-09-01',fuelGrade:'ДТ',km:0,fuelActual:0,tankMeasured:9},{id:'last',vehicleId:'v',date:'2026-09-01',fuelGrade:'ДТ',km:10,fuelActual:0,fuelIdle:2}];
  const before=JSON.stringify(db),item=audit.buildModel(db,range).items.find(row=>row.code==='measurement-idle-conflict');
  assert.equal(item.category,'error');assert.ok(item.sourceRefs.some(ref=>ref.type==='record'&&ref.id===0));assert.ok(item.sourceRefs.some(ref=>ref.type==='record'&&ref.id==='last'));
  const missing=audit.buildModel(fixtures().missing,range).items.find(row=>row.code==='opening-missing');assert.equal(missing.category,'error');assert.ok(missing.repairRefs.some(ref=>ref.type==='opening'&&ref.id==='v'));
  assert.equal(JSON.stringify(db),before);
});

test('v6 canonical validation preserves existing v5 snapshots but new legacy acts cannot bypass current source checks',()=>{
  for(const db of Object.values(fixtures())){
    const old=writeoff.forVersion(5),preview=old.prepare(db,request),document=old.post(db,request,{...metadata,expectedFingerprint:preview.sourceFingerprint});
    assert.throws(()=>writeoff.validateDocuments(db,{...db,fuelWriteoffs:[document]}),{code:'STALE_SOURCES'});
    assert.equal(writeoff.validateDocuments({...db,fuelWriteoffs:[document]},{...db,fuelWriteoffs:[structuredClone(document)]}),true);
    const voided=writeoff.voidDocument(document,{voidedAt:'2026-10-25T00:00:00Z',voidedBy:metadata.postedBy,reason:'Synthetic reviewed correction'});
    assert.equal(writeoff.validateDocuments({...db,fuelWriteoffs:[document]},{...db,fuelWriteoffs:[voided]}),true);
    assert.equal(voided.sourceFingerprint,document.sourceFingerprint);
  }
  const db=fixtures().normal,preview=writeoff.prepare(db,request),document=writeoff.post(db,request,{...metadata,expectedFingerprint:preview.sourceFingerprint});
  assert.equal(writeoff.validateDocuments(db,{...db,fuelWriteoffs:[document]}),true);
  assert.throws(()=>writeoff.forVersion(5).validateDocuments({...db,fuelWriteoffs:[document]},{...db,fuelWriteoffs:[document]}),{code:'CALCULATION_VERSION'});
  for(const api of [fuel,writeoff])assert.throws(()=>api.forVersion(7),{code:'CALCULATION_VERSION'});
  assert.throws(()=>writeoff.validateDocuments(db,{...db,fuelWriteoffs:[{...document,calculationVersion:7}]}),{code:'CALCULATION_VERSION'});
});

test('v6 rejects JavaScript numeric coercions in actuals, mileage, norms, purchase quantities and prices with source references',()=>{
  for(const [section,field]of [['records','fuelActual'],['records','km'],['records','fuelIdle'],['vehicles','norm'],['fuelPurchases','qty'],['fuelPurchases','price'],['fuelPurchases','sum']])for(const invalid of ['0x10','0b10',true,[],{}]){
    const db=fixtures().normal;db.vehicles[0].fuelBalance=100;delete db.vehicles[0].fuelBalanceSources;
    db.records=[{id:0,vehicleId:'v',date:'2026-09-01',km:10,fuelActual:0,fuelIssued:20,fuelOrg:'A'}];
    db.fuelPurchases=[{id:0,vehicleId:'v',recordId:0,date:'2026-09-01',qty:20,grade:'ДТ',sourceOrg:'A',manual:true,price:10,sum:200}];
    db[section][0][field]=invalid;const before=JSON.stringify(db),preview=writeoff.prepare(db,request),ledger=fuel.buildLedger(db,range);
    assert.equal(preview.canPost,false,section+'.'+field+'='+JSON.stringify(invalid));
    assert.ok(preview.issues.some(issue=>issue.code==='invalid-number'&&issue.section===section&&issue.field===field),section+'.'+field+'='+JSON.stringify(invalid));
    const diagnostic=ledger.issues.find(issue=>issue.code==='source-number'&&issue.section===section&&issue.field===field);assert.ok(diagnostic,section+'.'+field);
    if(section==='records')assert.equal(diagnostic.recordId,0);if(section==='fuelPurchases')assert.equal(diagnostic.purchaseId,0);
    assert.equal(JSON.stringify(db),before);
  }
  assert.equal(fuel.fqValue('0x10'),null);assert.equal(fuel.forVersion(5).fqValue('0x10'),16);
  assert.equal(fuel.fqValue(-.0001),-.0001);assert.equal(fuel.fqValue('-0.0001'),-.0001);
});

test('valid decimal legacy precision stays exact and explicit while invalid actual cannot silently become a known norm balance',()=>{
  const db=fixtures().normal;db.vehicles[0].fuelBalance=100;delete db.vehicles[0].fuelBalanceSources;
  db.records=[{id:0,vehicleId:'v',date:'2026-09-01',km:100,fuelActual:'0.0001'}];const before=JSON.stringify(db),ledger=fuel.buildLedger(db,range);
  assert.equal(fuel.fqRecord(db.records[0],db.vehicles[0]).total,.0001);assert.equal(ledger.movements.find(row=>row.kind==='consumption').qty,.0001);
  assert.ok(ledger.issues.some(issue=>issue.code==='source-precision'));assert.ok(!ledger.issues.some(issue=>issue.code==='source-number'));
  assert.equal(JSON.stringify(db),before);db.records[0].fuelActual='0x10';
  assert.equal(fuel.recordBalanceAt(fuel.recordBalances(db,'v'),0),null);
  assert.ok(writeoff.prepare(db,request).issues.some(issue=>issue.code==='invalid-number'&&issue.field==='fuelActual'));
});

test('diagnostics merge only the same numeric source field and retain separate fields and orphan causes',()=>{
  const audit=require('../assets/core/fuel-audit.js'),db=fixtures().normal;
  db.records=[{id:'orphan',vehicleId:'missing',date:'2026-09-01',km:1,fuelGrade:'ДТ',fuelOrg:'A'}];
  db.fuelPurchases=[{id:0,vehicleId:'v',date:'2026-09-01',qty:'bad',sum:-1,price:'0x10',grade:'ДТ',sourceOrg:'A'}];
  const before=JSON.stringify(db),model=audit.buildModel(db,{...range,coverage:false});
  const numeric=model.items.filter(issue=>['source-number','invalid-value'].includes(issue.code));
  assert.equal(numeric.length,3);assert.deepEqual(new Set(numeric.map(issue=>issue.impact.field)),new Set(['qty','sum','price']));
  for(const issue of numeric){assert.equal(issue.category,'error');assert.ok(issue.sourceRefs.some(ref=>ref.type==='purchase'&&ref.id===0));}
  assert.ok(model.items.some(issue=>issue.code==='record-vehicle-missing'&&issue.recordId==='orphan'));
  assert.equal(model.summary.error,4);assert.equal(JSON.stringify(db),before);
});
