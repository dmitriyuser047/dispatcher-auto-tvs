const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {createRequire}=require('node:module');
let pw;try{pw=require('playwright');}catch{pw=createRequire(path.join(process.env.TVS_PLAYWRIGHT_MODULES||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),'package.json'))('playwright');}
const root=path.resolve(__dirname,'..');let browser,page,server,url,errors;
before(async()=>{
 server=http.createServer((req,res)=>{
  const file=require('../electron/security').staticFile(root,req.url);
  if(!file||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');
  fs.createReadStream(file).pipe(res);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));url='http://127.0.0.1:'+server.address().port+'/index.html';
 const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';browser=await pw.chromium.launch({headless:true,executablePath:process.env.TVS_TEST_BROWSER||(!process.env.CI&&fs.existsSync(edge)?edge:undefined)});
});
after(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));});
beforeEach(async()=>{
 page=await browser.newPage();errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  window.__writes=0;window.__pageCalls=[];
  window.__disk={vehicles:[{id:'async-v',plate:'SYNTHETIC-ASYNC',norm:10,fuelBalance:100,fuelGrade:'ДТ'}],records:[{id:'async-r',vehicleId:'async-v',date:'2026-10-01',km:100,fuelActual:10}],costEntries:[{id:'async-cost',assetRef:'v:async-v',date:'2026-10-01',kind:'expense',amount:100,title:'Synthetic cost',independent:true}],tanks:[{id:'async-t',name:'Synthetic tank',balanceInit:100}],appMeta:[{id:'meta',toPlanInit:'test'}]};
  window.electronAPI={readData:async()=>JSON.stringify(window.__disk),writeData:async()=>{window.__writes++;return false;},queryRows:async query=>{
   window.__pageCalls.push(structuredClone(query));
   if(window.__holdPage)return new Promise(resolve=>window.__resolvePage=resolve);
   const start=query.cursor?25:0;
   return {ok:true,rows:Array.from({length:25},(_,i)=>({id:start+i,plate:i===0?'<img src=x onerror=window.__injected=true>':'SYNTHETIC-'+(start+i)})),total:50,nextCursor:start?null:'page-2'};
  }};
 });
 await page.goto(url);await page.waitForFunction(()=>typeof data!=='undefined'&&data.vehicles[0]?.id==='async-v');
});
afterEach(async()=>{await page?.close();assert.deepEqual(errors,[]);});
test('real browser worker returns the same isolated results for every calculation',async()=>{
 const result=await page.evaluate(async()=>{
  const before=JSON.stringify(data),answers=[];
  for(const [name,options]of [['fuel',{from:'2026-10-01',to:'2026-10-31'}],['fuelRecords',{vehicleId:'async-v'}],['costs',{from:'2026-10-01',to:'2026-10-31'}],['procurement',{date:'2026-10-21'}],['writeoff',{month:'2026-10',date:'2026-10-21'}]]){
   const actual=await dispatcherQueryAsync(name,options),expected=dispatcherQuery(name,options);answers.push({name,same:JSON.stringify(actual)===JSON.stringify(expected)});
  }
  return {answers,unchanged:before===JSON.stringify(data),writes:window.__writes};
 });
 assert.deepEqual(result.answers.map(row=>[row.name,row.same]),[['fuel',true],['fuelRecords',true],['costs',true],['procurement',true],['writeoff',true]]);assert.equal(result.unchanged,true);assert.equal(result.writes,0);
});
test('large cost workspace calculates off the UI thread and renders current totals',async()=>{
 await page.evaluate(()=>{data.records=Array.from({length:1500},(_,id)=>({id,vehicleId:'async-v',date:'2026-10-01',km:1,fuelActual:0}));costPeriodFrom='2026-10-01';costPeriodTo='2026-10-31';window.__ticks=0;window.__tick=setInterval(()=>window.__ticks++,1);switchSection('costs');});
 await page.locator('.cost-workspace .cost-metrics').waitFor();
 const result=await page.evaluate(()=>{clearInterval(window.__tick);return {ticks:window.__ticks,text:document.querySelector('.cost-workspace').textContent,writes:window.__writes,worker:!!_dispatcherWorker};});
 assert.ok(result.ticks>0);assert.ok(result.worker);assert.match(result.text,/100/);assert.equal(result.writes,0);
});
test('a small database with a large card payload also uses background calculations',async()=>{
 await page.evaluate(()=>{data.vehicles[0].photo='x'.repeat(1024*1024);costPeriodFrom='2026-10-01';costPeriodTo='2026-10-31';switchSection('costs');});
 await page.locator('.cost-workspace .cost-metrics').waitFor();
 assert.deepEqual(await page.evaluate(()=>({background:!!_dispatcherWorker,photoLength:data.vehicles[0].photo.length,writes:window.__writes})),{background:true,photoLength:1024*1024,writes:0});
});
test('large diagnostics run in a worker and agree with the same synchronous inspection',async()=>{
 const expected=await page.evaluate(()=>{
  data.records=Array.from({length:1000},(_,id)=>({id,vehicleId:'async-v',date:'2026-10-01',km:1,fuelActual:0}));
  const report=platformHealthSnapshot();switchSection('system');return report.integrity.counts;
 });
 await page.locator('#platformDataBrowser').waitFor();
 const actual=await page.evaluate(async()=>{const report=await dispatcherHealthAsync();return {counts:report.counts,privateKeys:report.issues.some(row=>Object.keys(row).some(key=>['proof','value','deficit','source'].includes(key))),writes:window.__writes};});
 assert.deepEqual(actual.counts,expected);assert.equal(actual.privateKeys,false);assert.equal(actual.writes,0);
});
test('large procurement search filters the completed plan without losing the input',async()=>{
 await page.evaluate(()=>{data.records=Array.from({length:1000},(_,id)=>({id,vehicleId:'async-v',date:'2026-10-01',km:1}));switchSection('procurement');});
 await page.locator('#pcSearch').waitFor();await page.locator('#pcSearch').pressSequentially('Synthetic');
 assert.equal(await page.locator('#pcSearch').inputValue(),'Synthetic');
 assert.equal(await page.locator('#pcSearch').evaluate(element=>document.activeElement===element),true);
 assert.equal(await page.locator('.pc-plan-grid .pc-card').count(),1);
 await page.locator('#pcSearch').fill('unmatched');assert.equal(await page.locator('.pc-plan-grid .pc-card').count(),0);
});
test('procurement reruns a calculation crossing midnight and refreshes local filters on the next day',async()=>{
 await page.evaluate(()=>{
  data.records=Array.from({length:1000},(_,id)=>({id,vehicleId:'async-v',date:'2026-10-01',km:1}));
  window.__planDay='2026-10-21';wfToday=()=>window.__planDay;window.__planDates=[];
  const original=dispatcherQueryAsync;let hold=true;
  dispatcherQueryAsync=async(name,options,settings)=>{
   const value=await original(name,options,settings);
   if(name==='procurement'){window.__planDates.push(options.date);if(hold){hold=false;await new Promise(resolve=>window.__releasePlanDay=resolve);}}
   return value;
  };
  switchSection('procurement');
 });
 await page.waitForFunction(()=>typeof window.__releasePlanDay==='function');
 await page.evaluate(()=>{window.__planDay='2026-10-22';window.__releasePlanDay();});await page.locator('#pcSearch').waitFor();
 assert.deepEqual(await page.evaluate(()=>window.__planDates),['2026-10-21','2026-10-22']);
 await page.evaluate(()=>window.__planDay='2026-10-23');await page.locator('#pcSearch').fill('Synthetic');await page.locator('#pcSearch').waitFor();
 await page.waitForFunction(()=>window.__planDates.at(-1)==='2026-10-23');
 assert.equal(await page.locator('#pcSearch').inputValue(),'Synthetic');
});
test('health result is discarded after source edits, access changes and cancellation',async()=>{
 const result=await page.evaluate(async()=>{
  const first=dispatcherHealthAsync().then(()=>null,error=>error.code);data.vehicles[0].plate='CURRENT';
  const changed=await first;
  const second=dispatcherHealthAsync().then(()=>null,error=>error.code);_sync.access={user:{id:'restricted',role:'dispatcher'},readable:['vehicles'],writable:[]};
  const access=await second;
  const controller=new AbortController(),third=dispatcherHealthAsync({signal:controller.signal}).then(()=>null,error=>error.code);controller.abort();
  const cancelled=await third,current=await dispatcherHealthAsync();return {changed,access,cancelled,sections:current.sections.filter(row=>row.readable).map(row=>row.section)};
 });assert.deepEqual(result,{changed:'STALE_QUERY',access:'STALE_QUERY',cancelled:'CANCELLED',sections:['vehicles']});
});
test('prepared fuel results are isolated, bounded and invalidated by source changes',async()=>{
 const result=await page.evaluate(async()=>{
  const options={from:'2026-10-01',to:'2026-10-31'},first=await dispatcherQueryAsync('fuel',options),before=JSON.stringify(first);
  first.rows[0].vehicle.plate='LOCAL';
  const prepared=dispatcherPreparedQuery('fuel',options),isolated=JSON.stringify(prepared)===before;
  prepared.rows[0].vehicle.plate='LOCAL2';
  const second=dispatcherPreparedQuery('fuel',options),again=JSON.stringify(second)===before;
  const bounded=_dispatcherPrepared.size<=4&&_dispatcherPreparedCharacters<=32*1024*1024;
  data.records[0].km=125;const stale=dispatcherPreparedQuery('fuel',options);
  return {isolated,again,bounded,stale,writes:window.__writes};
 });assert.deepEqual(result,{isolated:true,again:true,bounded:true,stale:null,writes:0});
});
test('in-place data changes while a query is running reject the obsolete snapshot',async()=>{
 const result=await page.evaluate(async()=>{
  const pending=dispatcherQueryAsync('costs',{from:'2026-10-01',to:'2026-10-31'}).then(()=>null,error=>error.code);
  data.costEntries[0].amount=250;
  const code=await pending,current=await dispatcherQueryAsync('costs',{from:'2026-10-01',to:'2026-10-31'});
  return {code,amount:current.totals.expenses,writes:window.__writes};
 });assert.deepEqual(result,{code:'STALE_QUERY',amount:250,writes:0});
});
test('queued calculations own their nested parameters before worker startup',async()=>{
 const result=await page.evaluate(async()=>{
  const options={from:'2026-10-01',to:'2026-10-31',readable:PlatformSchema.sections.slice()};
  const pending=dispatcherQueryAsync('costs',options);options.readable.length=0;
  return (await pending).totals.expenses;
 });assert.equal(result,100);
});
test('access changes invalidate an active query and the next result obeys current access',async()=>{
 const result=await page.evaluate(async()=>{
  const pending=dispatcherQueryAsync('costs',{from:'2026-10-01',to:'2026-10-31'}).then(()=>null,error=>error.code);
  _sync.access={user:{id:'reader',role:'dispatcher'},readable:PlatformSchema.sections.filter(name=>name!=='costEntries'),writable:[]};
  const code=await pending,current=await dispatcherQueryAsync('costs',{from:'2026-10-01',to:'2026-10-31',readable:PlatformSchema.sections});
  return {code,amount:current.totals.expenses,unavailable:current.unavailable};
 });assert.equal(result.code,'STALE_QUERY');assert.equal(result.amount,null);assert.ok(result.unavailable.includes('costEntries'));
});
test('cancel and explicit invalidation terminate pending work and permit a fresh query',async()=>{
 const result=await page.evaluate(async()=>{
  const controller=new AbortController(),pending=dispatcherQueryAsync('costs',{}, {signal:controller.signal}).then(()=>null,error=>error.code);controller.abort();
  const cancelled=await pending;
  const again=dispatcherQueryAsync('procurement',{date:'2026-10-21'}).then(()=>null,error=>error.code);dispatcherInvalidate();
  const invalidated=await again,current=await dispatcherQueryAsync('costs',{from:'2026-10-01',to:'2026-10-31'});
  return {cancelled,invalidated,amount:current.totals.expenses};
 });assert.deepEqual(result,{cancelled:'CANCELLED',invalidated:'STALE_QUERY',amount:100});
});
test('switching away from an asynchronous workspace cannot replace the new screen',async()=>{
 await page.evaluate(()=>{data.records=Array.from({length:1000},(_,id)=>({id,vehicleId:'async-v',date:'2026-10-01',km:1}));switchSection('costs');switchSection('vehicles');});
 await page.evaluate(async()=>{await dispatcherQueryAsync('procurement',{date:'2026-10-21'});});
 assert.equal(await page.evaluate(()=>activeSection),'vehicles');assert.equal(await page.locator('.cost-workspace').count(),0);
});
test('paged browser loads bounded pages, applies filters and escapes imported text',async()=>{
 await page.evaluate(()=>switchSection('system'));
 const panel=page.locator('#platformDataBrowser');await panel.locator('article').first().waitFor();
 assert.equal(await panel.locator('article').count(),25);assert.equal(await panel.locator('img').count(),0);
 assert.equal(await panel.locator('input[name=from]').isDisabled(),true);
 await panel.locator('[data-page=next]').click();await page.waitForFunction(()=>document.querySelector('#platformDataBrowser [role=status]').textContent.startsWith('Страница 2'));
 await panel.locator('[data-page=previous]').click();await page.waitForFunction(()=>document.querySelector('#platformDataBrowser [role=status]').textContent.startsWith('Страница 1'));
 await panel.locator('select[name=section]').selectOption('records');assert.equal(await panel.locator('input[name=from]').isDisabled(),false);
 await panel.locator('input[name=search]').fill('Synthetic');await panel.locator('input[name=from]').fill('2026-10-01');await panel.locator('button[type=submit]').click();
 const result=await page.evaluate(()=>({last:window.__pageCalls.at(-1),writes:window.__writes,injected:!!window.__injected}));
 assert.deepEqual(result.last,{section:'records',search:'Synthetic',from:'2026-10-01',limit:25});assert.equal(result.writes,0);assert.equal(result.injected,false);
});
test('paged browser suppresses late data from another database session',async()=>{
 await page.evaluate(()=>{window.__holdPage=true;switchSection('system');});
 await page.waitForFunction(()=>typeof window.__resolvePage==='function');
 await page.evaluate(()=>{_sync.databaseToken='another-test-database';window.__resolvePage({ok:true,rows:[{id:'PRIVATE-OLD-SESSION'}],total:1,nextCursor:null});});
 assert.equal(await page.locator('#platformDataBrowser article').count(),0);assert.equal(await page.locator('body').innerText().then(text=>text.includes('PRIVATE-OLD-SESSION')),false);
});
test('opening a page row preserves numeric and string identifiers',async()=>{
 const result=await page.evaluate(()=>{
  data.vehicles=[{id:7,plate:'NUMERIC'},{id:'7',plate:'STRING'}];
  let opened=null;const original=renderDetail;
  try{renderDetail=row=>{opened=row.plate;};platformOpenSource('vehicles','7');return opened;}
  finally{renderDetail=original;}
 });assert.equal(result,'STRING');
});
