'use strict';
// Pure scheduling helpers, synthetic rows only. No storage, profiles or clock.
const {test}=require('node:test'),assert=require('node:assert/strict');
const api=require('../assets/core/generator-maintenance.js');
const planRow=(id=0,extra={})=>({id,generatorId:0,site:'SYNTHETIC SITE',type:'ТО-1',plannedHours:0,plannedDate:'2026-01-05',work:'SYNTHETIC SERVICE',note:'SYNTHETIC NOTE',components:[{partId:0,qty:2},{partId:'0',qty:null}],...extra});
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
const code=expected=>error=>error.code===expected;

test('grouping and expansion preserve interleaved original order, every typed ID and literal fields',()=>{
 const rows=[planRow(0),planRow('0',{generatorId:'0',site:'OTHER SITE'}),planRow('second-number',{plannedDate:'2026-02-05',plannedHours:null}),planRow('other-work',{work:'DIFFERENT WORK'}),planRow('third-number',{plannedDate:'2026-03-05',plannedHours:250})];
 const groups=api.groupCalendarRows(rows);assert.equal(groups.length,3);assert.deepEqual(groups[0].occurrences.map(entry=>entry.id),[0,'second-number','third-number']);assert.equal(groups[0].template.generatorId,0);assert.equal(groups[1].template.generatorId,'0');assert.deepEqual(api.expandCalendarGroups(groups),rows);
 assert.deepEqual(api.expandCalendarGroups(groups.slice().reverse()),rows);
});

test('templates group only exact common fields, component order, typed part IDs and quantities',()=>{
 const variants=[{}, {generatorId:'0'}, {site:'synthetic site'}, {type:'ТО-2'}, {work:'SYNTHETIC SERVICE '}, {note:'OTHER NOTE'}, {components:[{partId:0,qty:null},{partId:'0',qty:null}]}, {components:[{partId:'0',qty:2},{partId:0,qty:null}]}, {components:[{partId:'0',qty:null},{partId:0,qty:2}]}];
 const rows=variants.map((variant,index)=>planRow(index,variant)),groups=api.groupCalendarRows(rows);assert.equal(groups.length,rows.length);assert.deepEqual(api.expandCalendarGroups(groups),rows);
 const datesOnly=[planRow(0),planRow('same',{plannedHours:null,plannedDate:'2030-12-31'})];assert.equal(api.groupCalendarRows(datesOnly).length,1);
});

test('multiple events in the same month or day, blank dates and dates outside the selected plan year never disappear',()=>{
 const rows=[planRow(0),planRow('0'),planRow('same-month',{plannedDate:'2026-01-20',plannedHours:250}),planRow('unplanned',{plannedDate:'',plannedHours:null}),planRow('other-year',{plannedDate:'2029-09-15',plannedHours:0})],groups=api.groupCalendarRows(rows);
 assert.equal(groups.length,1);assert.equal(groups[0].occurrences.length,5);assert.deepEqual(groups[0].occurrences.map(entry=>[typeof entry.id,entry.id,entry.plannedDate,entry.plannedHours]),rows.map(entry=>[typeof entry.id,entry.id,entry.plannedDate,entry.plannedHours]));assert.deepEqual(api.expandCalendarGroups(groups),rows);
});

test('fresh occurrences append after retained source rows while preserving all original row IDs',()=>{
 const rows=[planRow(0),planRow('other',{generatorId:'0'}),planRow('later',{plannedDate:'2026-02-05'})],groups=api.groupCalendarRows(rows);
 groups[0].occurrences.push({id:'new',plannedDate:'2026-03-05',plannedHours:null});
 groups.push({template:{...groups[0].template,generatorId:'new-generator'},occurrences:[{id:'new-group',plannedDate:'',plannedHours:0}]});
 const expanded=api.expandCalendarGroups(groups);assert.deepEqual(expanded.slice(0,rows.length),rows);assert.deepEqual(expanded.map(row=>row.id),[0,'other','later','new','new-group']);assert.equal(Object.hasOwn(expanded[0],'sourceIndex'),false);
 groups[0].occurrences=groups[0].occurrences.filter(entry=>entry.id!==0);assert.deepEqual(api.expandCalendarGroups(groups).map(row=>row.id),['other','later','new','new-group']);
});

test('calendar helpers accept frozen inputs and return owned editable templates, occurrences and per-event component lists',()=>{
 const rows=freeze([planRow(0),planRow('next',{plannedDate:'2026-02-05'})]),before=JSON.stringify(rows),groups=api.groupCalendarRows(rows);groups[0].template.components[0].qty=7;groups[0].occurrences[0].plannedHours=25;assert.equal(JSON.stringify(rows),before);
 const frozen=freeze(api.groupCalendarRows(rows)),snapshot=JSON.stringify(frozen),expanded=api.expandCalendarGroups(frozen);expanded[0].components[0].qty=99;assert.equal(expanded[1].components[0].qty,2);assert.equal(JSON.stringify(frozen),snapshot);
 const monthly=freeze({year:2026,months:[1,3],day:5,ids:[0,'0'],plannedHours:[0,null]}),monthlyBefore=JSON.stringify(monthly);api.monthlyOccurrences(monthly)[0].plannedDate='2027-01-01';assert.equal(JSON.stringify(monthly),monthlyBefore);
});

test('batch dates come only from explicitly selected months, day, year and IDs; missing absolute hours remain null',()=>{
 const result=api.monthlyOccurrences({year:2026,months:[12,1,9],day:5,ids:[0,'0','last']});assert.deepEqual(result,[{id:0,plannedDate:'2026-12-05',plannedHours:null},{id:'0',plannedDate:'2026-01-05',plannedHours:null},{id:'last',plannedDate:'2026-09-05',plannedHours:null}]);
 assert.deepEqual(api.monthlyOccurrences({year:2026,months:[1,2],day:1,ids:['first','second'],plannedHours:[0,250.125]}).map(row=>row.plannedHours),[0,250.125]);
 assert.deepEqual(api.monthlyOccurrences({year:2026,months:[],day:1,ids:[]}),[]);
});

test('nonexistent month days are rejected without February or short-month clamping',()=>{
 for(const input of [{year:2026,months:[2],day:29,ids:['nonleap']},{year:1900,months:[2],day:29,ids:['century']},{year:2026,months:[4],day:31,ids:['april']},{year:2026,months:[1,2],day:30,ids:['jan','feb']}])assert.throws(()=>api.monthlyOccurrences(input),code('MAINTENANCE_DATE'));
 assert.equal(api.monthlyOccurrences({year:2000,months:[2],day:29,ids:['leap-century']})[0].plannedDate,'2000-02-29');assert.equal(api.monthlyOccurrences({year:2028,months:[2],day:29,ids:['leap']})[0].plannedDate,'2028-02-29');
});

test('malformed monthly selections, duplicate IDs and invented numeric conversions fail before creating rows',()=>{
 const valid={year:2026,months:[1,2],day:5,ids:[0,'0']};
 for(const months of [[0],[13],['1'],[1.5],[1,1],Array.from({length:13},(_,index)=>index+1)])assert.throws(()=>api.monthlyOccurrences({...valid,months}));
 for(const year of ['2026',null,1899,10000,2026.5])assert.throws(()=>api.monthlyOccurrences({...valid,year}));for(const day of ['5',null,0,32,5.5])assert.throws(()=>api.monthlyOccurrences({...valid,day}));
 for(const ids of [[],[0],[0,0],[false,'ok'],['','ok']])assert.throws(()=>api.monthlyOccurrences({...valid,ids}));
 for(const plannedHours of [null,[],[0],['250',null],[-1,null],[true,null],[250.0001,null]])assert.throws(()=>api.monthlyOccurrences({...valid,plannedHours}));
});

test('ambiguous occurrence IDs, source order and empty unsaved templates are explicit errors',()=>{
 const groups=api.groupCalendarRows([planRow(0),planRow('0')]);
 for(const mutate of [value=>value[0].occurrences[1].id=0,value=>value[0].occurrences[1].sourceIndex=0,value=>value[0].occurrences[1].sourceIndex=-1,value=>value[0].occurrences[1].sourceIndex=null,value=>value[0].occurrences=[],value=>value[0].occurrences[1].plannedDate='2026-02-30',value=>value[0].template.unknown='discarded']){const input=structuredClone(groups);mutate(input);assert.throws(()=>api.expandCalendarGroups(input));}
 assert.deepEqual(api.groupCalendarRows([]),[]);assert.deepEqual(api.expandCalendarGroups([]),[]);
 const collision=structuredClone(groups);collision[0].occurrences.push({id:'0',plannedDate:'2026-03-05',plannedHours:null});assert.throws(()=>api.expandCalendarGroups(collision),code('MAINTENANCE_ROW_ID'));
});

test('executable, hidden, cyclic and accessor inputs are rejected without running caller code',()=>{
 let executed=0;const getter=planRow();Object.defineProperty(getter,'components',{get(){executed++;return [];},enumerable:true});assert.throws(()=>api.groupCalendarRows([getter]));
 const batch={year:2026,months:[1],day:5,ids:['x']};Object.defineProperty(batch,'plannedHours',{get(){executed++;return [1];},enumerable:true});assert.throws(()=>api.monthlyOccurrences(batch));
 const groups=api.groupCalendarRows([planRow()]);Object.defineProperty(groups[0].template,'toJSON',{value(){executed++;return {};},enumerable:false});assert.throws(()=>api.expandCalendarGroups(groups));
 const cycle=[];cycle.push(cycle);assert.throws(()=>api.expandCalendarGroups(cycle));assert.equal(executed,0);
});

test('150 DES templates expand to 1800 canonical occurrences and regroup without losing a date, hour or component',()=>{
 const groups=Array.from({length:150},(_,index)=>({template:{generatorId:'synthetic-'+index,site:'site-'+index,type:'ТО-1',work:'SYNTHETIC WORK',note:'',components:[{partId:'part-'+index,qty:2}]},occurrences:api.monthlyOccurrences({year:2027,months:[1,2,3,4,5,6,7,8,9,10,11,12],day:5,ids:Array.from({length:12},(_,month)=>'synthetic-'+index+'-'+month)})}));
 const expanded=api.expandCalendarGroups(groups);assert.equal(expanded.length,1800);assert.equal(new Set(expanded.map(row=>row.id)).size,1800);assert.ok(expanded.every(row=>row.plannedHours===null));assert.equal(expanded.filter(row=>row.generatorId==='synthetic-0').length,12);assert.deepEqual(api.expandCalendarGroups(api.groupCalendarRows(expanded)),expanded);assert.equal(groups[0].occurrences.length,12);
});
