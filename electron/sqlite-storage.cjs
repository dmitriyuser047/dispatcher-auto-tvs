'use strict';

// SQLite is an explicit storage format. These functions never migrate JSON or
// create a database during a read. The public storage service remains responsible
// for permissions, CAS, domain rules, canonical audit and operation receipts.
const fs=require('node:fs');
const crypto=require('node:crypto');
const path=require('node:path');
const os=require('node:os');
const {DatabaseSync}=require('node:sqlite');
const schema=require('../assets/core/platform-schema.js');
const integrity=require('../assets/core/platform-integrity.js');
const FORMAT='tvs-platform-sqlite',VERSION=1,FILE='platform.sqlite';
const storageFormat=require('./storage-format.cjs'),SCHEMA_VERSION=storageFormat.SCHEMA_VERSION;
const held=new Map();
const operationReads=new WeakMap(),OPERATION_READ_BYTES=64*1024*1024,OPERATION_READ_ENTRIES=256;
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
const plain=value=>value!==null&&Object.prototype.toString.call(value)==='[object Object]';
const present=value=>value!==undefined&&value!==null&&value!=='';
const idKey=value=>typeof value+':'+JSON.stringify(value);
const scalarId=value=>typeof value==='string'&&!!value.trim()&&value.length<=500&&!['__proto__','constructor','prototype'].includes(value)||typeof value==='number'&&Number.isFinite(value);
const card=value=>String(value??'').replace(/\D/g,'')||String(value??'').trim().toUpperCase();
function fail(code,message){const error=new Error(message);error.code=code;throw error;}
function location(dataDir){
  if(typeof dataDir!=='string'||!dataDir.trim())fail('SQLITE_PATH','Не указан локальный каталог SQLite');
  const network=value=>/^[\\/]{2}/.test(value)||/^file:/i.test(value);
  if(network(dataDir))fail('SQLITE_NETWORK_PATH','SQLite должна находиться на локальном диске основного компьютера; UNC-пути не поддерживаются');
  const resolved=path.resolve(dataDir);
  if(network(resolved))fail('SQLITE_NETWORK_PATH','Сетевая папка SQLite не поддерживается');
  let parent=resolved;
  while(!fs.existsSync(parent)){const next=path.dirname(parent);if(next===parent)break;parent=next;}
  const real=fs.existsSync(parent)?fs.realpathSync.native(parent):parent;
  if(network(real))fail('SQLITE_NETWORK_PATH','Каталог SQLite указывает на сетевую папку');
  const directory=parent===resolved?real:path.join(real,path.relative(parent,resolved));
  return {directory,key:process.platform==='win32'?directory.toLowerCase():directory,file:path.join(directory,FILE)};
}
function filename(dataDir){return location(dataDir).file;}
function exists(dataDir){try{fs.lstatSync(filename(dataDir));return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
function assertDatabaseFile(target){
  const info=fs.lstatSync(target.file);
  if(!info.isFile()||info.isSymbolicLink()||info.nlink>1)fail('SQLITE_PATH_ESCAPE','Файл SQLite должен быть обычным отдельным файлом внутри выбранного каталога');
  const resolved=fs.realpathSync.native(target.file),normalize=value=>process.platform==='win32'?value.toLowerCase():value;
  if(/^[\\/]{2}/.test(resolved)||normalize(resolved)!==normalize(target.file))fail('SQLITE_PATH_ESCAPE','Файл SQLite указывает за пределы выбранного каталога');
}
function json(value){
  const parents=new Set();
  function visit(current,depth){
    if(depth>100)fail('SQLITE_JSON','Слишком глубокая структура записи');
    if(current===null||typeof current==='string'||typeof current==='boolean')return;
    if(typeof current==='number'){if(!Number.isFinite(current))fail('SQLITE_JSON','Нечисловое значение в записи');return;}
    if(!Array.isArray(current)&&!plain(current))fail('SQLITE_JSON','В хранилище допустимы только данные JSON');
    if(parents.has(current))fail('SQLITE_JSON','Циклическая структура записи');parents.add(current);
    for(const child of Object.values(current))visit(child,depth+1);parents.delete(current);
  }
  visit(value,0);return JSON.stringify(value);
}
function validateRows(name,rows){if(!schema.sections.includes(name)||!Array.isArray(rows)||rows.some(row=>!plain(row)))fail('SQLITE_ROWS','Некорректный раздел SQLite: '+name);rows.forEach(json);}
function revisionsOf(input,base={}){
  if(!plain(input)||Object.keys(input).some(name=>!schema.sections.includes(name)))fail('SQLITE_REVISIONS','Некорректные версии разделов SQLite');
  const result={};for(const name of schema.sections){const value=own(input,name)?input[name]:base[name]??0;if(!Number.isSafeInteger(value)||value<0)fail('SQLITE_REVISIONS','Повреждена версия раздела '+name);result[name]=value;}return result;
}
function configure(db,readOnly){
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  if(readOnly)db.exec('PRAGMA query_only=ON;');
  else db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
}
function validateFormat(db){
  const applicationId=db.prepare('PRAGMA application_id').get().application_id,fileVersion=db.prepare('PRAGMA user_version').get().user_version;
  if(fileVersion>SCHEMA_VERSION)fail('SQLITE_FUTURE_FORMAT','Файл SQLite создан более новой версией программы');
  if(applicationId!==0x54565331||!storageFormat.SUPPORTED_READ_SCHEMAS.includes(fileVersion))fail('SQLITE_FORMAT','Не совпадает служебная версия или идентификатор файла SQLite');
  const metadata=Object.fromEntries(db.prepare('SELECT key,value FROM metadata').all().map(row=>[row.key,row.value]));
  if(metadata.format!==FORMAT)fail('SQLITE_FORMAT','Неизвестный формат базы SQLite');
  const version=Number(metadata.format_version),schemaVersion=Number(metadata.schema_version);
  if(version>VERSION||schemaVersion>SCHEMA_VERSION)fail('SQLITE_FUTURE_FORMAT','Эта база SQLite создана более новой версией программы');
  if(version!==VERSION||!storageFormat.SUPPORTED_READ_SCHEMAS.includes(schemaVersion)||metadata.format_version!==String(VERSION)||metadata.schema_version!==String(schemaVersion)||fileVersion!==schemaVersion)fail('SQLITE_FORMAT','Не поддерживается версия формата SQLite');
  if(schemaVersion>=3){let descriptor;try{descriptor=JSON.parse(metadata.compatibility);}catch{fail('SQLITE_FORMAT','Отсутствует подтверждение совместимости SQLite');}storageFormat.validateDescriptor(descriptor,schemaVersion);}
  else if(own(metadata,'compatibility'))fail('SQLITE_FORMAT','Подтверждение совместимости не соответствует версии SQLite');
  if(schemaVersion>=4){let operationState;try{operationState=JSON.parse(metadata.operation_state);}catch{fail('SQLITE_OPERATION_STATE','Отсутствует состояние истории операций');}storageFormat.validateOperationState(operationState);if(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name IN('operation_ledger_objects','operation_ledger_receipts')").get().n!==2)fail('SQLITE_OPERATION_STATE','Отсутствуют служебные таблицы истории');}
  const sections=db.prepare('SELECT name,revision FROM sections').all();
  const names=storageFormat.sectionsFor(schemaVersion);
  if(sections.length!==names.length||sections.some(row=>!names.includes(row.name)||!Number.isSafeInteger(row.revision)||row.revision<0))fail('SQLITE_REVISIONS','Каталог или версии разделов SQLite не соответствуют формату программы');
  return schemaVersion;
}
function resultSync(action){
  if(action.constructor?.name==='AsyncFunction')fail('SQLITE_ASYNC_TRANSACTION','Транзакция SQLite принимает только синхронное действие');
  const result=action();if(result&&typeof result.then==='function'){if(typeof result.catch==='function')result.catch(()=>{});fail('SQLITE_ASYNC_TRANSACTION','Внутри транзакции SQLite нельзя ожидать асинхронную операцию');}return result;
}
function transaction(dataDir,action,options={}){
  if(typeof action!=='function')fail('SQLITE_TRANSACTION','Не задано действие транзакции');
  const target=location(dataDir),current=held.get(target.key),readOnly=options.readOnly===true;
  if(current){
    if(!readOnly&&current.scopes.some(Boolean)){const error=new Error('Запись внутри транзакции только для чтения запрещена');error.code='SQLITE_READ_ONLY';current.failure??=error;throw error;}
    current.scopes.push(readOnly);
    try{const result=resultSync(action);if(options.beforeCommit)resultSync(()=>options.beforeCommit());return result;}
    catch(error){current.failure??=error;throw error;}finally{current.scopes.pop();}
  }
  if(!exists(target.directory))fail('SQLITE_NOT_FOUND','Файл SQLite не найден; автоматическое создание запрещено');
  assertDatabaseFile(target);
  const header=Buffer.alloc(100),descriptor=fs.openSync(target.file,'r');try{fs.readSync(descriptor,header,0,100,0);}finally{fs.closeSync(descriptor);}
  const headerSchema=header.subarray(0,16).toString('binary')==='SQLite format 3\0'?header.readUInt32BE(60):null;
  if(headerSchema>SCHEMA_VERSION)fail('SQLITE_FUTURE_FORMAT','Файл SQLite создан более новой версией программы');
  const legacy=storageFormat.SUPPORTED_READ_SCHEMAS.includes(headerSchema)&&headerSchema<SCHEMA_VERSION;
  let readStage=null,readIdentity=null,openFile=target.file;
  const cleanRead=()=>{if(!readStage)return;const info=fs.lstatSync(readStage);if(path.dirname(path.resolve(readStage))!==path.resolve(os.tmpdir())||!path.basename(readStage).startsWith('tvs-sqlite-legacy-read-')||info.isSymbolicLink()||info.ino!==readIdentity.ino||info.dev!==readIdentity.dev)fail('SQLITE_READ_CLEANUP','Не подтверждён временный каталог чтения');fs.rmSync(readStage,{recursive:true,force:true});readStage=null;};
  if(legacy){
    if(!readOnly)storageFormat.upgradeRequired();
    const rollback=require('./sqlite-rollback.cjs');let rollbackToken;
    try{rollbackToken=rollback.assertQuiescent(target.file);}catch{fail('SQLITE_LEGACY_BUSY','Старая SQLite содержит незавершённый или небезопасный журнал. Завершите сохранение в прежней программе');}
    const assertWal=()=>{const file=target.file+'-wal';let state;try{state=fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')return;throw error;}if(!state.isFile()||state.isSymbolicLink()||state.nlink>1||state.size)fail('SQLITE_LEGACY_BUSY','Старая SQLite содержит незавершённый журнал. Закройте прежнюю программу штатно перед чтением или созданием копии');};assertWal();
    const before=fs.statSync(target.file),bytes=fs.readFileSync(target.file),after=fs.statSync(target.file);if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ino!==after.ino)fail('SQLITE_LEGACY_CHANGED','Старая база изменилась при чтении');
    try{rollback.assertUnchanged(target.file,rollbackToken);}catch{fail('SQLITE_LEGACY_BUSY','Журнал старой SQLite изменился во время чтения');}assertWal();
    readStage=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-sqlite-legacy-read-'));readIdentity=fs.statSync(readStage);openFile=path.join(readStage,FILE);try{fs.writeFileSync(openFile,bytes,{flag:'wx'});}catch(error){cleanRead();throw error;}
  }
  let db;
  try{db=new DatabaseSync(openFile,{readOnly,enableForeignKeyConstraints:true,allowExtension:false,enableDoubleQuotedStringLiterals:false,timeout:5000,defensive:true});}
  catch(error){cleanRead();throw error;}
  const session={db,scopes:[readOnly],failure:null};let began=false;
  try{
    // Validate an old schema before WAL configuration or a write transaction.
    // Legacy databases are readable, but upgrading is an explicit COPY action.
    const version=validateFormat(db);if(!readOnly&&version<SCHEMA_VERSION)storageFormat.upgradeRequired();
    configure(db,readOnly);db.exec(readOnly?'BEGIN;':'BEGIN IMMEDIATE;');began=true;validateFormat(db);held.set(target.key,session);
    const result=resultSync(action);if(session.failure)throw session.failure;if(options.beforeCommit)resultSync(()=>options.beforeCommit());
    db.exec('COMMIT;');began=false;return result;
  }catch(error){if(began)try{db.exec('ROLLBACK;');}catch{}throw error;}
  finally{held.delete(target.key);operationReads.delete(db);db.close();cleanRead();}
}
function connection(dataDir){const session=held.get(location(dataDir).key);if(!session)fail('SQLITE_TRANSACTION','Нет активного соединения SQLite');return session.db;}
function readRows(dataDir,name){
  if(!schema.sections.includes(name))fail('SQLITE_SECTION','Неизвестный раздел SQLite: '+name);
  return transaction(dataDir,()=>connection(dataDir).prepare('SELECT row_json FROM section_rows WHERE section=? ORDER BY position').all(name).map(row=>JSON.parse(row.row_json)),{readOnly:true});
}
function countLegacyAssetReferences(dataDir,section,text){
  if(!['vehicles','generators','tanks'].includes(section)||typeof text!=='string')fail('QUERY_INVALID','Неверная проверка ссылки на технику');
  const number=Number(text),numeric=Number.isFinite(number)&&String(number)===text;
  return transaction(dataDir,()=>connection(dataDir).prepare("SELECT count(*) AS count FROM section_rows WHERE section=? AND ((id_type='string' AND id_value=?) OR (id_type='number' AND id_value=?) OR (id_type='legacy' AND json_type(row_json,'$.id')='text' AND json_extract(row_json,'$.id')=?))").get(section,JSON.stringify(text),numeric?JSON.stringify(number):'',text).count,{readOnly:true});
}
function queryRows(dataDir,input){
  const spec=require('./data-query.cjs');
  if(!plain(input)||Object.keys(input).some(key=>!['section','limit','from','to','assetRef','search','afterPosition'].includes(key)))fail('QUERY_INVALID','Неверные параметры выборки SQLite');
  const {afterPosition=-1,...selection}=input,query=spec.normalizeQuery(selection);
  if(!Number.isSafeInteger(afterPosition)||afterPosition< -1)fail('QUERY_INVALID','Неверная позиция страницы SQLite');
  if(['auditLog','documentDrafts'].includes(query.section))fail('QUERY_UNSUPPORTED','Индексированная выборка истории и смешанных черновиков пока недоступна');
  return transaction(dataDir,()=>{
    const db=connection(dataDir),where=['section=?'],parameters=[query.section];
    if(query.from){where.push('date_value>=?');parameters.push(query.from);}
    if(query.to){where.push('date_value<=?');parameters.push(query.to+'\uffff');}
    if(query.assetRef){where.push('asset_ref=?');parameters.push(query.assetRef);}
    if(query.search){
      // Caller controls neither field names nor JSON paths. Only bounded scalar
      // text enters the search projection; financial amounts and nested history
      // are never searched to derive counts for another role.
      db.function('tvs_query_scalar',{deterministic:true},spec.searchScalar);
      db.function('tvs_query_fold',{deterministic:true},value=>value.toLowerCase());
      const text=spec.SEARCH_FIELDS.map(field=>`CASE WHEN json_type(row_json,'$.${field}') IN ('text','integer','real') THEN tvs_query_scalar(json_extract(row_json,'$.${field}')) ELSE '' END`).join("||char(10)||");
      where.push('instr(tvs_query_fold('+text+'),?)>0');parameters.push(query.search);
    }
    const condition=where.join(' AND '),total=db.prepare('SELECT count(*) AS count FROM section_rows WHERE '+condition).get(...parameters).count;
    const entries=db.prepare('SELECT position,row_json FROM section_rows WHERE '+condition+' AND position>? ORDER BY position LIMIT ?').all(...parameters,afterPosition,query.limit+1);
    const page=entries.slice(0,query.limit);
    return {rows:page.map(entry=>JSON.parse(entry.row_json)),positions:page.map(entry=>entry.position),total,hasMore:entries.length>query.limit};
  },{readOnly:true});
}
function readAll(dataDir){return transaction(dataDir,()=>{
  const version=validateFormat(connection(dataDir)),names=storageFormat.sectionsFor(version),result=Object.fromEntries(schema.sections.map(name=>[name,[]]));
  for(const row of connection(dataDir).prepare('SELECT section,row_json FROM section_rows ORDER BY section,position').all()){
    if(!names.includes(row.section))fail('SQLITE_SECTION','База содержит неизвестный раздел');result[row.section].push(JSON.parse(row.row_json));
  }
  if(version>=4){require('./operation-store.cjs').validateHot(dataDir,result.auditLog);const platform=require('./platform-service.cjs');if(typeof platform.bindHistory==='function')platform.bindHistory(result,dataDir);}
  return result;
},{readOnly:true});}
function readRevisions(dataDir){return transaction(dataDir,()=>{
  const revisions=Object.fromEntries(connection(dataDir).prepare('SELECT name,revision FROM sections').all().map(row=>[row.name,row.revision]));
  return revisionsOf(revisions);
},{readOnly:true});}
function schemaVersion(dataDir){return transaction(dataDir,()=>validateFormat(connection(dataDir)),{readOnly:true});}
function readDescriptor(dataDir){return transaction(dataDir,()=>{const db=connection(dataDir),version=validateFormat(db);return version>=3?storageFormat.validateDescriptor(JSON.parse(db.prepare("SELECT value FROM metadata WHERE key='compatibility'").get().value),version):storageFormat.describe(version);},{readOnly:true});}
function readOperationState(dataDir){return transaction(dataDir,()=>{const db=connection(dataDir);if(validateFormat(db)<4)fail('SQLITE_OPERATION_STATE','История операций доступна начиная со схемы4');return storageFormat.validateOperationState(JSON.parse(db.prepare("SELECT value FROM metadata WHERE key='operation_state'").get().value));},{readOnly:true});}
function readOperationText(dataDir,id){if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))fail('SQLITE_OPERATION_HASH','Некорректный ключ истории');return transaction(dataDir,()=>{
 const db=connection(dataDir);let cache=operationReads.get(db);if(!cache){cache={entries:new Map(),bytes:0};operationReads.set(db,cache);}
 if(cache.entries.has(id)){const entry=cache.entries.get(id);cache.entries.delete(id);cache.entries.set(id,entry);return entry.json;}
 const row=db.prepare('SELECT json FROM operation_ledger_objects WHERE hash=?').get(id);if(!row)return null;const json=row.json,bytes=Buffer.byteLength(json);
 if(bytes<=8*1024*1024){while(cache.entries.size>=OPERATION_READ_ENTRIES||cache.bytes+bytes>OPERATION_READ_BYTES){const first=cache.entries.keys().next().value;cache.bytes-=cache.entries.get(first).bytes;cache.entries.delete(first);}cache.entries.set(id,{json,bytes});cache.bytes+=bytes;}
 return json;
 },{readOnly:true});}
function readOperationObject(dataDir,id){const json=readOperationText(dataDir,id);return json===null?null:Buffer.from(json);}

function operationWriter(dataDir){const session=held.get(location(dataDir).key);if(!session||session.scopes.some(Boolean))fail('SQLITE_OPERATION_TRANSACTION','История записывается только внутри текущей физической транзакции');return session.db;}
function putOperationObjects(dataDir,objects){const db=operationWriter(dataDir);if(!Array.isArray(objects))fail('SQLITE_OPERATION_HASH','Некорректный набор объектов истории');const put=db.prepare('INSERT OR IGNORE INTO operation_ledger_objects VALUES(?,?)');for(const object of objects){if(!plain(object)||typeof object.id!=='string'||!/^[a-f0-9]{64}$/.test(object.id)||typeof object.json!=='string'||Buffer.byteLength(object.json)>8*1024*1024||crypto.createHash('sha256').update(object.json).digest('hex')!==object.id)fail('SQLITE_OPERATION_HASH','Повреждён объект истории');put.run(object.id,object.json);if(db.prepare('SELECT json FROM operation_ledger_objects WHERE hash=?').get(object.id).json!==object.json)fail('SQLITE_OPERATION_HASH','Объект истории изменился');}}
function writeOperationState(dataDir,value){operationWriter(dataDir).prepare("UPDATE metadata SET value=? WHERE key='operation_state'").run(JSON.stringify(storageFormat.validateOperationState(value)));}
const operationDDL=`CREATE TABLE operation_ledger_objects(hash TEXT PRIMARY KEY,json TEXT NOT NULL) STRICT; CREATE TABLE operation_ledger_receipts(operation_id TEXT PRIMARY KEY,receipt_hash TEXT,proof_hash TEXT,status TEXT NOT NULL CHECK(status IN('receipt','reserved-unknown')),CHECK((status='receipt' AND receipt_hash IS NOT NULL AND proof_hash IS NOT NULL) OR (status='reserved-unknown' AND receipt_hash IS NULL AND proof_hash IS NULL))) STRICT;`;
function indexOperationObjects(db,objects,{replace=false}={}){const map=new Map(objects.map(object=>[object.id,JSON.parse(object.json)])),put=db.prepare('INSERT INTO operation_ledger_receipts VALUES(?,?,?,?)'+(replace?' ON CONFLICT(operation_id) DO UPDATE SET receipt_hash=excluded.receipt_hash,proof_hash=excluded.proof_hash,status=excluded.status':''));for(const object of map.values()){if(object.kind==='reserved-unknown')put.run(object.operationId,null,null,'reserved-unknown');else if(object.kind==='leaf'){const receipt=map.get(object.receiptHash)||JSON.parse(db.prepare('SELECT json FROM operation_ledger_objects WHERE hash=?').get(object.receiptHash).json);put.run(object.operationId,object.receiptHash,receipt.proofHash,'receipt');}}}
function readIdentity(dataDir){return transaction(dataDir,()=>{
  const metadata=Object.fromEntries(connection(dataDir).prepare("SELECT key,value FROM metadata WHERE key IN('database_uuid','generation')").all().map(row=>[row.key,row.value]));
  if(!metadata.database_uuid&&!metadata.generation&&validateFormat(connection(dataDir))<SCHEMA_VERSION)return null;
  return require('./database-identity.cjs').validate({format:'tvs-database-identity',version:1,uuid:metadata.database_uuid,generation:Number(metadata.generation)});
},{readOnly:true});}
function rowEntries(data){
  const entries=[],bySection={};
  for(const section of schema.sections){const occurrences=new Map();bySection[section]=[];
    (data[section]||[]).forEach((row,position)=>{
      const identity=integrity.rowIdentity(section,row,position),occurrence=occurrences.get(identity)||0;occurrences.set(identity,occurrence+1);
      const value=row[schema.descriptors[section].identity.field],type=scalarId(value)?typeof value:identity.startsWith('natural:')?'natural':identity.startsWith('composite:')?'composite':'legacy';
      const entry={section,row,position,key:JSON.stringify([identity,occurrence]),identity,idType:type,idValue:scalarId(value)?JSON.stringify(value):identity,raw:json(row)};
      entries.push(entry);bySection[section].push(entry);
    });
  }
  return {entries,bySection};
}
function values(row,field){
  const tokens=field.split('.'),result=[];
  function walk(value,index,path){if(index===tokens.length){result.push({value,path});return;}if(value==null)return;
    const token=tokens[index],many=token.endsWith('[]'),key=many?token.slice(0,-2):token,next=path?path+'.'+key:key;
    if(!plain(value)){result.push({invalid:true,path:next});return;}
    if(many){if(value[key]==null)return;if(!Array.isArray(value[key])){result.push({invalid:true,path:next});return;}value[key].forEach((child,position)=>walk(child,index+1,next+'['+position+']'));}
    else walk(value[key],index+1,next);
  }
  walk(row,0,'');return result;
}
function references(data,graph){
  const links=[],issues=[],byId={},byString={};
  for(const section of schema.sections){byId[section]=new Map();byString[section]=new Map();for(const entry of graph.bySection[section])if(scalarId(entry.row.id)){
    for(const [index,key]of [[byId[section],idKey(entry.row.id)],[byString[section],String(entry.row.id)]]){if(!index.has(key))index.set(key,[]);index.get(key).push(entry);}
  }}
  const addIssue=(entry,relation,field,code,target={})=>issues.push({code,section:entry.section,rowKey:entry.key,field,relationId:relation.id,...target});
  for(const relation of schema.relations){if(relation.kind==='historical'||relation.strength==='historical'||relation.strength==='advisory')continue;
    for(const entry of graph.bySection[relation.from]){if(entry.row.deleted)continue;for(const value of values(entry.row,relation.field)){
      if(value.invalid){addIssue(entry,relation,value.path,'reference-container');continue;}if(!present(value.value))continue;
      let targetSection=relation.target,targetId=value.value,string=false;
      if(relation.kind==='assetRef'){
        const match=typeof targetId==='string'&&targetId.match(/^([vgt]):(.+)$/);targetSection=match&&relation.targets[match[1]];targetId=match&&match[2];string=true;
      }else if(relation.kind==='discriminator'){
        let selector=relation.selectorAligned===true?schema.referenceSelector(entry.row,relation,value.path):values(entry.row,relation.selector)[0]?.value;if(relation.prefix&&typeof selector==='string')selector=selector.split(':')[0];targetSection=relation.targets[selector];
        if(!targetSection&&relation.unknownPolicy==='advisory')continue;
      }
      if(!targetSection||!scalarId(targetId)){addIssue(entry,relation,value.path,'reference-invalid');continue;}
      let matches=(string?byString[targetSection].get(String(targetId)):byId[targetSection].get(idKey(targetId)))||[];
      if(!matches.length&&relation.resolve==='fuel-purchase-journal'){
        const candidates=graph.bySection.records.filter(candidate=>candidate.row.vehicleId===entry.row.vehicleId&&candidate.row.date===entry.row.date&&(!entry.row.grade||candidate.row.fuelGrade===entry.row.grade));
        if(candidates.length===1){matches=candidates;addIssue(entry,relation,value.path,'reference-resolved-legacy',{targetSection,targetId});}
      }
      if(matches.length!==1){addIssue(entry,relation,value.path,matches.length?'reference-ambiguous':'reference-missing',{targetSection,targetId});continue;}
      links.push({source:entry,relation:relation.id,field:value.path,target:matches[0]});
    }}
  }
  return {links,issues};
}
function build(db,data,revisions,names){
  const graph=rowEntries(data),edges=references(data,graph);
  // Rebuild projection links in the same SQL transaction. The original JSON is
  // the compatibility representation; unresolved old links are evidence, not
  // silently rewritten IDs or rows. The kernel prevents new invalid references.
  db.exec('DELETE FROM row_links; DELETE FROM reference_issues;');
  const remove=db.prepare('DELETE FROM section_rows WHERE section=?'),insert=db.prepare('INSERT INTO section_rows(section,row_key,position,identity_key,id_type,id_value,row_json,date_value,asset_ref) VALUES(?,?,?,?,?,?,?,?,?)');
  const revision=db.prepare('UPDATE sections SET revision=? WHERE name=?');
  for(const name of names){remove.run(name);for(const entry of graph.bySection[name]){
    const date=typeof entry.row.date==='string'?entry.row.date:typeof entry.row.month==='string'?entry.row.month:null;
    const asset=typeof entry.row.assetRef==='string'?entry.row.assetRef:present(entry.row.vehicleId)?'v:'+entry.row.vehicleId:present(entry.row.generatorId)?'g:'+entry.row.generatorId:null;
    insert.run(name,entry.key,entry.position,entry.identity,entry.idType,entry.idValue,entry.raw,date,asset);
  }}
  for(const name of schema.sections)revision.run(revisions[name],name);
  const link=db.prepare('INSERT INTO row_links(source_section,source_key,relation_id,field_path,target_section,target_key) VALUES(?,?,?,?,?,?)');
  for(const edge of edges.links)link.run(edge.source.section,edge.source.key,edge.relation,edge.field,edge.target.section,edge.target.key);
  const issue=db.prepare('INSERT INTO reference_issues(section,row_key,issue_json) VALUES(?,?,?)');for(const entry of edges.issues)issue.run(entry.section,entry.rowKey,JSON.stringify(entry));
}
function commitSections(dataDir,sections,revisions,options={}){
  if(!plain(sections))fail('SQLITE_ROWS','Некорректный набор разделов SQLite');for(const [name,rows]of Object.entries(sections))validateRows(name,rows);
  if(!Object.keys(sections).length&&!options.nextOperationState)return;
  return transaction(dataDir,()=>{
    const current=readAll(dataDir),next={...current,...sections},versions=revisionsOf(revisions,readRevisions(dataDir)),store=require('./operation-store.cjs'),expected=options.expectedOperationState||store.readState(dataDir),commit=store.validateCommit(dataDir,{expectedOperationState:expected,nextOperationState:options.nextOperationState||storageFormat.createOperationState(expected.head),operationPlans:options.operationPlans||[]},{previousHotRows:current.auditLog,nextHotRows:next.auditLog});
    putOperationObjects(dataDir,commit.objects);indexOperationObjects(connection(dataDir),commit.objects);build(connection(dataDir),next,versions,Object.keys(sections));writeOperationState(dataDir,commit.nextOperationState);const platform=require('./platform-service.cjs');if(typeof platform.bindHistory==='function')platform.bindHistory(next,dataDir);
  },options);
}
const ddl=`
  PRAGMA application_id=0x54565331;
  PRAGMA user_version=${SCHEMA_VERSION};
  CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
  CREATE TABLE sections(name TEXT PRIMARY KEY,revision INTEGER NOT NULL CHECK(revision>=0 AND revision<=9007199254740991)) STRICT;
  CREATE TABLE section_rows(
    section TEXT NOT NULL REFERENCES sections(name),row_key TEXT NOT NULL,position INTEGER NOT NULL CHECK(position>=0),identity_key TEXT NOT NULL,
    id_type TEXT NOT NULL CHECK(id_type IN('string','number','natural','composite','legacy')),id_value TEXT NOT NULL,
    row_json TEXT NOT NULL CHECK(json_valid(row_json) AND json_type(row_json)='object'),date_value TEXT,asset_ref TEXT,
    PRIMARY KEY(section,row_key),UNIQUE(section,position)
  ) STRICT;
  CREATE INDEX rows_by_identity ON section_rows(section,identity_key);
  CREATE INDEX rows_by_date ON section_rows(section,date_value);
  CREATE INDEX rows_by_asset ON section_rows(asset_ref,section,date_value);
  CREATE TABLE row_links(
    source_section TEXT NOT NULL,source_key TEXT NOT NULL,relation_id TEXT NOT NULL,field_path TEXT NOT NULL,target_section TEXT NOT NULL,target_key TEXT NOT NULL,
    PRIMARY KEY(source_section,source_key,relation_id,field_path),
    FOREIGN KEY(source_section,source_key) REFERENCES section_rows(section,row_key) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY(target_section,target_key) REFERENCES section_rows(section,row_key) DEFERRABLE INITIALLY DEFERRED
  ) STRICT;
  CREATE INDEX links_to_target ON row_links(target_section,target_key);
  CREATE TABLE reference_issues(
    id INTEGER PRIMARY KEY,section TEXT NOT NULL,row_key TEXT NOT NULL,issue_json TEXT NOT NULL CHECK(json_valid(issue_json)),
    FOREIGN KEY(section,row_key) REFERENCES section_rows(section,row_key) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
  ) STRICT;
`;
function writeGuard(directory){
  const folder=path.join(directory,'sections');fs.mkdirSync(folder);
  const fd=fs.openSync(path.join(folder,'revisions.json'),'wx');
  try{fs.writeFileSync(fd,JSON.stringify({format:'sqlite',schemaVersion:SCHEMA_VERSION,vehicles:null,records:null,error:'Эта база использует platform.sqlite; нужна версия программы с поддержкой SQLite'}),'utf8');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
function create(dataDir,input,options={}){
  if(!plain(input)||!plain(input.data)||Object.keys(input.data).some(name=>!schema.sections.includes(name)))fail('SQLITE_CREATE','Для создания нужны разделы данных и их версии');
  const descriptor=storageFormat.validateDescriptor(input.descriptor===undefined?storageFormat.describe(SCHEMA_VERSION):input.descriptor,SCHEMA_VERSION),identity=require('./database-identity.cjs').validate(input.identity===undefined?{format:'tvs-database-identity',version:1,uuid:crypto.randomUUID(),generation:1}:input.identity);
  const data=Object.fromEntries(schema.sections.map(name=>[name,own(input.data,name)?input.data[name]:[]]));for(const [name,rows]of Object.entries(data))validateRows(name,rows);
  const store=require('./operation-store.cjs'),provided=own(input,'operationState')||own(input,'operationObjects'),seed=provided?store.validateSeed({operationState:input.operationState,operationObjects:input.operationObjects,hotRows:data.auditLog}):store.bootstrap({auditRows:data.auditLog});data.auditLog=seed.hotRows;
  const revisions=revisionsOf(input.revisions===undefined?{}:input.revisions),target=location(dataDir);let madeDirectory=false,claimed=false,db=null,began=false;
  if(fs.existsSync(target.directory)){if(!fs.statSync(target.directory).isDirectory()||fs.readdirSync(target.directory).length)fail('SQLITE_TARGET_NOT_EMPTY','SQLite можно создать только в новом или пустом отдельном каталоге');}
  else{fs.mkdirSync(target.directory);madeDirectory=true;}
  try{
    const claim=fs.openSync(target.file,'wx');fs.closeSync(claim);claimed=true;
    assertDatabaseFile(target);
    db=new DatabaseSync(target.file,{enableForeignKeyConstraints:true,allowExtension:false,enableDoubleQuotedStringLiterals:false,timeout:5000,defensive:true});configure(db,false);db.exec('BEGIN IMMEDIATE;');began=true;db.exec(ddl);db.exec(operationDDL);
    const meta=db.prepare('INSERT INTO metadata VALUES(?,?)');for(const [name,value]of Object.entries({format:FORMAT,format_version:String(VERSION),schema_version:String(SCHEMA_VERSION),compatibility:JSON.stringify(descriptor),database_uuid:identity.uuid,generation:String(identity.generation),created_at:new Date().toISOString(),operation_state:JSON.stringify(seed.operationState)}))meta.run(name,value);
    const insertObject=db.prepare('INSERT INTO operation_ledger_objects VALUES(?,?)');for(const object of seed.objects)insertObject.run(object.id,object.json);indexOperationObjects(db,seed.objects);
    const section=db.prepare('INSERT INTO sections(name,revision) VALUES(?,?)');for(const name of schema.sections)section.run(name,revisions[name]);
    build(db,data,revisions,schema.sections);if(options.beforeCommit)resultSync(()=>options.beforeCommit());db.exec('COMMIT;');began=false;
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');db.close();db=null;writeGuard(target.directory);
    return inspect(target.directory);
  }catch(error){
    if(db){if(began)try{db.exec('ROLLBACK;');}catch{}try{db.close();}catch{}db=null;}
    if(claimed){for(const name of [FILE,FILE+'-wal',FILE+'-shm',path.join('sections','revisions.json')])try{fs.unlinkSync(path.join(target.directory,name));}catch{}try{fs.rmdirSync(path.join(target.directory,'sections'));}catch{}}
    if(madeDirectory)try{fs.rmdirSync(target.directory);}catch{}throw error;
  }
}
function inspect(dataDir){return transaction(dataDir,()=>{
  const db=connection(dataDir),sections=db.prepare('SELECT s.name,s.revision,count(r.row_key) AS count FROM sections s LEFT JOIN section_rows r ON r.section=s.name GROUP BY s.name ORDER BY s.name').all().map(row=>({...row}));
  const integrityCheck=db.prepare('PRAGMA integrity_check').all().map(row=>Object.values(row)[0]),foreignKeyErrors=db.prepare('PRAGMA foreign_key_check').all().map(row=>({...row}));
  return {ok:integrityCheck.length===1&&integrityCheck[0]==='ok'&&!foreignKeyErrors.length,format:FORMAT,formatVersion:VERSION,schemaVersion:validateFormat(db),descriptor:storageFormat.describe(validateFormat(db)),sqliteVersion:db.prepare('SELECT sqlite_version() AS version').get().version,
    sections,rowCount:sections.reduce((total,row)=>total+row.count,0),linkCount:db.prepare('SELECT count(*) AS count FROM row_links').get().count,
    legacyIssues:db.prepare('SELECT issue_json FROM reference_issues ORDER BY id').all().map(row=>JSON.parse(row.issue_json)),integrity:integrityCheck,foreignKeyErrors};
},{readOnly:true});}
module.exports={inTransaction:dataDir=>held.has(location(dataDir).key),exists,filename,readAll,readRows,queryRows,countLegacyAssetReferences,readRevisions,readIdentity,schemaVersion,readDescriptor,readOperationState,readOperationObject,readOperationText,putOperationObjects,writeOperationState,commitSections,create,inspect,transaction};
