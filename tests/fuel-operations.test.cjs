'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const operations=require('../assets/core/fuel-operations'),stock=require('../assets/core/fuel-stock'),docs=require('../assets/core/document-engine'),lifecycle=require('../assets/core/document-lifecycle'),schema=require('../assets/core/platform-schema');
const actor={id:'synthetic',name:'Синтетический проверяющий',role:'admin'},today='2026-10-22',ctx=id=>({id,now:today+'T12:00:00.000Z',today,actor}),copy=value=>structuredClone(value);
const fixture=extra=>({...Object.fromEntries(schema.sections.map(name=>[name,[]])),tanks:[{id:0,fuel:'diesel',balanceInit:5},{id:'0',fuel:'diesel',balanceInit:0}],...extra});
function execute(db,input,id){const action={reason:'Подтверждённое действие',...input},review=operations.preview(db,action,{today});assert.equal(review.canApply,true,JSON.stringify(review.issues));const commandInput={...action,reviewFingerprint:review.fingerprint},plan=operations.plan(db,commandInput,ctx(id)),next={...db,...plan.sections},proof={...ctx(id),commandIntent:{command:{type:'FuelAction',version:1,input:commandInput}}};assert.equal(operations.validateChanges(db,next,proof),true);assert.equal(lifecycle.validateChanges(db,next,proof),true);return {db:next,review,plan,input:commandInput,proof};}

test('zero observation is a real immutable neutral fact, and applying its difference is a separate action',()=>{
 const db=fixture(),observed=execute(db,{action:'measure',target:{section:'tanks',id:0},date:'2026-09-10',observedQty:0},'measurement');assert.equal(observed.db.fuelMovements[0].qty,0);assert.equal(observed.db.fuelMovements[0].measurement.observedQty,0);assert.equal(observed.db.fuelMovements[0].measurement.calculatedQty,'5');assert.equal(observed.db.fuelMovements[0].measurement.differenceQty,'-5');assert.equal(stock.balanceAt(observed.db,{section:'tanks',id:0},'2026-09-30').balance,5);
 const applied=execute(observed.db,{action:'applyDifference',measurementId:'measurement'},'adjustment');assert.equal(applied.db.fuelMovements.length,2);assert.equal(applied.db.fuelMovements[1].fromTankId,0);assert.equal(stock.balanceAt(applied.db,{section:'tanks',id:0},'2026-09-30').balance,0);
 assert.equal(operations.preview(applied.db,{action:'applyDifference',measurementId:'measurement',reason:'Повтор под другим ID'},{today}).canApply,false);assert.equal(operations.preview(applied.db,{action:'voidMeasurement',measurementId:'measurement',reason:'Сначала сторнировать корректировку'},{today}).canApply,false);
});

test('matching observation persists but applying difference zero creates no movement',()=>{
 const measured=execute(fixture(),{action:'measure',target:{section:'tanks',id:0},date:'2026-09-10',observedQty:5},'measurement'),before=JSON.stringify(measured.db),done=execute(measured.db,{action:'applyDifference',measurementId:'measurement'},'noop');assert.equal(done.review.noOp,true);assert.deepEqual(done.plan.sections,{});assert.equal(JSON.stringify(done.db),before);
});

test('unknown stock permits a factual neutral measurement but cannot authorize an invented adjustment',()=>{
 const db=fixture({tankIncomes:[{id:'unknown',tankId:0,date:'bad',amount:10}]}),done=execute(db,{action:'measure',target:{section:'tanks',id:0},date:'2026-09-10',observedQty:12},'measurement');assert.equal(done.db.fuelMovements[0].measurement.calculatedQty,null);assert.equal(done.db.fuelMovements[0].measurement.differenceQty,null);assert.equal(operations.preview(done.db,{action:'applyDifference',measurementId:'measurement',reason:'Не подставлять ноль'},{today}).canApply,false);
});

test('sub-millilitre difference remains exact on observation and refuses application without rounding',()=>{
 const measured=execute(fixture({tanks:[{id:0,fuel:'diesel',balanceInit:1.0004}]}),{action:'measure',target:{section:'tanks',id:0},date:'2026-09-10',observedQty:1},'measurement');assert.equal(measured.db.fuelMovements[0].measurement.differenceQty,'-0.0004');const review=operations.preview(measured.db,{action:'applyDifference',measurementId:'measurement',reason:'Нельзя округлять разницу'},{today});assert.equal(review.canApply,false);assert.ok(review.issues.some(issue=>issue.code==='FUEL_DIFFERENCE_PRECISION'));
});

test('source changes invalidate a measurement application, including an equal-date new receipt',()=>{
 const measured=execute(fixture(),{action:'measure',target:{section:'tanks',id:0},date:'2026-09-10',observedQty:4},'measurement');const changed={...measured.db,tankIncomes:[{id:'new',tankId:0,date:'2026-09-10',amount:1}]};assert.equal(operations.preview(changed,{action:'applyDifference',measurementId:'measurement',reason:'Нужна новая сверка'},{today}).canApply,false);
});

test('negative measured correction checks every later date, not just the measurement end-of-day',()=>{
 const db=fixture({genRecords:[{id:'later',generatorId:'g',tankId:0,date:'2026-09-11',fuelIssued:4}],generators:[{id:'g',tankId:0,fuel:'diesel',fuelBalance:0}]}),measured=execute(db,{action:'measure',target:{section:'tanks',id:0},date:'2026-09-10',observedQty:3},'measurement'),before=JSON.stringify(measured.db);assert.equal(operations.preview(measured.db,{action:'applyDifference',measurementId:'measurement',reason:'Не создавать будущий дефицит'},{today}).canApply,false);assert.equal(JSON.stringify(measured.db),before);
});

test('measurement void retains the original observation and never creates a reversal movement',()=>{
 const measured=execute(fixture(),{action:'measure',target:{section:'tanks',id:0},date:'2026-09-10',observedQty:0},'measurement'),observed=copy(measured.db.fuelMovements[0].measurement),done=execute(measured.db,{action:'voidMeasurement',measurementId:'measurement'},'void');assert.equal(done.db.fuelMovements.length,1);assert.deepEqual(done.db.fuelMovements[0].measurement,observed);assert.equal(done.db.fuelMovements[0].lifecycle.void.actor.id,actor.id);assert.equal(stock.balanceAt(done.db,{section:'tanks',id:0},'2026-09-30').balance,5);
 assert.equal(docs.preview(measured.db,{action:'reverse',section:'fuelMovements',id:'measurement',reason:'Замер не является движением'},{today}).canPost,false);
});

test('legacy transfer reversal retains both originals byte-for-byte and is globally once-only',()=>{
 const pair=[{id:0,linkId:0,kind:'out',date:'2026-09-01',tankId:0,counterTankId:'0',amount:-2,sum:-.105},{id:'0',linkId:0,kind:'in',date:'2026-09-01',tankId:'0',counterTankId:0,amount:2,sum:.105}],db=fixture({tanks:[{id:0,fuel:'diesel',balanceInit:5},{id:'0',fuel:'diesel',balanceInit:0}],tankIncomes:pair}),before=JSON.stringify(pair),done=execute(db,{action:'reverseLegacyTransfer',outId:0,inId:'0'},'reverse');assert.equal(JSON.stringify(done.db.tankIncomes),before);assert.equal(done.db.fuelMovements[0].fromTankId,'0');assert.equal(stock.balanceAt(done.db,{section:'tanks',id:0},'2026-09-30').balance,5);assert.equal(stock.balanceAt(done.db,{section:'tanks',id:'0'},'2026-09-30').balance,0);assert.equal(operations.preview(done.db,{action:'reverseLegacyTransfer',outId:0,inId:'0',reason:'Не повторять парное сторно'},{today}).canApply,false);
});

test('all-channel proof rejects forged metadata, unrelated changes, closed-period actions and future observation dates',()=>{
 const db=fixture(),done=execute(db,{action:'measure',target:{section:'tanks',id:0},date:'2026-09-10',observedQty:0},'measurement');assert.throws(()=>lifecycle.validateChanges(db,done.db));assert.throws(()=>operations.validateChanges(db,{...done.db,opsTasks:[{id:'unrelated'}]},done.proof));
 const closed=fixture({fuelPeriods:[{month:'2026-09',closed:true}]});assert.equal(operations.preview(closed,{action:'measure',target:{section:'tanks',id:0},date:'2026-09-10',observedQty:0,reason:'Не переписывать закрытый период'},{today}).canApply,false);assert.equal(operations.preview(db,{action:'measure',target:{section:'tanks',id:0},date:'2026-10-23',observedQty:0,reason:'Не выдумывать будущий замер'},{today}).canApply,false);
});

test('pure preview rejects over-precise observed quantities and conflicting aliases in either transfer half',()=>{
 const db=fixture();assert.equal(operations.preview(db,{action:'measure',target:{section:'tanks',id:0},date:'2026-09-10',observedQty:1.0004,reason:'Не округлять замер'},{today}).canApply,false);
 const pair=[{id:'out',linkId:0,kind:'out',date:'2026-09-01',tankId:0,counterTankId:'0',amount:-2},{id:'in',linkId:0,kind:'in',date:'2026-09-01',tankId:'0',counterTankId:0,amount:2}];
 for(const index of [0,1]){const rows=copy(pair);rows[index].liters=index===0?-3:3;const review=operations.preview({...db,tankIncomes:rows},{action:'reverseLegacyTransfer',outId:'out',inId:'in',reason:'Не выбирать удобный alias'},{today});assert.equal(review.canApply,false);assert.ok(review.issues.some(issue=>issue.code==='FUEL_LEGACY_PAIR'));}
});

test('a forged reversedBy marker cannot release measurement void; an actual exact inverse can',()=>{
 const measured=execute(fixture(),{action:'measure',target:{section:'tanks',id:0},date:'2026-09-10',observedQty:4},'measurement'),applied=execute(measured.db,{action:'applyDifference',measurementId:'measurement'},'adjustment');
 const forged=copy(applied.db);forged.fuelMovements[1].reversedBy='missing';assert.equal(operations.preview(forged,{action:'voidMeasurement',measurementId:'measurement',reason:'Маркер без обратного факта'},{today}).canApply,false);
 const action={action:'reverse',section:'fuelMovements',id:'adjustment',reason:'Подтверждённое обратное движение'},review=docs.preview(applied.db,action,{today});assert.equal(review.canPost,true,JSON.stringify(review.issues));const result=docs.plan(applied.db,{...action,reviewFingerprint:review.fingerprint},ctx('inverse')),reversed={...applied.db,...result.sections};const done=execute(reversed,{action:'voidMeasurement',measurementId:'measurement'},'void');assert.equal(done.db.fuelMovements.length,3);assert.equal(stock.balanceAt(done.db,{section:'tanks',id:0},'2026-09-30').balance,5);
});
