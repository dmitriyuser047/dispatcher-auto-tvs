'use strict';
const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{createRequire}=require('node:module');
let pw;try{pw=require('playwright');}catch{pw=createRequire(path.join(process.env.TVS_PLAYWRIGHT_MODULES||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),'package.json'))('playwright');}
let browser,page,errors;
before(async()=>{const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';browser=await pw.chromium.launch({headless:true,executablePath:process.env.TVS_TEST_BROWSER||(!process.env.CI&&fs.existsSync(edge)?edge:undefined)});});
after(async()=>{await browser?.close();});
beforeEach(async()=>{
 page=await browser.newPage({viewport:{width:1280,height:900}});errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  const seed=label=>({vehicles:[{id:'rollback-v-'+label,plate:'SYNTHETIC '+label,make:'Synthetic',org:'Synthetic '+label,driver:'Synthetic driver',fuelGrade:'ДТ',norm:10,fuelBalance:100}],records:[{id:'rollback-r-'+label,vehicleId:'rollback-v-'+label,date:'2026-10-01',km:10,fuelActual:1}],fuelCards:[{id:'fc_cash',number:'НАЛИЧКА',provider:'Наличка',assignments:[]}],appMeta:[{id:'meta',toPlanInit:'test'}]});
  window.__activeProfile=0;window.__disks={'rollback-A':seed('A'),'rollback-B':seed('B')};window.__revisions={};window.__writes=[];window.__hold=false;window.__reject=false;
  window.__settings=()=>({networkMode:'local',activeUser:window.__activeProfile,users:[{name:'Synthetic A',dataDir:'synthetic-rollback-A'},{name:'Synthetic B',dataDir:'synthetic-rollback-B'}]});
  window.electronAPI={getSettings:async()=>window.__settings(),switchUser:async index=>{window.__activeProfile=index;return{ok:true};},
   readSnapshot:async()=>{const token=window.__activeProfile?'rollback-B':'rollback-A',db=window.__disks[token],revs=window.__revisions[token]??={};for(const name of PlatformSchema.sections){db[name]??=[];revs[name]??=1;}return JSON.stringify({data:db,revisions:{...revs},databaseToken:token,platform:{apiVersion:1,operations:1}});},
   writeSections:async raw=>{
    const request=JSON.parse(raw);window.__writes.push(request);
    if(window.__hold)await new Promise(resolve=>window.__release=resolve);
    if(window.__reject)return{ok:false,error:'Synthetic save failure'};
    const db=window.__disks[request.databaseToken],revs=window.__revisions[request.databaseToken];
    for(const [name,rows]of Object.entries(request.sections)){db[name]=structuredClone(rows);revs[name]++;}
    return{ok:true,databaseToken:request.databaseToken,revisions:{...revs},canonicalSections:structuredClone(request.sections),operationReceipt:{id:request.operation.id,digest:PlatformKernel.requestDigest(request),status:'committed'}};
   }};
 });
 await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);
 await page.waitForFunction(()=>typeof captureSaveRollback==='function'&&typeof data!=='undefined'&&data.vehicles[0]?.id==='rollback-v-A'&&_appSettings?.activeUser===0);
});
afterEach(async()=>{await page?.close();assert.deepEqual(errors,[]);});
async function startDelete(){
 await page.evaluate(()=>{window.__handler=deleteRecord('rollback-r-A');});
 await page.locator('#confirmYes').click();
}
async function switchToB(){
 return page.evaluate(async()=>{closeModal('recordModal');await settingsSwitchUser(1);return{data:JSON.stringify(data),baseline:_lastPersisted,synced:JSON.stringify(_sync.synced),revisions:JSON.stringify(_sync.revs)};});
}
for(const action of ['delete','save'])test('a delayed '+action+' record handler cannot roll profile A over the newly loaded profile B',async()=>{
 await page.evaluate(()=>{window.__hold=true;});
 if(action==='delete')await startDelete();
 else{
  await page.evaluate(()=>{selectedVehicleId='rollback-v-A';openAddRecord();});
  await page.locator('#rec_date').fill('02.10.2026');await page.locator('#rec_km').fill('12');
  await page.evaluate(()=>{window.__handler=saveRecord();});
 }
 await page.waitForFunction(()=>typeof window.__release==='function');
 const expected=await switchToB();
 const actual=await page.evaluate(async()=>{window.__release();await window.__handler;return{data:JSON.stringify(data),baseline:_lastPersisted,synced:JSON.stringify(_sync.synced),revisions:JSON.stringify(_sync.revs),token:_sync.databaseToken,profile:_appSettings.activeUser,submittedToken:window.__writes[0].databaseToken};});
 assert.deepEqual(actual,{...expected,token:'rollback-B',profile:1,submittedToken:'rollback-A'});
});
test('a rejected same-session record delete restores its original rows after the platform has restored its baseline',async()=>{
 const before=await page.evaluate(()=>{window.__reject=true;return JSON.stringify(data);});
 await startDelete();await page.evaluate(()=>window.__handler);
 const actual=await page.evaluate(()=>({data:JSON.stringify(data),record:recsFor('rollback-v-A')[0]?.id,disk:window.__disks['rollback-A'].records[0]?.id,writes:window.__writes.length}));
 assert.deepEqual(actual,{data:before,record:'rollback-r-A',disk:'rollback-r-A',writes:1});
});
test('a successful record delete keeps canonical saved data and its indexes',async()=>{
 await startDelete();await page.evaluate(()=>window.__handler);
 assert.deepEqual(await page.evaluate(()=>({records:data.records.length,index:recsFor('rollback-v-A').length,disk:window.__disks['rollback-A'].records.length,baseline:JSON.parse(_lastPersisted).records.length,writes:window.__writes.length})),{records:0,index:0,disk:0,baseline:0,writes:1});
});
test('rollback ownership rejects a replacement tree in the same session and a changed session retaining the old tree',async()=>{
 const result=await page.evaluate(()=>{
  const owned=data,owner=captureSaveRollback();data=structuredClone(data);data.vehicles[0].plate='Fresh same-session tree';const replacement=restoreSaveRollback(owner),plate=data.vehicles[0].plate;
  data=owned;_sync.databaseToken='rollback-B';const changedSession=restoreSaveRollback(owner);return{replacement,plate,changedSession,retained:data===owned};
 });
 assert.deepEqual(result,{replacement:false,plate:'Fresh same-session tree',changedSession:false,retained:true});
});
