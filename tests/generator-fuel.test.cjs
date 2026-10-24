'use strict';
// Synthetic generator cards and journals only; the historical oracle is independent
// of GeneratorFuel and FuelMovementPolicy, including their module dependency graph.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const decimal=require('../assets/core/decimal-core.js'),periods=require('../assets/core/effective-periods.js');
const legacy=require('./fixtures/generator-fuel-legacy.cjs')(decimal,periods);
const movement=require('../assets/core/fuel-movement-policy.js');
const publicMethods=['generatorSpent','generatorNormSpent','generatorNormKnown'];
const allMethods=['generatorParameters','generatorRate','generatorIssueOnly',...publicMethods];
const parameters=(power,norm,norm100,norm50,normIdle)=>({power,norm,norm100,norm50,normIdle});
const dated=(...items)=>({fuelNorms:{version:1,periods:items.map(([from,params],index)=>({id:'synthetic:'+index,from,basis:'Synthetic frozen generator oracle',parameters:params}))}});
const generators=[
 null,{}, {power:100,norm:2}, {power:100,norm100:4,norm50:3,normIdle:1}, {power:100,norm100:4},
 {power:0,norm100:4,norm:2}, {power:100,norm100:0,norm50:0,normIdle:0},
 {power:'100',norm:'2.5',norm100:'4.5',norm50:'3.25',normIdle:'0.5'},
 {power:'0x64',norm:'0x10',norm100:'bad',norm50:false,normIdle:''},
 {power:123.456789,norm:3.456789,norm100:12.345678,norm50:6.543219,normIdle:0.123456},
 {power:100,norm:2,...dated(['2026-09-01',parameters(100,2,4,3,1)],['2026-11-01',parameters(200,5,8,5,2)])},
 dated(['2026-09-01',parameters(null,null,null,null,null)]),
 dated(['2026-11-01',parameters(100,2,4,3,1)]),
 {fuelNorms:{version:2,periods:[]}},
];
const record=(extra={})=>({date:'2026-09-10',hours:1,...extra});
const records=[
 null,{},record(),record({hours:0}),...[-10,0,25,50,75,100,150].map(load=>record({load})),
 record({hours:-2,load:75}),record({hours:1.23456789,load:0.12345678}),record({hours:'1.5',load:'50'}),
 record({fuelActual:0}),record({fuelActual:1.23456789}),record({fuelUsed:0}),record({fuelUsed:2.3456789}),
 record({fuelActual:2,fuelUsed:9}),record({fuelActual:'bad',fuelUsed:9}),record({fuelActual:false}),record({fuelUsed:'0x10'}),
 record({hours:0,fuelMovementId:0}),record({hours:0,fuelMovementId:'0'}),record({hours:'0',fuelMovementId:0}),
 record({date:'2026-12-10',hours:2,load:150}),record({date:'2026-08-31',load:75}),record({date:'invalid',load:75}),
 record({hours:2,load:25,fuelActual:'',fuelUsed:' '}),record({hours:2,load:75,fuelActual:-1}),
];
function result(api,method,generator,row){try{return {value:method==='generatorIssueOnly'?api[method](row):api[method](generator,row)};}catch(error){return {error:{name:error.name,code:error.code??null,message:error.message}};}}
function matrix(api,methods){return generators.flatMap((generator,g)=>records.map((row,r)=>({g,r,results:methods.map(method=>result(api,method,generator,row))})));}
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('the independent pre-extraction oracle and public result bytes are frozen',()=>{
 const source=fs.readFileSync(path.join(__dirname,'fixtures/generator-fuel-legacy.cjs'),'utf8').replace(/\r\n/g,'\n');
 assert.equal(crypto.createHash('sha256').update(source).digest('hex'),'93da24cd0fbe017143db707c0d143459c13494af1a7e8c322dabdb2367a83dd2');
 assert.deepEqual(matrix(movement,publicMethods),matrix(legacy,publicMethods));
 assert.equal(digest(matrix(legacy,publicMethods)),'0a5c54da2d6b23bb11e5673de7f952307f6c869a517f65dd54ac9ef3e6f773a0');
});

test('the foundation and delegated policy preserve every legacy, dated, manual and precision result',()=>{
 const api=require('../assets/core/generator-fuel.js'),before=JSON.stringify({generators,records});
 assert.equal(api.apiVersion,1);assert.ok(Object.isFrozen(api));
 assert.deepEqual(matrix(api,allMethods),matrix(legacy,allMethods));
 assert.deepEqual(matrix(movement,publicMethods),matrix(legacy,publicMethods));
 assert.equal(JSON.stringify({generators,records}),before);
});

test('the public physical and normative distinctions stay explicit at dated boundaries',()=>{
 const api=require('../assets/core/generator-fuel.js'),flat={power:100,norm:2};
 assert.equal(api.generatorSpent(flat,record()),0);assert.equal(api.generatorNormSpent(flat,record()),2);
 const card={...flat,...dated(['1900-01-01',parameters(100,2,null,null,null)])};
 assert.equal(api.generatorSpent(card,record()),null);assert.equal(api.generatorNormSpent(card,record()),2);
 assert.equal(api.generatorSpent(card,record({fuelActual:0})),0);assert.equal(api.generatorSpent(card,record({fuelUsed:0})),0);
 assert.equal(api.generatorSpent(card,record({hours:0,fuelMovementId:0})),0);
 const curve={power:100,norm100:4,norm50:3,normIdle:1};
 assert.equal(api.generatorSpent(curve,record({hours:2,load:75})),7);
 assert.equal(api.generatorSpent(curve,record({hours:2,load:0})),2);
 assert.equal(api.generatorSpent(curve,record({fuelActual:1.23456789})),1.23456789);
 assert.equal(api.generatorNormSpent(curve,record({fuelActual:9,hours:2,load:75})),7);
 const history=dated(['2026-09-01',parameters(100,2,4,3,1)],['2026-11-01',parameters(200,5,8,5,2)]);
 assert.equal(api.generatorSpent(history,record({date:'2026-10-31',hours:2,load:150})),10);
 assert.equal(api.generatorSpent(history,record({date:'2026-11-01',hours:2,load:150})),13);
 assert.equal(api.generatorSpent(history,record({date:'2026-08-31',load:75})),null);
});

test('GeneratorFuel loads with foundation providers only in an isolated browser runtime',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../assets/core/generator-fuel.js'),'utf8'),context={DecimalCore:decimal,EffectivePeriods:periods};
 vm.createContext(context);vm.runInContext(source,context);
 assert.equal(context.FuelMovementPolicy,undefined);assert.equal(context.FuelStock,undefined);
 assert.equal(JSON.stringify(matrix(context.GeneratorFuel,allMethods)),JSON.stringify(matrix(legacy,allMethods)));
});

test('the extracted foundation retains lazy dependency failure and manual zero behavior',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../assets/core/generator-fuel.js'),'utf8'),context={};vm.createContext(context);vm.runInContext(source,context);
 const api=context.GeneratorFuel;
 assert.equal(api.generatorSpent(null,record({fuelActual:0})),0);assert.equal(api.generatorNormSpent({},record({fuelUsed:0})),0);
 assert.equal(api.generatorNormKnown({norm:2},record()),true);
 assert.throws(()=>api.generatorSpent({power:100,norm100:4},record({load:50})),{code:'MODULE_UNAVAILABLE'});
 assert.throws(()=>api.generatorSpent(dated(['2026-09-01',parameters(100,2,4,3,1)]),record()),{code:'MODULE_UNAVAILABLE'});
});
