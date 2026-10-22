'use strict';
const crypto=require('node:crypto');
function createSafeHtmlPdfRenderer({BrowserWindow,session,timeoutMs=30000,maxHtmlBytes=16*1024*1024}={}){
 if(typeof BrowserWindow!=='function'||!session?.fromPartition||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000||!Number.isSafeInteger(maxHtmlBytes)||maxHtmlBytes<1||maxHtmlBytes>32*1024*1024)throw Error('Некорректный сервис печати');
 return async function renderPdf(html,options={},assertCurrent=()=>{}){
  if(typeof assertCurrent!=='function')throw Error('Некорректная проверка контекста печати');assertCurrent();
  if(typeof html!=='string'||!html||Buffer.byteLength(html,'utf8')>maxHtmlBytes)throw Object.assign(Error('Некорректный размер печатной формы'),{code:'PRINT_INPUT'});
  if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>!['landscape','pageSize','preferCSSPageSize'].includes(key))||options.landscape!==undefined&&typeof options.landscape!=='boolean'||options.preferCSSPageSize!==undefined&&typeof options.preferCSSPageSize!=='boolean'||options.pageSize!==undefined&&options.pageSize!=='A4')throw Error('Некорректные параметры печати');
  const policy="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";
  const protectedHtml='<!doctype html><meta http-equiv="Content-Security-Policy" content="'+policy+'">'+html.replace(/^\s*<!doctype[^>]*>/i,'');
  const isolated=session.fromPartition('tvs-print-'+crypto.randomBytes(16).toString('hex'),{cache:false});
  let win,timer;
  try{
   isolated.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));isolated.setPermissionCheckHandler(()=>false);
   isolated.webRequest.onBeforeRequest({urls:['*://*/*','file://*/*']},(_details,callback)=>callback({cancel:true}));
   win=new BrowserWindow({show:false,webPreferences:{session:isolated,sandbox:true,contextIsolation:true,nodeIntegration:false,javascript:false,webSecurity:true,allowRunningInsecureContent:false,webviewTag:false}});
   win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());
   const work=(async()=>{
    await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(protectedHtml));
    assertCurrent();
    const bytes=Buffer.from(await win.webContents.printToPDF({printBackground:true,landscape:options.landscape??false,pageSize:'A4',preferCSSPageSize:options.preferCSSPageSize??true,margins:{top:0.4,bottom:0.4,left:0.3,right:0.3}}));
    assertCurrent();if(bytes.length<5||bytes.subarray(0,5).toString()!=='%PDF-')throw Error('Печать не вернула PDF');return bytes;
   })();
   return await Promise.race([work,new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error('Истекло время формирования PDF'),{code:'PRINT_TIMEOUT'})),timeoutMs);})]);
  }finally{clearTimeout(timer);if(win&&!win.isDestroyed())win.destroy();await Promise.resolve().then(()=>isolated.clearStorageData()).catch(()=>{});try{isolated.webRequest.onBeforeRequest(null);}catch{}}
 };
}
module.exports=Object.freeze({createSafeHtmlPdfRenderer});
