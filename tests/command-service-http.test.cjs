'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const storage=require('../electron/storage');
const sqlite=require('../electron/sqlite-storage.cjs');
const server=require('../electron/server');
const access=require('../electron/access-control');
const commands=require('../assets/core/platform-commands.js');
const kernel=require('../assets/core/platform-kernel.js');

function call(port,route,token,value,extraHeaders={}){
 return new Promise((resolve,reject)=>{
  const raw=typeof value==='string'?value:JSON.stringify(value);
  const req=http.request({host:'127.0.0.1',port,path:route,method:'POST',agent:false,headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json','Content-Length':Buffer.byteLength(raw),...extraHeaders}},res=>{
   let text='';res.setEncoding('utf8');res.on('data',part=>{text+=part;});res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(text),text});}catch(error){reject(error);}});
  });req.setTimeout(5000,()=>req.destroy(Error('Synthetic command HTTP timeout')));req.on('error',reject);req.end(raw);
 });
}
function issue(input={}){return {type:'IssueFuel',version:1,input:{tankId:'t',target:{section:'vehicles',id:'v'},date:'2026-09-10',qty:23.537,reason:'Synthetic HTTP transfer',...input}};}
function accept(){return {type:'AcceptShift',version:1,input:{shiftId:'s',changes:{acceptedBy:'Manual HTTP business recipient'}}};}
function envelope(dir,command,id='http-command'){
 const snapshot=storage.readSnapshot(dir);
 return {protocolVersion:1,databaseToken:snapshot.databaseToken,operation:{id},base:Object.fromEntries(commands.dependencies(command).map(name=>[name,snapshot.revisions[name]])),command};
}
async function fixture(t,format){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-command-http-')),dir=path.join(root,'db');
 t.after(()=>{server.stop();server.configureKey('');server.configureTransport();assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('tvs-command-http-'));fs.rmSync(root,{recursive:true,force:true});});
 const data={vehicles:[{id:'v',plate:'SYNTHETIC HTTP',org:'A',fuel:'diesel',fuelGrade:'ДТ',norm:10,fuelBalance:0}],records:[],generators:[],genRecords:[],tanks:[{id:'t',name:'Synthetic HTTP tank',org:'A',fuel:'diesel',balanceInit:923.537}],tankIncomes:[],fuelMovements:[],drivers:[{id:'d',name:'Synthetic HTTP driver',personnelRoles:['driver'],employmentStatus:'active'}],assetAssignments:[],shiftReports:[{id:'s',title:'Synthetic HTTP sent shift',date:'2026-09-10',assetRef:'v:v',driverId:'d',status:'sent',hours:2}],dispatchJobs:[],payments:[{id:'private-http-payment',sum:9988776655,description:'FINANCIAL-HTTP-SECRET'}]};
 if(format==='sqlite')sqlite.create(dir,{data});else storage.writeAll(dir,data);
 const tokens=Object.fromEntries(['root','admin','dispatcher','mechanic','accountant','viewer'].map(role=>[role,'synthetic-command-http-'+role+'-1234567890']));
 let settings={serverAccessConfigured:true,serverUsers:access.normalizeServerUsers(Object.keys(tokens).map(key=>({id:'http-'+key,name:'Synthetic '+key,role:key==='root'?'admin':key,enabled:true,tokenHash:access.hashToken(tokens[key])})))};
 let onSettingsRead,backups=0;
 const start=await server.start({port:0,dataDir:dir,settings:()=>{const current=settings,notify=onSettingsRead;onSettingsRead=null;if(notify)notify();return current;},backupFn:()=>{backups++;}});assert.equal(start.ok,true);
 const harness={dir,data,tokens,port:start.port,get backups(){return backups;},
  principal(key){const user=settings.serverUsers.find(row=>row.id==='http-'+key);return {id:user.id,name:user.name,role:user.role};},
  changeUser(key,change){settings={...settings,serverUsers:access.normalizeServerUsers(settings.serverUsers.map(user=>user.id==='http-'+key?{...user,...change}:user))};},
  post(value,role='admin',headers={}){return call(start.port,'/api/commands',tokens[role],value,headers);},
  async uploadThenChange(value,role,change){
   const raw=JSON.stringify(value),authenticated=new Promise(resolve=>{onSettingsRead=resolve;});let finish;
   const response=new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port:start.port,path:'/api/commands',method:'POST',agent:false,headers:{Authorization:'Bearer '+tokens[role],'Content-Type':'application/json','Content-Length':Buffer.byteLength(raw)}},res=>{
     let text='';res.setEncoding('utf8');res.on('data',part=>{text+=part;});res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(text),text});}catch(error){reject(error);}});
    });req.setTimeout(5000,()=>req.destroy(Error('Synthetic slow command upload timeout')));req.on('error',reject);finish=()=>req.end(raw.slice(-1));req.write(raw.slice(0,-1));
   });
   await authenticated;harness.changeUser(role,change);finish();return response;
  }};
 return harness;
}
function safeError(result,status,code){
 assert.equal(result.status,status,result.text);assert.equal(result.body.ok,false);if(code)assert.equal(result.body.code,code,result.text);
 for(const key of ['data','canonicalSections','operationReceipt'])assert.equal(Object.hasOwn(result.body,key),false,key);
 assert.doesNotMatch(result.text,/FINANCIAL-HTTP-SECRET|9988776655/);
}

for(const format of ['json','sqlite']){
 test('HTTP '+format+' dispatcher command returns canonical fractional rows and a usable receipt without private finance',async t=>{
  const h=await fixture(t,format),request=envelope(h.dir,issue()),before=storage.readSnapshot(h.dir),result=await h.post(request,'dispatcher');
  assert.equal(result.status,200,result.text);assert.equal(result.body.ok,true);assert.deepEqual(result.body.changed.slice().sort(),['auditLog','fuelMovements','records']);assert.equal(result.body.canonicalSections.records[0].fuelIssued,23.537);assert.equal(result.body.canonicalSections.fuelMovements[0].qty,23.537);assert.equal(result.body.operationReceipt.digest,kernel.requestDigest(request));assert.equal(result.body.operationReceipt.status,'committed');
  assert.equal(Object.hasOwn(result.body.revisions,'payments'),false);assert.equal(Object.hasOwn(result.body.canonicalSections,'payments'),false);assert.doesNotMatch(result.text,/FINANCIAL-HTTP-SECRET|9988776655/);
  const events=result.body.canonicalSections.auditLog.filter(row=>row.operationId===request.operation.id);assert.ok(events.length>=3);for(const row of events){assert.equal(row.actorId,h.principal('dispatcher').id);assert.equal(row.actorRole,'dispatcher');}
  const after=storage.readSnapshot(h.dir);assert.deepEqual(after.data.payments,before.data.payments);assert.equal(after.data.tanks[0].balanceInit,923.537);assert.equal(after.revisions.tanks,before.revisions.tanks);assert.equal(h.backups,1);
  const replay=await h.post(request,'dispatcher');assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.deepEqual(replay.body.canonicalSections.records,after.data.records);assert.deepEqual(storage.readSnapshot(h.dir),after);assert.equal(h.backups,1);
 });

 test('HTTP '+format+' all dependency CAS, stale database and mismatching intent reject without partial writes',async t=>{
  const h=await fixture(t,format),request=envelope(h.dir,issue()),before=storage.readSnapshot(h.dir);
  const missing=structuredClone(request);delete missing.base.tanks;safeError(await h.post(missing),428,'COMMAND_BASE_REQUIRED');assert.deepEqual(storage.readSnapshot(h.dir),before);
  const edited=before.data.tanks.map(row=>({...row,name:'Concurrent synthetic HTTP edit'}));assert.equal(storage.writeSections(h.dir,{databaseToken:before.databaseToken,base:before.revisions,sections:{tanks:edited}},{principal:h.principal('admin')}).ok,true);const current=storage.readSnapshot(h.dir);
  const stale=await h.post(request);safeError(stale,409,'COMMAND_CONFLICT');assert.deepEqual(stale.body.conflicts,['tanks']);assert.deepEqual(storage.readSnapshot(h.dir),current);
  const fresh=envelope(h.dir,issue());safeError(await h.post({...fresh,databaseToken:'different-database-token'}),409,'DATABASE_CHANGED');assert.deepEqual(storage.readSnapshot(h.dir),current);
  safeError(await h.post({...fresh,operation:{...fresh.operation,digest:'sha256:'+'a'.repeat(64)}}),409,'OPERATION_DIGEST');assert.deepEqual(storage.readSnapshot(h.dir),current);assert.equal(h.backups,0);
  const committed=await h.post(fresh);assert.equal(committed.status,200);const after=storage.readSnapshot(h.dir),modified={...fresh,command:issue({qty:1})};safeError(await h.post(modified),409,'OPERATION_REUSED');assert.deepEqual(storage.readSnapshot(h.dir),after);assert.equal(h.backups,1);
 });

 test('HTTP '+format+' replay is receipt-first but remains bound to current account, role and read permissions',async t=>{
  const h=await fixture(t,format),request=envelope(h.dir,issue());assert.equal((await h.post(request)).status,200);const after=storage.readSnapshot(h.dir);
  safeError(await h.post(request,'root'),409,'OPERATION_REUSED');assert.deepEqual(storage.readSnapshot(h.dir),after);
  h.changeUser('admin',{name:'Renamed current synthetic account'});const renamed=await h.post(request);assert.equal(renamed.status,200);assert.equal(renamed.body.replayed,true);assert.equal(renamed.body.operationReceipt.digest,kernel.requestDigest(request));
  h.changeUser('admin',{role:'viewer'});safeError(await h.post(request),409,'OPERATION_REUSED');assert.deepEqual(storage.readSnapshot(h.dir),after);
  h.changeUser('admin',{enabled:false});const backups=h.backups;safeError(await h.post(request),401);assert.equal(h.backups,backups);assert.deepEqual(storage.readSnapshot(h.dir),after);
 });

 test('HTTP '+format+' malformed commands, actor injection and arbitrary transport fields never write or expose source data',async t=>{
  const h=await fixture(t,format),request=envelope(h.dir,issue()),before=storage.readSnapshot(h.dir);
  const invalid=[null,[],1,{}, {...request,protocolVersion:2},{...request,sections:{records:[]}},{...request,sql:'DROP TABLE platform_rows'},{...request,principal:{role:'admin'}},{...request,now:'2000-01-01T00:00:00.000Z'},{...request,base:null},{...request,command:{...request.command,input:{...request.command.input,actor:{id:'forged',role:'admin'}}}},{...request,command:issue({qty:0})},{...request,command:issue({qty:-1})},{...request,command:issue({date:'2026-02-30'})},{...request,command:{type:'CustomSQL',version:1,input:{}}}];
  for(const value of invalid){const result=await h.post(value);safeError(result,400);assert.deepEqual(storage.readSnapshot(h.dir),before);}
  for(const raw of ['{','{"protocolVersion":1,"__proto__":{}}',JSON.stringify(request).replace('23.537','1e400')]){safeError(await h.post(raw),400);assert.deepEqual(storage.readSnapshot(h.dir),before);}
  for(const role of ['viewer','mechanic','accountant']){safeError(await h.post(request,role),403,'ACCESS_DENIED');assert.deepEqual(storage.readSnapshot(h.dir),before);}
  const backups=h.backups;assert.equal(backups,0);safeError(await h.post(request,'admin',{Origin:'http://untrusted.invalid'}),401);safeError(await call(h.port,'/api/commands',null,request),401);assert.equal(h.backups,backups);assert.deepEqual(storage.readSnapshot(h.dir),before);
 });

 test('HTTP '+format+' reauthenticates a slow command body before revoked or demoted credentials can mutate',async t=>{
  const h=await fixture(t,format),request=envelope(h.dir,issue()),before=storage.readSnapshot(h.dir),initialBackups=h.backups;
  safeError(await h.uploadThenChange(request,'admin',{enabled:false}),401);assert.equal(h.backups,initialBackups);assert.deepEqual(storage.readSnapshot(h.dir),before);
  h.changeUser('admin',{enabled:true});safeError(await h.uploadThenChange(request,'admin',{role:'viewer'}),403,'ACCESS_DENIED');assert.equal(h.backups,initialBackups);assert.deepEqual(storage.readSnapshot(h.dir),before);
  h.changeUser('admin',{role:'admin'});safeError(await h.uploadThenChange(request,'admin',{tokenHash:access.hashToken('synthetic-rotated-command-http-token')}),401);assert.deepEqual(storage.readSnapshot(h.dir),before);
 });

 test('HTTP '+format+' current post-body principal owns acceptance ACK and audit while manual acceptedBy survives',async t=>{
  const h=await fixture(t,format),request=envelope(h.dir,accept()),before=storage.readSnapshot(h.dir),result=await h.uploadThenChange(request,'admin',{name:'Current account after upload',role:'dispatcher'});
  assert.equal(result.status,200,result.text);assert.equal(result.body.ok,true);const row=result.body.canonicalSections.shiftReports[0];assert.equal(row.status,'accepted');assert.equal(row.acceptedBy,'Manual HTTP business recipient');assert.deepEqual(row.acceptedActor,{id:'http-admin',name:'Current account after upload',role:'dispatcher'});assert.equal(row.acceptedAt,result.body.operationReceipt.at);
  const audit=result.body.canonicalSections.auditLog.filter(row=>row.operationId===request.operation.id);assert.ok(audit.length>=2);for(const event of audit){assert.equal(event.actorId,'http-admin');assert.equal(event.actor,'Current account after upload');assert.equal(event.actorRole,'dispatcher');}
  const after=storage.readSnapshot(h.dir);for(const name of ['records','genRecords','fuelMovements','vehicles','drivers'])assert.deepEqual(after.data[name],before.data[name]);server.configureKey(h.tokens.admin);const receipt=await server.getJson('127.0.0.1',h.port,'/api/operation?id='+encodeURIComponent(request.operation.id)+'&digest='+encodeURIComponent(kernel.requestDigest(request)));
  assert.equal(receipt.ok,true);assert.deepEqual(receipt.operationReceipt,{...result.body.operationReceipt,status:'committed'});assert.equal(h.backups,1);
 });

 test('HTTP '+format+' configured postCommands client preserves commit/replay and typed definitive failures',async t=>{
  const h=await fixture(t,format),request=envelope(h.dir,issue());server.configureTransport({protocol:'http:'});server.configureKey(h.tokens.dispatcher);
  const result=await server.postCommands('127.0.0.1',h.port,JSON.stringify(request));assert.equal(result.ok,true);assert.equal(result.operationReceipt.digest,kernel.requestDigest(request));const after=storage.readSnapshot(h.dir);
  const replay=await server.postCommands('127.0.0.1',h.port,JSON.stringify(request));assert.equal(replay.replayed,true);assert.deepEqual(storage.readSnapshot(h.dir),after);
  const reused=await server.postCommands('127.0.0.1',h.port,JSON.stringify({...request,command:issue({qty:1})}));assert.equal(reused.ok,false);assert.equal(reused.code,'OPERATION_REUSED');
  await assert.rejects(server.postCommands('127.0.0.1',h.port,JSON.stringify({...request,sql:'SELECT 1'})),error=>error.status===400&&error.definitive===true);assert.deepEqual(storage.readSnapshot(h.dir),after);
 });
}

test('postCommands reports an older server as unsupported without falling back to raw full writes',async t=>{
 let calls=[];const legacy=http.createServer((req,res)=>{calls.push({method:req.method,url:req.url});req.resume();req.on('end',()=>{res.writeHead(404,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,error:'Synthetic old server'}));});});
 await new Promise(resolve=>legacy.listen(0,'127.0.0.1',resolve));t.after(()=>{legacy.close();server.configureKey('');server.configureTransport();});server.configureKey('synthetic-old-server-token');server.configureTransport({protocol:'http:'});
 const result=await server.postCommands('127.0.0.1',legacy.address().port,JSON.stringify({protocolVersion:1}));assert.deepEqual(result,{ok:false,unsupported:true,code:'UNSUPPORTED_COMMANDS'});assert.deepEqual(calls,[{method:'POST',url:'/api/commands'}]);
});
