'use strict';
// Deterministic planning vectors; no journals, storage, profiles or system clock.
const {test}=require('node:test'),assert=require('node:assert/strict');
const api=require('../assets/core/generator-maintenance.js');
const input=extra=>({startDate:'2027-01-01',endDate:'2027-12-31',currentHours:1000,intervalHours:300,firstDueHours:1300,utilization:{mode:'monthly',hours:300},...extra});
const code=expected=>error=>error.code===expected;
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

test('300 hours per month reaches every 300-hour service exactly at the actual calendar month end',()=>{
 const expected=['2027-01-31','2027-02-28','2027-03-31','2027-04-30','2027-05-31','2027-06-30','2027-07-31','2027-08-31','2027-09-30','2027-10-31','2027-11-30','2027-12-31'];
 assert.deepEqual(api.forecastOccurrences(input()),expected.map((plannedDate,index)=>({plannedDate,plannedHours:1300+index*300})));
});

test('600 monthly hours produce two 300-hour services each month, including multiple dates in February',()=>{
 const result=api.forecastOccurrences(input({utilization:{mode:'monthly',hours:600}}));assert.equal(result.length,24);assert.deepEqual(result.slice(0,4),[{plannedDate:'2027-01-16',plannedHours:1300},{plannedDate:'2027-01-31',plannedHours:1600},{plannedDate:'2027-02-14',plannedHours:1900},{plannedDate:'2027-02-28',plannedHours:2200}]);
 for(let month=1;month<=12;month++)assert.equal(result.filter(row=>Number(row.plannedDate.slice(5,7))===month).length,2);assert.equal(result.at(-1).plannedHours,8200);
});

test('partial first months carry exact fractional workload across later months without rounded daily division',()=>{
 const result=api.forecastOccurrences(input({startDate:'2027-01-16',endDate:'2027-03-31',currentHours:0,firstDueHours:300}));assert.deepEqual(result,[{plannedDate:'2027-02-14',plannedHours:300},{plannedDate:'2027-03-15',plannedHours:600}]);
 const leap=api.forecastOccurrences(input({startDate:'2028-02-01',endDate:'2028-02-29',currentHours:0,intervalHours:150,firstDueHours:150}));assert.deepEqual(leap,[{plannedDate:'2028-02-15',plannedHours:150},{plannedDate:'2028-02-29',plannedHours:300}]);
 const ordinary=api.forecastOccurrences(input({startDate:'2027-02-01',endDate:'2027-02-28',currentHours:0,intervalHours:150,firstDueHours:150}));assert.deepEqual(ordinary,[{plannedDate:'2027-02-14',plannedHours:150},{plannedDate:'2027-02-28',plannedHours:300}]);
});

test('daily workload includes the explicitly chosen first day and carries across month boundaries',()=>{
 assert.deepEqual(api.forecastOccurrences(input({endDate:'2027-03-31',utilization:{mode:'daily',hours:10}})),[{plannedDate:'2027-01-30',plannedHours:1300},{plannedDate:'2027-03-01',plannedHours:1600},{plannedDate:'2027-03-31',plannedHours:1900}]);
 assert.deepEqual(api.forecastOccurrences(input({endDate:'2027-01-31',firstDueHours:1001,utilization:{mode:'daily',hours:10}})),[{plannedDate:'2027-01-01',plannedHours:1001},{plannedDate:'2027-01-31',plannedHours:1301}]);
});

test('fractional hour thresholds use exact base-ten arithmetic and never drop another service on the same day',()=>{
 const result=api.forecastOccurrences(input({endDate:'2027-01-02',currentHours:0,intervalHours:.1,firstDueHours:.1,utilization:{mode:'daily',hours:.3}}));assert.deepEqual(result,[{plannedDate:'2027-01-01',plannedHours:.1},{plannedDate:'2027-01-01',plannedHours:.2},{plannedDate:'2027-01-01',plannedHours:.3},{plannedDate:'2027-01-02',plannedHours:.4},{plannedDate:'2027-01-02',plannedHours:.5},{plannedDate:'2027-01-02',plannedHours:.6}]);
 assert.deepEqual(api.forecastOccurrences(input({endDate:'2027-01-02',currentHours:0,intervalHours:10,firstDueHours:10,utilization:{mode:'daily',hours:24}})),[{plannedDate:'2027-01-01',plannedHours:10},{plannedDate:'2027-01-01',plannedHours:20},{plannedDate:'2027-01-02',plannedHours:30},{plannedDate:'2027-01-02',plannedHours:40}]);
});

test('explicit seasonal monthly arrays repeat across years while partial months retain their actual day count',()=>{
 const hours=Array(12).fill(0);hours[0]=310;hours[11]=310;
 assert.deepEqual(api.forecastOccurrences(input({startDate:'2026-12-16',endDate:'2027-01-31',currentHours:0,firstDueHours:300,utilization:{mode:'monthly',hours}})),[{plannedDate:'2027-01-14',plannedHours:300}]);
 const annual=Array(12).fill(300);annual[1]=0;const result=api.forecastOccurrences(input({utilization:{mode:'monthly',hours:annual}}));assert.equal(result.length,11);assert.deepEqual(result.slice(0,2),[{plannedDate:'2027-01-31',plannedHours:1300},{plannedDate:'2027-03-31',plannedHours:1600}]);
 assert.ok(api.forecastOccurrences(input({startDate:'2026-10-25',endDate:'2027-12-31',utilization:{mode:'monthly',hours:600}})).some(row=>row.plannedDate.startsWith('2026-')));
});

test('explicit zero utilization means no work; unknown or malformed counters and rates never become zero',()=>{
 for(const utilization of [{mode:'daily',hours:0},{mode:'monthly',hours:0},{mode:'monthly',hours:Array(12).fill(0)}])assert.deepEqual(api.forecastOccurrences(input({utilization})),[]);
 for(const field of ['currentHours','intervalHours','firstDueHours'])for(const value of [null,'300',false,-1,.0001,Infinity,1e12+1])assert.throws(()=>api.forecastOccurrences(input({[field]:value})));
 for(const mode of ['daily','monthly'])for(const hours of [null,'10',false,-1,.0001])assert.throws(()=>api.forecastOccurrences(input({utilization:{mode,hours}})));
 for(const hours of [[],Array(11).fill(10),Array(13).fill(10),[null,...Array(11).fill(10)]])assert.throws(()=>api.forecastOccurrences(input({utilization:{mode:'monthly',hours}})));
});

test('overdue or already reached first service is a blocker rather than a silent jump to a later interval',()=>{
 for(const firstDueHours of [0,999,1000])assert.throws(()=>api.forecastOccurrences(input({firstDueHours})),code('MAINTENANCE_FORECAST_OVERDUE'));
 assert.throws(()=>api.forecastOccurrences(input({currentHours:650,firstDueHours:300})),code('MAINTENANCE_FORECAST_OVERDUE'));
 assert.throws(()=>api.forecastOccurrences(input({intervalHours:0,utilization:{mode:'daily',hours:0}})),code('MAINTENANCE_FORECAST_INTERVAL'));
 assert.throws(()=>api.forecastOccurrences(input({firstDueHours:undefined})));assert.throws(()=>api.forecastOccurrences({...input(),lastServiceHours:1000}),code('MAINTENANCE_FIELD'));
});

test('physical workload limits use actual month lengths and permit a 29-day February only in a leap year',()=>{
 assert.throws(()=>api.forecastOccurrences(input({utilization:{mode:'daily',hours:24.001}})),code('MAINTENANCE_FORECAST_UTILIZATION'));
 assert.throws(()=>api.forecastOccurrences(input({startDate:'2027-02-01',endDate:'2027-02-01',utilization:{mode:'monthly',hours:696}})),code('MAINTENANCE_FORECAST_UTILIZATION'));
 assert.doesNotThrow(()=>api.forecastOccurrences(input({startDate:'2028-02-01',endDate:'2028-02-29',utilization:{mode:'monthly',hours:696}})));
 assert.doesNotThrow(()=>api.forecastOccurrences(input({endDate:'2027-01-31',utilization:{mode:'monthly',hours:744}})));
 assert.throws(()=>api.forecastOccurrences(input({endDate:'2027-02-01',utilization:{mode:'monthly',hours:744}})),code('MAINTENANCE_FORECAST_UTILIZATION'));
});

test('invalid date windows, excessive forecast lengths and event overflows fail atomically instead of clamping or truncating',()=>{
 for(const dates of [{startDate:'2027-02-30'},{endDate:'2026-12-31'},{startDate:'1899-12-31'},{startDate:'2020-01-01',endDate:'2031-01-01'}])assert.throws(()=>api.forecastOccurrences(input(dates)));
 const maximum=input({startDate:'2027-01-01',endDate:'2027-01-01',currentHours:0,intervalHours:.001,firstDueHours:.001,utilization:{mode:'daily',hours:10}}),result=api.forecastOccurrences(maximum);assert.equal(result.length,10000);assert.equal(result.at(-1).plannedHours,10);
 const tooMany=freeze({...maximum,utilization:{mode:'daily',hours:24}}),before=JSON.stringify(tooMany);assert.throws(()=>api.forecastOccurrences(tooMany),code('MAINTENANCE_FORECAST_LIMIT'));assert.equal(JSON.stringify(tooMany),before);
 assert.deepEqual(api.forecastOccurrences(input({startDate:'9999-12-31',endDate:'9999-12-31',currentHours:0,intervalHours:12,firstDueHours:12,utilization:{mode:'daily',hours:24}})),[{plannedDate:'9999-12-31',plannedHours:12},{plannedDate:'9999-12-31',plannedHours:24}]);
});

test('the forecast owns its output and never generates record IDs, service facts, counters or source mutations',()=>{
 const original=freeze(input()),before=JSON.stringify(original),result=api.forecastOccurrences(original);assert.equal(JSON.stringify(original),before);assert.deepEqual(Object.keys(result[0]),['plannedDate','plannedHours']);result[0].plannedHours=999;assert.equal(original.currentHours,1000);assert.equal(api.forecastOccurrences(original)[0].plannedHours,1300);
 const grouped=api.groupCalendarRows([{id:0,generatorId:0,site:'SYNTHETIC',type:'ТО-1',work:'Synthetic work',note:'',components:[{partId:0,qty:2}],plannedDate:'2027-01-01',plannedHours:0}]);grouped[0].occurrences=result.slice(1).map((row,index)=>({id:'explicit-ui-id-'+index,...row}));assert.equal(api.expandCalendarGroups(grouped).length,11);
});

test('forecast JSON boundaries reject executable and hidden properties without invoking caller code',()=>{
 let executed=0;const value=input();Object.defineProperty(value,'currentHours',{get(){executed++;return 1000;},enumerable:true});assert.throws(()=>api.forecastOccurrences(value));
 const rate=input();Object.defineProperty(rate.utilization,'toJSON',{value(){executed++;return {};},enumerable:false});assert.throws(()=>api.forecastOccurrences(rate));assert.equal(executed,0);
});
