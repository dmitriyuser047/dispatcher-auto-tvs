/* Compile in memory; the explicit adapter preserves the public UMD contract. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..');
const COMPILER_VERSION='5.9.3';
const ENTRIES=Object.freeze([
  Object.freeze({source:'src/core/entity-identity.ts',output:'assets/core/entity-identity.js',global:'EntityIdentity',factory:'createEntityIdentity'}),
  Object.freeze({source:'src/core/decimal-core.ts',output:'assets/core/decimal-core.js',global:'DecimalCore',factory:'createDecimalCore'}),
  Object.freeze({source:'src/core/effective-periods.ts',output:'assets/core/effective-periods.js',global:'EffectivePeriods',factory:'createEffectivePeriods',dependencies:[{path:'./decimal-core.js',global:'DecimalCore'}]}),
  Object.freeze({source:'src/core/financial-recognition.ts',output:'assets/core/financial-recognition.js',global:'DomainSources',factory:'createDomainSources',dependencies:[{path:'./accounting-boundary.js',global:'AccountingBoundary'},{path:'./document-engine.js',global:'DocumentEngine',lazy:true},{path:'./fuel-stock.js',global:'FuelStock',lazy:true},{path:'./decimal-core.js',global:'DecimalCore'},{path:'./entity-identity.js',global:'EntityIdentity'},{path:'./writeoff-engine.js',global:'TvsWriteoffEngine',lazy:true}]}),
  Object.freeze({source:'src/core/accounting-boundary.ts',output:'assets/core/accounting-boundary.js',global:'AccountingBoundary',factory:'createAccountingBoundary'}),
  Object.freeze({source:'src/core/platform-contracts.ts',output:'assets/core/platform-contracts.js',global:'PlatformContracts',factory:'createPlatformContracts'}),
  Object.freeze({source:'src/core/document-engine.ts',output:'assets/core/document-engine.js',global:'DocumentEngine',factory:'createDocumentEngine',dependencies:[
    {path:'./platform-contracts.js',global:'PlatformContracts'}, {path:'./platform-schema.js',global:'PlatformSchema'},
    {path:'./entity-identity.js',global:'EntityIdentity'}, {path:'./decimal-core.js',global:'DecimalCore'},
    {path:'./platform-commands.js',global:'PlatformCommands',lazy:true}, {path:'./writeoff-engine.js',global:'TvsWriteoffEngine',lazy:true},
    {path:'./fuel-movement-policy.js',global:'FuelMovementPolicy',lazy:true},
    {path:'./platform-policies.js',global:'PlatformPolicies',lazy:true},
    {path:'./fuel-operations.js',global:'FuelOperations',lazy:true},
    {path:'./procurement-operations.js',global:'ProcurementOperations',lazy:true},
    {path:'./financial-recognition.js',global:'DomainSources',lazy:true},
    {path:'./repair-process.js',global:'RepairProcess',lazy:true},
  ]}),
  Object.freeze({source:'src/core/period-policy.ts',output:'assets/core/period-policy.js',global:'PeriodPolicy',factory:'createPeriodPolicy',dependencies:[
    {path:'./platform-contracts.js',global:'PlatformContracts'}, {path:'./platform-schema.js',global:'PlatformSchema'},
    {path:'./entity-identity.js',global:'EntityIdentity'}, {path:'./decimal-core.js',global:'DecimalCore'},
    {path:'./document-engine.js',global:'DocumentEngine',lazy:true}, {path:'./financial-recognition.js',global:'DomainSources',lazy:true},
    {path:'./temporal-policy.js',global:'TemporalPolicy',lazy:true}, {path:'./fuel-engine.js',global:'TvsFuelEngine',lazy:true},
    {path:'./writeoff-engine.js',global:'TvsWriteoffEngine',lazy:true}, {path:'./platform-policies.js',global:'PlatformPolicies',lazy:true},
    {path:'./cost-valuation.js',global:'CostValuation',lazy:true},
  ]}),
  Object.freeze({source:'src/core/fuel-stock.ts',output:'assets/core/fuel-stock.js',global:'FuelStock',factory:'createFuelStock',dependencies:[
    {path:'./platform-contracts.js',global:'PlatformContracts'}, {path:'./entity-identity.js',global:'EntityIdentity'},
    {path:'./decimal-core.js',global:'DecimalCore'}, {path:'./accounting-boundary.js',global:'AccountingBoundary'},
    {path:'./document-engine.js',global:'DocumentEngine',lazy:true}, {path:'./writeoff-engine.js',global:'TvsWriteoffEngine',lazy:true},
  ]}),
  Object.freeze({source:'src/core/fuel-operations.ts',output:'assets/core/fuel-operations.js',global:'FuelOperations',factory:'createFuelOperations',dependencies:[
    {path:'./platform-contracts.js',global:'PlatformContracts'}, {path:'./platform-schema.js',global:'PlatformSchema'},
    {path:'./entity-identity.js',global:'EntityIdentity'}, {path:'./decimal-core.js',global:'DecimalCore'},
    {path:'./fuel-stock.js',global:'FuelStock'}, {path:'./writeoff-engine.js',global:'TvsWriteoffEngine',lazy:true},
    {path:'./fuel-movement-policy.js',global:'FuelMovementPolicy',lazy:true}, {path:'./platform-policies.js',global:'PlatformPolicies',lazy:true},
    {path:'./document-engine.js',global:'DocumentEngine',lazy:true},
  ]}),
  Object.freeze({source:'src/core/inventory-stock.ts',output:'assets/core/inventory-stock.js',global:'InventoryStock',factory:'createInventoryStock',dependencies:[
    {path:'./platform-contracts.js',global:'PlatformContracts'}, {path:'./entity-identity.js',global:'EntityIdentity'},
    {path:'./decimal-core.js',global:'DecimalCore'}, {path:'./document-engine.js',global:'DocumentEngine',lazy:true},
  ]}),
  Object.freeze({source:'src/core/procurement-operations.ts',output:'assets/core/procurement-operations.js',global:'ProcurementOperations',factory:'createProcurementOperations',dependencies:[
    {path:'./platform-contracts.js',global:'PlatformContracts'}, {path:'./platform-schema.js',global:'PlatformSchema'},
    {path:'./entity-identity.js',global:'EntityIdentity'}, {path:'./decimal-core.js',global:'DecimalCore'},
    {path:'./inventory-stock.js',global:'InventoryStock',lazy:true}, {path:'./fuel-stock.js',global:'FuelStock',lazy:true},
    {path:'./document-engine.js',global:'DocumentEngine',lazy:true}, {path:'./writeoff-engine.js',global:'TvsWriteoffEngine',lazy:true},
    {path:'./platform-policies.js',global:'PlatformPolicies',lazy:true},
  ]}),
  Object.freeze({source:'src/core/cost-valuation.ts',output:'assets/core/cost-valuation.js',global:'CostValuation',factory:'createCostValuation',dependencies:[
    {path:'./platform-contracts.js',global:'PlatformContracts'}, {path:'./entity-identity.js',global:'EntityIdentity'},
    {path:'./decimal-core.js',global:'DecimalCore'}, {path:'./accounting-boundary.js',global:'AccountingBoundary'},
    {path:'./fuel-stock.js',global:'FuelStock',lazy:true}, {path:'./inventory-stock.js',global:'InventoryStock',lazy:true},
    {path:'./fuel-engine.js',global:'TvsFuelEngine',lazy:true}, {path:'./fuel-movement-policy.js',global:'FuelMovementPolicy',lazy:true},
    {path:'./document-engine.js',global:'DocumentEngine',lazy:true}, {path:'./writeoff-engine.js',global:'TvsWriteoffEngine',lazy:true},
  ]}),
  Object.freeze({source:'src/core/cost-operations.ts',output:'assets/core/cost-operations.js',global:'CostOperations',factory:'createCostOperations',dependencies:[
    {path:'./platform-contracts.js',global:'PlatformContracts'}, {path:'./platform-schema.js',global:'PlatformSchema'},
    {path:'./entity-identity.js',global:'EntityIdentity'}, {path:'./decimal-core.js',global:'DecimalCore'},
    {path:'./cost-valuation.js',global:'CostValuation',lazy:true}, {path:'./financial-recognition.js',global:'DomainSources',lazy:true},
    {path:'./document-engine.js',global:'DocumentEngine',lazy:true}, {path:'./platform-policies.js',global:'PlatformPolicies',lazy:true},
    {path:'./writeoff-engine.js',global:'TvsWriteoffEngine',lazy:true},
  ]}),
  Object.freeze({source:'src/core/repair-process.ts',output:'assets/core/repair-process.js',global:'RepairProcess',factory:'createRepairProcess',dependencies:[
    {path:'./platform-contracts.js',global:'PlatformContracts'}, {path:'./entity-identity.js',global:'EntityIdentity'},
    {path:'./decimal-core.js',global:'DecimalCore'}, {path:'./document-engine.js',global:'DocumentEngine',lazy:true},
    {path:'./financial-recognition.js',global:'DomainSources',lazy:true}, {path:'./inventory-stock.js',global:'InventoryStock',lazy:true},
    {path:'./cost-valuation.js',global:'CostValuation',lazy:true},
  ]}),
  Object.freeze({source:'src/core/repair-operations.ts',output:'assets/core/repair-operations.js',global:'RepairOperations',factory:'createRepairOperations',dependencies:[
    {path:'./platform-contracts.js',global:'PlatformContracts'}, {path:'./platform-schema.js',global:'PlatformSchema'},
    {path:'./entity-identity.js',global:'EntityIdentity'}, {path:'./decimal-core.js',global:'DecimalCore'},
    {path:'./document-engine.js',global:'DocumentEngine',lazy:true}, {path:'./repair-process.js',global:'RepairProcess',lazy:true},
    {path:'./platform-policies.js',global:'PlatformPolicies',lazy:true}, {path:'./writeoff-engine.js',global:'TvsWriteoffEngine',lazy:true},
  ]}),
  Object.freeze({source:'src/core/platform-commands.ts',output:'assets/core/platform-commands.js',global:'PlatformCommands',factory:'createPlatformCommands',dependencies:[
    {path:'./platform-contracts.js',global:'PlatformContracts'}, {path:'./personnel-engine.js',global:'TvsPersonnelEngine'},
    {path:'./fuel-movement-policy.js',global:'FuelMovementPolicy'}, {path:'./fuel-engine.js',global:'TvsFuelEngine'},
    {path:'./catalog-merge.js',global:'MergeCatalog'}, {path:'./platform-schema.js',global:'PlatformSchema'},
    {path:'./document-engine.js',global:'DocumentEngine'},
    {path:'./period-policy.js',global:'PeriodPolicy'},
    {path:'./fuel-operations.js',global:'FuelOperations'},
    {path:'./procurement-operations.js',global:'ProcurementOperations'},
    {path:'./cost-operations.js',global:'CostOperations'},
    {path:'./repair-operations.js',global:'RepairOperations'},
  ]}),
]);
const normalize=text=>text.replace(/\r\n?/g,'\n');
function loadCompiler(){
  let ts;
  try{ts=require('typescript');}
  catch{throw Error('TypeScript '+COMPILER_VERSION+' is required. Install the project devDependencies before building typed core.');}
  if(ts.version!==COMPILER_VERSION)throw Error('Expected TypeScript '+COMPILER_VERSION+', received '+ts.version+'. Use the pinned project dependency.');
  return ts;
}
function compileTypedCore(){
  const ts=loadCompiler(),configFile=path.join(ROOT,'tsconfig.core.json');
  const format=diagnostics=>ts.formatDiagnosticsWithColorAndContext(diagnostics,{
    getCurrentDirectory:()=>ROOT,getCanonicalFileName:file=>file,getNewLine:()=> '\n',
  });
  const loaded=ts.readConfigFile(configFile,ts.sys.readFile);
  if(loaded.error)throw Error(format([loaded.error]));
  const config=ts.parseJsonConfigFileContent(loaded.config,ts.sys,ROOT,undefined,configFile);
  if(config.errors.length)throw Error(format(config.errors));
  const expectedSources=new Set(ENTRIES.map(entry=>path.join(ROOT,entry.source)));
  if(config.fileNames.length!==ENTRIES.length||config.fileNames.some(file=>!expectedSources.has(path.resolve(file))))
    throw Error('Typed core config must compile exactly the explicit entries declared in the builder.');
  const program=ts.createProgram(config.fileNames,config.options),emitted=[];
  const diagnostics=ts.getPreEmitDiagnostics(program);
  if(diagnostics.length)throw Error(format(diagnostics));
  const result=program.emit(undefined,(filename,text)=>emitted.push({filename,text}));
  if(result.emitSkipped||result.diagnostics.length)throw Error(format(result.diagnostics)||'Typed core emit was skipped.');
  if(emitted.length!==ENTRIES.length)throw Error('Typed core must emit one JavaScript file per entry, without runtime imports.');
  const artifacts=ENTRIES.map(entry=>{
    const matches=emitted.filter(file=>path.basename(file.filename)===path.basename(entry.output));
    if(matches.length!==1)throw Error('Missing or duplicate generated typed entry: '+entry.source);
    const javascript=normalize(matches[0].text).trimEnd();
    if(/\brequire\s*\(/.test(javascript))throw Error('Typed core must remain dependency-free at runtime: '+entry.source);
    const digest=crypto.createHash('sha256').update(normalize(fs.readFileSync(path.join(ROOT,entry.source),'utf8'))+'\0'
      +normalize(fs.readFileSync(configFile,'utf8'))+'\0'+ts.version+'\0'+JSON.stringify(entry)).digest('hex');
    const dependencies=entry.dependencies||[];
    const artifact='/* Generated from '+entry.source+' by scripts/build-typed-core.cjs.\n'
      +' * TypeScript '+ts.version+'; source/config sha256:'+digest+'. Do not edit this file directly. */\n'
      +'(function(root,factory){\n'
      +"  if(typeof module==='object'&&module.exports)module.exports=factory("+dependencies.map(dependency=>(dependency.lazy?'()=>':'')+"require('"+dependency.path+"')").join(',')+");\n"
      +'  else root.'+entry.global+'=factory('+dependencies.map(dependency=>(dependency.lazy?'()=>':'')+'root.'+dependency.global).join(',')+');\n'
      +"})(typeof globalThis==='object'?globalThis:this,function(){\n"
      +"  'use strict';\n  const exports={};\n"
      +javascript.split('\n').map(line=>'  '+line).join('\n')+'\n'
      +'  return exports.'+entry.factory+'('+dependencies.map((_,index)=>'arguments['+index+']').join(',')+');\n});\n';
    return {...entry,artifact,outputPath:path.join(ROOT,entry.output)};
  });
  return {artifacts,compilerVersion:ts.version};
}
function main(args){
  if(args.some(arg=>arg!=='--check')||new Set(args).size!==args.length)throw Error('Usage: node scripts/build-typed-core.cjs [--check]');
  const result=compileTypedCore();
  if(args.includes('--check')){
    const stale=result.artifacts.filter(entry=>!fs.existsSync(entry.outputPath)||normalize(fs.readFileSync(entry.outputPath,'utf8'))!==entry.artifact);
    if(stale.length)throw Error('Generated typed core is out of date ('+stale.map(entry=>entry.output).join(', ')+'). Run npm run build:typed-core and review its diff.');
    process.stdout.write('Typed core types and generated UMD are current (TypeScript '+result.compilerVersion+').\n');return;
  }
  result.artifacts.forEach(entry=>fs.writeFileSync(entry.outputPath,entry.artifact,'utf8'));
  process.stdout.write('Built '+result.artifacts.length+' typed core UMD modules from strict TypeScript '+result.compilerVersion+'.\n');
}
module.exports={compileTypedCore,COMPILER_VERSION,ENTRIES};
if(require.main===module){try{main(process.argv.slice(2));}catch(error){process.stderr.write((error instanceof Error?error.message:String(error))+'\n');process.exitCode=1;}}
