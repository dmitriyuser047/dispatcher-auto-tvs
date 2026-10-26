'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..'),SOURCES=['src/ui/asset-inventory.ts','src/ui/asset-inventory-host.ts','src/ui/asset-inventory-files.ts','src/ui/inventory-documents.ts','src/ui/inventory-photos.ts'],CONFIG='tsconfig.inventory-ui.json',OUTPUT='assets/js/69-asset-inventory.js';
function compileInventoryUI(){
 const ts=require('typescript');if(ts.version!=='5.9.3')throw Error('Expected pinned TypeScript 5.9.3, received '+ts.version);
 const file=path.join(ROOT,CONFIG),loaded=ts.readConfigFile(file,ts.sys.readFile),format=ds=>ts.formatDiagnosticsWithColorAndContext(ds,{getCurrentDirectory:()=>ROOT,getCanonicalFileName:f=>f,getNewLine:()=> '\n'});
 if(loaded.error)throw Error(format([loaded.error]));const config=ts.parseJsonConfigFileContent(loaded.config,ts.sys,ROOT,undefined,file);
 if(config.errors.length)throw Error(format(config.errors));if(config.fileNames.length!==SOURCES.length||config.fileNames.some((name,index)=>path.resolve(name)!==path.join(ROOT,SOURCES[index])))throw Error('Inventory UI must compile exactly its explicit UI, host and files TypeScript sources, in that order.');
 const program=ts.createProgram(config.fileNames,config.options),diagnostics=ts.getPreEmitDiagnostics(program),output=[];if(diagnostics.length)throw Error(format(diagnostics));
 const emitted=program.emit(undefined,(name,text)=>output.push({name,text}));if(emitted.emitSkipped||emitted.diagnostics.length||output.length!==1)throw Error(format(emitted.diagnostics)||'Expected one inventory UI artifact.');
 const normalize=text=>text.replace(/\r\n?/g,'\n'),digest=crypto.createHash('sha256').update(SOURCES.map(source=>source+'\0'+normalize(fs.readFileSync(path.join(ROOT,source),'utf8'))).join('\0')+'\0'+normalize(fs.readFileSync(file,'utf8'))+'\0'+ts.version).digest('hex');
 return {artifact:'/* Generated from '+SOURCES.join(', ')+' by scripts/build-inventory-ui.cjs.\n * TypeScript '+ts.version+'; source/config sha256:'+digest+'. Do not edit directly. */\n'+normalize(output[0].text),output:path.join(ROOT,OUTPUT)};
}
function main(args){if(args.some(arg=>arg!=='--check')||new Set(args).size!==args.length)throw Error('Usage: node scripts/build-inventory-ui.cjs [--check]');const result=compileInventoryUI();if(args.includes('--check')){if(!fs.existsSync(result.output)||fs.readFileSync(result.output,'utf8').replace(/\r\n?/g,'\n')!==result.artifact)throw Error('Generated inventory UI is stale; run node scripts/build-inventory-ui.cjs.');process.stdout.write('Strict TypeScript inventory UI and generated artifact are current.\n');}else{fs.writeFileSync(result.output,result.artifact,'utf8');process.stdout.write('Built strict TypeScript inventory UI.\n');}}
module.exports={compileInventoryUI};if(require.main===module){try{main(process.argv.slice(2));}catch(error){process.stderr.write((error instanceof Error?error.message:String(error))+'\n');process.exitCode=1;}}
