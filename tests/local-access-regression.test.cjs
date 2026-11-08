'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const ROOT=process.env.TVS_SOURCE_ROOT||path.resolve(__dirname,'..');
const appRequire=createRequire(path.join(ROOT,'electron/main.js'));
const ts=require('typescript');
const server=appRequire('./server.js'),storage=appRequire('./storage.js');
const compatibility=appRequire('../assets/core/platform-compatibility.js');
const format=appRequire('./storage-format.cjs');
const productProfiles=appRequire('./product-profile.cjs');
const json=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const source=fs.readFileSync(process.env.TVS_MAIN_SOURCE||path.join(ROOT,'electron/main.js'),'utf8');
const tree=ts.createSourceFile('main.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
function declaration(name,parsed=tree){let found;function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text===name)found=node;ts.forEachChild(node,visit);}visit(parsed);assert.ok(found,'Missing actual function '+name);return found.getText(parsed);}
function handler(channel){let found;function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(tree)==='ipcMain.handle'&&ts.isStringLiteral(node.arguments[0])&&node.arguments[0].text===channel)found=node.arguments[1];ts.forEachChild(node,visit);}visit(tree);assert.ok(found,'Missing actual IPC '+channel);return found.getText(tree);}
const names=['localPrincipal','assertObjectSnapshot','bindData','assertDataBinding','validPublicAccess','legacyPing','readonlyLegacyAccess','invalidateDataBinding','beginDataRead','assertDataRead','readRemoteSnapshot','freshDataCacheContext','invalidateWriteSession','mainWriteSessions','bindSnapshotCompatibility','capturedOperationContext','assertOperationContext','isClientMode'];
const declarations=names.map(name=>declaration(name)).join('\n');
function harness({kind='dispatcher',remote=false,configured=true}={}){
  const directory=path.resolve(__dirname,'SYNTHETIC-NO-DATABASE');
  const description=compatibility.describe(),bindings=new Map();
  const status={installation:{installationId:'synthetic-object'},configuredScope:{org:'Synthetic org',site:'Synthetic site'},localDataDir:configured?directory:null,localDatabaseToken:'synthetic-db'};
  const database=Object.fromEntries(storage.SECTIONS.map(name=>[name,[]]));
  database.vehicles=[{id:'synthetic-car',plate:'SYNTHETIC'}];
  const snapshot={data:database,databaseToken:'synthetic-db',revisions:Object.fromEntries(storage.SECTIONS.map(name=>[name,1])),platform:{apiVersion:1,operations:1,outbox:1,commands:1,scopedAccess:1,descriptor:format.describe(format.SCHEMA_VERSION),compatibility:description.serverProfile}};
  const remotePrincipal={id:'synthetic-remote-viewer',name:'Synthetic remote viewer',role:'viewer'};
  const remoteAccess=server.publicAccess(remotePrincipal);
  const state={status,snapshot,remoteAccess,reads:[],remoteCalls:[],errors:[],identity:'synthetic-endpoint',url:'file:///synthetic/index.html'};
  const event={sender:{id:7,mainFrame:{synthetic:true},isDestroyed:()=>false,getURL:()=>state.url}};
  const context={
    path,Error,JSON,Object,Array,Map,Date,setTimeout,clearTimeout,
    product:productProfiles.describeProduct(kind==='des-object'?{name:'dispatcher-des-object',tvsProductProfile:'des-object'}:appRequire('../package.json')),
    settings:{networkMode:remote?'client':'local',remoteHost:remote?'synthetic-server':'',remotePort:3377,activeUser:1},networkConfigError:'',
    settingsIdentity:()=>state.identity,getDataDir:()=>directory,getActiveUser:()=>({name:'Synthetic active local profile'}),
    desObjectService:()=>({status:()=>state.status}),
    storage:{SECTIONS:storage.SECTIONS,databaseToken:()=>snapshot.databaseToken,readSnapshot:(dir,options)=>{state.reads.push({dir,options:json(options)});return structuredClone(snapshot);}},
    localStorageExecutor:()=>({run:async(method,dir,input,options,hooks)=>{assert.equal(method,'readSnapshot');hooks.assertCurrent();state.reads.push({dir,options:json(options)});return structuredClone(snapshot);}}),
    dataBindings:bindings,dataReadGenerations:new Map(),notificationService:{invalidate(){}},writeSessions:null,
    require:appRequire,
    console:{error:message=>state.errors.push(message),warn(){},log(){}},
    server:{publicAccess:server.publicAccess,localWriteOptions:server.localWriteOptions,
      getJson:async(host,port,route)=>{state.remoteCalls.push(route);if(state.remoteError)throw state.remoteError;if(route==='/api/ping')return {ok:true,sections:true,databaseToken:snapshot.databaseToken,access:json(state.remoteAccess)};return {...structuredClone(snapshot),access:json(state.remoteAccess)};},
      negotiate:async()=>{state.remoteCalls.push('negotiate');return {ok:true,databaseToken:snapshot.databaseToken,access:json(state.remoteAccess),platform:json(snapshot.platform),writeTicket:'synthetic-main-only-ticket',writeTicketExpiresAt:Date.now()+60000};},
      fetchData:async()=>{state.remoteCalls.push('FORBIDDEN-BAREROWS');throw Error('Unverified fallback is forbidden');}
    }
  };
  vm.createContext(context);
  vm.runInContext(declarations+'\nglobalThis.readDataIPC=('+handler('read-data')+');globalThis.readSnapshotIPC=('+handler('read-snapshot')+');',context,{filename:'actual-main-access.cjs'});
  return {context,state,event,bindings,hello:description.hello,expected:()=>server.publicAccess(context.localPrincipal())};
}
async function observeReadDataBoundary(h){
  // Legacy read-data has no hello. Observe the ACL passed to its actual
  // compatibility boundary without inventing a negotiated writer for that API.
  let observed=null;
  h.context.bindSnapshotCompatibility=(event,snapshot,hello)=>{observed={access:json(snapshot.access),hello};};
  const result=await h.context.readDataIPC(h.event);
  assert.ok(result,'Synthetic legacy reader must reach the compatibility boundary');
  assert.ok(observed,'The actual IPC must call its binding boundary');
  assert.equal(observed.hello,null);
  return observed.access;
}
async function rendererState(raw){
  const syncSource=fs.readFileSync(path.join(ROOT,'assets/js/25f-sync.js'),'utf8');
  const syncTree=ts.createSourceFile('25f-sync.js',syncSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const context={JSON,Object,Array,Error,PlatformCompatibility:compatibility,SYNC_SECTIONS:storage.SECTIONS,_sync:{},_loadWriteBlocked:false,
    window:{tvsWeb:{},electronAPI:{readSnapshot:async()=>raw},addEventListener(){}},document:{addEventListener(){}},
    syncCompatibilityNotice(){},syncMarkLoaded(names){context._sync.loadedSections=names;},RegistryImport:appRequire('../assets/core/registry-import.js'),htmlEsc:String};
  vm.createContext(context);vm.runInContext(declaration('syncLoad',syncTree),context);
  context.data=await context.syncLoad();
  const registrySource=fs.readFileSync(path.join(ROOT,'web/public/registries.js'),'utf8');
  assert.ok(registrySource.includes('web.registries={render};'));
  vm.runInContext(registrySource.replace('web.registries={render};','web.registries={render,canWrite,writeBlockReason};'),context);
  return {context,registry:context.window.tvsWeb.registries};
}

test('ordinary local cache context publishes the real active-profile ACL',async()=>{
  const h=harness(),actual=await h.context.freshDataCacheContext(h.event);
  assert.ok(actual.access,'Local cache is missing the authoritative active-profile ACL');
  assert.deepEqual(json(actual.access),json(h.expected()));
  assert.equal(actual.policyStamp,h.expected().policyStamp);
  assert.equal(actual.access.user.id,'local-profile');assert.equal(actual.access.user.name,'Synthetic active local profile');
  assert.ok(actual.access.writable.includes('savedReestrs'));
  assert.equal(h.state.remoteCalls.length,0);
});
test('ordinary local legacy read-data passes the real profile ACL to binding',async()=>{
  const h=harness(),access=await observeReadDataBoundary(h);
  assert.ok(access,'Local read-data supplied no authoritative ACL to its binding');
  assert.deepEqual(access,json(h.expected()));
  assert.ok(access.writable.includes('savedReestrs'));
  assert.equal(h.state.remoteCalls.length,0);
});
test('ordinary local snapshot carries the real ACL through syncLoad to registry editing',async()=>{
  const h=harness(),raw=await h.context.readSnapshotIPC(h.event,{hello:h.hello});
  assert.ok(raw,h.state.errors.join('\n'));
  const snapshot=JSON.parse(raw);
  assert.ok(snapshot.access,'Local read-snapshot omitted the authoritative ACL needed by registry editing');
  assert.deepEqual(snapshot.access,json(h.expected()));
  assert.deepEqual(json(h.bindings.get(7).notificationAccess),json(h.expected()));
  assert.equal(snapshot.platform.negotiation.writeCompatible,true);
  const rendered=await rendererState(raw);
  assert.deepEqual(json(rendered.context._sync.access),json(h.expected()));
  assert.equal(rendered.registry.canWrite(),true);
  assert.equal(rendered.registry.writeBlockReason(),'');
});
test('object snapshots and both other local paths preserve their actual narrow or unconfigured ACL',async()=>{
  for(const configured of [true,false]){
    const cache=harness({kind:'des-object',configured}),cacheContext=await cache.context.freshDataCacheContext(cache.event);
    assert.deepEqual(json(cacheContext.access),json(cache.expected()));
    assert.equal(cacheContext.readOnly,!configured);
    assert.equal(cacheContext.access.writable.includes('savedReestrs'),false);
    assert.equal(cacheContext.access.writable.includes('vehicles'),false);
    assert.equal(cacheContext.access.writable.includes('generators'),configured);
    const legacy=harness({kind:'des-object',configured});assert.deepEqual(await observeReadDataBoundary(legacy),json(legacy.expected()));
    const h=harness({kind:'des-object',configured}),raw=await h.context.readSnapshotIPC(h.event,{hello:h.hello});assert.ok(raw,h.state.errors.join('\n'));
    assert.deepEqual(JSON.parse(raw).access,json(h.expected()));
    const rendered=await rendererState(raw);assert.notEqual(rendered.registry.canWrite(),true);
  }
});
test('remote viewer ACLs remain server-issued and unverified responses never become local admins',async()=>{
  const h=harness({remote:true}),raw=await h.context.readSnapshotIPC(h.event,{hello:h.hello});assert.ok(raw,h.state.errors.join('\n'));
  assert.deepEqual(JSON.parse(raw).access,json(h.state.remoteAccess));
  assert.deepEqual(json((await h.context.freshDataCacheContext(h.event)).access),json(h.state.remoteAccess));
  assert.equal(JSON.parse(raw).access.user.role,'viewer');
  const rendered=await rendererState(raw);assert.notEqual(rendered.registry.canWrite(),true);
  for(const broken of ['missing','revoked']){
    const other=harness({remote:true});if(broken==='missing')other.state.remoteAccess=null;else other.state.remoteError=Object.assign(Error('Synthetic revoked user'),{status:403});
    assert.equal(await other.context.readSnapshotIPC(other.event,{hello:other.hello}),null);
    assert.equal(other.bindings.size,0);
    assert.equal(other.state.remoteCalls.includes('FORBIDDEN-BAREROWS'),false);
    if(broken==='missing')await assert.rejects(other.context.freshDataCacheContext(other.event),{code:'ACCESS_UNVERIFIED'});
    else assert.deepEqual(json(await other.context.freshDataCacheContext(other.event)),{version:1,unavailable:'ACCESS_REVOKED'});
    assert.equal(other.bindings.size,0);
  }
});
test('publishing local ACLs does not bypass negotiated read-only compatibility',async()=>{
  const h=harness(),hello={...h.hello,writerSchemaVersions:[]};
  const raw=await h.context.readSnapshotIPC(h.event,{hello});assert.ok(raw,h.state.errors.join('\n'));
  const snapshot=JSON.parse(raw);assert.equal(snapshot.platform.negotiation.writeCompatible,false);assert.equal(snapshot.readOnly,true);
  const rendered=await rendererState(raw);assert.equal(rendered.context._loadWriteBlocked,true);assert.notEqual(rendered.registry.canWrite(),true);
});
