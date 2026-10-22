'use strict';
const {test,before,after,beforeEach,afterEach}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{createRequire}=require('node:module');
const storage=require('../electron/storage'),schema=require('../assets/core/platform-schema.js'),kernel=require('../assets/core/platform-kernel.js');
let pw;try{pw=require('playwright');}catch{pw=createRequire(path.join(process.env.TVS_PLAYWRIGHT_MODULES||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),'package.json'))('playwright');}
const root=path.resolve(__dirname,'..'),principal={id:'dated-card-test-admin',name:'Synthetic dated card admin',role:'admin'},now='2026-10-22T12:00:00.000Z';
let browser,page,errors,temp,dir,requests,commits;
function fixture(){const data=Object.fromEntries(schema.sections.map(name=>[name,[]]));Object.assign(data,{
 vehicles:[{id:0,plate:'SYNTHETIC NUMERIC ZERO',make:'Synthetic vehicle',org:'A',object:'Synthetic site',fuel:'diesel',fuelGrade:'ДТ',norm:10,fuelBalance:50},{id:'0',plate:'SYNTHETIC TEXT ZERO',make:'Other typed vehicle',org:'A',object:'Synthetic site',fuel:'diesel',fuelGrade:'ДТ',norm:10,fuelBalance:50}],
 records:[{id:'r',vehicleId:0,date:'2026-09-10',km:100,fuelIssued:5,fuelActual:1,fuelGrade:'ДТ'}],
 fuelPurchases:[{id:'p',vehicleId:0,recordId:'r',date:'2026-09-10',grade:'ДТ',qty:5,sum:7.01,price:1.402,cardNo:'700512341234',sourceOrg:'A',manual:true}],
 fuelCards:[{id:0,number:'700512341234',provider:'Synthetic original provider',org:'A',limit:0,status:'active',note:'Original synthetic note',assignments:[{vehicleId:0,from:'2026-06-01',to:''}]},{id:'fc_cash',number:'НАЛИЧКА',provider:'Наличка',org:'',status:'active',limit:null,assignments:[],note:'Для учёта наличных закупок топлива'}],
 appMeta:[{id:'meta',toPlanInit:'synthetic'}]});return data;}
before(async()=>{const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';browser=await pw.chromium.launch({headless:true,executablePath:process.env.TVS_TEST_BROWSER||(!process.env.CI&&fs.existsSync(edge)?edge:undefined)});});
after(async()=>{await browser?.close();});
beforeEach(async()=>{
 temp=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-dated-card-ui-'));dir=path.join(temp,'db');fs.mkdirSync(storage.sectionsDir(dir),{recursive:true});const initial=fixture(),revisions=Object.fromEntries(schema.sections.map(name=>[name,1]));for(const name of schema.sections)fs.writeFileSync(storage.sectionFile(dir,name),JSON.stringify(initial[name]));fs.writeFileSync(storage.revisionsFile(dir),JSON.stringify(storage.encodeRevisions(revisions)));
 requests=[];commits=0;errors=[];page=await browser.newPage({viewport:{width:1280,height:960}});page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await page.exposeFunction('__actualDatedCardSnapshot',()=>JSON.stringify(storage.readSnapshot(dir)));
 await page.exposeFunction('__actualDatedCardWrite',raw=>{requests.push(raw);try{const result=storage.writeSections(dir,JSON.parse(raw),{principal,now});if(result.ok&&!result.replayed)commits++;return result;}catch(error){return{ok:false,code:error.code||'SAVE_REJECTED',error:error.message,issues:error.issues||error.details?.issues};}});
 await page.addInitScript(()=>{
  window.__mode='ok';window.__hold=false;window.__waiting=[];window.__rawRequests=[];window.__closeReplies=[];
  window.electronAPI={readSnapshot:()=>window.__actualDatedCardSnapshot(),writeSections:async raw=>{
   window.__rawRequests.push(raw);if(window.__hold)await new Promise(resolve=>window.__waiting.push(resolve));
   if(window.__mode==='reject')return{ok:false,code:'SYNTHETIC_SAVE_REJECTED',error:'Synthetic card save rejected'};
   const result=await window.__actualDatedCardWrite(raw);
   if(window.__mode==='unknown'&&result.ok)return{ok:false,unknown:true,queued:true,code:'ACK_UNKNOWN',error:'Synthetic lost card acknowledgement'};
   if(window.__mode==='missingCanonical'&&result.ok)delete result.canonicalSections;
   return result;
  },onPrepareClose:callback=>{window.__prepareClose=callback;},finishClose:async reply=>{window.__closeReplies.push(reply);return true;}};
 });
 await page.goto(pathToFileURL(path.join(root,'index.html')).href);await page.waitForFunction(()=>typeof fcEdit==='function'&&typeof platformSaveBaseline==='function'&&typeof data!=='undefined'&&data.fuelCards.some(row=>row.id===0));
 await page.evaluate(()=>{window.__baseBusiness=JSON.stringify({records:data.records,fuelPurchases:data.fuelPurchases,vehicles:data.vehicles});fcEdit(0);});await page.waitForFunction(()=>!!document.getElementById('fcEditor'));
});
afterEach(async()=>{await page?.close();assert.deepEqual(errors,[]);if(temp){assert.equal(path.dirname(path.resolve(temp)),path.resolve(os.tmpdir()));assert.ok(path.basename(temp).startsWith('tvs-dated-card-ui-'));fs.rmSync(temp,{recursive:true,force:true});}});
async function fillDated({org='B',date='01.11.2026',basis='Synthetic confirmed ownership document',preserve=true,vehicle}={}){
 await page.locator('#fc_org').fill(org);if(date!==null)await page.locator('#fc_from').fill(date);if(basis!==null)await page.locator('#fc_basis').fill(basis);if(preserve)await page.locator('#fc_preserve_legacy').check();if(vehicle!==undefined){const token=await page.evaluate(value=>fcEditorState.choices.find(row=>typeof row.id===typeof value&&row.id===value)?.token,vehicle);assert.ok(token);await page.locator('#fc_vehicle').selectOption(token);}
}
async function preview(){await page.locator('#fc_save').click();await page.waitForFunction(()=>!document.getElementById('fc_preview').hidden);}
async function confirm(){await page.locator('#fc_confirm').check();await page.locator('#fc_save').click();await page.waitForFunction(()=>!fcEditorState?.pending);}
const disk=()=>storage.readSnapshot(dir);
async function state(){return page.evaluate(()=>({cards:structuredClone(data.fuelCards),business:JSON.stringify({records:data.records,fuelPurchases:data.fuelPurchases,vehicles:data.vehicles}),baseline:_lastPersisted,open:document.getElementById('genericModal')?.classList.contains('open'),error:document.getElementById('fc_error')?.textContent,org:document.getElementById('fc_org')?.value,basis:document.getElementById('fc_basis')?.value,requests:window.__rawRequests.length}));}
async function startHeld(){await page.evaluate(()=>{window.__hold=true;});await page.locator('#fc_confirm').check();await page.locator('#fc_save').click();await page.waitForFunction(()=>window.__waiting.length===1);}
async function release(){await page.evaluate(()=>{window.__hold=false;window.__waiting.splice(0).forEach(resolve=>resolve());});await page.waitForFunction(()=>!fcEditorState?.pending);}

test('numeric zero card and vehicle IDs, zero limit and unchanged legacy assignments survive a descriptive canonical save',async()=>{
 assert.equal(await page.locator('#fc_limit').inputValue(),'0');assert.equal(await page.evaluate(()=>fcEditorState.originalVehicle),0);assert.equal(await page.locator('#fc_vehicle').inputValue(),'card-vehicle-0');const before=disk();await page.locator('#fc_note').fill('Updated synthetic description');await page.locator('#fc_save').click();await page.waitForFunction(()=>!document.getElementById('genericModal').classList.contains('open'));
 const after=disk();assert.equal(requests.length,1);assert.equal(commits,1);assert.equal(after.data.fuelCards[0].id,0);assert.equal(after.data.fuelCards[0].assignments[0].vehicleId,0);assert.equal(after.data.fuelCards[0].limit,0);assert.equal(after.data.fuelCards[0].orgHistoryOrigin,undefined);assert.deepEqual(after.data.records,before.data.records);assert.deepEqual(after.data.fuelPurchases,before.data.fuelPurchases);assert.equal((await state()).cards[0].note,'Updated synthetic description');
});

test('dated ownership refuses missing date, missing basis and unconfirmed legacy baseline without a persistence request',async()=>{
 const before=disk();await fillDated({date:null,basis:null,preserve:false});await page.locator('#fc_save').click();assert.match(await page.locator('#fc_error').textContent(),/дату/);assert.equal(requests.length,0);
 await page.locator('#fc_from').fill('01.11.2026');await page.locator('#fc_save').click();assert.match(await page.locator('#fc_error').textContent(),/основание/);assert.equal(requests.length,0);
 await page.locator('#fc_basis').fill('Synthetic ownership basis');await page.locator('#fc_save').click();assert.match(await page.locator('#fc_error').textContent(),/Подтвердите сохранение/);assert.equal(requests.length,0);assert.deepEqual(disk(),before);assert.equal((await state()).cards[0].orgHistory,undefined);
});

test('preview and confirmation do not write or optimistically alter facts; real saveData receives the server canonical origin',async()=>{
 const before=disk(),baseline=await page.evaluate(()=>_lastPersisted);await fillDated({vehicle:'0'});await preview();const reviewed=await state();assert.equal(reviewed.requests,0);assert.equal(reviewed.baseline,baseline);assert.equal(reviewed.cards[0].orgHistory,undefined);assert.match(await page.locator('#fc_preview').innerText(),/начальная дата неизвестна/);assert.deepEqual(disk(),before);
 await startHeld();const pending=await state();assert.equal(pending.cards[0].orgHistory,undefined);assert.equal(pending.baseline,baseline);assert.equal(requests.length,0);assert.equal(await page.evaluate(()=>_pendingSaveOperations.size),1);await release();
 const after=disk(),local=await state();assert.equal(commits,1);assert.equal(requests.length,1);assert.equal(after.data.fuelCards[0].org,'A');assert.deepEqual(after.data.fuelCards[0].orgHistoryOrigin,{version:1,previous:'absent'});assert.equal(after.data.fuelCards[0].orgHistory[0].from,'');assert.equal(after.data.fuelCards[0].orgHistory[1].from,'2026-11-01');assert.equal(after.data.fuelCards[0].assignments[0].vehicleId,0);assert.equal(after.data.fuelCards[0].assignments[1].vehicleId,'0');assert.equal(after.data.fuelCards[0].assignments[1].basis,'Synthetic confirmed ownership document');assert.deepEqual(local.cards,after.data.fuelCards);assert.deepEqual(JSON.parse(local.baseline).fuelCards,after.data.fuelCards);for(const section of ['records','fuelPurchases','vehicles'])assert.deepEqual(after.data[section],before.data[section]);assert.equal(local.business,reviewed.business);
});

test('editing a reviewed date, basis or limit invalidates the plan and requires a new confirmation without writing',async()=>{
 await fillDated();await preview();await page.locator('#fc_confirm').check();await page.locator('#fc_basis').fill('A changed synthetic basis');assert.equal(await page.locator('#fc_preview').isHidden(),true);assert.equal(await page.locator('#fc_confirm').isChecked(),false);await page.locator('#fc_save').click();assert.equal(await page.locator('#fc_confirm').isChecked(),false);assert.equal(requests.length,0);assert.match(await page.locator('#fc_preview').textContent(),/changed synthetic basis/);
});

for(const mode of ['reject','unknown','missingCanonical'])test(mode+' acknowledgement retains the owned form and business facts, then canonical retry commits at most once',async()=>{
 const before=disk();await fillDated();await preview();await page.evaluate(mode=>{window.__mode=mode;},mode);await confirm();const failed=await state();assert.equal(failed.open,true);assert.equal(failed.org,'B');assert.equal(failed.basis,'Synthetic confirmed ownership document');assert.equal(failed.cards[0].orgHistory,undefined);assert.match(failed.error,/не подтверждено/);assert.deepEqual(disk().data.records,before.data.records);assert.equal(commits,mode==='reject'?0:1);
 await page.evaluate(()=>{window.__mode='ok';});await confirm();await page.waitForFunction(()=>!document.getElementById('genericModal').classList.contains('open'));assert.equal(commits,1);assert.equal(disk().data.fuelCards[0].orgHistory[1].org,'B');assert.deepEqual((await state()).cards,disk().data.fuelCards);if(mode!=='reject'){const first=JSON.parse(requests[0]),second=JSON.parse(requests[1]);assert.equal(first.operation.id,second.operation.id);assert.deepEqual(first.base,second.base);assert.deepEqual(first.sections.fuelCards,second.sections.fuelCards);assert.equal(kernel.requestDigest(first),kernel.requestDigest(second));assert.equal(disk().data.auditLog.filter(row=>row.type==='transaction'&&row.operationId===first.operation.id).length,1);}
});

for(const change of ['source','database','role'])test('a '+change+' change before saving refuses the retained card draft without IPC',async()=>{
 await fillDated();await preview();await page.locator('#fc_confirm').check();const before=disk();await page.evaluate(change=>{if(change==='source')data.records[0].note='Concurrent synthetic source';else if(change==='database'){data=structuredClone(data);_sync.databaseToken='another-synthetic-database';}else _sync.access={user:{id:'viewer',name:'Synthetic viewer',role:'viewer'},readable:PlatformSchema.sections.slice(),writable:[]};},change);await page.locator('#fc_save').click();assert.equal(requests.length,0);assert.deepEqual(disk(),before);assert.match(await page.locator('#fc_error').textContent(),/изменились|недоступно/);assert.equal(await page.locator('#fc_org').inputValue(),'B');
});

for(const change of ['source','database','role'])test('a '+change+' change during persistence prevents late canonical rows from replacing the current session',async()=>{
 await fillDated();await preview();await startHeld();await page.evaluate(change=>{if(change==='source')data.records[0].note='Concurrent source while waiting';else if(change==='database'){data=structuredClone(data);data.fuelCards[0].note='OTHER SYNTHETIC DATABASE';_sync.databaseToken='different-synthetic-db';_lastPersisted=JSON.stringify(data);}else _sync.access={user:{id:'viewer',name:'Viewer',role:'viewer'},readable:PlatformSchema.sections.slice(),writable:[]};},change);const current=await state();await release();const after=await state();assert.deepEqual(after.cards,current.cards);assert.equal(after.business,current.business);if(change!=='source')assert.equal(after.baseline,current.baseline);else{const baseline=JSON.parse(after.baseline);assert.deepEqual(baseline.records,JSON.parse(current.baseline).records);assert.deepEqual(baseline.fuelCards,disk().data.fuelCards);assert.equal(baseline.records[0].note,undefined);}assert.equal(after.open,true);assert.equal(commits,1);assert.deepEqual(disk().data.fuelCards[0].orgHistoryOrigin,{version:1,previous:'absent'});
});

test('a new card requires its real start date and basis before preview, and a typed zero recipient remains numeric after canonical save',async()=>{
 await page.evaluate(()=>fcEdit(null));const before=disk(),id=await page.evaluate(()=>fcEditorState.id);await page.locator('#fc_number').fill('700599998888');await page.locator('#fc_org').fill('A');await page.locator('#fc_vehicle').selectOption('card-vehicle-0');await page.locator('#fc_limit').fill('0');await page.locator('#fc_save').click();assert.match(await page.locator('#fc_error').textContent(),/дату/);assert.equal(requests.length,0);assert.equal(await page.locator('#fc_from').inputValue(),'');
 await page.locator('#fc_from').fill('01.11.2026');await page.locator('#fc_save').click();assert.match(await page.locator('#fc_error').textContent(),/основание/);assert.equal(requests.length,0);await page.locator('#fc_basis').fill('Synthetic new card ownership document');await preview();assert.equal(requests.length,0);assert.deepEqual(disk(),before);await confirm();await page.waitForFunction(()=>!document.getElementById('genericModal').classList.contains('open'));const card=disk().data.fuelCards.find(row=>row.id===id);assert.ok(card);assert.equal(card.assignments[0].vehicleId,0);assert.equal(card.assignments[0].from,'2026-11-01');assert.equal(card.orgHistory[0].from,'2026-11-01');assert.equal(card.orgHistory[0].basis,'Synthetic new card ownership document');assert.equal(card.limit,0);assert.equal(card.orgHistoryOrigin,undefined);assert.deepEqual(disk().data.records,before.data.records);
});

test('an explicitly requested purchase move from numeric zero to textual zero conserves total journal fuel and leaves mileage unchanged',async()=>{
 const before=disk();await fillDated({org:'A',date:'01.09.2026',preserve:false,vehicle:'0',basis:'Synthetic explicit purchase reassignment'});await page.locator('#fc_move').check();await preview();assert.equal(requests.length,0);assert.deepEqual(disk(),before);await confirm();await page.waitForFunction(()=>!document.getElementById('genericModal').classList.contains('open'));const after=disk();assert.equal(after.data.fuelPurchases[0].vehicleId,'0');assert.equal(after.data.records.find(row=>row.id==='r').km,100);assert.equal(after.data.records.reduce((sum,row)=>sum+(row.fuelIssued||0),0),5);assert.equal(after.data.records.find(row=>row.vehicleId==='0').fuelIssued,5);assert.equal(after.data.records.find(row=>row.id==='r').fuelIssued??0,0);
});

test('an explicit move to the current numeric zero recipient repairs a differently assigned purchase without changing the card assignment',async()=>{
 const original=disk(),sections={records:original.data.records.map(row=>({...row,vehicleId:'0'})),fuelPurchases:original.data.fuelPurchases.map(row=>({...row,vehicleId:'0'}))};
 const seeded=storage.writeSections(dir,{databaseToken:original.databaseToken,base:original.revisions,sections},{principal,now});assert.equal(seeded.ok,true);
 await page.reload();await page.waitForFunction(()=>typeof fcEdit==='function'&&typeof data!=='undefined'&&data.fuelPurchases[0]?.vehicleId==='0');await page.evaluate(()=>fcEdit(0));await page.waitForFunction(()=>!!document.getElementById('fcEditor'));
 const before=disk();assert.equal(await page.evaluate(()=>fcEditorState.originalVehicle),0);await fillDated({org:'A',date:'01.09.2026',preserve:false,basis:'Synthetic reviewed correction of purchase recipient'});await page.locator('#fc_move').check();await preview();assert.equal(requests.length,0);assert.deepEqual(disk(),before);await confirm();await page.waitForFunction(()=>!document.getElementById('genericModal').classList.contains('open'));
 const after=disk();assert.equal(commits,1);assert.equal(after.data.fuelPurchases[0].vehicleId,0);assert.deepEqual(after.data.fuelCards,before.data.fuelCards);assert.equal(after.data.records.find(row=>row.id==='r').km,100);assert.equal(after.data.records.find(row=>row.id==='r').fuelIssued??0,0);assert.equal(after.data.records.find(row=>row.vehicleId===0).fuelIssued,5);assert.equal(after.data.records.reduce((sum,row)=>sum+(row.fuelIssued||0),0),5);assert.deepEqual((await state()).cards,after.data.fuelCards);
});

test('a purchase move without a selected recipient refuses persistence and retains the draft',async()=>{
 const before=disk();await fillDated({org:'A',date:'01.09.2026',preserve:false,basis:'Synthetic missing recipient'});await page.locator('#fc_vehicle').selectOption('');await page.locator('#fc_move').check();await page.locator('#fc_save').click();assert.equal(requests.length,0);assert.equal(commits,0);assert.deepEqual(disk(),before);assert.match(await page.locator('#fc_error').textContent(),/машину-получателя/);assert.equal(await page.locator('#fc_basis').inputValue(),'Synthetic missing recipient');
});

test('cancelled retained DOM and handlers cannot save the reviewed card plan',async()=>{
 await fillDated();await preview();await page.locator('#fc_confirm').check();const before=disk();await page.locator('#fcEditor button').filter({hasText:'Отмена'}).click();assert.equal(await page.locator('#genericModal').evaluate(el=>el.classList.contains('open')),false);await page.evaluate(()=>fcSave(0));assert.equal(requests.length,0);assert.deepEqual(disk(),before);assert.match(await page.locator('#fc_error').textContent(),/закрыта/);
});

test('close readiness waits for the dated card save and does not invent canonical data before its receipt',async()=>{
 await fillDated();await preview();await startHeld();await page.evaluate(()=>{window.__closeDone=false;window.__closing=window.__prepareClose('dated-card-close').then(()=>{window.__closeDone=true;});});assert.deepEqual(await page.evaluate(()=>({done:window.__closeDone,replies:window.__closeReplies})),{done:false,replies:[]});assert.equal((await state()).cards[0].orgHistory,undefined);await release();await page.evaluate(()=>window.__closing);assert.deepEqual(await page.evaluate(()=>window.__closeReplies),[{nonce:'dated-card-close',ready:true}]);assert.equal(commits,1);
});
