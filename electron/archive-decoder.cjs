'use strict';
const path=require('node:path'),{fork}=require('node:child_process'),crypto=require('node:crypto');
const DEFAULT_LIMITS=Object.freeze({entryBytes:25*1024*1024,entries:1000,extractedBytes:100*1024*1024});
const EXEC_ARGS=Object.freeze(['--max-old-space-size=256','--max-semi-space-size=16','--wasm-max-mem-pages=8192','--wasm-max-table-size=100000','--wasm-max-code-space-size-mb=64']);
const MAX_INPUT_BYTES=25*1024*1024;
const failure=(code,message)=>Object.assign(Error(message),{code});
const crcTable=Uint32Array.from({length:256},(_,value)=>{for(let bit=0;bit<8;bit++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0;});
function crc32(bytes){let value=0xffffffff;for(const byte of bytes)value=crcTable[(value^byte)&255]^(value>>>8);return (value^0xffffffff)>>>0;}
function normalizeLimits(value={}){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!Object.hasOwn(DEFAULT_LIMITS,key)))throw failure('ARCHIVE_LIMIT','Некорректные пределы архива');const result={};for(const [key,ceiling]of Object.entries(DEFAULT_LIMITS)){const limit=value[key]??ceiling;if(!Number.isSafeInteger(limit)||limit<0||limit>ceiling)throw failure('ARCHIVE_LIMIT','Некорректные пределы архива');result[key]=limit;}return result;}
function validateEntries(entries,limits){
 if(!Array.isArray(entries)||entries.length>limits.entries)throw failure('ARCHIVE_LIMIT','Архив превышает допустимые пределы');let total=0;const names=new Set();
 return entries.map(entry=>{if(!entry||typeof entry!=='object'||typeof entry.name!=='string'||!entry.name||entry.name.length>1024||entry.name.includes('\0')||typeof entry.isDirectory!=='boolean'||!Buffer.isBuffer(entry.bytes))throw failure('ARCHIVE_DECODE','Неверный результат распаковки архива');
  const name=entry.name.replace(/\\/g,'/'),parts=(entry.isDirectory?name.replace(/\/$/,''):name).split('/');if(name.startsWith('/')||/^[a-z]:/i.test(name)||parts.some(part=>!part||part==='.'||part==='..'||part.includes(':'))||names.has(name))throw failure('ARCHIVE_PATH','Недопустимые имена внутри архива');names.add(name);
  if(entry.bytes.length>limits.entryBytes||(total+=entry.bytes.length)>limits.extractedBytes||entry.isDirectory&&entry.bytes.length!==0)throw failure('ARCHIVE_LIMIT','Архив превышает допустимые пределы');
  if(!entry.isDirectory&&(!Number.isInteger(entry.crc)||entry.crc<0||entry.crc>0xffffffff||crc32(entry.bytes)!==entry.crc))throw failure('ARCHIVE_CRC','Не совпала контрольная сумма файла архива');
  return {name,isDirectory:entry.isDirectory,bytes:entry.bytes,...(!entry.isDirectory?{crc:entry.crc}:{})};
 });
}
function createArchiveDecoder({forkProcess=fork,timeoutMs=30000,workerPath=path.join(__dirname,'archive-decoder-worker.cjs')}={}){
 if(typeof forkProcess!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw new TypeError('Некорректный процесс распаковки');let active=0;
 return async function extractRAR(input,{limits:requestedLimits,assertCurrent=()=>{},signal}={}){
  const limits=normalizeLimits(requestedLimits);if(!(input instanceof Uint8Array)||!input.byteLength||input.byteLength>MAX_INPUT_BYTES)throw failure('ARCHIVE_LIMIT','Исходный архив должен быть не больше 25 МБ');if(typeof assertCurrent!=='function')throw new TypeError('Нужна проверка текущего контекста');
  const guard=()=>{if(signal?.aborted)throw failure('ARCHIVE_ABORTED','Распаковка архива отменена');if(assertCurrent()?.then)throw new TypeError('Проверка контекста распаковки должна быть синхронной');};guard();if(active>=2)throw failure('ARCHIVE_BUSY','Дождитесь завершения распаковки другого архива');active++;
  try{return await new Promise((resolve,reject)=>{let child,done=false,timer,interval;const id=crypto.randomUUID();
   const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);clearInterval(interval);signal?.removeEventListener('abort',abort);if(child){try{child.kill('SIGKILL');}catch{}}error?reject(error):resolve(value);};
   const abort=()=>finish(failure('ARCHIVE_ABORTED','Распаковка архива отменена'));
   try{const env={ELECTRON_RUN_AS_NODE:'1'};for(const key of ['SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP'])if(process.env[key])env[key]=process.env[key];
    guard();child=forkProcess(workerPath,[],{execPath:process.execPath,execArgv:[...EXEC_ARGS],env,windowsHide:true,serialization:'advanced',stdio:['ignore','ignore','ignore','ipc']});
    child.on('error',()=>finish(failure('ARCHIVE_DECODE','Не удалось запустить безопасную распаковку')));child.on('exit',()=>{if(!done)finish(failure('ARCHIVE_DECODE','Распаковка архива завершилась без результата'));});
    child.on('message',message=>{if(done)return;try{guard();if(!message||message.id!==id||typeof message.ok!=='boolean')throw failure('ARCHIVE_DECODE','Неверный ответ процесса распаковки');if(!message.ok)throw failure(/^ARCHIVE_[A-Z0-9_]{1,40}$/.test(message.code||'')?message.code:'ARCHIVE_DECODE','Не удалось безопасно распаковать RAR-архив');const entries=validateEntries(message.entries,limits);guard();finish(null,entries);}catch(error){finish(error);}});
    timer=setTimeout(()=>finish(failure('ARCHIVE_TIMEOUT','Распаковка архива превысила 30 секунд')),timeoutMs);interval=setInterval(()=>{try{guard();}catch(error){finish(error);}},100);signal?.addEventListener('abort',abort,{once:true});guard();
    child.send({kind:'decode',id,bytes:Buffer.from(input),limits},error=>{if(error)finish(failure('ARCHIVE_DECODE','Не удалось передать исходник в процесс распаковки'));});
   }catch(error){finish(error);}
  });}finally{active--;}
 };
}
module.exports=Object.freeze({extractRAR:createArchiveDecoder(),createArchiveDecoder,DEFAULT_LIMITS,EXEC_ARGS});
