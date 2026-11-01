'use strict';

// Browser document operations retain the native storage, scope and artifact
// authorities. No browser-supplied path or archive model reaches a renderer.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const storage=require('../electron/storage'),attachments=require('../electron/attachment-access.cjs');
const accessContext=require('../electron/access-context.cjs');
const MAX_FILE=25*1024*1024,MAX_HTML=16*1024*1024,MAX_OUTPUT=64*1024*1024;
const SAFE_EXT=new Set(['.pdf','.png','.jpg','.jpeg','.webp','.txt','.csv','.xlsx','.xls','.docx','.odt','.ods']);
const MIME={'.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.txt':'text/plain;charset=utf-8','.csv':'text/csv;charset=utf-8','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.xls':'application/vnd.ms-excel','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.odt':'application/vnd.oasis.opendocument.text','.ods':'application/vnd.oasis.opendocument.spreadsheet'};
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const fail=(code,message,status=400)=>{throw Object.assign(Error(message),{code,status});};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function shape(value,fields){if(!plain(value)||Object.keys(value).some(key=>!fields.includes(key)))fail('WEB_DOCUMENT_REQUEST','Некорректные параметры документа.');return value;}
function syncCheck(check){if(typeof check!=='function')return;const result=check();if(result&&typeof result.then==='function'){result.catch?.(()=>{});fail('WEB_DOCUMENT_CONTEXT','Проверка контекста должна быть синхронной.',500);}}
function context(value){
  if(!plain(value)||typeof value.dataDir!=='string'||!path.isAbsolute(value.dataDir))fail('WEB_DOCUMENT_CONTEXT','Каталог базы не подтверждён.',500);
  const raw=value.getPrincipal?value.getPrincipal():value.principal;if(!plain(raw)||typeof raw.id!=='string'||!raw.id)fail('ACCESS_DENIED','Учётная запись не подтверждена.',403);
  const initial=accessContext.normalizePrincipal(raw);
  if(!initial?.id)fail('ACCESS_DENIED','Учётная запись не подтверждена.',403);
  const binding={id:initial.id,role:initial.role,policyStamp:accessContext.policyStamp(initial)};
  const current=()=>{
    syncCheck(value.assertCurrent);
    const rawCurrent=value.getPrincipal?value.getPrincipal():value.principal;
    if(!plain(rawCurrent)||!rawCurrent.id)fail('SESSION_CHANGED','Доступ отозван во время работы с документом.',409);
    const principal=accessContext.normalizePrincipal(rawCurrent);
    if(!principal?.id||principal.id!==binding.id||principal.role!==binding.role||accessContext.policyStamp(principal)!==binding.policyStamp)fail('SESSION_CHANGED','Права изменились во время работы с документом.',409);
    return principal;
  };
  current();return {...value,current,assertCurrent:()=>{current();}};
}
function writeOptions(ctx){
  if(!plain(ctx.writeOptions)||ctx.writeOptions.requireWriterSchema!==true||ctx.writeOptions.requireNegotiatedWriter!==true||typeof ctx.writeOptions.assertWriteCompatibility!=='function')fail('PROTOCOL_RENEGOTIATE','Подтвердите совместимость перед сохранением документа.',428);
  if(ctx.beforeCommit===undefined&&!ctx.backup)fail('WEB_DOCUMENT_BACKUP','Перед сохранением документа подтвердите резервное копирование на сервере.',503);
  return {...ctx.writeOptions,principal:ctx.current(),getPrincipal:ctx.current,beforeCommit:()=>beforeCommit(ctx)};
}
function beforeCommit(ctx){
  ctx.assertCurrent();
  if(ctx.beforeCommit!==undefined){if(typeof ctx.beforeCommit!=='function')fail('WEB_DOCUMENT_CONTEXT','Некорректная подготовка сохранения.',500);syncCheck(ctx.beforeCommit);}
  else if(ctx.backup){const {directory,keep}=ctx.backup;if(typeof directory!=='string'||!path.isAbsolute(directory)||!Number.isInteger(keep)||keep<1)fail('WEB_DOCUMENT_CONTEXT','Некорректные параметры резервной копии.',500);storage.makeDailyBackup(ctx.dataDir,directory,keep);}
  ctx.assertCurrent();
}
function name(value,fallback='Документ.pdf'){
  if(typeof value!=='string'||!value||value.length>240||path.basename(value)!==value||/[<>:"/\\|?*\x00-\x1f]/.test(value)||/[. ]$/.test(value))fail('WEB_DOCUMENT_NAME','Недопустимое имя документа.');
  if(/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value))fail('WEB_DOCUMENT_NAME','Недопустимое имя документа.');
  return value||fallback;
}
function source(input){
  shape(input,['name','base64']);const filename=name(input.name),encoded=input.base64;
  if(typeof encoded!=='string'||!encoded.length||encoded.length%4||encoded.length>4*Math.ceil(MAX_FILE/3)||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))fail('WEB_DOCUMENT_BYTES','Нужен непустой файл размером до 25 МБ.');
  const bytes=Buffer.from(encoded,'base64');if(!bytes.length||bytes.length>MAX_FILE||bytes.toString('base64')!==encoded)fail('WEB_DOCUMENT_BYTES','Некорректные исходные байты документа.');
  return {name:filename,bytes};
}
function binary(bytes,filename,extra={}){
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>MAX_OUTPUT)fail('WEB_DOCUMENT_OUTPUT','Пустой документ или размер больше 64 МБ.');
  return {ok:true,...extra,name:filename,defaultFileName:filename,mime:MIME[path.extname(filename).toLowerCase()]||'application/octet-stream',base64:bytes.toString('base64'),bytes:bytes.length,size:bytes.length,sha256:digest(bytes)};
}
function pdfBytes(bytes){if(!Buffer.isBuffer(bytes))bytes=Buffer.from(bytes);if(bytes.length<5||bytes.length>MAX_OUTPUT||bytes.subarray(0,5).toString()!=='%PDF-')fail('WEB_PDF_OUTPUT','Сервис печати не вернул корректный PDF.',502);return bytes;}
function removeJob(folder){
  // The exact directory was allocated by mkdtemp, never by request data.
  const resolved=path.resolve(folder),base=fs.realpathSync.native(os.tmpdir());
  if(path.dirname(resolved)!==base||!/^tvs-web-document-[A-Za-z0-9]+$/.test(path.basename(resolved)))throw Error('Unexpected document temporary path');
  const stat=fs.lstatSync(resolved);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Unexpected document temporary directory');
  fs.rmSync(resolved,{recursive:true,force:true});
}
function tempJob(){return fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'tvs-web-document-'));}
let activeRenders=0;
function electronExecutable(configured){
  let target=configured;
  if(target===undefined){const bundled=path.resolve(__dirname,'../../runtime/electron',process.platform==='win32'?'electron.exe':'electron');if(fs.existsSync(bundled))target=bundled;else try{target=require('electron');}catch{fail('WEB_PDF_RUNTIME','Для формирования PDF нужен установленный серверный модуль Electron.',503);}}
  if(typeof target!=='string'||!path.isAbsolute(target)||!fs.existsSync(target)||!fs.statSync(target).isFile())fail('WEB_PDF_RUNTIME','Серверный модуль печати Electron недоступен.',503);
  return target;
}
async function renderHtmlPdf(html,options={},assertCurrent=()=>{},runtime={}){
  syncCheck(assertCurrent);
  if(typeof html!=='string'||!html||Buffer.byteLength(html)>MAX_HTML)fail('WEB_PDF_INPUT','Нужна печатная форма размером до 16 МБ.');
  shape(options,['landscape','pageSize','preferCSSPageSize']);
  if(options.landscape!==undefined&&typeof options.landscape!=='boolean'||options.preferCSSPageSize!==undefined&&typeof options.preferCSSPageSize!=='boolean'||options.pageSize!==undefined&&options.pageSize!=='A4')fail('WEB_PDF_INPUT','Некорректные параметры печати.');
  if(activeRenders>=2)fail('WEB_PDF_BUSY','Сервис печати занят. Повторите выгрузку после завершения текущей.',503);
  const executable=electronExecutable(runtime.electronPath),job=tempJob();activeRenders++;
  let child;
  try{
    const input=path.join(job,'input.json'),output=path.join(job,'output.pdf');
    fs.writeFileSync(input,JSON.stringify({html,options}),{flag:'wx',mode:0o600});
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
    child=spawn(executable,[path.join(__dirname,'pdf-worker.cjs'),job,'--disable-gpu','--no-first-run'],{windowsHide:true,stdio:['ignore','ignore','pipe'],env});
    await new Promise((resolve,reject)=>{
      let settled=false;const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve();};
      const timer=setTimeout(()=>{child.kill();finish(Object.assign(Error('Истекло время формирования PDF.'),{code:'WEB_PDF_TIMEOUT',status:504}));},60000);
      child.stderr.on('data',()=>{}); // Chromium diagnostics can contain file paths.
      child.once('error',()=>finish(Object.assign(Error('Не удалось запустить серверный модуль печати.'),{code:'WEB_PDF_RUNTIME',status:503})));
      child.once('exit',code=>finish(code===0?null:Object.assign(Error('Серверный модуль печати завершился без PDF.'),{code:'WEB_PDF_RENDER',status:502})));
    });
    syncCheck(assertCurrent);
    const bytes=require('../electron/safe-file.cjs').readRegularFileSync(output,{maxBytes:MAX_OUTPUT,assertCurrent});
    syncCheck(assertCurrent);return pdfBytes(bytes);
  }finally{
    if(child&&child.exitCode===null){if(!child.killed)child.kill();await new Promise(resolve=>{const timer=setTimeout(resolve,3000);child.once('close',()=>{clearTimeout(timer);resolve();});});}
    activeRenders--;removeJob(job);
  }
}
async function renderArchivedPdf(snapshot,assertCurrent=()=>{},runtime={}){
  syncCheck(assertCurrent);const printing=require('../assets/core/document-print.js');printing.verify(snapshot);
  return renderHtmlPdf(printing.render(snapshot).html,{landscape:false,pageSize:'A4',preferCSSPageSize:true},assertCurrent,runtime);
}
async function renderFor(ctx,html,options){ctx.assertCurrent();const result=await (ctx.renderHtmlPdf||renderHtmlPdf)(html,options,ctx.assertCurrent,{electronPath:ctx.electronPath});ctx.assertCurrent();return pdfBytes(result);}
async function handle(input,payload){
  const ctx=context(input);if(!plain(payload)||typeof payload.action!=='string')fail('WEB_DOCUMENT_REQUEST','Укажите действие документа.');
  if(payload.action==='attachmentAdd'){
    shape(payload,['action','origin','source','databaseToken']);shape(payload.origin,['section','id']);const original=source(payload.source);
    if(!SAFE_EXT.has(path.extname(original.name).toLowerCase()))fail('WEB_ATTACHMENT_TYPE','Неподдерживаемый тип вложения.');
    const options=writeOptions(ctx),captured=attachments.capture(ctx.dataDir,payload.origin,options);
    if(payload.databaseToken!==undefined&&payload.databaseToken!==captured.databaseToken)fail('DATABASE_CHANGED','База изменилась после выбора файла.',409);
    const job=tempJob();try{
      const filename=path.join(job,original.name);fs.writeFileSync(filename,original.bytes,{flag:'wx',mode:0o600});ctx.assertCurrent();
      const file=storage.withDatabaseLock(ctx.dataDir,()=>{ctx.assertCurrent();attachments.capture(ctx.dataDir,payload.origin,options);beforeCommit(ctx);return attachments.add(ctx.dataDir,captured,filename,options);});ctx.assertCurrent();return {ok:true,file,databaseToken:captured.databaseToken};
    }finally{removeJob(job);}
  }
  if(payload.action==='attachmentRead'){
    shape(payload,['action','origin']);shape(payload.origin,['section','id','fileId']);
    return storage.withDatabaseLock(ctx.dataDir,()=>{
      const options={getPrincipal:ctx.current},item=attachments.inspect(ctx.dataDir,payload.origin,options);
      if(!SAFE_EXT.has(path.extname(item.path).toLowerCase()))fail('WEB_ATTACHMENT_TYPE','Неподдерживаемый тип вложения.');
      const bytes=attachments.regular(item.path),hash=digest(bytes);if(hash!==item.file.id.slice(0,64)||item.file.sha256&&hash!==item.file.sha256||item.file.size!==undefined&&bytes.length!==item.file.size)fail('ATTACHMENT_ACCESS','Контрольная сумма вложения не совпала.',403);
      attachments.inspect(ctx.dataDir,payload.origin,options);ctx.assertCurrent();return binary(bytes,name(item.file.name),{file:item.file});
    });
  }
  if(payload.action==='pdf'){
    shape(payload,['action','html','defaultFileName']);const filename=name(payload.defaultFileName||'Сводка.pdf');if(path.extname(filename).toLowerCase()!=='.pdf')fail('WEB_DOCUMENT_NAME','Для PDF нужно расширение .pdf.');
    const bytes=await renderFor(ctx,payload.html,{landscape:true,pageSize:'A4',preferCSSPageSize:false});ctx.assertCurrent();return binary(bytes,filename,{format:'pdf'});
  }
  if(payload.action==='inventoryReport'){
    shape(payload,['action','request']);const exporter=require('../electron/asset-inventory-export.js');
    const read=async request=>{ctx.assertCurrent();const value=await (ctx.prepareInventoryReport?ctx.prepareInventoryReport(request,ctx.current()):exporter.prepare(ctx.dataDir,request,ctx.current()));ctx.assertCurrent();if(value?.ok!==true||!['pdf','xlsx'].includes(value.format)||value.format!==request.format||value.sessionId!==request.sessionId||value.databaseToken!==request.databaseToken||!/^sha256:[a-f0-9]{64}$/.test(value.sourceFingerprint||'')||value.templateVersion!==1)fail('INVENTORY_EXPORT_SOURCE','Источник инвентаризационной описи не подтверждён.',409);require('../assets/core/platform-contracts.js').validateSections({appMeta:[{model:value.model}]},storage.SECTIONS);return value;};
    const prepared=await read(payload.request);ctx.assertCurrent();
    const bytes=prepared.format==='xlsx'?Buffer.from(await exporter.xlsx(prepared)):await renderFor(ctx,exporter.html(prepared),{landscape:true,pageSize:'A4',preferCSSPageSize:false});
    ctx.assertCurrent();const confirmed=await read({...payload.request,sourceFingerprint:prepared.sourceFingerprint});
    if(confirmed.databaseToken!==prepared.databaseToken||confirmed.sourceFingerprint!==prepared.sourceFingerprint)fail('INVENTORY_EXPORT_STALE','Опись изменилась во время выгрузки.',409);
    return binary(bytes,name(prepared.defaultFileName),{format:prepared.format,sessionId:prepared.sessionId,databaseToken:prepared.databaseToken,sourceFingerprint:prepared.sourceFingerprint,templateVersion:prepared.templateVersion});
  }
  if(payload.action==='documentPrint'){
    shape(payload,['action','request']);const authority=payload.request?.action==='export'?writeOptions(ctx):{principal:ctx.current(),getPrincipal:ctx.current};
    const result=await require('../electron/document-archive.cjs').handle(ctx.dataDir,payload.request,{...authority,renderPdf:snapshot=>{
      const printing=require('../assets/core/document-print.js');printing.verify(snapshot);return renderFor(ctx,printing.render(snapshot).html,{landscape:false,pageSize:'A4',preferCSSPageSize:true});
    }});
    ctx.assertCurrent();if(result.ok&&payload.request.action==='export'){
      const bytes=require('../electron/document-print-export.cjs').verifiedBytes(result,payload.request);
      return {...result,bytes:bytes.length,name:'Документ_'+result.archiveId+'.'+result.format};
    }return result;
  }
  fail('WEB_DOCUMENT_ACTION','Неизвестное действие документа.');
}
module.exports=Object.freeze({handle,renderHtmlPdf,renderArchivedPdf,MAX_FILE,SAFE_EXT});
