'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const stock=require('../assets/core/fuel-stock'),policy=require('../assets/core/fuel-movement-policy'),schema=require('../assets/core/platform-schema'),docs=require('../assets/core/document-engine');
const ctx={id:'synthetic',now:'2026-10-22T12:00:00.000Z',today:'2026-10-22',actor:{id:'synthetic',name:'Синтетический проверяющий',role:'admin'}};
const fixture=extra=>({...Object.fromEntries(schema.sections.map(name=>[name,[]])),tanks:[{id:0,fuel:'diesel',balanceInit:923.537},{id:'0',fuel:'diesel',balanceInit:0}],generators:[{id:0,tankId:0,fuel:'diesel',fuelBalance:0},{id:'0',tankId:'0',fuel:'diesel',fuelBalance:0}],...extra});
const at=(db,id=0,date='2026-09-30')=>stock.balanceAt(db,{section:'tanks',id},date);

test('single decimal projection keeps typed IDs, millilitres and detached generator receipts exactly once',()=>{
 const db=fixture({tankIncomes:[{id:'receipt',tankId:0,date:'2026-09-01',amount:.001}],genRecords:[{id:'legacy',generatorId:0,date:'2026-09-02',fuelIssued:1},{id:'detached',generatorId:0,tankId:null,date:'2026-09-03',fuelIssued:100},{id:'other',generatorId:'0',date:'2026-09-04',fuelIssued:0}],fuelMovements:[{id:'issue',date:'2026-09-03',kind:'issue',fromTankId:0,qty:100}]});
 const before=JSON.stringify(db),value=at(db);assert.equal(value.balanceDecimal,'822.538');assert.equal(value.balance,822.538);assert.equal(at(db,'0').balance,0);assert.equal(stock.project(db).rows[0].events.length,3);assert.equal(JSON.stringify(db),before);
});

test('cancelled and deleted incomes, generator receipts and modern movements never authorize new stock',()=>{
 for(const field of ['cancelled','deleted'])for(const section of ['tankIncomes','genRecords','fuelMovements']){
  const source=section==='tankIncomes'?{id:'source',tankId:0,date:'2026-09-01',amount:10}:section==='genRecords'?{id:'source',generatorId:0,date:'2026-09-01',fuelIssued:10}:{id:'source',toTankId:0,date:'2026-09-01',qty:10,kind:'receipt',reason:'Факт'};
  const db=fixture({tanks:[{id:0,fuel:'diesel',balanceInit:0}],[section]:[{...source,[field]:true}]});assert.equal(at(db).balance,0,section+' '+field);
  const next={...db,fuelMovements:[...db.fuelMovements,{id:'draw',kind:'issue',date:'2026-09-02',fromTankId:0,qty:5,reason:'Нельзя выдать отсутствующий запас'}]};assert.throws(()=>policy.validateChanges(db,next));
 }
});

test('conflicting quantity aliases are invalid rather than silently selecting a larger available stock',()=>{
 const db=fixture({tanks:[{id:0,fuel:'diesel',balanceInit:0}],tankIncomes:[{id:'ambiguous',tankId:0,date:'2026-09-01',amount:10,liters:20}]});assert.equal(at(db).status,'invalid');assert.equal(at(db).balance,null);assert.ok(at(db).diagnostics.some(issue=>issue.code==='STOCK_ALIASES_CONFLICT'));
 assert.throws(()=>policy.validateChanges(db,{...db,fuelMovements:[{id:'draw',kind:'issue',date:'2026-09-02',fromTankId:0,qty:15,reason:'Проверка'}]}));
 const consistent={...db,tankIncomes:[{...db.tankIncomes[0],liters:'10'}]};assert.equal(at(consistent).balance,10);
});

test('legacy transfer preserves signed legs and applies each tank accounting boundary independently',()=>{
 const db=fixture({tanks:[{id:0,fuel:'diesel',fuelAccounting:{version:1,from:'2026-09-01',opening:100,basis:'Замер'}},{id:'0',fuel:'diesel',fuelAccounting:{version:1,from:'2026-10-01',opening:12.345,basis:'Замер'}}],tankIncomes:[{id:'out',kind:'out',linkId:'pair',tankId:0,counterTankId:'0',date:'2026-09-10',amount:-20},{id:'in',kind:'in',linkId:'pair',tankId:'0',counterTankId:0,date:'2026-09-10',amount:20}]});
 assert.equal(at(db).balance,80);assert.equal(at(db,'0').status,'outside-accounting');assert.equal(at(db,'0','2026-10-01').balance,12.345);
 const historical=stock.project(db).rows.find(row=>row.target.id==='0').events[0];assert.equal(historical.outsideAccounting,true);assert.equal(historical.stockAffects,false);assert.equal(historical.balanceDecimal,null);
 const wrong={...db,tankIncomes:[db.tankIncomes[0],{...db.tankIncomes[1],amount:21}]};assert.equal(at(wrong).status,'invalid');assert.ok(at(wrong).diagnostics.some(issue=>issue.code==='STOCK_TRANSFER_PAIR'));
});

test('unknown future quantities cannot poison a prior known day; invalid undated sources remain unallocated',()=>{
 const db=fixture({tankIncomes:[{id:'valid',tankId:0,date:'2026-09-01',amount:.001},{id:'future',tankId:0,date:'2026-10-01',amount:'unknown'}]}),projection=stock.project(db);
 assert.equal(projection.rows[0].status,'unknown');assert.equal(stock.at(projection,{section:'tanks',id:0},'2026-09-30').balance,923.538);assert.equal(stock.at(projection,{section:'tanks',id:0},'2026-10-01').balance,null);assert.equal(at(db).balance,923.538);
 const undated={...db,tankIncomes:[{id:'unallocated',tankId:0,date:'bad',amount:10}]};assert.equal(at(undated).status,'unknown');assert.equal(at(undated).balance,null);
});

test('start-day exclusive balance is the opening while raw pre-start facts remain visible without entering it',()=>{
 const db=fixture({tanks:[{id:0,fuelAccounting:{version:1,from:'2026-09-01',opening:923.537,basis:'Подтверждённый входящий остаток'}}],tankIncomes:[{id:'early',tankId:0,date:'2026-08-31',amount:80},{id:'first',tankId:0,date:'2026-09-01',amount:.001}]});
 const projection=stock.project(db);assert.equal(stock.at(projection,{section:'tanks',id:0},'2026-08-31').balance,null);assert.equal(stock.at(projection,{section:'tanks',id:0},'2026-09-01',{inclusive:false}).balance,923.537);assert.equal(at(db,0,'2026-09-01').balance,923.538);assert.equal(projection.rows[0].events[0].stockAffects,false);
});

test('active receipt revision replaces its root once, keeps raw row index and original source bytes',()=>{
 const db=fixture({tankIncomes:[{id:'original',tankId:0,date:'2026-09-01',amount:10,liters:20,sum:.105}]});const before=JSON.stringify(db.tankIncomes[0]);
 const draft=docs.plan(db,{action:'saveDraft',section:'tankIncomes',payload:{amount:15},correctionOf:{section:'tankIncomes',id:'original'},reason:'Выбрано подтверждённое количество'},{...ctx,id:'draft'}),staged={...db,...draft.sections};const action={action:'postDraft',section:'tankIncomes',draftId:'draft'},review=docs.preview(staged,action,{today:ctx.today});assert.equal(review.canPost,true,JSON.stringify(review.issues));const result=docs.plan(staged,{...action,reviewFingerprint:review.fingerprint},{...ctx,id:'corrected'}),next={...staged,...result.sections};
 assert.equal(at(next).balance,938.537);assert.equal(next.tankIncomes[1].liters,undefined);assert.equal(next.tankIncomes[1].sum,.105);assert.equal(JSON.stringify(next.tankIncomes[0]),before);assert.equal(stock.project(next).rows[0].events[0].source.rowIndex,1);
});

test('broken explicit receipt chains invalidate affected stock rather than fabricating a known partial balance',()=>{
 const lifecycle={version:1,postedAt:ctx.now,postedActor:ctx.actor,operationId:'broken',correctionOf:{section:'tankIncomes',id:'missing'}};
 const db=fixture({tankIncomes:[{id:'good',tankId:0,date:'2026-09-01',amount:10},{id:'orphan',tankId:0,date:'2026-09-02',amount:5,lifecycle}]});
 const value=at(db);assert.equal(value.balance,null);assert.equal(value.status,'invalid');assert.ok(value.diagnostics.some(issue=>issue.code==='DOCUMENT_CHAIN'));assert.equal(at(db,'0').balance,0);
 assert.throws(()=>policy.validateChanges(db,{...db,fuelMovements:[{id:'draw',kind:'issue',fromTankId:0,date:'2026-09-03',qty:1,reason:'Частичный остаток не разрешает выдачу'}]}));
 const cycle={...db,tankIncomes:[{id:'a',tankId:0,date:'2026-09-01',amount:10,lifecycle:{...lifecycle,correctionOf:{section:'tankIncomes',id:'b'}}},{id:'b',tankId:0,date:'2026-09-02',amount:10,lifecycle:{...lifecycle,correctionOf:{section:'tankIncomes',id:'a'}}}]};assert.equal(at(cycle).balance,null);
});

test('owned typed index resolves a large frozen projection without scanning other tanks or re-freezing event histories',()=>{
 const db=fixture({tanks:Array.from({length:1000},(_,id)=>({id,balanceInit:923.537})),tankIncomes:Array.from({length:10000},(_,id)=>({id,tankId:id%1000,date:'2026-09-01',amount:.001}))});
 const projected=stock.project(db);assert.ok(Object.isFrozen(projected.index));assert.ok(Object.isFrozen(projected.rows[0].sourceProjection.events));
 for(let id=0;id<1000;id++)assert.equal(stock.at(projected,{section:'tanks',id},'2026-09-30').balance,923.547);
 const wrong={...projected,index:{...projected.index,[require('../assets/core/entity-identity').typedKey('tanks',0)]:[1]}};assert.throws(()=>stock.at(wrong,{section:'tanks',id:0},'2026-09-30'),{code:'STOCK_SNAPSHOT'});
});
