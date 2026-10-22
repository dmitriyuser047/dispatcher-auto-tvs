'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const source=fs.readFileSync(path.resolve(__dirname,'../electron/main.js'),'utf8'),tree=ts.createSourceFile('main.js',source,ts.ScriptTarget.ES2020,true,ts.ScriptKind.JS);
const names=['validPublicAccess','legacyPing','readonlyLegacyAccess','invalidateDataBinding','beginDataRead','assertDataRead','readRemoteSnapshot','freshDataCacheContext'];
const declarations=names.map(name=>tree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name)?.getText(tree));assert.ok(declarations.every(Boolean));
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
function harness(){const bindings=new Map(),event={sender:{id:7}},state={identity:'endpoint',pings:0,snapshots:0,bare:0,ping:{ok:true,sections:true,databaseToken:'db',access:access('a')},snapshot:{data:{vehicles:[],records:[]},databaseToken:'db',access:access('a'),revisions:{vehicles:1},platform:{apiVersion:1,commands:1,scopedAccess:1}}};
 const context={settings:{networkMode:'client',remoteHost:'synthetic',remotePort:3377},networkConfigError:'',settingsIdentity:()=>state.identity,getDataDir:()=>'/synthetic',storage:{SECTIONS:['vehicles','records'],databaseToken:()=> 'local-db'},dataBindings:bindings,dataReadGenerations:new Map(),notificationService:{invalidate(){}},bindData:(event,token,publicAccess,revisions,platform)=>bindings.set(event.sender.id,{identity:state.identity,databaseToken:token,notificationAccess:publicAccess,revisions,platform}),server:{getJson:async(host,port,url)=>{if(url==='/api/ping'){state.pings++;if(state.pingError)throw state.pingError;return structuredClone(state.ping);}state.snapshots++;if(state.snapshotError)throw state.snapshotError;return structuredClone(state.snapshot);},fetchData:async()=>{state.bare++;return JSON.stringify({vehicles:[{id:'legacy'}],records:[]});}}};
 vm.createContext(context);vm.runInContext(declarations.join('\n')+'\nglobalThis.read=async event=>(await readRemoteSnapshot(event)).snapshot;globalThis.fresh=freshDataCacheContext;',context);return {context,state,bindings,event};}
test('local cache context works with only dependencies visible at module scope',async()=>{
 const h=harness();h.context.settings.networkMode='local';const result=await h.context.fresh(h.event);
 assert.equal(result.mode,'local');assert.equal(result.databaseToken,'local-db');assert.equal(result.identity,'endpoint:local-db');assert.equal(h.state.pings,0);
});
test('fresh main-issued ping metadata replaces a changed binding and rejects caller/cached ACL authority',async()=>{
 const h=harness();await h.context.read(h.event);const before=h.bindings.get(7);await h.context.fresh(h.event);assert.equal(h.bindings.get(7),before);
 h.state.ping.access=access('b');const result=await h.context.fresh(h.event);assert.equal(result.policyStamp,access('b').policyStamp);assert.notEqual(h.bindings.get(7),before);assert.equal(h.bindings.get(7).notificationAccess.policyStamp,result.policyStamp);
 h.state.pingError=Object.assign(Error('HTTP 401'),{status:401});await assert.rejects(h.context.fresh(h.event),{code:'ACCESS_REVOKED'});assert.equal(h.bindings.has(7),false);
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
