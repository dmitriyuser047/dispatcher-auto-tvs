'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createWriteSessions}=require('../electron/write-session.cjs'),compatibility=require('../assets/core/platform-compatibility.js'),format=require('../electron/storage-format.cjs'),kernel=require('../assets/core/platform-kernel.js');
const copy=value=>JSON.parse(JSON.stringify(value)),changed=error=>error?.code==='SESSION_CHANGED';
function fixture(){
 const description=compatibility.describe(),hello=copy(description.hello),access={user:{id:'synthetic-actor',name:'Synthetic',role:'admin'},policyStamp:'sha256:'+'a'.repeat(64),readable:['vehicles'],writable:['vehicles']};
 const context={senderId:7,scope:'synthetic-scope-A',databaseToken:'synthetic-token-A',host:'synthetic.invalid',port:3377,client:true,access,principal:{...access.user,policyStamp:access.policyStamp}},active=new Map([[7,context]]),state={now:100000,calls:[],localCalls:[]};
 const assertContext=value=>{const current=active.get(value.senderId);if(!current||current.scope!==value.scope||current.databaseToken!==value.databaseToken||current.host!==value.host||current.port!==value.port||JSON.stringify(current.access)!==JSON.stringify(value.access))throw Object.assign(Error('Synthetic context changed'),{code:'SESSION_CHANGED'});};
 const response=(patch={})=>({ok:true,databaseToken:context.databaseToken,access:copy(access),platform:{descriptor:format.describe(format.SCHEMA_VERSION),compatibility:copy(description.serverProfile)},writeTicket:'synthetic-private-ticket-A',writeTicketExpiresAt:state.now+60000,...patch});
 const sessions=createWriteSessions({assertContext,now:()=>state.now,negotiate:async(...args)=>{state.calls.push(args);return state.renew?state.renew(...args):response({writeTicket:'synthetic-private-ticket-B'});},localWriteOptions:input=>{state.localCalls.push(input);return {requireNegotiatedWriter:true,syntheticAuthorizedHello:input.hello};}});
 return {context,active,state,hello,response,sessions,bind:patch=>sessions.bind(context,hello,response(patch))};
}

test('write sessions require named trusted capabilities',()=>{for(const name of ['negotiate','localWriteOptions','assertContext','now']){const options={negotiate(){},localWriteOptions(){},assertContext(){},now(){return 0;}};delete options[name];if(name==='now')assert.doesNotThrow(()=>createWriteSessions(options));else assert.throws(()=>createWriteSessions(options),TypeError);}});

test('public selected profile never exposes private tickets or access credentials',async()=>{
 const f=fixture(),profile=f.bind();assert.equal(profile.writeCompatible,true);assert.equal(Object.isFrozen(profile),true);assert.equal(JSON.stringify(profile).includes('synthetic-private-ticket'),false);assert.equal(JSON.stringify(f.sessions).includes('synthetic-private-ticket'),false);
 assert.deepEqual(await f.sessions.remoteOptions(f.context),{ticket:'synthetic-private-ticket-A'});assert.equal(f.state.calls.length,0);assert.equal(f.sessions.profile(f.context),profile);
});

test('binding rejects a remote database, access policy, actor or response status different from the captured context',()=>{
 for(const patch of [{ok:false},{databaseToken:'synthetic-token-B'},{access:null},{access:{...fixture().context.access,writable:[]}},{access:{...fixture().context.access,user:{id:'other',role:'admin'}}}]){const f=fixture();assert.throws(()=>f.bind(patch),changed);assert.equal(f.sessions.profile(f.context),null);}
 const f=fixture(),access=f.response().access;f.bind({access:{writable:access.writable,readable:access.readable,policyStamp:access.policyStamp,user:{role:'admin',name:'Synthetic',id:'synthetic-actor'}}});assert.equal(f.sessions.profile(f.context).writeCompatible,true);
});

test('write-compatible binding requires a bounded ticket and integer expiry from the trusted reply',()=>{
 for(const patch of [{writeTicket:undefined},{writeTicket:[]},{writeTicket:'x'.repeat(4097)},{writeTicketExpiresAt:NaN},{writeTicketExpiresAt:1.1},{writeTicketExpiresAt:Number.MAX_SAFE_INTEGER+1}]){const f=fixture();assert.throws(()=>f.bind(patch),changed);assert.equal(f.sessions.profile(f.context),null);}
});

test('renewal uses an owned hello and the original endpoint while immutable intent and digest remain exact',async()=>{
 const f=fixture(),helloBefore=copy(f.hello),payload={databaseToken:f.context.databaseToken,base:{vehicles:1},sections:{vehicles:[{id:0,note:'EXACT 923.537'}]},operation:{id:'renew-original-intent'}},raw=JSON.stringify(payload),digest=kernel.requestDigest(payload),contextBefore=JSON.stringify(f.context);f.bind();f.hello.protocolVersions.push(2);f.hello.capabilities[0].versions.push(2);f.state.now+=59000;
 assert.deepEqual(await f.sessions.remoteOptions(f.context),{ticket:'synthetic-private-ticket-B'});assert.equal(f.state.calls.length,1);assert.deepEqual(f.state.calls[0],[f.context.host,f.context.port,helloBefore]);assert.equal(JSON.stringify(payload),raw);assert.equal(kernel.requestDigest(payload),digest);assert.equal(JSON.stringify(f.context),contextBefore);assert.equal(Object.hasOwn(payload,'writeTicket'),false);
});

test('renewal occurs at the safety margin and the renewed ticket is reused without another request',async()=>{
 const f=fixture();f.bind({writeTicketExpiresAt:f.state.now+1501});assert.equal((await f.sessions.remoteOptions(f.context)).ticket,'synthetic-private-ticket-A');f.state.now++;assert.equal((await f.sessions.remoteOptions(f.context)).ticket,'synthetic-private-ticket-B');assert.equal((await f.sessions.remoteOptions(f.context)).ticket,'synthetic-private-ticket-B');assert.equal(f.state.calls.length,1);
});

test('an unavailable renewal returns no proof so the backend can independently look up an exact receipt',async()=>{
 const f=fixture();f.bind({writeTicketExpiresAt:0});f.state.renew=async()=>{throw Error('Synthetic unavailable negotiation');};assert.deepEqual(await f.sessions.remoteOptions(f.context),{});assert.equal(f.state.calls.length,1);assert.equal(f.sessions.profile(f.context).writeCompatible,true);
});

test('a failed renewal cannot hide a changed or invalidated context',async()=>{
 for(const mutate of [f=>f.active.delete(7),f=>f.active.set(7,{...f.context,scope:'synthetic-scope-B'}),f=>f.sessions.invalidate(7)]){const f=fixture();f.bind({writeTicketExpiresAt:0});f.state.renew=async()=>{mutate(f);throw Error('Synthetic unavailable');};await assert.rejects(f.sessions.remoteOptions(f.context),changed);}
});

test('a late successful renewal cannot replace an invalidated or newly bound session',async()=>{
 for(const replace of [f=>f.sessions.invalidate(7),f=>f.bind({writeTicket:'synthetic-new-session'})]){const f=fixture();f.bind({writeTicketExpiresAt:0});let release;f.state.renew=()=>new Promise(resolve=>{release=resolve;});const pending=f.sessions.remoteOptions(f.context);replace(f);release(f.response({writeTicket:'synthetic-late-old-reply'}));await assert.rejects(pending,changed);if(f.sessions.profile(f.context))assert.equal((await f.sessions.remoteOptions(f.context)).ticket,'synthetic-new-session');}
});

test('renewal rechecks the captured context and the actual response database and ACL after awaiting transport',async()=>{
 for(const mutate of [f=>f.active.set(7,{...f.context,scope:'synthetic-scope-B'}),f=>f.active.set(7,{...f.context,databaseToken:'synthetic-token-B'}),f=>f.active.set(7,{...f.context,access:{...f.context.access,writable:[]}})]){const f=fixture();f.bind({writeTicketExpiresAt:0});f.state.renew=async()=>{mutate(f);return f.response();};await assert.rejects(f.sessions.remoteOptions(f.context),changed);}
 for(const patch of [{databaseToken:'synthetic-token-B'},{access:{...fixture().context.access,writable:[]}}, {ok:false}]){const f=fixture();f.bind({writeTicketExpiresAt:0});f.state.renew=async()=>f.response(patch);await assert.rejects(f.sessions.remoteOptions(f.context),changed);}
});

test('a safe read-only negotiation or invalid renewed ticket removes the old proof',async()=>{
 for(const patch of [{platform:{descriptor:format.describe(format.SCHEMA_VERSION),compatibility:{...compatibility.describe().serverProfile,readOnly:true}}},{writeTicket:null},{writeTicket:'x'.repeat(4097)},{writeTicketExpiresAt:0}]){const f=fixture();f.bind({writeTicketExpiresAt:0});f.state.renew=async()=>f.response(patch);assert.deepEqual(await f.sessions.remoteOptions(f.context),{});assert.deepEqual(await f.sessions.remoteOptions(f.context),{});}
});

test('unbound, unsupported and separately scoped senders cannot borrow a private proof',async()=>{
 const f=fixture();assert.deepEqual(await f.sessions.remoteOptions(f.context),{});f.sessions.bind(f.context,null,f.response({writeTicket:undefined}));assert.deepEqual(await f.sessions.remoteOptions(f.context),{});assert.equal(f.sessions.profile(f.context).readCompatible,false);assert.equal(f.state.calls.length,0);f.bind();const other={...f.context,senderId:8};f.active.set(8,other);assert.deepEqual(await f.sessions.remoteOptions(other),{});f.sessions.bind(other,f.hello,f.response({writeTicket:'synthetic-other-window'}));f.sessions.invalidate(7);assert.deepEqual(await f.sessions.remoteOptions(f.context),{});assert.equal((await f.sessions.remoteOptions(other)).ticket,'synthetic-other-window');
});

test('local options pass the exact captured principal and owned hello to the trusted local proof capability',()=>{
 const f=fixture(),local={...f.context,client:false};f.active.set(7,local);f.sessions.localOptions(local);assert.equal(f.state.localCalls[0].hello,null);f.sessions.bind(local,f.hello,f.response());f.hello.protocolVersions.push(2);const options=f.sessions.localOptions(local),input=f.state.localCalls[1];assert.equal(options.requireNegotiatedWriter,true);assert.equal(input.databaseToken,local.databaseToken);assert.equal(input.principal,local.principal);assert.deepEqual(input.hello.protocolVersions,[1]);assert.equal(Object.hasOwn(input,'ticket'),false);f.active.delete(7);assert.throws(()=>f.sessions.localOptions(local),changed);
});
