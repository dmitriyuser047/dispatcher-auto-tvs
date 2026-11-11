'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const host=require('../electron/access-context.cjs'),policy=require('../assets/core/access-policy.js');
const rules=()=>({id:'synthetic-user',name:'Synthetic user',role:'admin',accessPolicy:{version:1,grants:[{org:'A',site:'North'}],sections:{vehicles:{readFields:['id','plate','org','site'],writeFields:['plate']}}}});
function data(){return {vehicles:[{id:0,org:'A',site:'North',plate:'Numeric',note:'PRIVATE',orgHistory:[{from:'2026-01-01',to:'',org:'A',site:'North'}]},{id:'0',org:'B',site:'South',plate:'Text',note:'PRIVATE',orgHistory:[{from:'2026-01-01',to:'',org:'B',site:'South'}]}],records:[{id:'number',vehicleId:0,date:'2026-09-01',km:10},{id:'string',vehicleId:'0',date:'2026-09-01',km:20}]};}

test('host prepared reads retain typed identities, field masks, row ownership and exact before/after phases',()=>{
 const before=data(),after=structuredClone(before);after.vehicles[0]={...after.vehicles[0],org:'B',site:'South',orgHistory:[{from:'2026-01-01',to:'',org:'B',site:'South'}]};after.vehicles[1]={...after.vehicles[1],org:'A',site:'North',orgHistory:[{from:'2026-01-01',to:'',org:'A',site:'North'}]};
 const context=host.create(before,after,rules());for(const phase of ['before','after']){
  for(const name of ['vehicles','records'])for(const row of (phase==='before'?before:after)[name])for(const action of ['read','update','delete','print'])assert.equal(context.permits(name,action,row,phase),policy.permits(context.policy,name,action,row,context.context,phase));
  const pure=phase==='before'?context.context:{...context.context,resolve:(name,row)=>context.context.resolve(name,row,'after')};assert.deepEqual(context.projectRows('vehicles',(phase==='before'?before:after).vehicles,phase),policy.projectRows(context.policy,'vehicles',(phase==='before'?before:after).vehicles,pure));
 }
 assert.deepEqual(context.projectRows('vehicles',before.vehicles).map(row=>row.id),[0]);assert.deepEqual(context.projectRows('vehicles',after.vehicles,'after').map(row=>row.id),['0']);assert.equal(context.projectRows('vehicles',before.vehicles)[0].note,undefined);assert.equal(context.canRead('records',before.records[0]),true);assert.equal(context.canRead('records',after.records[0],'after'),false);assert.throws(()=>context.permits('vehicles','read',before.vehicles[0],'invalid'),{code:'ACCESS_CONTEXT_INVALID'});
});

test('each host response owns its principal snapshot and a new context observes revoked or changed permissions',()=>{
 const database=data(),principal=rules(),context=host.create(database,database,principal);assert.deepEqual(context.projectRows('vehicles',database.vehicles).map(row=>row.id),[0]);principal.accessPolicy.grants=[{org:'B',site:'South'}];principal.accessPolicy.sections.vehicles.readFields.push('note');
 assert.deepEqual(context.projectRows('vehicles',database.vehicles).map(row=>row.id),[0]);assert.equal(context.projectRows('vehicles',database.vehicles)[0].note,undefined);
 const changed=host.create(database,database,principal);assert.deepEqual(changed.projectRows('vehicles',database.vehicles).map(row=>row.id),['0']);assert.equal(changed.projectRows('vehicles',database.vehicles)[0].note,'PRIVATE');principal.accessPolicy.grants=[];assert.deepEqual(host.create(database,database,principal).projectRows('vehicles',database.vehicles),[]);
});

test('reusing prepared policy does not accept executable rows or user-provided ownership resolvers',()=>{
 const database=data(),context=host.create(database,database,rules());let getters=0;const unsafe={id:0,org:'A',site:'North'};Object.defineProperty(unsafe,'note',{enumerable:true,get(){getters++;return 'Never execute';}});assert.throws(()=>context.canRead('vehicles',unsafe),{code:'ACCESS_ROW_INVALID'});assert.throws(()=>context.projectRows('vehicles',[unsafe]),{code:'ACCESS_ROW_INVALID'});assert.equal(getters,0);
 context.context.resolve=()=>({kind:'shared',owners:[]});context.context.readable.push('unknown-section');assert.equal(context.canRead('vehicles',database.vehicles[1]),false);assert.deepEqual(context.projectRows('unknown-section',[{id:'x'}]),[]);
});
