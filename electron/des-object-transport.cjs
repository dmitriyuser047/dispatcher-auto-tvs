'use strict';
// Credentials stay in main. Receipt candidates are delivered to its pinned verifier.
const http=require('node:http'),https=require('node:https'),net=require('node:net');
const MAX_BYTES=32*1024*1024,DEFAULT_TIMEOUT_MS=30000;
function fail(code,message){return Object.assign(Error(message),{code});}
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function normalizeConnection(input){
 if(!record(input))throw fail('DES_CONNECTION','Укажите подключение к центральному серверу');
 const suppliedHost=input.remoteHost??input.host,remoteHost=typeof suppliedHost==='string'?suppliedHost.trim():'',remotePort=Number(input.remotePort??input.port??3377),protocol=input.remoteProtocol??input.protocol??'https:',remoteProtocol=protocol==='http'||protocol==='https'?protocol+':':protocol,networkKey=input.networkKey??input.token;
 if(!remoteHost||remoteHost.length>253||/[\s/@?#\\]/.test(remoteHost)||!Number.isInteger(remotePort)||remotePort<1||remotePort>65535||!['https:','http:'].includes(remoteProtocol)||typeof networkKey!=='string'||networkKey.length<16||networkKey.length>4096||/[\s\x00-\x1f\x7f]/.test(networkKey))throw fail('DES_CONNECTION','Проверьте адрес, порт и персональный ключ сервера');
 const host=remoteHost.replace(/^\[|\]$/g,'');
 const privateHttp=host==='localhost'||host==='::1'||net.isIP(host)===4&&(/^127\./.test(host)||/^10\./.test(host)||/^192\.168\./.test(host)||/^172\.(1[6-9]|2\d|3[01])\./.test(host));
 if(remoteProtocol==='http:'&&!privateHttp)throw fail('DES_HTTPS_REQUIRED','Для подключения через интернет нужен HTTPS. HTTP разрешён только для локального адреса');
 if(host.includes(':')&&net.isIP(host)!==6)throw fail('DES_CONNECTION','Порт указывается отдельно от адреса сервера');
 const caPem=input.caPem;if(caPem!==undefined&&(typeof caPem!=='string'||Buffer.byteLength(caPem)>2*1024*1024||!caPem.includes('BEGIN CERTIFICATE')))throw fail('DES_CONNECTION','Некорректный сертификат центра');
 return {remoteHost:host,remotePort,remoteProtocol,networkKey,...(caPem?{caPem}:{})};
}
function receiptCandidate(result){const receipt=result?.receipt,signature=receipt?.signature;return record(receipt)&&receipt.kind==='receipt'&&record(signature)&&signature.algorithm==='Ed25519'&&['publicKey','keyId','value'].every(key=>typeof signature[key]==='string'&&signature[key]);}
function request(connection,input,{timeoutMs=DEFAULT_TIMEOUT_MS,maxBytes=MAX_BYTES}={}){
 const c=normalizeConnection(connection);
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>300000||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>MAX_BYTES)throw fail('DES_REQUEST','Некорректные пределы запроса обмена');
 let text;try{text=JSON.stringify(input);}catch{throw fail('DES_REQUEST','Пакет обмена не удалось подготовить');}if(typeof text!=='string')throw fail('DES_REQUEST','Не указан пакет обмена');
 if(Buffer.byteLength(text)>maxBytes)throw fail('DES_PACKAGE_LIMIT','Пакет обмена превышает допустимый размер');
 const safeMessage=value=>typeof value==='string'&&value?value.split(c.networkKey).join('[скрыто]').slice(0,2000):'Центр не подтвердил операцию обмена';
 return new Promise((resolve,reject)=>{
  let settled=false,req,deadline;const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(deadline);if(error)reject(error);else resolve(value);};
  const timeout=()=>{finish(fail('DES_TIMEOUT','Центр не ответил. Локальные данные сохранены; результат передачи нужно проверить'));req?.destroy();};
  deadline=setTimeout(timeout,timeoutMs);
  try{
   const transport=c.remoteProtocol==='https:'?https:http;
   req=transport.request({protocol:c.remoteProtocol,hostname:c.remoteHost,port:c.remotePort,path:'/api/des-object',method:'POST',...(c.caPem?{ca:c.caPem}:{}),rejectUnauthorized:true,headers:{Authorization:'Bearer '+c.networkKey,'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(text),'X-TVS-Writer-Schema':'6','User-Agent':'TVS-DES-Object/1'}},res=>{
    let size=0;const chunks=[];
    res.on('data',part=>{if(settled)return;size+=part.length;if(size>maxBytes){finish(fail('DES_PACKAGE_LIMIT','Ответ центра превышает допустимый размер'));res.destroy();}else chunks.push(part);});
    const incomplete=()=>finish(fail('DES_CONNECTION','Ответ центра получен не полностью'));
    res.on('error',incomplete);res.on('aborted',incomplete);res.on('end',()=>{
     if(settled)return;
     try{
      if(!res.complete)throw fail('DES_CONNECTION','Ответ центра получен не полностью');
      let result;try{result=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fail('DES_RESPONSE','Центр вернул неподдерживаемый ответ');}
      if(!record(result))throw fail('DES_RESPONSE','Центр вернул неподдерживаемый ответ');
      if(res.statusCode!==200||result.ok===false&&!receiptCandidate(result)){const code=typeof result.code==='string'&&/^[A-Z][A-Z0-9_]{1,99}$/.test(result.code)&&!result.code.includes(c.networkKey)?result.code:'DES_SERVER_REFUSED';throw fail(code,safeMessage(result.error||result.message));}
      // Signature and origin binding are verified by main's installation service.
      finish(null,result);
     }catch(error){finish(error.code?error:fail('DES_RESPONSE','Центр вернул неподдерживаемый ответ'));}
    });
   });
   req.setTimeout(timeoutMs,timeout);req.on('error',()=>finish(fail('DES_CONNECTION','Не удалось подключиться к центральному серверу')));req.end(text);
  }catch{finish(fail('DES_CONNECTION','Не удалось подключиться к центральному серверу'));req?.destroy();}
 });
}
module.exports=Object.freeze({normalizeConnection,request,MAX_BYTES,DEFAULT_TIMEOUT_MS});
