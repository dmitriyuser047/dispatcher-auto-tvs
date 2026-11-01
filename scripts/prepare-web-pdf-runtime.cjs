'use strict';
// Copy the already installed Windows Electron distribution. This is an offline
// packaging step: it never launches Electron, opens a database or downloads files.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const DEFAULT_SOURCE=path.resolve(__dirname,'../node_modules/electron/dist');
const PRIVATE_FILE=/^(?:\.env(?:\..*)?|users\.json|server-users\.json|data\.json|settings\.json|credentials(?:\..*)?|secrets(?:\..*)?)$|\.(?:sqlite|sqlite3|db)(?:-(?:wal|shm|journal))?$|\.(?:key|pem|pfx|p12)$/i;
const fail=message=>{throw Error(message);};
const slash=value=>value.split(path.sep).join('/');
const fold=value=>process.platform==='win32'?value.toLowerCase():value;
function inside(parent,target){const relative=path.relative(fold(parent),fold(target));return relative===''||!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep);}
function overlaps(left,right){return inside(left,right)||inside(right,left);}
function absolute(value,label){
  if(typeof value!=='string'||!value||!path.isAbsolute(value)||value.includes('\0')||/^[\\/]{2}/.test(value))fail(label+': нужен абсолютный путь на локальном диске.');
  const filename=path.resolve(value);
  if(process.platform==='win32'&&path.relative(path.parse(filename).root,filename).split(path.sep).some(part=>/[<>:"|?*\x00-\x1f]/.test(part)))fail(label+': недопустимые символы в пути.');
  return filename;
}
function noLinks(filename,{missingLeaf=false}={}){
  const resolved=path.resolve(filename),root=path.parse(resolved).root;let current=root;
  for(const part of path.relative(root,resolved).split(path.sep).filter(Boolean)){
    current=path.join(current,part);let stat;
    try{stat=fs.lstatSync(current);}catch(error){if(missingLeaf&&error.code==='ENOENT'&&current===resolved)return;throw error;}
    if(stat.isSymbolicLink())fail('Ссылки и junction для PDF runtime запрещены: '+current);
  }
}
function directory(filename){noLinks(filename);if(!fs.lstatSync(filename).isDirectory())fail('Нужен обычный каталог Electron.');return fs.realpathSync.native(filename);}
function managedDatabase(filename){return fs.existsSync(path.join(filename,'platform.sqlite'))||fs.existsSync(path.join(filename,'sections','revisions.json'));}
function outsideDatabase(filename){for(let current=filename;;current=path.dirname(current)){if(managedDatabase(current))fail('PDF runtime нельзя размещать или брать внутри рабочей базы.');if(path.dirname(current)===current)break;}}
function hashFile(filename){
  const hash=crypto.createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024),fd=fs.openSync(filename,'r');
  try{let count;while((count=fs.readSync(fd,buffer,0,buffer.length,null))!==0)hash.update(buffer.subarray(0,count));return hash.digest('hex');}finally{fs.closeSync(fd);}
}
function inspectPdfRuntime(source=DEFAULT_SOURCE){
  const sourceRoot=directory(absolute(source,'Источник Electron'));outsideDatabase(sourceRoot);
  const files=[],directories=[];
  function walk(folder){
    noLinks(folder);
    for(const name of fs.readdirSync(folder).sort()){
      const filename=path.join(folder,name),relative=slash(path.relative(sourceRoot,filename)),stat=fs.lstatSync(filename);
      if(stat.isSymbolicLink())fail('Ссылка в Electron distribution запрещена: '+relative);
      if(PRIVATE_FILE.test(name))fail('Приватный файл не должен входить в Electron distribution: '+relative);
      if(stat.isDirectory()){directories.push(relative);walk(filename);}
      else if(stat.isFile())files.push({source:filename,path:relative,stat:{dev:stat.dev,ino:stat.ino,size:stat.size,mtimeMs:stat.mtimeMs}});
      else fail('Необычный файл в Electron distribution: '+relative);
    }
  }
  walk(sourceRoot);
  const names=new Set(files.map(file=>file.path));
  for(const required of ['electron.exe','version','icudtl.dat','resources.pak'])if(!names.has(required)||files.find(file=>file.path===required).stat.size===0)fail('Неполный Windows Electron distribution: отсутствует или пуст '+required+'.');
  if(!files.some(file=>file.path.startsWith('locales/')&&file.path.endsWith('.pak'))||!files.some(file=>file.path.startsWith('resources/'))||!files.some(file=>!file.path.includes('/')&&file.path.endsWith('.dll')))fail('Неполный Windows Electron distribution: нужны locales, resources и DLL.');
  const versionFile=files.find(file=>file.path==='version');
  if(versionFile.stat.size<1||versionFile.stat.size>256)fail('Некорректный файл версии Electron.');
  const version=fs.readFileSync(versionFile.source,'utf8').trim();
  if(!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/.test(version))fail('Некорректная версия Electron.');
  const exe=files.find(file=>file.path==='electron.exe'),fd=fs.openSync(exe.source,'r'),signature=Buffer.alloc(2);
  try{if(fs.readSync(fd,signature,0,2,0)!==2||signature.toString('ascii')!=='MZ')fail('Нужен Windows electron.exe.');}finally{fs.closeSync(fd);}
  if(names.has('pdf-runtime-manifest.json'))fail('Исходный Electron distribution уже содержит служебный PDF manifest.');
  return {source:sourceRoot,version,files,directories};
}
function checkTarget(target,source,protectedPaths){
  noLinks(path.dirname(target));if(!fs.statSync(path.dirname(target)).isDirectory())fail('Родительская папка назначения должна существовать.');
  noLinks(target,{missingLeaf:true});outsideDatabase(target);
  if(overlaps(target,source))fail('Назначение PDF runtime не должно пересекаться с источником Electron.');
  for(const protectedPath of protectedPaths)if(overlaps(target,protectedPath))fail('Назначение PDF runtime пересекается с защищённым каталогом.');
  if(fs.existsSync(target)&&(!fs.statSync(target).isDirectory()||fs.readdirSync(target).length))fail('Папка PDF runtime должна быть новой или пустой; существующие файлы сохранены.');
}
function preparePdfRuntime(options={}){
  const target=absolute(options.target,'Назначение PDF runtime'),inspected=inspectPdfRuntime(options.source);
  if(!Array.isArray(options.protectedPaths||[]))fail('protectedPaths должен быть массивом.');
  const protectedPaths=(options.protectedPaths||[]).map(value=>{const filename=absolute(value,'Защищённый путь');noLinks(filename,{missingLeaf:true});return fs.existsSync(filename)?fs.realpathSync.native(filename):filename;});
  checkTarget(target,inspected.source,protectedPaths);
  if(!fs.existsSync(target))fs.mkdirSync(target);
  const installationRoot=fs.realpathSync.native(target);
  function ensureDestination(filename){
    if(!inside(installationRoot,path.resolve(filename)))fail('Файл PDF runtime выходит из назначения.');
    noLinks(installationRoot);if(fs.realpathSync.native(target)!==installationRoot)fail('Назначение PDF runtime изменилось.');
    let current=installationRoot;
    for(const part of path.relative(installationRoot,path.dirname(filename)).split(path.sep).filter(Boolean)){
      current=path.join(current,part);if(!fs.existsSync(current))fs.mkdirSync(current);noLinks(current);
      if(!fs.statSync(current).isDirectory())fail('Каталог PDF runtime занят файлом.');
    }
  }
  const files=[];
  for(const relative of inspected.directories)ensureDestination(path.join(installationRoot,...relative.split('/'),'.directory-check'));
  for(const item of inspected.files){
    noLinks(item.source);const before=fs.lstatSync(item.source);
    if(!before.isFile()||Object.keys(item.stat).some(key=>before[key]!==item.stat[key]))fail('Исходный Electron distribution изменился.');
    const destination=path.join(installationRoot,...item.path.split('/'));ensureDestination(destination);
    fs.copyFileSync(item.source,destination,fs.constants.COPYFILE_EXCL);
    const after=fs.lstatSync(item.source);if(Object.keys(item.stat).some(key=>after[key]!==item.stat[key]))fail('Исходный Electron distribution изменился при копировании.');
    files.push({path:item.path,bytes:fs.statSync(destination).size,sha256:hashFile(destination)});
  }
  const manifest={format:'tvs-web-pdf-runtime',manifestVersion:1,electronVersion:inspected.version,executable:'electron.exe',networkUsed:false,businessDataCopied:false,directories:inspected.directories,files};
  const manifestFile=path.join(installationRoot,'pdf-runtime-manifest.json');ensureDestination(manifestFile);fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  return {target:installationRoot,executable:path.join(installationRoot,'electron.exe'),version:inspected.version,files:files.length,bytes:files.reduce((sum,file)=>sum+file.bytes,0),manifestFile,manifest};
}
function parseArgs(argv){
  const options={};
  for(let index=0;index<argv.length;index++){
    const flag=argv[index];if(flag==='--help'){options.help=true;continue;}
    if(!['--target','--source'].includes(flag)||!argv[index+1]||argv[index+1].startsWith('--'))fail('Использование: node scripts/prepare-web-pdf-runtime.cjs --target ABS [--source ABS]');
    const key=flag.slice(2);if(options[key])fail(flag+' задан дважды.');options[key]=argv[++index];
  }
  return options;
}
if(require.main===module){try{const options=parseArgs(process.argv.slice(2));if(options.help)process.stdout.write('node scripts/prepare-web-pdf-runtime.cjs --target ABS [--source ABS]\n');else{const {manifest,...result}=preparePdfRuntime(options);process.stdout.write(JSON.stringify(result,null,2)+'\n');}}catch(error){process.stderr.write('Подготовка PDF runtime: '+error.message+'\n');process.exitCode=1;}}
module.exports={preparePdfRuntime,inspectPdfRuntime,parseArgs};
