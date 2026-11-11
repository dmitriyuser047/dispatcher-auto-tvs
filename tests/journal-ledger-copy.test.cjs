'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const ledger=require('../electron/operation-ledger.cjs');
const operation={id:'synthetic-copy',digest:'sha256:'+crypto.createHash('sha256').update('synthetic-copy').digest('hex'),actorId:'synthetic',actorRole:'admin',databaseToken:'synthetic-db'};
const receipt={operation,at:'2026-11-11T00:00:00Z',changedSections:[],revisions:{},result:{kind:'sections'}};
const api=()=>ledger.createOperationLedger({readObject:()=>undefined,cursorKey:Buffer.alloc(32,1)});
const proof=extra=>({version:1,status:'verified',requiredSections:['vehicles'],subjects:[],request:{operation,...extra}});
function append(value){const engine=api();return engine.prepareAppend({head:engine.genesis(),receipt,auditEntries:[],accessProof:value});}
test('shared caller objects produce exactly the same immutable ledger bytes as independent JSON values',()=>{
 const shared={values:[null,true,0,'Synthetic'],nested:{note:'Synthetic source'}};const input=proof({metadata:Array.from({length:1600},()=>shared)}),before=JSON.stringify(input),plan=append(input),independent=append(JSON.parse(before));
 assert.deepEqual(plan,independent);assert.equal(JSON.stringify(input),before);assert.equal(Object.isFrozen(shared),false);
 shared.nested.note='Changed';const later=append(input);assert.notDeepEqual(later.head,plan.head);assert.deepEqual(append(JSON.parse(before)),plan);
});
test('shared subtree reuse still enforces expanded node and depth budgets before serialization',()=>{
 let wide=null;for(let index=0;index<7;index++)wide=Array(16).fill(wide);
 assert.throws(()=>append(proof({metadata:wide})),{code:'LEDGER_LIMIT'});
 let leaf={value:'Synthetic'};for(let index=0;index<45;index++)leaf={child:leaf};
 let deep=leaf;for(let index=0;index<45;index++)deep={child:deep};
 assert.throws(()=>append(proof({first:leaf,second:deep})),{code:'LEDGER_LIMIT'});
});
test('cycle, sparse-array and executable shared objects retain strict rejection without executing getters',()=>{
 const cycle={};cycle.self=cycle;assert.throws(()=>append(proof({a:cycle,b:cycle})),{code:'LEDGER_JSON'});
 const sparse=Array(3);sparse[2]='Synthetic';assert.throws(()=>append(proof({a:sparse,b:sparse})),{code:'LEDGER_JSON'});
 let calls=0;const executable={};Object.defineProperty(executable,'value',{enumerable:true,get(){calls++;return 'Forbidden';}});
 assert.throws(()=>append(proof({a:executable,b:executable})),{code:'LEDGER_JSON'});assert.equal(calls,0);
});
