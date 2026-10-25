'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const evidence=require('../electron/operation-evidence.cjs'),schema=require('../assets/core/platform-schema.js'),scope=require('../assets/core/access-scope.js'),policy=require('../assets/core/access-policy.js'),access=require('../electron/access-context.cjs');
const actor={id:'guard-author',name:'Synthetic author',role:'admin'},any={any:true},clone=structuredClone;
const database=vehicles=>({...Object.fromEntries(schema.sections.map(name=>[name,[]])),vehicles});
const owner=org=>({org:{state:'known',value:org},site:{state:'known',value:'Site'}});
const required=org=>({sections:['vehicles'],owners:[owner(org)],complete:true});
const guard=(tokens,deniedValue)=>({path:tokens,requires:required('B'),...(deniedValue===undefined?{}:{deniedValue})});
const principal=(orgs,more={})=>({...actor,accessPolicy:{version:1,grants:orgs.map(org=>({org,site:any}))},...more});
function request(before,after=before,{write=false,targets=[{section:'vehicles',id:0}]}={}){
 const events=write?[{id:'guard-event',operationId:'guard-op',source:'platform',section:'vehicles',type:'update',fields:['note'],before:before.vehicles[0],after:after.vehicles[0]}]:[];
 return {previous:before,next:after,principal:actor,mode:'transaction',sections:{complete:true,readSections:['vehicles'],writeSections:write?['vehicles']:[],selectedTargets:targets},receipt:{operation:{id:'guard-op',digest:'sha256:'+'a'.repeat(64),actorId:actor.id,actorRole:actor.role,databaseToken:'guard-token'},changedSections:write?['vehicles']:[]},events};
}
// A fresh module allows the trusted resolver to return precise test facts,
// without changing global modules, production exports or the policy validator.
function instrument(guards,{payloadIdentity=false,composites=false}={}){
 const filename=require.resolve('../electron/operation-evidence.cjs'),local=Module.createRequire(filename),instance=new Module(filename,module),recorded=[];
 const decorated={...scope,createResolver(db){const real=scope.createResolver(db);return {...real,resolve(name,row,...rest){const facts=real.resolve(name,row,...rest);if(name!=='vehicles')return facts;const result={...facts,fieldGuards:clone(typeof guards==='function'?guards(row):guards)};recorded.push({row:clone(row),facts:clone(result)});return result;},...(composites?{resolveSource(value){return {...real.resolveSource(value),fieldGuards:clone(guards)};},resolveArchive(value){return {...real.resolveArchive(value),fieldGuards:clone(guards)};}}:{})};}};
 instance.filename=filename;instance.paths=Module._nodeModulePaths(path.dirname(filename));instance.require=id=>id===path.join(path.dirname(filename),'../assets/core/access-scope.js')||id===require.resolve('../assets/core/access-scope.js')?decorated:id===require.resolve('../assets/core/platform-schema.js')&&payloadIdentity?{...schema,descriptors:{...schema.descriptors,vehicles:{...schema.descriptors.vehicles,identity:{...schema.descriptors.vehicles.identity,composite:['payload']}}}}:local(id);
 instance._compile(fs.readFileSync(filename,'utf8'),filename);return {api:instance.exports,recorded};
}
function projection(current,row,facts){const context=access.create(database([]),database([]),current);return policy.projectRows(context.policy,'vehicles',[row],{...context.context,resolve:()=>facts});}
function expanded(proof,before,after,guards){const original=clone(proof);for(const item of original.request.selectedTargets){if(item.kind&&item.kind!=='row')continue;for(const phase of ['before','after'])if(item[phase]!==null){const row=(phase==='before'?before:after).vehicles.find(row=>row.id===item[phase].id);item[phase+'Facts']={...scope.createResolver(phase==='before'?before:after).resolve('vehicles',row),fieldGuards:clone(typeof guards==='function'?guards(row):guards)};}}return original;}

test('absent selected guards shrink proof while grants, current fields and ownership authorize identically',()=>{
 const guards=[guard(['importProvenance'])],{api,recorded}=instrument(guards),db=database([{id:0,org:'A',site:'Site',importProvenance:{secret:'Never in this fragment'}}]),proof=api.createProof(request(db)),original=expanded(proof,db,db,guards),current=principal(['A']),matrix=[actor,current,principal(['A','B']),principal(['B']),principal([]),{...actor,id:'other'},{...actor,role:'viewer'},{...actor,readable:['auditLog']},principal(['A'],{readFields:{vehicles:['id']}}),principal(['A'],{accessPolicy:{version:1,grants:[{org:'A',site:any}],sections:{vehicles:{readFields:['id','org','site']}}}})];
 assert.deepEqual(proof.request.selectedTargets[0].before,{id:0});assert.deepEqual(proof.request.selectedTargets[0].beforeFacts.fieldGuards,[]);assert.equal(recorded[0].facts.fieldGuards.length,1,'Original resolver facts are not mutated');
 assert.ok(Buffer.byteLength(JSON.stringify(proof))<Buffer.byteLength(JSON.stringify(original)));api.validateProof(JSON.parse(JSON.stringify(proof)));evidence.validateProof(original);
 for(const who of matrix){assert.equal(api.authorizeProof(proof,who),evidence.authorizeProof(original,who));for(const phase of ['before','after'])assert.deepEqual(projection(who,proof.request.selectedTargets[0][phase],proof.request.selectedTargets[0][phase+'Facts']),projection(who,original.request.selectedTargets[0][phase],original.request.selectedTargets[0][phase+'Facts']));}
 assert.equal(api.authorizeProof(proof,current),true);current.accessPolicy.grants=[];assert.equal(api.authorizeProof(proof,current),false);
});

test('changed subjects retain guards for fields absent from their fragment but present in full historical events',()=>{
 const guards=[guard(['metadata'])],{api}=instrument(guards),before=database([{id:0,org:'A',site:'Site',note:'Before',metadata:{secret:'Frozen secret'}}]),after=clone(before);after.vehicles[0].note='After';const input=request(before,after,{write:true}),proof=api.createProof(input),selected=proof.request.selectedTargets[0],subject=proof.subjects[0];
 assert.equal(Object.hasOwn(subject.before,'metadata'),false);assert.deepEqual(subject.beforeFacts.fieldGuards,guards);assert.deepEqual(subject.afterFacts.fieldGuards,guards);assert.deepEqual(selected.beforeFacts.fieldGuards,[]);
 const limited=principal(['A']),event=api.projectEvent(input.events[0],proof,limited);assert.equal(Object.hasOwn(event.before,'metadata'),false);assert.equal(Object.hasOwn(event.after,'metadata'),false);assert.deepEqual(api.projectEvent(input.events[0],proof,actor).after.metadata,{secret:'Frozen secret'});
 const resolverBefore=scope.createResolver(before),resolverAfter=scope.createResolver(after);assert.deepEqual(proof.request.eventGuards[0].fieldGuards,[...(resolverBefore.resolve('auditLog',input.events[0]).fieldGuards||[]),...(resolverAfter.resolve('auditLog',input.events[0]).fieldGuards||[])]);
});

test('own nested presence retains numeric zero, null and array length while absent and inherited paths are removed in each phase',()=>{
 const paths=[['id'],['payload','zero'],['payload','nil'],['payload','items','0'],['payload','items','length'],['payload','items','01'],['payload','nil','child'],['payload','zero','child'],['payload','toString'],['payload','missing']];
 const guards=paths.map(tokens=>guard(tokens)),{api}=instrument(guards,{payloadIdentity:true}),before=database([{id:0,org:'A',site:'Site',payload:{zero:0,nil:null,items:[null]}}]),after=clone(before);after.vehicles[0].payload={zero:null,items:[],missing:0};const proof=api.createProof(request(before,after)),item=proof.request.selectedTargets[0];
 assert.equal(item.before.id,0);assert.equal(item.before.payload.zero,0);assert.equal(item.before.payload.nil,null);
 assert.deepEqual(item.beforeFacts.fieldGuards.map(x=>x.path),paths.slice(0,5));assert.deepEqual(item.afterFacts.fieldGuards.map(x=>x.path),[paths[0],paths[1],paths[4],paths[9]]);
});

test('an absent child guard remains a projection no-op when a later ancestor deniedValue creates that child',()=>{
 const guards=[guard(['payload','missing'],null),guard(['payload'],{missing:'Ancestor replacement'})],{api}=instrument(guards,{payloadIdentity:true}),db=database([{id:0,org:'A',site:'Site',payload:{visible:0}}]),proof=api.createProof(request(db)),original=expanded(proof,db,db,guards),limited=principal(['A']),current=proof.request.selectedTargets[0],old=original.request.selectedTargets[0];
 assert.equal(current.beforeFacts.fieldGuards.length,1);assert.deepEqual(projection(limited,current.before,current.beforeFacts),projection(limited,old.before,old.beforeFacts));assert.deepEqual(projection(limited,current.before,current.beforeFacts)[0].payload,{missing:'Ancestor replacement'});
});

test('malformed absent guards are rejected before trimming, including the original guard-count bound',()=>{
 const db=database([{id:0,org:'A',site:'Site'}]);
 for(const guards of [[guard([])],[guard(['__proto__'])],[{path:['missing'],requires:{sections:['vehicles'],owners:[],complete:'yes'}}],[{path:['missing'],requires:{sections:['unknown-section'],owners:[],complete:true}}],Array.from({length:501},()=>guard(['missing']))]){
  assert.throws(()=>instrument(guards).api.createProof(request(db)),error=>['ACCESS_CONTEXT_INVALID','OPERATION_EVIDENCE_INVALID'].includes(error.code));
 }
});

test('selected source and archive captures retain complete guard lists',()=>{
 const guards=[guard(['missing'])],{api}=instrument(guards,{composites:true}),db=database([]),targets=[{section:'vehicles',kind:'source',value:{sourceScopes:['vehicles'],rows:[]}},{section:'vehicles',kind:'archive',value:{requiredReadSections:['vehicles'],scopeSnapshot:{version:1,owners:[{org:'A',site:'Site'}],complete:true}}}],proof=api.createProof(request(db,db,{targets}));
 for(const item of proof.request.selectedTargets){assert.ok(['source','archive'].includes(item.kind));assert.deepEqual(item.beforeFacts.fieldGuards,guards);assert.deepEqual(item.afterFacts.fieldGuards,guards);}
});
