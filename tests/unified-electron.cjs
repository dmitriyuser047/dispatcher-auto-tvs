const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawn } = require('node:child_process');
const storage = require('../electron/storage');
const sqlite = require('../electron/sqlite-storage.cjs');
const root = path.resolve(__dirname, '..');
let pw;
try { pw = require('playwright'); }
catch {
  const modules = process.env.TVS_PLAYWRIGHT_MODULES || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
  pw = createRequire(path.join(modules, 'package.json'))('playwright');
}

test('hidden Electron application persists synthetic journals, isolates registry sessions and edits PDFs', { timeout:180000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tvs-unified-native-'));
  let app;
  t.after(async () => {
    if (app) {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(win => win.destroy())).catch(() => {});
      await app.close().catch(() => {});
    }
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('tvs-unified-native-'));
    fs.rmSync(dir, { recursive:true, force:true });
  });
  const profile = path.join(dir, 'profile'), dataA = path.join(dir, 'A'), dataB = path.join(dir, 'B');
  fs.mkdirSync(profile);
  const fixture = id => ({ vehicles:[{ id, make:'Synthetic vehicle', plate:id, driver:'Synthetic driver', org:'A', norm:10, fuelGrade:'ДТ', fuelBalance:100 }], records:[], reestrRows:[{ id:'original-'+id, sum:1 }], appMeta:[] });
  storage.writeAll(dataA, fixture('A'));
  // The same real Electron shell must support JSON and explicit SQLite profiles.
  sqlite.create(dataB,{ data:fixture('B') });
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ users:[{ name:'Test A',dataDir:dataA },{ name:'Test B',dataDir:dataB }], activeUser:0, networkMode:'local', serverPort:3377, remotePort:3377, remoteHost:'127.0.0.1', networkKey:'synthetic-native-key-not-a-secret' }));
  const bootstrap = path.join(dir, 'bootstrap.cjs');
  fs.writeFileSync(bootstrap, `const Module=require('node:module');const original=Module._load;const electron=original('electron',module,false);const HiddenWindow=new Proxy(electron.BrowserWindow,{construct(Target,args){const win=new Target({...args[0],show:false});win.show=()=>{};win.showInactive=()=>{};return win;}});Module._load=function(request,parent,isMain){if(request==='electron')return {...electron,BrowserWindow:HiddenWindow};return original.apply(this,arguments);};electron.app.setAppPath(${JSON.stringify(root)});require(${JSON.stringify(path.join(root, 'electron/main.js'))});`);
  const executablePath = process.env.TVS_PACKAGED_EXE || require('electron');
  const args = process.env.TVS_PACKAGED_EXE ? ['--user-data-dir='+profile,'--tvs-test-hidden'] : [bootstrap,'--user-data-dir='+profile,'--tvs-test-hidden'];
  app = await pw._electron.launch({ executablePath, args, cwd:root });
  const page = await app.firstWindow(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => typeof data !== 'undefined' && data.vehicles[0]?.id === 'A');
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
  if (process.env.TVS_PACKAGED_EXE) {
    const identity=await app.evaluate(({app})=>({name:app.getName(),version:app.getVersion()}));
    assert.equal(identity.name,'dispetcherizaciya-avto');
    assert.equal(identity.version,require('../package.json').version);
    assert.equal(await page.locator('#unifiedNav').innerText().then(text=>/прототип/i.test(text)),false);
    assert.equal(await page.locator('.unified-build-label').innerText(),'Версия '+require('../package.json').version);
  }
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(win => win.isVisible())), false);

  const first = await page.evaluate(async () => {
    for (const section of ['home','vehicles','generators','tanks','dispatch','workflows','reestr','toSchedule','repairs','finances','costs','procurement','contragents','reports','printForms','fuelReport','fuelPurchases']) switchSection(section);
    const snap = JSON.parse(await window.electronAPI.readSnapshot());
    data.records.push({ id:'native-journal',vehicleId:'A',date:'2026-10-01',km:100,odoStart:1000,odoEnd:1100,fuelIssued:0,fuelActual:10,fuelGrade:'ДТ',driver:'Synthetic driver' });
    const saved = await saveData(data);
    return { saved, token:snap.databaseToken, identity:await window.electronAPI.getDataIdentity(), operationReceipt:_sync.lastResult?.operationReceipt, platform:snap.platform,
      ...(saved?{}:{failure:platformRuntimeStatus().lastError,syncResult:_sync.lastResult}) };
  });
  assert.equal(first.saved, true,JSON.stringify(first));
  assert.deepEqual(first.platform, {apiVersion:1,operations:1,outbox:1,receiptQuery:1,commands:1,schemaVersion:2,documentDrafts:1,periods:1,needsSchemaUpgrade:false});
  assert.equal(first.operationReceipt?.status, 'committed'); assert.ok(first.operationReceipt.id);
  assert.equal(storage.readAll(dataA).records[0].id, 'native-journal');
  assert.match(first.token, /^[a-f0-9]{64}$/);
  assert.ok(first.identity.endsWith(':'+first.token));

  const background = await page.evaluate(async () => {
    const page=await window.electronAPI.queryRows({section:'vehicles',limit:1});
    const fuel=await dispatcherQueryAsync('fuel',{from:'2026-10-01',to:'2026-10-31'});
    const health=await dispatcherHealthAsync();
    return {ok:page.ok,ids:page.rows?.map(row=>row.id),backend:page.backend,token:page.databaseToken,
      fuelRows:fuel.rows.length,healthSections:health.sections.filter(row=>row.readable).length};
  });
  assert.equal(background.ok,true);assert.deepEqual(background.ids,['A']);assert.equal(background.backend,'json');
  assert.equal(background.token,first.token);assert.ok(background.fuelRows>0);assert.equal(background.healthSections,storage.SECTIONS.length);
  const beforeBackgroundPlan=storage.readSnapshot(dataA);
  const backgroundPlan=await page.evaluate(async()=>{
    const previous=structuredClone(data);
    previous.records=Array.from({length:1000},(_,index)=>({id:'native-prepare-'+index,vehicleId:'A',date:'2026-10-01',km:0,fuelActual:0,fuelGrade:'ДТ'}));
    const next=structuredClone(previous);next.records[0].note='Synthetic background preflight';
    const context={...platformSessionContext(),id:'native-background-plan',now:'2026-10-21T12:00:00.000Z'};
    const plan=await platformPrepareInBackground(previous,next,context);
    return {id:plan.id,changed:plan.changed,note:plan.sections.records[0].note,status:platformPrepareBackgroundStatus()};
  });
  assert.equal(backgroundPlan.id,'native-background-plan');assert.deepEqual(backgroundPlan.changed,['records']);
  assert.equal(backgroundPlan.note,'Synthetic background preflight');assert.equal(backgroundPlan.status.active,0);
  assert.deepEqual(storage.readSnapshot(dataA),beforeBackgroundPlan);

  // Full-write IPC must use the revisions bound by readSnapshot, even when
  // the renderer sends neither base nor auditLog. An old audit prefix would
  // independently reject the save and conceal a missing CAS check.
  const staleFull = await page.evaluate(async () => {
    const snapshot = JSON.parse(await window.electronAPI.readSnapshot());
    const { auditLog, ...source } = snapshot.data;
    source.vehicles[0].note = 'Stale full IPC description';
    return { databaseToken:snapshot.databaseToken, data:source };
  });
  const concurrentBase = storage.readSnapshot(dataA);
  const concurrentFull = storage.writeSections(dataA, { databaseToken:concurrentBase.databaseToken,
    base:{ vehicles:concurrentBase.revisions.vehicles },
    sections:{ vehicles:concurrentBase.data.vehicles.map(row => ({ ...row,note:'Concurrent native description' })) } });
  assert.equal(concurrentFull.ok, true);
  const beforeStaleFull = storage.readSnapshot(dataA);
  assert.equal(await page.evaluate(payload => window.electronAPI.writeData(JSON.stringify(payload)), staleFull), false);
  assert.deepEqual(storage.readSnapshot(dataA), beforeStaleFull);
  const freshFull = await page.evaluate(async () => {
    const snapshot = JSON.parse(await window.electronAPI.readSnapshot());
    const { auditLog, ...source } = snapshot.data;
    source.vehicles[0].note = 'Fresh full IPC description';
    const saved = await window.electronAPI.writeData(JSON.stringify({ databaseToken:snapshot.databaseToken,data:source }));
    data = await loadData(); rebuildIndex();
    return { saved,note:data.vehicles[0].note };
  });
  assert.deepEqual(freshFull, { saved:true,note:'Fresh full IPC description' });
  const afterFreshFull = storage.readSnapshot(dataA);
  assert.equal(afterFreshFull.data.vehicles[0].note, freshFull.note);
  assert.equal(afterFreshFull.revisions.vehicles, beforeStaleFull.revisions.vehicles + 1);
  assert.ok(afterFreshFull.data.auditLog.some(row => row.section === 'vehicles' && row.after?.note === freshFull.note));

  const features = await page.evaluate(async () => {
    data.costEntries.push({id:'native-cost',date:'2026-10-01',assetRef:'v:A',kind:'expense',amount:1000,title:'Synthetic standalone cost',category:'Прочее',independent:true});
    data.costProfiles.push({id:'native-profile',assetRef:'v:A',salaryRate:5,fuelRate:10,fuelPrice:60});
    data.parts.push({id:'native-part',name:'Synthetic filter',unit:'шт'});
    data.procurementRules.push({id:'native-rule',kind:'part',itemId:'native-part',leadDays:3,reserveQty:2,coverDays:7,expectedDaily:null});
    data.procurementOrders.push({id:'native-order',kind:'part',itemId:'native-part',supplier:'Synthetic supplier',quantity:10,receivedQty:2,stockPostedQty:0,deliveryDate:'2026-10-20',status:'partial',note:''});
    const saved=await saveData(data);
    switchSection('costs');switchSection('procurement');
    const state=await window.electronAPI.getNotificationSettings();
    const preferences={...state.preferences,enabled:true,quietEnabled:false};
    const enabled=await window.electronAPI.saveNotificationSettings({key:state.key,preferences});
    const probe=await window.electronAPI.testNotification({key:state.key});
    const stale=await window.electronAPI.saveNotificationSettings({key:'0'.repeat(64),preferences});
    await openNotificationSettings();const modal=!!document.querySelector('#notificationsModal.open');document.getElementById('notificationsModal')?.remove();
    return {saved,state,enabled,probe,stale,modal,operationReceipt:_sync.lastResult?.operationReceipt};
  });
  assert.equal(features.saved,true);assert.equal(features.state.ok,true);assert.equal(features.state.preferences.enabled,false);
  assert.equal(features.state.supported,false);assert.equal(features.enabled.preferences.enabled,true);assert.equal(features.probe.ok,false);assert.equal(features.probe.code,'test-mode');assert.equal(features.stale.ok,false);assert.equal(features.modal,true);
  const featureData=storage.readAll(dataA);
  assert.equal(featureData.costEntries[0].amount,1000);assert.equal(featureData.costProfiles[0].salaryRate,5);assert.equal(featureData.procurementOrders[0].receivedQty,2);assert.equal(featureData.procurementRules[0].reserveQty,2);assert.deepEqual(featureData.partMovements,[]);
  assert.equal(features.operationReceipt?.status,'committed');
  for(const section of ['costEntries','costProfiles','parts','procurementRules','procurementOrders']){
    const event=featureData.auditLog.find(row=>row.section===section&&row.operationId===features.operationReceipt.id);
    assert.ok(event,section);assert.equal(event.actorId,'local-profile');assert.equal(event.actor,'Test A');assert.equal(event.actorRole,'admin');assert.equal(event.source,'platform');
  }
  assert.equal(featureData.auditLog.filter(row=>row.type==='transaction'&&row.operationId===features.operationReceipt.id).length,1);
  const replayedNative=await page.evaluate(async()=>{
    const snapshot=JSON.parse(await window.electronAPI.readSnapshot()),id='native-ipc-'+crypto.randomUUID();
    const payload={databaseToken:snapshot.databaseToken,base:{opsTasks:snapshot.revisions.opsTasks},sections:{opsTasks:[...(snapshot.data.opsTasks||[]),{id:'native-idempotent-task',title:'Synthetic native command',status:'open'}]},operation:{id}};
    const first=await window.electronAPI.writeSections(JSON.stringify(payload)),second=await window.electronAPI.writeSections(JSON.stringify(payload));
    data=await loadData();rebuildIndex();
    return{id,first,second};
  });
  assert.equal(replayedNative.first.ok,true);assert.equal(replayedNative.second.ok,true);assert.equal(replayedNative.second.replayed,true);assert.deepEqual(replayedNative.second.changed,[]);
  assert.equal(replayedNative.second.operationReceipt.id,replayedNative.id);
  const replayData=storage.readAll(dataA);
  assert.equal(replayData.opsTasks.filter(row=>row.id==='native-idempotent-task').length,1);
  assert.equal(replayData.auditLog.filter(row=>row.type==='transaction'&&row.operationId===replayedNative.id).length,1);
  // The private journal stores committed receipts without retaining submitted
  // financial/journal bodies. All inspected files belong to this temp profile.
  const outboxDirectory=path.join(profile,'pending-operations');
  assert.equal(path.dirname(outboxDirectory),profile);
  const outboxRecords=()=>fs.readdirSync(outboxDirectory).filter(name=>/^[a-f0-9]{64}\.json$/.test(name))
    .map(name=>JSON.parse(fs.readFileSync(path.join(outboxDirectory,name),'utf8')));
  const nativeQueue=await page.evaluate(()=>window.electronAPI.getPendingOperations());
  assert.equal(nativeQueue.ok,true);
  for(const id of [first.operationReceipt.id,features.operationReceipt.id,replayedNative.id]){
    const metadata=nativeQueue.operations.find(row=>row.id===id),record=outboxRecords().find(row=>row.id===id);
    assert.ok(metadata,id);assert.equal(metadata.status,'committed');assert.ok(record,id);
    assert.equal(record.status,'committed');assert.equal(record.payloadJson,null);assert.equal(record.receipt.id,id);
    assert.match(record.scope,/^[a-f0-9]{64}$/);assert.match(record.checksum,/^[a-f0-9]{64}$/);
    assert.equal(Object.hasOwn(metadata,'payloadJson'),false);assert.equal(Object.hasOwn(metadata,'payload'),false);
  }
  const nativeScope=outboxRecords().find(row=>row.id===first.operationReceipt.id).scope;
  const durableOutbox=require('../electron/command-outbox.cjs').createCommandOutbox({rootDir:outboxDirectory});
  const recoveredId='native-durable-recovery',recoveryBase=storage.readSnapshot(dataA);
  durableOutbox.stage(nativeScope,{databaseToken:recoveryBase.databaseToken,base:{opsTasks:recoveryBase.revisions.opsTasks},
    sections:{opsTasks:[...recoveryBase.data.opsTasks,{id:'native-recovered-task',status:'open',title:'Synthetic durable original request'}]},
    operation:{id:recoveredId}},{supportsOperations:true});
  const beforeRecovery=await page.evaluate(()=>window.electronAPI.getPendingOperations());
  assert.equal(beforeRecovery.operations.find(row=>row.id===recoveredId).status,'pending');
  const recovered=await page.evaluate(async id=>{
    const result=await window.electronAPI.retryOperation(id);
    data=await loadData();rebuildIndex();return result;
  },recoveredId);
  assert.equal(recovered.ok,true);assert.equal(recovered.operationReceipt.id,recoveredId);
  assert.equal(storage.readAll(dataA).opsTasks.filter(row=>row.id==='native-recovered-task').length,1);
  assert.equal(storage.readAll(dataA).auditLog.filter(row=>row.type==='transaction'&&row.operationId===recoveredId).length,1);
  const recoveredRecord=outboxRecords().find(row=>row.id===recoveredId);
  assert.equal(recoveredRecord.status,'committed');assert.equal(recoveredRecord.payloadJson,null);
  assert.equal(JSON.stringify(recoveredRecord).includes('Synthetic durable original request'),false);
  const reconciled=await page.evaluate(id=>window.electronAPI.reconcileOperation(id),recoveredId);
  assert.equal(reconciled.ok,true);assert.equal(reconciled.committed,true);
  assert.equal(storage.readAll(dataA).auditLog.filter(row=>row.type==='transaction'&&row.operationId===recoveredId).length,1);
  for (const request of ['/electron/main.js','/package.json','/bundled-data/data-2.0.57.json']) assert.equal(await page.evaluate(url => fetch(url).then(res => res.status), request), 403);

  // The actual native section protocol must acknowledge the backend's document,
  // protect its source facts and retain the snapshot after explicit cancellation.
  const postedAct = await page.evaluate(async () => {
    const sourceNames = ['vehicles','records','fuelPurchases','fuelCards','monthlyFuel','fuelPeriods'];
    const sourceBytes = () => JSON.stringify(Object.fromEntries(sourceNames.map(name => [name,data[name] || []])));
    const before = sourceBytes();
    fpMonth = '2026-10'; fpView = 'writeoff'; gsmOrg = 'A'; gsmFuel = 'ДТ'; gsmActNo = 'NATIVE-2026-10'; gsmActDate = '2026-10-31';
    switchSection('fuelPurchases'); gsmPostWriteoffDialog();
    const form = document.getElementById('gsmWriteoffPostForm');
    if (!form) throw Error('Native posting dialog did not open');
    form.elements.actNo.value = 'NATIVE-2026-10'; form.elements.actDate.value = '2026-10-31'; form.elements.basisNote.value = 'Native synthetic confirmed sources';
    await gsmPostWriteoff({ preventDefault() {} });
    const doc = data.fuelWriteoffs?.[0];
    if (!doc) throw Error('Native posting failed: ' + (document.getElementById('gsmWriteoffPostError')?.textContent || 'missing document'));
    return { before, after:sourceBytes(), doc, synced:JSON.parse(_sync.synced.fuelWriteoffs), revision:_sync.revs.fuelWriteoffs };
  });
  assert.equal(postedAct.after, postedAct.before);
  assert.equal(postedAct.doc.status, 'posted'); assert.equal(postedAct.doc.number, 'NATIVE-2026-10');
  assert.equal(postedAct.doc.postedBy.id, 'local-profile'); assert.equal(postedAct.doc.postedBy.name, 'Test A'); assert.equal(postedAct.doc.postedBy.role, 'admin');
  assert.deepEqual(postedAct.doc.events, [{ type:'posted',at:postedAct.doc.postedAt,by:postedAct.doc.postedBy }]);
  assert.equal(postedAct.doc.totals.spent, 10); assert.equal(postedAct.doc.totals.end, 90);
  assert.deepEqual(postedAct.synced, [postedAct.doc]); assert.ok(Number.isSafeInteger(postedAct.revision));
  const nativePosted = storage.readAll(dataA);
  assert.deepEqual(nativePosted.fuelWriteoffs, [postedAct.doc]);
  for (const name of ['vehicles','records','fuelPurchases','fuelCards','monthlyFuel','fuelPeriods']) assert.deepEqual(nativePosted[name], featureData[name], name);
  const blockedSource = await page.evaluate(async () => {
    data.records.find(row => row.id === 'native-journal').fuelActual = 11;
    const saved = await saveData(data, { noMerge:true });
    return { saved,actual:data.records.find(row => row.id === 'native-journal').fuelActual };
  });
  assert.equal(blockedSource.saved, false); assert.equal(blockedSource.actual, 10);
  assert.deepEqual(storage.readAll(dataA).records, nativePosted.records);
  assert.deepEqual(storage.readAll(dataA).fuelWriteoffs, [postedAct.doc]);
  const voidedAct = await page.evaluate(async id => {
    gsmVoidWriteoffDialog(id);
    const form = document.getElementById('gsmWriteoffVoidForm');
    if (!form) throw Error('Native cancellation dialog did not open');
    form.elements.reason.value = 'Native synthetic correction after explicit cancellation';
    await gsmVoidWriteoff({ preventDefault() {} });
    return { doc:data.fuelWriteoffs.find(row => row.id === id), synced:JSON.parse(_sync.synced.fuelWriteoffs) };
  }, postedAct.doc.id);
  assert.equal(voidedAct.doc.status, 'void'); assert.deepEqual(voidedAct.doc.snapshot, postedAct.doc.snapshot);
  assert.equal(voidedAct.doc.voidedBy.id, 'local-profile'); assert.equal(voidedAct.doc.voidedBy.name, 'Test A');
  assert.deepEqual(voidedAct.doc.events[0], postedAct.doc.events[0]); assert.equal(voidedAct.doc.events[1].type, 'void');
  assert.deepEqual(voidedAct.synced, [voidedAct.doc]); assert.deepEqual(storage.readAll(dataA).fuelWriteoffs, [voidedAct.doc]);
  assert.deepEqual(storage.readAll(dataA).records, nativePosted.records);

  // A second process with the same profile exits without running another writer.
  if (!process.env.TVS_PACKAGED_EXE) {
    const child = spawn(executablePath, args, { cwd:root, windowsHide:true, stdio:'ignore' });
    const code = await new Promise((resolve,reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error('Second Electron instance did not exit')); },15000);
      child.on('error', reject); child.on('exit', code => { clearTimeout(timer); resolve(code); });
    });
    assert.equal(code, 0);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  }

  const foreignOpening = app.waitForEvent('window');
  const foreignId = await app.evaluate(async ({ BrowserWindow }, preload) => {
    const win = new BrowserWindow({ show:false, webPreferences:{ preload,contextIsolation:true,nodeIntegration:false,sandbox:true } });
    await win.loadURL('data:text/html,<p>Synthetic foreign page</p>');
    return win.webContents.id;
  }, path.join(root,'electron/preload.js'));
  const foreign = await foreignOpening;
  assert.equal(await foreign.evaluate(async () => { try { await window.electronAPI.getSettings();return false; } catch (e) { return e.message.includes('Недоверенный'); } }), true);
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows().find(win=>win.webContents.id===id).destroy(), foreignId);

  const registers = [];
  for (const name of ['first','second']) {
    const waiting = app.waitForEvent('window');
    await page.evaluate(name => window.electronAPI.openReestrWindow({ rows:[{ id:name,sum:10,description:name }], log:[],statyi:[],contracts:[],vehicles:data.vehicles }), name);
    const register = await waiting; registers.push(register);
    register.on('pageerror', error => errors.push(error.message));
    await register.waitForFunction(() => typeof rows !== 'undefined' && rows.length === 1);
  }
  assert.equal((await registers[0].evaluate(() => window.reestrWindow.getData())).rows[0].id, 'first');
  assert.equal((await registers[1].evaluate(() => window.reestrWindow.getData())).rows[0].id, 'second');
  const savedRegister = await registers[0].evaluate(() => window.reestrWindow.saveRows([{ id:'saved-A',sum:42 }]));
  assert.equal(savedRegister.ok, true);
  await page.waitForFunction(() => data.reestrRows[0]?.id === 'saved-A');
  assert.equal(storage.readAll(dataA).reestrRows[0].sum, 42);
  const xlsx = await registers[0].evaluate(() => window.reestrAPI.buildXlsx({ rows:[{ id:'xlsx-only',sum:42,date:'18.10.2026',description:'Synthetic registry',osn:'N-1' }] }));
  assert.ok(xlsx.xlsxBase64.length > 100);
  assert.equal((await registers[1].evaluate(() => window.reestrWindow.saveRows([{ id:'stale',sum:99 }]))).ok, false);

  await page.evaluate(() => window.electronAPI.setTheme('dark'));
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await registers[0].waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  const isolatedId='native-profile-A-pending',isolatedBase=storage.readSnapshot(dataA);
  durableOutbox.stage(nativeScope,{databaseToken:isolatedBase.databaseToken,base:{opsTasks:isolatedBase.revisions.opsTasks},
    sections:{opsTasks:[...isolatedBase.data.opsTasks,{id:'must-stay-in-profile-A',status:'open',title:'Synthetic profile A pending request'}]},
    operation:{id:isolatedId}},{supportsOperations:true});
  assert.equal((await page.evaluate(()=>window.electronAPI.getPendingOperations())).operations.find(row=>row.id===isolatedId).status,'pending');
  const afterSwitch = await page.evaluate(async token => {
    await window.electronAPI.switchUser(1);
    const stale = await window.electronAPI.writeSections(JSON.stringify({ databaseToken:token,base:{vehicles:2},sections:{vehicles:[{id:'WRONG'}]} }));
    data = await loadData(); rebuildIndex();
    return { stale, vehicle:data.vehicles[0]?.id };
  }, first.token);
  assert.equal(afterSwitch.stale.ok, false);
  assert.equal(afterSwitch.vehicle, 'B');
  const newProfileQueue=await page.evaluate(async id=>({queue:await window.electronAPI.getPendingOperations(),retry:await window.electronAPI.retryOperation(id)}),isolatedId);
  assert.equal(newProfileQueue.queue.ok,true);assert.deepEqual(newProfileQueue.queue.operations,[]);assert.equal(newProfileQueue.retry.ok,false);
  assert.equal(outboxRecords().find(row=>row.id===isolatedId).status,'pending');
  assert.equal(storage.readAll(dataB).opsTasks.some(row=>row.id==='must-stay-in-profile-A'),false);
  assert.equal(storage.readAll(dataA).opsTasks.some(row=>row.id==='must-stay-in-profile-A'),false);
  assert.equal((await registers[0].evaluate(() => window.reestrWindow.saveRows([]))).ok, false);
  assert.equal(storage.readAll(dataB).vehicles[0].id, 'B');
  assert.equal(storage.readAll(dataB).reestrRows[0].id, 'original-B');
  const sqliteSave=await page.evaluate(async()=>{
    data.records.push({id:'native-sqlite-journal',vehicleId:'B',date:'2026-10-02',km:25.125,fuelIssued:0,fuelActual:2.125,fuelGrade:'ДТ'});
    return {saved:await saveData(data),receipt:_sync.lastResult?.operationReceipt};
  });
  assert.equal(sqliteSave.saved,true);assert.equal(sqliteSave.receipt?.status,'committed');
  assert.equal(storage.readAll(dataB).records[0].km,25.125);
  assert.equal(storage.readAll(dataB).records[0].fuelActual,2.125);
  const sqlitePage=await page.evaluate(()=>window.electronAPI.queryRows({section:'records',limit:1,assetRef:'v:B',from:'2026-10-01'}));
  assert.equal(sqlitePage.ok,true);assert.equal(sqlitePage.backend,'sqlite');assert.equal(sqlitePage.total,1);
  assert.equal(sqlitePage.rows[0].fuelActual,2.125);assert.equal(sqlitePage.rows[0].id,'native-sqlite-journal');
  assert.ok(fs.existsSync(sqlite.filename(dataB)));

  const { PDFDocument, StandardFonts } = require('pdf-lib');
  const pdfs = [];
  for (const text of ['FIRST_SYNTHETIC_PDF','SECOND_SYNTHETIC_PDF']) {
    const document = await PDFDocument.create(), font = await document.embedFont(StandardFonts.Helvetica);
    document.addPage().drawText(text,{ x:40,y:700,font });
    const file = path.join(dir,text+'.pdf');fs.writeFileSync(file,await document.save());pdfs.push(file);
  }
  await app.evaluate(({ dialog }, files) => { let next=0;dialog.showOpenDialog=async()=>({canceled:false,filePaths:[files[next++]]}); }, pdfs);
  const textImports = await page.evaluate(async()=>({ summary:await window.electronAPI.importSvodkaPdf(),glonass:await window.electronAPI.importGlonassFile() }));
  assert.equal(textImports.summary.ok,true);assert.ok(textImports.summary.items.some(item=>item.str.includes('FIRST_SYNTHETIC_PDF')));
  assert.equal(textImports.glonass.ok,true);assert.ok(textImports.glonass.items.some(item=>item.str.includes('SECOND_SYNTHETIC_PDF')));
  await app.evaluate(({ dialog }, files) => { let next=0;dialog.showOpenDialog=async()=>({canceled:false,filePaths:[files[next++]]}); }, pdfs);
  const editors = [];
  for (let index=0;index<2;index++) {
    const waiting=app.waitForEvent('window');await page.evaluate(()=>window.electronAPI.openPdfEditor());
    const editor=await waiting;editors.push(editor);editor.on('pageerror',error=>errors.push(error.message));
    await editor.waitForFunction(()=>window.PdfStudioHost?.pages().length===1 && document.getElementById('peCanvas')?.width>0 && !window.PdfStudioHost.isBusy());
    const current=await editor.evaluate(()=>window.pdfEditor.getData());assert.equal(current.filePath,pdfs[index]);
  }
  const beforeB = fs.readFileSync(pdfs[1]);
  const pdfSave = await editors[0].evaluate(async forgedTarget => {
    const host=window.PdfStudioHost;
    host.mutate('Synthetic annotation',()=>host.current().elements.push({id:crypto.randomUUID(),type:'text',x:50,y:120,w:200,h:25,text:'Native production annotation',fontSize:14,color:'#17243b',opacity:1}));
    const bytes=await host.exportPdf(host.pages());let binary='';for(let i=0;i<bytes.length;i++)binary+=String.fromCharCode(bytes[i]);
    const saved=await window.pdfEditor.save(btoa(binary),forgedTarget);host.markProjectSaved();return saved;
  }, pdfs[1]);
  assert.equal(pdfSave.saved, true);assert.equal(pdfSave.path,pdfs[0]);
  assert.deepEqual(fs.readFileSync(pdfs[1]),beforeB);
  assert.equal((await PDFDocument.load(fs.readFileSync(pdfs[0]))).getPageCount(),1);
  assert.equal(await app.evaluate(({ BrowserWindow })=>BrowserWindow.getAllWindows().some(win=>win.isVisible())),false);

  // Closing waits for the renderer's save barrier. A false result in hidden
  // mode keeps the window alive and never opens a native confirmation dialog.
  const beforeClose=storage.readSnapshot(dataB);
  await page.evaluate(()=>{
    window.__originalCloseFlush=platformFlushForClose;window.__closeFlushCalls=0;
    platformFlushForClose=async()=>{window.__closeFlushCalls++;return new Promise(resolve=>{window.__releaseCloseFlush=resolve;});};
  });
  const closeWindowId=await app.evaluate(({BrowserWindow,dialog})=>{
    globalThis.__syntheticCloseDialogs=0;dialog.showMessageBox=async()=>{globalThis.__syntheticCloseDialogs++;return{response:0};};
    const win=BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().includes('/index.html'));
    const id=win.id;win.close();return id;
  });
  await page.waitForFunction(()=>!!window.__releaseCloseFlush);
  assert.equal(await app.evaluate(({BrowserWindow},id)=>!!BrowserWindow.fromId(id)&&!BrowserWindow.fromId(id).isDestroyed(),closeWindowId),true);
  assert.equal(await page.evaluate(()=>window.electronAPI.finishClose({nonce:'synthetic-invalid-close-nonce',ready:true})),false);
  assert.equal(await page.evaluate(()=>window.__closeFlushCalls),1);
  await page.evaluate(async()=>{window.__releaseCloseFlush(false);await new Promise(resolve=>setTimeout(resolve,50));platformFlushForClose=window.__originalCloseFlush;});
  assert.equal(await app.evaluate(({BrowserWindow},id)=>!!BrowserWindow.fromId(id)&&!BrowserWindow.fromId(id).isDestroyed(),closeWindowId),true);
  assert.equal(await app.evaluate(()=>globalThis.__syntheticCloseDialogs),0);
  assert.deepEqual(storage.readSnapshot(dataB),beforeClose);
  assert.deepEqual(errors, []);
});
