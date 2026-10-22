'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{createRequire}=require('node:module');
const storage=require('../electron/storage'),sqlite=require('../electron/sqlite-storage.cjs'),{seedDatabase}=require('./period-test-support.cjs'),root=path.resolve(__dirname,'..');
let pw;try{pw=require('playwright');}catch{pw=createRequire(path.join(process.env.TVS_PLAYWRIGHT_MODULES||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),'package.json'))('playwright');}
function fixture(){return {...Object.fromEntries(storage.SECTIONS.map(name=>[name,[]])),vehicles:[{id:0,plate:'SYNTHETIC NUMBER',fuel:'diesel',fuelBalance:0,norm:10},{id:'0',plate:'SYNTHETIC TEXT',fuel:'diesel',fuelBalance:0,norm:20}],records:[{id:'preserved',vehicleId:0,date:'2026-09-01',km:123.456,fuelIssued:5,fuelActual:2}],fuelCards:[{id:'cash',number:'НАЛИЧКА',provider:'Наличка',assignments:[]}],fuelPeriods:[{month:'2026-09',recon:{'Наличка':{litres:7,sum:12.34}}}],reestrRows:[{id:'original-registry',sum:7,description:'SYNTHETIC OLD WORKSPACE'}],appMeta:[{id:'meta',toPlanInit:'synthetic'}]};}
async function observe(directory){const deadline=Date.now()+5000;for(;;)try{return storage.readAll(directory);}catch(error){if(error.code!=='DB_BUSY'||Date.now()>=deadline)throw error;await new Promise(resolve=>setTimeout(resolve,25));}}
async function invoicePdf(){
 const {PDFDocument}=require('pdf-lib'),document=await PDFDocument.create();document.registerFontkit(require('@pdf-lib/fontkit'));
 const fontPath=path.join(process.env.WINDIR||'C:/Windows','Fonts','arial.ttf');assert.ok(fs.existsSync(fontPath),'Synthetic Cyrillic PDF requires the installed Arial font');
 const font=await document.embedFont(fs.readFileSync(fontPath),{subset:true}),page=document.addPage([595,842]);
 ['Счет № SYNTHETIC-001 от 02.09.2026','Поставщик: ООО СИНТЕТИЧЕСКИЙ, ИНН 7700000000','Наименование: СИНТЕТИЧЕСКИЕ РАБОТЫ','Всего к оплате: 123,45'].forEach((text,index)=>page.drawText(text,{x:45,y:780-index*35,size:11,font}));
 return Buffer.from(await document.save());
}
async function preview(page,form){await form.locator('[data-import-preview]').click();await page.waitForFunction(()=>!reviewedImportSession.pending);}
async function applyReviewed(page,form){
 assert.equal(await form.locator('[data-import-error]').innerText(),'');
 assert.equal(await page.evaluate(()=>reviewedImportSession.review?.preview.canApply),true,await form.locator('[data-import-issues]').innerText());
 await form.locator('[name=confirm]').check();assert.equal(await form.locator('[data-import-apply]').isDisabled(),false);
 await form.locator('[data-import-apply]').click();await page.waitForFunction(()=>!reviewedImportSession?.pending);
 assert.equal(await page.evaluate(()=>reviewedImportSession?.committed),true,await page.evaluate(()=>reviewedImportSession?.form.querySelector('[data-import-error]')?.textContent));
}
function assertSource(directory,proof,bytes){
 assert.deepEqual(fs.readFileSync(path.join(directory,'import-sources',proof.sourceArchive.id)),bytes);
 assert.equal(proof.sourceArchive.sha256,crypto.createHash('sha256').update(bytes).digest('hex'));
 const manifest=fs.readFileSync(path.join(directory,'import-sources',proof.sourceManifest.id));
 assert.equal(crypto.createHash('sha256').update(manifest).digest('hex'),proof.sourceManifest.sha256);
}
test('hidden real IPC imports personnel, telemetry, provider references and reviewed PDF registry with preserved facts in JSON and SQLite',{timeout:300000},async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-native-import-')),profile=path.join(directory,'profile'),directories=[path.join(directory,'json'),path.join(directory,'sqlite')];let app;
 t.after(async()=>{if(app){await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(win=>win.destroy())).catch(()=>{});await app.close().catch(()=>{});}const resolved=path.resolve(directory);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('tvs-native-import-'));fs.rmSync(resolved,{recursive:true,force:true});});
 fs.mkdirSync(profile);seedDatabase(directories[0],fixture());sqlite.create(directories[1],{data:fixture()});fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({users:directories.map((dataDir,index)=>({name:'SYNTHETIC import '+index,dataDir})),activeUser:0,networkMode:'local',networkKey:'synthetic-native-import-key',serverPort:3377,remotePort:3377,remoteHost:'127.0.0.1'}));
 const bootstrap=path.join(directory,'bootstrap.cjs');fs.writeFileSync(bootstrap,`const Module=require('node:module'),original=Module._load,electron=original('electron',module,false);const HiddenWindow=new Proxy(electron.BrowserWindow,{construct(Target,args){const win=new Target({...args[0],show:false});win.show=()=>{};win.showInactive=()=>{};return win;}});Module._load=function(request,parent,isMain){if(request==='electron')return {...electron,BrowserWindow:HiddenWindow};return original.apply(this,arguments);};electron.app.setAppPath(${JSON.stringify(root)});require(${JSON.stringify(path.join(root,'electron/main.js'))});`);
 const packaged=process.env.TVS_PACKAGED_EXE;app=await pw._electron.launch({executablePath:packaged||require('electron'),args:[...(packaged?[]:[bootstrap]),'--user-data-dir='+profile,'--tvs-test-hidden'],cwd:root});const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(20000);await page.waitForFunction(()=>typeof reviewedImportOpen==='function'&&data.vehicles?.[0]?.id===0);await page.evaluate(async()=>{localStorage.setItem('changelogSeenVersion',await electronAPI.getAppVersion());if(document.getElementById('genericModal'))closeModal('genericModal');});assert.equal(await app.evaluate(({app})=>app.getPath('userData')),profile);
 const content=JSON.stringify({format:'tvs-exchange',version:1,section:'drivers',rows:[{id:0,name:'SYNTHETIC NUMERIC EMPLOYEE'},{id:'0',name:'SYNTHETIC TEXT EMPLOYEE'}]}),originalFile=path.join(directory,'SYNTHETIC-exchange.json');fs.writeFileSync(originalFile,content);await app.evaluate(({dialog},filePath)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[filePath]});},originalFile);
 const providerCsv=Buffer.from('\uFEFFprovider;month;litres;sum\r\nНаличка;2026-09;0;\r\n','utf8'),pdf=await invoicePdf();
 for(const[index,dir]of directories.entries()){
  if(index)await page.evaluate(async()=>{await electronAPI.switchUser(1);data=await loadData();rebuildIndex();});const before=await observe(dir);assert.equal(await page.evaluate(()=>_sync.platform.controlledImports),1);
  await page.evaluate(()=>wfImportExchange());let form=page.locator('#reviewedImportForm');await form.waitFor();await form.locator('[name=reason]').fill('SYNTHETIC reviewed personnel source');await form.locator('[data-import-preview]').click();await page.waitForFunction(()=>!reviewedImportSession.pending);assert.equal(await form.locator('[data-import-error]').innerText(),'');assert.equal((await observe(dir)).drivers.length,0);await form.locator('[name=confirm]').check();assert.equal(await form.locator('[data-import-apply]').isDisabled(),false,await form.locator('[data-import-issues]').innerText());await form.locator('[data-import-apply]').click();await page.waitForFunction(()=>!reviewedImportSession?.pending);let after=await observe(dir);assert.deepEqual(after.drivers.map(row=>row.id),[0,'0']);const proof=after.drivers[0].importProvenance;assert.equal(fs.readFileSync(path.join(dir,'import-sources',proof.sourceArchive.id),'utf8'),content);
  await page.evaluate(()=>{reviewedImportSession=null;closeModal('wfModal');});const operation='synthetic-telemetry-'+index;
  const applied=await page.evaluate(async operation=>{const observation=(km,start,end)=>({object:'SYNTHETIC',date:'2026-09-01',kind:'trip',start,end,km}),source={name:'SYNTHETIC-telemetry.json',bytes:new TextEncoder().encode(JSON.stringify({glonassTrips:[observation(100,'2026-09-01T10:00:00Z','2026-09-01T11:00:00Z'),observation(200,'2026-09-01T12:00:00Z','2026-09-01T13:00:00Z')]}))},staged=await electronAPI.importSource({action:'stage',profile:'glonass',sections:['glonassTrips'],parser:{id:'glonass',version:1},source});if(!staged.ok)return staged;const input={sourceId:staged.sourceId,profile:'glonass',sections:['glonassTrips'],reason:'SYNTHETIC observed trips explicitly mapped',decisions:staged.source.rows.map(row=>({rowId:row.rowId,action:'map',target:{section:'vehicles',id:0},basis:'SYNTHETIC exact observed vehicle'}))},preview=await electronAPI.importSource({action:'preview',...input});if(!preview.ok||!preview.preview.canApply)return preview;const command={type:'ImportAction',version:1,input:{...input,reviewFingerprint:preview.reviewFingerprint}};window.__nativeImportCommand=command;return platformExecuteCommand(command,{operationId:operation});},operation);assert.equal(applied.ok,true,JSON.stringify(applied));after=await observe(dir);const observed=after.records.find(row=>row.vehicleId===0&&row.date==='2026-09-01');assert.equal(observed.kmGlonass,300);assert.equal(observed.km,123.456);assert.equal(observed.fuelIssued,5);assert.equal(observed.fuelActual,2);const replay=await page.evaluate(operation=>platformExecuteCommand(__nativeImportCommand,{operationId:operation}),operation);assert.equal(replay.ok,true,JSON.stringify(replay));assert.deepEqual((await observe(dir)).records,after.records);assert.deepEqual(after.genRecords,before.genRecords);assert.deepEqual(after.payments,before.payments);assert.equal(after.vehicles[0].norm,10);assert.equal(after.vehicles[1].norm,20);

  // The real PDF parser creates an unsaved inline draft. Human interpretation
  // is opt-in, then its basis and every registry row need explicit review.
  const beforeRegistry=await observe(dir);
  await page.evaluate(async bytes=>{reviewedImportSession=null;closeModal('wfModal');reestrImportDraft=null;reestrRows=structuredClone(data.reestrRows||[]);renderReestrSection();reestrFiles=[{type:'pdf',file:new File([new Uint8Array(bytes)],'SYNTHETIC-INVOICE.pdf',{type:'application/pdf'})}];await reestrParse();},Array.from(pdf));
  assert.equal(await page.locator('#reestrError').isVisible(),false,await page.locator('#reestrError').innerText());
  await page.locator('#reestrReviewCard').waitFor({state:'visible'});
  const draft=await page.evaluate(()=>({pending:!!reestrImportDraft,rows:reestrRows.map(row=>({sum:row.sum,description:row.description})),raw:[...reestrImportDraft.originalByRow.values()].map(row=>row.raw)}));
  assert.equal(draft.pending,true);assert.equal(draft.rows.length,1);assert.equal(draft.rows[0].sum,123.45);assert.equal(draft.raw[0].recognition.sourceFile,'SYNTHETIC-INVOICE.pdf');assert.deepEqual(draft.raw[0].recognition.sourcePages,[1]);assert.match(draft.raw[0].recognition.rawText,/123,45/);
  assert.deepEqual((await observe(dir)).reestrRows,beforeRegistry.reestrRows);
  const description='SYNTHETIC human-reviewed work description '+index;
  await page.locator('#reestrReviewBody textarea').first().fill(description);await page.locator('#reestrReviewBody textarea').first().blur();
  await page.locator('#reestrBuildBtn').click();form=page.locator('#reviewedImportForm');await form.waitFor();
  assert.equal(await form.locator('[name=useInterpretation]').isChecked(),false);assert.equal(await form.locator('[data-import-apply]').isDisabled(),true);
  await form.locator('[name=reason]').fill('SYNTHETIC reviewed original invoice registry');await form.locator('[name=useInterpretation]').check();await preview(page,form);
  assert.match(await form.locator('[data-import-error]').innerText(),/основание/i);assert.equal(await page.evaluate(()=>reviewedImportSession.sourceId||null),null);
  assert.deepEqual((await observe(dir)).reestrRows,beforeRegistry.reestrRows);
  const interpretationBasis='SYNTHETIC invoice original compared with extracted date, supplier and total';
  await form.locator('[name=interpretationBasis]').fill(interpretationBasis);await preview(page,form);
  assert.equal(await form.locator('[data-import-error]').innerText(),'');assert.equal(await page.evaluate(()=>reviewedImportSession.review.preview.canApply),false);
  await form.locator('[data-import-action]').first().selectOption('create');await form.locator('[data-import-basis]').first().fill('SYNTHETIC invoice row checked against original PDF');await preview(page,form);
  assert.deepEqual((await observe(dir)).reestrRows,beforeRegistry.reestrRows);await applyReviewed(page,form);
  const registrySaved=await observe(dir);assert.equal(registrySaved.reestrRows.length,beforeRegistry.reestrRows.length+1);assert.deepEqual(registrySaved.reestrRows[0],beforeRegistry.reestrRows[0]);
  const invoice=registrySaved.reestrRows.find(row=>row.description===description);assert.ok(invoice);assert.equal(invoice.sum,123.45);assert.equal(invoice.importProvenance.attestation.mode,'human-transcription');assert.equal(Object.hasOwn(invoice.importProvenance.attestation,'basis'),false);assertSource(dir,invoice.importProvenance,pdf);
  const retained=await page.evaluate(sourceId=>electronAPI.importSource({action:'read',databaseToken:_sync.databaseToken,sourceId}),invoice.importProvenance.sourceId);
  assert.equal(retained.ok,true,JSON.stringify(retained));assert.equal(retained.source.attestation.basis,interpretationBasis);assert.equal(retained.source.attestation.physicalTruth,'not-attested');assert.equal(retained.source.rows[0].raw.sum,123.45);assert.match(retained.source.rows[0].raw.recognition.rawText,/СИНТЕТИЧЕСКИЕ РАБОТЫ/);assert.equal(retained.source.rows[0].normalized.description,description);assert.equal(await page.evaluate(()=>reestrImportDraft),null);
  for(const section of ['records','payments','repairs','fuelPurchases','savedReestrs','vehicles'])assert.deepEqual(registrySaved[section],beforeRegistry[section],section+' must remain unchanged by registry import');
  t.diagnostic((index?'SQLite':'JSON')+': original PDF parsed to an unsaved inline draft, explicit human review and source evidence passed');
  // An actual CSV goes through the provider UI, native decoder, authoritative
  // preview and ImportAction. A blank reference sum preserves the old sum;
  // explicit zero litres remain zero, without creating physical/cash facts.
  const beforeProvider=await observe(dir);
  await page.evaluate(async bytes=>{reviewedImportSession=null;closeModal('wfModal');await wfProviderImport1c({files:[new File([new Uint8Array(bytes)],'SYNTHETIC-provider.csv',{type:'text/csv'})],value:''});},Array.from(providerCsv));
  form=page.locator('#reviewedImportForm');await form.waitFor();await form.locator('[name=reason]').fill('SYNTHETIC reference-only provider statement');
  await preview(page,form);assert.equal(await form.locator('[data-import-error]').innerText(),'');
  assert.equal(await page.evaluate(()=>reviewedImportSession.review.preview.canApply),false);
  assert.deepEqual(await page.evaluate(()=>{const row=reviewedImportSession.source.rows[0].normalized;return{litres:row.litres,sum:row.sum};}),{litres:0,sum:null});
  await form.locator('[data-import-action]').first().selectOption('replace');await form.locator('[data-import-basis]').first().fill('SYNTHETIC checked zero litres; blank monetary reference unchanged');
  await preview(page,form);assert.equal(await page.evaluate(()=>reviewedImportSession.review.preview.canApply),true,JSON.stringify(await page.evaluate(()=>({decisions:reviewedImportSession.decisions,preview:reviewedImportSession.review.preview}))));assert.deepEqual(await page.evaluate(()=>reviewedImportSession.review.preview.writeSections),['fuelPeriods']);
  assert.deepEqual((await observe(dir)).fuelPeriods,beforeProvider.fuelPeriods);await applyReviewed(page,form);
  const providerSaved=await observe(dir),recon=providerSaved.fuelPeriods.find(row=>row.month==='2026-09').recon['Наличка'];
  assert.equal(recon.litres,0);assert.equal(recon.sum,12.34);assert.equal(recon.importHistory.length,1);assertSource(dir,recon.importSource,providerCsv);
  for(const section of ['records','payments','fuelPurchases','glonassTrips','genRecords','vehicles','appMeta'])assert.deepEqual(providerSaved[section],beforeProvider[section],section+' must remain unchanged by provider references');

  t.diagnostic((index?'SQLite':'JSON')+': personnel, telemetry, CSV zero/null references and original PDF → inline draft → explicit human review → ImportAction passed');
 }
 assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(win=>win.isVisible())),false);assert.deepEqual(errors,[]);
});
