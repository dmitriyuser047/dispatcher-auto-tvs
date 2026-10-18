const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{createRequire}=require('node:module');
let pw;try{pw=require('playwright');}catch{pw=createRequire(path.join(process.env.TVS_PLAYWRIGHT_MODULES||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),'package.json'))('playwright');}
let browser,page,errors;
before(async()=>{const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';browser=await pw.chromium.launch({headless:true,executablePath:process.env.TVS_TEST_BROWSER||(!process.env.CI&&fs.existsSync(edge)?edge:undefined)});});
after(async()=>{await browser?.close();});
beforeEach(async()=>{
 page=await browser.newPage({viewport:{width:1280,height:900}});errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.addInitScript(()=>{
  const date=new Date(),today=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const db={vehicles:[],records:[],generators:[],genRecords:[],tanks:[{id:'t',name:'Тестовая ёмкость',balanceInit:10,reserveLevel:20}],parts:[{id:'p',name:'Фильтр тестовый',unit:'шт',minStock:2}],appMeta:[{id:'meta',toPlanInit:'test'}],procurementRules:[{id:'rule',kind:'tank',itemId:'t',leadDays:2,coverDays:7,reserveQty:20,expectedDaily:0}],procurementOrders:[{id:'po',kind:'tank',itemId:'t',supplier:'Тестовый поставщик',quantity:100,receivedQty:0,stockPostedQty:0,deliveryDate:today,status:'ordered',note:'Исходный заказ'}]};
  window.__disk=JSON.stringify(db);window.__writes=0;window.__reject=false;
  window.electronAPI={readData:async()=>window.__disk,writeData:async text=>{window.__writes++;if(window.__reject)return false;const value=JSON.parse(text);window.__disk=JSON.stringify(value.databaseToken?value.data:value);return true;}};
 });
 await page.goto(pathToFileURL(path.join(__dirname,'..','index.html')).href);
 await page.waitForFunction(()=>typeof data!=='undefined'&&data.tanks?.[0]?.id==='t');
 await page.evaluate(()=>switchSection('procurement'));
 await page.locator('.pc-workspace h2').waitFor();
});
afterEach(async()=>{await page?.close();assert.deepEqual(errors,[]);});

test('planner works in both restored themes without horizontal overflow',async()=>{
 for(const width of [1280,960])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:800});await page.evaluate(theme=>applyTheme(theme),theme);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.locator('[data-pc-action="rule"][data-pc-kind="tank"]').click();
  assert.equal(await page.locator('#pcLead').inputValue(),'2');await page.locator('#pcRuleCancel').click();
 }
});

test('partial receipt tracks quantities without posting any fuel or parts movement',async()=>{
 const before=await page.evaluate(()=>({stock:wfTankBalanceAt('t'),fuel:data.fuelMovements.length,incomes:data.tankIncomes.length,parts:data.partMovements.length}));
 await page.locator('[data-pc-action="order"][data-pc-id="po"]').click();await page.locator('#pcReceived').fill('40');await page.locator('#pcStatus').selectOption('partial');await page.locator('#pcOrderForm [type=submit]').click();
 await page.waitForFunction(()=>!document.querySelector('#wfModal.open #pcOrderForm')||document.getElementById('pcOrderError')?.textContent);
 assert.equal(await page.locator('#wfModal.open #pcOrderForm').count(),0,await page.evaluate(()=>document.getElementById('pcOrderError')?.textContent||''));
 const after=await page.evaluate(()=>({order:data.procurementOrders[0],stock:wfTankBalanceAt('t'),fuel:data.fuelMovements.length,incomes:data.tankIncomes.length,parts:data.partMovements.length,plan:ProcurementEngine.plan(data,{date:wfToday()}).find(r=>r.itemId==='t')}));
 assert.equal(after.order.receivedQty,40);assert.equal(after.order.stockPostedQty,0);assert.equal(after.order.status,'partial');assert.equal(after.stock,before.stock);assert.equal(after.fuel,before.fuel);assert.equal(after.incomes,before.incomes);assert.equal(after.parts,before.parts);assert.equal(after.plan.pendingPosting,40);assert.equal(after.plan.undelivered,60);assert.equal(after.plan.suggestedQty,0);
 assert.match(await page.locator('.pc-workspace').innerText(),/40 л ожидает отдельного прихода/);
});

test('failed save rolls back only the order and preserves all form inputs for retry',async()=>{
 await page.locator('[data-pc-action="order"][data-pc-id="po"]').click();await page.locator('#pcSupplier').fill('Новый поставщик');await page.locator('#pcQuantity').fill('150');await page.evaluate(()=>{window.__reject=true;});
 await page.locator('#pcOrderForm [type=submit]').click();await page.waitForFunction(()=>document.getElementById('pcOrderError')?.textContent.includes('Не удалось сохранить'));
 assert.equal(await page.locator('#pcSupplier').inputValue(),'Новый поставщик');assert.equal(await page.locator('#pcQuantity').inputValue(),'150');assert.equal(await page.evaluate(()=>data.procurementOrders[0].quantity),100);assert.equal(await page.evaluate(()=>data.procurementOrders[0].supplier),'Тестовый поставщик');
 await page.evaluate(()=>{window.__reject=false;});await page.locator('#pcOrderForm [type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#wfModal.open #pcOrderForm'));assert.equal(await page.evaluate(()=>data.procurementOrders[0].quantity),150);
});
test('separate receipt opens the existing workflow with a proposal but creates no journal movement until explicit save',async()=>{
 await page.evaluate(()=>{data.procurementOrders[0].status='partial';data.procurementOrders[0].receivedQty=40;renderProcurementSection();});
 await page.locator('[data-pc-action="receipt"][data-pc-id="po"]').click();await page.locator('#wfForm').waitFor();
 assert.equal(await page.evaluate(()=>activeSection),'workflows');assert.equal(await page.evaluate(()=>wfTab),'fuelMovements');assert.equal(await page.locator('#wf_toTankId').inputValue(),'t');assert.equal(await page.locator('#wf_qty').inputValue(),'40');assert.equal(await page.evaluate(()=>data.fuelMovements.length),0);assert.equal(await page.evaluate(()=>data.tankIncomes.length),0);assert.equal(await page.evaluate(()=>data.procurementOrders[0].stockPostedQty),0);
});

test('unexpected thrown save keeps form and restores the prior order',async()=>{
 await page.locator('[data-pc-action="order"][data-pc-id="po"]').click();await page.locator('#pcQuantity').fill('150');await page.evaluate(()=>{saveData=async()=>{throw Error('Тестовый обрыв связи');};});
 await page.locator('#pcOrderForm [type=submit]').click();await page.waitForFunction(()=>document.getElementById('pcOrderError')?.textContent.includes('обрыв связи'));
 assert.equal(await page.locator('#pcQuantity').inputValue(),'150');assert.equal(await page.evaluate(()=>data.procurementOrders[0].quantity),100);
});

test('read-only role can inspect orders but cannot mutate them even via direct store invocation',async()=>{
 await page.evaluate(()=>{_sync.access={readable:Object.keys(data),writable:[]};renderProcurementSection();});assert.equal(await page.locator('[data-pc-action="new-order"]').isDisabled(),true);
 await page.locator('[data-pc-action="order"][data-pc-id="po"]').click();assert.equal(await page.locator('#pcSupplier').isDisabled(),true);assert.equal(await page.locator('#pcOrderForm [type=submit]').count(),0);
 const message=await page.evaluate(async()=>{try{await pcStoreRow('procurementOrders',{...data.procurementOrders[0],quantity:200},data.procurementOrders[0],pcIdentity());return '';}catch(error){return error.message;}});assert.match(message,/запрещено/);assert.equal(await page.evaluate(()=>data.procurementOrders[0].quantity),100);
});

test('stale form and a database switch reject writes while keeping user input',async()=>{
 await page.locator('[data-pc-action="order"][data-pc-id="po"]').click();await page.locator('#pcSupplier').fill('Мой ввод');await page.evaluate(()=>{data.procurementOrders[0].note='Правка коллеги';});await page.locator('#pcOrderForm [type=submit]').click();await page.waitForFunction(()=>document.getElementById('pcOrderError')?.textContent.includes('другом окне'));
 assert.equal(await page.locator('#pcSupplier').inputValue(),'Мой ввод');assert.equal(await page.evaluate(()=>data.procurementOrders[0].note),'Правка коллеги');
 await page.locator('#pcCancel').click();await page.locator('[data-pc-action="order"][data-pc-id="po"]').click();await page.evaluate(()=>{_sync.databaseToken='other-database';});await page.locator('#pcOrderForm [type=submit]').click();await page.waitForFunction(()=>document.getElementById('pcOrderError')?.textContent.includes('база изменилась'));
});

test('parameter save failure retains its form and never changes inventory reserve',async()=>{
 await page.locator('[data-pc-action="rule"][data-pc-kind="tank"]').click();await page.locator('#pcLead').fill('4');await page.locator('#pcReserve').fill('60');await page.locator('#pcDaily').fill('15');await page.evaluate(()=>{window.__reject=true;});await page.locator('#pcRuleForm [type=submit]').click();await page.waitForFunction(()=>document.getElementById('pcRuleError')?.textContent.includes('Не удалось сохранить'));
 assert.equal(await page.locator('#pcLead').inputValue(),'4');assert.equal(await page.evaluate(()=>data.procurementRules[0].leadDays),2);assert.equal(await page.evaluate(()=>data.tanks[0].reserveLevel),20);
 await page.evaluate(()=>{window.__reject=false;});await page.locator('#pcRuleForm [type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#wfModal.open #pcRuleForm'));assert.equal(await page.evaluate(()=>data.procurementRules[0].expectedDaily),15);assert.equal(await page.evaluate(()=>data.tanks[0].reserveLevel),20);
});
test('same physical database under a different principal cannot submit the former principal form',async()=>{
 await page.evaluate(()=>{_sync.databaseToken='same-physical-db';_sync.access={readable:Object.keys(data),writable:['procurementOrders','procurementRules'],user:{id:'first',role:'dispatcher'}};renderProcurementSection();});
 await page.locator('[data-pc-action="order"][data-pc-id="po"]').click();await page.locator('#pcSupplier').fill('Ввод первого пользователя');
 await page.evaluate(()=>{_sync.access.user={id:'second',role:'dispatcher'};});await page.locator('#pcOrderForm [type=submit]').click();await page.waitForFunction(()=>document.getElementById('pcOrderError')?.textContent.includes('база изменилась'));
 assert.equal(await page.locator('#pcSupplier').inputValue(),'Ввод первого пользователя');assert.equal(await page.evaluate(()=>data.procurementOrders[0].supplier),'Тестовый поставщик');
});

test('double submission writes once and failed brand-new order is not left in data',async()=>{
 await page.locator('[data-pc-action="new-order"]').click();await page.locator('#pcItem').selectOption('part:p');await page.locator('#pcSupplier').fill('Склад');await page.locator('#pcQuantity').fill('10');
 await page.evaluate(()=>{window.__reject=true;});await page.locator('#pcOrderForm [type=submit]').click();await page.waitForFunction(()=>document.getElementById('pcOrderError')?.textContent.includes('Не удалось сохранить'));assert.equal(await page.evaluate(()=>data.procurementOrders.length),1);
 const count=await page.evaluate(()=>window.__writes);await page.evaluate(()=>{window.__reject=false;const originalSave=saveData;saveData=async(...args)=>{await new Promise(resolve=>setTimeout(resolve,80));return originalSave(...args);};document.getElementById('pcOrderForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));document.getElementById('pcOrderForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});await page.waitForFunction(()=>!document.querySelector('#wfModal.open #pcOrderForm'));assert.equal(await page.evaluate(()=>data.procurementOrders.length),2);assert.equal(await page.evaluate(()=>window.__writes),count+1);
});
