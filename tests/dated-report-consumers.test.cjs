'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const fuel=require('../assets/core/fuel-engine.js'),DecimalCore=require('../assets/core/decimal-core.js');
const copy=value=>JSON.parse(JSON.stringify(value));
const accounting=(from='2026-09-01')=>({version:1,from,opening:100,basis:'Synthetic measured opening'});
const dated=parameters=>({version:1,periods:[{id:'norm-oct',from:'2026-10-01',basis:'Synthetic confirmed norm',parameters}]});
function fixture(){return {vehicles:[{id:'v',plate:'SYNTHETIC-DATED-VEHICLE',make:'Synthetic vehicle',fuel:'diesel',norm:10,fuelBalance:900,fuelAccounting:accounting(),fuelNorms:dated({norm:10,normCity:null,normHighway:null,normIdle:null})}],
 records:[{id:'vr',vehicleId:'v',date:'2026-09-10',km:100,fuelIssued:10}],
 generators:[{id:'g',name:'SYNTHETIC-DATED-DES',fuel:'diesel',fuelBalance:900,norm:2,fuelAccounting:accounting(),fuelNorms:dated({power:100,norm:2,norm100:2,norm50:1,normIdle:0.5})}],
 genRecords:[{id:'gr',generatorId:'g',date:'2026-09-10',hours:2,load:75,fuelIssued:10,tankId:null}],
 tanks:[],tankIncomes:[],fuelMovements:[],toRecords:[],payments:[],fuelPurchases:[],fuelCards:[],monthlyFuel:[]};}
function harness(db=fixture(),today='2026-10-22'){
 const books=[],pdfs=[],elements=new Map();
 const element=()=>({innerHTML:'',value:'',style:{},dataset:{},children:[],querySelector:()=>null,querySelectorAll:()=>[],appendChild(node){this.children.push(node);},addEventListener(){},remove(){}});
 const api=vm.createContext({console,data:copy(db),DecimalCore,TvsFuelEngine:fuel,EffectivePeriods:require('../assets/core/effective-periods.js'),
  AccountingBoundary:require('../assets/core/accounting-boundary.js'),DomainSources:require('../assets/core/financial-recognition.js'),FuelMovementPolicy:require('../assets/core/fuel-movement-policy.js'),
  _genBalCache:{},window:{},genShowArchive:false,filterStatus:'',filterFuel:'',filterOrg:'',__today:today,
  document:{getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element,addEventListener(){},querySelector:()=>null,querySelectorAll:()=>[]},
  dispatcherLocalDate:()=>api.__today,fmtDate:value=>value,cmpDateAsc:(a,b)=>String(a).localeCompare(String(b)),cmpDateDesc:(a,b)=>String(b).localeCompare(String(a)),htmlEsc:value=>String(value??''),htmlJs:JSON.stringify,
  vehicleFuelGrade:fuel.vehicleFuelGrade,fuelTypeFromGrade:fuel.fuelTypeFromGrade,
  computeObjectStatusBreakdown:()=>[],alert:message=>{throw Error(message);},showToast(){},
  XLSX:{utils:{encode_cell:({r,c})=>r+','+c,encode_range:JSON.stringify,book_new:()=>({SheetNames:[],Sheets:{}}),book_append_sheet:(book,sheet,name)=>{book.SheetNames.push(name);book.Sheets[name]=sheet;}},writeFile:(book)=>books.push(copy(book))}
 });
 vm.runInContext('function recsFor(id){return data.records.filter(row=>row.vehicleId===id);} function genRecsFor(id){return data.genRecords.filter(row=>row.generatorId===id);}',api);
 for(const file of ['29-fuel-quality.js','55-precision-input.js','07-summary.js','09-ui-effects.js','10-pdf-reports.js','13-gen-export.js','16-generators.js','17-tanks.js','15-cards.js','18-gen-crud.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/js',file),'utf8'),api,{filename:file});
 require('./tank-stock-vm.cjs')(api);
 api._savePdf=html=>pdfs.push(html);
 const unchanged=action=>{const before=JSON.stringify(api.data),result=action();assert.equal(JSON.stringify(api.data),before,'Read-only consumer changed source facts');return result;};
 return {api,elements,xlsx(name,...args){return unchanged(()=>{api[name](...args);return books.at(-1).Sheets[books.at(-1).SheetNames[0]];});},pdf(name,...args){return unchanged(()=>{api[name](...args);return pdfs.at(-1);});},sidebar(generators=false){return unchanged(()=>{api[generators?'renderGenSidebarSummary':'renderSidebarSummary']();return generators?elements.get('generatorList').children.at(-1).innerHTML:elements.get('sidebarSummary').innerHTML;});},cards(){return unchanged(()=>{api.renderGeneratorCards();return elements.get('genGridArea').innerHTML;});}};
}
function rows(sheet){const result=[];for(const[key,cell]of Object.entries(sheet)){if(key.startsWith('!'))continue;const[r,c]=key.split(',').map(Number);result[r]??=[];result[r][c]=cell.v;}return result;}
function row(sheet,column,value){const result=rows(sheet).find(r=>r?.[column]===value);assert.ok(result,'Missing worksheet row '+value);return result;}
const metric=(sheet,label)=>row(sheet,0,label)[6];
function pdfRow(html,value){const result=[...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(m=>[...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c=>c[1].replace(/<[^>]*>/g,'').replace(/&nbsp;|[\u00a0\u202f]/g,' ').trim())).find(r=>r.includes(value));assert.ok(result,'Missing PDF row '+value);return result;}
const number=value=>Number(String(value).replace(/\s/g,'').replace(',','.'));

test('dated gap is unknown in actual vehicle/sidebar and generator/sidebar/cards instead of opening or zero',()=>{
 const h=harness();assert.match(h.sidebar(),/Израсходовано[\s\S]*Неизвестно: нет нормы/);assert.match(h.sidebar(),/Остаток[\s\S]*Неизвестно: нет нормы/);
 assert.match(h.sidebar(true),/Расход по норме[\s\S]*Неизвестно: нет нормы/);assert.match(h.sidebar(true),/Остаток[\s\S]*Неизвестно: нет нормы/);assert.match(h.cards(),/Неизвестно: нет нормы/);
 assert.equal(h.api.computeGenFuelBalances('g').gr,null);assert.throws(()=>h.api.computeTankBalanceAt('missing','2026-09-10',true),{code:'STOCK_TARGET'});
});
test('vehicle XLSX and PDF propagate dated unknown into rows and grouped/overall totals',()=>{
 const h=harness(),sheet=h.xlsx('exportAllToXlsx'),v=row(sheet,1,'SYNTHETIC-DATED-VEHICLE');assert.equal(v[9],10);assert.equal(v[10],'—');assert.equal(v[11],'—');assert.equal(v[12],'Неизвестно: нет нормы');assert.equal(row(sheet,1,'ИТОГО')[10],'—');assert.equal(row(sheet,0,'Дизельное')[9],'Неизвестно: нет нормы');
 const p=pdfRow(h.pdf('exportAllToPdf'),'SYNTHETIC-DATED-VEHICLE');assert.equal(p[10],'Нет данных');assert.equal(p[11],'Нет данных');assert.equal(p[12],'Неизвестно: нет нормы');
});
test('DES XLSX, single journal, PDF and aggregate totals retain dated unknown consumption/balance',()=>{
 const h=harness(),all=h.xlsx('exportAllGensToXlsx'),g=row(all,1,'SYNTHETIC-DATED-DES');assert.equal(g[10],'Нет данных');assert.equal(g[11],'Нет данных');assert.equal(g[14],'Неизвестно: нет нормы');assert.equal(rows(all).find(r=>r?.[0]==='ИТОГО'&&r[8]===2)?.[11],'Нет данных');assert.equal(row(all,0,'Дизельное')[7],'Нет данных');
 const one=h.xlsx('exportOneGenToXlsx','g');assert.equal(metric(one,'Расход по норме за период, л'),'Нет данных');assert.equal(metric(one,'Фактический расход за период, л'),'Нет данных');assert.equal(metric(one,'Текущий остаток в баке, л'),'Неизвестно: нет нормы');
 const journal=rows(one).find(r=>typeof r?.[0]==='string'&&r[0].startsWith('2026-09-10'));assert.equal(journal[5],'Нет данных');assert.equal(journal[6],'Нет данных');assert.equal(journal[7],'Неизвестно: нет нормы');assert.equal(row(one,0,'ИТОГО')[6],'Нет данных');
 const p=pdfRow(h.pdf('exportAllGensToPdf'),'SYNTHETIC-DATED-DES');assert.equal(p[10],'Нет данных');assert.equal(p[11],'Неизвестно: нет нормы');
});
test('explicit manual actual zero and manual norm zero remain authoritative before first dated norm',()=>{
 const db=fixture();for(const list of [db.records,db.genRecords])Object.assign(list[0],{fuelUsed:0,fuelActual:0});const h=harness(db);
 const v=row(h.xlsx('exportAllToXlsx'),1,'SYNTHETIC-DATED-VEHICLE');assert.equal(v[10],0);assert.equal(v[11],0);assert.equal(v[12],110);assert.equal(v[13],0);
 const g=row(h.xlsx('exportAllGensToXlsx'),1,'SYNTHETIC-DATED-DES');assert.equal(g[10],0);assert.equal(g[11],0);assert.equal(g[14],110);assert.doesNotMatch(h.sidebar(true),/Неизвестно|Учёт ещё не начат/);assert.match(h.sidebar(true),/Расход по факту[\s\S]*>0 л</);
 const journal=rows(h.xlsx('exportOneGenToXlsx','g')).find(r=>typeof r?.[0]==='string'&&r[0].startsWith('2026-09-10'));assert.equal(journal[6],0);assert.equal(journal[9],0);assert.equal(number(pdfRow(h.pdf('exportAllGensToPdf'),'SYNTHETIC-DATED-DES')[10]),0);
});
test('a later known norm does not heal an earlier cumulative unknown stock',()=>{
 const db=fixture();db.genRecords.push({id:'known',generatorId:'g',date:'2026-10-05',hours:1,load:100,fuelIssued:0,tankId:null});const h=harness(db),balances=h.api.computeGenFuelBalances('g');assert.equal(h.api.genActualSpent(h.api.data.generators[0],h.api.data.genRecords[1]),2);assert.equal(balances.known,null);assert.equal(metric(h.xlsx('exportOneGenToXlsx','g'),'Текущий остаток в баке, л'),'Неизвестно: нет нормы');
});
test('known physical tank stock is independent of recipient consumption gap and a numeric zero tank ID works',()=>{
 const db=fixture();db.generators[0].tankId=0;db.tanks=[{id:0,name:'SYNTHETIC-TANK',fuel:'diesel',balanceInit:900,fuelAccounting:accounting()}];db.genRecords[0].tankId=0;const h=harness(db);
 assert.equal(h.api.computeTankBalance(0).balance,90);assert.equal(h.api.computeTankBalanceAt(0,'2026-09-10',true),90);
 const sidebar=h.sidebar(true);assert.match(sidebar,/Расход по факту[\s\S]*Неизвестно: нет нормы/);assert.match(sidebar,/Остаток[\s\S]*>90 л</);assert.match(h.cards(),/>90 л</);assert.equal(row(h.xlsx('exportAllGensToXlsx'),0,'SYNTHETIC-TANK')[16],90);
});
test('before-accounting labels remain distinct from missing norms in exports, sidebar and cards',()=>{
 const db=fixture();db.generators[0].fuelAccounting=accounting('2026-11-01');db.vehicles[0].fuelAccounting=accounting('2026-11-01');const h=harness(db);
 assert.match(h.sidebar(true),/Учёт ещё не начат/);assert.doesNotMatch(h.sidebar(true),/Неизвестно: нет нормы/);assert.match(h.cards(),/Учёт ещё не начат/);
 assert.equal(row(h.xlsx('exportAllToXlsx'),1,'SYNTHETIC-DATED-VEHICLE')[12],'Учёт не начат');assert.equal(metric(h.xlsx('exportOneGenToXlsx','g'),'Текущий остаток в баке, л'),'Учёт не начат');assert.equal(pdfRow(h.pdf('exportAllGensToPdf'),'SYNTHETIC-DATED-DES')[11],'Учёт не начат');
});
test('sidebar exact totals retain millilitres and do not expose a binary decimal tail',()=>{
 const db=fixture();db.generators[0].fuelAccounting.opening=0.001;db.genRecords=[{id:'a',generatorId:'g',date:'2026-09-10',hours:0.001,fuelIssued:0.1,fuelActual:0.1,fuelUsed:0.1},{id:'b',generatorId:'g',date:'2026-09-11',hours:0.002,fuelIssued:0.2,fuelActual:0.2,fuelUsed:0.2}];const h=harness(db),html=h.sidebar(true);
 assert.match(html,/Всего моточасов[\s\S]*>0,003 мтч</);assert.match(html,/Выдано[\s\S]*>0,3 л</);assert.match(html,/Остаток[\s\S]*>0,001 л</);assert.doesNotMatch(html,/000000000000/);
});
test('a known dated asset does not relabel another asset before its accounting as a norm gap',()=>{
 const db=fixture();Object.assign(db.records[0],{fuelUsed:0,fuelActual:0});Object.assign(db.genRecords[0],{fuelUsed:0,fuelActual:0});
 db.vehicles.push({id:'future-v',plate:'FUTURE-ACCOUNTING',fuel:'diesel',fuelAccounting:accounting('2026-11-01')});db.generators.push({id:'future-g',name:'FUTURE-ACCOUNTING-DES',fuel:'diesel',fuelAccounting:accounting('2026-11-01')});
 const h=harness(db);assert.equal(row(h.xlsx('exportAllToXlsx'),0,'Дизельное')[9],'Учёт не начат');assert.equal(row(h.xlsx('exportAllGensToXlsx'),0,'Дизельное')[13],'Учёт не начат');
 const v=pdfRow(h.pdf('exportAllToPdf'),'Дизельное'),g=pdfRow(h.pdf('exportAllGensToPdf'),'Дизельное');assert.equal(v.at(-1),'Учёт не начат');assert.equal(g.at(-1),'Учёт не начат');
});
test('a dated generator card names its not-started physical source tank without claiming a norm gap',()=>{
 const db=fixture();db.generators[0].tankId=0;db.tanks=[{id:0,name:'Future tank',fuel:'diesel',fuelAccounting:accounting('2026-11-01')}];const h=harness(db);assert.match(h.cards(),/Учёт ещё не начат/);assert.doesNotMatch(h.cards(),/Неизвестно: нет нормы/);
});
test('dated reports label scalar power/norm as original rather than claiming they apply to every report date',()=>{
 const db=fixture();db.generators[0].power=77;db.generators[0].norm=99;const h=harness(db);assert.match(h.cards(),/77 кВт \(исходная\)/);assert.equal(row(h.xlsx('exportAllGensToXlsx'),1,'SYNTHETIC-DATED-DES')[5],'77 (исходная)');assert.equal(pdfRow(h.pdf('exportAllGensToPdf'),'SYNTHETIC-DATED-DES')[5],'77 (исходная)');
 const one=h.xlsx('exportOneGenToXlsx','g');assert.equal(row(one,0,'Исходная мощность (параметры по датам)')[4],'77 кВт');assert.equal(row(one,0,'Исходная норма расхода (параметры по датам)')[4],'99 л/мтч');
});
