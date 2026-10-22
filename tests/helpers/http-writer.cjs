'use strict';
// Explicit current-client fixtures use the actual authenticated HTTP handshake.
// Old/raw-client cases send their own headers and never call this helper.
const http=require('node:http');
function createWriterHelper({getHello=()=>require('../../assets/core/platform-compatibility.js').describe().hello,getSchemaVersion=()=>require('../../electron/storage-format.cjs').SCHEMA_VERSION}={}){
 const schemaWriterHeaders=()=>({'x-tvs-writer-schema':String(getSchemaVersion())});
 const fail=()=>Object.assign(Error('Current HTTP fixture could not negotiate a write proof'),{code:'FIXTURE_NEGOTIATION_FAILED'});
 async function writerHeaders({host='127.0.0.1',port,headers={},method='POST'}={}){
  if(method==='GET'||method==='HEAD')return {};
  if(typeof host!=='string'||!host||/[\r\n]/.test(host)||!Number.isSafeInteger(port)||port<1||port>65535)throw fail();
  // Carry the exact effective credential and Origin; never borrow a configured
  // global server client key or mint a proof for a different test account.
  const authentication={};for(const [name,value]of Object.entries(headers))if(['authorization','origin'].includes(name.toLowerCase()))authentication[name.toLowerCase()]=value;
  const raw=JSON.stringify(getHello());if(typeof raw!=='string'||Buffer.byteLength(raw)>32768)throw fail();
  const response=await new Promise((resolve,reject)=>{
   const request=http.request({host,port,path:'/api/negotiate',method:'POST',agent:false,headers:{...authentication,'Content-Type':'application/json','Content-Length':Buffer.byteLength(raw)}},result=>{
    const chunks=[];let size=0;result.on('data',part=>{size+=part.length;if(size>65536){result.destroy(fail());return;}chunks.push(part);});result.on('error',()=>reject(fail()));result.on('end',()=>{try{resolve({status:result.statusCode,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))});}catch{reject(fail());}});
   });request.setTimeout(10000,()=>request.destroy(fail()));request.on('error',()=>reject(fail()));request.end(raw);
  });
  // Authentication-negative cases still reach their actual target endpoint,
  // carrying their original invalid/missing credential and no fabricated proof.
  if(response.status===401||response.status===403)return schemaWriterHeaders();
  const ticket=response.body?.writeTicket;
  if(response.status!==200||response.body?.ok!==true||response.body?.compatibility?.writeCompatible!==true||typeof ticket!=='string'||!ticket||Buffer.byteLength(ticket)>4096||/[\r\n]/.test(ticket))throw fail();
  return {...schemaWriterHeaders(),'x-tvs-write-ticket':ticket};
 }
 return Object.freeze({writerHeaders,schemaWriterHeaders});
}
const defaults=createWriterHelper();
module.exports=Object.freeze({...defaults,createWriterHelper});
