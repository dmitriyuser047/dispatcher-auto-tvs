const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {createRequire}=require('node:module');
let pw;try{pw=require('playwright');}catch{pw=createRequire(path.join(process.env.TVS_PLAYWRIGHT_MODULES||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),'package.json'))('playwright');}
const root=path.resolve(__dirname,'..');let server,browser,origin,page,errors;
before(async()=>{
 server=http.createServer((req,res)=>{let name;try{name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400).end();return;}
  if(name==='/')name='/index.html';if(name!=='/index.html'&&!/^\/(?:assets|vendor)\//.test(name)){res.writeHead(403).end();return;}
  const file=path.resolve(root,'.'+name);if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}try{const bytes=fs.readFileSync(file);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(bytes);}catch{res.writeHead(404).end();}
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';browser=await pw.chromium.launch({headless:true,executablePath:process.env.TVS_TEST_BROWSER||(!process.env.CI&&fs.existsSync(edge)?edge:undefined)});
});
after(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));});
beforeEach(async()=>{
 page=await browser.newPage({viewport:{width:1280,height:900}});errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  const db={vehicles:[{id:'transaction-v',plate:'SYNTHETIC-TRANSACTION',org:'Synthetic organization',fuel:'diesel',fuelGrade:'ДТ',norm:10,fuelBalance:1000000}],records:Array.from({length:1001},(_,index)=>({id:'transaction-r-'+index,vehicleId:'transaction-v',date:'2026-09-01',km:1,fuelActual:0.1,fuelGrade:'ДТ',note:'Original '+index})),fuelCards:[{id:'cash',number:'НАЛИЧКА',provider:'Наличка',assignments:[]}],appMeta:[{id:'meta',toPlanInit:'test'}]};
  window.__token='synthetic-transaction-A';window.__disks={[window.__token]:structuredClone(db)};window.__revisions={};window.__writes=[];window.__workers=[];window.__workerMessages=[];window.__holdTransactionSend=false;window.__heldSends=[];window.__holdPreparation=false;window.__heldPreparations=[];window.__prepareCalls=0;window.__insideRealPrepare=0;window.__ticksDuringPrepare=0;window.__finishedClose=[];
  const NativeWorker=window.Worker;window.Worker=class extends NativeWorker{constructor(url,...args){super(url,...args);this.__transaction=String(url).includes('transaction-worker');window.__workers.push(String(url));}postMessage(message,...args){if(this.__transaction){window.__workerMessages.push(message.type||message.kind||'prepare');if(window.__holdTransactionSend){window.__heldSends.push(()=>super.postMessage(message,...args));return;}}return super.postMessage(message,...args);}};
  window.electronAPI={readSnapshot:async()=>{const source=window.__disks[window.__token];for(const section of PlatformSchema.sections){source[section]??=[];window.__revisions[section]??=1;}return JSON.stringify({data:source,revisions:window.__revisions,databaseToken:window.__token,platform:{apiVersion:1,operations:1}});},
   writeSections:async json=>{const request=JSON.parse(json);window.__writes.push(request);if(request.databaseToken!==window.__token)return{ok:false,databaseChanged:true,databaseToken:window.__token};const target=window.__disks[request.databaseToken];for(const [section,rows]of Object.entries(request.sections)){target[section]=structuredClone(rows);window.__revisions[section]++;}return{ok:true,databaseToken:request.databaseToken,revisions:{...window.__revisions},canonicalSections:structuredClone(request.sections),operationReceipt:{id:request.operation.id,digest:PlatformKernel.requestDigest(request),status:'committed'}};},
   onPrepareClose:callback=>{window.__onPrepareClose=callback;},finishClose:async value=>{window.__finishedClose.push(value);return true;}};
 });
 await page.goto(origin+'/index.html');await page.waitForFunction(()=>typeof platformPrepareInBackground==='function'&&typeof data!=='undefined'&&data.vehicles[0]?.id==='transaction-v',{timeout:30000});
 await page.evaluate(()=>{
  const original=platformPrepareInBackground;platformPrepareInBackground=async(...args)=>{window.__prepareCalls++;window.__insideRealPrepare++;let plan;try{plan=await original(...args);}finally{window.__insideRealPrepare--;}if(window.__holdPreparation)await new Promise(resolve=>window.__heldPreparations.push(resolve));return plan;};
  _platformRuntime=null;_platformRuntimeIdentity=null;
  window.__heartbeat=setInterval(()=>{if(window.__insideRealPrepare)window.__ticksDuringPrepare++;},0);
 });
});
afterEach(async()=>{await page?.close();assert.deepEqual(errors,[]);});
async function beginHeld(id='transaction-held'){
 await page.evaluate(id=>{window.__holdPreparation=true;data.records[0].note='Synthetic proposed change';window.__save=saveData(data,{operation:{id}});},id);await page.waitForFunction(()=>window.__heldPreparations.length>0,{timeout:30000});
}
async function release(){await page.evaluate(()=>{window.__holdPreparation=false;window.__heldPreparations.splice(0).forEach(resolve=>resolve());});}

test('a 10000-record transaction prepares in a real Worker while renderer timers continue to run',async()=>{
 const result=await page.evaluate(async()=>{
  while(data.records.length<10000){const index=data.records.length;data.records.push({id:'transaction-r-'+index,vehicleId:'transaction-v',date:'2026-09-01',km:1,fuelActual:0.1,fuelGrade:'ДТ',note:'Original '+index});}
  window.__disks[window.__token]=structuredClone(data);data=await loadData();rebuildIndex();_platformRuntime=null;_platformRuntimeIdentity=null;const original=JSON.stringify(data.records[0]);data.records[0].note='Large transaction changed';
  const saved=await saveData(data,{operation:{id:'transaction-ten-thousand'}});return{saved,workers:window.__workers.filter(url=>url.includes('transaction-worker')).length,messages:window.__workerMessages,ticks:window.__ticksDuringPrepare,writes:window.__writes.length,stored:window.__disks[window.__token].records[0].note,count:window.__disks[window.__token].records.length,original};
 });
 assert.equal(result.saved,true);assert.ok(result.workers>=1);assert.ok(result.messages.length>=1);assert.ok(result.ticks>0);assert.equal(result.writes,1);assert.equal(result.stored,'Large transaction changed');assert.equal(result.count,10000);
});

test('a 999-row database keeps the compatible save path without starting a transaction Worker',async()=>{
 const result=await page.evaluate(async()=>{while(Object.values(data).reduce((sum,rows)=>sum+(Array.isArray(rows)?rows.length:0),0)>999)data.records.pop();window.__disks[window.__token]=structuredClone(data);data=await loadData();rebuildIndex();_platformRuntime=null;_platformRuntimeIdentity=null;const count=Object.values(data).reduce((sum,rows)=>sum+(Array.isArray(rows)?rows.length:0),0);data.records[0].note='Small transaction changed';return{saved:await saveData(data,{operation:{id:'transaction-small'}}),count,workers:window.__workers.filter(url=>url.includes('transaction-worker')).length,writes:window.__writes.length};});
 assert.deepEqual(result,{saved:true,count:999,workers:0,writes:1});
});

test('exactly 1000 total rows, including metadata and cards, enable background transaction preparation',async()=>{
 const result=await page.evaluate(async()=>{while(Object.values(data).reduce((sum,rows)=>sum+(Array.isArray(rows)?rows.length:0),0)>1000)data.records.pop();window.__disks[window.__token]=structuredClone(data);data=await loadData();rebuildIndex();_platformRuntime=null;_platformRuntimeIdentity=null;const count=Object.values(data).reduce((sum,rows)=>sum+(Array.isArray(rows)?rows.length:0),0);data.records[0].note='Boundary transaction changed';const saved=await saveData(data,{operation:{id:'transaction-boundary'}});return{saved,count,workers:window.__workers.filter(url=>url.includes('transaction-worker')).length,writes:window.__writes.length,status:platformPrepareBackgroundStatus()};});
 assert.equal(result.count,1000);assert.equal(result.saved,true);assert.ok(result.workers>=1);assert.equal(result.writes,1);assert.equal(result.status.active,0);assert.equal(result.status.queued,0);
});

test('a real transaction Worker validates a new timed job with canonical proof while native persistence receives raw intent and calendar read CAS',async()=>{
 const result=await page.evaluate(async()=>{
  _sync.platform.calendar=1;const original=platformPrepareInBackground;platformPrepareInBackground=async(...args)=>{const plan=await original(...args);window.__timePlan=structuredClone(plan);return plan;};
  data.dispatchJobs.push({id:'worker-timed-job',status:'new',title:'Explicit new timed job',start:'2026-09-01T10:00',end:'2026-09-01T11:00'});
  const saved=await saveData(data,{operation:{id:'worker-new-time'}}),plan=window.__timePlan,request=window.__writes[0];
  return{saved,workers:window.__workers.filter(url=>url.includes('transaction-worker')).length,writes:window.__writes.length,proof:plan?.sections.dispatchJobs[0].timeContext,raw:request?.sections.dispatchJobs[0],readVersion:request?.base.appMeta,currentVersion:_sync.revs.appMeta,digest:plan?.requestDigest,rawDigest:PlatformKernel.requestDigest({base:plan?.base,sections:{dispatchJobs:request?.sections.dispatchJobs}})};
 });
 assert.equal(result.saved,true);assert.ok(result.workers>=1);assert.equal(result.writes,1);assert.equal(result.proof.fields.start.instant,'2026-09-01T10:00:00.000Z');assert.equal(result.raw.start,'2026-09-01T10:00');assert.equal(result.raw.timeContext,undefined);assert.equal(result.readVersion,result.currentVersion);assert.equal(result.digest,result.rawDigest);
});

test('an external calendar revision conflict cannot auto-merge and retry a raw timed job under the newly selected zone',async()=>{
 const result=await page.evaluate(async()=>{
  _sync.platform.calendar=1;window.__calendarReads=0;const write=window.electronAPI.writeSections;
  window.electronAPI.readSection=async name=>{window.__calendarReads++;return{name,rev:2,rows:window.__disks[window.__token][name],databaseToken:window.__token};};
  window.electronAPI.writeSections=async json=>{if(!window.__calendarConflict){window.__calendarConflict=true;window.__writes.push(JSON.parse(json));window.__disks[window.__token].appMeta.push({id:'business-calendar',kind:'businessCalendar',calendar:{version:1,timeZone:'Europe/Moscow'},history:[{operationId:'external-calendar',reason:'Another user explicitly changed the timezone',at:'2026-10-01T12:00:00.000Z',actor:{id:'other-admin',name:'Other administrator',role:'admin'},previousTimeZone:'UTC',timeZone:'Europe/Moscow'}]});return{ok:false,conflicts:['appMeta'],revisions:{...window.__revisions,appMeta:2},databaseToken:window.__token};}return write(json);};
  data.dispatchJobs.push({id:'raw-calendar-conflict',status:'new',title:'Unconfirmed timed job',start:'2026-09-01T10:00',end:'2026-09-01T11:00'});
  const saved=await saveData(data,{operation:{id:'raw-calendar-conflict'}});return{saved,writes:window.__writes.length,reads:window.__calendarReads,storedJobs:window.__disks[window.__token].dispatchJobs.length,error:_platformLastError};
 });
 assert.equal(result.saved,false);assert.equal(result.writes,1);assert.equal(result.reads,0);assert.equal(result.storedJobs,0);assert.match(result.error?.message,/календар|calendar|пояс/i);
});

test('a few rows containing over one MiB of card text also prepare in a real Worker',async()=>{
 const result=await page.evaluate(async()=>{data.records=data.records.slice(0,2);data.vehicles[0].note='SYNTHETIC-LARGE-CARD-TEXT '+ 'x'.repeat(1100000);window.__disks[window.__token]=structuredClone(data);data=await loadData();rebuildIndex();_platformRuntime=null;_platformRuntimeIdentity=null;const count=Object.values(data).reduce((sum,rows)=>sum+(Array.isArray(rows)?rows.length:0),0),length=JSON.stringify(data).length;data.records[0].note='Small row in a large snapshot';const saved=await saveData(data,{operation:{id:'transaction-large-card'}});return{saved,count,length,workers:window.__workers.filter(url=>url.includes('transaction-worker')).length,writes:window.__writes.length,storedLength:window.__disks[window.__token].vehicles[0].note.length};});
 assert.ok(result.count<1000);assert.ok(result.length>1048576);assert.equal(result.saved,true);assert.ok(result.workers>=1);assert.equal(result.writes,1);assert.ok(result.storedLength>1100000);
});

test('worker validation failure never calls native save and restores only the owned draft',async()=>{
 const result=await page.evaluate(async()=>{const before=JSON.stringify(window.__disks[window.__token]);data.records[0].vehicleId='missing-synthetic-parent';const saved=await saveData(data,{operation:{id:'transaction-invalid'}});return{saved,writes:window.__writes.length,unchanged:JSON.stringify(window.__disks[window.__token])===before,vehicleId:data.records[0].vehicleId,error:platformRuntimeStatus().lastError};});
 assert.equal(result.saved,false);assert.equal(result.writes,0);assert.equal(result.unchanged,true);assert.equal(result.vehicleId,'transaction-v');assert.match(result.error?.message,/связ|отсутств|объект|reference/i);
});

test('an in-place draft edit while prepare is awaiting cannot be persisted by the older operation',async()=>{
 await beginHeld();await page.evaluate(()=>{data.records[1].note='A newer unsaved change';});await release();
 const result=await page.evaluate(async()=>({saved:await window.__save,writes:window.__writes.length,storedFirst:window.__disks[window.__token].records[0].note,storedSecond:window.__disks[window.__token].records[1].note}));
 assert.deepEqual(result,{saved:false,writes:0,storedFirst:'Original 0',storedSecond:'Original 1'});
});

test('a late prepared plan cannot save into or overwrite a newly opened database and baseline',async()=>{
 await beginHeld();const baseline=await page.evaluate(()=>{const fresh=structuredClone(window.__disks[window.__token]);fresh.vehicles[0].plate='NEW-SYNTHETIC-DATABASE';fresh.records[0].note='New database value';window.__token='synthetic-transaction-B';window.__disks[window.__token]=fresh;data=structuredClone(fresh);_sync.databaseToken=window.__token;_sync.revs=Object.fromEntries(PlatformSchema.sections.map(section=>[section,77]));_sync.synced=Object.fromEntries(PlatformSchema.sections.map(section=>[section,JSON.stringify(fresh[section])]));_lastPersisted=JSON.stringify(fresh);return _lastPersisted;});
 await release();const result=await page.evaluate(async()=>({saved:await window.__save,writes:window.__writes.length,plate:data.vehicles[0].plate,note:data.records[0].note,baseline:_lastPersisted,revision:_sync.revs.records}));
 assert.deepEqual(result,{saved:false,writes:0,plate:'NEW-SYNTHETIC-DATABASE',note:'New database value',baseline,revision:77});
});

for(const mode of ['role','effective permissions'])test('a change of '+mode+' during preparation blocks native save',async()=>{
 await page.evaluate(()=>{_sync.access={user:{id:'synthetic-user',name:'Synthetic user',role:'admin'},readable:PlatformSchema.sections.slice(),writable:PlatformSchema.sections.slice()};});await beginHeld('transaction-access-'+mode.replaceAll(' ','-'));
 await page.evaluate(mode=>{if(mode==='role')_sync.access.user.role='viewer';_sync.access.writable=[];},mode);await release();
 assert.deepEqual(await page.evaluate(async()=>({saved:await window.__save,writes:window.__writes.length,stored:window.__disks[window.__token].records[0].note})),{saved:false,writes:0,stored:'Original 0'});
});

for(const mode of ['database','role'])test('the worker host rejects a '+mode+' switch before accepting its actual reply',async()=>{
 await page.evaluate(()=>{window.__holdTransactionSend=true;data.records[0].note='Held native worker request';window.__save=saveData(data,{operation:{id:'transaction-worker-host-stale'}});});await page.waitForFunction(()=>window.__heldSends.length>0);
 await page.evaluate(mode=>{if(mode==='database')_sync.databaseToken='synthetic-host-other-database';else _sync.access={user:{id:'host-viewer',name:'Synthetic viewer',role:'viewer'},readable:PlatformSchema.sections.slice(),writable:[]};window.__holdTransactionSend=false;window.__heldSends.splice(0).forEach(send=>send());},mode);
 assert.deepEqual(await page.evaluate(async()=>({saved:await window.__save,writes:window.__writes.length,stored:window.__disks['synthetic-transaction-A'].records[0].note,status:platformPrepareBackgroundStatus()})),{saved:false,writes:0,stored:'Original 0',status:{active:0,queued:0,limit:8}});
});

test('duplicate operation and close barrier await background preparation then persist exactly once',async()=>{
 await beginHeld('transaction-deduplicated-close');await page.evaluate(()=>{window.__duplicate=saveData(data,{operation:{id:'transaction-deduplicated-close'}});window.__closeDone=false;window.__closeTask=window.__onPrepareClose('synthetic-close-nonce').then(()=>{window.__closeDone=true;});});
 await page.waitForFunction(()=>window.__heldPreparations.length>=1);assert.deepEqual(await page.evaluate(()=>({writes:window.__writes.length,done:window.__closeDone,finished:window.__finishedClose,pending:_pendingSaveOperations.size})),{writes:0,done:false,finished:[],pending:2});
 await release();const result=await page.evaluate(async()=>{const results=await Promise.all([window.__save,window.__duplicate]);await window.__closeTask;return{results,writes:window.__writes.length,finished:window.__finishedClose,pending:_pendingSaveOperations.size};});
 assert.deepEqual(result,{results:[true,true],writes:1,finished:[{nonce:'synthetic-close-nonce',ready:true}],pending:0});
});

test('a validation failure still pending at close produces false readiness and zero native writes',async()=>{
 await page.evaluate(()=>{window.__holdTransactionSend=true;data.records[0].vehicleId='missing-synthetic-parent';window.__save=saveData(data,{operation:{id:'transaction-invalid-close'}});window.__closeDone=false;window.__closeTask=window.__onPrepareClose('synthetic-invalid-close').then(()=>{window.__closeDone=true;});});
 await page.waitForFunction(()=>window.__heldSends.length>0,{timeout:30000});assert.equal(await page.evaluate(()=>window.__closeDone),false);
 await page.evaluate(()=>{window.__holdTransactionSend=false;window.__heldSends.splice(0).forEach(send=>send());});const result=await page.evaluate(async()=>{const saved=await window.__save;await window.__closeTask;return{saved,writes:window.__writes.length,finished:window.__finishedClose,pending:_pendingSaveOperations.size};});
 assert.deepEqual(result,{saved:false,writes:0,finished:[{nonce:'synthetic-invalid-close',ready:false}],pending:0});
});
