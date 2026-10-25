'use strict';
const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {createRequire}=require('node:module');
let pw;try{pw=require('playwright');}catch{pw=createRequire(path.join(process.env.TVS_PLAYWRIGHT_MODULES||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),'package.json'))('playwright');}
const root=path.resolve(__dirname,'..'),screens=path.join(root,'audit/personnel-timesheets');
const samples={operator:process.env.TVS_DES_TIMESHEET_SAMPLE||'',driver:process.env.TVS_DRIVER_TIMESHEET_SAMPLE||''};
let browser,page,server,baseURL,errors;
before(async()=>{
 fs.mkdirSync(screens,{recursive:true});
 server=http.createServer((req,res)=>{
  let file;try{file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));}catch{res.writeHead(400).end();return;}
  if(!file.startsWith(root+path.sep)&&file!==root){res.writeHead(403).end();return;}
  if(file===root)file=path.join(root,'index.html');
  fs.readFile(file,(error,body)=>{if(error){res.writeHead(404).end();return;}const ext=path.extname(file);res.setHeader('content-type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png'})[ext]||'application/octet-stream');res.end(body);});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));baseURL='http://127.0.0.1:'+server.address().port+'/index.html';
 const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
 browser=await pw.chromium.launch({headless:true,executablePath:process.env.TVS_TEST_BROWSER||(!process.env.CI&&fs.existsSync(edge)?edge:undefined)});
});
after(async()=>{await browser?.close();await new Promise(resolve=>server?.close(resolve));});
beforeEach(async()=>{
 page=await browser.newPage({viewport:{width:1280,height:960},acceptDownloads:true});errors=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await page.addInitScript(()=>{
  const seed={
   vehicles:[{id:'timesheet-v',plate:'SYNTHETIC-TS-001',make:'Тестовый автомобиль',org:'Тестовая организация',fuelGrade:'ДТ',norm:10}],
   generators:[{id:'timesheet-g',name:'Тестовая ДЭС',org:'Тестовая организация',norm:2}],
   drivers:[
    {id:'ts-driver',name:'Тестовый водитель',personnelRoles:['driver'],personnelNumber:'SYNTHETIC-D01',org:'Тестовая организация',site:'Тестовая площадка'},
    {id:'ts-operator',name:'Тестовый машинист',personnelRoles:['operator'],personnelNumber:'SYNTHETIC-O01',org:'Тестовая организация',site:'Тестовая площадка'},
    {id:'ts-archived',name:'Архивный сотрудник',personnelRoles:['operator'],archived:true,org:'Тестовая организация'}
   ],
   assetDocuments:[{id:'ordinary-document',title:'Обычный документ сотрудника',driverId:'ts-driver',number:'SYNTHETIC-DOC'}],
   assetAssignments:[],records:[],genRecords:[],shiftReports:[],fuelCards:[{id:'fc_cash',number:'НАЛИЧКА',provider:'Наличка',assignments:[]}],appMeta:[{id:'meta',toPlanInit:'test'}]
  };
  window.__disk=sessionStorage.getItem('syntheticTimesheetDisk')||JSON.stringify(seed);window.__writes=0;window.__reject=false;window.__delay=0;window.__token='synthetic-timesheet-db';window.__revisions={};
  window.electronAPI={readSnapshot:async()=>{
   const db=JSON.parse(window.__disk);for(const name of PlatformSchema.sections){db[name]??=[];window.__revisions[name]??=1;}window.__disk=JSON.stringify(db);
   return JSON.stringify({data:db,revisions:{...window.__revisions},databaseToken:window.__token,platform:{apiVersion:1,operations:1,outbox:1,commands:1,schemaVersion:2,documentDrafts:1,personnelPlanning:1,calendar:1}});
  },writeSections:async raw=>{
   window.__writes++;if(window.__delay)await new Promise(resolve=>setTimeout(resolve,window.__delay));
   if(window.__reject)return{ok:false,error:'Synthetic timesheet save failure'};
   const request=JSON.parse(raw),db=JSON.parse(window.__disk);for(const[name,rows]of Object.entries(request.sections)){db[name]=rows;window.__revisions[name]++;}
   window.__disk=JSON.stringify(db);sessionStorage.setItem('syntheticTimesheetDisk',window.__disk);return{ok:true,revisions:{...window.__revisions},databaseToken:request.databaseToken,canonicalSections:request.sections,operationReceipt:{id:request.operation?.id,status:'committed'}};
  }};
 });
 await page.goto(baseURL);
 await page.waitForFunction(()=>typeof renderPersonnelTimesheets==='function'&&typeof PersonnelTimesheet==='object'&&typeof data!=='undefined'&&data.vehicles[0]?.id==='timesheet-v');
});
afterEach(async()=>{await page?.close();assert.deepEqual(errors,[]);});

async function openSection(section){await page.locator('#unifiedNav [data-section="'+section+'"]').click();await page.waitForFunction(section=>activeSection===section,section);}
async function newSheet(kind='operator'){
 await openSection(kind==='operator'?'operatorTimesheets':'driverTimesheets');await page.locator('[data-pt-new]').click();
 const form=page.locator('#personnelTimesheetNew');await form.locator('[name="from"]').fill('2026-10-01');await form.locator('[name="to"]').fill('2026-10-15');await form.locator('[name="org"]').fill('Тестовая организация');await form.locator('[type="submit"]').click();await page.locator('.pt-table').waitFor();
}
async function day(value,date='2026-10-01',row=0){const input=page.locator('[data-pt-row="'+row+'"][data-pt-day="'+date+'"]');await input.fill(value);await input.blur();}
async function stats(){return page.locator('[data-pt-summary] strong').allTextContents();}
async function confirmReplacement(action){const waiting=page.locator('#confirmModal.open').waitFor();await action();await waiting;await page.locator('#confirmYes').click();}
async function importSample(kind){await openSection(kind==='operator'?'operatorTimesheets':'driverTimesheets');await page.locator('[data-pt-file]').setInputFiles(samples[kind]);await page.locator('.pt-table').waitFor({timeout:8000}).catch(async error=>{throw Error(error.message+'; import error: '+await page.locator('[data-pt-error]').innerText());});}
async function saveSheet(){await page.locator('[data-pt-save]').click();await page.waitForFunction(()=>document.querySelector('[data-pt-status]')?.textContent==='Сохранён в базе');}
async function noGlobalOverflow(){const box=await page.evaluate(()=>{const e=document.querySelector('.pt-table-scroll'),r=e.getBoundingClientRect();return{viewport:innerWidth,document:document.documentElement.scrollWidth,container:e.clientWidth,table:e.scrollWidth,left:r.left,right:r.right,main:document.querySelector('#mainContent').getBoundingClientRect().toJSON()};});assert.equal(box.document>box.viewport,false,JSON.stringify(box));assert.equal(box.table>box.container,true,JSON.stringify(box));}
async function capture(name){await page.screenshot({path:path.join(screens,name+'.png'),fullPage:false});}
async function captureGrid(name){
 const scroller=page.locator('.pt-table-scroll');assert.equal(await scroller.getAttribute('tabindex'),'0');assert.match(await scroller.getAttribute('aria-label'),/Прокрутка по горизонтали/);await scroller.scrollIntoViewIfNeeded();await scroller.evaluate(el=>{el.scrollTop=0;el.scrollLeft=0;});
 assert.equal(await page.locator('.pt-table thead th').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(251, 229, 214)');await capture(name+'-grid-left');
 await scroller.evaluate(el=>{el.scrollLeft=el.scrollWidth;});await capture(name+'-grid-right');await scroller.evaluate(el=>{el.scrollLeft=0;});
}

test('personnel cards and timesheets have separate navigation and read-only navigation makes no writes',async()=>{
 const before=await page.evaluate(()=>JSON.stringify(data));
 for(const[section,target,label]of [['operators','operatorTimesheets','машинистов ДЭС'],['drivers','driverTimesheets','водителей']]){
  await openSection(section);assert.equal(await page.locator('[data-pt-entry]').count(),1);await page.locator('[data-pt-entry]').click();assert.equal(await page.evaluate(()=>activeSection),target);assert.match(await page.locator('h2').last().innerText(),new RegExp(label));
  assert.equal(await page.locator('[data-pt-new]').count(),1);assert.equal(await page.locator('[data-pt-import]').count(),1);await page.locator('[data-pt-cards]').click();assert.equal(await page.evaluate(()=>activeSection),section);
 }
 assert.equal(await page.evaluate(()=>JSON.stringify(data)),before);assert.equal(await page.evaluate(()=>window.__writes),0);
});

test('new operator sheet edits typed hours and codes, preserves zero versus blank, saves and reopens only a document',async()=>{
 const unchanged=await page.evaluate(()=>({people:JSON.stringify(data.drivers),records:JSON.stringify(data.records),generators:JSON.stringify(data.genRecords),shifts:JSON.stringify(data.shiftReports)}));
 await newSheet();assert.deepEqual(await stats(),['1','0','0','15']);assert.equal(await page.locator('.pt-table tbody tr').count(),1);
 await day('11');assert.deepEqual(await stats(),['1','1','11','14']);assert.equal(await page.locator('[data-pt-total="Я"]').innerText(),'1');
 await day('0');assert.deepEqual(await stats(),['1','0','0','14']);assert.equal(await page.evaluate(()=>ptView('operator').model.rows[0].days['2026-10-01']),0);
 await day('');assert.deepEqual(await stats(),['1','0','0','15']);assert.equal(await page.evaluate(()=>Object.hasOwn(ptView('operator').model.rows[0].days,'2026-10-01')),false);
 await day('11,5');await day('мв','2026-10-02');assert.deepEqual(await stats(),['1','1','11.5','13']);assert.equal(await page.locator('[data-pt-total="МВ"]').innerText(),'1');
 const out=page.locator('[data-pt-day="2026-10-16"]');assert.equal(await out.getAttribute('readonly'),'');assert.equal(await out.getAttribute('tabindex'),'-1');
 for(const width of [1280,960]){await page.setViewportSize({width,height:960});await capture('synthetic-operator-'+width);await noGlobalOverflow();}
 await saveSheet();assert.equal(await page.evaluate(()=>window.__writes),1);
 const record=await page.evaluate(()=>data.assetDocuments.find(row=>row.kind==='personnel-timesheet'));assert.equal(record.personnelTimesheet.kind,'operator');assert.equal(record.personnelTimesheet.rows[0].days['2026-10-01'],11.5);assert.equal(record.personnelTimesheet.rows[0].days['2026-10-02'],'МВ');
 assert.deepEqual(await page.evaluate(()=>({people:JSON.stringify(data.drivers),records:JSON.stringify(data.records),generators:JSON.stringify(data.genRecords),shifts:JSON.stringify(data.shiftReports)})),unchanged);
 await page.reload();await page.waitForFunction(()=>typeof renderPersonnelTimesheets==='function'&&typeof data!=='undefined'&&data.assetDocuments.some(row=>row.kind==='personnel-timesheet'));
 await openSection('operatorTimesheets');await page.locator('[data-pt-saved]').selectOption('0');assert.deepEqual(await stats(),['1','1','11.5','13']);assert.equal(await page.locator('[data-pt-day="2026-10-01"]').inputValue(),'11.5');
 await day('12');await saveSheet();assert.equal(await page.evaluate(()=>data.assetDocuments.filter(row=>row.kind==='personnel-timesheet').length),1);assert.equal(await page.evaluate(()=>data.assetDocuments.find(row=>row.kind==='personnel-timesheet').id),record.id);
});

test('refused save retains the draft, retries once and does not duplicate a saved timesheet',async()=>{
 await newSheet('driver');await day('11');await page.locator('[data-pt-row="0"][data-pt-field="note"]').fill('Сохранить этот комментарий');await page.locator('[data-pt-row="0"][data-pt-field="note"]').blur();
 const draft=await page.evaluate(()=>JSON.stringify(ptView('driver').model));await page.evaluate(()=>{window.__reject=true;});await page.locator('[data-pt-save]').click();await page.waitForFunction(()=>!!document.querySelector('[data-pt-error]')?.textContent.trim());
 assert.match(await page.locator('[data-pt-error]').innerText(),/не сохранены|failure/i);assert.equal(await page.evaluate(()=>JSON.stringify(ptView('driver').model)),draft);assert.equal(await page.evaluate(()=>data.assetDocuments.filter(row=>row.kind==='personnel-timesheet').length),0);assert.equal(await page.evaluate(()=>JSON.parse(window.__disk).assetDocuments.filter(row=>row.kind==='personnel-timesheet').length),0);
 assert.equal(await page.locator('[data-pt-save]').isEnabled(),true);assert.match(await page.locator('[data-pt-status]').innerText(),/несохранённые/);
 await page.evaluate(()=>{window.__reject=false;window.__delay=80;});await saveSheet();assert.equal(await page.evaluate(()=>data.assetDocuments.filter(row=>row.kind==='personnel-timesheet').length),1);assert.equal(await page.evaluate(()=>window.__writes),2);
 await saveSheet();assert.equal(await page.evaluate(()=>data.assetDocuments.filter(row=>row.kind==='personnel-timesheet').length),1);
});

test('a role or database session change invalidates old editor actions and inaccessible documents are hidden',async()=>{
 await newSheet();await day('11');
 const result=await page.evaluate(async()=>{
  const old=ptView('operator'),before=JSON.stringify(data);_sync.access={user:{id:'viewer-timesheet',name:'Наблюдатель',role:'viewer'},readable:PlatformSchema.sections.slice(),writable:[]};
  let message='';try{ptAssert(old,true);}catch(error){message=error.message;}await ptSave(old);renderPersonnelTimesheets('operator');return{message,before,after:JSON.stringify(data),writes:window.__writes};
 });assert.match(result.message,/права изменились|доступ/);assert.equal(result.before,result.after);assert.equal(result.writes,0);assert.equal(await page.locator('[data-pt-new],[data-pt-import],[data-pt-save],input[data-pt-row]').count(),0);
 await page.evaluate(()=>{_sync.access={user:{id:'no-docs',name:'Нет документов',role:'accountant'},readable:['drivers'],writable:[]};renderPersonnelTimesheets('operator');});assert.match(await page.locator('#mainContent').innerText(),/документы сотрудников недоступны/);assert.equal(await page.locator('.pt-table').count(),0);
 await page.evaluate(()=>{_sync.access=null;});await newSheet();
 const changed=await page.evaluate(async()=>{const old=ptView('operator');_sync.databaseToken='changed-timesheet-db';window.__token='changed-timesheet-db';let message='';try{ptAssert(old,true);}catch(error){message=error.message;}return{message,writes:window.__writes};});assert.match(changed.message,/База или права изменились/);assert.equal(changed.writes,0);
});

test('invalid hours stay out of the model and an accessible manual employee can be added',async()=>{
 await newSheet();await day('11');await day('25');assert.match(await page.locator('[data-pt-error]').innerText(),/от 0 до 24/);assert.equal(await page.locator('[data-pt-day="2026-10-01"]').getAttribute('aria-invalid'),'true');assert.equal(await page.evaluate(()=>ptView('operator').model.rows[0].days['2026-10-01']),11);
 await page.locator('[data-pt-save]').click();assert.match(await page.locator('[data-pt-error]').innerText(),/Исправьте выделенные ячейки/);assert.equal(await page.evaluate(()=>window.__writes),0);
 await page.locator('[data-pt-export]').click();assert.match(await page.locator('[data-pt-error]').innerText(),/Исправьте выделенные ячейки/);
 await day('12');assert.equal(await page.locator('[data-pt-day="2026-10-01"]').getAttribute('aria-invalid'),null);
 await page.locator('[data-pt-add]').click();const form=page.locator('#personnelTimesheetAdd');await form.locator('[name="name"]').fill('Введённый вручную сотрудник');await form.locator('[name="personnelNumber"]').fill('SYNTHETIC-MANUAL-02');await form.locator('[name="site"]').fill('Вторая тестовая площадка');await form.locator('[type="submit"]').click();assert.equal(await page.locator('.pt-table tbody tr').count(),2);assert.equal(await page.evaluate(()=>data.drivers.length),3);
 const download=page.waitForEvent('download');await page.locator('[data-pt-export]').click();assert.match((await download).suggestedFilename(),/Табель_машинисты_ДЭС_2026-10-01_2026-10-15\.xlsx/);
});

test('pending writes lock the editor and a second save cannot create another document',async()=>{
 await newSheet();await day('11');await page.evaluate(()=>{window.__delay=450;});await page.locator('[data-pt-save]').click();
 await page.waitForFunction(()=>ptView('operator').pending===true);
 assert.equal(await page.locator('[data-pt-day="2026-10-01"]').isDisabled(),true);assert.equal(await page.locator('[data-pt-row="0"][data-pt-field="name"]').isDisabled(),true);assert.equal(await page.locator('[data-pt-export]').isDisabled(),true);
 await page.evaluate(()=>ptSave(ptView('operator')));assert.equal(await page.evaluate(()=>ptView('operator').pending),true);assert.equal(await page.locator('[data-pt-day="2026-10-01"]').isDisabled(),true);await page.waitForFunction(()=>document.querySelector('[data-pt-status]')?.textContent==='Сохранён в базе');assert.equal(await page.evaluate(()=>window.__writes),1);assert.equal(await page.evaluate(()=>data.assetDocuments.filter(row=>row.kind==='personnel-timesheet').length),1);
});

test('numeric document id zero survives reopening and updating',async()=>{
 await newSheet();await day('11');
 assert.equal(await page.evaluate(async()=>{const model=ptView('operator').model;data.assetDocuments.push(PersonnelTimesheetDocument.makeRecord(model,{id:0,now:'2026-10-25T12:00:00.000Z'}));return saveData(data);}),true);
 await page.evaluate(()=>{personnelTimesheetViews.clear();renderPersonnelTimesheets('operator');});await page.locator('[data-pt-saved]').selectOption('0');await day('12');await saveSheet();
 const docs=await page.evaluate(()=>data.assetDocuments.filter(row=>row.kind==='personnel-timesheet'));assert.equal(docs.length,1);assert.equal(docs[0].id,0);assert.equal(docs[0].personnelTimesheet.rows[0].days['2026-10-01'],12);
});

test('delayed file imports cannot replace another section or a newer selected file',async()=>{
 await newSheet();
 await page.evaluate(()=>{const s=ptView('operator'),bytes=PersonnelTimesheet.toXlsx(s.model,XLSX);s.dirty=false;window.__slowImport=ptImport(s,{name:'synthetic-delayed.xlsx',size:bytes.byteLength,arrayBuffer:()=>new Promise(resolve=>{window.__finishImport=()=>resolve(bytes);})});});
 await page.waitForFunction(()=>typeof window.__finishImport==='function');await openSection('driverTimesheets');await page.evaluate(async()=>{window.__finishImport();await window.__slowImport;});
 assert.equal(await page.evaluate(()=>activeSection),'driverTimesheets');assert.equal(await page.locator('.pt-table').count(),0);assert.equal(await page.evaluate(()=>ptView('driver').model),null);
 await openSection('operatorTimesheets');
 await page.evaluate(()=>{const s=ptView('operator'),bytes=PersonnelTimesheet.toXlsx(s.model,XLSX);s.dirty=false;window.__finishImport=null;window.__slowImport=ptImport(s,{name:'synthetic-older.xlsx',size:bytes.byteLength,arrayBuffer:()=>new Promise(resolve=>{window.__finishImport=()=>resolve(bytes);})});});
 await page.waitForFunction(()=>typeof window.__finishImport==='function');
 await page.evaluate(async()=>{const s=ptView('operator'),newer=JSON.parse(JSON.stringify(s.model));newer.title='Новый выбранный табель';const bytes=PersonnelTimesheet.toXlsx(newer,XLSX);await ptImport(s,{name:'synthetic-newer.xlsx',size:bytes.byteLength,arrayBuffer:async()=>bytes});window.__finishImport();await window.__slowImport;});
 assert.equal(await page.evaluate(()=>ptView('operator').model.source.fileName),'synthetic-newer.xlsx');assert.equal(await page.evaluate(()=>ptView('operator').model.title),'Новый выбранный табель');assert.equal(await page.evaluate(()=>window.__writes),0);
});

test('document details validate month changes, update curator and export metadata, and print the whole table',async()=>{
 await newSheet();await day('11');await day('4','2026-10-10');const before=await page.evaluate(()=>JSON.stringify(ptView('operator').model));
 await page.locator('[data-pt-details]').click();const form=page.locator('#personnelTimesheetDetails');await form.locator('[name="from"]').fill('2026-11-01');await form.locator('[name="to"]').fill('2026-11-15');await form.locator('[type="submit"]').click();
 assert.match(await form.locator('[role="alert"]').innerText(),/Для другого месяца создайте новый табель/);assert.equal(await page.evaluate(()=>JSON.stringify(ptView('operator').model)),before);
 await form.locator('[name="from"]').fill('2026-10-02');await form.locator('[name="to"]').fill('2026-10-10');await form.locator('[name="preparedAt"]').fill('2026-10-25');await form.locator('[name="curator"]').fill('Тестовый куратор');await form.locator('[name="documentNumber"]').fill('SYNTHETIC-TS-26');await form.locator('[name="division"]').fill('Тестовое подразделение');await form.locator('[name="title"]').fill('Тестовый табель после изменения реквизитов');await form.locator('[type="submit"]').click();
 await page.waitForFunction(()=>!document.querySelector('#personnelTimesheetDetails')?.closest('.modal-overlay')?.classList.contains('open'));assert.match(await page.locator('.pt-table thead').innerText(),/Тестовый куратор/);assert.match(await page.locator('.pt-document-tools').innerText(),/02.10.2026 — 10.10.2026/);assert.deepEqual(await stats(),['1','1','4','8']);
 assert.equal(await page.locator('[data-pt-day="2026-10-01"]').inputValue(),'11');assert.equal(await page.locator('[data-pt-day="2026-10-01"]').getAttribute('readonly'),'');
 await saveSheet();const stored=await page.evaluate(()=>data.assetDocuments.find(row=>row.kind==='personnel-timesheet').personnelTimesheet);assert.equal(stored.curator,'Тестовый куратор');assert.equal(stored.preparedAt,'2026-10-25');assert.equal(stored.documentNumber,'SYNTHETIC-TS-26');
 const exported=await page.evaluate(()=>{const s=ptView('operator'),book=PersonnelTimesheet.toWorkbook(s.model,XLSX),copy=PersonnelTimesheet.fromWorkbook(book,{kind:'operator',fileName:'synthetic-export.xlsx'});return{from:copy.from,to:copy.to,preparedAt:copy.preparedAt,curator:copy.curator,number:copy.documentNumber};});assert.deepEqual(exported,{from:'2026-10-02',to:'2026-10-10',preparedAt:'2026-10-25',curator:'Тестовый куратор',number:'SYNTHETIC-TS-26'});
 const download=page.waitForEvent('download');await page.locator('[data-pt-export]').click();assert.match((await download).suggestedFilename(),/2026-10-02_2026-10-10\.xlsx/);
 await page.setViewportSize({width:1600,height:1100});await page.emulateMedia({media:'print'});await page.evaluate(()=>document.body.classList.add('pt-printing'));await page.screenshot({path:path.join(screens,'synthetic-print.png'),fullPage:true});
 const print=await page.evaluate(()=>{const table=document.querySelector('.pt-table'),box=table.getBoundingClientRect();return{width:box.width,right:box.right,viewport:innerWidth,visible:box.height>0,sidebar:getComputedStyle(document.querySelector('.sidebar')).display,save:getComputedStyle(document.querySelector('.pt-document-tools')).display};});assert.equal(print.visible,true);assert.ok(print.right<=print.viewport+1,JSON.stringify(print));assert.equal(print.sidebar,'none');assert.equal(print.save,'none');await page.evaluate(()=>document.body.classList.remove('pt-printing'));await page.emulateMedia({media:'screen'});
});

test('DES sample displays source discrepancies, period statistics and all 31 day columns', {skip:!fs.existsSync(samples.operator)},async()=>{
 await importSample('operator');assert.deepEqual(await stats(),['8','65','715','0']);assert.equal(await page.locator('[data-pt-sheet]').inputValue(),'май26');assert.match(await page.locator('[data-pt-warnings]').innerText(),/исходнике.*11.*по дням 15/);assert.equal(await page.locator('.pt-table thead tr:nth-child(2) th').count(),35);assert.equal(await page.locator('[data-pt-grand="МВ"]').innerText(),'49');assert.equal(await page.locator('[data-pt-grand="Д"]').innerText(),'6');assert.equal(await page.locator('[data-pt-grand="Я"]').innerText(),'65');assert.equal(await page.locator('[data-pt-grand="total"]').innerText(),'71');
 const source=await page.evaluate(()=>ptView('operator').model.source);assert.equal(source.sheetName,'май26');assert.equal(await page.evaluate(()=>ptView('operator').model.from),'2026-10-01');assert.equal(await page.evaluate(()=>window.__writes),0);
 for(const width of [1280,960]){await page.setViewportSize({width,height:960});await page.locator('[data-personnel-timesheet]').evaluate(el=>el.scrollIntoView());await capture('sample-des-'+width);await noGlobalOverflow();if(width===1280)await captureGrid('sample-des-1280');}
 await saveSheet();const stored=await page.evaluate(()=>data.assetDocuments.find(row=>row.kind==='personnel-timesheet').personnelTimesheet);assert.equal(stored.rows.length,8);assert.equal(stored.source.sheetName,'май26');assert.equal(stored.rows[2].sourceTotals['Я'],11);assert.equal(await page.locator('[data-pt-sheet]').count(),0);assert.deepEqual(await stats(),['8','65','715','0']);assert.match(await page.locator('[data-pt-warnings]').innerText(),/исходнике.*11.*по дням 15/);
});

test('driver sample selects August active sheet, retains outside-period marks and can select historical periods',{skip:!fs.existsSync(samples.driver)},async()=>{
 await importSample('driver');assert.equal(await page.locator('[data-pt-sheet]').inputValue(),'ЗПиюнь26');assert.deepEqual(await stats(),['19','120','1320','15']);assert.equal(await page.evaluate(()=>ptView('driver').model.from),'2026-08-01');assert.equal(await page.evaluate(()=>ptView('driver').model.to),'2026-08-15');assert.equal(await page.evaluate(()=>ptView('driver').model.rows.at(-1).days['2026-08-31']),'ПТД');assert.equal(await page.locator('[data-pt-grand="МВ"]').innerText(),'45');assert.match(await page.locator('[data-pt-warnings]').innerText(),/исходнике пусто.*по дням 15/);
 assert.equal(await page.locator('.pt-table tbody tr').first().locator('td').first().innerText(),'2');assert.equal(await page.locator('.pt-table tbody tr').nth(12).locator('td').first().innerText(),'16');
 for(const width of [1280,960]){await page.setViewportSize({width,height:960});await page.locator('[data-personnel-timesheet]').evaluate(el=>el.scrollIntoView());await capture('sample-drivers-'+width);await noGlobalOverflow();if(width===1280)await captureGrid('sample-drivers-1280');}
 const options=await page.locator('[data-pt-sheet] option').allTextContents();assert.equal(options.some(text=>/^водители(?:\s|$)/.test(text)),false);assert.ok(options.some(text=>text.includes('Аванс февраль26')),'February with * placeholders is a valid historical timesheet');
 await confirmReplacement(()=>page.locator('[data-pt-sheet]').selectOption('Зарплата июль 2025'));await page.waitForFunction(()=>ptView('driver').model.from==='2025-07-01');assert.equal(await page.evaluate(()=>ptView('driver').model.to),'2025-07-31');assert.equal(await page.locator('.pt-table tbody tr').count(),34);assert.equal(await page.evaluate(()=>window.__writes),0);
 await confirmReplacement(()=>page.locator('[data-pt-sheet]').selectOption('ЗПиюнь26'));await page.waitForFunction(()=>ptView('driver').model.from==='2026-08-01');await saveSheet();const stored=await page.evaluate(()=>data.assetDocuments.find(row=>row.kind==='personnel-timesheet').personnelTimesheet);assert.equal(stored.kind,'driver');assert.equal(stored.rows.length,19);assert.equal(stored.source.sheetName,'ЗПиюнь26');assert.equal(stored.rows.at(-1).days['2026-08-31'],'ПТД');assert.deepEqual(await stats(),['19','120','1320','15']);
});
