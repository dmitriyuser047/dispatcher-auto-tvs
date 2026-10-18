'use strict';
// Check every packed/unpacked file: an interrupted pack can leave correctly
// sized NUL-filled assets, which comparing application sources alone misses.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const asar=require('@electron/asar');
const root=path.resolve(__dirname,'..'),metadata=require('../package.json');
const archive=path.resolve(process.env.TVS_PACKAGED_ASAR||path.join(root,'dist/win-unpacked/resources/app.asar'));
const reportPath=path.join(root,'audit','prototype-package-source.json');
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const report={version:metadata.version,status:'FAIL',at:new Date().toISOString(),archive,files:[],published:false,autoUpdates:false};
function check(condition,message){if(!condition)throw Error(message);}
function archiveFile(file){return asar.extractFile(archive,path.normalize(file));}
function inside(base,file){const relative=path.relative(base,file);return relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);}

function verifyArchiveIntegrity(){
  const entries=[];
  function visit(node,prefix=''){
    for(const [name,entry] of Object.entries(node.files||{})){
      check(name!=='.'&&name!=='..'&&!/[\\/]/.test(name),'Unsafe ASAR header path');
      const file=prefix?prefix+'/'+name:name;
      if(entry.files)visit(entry,file);else entries.push({file,entry});
    }
  }
  visit(asar.getRawHeader(archive).header);
  const result={files:0,bytes:0,unpackedFiles:0,unpackedBytes:0,mismatches:[]};
  for(const {file,entry} of entries){
    if(entry.link)continue;
    result.files++;result.bytes+=entry.size;
    if(entry.unpacked){result.unpackedFiles++;result.unpackedBytes+=entry.size;}
    try{
      check(entry.integrity?.algorithm==='SHA256'&&/^[a-f0-9]{64}$/i.test(entry.integrity.hash),'Missing SHA256 integrity');
      const built=archiveFile(file);
      check(built.length===entry.size,'Size differs from ASAR header');
      check(digest(built)===entry.integrity.hash,'SHA256 differs from ASAR header');
      if(entry.unpacked){
        const physical=path.join(archive+'.unpacked',path.normalize(file));
        check(inside(archive+'.unpacked',physical),'Unpacked asset escapes directory');
        const stat=fs.lstatSync(physical);
        check(stat.isFile()&&!stat.isSymbolicLink(),'Unpacked asset is not a regular file');
        check(stat.size===entry.size,'Physical unpacked size differs');
      }
    }catch(error){result.mismatches.push({file,unpacked:!!entry.unpacked,error:error.message});}
  }
  report.integrity=result;
  check(!result.mismatches.length,'Package integrity failed for '+result.mismatches.length+' file(s): '+result.mismatches.slice(0,8).map(item=>item.file).join(', '));
  return entries;
}

function verifyStagingDependencies(entries){
  const ledger=JSON.parse(fs.readFileSync(path.join(root,'audit','installer-stage-'+metadata.version+'.json'),'utf8'));
  check(ledger.version===metadata.version,'Staging ledger version differs');
  const stage=path.resolve(ledger.stagePath);
  check(inside(root,stage)&&path.basename(stage).startsWith('.builder-stage-'),'Unsafe staging directory');
  const critical=new Set(['@napi-rs/canvas','@napi-rs/canvas-win32-x64-msvc','pdfjs-dist','tesseract.js','tesseract.js-core','@embedpdf/pdfium','exceljs','jszip','adm-zip','node-unrar-js','@pdf-lib/fontkit','pdf-lib','iconv-lite']);
  const packages=[];
  for(const {file} of entries){
    if(!file.startsWith('node_modules/')||!file.endsWith('/package.json'))continue;
    const pkg=JSON.parse(archiveFile(file).toString('utf8'));
    if(critical.has(pkg.name))packages.push({name:pkg.name,version:pkg.version,directory:file.slice(0,-'/package.json'.length)});
  }
  const available=new Set(entries.map(item=>item.file)),verified=[];
  for(const name of critical){
    const stages=ledger.modules.filter(module=>module.name===name);
    check(stages.length,'Critical dependency missing from staging ledger: '+name);
    for(const module of stages){
      const candidates=packages.filter(pkg=>pkg.name===name&&pkg.version===module.version);
      check(candidates.length,'Critical dependency missing from package: '+name+'@'+module.version);
      const sourceRoot=path.join(stage,path.normalize(module.destination));
      check(inside(stage,sourceRoot),'Dependency escapes staging directory');
      check(digest(fs.readFileSync(path.join(sourceRoot,'package.json')))===module.packageJsonSha256,'Staging package metadata changed: '+name);
      let files=0,bytes=0;
      function visit(directory,relative=''){
        for(const item of fs.readdirSync(directory)){
          if(item==='node_modules')continue;
          const source=path.join(directory,item),tail=relative?relative+'/'+item:item;
          if(fs.statSync(source).isDirectory()){visit(source,tail);continue;}
          // The builder cleans package metadata and omits documentation; code
          // and runtime data must retain the exact staged bytes.
          if(path.basename(tail)==='package.json'||/^(?:examples?|tests?|__tests__|benchmarks?|docs?)\//.test(tail)||tail==='karma.conf.js'||! /\.(?:js|mjs|cjs|json|node|wasm|dat|traineddata)$/i.test(tail))continue;
          const packagedFile=candidates.map(pkg=>pkg.directory+'/'+tail).find(file=>available.has(file));
          check(packagedFile,'Critical dependency file missing: '+name+'/'+tail);
          const sourceBytes=fs.readFileSync(source),built=archiveFile(packagedFile);
          check(digest(sourceBytes)===digest(built),'Critical dependency differs from staging: '+packagedFile);
          files++;bytes+=built.length;
        }
      }
      visit(sourceRoot);
      verified.push({name,version:module.version,files,bytes});
    }
  }
  report.stagingDependencies=verified;
}

try{
  const entries=verifyArchiveIntegrity();
  const packaged=JSON.parse(archiveFile('package.json').toString('utf8'));
  check(metadata.prototype&&packaged.prototype&&packaged.name===metadata.name&&packaged.version===metadata.version,'Wrong prototype package identity');
  const paths=['index.html','reestr-window.html','pdf-editor.html','ReestrBuilder/lib.mjs'];
  function walk(directory){for(const name of fs.readdirSync(path.join(root,directory))){const file=path.join(directory,name);if(fs.statSync(path.join(root,file)).isDirectory())walk(file);else if(/\.(?:js|mjs|cjs|css)$/.test(file))paths.push(file.replaceAll('\\','/'));}}
  for(const directory of ['electron','assets/js','assets/css'])walk(directory);
  for(const file of paths){const source=fs.readFileSync(path.join(root,file)),built=archiveFile(file);check(digest(source)===digest(built),'Package differs from current source: '+file);report.files.push({file,sha256:digest(built)});}
  check(!entries.some(({file})=>file==='bundled-data/data-2.0.57.json'),'Working database must not be packaged');
  verifyStagingDependencies(entries);
  report.archiveSha256=digest(fs.readFileSync(archive));
  report.status='PASS';
}catch(error){report.error=error.stack||error.message;process.exitCode=1;}
fs.mkdirSync(path.dirname(reportPath),{recursive:true});
fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify({version:metadata.version,status:report.status,files:report.files.length,integrity:report.integrity,stagingDependencies:report.stagingDependencies?.length,error:report.status==='FAIL'?report.error:undefined})+'\n');
