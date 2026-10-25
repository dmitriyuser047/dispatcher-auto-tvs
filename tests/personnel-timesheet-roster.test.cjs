'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const roster=require('../assets/core/personnel-timesheet-roster'),timesheets=require('../assets/core/personnel-timesheet');
const person=(patch={})=>({id:'existing',name:'Иванов Иван Иванович',org:'ТЕСТ',site:'Исходный объект',personnelNumber:'001',personnelRoles:['driver'],employmentStatus:'active',phone:'immutable-phone',note:'immutable-note',...patch});
const row=(patch={})=>({id:'row',name:'Иванов Иван Иванович',department:'ТЕСТ',site:'Объект табеля',personnelNumber:'001',days:{'2026-10-01':0,'2026-10-02':11.5,'2026-10-03':'МВ','2026-10-20':'ОТ'},note:'Фактическое примечание',...patch});
const model=(rows=[row()],patch={})=>timesheets.create({kind:'driver',from:'2026-10-01',to:'2026-10-15',org:'ТЕСТ',rows,...patch});
const ids=value=>({createIds:value.rows.map((entry,index)=>({rowId:entry.id,id:'created-'+index}))});
const preview=(drivers,value=model(),options=ids(value))=>roster.preview({drivers},value,options);
const withoutLinks=value=>({...value,rows:value.rows.map(({employeeId,...entry})=>entry)});

test('new cards preserve tabell facts and existing employees, own their immutable results, and use explicit stable IDs',()=>{
 const existing=person({id:0,name:'Другой сотрудник',personnelNumber:'099'}),value=model(),database={drivers:[existing]},before=structuredClone({database,value}),options=ids(value);
 const result=roster.preview(database,value,options);
 assert.equal(result.canApply,true);assert.deepEqual(result.createdIds,['created-0']);assert.equal(result.model.rows[0].employeeId,'created-0');assert.deepEqual(result.drivers[0],existing);
 assert.deepEqual(result.drivers[1],{id:'created-0',name:row().name,org:'ТЕСТ',site:'Объект табеля',personnelNumber:'001',personnelRoles:['driver'],employmentStatus:'active'});
 assert.deepEqual(withoutLinks(result.model),value);assert.deepEqual({database,value},before);assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.model.rows[0].days)&&Object.isFrozen(result.drivers[0]));
 assert.deepEqual(roster.preview(database,value,options),result);assert.match(result.fingerprint,/^sha256:[a-f0-9]{64}$/);
 assert.throws(()=>{result.drivers[0].phone='changed';},TypeError);
});

test('matching priority preserves typed ID zero and string zero before names or personnel numbers',()=>{
 const people=[person({id:0}),person({id:'0',name:'Петров Пётр Петрович',personnelNumber:'002'})];
 const value=model([row({id:0,employeeId:0,name:'Историческое ФИО',personnelNumber:'legacy'}),row({id:'0',employeeId:'0',name:'Другое историческое ФИО',personnelNumber:'legacy'})]);
 const result=preview(people,value);assert.equal(result.canApply,true);assert.deepEqual(result.model.rows.map(entry=>entry.employeeId),[0,'0']);assert.deepEqual(result.createdIds,[]);assert.deepEqual(result.drivers,people);assert.deepEqual(result.items.map(entry=>entry.status),['matched','matched']);
});

test('a broken explicit reference never falls back to a matching number or creates a replacement',()=>{
 for(const employeeId of ['missing',null,false,1.5]){const result=preview([person()],model([row({employeeId})]));assert.equal(result.canApply,false);assert.equal(result.items[0].status,'blocked');assert.deepEqual(result.createdIds,[]);assert.equal(result.drivers.length,1);}
});

test('numbers and organization match exactly after trim, retaining leading zeros and old card fields',()=>{
 const existing=person(),result=preview([existing],model([row({personnelNumber:' 001 ',department:' тест ',name:'  ИВАНОВ   Иван Иванович  '})]));
 assert.equal(result.canApply,true);assert.equal(result.items[0].status,'matched');assert.equal(result.model.rows[0].employeeId,existing.id);assert.deepEqual(result.drivers,[existing]);
 const mismatch=preview([existing],model([row({personnelNumber:'1'})]));assert.equal(mismatch.canApply,false);assert.match(mismatch.items[0].reason,/номера различаются/);
});

test('unique exact full name can link a card without a number but does not fuzz initials or ё and е',()=>{
 const people=[person({personnelNumber:''})],value=model([row({personnelNumber:''})]);assert.equal(preview(people,value).items[0].status,'matched');
 for(const name of ['Иванов И. И.','Иванов Иван Иванович-младший'])assert.equal(preview(people,model([row({name,personnelNumber:''})])).items[0].status,'create');
 assert.equal(preview([person({name:'Семёнов Иван Иванович',personnelNumber:''})],model([row({name:'Семенов Иван Иванович',personnelNumber:''})])).items[0].status,'create');
});

test('ambiguous numbers, ambiguous names, conflicting names and numbers require correction or skip',()=>{
 const cases=[
  [[person(),person({id:'another',name:'Другое ФИО'})],row()],
  [[person({personnelNumber:''}),person({id:'another',personnelNumber:''})],row({personnelNumber:''})],
  [[person({name:'Другое ФИО'})],row()],
  [[person({personnelNumber:'002'})],row()]
 ];
 for(const [people,entry]of cases){const result=preview(people,model([entry]));assert.equal(result.canApply,false);assert.equal(result.items[0].status,'blocked');assert.deepEqual(result.createdIds,[]);assert.deepEqual(result.drivers,people);}
});

test('cross organization matches and missing organizations block creation without moving any card',()=>{
 for(const people of [[person({org:'ДРУГАЯ'})],[person({org:'ДРУГАЯ',personnelNumber:'999'})]]){const result=preview(people);assert.equal(result.canApply,false);assert.match(result.items[0].reason,/другой организации/);assert.deepEqual(result.drivers,people);}
 const absent=preview([],model([row({department:''})],{org:''}));assert.equal(absent.canApply,false);assert.match(absent.items[0].reason,/организацию/);
});

test('archive, deletion, merge and wrong roles cannot silently reactivate or widen existing cards',()=>{
 for(const patch of [{archived:true},{deleted:true},{cancelled:true},{status:'cancelled'},{mergedInto:0},{personnelRoles:['operator']}]){const existing=person(patch),result=preview([existing]);assert.equal(result.canApply,false);assert.equal(result.items[0].status,'blocked');assert.deepEqual(result.createdIds,[]);assert.deepEqual(result.drivers,[existing]);}
 const legacy=person();delete legacy.personnelRoles;assert.equal(preview([legacy]).canApply,true,'Legacy driver remains a driver');
 const operator=preview([],model([row()],{kind:'operator'}));assert.deepEqual(operator.drivers[0].personnelRoles,['operator']);
});

test('repeated source people create one card, mixed blank numbers share it, and a replay never duplicates it',()=>{
 const value=model([row({id:'first',personnelNumber:''}),row({id:'second',personnelNumber:'001'}),row({id:'third',personnelNumber:'001'})]),options=ids(value),first=preview([],value,options);
 assert.equal(first.canApply,true);assert.equal(first.drivers.length,1);assert.deepEqual(first.createdIds,['created-0']);assert.deepEqual(first.model.rows.map(entry=>entry.employeeId),['created-0','created-0','created-0']);
 assert.equal(first.drivers[0].personnelNumber,'001');const replay=preview(first.drivers,first.model,options);assert.equal(replay.canApply,true);assert.deepEqual(replay.createdIds,[]);assert.equal(replay.drivers.length,1);assert.deepEqual(replay.model,first.model);
});

test('conflicting source identities block rather than depend on row order',()=>{
 const rows=[row({id:'first'}),row({id:'second',name:'Петров Пётр Петрович'})];
 for(const entries of [rows,[...rows].reverse()]){const result=preview([],model(entries));assert.equal(result.canApply,false);assert.deepEqual(result.items.map(entry=>entry.status),['blocked','blocked']);assert.deepEqual(result.createdIds,[]);}
 const value=model([row({id:'first',personnelNumber:'001'}),row({id:'second',personnelNumber:'002'})]);
 const noNumber=preview([person({personnelNumber:''})],value);assert.equal(noNumber.canApply,false);assert.ok(noNumber.items.every(entry=>entry.status==='blocked'));
});

test('new current site is set only when every repeated source agrees and otherwise stays blank with a warning',()=>{
 for(const secondSite of ['Другой объект','']){
  const value=model([row({id:'first'}),row({id:'second',site:secondSite})]),result=preview([],value);
  assert.equal(result.canApply,true);assert.equal(result.drivers.length,1);assert.equal(result.drivers[0].site,'');assert.ok(result.items.every(entry=>entry.warnings.length===1));
 }
 const agreeing=preview([],model([row({id:'first'}),row({id:'second',site:' объект   табеля '})]));assert.equal(agreeing.drivers[0].site,'Объект табеля');assert.deepEqual(agreeing.items[0].warnings,[]);
});

test('skipping a blocked source preserves that entire factual row while importing valid people',()=>{
 const rows=[row({id:0,employeeId:'missing'}),row({id:'0',name:'Петров Пётр Петрович',personnelNumber:'002'})],value=model(rows),options={...ids(value),skipRowIds:[0]},result=preview([],value,options);
 assert.equal(result.canApply,true);assert.equal(result.items[0].status,'skip');assert.deepEqual(result.model.rows[0],value.rows[0]);assert.equal(result.drivers.length,1);assert.equal(result.model.rows[1].employeeId,'created-1');assert.deepEqual(withoutLinks({...result.model,rows:[result.model.rows[1]]}).rows[0],value.rows[1]);
});

test('review fingerprint covers source facts, roster metadata, allocation and skip decisions',()=>{
 const value=model(),options=ids(value),base=preview([],value,options).fingerprint;
 const changed=structuredClone(value);changed.rows[0].days['2026-10-02']=12;
 assert.notEqual(preview([],changed,options).fingerprint,base);assert.notEqual(preview([],value,{createIds:[{rowId:'row',id:'another'}]}).fingerprint,base);assert.notEqual(preview([],value,{...options,skipRowIds:['row']}).fingerprint,base);
 const existing=person(),matched=preview([existing],value,options).fingerprint;assert.notEqual(preview([{...existing,note:'Concurrent card change'}],value,options).fingerprint,matched);
});

test('invalid source, options and allocations fail closed, with typed ID collisions protected',()=>{
 const value=model();
 for(const options of [{},{createIds:'no'},{...ids(value),extra:true},{createIds:[{rowId:'other',id:'new'}]},{createIds:[{rowId:'row',id:'one'},{rowId:'row',id:'two'}]},{...ids(value),skipRowIds:['missing']},{...ids(value),skipRowIds:['row','row']}])assert.throws(()=>preview([],value,options));
 const used=preview([person({id:0,name:'Другой',personnelNumber:'099'})],value,{createIds:[{rowId:'row',id:0}]});assert.equal(used.canApply,false);assert.deepEqual(used.createdIds,[]);
 const distinct=preview([person({id:'0',name:'Другой',personnelNumber:'099'})],value,{createIds:[{rowId:'row',id:0}]});assert.equal(distinct.canApply,true);assert.deepEqual(distinct.createdIds,[0]);
 assert.throws(()=>preview([], {...value,rows:[row({days:{'2026-10-01':25}})]}));assert.throws(()=>roster.preview({drivers:{}},value,ids(value)));
});

test('untrusted JSON accessors, cycles, sparse arrays and prototype methods are rejected without execution',()=>{
 let invoked=0;const value=model(),accessor={};Object.defineProperty(accessor,'drivers',{enumerable:true,get(){invoked++;return[];}});assert.throws(()=>roster.preview(accessor,value,ids(value)));assert.equal(invoked,0);
 const nested=structuredClone(value);Object.defineProperty(nested.rows[0],'site',{enumerable:true,get(){invoked++;return 'malicious';}});assert.throws(()=>preview([],nested));assert.equal(invoked,0);
 const cyclic=structuredClone(value);cyclic.source=cyclic;assert.throws(()=>preview([],cyclic));const sparse=[];sparse.length=1;assert.throws(()=>preview(sparse,value));
 const executable=structuredClone(value);executable.source={toJSON(){invoked++;return {};}};assert.throws(()=>preview([],executable));assert.equal(invoked,0);
});
