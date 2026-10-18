const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
let pw;
try { pw = require('playwright'); }
catch { pw = createRequire(path.join(process.env.TVS_PLAYWRIGHT_MODULES || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'), 'package.json'))('playwright'); }
let browser, page, errors;
const fixture = () => ({
  vehicles: [{ id:'v1',plate:'А111АА72',make:'УАЗ',driver:'Первый водитель',org:'Альфа',object:'База',status:'На ходу',fuel:'gasoline',fuelGrade:'АИ-95',norm:10 },
    { id:'v2',plate:'В222ВВ72',make:'КамАЗ',driver:'Второй водитель',org:'Бета',object:'Другой объект',status:'В резерве',fuel:'diesel',fuelGrade:'ДТ',norm:30 }],
  records: [{id:'r1',vehicleId:'v1',date:'2026-10-17',km:30,driver:'Предыдущий водитель',odoStart:1000,odoEnd:1030,fuelIssued:10,fuelCardNum:'111',fuelOrg:'Альфа',fuelGrade:'АИ-95'},
    {id:'r2',vehicleId:'v2',date:'2026-10-16',km:20,odoStart:2000,odoEnd:2020,fuelIssued:0,fuelGrade:'ДТ'}],
  generators:[{id:'g1',name:'ДЭС Тестовая',serial:'GEN-42',location:'База',norm:10}],genRecords:[],tanks:[],tankIncomes:[],toRecords:[],vehicleTo:[],repairs:[],budget:[],
  payments:[{id:'p1',date:'2026-10-16',sum:12500,invoiceNo:'СЧ-209',description:'Техническое обслуживание',contragent:'Тестовый поставщик',paid:false}],
  contragents:[{id:'ca1',name:'Тестовый поставщик',inn:'7200000042'}],savedReestrs:[{id:'sr1',number:'108',date:'2026-10-18',rowCount:1,rows:[{description:'Масло моторное'}]}],reestrRows:[{description:'Ремень привода',osn:'Счёт 305',sum:500}],
  fuelCards:[{id:'fc1',number:'111',org:'Альфа',provider:'Топливо',assignments:[{vehicleId:'v1'}]}],fuelPurchases:[],fuelImports:[],fuelPeriods:[],monthlyFuel:[],appMeta:[{id:'meta',toPlanInit:'test'}]
});
before(async()=>{const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';browser=await pw.chromium.launch({headless:true,executablePath:process.env.TVS_TEST_BROWSER||(!process.env.CI&&fs.existsSync(edge)?edge:undefined)});});
after(async()=>{await browser?.close();});
beforeEach(async()=>{
  page=await browser.newPage({viewport:{width:1280,height:900}});errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  await page.addInitScript(db=>{window.__disk=JSON.stringify(db);window.__identity='base-A';window.__writes=0;window.__failWrites=false;window.electronAPI={readData:async()=>window.__disk,getDataIdentity:async()=>window.__identity,writeData:async json=>{window.__writes++;if(window.__failWrites)return false;window.__disk=json;return true;}};},fixture());
  await page.goto(pathToFileURL(path.join(__dirname,'../index.html')).href);
  await page.waitForFunction(()=>typeof data!=='undefined'&&data.vehicles.length===2&&_activeSaves===0);
  if(!await page.evaluate(()=>typeof openShiftEntry==='function'))await page.addScriptTag({path:path.join(__dirname,'../assets/js/25n-productivity.js')});
  await page.evaluate(()=>{toAutoSetupOnce=async()=>{};window.__writes=0;});
});
afterEach(async()=>{await page?.close();assert.deepEqual(errors,[]);});
async function openShift(){await page.evaluate(()=>openShiftEntry('2026-10-18'));}
async function fillRow(index,values){await page.evaluate(({index,values})=>{for(const [key,value]of Object.entries(values))productivityShiftInput(index,key,value);},{index,values});}

test('shift validates all rows and persists the batch once with stamped fuel source',async()=>{
  await openShift();await fillRow(0,{km:'40',fuelIssued:'12',fuelCardNum:'111'});await fillRow(1,{km:'50',fuelIssued:'0'});
  assert.equal(await page.evaluate(()=>productivitySaveShift()),true);
  const result=await page.evaluate(()=>({writes:window.__writes,rows:data.records.filter(r=>r.date==='2026-10-18'),open:document.getElementById('shiftEntryModal').classList.contains('open')}));
  assert.equal(result.writes,1);assert.equal(result.rows.length,2);assert.equal(result.open,false);
  const first=result.rows.find(r=>r.vehicleId==='v1');assert.equal(first.odoStart,1030);assert.equal(first.odoEnd,1070);assert.equal(first.fuelOrg,'Альфа');assert.equal(first.fuelProvider,'Топливо');assert.equal(first.fuelUsed,4);
});
test('invalid second row blocks the entire shift without a partial write',async()=>{
  await openShift();await fillRow(0,{km:'40'});await fillRow(1,{km:'-1'});
  assert.equal(await page.evaluate(()=>productivitySaveShift()),false);
  assert.deepEqual(await page.evaluate(()=>({writes:window.__writes,count:data.records.length,draft:productivityShift.rows[0].km})),{writes:0,count:2,draft:'40'});
});
test('closed month and stale journal rows cannot be overwritten',async()=>{
  await openShift();await fillRow(0,{km:'40'});
  await page.evaluate(()=>data.fuelPeriods.push({month:'2026-10',closed:true}));
  assert.equal(await page.evaluate(()=>productivitySaveShift()),false);assert.match(await page.locator('#shiftEntryError').innerText(),/закрыт/);
  await page.evaluate(()=>{data.fuelPeriods=[];data.records[0].note='Правка другого пользователя';});
  assert.equal(await page.evaluate(()=>productivitySaveShift()),false);assert.match(await page.locator('#shiftEntryError').innerText(),/данные изменились/);
  assert.equal(await page.evaluate(()=>window.__writes),0);
});
test('failed write rolls back every row, keeps the scoped draft, and allows retry',async()=>{
  await openShift();await fillRow(0,{km:'40'});await fillRow(1,{km:'50'});await page.evaluate(()=>window.__failWrites=true);
  assert.equal(await page.evaluate(()=>productivitySaveShift()),false);assert.equal(await page.evaluate(()=>data.records.length),2);
  await page.evaluate(()=>{closeModal('shiftEntryModal');window.__failWrites=false;});await openShift();
  assert.equal(await page.evaluate(()=>productivityShift.restored),true);assert.equal(await page.locator('[data-shift-row="0"][data-field="km"]').inputValue(),'40');
  assert.equal(await page.evaluate(()=>productivitySaveShift()),true);assert.equal(await page.evaluate(()=>data.records.filter(r=>r.date==='2026-10-18').length),2);
});
test('shift fuel cannot use a foreign organization or duplicate a statement delivery',async()=>{
  await openShift();await fillRow(0,{km:'40',fuelIssued:'12',fuelCardNum:'111',fuelOrg:'Бета'});
  assert.equal(await page.evaluate(()=>productivitySaveShift()),false);assert.match(await page.locator('#shiftEntryError').innerText(),/карта не принадлежит/);
  await page.evaluate(()=>{productivityShiftInput(0,'fuelOrg','Альфа');data.fuelPurchases.push({id:'fuel1',date:'2026-10-18',vehicleId:'v1',qty:12,cardNo:'111',sourceOrg:'Альфа'});productivityShift.rows[0].baseline=productivityShiftFingerprint(data,'v1');});
  assert.equal(await page.evaluate(()=>productivitySaveShift()),false);assert.match(await page.locator('#shiftEntryError').innerText(),/связана с выпиской/);assert.equal(await page.evaluate(()=>window.__writes),0);
});
test('draft restoration is isolated by database identity and survives reload',async()=>{
  await openShift();await fillRow(0,{km:'42',driver:'Сменный водитель'});await page.reload();await page.waitForFunction(()=>typeof openShiftEntry==='function'&&data.vehicles.length===2);await openShift();
  assert.equal(await page.locator('[data-shift-row="0"][data-field="km"]').inputValue(),'42');
  await page.evaluate(()=>{closeModal('shiftEntryModal');window.__identity='base-B';});await openShift();
  assert.equal(await page.locator('[data-shift-row="0"][data-field="km"]').inputValue(),'');
  await page.evaluate(()=>{closeModal('shiftEntryModal');window.__identity='base-A';});await openShift();
  assert.equal(await page.locator('[data-shift-row="0"][data-field="driver"]').inputValue(),'Сменный водитель');
});
test('copying a shift continues odometer but never copies a fuel delivery',async()=>{
  await openShift();await page.evaluate(()=>productivityCopyPrevious());
  assert.deepEqual(await page.evaluate(()=>({km:productivityShift.rows[0].km,start:productivityShift.rows[0].odoStart,end:productivityShift.rows[0].odoEnd,fuel:productivityShift.rows[0].fuelIssued,selected:productivityShift.rows[1].selected})),{km:30,start:1030,end:1060,fuel:'',selected:false});
  await page.locator('[data-shift-row="0"][data-field="driver"]').focus();await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement.dataset.shiftRow),'1');
});
test('Ctrl+K searches all entities and routes the selected stable identity',async()=>{
  await page.evaluate(()=>{window.__focus=[];workspaceFocusRecord=(section,id)=>window.__focus.push({section,id});});
  for(const [query,section,id]of [['А111','vehicles','v1'],['GEN-42','generators','g1'],['СЧ-209','payments','p1'],['7200000042','contragents','ca1'],['Масло моторное','reestr','sr1'],['Ремень привода','reestr','row:0']]){
    await page.keyboard.press('Control+k');await page.locator('#globalSearchInput').fill(query);await page.keyboard.press('Enter');
    await page.waitForFunction(expected=>window.__focus.at(-1)?.id===expected,id);assert.deepEqual(await page.evaluate(()=>window.__focus.at(-1)),{section,id});
  }
});
test('saved selections restore list filters and belong to the current database only',async()=>{
  await page.evaluate(()=>{switchSection('vehicles');vcSearchQuery='УАЗ';filterStatus='на ходу';filterFuel='gasoline';filterOrg='Альфа';fleetViewModes.vehicles='cards';});
  await page.evaluate(()=>openSavedViews());await page.locator('#savedViewName').fill('Бензиновые УАЗ');await page.getByRole('button',{name:'Сохранить текущую',exact:true}).click();
  await page.evaluate(()=>{closeModal('savedViewsModal');vcSearchQuery='';filterStatus='';filterFuel='';filterOrg='';fleetViewModes.vehicles='table';});
  await page.evaluate(()=>openSavedViews());await page.getByRole('button',{name:/Бензиновые УАЗ/}).first().click();
  assert.deepEqual(await page.evaluate(()=>({search:vcSearchQuery,status:filterStatus,fuel:filterFuel,org:filterOrg,view:fleetViewModes.vehicles})),{search:'УАЗ',status:'на ходу',fuel:'gasoline',org:'Альфа',view:'cards'});
  assert.equal(await page.locator('.fleet-card').count(),1);assert.match(await page.locator('.fleet-card').innerText(),/УАЗ/);
  await page.evaluate(()=>{window.__identity='base-B';});await page.evaluate(()=>openSavedViews());assert.equal(await page.evaluate(()=>productivityViews.length),0);
});
test('a profile switch during shift entry cannot write the old draft into the new base',async()=>{
  await openShift();await fillRow(0,{km:'40'});await page.evaluate(()=>window.__identity='base-B');
  assert.equal(await page.evaluate(()=>productivitySaveShift()),false);assert.match(await page.locator('#shiftEntryError').innerText(),/База переключена/);assert.equal(await page.evaluate(()=>window.__writes),0);
});
test('network conflicts reject the whole shift without a silent merge and include the audit action',async()=>{
  await openShift();await fillRow(0,{km:'40'});await fillRow(1,{km:'50'});
  await page.evaluate(()=>{_sync.enabled=true;_sync.chain=Promise.resolve();for(const name of SYNC_SECTIONS){_sync.synced[name]=JSON.stringify(data[name]||[]);_sync.revs[name]=1;}window.__sectionWrites=[];window.electronAPI.writeSections=async text=>{window.__sectionWrites.push(JSON.parse(text));return{ok:false,conflicts:['records']};};window.electronAPI.readSection=async()=>{throw Error('Silent merge must not read remote sections');};});
  assert.equal(await page.evaluate(()=>productivitySaveShift()),false);
  const result=await page.evaluate(()=>({writes:window.__sectionWrites.length,action:window.__sectionWrites[0].meta.action,count:data.records.length,draft:productivityShift.rows[0].km}));
  assert.deepEqual(result,{writes:1,action:'Ввод смены',count:2,draft:'40'});
});
test('productivity windows never replace another open form or its unsaved input',async()=>{
  await page.evaluate(()=>{switchSection('vehicles');selectVehicle('v1');openEditRecord('r1');});await page.locator('#rec_note').fill('Несохранённое примечание');
  await page.evaluate(async()=>{await openGlobalSearch();await openShiftEntry();await openSavedViews();});await page.keyboard.press('Control+k');
  assert.equal(await page.locator('#rec_note').inputValue(),'Несохранённое примечание');
  assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('.modal-overlay.open')].map(e=>e.id)),['recordModal']);
  assert.equal(await page.evaluate(()=>window.__writes),0);
});
test('fleet view preferences restore independently for each database',async()=>{
  await page.evaluate(()=>productivitySetPreference('fleetView.vehicles','cards'));
  await page.evaluate(async()=>{window.__identity='base-B';await productivityInitialize();});assert.equal(await page.evaluate(()=>fleetViewModes.vehicles),'table');
  await page.evaluate(async()=>{window.__identity='base-A';await productivityInitialize();});assert.equal(await page.evaluate(()=>fleetViewModes.vehicles),'cards');
});
test('search keyboard focuses the query, traps focus, and lets Enter activate Close',async()=>{
  await page.keyboard.press('Control+k');await page.waitForFunction(()=>document.activeElement.id==='globalSearchInput');
  await page.locator('#globalSearchInput').fill('А111');await page.waitForTimeout(30);
  await page.locator('#globalSearchModal .modal-header button').focus();await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.searchIndex),'0');
  await page.locator('#globalSearchModal .modal-header button').focus();await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>document.getElementById('globalSearchModal').classList.contains('open')),false);
  assert.equal(await page.evaluate(()=>selectedVehicleId),null);
});
test('saved finance selections retain partial payment status and period',async()=>{
  await page.evaluate(()=>{data.payments[0].paidAmount=5000;finPaidFilter='partial';finMonth='2026-10';finView='table';switchSection('finances');});
  await page.evaluate(()=>openSavedViews());await page.locator('#savedViewName').fill('Частичные оплаты октября');await page.evaluate(()=>productivitySaveView());
  await page.evaluate(()=>{finPaidFilter='';finMonth='all';});await page.getByRole('button',{name:/Частичные оплаты октября/}).first().click();
  assert.deepEqual(await page.evaluate(()=>({paid:finPaidFilter,month:finMonth,rows:document.querySelectorAll('table tbody tr').length})),{paid:'partial',month:'2026-10',rows:1});
});
