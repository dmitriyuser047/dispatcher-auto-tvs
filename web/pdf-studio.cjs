'use strict';

// Adapt the retained native PDF services to private uploaded copies. The fake
// picker and window represent a browser editor's ownership, never a real UI or
// a user-selected server path. Native project/export/font/OCR code stays shared.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {EventEmitter}=require('node:events'),{Worker}=require('node:worker_threads');
const storage=require('../electron/storage'),access=require('../electron/access-context.cjs'),safe=require('../electron/safe-file.cjs');
const source=require('./imports.cjs').source;
const ROOT=path.resolve(__dirname,'..'),MAX_BYTES=64*1024*1024;
const DOWNLOADS=new Set(['pdf-editor-save','pdf-editor-save-as','pdf-studio-export','pdf-studio-save-project','pdf-studio-export-pages']);
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const fail=(code,message,status=400)=>{throw Object.assign(Error(message),{code,status});};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const METHODS=new Set(['close','pdf-editor-data','pdf-editor-open','pdf-editor-commit-open','pdf-editor-cancel-open','pdf-editor-font','pdf-editor-save','pdf-editor-save-as','pdf-editor-merge','pdf-editor-insert-image','pdf-editor-ocr','pdf-editor-ocr-info','pdf-editor-process-content','pdf-editor-adopt-project','pdf-studio-export','pdf-studio-save-project','pdf-studio-open-project','pdf-studio-autosave','pdf-studio-recovery-list','pdf-studio-recovery-open','pdf-studio-recovery-delete','pdf-studio-compare-file','pdf-studio-export-pages']);
function safeResult(value){
  if(Array.isArray(value))return value.map(safeResult);if(!plain(value))return value;
  return Object.fromEntries(Object.entries(value).filter(([key])=>!['directory','workerPath','corePath'].includes(key)).map(([key,child])=>[key,key==='path'||key==='filePath'?typeof child==='string'?path.basename(child):child:key==='error'&&typeof child==='string'?child.replace(/[A-Za-z]:[\\/][^\s"']+/g,'[локальный файл]'):safeResult(child)]));
}
function renderPage({csrf}={}){
  if(typeof csrf!=='string'||!/^[a-f0-9]{64}$/.test(csrf))fail('WEB_PDF_CONTEXT','Откройте PDF-редактор после входа.',401);
  return fs.readFileSync(path.join(ROOT,'pdf-editor.html'),'utf8').replace('<head>','<head><meta name="tvs-csrf" content="'+csrf+'"><script defer src="/web/public/crypto.js"></script><script defer src="/web/public/pdf-bridge.js"></script>');
}
function staticAsset(urlPath){
  const paths=[[/^\/node_modules\/pdfjs-dist\/(?:legacy\/build\/(?:pdf|pdf\.worker)\.mjs|standard_fonts\/[A-Za-z0-9_.-]+|cmaps\/[A-Za-z0-9_.-]+|wasm\/[A-Za-z0-9_.-]+)$/,null],
    [/^\/node_modules\/pdf-lib\/dist\/pdf-lib\.min\.js$/,null],[/^\/node_modules\/@pdf-lib\/fontkit\/dist\/fontkit\.umd\.min\.js$/,null]];
  if(!paths.some(([pattern])=>pattern.test(urlPath)))return null;
  const filename=path.join(ROOT,urlPath.slice(1)),base=fs.realpathSync.native(path.join(ROOT,'node_modules'));
  try{const actual=fs.realpathSync.native(filename),stat=fs.lstatSync(filename);if(!actual.startsWith(base+path.sep)||!stat.isFile()||stat.isSymbolicLink())return null;return {path:actual,mime:/\.m?js$/.test(actual)?'text/javascript;charset=utf-8':/\.wasm$/.test(actual)?'application/wasm':'application/octet-stream'};}catch{return null;}
}
function createPdfStudio(){
  const tempBase=fs.realpathSync.native(os.tmpdir()),root=fs.mkdtempSync(path.join(tempBase,'tvs-web-studio-')),pin=fs.lstatSync(root),owners=new Map();let active=true,serial=1000,totalEditors=0;
  function usage(directory){let bytes=0,entries=0;const visit=folder=>{for(const name of fs.readdirSync(folder)){if(++entries>10000)fail('WEB_PDF_QUOTA','В PDF-редакторе слишком много временных файлов.',429);const target=path.join(folder,name),stat=fs.lstatSync(target);if(stat.isSymbolicLink())fail('WEB_PDF_STORAGE','Неверная структура хранилища PDF.',500);if(stat.isDirectory())visit(target);else if(stat.isFile())bytes+=stat.size;else fail('WEB_PDF_STORAGE','Неверная структура хранилища PDF.',500);}};visit(directory);return bytes;}
  function removeJob(owner,job){if(!job)return;const resolved=path.resolve(job);if(path.dirname(resolved)!==owner.directory||!/^job-[a-f0-9]{32}$/.test(path.basename(resolved)))throw Error('Unexpected PDF job path');if(!fs.existsSync(resolved))return;const stat=fs.lstatSync(resolved);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Unexpected PDF job directory');fs.rmSync(resolved,{recursive:true,force:true});}
  function replaceJob(owner,editor,next){const previous=editor.currentJob;editor.currentJob=next;if(previous&&previous!==next)removeJob(owner,previous);}
  function guard(ctx,payload,expected){
    if(!active)fail('WEB_PDF_CLOSED','PDF-редактор закрыт.',410);
    if(!plain(ctx)||typeof ctx.sessionId!=='string'||ctx.sessionId.length<1||ctx.sessionId.length>200||typeof ctx.dataDir!=='string'||!path.isAbsolute(ctx.dataDir))fail('WEB_PDF_CONTEXT','Сеанс PDF-редактора не подтверждён.',403);
    const checked=ctx.assertCurrent?.();if(checked?.then){checked.catch?.(()=>{});fail('WEB_PDF_CONTEXT','Нужна синхронная проверка сеанса.',500);}
    const raw=ctx.getPrincipal?ctx.getPrincipal():ctx.principal;if(!plain(raw)||!raw.id)fail('ACCESS_DENIED','Учётная запись не подтверждена.',403);
    const principal=access.normalizePrincipal(raw),binding={session:sha(ctx.sessionId),id:principal.id,role:principal.role,stamp:principal.policyStamp,token:storage.databaseToken(ctx.dataDir)};
    if(payload.databaseToken!==binding.token)fail('DATABASE_CHANGED','База изменилась. Откройте PDF-редактор заново.',409);
    if(expected&&Object.keys(binding).some(key=>binding[key]!==expected[key]))fail('SESSION_CHANGED','Владелец, база или права PDF-редактора изменились.',403);
    return binding;
  }
  function createOwner(binding){
    const directory=path.join(root,binding.session);fs.mkdirSync(directory,{mode:0o700});
    const owner={binding,directory,handlers:new Map(),editors:new Map(),windows:new Map(),ctx:null,request:null,job:null,active:true,progress:[]},app=new EventEmitter();
    const check=()=>{if(!owner.active||!owner.ctx||!owner.request)fail('WEB_PDF_CONTEXT','Контекст PDF-редактора завершён.',403);guard(owner.ctx,owner.request,owner.binding);};
    owner.check=check;app.commandLine={hasSwitch:()=>true};app.getPath=()=>directory;
    const sender=()=>{const contents=new EventEmitter();contents.id=++serial;contents.mainFrame={};contents.closed=false;contents.isDestroyed=()=>{check();return contents.closed;};contents.getURL=()=>{check();return 'web-pdf-studio:'+contents.id;};contents.send=(_name,progress)=>{check();owner.progress=[progress];};contents.setWindowOpenHandler=()=>{};return contents;};
    class Window extends EventEmitter{
      constructor(){super();this.webContents=sender();owner.windows.set(this.webContents.id,this);this.closed=false;}
      static fromWebContents(contents){return owner.windows.get(contents.id);}
      isDestroyed(){return this.closed;}setTitle(){}setMenuBarVisibility(){}async loadFile(){}destroy(){this.closed=true;this.webContents.closed=true;this.webContents.emit('destroyed');this.emit('closed');owner.windows.delete(this.webContents.id);}
    }
    const dialog={
      async showOpenDialog(_parent,options){
        check();const files=owner.request.files||[];if(!Array.isArray(files)||files.length>20)fail('WEB_PDF_FILES','Выберите до 20 файлов.');if(!files.length)return {canceled:true,filePaths:[]};
        if(!options.properties?.includes('multiSelections')&&files.length!==1)fail('WEB_PDF_FILES','Выберите один файл.');
        const extensions=options.filters?.[0]?.extensions||[],paths=[];let total=0;
        for(const file of files){const original=source(file),ext=path.extname(original.name).slice(1).toLowerCase();if((total+=original.bytes.length)>25*1024*1024)fail('WEB_PDF_FILES','Общий размер выбранных файлов превышает 25 МБ.');if(!extensions.includes(ext))fail('WEB_PDF_FILES','Неверный тип выбранного файла.');if(['pdf','tvspdf'].includes(ext))await validate(original.bytes,ext,check);const target=path.join(owner.job,original.name);fs.writeFileSync(target,original.bytes,{flag:'wx',mode:0o600});paths.push(target);}
        return {canceled:false,filePaths:paths};
      },
      async showSaveDialog(_parent,options){check();const filename=path.basename(String(options.defaultPath||'Документ.pdf')).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,180);return {canceled:false,filePath:path.join(owner.job,filename||'Документ.pdf')};},
    };
    const ipcMain={handle(name,fn){if(owner.handlers.has(name))throw Error('Duplicate PDF method');owner.handlers.set(name,fn);}};
    owner.native=require('../electron/pdf-editor-service.cjs').registerPdfEditorService({app,BrowserWindow:Window,ipcMain,dialog,getOpeningContext:async()=>{check();return {};},assertOpeningContext:async()=>check(),assertOpeningContextSync:check});
    owner.Window=Window;owner.sender=sender;owners.set(binding.session,owner);return owner;
  }
  async function validate(bytes,kind,check){
    check();return new Promise((resolve,reject)=>{
      const transferred=new Uint8Array(bytes),worker=new Worker(path.join(__dirname,'pdf-validate-worker.cjs'),{workerData:{bytes:transferred,kind},transferList:[transferred.buffer],resourceLimits:{maxOldGenerationSizeMb:256,maxYoungGenerationSizeMb:32}});let done=false;
      const finish=(error)=>{if(done)return;done=true;clearTimeout(timer);clearInterval(interval);void worker.terminate();error?reject(error):resolve();};
      const timer=setTimeout(()=>finish(Object.assign(Error('Проверка PDF превысила 20 секунд.'),{code:'WEB_PDF_TIMEOUT',status:504})),20000),interval=setInterval(()=>{try{check();}catch(error){finish(error);}},100);
      worker.once('error',()=>finish(Object.assign(Error('Не удалось проверить PDF в допустимых пределах.'),{code:'WEB_PDF_INPUT'})));worker.once('exit',()=>{if(!done)finish(Object.assign(Error('Проверка PDF завершилась без результата.'),{code:'WEB_PDF_INPUT'}));});
      worker.once('message',value=>{try{check();if(value?.ok!==true)fail('WEB_PDF_INPUT','Некорректный PDF или проект превышает допустимые пределы.');finish();}catch(error){finish(error);}});
    });
  }
  async function content(ctx,payload,check){
    if(!plain(payload)||typeof payload.bytesBase64!=='string')fail('WEB_PDF_CONTENT','Нужны исходные байты PDF.');const original=source({name:'Содержимое.pdf',base64:payload.bytesBase64});
    return new Promise((resolve,reject)=>{
      const transferred=new Uint8Array(original.bytes),worker=new Worker(path.join(ROOT,'electron/pdf-content-engine.cjs'),{workerData:{tvsPdfContentWorker:1,bytes:transferred,changes:payload.changes,rasterizePages:payload.rasterizePages},transferList:[transferred.buffer],resourceLimits:{maxOldGenerationSizeMb:256,maxYoungGenerationSizeMb:32}});let done=false;
      const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);clearInterval(interval);void worker.terminate();error?reject(error):resolve(value);};
      const timer=setTimeout(()=>finish(Object.assign(Error('Обработка PDF превысила 60 секунд.'),{code:'WEB_PDF_TIMEOUT',status:504})),60000),interval=setInterval(()=>{try{check();}catch(error){finish(error);}},100);
      worker.once('error',()=>finish(Object.assign(Error('Не удалось обработать содержимое PDF.'),{code:'WEB_PDF_CONTENT'})));worker.once('exit',()=>{if(!done)finish(Object.assign(Error('Обработка PDF завершилась без результата.'),{code:'WEB_PDF_CONTENT'}));});
      worker.once('message',message=>{try{check();const result=message?.result;if(message?.ok!==true||!(result?.bytes instanceof Uint8Array)||!result.bytes.length||result.bytes.length>MAX_BYTES)fail('WEB_PDF_CONTENT','Не удалось обработать PDF в допустимых пределах.');finish(null,{ok:true,bytesBase64:Buffer.from(result.bytes).toString('base64'),warnings:result.warnings||[],pages:result.pages||[],engine:result.engine});}catch(error){finish(error);}});
    });
  }
  async function handle(ctx,payload){
    if(!plain(payload)||Object.keys(payload).some(key=>!['action','editorId','databaseToken','payload','files'].includes(key)))fail('WEB_PDF_REQUEST','Неверный запрос PDF-редактора.');
    if(Buffer.byteLength(JSON.stringify(payload))>40*1024*1024)fail('WEB_PDF_LIMIT','Запрос PDF-редактора превышает 40 МБ.',413);
    const binding=guard(ctx,payload);let owner=owners.get(binding.session);
    if(owner&&Object.keys(binding).some(key=>binding[key]!==owner.binding[key]))fail('SESSION_CHANGED','Сеанс PDF-редактора изменился.',403);
    if(payload.action!=='create'&&!METHODS.has(payload.action))fail('WEB_PDF_ACTION','Неизвестное действие PDF-редактора.');
    if(!owner){if(payload.action!=='create')fail('WEB_PDF_MISSING','Откройте PDF заново.',404);owner=createOwner(binding);}
    if(owner.busy)fail('WEB_PDF_BUSY','Дождитесь завершения операции PDF-редактора.',409);
    if(payload.action==='create'&&(owner.editors.size>=8||totalEditors>=64))fail('WEB_PDF_LIMIT','Закройте ненужные документы PDF перед открытием нового.',429);
    let editor=payload.action==='create'?null:owner.editors.get(payload.editorId);if(payload.action!=='create'&&!editor)fail('WEB_PDF_MISSING','Документ PDF не найден в этом сеансе.',404);
    const consumes=payload.action==='create'||Array.isArray(payload.files)&&payload.files.length||DOWNLOADS.has(payload.action)||payload.action==='pdf-studio-autosave';
    if(consumes&&(usage(owner.directory)+MAX_BYTES>256*1024*1024||usage(root)+MAX_BYTES>1024*1024*1024))fail('WEB_PDF_QUOTA','Временное хранилище PDF заполнено. Закройте документы или удалите копии восстановления.',429);
    if(payload.action==='close'){editor.window.destroy();owner.editors.delete(payload.editorId);totalEditors--;removeJob(owner,editor.currentJob);for(const job of editor.pendingJobs.values())removeJob(owner,job);return {ok:true,closed:true};}
    owner.busy=true;owner.ctx=ctx;owner.request=payload;owner.progress=[];owner.job=path.join(owner.directory,'job-'+crypto.randomBytes(16).toString('hex'));fs.mkdirSync(owner.job,{mode:0o700});
    owner.done=new Promise(resolve=>{owner.doneResolve=resolve;});
    let keepJob=false;
    try{
      owner.check();let result;
      if(['pdf-editor-save','pdf-editor-save-as','pdf-editor-adopt-project','pdf-studio-export-pages'].includes(payload.action)){
        const encoded=payload.payload?.pdfBase64??payload.payload?.bytesBase64;if(typeof encoded!=='string')fail('WEB_PDF_INPUT','Нужны исходные байты PDF.');
        const original=source({name:'Документ.pdf',base64:encoded});await validate(original.bytes,'pdf',owner.check);
      }
      if(payload.action==='create'){
        const sender=owner.sender(),event={sender};const prior=new Set(owner.windows.keys());result=await owner.handlers.get('open-pdf-editor')(event);owner.check();
        if(result?.ok){const win=[...owner.windows].find(([id])=>!prior.has(id))?.[1];if(!win)fail('WEB_PDF_MISSING','PDF-редактор не создал документ.',500);const editorId=crypto.randomBytes(32).toString('hex');editor={editorId,window:win,event:{sender:win.webContents},currentJob:owner.job,pendingJobs:new Map()};owner.editors.set(editorId,editor);totalEditors++;keepJob=true;result={ok:true,editorId,...await owner.handlers.get('pdf-editor-data')(editor.event)};}
      }else if(payload.action==='pdf-editor-process-content')result=await content(ctx,payload.payload,owner.check);
      else if(payload.action==='pdf-editor-ocr'){
        const encoded=payload.payload?.imageBase64;if(typeof encoded!=='string')fail('WEB_OCR_IMAGE','Нужно изображение OCR.');
        result=await require('./imports.cjs').handle({...ctx,onProgress:value=>{owner.check();owner.progress=[value];}},{action:'ocr',databaseToken:payload.databaseToken,source:{name:'Область.png',base64:encoded.replace(/^data:[^;,]+;base64,/i,'')},options:payload.payload?.options||{}});
      }else if(payload.action==='pdf-editor-ocr-info')result=await require('./imports.cjs').handle(ctx,{action:'ocrInfo'});
      else result=await owner.handlers.get(payload.action)(editor.event,payload.payload);
      owner.check();
      if(DOWNLOADS.has(payload.action)&&result?.path&&(result.ok===true||result.saved===true)){
        const target=path.resolve(result.path),relative=path.relative(owner.directory,target);if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))fail('WEB_PDF_OUTPUT','Сервис печати вернул файл вне редактора.',500);
        const bytes=await safe.readRegularFile(target,{maxBytes:MAX_BYTES,minBytes:1,assertCurrent:owner.check});owner.check();result={...result,name:path.basename(target),base64:bytes.toString('base64'),bytes:bytes.length,size:bytes.length,sha256:sha(bytes)};
      }
      if(payload.action==='pdf-editor-open'&&result?.ok&&result.pendingToken){for(const job of editor.pendingJobs.values())removeJob(owner,job);editor.pendingJobs.clear();editor.pendingJobs.set(result.pendingToken,owner.job);keepJob=true;}
      if(['pdf-editor-commit-open','pdf-editor-cancel-open'].includes(payload.action)&&result?.ok){const job=editor.pendingJobs.get(payload.payload);editor.pendingJobs.delete(payload.payload);if(payload.action==='pdf-editor-commit-open'&&job)replaceJob(owner,editor,job);else removeJob(owner,job);}
      if(['pdf-editor-save','pdf-editor-save-as'].includes(payload.action)&&result?.saved===true){replaceJob(owner,editor,path.dirname(result.path));keepJob=editor.currentJob===owner.job;}
      if(payload.action==='pdf-editor-adopt-project'&&result?.ok)replaceJob(owner,editor,null);
      return {...safeResult(result),...(owner.progress.length?{progress:owner.progress[0]}:{})};
    }finally{const job=owner.job;owner.busy=false;owner.ctx=null;owner.request=null;owner.job=null;try{if(!keepJob)removeJob(owner,job);}finally{owner.doneResolve?.();owner.doneResolve=null;}}
  }
  async function closeSession(sessionId){
    const key=sha(String(sessionId)),owner=owners.get(key);if(!owner)return;owner.active=false;
    for(const win of owner.windows.values()){win.closed=true;win.webContents.closed=true;win.webContents.emit('destroyed');win.emit('closed');}
    if(owner.busy)await owner.done;totalEditors-=owner.editors.size;owner.editors.clear();owners.delete(key);
    const target=path.resolve(owner.directory);if(path.dirname(target)!==root||!/^[a-f0-9]{64}$/.test(path.basename(target)))throw Error('Unexpected PDF session temporary path');const stat=fs.lstatSync(target);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('Unexpected PDF session temporary directory');fs.rmSync(target,{recursive:true,force:true});
  }
  async function close(){
    if(!active)return;active=false;for(const key of [...owners.keys()]){const owner=owners.get(key);owner.active=false;for(const win of owner.windows.values()){win.closed=true;win.webContents.closed=true;win.webContents.emit('destroyed');win.emit('closed');}if(owner.busy)await owner.done;await owner.native.disposeOcrWorker().catch(()=>{});}owners.clear();
    const current=fs.lstatSync(root);if(path.dirname(root)!==tempBase||!/^tvs-web-studio-[A-Za-z0-9]+$/.test(path.basename(root))||current.ino!==pin.ino||current.isSymbolicLink())throw Error('Unexpected PDF studio temporary directory');fs.rmSync(root,{recursive:true,force:true});
  }
  return Object.freeze({handle,close,closeSession});
}
module.exports=Object.freeze({createPdfStudio,renderPage,staticAsset});
