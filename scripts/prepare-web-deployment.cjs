'use strict';

// Copy a self-contained local web installation from the already installed
// production graph. This helper never installs packages, opens a business
// database, changes the source checkout, or removes an existing destination.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {createRequire} = require('node:module');
const {inspectPdfRuntime,preparePdfRuntime} = require('./prepare-web-pdf-runtime.cjs');

const EXCLUDED_DIRECTORIES = new Set([
  '.git','.hg','.svn','.local','.cache','.ssh','.aws','.azure',
  'node_modules','backups','backup','pending-operations','outbox','state',
  'private','credentials','secrets','tests','test','__tests__','fixtures',
  'coverage','docs','examples','benchmarks',
]);
const SECRET_FILES = /^(?:\.env(?:\..*)?|.*\.env|\.npmrc|\.yarnrc(?:\.yml)?|\.netrc|\.git-credentials|id_rsa|id_ed25519|settings\.json|server(?:-users)?\.json|users\.json|data\.json|credentials(?:\..*)?|secrets(?:\..*)?)$/i;
const PRIVATE_EXTENSIONS = /(?:\.(?:sqlite|sqlite3|db)(?:-(?:wal|shm|journal))?|\.(?:key|pem|pfx|p12))$/i;
const SHA = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const slash = value => value.split(path.sep).join('/');
const fail = message => { throw new Error(message); };

function inside(base, candidate) {
  const relative = path.relative(base, candidate);
  return relative === '' || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
function overlaps(left, right) { return inside(left,right) || inside(right,left); }
function absolute(value, label) {
  if (typeof value !== 'string' || !value || !path.isAbsolute(value) || value.includes('\0')) fail(label + ': требуется абсолютный путь.');
  const resolved=path.resolve(value);
  if(process.platform==='win32'&&path.relative(path.parse(resolved).root,resolved).split(path.sep).some(part=>/[<>:"|?*\x00-\x1f]/.test(part)))fail(label+': недопустимые символы в пути.');
  return resolved;
}
function noLinks(filename, {missingLeaf=false}={}) {
  const resolved = path.resolve(filename), root = path.parse(resolved).root;
  let current = root;
  for (const component of path.relative(root,resolved).split(path.sep).filter(Boolean)) {
    current = path.join(current,component);
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (error) { if (missingLeaf && error.code === 'ENOENT' && current === resolved) return; throw error; }
    if (stat.isSymbolicLink()) fail('Символические ссылки и junction не допускаются: ' + current);
  }
}
function directory(filename, label) {
  noLinks(filename);
  const stat = fs.lstatSync(filename);
  if (!stat.isDirectory()) fail(label + ': нужен обычный каталог.');
  return fs.realpathSync.native(filename);
}
function regular(filename, label) {
  noLinks(filename);
  const stat = fs.lstatSync(filename);
  if (!stat.isFile()) fail(label + ': нужен обычный файл.');
  return stat;
}
function readPackage(filename) {
  const stat = regular(filename,'package.json');
  if (stat.size > 4*1024*1024) fail('Слишком большой package.json.');
  const value = JSON.parse(fs.readFileSync(filename,'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Некорректный package.json.');
  return value;
}
function excludedFile(name) { return SECRET_FILES.test(name) || PRIVATE_EXTENSIONS.test(name); }
function packageName(name) {
  if (typeof name !== 'string' || !/^(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/i.test(name) || name.split('/').some(part=>part==='.'||part==='..')) fail('Небезопасное имя зависимости.');
  return name;
}
function dependencyNames(pkg) {
  const fields = ['dependencies','optionalDependencies'];
  for (const field of fields) if (pkg[field] !== undefined && (!pkg[field] || typeof pkg[field] !== 'object' || Array.isArray(pkg[field]))) fail('Некорректный список ' + field + '.');
  return [...new Set(fields.flatMap(field=>Object.keys(pkg[field]||{})))].map(packageName).sort();
}
function resolvePackage(name,parentSource) {
  const requireFromParent = createRequire(path.join(parentSource,'package.json'));
  let filename;
  try { filename = requireFromParent.resolve(name+'/package.json'); }
  catch (originalError) {
    for (const search of requireFromParent.resolve.paths(name)||[]) {
      const candidate = path.join(search,...name.split('/'),'package.json');
      if (fs.existsSync(candidate)) { filename=candidate; break; }
    }
    if (!filename) throw Object.assign(new Error('Не найдена установленная производственная зависимость '+name+' ('+originalError.code+').'),{code:'PRODUCTION_DEPENDENCY_MISSING'});
  }
  noLinks(filename);
  return directory(path.dirname(filename),'Каталог зависимости');
}
function isManagedDatabase(filename) {
  return fs.existsSync(path.join(filename,'platform.sqlite')) || fs.existsSync(path.join(filename,'sections','revisions.json'));
}
function checkTarget(target,sourceRoot,protectedPaths) {
  noLinks(path.dirname(target));
  if (!fs.statSync(path.dirname(target)).isDirectory()) fail('Родительский каталог назначения должен существовать.');
  noLinks(target,{missingLeaf:true});
  if (overlaps(target,sourceRoot)) fail('Каталог назначения не должен пересекаться с исходным проектом.');
  for (const protectedPath of protectedPaths) if (overlaps(target,protectedPath)) fail('Каталог назначения пересекается с защищённым каталогом данных.');
  for (let current=target;;current=path.dirname(current)) {
    if (isManagedDatabase(current)) fail('Установка внутри рабочей базы данных запрещена.');
    if (path.dirname(current)===current) break;
  }
  if (fs.existsSync(target) && (!fs.statSync(target).isDirectory() || fs.readdirSync(target).length)) fail('Каталог назначения должен быть новым или пустым. Существующие файлы не изменялись.');
}

function prepareWebDeployment(options={}) {
  const sourceRoot = directory(absolute(options.sourceRoot || path.resolve(__dirname,'..'),'Исходный проект'),'Исходный проект');
  const target = absolute(options.target,'Назначение');
  const runtimePath = absolute(options.runtimePath || process.execPath,'Исполняемый файл Node.js');
  regular(runtimePath,'Исполняемый файл Node.js');
  if(options.withPdf!==undefined&&typeof options.withPdf!=='boolean')fail('withPdf должен быть true или false.');
  // Inspect the complete native runtime before creating any destination files.
  const pdfSource=options.withPdf?inspectPdfRuntime(options.pdfSource||path.join(sourceRoot,'node_modules','electron','dist')).source:null;
  if (!Array.isArray(options.protectedPaths || [])) fail('protectedPaths должен быть массивом абсолютных путей.');
  const protectedPaths = (options.protectedPaths||[]).map(value=>{
    const filename=absolute(value,'Защищённый путь');
    noLinks(filename,{missingLeaf:true});
    return fs.existsSync(filename)?fs.realpathSync.native(filename):filename;
  });
  checkTarget(target,sourceRoot,[...protectedPaths,runtimePath,...(pdfSource?[pdfSource]:[])]);
  const metadata=readPackage(path.join(sourceRoot,'package.json'));
  if (!Array.isArray(metadata.build?.files)) fail('В package.json отсутствует build.files.');
  const app=path.join(target,'app'),plan=[],destinations=new Set(),modules=[],skippedOptional=[];
  let excluded=0;
  function addFile(source,destination) {
    if (!inside(app,destination)) fail('Файл выходит за каталог приложения.');
    if (excludedFile(path.basename(source))) { excluded++; return; }
    const relative=slash(path.relative(app,destination));
    if (relative==='package.json') return; // Generated without development config below.
    if (destinations.has(relative)) return;
    const stat=regular(source,'Исходный файл');
    if (overlaps(target,source)) fail('Назначение пересекается с исходным файлом.');
    destinations.add(relative);
    plan.push({source,destination,relative,stat:{dev:stat.dev,ino:stat.ino,size:stat.size,mtimeMs:stat.mtimeMs}});
  }
  function tree(source,destination) {
    noLinks(source);
    const stat=fs.lstatSync(source);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(source).sort()) {
        const child=path.join(source,name),childStat=fs.lstatSync(child);
        if (childStat.isSymbolicLink()) fail('Ссылка в производственных файлах запрещена: '+child);
        if (childStat.isDirectory() && EXCLUDED_DIRECTORIES.has(name.toLowerCase())) { excluded++; continue; }
        tree(child,path.join(destination,name));
      }
    } else if (stat.isFile()) addFile(source,destination);
    else fail('Неподдерживаемый тип производственного файла: '+source);
  }
  for (const pattern of metadata.build.files) {
    if (typeof pattern!=='string'||pattern.startsWith('!')) fail('Неподдерживаемая маска build.files.');
    const relative=pattern.endsWith('/**')?pattern.slice(0,-3):pattern;
    if (!relative||/[*?{}:\x00-\x1f]/.test(relative)||path.isAbsolute(relative)||relative.split(/[\\/]/).some(part=>part==='.'||part==='..'||part==='node_modules')) fail('Небезопасный путь build.files: '+pattern);
    const source=path.resolve(sourceRoot,relative);
    if (!inside(sourceRoot,source)) fail('Путь build.files выходит из проекта.');
    tree(source,path.join(app,relative));
  }
  tree(path.join(sourceRoot,'web'),path.join(app,'web'));
  if (!destinations.has('index.html')||!destinations.has('web/local-runtime.cjs')||!destinations.has('web/launch-local.cjs')) fail('Для установки нужны index.html, web/local-runtime.cjs и web/launch-local.cjs.');

  // Same placement policy as prepare-installer-stage: reserve the top graph
  // before traversal and reuse only an exact physical ancestor version.
  const top={source:sourceRoot,target:app,parent:null,children:new Map()};
  function reserve(name,source,owner,optional) {
    if (overlaps(target,source)) fail('Назначение пересекается с установленной зависимостью.');
    const placement={name,source,target:path.join(owner.target,'node_modules',...name.split('/')),parent:owner,children:new Map(),package:readPackage(path.join(source,'package.json')),optional};
    owner.children.set(name,placement);
    return placement;
  }
  for (const name of dependencyNames(metadata)) {
    const optional=Object.hasOwn(metadata.optionalDependencies||{},name);
    try { reserve(name,resolvePackage(name,sourceRoot),top,optional); }
    catch(error) { if(optional&&error.code==='PRODUCTION_DEPENDENCY_MISSING')skippedOptional.push({name,parent:metadata.name});else throw error; }
  }
  function nearest(name,owner) { for(let scope=owner;scope;scope=scope.parent)if(scope.children.has(name))return scope.children.get(name);return null; }
  function materialize(placement) {
    if (placement.planned) return;
    placement.planned=true;
    const start=plan.length;
    tree(placement.source,placement.target);
    modules.push({name:placement.package.name||placement.name,version:placement.package.version||null,path:slash(path.relative(app,placement.target)),files:plan.length-start});
    for (const name of dependencyNames(placement.package)) {
      const optional=Object.hasOwn(placement.package.optionalDependencies||{},name);
      let source;
      try { source=resolvePackage(name,placement.source); }
      catch(error) { if(optional&&error.code==='PRODUCTION_DEPENDENCY_MISSING'){skippedOptional.push({name,parent:placement.package.name});continue;}throw error; }
      const existing=nearest(name,placement);
      if(existing?.source===source)materialize(existing);
      else materialize(reserve(name,source,placement,optional));
    }
  }
  for(const placement of top.children.values())materialize(placement);
  // Every read and graph check above happens before reserving destination files.
  checkTarget(target,sourceRoot,[...protectedPaths,runtimePath,...(pdfSource?[pdfSource]:[])]);
  if(!fs.existsSync(target))fs.mkdirSync(target);
  const installationRoot=fs.realpathSync.native(target);
  const ensureDestination=filename=>{
    if(!inside(installationRoot,path.resolve(filename)))fail('Файл выходит за назначение.');
    noLinks(installationRoot);
    if(fs.realpathSync.native(target)!==installationRoot)fail('Каталог назначения изменился во время подготовки.');
    let current=installationRoot;
    for(const segment of path.relative(installationRoot,path.dirname(filename)).split(path.sep).filter(Boolean)){
      current=path.join(current,segment);
      if(!fs.existsSync(current))fs.mkdirSync(current);
      noLinks(current);
      if(!fs.statSync(current).isDirectory())fail('Путь назначения занят файлом.');
    }
  };
  const files=[];
  const write=(relative,content)=>{
    const destination=path.join(installationRoot,relative);
    ensureDestination(destination);
    const bytes=Buffer.isBuffer(content)?content:Buffer.from(content,'utf8');
    fs.writeFileSync(destination,bytes,{flag:'wx'});
    files.push({path:slash(relative),bytes:bytes.length,sha256:SHA(bytes)});
  };
  for(const item of plan){
    const stat=regular(item.source,'Исходный файл');
    if(Object.keys(item.stat).some(key=>item.stat[key]!==stat[key]))fail('Исходный файл изменился во время подготовки.');
    ensureDestination(item.destination);
    fs.copyFileSync(item.source,item.destination,fs.constants.COPYFILE_EXCL);
    const bytes=fs.readFileSync(item.destination);
    files.push({path:'app/'+item.relative,bytes:bytes.length,sha256:SHA(bytes)});
  }
  const packageKeys=['name','version','description','author','license','main','type','engines','dependencies','optionalDependencies','overrides'];
  const productionPackage=Object.fromEntries(packageKeys.filter(key=>Object.hasOwn(metadata,key)).map(key=>[key,metadata[key]]));
  write('app/package.json',JSON.stringify(productionPackage,null,2)+'\n');
  ensureDestination(path.join(target,'runtime','node.exe'));
  fs.copyFileSync(runtimePath,path.join(target,'runtime','node.exe'),fs.constants.COPYFILE_EXCL);
  const runtimeBytes=fs.readFileSync(path.join(target,'runtime','node.exe'));
  files.push({path:'runtime/node.exe',bytes:runtimeBytes.length,sha256:SHA(runtimeBytes)});
  let pdfRuntime=null;
  if(pdfSource){
    const prepared=preparePdfRuntime({source:pdfSource,target:path.join(target,'runtime','electron'),protectedPaths});
    for(const file of prepared.manifest.files)files.push({...file,path:'runtime/electron/'+file.path});
    const pdfManifest=fs.readFileSync(prepared.manifestFile);
    files.push({path:'runtime/electron/pdf-runtime-manifest.json',bytes:pdfManifest.length,sha256:SHA(pdfManifest)});
    pdfRuntime={version:prepared.version,executable:'runtime/electron/electron.exe',manifest:'runtime/electron/pdf-runtime-manifest.json'};
  }
  fs.mkdirSync(path.join(target,'config'));
  fs.mkdirSync(path.join(target,'state'));
  write('config/server.json',JSON.stringify({dataDir:'',usersFile:path.join(target,'config','users.json'),stateDir:path.join(target,'state'),port:3381},null,2)+'\n');
  write('Запустить.cmd',webLauncher());
  write('Открыть.url','[InternetShortcut]\r\nURL=http://127.0.0.1:3381/\r\n');
  write('Прочитайте.txt',[
    'ВЕБ-ДИСПЕТЧЕР ТВС — ЛОКАЛЬНЫЙ ЗАПУСК',
    '',
    'Настройка ещё не завершена. Откройте config\\server.json и укажите:',
    'dataDir — абсолютный путь к подготовленной базе SQLite текущего формата;',
    'usersFile — абсолютный путь к файлу персональных учётных записей;',
    'stateDir — отдельный каталог состояния сервера (по умолчанию state);',
    'port — локальный порт (по умолчанию 3381).',
    '',
    'Рабочая база, её резервные копии, ключи и настройки сюда не копировались.',
    'Исполняемый файл Node.js и производственные зависимости находятся внутри этой папки.',
    ...(pdfRuntime?['Electron для серверного формирования PDF находится в runtime\\electron; отдельная установка Electron не нужна.']:['PDF runtime в эту сборку не включён. Для сборки с PDF используйте prepare-web-deployment.cjs --with-pdf.']),
    'После настройки запустите Запустить.cmd: сервер запустится в фоне, затем откроется браузер.',
    'Окно запуска можно закрыть после сообщения о готовности. Повторный запуск открывает уже работающую программу.',
    'После перезагрузки компьютера снова запустите Запустить.cmd. Журналы запуска находятся в config\\launch.',
    'Настройка локальной сети Windows: app\\web\\deployment\\windows\\README.md.',
    'Доступ через интернет этим пакетом не настраивается.',
    '',
  ].join('\r\n'));
  const manifest={version:metadata.version||null,createdAt:new Date().toISOString(),networkUsed:false,businessDataCopied:false,excludedEntries:excluded,modules,skippedOptional,pdfRuntime,files};
  write('deployment-manifest.json',JSON.stringify(manifest,null,2)+'\n');
  return {target:installationRoot,appDir:path.join(installationRoot,'app'),configFile:path.join(installationRoot,'config','server.json'),files:files.length,bytes:files.reduce((sum,file)=>sum+file.bytes,0),modules:modules.length,skippedOptional:skippedOptional.length,pdfRuntime,configured:false};
}

function parseArgs(argv) {
  const options={protectedPaths:[]};
  for(let index=0;index<argv.length;index++){
    const flag=argv[index];
    if(flag==='--help'){options.help=true;continue;}
    if(flag==='--with-pdf'){if(options.withPdf)fail('--with-pdf задан дважды.');options.withPdf=true;continue;}
    if(!['--target','--protected-path'].includes(flag)||!argv[index+1]||argv[index+1].startsWith('--'))fail('Использование: node scripts/prepare-web-deployment.cjs --target ABS [--protected-path ABS] [--with-pdf]');
    const value=argv[++index];
    if(flag==='--target'){if(options.target)fail('--target задан дважды.');options.target=value;}
    else options.protectedPaths.push(value);
  }
  return options;
}
function webLauncher(){return '@echo off\r\nsetlocal\r\nchcp 65001 >nul\r\ncd /d "%~dp0"\r\n"%~dp0runtime\\node.exe" "%~dp0app\\web\\launch-local.cjs" --config "%~dp0config\\server.json"\r\nif errorlevel 1 (\r\n  echo.\r\n  echo Не удалось открыть диспетчер. Проверьте сообщение выше и журналы в папке config\\launch.\r\n  pause\r\n)\r\nendlocal\r\n';}
if(require.main===module){try{const options=parseArgs(process.argv.slice(2));if(options.help)process.stdout.write('node scripts/prepare-web-deployment.cjs --target ABS [--protected-path ABS] [--with-pdf]\n');else process.stdout.write(JSON.stringify(prepareWebDeployment(options),null,2)+'\n');}catch(error){process.stderr.write('Подготовка веб-версии: '+error.message+'\n');process.exitCode=1;}}
module.exports={prepareWebDeployment,parseArgs,webLauncher};
