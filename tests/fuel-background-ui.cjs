const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {createRequire}=require('node:module');
let pw;try{pw=require('playwright');}catch{pw=createRequire(path.join(process.env.TVS_PLAYWRIGHT_MODULES||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),'package.json'))('playwright');}
const root=path.resolve(__dirname,'..');let browser,server,origin,page,errors;
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
  const db={vehicles:[{id:'background-v',plate:'SYNTHETIC-BACKGROUND',org:'Synthetic organization',fuel:'diesel',fuelGrade:'ДТ',norm:10,fuelBalance:50,fuelBalanceSources:[{org:'Synthetic organization',grade:'ДТ',qty:50}]}],
   records:[{id:'background-r',vehicleId:'background-v',date:'2026-09-10',km:100,fuelIssued:40,fuelActual:20,fuelGrade:'ДТ'},...Array.from({length:1000},(_,index)=>({id:'filler-'+index,vehicleId:'background-v',date:'2026-09-01',km:0,fuelIssued:0,fuelActual:0,fuelGrade:'ДТ'}))],
   fuelPurchases:[{id:'background-p',recordId:'background-r',vehicleId:'background-v',date:'2026-09-10',grade:'ДТ',qty:40,sum:2400,price:60,sourceOrg:'Synthetic organization',sourceProvider:'Synthetic supplier'}],fuelCards:[{id:'cash',number:'НАЛИЧКА',provider:'Наличка',assignments:[]}],fuelWriteoffs:[],monthlyFuel:[],fuelPeriods:[],appMeta:[{id:'meta',toPlanInit:'test'}]};
  window.__disk=structuredClone(db);window.__revisions=Object.fromEntries(Object.keys(db).map(section=>[section,1]));window.__writes=0;window.__exports=[];window.__workers=0;window.__workerMessages=[];window.__workerDeliveries=[];window.__holdWorkerLoad=false;window.__queries=[];window.__heldReplies=[];window.__holdAfter=[];window.__syncFuel=[];
  const NativeWorker=window.Worker;window.Worker=class extends NativeWorker{constructor(...args){super(...args);window.__workers++;}postMessage(message,...args){window.__workerMessages.push(message.type+':'+(message.name||''));if(message.type==='load'&&window.__holdWorkerLoad){window.__workerDeliveries.push(()=>super.postMessage(message,...args));return;}return super.postMessage(message,...args);}};
  window.electronAPI={readSnapshot:async()=>JSON.stringify({data:window.__disk,revisions:window.__revisions,databaseToken:'synthetic-background-token'}),writeSections:async json=>{window.__writes++;const payload=JSON.parse(json);for(const [section,rows]of Object.entries(payload.sections)){window.__disk[section]=structuredClone(rows);window.__revisions[section]=(window.__revisions[section]||0)+1;}return{ok:true,databaseToken:'synthetic-background-token',revisions:{...window.__revisions},canonicalSections:{fuelWriteoffs:structuredClone(window.__disk.fuelWriteoffs)}};}};
 });
 await page.goto(origin+'/index.html');await page.waitForFunction(()=>typeof gsmPreparedWriteoff==='function'&&typeof data!=='undefined'&&data.vehicles[0]?.id==='background-v');
 await page.evaluate(()=>{
  const original=dispatcherQueryAsync;dispatcherQueryAsync=async(name,options,configuration)=>{window.__queries.push(name);const value=await original(name,options,configuration);if(window.__holdAfter.includes(name))await new Promise(resolve=>window.__heldReplies.push({name,resolve}));return value;};
  const synchronous=dispatcherQuery;dispatcherQuery=(name,options)=>{if(['fuel','writeoff'].includes(name)&&gsmBackgroundRequired()){window.__syncFuel.push(name);throw Error('Unexpected synchronous fuel calculation');}return synchronous(name,options);};
  XLSX.writeFile=(workbook,filename)=>window.__exports.push(filename);
  fpMonth='2026-09';fpView='writeoff';gsmOrg='';gsmFuel='';gsmActNo='BACKGROUND-2026-09';gsmActDate='2026-09-30';
  window.__factsBefore=JSON.stringify(Object.fromEntries(['vehicles','records','fuelPurchases','fuelCards','monthlyFuel','fuelPeriods'].map(section=>[section,data[section]])));
 });
});
afterEach(async()=>{await page?.close();assert.deepEqual(errors,[]);});
async function openReady(){await page.evaluate(()=>switchSection('fuelPurchases'));await page.locator('.gsm-act-steps').waitFor({timeout:30000});await page.locator('[data-gsm-act-step="4"]').click();await page.locator('.gsm-writeoff').waitFor({timeout:30000});}
async function holdPreparation(){await page.evaluate(()=>{window.__holdAfter=['fuel','writeoff'];switchSection('fuelPurchases');});await page.waitForFunction(()=>window.__heldReplies.length===2);}
async function release(){await page.evaluate(()=>{window.__holdAfter=[];window.__heldReplies.splice(0).forEach(reply=>reply.resolve());});}
async function beginPost(){await page.evaluate(()=>{gsmPostWriteoffDialog();window.__holdAfter=['writeoffPost'];});await page.locator('#gsmWriteoffPostForm').waitFor();await page.locator('[name="basisNote"]').fill('Synthetic reviewed sources');await page.locator('#gsmWriteoffPostForm [type="submit"]').click();await page.waitForFunction(()=>window.__heldReplies.some(reply=>reply.name==='writeoffPost'));}

test('a 999-row synthetic database retains the immediate synchronous workflow',async()=>{
 const size=await page.evaluate(()=>{while(Object.values(data).reduce((sum,rows)=>sum+(Array.isArray(rows)?rows.length:0),0)>999)data.records.pop();switchSection('fuelPurchases');return Object.values(data).reduce((sum,rows)=>sum+(Array.isArray(rows)?rows.length:0),0);});
 assert.equal(size,999);await page.locator('.gsm-act-steps').waitFor();assert.equal(await page.locator('#gsmBackgroundPreparation').count(),0);assert.equal(await page.evaluate(()=>window.__workers),0);assert.deepEqual(await page.evaluate(()=>window.__queries),[]);
});

test('large fuel and writeoff preparation uses real Worker while the page stays responsive and facts stay unchanged',async()=>{
 await page.evaluate(()=>{window.__holdWorkerLoad=true;window.__heartbeats=0;window.__heartbeat=setInterval(()=>window.__heartbeats++,5);switchSection('fuelPurchases');});
 await page.waitForFunction(()=>window.__workerDeliveries.length===1&&window.__heartbeats>2);assert.match(await page.locator('#gsmBackgroundPreparation').innerText(),/Подготавливаю расчёт/);assert.equal(await page.locator('.gsm-act-steps').count(),0);assert.equal(await page.locator('[data-writeoff-action="post"]').count(),0);
 await page.evaluate(()=>{window.__holdWorkerLoad=false;window.__workerDeliveries.splice(0).forEach(send=>send());});await page.locator('.gsm-act-steps').waitFor({timeout:30000});
 const state=await page.evaluate(()=>{clearInterval(window.__heartbeat);return{workers:window.__workers,messages:window.__workerMessages,sync:window.__syncFuel,writes:window.__writes,exports:window.__exports,facts:JSON.stringify(Object.fromEntries(['vehicles','records','fuelPurchases','fuelCards','monthlyFuel','fuelPeriods'].map(section=>[section,data[section]]))),before:window.__factsBefore,model:gsmWriteoffModel().totals};});
 assert.ok(state.workers>=1);assert.ok(state.messages.includes('query:fuel'));assert.ok(state.messages.includes('query:writeoff'));assert.deepEqual(state.sync,[]);assert.equal(state.writes,0);assert.deepEqual(state.exports,[]);assert.equal(state.facts,state.before);assert.equal(state.model.spent,20);assert.equal(state.model.end,70);
});

test('changed facts block cached draft export, reconciliation export and posting until a new background calculation',async()=>{
 await openReady();await page.evaluate(()=>{data.records[0].fuelActual=21;gsmExportWriteoffDraft();gsmExportReconciliation();gsmPostWriteoffDialog();});
 assert.equal(await page.locator('#gsmWriteoffPostForm').count(),0);assert.deepEqual(await page.evaluate(()=>window.__exports),[]);assert.equal(await page.evaluate(()=>window.__writes),0);assert.match(await page.locator('#globalToast').innerText(),/источники изменились/);
 await page.evaluate(()=>renderFuelPurchases());await page.locator('.gsm-act-steps').waitFor({timeout:30000});assert.equal(await page.evaluate(()=>gsmWriteoffModel().totals.spent),21);assert.deepEqual(await page.evaluate(()=>window.__syncFuel),[]);
});

for(const [label,mutation]of [['source',()=>{data.records[0].fuelActual=21;}],['filter',()=>{gsmOrg='Another organization';}],['actor',()=>{_sync.access={user:{id:'changed',role:'viewer'},readable:PlatformSchema.sections,writable:[]};}],['date',()=>{gsmActDate='2026-10-01';}],['local day',()=>{dispatcherLocalDate=()=> '2099-01-01';}]])test('late '+label+' preparation response never paints old totals and offers an explicit retry',async()=>{
 await holdPreparation();await page.evaluate(mutation);await release();await page.locator('[data-gsm-background-retry]').waitFor();assert.match(await page.locator('#gsmBackgroundPreparation [role="status"]').innerText(),/изменились/);assert.equal(await page.locator('.gsm-writeoff').count(),0);assert.equal(await page.evaluate(()=>window.__writes),0);
});

test('late replies cannot overwrite another section after navigation',async()=>{
 await holdPreparation();await page.evaluate(()=>switchSection('vehicles'));const before=await page.locator('#mainContent').innerHTML();await release();await page.waitForTimeout(40);assert.equal(await page.locator('#mainContent').innerHTML(),before);assert.equal(await page.locator('.gsm-writeoff').count(),0);
});

test('cancel terminates the real worker and a deliberate retry can prepare a fresh result',async()=>{
 await page.evaluate(()=>{window.__holdWorkerLoad=true;switchSection('fuelPurchases');});await page.waitForFunction(()=>window.__workerDeliveries.length===1);await page.locator('[data-gsm-background-cancel]').click();await page.locator('[data-gsm-background-retry]').waitFor();
 assert.equal(await page.locator('.gsm-writeoff').count(),0);await page.evaluate(()=>{window.__holdWorkerLoad=false;window.__workerDeliveries=[];});await page.locator('[data-gsm-background-retry]').click();await page.locator('.gsm-act-steps').waitFor({timeout:30000});assert.ok(await page.evaluate(()=>window.__workers)>=2);assert.equal(await page.evaluate(()=>window.__writes),0);
});

for(const phase of ['before','after'])test('a '+phase+'-paint failure after background preparation is visible and retryable',async()=>{
 await page.evaluate(phase=>{
  fpView='barrels';const render=gsmRenderWorkspace;window.__originalGsmRender=render;
  gsmRenderWorkspace=function(...args){
   const prepared=!!gsmPreparedWorkspace();
   if(prepared&&phase==='before')throw Error('Synthetic rendering failure');
   const result=render.apply(this,args);
   if(prepared&&phase==='after')throw Error('Synthetic rendering failure');
   return result;
  };
  switchSection('fuelPurchases');
 },phase);
 await page.locator('[data-gsm-background-retry]').waitFor();
 assert.match(await page.locator('#gsmBackgroundPreparation [role="status"]').innerText(),/Synthetic rendering failure/);
 assert.deepEqual(await page.evaluate(()=>({ready:!!gsmBackgroundReady,pending:!!gsmBackgroundRequest,body:!!document.querySelector('#fpBody'),writes:__writes})),{ready:false,pending:false,body:false,writes:0});
 await page.evaluate(()=>{gsmRenderWorkspace=window.__originalGsmRender;});
 await page.locator('[data-gsm-background-retry]').click();await page.locator('#gsmBarrelCards').waitFor();
 assert.deepEqual(await page.evaluate(()=>({ready:!!gsmBackgroundReady,pending:!!gsmBackgroundRequest,writes:__writes})),{ready:true,pending:false,writes:0});
});

test('barrel overview and diagnostics open with fractional historical allocation and negative stock',async()=>{
 await page.evaluate(()=>{
  const vehicle=data.vehicles[0];Object.assign(vehicle,{org:'A',norm:10,fuelBalance:3,fuelBalanceSources:[{org:'A',grade:'ДТ',qty:1},{org:'B',grade:'ДТ',qty:2}]});
  data.records=[{id:'split-history',vehicleId:vehicle.id,date:'2026-08-01',km:1,fuelActual:3},{id:'negative-month',vehicleId:vehicle.id,date:'2026-09-01',km:10000,fuelActual:20},
   ...Array.from({length:1000},(_,index)=>({id:'zero-history-'+index,vehicleId:vehicle.id,date:'2026-09-02',km:0,fuelIssued:0,fuelActual:0,fuelGrade:'ДТ'}))];
  data.fuelPurchases=[];rebuildIndex();dispatcherInvalidate();fpMonth='2026-09';fpView='barrels';window.__historySourceBefore=JSON.stringify(data);
 });
 await page.locator('#unifiedNav [data-section="fuelPurchases"]').click();await page.locator('#gsmBarrelCards').waitFor();
 assert.equal(await page.locator('[data-gsm-background-retry]').count(),0);
 await page.locator('.gsm-nav button').filter({hasText:'Проверка данных'}).click();await page.locator('#gsmDiagnostics').waitFor();
 assert.equal(await page.evaluate(()=>gsmDiagnosticsModel.items.some(item=>item.code==='negative-ending')),true);
 assert.deepEqual(await page.evaluate(()=>({unchanged:JSON.stringify(data)===window.__historySourceBefore,writes:__writes,pending:!!gsmBackgroundRequest})),{unchanged:true,writes:0,pending:false});
});

test('large fuel diagnostics, including negative-stock chronology, are prepared in the real Worker',async()=>{
 await page.evaluate(()=>{data.records[0].fuelActual=100;fpView='diagnostics';gsmAuditModel=()=>{throw Error('Unexpected synchronous audit calculation');};switchSection('fuelPurchases');});
 await page.locator('#gsmDiagnostics').waitFor({timeout:30000});
 assert.ok(await page.evaluate(()=>window.__workerMessages.includes('query:fuelAudit')));assert.ok(await page.evaluate(()=>gsmDiagnosticsModel.items.some(item=>item.code==='negative-ending'&&item.chronology.length>0)));
 assert.deepEqual(await page.evaluate(()=>window.__syncFuel),[]);assert.equal(await page.evaluate(()=>window.__writes),0);
});

test('a late diagnostic model cannot paint causes from a previous source snapshot',async()=>{
 await page.evaluate(()=>{window.__holdAfter=['fuelAudit'];fpView='diagnostics';switchSection('fuelPurchases');});await page.waitForFunction(()=>window.__heldReplies.some(reply=>reply.name==='fuelAudit'));
 await page.evaluate(()=>{data.records[0].fuelActual=100;});await release();await page.locator('[data-gsm-background-retry]').waitFor();assert.equal(await page.locator('#gsmDiagnostics').count(),0);assert.equal(await page.evaluate(()=>window.__writes),0);
});

test('large posting prepares the original document in Worker and duplicate submit persists once',async()=>{
 await openReady();await beginPost();assert.equal(await page.evaluate(()=>window.__writes),0);await page.evaluate(()=>gsmPostWriteoff({preventDefault(){}}));assert.equal(await page.evaluate(()=>window.__queries.filter(name=>name==='writeoffPost').length),1);
 await release();await page.waitForFunction(()=>window.__writes===1&&data.fuelWriteoffs.length===1);assert.equal(await page.evaluate(()=>data.fuelWriteoffs[0].totals.spent),20);assert.equal(await page.evaluate(()=>data.fuelWriteoffs[0].status),'posted');assert.deepEqual(await page.evaluate(()=>window.__syncFuel),[]);
 const unchanged=await page.evaluate(()=>JSON.stringify(Object.fromEntries(['vehicles','records','fuelPurchases','fuelCards','monthlyFuel','fuelPeriods'].map(section=>[section,data[section]])))===window.__factsBefore);assert.equal(unchanged,true);
});

for(const [label,mutation]of [['source',()=>{data.records[0].fuelActual=21;}],['role',()=>{_sync.access={user:{id:'changed',role:'viewer'},readable:PlatformSchema.sections,writable:[]};}],['form date',()=>{document.querySelector('[name="actDate"]').value='2026-10-01';}]])test('a '+label+' change while Worker prepares posting cannot save or print the stale document',async()=>{
 await openReady();await beginPost();await page.evaluate(mutation);await release();await page.waitForFunction(()=>!!document.getElementById('gsmWriteoffPostError')?.textContent);assert.equal(await page.evaluate(()=>window.__writes),0);assert.deepEqual(await page.evaluate(()=>data.fuelWriteoffs),[]);assert.deepEqual(await page.evaluate(()=>window.__exports),[]);assert.match(await page.locator('#gsmWriteoffPostError').innerText(),/изменились/);
});
