'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const source=fs.readFileSync(path.resolve(__dirname,'../electron/main.js'),'utf8'),tree=ts.createSourceFile('main.js',source,ts.ScriptTarget.ES2020,true,ts.ScriptKind.JS);
const compatibility=require('../assets/core/platform-compatibility.js'),format=require('../electron/storage-format.cjs');
const names=['bindData','assertDataBinding','validPublicAccess','legacyPing','readonlyLegacyAccess','invalidateDataBinding','beginDataRead','assertDataRead','readRemoteSnapshot','freshDataCacheContext','invalidateWriteSession','mainWriteSessions','bindSnapshotCompatibility','capturedOperationContext','assertOperationContext'];
const declarations=names.map(name=>tree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name)?.getText(tree));assert.ok(declarations.every(Boolean));
const recovery=tree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='operationRecovery');let recoverySend;
const findRecoverySend=node=>{if(ts.isPropertyAssignment(node)&&node.name.getText(tree)==='send'&&ts.isArrowFunction(node.initializer))recoverySend=node.initializer.getText(tree);ts.forEachChild(node,findRecoverySend);};findRecoverySend(recovery);assert.ok(recoverySend);
test('module cache helpers cannot call dependencies declared only inside app startup',()=>{
 const moduleBindings=new Set(['Error','require','setTimeout','clearTimeout']);
 const add=name=>{if(ts.isIdentifier(name))moduleBindings.add(name.text);else if(ts.isObjectBindingPattern(name)||ts.isArrayBindingPattern(name))for(const item of name.elements)if(ts.isBindingElement(item))add(item.name);};
 for(const node of tree.statements){if(ts.isFunctionDeclaration(node)&&node.name)add(node.name);if(ts.isVariableStatement(node))for(const declaration of node.declarationList.declarations)add(declaration.name);}
 for(const name of names){const node=tree.statements.find(item=>ts.isFunctionDeclaration(item)&&item.name?.text===name),locals=new Set();
  const collect=item=>{if(ts.isVariableDeclaration(item)&&ts.isIdentifier(item.name))locals.add(item.name.text);if(ts.isParameter(item)&&ts.isIdentifier(item.name))locals.add(item.name.text);ts.forEachChild(item,collect);};collect(node);
  const check=item=>{if(ts.isCallExpression(item)&&ts.isIdentifier(item.expression))assert.ok(moduleBindings.has(item.expression.text)||locals.has(item.expression.text),name+' depends on an unavailable module binding: '+item.expression.text);ts.forEachChild(item,check);};check(node);
 }
});
const access=letter=>({user:{id:'account',role:'admin'},policyStamp:'sha256:'+letter.repeat(64),readable:['vehicles','records'],writable:['vehicles']});
function harness(){const bindings=new Map(),description=compatibility.describe(),state={identity:'endpoint',url:'http://127.0.0.1:3377/index.html',destroyed:false,pings:0,snapshots:0,negotiations:0,bare:0,posts:[],ping:{ok:true,sections:true,databaseToken:'db',access:access('a')},snapshot:{data:{vehicles:[],records:[]},databaseToken:'db',access:access('a'),revisions:{vehicles:1},platform:{apiVersion:1,operations:1,outbox:1,commands:1,scopedAccess:1,descriptor:format.describe(format.SCHEMA_VERSION),compatibility:description.serverProfile}}},event={sender:{id:7,mainFrame:{synthetic:true},isDestroyed:()=>state.destroyed,getURL:()=>state.url}};
 const context={settings:{networkMode:'client',remoteHost:'synthetic',remotePort:3377},networkConfigError:'',settingsIdentity:()=>state.identity,getDataDir:()=>'/synthetic',getActiveUser:()=>({name:'Synthetic'}),storage:{SECTIONS:['vehicles','records'],databaseToken:()=> 'local-db'},dataBindings:bindings,dataReadGenerations:new Map(),notificationService:{invalidate(){}},writeSessions:null,clientHello:description.hello,require:name=>{if(name==='node:crypto')return require(name);if(name==='./write-session.cjs')return require('../electron/write-session.cjs');if(name==='../assets/core/platform-compatibility.js')return compatibility;throw Error('Unexpected cache helper dependency '+name);},server:{getJson:async(host,port,url)=>{if(url==='/api/ping'){state.pings++;if(state.pingError)throw state.pingError;return structuredClone(state.ping);}state.snapshots++;if(state.snapshotError)throw state.snapshotError;return structuredClone(state.snapshot);},negotiate:async(host,port,hello)=>{state.negotiations++;if(state.negotiateHook)return state.negotiateHook(host,port,hello);return {ok:true,databaseToken:state.snapshot.databaseToken,access:structuredClone(state.snapshot.access),platform:structuredClone(state.snapshot.platform),writeTicket:'synthetic-private-main-ticket',writeTicketExpiresAt:Date.now()+60000};},localWriteOptions:()=>({requireNegotiatedWriter:true}),fetchData:async()=>{state.bare++;return JSON.stringify({vehicles:[{id:'legacy'}],records:[]});}}};
 const mainRequire=context.require;context.require=name=>name==='./storage-format.cjs'?format:mainRequire(name);
 context.server.postSections=async(...args)=>{state.posts.push(args);return {ok:true};};context.server.postCommands=context.server.postSections;
 vm.createContext(context);vm.runInContext(declarations.join('\n')+'\nglobalThis.read=async(event,hello=clientHello)=>(await readRemoteSnapshot(event,hello)).snapshot;globalThis.fresh=freshDataCacheContext;globalThis.sendRecovered=('+recoverySend+');',context);return {context,state,bindings,event};}
test('local cache context works with only dependencies visible at module scope',async()=>{
 const h=harness();h.context.settings.networkMode='local';const result=await h.context.fresh(h.event);
 assert.equal(result.mode,'local');assert.equal(result.databaseToken,'local-db');assert.equal(result.identity,'endpoint:local-db');assert.equal(h.state.pings,0);
});
test('fresh main-issued ping metadata replaces a changed binding and rejects caller/cached ACL authority',async()=>{
 const h=harness();await h.context.read(h.event);const before=h.bindings.get(7);await h.context.fresh(h.event);assert.equal(h.bindings.get(7),before);
 h.state.ping.access=access('b');const result=await h.context.fresh(h.event);assert.equal(result.policyStamp,access('b').policyStamp);assert.notEqual(h.bindings.get(7),before);assert.equal(h.bindings.get(7).notificationAccess.policyStamp,result.policyStamp);
 h.state.pingError=Object.assign(Error('HTTP 401'),{status:401});assert.deepEqual(JSON.parse(JSON.stringify(await h.context.fresh(h.event))),{version:1,unavailable:'ACCESS_REVOKED'});assert.equal(h.bindings.has(7),false);
});
test('local lock contention returns only the fixed IPC result and never converts other failures to busy',async()=>{
 const h=harness();h.context.settings.networkMode='local';h.context.storage.databaseToken=()=>{throw Object.assign(Error('SYNTHETIC private physical path'),{code:'DB_BUSY',path:'/synthetic/private'});};
 assert.deepEqual(JSON.parse(JSON.stringify(await h.context.fresh(h.event))),{version:1,unavailable:'DB_BUSY'});assert.equal(h.state.pings,0);assert.equal(h.bindings.size,0);
 for(const failure of [Object.assign(Error('DB_BUSY text is not an error code'),{code:'EACCES'}),Error('DB_BUSY')]){h.context.storage.databaseToken=()=>{throw failure;};await assert.rejects(h.context.fresh(h.event),error=>error===failure);}
});
test('local contention cannot mask a changed profile or a replaced caller',async()=>{
 for(const mutate of [h=>{h.state.identity='new-profile';},h=>{h.state.url='http://127.0.0.1/replaced.html';},h=>{h.event.sender.mainFrame={replacement:true};},h=>{h.state.destroyed=true;}]){
  const h=harness();h.context.settings.networkMode='local';h.context.storage.databaseToken=()=>{mutate(h);throw Object.assign(Error('busy'),{code:'DB_BUSY'});};await assert.rejects(h.context.fresh(h.event),{code:'SESSION_CHANGED'});
 }
});
test('remote revocation is a data-free IPC result after invalidating all prior write authority',async()=>{
 for(const status of [401,403]){const h=harness();await h.context.read(h.event);const captured=h.context.capturedOperationContext(h.event);h.state.pingError=Object.assign(Error('SYNTHETIC private server response'),{status});assert.deepEqual(JSON.parse(JSON.stringify(await h.context.fresh(h.event))),{version:1,unavailable:'ACCESS_REVOKED'});assert.equal(h.bindings.has(7),false);assert.throws(()=>h.context.mainWriteSessions().profile(captured),{code:'SESSION_CHANGED'});}
 const remoteBusy=harness();await remoteBusy.context.read(remoteBusy.event);remoteBusy.state.pingError=Object.assign(Error('remote busy'),{code:'DB_BUSY'});await assert.rejects(remoteBusy.context.fresh(remoteBusy.event),{code:'DB_BUSY'});assert.equal(remoteBusy.bindings.has(7),false);
});
test('a delayed revocation cannot clear a newer confirmed scope',async()=>{
 const h=harness();let reject;const original=h.context.server.getJson;h.context.server.getJson=async(host,port,url)=>url==='/api/ping'?new Promise((_resolve,fail)=>{reject=fail;}):original(host,port,url);const old=h.context.fresh(h.event);h.state.snapshot.access=access('b');await h.context.read(h.event);reject(Object.assign(Error('revoked former scope'),{status:403}));await assert.rejects(old,{code:'SESSION_CHANGED'});assert.equal(h.bindings.get(7).notificationAccess.policyStamp,access('b').policyStamp);
});
test('modern snapshot failures never downgrade to the stamp-less data endpoint',async()=>{
 for(const status of [401,403,408,500,0]){const h=harness();h.state.snapshotError=Object.assign(Error('failure'),{status});await assert.rejects(h.context.read(h.event));assert.equal(h.state.bare,0);assert.equal(h.bindings.has(7),false);}
 for(const status of [404,405]){const h=harness();h.state.snapshotError=Object.assign(Error('missing'),{status});await assert.rejects(h.context.read(h.event));assert.equal(h.state.bare,0);}
});
test('legacy fallback requires both explicit 404/405 and a fresh ping with no modern access support',async()=>{
 const h=harness();h.state.snapshotError=Object.assign(Error('missing'),{status:404});h.state.ping={ok:true,name:'Synthetic old server'};const result=await h.context.read(h.event);
 assert.equal(h.state.bare,1);assert.equal(result.readOnly,true);assert.equal(result.platform.legacyReadOnly,1);assert.equal(result.access.writable.length,0);assert.equal((await h.context.fresh(h.event)).legacy,true);
 const unproved=harness();unproved.state.ping={ok:true};await assert.rejects(unproved.context.fresh(unproved.event),{code:'ACCESS_UNVERIFIED'});assert.equal(unproved.state.bare,0);
});
test('a successful malformed modern envelope cannot assert readOnly to bypass fresh access validation',async()=>{
 const h=harness();h.state.snapshot={data:{vehicles:[{id:'PRIVATE'}],records:[]},readOnly:true,access:null};await assert.rejects(h.context.read(h.event),{code:'ACCESS_UNVERIFIED'});assert.equal(h.state.bare,0);assert.equal(h.bindings.has(7),false);
});
test('late snapshot A cannot roll back a newer ping B binding or invalidate its successful rights',async()=>{
 const h=harness();let release;const original=h.context.server.getJson;
 h.context.server.getJson=async(host,port,url)=>url==='/api/snapshot'?new Promise(resolve=>{release=()=>resolve(structuredClone(h.state.snapshot));}):original(host,port,url);
 const old=h.context.read(h.event);h.state.ping.access=access('b');await h.context.fresh(h.event);release();await assert.rejects(old,{code:'SESSION_CHANGED'});assert.equal(h.bindings.get(7).notificationAccess.policyStamp,access('b').policyStamp);
});
test('late ping A cannot overwrite a newer snapshot B binding',async()=>{
 const h=harness();let release;const original=h.context.server.getJson;
 h.context.server.getJson=async(host,port,url)=>url==='/api/ping'?new Promise(resolve=>{release=()=>resolve({ok:true,sections:true,databaseToken:'db',access:access('a')});}):original(host,port,url);
 const old=h.context.fresh(h.event);h.state.snapshot.access=access('b');await h.context.read(h.event);release();await assert.rejects(old,{code:'SESSION_CHANGED'});assert.equal(h.bindings.get(7).notificationAccess.policyStamp,access('b').policyStamp);
});

test('snapshot exposes only selected compatibility while the private proof is scoped to the current binding',async()=>{
 const h=harness(),snapshot=await h.context.read(h.event),captured=h.context.capturedOperationContext(h.event);assert.equal(snapshot.platform.negotiation.writeCompatible,true);assert.equal(snapshot.readOnly,false);assert.equal(JSON.stringify(snapshot).includes('synthetic-private-main-ticket'),false);assert.equal((await h.context.mainWriteSessions().remoteOptions(captured)).ticket,'synthetic-private-main-ticket');
 h.state.ping.access=access('b');await h.context.fresh(h.event);assert.throws(()=>h.context.mainWriteSessions().profile(captured),{code:'SESSION_CHANGED'});const current=h.context.capturedOperationContext(h.event);assert.equal(h.context.mainWriteSessions().profile(current),null);
});

test('a late negotiation cannot replace a newer ACL binding',async()=>{
 const h=harness();let release,started;const waiting=new Promise(resolve=>{started=resolve;});h.state.negotiateHook=()=>new Promise(resolve=>{release=resolve;started();});const old=h.context.read(h.event);await waiting;h.state.ping.access=access('b');await h.context.fresh(h.event);release({ok:true,databaseToken:'db',access:access('a'),platform:h.state.snapshot.platform,writeTicket:'synthetic-late-proof',writeTicketExpiresAt:Date.now()+60000});await assert.rejects(old,{code:'SESSION_CHANGED'});assert.equal(h.bindings.get(7).notificationAccess.policyStamp,access('b').policyStamp);
});

test('missing or unproved readers and future descriptors cannot return rows or retain an earlier write binding',async()=>{
 for(const kind of ['missing-hello','unknown-reader','future-descriptor','missing-descriptor']){const h=harness();await h.context.read(h.event);let hello=compatibility.describe().hello;if(kind==='missing-hello')hello=null;if(kind==='unknown-reader')hello={...hello,readerSchemaVersions:[format.SCHEMA_VERSION+1]};if(kind==='future-descriptor')h.state.snapshot.platform.descriptor={schemaVersion:format.SCHEMA_VERSION+1,minReader:format.SCHEMA_VERSION+1,minWriter:format.SCHEMA_VERSION+1,features:[]};if(kind==='missing-descriptor')h.state.snapshot.platform.descriptor=null;h.state.snapshot.data.vehicles=[{id:'SYNTHETIC-PRIVATE-ROWS'}];let rows;await assert.rejects(async()=>{rows=await h.context.read(h.event,hello);},{code:'READ_COMPATIBILITY_REQUIRED'});assert.equal(rows,undefined,kind);assert.equal(h.bindings.has(7),false,kind);assert.equal(h.state.bare,0,kind);}
 const legacy=harness();legacy.state.snapshotError=Object.assign(Error('missing'),{status:404});legacy.state.ping={ok:true,name:'Synthetic old server'};let rows;await assert.rejects(async()=>{rows=await legacy.context.read(legacy.event,null);},{code:'READ_COMPATIBILITY_REQUIRED'});assert.equal(rows,undefined);assert.equal(legacy.bindings.has(7),false);
});

test('a proven readable client missing writer support receives only an explicit read-only snapshot',async()=>{
 const h=harness(),hello={...compatibility.describe().hello,writerSchemaVersions:[]},snapshot=await h.context.read(h.event,hello);assert.equal(snapshot.platform.negotiation.readCompatible,true);assert.equal(snapshot.platform.negotiation.writeCompatible,false);assert.equal(snapshot.readOnly,true);assert.equal(JSON.stringify(snapshot).includes('synthetic-private-main-ticket'),false);assert.deepEqual(Object.keys(await h.context.mainWriteSessions().remoteOptions(h.context.capturedOperationContext(h.event))),[]);
});

test('a replaced frame, navigated URL or destroyed sender during snapshot or negotiation cannot receive rows or a binding',async()=>{
 for(const phase of ['snapshot','negotiation'])for(const mutate of [h=>{h.event.sender.mainFrame={synthetic:true,replaced:true};},h=>{h.state.url='http://127.0.0.1:3377/replaced.html';},h=>{h.state.destroyed=true;}]){const h=harness();let release,started;const waiting=new Promise(resolve=>{started=resolve;});const response=()=>({ok:true,databaseToken:'db',access:access('a'),platform:h.state.snapshot.platform,writeTicket:'synthetic-late-proof',writeTicketExpiresAt:Date.now()+60000});if(phase==='snapshot')h.context.server.getJson=()=>new Promise(resolve=>{release=()=>resolve(structuredClone(h.state.snapshot));started();});else h.state.negotiateHook=()=>new Promise(resolve=>{release=()=>resolve(response());started();});let rows;const pending=h.context.read(h.event).then(value=>{rows=value;});await waiting;mutate(h);release();await assert.rejects(pending,{code:'SESSION_CHANGED'});assert.equal(rows,undefined,phase);assert.equal(h.bindings.has(7),false,phase);assert.equal(h.state.posts.length,0);}
});

test('actual recovery send refuses the old frame after awaiting renewal before commands or sections leave main',async()=>{
 for(const command of [false,true])for(const mutate of [h=>{h.event.sender.mainFrame={synthetic:true,replaced:true};},h=>{h.state.url='http://127.0.0.1:3377/replaced.html';},h=>{h.state.destroyed=true;}]){const h=harness();await h.context.read(h.event);const captured=h.context.capturedOperationContext(h.event),response={ok:true,databaseToken:'db',access:access('a'),platform:h.state.snapshot.platform,writeTicket:'synthetic-renewed-proof',writeTicketExpiresAt:Date.now()+60000};h.context.mainWriteSessions().bind(captured,compatibility.describe().hello,{...response,writeTicketExpiresAt:0});let release,started;const waiting=new Promise(resolve=>{started=resolve;});h.state.negotiateHook=()=>new Promise(resolve=>{release=resolve;started();});const raw=JSON.stringify({databaseToken:'db',operation:{id:'synthetic-original'},...(command?{command:{type:'synthetic'}}:{sections:{vehicles:[]}})}),pending=h.context.sendRecovered(captured,raw);await waiting;mutate(h);release(response);await assert.rejects(pending,{code:'SESSION_CHANGED'});assert.equal(h.state.posts.length,0);}
});

test('an authenticated busy ping retains the exact existing binding and write ticket only with unchanged current grants',async()=>{
 const h=harness();await h.context.read(h.event);const before=h.bindings.get(7);
 h.state.pingError=Object.assign(Error('Synthetic busy writer'),{code:'DB_BUSY',status:503,publicAccess:structuredClone(h.state.ping.access)});
 assert.deepEqual(JSON.parse(JSON.stringify(await h.context.fresh(h.event))),{version:1,unavailable:'DB_BUSY'});assert.equal(h.bindings.get(7),before);
 for(const patch of [{publicAccess:access('b')},{publicAccess:undefined},{status:500}]){
  const other=harness();await other.context.read(other.event);other.state.pingError=Object.assign(Error('Synthetic busy writer'),{code:'DB_BUSY',status:503,publicAccess:structuredClone(other.state.ping.access)},patch);
  await assert.rejects(other.context.fresh(other.event));assert.equal(other.bindings.has(7),false);
 }
});
