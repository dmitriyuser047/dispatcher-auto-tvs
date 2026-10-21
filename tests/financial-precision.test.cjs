'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const DecimalCore=require('../assets/core/decimal-core.js'),cost=require('../assets/js/45-cost-engine.js');
function app(incomes=[]){
 const books=[],content={innerHTML:''},data={tanks:[{id:'t',name:'Synthetic tank',object:'Synthetic site',fuel:'diesel'}],tankIncomes:incomes,vehicles:[],records:[],generators:[],genRecords:[]};
 const context=vm.createContext({DecimalCore,data,console,activeSection:'fuel',fqValue:value=>value===undefined||value===null||value===''?null:Number.isFinite(Number(value))?Number(value):null,fqDate:value=>/^\d{4}-\d{2}-\d{2}$/.test(value||''),document:{getElementById:()=>content},alert:message=>{throw Error(message);},XLSX:{utils:{encode_cell:({r,c})=>r+','+c,encode_range:({s,e})=>s.r+','+s.c+':'+e.r+','+e.c,book_new:()=>({SheetNames:[],Sheets:{}}),book_append_sheet:(book,sheet,name)=>{book.SheetNames.push(name);book.Sheets[name]=sheet;}},writeFile:(book,name)=>{books.push({book,name});}}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/js/25-fuel-report.js'),'utf8'),context,{filename:'25-fuel-report.js'});vm.runInContext("fuelRepYear='2026';fuelRepTab='in';fuelRepMetric='both'",context);
 return {context,data,books,content,build:()=>context.frBuild(),sheet(name='exportFuelReportXlsx'){context[name]();const book=books.at(-1).book;return book.Sheets[book.SheetNames[0]];}};
}
const income=(id,sum=1.03,extra={})=>({id,tankId:'t',date:'2026-09-10',amount:1,source:'Synthetic supplier '+id,operationType:'purchase',sum,vatRate:20,...extra});
function sheetRows(sheet){const out=[];for(const [key,cell]of Object.entries(sheet)){if(key.startsWith('!'))continue;const [r,c]=key.split(',').map(Number);out[r]??=[];out[r][c]=cell;}return out;}
function linesFor(sheet,metric){const rows=sheetRows(sheet),index=rows.findIndex(row=>row?.[0]?.v===metric);assert.ok(index>=0,metric);return rows.slice(index+1).filter(Boolean).slice(0,5);}

test('VAT is derived and rounded per source document and exact totals equal the displayed document amounts',()=>{
 const h=app([income('a'),income('b')]),before=JSON.stringify(h.data),first=h.context.frTax(h.data.tankIncomes[0]);assert.equal(first.net,1.03);assert.equal(first.vat,0.21);assert.equal(first.gross,1.24);assert.equal(first.calculationVersion,2);
 const model=h.build();assert.equal(model.grand.s,2.06);assert.equal(model.grand.vat,0.42);assert.equal(model.grand.gross,2.48);assert.equal(model.calculationVersion,2);assert.equal(JSON.stringify(h.data),before);
 h.context.renderFuelReport();assert.match(h.content.innerHTML,/2,48/);assert.match(h.content.innerHTML,/отдельно по каждому документу/);
 const sheet=h.sheet(),vat=linesFor(sheet,'НДС по документам').find(row=>row[0]?.v==='ИТОГО'),gross=linesFor(sheet,'Всего с НДС').find(row=>row[0]?.v==='ИТОГО');assert.equal(vat[1].v,0.42);assert.equal(gross[1].v,2.48);assert.equal(gross[1].z,'#,##0.00');
 const summary=h.sheet('exportFuelIncomeSummaryXlsx'),total=sheetRows(summary).find(row=>row?.[0]?.v==='ВСЕГО');assert.equal(total[4].v,2.48);assert.equal(total[7].v,2.48);assert.equal(JSON.stringify(h.data),before);
});

test('explicit VAT and gross source amounts outrank the rate, and missing values stay unknown instead of invented zero',()=>{
 const h=app(),tax=h.context.frTax(income('explicit',1.03,{vatAmount:0.22,grossSum:1.25}));assert.equal(tax.vat,0.22);assert.equal(tax.gross,1.25);assert.equal(tax.invalid,false);
 const derivedNet=h.context.frTax(income('net',null,{grossSum:1.24,vatRate:20}));assert.equal(derivedNet.net,1.03);assert.equal(derivedNet.vat,0.21);
 const absent=h.context.frTax(income('unknown',1.03,{vatRate:null}));assert.equal(absent.net,1.03);assert.equal(absent.vat,null);assert.equal(absent.gross,null);assert.equal(h.context.fpNumSafe(null),'—');assert.equal(h.context.fpNumSafe(923.537),'923,537');
});

test('historical source cents with extra precision are shown completely, diagnosed and summed without rewriting',()=>{
 const h=app([income('a',0.105,{vatAmount:0,grossSum:0.105}),income('b',0.105,{vatAmount:0,grossSum:0.105})]),before=JSON.stringify(h.data),model=h.build();assert.equal(model.grand.s,0.21);assert.equal(model.grand.gross,0.21);assert.equal(model.grand.precisionLegacy,2);
 assert.equal(h.context.frTax(h.data.tankIncomes[0]).net,0.105);assert.equal(h.context.frFormat(0.105,{dec:2}),'0,105');h.context.renderFuelReport();assert.match(h.content.innerHTML,/с повышенной точностью: 2/);
 const summary=h.sheet('exportFuelIncomeSummaryXlsx'),lines=sheetRows(summary).filter(row=>row?.[1]?.v?.startsWith?.('Synthetic supplier'));assert.equal(lines.length,2);for(const line of lines){assert.equal(line[4].v,0.105);assert.equal(line[4].z,'#,##0.000');}assert.equal(sheetRows(summary).find(row=>row?.[0]?.v==='ВСЕГО')[4].v,0.21);assert.equal(JSON.stringify(h.data),before);
});

test('report exact additions preserve source millilitres and reject non-finite or overflowing totals explicitly',()=>{
 const h=app([income('a',0.1,{amount:923.537,vatAmount:0}),income('b',0.2,{amount:0.001,vatAmount:0})]);assert.equal(h.build().grand.l,923.538);assert.equal(h.build().grand.s,0.3);
 assert.throws(()=>h.context.frTax(income('bad',Infinity)),{code:'INVALID_DECIMAL'});assert.throws(()=>h.context.frPlus(1e308,1e308),{code:'RANGE'});assert.throws(()=>h.context.frNumber(NaN),{code:'INVALID_DECIMAL'});
});

const period={from:'2026-09-01',to:'2026-09-30'},entry=(id,amount)=>({id,date:'2026-09-10',assetRef:'v:v',kind:'expense',amount,title:'Synthetic cost '+id,independent:true});
test('cost totals use decimal source amounts with legacy diagnostics and explicit range failures',()=>{
 const data={vehicles:[{id:'v'}],records:[{id:'r',vehicleId:'v',date:'2026-09-10',km:1}],costEntries:[entry('a',0.1),entry('b',0.2)]},before=JSON.stringify(data),report=cost.buildReport(data,period);assert.equal(report.rows[0].expenses,0.3);assert.equal(report.totals.expenses,0.3);assert.equal(JSON.stringify(data),before);
 data.costEntries=[entry('a',0.105),entry('b',0.105)];const legacy=cost.buildReport(data,period);assert.equal(legacy.totals.expenses,0.21);assert.ok(legacy.rows[0].entries.every(row=>row.amount===0.105&&row.precisionLegacy));assert.ok(legacy.rows[0].issues.some(row=>row.code==='precision'));
 data.costEntries=[entry('a',1e308),entry('b',1e308)];assert.throws(()=>cost.buildReport(data,period),{code:'RANGE'});
});

test('version 2 cost scenarios round each monetary piece once and total those same pieces',()=>{
 const scenario=cost.scenario({salaryRate:2.675,depreciationRate:1.005,fuelRate:3.123456,fuelPrice:1.234567},1,'ч');assert.equal(scenario.pieces[0].amount,2.68);assert.equal(scenario.pieces[1].amount,1.01);assert.equal(scenario.pieces[2].amount,3.86);assert.equal(scenario.amount,7.55);assert.equal(DecimalCore.sum(scenario.pieces.map(row=>row.amount)),String(scenario.amount));
 const expense=cost.buildReport({vehicles:[{id:'v'}],records:[{id:'r',vehicleId:'v',date:'2026-09-10',km:1}],costProfiles:[{id:'p',assetRef:'v:v',salaryRate:2.675}]},period);assert.equal(expense.calculationVersion,2);assert.equal(expense.rows[0].expenses,null);assert.equal(expense.rows[0].scenario.amount,2.68);
});
