'use strict';
const {parentPort,workerData}=require('node:worker_threads');
async function read(){
  const runtime=require('../electron/pdfjs-runtime.cjs'),pdfjs=await runtime.loadPdfJs(),bytes=Buffer.from(workerData.base64,'base64');
  let task;try{
    task=pdfjs.getDocument({...runtime.pdfDocumentOptions(),data:new Uint8Array(bytes),disableFontFace:true,maxImageSize:30*1024*1024});const pdf=await task.promise;
    if(!pdf.numPages||pdf.numPages>1000)throw Object.assign(Error('Page limit'),{code:'WEB_IMPORT_LIMIT'});
    const items=[];let textBytes=0;
    for(let pageNumber=1;pageNumber<=pdf.numPages;pageNumber++){
      const page=await pdf.getPage(pageNumber),content=await page.getTextContent();
      for(const item of content.items){if(typeof item.str!=='string'||!item.str.trim())continue;
        textBytes+=Buffer.byteLength(item.str);if(items.length>=250000||textBytes>16*1024*1024)throw Object.assign(Error('Text limit'),{code:'WEB_IMPORT_LIMIT'});
        const round=value=>Math.round((Number.isFinite(value)?value:0)*10)/10;
        items.push({str:item.str,x:round(item.transform?.[4]),y:round(item.transform?.[5]),...(workerData.kind==='svodka'?{w:round(item.width),h:round(item.height)}:{}),page:pageNumber});
      }page.cleanup();
    }return items;
  }finally{if(task)await task.destroy().catch(()=>{});}
}
read().then(items=>parentPort.postMessage({ok:true,items})).catch(error=>parentPort.postMessage({ok:false,code:error.code||'WEB_IMPORT_PDF'}));
