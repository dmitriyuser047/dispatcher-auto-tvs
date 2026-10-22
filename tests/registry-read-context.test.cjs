'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),path=require('node:path');
const {ROOT,functionDeclarations,ipcHandler}=require('./helpers/source-harness.cjs');
const names=['bindData','assertDataBinding','capturedOperationContext','assertOperationContext','verifiedOperationContext','captureFileContext','assertFileContextSync','assertFileContext'];
const helpers=functionDeclarations('electron/main.js',names);
function fixture({client=true}={}){
 const state={identity:'synthetic-profile-A',token:'synthetic-db-A',ownerUrl:'file:///synthetic/index.html',childUrl:'file:///synthetic/reestr-window.html',ownerDestroyed:false,childDestroyed:false,pings:0,hook:null};
 const access={user:{id:'synthetic-reader',name:'Synthetic',role:'viewer'},readable:['reestrRows','vehicles'],writable:[],policyStamp:'sha256:'+'a'.repeat(64)};
 const owner={id:7,mainFrame:{owner:true},getURL:()=>state.ownerUrl,isDestroyed:()=>state.ownerDestroyed},sender={id:9,mainFrame:{child:true},getURL:()=>state.childUrl,isDestroyed:()=>state.childDestroyed};
 const binding={identity:state.identity,databaseToken:state.token,notificationAccess:access,sender:owner,frame:owner.mainFrame,url:owner.getURL(),platform:{negotiation:{readCompatible:true,writeCompatible:false}}};
 const registry={ownerId:7,identity:state.identity,databaseToken:state.token,rows:[{id:0,sum:0,description:'SYNTHETIC REVIEWED SOURCE'}],log:['Synthetic history'],vehicles:[{id:'0',org:'Synthetic',site:null}],statyi:[],contracts:[],theme:'light',baseRows:[{privateInternal:'NOT PUBLIC'}]};
 const context={settings:{networkMode:client?'client':'local',remoteHost:'synthetic.invalid',remotePort:8123},networkConfigError:'',dataBindings:new Map([[7,binding]]),reestrWindowData:new Map([[9,registry]]),settingsIdentity:()=>state.identity,getDataDir:()=>path.join(ROOT,'tests','synthetic-no-io'),getActiveUser:()=>({name:'Synthetic'}),storage:{databaseToken:()=>state.token},require:name=>{if(name==='node:crypto')return require(name);throw Error('Read context unexpectedly requested '+name);},server:{async getJson(){state.pings++;await state.hook?.(state.pings);return {ok:true,databaseToken:state.token,access:state.serverAccess||access};}}};
 vm.createContext(context);vm.runInContext(helpers,context,{filename:'electron/main.js'});
 const handler=vm.runInContext('('+ipcHandler('reestr-window-data')+')',context,{filename:'electron/main.js'});
 return {state,context,binding,registry,owner,sender,access,invoke:()=>handler({sender})};
}

test('registry readonly data uses the current owner and fresh ACL without a write ticket',async()=>{
 for(const client of [false,true]){const f=fixture({client}),result=await f.invoke();assert.deepEqual(JSON.parse(JSON.stringify(result)),{rows:f.registry.rows,log:f.registry.log,statyi:[],contracts:[],vehicles:f.registry.vehicles,theme:'light'});assert.equal(result.rows[0].sum,0);assert.equal(result.vehicles[0].site,null);assert.equal(f.state.pings,client?2:0);assert.doesNotMatch(JSON.stringify(result),/NOT PUBLIC|ticket|baseRows|ownerId/);}
});

test('registry data rejects a changed profile or missing owner before returning cached rows',async()=>{
 for(const change of [f=>{f.state.identity='synthetic-profile-B';},f=>f.context.dataBindings.delete(7),f=>{f.registry.ownerId=8;},f=>f.context.reestrWindowData.delete(9)]){const f=fixture();change(f);let rows;await assert.rejects(async()=>{rows=await f.invoke();});assert.equal(rows,undefined);}
});

test('registry data rechecks returned ACL at both awaited owner verification and final read authorization',async()=>{
 for(const phase of [1,2]){const f=fixture();f.state.hook=count=>{if(count===phase)f.state.serverAccess={...f.access,readable:[],policyStamp:'sha256:'+'b'.repeat(64)};};let rows;await assert.rejects(async()=>{rows=await f.invoke();},{code:'SESSION_CHANGED'});assert.equal(rows,undefined);assert.equal(f.state.pings,phase);}
});

test('owner or registry frame replacement during either ACL await cannot disclose old source data',async()=>{
 const changes=[f=>{f.owner.mainFrame={replaced:true};},f=>{f.sender.mainFrame={replaced:true};},f=>{f.state.ownerUrl='file:///synthetic/new-owner.html';},f=>{f.state.childUrl='file:///synthetic/new-child.html';},f=>{f.state.ownerDestroyed=true;},f=>{f.state.childDestroyed=true;}];
 for(const phase of [1,2])for(const change of changes){const f=fixture();f.state.hook=count=>{if(count===phase)change(f);};let rows;await assert.rejects(async()=>{rows=await f.invoke();},{code:'SESSION_CHANGED'});assert.equal(rows,undefined);assert.equal(f.state.pings,phase);}
});

test('a replaced registry model or changed database during a pending read never returns the old capsule',async()=>{
 for(const change of [f=>f.context.reestrWindowData.set(9,{...f.registry,rows:[{description:'REPLACEMENT'}]}),f=>{f.state.identity='synthetic-profile-B';},f=>{f.state.token='synthetic-db-B';}]){const f=fixture();f.state.hook=count=>{if(count===2)change(f);};let rows;await assert.rejects(async()=>{rows=await f.invoke();},{code:'SESSION_CHANGED'});assert.equal(rows,undefined);}
});
