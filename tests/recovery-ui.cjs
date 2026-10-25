const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{createRequire}=require('node:module');
let pw;try{pw=require('playwright');}catch{pw=createRequire(path.join(process.env.TVS_PLAYWRIGHT_MODULES||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),'package.json'))('playwright');}
let browser,page,errors;
before(async()=>{const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';browser=await pw.chromium.launch({headless:true,executablePath:process.env.TVS_TEST_BROWSER||(!process.env.CI&&fs.existsSync(edge)?edge:undefined)});});
after(async()=>{await browser?.close();});
beforeEach(async()=>{
 page=await browser.newPage({viewport:{width:1280,height:900}});errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  window.__disk={vehicles:[{id:'recovery-v',plate:'SYNTHETIC-RECOVERY',fuelGrade:'ДТ',norm:10,fuelBalance:100}],records:[],fuelCards:[{id:'cash',number:'НАЛИЧКА',provider:'Наличка',assignments:[]}],appMeta:[{id:'meta',toPlanInit:'test'}]};
  window.__queue=[{id:'recovery-unknown',status:'unknown',sections:['records'],createdAt:'2026-10-21T12:00:00Z'}];
  window.__calls=[];window.__reads=0;window.__writes=0;window.__queueReads=0;window.__heldLists=[];window.__heldActions=[];window.__responses={};
  window.__token='synthetic-recovery-A';window.__listError=null;window.__deferList=false;window.__deferAction=false;
  const action=async(method,id)=>{
   window.__calls.push({method,id,token:_sync.databaseToken});
   const response=window.__deferAction?await new Promise((resolve,reject)=>window.__heldActions.push({resolve,reject})):
    (window.__responses[method]||{ok:true,committed:false});
   if(response?.committed||response?.operationReceipt)window.__queue=window.__queue.map(row=>row.id===id?{...row,status:'committed'}:row);
   else if(response?.conflicts)window.__queue=window.__queue.map(row=>row.id===id?{...row,status:'conflict'}:row);
   else if(method==='discard'&&response?.ok)window.__queue=window.__queue.filter(row=>row.id!==id);
   return response;
  };
  window.electronAPI={
   readSnapshot:async()=>{window.__reads++;const db=structuredClone(window.__disk);for(const name of PlatformSchema.sections)db[name]??=[];return JSON.stringify({data:db,revisions:Object.fromEntries(PlatformSchema.sections.map(name=>[name,1])),databaseToken:window.__token,platform:{apiVersion:1,operations:1,outbox:1,receiptQuery:1}});},
   writeSections:async()=>{window.__writes++;throw Error('Recovery UI must not submit a newly constructed save');},
   getPendingOperations:async()=>{
    window.__queueReads++;
    if(window.__deferList){const captured=structuredClone(window.__queue);return new Promise(resolve=>window.__heldLists.push(()=>resolve({ok:true,operations:captured})));}
    if(window.__listError)return{ok:false,error:window.__listError};return{ok:true,operations:structuredClone(window.__queue)};
   },
   reconcileOperation:id=>action('check',id),retryOperation:id=>action('retry',id),discardOperation:id=>action('discard',id)
  };
 });
 await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);
 await page.waitForFunction(()=>typeof data!=='undefined'&&data.vehicles[0]?.id==='recovery-v');
 await page.evaluate(()=>switchSection('system'));
 await page.locator('[data-operation-check]').waitFor();
});
afterEach(async()=>{await page?.close();assert.deepEqual(errors,[]);});

test('pending recovery check is visible on the first screen without starting a recovery action',async()=>{
 for(const viewport of [{width:1280,height:900},{width:960,height:700}]){
  await page.setViewportSize(viewport);await page.evaluate(()=>renderPlatformSystem());await page.locator('#platformRecovery [data-operation-check]').waitFor();
  const button=await page.locator('#platformRecovery [data-operation-check]').boundingBox();assert.ok(button&&button.y>=0&&button.y+button.height<=viewport.height,JSON.stringify({viewport,button}));
 }
 assert.deepEqual(await page.evaluate(()=>({calls:window.__calls,writes:window.__writes})),{calls:[],writes:0});
});

test('recovery remains available while the general health calculation is pending or fails',async()=>{
 await page.evaluate(()=>{dispatcherBackgroundNeeded=()=>true;dispatcherHealthAsync=()=>new Promise((resolve,reject)=>{window.__rejectHealth=reject;});renderPlatformSystem();});
 await page.locator('#platformRecovery [data-operation-check]').waitFor();assert.match(await page.locator('.platform-workspace > p').innerText(),/Выполняется расчёт/);
 await page.evaluate(()=>window.__rejectHealth(Error('Synthetic health calculation failed')));await page.waitForFunction(()=>document.querySelector('.platform-workspace > p')?.textContent==='Synthetic health calculation failed');
 assert.equal(await page.locator('#platformRecovery [data-operation-check]').isVisible(),true);assert.deepEqual(await page.evaluate(()=>({calls:window.__calls,writes:window.__writes})),{calls:[],writes:0});
});

test('startup warns about unresolved metadata without automatically checking, retrying or writing',async()=>{
 await page.waitForFunction(()=>document.getElementById('globalToast')?.textContent.includes('Есть неподтверждённые операции: 1'));
 assert.deepEqual(await page.evaluate(()=>({calls:window.__calls,writes:window.__writes})),{calls:[],writes:0});
 const before=await page.evaluate(()=>{window.__queue=[...window.__queue,{id:'startup-committed',status:'committed',sections:['records']}];return window.__queueReads;});
 await page.evaluate(()=>platformNotifyPendingOperations());
 assert.equal(await page.evaluate(()=>window.__queueReads),before+1);
 assert.match(await page.locator('#globalToast').innerText(),/Есть неподтверждённые операции: 1\./);
 assert.deepEqual(await page.evaluate(()=>({calls:window.__calls,writes:window.__writes})),{calls:[],writes:0});
});

test('recovery lists unresolved states and hides committed receipts without replaying or writing anything',async()=>{
 await page.evaluate(()=>{window.__queue=['pending','unknown','conflict','rejected','committed'].map(status=>({id:'row-'+status,status,sections:['records'],createdAt:'2026-10-21T12:00:00Z'}));return platformRenderRecoveryPanel();});
 assert.equal(await page.locator('[data-operation-check]').count(),4);
 assert.match(await page.locator('#platformRecovery').innerText(),/Ожидает проверки|Результат не подтверждён|Нужна сверка версий|Сохранение отклонено/);
 assert.deepEqual(await page.evaluate(()=>({calls:window.__calls,writes:window.__writes})),{calls:[],writes:0});
});

test('checking an uncertain result uses only reconcile with the original operation ID',async()=>{
 const before=await page.evaluate(()=>JSON.stringify(data));
 await page.locator('[data-operation-check]').click();
 await page.waitForFunction(()=>window.__calls.length===1);
 assert.deepEqual(await page.evaluate(()=>window.__calls),[{method:'check',id:'recovery-unknown',token:'synthetic-recovery-A'}]);
 assert.equal(await page.evaluate(()=>JSON.stringify(data)),before);assert.equal(await page.evaluate(()=>window.__writes),0);
 assert.match(await page.locator('#platformRecovery').innerText(),/Результат не подтверждён/);
});

test('a confirmed retry reloads canonical data and removes the resolved row from the panel',async()=>{
 const before=await page.evaluate(()=>{window.__responses.retry={ok:true,operationReceipt:{id:'recovery-unknown',status:'replayed'}};window.__disk.vehicles[0].note='Canonical recovered result';return window.__reads;});
 await page.locator('[data-operation-retry]').click();
 await page.waitForFunction(()=>data.vehicles[0].note==='Canonical recovered result');
 await page.waitForFunction(()=>document.getElementById('platformRecovery')?.textContent.includes('Ожидающих операций нет'));
 assert.equal(await page.evaluate(()=>window.__reads),before+1);
 assert.deepEqual(await page.evaluate(()=>window.__calls.map(call=>[call.method,call.id])),[['retry','recovery-unknown']]);
 assert.equal(await page.evaluate(()=>window.__writes),0);
});

test('a version-conflicting retry remains available for review and never reports a successful write',async()=>{
 const before=await page.evaluate(()=>{window.__responses.retry={ok:false,conflicts:['records'],error:'Synthetic revision conflict'};return JSON.stringify(data);});
 await page.locator('[data-operation-retry]').click();
 await page.waitForFunction(()=>document.getElementById('platformRecovery')?.textContent.includes('Нужна сверка версий'));
 assert.equal(await page.evaluate(()=>JSON.stringify(data)),before);assert.equal(await page.evaluate(()=>window.__writes),0);
 assert.doesNotMatch(await page.locator('#globalToast').innerText(),/Операция сохранена/);
});

test('discard requires confirmation, cancellation preserves the queue, and confirmation passes the original ID',async()=>{
 await page.locator('[data-operation-discard]').click();await page.locator('#confirmModal.open').waitFor();
 assert.match(await page.locator('#confirmMessage').innerText(),/не отменяет запись/);
 await page.locator('#confirmNo').click();assert.deepEqual(await page.evaluate(()=>window.__calls),[]);
 await page.locator('[data-operation-discard]').click();await page.locator('#confirmYes').click();
 await page.waitForFunction(()=>window.__calls.length===1);
 assert.deepEqual(await page.evaluate(()=>window.__calls),[{method:'discard',id:'recovery-unknown',token:'synthetic-recovery-A'}]);
 await page.waitForFunction(()=>document.getElementById('platformRecovery')?.textContent.includes('Ожидающих операций нет'));
 assert.equal(await page.evaluate(()=>window.__writes),0);
});

test('hostile IDs, timestamps and backend error messages remain inert text and keep exact button arguments',async()=>{
 const id='\"><img id="recoveryInjected" src="invalid" onerror="window.__recoveryExecuted=true">&\'',error='<img id="recoveryErrorInjected" src="invalid" onerror="window.__recoveryExecuted=true">';
 await page.evaluate(({id,error})=>{window.__recoveryExecuted=false;window.__queue=[{id,status:'unknown',sections:['records'],createdAt:error}];window.__responses.check={ok:false,error};return platformRenderRecoveryPanel();},{id,error});
 assert.equal(await page.locator('#recoveryInjected,#recoveryErrorInjected').count(),0);
 await page.locator('[data-operation-check]').click();
 await page.waitForFunction(()=>window.__calls.length===1);
 assert.equal(await page.evaluate(()=>window.__calls[0].id),id);assert.equal(await page.evaluate(()=>window.__recoveryExecuted),false);
 assert.equal(await page.locator('#globalToast').innerText(),error);assert.equal(await page.locator('#recoveryInjected,#recoveryErrorInjected').count(),0);
});

test('an untrusted queue-read error is escaped and cannot create markup',async()=>{
 const error='<img id="queueReadInjected" src="invalid"> Queue unavailable';
 await page.evaluate(error=>{window.__listError=error;return platformRenderRecoveryPanel();},error);
 assert.equal(await page.locator('#queueReadInjected').count(),0);assert.ok((await page.locator('#platformRecovery').innerText()).includes(error));
 assert.equal(await page.evaluate(()=>window.__writes),0);
});

test('late list results from another database cannot overwrite the current recovery panel',async()=>{
 await page.evaluate(()=>{window.__deferList=true;window.__oldList=platformRenderRecoveryPanel();});
 await page.waitForFunction(()=>window.__heldLists.length===1);
 await page.evaluate(async()=>{_sync.databaseToken='synthetic-recovery-B';window.__token='synthetic-recovery-B';window.__deferList=false;window.__queue=[];await platformRenderRecoveryPanel();window.__heldLists[0]();await window.__oldList;});
 assert.match(await page.locator('#platformRecovery').innerText(),/Ожидающих операций нет/);assert.equal(await page.locator('[data-operation-check]').count(),0);
 assert.equal(await page.evaluate(()=>window.__writes),0);
});

test('late successful action responses cannot reload data or show success in a new database',async()=>{
 await page.evaluate(()=>{document.getElementById('globalToast').textContent='';window.__deferAction=true;});await page.locator('[data-operation-check]').click();
 await page.waitForFunction(()=>window.__heldActions.length===1);
 const result=await page.evaluate(async()=>{const reads=window.__reads;_sync.databaseToken='synthetic-recovery-B';window.__token='synthetic-recovery-B';data.vehicles[0].note='New database';window.__queue=[];await platformRenderRecoveryPanel();window.__heldActions[0].resolve({ok:true,committed:true,operationReceipt:{id:'recovery-unknown',status:'committed'}});await new Promise(resolve=>setTimeout(resolve,20));return{reads:window.__reads-reads,note:data.vehicles[0].note,toast:document.getElementById('globalToast')?.textContent||''};});
 assert.deepEqual(result,{reads:0,note:'New database',toast:''});assert.match(await page.locator('#platformRecovery').innerText(),/Ожидающих операций нет/);
});

test('late rejected action responses cannot show an old database error in the new session',async()=>{
 await page.evaluate(()=>{document.getElementById('globalToast').textContent='';window.__deferAction=true;});await page.locator('[data-operation-check]').click();await page.waitForFunction(()=>window.__heldActions.length===1);
 const toast=await page.evaluate(async()=>{_sync.databaseToken='synthetic-recovery-B';window.__token='synthetic-recovery-B';window.__queue=[];await platformRenderRecoveryPanel();window.__heldActions[0].reject(Error('STALE-OLD-DATABASE-ERROR'));await new Promise(resolve=>setTimeout(resolve,20));return document.getElementById('globalToast')?.textContent||'';});
 assert.equal(toast,'');assert.match(await page.locator('#platformRecovery').innerText(),/Ожидающих операций нет/);
});

test('confirmation begun in an old session cannot discard an operation after the database changes',async()=>{
 await page.locator('[data-operation-discard]').click();await page.locator('#confirmModal.open').waitFor();
 await page.evaluate(()=>{_sync.databaseToken='synthetic-recovery-B';window.__token='synthetic-recovery-B';});
 await page.locator('#confirmYes').click();await page.waitForTimeout(30);
 assert.deepEqual(await page.evaluate(()=>window.__calls),[]);assert.equal(await page.evaluate(()=>window.__writes),0);
});
