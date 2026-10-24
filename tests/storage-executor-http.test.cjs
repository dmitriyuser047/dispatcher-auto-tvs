'use strict';
// Real HTTP, production executor and worker; every database is synthetic and
// contained in a pinned temporary directory. Wrappers observe guards; the
// fault test injects a filesystem failure after the durable JSON commit point.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),Module=require('node:module');
const storage=require('../electron/storage.js'),sqlite=require('../electron/sqlite-storage.cjs'),access=require('../electron/access-control.js');
const executor=require('../electron/storage-executor.cjs'),commands=require('../assets/core/platform-commands.js'),kernel=require('../assets/core/platform-kernel.js');
const {writerHeaders}=require('./helpers/http-writer.cjs');
const ROOT=path.resolve(__dirname,'..'),token='synthetic-worker-http-admin-0123456789';
function database(count=1){return {...Object.fromEntries(storage.SECTIONS.map(name=>[name,[]])),vehicles:Array.from({length:count},(_,index)=>({id:'v'+index,plate:'SYNTHETIC-WORKER-'+index,org:'A',fuel:'diesel',fuelGrade:'ДТ',norm:10,fuelBalance:100})),tanks:[{id:'tank',name:'Synthetic HTTP worker tank',org:'A',fuel:'diesel',balanceInit:1000}]};}
function seed(dir,format,data){if(format==='sqlite')sqlite.create(dir,{data});else storage.createJson(dir,{data});}
function call(port,route,payload,headers={}){return new Promise((resolve,reject)=>{
 const raw=JSON.stringify(payload),req=http.request({host:'127.0.0.1',port,path:route,method:'POST',agent:false,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Content-Length':Buffer.byteLength(raw),...headers}},res=>{const chunks=[];res.on('data',part=>chunks.push(part));res.on('end',()=>{try{const text=Buffer.concat(chunks).toString('utf8');resolve({status:res.statusCode,body:JSON.parse(text),text});}catch(error){reject(error);}});});req.on('error',reject);req.setTimeout(30000,()=>req.destroy(Error('Synthetic HTTP worker timeout')));req.end(raw);
});}
async function fixture(t,format,{count=1,backup=true}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-storage-worker-http-')),pin=fs.lstatSync(root),dir=path.join(root,'db'),backupDir=path.join(root,'backups'),state={phases:[],calls:[],completed:0,onPhase:null,onSettings:null};seed(dir,format,database(count));
 let settings={serverAccessConfigured:true,serverUsers:access.normalizeServerUsers([{id:'admin',name:'Synthetic HTTP worker author',role:'admin',enabled:true,tokenHash:access.hashToken(token)},{id:'keeper',name:'Synthetic independent administrator',role:'admin',enabled:true,tokenHash:access.hashToken('synthetic-worker-http-keeper-0123456789')}])};
 const filename=path.join(ROOT,'electron/server.js'),mod=new Module(filename,module),base=Module.createRequire(filename);mod.filename=filename;mod.paths=Module._nodeModulePaths(ROOT);mod.require=name=>name==='./storage-executor.cjs'?{createStorageExecutor(configuration){const real=executor.createStorageExecutor(configuration);return {...real,run(kind,dataDir,input,options,controls){state.calls.push(kind);return real.run(kind,dataDir,input,options,{...controls,assertCurrent(info){state.phases.push(info.phase);state.onPhase?.(info);return controls.assertCurrent(info);}}).finally(()=>{state.completed++;});}};}}:base(name);mod._compile(fs.readFileSync(filename,'utf8'),filename);const api=mod.exports;
 const settingsProvider=()=>{const notify=state.onSettings;state.onSettings=null;notify?.();return settings;},descriptor={directory:backupDir,keep:30,optional:false};
 const started=await api.start({port:0,dataDir:dir,settings:settingsProvider,...(backup?{backup:descriptor}:{})});assert.equal(started.ok,true,started.error);
 t.after(async()=>{await api.stop();const current=fs.lstatSync(root),resolved=path.resolve(root);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.match(path.basename(resolved),/^tvs-storage-worker-http-/);assert.equal(current.isSymbolicLink(),false);assert.equal(current.dev,pin.dev);assert.equal(current.ino,pin.ino);fs.rmSync(resolved,{recursive:true,force:true});});
 const h={root,dir,backupDir,api,state,port:started.port,settingsProvider,descriptor,
  change(patch){settings={...settings,serverUsers:access.normalizeServerUsers(settings.serverUsers.map(user=>user.id==='admin'?{...user,...patch}:user))};},
  headers:()=>writerHeaders({port:h.port,headers:{Authorization:'Bearer '+token}}),
  async post(route,payload,{proof=true}={}){return call(h.port,route,payload,proof?await h.headers():{});},
  sections(id,note='Synthetic worker edit'){const snapshot=storage.readSnapshot(dir);return {databaseToken:snapshot.databaseToken,base:snapshot.revisions,operation:{id},sections:{vehicles:snapshot.data.vehicles.map(row=>({...row,note}))}};},
  command(id){const snapshot=storage.readSnapshot(dir),command={type:'IssueFuel',version:1,input:{tankId:'tank',target:{section:'vehicles',id:'v0'},date:'2026-09-10',qty:1,reason:'Synthetic worker issue'}};return {protocolVersion:1,databaseToken:snapshot.databaseToken,base:Object.fromEntries(commands.dependencies(command).map(name=>[name,snapshot.revisions[name]])),operation:{id},command};},
 };return h;
}
function cleanFailure(response,status,code){assert.equal(response.status,status,response.text);assert.equal(response.body.ok,false);assert.equal(response.body.code,code,response.text);for(const key of ['data','canonicalSections','operationReceipt'])assert.equal(Object.hasOwn(response.body,key),false);}

test('a worker I/O failure after durable commit stays unknown through HTTP and outbox recovery without issuing twice',async t=>{
 const h=await fixture(t,'json',{backup:false}),request=h.command('worker-postcommit-unknown'),headers=await h.headers();
 const threads=require('node:worker_threads'),ActualWorker=threads.Worker;
 threads.Worker=class extends ActualWorker{
  constructor(filename,configuration){
   const source="const fs=require('node:fs'),path=require('node:path'),unlink=fs.unlinkSync;let injected=false;fs.unlinkSync=function(filename,...args){if(!injected&&path.basename(String(filename))==='.transaction.json'){injected=true;throw Object.assign(Error('Synthetic cleanup failure after durable revisions'),{code:'EIO'});}return unlink.call(this,filename,...args);};require("+JSON.stringify(filename)+");";
   super(source,{...configuration,eval:true});
  }
 };
 t.after(()=>{threads.Worker=ActualWorker;});
 const box=require('../electron/command-outbox.cjs').createCommandOutbox({rootDir:path.join(h.root,'outbox')});
 const context={scope:require('node:crypto').createHash('sha256').update('synthetic-postcommit-worker').digest('hex'),databaseToken:request.databaseToken,supportsOperations:true,supportsCommands:true};
 let sends=0,transportError;h.api.configureKey(token);
 const recovery=require('../electron/operation-recovery.cjs').createOperationRecovery({outbox:box,
  send:async(_context,json)=>{sends++;try{return await h.api.postCommands('127.0.0.1',h.port,json,{ticket:headers['x-tvs-write-ticket']});}catch(error){transportError=error;throw error;}},
  lookup:(_context,id,digest)=>h.api.getJson('127.0.0.1',h.port,'/api/operation?id='+encodeURIComponent(id)+'&digest='+encodeURIComponent(digest))
 });
 const result=await recovery.execute(context,request);
 assert.equal(result.ok,false);assert.equal(result.code,'EIO');assert.equal(result.queued,true);
 assert.equal(transportError.status,503);assert.equal(transportError.unknown,true);assert.equal(transportError.definitive,false);
 assert.equal(box.list(context.scope)[0].status,'unknown');
 const committed=storage.readSnapshot(h.dir);assert.equal(committed.data.records.length,1);assert.equal(committed.data.fuelMovements.length,1);assert.equal(committed.data.fuelMovements[0].qty,1);
 const duplicate=await recovery.execute(context,h.command('must-not-issue-again'));assert.equal(duplicate.code,'PENDING_OPERATION');assert.equal(sends,1);
 const checked=await recovery.reconcile(context,request.operation.id);assert.equal(checked.committed,true);assert.equal(box.list(context.scope)[0].status,'committed');
 const replay=await h.api.postCommands('127.0.0.1',h.port,JSON.stringify(request));assert.equal(replay.operationReceipt.status,'replayed');
 assert.deepEqual(storage.readSnapshot(h.dir),committed);assert.equal(sends,1);
 assert.equal(committed.data.auditLog.filter(row=>row.type==='transaction'&&row.operationId===request.operation.id).length,1);
 threads.Worker=ActualWorker;
});

test('a malformed semantic command remains a definite HTTP rejection before any durable write',async t=>{
 const h=await fixture(t,'json',{backup:false}),before=storage.readSnapshot(h.dir),request=h.command('worker-validation-denial');request.command.input.qty=-1;
 const response=await h.post('/api/commands',request);assert.equal(response.status,400,response.text);assert.equal(response.body.ok,false);assert.notEqual(response.body.unknown,true);assert.notEqual(response.body.definitive,false);assert.deepEqual(storage.readSnapshot(h.dir),before);
});

test('HTTP clients preserve explicit uncertain outcome flags from a retained 400 response',async t=>{
 let uncertainty={unknown:true};const instance=http.createServer((request,response)=>{request.resume();response.writeHead(400,{'Content-Type':'application/json'});response.end(JSON.stringify({ok:false,code:'SYNTHETIC_POSTCOMMIT',error:'Synthetic uncertain reply',...uncertainty}));});
 await new Promise(resolve=>instance.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>instance.close(resolve)));
 const client=require('../electron/server.js');client.configureKey(token);
 for(const flags of [{unknown:true},{definitive:false}]){uncertainty=flags;await assert.rejects(client.postSections('127.0.0.1',instance.address().port,'{}'),error=>error.status===400&&error.unknown===true&&error.definitive===false);}
});

for(const format of ['json','sqlite']){
 test(format+' HTTP full writes reject a foreign database identity before base, backup or mutation',async t=>{
  const h=await fixture(t,format),before=storage.readSnapshot(h.dir),request={databaseToken:'synthetic-foreign-database',data:{vehicles:before.data.vehicles,records:[]}};
  const response=await h.post('/api/data',request);cleanFailure(response,409,'DATABASE_CHANGED');assert.equal(response.body.databaseChanged,true);assert.equal(response.body.databaseToken,before.databaseToken);
  assert.equal(response.body.unknown,undefined);assert.equal(fs.existsSync(h.backupDir),false);assert.deepEqual(storage.readSnapshot(h.dir),before);assert.equal(fs.existsSync(path.join(h.dir,'.tvs-database.lock')),false);
 });

 test(format+' real HTTP section write performs heavy validation, backup and commit outside the main event loop',async t=>{
  const h=await fixture(t,format,{count:2000}),request=h.sections('worker-heartbeat'),headers=await h.headers();
  // The large source must be validated without exceeding the independent
  // per-operation audit limit: only one business row actually changes.
  for(const row of request.sections.vehicles.slice(0,-1))delete row.note;
  let ticks=0,lockedTicks=null,commitTicks=null;
  h.state.onPhase=({phase})=>{if(phase==='locked')lockedTicks=ticks;if(phase==='beforeCommit')commitTicks=ticks;};
  const timer=setInterval(()=>ticks++,2);let response;try{response=await call(h.port,'/api/sections',request,headers);}finally{clearInterval(timer);}
  assert.equal(response.status,200,response.text);assert.equal(response.body.ok,true);assert.deepEqual(h.state.calls,['writeSections']);assert.ok(lockedTicks!==null&&commitTicks!==null);assert.ok(commitTicks>lockedTicks,'Main timer must run while the worker holds the database lock and prepares the write');assert.ok(h.state.phases.includes('afterBackup'));assert.ok(h.state.phases.includes('ack'));
  assert.equal(storage.readSnapshot(h.dir).data.vehicles.at(-1).note,'Synthetic worker edit');assert.ok(fs.readdirSync(h.backupDir).some(name=>/^data_.*\.zip$/.test(name)));assert.equal(response.body.operationReceipt.digest,kernel.requestDigest(request));
 });

 test(format+' default HTTP full/command workers preserve principal, dependency CAS, proof gates and receipt-first replay',async t=>{
  const h=await fixture(t,format,{backup:false}),before=storage.readSnapshot(h.dir),full={databaseToken:before.databaseToken,base:before.revisions,operation:{id:'worker-full'},data:{...before.data,vehicles:before.data.vehicles.map(row=>({...row,note:'Full worker edit'}))}};
  const saved=await h.post('/api/data',full);assert.equal(saved.status,200,saved.text);assert.equal(saved.body.ok,true);assert.equal(saved.body.canonicalSections.vehicles[0].note,'Full worker edit');assert.equal((await h.post('/api/data',full,{proof:false})).body.replayed,true);
  const request=h.command('worker-command'),committed=await h.post('/api/commands',request);assert.equal(committed.status,200,committed.text);assert.equal(committed.body.canonicalSections.records[0].fuelIssued,1);assert.equal(committed.body.operationReceipt.digest,kernel.requestDigest(request));
  for(const row of committed.body.canonicalSections.auditLog.filter(row=>row.operationId==='worker-command')){assert.equal(row.actorId,'admin');assert.equal(row.actor,'Synthetic HTTP worker author');assert.equal(row.actorRole,'admin');}
  const after=storage.readSnapshot(h.dir),replay=await h.post('/api/commands',request,{proof:false});assert.equal(replay.status,200,replay.text);assert.equal(replay.body.replayed,true);assert.deepEqual(storage.readSnapshot(h.dir),after);
  const stale={...request,operation:{id:'worker-stale-command'}},conflict=await h.post('/api/commands',stale);cleanFailure(conflict,409,'COMMAND_CONFLICT');assert.deepEqual(storage.readSnapshot(h.dir),after);
  const current=h.command('worker-unnegotiated');cleanFailure(await h.post('/api/commands',current,{proof:false}),428,'PROTOCOL_RENEGOTIATE');assert.deepEqual(storage.readSnapshot(h.dir),after);
  assert.ok(h.state.calls.includes('writeAll'));assert.ok(h.state.calls.includes('executeCommand'));
 });

 for(const phase of ['beforeCommit','afterBackup'])test(format+' HTTP worker rechecks current permissions '+phase+' while holding the physical lock',async t=>{
  const h=await fixture(t,format),before=storage.readSnapshot(h.dir),request=h.sections('worker-revoked-'+phase),headers=await h.headers();let changed=false;
  h.state.onPhase=info=>{if(!changed&&info.phase===phase){changed=true;h.change({role:'viewer'});}};
  const response=await call(h.port,'/api/sections',request,headers);cleanFailure(response,403,'ACCESS_CHANGED');assert.equal(changed,true);assert.deepEqual(storage.readSnapshot(h.dir),before);assert.equal(fs.existsSync(path.join(h.dir,'.tvs-database.lock')),false);
  if(phase==='beforeCommit')assert.equal(fs.existsSync(h.backupDir),false);else assert.ok(fs.readdirSync(h.backupDir).some(name=>name.endsWith('.zip')));
 });

 test(format+' late ACK permission changes stay unknown and the original committed operation remains recoverable',async t=>{
  const h=await fixture(t,format,{backup:false}),request=h.sections('worker-ack-changed'),headers=await h.headers();let changed=false;
  h.state.onPhase=info=>{if(!changed&&info.phase==='ack'){changed=true;h.change({role:'viewer'});}};
  const response=await call(h.port,'/api/sections',request,headers);cleanFailure(response,503,'STORAGE_ACK_STALE');assert.equal(response.body.unknown,true);assert.equal(response.body.definitive,false);assert.equal(storage.readSnapshot(h.dir).data.vehicles[0].note,'Synthetic worker edit');
  h.change({role:'admin'});h.state.onPhase=null;const recovered=await h.post('/api/sections',request,{proof:false});assert.equal(recovered.status,200,recovered.text);assert.equal(recovered.body.replayed,true);
 });
}

test('stopping and restarting HTTP cannot give a slow old upload the new database or proof issuer',async t=>{
 const h=await fixture(t,'json',{backup:false}),old=h.sections('slow-old-host'),before=storage.readSnapshot(h.dir),headers=await h.headers(),raw=JSON.stringify(old);let release;
 const authenticated=new Promise(resolve=>{h.state.onSettings=resolve;}),pending=new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:h.port,path:'/api/sections',method:'POST',agent:false,headers:{...headers,Authorization:'Bearer '+token,'Content-Type':'application/json','Content-Length':Buffer.byteLength(raw)}},res=>{const chunks=[];res.on('data',part=>chunks.push(part));res.on('end',()=>{const text=Buffer.concat(chunks).toString('utf8');resolve({status:res.statusCode,body:JSON.parse(text),text});});});req.on('error',reject);req.setTimeout(10000,()=>req.destroy(Error('Synthetic slow restart timeout')));release=()=>req.end(raw.slice(-1));req.write(raw.slice(0,-1));});
 const settled=pending.catch(error=>({connectionError:error.code}));
 await authenticated;const stopping=h.api.stop(),nextDir=path.join(h.root,'next-db');seed(nextDir,'json',database());const nextBefore=storage.readSnapshot(nextDir),started=await h.api.start({port:0,dataDir:nextDir,settings:h.settingsProvider});assert.equal(started.ok,true);h.port=started.port;
 release();const oldResult=await settled;if(oldResult.connectionError)assert.ok(['ECONNRESET','EPIPE'].includes(oldResult.connectionError));else cleanFailure(oldResult,503,'SERVER_STOPPED');await stopping;assert.deepEqual(storage.readSnapshot(h.dir),before);assert.deepEqual(storage.readSnapshot(nextDir),nextBefore);
 const fresh={databaseToken:nextBefore.databaseToken,base:nextBefore.revisions,operation:{id:'new-host-old-ticket'},sections:{vehicles:nextBefore.data.vehicles.map(row=>({...row,note:'Must not cross issuer'}))}};
 cleanFailure(await call(h.port,'/api/sections',fresh,headers),428,'PROTOCOL_RENEGOTIATE');assert.deepEqual(storage.readSnapshot(nextDir),nextBefore);
});

test('HTTP stop finishes without waiting for an incomplete request body to be released',async t=>{
 const h=await fixture(t,'json',{backup:false}),request=h.sections('never-finished-upload'),before=storage.readSnapshot(h.dir),raw=JSON.stringify(request),headers=await h.headers();
 const authenticated=new Promise(resolve=>{h.state.onSettings=resolve;}),pending=new Promise(resolve=>{
  const req=http.request({host:'127.0.0.1',port:h.port,path:'/api/sections',method:'POST',agent:false,headers:{...headers,Authorization:'Bearer '+token,'Content-Type':'application/json','Content-Length':Buffer.byteLength(raw)}},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode}));});req.on('error',error=>resolve({code:error.code}));req.write(raw.slice(0,-1));
 });
 await authenticated;let timeout;try{await Promise.race([h.api.stop(),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('HTTP stop still waits for an unfinished body')),3000);})]);}finally{clearTimeout(timeout);}
 const result=await pending;assert.ok(result.status===503||['ECONNRESET','EPIPE'].includes(result.code));assert.deepEqual(storage.readSnapshot(h.dir),before);assert.equal(h.state.calls.length,0);
});

test('repeated HTTP stop awaits the same still-active storage drain after the server instance has been cleared',async t=>{
 const h=await fixture(t,'json',{backup:false}),before=storage.readSnapshot(h.dir),request=h.sections('worker-repeated-stop'),headers=await h.headers();let first,second,completedAtSecond=null;
 h.state.onPhase=info=>{if(info.phase==='beforeCommit'&&!first){first=h.api.stop();second=h.api.stop().then(()=>{completedAtSecond=h.state.completed;});}};
 const response=await call(h.port,'/api/sections',request,headers);cleanFailure(response,503,'SERVER_STOPPED');assert.ok(first&&second);await Promise.all([first,second]);assert.equal(completedAtSecond,1);assert.deepEqual(storage.readSnapshot(h.dir),before);
});
