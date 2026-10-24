const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{createRequire}=require('node:module');
const {install:installSnapshotFixture}=require('./helpers/ui-snapshot-fixture.cjs');
let pw;try{pw=require('playwright');}catch{pw=createRequire(path.join(process.env.TVS_PLAYWRIGHT_MODULES||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),'package.json'))('playwright');}
let browser,page,errors;
const root=path.resolve(__dirname,'..');
before(async()=>{const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';browser=await pw.chromium.launch({headless:true,executablePath:process.env.TVS_TEST_BROWSER||(!process.env.CI&&fs.existsSync(edge)?edge:undefined)});});
after(async()=>{await browser?.close();});
beforeEach(async()=>{
 page=await browser.newPage({viewport:{width:1280,height:900}});errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 const db={vehicles:[{id:'v',plate:'ТЕСТ001',make:'Тест',org:'ТВС',fuel:'diesel',fuelGrade:'ДТ',norm:10}],records:[{id:'r',vehicleId:'v',date:'2026-10-18',km:100,fuelActual:10}],generators:[],genRecords:[],drivers:[{id:'d',name:'Тестовый водитель',skills:'C'}],tanks:[],parts:[],appMeta:[{id:'meta',toPlanInit:'test'}]};
 await installSnapshotFixture(page,{database:db,token:'synthetic-unified-ui24',countWrites:true});
 await page.goto(pathToFileURL(path.join(root,'index.html')).href);
 await page.waitForFunction(()=>typeof data!=='undefined'&&data.vehicles[0]?.id==='v');
});
afterEach(async()=>{await page?.close();assert.deepEqual(errors,[]);});

test('all 3.5 sections work in the shared navigation and both restored 3.5.1 themes at supported sizes',async()=>{
 for(const width of [1280,960]){
  await page.setViewportSize({width,height:width===960?700:900});
  for(const theme of ['light','dark']){
   await page.evaluate(theme=>applyTheme(theme),theme);
   for(const section of ['home','dispatch','workflows','vehicles','generators','tanks','fuelPurchases','fuelReport','costs','procurement','toSchedule','reestr','finances','contragents','reports','printForms']){
    await page.locator('#unifiedNav [data-section="'+section+'"]').click();
    const state=await page.evaluate(()=>({active:activeSection,nav:document.querySelector('#unifiedNav [aria-current="page"]')?.dataset.section,overflow:document.documentElement.scrollWidth>innerWidth,accent:getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()}));
    assert.equal(state.active,section);assert.equal(state.nav,section);assert.equal(state.overflow,false);assert.equal(state.accent,theme==='dark'?'#7898ff':'#2e5bff');
   }
  }
 }
});

test('notification preferences preserve input on failure and never write the working database',async()=>{
 await page.evaluate(()=>{
  _sync.databaseToken='a'.repeat(64);_sync.access=null;window.__notificationSaves=[];window.__notificationReject=true;window.__notificationTests=0;
  const state={ok:true,key:'b'.repeat(64),databaseToken:_sync.databaseToken,user:{id:'local',role:'admin'},preferences:{enabled:false,quietEnabled:true,quietStart:'22:00',quietEnd:'08:00'},supported:true,snoozedUntil:0,message:'Пока программа открыта'};
  window.electronAPI.getNotificationSettings=async()=>structuredClone(state);
  window.electronAPI.saveNotificationSettings=async payload=>{window.__notificationSaves.push(payload);if(window.__notificationReject)throw Error('Synthetic settings failure');state.preferences=payload.preferences;return{ok:true,preferences:payload.preferences};};
  window.electronAPI.testNotification=async()=>{window.__notificationTests++;return{ok:true,message:'Synthetic explicit test'};};
 });
 await page.locator('#unifiedNav [data-action="notifications"]').click();
 const form=page.locator('#notificationSettingsForm');await form.waitFor();
 assert.equal(await form.locator('[name="enabled"]').isChecked(),false);
 await form.locator('[name="enabled"]').check();await form.locator('[name="quietStart"]').fill('21:30');
 await form.locator('[type="submit"]').click();
 await page.waitForFunction(()=>document.querySelector('#notificationSettingsForm [data-notification-status]').textContent.includes('Synthetic settings failure'));
 assert.equal(await form.locator('[name="enabled"]').isChecked(),true);assert.equal(await form.locator('[name="quietStart"]').inputValue(),'21:30');
 await page.evaluate(()=>{window.__notificationReject=false;});await form.locator('[type="submit"]').click();
 await page.waitForFunction(()=>window.__notificationSaves.length===2&&!document.querySelector('#notificationSettingsForm [type="submit"]').disabled);
 await form.locator('[data-notification-test]').click();await page.waitForFunction(()=>window.__notificationTests===1);
 assert.equal(await page.evaluate(()=>window.__writes),0);
 await page.locator('#notificationsModal [aria-label="Закрыть"]').click();assert.equal(await page.locator('#notificationsModal').count(),0);
});

test('dispatch form saves an assignment and refuses an overlapping asset and driver',async()=>{
 await page.evaluate(async()=>{window.__disk=JSON.stringify(data);window.__dispatchRevisions=Object.fromEntries(PlatformSchema.sections.map(name=>[name,1]));electronAPI.readSnapshot=async()=>JSON.stringify({data:JSON.parse(__disk),databaseToken:'synthetic-dispatch-calendar',revisions:{...__dispatchRevisions},platform:{apiVersion:1,operations:1,outbox:1,calendar:1,personnelPlanning:1}});electronAPI.writeSections=async raw=>{__writes++;const request=JSON.parse(raw),database=JSON.parse(__disk),now=new Date().toISOString(),clock=BusinessCalendar.resolve(database,now),canonical=BusinessCalendar.canonicalizeIntervals(database,request.sections,{id:request.operation.id,now,today:clock.today,calendar:clock,actor:{id:'trusted-fixture',name:'Trusted fixture',role:'admin'}});for(const[name,rows]of Object.entries(canonical)){database[name]=rows;__dispatchRevisions[name]++;}__disk=JSON.stringify(database);return{ok:true,databaseToken:'synthetic-dispatch-calendar',revisions:{...__dispatchRevisions},canonicalSections:canonical,operationReceipt:{id:request.operation.id,status:'committed'}};};data=await syncLoad();_lastPersisted=JSON.stringify(data);rebuildIndex();});
 await page.evaluate(()=>{wfOpenTab('dispatchJobs');wfEdit('dispatchJobs');});
 async function fill(title,start,end){await page.locator('#wf_title').fill(title);await page.locator('#wf_site').fill('Тестовый участок');await page.locator('#wf_status').selectOption('assigned');await page.locator('#wf_assetRef').selectOption('v:v');await page.locator('#wf_driverId').selectOption('d');await page.locator('#wf_start').fill(start);await page.locator('#wf_end').fill(end);}
 await fill('Первая заявка','2026-10-19T07:00','2026-10-19T09:00');
 await page.locator('#wfForm button[type=submit]').click();
 await page.waitForFunction(()=>data.dispatchJobs.length===1&&!document.querySelector('#wfModal.open'),null,{timeout:5000}).catch(async error=>{throw Error(error.message+' '+await page.locator('#wfError').innerText()+' '+await page.evaluate(()=>JSON.stringify({driver:document.getElementById('wf_driverId')?.value,runtime:platformRuntimeStatus()})));});
 await page.evaluate(()=>wfEdit('dispatchJobs'));
 await fill('Конфликт','2026-10-19T08:00','2026-10-19T10:00');
 await page.locator('#wfForm button[type=submit]').click();
 await page.waitForFunction(()=>document.getElementById('wfError').textContent.trim(),null,{timeout:4000});assert.match(await page.locator('#wfError').innerText(),/Техника занята|занят|пересека/i,await page.evaluate(()=>JSON.stringify(data.dispatchJobs)));
 assert.equal(await page.evaluate(()=>data.dispatchJobs.length),1);
 assert.equal(await page.evaluate(()=>JSON.parse(window.__disk).dispatchJobs.length),1);
});

test('failed workflow save keeps entered values and retry creates one task with history',async()=>{
 await page.evaluate(()=>{wfOpenTab('opsTasks');wfEdit('opsTasks');window.__reject=true;});
 await page.locator('#wf_title').fill('Проверка программы');
 await page.locator('#wf_owner').fill('Тестовый диспетчер');
 await page.locator('#wf_due').fill('2026-10-19');
 await page.locator('#wfForm button[type=submit]').click();
 await page.waitForFunction(()=>window.__writes===1&&unifiedPendingSaves===0);
 assert.equal(await page.locator('#wf_title').inputValue(),'Проверка программы');
 assert.equal(await page.evaluate(()=>data.opsTasks.length),0);
 await page.evaluate(()=>window.__reject=false);
 await page.locator('#wfForm button[type=submit]').click();
 await page.waitForFunction(()=>data.opsTasks.length===1&&!document.querySelector('#wfModal.open'));
 const saved=await page.evaluate(()=>JSON.parse(window.__disk));
 assert.equal(saved.opsTasks.length,1);assert.equal(saved.opsTasks[0].title,'Проверка программы');assert.ok(saved.auditLog.some(row=>row.section==='opsTasks'&&row.action==='create'));
});

test('rapid repeated record save is one write and navigation cannot redirect an open form',async()=>{
 await page.evaluate(()=>{switchSection('vehicles');selectedVehicleId='v';openEditRecord('r');});
 await page.locator('#rec_note').fill('Сохранить один раз');
 await page.keyboard.press('Control+k');
 assert.equal(await page.locator('#commandPalette.open').count(),0);
 await page.evaluate(()=>unifiedNavigate('generators'));
 assert.equal(await page.evaluate(()=>activeSection),'vehicles');
 await page.evaluate(async()=>{
  const original=window.electronAPI.writeData;window.electronAPI.writeData=async(...args)=>{await new Promise(resolve=>setTimeout(resolve,80));return original(...args);};
  await Promise.all([saveRecord(),saveRecord()]);
 });
 assert.equal(await page.evaluate(()=>window.__writes),1);
 assert.equal(await page.evaluate(()=>JSON.parse(window.__disk).records[0].note),'Сохранить один раз');
});

test('stock withdrawal checks available quantity before changing data',async()=>{
 const result=await page.evaluate(()=>{
  data.parts=[{id:'part',name:'Фильтр',unit:'шт'}];data.partMovements=[{id:'receipt',date:'2026-10-18',partId:'part',kind:'receipt',qty:2,reason:'Тест'}];
  let message='';try{wfValidate('partMovements',{id:'issue',date:'2026-10-18',partId:'part',kind:'issue',qty:3,reason:'Ремонт'},null);}catch(error){message=error.message;}
  return{message,stock:wfPartStock('part','2026-10-18'),rows:data.partMovements.length};
 });
 assert.match(result.message,/Недостаточно остатка/);assert.equal(result.stock,2);assert.equal(result.rows,1);
});

test('a merge conflict remains actionable during an active save and closes after the choice',async()=>{
 await page.evaluate(()=>{
  window.__mergeDone=false;
  const before=[{id:'v',driver:'До изменения'}],local=[{id:'v',driver:'Моя версия'}],remote=[{id:'v',driver:'На сервере'}];
  unifiedPendingSaves=1;
  window.__mergePromise=syncResolveMerge('vehicles',before,local,remote).then(value=>{window.__merged=value;window.__mergeDone=true;}).finally(()=>{unifiedPendingSaves=0;});
 });
 assert.deepEqual(await page.locator('#syncConflictForm select').evaluate(el=>Array.from(el.options,option=>option.value)),['','local','remote']);
 await page.locator('#syncConflictForm select').selectOption('local');
 await page.locator('#syncConflictForm button[type=submit],#syncConflictForm button:not([type])').click();
 await page.waitForFunction(()=>window.__mergeDone);
 assert.equal(await page.locator('#wfModal.open').count(),0);
 assert.equal(await page.evaluate(()=>window.__merged[0].driver),'Моя версия');
});

test('transport summary export remains visible and exports the chosen period at supported sizes',async()=>{
 await page.evaluate(()=>{
  toAutoSetupOnce=async()=>{};
  data.records.push({id:'outside-summary-period',vehicleId:'v',date:'2026-09-30',km:99,fuelActual:9.9,route:['OUTSIDE_SUMMARY_PERIOD']});
  rebuildIndex();
  window.__summaryBefore=JSON.stringify(data);window.__summaryDiskBefore=window.__disk;
  window.__summaryXlsx=null;window.__summaryPdf=null;
  XLSX.writeFile=(workbook,fileName)=>{window.__summaryXlsx={fileName,sheetNames:workbook.SheetNames.slice(),rows:XLSX.utils.sheet_to_json(workbook.Sheets['Общая сводка'],{header:1,defval:''})};};
  window.electronAPI.exportPdf=async(html,fileName)=>{window.__summaryPdf={html,fileName};return{ok:true};};
 });
 for(const width of [1280,960])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:width===960?700:900});
  await page.evaluate(theme=>applyTheme(theme),theme);
  // Re-entering the section and searching rebuild different parts of its DOM.
  await page.locator('#unifiedNav [data-section="reports"]').click();
  await page.locator('#unifiedNav [data-section="vehicles"]').click();
  await page.locator('#vcSearchInput').fill('ТЕСТ001');
  const button=page.locator('.vehicle-cards-toolbar').getByRole('button',{name:'Выгрузить сводку',exact:true});
  assert.equal(await button.isVisible(),true,`${width}/${theme}: summary trigger is visible`);
  assert.equal(await page.locator('#vehicleSummaryExportMenu').count(),1);
  for(const format of ['xls','pdf']){
   await page.evaluate(format=>{if(format==='xls')window.__summaryXlsx=null;else window.__summaryPdf=null;},format);
   await button.click();
   const menu=page.locator('#vehicleSummaryExportMenu');assert.equal(await menu.isVisible(),true);
   const bounds=await menu.boundingBox();
   assert.ok(bounds&&bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width&&bounds.y+bounds.height<=(width===960?700:900),`${width}/${theme}: summary menu fits the viewport`);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await menu.getByRole('button',{name:format==='xls'?'Сводка в XLS':'Сводка в PDF',exact:true}).click();
   const dialog=page.locator('#exportPeriodModal');assert.equal(await dialog.isVisible(),true);
   assert.match(await page.locator('#exportPeriodTitle').innerText(),format==='xls'?/Excel/:/PDF/);
   await page.locator('#ep_range').check();
   await page.locator('#ep_date_from').fill('01.10.2026');await page.locator('#ep_date_to').fill('31.10.2026');
   await dialog.getByRole('button',{name:'Выгрузить',exact:true}).click();
   if(format==='xls'){
    await page.waitForFunction(()=>!!window.__summaryXlsx);
    const exported=await page.evaluate(()=>window.__summaryXlsx);
    assert.deepEqual(exported.sheetNames,['Общая сводка']);
    assert.match(exported.rows[0][0],/ОБЩАЯ СВОДКА/);
    assert.match(exported.rows[1][0],/01\.10\.2026 — 31\.10\.2026/);
    assert.equal(exported.rows.find(row=>row[1]==='ТЕСТ001')[8],100);
    assert.equal(exported.rows.find(row=>row[0]==='Общий пробег, км')[4],100);
    assert.equal(exported.rows.find(row=>row[1]==='ИТОГО')[8],100);
    assert.equal(exported.rows.flat().includes('OUTSIDE_SUMMARY_PERIOD'),false);
    assert.match(exported.fileName,/^Сводка_все_ТС_.*_01102026-31102026\.xlsx$/);
   }else{
    await page.waitForFunction(()=>!!window.__summaryPdf);
    const exported=await page.evaluate(()=>{
     const result=window.__summaryPdf,doc=new DOMParser().parseFromString(result.html,'text/html');
     const vehicle=[...doc.querySelectorAll('tr')].find(row=>row.cells[1]?.textContent==='ТЕСТ001');
     const total=vehicle?.parentElement.querySelector('tr.tot');
     return{fileName:result.fileName,title:doc.querySelector('.doc-title')?.textContent,text:doc.body.textContent,plate:vehicle?.cells[1]?.textContent,km:vehicle?.cells[8]?.textContent,totalKm:total?.cells[1]?.textContent};
    });
    assert.match(exported.title,/ОБЩАЯ СВОДКА/);assert.match(exported.text,/01\.10\.2026 — 31\.10\.2026/);
    assert.equal(exported.plate,'ТЕСТ001');assert.equal(exported.km,'100');assert.equal(exported.totalKm,'100');
    assert.match(exported.fileName,/^Сводка_все_ТС_.*_01102026-31102026\.pdf$/);
   }
   assert.equal(await page.locator('.modal-overlay.open').count(),0);
   assert.equal(await page.locator('#vehicleSummaryExportMenu.open').count(),0);
   assert.deepEqual(await page.evaluate(()=>({same:JSON.stringify(data)===window.__summaryBefore,disk:window.__disk===window.__summaryDiskBefore,writes:window.__writes})),{same:true,disk:true,writes:0});
  }
 }
});

async function openGsmExtra(view){
 await page.locator('.gsm-workspace-menu > summary').click();
 await page.getByRole('combobox',{name:'Дополнительно',exact:true}).selectOption(view);
}

test('GSM write-off preserves the measured carry and exports its source without a phantom grade deficit',async()=>{
 await page.evaluate(()=>{
  Object.assign(data.vehicles[0],{fuelGrade:'АИ-100',fuel:'gasoline',fuelBalance:0,norm:10});
  data.records=[
   {id:'debt',vehicleId:'v',date:'2026-08-01',fuelGrade:'АИ-100',fuelActual:210.588,km:0},
   {id:'opening',vehicleId:'v',date:'2026-08-31',fuelGrade:'АИ-95',fuelIssued:256.15,fuelActual:0,tankMeasured:45.562,km:0},
   {id:'september',vehicleId:'v',date:'2026-09-30',fuelGrade:'АИ-95',fuelIssued:289.99,fuelUsed:318.3,km:2460}
  ];
  data.fuelPurchases=[
   {id:'august-buy',vehicleId:'v',recordId:'opening',date:'2026-08-31',grade:'АИ-95',qty:256.15,manual:true,sourceOrg:'ТВС'},
   {id:'september-buy',vehicleId:'v',recordId:'september',date:'2026-09-30',grade:'АИ-95',qty:289.99,manual:true,sourceOrg:'ТВС'}
  ];
  rebuildIndex();fpMonth='2026-09';fpView='writeoff';gsmOrg='';gsmFuel='';
  window.__gsmBefore=JSON.stringify(data);window.__gsmExport=null;
  XLSX.writeFile=(wb,fileName)=>{window.__gsmExport={fileName,sheets:wb.SheetNames.slice(),act:XLSX.utils.sheet_to_json(wb.Sheets['Акт списания ГСМ'],{header:1}),basis:XLSX.utils.sheet_to_json(wb.Sheets['Основание расхода'],{header:1})};};
 });
 for(const [width,theme] of [[1280,'light'],[960,'dark']]){
  await page.setViewportSize({width,height:width===960?700:900});await page.evaluate(theme=>applyTheme(theme),theme);
  await page.locator('#unifiedNav [data-section="fuelPurchases"]').click();
  await page.locator('[data-gsm-view="writeoff"]').click();
  await page.getByRole('combobox',{name:'Месяц',exact:true}).selectOption('2026-09');
  await page.locator('[data-gsm-act-step="4"]').click();
  const rows=page.locator('#fpBody tbody tr').filter({hasText:'ТЕСТ001'});
  assert.equal(await rows.count(),1);assert.match(await rows.innerText(),/17,252/);assert.doesNotMatch(await rows.innerText(),/-210/);
  await page.evaluate(()=>{window.__gsmExport=null;});
  await page.getByRole('button',{name:'Выгрузить черновик',exact:true}).click();
  const exported=await page.evaluate(()=>window.__gsmExport),act=exported.act.find(row=>typeof row[0]==='number');
  assert.equal(act[13],45.562);assert.equal(act[19],289.99);assert.equal(act[21],318.3);assert.equal(act[23],17.252);
  assert.ok(exported.sheets.includes('Основание расхода'));
  assert.equal(Math.round(exported.basis.filter(row=>row[6]==='Расчёт по норме').reduce((sum,row)=>sum+row[4],0)*1000)/1000,318.3);
  await page.getByRole('combobox',{name:'Месяц',exact:true}).selectOption('2026-08');
  await openGsmExtra('barrels');
  await page.locator('.gsm-barrel-reconciliation > summary').click();
  const reconciliation=page.getByRole('region',{name:'Сверка марок топлива'});
  assert.equal(await reconciliation.count(),1);assert.match(await reconciliation.innerText(),/\+210,588/);assert.match(await reconciliation.innerText(),/-210,588/);
  assert.match(await reconciliation.innerText(),/Заправка от 31\.08\.2026/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(await page.evaluate(()=>({same:JSON.stringify(data)===window.__gsmBefore,writes:window.__writes})),{same:true,writes:0});
 }
});

function barrelOverviewFixture(){
 const vehicle=(id,plate,org)=>({id,plate,make:'Synthetic',org,fuel:'gasoline',fuelGrade:'АИ-95',fuelBalance:0,norm:10});
 const record=(id,vehicleId,date,fuelGrade,fuelIssued,fuelActual)=>({id,vehicleId,date,fuelGrade,fuelIssued,fuelActual,km:0});
 const purchase=(id,recordId,vehicleId,date,grade,qty,cardNo,sourceOrg)=>({id,recordId,vehicleId,date,grade,qty,cardNo,...(sourceOrg?{sourceOrg}:{})});
 return{
  vehicles:[vehicle('stock-v','STOCK001','A'),vehicle('stock-w','OTHER002','B'),vehicle('stock-z','DEPLETED003','C'),vehicle('stock-measured','MEASURED004','D')],
  fuelCards:[{number:'111111',org:'A',provider:'Synthetic supplier A'},{number:'222222',org:'B',provider:'Synthetic supplier B'},{number:'333333',org:'C',provider:'Synthetic supplier C'}],
  records:[record('stock-debt','stock-v','2026-08-01','АИ-100',0,10),record('stock-fill','stock-v','2026-08-02','АИ-95',40,5),
   record('stock-other','stock-w','2026-08-03','АИ-95',30,10),record('stock-92','stock-v','2026-08-04','АИ-92',15,0),
   record('stock-unknown','stock-v','2026-08-05','АИ-95',6,0),record('stock-depleted','stock-z','2026-08-06','АИ-95',10,10),
   {...record('stock-measurement','stock-measured','2026-08-07','АИ-95',0,0),tankMeasured:5},
   record('stock-september','stock-w','2026-09-01','АИ-95',0,0)],
  fuelPurchases:[purchase('stock-purchase','stock-fill','stock-v','2026-08-02','АИ-95',40,'111111'),
   purchase('stock-other-purchase','stock-other','stock-w','2026-08-03','АИ-95',30,'222222'),
   purchase('stock-92-purchase','stock-92','stock-v','2026-08-04','АИ-92',15,'111111'),
   purchase('stock-unknown-purchase','stock-unknown','stock-v','2026-08-05','АИ-95',6,'','Организация не определена'),
   purchase('stock-unassigned',null,'','2026-08-05','АИ-95',7,'111111','A'),
   purchase('stock-missing-vehicle',null,'missing-vehicle','2026-08-05','АИ-95',9,'111111','A'),
   purchase('stock-depleted-purchase','stock-depleted','stock-z','2026-08-06','АИ-95',10,'333333')],
  monthlyFuel:[]
 };
}
async function loadBarrelOverviewFixture(){
 await page.evaluate(fixture=>{
  data={...data,...fixture};rebuildIndex();fpMonth='';
  window.__disk=JSON.stringify(data);window.__barrelBefore=window.__disk;window.__writes=0;_lastPersisted=window.__disk;
 },barrelOverviewFixture());
 await page.locator('#unifiedNav [data-section="fuelPurchases"]').click();
}

test('GSM opens the vehicle statement first and archived stock drill-down retains real movements and sources without writes',async()=>{
 await loadBarrelOverviewFixture();
 assert.deepEqual(await page.evaluate(()=>({view:fpView,month:fpMonth})),{view:'statement',month:'2026-09'});
 assert.equal(await page.locator('.gsm-nav .sec-tab').first().innerText(),'Ведомость по машинам');
 assert.equal(await page.locator('.gsm-nav .sec-tab.active').innerText(),'Ведомость по машинам');
 assert.equal(await page.locator('[data-gsm-statement="statement"]').count(),1);
 await openGsmExtra('barrels');
 await page.getByRole('combobox',{name:'Месяц',exact:true}).selectOption('2026-08');
 const barrel=page.locator('#gsmBarrelCards [data-org="A"][data-grade="АИ-95"]');
 assert.match(await barrel.locator('.gsm-barrel-value').innerText(),/25,000/);
 assert.match(await page.locator('#gsmBarrelCards [data-org="Организация не определена"][data-grade="АИ-95"] .gsm-barrel-value').innerText(),/6,000/);
 assert.match(await page.locator('#gsmUnassignedReceipts').innerText(),/16,000/);
 assert.equal(await page.locator('#gsmUnassignedReceipts tbody tr').count(),2);
 const stock=await page.evaluate(()=>{const ledger=gsmBuildLedger(data,{from:'2026-08-01',to:'2026-08-31'});return{total:ledger.barrels.reduce((sum,row)=>sum+row.end,0),a95:ledger.barrels.find(row=>row.org==='A'&&row.grade==='АИ-95').end};});
 assert.equal(stock.total,71);assert.equal(stock.a95,25);
 await barrel.click();
 assert.deepEqual(await page.evaluate(()=>({org:gsmOrg,grade:gsmFuel,month:fpMonth})),{org:'A',grade:'АИ-95',month:'2026-08'});
 assert.equal(await page.locator('#gsmBarrelVehicles [data-vehicle-id]').count(),1);
 assert.match(await page.locator('#gsmBarrelVehicles [data-vehicle-id="stock-v"]').innerText(),/STOCK001/);
 assert.match(await page.locator('#gsmBarrelVehicles [data-vehicle-id="stock-v"] td').last().innerText(),/25,000/);
 const movements=page.locator('#gsmBarrelMovements [data-movement-kind]');
 assert.equal(await movements.count(),3);
 await page.evaluate(()=>{window.__barrelSources=[];fpEdit=id=>window.__barrelSources.push('purchase:'+id);gsmEditRecord=id=>window.__barrelSources.push('record:'+id);});
 await page.getByRole('combobox',{name:'Вид операции',exact:true}).selectOption('receipt');
 assert.equal(await movements.count(),1);
 const search=page.getByRole('searchbox',{name:'Поиск операций',exact:true});
 await search.fill('supplier A');assert.equal(await movements.count(),1);
 await search.fill('no synthetic operation matches this');assert.equal(await movements.count(),0);
 await search.fill('');
 await page.locator('#gsmBarrelMovements').getByRole('button',{name:'Покупка',exact:true}).click();
 await page.getByRole('combobox',{name:'Вид операции',exact:true}).selectOption('consumption');
 assert.equal(await movements.count(),1);
 await movements.filter({hasText:/−5,000/}).getByRole('button',{name:'Журнал',exact:true}).click();
 await page.getByRole('combobox',{name:'Вид операции',exact:true}).selectOption('grade-reconciliation');
 assert.equal(await movements.count(),1);
 assert.match(await movements.innerText(),/АИ-95 → АИ-100/);
 await page.locator('#gsmBarrelMovements').getByRole('button',{name:'Расход',exact:true}).click();
 await page.getByRole('button',{name:'Все сводные остатки',exact:true}).click();
 await page.locator('#gsmBarrelCards [data-org="D"][data-grade="АИ-95"]').click();
 await page.getByRole('combobox',{name:'Вид операции',exact:true}).selectOption('measurement-correction');
 assert.equal(await movements.count(),1);
 assert.match(await movements.innerText(),/Корректировка по замеру/);assert.match(await movements.innerText(),/\+5,000/);
 await page.locator('#gsmBarrelMovements').getByRole('button',{name:'Журнал',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>window.__barrelSources),['purchase:stock-purchase','record:stock-fill','record:stock-debt','record:stock-measurement']);
 assert.deepEqual(await page.evaluate(()=>({same:JSON.stringify(data)===window.__barrelBefore,writes:window.__writes})),{same:true,writes:0});
});

test('barrel filters survive an empty month and stocks and operations fit 1280 light and 960 dark',async()=>{
 await loadBarrelOverviewFixture();
 for(const [width,theme]of[[1280,'light'],[960,'dark']]){
  await page.setViewportSize({width,height:width===960?700:900});await page.evaluate(theme=>applyTheme(theme),theme);
  await page.getByRole('combobox',{name:'Месяц',exact:true}).selectOption('2026-08');
  await openGsmExtra('barrels');
  await page.getByRole('button',{name:'Все сводные остатки',exact:true}).click();
  const geometry=await page.evaluate(()=>{const cards=document.getElementById('gsmBarrelCards').getBoundingClientRect();return{overflow:document.documentElement.scrollWidth>innerWidth,cardsInside:cards.left>=0&&cards.right<=innerWidth};});
  assert.deepEqual(geometry,{overflow:false,cardsInside:true});
  await page.locator('#gsmBarrelCards [data-org="C"][data-grade="АИ-95"]').click();
  await page.getByRole('combobox',{name:'Месяц',exact:true}).selectOption('2026-09');
  await openGsmExtra('barrels');
  assert.deepEqual(await page.evaluate(()=>({view:fpView,month:fpMonth,org:gsmOrg,grade:gsmFuel})),{view:'barrels',month:'2026-09',org:'C',grade:'АИ-95'});
  assert.equal(await page.getByRole('combobox',{name:'Организация',exact:true}).inputValue(),'C');
  assert.equal(await page.getByRole('combobox',{name:'Топливо',exact:true}).inputValue(),'АИ-95');
  assert.equal(await page.locator('#gsmBarrelCards [data-org]').count(),0);
  assert.equal(await page.locator('#gsmBarrelMovements [data-movement-kind]').count(),0);
  assert.match(await page.locator('#gsmBarrelCards').innerText(),/Выбор организации и топлива сохранён/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 }
 assert.deepEqual(await page.evaluate(()=>({same:JSON.stringify(data)===window.__barrelBefore,writes:window.__writes})),{same:true,writes:0});
});

async function loadGsmDiagnosticsFixture(controlledRoutes=false){
 await page.evaluate(async controlledRoutes=>{
  Object.assign(data,{
   vehicles:[{id:'diag-v',plate:'AUDIT001',make:'Synthetic vehicle',driver:'Synthetic driver',org:'Аудит A',fuel:'gasoline',fuelGrade:'АИ-95',fuelBalance:10,norm:10,
    fuelBalanceSources:[{org:'Аудит A',grade:'АИ-95',qty:10}],note:''},
    {id:'diag-invalid',plate:'AUDIT002',make:'Synthetic invalid source',driver:'Synthetic driver',org:'Аудит A',fuel:'gasoline',fuelGrade:'АИ-95',fuelBalance:0,norm:10},
    {id:'diag-confirmed',plate:'N260SYNTH',make:'Synthetic confirmed source',driver:'Synthetic driver',org:'Аудит A',fuel:'gasoline',fuelGrade:'АИ-95',fuelBalance:923.537}],
   records:[{id:'diag-august',vehicleId:'diag-v',date:'2026-08-01',km:0,fuelActual:40,fuelGrade:'АИ-95'},
    {id:'diag-record',vehicleId:'diag-v',date:'2026-09-01',km:50,fuelActual:5,fuelIssued:0,fuelGrade:'АИ-95',note:''},
    {id:'diag-negative',vehicleId:'diag-invalid',date:'2026-09-03',km:0,fuelActual:0,fuelIdle:-1,fuelGrade:'АИ-95'},
    {id:'diag-confirmed-measurement',vehicleId:'diag-confirmed',date:'2026-08-31',km:0,fuelActual:0,tankMeasured:923.537,fuelGrade:'АИ-95'}],
   fuelPurchases:[{id:'diag-purchase',vehicleId:'diag-v',recordId:'diag-record',date:'2026-09-01',qty:10.123,grade:'АИ-95',manual:true,sourceOrg:'Аудит A',cardNo:'111111'}],
   fuelCards:[{id:'diag-card',number:'111111',org:'Аудит A',provider:'Synthetic supplier',assignments:[{vehicleId:'diag-v',from:'',to:''}]}],
   monthlyFuel:[],fuelPeriods:[{month:'2026-08',closed:true,history:[]}]
  });
  rebuildIndex();fpMonth='2026-09';fpView='barrels';gsmOrg='Аудит A';gsmFuel='АИ-95';gsmDiagnosticsCategory='all';gsmDiagnosticsSearch='';gsmDiagnosticsLimit=30;
  if(controlledRoutes){
   window.__unsafeRefExecuted=false;
   gsmAuditModel=db=>({from:'2026-09-01',to:'2026-09-30',summary:{error:0,evidence:1,warning:0,total:1},items:[{
    id:'typed-routes',code:'synthetic-manual-source',category:'evidence',severity:'warning',title:'Сверить первичные документы',
    message:'Примечание: '+(db.vehicles.find(v=>v.id==='diag-v').note||'не заполнено'),whatToCheck:'Открыть исходную форму и проверить документ.',vehicleId:'diag-v',org:'Аудит A',grade:'АИ-95',observedDate:'2026-09-01',impact:{},sourceRefs:[],chronology:[],
    repairRefs:[{type:'purchase',id:'diag-purchase',label:'Открыть покупку'},
     {type:'record',id:'diag-record',label:'Открыть запись'},
     {type:'vehicle',id:'diag-v',vehicleId:'diag-v',label:'Открыть карточку ТС'},
     {type:'opening',id:'diag-v',vehicleId:'diag-v',label:'Открыть начальные источники'},
     {type:'card',id:'diag-card',cardNo:'111111',label:'Открыть карту'},
     {type:'period',id:'2026-08',month:'2026-08',label:'Открыть закрытый месяц'},
     {type:'receipts',month:'2026-09',label:'Открыть выписку'},
     {type:'monthly',month:'2026-09',label:'Открыть месячную сверку'},
     {type:'journal',id:'diag-v',vehicleId:'diag-v',date:'2026-08-01',label:'Открыть историю машины'},
     {type:'eval',id:'window.__unsafeRefExecuted=true',label:'Небезопасная команда'}]
   }]});
  }
  window.__writes=0;window.__disk=JSON.stringify(data);data=await syncLoad();window.__disk=JSON.stringify(data);window.__diagBefore=window.__disk;_lastPersisted=window.__disk;
 },controlledRoutes);
 await page.locator('#unifiedNav [data-section="fuelPurchases"]').click();
 await page.locator('[data-gsm-view="diagnostics"]').click();
}

test('GSM diagnostics shows source causes and keeps live search, scope and supported viewports read-only',async()=>{
 await loadGsmDiagnosticsFixture();
 const model=await page.evaluate(()=>({items:gsmDiagnosticsModel.items.map(item=>({category:item.category,earliest:item.earliestCauseDate,vehicleId:item.vehicleId,code:item.code,family:item.family,grade:item.grade})),source:JSON.stringify(data)===window.__diagBefore}));
 assert.equal(model.source,true);assert.ok(model.items.some(item=>item.category==='error'));assert.ok(model.items.some(item=>item.category==='warning'));
 assert.ok(model.items.some(item=>item.earliest&&item.earliest<'2026-09-01'));
 assert.equal(model.items.some(item=>item.vehicleId==='diag-confirmed'&&item.category==='error'&&/capacity|large|volume/.test(item.code)),false);
 assert.equal(await page.locator('#gsmBarrelCards').count(),0);
 assert.match(await page.locator('#gsmDiagnostics').innerText(),/Аудит A · АИ-95/);
 const familyCoverage=model.items.filter(item=>item.code==='ending-unmeasured'&&item.family==='gasoline'&&!item.grade);
 assert.ok(familyCoverage.length>0);
 assert.equal(await page.locator('.gsm-audit-item[data-audit-code="ending-unmeasured"]').count(),familyCoverage.length);
 for(const [width,theme]of[[1280,'light'],[960,'dark']]){
  await page.setViewportSize({width,height:width===960?700:900});await page.evaluate(theme=>applyTheme(theme),theme);
  await page.getByRole('combobox',{name:'Категория проверки',exact:true}).selectOption('all');
  const search=page.getByRole('searchbox',{name:'Поиск проверок ГСМ',exact:true});
  await search.fill('AUDIT001');await search.type(' ');
  assert.ok(await page.locator('.gsm-audit-item').count()>0);
  assert.equal(await search.evaluate(el=>document.activeElement===el),true);
  assert.equal(await search.inputValue(),'AUDIT001 ');
  await search.fill('no synthetic issue matches');assert.equal(await page.locator('.gsm-audit-item').count(),0);
  await search.fill('');
  await page.getByRole('combobox',{name:'Категория проверки',exact:true}).selectOption('warning');
  assert.equal(await page.locator('.gsm-audit-item:not([data-audit-category="warning"])').count(),0);
  await page.getByRole('combobox',{name:'Категория проверки',exact:true}).selectOption('all');
  const chronology=page.locator('.gsm-audit-chronology').first();await chronology.locator('summary').click();
  assert.ok(await chronology.locator('tbody tr').count()>0);
  assert.match(await page.locator('#gsmDiagnosticsResults').innerText(),/01\.08\.2026/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 }
 await page.locator('.gsm-audit-item[data-audit-code="negative-ending"]').filter({hasText:'AUDIT001'}).getByRole('button',{name:'История машины',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>({year:selectedYear,month:selectedMonth})),{year:2026,month:8});
 await page.locator('#unifiedNav [data-section="fuelPurchases"]').click();
 assert.deepEqual(await page.evaluate(()=>({same:JSON.stringify(data)===window.__diagBefore,writes:window.__writes,view:fpView,month:fpMonth,org:gsmOrg,grade:gsmFuel})),{same:true,writes:0,view:'diagnostics',month:'2026-09',org:'Аудит A',grade:'АИ-95'});
});

test('GSM diagnostic typed repair links open existing source forms and cancellation never changes data',async()=>{
 await loadGsmDiagnosticsFixture(true);
 assert.equal(await page.getByRole('button',{name:'Небезопасная команда',exact:true}).count(),0);
 const cases=[['Открыть покупку','genericModal'],['Открыть запись','recordModal'],['Открыть карточку ТС','vehicleModal'],['Открыть начальные источники','wfModal'],['Открыть карту','genericModal'],['Открыть закрытый месяц','wfModal']];
 for(const [label,modalId]of cases){
  await page.getByRole('button',{name:label,exact:true}).click();
  const modal=page.locator('#'+modalId);assert.equal(await modal.evaluate(el=>el.classList.contains('open')),true);
  if(label==='Открыть покупку')assert.equal(await page.locator('#fpe_qty').inputValue(),'10.123');
  if(label==='Открыть карту')assert.equal(await page.locator('#fc_move').isChecked(),false);
  if(label==='Открыть начальные источники'){assert.equal(await modal.locator('#fuelAccountingForm').count(),1);assert.equal(await modal.locator('[name="from"]').inputValue(),'');assert.equal(await modal.locator('[name="opening"]').inputValue(),'');}
  if(label==='Открыть закрытый месяц'){
   const form=modal.locator('#periodControlForm');assert.equal(await form.count(),1);assert.equal(await form.locator('[name="scope"]').inputValue(),'fuel');assert.equal(await form.locator('[name="month"]').inputValue(),'2026-08');assert.equal(await form.locator('[name="action"]').inputValue(),'reopen');await form.locator('[name="reason"]').fill('Synthetic cancelled period action');await form.locator('[data-period-cancel]').click();
  }else await modal.locator('.modal-header .icon-btn').click();
  await page.waitForFunction(()=>!document.querySelector('.modal-overlay.open'));
  assert.equal(await page.locator('#gsmDiagnostics').isVisible(),true);
  assert.deepEqual(await page.evaluate(()=>({same:JSON.stringify(data)===window.__diagBefore,writes:window.__writes})),{same:true,writes:0});
 }
 await page.getByRole('button',{name:'Открыть выписку',exact:true}).click();assert.equal(await page.locator('#gsmReceiptOperations').count(),1);
 await page.locator('[data-gsm-view="diagnostics"]').click();
 await page.getByRole('button',{name:'Открыть месячную сверку',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>({view:fpView,month:fpMonth})),{view:'monthly',month:'2026-09'});
 await page.locator('[data-gsm-view="diagnostics"]').click();
 await page.getByRole('button',{name:'Открыть историю машины',exact:true}).click();
 assert.equal(await page.evaluate(()=>activeSection),'vehicles');
 assert.deepEqual(await page.evaluate(()=>({year:selectedYear,month:selectedMonth})),{year:2026,month:8});
 await page.locator('#unifiedNav [data-section="fuelPurchases"]').click();assert.equal(await page.locator('#gsmDiagnostics').count(),1);
 assert.deepEqual(await page.evaluate(()=>({same:JSON.stringify(data)===window.__diagBefore,writes:window.__writes,unsafe:window.__unsafeRefExecuted})),{same:true,writes:0,unsafe:false});
});

test('an explicit vehicle form save returns to GSM diagnosis and refreshes evidence without changing fuel or mileage',async()=>{
 await loadGsmDiagnosticsFixture(true);
 await page.evaluate(()=>{selectedVehicleId='diag-v';window.__diagNumbers=JSON.stringify({records:data.records,purchases:data.fuelPurchases,balance:data.vehicles[0].fuelBalance,sources:data.vehicles[0].fuelBalanceSources});});
 await page.getByRole('button',{name:'Открыть карточку ТС',exact:true}).click();
 await page.locator('#vm_note').fill('Подтверждено синтетическим документом');
 await page.locator('#vehicleModal').getByRole('button',{name:'Сохранить',exact:true}).click();
 await page.waitForFunction(()=>document.getElementById('gsmDiagnostics')&&document.querySelector('#gsmDiagnosticsResults')?.innerText.includes('Подтверждено синтетическим документом'));
 assert.deepEqual(await page.evaluate(()=>({sameNumbers:JSON.stringify({records:data.records,purchases:data.fuelPurchases,balance:data.vehicles[0].fuelBalance,sources:data.vehicles[0].fuelBalanceSources})===window.__diagNumbers,writes:window.__writes,view:fpView,open:!!document.querySelector('.modal-overlay.open')})),{sameNumbers:true,writes:1,view:'diagnostics',open:false});
});

async function loadOrphanDiagnosticsFixture(){
 await loadGsmDiagnosticsFixture();
 await page.evaluate(async()=>{
  data.records.push({id:'diag-orphan',vehicleId:'missing-source-vehicle',date:'2026-09-12',km:123.4,kmGlonass:122.9,fuelGrade:'АИ-95',fuelIssued:12.345,fuelActual:null,fuelUsed:7.123,fuelIdle:0.111,tankMeasured:4.567,note:'Исходный документ'});
  data.fuelPurchases.push({id:'diag-orphan-purchase',recordId:'diag-orphan',vehicleId:'missing-source-vehicle',date:'2026-09-12',grade:'АИ-95',qty:12.345,manual:true,sourceOrg:'Аудит A'});
  window.__disk=JSON.stringify(data);data=await syncLoad();rebuildIndex();window.__diagOrphanBefore=JSON.stringify(data);window.__disk=window.__diagOrphanBefore;_lastPersisted=window.__disk;window.__writes=0;gsmOpenDiagnostics();
 });
}
async function previewOrphanLink(){
 await page.locator('.gsm-audit-item[data-audit-code="record-vehicle-missing"] [data-audit-ref="orphan-record"]').first().click();
 await page.locator('#gsm_orphan_vehicle').selectOption('diag-v');
 await page.locator('#gsm_orphan_reason').fill('Первичный документ: подтверждена машина AUDIT001');
 await page.locator('#gsmOrphanPreview').click();
 await page.locator('#gsmOrphanCommit').waitFor({state:'visible'});
}

test('orphan journal assignment previews an explicit manual link and preserves every quantity and related purchase',async()=>{
 await loadOrphanDiagnosticsFixture();
 await page.locator('.gsm-audit-item[data-audit-code="record-vehicle-missing"] [data-audit-ref="orphan-record"]').first().click();
 assert.equal(await page.locator('#gsm_orphan_vehicle').inputValue(),'');
 assert.match(await page.locator('#genericModal').innerText(),/Связанных покупок:\s*1/);
 await page.locator('#gsmOrphanPreview').click();assert.match(await page.locator('#gsmOrphanError').innerText(),/Выберите существующую машину/);
 await page.locator('#genericModal .modal-header .icon-btn').click();
 await previewOrphanLink();
 assert.deepEqual(await page.evaluate(()=>({same:JSON.stringify(data)===window.__diagOrphanBefore,writes:window.__writes})),{same:true,writes:0});
 await page.locator('#genericModal').getByRole('button',{name:'Отмена',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>({same:JSON.stringify(data)===window.__diagOrphanBefore,writes:window.__writes})),{same:true,writes:0});
 await previewOrphanLink();
 await page.evaluate(()=>{const original=saveData;saveData=async(d,options)=>{window.__orphanSaveOptions=options;return original(d,options);};});
 await page.locator('#gsmOrphanCommit').click();
 await page.waitForFunction(()=>!document.querySelector('.modal-overlay.open'));
 const result=await page.evaluate(()=>{
  const before=JSON.parse(window.__diagOrphanBefore),current=data.records.find(row=>row.id==='diag-orphan');
  return{record:current,expected:{...before.records.find(row=>row.id==='diag-orphan'),vehicleId:'diag-v'},purchasesSame:JSON.stringify(data.fuelPurchases)===JSON.stringify(before.fuelPurchases),writes:window.__writes,
   noMerge:window.__orphanSaveOptions.noMerge,reason:data.appMeta.find(row=>row.rowType==='gsm-record-vehicle-correction')?.reason,view:fpView};
 });
 assert.deepEqual(result.record,result.expected);assert.equal(result.purchasesSame,true);assert.equal(result.writes,1);assert.equal(result.noMerge,true);
 assert.match(result.reason,/Первичный документ/);assert.equal(result.view,'diagnostics');
});

test('orphan journal assignment rejects stale sources, changed database and closed months and rolls back failed saving',async()=>{
 await loadOrphanDiagnosticsFixture();
 const cancel=()=>page.locator('#genericModal .modal-header .icon-btn').click();
 await previewOrphanLink();
 await page.evaluate(()=>{data.records.find(row=>row.id==='diag-orphan').note='Изменено другим оператором';window.__orphanCurrent=JSON.stringify(data);});
 await page.locator('#gsmOrphanCommit').click();assert.match(await page.locator('#gsmOrphanError').innerText(),/Исходная запись уже изменена/);
 assert.deepEqual(await page.evaluate(()=>({same:JSON.stringify(data)===window.__orphanCurrent,writes:window.__writes})),{same:true,writes:0});await cancel();
 await previewOrphanLink();
 await page.evaluate(()=>{data.fuelPurchases.find(row=>row.id==='diag-orphan-purchase').qty=12.346;window.__orphanCurrent=JSON.stringify(data);});
 await page.locator('#gsmOrphanCommit').click();assert.match(await page.locator('#gsmOrphanError').innerText(),/связанные покупки уже изменены/);
 assert.deepEqual(await page.evaluate(()=>({same:JSON.stringify(data)===window.__orphanCurrent,writes:window.__writes})),{same:true,writes:0});await cancel();
 await page.evaluate(()=>{window.__orphanIdentity='synthetic-db-A';window.electronAPI.getDataIdentity=async()=>window.__orphanIdentity;});
 await previewOrphanLink();await page.evaluate(()=>{window.__orphanIdentity='synthetic-db-B';});
 await page.locator('#gsmOrphanCommit').click();assert.match(await page.locator('#gsmOrphanError').innerText(),/Открытая база изменилась/);
 assert.equal(await page.evaluate(()=>window.__writes),0);await cancel();
 await page.evaluate(()=>{window.__orphanIdentity='synthetic-db-A';window.__holdOrphanIdentity=false;window.electronAPI.getDataIdentity=async()=>window.__holdOrphanIdentity?new Promise(resolve=>window.__releaseOrphanIdentity=resolve):window.__orphanIdentity;});
 await previewOrphanLink();await page.evaluate(()=>{window.__holdOrphanIdentity=true;window.__orphanCurrent=JSON.stringify(data);});
 await page.locator('#gsmOrphanCommit').click();await cancel();
 await page.evaluate(()=>{window.__releaseOrphanIdentity('synthetic-db-A');});
 await page.waitForFunction(()=>!gsmOrphanSaving);
 assert.deepEqual(await page.evaluate(()=>({same:JSON.stringify(data)===window.__orphanCurrent,writes:window.__writes})),{same:true,writes:0});
 await page.evaluate(()=>{window.__holdOrphanIdentity=false;});
 await page.evaluate(()=>{window.__orphanIdentity='synthetic-db-A';});await previewOrphanLink();
 await page.evaluate(()=>{data.fuelPeriods.push({month:'2026-09',closed:true});window.__orphanCurrent=JSON.stringify(data);});
 await page.locator('#gsmOrphanCommit').click();
 assert.deepEqual(await page.evaluate(()=>({same:JSON.stringify(data)===window.__orphanCurrent,writes:window.__writes})),{same:true,writes:0});await cancel();
 await page.evaluate(async()=>{data.fuelPeriods=data.fuelPeriods.filter(row=>row.month!=='2026-09');window.__disk=JSON.stringify(data);data=await syncLoad();window.__orphanCurrent=JSON.stringify(data);window.__disk=window.__orphanCurrent;_lastPersisted=window.__orphanCurrent;window.__orphanDisk=window.__disk;});await previewOrphanLink();
 await page.evaluate(()=>{window.__reject=true;});
 await page.locator('#gsmOrphanCommit').click();assert.match(await page.locator('#gsmOrphanError').innerText(),/не записана/);
 assert.deepEqual(await page.evaluate(()=>({same:JSON.stringify(data)===window.__orphanCurrent,diskSame:window.__disk===window.__orphanDisk,writes:window.__writes})),{same:true,diskSame:true,writes:1});
 await cancel();
 for(const mode of['false','throw']){
  await previewOrphanLink();
  await page.evaluate(mode=>{
   const canonical=JSON.parse(JSON.stringify(data));canonical.records.find(row=>row.id==='diag-orphan').note='Каноническая версия '+mode;window.__orphanCanonical=JSON.stringify(canonical);
   saveData=async()=>{data=JSON.parse(window.__orphanCanonical);rebuildIndex();if(mode==='throw')throw Error('Synthetic canonical conflict');return false;};
  },mode);
  await page.locator('#gsmOrphanCommit').click();assert.match(await page.locator('#gsmOrphanError').innerText(),/База обновилась/);
  assert.deepEqual(await page.evaluate(()=>({same:JSON.stringify(data)===window.__orphanCanonical,writes:window.__writes})),{same:true,writes:1});
  await cancel();
 }
});
