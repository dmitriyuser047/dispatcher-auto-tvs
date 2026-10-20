const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{createRequire}=require('node:module');
let pw;try{pw=require('playwright');}catch{pw=createRequire(path.join(process.env.TVS_PLAYWRIGHT_MODULES||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),'package.json'))('playwright');}
let browser,page,errors;
const root=path.resolve(__dirname,'..');
before(async()=>{const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';browser=await pw.chromium.launch({headless:true,executablePath:process.env.TVS_TEST_BROWSER||(!process.env.CI&&fs.existsSync(edge)?edge:undefined)});});
after(async()=>{await browser?.close();});
beforeEach(async()=>{
 page=await browser.newPage({viewport:{width:1280,height:900}});errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.addInitScript(()=>{
  const db={vehicles:[{id:'v',plate:'ТЕСТ001',make:'Тест',org:'ТВС',fuel:'diesel',fuelGrade:'ДТ',norm:10}],records:[{id:'r',vehicleId:'v',date:'2026-10-18',km:100,fuelActual:10}],generators:[],genRecords:[],drivers:[{id:'d',name:'Тестовый водитель',skills:'C'}],tanks:[],parts:[],appMeta:[{id:'meta',toPlanInit:'test'}]};
  window.__disk=JSON.stringify(db);window.__writes=0;window.__reject=false;
  window.electronAPI={readData:async()=>window.__disk,writeData:async text=>{window.__writes++;if(window.__reject)return false;const value=JSON.parse(text);window.__disk=JSON.stringify(value.databaseToken?value.data:value);return true;}};
 });
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
 await page.evaluate(()=>{wfOpenTab('dispatchJobs');wfEdit('dispatchJobs');});
 async function fill(title,start,end){await page.locator('#wf_title').fill(title);await page.locator('#wf_site').fill('Тестовый участок');await page.locator('#wf_status').selectOption('assigned');await page.locator('#wf_assetRef').selectOption('v:v');await page.locator('#wf_driverId').selectOption('d');await page.locator('#wf_start').fill(start);await page.locator('#wf_end').fill(end);}
 await fill('Первая заявка','2026-10-19T07:00','2026-10-19T09:00');
 await page.locator('#wfForm button[type=submit]').click();
 await page.waitForFunction(()=>data.dispatchJobs.length===1&&!document.querySelector('#wfModal.open'));
 await page.evaluate(()=>wfEdit('dispatchJobs'));
 await fill('Конфликт','2026-10-19T08:00','2026-10-19T10:00');
 await page.locator('#wfForm button[type=submit]').click();
 await page.waitForFunction(()=>document.getElementById('wfError').textContent.includes('Техника занята'));
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
  await page.getByRole('button',{name:'Списание',exact:true}).click();
  await page.getByRole('combobox',{name:'Месяц',exact:true}).selectOption('2026-09');
  const rows=page.locator('#fpBody tbody tr').filter({hasText:'ТЕСТ001'});
  assert.equal(await rows.count(),1);assert.match(await rows.innerText(),/17,252/);assert.doesNotMatch(await rows.innerText(),/-210/);
  await page.evaluate(()=>{window.__gsmExport=null;});
  await page.getByRole('button',{name:'Выгрузить акт',exact:true}).click();
  const exported=await page.evaluate(()=>window.__gsmExport),act=exported.act.find(row=>typeof row[0]==='number');
  assert.equal(act[13],45.56);assert.equal(act[19],289.99);assert.equal(act[21],318.3);assert.equal(act[23],17.25);
  assert.ok(exported.sheets.includes('Основание расхода'));
  assert.equal(Math.round(exported.basis.filter(row=>row[6]==='Расчёт по норме').reduce((sum,row)=>sum+row[4],0)*1000)/1000,318.3);
  await page.getByRole('combobox',{name:'Месяц',exact:true}).selectOption('2026-08');
  const reconciliation=page.getByRole('region',{name:'Сверка марок топлива'});
  assert.equal(await reconciliation.count(),1);assert.match(await reconciliation.innerText(),/\+210,588/);assert.match(await reconciliation.innerText(),/-210,588/);
  assert.match(await reconciliation.innerText(),/Заправка от 31\.08\.2026/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(await page.evaluate(()=>({same:JSON.stringify(data)===window.__gsmBefore,writes:window.__writes})),{same:true,writes:0});
 }
});
