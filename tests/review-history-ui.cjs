const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createRequire}=require('node:module'),{pathToFileURL}=require('node:url');
let pw;try{pw=require('playwright')}catch{pw=createRequire(path.join(process.env.TVS_PLAYWRIGHT_MODULES||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),'package.json'))('playwright')}
let browser,page,errors;
before(async()=>{const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';browser=await pw.chromium.launch({headless:true,executablePath:process.env.TVS_TEST_BROWSER||(!process.env.CI&&fs.existsSync(edge)?edge:undefined)});});
after(async()=>browser?.close());
beforeEach(async()=>{
 page=await browser.newPage({viewport:{width:1280,height:900}});errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.addInitScript(()=>{
  const now=new Date(),date=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');
  const db={vehicles:[{id:'v',plate:'А111АА72',make:'УАЗ',org:'A',fuel:'gasoline',fuelGrade:'АИ-95',norm:10}],records:[{id:'r',vehicleId:'v',date,km:0,fuelIssued:30,fuelActual:0}],generators:[],genRecords:[],vehicleTo:[{id:'to',vehicleId:'v',date,planned:true,type:'Замена масла'}],toRecords:[],repairs:[],payments:[{id:'pay',date,sum:100,paidAmount:40,paid:false,invoiceNo:'СЧ-42'}],contragents:[],tanks:[],tankIncomes:[],fuelPurchases:[{id:'purchase',vehicleId:'v',recordId:'r',date,grade:'АИ-95',qty:30,sourceOrg:''}],fuelCards:[],fuelImports:[],fuelPeriods:[],monthlyFuel:[],appMeta:[{id:'meta',toPlanInit:'test'}],reestrRows:[],savedReestrs:[{id:'sr',number:7,date:'18.10.2026',rowCount:1,totalSum:50,rows:[{osn:'invoice7',sum:50}]}]};
  window.__disk=JSON.stringify(db);window.__identity='A';window.__restoreFail=false;
  const entry={id:'change_test_11111111-1111-4111-8111-111111111111',at:new Date().toISOString(),actor:'<img src=x onerror=alert(1)>',action:'Смена водителя',changes:[{section:'vehicles',key:'v',index:0,before:{...db.vehicles[0],driver:'До'},after:db.vehicles[0]}]};
  window.electronAPI={readData:async()=>window.__disk,writeData:async json=>{window.__disk=json;return true},getDataIdentity:async()=>window.__identity,
   readHistory:async()=>({identity:window.__identity,items:[{...entry,changes:undefined,count:1,sections:['vehicles']}],next:null}),readHistoryEntry:async()=>({...entry,identity:window.__identity}),
   restoreHistoryEntry:async()=>{if(window.__restoreFail)return{ok:false,error:'Запись изменена позже'};const next=JSON.parse(window.__disk);next.vehicles[0]=entry.changes[0].before;window.__disk=JSON.stringify(next);return{ok:true,data:next,revisions:{}}}};
 });
 await page.goto(pathToFileURL(path.resolve('index.html')).href);await page.waitForFunction(()=>typeof data!=='undefined'&&data.vehicles.length===1&&typeof workspaceBuildIssues==='function');await page.evaluate(()=>{toAutoSetupOnce=async()=>{}});
});
afterEach(async()=>{await page.close();assert.deepEqual(errors,[])});
test('overview opens an exact fuel issue and returns to the same month after correction',async()=>{
 await page.getByRole('button',{name:/Проверка ГСМ/}).click();await page.locator('.workspace-review-item').first().click();
 assert.equal(await page.locator('#fpe_qty').inputValue(),'30');assert.equal(await page.evaluate(()=>workspaceReview.current.id),'purchase');
 await page.locator('#fpe_org').fill('A');await page.getByRole('button',{name:'Сохранить',exact:true}).last().click();
 await page.getByRole('button',{name:'Следующее',exact:true}).click();await page.waitForFunction(()=>document.getElementById('genericModalBody').textContent.includes('Замечаний нет'));
 assert.equal(await page.evaluate(()=>workspaceBuildIssues('fuel').length),0);
});
test('maintenance and payment queues open exact work orders and show partial debt',async()=>{
 await page.evaluate(()=>workspaceOpenIssues('maintenance'));await page.locator('.workspace-review-item').first().click();assert.match(await page.locator('#genericModalBody').innerText(),/Замена масла/);
 await page.evaluate(()=>{closeModal('genericModal');workspaceEndReview()});await page.evaluate(()=>workspaceOpenIssues('payments'));
 assert.match(await page.locator('.workspace-review-item').innerText(),/60/);await page.locator('.workspace-review-item').click();assert.equal(await page.evaluate(()=>editingPaymentId),'pay');
});
test('recent entries open their exact journal record and switched database blocks a stale queue',async()=>{
 await page.evaluate(()=>workspaceOpenEntry('records','r'));assert.equal(await page.evaluate(()=>editingRecordId),'r');
 await page.evaluate(()=>{closeModal('recordModal');workspaceOpenIssues('fuel')});await page.waitForSelector('.workspace-review-item');await page.evaluate(()=>window.__identity='B');
 await page.locator('.workspace-review-item').first().click();assert.equal(await page.evaluate(()=>workspaceReview),null);assert.equal(await page.locator('#fpe_qty').count(),0);
});
test('history escapes values and restoration refreshes data, revisions and the visible page',async()=>{
 await page.getByRole('button',{name:'История изменений',exact:true}).click();assert.equal(await page.locator('#genericModalBody img').count(),0);await page.locator('.workspace-review-item').click();
 await page.getByRole('button',{name:'Восстановить состояние до операции',exact:true}).click();await page.getByRole('button',{name:'Восстановить',exact:true}).click();
 await page.waitForFunction(()=>data.vehicles[0].driver==='До'&&_activeSaves===0);assert.equal(await page.evaluate(()=>JSON.parse(_lastPersisted).vehicles[0].driver),'До');
});
test('refused restoration preserves data and leaves the detail available for review',async()=>{
 const before=await page.evaluate(()=>JSON.stringify(data));await page.evaluate(()=>{window.__restoreFail=true;return openChangeHistory()});await page.locator('.workspace-review-item').click();
 await page.getByRole('button',{name:'Восстановить состояние до операции',exact:true}).click();await page.getByRole('button',{name:'Восстановить',exact:true}).click();
 await page.waitForFunction(()=>_activeSaves===0);assert.equal(await page.evaluate(()=>JSON.stringify(data)),before);assert.match(await page.locator('#globalToast').innerText(),/изменена позже/);
});
test('partial payment totals agree in overview, grouped report and exported numeric cells',async()=>{
 const result=await page.evaluate(()=>{const debt=workspaceOverview().payable;reportKind='payments';switchSection('reports');const counters=[...document.querySelectorAll('.stat-value')].map(e=>e.textContent);let exported;XLSX.writeFile=book=>{exported=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1})};exportReportXlsx();return{debt,counters,exported}});
 assert.equal(result.debt,60);assert.deepEqual(result.counters.slice(0,3),['100','40','60']);assert.equal(result.exported[1][7],40);assert.equal(result.exported[1][8],60);
});
test('opening a saved registry search result is read-only until editing is requested',async()=>{
 const before=await page.evaluate(()=>JSON.stringify(data));await page.evaluate(()=>workspaceFocusRecord('reestr','sr'));assert.match(await page.locator('#genericModalBody').innerText(),/invoice7/);assert.equal(await page.evaluate(()=>JSON.stringify(data)),before);
});
test('large history operations paginate details while retaining the full operation for restoration',async()=>{
 await page.evaluate(()=>{const read=window.electronAPI.readHistoryEntry;window.electronAPI.readHistoryEntry=async request=>{const event=await read(request);return{...event,changes:Array.from({length:60},(_,i)=>({...event.changes[0],key:'v'+i,before:{driver:'До '+i},after:{driver:'После '+i}}))}};return openChangeHistory()});
 await page.locator('.workspace-review-item').click();assert.equal(await page.locator('.workspace-history-change').count(),25);await page.getByRole('button',{name:'Следующие',exact:true}).click();assert.equal(await page.locator('.workspace-history-change').count(),25);await page.getByRole('button',{name:'Следующие',exact:true}).click();assert.equal(await page.locator('.workspace-history-change').count(),10);assert.equal(await page.evaluate(()=>workspaceHistory.entry.changes.length),60);
});
test('history refuses a detail response from another server database even when the event ID matches',async()=>{
 await page.evaluate(()=>{const list=window.electronAPI.readHistory,detail=window.electronAPI.readHistoryEntry;window.electronAPI.readHistory=async()=>({...await list(),databaseToken:'database-A'});window.electronAPI.readHistoryEntry=async request=>({...await detail(request),databaseToken:'database-B'});return openChangeHistory()});
 await page.locator('.workspace-review-item').click();assert.equal(await page.evaluate(()=>workspaceHistory.entry),null);assert.match(await page.locator('#globalToast').innerText(),/База сервера переключена/);
});
