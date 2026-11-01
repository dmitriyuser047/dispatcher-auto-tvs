'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {Worker}=require('node:worker_threads'),{setTimeout:delay}=require('node:timers/promises');
const {acquireForDispatch}=require('../electron/storage-dispatch-lock.cjs'),{createStorageExecutor}=require('../electron/storage-executor.cjs');
const storage=require('../electron/storage'),sqlite=require('../electron/sqlite-storage.cjs'),backend=require('../electron/server.js'),access=require('../electron/access-control.js');
const principal={id:'synthetic-lock-wait-admin',name:'Synthetic lock wait admin',role:'admin'},now='2026-10-28T09:00:00.000Z';
const busy=()=>Object.assign(Error('Synthetic managed lock owner'),{code:'DB_BUSY'});

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-dispatch-lock-')),identity=fs.lstatSync(root),dir=path.join(root,'db'),cleanup=[];
 sqlite.create(dir,{data:{vehicles:[{id:'v',plate:'SYNTHETIC LOCK WAIT',org:'Synthetic organization'}]}});
 const before=storage.readSnapshot(dir),payload={databaseToken:before.databaseToken,base:before.revisions,sections:{vehicles:before.data.vehicles.map(row=>({...row,note:'Synthetic single dispatch'}))},operation:{id:'synthetic-lock-wait'}};
 t.after(async()=>{for(const close of cleanup.reverse())await close();const absolute=fs.realpathSync(root),current=fs.lstatSync(root);assert.equal(path.dirname(absolute),fs.realpathSync(os.tmpdir()));assert.match(path.basename(absolute),/^tvs-dispatch-lock-/);assert.equal(current.isSymbolicLink(),false);assert.equal(current.dev,identity.dev);assert.equal(current.ino,identity.ino);fs.rmSync(absolute,{recursive:true,force:true});});
 return {root,dir,before,payload,cleanup,executor(){const value=createStorageExecutor();cleanup.push(()=>value.close());return value;}};
}
async function holdManagedLock(f){
 const signal=new SharedArrayBuffer(4),state=new Int32Array(signal);
 const worker=new Worker("const {workerData,parentPort}=require('node:worker_threads');require(workerData.storage).withDatabaseLock(workerData.dir,()=>{parentPort.postMessage('locked');Atomics.wait(new Int32Array(workerData.signal),0,0,15000);});parentPort.close();",{eval:true,workerData:{storage:require.resolve('../electron/storage.js'),dir:f.dir,signal}});
 let failure;worker.on('error',error=>{failure=error;});const done=new Promise(resolve=>worker.once('exit',resolve));
 await new Promise((resolve,reject)=>{worker.once('message',message=>message==='locked'?resolve():reject(Error('Unexpected lock observation')));worker.once('error',reject);});
 let released=false;const release=async()=>{if(released)return;released=true;Atomics.store(state,0,1);Atomics.notify(state,0);const code=await done;if(failure)throw failure;assert.equal(code,0);};f.cleanup.push(release);return {release};
}
function call(port,route,token,payload){return new Promise((resolve,reject)=>{const raw=JSON.stringify(payload),req=http.request({hostname:'127.0.0.1',port,path:route,method:'POST',agent:false,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Content-Length':Buffer.byteLength(raw),'X-TVS-Writer-Schema':String(require('../electron/storage-format.cjs').SCHEMA_VERSION)}},res=>{const chunks=[];res.on('data',part=>chunks.push(part));res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))});}catch(error){reject(error);}});});req.on('error',reject);req.setTimeout(15000,()=>req.destroy(Error('Synthetic lock wait HTTP timeout')));req.end(raw);});}

test('dispatch waits for acquisition only and invokes the action exactly once',()=>{
 let acquisitions=0,actions=0;const result=acquireForDispatch('synthetic',physical=>{actions++;assert.equal(physical,'owned');return 'committed';},{acquire:(_,action)=>{if(++acquisitions<3)throw busy();return action('owned');}});
 assert.equal(result,'committed');assert.equal(acquisitions,3);assert.equal(actions,1);
});
test('DB_BUSY after entry is never retried even if no business commit has begun',()=>{
 let acquisitions=0,actions=0;const error=busy();assert.throws(()=>acquireForDispatch('synthetic',()=>{actions++;throw error;},{acquire:(_,action)=>{acquisitions++;return action('owned');}}),value=>value===error);
 assert.equal(acquisitions,1);assert.equal(actions,1);assert.equal(error.definitive,undefined);
});
test('an exhausted pre-dispatch lock wait is a definitive HTTP503 error without an action',()=>{
 let actions=0,acquisitions=0;assert.throws(()=>acquireForDispatch('synthetic',()=>{actions++;},{waitMs:0,acquire:()=>{acquisitions++;throw busy();}}),error=>error.code==='DB_BUSY'&&error.status===503&&error.definitive===true&&error.unknown===false);
 assert.equal(actions,0);assert.equal(acquisitions,1);
});
test('other acquisition errors propagate once and the wait budget is bounded',()=>{
 let acquisitions=0;const error=Object.assign(Error('Synthetic incompatible storage'),{code:'SQLITE_FORMAT'});assert.throws(()=>acquireForDispatch('synthetic',()=>{}, {acquire:()=>{acquisitions++;throw error;}}),value=>value===error);assert.equal(acquisitions,1);
 for(const waitMs of [-1,5001,Infinity,1.5])assert.throws(()=>acquireForDispatch('synthetic',()=>{}, {waitMs}),TypeError);
});
test('a real SQLite worker waits for a managed reader then commits one operation',async t=>{
 const f=fixture(t),executor=f.executor(),holder=await holdManagedLock(f),phases=[];let settled=false;
 const pending=executor.run('writeSections',f.dir,f.payload,{principal,now},{assertCurrent:({phase})=>phases.push(phase)});pending.then(()=>{settled=true;},()=>{settled=true;});
 try{await delay(250);assert.equal(settled,false,'The worker must wait for the managed reader instead of rejecting the write');await holder.release();const result=await pending;assert.equal(result.ok,true);assert.equal(result.operationReceipt.status,'committed');}finally{await holder.release();await pending.catch(()=>{});}
 for(const phase of ['dispatch','locked','beforeCommit','afterBackup','ack'])assert.equal(phases.filter(value=>value===phase).length,1,phase);
 const after=storage.readSnapshot(f.dir);assert.equal(after.data.vehicles[0].note,'Synthetic single dispatch');assert.equal(after.revisions.vehicles,f.before.revisions.vehicles+1);assert.equal(after.data.auditLog.filter(row=>row.operationId===f.payload.operation.id&&row.type==='transaction').length,1);
});
test('a real worker never re-enters a callback whose locked guard returns DB_BUSY',async t=>{
 const f=fixture(t),executor=f.executor();let locked=0;
 await assert.rejects(executor.run('writeSections',f.dir,f.payload,{principal,now},{assertCurrent:({phase})=>{if(phase==='locked'){locked++;throw Object.assign(busy(),{status:503,definitive:true});}}}),error=>error.code==='DB_BUSY'&&error.status===503&&error.definitive===true);
 assert.equal(locked,1);assert.deepEqual(storage.readSnapshot(f.dir),f.before);
});
test('a persistent managed lock returns definitive503 through HTTP without disclosing its path or committing',async t=>{
 const f=fixture(t),token='synthetic-lock-wait-personal-key-0123456789',settings={serverAccessConfigured:true,serverUsers:access.normalizeServerUsers([{...principal,enabled:true,tokenHash:access.hashToken(token)}])};
 const started=await backend.start({port:0,host:'127.0.0.1',dataDir:f.dir,settings});assert.equal(started.ok,true);f.cleanup.push(()=>backend.stop());const holder=await holdManagedLock(f);let result;
 try{result=await call(started.port,'/api/sections',token,f.payload);}finally{await holder.release();}
 assert.equal(result.status,503);assert.equal(result.body.code,'DB_BUSY');assert.equal(result.body.definitive,true);assert.equal(Object.hasOwn(result.body,'unknown'),false);assert.doesNotMatch(JSON.stringify(result.body),/tvs-dispatch-lock-|\.tvs-database\.lock|Synthetic managed lock owner/);
 assert.deepEqual(storage.readSnapshot(f.dir),f.before);
});
