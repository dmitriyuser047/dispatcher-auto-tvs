'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const storage=require('./storage'),safe=require('./safe-file.cjs'),access=require('./access-control');
function fail(code,message,status=400){throw Object.assign(Error(message),{code,status});}
// The authenticated import endpoint archives bytes only. Business rows still
// need the normal versioned, authorised section transaction and registry guard.
function archive(dir,payload,options,support){
 if(!payload||Object.keys(payload).some(key=>!['action','profile','databaseToken','source'].includes(key))||payload.profile!=='registry'||!payload.source||Object.keys(payload.source).some(key=>!['name','base64'].includes(key)))fail('IMPORT_FILE','Некорректный запрос оригинала реестра.');
 if(options.requireWriterSchema!==true||options.requireNegotiatedWriter!==true||typeof options.assertWriteCompatibility!=='function')fail('PROTOCOL_RENEGOTIATE','Подтвердите совместимость перед сохранением оригинала.',428);
 const original=support.bytesOf(payload.source);
 if(!/^.+\.(xlsx|xls|pdf)$/i.test(original.name)||original.name!==payload.source.name||original.name.length>240||/[<>:"/\\|?*\x00-\x1f]/.test(original.name)||/[. ]$/.test(original.name))fail('REGISTRY_FORMAT','Выберите Excel XLSX/XLS или PDF с корректным именем.');
 const actor=support.principal(options.getPrincipal?options.getPrincipal():options.principal);
 const current=()=>{
  const user=support.principal(options.getPrincipal?options.getPrincipal():options.principal);
  if(user.id!==actor.id||user.role!==actor.role||user.policyStamp!==actor.policyStamp)fail('ACCESS_CHANGED','База или права изменились во время сохранения оригинала.',403);
  support.checkBinding(dir,payload,user,{...options,principal:user},true);
  if(!access.authorize(user,'write','savedReestrs')||user.writable&&!user.writable.includes('*')&&!user.writable.includes('savedReestrs'))fail('ACCESS_DENIED','Нет права сохранять реестры.',403);
  return user;
 };
 current();
 return storage.withDatabaseLock(dir,()=>{
  current();const descriptor=support.descriptor(original);
  const destination=path.join(support.root(dir,false),descriptor.id);
  if(fs.existsSync(destination)){
   if(!safe.readRegularFileSync(destination,{maxBytes:25*1024*1024,minBytes:1,assertCurrent:current}).equals(original.bytes))fail('IMPORT_SOURCE_HASH','Сохранённый оригинал повреждён.');
   current();return {ok:true,...descriptor,databaseToken:payload.databaseToken};
  }
  if(typeof options.beforeCommit!=='function')fail('IMPORT_BACKUP_REQUIRED','Резервное копирование перед сохранением оригинала не настроено.',503);
  const preparation=options.beforeCommit();if(preparation&&typeof preparation.then==='function')fail('IMPORT_BACKUP_REQUIRED','Резервное копирование должно завершаться до сохранения оригинала.',503);
  current();const directory=safe.verifiedDirectory(support.root(dir,false),{create:true}),temp=path.join(directory.path,'.registry-'+crypto.randomUUID()+'.tmp');let created=false;
  try{
   safe.assertDirectory(directory);current();const fd=fs.openSync(temp,'wx',0o600);created=true;
   try{fs.writeFileSync(fd,original.bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
   safe.assertDirectory(directory);current();
   fs.renameSync(temp,destination);created=false;
   safe.assertDirectory(directory);current();return {ok:true,...descriptor,databaseToken:payload.databaseToken};
  }finally{if(created&&fs.existsSync(temp)){safe.assertDirectory(directory);fs.unlinkSync(temp);}}
 });
}
module.exports={archive};
