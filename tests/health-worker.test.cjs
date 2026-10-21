'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {Worker}=require('node:worker_threads');
const workerApi=require('../assets/core/health-worker.js'),integrity=require('../assets/core/platform-integrity.js'),schema=require('../assets/core/platform-schema.js');
const coreDir=path.resolve(__dirname,'../assets/core'),fields=['code','severity','section','recordId','rowIndex','field','message','targetSection','targetId','relatedRecordId'];
function fixture(){return {...Object.fromEntries(schema.sections.map(name=>[name,[]])),vehicles:[{id:'health-v',plate:'SYNTHETIC',fuelGrade:'ДТ',fuelBalance:60,norm:10}],records:[{id:'health-r',vehicleId:'health-v',date:'2026-10-01',km:-1,fuelActual:1}],parts:[{id:'health-part',name:'Synthetic part'}],partMovements:[{id:'health-receipt',partId:'health-part',date:'2026-10-01',kind:'receipt',qty:100},{id:'health-issue',partId:'health-part',date:'2026-10-02',kind:'issue',qty:120}]};}
function request(extra={}){return {protocolVersion:1,type:'inspect',requestId:'health-request-1',sourceStamp:'health-source-1',context:{identity:'synthetic-A',readable:schema.sections.slice(),today:'2026-10-21'},source:fixture(),...extra};}
function publicReport(source,context){const report=integrity.inspect(source,context);return {counts:report.counts,sections:report.sections,issues:report.issues.map(issue=>Object.fromEntries(fields.filter(field=>issue[field]!=null&&['string','number'].includes(typeof issue[field])).map(field=>[field,issue[field]])))};}
function harness(){const posts=[],tasks=[],handler=workerApi.createHandler({postMessage:value=>posts.push(value),schedule:action=>tasks.push(action)});return {posts,tasks,handler,run(){assert.ok(tasks.length);tasks.shift()();}};}

test('health inspection is scheduled, read-only and matches the public synchronous diagnostics',()=>{
 const {handler,posts,run}=harness(),message=request(),before=structuredClone(message.source),expected=publicReport(message.source,message.context);
 assert.equal(handler.handle(message),true);assert.equal(handler.stats().pending,1);assert.equal(posts.length,0);run();assert.deepEqual(message.source,before);assert.equal(handler.stats().pending,0);
 assert.deepEqual(posts,[{protocolVersion:1,type:'result',requestId:message.requestId,sourceStamp:message.sourceStamp,identity:message.context.identity,ok:true,value:expected}]);
});

test('public diagnostics never return raw field values, private proof, deficits or source snapshots',()=>{
 const {handler,posts,run}=harness(),message=request();message.source.payments={secret:'SYNTHETIC-PRIVATE-FINANCIAL-PAYLOAD',amount:987654321};message.source.vehicles[0].privatePayload='SYNTHETIC-PRIVATE-CARD-DATA';
 handler.handle(message);run();assert.equal(posts[0].ok,true);assert.ok(posts[0].value.issues.some(issue=>issue.code==='invalid-section'));assert.ok(posts[0].value.issues.some(issue=>issue.code==='PART_STOCK_DEFICIT'));
 const text=JSON.stringify(posts);assert.doesNotMatch(text,/SYNTHETIC-PRIVATE|987654321|sourceSnapshot|"proof"|"deficit"/);assert.doesNotMatch(JSON.stringify(posts[0].value.issues),/"value"/);
 for(const issue of posts[0].value.issues)assert.ok(Object.keys(issue).every(field=>fields.includes(field)));
});

test('unreadable source sections are projected away before copying and cannot reveal hidden contents',()=>{
 const {handler,posts,run}=harness(),message=request();message.context.readable=['vehicles','records'];message.source.payments={secret:'SYNTHETIC-HIDDEN-PRIVATE',uncloneable:()=>{throw Error('Must not execute');}};message.source.parts=[{id:'SYNTHETIC-HIDDEN-PART'}];
 assert.equal(handler.handle(message),true);run();assert.equal(posts[0].ok,true);assert.doesNotMatch(JSON.stringify(posts),/SYNTHETIC-HIDDEN/);assert.equal(posts[0].value.sections.find(row=>row.section==='payments').rows,null);assert.equal(posts[0].value.sections.find(row=>row.section==='payments').readable,false);assert.ok(posts[0].value.issues.some(issue=>issue.code==='section-unavailable'));
});

test('damaged numeric and cyclic values remain inspectable rather than being normalized by JSON cloning',()=>{
 const {handler,posts,run}=harness(),message=request();message.source.records[0].km=Infinity;message.source.records[0].fuelActual=NaN;message.source.vehicles[0].legacyCycle={};message.source.vehicles[0].legacyCycle.self=message.source.vehicles[0].legacyCycle;
 const expected=publicReport(message.source,message.context);assert.equal(handler.handle(message),true);run();assert.equal(posts[0].ok,true);assert.deepEqual(posts[0].value,expected);assert.ok(posts[0].value.issues.some(issue=>issue.code==='invalid-json-number'));assert.ok(posts[0].value.issues.some(issue=>issue.code==='invalid-json-cycle'));
});

test('queued source/context mutations cannot change the captured identity, access or results',()=>{
 const {handler,posts,run}=harness(),message=request(),expected=publicReport(message.source,message.context);handler.handle(message);
 message.context.identity='synthetic-B';message.context.readable.length=0;message.context.today='2099-01-01';message.source.vehicles.length=0;message.source.records[0].km=123;message.requestId='changed';message.sourceStamp='changed';run();
 assert.equal(posts[0].identity,'synthetic-A');assert.equal(posts[0].requestId,'health-request-1');assert.equal(posts[0].sourceStamp,'health-source-1');assert.deepEqual(posts[0].value,expected);
});

test('the single pending job rejects overlap and a later job starts with its own context',()=>{
 const {handler,posts,run}=harness(),first=request(),second=request({requestId:'health-request-2',sourceStamp:'health-source-2',context:{identity:'synthetic-B',readable:['parts'],today:'2026-10-21'}});
 handler.handle(first);assert.equal(handler.handle(second),false);assert.equal(posts[0].error.code,'BUSY');assert.equal(posts[0].identity,'synthetic-B');run();assert.equal(posts[1].identity,'synthetic-A');assert.equal(posts[1].ok,true);
 assert.equal(handler.handle(second),true);run();assert.equal(posts[2].identity,'synthetic-B');assert.equal(posts[2].sourceStamp,'health-source-2');assert.equal(posts[2].value.sections.find(row=>row.section==='records').rows,null);
});

test('invalid protocol, bounded markers, access lists and dates fail without returning the submitted payload',()=>{
 const cases=[null,{...request(),protocolVersion:2},{...request(),type:'save'},{...request(),requestId:'<secret-invalid-id>'},{...request(),requestId:'x'.repeat(129)},{...request(),sourceStamp:'x'.repeat(129)},request({context:{identity:'x'.repeat(16385),today:'2026-10-21'}}),request({context:{identity:'A',today:'2026-02-30'}}),request({context:{identity:'A',today:'2026-10-21',readable:['unknown-secret-section']}})];
 for(const message of cases){const {handler,posts,tasks}=harness();assert.equal(handler.handle(message),false);assert.equal(posts.length,1);assert.equal(posts[0].ok,false);assert.ok(['INVALID_REQUEST','INVALID_CONTEXT'].includes(posts[0].error.code));assert.equal(tasks.length,0);assert.doesNotMatch(JSON.stringify(posts),/secret-invalid-id|unknown-secret-section|x{129}/);}
 const {handler,posts}=harness(),message=request();message.source.records[0].privateFunction=()=>{};assert.equal(handler.handle(message),false);assert.equal(posts[0].error.code,'INVALID_SOURCE');
 assert.throws(()=>workerApi.createHandler({}));assert.throws(()=>workerApi.createHandler({postMessage(){},schedule:7}));
});

test('inspection failures expose a generic error and never leak source data or internal stack traces',()=>{
 const {handler,posts,run}=harness(),message=request();message.source.drivers=[{id:'d',name:'SYNTHETIC-PRIVATE-EMPLOYEE'}];message.source.dispatchJobs=[{id:'bad-job',driverId:'d',assetRef:'v:health-v',start:'2026-10-22T08:00:00Z',end:712,status:'assigned'}];
 handler.handle(message);run();assert.equal(posts[0].ok,false);assert.equal(posts[0].error.code,'INSPECTION_FAILED');assert.doesNotMatch(JSON.stringify(posts),/SYNTHETIC-PRIVATE|personnel-engine|TypeError|\.slice/);assert.equal(handler.stats().pending,0);
});

test('closing an endpoint suppresses its queued result and accepts no further work',()=>{
 const {handler,posts,run}=harness();handler.handle(request());handler.close();run();assert.deepEqual(posts,[]);assert.equal(handler.stats().closed,true);assert.equal(handler.handle(request()),false);assert.equal(handler.stats().pending,0);
});

test('browser worker imports the same core dependency chain as index and matches CommonJS diagnostics',()=>{
 const posts=[],tasks=[],imports=[],context=vm.createContext({structuredClone,setTimeout:action=>tasks.push(action),postMessage:value=>posts.push(value)});
 context.importScripts=(...files)=>{for(const name of files){imports.push(name);vm.runInContext(fs.readFileSync(path.join(coreDir,name),'utf8'),context,{filename:name});}};
 vm.runInContext(fs.readFileSync(path.join(coreDir,'health-worker.js'),'utf8'),context,{filename:'health-worker.js'});
 const index=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8'),all=[...index.matchAll(/<script src="assets\/core\/([^"]+)"/g)].map(match=>match[1]),until=all.indexOf('platform-integrity.js');assert.deepEqual(imports,all.slice(0,until+1).map(name=>'./'+name));
 assert.equal(typeof context.onmessage,'function');const message=request();context.onmessage({data:message});assert.equal(posts.length,0);tasks.shift()();assert.equal(posts[0].ok,true);assert.deepEqual(JSON.parse(JSON.stringify(posts[0].value)),publicReport(message.source,message.context));
});

test('a real worker thread runs the same pure endpoint and returns no private diagnostic payload',async t=>{
 const file=path.join(coreDir,'health-worker.js'),worker=new Worker("const {parentPort}=require('node:worker_threads');const endpoint=require("+JSON.stringify(file)+").createHandler({postMessage:message=>parentPort.postMessage(message)});parentPort.on('message',message=>endpoint.handle(message));",{eval:true});t.after(()=>worker.terminate());
 const message=request(),result=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Synthetic health worker timed out')),10000);worker.once('error',error=>{clearTimeout(timer);reject(error);});worker.once('message',value=>{clearTimeout(timer);resolve(value);});});
 worker.postMessage(message);const response=await result;assert.equal(response.identity,'synthetic-A');assert.equal(response.requestId,message.requestId);assert.equal(response.sourceStamp,message.sourceStamp);assert.equal(response.ok,true);assert.deepEqual(response.value,publicReport(message.source,message.context));assert.doesNotMatch(JSON.stringify(response),/"proof"|"deficit"|"sourceSnapshot"/);
});
