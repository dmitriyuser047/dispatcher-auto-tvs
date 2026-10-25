'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const ts=require('typescript');
const ROOT=path.resolve(__dirname,'..'),FIXTURE=path.join(__dirname,'fixtures/request-fingerprint-v3.5.8');
const released=require(path.join(FIXTURE,'request-fingerprint.js')),current=require('../assets/core/request-fingerprint.js');
function browser(file){const context=vm.createContext({});vm.runInContext(fs.readFileSync(file,'utf8'),context,{filename:file});assert.deepEqual(Object.keys(context),['RequestFingerprint']);return context.RequestFingerprint;}
const apis=[released,current,browser(path.join(FIXTURE,'request-fingerprint.js')),browser(path.join(ROOT,'assets/core/request-fingerprint.js'))];
const nodeHash=text=>crypto.createHash('sha256').update(String(text),'utf8').digest('hex');
function outcome(fn){try{return {value:fn()};}catch(error){return {error:{name:error.name,code:error.code,message:error.message,...(Object.hasOwn(error,'details')?{details:error.details}:{})}};}}
function same(method,input){const expected=outcome(()=>released[method](input));for(const api of apis)assert.deepEqual(outcome(()=>api[method](input)),expected);return expected;}
function nest(depth,leaf=null){let value=leaf;for(let index=0;index<depth;index++)value={next:value};return value;}

test('the differential reference is the immutable module from published v3.5.8',()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(FIXTURE,'source-sha256.json'),'utf8'));
  assert.deepEqual(manifest,{tag:'v3.5.8',commit:'f0d12c07223ce713b93dcf6c09ff76a9ca72cb00',path:'assets/core/request-fingerprint.js',sha256:'553c1d80f8e2948893294fbb2404d0f2a169d96167f73cf1e22efac7463a39bd'});
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(FIXTURE,'request-fingerprint.js'))).digest('hex'),manifest.sha256);
  for(const api of apis){assert.equal(Object.isFrozen(api),true);assert.equal(api.apiVersion,1);assert.deepEqual(Object.keys(api),['apiVersion','stableSerialize','sha256','requestDigest']);}
});

test('canonical bytes retain undefined, sparse arrays, finite zero, property order and shared references',()=>{
  const shared={quantity:923.537},sparse=Array(3);sparse[1]=undefined;
  const values=[undefined,null,true,false,0,-0,'Синтетика 🚚\ud800',[],{},sparse,
    {z:[undefined,,0,-0,'Синтетика 🚚'],a:{b:undefined,a:true},q:null},
    {'10':'ten','2':'two',b:2,a:1},[shared,shared],{keep:0,drop:undefined},
    Object.assign(Object.create(null),{z:1,a:2}),Object.assign(Object.create({inherited:1}),{own:2})];
  for(const value of values)same('stableSerialize',value);
  assert.equal(current.stableSerialize(undefined),undefined);
  assert.equal(current.stableSerialize(sparse),'[null,null,null]');
  assert.equal(current.stableSerialize(values[10]),'{"a":{"a":true},"q":null,"z":[null,null,0,0,"Синтетика 🚚"]}');
  assert.equal(current.stableSerialize({'10':'ten','2':'two',b:2,a:1}),'{"2":"two","10":"ten","a":1,"b":2}');
  const input={z:{quantity:923.537},a:[0,null]},before=JSON.stringify(input);same('stableSerialize',input);assert.equal(JSON.stringify(input),before);
});

test('historical object-tag acceptance and own enumerable property behavior remain unchanged',()=>{
  class LegacyRow {constructor(){this.id=0;this.note='Historical class row';}}
  const tagged=function(){};Object.defineProperty(tagged,Symbol.toStringTag,{value:'Object'});tagged.id='function-with-object-tag';
  const symbol=Symbol('ignored'),row={z:1,[symbol]:'not an enumerable string key'};
  Object.defineProperty(row,'hidden',{value:'hidden',enumerable:false});
  for(const value of [new LegacyRow(),tagged,row,vm.runInNewContext('({z:1,a:[0,null]})')])same('stableSerialize',value);
  for(const api of apis){let reads=0;const withGetter={get qty(){reads++;return 0;}};assert.equal(api.stableSerialize(withGetter),'{"qty":0}');assert.equal(reads,1);}
});

test('invalid JSON inputs, cycles, forbidden keys and exact depth boundary retain released errors',()=>{
  const cycle={};cycle.self=cycle;
  const arrayCycle=[];arrayCycle.push(arrayCycle);
  for(const value of [NaN,Infinity,-Infinity,1n,Symbol('unsupported'),()=>{},new Date(0),new Map(),new Set(),new Uint8Array([1]),cycle,arrayCycle,
    JSON.parse('{"__proto__":1}'),{prototype:1},{constructor:1},{toJSON(){return 1;}},nest(129),nest(129,undefined)]){
    const result=same('stableSerialize',value);assert.equal(result.error.code,'INVALID_SNAPSHOT');assert.equal(result.error.name,'PlatformKernelError');
  }
  same('stableSerialize',nest(128));same('stableSerialize',nest(128,undefined));
});

test('portable SHA256 retains standard known vectors and every block padding boundary',()=>{
  const vectors=[['','e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc','ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq','248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1']];
  for(const [text,hash]of vectors)for(const api of apis)assert.equal(api.sha256(text),hash);
  for(const size of [1,2,54,55,56,57,63,64,65,119,120,127,128,129,255,256,1000,4096]){
    const text='a'.repeat(size),expected=nodeHash(text);for(const api of apis)assert.equal(api.sha256(text),expected);
  }
});

test('portable UTF8 matches Node for malformed surrogates, Unicode and retained String coercions',()=>{
  const values=['\0','é','Топливо 923,537 л 🚚','\ud800','\udfff','\ud800A','A\udfff','\ud800\ud800\udfff','\ud83d\ude9a',
    '\ufffd','\uffff','\u{10ffff}',undefined,null,true,false,0,-0,923.537,1n,Symbol('symbol'),[0,null],{}, {toString(){return 'Synthetic custom text';}}];
  for(const value of values){same('sha256',value);for(const api of apis)assert.equal(api.sha256(value),nodeHash(value));}
  let seed=0x358;const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  for(let sample=0;sample<256;sample++){
    let text='';for(let index=0;index<sample%67;index++)text+=String.fromCharCode(next()&0xffff);
    const expected=nodeHash(text);for(const api of apis)assert.equal(api.sha256(text),expected);
  }
});

function requests(){return [
  {base:{vehicles:5,auditLog:999},sections:{vehicles:[{id:'v',note:'Синтетика 🚚'}],auditLog:[{actor:'client-choice'}]}},
  {protocolVersion:1,base:{tanks:3,records:4,vehicles:5},command:{type:'IssueFuel',version:1,input:{tankId:7,target:{section:'vehicles',id:'7'},date:'2026-09-01',qty:923.537,reason:'Synthetic issue'}}},
  {base:{vehicles:0},sections:{vehicles:[{id:0,note:'ZERO'}]},scopeViews:{vehicles:{version:1,policyStamp:'sha256:'+'b'.repeat(64),revision:0,visibleFingerprint:'sha256:'+'c'.repeat(64)}}},
];}
test('fixed released request digests remain byte compatible for raw, semantic and scoped requests',()=>{
  const expected=['sha256:750698e75e097fb3fea47be0c084348bc02da6c5495e3f13b38d1914f9b36c19','sha256:1cb98ba0d36eafe8fc7ee211c752a59cff2a888190517c1ff978870166542647','sha256:c631026b335fd1dbe4a5c19fabd3a76e117e52d7014f127b3bb7cab718ef5170'];
  requests().forEach((request,index)=>{const before=JSON.stringify(request);same('requestDigest',request);for(const api of apis)assert.equal(api.requestDigest(request),expected[index]);assert.equal(JSON.stringify(request),before);});
});

test('raw request compatibility retains falsy defaults, audit omission and own scope views',()=>{
  for(const request of [{},{base:null,sections:undefined},{base:0,sections:false},{base:'',sections:NaN},
    {base:{vehicles:0},sections:{vehicles:[]},scopeViews:undefined},Object.assign(Object.create({scopeViews:'inherited ignored'}),{base:{},sections:{}})])same('requestDigest',request);
  const [raw,,scoped]=requests();
  for(const api of apis){
    assert.equal(api.requestDigest({...raw,base:{vehicles:5},sections:{vehicles:raw.sections.vehicles},operation:{id:'ignored'},databaseToken:'ignored'}),api.requestDigest(raw));
    assert.equal(api.requestDigest({}),api.requestDigest({base:null,sections:false}));
    const changed=structuredClone(scoped);changed.scopeViews.vehicles.revision=1;assert.notEqual(api.requestDigest(changed),api.requestDigest(scoped));
    assert.notEqual(api.requestDigest(scoped),api.requestDigest({base:scoped.base,sections:scoped.sections}));
  }
});

test('semantic digests bind dependency revisions, typed IDs and exact command facts while ignoring transport hints',()=>{
  const [,semantic]=requests();
  for(const api of apis){
    const digest=api.requestDigest(semantic);assert.equal(api.requestDigest({...semantic,operation:{id:'transport'},databaseToken:'new-profile'}),digest);
    for(const mutate of [p=>p.base.tanks++,p=>p.command.input.qty=923.538,p=>p.command.input.target.id=7,p=>p.command.input.reason='Different reason']){const changed=structuredClone(semantic);mutate(changed);same('requestDigest',changed);assert.notEqual(api.requestDigest(changed),digest);}
  }
});

test('malformed digest envelopes retain validation order, error shape and command protocol separation',()=>{
  const [,semantic]=requests();
  for(const request of [undefined,null,false,0,'request',[],{base:[]},{sections:[]},{base:1},{sections:'wrong'},
    {command:undefined},{...semantic,protocolVersion:2},{...semantic,base:null},{...semantic,command:[]},{...semantic,sections:undefined},
    {base:{vehicles:Infinity}},{sections:{vehicles:[{id:0,qty:NaN}]}},{...semantic,command:{constructor:'forbidden'}}]){
    const result=same('requestDigest',request);assert.ok(['INVALID_ARGUMENT','INVALID_SNAPSHOT'].includes(result.error.code));assert.equal(result.error.name,'PlatformKernelError');
  }
});

test('public TypeScript contract exposes unknown inputs, optional serialized text and frozen API fields',()=>{
  const filename=path.join(ROOT,'__fingerprint_type_probe__.ts'),text=`
    import {createRequestFingerprint,type RequestFingerprintAPI} from './src/core/request-fingerprint';
    const api:RequestFingerprintAPI=createRequestFingerprint();
    const bytes:string|undefined=api.stableSerialize(undefined);
    const digest:string=api.requestDigest({base:{vehicles:0},sections:{vehicles:[{id:0}]}});
    const hash:string=api.sha256(undefined);
    // @ts-expect-error undefined serialization must be handled by the caller
    const unsafe:string=api.stableSerialize(undefined);
    // @ts-expect-error hashes are hexadecimal strings rather than numeric amounts
    const amount:number=api.sha256('923.537');
    // @ts-expect-error the API version is immutable
    api.apiVersion=2;
    void bytes;void digest;void hash;void unsafe;void amount;
  `;
  const raw=ts.readConfigFile(path.join(ROOT,'tsconfig.core.json'),ts.sys.readFile);assert.equal(raw.error,undefined);
  const options={...ts.parseJsonConfigFileContent(raw.config,ts.sys,ROOT).options,rootDir:ROOT,noEmit:true},host=ts.createCompilerHost(options);
  const getSourceFile=host.getSourceFile.bind(host);
  host.getSourceFile=(file,languageVersion,onError,shouldCreateNewSourceFile)=>path.resolve(file)===filename?ts.createSourceFile(file,text,languageVersion,true):getSourceFile(file,languageVersion,onError,shouldCreateNewSourceFile);
  const diagnostics=ts.getPreEmitDiagnostics(ts.createProgram([filename],options,host));assert.deepEqual(diagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,'\n')),[]);
});
