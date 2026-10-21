'use strict';
// Repeatable synthetic benchmark. Every database is generated in an owned temp
// directory. No settings, user data directories, releases, or live DBs are read.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {performance,monitorEventLoopDelay}=require('node:perf_hooks');
const {spawnSync}=require('node:child_process');
const {Worker}=require('node:worker_threads');
const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'..'),schema=require('../assets/core/platform-schema.js');
const storage=require('../electron/storage'),sqlite=require('../electron/sqlite-storage.cjs');
const dataQuery=require('../electron/data-query.cjs');
const application=require('../assets/core/application-engine.js'),fuel=require('../assets/core/fuel-engine.js');
const policies=require('../assets/core/platform-policies.js'),integrity=require('../assets/core/platform-integrity.js');
const kernel=require('../assets/core/platform-kernel.js');
const clone=value=>JSON.parse(JSON.stringify(value)),round=value=>Math.round(value*100)/100,mb=value=>round(value/1024/1024);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const context={today:'2026-10-21',now:'2026-10-21T12:00:00.000Z',readable:schema.sections,writable:schema.sections};
function fixture(count){
 const data=Object.fromEntries(schema.sections.map(name=>[name,[]])),assets=Math.max(1,Math.floor(count/10));
 for(let asset=0;asset<assets;asset++){
  const id='perf-v-'+asset,driver='perf-driver-'+asset;
  data.vehicles.push({id,plate:'SYNTHETIC-'+asset,make:'Synthetic test asset',fuel:'diesel',fuelGrade:'ДТ',fuelBalance:60,norm:10,org:'Synthetic organization',status:'В работе'});
  data.drivers.push({id:driver,name:'Synthetic employee '+asset,personnelRoles:['driver'],employmentStatus:'active',skills:'B, C'});
  data.assetAssignments.push({id:'perf-assignment-'+asset,assetRef:'v:'+id,driverId:driver,from:'2026-10-01',site:'Synthetic site',reason:'Synthetic order'});
  data.dispatchJobs.push({id:'perf-job-'+asset,status:'assigned',assetRef:'v:'+id,driverId:driver,start:'2026-10-22T08:00:00Z',end:'2026-10-22T17:00:00Z',route:'Synthetic route',requirements:'B'});
 }
 for(let row=0;row<count;row++){
  const asset=row%assets,day=Math.floor(row/assets)+1,date='2026-10-'+String(day).padStart(2,'0'),vehicleId='perf-v-'+asset,id='perf-r-'+row;
  data.records.push({id,vehicleId,date,km:10,fuelActual:1,fuelIssued:day===1?20:0,fuelGrade:'ДТ',fuelOrg:'Synthetic organization',driver:'Synthetic employee '+asset,note:'Synthetic baseline'});
  if(day===1)data.fuelPurchases.push({id:'perf-p-'+asset,vehicleId,recordId:id,date,qty:20,grade:'ДТ',price:60,sum:1200,sourceProvider:'Synthetic supplier',sourceOrg:'Synthetic organization',manual:true});
 }
 data.fuelCards=[{id:'fc_cash',number:'НАЛИЧКА',provider:'Наличка',assignments:[]}];
 data.appMeta=[{id:'meta',toPlanInit:'synthetic'}];return data;
}
function makeJson(dir,data){
 fs.mkdirSync(path.join(dir,'sections'),{recursive:true});
 for(const name of schema.sections)fs.writeFileSync(path.join(dir,'sections',name+'.json'),JSON.stringify(data[name]));
 fs.writeFileSync(path.join(dir,'sections','revisions.json'),JSON.stringify(Object.fromEntries(schema.sections.map(name=>[name,1]))));
}
function removeOwned(dir){
 const absolute=path.resolve(dir);if(path.dirname(absolute)!==path.resolve(os.tmpdir())||!path.basename(absolute).startsWith('tvs-perf-step5-'))throw Error('Refuse cleanup outside owned synthetic temp');
 fs.rmSync(absolute,{recursive:true,force:true});
}
function folderBytes(dir){return fs.readdirSync(dir,{withFileTypes:true}).reduce((total,item)=>total+(item.isDirectory()?folderBytes(path.join(dir,item.name)):fs.statSync(path.join(dir,item.name)).size),0);}
function startEngineWorker(endpoint='engine-worker.js'){
 const file=path.join(root,'assets/core',endpoint);
 const bootstrap="const {parentPort}=require('node:worker_threads');const endpoint=require("+JSON.stringify(file)+").createHandler({postMessage:message=>parentPort.postMessage(message)});parentPort.on('message',message=>endpoint.handle(message));parentPort.postMessage({type:'benchmark-ready'});";
 const worker=new Worker(bootstrap,{eval:true}),pending=new Map();let nextId=0,closing=false,startup=null;
 return new Promise((resolve,reject)=>{
  const fail=error=>{clearTimeout(startup);if(!closing){closing=true;void worker.terminate();}reject(error);for(const task of pending.values()){clearTimeout(task.timer);task.reject(error);}pending.clear();};
  worker.on('error',fail);worker.on('exit',code=>{if(!closing)fail(Error('Synthetic analysis worker exited: '+code));});
  startup=setTimeout(()=>{closing=true;worker.terminate();fail(Error('Synthetic analysis worker startup timed out'));},30000);
  worker.on('message',message=>{
   if(message.type==='benchmark-ready'){
    clearTimeout(startup);resolve({
     request(payload){const requestId='benchmark-worker-'+(++nextId);return new Promise((done,failed)=>{
      const timer=setTimeout(()=>{pending.delete(requestId);failed(Error('Synthetic analysis worker request timed out'));},30000);
      pending.set(requestId,{resolve:done,reject:failed,timer});
      try{worker.postMessage({protocolVersion:1,...payload,requestId});}catch(error){clearTimeout(timer);pending.delete(requestId);failed(error);}
     });},
     async close(){closing=true;clearTimeout(startup);for(const task of pending.values()){clearTimeout(task.timer);task.reject(Error('Synthetic analysis worker closed'));}pending.clear();await worker.terminate();}
    });return;
   }
   const task=pending.get(message.requestId);if(!task)return;clearTimeout(task.timer);pending.delete(message.requestId);
   if(message.ok!==true){task.reject(Error('Synthetic analysis worker failed: '+JSON.stringify(message.error)));return;}task.resolve(message);
  });
 });
}
function createRendererPrepareHost(captured){
 // Load the real renderer provider, including its queue, source/access guards,
 // worker selection and response validation. Only its Worker transport is
 // adapted to Node; the endpoint itself runs in an actual worker thread.
 const terminations=[],workers=new Set();let started=0;
 class RendererWorker{
  constructor(url){
   if(url!=='assets/core/transaction-worker.js')throw Error('Unexpected synthetic worker URL: '+url);
   started++;const file=path.join(root,url);
   const bootstrap="const {parentPort}=require('node:worker_threads');const endpoint=require("+JSON.stringify(file)+").createHandler({postMessage:message=>parentPort.postMessage(message)});parentPort.on('message',message=>endpoint.handle(message));";
   this.worker=new Worker(bootstrap,{eval:true});workers.add(this);
   this.worker.on('message',message=>this.onmessage?.({data:message}));
   this.worker.on('messageerror',()=>this.onmessageerror?.({}));
   this.worker.on('error',error=>this.onerror?.({message:error.message,preventDefault(){}}));
  }
  postMessage(message){this.worker.postMessage(message);}
  terminate(){if(!workers.delete(this))return;const pending=this.worker.terminate();terminations.push(pending);return pending;}
 }
 const host=vm.createContext({PlatformKernel:kernel,Worker:RendererWorker,structuredClone,setTimeout,clearTimeout,
  window:{},dispatcherContext:()=>({identity:captured.identity,readable:captured.readable}),dispatcherLocalDate:()=>captured.today,
  _sync:{access:{user:captured.actor,readable:captured.readable,writable:captured.writable},revs:captured.revisions},
  dispatcherInvalidate(){},_loadWriteBlocked:false});
 vm.runInContext(fs.readFileSync(path.join(root,'assets/js/51-platform-bridge.js'),'utf8'),host,{filename:'assets/js/51-platform-bridge.js'});
 return {prepare:host.platformPrepareInBackground,getContext:host.platformSessionContext,
  stats:()=>({...host.platformPrepareBackgroundStatus(),started}),
  async close(){for(const worker of [...workers])worker.terminate();await Promise.allSettled(terminations);}};
}
async function measure(name,action,repeats=3){
 const samples=[];let last;
 for(let attempt=0;attempt<repeats;attempt++){
  global.gc?.();await wait(10);
  const monitor=monitorEventLoopDelay({resolution:1});monitor.enable();await wait(8);
  const before=process.memoryUsage(),start=performance.now(),timer=new Promise(resolve=>setTimeout(()=>resolve(performance.now()-start),0));
  let sampledHeap=before.heapUsed;const sampler=setInterval(()=>{sampledHeap=Math.max(sampledHeap,process.memoryUsage().heapUsed);},5);
  let after,elapsed;
  try{const result=action();last=result&&typeof result.then==='function'?await result:result;elapsed=performance.now()-start;after=process.memoryUsage();}
  catch(error){monitor.disable();throw error;}
  finally{clearInterval(sampler);}
  const zeroTimerDelay=await timer;await wait(5);monitor.disable();
  samples.push({ms:round(elapsed),zeroTimerDelayMs:round(zeroTimerDelay),eventLoopMaxMs:round(monitor.max/1e6),heapBeforeMiB:mb(before.heapUsed),heapAfterMiB:mb(after.heapUsed),sampledMainHeapPeakMiB:mb(Math.max(sampledHeap,after.heapUsed)),heapDeltaMiB:mb(after.heapUsed-before.heapUsed),rssMiB:mb(after.rss)});
  if(elapsed>750)break; // No repeated multi-second quadratic workloads.
 }
 const durations=samples.map(sample=>sample.ms).sort((a,b)=>a-b),result={name,n:samples.length,medianMs:durations[Math.floor(durations.length/2)],maxEventLoopDelayMs:Math.max(...samples.map(sample=>sample.eventLoopMaxMs)),maxZeroTimerDelayMs:Math.max(...samples.map(sample=>sample.zeroTimerDelayMs)),maxObservedHeapMiB:Math.max(...samples.map(sample=>sample.heapAfterMiB)),maxSampledMainHeapMiB:Math.max(...samples.map(sample=>sample.sampledMainHeapPeakMiB)),maxHeapDeltaMiB:Math.max(...samples.map(sample=>sample.heapDeltaMiB)),maxObservedRssMiB:Math.max(...samples.map(sample=>sample.rssMiB)),samples};
 process.stderr.write(JSON.stringify({name,ms:result.medianMs,loopMs:result.maxEventLoopDelayMs})+'\n');
 return {metric:result,last};
}
async function child(count){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-perf-step5-'));
 try{
  const data=fixture(count),jsonDir=path.join(dir,'json'),sqliteDir=path.join(dir,'sqlite'),metrics=[];
  const warm=fixture(10),warmEngine=application.create();warmEngine.query('fuel',warm,{from:'2026-10-01',to:'2026-10-31'});policies.validateChanges(warm,clone(warm),context);
  makeJson(jsonDir,data);sqlite.create(sqliteDir,{data});
  let jsonState=storage.readSnapshot(jsonDir),sqlState=storage.readSnapshot(sqliteDir);
  const record=async(name,action,repeats)=>{const result=await measure(name,action,repeats);metrics.push(result.metric);return result.last;};
  const engine=application.create(),range={from:'2026-10-01',to:'2026-10-31'};
  await record('core.fuel.raw',()=>fuel.buildLedger(data,range));
  await record('core.fuel.query.cold',()=>{engine.clear();return engine.query('fuel',data,range,{identity:'synthetic-perf'});});
  const cacheAfterCold=engine.stats();
  await record('core.fuel.query.repeat',()=>engine.query('fuel',data,range,{identity:'synthetic-perf'}));
  const cacheAfterRepeat=engine.stats();
  let analysisWorker=null,loaded=null,workerCold=null,workerRepeat=null;const workerStages={};
  try{
   workerCold=await record('worker.fuel.cold.startLoadQuery.roundtrip',async()=>{
    let started=performance.now();analysisWorker=await startEngineWorker();workerStages.startupMs=round(performance.now()-started);
    started=performance.now();loaded=await analysisWorker.request({type:'load',generation:1,database:data,context:{identity:'synthetic-perf',readable:schema.sections}});workerStages.loadMs=round(performance.now()-started);
    started=performance.now();const reply=await analysisWorker.request({type:'query',generation:1,identity:loaded.identity,sourceFingerprint:loaded.sourceFingerprint,name:'fuel',options:range});workerStages.coldQueryMs=round(performance.now()-started);return reply;
   },1);
   workerRepeat=await record('worker.fuel.repeat.sameSnapshot.roundtrip',()=>analysisWorker.request({type:'query',generation:1,identity:loaded.identity,sourceFingerprint:loaded.sourceFingerprint,name:'fuel',options:range}));
  }finally{await analysisWorker?.close();}
  await record('core.fuelRecords.allAssets',()=>{const perVehicle=application.create();for(const asset of data.vehicles)perVehicle.query('fuelRecords',data,{vehicleId:asset.id},{identity:'synthetic-perf'});});
  await record('core.costs.query.cold',()=>application.create().query('costs',data,range,{identity:'synthetic-perf'}));
  await record('core.writeoff.query.cold',()=>application.create().query('writeoff',data,{month:'2026-10',date:'2026-10-31'},{identity:'synthetic-perf'}));
  const report=await record('policies.inspect',()=>policies.inspect(data,context));
  const partData=Object.fromEntries(schema.sections.map(name=>[name,[]]));partData.parts=[{id:'perf-part',name:'Synthetic part'}];
  partData.partMovements=[{id:'perf-stock',partId:'perf-part',date:'2026-10-01',kind:'receipt',qty:count},...Array.from({length:count},(_,index)=>({id:'perf-issue-'+index,partId:'perf-part',date:'2026-10-'+String(index%20+2).padStart(2,'0'),kind:'issue',qty:1}))];
  await record('policies.inspect.samePartIntegerStock',()=>policies.inspect(partData,context));
  const next={...data,records:data.records.map((row,index)=>index?row:{...row,note:'Synthetic delta'})};
  await record('policies.validateOneRecordNote',()=>policies.validateChanges(data,next,context));
  await record('integrity.validateOneRecordNote',()=>integrity.validateChanges(data,next,context));
  const prepareContext={...context,id:'perf-prepare-reference',identity:'synthetic-perf-preflight',
   actor:{id:'synthetic-perf',name:'Synthetic benchmark',role:'admin'},revisions:{...jsonState.revisions}};
  const prepared=await record('kernel.prepare.direct.rendererSync',()=>kernel.prepare(data,next,prepareContext));
  let prepareWorker=null,workerPrepared=null;const prepareStages={};
  try{
   workerPrepared=await record('worker.prepare.cold.startPrepare.roundtrip',async()=>{
    let started=performance.now();prepareWorker=await startEngineWorker('transaction-worker.js');prepareStages.startupMs=round(performance.now()-started);
    started=performance.now();const result=await prepareWorker.request({type:'prepare',previous:data,next,context:prepareContext});prepareStages.prepareTransferMs=round(performance.now()-started);return result;
   },1);
   if(JSON.stringify(workerPrepared.plan)!==JSON.stringify(prepared))throw Error('Synthetic prepare worker result differs from the direct kernel plan');
   await record('worker.prepare.repeat.sameInput.roundtrip',()=>prepareWorker.request({type:'prepare',previous:data,next,context:prepareContext}));
  }finally{await prepareWorker?.close();}
  const rendererPrepare=createRendererPrepareHost(prepareContext);let preflightSequence=0,stubPersists=0,preflightReceipt=null,preflightStats;
  try{
   preflightReceipt=await record('renderer.runtime.preflight.stubPersist.actualBackgroundHost',async()=>{
    const runtime=kernel.createRuntime({getContext:rendererPrepare.getContext,prepare:rendererPrepare.prepare,now:()=>context.now}),id='perf-preflight-'+(++preflightSequence);
    const receipt=await runtime.run({id,previous:data,next,identity:prepareContext.identity},plan=>{stubPersists++;return {ok:true,identity:plan.identity,operationId:plan.id};});
    if(receipt.plan.id!==id||receipt.plan.requestDigest!==prepared.requestDigest||receipt.plan.metadata.createdAt!==context.now)throw Error('Synthetic runtime preflight returned a mismatched plan');
    return receipt;
   });
   preflightStats=rendererPrepare.stats();
   if(preflightStats.started!==preflightSequence||stubPersists!==preflightSequence||preflightStats.active||preflightStats.queued)throw Error('Synthetic renderer preflight did not use one completed worker and stub persistence per operation');
  }finally{await rendererPrepare.close();}
  await record('json.readSnapshot',()=>storage.readSnapshot(jsonDir));
  await record('json.readSnapshot.serializeIPC',()=>JSON.stringify(storage.readSnapshot(jsonDir)));
  await record('json.readSection.records',()=>storage.readSection(jsonDir,'records'));
  await record('sqlite.adapter.readAll',()=>sqlite.readAll(sqliteDir));
  await record('sqlite.readSnapshot',()=>storage.readSnapshot(sqliteDir));
  await record('sqlite.readSnapshot.serializeIPC',()=>JSON.stringify(storage.readSnapshot(sqliteDir)));
  await record('sqlite.readSection.records',()=>storage.readSection(sqliteDir,'records'));
  const sql='SELECT row_json FROM section_rows WHERE section=? AND asset_ref=? AND date_value>=? AND date_value<=? ORDER BY date_value,position LIMIT 50';
  const args=['records','v:perf-v-0','2026-10-01','2026-10-31'];
  const probe=action=>{const db=new DatabaseSync(sqlite.filename(sqliteDir),{readOnly:true});try{return action(db);}finally{db.close();}};
  const queryPlan=probe(db=>db.prepare('EXPLAIN QUERY PLAN '+sql).all(...args));
  await record('sqlite.rawSQL.assetPage.excludesTrustedQueryBoundary',()=>probe(db=>db.prepare(sql).all(...args).map(row=>JSON.parse(row.row_json))));
  const queryPages=[],principal={id:'synthetic-perf',role:'admin'};
  const selections=[['page25.count',{section:'records',limit:25},count],['assetDate.page25.count',{section:'records',limit:25,assetRef:'v:perf-v-0',from:'2026-10-02',to:'2026-10-06'},5],['searchDate.page25.count',{section:'records',limit:25,search:'Synthetic baseline',from:'2026-10-02',to:'2026-10-06'},data.vehicles.length*5]];
  for(const [backend,target]of [['json',jsonDir],['sqlite',sqliteDir]])for(const [name,selection,total]of selections){
   const page=await record(backend+'.queryRows.'+name,()=>dataQuery.queryRows(target,selection,principal));
   if(page.ok!==true||page.total!==total||page.rows.length!==Math.min(25,total))throw Error('Synthetic page/count mismatch: '+backend+'.'+name);
   queryPages.push({backend,name,selection,total:page.total,returned:page.rows.length,hasMore:page.nextCursor!==null});
  }
  let sequence=0;
  const save=(which)=>{
   const state=which==='json'?jsonState:sqlState,target=which==='json'?jsonDir:sqliteDir;
   const records=state.data.records.map((row,index)=>index?row:{...row,note:'Synthetic save '+(++sequence)});
   const result=storage.writeSections(target,{databaseToken:state.databaseToken,base:state.revisions,sections:{records},operation:{id:'perf-'+which+'-'+sequence}},{principal:{id:'synthetic-perf',name:'Synthetic benchmark',role:'admin'},now:context.now});
   if(!result.ok)throw Error('Synthetic save failed: '+JSON.stringify(result));
   state.data={...state.data,...result.canonicalSections};state.revisions=result.revisions;return result;
  };
  await record('json.saveOneRecordNote.fullTrustedAPI',()=>save('json'),1);
  await record('sqlite.saveOneRecordNote.fullTrustedAPI',()=>save('sqlite'),1);
  let rawSequence=0;await record('sqlite.adapter.commitOneRecordNote.NO_DOMAIN_RULES',()=>{
   const rows=sqlState.data.records.map((row,index)=>index?row:{...row,note:'Synthetic adapter write '+(++rawSequence)});
   const revisions={...sqlState.revisions,records:sqlState.revisions.records+rawSequence};sqlite.commitSections(sqliteDir,{records:rows},revisions);return true;
  },1);
  return {count,assets:data.vehicles.length,jobs:data.dispatchJobs.length,drivers:data.drivers.length,assignments:data.assetAssignments.length,purchases:data.fuelPurchases.length,totalRows:Object.values(data).reduce((sum,rows)=>sum+rows.length,0),jsonMiB:mb(Buffer.byteLength(JSON.stringify(data))),filesMiB:{json:mb(folderBytes(jsonDir)),sqlite:mb(folderBytes(sqliteDir))},policyIssues:report.counts,queryPlan,queryPages,fuelCache:{afterCold:cacheAfterCold,afterRepeat:cacheAfterRepeat},workerFuel:{coldStages:workerStages,afterCold:workerCold.stats,afterRepeat:workerRepeat.stats,loadedFingerprint:loaded.sourceFingerprint},workerPrepare:{coldStages:prepareStages,digest:workerPrepared.plan.requestDigest,parity:true},rendererPreflight:{...preflightStats,stubPersists,operationId:preflightReceipt.plan.id,changed:preflightReceipt.plan.changed},peakRssMiB:round(process.resourceUsage().maxRSS/1024),metrics};
 }finally{removeOwned(dir);}
}
async function main(){
 const at=process.argv.indexOf('--records');
 if(at>=0){const count=Number(process.argv[at+1]);if(![1000,5000,10000].includes(count))throw Error('Only synthetic 1000/5000/10000 record scales are supported');console.log(JSON.stringify(await child(count)));return;}
 const report={timestamp:new Date().toISOString(),runtime:{node:process.version,sqlite:process.versions.sqlite,platform:process.platform,arch:process.arch,cpus:os.cpus().length,cpu:os.cpus()[0]?.model,totalMemoryGiB:round(os.totalmem()/1024**3)},method:{syntheticOnly:true,perScaleIsolatedProcess:true,gcBeforeSample:true,samples:'3 unless a sample takes >750ms; trusted saves, low-level commit and worker cold startup measured once',timing:'wall performance.now; main-thread zero-delay timer and monitorEventLoopDelay resolution=1ms, no cold disk eviction',memory:'main heap before/after plus 5ms sampler during async jobs; process RSS includes worker threads; neither is an exact peak V8 heap',fixture:'10 records per vehicle, one linked purchase per vehicle, one driver, assignment and simultaneous assigned job per vehicle; no live rows or settings',queries:'Production data-query.queryRows page25 with exact authorised COUNT and date/asset/search filters; separate raw SQL probe excludes the trusted query boundary',worker:'Actual engine-worker.js and transaction-worker.js endpoints through worker_threads bootstrap; cold roundtrip includes startup+source capture+first calculation+result transfer; direct synchronous kernel.prepare excludes startup',preflight:'Actual createRuntime.run plus 51-platform-bridge prepare provider, immutable input capture, source/access guards and returned-plan validation; one actual transaction worker per operation. Persist is an explicit in-memory ACK stub, with no storage/IPC/backend domain work. Full trusted JSON/SQLite save metrics remain separate'},scales:[]};
 for(const count of [1000,5000,10000]){
  const run=spawnSync(process.execPath,['--expose-gc',__filename,'--records',String(count)],{cwd:root,encoding:'utf8',timeout:110000,maxBuffer:16*1024*1024,windowsHide:true});
  process.stderr.write(run.stderr||'');if(run.error||run.status!==0)throw run.error||Error(run.stdout+'\n'+run.stderr);report.scales.push(JSON.parse(run.stdout.trim()));
  fs.mkdirSync(path.join(root,'audit'),{recursive:true});fs.writeFileSync(path.join(root,'audit','performance-step5-after.json'),JSON.stringify(report,null,2));
 }
 console.log(JSON.stringify({file:'audit/performance-step5-after.json',scales:report.scales.map(scale=>({records:scale.count,peakRssMiB:scale.peakRssMiB,metrics:scale.metrics.map(({name,medianMs,maxEventLoopDelayMs,maxObservedHeapMiB})=>({name,ms:medianMs,eventLoopDelayMs:maxEventLoopDelayMs,heapMiB:maxObservedHeapMiB}))}))},null,2));
}
module.exports={fixture};
if(require.main===module)main().catch(error=>{console.error(error.stack);process.exitCode=1;});
