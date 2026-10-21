'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {Worker}=require('node:worker_threads');
const application=require('../assets/core/application-engine.js');
const fuel=require('../assets/core/fuel-engine.js');
const writeoff=require('../assets/core/writeoff-engine.js');
const {createHandler}=require('../assets/core/engine-worker.js');
const range={from:'2026-10-01',to:'2026-10-31'},context={identity:'synthetic-performance-database:principal:access-v1'};
// Same fuel shape as the production baseline: ten records and one linked
// purchase per asset. No storage, settings or database adapter is imported.
function fixture(count=50){
  const db=Object.fromEntries([...new Set(Object.values(application.sections).flat())].map(name=>[name,[]]));
  const assets=Math.max(1,Math.floor(count/10));
  for(let asset=0;asset<assets;asset++)db.vehicles.push({id:'perf-v-'+asset,plate:'SYNTHETIC-'+asset,make:'Synthetic test asset',fuel:'diesel',fuelGrade:'ДТ',fuelBalance:60,norm:10,org:'Synthetic organization',status:'В работе'});
  for(let row=0;row<count;row++){
    const asset=row%assets,day=Math.floor(row/assets)+1,date='2026-10-'+String(day).padStart(2,'0'),vehicleId='perf-v-'+asset,id='perf-r-'+row;
    db.records.push({id,vehicleId,date,km:10,fuelActual:1,fuelIssued:day===1?20:0,fuelGrade:'ДТ',fuelOrg:'Synthetic organization',driver:'Synthetic employee '+asset,note:'Synthetic baseline'});
    if(day===1)db.fuelPurchases.push({id:'perf-p-'+asset,vehicleId,recordId:id,date,qty:20,grade:'ДТ',price:60,sum:1200,sourceProvider:'Synthetic supplier',sourceOrg:'Synthetic organization',manual:true});
  }
  db.fuelCards=[{id:'fc_cash',number:'НАЛИЧКА',provider:'Наличка',assignments:[]}];return db;
}
function postParameters(db,id='synthetic-writeoff-document'){
  const request={month:'2026-10',date:'2026-10-31',basisNote:'Synthetic reviewed calculation'},prepared=writeoff.prepare(db,request);
  assert.equal(prepared.canPost,true,JSON.stringify(prepared.issues));
  return {request,metadata:{id,number:'SYNTHETIC-1',postedAt:'2026-10-31T12:00:00.000Z',postedBy:{id:'synthetic-actor',name:'Synthetic reviewer'},expectedFingerprint:prepared.sourceFingerprint}};
}
function handler(options={}){
  const replies=[],tasks=[],endpoint=createHandler({postMessage:message=>replies.push(message),schedule:action=>tasks.push(action),...options});
  return {endpoint,replies,tasks,load(database=fixture(),generation=1,ctx=context){endpoint.handle({type:'load',requestId:'load-'+generation,generation,database,context:ctx});return replies.at(-1);},
    query(loaded,requestId='query',name='fuel',options=range){return {type:'query',requestId,generation:loaded.generation,identity:loaded.identity,sourceFingerprint:loaded.sourceFingerprint,name,options};},
    flush(){while(tasks.length)tasks.shift()();}};
}
function thread(t){
  const modulePath=require.resolve('../assets/core/engine-worker.js');
  const worker=new Worker("const {parentPort}=require('node:worker_threads');const {createHandler}=require("+JSON.stringify(modulePath)+");const h=createHandler({postMessage:m=>parentPort.postMessage(m),schedule:fn=>setImmediate(fn)});parentPort.on('message',m=>h.handle(m));",{eval:true});
  const waiting=new Map();worker.on('message',message=>{const waiter=waiting.get(message.requestId);if(waiter){waiting.delete(message.requestId);clearTimeout(waiter.timer);waiter.resolve(message);}});
  worker.on('error',error=>{for(const waiter of waiting.values()){clearTimeout(waiter.timer);waiter.reject(error);}waiting.clear();});
  t.after(()=>worker.terminate());
  return message=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{waiting.delete(message.requestId);reject(Error('Synthetic worker timed out'));},20000);waiting.set(message.requestId,{resolve,reject,timer});worker.postMessage(message);});
}

test('the 10000-record fuel result remains cached below the existing 8m budget and repeats exactly',t=>{
  const db=fixture(10000),before=JSON.stringify(db),engine=application.create(),start=performance.now();
  const first=engine.query('fuel',db,range,context),cold=performance.now()-start;assert.equal(engine.stats().entries,1);assert.equal(engine.stats().uncached,0);
  const againStart=performance.now(),second=engine.query('fuel',db,range,context),repeat=performance.now()-againStart;
  assert.deepEqual(second,first);assert.deepEqual(second,fuel.buildLedger(db,range));assert.equal(engine.stats().calculations,1);assert.equal(engine.stats().hits,1);assert.ok(engine.stats().cachedCharacters<=8000000);assert.equal(JSON.stringify(db),before);
  t.diagnostic(JSON.stringify({records:10000,coldMs:Math.round(cold),repeatMs:Math.round(repeat),cachedCharacters:engine.stats().cachedCharacters}));
});

test('an owned immutable snapshot reuses projection fingerprints and never observes subsequent live edits',()=>{
  const db=fixture(),engine=application.create(),snapshot=engine.capture(db,context),before=engine.querySnapshot('fuel',snapshot,range),stats=engine.stats();
  assert.equal(Object.isFrozen(snapshot),true);assert.equal(Object.isFrozen(snapshot.sections),true);assert.match(snapshot.sourceFingerprint,/^[a-f0-9]{64}$/);
  db.records[0].fuelActual=20;db.vehicles[0].fuelBalance=923.537;
  before.rows[0].vehicle.fuelBalance=-1;before.rows[0].cards.add('poisoned');
  const repeat=engine.querySnapshot('fuel',snapshot,range);assert.equal(repeat.rows[0].vehicle.fuelBalance,60);assert.equal(repeat.rows[0].cards.has('poisoned'),false);
  assert.equal(engine.stats().sourceFingerprints,stats.sourceFingerprints);assert.equal(engine.stats().calculations,1);assert.equal(engine.stats().hits,1);
  engine.querySnapshot('fuel',snapshot,{from:'2026-10-02',to:'2026-10-31'});assert.equal(engine.stats().sourceFingerprints,stats.sourceFingerprints);
  assert.notEqual(engine.capture(db,context).sourceFingerprint,snapshot.sourceFingerprint);assert.throws(()=>application.create().querySnapshot('fuel',snapshot,range),{code:'INVALID_SNAPSHOT'});
  assert.throws(()=>engine.querySnapshot('fuel',{...snapshot},range),{code:'INVALID_SNAPSHOT'});
});

test('snapshot capture applies access before fingerprinting and query parameters cannot widen that access',()=>{
  const db=fixture(),engine=application.create(),ctx={identity:'restricted-synthetic',readable:['vehicles','records']};
  db.payments=[{id:'private',date:'2026-10-01',sum:999999,description:'PRIVATE-SYNTHETIC-FINANCE'}];
  const snapshot=engine.capture(db,ctx),result=engine.querySnapshot('costs',snapshot,{...range,readable:['vehicles','records','payments']});
  assert.equal(JSON.stringify(result).includes('PRIVATE-SYNTHETIC-FINANCE'),false);assert.ok(result.unavailable.includes('payments'));
  db.payments[0].sum=1;assert.equal(engine.capture(db,ctx).sourceFingerprint,snapshot.sourceFingerprint);
  ctx.readable.push('payments');assert.equal(JSON.stringify(engine.querySnapshot('costs',snapshot,range)).includes('PRIVATE-SYNTHETIC-FINANCE'),false);
});

test('snapshot projection plans have a separate bounded LRU even when callers vary readable subsets',()=>{
  const engine=application.create({maxEntries:0}),snapshot=engine.capture(fixture(),context);
  for(let i=0;i<100;i++)engine.querySnapshot('fuel',snapshot,{...range,readable:['vehicles','records','synthetic-unused-'+i]});
  assert.equal(engine.stats().entries,0);assert.equal(engine.stats().projectionEvictions,68);
  const fingerprints=engine.stats().sourceFingerprints;engine.querySnapshot('fuel',snapshot,{...range,readable:['vehicles','records','synthetic-unused-99']});
  assert.equal(engine.stats().sourceFingerprints,fingerprints);assert.equal(engine.stats().projectionHits,1);
  engine.querySnapshot('fuel',snapshot,{...range,readable:['vehicles','records','synthetic-unused-0']});assert.equal(engine.stats().sourceFingerprints,fingerprints+1);
  // Oversized metadata is not retained, even with just one plan.
  const huge={...range,readable:['x'.repeat(65000)]},before=engine.stats().sourceFingerprints;engine.querySnapshot('fuel',snapshot,huge);engine.querySnapshot('fuel',snapshot,huge);
  assert.equal(engine.stats().sourceFingerprints,before+2);assert.equal(engine.stats().entries,0);
});

test('mutable queries still detect in-place edits and bounded eviction never exposes editable cached references',()=>{
  const db=fixture(),engine=application.create({maxEntries:1,maxCacheCharacters:8000000});
  const first=engine.query('fuel',db,range,context);db.records[0].fuelActual=2;const changed=engine.query('fuel',db,range,context);
  assert.notDeepEqual(changed,first);assert.equal(engine.stats().calculations,2);assert.equal(engine.stats().entries,1);assert.equal(engine.stats().evictions,1);
  engine.query('fuelRecords',db,{vehicleId:'perf-v-0'},context);assert.equal(engine.stats().entries,1);assert.equal(engine.stats().evictions,2);assert.ok(engine.stats().cachedCharacters<=8000000);
  engine.clear();assert.equal(engine.stats().entries,0);assert.equal(engine.stats().cachedCharacters,0);
});

test('writeoffPost prepares the exact portable document without posting or changing its input and rejects stale sources',()=>{
  const db=fixture(),before=JSON.stringify(db),engine=application.create(),parameters=postParameters(db);
  assert.equal(application.sections.writeoffPost,application.sections.writeoff);
  const document=engine.query('writeoffPost',db,parameters,context);assert.deepEqual(document,writeoff.post(db,parameters.request,parameters.metadata));assert.equal(document.status,'posted');assert.equal(JSON.stringify(db),before);assert.deepEqual(db.fuelWriteoffs,[]);
  document.number='Caller mutation';assert.equal(engine.query('writeoffPost',db,parameters,context).number,'SYNTHETIC-1');assert.equal(engine.stats().calculations,1);
  db.records[0].fuelActual=2;assert.throws(()=>engine.query('writeoffPost',db,parameters,context),{code:'STALE_SOURCES'});assert.deepEqual(db.fuelWriteoffs,[]);
});

test('worker endpoint cancels queued work and discards stale generation, identity and fingerprint requests',()=>{
  const f=handler(),loaded=f.load(),first=f.query(loaded,'cancel-me');f.endpoint.handle(first);f.endpoint.handle({type:'cancel',requestId:'cancel-me'});f.flush();
  assert.deepEqual(f.replies.filter(row=>row.requestId==='cancel-me').map(row=>row.error.code),['CANCELLED']);
  f.endpoint.handle(f.query(loaded,'old-generation'));const fresh=f.load(fixture(),2);f.flush();
  assert.deepEqual(f.replies.filter(row=>row.requestId==='old-generation').map(row=>row.error.code),['STALE_QUERY']);
  for(const patch of [{generation:1},{identity:'another-account'},{sourceFingerprint:'0'.repeat(64)}]){
    f.endpoint.handle({...f.query(fresh,'invalid-'+f.replies.length),...patch});assert.equal(f.replies.at(-1).error.code,'STALE_QUERY');
  }
  f.endpoint.handle({type:'load',requestId:'late-old-load',generation:1,database:fixture(),context});assert.equal(f.replies.at(-1).error.code,'STALE_QUERY');
  f.endpoint.handle(f.query(fresh,'current'));f.flush();assert.equal(f.replies.at(-1).ok,true);assert.equal(f.replies.at(-1).generation,2);
});

test('worker options are copied before scheduling, validated without lossy JSON coercion, and failures omit source content',()=>{
  const f=handler(),loaded=f.load(),options={vehicleId:'perf-v-0'},message=f.query(loaded,'owned-options','fuelRecords',options);
  f.endpoint.handle(message);options.vehicleId='perf-v-1';f.flush();assert.deepEqual(f.replies.at(-1).value,fuel.recordBalances(fixture(),'perf-v-0',{}));
  for(const bad of [NaN,Infinity,()=>1]){f.endpoint.handle(f.query(loaded,'bad-option-'+f.replies.length,'fuel',{...range,bad}));assert.equal(f.replies.at(-1).ok,false);assert.equal(f.replies.at(-1).error.code,'INVALID_SNAPSHOT');}
  let invoked=false;const getter={};Object.defineProperty(getter,'secret',{enumerable:true,get(){invoked=true;return 'PRIVATE-SOURCE';}});
  f.endpoint.handle(f.query(loaded,'getter-options','fuel',getter));assert.equal(invoked,false);assert.equal(f.replies.at(-1).ok,false);assert.equal(JSON.stringify(f.replies).includes('PRIVATE-SOURCE'),false);
  f.endpoint.handle({...f.query(loaded,'wrong-source'),sourceFingerprint:'PRIVATE-SOURCE'});assert.equal(JSON.stringify(f.replies.at(-1)).includes('PRIVATE-SOURCE'),false);
});

test('worker queue capacity and clear invalidate pending jobs without returning stale successful values',()=>{
  const f=handler(),loaded=f.load();for(let i=0;i<32;i++)f.endpoint.handle(f.query(loaded,'pending-'+i));
  f.endpoint.handle(f.query(loaded,'overflow'));assert.equal(f.replies.at(-1).error.code,'QUERY_LIMIT');assert.equal(f.endpoint.stats().pending,32);
  f.endpoint.handle({type:'clear',requestId:'clear',generation:2});f.flush();assert.equal(f.endpoint.stats().pending,0);
  assert.equal(f.replies.filter(row=>row.requestId.startsWith('pending-')&&row.ok).length,0);assert.equal(f.replies.filter(row=>row.requestId.startsWith('pending-')&&row.error.code==='STALE_QUERY').length,32);
  f.endpoint.close();const count=f.replies.length;f.endpoint.handle(f.query(loaded,'after-close'));assert.equal(f.replies.length,count);
});

test('real worker_threads execute the same five calculation services and preserve Sets, typed IDs and litres',async t=>{
  const send=thread(t),db=fixture(),engine=application.create();db.vehicles.push({id:7,plate:'SYNTHETIC NUMBER',fuelGrade:'ДТ',fuelBalance:923.537},{id:'8',plate:'SYNTHETIC STRING',fuelGrade:'ДТ',fuelBalance:1.001});
  db.costEntries=[{id:'cost',assetRef:'v:perf-v-0',date:'2026-10-01',kind:'expense',category:'Прочее',title:'Synthetic expense',amount:25000,independent:true}];
  const loaded=await send({type:'load',requestId:'thread-load',generation:1,database:db,context});assert.equal(loaded.ok,true);
  for(const [name,options]of [['fuel',range],['fuelRecords',{vehicleId:'perf-v-0'}],['writeoff',{month:'2026-10',date:'2026-10-31'}],['costs',range],['procurement',{date:'2026-10-31'}]]){
    const result=await send({type:'query',requestId:'thread-'+name,generation:1,identity:context.identity,sourceFingerprint:loaded.sourceFingerprint,name,options});
    assert.equal(result.ok,true,JSON.stringify(result.error));assert.deepEqual(result.value,engine.query(name,db,options,context));
    if(name==='fuel'){assert.ok(result.value.rows[0].cards instanceof Set);assert.equal(result.value.rows.find(row=>row.vehicleId===7).start,923.537);assert.equal(result.value.rows.find(row=>row.vehicleId==='8').start,1.001);}
  }
  const postDb=fixture(),postLoaded=await send({type:'load',requestId:'thread-post-load',generation:2,database:postDb,context}),parameters=postParameters(postDb,'thread-post-document');
  const document=await send({type:'query',requestId:'thread-writeoffPost',generation:2,identity:context.identity,sourceFingerprint:postLoaded.sourceFingerprint,name:'writeoffPost',options:parameters});
  assert.equal(document.ok,true,JSON.stringify(document.error));assert.deepEqual(document.value,writeoff.post(postDb,parameters.request,parameters.metadata));assert.deepEqual(postDb.fuelWriteoffs,[]);
  const stale=await send({type:'query',requestId:'thread-stale',generation:0,identity:context.identity,sourceFingerprint:loaded.sourceFingerprint,name:'fuel',options:range});assert.equal(stale.error.code,'STALE_QUERY');
});

test('heavy real worker calculation leaves the host timer runnable and repeats without recalculating its source',async t=>{
  const send=thread(t),db=fixture(10000),loaded=await send({type:'load',requestId:'heavy-load',generation:1,database:db,context});assert.equal(loaded.ok,true);
  const query={type:'query',generation:1,identity:context.identity,sourceFingerprint:loaded.sourceFingerprint,name:'fuel',options:range};
  let timerFired=false;const timer=new Promise(resolve=>setTimeout(()=>{timerFired=true;resolve();},0));const first=await send({...query,requestId:'heavy-first'});
  assert.equal(first.ok,true);assert.equal(timerFired,true);await timer;const repeat=await send({...query,requestId:'heavy-repeat'});
  assert.equal(repeat.ok,true);assert.deepEqual(repeat.value,first.value);assert.equal(repeat.stats.calculations,1);assert.equal(repeat.stats.hits,1);assert.equal(repeat.stats.sourceFingerprints,1);assert.ok(repeat.stats.cachedCharacters<=8000000);
});

test('browser UMD worker imports only the bundled pure core and matches financial and fuel oracles without DOM or network APIs',()=>{
  const replies=[],tasks=[],imports=[],directory=path.resolve(__dirname,'../assets/core');let sandbox;
  sandbox=vm.createContext({postMessage:message=>replies.push(structuredClone(message)),setTimeout:action=>tasks.push(action),importScripts(...files){
    for(const file of files){const absolute=path.resolve(directory,file);assert.ok(absolute.startsWith(path.resolve(__dirname,'../assets')+path.sep));imports.push(file);vm.runInContext(fs.readFileSync(absolute,'utf8'),sandbox,{filename:absolute});}
  }});
  vm.runInContext(fs.readFileSync(path.join(directory,'engine-worker.js'),'utf8'),sandbox,{filename:'engine-worker.js'});
  assert.deepEqual(imports,['./dispatcher-core.js','./accounting-boundary.js','./fuel-engine.js','./fuel-audit.js','./writeoff-engine.js','../js/45-cost-engine.js','../js/47-procurement-engine.js','./application-engine.js']);
  const db=fixture();db.repairs=[{id:'repair',vehicleId:'perf-v-0',date:'2026-10-01',status:'done',cost:10000}];db.workOrders=[{id:'order',repairId:'repair',vehicleId:'perf-v-0',date:'2026-10-01',status:'done',totalCost:10000}];
  db.payments=[{id:'manual',vehicleId:'perf-v-0',date:'2026-10-01',sum:1000,type:'expense',description:'Synthetic manual expense'}];
  sandbox.onmessage({data:{type:'load',requestId:'browser-load',generation:1,database:db,context}});const loaded=replies.at(-1);assert.equal(loaded.ok,true);
  for(const [name,options]of [['fuel',range],['fuelAudit',range],['costs',range],['writeoff',{month:'2026-10',date:'2026-10-31'}],['writeoffPost',postParameters(db,'browser-post-document')],['procurement',{date:'2026-10-31'}]]){
    sandbox.onmessage({data:{type:'query',requestId:'browser-'+name,generation:1,identity:context.identity,sourceFingerprint:loaded.sourceFingerprint,name,options}});while(tasks.length)tasks.shift()();
    assert.equal(replies.at(-1).ok,true,JSON.stringify(replies.at(-1).error));assert.deepEqual(replies.at(-1).value,application.create().query(name,db,options,context));
  }
  assert.equal(typeof sandbox.document,'undefined');assert.equal(typeof sandbox.fetch,'undefined');assert.equal(typeof sandbox.XMLHttpRequest,'undefined');
  assert.equal(writeoff.sha256('synthetic'),crypto.createHash('sha256').update('synthetic').digest('hex'));
});
