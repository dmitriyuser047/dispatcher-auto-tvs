'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createRequire}=require('node:module');
const storage=require('../electron/storage'),sqlite=require('../electron/sqlite-storage.cjs');
const root=path.resolve(__dirname,'..');
let pw;try{pw=require('playwright');}catch{const modules=process.env.TVS_PLAYWRIGHT_MODULES||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');pw=createRequire(path.join(modules,'package.json'))('playwright');}

function fixture(){return {...Object.fromEntries(storage.SECTIONS.map(name=>[name,[]])),
 vehicles:[{id:0,make:'Synthetic period vehicle',plate:'SYNTHETIC PERIOD ZERO',org:'SYNTHETIC',fuel:'diesel',fuelGrade:'ДТ',fuelBalance:923.537,norm:10}],
 records:[{id:'synthetic-journal',vehicleId:0,date:'2026-09-02',km:100,fuelActual:0,fuelIssued:0,fuelGrade:'ДТ'}],
 parts:[{id:0,name:'Synthetic filter',unit:'шт'}],partMovements:[{id:'synthetic-receipt',date:'2026-09-01',kind:'receipt',partId:0,qty:5}],
 payments:[{id:0,date:'2026-09-05',sum:100,paid:false,paidAmount:0,description:'Synthetic invoice',vehicleId:0,org:'SYNTHETIC',object:'SYNTHETIC SITE'}],
 fuelCards:[{id:'cash',number:'НАЛИЧКА',provider:'Наличка',assignments:[]}],appMeta:[{id:'meta',toPlanInit:'synthetic'}]};}

test('hidden Electron closes isolated fuel, stock and finance periods through real forms and IPC without blocking later actual payments',{timeout:240000},async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-native-periods-')),profile=path.join(directory,'profile'),jsonDir=path.join(directory,'json'),sqlDir=path.join(directory,'sqlite');let app;
 t.after(async()=>{if(app){await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(win=>win.destroy())).catch(()=>{});await app.close().catch(()=>{});}const resolved=path.resolve(directory);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('tvs-native-periods-'));fs.rmSync(resolved,{recursive:true,force:true});});
 fs.mkdirSync(profile);storage.writeAll(jsonDir,fixture());sqlite.create(sqlDir,{data:fixture()});
 fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({users:[{name:'Synthetic periods JSON',dataDir:jsonDir},{name:'Synthetic periods SQLite',dataDir:sqlDir}],activeUser:0,networkMode:'local',networkKey:'synthetic-native-period-key',serverPort:3377,remotePort:3377,remoteHost:'127.0.0.1'}));
 const bootstrap=path.join(directory,'bootstrap.cjs');fs.writeFileSync(bootstrap,`const Module=require('node:module'),original=Module._load,electron=original('electron',module,false);const HiddenWindow=new Proxy(electron.BrowserWindow,{construct(Target,args){const win=new Target({...args[0],show:false});win.show=()=>{};win.showInactive=()=>{};return win;}});Module._load=function(request,parent,isMain){if(request==='electron')return {...electron,BrowserWindow:HiddenWindow};return original.apply(this,arguments);};electron.app.setAppPath(${JSON.stringify(root)});require(${JSON.stringify(path.join(root,'electron/main.js'))});`);
 const packaged=process.env.TVS_PACKAGED_EXE;app=await pw._electron.launch({executablePath:packaged||require('electron'),args:[...(packaged?[]:[bootstrap]),'--user-data-dir='+profile,'--tvs-test-hidden'],cwd:root});const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
 await page.waitForFunction(()=>typeof PeriodPolicy!=='undefined'&&typeof data!=='undefined'&&data.vehicles[0]?.id===0);
 await page.evaluate(async()=>{localStorage.setItem('changelogSeenVersion',await window.electronAPI.getAppVersion());if(document.getElementById('genericModal'))closeModal('genericModal');});
 assert.equal(await app.evaluate(({app})=>app.getPath('userData')),profile);assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(win=>win.isVisible())),false);
 async function act(scope,action='close'){
  await page.evaluate(({scope,action})=>periodControlOpen(scope,'2026-09',action),{scope,action});const form=page.locator('#periodControlForm');
  await form.locator('[name="reason"]').fill('Synthetic reviewed '+scope+' '+action);await form.locator('[data-period-preview]').click();
  await page.waitForFunction(()=>!!periodControlSession?.review||!!document.querySelector('[data-period-error]')?.textContent);
  const preview=await page.evaluate(()=>periodControlSession?.review?.review);assert.equal(preview?.canApply,true,JSON.stringify(preview||await form.locator('[data-period-error]').innerText()));
  await form.locator('[name="confirm"]').check();await form.locator('[data-period-save]').click();
  await page.waitForFunction(({scope,closed})=>PeriodPolicy.status(data,scope,'2026-09').closed===closed,{scope,closed:action==='close'});
  assert.equal(await form.locator('[data-period-error]').count()?await form.locator('[data-period-error]').innerText():'','');
 }
 for(const[index,dir]of [jsonDir,sqlDir].entries()){
  if(index)await page.evaluate(async()=>{await window.electronAPI.switchUser(1);data=await loadData();rebuildIndex();});
  assert.equal(await page.evaluate(()=>_sync.platform.periods),1);const original=storage.readAll(dir);
  for(const scope of ['fuel','stock','finance'])await act(scope);
  const closed=storage.readAll(dir),period=closed.fuelPeriods.find(row=>row.month==='2026-09');
  assert.equal(period.closed,true);assert.equal(period.stockClosed,true);assert.equal(period.financeClosed,true);
  for(const section of ['records','partMovements','payments','vehicles'])assert.deepEqual(closed[section],original[section]);
  assert.equal(period.closureEvents.events.length,3);assert.ok(period.closureEvents.events.every(event=>event.actor.id==='local-profile'&&event.reason.startsWith('Synthetic reviewed')));
  const refusal=await page.evaluate(async()=>{
   const snapshot=JSON.parse(await window.electronAPI.readSnapshot({hello:PlatformCompatibility.describe().hello})),records=structuredClone(snapshot.data.records);records[0].km=101;
   const journal=await window.electronAPI.writeSections(JSON.stringify({databaseToken:snapshot.databaseToken,base:{records:snapshot.revisions.records},sections:{records}}));
   const fuelPeriods=structuredClone(snapshot.data.fuelPeriods);fuelPeriods[0].closed=false;fuelPeriods[0].closureEvents.events=[];
   const flags=await window.electronAPI.writeSections(JSON.stringify({databaseToken:snapshot.databaseToken,base:{fuelPeriods:snapshot.revisions.fuelPeriods},sections:{fuelPeriods}}));
   return {journal,flags};
  });assert.equal(refusal.journal.ok,false,JSON.stringify(refusal));assert.equal(refusal.flags.ok,false,JSON.stringify(refusal));assert.deepEqual(storage.readAll(dir).fuelPeriods,closed.fuelPeriods);assert.deepEqual(storage.readAll(dir).records,original.records);
  const settled=await page.evaluate(async()=>{
   const today=dispatcherLocalDate(),base={action:'settle',section:'payments',id:0,amount:20,date:'2026-10-20',reason:'Synthetic actual October payment'},review=DocumentEngine.preview(data,base,{today}),id=crypto.randomUUID();
   const result=await platformExecuteCommand({type:'DocumentAction',version:1,input:{...base,reviewFingerprint:review.fingerprint}},{operationId:id});
   if(!result.ok)return {result,review};const count=data.auditLog.length,replayed=await window.electronAPI.executeCommand(JSON.stringify(_platformCommandIntents.get(id).envelope));
   const backdated=DocumentEngine.preview(data,{...base,date:'2026-09-20'},{today});const correction=DocumentEngine.preview(data,{action:'post',section:'payments',id:0,payload:{date:'2026-10-01',sum:80},reason:'Synthetic correction'},{today});
   return {result:{ok:result.ok},replayed:replayed.ok,auditCount:count,backdated:backdated.canPost,correction:correction.canPost};
  });assert.equal(settled.result.ok,true,JSON.stringify(settled));assert.equal(settled.replayed,true);assert.equal(settled.backdated,false);assert.equal(settled.correction,false);
  const payment=storage.readAll(dir).payments[0];assert.equal(payment.sum,100);assert.equal(payment.paidAmount,0);assert.equal(payment.paymentSettlements.events.length,1);assert.equal(payment.paymentSettlements.events[0].amount,20);assert.equal(storage.readAll(dir).auditLog.length,settled.auditCount);
  await act('fuel','reopen');const reopened=storage.readAll(dir).fuelPeriods[0];assert.equal(reopened.closed,false);assert.equal(reopened.stockClosed,true);assert.equal(reopened.financeClosed,true);assert.equal(reopened.closureEvents.events.length,4);
 }
 assert.deepEqual(errors,[]);
});
