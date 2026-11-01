'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createHash,webcrypto,randomBytes}=require('node:crypto');
const source=fs.readFileSync(path.resolve(__dirname,'../web/public/crypto.js'),'utf8');
function fixture(crypto={getRandomValues:bytes=>webcrypto.getRandomValues(bytes)}){const context=vm.createContext({crypto,Uint8Array,Uint32Array,ArrayBuffer,DataView,DOMException});vm.runInContext(source,context,{filename:'crypto.js'});return {crypto,context};}
const hex=value=>Buffer.from(value).toString('hex');
const expected=value=>createHash('sha256').update(value).digest('hex');

test('HTTP LAN SHA256 digest matches standard empty, ASCII, Unicode and raw binary vectors',async()=>{
  const {crypto}=fixture();
  for(const value of [Buffer.alloc(0),Buffer.from('abc'),Buffer.from('Счёт № 42 — PDF 🔧\n','utf8'),Buffer.from(Array.from({length:256},(_,index)=>index))]){
    const pending=crypto.subtle.digest('SHA-256',value);assert.equal(typeof pending.then,'function');const result=await pending;assert.equal(Object.prototype.toString.call(result),'[object ArrayBuffer]');assert.equal(result.byteLength,32);assert.equal(hex(result),expected(value));
  }
  assert.equal(hex(await crypto.subtle.digest('sha-256',new Uint8Array([97,98,99]))),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('SHA256 preserves view offsets, snapshots its input and covers padding and large multi-block data',async()=>{
  const {crypto}=fixture(),raw=randomBytes(256),view=new DataView(raw.buffer,raw.byteOffset+17,91),typed=new Uint16Array(raw.buffer,raw.byteOffset+4,18);
  assert.equal(hex(await crypto.subtle.digest({name:'SHA-256'},view)),expected(raw.subarray(17,108)));
  assert.equal(hex(await crypto.subtle.digest('SHA-256',typed)),expected(raw.subarray(4,40)));
  const input=new Uint8Array([1,2,3]),pending=crypto.subtle.digest('SHA-256',input);input.fill(9);assert.equal(hex(await pending),expected(Buffer.from([1,2,3])));
  for(const size of [1,55,56,63,64,65,119,120,127,128,129,65537,1048576]){const value=randomBytes(size);assert.equal(hex(await crypto.subtle.digest('SHA-256',value)),expected(value),String(size));}
  const buffer=new Uint8Array([7,8,9]).buffer;assert.equal(hex(await crypto.subtle.digest('SHA-256',buffer)),expected(Buffer.from([7,8,9])));
});

test('digest rejects unsupported algorithms and non-BufferSource values without inventing crypto APIs',async()=>{
  const {crypto}=fixture();for(const algorithm of ['SHA-1','SHA256','SHA-512',{},null])await assert.rejects(crypto.subtle.digest(algorithm,new Uint8Array()),error=>error.name==='NotSupportedError');
  for(const value of ['abc',[1,2,3],null,{},123,{[Symbol.toStringTag]:'ArrayBuffer'}])await assert.rejects(crypto.subtle.digest('SHA-256',value),error=>error.name==='TypeError');
  if(typeof SharedArrayBuffer==='function'){await assert.rejects(crypto.subtle.digest('SHA-256',new Uint8Array(new SharedArrayBuffer(8))),error=>error.name==='TypeError');}
  assert.deepEqual(Object.keys(crypto.subtle),['digest']);for(const method of ['encrypt','decrypt','sign','verify','generateKey','deriveKey'])assert.equal(crypto.subtle[method],undefined);
});

test('UUIDv4 uses only strong native randomness with correct version and variant bits',()=>{
  let calls=0;const strong={getRandomValues(bytes){calls++;assert.equal(bytes.length,16);bytes.fill(255);return bytes;}},f=fixture(strong);
  assert.equal(f.crypto.randomUUID(),'ffffffff-ffff-4fff-bfff-ffffffffffff');assert.equal(calls,1);
  const real=fixture().crypto,ids=new Set(Array.from({length:64},()=>real.randomUUID()));assert.equal(ids.size,64);for(const id of ids)assert.match(id,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(fixture({}).crypto.randomUUID,undefined,'missing native entropy must not be replaced with Math.random');
});

test('shared shim preserves native crypto and is safe to load twice',async()=>{
  const uuid=()=> 'native-uuid',digest=async()=>new ArrayBuffer(32),subtle={digest},crypto={getRandomValues:value=>webcrypto.getRandomValues(value),randomUUID:uuid,subtle},f=fixture(crypto);
  assert.equal(f.crypto.randomUUID,uuid);assert.equal(f.crypto.subtle,subtle);assert.equal(f.crypto.subtle.digest,digest);
  const fallback=fixture(),firstUuid=fallback.crypto.randomUUID,firstDigest=fallback.crypto.subtle.digest;vm.runInContext(source,fallback.context);assert.equal(fallback.crypto.randomUUID,firstUuid);assert.equal(fallback.crypto.subtle.digest,firstDigest);
});
