'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createHandlers}=require('../electron/schema-upgrade-ipc.cjs');
const fingerprint='sha256:'+'a'.repeat(64);
function setup(overrides={}){
 const context={sourceDir:path.resolve('synthetic-source'),role:'admin',client:false},calls=[];
 const handlers=createHandlers({getContext:()=>context,assertContext:()=>{},inspectSource:input=>{calls.push(['inspect',input]);return {sourceFingerprint:fingerprint,requiresUpgrade:true,counts:{vehicles:1}};},upgradeCopy:input=>{calls.push(['copy',input]);return {targetDir:input.targetDir,schemaVersion:2};},...overrides});return {context,calls,handlers};
}
test('schema upgrade IPC binds its source to the current trusted database and forwards the reviewed fingerprint',async()=>{
 const {context,calls,handlers}=setup();assert.equal((await handlers.inspect({})).sourceFingerprint,fingerprint);
 const targetDir=path.resolve('synthetic-target'),result=await handlers.copy({targetDir,targetFormat:'sqlite',expectedSourceFingerprint:fingerprint});assert.equal(result.ok,true);
 assert.deepEqual(calls,[['inspect',{sourceDir:context.sourceDir}],['copy',{sourceDir:context.sourceDir,targetDir,targetFormat:'sqlite',expectedSourceFingerprint:fingerprint}]]);
});
test('schema upgrade IPC cannot select a renderer supplied source or bypass the administrator and local host boundary',async()=>{
 for(const payload of [{sourceDir:path.resolve('other')},{unexpected:true}]){const {handlers,calls}=setup();await assert.rejects(handlers.inspect(payload),{code:'INVALID_UPGRADE'});assert.deepEqual(calls,[]);}
 for(const context of [{sourceDir:path.resolve('source'),role:'viewer',client:false},{sourceDir:path.resolve('source'),role:'admin',client:true}]){const {handlers,calls}=setup({getContext:()=>context});await assert.rejects(handlers.inspect({}),{code:'UPGRADE_ACCESS_DENIED'});await assert.rejects(handlers.copy({targetDir:path.resolve('target'),expectedSourceFingerprint:fingerprint}),{code:'UPGRADE_ACCESS_DENIED'});assert.deepEqual(calls,[]);}
});
test('invalid or overlapping targets, executable input and an absent review never start a copy',async()=>{
 const {handlers,context,calls}=setup();
 for(const payload of [{targetDir:'relative',expectedSourceFingerprint:fingerprint},{targetDir:context.sourceDir,expectedSourceFingerprint:fingerprint},{targetDir:path.join(context.sourceDir,'child'),expectedSourceFingerprint:fingerprint},{targetDir:path.dirname(context.sourceDir),expectedSourceFingerprint:fingerprint},{targetDir:path.resolve('target')},{targetDir:path.resolve('target'),targetFormat:'future',expectedSourceFingerprint:fingerprint}])await assert.rejects(handlers.copy(payload));
 let getterCalls=0;await assert.rejects(handlers.copy(Object.defineProperty({},'targetDir',{enumerable:true,get(){getterCalls++;return path.resolve('target');}})),{code:'INVALID_UPGRADE'});assert.equal(getterCalls,0);assert.deepEqual(calls,[]);
});
test('a stale window prevents inspection or copying, while a completed copy remains reported after a later session change',async()=>{
 const stale=setup({assertContext:()=>{throw Object.assign(Error('Changed session'),{code:'SESSION_CHANGED'});}});await assert.rejects(stale.handlers.inspect({}),{code:'SESSION_CHANGED'});await assert.rejects(stale.handlers.copy({targetDir:path.resolve('target'),expectedSourceFingerprint:fingerprint}),{code:'SESSION_CHANGED'});assert.deepEqual(stale.calls,[]);
 let checks=0;const completed=setup({assertContext:()=>{if(++checks===2)throw Error('Changed after copy');}}),result=await completed.handlers.copy({targetDir:path.resolve('target'),expectedSourceFingerprint:fingerprint});assert.equal(result.ok,true);assert.equal(result.sessionChanged,true);assert.equal(result.targetDir,path.resolve('target'));assert.equal(completed.calls.length,1);
});
