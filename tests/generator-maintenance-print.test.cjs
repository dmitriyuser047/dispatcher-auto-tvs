'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const printing=require('../assets/core/generator-maintenance-print'),maintenance=require('../assets/core/generator-maintenance'),hash=require('../assets/core/request-fingerprint');
function database(){return {generatorMaintenancePlans:[{id:0,org:'Synthetic org',year:2027,title:'Synthetic annual schedule',status:'draft',revision:1,rootId:0,createdAt:'2026-10-24T10:00:00.000Z',updatedAt:'2026-10-24T10:00:00.000Z',rows:[{id:0,generatorId:0,site:'Object B',type:'ТО-1',plannedHours:250,plannedDate:'2027-03-01',work:'Replace filter',note:'',components:[{partId:0,qty:2}]},{id:'0',generatorId:'0',site:'Object A',type:'ТО-2',plannedHours:500,plannedDate:'2027-06-01',work:'Service',note:'',components:[{partId:'0',qty:5}]}],commission:{chairman:{name:'Synthetic chairman',position:'Engineer'},members:[{name:'Synthetic member',position:'Mechanic'}]}}],generators:[{id:0,name:'DES numeric',org:'Synthetic org',site:'Object B',hoursInit:0},{id:'0',name:'DES string',org:'Synthetic org',site:'Object A',hoursInit:0}],genRecords:[],parts:[{id:0,generatorId:0,name:'Filter',article:'FILTER-0',unit:'шт'},{id:'0',generatorId:'0',name:'Oil',article:'OIL-0',unit:'л'}],partMovements:[],appMeta:[]};}
function approved(){const db=database(),input={action:'approve',planId:0,date:'2026-10-24',document:'Synthetic decision № 1',reason:'Synthetic approval'},review=maintenance.preview(db,input,{today:'2026-10-24'});assert.equal(review.canApply,true);return {...db,...maintenance.apply(db,{...input,reviewFingerprint:review.fingerprint},{id:'test-approve',now:'2026-10-24T10:00:00Z',today:'2026-10-24',actor:{id:'test',name:'Test user',role:'admin'}}).sections};}

test('organizational draft contains both sites, typed DES, components, quantities, planned hours and commission lines',()=>{
 const db=database(),before=JSON.stringify(db),model=printing.prepare(db,0),html=printing.render(model);for(const text of ['ПРОЕКТ · НЕ УТВЕРЖДЁН','Synthetic org','Object A','Object B','DES numeric','DES string','FILTER-0','OIL-0','250','500','Synthetic chairman','Synthetic member','Председатель','Кол-во','Моточасы'])assert.ok(html.includes(text),text);assert.equal(model.snapshot.rows[0].generator.id,0);assert.equal(model.snapshot.rows[1].generator.id,'0');assert.equal(JSON.stringify(db),before);assert.ok(!html.includes('УТВЕРЖДЕНО</b>'));
});

test('approved print is byte-identical after current names, sites and parts are edited',()=>{
 const db=approved(),first=printing.render(printing.prepare(db,0));assert.ok(first.includes('УТВЕРЖДЕНО'));assert.ok(first.includes('Synthetic decision № 1'));assert.ok(!first.includes('НЕ УТВЕРЖДЁН'));db.generators[0].name='CHANGED';db.generators[0].site='OTHER';db.parts[0].name='CHANGED PART';db.parts[0].article='CHANGED ARTICLE';db.genRecords.push({id:'future',generatorId:0,date:'2027-01-01',meterEnd:20000});assert.equal(printing.render(printing.prepare(db,0)),first);
});

test('hostile source text is escaped and a corrupted approved snapshot cannot be printed',()=>{
 const db=database(),plan=db.generatorMaintenancePlans[0];plan.title='<img src=x onerror="bad()">';plan.commission.chairman.name='<script>bad()</script>';db.parts[0].name='<iframe src="bad">';let html=printing.render(printing.prepare(db,0));assert.ok(html.includes('&lt;img'));assert.ok(html.includes('&lt;script'));assert.ok(html.includes('&lt;iframe'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img src=x'));
 const frozen=structuredClone(approved());frozen.generatorMaintenancePlans[0].snapshot.rows[0].components[0].qty=99;assert.throws(()=>printing.prepare(frozen,0),{code:'MAINTENANCE_PRINT_SNAPSHOT'});
});

test('all source rights are needed, numeric zero is retained and ambiguous or cross-owned draft references fail',()=>{
 const db=database();assert.equal(printing.prepare(db,0).planId,0);assert.throws(()=>printing.prepare(db,'0'),{code:'MAINTENANCE_PRINT_SOURCE'});assert.throws(()=>printing.prepare(db,0,{readable:['generatorMaintenancePlans']}),{code:'ACCESS_DENIED'});db.parts[0].generatorId='0';assert.throws(()=>printing.prepare(db,0),{code:'MAINTENANCE_PRINT_OWNER'});db.parts[0].generatorId=0;db.generators.push({...db.generators[0]});assert.throws(()=>printing.prepare(db,0),{code:'MAINTENANCE_PRINT_REFERENCE'});
});

test('browser and CommonJS maintenance print produce identical escaped bytes without a renderer or clock',()=>{
 const ctx=vm.createContext({PlatformContracts:require('../assets/core/platform-contracts'),GeneratorMaintenance:maintenance,RequestFingerprint:hash});vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/core/generator-maintenance-print.js'),'utf8'),ctx);const db=approved();assert.equal(ctx.GeneratorMaintenancePrint.render(ctx.GeneratorMaintenancePrint.prepare(db,0)),printing.render(printing.prepare(db,0)));
});
