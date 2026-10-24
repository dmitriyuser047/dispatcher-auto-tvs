'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fuel=require('../assets/core/fuel-engine.js'),application=require('../assets/core/application-engine.js'),worker=require('../assets/core/engine-worker.js');
const get=fuel.recordBalanceAt;
const opening={version:1,from:'2026-09-01',opening:100,basis:'Synthetic confirmed opening'};
const fixture=records=>({vehicles:[{id:'v',org:'A',fuelGrade:'ДТ',fuelBalance:500,fuelAccounting:{...opening}}],records,
 fuelPurchases:[],fuelCards:[],monthlyFuel:[],fuelWriteoffs:[]});
const record=(id,date,fields={})=>({id,vehicleId:'v',date,km:0,...fields});

test('live journal typed IDs survive runtime cache, JSON, snapshot and structured-clone transport without unsafe aliases',()=>{
 const ids=[0,'0',7,'7','__proto__','constructor','prototype','$fuelRecordBalances','["number",7]','ordinary'];
 const db=fixture(ids.map((id,index)=>record(id,'2026-09-'+String(index+1).padStart(2,'0'),{fuelActual:1}))),before=JSON.stringify(db),engine=application.create();
 const context={identity:'synthetic-journal',readable:['vehicles','records']},query={vehicleId:'v'};
 const first=engine.query('fuelRecords',db,query,context),snapshot=engine.capture(db,context);
 const copies=[first,engine.query('fuelRecords',db,query,context),engine.querySnapshot('fuelRecords',snapshot,query),structuredClone(first),JSON.parse(JSON.stringify(first))];
 for(const result of copies){ids.forEach((id,index)=>assert.equal(get(result,id),99-index));assert.equal(get(result,'missing'),undefined);assert.equal(Object.hasOwn(result,'__proto__'),false);assert.equal(Object.hasOwn(result,'constructor'),false);assert.equal(Object.hasOwn(result,'7'),false);assert.equal(result.ordinary,90);assert.equal(Object.getPrototypeOf(result),Object.prototype);}
 assert.equal(JSON.stringify(db),before);assert.equal(engine.stats().hits,2);
 // A caller cannot mutate a future cached answer through either representation.
 first.$fuelRecordBalances.values['["number",7]']=12345;first.ordinary=12345;
 assert.equal(get(engine.query('fuelRecords',db,query,context),7),97);assert.equal(engine.query('fuelRecords',db,query,context).ordinary,90);
 const numericOnly=fuel.recordBalanceMap([[7,1]]);assert.equal(get(numericOnly,'7'),undefined);assert.equal(numericOnly[7],1);
 assert.equal(get({},'constructor'),undefined);assert.equal(get({legacy:null},'legacy'),null);assert.deepEqual(fuel.recordBalanceMap([]),{});
});

test('analysis worker returns independent typed balances after an actual load/query protocol round trip',()=>{
 const jobs=[],replies=[],endpoint=worker.createHandler({schedule:job=>jobs.push(job),postMessage:reply=>replies.push(structuredClone(reply))});
 const db=fixture([record(7,'2026-09-01',{fuelActual:10}),record('7','2026-09-02',{fuelActual:20})]);
 endpoint.handle({protocolVersion:1,type:'load',requestId:'load',generation:1,database:db,context:{identity:'synthetic-worker'}});
 const source=replies.at(-1);assert.equal(source.ok,true);
 endpoint.handle({protocolVersion:1,type:'query',requestId:'query',generation:1,identity:source.identity,sourceFingerprint:source.sourceFingerprint,name:'fuelRecords',options:{vehicleId:'v'}});
 jobs.shift()();const result=replies.at(-1);assert.equal(result.ok,true);assert.equal(get(result.value,7),90);assert.equal(get(result.value,'7'),70);endpoint.close();
});

for(const explicit of [false,true])test('missing scalar consumption remains unknown through later known facts until its family is measured; explicit='+explicit,()=>{
 const db=fixture([record('missing','2026-09-01',{km:100,fuelIdle:1}),record('known','2026-09-02',{km:10,fuelActual:2}),record('measured','2026-09-03',{tankMeasured:25}),record('after','2026-09-04',{fuelActual:2})]);
 if(!explicit){delete db.vehicles[0].fuelAccounting;db.vehicles[0].fuelBalance=100;}
 const before=JSON.stringify(db),result=application.create().query('fuelRecords',db,{vehicleId:'v'});
 assert.equal(get(result,'missing'),null);assert.equal(get(result,'known'),null);assert.equal(get(result,'measured'),25);assert.equal(get(result,'after'),23);assert.equal(JSON.stringify(db),before);
 const partial=fuel.recordBalances(db,'v',{to:'2026-09-02'});assert.equal(get(partial,'known'),null);assert.equal(get(partial,'measured'),undefined);
});

test('measurements only clear the unknown family and a known actual zero never creates an unknown expense',()=>{
 const db=fixture([record('diesel-missing','2026-09-01',{km:1}),record('gas-measured','2026-09-02',{fuelGrade:'Газ',tankMeasured:10}),record('diesel-measured','2026-09-03',{tankMeasured:30}),record('zero','2026-09-04',{km:100,fuelActual:0}),record('norm-zero','2026-09-05',{km:100,fuelUsed:0})]);
 const balances=fuel.recordBalances(db,'v');assert.equal(get(balances,'diesel-missing'),null);assert.equal(get(balances,'gas-measured'),null);assert.equal(get(balances,'diesel-measured'),40);assert.equal(get(balances,'zero'),40);assert.equal(get(balances,'norm-zero'),40);
});

test('live journal fixes leave every frozen calculation reader and v4 act source contract unchanged',()=>{
 const db=fixture([record(7,'2026-09-01',{km:100}),record('7','2026-09-02',{fuelActual:20})]);
 for(const version of [1,2,3,4])assert.deepEqual(fuel.forVersion(version).recordBalances(db,'v'),{'7':80});
 const live=fuel.recordBalances(db,'v');assert.equal(get(live,7),null);assert.equal(get(live,'7'),null);
 const current=fuel.buildLedger(db,{from:'2026-09-01',to:'2026-09-30'}),frozen=fuel.forVersion(4).buildLedger(db,{from:'2026-09-01',to:'2026-09-30'});
 assert.deepEqual({...current,movements:current.movements.map(({allocation,...row})=>row)},frozen);
});
