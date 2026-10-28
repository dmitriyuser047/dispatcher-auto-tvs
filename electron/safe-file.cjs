'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const CHUNK_BYTES=64*1024;
const fail=(code,message)=>Object.assign(new Error(message),{code});
const samePath=(a,b)=>process.platform==='win32'?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase():path.resolve(a)===path.resolve(b);
function createSafeFileReader(io=fs){
 const full=value=>{if(typeof value!=='string'||!value||value.includes('\0')||!path.isAbsolute(value))throw fail('SAFE_FILE_INVALID','Нужен абсолютный путь к обычному файлу');return path.resolve(value);};
 const identity=stat=>[stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs];
 const unchanged=(a,b)=>identity(a).every((value,index)=>value===identity(b)[index]);
 const regular=(stat,limit,min,allowHardLinks=false)=>{if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink<1||!allowHardLinks&&stat.nlink!==1)throw fail('SAFE_FILE_INVALID','Нужен обычный файл без ссылок');if(!Number.isSafeInteger(stat.size)||stat.size<min||stat.size>limit)throw fail('SAFE_FILE_TOO_LARGE','Файл пуст или превышает допустимый размер');};
 const limits=options=>{const max=options?.maxBytes,min=options?.minBytes??0;if(!Number.isSafeInteger(max)||max<1||!Number.isSafeInteger(min)||min<0||min>max)throw new TypeError('Некорректный предел чтения файла');return {max,min,allowHardLinks:options?.allowHardLinks===true,guard:typeof options?.assertCurrent==='function'?options.assertCurrent:()=>{}};};
 const canonical=value=>{const resolved=full(value),real=typeof io.realpathSync.native==='function'?io.realpathSync.native(resolved):io.realpathSync(resolved);if(!samePath(real,resolved))throw fail('SAFE_FILE_INVALID','Путь содержит файловую ссылку');return resolved;};
 function verifiedDirectory(value,{create=false}={}){
  const resolved=full(value),parts=[];let current=resolved;
  while(true){parts.unshift(current);const parent=path.dirname(current);if(parent===current)break;current=parent;}
  for(let index=0;index<parts.length;index++){
   const item=parts[index];let stat;
   try{stat=io.lstatSync(item);}catch(error){if(error.code!=='ENOENT'||!create||index!==parts.length-1)throw error;io.mkdirSync(item,{mode:0o700});stat=io.lstatSync(item);}
   if(!stat.isDirectory()||stat.isSymbolicLink())throw fail('SAFE_FILE_INVALID','Каталог содержит файловую ссылку');
  }
  // Every ancestor is still inspected above. Resolve the complete path once:
  // resolving each ancestor separately repeats the same walk quadratically.
  canonical(resolved);const stat=io.lstatSync(resolved);if(!stat.isDirectory()||stat.isSymbolicLink())throw fail('SAFE_FILE_INVALID','Каталог содержит файловую ссылку');return {path:resolved,dev:stat.dev,ino:stat.ino};
 }
 function assertDirectory(directory){const resolved=canonical(directory.path),stat=io.lstatSync(resolved);if(!stat.isDirectory()||stat.isSymbolicLink())throw fail('SAFE_FILE_INVALID','Каталог содержит файловую ссылку');if(stat.dev!==directory.dev||stat.ino!==directory.ino)throw fail('SAFE_FILE_CHANGED','Каталог изменился во время операции');return {path:resolved,dev:stat.dev,ino:stat.ino};}
 const prepare=(value,max,min,allowHardLinks)=>{const filePath=full(value),directory=verifiedDirectory(path.dirname(filePath));canonical(filePath);const before=io.lstatSync(filePath);regular(before,max,min,allowHardLinks);return {filePath,directory,before,allowHardLinks};};
 const check=(prepared,stat,max,min)=>{regular(stat,max,min,prepared.allowHardLinks);if(!unchanged(prepared.before,stat)||prepared.before.nlink!==stat.nlink)throw fail('SAFE_FILE_CHANGED','Файл изменился во время чтения');};
 const finish=(prepared,stat,count,max,min)=>{check(prepared,stat,max,min);assertDirectory(prepared.directory);canonical(prepared.filePath);check(prepared,io.lstatSync(prepared.filePath),max,min);if(count!==prepared.before.size)throw fail('SAFE_FILE_CHANGED','Файл изменился во время чтения');};
 const flags=()=>io.constants.O_RDONLY|(io.constants.O_NOFOLLOW||0);
 function readRegularFileSync(value,options){
  const {max,min,guard,allowHardLinks}=limits(options);guard();const prepared=prepare(value,max,min,allowHardLinks);let fd;
  try{fd=io.openSync(prepared.filePath,flags());check(prepared,io.fstatSync(fd),max,min);guard();const chunks=[];let count=0;
   while(true){guard();const chunk=Buffer.allocUnsafe(Math.min(CHUNK_BYTES,max-count+1));const size=io.readSync(fd,chunk,0,chunk.length,null);if(size===0)break;count+=size;if(count>max)throw fail('SAFE_FILE_TOO_LARGE','Файл превышает допустимый размер');chunks.push(chunk.subarray(0,size));}
   finish(prepared,io.fstatSync(fd),count,max,min);guard();return Buffer.concat(chunks,count);
  }finally{if(fd!==undefined)io.closeSync(fd);}
 }
 async function readRegularFile(value,options){
  const {max,min,guard,allowHardLinks}=limits(options);guard();const prepared=prepare(value,max,min,allowHardLinks);let handle;
  try{handle=await io.promises.open(prepared.filePath,flags());guard();check(prepared,await handle.stat(),max,min);const chunks=[];let count=0;
   while(true){guard();const chunk=Buffer.allocUnsafe(Math.min(CHUNK_BYTES,max-count+1));const {bytesRead}=await handle.read(chunk,0,chunk.length,null);guard();if(bytesRead===0)break;count+=bytesRead;if(count>max)throw fail('SAFE_FILE_TOO_LARGE','Файл превышает допустимый размер');chunks.push(chunk.subarray(0,bytesRead));}
   finish(prepared,await handle.stat(),count,max,min);guard();return Buffer.concat(chunks,count);
  }finally{if(handle)await handle.close();}
 }
 async function writeRegularFileAtomic(value,bytes,options){
  const {max,guard}=limits(options);if(!Buffer.isBuffer(bytes)||bytes.length>max)throw fail('SAFE_FILE_TOO_LARGE','Файл превышает допустимый размер');guard();const filePath=full(value),directory=verifiedDirectory(path.dirname(filePath));let previous=null;
  try{previous=io.lstatSync(filePath);regular(previous,max,0);canonical(filePath);}catch(error){if(error.code!=='ENOENT')throw error;}
  const temp=path.join(directory.path,'.'+path.basename(filePath)+'.'+crypto.randomBytes(12).toString('hex')+'.tmp');let handle,owned;
  try{guard();assertDirectory(directory);handle=await io.promises.open(temp,io.constants.O_WRONLY|io.constants.O_CREAT|io.constants.O_EXCL|(io.constants.O_NOFOLLOW||0),0o600);owned=await handle.stat();regular(owned,max,0);guard();assertDirectory(directory);await handle.writeFile(bytes);guard();await handle.sync();guard();await handle.close();handle=null;assertDirectory(directory);
   let current=null;try{current=io.lstatSync(filePath);regular(current,max,0);}catch(error){if(error.code!=='ENOENT')throw error;}
   if(!!current!==!!previous||current&&!unchanged(current,previous))throw fail('SAFE_FILE_CHANGED','Файл назначения изменился во время сохранения');guard();await io.promises.rename(temp,filePath);guard();assertDirectory(directory);return filePath;
  }finally{if(handle)await handle.close().catch(()=>{});try{assertDirectory(directory);const stat=io.lstatSync(temp);if(owned&&stat.dev===owned.dev&&stat.ino===owned.ino&&!stat.isSymbolicLink()&&stat.nlink===1)await io.promises.unlink(temp);}catch(error){if(error.code!=='ENOENT'){} }}
 }
 return {readRegularFileSync,readRegularFile,verifiedDirectory,assertDirectory,writeRegularFileAtomic};
}
module.exports={createSafeFileReader,...createSafeFileReader()};
