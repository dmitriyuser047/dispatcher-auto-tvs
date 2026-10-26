'use strict';
// Originals are durable documents even when their contents are not an inventory.
// A final immutable batch publishes complete uploads; blobs alone are invisible.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{pathToFileURL}=require('node:url');
const storage=require('./storage'),safe=require('./safe-file.cjs'),access=require('./access-control'),policy=require('./access-context.cjs');
const SECTIONS=['inventoryOrgs','inventoryObjects','inventoryMols','inventoryItems','inventorySessions'];
const DIRECTORY='inventory-documents',LIMIT=25*1024*1024,EXPANDED_LIMIT=100*1024*1024,MAX_FILES=10000,MAX_JSON=2*1024*1024;
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const stable=value=>require('../assets/core/platform-kernel.js').stableSerialize(value);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const blobName=sha=>'blob-'+sha+'.bin',documentName=id=>'doc-'+id+'.json';
function fail(code,message,status=400){throw Object.assign(Error(message),{code,status});}
function exact(value,keys){if(!plain(value)||Object.keys(value).some(key=>!keys.includes(key)))fail('INVENTORY_DOCUMENT_REQUEST','Некорректные параметры файла инвентаризации');return value;}
function text(value,max=2000){return typeof value==='string'&&value.length>0&&value.length<=max&&!/[\x00-\x1f]/.test(value);}
function logicalPath(value){if(!text(value,4000)||value.includes('\\')||value.startsWith('/')||/^[a-z]:/i.test(value)||value.split('/').some(part=>!part||part==='.'||part==='..'))fail('INVENTORY_DOCUMENT_PATH','Недопустимое имя файла или путь в архиве');return value;}
function inputName(value){if(!text(value,240)||value.includes('/')||value.includes('\\')||value==='.'||value==='..')fail('INVENTORY_DOCUMENT_NAME','Нужно имя выбранного файла без пути');return value;}
function authorize(value,write=false){
 const user=policy.normalizePrincipal(value);
 if(!user||!['admin','accountant','viewer'].includes(user.role)||write&&!['admin','accountant'].includes(user.role)||policy.hasNarrowing(user)||SECTIONS.some(name=>!access.authorize(user,'read',name)||write&&!access.authorize(user,'write',name)))
  fail('ACCESS_DENIED','Общие исходные файлы инвентаризации доступны только при полном доступе к инвентаризации.',403);
 return user;
}
function guard(dir,payload,value,options={},write=false){
 const user=authorize(value,write),stamp=stable([user.id,user.role,user.policyStamp]);
 const current=()=>{options.assertCurrent?.();const active=authorize(options.getPrincipal?options.getPrincipal():user,write);if(stable([active.id,active.role,active.policyStamp])!==stamp)fail('ACCESS_DENIED','Права изменились во время загрузки файлов.',403);if(payload.databaseToken!==storage.databaseToken(dir))fail('DATABASE_CHANGED','База инвентаризации изменилась. Откройте раздел заново.',409);return active;};
 current();return current;
}
function directory(dir,create=false){const parent=safe.verifiedDirectory(path.resolve(dir));safe.assertDirectory(parent);const full=path.join(parent.path,DIRECTORY);if(!create&&!fs.existsSync(full))return null;return safe.verifiedDirectory(full,{create});}
function documentKind(name){const ext=path.extname(name).toLowerCase(),lower=name.toLocaleLowerCase('ru-RU');if(['.rar','.zip'].includes(ext))return 'archive';if(/приказ|инв[-_ ]?22/.test(lower))return 'order';if(/акт|списани|установк/.test(lower))return 'act';if(ext==='.json'||/сличител|инвентар|опись|ведомость|остатк|оборот|\bосв\b/.test(lower))return 'inventory';return 'other';}
function validateFiles(entries,read){
 const names=entries.map(entry=>typeof entry==='string'?entry:entry.name).filter(name=>typeof name==='string'&&name.startsWith(DIRECTORY+'/'));
 if(names.length>MAX_FILES||new Set(names).size!==names.length)fail('INVENTORY_DOCUMENT_LIMIT','Слишком много исходных файлов инвентаризации.');
 const documents=new Map(),batches=[],blobs=new Map();
 for(const name of names){
  const filename=name.slice(DIRECTORY.length+1),match=/^(blob|doc|batch)-([a-f0-9]{64})\.(bin|json)$/.exec(filename);
  if(!match||match[1]==='blob'&&match[3]!=='bin'||match[1]!=='blob'&&match[3]!=='json')fail('INVENTORY_DOCUMENT_CORRUPT','В папке исходников обнаружен неизвестный файл.');
  const bytes=read(name);if(!Buffer.isBuffer(bytes)||bytes.length>(match[1]==='blob'?LIMIT:MAX_JSON)||hash(bytes)!==match[2])fail('INVENTORY_DOCUMENT_CORRUPT','Контрольная сумма сохранённого файла не совпала.');
  if(match[1]==='blob'){blobs.set(match[2],bytes.length);continue;}
  let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{fail('INVENTORY_DOCUMENT_CORRUPT','Повреждён список исходных файлов.');}
  if(match[1]==='doc'){
   exact(value,['version','kind','name','path','container','extension','bytes','sha256','documentKind']);
   if(value.version!==1||value.kind!=='inventory-document'||!text(value.name,240)||typeof value.extension!=='string'||value.extension.length>240||!Number.isSafeInteger(value.bytes)||value.bytes<0||value.bytes>LIMIT||!/^[a-f0-9]{64}$/.test(value.sha256||'')||!['inventory','order','act','archive','other'].includes(value.documentKind)||value.container!==undefined&&!text(value.container,4000))fail('INVENTORY_DOCUMENT_CORRUPT','Повреждены сведения об исходном файле.');
   logicalPath(value.path);if(path.posix.basename(value.path)!==value.name||path.extname(value.name).toLowerCase()!==value.extension)fail('INVENTORY_DOCUMENT_CORRUPT','Имя исходного файла не совпало с описанием.');
   documents.set(match[2],value);
  }else{
   exact(value,['version','kind','operationId','requestFingerprint','addedAt','actor','documents']);
   if(value.version!==1||value.kind!=='inventory-document-upload'||!text(value.operationId,200)||!/^[a-f0-9]{64}$/.test(value.requestFingerprint||'')||typeof value.addedAt!=='string'||!/^\d{4}-\d\d-\d\dT/.test(value.addedAt)||!Number.isFinite(Date.parse(value.addedAt))||!plain(value.actor)||!text(value.actor.id,200)||!['admin','accountant'].includes(value.actor.role)||!Array.isArray(value.documents)||!value.documents.length||value.documents.length>1000||new Set(value.documents).size!==value.documents.length||value.documents.some(id=>typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id)))fail('INVENTORY_DOCUMENT_CORRUPT','Повреждено подтверждение загрузки исходников.');
   batches.push(value);
  }
 }
 for(const document of documents.values())if(blobs.get(document.sha256)!==document.bytes)fail('INVENTORY_DOCUMENT_CORRUPT','Оригинал документа отсутствует или повреждён.');
 const visible=new Map(),operations=new Map();
 for(const batch of batches.sort((a,b)=>a.addedAt.localeCompare(b.addedAt))){
  const operationKey=stable([batch.actor.id,batch.operationId]);if(operations.has(operationKey)&&stable(operations.get(operationKey))!==stable(batch))fail('INVENTORY_DOCUMENT_CORRUPT','Подтверждения загрузки противоречат друг другу.');operations.set(operationKey,batch);
  for(const id of batch.documents){const value=documents.get(id);if(!value)fail('INVENTORY_DOCUMENT_CORRUPT','В подтверждении не найден исходный файл.');if(!visible.has(id))visible.set(id,{id,name:value.name,path:value.path,...(value.container?{container:value.container}:{}),extension:value.extension,bytes:value.bytes,sha256:value.sha256,kind:value.documentKind,addedAt:batch.addedAt});}
 }
 return {documents:visible,operations};
}
function state(dir){const folder=directory(dir);if(!folder)return {documents:new Map(),operations:new Map()};const names=fs.readdirSync(folder.path).sort().map(name=>DIRECTORY+'/'+name);const result=validateFiles(names,name=>safe.readRegularFileSync(path.join(dir,...name.split('/')),{maxBytes:name.endsWith('.bin')?LIMIT:MAX_JSON}));safe.assertDirectory(folder);return result;}
function list(dir,payload,value,options={}){exact(payload,['databaseToken']);const current=guard(dir,payload,value,options);return storage.withDatabaseLock(dir,()=>{current();const result=state(dir);current();return {ok:true,databaseToken:payload.databaseToken,documents:[...result.documents.values()].sort((a,b)=>b.addedAt.localeCompare(a.addedAt)||a.path.localeCompare(b.path,'ru'))};});}
function read(dir,payload,value,options={}){exact(payload,['databaseToken','id']);const current=guard(dir,payload,value,options);if(typeof payload.id!=='string'||!/^[a-f0-9]{64}$/.test(payload.id))fail('INVENTORY_DOCUMENT_ID','Выберите сохранённый файл.');return storage.withDatabaseLock(dir,()=>{current();const document=state(dir).documents.get(payload.id);if(!document)fail('INVENTORY_DOCUMENT_NOT_FOUND','Файл не найден в базе инвентаризации.',404);const bytes=safe.readRegularFileSync(path.join(directory(dir).path,blobName(document.sha256)),{maxBytes:LIMIT,assertCurrent:current});if(bytes.length!==document.bytes||hash(bytes)!==document.sha256)fail('INVENTORY_DOCUMENT_CORRUPT','Контрольная сумма оригинала не совпала.');return {ok:true,databaseToken:payload.databaseToken,name:document.name,base64:bytes.toString('base64'),sha256:document.sha256,bytes:bytes.length};});}
function decodeFile(file){exact(file,['name','base64']);const name=inputName(file.name),base64=file.base64;if(typeof base64!=='string'||base64.length>Math.ceil(LIMIT/3)*4||base64.length%4!==0||/[^A-Za-z0-9+/=]/.test(base64))fail('INVENTORY_DOCUMENT_BYTES','Неверное кодирование исходного файла.');const padding=base64.indexOf('=');if(padding>=0&&(base64.length-padding>2||!/^(?:=|==)$/.test(base64.slice(padding))))fail('INVENTORY_DOCUMENT_BYTES','Неверное кодирование исходного файла.');const bytes=Buffer.from(base64,'base64');if(bytes.length>LIMIT||bytes.toString('base64')!==base64)fail('INVENTORY_DOCUMENT_BYTES','Файл превышает 25 МБ или повреждён.');return {name,bytes};}
async function prepare(files,current){
 const tools=await import(pathToFileURL(path.join(__dirname,'../ReestrBuilder/archive-budget.mjs')).href),budget=tools.createArchiveBudget({inputBytes:LIMIT,entries:1000,entryBytes:LIMIT,extractedBytes:EXPANDED_LIMIT,depth:4}),temp=tools.createOwnedTemp('reestr-inventory-'),result=new Map();
 function add(name,bytes,container){logicalPath(name);const descriptor={version:1,kind:'inventory-document',name:path.posix.basename(name),path:name,...(container?{container}:{}),extension:path.posix.extname(name).toLowerCase(),bytes:bytes.length,sha256:hash(bytes),documentKind:documentKind(name)},manifest=Buffer.from(stable(descriptor)),id=hash(manifest);if(!result.has(id))result.set(id,{id,descriptor,manifest,bytes});}
 async function expand(bytes,name,depth){budget.depth(depth);const folder=fs.mkdtempSync(path.join(temp.directory,'archive-'));current();const entries=bytes.subarray(0,4).equals(Buffer.from('Rar!'))?await tools.extractRarBounded(bytes,folder,budget):tools.extractZipBounded(bytes,folder,budget);current();for(const entry of entries){if(entry.directory)continue;const body=safe.readRegularFileSync(entry.path,{maxBytes:LIMIT,assertCurrent:current}),logical=name+'/'+entry.name;add(logical,body,name);if(/\.(rar|zip)$/i.test(entry.name))await expand(body,logical,depth+1);}}
 try{for(const file of files){current();budget.input(file.bytes.length);add(file.name,file.bytes);if(/\.(rar|zip)$/i.test(file.name))await expand(file.bytes,file.name,0);}current();return [...result.values()];}finally{tools.removeOwnedTemp(temp);}
}
function put(directoryPin,stage,name,bytes){
 safe.assertDirectory(directoryPin);const target=path.join(directoryPin.path,name);if(fs.existsSync(target)){if(!safe.readRegularFileSync(target,{maxBytes:name.endsWith('.bin')?LIMIT:MAX_JSON}).equals(bytes))fail('INVENTORY_DOCUMENT_CORRUPT','Существующий сохранённый файл повреждён.');return;}
 const temporary=path.join(stage,crypto.randomUUID()),fd=fs.openSync(temporary,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 safe.assertDirectory(directoryPin);try{fs.linkSync(temporary,target);}catch(error){if(error.code!=='EEXIST')throw error;if(!safe.readRegularFileSync(target,{maxBytes:name.endsWith('.bin')?LIMIT:MAX_JSON}).equals(bytes))fail('INVENTORY_DOCUMENT_CORRUPT','Сохранённый файл изменился во время загрузки.');}finally{fs.unlinkSync(temporary);}
}
async function upload(dir,payload,value,options={}){
 exact(payload,['databaseToken','files','operationId']);const current=guard(dir,payload,value,options,true);if(typeof payload.operationId!=='string'||!/^[a-zA-Z0-9._:-]{1,200}$/.test(payload.operationId)||!Array.isArray(payload.files)||!payload.files.length||payload.files.length>100)fail('INVENTORY_DOCUMENT_REQUEST','Выберите от 1 до 100 файлов и подтвердите операцию.');if(payload.files.reduce((total,file)=>total+(typeof file?.base64==='string'?file.base64.length:0),0)>Math.ceil(LIMIT/3)*4+payload.files.length*4)fail('INVENTORY_DOCUMENT_LIMIT','Общий размер выбранных файлов превышает 25 МБ.');const files=payload.files.map(decodeFile);if(files.reduce((total,file)=>total+file.bytes.length,0)>LIMIT)fail('INVENTORY_DOCUMENT_LIMIT','Общий размер выбранных файлов превышает 25 МБ.');const requestFingerprint=hash(stable(files.map(file=>({name:file.name,sha256:hash(file.bytes),bytes:file.bytes.length})))),prepared=await prepare(files,current);current();
 return storage.withDatabaseLock(dir,()=>{
  const user=current(),before=state(dir),previous=before.operations.get(stable([user.id,payload.operationId]));
  if(previous&&previous.requestFingerprint!==requestFingerprint)fail('INVENTORY_DOCUMENT_OPERATION','Эта операция уже относится к другим файлам.',409);
  const ids=prepared.map(item=>item.id),missing=ids.filter(id=>!before.documents.has(id));
  let backupWarning,published=false;
  if(!previous){
   const folder=directory(dir,true),parent=fs.realpathSync(dir),stage=fs.mkdtempSync(path.join(parent,'.inventory-document-stage-')),pin=fs.lstatSync(stage);
   try{const batch={version:1,kind:'inventory-document-upload',operationId:payload.operationId,requestFingerprint,addedAt:options.now||new Date().toISOString(),actor:{id:user.id,role:user.role},documents:ids},bytes=Buffer.from(stable(batch)),batchName='batch-'+hash(bytes)+'.json',names=new Set(fs.readdirSync(folder.path));for(const item of prepared){names.add(blobName(item.descriptor.sha256));names.add(documentName(item.id));}names.add(batchName);if(names.size>MAX_FILES)fail('INVENTORY_DOCUMENT_LIMIT','Слишком много сохранённых файлов инвентаризации.');for(const item of prepared){current();put(folder,stage,blobName(item.descriptor.sha256),item.bytes);put(folder,stage,documentName(item.id),item.manifest);}current();put(folder,stage,batchName,bytes);published=true;current();}
   catch(error){if(published){error.unknown=true;error.definitive=false;}throw error;}
   finally{if(fs.existsSync(stage)){const info=fs.lstatSync(stage);if(path.dirname(stage)!==parent||!path.basename(stage).startsWith('.inventory-document-stage-')||info.isSymbolicLink()||info.dev!==pin.dev||info.ino!==pin.ino)fail('INVENTORY_DOCUMENT_CLEANUP','Временная папка загрузки изменилась.');fs.rmSync(stage,{recursive:true,force:true});}}
   try{storage.makeDailyBackup(dir,path.join(dir,'backups'),30);}catch(error){backupWarning={code:'INVENTORY_DOCUMENT_BACKUP',message:'Файлы сохранены, но ежедневная резервная копия не создана: '+error.message};}
  }
  try{const after=state(dir);current();return {ok:true,databaseToken:payload.databaseToken,documents:[...after.documents.values()],uploaded:ids.map(id=>after.documents.get(id)),addedCount:previous?0:missing.length,reusedCount:previous?ids.length:ids.length-missing.length,operationId:payload.operationId,replayed:!!previous,...(backupWarning?{warnings:[backupWarning]}:{})};}
  catch(error){if(published){error.unknown=true;error.definitive=false;}throw error;}
 });
}
function validateManaged(entries,read){validateFiles(entries,read);return true;}
module.exports=Object.freeze({DIRECTORY,list,read,upload,validateManaged});
