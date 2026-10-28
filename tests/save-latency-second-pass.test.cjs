'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),Module=require('node:module');
const evidence=require('../electron/operation-evidence.cjs'),ledger=require('../electron/operation-ledger.cjs'),safe=require('../electron/safe-file.cjs'),schema=require('../assets/core/platform-schema.js');
const {actor,principal,database,row,prepared,memory}=require('./helpers/operation-history25-fixtures.cjs');
// Freeze the independent 3.5.20 host algorithm. It still uses the same unchanged
// policy primitives, but has none of the new permission or facts shortcuts.
const virtual=path.resolve(__dirname,'../electron/reference-evidence-3.5.20.cjs'),referenceModule=new Module(virtual,module);referenceModule.filename=virtual;referenceModule.paths=Module._nodeModulePaths(path.dirname(virtual));referenceModule._compile(fs.readFileSync(path.join(__dirname,'fixtures/operation-evidence-v3.5.20.cjs'),'utf8'),virtual);const reference=referenceModule.exports;
function sameRejection(value){let expected;try{reference.validateProof(value);}catch(error){expected=error.code;}assert.ok(expected,'Reference must reject the malformed proof');assert.throws(()=>evidence.validateProof(value),{code:expected});}
function fixture(){const before=database({vehicles:[row(0,'A'),row('0','B')]}),next=structuredClone(before);next.vehicles[0].note='Numeric zero';next.vehicles[1].note='Text zero';return prepared('latency-permissions',before,next,{targets:[{section:'vehicles',id:0},{section:'vehicles',id:'0'}]});}
function matrix(){return [actor,{...actor,id:'Other actor'},principal(['A']),principal(['A','B']),principal([]),{...actor,accessPolicy:{version:1,grants:[{org:{any:true},site:{any:true},actions:['*']}]}},...['viewer','dispatcher','accountant','mechanic'].map(role=>({...actor,role})),{...actor,readable:schema.sections.filter(name=>name!=='payments')},{...actor,writable:[]},principal(['A'],{readFields:{vehicles:['id','org','site']}}),{...actor,actions:{vehicles:['read']}},{...actor,readFields:{vehicles:['*']},writeFields:{vehicles:['note']}}];}
test('optimized proof authorization and event output match the frozen 3.5.20 algorithm for current grants and role ceilings',()=>{
 const value=fixture(),variants=[value.proof,structuredClone(value.proof)];
 for(const subject of [...variants[1].subjects,...variants[1].request.selectedTargets])for(const phase of ['before','after'])if(subject[phase]!==null)subject[phase+'Facts']={kind:'unknown',owners:[],readRequirements:{sections:['vehicles'],owners:[],complete:false},fieldGuards:[{path:['note'],requires:{sections:['payments'],owners:[],complete:false},deniedValue:'Redacted'}]};
 for(const raw of variants){const before=JSON.stringify(raw);assert.deepEqual(evidence.validateProof(raw),reference.validateProof(raw));for(const current of matrix()){
   assert.equal(evidence.authorizeProof(raw,current,value.receipt),reference.authorizeProof(raw,current,value.receipt));
   const projector=evidence.createEventProjector(current),old=reference.createEventProjector(current);
   for(const event of value.events)assert.deepEqual(projector.projectEvent(event,raw),old.projectEvent(event,raw));
   const tampered={...value.events[0],id:'Not covered'};assert.deepEqual(projector.projectEvent(tampered,raw),old.projectEvent(tampered,raw));
  }assert.equal(JSON.stringify(raw),before);}
});
test('unrestricted optimization keeps draft-origin and period-domain access checks',()=>{
 const value=fixture(),draft=structuredClone(value.proof.subjects[0]);draft.section='documentDrafts';draft.before={id:0,section:'UNKNOWN'};draft.after={id:0,section:'UNKNOWN',note:'Update'};
 const raw=structuredClone(value.proof);raw.subjects.push(draft);raw.requiredSections.push('documentDrafts');assert.equal(evidence.authorizeProof(raw,actor,value.receipt),false);assert.equal(reference.authorizeProof(raw,actor,value.receipt),false);
 const period=structuredClone(value.proof);period.subjects[0].section='fuelPeriods';period.requiredSections.push('fuelPeriods');period.subjects[0].before={id:0,month:'2026-10',financeClosed:false};period.subjects[0].after={id:0,month:'2026-10',financeClosed:true};period.subjects[0].changedFields=['financeClosed'];
 for(const current of matrix())assert.equal(evidence.authorizeProof(period,current,value.receipt),reference.authorizeProof(period,current,value.receipt));
});
test('repeated owned facts remain fully checked when a later fact or unused guard is malformed',()=>{
 const raw=structuredClone(fixture().proof);raw.request.selectedTargets=Array.from({length:100},()=>structuredClone(raw.request.selectedTargets[0]));
 assert.deepEqual(evidence.validateProof(raw),reference.validateProof(raw));
 for(const mutate of [facts=>{facts.extra=true;},facts=>{facts.kind='INVALID';},facts=>{facts.fieldGuards=[{path:[],requires:{sections:['vehicles'],owners:[],complete:true}}];}]){
  const bad=structuredClone(raw);mutate(bad.request.selectedTargets.at(-1).afterFacts);sameRejection(bad);
 }
 let called=0;const bad=structuredClone(raw);Object.defineProperty(bad.request.selectedTargets.at(-1).afterFacts,'hidden',{enumerable:true,get(){called++;return 1;}});assert.throws(()=>evidence.validateProof(bad),{code:'OPERATION_EVIDENCE_INVALID'});assert.equal(called,0);
});
test('only ledger-owned strict immutable JSON can avoid a defensive copy; ownership does not validate proof contents',()=>{
 const value=fixture(),store=memory();store.append(value);const decoded=store.engine.inspectReceipt(store.head,value.receipt.operation.id).proof;
 assert.equal(ledger.isOwnedStrictJSON(decoded),true);assert.equal(evidence.validateProof(decoded),decoded);
 const forged=structuredClone(decoded);Object.freeze(forged);assert.equal(ledger.isOwnedStrictJSON(forged),false);assert.notEqual(evidence.validateProof(forged),forged);
 for(const change of [proof=>{proof.subjects[0].beforeFacts.kind='INVALID';},proof=>{proof.request.unused={toJSON:'Literal JSON field'};}]){
  const bad=structuredClone(value);change(bad.proof);const other=memory();other.append(bad);const owned=other.engine.inspectReceipt(other.head,bad.receipt.operation.id).proof;
  sameRejection(owned);
 }
});
test('facts memo does not execute inherited JSON hooks or accept a changed fact after a cache hit',()=>{
 const raw=structuredClone(fixture().proof);raw.request.selectedTargets.push(structuredClone(raw.request.selectedTargets[0]));raw.request.selectedTargets.at(-1).afterFacts.extra=true;
 assert.equal(Object.hasOwn(Object.prototype,'toJSON'),false);let calls=0;Object.defineProperty(Object.prototype,'toJSON',{configurable:true,value(){calls++;return 'Collapsed';}});
 try{sameRejection(raw);assert.equal(calls,0);}finally{delete Object.prototype.toJSON;}
});
function temp(t){const parent=fs.realpathSync.native(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'tvs-path-latency-')),pin=fs.lstatSync(root),links=[];t.after(()=>{const st=fs.lstatSync(root);assert.equal(path.dirname(path.resolve(root)),parent);assert.match(path.basename(root),/^tvs-path-latency-/);assert.equal(st.isSymbolicLink(),false);assert.equal(st.dev,pin.dev);assert.equal(st.ino,pin.ino);for(const link of links)if(fs.lstatSync(link).isSymbolicLink())fs.unlinkSync(link);fs.rmSync(root,{recursive:true,force:true});});return {root,links};}
test('regular-file checks resolve the complete path a bounded number of times while preserving all bytes',t=>{
 const {root}=temp(t),dir=path.join(root,'a/b/c/d/e/f');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'data.json');fs.writeFileSync(file,'SYNTHETIC');let canonical=0;
 const reader=safe.createSafeFileReader({...fs,realpathSync(value){canonical++;return fs.realpathSync(value);}});assert.equal(reader.readRegularFileSync(file,{maxBytes:20}).toString(),'SYNTHETIC');assert.ok(canonical<=5,canonical+' complete-path resolutions');
});
test('an ancestor replaced with a junction during verification is rejected before reading',t=>{
 const {root,links}=temp(t),parent=path.join(root,'parent'),alternate=path.join(root,'alternate');fs.mkdirSync(path.join(parent,'child'),{recursive:true});fs.mkdirSync(path.join(alternate,'child'),{recursive:true});fs.writeFileSync(path.join(parent,'child/data.txt'),'ORIGINAL');fs.writeFileSync(path.join(alternate,'child/data.txt'),'PRIVATE');let changed=false,reads=0;
 const reader=safe.createSafeFileReader({...fs,lstatSync(value){const st=fs.lstatSync(value);if(path.resolve(value)===parent&&!changed){changed=true;fs.renameSync(parent,parent+'-original');fs.symlinkSync(alternate,parent,process.platform==='win32'?'junction':'dir');links.push(parent);}return st;},readSync(...args){reads++;return fs.readSync(...args);}});
 assert.throws(()=>reader.readRegularFileSync(path.join(parent,'child/data.txt'),{maxBytes:20}),error=>['SAFE_FILE_INVALID','SAFE_FILE_CHANGED'].includes(error.code));assert.equal(reads,0);
});
test('SQLite object reads share only one physical snapshot, return separate bytes and see newly appended objects',t=>{
 const {root}=temp(t),sql=require('../electron/sqlite-storage.cjs'),{DatabaseSync}=require('node:sqlite'),crypto=require('node:crypto'),dir=path.join(root,'db');sql.create(dir,{data:database()});
 const json=JSON.stringify({kind:'synthetic-snapshot',value:0}),id=crypto.createHash('sha256').update(json).digest('hex'),prepare=DatabaseSync.prototype.prepare;let selects=0;
 DatabaseSync.prototype.prepare=function(query){if(query==='SELECT json FROM operation_ledger_objects WHERE hash=?')selects++;return prepare.apply(this,arguments);};
 try{sql.transaction(dir,()=>{assert.equal(sql.readOperationObject(dir,id),null);sql.putOperationObjects(dir,[{id,json}]);const before=selects,first=sql.readOperationObject(dir,id);first[0]^=1;assert.equal(sql.readOperationObject(dir,id).toString(),json);assert.equal(selects,before+1);});
  const direct=new DatabaseSync(sql.filename(dir));try{direct.prepare('UPDATE operation_ledger_objects SET json=? WHERE hash=?').run('CORRUPTED AFTER COMMIT',id);}finally{direct.close();}
  assert.equal(sql.readOperationObject(dir,id).toString(),'CORRUPTED AFTER COMMIT');
 }finally{DatabaseSync.prototype.prepare=prepare;}
});
test('SQLite rollback discards snapshot objects and the next transaction sees their absence',t=>{
 const {root}=temp(t),sql=require('../electron/sqlite-storage.cjs'),crypto=require('node:crypto'),dir=path.join(root,'db');sql.create(dir,{data:database()});const json=JSON.stringify({synthetic:'rolled-back'}),id=crypto.createHash('sha256').update(json).digest('hex');
 assert.throws(()=>sql.transaction(dir,()=>{sql.putOperationObjects(dir,[{id,json}]);assert.equal(sql.readOperationObject(dir,id).toString(),json);throw Error('Synthetic rollback');}),/Synthetic rollback/);assert.equal(sql.readOperationObject(dir,id),null);
});
