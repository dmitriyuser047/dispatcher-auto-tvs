'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const contracts=require('../assets/core/platform-contracts.js'),fingerprint='sha256:'+'b'.repeat(64),reason='SYNTHETIC reviewed procurement';
const wrap=input=>({type:'ProcurementAction',version:1,input});
function order(id=0){return{action:'saveOrder',orderId:id,payload:{kind:'tank',itemId:id,supplier:'SYNTHETIC supplier',quantity:100,deliveryDate:'2026-09-30',status:'ordered',note:'SYNTHETIC source'},reason,reviewFingerprint:fingerprint};}
test('procurement DTOs preserve typed order, item and mixed receipt identities without client-computed fulfillment',()=>{
 for(const id of [0,'0']){const input=order(id),before=JSON.stringify(input);assert.deepEqual(contracts.validateCommand(wrap(input)),wrap(input));assert.equal(JSON.stringify(input),before);}
 const input={action:'activateLegacy',kind:'tank',orderId:0,receiptRefs:[{section:'tankIncomes',id:0},{section:'tankIncomes',id:'0'},{section:'fuelMovements',id:0}],reason,reviewFingerprint:fingerprint};assert.deepEqual(contracts.validateCommand(wrap(input)),wrap(input));
 for(const kind of ['tank','part']){const input={action:'supplierReturn',kind,orderId:0,receipt:{section:kind==='tank'?'tankIncomes':'partMovements',id:'0'},qty:.001,date:'2026-09-30',reason,reviewFingerprint:fingerprint};assert.deepEqual(contracts.validateCommand(wrap(input)),wrap(input));assert.equal(contracts.validateCommand(wrap({action:'cancelRemaining',kind,orderId:0,reason,reviewFingerprint:fingerprint})).input.orderId,0);}
});
test('procurement DTOs require review and source facts and reject forged status, audit or fulfillment fields',()=>{
 const valid=order();for(const field of ['action','payload','reason','reviewFingerprint']){const input={...valid};delete input[field];assert.throws(()=>contracts.validateCommand(wrap(input)),{code:'INVALID_COMMAND'});}
 for(const field of Object.keys(valid.payload)){const payload={...valid.payload};delete payload[field];assert.throws(()=>contracts.validateCommand(wrap({...valid,payload})),{code:'INVALID_COMMAND'});}
 for(const patch of [{receivedQty:100},{stockPostedQty:100},{procurement:{version:1}},{actor:{id:'spoof'}},{now:'2026-09-30T12:00:00Z'},{reviewFingerprint:'unchecked'},{reason:'  '}])assert.throws(()=>contracts.validateCommand(wrap({...valid,...patch})),{code:'INVALID_COMMAND'});
 for(const patch of [{kind:'fuel'},{status:'received'},{quantity:0},{quantity:-1},{quantity:Infinity},{quantity:'100'},{deliveryDate:'2026-02-30'},{itemId:null},{receivedQty:100},{procurement:{version:1}}])assert.throws(()=>contracts.validateCommand(wrap({...valid,payload:{...valid.payload,...patch}})),{code:'INVALID_COMMAND'});
});
test('receipt selections are explicit, bounded and unique by typed section and ID',()=>{
 const base={action:'activateLegacy',kind:'tank',orderId:0,reason,reviewFingerprint:fingerprint};
 for(const receiptRefs of [null,[{section:'fuelPurchases',id:0}],[{section:'partMovements',id:0}],[{section:'tankIncomes',id:0},{section:'tankIncomes',id:0}],Array.from({length:1001},(_,id)=>({section:'tankIncomes',id})),[{section:'tankIncomes',id:0,qty:100}]])assert.throws(()=>contracts.validateCommand(wrap({...base,receiptRefs})),{code:'INVALID_COMMAND'});
 assert.deepEqual(contracts.validateCommand(wrap({...base,receiptRefs:[]})).input.receiptRefs,[]);
 const valid={action:'supplierReturn',kind:'part',orderId:0,receipt:{section:'partMovements',id:0},qty:1,date:'2026-09-30',reason,reviewFingerprint:fingerprint};
 for(const patch of [{qty:0},{qty:-1},{qty:'1'},{date:'2026-02-30'},{receipt:{section:'tankIncomes',id:0}},{kind:'fuel'},{operationId:'spoof'}])assert.throws(()=>contracts.validateCommand(wrap({...valid,...patch})),{code:'INVALID_COMMAND'});
});
test('procurement command parsing never evaluates payload or receipt getters',()=>{
 let calls=0;const input=order();Object.defineProperty(input.payload,'quantity',{enumerable:true,get(){calls++;return 100;}});assert.throws(()=>contracts.validateCommand(wrap(input)),{code:'INVALID_COMMAND'});assert.equal(calls,0);
});
