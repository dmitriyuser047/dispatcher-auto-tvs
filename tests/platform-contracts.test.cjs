'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const contracts=require('../assets/core/platform-contracts.js');
const schema=require('../assets/core/platform-schema.js');

test('runtime DTO contracts preserve numeric IDs and fractional actual measurements',()=>{
  const request={base:{vehicles:1,records:2},sections:{vehicles:[{id:7,fuelBalance:923.537}],records:[{id:'r',vehicleId:7,date:'2026-09-01',fuelActual:1.001}]},databaseToken:'synthetic-token',operation:{id:'contract-operation'}};
  const before=JSON.stringify(request),parsed=contracts.parseSectionWrite(request,schema.sections);
  assert.equal(parsed.sections.vehicles[0].id,7);assert.equal(parsed.sections.vehicles[0].fuelBalance,923.537);
  assert.equal(JSON.stringify(request),before);assert.equal(Object.isFrozen(contracts),true);
});

test('runtime contract rejects malformed revisions, sections, rows and operation identities',()=>{
  for(const base of [null,[],{records:-1},{records:1.5},{records:'1'},{missing:1}])assert.throws(()=>contracts.parseSectionWrite({base,sections:{}},schema.sections),error=>error.code==='INVALID_BASE');
  for(const sections of [null,[],{missing:[]},{records:{}},{records:[null]},{records:[[]]}])assert.throws(()=>contracts.validateSections(sections,schema.sections),error=>error.code==='INVALID_SECTIONS');
  for(const operation of [null,[],{}, {id:1},{id:'contains space'},{id:'x',digest:'wrong'}])assert.throws(()=>contracts.validateOperation(operation),error=>error.code==='INVALID_OPERATION');
  const digest='sha256:'+'a'.repeat(64);assert.deepEqual(contracts.validateOperation({id:'op:1',digest}),{id:'op:1',digest});
});

test('incoming rows cannot hide executable properties, cycles, unsafe keys or lossy JSON values',()=>{
  const cycle={id:'cycle'};cycle.self=cycle;
  let called=false;const getter={id:'getter'};Object.defineProperty(getter,'secret',{enumerable:true,get(){called=true;return 'bad';}});
  for(const row of [{id:'n',n:NaN},{id:'i',n:Infinity},{id:'b',n:1n},{id:'f',f(){}},{id:'u',value:undefined},cycle,getter,JSON.parse('{"id":"unsafe","__proto__":{"polluted":true}}')])
    assert.throws(()=>contracts.validateSections({vehicles:[row]},schema.sections),error=>error.code==='INVALID_JSON');
  assert.equal(called,false);assert.equal({}.polluted,undefined);
});

test('strict contract build has identical browser and CommonJS behavior without application globals',()=>{
  const context=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/core/platform-contracts.js'),'utf8'),context);
  const request={base:{records:0},sections:{records:[{id:1,vehicleId:7,km:100.125}]},operation:{id:'browser'}};
  assert.equal(JSON.stringify(context.PlatformContracts.parseSectionWrite(request,schema.sections)),JSON.stringify(contracts.parseSectionWrite(request,schema.sections)));
  assert.equal(context.PlatformContracts.identifier(7),true);assert.equal(context.PlatformContracts.identifier(''),false);assert.equal(context.document,undefined);
});
