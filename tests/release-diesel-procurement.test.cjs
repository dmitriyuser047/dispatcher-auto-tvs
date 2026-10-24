'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const forecast=require('../assets/js/47-procurement-engine.js');
const fuelStock=require('../assets/core/fuel-stock.js');
const policy=require('../assets/core/fuel-movement-policy.js');
const procurement=require('../assets/core/procurement-operations.js');
const documents=require('../assets/core/document-engine.js');
const schema=require('../assets/core/platform-schema.js');
const date='2026-09-10';
const actor={id:'release-audit',name:'Synthetic release audit',role:'admin'};
const ctx=id=>({id,now:'2026-10-24T12:00:00.000Z',today:'2026-10-24',actor});
const params=norm=>({power:100,norm,norm100:null,norm50:null,normIdle:null});
const periods=(...entries)=>({version:1,periods:entries.map(([from,norm],index)=>({id:'period-'+index,from,basis:'Synthetic approved dated norm',parameters:params(norm)}))});
const fixture=patch=>({...Object.fromEntries(schema.sections.map(name=>[name,[]])),tanks:[{id:0,name:'Numeric tank',fuel:'diesel',balanceInit:0},{id:'0',name:'Text tank',fuel:'diesel',balanceInit:0}],generators:[{id:'g',fuel:'diesel',tankId:0,fuelBalance:0,norm:2}],...patch});
const plan=(db,at=date,id=0)=>forecast.plan(db,{date:at}).find(row=>row.kind==='tank'&&row.itemId===id);
const stock=(db,id=0,at=date)=>fuelStock.balanceAt(db,{section:'tanks',id},at);
function plannedJob(db,start=date,end=start,hours=2){db.dispatchJobs=[{id:'synthetic-job',assetRef:'g:g',status:'assigned',plannedHours:hours,start:start+'T08:00',end:end+'T16:00'}];db.procurementRules=[{id:'synthetic-rule',kind:'tank',itemId:0,leadDays:0,coverDays:1,reserveQty:0,expectedDaily:0}];return db;}
function executeOrder(db,input,id){const request={reason:'Synthetic reviewed procurement action',...input},review=procurement.preview(db,request,{today:ctx(id).today});assert.equal(review.canApply,true,JSON.stringify(review.issues));return {...db,...procurement.plan(db,{...request,reviewFingerprint:review.fingerprint},ctx(id)).sections};}

test('physical fuel conservation uses receipts and issues once, separately from generator consumption and typed tank IDs',()=>{
 const db=fixture({tanks:[{id:0,fuel:'diesel',balanceInit:100.001},{id:'0',fuel:'diesel',balanceInit:20}],tankIncomes:[{id:'income',tankId:0,date,amount:.002}],genRecords:[{id:'legacy',generatorId:'g',date,fuelIssued:5,load:100,hours:10,fuelActual:100},{id:'linked',generatorId:'g',tankId:null,date,fuelIssued:3,load:100,hours:5,fuelActual:50}],fuelMovements:[{id:'linked-issue',kind:'issue',fromTankId:0,qty:3,date,assetRef:'g:g'},{id:'transfer',kind:'transfer',fromTankId:0,toTankId:'0',qty:7,date},{id:'return',kind:'return',toTankId:0,qty:1,date}]});
 const before=JSON.stringify(db),projection=fuelStock.project(db,{to:date});
 assert.equal(fuelStock.at(projection,{section:'tanks',id:0},date).balanceDecimal,'86.003');
 assert.equal(fuelStock.at(projection,{section:'tanks',id:'0'},date).balanceDecimal,'27');
 assert.equal(stock(db).balance+stock(db,'0').balance,113.003);
 assert.equal(forecast.usage(db,'tank',0,date).total,8);
 assert.equal(forecast.usage(db,'tank','0',date).total,0);
 assert.equal(JSON.stringify(db),before);
});

test('tank opening boundary, future invalid amounts and neutral measurements cannot leak into an earlier stock day',()=>{
 const db=fixture({tanks:[{id:0,fuel:'diesel',fuelAccounting:{version:1,from:date,opening:10.001,basis:'Synthetic actual opening'}}],tankIncomes:[{id:'before',tankId:0,date:'2026-09-09',amount:100},{id:'today',tankId:0,date,amount:.002},{id:'future-invalid',tankId:0,date:'2026-09-11',amount:'unknown'}],fuelMovements:[{id:'measure',kind:'measurement',date,qty:0,measurement:{version:1,target:{section:'tanks',id:0},observedQty:500}}]});
 const before=JSON.stringify(db),projection=fuelStock.project(db);
 assert.equal(fuelStock.at(projection,{section:'tanks',id:0},date,{inclusive:false}).balance,10.001);
 assert.equal(fuelStock.at(projection,{section:'tanks',id:0},date).balance,10.003);
 assert.equal(stock(db,0,'2026-09-09').status,'outside-accounting');
 assert.equal(stock(db,0,'2026-09-11').balance,null);
 assert.equal(plan(db).stock,10.003);
 assert.equal(JSON.stringify(db),before);
});

test('generator load is kW divided by dated rated kW and hourly consumption is multiplied by hours exactly once',()=>{
 const generator={power:999,norm100:999,fuelNorms:{version:1,periods:[{id:'sep',from:'2026-09-01',basis:'Synthetic dated curve',parameters:{power:200,norm:null,norm100:20,norm50:12,normIdle:2}},{id:'oct',from:'2026-10-01',basis:'Synthetic replacement curve',parameters:{power:100,norm:null,norm100:30,norm50:20,normIdle:4}}]}};
 const before=JSON.stringify(generator);
 for(const [load,expected] of [[0,4],[50,14],[100,24],[150,32],[200,40]])assert.equal(policy.generatorSpent(generator,{date,hours:2,load}),expected);
 assert.equal(policy.generatorSpent(generator,{date:'2026-10-01',hours:2,load:100}),60);
 assert.equal(policy.generatorNormSpent(generator,{date,hours:2}),40);
 assert.equal(policy.generatorSpent(generator,{date:'2026-08-31',hours:2,load:100}),null);
 assert.equal(policy.generatorSpent(generator,{date:'2026-08-31',hours:2,load:100,fuelActual:0}),0);
 assert.equal(policy.generatorNormSpent(generator,{date:'2026-08-31',hours:2,fuelUsed:0}),0);
 assert.equal(policy.generatorSpent(generator,{date,hours:0,fuelMovementId:0}),0);
 assert.equal(JSON.stringify(generator),before);
});

test('two partial actual receipts and a partial supplier return conserve physical stock and outstanding order coverage by date',()=>{
 let db=executeOrder(fixture(),{action:'saveOrder',payload:{kind:'tank',itemId:0,supplier:'Synthetic supplier',quantity:100,deliveryDate:date,status:'ordered',note:''}},'order');
 db.tankIncomes=[{id:'first',tankId:0,date:'2026-09-02',amount:30,procurementReceipt:{version:1,orderId:'order'}},{id:'second',tankId:0,date:'2026-09-03',amount:20,procurementReceipt:{version:1,orderId:'order'}}];
 const raw=JSON.stringify(db.tankIncomes);
 db=executeOrder(db,{action:'supplierReturn',kind:'tank',orderId:'order',receipt:{section:'tankIncomes',id:'first'},qty:5,date:'2026-09-04'},'supplier-return');
 for(const [at,expectedStock,expectedRemaining] of [['2026-09-01',0,100],['2026-09-02',30,70],['2026-09-03',50,50],['2026-09-04',45,55]]){
  const row=plan(db,at),fulfillment=procurement.project(db,{kind:'tank',through:at}).rows[0];
  assert.equal(row.stock,expectedStock);assert.equal(row.undelivered,expectedRemaining);assert.equal(row.pendingPosting,0);assert.equal(row.stock+row.undelivered,100);assert.equal(fulfillment.netReceivedQty,expectedStock);
 }
 assert.equal(forecast.usage(db,'tank',0,date).total,0);
 const input={action:'reverse',section:'fuelMovements',id:'supplier-return',reason:'Synthetic actual return was reversed'},review=documents.preview(db,input,{today:ctx('inverse').today});
 assert.equal(review.canPost,true,JSON.stringify(review.issues));
 db={...db,...documents.plan(db,{...input,reviewFingerprint:review.fingerprint},ctx('inverse')).sections};
 assert.equal(plan(db).stock,50);assert.equal(plan(db).undelivered,50);
 assert.equal(JSON.stringify(db.tankIncomes),raw);
});

for(const [at,expected] of [['2026-09-10',20],['2026-10-10',40]])test('procurement generator demand resolves the flat hourly norm effective on '+at,()=>{
 const db=plannedJob(fixture(),at);db.generators[0].fuelNorms=periods(['2026-09-01',10],['2026-10-01',20]);
 const before=JSON.stringify(db),row=plan(db,at);
 assert.equal(policy.generatorNormSpent(db.generators[0],{date:at,hours:2}),expected);
 assert.equal(row.demand,expected);assert.equal(row.suggestedQty,expected);assert.equal(row.knownJobs,1);assert.equal(row.unknownJobs,0);assert.equal(JSON.stringify(db),before);
});

test('procurement cannot borrow a present scalar norm before the first explicit generator period',()=>{
 const at='2026-08-31',db=plannedJob(fixture(),at);db.generators[0].fuelNorms=periods(['2026-09-01',10]);
 const before=JSON.stringify(db),row=plan(db,at);
 assert.equal(policy.generatorNormSpent(db.generators[0],{date:at,hours:2}),null);
 assert.equal(row.knownJobs,0);assert.equal(row.unknownJobs,1);assert.equal(row.demand,0);assert.ok(row.warnings.some(message=>/норм|час/.test(message)));assert.equal(JSON.stringify(db),before);
});

test('dated multi-day demand spreads the whole planned hours and switches rate on the work day without concentrating elapsed hours',()=>{
 const db=plannedJob(fixture(),'2026-09-30','2026-10-01',4);db.generators[0].fuelNorms=periods(['2026-09-01',10],['2026-10-01',20]);db.procurementRules[0].coverDays=2;
 assert.equal(plan(db,'2026-09-30').demand,60);
 db.procurementRules[0].coverDays=1;
 assert.equal(plan(db,'2026-10-01').demand,40);
 db.generators[0].norm=999;
 assert.equal(plan(db,'2026-10-01').demand,40);
});

test('dated zero remains known, missing flat norms remain unknown and actual fields cannot invent planned load or planned hours',()=>{
 const db=plannedJob(fixture());db.generators[0].fuelNorms=periods(['2026-09-01',0]);
 assert.equal(plan(db).demand,0);assert.equal(plan(db).knownJobs,1);assert.equal(plan(db).unknownJobs,0);
 Object.assign(db.generators[0].fuelNorms.periods[0].parameters,{norm:null,norm100:20,norm50:12,normIdle:2});
 assert.equal(plan(db).knownJobs,0);assert.equal(plan(db).unknownJobs,1);
 db.generators[0].fuelNorms.periods[0].parameters.norm=10;
 delete db.dispatchJobs[0].plannedHours;db.dispatchJobs[0].actualHours=2;
 assert.equal(plan(db).knownJobs,0);assert.equal(plan(db).unknownJobs,1);
 delete db.generators[0].fuelNorms;db.dispatchJobs[0].plannedHours=2;
 assert.equal(plan(db).demand,4);assert.equal(plan(db).knownJobs,1);
});

test('actual browser worker imports dated norm dependency and returns the same procurement forecast as Node without DOM, network or writes',()=>{
 const db=plannedJob(fixture());db.generators[0].fuelNorms=periods(['2026-09-01',10],['2026-10-01',20]);
 const before=JSON.stringify(db),directory=path.resolve(__dirname,'../assets/core'),imports=[],replies=[],tasks=[];
 let sandbox;sandbox=vm.createContext({postMessage:reply=>replies.push(structuredClone(reply)),setTimeout:task=>tasks.push(task),importScripts(...files){for(const file of files){const absolute=path.resolve(directory,file);assert.ok(absolute.startsWith(path.resolve(__dirname,'../assets')+path.sep));imports.push(file);vm.runInContext(fs.readFileSync(absolute,'utf8'),sandbox,{filename:absolute});}}});
 vm.runInContext(fs.readFileSync(path.join(directory,'engine-worker.js'),'utf8'),sandbox,{filename:'engine-worker.js'});
 assert.ok(imports.indexOf('./effective-periods.js')>=0&&imports.indexOf('./effective-periods.js')<imports.indexOf('../js/47-procurement-engine.js'));
 const context={identity:'synthetic-release-procurement'},generation=1;
 sandbox.onmessage({data:{type:'load',requestId:'release-load',generation,database:db,context}});
 const loaded=replies.at(-1);assert.equal(loaded.ok,true,JSON.stringify(loaded.error));
 sandbox.onmessage({data:{type:'query',requestId:'release-procurement',generation,identity:context.identity,sourceFingerprint:loaded.sourceFingerprint,name:'procurement',options:{date}}});
 while(tasks.length)tasks.shift()();
 const reply=replies.at(-1);assert.equal(reply.ok,true,JSON.stringify(reply.error));assert.deepEqual(reply.value,forecast.plan(db,{date}));assert.equal(reply.value.find(row=>row.itemId===0).demand,20);
 assert.equal(typeof sandbox.document,'undefined');assert.equal(typeof sandbox.fetch,'undefined');assert.equal(JSON.stringify(db),before);
});
