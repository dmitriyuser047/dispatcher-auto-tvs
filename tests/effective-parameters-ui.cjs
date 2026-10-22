const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{createRequire}=require('node:module');
const schema=require('../assets/core/platform-schema.js');
let pw;try{pw=require('playwright');}catch{pw=createRequire(path.join(process.env.TVS_PLAYWRIGHT_MODULES||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),'package.json'))('playwright');}
let browser,page,errors;
function fixture(){
 const db=Object.fromEntries(schema.sections.map(name=>[name,[]]));
 const vehicle={norm:10,normCity:0,normHighway:null,normIdle:2};
 const gen={power:100,norm:null,norm100:1.126,norm50:0.563,normIdle:0.14};
 const rates={salaryRate:1,depreciationRate:0,fuelRate:null,fuelPrice:70.123456};
 db.vehicles=[{id:712,plate:'SYNTHETIC-712',make:'Synthetic vehicle',driver:'Synthetic driver',org:'Synthetic organization',fuel:'diesel',fuelGrade:'ДТ',fuelBalance:50,...vehicle},{id:713,plate:'SYNTHETIC-713',make:'Dated vehicle',driver:'Other driver',fuel:'diesel',fuelGrade:'ДТ',fuelBalance:30,...vehicle,fuelNorms:{version:1,periods:[{id:0,from:'2026-06-01',basis:'Confirmed original norm',parameters:vehicle},{id:'0',from:'2026-11-01',basis:'Confirmed future norm',parameters:{...vehicle,norm:12}}]}},{id:714,plate:'SYNTHETIC-714',make:'Other vehicle',driver:'Other driver',fuel:'diesel',fuelGrade:'ДТ',fuelBalance:30,norm:10}];
 db.generators=[{id:913,name:'SYNTHETIC-DES',location:'Synthetic site',org:'Synthetic organization',fuel:'diesel',fuelBalance:20,tankId:22,...gen},{id:914,name:'Dated DES',location:'Synthetic site',fuel:'diesel',fuelBalance:20,power:100,norm:2,fuelNorms:{version:1,periods:[{id:'generator-date',from:'2026-09-01',basis:'Confirmed generator curve',parameters:gen}]}}];
 db.costProfiles=[{id:'profile-712',assetRef:'v:712',note:'Original scalar profile',...rates},{id:'profile-713',assetRef:'v:713',note:'Dated profile',...rates,ratePeriods:{version:1,periods:[{id:'rate-date',from:'2026-09-01',basis:'Confirmed original rates',parameters:rates}]}}];
 db.tanks=[{id:22,name:'SYNTHETIC-TANK',org:'Synthetic organization',fuel:'diesel',balanceInit:500}];
 db.records=[{id:'august-measure',vehicleId:712,date:'2026-08-31',km:1000,fuelActual:10,tankMeasured:923.537,note:'Synthetic confirmed measurement'},{id:'september-record',vehicleId:712,date:'2026-09-10',km:100,fuelActual:5,fuelIssued:0}];
 db.genRecords=[{id:'august-gen',generatorId:913,tankId:22,date:'2026-08-31',hours:5,fuelIssued:10,fuelActual:2},{id:'stored-manual-zero',generatorId:914,tankId:22,date:'2026-09-10',hours:1,load:75,fuelUsed:0,fuelActual:0}];
 db.fuelCards=[{id:'fc_cash',number:'НАЛИЧКА',provider:'Наличка',assignments:[]}];db.appMeta=[{id:'meta',toPlanInit:'synthetic'}];return db;
}
before(async()=>{const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';browser=await pw.chromium.launch({headless:true,executablePath:process.env.TVS_TEST_BROWSER||(!process.env.CI&&fs.existsSync(edge)?edge:undefined)});});
after(async()=>{await browser?.close();});
beforeEach(async()=>{
 page=await browser.newPage({viewport:{width:1280,height:900}});errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await page.addInitScript(({database,sections})=>{
  window.__token='synthetic-fuel-accounting-A';window.__disks={[window.__token]:JSON.stringify(database)};window.__revisions={};window.__writes=[];window.__hold=false;window.__mode='ok';window.__canonicalBasis=null;window.__rejectMessage='Synthetic effective-period save rejected';window.__closeReplies=[];
  window.__snapshot=token=>{const db=JSON.parse(window.__disks[token]),revs=window.__revisions[token]??={};for(const name of sections){db[name]??=[];revs[name]??=1;}return{data:db,revisions:{...revs},databaseToken:token,platform:{apiVersion:1,operations:1,outbox:1,commands:1}};};
  window.electronAPI={
   readSnapshot:async()=>JSON.stringify(window.__snapshot(window.__token)),
   writeSections:async raw=>{
    const request=JSON.parse(raw);window.__writes.push(request);if(window.__hold)await new Promise(resolve=>window.__release=resolve);
    if(window.__mode==='reject')return{ok:false,error:window.__rejectMessage};
    if(window.__mode==='conflict')return{ok:false,conflicts:Object.keys(request.sections),error:'Synthetic dependency conflict',databaseToken:request.databaseToken};
    const db=JSON.parse(window.__disks[request.databaseToken]),revs=window.__revisions[request.databaseToken],canonical=structuredClone(request.sections);
    if(window.__canonicalBasis)for(const section of ['vehicles','generators','costProfiles'])for(const row of canonical[section]||[])for(const kind of ['fuelNorms','ratePeriods'])if(row[kind])row[kind].periods.at(-1).basis=window.__canonicalBasis;
    for(const[name,rows]of Object.entries(canonical)){db[name]=rows;revs[name]++;}window.__disks[request.databaseToken]=JSON.stringify(db);
    return{ok:true,databaseToken:request.databaseToken,revisions:{...revs},...(window.__mode==='missingCanonical'?{}:{canonicalSections:canonical}),operationReceipt:{id:request.operation.id,digest:PlatformKernel.requestDigest(request),status:'committed'}};
   },onPrepareClose:callback=>{window.__prepareClose=callback;},finishClose:async response=>{window.__closeReplies.push(response);return true;}
  };
 },{database:fixture(),sections:schema.sections});
 await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);await page.waitForFunction(()=>typeof fuelNormsOpen==='function'&&typeof data!=='undefined'&&data.vehicles.some(row=>row.id===712),{timeout:10000});
});
afterEach(async()=>{await page?.close();assert.deepEqual(errors,[]);});
async function open(section='vehicles',id=712){await page.evaluate(({section,id})=>section==='costProfiles'?costRatesOpen(id):fuelNormsOpen(section,id),{section,id});const form=page.locator('#effectiveParametersForm');assert.equal(await form.count(),1,await page.evaluate(()=>document.querySelector('#globalToast')?.textContent||'Period editor did not open'));return form;}
async function period(form,from='2026-11-01',values={norm:'12,123456'},basis='Synthetic confirmed effective date'){await form.locator('[name="from"]').fill(from);await form.locator('[name="basis"]').fill(basis);for(const[key,value]of Object.entries(values))await form.locator('[name="'+key+'"]').fill(value);}
async function stage(form){await form.locator('[data-ep-stage]').click();}
async function review(form){await form.locator('[data-ep-review]').click();await page.waitForFunction(()=>!!document.querySelector('[data-ep-preview]')&&!document.querySelector('[data-ep-preview]').hidden);await form.locator('[name="confirm"]').check();}
async function submit(form){await form.locator('[data-ep-save]').click();}
async function closed(){await page.waitForFunction(()=>!document.querySelector('#wfModal.open'));}
async function error(){await page.waitForFunction(()=>!!document.querySelector('[data-ep-error]')?.textContent.trim());}

test('opening and cancelling a period editor never generates dates, parameters or database changes',async()=>{
 const before=await page.evaluate(()=>JSON.stringify(data)),form=await open();assert.equal(await form.locator('[name="from"]').inputValue(),'');assert.equal(await form.locator('[name="basis"]').inputValue(),'');for(const key of ['norm','normCity','normHighway','normIdle'])assert.equal(await form.locator('[name="'+key+'"]').inputValue(),'');await form.locator('[data-ep-cancel]').click();assert.equal(await page.evaluate(()=>JSON.stringify(data)),before);assert.equal(await page.evaluate(()=>window.__writes.length),0);
});

test('copying old scalar parameters is explicit and leaves the effective date and basis blank',async()=>{
 const before=await page.evaluate(()=>JSON.stringify(data)),form=await open();await form.locator('[data-ep-copy]').click();assert.equal(await form.locator('[name="norm"]').inputValue(),'10');assert.equal(await form.locator('[name="normCity"]').inputValue(),'0');assert.equal(await form.locator('[name="normHighway"]').inputValue(),'');assert.equal(await form.locator('[name="from"]').inputValue(),'');assert.equal(await form.locator('[name="basis"]').inputValue(),'');assert.equal(await page.evaluate(()=>JSON.stringify(data)),before);assert.equal(await page.evaluate(()=>window.__writes.length),0);
});

test('a vehicle period preserves zero and unknown, warns about earlier coverage and waits for its canonical ACK',async()=>{
 const before=await page.evaluate(()=>JSON.stringify(data)),form=await open();await period(form,'2026-11-01',{norm:'12,123456',normCity:'0'});await review(form);assert.match(await form.locator('[data-ep-preview]').innerText(),/До первого периода параметры неизвестны/);assert.match(await form.locator('[data-ep-preview]').innerText(),/сервер повторно проверит/);await page.evaluate(()=>{window.__hold=true;window.__canonicalBasis='Canonical verified period basis';});await submit(form);await page.waitForFunction(()=>window.__writes.length===1);assert.equal(await page.evaluate(()=>JSON.stringify(data)),before);assert.equal(await form.locator('[name="from"]').isDisabled(),true);await form.locator('[data-ep-save]').dispatchEvent('click');assert.equal(await page.evaluate(()=>window.__writes.length),1);await page.evaluate(()=>{window.__hold=false;window.__release();});await closed();const result=await page.evaluate(()=>({row:data.vehicles[0],stored:JSON.parse(_lastPersisted).vehicles[0],synced:JSON.parse(_sync.synced.vehicles)[0],beforeFirst:EffectivePeriods.resolve('vehicles',data.vehicles[0],'2026-10-01','fuelNorms')}));assert.equal(result.row.norm,10);assert.equal(result.row.fuelBalance,50);assert.deepEqual(result.row.fuelNorms.periods[0].parameters,{norm:12.123456,normCity:0,normHighway:null,normIdle:null});assert.equal(result.row.fuelNorms.periods[0].basis,'Canonical verified period basis');assert.equal(result.beforeFirst.status,'missing');assert.deepEqual(result.row,result.stored);assert.deepEqual(result.row,result.synced);
});

test('a generator period contains its full independent power and norm snapshot without replacing scalar fields',async()=>{
 const form=await open('generators',913);await period(form,'2026-11-01',{power:'100,123456',norm:'0',norm100:'1,126',norm50:'0,563',normIdle:'0,14'});await review(form);await submit(form);await closed();const row=await page.evaluate(()=>data.generators[0]);assert.equal(row.power,100);assert.equal(row.norm,null);assert.deepEqual(row.fuelNorms.periods[0].parameters,{power:100.123456,norm:0,norm100:1.126,norm50:0.563,normIdle:0.14});
});

test('a rate period preserves the profile scalar base and can create a new profile without inventing scalar rates',async()=>{
 let form=await open('costProfiles','v:712');await period(form,'2026-11-01',{salaryRate:'0',depreciationRate:'1,123456',fuelPrice:'71,654321'});await review(form);await submit(form);await closed();let row=await page.evaluate(()=>data.costProfiles.find(row=>row.assetRef==='v:712'));assert.equal(row.salaryRate,1);assert.equal(row.fuelPrice,70.123456);assert.deepEqual(row.ratePeriods.periods[0].parameters,{salaryRate:0,depreciationRate:1.123456,fuelRate:null,fuelPrice:71.654321});
 form=await open('costProfiles','v:714');await period(form,'2026-11-01',{salaryRate:'2'});await review(form);await submit(form);await closed();row=await page.evaluate(()=>data.costProfiles.find(row=>row.assetRef==='v:714'));assert.equal(Object.hasOwn(row,'salaryRate'),false);assert.equal(row.ratePeriods.periods[0].parameters.salaryRate,2);
});

test('date, basis, unique starts and exact six-decimal parameters are validated before any write',async()=>{
 const form=await open();await form.locator('[data-ep-stage]').click();await error();assert.match(await form.locator('[data-ep-error]').innerText(),/дату/);await period(form,'2026-11-01',{norm:'1,1234567'},'');await stage(form);await error();assert.match(await form.locator('[data-ep-error]').innerText(),/основание/);await form.locator('[name="basis"]').fill('Synthetic verified norm');await stage(form);await error();assert.match(await form.locator('[data-ep-error]').innerText(),/знаков/);assert.equal(await form.locator('[name="norm"]').inputValue(),'1,1234567');await form.locator('[name="norm"]').fill('1,123456');await stage(form);await period(form,'2026-11-01',{norm:'2'});await stage(form);await error();assert.match(await form.locator('[data-ep-error]').innerText(),/уникальн/);assert.equal(await form.locator('[data-ep-history] tbody tr').count(),1);assert.equal(await page.evaluate(()=>window.__writes.length),0);
});

test('a user can explicitly build a same-value historical period and a future period without automatic backdating',async()=>{
 const form=await open();await form.locator('[data-ep-copy]').click();await period(form,'2026-06-01',{},'Synthetic original norm order dated 1 June');await stage(form);await period(form,'2026-11-01',{norm:'12'},'Synthetic new norm order dated 1 November');await stage(form);const rows=form.locator('[data-ep-history] tbody tr');assert.equal(await rows.count(),2);assert.match(await rows.nth(0).innerText(),/31\.10\.2026/);await review(form);await submit(form);await closed();const values=await page.evaluate(()=>data.vehicles[0].fuelNorms.periods.map(row=>({from:row.from,parameters:row.parameters})));assert.deepEqual(values,[{from:'2026-06-01',parameters:{norm:10,normCity:0,normHighway:null,normIdle:2}},{from:'2026-11-01',parameters:{norm:12,normCity:null,normHighway:null,normIdle:null}}]);
});

test('editing an existing period keeps numeric zero and string zero identities distinct',async()=>{
 const form=await open('vehicles',713);await form.locator('[data-ep-history] tbody tr').nth(0).locator('[data-ep-edit]').click();await form.locator('[name="basis"]').fill('Corrected explicit source basis');await stage(form);await review(form);await submit(form);await closed();assert.deepEqual(await page.evaluate(()=>data.vehicles[1].fuelNorms.periods.map(row=>row.id)),[0,'0']);
});

for(const mode of ['conflict','reject','missingCanonical'])test(mode+' retains the staged journal and retries the exact operation without touching live data',async()=>{
 const before=await page.evaluate(()=>JSON.stringify(data)),form=await open();await period(form);await review(form);await page.evaluate(mode=>{window.__mode=mode;window.__rejectMessage='Защищённая история потеряет покрытие. Добавьте явный период с прежними параметрами.';},mode);await submit(form);await error();assert.equal(await page.evaluate(()=>JSON.stringify(data)),before);assert.equal(await form.locator('[data-ep-history] tbody tr').count(),1);assert.equal(await form.locator('[data-ep-save]').isDisabled(),false);if(mode==='reject')assert.match(await form.locator('[data-ep-error]').innerText(),/Защищённая история/);if(mode!=='missingCanonical'){const operationId=await page.evaluate(()=>window.__writes[0].operation.id);await page.evaluate(()=>{window.__mode='ok';});await submit(form);await closed();assert.equal(await page.evaluate(()=>window.__writes[1].operation.id),operationId);assert.equal(await page.evaluate(()=>data.vehicles[0].fuelNorms.periods.length),1);}
});

for(const kind of ['database','source','fieldPermissions'])test('a '+kind+' change during ACK wait cannot apply a prior period to the current source',async()=>{
 if(kind==='fieldPermissions')await page.evaluate(()=>{_sync.access={user:{id:'same-admin',name:'Admin',role:'admin'},readable:PlatformSchema.sections.slice(),writable:PlatformSchema.sections.slice(),fieldPermissions:{vehicles:['fuelNorms']}};});const form=await open();await period(form);await review(form);await page.evaluate(()=>{window.__hold=true;});await submit(form);await page.waitForFunction(()=>window.__writes.length===1);await page.evaluate(kind=>{if(kind==='database'){data=structuredClone(data);data.vehicles[0].plate='NEW SYNTHETIC DB';window.__token='synthetic-effective-B';window.__disks[window.__token]=JSON.stringify(data);_sync.databaseToken=window.__token;_lastPersisted=JSON.stringify(data);}else if(kind==='source')data.vehicles[0].note='New unsaved source change';else _sync.access.fieldPermissions.vehicles.push('note');},kind);const captured=await page.evaluate(()=>JSON.stringify(data));await page.evaluate(()=>{window.__hold=false;window.__release();});await error();assert.equal(await page.evaluate(()=>JSON.stringify(data)),captured);assert.equal(await form.locator('[data-ep-history] tbody tr').count(),1);
});

test('saving one journal preserves unrelated dirty data and excludes it from the persisted baseline',async()=>{
 await page.evaluate(()=>{data.vehicles[2].note='Unrelated unsaved vehicle note';data.opsTasks.push({id:'local-task',title:'Unrelated local task'});});const form=await open();await period(form);await review(form);await submit(form);await closed();const result=await page.evaluate(()=>({local:data.vehicles[2].note,task:data.opsTasks[0].id,baseline:JSON.parse(_lastPersisted),request:window.__writes[0]}));assert.equal(result.local,'Unrelated unsaved vehicle note');assert.equal(result.task,'local-task');assert.equal(result.baseline.vehicles[2].note,undefined);assert.deepEqual(result.baseline.opsTasks,[]);assert.equal(result.request.sections.vehicles[2].note,undefined);
});

test('activated journals make scalar norm and rate fields read-only and direct scalar submissions are refused',async()=>{
 await page.evaluate(async()=>{selectedVehicleId=713;openEditVehicle(713);document.getElementById('vm_norm').value='99';await saveVehicle();});assert.equal(await page.locator('#vm_norm').getAttribute('aria-readonly'),'true');assert.equal(await page.evaluate(()=>window.__writes.length),0);assert.match(await page.locator('#globalToast').innerText(),/по датам/);await page.evaluate(()=>closeModal('vehicleModal'));
 await page.evaluate(async()=>{selectedGeneratorId=914;openEditGenerator(914);document.getElementById('gm_power').value='101';await saveGenerator();});assert.equal(await page.locator('#gm_power').getAttribute('aria-readonly'),'true');assert.equal(await page.evaluate(()=>window.__writes.length),0);await page.evaluate(()=>closeModal('generatorModal'));
 await page.evaluate(()=>{costAssetRef='v:713';costEditProfile();document.querySelector('#costProfileForm [name="salaryRate"]').value='99';document.getElementById('costProfileForm').requestSubmit();});assert.equal(await page.locator('#costProfileForm [name="salaryRate"]').evaluate(node=>node.readOnly),true);assert.equal(await page.evaluate(()=>window.__writes.length),0);assert.match(await page.locator('#costProfileError').innerText(),/по датам/);
});

test('ordinary note edits preserve activated journals and their old scalar bases',async()=>{
 const before=await page.evaluate(()=>({vehicle:JSON.stringify(data.vehicles[1].fuelNorms),generator:JSON.stringify(data.generators[1].fuelNorms),rates:JSON.stringify(data.costProfiles[1].ratePeriods)}));
 await page.evaluate(async()=>{selectedVehicleId=713;openEditVehicle(713);document.getElementById('vm_note').value='Vehicle note only';await saveVehicle();selectedGeneratorId=914;openEditGenerator(914);document.getElementById('gm_note').value='Generator note only';await saveGenerator();costAssetRef='v:713';costEditProfile();document.querySelector('#costProfileForm [name="note"]').value='Profile note only';document.getElementById('costProfileForm').requestSubmit();});await page.waitForFunction(()=>window.__writes.length===3&&!costPending);
 const result=await page.evaluate(()=>({vehicle:JSON.stringify(data.vehicles[1].fuelNorms),generator:JSON.stringify(data.generators[1].fuelNorms),rates:JSON.stringify(data.costProfiles[1].ratePeriods),scalars:[data.vehicles[1].norm,data.generators[1].power,data.generators[1].norm,data.costProfiles[1].salaryRate]}));assert.equal(result.vehicle,before.vehicle);assert.equal(result.generator,before.generator);assert.equal(result.rates,before.rates);assert.deepEqual(result.scalars,[10,100,2,1]);
});

test('viewers and field-limited mechanics can read a period journal without an editing route',async()=>{
 await page.evaluate(()=>{_sync.access={user:{id:'mechanic',name:'Mechanic',role:'mechanic'},readable:PlatformSchema.sections.slice(),writable:['vehicles'],fieldPermissions:{vehicles:['maintenanceRules']}};});const form=await open('vehicles',713);assert.equal(await form.locator('[data-ep-history] tbody tr').count(),2);assert.equal(await form.locator('[data-ep-save]').count(),0);assert.equal(await form.locator('[data-ep-stage]').count(),0);assert.match(await form.innerText(),/только для просмотра/);assert.equal(await page.evaluate(()=>window.__writes.length),0);
});

test('close flush waits for a pending period receipt and a late receipt does not close a different form',async()=>{
 const form=await open();await period(form);await review(form);await page.evaluate(()=>{window.__hold=true;});await submit(form);await page.waitForFunction(()=>window.__writes.length===1);await page.evaluate(()=>{window.__flushDone=false;window.__flushPromise=platformFlushForClose().then(value=>{window.__flushDone=true;return value;});});assert.equal(await page.evaluate(()=>window.__flushDone),false);await page.evaluate(()=>{wfShowDialog('Another synthetic form','<input id="otherDraft" value="Keep this draft">');window.__hold=false;window.__release();});assert.equal(await page.evaluate(()=>window.__flushPromise),true);assert.equal(await page.locator('#otherDraft').inputValue(),'Keep this draft');assert.equal(await page.evaluate(()=>data.vehicles[0].fuelNorms.periods.length),1);
});

test('generator form calculations use the selected record date and preserve manually entered zero',async()=>{
 await page.evaluate(()=>{selectedGeneratorId=914;openAddGenRecord();document.getElementById('gen_rec_date').value='10.09.2026';document.getElementById('gen_rec_hours').value='1';document.getElementById('gen_rec_load').value='75';calcGenFuelAuto();calcGenActualAuto();});assert.equal(await page.locator('#gen_rec_fuel_used').inputValue(),'1.126');assert.equal(await page.locator('#gen_rec_fuel_actual').inputValue(),'0.845');
 await page.locator('#gen_rec_date').fill('31.08.2026');await page.locator('#gen_rec_date').dispatchEvent('change');assert.equal(await page.locator('#gen_rec_fuel_used').inputValue(),'');assert.equal(await page.locator('#gen_rec_fuel_actual').inputValue(),'');assert.match(await page.locator('#gen_rec_norm_status').innerText(),/норма не задана/);
 await page.evaluate(()=>{openEditGenRecord('stored-manual-zero');});await page.locator('#gen_rec_date').fill('31.08.2026');await page.locator('#gen_rec_date').dispatchEvent('change');assert.equal(await page.locator('#gen_rec_fuel_used').inputValue(),'0');assert.equal(await page.locator('#gen_rec_fuel_actual').inputValue(),'0');await page.locator('#gen_rec_date').fill('10.09.2026');await page.locator('#gen_rec_date').dispatchEvent('change');assert.equal(await page.locator('#gen_rec_fuel_used').inputValue(),'0');await page.locator('#gen_rec_norm_calculate').click();assert.equal(await page.locator('#gen_rec_fuel_used').inputValue(),'1.126');assert.equal(await page.locator('#gen_rec_fuel_actual').inputValue(),'0');
});

test('calendar selection recalculates vehicle and DES estimates on the selected date',async()=>{
 await page.evaluate(()=>{selectedVehicleId=713;openAddRecord();document.getElementById('rec_km').value='100';document.getElementById('rec_date').value='10.09.2026';calcFuelAuto();calOpen();calY=2026;calM=10;calRender();});
 assert.equal(await page.locator('#rec_fuel_used').inputValue(),'10');await page.locator('#calPopup [onclick="calPick(10)"]').click();assert.equal(await page.locator('#rec_date').inputValue(),'10.11.2026');assert.equal(await page.locator('#rec_fuel_used').inputValue(),'12');
 await page.evaluate(()=>closeModal('recordModal'));
 await page.evaluate(()=>{selectedGeneratorId=914;openAddGenRecord();document.getElementById('gen_rec_date').value='10.09.2026';document.getElementById('gen_rec_hours').value='1';document.getElementById('gen_rec_load').value='75';calcGenFuelAuto();calcGenActualAuto();calOpenFor('gen_rec_date');calY=2026;calM=7;calRender();});await page.locator('#calPopup [onclick="calPick(31)"]').click();assert.equal(await page.locator('#gen_rec_fuel_used').inputValue(),'');assert.equal(await page.locator('#gen_rec_fuel_actual').inputValue(),'');assert.match(await page.locator('#gen_rec_norm_status').innerText(),/норма не задана/);assert.equal(await page.evaluate(()=>window.__writes.length),0);
});

test('stored vehicle zero stays authoritative and odometer estimates preserve thousandths',async()=>{
 await page.evaluate(()=>{data.records.push({id:'manual-vehicle-zero',vehicleId:713,date:'2026-09-10',km:100,fuelUsed:0,fuelActual:0});selectedVehicleId=713;openEditRecord('manual-vehicle-zero');});await page.locator('#rec_date').fill('10.11.2026');await page.locator('#rec_date').dispatchEvent('change');assert.equal(await page.locator('#rec_fuel_used').inputValue(),'0');assert.equal(await page.locator('#rec_fuel_actual').inputValue(),'0');await page.locator('#rec_recalculate_norm').click();assert.equal(await page.locator('#rec_fuel_used').inputValue(),'12');assert.equal(await page.locator('#rec_fuel_actual').inputValue(),'0');
 await page.evaluate(()=>{document.getElementById('rec_odo_start').value='100.001';document.getElementById('rec_km').value='0.002';calcOdoEnd();});assert.equal(await page.locator('#rec_odo_end').inputValue(),'100.003');await page.evaluate(()=>{document.getElementById('rec_odo_end').value='100.005';calcKmFromOdo();});assert.equal(await page.locator('#rec_km').inputValue(),'0.004');assert.equal(await page.evaluate(()=>window.__writes.length),0);
});

test('DES detail shows power and constant norm on the displayed date without falling back to old scalar values',async()=>{
 await page.evaluate(()=>{const generator=data.generators.find(row=>row.id===914);generator.power=999;generator.norm=99;generator.fuelNorms.periods.push({id:'future-power',from:'2026-11-01',basis:'Synthetic confirmed derating',parameters:{power:200,norm:3,norm100:null,norm50:null,normIdle:null}});dispatcherLocalDate=()=> '2026-09-30';selectedGeneratorId=914;renderGenDetail(generator);});let text=await page.locator('.vehicle-detail-header').innerText();assert.match(text,/100 кВт.*30\.09\.2026/);assert.doesNotMatch(text,/999|Норма: 99/);
 await page.evaluate(()=>{dispatcherLocalDate=()=> '2026-11-30';renderGenDetail(data.generators.find(row=>row.id===914));});text=await page.locator('.vehicle-detail-header').innerText();assert.match(text,/200 кВт.*30\.11\.2026/);assert.match(text,/Норма: 3 л\/мтч/);
 await page.evaluate(()=>{dispatcherLocalDate=()=> '2026-08-31';renderGenDetail(data.generators.find(row=>row.id===914));});text=await page.locator('.vehicle-detail-header').innerText();assert.match(text,/Норма на сегодня не задана/);assert.doesNotMatch(text,/999|Норма: 99/);assert.equal(await page.evaluate(()=>window.__writes.length),0);
});

test('cost workspace shows mixed rate periods and an uncovered interval instead of presenting a full estimate',async()=>{
 await page.evaluate(()=>{const parameters={salaryRate:1,depreciationRate:0,fuelRate:0,fuelPrice:70};data.costProfiles[1].ratePeriods={version:1,periods:[{id:'september',from:'2026-09-01',basis:'September rate source',parameters},{id:'october',from:'2026-10-01',basis:'October rate source',parameters:{...parameters,salaryRate:2}}]};data.records.push({id:'uncovered-rate',vehicleId:713,date:'2026-08-31',km:1},{id:'september-rate',vehicleId:713,date:'2026-09-15',km:2},{id:'october-rate',vehicleId:713,date:'2026-10-15',km:3});costAssetRef='v:713';costPeriodFrom='2026-08-01';costPeriodTo='2026-10-31';switchSection('costs');});
 const host=page.locator('.cost-rate-periods');assert.equal(await host.locator('tbody tr').count(),3);assert.match(await host.innerText(),/September rate source/);assert.match(await host.innerText(),/October rate source/);assert.match(await host.innerText(),/Не покрыто периодами: 1 км/);assert.match(await host.innerText(),/Полная оценка недоступна/);assert.match(await host.innerText(),/8,00 ₽/);assert.equal(await page.evaluate(()=>window.__writes.length),0);
});

test('a dated cost scenario explains unknown journal quantities without describing them as a zero coverage gap',async()=>{
 await page.evaluate(()=>{data.records.push({id:'unknown-km',vehicleId:713,date:'2026-09-10',km:null});costAssetRef='v:713';costPeriodFrom='2026-09-01';costPeriodTo='2026-09-30';switchSection('costs');});const text=await page.locator('.cost-rate-periods').innerText();assert.match(text,/неизвестным пробегом или наработкой/);assert.doesNotMatch(text,/Не покрыто периодами: 0/);assert.equal(await page.evaluate(()=>window.__writes.length),0);
});

test('actual numeric-ID card buttons and old-form links open the matching dated editors',async()=>{
 for(const [section,id]of [['vehicles',712],['generators',913]]){
  await page.evaluate(({section,id})=>{activeSection=section;if(section==='vehicles'){selectedVehicleId=id;renderDetail(data.vehicles.find(row=>row.id===id));}else{selectedGeneratorId=id;renderGenDetail(data.generators.find(row=>row.id===id));}},{section,id});await page.locator('#mainContent button').filter({hasText:'Нормы по датам'}).click();await page.locator('#effectiveParametersForm').waitFor();assert.match(await page.locator('#wfModal .modal-title').innerText(),section==='vehicles'?/SYNTHETIC-712/:/SYNTHETIC-DES/);await page.locator('[data-ep-cancel]').click();
 }
 await page.evaluate(()=>openEditVehicle(712));await page.locator('#vehicleModal [data-ep-legacy] button').click();await page.locator('#effectiveParametersForm').waitFor();assert.match(await page.locator('#wfModal .modal-title').innerText(),/SYNTHETIC-712/);await page.locator('[data-ep-cancel]').click();
 await page.evaluate(()=>{costAssetRef='v:712';costEditProfile();});await page.locator('[data-cost-periods]').click();await page.locator('#effectiveParametersForm').waitFor();assert.match(await page.locator('#wfModal .modal-title').innerText(),/Ставки оценки по датам.*SYNTHETIC-712/);assert.equal(await page.evaluate(()=>window.__writes.length),0);
});

test('a source edit before submit blocks persistence and retains the explicitly entered draft',async()=>{
 const form=await open();await period(form);await page.evaluate(()=>{data.vehicles[0].note='An independent unsaved edit';});await stage(form);await error();assert.equal(await page.evaluate(()=>window.__writes.length),0);assert.equal(await form.locator('[name="from"]').inputValue(),'2026-11-01');assert.equal(await form.locator('[name="norm"]').inputValue(),'12,123456');assert.match(await form.locator('[data-ep-error]').innerText(),/уже изменились/);
});

test('the journal and confirmation remain within the viewport in both restored themes',async()=>{
 const form=await open('vehicles',713);await form.locator('[data-ep-review]').click();await page.locator('[data-ep-preview]').waitFor();await form.evaluate(node=>{node.closest('.modal-body').scrollTop=0;});await page.screenshot({path:path.resolve(__dirname,'../audit/effective-parameters-preview.png')});for(const theme of ['light','dark'])for(const width of [1280,860,640]){await page.setViewportSize({width,height:900});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);const size=await page.evaluate(()=>({body:document.documentElement.scrollWidth,width:window.innerWidth,modal:document.querySelector('#wfModal .modal').getBoundingClientRect().toJSON()}));assert.equal(size.modal.left>=0&&size.modal.right<=size.width,true,JSON.stringify(size));if(width>=860)assert.equal(size.body<=size.width,true,JSON.stringify(size));}
});
