'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const api=require('../assets/core/access-policy.js'),schema=require('../assets/core/platform-schema.js');
const known=value=>({state:'known',value}),owner=(org='A',site='North')=>({org:known(org),site:known(site)});
const facts=(org='A',site='North')=>({kind:'owned',owners:[owner(org,site)]});
const resolve=(_section,row)=>facts(row.org,row.site);
const context=extra=>({readable:['vehicles','records'],writable:['vehicles'],resolve,...extra});
const policy=()=>({version:1,grants:[{org:'A',site:'North'}]});
const row=(id,org='A',site='North')=>({id,org,site,note:'Visible',details:{private:'Hidden'}});

test('prepared evaluator preserves scope, fields and nested source guards with per-call resolvers',()=>{
 const rules=policy(),base=context({readFields:{vehicles:['id','org','site','note','details']}}),evaluator=api.createEvaluator(rules,base);
 const guarded=(name,item)=>({...resolve(name,item),fieldGuards:[{path:['details','private'],requires:{sections:['payments'],owners:[],complete:true}}]});
 const inputs=[row(0),row('0','B'),row('owned')];
 assert.deepEqual(evaluator.projectRows('vehicles',inputs,guarded),api.projectRows(rules,'vehicles',inputs,{...base,resolve:guarded}));
 assert.deepEqual(evaluator.projectRows('vehicles',inputs,guarded).map(value=>value.id),[0,'owned']);
 assert.equal(evaluator.projectRows('vehicles',inputs,guarded)[0].details.private,undefined);
 assert.equal(evaluator.permits('vehicles','update',inputs[0]),api.permits(rules,'vehicles','update',inputs[0],base));
 assert.equal(evaluator.permits('vehicles','update',inputs[1]),false);
 assert.deepEqual(evaluator.projectRows('payments',inputs,()=>{throw Error('Must not resolve unreadable section');}),[]);
 const phases=[];
 assert.equal(evaluator.permits('vehicles','read',inputs[0],(_name,_item,phase)=>{phases.push(phase);return facts(phase==='after'?'A':'B');},'after'),true);
 assert.deepEqual(phases,['after']);
});

test('an evaluator owns its rules and a new evaluation observes changed caller permissions',()=>{
 const rules=policy(),base=context({readFields:{vehicles:['id','note']}}),evaluator=api.createEvaluator(rules,base),input=row(1);
 assert.equal(Object.isFrozen(evaluator),true);
 assert.deepEqual(evaluator.projectRows('vehicles',[input]),[{id:1,note:'Visible'}]);
 rules.grants.length=0;base.readable.length=0;base.readFields.vehicles.push('details');
 assert.deepEqual(evaluator.projectRows('vehicles',[input]),[{id:1,note:'Visible'}]);
 assert.deepEqual(api.createEvaluator(rules,base).projectRows('vehicles',[input]),[]);
 assert.deepEqual(api.projectRows(rules,'vehicles',[input],base),[]);
 assert.equal(Object.isFrozen(rules),false);assert.equal(Object.isFrozen(base.readFields.vehicles),false);
});

test('rows and ownership facts remain fresh and validated on every evaluator call',()=>{
 let current=facts(),calls=0;
 const evaluator=api.createEvaluator(policy(),context({resolve:()=>{calls++;return current;}})),input=row(1);
 assert.equal(evaluator.permits('vehicles','read',input),true);
 current=facts('B');assert.equal(evaluator.permits('vehicles','read',input),false);
 current={kind:'owned',owners:[{org:{state:'known',value:2},site:known('North')}]};
 assert.throws(()=>evaluator.permits('vehicles','read',input),{code:'ACCESS_CONTEXT_INVALID'});
 assert.equal(calls,3);
 let getters=0;const unsafe={id:1};Object.defineProperty(unsafe,'note',{enumerable:true,get(){getters++;return 'Never evaluate';}});
 assert.throws(()=>evaluator.projectRows('vehicles',[unsafe]),{code:'ACCESS_ROW_INVALID'});assert.equal(getters,0);
 const executableFacts={kind:'owned',owners:[]};Object.defineProperty(executableFacts,'fieldGuards',{enumerable:true,get(){getters++;return [];}});
 assert.throws(()=>evaluator.projectRows('vehicles',[input],()=>executableFacts),{code:'ACCESS_CONTEXT_INVALID'});assert.equal(getters,0);
 assert.throws(()=>evaluator.projectRows('vehicles',[input],null),{code:'ACCESS_CONTEXT_INVALID'});
 assert.throws(()=>evaluator.permits('vehicles','read',input,undefined,'invalid'),{code:'ACCESS_CONTEXT_INVALID'});
});

test('preparation validates each caller context once without admitting frozen malformed rules',()=>{
 let ceilingReads=0,resolverCalls=0;
 const readable=new Proxy([...schema.sections],{ownKeys(target){ceilingReads++;return Reflect.ownKeys(target);}});
 const base=context({readable,resolve:()=>{resolverCalls++;return facts();}}),evaluator=api.createEvaluator(policy(),base),atCreation=ceilingReads;
 assert.ok(atCreation>0);
 for(let index=0;index<40;index++)assert.equal(evaluator.permits('vehicles','read',row(index)),true);
 assert.equal(ceilingReads,atCreation);assert.equal(resolverCalls,40);
 const frozenMalformed=Object.freeze({version:1,grants:Object.freeze([{org:'A'}])});
 assert.throws(()=>api.createEvaluator(frozenMalformed,base),{code:'ACCESS_POLICY_INVALID'});
 let getters=0;const unsafe=context();Object.defineProperty(unsafe,'resolve',{enumerable:true,get(){getters++;return resolve;}});
 assert.throws(()=>api.createEvaluator(null,unsafe),{code:'ACCESS_CONTEXT_INVALID'});assert.equal(getters,0);
});
