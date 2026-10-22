const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{createRequire}=require('node:module');
const commands=require('../assets/core/platform-commands.js');
let pw;try{pw=require('playwright');}catch{pw=createRequire(path.join(process.env.TVS_PLAYWRIGHT_MODULES||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),'package.json'))('playwright');}
let browser,page,errors;
before(async()=>{const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';browser=await pw.chromium.launch({headless:true,executablePath:process.env.TVS_TEST_BROWSER||(!process.env.CI&&fs.existsSync(edge)?edge:undefined)});});
after(async()=>{await browser?.close();});
beforeEach(async()=>{
 page=await browser.newPage({viewport:{width:1280,height:900}});errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await page.exposeFunction('__planPersonnelCommand',request=>commands.plan(request.data,request.command,{id:request.id,now:'2026-10-22T12:00:00.000Z',today:'2026-10-22',actor:{id:'synthetic-personnel-user',name:'Synthetic personnel user',role:'admin'}}));
 await page.addInitScript(()=>{
  const seed={
   vehicles:[{id:'personnel-v',plate:'SYNTHETIC-001',make:'Тестовый автомобиль',org:'Тестовая организация',fuelGrade:'ДТ',norm:10}],
   generators:[{id:'personnel-g',name:'SYNTHETIC-ДЭС',org:'Тестовая организация',norm:2}],
   drivers:[
    {id:'legacy-driver',name:'Старый водитель',phone:'+70000000001',skills:'B, C',org:'Тестовая организация'},
    {id:'explicit-driver',name:'Новый водитель',personnelRoles:['driver']},
    {id:'explicit-operator',name:'Оператор Иванов',personnelRoles:['operator'],skills:'ДЭС'},
    {id:'dual-person',name:'Совмещающий сотрудник',personnelRoles:['driver','operator']},
    {id:'archived-person',name:'Архивный водитель',personnelRoles:['driver'],archived:true},
    {id:712,name:'Водитель со старым числовым ID',skills:'C'}
   ],
   assetAssignments:[{id:'past-assignment',assetRef:'v:personnel-v',driverId:'legacy-driver',from:'2026-08-01',to:'2026-08-31',site:'Старый объект',reason:'Старое назначение'}],
   assetDocuments:[{id:'personnel-document',driverId:'legacy-driver',title:'Водительское удостоверение',number:'SYNTHETIC-ДОК',date:'2026-01-01',expires:'2026-12-31',mandatory:true}],
   fuelCards:[{id:'fc_cash',number:'НАЛИЧКА',provider:'Наличка',assignments:[]}],
   appMeta:[{id:'meta',toPlanInit:'test'}]
  };
  window.__disk=JSON.stringify(seed);window.__writes=0;window.__reject=false;window.__token='personnel-synthetic-db';window.__revisions={};window.__scriptExecuted=false;
  window.electronAPI={readSnapshot:async()=>{
   const db=JSON.parse(window.__disk);for(const name of PlatformSchema.sections){db[name]??=[];window.__revisions[name]??=1;}window.__disk=JSON.stringify(db);
   return JSON.stringify({data:db,revisions:{...window.__revisions},databaseToken:window.__token,platform:{apiVersion:1,operations:1,outbox:1,commands:1,schemaVersion:2,documentDrafts:1}});
  },writeSections:async raw=>{
   window.__writes++;if(window.__reject)return{ok:false,error:'Synthetic personnel save failure'};
   const request=JSON.parse(raw),db=JSON.parse(window.__disk);
   for(const [name,rows]of Object.entries(request.sections)){db[name]=rows;window.__revisions[name]++;}
   window.__disk=JSON.stringify(db);return{ok:true,revisions:{...window.__revisions},databaseToken:request.databaseToken,canonicalSections:request.sections,operationReceipt:{id:request.operation?.id,status:'committed'}};
  },executeCommand:async raw=>{
   window.__writes++;if(window.__reject)return{ok:false,error:'Synthetic personnel command failure'};
   const request=JSON.parse(raw),db=JSON.parse(window.__disk),planned=await window.__planPersonnelCommand({data:db,command:request.command,id:request.operation.id});
   const canonical={...planned.sections,auditLog:db.auditLog};for(const[name,rows]of Object.entries(canonical)){db[name]=rows;window.__revisions[name]++;}
   window.__disk=JSON.stringify(db);return{ok:true,databaseToken:request.databaseToken,revisions:{...window.__revisions},canonicalSections:canonical,operationReceipt:{id:request.operation.id,digest:request.operation.digest,status:'committed'}};
  }};
 });
 await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);
 await page.waitForFunction(()=>typeof renderPersonnelSection==='function'&&typeof data!=='undefined'&&data.vehicles[0]?.id==='personnel-v');
});
afterEach(async()=>{await page?.close();assert.deepEqual(errors,[]);});

async function openSection(section){await page.locator('#unifiedNav [data-section="'+section+'"]').click();await page.waitForFunction(section=>activeSection===section,section);}
async function openPerson(id){await page.evaluate(id=>personnelOpenPerson(id),id);}
async function submitPerson(){await page.locator('#personnelForm [type="submit"]').click();await page.waitForFunction(()=>!document.querySelector('#personnelForm')?.closest('.modal-overlay')?.classList.contains('open'));}
async function fillAssignment(assetRef,from,site='Новый объект'){
 const form=page.locator('#personnelAssignmentForm');await form.locator('[name="assetRef"]').selectOption(assetRef);await form.locator('[name="from"]').fill(from);await form.locator('[name="site"]').fill(site);await form.locator('[name="reason"]').fill('Тестовое назначение по приказу');
}
async function submitAssignment(){await page.locator('#personnelAssignmentForm [type="submit"]').click();await page.waitForFunction(()=>!document.querySelector('#personnelAssignmentForm')?.closest('.modal-overlay')?.classList.contains('open'));}

test('drivers and generator operators have separate navigation, legacy compatibility and no read-time writes',async()=>{
 const before=await page.evaluate(()=>JSON.stringify(data));
 for(const [width,theme]of [[1280,'light'],[960,'dark']]){
  await page.setViewportSize({width,height:900});await page.evaluate(theme=>applyTheme(theme),theme);
  await openSection('drivers');let text=await page.locator('#mainContent').innerText();assert.match(text,/Старый водитель/);assert.match(text,/Новый водитель/);assert.match(text,/Совмещающий сотрудник/);assert.doesNotMatch(text,/Оператор Иванов|Архивный водитель/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.resolve(__dirname,width===1280?'../audit/personnel-drivers-preview.png':'../audit/personnel-drivers-960-dark-preview.png'),fullPage:false});
  await openSection('operators');text=await page.locator('#mainContent').innerText();assert.match(text,/Оператор Иванов/);assert.match(text,/Совмещающий сотрудник/);assert.doesNotMatch(text,/Старый водитель|Новый водитель|Архивный водитель/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.resolve(__dirname,width===1280?'../audit/personnel-operators-preview.png':'../audit/personnel-operators-960-dark-preview.png'),fullPage:false});
 }
 assert.equal(await page.evaluate(()=>JSON.stringify(data)),before);assert.equal(await page.evaluate(()=>window.__writes),0);
});

test('creating personnel stores explicit roles and the relevant licence or operator certificate',async()=>{
 await openSection('operators');await page.locator('[data-personnel-action="new"]').click();let form=page.locator('#personnelForm');
 assert.equal(await form.locator('[name="personnelRoles"][value="operator"]').isChecked(),true);
 assert.equal(await form.locator('[name="personnelRoles"][value="driver"]').isChecked(),false);
 await form.locator('[name="name"]').fill('Новый оператор Петров');await form.locator('[name="phone"]').fill('+70000000002');await form.locator('[name="org"]').fill('Тестовая организация');await form.locator('[name="certificateNumber"]').fill('ДЭС-TEST-123');await form.locator('[name="certificateExpires"]').fill('2027-12-31');await submitPerson();
 await openSection('drivers');await page.locator('[data-personnel-action="new"]').click();form=page.locator('#personnelForm');assert.equal(await form.locator('[name="personnelRoles"][value="driver"]').isChecked(),true);
 await form.locator('[name="name"]').fill('Новый водитель Сидоров');await form.locator('[name="driverLicenseNumber"]').fill('ВУ-TEST-456');await form.locator('[name="driverLicenseExpires"]').fill('2028-01-01');await form.locator('[name="skills"]').fill('B, C, CE');await submitPerson();
 const result=await page.evaluate(()=>({operator:data.drivers.find(row=>row.name==='Новый оператор Петров'),driver:data.drivers.find(row=>row.name==='Новый водитель Сидоров'),writes:window.__writes}));
 assert.deepEqual(result.operator.personnelRoles,['operator']);assert.equal(result.operator.certificateNumber,'ДЭС-TEST-123');assert.equal(result.operator.certificateExpires,'2027-12-31');assert.deepEqual(result.driver.personnelRoles,['driver']);assert.equal(result.driver.driverLicenseNumber,'ВУ-TEST-456');assert.equal(result.driver.skills,'B, C, CE');assert.equal(result.writes,2);
});

test('editing and archiving a person preserves linked documents and assignment history',async()=>{
 await openSection('drivers');const historical=await page.evaluate(()=>({assignments:JSON.stringify(data.assetAssignments),documents:JSON.stringify(data.assetDocuments)}));await openPerson('legacy-driver');await page.locator('[data-personnel-action="edit"]').click();await page.locator('#personnelForm [name="phone"]').fill('+79999999999');await page.locator('#personnelForm [name="employmentStatus"]').selectOption('vacation');await submitPerson();
 assert.equal(await page.evaluate(()=>data.drivers.find(row=>row.id==='legacy-driver').phone),'+79999999999');await page.locator('[data-personnel-action="archive"]').click();
 if(await page.locator('#confirmYes').isVisible().catch(()=>false))await page.locator('#confirmYes').click();
 await page.waitForFunction(()=>data.drivers.find(row=>row.id==='legacy-driver').archived===true);
 assert.deepEqual(await page.evaluate(()=>({assignments:JSON.stringify(data.assetAssignments),documents:JSON.stringify(data.assetDocuments)})),historical);
 await page.locator('[data-personnel-action="list"]').click();assert.doesNotMatch(await page.locator('#mainContent').innerText(),/Старый водитель/);await page.locator('#personnelArchived').check();assert.match(await page.locator('#mainContent').innerText(),/Старый водитель/);
});

test('dated assignments restrict assets by profession and keep previous periods intact',async()=>{
 const historical=await page.evaluate(()=>JSON.stringify(data.assetAssignments[0]));await openSection('drivers');await page.evaluate(()=>personnelEditAssignment('legacy-driver'));let form=page.locator('#personnelAssignmentForm');let options=await form.locator('[name="assetRef"] option').evaluateAll(rows=>rows.map(row=>row.value));assert.ok(options.includes('v:personnel-v'));assert.equal(options.includes('g:personnel-g'),false);
 await fillAssignment('v:personnel-v','2026-10-01');await submitAssignment();
 await openSection('operators');await page.evaluate(()=>personnelEditAssignment('explicit-operator'));form=page.locator('#personnelAssignmentForm');options=await form.locator('[name="assetRef"] option').evaluateAll(rows=>rows.map(row=>row.value));assert.ok(options.includes('g:personnel-g'));assert.equal(options.includes('v:personnel-v'),false);await fillAssignment('g:personnel-g','2026-10-01','Площадка ДЭС');await submitAssignment();
 const result=await page.evaluate(()=>({historical:JSON.stringify(data.assetAssignments.find(row=>row.id==='past-assignment')),current:data.assetAssignments.filter(row=>row.id!=='past-assignment'),writes:window.__writes}));assert.equal(result.historical,historical);assert.equal(result.current.length,2);assert.equal(result.current.find(row=>row.driverId==='explicit-operator').assetRef,'g:personnel-g');assert.equal(result.current.find(row=>row.driverId==='legacy-driver').from,'2026-10-01');assert.equal(result.writes,2);
});

test('the shared kernel rejects a forged assignment for the wrong personnel role',async()=>{
 const result=await page.evaluate(async()=>{
  const original=data.assetAssignments.length;data.assetAssignments.push({id:'wrong-operator-assignment',driverId:'explicit-operator',assetRef:'v:personnel-v',from:'2026-10-01',site:'Тест',reason:'Тест'});const operator=await saveData(data);const afterOperator=data.assetAssignments.length;
  data.assetAssignments.push({id:'wrong-driver-assignment',driverId:'explicit-driver',assetRef:'g:personnel-g',from:'2026-10-01',site:'Тест',reason:'Тест'});const driver=await saveData(data);return{operator,driver,afterOperator,afterDriver:data.assetAssignments.length,original,writes:window.__writes};
 });
 assert.deepEqual(result,{operator:false,driver:false,afterOperator:1,afterDriver:1,original:1,writes:0});
});

test('legacy numeric personnel ids keep their identity when edited and assigned',async()=>{
 await openSection('drivers');await openPerson(712);await page.locator('[data-personnel-action="edit"]').click();await page.locator('#personnelForm [name="phone"]').fill('+70000000712');await submitPerson();
 await page.evaluate(()=>personnelEditAssignment(712));await fillAssignment('v:personnel-v','2026-10-01');await submitAssignment();
 const result=await page.evaluate(()=>({person:data.drivers.find(row=>row.id===712),assignment:data.assetAssignments.find(row=>row.driverId===712),stringDuplicate:data.drivers.some(row=>row.id==='712')}));assert.equal(result.person.phone,'+70000000712');assert.equal(result.stringDuplicate,false);assert.equal(result.assignment?.assetRef,'v:personnel-v');assert.equal(result.assignment?.driverId,712);
});

test('personnel documents stay linked and can be added while the employee is on vacation',async()=>{
 await page.evaluate(()=>{data.drivers.find(row=>row.id==='explicit-operator').employmentStatus='vacation';});
 await openSection('operators');await openPerson('explicit-operator');await page.locator('[data-personnel-action="document"]').click();const form=page.locator('#wfForm');assert.equal(await form.locator('[name="driverId"]').inputValue(),'explicit-operator');await form.locator('[name="title"]').fill('Удостоверение оператора ДЭС');await form.locator('[name="number"]').fill('TEST-ДЭС-2026');await form.locator('[name="date"]').fill('2026-10-01');await form.locator('[name="expires"]').fill('2027-10-01');await form.locator('[type="submit"]').click();await page.waitForFunction(()=>data.assetDocuments.some(row=>row.number==='TEST-ДЭС-2026'));
 assert.equal(await page.evaluate(()=>data.assetDocuments.find(row=>row.number==='TEST-ДЭС-2026').driverId),'explicit-operator');assert.equal(await page.evaluate(()=>data.assetDocuments.find(row=>row.id==='personnel-document').driverId),'legacy-driver');assert.match(await page.locator('.personnel-document-grid').innerText(),/Удостоверение оператора ДЭС[\s\S]*TEST-ДЭС-2026/);
});

test('future assignments prevent archiving or role removal while vacation retains the assignment with a warning',async()=>{
 assert.equal(await page.evaluate(async()=>{data.assetAssignments.push({id:'future-assignment',assetRef:'v:personnel-v',driverId:'explicit-driver',from:'2099-01-01',site:'Будущий объект',reason:'Будущий приказ'});return saveData(data);}),true);
 await openSection('drivers');await openPerson('explicit-driver');await page.locator('[data-personnel-action="archive"]').click();assert.match(await page.locator('#globalToast').innerText(),/завершите|переназначьте/);assert.equal(await page.locator('#confirmModal.open').count(),0);assert.equal(await page.evaluate(()=>window.__writes),1);
 const forged=await page.evaluate(async()=>{data.drivers.find(row=>row.id==='explicit-driver').archived=true;const saved=await saveData(data);return{saved,archived:!!data.drivers.find(row=>row.id==='explicit-driver').archived,writes:window.__writes};});assert.deepEqual(forged,{saved:false,archived:false,writes:1});
 await page.locator('[data-personnel-action="edit"]').click();const form=page.locator('#personnelForm');await form.locator('[name="personnelRoles"][value="operator"]').check();await form.locator('[name="personnelRoles"][value="driver"]').uncheck();await form.locator('[name="note"]').fill('Правки должны остаться в форме');await form.locator('[type="submit"]').click();await page.waitForFunction(()=>!!document.querySelector('#personnelError')?.textContent.trim());assert.match(await page.locator('#personnelError').innerText(),/Нельзя снять роль/);assert.equal(await form.locator('[name="note"]').inputValue(),'Правки должны остаться в форме');assert.equal(await form.locator('[name="personnelRoles"][value="operator"]').isChecked(),true);assert.deepEqual(await page.evaluate(()=>data.drivers.find(row=>row.id==='explicit-driver').personnelRoles),['driver']);assert.equal(await page.evaluate(()=>window.__writes),1);
 await form.locator('[name="personnelRoles"][value="driver"]').check();await form.locator('[name="personnelRoles"][value="operator"]').uncheck();await form.locator('[name="employmentStatus"]').selectOption('vacation');await submitPerson();assert.match(await page.locator('#mainContent .personnel-notice').innerText(),/Проверьте назначения сотрудника/);assert.equal(await page.evaluate(()=>data.drivers.find(row=>row.id==='explicit-driver').employmentStatus),'vacation');assert.equal(await page.evaluate(()=>data.assetAssignments.find(row=>row.id==='future-assignment').from),'2099-01-01');assert.equal(await page.evaluate(()=>window.__writes),2);
});

test('a viewer opens document files without access to adding or changing attachments',async()=>{
 await page.evaluate(()=>{data.assetDocuments[0].attachments=[{id:'synthetic-attachment',name:'Удостоверение.pdf',size:2048}];data.assetAssignments.push({id:'viewer-future-assignment',driverId:'legacy-driver',assetRef:'v:personnel-v',from:'2099-01-01',site:'Будущий объект',reason:'Приказ'});window.__openedAttachments=[];window.electronAPI.openAttachment=async id=>{window.__openedAttachments.push(id);return{ok:true};};_sync.access={user:{id:'viewer',name:'Наблюдатель',role:'viewer'},readable:PlatformSchema.sections.slice(),writable:[]};});
 await openSection('drivers');await openPerson('legacy-driver');assert.equal(await page.locator('[data-personnel-action="cancel-assignment"]').count(),0);await page.locator('[data-personnel-action="document-files"]').click();const modal=page.locator('#wfModal.open');assert.match(await modal.innerText(),/Удостоверение.pdf/);assert.equal(await modal.locator('#wfAddFile').count(),0);assert.doesNotMatch(await modal.innerText(),/Добавить файл/);await modal.locator('[data-personnel-file="0"]').click();assert.deepEqual(await page.evaluate(()=>window.__openedAttachments),['synthetic-attachment']);assert.equal(await page.evaluate(()=>window.__writes),0);
});

test('an incomplete legacy assignment can be finished by filling missing details while retaining its original links and start',async()=>{
 assert.equal(await page.evaluate(async()=>{data.assetAssignments.push({id:'incomplete-assignment',assetRef:'v:personnel-v',driverId:'legacy-driver',from:'2026-09-01'});return saveData(data);}),true);
 await openSection('drivers');await page.evaluate(()=>personnelEditAssignment('legacy-driver','incomplete-assignment'));const form=page.locator('#personnelAssignmentForm');assert.equal(await form.locator('[name="from"]').getAttribute('readonly'),'');assert.equal(await form.locator('[name="assetRef"]').isDisabled(),true);assert.equal(await form.locator('[name="site"]').isEditable(),true);assert.equal(await form.locator('[name="reason"]').isEditable(),true);await form.locator('[name="site"]').fill('Уточнённый объект');await form.locator('[name="reason"]').fill('Уточнение по исходному приказу');await form.locator('[name="to"]').fill('2026-09-30');await submitAssignment();
 const result=await page.evaluate(()=>data.assetAssignments.find(row=>row.id==='incomplete-assignment'));assert.equal(result.from,'2026-09-01');assert.equal(result.to,'2026-09-30');assert.equal(result.driverId,'legacy-driver');assert.equal(result.assetRef,'v:personnel-v');assert.equal(result.site,'Уточнённый объект');assert.equal(result.reason,'Уточнение по исходному приказу');assert.equal(await page.evaluate(()=>window.__writes),2);
});

test('cancelling a future assignment preserves its source and cancellation reason and then allows personnel archiving',async()=>{
 const original={id:'cancel-future-assignment',assetRef:'v:personnel-v',driverId:'explicit-driver',from:'2099-01-01',site:'Запланированный объект',org:'Тестовая организация',reason:'Исходное основание назначения'};assert.equal(await page.evaluate(async row=>{data.assetAssignments.push(row);return saveData(data);},original),true);
 await openSection('drivers');await openPerson('explicit-driver');await page.locator('[data-personnel-action="cancel-assignment"]').click();const form=page.locator('#personnelCancelAssignmentForm');await form.locator('[name="reason"]').fill('Изменение плана работ по приказу');await form.locator('[type="submit"]').click();await page.waitForFunction(()=>data.assetAssignments.find(row=>row.id==='cancel-future-assignment').archived===true&&!document.querySelector('#personnelCancelAssignmentForm')?.closest('.modal-overlay')?.classList.contains('open'));
 const cancelled=await page.evaluate(()=>data.assetAssignments.find(row=>row.id==='cancel-future-assignment'));for(const[key,value]of Object.entries(original))assert.deepEqual(cancelled[key],value);assert.equal(cancelled.cancellationReason,'Изменение плана работ по приказу');assert.equal(cancelled.archived,true);assert.equal(Number.isFinite(new Date(cancelled.archivedAt).getTime()),true);assert.equal(await page.evaluate(()=>data.assetAssignments.filter(row=>row.id==='cancel-future-assignment').length),1);assert.match(await page.locator('#mainContent').innerText(),/Изменение плана работ по приказу/);
 await page.locator('[data-personnel-action="archive"]').click();await page.locator('#confirmYes').click();await page.waitForFunction(()=>data.drivers.find(row=>row.id==='explicit-driver').archived===true);assert.equal(await page.evaluate(()=>data.assetAssignments.find(row=>row.id==='cancel-future-assignment').cancellationReason),'Изменение плана работ по приказу');assert.equal(await page.evaluate(()=>window.__writes),3);
});

test('vehicle and generator cards link to the currently assigned personnel without saving on navigation',async()=>{
 assert.equal(await page.evaluate(async()=>{const from=wfToday();data.assetAssignments.push({id:'current-driver-assignment',assetRef:'v:personnel-v',driverId:'explicit-driver',from,site:'Тест',reason:'Текущий приказ'},{id:'current-operator-assignment',assetRef:'g:personnel-g',driverId:'explicit-operator',from,site:'Тест',reason:'Текущий приказ'});return saveData(data);}),true);
 await openSection('vehicles');await page.evaluate(()=>selectVehicle('personnel-v'));await page.locator('.personnel-asset-people button[aria-label="Открыть карточку: Новый водитель"]').click();assert.equal(await page.evaluate(()=>activeSection),'drivers');assert.match(await page.locator('#mainContent h2').innerText(),/Новый водитель/);
 await openSection('generators');await page.evaluate(()=>selectGenerator('personnel-g'));await page.locator('.personnel-asset-people button[aria-label="Открыть карточку: Оператор Иванов"]').click();assert.equal(await page.evaluate(()=>activeSection),'operators');assert.match(await page.locator('#mainContent h2').innerText(),/Оператор Иванов/);assert.equal(await page.evaluate(()=>window.__writes),1);
});

test('assignment, dispatch and shift forms update the personnel list when the asset type changes',async()=>{
 for(const section of ['assetAssignments','dispatchJobs','shiftReports']){
  await page.evaluate(section=>wfEdit(section),section);await page.locator('#wf_assetRef').selectOption('v:personnel-v');let options=await page.locator('#wf_driverId option').evaluateAll(rows=>rows.map(row=>row.value));assert.ok(options.includes('legacy-driver'));assert.ok(options.includes('dual-person'));assert.equal(options.includes('explicit-operator'),false);assert.equal(options.includes('archived-person'),false);assert.match(await page.locator('#wf_driverId').locator('..').innerText(),/Водитель/);
  await page.locator('#wf_driverId').selectOption('legacy-driver');await page.locator('#wf_assetRef').selectOption('g:personnel-g');options=await page.locator('#wf_driverId option').evaluateAll(rows=>rows.map(row=>row.value));assert.ok(options.includes('explicit-operator'));assert.ok(options.includes('dual-person'));assert.equal(options.includes('legacy-driver'),false);assert.equal(await page.locator('#wf_driverId').inputValue(),'');assert.match(await page.locator('#wf_driverId').locator('..').innerText(),/Оператор ДЭС/);
 }
 assert.equal(await page.evaluate(()=>window.__writes),0);
});

test('a failed personnel save retains the entered form and retries without losing changes',async()=>{
 await openSection('operators');await page.locator('[data-personnel-action="new"]').click();const form=page.locator('#personnelForm');await form.locator('[name="name"]').fill('Оператор после повтора');await form.locator('[name="note"]').fill('Введённое примечание должно остаться');await page.evaluate(()=>{window.__reject=true;});await form.locator('[type="submit"]').click();await page.waitForFunction(()=>!!document.querySelector('#personnelError')?.textContent.trim());
 assert.equal(await form.locator('[name="name"]').inputValue(),'Оператор после повтора');assert.equal(await form.locator('[name="note"]').inputValue(),'Введённое примечание должно остаться');assert.equal(await page.evaluate(()=>data.drivers.some(row=>row.name==='Оператор после повтора')),false);assert.equal(await form.locator('[type="submit"]').isDisabled(),false);
 await page.evaluate(()=>{window.__reject=false;});await submitPerson();assert.equal(await page.evaluate(()=>data.drivers.filter(row=>row.name==='Оператор после повтора').length),1);assert.equal(await page.evaluate(()=>window.__writes),2);
});

test('viewers can inspect personnel safely without edit actions or executable names and ids',async()=>{
 const hostile=await page.evaluate(()=>{
  const id=`person'\"><img src=x onerror=\"window.__scriptExecuted=true\">`,name=`<img src=x onerror="window.__scriptExecuted=true"> Безопасное имя`;
  data.drivers.push({id,name,personnelRoles:['operator']});_sync.access={user:{id:'viewer',name:'Тестовый наблюдатель',role:'viewer'},readable:PlatformSchema.sections.slice(),writable:[]};return{id,name};
 });
 await openSection('operators');assert.match(await page.locator('#mainContent').innerText(),/Безопасное имя/);await openPerson(hostile.id);assert.ok((await page.locator('#mainContent').innerText()).includes(hostile.name));assert.equal(await page.locator('#mainContent img').count(),0);
 for(const action of ['new','edit','archive','assign','end-assignment','cancel-assignment','document'])assert.equal(await page.locator('[data-personnel-action="'+action+'"]:enabled').count(),0);
 assert.equal(await page.evaluate(()=>window.__scriptExecuted),false);assert.equal(await page.evaluate(()=>window.__writes),0);
});

test('legacy malformed credential and document dates remain safe and readable without rewriting data',async()=>{
 const before=await page.evaluate(()=>{
  const person=data.drivers.find(row=>row.id==='dual-person');person.driverLicenseExpires=712;person.certificateExpires='<img src=x onerror="window.__scriptExecuted=true">';person.medicalExpires='2026-13-01';person.briefingExpires={old:'bad date'};
  data.assetDocuments.push({id:'bad-date-document',driverId:person.id,title:'Старый документ с ошибкой',expires:'<img src=x onerror="window.__scriptExecuted=true">'});data.assetDocuments.push({id:'numeric-date-document',driverId:person.id,title:'Старый документ с числом',expires:712});
  _sync.access={user:{id:'viewer',name:'Наблюдатель',role:'viewer'},readable:PlatformSchema.sections.slice(),writable:[]};return JSON.stringify(data);
 });
 await openSection('operators');await openPerson('dual-person');const content=await page.locator('#mainContent').innerText();assert.match(content,/Старый документ с ошибкой/);assert.match(content,/Старый документ с числом/);assert.ok((content.match(/Проверьте дату/g)||[]).length>=6);assert.equal(await page.locator('#mainContent img').count(),0);assert.equal(await page.evaluate(()=>window.__scriptExecuted),false);assert.equal(await page.evaluate(()=>JSON.stringify(data)),before);assert.equal(await page.evaluate(()=>window.__writes),0);
});
