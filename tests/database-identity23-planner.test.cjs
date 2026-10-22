'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {identity,ROOT}=require('./helpers/database-identity23-fixtures.cjs'),{planner}=require('./helpers/database-identity23-harness.cjs'),format=require(require('node:path').join(ROOT,'electron/storage-format.cjs'));
const digest=char=>'sha256:'+char.repeat(64),clone=value=>JSON.parse(JSON.stringify(value));
function fixture(action='clone'){
 const record=identity(undefined,1),head={identity:identity(record.uuid,5),physicalKey:'synthetic/current',metadataStamp:digest('a')},input={action,source:{format:action==='restoreContinuation'?'backup':'json',identity:record,descriptor:format.describe(format.SCHEMA_VERSION),fingerprint:digest('1'),physicalKey:'synthetic/source'},target:{format:'sqlite',descriptor:format.describe(format.SCHEMA_VERSION),physicalKey:'synthetic/new'},reason:'Независимая проверка'},ctx={operationId:'identity-independent',at:'2026-10-23T00:00:00.000Z',actor:{id:'test',name:'Test',role:'admin'},newUuid:crypto.randomUUID()};if(action==='restoreContinuation'){input.continuationOf=head;input.knownHeads=[head];}return {input,ctx,head};
}
function checked(api,input,ctx){const preview=api.preview(input,ctx);assert.equal(preview.canApply,true,JSON.stringify(preview.issues));return {preview,plan:api.plan({...input,reviewFingerprint:preview.reviewFingerprint},ctx)};}
test('relocation preserves identity, clone pins a new uuid at generation1, every plan stays copy-only and detached from inputs',()=>{
 const api=planner();for(const action of ['relocate','clone']){const {input,ctx}=fixture(action),before=clone({input,ctx}),{preview,plan}=checked(api,input,ctx);assert.deepEqual({input,ctx},before);assert.deepEqual(plan.target.identity,action==='relocate'?input.source.identity:identity(ctx.newUuid,1));assert.deepEqual(plan.history.sourceIdentity,input.source.identity);assert.deepEqual(plan.history.targetIdentity,plan.target.identity);assert.deepEqual(plan.constraints,{sourceFingerprint:input.source.fingerprint,sourcePhysicalKey:input.source.physicalKey,targetPhysicalKey:input.target.physicalKey,headMetadataStamp:null,copyOnly:true,preserveBusinessBytes:true,retargetReceipts:false});assert.ok(Object.isFrozen(plan));assert.ok(Object.isFrozen(plan.history.targetIdentity));assert.deepEqual(api.plan({...clone(input),reviewFingerprint:preview.reviewFingerprint},clone(ctx)),plan);input.source.identity.generation=300;assert.equal(plan.source.identity.generation,1);}
});
test('continuation uses explicitly verified current generation5 even when archive is generation1',()=>{
 const api=planner(),{input,ctx,head}=fixture('restoreContinuation'),{plan}=checked(api,input,ctx);assert.deepEqual(plan.target.identity,identity(head.identity.uuid,6));assert.deepEqual(plan.predecessor,head);assert.equal(plan.history.sourceIdentity.generation,1);assert.equal(plan.constraints.headMetadataStamp,head.metadataStamp);
});
test('continuation refuses missing, foreign, stale, changed or ambiguous current predecessors and safe-integer overflow',()=>{
 const api=planner(),cases=[
  ['missing predecessor',input=>{delete input.continuationOf;}],
  ['unverified predecessor',input=>{input.knownHeads=[];}],
  ['changed current metadata',input=>{input.knownHeads[0].metadataStamp=digest('b');}],
  ['different lineage',input=>{input.continuationOf.identity.uuid=crypto.randomUUID();}],
  ['newer known generation',input=>{input.knownHeads.push({...clone(input.continuationOf),physicalKey:'synthetic/newer',identity:identity(input.source.identity.uuid,6)});}],
  ['contradictory same physical folder',input=>{input.knownHeads.push({...clone(input.continuationOf),identity:identity(input.source.identity.uuid,4)});}],
  ['overflow',input=>{input.continuationOf.identity.generation=Number.MAX_SAFE_INTEGER;input.knownHeads=[clone(input.continuationOf)];}],
  ['no archive identity',input=>{input.source.identity=null;}],
  ['current database is not a backup',input=>{input.source.format='json';}]
 ];for(const [label,change]of cases){const {input,ctx}=fixture('restoreContinuation');input.knownHeads=clone(input.knownHeads);change(input);const before=clone({input,ctx}),result=api.preview(input,ctx);assert.equal(result.canApply,false,label);assert.equal(result.plan,null,label);assert.equal(result.targetIdentity,null,label);assert.ok(result.issues.length>0,label);assert.deepEqual({input,ctx},before,label);assert.throws(()=>api.plan({...input,reviewFingerprint:digest('c')},ctx),label);}
});
test('old review rejects changed source fingerprint, identity, target, head proof, reason, actor and pinned clone uuid',()=>{
 const api=planner(),changes=[['source fingerprint',(input)=>input.source.fingerprint=digest('2')],['source identity',(input)=>input.source.identity.generation=2],['target',(input)=>input.target.physicalKey='synthetic/other'],['reason',(input)=>input.reason='Другое основание'],['actor',(_input,ctx)=>ctx.actor.id='different'],['newUuid',(_input,ctx)=>ctx.newUuid=crypto.randomUUID()]];
 for(const [label,change]of changes){const {input,ctx}=fixture(),review=api.preview(input,ctx);change(input,ctx);assert.throws(()=>api.plan({...input,reviewFingerprint:review.reviewFingerprint},ctx),{code:'STALE_REVIEW'},label);}
 const {input,ctx}=fixture('restoreContinuation'),review=api.preview(input,ctx);input.continuationOf.metadataStamp=digest('b');input.knownHeads=[clone(input.continuationOf)];assert.throws(()=>api.plan({...input,reviewFingerprint:review.reviewFingerprint},ctx),{code:'STALE_REVIEW'});
});
test('review fingerprint is clock-independent while history records the explicitly supplied journal timestamp',()=>{
 const api=planner(),{input,ctx}=fixture(),review=api.preview(input,ctx);ctx.at='2026-10-23T00:00:01.000Z';const plan=api.plan({...input,reviewFingerprint:review.reviewFingerprint},ctx);assert.equal(plan.reviewFingerprint,review.reviewFingerprint);assert.equal(plan.history.at,ctx.at);
});
test('clone rejects reused uuid, relocation rejects a superseded source and no action can overwrite its physical source',()=>{
 const api=planner();{const {input,ctx}=fixture();ctx.newUuid=input.source.identity.uuid;assert.equal(api.preview(input,ctx).canApply,false);}{const {input,ctx}=fixture('relocate');input.knownHeads=[{identity:identity(input.source.identity.uuid,2),physicalKey:'synthetic/newer',metadataStamp:digest('a')}];assert.equal(api.preview(input,ctx).canApply,false);}for(const action of ['relocate','clone','restoreContinuation']){const {input,ctx}=fixture(action);input.target.physicalKey=input.source.physicalKey;assert.equal(api.preview(input,ctx).canApply,false);}
});
test('planner rejects getters, cycles, sparse arrays and unknown fields without executing supplied code',()=>{
 const api=planner();let ran=0;const {input,ctx}=fixture();Object.defineProperty(input,'unknown',{enumerable:true,get(){ran++;return 1;}});assert.equal(api.preview(input,ctx).canApply,false);assert.equal(ran,0);for(const change of [value=>{value.source.self=value;},value=>{value.knownHeads=new Array(1);},value=>{value.source.arbitrary='private';},value=>{Object.defineProperty(value.source,'toJSON',{value(){ran++;return {};},enumerable:true});}]){const current=fixture();change(current.input);assert.equal(api.preview(current.input,current.ctx).canApply,false);}assert.equal(ran,0);
});
test('copy-only planning refuses a target already occupied by a verified known profile',()=>{
 const api=planner();for(const action of ['relocate','clone','restoreContinuation']){const {input,ctx,head}=fixture(action),occupied={identity:identity(),physicalKey:input.target.physicalKey,metadataStamp:digest('b')};input.knownHeads=action==='restoreContinuation'?[head,occupied]:[occupied];const result=api.preview(input,ctx);assert.equal(result.canApply,false,action+' must refuse a verified occupied target');assert.equal(result.plan,null);assert.equal(result.targetIdentity,null);}
});
