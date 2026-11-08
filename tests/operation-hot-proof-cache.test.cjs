'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),ledger=require('../electron/operation-ledger.cjs'),{makeHotProofFixture}=require('./helpers/hot-proof-fixture.cjs');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const validate=f=>ledger.withReadScope(()=>f.engine.planArchive({head:f.head,throughSeq:0,hotRows:f.hotRows}));
function countParses(action,predicate=text=>text.length>512*1024){const original=JSON.parse;let count=0;JSON.parse=function(text,...args){if(typeof text==='string'&&predicate(text))count++;return original.call(this,text,...args);};try{return{value:action(),count:()=>count};}finally{JSON.parse=original;}}
function replaceProof(f,raw,extra={}){const bytes=Buffer.isBuffer(raw)?raw:Buffer.from(raw),id=hash(bytes),segment=JSON.parse(f.objects.get(f.head.auditHead));segment.proofHash=id;Object.assign(segment,extra);if(segment.kind==='legacy-segment')delete segment.operationId;const json=JSON.stringify(segment),segmentId=hash(json);f.objects.set(id,raw);f.objects.set(segmentId,json);f.head={...f.head,auditHead:segmentId};return id;}
test('a real hot proof set beyond the decoded64MiB LRU avoids repeated JSON decoding while reading every proof',()=>{
 const f=makeHotProofFixture({tag:'warm-dense-proof-set'});assert.ok(f.proofBytes>64*1024*1024);assert.equal(f.head.hot.length,48);
 const before=f.stats.proofReads,cold=countParses(()=>validate(f));assert.equal(cold.count(),48);assert.equal(f.stats.proofReads-before,48);
 for(let round=0;round<2;round++){const reads=f.stats.proofReads,warm=countParses(()=>validate(f));assert.equal(warm.count(),0);assert.equal(f.stats.proofReads-reads,48);assert.deepEqual(warm.value.hotRows,f.hotRows);}
});
test('warm structural summaries cannot accept changed, missing or mutated-buffer provider bytes',()=>{
 const f=makeHotProofFixture({count:1,rows:3,tag:'provider-proof-changes'}),id=[...f.proofHashes][0],original=f.objects.get(id);validate(f);f.objects.set(id,'{}');assert.throws(()=>validate(f),{code:'LEDGER_HASH'});f.objects.delete(id);assert.throws(()=>validate(f),{code:'LEDGER_MISSING'});
 const bytes=Buffer.from(original);f.objects.set(id,bytes);validate(f);bytes[bytes.length-4]^=1;assert.throws(()=>validate(f),{code:'LEDGER_HASH'});f.objects.set(id,original);validate(f);
 const segment=f.objects.get(f.head.auditHead);f.objects.set(f.head.auditHead,segment.replace('Synthetic historical event','Tampered historical event'));assert.throws(()=>validate(f),{code:'LEDGER_HASH'});
});
test('new proof hashes still undergo full JSON, proof-shape and resource checks after a hot cache is primed',()=>{
 let deep=null;for(let index=0;index<81;index++)deep={child:deep};
 const valid={version:1,status:'verified',requiredSections:['vehicles'],subjects:[],request:{selectedTargets:[]}},cases=[
  ['{}','LEDGER_SHAPE'],
  [JSON.stringify({...valid,request:{selectedTargets:'invalid'}}),'LEDGER_PROOF'],
  ['{"version":1,"status":"verified","requiredSections":["vehicles"],"subjects":[],"request":{"__proto__":{}}}','LEDGER_JSON'],
  ['{"version":1,"status":"verified","requiredSections":["vehicles"],"subjects":[],"request":{"n":1e400}}','LEDGER_JSON'],
  [JSON.stringify({...valid,request:{deep}}),'LEDGER_LIMIT'],
  [JSON.stringify({...valid,request:{metadata:Array(1000001).fill(null)}}),'LEDGER_LIMIT'],
  [JSON.stringify({...valid,request:{padding:'x'.repeat(8*1024*1024)}}),'LEDGER_HASH'],
  [Buffer.from([0x7b,0x22,0x78,0x22,0x3a,0x22,0xff,0x22,0x7d]),'LEDGER_JSON']
 ];
 for(const [raw,code]of cases){const f=makeHotProofFixture({count:1,rows:0,tag:'malformed-after-prime-'+code});validate(f);replaceProof(f,raw);assert.throws(()=>validate(f),{code});}
});
test('the same cached proof status remains invalid for a legacy segment that requires legacy evidence',()=>{
 const f=makeHotProofFixture({count:1,rows:0,tag:'legacy-status-check'});validate(f);const original=f.objects.get([...f.proofHashes][0]);replaceProof(f,original,{kind:'legacy-segment'});assert.throws(()=>validate(f),{code:'LEDGER_PROOF'});
});
test('direct text authentication preserves exact UTF-8 semantics for non-ASCII provider proofs',()=>{
 const f=makeHotProofFixture({count:1,rows:2,tag:'Юникод-🛢-проверка'});validate(f);validate(f);const id=[...f.proofHashes][0],text=f.objects.get(id);assert.ok(Buffer.byteLength(text)>text.length);f.objects.set(id,Buffer.from(text));validate(f);f.objects.set(id,text.replace('Юникод','Подмена'));assert.throws(()=>validate(f),{code:'LEDGER_HASH'});
});
test('hot structural reuse never supplies ACL evidence or memoizes a receipt authorization result',()=>{
 const f=makeHotProofFixture({count:1,rows:3,tag:'no-acl-cache'});validate(f);const original=f.engine.inspectReceipt(f.head,'no-acl-cache-0'),operation=original.receipt.operation;let authorized=0;
 assert.equal(f.engine.lookup(f.head,operation,proof=>{authorized++;assert.equal(proof.request.metadata.length,3);assert.equal(Object.isFrozen(proof.request.metadata[0]),true);return true;}).status,'committed');assert.equal(f.engine.lookup(f.head,operation,()=>{authorized++;return false;}),null);assert.equal(authorized,2);
 let projected=0;f.engine.page(f.head,{databaseToken:'synthetic-hot-db',principalStamp:'current-policy',query:{},limit:1},(row,context)=>{projected++;assert.equal(context.proof.request.metadata.length,3);assert.equal(ledger.isOwnedParsedProof(context.proof),true);return row;});assert.equal(projected,1);
 assert.equal(ledger.isOwnedParsedProof(Object.freeze(structuredClone(original.proof))),false);
 let called=false;const request={};Object.defineProperty(request,'selectedTargets',{enumerable:true,get(){called=true;return[];}});const callerProof=Object.freeze({version:1,status:'verified',requiredSections:['vehicles'],subjects:[],request:Object.freeze(request)});
 assert.throws(()=>f.engine.prepareAppend({head:f.head,receipt:{...original.receipt,operation:{...operation,id:'caller-frozen'}},auditEntries:[],accessProof:callerProof}),{code:'LEDGER_JSON'});assert.equal(called,false);
});
test('the compact proof-shape LRU evicts old summaries rather than retaining an unbounded proof history',()=>{
 const first=makeHotProofFixture({count:1,rows:0,tag:'bounded-summary-first'}),isFirst=text=>text.includes('"selectedTargets"')&&text.includes('"tag":"bounded-summary-first"');validate(first);assert.equal(countParses(()=>validate(first),isFirst).count(),0);
 for(let index=0;index<8192;index++)validate(makeHotProofFixture({count:1,rows:0,tag:'bounded-summary-fill-'+index}));
 assert.equal(countParses(()=>validate(first),isFirst).count(),1);assert.equal(countParses(()=>validate(first),isFirst).count(),0);
});
