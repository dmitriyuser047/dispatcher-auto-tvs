'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const facts=require('../assets/core/integrity-facts.js'),fingerprint=require('../assets/core/request-fingerprint.js'),kernel=require('../assets/core/platform-kernel.js');
const baseline=require('./fixtures/integrity-facts-baseline.json'),hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

// The literal extraction oracle predates the new registry section. Check that
// one declaration explicitly, then retain every original issue and hash byte.
function originalRegistryProjection(report,restricted){
 const section='generatorMaintenancePlans',added=report.sections.filter(value=>value.section===section),warnings=report.issues.filter(value=>value.section===section);
 assert.deepEqual(added,[{section,label:'Графики ТО ДЭС',module:'maintenance',readable:!restricted,rows:restricted?null:0}]);
 assert.deepEqual(warnings,restricted?[{code:'section-unavailable',severity:'warning',section,recordId:'',rowIndex:-1,field:'',message:'Раздел недоступен для проверки: Графики ТО ДЭС'}]:[]);
 return {...report,issues:report.issues.filter(value=>value.section!==section),sections:report.sections.filter(value=>value.section!==section),counts:{...report.counts,warning:report.counts.warning-warnings.length,total:report.counts.total-warnings.length}};
}

test('structural facts and delta failures match golden results captured before extraction, including restricted views',()=>{
 for(const {db,all,restricted}of baseline.inspections){const before=JSON.stringify(db);assert.equal(Object.hasOwn(db,'generatorMaintenancePlans'),false);assert.equal(hash(originalRegistryProjection(facts.inspect(db),false)),all);assert.equal(hash(originalRegistryProjection(facts.inspect(db,{readable:['vehicles','records']}),true)),restricted);assert.equal(JSON.stringify(db),before);}
 for(const {before,after,context,hash:expected}of baseline.deltas){const bytes=JSON.stringify([before,after]);let result;try{result={ok:facts.validateChanges(before,after,context||{})};}catch(error){result={name:error.name,code:error.code,message:error.message,issues:error.issues};}assert.equal(hash(result),expected);assert.equal(JSON.stringify([before,after]),bytes);}
});

test('request fingerprint primitives retain Kernel aliases and exact pre-extraction semantic/raw/scoped bytes',()=>{
 const cases=[
  [{base:{records:3,auditLog:5},sections:{records:[{id:0,note:'Синтетика 😀'}],auditLog:[{id:'history'}]}},'sha256:ccb78cc16bca42b61126921a1ee5492201a6e37bdef7ff3392935c196aa060ca'],
  [{protocolVersion:1,base:{vehicles:7},command:{type:'Synthetic',version:1,input:{id:'7',zero:0}}},'sha256:1afe420994027fd12eeefabc79ce0b36f2b2c3d4eb6e657a7285f5ca73a7734f'],
  [{base:{vehicles:1},sections:{vehicles:[]},scopeViews:{vehicles:{stamp:'synthetic'}}},'sha256:645e732b573eee7e94d76b0bd4022102bf2bedca9343c589027671b4cac90335'],
 ];
 assert.equal(kernel.requestDigest,fingerprint.requestDigest);assert.equal(kernel.stableSerialize,fingerprint.stableSerialize);
 for(const [payload,expected]of cases){const before=JSON.stringify(payload);assert.equal(fingerprint.requestDigest(payload),expected);assert.equal(kernel.requestDigest(payload),expected);assert.equal(JSON.stringify(payload),before);}
 for(const text of ['', 'Синтетика 😀', '\ud800', 'a'.repeat(10000)])assert.equal(fingerprint.sha256(text),crypto.createHash('sha256').update(text).digest('hex'));
 for(const value of [NaN,Infinity,()=>{},Symbol('synthetic')])assert.throws(()=>fingerprint.stableSerialize({value}),error=>error.name==='PlatformKernelError'&&error.code==='INVALID_SNAPSHOT');
 assert.equal(fingerprint.stableSerialize({b:undefined,a:[undefined,,0]}),'{"a":[null,null,0]}');
});

test('lower facts and fingerprint load in a browser without validation aggregators, commands, precision proofs or platform state',()=>{
 const context=vm.createContext({});
 for(const file of ['platform-schema.js','platform-contracts.js','record-identity.js','business-calendar.js','integrity-facts.js','catalog-facts.js','request-fingerprint.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/core',file),'utf8'),context,{filename:file});
 for(const name of ['PlatformIntegrity','PlatformPolicies','PlatformKernel','MergeCatalog','DocumentEngine','PrecisionPolicy'])assert.equal(context[name],undefined);
 assert.equal(JSON.stringify(context.IntegrityFacts.inspect(baseline.inspections[0].db)),JSON.stringify(facts.inspect(baseline.inspections[0].db)));
 const request={base:{},sections:{vehicles:[{id:7}]}};assert.equal(context.RequestFingerprint.requestDigest(request),fingerprint.requestDigest(request));
 assert.equal(context.CatalogFacts.inspect({vehicles:[]}).counts.total,0);
});

test('catalog merge plans no longer load Kernel/Integrity or precision planning and public catalog inspection delegates to facts',()=>{
 const filename=path.join(__dirname,'../assets/core/catalog-merge.js'),source=fs.readFileSync(filename,'utf8'),requested=[];
 const context=vm.createContext({module:{exports:{}},require:name=>{requested.push(name);assert.ok(!['./platform-kernel.js','./platform-integrity.js','./precision-policy.js'].includes(name));return require(path.join(__dirname,'../assets/core',name));}});
 vm.runInContext(source,context,{filename});const db={contragents:[{id:0,name:'Source'},{id:'0',name:'Target'}]},input={section:'contragents',sourceId:0,targetId:'0',reason:'Synthetic confirmed duplicate',mutableRefs:[]};
 const preview=context.module.exports.preview(db,input,{today:'2026-10-22'});assert.equal(preview.canMerge,true);assert.ok(requested.includes('./request-fingerprint.js'));assert.equal(require('../assets/core/catalog-policy.js').inspect,require('../assets/core/catalog-facts.js').inspect);
});
