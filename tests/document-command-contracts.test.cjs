'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const contracts=require('../assets/core/platform-contracts.js'),commands=require('../assets/core/platform-commands.js');
const fingerprint='sha256:'+'a'.repeat(64),wrap=input=>({type:'DocumentAction',version:1,input});
test('document commands retain typed zero identifiers and own nested draft and posting payloads',()=>{
 const input={action:'saveDraft',section:'workOrders',draftId:0,payload:{actualCost:923.53,repairId:'0'},correctionOf:{section:'workOrders',id:'0'},reason:'Confirmed correction'};
 const parsed=contracts.validateCommand(wrap(input));assert.deepEqual(parsed,wrap(input));input.payload.actualCost=1;assert.equal(parsed.input.payload.actualCost,923.53);assert.equal(parsed.input.draftId,0);assert.equal(parsed.input.correctionOf.id,'0');
 const post=contracts.validateCommand(wrap({action:'post',section:'workOrders',id:0,payload:{actualCost:0,result:'Accepted result'},reviewFingerprint:fingerprint}));assert.equal(post.input.id,0);assert.equal(post.input.payload.actualCost,0);
});
test('draft posting and cancellation declare their exact document type before any storage access',()=>{
 for(const action of ['postDraft','discardDraft']){const input={action,section:'payments',draftId:0,...(action==='postDraft'?{reviewFingerprint:fingerprint}:{reason:'Duplicate draft'})};assert.equal(commands.parseCommand(wrap(input)).input.draftId,0);const absent={...input};delete absent.section;assert.throws(()=>contracts.validateCommand(wrap(absent)),{code:'INVALID_COMMAND'});}
 assert.deepEqual(commands.footprint(wrap({action:'saveDraft',section:'payments',payload:{sum:100}})),['documentDrafts']);assert.ok(commands.dependencies(wrap({action:'postDraft',section:'payments',draftId:0,reviewFingerprint:fingerprint})).includes('payments'));
});
test('document action envelopes reject unsupported sections, spoofed authors, clocks and malformed review markers',()=>{
 const valid={action:'void',section:'workOrders',id:0,reason:'Confirmed cancellation',reviewFingerprint:fingerprint};
 for(const input of [{...valid,section:'auditLog'},{...valid,actor:{id:'spoof'}},{...valid,now:'2026-10-22T12:00:00.000Z'},{...valid,reviewFingerprint:'unchecked'},{...valid,reason:''},{...valid,action:'discardDraft',draftId:0}])assert.throws(()=>contracts.validateCommand(wrap(input)),{code:'INVALID_COMMAND'});
 assert.throws(()=>contracts.validateCommand(wrap({action:'saveDraft',section:'payments',payload:{sum:1},correctionOf:{section:'repairs',id:0},reason:'Wrong type'})),{code:'INVALID_COMMAND'});
});
test('settlement contracts accept an explicit positive actual amount and date without allowing forged payment history',()=>{
 const input={action:'settle',section:'payments',id:0,amount:0.01,date:'2026-09-30',reason:'Actual bank payment',reviewFingerprint:fingerprint};assert.deepEqual(contracts.validateCommand(wrap(input)),wrap(input));
 for(const change of [{amount:0},{amount:-1},{amount:'1'},{amount:Infinity},{date:'2026-02-30'},{section:'workOrders'},{paymentSettlements:{events:[]}}])assert.throws(()=>contracts.validateCommand(wrap({...input,...change})),{code:'INVALID_COMMAND'});
});
test('document payload validation never evaluates getters or coercion hooks',()=>{
 let evaluated=0;const input={action:'saveDraft',section:'payments',payload:Object.defineProperty({},'sum',{enumerable:true,get(){evaluated++;return 1;}})};assert.throws(()=>contracts.validateCommand(wrap(input)),{code:'INVALID_COMMAND'});assert.equal(evaluated,0);
 assert.throws(()=>contracts.validateCommand(wrap({action:'saveDraft',section:'payments',payload:{sum:NaN}})),{code:'INVALID_COMMAND'});
});
