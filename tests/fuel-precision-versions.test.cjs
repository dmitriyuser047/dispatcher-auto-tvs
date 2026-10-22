'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const fuel=require('../assets/core/fuel-engine.js'),writeoff=require('../assets/core/writeoff-engine.js'),policy=require('../assets/core/fuel-movement-policy.js');
// Pure buildLedger microbenchmark, not full runtime/IPC/rendering: fixture(10000)
// from scripts/benchmark-platform.cjs, JSON SHA256
// f6e4a57065d67becd6d1bad7ee69a105c6cf7cd6ac73a2b4843d1e1ecd143763.
// 2026-10-22 local Node24: v1 698ms / v2 882ms (1000 asset rows).
// Deliberately no timing assertion: this documents scope, not a machine SLA.
const period={from:'2026-09-01',to:'2026-09-30'},request={month:'2026-09',org:'A',grade:'АИ-95',date:'2026-09-30'};
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'),copy=value=>JSON.parse(JSON.stringify(value));
function fixture(){return {vehicles:[{id:'v',org:'A',fuel:'gasoline',fuelGrade:'АИ-95',fuelBalance:923.537}],records:[{id:'r',vehicleId:'v',date:'2026-09-05',fuelGrade:'АИ-95',fuelIssued:40.001,fuelActual:20.0055,fuelIdle:2.0005,km:100.123}],fuelPurchases:[{id:'p',vehicleId:'v',recordId:'r',date:'2026-09-05',grade:'АИ-95',qty:40.001,manual:true,sourceOrg:'A'}],fuelCards:[],monthlyFuel:[],fuelWriteoffs:[]};}
function posted(api,db){const preview=api.prepare(db,request);return api.post(db,request,{id:'legacy',number:'Synthetic',postedAt:'2026-10-21T10:00:00Z',postedBy:{id:0,name:'Synthetic'},expectedFingerprint:preview.sourceFingerprint});}

test('v1 reproduces the pre-step-8 ledger, journal, preview, fingerprint and entire posted snapshot byte for byte',()=>{
  const db=fixture(),v1=fuel.forVersion(1),acts=writeoff.forVersion(1),preview=acts.prepare(db,request);
  assert.equal(hash(v1.buildLedger(db,period)),'960726b3324481bd5fa81e0aa8bc6cdf3a00a803f5e20ba697738e75eff7a284');
  assert.equal(hash(v1.recordBalances(db,'v')),'19589d16355aa7bde829ccd8c5db33280ffdb2dce0fa0ea7a4801ea17717d873');
  assert.equal(hash(preview),'aedee4e955393143d2e75a4e4f43c19eafa1ec9d6d440ed1517cdd561e7e5780');
  assert.equal(hash(posted(acts,db)),'e38cb747438ee799ceeaac02f83476935cacf13c7c9f83f977165445dcb08c93');
  assert.equal(preview.sourceFingerprint,'sha256:ffe2ee6f26fcafdfe21dd8e7e231c8aa31705b4e513abcf6bcbfa1b6cb8b4a8c');
});

test('immutable versions remain independent across interleaved calculations and v2 signed corrections conserve litres',()=>{
  assert.ok(Object.isFrozen(fuel.forVersion(1)));assert.ok(Object.isFrozen(fuel.forVersion(2)));assert.equal(fuel.forVersion(1),fuel.forVersion(1));
  for(const version of [undefined,0,5,'1',null])assert.throws(()=>fuel.forVersion(version),{code:'CALCULATION_VERSION'});
  const db=fixture();db.vehicles[0].fuelGrade='АИ-92';db.vehicles[0].fuelBalance=0;db.fuelPurchases=[];db.records=[{id:'a',vehicleId:'v',date:'2026-09-01',km:1,fuelActual:1.2345,fuelGrade:'АИ-92'},{id:'b',vehicleId:'v',date:'2026-09-02',fuelIssued:1.2345,fuelActual:0,fuelGrade:'АИ-95'}];
  const before=JSON.stringify(db),old=fuel.forVersion(1).buildLedger(db,period),modern=fuel.buildLedger(db,period);
  assert.ok(Math.abs(old.rows.reduce((sum,row)=>sum+row.correction,0)-.001)<1e-12);
  assert.equal(modern.rows.reduce((sum,row)=>sum+row.correction,0),0);assert.equal(fuel.forVersion(1).gsmRound(-1.2345),-1.234);assert.equal(fuel.gsmRound(-1.2345),-1.235);
  assert.equal(hash(fuel.forVersion(1).buildLedger(db,period)),hash(old));assert.equal(JSON.stringify(db),before);
});

test('new acts carry the current v4, old missing-version acts retain their source locks, and a client cannot insert a new v1 act',()=>{
  const db=fixture(),legacy=posted(writeoff.forVersion(1),db),saved={...db,fuelWriteoffs:[legacy]},before=JSON.stringify(saved);
  assert.equal(legacy.calculationVersion,undefined);assert.equal(writeoff.validateDocuments(saved,copy(saved)),true);
  const future=copy(saved);future.records.push({...future.records[0],id:'future',date:'2026-10-01'});assert.equal(writeoff.validateDocuments(saved,future),true);
  const edited=copy(saved);edited.records[0].fuelActual+=.001;assert.throws(()=>writeoff.validateDocuments(saved,edited),{code:'POSTED_SOURCE_LOCKED'});
  assert.equal(JSON.stringify(saved),before);const modern=posted(writeoff,db);assert.equal(modern.calculationVersion,4);assert.notEqual(modern.sourceFingerprint,legacy.sourceFingerprint);
  assert.equal(writeoff.validateDocuments(db,{...db,fuelWriteoffs:[modern]}),true);assert.throws(()=>writeoff.validateDocuments(db,saved),{code:'STALE_SOURCES'});
  const forged=copy(saved);forged.fuelWriteoffs[0].calculationVersion=99;assert.throws(()=>writeoff.validateDocuments(forged,copy(forged)),{code:'CALCULATION_VERSION'});
});

test('v2 journal quantities and balances preserve millilitres and exact decimal accumulation',()=>{
  const db=fixture();db.vehicles[0].fuelBalance=923.537;db.fuelPurchases=[];db.records=Array.from({length:1000},(_,id)=>({id,vehicleId:'v',date:'2026-09-01',fuelIssued:.001,fuelActual:0}));
  const before=JSON.stringify(db),balances=fuel.recordBalances(db,'v');assert.equal(balances[999],924.537);assert.equal(fuel.buildLedger(db,period).rows[0].issued,1);assert.equal(JSON.stringify(db),before);
  assert.throws(()=>fuel.recordBalances({vehicles:[{id:'v',fuelBalance:1e308}],records:[{id:'r',vehicleId:'v',date:'2026-09-01',fuelIssued:1e308}]},'v'),{code:'RANGE'});
});

test('generator fact and norm share decimal interpolation, preserve manual facts and distinguish absent load',()=>{
  const g={power:100,norm100:2.675,norm50:1.335,normIdle:.145,norm:3.123};
  assert.equal(policy.generatorSpent(g,{hours:1,load:100}),2.675);assert.equal(policy.generatorNormSpent(g,{hours:1,load:100}),2.675);
  assert.equal(policy.generatorSpent(g,{hours:1,load:50}),1.335);assert.equal(policy.generatorSpent(g,{hours:1,load:0}),.145);
  assert.equal(policy.generatorSpent(g,{hours:1,load:100,fuelActual:0,fuelUsed:10}),0);assert.equal(policy.generatorNormSpent(g,{hours:1,load:100,fuelActual:99,fuelUsed:1.001}),1.001);
  assert.equal(policy.generatorNormSpent(g,{hours:2,fuelActual:99}),6.246);assert.equal(policy.generatorSpent(g,{hours:2}),0);
});

test('v2 document details and basis conserve displayed millilitres while legacy sub-millilitre facts remain explicit',()=>{
  const db=fixture();db.vehicles[0].fuelBalance=1;db.fuelPurchases=[];db.records=[0,1,2].map(id=>({id,vehicleId:'v',date:'2026-09-01',fuelActual:.0004}));
  const before=JSON.stringify(db),preview=writeoff.prepare(db,{month:'2026-09',date:'2026-09-30'});
  assert.equal(preview.rows[0].spent,.001);assert.equal(preview.totals.spent,.001);assert.equal(preview.totals.basis.actual,.001);
  assert.equal(preview.consumption.reduce((sum,row)=>sum+row.qty,0),.001);assert.equal(preview.consumption.filter(row=>row.roundingAdjustment?.qty===.001).length,1);
  assert.ok(preview.issues.some(row=>row.code==='source-precision'));assert.ok(preview.issues.some(row=>row.code==='rounding-allocation'));
  assert.deepEqual(preview.consumption.map(row=>row.enteredActual),[.0004,.0004,.0004]);assert.equal(JSON.stringify(db),before);
  assert.equal(writeoff.forVersion(1).prepare(db,{month:'2026-09',date:'2026-09-30'}).totals.basis.actual,0);
});

test('a stationary millilitre stock stays visible and v2 source checks no longer hide a millilitre discrepancy',()=>{
  const db=fixture();db.vehicles[0].fuelBalance=.001;db.fuelPurchases=[];db.records=[];
  assert.equal(fuel.buildLedger(db,period).rows[0].end,.001);assert.equal(fuel.forVersion(1).buildLedger(db,period).rows.length,0);
  db.records=[{id:'r',vehicleId:'v',date:'2026-09-05',fuelGrade:'АИ-95',fuelIssued:1,fuelActual:0}];db.fuelPurchases=[{id:'p',recordId:'r',vehicleId:'v',date:'2026-09-05',grade:'АИ-95',qty:1.001,manual:true,sourceOrg:'A'}];
  assert.ok(fuel.buildLedger(db,period).issues.some(row=>row.code==='journal-difference'));assert.equal(fuel.forVersion(1).buildLedger(db,period).issues.some(row=>row.code==='journal-difference'),false);
  db.vehicles[0].fuelBalanceSources=[{org:'A',grade:'АИ-95',qty:.002}];assert.ok(fuel.buildLedger(db,period).issues.some(row=>row.code==='opening-difference'));
});

test('browser calculation versions match CommonJS using the actual UMD dependency order',()=>{
  const context=vm.createContext({});for(const file of ['decimal-core.js','accounting-boundary.js','fuel-engine.js','writeoff-engine.js','fuel-movement-policy.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/core',file),'utf8'),context,{filename:file});
  for(const version of [1,2]){
    assert.equal(hash(context.TvsFuelEngine.forVersion(version).buildLedger(fixture(),period)),hash(fuel.forVersion(version).buildLedger(fixture(),period)));
    assert.equal(hash(context.TvsWriteoffEngine.forVersion(version).prepare(fixture(),request)),hash(writeoff.forVersion(version).prepare(fixture(),request)));
  }
  assert.equal(context.FuelMovementPolicy.generatorSpent({power:100,norm100:2.675},{hours:1,load:100}),2.675);
});
