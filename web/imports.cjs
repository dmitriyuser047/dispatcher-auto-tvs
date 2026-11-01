'use strict';

// The browser supplies original bytes only. These adapters preserve the native
// picker result schemas; the reviewed import/source authority still owns every
// interpretation and every eventual business-data write.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Worker}=require('node:worker_threads');
const storage=require('../electron/storage'),access=require('../electron/access-context.cjs'),sources=require('../electron/import-source.cjs');
const MAX_FILE=25*1024*1024,MAX_IMAGE=16*1024*1024;
let registryActive=0;
const RAR_SECTIONS=['vehicles','records','generators','genRecords','toRecords','tanks','tankIncomes'];
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=(code,message,status=400)=>{throw Object.assign(Error(message),{code,status});};
function shape(value,fields){if(!plain(value)||Object.keys(value).some(key=>!fields.includes(key)))fail('WEB_IMPORT_REQUEST','Некорректные параметры исходника.');return value;}
function sync(fn){if(typeof fn!=='function')return;const result=fn();if(result?.then){result.catch?.(()=>{});fail('WEB_IMPORT_CONTEXT','Нужна синхронная проверка прав.',500);}}
function context(input){
  if(!plain(input)||typeof input.dataDir!=='string'||!path.isAbsolute(input.dataDir))fail('WEB_IMPORT_CONTEXT','Каталог базы не подтверждён.',500);
  const read=()=>{sync(input.assertCurrent);const value=input.getPrincipal?input.getPrincipal():input.principal;if(!plain(value)||!value.id)fail('ACCESS_DENIED','Текущая учётная запись не подтверждена.',403);return access.normalizePrincipal(value);};
  const initial=read();const current=()=>{const value=read();if(value.id!==initial.id||value.role!==initial.role||value.policyStamp!==initial.policyStamp)fail('SESSION_CHANGED','База или права изменились во время чтения исходника.',409);return value;};
  return {...input,current,assertCurrent:()=>{current();}};
}
function source(value,limit=MAX_FILE){
  shape(value,['name','base64']);const name=value.name,encoded=value.base64;
  if(typeof name!=='string'||!name||name.length>240||/[<>:"/\\|?*\x00-\x1f]/.test(name)||/[. ]$/.test(name)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))fail('WEB_IMPORT_NAME','Недопустимое имя исходного файла.');
  if(typeof encoded!=='string'||!encoded.length||encoded.length>Math.ceil(limit/3)*4||encoded.length%4||/[^A-Za-z0-9+/=]/.test(encoded))fail('WEB_IMPORT_BYTES','Некорректные исходные байты или файл больше допустимого размера.');
  const bytes=Buffer.from(encoded,'base64');if(!bytes.length||bytes.length>limit||bytes.toString('base64')!==encoded)fail('WEB_IMPORT_BYTES','Не подтверждены исходные байты файла.');
  return {name,bytes};
}
function bind(ctx,payload,profile){
  ctx.assertCurrent();return storage.withDatabaseLock(ctx.dataDir,()=>{
    const current=ctx.current();if(payload.databaseToken!==storage.databaseToken(ctx.dataDir))fail('DATABASE_CHANGED','База изменилась после выбора исходника.',409);
    if(profile&&!sources.actions(current).includes(profile))fail('ACCESS_DENIED','Нет права на этот профиль импорта.',403);
    return current;
  });
}
function allowed(ctx,profile){if(!sources.actions(ctx.current()).includes(profile))fail('ACCESS_DENIED','Нет права на этот профиль импорта.',403);}
function proof(ctx){
  if(!plain(ctx.writeOptions)||ctx.writeOptions.requireWriterSchema!==true||ctx.writeOptions.requireNegotiatedWriter!==true||typeof ctx.writeOptions.assertWriteCompatibility!=='function')fail('PROTOCOL_RENEGOTIATE','Подтвердите совместимость перед сохранением исходника.',428);
  if(ctx.beforeCommit===undefined&&!ctx.backup)fail('WEB_IMPORT_BACKUP','Резервное копирование перед сохранением исходника не настроено.',503);
  return {...ctx.writeOptions,principal:ctx.current(),getPrincipal:ctx.current};
}
function backup(ctx){
  ctx.assertCurrent();if(ctx.beforeCommit!==undefined){if(typeof ctx.beforeCommit!=='function')fail('WEB_IMPORT_CONTEXT','Не подтверждена подготовка сохранения.',500);sync(ctx.beforeCommit);}
  else{const {directory,keep}=ctx.backup;if(typeof directory!=='string'||!path.isAbsolute(directory)||!Number.isInteger(keep)||keep<1)fail('WEB_IMPORT_CONTEXT','Некорректные параметры резервной копии.',500);storage.makeDailyBackup(ctx.dataDir,directory,keep);}
  ctx.assertCurrent();
}
async function pdfText(ctx,original,kind){
  if(original.bytes.subarray(0,1024).indexOf('%PDF-')<0)fail('WEB_IMPORT_PDF','Выбранный исходник не является PDF.');
  return new Promise((resolve,reject)=>{
    const worker=new Worker(path.join(__dirname,'import-pdf-worker.cjs'),{workerData:{base64:original.bytes.toString('base64'),kind},resourceLimits:{maxOldGenerationSizeMb:256,maxYoungGenerationSizeMb:32}});let done=false;
    const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);clearInterval(interval);void worker.terminate();error?reject(error):resolve(value);};
    const timer=setTimeout(()=>finish(Object.assign(Error('Чтение PDF превысило 30 секунд.'),{code:'WEB_IMPORT_TIMEOUT',status:504})),30000);
    const interval=setInterval(()=>{try{ctx.assertCurrent();}catch(error){finish(error);}},100);
    worker.once('error',()=>finish(Object.assign(Error('Не удалось прочитать исходный PDF.'),{code:'WEB_IMPORT_PDF'})));
    worker.once('exit',()=>{if(!done)finish(Object.assign(Error('Чтение PDF завершилось без результата.'),{code:'WEB_IMPORT_PDF'}));});
    worker.once('message',result=>{try{ctx.assertCurrent();if(result?.ok!==true)fail(result?.code==='WEB_IMPORT_LIMIT'?'WEB_IMPORT_LIMIT':'WEB_IMPORT_PDF','Не удалось прочитать PDF в допустимых пределах.');if(!Array.isArray(result.items)||result.items.length>250000||Buffer.byteLength(JSON.stringify(result))>32*1024*1024)fail('WEB_IMPORT_LIMIT','В PDF слишком много текстовых элементов.');finish(null,result.items);}catch(error){finish(error);}});
  });
}
function pick(value){return Object.fromEntries(RAR_SECTIONS.map(section=>[section,Array.isArray(value?.[section])?value[section]:[]]));}
function rowIdentity(value){const id=value?.id;return typeof id==='string'&&id||typeof id==='number'&&Number.isFinite(id)?JSON.stringify([typeof id,id]):null;}
function publicMetadata(value){if(Array.isArray(value))return value.map(publicMetadata);if(!plain(value))return value;return Object.fromEntries(Object.entries(value).filter(([key])=>!['path','directory','workerPath','corePath'].includes(key)).map(([key,child])=>[key,key==='dependencyError'&&child?'Локальные компоненты OCR не прошли проверку.':key==='error'&&child?'Локальная модель OCR не прошла проверку.':publicMetadata(child)]));}
async function rar(ctx,original){
  allowed(ctx,'section-data');const entries=await require('../electron/archive-decoder.cjs').extractRAR(original.bytes,{assertCurrent:ctx.assertCurrent,limits:{extractedBytes:24*1024*1024,entries:1000}});ctx.assertCurrent();
  const jsons=entries.filter(entry=>!entry.isDirectory&&/\.json$/i.test(entry.name));if(!jsons.length)fail('WEB_IMPORT_RAR','В архиве не найдено JSON-файлов с данными.');
  let main=null;const backups=[];
  for(const entry of jsons){ctx.assertCurrent();let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(entry.bytes));}catch{continue;}if(!plain(value))continue;
    require('../assets/core/platform-contracts.js').validateSections({appMeta:[{value}]},storage.SECTIONS);
    const isBackup=/(?:^|\/)backups\//i.test(entry.name),isMain=/(?:^|\/)data\.json$/i.test(entry.name)&&!isBackup;
    if(isMain)main=pick(value);else if(isBackup)backups.push(pick(value));else if(!main)main=pick(value);
  }
  if(!main&&!backups.length)fail('WEB_IMPORT_RAR','В архиве нет корректных JSON-данных.');main??=pick({});
  const backupExtra={};for(const section of RAR_SECTIONS){const seen=new Set(main[section].map(rowIdentity).filter(Boolean)),extra=[];for(const snapshot of backups)for(const row of snapshot[section]){const id=rowIdentity(row);if(id===null||seen.has(id))continue;seen.add(id);extra.push(row);}backupExtra[section]=extra;}
  const result={main,backupExtra,backupCount:backups.length};if(Buffer.byteLength(JSON.stringify(result))>32*1024*1024)fail('WEB_IMPORT_LIMIT','Данные архива превышают 32 МБ.');return result;
}
let runtime;
function ocrRuntime(){return runtime??=require('../electron/ocr-runtime.cjs').createOcrRuntime({rootDir:path.resolve(__dirname,'..'),workerPath:path.resolve(__dirname,'../vendor/tesseract-worker/index.cjs'),maxWorkers:2});}
async function recognize(ctx,payload){
  shape(payload,['action','source','options','databaseToken']);bind(ctx,payload);const original=source(payload.source,MAX_IMAGE),options=payload.options||{};shape(options,['language','profile','decode','psm','threshold','isRegion']);
  if(!/\.(?:png|jpe?g|bmp|webp)$/i.test(original.name))fail('WEB_OCR_IMAGE','Для OCR выберите PNG, JPEG, BMP или WebP.');
  if(['codes','amount'].includes(options.decode)&&options.isRegion!==true)fail('WEB_OCR_REGION','Для реквизитов выделите отдельную область OCR.');
  const controller=new AbortController();let stale=null;const interval=setInterval(()=>{try{ctx.assertCurrent();}catch(error){stale=error;controller.abort();}},100);
  try{
    const result=await ocrRuntime().recognize(original.bytes,{language:options.language||'rus+eng',profile:options.profile||'accurate',decode:options.decode||'document',psm:options.psm,threshold:options.threshold,autorotate:false,timeoutMs:90000,signal:controller.signal,onProgress(progress){try{ctx.assertCurrent();ctx.onProgress?.(progress);}catch(error){stale=error;controller.abort();}}});
    if(stale)throw stale;bind(ctx,payload);return {ok:true,...result,...(result.meta?{meta:publicMetadata(result.meta)}:{})};
  }catch(error){if(stale)throw stale;throw error;}finally{clearInterval(interval);}
}
async function handle(input,payload){
  const ctx=context(input);if(!plain(payload)||typeof payload.action!=='string')fail('WEB_IMPORT_REQUEST','Укажите действие исходника.');
  if(payload.action==='ocr')return recognize(ctx,payload);
  if(payload.action==='ocrInfo'){
    shape(payload,['action']);ctx.assertCurrent();const value=await ocrRuntime().info();ctx.assertCurrent();
    return {ok:true,...publicMetadata(value)};
  }
  shape(payload,['action','source','databaseToken']);const profile=payload.action==='registry'?'registry':payload.action==='glonass'?'glonass':payload.action==='svodka'||payload.action==='rar'?'section-data':null;
  bind(ctx,payload,profile);const original=source(payload.source),extension=path.extname(original.name).toLowerCase();
  if(payload.action==='archiveSource'){
    if(!sources.actions(ctx.current()).length)fail('ACCESS_DENIED','Нет права сохранять источник импорта.',403);const authority=proof(ctx);
    return storage.withDatabaseLock(ctx.dataDir,()=>{bind(ctx,payload);storage.assertWritable(ctx.dataDir,authority);storage.assertWriteCompatibility(ctx.dataDir,authority,'controlledImports');const descriptor=sources.inventorySupport.descriptor(original);
      // Verify existing files before backup; duplicate originals are immutable.
      const target=path.join(sources.inventorySupport.root(ctx.dataDir,false),descriptor.id);if(fs.existsSync(target)){const existing=require('../electron/safe-file.cjs').readRegularFileSync(target,{maxBytes:MAX_FILE,minBytes:1,assertCurrent:ctx.assertCurrent});if(!existing.equals(original.bytes))fail('IMPORT_SOURCE_HASH','Сохранённый оригинал повреждён.');return {ok:true,...descriptor};}
      backup(ctx);const folder=sources.inventorySupport.root(ctx.dataDir,true);sources.inventorySupport.writeImmutable(path.join(folder,descriptor.id),original.bytes);ctx.assertCurrent();return {ok:true,...descriptor};
    });
  }
  let result;if(payload.action==='registry'){
    if(registryActive>=2)fail('REGISTRY_BUSY','Сейчас читаются другие реестры. Повторите загрузку немного позже.',503);
    registryActive++;try{result=await new Promise((resolve,reject)=>{
      const worker=new Worker(path.join(__dirname,'registry-import-worker.cjs'),{workerData:{name:original.name,base64:original.bytes.toString('base64')},resourceLimits:{maxOldGenerationSizeMb:256,maxYoungGenerationSizeMb:32}});let done=false;
      const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);clearInterval(interval);void worker.terminate();error?reject(error):resolve(value);};
      const timer=setTimeout(()=>finish(Object.assign(Error('Чтение реестра превысило 45 секунд.'),{code:'REGISTRY_TIMEOUT',status:504})),45000);
      const interval=setInterval(()=>{try{bind(ctx,payload,profile);}catch(error){finish(error);}},200);
      worker.once('error',()=>finish(Object.assign(Error('Не удалось прочитать реестр в допустимых пределах.'),{code:'REGISTRY_DECODE'})));
      worker.once('exit',()=>{if(!done)finish(Object.assign(Error('Чтение реестра завершилось без результата.'),{code:'REGISTRY_DECODE'}));});
      worker.once('message',value=>{try{bind(ctx,payload,profile);if(!value?.ok)fail(value?.code||'REGISTRY_DECODE',value?.error||'Не удалось прочитать реестр.');finish(null,value);}catch(error){finish(error);}});
    });}finally{registryActive--;}
  }else if(payload.action==='rar'){if(extension!=='.rar')fail('WEB_IMPORT_TYPE','Выберите RAR-архив.');result=await rar(ctx,original);}
  else if(payload.action==='svodka'){if(extension!=='.pdf')fail('WEB_IMPORT_TYPE','Выберите сводку PDF.');result={items:await pdfText(ctx,original,'svodka')};}
  else if(payload.action==='glonass'){
    if(!['.pdf','.xlsx','.xls'].includes(extension))fail('WEB_IMPORT_TYPE','Для ГЛОНАСС выберите PDF или Excel.');
    result=extension==='.pdf'?{kind:'pdf',items:await pdfText(ctx,original,'glonass')}:{kind:'xlsx',base64:original.bytes.toString('base64')};
  }else fail('WEB_IMPORT_ACTION','Неизвестное действие исходника.');
  bind(ctx,payload,profile);return {ok:true,...result,fileName:original.name,source:{name:original.name,base64:original.bytes.toString('base64')},sha256:hash(original.bytes),bytes:original.bytes.length};
}
async function close(){if(runtime){const current=runtime;runtime=null;await current.dispose();}}
module.exports=Object.freeze({handle,close,MAX_FILE,source});
