'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const engine=require('../assets/core/document-engine.js'),schema=require('../assets/core/platform-schema.js'),sources=require('../assets/core/financial-recognition.js'),lifecycle=require('../assets/core/document-lifecycle.js');
const clone=value=>JSON.parse(JSON.stringify(value)),actor={id:'synthetic',name:'Синтетический пользователь',role:'admin'};
const ctx=(id='op')=>({id,now:'2026-10-22T15:00:00.000Z',today:'2026-10-22',actor});
function fixture(extra={}){return {...Object.fromEntries(schema.sections.map(section=>[section,[]])),vehicles:[{id:'v',plate:'ТЕСТ',fuel:'gasoline',fuelGrade:'АИ-92',norm:10,fuelBalance:0}],generators:[],tanks:[{id:0,name:'Тестовая ёмкость',fuel:'gasoline',fuelGrade:'АИ-92',balanceInit:100}],drivers:[{id:'d',name:'Тест',personnelKind:'driver'}],...extra};}
const order=(extra={})=>({id:0,status:'accepted',title:'Ремонт',assetRef:'v:v',result:'Готово',acceptedBy:'Мастер',downtimeFrom:'2026-10-20T10:00',downtimeTo:'2026-10-20T12:00',actualCost:100,...extra});
function save(db,section,payload,correctionOf,id='draft'){return {...db,...engine.plan(db,{action:'saveDraft',section,payload,...(correctionOf?{correctionOf:{section,id:correctionOf.id},reason:'Исправление фактической ошибки'}:{})},ctx(id)).sections};}
function execute(db,action,id='op'){const review=engine.preview(db,action,{today:'2026-10-22'});assert.equal(review.canPost,true,JSON.stringify(review.issues));const input={...action,reviewFingerprint:review.fingerprint},plan=engine.plan(db,input,ctx(id));return {db:{...db,...plan.sections},plan,input,review};}

test('ten adapters preserve unpaid actual obligations and old actual/planned semantics',()=>{
 assert.equal(engine.describe().length,10);assert.equal(engine.state('payments',{id:0,sum:100,paid:false}),'legacy-live');
 assert.equal(engine.state('payments',{id:0,sum:100,paidAmount:1}),'posted');assert.equal(engine.state('workOrders',order()),'posted');assert.equal(engine.state('repairs',{id:0,cost:100}),'legacy-live');
 const db=fixture({payments:[{id:0,sum:100,paid:false}],vehicleTo:[{id:'plan',planned:true,cost:100}]});assert.equal(engine.activeRows(db,'payments')[0].sum,100);assert.equal(engine.activeRows(db,'vehicleTo')[0].planned,true);
 assert.equal(engine.validateChanges(db,{...db,payments:[{...db.payments[0],sum:120}]}),true);
});

test('legacy duplicates, missing IDs and malformed paid numbers retain observable facts',()=>{
 const legacy=[{id:0,sum:12,paidAmount:'неизвестно'},{id:0,sum:34},{sum:56}];const db=fixture({payments:legacy});assert.deepEqual(engine.activeRows(db,'payments'),legacy);assert.equal(engine.activeRows(db,'payments').reduce((sum,row)=>sum+row.sum,0),102);
 const mixed={...db,payments:[...legacy,{id:'posted',sum:7,date:'2026-10-20',lifecycle:{version:1,postedAt:'2026-10-22T15:00:00.000Z',postedActor:actor,operationId:'synthetic'}}]};const result=engine.resolveSection(mixed,'payments');assert.equal(result.diagnostics.length,0);assert.deepEqual(result.rows.slice(0,3),legacy);assert.equal(result.rows.reduce((sum,row)=>sum+row.sum,0),109);
});

test('untouched duplicate posted movement IDs permit unrelated writes without allowing changes or reordering',()=>{
 for(const section of ['fuelMovements','partMovements']){
  const common=section==='fuelMovements'?{id:'dup',date:'2026-09-01',kind:'receipt',toTankId:0}:{id:'dup',date:'2026-09-01',kind:'receipt',partId:0};
  const posted=[{...common,qty:1,reason:'Первый исторический факт'},{...common,qty:2,reason:'Второй исторический факт'}],before=fixture({[section]:posted,parts:[{id:0,name:'Запчасть',unit:'шт'}]}),snapshot=JSON.stringify(before[section]);
  const unrelated={...before,opsTasks:[{id:'task',status:'open',title:'Независимая задача'}]};assert.equal(lifecycle.validateChanges(before,unrelated),true);assert.equal(JSON.stringify(unrelated[section]),snapshot);
  const changed={...unrelated,[section]:[{...posted[0],qty:3},posted[1]]};assert.throws(()=>lifecycle.validateChanges(before,changed),error=>(error.issues||[]).some(item=>item.code==='DOCUMENT_FROZEN'));
  assert.throws(()=>lifecycle.validateChanges(before,{...unrelated,[section]:[posted[1],posted[0]]}),error=>(error.issues||[]).some(item=>item.code==='DOCUMENT_FROZEN'));
  assert.equal(JSON.stringify(before[section]),snapshot);
 }
});

test('raw accepted work order, confirmed job and paid payment cannot be rewritten or deleted',()=>{
 for(const [section,row,change]of [['workOrders',order(),{actualCost:999}],['dispatchJobs',{id:0,status:'confirmed',actualKm:150},{actualKm:999}],['payments',{id:0,sum:100,paidAmount:100},{sum:999}],['payments',{id:0,sum:100,paid:true},{paid:false}]]){
  const db=fixture({[section]:[row]});assert.throws(()=>lifecycle.validateChanges(db,{...db,[section]:[{...row,...change}]}),/неизменяем|проверенной командой/);assert.throws(()=>lifecycle.validateChanges(db,{...db,[section]:[]}),/нельзя удалить/);
 }
});

test('stock draft is isolated, incomplete draft is allowed, cancellation cannot reopen it',()=>{
 const db=fixture(),before=JSON.stringify(db),next=save(db,'fuelMovements',{qty:10});assert.equal(next.fuelMovements.length,0);assert.equal(next.documentDrafts.length,1);assert.equal(JSON.stringify(db),before);
 const action={action:'postDraft',section:'fuelMovements',draftId:'draft'};assert.equal(engine.preview(next,action,{today:'2026-10-22'}).canPost,false);
 const cancelled=engine.plan(next,{action:'discardDraft',section:'fuelMovements',draftId:'draft',reason:'Ошибочный черновик'},ctx('discard'));assert.equal(cancelled.sections.documentDrafts[0].status,'discarded');assert.equal(cancelled.sections.fuelMovements,undefined);
 assert.throws(()=>engine.plan({...next,...cancelled.sections},{action:'saveDraft',section:'fuelMovements',draftId:'draft',payload:{}},ctx()),/уже проведён/);
});

test('new raw physical draft metadata cannot leak into stock, old unchanged malformed row is grandfathered',()=>{
 for(const section of ['fuelMovements','partMovements'])for(const marker of [{status:'draft'},{posted:false}]){
  const db=fixture(),row={id:'bad',date:'2026-10-01',qty:1,...marker};assert.throws(()=>engine.validateChanges(db,{...db,[section]:[row]}),/Черновик движения/);
  const legacy={...db,[section]:[row]};assert.equal(engine.validateChanges(legacy,clone(legacy)),true);
 }
});

test('correction produces one active financial root and retains original accepted row bytewise',()=>{
 const db=fixture({workOrders:[order()]}),original=JSON.stringify(db.workOrders[0]);const drafted=save(db,'workOrders',{actualCost:120},{id:0});const done=execute(drafted,{action:'postDraft',section:'workOrders',draftId:'draft'},'revision');
 assert.equal(JSON.stringify(done.db.workOrders[0]),original);assert.equal(done.db.workOrders.length,2);assert.equal(engine.activeRows(done.db,'workOrders').length,1);
 const resolved=engine.resolveDocument(done.db,{section:'workOrders',id:'revision'});assert.equal(resolved.root.id,0);assert.equal(resolved.current.id,'revision');assert.equal(resolved.effective.actualCost,120);assert.equal(engine.rootId(done.db,'workOrders','revision'),0);
 const projected=sources.projectFinancialSources(done.db);assert.deepEqual(projected.sources.map(row=>[row.sourceId,row.revisionId,row.sum]),[[0,'revision',120]]);assert.equal(projected.sources[0].recognitionKey,resolved.recognitionKey);
 const context={...ctx('revision'),commandIntent:{command:{type:'DocumentAction',version:1,input:done.input}}};assert.equal(lifecycle.validateChanges(drafted,done.db,context),true);
 assert.throws(()=>lifecycle.validateChanges(drafted,{...done.db,workOrders:done.db.workOrders.map(row=>row.id===0?{...row,actualCost:999}:row)},context),/не совпадают/);
});

test('corrected linked work order stays secondary and cannot acquire a different primary',()=>{
 const db=fixture({repairs:[{id:'r',vehicleId:'v',invoiceDate:'2026-10-20',cost:100}],workOrders:[order({repairId:'r'})]});const drafted=save(db,'workOrders',{actualCost:120},{id:0});const done=execute(drafted,{action:'postDraft',section:'workOrders',draftId:'draft'},'revision');
 const projection=sources.projectFinancialSources(done.db);assert.deepEqual(projection.sources.map(row=>row.sum),[100]);assert.equal(projection.excluded[0].code,'linked-primary');assert.equal(projection.excluded[0].sourceId,0);
 const invalid=save(db,'workOrders',{repairId:null},{id:0});assert.equal(engine.preview(invalid,{action:'postDraft',section:'workOrders',draftId:'draft'},{today:'2026-10-22'}).canPost,false);
});

test('typed roots 0 and string zero remain separate, forks and cycles fail closed',()=>{
 const db=fixture({workOrders:[order(),order({id:'0',actualCost:7})]});assert.equal(engine.activeRows(db,'workOrders').length,2);
 const drafted=save(db,'workOrders',{actualCost:120},{id:0}),done=execute(drafted,{action:'postDraft',section:'workOrders',draftId:'draft'},'revision');assert.deepEqual(engine.resolveSection(done.db,'workOrders').identities.map(row=>[row.id,row.rootId]),[['0','0'],['revision',0]]);
 const duplicate={...done.db,workOrders:[...done.db.workOrders,{...done.db.workOrders[2],id:'fork'}]};assert.ok(engine.resolveSection(duplicate,'workOrders').diagnostics.some(row=>row.code==='DOCUMENT_FORK'));assert.throws(()=>engine.resolveDocument(duplicate,{section:'workOrders',id:0}),/несколько исправлений/);
 const cycle=clone(done.db);cycle.workOrders[0].lifecycle={version:1,correctionOf:{section:'workOrders',id:'revision'}};assert.ok(engine.resolveSection(cycle,'workOrders').diagnostics.length);assert.throws(()=>engine.resolveDocument(cycle,{section:'workOrders',id:0}),/цепочк/);
});

test('stale review, hidden sources and executable payload fail before document planning',()=>{
 const db=fixture({workOrders:[order({status:'repairing'})]}),action={action:'post',section:'workOrders',id:0};const review=engine.preview(db,action,{today:'2026-10-22'});
 assert.throws(()=>engine.plan({...db,workOrders:[{...db.workOrders[0],actualCost:999}]},{...action,reviewFingerprint:review.fingerprint},ctx()),/изменились/);
 let invoked=0;const hidden={};Object.defineProperty(hidden,'workOrders',{get(){invoked++;throw Error('secret');},enumerable:true});assert.throws(()=>engine.preview(hidden,action,{today:'2026-10-22',readable:['workOrders']}),/недостаточно доступа/);assert.equal(invoked,0);
 const evil={};Object.defineProperty(evil,'actualCost',{get(){invoked++;return 1;},enumerable:true});assert.throws(()=>engine.plan(db,{action:'saveDraft',section:'workOrders',payload:evil},ctx()),/исполняемые/i);assert.equal(invoked,0);
});

test('same-ID post carries unsaved allowed work order fields atomically and rejects status spoof',()=>{
 const db=fixture({workOrders:[{id:0,status:'repairing',title:'Заказ',assetRef:'v:v'}]});const done=execute(db,{action:'post',section:'workOrders',id:0,payload:{result:'Выполнено',acceptedBy:'Мастер',downtimeTo:'2026-10-21T12:00',actualCost:120}},'accepted');
 assert.equal(done.db.workOrders.length,1);assert.equal(done.db.workOrders[0].id,0);assert.equal(done.db.workOrders[0].status,'accepted');assert.equal(done.db.workOrders[0].actualCost,120);assert.equal(done.db.workOrders[0].lifecycle.operationId,'accepted');
 const bad=engine.preview(db,{action:'post',section:'workOrders',id:0,payload:{status:'accepted'}},{today:'2026-10-22'});assert.equal(bad.canPost,false);
});

test('accepted shift correction creates no journals, movement or duplicate kilometre/hour fact',()=>{
 const db=fixture({shiftReports:[{id:0,status:'accepted',date:'2026-10-20',assetRef:'v:v',driverId:'d',acceptedBy:'Мастер',hours:1,odoStart:100,odoEnd:150}]});const drafted=save(db,'shiftReports',{odoEnd:160,result:'Уточнено'},{id:0});const done=execute(drafted,{action:'postDraft',section:'shiftReports',draftId:'draft'},'shift-correction');
 assert.deepEqual(done.plan.writeSections,['documentDrafts','shiftReports']);assert.deepEqual(done.db.records,[]);assert.deepEqual(done.db.genRecords,[]);assert.deepEqual(done.db.fuelMovements,[]);assert.equal(engine.activeRows(done.db,'shiftReports')[0].odoEnd,160);
});

test('settlements append on root; raw paid facts remain unchanged and later correction preserves overpayment',()=>{
 const db=fixture({payments:[{id:0,date:'2026-10-20',sum:100,description:'Расход',paid:true,paidDate:'2026-10-20',contragentId:'c'}],contragents:[{id:'c',name:'Тест'}]});const original=clone(db.payments[0]);const settled=execute(db,{action:'settle',section:'payments',id:0,amount:20,date:'2026-10-22',reason:'Подтверждена доплата'},'settlement');
 for(const key of ['sum','paid','paidAmount','paidDate','contragentId'])assert.deepEqual(settled.db.payments[0][key],original[key]);assert.equal(engine.effectiveRow(settled.db,'payments',0).paidAmount,120);
 const drafted=save(settled.db,'payments',{sum:80,description:'Уточнённое обязательство'},{id:0}),done=execute(drafted,{action:'postDraft',section:'payments',draftId:'draft'},'payment-correction');const resolved=engine.resolveDocument(done.db,{section:'payments',id:'payment-correction'});
 assert.equal(resolved.effective.paidAmount,120);assert.equal(resolved.effective.sum,80);assert.equal(resolved.effective.paidDate,'2026-10-22');assert.equal(resolved.current.paymentSettlements,undefined);assert.equal(resolved.root.paymentSettlements.events.length,1);
 for(const field of ['paid','paidAmount','paidDate'])assert.equal(Object.hasOwn(resolved.current,field),false);
 const again=execute(done.db,{action:'settle',section:'payments',id:'payment-correction',amount:1,date:'2026-10-22',reason:'Вторая подтверждённая оплата'},'settlement2');assert.equal(again.db.payments[0].paymentSettlements.events.length,2);assert.equal(engine.activeRows(again.db,'payments')[0].paidAmount,121);
 const cancelled=engine.preview(done.db,{action:'void',section:'payments',id:'payment-correction',reason:'Не отменять оплату'},{today:'2026-10-22'});assert.equal(cancelled.canPost,false);assert.match(cancelled.issues[0].message,/Оплату нельзя отменить/);
});

test('payment correction cannot alter settlement facts or paid binding',()=>{
 const db=fixture({payments:[{id:0,date:'2026-10-20',sum:100,paidAmount:50,paidDate:'2026-10-20',contragentId:'c'}],contragents:[{id:'c',name:'Тест'},{id:'other',name:'Другой'}]});
 for(const payload of [{paidAmount:0},{paidDate:'2026-10-21'},{contragentId:'other'}]){const drafted=save(db,'payments',payload,{id:0});assert.equal(engine.preview(drafted,{action:'postDraft',section:'payments',draftId:'draft'},{today:'2026-10-22'}).canPost,false);}
 assert.throws(()=>engine.plan(db,{action:'settle',section:'payments',id:0,amount:0,date:'2026-10-22',reason:'Нулевая оплата',reviewFingerprint:'sha256:'+'0'.repeat(64)},ctx()),/положительную/);
 assert.equal(engine.preview(db,{action:'settle',section:'payments',id:0,amount:1,date:'2026-10-23',reason:'Будущая оплата'},{today:'2026-10-22'}).canPost,false);
});

test('typed payment source dedup prevents repeated drafts and competing posted obligations',()=>{
 const payload={date:'2026-10-20',sum:100,description:'Ремонт',source:'repair',sourceId:0},db=fixture({repairs:[{id:0,vehicleId:'v',invoiceDate:'2026-10-20',cost:100}]});const draft=save(db,'payments',payload);
 assert.throws(()=>save(draft,'payments',payload,null,'second-draft'),/другой черновик/);
 const done=execute(draft,{action:'postDraft',section:'payments',draftId:'draft'},'payment');assert.throws(()=>save(done.db,'payments',payload,null,'other'),/уже есть обязательство/);
 const typed=save(done.db,'payments',{...payload,sourceId:'0'},null,'string-zero');assert.equal(typed.documentDrafts.length,2);
});

test('numeric string payment baseline is readable without rewriting historical facts',()=>{
 const db=fixture({payments:[{id:0,sum:'100.00',paidAmount:'10.50',paidDate:'2026-10-20'}]});const before=JSON.stringify(db),result=execute(db,{action:'settle',section:'payments',id:0,amount:0.25,date:'2026-10-22',reason:'Частичная оплата'},'partial');assert.equal(engine.effectiveRow(result.db,'payments',0).paidAmount,10.75);assert.equal(result.db.payments[0].paidAmount,'10.50');assert.equal(JSON.stringify(db),before);
});

test('part stock deficit is visible in preview, receipt posts only once',()=>{
 const db=fixture({parts:[{id:0,name:'Запчасть',unit:'шт'}]}),bad=save(db,'partMovements',{date:'2026-10-20',partId:0,kind:'issue',qty:1,reason:'Выдать со склада'});assert.equal(engine.preview(bad,{action:'postDraft',section:'partMovements',draftId:'draft'},{today:'2026-10-22'}).canPost,false);
 const draft=save(db,'partMovements',{date:'2026-10-20',partId:0,kind:'receipt',qty:2,reason:'Получить на склад'}),done=execute(draft,{action:'postDraft',section:'partMovements',draftId:'draft'},'receipt');assert.equal(done.db.partMovements.length,1);assert.equal(engine.preview(done.db,{action:'postDraft',section:'partMovements',draftId:'draft'},{today:'2026-10-22'}).canPost,false);
});

test('fuel issue uses the common command, keeps typed tank zero and reversal refuses already consumed fuel',()=>{
 const db=fixture(),draft=save(db,'fuelMovements',{date:'2026-10-20',kind:'issue',fromTankId:0,toTankId:'',qty:10,assetRef:'v:v',reason:'Выдача по документу'}),issued=execute(draft,{action:'postDraft',section:'fuelMovements',draftId:'draft'},'fuel-issue');
 assert.equal(issued.db.fuelMovements[0].fromTankId,0);assert.equal(issued.db.records.length,1);assert.equal(issued.db.records[0].fuelIssued,10);assert.equal(issued.db.records[0].fuelMovementId,'fuel-issue');
 const reversed=execute(issued.db,{action:'reverse',section:'fuelMovements',id:'fuel-issue',reason:'Ошибочная выдача'},'fuel-reverse');assert.equal(reversed.db.fuelMovements[1].toTankId,0);assert.equal(reversed.db.records[0].fuelIssued,0);assert.equal(reversed.db.records[0].originalFuelIssued,10);assert.equal(lifecycle.reversalCheck(reversed.db,'fuelMovements',reversed.db.fuelMovements[0]),true);
 const spent={...issued.db,records:[...issued.db.records,{id:'actual',vehicleId:'v',date:'2026-10-21',km:90,fuelIssued:0,fuelActual:9}]},preview=engine.preview(spent,{action:'reverse',section:'fuelMovements',id:'fuel-issue',reason:'Не отменять расход'},{today:'2026-10-22'});assert.equal(preview.canPost,false);assert.match(preview.issues[0].message,/нехватку топлива/);
});

test('external fuel return follows the same to-tank direction as the physical policy',()=>{
 const draft=save(fixture(),'fuelMovements',{date:'2026-10-20',kind:'return',fromTankId:'',toTankId:0,qty:10,reason:'Внешний возврат'}),done=execute(draft,{action:'postDraft',section:'fuelMovements',draftId:'draft'},'returned');assert.equal(done.db.fuelMovements[0].toTankId,0);
});

test('writeoff adapter delegates frozen algorithms and voids v1 v2 v3 without rewriting their snapshots',()=>{
 const writeoff=require('../assets/core/writeoff-engine.js'),request={month:'2026-09',org:'A',grade:'АИ-95',date:'2026-09-30'};
 const base=fixture({vehicles:[{id:'v',org:'A',fuel:'gasoline',fuelGrade:'АИ-95',fuelBalance:50}],records:[{id:'r',vehicleId:'v',date:'2026-09-05',fuelGrade:'АИ-95',fuelIssued:40,fuelActual:20,fuelIdle:2,km:100}],fuelPurchases:[{id:'p',vehicleId:'v',recordId:'r',date:'2026-09-05',grade:'АИ-95',qty:40,manual:true,sourceOrg:'A'}]});
 for(const version of [1,2,3]){
  const api=writeoff.forVersion(version),ready=api.prepare(base,request),doc=api.post(base,request,{id:'act',number:'Тест',postedAt:'2026-10-21T10:00:00.000Z',postedBy:actor,expectedFingerprint:ready.sourceFingerprint}),db={...base,fuelWriteoffs:[doc]},before=JSON.stringify(doc),done=execute(db,{action:'void',section:'fuelWriteoffs',id:'act',reason:'Аннулирован для исправления'},'void-'+version);
  assert.equal(JSON.stringify(db.fuelWriteoffs[0]),before);assert.deepEqual(done.db.fuelWriteoffs[0],api.voidDocument(doc,{voidedAt:ctx().now,voidedBy:actor,reason:'Аннулирован для исправления'}));assert.deepEqual(done.db.fuelWriteoffs[0].snapshot,doc.snapshot);assert.equal(done.db.fuelWriteoffs[0].sourceFingerprint,doc.sourceFingerprint);assert.equal(Object.hasOwn(done.db.fuelWriteoffs[0],'lifecycle'),false);
 }
 const draft=save(base,'fuelWriteoffs',{request,number:'Новый акт'}),done=execute(draft,{action:'postDraft',section:'fuelWriteoffs',draftId:'draft'},'act-new');assert.equal(done.db.fuelWriteoffs[0].calculationVersion,3);assert.equal(Object.hasOwn(done.db.fuelWriteoffs[0],'lifecycle'),false);
});

test('explicit fork diagnostics stop active totals instead of showing partial zero',()=>{
 const db=fixture({workOrders:[order()]}),draft=save(db,'workOrders',{actualCost:120},{id:0}),done=execute(draft,{action:'postDraft',section:'workOrders',draftId:'draft'},'revision');const bad={...done.db,workOrders:[...done.db.workOrders,{...done.db.workOrders[1],id:'fork'}]};assert.throws(()=>engine.activeRows(bad,'workOrders'),error=>error.code==='DOCUMENT_CHAIN');assert.throws(()=>sources.projectFinancialSources(bad),error=>error.code==='DOCUMENT_CHAIN');
});

test('row-filtered draft review matches trusted full store and posting preserves foreign hidden drafts',()=>{
 const initial=fixture({shiftReports:[{id:'sent',status:'sent',date:'2026-10-20',assetRef:'v:v',driverId:'d',acceptedBy:'Мастер'}]}),foreign=save(initial,'payments',{date:'2026-10-20',sum:100,description:'Скрытый платёж'},null,'hidden-payment'),all=save(foreign,'shiftReports',{title:'Уточнённая смена',date:'2026-10-20',assetRef:'v:v',driverId:'d',acceptedBy:'Мастер'},null,'own-draft');
 const visible={...all,documentDrafts:all.documentDrafts.filter(row=>row.section==='shiftReports')},action={action:'postDraft',section:'shiftReports',draftId:'own-draft'},review=engine.preview(visible,action,{today:'2026-10-22'}),trusted=engine.preview(all,action,{today:'2026-10-22'});assert.equal(review.fingerprint,trusted.fingerprint);
 const posted=engine.plan(all,{...action,reviewFingerprint:review.fingerprint},ctx('accepted-shift'));assert.deepEqual(posted.sections.documentDrafts.find(row=>row.id==='hidden-payment'),all.documentDrafts.find(row=>row.id==='hidden-payment'));
});

test('raw terminal transition and server acceptance stamps require proof; historical seed remains compatible',()=>{
 for(const [section,before,status]of [['workOrders',order({status:'repairing'}),'accepted'],['dispatchJobs',{id:0,status:'done'},'confirmed']]){
  const db=fixture({[section]:[before]});assert.throws(()=>engine.validateChanges(db,{...db,[section]:[{...before,status}]}),/проверенной командой/);
  const seeded=fixture({[section]:[{...before,status}]});assert.equal(engine.validateChanges(fixture(),seeded),true);assert.throws(()=>engine.validateChanges(fixture(),{...seeded,[section]:[{...before,status,acceptedActor:{id:'spoof'},acceptedAt:'2026-10-22T00:00:00.000Z'}]}),/назначаются/);
 }
});

test('hidden toJSON, sparse arrays and symbol hooks never execute at pure boundaries',()=>{
 let invoked=0;const payload={actualCost:1};Object.defineProperty(payload,'toJSON',{value(){invoked++;return {actualCost:999};},enumerable:false});assert.throws(()=>engine.plan(fixture(),{action:'saveDraft',section:'workOrders',payload},ctx()),/скрытые свойства/);assert.equal(invoked,0);
 const array=[];array.length=2;assert.throws(()=>engine.resolveSection({payments:array},'payments'),/Пропуск/);
 const symbolic={};Object.defineProperty(symbolic,Symbol.toStringTag,{get(){invoked++;return 'Object';}});assert.throws(()=>engine.plan(fixture(),{action:'saveDraft',section:'workOrders',payload:symbolic},ctx()),/скрытые свойства/);assert.equal(invoked,0);
});

test('browser and Node preview fingerprint ignore renderer-only root fields and object key order',()=>{
 const globals={PlatformContracts:require('../assets/core/platform-contracts.js'),PlatformSchema:schema,EntityIdentity:require('../assets/core/entity-identity.js'),DecimalCore:require('../assets/core/decimal-core.js'),TvsWriteoffEngine:require('../assets/core/writeoff-engine.js'),FuelMovementPolicy:require('../assets/core/fuel-movement-policy.js'),PlatformPolicies:require('../assets/core/platform-policies.js'),PlatformCommands:require('../assets/core/platform-commands.js')};
 // The actual build adapter's names are the contract under test.
 const code=fs.readFileSync(path.join(__dirname,'../assets/core/document-engine.js'),'utf8');const context=vm.createContext(globals);vm.runInContext(code,context);const db=fixture({workOrders:[order({status:'repairing'})]}),action={action:'post',section:'workOrders',id:0};const reverse=value=>Array.isArray(value)?value.map(reverse):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([key,item])=>[key,reverse(item)])):value;
 const node=engine.preview(db,action,{today:'2026-10-22'}),browser=context.DocumentEngine.preview({...reverse(db),rendererState:{temporary:true}},reverse(action),{today:'2026-10-22'});assert.equal(browser.fingerprint,node.fingerprint);assert.equal(browser.canPost,node.canPost);
});
