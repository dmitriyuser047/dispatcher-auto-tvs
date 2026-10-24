'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const issue=require('../assets/core/issue-fuel.js'),commands=require('../assets/core/platform-commands.js'),documents=require('../assets/core/document-engine.js'),calendar=require('../assets/core/business-calendar.js');
const fixture=require('./fixtures/issue-fuel-v1-before-extraction.json');
const clone=value=>JSON.parse(JSON.stringify(value)),hash=text=>crypto.createHash('sha256').update(text).digest('hex');
function browser(){
 const context=vm.createContext({PlatformSchema:require('../assets/core/platform-schema.js'),WorkflowInspection:require('../assets/core/workflow-inspection.js'),RepairProcess:require('../assets/core/repair-process.js'),FuelOperations:require('../assets/core/fuel-operations.js'),ProcurementOperations:require('../assets/core/procurement-operations.js'),DomainSources:require('../assets/core/financial-recognition.js'),PersonnelPlanning:require('../assets/core/personnel-planning.js')});
 for(const name of ['platform-contracts','command-source','entity-identity','decimal-core','accounting-boundary','effective-periods','generator-fuel','business-calendar','document-state','fuel-engine','writeoff-engine','fuel-stock','fuel-movement-policy','issue-fuel','document-engine'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/core',name+'.js'),'utf8'),context,{filename:name+'.js'});
 Object.defineProperty(context,'PlatformCommands',{get(){throw Error('Document/fuel planning must not call the command dispatcher');}});
 return context;
}
for(const value of fixture.cases){
 test(value.target.section+' IssueFuel v1 retains the pre-extraction literal plan, source facts, property order and hash',()=>{
  const source=clone(fixture.source),before=JSON.stringify(source),direct=issue.plan(source,value.command,value.metadata),viaCommands=commands.plan(source,value.command,value.metadata);
  assert.equal(JSON.stringify(direct),value.serialized);assert.equal(hash(JSON.stringify(direct)),value.sha256);assert.equal(JSON.stringify(viaCommands),value.serialized);
  assert.deepEqual(issue.dependencies(value.command),commands.dependencies(value.command));assert.deepEqual(issue.footprint(value.command),commands.footprint(value.command));assert.equal(JSON.stringify(source),before);
  const journal=value.target.section==='vehicles'?'records':'genRecords';direct.sections[journal].at(-1).fuelIssued=999;assert.equal(JSON.stringify(source),before);
 });
 test(value.target.section+' posted document keeps historical preview fingerprint and the literal reciprocal journal under Node and browser',()=>{
  const context=browser(),source=clone(value.draftDatabase),before=JSON.stringify(source),review=documents.preview(source,value.postInput,{today:value.metadata.today}),browserReview=context.DocumentEngine.preview(source,value.postInput,{today:value.metadata.today});
  assert.equal(review.canPost,true,JSON.stringify(review.issues));assert.equal(browserReview.canPost,true,JSON.stringify(browserReview.issues));assert.equal(review.fingerprint,value.reviewFingerprint);assert.equal(browserReview.fingerprint,value.reviewFingerprint);
  const node=documents.plan(source,value.postInput,value.metadata),browserPlan=context.DocumentEngine.plan(source,value.postInput,value.metadata),browserIssue=context.IssueFuel.plan(fixture.source,value.command,value.metadata);
  assert.equal(JSON.stringify(node),value.postSerialized);assert.equal(hash(JSON.stringify(node)),value.postSha256);assert.equal(JSON.stringify(browserPlan),value.postSerialized);assert.equal(JSON.stringify(browserIssue),value.serialized);assert.equal(JSON.stringify(source),before);
  assert.equal(context.require,undefined);assert.equal(context.document,undefined);assert.equal(context.localStorage,undefined);
 });
}
test('direct fuel planning and dispatcher share metadata/source guards without executing accessors',()=>{
 const original=fixture.cases[0],source=clone(fixture.source);let getters=0;Object.defineProperty(source,'tanks',{get(){getters++;return [];}});
 for(const api of [issue,commands])assert.throws(()=>api.plan(source,original.command,original.metadata),{code:'INVALID_COMMAND_SOURCE',field:'tanks'});assert.equal(getters,0);
 for(const patch of [{now:'2026-02-30T12:00:00.000Z'},{now:'2026-10-22T26:00:00.000Z'},{today:'2026-02-30'},{actor:{id:'x',name:'',role:'admin'}},{id:'invalid operation id'},{readable:[3]},{calendar:{version:1,mode:'invalid',timeZone:'UTC',stamp:'invalid'}}]){
  const outcomes=[issue,commands].map(api=>{try{api.plan(fixture.source,original.command,{...original.metadata,...patch});return null;}catch(error){return{code:error.code,name:error.name,field:error.field,message:error.message,status:error.status};}});
  assert.notEqual(outcomes[0],null);assert.deepEqual(outcomes[0],outcomes[1]);
 }
});
test('direct fuel planning retains archived, ambiguous identity, closed period and conservation refusals',()=>{
 const original=fixture.cases[0];
 for(const change of [db=>{db.vehicles[0].archived=true;},db=>{db.vehicles.push({...db.vehicles[0],id:'0'});},db=>{db.tanks[0].balanceInit=1;},db=>{db.fuelPeriods=[{month:'2026-10',closed:true}];},db=>{db.vehicles[0].fuelGrade='АИ-92';}]){
  const source=clone(fixture.source);change(source);const before=JSON.stringify(source),outcomes=[issue,commands].map(api=>{try{api.plan(source,original.command,original.metadata);return null;}catch(error){return{code:error.code,issues:error.issues,field:error.field};}});
  assert.notEqual(outcomes[0],null);assert.deepEqual(outcomes[0],outcomes[1]);assert.equal(JSON.stringify(source),before);
 }
});
test('the narrow fuel planner checks the configured civil day and calendar stamp at both entry points',()=>{
 const source=clone(fixture.source),original=fixture.cases[0];source.appMeta=[{id:'business-calendar',kind:'businessCalendar',calendar:{version:1,timeZone:'Europe/Moscow'},history:[{operationId:'synthetic-calendar',reason:'Explicit synthetic calendar',at:'2026-10-22T12:00:00.000Z',actor:fixture.context.actor,previousTimeZone:'UTC',timeZone:'Europe/Moscow'}]}];
 const now='2026-10-22T21:30:00.000Z',clock=calendar.resolve(source,now);assert.equal(clock.today,'2026-10-23');
 for(const api of [issue,commands]){assert.throws(()=>api.plan(source,original.command,{...original.metadata,now}),{code:'CALENDAR_DATE_CHANGED'});assert.throws(()=>api.plan(source,original.command,{...original.metadata,now,today:clock.today,calendar:{...clock,stamp:'stale'}}),{code:'CALENDAR_CHANGED'});}
 const context={...original.metadata,now,today:clock.today,calendar:clock};assert.deepEqual(issue.plan(source,original.command,context),commands.plan(source,original.command,context));
});
