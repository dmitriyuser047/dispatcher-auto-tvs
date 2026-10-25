'use strict';
// Independent synthetic inventories only: no application, profile, DB or clock.
const {test}=require('node:test'),assert=require('node:assert/strict');
const api=require('../assets/core/asset-inventory.js'),hash=require('../assets/core/request-fingerprint.js');
const sections=['inventoryOrgs','inventoryObjects','inventoryMols','inventoryItems','inventorySessions'];
const copy=value=>JSON.parse(JSON.stringify(value));
function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
const person=(name='Synthetic chairman')=>({name,position:'Synthetic position'});
const ctx=(id='synthetic-session',extra={})=>({id,now:'2026-10-25T10:00:00.000Z',today:'2026-10-25',actor:{id:'synthetic-user',name:'Synthetic approver',role:'admin'},...extra});
function database(extra={}){return {
 inventoryOrgs:[{id:0,name:'Numeric organization',note:''},{id:'0',name:'String organization',note:''}],
 inventoryObjects:[{id:0,name:'Numeric object',note:''},{id:'0',name:'String object',note:''}],
 inventoryMols:[{id:0,orgId:0,objectId:0,name:'Numeric MOL',accountCode:'01',note:''},{id:'0',orgId:'0',objectId:0,name:'String MOL',accountCode:'10',note:''},{id:'other',orgId:0,objectId:'0',name:'Other object MOL',accountCode:'08',note:''}],
 inventoryItems:[{id:0,molId:0,name:'First item',code:'SAME-CODE',unit:'шт',qty:0.1,cost:0.1,note:''},{id:'0',molId:'0',name:'Second item',code:'SAME-CODE',unit:'шт',qty:0.2,cost:0.2,note:''},{id:'other',molId:'other',name:'Other object item',code:'OTHER',unit:'л',qty:5,cost:2.5,note:''}],inventorySessions:[],...extra};}
const create=(extra={})=>({action:'createSession',objectId:0,date:'2026-10-25',title:'Synthetic inventory',reason:'Synthetic inventory count',...extra});
function execute(db,input,context=ctx()) {const preview=api.preview(db,input,{today:context.today,...(context.readable?{readable:context.readable}:{})}),command={...input,reviewFingerprint:preview.fingerprint};return {preview,command,result:api.plan(db,command,context)};}
const merged=(db,result)=>({...db,...copy(result.sections)});
function draft(db=database(),input=create(),context=ctx()){return merged(db,execute(db,input,context).result);}
function factsInput(session,modify){const facts=session.rows.map(value=>({rowId:value.id,qtyFact:value.qtyAcct,costFact:value.costAcct,action:'',note:''}));if(modify)modify(facts);return {action:'saveDraft',sessionId:session.id,payload:{date:session.date,title:session.title,note:'Synthetic document note',commission:{chairman:person(),members:[]},facts},reason:'Synthetic physical count'};}
function counted(db=draft(),modify){const session=db.inventorySessions[0];return merged(db,execute(db,factsInput(session,modify),ctx('count')).result);}
const approveInput=(sessionId='synthetic-session')=>({action:'approve',sessionId,date:'2026-10-25',document:'Synthetic signed decision',reason:'Synthetic signed approval'});
function approved(db=counted()){return merged(db,execute(db,approveInput(db.inventorySessions[0].id),ctx('approve')).result);}
const code=value=>error=>error.code===value;

test('new independent snapshots preserve typed zero IDs, duplicate codes and all organizations on one object',()=>{
 const db=freeze(database()),before=JSON.stringify(db),result=execute(db,freeze(create())).result,session=result.session;
 assert.deepEqual(api.dependencies(),sections);assert.deepEqual(result.writeSections,['inventorySessions']);assert.deepEqual(Object.keys(result.sections),['inventorySessions']);assert.equal(session.rows.length,2);assert.equal(session.rows[0].itemId,0);assert.equal(session.rows[1].itemId,'0');assert.equal(session.rows[0].molId,0);assert.equal(session.rows[1].molId,'0');assert.equal(session.rows[0].orgId,0);assert.equal(session.rows[1].orgId,'0');assert.equal(session.rows[0].code,session.rows[1].code);assert.notEqual(session.rows[0].id,session.rows[1].id);assert.equal(session.orgId,undefined);assert.equal(session.rows[0].qtyFact,null);assert.equal(session.rows[0].costFact,null);assert.equal(session.rootId,session.id);assert.equal(session.revision,1);assert.equal(result.entityIds.sessionId,'synthetic-session');assert.equal(result.fingerprint,result.reviewFingerprint);assert.ok(Object.isFrozen(result)&&Object.isFrozen(session.rows));assert.equal(JSON.stringify(db),before);
});

test('numeric zero organization and object filters never fall through to string zero or all organizations',()=>{
 const db=database();for(const [orgId,itemId]of [[0,0],['0','0']]){const session=execute(db,create({orgId})).result.session;assert.equal(session.rows.length,1);assert.equal(session.orgId,orgId);assert.equal(session.rows[0].itemId,itemId);}
 const session=execute(db,create({objectId:'0'})).result.session;assert.equal(session.objectId,'0');assert.deepEqual(session.rows.map(r=>r.itemId),['other']);
});

test('facts distinguish explicit zero from unknown and report exact count differences',()=>{
 const unknown=draft(),unknownModel=api.exportModel(unknown.inventorySessions[0]);assert.equal(unknownModel.summary.checked,0);assert.equal(unknownModel.rows[0].qtyDifferenceDecimal,null);
 const db=counted(unknown,facts=>{facts[0].qtyFact=0;facts[0].costFact=0;facts[0].action='writeoff';facts[0].note='Explicit observed absence';facts[1].qtyFact=null;facts[1].costFact=null;}),model=api.exportModel(db.inventorySessions[0]);
 assert.equal(model.rows[0].qtyFact,0);assert.equal(model.rows[0].costFact,0);assert.equal(model.rows[0].qtyDifferenceDecimal,'-0.1');assert.equal(model.rows[0].costDifferenceDecimal,'-0.1');assert.equal(model.rows[0].action,'writeoff');assert.equal(model.rows[0].note,'Explicit observed absence');assert.equal(model.summary.checked,1);assert.equal(model.summary.unknownFact,1);assert.equal(model.summary.shortage,1);assert.equal(model.summary.costs.costFactDecimal,null);assert.equal(model.summary.costs.costFact,null);assert.equal(model.summary.costs.unknownFact,1);
});

test('Decimal sums and differences are exact without a binary floating point residue',()=>{
 const db=counted(),model=api.exportModel(db.inventorySessions[0]),q=model.summary.quantities[0];
 assert.equal(q.qtyAcctDecimal,'0.3');assert.equal(q.qtyFactDecimal,'0.3');assert.equal(q.differenceDecimal,'0');assert.equal(q.difference,0);assert.equal(model.summary.costs.costAcctDecimal,'0.3');assert.equal(model.summary.costs.costFactDecimal,'0.3');assert.equal(model.summary.costs.differenceDecimal,'0');assert.equal(model.summary.match,2);
});

test('quantity totals are split by exact unit and each unknown unit stays a separate draft group',()=>{
 const source=database();source.inventoryItems[1].unit='л';let session=execute(source,create()).result.session,model=api.exportModel(session);
 assert.deepEqual(model.summary.quantities.map(q=>q.unit),['шт','л']);assert.equal(Object.hasOwn(model.summary,'qtyTotal'),false);
 source.inventoryItems[0].unit='';source.inventoryItems[1].unit='';session=execute(source,create()).result.session;model=api.exportModel(session);assert.equal(model.summary.quantities.length,2);assert.ok(model.summary.quantities.every(q=>q.unit===null&&q.rowIds.length===1));
});

test('unknown money remains unknown even in approved physical inventories; explicit zero stays known',()=>{
 const source=database();source.inventoryItems[0].cost=null;source.inventoryItems[1].cost=0;const db=counted(draft(source)),review=api.preview(db,approveInput(),{today:'2026-10-25'});assert.equal(review.canApply,true);assert.ok(review.warnings.some(i=>i.code==='INVENTORY_COST_UNKNOWN'));
 const final=approved(db),model=api.exportModel(final.inventorySessions[0]);assert.equal(model.summary.costs.costAcct,null);assert.equal(model.summary.costs.costAcctDecimal,null);assert.equal(model.summary.costs.unknownAcct,1);assert.equal(model.rows[1].costAcct,0);assert.equal(model.rows[1].costFact,0);
});

test('unknown accounting quantity, uncounted rows, missing units and commission block approval without inventing facts',()=>{
 for(const [field,value,expected]of [['qty',null,'INVENTORY_QUANTITY_REQUIRED'],['unit','','INVENTORY_UNIT_REQUIRED']]){const source=database();source.inventoryItems[0][field]=value;const initial=draft(source),input=factsInput(initial.inventorySessions[0],facts=>{if(facts[0].qtyFact===null)facts[0].qtyFact=0;}),actual=merged(initial,execute(initial,input,ctx('count')).result),review=api.preview(actual,approveInput(),{today:'2026-10-25'});assert.equal(review.canApply,false);assert.ok(review.issues.some(i=>i.code===expected));}
 const raw=draft(),before=JSON.stringify(raw),review=api.preview(raw,approveInput(),{today:'2026-10-25'});assert.equal(review.canApply,false);assert.ok(review.issues.some(i=>i.code==='INVENTORY_COMMISSION_REQUIRED'));assert.throws(()=>api.plan(raw,{...approveInput(),reviewFingerprint:review.fingerprint},ctx('blocked')),code('INVENTORY_BLOCKED'));assert.equal(JSON.stringify(raw),before);
});

test('approval freezes every displayed label, fact, decision, commissioner and revision metadata',()=>{
 const source=database();source.inventoryOrgs[0].name='<img src=x onerror=bad()> & organization';source.inventoryItems[0].name='<script>literal</script>';const db=counted(draft(source),facts=>{facts[0].action='writeoff';facts[0].note='Literal =1+1';facts[1].action='transfer';}),final=approved(db),session=final.inventorySessions[0],model=api.exportModel(session);
 assert.equal(session.fingerprint,api.snapshotDigest(session.snapshot));assert.equal(session.fingerprint,'sha256:'+hash.sha256(hash.stableSerialize(session.snapshot)));assert.deepEqual(session.snapshot.approval,session.approval);assert.equal(session.snapshot.sessionId,session.id);assert.equal(session.snapshot.rootId,session.rootId);assert.equal(session.snapshot.revision,session.revision);assert.equal(model.rows.length,2);assert.equal(model.rows[0].name,source.inventoryItems[0].name);assert.equal(model.rows[0].orgName,source.inventoryOrgs[0].name);assert.equal(model.rows[0].note,'Literal =1+1');assert.equal(model.rows[0].action,'writeoff');assert.equal(model.rows[1].action,'transfer');assert.deepEqual(model.commission,session.commission);assert.equal(model.approval.actor,'Synthetic approver');
 const bytes=JSON.stringify(model);final.inventoryOrgs=[];final.inventoryObjects=[];final.inventoryMols=[];final.inventoryItems=[];assert.equal(JSON.stringify(api.exportModel(session)),bytes);assert.equal(JSON.stringify(api.exportModel(copy(session))),bytes);
});

test('all rows export from their own snapshot even without any current MOL or item catalog',()=>{
 const session=copy(approved().inventorySessions[0]);session.rows[0].molId='external-section';session.snapshot.rows[0].molId='external-section';session.fingerprint=api.snapshotDigest(session.snapshot);
 const model=api.exportModel(freeze(session));assert.equal(model.rows.length,2);assert.equal(model.rows[0].molId,'external-section');assert.equal(model.rows[0].unit,'шт');assert.equal(model.organizations.length,2);assert.equal(model.summary.costs.costAcctDecimal,'0.3');
});

test('corrupt or mismatched approved snapshots fail closed without falling back to live session labels',()=>{
 for(const mutate of [s=>s.snapshot.rows[0].name='Changed snapshot',s=>s.rows[0].name='Changed outer row',s=>s.approval.actor='Forged actor',s=>s.revision=2,s=>s.snapshot=null,s=>s.fingerprint='sha256:'+'0'.repeat(64)]){const session=copy(approved().inventorySessions[0]);mutate(session);assert.throws(()=>api.exportModel(session));}
});

test('approved documents cannot be edited and a new revision preserves old bytes and has only one successor',()=>{
 const db=approved(),old=JSON.stringify(db.inventorySessions[0]),input={action:'revise',sessionId:'synthetic-session',reason:'Synthetic signed correction'},result=execute(db,input,ctx('revision-two')).result,next=merged(db,result),revision=next.inventorySessions[1];
 assert.equal(JSON.stringify(next.inventorySessions[0]),old);assert.equal(revision.id,'revision-two');assert.equal(revision.previousId,'synthetic-session');assert.equal(revision.rootId,'synthetic-session');assert.equal(revision.revision,2);assert.equal(revision.status,'draft');for(const field of ['approval','snapshot','fingerprint'])assert.equal(revision[field],undefined);assert.equal(api.validate(next).valid,true);
 assert.equal(api.preview(next,input,{today:'2026-10-25'}).canApply,false);assert.equal(api.preview(db,factsInput(db.inventorySessions[0]),{today:'2026-10-25'}).canApply,false);
 const forged=copy(next);forged.inventorySessions[1].revision=3;assert.throws(()=>api.validate(forged),code('INVENTORY_REVISION'));
});

test('raw catalog/session writes, deletion, forged approvals and revision metadata require a matching semantic proof',()=>{
 const db=counted();for(const mutate of [d=>d.inventoryItems[0].qty=99,d=>d.inventoryMols=[],d=>d.inventorySessions=[],d=>{d.inventorySessions[0].status='approved';},d=>d.inventorySessions[0].revision=2]){const after=copy(db);mutate(after);assert.throws(()=>api.protectChanges(db,after,ctx()),code('INVENTORY_PROOF'));}
 const input=approveInput(),context=ctx('approval-proof'),{command,result}=execute(db,input,context),after=merged(db,result),proof={...context,commandIntent:{command:{type:'AssetInventoryAction',input:command}}};assert.equal(api.protectChanges(db,after,proof),true);
 const altered=copy(after);altered.inventorySessions[0].approval.actor='Forged';altered.inventorySessions[0].snapshot.approval.actor='Forged';altered.inventorySessions[0].fingerprint=api.snapshotDigest(altered.inventorySessions[0].snapshot);assert.throws(()=>api.protectChanges(db,altered,proof),code('INVENTORY_PROOF'));
 const extra=copy(after);extra.inventoryItems[0].qty=99;assert.throws(()=>api.protectChanges(db,extra,proof),code('INVENTORY_PROOF'));
});

test('an altered source, command intent or business date invalidates the reviewed action',()=>{
 const db=database(),input=create(),review=api.preview(db,input,{today:'2026-10-25'}),command={...input,reviewFingerprint:review.fingerprint};
 const changed=copy(db);changed.inventoryItems[0].qty=0.2;assert.throws(()=>api.plan(changed,command,ctx()),code('STALE_REVIEW'));assert.throws(()=>api.plan(db,{...command,title:'Changed title'},ctx()),code('STALE_REVIEW'));assert.throws(()=>api.plan(db,command,ctx('next-day',{today:'2026-10-26'})),code('STALE_REVIEW'));
 const a=api.preview(db,input,{today:'2026-10-25'}),b=api.preview(copy(db),copy(input),{today:'2026-10-25',id:'different',now:'2026-10-25T12:00:00.000Z'});assert.equal(a.fingerprint,b.fingerprint);
});

test('catalog mutations keep typed references and archived rows never enter new session snapshots',()=>{
 const db=database(),saved=execute(db,{action:'saveCatalog',section:'inventoryItems',id:0,payload:{molId:0,name:'Renamed zero',code:'SAME-CODE',unit:'шт',qty:0,cost:null,note:'Explicit unknown'},reason:'Synthetic catalog edit'},ctx('edit')).result;assert.equal(saved.entityIds.id,0);assert.equal(saved.sections.inventoryItems[0].name,'Renamed zero');assert.equal(saved.sections.inventoryItems[1].name,'Second item');
 const archived=merged(db,execute(db,{action:'archiveCatalog',section:'inventoryMols',id:0,reason:'Synthetic archive'},ctx('archive')).result),session=execute(archived,create()).result.session;assert.deepEqual(session.rows.map(r=>r.itemId),['0']);assert.equal(archived.inventoryItems.length,3);
 const newOrg=execute(db,{action:'saveCatalog',section:'inventoryOrgs',payload:{name:'New independent organization',note:''},reason:'Synthetic new catalog'},ctx('new-org')).result;assert.equal(newOrg.entityIds.id,'new-org');assert.deepEqual(Object.keys(newOrg.sections),['inventoryOrgs']);
});

test('numeric inputs and dates reject coercion, negatives, non-finite values and unsupported precision',()=>{
 for(const value of ['0','0x10',true,-1,NaN,Infinity,0.0001,1e12+1]){const db=database();db.inventoryItems[0].qty=value;assert.throws(()=>api.preview(db,create(),{today:'2026-10-25'}));}
 for(const value of ['0','0x10',true,-1,NaN,Infinity,0.001,1e15+1]){const db=database();db.inventoryItems[0].cost=value;assert.throws(()=>api.preview(db,create(),{today:'2026-10-25'}));}
 for(const value of ['2026-02-30','2026-13-01','1899-12-31',''])assert.throws(()=>api.preview(database(),create({date:value}),{today:'2026-10-25'}),code('INVENTORY_DATE'));
 const db=counted();assert.equal(api.preview(db,{...approveInput(),date:'2026-10-26'},{today:'2026-10-25'}).canApply,false);assert.equal(api.preview(db,{...approveInput(),date:'2026-10-24'},{today:'2026-10-25'}).canApply,false);
});

test('duplicate and foreign fields, sections and orphan references never enter independent catalogs or facts',()=>{
 for(const section of sections){const db=section==='inventorySessions'?draft():database();db[section].push(copy(db[section][0]));assert.throws(()=>api.validate(db),code('INVENTORY_DUPLICATE'));}
 const db=database();db.inventoryItems[0].molId='missing';assert.throws(()=>api.validate(db),code('INVENTORY_REFERENCE'));
 for(const input of [{action:'saveCatalog',section:'parts',payload:{name:'Not inventory',note:''},reason:'Synthetic invalid section'},create({vehicleId:0}),{action:'saveCatalog',section:'inventoryItems',payload:{molId:0,name:'Item',code:'',unit:'шт',qty:1,cost:1,note:'',generatorId:0},reason:'Synthetic foreign reference'}])assert.throws(()=>api.preview(database(),input,{today:'2026-10-25'}));
 const countedDb=counted(),input=factsInput(countedDb.inventorySessions[0]);input.payload.facts[0].qtyAcct=100;assert.throws(()=>api.preview(countedDb,input,{today:'2026-10-25'}),code('INVENTORY_FIELD'));
});

test('facts require every row exactly once and cannot substitute an unknown row identity',()=>{
 const db=draft();for(const mutate of [facts=>facts.pop(),facts=>facts.push(copy(facts[0])),facts=>facts[0].rowId='unknown']){const input=factsInput(db.inventorySessions[0],mutate);if(input.payload.facts.length===3)assert.throws(()=>api.preview(db,input,{today:'2026-10-25'}),code('INVENTORY_ROW_ID'));else assert.equal(api.preview(db,input,{today:'2026-10-25'}).canApply,false);}
});

test('getters, hooks, sparse arrays, hidden fields, symbols and cycles are rejected without execution',()=>{
 let executed=0;for(const factory of [()=>Object.defineProperty(create(),'title',{get(){executed++;return 'Bad';},enumerable:true}),()=>({...create(),toJSON(){executed++;return {};}}),()=>{const x=create();Object.defineProperty(x,'hidden',{value:1});return x;},()=>{const x=create();x[Symbol('hidden')]=1;return x;},()=>{const x=create();x.loop=x;return x;}])assert.throws(()=>api.preview(database(),factory(),{today:'2026-10-25'}));
 const getter=database();Object.defineProperty(getter,'inventoryItems',{enumerable:true,get(){executed++;return [];}});assert.throws(()=>api.preview(getter,create(),{today:'2026-10-25'}));
 const sparse=database();sparse.inventoryItems.length=5;assert.throws(()=>api.preview(sparse,create(),{today:'2026-10-25'}));assert.equal(executed,0);
});

test('independent operations ignore unrelated platform fields and never read or write business journals',()=>{
 let executed=0;const db=database();for(const name of ['vehicles','generators','parts','partMovements','payments','fuelPurchases'])Object.defineProperty(db,name,{enumerable:true,get(){executed++;throw Error('Foreign section read');}});
 const result=execute(db,create()).result;assert.equal(executed,0);assert.deepEqual(Object.keys(result.sections),['inventorySessions']);assert.deepEqual(result.readSections,sections);assert.equal(api.protectChanges(db,db),true);assert.equal(executed,0);
});

test('read-only principals and incomplete section capabilities cannot apply a reviewed mutation',()=>{
 const db=database(),input=create(),review=api.preview(db,input,{today:'2026-10-25'}),command={...input,reviewFingerprint:review.fingerprint};
 for(const role of ['readonly','viewer'])assert.throws(()=>api.plan(db,command,ctx('readonly',{actor:{id:'r',name:'Reader',role}})),code('ACCESS_DENIED'));assert.throws(()=>api.plan(db,command,ctx('no-write',{writable:['inventoryItems']})),code('ACCESS_DENIED'));assert.throws(()=>api.preview(db,input,{today:'2026-10-25',readable:['inventorySessions']}),code('ACCESS_DENIED'));
 for(const now of ['2026-02-30T10:00:00.000Z','2026-10-25T24:00:00Z','2026-10-25T10:60:00Z'])assert.throws(()=>api.plan(db,command,ctx('bad-time',{now})),code('INVENTORY_TIME'));
});

test('an independent integer oracle agrees with fractional totals and quantities across multiple organizations',()=>{
 const source=database();source.inventoryItems=[];let expectedQty=0n,expectedCost=0n;
 for(let n=0;n<80;n++){const milli=n+1,cents=100+n;source.inventoryItems.push({id:'fraction-'+n,molId:n%2?0:'0',name:'Fractional item '+n,code:'DUPLICATE',unit:'кг',qty:milli/1000,cost:cents/100,note:''});expectedQty+=BigInt(milli);expectedCost+=BigInt(cents);}
 const model=api.exportModel(counted(draft(source)).inventorySessions[0]),q=model.summary.quantities[0],fmt=(value,scale)=>{const raw=value.toString().padStart(scale+1,'0');return (raw.slice(0,-scale)+'.'+raw.slice(-scale)).replace(/\.?0+$/,'');};
 assert.equal(q.qtyAcctDecimal,fmt(expectedQty,3));assert.equal(q.qtyFactDecimal,fmt(expectedQty,3));assert.equal(model.summary.costs.costAcctDecimal,fmt(expectedCost,2));assert.equal(model.summary.rows,80);assert.equal(model.organizations.length,2);assert.equal(model.organizations.reduce((sum,o)=>sum+o.rows.length,0),80);assert.equal(model.summary.match,80);
});
