'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const fuel=require('../assets/core/fuel-engine.js'),decimal=require('../assets/core/decimal-core.js'),accounting=require('../assets/core/accounting-boundary.js'),periods=require('../assets/core/effective-periods.js'),policy=require('../assets/core/fuel-movement-policy.js'),sources=require('../assets/core/financial-recognition.js');
const copy=value=>JSON.parse(JSON.stringify(value)),read=file=>fs.readFileSync(path.join(__dirname,'../assets/js',file),'utf8');
const norm=(from='2026-09-01',value=2)=>({version:1,periods:[{id:'first',from,basis:'Synthetic confirmed curve',parameters:{power:100,norm:null,norm100:value,norm50:1,normIdle:0}}]});
function fixture(){return {vehicles:[],records:[],generators:[{id:0,name:'SYNTHETIC DATED DES',location:'Synthetic site',fuel:'diesel',fuelBalance:923.537,power:999,norm100:99,norm50:88,fuelNorms:norm()}],genRecords:[{id:'first',generatorId:0,date:'2026-09-10',hours:1,load:100,fuelIssued:0,tankId:null}],tanks:[],tankIncomes:[],fuelMovements:[]};}
function app(database=fixture()){
 const calls={alerts:[],books:[]},elements=new Map();
 function element(id=''){const node={id,value:'',dataset:{},style:{},readOnly:false,disabled:false,children:[],setAttribute(){},addEventListener(){},append(...nodes){this.children.push(...nodes);},dispatchEvent(event){if(typeof this['on'+event.type]==='function')this['on'+event.type](event);}};node.parentElement=node;return node;}
 const context=vm.createContext({console,data:copy(database),window:{},DecimalCore:decimal,AccountingBoundary:accounting,EffectivePeriods:periods,FuelMovementPolicy:policy,DomainSources:sources,TvsFuelEngine:fuel,_genBalCache:{},selectedVehicleId:7,editingRecordId:null,
  Event:class {constructor(type,options){this.type=type;this.bubbles=options?.bubbles;}},
  document:{getElementById(id){if(!elements.has(id))elements.set(id,element(id));return elements.get(id);},createElement:()=>element(),addEventListener(){}},
  dispatcherLocalDate:()=> '2026-09-30',gsmValidDate:fuel.gsmValidDate,cmpDateAsc:(a,b)=>String(a).localeCompare(String(b)),fmtDate:value=>value,parseDate:value=>/^\d{4}-\d{2}-\d{2}$/.test(value)?value:/^\d{2}\.\d{2}\.\d{4}$/.test(value)?value.split('.').reverse().join('-'):'',
  alert:message=>calls.alerts.push(message),precisionInput:(id,options)=>decimal.parseInput(elements.get(id).value,{scale:options.scale,blank:options.blank,nonNegative:true}),
  XLSX:{utils:{encode_cell:({r,c})=>r+','+c,encode_range:range=>JSON.stringify(range),book_new:()=>({}),book_append_sheet:(book,sheet)=>book.sheet=sheet},writeFile:book=>calls.books.push(book)},
 });
 vm.runInContext('function genRecsFor(id){return data.genRecords.filter(row=>row.generatorId===id);}function tanksAll(){return data.tanks;}',context);
 for(const file of ['29-fuel-quality.js','12-settings.js','16-generators.js'])vm.runInContext(read(file),context,{filename:file});
 return {context,calls,field:id=>context.document.getElementById(id),export:()=>context.exportGenWriteOffAct('2026-09-01','2026-09-30',{actDate:'2026-09-30',loc:'__ALL__'})};
}
function generatorRow(book){const row=Object.keys(book.sheet).find(key=>book.sheet[key]?.v==='SYNTHETIC DATED DES');assert.ok(row,'the actual worksheet must contain the selected generator');return Number(row.split(',')[0]);}

test('DES worksheet uses the selected historical curve in both normative columns and consumption, never current scalar parameters',()=>{
 const api=app(),before=JSON.stringify(api.context.data);api.export();assert.deepEqual(api.calls.alerts,[]);assert.equal(api.calls.books.length,1);
 const sheet=api.calls.books[0].sheet,row=generatorRow(api.calls.books[0]);assert.equal(sheet[row+',7'].v,2);assert.equal(sheet[row+',8'].v,1);assert.equal(sheet[row+',9'].v,2);assert.equal(sheet[row+',10'].v,2);assert.equal(sheet[row+',11'].v,921.537);assert.equal(JSON.stringify(api.context.data),before);
});

test('a multi-period DES worksheet names each effective curve span instead of displaying one current scalar norm',()=>{
 const db=fixture();db.generators[0].fuelNorms.periods.push({id:'second',from:'2026-09-15',basis:'Second synthetic confirmed curve',parameters:{power:100,norm:null,norm100:4,norm50:2,normIdle:0}});db.genRecords.push({id:'second',generatorId:0,date:'2026-09-20',hours:1,load:100,fuelIssued:0,tankId:null});
 const api=app(db);api.export();assert.deepEqual(api.calls.alerts,[]);const sheet=api.calls.books[0].sheet,row=generatorRow(api.calls.books[0]),full=String(sheet[row+',7'].v),half=String(sheet[row+',8'].v);
 for(const value of [full,half]){assert.match(value,/2026-09-01/);assert.match(value,/2026-09-14/);assert.match(value,/2026-09-15/);assert.match(value,/2026-09-30/);assert.doesNotMatch(value,/99|88/);}
 assert.match(full,/2/);assert.match(full,/4/);assert.match(half,/1/);assert.match(half,/2/);assert.equal(sheet[row+',9'].v,6);assert.equal(sheet[row+',10'].v,6);
});

test('DES unknown historical expenditure remains unknown in date balances, the current helper and act preflight',()=>{
 const db=fixture();db.generators[0].fuelNorms=norm('2026-10-01');const api=app(db),g=api.context.data.generators[0],balances=api.context.computeGenFuelBalances(0);
 assert.equal(balances.first,null);assert.equal(api.context.computeGenBalanceAt(0,'2026-09-30',true),null);assert.equal(api.context.fuelAccountingCurrentBalance('generators',g,api.context.data.genRecords,balances,'2026-09-30'),null);
 assert.equal(api.export(),false);assert.equal(api.calls.books.length,0);assert.match(api.calls.alerts[0],/без нормы|расхода/);
});

test('a linked zero-activity issue before the first norm preserves known generator stock and passes act preflight',()=>{
 const db=fixture();db.generators[0].fuelNorms=norm('2026-10-01');db.genRecords=[{id:'issue-only',generatorId:0,date:'2026-09-10',hours:0,fuelMovementId:'issue',fuelIssued:20,fuelActual:null,fuelUsed:null,tankId:null}];
 const api=app(db);assert.equal(api.context.computeGenBalanceAt(0,'2026-09-30',true),943.537);api.export();assert.equal(api.calls.books.length,1);assert.deepEqual(api.calls.alerts,[]);
});

test('numeric and string generator identities retain separate unknown and known cache results',()=>{
 const db=fixture();db.generators.push({...db.generators[0],id:'0'});db.generators[0].fuelNorms=norm('2026-10-01');db.genRecords.push({id:'text-record',generatorId:'0',date:'2026-09-10',hours:1,load:100,fuelActual:0,fuelIssued:0});
 const api=app(db);assert.equal(api.context.computeGenFuelBalances(0).first,null);assert.equal(api.context.computeGenFuelBalances('0')['text-record'],923.537);assert.equal(api.context.computeGenFuelBalances('0').first,undefined);
});

test('calendar dispatch recalculates automatic vehicle norms but preserves an explicitly stored zero',()=>{
 const db=fixture();db.vehicles=[{id:7,norm:99,fuelNorms:{version:1,periods:[{id:'sep',from:'2026-09-01',basis:'September',parameters:{norm:10,normCity:null,normHighway:null,normIdle:null}},{id:'oct',from:'2026-10-01',basis:'October',parameters:{norm:20,normCity:null,normHighway:null,normIdle:null}}]}}];
 const api=app(db);api.field('rec_date').value='10.09.2026';api.field('rec_km').value='100';api.context.prepareVehicleNormForm();api.context.calcFuelAuto();assert.equal(api.field('rec_fuel_used').value,'10');api.context.calY=2026;api.context.calM=9;api.context.calPick(10);assert.equal(api.field('rec_fuel_used').value,'20');
 api.context.data.records=[{id:0,vehicleId:7,fuelUsed:0}];api.context.editingRecordId=0;api.field('rec_fuel_used').value='0';api.context.prepareVehicleNormForm();api.context.calM=8;api.context.calPick(10);assert.equal(api.field('rec_fuel_used').value,'0');api.context.calcFuelAuto(true);assert.equal(api.field('rec_fuel_used').value,'10');
});

test('odometer calculations retain decimal thousandths and a real zero distance',()=>{
 const api=app();api.field('rec_odo_start').value='100.001';api.field('rec_km').value='0.002';api.context.calcOdoEnd();assert.equal(api.field('rec_odo_end').value,'100.003');api.field('rec_odo_end').value='100.001';api.context.calcKmFromOdo();assert.equal(api.field('rec_km').value,'0');
});
