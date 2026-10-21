'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const boundary=require('../assets/core/accounting-boundary.js'),fuel=require('../assets/core/fuel-engine.js'),audit=require('../assets/core/fuel-audit.js'),writeoff=require('../assets/core/writeoff-engine.js');
const copy=value=>JSON.parse(JSON.stringify(value));
const anchor=(patch={})=>({version:1,from:'2026-09-01',opening:923.537,basis:'Actual closing measurement 31 August, entered explicitly',...patch});
function database(metadata=anchor()) {return {vehicles:[{id:'v',plate:'SYNTHETIC-BOUNDARY',org:'Synthetic org',fuelGrade:'ДТ',fuel:'diesel',fuelBalance:50,norm:10,...(metadata!==undefined?{fuelAccounting:metadata}:{})}],
  records:[{id:'bad-August',vehicleId:'v',date:'2026-08-01',km:777,fuelIssued:0,fuelActual:5000},
    {id:'Aug31-closing',vehicleId:'v',date:'2026-08-31',km:0,fuelIssued:0,fuelActual:0,tankMeasured:923.537},
    {id:'Sept1',vehicleId:'v',date:'2026-09-01',km:200,fuelIssued:100,fuelActual:20},
    {id:'Oct1',vehicleId:'v',date:'2026-10-01',km:100,fuelIssued:0,fuelActual:10}],fuelPurchases:[{id:'old-Aug-receipt',vehicleId:'v',date:'2026-08-31',qty:100,grade:'ДТ',sourceOrg:'Synthetic org',sourceProvider:'Archive',manual:true,recordId:'Aug31-closing'}],fuelCards:[],monthlyFuel:[],fuelWriteoffs:[]};}
const september={from:'2026-09-01',to:'2026-09-30'};
const request=month=>({month,org:'',grade:'',date:month+'-30'});
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

test('one strict owned frozen anchor supports vehicles, generators and tanks without changing any legacy opening field',()=>{
  for(const section of ['vehicles','generators','tanks']){
    const row=freeze({id:7,fuelBalance:50,balanceInit:70,fuelAccounting:anchor({sources:[{org:'A',grade:'ДТ',qty:900},{org:'B',grade:'ДТ',qty:23.537}]})});
    const result=boundary.resolve(section,row);assert.equal(result.mode,'explicit');assert.equal(result.opening,923.537);assert.equal(row.fuelBalance,50);assert.equal(row.balanceInit,70);
    assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result.sources));assert.ok(Object.isFrozen(result.sources[0]));assert.notEqual(result.sources,row.fuelAccounting.sources);
  }
  assert.deepEqual(boundary.resolve('vehicles',{id:7,fuelBalance:923.537}),{mode:'legacy'});
});

test('invalid explicit metadata fails closed, including NaN, negative opening, unsupported versions, unknown fields and source mismatches',()=>{
  for(const metadata of [null,{},false,{...anchor(),version:2},{...anchor(),from:'2026-02-30'},{...anchor(),opening:'923.537'},
    {...anchor(),opening:NaN},{...anchor(),opening:-1},{...anchor(),basis:''},{...anchor(),evidence:{id:'unsupported-proof'}},
    {...anchor(),sources:[]},{...anchor(),sources:[{org:'A',grade:'unknown',qty:923.537}]},
    {...anchor(),sources:[{org:'A',grade:'ДТ',qty:923.535}]},{...anchor(),sources:[{org:'A',grade:'ДТ',qty:-1}]}])
    assert.throws(()=>boundary.resolve('vehicles',{fuelAccounting:metadata}),{code:'INVALID_ACCOUNTING_BOUNDARY'});
  assert.throws(()=>boundary.resolve('drivers',{fuelAccounting:anchor()}),{code:'INVALID_ACCOUNTING_BOUNDARY'});
});

test('boundary parsing never executes metadata getters, inherited hooks, symbol or hidden fields',()=>{
  let calls=0;const getter={id:7};Object.defineProperty(getter,'fuelAccounting',{enumerable:true,get(){calls++;return anchor();}});
  const hidden=anchor();Object.defineProperty(hidden,'opening',{value:923.537,enumerable:false});
  const symbols=anchor();symbols[Symbol('invisible')]=true;
  const fields=anchor();Object.defineProperty(fields,'opening',{enumerable:true,get(){calls++;return 923.537;}});
  for(const row of [getter,{fuelAccounting:hidden},{fuelAccounting:symbols},{fuelAccounting:fields}])assert.throws(()=>boundary.resolve('vehicles',row));
  assert.equal(calls,0);
  const sparse=anchor({sources:new Array(1)});assert.throws(()=>boundary.resolve('vehicles',{fuelAccounting:sparse}));
});

test('classification and windows distinguish archive, current dates, a partial period and a period wholly before accounting',()=>{
  const value=boundary.resolve('vehicles',{fuelAccounting:anchor()});
  assert.equal(boundary.classify(value,'2026-08-31'),'historical');assert.equal(boundary.classify(value,'2026-09-01'),'current');assert.equal(boundary.classify(value,'not a date'),'invalid-date');
  assert.deepEqual(boundary.window(value,{}),{status:'inside',historyFrom:'2026-09-01',reportFrom:'2026-09-01',reportTo:null});
  assert.deepEqual(boundary.window(value,{from:'2026-10-01',to:'2026-10-31'}),{status:'inside',historyFrom:'2026-09-01',reportFrom:'2026-10-01',reportTo:'2026-10-31'});
  assert.deepEqual(boundary.window(value,{from:'2026-08-01',to:'2026-09-30'}),{status:'partial',historyFrom:'2026-09-01',reportFrom:'2026-09-01',reportTo:'2026-09-30'});
  assert.deepEqual(boundary.window(value,{from:'2026-08-01',to:'2026-08-31'}),{status:'outside-accounting',historyFrom:null,reportFrom:null,reportTo:null});
  assert.deepEqual(boundary.window(copy(value),september),boundary.window(value,september));
  assert.deepEqual(boundary.window(boundary.resolve('tanks',{}),september),{status:'legacy',historyFrom:null,reportFrom:'2026-09-01',reportTo:'2026-09-30'});
  for(const query of [{from:'bad'},{from:'2026-10-01',to:'2026-09-01'},{from:'2026-09-01',extra:true}])assert.throws(()=>boundary.window(value,query));
});

test('September uses an explicit 923.537 opening once, excludes August receipt and closing measurement, and leaves kilometres untouched',()=>{
  const db=freeze(database()),before=JSON.stringify(db),result=fuel.buildLedger(db,september),row=result.rows[0];
  assert.equal(row.start,923.537);assert.equal(row.issued,100);assert.equal(row.spent,20);assert.equal(row.end,1003.537);assert.equal(row.accountingFrom,'2026-09-01');
  assert.deepEqual(result.receipts.map(receipt=>receipt.recordId),['Sept1']);assert.deepEqual(result.journal.map(record=>record.recordId),['Sept1']);
  assert.ok(!result.issues.some(issue=>['shortage','measurement-surplus','journal-difference'].includes(issue.code)));assert.equal(result.accounting[0].status,'inside');
  assert.equal(JSON.stringify(db),before);assert.equal(db.records[0].km,777);assert.equal(db.vehicles[0].fuelBalance,50);
});

test('October carries all movements since the September anchor, while all-time queries start at that anchor',()=>{
  const db=database(),october=fuel.buildLedger(db,{from:'2026-10-01',to:'2026-10-31'}),all=fuel.buildLedger(db,{});
  assert.equal(october.rows[0].start,1003.537);assert.equal(october.rows[0].spent,10);assert.equal(october.rows[0].end,993.537);
  assert.equal(october.accounting[0].historyFrom,'2026-09-01');assert.equal(all.rows[0].start,923.537);assert.equal(all.rows[0].end,993.537);
  const balances=fuel.recordBalances(db,'v',{from:'2026-10-01',to:'2026-10-31'});
  assert.equal(balances['bad-August'],undefined);assert.equal(balances['Aug31-closing'],undefined);assert.equal(balances.Sept1,1003.537);assert.equal(balances.Oct1,993.537);
});

test('pre-start reports return outside-accounting and no balance or zero synthetic act row',()=>{
  const db=database(),ledger=fuel.buildLedger(db,{from:'2026-08-01',to:'2026-08-31'}),prepared=writeoff.prepare(db,request('2026-08'));
  assert.deepEqual(ledger.rows,[]);assert.deepEqual(ledger.receipts,[]);assert.deepEqual(ledger.journal,[]);assert.equal(ledger.accounting[0].status,'outside-accounting');
  assert.ok(ledger.issues.some(issue=>issue.code==='outside-accounting'));assert.deepEqual(fuel.recordBalances(db,'v',{to:'2026-08-31'}),{});
  assert.equal(prepared.canPost,false);assert.deepEqual(prepared.rows,[]);assert.ok(prepared.issues.some(issue=>issue.code==='outside-accounting'));
});

test('an explicit mid-month opening is visible in preview and cannot masquerade as a first-of-month balance in a posted act',()=>{
  const db=database(anchor({from:'2026-09-15',opening:20}));db.records=[{id:'Sept16',vehicleId:'v',date:'2026-09-16',km:10,fuelActual:1,fuelIssued:0}];db.fuelPurchases=[];db.monthlyFuel=[{id:'month',vehicleId:'v',month:'2026-09',liters:900}];
  const ledger=fuel.buildLedger(db,september),prepared=writeoff.prepare(db,request('2026-09'));
  assert.equal(ledger.rows[0].start,20);assert.equal(ledger.rows[0].accountingFrom,'2026-09-15');assert.equal(ledger.accounting[0].status,'partial');
  assert.ok(ledger.issues.some(issue=>issue.code==='accounting-partial-month'));assert.ok(!ledger.issues.some(issue=>issue.code==='monthly-difference'));
  assert.equal(prepared.canPost,false);assert.ok(prepared.issues.some(issue=>issue.code==='accounting-period-partial'));
});

test('current fuel diagnostics do not resurrect pre-boundary shortages, bad receipts or the August measurement in negative traces',()=>{
  const db=database(anchor({opening:5}));db.records[0].fuelIssued=-1;db.fuelPurchases[0].qty='bad';db.records[2].fuelIssued=0;db.records[2].fuelActual=20;
  const result=audit.buildModel(db,{...september,coverage:false});
  assert.ok(result.items.some(item=>item.code==='negative-ending'));assert.ok(!result.items.some(item=>item.recordId==='bad-August'||item.purchaseId==='old-Aug-receipt'));
  const item=result.items.find(item=>item.code==='negative-ending');assert.equal(item.earliestCauseDate,'2026-09-01');assert.ok(item.chronology.every(event=>!event.date||event.date>='2026-09-01'));
});

test('explicit source allocations override legacy allocations and resolve organisations at the accounting anchor',()=>{
  const db=database(anchor({opening:30,sources:[{org:'Source A',grade:'ДТ',qty:10},{org:'Source B',grade:'ДТ',qty:20}]}));
  db.vehicles[0].fuelBalanceSources=[{org:'Wrong legacy allocation',grade:'АИ-92',qty:50}];db.records=[];db.fuelPurchases=[];
  const ledger=fuel.buildLedger(db,september);assert.deepEqual(ledger.rows.map(row=>[row.org,row.start,row.end]),[['Source A',10,10],['Source B',20,20]]);
  const prepared=writeoff.prepare(db,request('2026-09'));assert.ok(!prepared.issues.some(issue=>issue.code==='opening-source-invalid'||issue.code==='opening-difference'));
});

test('a September act fingerprints its explicit anchor and current sources, while edits to August facts cannot alter it',()=>{
  const db=database(),prepared=writeoff.prepare(db,request('2026-09'));assert.equal(prepared.canPost,true,JSON.stringify(prepared.issues));
  assert.equal(prepared.rows[0].start,923.537);assert.equal(prepared.rows[0].end,1003.537);assert.equal(prepared.snapshot.vehicles[0].fuelAccounting.from,'2026-09-01');
  const changed=copy(db);changed.records[0].fuelActual=99999;changed.records[1].tankMeasured=1;changed.fuelPurchases[0].qty=99999;
  assert.equal(writeoff.fingerprint(changed,request('2026-09')),prepared.sourceFingerprint);
  changed.vehicles[0].fuelAccounting.opening=923.538;assert.notEqual(writeoff.fingerprint(changed,request('2026-09')),prepared.sourceFingerprint);
});

test('typed numeric asset and record identifiers remain valid in explicit opening writeoff snapshots',()=>{
  const db=database();db.vehicles[0].id=7;db.records=db.records.map((row,index)=>({...row,id:index+1,vehicleId:7}));db.fuelPurchases=[];
  const result=writeoff.prepare(db,request('2026-09'));assert.equal(result.canPost,true,JSON.stringify(result.issues));assert.equal(result.rows[0].vehicleId,7);assert.equal(typeof result.rows[0].vehicleId,'number');
  db.vehicles.push({...copy(db.vehicles[0]),id:'7',plate:'Different string identity',fuelAccounting:anchor({opening:10})});
  db.records.push({id:'string-journal',vehicleId:'7',date:'2026-09-01',km:10,fuelIssued:0,fuelActual:1});
  const both=writeoff.prepare(db,request('2026-09'));assert.equal(both.canPost,true,JSON.stringify(both.issues));assert.equal(both.rows.length,2);
  assert.notEqual(both.rows[0].key,both.rows[1].key);assert.ok(both.rows.every(row=>row.key.startsWith('typed:')));
  assert.equal(both.rows.find(row=>row.vehicleId===7).start,923.537);assert.equal(both.rows.find(row=>row.vehicleId==='7').start,10);
  assert.equal(both.rows.find(row=>row.vehicleId===7).spent,20);assert.equal(both.rows.find(row=>row.vehicleId==='7').spent,1);
});

test('absence of metadata preserves the complete legacy calculation and audit results, not an inferred September start',()=>{
  const db=database();delete db.vehicles[0].fuelAccounting;
  const ledger=fuel.buildLedger(db,september),balances=fuel.recordBalances(db,'v');
  assert.equal(Object.hasOwn(ledger,'accounting'),false);assert.equal(Object.hasOwn(ledger.rows[0],'accountingFrom'),false);assert.ok(Object.hasOwn(balances,'bad-August'));assert.ok(Object.hasOwn(balances,'Aug31-closing'));
  assert.equal(ledger.rows[0].start,923.537);assert.equal(db.vehicles[0].fuelBalance,50);
});

test('browser pure modules require no application state and use the same explicit boundaries as CommonJS',()=>{
  const browser=vm.createContext({});for(const name of ['decimal-core','accounting-boundary','fuel-engine','writeoff-engine','fuel-audit']){
    const file=path.join(__dirname,'../assets/core',name+'.js');vm.runInContext(fs.readFileSync(file,'utf8'),browser,{filename:file});
  }
  assert.deepEqual(copy(browser.AccountingBoundary.window(browser.AccountingBoundary.resolve('vehicles',database().vehicles[0]),september)),boundary.window(boundary.resolve('vehicles',database().vehicles[0]),september));
  assert.deepEqual(copy(browser.TvsFuelEngine.buildLedger(database(),september)),copy(fuel.buildLedger(database(),september)));
  assert.deepEqual(copy(browser.TvsFuelAudit.buildModel(database(),september)),copy(audit.buildModel(database(),september)));
  assert.equal(browser.document,undefined);assert.equal(browser.data,undefined);assert.equal(browser.localStorage,undefined);
});

test('explicit metadata cannot be ignored if an older browser loader omitted the accounting module',()=>{
  const browser=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/core/decimal-core.js'),'utf8'),browser);vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/core/fuel-engine.js'),'utf8'),browser);
  assert.throws(()=>browser.TvsFuelEngine.buildLedger(database(),september),{code:'MODULE_UNAVAILABLE'});
  const legacy=database();delete legacy.vehicles[0].fuelAccounting;assert.deepEqual(copy(browser.TvsFuelEngine.buildLedger(legacy,september)),copy(fuel.buildLedger(legacy,september)));
});

test('the actual browser worker endpoint loads the accounting core and returns the same anchored ledger, diagnostics and act preview',()=>{
  const tasks=[],replies=[],imports=[],directory=path.join(__dirname,'../assets/core');let browser;
  browser=vm.createContext({postMessage:message=>replies.push(copy(message)),setTimeout:action=>tasks.push(action),importScripts(...files){
    for(const file of files){imports.push(file);const absolute=path.resolve(directory,file);assert.ok(absolute.startsWith(path.resolve(__dirname,'../assets')+path.sep));vm.runInContext(fs.readFileSync(absolute,'utf8'),browser,{filename:absolute});}
  }});
  vm.runInContext(fs.readFileSync(path.join(directory,'engine-worker.js'),'utf8'),browser,{filename:'engine-worker.js'});
  assert.ok(imports.indexOf('./accounting-boundary.js')<imports.indexOf('./fuel-engine.js'));
  const db=database(),owned=copy(db),context={identity:'synthetic-explicit-worker'};
  browser.onmessage({data:{type:'load',requestId:'accounting-load',generation:1,database:db,context}});const loaded=replies.at(-1);assert.equal(loaded.ok,true);
  db.vehicles[0].fuelAccounting.opening=1;
  for(const [name,options,oracle]of [['fuel',september,fuel.buildLedger(owned,september)],['fuel',{from:'2026-10-01',to:'2026-10-31'},fuel.buildLedger(owned,{from:'2026-10-01',to:'2026-10-31'})],
    ['fuelAudit',september,audit.buildModel(owned,september)],['writeoff',request('2026-09'),writeoff.prepare(owned,request('2026-09'))],['writeoff',request('2026-08'),writeoff.prepare(owned,request('2026-08'))]]){
    browser.onmessage({data:{type:'query',requestId:'query-'+replies.length,generation:1,identity:context.identity,sourceFingerprint:loaded.sourceFingerprint,name,options}});
    while(tasks.length)tasks.shift()();const result=replies.at(-1);assert.equal(result.ok,true,JSON.stringify(result.error));assert.deepEqual(result.value,copy(oracle));
  }
  assert.equal(browser.document,undefined);assert.equal(browser.fetch,undefined);assert.equal(browser.localStorage,undefined);
});
