'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {setTimeout:delay}=require('node:timers/promises');
const {observeDatabase}=require('./helpers/native-database-observer.cjs');

test('native database observation retries only a temporary lock and returns the exact successful value',async()=>{
 const expected={rows:[{id:0},{id:'0'}]},busy=Object.assign(new Error('Synthetic physical lock'),{code:'DB_BUSY'});let calls=0;
 const actual=await observeDatabase(()=>{if(++calls<3)throw busy;return expected;});
 assert.equal(calls,3);assert.equal(actual,expected);
});

test('native database observation preserves a successful asynchronous reader value',async()=>{
 const expected=Object.freeze({revision:0});let calls=0;
 assert.equal(await observeDatabase(async()=>{calls++;return expected;}),expected);assert.equal(calls,1);
});

test('native database observation immediately preserves definitive errors and assertions',async()=>{
 for(const error of [Object.assign(new Error('Synthetic read failure'),{code:'EACCES'}),new assert.AssertionError({message:'The stored facts differ'}),new Error('DB_BUSY appears only in this message')]){
  let calls=0;await assert.rejects(observeDatabase(()=>{calls++;throw error;}),caught=>caught===error);assert.equal(calls,1);
 }
});

test('native database observation exhausts its deadline without suppressing or replacing DB_BUSY',{timeout:5000},async()=>{
 const busy=Object.assign(new Error('Synthetic persistent physical lock'),{code:'DB_BUSY'});let calls=0;
 await assert.rejects(observeDatabase(()=>{calls++;throw busy;},{timeoutMs:15,pollMs:5}),caught=>caught===busy);
 assert.ok(calls>=1);
 let zeroCalls=0;await assert.rejects(observeDatabase(()=>{zeroCalls++;throw busy;},{timeoutMs:0}),caught=>caught===busy);assert.equal(zeroCalls,1);
});

test('native database observation does not retry a lock error returned after the deadline',async()=>{
 const busy=Object.assign(new Error('Synthetic slow reader lock'),{code:'DB_BUSY'});let calls=0;
 await assert.rejects(observeDatabase(async()=>{calls++;await delay(15);throw busy;},{timeoutMs:1,pollMs:25}),caught=>caught===busy);assert.equal(calls,1);
});

test('native database observation refuses unbounded or invalid retry settings before reading',async()=>{
 let calls=0;const read=()=>{calls++;return null;};
 for(const options of [{timeoutMs:Infinity},{timeoutMs:-1},{timeoutMs:NaN},{pollMs:0},{pollMs:Infinity},{pollMs:-1}])await assert.rejects(observeDatabase(read,options),TypeError);
 await assert.rejects(observeDatabase(null),TypeError);assert.equal(calls,0);
});
