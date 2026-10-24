'use strict';
const {test,before,after,beforeEach,afterEach}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),{createRequire}=require('node:module');
const snapshots=require('./helpers/ui-snapshot-fixture.cjs');
let pw;try{pw=require('playwright');}catch{pw=createRequire(path.join(process.env.TVS_PLAYWRIGHT_MODULES||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),'package.json'))('playwright');}
const root=path.resolve(__dirname,'..');let browser,server,origin,page,errors;
const vehicleNorm=(norm,normIdle=0)=>({norm,normCity:null,normHighway:null,normIdle});
const generatorNorm=norm=>({norm,norm100:null,norm50:null,normIdle:0});
const profiles=(summer,winter)=>({version:1,summer,winter});
function database(){return {vehicles:[{id:0,plate:'SYNTHETIC NUMBER ZERO',make:'Synthetic',org:'A',fuel:'diesel',fuelGrade:'ДТ',fuelBalance:30,norm:10,fuelSeasons:profiles(vehicleNorm(8),vehicleNorm(12))},{id:'0',plate:'SYNTHETIC STRING ZERO',org:'A',fuel:'diesel',fuelGrade:'ДТ',fuelBalance:20,norm:20,fuelSeasons:profiles(vehicleNorm(0),vehicleNorm(25))},{id:'archived',plate:'SYNTHETIC ARCHIVED',org:'A',archived:true,fuel:'diesel',fuelGrade:'ДТ',fuelBalance:0,norm:10}],generators:[{id:0,name:'SYNTHETIC NUMBER DES',fuel:'diesel',fuelBalance:10,power:100,norm:2,fuelSeasons:profiles(generatorNorm(1),generatorNorm(3))},{id:'0',name:'SYNTHETIC STRING DES',fuel:'diesel',fuelBalance:10,power:200,norm:4,fuelSeasons:profiles(generatorNorm(2),generatorNorm(5))}],records:[{id:'past',vehicleId:0,date:'2026-09-01',km:10,fuelActual:1,tankMeasured:29}],genRecords:[{id:'past-gen',generatorId:0,date:'2026-09-01',hours:2,load:100,fuelActual:1,tankId:null}],fuelPurchases:[],appMeta:[{id:'meta',toPlanInit:'synthetic'}]};}
before(async()=>{
 server=http.createServer((request,response)=>{const file=require('../electron/security').staticFile(root,request.url);if(!file||!fs.existsSync(file)||!fs.statSync(file).isFile()){response.writeHead(404).end();return;}response.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');fs.createReadStream(file).pipe(response);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';browser=await pw.chromium.launch({headless:true,executablePath:process.env.TVS_TEST_BROWSER||(!process.env.CI&&fs.existsSync(edge)?edge:undefined)});
});
after(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));});
beforeEach(async()=>{
 page=await browser.newPage({viewport:{width:1280,height:900}});errors=[];page.on('pageerror',error=>errors.push(error.message));
 await snapshots.install(page,{database:database(),token:'synthetic-seasonal-ui',countWrites:true},()=>{
  window.__requests=[];window.__mode='ok';window.__hold=false;window.__canonicalFrom=null;
  const write=electronAPI.writeSections;electronAPI.writeSections=async raw=>{const request=JSON.parse(raw);__requests.push(request);if(__hold)await new Promise(resolve=>window.__release=resolve);if(__mode==='reject')return{ok:false,error:'Synthetic seasonal persistence rejected'};if(__mode==='unknown')return{ok:false,unknown:true,definitive:false,code:'SYNTHETIC_UNKNOWN',error:'Synthetic acknowledgement unavailable'};const result=await write(raw);if(result.ok&&__canonicalFrom){for(const row of result.canonicalSections.vehicles||[])for(const period of row.fuelNorms?.periods||[])if(period.from===__canonicalFrom)period.basis='SYNTHETIC CANONICAL ACK';const disk=JSON.parse(__disk);Object.assign(disk,structuredClone(result.canonicalSections));__disk=JSON.stringify(disk);}if(__mode==='missingCanonical')delete result.canonicalSections;return result;};
 });
 await page.goto(origin+'/index.html');await page.waitForFunction(()=>typeof SeasonalFuel!=='undefined'&&typeof seasonalFuelOpen==='function'&&typeof data!=='undefined'&&data.vehicles[0]?.id===0);
 await page.evaluate(()=>{fpMonth='2026-09';window.__baseline=JSON.stringify(data);window.__facts=JSON.stringify([data.records,data.genRecords,data.fuelPurchases]);window.__diskBaseline=__disk;});
 await page.locator('#unifiedNav [data-section="fuelPurchases"]').click();await page.locator('[data-seasonal-panel]').waitFor();
});
afterEach(async()=>{await page.close();assert.deepEqual(errors,[]);});
async function open(section='vehicles',season='winter'){await page.locator('[data-seasonal-switch="'+section+':'+season+'"]').click();await page.locator('#seasonalFuelApplyForm').waitFor();return page.locator('#seasonalFuelApplyForm');}
async function fill(form,from='2026-11-01'){await form.locator('[name="from"]').fill(from);await form.locator('[name="basis"]').fill('Synthetic approved seasonal transition');}
async function review(form){await form.locator('[data-sf-review]').click();await form.locator('[data-sf-preview]').waitFor({state:'visible'});}
async function confirm(form){await form.locator('[name="confirm"]').check();await form.locator('[data-sf-save]').click();}
async function closed(){await page.waitForFunction(()=>!document.getElementById('wfModal')?.classList.contains('open'));}
async function error(form){await page.waitForFunction(()=>!!document.querySelector('[data-sf-error]')?.textContent.trim());return form.locator('[data-sf-error]').innerText();}
async function unchanged(){assert.deepEqual(await page.evaluate(()=>({source:JSON.stringify(data)===__baseline,disk:__disk===__diskBaseline,writes:__writes,requests:__requests.length})),{source:true,disk:true,writes:0,requests:0});}

test('GSM has independent seasonal buttons for vehicles and DES, an explicit date, and no save from opening or cancelling',async()=>{
 assert.equal(await page.locator('[data-seasonal-group]').count(),2);assert.equal(await page.locator('[data-seasonal-switch]').count(),4);
 const form=await open();assert.equal(await form.locator('[name="from"]').inputValue(),await page.evaluate(()=>platformSessionContext().today));assert.equal(await form.locator('[name="basis"]').inputValue(),'');
 await fill(form);await review(form);assert.equal(await form.locator('[data-sf-change-id]').count(),2);assert.equal(await form.locator('[data-sf-save]').isDisabled(),true);assert.match(await form.innerText(),/Прежние нормы до выбранной даты сохраняются/);assert.equal((await form.innerText()).includes('1900'),false);
 await form.locator('[data-sf-cancel]').click();await unchanged();
});

test('profile editing preserves explicit zero and unknown fields and saves only inert templates after review',async()=>{
 await page.evaluate(()=>seasonalFuelProfilesOpen('vehicles',0));const form=page.locator('#seasonalFuelProfileForm');
 await form.locator('[name="summer_norm"]').fill('0');await form.locator('[name="summer_normCity"]').fill('');await form.locator('[name="winter_norm"]').fill('12,125');
 await review(form);assert.equal(await page.evaluate(()=>__requests.length),0);assert.equal(await page.evaluate(()=>data.vehicles[0].fuelNorms),undefined);await confirm(form);await closed();
 assert.deepEqual(await page.evaluate(()=>({summer:data.vehicles[0].fuelSeasons.summer,winter:data.vehicles[0].fuelSeasons.winter,norm:data.vehicles[0].norm,periods:data.vehicles[0].fuelNorms,facts:JSON.stringify([data.records,data.genRecords,data.fuelPurchases])===__facts,requests:__requests.length,writes:__writes})),{summer:vehicleNorm(0),winter:vehicleNorm(12.125),norm:10,periods:undefined,facts:true,requests:1,writes:1});
});

test('profile confirmation names the two inert templates without asking to confirm a nonexistent effective date',async()=>{
 await page.evaluate(()=>seasonalFuelProfilesOpen('vehicles',0));const form=page.locator('#seasonalFuelProfileForm');await form.locator('[name="summer_norm"]').fill('8,125');await review(form);
 assert.equal(await form.locator('input[type="date"]').count(),0);assert.equal((await form.locator('[data-sf-confirm]').innerText()).trim(),'Подтверждаю летний и зимний наборы; действующие нормы по датам не меняются');assert.equal((await form.locator('[data-sf-confirm]').innerText()).includes('выбранную дату'),false);await unchanged();
});

test('group preview aggregates only the common legacy preservation notice while retaining every typed asset change',async()=>{
 const form=await open();await fill(form);await review(form);const note=form.locator('[data-sf-warning="SEASON_LEGACY_BASELINE"]');assert.equal(await note.count(),1);assert.match(await note.innerText(),/Карточек: 2/);assert.deepEqual(await form.locator('[data-sf-change-id]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-sf-change-id'))),['["number",0]','["string","0"]']);await unchanged();
});

test('one vehicle transition is atomic, applies only after canonical ACK, preserves historical facts and leaves DES unchanged',async()=>{
 const generators=await page.evaluate(()=>JSON.stringify(data.generators));const form=await open();await fill(form);await review(form);await page.evaluate(()=>{__hold=true;__canonicalFrom='2026-11-01';});await confirm(form);await page.waitForFunction(()=>__requests.length===1);
 assert.equal(await page.evaluate(()=>JSON.stringify(data)===__baseline),true);assert.equal(await page.evaluate(()=>__writes),0);await page.evaluate(()=>{__hold=false;__release();});await closed();
 const result=await page.evaluate(()=>({request:__requests[0],rows:data.vehicles,des:JSON.stringify(data.generators),facts:JSON.stringify([data.records,data.genRecords,data.fuelPurchases])===__facts,writes:__writes,status:document.querySelector('[data-seasonal-status="vehicles"]')?.textContent}));
 assert.equal(result.des,generators);assert.equal(result.facts,true);assert.equal(result.writes,1);assert.deepEqual(Object.keys(result.request.sections).filter(name=>name!=='auditLog'),['vehicles']);
 for(const row of result.rows.filter(row=>!row.archived)){const period=row.fuelNorms.periods.find(period=>period.from==='2026-11-01');assert.equal(period.parameters.norm,typeof row.id==='number'?12:25);assert.equal(period.basis,'SYNTHETIC CANONICAL ACK');assert.equal(row.norm,typeof row.id==='number'?10:20);}assert.equal(result.rows.find(row=>row.archived).fuelNorms,undefined);
});

test('DES transition is separate and carries the dated rated power without adding power to seasonal profiles',async()=>{
 const vehicles=await page.evaluate(()=>JSON.stringify(data.vehicles));const form=await open('generators','summer');await fill(form);await review(form);await confirm(form);await closed();
 const result=await page.evaluate(()=>({vehicles:JSON.stringify(data.vehicles),rows:data.generators,request:__requests[0]}));assert.equal(result.vehicles,vehicles);assert.deepEqual(Object.keys(result.request.sections).filter(name=>name!=='auditLog'),['generators']);
 for(const row of result.rows){const period=row.fuelNorms.periods.find(period=>period.from==='2026-11-01');assert.equal(period.parameters.power,typeof row.id==='number'?100:200);assert.equal(period.parameters.norm,typeof row.id==='number'?1:2);assert.equal(Object.hasOwn(row.fuelSeasons.summer,'power'),false);}
});

test('a missing profile blocks the whole group with a typed link to the correct profile editor',async()=>{
 await page.evaluate(()=>{delete data.vehicles[1].fuelSeasons;_lastPersisted=JSON.stringify(data);_sync.synced.vehicles=JSON.stringify(data.vehicles);__baseline=JSON.stringify(data);dispatcherInvalidate();renderFuelPurchases();});
 const form=await open();await fill(form);await review(form);assert.equal(await form.locator('[data-sf-change-id]').count(),0);assert.equal(await form.locator('[data-sf-confirm]').isVisible(),false);assert.equal(await page.evaluate(()=>__requests.length),0);
 await form.locator('[data-sf-issue]').first().click();assert.equal(await page.evaluate(()=>seasonalFuelDialogState.id),'0');assert.equal(await page.evaluate(()=>typeof seasonalFuelDialogState.id),'string');assert.match(await page.locator('#wfModal .modal-title').innerText(),/STRING ZERO/);
 assert.equal(await page.evaluate(()=>JSON.stringify(data)===__baseline),true);
});

test('a historical DES blocker opens numeric zero source record and parent, rejects stale journal navigation, and writes nothing',async()=>{
 await page.evaluate(()=>{data.genRecords=[{id:0,generatorId:0,date:'2026-09-01',hours:1,tankId:null,note:'SYNTHETIC NUMBER SOURCE'},{id:'0',generatorId:'0',date:'2026-09-01',hours:1,fuelActual:0,tankId:null,note:'SYNTHETIC STRING SOURCE'}];_lastPersisted=JSON.stringify(data);_sync.synced.genRecords=JSON.stringify(data.genRecords);rebuildIndex();__baseline=JSON.stringify(data);renderFuelPurchases();});
 let form=await open('generators','summer');await fill(form);await review(form);let source=form.locator('[data-sf-issue-kind="record"]');assert.equal(await source.count(),1);assert.equal(await source.innerText(),'Открыть запись ДЭС');assert.equal(await form.locator('[data-sf-change-id]').count(),0);assert.equal(await form.locator('[data-sf-confirm]').isVisible(),false);
 await page.evaluate(()=>{data.genRecords[0].note='A newer journal source';});await source.click();assert.match(await error(form),/журнал ДЭС изменился/);assert.equal(await page.locator('#genRecordModal.open').count(),0);assert.equal(await page.evaluate(()=>activeSection),'fuelPurchases');
 await page.evaluate(()=>{data.genRecords[0].note='SYNTHETIC NUMBER SOURCE';closeModal('wfModal');rebuildIndex();renderFuelPurchases();});form=await open('generators','summer');await fill(form);await review(form);source=form.locator('[data-sf-issue-kind="record"]');await source.click();
 assert.equal(await page.locator('#genRecordModal.open').count(),1);assert.deepEqual(await page.evaluate(()=>({record:editingGenRecordId,recordType:typeof editingGenRecordId,parent:selectedGeneratorId,parentType:typeof selectedGeneratorId,section:activeSection,year:selectedGenYear,month:selectedGenMonth})),{record:0,recordType:'number',parent:0,parentType:'number',section:'generators',year:2026,month:9});assert.equal(await page.locator('#gen_rec_note').inputValue(),'SYNTHETIC NUMBER SOURCE');assert.equal(await page.locator('#gen_rec_date').inputValue(),'01.09.2026');assert.equal(await page.locator('#seasonalFuelProfileForm').count(),0);await unchanged();
});

test('a chosen transition date retains a future custom period and explains its inclusive end date',async()=>{
 await page.evaluate(()=>{const v=data.vehicles[0],base={norm:10,normCity:null,normHighway:null,normIdle:0};v.fuelNorms={version:1,periods:[{id:'previous',from:'2026-09-01',basis:'Synthetic previous norm',parameters:base},{id:'future',from:'2026-12-01',basis:'Synthetic future custom norm',parameters:{...base,norm:9}}]};_lastPersisted=JSON.stringify(data);_sync.synced.vehicles=JSON.stringify(data.vehicles);dispatcherInvalidate();renderFuelPurchases();});
 const form=await open();await fill(form);await review(form);assert.match(await form.locator('[data-sf-preview]').innerText(),/30\.11\.2026/);await confirm(form);await closed();
 assert.deepEqual(await page.evaluate(()=>data.vehicles[0].fuelNorms.periods.find(period=>period.id==='future')),{id:'future',from:'2026-12-01',basis:'Synthetic future custom norm',parameters:vehicleNorm(9)});
});

for(const mode of ['reject','unknown'])test(mode+' ACK keeps the entire draft and retries the same transition operation without partial mutation',async()=>{
 const form=await open();await fill(form);await review(form);await page.evaluate(mode=>{__mode=mode;},mode);await confirm(form);await error(form);
 assert.equal(await page.evaluate(()=>JSON.stringify(data)===__baseline),true);assert.equal(await form.locator('[name="from"]').inputValue(),'2026-11-01');assert.equal(await form.locator('[name="basis"]').inputValue(),'Synthetic approved seasonal transition');const first=await page.evaluate(()=>__requests[0]);
 await page.evaluate(()=>{__mode='ok';});await form.locator('[data-sf-save]').click();await closed();const second=await page.evaluate(()=>__requests[1]);assert.equal(second.operation.id,first.operation.id);assert.deepEqual(second.sections.vehicles,first.sections.vehicles);assert.equal(await page.evaluate(()=>__writes),1);
});

test('a successful response without canonical rows cannot apply an assumed seasonal result to live data',async()=>{
 const form=await open();await fill(form);await review(form);await page.evaluate(()=>{__mode='missingCanonical';});await confirm(form);assert.match(await error(form),/не подтверд|не подтвержден/);
 assert.equal(await page.evaluate(()=>JSON.stringify(data)===__baseline),true);assert.equal(await form.locator('[name="from"]').inputValue(),'2026-11-01');assert.equal(await page.locator('#wfModal').evaluate(node=>node.classList.contains('open')),true);assert.equal(await page.evaluate(()=>__requests.length),1);
});

test('a repeated identical seasonal switch explains that no change is needed and sends no second save',async()=>{
 let form=await open();await fill(form);await review(form);await confirm(form);await closed();assert.equal(await page.evaluate(()=>__requests.length),1);
 form=await open();await fill(form);await review(form);assert.match(await form.locator('[data-sf-preview]').innerText(),/уже установлены/);assert.equal(await form.locator('[data-sf-change-id]').count(),0);assert.equal(await form.locator('[data-sf-confirm]').isVisible(),false);assert.equal(await form.locator('[data-sf-save]').isDisabled(),true);assert.equal(await page.evaluate(()=>__requests.length),1);
});

for(const change of ['source','session','modal'])test('a '+change+' change during ACK wait cannot apply or close a stale seasonal form',async()=>{
 const form=await open();await fill(form);await review(form);await page.evaluate(()=>{__hold=true;});await confirm(form);await page.waitForFunction(()=>__requests.length===1);
 await page.evaluate(change=>{if(change==='source')data.vehicles[0].note='Retain a newer unsaved card';else if(change==='session'){_sync.access={user:{id:'another',name:'Synthetic B',role:'admin'},readable:PlatformSchema.sections,writable:PlatformSchema.sections};data=structuredClone(data);}else wfShowDialog('Another form','<input id="seasonalUnrelatedDraft" value="Keep this draft">');window.__current=JSON.stringify(data);},change);
 await page.evaluate(()=>{__hold=false;__release();});await page.waitForFunction(()=>seasonalFuelDialogState?.pending===false);assert.equal(await page.evaluate(()=>JSON.stringify(data)===__current),true);
 if(change==='modal'){assert.equal(await page.locator('#seasonalUnrelatedDraft').inputValue(),'Keep this draft');assert.equal(await page.locator('#wfModal').evaluate(node=>node.classList.contains('open')),true);}else assert.ok((await error(form)).length>0);
});

test('viewer, field-limited and old-server sessions can inspect profiles but cannot submit a seasonal write',async()=>{
 for(const mode of ['viewer','field','old-server','unconfirmed-host']){
  await page.evaluate(mode=>{_sync.access=mode==='viewer'?{user:{id:'viewer',role:'viewer'},readable:PlatformSchema.sections,writable:[]}:{user:{id:'limited',role:'admin'},readable:PlatformSchema.sections,writable:PlatformSchema.sections,fieldPermissions:mode==='field'?{vehicles:['note'],generators:['note']}:null};if(mode==='old-server')_sync.platform.negotiation.selectedProfile.capabilities=_sync.platform.negotiation.selectedProfile.capabilities.filter(item=>item.name!=='seasonalFuelNormsV1');if(mode==='unconfirmed-host'){_sync.platform.negotiation=null;electronAPI.getSettings=async()=>({});}renderFuelPurchases();},mode);
  assert.equal(await page.locator('[data-seasonal-switch="vehicles:winter"]').isDisabled(),true);await page.evaluate(()=>seasonalFuelOpen('vehicles','winter'));assert.equal(await page.locator('#seasonalFuelApplyForm').count(),0);await page.evaluate(()=>seasonalFuelProfilesOpen('vehicles',0));assert.equal(await page.locator('#seasonalFuelProfileForm [data-sf-save]').count(),0);await page.locator('#seasonalFuelProfileForm [data-sf-cancel]').click();
 }
 assert.equal(await page.evaluate(()=>__requests.length),0);assert.equal(await page.evaluate(()=>__writes),0);
});

test('seasonal labels remain escaped and both themes fit the supported dialog width',async()=>{
 await page.evaluate(()=>{data.vehicles[0].plate='SYNTHETIC <img src=x onerror="window.__seasonalInjected=1">';dispatcherInvalidate();renderFuelPurchases();});
 for(const theme of ['light','dark']){await page.setViewportSize({width:960,height:850});await page.evaluate(theme=>applyTheme(theme),theme);await page.locator('[data-seasonal-configure="vehicles"]').click();assert.equal(await page.locator('#wfModal [onerror],#wfModal img[src=x]').count(),0);await page.locator('#wfModal [data-sf-edit-index="0"]').click();assert.equal(await page.locator('#wfModal [onerror],#wfModal img[src=x]').count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.locator('#seasonalFuelProfileForm [data-sf-cancel]').click();}
 assert.equal(await page.evaluate(()=>window.__seasonalInjected||0),0);assert.equal(await page.evaluate(()=>__writes),0);
});

test('more than128 simultaneously visible card buttons retain first and last typed destinations and reuse references within one source epoch',async()=>{
 await page.evaluate(()=>{const original=data.vehicles[0];data.vehicles=Array.from({length:150},(_,index)=>({...structuredClone(original),id:index===149?'0':index,plate:'SYNTHETIC CARD '+index}));dispatcherInvalidate();const html=()=>data.vehicles.map((row,index)=>'<article data-seasonal-test-card="'+index+'">'+seasonalFuelCardButton('vehicles',row.id)+'</article>').join('');document.getElementById('mainContent').innerHTML=html();window.__firstReferenceCount=seasonalFuelReferences.size;html();window.__secondReferenceCount=seasonalFuelReferences.size;});
 assert.deepEqual(await page.evaluate(()=>[__firstReferenceCount,__secondReferenceCount]),[150,150]);
 for(const [index,id]of [[0,0],[149,'0']]){await page.locator('[data-seasonal-test-card="'+index+'"] button').click();assert.equal(await page.evaluate(()=>seasonalFuelDialogState.id),id);assert.equal(await page.evaluate(()=>typeof seasonalFuelDialogState.id),typeof id);assert.match(await page.locator('#wfModal .modal-title').innerText(),new RegExp('CARD '+index));await page.locator('#seasonalFuelProfileForm [data-sf-cancel]').click();}
 assert.equal(await page.evaluate(()=>__writes),0);
});
