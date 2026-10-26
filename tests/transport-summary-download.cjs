'use strict';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os'),{pathToFileURL}=require('node:url'),{createRequire}=require('node:module');
const {install}=require('./helpers/ui-snapshot-fixture.cjs');
let playwright;try{playwright=require('playwright');}catch{playwright=createRequire(path.join(process.env.TVS_PLAYWRIGHT_MODULES||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),'package.json'))('playwright');}
let browser;
before(async()=>{const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';browser=await playwright.chromium.launch({headless:true,executablePath:process.env.TVS_TEST_BROWSER||(!process.env.CI&&fs.existsSync(edge)?edge:undefined)});});
after(async()=>{await browser?.close();});
function legacySeed(){return {vehicles:[{id:'synthetic-float-v',plate:'SYNTHETIC-FLOAT',make:'Synthetic vehicle',fuel:'diesel',fuelGrade:'ДТ',norm:10,fuelBalance:60}],records:[{id:'synthetic-float-r',vehicleId:'synthetic-float-v',date:'2026-10-01',km:100,fuelIssued:100.3-0.01,fuelActual:10}],fuelCards:[{id:'cash',number:'НАЛИЧКА',provider:'Наличка',assignments:[]}],appMeta:[{id:'meta',toPlanInit:'synthetic'}]};}

async function exportSummary(t,{seed,from=null,to=null,check}){
 const page=await browser.newPage({viewport:{width:1280,height:900},acceptDownloads:true}),errors=[];t.after(()=>page.close());page.on('pageerror',error=>errors.push(error.message));
 await install(page,{database:seed,token:'synthetic-transport-download',countWrites:true});await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);await page.waitForFunction(count=>typeof data!=='undefined'&&data.vehicles?.length===count,seed.vehicles.length);await page.evaluate(()=>{toAutoSetupOnce=async()=>{};switchSection('vehicles');window.__sourceBeforeSummary={data:JSON.stringify(data),disk:window.__disk};});
 await page.locator('.vehicle-cards-toolbar').getByRole('button',{name:'Выгрузить сводку',exact:true}).click();await page.locator('#vehicleSummaryExportMenu').getByRole('button',{name:'Сводка в XLS',exact:true}).click();if(from){await page.locator('#ep_range').check();await page.locator('#ep_date_from').fill(from);await page.locator('#ep_date_to').fill(to);}
 const expected=page.waitForEvent('download',{timeout:5000});await page.locator('#exportPeriodModal').getByRole('button',{name:'Выгрузить',exact:true}).click();const download=await expected.catch(error=>{throw Error(error.message+'; renderer errors: '+errors.join('; '));});assert.match(download.suggestedFilename(),from?/^Сводка_все_ТС_.*_01102026-31102026\.xlsx$/:/^Сводка_все_ТС_.*_всё_время\.xlsx$/);assert.equal(await download.failure(),null);
 const stream=await download.createReadStream(),chunks=[];let size=0;for await(const chunk of stream){size+=chunk.length;assert.ok(size<10*1024*1024);chunks.push(chunk);}const bytes=Buffer.concat(chunks);assert.ok(bytes.length>1000);assert.equal(bytes.subarray(0,2).toString(),'PK');
 const book=await page.evaluate(bytes=>{const result=XLSX.read(new Uint8Array(bytes),{type:'array'});return {names:result.SheetNames,rows:XLSX.utils.sheet_to_json(result.Sheets['Общая сводка'],{header:1,defval:''})};},Array.from(bytes));assert.deepEqual(book.names,['Общая сводка']);await check(book);
 assert.deepEqual(await page.evaluate(()=>({dataUnchanged:JSON.stringify(data)===window.__sourceBeforeSummary.data,diskUnchanged:window.__disk===window.__sourceBeforeSummary.disk,writes:window.__writes})),{dataUnchanged:true,diskUnchanged:true,writes:0});assert.deepEqual(errors,[]);
}

test('transport summary downloads a real XLSX workbook for the selected period without saving source data',async t=>{
 const seed={vehicles:[{id:'synthetic-summary-v1',plate:'SYNTHETIC-101',make:'Synthetic vehicle',org:'Synthetic organization',object:'Synthetic site',fuel:'diesel',fuelGrade:'ДТ',norm:10,fuelBalance:30},{id:'synthetic-summary-v2',plate:'SYNTHETIC-102',make:'Synthetic second vehicle',org:'Synthetic organization',fuel:'gasoline',fuelGrade:'АИ-92',norm:8,fuelBalance:20}],records:[{id:'synthetic-summary-r1',vehicleId:'synthetic-summary-v1',date:'2026-10-01',km:125,fuelIssued:20,fuelActual:12.5,route:['SYNTHETIC_INCLUDED_ROUTE']},{id:'synthetic-summary-r2',vehicleId:'synthetic-summary-v2',date:'2026-10-02',km:50,fuelIssued:10,fuelActual:4},{id:'synthetic-summary-outside',vehicleId:'synthetic-summary-v1',date:'2026-09-30',km:999,route:['SYNTHETIC_OUTSIDE_PERIOD']}],fuelCards:[{id:'cash',number:'НАЛИЧКА',provider:'Наличка',assignments:[]}],appMeta:[{id:'meta',toPlanInit:'synthetic'}]};
 await exportSummary(t,{seed,from:'01.10.2026',to:'31.10.2026',check(book){assert.equal(book.rows.find(row=>row[1]==='SYNTHETIC-101')[8],125);assert.equal(book.rows.find(row=>row[1]==='SYNTHETIC-102')[8],50);assert.equal(book.rows.find(row=>row[1]==='ИТОГО')[8],175);assert.equal(book.rows.flat().some(value=>String(value).includes('SYNTHETIC_OUTSIDE_PERIOD')),false);assert.ok(book.rows.flat().some(value=>String(value).includes('SYNTHETIC_INCLUDED_ROUTE')));}});
});

test('transport summary accepts a legacy floating point fuel amount and leaves the stored source untouched',async t=>{
 const legacyIssued=100.3-0.01;assert.equal(legacyIssued,100.28999999999999);
 const seed=legacySeed();
 await exportSummary(t,{seed,check(book){const row=book.rows.find(row=>row[1]==='SYNTHETIC-FLOAT');assert.ok(row);assert.equal(row[9],100.29);assert.equal(row[11],10);assert.equal(row[12],150.29);}});
});

test('transport PDF summary accepts the same legacy fuel amount without changing source data',async t=>{
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];t.after(()=>page.close());page.on('pageerror',error=>errors.push(error.message));await install(page,{database:legacySeed(),token:'synthetic-transport-pdf',countWrites:true});await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);await page.waitForFunction(()=>typeof data!=='undefined'&&data.vehicles?.length===1);
 await page.evaluate(()=>{toAutoSetupOnce=async()=>{};switchSection('vehicles');window.__beforePdf={data:JSON.stringify(data),disk:window.__disk};window.__summaryPdf=null;electronAPI.exportPdf=async(html,fileName)=>{window.__summaryPdf={html,fileName};return {ok:true};};});
 await page.locator('.vehicle-cards-toolbar').getByRole('button',{name:'Выгрузить сводку',exact:true}).click();await page.locator('#vehicleSummaryExportMenu').getByRole('button',{name:'Сводка в PDF',exact:true}).click();await page.locator('#exportPeriodModal').getByRole('button',{name:'Выгрузить',exact:true}).click();await page.waitForFunction(()=>window.__summaryPdf!==null,null,{timeout:5000});
 const result=await page.evaluate(()=>{const doc=new DOMParser().parseFromString(window.__summaryPdf.html,'text/html'),row=[...doc.querySelectorAll('tr')].find(row=>row.cells[1]?.textContent==='SYNTHETIC-FLOAT'),number=index=>Number(row.cells[index].textContent.replace(/\s/g,'').replace(',','.'));return {fileName:window.__summaryPdf.fileName,issued:number(9),actual:number(11),balance:number(12),dataUnchanged:JSON.stringify(data)===window.__beforePdf.data,diskUnchanged:window.__disk===window.__beforePdf.disk,writes:window.__writes};});
 assert.match(result.fileName,/\.pdf$/);assert.deepEqual({...result,fileName:''},{fileName:'',issued:100.29,actual:10,balance:150.29,dataUnchanged:true,diskUnchanged:true,writes:0});assert.deepEqual(errors,[]);
});

if(process.env.TVS_TRANSPORT_SUMMARY_FIXTURE)test('transport summary downloads the locally supplied deidentified legacy fixture without changing facts',async t=>{
 const seed=JSON.parse(fs.readFileSync(process.env.TVS_TRANSPORT_SUMMARY_FIXTURE,'utf8'));
 await exportSummary(t,{seed,check(book){const row=book.rows.find(row=>row[1]===seed.vehicles[0].plate);assert.ok(row);for(const column of [8,9,10,11,12])assert.equal(Number.isFinite(row[column]),true,'Numeric transport summary column '+column);}});
});
