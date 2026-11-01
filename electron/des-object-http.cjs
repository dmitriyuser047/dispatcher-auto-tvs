'use strict';
// File and HTTP delivery use the same installation keys, registrations and ledger.
const fs=require('node:fs'),path=require('node:path');
const MAX_BODY=32*1024*1024,BODY_TIMEOUT_MS=30000;
const ACTION_FIELDS=Object.freeze({exportSnapshot:['action','installationId'],previewImport:['action','bundle'],applyImport:['action','bundle','reviewFingerprint','reason']});
function fail(code,message,status=400){return Object.assign(Error(message),{code,status});}
function record(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function text(value,name,max=1000){if(typeof value!=='string'||!value.trim()||value.length>max||value.includes('\0'))throw fail('DES_OBJECT_INPUT','Некорректное поле «'+name+'»');return value;}
function readBody(req,timeoutMs){
 return new Promise((resolve,reject)=>{
  let total=0,finished=false;const chunks=[];
  const cleanup=()=>{clearTimeout(timer);for(const [name,handler]of [['data',chunk],['end',end],['aborted',aborted],['error',failed],['close',closed]])req.removeListener(name,handler);};
  const failed=error=>{if(finished)return;finished=true;cleanup();req.once('error',()=>{});reject(error);};
  const aborted=()=>failed(fail('DES_OBJECT_ABORTED','Соединение прервано до получения пакета',400));
  const closed=()=>{if(!req.complete)aborted();};
  const chunk=bytes=>{total+=bytes.length;if(total>MAX_BODY){failed(fail('DES_OBJECT_LIMIT','Пакет обмена превышает 32 МиБ',413));req.resume();}else chunks.push(bytes);};
  const end=()=>{if(finished)return;finished=true;cleanup();try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(fail('DES_OBJECT_JSON','Некорректный JSON пакета'));}};
  const timer=setTimeout(()=>{failed(fail('DES_OBJECT_TIMEOUT','Время получения пакета истекло',408));req.resume();},timeoutMs);
  req.on('data',chunk);req.on('end',end);req.on('aborted',aborted);req.on('error',failed);req.on('close',closed);
 });
}
async function finishBoundedUpload(req){
 if(req.complete||req.destroyed)return;
 await new Promise(resolve=>{let timer;const done=()=>{clearTimeout(timer);for(const name of ['end','close','error'])req.removeListener(name,done);resolve();};for(const name of ['end','close','error'])req.once(name,done);timer=setTimeout(done,100);req.resume();});
}
function send(res,status,value,headers={}){
 if(res.destroyed||res.headersSent)return;
 const body=JSON.stringify(value);if(Buffer.byteLength(body)>MAX_BODY)throw fail('DES_OBJECT_LIMIT','Ответ обмена превышает 32 МиБ; используйте файловую передачу',413);
 res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-TVS-Writer-Schema':'6',...headers});res.end(body);
}
function principalFingerprint(principal){return JSON.stringify([principal.id,principal.name,principal.role,principal.policyStamp,!!principal.legacy]);}
function sanitizedPreview(value,bundle){
 if(!record(value)||value.kind!=='changes')throw fail('DES_OBJECT_RESPONSE','Не получена проверка изменений объекта',500);
 const result={kind:'changes',scope:{org:bundle.scope.org,site:bundle.scope.site},canApply:value.canApply===true};
 for(const name of ['reviewFingerprint','duplicate','changes','conflicts','issues','omissions','counts'])if(Object.hasOwn(value,name))result[name]=value[name];
 return result;
}
function verifiedOutput(service,value,kind){
 const bundle=service.decode(value),installation=service.status().installation;
 if(bundle.kind!==kind||bundle.signature?.keyId!==installation.keyId||bundle.signature?.publicKey!==installation.publicKey||bundle.source.installationId!==installation.installationId)throw fail('DES_OBJECT_RESPONSE','Подпись ответа центра не подтверждена',500);
 return bundle;
}
function receiptResponse(service,value,bundle){
 if(!record(value)||!value.receipt)throw Object.assign(fail('DES_OBJECT_RESPONSE','Центр не подтвердил приём пакета',503),value?.ok===false?{unknown:true,definitive:false}:{});
 const receipt=verifiedOutput(service,value.receipt,'receipt');
 if(receipt.payload.forBundleId!==bundle.bundleId||receipt.targetDatabaseToken!==bundle.source.databaseToken||receipt.scope.org!==bundle.scope.org||receipt.scope.site!==bundle.scope.site)throw fail('DES_OBJECT_RESPONSE','Квитанция не относится к исходному пакету',500);
 const outcomes=receipt.payload.outcomes;if(!Array.isArray(outcomes))throw fail('DES_OBJECT_RESPONSE','Квитанция не содержит результатов операций',500);const accepted=outcomes.filter(outcome=>outcome.status==='accepted').length,partial=value.partial===true||value.ok===false||accepted!==outcomes.length;const result={ok:true,receipt,accepted,complete:!partial};if(partial){result.partial=true;result.pending=true;result.message='Часть операций ожидает завершения. Квитанция отражает подтверждённые результаты.';}else if(value.pending===true)result.pending=true;if(value.replayed===true)result.replayed=true;if(value.duplicate===true)result.duplicate=true;
 if(record(value.operationReceipt)){const selected={};for(const key of ['id','digest','status'])if(typeof value.operationReceipt[key]==='string')selected[key]=value.operationReceipt[key];result.operationReceipt=selected;}
 return result;
}
function errorStatus(error){
 if(error.unknown===true||error.definitive===false||error.code==='DB_BUSY')return 503;
 if(error.status===401||error.code==='ACCESS_REVOKED')return 401;
 if(error.code==='ACCESS_CHANGED'||error.code==='ACCESS_DENIED'||/^ACCESS_/.test(error.code||'')||['DES_OBJECT_DEVICE','DES_OBJECT_SIGNATURE','DES_OBJECT_KEY','DES_OBJECT_SCOPE','DES_OBJECT_ACTOR'].includes(error.code))return 403;
 if(['DES_OBJECT_CONFLICT','DES_OBJECT_REVIEW','DES_OBJECT_REUSED','DES_OBJECT_PARTIAL_REPLAY','DES_OBJECT_PREPARED_CONFLICT','DES_OBJECT_TARGET'].includes(error.code))return 409;
 return Number.isInteger(error.status)&&error.status>=400&&error.status<=599?error.status:400;
}
function createDesObjectHttp({dataDir,bodyTimeoutMs=BODY_TIMEOUT_MS}={}){
 if(typeof dataDir!=='string'||!path.isAbsolute(dataDir))throw fail('DES_OBJECT_PATH','Не подтверждена серверная база',500);
 const canonicalDataDir=fs.realpathSync.native(dataDir);if(!fs.lstatSync(canonicalDataDir).isDirectory())throw fail('DES_OBJECT_PATH','Не подтверждена серверная база',500);
 if(!Number.isInteger(bodyTimeoutMs)||bodyTimeoutMs<1||bodyTimeoutMs>BODY_TIMEOUT_MS)throw fail('DES_OBJECT_TIMEOUT','Некорректный лимит времени сервера',500);
 const directory=canonicalDataDir+'-des-object-exchange';let service=null,closed=false;
 const getService=()=>{if(closed)throw fail('SERVER_STOPPED','Сервер обмена остановлен',503);return service??=require('./des-object-service.cjs').createDesObjectService({directory});};
 async function handle(req,res,context){
  let captured=null,applied=false;
  try{
   if(closed)throw fail('SERVER_STOPPED','Сервер обмена остановлен',503);
   if(!context?.principal||typeof context.assertCurrent!=='function')throw fail('ACCESS_DENIED','Не подтверждена серверная учётная запись',403);
   const access=require('./access-context.cjs');captured=access.normalizePrincipal(context.principal);
   const assertCurrent=()=>{const supplied=context.assertCurrent();if(!supplied)throw fail('ACCESS_REVOKED','Ключ доступа отозван',401);const principal=access.normalizePrincipal(supplied);if(principalFingerprint(principal)!==principalFingerprint(captured))throw fail('ACCESS_CHANGED','Учётная запись или права изменились во время получения пакета',403);return principal;};
   assertCurrent();
   if(req.method!=='POST'){send(res,405,{ok:false,code:'DES_OBJECT_METHOD',error:'Для обмена требуется POST'},{Allow:'POST'});req.resume();return;}
   if(req.headers['x-tvs-writer-schema']!=='6')throw fail('WRITER_SCHEMA_REQUIRED','Для обмена нужна схема клиента 6',428);
   if(!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type']||'')))throw fail('DES_OBJECT_CONTENT_TYPE','Для обмена требуется JSON',415);
   if(req.headers['content-encoding']&&req.headers['content-encoding']!=='identity')throw fail('DES_OBJECT_CONTENT_TYPE','Сжатое тело пакета не поддерживается',415);
   const length=req.headers['content-length'];if(length!==undefined&&(!/^\d+$/.test(String(length))||!Number.isSafeInteger(Number(length))||Number(length)>MAX_BODY))throw fail('DES_OBJECT_LIMIT','Пакет обмена превышает 32 МиБ',413);
   const payload=await readBody(req,bodyTimeoutMs),principal=assertCurrent();
   if(!record(payload)||typeof payload.action!=='string'||!Object.hasOwn(ACTION_FIELDS,payload.action))throw fail('DES_OBJECT_ACTION','Неподдерживаемое действие обмена');
   if(Object.keys(payload).some(name=>!ACTION_FIELDS[payload.action].includes(name)))throw fail('DES_OBJECT_INPUT','Пакет содержит неподдерживаемые параметры');
   if(payload.action==='exportSnapshot')text(payload.installationId,'Установка',200);
   else{if(!record(payload.bundle)||payload.bundle.kind!=='changes')throw fail('DES_OBJECT_KIND','Через сервер принимаются только подписанные изменения объекта');if(payload.action==='applyImport'){text(payload.reviewFingerprint,'Подтверждение проверки',256);text(payload.reason,'Основание',2000);}}
   const service=getService();assertCurrent();const options={dataDir:canonicalDataDir,principal,getPrincipal:assertCurrent,assertCurrent};let result;
   if(payload.action==='exportSnapshot'){
    const bundle=verifiedOutput(service,service.exportSnapshot({...options,installationId:payload.installationId}),'snapshot');if(bundle.payload.recipientInstallationId!==payload.installationId)throw fail('DES_OBJECT_RESPONSE','Снимок адресован другой установке',500);result={ok:true,bundle};
   }else{
    const bundle=service.decode(payload.bundle);if(bundle.kind!=='changes')throw fail('DES_OBJECT_KIND','Через сервер принимаются только изменения объекта');
    if(payload.action==='previewImport')result={ok:true,...sanitizedPreview(service.previewImport({...options,bundle}),bundle)};
    else{const value=service.applyImport({...options,bundle,reviewFingerprint:payload.reviewFingerprint,reason:payload.reason});applied=true;result=receiptResponse(service,value,bundle);}
   }
   try{assertCurrent();}catch(error){if(applied)throw Object.assign(fail('STORAGE_ACK_STALE','Результат приёма пакета не подтверждён. Повторите проверку исходного пакета.',503),{unknown:true,definitive:false,causeCode:error.code});throw error;}
   send(res,200,result);
  }catch(error){
   const status=errorStatus(error),unknown=error.unknown===true||error.definitive===false;
   const publicError=captured?require('./access-control.js').publicError(error,captured):error;
   const message=unknown?'Результат приёма пакета не подтверждён. Повторите проверку исходного пакета.':/^DES_OBJECT_|^ACCESS_|^WRITER_|^SERVER_|^DB_BUSY$/.test(error.code||'')?publicError.message:'Не удалось выполнить обмен данными объекта';
   if([408,413].includes(status)){if(status===413)await finishBoundedUpload(req);res.setHeader('Connection','close');req.resume();}
   send(res,status,{ok:false,code:error.code||'DES_OBJECT_FAILED',error:message,...(unknown?{unknown:true,definitive:false}:{}),...(unknown&&typeof error.causeCode==='string'?{causeCode:error.causeCode}:{})});
  }
 }
 return Object.freeze({handle,close(){if(closed)return;closed=true;service?.close();service=null;},directory,dataDir:canonicalDataDir});
}
module.exports=Object.freeze({createDesObjectHttp,MAX_BODY,BODY_TIMEOUT_MS});
