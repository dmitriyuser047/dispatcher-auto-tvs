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

test('a journal-only patch shares unchanged source arrays without relaxing checks on a replaced imported array',()=>{
 const value=fixture.cases.find(value=>value.profile==='vehicles'),plan=JSON.parse(value.serializedPlan),source={...clone(fixture.source),...plan.sections};
 source.parts=Array.from({length:2500},(_,id)=>({id,name:'Synthetic part '+id,note:'Unchanged source context'}));
 const next={...source,records:[...(source.records||[]),{id:'synthetic-unrelated-journal',vehicleId:'vehicle-fixture',date:'2026-11-11',km:0}]};
 assert.equal(next.parts,source.parts);assert.equal(next.vehicles,source.vehicles);assert.equal(planner.validateChanges(source,next),true);
 const replacement={...next,vehicles:clone(source.vehicles)};replacement.vehicles.find(row=>row.id==='vehicle-fixture').importProvenance.parser.version=99;
 assert.throws(()=>planner.validateChanges(source,replacement),{code:'IMPORT_PROOF'});
});
test('source and metadata boundaries reject executable input before either layer can evaluate it',()=>{
 const value=fixture.cases[0],decoded=clone(value.decoded);let calls=0;Object.defineProperty(decoded,'rows',{enumerable:true,get(){calls++;return [];}});
 for(const api of [planner,engine])assert.throws(()=>api.normalize(value.profile,decoded),{code:'IMPORT_JSON'});assert.equal(calls,0);
 assert.throws(()=>planner.prepare(fixture.source,value.input,{...value.context,today:'2026-10-23'}),{code:'IMPORT_CONTEXT'});
 assert.throws(()=>planner.prepare(fixture.source,value.input,{...value.context,importActions:[]}),{code:'ACCESS_DENIED'});
});

function legacyWholeImportGuard(){
 const file=path.join(__dirname,'../assets/core/import-planner.js'),original=fs.readFileSync(file,'utf8'),pattern=/let portable = false;[\s\S]*?if \(\(portable \|\| stable\(a\) !== stable\(b\)\) &&/;
 assert.match(original,pattern);const source=original.replace(pattern,'if (stable(a) !== stable(b) &&'),context=vm.createContext({module:{exports:{}},require:name=>require(path.join(__dirname,'../assets/core',name))});vm.runInContext(source,context,{filename:file});return context.module.exports;
}

test('strict portable journal edits compare source protection without changing provenance enforcement',()=>{
 const old=legacyWholeImportGuard(),rows=Array.from({length:2200},(_,id)=>({id,vehicleId:0,date:'2026-09-01',km:25,note:'Synthetic '+id})),before={records:rows},after={records:clone(rows)};after.records[2199].note='Changed descriptive field';
 assert.equal(planner.validateChanges(before,after),true);assert.equal(old.validateChanges(before,after),true);
 for(const [name,a,b]of [['records',{id:0,importProvenance:{sourceId:'old'}},{id:0,importProvenance:{sourceId:'forged'}}],['fuelPurchases',{id:0,importKeyV3:'one'},{id:0,importKeyV3:'two'}],['fuelPeriods',{month:'2026-09',recon:{provider:{importSource:{id:'old'}}}},{month:'2026-09',recon:{provider:{importSource:{id:'new'}}}}],['fuelImports',{id:0,note:'old'},{id:0,note:'new'}]]){
  const bytes=JSON.stringify([a,b]);assert.throws(()=>planner.validateChanges({[name]:[a]},{[name]:[b]}),{code:'IMPORT_PROOF'});assert.throws(()=>old.validateChanges({[name]:[a]},{[name]:[b]}),{code:'IMPORT_PROOF'});assert.equal(JSON.stringify([a,b]),bytes);
 }
});

test('nonportable import guard inputs retain legacy stable-first results and getter evaluation counts',()=>{
 const old=legacyWholeImportGuard(),result=(api,create)=>{const value=create();try{return {ok:api.validateChanges(value.before,value.after),calls:value.calls?.()||0};}catch(error){return {name:error.name,code:error.code,message:error.message,calls:value.calls?.()||0};}};
 const cases=[
  ()=>{let calls=0;const a={id:0},b={id:0};Object.defineProperty(a,'note',{enumerable:true,get(){calls++;return 'one';}});Object.defineProperty(b,'note',{enumerable:true,get(){calls++;return 'two';}});return {before:{records:[a]},after:{records:[b]},calls:()=>calls};},
  ()=>{let calls=0;const a={id:0},b={id:0};Object.defineProperty(a,'importProvenance',{enumerable:true,get(){calls++;return {sourceId:'one'};}});Object.defineProperty(b,'importProvenance',{enumerable:true,get(){calls++;return {sourceId:'two'};}});return {before:{records:[a]},after:{records:[b]},calls:()=>calls};},
  ()=>{const a={id:0},b={id:0};a.cycle=a;b.cycle=b;return {before:{records:[a]},after:{records:[b]}};},
  ()=>({before:{records:[{id:0,km:NaN,unknown:undefined}]},after:{records:[{id:0,km:Infinity,unknown:undefined}]}}),
  ()=>({before:{records:[{id:0,note:1n}]},after:{records:[{id:0,note:2n}]}}),
  ()=>({before:{records:[{id:0,note:()=>1}]},after:{records:[{id:0,note:()=>2}]}}),
  ()=>({before:{records:[,{id:0}]},after:{records:[null,{id:0}]}}),
  ()=>({before:{records:[{id:0,date:new Date('2026-09-01T00:00:00Z')}]},after:{records:[{id:0,date:new Date('2026-10-01T00:00:00Z')}]}}),
  ()=>{const a={id:0},b={id:0};Object.defineProperty(a,'hidden',{value:1});Object.defineProperty(b,'hidden',{value:2});return {before:{records:[a]},after:{records:[b]}};},
 ];
 for(const create of cases)assert.deepEqual(result(planner,create),result(old,create));
});
