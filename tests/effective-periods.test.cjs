'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),crypto=require('node:crypto');
const periods=require('../assets/core/effective-periods.js'),fuel=require('../assets/core/fuel-engine.js'),writeoff=require('../assets/core/writeoff-engine.js'),policy=require('../assets/core/fuel-movement-policy.js');
const copy=value=>JSON.parse(JSON.stringify(value)),hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const vehicle=norm=>({norm,normCity:null,normHighway:null,normIdle:null});
const generator=norm100=>({power:100,norm:null,norm100,norm50:.563,normIdle:.14});
const rates=price=>({salaryRate:0,depreciationRate:null,fuelRate:10,fuelPrice:price});
const container=(parameters,from='2026-09-01',id='first')=>({version:1,periods:[{id,from,basis:'Synthetic approved basis',parameters}]});
const request={month:'2026-09',date:'2026-09-30'};
function db(){return {vehicles:[{id:'v',org:'A',fuel:'diesel',fuelGrade:'ДТ',norm:99,fuelBalance:100,fuelNorms:container(vehicle(10))}],records:[{id:'sep',vehicleId:'v',date:'2026-09-10',km:100}],fuelPurchases:[],fuelCards:[],monthlyFuel:[],fuelWriteoffs:[]};}
function post(api,data){const input={...request,basisNote:'Synthetic approved normative basis'},prepared=api.prepare(data,input);return api.post(data,input,{id:'act',number:'Synthetic',postedAt:'2026-10-22T10:00:00Z',postedBy:{id:0,name:'Synthetic'},expectedFingerprint:prepared.sourceFingerprint});}

test('strict complete snapshots are owned, sorted and frozen without inventing dates or rewriting scalar parameters',()=>{
  const row={norm:99,fuelNorms:{version:1,periods:[{id:7,from:'2026-10-01',basis:'October',parameters:vehicle(20)},{id:'7',from:'2026-09-01',basis:'September',parameters:vehicle(10)}]}},before=JSON.stringify(row);
  const validated=periods.validate('vehicles',row,'fuelNorms');assert.deepEqual(validated.periods.map(p=>p.id),['7',7]);assert.ok(Object.isFrozen(validated.periods[0].parameters));assert.equal(JSON.stringify(row),before);
  assert.equal(periods.resolve('vehicles',row,'2026-09-30','fuelNorms').parameters.norm,10);assert.equal(periods.resolve('vehicles',row,'2026-10-01','fuelNorms').parameters.norm,20);
  assert.equal(periods.resolve('vehicles',row,'2026-09-30','fuelNorms').toExclusive,'2026-10-01');assert.equal(row.norm,99);
  row.fuelNorms.periods[1].parameters.norm=11;assert.equal(validated.periods[0].parameters.norm,10);assert.equal(periods.resolve('vehicles',row,'2026-09-30','fuelNorms').parameters.norm,11);
});

test('explicit before-first is missing, null stays unknown and zero never borrows the current scalar',()=>{
  const row={norm:99,fuelNorms:container(vehicle(0),'2026-10-01')};
  assert.deepEqual(periods.projection('vehicles',row,'2026-09-30','fuelNorms'),{status:'missing',parameters:null});
  assert.equal(periods.resolve('vehicles',row,'2026-10-01','fuelNorms').parameters.norm,0);
  row.fuelNorms.periods[0].parameters.norm=null;assert.equal(periods.resolve('vehicles',row,'2026-10-01','fuelNorms').parameters.norm,null);
  const legacy=periods.resolve('vehicles',{norm:'10.123456',normIdle:0},'2026-09-01','fuelNorms');assert.equal(legacy.mode,'legacy');assert.equal(legacy.parameters.norm,10.123456);assert.equal(legacy.parameters.normIdle,0);assert.equal(legacy.parameters.normCity,null);
  assert.deepEqual(periods.validate('vehicles',{},'fuelNorms'),{mode:'legacy'});
  assert.deepEqual(periods.projection('vehicles',{},'2026-09-01','fuelNorms'),{status:'missing',parameters:null});
  assert.deepEqual(periods.projection('vehicles',{org:''},'2026-09-01','orgHistory'),{status:'missing',parameters:null});
  assert.equal(periods.projection('generators',{power:100},'2026-09-01','fuelNorms').parameters.power,100);
});

test('invalid dates, partial snapshots, duplicate starts/IDs, unsupported fields and coercion hooks fail closed',()=>{
  const row={fuelNorms:container(vehicle(10))};
  for(const date of ['',undefined,null,'2026-02-30'])assert.throws(()=>periods.resolve('vehicles',row,date,'fuelNorms'),{code:'INVALID_DATE'});
  for(const change of [c=>delete c.periods[0].parameters.normCity,c=>c.periods[0].parameters.extra=1,c=>c.periods[0].parameters.norm='10',c=>c.periods[0].parameters.norm=-1,c=>c.periods[0].parameters.norm=.1234567,c=>c.periods[0].basis='',c=>c.version=2,c=>c.periods.push(copy(c.periods[0])),c=>c.periods=[]]){const invalid=copy(row);change(invalid.fuelNorms);assert.throws(()=>periods.validate('vehicles',invalid,'fuelNorms'),{code:'INVALID_PERIODS'});}
  let invoked=0;const hooked={get fuelNorms(){invoked++;return row.fuelNorms;}};assert.throws(()=>periods.validate('vehicles',hooked,'fuelNorms'),{code:'INVALID_PERIODS'});assert.equal(invoked,0);
  const sparse={fuelNorms:{version:1,periods:new Array(1)}};assert.throws(()=>periods.validate('vehicles',sparse,'fuelNorms'));
  const validGen=periods.validate('generators',{fuelNorms:container(generator(1.126))},'fuelNorms');assert.throws(()=>periods.validate('vehicles',{fuelNorms:validGen},'fuelNorms'));
  assert.throws(()=>periods.validate('fuelCards',row,'fuelNorms'));
  class HookedArray extends Array {map(){invoked++;throw Error('untrusted map');}forEach(){invoked++;throw Error('untrusted forEach');}}
  const inherited=new HookedArray();inherited.push(copy(row.fuelNorms.periods[0]));
  assert.equal(periods.validate('vehicles',{fuelNorms:{version:1,periods:inherited}},'fuelNorms').periods.length,1);assert.equal(invoked,0);
});

test('cost periods share the same full-snapshot selection without treating prices as actual purchase amounts',()=>{
  const row={fuelPrice:99,ratePeriods:container(rates(12.123456))};
  assert.equal(periods.resolve('costProfiles',row,'2026-09-01','ratePeriods').parameters.fuelPrice,12.123456);assert.equal(row.fuelPrice,99);
  assert.equal(periods.resolve('costProfiles',row,'2026-09-01','ratePeriods').parameters.depreciationRate,null);
});

test('organization adapter retains a real undated legacy baseline and exposes gaps or ambiguous overlaps',()=>{
  const row={org:'A',orgHistory:[{from:'',to:'2026-09-30',org:'A'},{from:'2026-10-01',to:'',org:'B',basis:'Synthetic transfer'}]};
  assert.equal(periods.resolve('vehicles',row,'2026-09-01','orgHistory').parameters.org,'A');assert.equal(periods.resolve('fuelCards',row,'2026-10-01','orgHistory').parameters.org,'B');
  assert.equal(periods.resolve('vehicles',row,'2026-09-01','orgHistory').from,null);assert.equal(periods.resolve('vehicles',row,'2026-09-01','orgHistory').toExclusive,'2026-10-01');
  row.orgHistory[0].to='2026-09-10';assert.equal(periods.resolve('vehicles',row,'2026-09-15','orgHistory').reason,'gap');
  row.orgHistory[0].to='2026-10-01';assert.equal(periods.resolve('vehicles',row,'2026-10-01','orgHistory').reason,'ambiguous');
  assert.equal(periods.resolve('vehicles',{org:'A',orgHistory:[]},'2026-09-01','orgHistory').mode,'legacy');
});

test('v3 computes each journal row using its own date and ignores current scalar rates while v1/v2 stay frozen',()=>{
  const data=db();data.vehicles[0].fuelBalance=300;data.vehicles[0].fuelNorms.periods.push({id:'oct',from:'2026-10-01',basis:'October',parameters:vehicle(20)});data.records.push({id:'oct',vehicleId:'v',date:'2026-10-01',km:100});const before=JSON.stringify(data);
  assert.equal(fuel.fqRecord(data.records[0],data.vehicles[0]).norm,10);assert.equal(fuel.fqRecord(data.records[1],data.vehicles[0]).norm,20);
  assert.equal(fuel.recordBalances(data,'v').oct,270);assert.equal(fuel.forVersion(2).recordBalances(data,'v').oct,102);assert.equal(fuel.forVersion(1).recordBalances(data,'v').oct,102);
  assert.equal(fuel.fqRecord(data.records[0],data.vehicles[0]).normSource,'period');assert.equal(JSON.stringify(data),before);
});

test('v3 ownership gaps and ambiguous overlaps are explicit act blockers while manual consumption stays unchanged',()=>{
  const data=db();data.records[0].fuelActual=5;data.vehicles[0].orgHistory=[{org:'A',from:'2026-09-01',to:'2026-09-05'},{org:'B',from:'2026-09-20',to:''}];
  const before=JSON.stringify(data),preview=writeoff.prepare(data,request);assert.equal(preview.canPost,false);assert.ok(preview.issues.some(row=>row.code==='organization-period-missing'));assert.equal(preview.totals.spent,5);assert.equal(JSON.stringify(data),before);
  data.vehicles[0].orgHistory[0].to='2026-09-30';data.vehicles[0].orgHistory[1].from='2026-09-10';assert.ok(fuel.buildLedger(data,{from:'2026-09-01',to:'2026-09-30'}).issues.some(row=>row.code==='organization-period-missing'&&row.reason==='ambiguous'));
});

test('manual zero/record norms are authoritative, missing dated norms block acts and journal unknown carries until measurement',()=>{
  const data=db();data.vehicles[0].fuelNorms=container(vehicle(10),'2026-10-01');data.records.push({id:'carry',vehicleId:'v',date:'2026-09-11',km:0,fuelActual:0},{id:'measurement',vehicleId:'v',date:'2026-09-12',km:0,tankMeasured:50});
  const balances=fuel.recordBalances(data,'v');assert.equal(balances.sep,null);assert.equal(balances.carry,null);assert.equal(balances.measurement,50);
  const preview=writeoff.prepare(data,request);assert.equal(preview.canPost,false);assert.ok(preview.issues.some(row=>row.code==='consumption-missing'||row.code==='consumption-basis-missing'));
  assert.equal(fuel.fqRecord({...data.records[0],fuelUsed:0},data.vehicles[0]).norm,0);assert.equal(fuel.fqRecord({...data.records[0],fuelActual:0},data.vehicles[0]).total,0);
  assert.equal(fuel.fqRecord({...data.records[0],fuelActual:0},data.vehicles[0]).norm,null);
});

test('dated generator curves include historical power and distinguish unknown from known zero without changing manual actuals',()=>{
  const g={power:999,norm100:999,fuelNorms:container(generator(1.126))},row={date:'2026-09-01',hours:1,load:75};
  assert.equal(policy.generatorSpent(g,row),.845);assert.equal(policy.generatorNormSpent(g,row),.845);assert.equal(policy.generatorNormKnown(g,row),true);
  assert.equal(policy.generatorSpent(g,{...row,date:'2026-08-31'}),null);assert.equal(policy.generatorNormKnown(g,{...row,date:'2026-08-31'}),false);
  assert.equal(policy.generatorSpent(g,{...row,date:'2026-08-31',fuelActual:0}),0);assert.equal(policy.generatorNormSpent(g,{...row,date:'2026-08-31',fuelUsed:0}),0);
  assert.throws(()=>policy.generatorSpent(g,{hours:1,load:75}),{code:'INVALID_DATE'});
  assert.equal(policy.generatorSpent({power:100,norm100:2.675},{hours:1,load:100}),2.675);
});

test('semantic linked issues with explicit zero activity do not need a dated norm, while absent activity remains unknown',()=>{
  const commands=require('../assets/core/platform-commands.js'),schema=require('../assets/core/platform-schema.js');
  const source=Object.fromEntries(schema.sections.map(name=>[name,[]]));
  source.tanks=[{id:0,name:'Synthetic source',fuel:'diesel',balanceInit:1000}];
  source.vehicles=[{id:7,org:'A',fuel:'diesel',fuelBalance:923.537,fuelNorms:container(vehicle(10),'2026-10-01')}];
  source.generators=[{id:9,org:'A',fuelBalance:923.537,fuelNorms:container(generator(10),'2026-10-01')}];
  const context={id:'issue-generator',now:'2026-09-10T10:00:00.000Z',today:'2026-09-10',actor:{id:'synthetic',name:'Synthetic',role:'admin'}};
  const command={type:'IssueFuel',version:1,input:{tankId:0,target:{section:'generators',id:9},date:'2026-09-10',qty:20,reason:'Synthetic pure issue'}};
  const planned=commands.plan(source,command,context),actual=planned.sections.genRecords[0];
  assert.equal(actual.hours,0);assert.equal(actual.fuelUsed,0);assert.equal(actual.tankId,null);assert.equal(policy.generatorSpent(source.generators[0],actual),0);
  const legacyLinked={...actual,fuelUsed:null,fuelActual:null};
  assert.equal(policy.generatorSpent(source.generators[0],legacyLinked),0);assert.equal(policy.generatorNormSpent(source.generators[0],legacyLinked),0);assert.equal(policy.generatorNormKnown(source.generators[0],legacyLinked),true);
  for(const hours of [undefined,null,'',1]){const incomplete={...legacyLinked,hours};assert.equal(policy.generatorSpent(source.generators[0],incomplete),null);assert.equal(policy.generatorNormKnown(source.generators[0],incomplete),false);}
  assert.equal(policy.generatorSpent(source.generators[0],{...legacyLinked,hours:1,fuelActual:2}),2);
  command.input.target={section:'vehicles',id:7};const vehiclePlan=commands.plan(source,command,{...context,id:'issue-vehicle'}),record=vehiclePlan.sections.records[0];
  assert.equal(record.km,0);assert.equal(fuel.fqRecord(record,source.vehicles[0]).total,0);
  const linked={...record,fuelUsed:null,fuelActual:null};assert.equal(fuel.fqRecord(linked,source.vehicles[0]).total,0);assert.equal(fuel.fqRecord(linked,source.vehicles[0]).normSource,'issue');
  assert.equal(fuel.fqRecord({...linked,km:undefined},source.vehicles[0]).norm,null);
  const next={...source,records:[linked]};assert.equal(fuel.recordBalances(next,7)[linked.id],943.537);assert.ok(!fuel.buildLedger(next,{from:'2026-09-01',to:'2026-09-30'}).issues.some(issue=>issue.code==='consumption-missing'));
});

test('new acts use current effective projections; future periods and scalar presentation changes do not alter past dated source fingerprints',()=>{
  const data=db(),preview=writeoff.prepare(data,request),document=post(writeoff,data),saved={...data,fuelWriteoffs:[document]};assert.equal(document.calculationVersion,6);assert.equal(preview.totals.spent,10);
  const future=copy(saved);future.vehicles[0].fuelNorms.periods.push({id:'oct',from:'2026-10-01',basis:'Future',parameters:vehicle(20)});
  assert.equal(writeoff.fingerprint(future,request),document.sourceFingerprint);assert.equal(writeoff.validateDocuments(saved,future),true);
  future.vehicles[0].norm=123;assert.equal(writeoff.fingerprint(future,request),document.sourceFingerprint);
  const changed=copy(saved);changed.vehicles[0].fuelNorms.periods[0].parameters.norm=11;assert.notEqual(writeoff.fingerprint(changed,request),document.sourceFingerprint);assert.throws(()=>writeoff.validateDocuments(saved,changed),{code:'POSTED_SOURCE_LOCKED'});
  assert.ok(document.snapshot.vehicles[0].effectiveNorms.some(row=>row.parameters.norm===10));assert.equal(document.snapshot.vehicles[0].fuelNorms,undefined);
});

test('an explicitly created equal-value bridge preserves an existing v3 fingerprint while a known-to-missing activation does not',()=>{
  const data=db();delete data.vehicles[0].fuelNorms;data.vehicles[0].norm=10;const document=post(writeoff,data),saved={...data,fuelWriteoffs:[document]};
  const bridged=copy(saved);bridged.vehicles[0].fuelNorms=container(vehicle(10));bridged.vehicles[0].fuelNorms.periods.push({id:'future',from:'2026-10-01',basis:'Future approved rate',parameters:vehicle(20)});
  assert.equal(writeoff.fingerprint(bridged,request),document.sourceFingerprint);assert.equal(writeoff.validateDocuments(saved,bridged),true);
  const missing=copy(saved);missing.vehicles[0].fuelNorms=container(vehicle(20),'2026-10-01');assert.notEqual(writeoff.fingerprint(missing,request),document.sourceFingerprint);
});

test('old v1/v2 source checks keep working after a durable same-org bridge and subsequent unrelated saves',()=>{
  const temporal=require('../assets/core/temporal-policy.js');
  for(const version of [1,2]){
    const data=db();delete data.vehicles[0].fuelNorms;data.vehicles[0].norm=10;data.records[0].fuelActual=5;
    const document=post(writeoff.forVersion(version),data),saved={...data,fuelWriteoffs:[document]},bridged=copy(saved);
    bridged.vehicles[0].orgHistory=[{from:'',to:'2026-09-30',org:'A'},{from:'2026-10-01',to:'',org:'B',basis:'Synthetic explicit ownership decision'}];
    const canonical=temporal.canonicalizeOrigins(saved,{vehicles:bridged.vehicles});Object.assign(bridged,canonical);
    assert.deepEqual(bridged.vehicles[0].orgHistoryOrigin,{version:1,previous:'absent'});assert.equal(writeoff.validateDocuments(saved,bridged),true);
    const later=copy(bridged);later.vehicles[0].note='Unrelated later save';assert.equal(writeoff.validateDocuments(bridged,later),true);
    const changed=copy(later);changed.records[0].fuelActual=6;assert.throws(()=>writeoff.validateDocuments(later,changed),{code:'POSTED_SOURCE_LOCKED'});
    const bad=copy(later);bad.vehicles[0].orgHistory[0].org='B';assert.throws(()=>writeoff.validateDocuments(later,bad));
    assert.equal(JSON.stringify(later.fuelWriteoffs[0]),JSON.stringify(document));
  }
});

test('v2 ledger, journal, preview, full posted snapshot and fingerprint match hashes captured before step 9',()=>{
  const data={vehicles:[{id:'v',org:'A',fuel:'gasoline',fuelGrade:'АИ-95',fuelBalance:923.537}],records:[{id:'r',vehicleId:'v',date:'2026-09-05',fuelGrade:'АИ-95',fuelIssued:40.001,fuelActual:20.0055,fuelIdle:2.0005,km:100.123}],fuelPurchases:[{id:'p',vehicleId:'v',recordId:'r',date:'2026-09-05',grade:'АИ-95',qty:40.001,manual:true,sourceOrg:'A'}],fuelCards:[],monthlyFuel:[],fuelWriteoffs:[]};
  const req={...request,org:'A',grade:'АИ-95'},f=fuel.forVersion(2),w=writeoff.forVersion(2),preview=w.prepare(data,req),document=w.post(data,req,{id:'legacy',number:'Synthetic',postedAt:'2026-10-21T10:00:00Z',postedBy:{id:0,name:'Synthetic'},expectedFingerprint:preview.sourceFingerprint});
  assert.equal(hash(f.buildLedger(data,{from:'2026-09-01',to:'2026-09-30'})),'c0c2c1926d2c044c763f444615851b715988656fb945f193b7ede912bd037374');assert.equal(hash(f.recordBalances(data,'v')),'17aae3437ec6fe0216b24e36eadeca245944fcd3ccf36350fb202e1510b367e9');
  assert.equal(hash(preview),'ffb6ed2baad0a46761b784f6c71a0c51e9cb1d6a4494f4af5bf6df7d83089dc6');assert.equal(hash(document),'a7dbf67b486b5e092d2e3c827394c7fbef88dbfb0e618c495261f227a0493e4e');assert.equal(preview.sourceFingerprint,'sha256:06dffc742bc11bb3fe17e5b010e613188636ddbabe7dc98d714508e520a1ebe4');
});

test('actual browser modules match Node, and missing dependency only fails when dated metadata is used',()=>{
  const browser=vm.createContext({});for(const name of ['decimal-core','accounting-boundary','effective-periods','temporal-policy','fuel-engine','writeoff-engine','fuel-movement-policy'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/core',name+'.js'),'utf8'),browser,{filename:name});
  assert.equal(hash(browser.TvsWriteoffEngine.prepare(db(),request)),hash(writeoff.prepare(db(),request)));assert.equal(browser.FuelMovementPolicy.generatorSpent({fuelNorms:container(generator(1.126))},{date:'2026-09-01',hours:1,load:75}),.845);
  const noPeriods=vm.createContext({});for(const name of ['decimal-core','fuel-engine'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/core',name+'.js'),'utf8'),noPeriods);
  assert.equal(noPeriods.TvsFuelEngine.fqRecord({km:100},{norm:10}).norm,10);assert.throws(()=>noPeriods.TvsFuelEngine.fqRecord({date:'2026-09-01',km:100},{fuelNorms:container(vehicle(10))}),{code:'MODULE_UNAVAILABLE'});
  const unanchored={vehicles:[{id:'v',norm:10,orgHistory:[]}],records:[{id:'r',vehicleId:'v',date:'2026-09-01',km:100}]};
  assert.equal(noPeriods.TvsFuelEngine.recordBalanceAt(noPeriods.TvsFuelEngine.recordBalances(unanchored,'v'),'r'),null);
  assert.equal(noPeriods.TvsFuelEngine.forVersion(5).recordBalances(unanchored,'v').r,-10);
});
