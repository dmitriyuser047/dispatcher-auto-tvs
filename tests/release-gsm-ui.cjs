'use strict';
const {test,before,after,beforeEach,afterEach}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),{createRequire}=require('node:module');
const snapshots=require('./helpers/ui-snapshot-fixture.cjs');
let pw;try{pw=require('playwright');}catch{pw=createRequire(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/package.json'))('playwright');}
const root=path.resolve(__dirname,'..');let browser,server,origin,page,errors;
function database(){return {vehicles:[{id:0,plate:'SYNTHETIC ZERO',org:'A',fuel:'diesel',fuelGrade:'ДТ',fuelBalance:30,norm:10}],records:[{id:'r',vehicleId:0,date:'2026-09-10',km:10,fuelActual:1}],tanks:[{id:0,name:'SYNTHETIC TANK A',org:'A',location:'Synthetic yard',fuel:'diesel',fuelGrade:'ДТ',balanceInit:20,capacity:100}],tankIncomes:[{id:'in',tankId:0,date:'2026-09-01',amount:5,source:'SYNTHETIC HIDDEN RECEIPT DETAIL'}],fuelPurchases:[],appMeta:[{id:'meta',toPlanInit:'synthetic'}]};}
before(async()=>{
 server=http.createServer((request,response)=>{const filename=require('../electron/security').staticFile(root,request.url);if(!filename||!fs.existsSync(filename)||!fs.statSync(filename).isFile()){response.writeHead(404).end();return;}response.setHeader('Content-Type',filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':filename.endsWith('.html')?'text/html':'application/octet-stream');fs.createReadStream(filename).pipe(response);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';browser=await pw.chromium.launch({headless:true,executablePath:process.env.TVS_TEST_BROWSER||(!process.env.CI&&fs.existsSync(edge)?edge:undefined)});
});
after(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));});
beforeEach(async()=>{
 page=await browser.newPage({viewport:{width:1280,height:900}});errors=[];page.on('pageerror',error=>errors.push(error.message));
 await snapshots.install(page,{database:database(),token:'synthetic-release-gsm-ui',countWrites:true,rejectWrites:true},()=>{window.__commands=0;electronAPI.executeCommand=async()=>{__commands++;return {ok:false};};});
 await page.goto(origin+'/index.html');await page.waitForFunction(()=>typeof data!=='undefined'&&data.vehicles[0]?.id===0);
 await page.evaluate(()=>{fpMonth='2026-09';gsmOrg='';gsmFuel='';gsmActDate='2026-09-30';window.__baseline=JSON.stringify(data);window.__diskBaseline=window.__disk;});
 await page.locator('#unifiedNav [data-section="fuelPurchases"]').click();await page.locator('[data-gsm-statement]').waitFor();
});
afterEach(async()=>{await page.close();assert.deepEqual(errors,[]);});
async function view(name){await page.locator('[data-gsm-view="'+name+'"]').click();await page.waitForFunction(name=>fpView===name,name);}
async function unchanged(){assert.deepEqual(await page.evaluate(()=>({source:JSON.stringify(data)===__baseline,disk:__disk===__diskBaseline,writes:__writes,commands:__commands})),{source:true,disk:true,writes:0,commands:0});}

test('an old physical-tank card cannot reveal a hidden history after a same-object scoped session change',async()=>{
 await view('tanks');await page.locator('[data-gsm-tank-index="0"]').waitFor();
 assert.equal((await page.locator('#mainContent').innerText()).includes('SYNTHETIC HIDDEN RECEIPT DETAIL'),false);
 await page.evaluate(()=>{_sync.access={user:{id:'new-scoped-user',name:'Synthetic scoped reader',role:'viewer'},readable:PlatformSchema.sections,writable:[],policyStamp:'sha256:'+'c'.repeat(64),accessPolicy:{version:1,grants:[{org:'B'}]}};});
 await page.locator('[data-gsm-tank-index="0"]').click();
 assert.deepEqual(await page.evaluate(()=>({section:activeSection,hiddenHistory:document.getElementById('mainContent').innerText.includes('SYNTHETIC HIDDEN RECEIPT DETAIL')})),{section:'fuelPurchases',hiddenHistory:false},'the old tank context must be refused until the new session reloads its allowed data');
 await unchanged();
});

test('physical-tank source actions refuse the actual profile-switch handler while its next snapshot is pending',async()=>{
 await view('tanks');await page.locator('[data-gsm-tank-index="0"]').waitFor();
 await page.evaluate(()=>{
  _appSettings={activeUser:0,networkMode:'client',users:[{name:'Synthetic A',dataDir:'synthetic-a'},{name:'Synthetic B',dataDir:'synthetic-b'}]};
  electronAPI.switchUser=async()=>true;electronAPI.readSnapshot=()=>new Promise(resolve=>{window.__profileSnapshotPending=true;window.__profileSnapshotResolve=resolve;});
  window.__profileSwitch=settingsSwitchUser(1);
 });
 await page.waitForFunction(()=>_appSettings.activeUser===1&&window.__profileSnapshotPending===true);
 await page.locator('[data-gsm-tank-index="0"]').click();
 assert.deepEqual(await page.evaluate(()=>({section:activeSection,hiddenHistory:document.getElementById('mainContent').innerText.includes('SYNTHETIC HIDDEN RECEIPT DETAIL')})),{section:'fuelPurchases',hiddenHistory:false});
 await unchanged();
});

test('statement source links refuse a same-object session change without opening old source forms',async()=>{
 await page.locator('[data-gsm-statement-select]').click();const token=await page.locator('[data-gsm-statement-detail]').getAttribute('data-gsm-statement-detail');assert.ok(token);
 await page.evaluate(()=>{_sync.access={user:{id:'changed',role:'viewer'},readable:PlatformSchema.sections,writable:[],policyStamp:'changed'};});
 await page.locator('[data-gsm-statement-source="vehicle"]').click();assert.equal(await page.evaluate(()=>activeSection),'fuelPurchases');await unchanged();
});

test('physical tank cards retain numeric zero and string zero as separate destinations',async()=>{
 await page.evaluate(()=>{data.tanks[0].name='SYNTHETIC NUMBER TANK';data.tanks.push({id:'0',name:'SYNTHETIC STRING TANK',org:'A',fuel:'diesel',fuelGrade:'ДТ',balanceInit:10});__baseline=JSON.stringify(data);dispatcherInvalidate();});
 for(const [index,id,label]of [[0,0,'SYNTHETIC NUMBER TANK'],[1,'0','SYNTHETIC STRING TANK']]){
  await view('tanks');await page.locator('[data-gsm-tank-index="'+index+'"]').click();
  assert.equal(await page.evaluate(()=>selectedTankId),id);assert.equal(await page.evaluate(()=>typeof selectedTankId),typeof id);assert.match(await page.locator('#mainContent').innerText(),new RegExp(label));
  await page.locator('#unifiedNav [data-section="fuelPurchases"]').click();await page.locator('[data-gsm-workspace]').waitFor();
 }
 await unchanged();
});

test('new GSM views and details render hostile source literals as text without executable attributes',async()=>{
 await page.evaluate(()=>{const literal='SYNTHETIC <img src=x onerror="window.__injected=1">';data.vehicles[0].plate=literal;data.tanks[0].name=literal;data.tanks[0].location=literal;data.records[0].note=literal;window.__baseline=JSON.stringify(data);dispatcherInvalidate();renderFuelPurchases();});
 await page.locator('[data-gsm-statement-select]').click();
 for(const name of ['statement','operations','tanks','diagnostics','writeoff']){await view(name);if(name==='writeoff')for(const index of [0,1,2,3,4]){await page.locator('[data-gsm-act-step="'+index+'"]').click();await page.locator('[data-gsm-act-panel="'+index+'"]').waitFor();}assert.equal(await page.locator('#mainContent [onerror],#mainContent img[src=x]').count(),0);assert.equal(await page.evaluate(()=>window.__injected||0),0);}
 await unchanged();
});

test('both themes keep new GSM routes and a ready large statement usable at supported widths without synchronous ledger rebuilding',async()=>{
 for(const width of [960,1280])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:900});await page.evaluate(theme=>applyTheme(theme),theme);
  for(const name of ['statement','operations','tanks','writeoff']){await view(name);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await page.locator('[data-gsm-view="'+name+'"]').isVisible(),true);if(name==='writeoff'){for(const index of [0,2,3,4]){await page.locator('[data-gsm-act-step="'+index+'"]').click();await page.locator('[data-gsm-act-panel="'+index+'"]').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}}}
 }
 await page.evaluate(()=>{data.records.push(...Array.from({length:1000},(_,index)=>({id:'filler-'+index,vehicleId:0,date:'2026-09-01',km:0,fuelActual:0})));window.__baseline=JSON.stringify(data);dispatcherInvalidate();gsmSwitchView('statement');});
 await page.locator('[data-gsm-statement]').waitFor();
 await page.evaluate(()=>{gsmBuildLedger=()=>{throw Error('Unexpected synchronous ledger rebuild');};gsmAuditModel=()=>{throw Error('Unexpected synchronous audit rebuild');};});
 await page.locator('[data-gsm-statement-select]').click();await page.locator('[data-gsm-statement-detail]').waitFor();await unchanged();
});

test('statement rejects hexadecimal and boolean openings and measurements while preserving explicit zero and decimal evidence',async()=>{
 const result=await page.evaluate(()=>{
  const cases=[['hex','0x10'],['boolean',true],['zero',0],['decimal','0.125']];
  data.vehicles=cases.map(([id,value])=>({id,plate:'SYNTHETIC '+id,org:'A',fuel:'diesel',fuelGrade:'ДТ',fuelBalance:value,norm:0}));
  data.records=cases.map(([id,value])=>({id:'record-'+id,vehicleId:id,date:'2026-09-30',km:0,fuelActual:0,tankMeasured:value}));
  __baseline=JSON.stringify(data);dispatcherInvalidate();
  const ledger=TvsFuelEngine.buildLedger(data,{from:'2026-09-01',to:'2026-09-30'});
  document.getElementById('mainContent').innerHTML=gsmVehicleStatementHtml(ledger,{stage:'measurements'});
  const values=cases.map(([id])=>{
   const model=gsmStatementContext.rows.find(model=>model.row.vehicleId===id),token=JSON.stringify(['vehicles','string',id]);
   const row=[...document.querySelectorAll('[data-gsm-vehicle-ref]')].find(row=>row.getAttribute('data-gsm-vehicle-ref')===token),cell=row.querySelector('[data-gsm-value="measured"]');
   return {id,engine:TvsFuelEngine.openingEvidence(data,id,{before:ledger.from,family:'diesel'}).status,openingReason:model.reasons.opening||null,measuredStatus:cell.dataset.status,measured:cell.textContent.trim()};
  });
  return {values,numbers:['0x10',true,false,0,'0','0.125'].map(value=>gsmStatementNumber(value))};
 });
 assert.deepEqual(result.numbers,[null,null,null,0,0,.125]);
 for(const row of result.values){if(['hex','boolean'].includes(row.id)){assert.equal(row.engine,'missing');assert.match(row.openingReason,/исходный остаток|начало учёта/);assert.equal(row.measuredStatus,'unknown');assert.equal(row.measured,'Некорректный замер');}else{assert.equal(row.engine,'known');assert.equal(row.openingReason,null);assert.equal(row.measuredStatus,'known');assert.equal(row.measured,row.id==='zero'?'0':'0,125');}}
 await unchanged();
});
