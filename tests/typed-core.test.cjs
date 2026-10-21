'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{spawnSync}=require('node:child_process');
const ts=require('typescript');
const {compileTypedCore,COMPILER_VERSION,ENTRIES}=require('../scripts/build-typed-core.cjs');
const ROOT=path.resolve(__dirname,'..');
const normalize=text=>text.replace(/\r\n?/g,'\n');
const plain=value=>JSON.parse(JSON.stringify(value));
let compilation;
const compiled=()=>compilation||(compilation=compileTypedCore());
function browserAPI(entry){
  const context=vm.createContext({});vm.runInContext(entry.artifact,context,{filename:entry.output});
  return {api:context[entry.global],context};
}
function probeDiagnostics(text){
  const filename=path.join(ROOT,'__typed_core_contract_probe__.ts');
  const config=ts.readConfigFile(path.join(ROOT,'tsconfig.core.json'),ts.sys.readFile);
  assert.equal(config.error,undefined);
  const options={...ts.parseJsonConfigFileContent(config.config,ts.sys,ROOT).options,rootDir:ROOT,noEmit:true};
  const host=ts.createCompilerHost(options),readFile=host.readFile.bind(host),fileExists=host.fileExists.bind(host),getSourceFile=host.getSourceFile.bind(host);
  host.fileExists=file=>path.resolve(file)===filename||fileExists(file);
  host.readFile=file=>path.resolve(file)===filename?text:readFile(file);
  host.getSourceFile=(file,languageVersion,onError,shouldCreateNewSourceFile)=>path.resolve(file)===filename
    ?ts.createSourceFile(file,text,languageVersion,true):getSourceFile(file,languageVersion,onError,shouldCreateNewSourceFile);
  return ts.getPreEmitDiagnostics(ts.createProgram([filename],options,host));
}

test('strict TypeScript is the real source of each dependency-free UMD artifact',()=>{
  const config=JSON.parse(fs.readFileSync(path.join(ROOT,'tsconfig.core.json'),'utf8'));
  assert.equal(config.compilerOptions.strict,true);assert.equal(config.compilerOptions.noUncheckedIndexedAccess,true);
  assert.equal(config.compilerOptions.exactOptionalPropertyTypes,true);assert.deepEqual(config.compilerOptions.lib,['ES2020']);assert.deepEqual(config.compilerOptions.types,[]);
  assert.equal(ts.version,COMPILER_VERSION);assert.equal(compiled().artifacts.length,ENTRIES.length);
  for(const entry of compiled().artifacts){
    assert.equal(normalize(fs.readFileSync(entry.outputPath,'utf8')),entry.artifact);
    assert.ok(entry.artifact.includes('Generated from '+entry.source));
    assert.ok(entry.artifact.includes('exports.'+entry.factory));assert.ok(!/\brequire\s*\(/.test(entry.artifact));
    const source=fs.readFileSync(path.join(ROOT,entry.source),'utf8');
    assert.match(source,/export function create/);assert.match(source,/: unknown/);
  }
});

test('browser and CommonJS loaders expose identical frozen API without leaking factory globals',()=>{
  const result=compiled();
  for(const entry of result.artifacts){
    const {api,context}=browserAPI(entry),native=require(entry.outputPath);
    assert.ok(Object.isFrozen(api));assert.ok(Object.isFrozen(native));assert.equal(api.apiVersion,native.apiVersion);
    assert.deepEqual(Object.keys(api).sort(),Object.keys(native).sort());
    assert.deepEqual(Object.keys(context),[entry.global]);assert.equal(context[entry.factory],undefined);
  }
  const entry=result.artifacts.find(value=>value.global==='DomainSources'),{api}=browserAPI(entry),native=require(entry.outputPath);
  const db={repairs:[{id:1,vehicleId:'v',invoiceDate:'2026-10-20',cost:'10000'}],workOrders:[{id:'w',status:'accepted',actualCost:10000,repairId:1}]};
  assert.deepEqual(plain(api.projectFinancialSources(db)),plain(native.projectFinancialSources(db)));
  assert.deepEqual(plain(api.projectTankFlows({fuelMovements:[{id:'r',date:'2026-10-20',toTankId:'t',qty:100}]},['t'])),plain(native.projectTankFlows({fuelMovements:[{id:'r',date:'2026-10-20',toTankId:'t',qty:100}]},['t'])));
});

test('public DTO types reject incompatible amounts, source names and identifiers',()=>{
  const diagnostics=probeDiagnostics(`
    import {createDomainSources, type FinancialProjection, type TankFlowEntry} from './src/core/financial-recognition';
    const api=createDomainSources();
    const projection:FinancialProjection=api.projectFinancialSources({});
    const amount:number|undefined=projection.sources[0]?.sum;
    const entry:TankFlowEntry|undefined=api.projectTankFlows({},['tank'])[0];
    const movement:number|undefined=entry?.amount;
    void amount;void movement;
    // @ts-expect-error amounts are numbers, not formatted strings
    const invalidAmount:string=projection.sources[0]!.sum;
    // @ts-expect-error arbitrary source names are not recognized financial DTOs
    const invalidSource:'other-source'=projection.sources[0]!.source;
    // @ts-expect-error objects cannot identify source documents
    api.sourceKey('repair',{});
    void invalidAmount;void invalidSource;
  `);
  assert.deepEqual(diagnostics.map(value=>ts.flattenDiagnosticMessageText(value.messageText,'\n')),[]);
  const invalid=probeDiagnostics(`import {createDomainSources} from './src/core/financial-recognition';
    const wrong:string=createDomainSources().projectFinancialSources({}).sources[0]!.sum;void wrong;`);
  assert.ok(invalid.some(value=>value.code===2322),'actual TS compilation must reject number-to-string assignment');
});

test('unknown JSON boundaries reject invalid money, references and dates without coercing objects into facts',()=>{
  const api=require('../assets/core/financial-recognition.js');
  for(const input of [null,undefined,false,42,'database',[],{repairs:[null,false,42,[],{id:{bad:true},cost:100}]}])
    assert.deepEqual(api.projectFinancialSources(input),{sources:[],excluded:[]});
  const db={repairs:[{id:'bad-money',invoiceDate:'2026-10-20',cost:[10000]},
    {id:'bad-date',invoiceDate:'2026-02-30',cost:10}],workOrders:[{id:'bad-link',status:'accepted',actualCost:100,repairId:{id:'repair'}}]};
  const before=JSON.stringify(db),result=api.projectFinancialSources(db);
  assert.deepEqual(result.sources,[]);assert.deepEqual(result.excluded.map(row=>row.code),['unvalued-source','invalid-source-date','invalid-source-reference']);
  assert.equal(JSON.stringify(db),before);assert.throws(()=>api.sourceKey('repair',Infinity),TypeError);
});

test('typed tank projection validates periods, signed quantities and numeric legacy identifiers at runtime',()=>{
  const api=require('../assets/core/financial-recognition.js');
  const db={tankIncomes:[{id:1,tankId:10,date:'2026-09-01',amount:'30'}],fuelMovements:[
    {id:'bad-bool',toTankId:10,date:'2026-09-01',qty:true},
    {id:'bad-array',toTankId:10,date:'2026-09-01',qty:[900]},
    {id:'bad-infinity',toTankId:10,date:'2026-09-01',qty:Infinity},
    {id:'reversal',fromTankId:10,date:'2026-09-02',qty:10,originalMovementId:1}]};
  const result=api.projectTankFlows(db,[10],{from:'2026-09-01',to:'2026-09-30'});
  assert.deepEqual(result.map(row=>[row.sourceId,row.amount]),[[1,30],['reversal',-10]]);
  assert.equal(result[1].originalMovementId,1);assert.deepEqual(api.projectTankFlows(db,[10],{from:'',to:''}),result);
  assert.throws(()=>api.projectTankFlows(db,[10],{from:'2026-02-30'}),TypeError);
  assert.throws(()=>api.projectTankFlows(db,[10],{from:'2026-09-30',to:'2026-09-01'}),TypeError);
});

test('typed API projections own their output and accept frozen inputs without mutation',()=>{
  const api=require('../assets/core/financial-recognition.js');
  const repair=Object.freeze({id:'r',vehicleId:'v',invoiceDate:'2026-10-20',cost:10000});
  const db=Object.freeze({repairs:Object.freeze([repair])}),result=api.projectFinancialSources(db);
  result.sources[0].sum=1;result.sources.push({...result.sources[0]});
  assert.equal(api.projectFinancialSources(db).sources[0].sum,10000);assert.equal(db.repairs[0].cost,10000);
});

test('check mode validates all generated files without changing them',()=>{
  const before=ENTRIES.map(entry=>fs.readFileSync(path.join(ROOT,entry.output),'utf8'));
  const run=spawnSync(process.execPath,[path.join(ROOT,'scripts/build-typed-core.cjs'),'--check'],{cwd:ROOT,encoding:'utf8'});
  assert.equal(run.status,0,run.stdout+run.stderr);
  assert.deepEqual(ENTRIES.map(entry=>fs.readFileSync(path.join(ROOT,entry.output),'utf8')),before);
  const invalid=spawnSync(process.execPath,[path.join(ROOT,'scripts/build-typed-core.cjs'),'--unknown'],{cwd:ROOT,encoding:'utf8'});
  assert.equal(invalid.status,1);assert.match(invalid.stderr,/Usage:/);
});
