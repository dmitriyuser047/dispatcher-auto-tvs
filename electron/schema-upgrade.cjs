'use strict';
// Offline, explicit COPY only. No storage read, recovery, identity creation or
// schema change is ever performed against the source directory.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const schema=require('../assets/core/platform-schema.js'),contracts=require('../assets/core/platform-contracts.js');
const format=require('./storage-format.cjs'),sqlite=require('./sqlite-storage.cjs');
const managed=['attachments','import-sources','reestr-knowledge','document-archive'];
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fold=value=>process.platform==='win32'?value.toLowerCase():value;
function fail(code,message){const error=new Error(message);error.code=code;throw error;}
function stat(file){try{return fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
function within(parent,child){const relative=path.relative(fold(parent),fold(child));return !relative||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);}
function nameSafe(name){return typeof name==='string'&&!!name&&name.length<=240&&!/[\x00-\x1f\\/:*?"<>|]/.test(name)&&!/[. ]$/.test(name)&&!['.','..'].includes(name)&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);}
function local(value){if(typeof value!=='string'||!value.trim()||value.includes('\0')||/^[\\/]{2}|^file:/i.test(value)||/^[a-z]:[^\\/]/i.test(value))fail('SCHEMA_UPGRADE_PATH','Нужен явный локальный путь без UNC и ссылок');return path.resolve(value);}
function directory(value){
 const absolute=local(value),root=path.parse(absolute).root;let current=root;
 for(const name of absolute.slice(root.length).split(path.sep).filter(Boolean)){current=path.join(current,name);const info=stat(current);if(!info?.isDirectory()||info.isSymbolicLink())fail('SCHEMA_UPGRADE_PATH','Каталог отсутствует или проходит через ссылку');}
 const real=fs.realpathSync.native(absolute);if(/^[\\/]{2}/.test(real))fail('SCHEMA_UPGRADE_PATH','Сетевой каталог не поддерживается');return real;
}
function paths(sourceDir,targetDir){const source=directory(sourceDir),requested=local(targetDir),parent=directory(path.dirname(requested)),target=path.join(parent,path.basename(requested));if(!nameSafe(path.basename(target))||within(source,target)||within(target,source))fail('SCHEMA_UPGRADE_PATH','Источник и цель должны быть отдельными невложенными каталогами');if(stat(target))fail('SCHEMA_UPGRADE_TARGET_EXISTS','Целевой каталог уже существует; выберите новый путь');return {source,parent,target};}
function fileBytes(root,relative){
 const file=path.join(root,...relative.split('/')),info=stat(file);if(!info?.isFile()||info.isSymbolicLink()||info.nlink>1||!within(root,fs.realpathSync.native(file)))fail('SCHEMA_UPGRADE_FILE','Недопустимый исходный файл: '+relative);
 const bytes=fs.readFileSync(file),after=fs.lstatSync(file);if(info.size!==after.size||info.mtimeMs!==after.mtimeMs||info.ino!==after.ino||bytes.length!==after.size)fail('SCHEMA_UPGRADE_SOURCE_CHANGED','Исходный файл изменился при чтении');return bytes;
}
function manifest(source){
 for(const name of ['.tvs-database.lock','.tvs-database.lock.recovery','sections/.transaction.json'])if(stat(path.join(source,...name.split('/'))))fail('SCHEMA_UPGRADE_SOURCE_BUSY','Закройте программу и завершите восстановление базы перед созданием копии');
 const result=[],add=name=>{const bytes=fileBytes(source,name);result.push({path:name,type:'file',size:bytes.length,sha256:sha(bytes)});};
 for(const name of ['platform.sqlite','platform.sqlite-wal','platform.sqlite-shm','data.json','data.json.before-split','database-identity.json'])if(stat(path.join(source,name)))add(name);
 const wal=result.find(entry=>entry.path==='platform.sqlite-wal');if(wal?.size)fail('SCHEMA_UPGRADE_SOURCE_BUSY','В SQLite есть незавершённый журнал WAL. Закройте все экземпляры программы штатно перед копированием');
 const walk=(relative,isManaged)=>{const dir=path.join(source,...relative.split('/')),info=stat(dir);if(!info?.isDirectory()||info.isSymbolicLink()||!within(source,fs.realpathSync.native(dir)))fail('SCHEMA_UPGRADE_FILE','Недопустимый каталог источника');result.push({path:relative,type:'directory'});const seen=new Set();for(const name of fs.readdirSync(dir).sort()){if(!nameSafe(name)||seen.has(name.toLowerCase()))fail('SCHEMA_UPGRADE_FILE','Недопустимое имя или дубликат файла');seen.add(name.toLowerCase());const next=relative+'/'+name,entry=stat(path.join(dir,name));if(entry?.isDirectory()&&isManaged)walk(next,true);else if(entry?.isFile()&&!entry.isSymbolicLink()){if(!isManaged&&name!=='revisions.json'&&!schema.sections.some(section=>name===section+'.json'))fail('SCHEMA_UPGRADE_FILE','Неизвестный раздел источника');add(next);}else fail('SCHEMA_UPGRADE_FILE','Ссылки и специальные файлы не поддерживаются');}};
 for(const name of ['sections',...managed])if(stat(path.join(source,name)))walk(name,name!=='sections');
 result.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);return result;
}
function fingerprint(entries){return 'sha256:'+sha(JSON.stringify(entries));}
function parse(bytes){try{return JSON.parse(bytes.toString('utf8'));}catch{fail('SCHEMA_UPGRADE_JSON','Исходный JSON не прочитан');}}
function cleanup(stage,parent,identity){if(!stage)return;const info=stat(stage);if(!info)return;if(path.dirname(stage)!==parent||!path.basename(stage).startsWith('.tvs-schema-')||!info.isDirectory()||info.isSymbolicLink()||info.ino!==identity.ino||info.dev!==identity.dev)fail('SCHEMA_UPGRADE_CLEANUP','Не подтверждена принадлежность временного каталога');fs.rmSync(stage,{recursive:true,force:true});}
function readSource(source,entries){
 const files=new Map(entries.filter(entry=>entry.type==='file').map(entry=>[entry.path,entry])),read=name=>parse(fileBytes(source,name));let data,revisions,sourceFormat,schemaVersion;
 if(files.has('platform.sqlite')){
  sourceFormat='sqlite';const parent=directory(os.tmpdir()),stage=fs.mkdtempSync(path.join(parent,'.tvs-schema-read-')),identity=fs.statSync(stage);
  try{fs.writeFileSync(path.join(stage,'platform.sqlite'),fileBytes(source,'platform.sqlite'),{flag:'wx'});schemaVersion=sqlite.schemaVersion(stage);data=sqlite.readAll(stage);revisions=sqlite.readRevisions(stage);}finally{cleanup(stage,parent,identity);}
 }else if(files.has('sections/revisions.json')){
  sourceFormat='json';const raw=read('sections/revisions.json'),decoded=format.decodeRevisions(raw);schemaVersion=decoded.schemaVersion;revisions=decoded.revisions;data={};
  for(const section of schema.sections){const relative='sections/'+section+'.json';if(files.has(relative)){if(schemaVersion===1&&section==='documentDrafts')fail('SCHEMA_UPGRADE_SCHEMA','Старый формат содержит неизвестный раздел');data[section]=read(relative);}else{if(schemaVersion===2||Object.hasOwn(raw,section)||['vehicles','records'].includes(section))fail('SCHEMA_UPGRADE_INCOMPLETE','Отсутствует файл раздела: '+section);data[section]=[];}}
 }else if(files.has('data.json')){
  sourceFormat='json';schemaVersion=1;const raw=read('data.json');if(!plain(raw)||!Object.hasOwn(raw,'vehicles')||!Object.hasOwn(raw,'records')||Object.keys(raw).some(name=>!format.legacySections().includes(name)))fail('SCHEMA_UPGRADE_SCHEMA','Неизвестная структура старой базы');data=Object.fromEntries(schema.sections.map(section=>[section,raw[section]??[]]));revisions=Object.fromEntries(schema.sections.map(section=>[section,0]));
 }else fail('SCHEMA_UPGRADE_SOURCE','В каталоге нет поддерживаемой базы');
 try{contracts.validateSections(data,schema.sections);contracts.validateRevisions(revisions,schema.sections);}catch{fail('SCHEMA_UPGRADE_JSON','Исходная база содержит небезопасные или непредставимые значения JSON');}
 return {data,revisions,sourceFormat,schemaVersion};
}
function references(data,entries){
 const files=new Map(entries.filter(entry=>entry.type==='file').map(entry=>[entry.path,entry]));
 const check=(directory,row)=>{if(!plain(row)||typeof row.id!=='string'||!/^[a-f0-9]{64}\.[a-z0-9]{1,6}$/.test(row.id))fail('SCHEMA_UPGRADE_REFERENCE','Некорректная ссылка на управляемый файл');const file=files.get(directory+'/'+row.id);if(!file||file.sha256!==row.id.slice(0,64)||row.sha256!=null&&row.sha256!==file.sha256||row.size!=null&&row.size!==file.size)fail('SCHEMA_UPGRADE_REFERENCE','Не найден или повреждён управляемый файл');};
 const visit=value=>{if(Array.isArray(value)){value.forEach(visit);return;}if(!plain(value))return;for(const [key,child]of Object.entries(value)){if(key==='attachments'&&Array.isArray(child))child.forEach(row=>check('attachments',row));if(['sourceArchive','lastImportArchive'].includes(key)&&plain(child)&&(child.available===true||child.id!=null))check('import-sources',child);if(key==='sourceArchives'&&Array.isArray(child))child.forEach(row=>{if(plain(row)&&(row.available===true||row.id!=null))check('import-sources',row);});visit(child);}};visit(data);
}
function counts(snapshot){return schema.sections.map(section=>({section,count:snapshot.data[section].length,revision:snapshot.revisions[section]}));}
function inspectSource({sourceDir}){const source=directory(sourceDir),entries=manifest(source),sourceFingerprint=fingerprint(entries),snapshot=readSource(source,entries);references(snapshot.data,entries);require('./document-archive.cjs').validateManaged(snapshot.data,name=>entries.some(entry=>entry.path===name)?fileBytes(source,name):null);if(fingerprint(manifest(source))!==sourceFingerprint)fail('SCHEMA_UPGRADE_SOURCE_CHANGED','База изменилась во время проверки');return {ok:true,schemaVersion:snapshot.schemaVersion,sourceFormat:snapshot.sourceFormat,requiresUpgrade:snapshot.schemaVersion<2,counts:counts(snapshot),sourceFingerprint};}
function upgradeCopy({sourceDir,targetDir,targetFormat,expectedSourceFingerprint}){
 if(typeof expectedSourceFingerprint!=='string'||!/^sha256:[a-f0-9]{64}$/.test(expectedSourceFingerprint))fail('SCHEMA_UPGRADE_REVIEW_REQUIRED','Перед созданием копии проверьте источник заново');
 const {source,parent,target}=paths(sourceDir,targetDir),entries=manifest(source),sourceFingerprint=fingerprint(entries);if(sourceFingerprint!==expectedSourceFingerprint)fail('SCHEMA_UPGRADE_SOURCE_CHANGED','Источник изменился после проверки. Проверьте его заново');
 const snapshot=readSource(source,entries);references(snapshot.data,entries);require('./document-archive.cjs').validateManaged(snapshot.data,name=>entries.some(entry=>entry.path===name)?fileBytes(source,name):null);targetFormat??=snapshot.sourceFormat;if(!['json','sqlite'].includes(targetFormat))fail('SCHEMA_UPGRADE_FORMAT','Неизвестный формат целевой базы');
 let stage=fs.mkdtempSync(path.join(parent,'.tvs-schema-upgrade-'));const identity=fs.statSync(stage);
 try{
  if(targetFormat==='sqlite')sqlite.create(stage,{data:snapshot.data,revisions:snapshot.revisions});else{fs.mkdirSync(path.join(stage,'sections'));for(const section of schema.sections)fs.writeFileSync(path.join(stage,'sections',section+'.json'),JSON.stringify(snapshot.data[section]),{flag:'wx'});fs.writeFileSync(path.join(stage,'sections','revisions.json'),JSON.stringify(format.encodeRevisions(snapshot.revisions)),{flag:'wx'});}
  const reachable=require('./document-archive.cjs').managedNames(source,snapshot.data);
  for(const entry of entries){const head=entry.path.split('/')[0];if(!managed.includes(head)||head==='document-archive'&&entry.type==='file'&&!reachable.has(entry.path.slice('document-archive/'.length)))continue;const destination=path.join(stage,...entry.path.split('/'));if(entry.type==='directory')fs.mkdirSync(destination,{recursive:true});else{const bytes=fileBytes(source,entry.path);if(sha(bytes)!==entry.sha256)fail('SCHEMA_UPGRADE_SOURCE_CHANGED','Управляемый файл изменился');fs.writeFileSync(destination,bytes,{flag:'wx'});if(sha(fs.readFileSync(destination))!==entry.sha256)fail('SCHEMA_UPGRADE_VERIFY','Копия управляемого файла не прошла проверку');}}
  const actual=require('./storage').readSnapshot(stage);for(const section of schema.sections)if(JSON.stringify(actual.data[section])!==JSON.stringify(snapshot.data[section])||actual.revisions[section]!==snapshot.revisions[section])fail('SCHEMA_UPGRADE_VERIFY','Данные или версии копии отличаются от источника');
  if(targetFormat==='sqlite'){const checked=sqlite.inspect(stage);if(!checked.ok||checked.schemaVersion!==2||checked.foreignKeyErrors.length)fail('SCHEMA_UPGRADE_VERIFY','SQLite копия не прошла проверку целостности');}
  if(fingerprint(manifest(source))!==sourceFingerprint)fail('SCHEMA_UPGRADE_SOURCE_CHANGED','Источник изменился при создании копии');
  if(stat(target))fail('SCHEMA_UPGRADE_TARGET_EXISTS','Целевой каталог появился во время создания копии');
  const report={ok:true,targetDir:target,sourceFormat:snapshot.sourceFormat,targetFormat,schemaVersion:2,counts:counts(snapshot),sourceFingerprint,targetFingerprint:'sha256:'+sha(JSON.stringify({data:actual.data,revisions:actual.revisions}))};
  fs.writeFileSync(path.join(stage,'schema-upgrade-report.json'),JSON.stringify(report,null,2),{flag:'wx'});fs.renameSync(stage,target);stage=null;return report;
 }catch(error){cleanup(stage,parent,identity);throw error;}
}
module.exports=Object.freeze({inspectSource,upgradeCopy});
