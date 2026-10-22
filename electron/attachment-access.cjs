'use strict';
// An opaque file name is not an access grant. Tickets prove a backend upload
// for one typed origin; unchanged historical tickets survive a restored copy.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const KEY='.attachment-authority.key',LIMIT=25*1024*1024;
const stable=value=>require('../assets/core/platform-kernel.js').stableSerialize(value);
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const fingerprint=row=>'sha256:'+hash(stable(row));
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function fail(message){throw Object.assign(Error(message),{code:'ATTACHMENT_ACCESS',status:403});}
function regular(filename,limit=LIMIT){
 const info=fs.lstatSync(filename);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>limit)fail('Нужен обычный файл допустимого размера без ссылок');
 const fd=fs.openSync(filename,'r');try{const current=fs.fstatSync(fd);if(current.ino!==info.ino||current.dev!==info.dev)fail('Файл изменился во время открытия');const bytes=fs.readFileSync(fd),after=fs.fstatSync(fd);if(bytes.length>limit||after.size!==bytes.length||after.mtimeMs!==info.mtimeMs||after.ino!==info.ino||after.dev!==info.dev)fail('Файл изменился во время чтения');return bytes;}finally{fs.closeSync(fd);}
}
function folder(dir,create=false){const base=fs.realpathSync(path.resolve(dir)),target=path.join(base,'attachments');if(create&&!fs.existsSync(target))fs.mkdirSync(target);const info=fs.lstatSync(target);if(!info.isDirectory()||info.isSymbolicLink()||fs.realpathSync(target)!==target)fail('Недопустимая папка вложений');return target;}
function filePath(dir,id){if(typeof id!=='string'||!/^[a-f0-9]{64}\.[a-z0-9]{1,6}$/.test(id))fail('Неверная ссылка на вложение');return path.join(folder(dir),id);}
function writeExclusive(filename,bytes){const fd=fs.openSync(filename,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function key(dir,create=false){const target=path.join(folder(dir,create),KEY);if(create&&!fs.existsSync(target))writeExclusive(target,crypto.randomBytes(32));const bytes=regular(target,32);if(bytes.length!==32)fail('Повреждён ключ подтверждения вложений');return bytes;}
function origin(db,input,principal,action='read'){
 const sections=require('../assets/core/platform-schema.js').sections;
 if(!plain(input)||!sections.includes(input.section)||!require('../assets/core/platform-contracts.js').identifier(input.id))fail('Укажите запись, к которой относится вложение');
 const rows=(db[input.section]||[]).filter(row=>row.id===input.id);if(rows.length!==1)fail('Запись недоступна или неоднозначна');
 const ctx=require('./access-context.cjs').create(db,db,principal);if(!ctx.permits(input.section,'read',rows[0])||action!=='read'&&!ctx.permits(input.section,action,rows[0]))fail('Нет права на вложения этой записи');
 for(const field of action==='read'?['readFields']:['readFields','writeFields'])for(const list of [ctx.context[field]?.[input.section],ctx.policy?.sections?.[input.section]?.[field]])if(list&&!list.includes('*')&&!list.includes('attachments'))fail('Нет права на поле вложений этой записи');
 return rows[0];
}
function capture(dir,input,{principal}={}){const storage=require('./storage');return storage.withDatabaseLock(dir,()=>{storage.assertWritable(dir);const db=storage.readAll(dir),row=origin(db,input,principal,'update');return {section:input.section,id:input.id,databaseToken:storage.databaseToken(dir),previousFingerprint:fingerprint(row),policyStamp:require('./access-context.cjs').policyStamp(principal),originScopeSnapshot:require('../assets/core/access-scope.js').capture(db,input.section,row,{now:new Date().toISOString(),actor:require('./access-context.cjs').create(db,db,principal).actor})};});}
function body(file){const {proof,...metadata}=file;return {version:1,binding:proof.binding,file:metadata};}
function verify(file,readKey,section,id,token,previousFingerprint){
 if(!plain(file)||!plain(file.proof)||file.proof.version!==1||!plain(file.proof.binding)||typeof file.proof.signature!=='string'||!/^[a-f0-9]{64}$/.test(file.proof.signature))fail('Не подтверждено происхождение вложения');
 const binding=file.proof.binding;if(binding.section!==section||binding.id!==id||typeof binding.databaseToken!=='string'||token!==undefined&&binding.databaseToken!==token||previousFingerprint!==undefined&&binding.previousFingerprint!==previousFingerprint)fail('Подтверждение вложения относится к другой записи или версии');
 const expected=crypto.createHmac('sha256',readKey()).update(stable(body(file))).digest('hex');if(!crypto.timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(file.proof.signature,'hex')))fail('Подпись вложения не совпала');
 if(typeof file.id!=='string'||!/^[a-f0-9]{64}\.[a-z0-9]{1,6}$/.test(file.id)||file.sha256!==file.id.slice(0,64)||!Number.isSafeInteger(file.size)||file.size<0||file.size>LIMIT)fail('Повреждены сведения о вложении');return true;
}
function add(dir,captured,source,{principal}={}){
 const bytes=regular(source),ext=path.extname(source).toLowerCase(),sha256=hash(bytes),id=sha256+ext,storage=require('./storage');
 return storage.withDatabaseLock(dir,()=>{
  const current=capture(dir,captured,{principal});if(['section','id','databaseToken','previousFingerprint','policyStamp'].some(field=>stable(current[field])!==stable(captured[field])))fail('Запись, база или права изменились после выбора файла');
  const target=path.join(folder(dir,true),id);if(fs.existsSync(target)){if(!regular(target).equals(bytes))fail('Сохранённое вложение повреждено');}else writeExclusive(target,bytes);
  const file={id,name:path.basename(source),size:bytes.length,sha256,addedAt:new Date().toISOString()};
  const binding={databaseToken:captured.databaseToken,section:captured.section,id:captured.id,previousFingerprint:captured.previousFingerprint,originScopeSnapshot:captured.originScopeSnapshot};
  const signature=crypto.createHmac('sha256',key(dir,true)).update(stable({version:1,binding,file})).digest('hex');
  return {...file,proof:{version:1,binding,signature}};
 });
}
function inspect(dir,input,{principal}={}){const storage=require('./storage');return storage.withDatabaseLock(dir,()=>{
 const db=storage.readAll(dir),row=origin(db,input,principal),matches=(row.attachments||[]).filter(file=>file.id===input.fileId);if(matches.length!==1)fail('Вложение не найдено в доступной записи');const file=matches[0];
 if(file.proof){verify(file,()=>key(dir),input.section,input.id);const ctx=require('./access-context.cjs').create(db,db,principal),facts=ctx.resolveArchive({scopeSnapshot:file.proof.binding.originScopeSnapshot});if(!require('../assets/core/access-policy.js').permits(ctx.policy,input.section,'read',{}, {...ctx.context,resolve:()=>facts}))fail('Нет права на первоначальные данные вложения');}else if(require('./access-context.cjs').hasPolicy(principal))fail('Происхождение старого вложения требует подтверждения администратором');
 const target=filePath(dir,file.id),bytes=regular(target);if(hash(bytes)!==file.id.slice(0,64)||file.sha256&&file.sha256!==hash(bytes)||file.size!==undefined&&file.size!==bytes.length)fail('Контрольная сумма вложения не совпала');return {path:target,file};
 });}
function validateChanges(dir,previous,next,options={}){
 for(const section of require('../assets/core/platform-schema.js').sections){const oldRows=previous[section]||[];for(const row of next[section]||[]){
  if(!plain(row)||!own(row,'attachments'))continue;
  if(oldRows.some(old=>stable(old)===stable(row)))continue;
  if(!Array.isArray(row.attachments))fail('Вложения должны быть списком подтверждённых файлов');
  const matches=oldRows.filter(old=>old.id===row.id),old=matches.length===1?matches[0]:null,remaining=(old?.attachments||[]).map(stable);
  for(const file of row.attachments){const text=stable(file),index=remaining.indexOf(text);if(index>=0){remaining.splice(index,1);continue;}if(!dir||!old)fail('Для нового вложения нужна существующая запись и подтверждённый выбор файла');
   verify(file,()=>key(dir),section,row.id,options.databaseToken,fingerprint(old));const bytes=regular(filePath(dir,file.id));if(hash(bytes)!==file.sha256||bytes.length!==file.size)fail('Оригинал вложения отсутствует или повреждён');
  }
 }}return true;
}
function validateManaged(data,read){let authority;for(const section of require('../assets/core/platform-schema.js').sections)for(const row of data[section]||[])for(const file of row.attachments||[]){if(!file.proof)continue;verify(file,()=>{authority??=read('attachments/'+KEY);if(!Buffer.isBuffer(authority)||authority.length!==32)fail('В копии отсутствует ключ вложений');return authority;},section,row.id);const bytes=read('attachments/'+file.id);if(!Buffer.isBuffer(bytes)||hash(bytes)!==file.sha256||bytes.length!==file.size)fail('В копии отсутствует оригинал вложения');}return true;}
module.exports=Object.freeze({capture,add,inspect,validateChanges,validateManaged,regular,KEY});
