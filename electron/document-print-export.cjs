'use strict';
const crypto=require('node:crypto');
function fail(){throw Object.assign(Error('Печатный файл не совпадает с подтверждённой редакцией'),{code:'PRINT_ARTIFACT'});}
function verifiedBytes(result,request){
  if(!request||!['pdf','xlsx'].includes(request.format)||typeof request.archiveId!=='string'||!/^[a-f0-9]{64}$/.test(request.archiveId)||result?.ok!==true||result.archiveId!==request.archiveId||result.format!==request.format||typeof result.base64!=='string'||!result.base64||result.base64.length>90*1024*1024||result.base64.length%4)fail();
  const bytes=Buffer.from(result.base64,'base64');
  if(bytes.toString('base64')!==result.base64||bytes.length!==result.size||bytes.length>64*1024*1024||!/^[a-f0-9]{64}$/.test(result.sha256||'')||crypto.createHash('sha256').update(bytes).digest('hex')!==result.sha256)fail();
  if(request.format==='pdf'?bytes.subarray(0,5).toString()!=='%PDF-':bytes.length<4||bytes[0]!==0x50||bytes[1]!==0x4b||bytes[2]!==3||bytes[3]!==4)fail();
  return bytes;
}
module.exports=Object.freeze({verifiedBytes});
