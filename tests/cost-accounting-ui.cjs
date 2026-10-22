const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{createRequire}=require('node:module');
const snapshotFixture=require('./helpers/ui-snapshot-fixture.cjs');
let pw;try{pw=require('playwright');}catch{pw=createRequire(path.join(process.env.TVS_PLAYWRIGHT_MODULES||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),'package.json'))('playwright');}
const root=path.resolve(__dirname,'..');let browser,page,errors;
before(async()=>{const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';browser=await pw.chromium.launch({headless:true,executablePath:process.env.TVS_TEST_BROWSER||(!process.env.CI&&fs.existsSync(edge)?edge:undefined)});});
after(async()=>{await browser?.close();});
beforeEach(async()=>{
 page=await browser.newPage({viewport:{width:1280,height:900}});errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 const db={vehicles:[{id:'a',plate:'А001',make:'Тест',norm:10,fuel:'diesel',fuelGrade:'ДТ'}],records:[{id:'r',vehicleId:'a',date:'2026-10-18',km:100}],generators:[{id:'g',name:'Генератор'}],genRecords:[{id:'gr',generatorId:'g',date:'2026-10-18',hours:10}],appMeta:[{id:'meta',toPlanInit:'test'}],costEntries:[],costProfiles:[]};
 await snapshotFixture.install(page,{database:db,token:'synthetic-cost-accounting'},()=>{
  window.__defer=false;const writeData=window.electronAPI.writeData;
  window.electronAPI.writeData=async json=>{window.__writes++;if(window.__reject)return false;if(window.__defer)await new Promise(resolve=>{window.__releaseWrite=resolve;});return writeData(json);};
 });
 await page.goto(pathToFileURL(path.join(root,'index.html')).href);
 await page.waitForFunction(()=>typeof data!=='undefined'&&data.vehicles[0]?.id==='a'&&typeof renderCostsSection==='function');
 await page.evaluate(()=>{costPeriodFrom='2026-10-01';costPeriodTo='2026-10-31';switchSection('costs');});
});
afterEach(async()=>{await page?.close();assert.deepEqual(errors,[]);});
async function fillEntry(amount='1000',kind='expense'){
 await page.locator('[data-cost-action="new"]').click();
 await page.locator('#costEntryForm [name="assetRef"]').selectOption('v:a');
 await page.locator('#costEntryForm [name="date"]').fill('2026-10-18');
 await page.locator('#costEntryForm [name="kind"]').selectOption(kind);
 await page.locator('#costEntryForm [name="amount"]').fill(amount);
 await page.locator('#costEntryForm [name="title"]').fill(kind==='income'?'Выручка по акту':'Аренда техники');
 await page.locator('#costEntryForm [name="independent"]').check();
}
test('real cost workspace saves independent expense and revenue; facts use journal km and show detail sources',async()=>{
 await fillEntry();await page.locator('#costEntryForm [type="submit"]').click();await page.waitForFunction(()=>data.costEntries.length===1&&!document.querySelector('#wfModal.open #costEntryForm'));
 await fillEntry('1500','income');await page.locator('#costEntryForm [type="submit"]').click();await page.waitForFunction(()=>data.costEntries.length===2&&!document.querySelector('#wfModal.open #costEntryForm'));
 await page.locator('[data-cost-action="asset"][data-ref="v:a"]').click();
 assert.match(await page.locator('.cost-workspace').innerText(),/Аренда техники/);assert.match(await page.locator('.cost-workspace').innerText(),/Выручка по акту/);
 const state=await page.evaluate(()=>({rows:data.costEntries,disk:JSON.parse(window.__disk).costEntries,actual:TvsCostEngine.buildReport(data,{from:costPeriodFrom,to:costPeriodTo,assetRef:'v:a'}).rows[0]}));
 assert.equal(state.rows.length,2);assert.deepEqual(state.rows,state.disk);assert.equal(state.actual.rate,10);assert.equal(state.actual.result,500);
});
test('failed native write keeps form values, rolls back memory and retry creates exactly one row',async()=>{
 await fillEntry();await page.evaluate(()=>window.__reject=true);await page.locator('#costEntryForm [type="submit"]').click();
 await page.waitForFunction(()=>window.__writes===1&&!costPending);assert.equal(await page.locator('#costEntryForm [name="amount"]').inputValue(),'1000');
 assert.match(await page.locator('#costEntryError').innerText(),/не записаны/);assert.equal(await page.evaluate(()=>data.costEntries.length),0);assert.equal(await page.evaluate(()=>JSON.parse(window.__disk).costEntries.length),0);
 await page.evaluate(()=>window.__reject=false);await page.locator('#costEntryForm [type="submit"]').click();await page.waitForFunction(()=>data.costEntries.length===1&&!document.querySelector('#wfModal.open #costEntryForm'));
 assert.equal(await page.evaluate(()=>JSON.parse(window.__disk).costEntries.length),1);
});
test('thrown save preserves inputs, conditionally rolls back its array and never restores stale remote data',async()=>{
 await fillEntry('75');await page.evaluate(()=>{window.__originalCostSave=saveData;saveData=async()=>{throw Error('Имитированная ошибка записи');};});
 await page.locator('#costEntryForm [type="submit"]').click();await page.waitForFunction(()=>!costPending&&document.getElementById('costEntryError').textContent.includes('Имитированная'));
 assert.equal(await page.evaluate(()=>data.costEntries.length),0);assert.equal(await page.locator('#costEntryForm [name="amount"]').inputValue(),'75');
 await page.evaluate(()=>{saveData=async()=>{data={...data,costEntries:[{id:'remote',date:'2026-10-18',assetRef:'v:a',kind:'expense',amount:5,title:'Серверная запись',independent:true}]};throw Error('Удалённое изменение');};});
 await page.locator('#costEntryForm [type="submit"]').click();await page.waitForFunction(()=>document.getElementById('costEntryError').textContent.includes('Удалённое'));
 assert.deepEqual(await page.evaluate(()=>data.costEntries.map(row=>row.id)),['remote']);
});
test('two simultaneous form submissions create one write and one operation',async()=>{
 await fillEntry('50');await page.evaluate(()=>{window.__defer=true;const form=document.getElementById('costEntryForm');form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
 await page.waitForFunction(()=>window.__writes===1&&typeof window.__releaseWrite==='function');assert.equal(await page.locator('#costEntryForm [type="submit"]').isDisabled(),true);
 await page.evaluate(()=>window.__releaseWrite());await page.waitForFunction(()=>!costPending&&!document.querySelector('#wfModal.open #costEntryForm'));
 assert.equal(await page.evaluate(()=>window.__writes),1);assert.equal(await page.evaluate(()=>data.costEntries.length),1);
});
test('zero expense and zero profile rates remain zero while blank profile rates remain unknown',async()=>{
 await fillEntry('0');await page.locator('#costEntryForm [type="submit"]').click();await page.waitForFunction(()=>!document.querySelector('#wfModal.open #costEntryForm'));
 await page.locator('[data-cost-action="asset"][data-ref="v:a"]').click();await page.locator('[data-cost-action="profile"]').first().click();
 await page.locator('#costProfileForm [name="salaryRate"]').fill('0');await page.locator('#costProfileForm [name="fuelRate"]').fill('10');await page.locator('#costProfileForm [name="fuelPrice"]').fill('60');await page.locator('#costProfileForm [type="submit"]').click();await page.waitForFunction(()=>data.costProfiles.length===1&&!document.querySelector('#wfModal.open #costProfileForm'));
 const state=await page.evaluate(()=>({entry:data.costEntries[0],profile:data.costProfiles[0],row:TvsCostEngine.buildReport(data,{from:costPeriodFrom,to:costPeriodTo,assetRef:'v:a'}).rows[0]}));
 assert.equal(state.entry.amount,0);assert.equal(state.row.rate,0);assert.equal(state.profile.salaryRate,0);assert.equal(state.profile.depreciationRate,null);assert.equal(state.row.scenario.rate,6);assert.equal(state.row.scenario.complete,false);
});
test('read-only financial role sees facts but cannot open or submit any editing route',async()=>{
 await page.evaluate(()=>{_sync.access={readable:['vehicles','generators','records','genRecords','costEntries','costProfiles'],writable:[]};renderCostsSection();});
 assert.equal(await page.locator('[data-cost-action="new"]').count(),0);assert.equal(await page.locator('[data-cost-action="profile"]').count(),0);
 const failure=await page.evaluate(async()=>{costEditEntry();costEditProfile();try{await costPersistRows('costEntries',[{id:'e',date:'2026-10-18',assetRef:'v:a',kind:'expense',amount:10,title:'Запрещено',independent:true}]);}catch(error){return error.message;}});
 assert.match(failure,/чтение/);assert.equal(await page.locator('#costEntryForm,#costProfileForm').count(),0);assert.equal(await page.evaluate(()=>window.__writes),0);
});
test('open forms cannot write after a same-database account or profile switch',async()=>{
 await page.evaluate(()=>{_sync.databaseToken='same-db';_sync.access={user:{id:'old',role:'accountant'},readable:['vehicles','generators','records','genRecords','costEntries','costProfiles'],writable:['costEntries','costProfiles']};});
 await fillEntry('20');await page.evaluate(()=>{_sync.access.user={id:'new',role:'accountant'};});
 await page.locator('#costEntryForm [type="submit"]').click();assert.match(await page.locator('#costEntryError').innerText(),/учётная запись изменились/);assert.equal(await page.evaluate(()=>window.__writes),0);assert.equal(await page.locator('#costEntryForm [name="amount"]').inputValue(),'20');
 await page.evaluate(()=>closeModal('wfModal'));await page.locator('[data-cost-action="profile"]').first().click();await page.locator('#costProfileForm [name="salaryRate"]').fill('1');await page.evaluate(()=>{localCacheKey='changed-profile-cache';});
 await page.locator('#costProfileForm [type="submit"]').click();assert.match(await page.locator('#costProfileError').innerText(),/профиль/);assert.equal(await page.evaluate(()=>window.__writes),0);
});
test('period filter rejects inverted dates; both themes fit supported viewport widths',async()=>{
 await page.locator('#costFrom').fill('2026-10-31');await page.locator('#costTo').fill('2026-10-01');await page.locator('#costFilters [type="submit"]').click();assert.match(await page.locator('#costFilterError').innerText(),/Начало периода/);
 for(const width of [1280,960])for(const theme of ['light','dark']){await page.setViewportSize({width,height:800});await page.evaluate(theme=>{applyTheme(theme);renderCostsSection();},theme);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
});
