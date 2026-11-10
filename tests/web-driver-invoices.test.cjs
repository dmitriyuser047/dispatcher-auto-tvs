'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const core=require('../assets/core/registry-import.js'),escape=require('../web/pages.cjs').escape;
function data(){return {drivers:[{id:0,name:'Synthetic driver'},{id:'0',name:'Another driver'}],savedReestrs:[{id:'reg',kind:'payment-registry',registryVersion:1,number:'12',rows:[{id:'part1',registryInvoiceId:'invoice-1',registryInvoiceSum:100,registryAllocationKind:'driver',registryExpenseType:'training',driverId:0,sum:40,invoiceNo:'SYNTHETIC-001',supplier:'<img src=x>',description:'Synthetic training'},{id:'part2',registryInvoiceId:'invoice-1',registryInvoiceSum:100,registryAllocationKind:'driver',registryExpenseType:'training',driverId:0,sum:60,invoiceNo:'SYNTHETIC-001',supplier:'<img src=x>',description:'Synthetic training'}]}]};}
test('driver card displays linked invoices, deduplicates parts, escapes source text and removes revoked content',()=>{
  let panel=null,updates=0;const workspace={querySelector:()=>panel,append:node=>panel=node},main={querySelector:()=>workspace};
  const context=vm.createContext({window:{tvsWeb:{}},RegistryImport:core,RegistryAccounting:require('../assets/core/registry-accounting.js'),htmlEsc:escape,data:data(),_sync:{access:{readable:['savedReestrs'],writable:['savedReestrs']}},document:{getElementById:()=>main,createElement:()=>({dataset:{},set innerHTML(value){this.html=value;updates++;},get innerHTML(){return this.html;},remove(){panel=null;}})}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/public/driver-invoices.js'),'utf8'),context);const view=context.window.tvsWeb.driverInvoices;
  view.mount(0);assert.match(panel.innerHTML,/Учтённые счета · 1/);assert.match(panel.innerHTML,/SYNTHETIC-001/);assert.match(panel.innerHTML,/100,00/);assert.match(panel.innerHTML,/invoice=invoice-1/);assert.doesNotMatch(panel.innerHTML,/<img/);assert.match(panel.innerHTML,/&lt;img/);
  view.mount(0);assert.equal(updates,1);view.mount('0');assert.match(panel.innerHTML,/Учтённые счета · 0/);
  context._sync.access.readable=[];view.mount(0);assert.equal(panel,null);
});
test('the invoice driver field binds the whole invoice and preserves split amounts',()=>{
  const confirmed={checked:true},form={elements:{confirmed}},nodes=new Map(),node={querySelector:selector=>{if(!nodes.has(selector))nodes.set(selector,{value:'',innerHTML:'',open:true});return nodes.get(selector);},querySelectorAll:()=>[]};
  const context=vm.createContext({window:{tvsWeb:{},addEventListener(){}},RegistryImport:core,RegistryAccounting:require('../assets/core/registry-accounting.js'),htmlEsc:escape,data:data(),URLSearchParams,location:{search:''},document:{addEventListener(){},querySelector:selector=>selector==='[data-registry-editor]'?form:null,querySelectorAll:()=>[]}});
  const source=fs.readFileSync(path.join(__dirname,'../web/public/registries.js'),'utf8');vm.runInContext(source.replace('web.registries={render};','web.registries={render,bindInvoice,tabs};'),context);
  const invoice={sum:100,allocations:[{kind:'unassigned',assetId:null,sum:40},{kind:'other',assetId:null,sum:60}]},draft={invoices:[invoice],confirmed:true,dirty:false};context.window.tvsWeb.registries.bindInvoice(draft,0,node);
  node.querySelector('[data-invoice-driver]').onchange({target:{value:core.typed(0)}});assert.equal(invoice.driverId,0);assert.ok(invoice.allocations.every(part=>part.kind==='driver'&&part.assetId===0));assert.deepEqual(invoice.allocations.map(part=>part.sum),[40,60]);assert.equal(confirmed.checked,false);
  node.querySelector('[data-invoice-type]').onchange({target:{value:'clothing'}});assert.ok(invoice.allocations.every(part=>part.expenseType==='clothing'));
  assert.doesNotMatch(context.window.tvsWeb.registries.tabs(),/Расходы на водителей|Расходы водителя/);
});
