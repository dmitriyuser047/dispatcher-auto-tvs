'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const filename=path.resolve(__dirname,'../assets/core/request-fingerprint.js'),source=fs.readFileSync(filename,'utf8');
test('Node fingerprint hashes the exact released canonical UTF-8 bytes with the native implementation',()=>{
 const module={exports:{}},hashed=[];
 vm.runInNewContext(source,{module,require(name){assert.equal(name,'node:crypto');return {createHash(algorithm){assert.equal(algorithm,'sha256');const hash=crypto.createHash(algorithm),update=hash.update;hash.update=function(text,encoding){hashed.push(text);assert.equal(encoding,'utf8');return update.call(this,text,encoding);};return hash;}};}},{filename});
 const api=module.exports,portable={};vm.runInNewContext(source,portable,{filename});
 const request={base:{records:3},sections:{records:Array.from({length:2200},(_,id)=>({id,km:id/10,note:'Синтетика 🚚 \ud800 '+id}))}};
 const expected=portable.RequestFingerprint.requestDigest(request);
 assert.equal(api.requestDigest(request),expected);assert.equal(hashed.length,1);
 assert.equal(hashed[0],portable.RequestFingerprint.stableSerialize(request));
 let conversions=0;const text={toString(){conversions++;return '\ud800\ud800\udfff\0';}};
 assert.equal(api.sha256(text),crypto.createHash('sha256').update('\ud800\ud800\udfff\0','utf8').digest('hex'));assert.equal(conversions,1);
 const calls=hashed.length;assert.throws(()=>api.requestDigest({sections:{records:[{km:NaN}]}}),{code:'INVALID_SNAPSHOT'});assert.equal(hashed.length,calls);
});
test('the browser fingerprint remains independent of Node and uses the same portable digest',()=>{
 let required=false;const browser={require(){required=true;throw Error('Node is unavailable');}};vm.runInNewContext(source,browser,{filename});
 assert.equal(browser.RequestFingerprint.sha256('abc'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');assert.equal(required,false);
});
