'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createRequire}=require('node:module');
const storage=require('../electron/storage'),sqlite=require('../electron/sqlite-storage.cjs'),root=path.resolve(__dirname,'..');
let pw;try{pw=require('playwright');}catch{pw=createRequire(path.join(process.env.TVS_PLAYWRIGHT_MODULES||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),'package.json'))('playwright');}
function fixture(){return{...Object.fromEntries(storage.SECTIONS.map(name=>[name,[]])),
 tanks:[{id:0,name:'SYNTHETIC NUMERIC TANK',fuel:'diesel',balanceInit:100},{id:'0',name:'SYNTHETIC TEXT TANK',fuel:'diesel',balanceInit:20}],
 tankIncomes:[{id:'receipt',tankId:0,date:'2026-09-03',amount:5,source:'SYNTHETIC INVOICE'},{id:'out',tankId:0,counterTankId:'0',date:'2026-09-04',amount:-5.125,kind:'out',linkId:'synthetic-pair'},{id:'in',tankId:'0',counterTankId:0,date:'2026-09-04',amount:5.125,kind:'in',linkId:'synthetic-pair'}],
 fuelCards:[{id:'cash',number:'НАЛИЧКА',provider:'Наличка',assignments:[]}],appMeta:[{id:'meta',toPlanInit:'synthetic'}]};}
test('hidden Electron records and applies a reviewed tank measurement through real IPC on isolated JSON and SQLite without altering source facts',{timeout:240000},async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-native-tank-stock-')),profile=path.join(directory,'profile'),jsonDir=path.join(directory,'json'),sqlDir=path.join(directory,'sqlite');let app;
 t.after(async()=>{if(app){await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(win=>win.destroy())).catch(()=>{});await app.close().catch(()=>{});}const resolved=path.resolve(directory);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('tvs-native-tank-stock-'));fs.rmSync(resolved,{recursive:true,force:true});});
 fs.mkdirSync(profile);storage.writeAll(jsonDir,fixture());sqlite.create(sqlDir,{data:fixture()});
 fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({users:[{name:'SYNTHETIC tank JSON',dataDir:jsonDir},{name:'SYNTHETIC tank SQLite',dataDir:sqlDir}],activeUser:0,networkMode:'local',networkKey:'synthetic-native-tank-key',serverPort:3377,remotePort:3377,remoteHost:'127.0.0.1'}));
 const bootstrap=path.join(directory,'bootstrap.cjs');fs.writeFileSync(bootstrap,`const Module=require('node:module'),original=Module._load,electron=original('electron',module,false);const HiddenWindow=new Proxy(electron.BrowserWindow,{construct(Target,args){const win=new Target({...args[0],show:false});win.show=()=>{};win.showInactive=()=>{};return win;}});Module._load=function(request,parent,isMain){if(request==='electron')return {...electron,BrowserWindow:HiddenWindow};return original.apply(this,arguments);};electron.app.setAppPath(${JSON.stringify(root)});require(${JSON.stringify(path.join(root,'electron/main.js'))});`);
 const packaged=process.env.TVS_PACKAGED_EXE;app=await pw._electron.launch({executablePath:packaged||require('electron'),args:[...(packaged?[]:[bootstrap]),'--user-data-dir='+profile,'--tvs-test-hidden'],cwd:root});const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(12000);
 await page.waitForFunction(()=>typeof FuelOperations==='object'&&typeof data!=='undefined'&&data.tanks?.[0]?.id===0);
 await page.evaluate(async()=>{localStorage.setItem('changelogSeenVersion',await window.electronAPI.getAppVersion());if(document.getElementById('genericModal'))closeModal('genericModal');});
 assert.equal(await app.evaluate(({app})=>app.getPath('userData')),profile);assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(win=>win.isVisible())),false);
 async function reviewed(action,options,observed){
  await page.evaluate(({action,options})=>tankFuelActionOpen(action,options),{action,options});const form=page.locator('#tankFuelActionForm');
  if(action==='measure'){await form.locator('[name="date"]').fill('2026-09-30');await form.locator('[name="observedQty"]').fill(String(observed));}
  await form.locator('[name="reason"]').fill('SYNTHETIC confirmed native tank '+action);await form.locator('[data-tank-preview]').click();
  await page.waitForFunction(()=>!!tankFuelSession?.review||!!document.querySelector('[data-tank-error]')?.textContent);
  const review=await page.evaluate(()=>tankFuelSession?.review?.value);assert.equal(review?.canApply,true,JSON.stringify(review||await form.locator('[data-tank-error]').innerText()));
  const before=await page.evaluate(()=>data.fuelMovements.length);await form.locator('[name="confirm"]').check();await form.locator('[data-tank-save]').click();
  await page.waitForFunction(count=>data.fuelMovements.length===count+1,before);return review;
 }
 for(const[index,dir]of [jsonDir,sqlDir].entries()){
  if(index)await page.evaluate(async()=>{await window.electronAPI.switchUser(1);data=await loadData();rebuildIndex();});
  assert.equal(await page.evaluate(()=>_sync.platform.fuelOperations),1);const original=storage.readAll(dir);
  assert.equal(await page.evaluate(()=>wfTankBalanceAt(0,'2026-09-30')),99.875);
  await reviewed('measure',{tankId:0},99.874);const measured=storage.readAll(dir),measurement=measured.fuelMovements.find(row=>row.kind==='measurement');
  assert.equal(measurement.qty,0);assert.deepEqual(measurement.measurement.target,{section:'tanks',id:0});assert.equal(measurement.measurement.calculatedQty,'99.875');assert.equal(measurement.measurement.differenceQty,'-0.001');assert.equal(await page.evaluate(()=>wfTankBalanceAt(0,'2026-09-30')),99.875);
  await reviewed('applyDifference',{measurementId:measurement.id});const adjusted=storage.readAll(dir);assert.equal(adjusted.fuelMovements.length,2);assert.equal(await page.evaluate(()=>wfTankBalanceAt(0,'2026-09-30')),99.874);assert.equal(await page.evaluate(()=>wfTankBalanceAt('0','2026-09-30')),25.125);
  assert.deepEqual(adjusted.fuelMovements.find(row=>row.id===measurement.id),measurement);for(const name of ['tanks','tankIncomes','generators','genRecords'])assert.deepEqual(adjusted[name],original[name]);
  const replay=await page.evaluate(async()=>{const adjustment=data.fuelMovements.find(row=>row.kind!=='measurement'),id=adjustment.lifecycle.operationId,envelope=_platformCommandIntents.get(id).envelope;return window.electronAPI.executeCommand(JSON.stringify(envelope));});assert.equal(replay.ok,true);assert.equal(storage.readAll(dir).fuelMovements.length,2);
  const forged=await page.evaluate(async()=>{const snap=JSON.parse(await window.electronAPI.readSnapshot()),rows=structuredClone(snap.data.fuelMovements);rows.find(row=>row.kind==='measurement').measurement.observedQty=0;return window.electronAPI.writeSections(JSON.stringify({databaseToken:snap.databaseToken,base:{fuelMovements:snap.revisions.fuelMovements},sections:{fuelMovements:rows}}));});assert.equal(forged.ok,false);assert.deepEqual(storage.readAll(dir).fuelMovements,adjusted.fuelMovements);
 }
 assert.deepEqual(errors,[]);
});
