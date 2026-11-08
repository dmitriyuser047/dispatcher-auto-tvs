'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {currentFixture}=require('./helpers/schema-format-support.cjs');
const {actor,principal,database,row}=require('./helpers/operation-history25-fixtures.cjs');
const storage=require('../electron/storage.js'),evidence=require('../electron/operation-evidence.cjs');

for(const kind of ['json','sqlite'])test(kind+' compact ACK validates one proof for 33 events and preserves exact projection under current grants',t=>{
 const data=database({vehicles:Array.from({length:32},(_,id)=>row(id,id%2?'B':'A'))}),{dir}=currentFixture(t,kind,{data}),before=storage.readSnapshot(dir),next=structuredClone(data.vehicles);
 next.forEach((value,index)=>{value.note='Reviewed change '+index;});
 const entry=require.cache[require.resolve('../electron/operation-evidence.cjs')],original=entry.exports,observed={validations:0,copies:0,projections:0,proofs:new Set(),events:[],source:null};
 entry.exports={...original,createProof(input){observed.source=original.createProof(input);return observed.source;},validateProof(input){observed.validations++;const checked=original.validateProof(input);if(checked!==input)observed.copies++;return checked;},createEventProjector(current){const projector=original.createEventProjector(current);return {...projector,projectEvent(event,proof){observed.projections++;observed.proofs.add(proof);observed.events.push(event);assert.equal(original.validateProof(proof),proof,'Every sibling must receive the same already checked immutable proof');return projector.projectEvent(event,proof);}};}};
 let result;
 try{result=storage.writeSections(dir,{databaseToken:before.databaseToken,base:{vehicles:before.revisions.vehicles},sections:{vehicles:next},operation:{id:'one-owned-proof-for-siblings'}},{principal:actor,compactAck:true,now:'2026-11-08T12:00:00.000Z'});}finally{entry.exports=original;}
 assert.equal(result.ok,true);assert.equal(result.operationReceipt.status,'committed');assert.equal(observed.validations,1);assert.equal(observed.copies,1);assert.equal(observed.projections,33);assert.equal(observed.proofs.size,1);
 const checked=[...observed.proofs][0];assert.notEqual(checked,observed.source);assert.equal(Object.isFrozen(checked),true);assert.equal(Object.isFrozen(checked.request.selectedTargets),true);
 // Reproduce the previous projection path: each event receives the original
 // unmarked proof returned by createProof. Compare serialized ACK bytes.
 const previousProjector=evidence.createEventProjector(actor),previousEvents=observed.events.map(event=>previousProjector.projectEvent(event,observed.source)).filter(Boolean),previousAck={...result,auditDelta:{...result.auditDelta,appended:previousEvents}};
 assert.equal(JSON.stringify(result),JSON.stringify(previousAck));assert.equal(result.auditDelta.appended.length,33);
 assert.deepEqual(result.canonicalSections.vehicles,storage.readSnapshot(dir,{principal:actor}).data.vehicles);
 const a=principal(['A']),b=principal(['B']),project=(who,proof=checked)=>{const projector=evidence.createEventProjector(who);return observed.events.map(event=>projector.projectEvent(event,proof)).filter(Boolean);};
 for(const who of [a,b,principal([]),principal(['A'],{readFields:{vehicles:['id','org','site']}})])assert.equal(JSON.stringify(project(who)),JSON.stringify(project(who,observed.source)),'Retaining the validated identity must preserve scoped and field-projected bytes');
 assert.equal(project(a).length,16);assert.ok(project(a).every(event=>event.after.org==='A'));assert.equal(project(b).length,16);assert.ok(project(b).every(event=>event.after.org==='B'));assert.deepEqual(project(principal([])),[]);
 const event=observed.events.find(event=>event.after?.org==='A'),ownedProjector=evidence.createEventProjector(a);assert.equal(ownedProjector.projectEvent(event,checked).after.note,event.after.note);
 a.accessPolicy.grants=[];assert.equal(evidence.createEventProjector(a).projectEvent(event,checked),null);assert.equal(evidence.authorizeProof(checked,a),false);assert.equal(ownedProjector.projectEvent(event,checked).after.note,event.after.note,'An existing response owns its policy snapshot');
 a.accessPolicy.grants=[{org:'A',site:{any:true}}];a.readFields={vehicles:['id','org','site']};const restricted=evidence.createEventProjector(a).projectEvent(event,checked);assert.ok(restricted);assert.equal(Object.hasOwn(restricted.after,'note'),false);assert.equal(Object.hasOwn(restricted.after,'secret'),false);assert.deepEqual(restricted.fields,[]);
});
