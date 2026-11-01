 'use strict';
const {test,before,after,beforeEach,afterEach}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{createRequire}=require('node:module'),{pathToFileURL}=require('node:url');
const schema=require('../assets/core/platform-schema.js'),registry=require('../assets/core/registry-import.js');
let pw;try{pw=require('playwright');}catch{pw=createRequire(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/package.json'))('playwright');}
let browser,page,errors;
before(async()=>{browser=await pw.chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});});
after(async()=>{await browser?.close();});
beforeEach(async()=>{
 page=await browser.newPage({viewport:{width:1280,height:900}});errors=[];page.on('pageerror',error=>errors.push(error.message));
 const database=Object.fromEntries(schema.sections.map(name=>[name,[]]));
 database.vehicles=[{id:0,plate:'SYNTHETIC-0',make:'Test',org:'Synthetic org'}];database.generators=[{id:'0',name:'Synthetic DES',org:'Synthetic org'}];database.drivers=[{id:0,name:'Synthetic driver',personnelRoles:['driver']}];database.appMeta=[{id:'meta',toPlanInit:'synthetic'}];database.fuelCards=[{id:'fc_cash',number:'НАЛИЧКА',provider:'Наличка',assignments:[]}];
 database.savedReestrs=[registry.buildRegister({id:'synthetic-registry',number:'185',date:'2026-10-22',source:{id:'a'.repeat(64)+'.pdf',sha256:'a'.repeat(64),size:120,name:'synthetic.pdf'},declaredTotal:100.1,reason:'Synthetic source review',invoices:[{supplier:'Synthetic supplier',description:'Synthetic service',invoiceNo:'BILL-01',date:'2026-10-01',sum:100.1,allocations:[{kind:'vehicle',assetId:0,sum:40.05},{kind:'generator',assetId:'0',sum:40.05},{kind:'driver',assetId:0,sum:20,expenseType:'training'}]}]},database)];
 await require('./helpers/ui-snapshot-fixture.cjs').install(page,{database,countWrites:true},()=>{
  const read=electronAPI.readSnapshot;electronAPI.readSnapshot=async payload=>{const result=JSON.parse(await read(payload));result.access={user:{id:'synthetic-admin',role:'admin'},readable:Object.keys(result.data),writable:Object.keys(result.data)};return JSON.stringify(result);};
  window.reestrAPI={loadStatyi:async()=>[{label:'Synthetic budget',code:'1',name:'Synthetic'}]};
 });
 await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);await page.waitForFunction(()=>typeof data!=='undefined'&&data.savedReestrs?.length===1&&typeof desktopWebFeatures!=='undefined');await page.evaluate(()=>desktopWebFeatures.ensure());
});
afterEach(async()=>{await page?.close();assert.deepEqual(errors,[]);});
test('desktop web parity: registry and invoice links preserve exact vehicle/DES/driver IDs without page reload or writes',async()=>{
 const original=page.url();await page.evaluate(()=>switchSection('registries'));await page.locator('.registry-page').waitFor();assert.match(await page.locator('.registry-page').innerText(),/Реестры|BILL-01/);
 await page.locator('a[href^="/registries?register="]').first().click();await page.locator('[data-registry-editor]').waitFor();assert.equal(page.url(),original);assert.equal(await page.evaluate(()=>tvsWeb.params().get('register')),'"synthetic-registry"');assert.equal(new URL(page.url()).pathname,new URL(original).pathname);
 await page.evaluate(()=>desktopWebFeatures.navigate('/transport/vehicle?asset=0'));await page.locator('[data-vehicle-invoices]').waitFor();assert.match(await page.locator('[data-vehicle-invoices]').innerText(),/BILL-01|40,05/);
 await page.evaluate(()=>desktopWebFeatures.navigate('/generators/card?asset=%220%22'));await page.locator('[data-generator-invoices]').waitFor();assert.equal(await page.evaluate(()=>selectedGeneratorId),'0');
 await page.evaluate(()=>desktopWebFeatures.navigate('/people/drivers?person=0'));await page.locator('[data-driver-invoices]').waitFor();assert.match(await page.locator('[data-driver-invoices]').innerText(),/BILL-01|20,00/);assert.equal(await page.evaluate(()=>__writes),0);
});
test('desktop web parity: registry finance and legacy budget are reachable through shared tabs',async()=>{
 await page.evaluate(()=>switchSection('finances'));await page.locator('.finance-registry-page').waitFor();assert.match(await page.locator('.finance-registry-page').innerText(),/100,10|Статистика/);
 await page.locator('a[href="/finance?view=expenses"]').first().click();await page.waitForFunction(()=>document.querySelector('.finance-registry-page h2')?.textContent.includes('План-факт'));assert.equal(await page.evaluate(()=>tvsWeb.params().get('view')),'expenses');
 await page.evaluate(()=>desktopWebFeatures.navigate('/finance?view=ledger&mode=budget'));await page.waitForFunction(()=>finView==='budget'&&document.querySelector('[data-finance-source-tabs]'));assert.equal(await page.evaluate(()=>__writes),0);
});
test('desktop web parity: dirty registry survives denied navigation and forbidden readers see no registry',async()=>{
 await page.evaluate(()=>desktopWebFeatures.navigate('/registries?register=%22synthetic-registry%22'));await page.locator('[data-registry-editor]').waitFor();await page.locator('[data-registry-editor] [name=number]').fill('LOCAL DRAFT');
 page.on('dialog',dialog=>dialog.dismiss());await page.evaluate(()=>switchSection('vehicles'));assert.equal(await page.locator('[data-registry-editor] [name=number]').inputValue(),'LOCAL DRAFT');assert.equal(await page.evaluate(()=>activeSection),'registries');
 page.removeAllListeners('dialog');page.on('dialog',dialog=>dialog.accept());await page.reload();await page.waitForFunction(()=>typeof desktopWebFeatures!=='undefined'&&typeof data!=='undefined'&&data.savedReestrs?.length===1);await page.evaluate(()=>{_sync.access.readable=_sync.access.readable.filter(name=>name!=='savedReestrs');switchSection('registries');});await page.locator('[role=alert]').waitFor();assert.match(await page.locator('[role=alert]').innerText(),/Нет доступа/);assert.equal(await page.locator('.registry-page').count(),0);assert.equal(await page.evaluate(()=>__writes),0);
});

test('desktop web parity: replacing a database/account removes the former registry draft before rendering',async()=>{
 await page.evaluate(()=>desktopWebFeatures.navigate('/registries?register=%22synthetic-registry%22'));await page.locator('[data-registry-editor]').waitFor();await page.locator('[data-registry-editor] [name=number]').fill('PRIVATE FORMER DRAFT');
 await page.evaluate(()=>{data={...data,savedReestrs:[]};_sync.databaseToken='synthetic-replacement';_sync.access.user.id='synthetic-new-account';renderWorkspaceSection('registries');});await page.waitForFunction(()=>!document.querySelector('[data-registry-editor]'));assert.doesNotMatch(await page.locator('#mainContent').innerText(),/PRIVATE FORMER DRAFT|BILL-01/);assert.equal(await page.evaluate(()=>__writes),0);
});

test('desktop static surface serves only exact shared assets and preserves strict trusted page URLs',()=>{
 const security=require('../electron/security.js'),root=path.resolve(__dirname,'..');
 for(const name of ['bdds.js','registries.js','finance-registry.js','registry-counterparties.js','driver-invoices.js','vehicle-invoices.js','logistics.js','registries.css','finance-registry.css','vehicle-invoices.css'])assert.equal(security.staticFile(root,'/web/public/'+name),path.join(root,'web/public',name));
 for(const route of ['/web/server.cjs','/web/deployment/windows/server-config.example.json','/web/public/bridge.js','/web/public/../../electron/main.js','/web/public/registries.js/../bridge.js'])assert.equal(security.staticFile(root,route),null);
 assert.equal(security.trustedPage('http://127.0.0.1:1234/index.html',root,1234),'main');assert.equal(security.trustedPage('http://127.0.0.1:1234/index.html?register=secret',root,1234),null);
});
