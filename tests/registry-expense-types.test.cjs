'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const core=require('../assets/core/registry-import.js'),stats=require('../assets/core/registry-statistics.js'),escape=require('../web/pages.cjs').escape;
const source={id:'a'.repeat(64)+'.pdf',sha256:'a'.repeat(64),size:120,name:'synthetic-expenses.pdf'};
function fixture(){return {vehicles:[{id:0,plate:'NUMERIC-0'},{id:'0',plate:'TEXT-0'}],generators:[{id:'gen',name:'Synthetic generator'}],drivers:[{id:0,name:'Synthetic driver'}],savedReestrs:[],payments:[],repairs:[],vehicleTo:[]};}
function make(database,kind,type,extra={}){return core.buildRegister({id:'reg',number:'01',date:'2026-11-08',reason:'Synthetic verified allocation',source,...extra,invoices:[{invoiceNo:'SYN-01',supplier:'Synthetic supplier',description:'Synthetic expense',sum:100.01,allocations:[{kind,expenseType:type,assetId:kind==='vehicle'?0:kind==='generator'?'gen':kind==='driver'?0:null,sum:100.01}]}]},database);}
test('every shared expense category roundtrips for every receiver without creating payments or maintenance records',()=>{
 const database=fixture(),before=JSON.stringify(database);
 for(const kind of ['vehicle','generator','driver','other','unassigned'])for(const type of Object.keys(core.expenseLabels)){
  const entry=make(database,kind,type);assert.equal(entry.rows[0].registryExpenseType,type);assert.equal(core.invoices(entry)[0].allocations[0].expenseType,type);core.validateRegister(entry,database);assert.equal(entry.totalSum,100.01);
  if(kind==='vehicle'){assert.equal(entry.rows[0].vehicleId,0);assert.equal(Object.hasOwn(entry.rows[0],'serviceRef'),false);}
 }
 assert.equal(JSON.stringify(database),before);
 assert.equal(core.expenseLabels.perDiem,'Суточные');assert.equal(core.expenseLabels.vehiclePurchase,'Покупка авто');
});
test('legacy missing types remain valid while invalid stored and submitted types are rejected',()=>{
 const database=fixture();for(const kind of ['vehicle','generator','driver','other','unassigned']){const entry=make(database,kind,'other');delete entry.rows[0].registryExpenseType;assert.doesNotThrow(()=>core.validateRegister(entry,database));assert.equal(core.invoices(entry)[0].allocations[0].expenseType,'other');entry.rows[0].registryExpenseType='unknown-category';assert.throws(()=>core.validateRegister(entry,database),error=>error.code==='REGISTRY_EXPENSE');}
 assert.throws(()=>make(database,'vehicle','unknown-category'),error=>error.code==='REGISTRY_EXPENSE');
 const linked=core.linkDriver({sum:10,allocations:[{kind:'vehicle',assetId:0,sum:10,expenseType:'fine'}]},0);assert.equal(linked.allocations[0].expenseType,'fine');assert.equal(core.linkDriver({sum:10,allocations:[{kind:'other',sum:10,expenseType:'old-invalid'}]},0).allocations[0].expenseType,'other');
});
test('BDDS fallback uses exactly one explicit source code, catalog labels and preserves an existing user article',()=>{
 const articles=[{code:'21.04.16',label:'21.04.16, ТО и ремонт ТС'}],original='ПО ДОГОВОРУ\nСТАТЬЯ 21.04.16, техническое обслуживание\nОперационные расходы';
 assert.equal(core.articleCategory({financeControl:original},articles),articles[0].label);
 assert.equal(core.articleCategory({description:'код статьи: 21.04.16'},articles),articles[0].label);
 assert.equal(core.articleCategory({category:'My selected article',financeControl:original},articles),'My selected article');
 assert.equal(core.articleCategory({financeControl:original+'\nСТАТЬЯ 21.05.17'}),'');assert.equal(core.articleCategory({description:'Договор 21.04.16'}),'');
 const parsed=core.parseTable({preamble:['Реестр 01 от 08.11.2026'],grid:[['Сумма','Контрагент','Финконтроль'],['100,01','Synthetic',original],['100,01','Итого','']]},{articles});assert.equal(parsed.rows[0].category,articles[0].label);assert.equal(parsed.rows[0].financeControl,original);
 const database=fixture(),entry=core.buildRegister({id:'article',number:'01',date:'2026-11-08',reason:'Synthetic article evidence',source,invoices:[{...parsed.rows[0],allocations:[{kind:'unassigned',sum:100.01,expenseType:'maintenance'}]}]},database);assert.equal(entry.rows[0].category,articles[0].label);assert.equal(entry.rows[0]['statья'],articles[0].label);assert.equal(entry.rows[0].financeControl,original);
});
test('workspace survives editing and statistics include each allocation exactly once across both sections',()=>{
 const database=fixture(),normal=make(database,'vehicle','fine'),logistics=make(database,'vehicle','transport',{id:'log',number:'LOG-01',workspace:'logistics'});database.savedReestrs=[normal,logistics];assert.equal(core.workspaceOf(normal),'registries');assert.equal(core.workspaceOf(logistics),'logistics');
 const reopened=core.buildRegister({...logistics,invoices:core.invoices(logistics)},database);assert.equal(reopened.workspace,'logistics');assert.equal(reopened.rows[0].registryExpenseType,'transport');
 assert.throws(()=>make(database,'vehicle','fine',{workspace:'missing'}),error=>error.code==='REGISTRY_WORKSPACE');
 const report=stats.project(database);assert.equal(report.totals.sum,200.02);assert.equal(report.totals.invoices,2);assert.equal(report.rows.find(row=>row.registerId==='log').workspace,'logistics');assert.equal(stats.project(database,{expense:'fine'}).totals.sum,100.01);assert.equal(report.expenses.find(group=>group.id==='transport').sum,100.01);
});
function registryView(database){const context=vm.createContext({window:{tvsWeb:{},addEventListener(){}},RegistryImport:core,htmlEsc:escape,data:database,syncSessionStamp:()=> 'synthetic',URLSearchParams,location:{search:''},document:{addEventListener(){},getElementById(){return null;}}});const src=fs.readFileSync(path.join(__dirname,'../web/public/registries.js'),'utf8');vm.runInContext(src.replace('web.registries={render};','web.registries={render,visibleRows,allocationHtml,suggest};'),context);return context.window.tvsWeb.registries;}
test('registry and logistics views isolate moved entries and show category choices without requiring fake service links',()=>{
 const database=fixture();database.savedReestrs=[make(database,'vehicle','fine'),make(database,'vehicle','transport',{id:'log',workspace:'logistics'})];const view=registryView(database);
 assert.equal(view.visibleRows().length,1);assert.equal(view.visibleRows()[0].registryExpenseType,'fine');view.render('logistics');assert.equal(view.visibleRows().length,1);assert.equal(view.visibleRows()[0].registryExpenseType,'transport');view.render('registries');assert.equal(view.visibleRows()[0].registryExpenseType,'fine');
 for(const kind of ['vehicle','generator','driver','unassigned','other']){const html=view.allocationHtml({kind,assetId:kind==='generator'?'gen':0,sum:10,expenseType:'toll'},0);assert.match(html,/data-allocation-expense/);assert.match(html,/value="toll" selected/);assert.match(html,/Платные дороги/);assert.doesNotMatch(html,/data-allocation-service/);}
 assert.match(view.allocationHtml({kind:'vehicle',assetId:0,sum:10,expenseType:'maintenance'},0),/Связь с ремонтом \/ ТО · необязательно/);
});
test('vehicle and driver invoice links preserve workspace and share type labels',()=>{
 const database=fixture();database.savedReestrs=[make(database,'vehicle','equipmentPurchase',{workspace:'logistics'})];let panel;const workspace={querySelector:()=>panel,append:node=>panel=node},main={querySelector:()=>workspace};const context=vm.createContext({window:{tvsWeb:{}},RegistryImport:core,htmlEsc:escape,data:database,_sync:{access:{readable:['savedReestrs']}},document:{getElementById:()=>main,createElement:()=>({dataset:{},set innerHTML(value){this.html=value;},get innerHTML(){return this.html;}})}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/public/vehicle-invoices.js'),'utf8'),context);const html=context.window.tvsWeb.vehicleInvoices.vehicleHtml(0);assert.match(html,/Счета и расходы по автомобилю/);assert.match(html,/Покупка допоборудования/);assert.match(html,/\/logistics\?register=/);assert.deepEqual(database.repairs,[]);
 database.savedReestrs=[make(database,'driver','perDiem',{workspace:'logistics'})];vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/public/driver-invoices.js'),'utf8'),context);context.window.tvsWeb.driverInvoices.mount(0);assert.match(panel.innerHTML,/Суточные/);assert.match(panel.innerHTML,/\/logistics\?register=/);
});

test('explicit standalone Russian TO and per-diem purposes receive their proper category',()=>{const view=registryView(fixture());assert.equal(view.suggest({description:'ТО ДЭС',sum:1}).expenseType,'maintenance');assert.equal(view.suggest({description:'Оплата суточных сотрудникам',sum:1}).expenseType,'perDiem');});

test('a bare explicit BDDS source code and its catalogue label share filtering and one budget group',()=>{const database=fixture();const entry=make(database,'unassigned','fine');entry.rows[0].category='21.04.16';entry.rows[0]['statья']='21.04.16';database.savedReestrs=[entry];database.budget=[{year:2026,month:11,category:'21.04.16, Техническое обслуживание и ремонт ТС',sum:100.01}];const before=JSON.stringify(database);assert.equal(stats.project(database,{category:'21.04.16, Техническое обслуживание и ремонт ТС'}).totals.sum,100.01);const report=stats.expenseBudget(database);assert.equal(report.comparison.length,1);assert.equal(report.comparison[0].actual,100.01);assert.equal(report.comparison[0].plan,100.01);assert.equal(report.comparison[0].difference,0);assert.equal(JSON.stringify(database),before);});
