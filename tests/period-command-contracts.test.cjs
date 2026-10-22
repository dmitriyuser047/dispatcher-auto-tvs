'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const contracts=require('../assets/core/platform-contracts.js'),commands=require('../assets/core/platform-commands.js');
const fingerprint='sha256:'+'a'.repeat(64);
const input={action:'close',scope:'fuel',month:'2026-09',reason:'Synthetic reviewed September closure',reviewFingerprint:fingerprint};
const wrap=value=>({type:'PeriodAction',version:1,input:value});

test('period commands carry an explicit scope, month, reason and reviewed fingerprint without trusted metadata',()=>{
 for(const scope of ['fuel','stock','finance'])for(const action of ['close','reopen']){
  const value=wrap({...input,scope,action});assert.deepEqual(contracts.validateCommand(value),value);
  assert.deepEqual(commands.footprint(value),['fuelPeriods']);const reads=commands.dependencies(value);
  assert.ok(reads.includes('fuelPeriods'));assert.equal(new Set(reads).size,reads.length);
  if(scope==='fuel')assert.ok(reads.includes('fuelWriteoffs'));
  if(scope==='stock')assert.ok(reads.includes('partMovements'));
  if(scope==='finance')assert.ok(reads.includes('payments'));
 }
});

test('period DTO rejects missing reasons, unsupported dates and scopes, and renderer authors or clocks',()=>{
 for(const change of [{scope:'all'},{action:'open'},{month:'2026-00'},{month:'2026-13'},{month:'2026-09-01'},{month:'2026-9'},{reason:''},{reason:'   '},{reason:'ab'},{reason:'x'.repeat(2001)},{reviewFingerprint:'unchecked'},{actor:{id:'forged'}},{now:'2026-10-01T00:00:00.000Z'},{closed:true},{closureEvents:{version:1,events:[]}}])
  assert.throws(()=>contracts.validateCommand(wrap({...input,...change})),{code:'INVALID_COMMAND'});
 for(const field of Object.keys(input)){const omitted={...input};delete omitted[field];assert.throws(()=>contracts.validateCommand(wrap(omitted)),{code:'INVALID_COMMAND'});}
});

test('period command parsing owns its values and never invokes accessors or JSON hooks',()=>{
 let calls=0;const withGetter=Object.defineProperty({...input},'reason',{enumerable:true,get(){calls++;return 'forged';}});
 assert.throws(()=>contracts.validateCommand(wrap(withGetter)),{code:'INVALID_COMMAND'});assert.equal(calls,0);
 const hidden=Object.defineProperty({...input},'toJSON',{value(){calls++;return input;}});
 assert.throws(()=>contracts.validateCommand(wrap(hidden)),{code:'INVALID_COMMAND'});assert.equal(calls,0);
 const original=wrap({...input}),parsed=contracts.validateCommand(original);original.input.month='2026-10';assert.equal(parsed.input.month,'2026-09');
});

test('financial and inventory period previews do not require unrelated private sections',()=>{
 const fuel=commands.dependencies(wrap({...input,scope:'fuel'})),stock=commands.dependencies(wrap({...input,scope:'stock'}));
 for(const reads of [fuel,stock])for(const privateSection of ['payments','budget','contragents','costEntries','costProfiles'])assert.ok(!reads.includes(privateSection));
});
