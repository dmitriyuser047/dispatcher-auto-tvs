'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const core=require('../assets/core/registry-import.js');
const db={vehicles:[{id:0,plate:'SYNTHETIC-0',org:'A',site:'North'}],generators:[{id:'0',name:'Synthetic DES',org:'A',location:'South'}],savedReestrs:[]};
const source={id:'a'.repeat(64)+'.pdf',sha256:'a'.repeat(64),size:120,name:'synthetic.pdf'};
function input(){return {id:'registry-synthetic',number:'185',date:'2026-10-22',source,declaredTotal:100.1,reason:'Synthetic checked source',invoices:[{supplier:'Synthetic supplier',description:'Synthetic work',invoiceNo:'01',date:'2026-10-01',sum:100.1,allocations:[{kind:'vehicle',assetId:0,sum:40.05},{kind:'generator',assetId:'0',sum:40.05},{kind:'other',label:'Delivery',sum:20}]}]};}
test('registry table keeps multiline invoices and excludes Russian total footers',()=>{
  const parsed=core.parseTable({name:'Sheet',preamble:['Реестр 185 от 22.10.2026'],grid:[['№','Сумма, руб.','Контрагент','Назначение платежа','ОСНОВАНИЕ'],['1','100 000,01','Synthetic','Work\n• Итого: 10 000,00 руб.','Счет №187/1 от 06.03.2026'],['2','0','Synthetic','Standby','Счёт №0002 от 01.01.2026'],['','100 000,01','ВСЕГО по ИКГ','','']]});
  assert.equal(parsed.rows.length,2);assert.equal(parsed.knownTotal,100000.01);assert.equal(parsed.declaredTotal,100000.01);assert.equal(parsed.rows[0].invoiceNo,'187/1');assert.equal(parsed.rows[0].date,'2026-03-06');assert.equal(parsed.rows[1].sum,0);assert.match(parsed.rows[0].description,/10 000/);assert.equal(parsed.number,'185');assert.equal(parsed.date,'2026-10-22');
});
test('missing or malformed sums remain unknown and declared total mismatches stay visible',()=>{
  const value=core.parseTable({grid:[['Сумма','Контрагент'],['','Synthetic'],['not a number','Synthetic'],['12.50','Synthetic'],['12.51','ВСЕГО']]});assert.equal(value.rows[0].sum,null);assert.equal(value.rows[1].sum,null);assert.equal(value.knownTotal,null);assert.equal(value.declaredTotal,12.51);assert.ok(value.warnings.length);
  const mismatch=core.parseTable({grid:[['Сумма','Назначение'],['1.00','Synthetic'],['2.00','ВСЕГО']]});assert.equal(mismatch.rows.length,1);assert.match(mismatch.warnings.join(' '),/отличается/);
  for(const value of [true,-1,'1.001','1e3',Infinity])assert.throws(()=>core.cents(value));assert.equal(core.cents('0,01'),1);assert.equal(core.isoDate('31.02.2026'),'');
});
test('one invoice splits exactly in cents across typed vehicle, DES and other expenses without writing facts',()=>{
  const before=JSON.stringify(db),entry=core.buildRegister(input(),db);assert.equal(entry.rows.length,3);assert.equal(entry.rows[0].vehicleId,0);assert.equal(entry.rows[1].generatorId,'0');assert.equal(entry.rows[2].registryAllocationKind,'other');assert.equal(entry.totalSum,100.1);assert.equal(entry.rowCount,1);assert.equal(core.invoices(entry).length,1);assert.equal(JSON.stringify(db),before);
  assert.ok(!entry.rows.some(row=>Object.hasOwn(row,'paid')));assert.equal(entry.rows[0].registryInvoiceSum,100.1);
});
test('allocation balance, invalid references and source totals are enforced for raw writes too',()=>{
  const entry=core.buildRegister(input(),db);const next=()=>JSON.parse(JSON.stringify(entry));let bad=next();bad.rows[0].sum=40.06;assert.throws(()=>core.validateChanges(db,{...db,savedReestrs:[bad]}),/распределения/);
  bad=next();bad.rows[0].vehicleId='0';assert.throws(()=>core.validateChanges(db,{...db,savedReestrs:[bad]}),/техники/);
  bad=next();bad.rows[1].vehicleId=0;assert.throws(()=>core.validateRegister(bad,db),/техники/);
  bad=next();bad.rows[2].generatorId='0';assert.throws(()=>core.validateRegister(bad,db),/Прочий/);
  bad=next();bad.declaredTotal=100.11;assert.throws(()=>core.validateRegister(bad,db),/итог/);
  bad=next();bad.rows[1].description='Different invoice';assert.throws(()=>core.validateRegister(bad,db),/разные/);
});
test('same original cannot be added twice and invoice repeats need an explicit reason',()=>{
  const first=core.buildRegister(input(),db),previous={...db,savedReestrs:[first]},changed=input();changed.id='registry-second';let second=core.buildRegister(changed,db);assert.throws(()=>core.validateChanges(previous,{...db,savedReestrs:[first,second]}),/файл/);
  changed.source={...source,id:'b'.repeat(64)+'.pdf',sha256:'b'.repeat(64)};second=core.buildRegister(changed,db);assert.throws(()=>core.validateChanges(previous,{...db,savedReestrs:[first,second]}),/уже есть/);
  changed.duplicateReason='Explicit synthetic duplicate approval';second=core.buildRegister(changed,db);assert.doesNotThrow(()=>core.validateChanges(previous,{...db,savedReestrs:[first,second]}));
  const downgraded={...first,kind:'legacy'};assert.throws(()=>core.validateChanges(previous,{...db,savedReestrs:[downgraded]}),/Тип/);
  assert.doesNotThrow(()=>core.validateChanges({savedReestrs:[{number:1,rows:[]}]},{savedReestrs:[{number:1,rows:[]}]}));
});
test('browser and server use the exact same registry parser and allocation rules',()=>{
  const context=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/core/registry-import.js'),'utf8'),context);assert.equal(JSON.stringify(context.RegistryImport.buildRegister(input(),db)),JSON.stringify(core.buildRegister(input(),db)));
});
test('imported registry labels remain inert in the retained saved-register list',()=>{
  const nodes=Object.fromEntries(['reestrSavedList','reestrSavedEmpty','reestrSavedCount'].map(id=>[id,{style:{},innerHTML:'',textContent:''}]));
  const context=vm.createContext({data:{savedReestrs:[{number:'"><img src=x onerror=alert(1)>',date:'<script>bad()</script>',rowCount:1,totalSum:1}]},document:{getElementById:id=>nodes[id]},htmlEsc:require('../web/pages.cjs').escape});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/js/20-to-schedule.js'),'utf8'),context);context.reestrRenderSavedList();
  assert.doesNotMatch(nodes.reestrSavedList.innerHTML,/<img|<script>/);assert.match(nodes.reestrSavedList.innerHTML,/&lt;img/);
});
test('training and clothing split across exact driver IDs and survive reopening with their categories',()=>{
  const database={...db,drivers:[{id:0,name:'Synthetic driver number'},{id:'0',name:'Synthetic driver text'}]},request=input();
  request.invoices[0].allocations=[{kind:'driver',assetId:0,sum:40.05,expenseType:'training'},{kind:'driver',assetId:'0',sum:60.05,expenseType:'clothing'}];
  const entry=core.buildRegister(request,database);assert.equal(entry.workspace,'registries');assert.equal(entry.rows[0].driverId,0);assert.equal(entry.rows[1].driverId,'0');assert.equal(entry.rows[0].registryExpenseType,'training');assert.equal(entry.rows[1].registryExpenseType,'clothing');assert.equal(entry.totalSum,100.1);
  const reopened=core.invoices(entry);assert.equal(reopened[0].allocations[0].assetId,0);assert.equal(reopened[0].allocations[1].expenseType,'clothing');
  let bad=structuredClone(entry);bad.rows[0].driverId='missing';assert.throws(()=>core.validateRegister(bad,database),/Водитель/);
  bad=structuredClone(entry);bad.rows[0].vehicleId=0;assert.throws(()=>core.validateRegister(bad,database),/Водитель/);
  bad=structuredClone(entry);bad.rows[0].registryExpenseType='unknown';assert.throws(()=>core.validateRegister(bad,database),/категория/);
  assert.equal(core.isImportedRegister(entry),true);assert.equal(core.isImportedRegister({number:1,rows:[]}),false);
});
test('imported registers stay out of the invoice list and financial row indexes remain exact',()=>{
  const nodes=Object.fromEntries(['reestrSavedList','reestrSavedEmpty','reestrSavedCount'].map(id=>[id,{style:{},innerHTML:'',textContent:''}]));
  const context=vm.createContext({data:{savedReestrs:[{kind:'payment-registry',registryVersion:1,number:'LOG-PRIVATE',date:'2026-10-22',rows:[],totalSum:50},{number:'FIN-001',date:'2026-10-22',rowCount:1,totalSum:25}]},document:{getElementById:id=>nodes[id]},htmlEsc:require('../web/pages.cjs').escape});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/js/20-to-schedule.js'),'utf8'),context);context.reestrRenderSavedList();
  assert.doesNotMatch(nodes.reestrSavedList.innerHTML,/LOG-PRIVATE/);assert.match(nodes.reestrSavedList.innerHTML,/FIN-001/);assert.match(nodes.reestrSavedList.innerHTML,/reestrOpenSaved\(1\)/);assert.match(nodes.reestrSavedList.innerHTML,/reestrDeleteSaved\(1\)/);assert.equal(nodes.reestrSavedCount.textContent,'1 шт.');
});
test('logistics delegates to the same registry editor with an isolated logistics workspace',()=>{
  const calls=[],context=vm.createContext({window:{tvsWeb:{registries:{render:workspace=>calls.push(workspace)}}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/public/logistics.js'),'utf8'),context);context.window.tvsWeb.logistics.render();
  assert.deepEqual(calls,['logistics']);
});
test('registry driver filters preserve typed identity, expense categories and a separate financial list',()=>{
  const request=input(),database={...db,drivers:[{id:0,name:'Driver number'},{id:'0',name:'Driver text'}]};
  request.invoices[0].allocations=[{kind:'driver',assetId:0,sum:40.05,expenseType:'training'},{kind:'driver',assetId:'0',sum:60.05,expenseType:'clothing'}];
  const entry=core.buildRegister(request,database),query=new URLSearchParams({kind:'driver',expense:'training',asset:'driver:'+core.typed(0)});
  const context=vm.createContext({window:{tvsWeb:{},addEventListener(){}},document:{addEventListener(){}},RegistryImport:core,RegistryAccounting:require('../assets/core/registry-accounting.js'),htmlEsc:require('../web/pages.cjs').escape,data:{...database,savedReestrs:[{number:'PRIVATE-FINANCIAL',rows:[{sum:9999}]},entry]},URLSearchParams,location:{search:'?'+query}});
  const source=fs.readFileSync(path.join(__dirname,'../web/public/registries.js'),'utf8');vm.runInContext(source.replace('web.registries={render};','web.registries={render,visibleRows,allocationHtml};'),context);
  const rows=context.window.tvsWeb.registries.visibleRows();assert.equal(rows.length,1);assert.equal(rows[0].driverId,0);assert.equal(rows[0].registryExpenseType,'training');
  const html=context.window.tvsWeb.registries.allocationHtml({kind:'driver',assetId:0,sum:40.05,expenseType:'training'},0);assert.match(html,/Driver number/);assert.match(html,/data-driver-expense/);assert.match(html,/value="training" selected/);
});
test('a direct invoice-to-driver link preserves every amount and the driver card shows the invoice once',()=>{
  const database={...db,drivers:[{id:0,name:'Driver zero'},{id:'0',name:'Other typed driver'}]},request=input(),before=JSON.stringify(database);
  const linked=core.linkDriver(request.invoices[0],0);assert.equal(linked.driverId,0);assert.equal(core.linkedDriverId(linked),0);assert.deepEqual(linked.allocations.map(part=>part.sum),[40.05,40.05,20]);
  assert.equal(request.invoices[0].allocations[0].kind,'vehicle');request.invoices=[linked];const entry=core.buildRegister(request,database),current={...database,savedReestrs:[entry]};
  assert.equal(core.invoices(entry)[0].driverId,0);assert.ok(entry.rows.every(row=>row.driverId===0));
  const bills=core.driverInvoices(current,0);assert.equal(bills.length,1);assert.equal(bills[0].sum,100.1);assert.equal(bills[0].invoiceSum,100.1);assert.equal(bills[0].invoiceNo,'01');assert.equal(core.driverInvoices(current,'0').length,0);
  const cleared=core.linkDriver(linked,null);assert.equal(core.linkedDriverId(cleared),null);assert.ok(cleared.allocations.every(part=>part.kind==='unassigned'));assert.equal(core.total(cleared.allocations.map(part=>part.sum)),100.1);assert.equal(JSON.stringify(database),before);
});
