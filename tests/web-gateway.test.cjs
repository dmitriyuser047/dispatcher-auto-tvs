'use strict';

const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {Worker}=require('node:worker_threads'),{setTimeout:delay}=require('node:timers/promises');
const {createGateway}=require('../web/server.cjs'),access=require('../electron/access-control.js'),sqlite=require('../electron/sqlite-storage.cjs'),storage=require('../electron/storage.js');
function call(port,route,{method='GET',payload,cookie,csrf,headers={}}={}){return new Promise((resolve,reject)=>{const raw=payload===undefined?undefined:JSON.stringify(payload);const req=http.request({host:'127.0.0.1',port,path:route,method,agent:false,headers:{...(raw===undefined?{}:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(raw)}),...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...headers}},res=>{const chunks=[];res.on('data',part=>chunks.push(part));res.on('end',()=>{const text=Buffer.concat(chunks).toString('utf8');let body;try{body=JSON.parse(text);}catch{}resolve({status:res.statusCode,headers:res.headers,text,body});});});req.on('error',reject);req.setTimeout(30000,()=>req.destroy(Error('Gateway test timeout')));req.end(raw);});}
async function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-web-gateway-')),dataDir=path.join(root,'db');
 sqlite.create(dataDir,{data:{vehicles:[{id:'web-v1',plate:'SYNTHETIC-WEB',org:'Synthetic organization',fuelBalance:100}],records:[],payments:[{id:'secret',sum:99778866,description:'SYNTHETIC-PRIVATE-FINANCE'}]}});
 const token='synthetic-web-admin-0123456789',viewer='synthetic-web-dispatcher-0123456789';
 let settings={serverAccessConfigured:true,networkKey:'SYNTHETIC-DO-NOT-EXPOSE',serverUsers:access.normalizeServerUsers([{id:'admin',name:'Synthetic admin',role:'admin',tokenHash:access.hashToken(token)},{id:'keeper',name:'Synthetic keeper',role:'admin',tokenHash:access.hashToken('synthetic-web-keeper-0123456789')},{id:'dispatcher',name:'Synthetic dispatcher',role:'dispatcher',tokenHash:access.hashToken(viewer)}])};
 let onSettings=null;
 const gateway=await createGateway({dataDir,outboxDir:path.join(root,'outbox'),settings:()=>{onSettings?.();return settings;},renderDocument:({url,user})=>'<h1>'+url.pathname+'</h1><p>'+(user?.name||'Login')+'</p>'});
 t.after(async()=>{await gateway.close();const absolute=path.resolve(root);assert.equal(path.dirname(absolute),path.resolve(os.tmpdir()));assert.match(path.basename(absolute),/^tvs-web-gateway-/);assert.equal(fs.lstatSync(absolute).isSymbolicLink(),false);fs.rmSync(absolute,{recursive:true,force:true});});
 return {...gateway,dataDir,root,token,viewer,onSettings(fn){onSettings=fn;},change(patch){settings={...settings,serverUsers:access.normalizeServerUsers(settings.serverUsers.map(u=>u.id==='admin'?{...u,...patch}:u))};},async login(value=token){const result=await call(gateway.port,'/web-api/login',{method:'POST',payload:{token:value}});assert.equal(result.status,200,result.text);return {cookie:result.headers['set-cookie'][0].split(';')[0],csrf:result.body.csrf,response:result};}};
}
async function holdManagedLock(dataDir){
 const memory=new SharedArrayBuffer(4),signal=new Int32Array(memory);
 const worker=new Worker("const{workerData,parentPort}=require('node:worker_threads');require(workerData.storage).withDatabaseLock(workerData.dataDir,()=>{parentPort.postMessage('locked');Atomics.wait(new Int32Array(workerData.memory),0,0,12000);});parentPort.close();",{eval:true,workerData:{dataDir,memory,storage:require.resolve('../electron/storage.js')}});
 let workerError=null,readyResolve,readyReject;const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;}),done=new Promise(resolve=>worker.once('exit',code=>resolve(code)));
 worker.once('message',message=>message==='locked'?readyResolve():readyReject(Error('Unexpected managed-lock worker message')));worker.once('error',error=>{workerError=error;readyReject(error);});await ready;
 let released=false;return {async release(){if(released)return;released=true;Atomics.store(signal,0,1);Atomics.notify(signal,0);const code=await done;if(workerError)throw workerError;assert.equal(code,0);}};
}

test('web gateway isolates host/origin, requires personal login and keeps credentials server-side',async t=>{const h=await fixture(t);assert.equal((await call(h.port,'/transport')).status,303);assert.equal((await call(h.port,'/web-api/bootstrap')).status,401);assert.equal((await call(h.port,'/web-api/login',{method:'POST',payload:{token:h.token},headers:{Origin:'https://untrusted.invalid'}})).status,403);assert.equal((await call(h.port,'/login',{headers:{Host:'untrusted.invalid'}})).status,403);assert.equal((await call(h.port,'/%2e%2e/electron/server.js')).status,404);assert.equal((await call(h.port,'/web/server.cjs')).status,404);assert.equal((await call(h.port,'/assets/core/entity-identity.js')).status,200);const login=await h.login();assert.match(login.response.headers['set-cookie'][0],/HttpOnly/);assert.match(login.response.headers['set-cookie'][0],/SameSite=Strict/);assert.doesNotMatch(login.response.text,new RegExp(h.token));assert.equal((await call(h.port,'/objects',login)).status,200);const boot=await call(h.port,'/web-api/bootstrap',login);assert.equal(boot.status,200);assert.equal(boot.body.user.id,'admin');assert.doesNotMatch(boot.text,/tokenHash|networkKey|SYNTHETIC-DO-NOT-EXPOSE|dataDir|writeTicket/);const negotiation=await call(h.port,'/web-api/negotiate',{...login,method:'POST',payload:{}});assert.equal(negotiation.status,200);assert.doesNotMatch(negotiation.text,/writeTicket/);const forbidden=await call(h.port,'/web-api/sections',{cookie:login.cookie,csrf:'bad-csrf',method:'POST',payload:{}});assert.equal(forbidden.status,403);assert.equal((await call(h.port,'/web-api/logout',{...login,method:'POST',payload:{}})).status,200);assert.equal((await call(h.port,'/web-api/bootstrap',login)).status,401);});

test('web gateway preserves current ACL and CAS without exposing hidden records or overwriting another user',async t=>{const h=await fixture(t),login=await h.login();const before=await call(h.port,'/web-api/snapshot',login);assert.equal(before.status,200,before.text);assert.equal(before.body.platform.negotiation.writeCompatible,true);const payload={databaseToken:before.body.databaseToken,base:{vehicles:before.body.revisions.vehicles},operation:{id:'web-cas-first'},sections:{vehicles:before.body.data.vehicles.map(row=>({...row,note:'First confirmed edit'}))}};assert.equal((await call(h.port,'/web-api/sections',{...login,csrf:undefined,method:'POST',payload})).status,403);const first=await call(h.port,'/web-api/sections',{...login,method:'POST',payload});assert.equal(first.status,200,first.text);assert.equal(first.body.ok,true);const second=await call(h.port,'/web-api/sections',{...login,method:'POST',payload:{...payload,operation:{id:'web-cas-stale'},sections:{vehicles:payload.sections.vehicles.map(row=>({...row,note:'Stale overwrite'}))}}});assert.equal(second.status,409,second.text);assert.equal(storage.readSnapshot(h.dataDir).data.vehicles[0].note,'First confirmed edit');const dispatcher=await h.login(h.viewer);const restricted=await call(h.port,'/web-api/query?query='+encodeURIComponent(JSON.stringify({section:'payments'})),dispatcher);assert.equal(restricted.status,403);assert.doesNotMatch(restricted.text,/SYNTHETIC-PRIVATE-FINANCE|99778866/);h.change({enabled:false});const revoked=await call(h.port,'/web-api/snapshot',login);assert.equal(revoked.status,401);assert.doesNotMatch(revoked.text,/SYNTHETIC-WEB|SYNTHETIC-PRIVATE-FINANCE/);});

test('personal account validation supports more than one hundred users with bounded validation',()=>{const users=Array.from({length:150},(_,i)=>({id:'web-user-'+i,name:'Synthetic '+i,role:i===0?'admin':'viewer',tokenHash:access.hashToken('synthetic-web-load-token-'+i)}));assert.equal(access.normalizeServerUsers(users).length,150);assert.throws(()=>access.normalizeServerUsers(Array.from({length:2001},()=>users[0])),/учётных записей/);});

test('snapshot checks the requesting browser profile in the same read and bootstrap includes the version',async t=>{
 const h=await fixture(t),login=await h.login(),compatibility=require('../assets/core/platform-compatibility.js');
 const before=storage.readSnapshot(h.dataDir),hello=compatibility.describe().hello;
 const route=value=>'/web-api/snapshot?hello='+encodeURIComponent(JSON.stringify(value));
 const compatible=await call(h.port,route(hello),login);
 assert.equal(compatible.status,200);assert.equal(compatible.body.platform.negotiation.readCompatible,true);assert.equal(compatible.body.platform.negotiation.writeCompatible,true);
 assert.doesNotMatch(compatible.text,/writeTicket|tokenHash/);
 const incompatible=await call(h.port,route({...hello,readerSchemaVersions:[65535]}),login);
 assert.equal(incompatible.status,200);assert.equal(incompatible.body.platform.negotiation.readCompatible,false);assert.equal(incompatible.body.readOnly,true);
 for(const suffix of ['?hello=%7B','?other=1','?hello=%7B%7D&hello=%7B%7D'])assert.equal((await call(h.port,'/web-api/snapshot'+suffix,login)).status,400);
 assert.equal((await call(h.port,'/web-api/bootstrap',login)).body.version,require('../package.json').version);
 assert.deepEqual(storage.readSnapshot(h.dataDir),before);
});

test('web gateway persists confirmed intent, isolates queues by user and reconciles the original receipt',async t=>{
 const h=await fixture(t),login=await h.login(),snapshot=(await call(h.port,'/web-api/snapshot',login)).body;
 assert.equal(snapshot.platform.outbox,1);
 const payload={databaseToken:snapshot.databaseToken,base:{vehicles:snapshot.revisions.vehicles},operation:{id:'web-durable-intent'},sections:{vehicles:snapshot.data.vehicles.map(row=>({...row,note:'Durable gateway edit'}))}};
 const saved=await call(h.port,'/web-api/sections',{...login,method:'POST',payload});assert.equal(saved.status,200,saved.text);assert.equal(saved.body.operationReceipt.status,'committed');
 const list=await call(h.port,'/web-api/pending-operations',login);assert.equal(list.status,200,list.text);assert.equal(list.body.operations.length,1);assert.equal(list.body.operations[0].id,payload.operation.id);assert.equal(list.body.operations[0].status,'committed');
 const other=await h.login(h.viewer),isolated=await call(h.port,'/web-api/pending-operations',other);assert.deepEqual(isolated.body.operations,[]);
 const checked=await call(h.port,'/web-api/reconcile-operation',{...login,method:'POST',payload:{id:payload.operation.id}});assert.equal(checked.body.committed,true,checked.text);
 const before=storage.readSnapshot(h.dataDir);const retry=await call(h.port,'/web-api/retry-operation',{...login,method:'POST',payload:{id:payload.operation.id}});assert.equal(retry.body.committed,true,retry.text);assert.deepEqual(storage.readSnapshot(h.dataDir),before);
 const files=fs.readdirSync(path.join(h.root,'outbox'));for(const file of files)if(file.endsWith('.json'))assert.doesNotMatch(fs.readFileSync(path.join(h.root,'outbox',file),'utf8'),new RegExp(h.token));
 const discarded=await call(h.port,'/web-api/discard-operation',{...login,method:'POST',payload:{id:payload.operation.id}});assert.equal(discarded.body.discarded,true);assert.deepEqual((await call(h.port,'/web-api/pending-operations',login)).body.operations,[]);
});

test('web gateway discards in-flight reads when permissions change before acknowledgement',async t=>{
 const h=await fixture(t),login=await h.login(),originalAuthenticate=access.authenticate;let armed=false;
 // Change settings after the backend captures its former principal, while the
 // gateway's acknowledgement still has to validate that response. Gateway
 // checks pass allowLegacy:false; the retained backend omits that option.
 access.authenticate=function(token,settings,options){const principal=originalAuthenticate(token,settings,options);if(armed&&token===h.token&&options===undefined){armed=false;h.change({role:'dispatcher'});}return principal;};
 try{for(const route of ['/web-api/snapshot','/web-api/data','/web-api/section/vehicles','/web-api/query?query='+encodeURIComponent(JSON.stringify({section:'payments'}))]){
   h.change({role:'admin'});armed=true;const result=await call(h.port,route,login);
   assert.equal(result.status,409,route+' '+result.text);assert.equal(result.body.code,'SESSION_CHANGED');assert.equal(armed,false);
   assert.doesNotMatch(result.text,/SYNTHETIC-WEB|SYNTHETIC-PRIVATE-FINANCE|99778866/);
   for(const key of ['rows','data','access','databaseToken','revisions'])assert.equal(Object.hasOwn(result.body,key),false,key);
 }}finally{access.authenticate=originalAuthenticate;}
});

test('web gateway revalidates public code with ETags without caching business responses',async t=>{
 const h=await fixture(t),route='/assets/core/entity-identity.js',first=await call(h.port,route);
 assert.equal(first.status,200);assert.equal(first.headers['cache-control'],'no-cache');assert.ok(first.headers.etag);
 const cached=await call(h.port,route,{headers:{'If-None-Match':first.headers.etag}});
 assert.equal(cached.status,304);assert.equal(cached.text,'');assert.equal(cached.headers.etag,first.headers.etag);
 const login=await h.login(),snapshot=await call(h.port,'/web-api/snapshot',{...login,headers:{'If-None-Match':first.headers.etag}});
 assert.equal(snapshot.status,200);assert.equal(snapshot.headers['cache-control'],'no-store');assert.equal(snapshot.headers.etag,undefined);
 const privateFile=await call(h.port,'/web/.local/platform.sqlite',{...login,headers:{'If-None-Match':'*'}});assert.equal(privateFile.status,404);
});

test('web gateway waits for a managed writer only on safe reads and handshakes',async t=>{
 const h=await fixture(t),login=await h.login(),before=storage.readSnapshot(h.dataDir),lock=await holdManagedLock(h.dataDir);let results;
 try{
   const reads=Promise.all([call(h.port,'/web-api/bootstrap',login),call(h.port,'/web-api/snapshot',login),call(h.port,'/web-api/negotiate',{...login,method:'POST',payload:{}}),call(h.port,'/web-api/query?query='+encodeURIComponent(JSON.stringify({section:'vehicles'})),login)]);
   await delay(120);await lock.release();results=await reads;
 }finally{await lock.release();}
 for(const result of results){assert.equal(result.status,200,result.text);assert.notEqual(result.body.code,'ACCESS_REVOKED');assert.equal(result.headers['set-cookie'],undefined);}
 assert.deepEqual(storage.readSnapshot(h.dataDir),before);
});

test('persistent managed lock returns bounded DB_BUSY without revoking the web session',async t=>{
 const h=await fixture(t),login=await h.login(),lock=await holdManagedLock(h.dataDir);let result;
 try{result=await call(h.port,'/web-api/bootstrap',login);}finally{await lock.release();}
 assert.equal(result.status,503,result.text);assert.equal(result.body.code,'DB_BUSY');assert.equal(result.headers['set-cookie'],undefined);assert.doesNotMatch(result.text,/ACCESS_REVOKED|tvs-web-gateway-|\.tvs-database\.lock/);
 const recovered=await call(h.port,'/web-api/bootstrap',login);assert.equal(recovered.status,200,recovered.text);
});

test('busy-read backoff still enforces current revocation before returning data',async t=>{
 const h=await fixture(t),login=await h.login(),lock=await holdManagedLock(h.dataDir);let result;
 try{const reading=call(h.port,'/web-api/snapshot',login);await delay(80);h.change({enabled:false});result=await reading;}finally{await lock.release();}
 assert.equal(result.status,401,result.text);assert.equal(result.body.code,'ACCESS_REVOKED');assert.doesNotMatch(result.text,/SYNTHETIC-WEB|SYNTHETIC-PRIVATE-FINANCE/);
});
