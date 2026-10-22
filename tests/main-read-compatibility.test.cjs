'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),path=require('node:path');
const {ROOT,functionDeclarations,ipcHandler}=require('./helpers/source-harness.cjs');
const compatibility=require('../assets/core/platform-compatibility.js'),format=require('../electron/storage-format.cjs');
const names=['bindData','assertDataBinding','validPublicAccess','legacyPing','readonlyLegacyAccess','invalidateDataBinding','beginDataRead','assertDataRead','freshDataCacheContext','invalidateWriteSession','mainWriteSessions','bindSnapshotCompatibility','capturedOperationContext','assertOperationContext','readableOperationContext'];
const declarations=functionDeclarations('electron/main.js',names),channels=['read-section','get-revisions','query-rows'];
const access=stamp=>({user:{id:'synthetic-reader',name:'Synthetic reader',role:'viewer'},readable:['vehicles','records'],writable:[],policyStamp:'sha256:'+stamp.repeat(64)});
const owned=value=>JSON.parse(JSON.stringify(value));
function fixture({client=true,bind=true}={}){
 const state={identity:'synthetic-profile',token:'synthetic-db-token',url:'file:///synthetic/index.html',destroyed:false,reads:[],writeProofs:0,hook:null};
 const sender={id:7,mainFrame:{synthetic:true},getURL:()=>state.url,isDestroyed:()=>state.destroyed},event={sender},bindings=new Map();
 const visible={id:0,note:'SYNTHETIC-VISIBLE-ROW'},publicAccess=access('a'),description=compatibility.describe();
 const platform={apiVersion:1,operations:1,commands:1,outbox:1,descriptor:format.describe(format.SCHEMA_VERSION),compatibility:description.serverProfile};
 const context={settings:{networkMode:client?'client':'local',remoteHost:'synthetic.invalid',remotePort:8123,activeUser:0},networkConfigError:'',dataBindings:bindings,dataReadGenerations:new Map(),notificationService:{invalidate(){}},writeSessions:null,settingsIdentity:()=>state.identity,getDataDir:()=>path.join(ROOT,'tests','synthetic-no-io'),getActiveUser:()=>({name:'Synthetic'}),isClientMode:()=>client,
  storage:{SECTIONS:['vehicles','records'],databaseToken:()=>state.token,readSection(_directory,name){state.reads.push(name);return [visible];},readRevisions(){state.reads.push('revisions');return {vehicles:1,records:0};}},
  server:{async getJson(_host,_port,url){state.reads.push(url);await state.hook?.(url);if(url==='/api/ping')return state.ping||{ok:true,databaseToken:state.token,access:publicAccess};if(url==='/api/revisions')return {vehicles:1,records:0,databaseToken:state.token};if(url.startsWith('/api/query'))return {ok:true,rows:[visible],databaseToken:state.token};return [visible];},negotiate(){state.writeProofs++;throw Error('A data read must not renew a write proof');},localWriteOptions(){state.writeProofs++;throw Error('A data read must not request a local write proof');}},
  require(name){if(name==='node:crypto')return require(name);if(name==='./write-session.cjs')return require('../electron/write-session.cjs');if(name==='../assets/core/platform-compatibility.js')return compatibility;if(name==='./storage-format.cjs')return format;if(name==='./data-query.cjs')return {queryRows(){state.reads.push('query');return {ok:true,rows:[visible],databaseToken:state.token};}};throw Error('Unexpected main read dependency '+name);}};
 vm.createContext(context);vm.runInContext(declarations,context,{filename:'electron/main.js'});
 const snapshot={data:{vehicles:[visible],records:[]},databaseToken:state.token,access:publicAccess,revisions:{vehicles:1,records:0},platform};
 if(bind)context.bindSnapshotCompatibility(event,snapshot,{...description.hello,writerSchemaVersions:[]},{ok:true,databaseToken:state.token,access:publicAccess,platform});
 return {state,context,event,sender,bindings,snapshot,visible,handler:channel=>vm.runInContext('('+ipcHandler(channel)+')',context,{filename:'electron/main.js'})};
}
const args=channel=>channel==='read-section'?'vehicles':channel==='query-rows'?{section:'vehicles',limit:10}:undefined;
const mutations=[f=>{f.sender.mainFrame={synthetic:true,replaced:true};},f=>{f.state.url='file:///synthetic/replaced.html';},f=>{f.state.destroyed=true;}];

test('section, revision and query IPCs require an explicitly confirmed readable binding before any data access',async()=>{
 for(const client of [false,true])for(const grant of ['unbound',undefined,null,false,0,'true'])for(const channel of channels){
  const f=fixture({client});if(grant==='unbound')f.bindings.clear();else f.bindings.get(7).platform.negotiation=grant===undefined?undefined:{readCompatible:grant};
  const result=await f.handler(channel)(f.event,args(channel));
  if(channel==='query-rows'){assert.equal(result.ok,false);assert.equal(Object.hasOwn(result,'rows'),false);}else assert.equal(result,null);
  assert.deepEqual(f.state.reads,[],channel);assert.equal(f.state.writeProofs,0);
 }
});

test('proven read-only clients can read sections, revisions and queries without a writer or ticket',async()=>{
 for(const client of [false,true]){
  const f=fixture({client});assert.equal(f.snapshot.readOnly,true);assert.equal(f.snapshot.platform.negotiation.readCompatible,true);assert.equal(f.snapshot.platform.negotiation.writeCompatible,false);
  const section=await f.handler('read-section')(f.event,'vehicles'),revisions=await f.handler('get-revisions')(f.event),query=await f.handler('query-rows')(f.event,{section:'vehicles',limit:10});
  assert.deepEqual(owned(section),[f.visible]);assert.equal(revisions.databaseToken,f.state.token);assert.equal(revisions.vehicles,1);assert.equal(query.ok,true);assert.deepEqual(owned(query.rows),[f.visible]);assert.equal(f.state.writeProofs,0);assert.doesNotMatch(JSON.stringify([section,revisions,query]),/ticket|assertWriteCompatibility/);
 }
});

test('late section, revision and query replies return no rows after frame replacement, navigation or window destruction',async()=>{
 for(const channel of channels)for(const mutate of mutations){
  const f=fixture();f.state.hook=()=>mutate(f);const result=await f.handler(channel)(f.event,args(channel));
  if(channel==='query-rows'){assert.equal(result.ok,false);assert.equal(result.code,'SESSION_CHANGED');assert.equal(Object.hasOwn(result,'rows'),false);}else assert.equal(result,null);
  assert.equal(f.state.reads.length,1);assert.equal(f.state.writeProofs,0);
 }
});

test('a late cache ping cannot bind a replacement frame using the previous frame readable grant',async()=>{
 for(const mutate of mutations){
  const f=fixture(),original=f.bindings.get(7),frame=f.sender.mainFrame;f.state.ping={ok:true,databaseToken:f.state.token,access:access('b')};f.state.hook=()=>mutate(f);
  let response;await assert.rejects(async()=>{response=await f.context.freshDataCacheContext(f.event);},{code:'SESSION_CHANGED'});
  assert.equal(response,undefined);assert.equal(f.bindings.get(7),original);assert.equal(original.frame,frame);assert.equal(original.notificationAccess.policyStamp,access('a').policyStamp);assert.throws(()=>f.context.readableOperationContext(f.event),{code:'SESSION_CHANGED'});assert.equal(f.state.writeProofs,0);
 }
});

test('a current cache ping may update explicit rights without manufacturing a write ticket',async()=>{
 const f=fixture(),original=f.bindings.get(7);f.state.ping={ok:true,databaseToken:f.state.token,access:access('b')};const result=await f.context.freshDataCacheContext(f.event);
 assert.equal(result.policyStamp,access('b').policyStamp);assert.notEqual(f.bindings.get(7),original);assert.equal(f.bindings.get(7).frame,f.sender.mainFrame);assert.equal(f.context.readableOperationContext(f.event).access.policyStamp,result.policyStamp);assert.equal(f.context.mainWriteSessions().profile(f.context.capturedOperationContext(f.event)),null);assert.equal(f.state.writeProofs,0);assert.doesNotMatch(JSON.stringify(result),/ticket/);
});
