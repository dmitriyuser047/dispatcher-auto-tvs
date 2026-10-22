'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const contracts=require('../assets/core/platform-contracts.js');
const fingerprint='sha256:'+'d'.repeat(64),reason='SYNTHETIC confirmed repair operation';
const wrap=input=>({type:'RepairAction',version:1,input});
const save=()=>({action:'saveOrder',orderId:0,payload:{title:'SYNTHETIC repair',target:{section:'vehicles',id:0},primary:{section:'repairs',id:'0'},source:{section:'shiftReports',id:0},downtime:{mode:'none',basis:'SYNTHETIC work without downtime'},cost:0,actualCost:null,costIncludesMaterials:false,completedAt:'2026-09-10T12:30',result:'Actual result',acceptedBy:'Actual receiver',warrantyUntil:'2027-09-10',repeatOf:'0'},reason,reviewFingerprint:fingerprint});

test('repair DTO preserves typed source and primary identities, explicit zero, unknown money and no-downtime evidence',()=>{
 const input=save(),before=structuredClone(input);assert.deepEqual(contracts.validateCommand(wrap(input)),wrap(input));assert.deepEqual(input,before);
 for(const id of [0,'0'])for(const section of ['vehicles','generators']){const value=save();value.orderId=id;value.payload.target={section,id};value.payload.primary=null;value.payload.costIncludesMaterials=null;assert.deepEqual(contracts.validateCommand(wrap(value)),wrap(value));}
});

test('repair DTO requires an explicit reviewed action and refuses client states, authorities and mutable metadata',()=>{
 for(const action of ['approve','start','cancel'])for(const id of [0,'0']){const input={action,orderId:id,reason,reviewFingerprint:fingerprint};assert.deepEqual(contracts.validateCommand(wrap(input)),wrap(input));}
 for(const patch of [{action:'accept'},{action:'repairing'},{reason:'x'},{reviewFingerprint:'not-reviewed'},{actor:{id:'forged'}},{now:'2026-09-10T12:00:00Z'},{status:'accepted'}])assert.throws(()=>contracts.validateCommand(wrap({...save(),...patch})),{code:'INVALID_COMMAND'});
 for(const field of ['status','acceptedActor','acceptedAt','repairProcess','defectSnapshot','lifecycle','downtimeFrom','repairId']){const input=save();input.payload[field]=field==='status'?'accepted':{};assert.throws(()=>contracts.validateCommand(wrap(input)),{code:'INVALID_COMMAND'});}
});

test('repair facts validate real calendar instants and make primary clearing distinct from omission',()=>{
 for(const downtime of [{mode:'interval',from:'2026-09-10T12:30',to:'2026-09-10T13:30'},{mode:'interval',from:'2026-09-10T12:30+03:00',to:'2026-09-10T10:00Z'}]){const input=save();input.payload.downtime=downtime;assert.deepEqual(contracts.validateCommand(wrap(input)),wrap(input));}
 for(const downtime of [{mode:'none'},{mode:'none',basis:'x'},{mode:'none',basis:reason,from:'2026-09-10T12:00'},{mode:'interval',from:'2026-02-30T12:00'},{mode:'interval',from:'2026-09-10T25:00'},{mode:'interval',from:'2026-09-10T12:00',to:'2026-09-10T11:59'},{mode:'interval',from:'2026-09-10'}]){const input=save();input.payload.downtime=downtime;assert.throws(()=>contracts.validateCommand(wrap(input)),{code:'INVALID_COMMAND'});}
 const omitted=save();delete omitted.payload.primary;const cleared=structuredClone(omitted);cleared.payload.primary=null;assert.notDeepEqual(contracts.validateCommand(wrap(omitted)),contracts.validateCommand(wrap(cleared)));
 for(const patch of [{cost:-1},{cost:'0'},{actualCost:Infinity},{costIncludesMaterials:'false'},{primary:{section:'payments',id:0}},{source:{section:'records',id:0}},{completedAt:'2026-02-30T12:00'},{warrantyUntil:'2026-02-30'}])assert.throws(()=>contracts.validateCommand(wrap({...save(),payload:{...save().payload,...patch}})),{code:'INVALID_COMMAND'});
});

test('repair command parsing owns its payload without executing getters or source coercion hooks',()=>{
 let calls=0;const input=save();Object.defineProperty(input.payload,'cost',{enumerable:true,get(){calls++;return 0;}});assert.throws(()=>contracts.validateCommand(wrap(input)),{code:'INVALID_COMMAND'});assert.equal(calls,0);
 const hostile=save();Object.defineProperty(hostile.payload.source,Symbol.toStringTag,{get(){calls++;return 'Object';}});assert.throws(()=>contracts.validateCommand(wrap(hostile)),{code:'INVALID_COMMAND'});assert.equal(calls,0);
 const source=save(),owned=contracts.validateCommand(wrap(source));source.payload.target.id='changed';source.payload.downtime.basis='changed';assert.equal(owned.input.payload.target.id,0);assert.equal(owned.input.payload.downtime.basis,'SYNTHETIC work without downtime');
});
