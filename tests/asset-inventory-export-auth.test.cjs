'use strict';
// Real HTTP authentication only. The export boundary is an in-memory double;
// neither an application database nor a temporary database is opened/created.
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),os=require('node:os'),path=require('node:path');
const server=require('../electron/server'),access=require('../electron/access-control'),exporter=require('../electron/asset-inventory-export.js');
const token='synthetic-inventory-export-auth-token-0123456789',keeper='synthetic-inventory-export-keeper-token-0123456789';

async function delayedRequest(t,change){
 let settings={serverAccessConfigured:true,serverUsers:access.normalizeServerUsers([{id:'test-user',name:'Synthetic report reader',role:'admin',enabled:true,tokenHash:access.hashToken(token)},{id:'keeper',name:'Synthetic independent administrator',role:'admin',enabled:true,tokenHash:access.hashToken(keeper)}])};
 let armed=false,headerSeen,request,prepareCalls=0,principal;
 const seen=new Promise(resolve=>{headerSeen=resolve;});
 t.mock.method(exporter,'prepare',(_dir,_payload,current)=>{prepareCalls++;principal=current;return {ok:true,role:current.role,userId:current.id};});
 const started=await server.start({port:0,dataDir:path.join(os.tmpdir(),'never-created-inventory-export-auth-'+process.pid),settings:()=>{if(armed){armed=false;headerSeen();}return settings;}});assert.equal(started.ok,true,started.error);
 try{
  armed=true;const raw=JSON.stringify({format:'xlsx',sessionId:0,databaseToken:'synthetic-no-database'});
  const response=new Promise((resolve,reject)=>{
   request=http.request({host:'127.0.0.1',port:started.port,path:'/api/inventory-report',method:'POST',agent:false,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Content-Length':Buffer.byteLength(raw)}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))});}catch(error){reject(error);}});});
   request.on('error',reject);request.setTimeout(7000,()=>request.destroy(Error('Synthetic inventory auth request did not finish')));request.write(raw.slice(0,-1));
  });
  await seen;assert.equal(prepareCalls,0);settings={...settings,serverUsers:access.normalizeServerUsers(settings.serverUsers.map(user=>user.id==='test-user'?{...user,...change}:user))};request.end(raw.slice(-1));const result=await response;
  return {...result,prepareCalls,principal};
 }finally{request?.destroy();await server.stop();}
}

test('inventory report returns a complete 401 when credentials are revoked while its body is unfinished',{timeout:15000},async t=>{
 const result=await delayedRequest(t,{enabled:false});assert.equal(result.status,401);assert.equal(result.body.ok,false);assert.equal(result.body.code,'ACCESS_REVOKED');assert.equal(result.prepareCalls,0);assert.equal(result.principal,undefined);
});

test('inventory report rejects a credential that expires during a delayed body before any report data is read',{timeout:15000},async t=>{
 const result=await delayedRequest(t,{expiresAt:'2000-01-01T00:00:00.000Z'});assert.equal(result.status,401);assert.equal(result.body.code,'ACCESS_REVOKED');assert.equal(result.prepareCalls,0);
});

test('inventory report passes the freshly authenticated role to its data boundary after a delayed body',{timeout:15000},async t=>{
 const result=await delayedRequest(t,{role:'viewer'});assert.equal(result.status,200);assert.equal(result.body.ok,true);assert.equal(result.body.role,'viewer');assert.equal(result.prepareCalls,1);assert.equal(result.principal.role,'viewer');assert.equal(result.principal.id,'test-user');
});
