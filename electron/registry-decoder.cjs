'use strict';
const path=require('node:path'),crypto=require('node:crypto');
const {Worker}=require('node:worker_threads');
const MAX_BYTES=25*1024*1024;
let active=0;
function fail(code,message){throw Object.assign(Error(message),{code});}

// Both clients use the same bounded, isolated Excel/PDF interpreter.
async function decodeRegistry(payload,{assertCurrent=()=>{}}={}){
  assertCurrent();
  if(!payload||typeof payload.name!=='string'||!payload.name||payload.name.length>240||/[<>:"/\\|?*\x00-\x1f]/.test(payload.name)||/[. ]$/.test(payload.name)||!/^.+\.(xlsx|xls|pdf)$/i.test(payload.name))fail('REGISTRY_FORMAT','Выберите Excel XLSX/XLS или PDF с корректным именем.');
  if(!(payload.bytes instanceof Uint8Array)||!payload.bytes.byteLength||payload.bytes.byteLength>MAX_BYTES)fail('REGISTRY_LIMIT','Размер реестра должен быть от 1 байта до 25 МБ.');
  if(active>=2)fail('REGISTRY_BUSY','Сейчас читаются другие реестры. Повторите загрузку немного позже.');
  const bytes=Buffer.from(payload.bytes),sha256=crypto.createHash('sha256').update(bytes).digest('hex');
  active++;
  try{return await new Promise((resolve,reject)=>{
    const worker=new Worker(path.resolve(__dirname,'../web/registry-import-worker.cjs'),{
      workerData:{name:payload.name,base64:bytes.toString('base64')},
      resourceLimits:{maxOldGenerationSizeMb:256,maxYoungGenerationSizeMb:32},
    });
    let done=false;
    const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);clearInterval(interval);void worker.terminate();error?reject(error):resolve(value);};
    const timer=setTimeout(()=>finish(Object.assign(Error('Чтение реестра превысило 45 секунд.'),{code:'REGISTRY_TIMEOUT'})),45000);
    const interval=setInterval(()=>{try{assertCurrent();}catch(error){finish(error);}},100);
    worker.once('error',()=>finish(Object.assign(Error('Не удалось прочитать реестр в допустимых пределах.'),{code:'REGISTRY_DECODE'})));
    worker.once('exit',()=>{if(!done)finish(Object.assign(Error('Чтение реестра завершилось без результата.'),{code:'REGISTRY_DECODE'}));});
    worker.once('message',result=>{try{
      assertCurrent();
      if(!result?.ok)fail(result?.code||'REGISTRY_DECODE',result?.error||'Не удалось прочитать реестр.');
      if(!Array.isArray(result.tables)||Buffer.byteLength(JSON.stringify(result.tables))>24*1024*1024)fail('REGISTRY_LIMIT','Таблица превышает допустимый размер.');
      finish(null,{ok:true,tables:result.tables,sha256,bytes:bytes.length});
    }catch(error){finish(error);}});
  });}finally{active--;}
}
module.exports={decodeRegistry,MAX_BYTES};
