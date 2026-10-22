'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const contracts=require('../assets/core/platform-contracts.js');
const fingerprint='sha256:'+'a'.repeat(64),reason='Synthetic measured source';
const wrap=input=>({type:'FuelAction',version:1,input});
test('fuel commands preserve measured zero and distinguish numeric and textual source identities',()=>{
 for(const id of [0,'0']){
  const input={action:'measure',target:{section:'tanks',id},date:'2026-09-30',observedQty:0,reason,reviewFingerprint:fingerprint};
  assert.deepEqual(contracts.validateCommand(wrap(input)),wrap(input));
  for(const action of ['applyDifference','voidMeasurement'])assert.equal(contracts.validateCommand(wrap({action,measurementId:id,reason,reviewFingerprint:fingerprint})).input.measurementId,id);
 }
 const pair={action:'reverseLegacyTransfer',outId:0,inId:'0',reason,reviewFingerprint:fingerprint};
 assert.deepEqual(contracts.validateCommand(wrap(pair)),wrap(pair));
});
test('fuel commands require complete reviewed facts and reject computed fields or impersonated audit metadata',()=>{
 const valid={action:'measure',target:{section:'tanks',id:0},date:'2026-09-30',observedQty:15.125,reason,reviewFingerprint:fingerprint};
 for(const field of Object.keys(valid)){const input={...valid};delete input[field];assert.throws(()=>contracts.validateCommand(wrap(input)),{code:'INVALID_COMMAND'});}
 for(const patch of [{target:{section:'vehicles',id:0}},{target:{section:'tanks',id:0,org:'spoof'}},{date:'2026-02-30'},{observedQty:-1},{observedQty:null},{observedQty:'15'},{observedQty:Infinity},{reason:'  '},{reviewFingerprint:'unchecked'},{calculatedQty:100},{differenceQty:0},{sourceFingerprint:fingerprint},{actor:{id:'spoof'}},{now:'2026-09-30T12:00:00Z'}])assert.throws(()=>contracts.validateCommand(wrap({...valid,...patch})),{code:'INVALID_COMMAND'});
 assert.throws(()=>contracts.validateCommand(wrap({action:'reverseLegacyTransfer',outId:0,inId:0,reason,reviewFingerprint:fingerprint})),{code:'INVALID_COMMAND'});
 assert.throws(()=>contracts.validateCommand({...wrap(valid),actor:{id:'spoof'}}),{code:'INVALID_COMMAND'});
});
test('fuel command parsing never evaluates executable source properties',()=>{
 let calls=0;const input={action:'measure',target:{section:'tanks',id:0},date:'2026-09-30',reason,reviewFingerprint:fingerprint};
 Object.defineProperty(input,'observedQty',{enumerable:true,get(){calls++;return 0;}});
 assert.throws(()=>contracts.validateCommand(wrap(input)),{code:'INVALID_COMMAND'});assert.equal(calls,0);
});
