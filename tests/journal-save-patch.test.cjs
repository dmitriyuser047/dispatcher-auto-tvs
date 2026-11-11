'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const application=require('../assets/core/application.js'),kernel=require('../assets/core/platform-kernel.js'),schema=require('../assets/core/platform-schema.js');
const clone=value=>JSON.parse(JSON.stringify(value));
function fixture(optimized=true){
 const baseline={...Object.fromEntries(schema.sections.map(name=>[name,[]])),vehicles:[{id:0,plate:'SYNTHETIC-0',fuelBalance:100}],records:[{id:'record',vehicleId:0,date:'2026-11-10',km:1,note:'Before'}],parts:[{id:'other',name:'Other editor',custom:{zero:0,enabled:false,empty:null}}],auditLog:[{id:'old',section:'records',before:null,after:{note:'Immutable source'}}]};
 const state={baseline,live:clone(baseline),plans:[],inputs:[],writes:0,ack:null,error:null,patchSnapshots:[],context:{identity:'synthetic-journal',id:'journal-save',now:'2026-11-11T10:00:00Z',today:'2026-11-11',actor:{id:'admin',role:'admin'},readable:schema.sections,writable:schema.sections,revisions:Object.fromEntries(schema.sections.map(name=>[name,1]))}};
 const repository={baseline:()=>clone(state.baseline),isLive:database=>database===state.live};
 const ports={context:()=>state.context,accessStamp:context=>JSON.stringify(context),capabilities:()=>({operations:1,calendar:1}),...(optimized?{serializeSnapshot:database=>kernel.stableSerialize(database)}:{}),run:async(input,persist)=>{state.inputs.push(input);const plan=kernel.prepare(input.previous,input.next,{...state.context,id:input.id||'journal-save'});state.plans.push(plan);state.onPrepared?.();return persist(plan);},clearAck:()=>state.ack=null,ack:()=>state.ack,rollback:database=>{if(database===state.live)state.live=clone(state.baseline);},setError:error=>state.error=error,toast(){},now:()=>state.context.now};
 state.service=application.createSaveService(repository,ports);state.persist=async options=>{state.writes++;state.ack={ok:true,operationReceipt:{id:options.operation.id,status:'committed'}};return true;};
 return state;
}
test('the journal patch keeps the full read context and produces the same checked plan, cents and typed fields as a full snapshot',async()=>{
 const fast=fixture(),full=fixture(false);for(const state of [fast,full]){state.live.records[0].km=12.125;state.live.records[0].tankMeasured=0;state.live.records[0].custom={id:'0',enabled:false,empty:null};}
 for(const state of [fast,full])assert.equal(await state.service.save(state.live,{operation:{id:'same-save'}},state.persist),true);
 assert.deepEqual(Object.keys(fast.inputs[0].next),['records']);assert.deepEqual(fast.inputs[0].previous,fast.baseline);assert.deepEqual(fast.plans[0],full.plans[0]);assert.equal(fast.plans[0].sections.records[0].custom.id,'0');assert.equal(fast.writes,1);
 assert.notEqual(fast.inputs[0].next.records,fast.live.records);fast.live.records[0].custom.enabled=true;assert.equal(fast.inputs[0].next.records[0].custom.enabled,false);
});
test('all dirty sections remain part of the save and a missing foreign reference is still rejected before persistence',async()=>{
 const state=fixture();state.live.records[0].km=12;state.live.parts[0].custom.enabled=true;assert.equal(await state.service.save(state.live,undefined,state.persist),true);assert.deepEqual(new Set(Object.keys(state.inputs[0].next)),new Set(['records','parts']));assert.equal(state.writes,1);
 const invalid=fixture();invalid.live.records[0].vehicleId='missing';assert.equal(await invalid.service.save(invalid.live,undefined,invalid.persist),false);assert.equal(invalid.writes,0);
});
test('a later edit in a section absent from the prepared patch still fails the full live snapshot guard',async()=>{
 const state=fixture();state.live.records[0].km=12;state.onPrepared=()=>{state.live.parts[0].name='Newer unsaved edit';};assert.equal(await state.service.save(state.live,undefined,state.persist),false);assert.equal(state.writes,0);assert.equal(state.error.code,'STALE_DRAFT');
});
test('an unsupported value cannot disappear when unchanged section JSON happens to match its baseline',async()=>{
 for(const value of [new Date('2026-11-11T00:00:00Z'),NaN,()=>0]){
  const state=fixture();state.live.parts[0].custom=value;state.baseline.parts[0].custom=JSON.parse(JSON.stringify({value})).value??null;state.live.records[0].km=12;assert.equal(await state.service.save(state.live,undefined,state.persist),false);assert.equal(state.writes,0);
 }
});
test('unknown changed sections are rejected while unchanged extension data remains in the read context',async()=>{
 const state=fixture();state.baseline.futureSection=[{id:'extension',value:0}];state.live.futureSection=clone(state.baseline.futureSection);state.live.records[0].km=12;assert.equal(await state.service.save(state.live,undefined,state.persist),true);assert.deepEqual(state.inputs[0].previous.futureSection,[{id:'extension',value:0}]);assert.equal(Object.hasOwn(state.inputs[0].next,'futureSection'),false);
 const invalid=fixture();invalid.live.futureSection=[{id:'extension',value:1}];assert.equal(await invalid.service.save(invalid.live,undefined,invalid.persist),false);assert.equal(invalid.writes,0);assert.equal(invalid.error.code,'UNKNOWN_SECTION');
});
test('permission and identity changes during preparation still prevent transport with a compact patch',async()=>{
 for(const change of [state=>state.context={...state.context,identity:'another-database'},state=>state.context={...state.context,writable:[]}]){const state=fixture();state.live.records[0].km=12;state.onPrepared=()=>change(state);assert.equal(await state.service.save(state.live,undefined,state.persist),false);assert.equal(state.writes,0);}
});
