'use strict';

// Count evidence belongs to an exact saved inventory row. Images and immutable
// associations are stored separately from the draft/frozen count values.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const storage=require('./storage'),safe=require('./safe-file.cjs'),access=require('./access-control'),policy=require('./access-context.cjs');
const DIRECTORY='inventory-photos',LIMIT=25*1024*1024,MAX_JSON=2*1024*1024,MAX_FILES=10000,MAX_PIXELS=40*1000*1000;
const SECTIONS=['inventoryOrgs','inventoryObjects','inventoryMols','inventoryItems','inventorySessions'];
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const stable=value=>require('../assets/core/platform-kernel.js').stableSerialize(value);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=(value,max=240)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\x00-\x1f]/.test(value);
const identifier=value=>typeof value==='string'&&text(value,1000)||typeof value==='number'&&Number.isFinite(value);
const typedEqual=(left,right)=>typeof left===typeof right&&left===right;
function fail(code,message,status=400){throw Object.assign(Error(message),{code,status});}
function exact(value,keys){if(!plain(value)||Object.keys(value).some(name=>!keys.includes(name)))fail('INVENTORY_PHOTO_REQUEST','Некорректный запрос фотографии');return value;}
function name(value){if(!text(value)||value==='.'||value==='..'||/[\\/]/.test(value))fail('INVENTORY_PHOTO_NAME','Нужно имя выбранной фотографии без пути');return value;}
function authorize(value,write=false){
 const user=policy.normalizePrincipal(value);
 if(!['admin','accountant','viewer'].includes(user.role)||write&&!['admin','accountant'].includes(user.role)||policy.hasNarrowing(user)||SECTIONS.some(section=>!access.authorize(user,'read',section)||write&&!access.authorize(user,'write',section)))
  fail('ACCESS_DENIED','Фото описи доступны при полном доступе к инвентаризации.',403);
 return user;
}
function sessionRows(dir){return storage.readSection(dir,'inventorySessions').rows;}
function target(data,sessionId,rowId,write=false){
 if(!identifier(sessionId)||rowId!==undefined&&!identifier(rowId))fail('INVENTORY_PHOTO_BINDING','Нужны точные идентификаторы описи и позиции');
 const sessions=(data.inventorySessions||[]).filter(session=>typedEqual(session.id,sessionId));
 if(sessions.length!==1)fail('INVENTORY_PHOTO_SESSION','Опись для фотографии не найдена',404);
 const session=sessions[0];if(!Array.isArray(session.rows))fail('INVENTORY_PHOTO_SESSION','Строки описи повреждены');
 if(rowId!==undefined&&session.rows.filter(row=>typedEqual(row.id,rowId)).length!==1)fail('INVENTORY_PHOTO_ROW','Позиция для фотографии не найдена в этой описи',404);
 if(write&&session.status!=='draft')fail('INVENTORY_PHOTO_APPROVED','Фотографии добавляются в черновик подсчёта; утверждённая опись доступна для просмотра.',409);
 return session;
}
function guard(dir,payload,value,options={},write=false){
 const user=authorize(value,write),stamp=stable([user.id,user.role,user.policyStamp]);
 const current=()=>{
  options.assertCurrent?.();const active=authorize(options.getPrincipal?options.getPrincipal():user,write);
  if(stable([active.id,active.role,active.policyStamp])!==stamp)fail('ACCESS_DENIED','Права изменились во время работы с фотографией.',403);
  if(payload.databaseToken!==storage.databaseToken(dir))fail('DATABASE_CHANGED','База инвентаризации изменилась. Откройте подсчёт заново.',409);
  return active;
 };current.validateTarget=()=>target({inventorySessions:sessionRows(dir)},payload.sessionId,payload.rowId,write);current();current.validateTarget();return current;
}
function directory(dir,create=false){const parent=safe.verifiedDirectory(path.resolve(dir));safe.assertDirectory(parent);const full=path.join(parent.path,DIRECTORY);if(!create&&!fs.existsSync(full))return null;return safe.verifiedDirectory(full,{create});}
function dimensions(width,height,mimeType){if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<=0||height<=0||width>15000||height>15000||width*height>MAX_PIXELS)fail('INVENTORY_PHOTO_DIMENSIONS','Фото превышает 40 мегапикселей или имеет недопустимый размер. Уменьшите изображение.');return {mimeType,width,height};}
function imageInfo(bytes){
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>LIMIT)fail('INVENTORY_PHOTO_BYTES','Выберите непустую фотографию размером до 25 МБ.');
 if(bytes.length>=45&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){
  if(bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR'||bytes.readUInt32BE(bytes.length-12)!==0||bytes.toString('ascii',bytes.length-8,bytes.length-4)!=='IEND')fail('INVENTORY_PHOTO_IMAGE','PNG-фотография повреждена.');
  return dimensions(bytes.readUInt32BE(16),bytes.readUInt32BE(20),'image/png');
 }
 if(bytes.length>=14&&['GIF87a','GIF89a'].includes(bytes.toString('ascii',0,6))){
  if(bytes[bytes.length-1]!==0x3b)fail('INVENTORY_PHOTO_IMAGE','GIF-изображение повреждено.');return dimensions(bytes.readUInt16LE(6),bytes.readUInt16LE(8),'image/gif');
 }
 if(bytes.length>=30&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'){
  if(bytes.readUInt32LE(4)+8!==bytes.length)fail('INVENTORY_PHOTO_IMAGE','WebP-фотография повреждена.');const kind=bytes.toString('ascii',12,16);
  if(kind==='VP8X')return dimensions(bytes.readUIntLE(24,3)+1,bytes.readUIntLE(27,3)+1,'image/webp');
  if(kind==='VP8 '&&bytes.subarray(23,26).equals(Buffer.from([0x9d,0x01,0x2a])))return dimensions(bytes.readUInt16LE(26)&0x3fff,bytes.readUInt16LE(28)&0x3fff,'image/webp');
  if(kind==='VP8L'&&bytes[20]===0x2f){const value=bytes.readUInt32LE(21);return dimensions((value&0x3fff)+1,((value>>>14)&0x3fff)+1,'image/webp');}
  fail('INVENTORY_PHOTO_IMAGE','Не прочитан размер WebP-фотографии.');
 }
 if(bytes.length>=8&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff){
  if(bytes[bytes.length-2]!==0xff||bytes[bytes.length-1]!==0xd9)fail('INVENTORY_PHOTO_IMAGE','JPEG-фотография обрезана или повреждена.');
  let offset=2;while(offset<bytes.length-1){if(bytes[offset++]!==0xff)fail('INVENTORY_PHOTO_IMAGE','Структура JPEG-фотографии повреждена.');while(bytes[offset]===0xff)offset++;const marker=bytes[offset++];if(marker===0xd9||marker===0xda)break;if(marker===0x01||marker>=0xd0&&marker<=0xd7)continue;if(offset+2>bytes.length)break;const size=bytes.readUInt16BE(offset);if(size<2||offset+size>bytes.length)break;
   if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){if(size<8)break;return dimensions(bytes.readUInt16BE(offset+5),bytes.readUInt16BE(offset+3),'image/jpeg');}offset+=size;
  }fail('INVENTORY_PHOTO_IMAGE','Не прочитан размер JPEG-фотографии.');
 }
 fail('INVENTORY_PHOTO_FORMAT','Выберите фото JPEG, PNG, WebP или GIF. HEIC/HEIF предварительно сохраните как JPEG или PNG.');
}
function decode(file){exact(file,['name','base64']);const filename=name(file.name),encoded=file.base64;
 if(typeof encoded!=='string'||encoded.length>Math.ceil(LIMIT/3)*4||encoded.length%4!==0||/[^A-Za-z0-9+/=]/.test(encoded))fail('INVENTORY_PHOTO_BYTES','Не прочитаны байты фотографии.');
 const bytes=Buffer.from(encoded,'base64');if(bytes.toString('base64')!==encoded)fail('INVENTORY_PHOTO_BYTES','Неверное кодирование фотографии.');return {name:filename,bytes,...imageInfo(bytes)};
}
function validateFiles(data,entries,read){
 const names=entries.map(entry=>typeof entry==='string'?entry:entry.name).filter(name=>typeof name==='string'&&name.startsWith(DIRECTORY+'/'));
 if(names.length>MAX_FILES||new Set(names).size!==names.length)fail('INVENTORY_PHOTO_LIMIT','Слишком много сохранённых фотографий.');
 const photos=new Map(),blobs=new Map(),batches=[];
 for(const relative of names){const filename=relative.slice(DIRECTORY.length+1),match=/^(blob|photo|batch)-([a-f0-9]{64})\.(bin|json)$/.exec(filename);if(!match||match[1]==='blob'&&match[3]!=='bin'||match[1]!=='blob'&&match[3]!=='json')fail('INVENTORY_PHOTO_CORRUPT','Неизвестный файл в папке фотографий.');
  const bytes=read(relative);if(!Buffer.isBuffer(bytes)||bytes.length>(match[1]==='blob'?LIMIT:MAX_JSON)||hash(bytes)!==match[2])fail('INVENTORY_PHOTO_CORRUPT','Контрольная сумма фотографии не совпала.');
  if(match[1]==='blob'){blobs.set(match[2],{bytes:bytes.length,...imageInfo(bytes)});continue;}
  let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{fail('INVENTORY_PHOTO_CORRUPT','Повреждено описание фотографии.');}
  if(match[1]==='photo'){
   exact(value,['version','kind','sessionId','rowId','name','mimeType','bytes','sha256','width','height']);
   if(value.version!==1||value.kind!=='inventory-row-photo'||!identifier(value.sessionId)||!identifier(value.rowId)||!text(value.name)||value.name.includes('/')||value.name.includes('\\')||!['image/jpeg','image/png','image/webp','image/gif'].includes(value.mimeType)||!Number.isSafeInteger(value.bytes)||value.bytes<=0||value.bytes>LIMIT||!/^[a-f0-9]{64}$/.test(value.sha256||''))fail('INVENTORY_PHOTO_CORRUPT','Повреждена привязка фотографии.');
   dimensions(value.width,value.height,value.mimeType);target(data,value.sessionId,value.rowId);photos.set(match[2],value);
  }else{
   exact(value,['version','kind','sessionId','rowId','operationId','requestFingerprint','addedAt','actor','photos']);
   if(value.version!==1||value.kind!=='inventory-photo-upload'||!identifier(value.sessionId)||!identifier(value.rowId)||!text(value.operationId,200)||!/^[a-f0-9]{64}$/.test(value.requestFingerprint||'')||typeof value.addedAt!=='string'||!Number.isFinite(Date.parse(value.addedAt))||!plain(value.actor)||!text(value.actor.id,200)||!['admin','accountant'].includes(value.actor.role)||!Array.isArray(value.photos)||!value.photos.length||value.photos.length>20||new Set(value.photos).size!==value.photos.length||value.photos.some(id=>typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id)))fail('INVENTORY_PHOTO_CORRUPT','Повреждено подтверждение загрузки фото.');target(data,value.sessionId,value.rowId);batches.push(value);
  }
 }
 for(const photo of photos.values()){const blob=blobs.get(photo.sha256);if(!blob||blob.bytes!==photo.bytes||blob.mimeType!==photo.mimeType||blob.width!==photo.width||blob.height!==photo.height)fail('INVENTORY_PHOTO_CORRUPT','Оригинал фотографии отсутствует или не соответствует описанию.');}
 const visible=new Map(),operations=new Map();
 for(const batch of batches.sort((a,b)=>a.addedAt.localeCompare(b.addedAt))){const key=stable([batch.actor.id,batch.operationId]);if(operations.has(key)&&stable(operations.get(key))!==stable(batch))fail('INVENTORY_PHOTO_CORRUPT','Подтверждения загрузки фотографий противоречат друг другу.');operations.set(key,batch);
  for(const id of batch.photos){const photo=photos.get(id);if(!photo||!typedEqual(photo.sessionId,batch.sessionId)||!typedEqual(photo.rowId,batch.rowId))fail('INVENTORY_PHOTO_CORRUPT','Фотография относится к другой позиции описи.');if(!visible.has(id))visible.set(id,{id,sessionId:photo.sessionId,rowId:photo.rowId,name:photo.name,mimeType:photo.mimeType,bytes:photo.bytes,sha256:photo.sha256,width:photo.width,height:photo.height,addedAt:batch.addedAt});}
 }return {photos:visible,operations};
}
function state(dir){const folder=directory(dir);if(!folder)return {photos:new Map(),operations:new Map()};const entries=fs.readdirSync(folder.path).sort().map(name=>DIRECTORY+'/'+name),data={inventorySessions:sessionRows(dir)};const result=validateFiles(data,entries,name=>safe.readRegularFileSync(path.join(dir,...name.split('/')),{maxBytes:name.endsWith('.bin')?LIMIT:MAX_JSON}));safe.assertDirectory(folder);return result;}
function list(dir,payload,value,options={}){exact(payload,['databaseToken','sessionId']);const current=guard(dir,payload,value,options);return storage.withDatabaseLock(dir,()=>{current();current.validateTarget();const photos=[...state(dir).photos.values()].filter(photo=>typedEqual(photo.sessionId,payload.sessionId));current();return {ok:true,databaseToken:payload.databaseToken,photos};});}
function read(dir,payload,value,options={}){exact(payload,['databaseToken','sessionId','rowId','id']);const current=guard(dir,payload,value,options);if(typeof payload.id!=='string'||!/^[a-f0-9]{64}$/.test(payload.id))fail('INVENTORY_PHOTO_ID','Выберите фотографию позиции.');return storage.withDatabaseLock(dir,()=>{current();current.validateTarget();const photo=state(dir).photos.get(payload.id);if(!photo||!typedEqual(photo.sessionId,payload.sessionId)||!typedEqual(photo.rowId,payload.rowId))fail('INVENTORY_PHOTO_BINDING','Фотография не относится к этой позиции описи.',403);const bytes=safe.readRegularFileSync(path.join(directory(dir).path,'blob-'+photo.sha256+'.bin'),{maxBytes:LIMIT,assertCurrent:current});if(hash(bytes)!==photo.sha256)fail('INVENTORY_PHOTO_CORRUPT','Фотография повреждена.');current();return {ok:true,databaseToken:payload.databaseToken,id:photo.id,name:photo.name,mimeType:photo.mimeType,base64:bytes.toString('base64'),bytes:photo.bytes,sha256:photo.sha256};});}
function put(folder,stage,filename,bytes){safe.assertDirectory(folder);const target=path.join(folder.path,filename),maxBytes=filename.endsWith('.bin')?LIMIT:MAX_JSON;if(fs.existsSync(target)){if(!safe.readRegularFileSync(target,{maxBytes}).equals(bytes))fail('INVENTORY_PHOTO_CORRUPT','Сохранённая фотография изменена.');return;}const temporary=path.join(stage,crypto.randomUUID()),fd=fs.openSync(temporary,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}try{safe.assertDirectory(folder);fs.linkSync(temporary,target);}catch(error){if(error.code!=='EEXIST')throw error;if(!safe.readRegularFileSync(target,{maxBytes}).equals(bytes))fail('INVENTORY_PHOTO_CORRUPT','Сохранённая фотография изменилась во время записи.');}finally{fs.unlinkSync(temporary);}}
async function upload(dir,payload,value,options={}){
 exact(payload,['databaseToken','sessionId','rowId','files','operationId']);const current=guard(dir,payload,value,options,true);
 if(typeof payload.operationId!=='string'||!/^[a-zA-Z0-9._:-]{1,200}$/.test(payload.operationId)||!Array.isArray(payload.files)||!payload.files.length||payload.files.length>20||payload.files.reduce((total,file)=>total+(typeof file?.base64==='string'?file.base64.length:0),0)>Math.ceil(LIMIT/3)*4+payload.files.length*4)fail('INVENTORY_PHOTO_REQUEST','Выберите от 1 до 20 фотографий общим размером до 25 МБ.');
 const files=payload.files.map(decode);if(files.reduce((sum,file)=>sum+file.bytes.length,0)>LIMIT)fail('INVENTORY_PHOTO_LIMIT','Общий размер фотографий превышает 25 МБ.');
 const prepared=[];for(const file of files){current();try{const image=await require('@napi-rs/canvas').loadImage(file.bytes);dimensions(image.width,image.height,file.mimeType);}catch(error){if(error.code==='INVENTORY_PHOTO_DIMENSIONS')throw error;fail('INVENTORY_PHOTO_IMAGE','Фотография не прочитана. Выберите исправный JPEG, PNG, WebP или GIF.');}current();const descriptor={version:1,kind:'inventory-row-photo',sessionId:payload.sessionId,rowId:payload.rowId,name:file.name,mimeType:file.mimeType,bytes:file.bytes.length,sha256:hash(file.bytes),width:file.width,height:file.height},manifest=Buffer.from(stable(descriptor));prepared.push({descriptor,manifest,id:hash(manifest),bytes:file.bytes});}
 const distinct=[...new Map(prepared.map(file=>[file.id,file])).values()],requestFingerprint=hash(stable({sessionId:payload.sessionId,rowId:payload.rowId,files:prepared.map(file=>({name:file.descriptor.name,sha256:file.descriptor.sha256}))}));
 return storage.withDatabaseLock(dir,()=>{
  const user=current();current.validateTarget();const before=state(dir),previous=before.operations.get(stable([user.id,payload.operationId]));if(previous&&previous.requestFingerprint!==requestFingerprint)fail('INVENTORY_PHOTO_OPERATION','Операция уже относится к другой позиции или фотографии.',409);
  const ids=distinct.map(file=>file.id),missing=ids.filter(id=>!before.photos.has(id));let published=false,warning;
  if(!previous){const folder=directory(dir,true),parent=fs.realpathSync(dir),stage=fs.mkdtempSync(path.join(parent,'.inventory-photo-stage-')),pin=fs.lstatSync(stage);try{const batch={version:1,kind:'inventory-photo-upload',sessionId:payload.sessionId,rowId:payload.rowId,operationId:payload.operationId,requestFingerprint,addedAt:options.now||new Date().toISOString(),actor:{id:user.id,role:user.role},photos:ids},bytes=Buffer.from(stable(batch)),batchName='batch-'+hash(bytes)+'.json',names=new Set(fs.readdirSync(folder.path));for(const item of distinct){names.add('blob-'+item.descriptor.sha256+'.bin');names.add('photo-'+item.id+'.json');}names.add(batchName);if(names.size>MAX_FILES)fail('INVENTORY_PHOTO_LIMIT','Слишком много сохранённых фотографий.');for(const item of distinct){current();put(folder,stage,'blob-'+item.descriptor.sha256+'.bin',item.bytes);put(folder,stage,'photo-'+item.id+'.json',item.manifest);}current();put(folder,stage,batchName,bytes);published=true;current();}
   catch(error){if(published){error.unknown=true;error.definitive=false;}throw error;}finally{if(fs.existsSync(stage)){const info=fs.lstatSync(stage);if(path.dirname(stage)!==parent||!path.basename(stage).startsWith('.inventory-photo-stage-')||info.isSymbolicLink()||info.dev!==pin.dev||info.ino!==pin.ino)fail('INVENTORY_PHOTO_CLEANUP','Временная папка фотографии изменилась.');fs.rmSync(stage,{recursive:true,force:true});}}
   try{storage.makeDailyBackup(dir,path.join(dir,'backups'),30);}catch(error){warning={code:'INVENTORY_PHOTO_BACKUP',message:'Фото сохранены, но ежедневная резервная копия не создана: '+error.message};}
  }
  try{const after=state(dir);current();return {ok:true,databaseToken:payload.databaseToken,photos:[...after.photos.values()].filter(photo=>typedEqual(photo.sessionId,payload.sessionId)),uploaded:ids.map(id=>after.photos.get(id)),addedCount:previous?0:missing.length,reusedCount:previous?ids.length:ids.length-missing.length,operationId:payload.operationId,replayed:!!previous,...(warning?{warnings:[warning]}:{})};}catch(error){if(published){error.unknown=true;error.definitive=false;}throw error;}
 });
}
function validateManaged(data,entries,read){validateFiles(data,entries,read);return true;}
module.exports=Object.freeze({DIRECTORY,list,read,upload,validateManaged});
