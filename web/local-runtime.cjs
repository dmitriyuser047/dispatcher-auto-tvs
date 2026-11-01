'use strict';

// Explicit local installation entry point. Merely importing or building this
// module never initializes, migrates, backs up or replaces business data.
const fs = require('node:fs');
const path = require('node:path');
const sqlite = require('../electron/sqlite-storage.cjs');
const storage = require('../electron/storage.js');
const format = require('../electron/storage-format.cjs');
const backups = require('../electron/backup-service.cjs');
const {loadUsers} = require('./cli.cjs');
const {createGateway} = require('./server.cjs');

const ROOT = path.resolve(__dirname, '..');
const ALLOWED = new Set(['dataDir','usersFile','stateDir','port','backupDir','host','allowedHosts']);
const PUBLIC = ['assets/core','assets/js','assets/css','assets/fonts','assets/img','assets/images','assets/icons','assets/ocr','vendor','web/public'].map(relative => path.resolve(ROOT,relative));
const fail = (code,message) => { throw Object.assign(Error(message), {code}); };
const fold = value => process.platform === 'win32' ? value.toLowerCase() : value;
function inside(parent,target) {
  const relative = path.relative(fold(path.resolve(parent)),fold(path.resolve(target)));
  return relative === '' || !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..'+path.sep);
}
function absolute(value,label) {
  if(typeof value !== 'string' || !value.trim() || !path.isAbsolute(value) || /^[\\/]{2}/.test(value))
    fail('WEB_CONFIG_PATH',label+': нужен абсолютный путь на локальном диске.');
  return path.resolve(value);
}
function privateLocation(target,label) {
  let ancestor=target;
  while(!fs.existsSync(ancestor)) {
    const next=path.dirname(ancestor);
    if(next===ancestor)break;
    ancestor=next;
  }
  const resolved=fs.existsSync(ancestor)?path.join(fs.realpathSync.native(ancestor),path.relative(ancestor,target)):target;
  if(PUBLIC.some(parent=>inside(parent,target)||inside(parent,resolved)))
    fail('WEB_CONFIG_PUBLIC_PATH',label+' не должен находиться среди файлов, выдаваемых браузеру.');
  return target;
}
function personalSettings(usersFile) {
  try { return loadUsers(usersFile); }
  catch { fail('WEB_USERS_INVALID','Не удалось подтвердить персональные учётные записи веб-диспетчера.'); }
}
function currentDatabase(dataDir) {
  if(!fs.statSync(dataDir).isDirectory())fail('WEB_DATABASE_PATH','Каталог рабочей базы не найден.');
  const filename=sqlite.filename(dataDir), header=Buffer.alloc(100);
  const descriptor=fs.openSync(filename,'r');
  try {
    if(fs.readSync(descriptor,header,0,header.length,0)!==header.length || header.subarray(0,16).toString('binary')!=='SQLite format 3\0')
      fail('WEB_DATABASE_FORMAT','Рабочая база должна быть существующей SQLite текущего формата.');
    if(header.readUInt32BE(60)!==format.SCHEMA_VERSION)
      fail('WEB_DATABASE_SCHEMA','Для веб-запуска нужна уже подготовленная SQLite текущей схемы. Автоматический перенос отключён.');
  } finally { fs.closeSync(descriptor); }
  const profile=sqlite.readDescriptor(dataDir);
  if(profile.schemaVersion!==format.SCHEMA_VERSION)fail('WEB_DATABASE_SCHEMA','Схема рабочей базы не совпадает с программой.');
  return profile;
}
function buildRuntime(configPath) {
  const filename=absolute(configPath,'Конфигурация');
  const stat=fs.statSync(filename);
  if(!stat.isFile() || stat.size<2 || stat.size>65536)fail('WEB_CONFIG_INVALID','Некорректный файл конфигурации веб-диспетчера.');
  let input;
  try { input=JSON.parse(fs.readFileSync(filename,'utf8')); }
  catch { fail('WEB_CONFIG_INVALID','Не удалось прочитать конфигурацию веб-диспетчера.'); }
  if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>!ALLOWED.has(key)))
    fail('WEB_CONFIG_INVALID','Конфигурация содержит неизвестные поля.');
  if(!Number.isSafeInteger(input.port)||input.port<0||input.port>65535)fail('WEB_CONFIG_PORT','Укажите допустимый локальный порт.');
  const dataDir=privateLocation(absolute(input.dataDir,'Рабочая база'),'Рабочая база');
  const usersFile=privateLocation(absolute(input.usersFile,'Учётные записи'),'Учётные записи');
  const stateDir=privateLocation(absolute(input.stateDir,'Состояние операций'),'Состояние операций');
  const backupDir=privateLocation(absolute(input.backupDir || path.join(dataDir,'backups'),'Резервные копии'),'Резервные копии');
  if(inside(dataDir,stateDir)||inside(stateDir,dataDir))fail('WEB_CONFIG_STATE','Состояние веб-операций должно храниться отдельно от рабочей базы.');
  if(inside(dataDir,backupDir)&&!inside(path.join(dataDir,'backups'),backupDir))
    fail('WEB_CONFIG_BACKUP','Внутри рабочей базы резервные копии разрешены только в каталоге backups.');
  personalSettings(usersFile);
  const database=currentDatabase(dataDir);
  const network=require('./network.cjs').normalizeNetwork(input);
  const config=Object.freeze({dataDir,usersFile,stateDir,port:input.port,backupDir,host:network.host,allowedHosts:network.allowedHosts});
  return Object.freeze({config,configPath:filename,database,
    settings:()=>{try{return loadUsers(usersFile);}catch{return {serverAccessConfigured:true,serverUsers:[]};}},
    backup:Object.freeze({directory:backupDir,keep:30}),
  });
}
function prepareBackup(runtime) {
  const beforeDate=new Date().toISOString().slice(0,10);
  return storage.withDatabaseLock(runtime.config.dataDir,()=>{
    // The existing service copies and verifies the managed document/operation
    // closure. The business tables and their revisions are never edited here.
    const created=storage.makeDailyBackup(runtime.config.dataDir,runtime.config.backupDir,30);
    const today=new Date().toISOString().slice(0,10);
    const candidates=created?[created]:[today,beforeDate].map(day=>path.join(runtime.config.backupDir,'data_'+day+'.zip'));
    const archivePath=candidates.find(candidate=>fs.existsSync(candidate));
    if(!archivePath)fail('WEB_BACKUP_REQUIRED','Подтверждённая резервная копия не создана. Веб-запуск остановлен.');
    const checked=backups.verifyPackage({archivePath});
    if(!checked.ok||checked.sourceFormat!=='sqlite'||checked.sourceDescriptor?.schemaVersion!==format.SCHEMA_VERSION ||
      JSON.stringify(checked.sourceIdentity)!==JSON.stringify(sqlite.readIdentity(runtime.config.dataDir)))
      fail('WEB_BACKUP_REQUIRED','Резервный пакет не подтверждает выбранную рабочую базу.');
    return Object.freeze({path:archivePath,sha256:checked.archiveSha256});
  });
}
async function startRuntime(configPath) {
  const runtime=buildRuntime(configPath);
  const backup=prepareBackup(runtime);
  // Invalid credentials or a failed backup stop before either HTTP server or
  // the durable browser-operation queue can be started.
  personalSettings(runtime.config.usersFile);
  const gateway=await createGateway({dataDir:runtime.config.dataDir,settings:runtime.settings,
    outboxDir:runtime.config.stateDir,host:runtime.config.host,allowedHosts:runtime.config.allowedHosts,port:runtime.config.port,
    demo:false,backup:runtime.backup,usersFile:runtime.config.usersFile,
  });
  return Object.freeze({...gateway,backupPath:backup.path,config:runtime.config});
}
async function main(argv=process.argv.slice(2)) {
  if(argv.length!==2||argv[0]!=='--config')fail('WEB_CONFIG_ARGUMENT','Запуск: node web/local-runtime.cjs --config ABSOLUTE_CONFIG_JSON');
  const runtime=await startRuntime(argv[1]);
  process.stdout.write('Веб-диспетчер ТВС: '+runtime.url+'\nРабочая база подключена. Резервный пакет проверен.\n');
  let closing=false;
  const close=()=>{if(closing)return;closing=true;void runtime.close().then(()=>{process.exitCode=0;}).catch(()=>{process.exitCode=1;});};
  process.once('SIGINT',close);process.once('SIGTERM',close);
  return runtime;
}
if(require.main===module)void main().catch(error=>{
  process.stderr.write('Веб-диспетчер: '+(error.code?String(error.code)+': ':'')+error.message+'\n');
  process.exitCode=1;
});
module.exports={buildRuntime,prepareBackup,startRuntime,main};
