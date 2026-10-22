'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const fuel=require('../assets/core/fuel-engine.js'),accounting=require('../assets/core/accounting-boundary.js'),sources=require('../assets/core/financial-recognition.js'),procurement=require('../assets/js/47-procurement-engine.js');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8'),copy=value=>JSON.parse(JSON.stringify(value));
const anchor=(from,opening)=>({version:1,from,opening,basis:'Synthetic confirmed opening'});
function fixture(){return {vehicles:[{id:'v',plate:'Synthetic vehicle',fuel:'diesel',fuelGrade:'ДТ',fuelBalance:50,fuelAccounting:anchor('2026-09-01',923.537)}],records:[{id:'vAug',vehicleId:'v',date:'2026-08-31',km:777,fuelActual:500},{id:'vSep',vehicleId:'v',date:'2026-09-01',km:20,fuelIssued:10,fuelActual:2}],
  generators:[{id:9,name:'Synthetic generator',location:'Synthetic site',tankId:'A',fuel:'diesel',fuelBalance:500,hoursInit:100,fuelAccounting:anchor('2026-09-01',20)}],
  tanks:[{id:'A',name:'Synthetic tank A',fuel:'diesel',capacity:2000,balanceInit:99,fuelAccounting:anchor('2026-09-01',923.537)},
    {id:'B',name:'Synthetic tank B',fuel:'diesel',capacity:500,balanceInit:77,fuelAccounting:anchor('2026-10-01',200)}],
  genRecords:[{id:'gAug',generatorId:9,date:'2026-08-31',hours:777,fuelIssued:500,fuelActual:300},
    {id:'gSep',generatorId:9,date:'2026-09-01',hours:2,fuelIssued:30,fuelActual:10,tankId:'A'},
    {id:'gIssue',generatorId:9,date:'2026-09-01',hours:0,fuelIssued:100,fuelActual:0,tankId:null,fuelMovementId:'issue'},
    {id:'gOct',generatorId:9,date:'2026-10-01',hours:4,fuelIssued:0,fuelActual:20,tankId:null}],
  tankIncomes:[{id:'old',tankId:'A',date:'2026-08-31',amount:10000},{id:'current',tankId:'A',date:'2026-09-10',amount:100}],
  fuelMovements:[{id:'issue',date:'2026-09-01',kind:'issue',fromTankId:'A',qty:100,assetRef:'g:9',recordId:'gIssue',reason:'Synthetic movement'},
    {id:'transfer',date:'2026-09-20',kind:'transfer',fromTankId:'A',toTankId:'B',qty:20,reason:'Synthetic transfer'},
    {id:'oct-receipt',date:'2026-10-01',kind:'receipt',toTankId:'B',qty:50,reason:'Synthetic receipt'}],
  fuelPurchases:[],fuelCards:[],monthlyFuel:[],parts:[],partMovements:[],procurementOrders:[],procurementRules:[],dispatchJobs:[]};}
function harness(database=fixture(),date='2026-09-30'){
  const elements=new Map(),calls={alerts:[],books:[]};
  const element=()=>({innerHTML:'',style:{},dataset:{},children:[],querySelector:()=>null,appendChild(node){this.children.push(node);},addEventListener(){},remove(){}});
  const context=vm.createContext({console,data:copy(database),TvsFuelEngine:fuel,AccountingBoundary:accounting,DomainSources:sources,DecimalCore:require('../assets/core/decimal-core.js'),FuelMovementPolicy:require('../assets/core/fuel-movement-policy.js'),
    _genBalCache:{},window:{},__today:date,summaryOpen:true,filterStatus:'',filterFuel:'',filterOrg:'',genSearchQuery:'',
    cmpDateAsc:(a,b)=>String(a).localeCompare(String(b)),cmpDateDesc:(a,b)=>String(b).localeCompare(String(a)),fmtDate:value=>value,
    dispatcherLocalDate:()=>context.__today,htmlEsc:value=>String(value??''),htmlJs:value=>JSON.stringify(value),
    vehicleFuelGrade:vehicle=>fuel.vehicleFuelGrade(vehicle),fuelTypeFromGrade:grade=>fuel.fuelTypeFromGrade(grade),
    computeObjectStatusBreakdown:()=>[],
    recordFuelGrade:record=>record.fuelGrade||'ДТ',showToast:()=>{},
    document:{getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element,querySelector:()=>null},
    alert:message=>calls.alerts.push(message),
    XLSX:{utils:{encode_cell:({r,c})=>r+','+c,encode_range:range=>JSON.stringify(range),book_new:()=>({}),book_append_sheet:(book,sheet)=>{book.sheet=sheet;}},writeFile:book=>calls.books.push(book)},
  });
  vm.runInContext('function recsFor(id){return data.records.filter(row=>row.vehicleId===id);}function genRecsFor(id){return data.genRecords.filter(row=>row.generatorId===id);}',context);
  for(const file of ['assets/js/55-precision-input.js','assets/js/29-fuel-quality.js','assets/js/07-summary.js','assets/js/16-generators.js','assets/js/17-tanks.js','assets/js/15-cards.js','assets/js/18-gen-crud.js'])vm.runInContext(read(file),context,{filename:file});
  return {context,calls,elements,export(from='2026-09-01',to='2026-09-30'){return context.exportGenWriteOffAct(from,to,{actDate:to||'2026-09-30',loc:'__ALL__'});}};
}
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,actual+' != '+expected);

test('actual tank and generator date consumers use the explicit anchor, not August transactions or the legacy opening',()=>{
  const app=harness(),before=JSON.stringify(app.context.data),api=app.context;
  assert.equal(api.computeTankBalanceAt('A','2026-08-31',true),null);assert.equal(api.computeGenBalanceAt(9,'2026-08-31',true),null);
  assert.equal(api.computeTankBalanceAt('A','2026-09-01',false),923.537);assert.equal(api.computeGenBalanceAt(9,'2026-09-01',false),20);
  near(api.computeTankBalanceAt('A','2026-09-01',true),793.537);near(api.computeGenBalanceAt(9,'2026-09-01',true),140);
  near(api.computeTankBalanceAt('A','2026-09-30',true),873.537);near(api.computeGenBalanceAt(9,'2026-09-30',true),140);
  near(api.computeTankBalanceAt('B','2026-10-01',false),200);near(api.computeTankBalanceAt('B','2026-10-01',true),250);near(api.computeGenBalanceAt(9,'2026-10-31',true),120);
  assert.equal(JSON.stringify(api.data),before);assert.equal(api.genRecsFor(9).reduce((sum,row)=>sum+row.hours,0),783);assert.equal(api.recsFor('v').reduce((sum,row)=>sum+row.km,0),797);
});

test('actual current tank summary agrees with the dated balance and does not debit the linked DES receipt twice',()=>{
  const app=harness(),summary=app.context.computeTankBalance('A');near(summary.balance,873.537);assert.equal(summary.init,923.537);assert.equal(summary.issued,30);assert.equal(summary.income,100);assert.equal(summary.movements,-120);
  assert.equal(app.context.computeTankBalance('B').balance,null);app.context.__today='2026-10-01';assert.equal(app.context.computeTankBalance('B').balance,250);
  const bal=app.context.computeGenFuelBalances(9);assert.equal(bal.gAug,undefined);assert.equal(bal.gSep,40);assert.equal(bal.gIssue,140);assert.equal(bal.gOct,120);
});

test('per-leg tank scopes keep a September outgoing transfer while excluding the receiving tank before its October opening',()=>{
  const db=fixture(),rows=sources.projectTankFlows(db,['A','B'],{from:'2026-09-01',to:'2026-09-30',accounting:true});
  assert.equal(rows.find(row=>row.sourceId==='transfer').amount,-20);assert.equal(rows.reduce((sum,row)=>sum+row.amount,0),-20);
  assert.equal(procurement.balance(db,'tank','B','2026-09-30'),null);assert.equal(procurement.balance(db,'tank','B','2026-10-01'),250);
});

test('procurement clips its observed usage window and produces no false order before accounting starts',()=>{
  const db=fixture(),outside=procurement.usage(db,'tank','A','2026-08-31');assert.equal(outside.status,'outside-accounting');assert.equal(outside.total,null);assert.equal(outside.daily,null);assert.deepEqual(procurement.plan(db,{date:'2026-08-31'}),[]);
  const first=procurement.usage(db,'tank','A','2026-09-02');assert.equal(first.from,'2026-09-01');assert.equal(first.observedDays,2);assert.equal(first.total,130);assert.equal(first.daily,65);
  near(procurement.balance(db,'tank','A','2026-09-30'),873.537);const planned=procurement.plan(db,{date:'2026-09-02'});assert.equal(planned.length,1);assert.equal(planned[0].itemId,'A');assert.equal(planned[0].daily,65);assert.ok(Number.isFinite(planned[0].suggestedQty));
});

test('generic current balance helper returns null before start and exact opening when there is only archived history',()=>{
  const app=harness(),asset=app.context.data.vehicles[0],rows=app.context.recsFor('v'),balances=fuel.recordBalances(app.context.data,'v');
  assert.equal(app.context.fuelAccountingCurrentBalance('vehicles',asset,rows,balances,'2026-08-31'),null);
  assert.equal(app.context.fuelAccountingCurrentBalance('vehicles',asset,rows.filter(row=>row.date<'2026-09-01'),balances,'2026-09-01'),923.537);
  app.context.__today='2026-08-31';assert.equal(app.context.fuelAccountingCurrentBalance('vehicles',asset,rows,balances),null);
});

test('absence of start metadata retains legacy full-history fuel calculations and does not infer a September cutoff',()=>{
  const db=fixture();for(const name of ['vehicles','generators','tanks'])for(const row of db[name])delete row.fuelAccounting;
  const app=harness(db),before=JSON.stringify(app.context.data);
  assert.equal(app.context.computeTankBalance('A').balance,9549);assert.equal(app.context.computeTankBalanceAt('A','2026-09-30',true),9549);
  assert.equal(app.context.computeGenBalanceAt(9,'2026-10-31',true),800);assert.equal(app.context.computeGenFuelBalances(9).gAug,700);
  assert.equal(app.context.fuelAccountingOpening('generators',undefined),0);assert.equal(app.context.computeGenBalanceAt('missing','2026-08-31',true),0);
  assert.equal(JSON.stringify(app.context.data),before);
});

test('DES act refuses pre-start, partially covered and unbounded periods before generating any workbook',()=>{
  for(const [from,to]of [['2026-08-01','2026-08-31'],['2026-08-01','2026-09-30'],[null,null]]){
    const app=harness();assert.equal(app.export(from,to),false);assert.equal(app.calls.books.length,0);assert.equal(app.calls.alerts.length,1);assert.match(app.calls.alerts[0],/учёт|учета|учёта|даты/i);
  }
});

test('DES act retains the explicit millilitre opening in the actual worksheet instead of rounding it to a different stock value',()=>{
  const app=harness();app.export();assert.equal(app.calls.alerts.length,0);assert.equal(app.calls.books.length,1);
  const sheet=app.calls.books[0].sheet,marker=Object.entries(sheet).find(([,cell])=>cell?.v==='Остаток ДТ, л:');assert.ok(marker);
  const row=Number(marker[0].split(',')[0])+1;near(sheet[row+',2'].v,943.537);near(sheet[row+',3'].v,1013.537);
});

test('generator balance cache preserves numeric and string identities with independent explicit openings',()=>{
  const db=fixture();db.generators=[{id:7,name:'Numeric ID',fuelBalance:500,fuelAccounting:anchor('2026-09-01',10)},{id:'7',name:'String ID',fuelBalance:600,fuelAccounting:anchor('2026-09-01',100)}];
  db.genRecords=[{id:'number-row',generatorId:7,date:'2026-09-01',hours:1,fuelIssued:0,fuelActual:1},{id:'string-row',generatorId:'7',date:'2026-09-01',hours:1,fuelIssued:0,fuelActual:2}];
  const app=harness(db);assert.equal(app.context.computeGenFuelBalances(7)['number-row'],9);assert.equal(app.context.computeGenFuelBalances('7')['string-row'],98);
});
test('new DES worksheet keeps millilitres and thousandths of hours even without optional accounting metadata',()=>{
  const db=fixture();db.generators=[{id:9,name:'Synthetic millilitre DES',location:'Synthetic site',fuel:'diesel',fuelBalance:923.537}];
  db.genRecords=[{id:'small',generatorId:9,date:'2026-09-01',hours:0.001,fuelActual:0.001,fuelUsed:0.001,fuelIssued:0.002,tankId:null}];
  db.tanks=[];db.tankIncomes=[];db.fuelMovements=[];
  const app=harness(db),before=JSON.stringify(app.context.data);app.export();
  assert.equal(app.calls.alerts.length,0);const sheet=app.calls.books[0].sheet;
  const marker=Object.entries(sheet).find(([,cell])=>cell?.v==='Synthetic millilitre DES');assert.ok(marker);
  const row=Number(marker[0].split(',')[0]);assert.equal(sheet[row+',3'].v,0.001);assert.equal(sheet[row+',9'].v,0.001);assert.equal(sheet[row+',10'].v,0.001);assert.equal(sheet[row+',11'].v,923.538);
  const total=Object.entries(sheet).find(([,cell])=>cell?.v==='ИТОГО');const totalRow=Number(total[0].split(',')[0]);
  assert.equal(sheet[totalRow+',10'].v,sheet[row+',10'].v);assert.equal(JSON.stringify(app.context.data),before);
});
test('DES worksheet and legacy record source preserve a valid numeric zero tank identity',()=>{
  const db=fixture();db.generators=[{id:9,name:'Numeric zero tank DES',location:'Synthetic site',fuel:'diesel',tankId:0,fuelBalance:20}];
  db.tanks=[{id:0,name:'Numeric zero tank',balanceInit:923.537}];db.genRecords=[];db.tankIncomes=[];db.fuelMovements=[];
  const app=harness(db);assert.equal(app.context.genRecordTankId({generatorId:9}),0);app.export();
  const sheet=app.calls.books[0].sheet,marker=Object.entries(sheet).find(([,cell])=>cell?.v==='Остаток ДТ, л:');assert.ok(marker);
  const row=Number(marker[0].split(',')[0])+1;assert.equal(sheet[row+',2'].v,943.537);assert.equal(sheet[row+',3'].v,943.537);
});

test('vehicle sidebar keeps all kilometres but does not present not-started accounting as a measured zero balance',()=>{
  const app=harness(fixture(),'2026-08-31');app.context.renderSidebarSummary();const html=app.elements.get('sidebarSummary').innerHTML;
  assert.match(html,/797/);assert.match(html,/Учёт.*не начат|учёт.*не начат|Не учитывается|не начат/i);
  assert.doesNotMatch(html,/>10 л<|>2 л</);
});

test('generator sidebar preserves archived hour history and labels wholly outside accounting instead of converting null to zero',()=>{
  const app=harness(fixture(),'2026-08-31');app.context.renderGenSidebarSummary();const html=app.elements.get('generatorList').children[0].innerHTML;
  assert.match(html,/783/);assert.match(html,/Учёт.*не начат|учёт.*не начат|Не учитывается|не начат/i);
  assert.doesNotMatch(html,/>130 л<|>30 л</);
});

test('a generator tile cannot advertise an active fuel balance before that generator starts accounting merely because its source tank has started',()=>{
  const db=fixture();db.generators[0].fuelAccounting=anchor('2026-11-01',20);
  const app=harness(db,'2026-09-30');assert.equal(app.context.computeGenBalanceAt(9,'2026-09-30',true),null);
  app.context.renderGeneratorCards();const html=app.elements.get('genGridArea').innerHTML;
  assert.match(html,/Учёт.*не начат|учёт.*не начат|не начат/i);assert.match(html,/783/);
});

test('a not-started generator does not turn an active shared source tank into its own tracked sidebar balance',()=>{
  const db=fixture();db.generators[0].fuelAccounting=anchor('2026-11-01',20);
  const app=harness(db,'2026-09-30');app.context.renderGenSidebarSummary();const html=app.elements.get('generatorList').children[0].innerHTML;
  assert.match(html,/Учёт.*не начат|учёт.*не начат|не начат/i);assert.match(html,/783/);assert.doesNotMatch(html,/873[,.]537/);
  app.context.data.generators.push({id:10,name:'Active generator',tankId:'A',fuelBalance:500,fuelAccounting:anchor('2026-09-01',0)});
  app.context.renderGenSidebarSummary();const shared=app.elements.get('generatorList').children.at(-1).innerHTML;
  assert.match(shared,/873[,.]537/);assert.doesNotMatch(shared,/1747[,.]074/);
});
