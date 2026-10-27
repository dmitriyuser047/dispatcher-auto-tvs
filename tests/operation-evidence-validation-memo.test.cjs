'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {evidence,actor,principal,database,row,prepared}=require('./helpers/operation-history25-fixtures.cjs');
const invalid=error=>error.code==='OPERATION_EVIDENCE_INVALID';
function fixture(){const previous=database({vehicles:[row(0,'A')]}),next=structuredClone(previous);next.vehicles[0].note='Changed';return prepared('validation-memo',previous,next,{targets:[{section:'vehicles',id:0}]});}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function assertFrozen(value){if(value&&typeof value==='object'){assert.equal(Object.isFrozen(value),true);Object.values(value).forEach(assertFrozen);}}

test('only an owned fully validated proof result reuses its immutable identity',()=>{
 const source=JSON.parse(JSON.stringify(fixture().proof)),checked=evidence.validateProof(source);
 assert.notEqual(checked,source);assert.deepEqual(checked,source);assertFrozen(checked);
 assert.equal(evidence.validateProof(checked),checked);assert.equal(evidence.validateProof(evidence.validateProof(checked)),checked);
 assert.throws(()=>{checked.request.actor.id='Forged';},TypeError);
 assert.equal(evidence.authorizeProof(checked,actor),true);
});

test('validation never memoizes a mutable caller input or freezes caller objects',()=>{
 const source=JSON.parse(JSON.stringify(fixture().proof)),checked=evidence.validateProof(source);
 assert.equal(Object.isFrozen(source),false);assert.equal(Object.isFrozen(source.request.actor),false);
 assert.notEqual(evidence.validateProof(source),checked);
 source.request.actor.id='Forged';assert.throws(()=>evidence.validateProof(source),invalid);
 assert.equal(evidence.authorizeProof(source,actor),false);assert.equal(evidence.authorizeProof(checked,actor),true);
});

test('caller supplied outer or deep freezing cannot manufacture a validation capability',()=>{
 const outer=Object.freeze(JSON.parse(JSON.stringify(fixture().proof))),checked=evidence.validateProof(outer);
 outer.request.actor.id='Forged';assert.throws(()=>evidence.validateProof(outer),invalid);assert.equal(evidence.authorizeProof(checked,actor),true);
 const callerFrozen=freeze(JSON.parse(JSON.stringify(checked))),first=evidence.validateProof(callerFrozen),second=evidence.validateProof(callerFrozen);
 assert.notEqual(first,callerFrozen);assert.notEqual(second,callerFrozen);assert.notEqual(first,second);assert.equal(evidence.validateProof(first),first);
 const forged=structuredClone(checked);forged.request.actor.role='viewer';freeze(forged);assert.throws(()=>evidence.validateProof(forged),invalid);
});

test('a memoized proof still checks current actor, scope, field access and receipt on every use',()=>{
 const {proof,events,receipt}=fixture(),checked=evidence.validateProof(proof),current=principal(['A']);
 assert.equal(evidence.authorizeProof(checked,current,receipt),true);assert.equal(evidence.projectEvent(events[0],checked,current).after.note,'Changed');
 current.accessPolicy.grants=[];assert.equal(evidence.authorizeProof(checked,current,receipt),false);assert.equal(evidence.projectEvent(events[0],checked,current),null);
 current.accessPolicy.grants=[{org:'A',site:{any:true}}];assert.equal(evidence.authorizeProof(checked,current,receipt),true);
 const hidden=principal(['A'],{readFields:{vehicles:['id','org','site']}});assert.equal(evidence.authorizeProof(checked,hidden,receipt),false);assert.equal(Object.hasOwn(evidence.projectEvent(events[0],checked,hidden).after,'note'),false);
 assert.equal(evidence.authorizeProof(checked,{...actor,id:'Other actor'},receipt),false);assert.equal(evidence.authorizeProof(checked,{...actor,role:'viewer'},receipt),false);
 const wrong=structuredClone(receipt);wrong.operation.digest='sha256:'+'f'.repeat(64);assert.equal(evidence.authorizeProof(checked,actor,wrong),false);
 assert.equal(evidence.validateProof(checked),checked);
});

test('reconstructed or tampered proofs retain full validation and the existing resource ceilings',()=>{
 const checked=evidence.validateProof(fixture().proof),reconstructed=JSON.parse(JSON.stringify(checked));
 assert.notEqual(evidence.validateProof(reconstructed),checked);
 reconstructed.request.eventGuards[0].hash='sha256:'+'f'.repeat(64);assert.throws(()=>evidence.validateProof(reconstructed),invalid);
 let calls=0;const accessor=structuredClone(checked);Object.defineProperty(accessor.request,'hidden',{enumerable:true,get(){calls++;return null;}});assert.throws(()=>evidence.validateProof(accessor),invalid);assert.equal(calls,0);
 const oversized=structuredClone(checked);oversized.request.extra=Array(1000001).fill(null);assert.throws(()=>evidence.validateProof(oversized),invalid);
 const tooDeep=structuredClone(checked);let nested=null;for(let index=0;index<81;index++)nested={child:nested};tooDeep.request.extra=nested;assert.throws(()=>evidence.validateProof(tooDeep),invalid);
});

function observeAdapterProofs(callback){
 const entry=require.cache[require.resolve('../electron/operation-evidence.cjs')],original=entry.exports,observed={validations:0,proofs:[]};
 const observe=proof=>{observed.proofs.push(proof);assert.equal(original.validateProof(proof),proof,'Adapter must retain the owned validated result');};
 entry.exports={...original,validateProof(value){observed.validations++;return original.validateProof(value);},projectEvent(event,proof,current){observe(proof);return original.projectEvent(event,proof,current);},createEventProjector(current){const projector=original.createEventProjector(current);return {...projector,projectEvent(event,proof){observe(proof);return projector.projectEvent(event,proof);}};}};
 try{return callback(observed);}finally{entry.exports=original;}
}

test('SQLite hot ACK and paged history validate once per owned receipt while preserving order, current grants and replay',t=>{
 const host=require('./helpers/operation-history25-host.cjs'),platform=require('../electron/platform-service.cjs'),{dir}=host.fixture(t,'sqlite');
 const first=host.commit(dir,host.actor,'memo-first'),second=host.commit(dir,host.actor,'memo-second'),snapshot=host.storage.readSnapshot(dir),raw=snapshot.data.auditLog;
 let visible;
 observeAdapterProofs(observed=>{
  visible=platform.visibleAudit(raw,host.actor,snapshot.data);assert.equal(visible.length,6);assert.equal(observed.validations,2);
  assert.equal(new Set(observed.proofs).size,2);assert.equal(observed.proofs[0],observed.proofs[1]);assert.equal(observed.proofs[1],observed.proofs[2]);
  assert.deepEqual(platform.visibleAudit(raw,host.none,snapshot.data),[]);assert.equal(observed.validations,2,'Current-grant projection must reuse validation without reusing authorization');
  const scoped=platform.visibleAudit(raw,host.A,snapshot.data);assert.equal(scoped.length,2);assert.ok(scoped.every(event=>event.after?.org==='A'));
  assert.equal(observed.validations,2);assert.deepEqual(platform.visibleAudit(raw,host.actor,snapshot.data),visible);
 });
 observeAdapterProofs(observed=>{
  const page=platform.queryHistory(dir,{query:{},limit:200},host.actor);assert.equal(page.nextCursor,null);
  assert.deepEqual(page.rows.map(row=>row.id),visible.map(row=>row.id).reverse());assert.equal(observed.validations,2);assert.equal(new Set(observed.proofs).size,2);
  assert.equal(observed.proofs[0],observed.proofs[1]);assert.equal(observed.proofs[1],observed.proofs[2]);
 });
 const replay=host.storage.writeSections(dir,first.payload,{principal:host.actor,now:'Do not replan an existing operation'});assert.equal(replay.replayed,true);
 assert.equal(host.storage.readOperation(dir,second.query,host.actor).operationReceipt.status,'committed');assert.deepEqual(host.storage.readSnapshot(dir),snapshot);
 assert.throws(()=>platform.queryHistory(dir,{query:{},limit:200},host.none),{code:'ACCESS_DENIED'});
 const ids=[];let cursor;do{const page=platform.queryHistory(dir,{query:{},limit:1,...(cursor?{cursor}:{})},host.actor);ids.push(...page.rows.map(row=>row.id));cursor=page.nextCursor;}while(cursor);
 assert.deepEqual(ids,visible.map(row=>row.id).reverse());
});

test('SQLite receipt and page caches never hide changed stored bytes in a new read',t=>{
 const host=require('./helpers/operation-history25-host.cjs'),store=require('../electron/operation-store.cjs'),platform=require('../electron/platform-service.cjs'),{DatabaseSync}=require('node:sqlite'),{dir}=host.fixture(t,'sqlite');
 const committed=host.commit(dir,host.actor,'memo-storage-tamper');host.storage.readSnapshot(dir,{principal:host.actor});platform.queryHistory(dir,{query:{},limit:200},host.actor);
 const saved=store.engine(dir).inspectReceipt(store.readState(dir).head,committed.query.id),id=saved.proofHash,bytes=store.readObject(dir,id),file=host.path.join(dir,'platform.sqlite');
 const write=json=>{const db=new DatabaseSync(file);try{db.prepare('UPDATE operation_ledger_objects SET json=? WHERE hash=?').run(json,id);}finally{db.close();}};
 write('{}');try{
  for(const read of [()=>host.storage.readSnapshot(dir,{principal:host.actor}),()=>platform.queryHistory(dir,{query:{},limit:200},host.actor),()=>host.storage.readOperation(dir,committed.query,host.actor)])assert.throws(read,error=>error.code==='LEDGER_HASH');
 }finally{write(bytes.toString('utf8'));}
 assert.equal(platform.queryHistory(dir,{query:{},limit:200},host.actor).rows.length,3);assert.equal(host.storage.readOperation(dir,committed.query,host.actor).operationReceipt.status,'committed');
});

test('indexed subject candidates retain insertion order and check fragments even when stored hashes collide',()=>{
 const value=fixture(),raw=JSON.parse(JSON.stringify(value.proof)),valid=raw.subjects[0],forged=structuredClone(valid);forged.after.note='Forged fragment with the original hash';
 for(const subjects of [[valid,forged],[forged,valid]]){const checked=evidence.validateProof({...raw,subjects});assert.equal(evidence.projectEvent(value.events[0],checked,actor).after.note,'Changed');assert.equal(evidence.projectEvent(value.events[0],checked,actor).after.note,'Changed');}
 const previousB=database({vehicles:[row(0,'B')]}),nextB=structuredClone(previousB);nextB.vehicles[0].note='Changed';const other=prepared('other-facts',previousB,nextB).proof.subjects[0],foreign={...valid,beforeFacts:other.beforeFacts,afterFacts:other.afterFacts},scoped=principal(['A']);
 const firstDenied=evidence.validateProof({...raw,subjects:[foreign,valid]}),firstAllowed=evidence.validateProof({...raw,subjects:[valid,foreign]});
 assert.equal(evidence.projectEvent(value.events[0],firstDenied,scoped),null);assert.equal(evidence.projectEvent(value.events[0],firstAllowed,scoped).after.note,'Changed');
 assert.equal(evidence.projectEvent(value.events[0],raw,actor).after.note,'Changed');raw.subjects[0].after.note='Caller mutation after index creation';assert.equal(evidence.projectEvent(value.events[0],raw,actor),null);
});

test('indexed subjects preserve idless occurrences, typed IDs and null create/delete phases',()=>{
 const cases=[];
 const typedBefore=database({vehicles:[row(0,'A'),row('0','B')]}),typedAfter=structuredClone(typedBefore);typedAfter.vehicles[0].note='Numeric zero';typedAfter.vehicles[1].note='Text zero';cases.push(prepared('typed-index',typedBefore,typedAfter));
 const idlessBefore=database({reestrRows:[{org:'A',site:'North',note:'Old',sum:0}]}),idlessAfter=structuredClone(idlessBefore);idlessAfter.reestrRows[0].note='Idless correction';cases.push(prepared('idless-index',idlessBefore,idlessAfter,{writes:['reestrRows']}));
 cases.push(prepared('create-index',database(),database({vehicles:[row(0,'A')]})));cases.push(prepared('delete-index',database({vehicles:[row(0,'A')]}),database()));
 for(const value of cases){const checked=evidence.validateProof(value.proof);for(const event of [...value.events,...value.events].reverse()){const result=evidence.projectEvent(event,checked,actor);assert.ok(result);assert.deepEqual(result.before,event.before);assert.deepEqual(result.after,event.after);const tampered=structuredClone(event);if(tampered.after)tampered.after.note='Tampered';else tampered.before.note='Tampered';assert.equal(evidence.projectEvent(tampered,checked,actor),null);}}
 const numeric=evidence.projectEvent(cases[0].events[0],evidence.validateProof(cases[0].proof),principal(['A']));assert.equal(numeric.after.id,0);assert.equal(evidence.projectEvent(cases[0].events[1],evidence.validateProof(cases[0].proof),principal(['A'])),null);
});

test('event guard lookup hashes the exact full event once regardless of its position in the proof',()=>{
 const crypto=require('node:crypto'),stable=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(stable).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}',value=fixture(),raw=structuredClone(value.proof),events=Array.from({length:80},(_,index)=>({...value.events[0],id:'hash-once-'+index}));
 raw.request.eventHashes=events.map(event=>'sha256:'+crypto.createHash('sha256').update(stable(event)).digest('hex'));raw.request.eventGuards=raw.request.eventHashes.map(hash=>({hash,fieldGuards:structuredClone(value.proof.request.eventGuards[0].fieldGuards)}));
 const checked=evidence.validateProof(raw),event=events.at(-1),needle=stable(event),createHash=crypto.createHash;let matchingUpdates=0;
 crypto.createHash=function(){const hash=createHash.apply(this,arguments),update=hash.update;hash.update=function(bytes){if(bytes===needle)matchingUpdates++;return update.apply(this,arguments);};return hash;};
 try{assert.equal(evidence.projectEvent(event,checked,actor).after.note,'Changed');assert.equal(matchingUpdates,1);}finally{crypto.createHash=createHash;}
 const tampered={...event,id:'Not in the original event hash set'};assert.equal(evidence.projectEvent(tampered,checked,actor),null);
});
