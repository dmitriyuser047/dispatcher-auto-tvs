'use strict';

// Only a verified, sealed print model reaches Chromium. This window has no
// preload, scripts, filesystem access or remote resources.
const crypto=require('node:crypto');
function createDocumentPrintRenderer({BrowserWindow,session,engine=()=>require('../assets/core/document-print.js'),timeoutMs=30000}={}){
  if(typeof BrowserWindow!=='function'||!session?.fromPartition||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw Error('Некорректный сервис печати');
  return async function renderPdf(snapshot){
    const print=engine();print.verify(snapshot);
    const rendered=print.render(snapshot),html=rendered.html;
    if(typeof html!=='string'||!html||Buffer.byteLength(html,'utf8')>16*1024*1024)throw Error('Некорректный размер печатной формы');
    const policy="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; script-src 'none'; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";
    const protectedHtml=html.replace(/<head(?:\s[^>]*)?>/i,match=>match+'<meta http-equiv="Content-Security-Policy" content="'+policy+'">');
    if(protectedHtml===html)throw Error('У печатной формы отсутствует заголовок');
    const partition='tvs-print-'+crypto.randomBytes(16).toString('hex'),isolated=session.fromPartition(partition,{cache:false});
    isolated.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
    isolated.setPermissionCheckHandler(()=>false);
    isolated.webRequest.onBeforeRequest({urls:['*://*/*','file://*/*']},(_details,callback)=>callback({cancel:true}));
    const win=new BrowserWindow({show:false,webPreferences:{session:isolated,sandbox:true,contextIsolation:true,nodeIntegration:false,javascript:false,webSecurity:true,allowRunningInsecureContent:false,webviewTag:false}});
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    win.webContents.on('will-navigate',event=>event.preventDefault());
    let timer;
    try{
      const task=(async()=>{
        await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(protectedHtml));
        const bytes=await win.webContents.printToPDF({printBackground:true,landscape:false,pageSize:'A4',preferCSSPageSize:true,margins:{top:0.4,bottom:0.4,left:0.3,right:0.3}});
        const result=Buffer.from(bytes);
        if(result.length<5||result.subarray(0,5).toString()!=='%PDF-')throw Error('Печать не вернула PDF');
        return result;
      })();
      return await Promise.race([task,new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error('Истекло время формирования PDF'),{code:'PRINT_TIMEOUT'})),timeoutMs);})]);
    }finally{
      clearTimeout(timer);
      if(!win.isDestroyed())win.destroy();
      await isolated.clearStorageData().catch(()=>{});
      isolated.webRequest.onBeforeRequest(null);
    }
  };
}
module.exports=Object.freeze({createDocumentPrintRenderer});
