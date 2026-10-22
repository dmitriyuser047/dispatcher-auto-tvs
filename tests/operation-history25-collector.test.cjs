'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const schema=require('../assets/core/platform-schema.js'),commands=require('../electron/command-service.cjs'),records=require('../electron/operation-record.cjs');
const db=extra=>({...Object.fromEntries(schema.sections.map(name=>[name,[]])),...extra});
test('the actual command collector seals both typed targets and contributing rows without conflating zero identifiers',()=>{
 const database=db({vehicles:[{id:0,org:'A'},{id:'0',org:'B'}],tanks:[{id:22,org:'A'}],records:[{id:'numeric',vehicleId:0},{id:'text',vehicleId:'0'}]}),command={type:'IssueFuel',input:{tankId:22,target:{section:'vehicles',id:0},date:'2026-09-01'}},value=commands.collectCommandEvidence(database,command,['vehicles','records','tanks']);
 assert.equal(value.complete,true);assert.ok(value.selectedTargets.some(row=>row.section==='vehicles'&&row.id===0));assert.ok(value.selectedTargets.some(row=>row.section==='tanks'&&row.id===22));assert.ok(value.selectedTargets.some(row=>row.section==='records'&&row.id==='numeric'));assert.equal(value.selectedTargets.some(row=>row.id==='text'||row.id==='0'),false);
});
test('idless natural period rows are captured literally without assigning a replacement identifier',()=>{
 const row={month:'2026-09',flags:{fuel:true},recon:{provider:{litres:0,sum:null}}},value=commands.collectCommandEvidence(db({fuelPeriods:[row]}),{type:'PeriodAction',input:{month:'2026-09'}},['fuelPeriods']);
 assert.equal(value.complete,true);assert.deepEqual(value.selectedTargets,[{section:'fuelPeriods',before:row,after:null}]);assert.equal(Object.hasOwn(value.selectedTargets[0],'id'),false);
});
test('missing dependency references remain explicit incomplete evidence while the strict authorization path rejects them',()=>{
 const database=db({vehicles:[{id:0,driverId:'missing'}]}),command={type:'AcceptShift',input:{vehicleId:0}},dependencies=['vehicles','drivers'];
 assert.throws(()=>commands.collectCommandEvidence(database,command,dependencies),{code:'ACCESS_DENIED'});const result=commands.collectCommandEvidence(database,command,dependencies,{strict:false});assert.equal(result.complete,false);assert.ok(result.selectedTargets.some(row=>row.section==='drivers'&&row.id==='missing'));assert.equal(database.drivers.length,0);
});
function receipt(){return {id:0,source:'platform',type:'transaction',operationId:'synthetic-literal',requestDigest:'sha256:'+'a'.repeat(64),databaseToken:'synthetic-origin-token',actorId:'synthetic-actor',actorRole:'admin',actor:'Original actor',at:'2026-09-01T10:00:00+03:00',changedSections:['vehicles'],revisions:{vehicles:3,auditLog:7},archiveScope:{version:1,rows:[{section:'vehicles',row:{id:0,org:'PRIVATE-ORIGINAL'}}]}};}
test('compact metadata preserves original time, origin, typed zero and actor while excluding private scope rows',()=>{const original=receipt(),value=records.fromAuditRow(original);assert.equal(value.result.id,0);assert.equal(value.at,original.at);assert.equal(value.operation.databaseToken,original.databaseToken);assert.equal(value.result.actor,original.actor);assert.doesNotMatch(JSON.stringify(value),/PRIVATE-ORIGINAL|archiveScope/);assert.equal(original.archiveScope.rows.length,1);});
test('unproven literal metadata cannot create a receipt through coercion or an invented clock',()=>{for(const patch of [{at:12345},{actorId:0},{actorRole:'unknown'},{requestDigest:'wrong'},{changedSections:['vehicles','vehicles']},{databaseToken:''}])assert.throws(()=>records.fromAuditRow({...receipt(),...patch}));let called=false;const row=receipt();Object.defineProperty(row,'actorId',{get(){called=true;return'secret';},enumerable:true});assert.throws(()=>records.fromAuditRow(row));assert.equal(called,false);});
