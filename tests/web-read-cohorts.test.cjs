'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createReadCohorts}=require('../web/read-cohorts.cjs');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const code=(value,status)=>error=>error?.code===value&&error.status===status;

test('reads start on a later turn with frozen batches and members that settle once',async()=>{
 const batches=[],queue=createReadCohorts({key:value=>value.key,run:batch=>{batches.push(batch);assert.equal(Object.isFrozen(batch),true);for(const entry of batch){assert.equal(Object.isFrozen(entry),true);assert.equal(entry.settled,false);assert.equal(entry.resolve(entry.value.id),true);assert.equal(entry.settled,true);assert.equal(entry.resolve('duplicate'),false);assert.equal(entry.reject(Error('late')),false);}}});
 const value={id:1,key:'A'},first=queue.enqueue(value),second=queue.enqueue({id:2,key:'A'});assert.equal(batches.length,0);assert.deepEqual(await Promise.all([first,second]),[1,2]);assert.equal(batches.length,1);assert.equal(Object.isFrozen(value),false);await queue.close();
});
test('FIFO heads collect only matching keys up to the batch bound and null keys stay individual',async()=>{
 const batches=[],queue=createReadCohorts({key:value=>value.key,maxBatch:2,run:batch=>{batches.push(batch.map(entry=>entry.value.id));for(const entry of batch)entry.resolve(entry.value.id);}});
 const values=[['a1','A'],['b1','B'],['a2','A'],['a3','A'],['b2','B'],['n1',null],['n2',null],['a4','A']];
 assert.deepEqual(await Promise.all(values.map(([id,key])=>queue.enqueue({id,key}))),values.map(([id])=>id));assert.deepEqual(batches,[['a1','a2'],['b1','b2'],['a3','a4'],['n1'],['n2']]);await queue.close();
});
test('arrivals during a run are detached from that cohort and run only on a later turn',async()=>{
 const release=deferred(),started=deferred(),batches=[];let runs=0;
 const queue=createReadCohorts({key:()=>'',run:async batch=>{runs++;batches.push(batch);if(runs===1){started.resolve();await release.promise;}for(const entry of batch)entry.resolve(entry.value);}});
 const first=queue.enqueue(1);await started.promise;const second=queue.enqueue(2),third=queue.enqueue(3);assert.equal(runs,1);assert.equal(batches[0].length,1);release.resolve();assert.equal(await first,1);assert.equal(runs,1);assert.deepEqual(await Promise.all([second,third]),[2,3]);assert.equal(runs,2);assert.deepEqual(batches.map(batch=>batch.map(entry=>entry.value)),[[1],[2,3]]);await queue.close();
});
test('capacity includes an entire active batch until its run finishes',async()=>{
 const release=deferred(),started=deferred();let runs=0;
 const queue=createReadCohorts({key:()=>'',maxPending:2,run:async batch=>{runs++;if(runs===1){batch[0].resolve('early');started.resolve();await release.promise;}for(const entry of batch)entry.resolve('done');}});
 const first=queue.enqueue(1),second=queue.enqueue(2);await started.promise;assert.equal(await first,'early');await assert.rejects(queue.enqueue(3),code('READ_QUEUE_FULL',503));release.resolve();assert.equal(await second,'done');await turn();assert.equal(await queue.enqueue(4),'done');await queue.close();
});
test('cancelled queued members are pruned before capacity and before batching',async()=>{
 const batches=[],queue=createReadCohorts({key:()=>'',maxPending:2,isCancelled:value=>value.cancelled,run:batch=>{batches.push(batch.map(entry=>entry.value.id));for(const entry of batch)entry.resolve(entry.value.id);}}),a={id:'a'},b={id:'b'};
 const first=queue.enqueue(a),second=queue.enqueue(b),firstRejected=assert.rejects(first,code('REQUEST_ABORTED',499));a.cancelled=true;const third=queue.enqueue({id:'c'});await firstRejected;assert.deepEqual(await Promise.all([second,third]),['b','c']);assert.deepEqual(batches,[['b','c']]);
 const fourth={id:'d'},pending=queue.enqueue(fourth),rejected=assert.rejects(pending,code('REQUEST_ABORTED',499));fourth.cancelled=true;await rejected;assert.deepEqual(batches,[['b','c']]);await queue.close();
});
test('cancellation of an active member rejects it and prevents a late settlement',async()=>{
 const release=deferred(),started=deferred(),value={id:'active'};let firstEntry,runs=0;
 const queue=createReadCohorts({key:()=>'',maxPending:2,maxBatch:1,isCancelled:input=>input.cancelled,run:async batch=>{runs++;if(runs===1){firstEntry=batch[0];started.resolve();await release.promise;}for(const entry of batch)entry.resolve(entry.value.id);}});
 const first=queue.enqueue(value),aborted=assert.rejects(first,code('REQUEST_ABORTED',499));await started.promise;value.cancelled=true;const next=queue.enqueue({id:'next'});await aborted;assert.equal(firstEntry.settled,true);assert.equal(firstEntry.resolve('late'),false);release.resolve();assert.equal(await next,'next');await queue.close();
});
test('a cancelled incoming request returns499 even when the queue is full',async()=>{
 const release=deferred(),started=deferred(),queue=createReadCohorts({key:()=>'',maxPending:1,isCancelled:value=>value.cancelled,run:async batch=>{started.resolve();await release.promise;batch[0].resolve();}});
 const first=queue.enqueue({});await started.promise;await assert.rejects(queue.enqueue({cancelled:true}),code('REQUEST_ABORTED',499));release.resolve();await first;await queue.close();
});
test('sync and async run failures reject only remaining members and do not retry a batch',async()=>{
 const failure=Error('Synthetic read failure'),batches=[],queue=createReadCohorts({key:value=>value.key,run:batch=>{batches.push(batch);if(batch[0].value.key==='A'){batch[0].resolve('kept');throw failure;}if(batch[0].value.key==='B')return Promise.reject(failure);for(const entry of batch)entry.resolve('later');}});
 const outcomes=await Promise.allSettled([queue.enqueue({key:'A'}),queue.enqueue({key:'A'}),queue.enqueue({key:'B'}),queue.enqueue({key:'C'})]);assert.deepEqual(outcomes.map(result=>result.status),['fulfilled','rejected','rejected','fulfilled']);assert.equal(outcomes[0].value,'kept');assert.equal(outcomes[1].reason,failure);assert.equal(outcomes[2].reason,failure);assert.equal(outcomes[3].value,'later');assert.equal(batches.length,3);await queue.close();
});
test('a run that omits a member rejects it as incomplete instead of hanging',async()=>{
 const queue=createReadCohorts({key:()=>'',run:batch=>{batch[0].resolve('kept');}}),results=await Promise.allSettled([queue.enqueue(1),queue.enqueue(2)]);assert.equal(results[0].value,'kept');assert.equal(results[1].reason.code,'READ_COHORT_INCOMPLETE');assert.equal(results[1].reason.status,500);await queue.close();
});
test('close cancels a scheduled drain and rejects queued and future requests with503',async()=>{
 let runs=0;const queue=createReadCohorts({key:()=>'',run:()=>{runs++;}}),pending=queue.enqueue(1),rejected=assert.rejects(pending,code('SERVER_STOPPED',503)),closed=queue.close();assert.equal(queue.close(),closed);await rejected;await closed;await turn();assert.equal(runs,0);await assert.rejects(queue.enqueue(2),code('SERVER_STOPPED',503));
});
test('close rejects active and pending tasks immediately but awaits the active run finishing',async()=>{
 const release=deferred(),started=deferred();let closed=false,runs=0,entry;
 const queue=createReadCohorts({key:value=>value,maxBatch:1,run:async batch=>{runs++;entry=batch[0];started.resolve();await release.promise;assert.equal(entry.resolve('late publication'),false);}});
 const first=queue.enqueue('A'),firstRejected=assert.rejects(first,code('SERVER_STOPPED',503));await started.promise;const second=queue.enqueue('B'),secondRejected=assert.rejects(second,code('SERVER_STOPPED',503)),closing=queue.close();closing.then(()=>{closed=true;});assert.equal(queue.close(),closing);await Promise.all([firstRejected,secondRejected]);assert.equal(closed,false);assert.equal(entry.settled,true);await assert.rejects(queue.enqueue('C'),code('SERVER_STOPPED',503));release.resolve();await closing;assert.equal(closed,true);assert.equal(runs,1);
});
test('hook errors reject requests without reserving slots or stranding later reads',async()=>{
 const failure=Error('Synthetic hook failure'),queue=createReadCohorts({maxPending:1,key:value=>{if(value.bad)throw failure;return value.key;},isCancelled:value=>{if(value.cancelError)throw failure;return false;},run:batch=>{for(const entry of batch)entry.resolve('ok');}});
 await assert.rejects(queue.enqueue({bad:true}),error=>error===failure);await assert.rejects(queue.enqueue({key:42}),TypeError);await assert.rejects(queue.enqueue({cancelError:true}),error=>error===failure);assert.equal(await queue.enqueue({key:null}),'ok');await queue.close();
});
test('queue construction rejects invalid hooks and non-finite or empty bounds',()=>{
 for(const options of [{},{key:()=>'',run:null},{key:()=>'',run:()=>{},maxPending:0},{key:()=>'',run:()=>{},maxPending:Infinity},{key:()=>'',run:()=>{},maxBatch:0},{key:()=>'',run:()=>{},maxBatch:1.5},{key:()=>'',run:()=>{},isCancelled:null}])assert.throws(()=>createReadCohorts(options),TypeError);
});
