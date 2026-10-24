'use strict';
// Synthetic organizational plans only. No profiles, disks, GUI or system clock.
const {test}=require('node:test'),assert=require('node:assert/strict');
const api=require('../assets/core/generator-maintenance.js'),hash=require('../assets/core/request-fingerprint.js');
const copy=value=>JSON.parse(JSON.stringify(value));
const person=(name='Synthetic chairman')=>({name,position:'Synthetic position'});
const planRow=(id=0,generatorId=0,partId=0)=>({id,generatorId,site:'Synthetic site',type:'ТО-1',plannedHours:250,plannedDate:'2026-11-05',work:'Replace synthetic filter',note:'Synthetic plan only',components:[{partId,qty:2}]});
const payload=(extra={})=>({org:'Synthetic organization',year:2026,title:'Synthetic annual maintenance',rows:[planRow()],commission:{chairman:person(),members:[]},...extra});
function database(extra={}){return {appMeta:[],generatorMaintenancePlans:[],generators:[{id:0,name:'Synthetic DES zero',org:'Synthetic organization',site:'Synthetic site',hoursInit:0},{id:'0',name:'Synthetic DES string zero',org:'Synthetic organization',site:'Other site',hoursInit:100}],genRecords:[{id:0,generatorId:0,date:'2026-10-01',hours:10,meterEnd:120},{id:'0',generatorId:'0',date:'2026-10-02',hours:20,meterEnd:200}],parts:[{id:0,generatorId:0,name:'Synthetic filter',article:'FILTER-0',unit:'шт'},{id:'0',generatorId:'0',name:'Synthetic belt',article:'BELT-0',unit:'шт'},{id:'common',name:'Common stock filter',unit:'шт'}],partMovements:[{id:'receipt-0',partId:0,date:'2026-10-01',kind:'receipt',qty:1},{id:'receipt-string',partId:'0',date:'2026-10-01',kind:'receipt',qty:5}],toRecords:[],workOrders:[],payments:[],...extra};}
const context=(id='synthetic-plan',extra={})=>({id,now:'2026-10-24T10:00:00.000Z',today:'2026-10-24',actor:{id:'synthetic-user',name:'Synthetic approver',role:'mechanic'},...extra});
const previewContext={today:'2026-10-24'};
const save=(value=payload(),id)=>({action:'saveDraft',...(id===undefined?{}:{planId:id}),payload:value,reason:'Synthetic planning decision'});
function execute(db,input,ctx=context()){const preview=api.preview(db,input,{today:ctx.today,...(ctx.calendar?{calendar:ctx.calendar}:{}),...(ctx.readable?{readable:ctx.readable}:{})});const command={...input,reviewFingerprint:preview.fingerprint};return {preview,command,result:api.apply(db,command,ctx)};}
const merged=(db,result)=>({...db,...copy(result.sections)});
function draft(db=database(),value=payload(),ctx=context()){const result=execute(db,save(value),ctx).result;return merged(db,result);}
function approved(db=draft(),id='synthetic-plan',ctx=context('synthetic-approval')){return merged(db,execute(db,{action:'approve',planId:id,date:'2026-10-24',document:'Synthetic decision No. 1',reason:'Synthetic signed decision'},ctx).result);}
function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
const errorCode=(code)=>error=>error.code===code;

test('incomplete drafts retain explicit unknowns and change only the plan section',()=>{
 const db=freeze(database()),before=JSON.stringify(db),body=freeze(payload({org:'',year:null,title:'',rows:[],commission:{chairman:person(''),members:[]}}));
 const {preview,result}=execute(db,save(body));assert.equal(preview.canApply,true);assert.ok(preview.warnings.some(issue=>issue.code==='MAINTENANCE_YEAR_REQUIRED'));
 assert.deepEqual(result.writeSections,['generatorMaintenancePlans']);assert.deepEqual(Object.keys(result.sections),['generatorMaintenancePlans']);assert.equal(result.plan.status,'draft');assert.equal(result.plan.year,null);assert.equal(result.plan.id,'synthetic-plan');assert.equal(result.plan.rootId,'synthetic-plan');assert.equal(result.plan.revision,1);assert.equal(result.plan.snapshot,undefined);assert.equal(result.plan.approval,undefined);assert.equal(result.entityIds.planId,'synthetic-plan');assert.ok(Object.isFrozen(result.plan));assert.equal(JSON.stringify(db),before);
});

test('approval freezes typed generator and part references, all displayed content and literal hostile labels',()=>{
 const raw=database();raw.generators[0].name='<img src=x onerror=bad()> & synthetic';raw.parts[0].name='<script>synthetic</script>';
 const body=payload({rows:[planRow(),planRow('0','0','0')]}),db=draft(raw,body),before=JSON.stringify(db),next=approved(db),plan=next.generatorMaintenancePlans[0],snapshot=plan.snapshot;
 assert.equal(plan.status,'approved');assert.equal(plan.approval.actor,'Synthetic approver');assert.equal(plan.approval.date,'2026-10-24');assert.deepEqual(snapshot.approval,plan.approval);assert.equal(snapshot.planId,plan.id);assert.equal(snapshot.rootId,plan.rootId);assert.equal(snapshot.revision,plan.revision);assert.equal(snapshot.previousId,undefined);assert.equal(plan.fingerprint,api.snapshotDigest(snapshot));assert.equal(plan.fingerprint,'sha256:'+hash.sha256(hash.stableSerialize(snapshot)));
 assert.equal(snapshot.rows[0].generator.id,0);assert.equal(snapshot.rows[1].generator.id,'0');assert.equal(snapshot.rows[0].generator.hours,120);assert.equal(snapshot.rows[1].generator.hours,200);assert.equal(snapshot.rows[0].generator.hoursSource.id,0);assert.equal(snapshot.rows[0].generator.name,raw.generators[0].name);assert.equal(snapshot.rows[0].components[0].part.name,raw.parts[0].name);assert.equal(snapshot.rows[1].components[0].part.article,'BELT-0');assert.deepEqual(snapshot.commission,body.commission);assert.equal(JSON.stringify(db),before);
 for(const name of ['parts','partMovements','genRecords','toRecords','workOrders','payments'])assert.deepEqual(next[name],raw[name]);
});

test('an organizational demand above stock is an explicit warning without reservation or material write',()=>{
 const db=draft(),input={action:'approve',planId:'synthetic-plan',date:'2026-10-24',document:'Synthetic decision',reason:'Synthetic approval'},before=JSON.stringify(db),result=execute(db,input,context('approve-shortage'));
 assert.equal(result.preview.canApply,true);assert.ok(result.preview.warnings.some(issue=>issue.code==='MAINTENANCE_STOCK_SHORTAGE'&&issue.partId===0));assert.equal(Object.keys(result.result.sections).length,1);assert.equal(JSON.stringify(db),before);assert.deepEqual(merged(db,result.result).partMovements,db.partMovements);
});

test('approval requires real organization, year, hours, dates, works and commissioner identity',()=>{
 for(const change of [value=>value.org='',value=>value.year=null,value=>value.title='',value=>value.rows=[],value=>value.rows[0].plannedHours=null,value=>value.rows[0].plannedDate='',value=>value.rows[0].site='',value=>value.rows[0].type='',value=>value.rows[0].work='',value=>value.commission.chairman.name='',value=>value.commission.chairman.position='',value=>value.commission.members=[person('')],value=>value.rows[0].components[0].qty=null,value=>value.rows[0].components[0].qty=0,value=>value.rows[0].plannedDate='2027-01-01']){
  const body=payload();change(body);const db=draft(database(),body),input={action:'approve',planId:'synthetic-plan',date:'2026-10-24',document:'Synthetic decision',reason:'Synthetic review'},review=api.preview(db,input,previewContext);
  assert.equal(review.canApply,false);assert.ok(review.issues.length);assert.throws(()=>api.apply(db,{...input,reviewFingerprint:review.fingerprint},context('blocked-approve')),errorCode('MAINTENANCE_BLOCKED'));
 }
 const zero=payload();zero.rows[0].plannedHours=0;assert.equal(api.preview(draft(database(),zero),{action:'approve',planId:'synthetic-plan',date:'2026-10-24',document:'Zero is explicit',reason:'Synthetic approval'},previewContext).canApply,true);
});

test('numeric strings, hexadecimal, booleans, non-finite, negatives and precision loss never enter a draft',()=>{
 for(const value of ['0x10','16',true,-1,1.0001,1e12+1,Infinity,NaN]){
  const body=payload();body.rows[0].plannedHours=value;assert.throws(()=>api.preview(database(),save(body),previewContext));
  const components=payload();components.rows[0].components[0].qty=value;assert.throws(()=>api.preview(database(),save(components),previewContext));
 }
 for(const value of ['2026',true,0,1899,10000,2026.5])assert.throws(()=>api.preview(database(),save(payload({year:value})),previewContext));
 const invalid=payload();invalid.rows[0].plannedDate='2026-02-30';assert.throws(()=>api.preview(database(),save(invalid),previewContext),errorCode('MAINTENANCE_DATE'));
});

test('the same text for numeric and string IDs never permits a cross-owned or common stock component',()=>{
 for(const partId of ['0','common']){const body=payload();body.rows[0].components[0].partId=partId;const review=api.preview(database(),save(body),previewContext);assert.equal(review.canApply,false);assert.ok(review.issues.some(issue=>issue.code==='MAINTENANCE_PART_OWNER'&&issue.generatorId===0&&issue.partId===partId));}
 const body=payload();body.rows[0].generatorId='0';body.rows[0].components[0].partId='0';assert.equal(api.preview(database(),save(body),previewContext).canApply,true);
});

test('duplicate, missing, archived and differently owned references cannot be approved',()=>{
 for(const mutate of [db=>db.generators.push(copy(db.generators[0])),db=>db.generators[0].archived=true,db=>db.generators[0].org='Other organization',db=>db.generators=[],db=>db.parts.push(copy(db.parts[0])),db=>db.parts[0].archived=true,db=>db.parts=[]]){
  const db=draft();mutate(db);const review=api.preview(db,{action:'approve',planId:'synthetic-plan',date:'2026-10-24',document:'Synthetic decision',reason:'Synthetic review'},previewContext);assert.equal(review.canApply,false);assert.ok(review.issues.length);
 }
 const duplicate=payload();duplicate.rows.push(copy(duplicate.rows[0]));assert.throws(()=>api.preview(database(),save(duplicate),previewContext),errorCode('MAINTENANCE_ROW_ID'));
 const repeated=payload();repeated.rows[0].components.push(copy(repeated.rows[0].components[0]));assert.throws(()=>api.preview(database(),save(repeated),previewContext),errorCode('MAINTENANCE_COMPONENT_ID'));
});

test('a new revision appends a draft while every byte of the approved document stays unchanged',()=>{
 const db=approved(),old=JSON.stringify(db.generatorMaintenancePlans[0]),next=merged(db,execute(db,{action:'revise',planId:'synthetic-plan',reason:'Synthetic changed annual plan'},context('revision-two')).result),revision=next.generatorMaintenancePlans[1];
 assert.equal(JSON.stringify(next.generatorMaintenancePlans[0]),old);assert.equal(revision.id,'revision-two');assert.equal(revision.rootId,'synthetic-plan');assert.equal(revision.previousId,'synthetic-plan');assert.equal(revision.revision,2);assert.equal(revision.status,'draft');for(const field of ['snapshot','approval','fingerprint'])assert.equal(revision[field],undefined);
 assert.equal(api.preview(next,{action:'revise',planId:'synthetic-plan',reason:'Duplicate branch attempt'},previewContext).canApply,false);
 const changed=copy(revision);changed.title='Synthetic revision changed';const edited=execute(next,save(payload({title:changed.title}),'revision-two'),context('edit-revision')).result;assert.equal(edited.plan.revision,2);assert.equal(edited.plan.rootId,'synthetic-plan');assert.equal(JSON.stringify(edited.sections.generatorMaintenancePlans[0]),old);
});

test('approved presentation and its digest do not change when live names, parts and meters change',()=>{
 const db=approved(),before=JSON.stringify(db.generatorMaintenancePlans[0]),digest=db.generatorMaintenancePlans[0].fingerprint;
 db.generators[0].name='Renamed live DES';db.parts[0].article='RENAMED';db.genRecords[0].meterEnd=999;
 assert.equal(JSON.stringify(db.generatorMaintenancePlans[0]),before);assert.equal(api.snapshotDigest(db.generatorMaintenancePlans[0].snapshot),digest);assert.equal(db.generatorMaintenancePlans[0].snapshot.rows[0].generator.hours,120);
 const altered=copy(db.generatorMaintenancePlans[0].snapshot);altered.rows[0].generator.name='Tampered frozen label';assert.notEqual(api.snapshotDigest(altered),digest);
 const input=save(payload(),'synthetic-plan');assert.equal(api.preview(db,input,previewContext).canApply,false);
});

test('the approved digest covers the decision and printed revision identity, not only table labels',()=>{
 const db=approved(),original=db.generatorMaintenancePlans[0];
 for(const mutate of [value=>value.approval.document='Another decision',value=>value.approval.date='2026-10-23',value=>value.approval.actor='Another approver',value=>value.planId=0,value=>value.rootId=0,value=>value.revision=2,value=>value.previousId='forged']){const snapshot=copy(original.snapshot);mutate(snapshot);assert.notEqual(api.snapshotDigest(snapshot),original.fingerprint);}
 for(const mutate of [value=>value.approval.document='Another decision',value=>value.rootId='other',value=>value.revision=2]){const broken=copy(db);mutate(broken.generatorMaintenancePlans[0]);const review=api.preview(broken,{action:'revise',planId:'synthetic-plan',reason:'Synthetic integrity check'},previewContext);assert.equal(review.canApply,false);}
 const secondDraft=merged(db,execute(db,{action:'revise',planId:'synthetic-plan',reason:'Synthetic revision'},context('second-digest')).result),second=approved(secondDraft,'second-digest',context('approve-second-digest')).generatorMaintenancePlans[1];assert.equal(second.snapshot.previousId,'synthetic-plan');assert.equal(second.snapshot.revision,2);assert.equal(second.snapshot.rootId,'synthetic-plan');assert.equal(second.fingerprint,api.snapshotDigest(second.snapshot));
});

test('raw writes cannot approve, rewrite a frozen plan, forge revision metadata or delete history',()=>{
 const initial=draft(),published=approved(initial),change=copy(initial);change.generatorMaintenancePlans[0]=copy(published.generatorMaintenancePlans[0]);assert.throws(()=>api.validateChanges(initial,change),errorCode('MAINTENANCE_PROOF'));
 for(const alter of [value=>value.title='Forged title',value=>value.revision=7,value=>value.status='draft',value=>value.snapshot.rows[0].generator.name='Forgery',value=>value.fingerprint='sha256:'+'0'.repeat(64)]){const next=copy(published);alter(next.generatorMaintenancePlans[0]);assert.throws(()=>api.validateChanges(published,next));}
 const erased=copy(published);erased.generatorMaintenancePlans=[];assert.throws(()=>api.validateChanges(published,erased),errorCode('MAINTENANCE_DELETE'));
 for(const alter of [value=>value.revision=2,value=>value.rootId=0,value=>value.previousId='other',value=>value.createdAt='2026-01-01T00:00:00.000Z']){const next=copy(initial);alter(next.generatorMaintenancePlans[0]);assert.throws(()=>api.validateChanges(initial,next),errorCode('MAINTENANCE_PROOF'));}
 const revision=merged(published,execute(published,{action:'revise',planId:'synthetic-plan',reason:'Synthetic revision'},context('revision-delete')).result),removed=copy(revision);removed.generatorMaintenancePlans.pop();assert.throws(()=>api.validateChanges(revision,removed),errorCode('MAINTENANCE_DELETE'));
});

test('trusted transition validation recomputes the command and rejects extra writes and forged authors',()=>{
 const db=draft(),input={action:'approve',planId:'synthetic-plan',date:'2026-10-24',document:'Synthetic decision',reason:'Synthetic approval'},ctx=context('trusted-approve'),performed=execute(db,input,ctx),next=merged(db,performed.result),proof={...ctx,commandIntent:{command:{type:'GeneratorMaintenanceAction',version:1,input:performed.command}}};
 assert.equal(api.validateChanges(db,next,proof),true);
 const extra=copy(next);extra.partMovements.push({id:'forged',partId:0,date:'2026-10-24',kind:'receipt',qty:100});assert.throws(()=>api.validateChanges(db,extra,proof),errorCode('MAINTENANCE_PROOF'));
 const forged=copy(next);forged.generatorMaintenancePlans[0].approval.actor='Client-supplied author';assert.throws(()=>api.validateChanges(db,forged,proof),errorCode('MAINTENANCE_PROOF'));
 assert.throws(()=>api.validateChanges(db,next,{...proof,actor:{...ctx.actor,role:'viewer'}}),errorCode('ACCESS_DENIED'));
});

test('raw draft content may be repaired while protected structure and numeric errors remain guarded',()=>{
 const before=draft(),after=copy(before);after.generatorMaintenancePlans[0].title='Corrected draft title';after.generatorMaintenancePlans[0].rows[0].plannedHours=null;assert.equal(api.validateChanges(before,after),true);
 const malformed=copy(after);malformed.generatorMaintenancePlans[0].rows[0].plannedHours='0x10';assert.throws(()=>api.validateChanges(before,malformed),errorCode('MAINTENANCE_NUMBER'));
 const newDraft=copy(before);newDraft.generatorMaintenancePlans[0].id=0;newDraft.generatorMaintenancePlans[0].rootId=0;assert.equal(api.validateChanges(database(),newDraft),true);
 newDraft.generatorMaintenancePlans[0].revision=2;assert.throws(()=>api.validateChanges(database(),newDraft),errorCode('MAINTENANCE_PROOF'));
});

test('typed zero plan IDs are addressed exactly and damaged revision sources cannot be approved',()=>{
 const db=draft(),first=db.generatorMaintenancePlans[0];first.id=0;first.rootId=0;const other=copy(first);other.id='0';other.rootId='0';other.title='Distinct string-zero plan';db.generatorMaintenancePlans.push(other);
 const performed=execute(db,{action:'approve',planId:0,date:'2026-10-24',document:'Typed zero decision',reason:'Synthetic approval'},context('approve-number-zero'));
 assert.equal(performed.result.plan.id,0);assert.equal(performed.result.sections.generatorMaintenancePlans[1].status,'draft');assert.equal(performed.result.sections.generatorMaintenancePlans[1].id,'0');
 for(const mutate of [value=>value.rootId='wrong',value=>value.revision=2,value=>value.previousId='absent',value=>value.snapshot={}]){const broken=copy(db);mutate(broken.generatorMaintenancePlans[0]);const review=api.preview(broken,{action:'approve',planId:0,date:'2026-10-24',document:'Synthetic decision',reason:'Synthetic approval'},previewContext);assert.equal(review.canApply,false);}
});

test('revision three follows the latest approved revision without rewriting earlier snapshots',()=>{
 const first=approved(),secondDraft=merged(first,execute(first,{action:'revise',planId:'synthetic-plan',reason:'Synthetic second revision'},context('second')).result),second=approved(secondDraft,'second',context('approve-second')),before=JSON.stringify(second.generatorMaintenancePlans),third=merged(second,execute(second,{action:'revise',planId:'second',reason:'Synthetic third revision'},context('third')).result);
 assert.equal(third.generatorMaintenancePlans[2].revision,3);assert.equal(third.generatorMaintenancePlans[2].rootId,'synthetic-plan');assert.equal(third.generatorMaintenancePlans[2].previousId,'second');assert.equal(JSON.stringify(third.generatorMaintenancePlans.slice(0,2)),before);
 assert.equal(api.preview(second,{action:'revise',planId:'synthetic-plan',reason:'Attempt old branch'},previewContext).canApply,false);
});

test('source, intent, working date and calendar changes invalidate the reviewed action',()=>{
 const db=database(),input=save(),review=api.preview(db,input,previewContext),command={...input,reviewFingerprint:review.fingerprint};
 for(const mutate of [value=>value.generators[0].name='Renamed',value=>value.parts[0].article='Changed',value=>value.partMovements[0].qty=5,value=>value.genRecords[0].meterEnd=130]){const changed=copy(db);mutate(changed);assert.throws(()=>api.apply(changed,command,context()),errorCode('STALE_REVIEW'));}
 assert.throws(()=>api.apply(db,{...command,reason:'Different decision'},context()),errorCode('STALE_REVIEW'));
 assert.throws(()=>api.apply(db,command,context('next-day',{now:'2026-10-25T10:00:00.000Z',today:'2026-10-25'})),errorCode('STALE_REVIEW'));
 assert.throws(()=>api.apply(db,command,context('wrong-business-day',{today:'2026-10-25'})),errorCode('CALENDAR_DATE_CHANGED'));
});

test('approval dates respect the business day and earlier legitimate planned hours are not rewritten',()=>{
 const db=draft();assert.equal(api.preview(db,{action:'approve',planId:'synthetic-plan',date:'2026-10-25',document:'Future decision',reason:'Synthetic review'},previewContext).canApply,false);
 const body=payload();body.rows[0].plannedHours=5;body.rows[0].plannedDate='2026-09-01';const historical=approved(draft(database(),body));assert.equal(historical.generatorMaintenancePlans[0].snapshot.rows[0].plannedHours,5);
 body.rows[0].plannedDate='2026-11-01';const review=api.preview(draft(database(),body),{action:'approve',planId:'synthetic-plan',date:'2026-10-24',document:'Reviewed target',reason:'Synthetic decision'},previewContext);assert.equal(review.canApply,true);assert.ok(review.warnings.some(issue=>issue.code==='MAINTENANCE_HOURS_BELOW_COUNTER'));
});

test('counter snapshots use dated observations without inventing unknowns or borrowing future rows',()=>{
 for(const [records,initial,expected]of [[[],0,0],[[],undefined,null],[[{id:'future',generatorId:0,date:'2026-12-01',meterEnd:999}],5,5],[[{id:'unknown',generatorId:0,date:'2026-10-20',hours:5}],5,null],[[{id:'undated',generatorId:0,date:'',hours:5}],5,null]]){
  const raw=database({genRecords:records});if(initial===undefined)delete raw.generators[0].hoursInit;else raw.generators[0].hoursInit=initial;const plan=approved(draft(raw)).generatorMaintenancePlans[0];assert.equal(plan.snapshot.rows[0].generator.hours,expected);
 }
});

test('read and write permissions are checked again by the trusted action',()=>{
 const db=database(),input=save(),preview=api.preview(db,input,previewContext),command={...input,reviewFingerprint:preview.fingerprint};
 assert.throws(()=>api.preview(db,input,{today:'2026-10-24',readable:['generators']}),errorCode('ACCESS_DENIED'));
 assert.throws(()=>api.apply(db,command,context('limited',{writable:['generators']})),errorCode('ACCESS_DENIED'));
 assert.throws(()=>api.apply(db,command,context('viewer',{actor:{id:'viewer',name:'Viewer',role:'viewer'}})),errorCode('ACCESS_DENIED'));
 assert.equal(api.apply(db,command,context('authorized',{readable:['*'],writable:['generatorMaintenancePlans']})).canApply,true);
});

test('hidden fields, accessors, symbols and sparse arrays fail without executing code',()=>{
 let executed=0;const getter=save();Object.defineProperty(getter.payload.rows[0],'plannedHours',{enumerable:true,get(){executed++;return 250;}});assert.throws(()=>api.preview(database(),getter,previewContext));
 const hidden=save();Object.defineProperty(hidden.payload,'toJSON',{value(){executed++;return payload();},enumerable:false});assert.throws(()=>api.preview(database(),hidden,previewContext));
 const symbolic=save();symbolic.payload[Symbol('secret')]='hidden';assert.throws(()=>api.preview(database(),symbolic,previewContext));
 const sparse=save();sparse.payload.rows=new Array(1);assert.throws(()=>api.preview(database(),sparse,previewContext));
 const source=database();Object.defineProperty(source.generators[0],'name',{enumerable:true,get(){executed++;return 'bad';}});assert.throws(()=>api.preview(source,save(),previewContext));assert.equal(executed,0);
});

test('an unchanged plan section never reads unrelated sources but a plan change checks the full source safely',()=>{
 let executed=0;const before=draft(),after=copy(before);after.vehicles=[{id:'unrelated',note:'Unrelated ordinary save'}];
 for(const value of [before,after])Object.defineProperty(value,'genRecords',{enumerable:true,get(){executed++;throw Error('Unrelated journal must not be loaded');}});
 assert.equal(api.validateChanges(before,after),true);assert.equal(executed,0);
 const changed={generatorMaintenancePlans:copy(after.generatorMaintenancePlans)};
 Object.defineProperty(changed,'genRecords',{enumerable:true,get(){executed++;throw Error('Changed plan journal must be checked without execution');}});
 changed.generatorMaintenancePlans[0].title='Changed plan requires a full source';
 assert.throws(()=>api.validateChanges(before,changed),errorCode('MAINTENANCE_JSON'));assert.equal(executed,0);
 const sparse=database({generatorMaintenancePlans:new Array(1)});assert.throws(()=>api.validateChanges(sparse,sparse),errorCode('MAINTENANCE_JSON'));
 const hidden=database();Object.defineProperty(hidden,'generatorMaintenancePlans',{value:[],enumerable:false});assert.throws(()=>api.validateChanges(hidden,hidden),errorCode('MAINTENANCE_JSON'));
 const symbol=database();symbol.generatorMaintenancePlans[Symbol('hidden')]='unknown';assert.throws(()=>api.validateChanges(symbol,symbol),errorCode('MAINTENANCE_JSON'));
});
