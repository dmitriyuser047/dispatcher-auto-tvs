'use strict';
// An offline copy owns one durable identity and one publication. The source is
// never opened by this coordinator; callers supply read-only copy/verify steps.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const safeFile=require('./safe-file.cjs');
const identities=require('./database-identity.cjs');
const FORMAT='tvs-copy-migration-journal',VERSION=1,OWNER='.tvs-migration-owner.json';
const STATES=['planned','owned','copied','verified','report-ready','publishing','published','acknowledged'];
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const fail=(code,message)=>Object.assign(Error(message),{code});
const stat=file=>{try{return fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}};
const fold=value=>process.platform==='win32'?value.toLowerCase():value;
const same=(a,b)=>fold(path.resolve(a))===fold(path.resolve(b));
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
function syncDirectory(directory){let fd;try{fd=fs.openSync(directory,'r');fs.fsyncSync(fd);}catch(error){if(!['EPERM','EACCES','EISDIR','EINVAL','ENOTSUP'].includes(error.code))throw error;}finally{if(fd!==undefined)fs.closeSync(fd);}}
function readJSON(file,limit=128*1024){try{return JSON.parse(safeFile.readRegularFileSync(file,{maxBytes:limit,minBytes:1}).toString('utf8'));}catch(error){if(error.code==='ENOENT')throw error;throw fail('MIGRATION_JOURNAL_INVALID','Не прочитан безопасный журнал миграции');}}
function durableJSON(file,value,parent){
 safeFile.assertDirectory(parent);const temporary=path.join(parent.path,'.'+path.basename(file)+'.'+crypto.randomBytes(12).toString('hex')+'.tmp');let fd,owned;
 try{fd=fs.openSync(temporary,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW||0),0o600);owned=fs.fstatSync(fd);safeFile.assertDirectory(parent);fs.writeFileSync(fd,JSON.stringify(value)+'\n','utf8');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;safeFile.assertDirectory(parent);const old=stat(file);if(old&&(!old.isFile()||old.isSymbolicLink()||old.nlink!==1))throw fail('MIGRATION_JOURNAL_INVALID','Журнал не должен быть файловой ссылкой');fs.renameSync(temporary,file);syncDirectory(parent.path);
 }finally{if(fd!==undefined)fs.closeSync(fd);const left=stat(temporary);if(left&&owned&&left.dev===owned.dev&&left.ino===owned.ino&&left.nlink===1&&!left.isSymbolicLink()){safeFile.assertDirectory(parent);fs.unlinkSync(temporary);}}
}
function fileProof(file){const info=stat(file);if(!info?.isFile()||info.isSymbolicLink()||info.nlink!==1)throw fail('MIGRATION_JOURNAL_INVALID','Недопустимый служебный файл миграции');return {dev:info.dev,ino:info.ino};}
function lock(file,parent){
 const recovery=file+'.recovery';
 const acquire=target=>{safeFile.assertDirectory(parent);const fd=fs.openSync(target,'wx',0o600),proof=fs.fstatSync(fd),value={format:'tvs-migration-lock',pid:process.pid,nonce:crypto.randomUUID()};try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}syncDirectory(parent.path);return {proof,value};};
 const release=(target,held)=>{safeFile.assertDirectory(parent);const current=fileProof(target),value=readJSON(target);if(current.dev!==held.proof.dev||current.ino!==held.proof.ino||value.nonce!==held.value.nonce)throw fail('MIGRATION_JOURNAL_LOCK','Блокировка миграции изменилась');fs.unlinkSync(target);syncDirectory(parent.path);};
 const dead=value=>{if(value.format!=='tvs-migration-lock'||!Number.isSafeInteger(value.pid)||value.pid<1||!uuid(value.nonce))throw fail('MIGRATION_JOURNAL_LOCK','Не подтверждён владелец блокировки миграции');try{process.kill(value.pid,0);return false;}catch(error){if(error.code==='ESRCH')return true;if(error.code==='EPERM')return false;throw error;}};
 if(stat(recovery))throw fail('MIGRATION_JOURNAL_BUSY','Проверяется аварийная блокировка миграции');
 let held;try{held=acquire(file);}catch(error){if(error.code!=='EEXIST')throw error;const proof=fileProof(file),value=readJSON(file);if(!dead(value))throw fail('MIGRATION_JOURNAL_BUSY','Миграция уже выполняется в другом процессе');let guard;try{guard=acquire(recovery);}catch(caught){if(caught.code==='EEXIST')throw fail('MIGRATION_JOURNAL_BUSY','Проверяется аварийная блокировка миграции');throw caught;}
  try{safeFile.assertDirectory(parent);const current=fileProof(file),owner=readJSON(file);if(current.dev!==proof.dev||current.ino!==proof.ino||owner.nonce!==value.nonce||!dead(owner))throw fail('MIGRATION_JOURNAL_LOCK','Блокировка миграции изменилась');fs.unlinkSync(file);held=acquire(file);}finally{release(recovery,guard);}
 }
 if(stat(recovery)){release(file,held);throw fail('MIGRATION_JOURNAL_BUSY','Проверяется аварийная блокировка миграции');}
 return ()=>release(file,held);
}
function paths(sourceDir,targetDir,kind){
 if(typeof sourceDir!=='string'||!path.isAbsolute(sourceDir)||typeof targetDir!=='string'||!path.isAbsolute(targetDir)||[sourceDir,targetDir].some(value=>value.includes('\0')||/^[\\/]{2}/.test(value)))throw fail('MIGRATION_JOURNAL_PATH','Нужны явные локальные пути источника и копии');
 const source=path.resolve(sourceDir),target=path.resolve(targetDir),parent=safeFile.verifiedDirectory(path.dirname(target)),base=path.basename(target);if(!base||/[\x00-\x1f\\/:*?"<>|]/.test(base)||/[. ]$/.test(base))throw fail('MIGRATION_JOURNAL_PATH','Недопустимый путь копии');
 const nested=(a,b)=>{const relative=path.relative(fold(a),fold(b));return !relative||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};if(nested(source,target)||nested(target,source))throw fail('MIGRATION_JOURNAL_PATH','Источник и копия должны быть отдельными каталогами');
 const key=sha(JSON.stringify([fold(target),kind]));return {source,target,parent,file:path.join(parent.path,'.tvs-migration-'+key+'.json'),lock:path.join(parent.path,'.tvs-migration-'+key+'.lock')};
}
function verifyJournal(journal,expected){
 const operation=journal?.operation,wanted=expected.operation;
 if(!journal||journal.format!==FORMAT||journal.version!==VERSION||!uuid(journal.migrationId)||!STATES.includes(journal.state)||!operation||!/^sha256:[a-f0-9]{64}$/.test(operation.sourceFingerprint||'')||!['json','sqlite'].includes(operation.targetFormat)||operation.kind!==wanted.kind||operation.sourceFingerprint!==wanted.sourceFingerprint||operation.targetFormat!==wanted.targetFormat||typeof operation.sourceDir!=='string'||typeof operation.targetDir!=='string'||!same(operation.sourceDir,wanted.sourceDir)||!same(operation.targetDir,wanted.targetDir)||!journal.parent||!same(journal.parent.path,expected.parent.path)||journal.parent.dev!==expected.parent.dev||journal.parent.ino!==expected.parent.ino||!journal.stage||typeof journal.stage.path!=='string')throw fail('MIGRATION_JOURNAL_INVALID','Журнал относится к другому источнику, копии или каталогу');
 identities.validate(journal.identity);if(journal.identity.generation!==1)throw fail('MIGRATION_JOURNAL_INVALID','Некорректное поколение копии');
 journal.attempt??=0;journal.retainedStages??=[];
 if(!Number.isSafeInteger(journal.attempt)||journal.attempt<0||journal.attempt>8||!Array.isArray(journal.retainedStages)||journal.retainedStages.length!==journal.attempt)throw fail('MIGRATION_JOURNAL_INVALID','Не подтверждён список сохранённых попыток миграции');
 const stagePath=attempt=>path.join(expected.parent.path,'.tvs-copy-'+journal.migrationId+(attempt?'-'+attempt:''));
 if(!same(journal.stage.path,stagePath(journal.attempt))||journal.retainedStages.some((item,index)=>!item||!same(item.path,stagePath(index))||!/^\d+$/.test(item.dev)||!/^\d+$/.test(item.ino)))throw fail('MIGRATION_JOURNAL_INVALID','Не подтверждён путь временной копии');
 if(STATES.indexOf(journal.state)>=1&&(!/^\d+$/.test(journal.stage.dev)||!/^\d+$/.test(journal.stage.ino)))throw fail('MIGRATION_JOURNAL_INVALID','Не подтверждена принадлежность временной копии');
 if(STATES.indexOf(journal.state)>=4&&(!/^sha256:[a-f0-9]{64}$/.test(journal.reportSha256)||!/^sha256:[a-f0-9]{64}$/.test(journal.contentDigest)||typeof journal.reportName!=='string'||!/^[a-z][a-z0-9-]*\.json$/.test(journal.reportName)))throw fail('MIGRATION_JOURNAL_INVALID','Не подтверждён отчёт копии');
}
function readPlan({sourceDir,targetDir,sourceFingerprint,kind='schema-upgrade'}={}){const location=paths(sourceDir,targetDir,kind);if(!stat(location.file))return null;const journal=readJSON(location.file);verifyJournal(journal,{parent:location.parent,operation:{kind,sourceDir:location.source,targetDir:location.target,sourceFingerprint:sourceFingerprint??journal?.operation?.sourceFingerprint,targetFormat:journal?.operation?.targetFormat}});return JSON.parse(JSON.stringify(journal));}
function ownedDirectory(journal,location=journal.stage.path){const proof=safeFile.verifiedDirectory(location);if(String(proof.dev)!==journal.stage.dev||String(proof.ino)!==journal.stage.ino)throw fail('MIGRATION_JOURNAL_OWNERSHIP','Временный каталог или копия были заменены');const owner=readJSON(path.join(location,OWNER));if(owner.format!=='tvs-migration-owner'||owner.migrationId!==journal.migrationId||owner.uuid!==journal.identity.uuid||owner.dev!==String(proof.dev)||owner.ino!==String(proof.ino))throw fail('MIGRATION_JOURNAL_OWNERSHIP','Не подтверждён владелец временной копии');return proof;}
function scanFiles(directory,action){const proof=safeFile.verifiedDirectory(directory);for(const name of fs.readdirSync(directory).sort()){safeFile.assertDirectory(proof);const file=path.join(directory,name),info=stat(file);if(!info||info.isSymbolicLink()||!info.isDirectory()&&(!info.isFile()||info.nlink!==1))throw fail('MIGRATION_JOURNAL_OWNERSHIP','В копии обнаружена неподтверждённая файловая ссылка');if(info.isDirectory())scanFiles(file,action);else action(file,info,proof);}safeFile.assertDirectory(proof);}
function hasPartialContents(journal){ownedDirectory(journal);const names=fs.readdirSync(journal.stage.path);ownedDirectory(journal);return names.some(name=>name!==OWNER);}
function flushOwned(journal){ownedDirectory(journal);scanFiles(journal.stage.path,(file,info,parent)=>{safeFile.assertDirectory(parent);const fd=fs.openSync(file,fs.constants.O_RDWR|(fs.constants.O_NOFOLLOW||0));try{safeFile.assertDirectory(parent);const actual=fs.fstatSync(fd);if(actual.dev!==info.dev||actual.ino!==info.ino||actual.nlink!==1)throw fail('MIGRATION_JOURNAL_OWNERSHIP','Файл копии изменился во время проверки');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}});syncDirectory(journal.stage.path);}
function contentDigest(journal){
 ownedDirectory(journal);const entries=[],changed=()=>{throw fail('MIGRATION_JOURNAL_STAGE_CHANGED','Содержимое проверенной копии изменилось');};
 const equal=(a,b)=>['dev','ino','size','mtimeMs','ctimeMs','nlink'].every(key=>a[key]===b[key]);
 const visit=(directory,prefix='')=>{const proof=safeFile.verifiedDirectory(directory);for(const name of fs.readdirSync(directory).sort()){const file=path.join(directory,name),relative=prefix+name,info=stat(file);if(!info||info.isSymbolicLink())changed();if(info.isDirectory()){entries.push({path:relative,type:'directory'});visit(file,relative+'/');continue;}if(!info.isFile()||info.nlink!==1)changed();const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)),hash=crypto.createHash('sha256'),buffer=Buffer.allocUnsafe(64*1024);let count=0;
   try{if(!equal(info,fs.fstatSync(fd)))changed();while(true){const length=fs.readSync(fd,buffer,0,buffer.length,null);if(!length)break;count+=length;if(count>info.size)changed();hash.update(buffer.subarray(0,length));}if(count!==info.size||!equal(info,fs.fstatSync(fd))||!equal(info,fs.lstatSync(file)))changed();}finally{fs.closeSync(fd);}entries.push({path:relative,type:'file',size:count,sha256:hash.digest('hex')});
  }safeFile.assertDirectory(proof);};visit(journal.stage.path);ownedDirectory(journal);return 'sha256:'+sha(JSON.stringify(entries));
}
function createMigrationJournal({checkpoint=()=>{},createUuid=()=>crypto.randomUUID()}={}){
 if(typeof checkpoint!=='function'||typeof createUuid!=='function')throw new TypeError('Некорректный журнал миграции');
 return function run(input){
  const {sourceDir,targetDir,sourceFingerprint,targetFormat,kind='schema-upgrade',descriptor,sourceIdentity=null,reportName='schema-upgrade-report.json'}=input||{};
  if(!/^sha256:[a-f0-9]{64}$/.test(sourceFingerprint||'')||!['json','sqlite'].includes(targetFormat)||!['schema-upgrade','sqlite-copy'].includes(kind)||!/^[a-z][a-z0-9-]*\.json$/.test(reportName)||!descriptor||typeof descriptor!=='object')throw fail('MIGRATION_JOURNAL_INVALID','Некорректный план миграции');
  for(const name of ['create','verify','verifySource','report'])if(typeof input[name]!=='function')throw new TypeError('Не задан этап миграции: '+name);
  if(input.verifyPublishedIdentity!==undefined&&typeof input.verifyPublishedIdentity!=='function')throw new TypeError('Не задана проверка идентификатора опубликованной копии');
  const location=paths(sourceDir,targetDir,kind),operation={kind,sourceDir:location.source,targetDir:location.target,sourceFingerprint,targetFormat},expected={operation,parent:location.parent},release=lock(location.lock,location.parent);let journal;
  const save=(state,label=state)=>{journal.state=state;durableJSON(location.file,journal,location.parent);checkpoint(label,JSON.parse(JSON.stringify(journal)));};
  const reportAt=directory=>{ownedDirectory(journal,directory);const bytes=safeFile.readRegularFileSync(path.join(directory,journal.reportName),{maxBytes:16*1024*1024,minBytes:1}),history=safeFile.readRegularFileSync(path.join(directory,'migration-history',journal.migrationId+'.json'),{maxBytes:16*1024*1024,minBytes:1});if('sha256:'+sha(bytes)!==journal.reportSha256||!history.equals(bytes))throw fail('MIGRATION_JOURNAL_REPORT','Отчёт или история копии изменились');return JSON.parse(bytes.toString('utf8'));};
  const publishedReport=()=>{const report=reportAt(location.target);if(input.verifyPublishedIdentity)input.verifyPublishedIdentity(location.target,{identity:journal.identity,descriptor:journal.descriptor,migrationId:journal.migrationId});ownedDirectory(journal,location.target);return report;};
  try{
   if(stat(location.file)){journal=readJSON(location.file);verifyJournal(journal,expected);if(JSON.stringify(journal.descriptor)!==JSON.stringify(descriptor)||journal.reportName!==reportName)throw fail('MIGRATION_JOURNAL_INVALID','Параметры совместимости миграции изменились');}
   else{
    if(stat(location.target))throw fail('MIGRATION_TARGET_EXISTS','Целевой каталог уже существует');input.verifySource();const migrationId=createUuid(),identity=identities.validate({format:'tvs-database-identity',version:1,uuid:createUuid(),generation:1});if(!uuid(migrationId))throw new TypeError('Некорректный идентификатор миграции');
    journal={format:FORMAT,version:VERSION,migrationId,operation,parent:location.parent,identity,descriptor:JSON.parse(JSON.stringify(descriptor)),sourceIdentity,startedAt:new Date().toISOString(),attempt:0,retainedStages:[],stage:{path:path.join(location.parent.path,'.tvs-copy-'+migrationId)},reportName,state:'planned'};save('planned');
   }
   if(['publishing','published','acknowledged'].includes(journal.state)&&stat(location.target)){
    const report=publishedReport();if(journal.state==='publishing')save('published');if(journal.state!=='acknowledged')save('acknowledged');return report;
   }
   if(['published','acknowledged'].includes(journal.state))throw fail('MIGRATION_JOURNAL_TARGET_MISSING','Созданная копия отсутствует; новая база не создавалась');
   input.verifySource();if(stat(location.target))throw fail('MIGRATION_TARGET_EXISTS','Целевой каталог уже существует');
   const createOwnedStage=()=>{
    safeFile.assertDirectory(location.parent);if(stat(journal.stage.path)){if(!/^\d+$/.test(journal.stage.dev)||!/^\d+$/.test(journal.stage.ino))throw fail('MIGRATION_JOURNAL_ORPHAN','Временный каталог без подтверждённого владельца сохранён для ручной проверки');ownedDirectory(journal);}else{fs.mkdirSync(journal.stage.path,{mode:0o700});const proof=safeFile.verifiedDirectory(journal.stage.path);journal.stage={path:proof.path,dev:String(proof.dev),ino:String(proof.ino)};durableJSON(path.join(proof.path,OWNER),{format:'tvs-migration-owner',migrationId:journal.migrationId,uuid:journal.identity.uuid,dev:String(proof.dev),ino:String(proof.ino)},proof);syncDirectory(location.parent.path);save('planned','stage-created');}save('owned','stage-owned');
   };
   if(journal.state==='planned')createOwnedStage();
   ownedDirectory(journal);
   if(journal.state==='owned'){
    if(hasPartialContents(journal)){
     if(journal.attempt>=8)throw fail('MIGRATION_JOURNAL_ATTEMPT_LIMIT','Сохранено восемь незавершённых попыток. Проверьте их вручную перед новым копированием.');
     // Never recurse into or delete a partial stage. Its root ownership is
     // recorded, and a new bounded attempt keeps the same pinned DB identity.
     journal.retainedStages.push({...journal.stage});journal.attempt++;journal.stage={path:path.join(location.parent.path,'.tvs-copy-'+journal.migrationId+'-'+journal.attempt)};save('planned','retry-planned');createOwnedStage();
    }
    input.create(journal.stage.path,{identity:journal.identity,descriptor:journal.descriptor,migrationId:journal.migrationId});flushOwned(journal);save('copied','data-copied');
   }
   let verifiedThisRun=false;
   if(journal.state==='copied'){input.verify(journal.stage.path,{identity:journal.identity,descriptor:journal.descriptor,migrationId:journal.migrationId});verifiedThisRun=true;input.verifySource();save('verified');}
   if(journal.state==='verified'){
    if(!verifiedThisRun)input.verify(journal.stage.path,{identity:journal.identity,descriptor:journal.descriptor,migrationId:journal.migrationId});input.verifySource();
    const report=input.report(journal.stage.path,{identity:journal.identity,descriptor:journal.descriptor,migrationId:journal.migrationId,sourceIdentity:journal.sourceIdentity,startedAt:journal.startedAt,retainedStages:JSON.parse(JSON.stringify(journal.retainedStages))});if(!report||typeof report!=='object'||Array.isArray(report))throw fail('MIGRATION_JOURNAL_REPORT','Не получен отчёт проверенной копии');
    durableJSON(path.join(journal.stage.path,reportName),report,ownedDirectory(journal));const history=safeFile.verifiedDirectory(path.join(journal.stage.path,'migration-history'),{create:true});durableJSON(path.join(history.path,journal.migrationId+'.json'),report,history);journal.reportSha256='sha256:'+sha(safeFile.readRegularFileSync(path.join(journal.stage.path,reportName),{maxBytes:16*1024*1024,minBytes:1}));flushOwned(journal);journal.contentDigest=contentDigest(journal);save('report-ready','report-written');
   }
   if(journal.state==='report-ready'){reportAt(journal.stage.path);if(contentDigest(journal)!==journal.contentDigest)throw fail('MIGRATION_JOURNAL_STAGE_CHANGED','Содержимое проверенной копии изменилось');input.verifySource();save('publishing','publish-intent');}
   if(journal.state==='publishing'){
    reportAt(journal.stage.path);if(contentDigest(journal)!==journal.contentDigest)throw fail('MIGRATION_JOURNAL_STAGE_CHANGED','Содержимое проверенной копии изменилось');input.verifySource();safeFile.assertDirectory(location.parent);if(stat(location.target))throw fail('MIGRATION_TARGET_EXISTS','Целевой каталог появился перед публикацией');fs.renameSync(journal.stage.path,location.target);syncDirectory(location.parent.path);checkpoint('renamed',JSON.parse(JSON.stringify(journal)));save('published');
   }
   const report=publishedReport();save('acknowledged');return report;
  }finally{release();}
 };
}
module.exports=Object.freeze({createMigrationJournal,runCopy:createMigrationJournal(),readPlan,FORMAT,VERSION});
