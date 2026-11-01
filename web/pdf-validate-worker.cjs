'use strict';
const {parentPort,workerData}=require('node:worker_threads');
const MAX=25*1024*1024;
async function validate(){
  const bytes=Buffer.from(workerData.bytes);if(!bytes.length||bytes.length>MAX)throw Error('Input limit');
  if(workerData.kind==='pdf'){
    const pdf=await require('pdf-lib').PDFDocument.load(bytes,{updateMetadata:false});if(!pdf.getPageCount()||pdf.getPageCount()>1000||pdf.context.enumerateIndirectObjects().length>100000)throw Error('PDF limit');
  }else if(workerData.kind==='tvspdf'){
    const zip=new (require('adm-zip'))(bytes),entries=zip.getEntries();if(!entries.length||entries.length>512)throw Error('Project entry limit');let total=0;
    for(const entry of entries){const size=entry.header.size;if(!Number.isSafeInteger(size)||size<0||(total+=size)>MAX||entry.isDirectory||!['manifest.json'].includes(entry.entryName)&&!/^sources\/\d{4}\.pdf$/.test(entry.entryName))throw Error('Project entry');
      const compressed=entry.getCompressedData(),content=entry.header.method===0?compressed:entry.header.method===8?require('node:zlib').inflateRawSync(compressed,{maxOutputLength:Math.max(1,size)}):null;
      if(!content||content.length!==size)throw Error('Project expanded size');
    }
  }else throw Error('Input kind');
}
validate().then(()=>parentPort.postMessage({ok:true})).catch(()=>parentPort.postMessage({ok:false}));
