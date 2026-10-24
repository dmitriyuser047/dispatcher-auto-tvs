'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const spares=require('../assets/core/generator-spares'),schema=require('../assets/core/platform-schema'),stock=require('../assets/core/inventory-stock'),scope=require('../assets/core/access-scope'),policy=require('../assets/core/access-policy'),periods=require('../assets/core/period-policy'),merge=require('../assets/core/catalog-merge');
const clone=structuredClone,db=(extra={})=>({...Object.fromEntries(schema.sections.map(name=>[name,[]])),generators:[{id:0,name:'G numeric',org:'A',site:'N'},{id:'0',name:'G text',org:'B',site:'S'},{id:'g',name:'Unique',org:'A',site:'N'}],...extra});
const part={id:'owned',generatorId:'g',name:'Filter',article:'F',unit:'шт',kind:'part',minStock:1};
function allowed(database,name,row){const resolver=scope.createResolver(database);return policy.permits({version:1,grants:[{org:'A',site:{any:true}}]},name,'read',row,{readable:schema.sections,writable:schema.sections,resolve:(name,row)=>resolver.resolve(name,row)});}

test('separate stock cards retain typed owners and InventoryStock counts each physical quantity once',()=>{
 const before=db(),after=db({parts:[{...part,id:0,generatorId:0},{...part,id:'0',generatorId:'0'},{...part,id:'common'}],partMovements:[{id:'n',partId:0,kind:'receipt',date:'2026-10-01',qty:2},{id:'s',partId:'0',kind:'receipt',date:'2026-10-01',qty:7},{id:'c',partId:'common',kind:'receipt',date:'2026-10-01',qty:11}]});delete after.parts[2].generatorId;
 assert.equal(spares.validateChanges(before,after),true);const result=stock.project(after);assert.equal(result.rows.find(row=>row.target.id===0).balance,2);assert.equal(result.rows.find(row=>row.target.id==='0').balance,7);assert.equal(result.rows.find(row=>row.target.id==='common').balance,11);assert.equal(result.rows.reduce((sum,row)=>sum+row.balance,0),20);
});

test('used common and owned positions cannot be relabelled, including zero net and cancelled history',()=>{
 for(const generatorId of [undefined,0,'0']){const p={...part};if(generatorId===undefined)delete p.generatorId;else p.generatorId=generatorId;const before=db({parts:[p],partMovements:[{id:0,partId:p.id,kind:'receipt',date:'2026-10-01',qty:1,cancelled:true}]});for(const owner of [undefined,0,'0','g']){if(owner===generatorId)continue;const changed={...p};if(owner===undefined)delete changed.generatorId;else changed.generatorId=owner;assert.throws(()=>spares.validateChanges(before,{...before,parts:[changed]}),{code:'SPARES_OWNER_LOCKED'});}}
});

test('empty stock positions can be assigned explicitly but approved schedule references lock ownership',()=>{
 const before=db({parts:[{...part,generatorId:0}]}),after={...before,parts:[part]};assert.equal(spares.validateChanges(before,after),true);before.generatorMaintenancePlans=[{id:'plan',status:'approved',rows:[{generatorId:0,components:[{partId:part.id,qty:2}]}]}];assert.throws(()=>spares.validateChanges(before,after),{code:'SPARES_OWNER_LOCKED'});
 for(const owner of [null,'missing'])assert.throws(()=>spares.validateChanges(db(),db({parts:[{...part,generatorId:owner}]})),{code:'SPARES_OWNER'});
});

test('consumption target and work order must match the owned generator; ambiguous textual identities fail closed',()=>{
 const before=db({parts:[part]}),issue={id:'out',partId:part.id,kind:'issue',qty:1,date:'2026-10-02',assetRef:'g:g'};assert.equal(spares.validateChanges(before,{...before,partMovements:[issue]}),true);
 for(const assetRef of ['','g:0','v:g'])assert.throws(()=>spares.validateChanges(before,{...before,partMovements:[{...issue,assetRef}]}),{code:'SPARES_TARGET'});
 const wrong={...before,workOrders:[{id:0,assetRef:'g:0',status:'approved'}]};assert.throws(()=>spares.validateChanges(wrong,{...wrong,partMovements:[{...issue,workOrderId:0}]}),{code:'SPARES_TARGET'});
 const ambiguous=db({parts:[{...part,generatorId:0}]});assert.throws(()=>spares.validateChanges(ambiguous,{...ambiguous,partMovements:[{...issue,assetRef:'g:0'}]}),{code:'SPARES_TARGET'});
});

test('owner scope takes precedence over forged saved labels and snapshots in stock, movements and procurement',()=>{
 const database=db({parts:[{...part,id:0,generatorId:0},{...part,id:'0',generatorId:'0',org:'A',scopeSnapshot:{version:1,complete:true,owners:[{org:'A',site:'N'}]}}]});assert.equal(allowed(database,'parts',database.parts[0]),true);assert.equal(allowed(database,'parts',database.parts[1]),false);
 for(const name of ['partMovements','procurementOrders','procurementRules']){const row=name==='partMovements'?{id:0,partId:'0',org:'A'}:{id:0,kind:'part',itemId:'0',org:'A'};assert.equal(allowed(database,name,row),false,name);}
 const plan={id:0,org:'A',rows:[{generatorId:0,site:'N',components:[{partId:0}]}]};assert.equal(allowed(database,'generatorMaintenancePlans',plan),true);plan.rows.push({generatorId:'0',site:'S',components:[{partId:'0'}]});assert.equal(allowed(database,'generatorMaintenancePlans',plan),false);
});

test('catalog merge refuses cross-owner stock even when both positions are empty',()=>{
 const database=db({parts:[part,{...part,id:'other',generatorId:0}]}),input={section:'parts',sourceId:part.id,targetId:'other',reason:'Synthetic review',mutableRefs:[]};const result=merge.preview(database,input,{today:'2026-10-24'});assert.equal(result.canMerge,false);assert.ok(result.blockers.some(issue=>issue.code==='INCOMPATIBLE_STOCK_OWNER'));
});

test('ambiguous owned stock cannot fall back to caller-supplied labels or a forged scope snapshot',()=>{
 const database=db({parts:[{...part,id:'dup',generatorId:'0'},{...part,id:'dup',generatorId:'0'}]});
 for(const name of ['partMovements','procurementOrders','procurementRules']){const row={id:0,org:'A',site:'N',scopeSnapshot:{version:1,complete:true,owners:[{org:'A',site:'N'}]},...(name==='partMovements'?{partId:'dup'}:{kind:'part',itemId:'dup'})};assert.equal(allowed(database,name,row),false,name);}
});

test('closed stock retains generator ownership while labels and future receipts remain independent',()=>{
 const before=db({parts:[part],partMovements:[{id:'r',partId:part.id,kind:'receipt',date:'2026-09-10',qty:5}],fuelPeriods:[{month:'2026-09',stockClosed:true}]});assert.throws(()=>periods.validateChanges(before,{...before,parts:[{...part,generatorId:0}]}));assert.equal(periods.validateChanges(before,{...before,parts:[{...part,name:'Renamed'}]}),true);assert.equal(spares.validateChanges(before,clone(before)),true);
});

test('stock ownership validation rejects executable section and row properties without invoking them',()=>{
 let reads=0;const value=db();Object.defineProperty(value,'parts',{get(){reads++;return [];}});assert.throws(()=>spares.validateChanges(db(),value));assert.equal(reads,0);const list=[];Object.defineProperty(list,'0',{get(){reads++;return part;}});list.length=1;assert.throws(()=>spares.validateChanges(db(),db({parts:list})));assert.equal(reads,0);
});
