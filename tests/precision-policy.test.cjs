'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const policy=require('../assets/core/precision-policy.js'),schema=require('../assets/core/platform-schema.js'),kernel=require('../assets/core/platform-kernel.js');
const clone=value=>structuredClone(value),issue=code=>error=>!!(error.code===code||error.issues?.some(issue=>issue.code===code)||error.details?.issues?.some(issue=>issue.code===code));
function put(row,field,value){const fields=field.split('.');for(let index=0;index<fields.length;index++){const part=fields[index],many=part.endsWith('[]'),key=many?part.slice(0,-2):part;if(index===fields.length-1){row[key]=value;return;}if(many){row[key]??=[{}];row=row[key][0];}else row=row[key]??={};}}

test('every catalogued persisted quantity, money and rate has an explicit finite scale and magnitude boundary',()=>{
 assert.equal(policy.maximum,'1000000000000');let fields=0;
 for(const [section,specs]of Object.entries(policy.specs))for(const spec of specs){
  assert.ok(schema.sections.includes(section));const row={id:'synthetic-field'},old={id:'synthetic-field'};put(row,spec.field,Number('1.'+'0'.repeat(spec.scale)+'1'));
  assert.throws(()=>policy.validateChanges({[section]:[old]},{[section]:[row]}),issue('NUMERIC_PRECISION'),section+'.'+spec.field);fields++;
 }
 assert.ok(fields>100);
 for(const [field,value]of [['amount',1e12+0.01],['amount',Infinity],['amount',NaN],['amount',{}]])assert.throws(()=>policy.validateChanges({},{costEntries:[{id:'range',[field]:value}]}));
 for(const value of [Infinity,-Infinity,NaN])assert.throws(()=>policy.validateChanges({costEntries:[{id:'range',amount:null}]},{costEntries:[{id:'range',amount:value}]}),issue('NUMERIC_FORMAT'));
 assert.equal(policy.validateChanges({},{costEntries:[{id:'max',amount:1e12}],costProfiles:[{id:'rate',salaryRate:999999999999.1234}]}),true,'No accidental safe-scaled-integer limit for rates');
});

test('unchanged legacy precision remains editable by field delta, including nested sources, duplicate and typed identities',()=>{
 const before={records:[{id:7,vehicleId:'v',fuelIssued:1.0001},{id:'7',vehicleId:'v',fuelIssued:2.0001},{id:'dup',fuelIssued:3.0001},{id:'dup',fuelIssued:4.0001}],vehicles:[{id:'v',fuelBalance:923.5371,fuelBalanceSources:[{org:'A',grade:'ДТ',qty:923.5371}]}]},after=clone(before),raw=JSON.stringify(before);
 after.records.reverse();after.records[3].note='Description only';after.vehicles[0].note='Legacy note';assert.equal(policy.validateChanges(before,after),true);assert.equal(JSON.stringify(before),raw);
 after.records[3].fuelIssued=1.0002;assert.throws(()=>policy.validateChanges(before,after),issue('NUMERIC_PRECISION'));
 assert.equal(policy.validateChanges(before,{...before,records:[...before.records.map(row=>({...row,note:'Comment'})),{id:'new',fuelIssued:0.001}]}),true);
 assert.throws(()=>policy.validateChanges(before,{...before,records:[...before.records,{id:'new',fuelIssued:0.0001}]}),issue('NUMERIC_PRECISION'));
 assert.ok(policy.inspect(before).issues.some(row=>row.code==='NUMERIC_PRECISION'));
 assert.equal(policy.inspect(before,{readable:['payments']}).issues.length,0);
});

test('new opening allocations must conserve exact litres while old mismatches remain diagnosable and comment-editable',()=>{
 const anchor=(opening,sources)=>({id:'v',fuelAccounting:{version:1,from:'2026-09-01',opening,basis:'Synthetic',sources}}),sources=[{org:'A',grade:'ДТ',qty:923},{org:'B',grade:'ДТ',qty:0.537}];
 assert.equal(policy.validateChanges({},{vehicles:[anchor(923.537,sources)]}),true);
 for(const section of ['vehicles','generators','tanks'])assert.throws(()=>policy.validateChanges({},{[section]:[anchor(1,[{org:'A',grade:'ДТ',qty:1.001}])]}),issue('NUMERIC_ALLOCATION_TOTAL'));
 assert.throws(()=>policy.validateChanges({},{vehicles:[{id:'v',fuelBalance:1,fuelBalanceSources:[{org:'A',grade:'ДТ',qty:1.001}]}]}),issue('NUMERIC_ALLOCATION_TOTAL'));
 const before={vehicles:[anchor(1,[{org:'A',grade:'ДТ',qty:1.001}])]},after=clone(before);after.vehicles[0].note='Preserve legacy';assert.equal(policy.validateChanges(before,after),true);assert.ok(policy.inspect(before).issues.some(row=>row.code==='NUMERIC_ALLOCATION_TOTAL'));
 after.vehicles[0].fuelAccounting.sources[0].org='B';assert.throws(()=>policy.validateChanges(before,after),issue('NUMERIC_ALLOCATION_TOTAL'));
});

test('changed complete tax groups reconcile explicit document amounts without guessing VAT from its rate',()=>{
 const good={id:'tax',sum:1.03,vatAmount:0.22,grossSum:1.25,vatRate:20};assert.equal(policy.validateChanges({},{tankIncomes:[good]}),true);
 const mismatch={...good,grossSum:1.24};assert.throws(()=>policy.validateChanges({},{tankIncomes:[mismatch]}),issue('NUMERIC_TAX_TOTAL'));assert.equal(policy.validateChanges({tankIncomes:[mismatch]},{tankIncomes:[{...mismatch,note:'Keep legacy primary facts'}]}),true);assert.ok(policy.inspect({tankIncomes:[mismatch]}).issues.some(row=>row.code==='NUMERIC_TAX_TOTAL'));
 assert.equal(policy.validateChanges({},{tankIncomes:[{...good,sum:null}]}),true);assert.equal(policy.validateChanges({},{tankIncomes:[{...good,sum:-1.03}]}),true);
});

test('the shared kernel enforces new field precision without normalizing either snapshot',()=>{
 const before={vehicles:[{id:'v',plate:'SYNTHETIC',fuelBalance:923.5371}],records:[]},context={id:'precision',identity:'temp-profile',actor:{id:'a',name:'Synthetic',role:'admin'},now:'2026-10-22T12:00:00.000Z',readable:schema.sections,writable:schema.sections,revisions:{}},raw=JSON.stringify(before);
 assert.equal(kernel.prepare(before,{vehicles:[{...before.vehicles[0],note:'Comment'}]},context).changed[0],'vehicles');
 assert.throws(()=>kernel.prepare(before,{vehicles:[{...before.vehicles[0],fuelBalance:923.5372}]},context),issue('NUMERIC_PRECISION'));assert.equal(JSON.stringify(before),raw);
});

test('browser precision checks use the same catalog, errors and fail-closed Decimal dependency',()=>{
 const browser=vm.createContext({});for(const file of ['platform-schema.js','decimal-core.js','precision-policy.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/core',file),'utf8'),browser);
 const sample={records:[{id:7,fuelIssued:923.5371}]};assert.deepEqual(JSON.parse(JSON.stringify(browser.PrecisionPolicy.inspect(sample))),policy.inspect(sample));
 const missing=vm.createContext({});for(const file of ['platform-schema.js','precision-policy.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/core',file),'utf8'),missing);
 assert.throws(()=>missing.PrecisionPolicy.validateChanges({},sample),{code:'MODULE_UNAVAILABLE'});
});

test('read-only health exposes legacy precision by section, record and field without values or unreadable finance',()=>{
 const integrity=require('../assets/core/platform-integrity.js'),db={records:[{id:'r',fuelIssued:0.0004}],payments:[{id:'private',sum:998877.6655}]},visible=integrity.inspect(db,{readable:['records']});
 const issue=visible.issues.find(row=>row.code==='NUMERIC_PRECISION');assert.ok(issue);assert.equal(issue.recordId,'r');assert.equal(issue.field,'fuelIssued');assert.equal(Object.hasOwn(issue,'value'),false);assert.doesNotMatch(JSON.stringify(visible),/998877|private/);
 const cycle={};cycle.self=cycle;const broken=policy.inspect({records:[{id:cycle,fuelIssued:Infinity,fuelActual:cycle}]});assert.equal(broken.issues.length,2);assert.doesNotThrow(()=>JSON.stringify(broken));assert.ok(broken.issues.every(row=>row.recordId===''));
});
