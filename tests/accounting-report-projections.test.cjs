'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const fuel=require('../assets/core/fuel-engine.js'),boundary=require('../assets/core/accounting-boundary.js'),sources=require('../assets/core/financial-recognition.js');
const read=file=>fs.readFileSync(path.join(__dirname,'../assets/js',file),'utf8');
const copy=value=>JSON.parse(JSON.stringify(value));
function fixture(explicit=true){
 const accounting={version:1,from:'2026-09-01',opening:923.537,basis:'Synthetic confirmed opening'},extra=explicit?{fuelAccounting:accounting}:{};
 const vehicle={id:'v',plate:'SYNTHETIC-REPORT',make:'Synthetic vehicle',driver:'Synthetic driver',org:'A',object:'Synthetic site',fuel:'diesel',norm:10,fuelBalance:100,...extra};
 const generator={id:'g',name:'SYNTHETIC-DES',org:'A',location:'Synthetic site',fuel:'diesel',fuelBalance:100,tankId:'t',hoursInit:1000,norm:2,cost:7777,...copy(extra)};
 const records=[{id:'v-aug',vehicleId:'v',date:'2026-08-31',km:2000,fuelIssued:1000,fuelUsed:900,fuelActual:900,route:['HISTORICAL_ROUTE']},{id:'v-sep',vehicleId:'v',date:'2026-09-10',km:100,fuelIssued:20,fuelUsed:6,fuelActual:5,route:['SEPTEMBER_ROUTE']},{id:'v-oct',vehicleId:'v',date:'2026-10-10',km:90,fuelIssued:0,fuelUsed:4,fuelActual:3,route:['OCTOBER_ROUTE']}];
 const genRecords=[{id:'g-aug',generatorId:'g',tankId:null,date:'2026-08-31',hours:100,meterStart:1000,meterEnd:1100,fuelIssued:1000,fuelUsed:900,fuelActual:900,note:'Historical generator fact'},{id:'g-sep',generatorId:'g',tankId:null,date:'2026-09-10',hours:2,meterStart:1100,meterEnd:1102,fuelIssued:20,fuelUsed:6,fuelActual:5},{id:'g-oct',generatorId:'g',tankId:null,date:'2026-10-10',hours:3,meterStart:1102,meterEnd:1105,fuelIssued:0,fuelUsed:4,fuelActual:3}];
 return {vehicles:[vehicle],records,generators:[generator],genRecords,tanks:[{id:'t',name:'SYNTHETIC-TANK',org:'A',fuel:'diesel',capacity:2000,balanceInit:10,...copy(extra)}],tankIncomes:[{id:'old-tank',tankId:'t',date:'2026-08-10',amount:1000}],fuelMovements:[{id:'new-tank',date:'2026-09-05',kind:'receipt',toTankId:'t',qty:20},{id:'issued-tank',date:'2026-09-10',kind:'issue',fromTankId:'t',qty:23.537}],toRecords:[{id:'old-to',generatorId:'g',date:'2026-08-10',type:'HISTORICAL_MAINTENANCE',hours:1100,cost:25000}],payments:[{id:'old-payment',date:'2026-08-01',sum:8000}],fuelPurchases:[],fuelCards:[],monthlyFuel:[]};
}
function app(data){
 const books=[],pdfs=[];
 const context=vm.createContext({console,data:copy(data),_genBalCache:{},TvsFuelEngine:fuel,AccountingBoundary:boundary,DomainSources:sources,DecimalCore:require('../assets/core/decimal-core.js'),FuelMovementPolicy:require('../assets/core/fuel-movement-policy.js'),
  document:{addEventListener(){},querySelector(){return null;},querySelectorAll(){return[];}},window:{},fmtDate:value=>value,cmpDateAsc:(a,b)=>String(a).localeCompare(String(b)),dispatcherLocalDate:()=> '2026-10-22',htmlEsc:String,
  alert:message=>{throw Error(message);},XLSX:{utils:{encode_cell:({r,c})=>r+','+c,encode_range:range=>JSON.stringify(range),book_new:()=>({SheetNames:[],Sheets:{}}),book_append_sheet:(book,sheet,name)=>{book.SheetNames.push(name);book.Sheets[name]=sheet;}},writeFile:(book,name)=>books.push({book:copy(book),name})}});
 vm.runInContext("function recsFor(id){return data.records.filter(row=>row.vehicleId===id);}function genRecsFor(id){return data.genRecords.filter(row=>row.generatorId===id);}function computeFuelBalances(id,from,to){return TvsFuelEngine.recordBalances(data,id,{from:from||'',to:to||''});}",context);
 for(const file of ['29-fuel-quality.js','07-summary.js','09-ui-effects.js','10-pdf-reports.js','13-gen-export.js','16-generators.js','17-tanks.js'])vm.runInContext(read(file),context,{filename:file});
 require('./tank-stock-vm.cjs')(context);
 context._savePdf=(html,name)=>pdfs.push({html,name});
 return {context,books,pdfs,xlsx(name,...args){const before=JSON.stringify(context.data);context[name](...args);assert.equal(JSON.stringify(context.data),before);assert.ok(books.length);return books.at(-1).book.Sheets[books.at(-1).book.SheetNames[0]];},pdf(name,...args){const before=JSON.stringify(context.data);context[name](...args);assert.equal(JSON.stringify(context.data),before);assert.ok(pdfs.length);return pdfs.at(-1).html;}};
}
function rows(sheet){const result=[];for(const[key,cell]of Object.entries(sheet)){if(key.startsWith('!'))continue;const[r,c]=key.split(',').map(Number);result[r]??=[];result[r][c]=cell.v;}return result;}
const rowWith=(sheet,column,text)=>{const row=rows(sheet).find(row=>row?.[column]===text);assert.ok(row,'Missing '+text);return row;};
const metric=(sheet,label)=>rowWith(sheet,0,label)[6];
function htmlRows(html){return [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(match=>[...match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(cell=>cell[1].replace(/<[^>]*>/g,'').replace(/&nbsp;|[\u00a0\u202f]/g,' ').trim()));}
const pdfRow=(html,text)=>{const row=htmlRows(html).find(row=>row.some(value=>value===text));assert.ok(row,'Missing '+text);return row;};
const numeric=text=>Number(String(text).replace(/\s/g,'').replace(',','.'));

test('vehicle XLSX fuel summaries exclude August while retaining all mileage, historical routes and 923.537-based carry',()=>{
 const h=app(fixture()),sheet=h.xlsx('exportAllToXlsx'),row=rowWith(sheet,1,'SYNTHETIC-REPORT');assert.equal(row[8],2190);assert.equal(row[9],20);assert.equal(row[10],10);assert.equal(row[11],8);assert.equal(row[12],935.537);assert.equal(row[13],4.21);assert.match(row[16],/2026-08-31 \(до учёта ГСМ\): HISTORICAL_ROUTE/);
 const total=rowWith(sheet,1,'ИТОГО');assert.equal(total[8],2190);assert.equal(total[9],20);assert.equal(total[11],8);const group=rowWith(sheet,0,'Дизельное');assert.equal(group[9],935.537);
 const october=h.xlsx('exportAllToXlsx','2026-10-01','2026-10-31'),oct=rowWith(october,1,'SYNTHETIC-REPORT');assert.equal(oct[8],90);assert.equal(oct[9],0);assert.equal(oct[11],3);assert.equal(oct[12],935.537);
});

test('vehicle XLSX carries a preceding month through an empty current month and never represents pre-start balance as zero',()=>{
 const data=fixture();data.records=data.records.filter(row=>row.date<'2026-10-01');const h=app(data),october=h.xlsx('exportAllToXlsx','2026-10-01','2026-10-31'),oct=rowWith(october,1,'SYNTHETIC-REPORT');assert.equal(oct[8],0);assert.equal(oct[12],938.537);assert.equal(rowWith(october,0,'Дизельное')[9],938.537);
 const august=h.xlsx('exportAllToXlsx','2026-08-01','2026-08-31'),aug=rowWith(august,1,'SYNTHETIC-REPORT');assert.equal(aug[8],2000);assert.equal(aug[9],0);assert.equal(aug[11],0);assert.equal(aug[12],'Учёт не начат');assert.equal(rowWith(august,0,'Дизельное')[9],'Учёт не начат');
});

test('vehicle PDF uses the same current fuel scope and exact opening carry while leaving the mileage column historical',()=>{
 const h=app(fixture()),html=h.pdf('exportAllToPdf'),row=pdfRow(html,'SYNTHETIC-REPORT');assert.equal(numeric(row[8]),2190);assert.equal(numeric(row[9]),20);assert.equal(numeric(row[10]),10);assert.equal(numeric(row[11]),8);assert.equal(numeric(row[12]),935.537);
 const august=h.pdf('exportAllToPdf','2026-08-01','2026-08-31'),old=pdfRow(august,'SYNTHETIC-REPORT');assert.equal(numeric(old[8]),2000);assert.equal(numeric(old[9]),0);assert.equal(old[12],'Учёт не начат');
});

test('generator PDF/XLSX summaries exclude prior fuel without resetting hour history, maintenance or financial cost',()=>{
 const h=app(fixture()),sheet=h.xlsx('exportAllGensToXlsx'),row=rowWith(sheet,1,'SYNTHETIC-DES');assert.equal(row[8],105);assert.equal(row[9],20);assert.equal(row[10],10);assert.equal(row[11],8);assert.equal(row[14],935.537);assert.equal(numeric(row[15]),7777);assert.ok(rows(sheet).some(row=>row?.includes('HISTORICAL_MAINTENANCE')));assert.ok(rows(sheet).some(row=>row?.some(value=>typeof value==='string'&&numeric(value)===25000)));
 const html=h.pdf('exportAllGensToPdf'),pdf=pdfRow(html,'SYNTHETIC-DES');assert.equal(numeric(pdf[8]),105);assert.equal(numeric(pdf[9]),20);assert.equal(numeric(pdf[10]),8);assert.equal(numeric(pdf[11]),935.537);assert.equal(numeric(pdf[12]),7777);assert.match(html,/HISTORICAL_MAINTENANCE/);assert.ok(htmlRows(html).some(row=>row.some(value=>numeric(value)===25000)));
});

test('single generator export prints historical facts with a label but excludes them from current fuel totals and keeps meter facts',()=>{
 const h=app(fixture()),sheet=h.xlsx('exportOneGenToXlsx','g');assert.equal(metric(sheet,'Наработка за период, мтч'),105);assert.equal(metric(sheet,'Количество записей'),3);assert.equal(metric(sheet,'Выдано топлива за период, л'),20);assert.equal(metric(sheet,'Расход по норме за период, л'),10);assert.equal(metric(sheet,'Фактический расход за период, л'),8);assert.equal(metric(sheet,'Текущий остаток в баке, л'),935.537);
 const old=rows(sheet).find(row=>typeof row?.[0]==='string'&&row[0].startsWith('2026-08-31'));assert.ok(old);assert.equal(old[1],100);assert.equal(old[2],1000);assert.equal(old[3],1100);assert.equal(old[4],1000);assert.equal(old[6],900);assert.equal(old[7],'—');assert.match(old[10],/До учёта ГСМ/);
 const total=rowWith(sheet,0,'ИТОГО');assert.equal(total[1],105);assert.equal(total[4],20);assert.equal(total[6],8);assert.equal(total[7],935.537);
 const october=h.xlsx('exportOneGenToXlsx','g','2026-10-01','2026-10-31');assert.equal(metric(october,'Наработка за период, мтч'),3);assert.equal(metric(october,'Текущий остаток в баке, л'),935.537);
});

test('generator report periods before accounting expose no invented zero stock while retaining recorded hours and maintenance',()=>{
 const h=app(fixture()),sheet=h.xlsx('exportOneGenToXlsx','g','2026-08-01','2026-08-31');assert.equal(metric(sheet,'Наработка за период, мтч'),100);assert.equal(metric(sheet,'Выдано топлива за период, л'),0);assert.equal(metric(sheet,'Текущий остаток в баке, л'),'Учёт не начат');assert.ok(rows(sheet).some(row=>row?.includes('HISTORICAL_MAINTENANCE')));
 const all=h.xlsx('exportAllGensToXlsx','2026-08-01','2026-08-31'),row=rowWith(all,1,'SYNTHETIC-DES');assert.equal(row[8],100);assert.equal(row[9],0);assert.equal(row[14],'Учёт не начат');assert.equal(rowWith(all,0,'Дизельное')[13],'Учёт не начат');
 const pdf=pdfRow(h.pdf('exportAllGensToPdf','2026-08-01','2026-08-31'),'SYNTHETIC-DES');assert.equal(numeric(pdf[8]),100);assert.equal(numeric(pdf[9]),0);assert.equal(pdf[11],'Учёт не начат');
});

test('tank export includes modern signed receipt/issue legs exactly once, ignores old history and carries stock into an empty month',()=>{
 const h=app(fixture()),sheet=h.xlsx('exportAllGensToXlsx'),row=rowWith(sheet,0,'SYNTHETIC-TANK');assert.equal(row[12],20);assert.equal(row[14],23.537);assert.equal(row[16],920);const oct=rowWith(h.xlsx('exportAllGensToXlsx','2026-10-01','2026-10-31'),0,'SYNTHETIC-TANK');assert.equal(oct[12],0);assert.equal(oct[14],0);assert.equal(oct[16],920);
 const old=rowWith(h.xlsx('exportAllGensToXlsx','2026-08-01','2026-08-31'),0,'SYNTHETIC-TANK');assert.equal(old[12],'Учёт не начат');assert.equal(old[14],'Учёт не начат');assert.equal(old[16],'Учёт не начат');
});

test('reports without explicit metadata retain all historical litres, old two-decimal presentation and hour/distance totals',()=>{
 const h=app(fixture(false));delete h.context.AccountingBoundary;
 const vehicle=rowWith(h.xlsx('exportAllToXlsx'),1,'SYNTHETIC-REPORT');assert.equal(vehicle[8],2190);assert.equal(vehicle[9],1020);assert.equal(vehicle[10],910);assert.equal(vehicle[11],908);assert.equal(vehicle[12],212);assert.doesNotMatch(vehicle[16],/до учёта/);
 const gen=rowWith(h.xlsx('exportAllGensToXlsx'),1,'SYNTHETIC-DES');assert.equal(gen[8],105);assert.equal(gen[9],1020);assert.equal(gen[11],908);assert.equal(gen[14],212);
 const one=h.xlsx('exportOneGenToXlsx','g');assert.equal(metric(one,'Выдано топлива за период, л'),1020);assert.equal(metric(one,'Текущий остаток в баке, л'),212);assert.equal(rows(one).some(row=>row?.some(value=>typeof value==='string'&&value.includes('До учёта ГСМ'))),false);
 const pdf=pdfRow(h.pdf('exportAllToPdf'),'SYNTHETIC-REPORT');assert.equal(numeric(pdf[9]),1020);assert.equal(numeric(pdf[12]),212);
});

test('explicit exports fail before output when metadata or its shared dependency is invalid',()=>{
 for(const name of ['exportAllToXlsx','exportAllGensToXlsx','exportOneGenToXlsx','exportAllToPdf','exportAllGensToPdf']){
  const h=app(fixture());delete h.context.AccountingBoundary;assert.throws(()=>h.context[name](...(name==='exportOneGenToXlsx'?['g']:[])),/Не загружен модуль начала топливного учёта/);assert.equal(h.books.length,0);assert.equal(h.pdfs.length,0);
 }
 const invalid=fixture();invalid.vehicles[0].fuelAccounting.opening='923.537';const h=app(invalid);assert.throws(()=>h.context.exportAllToXlsx(),{code:'INVALID_ACCOUNTING_BOUNDARY'});assert.equal(h.books.length,0);
});
