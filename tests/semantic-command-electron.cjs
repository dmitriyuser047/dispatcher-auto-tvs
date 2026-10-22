'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createRequire}=require('node:module');
const storage=require('../electron/storage'),sqlite=require('../electron/sqlite-storage.cjs');
const catalogMerge=require('../assets/core/catalog-merge.js'),kernel=require('../assets/core/platform-kernel.js'),platform=require('../electron/platform-service.cjs');
const root=path.resolve(__dirname,'..');let pw;
try{pw=require('playwright');}catch{pw=createRequire(path.join(process.env.TVS_PLAYWRIGHT_MODULES||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),'package.json'))('playwright');}
test('hidden Electron executes semantic commands, dated norms and catalog merge through real preload and JSON/SQLite storage',{timeout:180000},async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-native-commands-')),profile=path.join(directory,'profile');let app;
  t.after(async()=>{if(app){await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(win=>win.destroy())).catch(()=>{});await app.close().catch(()=>{});}const target=path.resolve(directory);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith('tvs-native-commands-'));fs.rmSync(target,{recursive:true,force:true});});
  fs.mkdirSync(profile);
  const fixture=()=>({...Object.fromEntries(storage.SECTIONS.map(name=>[name,[]])),vehicles:[{id:7,plate:'SYNTHETIC NATIVE',fuelGrade:'ДТ',fuel:'diesel',org:'Test',norm:10,fuelBalance:500}],
    tanks:[{id:5,name:'Synthetic native tank',fuel:'diesel',fuelGrade:'ДТ',org:'Test',balanceInit:100}],
    drivers:[{id:3,name:'Synthetic old driver',personnelRoles:['driver'],employmentStatus:'active'},{id:4,name:'Synthetic new driver',personnelRoles:['driver'],employmentStatus:'active'},{id:0,name:'Synthetic duplicate driver',personnelRoles:['driver'],employmentStatus:'active'},{id:'0',name:'Synthetic main driver',personnelRoles:['driver'],employmentStatus:'active'}],
    records:[{id:'august-measurement',vehicleId:7,date:'2026-08-31',km:50,fuelIssued:5000,fuelActual:1,tankMeasured:923.537},{id:'original',vehicleId:7,date:'2026-09-01',km:100,fuelIssued:10,fuelActual:20}],
    assetAssignments:[{id:'old-assignment',assetRef:'v:7',driverId:3,from:'2026-09-01',to:'',site:'Synthetic site',org:'Test',reason:'Synthetic initial assignment'}],
    shiftReports:[{id:'sent-shift',title:'Synthetic sent shift',date:'2026-09-02',assetRef:'v:7',driverId:3,status:'sent',odoStart:100,odoEnd:200,hours:1,result:'Recorded actual work'}],
    fuelCards:[{id:'cash',number:'НАЛИЧКА',provider:'Наличка',assignments:[]}],appMeta:[{id:'meta',toPlanInit:'test'}]});
  const jsonDir=path.join(directory,'json'),sqlDir=path.join(directory,'sqlite');storage.writeAll(jsonDir,fixture());sqlite.create(sqlDir,{data:fixture()});
  fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({users:[{name:'Synthetic JSON',dataDir:jsonDir},{name:'Synthetic SQLite',dataDir:sqlDir}],activeUser:0,networkMode:'local',networkKey:'synthetic-native-command-key',serverPort:3377,remotePort:3377,remoteHost:'127.0.0.1'}));
  const bootstrap=path.join(directory,'bootstrap.cjs');
  fs.writeFileSync(bootstrap,`const Module=require('node:module'),original=Module._load,electron=original('electron',module,false);const HiddenWindow=new Proxy(electron.BrowserWindow,{construct(Target,args){const win=new Target({...args[0],show:false});win.show=()=>{};win.showInactive=()=>{};return win;}});Module._load=function(request,parent,isMain){if(request==='electron')return {...electron,BrowserWindow:HiddenWindow};return original.apply(this,arguments);};electron.app.setAppPath(${JSON.stringify(root)});require(${JSON.stringify(path.join(root,'electron/main.js'))});`);
  const packaged=process.env.TVS_PACKAGED_EXE;app=await pw._electron.launch({executablePath:packaged||require('electron'),args:[...(packaged?[]:[bootstrap]),'--user-data-dir='+profile,'--tvs-test-hidden'],cwd:root});const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.waitForFunction(()=>typeof data!=='undefined'&&data.vehicles[0]?.id===7);
  await page.evaluate(async()=>{localStorage.setItem('changelogSeenVersion',await window.electronAPI.getAppVersion());if(document.getElementById('genericModal'))closeModal('genericModal');});
  assert.equal(await app.evaluate(({app})=>app.getPath('userData')),profile);
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(win=>win.isVisible())),false);
  for(const [index,dir]of [jsonDir,sqlDir].entries()){
    if(index){await page.evaluate(async()=>{await window.electronAPI.switchUser(1);data=await loadData();rebuildIndex();});}
    const originalRows=storage.readAll(dir).records;
    for(const [section,id]of [['vehicles',7],['tanks',5]]){
      await page.evaluate(({section,id})=>{if(section==='vehicles'){activeSection='vehicles';renderDetail(data.vehicles.find(row=>row.id===id));}else{activeSection='generators';renderTankDetail(data.tanks.find(row=>row.id===id));}},{section,id});
      await page.getByRole('button',{name:'Начало учёта ГСМ',exact:true}).click();
      const form=page.locator('#fuelAccountingForm');await form.locator('[name="from"]').fill('2026-09-01');await form.locator('[name="opening"]').fill('923,537');await form.locator('[name="basis"]').fill('Synthetic physical measurement on 31 August');
      await form.locator('[data-fa-review]').click();await form.locator('[name="confirm"]').check();await form.locator('[data-fa-save]').click();
      await page.waitForFunction(()=>!document.querySelector('#fuelAccountingForm')||!document.querySelector('#fuelAccountingForm').closest('.modal-overlay')?.classList.contains('open'));
      const saved=storage.readAll(dir)[section].find(row=>row.id===id);assert.equal(saved.fuelAccounting.opening,923.537);assert.equal(saved.fuelAccounting.from,'2026-09-01');assert.equal(saved[section==='vehicles'?'fuelBalance':'balanceInit'],section==='vehicles'?500:100);
    }
    assert.deepEqual(storage.readAll(dir).records,originalRows);
    await page.evaluate(()=>fuelNormsOpen('vehicles',7));
    const periods=page.locator('#effectiveParametersForm');await periods.locator('[data-ep-copy]').click();await periods.locator('[name="from"]').fill('2026-06-01');await periods.locator('[name="basis"]').fill('Synthetic confirmed original norm');await periods.locator('[data-ep-stage]').click();
    await periods.locator('[name="from"]').fill('2026-11-01');await periods.locator('[name="norm"]').fill('20');await periods.locator('[name="basis"]').fill('Synthetic confirmed future norm');await periods.locator('[data-ep-stage]').click();await periods.locator('[data-ep-review]').click();await periods.locator('[name="confirm"]').check();await periods.locator('[data-ep-save]').click();await page.waitForFunction(()=>!document.querySelector('#wfModal.open'));
    const datedVehicle=storage.readAll(dir).vehicles[0];assert.equal(datedVehicle.norm,10);assert.deepEqual(datedVehicle.fuelNorms.periods.map(row=>row.from),['2026-06-01','2026-11-01']);assert.deepEqual(storage.readAll(dir).records,originalRows);
    const datedValues=await page.evaluate(()=>{const v=data.vehicles[0];return ['2026-09-10','2026-11-10'].map(date=>TvsFuelEngine.fqRecord({date,km:100},v).norm);});assert.deepEqual(datedValues,[10,20]);
    const result=await page.evaluate(async index=>{
      const issue={type:'IssueFuel',version:1,input:{tankId:5,target:{section:'vehicles',id:7},date:'2026-10-01',qty:80.537,reason:'Synthetic native command'}};
      const issued=await platformExecuteCommand(issue,{operationId:'native-issue-'+index});
      const replayed=await window.electronAPI.executeCommand(JSON.stringify(_platformCommandIntents.get('native-issue-'+index).envelope));
      const accepted=await platformExecuteCommand({type:'AcceptShift',version:1,input:{shiftId:'sent-shift',changes:{acceptedBy:'Physical shift recipient',result:'Actual work accepted'}}},{operationId:'native-accept-'+index});
      const assigned=await platformExecuteCommand({type:'AssignPerson',version:1,input:{driverId:4,target:{section:'vehicles',id:7},from:'2026-10-01',site:'Synthetic site',reason:'Explicit driver replacement',replacesAssignmentId:'old-assignment'}},{operationId:'native-assignment-'+index});
      return {issued,accepted,assigned,replayed,queue:await window.electronAPI.getPendingOperations(),source:structuredClone(data),persisted:JSON.parse(_lastPersisted)};
    },index);
    for(const name of ['issued','accepted','assigned'])assert.equal(result[name].ok,true,JSON.stringify({name,result:result[name]}));
    assert.equal(result.replayed.operationReceipt.status,'replayed');assert.equal(result.replayed.operationReceipt.digest,result.issued.operationReceipt.digest);
    const actual=storage.readAll(dir),movement=actual.fuelMovements[0],record=actual.records.find(row=>row.fuelMovementId===movement.id);
    assert.equal(actual.fuelMovements.length,1);assert.equal(record.fuelIssued,80.537);assert.equal(record.vehicleId,7);assert.equal(record.km,0);assert.equal(actual.records.find(row=>row.id==='original').km,100);assert.equal(actual.vehicles[0].fuelBalance,500);assert.equal(actual.vehicles[0].fuelAccounting.opening,923.537);
    const physical=await page.evaluate(()=>({tank:computeTankBalanceAt(5,'2026-10-31',true),vehicle:TvsFuelEngine.buildLedger(data,{from:'2026-10-01',to:'2026-10-31'}).rows.reduce((sum,row)=>sum+row.end,0),km:recsFor(7).reduce((sum,row)=>sum+row.km,0)}));assert.ok(Math.abs(physical.tank-843)<1e-8);assert.ok(Math.abs(physical.vehicle-994.074)<1e-8);assert.equal(physical.km,150);
    assert.equal(actual.shiftReports[0].status,'accepted');assert.equal(actual.shiftReports[0].acceptedBy,'Physical shift recipient');assert.equal(actual.shiftReports[0].acceptedActor.id,'local-profile');assert.equal(actual.shiftReports[0].acceptedActor.name,index?'Synthetic SQLite':'Synthetic JSON');assert.ok(actual.shiftReports[0].acceptedAt);
    assert.equal(actual.assetAssignments.find(row=>row.id==='old-assignment').to,'2026-09-30');assert.equal(actual.assetAssignments.find(row=>row.id==='native-assignment-'+index).driverId,4);
    assert.deepEqual(result.source.fuelMovements,actual.fuelMovements);assert.deepEqual(result.persisted.assetAssignments,actual.assetAssignments);
    for(const id of ['native-issue-','native-accept-','native-assignment-'])assert.equal(result.queue.operations.find(row=>row.id===id+index).status,'committed');
    assert.equal(actual.auditLog.filter(row=>row.type==='transaction'&&row.operationId==='native-issue-'+index).length,1);
    await page.evaluate(()=>{catalogMergeOpen('drivers',0);window.__nativeMergeState=catalogMergeSession;});
    const merge=page.locator('#catalogMergeForm'),targetToken=await page.evaluate(()=>catalogMergeSession.choices.find(choice=>choice.id==='0').token);await merge.locator('[name="target"]').selectOption(targetToken);await merge.locator('[name="reason"]').fill('Synthetic confirmed duplicate without factual history');await merge.locator('[data-cm-preview]').click();assert.equal(await page.evaluate(()=>catalogMergeSession.preview?.canMerge),true,await merge.innerText());
    const review=await page.evaluate(()=>({data:structuredClone(data),input:catalogMergeInput(catalogMergeSession),today:catalogMergeSession.today,fingerprint:catalogMergeSession.preview.fingerprint}));assert.equal(catalogMerge.preview(review.data,review.input,{today:review.today}).fingerprint,review.fingerprint,'native renderer and Node must compute the same reviewed graph');const storedBeforeMerge=storage.readAll(dir),principal={id:'local-profile',name:index?'Synthetic SQLite':'Synthetic JSON',role:'admin'},projectedBeforeMerge=Object.fromEntries(storage.SECTIONS.map(name=>[name,platform.visibleRows(name,storedBeforeMerge[name],principal,storedBeforeMerge)])),different=storage.SECTIONS.filter(name=>kernel.stableSerialize(projectedBeforeMerge[name]||[])!==kernel.stableSerialize(review.data[name]||[]));
    assert.deepEqual(different,[],'renderer data must exactly match the trusted current projection');
    assert.ok(storedBeforeMerge.auditLog.some(row=>Object.hasOwn(row,'archiveScope')),'the physical audit must retain its trusted print scope proof');
    assert.ok(projectedBeforeMerge.auditLog.every(row=>!Object.hasOwn(row,'archiveScope')));assert.ok(review.data.auditLog.every(row=>!Object.hasOwn(row,'archiveScope')),'private print scope proofs must not enter the renderer');
    const publicAudit=storedBeforeMerge.auditLog.map(({archiveScope,...row})=>row);assert.deepEqual(projectedBeforeMerge.auditLog,publicAudit,'all remaining business audit facts must stay in the projected history');
    assert.equal(catalogMerge.preview(projectedBeforeMerge,review.input,{today:review.today}).fingerprint,review.fingerprint,'trusted public projection and renderer must review the same graph');
    assert.equal(catalogMerge.preview(storedBeforeMerge,review.input,{today:review.today}).fingerprint,review.fingerprint,'the trusted full source must validate the same catalog review without exposing private audit proof');
    await merge.locator('[name="confirm"]').check();await merge.locator('[data-cm-save]').click();await page.waitForFunction(()=>!document.querySelector('#wfModal.open')||!!document.querySelector('[data-cm-error]')?.textContent.trim());assert.equal(await page.evaluate(()=>document.querySelector('#wfModal.open [data-cm-error]')?.textContent||''),'');
    const merged=storage.readAll(dir),alias=merged.drivers.find(row=>row.id===0);assert.equal(alias.archived,true);assert.equal(alias.mergedInto.id,'0');assert.equal(alias.mergedInto.actor.id,'local-profile');assert.equal(alias.mergedInto.section,'drivers');assert.deepEqual(merged.records,actual.records);assert.deepEqual(merged.assetAssignments,actual.assetAssignments);assert.deepEqual(merged.drivers.find(row=>row.id==='0'),actual.drivers.find(row=>row.id==='0'));
    const mergeReplay=await page.evaluate(async()=>window.electronAPI.executeCommand(JSON.stringify(_platformCommandIntents.get(window.__nativeMergeState.operationId).envelope)));assert.equal(mergeReplay.operationReceipt.status,'replayed');assert.equal(storage.readAll(dir).auditLog.filter(row=>row.type==='transaction'&&row.operationId===alias.mergedInto.operationId).length,1);
  }
  assert.deepEqual(errors,[]);
});
