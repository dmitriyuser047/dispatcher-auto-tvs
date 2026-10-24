'use strict';
// Browser-only synthetic snapshots. This fixture never opens a profile or a DB.
const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {createRequire}=require('node:module');
const snapshots=require('./helpers/ui-snapshot-fixture.cjs');
let pw;try{pw=require('playwright');}catch{pw=createRequire(path.join(process.env.TVS_PLAYWRIGHT_MODULES||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),'package.json'))('playwright');}
const root=path.resolve(__dirname,'..'),alpha='Synthetic Alpha',beta='Synthetic Beta';
let browser,server,origin,page,errors;
function fixture(){
 const vehicle=(id,plate,org,grade,balance,extra={})=>({id,plate,make:'Synthetic',org,fuel:grade==='ДТ'?'diesel':'gasoline',fuelGrade:grade,fuelBalance:balance,fuelBalanceSources:[{org,grade,qty:balance}],...extra});
 const record=(id,vehicleId,actual,km,extra={})=>({id,vehicleId,date:'2026-09-10',fuelActual:actual,km,...extra});
 return {
  vehicles:[vehicle(0,'SYNTHETIC NUMBER ZERO',alpha,'ДТ',50,{norm:10}),vehicle('0','SYNTHETIC STRING ZERO',beta,'АИ-92',30,{norm:8}),vehicle(7,'SYNTHETIC NUMBER SEVEN',alpha,'ДТ',10,{norm:10}),vehicle('7','SYNTHETIC STRING SEVEN',alpha,'ДТ',20,{norm:10}),vehicle('unknown','SYNTHETIC UNKNOWN',alpha,'ДТ',12),vehicle('negative','SYNTHETIC NEGATIVE',alpha,'ДТ',2,{norm:10})],
  records:[record('number-zero',0,20,100,{fuelIssued:10,fuelOrg:alpha,fuelGrade:'ДТ'}),record('string-zero','0',5,50,{fuelGrade:'АИ-92'}),record('number-seven',7,0,0,{fuelGrade:'ДТ'}),record('string-seven','7',1,10,{fuelGrade:'ДТ'}),record('unknown-consumption','unknown',null,20,{fuelGrade:'ДТ'}),record('negative-ending','negative',5,10,{fuelGrade:'ДТ'}),record('october-number',0,2,20,{date:'2026-10-10',fuelGrade:'ДТ'}),record('october-string','0',3,30,{date:'2026-10-10',fuelGrade:'АИ-92'})],
  tanks:[{id:0,name:'SYNTHETIC PHYSICAL TANK',fuel:'diesel',fuelGrade:'ДТ',balanceInit:300,capacity:1000}],
  fuelCards:[{id:'fc_cash',number:'НАЛИЧКА',provider:'Наличка',org:'',status:'active',assignments:[],limit:null,note:'Synthetic cash source'}],
  fuelPurchases:[],monthlyFuel:[],fuelWriteoffs:[],fuelPeriods:[],appMeta:[{id:'meta',toPlanInit:'synthetic'}]
 };
}
before(async()=>{
 server=http.createServer((req,res)=>{const file=require('../electron/security').staticFile(root,req.url);if(!file||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');fs.createReadStream(file).pipe(res);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';browser=await pw.chromium.launch({headless:true,executablePath:process.env.TVS_TEST_BROWSER||(!process.env.CI&&fs.existsSync(edge)?edge:undefined)});
});
after(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));});
beforeEach(async()=>{
 page=await browser.newPage({viewport:{width:1440,height:1000}});errors=[];page.on('pageerror',error=>errors.push(error.message));
 await snapshots.install(page,{database:fixture(),token:'synthetic-gsm-workspace-v2',countWrites:true,rejectWrites:true},()=>{
  window.__commandWrites=0;window.__workerCount=0;window.__exports=[];
  window.electronAPI.executeCommand=async()=>{window.__commandWrites++;return{ok:false,code:'SYNTHETIC_WRITE_FORBIDDEN',error:'This read-only UI fixture must never persist'};};
  const NativeWorker=window.Worker;window.Worker=class extends NativeWorker{constructor(...args){super(...args);window.__workerCount++;}};
 });
 await page.goto(origin+'/index.html');await page.waitForFunction(()=>typeof data!=='undefined'&&data.vehicles[0]?.id===0);
 await page.evaluate(()=>{window.__factsBefore=JSON.stringify(data);window.__diskBefore=window.__disk;fpMonth='2026-09';gsmOrg='';gsmFuel='';gsmActNo='SYNTHETIC-2026-09';gsmActDate='2026-09-30';XLSX.writeFile=(_book,name)=>window.__exports.push(name);});
 await page.locator('#unifiedNav [data-section="fuelPurchases"]').click();await page.locator('[data-gsm-workspace] [data-gsm-statement]').waitFor();
});
afterEach(async()=>{await page?.close();assert.deepEqual(errors,[]);});
const workspace=()=>page.locator('[data-gsm-workspace]');
const rowFor=id=>page.locator('[data-gsm-vehicle-ref='+JSON.stringify(JSON.stringify(['vehicles',typeof id,id]))+']');
async function view(name){await workspace().locator('[data-gsm-view="'+name+'"]').click();await page.waitForFunction(name=>fpView===name,name);await workspace().waitFor();}
async function step(index){await page.locator('[data-gsm-act-step="'+index+'"]').click();await page.waitForFunction(index=>document.querySelector('[data-gsm-act-step="'+index+'"]')?.getAttribute('aria-current')==='step',index);}
async function filters({month,org,grade}){if(month!==undefined)await workspace().getByRole('combobox',{name:'Месяц',exact:true}).selectOption(month);if(org!==undefined)await workspace().getByRole('combobox',{name:'Организация',exact:true}).selectOption(org);if(grade!==undefined)await workspace().getByRole('combobox',{name:'Топливо',exact:true}).selectOption(grade);}
async function assertReadOnly(){
 assert.deepEqual(await page.evaluate(()=>({writes:window.__writes,commands:window.__commandWrites,exports:window.__exports,sourceUnchanged:JSON.stringify(data)===window.__factsBefore,diskUnchanged:window.__disk===window.__diskBefore})),{writes:0,commands:0,exports:[],sourceUnchanged:true,diskUnchanged:true});
}

test('GSM opens the vehicle statement by default and exposes five distinct main routes',async()=>{
 assert.equal(await page.evaluate(()=>fpView),'statement');
 assert.deepEqual(await workspace().locator('.gsm-nav [data-gsm-view]').evaluateAll(nodes=>nodes.map(node=>node.dataset.gsmView)),['statement','operations','tanks','diagnostics','writeoff']);
 assert.equal(await page.locator('#gsmBarrelCards').count(),0);assert.equal(await page.locator('[data-gsm-statement] [data-gsm-vehicle-ref]').count(),6);
 assert.equal(await workspace().getByRole('button',{name:'Добавить вручную',exact:true}).count(),1);await assertReadOnly();
});

test('selecting and rerendering statement rows retains numeric and string zero and seven separately',async()=>{
 for(const [id,plate,formula]of [[0,'SYNTHETIC NUMBER ZERO','50 л + 10 л − 20 л + (0 л) = 40 л'],['0','SYNTHETIC STRING ZERO','30 л + 0 л − 5 л + (0 л) = 25 л'],[7,'SYNTHETIC NUMBER SEVEN','10 л + 0 л − 0 л + (0 л) = 10 л'],['7','SYNTHETIC STRING SEVEN','20 л + 0 л − 1 л + (0 л) = 19 л']]){
  const row=rowFor(id);assert.equal(await row.count(),1);await row.locator('[data-gsm-statement-select]').click();
  const token=await row.getAttribute('data-gsm-statement-token');assert.ok(token);await page.evaluate(()=>renderFuelPurchases());
  const detail=page.locator('[data-gsm-statement-detail]');await detail.waitFor();assert.equal(await detail.getAttribute('data-gsm-statement-detail'),token);assert.deepEqual(JSON.parse(token).slice(0,2),[typeof id,id]);assert.equal(await rowFor(id).getAttribute('data-gsm-statement-token'),token);assert.equal(await rowFor(id).locator('[data-gsm-statement-select]').getAttribute('aria-expanded'),'true');assert.match(await rowFor(id).innerText(),new RegExp(plate));assert.equal((await detail.locator('.gsm-statement-formula').innerText()).trim(),formula);
  await detail.getByRole('button',{name:'Карточка машины',exact:true}).click();await page.waitForFunction(id=>selectedVehicleId===id,id);assert.equal(await page.evaluate(()=>typeof selectedVehicleId),typeof id);assert.match(await page.locator('#mainContent').innerText(),new RegExp(plate));await page.locator('#unifiedNav [data-section="fuelPurchases"]').click();await page.locator('[data-gsm-statement]').waitFor();
 }
 await assertReadOnly();
});

test('missing consumption remains unknown, explicit zero remains known and negative stock stays negative',async()=>{
 const unknown=rowFor('unknown');for(const field of ['spent','end']){const cell=unknown.locator('[data-gsm-value="'+field+'"]');assert.equal(await cell.getAttribute('data-status'),'unknown');assert.match(await cell.innerText(),/неизвест|не определ|сверк|—/i);assert.doesNotMatch((await cell.innerText()).trim(),/^0(?:[,.]0+)?(?:\s*л)?$/);}
 const zero=rowFor(7).locator('[data-gsm-value="spent"]');assert.equal(await zero.getAttribute('data-status'),'known');assert.match((await zero.innerText()).trim(),/^0(?:[,.]0+)?(?:\s*л)?$/);
 const negative=rowFor('negative').locator('[data-gsm-value="end"]');assert.equal(await negative.getAttribute('data-status'),'negative');assert.match(await negative.innerText(),/[−-]\s*3(?:[,.]0+)?/);await assertReadOnly();
});

test('month organization and grade are shared between the statement, operations and act steps',async()=>{
 await filters({month:'2026-10',org:beta,grade:'АИ-92'});assert.equal(await page.locator('[data-gsm-statement] [data-gsm-vehicle-ref]').count(),1);assert.equal(await rowFor('0').count(),1);assert.equal(await rowFor(0).count(),0);
 assert.match(await rowFor('0').locator('[data-gsm-value="opening"]').innerText(),/25/);assert.match(await rowFor('0').locator('[data-gsm-value="spent"]').innerText(),/3/);assert.match(await rowFor('0').locator('[data-gsm-value="end"]').innerText(),/22/);
 for(const name of ['operations','writeoff','statement']){
  await view(name);assert.equal(await workspace().getByRole('combobox',{name:'Месяц',exact:true}).inputValue(),'2026-10');assert.equal(await workspace().getByRole('combobox',{name:'Организация',exact:true}).inputValue(),beta);assert.equal(await workspace().getByRole('combobox',{name:'Топливо',exact:true}).inputValue(),'АИ-92');
  if(name==='writeoff'){await step(2);assert.equal(await page.locator('[data-gsm-act-stage="measurements"] [data-gsm-statement] [data-gsm-vehicle-ref]').count(),1);assert.equal(await rowFor('0').count(),1);}
 }
 await assertReadOnly();
});

test('all five act stages are read-only and the final document retains existing source-error controls',async()=>{
 await view('writeoff');for(const [index,stage]of ['opening','receipts','measurements','checks','document'].entries()){
  await step(index);assert.equal(await page.locator('[data-gsm-act-stage]').getAttribute('data-gsm-act-stage'),stage);
  if(stage==='opening'||stage==='measurements')assert.equal(await page.locator('[data-gsm-act-stage="'+stage+'"] [data-gsm-statement]').count(),1);
  if(stage==='checks'){assert.ok(Number(await page.locator('[data-gsm-act-issue-count="error"]').innerText())>0);assert.equal(await page.locator('[data-gsm-act-issues="error"]').count(),1);}
  await assertReadOnly();
 }
 assert.equal(await page.locator('.gsm-writeoff').count(),1);assert.equal(await page.locator('[data-writeoff-action="post"]').isDisabled(),true);
 await page.evaluate(()=>gsmPostWriteoffDialog());assert.equal(await page.locator('#gsmWriteoffPostForm').count(),0);assert.match(await page.locator('#globalToast').innerText(),/заблокировано|ошиб/i);await assertReadOnly();
});

test('a clean final act remains disabled for a reader and a direct posting call cannot bypass that role',async()=>{
 await filters({org:beta,grade:'АИ-92'});await view('writeoff');await step(4);assert.equal(await page.evaluate(()=>gsmWriteoffModel().canPost),true);assert.equal(await page.locator('[data-writeoff-action="post"]').isDisabled(),false);
 await page.evaluate(()=>{_sync.access={user:{id:'synthetic-reader',name:'Synthetic reader',role:'viewer'},readable:PlatformSchema.sections.slice(),writable:[]};renderFuelPurchases();});await step(4);
 assert.equal(await page.locator('[data-writeoff-action="post"]').isDisabled(),true);assert.match(await page.locator('.gsm-writeoff').innerText(),/недоступно|прав доступа/i);await page.evaluate(()=>gsmPostWriteoffDialog());assert.equal(await page.locator('#gsmWriteoffPostForm').count(),0);await assertReadOnly();
});

test('physical tanks have a separate GSM route and open the actual typed tank without creating an accounting bucket',async()=>{
 assert.equal(await page.locator('[data-gsm-statement]').innerText().then(text=>text.includes('SYNTHETIC PHYSICAL TANK')),false);await view('tanks');assert.equal(await page.locator('[data-gsm-statement]').count(),0);
 const tank=page.locator('[data-gsm-tank-index="0"]');assert.equal(await tank.count(),1);assert.match(await workspace().innerText(),/SYNTHETIC PHYSICAL TANK/);assert.match(await workspace().innerText(),/300/);await tank.click();
 await page.waitForFunction(()=>selectedTankId===0);assert.notEqual(await page.evaluate(()=>activeSection),'fuelPurchases');assert.match(await page.locator('#mainContent').innerText(),/SYNTHETIC PHYSICAL TANK/);await assertReadOnly();
});

test('the explicit manual action opens only an unsaved local entry form',async()=>{
 await workspace().getByRole('button',{name:'Добавить вручную',exact:true}).click();await page.waitForFunction(()=>fpView==='manual');assert.equal(await page.locator('[data-gsm-statement]').count(),0);await assertReadOnly();
});

test('the new statement consumes a real background result without merging typed rows or modifying facts',async()=>{
 await page.evaluate(()=>{data.records.push(...Array.from({length:1000},(_,index)=>({id:'background-zero-'+index,vehicleId:7,date:'2026-09-02',km:0,fuelIssued:0,fuelActual:0,fuelGrade:'ДТ'})));rebuildIndex();dispatcherInvalidate();window.__factsBefore=JSON.stringify(data);renderFuelPurchases();});
 await page.locator('[data-gsm-workspace] [data-gsm-statement]').waitFor({timeout:30000});assert.ok(await page.evaluate(()=>window.__workerCount)>0);assert.equal(await rowFor(0).count(),1);assert.equal(await rowFor('0').count(),1);
 await rowFor('0').locator('[data-gsm-statement-select]').click();const detail=page.locator('[data-gsm-statement-detail]'),token=await rowFor('0').getAttribute('data-gsm-statement-token');assert.equal(await detail.getAttribute('data-gsm-statement-detail'),token);assert.deepEqual(JSON.parse(token).slice(0,2),['string','0']);assert.equal((await detail.locator('.gsm-statement-formula').innerText()).trim(),'30 л + 0 л − 5 л + (0 л) = 25 л');assert.equal(await rowFor(0).locator('[data-gsm-statement-select]').getAttribute('aria-expanded'),'false');await assertReadOnly();
});
