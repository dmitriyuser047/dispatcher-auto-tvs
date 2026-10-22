'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const contracts=require('../assets/core/platform-contracts.js'),fingerprint='sha256:'+'c'.repeat(64),reason='SYNTHETIC reviewed costing';
const wrap=input=>({type:'CostAction',version:1,input});
const policy=(section='tanks',id=0)=>({action:'savePolicy',target:{section,id},payload:{from:'2026-09-01',method:'fifo',taxBasis:'gross',opening:{qty:923.537,amount:null,basis:'SYNTHETIC physical opening evidence'},basis:'SYNTHETIC selected valuation policy'},reason,reviewFingerprint:fingerprint});
const allocation=(method='manual')=>({action:'saveAllocation',allocationId:0,payload:{source:{section:'repairs',id:0},method,from:'2026-09-01',to:'2026-09-30',targets:[{section:'vehicles',id:0,...(method==='manual'?{amount:0}:{})},{section:'vehicles',id:'0',...(method==='manual'?{amount:100}:{})}],basis:'SYNTHETIC documented allocation'},reason,reviewFingerprint:fingerprint});

test('cost policy DTO keeps typed targets, unknown versus explicit zero cost and the exact existing physical opening',()=>{
 for(const section of ['tanks','parts','vehicles','generators'])for(const id of [0,'0'])for(const amount of [null,0,123.45]){const input=policy(section,id);input.payload.opening.amount=amount;input.payload.opening.qty=.0004;const before=JSON.stringify(input);assert.deepEqual(contracts.validateCommand(wrap(input)),wrap(input));assert.equal(JSON.stringify(input),before);}
});

test('cost policy DTO requires explicit method, tax basis, date, evidence and reviewed fingerprint without client audit fields',()=>{
 const valid=policy();for(const field of Object.keys(valid.payload)){const input=structuredClone(valid);delete input.payload[field];assert.throws(()=>contracts.validateCommand(wrap(input)),{code:'INVALID_COMMAND'});}
 for(const field of ['qty','amount','basis']){const input=structuredClone(valid);delete input.payload.opening[field];assert.throws(()=>contracts.validateCommand(wrap(input)),{code:'INVALID_COMMAND'});}
 for(const patch of [{method:''},{method:'lastPrice'},{taxBasis:''},{from:'2026-02-30'},{basis:'  '},{version:1},{actor:{id:'spoof'}}])assert.throws(()=>contracts.validateCommand(wrap({...valid,payload:{...valid.payload,...patch}})),{code:'INVALID_COMMAND'});
 for(const patch of [{reason:'x'},{reviewFingerprint:'unreviewed'},{actor:{id:'spoof'}},{now:'2026-09-01T12:00:00Z'},{operationId:'spoof'}])assert.throws(()=>contracts.validateCommand(wrap({...valid,...patch})),{code:'INVALID_COMMAND'});
 for(const patch of [{qty:-1},{qty:'923.537'},{amount:-1},{amount:Infinity},{amount:'0'},{amount:1e12+1},{basis:''}])assert.throws(()=>contracts.validateCommand(wrap({...valid,payload:{...valid.payload,opening:{...valid.payload.opening,...patch}}})),{code:'INVALID_COMMAND'});
});

test('allocation DTO preserves typed source and recipients and separates manual amounts from journal-derived weights',()=>{
 for(const method of ['manual','km','hours'])for(const source of ['payments','repairs','vehicleTo','toRecords','workOrders','costEntries']){const input=allocation(method);input.payload.source.section=source;assert.deepEqual(contracts.validateCommand(wrap(input)),wrap(input));}
 const manual=allocation();delete manual.payload.targets[0].amount;assert.throws(()=>contracts.validateCommand(wrap(manual)),{code:'INVALID_COMMAND'});
 for(const method of ['km','hours']){const input=allocation(method);input.payload.targets[0].amount=0;assert.throws(()=>contracts.validateCommand(wrap(input)),{code:'INVALID_COMMAND'});}
 for(const patch of [{targets:[]},{targets:[{section:'vehicles',id:0,amount:50},{section:'vehicles',id:0,amount:50}]},{targets:Array.from({length:1001},(_,id)=>({section:'vehicles',id,amount:0}))},{source:{section:'budget',id:0}},{to:'2026-08-31'},{method:'estimate'},{sourceFingerprint:'forged'}])assert.throws(()=>contracts.validateCommand(wrap({...allocation(),payload:{...allocation().payload,...patch}})),{code:'INVALID_COMMAND'});
});

test('cost DTO parsing rejects executable properties and sparse allocations without evaluating untrusted code',()=>{
 let calls=0;const input=policy();Object.defineProperty(input.payload.opening,'amount',{enumerable:true,get(){calls++;return 0;}});assert.throws(()=>contracts.validateCommand(wrap(input)),{code:'INVALID_COMMAND'});assert.equal(calls,0);
 const sparse=allocation();sparse.payload.targets=new Array(2);sparse.payload.targets[1]={section:'vehicles',id:0,amount:100};assert.throws(()=>contracts.validateCommand(wrap(sparse)),{code:'INVALID_COMMAND'});
});

test('the common command planner preserves narrowed costing authority for its independent domain check',()=>{
 const schema=require('../assets/core/platform-schema.js'),ops=require('../assets/core/cost-operations.js'),commands=require('../assets/core/platform-commands.js'),db=Object.fromEntries(schema.sections.map(name=>[name,[]]));db.parts=[{id:0,name:'SYNTHETIC part'}];const input=policy('parts');input.payload.opening.qty=0;input.payload.opening.amount=0;const review=ops.preview(db,input,{today:'2026-10-22'});assert.equal(review.canApply,true);const command=wrap({...input,reviewFingerprint:review.fingerprint}),ctx={id:'synthetic-narrow-cost',now:'2026-10-22T12:00:00.000Z',today:'2026-10-22',actor:{id:'synthetic',name:'Synthetic',role:'admin'},readable:['parts','partMovements','fuelPeriods'],writable:['costEntries']};assert.throws(()=>commands.plan(db,command,ctx),{code:'ACCESS_DENIED'});assert.deepEqual(ctx.writable,['costEntries']);
});
