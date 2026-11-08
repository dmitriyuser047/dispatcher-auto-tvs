'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const ledger=require('../electron/operation-ledger.cjs'),store=require('../electron/operation-store.cjs'),format=require('../electron/storage-format.cjs');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const operation=id=>({id,digest:'sha256:'+'a'.repeat(64),actorId:'synthetic',actorRole:'admin',databaseToken:'synthetic-database'});
const receipt=id=>({operation:operation(id),at:'2026-11-08T09:00:00.000Z',changedSections:['vehicles'],revisions:{vehicles:1},result:{literal:'UNCHANGED'}});
const proof=()=>({version:1,status:'verified',requiredSections:['vehicles'],subjects:[],request:{selectedTargets:[]}});
const event=id=>({section:'vehicles',before:null,after:{id,note:'Literal historical event '+id}});
function fixture(){
 const objects=new Map(),api=ledger.createOperationLedger({readObject:id=>objects.get(id),cursorKey:Buffer.alloc(32)}),f={api,objects,head:api.genesis()};
 f.put=value=>{const json=typeof value==='string'?value:JSON.stringify(value),id=hash(json);objects.set(id,json);return id;};
 f.apply=plan=>{for(const o of plan.objects)objects.set(o.id,o.json);f.head=plan.head;};
 f.append=(id,events=[event(id)],evidence=proof())=>f.apply(api.prepareAppend({head:f.head,receipt:receipt(id),auditEntries:events,accessProof:evidence}));
 return f;
}
test('streamed graph contains the exact portable objects and literal events of the established closure',()=>{
 const f=fixture();f.apply(f.api.prepareLegacy({head:f.head,auditEntries:[event('legacy')],reservations:['unknown-legacy']}));f.append('one');f.append('two',[]);f.append('three');
 const expected=f.api.exportClosure(f.head),emitted=new Map(),summary=f.api.walkClosure(f.head,o=>{if(emitted.has(o.id))assert.equal(emitted.get(o.id),o.json);emitted.set(o.id,o.json);});
 assert.deepEqual([...emitted].sort(([a],[b])=>a.localeCompare(b)),expected.objects.map(o=>[o.id,o.json]));assert.deepEqual(summary.head,expected.head);assert.equal(summary.receipts,3);assert.equal(summary.reservations,1);assert.equal(summary.segments,3);assert.equal(summary.events,3);assert.ok(summary.objectVisits>emitted.size,'Shared proofs are emitted without an all-history memory index');
 const seed=store.verifyProvider({operationState:format.createOperationState(f.head),readObject:id=>emitted.get(id),hotRows:[event('legacy'),event('one'),event('three')]});assert.equal(seed.summary.events,3);assert.deepEqual(seed.hotRows,[event('legacy'),event('one'),event('three')]);assert.equal(f.api.lookup(f.head,operation('two'),()=>true).status,'committed');
});
test('caller-scoped stream budgets remain explicit and do not alter defaults',()=>{
 const f=fixture();f.append('one');const full=f.api.walkClosure(f.head,()=>{});
 for(const options of [{maxObjects:0},{maxBytes:full.bytesVisited-1},{maxEvents:0},{maxReceipts:0},{maxBytes:-1},{maxBytes:Infinity},{maxBytes:1.5},{unknown:1}])assert.throws(()=>f.api.walkClosure(f.head,()=>{},options),error=>['LEDGER_LIMIT','LEDGER_SHAPE','LEDGER_JSON'].includes(error.code));
 assert.equal(f.api.walkClosure(f.head,()=>{}).events,1);
});
test('missing and changed provider bytes cannot become a verified streamed backup',()=>{
 for(const replacement of [null,'{}']){const f=fixture();f.append('one');const original=JSON.parse(f.objects.get(f.head.receiptRoot));if(replacement===null)f.objects.delete(original.receiptHash);else f.objects.set(original.receiptHash,replacement);assert.throws(()=>f.api.walkClosure(f.head,()=>{}),{code:replacement===null?'LEDGER_MISSING':'LEDGER_HASH'});}
});
test('streaming checks the exact receipt range and proof binding of each audit segment',()=>{
 for(const mutate of [value=>{value.operationId='missing';},value=>{value.proofHash='a'.repeat(64);},value=>{value.previous=null;}]){
  const f=fixture();f.append('one');f.append('two');const segment=JSON.parse(f.objects.get(f.head.auditHead));mutate(segment);f.head={...f.head,auditHead:f.put(segment)};
  assert.throws(()=>f.api.walkClosure(f.head,()=>{}),error=>['LEDGER_RECEIPT','LEDGER_MISSING','LEDGER_SEGMENT'].includes(error.code));
 }
});
test('a receipt with an omitted modern segment cannot be hidden by a complete legacy chain',()=>{
 const f=fixture();f.append('one');const segment=JSON.parse(f.objects.get(f.head.auditHead));delete segment.operationId;segment.kind='legacy-segment';segment.proofHash=f.put({...proof(),status:'legacy-unverified'});f.head={...f.head,auditHead:f.put(segment)};
 assert.throws(()=>f.api.walkClosure(f.head,()=>{}),{code:'LEDGER_SEGMENT'});
});
test('hot view and supplied restore rows must still match the immutable chain exactly',()=>{
 const f=fixture();f.append('one');assert.throws(()=>f.api.walkClosure({...f.head,hot:[{seq:1,eventHash:'a'.repeat(64)}]},()=>{}),{code:'LEDGER_HOT_VIEW'});
 assert.throws(()=>store.verifyProvider({operationState:format.createOperationState(f.head),readObject:id=>f.objects.get(id),hotRows:[{...event('one'),after:{id:'one',note:'forged'}}]}),{code:'LEDGER_HOT_VIEW'});
});
test('stream visitors cannot be asynchronous or publish a promise-shaped result',()=>{
 const f=fixture();f.append('one');let called=false;
 assert.throws(()=>f.api.walkClosure(f.head,async()=>{called=true;}),{code:'LEDGER_PROVIDER'});assert.equal(called,false);
 assert.throws(()=>f.api.walkClosure(f.head,()=>Promise.resolve()),{code:'LEDGER_PROVIDER'});
});
test('radix confinement rejects repeated child aliases before accepting a graph',()=>{
 const f=fixture();f.append('one',[]);f.append('two',[]);const branch=JSON.parse(f.objects.get(f.head.receiptRoot)),entries=Object.entries(branch.children);branch.children[entries[1][0]]=entries[0][1];f.head={...f.head,receiptRoot:f.put(branch)};assert.throws(()=>f.api.walkClosure(f.head,()=>{}),{code:'LEDGER_INDEX'});
});
test('streamed proofs retain depth, node, key and8MiB object safeguards',()=>{
 const cases=[['{"version":1,"status":"verified","requiredSections":["vehicles"],"subjects":[],"request":{"__proto__":{}}}','LEDGER_JSON'],[JSON.stringify({...proof(),request:{padding:'x'.repeat(8*1024*1024)}}),'LEDGER_HASH']];let deep=null;for(let i=0;i<81;i++)deep={child:deep};cases.push([JSON.stringify({...proof(),request:{deep}}),'LEDGER_LIMIT']);
 for(const [raw,code]of cases){const f=fixture();f.append('one',[]);const leaf=JSON.parse(f.objects.get(f.head.receiptRoot)),stored=JSON.parse(f.objects.get(leaf.receiptHash));stored.proofHash=f.put(raw);leaf.receiptHash=f.put(stored);f.head={...f.head,receiptRoot:f.put(leaf)};assert.throws(()=>f.api.walkClosure(f.head,()=>{}),{code});}
});
test('more than512MiB of distinct history objects streams under a128MiB JavaScript heap',()=>{
 // Provider descriptors regenerate cold objects individually; neither fixture
 // nor backup retains the entire serialized graph. The child heap ceiling
 // makes an accidental all-object JSON/proof map fail this regression.
 const program=String.raw`
 const assert=require('node:assert/strict'),ledger=require(process.argv[1]),objects=new Map(),padding='x'.repeat(6*1024*1024);
 const proof=i=>({version:1,status:'verified',requiredSections:['vehicles'],subjects:[],request:{selectedTargets:[],index:i,padding}}),api=ledger.createOperationLedger({readObject:id=>{const value=objects.get(id);return typeof value==='function'?value():value;},cursorKey:Buffer.alloc(32)});let head=api.genesis();
 for(let i=0;i<86;i++){const receipt={operation:{id:'large-'+i,digest:'sha256:'+'a'.repeat(64),actorId:'synthetic',actorRole:'admin',databaseToken:'synthetic'},at:'2026-11-08',changedSections:['vehicles'],revisions:{vehicles:1},result:{}},plan=api.prepareAppend({head,receipt,auditEntries:[],accessProof:proof(i)});for(const o of plan.objects)objects.set(o.id,o.json.length>1024*1024?()=>JSON.stringify(proof(i)):o.json);head=plan.head;}
 let visits=0;const summary=api.walkClosure(head,()=>{visits++;});assert.equal(summary.receipts,86);assert.ok(summary.bytesVisited>512*1024*1024);assert.equal(summary.objectVisits,visits);process.stdout.write(JSON.stringify({bytes:summary.bytesVisited,receipts:summary.receipts}));`;
 const child=spawnSync(process.execPath,['--max-old-space-size=128','-e',program,require.resolve('../electron/operation-ledger.cjs')],{encoding:'utf8',timeout:120000,windowsHide:true,maxBuffer:1024*1024});
 assert.equal(child.status,0,child.stderr||child.error?.message);const result=JSON.parse(child.stdout);assert.ok(result.bytes>512*1024*1024);assert.equal(result.receipts,86);
});
