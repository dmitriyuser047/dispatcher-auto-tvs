'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),vm=require('node:vm'),ts=require('typescript');
const {ROOT,SOURCE,compile,api,plain,fixture,CURRENT}=require('./helpers/platform-compatibility-fixtures.cjs');
const reason=(result,code)=>result.reasons.some(item=>item.code===code),remove=(value,name)=>{value.capabilities=value.capabilities.filter(item=>item.name!==name);};
function recursivelyFrozen(value){if(value&&typeof value==='object'){assert.ok(Object.isFrozen(value));Object.values(value).forEach(recursivelyFrozen);}}
test('actual standalone source compiles with every repository strict setting and owns only the frozen compatibility API',()=>{
 const built=compile();for(const name of ['strict','noUncheckedIndexedAccess','exactOptionalPropertyTypes','noImplicitReturns','noFallthroughCasesInSwitch','noUnusedLocals','noUnusedParameters','noEmitOnError'])assert.equal(built.options[name],true,name);assert.deepEqual(built.options.types,[]);assert.deepEqual(built.options.lib,['lib.es2020.d.ts']);assert.doesNotMatch(built.artifact,/\brequire\s*\(/);assert.deepEqual(Object.keys(built.exports),['createPlatformCompatibility']);const module=api();assert.deepEqual(Object.keys(module).sort(),['apiVersion','describe','negotiate']);recursivelyFrozen(module.describe());recursivelyFrozen(module);
 const tree=ts.createSourceFile(SOURCE,built.source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),forbidden=new Set(['Date','performance','process','window','document','localStorage','fetch','XMLHttpRequest','crypto','require','setTimeout','setInterval']);function visit(node){if(ts.isIdentifier(node))assert.ok(!forbidden.has(node.text),'pure source references forbidden capability '+node.text);if(ts.isPropertyAccessExpression(node))assert.notEqual(node.getText(tree),'Math.random');ts.forEachChild(node,visit);}visit(tree);
});
test('default current peers negotiate read-write with exact canonical storage descriptor, no permission or intent claims',()=>{
 const {module,hello,server,descriptor}=fixture(),before=plain({hello,server,descriptor}),result=module.negotiate(hello,server,descriptor);assert.equal(result.mode,'read-write');assert.equal(result.readCompatible,true);assert.equal(result.writeCompatible,true);assert.deepEqual(plain(result.reasons),[]);assert.equal(result.selectedProfile.protocolVersion,1);assert.equal(result.selectedProfile.readerSchemaVersion,CURRENT);assert.equal(result.selectedProfile.writerSchemaVersion,CURRENT);assert.equal(result.selectedProfile.capabilities.length,api().describe().hello.capabilities.length);assert.deepEqual(plain(result.databaseDescriptor),descriptor);assert.deepEqual(plain(result.constraints),{compatibilityOnly:true,requiresCurrentAccess:true,requiresWriteTicket:true,preserveIntent:true,retargetOutbox:false});recursivelyFrozen(result);assert.deepEqual({hello,server,descriptor},before);hello.capabilities[0].versions.push(4);assert.equal(result.selectedProfile.capabilities[0].version,1);
});
test('schema1, schema2 and literal old schema3 remain read-only even when both peers offer every current write capability',()=>{
 for(const version of [1,2,3]){const {module,hello,server,descriptor}=fixture(version),result=module.negotiate(hello,server,descriptor);assert.equal(result.mode,'read-only');assert.equal(result.readCompatible,true);assert.equal(result.writeCompatible,false);assert.equal(result.selectedProfile.readerSchemaVersion,version);assert.equal(result.selectedProfile.writerSchemaVersion,null);assert.ok(reason(result,'DATABASE_READ_ONLY'));}
});

test('literal old schema3 retains its original four features and minReader/minWriter3 while current adds receipt evidence',()=>{
 const legacy={schemaVersion:3,minReader:3,minWriter:3,features:['controlled-import-v1','document-lifecycle-v1','row-scope-v1','sealed-print-v1']},current=fixture();assert.deepEqual(fixture(3).descriptor,legacy);const result=current.module.negotiate(current.hello,current.server,legacy);assert.equal(result.mode,'read-only');assert.equal(result.selectedProfile.readerSchemaVersion,3);assert.equal(result.selectedProfile.writerSchemaVersion,null);assert.ok(current.descriptor.features.includes('operation-receipts-v1'));const required=plain(current.hello);remove(required,'operation-receipts-v1');assert.equal(current.module.negotiate(required,current.server,current.descriptor).mode,'unsupported');
});
test('legacy server is readable only with a known legacy descriptor and an explicitly capable reader',()=>{
 for(const version of [1,2]){const {module,hello,descriptor}=fixture(version),result=module.negotiate(hello,null,descriptor);assert.equal(result.mode,'read-only');assert.ok(reason(result,'LEGACY_SERVER_READ_ONLY'));assert.equal(result.selectedProfile.protocolVersion,null);assert.equal(result.selectedProfile.writerSchemaVersion,null);assert.deepEqual(plain(result.selectedProfile.capabilities),[]);hello.readerSchemaVersions=[CURRENT];assert.equal(module.negotiate(hello,null,descriptor).mode,'unsupported');}
 const old3=fixture(3);assert.equal(old3.module.negotiate(old3.hello,null,old3.descriptor).mode,'unsupported');assert.ok(reason(old3.module.negotiate(old3.hello,null,old3.descriptor),'SERVER_UNVERIFIED'));
 const {module,hello,server,descriptor}=fixture();assert.ok(reason(module.negotiate(hello,null,descriptor),'SERVER_UNVERIFIED'));for(const oldHello of [null,undefined]){const result=module.negotiate(oldHello,server,descriptor);assert.equal(result.mode,'unsupported');assert.ok(reason(result,'READER_UNVERIFIED'));assert.equal(result.selectedProfile,null);}assert.equal(module.negotiate(hello,null,null).mode,'unsupported');
});
test('reader support is exact and cannot be inferred from a larger reader or writer version',()=>{
 for(const versions of [[],[1,2,3],[CURRENT+1],[1,CURRENT+1]]){const {module,hello,server,descriptor}=fixture();hello.readerSchemaVersions=versions;hello.writerSchemaVersions=[CURRENT,CURRENT+1];const result=module.negotiate(hello,server,descriptor);assert.equal(result.mode,'unsupported');assert.ok(reason(result,'READER_SCHEMA_UNSUPPORTED'));assert.equal(result.selectedProfile,null);}
});
test('missing writer schema, write protocol or server write capability permits only already-proven reads',()=>{
 const changes=[['WRITER_SCHEMA_UNSUPPORTED',hello=>hello.writerSchemaVersions=[]],['WRITER_SCHEMA_UNSUPPORTED',hello=>hello.writerSchemaVersions=[CURRENT+1]],['PROTOCOL_UNSUPPORTED',hello=>hello.protocolVersions=[]],['PROTOCOL_UNSUPPORTED',hello=>hello.protocolVersions=[2]],['REQUIRED_WRITE_CAPABILITY_UNAVAILABLE',hello=>remove(hello,'commands')],['REQUIRED_WRITE_CAPABILITY_UNAVAILABLE',hello=>remove(hello,'operations')],['REQUIRED_WRITE_CAPABILITY_UNAVAILABLE',hello=>remove(hello,'outbox')]];
 for(const [code,change]of changes){const {module,hello,server,descriptor}=fixture();change(hello);const result=module.negotiate(hello,server,descriptor);assert.equal(result.mode,'read-only',code);assert.ok(reason(result,code));assert.equal(result.readCompatible,true);assert.equal(result.writeCompatible,false);assert.equal(result.selectedProfile.writerSchemaVersion,null);}
 const {module,hello,server,descriptor}=fixture();server.readOnly=true;const result=module.negotiate(hello,server,descriptor);assert.equal(result.mode,'read-only');assert.ok(reason(result,'SERVER_READ_ONLY'));server.readOnly=false;server.writerSchemaVersions=[];assert.ok(reason(module.negotiate(hello,server,descriptor),'WRITER_SCHEMA_UNSUPPORTED'));
});
test('all current descriptor features and scoped reads are explicit mandatory read capabilities',()=>{
 const initial=fixture();for(const capability of ['scopedAccess',...initial.descriptor.features]){const {module,hello,server,descriptor}=fixture();remove(hello,capability);const result=module.negotiate(hello,server,descriptor);assert.equal(result.mode,'unsupported',capability);assert.equal(result.selectedProfile,null);assert.ok(result.reasons.some(item=>item.code==='REQUIRED_READ_CAPABILITY_UNAVAILABLE'&&item.capability===capability));}
});

for(const calculationVersion of [5,6])test('fuel calculation v'+calculationVersion+' requires both peers before writes while older peers retain proven reads',()=>{
 const capability='fuelCalculationsV'+calculationVersion;
 for(const older of ['client','server']){
  const {module,hello,server,descriptor}=fixture();
  const peer=older==='client'?hello:server;remove(peer,capability);
  if(older==='server')server.requiredWriteCapabilities=server.requiredWriteCapabilities.filter(item=>item.name!==capability);
  const result=module.negotiate(hello,server,descriptor);
  assert.equal(result.mode,'read-only',older);assert.equal(result.readCompatible,true);assert.equal(result.writeCompatible,false);assert.equal(result.selectedProfile.writerSchemaVersion,null);
  assert.ok(result.reasons.some(item=>item.code==='REQUIRED_WRITE_CAPABILITY_UNAVAILABLE'&&item.capability===capability));
 }
 const {module,hello,server,descriptor}=fixture();
 const result=module.negotiate(hello,server,descriptor);
 assert.equal(result.mode,'read-write');assert.ok(result.selectedProfile.capabilities.some(item=>item.name===capability&&item.version===1));
 assert.ok(server.requiredWriteCapabilities.some(item=>item.name===capability&&item.version===1));
});
test('capability versions are exact implemented intersections; advertising version2 never implies version1',()=>{
 const {module,hello,server,descriptor}=fixture();for(const profile of [hello,server]){profile.protocolVersions=[2,1];for(const item of profile.capabilities)item.versions=[2,1];}const result=module.negotiate(hello,server,descriptor);assert.equal(result.mode,'read-write');assert.equal(result.selectedProfile.protocolVersion,1);assert.ok(result.selectedProfile.capabilities.every(item=>item.version===1));hello.capabilities.find(item=>item.name==='commands').versions=[2];const noCommand=module.negotiate(hello,server,descriptor);assert.equal(noCommand.mode,'read-only');assert.ok(reason(noCommand,'REQUIRED_WRITE_CAPABILITY_UNAVAILABLE'));hello.capabilities.find(item=>item.name==='scopedAccess').versions=[2];assert.equal(module.negotiate(hello,server,descriptor).mode,'unsupported');
});
test('unknown optional capabilities are ignored and unknown required capabilities cannot grant writes or reads',()=>{
 const {module,hello,server,descriptor}=fixture();for(const profile of [hello,server])profile.capabilities.push({name:'futureFeature',versions:[1]});let result=module.negotiate(hello,server,descriptor);assert.equal(result.mode,'read-write');assert.ok(result.selectedProfile.capabilities.every(item=>item.name!=='futureFeature'));server.requiredWriteCapabilities.push({name:'futureFeature',version:1});result=module.negotiate(hello,server,descriptor);assert.equal(result.mode,'read-only');assert.ok(reason(result,'REQUIRED_WRITE_CAPABILITY_UNKNOWN'));server.requiredReadCapabilities.push({name:'futureFeature',version:1});result=module.negotiate(hello,server,descriptor);assert.equal(result.mode,'unsupported');assert.ok(reason(result,'REQUIRED_READ_CAPABILITY_UNKNOWN'));
});
test('read and write requirements for the same capability cannot silently select conflicting versions',()=>{
 const {module,hello,server,descriptor}=fixture();for(const profile of [hello,server])profile.capabilities.find(item=>item.name==='documentPrint').versions=[1,2];server.requiredReadCapabilities.push({name:'documentPrint',version:1});server.requiredWriteCapabilities.push({name:'documentPrint',version:2});const result=module.negotiate(hello,server,descriptor);assert.equal(result.mode,'read-only');assert.ok(reason(result,'REQUIRED_WRITE_CAPABILITY_CONFLICT'));assert.deepEqual(plain(result.selectedProfile.capabilities.find(item=>item.name==='documentPrint')),{name:'documentPrint',version:1});assert.equal(result.selectedProfile.writerSchemaVersion,null);
});
test('malformed or self-contradictory server metadata fails closed rather than downgrading to legacy reads',()=>{
 const changes=[server=>server.version=2,server=>delete server.readOnly,server=>server.requiredWriteCapabilities.push({name:'unadvertised',version:1}),server=>server.requiredReadCapabilities.push({name:'scopedAccess',version:1}),server=>server.capabilities.push(server.capabilities[0]),server=>server.extra='ignored?',server=>server.protocolVersions=[1,1],server=>server.readOnly='false'];
 for(const change of changes){const {module,hello,server,descriptor}=fixture();change(server);const result=module.negotiate(hello,server,descriptor);assert.equal(result.mode,'unsupported');assert.equal(result.selectedProfile,null);assert.equal(result.writeCompatible,false);assert.ok(result.reasons.length>0);}
});
test('future, corrupt, partial or noncanonical descriptors cannot be treated as a current readable database',()=>{
 const changes=[descriptor=>descriptor.schemaVersion=CURRENT+1,descriptor=>descriptor.minReader=2,descriptor=>descriptor.minWriter=2,descriptor=>descriptor.features.push('future-feature'),descriptor=>descriptor.features.pop(),descriptor=>descriptor.features.reverse(),descriptor=>descriptor.features.push(descriptor.features[0]),descriptor=>descriptor.extra=true,descriptor=>delete descriptor.features];
 for(const change of changes){const current=fixture(),descriptor=plain(current.descriptor);change(descriptor);const result=current.module.negotiate(current.hello,current.server,descriptor);assert.equal(result.mode,'unsupported');assert.equal(result.databaseDescriptor,null);assert.equal(result.selectedProfile,null);}
});
test('version arrays reject duplicates, zero, negatives, fractions, strings, oversized lists and nonfinite values',()=>{
 for(const versions of [[1,1],[0],[-1],[1.5],['1'],[NaN],[Infinity],[65536],Array.from({length:9},(_,index)=>index+1)]){const {module,hello,server,descriptor}=fixture();hello.protocolVersions=versions;const result=module.negotiate(hello,server,descriptor);assert.equal(result.mode,'unsupported');assert.equal(result.selectedProfile,null);}
 for(const versions of [[0],[1,1],[],[NaN]]){const {module,hello,server,descriptor}=fixture();hello.capabilities[0].versions=versions;assert.equal(module.negotiate(hello,server,descriptor).mode,'unsupported');}
});
test('strict owned JSON rejects executable, hidden, cyclic, sparse and extra DTO properties without running hooks',()=>{
 let executed=0;const variants=[hello=>Object.defineProperty(hello,'extra',{enumerable:true,get(){executed++;return true;}}),hello=>Object.defineProperty(hello,'extra',{value:true}),hello=>{hello.extra=hello;},hello=>{hello.protocolVersions=new Array(1);},hello=>{hello.protocolVersions.extra=1;},hello=>{hello.protocolVersions['4294967295']=1;},hello=>{hello.extra=Symbol('private');},hello=>{hello[Symbol('hidden')]=1;},hello=>{hello.extra=()=>executed++;},hello=>{hello.toJSON=()=>{executed++;return {};};},hello=>{hello.extra='unknown';},hello=>Object.defineProperty(hello,'__proto__',{value:{injected:true},enumerable:true})];
 for(const change of variants){const {module,hello,server,descriptor}=fixture();change(hello);const result=module.negotiate(hello,server,descriptor);assert.equal(result.mode,'unsupported');assert.equal(result.selectedProfile,null);}assert.equal(executed,0);
});
test('oversized profiles and throwing reflection return bounded sanitized diagnostics',()=>{
 const {module,hello,server,descriptor}=fixture(),huge=plain(hello);huge.private='PRIVATE-SECRET'.repeat(10000);let result=module.negotiate(huge,server,descriptor);assert.equal(result.mode,'unsupported');assert.ok(reason(result,'PROFILE_TOO_LARGE'));assert.ok(JSON.stringify(result).length<2000);assert.doesNotMatch(JSON.stringify(result),/PRIVATE-SECRET/);const proxy=new Proxy({}, {getPrototypeOf(){throw Error('PRIVATE STACK OR FILE PATH');}});result=module.negotiate(proxy,server,descriptor);assert.equal(result.mode,'unsupported');assert.doesNotMatch(JSON.stringify(result),/PRIVATE STACK|FILE PATH/);assert.ok(reason(result,'HELLO_INVALID'));
});
test('independent VM exports agree and cannot reach clocks, random, environment or I/O',()=>{
 const built=compile(),sandbox=vm.createContext({exports:{}});new vm.Script('(function(exports){\n'+built.artifact+'\n})(exports);').runInContext(sandbox);const isolated=sandbox.exports.createPlatformCompatibility({apiVersion:1});const {module,hello,server,descriptor}=fixture();assert.deepEqual(plain(isolated.negotiate(hello,server,descriptor)),plain(module.negotiate(hello,server,descriptor)));assert.deepEqual(Object.keys(sandbox).sort(),['exports']);assert.throws(()=>sandbox.exports.createPlatformCompatibility({apiVersion:2}),error=>error.code==='MODULE_UNAVAILABLE');assert.throws(()=>sandbox.exports.createPlatformCompatibility({apiVersion:1},{apiVersion:2,sections:[]}),error=>error.code==='MODULE_UNAVAILABLE');
});
test('renegotiation never changes exact intent bytes, operation digest, database token or captured outbox scope',()=>{
 const {module,hello,server,descriptor}=fixture(),payload={protocolVersion:1,databaseToken:'a'.repeat(64),operation:{id:'immutable-intent-24'},base:{vehicles:7},command:{type:'IssueFuel',version:1,input:{tankId:0,target:{section:'vehicles',id:0},date:'2026-10-23',qty:923.537,reason:'exact source'}}},kernel=require(require('node:path').join(ROOT,'assets/core/platform-kernel.js')),json=JSON.stringify(payload),digest=kernel.requestDigest(payload),scope=crypto.createHash('sha256').update('captured-profile:'+payload.databaseToken).digest('hex'),before={json,digest,scope};
 for(let iteration=0;iteration<3;iteration++){module.negotiate(hello,server,descriptor);const readonly=plain(hello);remove(readonly,'commands');module.negotiate(readonly,server,descriptor);module.negotiate(null,server,descriptor);}assert.equal(JSON.stringify(payload),before.json);assert.equal(kernel.requestDigest(payload),before.digest);assert.equal(crypto.createHash('sha256').update('captured-profile:'+payload.databaseToken).digest('hex'),before.scope);assert.equal(payload.databaseToken,'a'.repeat(64));assert.equal(payload.operation.id,'immutable-intent-24');
});
test('exported DTOs reject mutable snapshots, unknown modes, string versions and future storage schemas at compile time',()=>{
 const path=require('node:path'),filename=path.join(path.dirname(SOURCE),'__compatibility_type_probe__.ts'),text=`
 import {createPlatformCompatibility,type CompatibilityMode,type CompatibilityCapability,type CompatibilityDatabaseDescriptor,type PlatformCompatibilityServerProfile} from './platform-compatibility';
 const api=createPlatformCompatibility({apiVersion:1}),description=api.describe(),result=api.negotiate(description.hello,description.serverProfile,{schemaVersion:${CURRENT},minReader:${CURRENT},minWriter:${CURRENT},features:description.databaseFeatures});
 const mode:CompatibilityMode=result.mode;void mode;
 // @ts-expect-error a compatibility result never invents a fourth mode
 const wrongMode:CompatibilityMode='write';void wrongMode;
 // @ts-expect-error descriptions are owned readonly snapshots
 description.hello.readerSchemaVersions.push(4);
 // @ts-expect-error accepted reason rows are readonly
 result.reasons[0]!.code='HELLO_INVALID';
 // @ts-expect-error capability versions stay numeric
 const badVersion:CompatibilityCapability={name:'commands',versions:['1']};void badVersion;
 // @ts-expect-error unknown storage generations require a new module
 const future:CompatibilityDatabaseDescriptor={schemaVersion:${CURRENT+1},minReader:${CURRENT},minWriter:${CURRENT},features:[]};void future;
 // @ts-expect-error current server profiles must declare required read/write capabilities
 const partial:PlatformCompatibilityServerProfile={version:1,protocolVersions:[1],writerSchemaVersions:[3],capabilities:[],readOnly:false};void partial;
 `,options={...compile().options,noEmit:true},host=ts.createCompilerHost(options),read=host.readFile.bind(host),exists=host.fileExists.bind(host),source=host.getSourceFile.bind(host);host.readFile=file=>path.resolve(file)===filename?text:read(file);host.fileExists=file=>path.resolve(file)===filename||exists(file);host.getSourceFile=(file,languageVersion,onError,createNew)=>path.resolve(file)===filename?ts.createSourceFile(file,text,languageVersion,true):source(file,languageVersion,onError,createNew);const diagnostics=ts.getPreEmitDiagnostics(ts.createProgram([filename],options,host));assert.deepEqual(diagnostics.map(item=>ts.flattenDiagnosticMessageText(item.messageText,'\n')),[]);
});
