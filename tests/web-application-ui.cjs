'use strict';
// Real web documents, transport and typed application bundle, backed exclusively
// by synthetic in-memory rows. No database/profile is opened by this fixture.
const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),{createRequire}=require('node:module');
let pw;try{pw=require('playwright');}catch{pw=createRequire(path.join(process.env.TVS_PLAYWRIGHT_MODULES||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),'package.json'))('playwright');}
const root=path.resolve(__dirname,'..'),schema=require('../assets/core/platform-schema.js'),format=require('../electron/storage-format.cjs'),compatibility=require('../assets/core/platform-compatibility.js');
const {renderDocument,resolveRoute}=require('../web/pages.cjs'),{publicAccess}=require('../web/workspace.cjs'),{prepareTransaction}=require('../electron/platform-service.cjs');
const clone=value=>JSON.parse(JSON.stringify(value));
let server,origin,browser,page,state,errors;
function fresh(){
 const database=Object.fromEntries(schema.sections.map(name=>[name,[]]));
 database.generators=[{id:0,name:'SYNTHETIC NUMBER DES',org:'Synthetic org',site:'North',maintenanceRules:[{id:0,label:'Oil',work:'Synthetic oil change',hours:300,months:null,enabled:true}]},{id:'0',name:'SYNTHETIC TEXT DES',org:'Synthetic org',site:'South',maintenanceRules:[]}];
 database.auditLog=[{id:'synthetic-history-prefix',action:'Synthetic retained event',entity:'generators',entityId:'0',date:'2026-10-31'}];
 database.drivers=[{id:0,name:'SYNTHETIC NUMBER DRIVER',personnelRoles:['driver'],org:'Synthetic org',custom:{keep:923.537}},{id:'0',name:'SYNTHETIC TEXT DRIVER',personnelRoles:['driver']}];
 database.appMeta=[{id:'meta',toPlanInit:'synthetic'}];
 return {database,revisions:Object.fromEntries(schema.sections.map(name=>[name,1])),principal:{id:'synthetic-admin',name:'Synthetic administrator',role:'admin'},token:'synthetic-web-application',writes:[],hydrations:0,holdHydration:false,holdWrite:false};
}
function snapshot(names=schema.sections,hello){
 const descriptor=format.describe(format.SCHEMA_VERSION),serverProfile=compatibility.describe().serverProfile;
 const negotiation=compatibility.negotiate(hello,serverProfile,descriptor),access=publicAccess(state.principal);
 const data=Object.fromEntries(schema.sections.map(name=>[name,names.includes(name)?clone(state.database[name]):[]]));
 return {data,loadedSections:names,revisions:{...state.revisions},databaseToken:state.token,access,readOnly:!negotiation.writeCompatible,platform:{apiVersion:1,storageKind:'sqlite',schemaVersion:format.SCHEMA_VERSION,descriptor,compatibility:serverProfile,negotiation,operations:1,calendar:1,commands:1,outbox:1}};
}
const json=(response,value,status=200)=>{response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify(value));};
before(async()=>{
 server=http.createServer(async(request,response)=>{try{
  const url=new URL(request.url,'http://127.0.0.1');
  if(url.pathname.startsWith('/web-api/')){
   const route=url.pathname.slice('/web-api/'.length),hello=url.searchParams.has('hello')?JSON.parse(url.searchParams.get('hello')):compatibility.describe().hello;
   if(route==='bootstrap'){json(response,{ok:true,csrf:'synthetic-csrf',version:'3.5.23',settings:{networkMode:'client',activeUser:0,users:[{name:'Synthetic profile'}]}});return;}
   if(route==='ping'){json(response,{ok:true,...snapshot(schema.sections,hello),version:'3.5.23'});return;}
   if(route==='workspace'||route==='snapshot'){
    const requested=url.searchParams.has('sections')?JSON.parse(url.searchParams.get('sections')):null,names=requested||(route==='workspace'?schema.sections.filter(name=>name!=='auditLog'):schema.sections);
    if(requested){state.hydrations++;if(state.holdHydration)await new Promise(resolve=>{state.releaseHydration=resolve;});}json(response,snapshot(names,hello));return;
   }
   if(route==='pending-operations'){json(response,{ok:true,operations:[]});return;}
   if(route==='revisions'){json(response,{...state.revisions,databaseToken:state.token});return;}
   if(route==='sections'){
    let raw='';for await(const chunk of request)raw+=chunk;const input=JSON.parse(raw);state.writes.push(input);if(state.holdWrite)await new Promise(resolve=>{state.releaseWrite=resolve;});
    const prepared=prepareTransaction(state.database,input.sections,{principal:state.principal,now:'2026-11-01T09:00:00.000Z',operation:input.operation,base:input.base,revisions:state.revisions,databaseToken:state.token});
    for(const[name,rows]of Object.entries(prepared.sections)){state.database[name]=clone(rows);state.revisions[name]++;}json(response,{ok:true,databaseToken:state.token,revisions:{...state.revisions},canonicalSections:prepared.sections,operationReceipt:prepared.operationReceipt});return;
   }
   json(response,{ok:false,error:'Unexpected synthetic gateway route: '+route},404);return;
  }
  if(resolveRoute(request.url)){const html=renderDocument({url:request.url,csrf:'synthetic-csrf',user:state.principal,principal:state.principal});response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});response.end(html);return;}
  let file=require('../electron/security').staticFile(root,url.pathname);
  if(url.pathname.startsWith('/web/public/')){const candidate=path.resolve(root,'.'+decodeURIComponent(url.pathname)),relative=path.relative(path.join(root,'web','public'),candidate);if(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative))file=candidate;}
  if(!file||!fs.existsSync(file)||!fs.statSync(file).isFile()){response.writeHead(404).end();return;}
  response.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');fs.createReadStream(file).pipe(response);
 }catch(error){json(response,{ok:false,error:error.message,code:error.code},500);}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';browser=await pw.chromium.launch({headless:true,executablePath:process.env.TVS_TEST_BROWSER||(!process.env.CI&&fs.existsSync(edge)?edge:undefined)});
});
after(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));});
beforeEach(async()=>{state=fresh();errors=[];page=await browser.newPage({viewport:{width:1280,height:950}});page.on('pageerror',error=>errors.push(error.message));await page.goto(origin+'/maintenance');await page.waitForFunction(()=>typeof platformApplication==='function'&&typeof toOpenRules==='function'&&_sync.enabled&&_appSettings?.networkMode==='client'&&data.generators.length===2,{},{timeout:8000});});
afterEach(async()=>{state.releaseHydration?.();state.releaseWrite?.();await page?.close();assert.deepEqual(errors,[]);});
async function ruleEditor(){await page.evaluate(()=>generatorMaintenanceSetupOpen({generatorId:0}));await page.locator('[data-gm-setup-edit="0"]').click();const form=page.locator('#toRulesEditor');await form.waitFor();await form.locator('.to-rule-meter').fill('350,5');return form;}
async function until(predicate){for(let count=0;count<200;count++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Synthetic gateway event was not reached');}

test('web application hydrates deferred history before a typed DES edit and installs the card only after its canonical ACK',async()=>{
 assert.equal(await page.evaluate(()=>syncSectionLoaded('auditLog')),false);const form=await ruleEditor(),history=clone(state.database.auditLog);state.holdWrite=true;
 await form.locator('[data-to-rules-save]').click();await until(()=>typeof state.releaseWrite==='function');assert.equal(state.hydrations,1);assert.equal(state.writes.length,1);assert.equal(await page.evaluate(()=>data.generators[0].maintenanceRules[0].hours),300);assert.equal(await form.locator('[data-to-rules-save]').isDisabled(),true);assert.deepEqual(state.writes[0].sections.auditLog.slice(0,history.length),history);
 state.holdWrite=false;state.releaseWrite();await page.waitForFunction(()=>!toRulesSession?.pending);assert.equal(await page.locator('#genericModal.open').count(),0);assert.equal(state.database.generators[0].maintenanceRules[0].hours,350.5);assert.equal(state.database.generators[1].id,'0');assert.deepEqual(state.database.auditLog.slice(0,history.length),history);assert.deepEqual(await page.evaluate(()=>data.auditLog),state.database.auditLog);assert.equal(await page.evaluate(()=>data.generators[0].maintenanceRules[0].hours),350.5);
});

test('web application rejects rights changed during deferred hydration without submitting a card write or dropping form fields',async()=>{
 const form=await ruleEditor();state.holdHydration=true;await form.locator('[data-to-rules-save]').click();await until(()=>typeof state.releaseHydration==='function');state.principal={id:'synthetic-admin',name:'Synthetic revoked administrator',role:'viewer'};state.holdHydration=false;state.releaseHydration();await page.waitForFunction(()=>!toRulesSession?.pending);
 assert.equal(state.writes.length,0);assert.equal(state.database.generators[0].maintenanceRules[0].hours,300);assert.equal(await page.evaluate(()=>data.generators[0].maintenanceRules[0].hours),300);assert.equal(await form.locator('.to-rule-meter').inputValue(),'350,5');assert.equal(await form.locator('[data-to-rules-save]').isEnabled(),true);assert.match(await form.locator('[data-to-rules-error]').innerText(),/не подтверждено|Права изменились/);assert.equal(await page.evaluate(()=>syncSectionLoaded('auditLog')),false);
});

test('web driver per diem uses the shared typed command and survives a canonical ACK and a fresh direct-card load',async()=>{
 await page.goto(origin+'/people/drivers?person=0');await page.locator('[data-dp-new]').waitFor();await page.locator('[data-dp-new]').click();const form=page.locator('#driverPerDiemForm');await form.waitFor();
 await form.locator('[name=from]').fill('2026-11-01');await form.locator('[name=to]').fill('2026-11-03');await form.locator('[name=dailyRate]').fill('700');await form.locator('[name=advance]').fill('1000');await form.locator('[name=defaultUnits]').selectOption('1');await form.locator('[name=destination]').fill('SYNTHETIC WORKSITE');await form.locator('[name=basis]').fill('SYNTHETIC ORDER 1');await form.locator('[data-dp-build]').click();await form.locator('[data-dp-day="2026-11-02"] [data-dp-units]').fill('0,5');await form.locator('[data-dp-day="2026-11-02"] [data-dp-reason]').fill('Synthetic organisation half-day rule');
 state.holdWrite=true;await form.locator('[type=submit]').click();await until(()=>typeof state.releaseWrite==='function');assert.equal(state.writes.length,1);assert.equal(await page.evaluate(()=>data.drivers.find(row=>row.id===0).perDiem),undefined);assert.equal(await form.locator('[name=dailyRate]').isDisabled(),true);
 state.holdWrite=false;state.releaseWrite();await page.waitForFunction(()=>!document.getElementById('wfModal').classList.contains('open'));const driver=state.database.drivers.find(row=>row.id===0),other=state.database.drivers.find(row=>row.id==='0');assert.equal(driver.custom.keep,923.537);assert.equal(driver.perDiem.trips[0].days[0].units,'0.5');assert.equal(other.perDiem,undefined);
 assert.deepEqual(await page.evaluate(()=>{const driver=data.drivers.find(row=>row.id===0),result=DriverPerDiem.calculate(driver.perDiem.trips[0]);return {gross:result.gross,toPay:result.toPay,paidDays:result.paidDays};}),{gross:'1750',toPay:'750',paidDays:'2.5'});await page.reload();await page.locator('[data-dp-panel]').waitFor();assert.match(await page.locator('[data-dp-panel]').innerText(),/1 750,00/);assert.deepEqual(await page.evaluate(()=>data.drivers.find(row=>row.id===0).perDiem),driver.perDiem);assert.equal(state.writes.length,1);
});
