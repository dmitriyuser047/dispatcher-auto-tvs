'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{createRequire}=require('node:module');
const current=require('../assets/core/request-fingerprint.js'),released=require('./fixtures/request-fingerprint-v3.5.8/request-fingerprint.js');
const oldClone=value=>value===undefined?undefined:JSON.parse(released.stableSerialize(value));
const outcome=callback=>{try{return {value:callback()};}catch(error){return {error:{name:error.name,code:error.code,message:error.message,...(Object.hasOwn(error,'details')?{details:error.details}:{})}};}};
const nest=depth=>{let value=null;for(let i=0;i<depth;i++)value={next:value};return value;};
test('canonical clones retain published JSON values and wire bytes including zero, sparse arrays, Unicode and property order',()=>{
 const shared={quantity:923.537},values=[undefined,null,true,false,0,-0,923.537,'Синтетика 🚚\ud800',Array(3),[undefined,-0,shared,shared],{z:[undefined,,0,-0],a:{b:undefined,a:true},q:null},{'10':'ten','2':'two',b:2,a:1},Object.assign(Object.create(null),{z:1,a:2}),Object.assign(Object.create({inherited:true}),{own:0}),nest(128)];
 for(const value of values){const actual=current.canonicalClone(value);assert.deepEqual(actual,oldClone(value));assert.equal(JSON.stringify(actual),released.stableSerialize(value));assert.equal(current.stableSerialize(value),released.stableSerialize(value));}
 assert.equal(Object.is(current.canonicalClone(-0),0),true);assert.equal(Object.is(current.canonicalClone({value:-0}).value,-0),false);
});
test('frozen input and shared references yield fresh independent JSON trees without modifying the source',()=>{
 const child=Object.freeze({nested:Object.freeze([0,false,null])}),source=Object.freeze({left:child,right:child}),one=current.canonicalClone(source),two=current.canonicalClone(source);assert.notEqual(one,source);assert.notEqual(one.left,child);assert.notEqual(one.left,one.right);assert.notEqual(one.left,two.left);one.left.nested[0]=5;assert.equal(one.right.nested[0],0);assert.equal(two.left.nested[0],0);assert.equal(source.left.nested[0],0);
 const large={parts:Array.from({length:2500},(_,id)=>({id,name:'Synthetic part '+id,source:{note:'x'.repeat(256),enabled:false,amount:null}}))},before=JSON.stringify(large),copy=current.canonicalClone(large);assert.deepEqual(copy,oldClone(large));copy.parts[2499].source.enabled=true;assert.equal(JSON.stringify(large),before);
});
test('canonical clones retain the released cycle, forbidden field, unsupported type and depth errors',()=>{
 const cycle={};cycle.self=cycle;const array=[];array.push(array);
 for(const value of [NaN,Infinity,-Infinity,1n,Symbol('unsupported'),()=>{},new Date(0),new Map(),new Set(),new Uint8Array([1]),cycle,array,JSON.parse('{"__proto__":1}'),{prototype:1},{constructor:1},{toJSON(){return 1;}},nest(129)])assert.deepEqual(outcome(()=>current.canonicalClone(value)),outcome(()=>oldClone(value)));
});
test('enumerable getters follow the same sorted read order and propagate the same released validation errors',()=>{
 for(const fail of [false,true]){const run=clone=>{const reads=[],value={get z(){reads.push('z');return fail?NaN:0;},get a(){reads.push('a');return false;}};return {result:outcome(()=>clone(value)),reads};};assert.deepEqual(run(current.canonicalClone),run(oldClone));}
});
test('browser UMD exposes the same owned clones without changing released request digests',()=>{
 const context=vm.createContext({});vm.runInContext(fs.readFileSync(require.resolve('../assets/core/request-fingerprint.js'),'utf8'),context);const value={parts:[{id:0,custom:{zero:-0,empty:null,enabled:false}}]};assert.equal(JSON.stringify(context.RequestFingerprint.canonicalClone(value)),JSON.stringify(current.canonicalClone(value)));
 for(const request of [{base:{records:1},sections:{records:[{id:0,km:923.537}]}},{protocolVersion:1,base:{records:1},command:{type:'Synthetic',version:1,input:{id:'0',note:'Топливо 🚚'}}}]){assert.equal(current.requestDigest(request),released.requestDigest(request));assert.equal(context.RequestFingerprint.requestDigest(request),released.requestDigest(request));}
});
test('the kernel uses owned canonical trees and falls back to the released serializer for an older fingerprint module',()=>{
 const filename=require.resolve('../assets/core/platform-kernel.js'),source=fs.readFileSync(filename,'utf8'),originalRequire=createRequire(filename),database={vehicles:[{id:0,plate:'SYNTHETIC'}],records:[],parts:[{id:'unchanged',note:'unchanged-large-probe '+ 'x'.repeat(65536)}]},next={records:[{id:'record',vehicleId:0,date:'2026-11-11',km:1}]},context={identity:'synthetic-canonical-clone',id:'owned-clone',now:'2026-11-11T10:00:00Z',today:'2026-11-11',actor:{id:'test',role:'admin'}};
 const run=modern=>{let largeParses=0,ownedClones=0;const api={...current,...(modern?{canonicalClone:value=>{ownedClones++;return current.canonicalClone(value);}}:{})};if(!modern)delete api.canonicalClone;const customJSON=Object.create(JSON);customJSON.parse=function(text,...args){if(typeof text==='string'&&text.includes('unchanged-large-probe'))largeParses++;return JSON.parse(text,...args);};const sandbox={module:{exports:{}},JSON:customJSON,require:name=>name==='./request-fingerprint.js'?api:originalRequire(name)};vm.runInNewContext(source,sandbox,{filename});return {plan:sandbox.module.exports.prepare(database,next,context),largeParses,ownedClones};};
 const modern=run(true),old=run(false);assert.equal(JSON.stringify(modern.plan),JSON.stringify(old.plan));assert.ok(modern.ownedClones>0);assert.equal(modern.largeParses,0);assert.ok(old.largeParses>0);assert.equal(database.parts[0].note.startsWith('unchanged-large-probe'),true);
});
