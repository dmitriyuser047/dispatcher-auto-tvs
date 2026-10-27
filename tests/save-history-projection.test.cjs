'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const policy=require('../assets/core/access-policy.js'),schema=require('../assets/core/platform-schema.js'),ledger=require('../electron/operation-ledger.cjs');
const {evidence,actor,principal,database,row,prepared,memory}=require('./helpers/operation-history25-fixtures.cjs');
const known=value=>({state:'known',value}),unknown={state:'unknown'};
const facts=(_section,value)=>({kind:'owned',owners:[{org:value.org?known(value.org):unknown,site:known('Synthetic site')}],fieldGuards:[{path:['secret'],requires:{sections:['vehicles'],owners:[{org:known('B'),site:known('Synthetic site')}],complete:true}}]});
const context=()=>({readable:schema.sections,writable:[],resolve:facts});
const grant=orgs=>({version:1,grants:orgs.map(org=>({org,site:{any:true}}))});
test('prepared response reader retains the original grant, row, field and unknown-ownership projections',()=>{
 const rows=[row(0,'A'),row('0','B'),{id:'unknown',note:'Unknown ownership',secret:'Hidden'}];
 for(const descriptor of [null,grant([]),grant(['A']),grant(['A','B']),{...grant(['A','B']),sections:{vehicles:{readFields:['id','org','site']}}}]){
  const ctx=context(),reader=policy.createReader(descriptor,ctx),before=JSON.stringify(rows);
  assert.deepEqual(reader.projectRows('vehicles',rows),policy.projectRows(descriptor,'vehicles',rows,ctx));
  for(const value of rows)assert.equal(reader.permits('vehicles','read',value),policy.permits(descriptor,'vehicles','read',value,ctx));
  assert.equal(JSON.stringify(rows),before);
 }
});
test('prepared reader owns its permission snapshot but resolves current row facts and rejects executable inputs',()=>{
 const descriptor=grant(['A']),ctx=context(),reader=policy.createReader(descriptor,ctx),value=row(0,'A');
 assert.equal(reader.projectRows('vehicles',[value]).length,1);value.org='B';assert.deepEqual(reader.projectRows('vehicles',[value]),[]);
 value.org='A';descriptor.grants=[];ctx.readable=[];assert.equal(reader.projectRows('vehicles',[value]).length,1);
 assert.deepEqual(policy.createReader(descriptor,ctx).projectRows('vehicles',[value]),[]);
 assert.deepEqual(reader.projectRows('vehicles',[value],()=>({kind:'unknown',owners:[]})),[]);
 assert.throws(()=>reader.projectRows('vehicles',[value],{}),{code:'ACCESS_CONTEXT_INVALID'});
 let called=0;const getter={id:0};Object.defineProperty(getter,'note',{enumerable:true,get(){called++;return 'Must not run';}});
 assert.throws(()=>reader.projectRows('vehicles',[getter]),{code:'ACCESS_ROW_INVALID'});assert.equal(called,0);
});
function operation(){const before=database({vehicles:[row(0,'A'),row('0','B')]}),next=structuredClone(before);next.vehicles[0].note='Numeric zero';next.vehicles[1].note='Text zero';return prepared('response-projector',before,next,{targets:[{section:'vehicles',id:0},{section:'vehicles',id:'0'}]});}
test('one response projector preserves verified and legacy history, redaction and tamper rejection',()=>{
 const value=operation(),legacy={id:'old-entry',section:'vehicles',type:'update',before:row(0,'A'),after:row(0,'A','Legacy update')};
 for(const current of [actor,principal(['A']),principal(['B']),principal([]),{...actor,role:'viewer'},principal(['A'],{readFields:{vehicles:['id','org','site']}})]){
  const projector=evidence.createEventProjector(current);
  for(const event of value.events)assert.deepEqual(projector.projectEvent(event,value.proof),evidence.projectEvent(event,value.proof,current));
  assert.deepEqual(projector.projectLegacyEvent(legacy),evidence.projectLegacyEvent(legacy,current));
  assert.equal(projector.projectEvent({...value.events[0],id:'Tampered'},value.proof),null);
 }
});
test('response projectors never reuse authorization for a new request after grant revocation',()=>{
 const value=operation(),current=principal(['A']),first=evidence.createEventProjector(current);
 assert.equal(first.projectEvent(value.events[0],value.proof).after.id,0);current.accessPolicy.grants=[];
 assert.equal(evidence.createEventProjector(current).projectEvent(value.events[0],value.proof),null);
 assert.equal(first.projectEvent(value.events[0],value.proof).after.id,0,'Existing synchronous response owns its snapshot');
 assert.equal(evidence.createEventProjector(null).projectEvent(value.events[0],value.proof),null);
});
test('owned JSON history parsing retains dangerous-key, UTF-8, finite-number and resource limits',()=>{
 const objects=new Map(),api=ledger.createOperationLedger({cursorKey:Buffer.alloc(32,19),readObject:id=>objects.get(id)});
 const check=(bytes,code)=>{if(typeof bytes==='string')bytes=Buffer.from(bytes);const hash=crypto.createHash('sha256').update(bytes).digest('hex');objects.set(hash,bytes);assert.throws(()=>api.inspectReceipt({...api.genesis(),receiptRoot:hash},'synthetic-invalid'),{code});};
 for(const key of ['__proto__','constructor','prototype'])check('{"'+key+'":{}}','LEDGER_JSON');
 check('{"value":1e999}','LEDGER_JSON');check(Buffer.from([123,34,120,34,58,34,255,34,125]),'LEDGER_JSON');
 let deep=null;for(let i=0;i<82;i++)deep={child:deep};check(JSON.stringify(deep),'LEDGER_LIMIT');
 check(JSON.stringify(Array(1000001).fill(null)),'LEDGER_LIMIT');
});
test('immutable decoded evidence still checks fresh stored bytes on every later read',()=>{
 const store=memory(),value=operation();store.append(value);const first=store.engine.inspectReceipt(store.head,value.receipt.operation.id);
 assert.equal(Object.isFrozen(first.proof),true);assert.equal(Object.isFrozen(first.proof.request),true);
 assert.throws(()=>{first.proof.request.operation.id='Forged';},TypeError);
 const bytes=store.objects.get(first.proofHash),before=Buffer.from(bytes);bytes[0]^=1;
 assert.throws(()=>store.engine.inspectReceipt(store.head,value.receipt.operation.id),{code:'LEDGER_HASH'});
 store.objects.set(first.proofHash,before);assert.deepEqual(store.engine.inspectReceipt(store.head,value.receipt.operation.id),first);
});
test('one read scope reuses decoded immutable objects while rereading and hashing the provider bytes',()=>{
 const store=memory(),value=operation();store.append(value);let first;
 ledger.withReadScope(()=>{
  first=store.engine.inspectReceipt(store.head,value.receipt.operation.id);const reads=store.reads.length;
  const second=ledger.withReadScope(()=>store.engine.inspectReceipt(store.head,value.receipt.operation.id));
  assert.equal(second.proof,first.proof);assert.ok(store.reads.length>reads,'A cache hit still reads the provider');
  const bytes=store.objects.get(first.proofHash),original=Buffer.from(bytes);bytes[0]^=1;
  assert.throws(()=>store.engine.inspectReceipt(store.head,value.receipt.operation.id),{code:'LEDGER_HASH'});store.objects.set(first.proofHash,original);
 });
 assert.notEqual(store.engine.inspectReceipt(store.head,value.receipt.operation.id).proof,first.proof,'The next operation cannot inherit the decode scope');
});
test('read scopes clear after exceptions and reject asynchronous work',()=>{
 const store=memory(),value=operation();store.append(value);let captured;
 assert.throws(()=>ledger.withReadScope(()=>{captured=store.engine.inspectReceipt(store.head,value.receipt.operation.id);throw Error('Synthetic failure');}),/Synthetic failure/);
 assert.notEqual(ledger.withReadScope(()=>store.engine.inspectReceipt(store.head,value.receipt.operation.id)).proof,captured.proof);
 assert.throws(()=>ledger.withReadScope(()=>Promise.resolve()),{code:'LEDGER_ASYNC_SCOPE'});
 assert.deepEqual(ledger.withReadScope(()=>store.engine.inspectReceipt(store.head,value.receipt.operation.id)),captured);
});
test('a long scope evicts decoded entries rather than retaining an unbounded object set',()=>{
 const objects=new Map(),api=ledger.createOperationLedger({cursorKey:Buffer.alloc(32,22),readObject:id=>objects.get(id)}),entries=Array.from({length:258},(_,index)=>{
  const operationId='bounded-cache-'+index,key=crypto.createHash('sha256').update(operationId).digest('hex'),bytes=Buffer.from(JSON.stringify({version:1,kind:'reserved-unknown',key,operationId})),hash=crypto.createHash('sha256').update(bytes).digest('hex');objects.set(hash,bytes);return {operationId,hash,bytes};
 });
 const parse=JSON.parse;let firstParses=0;JSON.parse=function(value,...rest){if(value===entries[0].bytes.toString())firstParses++;return parse.call(this,value,...rest);};
 try{ledger.withReadScope(()=>{for(const entry of entries)assert.equal(api.inspectReceipt({...api.genesis(),receiptRoot:entry.hash},entry.operationId).kind,'reserved-unknown');const first=entries[0];api.inspectReceipt({...api.genesis(),receiptRoot:first.hash},first.operationId);});assert.equal(firstParses,2);}finally{JSON.parse=parse;}
});
