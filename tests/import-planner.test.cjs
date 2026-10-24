'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const planner=require('../assets/core/import-planner.js'),engine=require('../assets/core/import-engine.js'),fixture=require('./fixtures/import-v1-before-planner-extraction.json');
const clone=value=>JSON.parse(JSON.stringify(value)),hash=text=>crypto.createHash('sha256').update(text).digest('hex');
function browser(){
 const context=vm.createContext({});
 for(const name of ['platform-contracts','platform-schema','entity-identity','decimal-core','accounting-boundary','effective-periods','business-calendar','document-state','fuel-engine','writeoff-engine','import-planner'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/core',name+'.js'),'utf8'),context,{filename:name+'.js'});
 for(const name of ['PlatformPolicies','ImportEngine','PlatformCommands'])Object.defineProperty(context,name,{get(){throw Error('Lower import planning cannot invoke '+name);}});
 return context;
}
for(const value of fixture.cases)test(value.profile+' normalization, preview, plan and provenance retain literal pre-extraction bytes and fingerprints',()=>{
 const source=clone(fixture.source),before=JSON.stringify(source),prepared=planner.prepare(source,value.input,value.context),review=engine.preview(source,value.input,value.context),plan=engine.plan(source,value.action,value.context);
 assert.equal(JSON.stringify(planner.normalize(value.profile,value.decoded)),value.normalizedSource);assert.equal(JSON.stringify(engine.normalize(value.profile,value.decoded)),value.normalizedSource);
 assert.equal(JSON.stringify(prepared.review),value.serializedPreview);assert.equal(JSON.stringify(review),value.serializedPreview);assert.equal(hash(JSON.stringify(review)),value.previewHash);assert.equal(review.fingerprint,value.fingerprint);
 assert.equal(JSON.stringify(plan),value.serializedPlan);assert.equal(hash(JSON.stringify(plan)),value.planHash);assert.deepEqual(planner.dependencies(value.input),engine.dependencies(value.input));assert.deepEqual(planner.footprint(value.input),engine.footprint(value.input));
 const next={...source,...plan.sections},context={...value.context,commandIntent:{command:{type:'ImportAction',version:1,input:value.action}}};assert.equal(planner.validateChanges(source,next,context),true);assert.equal(engine.validateChanges(source,next,context),true);
 assert.equal(JSON.stringify(source),before);assert.ok(Object.isFrozen(prepared)&&Object.isFrozen(prepared.context)&&Object.isFrozen(prepared.review.sections));
});
test('the lower browser planner reconstructs source facts and provenance with no workflow, command or policy facade',()=>{
 const context=browser();
 for(const value of fixture.cases){const prepared=context.ImportPlanner.prepare(fixture.source,value.input,value.context);assert.equal(JSON.stringify(prepared.review),value.serializedPreview);const plan=JSON.parse(value.serializedPlan);assert.equal(context.ImportPlanner.validateChanges(fixture.source,{...fixture.source,...plan.sections},{...value.context,commandIntent:{command:{type:'ImportAction',version:1,input:value.action}}}),true);}
 assert.equal(context.document,undefined);assert.equal(context.require,undefined);assert.equal(context.localStorage,undefined);
});
test('workflow preflight still enforces closed accounting periods over a structurally valid lower import plan',()=>{
 const value=fixture.cases.find(value=>value.profile==='glonass'),source=clone(fixture.source);source.fuelPeriods=[{month:'2026-10',closed:true}];
 const prepared=planner.prepare(source,value.input,value.context),review=engine.preview(source,value.input,value.context);assert.equal(prepared.review.canApply,true);assert.equal(review.canApply,false);assert.ok(review.blockers.some(issue=>issue.code==='PERIOD_CLOSED'));assert.equal(review.fingerprint,prepared.review.fingerprint);
 assert.throws(()=>engine.plan(source,{...value.input,reviewFingerprint:review.fingerprint},value.context),{code:'IMPORT_BLOCKED'});
});
test('raw edits cannot forge, rewrite or remove lower-planner source provenance',()=>{
 const value=fixture.cases.find(value=>value.profile==='vehicles'),plan=JSON.parse(value.serializedPlan),source={...clone(fixture.source),...plan.sections};
 for(const change of [next=>{next.vehicles.find(row=>row.id==='vehicle-fixture').importProvenance.parser.version=99;},next=>{next.vehicles=next.vehicles.filter(row=>row.id!=='vehicle-fixture');}]){const next=clone(source);change(next);assert.throws(()=>planner.validateChanges(source,next),{code:'IMPORT_PROOF'});assert.throws(()=>engine.validateChanges(source,next),{code:'IMPORT_PROOF'});}
 const unchanged=clone(source);unchanged.vehicles.find(row=>row.id==='vehicle-fixture').note='Descriptive correction';assert.equal(planner.validateChanges(source,unchanged),true);
});
test('source and metadata boundaries reject executable input before either layer can evaluate it',()=>{
 const value=fixture.cases[0],decoded=clone(value.decoded);let calls=0;Object.defineProperty(decoded,'rows',{enumerable:true,get(){calls++;return [];}});
 for(const api of [planner,engine])assert.throws(()=>api.normalize(value.profile,decoded),{code:'IMPORT_JSON'});assert.equal(calls,0);
 assert.throws(()=>planner.prepare(fixture.source,value.input,{...value.context,today:'2026-10-23'}),{code:'IMPORT_CONTEXT'});
 assert.throws(()=>planner.prepare(fixture.source,value.input,{...value.context,importActions:[]}),{code:'ACCESS_DENIED'});
});
