'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const kernel=require('../assets/core/platform-kernel.js');
const schema=require('../assets/core/platform-schema.js');
const now=()=> '2026-10-21T18:00:00.000Z';
function data(){return {vehicles:[{id:7,plate:'SYNTHETIC',org:'A',fuelGrade:'ДТ',fuelBalance:923.537,norm:10}],records:[]};}
function context(patch={}){return {identity:'synthetic-async-session',actor:{id:'synthetic-user',name:'Synthetic user',role:'admin'},readable:schema.sections.slice(),writable:schema.sections.slice(),revisions:{vehicles:5,records:8},...patch};}
function command(id='async-command',note='Reviewed synthetic change'){const next=data();next.vehicles[0].note=note;return {id,previous:data(),next,options:{}};}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {resolve,reject,promise};}
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const copy=value=>JSON.parse(JSON.stringify(value));
function runtime(config={}){return kernel.createRuntime({getContext:()=>context(),now,prepare:async(previous,next,ctx)=>kernel.prepare(previous,next,ctx),...config});}

test('default synchronous preparation timing remains unchanged and optional preparation accepts sync or async providers',async()=>{
  const events=[],normal=kernel.createRuntime({getContext:()=>context(),now});
  const first=normal.run(command('normal'),()=>{events.push('persist');return {ok:true};});assert.deepEqual(events,[]);await Promise.resolve();assert.deepEqual(events,['persist']);await first;
  for(const prepare of [(previous,next,ctx)=>kernel.prepare(previous,next,ctx),async(previous,next,ctx)=>kernel.prepare(previous,next,ctx)]){
    const result=await runtime({prepare}).run(command(),()=>({ok:true}));assert.deepEqual(result.plan,kernel.prepare(data(),command().next,{...context(),id:'async-command',now:now()}));assert.equal(result.duplicate,false);
  }
  for(const prepare of [true,{},1])assert.throws(()=>runtime({prepare}),{code:'INVALID_CONFIGURATION'});
});

test('preparation and persistence keep caller FIFO order despite asynchronous provider and ACK gates',async()=>{
  const preparation=deferred(),ack=deferred(),steps=[],contexts=[],bus=runtime({prepare:async(previous,next,ctx)=>{steps.push('prepare:'+ctx.id);contexts.push(ctx);if(ctx.id==='first')await preparation.promise;return kernel.prepare(previous,next,ctx);}});
  const first=bus.run(command('first'),async plan=>{steps.push('persist:'+plan.id);await ack.promise;return {ok:true};});
  const second=bus.run(command('second','Second explicit change'),plan=>{steps.push('persist:'+plan.id);return {ok:true};});
  await turn();assert.deepEqual(steps,['prepare:first']);assert.equal(bus.status().running,1);assert.equal(bus.status().queued,1);
  preparation.resolve();await turn();assert.deepEqual(steps,['prepare:first','persist:first']);
  ack.resolve();await Promise.all([first,second]);assert.deepEqual(steps,['prepare:first','persist:first','prepare:second','persist:second']);
  assert.deepEqual(contexts.map(ctx=>[ctx.id,ctx.now]),[['first',now()],['second',now()]]);assert.equal(bus.status().committed,2);assert.equal(bus.status().queued,0);assert.equal(bus.status().running,0);
});

test('provider receives owned frozen sources and one captured ID, clock and revision set',async()=>{
  const gate=deferred(),input=command(),before=copy(input);let current=context(),captured,clockCalls=0;
  const bus=runtime({getContext:()=>current,now:()=>{clockCalls++;return now();},prepare:async(previous,next,ctx)=>{
    captured={previous,next,ctx};assert.ok(Object.isFrozen(previous));assert.ok(Object.isFrozen(previous.vehicles[0]));assert.ok(Object.isFrozen(next.vehicles[0]));assert.ok(Object.isFrozen(ctx.actor));
    await gate.promise;return kernel.prepare(previous,next,ctx);
  }});
  const pending=bus.run(input,plan=>{assert.equal(plan.base.vehicles,5);return {ok:true};});
  input.previous.vehicles[0].plate='Later source alias edit';current.revisions.vehicles=99;await turn();assert.equal(clockCalls,1);gate.resolve();
  const result=await pending;assert.deepEqual(captured.previous,before.previous);assert.deepEqual(captured.next,before.next);assert.equal(captured.ctx.revisions.vehicles,5);assert.equal(result.plan.metadata.createdAt,now());
  assert.equal(typeof result.plan.sections.vehicles[0].id,'number');assert.equal(result.plan.sections.vehicles[0].fuelBalance,923.537);assert.ok(Object.isFrozen(result.plan));
});

test('an edited live target is rejected before dispatch and after an awaited prepare, with no persistence',async()=>{
  for(const duringPrepare of [false,true]){
    const gate=deferred(),input=command(),started=deferred();let writes=0,prepares=0;
    const bus=runtime({prepare:async(previous,next,ctx)=>{prepares++;started.resolve();await gate.promise;return kernel.prepare(previous,next,ctx);}});
    const pending=bus.run(input,()=>{writes++;return {ok:true};}),rejected=assert.rejects(pending,{code:'STALE_COMMAND'});
    if(duringPrepare)await started.promise;input.next.vehicles[0].note='Changed while preparing';gate.resolve();await rejected;
    assert.equal(writes,0);assert.equal(prepares,duringPrepare?1:0);assert.equal(bus.status().committed,0);
  }
});

for(const [label,patch,code]of [['identity',{identity:'another-session'},'STALE_IDENTITY'],['role',{actor:{id:'synthetic-user',name:'Synthetic user',role:'viewer'}},'STALE_ACCESS'],['rights',{writable:[]},'STALE_ACCESS'],['blocked',{blocked:true},'LOAD_BLOCKED']]){
  test('a '+label+' change while preparing prevents persistence and old-session events',async()=>{
    let current=context(),writes=0;const started=deferred(),gate=deferred(),events=[];
    const bus=runtime({getContext:()=>current,prepare:async(previous,next,ctx)=>{started.resolve();await gate.promise;return kernel.prepare(previous,next,ctx);}});bus.subscribe(event=>events.push(event));
    const pending=bus.run(command(),()=>{writes++;return {ok:true};}),checked=assert.rejects(pending,{code});await started.promise;current=context(patch);gate.resolve();await checked;
    assert.equal(writes,0);assert.deepEqual(events,[]);assert.equal(bus.status().failed,1);
  });
}

test('identical concurrent saves join before audit installation and persist once even when completed receipts cannot be retained',async()=>{
  const gate=deferred(),input=command('joined'),events=[];let prepares=0,writes=0;
  const bus=runtime({maxReceiptCharacters:0,prepare:async(previous,next,ctx)=>{prepares++;await gate.promise;return kernel.prepare(previous,next,ctx);}});bus.subscribe(event=>events.push(event));
  const first=bus.run(input,()=>{writes++;input.next.auditLog=[{id:'server-installed-audit'}];return {ok:true,operationId:'joined'};});
  const duplicate=bus.run(input,()=>{throw Error('Identical duplicate must not persist');});await turn();assert.equal(prepares,1);assert.equal(bus.status().deduplicated,1);
  gate.resolve();const results=await Promise.all([first,duplicate]);assert.equal(writes,1);assert.deepEqual(results.map(row=>row.duplicate),[false,true]);assert.equal(events.length,1);assert.equal(bus.status().retained,0);
});

test('a duplicate cannot return the old success after a commit listener switches the session before promise delivery',async()=>{
  let current=context(),writes=0;const gate=deferred(),bus=runtime({getContext:()=>current,prepare:async(previous,next,ctx)=>{await gate.promise;return kernel.prepare(previous,next,ctx);}});
  bus.subscribe(()=>{current=context({identity:'switched-by-commit-listener'});});
  const first=bus.run(command('listener-switch'),()=>{writes++;return {ok:true};});
  const duplicate=bus.run(command('listener-switch'),()=>{throw Error('Duplicate must not persist');}),checked=assert.rejects(duplicate,{code:'STALE_IDENTITY'});
  gate.resolve();assert.equal((await first).ack.ok,true);await checked;assert.equal(writes,1);assert.equal(bus.status().committed,1);assert.equal(bus.status().deduplicated,1);
});

test('same-ID different bodies cannot persist and canonical-equivalent queued plans still deduplicate after receipt pruning',async()=>{
  const gate=deferred();let writes=0;
  const bus=runtime({maxReceiptCharacters:0,prepare:async(previous,next,ctx)=>{if(ctx.id==='bound')await gate.promise;return kernel.prepare(previous,next,ctx);}});
  const first=bus.run(command('bound'),()=>{writes++;return {ok:true};});
  const equivalent=command('bound');equivalent.previous.records=[{id:'historical',vehicleId:7,date:'2026-09-01',km:0,fuelActual:0}];equivalent.next.records=equivalent.previous.records;
  const samePlan=bus.run(equivalent,()=>{throw Error('Equivalent plan must join its original execution');});
  const different=bus.run(command('bound','Another body'),()=>{writes++;return {ok:true};}),checked=assert.rejects(different,{code:'OPERATION_ID_REUSE'});
  gate.resolve();assert.equal((await first).duplicate,false);assert.equal((await samePlan).duplicate,true);await checked;assert.equal(writes,1);
});

test('provider and persistence errors propagate without a success event and an explicit retry remains possible',async()=>{
  let prepareFails=true,writes=0;const failure=Object.assign(Error('Synthetic source policy failure'),{code:'SYNTHETIC_POLICY',details:{issues:[{code:'SYNTHETIC',section:'records'}]}}),events=[];
  const bus=runtime({prepare:async(previous,next,ctx)=>{if(prepareFails)throw failure;return kernel.prepare(previous,next,ctx);}});bus.subscribe(event=>events.push(event));
  await assert.rejects(bus.run(command('retry'),()=>{writes++;return {ok:true};}),error=>error===failure);assert.equal(writes,0);assert.deepEqual(events,[]);
  prepareFails=false;await assert.rejects(bus.run(command('retry'),()=>{writes++;throw Error('Synthetic disk failure');}),{code:'PERSIST_FAILED'});assert.deepEqual(events,[]);
  assert.equal((await bus.run(command('retry'),()=>{writes++;return {ok:true};})).duplicate,false);assert.equal(writes,2);assert.equal(events.length,1);
});

test('returned worker plans are bound to ID, identity, author, clock, captured rows, revisions and digest before persistence',async()=>{
  const variants=[plan=>{plan.id='other';},plan=>{plan.identity='another-session';},plan=>{plan.actor.id='other-user';},plan=>{plan.metadata.createdAt='2027-01-01T00:00:00.000Z';},
    plan=>{plan.base.vehicles=6;},plan=>{plan.sourceSnapshot.vehicles[0].plate='Wrong source';},plan=>{plan.sections.vehicles[0].note='Wrong output';},
    plan=>{plan.requestDigest='sha256:'+'0'.repeat(64);},plan=>{plan.changed=[];},plan=>{plan.rowChanges[0].fields=[42];},plan=>{plan.sections.unknown=[];},plan=>{plan.metadata=null;}];
  for(const mutate of variants){let writes=0;const bus=runtime({prepare:async(previous,next,ctx)=>{const plan=copy(kernel.prepare(previous,next,ctx));mutate(plan);return plan;}});
    await assert.rejects(bus.run(command(),()=>{writes++;return {ok:true};}),{code:'INVALID_PREPARED_PLAN'});assert.equal(writes,0);assert.equal(bus.status().committed,0);
  }
  let invoked=false;const bus=runtime({prepare:async(previous,next,ctx)=>{const plan=copy(kernel.prepare(previous,next,ctx));Object.defineProperty(plan,'id',{enumerable:true,get(){invoked=true;return 'async-command';}});return plan;}});
  await assert.rejects(bus.run(command(),()=>({ok:true})),{code:'INVALID_PREPARED_PLAN'});assert.equal(invoked,false);
});

test('provider-owned output cannot be mutated after validation to poison the persisted or returned plan',async()=>{
  let supplied;const gate=deferred(),started=deferred(),bus=runtime({prepare:async(previous,next,ctx)=>(supplied=copy(kernel.prepare(previous,next,ctx)))});
  const pending=bus.run(command(),async plan=>{assert.notEqual(plan,supplied);assert.ok(Object.isFrozen(plan.sections.vehicles[0]));started.resolve();await gate.promise;assert.equal(plan.sections.vehicles[0].note,'Reviewed synthetic change');return {ok:true};});
  await started.promise;supplied.sections.vehicles[0].note='Provider retained alias edit';gate.resolve();assert.equal((await pending).plan.sections.vehicles[0].note,'Reviewed synthetic change');
});

test('validated plans with different property order keep identical source, digest and persistence semantics',async()=>{
  function reverse(value){if(Array.isArray(value))return value.map(reverse);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).reverse().map(key=>[key,reverse(value[key])]));return value;}
  const bus=runtime({prepare:async(previous,next,ctx)=>reverse(kernel.prepare(previous,next,ctx))}),input=command('reordered-plan'),expected=kernel.prepare(input.previous,input.next,{...context(),id:input.id,now:now()});
  const receipt=await bus.run(input,plan=>{assert.deepEqual(plan,expected);return {ok:true};});assert.deepEqual(receipt.plan,expected);
});

test('prototype toJSON hooks in validated provider data are never executed during plan capture',async()=>{
  for(const getter of [false,true]){let invoked=0;const bus=runtime({prepare:async(previous,next,ctx)=>{
    const plan=copy(kernel.prepare(previous,next,ctx)),prototype=Object.create(null);
    if(getter)Object.defineProperty(prototype,'toJSON',{get(){invoked++;return ()=>({});}});else prototype.toJSON=()=>{invoked++;return {};};
    Object.setPrototypeOf(plan.sections.vehicles[0],prototype);return plan;
  }});const receipt=await bus.run(command(),()=>({ok:true}));assert.equal(receipt.plan.sections.vehicles[0].fuelBalance,923.537);assert.equal(invoked,0);}
});

test('live-source checks reject NaN, BigInt, functions, hooks and exotic values without lossy coercion',async()=>{
  const mutations=[row=>{row.optional=NaN;},row=>{row.extra=()=>1;},row=>{row.extra=1n;},row=>{row.extra=Symbol('bad');},row=>{row.optional=new Date('2026-10-21T00:00:00Z');}];
  for(const mutate of mutations){const gate=deferred(),started=deferred(),input=command();input.next.vehicles[0].optional=null;let writes=0;
    const bus=runtime({prepare:async(previous,next,ctx)=>{started.resolve();await gate.promise;return kernel.prepare(previous,next,ctx);}}),pending=bus.run(input,()=>{writes++;return {ok:true};}),checked=assert.rejects(pending,{code:'INVALID_SNAPSHOT'});
    await started.promise;mutate(input.next.vehicles[0]);gate.resolve();await checked;assert.equal(writes,0);
  }
  let hookCalls=0;const gate=deferred(),started=deferred(),input=command(),bus=runtime({prepare:async(previous,next,ctx)=>{started.resolve();await gate.promise;return kernel.prepare(previous,next,ctx);}});
  const pending=bus.run(input,()=>{throw Error('Hook mutation must not persist');}),checked=assert.rejects(pending,{code:'INVALID_SNAPSHOT'});await started.promise;
  input.next.vehicles[0].toJSON=()=>{hookCalls++;return {id:7};};gate.resolve();await checked;assert.equal(hookCalls,0);
});

test('key reordering and undefined values retain canonical live-source semantics, including array accessors',async()=>{
  for(const alter of [input=>{input.next.vehicles[0]=Object.fromEntries(Object.entries(input.next.vehicles[0]).reverse());},input=>{input.next.vehicles[0].ignored=undefined;}]){
    const gate=deferred(),started=deferred(),input=command(),bus=runtime({prepare:async(previous,next,ctx)=>{started.resolve();await gate.promise;return kernel.prepare(previous,next,ctx);}});let writes=0;
    const pending=bus.run(input,()=>{writes++;return {ok:true};});await started.promise;alter(input);gate.resolve();assert.equal((await pending).ack.ok,true);assert.equal(writes,1);
  }
  const gate=deferred(),started=deferred(),input=command();let getterCalls=0;
  const bus=runtime({prepare:async(previous,next,ctx)=>{started.resolve();await gate.promise;return kernel.prepare(previous,next,ctx);}}),pending=bus.run(input,()=>{throw Error('Array mutation must not persist');}),checked=assert.rejects(pending,{code:'STALE_COMMAND'});
  await started.promise;Object.defineProperty(input.next.records,'0',{get(){getterCalls++;return null;},enumerable:false});gate.resolve();await checked;
  assert.equal(getterCalls,1); // Only the canonical source check reads it.
});

test('modern ACK validation, unchanged commands and post-persist identity guards remain active',async()=>{
  for(const ack of [false,{ok:false},{ok:true},{ok:true,operationReceipt:{id:'other',status:'committed'}}]){
    const bus=runtime();await assert.rejects(bus.run({...command(),options:{requireOperationReceipt:true}},()=>ack),error=>['UNCONFIRMED_COMMIT','OPERATION_RECEIPT_REQUIRED','MISMATCHED_ACK'].includes(error.code));assert.equal(bus.status().committed,0);
  }
  const bus=runtime(),events=[];let writes=0;bus.subscribe(event=>events.push(event));const unchanged=await bus.run({id:'unchanged',previous:data(),next:data(),options:{requireOperationReceipt:true}},()=>{writes++;return false;});
  assert.deepEqual(unchanged.ack,{ok:true,unchanged:true});assert.equal(writes,0);assert.deepEqual(events,[]);
  let current=context();const switched=runtime({getContext:()=>current}),gate=deferred(),started=deferred();switched.subscribe(event=>events.push(event));
  const pending=switched.run(command(),async()=>{started.resolve();await gate.promise;return {ok:true};}),checked=assert.rejects(pending,{code:'STALE_IDENTITY'});
  await started.promise;current=context({identity:'other'});gate.resolve();await checked;assert.deepEqual(events,[]);
});

test('captured base revisions reach the existing CAS adapter unchanged after an asynchronous prepare',async()=>{
  let current=context(),storedRevision=5,writes=0;const started=deferred(),gate=deferred(),bus=runtime({getContext:()=>current,prepare:async(previous,next,ctx)=>{started.resolve();await gate.promise;return kernel.prepare(previous,next,ctx);}});
  const pending=bus.run(command(),plan=>{assert.equal(plan.base.vehicles,5);if(plan.base.vehicles!==storedRevision)return {ok:false,conflicts:['vehicles']};writes++;return {ok:true};}),checked=assert.rejects(pending,{code:'UNCONFIRMED_COMMIT'});
  await started.promise;storedRevision=6;current.revisions.vehicles=6;gate.resolve();await checked;assert.equal(writes,0);
});

test('async pending queue is bounded before cloning the seventeenth command and resumes normally after drain',async()=>{
  const gate=deferred();let prepares=0,writes=0,overflowReads=0;const bus=runtime({prepare:async(previous,next,ctx)=>{prepares++;await gate.promise;return kernel.prepare(previous,next,ctx);}}),jobs=[];
  for(let i=0;i<16;i++)jobs.push(bus.run(command('pending-'+i),()=>{writes++;return {ok:true};}));
  const overflow={id:'overflow',next:command().next};Object.defineProperty(overflow,'previous',{enumerable:true,get(){overflowReads++;return data();}});
  await assert.rejects(bus.run(overflow,()=>{writes++;return {ok:true};}),{code:'QUEUE_LIMIT'});assert.equal(overflowReads,0);assert.equal(bus.status().queued+bus.status().running,16);assert.equal(bus.status().maxPending,16);
  gate.resolve();await Promise.all(jobs);assert.equal(writes,16);assert.equal(prepares,16);assert.equal(bus.status().running,0);assert.equal(bus.status().queued,0);
  await bus.run(command('after-drain'),()=>{writes++;return {ok:true};});assert.equal(writes,17);
  for(const maxPending of [0,129,1.5,'16'])assert.throws(()=>runtime({maxPending}),{code:'INVALID_CONFIGURATION'});
});
