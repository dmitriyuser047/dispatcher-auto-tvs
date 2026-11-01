'use strict';
// Pure calendar arithmetic on synthetic values. No database, settings or clock.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const api=require('../assets/core/generator-maintenance.js');
const calendar=extra=>api.calendarMonthlyHours({year:2027,hoursPerDay:24,...extra});
const code=expected=>error=>error.code===expected;

test('monthly totals use each actual calendar month and preserve the supported year boundaries',()=>{
 assert.deepEqual(calendar(),[744,672,744,720,744,720,744,744,720,744,720,744]);
 assert.equal(calendar().reduce((sum,hours)=>sum+hours,0),8760);
 for(const year of [1900,9999])assert.equal(calendar({year}).length,12);
});

test('February follows Gregorian leap years including century exceptions',()=>{
 for(const year of [1900,2027,2100])assert.equal(calendar({year})[1],672);
 for(const year of [2000,2028,2400]){
  const months=calendar({year});assert.equal(months[1],696);
  assert.equal(months.reduce((sum,hours)=>sum+hours,0),8784);
 }
});

test('an explicit zero means no workload in every month and never activates a default',()=>{
 const input={year:2028,hoursPerDay:0};assert.deepEqual(api.calendarMonthlyHours(input),Array(12).fill(0));
 assert.deepEqual(input,{year:2028,hoursPerDay:0});
});

test('decimal daily workloads multiply as exact thousandths without accumulated floating tails',()=>{
 assert.deepEqual(calendar({hoursPerDay:12.345}).slice(0,4),[382.695,345.66,382.695,370.35]);
 assert.equal(calendar({hoursPerDay:.333})[0],10.323);
 assert.equal(calendar({hoursPerDay:.001})[0],.031);
 assert.equal(calendar({year:2028,hoursPerDay:.001})[1],.029);
});

test('a frozen input is accepted and every returned month list belongs to its caller',()=>{
 const input=Object.freeze({year:2027,hoursPerDay:12.345}),before=JSON.stringify(input),first=api.calendarMonthlyHours(input);
 first[0]=999;first.push(1);assert.equal(JSON.stringify(input),before);
 assert.equal(api.calendarMonthlyHours(input)[0],382.695);assert.equal(api.calendarMonthlyHours(input).length,12);
});

test('missing or invalid year and workload are errors rather than coerced or substituted values',()=>{
 assert.throws(()=>api.calendarMonthlyHours({hoursPerDay:24}),code('MAINTENANCE_YEAR'));
 for(const year of [null,'2027',true,1899,10000,2027.5])assert.throws(()=>calendar({year}),code('MAINTENANCE_YEAR'));
 assert.throws(()=>api.calendarMonthlyHours({year:2027}));
 for(const hoursPerDay of [null,'24',true,-.001,24.001,.0001,Infinity,NaN])assert.throws(()=>calendar({hoursPerDay}));
 assert.throws(()=>calendar({hoursPerDay:25}),code('MAINTENANCE_CALENDAR_HOURS'));
});

test('accessors, executable values, hidden fields, symbols, cycles and unknown fields are rejected',()=>{
 let executed=0;const getter={year:2027};Object.defineProperty(getter,'hoursPerDay',{enumerable:true,get(){executed++;return 24;}});
 assert.throws(()=>api.calendarMonthlyHours(getter));
 const hidden={year:2027,hoursPerDay:24};Object.defineProperty(hidden,'hidden',{value:1});
 const symbol={year:2027,hoursPerDay:24,[Symbol('hidden')]:1},cycle={year:2027,hoursPerDay:24};cycle.self=cycle;
 for(const input of [hidden,symbol,cycle,{year:2027,hoursPerDay:24,unknown:1},{year:2027,hoursPerDay:()=>24},new Date('2027-01-01')])assert.throws(()=>api.calendarMonthlyHours(input));
 assert.equal(executed,0);
});

test('browser UMD and CommonJS expose the same pure calendar calculation',()=>{
 const context=vm.createContext({});
 for(const file of ['platform-contracts','entity-identity','request-fingerprint','generator-maintenance'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/core',file+'.js'),'utf8'),context,{filename:file+'.js'});
 const result=context.GeneratorMaintenance.calendarMonthlyHours({year:2028,hoursPerDay:12.345});
 assert.deepEqual(JSON.parse(JSON.stringify(result)),calendar({year:2028,hoursPerDay:12.345}));
});

test('a calendar-derived monthly plan agrees with daily forecasting through leap and partial months',()=>{
 for(const year of [2027,2028])for(const hoursPerDay of [0,.333,12.345,24]){
  const input={startDate:year+'-01-16',endDate:year+'-12-31',currentHours:1000,intervalHours:300,firstDueHours:1300};
  const monthly=api.forecastOccurrences({...input,utilization:{mode:'monthly',hours:calendar({year,hoursPerDay})}});
  const daily=api.forecastOccurrences({...input,utilization:{mode:'daily',hours:hoursPerDay}});
  assert.deepEqual(monthly,daily);
 }
});
