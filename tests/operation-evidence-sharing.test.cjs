'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const evidence=require('../electron/operation-evidence.cjs'),schema=require('../assets/core/platform-schema.js');
const actor={id:'shared-snapshot-clerk',name:'Synthetic clerk',role:'admin'};
const database=vehicles=>({...Object.fromEntries(schema.sections.map(name=>[name,[]])),vehicles});
function request(previous,next=previous){return {previous,next,principal:actor,mode:'transaction',sections:{complete:true,readSections:['vehicles'],writeSections:[],selectedTargets:[{section:'vehicles',id:'vehicle'}]},receipt:{operation:{id:'shared-snapshot-test',digest:'sha256:'+'a'.repeat(64),actorId:actor.id,actorRole:actor.role,databaseToken:'synthetic-binding'},changedSections:[]},events:[]};}
const row=payload=>({id:'vehicle',org:'Synthetic organization',site:'Synthetic site',payload});
const invalid=error=>error.code==='OPERATION_EVIDENCE_INVALID';
function chain(length,last=null){let value=last;for(let index=0;index<length;index++)value={child:value};return value;}
function countTree(value){if(!value||typeof value!=='object')return 1;return 1+Object.values(value).reduce((sum,item)=>sum+countTree(item),0);}

test('shared snapshot subtrees are owned once while serialized proof stays within the original reader budget',()=>{
 const shared=Array.from({length:2048},(_,index)=>index),aliases=Array(600).fill(shared),db=database([row(aliases)]),input=request(db);
 assert.ok(countTree(input)>1000000,'The old repeated-tree clone must exceed its cap on this valid shared graph');
 const proof=evidence.createProof(input),serialized=JSON.parse(JSON.stringify(proof)),before=JSON.stringify(proof);
 assert.equal(proof.status,'verified');assert.ok(countTree(serialized)<1000000);
 assert.equal(evidence.authorizeProof(evidence.validateProof(serialized),actor),true);
 shared[0]=-100;aliases.push(['Caller edit']);assert.equal(JSON.stringify(proof),before);
 assert.ok(Object.isFrozen(proof.request.selectedTargets[0].beforeFacts));
});

test('a shallow cached subtree cannot bypass the unchanged depth ceiling when reused farther down',()=>{
 const shared=chain(40),previous=database([row(shared)]),next=database([row(chain(45,shared))]);
 assert.throws(()=>evidence.createProof(request(previous,next)),invalid);
 // The same shared subtree at an ordinary depth remains valid.
 assert.equal(evidence.createProof(request(previous,database([row({alias:shared})]))).status,'verified');
});

test('memoized snapshots still reject cycles, accessors and sparse arrays without invoking hooks',()=>{
 const cycle={};cycle.self=cycle;assert.throws(()=>evidence.createProof(request(database([row(cycle)]))),invalid);
 let calls=0;const accessor={};Object.defineProperty(accessor,'value',{enumerable:true,get(){calls++;return 1;}});
 assert.throws(()=>evidence.createProof(request(database([row([accessor,accessor])]))),invalid);assert.equal(calls,0);
 const sparse=Array(2);sparse[1]='present';assert.throws(()=>evidence.createProof(request(database([row([sparse,sparse])]))),invalid);
});

test('distinct owned data still cannot cross the one-million-node resource ceiling',()=>{
 const distinct=Array.from({length:1000001},(_,index)=>index);
 assert.throws(()=>evidence.createProof(request(database([row(distinct)]))),invalid);
});
