'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const inventory=require('../assets/core/inventory-stock'),identity=require('../assets/core/entity-identity');
const db=patch=>({parts:[{id:0,name:'Numeric',unit:'шт.'},{id:'0',name:'String',unit:'шт.'}],partMovements:[],...patch});
const at=(data,id=0,date='2026-09-30')=>inventory.balanceAt(data,{section:'parts',id},date);
test('exact parts projector keeps typed zero IDs and archived actuals, ignores cancelled/deleted and makes supplierReturn outbound',()=>{
 const data=db({partMovements:[{id:'a',partId:0,date:'2026-09-01',kind:'receipt',qty:.3,archived:true},{id:'b',partId:0,date:'2026-09-02',kind:'issue',qty:.1},{id:'c',partId:0,date:'2026-09-03',kind:'supplierReturn',qty:.1},{id:'other',partId:'0',date:'2026-09-01',kind:'receipt',qty:2},{id:'cancelled',partId:0,date:'2026-09-01',kind:'receipt',qty:100,cancelled:true},{id:'deleted',partId:0,date:'2026-09-01',kind:'receipt',qty:100,deleted:true},{id:'status',partId:0,date:'2026-09-01',kind:'receipt',qty:100,status:'cancelled'}]}),before=JSON.stringify(data);assert.equal(at(data).balanceDecimal,'0.1');assert.equal(at(data,'0').balance,2);assert.equal(JSON.stringify(data),before);const projection=inventory.project(data);assert.ok(Object.isFrozen(projection.index));assert.equal(inventory.at(projection,{section:'parts',id:0},'2026-09-30',{includeEvents:true}).events.length,3);assert.ok(projection.index[identity.typedKey('parts',0)]);
});
test('tiny real negative stock is rejected without epsilon and an old negative can improve without rewriting facts',()=>{
 const base=db({partMovements:[{id:'in',partId:0,date:'2026-09-01',kind:'receipt',qty:.0009999999999}]}),next={...base,partMovements:[...base.partMovements,{id:'out',partId:0,date:'2026-09-02',kind:'issue',qty:.001}]};assert.equal(at(next).balanceDecimal,'-0.0000000000001');assert.throws(()=>inventory.validateChanges(base,next));const old=db({partMovements:[{id:'bad',partId:0,date:'2026-09-02',kind:'issue',qty:5}]});assert.equal(inventory.validateChanges(old,{...old,partMovements:[{id:'repair',partId:0,date:'2026-09-01',kind:'receipt',qty:3},...old.partMovements]}),true);
});
test('date-aware unknown never becomes an authorized partial balance and does not poison an earlier valid day',()=>{
 const data=db({partMovements:[{id:'in',partId:0,date:'2026-09-01',kind:'receipt',qty:10},{id:'unknown',partId:0,date:'2026-10-01',kind:'receipt',qty:'unknown'}]}),projected=inventory.project(data);assert.equal(inventory.at(projected,{section:'parts',id:0},'2026-09-30').balance,10);assert.equal(inventory.at(projected,{section:'parts',id:0},'2026-10-01').balance,null);assert.throws(()=>inventory.validateChanges(data,{...data,partMovements:[...data.partMovements,{id:'out',partId:0,date:'2026-10-02',kind:'issue',qty:1}]}));
});
test('same-day stock has no invented time order; the end-of-day result controls availability',()=>{
 const data=db({partMovements:[{id:'out',partId:0,date:'2026-09-01',kind:'issue',qty:3},{id:'in',partId:0,date:'2026-09-01',kind:'receipt',qty:3}]});assert.equal(at(data).balance,0);assert.equal(inventory.inspect(data).issues.some(issue=>issue.code==='PART_STOCK_DEFICIT'),false);
});
test('invalid stock boundaries never execute accessors or toJSON and missing dependencies fail closed',()=>{
 let executions=0;const source={partId:0,date:'2026-09-01',kind:'receipt',qty:1};Object.defineProperty(source,'id',{get(){executions++;return 'bad';},enumerable:true});assert.throws(()=>inventory.project(db({partMovements:[source]})));assert.equal(executions,0);assert.throws(()=>inventory.project(db(),{},{readable:['parts']}),{code:'ACCESS_DENIED'});
});

test('duplicate movement identities never become two authorized receipts, including across selected parts',()=>{
 const base=db({partMovements:[{id:0,partId:0,date:'2026-09-01',kind:'receipt',qty:3},{id:'0',partId:'0',date:'2026-09-01',kind:'receipt',qty:7}]}),next={...base,partMovements:[...base.partMovements,{id:0,partId:'0',date:'2026-09-02',kind:'receipt',qty:3}]};
 assert.equal(at(base,0).balance,3);assert.equal(at(base,'0').balance,7);
 for(const partId of [0,'0']){const result=at(next,partId);assert.equal(result.status,'invalid');assert.equal(result.balance,null);assert.ok(result.diagnostics.some(problem=>problem.code==='PART_MOVEMENT_AMBIGUOUS'));}
 assert.throws(()=>inventory.validateChanges(base,next),error=>error.issues?.some(problem=>problem.code==='PART_MOVEMENT_AMBIGUOUS'));
 const outbound={...next,partMovements:[...next.partMovements,{id:'spend',partId:0,date:'2026-09-03',kind:'issue',qty:1}]};assert.throws(()=>inventory.validateChanges(next,outbound),{code:'PART_STOCK_UNKNOWN'});
 assert.equal(inventory.validateChanges(next,base),true);
});

test('a projection bounded to one date cannot authorize a later balance from missing future events',()=>{
 const data=db({partMovements:[{id:'in',partId:0,date:'2026-09-01',kind:'receipt',qty:10},{id:'out',partId:0,date:'2026-10-01',kind:'issue',qty:8}]}),bounded=inventory.project(data,{to:'2026-09-30'});
 assert.equal(inventory.at(bounded,{section:'parts',id:0},'2026-09-30').balance,10);
 assert.throws(()=>inventory.at(bounded,{section:'parts',id:0},'2026-10-01'),{code:'INVENTORY_SNAPSHOT_RANGE'});
 assert.equal(at(data,0,'2026-10-01').balance,2);
});

test('out-of-range intermediate balances fail closed on that date without poisoning earlier known days',()=>{
 const data=db({partMovements:[{id:'in',partId:0,date:'2026-09-01',kind:'receipt',qty:9007199254740991},{id:'fraction',partId:0,date:'2026-09-02',kind:'receipt',qty:0.1}]}),projected=inventory.project(data);
 assert.equal(inventory.at(projected,{section:'parts',id:0},'2026-09-01').balance,9007199254740991);
 const invalid=inventory.at(projected,{section:'parts',id:0},'2026-09-02');assert.equal(invalid.status,'invalid');assert.equal(invalid.balance,null);assert.ok(invalid.diagnostics.some(problem=>problem.code==='PART_RANGE'));
 const recovered=inventory.project({...data,partMovements:[...data.partMovements,{id:'out',partId:0,date:'2026-09-03',kind:'issue',qty:0.1}]});
 const intermediate=inventory.at(recovered,{section:'parts',id:0},'2026-09-02');assert.equal(intermediate.status,'invalid');assert.equal(intermediate.balance,null);assert.ok(intermediate.diagnostics.some(problem=>problem.code==='PART_RANGE'));
 assert.equal(inventory.at(recovered,{section:'parts',id:0},'2026-09-03').balance,9007199254740991);
});
