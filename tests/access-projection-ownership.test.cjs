'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const policy=require('../assets/core/access-policy.js'),scope=require('../assets/core/access-scope.js'),schema=require('../assets/core/platform-schema.js');
const known=value=>({state:'known',value}),facts=()=>({kind:'owned',owners:[{org:known('A'),site:known('N')}]});
const rules={version:1,grants:[{org:'A',site:'N'}]};
const context=resolve=>({readable:['records','vehicles'],writable:['records','vehicles'],resolve:resolve||(()=>facts())});
const database=extra=>({...Object.fromEntries(schema.sections.map(name=>[name,[]])),...extra});
function frozen(value){if(value&&typeof value==='object'){Object.values(value).forEach(frozen);Object.freeze(value);}return value;}

test('projection resolver owns a frozen snapshot while callers and projected nested values remain independent and mutable',()=>{
 const input={id:0,org:'A',details:{list:[{amount:12}],empty:[]}};let seen;
 const reader=policy.createReader(rules,context((_section,row)=>{seen=row;assert.ok(Object.isFrozen(row));assert.ok(Object.isFrozen(row.details.list[0]));assert.throws(()=>{row.details.list[0].amount=99;},TypeError);return facts();}));
 const first=reader.projectRows('records',[input])[0];assert.notEqual(seen,input);assert.notEqual(first,seen);assert.notEqual(first.details,seen.details);assert.notEqual(first.details.list,seen.details.list);assert.equal(Object.isFrozen(input),false);assert.equal(Object.isFrozen(input.details.list),false);assert.equal(Object.isFrozen(first),false);
 first.details.list[0].amount=30;first.details.list.push({amount:40});first.details.empty.push('new');first.org='Changed';
 assert.equal(input.details.list[0].amount,12);assert.equal(seen.details.list[0].amount,12);assert.deepEqual(reader.projectRows('records',[input])[0],input);
 input.details.list[0].amount=50;assert.equal(reader.projectRows('records',[input])[0].details.list[0].amount,50);assert.equal(first.details.list[0].amount,30);
});

test('read-only optimization does not freeze unchanged hidden rows returned from merge or authorize their changes',()=>{
 const previous=[{id:0,org:'A',site:'N',details:{list:[1]}},{id:'0',org:'B',site:'S',details:{list:[2]}}];
 const ctx=context((_section,row)=>({kind:'owned',owners:[{org:known(row.org),site:known(row.site)}]}));
 const merged=policy.mergeVisibleChanges(rules,'records',previous,[{...previous[0],details:{list:[3]}}],ctx);
 assert.deepEqual(merged,[{...previous[0],details:{list:[3]}},previous[1]]);assert.equal(Object.isFrozen(merged[1]),false);assert.equal(Object.isFrozen(merged[1].details.list),false);
 merged[0].details.list.push(4);merged[1].details.list.push(5);assert.deepEqual(previous[0].details.list,[1]);assert.deepEqual(previous[1].details.list,[2]);
 assert.throws(()=>policy.mergeVisibleChanges(rules,'records',previous,[previous[0],{...previous[1],details:{list:[9]}}],ctx),{code:'ACCESS_DENIED'});
});

test('frozen caller rows and proxies still pass strict descriptor validation and never become a private capability',()=>{
 let getters=0;const getter={id:0};Object.defineProperty(getter,'note',{enumerable:true,get(){getters++;return 'must not run';}});Object.freeze(getter);
 const row=frozen({id:0,details:{note:'data'}}),proxy=new Proxy(row,{get(target,key,receiver){if(key==='id'||key==='details')throw Error('raw proxy field access');return Reflect.get(target,key,receiver);}});
 assert.deepEqual(policy.projectRows(rules,'records',[proxy],context()),[row]);assert.equal(scope.resolve(database(),'records',proxy).kind,'unknown');
 assert.throws(()=>policy.projectRows(rules,'records',[getter],context()),{code:'ACCESS_ROW_INVALID'});assert.throws(()=>scope.resolve(database(),'records',getter),{code:'ACCESS_SCOPE_JSON'});assert.equal(getters,0);
});

test('denied fields and unreadable sections still reject hidden executable, cyclic, sparse, non-finite and oversized inputs',()=>{
 let getters=0;const getter={id:0};Object.defineProperty(getter,'private',{enumerable:true,get(){getters++;return 'must not run';}});
 const symbol={id:0,[Symbol('secret')]:1},hidden={id:0};Object.defineProperty(hidden,'secret',{value:true});
 const cyclic={id:0};cyclic.private=cyclic;const sparse={id:0,private:Array(1)},nonFinite={id:0,private:Infinity},dangerous=JSON.parse('{"id":0,"private":{"__proto__":{}}}');
 let deep={value:0};for(let n=0;n<85;n++)deep={next:deep};
 const masked={version:1,grants:[{org:'A',site:'N'}],sections:{records:{readFields:['id']}}};
 for(const input of [getter,symbol,hidden,cyclic,sparse,nonFinite,dangerous,{id:0,private:deep}]){
  assert.throws(()=>policy.projectRows(masked,'records',[input],context()),{code:'ACCESS_ROW_INVALID'});
  assert.throws(()=>policy.projectRows(null,'payments',[input],context()),{code:'ACCESS_ROW_INVALID'});
  assert.throws(()=>scope.resolve(database(),'records',input),{code:'ACCESS_SCOPE_JSON'});
 }
 assert.equal(getters,0);assert.throws(()=>policy.projectRows(null,'records',[{id:0,items:Array(100001).fill(null)}],context()),{code:'ACCESS_ROW_INVALID'});
});

test('resolver output and nested guard replacement values are revalidated and copied on every projection',()=>{
 let getters=0,current=facts();const reader=policy.createReader(rules,context(()=>current)),input={id:0,details:{note:'private'}};
 assert.deepEqual(reader.projectRows('records',[input]),[input]);
 current={...facts(),fieldGuards:[{path:['details'],requires:{sections:['payments'],owners:[],complete:true},deniedValue:{note:'masked',items:[1]}}]};
 const projected=reader.projectRows('records',[input])[0];projected.details.items.push(2);assert.deepEqual(current.fieldGuards[0].deniedValue.items,[1]);assert.deepEqual(reader.projectRows('records',[input])[0].details.items,[1]);
 Object.defineProperty(current.fieldGuards[0].deniedValue,'note',{enumerable:true,get(){getters++;return 'must not run';}});
 assert.throws(()=>reader.projectRows('records',[input]),{code:'ACCESS_CONTEXT_INVALID'});assert.equal(getters,0);
});

test('repeated date validation preserves invalid calendar dates, typed identities, historical gaps and request-local ownership',()=>{
 const db=database({vehicles:[{id:0,org:'CURRENT',orgHistory:[{from:'2026-02-01',to:'2026-02-28',org:'A',site:'N'}]},{id:'0',orgHistory:[{from:'2026-02-01',to:'2026-02-28',org:'B',site:'S'}]}]}),resolver=scope.createResolver(db);
 const rows=Array.from({length:12},(_,n)=>({id:n,vehicleId:n%2?'0':0,date:n%3?'2026-02-20':'2026-02-30'}));
 const bound=context((section,row)=>resolver.resolve(section,row));assert.deepEqual(policy.projectRows(rules,'records',rows,bound).map(row=>row.id),[2,4,8,10]);
 assert.equal(scope.resolve(db,'records',{id:'gap',vehicleId:0,date:'2026-03-01'}).kind,'unknown');
 db.vehicles[0].orgHistory[0].org='B';assert.deepEqual(policy.projectRows(rules,'records',rows,bound).map(row=>row.id),[2,4,8,10]);
 const changed=scope.createResolver(db);assert.deepEqual(policy.projectRows(rules,'records',rows,context((section,row)=>changed.resolve(section,row))),[]);
});
