const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{createRequire}=require('node:module');
const schema=require('../assets/core/platform-schema.js');
let pw;try{pw=require('playwright');}catch{pw=createRequire(path.join(process.env.TVS_PLAYWRIGHT_MODULES||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),'package.json'))('playwright');}
let browser,page,errors;
function fixture(){
 const db=Object.fromEntries(schema.sections.map(name=>[name,[]]));
 db.vehicles=[{id:712,plate:'SYNTHETIC-712',make:'Synthetic vehicle',driver:'Synthetic driver',org:'Synthetic organization',fuel:'diesel',fuelGrade:'ДТ',fuelBalance:50,norm:10},{id:713,plate:'SYNTHETIC-713',make:'Other synthetic vehicle',driver:'Other driver',fuel:'diesel',fuelGrade:'ДТ',fuelBalance:30,norm:10}];
 db.generators=[{id:913,name:'SYNTHETIC-DES',org:'Synthetic organization',fuel:'diesel',fuelBalance:20,norm:2,tankId:22}];
 db.tanks=[{id:22,name:'SYNTHETIC-TANK',org:'Synthetic organization',fuel:'diesel',balanceInit:500}];
 db.records=[{id:'august-measure',vehicleId:712,date:'2026-08-31',km:1000,fuelActual:10,tankMeasured:923.537,note:'Synthetic confirmed measurement'},{id:'september-record',vehicleId:712,date:'2026-09-10',km:100,fuelActual:5,fuelIssued:0}];
 db.genRecords=[{id:'august-gen',generatorId:913,tankId:22,date:'2026-08-31',hours:5,fuelIssued:10,fuelActual:2,tankMeasured:12}];
 db.tankIncomes=[{id:'august-tank',tankId:22,date:'2026-08-01',liters:100}];
 db.fuelCards=[{id:'fc_cash',number:'НАЛИЧКА',provider:'Наличка',assignments:[]}];db.appMeta=[{id:'meta',toPlanInit:'synthetic'}];return db;
}
before(async()=>{const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';browser=await pw.chromium.launch({headless:true,executablePath:process.env.TVS_TEST_BROWSER||(!process.env.CI&&fs.existsSync(edge)?edge:undefined)});});
after(async()=>{await browser?.close();});
beforeEach(async()=>{
 page=await browser.newPage({viewport:{width:1280,height:900}});errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await page.addInitScript(({database,sections})=>{
  window.__token='synthetic-fuel-accounting-A';window.__disks={[window.__token]:JSON.stringify(database)};window.__revisions={};window.__writes=[];window.__hold=false;window.__mode='ok';window.__canonicalBasis=null;window.__closeReplies=[];
  window.__snapshot=token=>{const db=JSON.parse(window.__disks[token]),revs=window.__revisions[token]??={};for(const name of sections){db[name]??=[];revs[name]??=1;}return{data:db,revisions:{...revs},databaseToken:token,platform:{apiVersion:1,operations:1,outbox:1,commands:1}};};
  window.electronAPI={
   readSnapshot:async()=>JSON.stringify(window.__snapshot(window.__token)),
   writeSections:async raw=>{
    const request=JSON.parse(raw);window.__writes.push(request);if(window.__hold)await new Promise(resolve=>window.__release=resolve);
    if(window.__mode==='reject')return{ok:false,error:'Synthetic boundary save rejected'};
    if(window.__mode==='conflict')return{ok:false,conflicts:Object.keys(request.sections),error:'Synthetic dependency conflict',databaseToken:request.databaseToken};
    const db=JSON.parse(window.__disks[request.databaseToken]),revs=window.__revisions[request.databaseToken],canonical=structuredClone(request.sections);
    if(window.__canonicalBasis)for(const section of ['vehicles','generators','tanks'])for(const row of canonical[section]||[])if(row.fuelAccounting)row.fuelAccounting.basis=window.__canonicalBasis;
    for(const[name,rows]of Object.entries(canonical)){db[name]=rows;revs[name]++;}window.__disks[request.databaseToken]=JSON.stringify(db);
    return{ok:true,databaseToken:request.databaseToken,revisions:{...revs},...(window.__mode==='missingCanonical'?{}:{canonicalSections:canonical}),operationReceipt:{id:request.operation.id,digest:PlatformKernel.requestDigest(request),status:'committed'}};
   },onPrepareClose:callback=>{window.__prepareClose=callback;},finishClose:async response=>{window.__closeReplies.push(response);return true;}
  };
 },{database:fixture(),sections:schema.sections});
 await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);await page.waitForFunction(()=>typeof fuelAccountingOpen==='function'&&typeof data!=='undefined'&&data.vehicles.some(row=>row.id===712),{timeout:10000});
});
afterEach(async()=>{await page?.close();assert.deepEqual(errors,[]);});
async function open(section='vehicles',id=712){await page.evaluate(({section,id})=>fuelAccountingOpen(section,id),{section,id});const form=page.locator('#fuelAccountingForm');assert.equal(await form.count(),1,await page.evaluate(()=>document.querySelector('#globalToast')?.textContent||'Accounting form did not open'));return form;}
async function fill(form,opening='923,537'){await form.locator('[name="from"]').fill('2026-09-01');await form.locator('[name="opening"]').fill(opening);await form.locator('[name="basis"]').fill('Synthetic measured balance on 31 August 2026');}
async function review(form){await form.locator('[data-fa-review]').click();await page.waitForFunction(()=>!!document.querySelector('[data-fa-preview]')&&!document.querySelector('[data-fa-preview]').hidden);await form.locator('[name="confirm"]').check();}
async function submit(form){await form.locator('[data-fa-save]').click();}
async function closed(){await page.waitForFunction(()=>!document.querySelector('#wfModal.open'));}
async function error(){await page.waitForFunction(()=>!!document.querySelector('[data-fa-error]')?.textContent.trim());}

test('opening and cancelling the form keeps all legacy data and leaves the new date and opening blank',async()=>{
 const before=await page.evaluate(()=>JSON.stringify(data)),form=await open();assert.equal(await form.locator('[name="from"]').inputValue(),'');assert.equal(await form.locator('[name="opening"]').inputValue(),'');assert.equal(await form.locator('[name="basis"]').inputValue(),'');assert.equal(await form.locator('[data-fa-save]').isDisabled(),true);assert.match(await form.innerText(),/прежний расчёт/);await form.locator('[data-fa-cancel]').click();assert.equal(await page.evaluate(()=>JSON.stringify(data)),before);assert.equal(await page.evaluate(()=>window.__writes.length),0);
});

test('explicit preview and confirmation preserve 923.537 and wait for canonical ACK without staging accounting data',async()=>{
 const before=await page.evaluate(()=>({data:JSON.stringify(data),records:JSON.stringify(data.records),generators:JSON.stringify(data.generators),tanks:JSON.stringify(data.tanks)})),form=await open();await fill(form);await form.locator('[data-fa-review]').click();assert.match(await form.locator('[data-fa-preview]').innerText(),/923,537/);assert.match(await form.locator('[data-fa-preview]').innerText(),/Исторических записей: 1/);assert.match(await form.locator('[data-fa-preview]').innerText(),/не учитывается/);assert.equal(await form.locator('[data-fa-save]').isDisabled(),true);await page.screenshot({path:path.resolve(__dirname,'../audit/fuel-accounting-preview.png')});await form.locator('[name="confirm"]').check();await page.evaluate(()=>{window.__hold=true;window.__canonicalBasis='Canonical measured basis';});await submit(form);await page.waitForFunction(()=>window.__writes.length===1);
 assert.equal(await page.evaluate(()=>JSON.stringify(data)),before.data);assert.equal(await form.locator('[name="opening"]').isDisabled(),true);assert.match(await form.locator('[data-fa-status]').innerText(),/Ожидается подтверждение/);await form.evaluate(node=>node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));assert.equal(await page.evaluate(()=>window.__writes.length),1);
 await page.evaluate(()=>{window.__hold=false;window.__release();});await closed();const after=await page.evaluate(()=>({asset:data.vehicles[0],records:JSON.stringify(data.records),generators:JSON.stringify(data.generators),tanks:JSON.stringify(data.tanks),baseline:JSON.parse(_lastPersisted).vehicles[0],synced:JSON.parse(_sync.synced.vehicles)[0]}));assert.deepEqual(after.asset.fuelAccounting,{version:1,from:'2026-09-01',opening:923.537,basis:'Canonical measured basis'});assert.equal(after.asset.fuelBalance,50);assert.equal(after.records,before.records);assert.equal(after.generators,before.generators);assert.equal(after.tanks,before.tanks);assert.deepEqual(after.asset,after.baseline);assert.deepEqual(after.asset,after.synced);
});

for(const [section,id,opening,legacyField,legacyValue]of [['generators',913,'12.345','fuelBalance',20],['tanks',22,'456.789','balanceInit',500]])test(section+' receives an explicit boundary without changing legacy balances or operational journals',async()=>{
 const before=await page.evaluate(()=>JSON.stringify({records:data.records,genRecords:data.genRecords,tankIncomes:data.tankIncomes})),form=await open(section,id);await fill(form,opening);await review(form);await submit(form);await closed();const after=await page.evaluate(({section,id})=>({asset:data[section].find(row=>row.id===id),journals:JSON.stringify({records:data.records,genRecords:data.genRecords,tankIncomes:data.tankIncomes})}),{section,id});assert.equal(after.asset.fuelAccounting.opening,Number(opening));assert.equal(after.asset[legacyField],legacyValue);assert.equal(after.journals,before);
});

test('a prior August measurement is copied only by an explicit click and remains an unsaved draft',async()=>{
 const before=await page.evaluate(()=>JSON.stringify(data)),form=await open();await form.locator('[name="from"]').fill('2026-09-01');assert.equal(await form.locator('[name="opening"]').inputValue(),'');await form.locator('[data-fa-measure]').click();assert.equal(await form.locator('[name="opening"]').inputValue(),'923.537');assert.match(await form.locator('[name="basis"]').inputValue(),/31\.08\.2026.*august-measure/);assert.equal(await page.evaluate(()=>JSON.stringify(data)),before);assert.equal(await page.evaluate(()=>window.__writes.length),0);assert.equal(await form.locator('[data-fa-save]').isDisabled(),true);
});

test('copying a latest measurement of another fuel family refuses without replacing the entered opening or basis',async()=>{
 await page.evaluate(()=>{data.records[0].fuelGrade='Газ';data.records.push({id:'older-diesel-measure',vehicleId:712,date:'2026-08-30',fuelGrade:'ДТ',km:0,fuelActual:0,tankMeasured:30});});const form=await open();await form.locator('[name="from"]').fill('2026-09-01');await form.locator('[name="opening"]').fill('77,123');await form.locator('[name="basis"]').fill('Keep my confirmed manual basis');const before=await page.evaluate(()=>JSON.stringify(data));await form.locator('[data-fa-measure]').click();await error();assert.match(await form.locator('[data-fa-error]').innerText(),/другому виду топлива.*Газ/);assert.equal(await form.locator('[name="opening"]').inputValue(),'77,123');assert.equal(await form.locator('[name="basis"]').inputValue(),'Keep my confirmed manual basis');assert.equal(await page.evaluate(()=>JSON.stringify(data)),before);assert.equal(await page.evaluate(()=>window.__writes.length),0);
});

test('source allocation uses the shared strict validation and cannot save a mismatched total',async()=>{
 const form=await open();await fill(form);await form.locator('[name="allocate"]').check();await form.locator('[data-fa-source="qty"]').fill('900');await form.locator('[data-fa-review]').click();await error();assert.match(await form.locator('[data-fa-error]').innerText(),/Сумма источников/);assert.equal(await page.evaluate(()=>window.__writes.length),0);await form.locator('[data-fa-source="qty"]').fill('923,537');await review(form);await submit(form);await closed();const source=await page.evaluate(()=>data.vehicles[0].fuelAccounting.sources[0]);assert.deepEqual(source,{org:'Synthetic organization',grade:'ДТ',qty:923.537});
});

for(const mode of ['conflict','reject','missingCanonical'])test(mode+' keeps the draft, leaves live data unchanged and reports no successful start',async()=>{
 const before=await page.evaluate(()=>JSON.stringify(data)),form=await open();await fill(form);await review(form);await page.evaluate(mode=>{window.__mode=mode;},mode);await submit(form);await error();assert.equal(await page.evaluate(()=>JSON.stringify(data)),before);assert.equal(await form.locator('[name="opening"]').inputValue(),'923,537');assert.equal(await form.locator('[name="basis"]').inputValue(),'Synthetic measured balance on 31 August 2026');assert.equal(await form.locator('[name="opening"]').isDisabled(),false);assert.equal(await form.locator('[data-fa-save]').isDisabled(),false);
 if(mode!=='missingCanonical'){const operationId=await page.evaluate(()=>window.__writes[0].operation.id);await page.evaluate(()=>{window.__mode='ok';});await submit(form);await closed();assert.equal(await page.evaluate(()=>window.__writes[1].operation.id),operationId);assert.equal(await page.evaluate(()=>data.vehicles[0].fuelAccounting.opening),923.537);}
});

test('changing the draft invalidates its prior preview and explicit confirmation',async()=>{
 const form=await open();await fill(form);await review(form);await form.locator('[name="opening"]').fill('20');assert.equal(await form.locator('[name="confirm"]').isChecked(),false);assert.equal(await form.locator('[data-fa-save]').isDisabled(),true);assert.equal(await form.locator('[data-fa-preview]').isHidden(),true);assert.equal(await page.evaluate(()=>window.__writes.length),0);
});

test('saving a boundary preserves unrelated dirty rows and keeps them out of persisted baselines',async()=>{
 await page.evaluate(()=>{data.vehicles[1].note='Unsaved other vehicle draft';data.opsTasks.push({id:'unsaved-local-task',title:'Unrelated local task draft'});});const form=await open();await fill(form);await review(form);await submit(form);await closed();const result=await page.evaluate(()=>({localVehicle:data.vehicles[1],localTasks:data.opsTasks,baseline:JSON.parse(_lastPersisted),request:window.__writes[0]}));assert.equal(result.localVehicle.note,'Unsaved other vehicle draft');assert.equal(result.localTasks.length,1);assert.equal(result.baseline.vehicles[1].note,undefined);assert.deepEqual(result.baseline.opsTasks,[]);assert.equal(result.request.sections.vehicles[1].note,undefined);assert.equal('opsTasks'in result.request.sections,false);
});

for(const kind of ['database','source','fieldPermissions'])test('a '+kind+' change during the save cannot apply the old boundary to the current card',async()=>{
 if(kind==='fieldPermissions')await page.evaluate(()=>{_sync.access={user:{id:'same-user',name:'Same user',role:'admin'},readable:PlatformSchema.sections.slice(),writable:PlatformSchema.sections.slice(),fieldPermissions:{vehicles:['fuelAccounting']}};});
 const form=await open();await fill(form);await review(form);await page.evaluate(()=>{window.__hold=true;});await submit(form);await page.waitForFunction(()=>window.__writes.length===1);
 await page.evaluate(kind=>{if(kind==='database'){const fresh=structuredClone(data);fresh.vehicles[0].plate='NEW-SYNTHETIC-DATABASE';data=fresh;window.__token='synthetic-fuel-accounting-B';window.__disks[window.__token]=JSON.stringify(fresh);_sync.databaseToken=window.__token;_lastPersisted=JSON.stringify(fresh);}else if(kind==='source')data.vehicles[0].note='New unsaved source edit';else _sync.access.fieldPermissions.vehicles.push('note');},kind);const captured=await page.evaluate(()=>JSON.stringify(data));await page.evaluate(()=>{window.__hold=false;window.__release();});await error();assert.equal(await page.evaluate(()=>JSON.stringify(data)),captured);assert.equal(await page.evaluate(()=>Object.hasOwn(data.vehicles[0],'fuelAccounting')),false);assert.equal(await form.locator('[name="opening"]').inputValue(),'923,537');
});

test('diagnostic opening references open the new typed form without changing data',async()=>{
 const before=await page.evaluate(()=>JSON.stringify(data));await page.evaluate(()=>{gsmDiagnosticsRefs=[{type:'opening',id:712,vehicleId:712}];gsmDiagnosticsOpenRef(0);});await page.locator('#fuelAccountingForm').waitFor();assert.match(await page.locator('#wfModal .modal-title').innerText(),/SYNTHETIC-712/);assert.equal(await page.evaluate(()=>JSON.stringify(data)),before);assert.equal(await page.evaluate(()=>window.__writes.length),0);
});

test('legacy source allocation links to explicit beginning without coercing the numeric vehicle ID',async()=>{
 await page.evaluate(()=>gsmOpeningDialog(712));await page.getByRole('button',{name:'Задать дату начала учёта',exact:true}).click();const form=page.locator('#fuelAccountingForm');await form.waitFor();assert.match(await page.locator('#wfModal .modal-title').innerText(),/SYNTHETIC-712/);assert.equal(await form.locator('[name="opening"]').inputValue(),'');assert.equal(await page.locator('#genericModal.open').count(),0);assert.equal(await page.evaluate(()=>window.__writes.length),0);
});

test('the close barrier waits for an in-flight boundary receipt before reporting readiness',async()=>{
 const form=await open();await fill(form);await review(form);await page.evaluate(()=>{window.__hold=true;});await submit(form);await page.waitForFunction(()=>window.__writes.length===1);await page.evaluate(()=>{window.__close=window.__prepareClose('boundary-close');});assert.equal(await page.evaluate(()=>window.__closeReplies.length),0);await page.evaluate(()=>{window.__hold=false;window.__release();});await page.evaluate(()=>window.__close);assert.deepEqual(await page.evaluate(()=>window.__closeReplies),[{nonce:'boundary-close',ready:true}]);assert.equal(await page.evaluate(()=>data.vehicles[0].fuelAccounting.opening),923.537);
});

test('viewers cannot open a writable accounting form',async()=>{
 await page.evaluate(()=>{_sync.access={user:{id:'viewer',name:'Viewer',role:'viewer'},readable:PlatformSchema.sections.slice(),writable:[]};fuelAccountingOpen('vehicles',712);});assert.equal(await page.locator('#fuelAccountingForm').count(),0);assert.match(await page.locator('#globalToast').innerText(),/просмотра/);assert.equal(await page.evaluate(()=>window.__writes.length),0);
});

test('all three actual card buttons pass their original numeric asset IDs to the new form',async()=>{
 for(const [section,id,label]of [['vehicles',712,'SYNTHETIC-712'],['generators',913,'SYNTHETIC-DES'],['tanks',22,'SYNTHETIC-TANK']]){
  await page.evaluate(({section,id})=>{switchSection(section);if(section==='vehicles')selectVehicle(id);else if(section==='generators')selectGenerator(id);else selectTank(id);},{section,id});await page.getByRole('button',{name:'Начало учёта ГСМ',exact:true}).click();const form=page.locator('#fuelAccountingForm');await form.waitFor();assert.match(await page.locator('#wfModal .modal-title').innerText(),new RegExp(label));await form.locator('[data-fa-cancel]').click();
 }assert.equal(await page.evaluate(()=>window.__writes.length),0);
});

test('ordinary vehicle editing preserves a saved explicit boundary and its precise opening',async()=>{
 const form=await open();await fill(form);await review(form);await submit(form);await closed();const before=await page.evaluate(()=>JSON.stringify(data.vehicles[0].fuelAccounting));await page.evaluate(()=>openEditVehicle(712));await page.locator('#vm_note').fill('A normal card edit after enabling fuel accounting');await page.evaluate(()=>saveVehicle());assert.equal(await page.evaluate(()=>JSON.stringify(data.vehicles[0].fuelAccounting)),before);assert.equal(await page.evaluate(()=>data.vehicles[0].note),'A normal card edit after enabling fuel accounting');assert.equal(await page.evaluate(()=>data.vehicles[0].fuelBalance),50);assert.equal(await page.evaluate(()=>JSON.parse(window.__disks[window.__token]).vehicles[0].fuelAccounting.opening),923.537);
});
