const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{createRequire}=require('node:module');
const commands=require('../assets/core/platform-commands.js'),schema=require('../assets/core/platform-schema.js');
let pw;try{pw=require('playwright');}catch{pw=createRequire(path.join(process.env.TVS_PLAYWRIGHT_MODULES||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),'package.json'))('playwright');}
let browser,page,errors;
function fixture(){const db=Object.fromEntries(schema.sections.map(name=>[name,[]]));db.vehicles=[{id:712,plate:'SYNTHETIC-COMMAND',fuel:'diesel',fuelGrade:'ДТ',norm:10,fuelBalance:20}];db.tanks=[{id:22,name:'SYNTHETIC-COMMAND-TANK',fuel:'diesel',balanceInit:100}];db.fuelCards=[{id:'fc_cash',number:'НАЛИЧКА',provider:'Наличка',assignments:[]}];db.appMeta=[{id:'meta',toPlanInit:'synthetic'}];return db;}
before(async()=>{const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';browser=await pw.chromium.launch({headless:true,executablePath:process.env.TVS_TEST_BROWSER||(!process.env.CI&&fs.existsSync(edge)?edge:undefined)});});
after(async()=>{await browser?.close();});
beforeEach(async()=>{
 page=await browser.newPage({viewport:{width:1280,height:900}});errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await page.exposeFunction('__planNativeCommand',request=>{
  try{return{ok:true,...commands.plan(request.database,request.command,{id:request.operationId,now:'2026-10-22T12:00:00.000Z',today:'2026-10-22',actor:{id:'trusted-native-user',name:'Trusted native user',role:'admin'}})};}
  catch(error){return{ok:false,code:error.code,error:error.message,issues:error.issues};}
 });
 await page.addInitScript(({database,sections})=>{
  window.__disk=JSON.stringify(database);window.__token='synthetic-command-IPC-A';window.__revisions=Object.fromEntries(sections.map(name=>[name,1]));
  window.__nativeRequests=[];window.__nativeRawWrites=0;window.__nativeHold=false;window.__nativeReleases=[];window.__nativeMode='ok';window.__nativeCommits=0;window.__nativeReceipts={};window.__nativeSnapshotReads=0;window.__nativeUnverifiedReads=0;window.__closeReplies=[];
  window.electronAPI={
   readSnapshot:async payload=>{window.__nativeSnapshotReads++;if(JSON.stringify(payload?.hello)!==JSON.stringify(PlatformCompatibility.describe().hello)){window.__nativeUnverifiedReads++;return null;}return JSON.stringify({data:JSON.parse(window.__disk),databaseToken:window.__token,revisions:{...window.__revisions},platform:{apiVersion:1,operations:1,outbox:1,commands:1,personnelPlanning:1,calendar:1}});},
   writeSections:async()=>{window.__nativeRawWrites++;return{ok:false,error:'Unexpected raw persistence in semantic command test'};},
   executeCommand:async raw=>{
    window.__nativeRequests.push(raw);const request=JSON.parse(raw);if(window.__nativeHold)await new Promise(resolve=>window.__nativeReleases.push(resolve));
    if(window.__nativeMode==='reject')return{ok:false,code:'COMMAND_CONFLICT',error:'Synthetic trusted dependency conflict',databaseToken:request.databaseToken};
    let result=window.__nativeReceipts[request.operation.id];
    if(result){if(result.operationReceipt.digest!==request.operation.digest)return{ok:false,code:'OPERATION_ID_REUSE',error:'Synthetic intent reuse'};result=structuredClone(result);result.operationReceipt.status='replayed';}
    else{
     const db=JSON.parse(window.__disk),planned=await window.__planNativeCommand({database:db,command:request.command,operationId:request.operation.id});if(!planned.ok)return planned;
     const canonical={...planned.sections,auditLog:(db.auditLog||[]).concat({id:'synthetic-audit-'+request.operation.id,at:'2026-10-22T12:00:00.000Z',actor:'Trusted native user',section:'fuelMovements',recordId:request.operation.id,action:'create'})};
     for(const[name,rows]of Object.entries(canonical)){db[name]=rows;window.__revisions[name]++;}window.__disk=JSON.stringify(db);window.__nativeCommits++;
     result={ok:true,databaseToken:request.databaseToken,revisions:{...window.__revisions},canonicalSections:canonical,operationReceipt:{id:request.operation.id,digest:request.operation.digest,status:'committed'}};window.__nativeReceipts[request.operation.id]=structuredClone(result);
    }
    if(window.__nativeMode==='unknown')return{ok:false,unknown:true,queued:true,code:'ACK_UNKNOWN',error:'Synthetic lost acknowledgement'};
    if(window.__nativeMode==='missingCanonical')delete result.canonicalSections;
    if(window.__nativeMode==='badDigest')result.operationReceipt.digest='sha256:'+'0'.repeat(64);
    return result;
   },
   onPrepareClose:callback=>{window.__nativePrepareClose=callback;},finishClose:async reply=>{window.__closeReplies.push(reply);return true;}
  };
 },{database:fixture(),sections:schema.sections});
 await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);await page.waitForFunction(()=>typeof platformExecuteCommand==='function'&&typeof data!=='undefined'&&data.vehicles[0]?.id===712);
 await page.evaluate(()=>{window.__nativeCommand={type:'IssueFuel',version:1,input:{tankId:22,target:{section:'vehicles',id:712},date:'2026-10-01',qty:10,reason:'Synthetic command order'}};});
});
afterEach(async()=>{await page?.close();assert.deepEqual(errors,[]);});
async function start(id='synthetic-native-command'){
 await page.evaluate(id=>{window.__nativeHold=true;window.__nativeOperation=platformExecuteCommand(window.__nativeCommand,{operationId:id});},id);await page.waitForFunction(()=>window.__nativeReleases.length===1);
}
async function release(){await page.evaluate(()=>{window.__nativeHold=false;window.__nativeReleases.splice(0).forEach(resolve=>resolve());});}

test('the real helper refuses older capabilities without calling either IPC save API',async()=>{
 const result=await page.evaluate(async()=>{_sync.platform.commands=0;return{result:await platformExecuteCommand(window.__nativeCommand,{operationId:'unsupported-command'}),requests:window.__nativeRequests.length,raw:window.__nativeRawWrites,movements:data.fuelMovements.length};});assert.equal(result.result.ok,false);assert.equal(result.result.code,'UNSUPPORTED_COMMANDS');assert.match(result.result.message,/совместим|поддержива/);assert.equal(result.requests,0);assert.equal(result.raw,0);assert.equal(result.movements,0);
});

test('linked receipt drafts, posting and history actions require procurement capability before any IPC',async()=>{
 const results=await page.evaluate(async()=>{
  _sync.platform.fuelOperations=1;_sync.platform.procurement=0;
  data.partMovements.push({id:0,kind:'receipt',partId:0,qty:30,date:'2026-10-01'});
  data.procurementOrders.push({id:'legacy-linked',procurement:{receiptRefs:[{section:'partMovements',id:0}]}});
  data.documentDrafts.push({id:'linked-draft',section:'partMovements',payload:{kind:'receipt',partId:0,qty:20,procurementReceipt:{version:1,orderId:'order'}}});
  const fingerprint='sha256:'+'0'.repeat(64),inputs=[
   {action:'saveDraft',section:'partMovements',payload:{kind:'receipt',partId:0,qty:20,procurementReceipt:{version:1,orderId:'order'}}},
   {action:'postDraft',section:'partMovements',draftId:'linked-draft',reviewFingerprint:fingerprint},
   {action:'reverse',section:'partMovements',id:0,reason:'Synthetic reviewed return',reviewFingerprint:fingerprint},
   {action:'saveDraft',section:'partMovements',correctionOf:{section:'partMovements',id:0},reason:'Synthetic receipt correction',payload:{kind:'receipt',partId:0,qty:25}}
  ];
  const replies=[];for(const[index,input]of inputs.entries())replies.push(await platformExecuteCommand({type:'DocumentAction',version:1,input},{operationId:'unsupported-linked-'+index}));
  return{replies,requests:__nativeRequests.length,raw:__nativeRawWrites};
 });
 assert.equal(results.replies.length,4);for(const reply of results.replies){assert.equal(reply.ok,false);assert.equal(reply.code,'UNSUPPORTED_PROCUREMENT');}assert.equal(results.requests,0);assert.equal(results.raw,0);
});

test('valuation commands refuse an older server before IPC and never fall back to ordinary card writes',async()=>{
 const result=await page.evaluate(async()=>{
  const command={type:'CostAction',version:1,input:{action:'savePolicy',target:{section:'parts',id:0},payload:{from:'2026-09-01',method:'fifo',taxBasis:'gross',opening:{qty:0,amount:0,basis:'Synthetic verified empty opening'},basis:'Synthetic documented policy'},reason:'Synthetic confirmed policy',reviewFingerprint:'sha256:'+'0'.repeat(64)}};
  const response=await platformExecuteCommand(command,{operationId:'unsupported-cost-policy'});return{response,requests:__nativeRequests.length,raw:__nativeRawWrites};
 });assert.equal(result.response.ok,false);assert.equal(result.response.code,'UNSUPPORTED_COST_ACCOUNTING');assert.equal(result.requests,0);assert.equal(result.raw,0);
});

test('acquisition obligations, receipt pricing and valued fuel issues require the new capability across drafts and corrections',async()=>{
 const result=await page.evaluate(async()=>{
  const fingerprint='sha256:'+'0'.repeat(64);_sync.platform.fuelOperations=1;
  data.documentDrafts.push({id:0,section:'payments',payload:{source:'partReceipt',sourceId:0,sum:10}});
  data.payments.push({id:'root',source:'tankIncome',sourceId:0,sum:10},{id:'revision',lifecycle:{correctionOf:{section:'payments',id:'root'}}});
  data.tanks[0].costValuation={version:1};
  const inputs=[
   {action:'saveDraft',section:'payments',payload:{source:'tankIncome',sourceId:0,sum:10}},
   {action:'postDraft',section:'payments',draftId:0,reviewFingerprint:fingerprint},
   {action:'saveDraft',section:'payments',correctionOf:{section:'payments',id:'revision'},reason:'Synthetic revised obligation',payload:{sum:10}},
   {action:'saveDraft',section:'partMovements',payload:{kind:'receipt',partId:0,qty:1,sum:10}}
  ],replies=[];
  for(const[index,input]of inputs.entries())replies.push(await platformExecuteCommand({type:'DocumentAction',version:1,input},{operationId:'old-cost-document-'+index}));
  replies.push(await platformExecuteCommand(__nativeCommand,{operationId:'old-cost-fuel-issue'}));
  return{replies,requests:__nativeRequests.length,raw:__nativeRawWrites};
 });assert.equal(result.replies.length,5);for(const reply of result.replies){assert.equal(reply.ok,false);assert.equal(reply.code,'UNSUPPORTED_COST_ACCOUNTING');}assert.equal(result.requests,0);assert.equal(result.raw,0);
});

test('repair actions and linked material documents refuse an older server across direct, draft and historical routes',async()=>{
 const result=await page.evaluate(async()=>{
  _sync.platform.repairs=0;_sync.platform.costAccounting=1;_sync.platform.procurement=1;_sync.platform.fuelOperations=1;
  const fingerprint='sha256:'+'0'.repeat(64);data.workOrders.push({id:0,status:'repairing',assetRef:'v:712'});data.partMovements.push({id:0,kind:'issue',partId:0,workOrderId:0,assetRef:'v:712',qty:1,date:'2026-09-10'},{id:'revision',lifecycle:{correctionOf:{section:'partMovements',id:0}}});
  data.documentDrafts.push({id:'repair-draft',section:'workOrders',payload:{title:'Synthetic retained order'}},{id:'material-draft',section:'partMovements',payload:{kind:'return',partId:0,qty:1,workOrderId:0,repairReturn:{version:1,issueId:0}}});
  const commands=[{type:'RepairAction',version:1,input:{action:'approve',orderId:0,reason:'Synthetic approval',reviewFingerprint:fingerprint}},...[
   {action:'saveDraft',section:'workOrders',payload:{title:'Synthetic order'}},
   {action:'postDraft',section:'workOrders',draftId:'repair-draft',reviewFingerprint:fingerprint},
   {action:'saveDraft',section:'partMovements',payload:{kind:'issue',partId:0,qty:1,workOrderId:0}},
   {action:'postDraft',section:'partMovements',draftId:'material-draft',reviewFingerprint:fingerprint},
   {action:'saveDraft',section:'partMovements',correctionOf:{section:'partMovements',id:'revision'},reason:'Synthetic correction',payload:{qty:1}}
  ].map(input=>({type:'DocumentAction',version:1,input}))],replies=[];
  for(const[index,command]of commands.entries())replies.push(await platformExecuteCommand(command,{operationId:'unsupported-repair-'+index}));return {replies,requests:__nativeRequests.length,raw:__nativeRawWrites};
 });assert.equal(result.replies.length,6);for(const reply of result.replies){assert.equal(reply.ok,false);assert.equal(reply.code,'UNSUPPORTED_REPAIRS');}assert.equal(result.requests,0);assert.equal(result.raw,0);
});

test('real helper double calls share one IPC and apply canonical rows and persisted baselines only after ACK',async()=>{
 const before=await page.evaluate(()=>({data:JSON.stringify(data),baseline:_lastPersisted}));await start();await page.evaluate(()=>{window.__nativeDuplicate=platformExecuteCommand(window.__nativeCommand,{operationId:'synthetic-native-command'});});
 assert.deepEqual(await page.evaluate(()=>({data:JSON.stringify(data),baseline:_lastPersisted,requests:window.__nativeRequests.length,raw:window.__nativeRawWrites})),{...before,requests:1,raw:0});await release();
 const result=await page.evaluate(async()=>{const replies=await Promise.all([window.__nativeOperation,window.__nativeDuplicate]);return{replies,revisions:{..._sync.revs},baseline:JSON.parse(_lastPersisted),syncedRecords:JSON.parse(_sync.synced.records),data:data.records,commits:window.__nativeCommits,requests:window.__nativeRequests.length,raw:window.__nativeRawWrites};});
 assert.equal(result.replies.every(reply=>reply.ok),true);assert.equal(result.commits,1);assert.equal(result.requests,1);assert.equal(result.raw,0);assert.equal(result.data.length,1);assert.equal(result.data[0].fuelMovementId,'synthetic-native-command');assert.equal(result.data[0].createdAt,'2026-10-22T12:00:00.000Z');assert.deepEqual(result.data,result.syncedRecords);assert.deepEqual(result.data,result.baseline.records);assert.equal(result.baseline.fuelMovements.length,1);assert.equal(result.baseline.auditLog.length,1);assert.equal(result.revisions.records,2);
});

test('unknown ACK retry reuses the exact envelope including original dependency base and digest',async()=>{
 const first=await page.evaluate(async()=>{window.__nativeMode='unknown';return platformExecuteCommand(window.__nativeCommand,{operationId:'unknown-native-command'});});assert.equal(first.ok,false);assert.equal(first.unknown,true);assert.equal(await page.evaluate(()=>data.fuelMovements.length),0);assert.equal(await page.evaluate(()=>window.__nativeCommits),1);
 const second=await page.evaluate(async()=>{window.__nativeMode='ok';for(const name of PlatformCommands.dependencies(window.__nativeCommand))_sync.revs[name]+=10;return platformExecuteCommand(window.__nativeCommand,{operationId:'unknown-native-command'});});assert.equal(second.ok,true);assert.equal(second.operationReceipt.status,'replayed');const requests=await page.evaluate(()=>window.__nativeRequests);assert.equal(requests.length,2);assert.equal(requests[0],requests[1]);assert.equal(await page.evaluate(()=>window.__nativeCommits),1);assert.equal(await page.evaluate(()=>data.fuelMovements.length),1);
});

for(const kind of ['database','role','fieldPermissions','costActions','printActions','source'])test('a '+kind+' change during IPC prevents the late canonical ACK from overwriting current data',async()=>{
 if(kind==='fieldPermissions'||kind==='costActions'||kind==='printActions')await page.evaluate(()=>{_sync.access={user:{id:'same-admin',name:'Same admin',role:'admin'},readable:PlatformSchema.sections.slice(),writable:PlatformSchema.sections.slice(),fieldPermissions:{vehicles:['plate']},costActions:['savePolicy'],printActions:['capture']};});
 const baseline=await page.evaluate(()=>_lastPersisted);await start('stale-native-'+kind);
 await page.evaluate(kind=>{
  if(kind==='database'){const replacement=structuredClone(data);replacement.vehicles[0].plate='NEW-SYNTHETIC-DATABASE';data=replacement;_sync.databaseToken='synthetic-command-IPC-B';_lastPersisted=JSON.stringify(replacement);}
  else if(kind==='role')_sync.access={user:{id:'synthetic-viewer',name:'Viewer',role:'viewer'},readable:PlatformSchema.sections.slice(),writable:[]};
  else if(kind==='fieldPermissions')_sync.access.fieldPermissions.vehicles.push('note');
  else if(kind==='costActions')_sync.access.costActions.push('saveAllocation');
  else if(kind==='printActions')_sync.access.printActions=[];
  else data.vehicles[0].note='New local source change';
 },kind);const captured=await page.evaluate(()=>({data:JSON.stringify(data),baseline:_lastPersisted}));await release();const result=await page.evaluate(async()=>({result:await window.__nativeOperation,data:JSON.stringify(data),baseline:_lastPersisted,movements:data.fuelMovements.length,records:data.records.length,commits:window.__nativeCommits,raw:window.__nativeRawWrites}));assert.equal(result.result.ok,false);assert.equal(result.data,captured.data);assert.equal(result.baseline,captured.baseline);assert.equal(result.movements,0);assert.equal(result.records,0);assert.equal(result.commits,1);assert.equal(result.raw,0);if(kind!=='database')assert.equal(result.baseline,baseline);if(kind==='source'){assert.equal(result.result.committed,true);assert.equal(result.result.needsReload,true);}
});

test('the shared close barrier waits for a semantic command receipt before allowing close',async()=>{
 await start('close-native-command');await page.evaluate(()=>{window.__nativeCloseDone=false;window.__nativeClose=window.__nativePrepareClose('semantic-close').then(()=>{window.__nativeCloseDone=true;});});assert.deepEqual(await page.evaluate(()=>({done:window.__nativeCloseDone,replies:window.__closeReplies,pending:_pendingSaveOperations.size})),{done:false,replies:[],pending:1});await release();const result=await page.evaluate(async()=>{await window.__nativeClose;return{operation:await window.__nativeOperation,replies:window.__closeReplies,pending:_pendingSaveOperations.size};});assert.equal(result.operation.ok,true);assert.deepEqual(result.replies,[{nonce:'semantic-close',ready:true}]);assert.equal(result.pending,0);
});

test('an unconfirmed semantic command produces false close readiness without inventing canonical rows',async()=>{
 await page.evaluate(()=>{window.__nativeMode='unknown';});await start('unknown-close-native');await page.evaluate(()=>{window.__nativeClose=window.__nativePrepareClose('semantic-unknown-close');});await release();const result=await page.evaluate(async()=>{await window.__nativeClose;return{operation:await window.__nativeOperation,replies:window.__closeReplies,movements:data.fuelMovements.length};});assert.equal(result.operation.unknown,true);assert.deepEqual(result.replies,[{nonce:'semantic-unknown-close',ready:false}]);assert.equal(result.movements,0);
});

test('canonical application preserves unrelated dirty editors without adding their drafts to persisted baselines',async()=>{
 const result=await page.evaluate(async()=>{data.opsTasks.push({id:'unsaved-local-task',title:'Local task draft',status:'open',owner:'Local owner',due:'2026-10-22'});const response=await platformExecuteCommand(window.__nativeCommand,{operationId:'unrelated-dirty-native'});return{response,local:data.opsTasks,baseline:JSON.parse(_lastPersisted).opsTasks,synced:JSON.parse(_sync.synced.opsTasks),disk:JSON.parse(window.__disk).opsTasks,movements:data.fuelMovements.length};});assert.equal(result.response.ok,true);assert.equal(result.local.length,1);assert.deepEqual(result.baseline,[]);assert.deepEqual(result.synced,[]);assert.deepEqual(result.disk,[]);assert.equal(result.movements,1);
});

test('a replay without canonical sections reloads only acknowledged sections and preserves unrelated drafts',async()=>{
 const reads=await page.evaluate(()=>window.__nativeSnapshotReads);const result=await page.evaluate(async()=>{window.__nativeMode='missingCanonical';data.opsTasks.push({id:'local-reload-draft',title:'Preserved unrelated draft'});const response=await platformExecuteCommand(window.__nativeCommand,{operationId:'reload-native-command'});return{response,movements:data.fuelMovements.length,local:data.opsTasks,baseline:JSON.parse(_lastPersisted).opsTasks,reads:window.__nativeSnapshotReads,unverifiedReads:window.__nativeUnverifiedReads,enabled:_sync.enabled};});assert.equal(result.response.ok,true);assert.equal(result.movements,1);assert.equal(result.local[0].id,'local-reload-draft');assert.deepEqual(result.baseline,[]);assert.equal(result.reads,reads+1);assert.equal(result.unverifiedReads,0);assert.equal(result.enabled,true);
});

test('a receipt with another digest is left unknown and cannot apply even valid-looking canonical sections',async()=>{
 const result=await page.evaluate(async()=>{window.__nativeMode='badDigest';return{response:await platformExecuteCommand(window.__nativeCommand,{operationId:'bad-receipt-native'}),movements:data.fuelMovements.length,records:data.records.length,baseline:JSON.parse(_lastPersisted).fuelMovements};});assert.equal(result.response.ok,false);assert.equal(result.response.code,'ACK_REQUIRED');assert.equal(result.response.unknown,true);assert.equal(result.movements,0);assert.equal(result.records,0);assert.deepEqual(result.baseline,[]);
});

test('completed-command retention keeps compact proof instead of business rows and duplicate returns no second IPC',async()=>{
 const result=await page.evaluate(async()=>{
  const first=await platformExecuteCommand(window.__nativeCommand,{operationId:'retention-native-command'}),duplicate=await platformExecuteCommand(window.__nativeCommand,{operationId:'retention-native-command'}),retained=_platformCommandIntents.get('retention-native-command').result;
  return{first:first.ok,duplicate,keys:Object.keys(retained),retainedText:JSON.stringify(retained),requests:window.__nativeRequests.length};
 });assert.equal(result.first,true);assert.equal(result.duplicate.ok,true);assert.equal(result.duplicate.alreadyApplied,true);assert.equal(result.requests,1);assert.equal('canonicalSections'in result.duplicate,false);assert.equal(result.keys.includes('canonicalSections'),false);assert.equal(result.keys.includes('revisions'),false);assert.doesNotMatch(result.retainedText,/fuelSourceSnapshot|fuelMovementId|SYNTHETIC-COMMAND-TANK|Trusted native user/);
});
