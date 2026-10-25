'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const spares=require('../assets/core/generator-spares.js'),stock=require('../assets/core/inventory-stock.js'),schema=require('../assets/core/platform-schema.js'),kernel=require('../assets/core/platform-kernel.js'),workflow=require('../assets/core/workflow-validation.js');
const context={today:'2026-10-25',now:'2026-10-25T12:00:00.000Z'},target={generatorId:0,partId:0};
const part={id:0,generatorId:0,name:'SYNTHETIC NUMBER FILTER',article:'N0',unit:'шт',minStock:0};
function database(extra={}){return {...Object.fromEntries(schema.sections.map(name=>[name,[]])),generators:[{id:0,name:'SYNTHETIC NUMBER DES'},{id:'0',name:'SYNTHETIC STRING DES'}],parts:[{...part},{...part,id:'0',generatorId:'0',name:'SYNTHETIC STRING FILTER'}],...extra};}
function balanced(extra={}){return database({partMovements:[{id:'in',partId:0,date:'2026-10-01',kind:'receipt',qty:3},{id:'out',partId:0,date:'2026-10-02',kind:'issue',qty:3,assetRef:'g:0'}],...extra});}
function preview(db,action,selected=target){return spares.previewLifecycle(db,{...selected,action},context);}
function state(db,selected=target){return spares.lifecycleState(db,selected,context);}
function changed(db,action,selected=target){const result=preview(db,action,selected);assert.equal(result.canApply,true,JSON.stringify(result.state));return {...db,parts:result.parts};}

test('unused positions are deletable with typed zero preserved and no mutation before canonical persistence',()=>{
 const db=database(),before=JSON.stringify(db),result=preview(db,'delete');assert.equal(result.canApply,true);assert.equal(result.state.balanceDecimal,'0');assert.deepEqual(result.parts.map(row=>[typeof row.id,row.id]),[['string','0']]);assert.equal(JSON.stringify(db),before);assert.equal(spares.validateChanges(db,{...db,parts:result.parts},context),true);
 const text=preview(db,'delete',{generatorId:'0',partId:'0'});assert.deepEqual(text.parts.map(row=>[typeof row.id,row.id]),[['number',0]]);
 assert.throws(()=>state(db,{generatorId:'0',partId:0}),{code:'SPARES_TARGET'});
 const nested=database({parts:[{...part,metadata:{labels:['ORIGINAL']}}]}),copy=preview(nested,'archive');copy.parts[0].metadata.labels[0]='OUTPUT ONLY';assert.equal(nested.parts[0].metadata.labels[0],'ORIGINAL');
});

test('cancelled and zero-net movement history always blocks permanent deletion',()=>{
 for(const db of [balanced(),database({partMovements:[{id:'cancelled',partId:0,kind:'receipt',date:'2026-10-01',qty:1,cancelled:true}]})]){
  assert.equal(state(db).canDelete,false);assert.equal(preview(db,'delete').canApply,false);assert.throws(()=>spares.validateChanges(db,{...db,parts:db.parts.filter(row=>row.id!==0)},context),{code:'SPARES_DELETE_BLOCKED'});
  assert.throws(()=>spares.validateChanges(db,{...db,parts:db.parts.filter(row=>row.id!==0),partMovements:[]},context),{code:'SPARES_DELETE_BLOCKED'});
 }
});

test('references in draft and approved schedules, snapshots, procurement, orders and draft payloads block deletion',()=>{
 const sources=[
  ['generatorMaintenancePlans',{id:'draft',status:'draft',rows:[{generatorId:0,components:[{partId:0,qty:1}]}]}],
  ['generatorMaintenancePlans',{id:'approved',status:'approved',rows:[],snapshot:{rows:[{components:[{part:{id:0,name:'FROZEN'}}]}]}}],
  ['documentDrafts',{id:'draft',status:'draft',section:'partMovements',payload:{partId:0}}],
  ['documentDrafts',{id:'dispatch-draft',status:'discarded',section:'dispatchJobs',payload:{partRequirements:[{partId:0,qty:1}]}}],
  ['dispatchJobs',{id:'job',status:'new',partRequirements:[{partId:0,qty:1}]}],
  ['workOrders',{id:'order',status:'accepted',snapshot:{materials:[{partId:0}]}}],
  ['procurementOrders',{id:'po',kind:'part',itemId:0,status:'cancelled'}],
  ['procurementRules',{id:'rule',kind:'part',itemId:0}],
  ['costProfiles',{id:'cost',target:{section:'parts',id:0}}],
  ['savedReestrs',{id:'saved',snapshot:{parts:[{id:0,name:'SAVED'}]}}],
  ['parts',{id:'alias',generatorId:0,name:'OLD',mergedInto:{section:'parts',id:0},archived:true}],
 ];
 for(const [section,row]of sources){const db=database();db[section].push(row);assert.equal(state(db).canDelete,false,section);const next={...db,parts:db.parts.filter(row=>row.id!==0),[section]:section==='parts'?db.parts.filter(row=>row.id!==0&&row.id!=='alias'):[]};assert.throws(()=>spares.validateChanges(db,next,context),{code:'SPARES_DELETE_BLOCKED'},section);}
 const db=database({procurementOrders:[{id:'not-parts',kind:'tank',itemId:0}]});assert.equal(state(db).canDelete,true);
});

test('zero-stock history and approved snapshots archive and restore without changing their bytes or stock',()=>{
 const db=balanced({generatorMaintenancePlans:[{id:'approved',status:'approved',rows:[{generatorId:0,components:[{partId:0,qty:3}]}],snapshot:{rows:[{components:[{part:{id:0,name:'FROZEN'},qty:3}]}]}}]}),before=JSON.stringify([db.partMovements,db.generatorMaintenancePlans]);
 const archived=changed(db,'archive');assert.equal(archived.parts[0].archived,true);assert.equal(archived.parts[0].archivedAt,context.now);assert.equal(spares.validateChanges(db,archived,context),true);assert.equal(stock.project(archived,{partIds:[0]}).rows[0].balance,0);assert.equal(JSON.stringify([archived.partMovements,archived.generatorMaintenancePlans]),before);
 const restored=changed(archived,'restore');assert.equal(restored.parts[0].archived,false);assert.equal(Object.hasOwn(restored.parts[0],'archivedAt'),false);assert.equal(spares.validateChanges(archived,restored,context),true);assert.equal(JSON.stringify([restored.partMovements,restored.generatorMaintenancePlans]),before);assert.equal(state(archived).canDelete,false);
});

test('nonzero, unknown, negative-history and future stock block archives without treating missing quantities as zero',()=>{
 const movement={id:'r',partId:0,date:'2026-10-01',kind:'receipt',qty:3};
 const sources=[
  [movement],
  [{...movement,qty:null}],
  [{...movement,kind:'issue',assetRef:'g:0'},{...movement,id:'late',date:'2026-10-02'}],
  [{...movement,date:'2026-11-01'}],
  [movement,{...movement,id:'future-out',date:'2026-11-01',kind:'issue',assetRef:'g:0'}],
 ];
 for(const movements of sources){const db=database({partMovements:movements});assert.equal(state(db).canArchive,false,JSON.stringify(movements));assert.throws(()=>spares.validateChanges(db,{...db,parts:db.parts.map(row=>row.id===0?{...row,archived:true}:row)},context),{code:'SPARES_ARCHIVE_BLOCKED'});}
});

test('active references require completion before archiving while their terminal history can be retained',()=>{
 for(const [section,row]of [
  ['generatorMaintenancePlans',{id:'p',status:'draft',rows:[{components:[{partId:0}]}]}],
  ['documentDrafts',{id:'d',status:'draft',payload:{partId:0}}],
  ['procurementOrders',{id:'po',kind:'part',itemId:0,status:'ordered'}],
  ['procurementRules',{id:'rule',kind:'part',itemId:0}],
  ['workOrders',{id:'order',status:'repairing',materials:[{partId:0}]}],
  ['dispatchJobs',{id:'job',status:'started',partRequirements:[{partId:0}]}],
 ]){const db=database({[section]:[row]});assert.equal(state(db).canArchive,false,section);assert.equal(preview(db,'archive').canApply,false);}
 const db=database({documentDrafts:[{id:'d',status:'posted',payload:{partId:0}}],procurementOrders:[{id:'po',kind:'part',itemId:0,status:'received'}]});assert.equal(state(db).canArchive,true);assert.equal(spares.validateChanges(db,changed(db,'archive'),context),true);
});

test('initial quantities and retained valuation policies cannot be erased by delete or archive requests',()=>{
 for(const value of [null,'invalid',1]){const db=database({parts:[{...part,balanceInit:value}]});assert.equal(state(db).canDelete,false);assert.equal(state(db).canArchive,false);}
 for(const qty of [null,1]){const db=database({parts:[{...part,costValuation:{opening:{qty,amount:null}}}]});assert.equal(state(db).canDelete,false);assert.equal(state(db).canArchive,false);}
 const db=database({parts:[{...part,costValuation:{opening:{qty:0,amount:null},basis:'SYNTHETIC ZERO POLICY'}}]});assert.equal(state(db).canDelete,false);assert.equal(state(db).canArchive,true);assert.equal(spares.validateChanges(db,changed(db,'archive'),context),true);
});

test('archive cannot rewrite linked evidence, other card fields or manufacture a zero by changing stock in the same transaction',()=>{
 const db=balanced(),next=changed(db,'archive');assert.throws(()=>spares.validateChanges(db,{...next,partMovements:[]},context),{code:'SPARES_HISTORY_LOCKED'});
 assert.throws(()=>spares.validateChanges(db,{...next,parts:next.parts.map(row=>row.id===0?{...row,name:'FORGED RENAME'}:row)},context),{code:'SPARES_LIFECYCLE_FIELDS'});
 const nonzero=database({partMovements:[db.partMovements[0]]});assert.throws(()=>spares.validateChanges(nonzero,{...nonzero,parts:nonzero.parts.map(row=>row.id===0?{...row,archived:true}:row),partMovements:[]},context),{code:'SPARES_ARCHIVE_BLOCKED'});
 const empty=database(),introduced={...changed(empty,'archive'),documentDrafts:[{id:'new',status:'draft',payload:{partId:0}}]};assert.throws(()=>spares.validateChanges(empty,introduced,context),{code:'SPARES_ARCHIVE_BLOCKED'});
});

test('old archived movement facts stay untouched but new or changed stock requires restoring the position',()=>{
 const db=changed(balanced(),'archive');assert.equal(spares.validateChanges(db,structuredClone(db),context),true);
 assert.throws(()=>spares.validateChanges(db,{...db,partMovements:[...db.partMovements,{id:'new',partId:0,date:'2026-10-25',kind:'receipt',qty:1}]},context),{code:'SPARES_ARCHIVED'});
 assert.throws(()=>spares.validateChanges(db,{...db,partMovements:db.partMovements.map(row=>row.id==='in'?{...row,note:'changed'}:row)},context),{code:'SPARES_ARCHIVED'});
});

test('partial UI sources fail closed while trusted validation checks hidden full-source references without revealing IDs',()=>{
 const db=database(),partial={...db};delete partial.procurementOrders;assert.throws(()=>state(partial),{code:'SPARES_SOURCE_INCOMPLETE'});assert.throws(()=>spares.lifecycleState(db,target,{...context,readable:['parts','partMovements']}),{code:'ACCESS_DENIED'});
 const hidden=database({procurementOrders:[{id:'SECRET-REFERENCE-ID',kind:'part',itemId:0,status:'cancelled'}]});assert.throws(()=>spares.validateChanges(hidden,{...hidden,parts:hidden.parts.filter(row=>row.id!==0)},{...context,readable:['parts']}),error=>error.code==='SPARES_DELETE_BLOCKED'&&!error.message.includes('SECRET-REFERENCE-ID'));
 assert.equal(spares.validateChanges(db,changed(db,'delete'),{...context,readable:['parts']}),true);
});

test('admin contexts without explicit grants survive kernel normalization to readable null for all lifecycle actions',()=>{
 const admin={...context,identity:'synthetic-admin-session',actor:{id:'synthetic-admin',name:'Synthetic admin',role:'admin'}};
 const db=database(),archived=changed(db,'archive'),restored=changed(archived,'restore'),removed=changed(db,'delete');
 for(const [index,before,after]of [[0,db,archived],[1,archived,restored],[2,db,removed]]){
  const plan=kernel.prepare(before,{parts:after.parts},{...admin,id:'synthetic-lifecycle-admin-'+index});assert.deepEqual(plan.changed,['parts']);assert.deepEqual(plan.sections.parts,after.parts);
  assert.equal(workflow.validateChanges(before,after,{...admin,readable:null}),true);
 }
 assert.equal(spares.lifecycleState(db,target,{...context,readable:null}).canDelete,true);
 assert.throws(()=>spares.lifecycleState(db,target,{...context,readable:[]}),{code:'ACCESS_DENIED'});
 assert.throws(()=>spares.lifecycleState(db,target,{...context,readable:'*'}),{code:'SPARES_CONTEXT'});
});

test('ownership cannot be stripped before deleting draft-only or policy-linked stock',()=>{
 for(const db of [database({generatorMaintenancePlans:[{id:'draft',status:'draft',rows:[{components:[{partId:0}]}]}]}),database({procurementOrders:[{id:'po',kind:'part',itemId:0,status:'cancelled'}]}),database({parts:[{...part,costValuation:{opening:{qty:0,amount:0}}}]})]){
  const parts=db.parts.map(row=>{const next={...row};if(next.id===0)delete next.generatorId;return next;});assert.throws(()=>spares.validateChanges(db,{...db,parts},context),{code:'SPARES_OWNER_LOCKED'});
 }
 const db=database();assert.equal(spares.validateChanges(db,{...db,parts:db.parts.map(row=>row.id===0?{...row,generatorId:'0'}:row)},context),true);
});

test('unchanged legacy duplicate IDs do not block unrelated writes but lifecycle changes remain ambiguous',()=>{
 const db=database({parts:[{...part},{...part,name:'DUPLICATE'}]});assert.equal(spares.validateChanges(db,{...db,workOrders:[{id:'unrelated'}]},context),true);
 assert.throws(()=>state(db),{code:'SPARES_TARGET'});assert.throws(()=>spares.validateChanges(db,{...db,parts:[]},context),{code:'SPARES_TARGET'});assert.throws(()=>spares.validateChanges(db,{...db,parts:db.parts.map(row=>({...row,archived:true}))},context),{code:'SPARES_TARGET'});
});

test('a matching reviewed same-owner catalog merge delegates alias authorization to CatalogPolicy',()=>{
 const db=database({parts:[{...part},{...part,id:'target',name:'TARGET'}]}),saved={...part,archived:true,mergedInto:{section:'parts',id:'target'}},next={...db,parts:[saved,db.parts[1]]};
 const command={type:'MergeCatalog',version:1,input:{section:'parts',sourceId:0,targetId:'target'}};
 assert.equal(spares.validateChanges(db,next,{...context,id:'merge-op',actor:{role:'admin'},commandIntent:{operation:{id:'merge-op'},command}}),true);
 assert.throws(()=>spares.validateChanges(db,next,context),{code:'SPARES_ARCHIVE_BLOCKED'});
});
