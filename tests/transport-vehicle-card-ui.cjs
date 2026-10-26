'use strict';
const {test,before,after,beforeEach,afterEach}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{pathToFileURL}=require('node:url'),{createRequire}=require('node:module');
const {install}=require('./helpers/ui-snapshot-fixture.cjs');
let pw;try{pw=require('playwright');}catch{pw=createRequire(path.join(process.env.TVS_PLAYWRIGHT_MODULES||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),'package.json'))('playwright');}
let browser,page,errors;
before(async()=>{const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';browser=await pw.chromium.launch({headless:true,executablePath:process.env.TVS_TEST_BROWSER||(!process.env.CI&&fs.existsSync(edge)?edge:undefined)});});
after(async()=>{await browser?.close();});
beforeEach(async()=>{
 page=await browser.newPage({viewport:{width:1280,height:960}});errors=[];page.on('pageerror',error=>errors.push(error.message));
 await install(page,{database:{vehicles:[{id:0,plate:'SYNTHETIC-559',make:'Synthetic vehicle',org:'Synthetic organization',fuel:'diesel',fuelGrade:'ДТ',norm:13.59,fuelBalance:100},{id:'0',plate:'SYNTHETIC-OTHER',fuelGrade:'ДТ',norm:10,fuelBalance:0}],records:[{id:0,vehicleId:0,date:'2026-10-01',km:100,fuelIssued:100.28999999999999,fuelActual:13.59},{id:'0',vehicleId:0,date:'2026-10-02',km:0,fuelActual:.0004}],fuelCards:[{id:'cash',number:'НАЛИЧКА',provider:'Наличка',assignments:[]}],appMeta:[{id:'meta',toPlanInit:'test'}]},token:'synthetic-transport-card',countWrites:true});
 await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);await page.waitForFunction(()=>typeof data!=='undefined'&&data.vehicles[0]?.plate==='SYNTHETIC-559');await page.evaluate(()=>switchSection('vehicles'));
});
afterEach(async()=>{await page?.close();assert.deepEqual(errors,[]);});
test('vehicle card and journal open with legacy numeric fuel tails while preserving source facts and typed zero IDs',async()=>{
 const before=await page.evaluate(()=>({data:JSON.stringify(data),disk:window.__disk}));
 await page.locator('.vehicle-card').filter({hasText:'SYNTHETIC-559'}).click();await page.locator('.vehicle-detail-header').waitFor();
 assert.match(await page.locator('.vehicle-detail-header').innerText(),/SYNTHETIC-559/);assert.equal(await page.evaluate(()=>selectedVehicleId),0);assert.match(await page.locator('.stats-row').innerText(),/186[,.]7/);
 await page.locator('.vd-journal-card').filter({hasText:'Журнал пробега'}).click({position:{x:20,y:20}});await page.locator('#historyTableWrap table').waitFor();
 assert.equal(await page.locator('input.rec-check').count(),2);const values=await page.locator('input.rec-check').evaluateAll(elements=>elements.map(element=>element.dataset.recid));assert.deepEqual(values,['0','0']);
 assert.deepEqual(await page.evaluate(()=>({data:JSON.stringify(data),disk:window.__disk})),before);assert.equal(await page.evaluate(()=>window.__writes),0);
 assert.deepEqual(await page.evaluate(()=>{const b=computeFuelBalances(0);return [TvsFuelEngine.recordBalanceAt(b,0),TvsFuelEngine.recordBalanceAt(b,'0')];}),[186.7,186.6996]);
});
