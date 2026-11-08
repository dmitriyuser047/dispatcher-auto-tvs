'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const core=require('../assets/core/registry-import.js'),documents=require('../assets/core/document-state.js'),escape=require('../web/pages.cjs').escape;
const source={id:'a'.repeat(64)+'.pdf',sha256:'a'.repeat(64),size:120,name:'synthetic.pdf'},ref={section:'repairs',id:0};
function fixture(){
  const db={vehicles:[{id:0,plate:'Synthetic numeric'},{id:'0',plate:'Synthetic text'}],repairs:[{id:0,vehicleId:0,invoiceNo:'SAME',invoiceDate:'2026-10-01',cost:100},{id:'0',vehicleId:'0',invoiceNo:'SAME',cost:100},{id:'other',vehicleId:0,invoiceNo:'SAME'}],vehicleTo:[{id:'to',vehicleId:0,date:'2026-10-02',type:'Synthetic service',planned:true}],savedReestrs:[],payments:[]};
  db.savedReestrs=[core.buildRegister({id:'synthetic-register',number:'12',date:'2026-10-01',reason:'Synthetic verified original',source,invoices:[{invoiceNo:'SAME',supplier:'<img src=x>',sum:100,allocations:[{kind:'vehicle',assetId:0,sum:30},{kind:'vehicle',assetId:0,sum:20},{kind:'vehicle',assetId:'0',sum:50}]}]},db)];return db;
}
const pick=(db,index)=>({registerId:db.savedReestrs[0].id,rowId:db.savedReestrs[0].rows[index].id});
test('repairs and TO link exact allocations without number-based matching, invented costs or payments',()=>{
  const db=fixture(),raw=JSON.stringify(db);assert.equal(core.serviceInvoices(db,ref).length,0);
  const next={...db,savedReestrs:core.setServiceLinks(db,ref,[pick(db,0),pick(db,1)])};core.validateChanges(db,next);
  const bills=core.serviceInvoices(next,ref);assert.equal(bills.length,1);assert.equal(bills[0].sum,50);assert.equal(bills[0].invoiceSum,100);assert.equal(bills[0].invoiceId,db.savedReestrs[0].rows[0].registryInvoiceId);assert.equal(core.serviceInvoices(next,{section:'repairs',id:'0'}).length,0);assert.equal(core.serviceInvoices(next,{section:'repairs',id:'other'}).length,0);
  assert.equal(JSON.stringify(db),raw);assert.deepEqual(next.repairs,db.repairs);assert.deepEqual(next.vehicleTo,db.vehicleTo);assert.deepEqual(next.payments,[]);assert.equal(next.savedReestrs[0].totalSum,100);
  assert.throws(()=>core.setServiceLinks(next,{section:'vehicleTo',id:'to'},[pick(db,0)]),/другим ремонтом/);
  const unlinked={...next,savedReestrs:core.setServiceLinks(next,ref,[])};const service={...unlinked,savedReestrs:core.setServiceLinks(unlinked,{section:'vehicleTo',id:'to'},[pick(db,0)])};core.validateChanges(next,service);assert.equal(core.serviceInvoices(service,{section:'vehicleTo',id:'to'})[0].sum,30);assert.equal(service.vehicleTo[0].planned,true);
});
test('wrong vehicles, malformed references, deletions and raw reverse-side rebinds are rejected',()=>{
  const db=fixture();assert.throws(()=>core.setServiceLinks(db,ref,[pick(db,2)]),/этот автомобиль/);assert.throws(()=>core.setServiceLinks(db,ref,[pick(db,0),pick(db,0)]),/повторно/);
  const linked={...db,savedReestrs:core.setServiceLinks(db,ref,[pick(db,0)])};
  for(const alter of [next=>next.repairs.splice(0,1),next=>next.repairs[0].vehicleId='0',next=>next.savedReestrs[0].rows[0].serviceRef={section:'drivers',id:0},next=>next.savedReestrs[0].rows[0].serviceRef={section:'repairs',id:0,extra:true}]){const next=structuredClone(linked);alter(next);assert.throws(()=>core.validateChanges(linked,next),error=>error.code==='REGISTRY_SERVICE');}
  const next=structuredClone(linked);next.savedReestrs[0].rows[2].serviceRef=ref;assert.throws(()=>core.validateRegister(next.savedReestrs[0],next),/того же автомобиля/);
});
test('links follow the immutable root across corrections and survive registry editing and invoice deletion',()=>{
  const db=fixture(),linked={...db,savedReestrs:core.setServiceLinks(db,ref,[pick(db,0)])};
  linked.repairs[0].lifecycle={version:1,postedAt:'2026-10-01T12:00:00Z'};linked.repairs.push({id:'correction',vehicleId:0,cost:110,lifecycle:{version:1,postedAt:'2026-10-02T12:00:00Z',correctionOf:ref,reason:'Synthetic correction'}});
  assert.deepEqual(core.serviceTarget(linked,{section:'repairs',id:'correction'}).ref,ref);assert.equal(core.serviceInvoices(linked,{section:'repairs',id:'correction'}).length,1);assert.equal(core.serviceChoices(linked,0).filter(item=>item.ref.section==='repairs'&&item.ref.id===0).length,1);core.validateChanges(db,linked);
  const entry=linked.savedReestrs[0],invoices=core.invoices(entry);const rebuilt=core.buildRegister({...entry,invoices},linked);assert.deepEqual(rebuilt.rows[0].serviceRef,ref);assert.equal(rebuilt.rows[0].registryInvoiceId,entry.rows[0].registryInvoiceId);
  const second={...invoices[0],registryInvoiceId:'stable-second',invoiceNo:'Second',allocations:[{kind:'vehicle',assetId:0,sum:100,serviceRef:ref}]};const third=core.buildRegister({...entry,invoices:[invoices[0],second]},linked);const removedFirst=core.buildRegister({...third,invoices:core.invoices(third).slice(1)},linked);assert.equal(removedFirst.rows[0].registryInvoiceId,'stable-second');assert.deepEqual(removedFirst.rows[0].serviceRef,ref);
  const wrong=structuredClone(linked);wrong.savedReestrs[0].rows[0].serviceRef.id='correction';assert.throws(()=>core.validateChanges(linked,wrong),/корень/);
  const toDriver=core.linkDriver(invoices[0],9);assert.ok(toDriver.allocations.every(part=>!part.serviceRef));
});
test('native string asset references are checked with the shared typed identity resolver',()=>{
  const db=fixture();db.vehicles.push({id:'unique'});db.repairs.push({id:'by-ref',assetRef:'v:unique'});assert.equal(core.serviceTarget(db,{section:'repairs',id:'by-ref'}).row.vehicleId,'unique');
  db.repairs[0].assetRef='v:0';assert.throws(()=>core.serviceTarget(db,ref),/неоднозначно/);
});
test('vehicle card invoice cells escape source labels, show partial amounts and respect read/write access',()=>{
  const db=fixture();db.savedReestrs=core.setServiceLinks(db,ref,[pick(db,0),pick(db,1)]);
  const context=vm.createContext({window:{tvsWeb:{}},RegistryImport:core,htmlEsc:escape,data:db,_loadWriteBlocked:false,_sync:{access:{readable:['savedReestrs'],writable:['savedReestrs']},platform:{negotiation:{writeCompatible:true}}},document:{addEventListener(){}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/public/vehicle-invoices.js'),'utf8'),context);const view=context.window.tvsWeb.vehicleInvoices;
  const html=view.cellHtml('repairs',db.repairs[0]);assert.match(html,/invoice=synthetic-register/);assert.match(html,/50,00/);assert.match(html,/часть счёта на 100,00/);assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/Привязать счёт|Изменить привязку|<button/);
  context._sync.access.writable=[];assert.doesNotMatch(view.cellHtml('repairs',db.repairs[0]),/<button/);context._sync.access.readable=[];assert.equal(view.cellHtml('repairs',db.repairs[0]),'');assert.equal(view.headingHtml(),'');
});
test('car repair and TO tables render one invoice cell per record with aligned headers',()=>{
  const db=fixture(),context=vm.createContext({window:{tvsWeb:{vehicleInvoices:{headingHtml:()=>'<th>TEST INVOICE</th>',cellHtml:()=>'<td>TEST CELL</td>'}}},data:db,vehicleToFor:()=>db.vehicleTo,repairsFor:()=>db.repairs.slice(0,1),cmpDateAsc:()=>0,cmpDateDesc:()=>0,fmtDate:value=>value,htmlEsc:escape,htmlJs:value=>String(value)});
  db.repairs[0].invoiceNo='<img src=x>';db.repairs[0].category='<script>bad()</script>';
  for(const file of ['03-vehicle-to.js','04-repairs.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/js',file),'utf8'),context);
  for(const html of [context.renderVehicleToSection(0,0),context.renderRepairSection(0)]){assert.equal((html.match(/TEST CELL/g)||[]).length,1);assert.equal((html.match(/TEST INVOICE/g)||[]).length,1);assert.doesNotMatch(html,/<img|<script>/);}
});
test('all vehicle invoices appear inside Repairs and TO with no card-side binding even without work records',()=>{
  const db=fixture();db.repairs=[];db.vehicleTo=[];
  const context=vm.createContext({window:{tvsWeb:{}},RegistryImport:core,htmlEsc:escape,data:db,_loadWriteBlocked:false,_sync:{access:{readable:['savedReestrs'],writable:['savedReestrs']},platform:{negotiation:{writeCompatible:true}}},document:{addEventListener(){}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/public/vehicle-invoices.js'),'utf8'),context);const view=context.window.tvsWeb.vehicleInvoices;
  const html=view.vehicleHtml(0);assert.match(html,/Счета и расходы по автомобилю/);assert.doesNotMatch(html,/Привязать счёт|К ремонту|data-service-invoice/);assert.match(html,/50,00/);assert.match(html,/invoice=synthetic-register/);assert.doesNotMatch(html,/Ремонт \/ ТО не выбран/);assert.doesNotMatch(html,/<img/);
  db.savedReestrs=[];assert.match(view.vehicleHtml(0),/Счета и расходы по автомобилю/);assert.match(view.vehicleHtml(0),/после распределения/);
  context._sync.access.writable=[];assert.doesNotMatch(view.vehicleHtml(0),/Привязать счёт/);context._sync.access.readable=[];assert.doesNotMatch(view.vehicleHtml(0),/Счета ·|<table/);
});
test('the shared maintenance schedule includes invoice actions on vehicle rows and keeps generator columns aligned',()=>{
  const db=fixture();db.generators=[{id:'gen',name:'Synthetic DES'}];db.toRecords=[{id:'gen-to',generatorId:'gen',date:'2026-10-03'}];const main={innerHTML:''};
  const context=vm.createContext({window:{tvsWeb:{vehicleInvoices:{headingHtml:()=>'<th>TEST INVOICE</th>',cellHtml:()=>'<td>TEST CELL</td>'}}},data:db,document:{getElementById:()=>main},MONTHS_RU:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],MONTHS_SHORT:Array(12).fill('Month'),cmpDateAsc:()=>0,fmtDate:value=>value,htmlEsc:escape,htmlJs:value=>JSON.stringify(value)});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/js/20-to-schedule.js'),'utf8'),context);vm.runInContext('tssMonth=10;tssYear=2026;renderToScheduleSection();',context);
  assert.equal((main.innerHTML.match(/TEST CELL/g)||[]).length,1);assert.equal((main.innerHTML.match(/TEST INVOICE/g)||[]).length,1);const rows=[.../<tbody>([\s\S]*?)<\/tbody>/.exec(main.innerHTML)[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];assert.equal(rows.length,2);for(const row of rows)assert.equal((row[1].match(/<td[ >]/g)||[]).length,9);
});
test('browser scripts resolve invoice dependencies in the actual page order',()=>{
  const context=vm.createContext({document:{addEventListener(){}},htmlEsc:escape,data:fixture(),_loadWriteBlocked:false,_sync:{access:{readable:['savedReestrs'],writable:['savedReestrs']},platform:{negotiation:{writeCompatible:true}}}});vm.runInContext('window=globalThis;window.tvsWeb={};',context);
  for(const file of ['assets/core/registry-import.js','web/public/vehicle-invoices.js','assets/core/platform-contracts.js','assets/core/entity-identity.js','assets/core/decimal-core.js','assets/core/business-calendar.js','assets/core/document-state.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context,{filename:file});
  assert.match(context.tvsWeb.vehicleInvoices.cellHtml('repairs',context.data.repairs[0]),/Номер в записи/);assert.equal(context.tvsWeb.vehicleInvoices.open,undefined);assert.equal(context.tvsWeb.vehicleInvoices.commit,undefined);
});
test('distributed DES invoices display without creating or linking a maintenance record',()=>{
  const db=fixture();db.generators=[{id:'gen',name:'Synthetic DES'}];db.savedReestrs[0].rows[0]={...db.savedReestrs[0].rows[0],registryAllocationKind:'generator',generatorId:'gen'};delete db.savedReestrs[0].rows[0].vehicleId;
  const context=vm.createContext({window:{tvsWeb:{}},RegistryImport:core,htmlEsc:escape,data:db,_sync:{access:{readable:['savedReestrs']}}});vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/public/vehicle-invoices.js'),'utf8'),context);const html=context.window.tvsWeb.vehicleInvoices.generatorHtml('gen');assert.match(html,/Счета по ДЭС/);assert.match(html,/30,00/);assert.match(html,/invoice=synthetic-register/);assert.doesNotMatch(html,/Привязать|data-service-invoice/);
});
test('the car card mounts all invoices inside the Repairs and TO block and replaces separate service tiles',()=>{
  let panel=null,removed=0,updates=0;const grid={append:node=>panel=node,classList:{add(){}},querySelector:()=>({remove:()=>removed++})},main={querySelector:selector=>selector==='[data-vehicle-invoices]'?panel:selector==='.vd-journals-grid'?grid:null},context=vm.createContext({window:{tvsWeb:{}},RegistryImport:core,htmlEsc:escape,data:fixture(),_sync:{access:{readable:['savedReestrs']}},document:{getElementById:()=>main,createElement:()=>({setAttribute(){},set innerHTML(value){this.html=value;updates++;},get innerHTML(){return this.html;}})}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/public/vehicle-invoices.js'),'utf8'),context);context.window.tvsWeb.vehicleInvoices.mount(0);assert.match(panel.innerHTML,/Счета и расходы по автомобилю/);assert.match(panel.innerHTML,/50,00/);assert.equal(removed,2);context.window.tvsWeb.vehicleInvoices.mount(0);assert.equal(updates,1);
});
