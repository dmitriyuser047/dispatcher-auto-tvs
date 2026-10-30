'use strict';
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
function inspect(ts,sources,read=file=>fs.readFileSync(path.join(ROOT,file),'utf8')){
 const allowed={
  'application/contracts':[],
  'application/repository':['application/contracts'],
  'application/save-service':['application/contracts','application/repository'],
  'application/row-commands':['application/contracts','application/repository','application/save-service'],
  'application/card-controller':['application/contracts','application/repository'],
  'features/maintenance-setup/model':['application/contracts'],
  'features/maintenance-setup/view':['features/maintenance-setup/model','application/contracts'],
  'features/maintenance-setup/controller':['application/contracts','application/repository','features/maintenance-setup/model','features/maintenance-setup/view'],
  'application/index':['application/contracts','application/repository','application/save-service','application/row-commands','application/card-controller','features/maintenance-setup/controller','features/maintenance-setup/view']
 },issues=[],edges=[],forbidden=new Set(['window','document','data','electronAPI','_sync','_lastPersisted','localStorage','require']);
 for(const file of sources){const name=file.replace(/^src\//,'').replace(/\.ts$/,''),source=ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true);if(!Object.hasOwn(allowed,name)){issues.push(file+': unregistered application module');continue;}
  function visit(node){
   if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node)&&node.moduleSpecifier){const value=node.moduleSpecifier.text,target=path.posix.normalize(path.posix.join(path.posix.dirname(name),value));edges.push({from:name,to:target});if(!value.startsWith('.')||!allowed[name].includes(target))issues.push(file+': forbidden dependency '+value);}
   if(node.kind===ts.SyntaxKind.AnyKeyword)issues.push(file+': explicit any is forbidden');
   if(ts.isIdentifier(node)&&forbidden.has(node.text))issues.push(file+': hidden global '+node.text);
   if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword)issues.push(file+': dynamic import is forbidden');ts.forEachChild(node,visit);
  }visit(source);
 }
 return {status:issues.length?'FAIL':'PASS',modules:sources.length,edges,issues};
}
function main(){const ts=require('typescript'),sources=require('./build-application.cjs').SOURCES,report=inspect(ts,sources);if(report.issues.length)throw Error(report.issues.join('\n'));console.log(JSON.stringify(report,null,2));}
module.exports={inspect};if(require.main===module)try{main();}catch(error){console.error(error.message);process.exitCode=1;}
