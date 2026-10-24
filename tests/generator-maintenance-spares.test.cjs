'use strict';
// Frozen synthetic print snapshots only: no storage, live cards, clock or GUI.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const api=require('../assets/core/generator-maintenance-spares.js');
const clone=value=>JSON.parse(JSON.stringify(value));
const part=(id,generatorId,extra={})=>({id,generatorId,article:'FILTER-1',name:'Synthetic filter',unit:'шт',...extra});
const component=(partId,generatorId,qty,extra={})=>({partId,qty,part:part(partId,generatorId,extra)});
const row=(id,generatorId,components,extra={})=>({id,generatorId,site:'Synthetic site',type:'ТО-1',plannedDate:'2027-03-01',plannedHours:250,work:'Synthetic work',note:'',generator:{id:generatorId,name:'DES '+typeof generatorId+':'+String(generatorId),site:'Current card site is not a planning fallback',hours:100},components,...extra});
const snapshot=(rows,extra={})=>({version:1,org:'Synthetic organization',year:2027,title:'Synthetic plan',commission:{chairman:{name:'Synthetic chairman',position:'Engineer'},members:[]},rows,...extra});
function freeze(value){if(value&&typeof value==='object'){for(const nested of Object.values(value))freeze(nested);Object.freeze(value);}return value;}
function frozen(value){if(value&&typeof value==='object'){assert.ok(Object.isFrozen(value));for(const nested of Object.values(value))frozen(nested);}}

test('repeated TO rows sum the same physical position exactly and retain each source once',()=>{
 const source=snapshot([row('to-1',0,[component('filter',0,.1)]),row('to-2',0,[component('filter',0,.2)],{site:'Second site',type:'ТО-2',plannedDate:'2027-06-01'})]),before=JSON.stringify(source),result=api.project(source),generator=result.generators[0],item=generator.items[0];
 assert.equal(result.version,1);assert.equal(generator.id,0);assert.deepEqual(generator.sites,['Synthetic site','Second site']);assert.equal(generator.items.length,1);assert.equal(item.qtyDecimal,'0.3');assert.equal(item.qty,.3);assert.deepEqual(item.sources,[{rowId:'to-1',site:'Synthetic site',type:'ТО-1',plannedDate:'2027-03-01',qtyDecimal:'0.1'},{rowId:'to-2',site:'Second site',type:'ТО-2',plannedDate:'2027-06-01',qtyDecimal:'0.2'}]);assert.equal(result.organization[0].qtyDecimal,'0.3');assert.deepEqual(result.organization[0].positions,[{generatorId:0,partId:'filter'}]);assert.equal(JSON.stringify(source),before);
});

test('organization totals join only complete exact trimmed metadata and retain DES distribution',()=>{
 const source=snapshot([row(0,0,[component(0,0,2,{article:' FILTER-1 ',name:' Synthetic filter ',unit:' шт '})]),row('0','0',[component('0','0',3)])]),result=api.project(source),total=result.organization[0];
 assert.equal(result.generators.length,2);assert.equal(result.generators[0].id,0);assert.equal(result.generators[1].id,'0');assert.equal(result.organization.length,1);assert.equal(total.article,'FILTER-1');assert.equal(total.name,'Synthetic filter');assert.equal(total.unit,'шт');assert.equal(total.qtyDecimal,'5');assert.equal(total.qty,5);assert.deepEqual(total.generators,[{id:0,name:'DES number:0',qtyDecimal:'2',qty:2,partIds:[0]},{id:'0',name:'DES string:0',qtyDecimal:'3',qty:3,partIds:['0']}]);assert.deepEqual(total.positions,[{generatorId:0,partId:0},{generatorId:'0',partId:'0'}]);
});

test('different units and names are separate needs, with an explicit article conflict warning',()=>{
 const result=api.project(snapshot([row(0,0,[component('a',0,2)]),row('0','0',[component('b','0',3,{unit:'компл'}),component('c','0',4,{name:'Synthetic filter variant'})])]));
 assert.equal(result.organization.length,3);assert.deepEqual(result.organization.map(value=>[value.name,value.unit,value.qtyDecimal]),[['Synthetic filter','шт','2'],['Synthetic filter','компл','3'],['Synthetic filter variant','шт','4']]);assert.equal(result.warnings.filter(issue=>issue.code==='SPARES_ARTICLE_CONFLICT').length,1);assert.equal(result.warnings.find(issue=>issue.code==='SPARES_ARTICLE_CONFLICT').article,'FILTER-1');for(const field of ['total','grandTotal','qty','qtyDecimal'])assert.equal(Object.hasOwn(result,field),false);
});

test('blank article, name or unit never merge different positions or generators',()=>{
 for(const field of ['article','name','unit']){const blank={[field]:'   '},source=snapshot([row(0,0,[component(0,0,1,blank),component('0',0,2,blank)]),row('0','0',[component('other','0',3,blank)])]),result=api.project(source);assert.equal(result.organization.length,3,field);assert.deepEqual(result.organization.map(value=>value.qtyDecimal),['1','2','3']);assert.equal(result.generators[0].items.length,2);assert.deepEqual(result.organization.map(value=>value.positions),[[{generatorId:0,partId:0}],[{generatorId:0,partId:'0'}],[{generatorId:'0',partId:'other'}]]);}
 const repeated=api.project(snapshot([row(0,0,[component('no-article',0,.1,{article:''})]),row('0',0,[component('no-article',0,.2,{article:''})])]));assert.equal(repeated.organization.length,1);assert.equal(repeated.organization[0].qtyDecimal,'0.3');
});

test('a generator distribution combines matching articles in multiple distinct stock positions once',()=>{
 const result=api.project(snapshot([row(0,0,[component('a',0,.1),component('b',0,.2)]),row('0',0,[component('a',0,.3)])])),total=result.organization[0];
 assert.equal(result.generators[0].items.length,2);assert.equal(result.generators[0].items[0].qtyDecimal,'0.4');assert.equal(total.qtyDecimal,'0.6');assert.equal(total.generators.length,1);assert.equal(total.generators[0].qtyDecimal,'0.6');assert.deepEqual(total.generators[0].partIds,['a','b']);assert.equal(total.positions.length,2);
});

test('seeded repeated schedules conserve integer milliquantity demand in every item and organization distribution',()=>{
 const ids=[0,'0','third'],rows=[],expectedParts=new Map(),expectedGroups=new Map(),expectedDistribution=new Map();
 const exact=units=>{const whole=units/1000n,fraction=String(units%1000n).padStart(3,'0').replace(/0+$/,'');return String(whole)+(fraction?'.'+fraction:'');};
 const sum=(map,key,units)=>map.set(key,(map.get(key)||0n)+units);
 for(let index=0;index<240;index++){
  const generatorIndex=index%3,generatorId=ids[generatorIndex],kind=index%4,partId='position-'+generatorIndex+'-'+kind,units=BigInt((index*73+1)%1000),metadata={article:'ART-'+kind,name:'Synthetic item '+kind,unit:kind%2?'л':'шт'};
  rows.push(row(index,generatorId,[component(partId,generatorId,Number(units)/1000,metadata)],{site:'Site '+index%4}));sum(expectedParts,partId,units);sum(expectedGroups,metadata.article,units);sum(expectedDistribution,JSON.stringify([metadata.article,typeof generatorId,generatorId]),units);
 }
 const result=api.project(snapshot(rows));let sourceCount=0;
 for(const generator of result.generators)for(const item of generator.items){assert.equal(item.qtyDecimal,exact(expectedParts.get(item.partId)));assert.equal(item.qty,Number(exact(expectedParts.get(item.partId))));sourceCount+=item.sources.length;}
 assert.equal(sourceCount,240);assert.equal(result.organization.length,4);
 for(const group of result.organization){assert.equal(group.qtyDecimal,exact(expectedGroups.get(group.article)));assert.equal(group.generators.length,3);for(const generator of group.generators)assert.equal(generator.qtyDecimal,exact(expectedDistribution.get(JSON.stringify([group.article,typeof generator.id,generator.id]))));}
});

test('unknown quantities propagate through item, organization and affected distribution without inventing zero',()=>{
 const result=api.project(snapshot([row(0,0,[component('a',0,2)]),row('0',0,[component('a',0,null)]),row('other','0',[component('b','0',3)])])),item=result.generators[0].items[0],total=result.organization[0];
 assert.equal(item.qtyDecimal,null);assert.equal(item.qty,null);assert.equal(item.sources[0].qtyDecimal,'2');assert.equal(item.sources[1].qtyDecimal,null);assert.equal(total.qtyDecimal,null);assert.equal(total.qty,null);assert.equal(total.generators[0].qtyDecimal,null);assert.equal(total.generators[1].qtyDecimal,'3');assert.equal(total.generators[1].qty,3);assert.ok(result.warnings.some(issue=>issue.code==='SPARES_QUANTITY_UNKNOWN'&&issue.rowId==='0'&&issue.generatorId===0&&issue.partId==='a'));
});

test('explicit draft zero stays a known zero and an empty component list invents no demand',()=>{
 const result=api.project(snapshot([row(0,0,[component('a',0,0)]),row('0','0',[],{site:''})]));assert.equal(result.generators.length,2);assert.equal(result.generators[0].items[0].qtyDecimal,'0');assert.equal(result.generators[0].items[0].qty,0);assert.equal(result.organization[0].qty,0);assert.deepEqual(result.generators[1].items,[]);assert.deepEqual(result.generators[1].sites,['']);assert.ok(!result.warnings.some(issue=>issue.code==='SPARES_QUANTITY_UNKNOWN'));
 const empty=api.project(snapshot([]));assert.deepEqual(empty.generators,[]);assert.deepEqual(empty.organization,[]);
});

test('strict numeric facts reject strings, booleans, negatives, nonfinite values and omitted quantities',()=>{
 for(const value of ['0.1','0x10','',true,false,-.1,Infinity,-Infinity,NaN,undefined]){const source=snapshot([row(0,0,[component('a',0,value)])]);assert.throws(()=>api.project(source),undefined,String(value));}
 const exact=api.project(snapshot([row(0,0,[component('a',0,.0000001)]),row('0',0,[component('a',0,.0000002)])]));assert.equal(exact.organization[0].qtyDecimal,'0.0000003');assert.equal(exact.organization[0].qty,.0000003);
});

test('large exact sums retain their decimal string when an ordinary number cannot represent the result',()=>{
 const source=snapshot([row(0,0,[component('a',0,1000000000000000)]),row('0',0,[component('a',0,.01)])]),result=api.project(source),item=result.generators[0].items[0],total=result.organization[0];
 assert.equal(item.qtyDecimal,'1000000000000000.01');assert.equal(item.qty,null);assert.equal(total.qtyDecimal,'1000000000000000.01');assert.equal(total.qty,null);assert.equal(total.generators[0].qtyDecimal,'1000000000000000.01');assert.equal(total.generators[0].qty,null);assert.ok(result.warnings.some(issue=>issue.code==='SPARES_TOTAL_NUMBER_RANGE'));assert.ok(!result.warnings.some(issue=>issue.code==='SPARES_QUANTITY_UNKNOWN'));
 const overflow=api.project(snapshot([row(0,0,[component('a',0,1e308)]),row('0',0,[component('a',0,1e308)])]));assert.equal(overflow.organization[0].qtyDecimal,'2'+'0'.repeat(308));assert.equal(overflow.organization[0].qty,null);assert.ok(overflow.warnings.some(issue=>issue.code==='SPARES_TOTAL_NUMBER_RANGE'));
});

test('case and interior whitespace are not silently normalized into matching organization articles',()=>{
 const result=api.project(snapshot([row(0,0,[component('a',0,1,{article:'Part-A'})]),row('0','0',[component('b','0',2,{article:'part-a'}),component('c','0',3,{article:'Part- A'})])]));assert.equal(result.organization.length,3);assert.deepEqual(result.organization.map(value=>value.article),['Part-A','part-a','Part- A']);
});

test('duplicate row or component clones and contradictory source identities fail closed',()=>{
 const original=row(0,0,[component('a',0,1)]);assert.throws(()=>api.project(snapshot([original,clone(original)])),{code:'SPARES_SNAPSHOT_ROW_DUPLICATE'});
 const duplicate=clone(original);duplicate.components.push(clone(duplicate.components[0]));assert.throws(()=>api.project(snapshot([duplicate])),{code:'SPARES_SNAPSHOT_PART_DUPLICATE'});
 const generatorConflict=clone(original);generatorConflict.generator.id='0';assert.throws(()=>api.project(snapshot([generatorConflict])),{code:'SPARES_SNAPSHOT_BINDING'});
 const ownerConflict=clone(original);ownerConflict.components[0].part.generatorId='0';assert.throws(()=>api.project(snapshot([ownerConflict])),{code:'SPARES_SNAPSHOT_BINDING'});
 const partConflict=clone(original);partConflict.components[0].part.id='other';assert.throws(()=>api.project(snapshot([partConflict])),{code:'SPARES_SNAPSHOT_BINDING'});
 const changed=row('0',0,[component('a',0,1,{unit:'л'})]);assert.throws(()=>api.project(snapshot([original,changed])),{code:'SPARES_SNAPSHOT_PART_CONFLICT'});
 const wrongGenerator=row('0',0,[component('b',0,1)]);wrongGenerator.generator.name='Contradictory DES label';assert.throws(()=>api.project(snapshot([original,wrongGenerator])),{code:'SPARES_SNAPSHOT_GENERATOR_CONFLICT'});
 const duplicateGlobal=row('0','0',[component('a','0',1)]);assert.throws(()=>api.project(snapshot([original,duplicateGlobal])),{code:'SPARES_SNAPSHOT_BINDING'});
});

test('projection accepts frozen snapshots, owns all output and keeps literal hostile labels as inert data',()=>{
 const hostile='<img src=x onerror="bad()"> & synthetic',source=freeze(snapshot([row(0,0,[component('a',0,2,{article:hostile,name:hostile,unit:'шт'})],{generator:{id:0,name:hostile,hours:null},site:hostile})],{approval:{date:'2026-10-24',document:hostile},fingerprint:'Synthetic unchanged source evidence'})),before=JSON.stringify(source),result=api.project(source);
 assert.equal(JSON.stringify(source),before);assert.equal(result.generators[0].name,hostile);assert.equal(result.generators[0].sites[0],hostile);assert.equal(result.organization[0].name,hostile);assert.equal(result.organization[0].article,hostile);frozen(result);assert.throws(()=>result.generators[0].items[0].sources.push({}));assert.throws(()=>result.organization[0].qty=999);assert.equal(JSON.stringify(api.project(source)),JSON.stringify(result));
});

test('source accessors, hidden hooks, symbols, cycles and sparse lists never execute during projection',()=>{
 let reads=0;const base=()=>snapshot([row(0,0,[component('a',0,1)])]);
 for(const mutate of [value=>Object.defineProperty(value.rows[0].components[0],'qty',{enumerable:true,get(){reads++;return 1;}}),value=>Object.defineProperty(value,'toJSON',{value(){reads++;return base();},enumerable:false}),value=>value.rows[Symbol('secret')]='hidden',value=>value.rows=new Array(1),value=>value.rows[0].components=new Array(1),value=>value.self=value,value=>Object.defineProperty(value.rows,'0',{enumerable:true,get(){reads++;return row(0,0,[]);}})]){const source=base();mutate(source);assert.throws(()=>api.project(source));}assert.equal(reads,0);
});

test('only prepared version-one snapshot shapes are admitted',()=>{
 for(const source of [null,[],{},snapshot([],{version:2}),snapshot([],{rows:{}})])assert.throws(()=>api.project(source));
 const absent= snapshot([row(0,0,[])]);delete absent.rows[0].generator;assert.throws(()=>api.project(absent));
 const textQuantity=snapshot([row(0,0,[component('a',0,1)])]);textQuantity.rows[0].components[0].part.unit=null;assert.throws(()=>api.project(textQuantity));
});

test('the browser foundation returns identical projection bytes with no database, renderer or clock capability',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../assets/core/generator-maintenance-spares.js'),'utf8'),context=vm.createContext({PlatformContracts:require('../assets/core/platform-contracts.js'),DecimalCore:require('../assets/core/decimal-core.js')});
 for(const name of ['data','window','document','localStorage','fetch','InventoryStock','GeneratorMaintenance','GeneratorMaintenancePrint'])Object.defineProperty(context,name,{get(){throw Error('Unexpected external capability '+name);}});
 vm.runInContext(source,context,{filename:'generator-maintenance-spares.js'});const input=snapshot([row(0,0,[component('a',0,.1)]),row('0','0',[component('b','0',.2)])]);assert.equal(context.GeneratorMaintenanceSpares.apiVersion,1);assert.equal(JSON.stringify(context.GeneratorMaintenanceSpares.project(input)),JSON.stringify(api.project(input)));
});
