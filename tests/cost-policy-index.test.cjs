'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const costs=require('../assets/core/cost-operations.js');
const policy={version:1,from:'2026-09-01',method:'fifo',taxBasis:'gross',opening:{qty:10,amount:100,basis:'Synthetic measured balance'}};
const db=(name,rows)=>({[name]:rows,costEntries:[]});
for(const name of ['vehicles','generators','tanks','parts']){
 test(name+': policy identity stays typed, immutable and present while unrelated source fields can change',()=>{
  const before=db(name,[{id:0,costValuation:structuredClone(policy),note:'Numeric identity'},{id:'0',note:'String identity'}]),after=structuredClone(before);after[name][0].note='Reviewed note';assert.equal(costs.validateChanges(before,after),true);
  for(const mutate of [next=>next[name][0].costValuation.opening.amount=101,next=>delete next[name][0].costValuation,next=>next[name][1].costValuation=structuredClone(policy)]){const next=structuredClone(before);mutate(next);assert.throws(()=>costs.validateChanges(before,next),{code:'COST_PROOF'});}
  const removed=structuredClone(before);removed[name].shift();assert.throws(()=>costs.validateChanges(before,removed),{code:'COST_POLICY_DELETE'});
 });
 test(name+': identical arrays with duplicate legacy identities still undergo the ambiguous-policy check',()=>{
  const duplicates=db(name,[{id:'duplicate',costValuation:structuredClone(policy)},{id:'duplicate',costValuation:structuredClone(policy)}]);assert.throws(()=>costs.validateChanges(duplicates,duplicates),{code:'COST_PROOF'});
  const unvalued=db(name,[{id:'duplicate'},{id:'duplicate'}]);assert.equal(costs.validateChanges(unvalued,unvalued),true);
 });
}
test('undefined, null, false and numeric/string zero preserve strict old identity semantics',()=>{
 for(const id of [undefined,null,false,0,'0']){const row={...(id===undefined?{}:{id}),costValuation:structuredClone(policy)},before=db('parts',[row]);assert.equal(costs.validateChanges(before,structuredClone(before)),true);assert.throws(()=>costs.validateChanges(before,db('parts',[])),{code:'COST_POLICY_DELETE'});}
 const missing=db('parts',[{costValuation:structuredClone(policy)},{id:undefined}]);assert.throws(()=>costs.validateChanges(missing,missing),{code:'COST_PROOF'});
});
test('NaN is not a matching policy identity even when the same objects are supplied twice',()=>{
 const valued=db('parts',[{id:NaN,costValuation:structuredClone(policy)}]);assert.throws(()=>costs.validateChanges(valued,valued),{code:'COST_PROOF'});
 const ownedUndefined=db('parts',[{id:NaN,costValuation:undefined}]);assert.throws(()=>costs.validateChanges(ownedUndefined,ownedUndefined),{code:'COST_POLICY_DELETE'});
 const unvalued=db('parts',[{id:NaN}]);assert.equal(costs.validateChanges(unvalued,unvalued),true);
});
test('a large unvalued parts directory is still checked and does not mutate either snapshot',()=>{
 const before=db('parts',Array.from({length:2500},(_,id)=>({id,name:'Synthetic part '+id}))),after=structuredClone(before),snapshot=JSON.stringify(before);after.parts[2000].name='Reviewed part';assert.equal(costs.validateChanges(before,after),true);assert.equal(JSON.stringify(before),snapshot);
 after.parts[2499].costValuation=structuredClone(policy);assert.throws(()=>costs.validateChanges(before,after),{code:'COST_PROOF'});
});
