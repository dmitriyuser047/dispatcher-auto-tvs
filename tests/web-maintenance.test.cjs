'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

function fixture() {
  let sequence = 0;
  const data = {generators:[
    {id:0, org:'Synthetic', location:'North', maintenanceRules:[
      {id:'oil', label:'Oil', hours:300, work:'Replace oil'},
      {id:'full', label:'Full', hours:600},
      {id:'disabled', label:'Disabled', hours:100, enabled:false},
    ]},
    {id:'0', org:'Synthetic', location:'South', maintenanceRules:[{id:'other', label:'Other', hours:900}]},
  ], generatorMaintenancePlans:[], genRecords:[], parts:[], partMovements:[]};
  const context = vm.createContext({data, closeModal(){}, htmlEsc:String,
    platformSessionContext:()=>({today:'2026-10-30'}),
    precisionFormat:String, wfId:prefix=>prefix+'-'+(++sequence)});
  for(const name of ['68-generator-maintenance.js','68c-generator-maintenance-setup.js'])
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/js',name),'utf8'),context,{filename:name});
  return {context,data};
}

test('selected DES seed separate enabled service types without changing facts or merging typed IDs',()=>{
  const {context,data}=fixture(),before=JSON.stringify(data),state={rows:[]};
  context.gmPlanSeedGenerators(state,[0,0,'0']);
  assert.deepEqual(state.rows.map(row=>[row.generatorId,row.type,row.forecast.intervalText]),[
    [0,'Oil','300'],[0,'Full','600'],['0','Other','900'],
  ]);
  assert.equal(state.rows[0].work,'Replace oil');
  for(const row of state.rows){
    assert.equal(context.gmPlanForecastHasInput(row),false,'prefilled interval alone must not block saving');
    assert.ok(row.occurrences.every(item=>item.plannedDate===''),'selection must not invent service dates');
  }
  assert.equal(JSON.stringify(data),before);
});

test('planned workload is shared only across service types of the exact same DES and owns its arrays',()=>{
  const {context,data}=fixture(),before=JSON.stringify(data),state={rows:[]};
  context.gmPlanSeedGenerators(state,[0,'0']);
  const source=state.rows[0],same=state.rows[1],other=state.rows[2];
  source.forecast.monthlyTexts[0]='320';source.forecast.monthlyTexts[1]='0';
  same.forecast.preview={stale:true};same.forecast.appliedSignature='stale';
  context.gmPlanShareHours(state,source);
  assert.equal(same.forecast.monthlyTexts[0],'320');
  assert.equal(same.forecast.monthlyTexts[1],'0');
  assert.equal(other.forecast.monthlyTexts[0],'');
  assert.equal(same.forecast.preview,null);assert.equal(same.forecast.appliedSignature,null);
  same.forecast.monthlyTexts[0]='640';assert.equal(source.forecast.monthlyTexts[0],'320');
  assert.equal(JSON.stringify(data),before);
});

test('setup rejects an outdated database, permission context, source or closed form',()=>{
 const application=require('../assets/core/application.js');
 for(const invalidate of ['database','policy','source','closed']){
  const {context,data}=fixture();let stamp='current-policy',connected=true,handlers,edits=0,error='';
  const repository=application.createRepository({live:()=>context.data,persisted:()=>JSON.stringify(data),sync:()=>({enabled:false,synced:{},platform:{}}),stamp:()=>stamp,canRead:()=>true,validateRows:value=>JSON.parse(JSON.stringify(value)),install(){throw Error('Read-only setup must not install data');}});
  const view={show(model,events){handlers=events;},update(){},connected:()=>connected,year:()=> '2027',error:message=>{error=message;}};
  const ports={pending:()=>false,readable:()=>true,canEdit:()=>true,canCreate:()=>true,year:()=> '2027',parseYear:Number,format:String,toast:message=>{error=message;},edit(){edits++;},plans(){},create(){}};
  const controller=application.createSetupController(repository,view,ports);controller.open({generatorId:0});handlers.edit(0);assert.equal(edits,1);assert.equal(error,'');
  if(invalidate==='database')context.data={...data};else if(invalidate==='policy')stamp='revoked-policy';else if(invalidate==='source')data.generators[0].maintenanceRules[0].hours=450;else connected=false;
  handlers.edit(0);assert.equal(edits,1,invalidate);assert.match(error,/изменились|закрыта/,invalidate);
 }
});

test('compact web ACK keeps an unknown history prefix deferred until its full section is loaded',()=>{
 const context=vm.createContext({window:{},PlatformSchema:require('../assets/core/platform-schema.js')});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/js/25f-sync.js'),'utf8')+'\nglobalThis.state=_sync;',context);
 context.state.revs.auditLog=7;
 const canonical={generators:[{id:0}]},response={revisions:{auditLog:8},auditDelta:{version:1,baseRevision:7,revision:8,appended:[{id:'synthetic-new-event'}]}};
 assert.equal(context.syncAuditDelta(response,canonical),canonical);assert.equal(Object.hasOwn(context.state.synced,'auditLog'),false);
 context.state.synced.auditLog=JSON.stringify([{id:'synthetic-prefix'}]);const complete=context.syncAuditDelta(response,canonical);
 assert.deepEqual(JSON.parse(JSON.stringify(complete.auditLog)),[{id:'synthetic-prefix'},{id:'synthetic-new-event'}]);complete.auditLog[0].id='output-only';assert.equal(JSON.parse(context.state.synced.auditLog)[0].id,'synthetic-prefix');
});
