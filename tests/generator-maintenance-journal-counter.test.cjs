'use strict';
// Synthetic journal readings only: no profiles, storage, clock or application.
const {test}=require('node:test'),assert=require('node:assert/strict');
const api=require('../assets/core/generator-maintenance.js');
const database=rows=>({generators:[{id:0,name:'Synthetic numeric DES',hoursInit:99999,fuelAccounting:{version:1,from:'2027-09-01',opening:0,basis:'Synthetic fuel-only boundary'}},{id:'0',name:'Synthetic text DES',hoursInit:77777}],genRecords:rows});
const record=extra=>({id:'reading',generatorId:0,date:'2027-01-31',meterStart:1000,meterEnd:1300,hours:300,...extra});
const request=extra=>({generatorId:0,throughDate:'2027-01-31',...extra});
const resolve=(rows,extra)=>api.journalCounter(database(rows),request(extra));
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function unknown(result,code){assert.equal(result.status,'unknown');assert.equal(result.currentHours,null);assert.equal(result.startDate,null);assert.equal(result.issues[0].code,code);assert.equal(result.reason,result.issues[0].message);}

test('the inclusive journal cutoff selects an actual end reading and starts forecasting on the next source day',()=>{
 const result=resolve([record()]);assert.deepEqual(result,{status:'known',throughDate:'2027-01-31',currentHours:1300,source:{section:'genRecords',recordId:'reading',date:'2027-01-31',field:'meterEnd'},startDate:'2027-02-01',reason:'Конечный счётчик из журнала ДЭС за 2027-01-31. Плановый расчёт начинается со следующего дня: 2027-02-01',issues:[]});
 const cutoffLater=resolve([record()],{throughDate:'2027-03-31'});assert.equal(cutoffLater.startDate,'2027-02-01');assert.equal(cutoffLater.source.date,'2027-01-31');
});

test('chronological source selection ignores array order, later readings and other typed DES without guessing',()=>{
 const rows=[record({id:'future',date:'2027-02-01',meterEnd:1600,meterStart:1300}),record({id:0}),record({id:'older',date:'2027-01-10',meterStart:900,meterEnd:1000,hours:100}),record({id:'0',generatorId:'0',meterEnd:123.456,meterStart:null,hours:1})];
 assert.equal(resolve(rows).source.recordId,0);assert.equal(resolve(rows).currentHours,1300);const other=resolve(rows,{generatorId:'0'});assert.equal(other.currentHours,123.456);assert.equal(other.source.recordId,'0');
 assert.equal(resolve(rows.slice().reverse()).source.recordId,0);
});

test('zero, millihours and the supported maximum remain exact journal facts',()=>{
 for(const meterEnd of [0,0.001,123.456,1e12]){const value=resolve([record({meterStart:null,meterEnd,hours:null})]);assert.equal(value.status,'known');assert.equal(value.currentHours,meterEnd);}
});

test('an empty or earlier journal never substitutes the card opening reading or a sum of workload hours',()=>{
 unknown(resolve([]),'MAINTENANCE_COUNTER_EMPTY');unknown(resolve([record()],{throughDate:'2027-01-30'}),'MAINTENANCE_COUNTER_EMPTY');
 unknown(resolve([{id:'hours-only',generatorId:0,date:'2027-01-31',hours:300}]),'MAINTENANCE_COUNTER_READING');
 const zeroCard=database([]);zeroCard.generators[0].hoursInit=0;unknown(api.journalCounter(zeroCard,request()),'MAINTENANCE_COUNTER_EMPTY');
});

test('deleted, cancelled, void and explicitly unposted journal rows cannot become the meter source',()=>{
 const flags=[{deleted:true},{cancelled:true},{void:true},{status:'draft'},{status:'cancelled'},{status:'void'},{status:'discarded'},{status:'unposted'},{posted:false},{lifecycle:{void:{reason:'Synthetic cancellation'}}},{lifecycle:{state:'draft'}},{lifecycle:{posted:false}}];
 for(const [index,flag]of flags.entries()){const value=resolve([record(),record({id:'inactive-'+index,date:'2027-02-01',meterEnd:9999,...flag})],{throughDate:'2027-02-02'});assert.equal(value.status,'known');assert.equal(value.source.recordId,'reading');}
});

test('a stock issue with numeric zero consumption does not mask a last operating meter reading',()=>{
 const issue={id:'linked-issue',generatorId:0,date:'2027-02-03',hours:0,fuelUsed:0,fuelActual:null,fuelMovementId:0,fuelActualSource:'movement',fuelIssued:80};
 for(const fuelActual of [null,0]){const value=resolve([record(),{...issue,fuelActual}],{throughDate:'2027-02-03'});assert.equal(value.status,'known');assert.equal(value.currentHours,1300);assert.equal(value.startDate,'2027-02-01');}
 const withMeter=resolve([record(),{...issue,meterEnd:0}],{throughDate:'2027-02-03'});assert.equal(withMeter.status,'known');assert.equal(withMeter.currentHours,0);assert.equal(withMeter.source.recordId,'linked-issue');
 for(const change of [{fuelActual:2},{fuelUsed:1},{hours:null},{meterEnd:'0'}])unknown(resolve([record(),{...issue,...change}],{throughDate:'2027-02-03'}),'MAINTENANCE_COUNTER_READING');
});

test('a latest operating row with a missing or invalid meter blocks rather than falling back to an older reading',()=>{
 for(const meterEnd of [null,'1301',true,-1,0.0001,1e12+1]){const result=resolve([record(),record({id:'latest-bad',date:'2027-02-01',meterStart:null,meterEnd,hours:null})],{throughDate:'2027-02-01'});unknown(result,'MAINTENANCE_COUNTER_READING');assert.equal(result.source.recordId,'latest-bad');}
 const absent=record({id:'absent',date:'2027-02-01'});delete absent.meterEnd;unknown(resolve([record(),absent],{throughDate:'2027-02-01'}),'MAINTENANCE_COUNTER_READING');
});

test('same-day competing source rows stay ambiguous even if meter values agree or input order changes',()=>{
 for(const meterEnd of [1300,1600]){const rows=[record(),record({id:'second',meterStart:null,meterEnd,hours:null})];unknown(resolve(rows),'MAINTENANCE_COUNTER_AMBIGUOUS');unknown(resolve(rows.reverse()),'MAINTENANCE_COUNTER_AMBIGUOUS');}
});

test('a source needs a unique typed journal ID and an unambiguous active generator',()=>{
 const rows=[record({id:0}),record({id:0,generatorId:'0',date:'2027-01-01'})];unknown(resolve(rows),'MAINTENANCE_COUNTER_SOURCE');
 const missingId=record();delete missingId.id;unknown(resolve([missingId]),'MAINTENANCE_COUNTER_SOURCE');
 const db=database([record()]);db.generators.push({...db.generators[0]});unknown(api.journalCounter(db,request()),'MAINTENANCE_COUNTER_GENERATOR');
 unknown(resolve([record()],{generatorId:'missing'}),'MAINTENANCE_COUNTER_GENERATOR');db.generators=[{id:0,archived:true}];unknown(api.journalCounter(db,request()),'MAINTENANCE_COUNTER_GENERATOR');
});

test('an invalid live operating date makes the journal uncertain while irrelevant and inactive rows do not',()=>{
 unknown(resolve([record(),record({id:'bad-date',date:'2027-02-30'})]),'MAINTENANCE_COUNTER_DATE');
 assert.equal(resolve([record(),record({id:'other-bad-date',generatorId:'0',date:'invalid'})]).status,'known');
 assert.equal(resolve([record(),record({id:'void-bad-date',date:'invalid',status:'void'})]).status,'known');
 const fuelOnly={id:'issue-bad-date',generatorId:0,date:'invalid',hours:0,fuelUsed:0,fuelMovementId:'movement'};assert.equal(resolve([record(),fuelOnly]).status,'known');
});

test('a valid future row never overrides the cutoff and the fuel accounting opening date never truncates meter history',()=>{
 const rows=[record(),record({id:'future-invalid-reading',date:'2027-09-01',meterEnd:'unknown'})];const value=resolve(rows);assert.equal(value.status,'known');assert.equal(value.source.date,'2027-01-31');
});

test('invalid source opening meters and workload require correction instead of number coercion',()=>{
 for(const change of [{meterStart:'1000'},{hours:'300'},{meterStart:-1},{hours:-1}])unknown(resolve([record(change)]),'MAINTENANCE_COUNTER_READING');
});

test('source end/start contradiction and workload mismatch never become a guessed counter reset',()=>{
 unknown(resolve([record({meterStart:1301})]),'MAINTENANCE_COUNTER_CONTRADICTION');unknown(resolve([record({hours:299})]),'MAINTENANCE_COUNTER_CONTRADICTION');
 assert.equal(resolve([record({meterStart:100,meterEnd:110,hours:9.89})]).status,'known');unknown(resolve([record({meterStart:100,meterEnd:110,hours:9.889})]),'MAINTENANCE_COUNTER_CONTRADICTION');
});

test('next-day dates respect leap years, year changes and the upper supported calendar boundary',()=>{
 for(const [date,next]of [['2028-02-28','2028-02-29'],['2028-02-29','2028-03-01'],['2027-02-28','2027-03-01'],['2027-12-31','2028-01-01'],['9999-12-30','9999-12-31']])assert.equal(resolve([record({date})],{throughDate:date}).startDate,next);
 unknown(resolve([record({date:'9999-12-31'})],{throughDate:'9999-12-31'}),'MAINTENANCE_COUNTER_RANGE');
 for(const throughDate of ['2027-02-29','2027-02-30','1899-12-31','10000-01-01','2027-1-31'])assert.throws(()=>resolve([record()],{throughDate}));
});

test('a journal-origin forecast adds work after the measured day instead of counting that day twice',()=>{
 const counter=resolve([record({meterStart:0,meterEnd:300,hours:300})]);assert.equal(counter.startDate,'2027-02-01');const events=api.forecastOccurrences({startDate:counter.startDate,endDate:'2027-02-28',currentHours:counter.currentHours,intervalHours:300,firstDueHours:600,utilization:{mode:'monthly',hours:300}});assert.deepEqual(events,[{plannedDate:'2027-02-28',plannedHours:600}]);
});

test('resolver inputs and all factual sections remain unchanged and returned provenance is immutable',()=>{
 const db=freeze({...database([record()]),payments:[{id:'unrelated-money',sum:19.99}],partMovements:[{id:'unrelated-stock',qty:80}]}),options=freeze(request()),before=JSON.stringify(db),result=api.journalCounter(db,options);assert.equal(JSON.stringify(db),before);assert.deepEqual(options,request());assert.equal(Object.isFrozen(result),true);assert.equal(Object.isFrozen(result.source),true);assert.equal(Object.isFrozen(result.issues),true);assert.throws(()=>{result.source.date='2027-03-01';});assert.equal(api.journalCounter(db,options).source.date,'2027-01-31');
});

test('executable or hidden source properties are rejected without invoking caller code',()=>{
 let executed=0;const db=database([]);Object.defineProperty(db,'genRecords',{enumerable:true,get(){executed++;return[record()];}});assert.throws(()=>api.journalCounter(db,request()));
 const options=request();Object.defineProperty(options,'throughDate',{enumerable:true,get(){executed++;return'2027-01-31';}});assert.throws(()=>api.journalCounter(database([record()]),options));
 const bad=record();Object.defineProperty(bad,'toJSON',{value(){executed++;return{};},enumerable:false});assert.throws(()=>resolve([bad]));assert.equal(executed,0);
});
