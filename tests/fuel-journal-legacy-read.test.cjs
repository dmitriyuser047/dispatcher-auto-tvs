'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const fuel=require('../assets/core/fuel-engine.js');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fixture=()=>({vehicles:[{id:'v',plate:'SYNTHETIC-559',fuelGrade:'ДТ',norm:13.59,fuelBalance:100}],records:[
 {id:0,vehicleId:'v',date:'2026-10-01',km:100,fuelIssued:100.28999999999999,fuelActual:13.59},
 {id:'0',vehicleId:'v',date:'2026-10-02',km:0,fuelActual:.0004}
]});
test('current legacy journal reads numeric arithmetic tails without changing facts, typed IDs or sub-millilitre accumulation',()=>{
 const db=fixture(),before=JSON.stringify(db),balances=fuel.recordBalances(db,'v');
 assert.equal(fuel.recordBalanceAt(balances,0),186.7);assert.equal(fuel.recordBalanceAt(balances,'0'),186.6996);assert.equal(Object.hasOwn(balances,'0'),false);
 assert.equal(JSON.stringify(db),before);assert.throws(()=>fuel.forVersion(6).recordBalances(db,'v'),{code:'RANGE'});
});
test('legacy read projection also retains exact internal actual-plus-idle arithmetic and measurement resets',()=>{
 const db=fixture();db.vehicles[0].fuelBalance=0;db.records=[
  {id:'source',vehicleId:'v',date:'2026-10-01',km:100,fuelIssued:100,fuelActual:13.590000000000002,fuelIdle:20},
  {id:'measurement',vehicleId:'v',date:'2026-10-02',km:0,fuelActual:0,tankMeasured:10.2345},
  {id:'bad',vehicleId:'v',date:'2026-10-03',km:1,fuelActual:'not a quantity'},
  {id:'zero',vehicleId:'v',date:'2026-10-04',km:0,fuelActual:0,tankMeasured:0}
 ];const before=JSON.stringify(db),balances=fuel.recordBalances(db,'v');
 assert.equal(fuel.recordBalanceAt(balances,'source'),66.41);assert.equal(fuel.recordBalanceAt(balances,'measurement'),10.2345);assert.equal(fuel.recordBalanceAt(balances,'bad'),null);assert.equal(fuel.recordBalanceAt(balances,'zero'),0);assert.equal(JSON.stringify(db),before);
 assert.throws(()=>fuel.fqRecord(db.records[0],db.vehicles[0]),{code:'RANGE'});
});
test('explicit accounting, string precision, overflowing quantities and ledger calculations retain their strict behavior',()=>{
 const db=fixture(),explicit=structuredClone(db),strings=structuredClone(db);explicit.vehicles[0].fuelAccounting={version:1,from:'2026-10-01',opening:100,basis:'Synthetic opening'};strings.records[0].fuelIssued=String(strings.records[0].fuelIssued);
 assert.throws(()=>fuel.recordBalances(explicit,'v'),{code:'RANGE'});assert.throws(()=>fuel.recordBalances(strings,'v'),{code:'RANGE'});
 assert.throws(()=>fuel.recordBalances({vehicles:[{id:'v',fuelBalance:1e308}],records:[{id:'r',vehicleId:'v',date:'2026-10-01',fuelIssued:1e308}]},'v'),{code:'RANGE'});
 assert.throws(()=>fuel.buildLedger(db,{from:'2026-10-01',to:'2026-10-31'}),{code:'RANGE'});
});
test('all six published ledger and journal algorithms retain their golden outputs',()=>{
 const db={vehicles:[{id:'v',org:'A',fuel:'gasoline',fuelGrade:'АИ-95',fuelBalance:923.537}],records:[{id:'r',vehicleId:'v',date:'2026-09-05',fuelGrade:'АИ-95',fuelIssued:40.001,fuelActual:20.0055,fuelIdle:2.0005,km:100.123}],fuelPurchases:[{id:'p',vehicleId:'v',recordId:'r',date:'2026-09-05',grade:'АИ-95',qty:40.001,manual:true,sourceOrg:'A'}],fuelCards:[],monthlyFuel:[],fuelWriteoffs:[]};
 const ledgers=['960726b3324481bd5fa81e0aa8bc6cdf3a00a803f5e20ba697738e75eff7a284',...Array(5).fill('c0c2c1926d2c044c763f444615851b715988656fb945f193b7ede912bd037374')],journals=['19589d16355aa7bde829ccd8c5db33280ffdb2dce0fa0ea7a4801ea17717d873',...Array(4).fill('17aae3437ec6fe0216b24e36eadeca245944fcd3ccf36350fb202e1510b367e9'),'b886cfab3b46a14014cf42704fd1864f9f267bf10b7ffe2de46a71fba40b55cb'];
 for(let version=1;version<=6;version++){const api=fuel.forVersion(version);assert.equal(hash(api.buildLedger(db,{from:'2026-09-01',to:'2026-09-30'})),ledgers[version-1],version+' ledger');assert.equal(hash(api.recordBalances(db,'v')),journals[version-1],version+' journal');}
});
