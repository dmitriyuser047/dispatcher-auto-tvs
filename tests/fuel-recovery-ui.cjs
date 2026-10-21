const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{createRequire}=require('node:module');
let pw;try{pw=require('playwright');}catch{pw=createRequire(path.join(process.env.TVS_PLAYWRIGHT_MODULES||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),'package.json'))('playwright');}
let browser,page,errors;
const input=field=>page.locator('[data-frc-field="'+field+'"]');
before(async()=>{const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';browser=await pw.chromium.launch({headless:true,executablePath:process.env.TVS_TEST_BROWSER||(!process.env.CI&&fs.existsSync(edge)?edge:undefined)});});
after(async()=>{await browser?.close();});
beforeEach(async()=>{
 page=await browser.newPage({viewport:{width:1280,height:900}});errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await page.addInitScript(()=>{
  const seed={vehicles:[{id:'recovery-v',plate:'SYNTHETIC',fuelGrade:'ДТ',fuelBalance:0,norm:10}],records:[{id:'recovery-r',vehicleId:'recovery-v',date:'2026-10-01',km:0,fuelActual:0,fuelIssued:100}],fuelPurchases:[{id:'recovery-buy',vehicleId:'recovery-v',recordId:'recovery-r',date:'2026-10-01',grade:'ДТ',qty:100,sum:6000,sourceProvider:'Synthetic Supplier',sourceOrg:'Test'}],fuelCards:[{id:'fc_cash',number:'НАЛИЧКА',provider:'Наличка',assignments:[]}],fuelPeriods:[{month:'2026-10',history:[],recon:{'Synthetic Supplier':{litres:10,sum:600,note:'Initial'}}}],appMeta:[{id:'meta',toPlanInit:'test'}]};
  window.__token='recovery-A';window.__disks={'recovery-A':JSON.stringify(seed)};window.__revisions={};window.__writes=[];window.__reject=false;window.__hold=false;window.__missingReceipt=false;window.__closeReplies=[];
  window.__snapshot=token=>{
   const db=JSON.parse(window.__disks[token]);const revs=window.__revisions[token]??={};for(const name of PlatformSchema.sections){db[name]??=[];revs[name]??=1;}window.__disks[token]=JSON.stringify(db);
   return {data:db,revisions:{...revs},databaseToken:token,platform:{apiVersion:1,operations:1}};
  };
  window.electronAPI={onPrepareClose:listener=>{window.__prepareClose=listener;},finishClose:async result=>{window.__closeReplies.push(result);},readSnapshot:async()=>JSON.stringify(window.__snapshot(window.__token)),writeSections:async raw=>{
   const request=JSON.parse(raw);window.__writes.push(request);
   if(window.__hold)await new Promise(resolve=>window.__release=resolve);
   if(window.__reject)return{ok:false,error:'Synthetic save failure'};
   if(window.__missingReceipt)return{ok:true,databaseToken:request.databaseToken,canonicalSections:request.sections};
   const db=JSON.parse(window.__disks[request.databaseToken]),revs=window.__revisions[request.databaseToken];for(const [name,rows]of Object.entries(request.sections)){db[name]=rows;revs[name]++;}window.__disks[request.databaseToken]=JSON.stringify(db);
   return{ok:true,revisions:{...revs},databaseToken:request.databaseToken,canonicalSections:request.sections,operationReceipt:{id:request.operation?.id,status:'committed'}};
  }};
 });
 await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);
 await page.waitForFunction(()=>typeof frcSet==='function'&&typeof data!=='undefined'&&data.vehicles[0]?.id==='recovery-v');
 await page.evaluate(()=>{frcMonth='2026-10';fpView='recon';switchSection('fuelPurchases');});
 await input('litres').waitFor();
});
afterEach(async()=>{await page?.close();assert.deepEqual(errors,[]);});
async function change(field,value){await input(field).fill(value);await input(field).dispatchEvent('change');}
async function settled(){await page.waitForFunction(()=>frcSession().pending===0);}
async function stored(){return page.evaluate(()=>JSON.parse(window.__disks[window.__token]).fuelPeriods[0].recon['Synthetic Supplier']);}

test('a change writes immediately and reports success only after the operation receipt',async()=>{
 await page.evaluate(()=>{window.__hold=true;window.__result=frcSet('2026-10','Synthetic Supplier','litres','123.456');});
 await page.waitForFunction(()=>window.__writes.length===1);assert.match(await page.locator('#frcSaveStatus').innerText(),/Ожидается подтверждение/);assert.doesNotMatch(await page.locator('#frcSaveStatus').innerText(),/Сверка сохранена/);assert.equal((await stored()).litres,10);
 await page.evaluate(()=>{window.__hold=false;window.__release();});assert.equal(await page.evaluate(()=>window.__result),true);assert.equal((await stored()).litres,123.456);assert.match(await page.locator('#frcSaveStatus').innerText(),/Сверка сохранена/);assert.equal(await page.evaluate(()=>frcHasPendingEdits()),false);
});

test('flush captures a focused last edit before change and waits for its save',async()=>{
 await input('litres').fill('124.567');assert.equal(await page.evaluate(()=>frcHasPendingEdits()),true);assert.equal(await page.evaluate(()=>window.__writes.length),0);
 assert.equal(await page.evaluate(()=>frcFlush()),true);assert.equal((await stored()).litres,124.567);assert.equal(await input('litres').inputValue(),'124.567');assert.equal(await page.evaluate(()=>window.__writes.length),1);assert.equal(await page.evaluate(()=>frcHasPendingEdits()),false);
});

test('rejected reconciliation retains visible drafts across render and retries a set without stacking litres',async()=>{
 const before=await page.evaluate(()=>({records:JSON.stringify(data.records),purchases:JSON.stringify(data.fuelPurchases)}));await page.evaluate(()=>{window.__reject=true;});await change('litres','123.456');await settled();
 assert.equal((await stored()).litres,10);assert.equal(await page.evaluate(()=>data.fuelPeriods[0].recon['Synthetic Supplier'].litres),10);assert.equal(await input('litres').inputValue(),'123.456');assert.match(await page.locator('#frcSaveStatus').innerText(),/Не сохранено полей: 1/);assert.equal(await page.evaluate(()=>frcFlush()),false);
 await page.evaluate(()=>renderFuelPurchases());assert.equal(await input('litres').inputValue(),'123.456');await page.evaluate(()=>{window.__reject=false;});await page.locator('[data-frc-retry]').click();await settled();assert.equal((await stored()).litres,123.456);assert.equal(await page.evaluate(()=>window.__writes.length),2);assert.equal(await page.evaluate(()=>frcFlush()),true);
 assert.deepEqual(await page.evaluate(()=>({records:JSON.stringify(data.records),purchases:JSON.stringify(data.fuelPurchases)})),before);
});

test('rapid edits to the same cell are ordered and persist the final exact value once per edit',async()=>{
 await page.evaluate(()=>{window.__hold=true;window.__first=frcSet('2026-10','Synthetic Supplier','litres','100');});await page.waitForFunction(()=>window.__writes.length===1);
 await page.evaluate(()=>{window.__second=frcSet('2026-10','Synthetic Supplier','litres','200');window.__third=frcSet('2026-10','Synthetic Supplier','litres','300');});assert.equal(await page.evaluate(()=>window.__writes.length),1);
 await page.evaluate(()=>{window.__hold=false;window.__release();});assert.deepEqual(await page.evaluate(()=>Promise.all([window.__first,window.__second,window.__third])),[true,true,true]);assert.equal((await stored()).litres,300);assert.deepEqual(await page.evaluate(()=>window.__writes.map(row=>row.sections.fuelPeriods[0].recon['Synthetic Supplier'].litres)),[100,200,300]);
});

test('the previous ACK preserves unsubmitted typing and focus in the next input',async()=>{
 await page.evaluate(()=>{window.__hold=true;});await change('litres','20');await page.waitForFunction(()=>window.__writes.length===1);await input('sum').fill('4321.09');
 await page.evaluate(()=>{window.__hold=false;window.__release();});await settled();assert.equal(await input('sum').inputValue(),'4321.09');assert.equal(await input('sum').evaluate(node=>node===document.activeElement),true);assert.equal((await stored()).sum,600);
 assert.equal(await page.evaluate(()=>frcFlush()),true);assert.equal((await stored()).sum,4321.09);assert.equal((await stored()).litres,20);
});

test('a failed field is not silently committed by a different successful field',async()=>{
 await page.evaluate(()=>{window.__reject=true;});await change('litres','55.5');await settled();await page.evaluate(()=>{window.__reject=false;});await change('sum','3333.33');await settled();
 assert.deepEqual(await stored(),{litres:10,sum:3333.33,note:'Initial'});assert.equal(await input('litres').inputValue(),'55.5');assert.match(await page.locator('#frcSaveStatus').innerText(),/Не сохранено полей: 1/);assert.equal(await page.evaluate(()=>frcRetry()),true);assert.deepEqual(await stored(),{litres:55.5,sum:3333.33,note:'Initial'});assert.equal(await page.evaluate(()=>window.__writes.length),3);
});

test('a missing operation receipt keeps the draft and does not claim the save succeeded',async()=>{
 await page.evaluate(()=>{window.__missingReceipt=true;});await change('note','Важный комментарий');await settled();assert.equal((await stored()).note,'Initial');assert.equal(await input('note').inputValue(),'Важный комментарий');assert.match(await page.locator('#frcSaveStatus').innerText(),/Не сохранено полей/);assert.doesNotMatch(await page.locator('#frcSaveStatus').innerText(),/Сверка сохранена/);assert.equal(await page.evaluate(()=>frcFlush()),false);
});

test('an unfinished numeric input cannot be silently saved as an empty value on close',async()=>{
 await input('litres').fill('');await input('litres').pressSequentially('-');assert.equal(await input('litres').evaluate(node=>node.validity.badInput),true);assert.equal(await page.evaluate(()=>frcHasPendingEdits()),true);assert.equal(await page.evaluate(()=>frcFlush()),false);assert.equal((await stored()).litres,10);assert.equal(await page.evaluate(()=>window.__writes.length),0);assert.equal(await input('litres').evaluate(node=>node.validity.badInput),true);
 await input('litres').fill('42.123');assert.equal(await page.evaluate(()=>frcFlush()),true);assert.equal((await stored()).litres,42.123);
});

test('retry refuses to overwrite an intervening remote change until the user re-enters the value',async()=>{
 await page.evaluate(()=>{window.__reject=true;});await change('litres','45');await settled();
 await page.evaluate(()=>{window.__reject=false;const db=JSON.parse(window.__disks[window.__token]);db.fuelPeriods[0].recon['Synthetic Supplier'].litres=99;window.__disks[window.__token]=JSON.stringify(db);data.fuelPeriods=db.fuelPeriods;_sync.synced.fuelPeriods=JSON.stringify(db.fuelPeriods);_sync.revs.fuelPeriods++;_lastPersisted=JSON.stringify(data);});
 assert.equal(await page.evaluate(()=>frcRetry()),false);assert.equal(await page.evaluate(()=>window.__writes.length),1);assert.equal((await stored()).litres,99);assert.equal(await input('litres').inputValue(),'45');assert.match(await page.locator('#frcSaveStatus').innerText(),/уже изменился/);
 await change('litres','46');await settled();assert.equal((await stored()).litres,46);assert.equal(await page.evaluate(()=>window.__writes.length),2);
});

test('a stale input and late ACK from database A cannot alter database B',async()=>{
 await page.evaluate(()=>{window.__hold=true;});await change('litres','123');await page.waitForFunction(()=>window.__writes.length===1);
 await page.evaluate(()=>{
  const b=JSON.parse(window.__disks['recovery-A']);b.fuelPeriods[0].recon['Synthetic Supplier'].litres=77;window.__disks['recovery-B']=JSON.stringify(b);window.__token='recovery-B';const snapshot=window.__snapshot(window.__token);data=snapshot.data;_sync.databaseToken=snapshot.databaseToken;_sync.revs=snapshot.revisions;_sync.synced=Object.fromEntries(PlatformSchema.sections.map(name=>[name,JSON.stringify(data[name])]));_sync.lastResult=null;_lastPersisted=JSON.stringify(data);rebuildIndex();
 });
 await input('litres').fill('999');await input('litres').dispatchEvent('change');assert.equal(await page.evaluate(()=>frcFlush()),false);await page.evaluate(()=>{window.__hold=false;window.__release();});await page.waitForFunction(()=>unifiedPendingSaves===0);assert.equal((await stored()).litres,77);assert.equal(await page.evaluate(()=>data.fuelPeriods[0].recon['Synthetic Supplier'].litres),77);assert.equal(await page.evaluate(()=>window.__writes.length),1);
 await page.evaluate(()=>renderFuelPurchases());assert.equal(await input('litres').inputValue(),'77');assert.equal(await page.evaluate(()=>frcHasPendingEdits()),false);assert.equal(await page.evaluate(()=>frcFlush()),true);
});

test('permission or month closure during editing retains the failed value without a write',async()=>{
 await input('litres').fill('66');await page.evaluate(()=>{data.fuelPeriods[0].closed=true;});await input('litres').dispatchEvent('change');await settled();assert.equal(await page.evaluate(()=>window.__writes.length),0);assert.equal(await input('litres').inputValue(),'66');assert.match(await page.locator('#frcSaveStatus').innerText(),/Месяц закрыт/);assert.equal(await page.evaluate(()=>frcFlush()),false);
 await page.evaluate(()=>{data.fuelPeriods[0].closed=false;});assert.equal(await page.evaluate(()=>frcRetry()),true);assert.equal((await stored()).litres,66);
 await input('sum').fill('777');await page.evaluate(()=>{_loadWriteBlocked=true;});await input('sum').dispatchEvent('change');await settled();assert.equal(await input('sum').inputValue(),'777');assert.equal((await stored()).sum,600);assert.equal(await page.evaluate(()=>window.__writes.length),1);assert.match(await page.locator('#frcSaveStatus').innerText(),/запись заблокирована/);
});

test('discard is explicit and restores canonical values without changing accounting records',async()=>{
 await page.evaluate(()=>{window.__reject=true;});await change('litres','400');await settled();const before=await page.evaluate(()=>window.__disks[window.__token]);await page.evaluate(()=>{window.confirmAction=async()=>false;});assert.equal(await page.evaluate(()=>frcDiscard()),false);assert.equal(await input('litres').inputValue(),'400');await page.evaluate(()=>{window.confirmAction=async()=>true;});assert.equal(await page.evaluate(()=>frcDiscard()),true);assert.equal(await input('litres').inputValue(),'10');assert.equal(await page.evaluate(()=>frcHasPendingEdits()),false);assert.equal(await page.evaluate(()=>window.__disks[window.__token]),before);assert.equal(await page.evaluate(()=>window.__writes.length),1);
});

test('the shared close handshake captures the last focused reconciliation edit and waits for its receipt',async()=>{
 await input('litres').fill('212.345');await page.evaluate(()=>{window.__hold=true;window.__closeTask=window.__prepareClose('synthetic-close-nonce');});
 await page.waitForFunction(()=>window.__writes.length===1);assert.equal(await page.evaluate(()=>_pendingSaveOperations.size),1);assert.deepEqual(await page.evaluate(()=>window.__closeReplies),[]);assert.equal((await stored()).litres,10);
 await page.evaluate(()=>{window.__hold=false;window.__release();});await page.evaluate(()=>window.__closeTask);assert.deepEqual(await page.evaluate(()=>window.__closeReplies),[{nonce:'synthetic-close-nonce',ready:true}]);assert.equal((await stored()).litres,212.345);assert.equal(await page.evaluate(()=>_pendingSaveOperations.size),0);assert.equal(await page.evaluate(()=>frcHasPendingEdits()),false);
});

test('the shared close barrier drains a pending non-reconciliation save before returning ready',async()=>{
 await page.evaluate(()=>{window.__hold=true;data.vehicles[0].make='Synthetic pending edit';window.__plainSave=saveData(data);});await page.waitForFunction(()=>window.__writes.length===1);
 await page.evaluate(()=>{window.__closeDone=false;window.__closeTask=platformFlushForClose().then(result=>{window.__closeDone=true;return result;});});
 assert.equal(await page.evaluate(()=>_pendingSaveOperations.size),1);assert.equal(await page.evaluate(()=>window.__closeDone),false);assert.equal(await page.evaluate(()=>JSON.parse(window.__disks[window.__token]).vehicles[0].make),undefined);
 await page.evaluate(()=>{window.__hold=false;window.__release();});assert.equal(await page.evaluate(()=>window.__plainSave),true);assert.equal(await page.evaluate(()=>window.__closeTask),true);assert.equal(await page.evaluate(()=>JSON.parse(window.__disks[window.__token]).vehicles[0].make),'Synthetic pending edit');assert.equal(await page.evaluate(()=>_pendingSaveOperations.size),0);
});

test('the shared close barrier returns false for a failed pending save and keeps a reconciliation draft for retry',async()=>{
 await page.evaluate(()=>{window.__hold=true;window.__reject=true;});await change('litres','321.654');await page.waitForFunction(()=>window.__writes.length===1);
 await page.evaluate(()=>{window.__closeTask=platformFlushForClose();window.__hold=false;window.__release();});assert.equal(await page.evaluate(()=>window.__closeTask),false);assert.equal(await input('litres').inputValue(),'321.654');assert.equal((await stored()).litres,10);assert.equal(await page.evaluate(()=>_pendingSaveOperations.size),0);assert.equal(await page.evaluate(()=>frcHasPendingEdits()),true);
 const writes=await page.evaluate(()=>window.__writes.length);assert.equal(await page.evaluate(()=>platformFlushForClose()),false);assert.equal(await page.evaluate(()=>window.__writes.length),writes);assert.equal(await input('litres').inputValue(),'321.654');
});

test('the shared close barrier also rejects a false ACK from a non-reconciliation save',async()=>{
 await page.evaluate(()=>{window.__hold=true;window.__reject=true;data.vehicles[0].make='Rejected pending edit';window.__plainSave=saveData(data);});await page.waitForFunction(()=>window.__writes.length===1);
 await page.evaluate(()=>{window.__closeTask=platformFlushForClose();window.__hold=false;window.__release();});assert.equal(await page.evaluate(()=>window.__plainSave),false);assert.equal(await page.evaluate(()=>window.__closeTask),false);assert.equal(await page.evaluate(()=>_pendingSaveOperations.size),0);assert.equal(await page.evaluate(()=>data.vehicles[0].make),undefined);
});

test('the shared close barrier leaves an unfinished minus focused and never blurs or clears it',async()=>{
 await input('litres').fill('');await input('litres').pressSequentially('-');await input('litres').evaluate(node=>{window.__invalidBlurred=0;node.addEventListener('blur',()=>window.__invalidBlurred++);});
 assert.equal(await page.evaluate(()=>platformFlushForClose()),false);assert.equal(await input('litres').evaluate(node=>node===document.activeElement&&node.validity.badInput),true);assert.equal(await page.evaluate(()=>window.__invalidBlurred),0);assert.equal(await page.evaluate(()=>window.__writes.length),0);assert.equal((await stored()).litres,10);
 await input('litres').fill('22.222');assert.equal(await page.evaluate(()=>platformFlushForClose()),true);assert.equal((await stored()).litres,22.222);
});

test('a shared close started in A refuses a late ACK after switching to B and never saves old inputs into B',async()=>{
 await page.evaluate(()=>{window.__hold=true;});await change('litres','444');await page.waitForFunction(()=>window.__writes.length===1);await page.evaluate(()=>{window.__closeTask=platformFlushForClose();});
 await page.evaluate(()=>{
  const b=JSON.parse(window.__disks['recovery-A']);b.fuelPeriods[0].recon['Synthetic Supplier'].litres=88;window.__disks['recovery-B']=JSON.stringify(b);window.__token='recovery-B';const snapshot=window.__snapshot(window.__token);data=snapshot.data;_sync.databaseToken=snapshot.databaseToken;_sync.revs=snapshot.revisions;_sync.synced=Object.fromEntries(PlatformSchema.sections.map(name=>[name,JSON.stringify(data[name])]));_sync.lastResult=null;_lastPersisted=JSON.stringify(data);rebuildIndex();
  window.__hold=false;window.__release();
 });
 assert.equal(await page.evaluate(()=>window.__closeTask),false);assert.equal(await page.evaluate(()=>window.__writes.length),1);assert.equal((await stored()).litres,88);assert.equal(await page.evaluate(()=>data.fuelPeriods[0].recon['Synthetic Supplier'].litres),88);assert.equal(await page.evaluate(()=>JSON.parse(window.__disks['recovery-A']).fuelPeriods[0].recon['Synthetic Supplier'].litres),444);
 await input('litres').fill('999');assert.equal(await page.evaluate(()=>platformFlushForClose()),false);assert.equal(await page.evaluate(()=>window.__writes.length),1);assert.equal((await stored()).litres,88);await page.evaluate(()=>renderFuelPurchases());assert.equal(await input('litres').inputValue(),'88');assert.equal(await page.evaluate(()=>platformFlushForClose()),true);
});
