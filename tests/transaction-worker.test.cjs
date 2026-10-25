'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{Worker}=require('node:worker_threads');
const api=require('../assets/core/transaction-worker.js'),kernel=require('../assets/core/platform-kernel.js'),schema=require('../assets/core/platform-schema.js');
const coreDir=path.resolve(__dirname,'../assets/core');
function fixture(){return {...Object.fromEntries(schema.sections.map(name=>[name,[]])),vehicles:[{id:7,plate:'SYNTHETIC NUMERIC',fuelGrade:'ДТ',fuelBalance:100,norm:10},{id:'7',plate:'SYNTHETIC STRING',fuelGrade:'ДТ',fuelBalance:20,norm:10}],records:[{id:'r',vehicleId:7,date:'2026-10-01',km:10,fuelActual:1}]};}
function context(extra={}){return {id:'synthetic-transaction',identity:'synthetic-A',actor:{id:'synthetic-actor',name:'Synthetic actor',role:'admin'},readable:schema.sections.slice(),writable:schema.sections.slice(),revisions:Object.fromEntries(schema.sections.map(name=>[name,3])),today:'2026-10-21',now:'2026-10-21T12:34:56.789Z',...extra};}
function request(extra={}){const previous=fixture(),next=structuredClone(previous);next.records[0].note='Synthetic note';return {protocolVersion:1,type:'prepare',requestId:'prepare-request-1',previous,next,context:context(),...extra};}
function harness(){const posts=[],tasks=[],handler=api.createHandler({postMessage:value=>posts.push(value),schedule:action=>tasks.push(action)});return {handler,posts,tasks,run(){assert.ok(tasks.length);tasks.shift()();}};}
function originalError(message){try{kernel.prepare(message.previous,message.next,message.context);assert.fail('Expected a strict kernel error');}catch(error){return {name:error.name,code:error.code,message:error.message,...(error.details!==undefined?{details:error.details}:{}),...(Array.isArray(error.issues||error.details?.issues)?{issues:error.issues||error.details.issues}:{}),...(typeof error.field==='string'?{field:error.field}:{}),...(typeof error.status==='number'?{status:error.status}:{})};}}

test('scheduled preparation returns the exact immutable plan with original id, actor, now and typed identities',()=>{
 const message=request(),previous=structuredClone(message.previous),next=structuredClone(message.next),expected=kernel.prepare(message.previous,message.next,message.context),{handler,posts,run}=harness();
 assert.equal(handler.handle(message),true);assert.equal(posts.length,0);assert.equal(handler.stats().pending,1);run();assert.equal(posts[0].ok,true);assert.deepEqual(posts[0].plan,expected);assert.ok(Object.isFrozen(posts[0].plan));assert.ok(Object.isFrozen(posts[0].plan.sections.records[0]));
 assert.equal(posts[0].plan.id,message.context.id);assert.equal(posts[0].plan.metadata.createdAt,message.context.now);assert.deepEqual(posts[0].plan.actor,message.context.actor);assert.equal(posts[0].plan.sections.records[0].vehicleId,7);assert.deepEqual(message.previous,previous);assert.deepEqual(message.next,next);
});

test('context and source mutations after scheduling cannot alter the captured transaction plan',()=>{
 const message=request(),expected=kernel.prepare(message.previous,message.next,message.context),{handler,posts,run}=harness();handler.handle(message);
 message.previous.records[0].km=999;message.next.records[0].note='Later mutation';message.context.id='later-id';message.context.identity='synthetic-B';message.context.actor.name='Later actor';message.context.now='2099-01-01T00:00:00Z';message.requestId='later-request';run();
 assert.deepEqual(posts[0].plan,expected);assert.equal(posts[0].requestId,'prepare-request-1');assert.equal(posts[0].identity,'synthetic-A');
});

test('strict validation errors retain original codes, messages, details and full structured issues',()=>{
 const cases=[];cases.push(request({context:context({writable:[]})}));cases.push(request({next:{records:{} }}));cases.push(request({next:{unknown:[]}}));cases.push(request({context:context({id:'bad id'})}));cases.push(request({context:context({now:'invalid'})}));cases.push(request({context:context({revisions:{records:-1}})}));
 const orphan=request();orphan.next.records[0].vehicleId='missing';cases.push(orphan);
 const nonfinite=request();nonfinite.next.records[0].km=NaN;cases.push(nonfinite);
 const cyclic=request();cyclic.next.records[0].loop=cyclic.next;cases.push(cyclic);
 const frozen=request();frozen.previous.shiftReports=[{id:'shift',date:'2026-10-01',assetRef:'v:7',driverId:'d',status:'accepted',acceptedBy:'Original actor'}];frozen.previous.drivers=[{id:'d',name:'Synthetic driver'}];frozen.next=structuredClone(frozen.previous);frozen.next.shiftReports[0].acceptedBy='Edited actor';cases.push(frozen);
 for(const message of cases){const expected=originalError(message),{handler,posts,run}=harness();handler.handle(message);run();assert.equal(posts[0].ok,false);assert.deepEqual(posts[0].error,expected);assert.equal(handler.stats().pending,0);}
});

test('direct non-cloneable inputs preserve strict kernel error ordering',()=>{
 for(const invalidContext of [false,true]){const message=request();message.next.records[0].uncloneable=()=>{};if(invalidContext)message.context.identity='';const expected=originalError(message),{handler,posts}=harness();assert.equal(handler.handle(message),false);assert.deepEqual(posts[0].error,expected);}
});

test('single-job protocol rejects malformed requests and concurrent work without losing the original job',()=>{
 const {handler,posts,run}=harness(),message=request();handler.handle(message);assert.equal(handler.handle(request({requestId:'second-request'})),false);assert.equal(posts[0].error.code,'PREPARE_BUSY');run();assert.equal(posts[1].ok,true);assert.equal(posts[1].requestId,'prepare-request-1');
 for(const bad of [null,{...request(),protocolVersion:2},{...request(),type:'save'},{...request(),requestId:'unsafe<request>'},{...request(),requestId:'x'.repeat(129)}]){const h=harness();assert.equal(h.handler.handle(bad),false);assert.equal(h.posts[0].error.code,'INVALID_REQUEST');assert.equal(h.tasks.length,0);assert.doesNotMatch(JSON.stringify(h.posts),/unsafe<request>|x{129}/);}
 assert.throws(()=>api.createHandler({}));assert.throws(()=>api.createHandler({postMessage(){},schedule:42}));
});

test('closing an endpoint cancels queued preparation without returning a plan or touching its source',()=>{
 const {handler,posts,run}=harness(),message=request(),original=structuredClone(message);handler.handle(message);handler.close();run();assert.deepEqual(posts,[]);assert.deepEqual(message,original);assert.equal(handler.stats().pending,0);assert.equal(handler.handle(request()),false);
});

test('section patches retain unchanged sources and do not manufacture accounting or audit rows',()=>{
 const previous=fixture(),message=request({previous,next:{records:[{...previous.records[0],note:'Section patch'}]}}),{handler,posts,run}=harness();handler.handle(message);run();const plan=posts[0].plan;
 assert.deepEqual(plan.changed,['records']);assert.deepEqual(Object.keys(plan.sections),['records']);assert.deepEqual(plan.sourceSnapshot.records,previous.records);assert.equal(plan.sections.records[0].fuelActual,1);assert.equal(plan.sections.records[0].km,10);assert.equal(plan.base.records,3);assert.equal(plan.rowChanges.length,1);
});

test('browser UMD imports the complete index core chain through platform-kernel with no DOM or storage',()=>{
 const posts=[],tasks=[],imports=[],sandbox={structuredClone,setTimeout:action=>tasks.push(action),postMessage:value=>posts.push(value)};
 for(const name of ['document','localStorage','electronAPI','fetch'])Object.defineProperty(sandbox,name,{get(){throw Error('Forbidden worker capability: '+name);}});
 const realm=vm.createContext(sandbox);realm.importScripts=(...names)=>{for(const name of names){imports.push(name);vm.runInContext(fs.readFileSync(path.join(coreDir,name),'utf8'),realm,{filename:name});}};
 vm.runInContext(fs.readFileSync(path.join(coreDir,'transaction-worker.js'),'utf8'),realm,{filename:'transaction-worker.js'});
 // This standalone renderer is intentionally absent from transaction workers.
 const all=[...fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8').matchAll(/<script src="assets\/core\/([^"]+)"/g)].map(match=>match[1]).filter(name=>!['generator-maintenance-print.js','generator-maintenance-spares.js'].includes(name)),until=all.indexOf('platform-kernel.js');assert.deepEqual(imports,all.slice(0,until+1).map(name=>'./'+name));
 const message=request();realm.onmessage({data:message});assert.equal(posts.length,0);tasks.shift()();assert.equal(posts[0].ok,true);assert.deepEqual(JSON.parse(JSON.stringify(posts[0].plan)),kernel.prepare(message.previous,message.next,message.context));
 assert.equal(realm.PersonnelTimesheet.apiVersion,1);assert.equal(realm.PersonnelTimesheetDocument.apiVersion,1);
 const doc=require('../assets/core/personnel-timesheet-document').makeRecord({version:1,kind:'operator',from:'2026-10-01',to:'2026-10-15',org:'Synthetic organization',title:'Synthetic worker timesheet',rows:[{id:'synthetic-row',name:'Synthetic employee',site:'North',days:{'2026-10-01':11}}]},{id:'synthetic-worker-timesheet',now:'2026-10-21T12:34:56.789Z'});
 const withTimesheet=request({requestId:'timesheet-worker-request',next:{assetDocuments:[doc]}});realm.onmessage({data:withTimesheet});tasks.shift()();assert.equal(posts[1].ok,true,JSON.stringify(posts[1].error));assert.deepEqual(JSON.parse(JSON.stringify(posts[1].plan)),kernel.prepare(withTimesheet.previous,withTimesheet.next,withTimesheet.context));
 const invalid=request({requestId:'invalid-timesheet-worker-request',next:{assetDocuments:[structuredClone(doc)]}});invalid.next.assetDocuments[0].personnelTimesheet.rows[0].days['2026-10-01']=-1;realm.onmessage({data:invalid});tasks.shift()();assert.equal(posts[2].ok,false);assert.equal(posts[2].error.code,'PERSONNEL_TIMESHEET_INVALID');
});

test('a real worker thread prepares the identical plan and returns original structured validation errors',async t=>{
 const worker=new Worker("const {parentPort}=require('node:worker_threads');const endpoint=require("+JSON.stringify(path.join(coreDir,'transaction-worker.js'))+").createHandler({postMessage:message=>parentPort.postMessage(message)});parentPort.on('message',message=>endpoint.handle(message));",{eval:true});t.after(()=>worker.terminate());
 const send=message=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Synthetic transaction worker timed out')),10000);worker.once('error',error=>{clearTimeout(timer);reject(error);});worker.once('message',reply=>{clearTimeout(timer);resolve(reply);});worker.postMessage(message);});
 const message=request(),reply=await send(message);assert.equal(reply.ok,true);assert.equal(reply.identity,message.context.identity);assert.deepEqual(reply.plan,kernel.prepare(message.previous,message.next,message.context));
 const bad=request({requestId:'bad-worker-request'});bad.next.records[0].vehicleId='missing';const failure=await send(bad);assert.equal(failure.ok,false);assert.deepEqual(failure.error,originalError(bad));assert.ok(failure.error.issues.length>0);
});
