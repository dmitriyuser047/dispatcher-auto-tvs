'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const ROOT=path.resolve(__dirname,'../..'),SOURCE=path.join(ROOT,'src/core/platform-compatibility.ts');
let compiled;
function compile(){
 if(compiled)return compiled;
 const config=ts.readConfigFile(path.join(ROOT,'tsconfig.core.json'),ts.sys.readFile);if(config.error)throw Error(ts.flattenDiagnosticMessageText(config.error.messageText,'\n'));
 const rootOptions=ts.parseJsonConfigFileContent(config.config,ts.sys,ROOT).options,options={...rootOptions,rootDir:path.dirname(SOURCE),outDir:path.join(__dirname,'../__memory_only__'),noEmit:false};
 const host=ts.createCompilerHost(options);let artifact='';host.writeFile=(filename,text)=>{if(filename.endsWith('platform-compatibility.js'))artifact=text;};const program=ts.createProgram([SOURCE],options,host),emitted=program.emit(),diagnostics=[...ts.getPreEmitDiagnostics(program),...emitted.diagnostics];
 if(diagnostics.length)throw Error(ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCurrentDirectory:()=>ROOT,getCanonicalFileName:value=>value,getNewLine:()=> '\n'}));if(emitted.emitSkipped||!artifact)throw Error('Strict compatibility compilation produced no artifact');
 const context=vm.createContext({exports:{}});new vm.Script('(function(exports){\n'+artifact+'\n})(exports);',{filename:SOURCE}).runInContext(context);compiled={artifact,options,exports:context.exports,source:fs.readFileSync(SOURCE,'utf8')};return compiled;
}
function api(){return require(path.join(ROOT,'assets/core/platform-compatibility.js'));}
const plain=value=>JSON.parse(JSON.stringify(value)),CURRENT=require(path.join(ROOT,'electron/storage-format.cjs')).SCHEMA_VERSION;
function fixture(schemaVersion=CURRENT){const module=api(),description=plain(module.describe());return {module,hello:description.hello,server:description.serverProfile,descriptor:require(path.join(ROOT,'electron/storage-format.cjs')).describe(schemaVersion)};}
module.exports={ROOT,SOURCE,compile,api,plain,fixture,CURRENT};
