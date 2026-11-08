'use strict';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {launch}=require('./helpers/fuel-import-ui-harness.cjs'),fuel=require('../assets/core/fuel-engine'),decimal=require('../assets/core/decimal-core'),accounting=require('../assets/core/accounting-boundary');
let harness;before(async()=>{harness=await launch();});after(async()=>{await harness?.browser.close();});
const source=name=>fs.readFileSync(path.join(__dirname,'../assets/js',name),'utf8');
const vehicle=()=>({id:0,plate:'SYNTHETIC',make:'Test vehicle',org:'A',fuel:'diesel',fuelGrade:'ДТ',fuelBalance:50,norm:10,fuelAccounting:{version:1,from:'2026-09-01',opening:50,basis:'Synthetic measured opening'}});
function context(data,readable=['*']){
 const ctx=vm.createContext({data,TvsFuelEngine:fuel,DecimalCore:decimal,AccountingBoundary:accounting,console,
  dispatcherLocalDate:()=> '2026-09-30',cmpDateAsc:(a,b)=>a.localeCompare(b),platformSessionContext:()=>({readable,writable:['*']}),
  precisionFormat:value=>value==null?'—':String(value),precisionRound:(value,scale)=>decimal.toNumberExact(decimal.quantize(value,{scale,rounding:'half-away-from-zero'})),
  fqValue:fuel.fqValue,recordFuelGrade:fuel.recordFuelGrade,htmlEsc:value=>String(value),fcNorm:value=>String(value??'').trim(),
  fcList:()=>data.fuelCards||[],fcByNumber:number=>(data.fuelCards||[]).find(row=>row.number===number),fcGuessProvider:()=> 'Synthetic supplier',
  recsFor:id=>(data.records||[]).filter(row=>row.vehicleId===id),fuelPeriods:()=>data.fuelPeriods||[],fuelPeriod:month=>(data.fuelPeriods||[]).find(row=>row.month===month),fuelMonthClosed:()=>false,
  fkCard:(label,value,note)=>'<article data-card="'+label+'"><b>'+value+'</b><small>'+note+'</small></article>'});
 return ctx;
}

test('fuel statement preview labels a signed return and keeps vehicle choice without a journal chooser',async()=>{
 const page=await harness.fixture(2,3,1);try{
  const result=await page.evaluate(()=>{
   Object.assign(__source.rows[0].normalized,{operationKind:'return',qty:-5,sum:-350});
   __preview.rows[0]={...__preview.rows[0],target:{section:'vehicles',id:0},after:{vehicleId:0,qty:-5,sum:-350,operationKind:'return'}};
   reviewedFuelRender(__session,__preview);const row=document.querySelector('[data-import-row="row-0"]'),choice=row.querySelector('[data-import-target]');choice.onfocus();
   return {text:row.textContent,litres:row.children[3].textContent,action:row.querySelector('td:last-child strong').textContent,journal:!!row.querySelector('[data-import-existing]'),options:[...choice.options].map(option=>[option.value,option.textContent]),selected:choice.value,rows:document.querySelectorAll('[data-import-row]').length,writes:__dataWritten};
  });
  assert.match(result.text,/Возврат/i);assert.match(result.action,/возврат/i);assert.equal(result.litres,'-5');assert.equal(result.journal,false);assert.equal(result.options.length,4);assert.deepEqual(result.options.map(row=>row[0]),['','r0','r1','r2']);assert.equal(result.selected,'r0');assert.equal(result.rows,2);assert.equal(result.writes,0);
 }finally{await page.close();}
});

test('current vehicle balance applies later refunds once without changing the historical measured cell',()=>{
 const data={vehicles:[vehicle()],records:[{id:0,vehicleId:0,date:'2026-09-12',km:0,fuelIssued:0,fuelActual:0,fuelGrade:'ДТ',tankMeasured:30}],fuelPurchases:[
  {id:'return',vehicleId:0,date:'2026-09-13',qty:-5,grade:'ДТ',operationKind:'return'},
  {id:'deleted',vehicleId:0,date:'2026-09-14',qty:-100,grade:'ДТ',operationKind:'return',deleted:true},
  {id:'foreign-typed-zero',vehicleId:'0',date:'2026-09-14',qty:-100,grade:'ДТ',operationKind:'return'},
  {id:'cancelled',vehicleId:0,date:'2026-09-14',qty:-100,grade:'ДТ',operationKind:'return',cancelled:true},
  {id:'cancelled-status',vehicleId:0,date:'2026-09-14',qty:-100,grade:'ДТ',operationKind:'return',status:'cancelled'}]};
 const original=JSON.stringify(data),ctx=context(data);vm.runInContext(source('29-fuel-quality.js'),ctx);const balances=fuel.recordBalances(data,0);
 assert.equal(fuel.recordBalanceAt(balances,0),30);assert.equal(ctx.fuelAccountingCurrentBalance('vehicles',data.vehicles[0],data.records,balances),25);
 assert.equal(ctx.fuelAccountingCurrentBalance('vehicles',data.vehicles[0],data.records,balances,'2026-09-12'),30);assert.equal(fuel.recordBalanceAt(balances,0),30);assert.equal(JSON.stringify(data),original);
});

test('current balance uses confirmed opening for a refund-only vehicle and requires both source sections',()=>{
 const data={vehicles:[vehicle()],records:[],fuelPurchases:[{id:'return',vehicleId:0,date:'2026-09-13',qty:-10,grade:'ДТ',operationKind:'return'}]};
 for(const readable of [['*'],['vehicles','records','fuelPurchases'],['vehicles','records'],['vehicles','fuelPurchases'],['records','fuelPurchases']]){
  const ctx=context(data,readable);vm.runInContext(source('29-fuel-quality.js'),ctx);const balance=ctx.fuelAccountingCurrentBalance('vehicles',data.vehicles[0],data.records,{});
  assert.equal(balance,readable.includes('*')||['vehicles','records','fuelPurchases'].every(name=>readable.includes(name))?40:null);
 }
});

test('return link and apply adapters never attach or mutate an existing same-day journal',()=>{
 const data={vehicles:[vehicle()],records:[{id:0,vehicleId:0,date:'2026-09-13',km:100,fuelIssued:50,fuelSum:3500,fuelGrade:'ДТ'}],fuelPurchases:[]},ctx=context(data);vm.runInContext(source('25b-fuel-purchases.js'),ctx);const original=JSON.stringify(data.records);
 for(const recordId of [null,0])for(const sign of [-1,1]){
  const returned={id:'return',vehicleId:0,date:'2026-09-13',qty:-10,sum:-700,grade:'ДТ',operationKind:'return',recordId};assert.equal(ctx.fpLinkedRecord(returned),null);assert.equal(ctx.fpApply(returned,sign),null);assert.equal(returned.recordId,null);assert.equal(returned.qty,-10);assert.equal(JSON.stringify(data.records),original);
 }
});

test('zero net monthly fuel stays zero and reconciliation does not invent fuel missing from statements',async()=>{
 const data={vehicles:[vehicle()],records:[{id:'receipt',vehicleId:0,date:'2026-09-12',km:100,fuelIssued:50,fuelGrade:'ДТ'}],monthlyFuel:[],fuelPeriods:[],fuelCards:[],fuelPurchases:[
  {id:'purchase',vehicleId:0,date:'2026-09-12',qty:50,sum:3500,grade:'ДТ',sourceProvider:'Synthetic supplier',recordId:'receipt'},
  {id:'return',vehicleId:0,date:'2026-09-13',qty:-50,sum:-3500,grade:'ДТ',sourceProvider:'Synthetic supplier',operationKind:'return'}]};
 const original=JSON.stringify(data),ctx=context(data);vm.runInContext(source('25b-fuel-purchases.js'),ctx);vm.runInContext(source('25e-fuel-recon.js'),ctx);vm.runInContext("fpMonth='2026-09';frcMonth='2026-09';",ctx);
 const monthly=ctx.fpMonthlyHtml(),reconciliation=ctx.frcHtml(),page=await harness.browser.newPage();try{
  await page.setContent('<main id="monthly">'+monthly+'</main><main id="reconciliation">'+reconciliation+'</main>');
  const rendered=await page.evaluate(()=>({eco:document.querySelector('#monthly tbody tr').children[11].textContent.trim(),issued:document.querySelector('#monthly tfoot tr').children[5].textContent.trim(),missing:document.querySelector('#reconciliation [data-card="Журнал без выписок"] b').textContent.trim(),note:document.querySelector('#reconciliation [data-card="Журнал без выписок"] small').textContent}));
  assert.equal(rendered.eco,'-10');assert.equal(rendered.issued,'0');assert.equal(rendered.missing,'0 л');assert.match(rendered.note,/возвраты: -50 л/);assert.equal(JSON.stringify(data),original);
 }finally{await page.close();}
});
