const { test,before,after,beforeEach,afterEach }=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{createRequire}=require('node:module');
let pw;try{pw=require('playwright');}catch{pw=createRequire(path.join(process.env.TVS_PLAYWRIGHT_MODULES||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),'package.json'))('playwright');}
let browser,page,errors;
before(async()=>{const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';browser=await pw.chromium.launch({headless:true,executablePath:process.env.TVS_TEST_BROWSER||(!process.env.CI&&fs.existsSync(edge)?edge:undefined)});});
after(async()=>{await browser?.close();});
beforeEach(async()=>{
 page=await browser.newPage({viewport:{width:1280,height:900}});errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await page.addInitScript(()=>{
  const seed={vehicles:[{id:'platform-v',plate:'SYNTHETIC-PLATFORM',make:'Synthetic',org:'A',fuelGrade:'ДТ',norm:10,fuelBalance:100}],records:[{id:'platform-r',vehicleId:'platform-v',date:'2026-10-01',km:10,fuelActual:1}],parts:[{id:'platform-part',name:'Synthetic filter',unit:'шт'}],partMovements:[{id:'platform-move',date:'2026-10-01',partId:'platform-part',kind:'receipt',qty:3,reason:'Synthetic'}],fuelCards:[{id:'fc_cash',number:'НАЛИЧКА',provider:'Наличка',assignments:[]}],appMeta:[{id:'meta',toPlanInit:'test'}]};
  window.__disk=JSON.stringify(seed);window.__writes=0;window.__reject=false;window.__defer=false;window.__token='platform-synthetic-db';window.__revisions={};
  window.electronAPI={readSnapshot:async()=>{
   const db=JSON.parse(window.__disk);for(const name of PlatformSchema.sections){db[name]??=[];window.__revisions[name]??=1;}window.__disk=JSON.stringify(db);
   return JSON.stringify({data:db,revisions:window.__revisions,databaseToken:window.__token,platform:{apiVersion:1,operations:1}});
  },writeSections:async raw=>{
   window.__writes++;if(window.__reject)return{ok:false,error:'Synthetic failed save'};
   if(window.__defer)await new Promise(resolve=>{window.__release=resolve;});
   const request=JSON.parse(raw),db=JSON.parse(window.__disk);
   for(const [name,rows]of Object.entries(request.sections)){db[name]=rows;window.__revisions[name]++;}
   window.__disk=JSON.stringify(db);return{ok:true,revisions:{...window.__revisions},databaseToken:request.databaseToken,canonicalSections:request.sections,...(window.__missingReceipt?{}:{operationReceipt:{id:request.operation?.id,status:'committed'}})};
  }};
 });
 await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);
 await page.waitForFunction(()=>typeof platformExecuteSave==='function'&&typeof data!=='undefined'&&data.vehicles[0]?.id==='platform-v');
});
afterEach(async()=>{await page?.close();assert.deepEqual(errors,[]);});

test('system workspace inspects all modules without writing data and fits supported themes',async()=>{
 const before=await page.evaluate(()=>JSON.stringify(data));
 for(const [width,theme]of [[1280,'light'],[960,'dark']]){
  await page.setViewportSize({width,height:900});await page.evaluate(theme=>{applyTheme(theme);switchSection('system');},theme);
  assert.equal(await page.locator('.platform-modules article').count(),10);assert.match(await page.locator('.platform-workspace').innerText(),/Транспорт|Диспетчерская/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 }
 assert.equal(await page.evaluate(()=>JSON.stringify(data)),before);assert.equal(await page.evaluate(()=>window.__writes),0);
 await page.screenshot({path:path.resolve(__dirname,'../audit/platform-workspace-preview.png'),fullPage:false});
});

test('all saves share the transaction bus across finance, tasks and inventory',async()=>{
 const result=await page.evaluate(async()=>{
  data.payments.push({id:'platform-payment',date:'2026-10-02',sum:100,company:'Synthetic'});const finance=await saveData(data);
  data.opsTasks.push({id:'platform-task',title:'Synthetic task',status:'open',owner:'Synthetic owner',due:'2026-10-03'});const tasks=await saveData(data);
  data.parts[0].name='Synthetic updated filter';const inventory=await saveData(data);
  return{finance,tasks,inventory,status:platformRuntimeStatus(),writes:window.__writes};
 });
 assert.deepEqual([result.finance,result.tasks,result.inventory],[true,true,true]);assert.equal(result.writes,3);assert.equal(result.status.committed,3);
 const sections=result.status.recent.flatMap(row=>row.sections);for(const name of ['payments','opsTasks','parts'])assert.ok(sections.includes(name));
});

test('exported health diagnostics omit malformed source payloads and actual financial values',async()=>{
 const result=await page.evaluate(()=>{
  data.payments={secret:'SYNTHETIC-PRIVATE-UNRELATED-PAYLOAD',amount:987654321};
  return JSON.stringify(platformHealthSnapshot());
 });
 assert.doesNotMatch(result,/SYNTHETIC-PRIVATE-UNRELATED-PAYLOAD|987654321/);assert.match(result,/invalid-section/);
});

test('new orphan references and parent deletion fail before native IO while atomic child deletion succeeds',async()=>{
 const result=await page.evaluate(async()=>{
  data.records[0].vehicleId='missing';const orphan=await saveData(data);const afterOrphan=data.records[0].vehicleId;
  data.vehicles=[];const parent=await saveData(data);const afterParent=data.vehicles.length;
  data.vehicles=[];data.records=[];const atomic=await saveData(data);
  return{orphan,afterOrphan,parent,afterParent,atomic,writes:window.__writes,vehicles:data.vehicles.length,records:data.records.length};
 });
 assert.deepEqual(result,{orphan:false,afterOrphan:'platform-v',parent:false,afterParent:1,atomic:true,writes:1,vehicles:0,records:0});
});

test('failed save emits no committed event and a new valid command can be retried',async()=>{
 const result=await page.evaluate(async()=>{
  let committed=0;const unsubscribe=platformRuntime().subscribe(()=>committed++);
  window.__reject=true;data.parts[0].name='Synthetic failed';const failed=await saveData(data);const restored=data.parts[0].name;
  window.__reject=false;data.parts[0].name='Synthetic retry';const retried=await saveData(data);unsubscribe();
  return{failed,restored,retried,committed,writes:window.__writes};
 });
 assert.deepEqual(result,{failed:false,restored:'Synthetic filter',retried:true,committed:1,writes:2});
});

test('role restrictions apply to direct saves independently of the editing screen',async()=>{
 const result=await page.evaluate(async()=>{
  _sync.access={user:{id:'viewer',name:'Synthetic viewer',role:'viewer'},readable:PlatformSchema.sections.slice(),writable:[]};
  data.parts[0].name='Forbidden';const saved=await saveData(data);return{saved,writes:window.__writes,name:data.parts[0].name};
 });
 assert.deepEqual(result,{saved:false,writes:0,name:'Synthetic filter'});
});

test('a modern backend must confirm this operation before UI reports a successful save',async()=>{
 const result=await page.evaluate(async()=>{
  window.__missingReceipt=true;data.parts[0].name='Unconfirmed edit';const saved=await saveData(data);
  return{saved,committed:platformRuntimeStatus().committed,writes:window.__writes,error:platformRuntimeStatus().lastError?.message};
 });
 assert.equal(result.saved,false);assert.equal(result.committed,0);assert.equal(result.writes,1);assert.match(result.error,/операци|подтверд/i);
});

test('a late save response cannot overwrite a newly selected database or its sync baseline',async()=>{
 await page.evaluate(()=>{window.__defer=true;data.parts[0].name='Old context edit';window.__save=saveData(data);});
 await page.waitForFunction(()=>!!window.__release);
 const result=await page.evaluate(async()=>{
  const fresh=structuredClone(data);fresh.parts[0].name='New database value';data=fresh;_sync.databaseToken='new-database';_sync.revs={parts:77};_sync.synced={parts:JSON.stringify(fresh.parts)};_lastPersisted=JSON.stringify(fresh);
  window.__release();const saved=await window.__save;return{saved,name:data.parts[0].name,revisions:_sync.revs,synced:JSON.parse(_sync.synced.parts)[0].name};
 });
 assert.deepEqual(result,{saved:false,name:'New database value',revisions:{parts:77},synced:'New database value'});
});
