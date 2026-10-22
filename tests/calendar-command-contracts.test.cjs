'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const contracts=require('../assets/core/platform-contracts.js');
const fingerprint='sha256:'+'a'.repeat(64);
const configure=()=>({type:'CalendarAction',version:1,input:{action:'configure',timeZone:'Europe/Moscow',reason:'Explicit reviewed business calendar',reviewFingerprint:fingerprint}});
test('calendar configure is a strict review-bound command and preserves an explicit zone',()=>{
 const source=configure(),parsed=contracts.validateCommand(source);assert.deepEqual(parsed,source);assert.notEqual(parsed,source);assert.notEqual(parsed.input,source.input);
 for(const change of [{actor:{id:'forged'}},{at:'2026-01-01'},{today:'2026-01-01'},{history:[]},{timeZone:''},{reason:'x'},{reviewFingerprint:'unchecked'}])assert.throws(()=>contracts.validateCommand({...source,input:{...source.input,...change}}));
});
test('interval confirmation preserves typed identifiers and accepts only planning targets',()=>{
 for(const section of ['dispatchJobs','workOrders'])for(const id of [0,'0']){
  const input={action:'confirmInterval',target:{section,id},reason:'Confirm legacy local interval from source',reviewFingerprint:fingerprint};assert.deepEqual(contracts.validateCommand({type:'CalendarAction',version:1,input}).input,input);
 }
 for(const target of [{section:'shiftReports',id:0},{section:'workOrders',id:null},{section:'workOrders',id:0,instant:'forged'}])assert.throws(()=>contracts.validateCommand({type:'CalendarAction',version:1,input:{action:'confirmInterval',target,reason:'Reviewed explicit confirmation',reviewFingerprint:fingerprint}}));
});
test('shift acceptance accepts a reason for an actual dated deviation and rejects forged historical context',()=>{
 const command={type:'AcceptShift',version:1,input:{shiftId:0,changes:{acceptedBy:'Actual recipient',planningDeviationReason:'Actual documented work during recorded absence'}}};assert.deepEqual(contracts.validateCommand(command),command);
 for(const changes of [{planningDeviationReason:'x'},{personnelSnapshot:{version:1}},{timeContext:{version:1}},{calendar:{timeZone:'UTC'}}])assert.throws(()=>contracts.validateCommand({...command,input:{...command.input,changes:{...command.input.changes,...changes}}}));
});
