'use strict';
// Isolated loopback HTTP only. Receipt cryptography belongs to the IPC service tests.
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const transport=require('../electron/des-object-transport.cjs');
const key='SYNTHETIC_PRIVATE_NETWORK_CREDENTIAL';
async function endpoint(t,handler){const server=http.createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));});return {remoteHost:'127.0.0.1',remotePort:server.address().port,remoteProtocol:'http:',networkKey:key};}
function json(res,value,status=200){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));}

test('connection normalization accepts UI protocol names but refuses public cleartext, invalid ports and credential injection before connecting',()=>{
 assert.equal(transport.normalizeConnection({host:'127.0.0.1',port:3377,protocol:'http',token:key}).remoteProtocol,'http:');assert.equal(transport.normalizeConnection({host:'example.test',port:443,protocol:'https',token:key}).remoteProtocol,'https:');
 for(const input of [{host:'8.8.8.8',protocol:'http:'},{host:'public.example',protocol:'http:'},{host:'127.0.0.1.evil.test',protocol:'http:'},{host:'127.0.0.1:3377'},{host:'https://example.test'},{host:'user@example.test'},{host:42},{host:'127.0.0.1',port:0},{host:'127.0.0.1',port:65536},{host:'127.0.0.1',port:''},{host:'127.0.0.1',token:key+'\n'},{host:'127.0.0.1',caPem:'not a certificate'}])assert.throws(()=>transport.normalizeConnection({host:'127.0.0.1',protocol:'https:',token:key,...input}),error=>['DES_CONNECTION','DES_HTTPS_REQUIRED'].includes(error.code)&&!error.message.includes(key));
});

test('HTTP forwards a signed partial receipt candidate unchanged for main verification even when its outer ok is false',async t=>{
 const receipt={kind:'receipt',signature:{algorithm:'Ed25519',publicKey:'opaque-public-key',keyId:'opaque-key-id',value:'opaque-signature'},payload:{outcomes:[{status:'pending'}]}},expected={ok:false,partial:true,pending:true,receipt};let observed;
 const connection=await endpoint(t,(req,res)=>{const chunks=[];req.on('data',part=>chunks.push(part));req.on('end',()=>{observed={url:req.url,headers:req.headers,body:JSON.parse(Buffer.concat(chunks).toString())};json(res,expected);});});const input={action:'applyImport',bundle:{kind:'changes'},reviewFingerprint:'reviewed',reason:'Synthetic confirmed operation'},reply=await transport.request(connection,input);assert.deepEqual(reply,expected);assert.equal(observed.url,'/api/des-object');assert.equal(observed.headers.authorization,'Bearer '+key);assert.equal(observed.headers['x-tvs-writer-schema'],'6');assert.deepEqual(observed.body,input);assert.equal(observed.url.includes(key),false);assert.equal(JSON.stringify(observed.body).includes(key),false);
});

test('an ordinary denial redacts the credential and unsigned error payloads cannot masquerade as partial acknowledgement',async t=>{
 let signed=false;const connection=await endpoint(t,(_req,res)=>json(res,signed?{ok:false,partial:true,receipt:{kind:'receipt'},error:'Reflected '+key}:{ok:false,code:'ACCESS_DENIED',error:'Rejected Bearer '+key},signed?200:403));
 await assert.rejects(transport.request(connection,{action:'previewImport'}),error=>error.code==='ACCESS_DENIED'&&!error.message.includes(key)&&error.message.includes('[скрыто]'));signed=true;await assert.rejects(transport.request(connection,{action:'applyImport'}),error=>error.code==='DES_SERVER_REFUSED'&&!error.message.includes(key));
});

test('request and response byte limits fail before unbounded buffering and invalid JSON stays a transport error',async t=>{
 let requests=0,mode='large';const connection=await endpoint(t,(_req,res)=>{requests++;if(mode==='large')res.end('x'.repeat(1024));else res.end('{');});assert.throws(()=>transport.request(connection,{payload:'x'.repeat(1024)},{maxBytes:128}),error=>error.code==='DES_PACKAGE_LIMIT');assert.equal(requests,0);await assert.rejects(transport.request(connection,{action:'status'},{maxBytes:128}),error=>error.code==='DES_PACKAGE_LIMIT');mode='invalid';await assert.rejects(transport.request(connection,{action:'status'}),error=>error.code==='DES_RESPONSE');assert.throws(()=>transport.request(connection,undefined),error=>error.code==='DES_REQUEST');assert.throws(()=>transport.request(connection,{},{timeoutMs:0}),error=>error.code==='DES_REQUEST');assert.equal(transport.MAX_BYTES,32*1024*1024);
});

test('the whole HTTP request has a deadline even while a server continues sending small chunks',async t=>{
 const timers=new Set(),connection=await endpoint(t,(req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.write('{');const timer=setInterval(()=>res.write(' '),10);timers.add(timer);req.once('close',()=>{clearInterval(timer);timers.delete(timer);});});t.after(()=>{for(const timer of timers)clearInterval(timer);});const started=Date.now();await assert.rejects(transport.request(connection,{action:'status'},{timeoutMs:60}),error=>error.code==='DES_TIMEOUT'&&!error.message.includes(key));assert.ok(Date.now()-started<1000);
});
