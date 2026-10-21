'use strict';
// This is a private client journal, never a working-database directory.
const nativeFs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os');
const contracts=require('../assets/core/platform-contracts.js');
const schema=require('../assets/core/platform-schema.js');
const kernel=require('../assets/core/platform-kernel.js');
const FORMAT='tvs-command-outbox',VERSION=1,OWNER='.command-outbox-owner.json',LOCK='.command-outbox.lock',RECOVERY_LOCK=LOCK+'.recovery';
const HEX=/^[a-f0-9]{64}$/,ID=/^[a-zA-Z0-9._:-]{1,200}$/,DIGEST=/^sha256:[a-f0-9]{64}$/;
const STATES=new Set(['pending','unknown','conflict','rejected','committed']);
const held=new Set();
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
function fail(code,message){const error=new Error(message);error.code=code;throw error;}
function createCommandOutbox(configuration={}){
  const fs=configuration.fileSystem||nativeFs;
  const limit=(name,fallback,max)=>{const value=configuration[name]??fallback;if(!Number.isSafeInteger(value)||value<1||value>max)fail('OUTBOX_CONFIGURATION','Некорректный предел локальной очереди');return value;};
  const maxEntries=limit('maxEntries',64,4096),maxPayloadBytes=limit('maxPayloadBytes',8*1024*1024,512*1024*1024),maxTotalBytes=limit('maxTotalBytes',32*1024*1024,2*1024*1024*1024);
  const maxFileBytes=maxPayloadBytes*2+65536;
  const clock=configuration.now||(()=>new Date().toISOString());
  const supplied=configuration.rootDir;
  if(typeof supplied!=='string'||!path.isAbsolute(supplied)||supplied.includes('\0')||/^[\\/]{2}/.test(supplied))fail('OUTBOX_PATH','Нужен абсолютный локальный каталог очереди');
  const root=path.resolve(supplied),rootKey=process.platform==='win32'?root.toLowerCase():root;
  let ownerId;
  const recovery={promoted:0,cleaned:0};
  const stat=file=>{try{return fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}};
  function directories(){
    const parsed=path.parse(root);let current=parsed.root;
    for(const component of root.slice(parsed.root.length).split(path.sep).filter(Boolean)){
      current=path.join(current,component);const info=stat(current);
      if(info&&(!info.isDirectory()||info.isSymbolicLink()))fail('OUTBOX_PATH','Каталог очереди проходит через ссылку или обычный файл');
    }
  }
  function local(name){
    if(typeof name!=='string'||name!==path.basename(name)||name.includes('\0'))fail('OUTBOX_PATH','Недопустимое имя файла очереди');
    const file=path.join(root,name);if(path.dirname(file)!==root)fail('OUTBOX_PATH','Файл очереди вне выделенного каталога');return file;
  }
  function regular(file,max=maxFileBytes){
    const info=stat(file);if(!info)return null;
    if(!info.isFile()||info.isSymbolicLink()||info.nlink>1||info.size>max)fail('OUTBOX_FILE','Повреждён или подменён файл локальной очереди');
    return info;
  }
  function safeJson(value){
    try{contracts.validateSections({appMeta:[value]},schema.sections);return kernel.stableSerialize(value);}
    catch{fail('OUTBOX_INVALID_JSON','В очереди допустимы только безопасные данные JSON');}
  }
  function readJson(file,max){
    if(!regular(file,max))return null;
    let value;try{value=JSON.parse(fs.readFileSync(file,'utf8'));}catch{fail('OUTBOX_CORRUPT','Не удалось прочитать локальную очередь');}
    safeJson(value);return value;
  }
  function now(){const value=clock();if(typeof value!=='string'||value.length>40||!Number.isFinite(Date.parse(value)))fail('OUTBOX_CLOCK','Некорректное время локальной очереди');return value;}
  function scopeValue(scope){if(typeof scope!=='string'||!HEX.test(scope))fail('OUTBOX_SCOPE','Не подтверждена привязка локальной очереди');return scope;}
  function identifier(id){if(typeof id!=='string'||!ID.test(id))fail('OUTBOX_OPERATION','Некорректный ID локальной операции');return id;}
  const nameFor=(scope,id)=>hash(scope+'\0'+id)+'.json';
  function syncDirectory(){
    let fd;
    try{fd=fs.openSync(root,'r');fs.fsyncSync(fd);}
    catch(error){if(!['EINVAL','EPERM','EISDIR','EBADF','ENOTSUP','EACCES'].includes(error.code))throw error;}
    finally{if(fd!==undefined)fs.closeSync(fd);}
  }
  function assertRoot(){
    directories();const info=stat(root);
    if(!info||!info.isDirectory()||info.isSymbolicLink())fail('OUTBOX_PATH','Каталог локальной очереди недоступен');
    const owner=readJson(local(OWNER),4096);
    if(!owner||owner.format!==FORMAT||owner.version!==VERSION||typeof owner.ownerId!=='string'||!/^[a-f0-9]{32}$/.test(owner.ownerId)||ownerId&&owner.ownerId!==ownerId)
      fail('OUTBOX_OWNER','Каталог очереди не принадлежит этому журналу');
    ownerId=owner.ownerId;
  }
  function initialize(){
    directories();
    if(!stat(root)){fs.mkdirSync(root,{mode:0o700,recursive:true});syncDirectory();}
    const ownerFile=local(OWNER);
    if(!stat(ownerFile)){
      if(fs.readdirSync(root).length)fail('OUTBOX_OWNER','Нельзя использовать непустой посторонний каталог для очереди');
      const contents=JSON.stringify({format:FORMAT,version:VERSION,ownerId:crypto.randomBytes(16).toString('hex')});
      let fd;
      try{fd=fs.openSync(ownerFile,'wx',0o600);fs.writeFileSync(fd,contents,'utf8');fs.fsyncSync(fd);}
      catch(error){if(error.code!=='EEXIST')throw error;}
      finally{if(fd!==undefined)fs.closeSync(fd);}
      syncDirectory();
    }
    assertRoot();
  }
  function locked(action){
    assertRoot();if(held.has(rootKey))fail('OUTBOX_BUSY','Локальная очередь уже занята');
    const file=local(LOCK),recoveryFile=local(RECOVERY_LOCK),nonce=crypto.randomBytes(16).toString('hex');let fd,recoveryFd;
    if(stat(recoveryFile))fail('OUTBOX_BUSY','Проверяется аварийная блокировка локальной очереди');
    const claim=()=>{
      fd=fs.openSync(file,'wx',0o600);
      try{fs.writeFileSync(fd,JSON.stringify({ownerId,pid:process.pid,host:os.hostname(),nonce}),'utf8');fs.fsyncSync(fd);}
      catch(error){fs.closeSync(fd);fd=undefined;try{fs.unlinkSync(file);}catch{}throw error;}
    };
    try{claim();}
    catch(error){
      if(fd!==undefined){fs.closeSync(fd);try{fs.unlinkSync(file);}catch{}throw error;}
      if(error.code!=='EEXIST')throw error;
      const previous=readJson(file,4096);
      if(!previous||previous.ownerId!==ownerId||previous.host!==os.hostname()||!Number.isSafeInteger(previous.pid)||previous.pid<=0||typeof previous.nonce!=='string')
        fail('OUTBOX_BUSY','Неизвестная блокировка локальной очереди');
      try{process.kill(previous.pid,0);fail('OUTBOX_BUSY','Локальная очередь открыта другим процессом');}
      catch(dead){if(dead.code!=='ESRCH')throw dead;}
      try{
        try{recoveryFd=fs.openSync(recoveryFile,'wx',0o600);}
        catch(recoveryError){if(recoveryError.code==='EEXIST')fail('OUTBOX_BUSY','Другой процесс восстанавливает локальную очередь');throw recoveryError;}
        const checked=readJson(file,4096);if(checked?.nonce!==previous.nonce)fail('OUTBOX_BUSY','Владелец очереди изменился');
        fs.unlinkSync(file);claim();
      }finally{if(recoveryFd!==undefined){fs.closeSync(recoveryFd);fs.unlinkSync(recoveryFile);}}
    }
    if(stat(recoveryFile)){if(fd!==undefined)fs.closeSync(fd);const current=readJson(file,4096);if(current?.nonce===nonce)fs.unlinkSync(file);fail('OUTBOX_BUSY','Проверяется аварийная блокировка локальной очереди');}
    held.add(rootKey);
    try{return action();}
    finally{
      held.delete(rootKey);if(fd!==undefined)fs.closeSync(fd);
      const current=readJson(file,4096);if(current?.nonce===nonce)fs.unlinkSync(file);
    }
  }
  function parsePayload(input){
    let payload=input;
    if(typeof input==='string'){
      if(Buffer.byteLength(input)>maxPayloadBytes)fail('OUTBOX_PAYLOAD_LIMIT','Операция превышает предел локальной очереди');
      try{payload=JSON.parse(input);}catch{fail('OUTBOX_INVALID_JSON','Не удалось разобрать запрос сохранения');}
    }
    const canonical=safeJson(payload);
    // Runtime validation happens before JSON.stringify can invoke user code.
    // Preserve object key order: legacy audit/closed-period guards compare
    // JSON projections byte-for-byte, including nested historical row keys.
    const json=JSON.stringify(payload);
    if(Buffer.byteLength(json)>maxPayloadBytes)fail('OUTBOX_PAYLOAD_LIMIT','Операция превышает предел локальной очереди');
    const command=Object.hasOwn(payload,'command');
    const allowed=command?['protocolVersion','base','command','databaseToken','operation']:['base','sections','databaseToken','operation'];
    if(Object.keys(payload).some(key=>!allowed.includes(key)))fail('OUTBOX_PAYLOAD','Неожиданные поля запроса сохранения');
    let parsed;try{parsed=command?contracts.parseCommandEnvelope(payload,schema.sections):contracts.parseSectionWrite(payload,schema.sections);}catch{fail('OUTBOX_PAYLOAD','Некорректный запрос сохранения в очереди');}
    if(!parsed.operation||typeof parsed.databaseToken!=='string'||!parsed.databaseToken)fail('OUTBOX_PROTOCOL','Нужны ID операции и идентификатор базы');
    const sections=(command?require('../assets/core/platform-commands.js').footprint(parsed.command):Object.keys(parsed.sections)).sort();
    if(!sections.length||sections.some(section=>!Object.hasOwn(parsed.base,section)))fail('OUTBOX_PAYLOAD','Нужны исходные версии всех изменённых разделов');
    const requestDigest=kernel.requestDigest(parsed);
    if(parsed.operation.digest&&parsed.operation.digest!==requestDigest)fail('OUTBOX_DIGEST','Отпечаток не соответствует запросу');
    return {payload:JSON.parse(json),json,id:parsed.operation.id,sections,requestDigest,bodyHash:hash(canonical)};
  }
  function recordHash(record){const copy={...record};delete copy.checksum;return hash(safeJson(copy));}
  function validateRecord(record,name){
    if(!record||record.format!==FORMAT||record.version!==VERSION||record.ownerId!==ownerId||typeof record.scope!=='string'||!HEX.test(record.scope)||typeof record.id!=='string'||!ID.test(record.id)||!STATES.has(record.status)
      ||!HEX.test(record.bodyHash)||!DIGEST.test(record.requestDigest)||typeof record.checksum!=='string'||recordHash(record)!==record.checksum
      ||!Number.isSafeInteger(record.revision)||record.revision<1||!Number.isSafeInteger(record.attempts)||record.attempts<1
      ||!Array.isArray(record.sections)||record.sections.some(section=>!schema.sections.includes(section))||new Set(record.sections).size!==record.sections.length
      ||typeof record.createdAt!=='string'||!Number.isFinite(Date.parse(record.createdAt))||typeof record.updatedAt!=='string'||!Number.isFinite(Date.parse(record.updatedAt)))
      fail('OUTBOX_CORRUPT','Повреждена запись локальной очереди');
    if(name&&nameFor(record.scope,record.id)!==name)fail('OUTBOX_CORRUPT','Нарушена привязка файла локальной очереди');
    if(record.status==='committed'){
      if(record.payloadJson!==null||!validReceipt(record,record.receipt))fail('OUTBOX_CORRUPT','Повреждена сохранённая квитанция');
    }else{
      if(typeof record.payloadJson!=='string')fail('OUTBOX_CORRUPT','В очереди отсутствует запрос сохранения');
      const parsed=parsePayload(record.payloadJson);
      // Earlier valid records retained the caller's key order in metadata.
      if(parsed.id!==record.id||parsed.bodyHash!==record.bodyHash||parsed.requestDigest!==record.requestDigest||JSON.stringify(parsed.sections)!==JSON.stringify(record.sections.slice().sort()))
        fail('OUTBOX_CORRUPT','Изменился сохранённый запрос');
    }
    return record;
  }
  function validReceipt(record,receipt){return receipt&&receipt.id===record.id&&['committed','replayed'].includes(receipt.status)&&(!Object.hasOwn(receipt,'digest')||receipt.digest===record.requestDigest);}
  function readRecord(name){const value=readJson(local(name),maxFileBytes);return value?validateRecord(value,name):null;}
  function inventory(){
    const entries=[];
    for(const name of fs.readdirSync(root)){
      if(name===OWNER||name===LOCK||name===RECOVERY_LOCK||partPattern().test(name))continue;
      if(!/^[a-f0-9]{64}\.json$/.test(name))fail('OUTBOX_FILE','В каталоге очереди найден посторонний файл');
      const record=readRecord(name);entries.push({name,record,bytes:regular(local(name)).size});
    }return entries;
  }
  const partPattern=()=>new RegExp('^([a-f0-9]{64})\\.'+ownerId+'\\.([a-f0-9]{32})\\.part$');
  function recover(){
    const parts=[];
    for(const name of fs.readdirSync(root)){
      const match=partPattern().exec(name);if(!match)continue;
      regular(local(name));
      let record;
      try{record=validateRecord(readJson(local(name),maxFileBytes),match[1]+'.json');}
      catch(error){if(!['OUTBOX_CORRUPT','OUTBOX_INVALID_JSON','OUTBOX_PAYLOAD','OUTBOX_DIGEST','OUTBOX_PROTOCOL'].includes(error.code))throw error;fs.unlinkSync(local(name));recovery.cleaned++;continue;}
      parts.push({name,final:match[1]+'.json',record});
    }
    parts.sort((a,b)=>a.record.revision-b.record.revision);
    for(const part of parts){
      const current=readRecord(part.final);
      if(current&&current.revision>=part.record.revision){
        if(current.revision===part.record.revision&&current.checksum!==part.record.checksum)fail('OUTBOX_CORRUPT','Противоречивые версии локальной операции');
        fs.unlinkSync(local(part.name));recovery.cleaned++;continue;
      }
      if(current&&part.record.previousChecksum!==current.checksum)fail('OUTBOX_CORRUPT','Нарушена последовательность записи очереди');
      fs.renameSync(local(part.name),local(part.final));syncDirectory();recovery.promoted++;
    }
  }
  function metadata(record){return {id:record.id,status:record.status,sections:record.sections.slice().sort(),createdAt:record.createdAt,updatedAt:record.updatedAt,
    attempts:record.attempts,...(record.code?{code:record.code}:{})};}
  function writeRecord(record,previous){
    record.revision=(previous?.revision||0)+1;record.previousChecksum=previous?.checksum||null;record.checksum=recordHash(record);
    const text=safeJson(record),name=nameFor(record.scope,record.id),part=name.slice(0,-5)+'.'+ownerId+'.'+crypto.randomBytes(16).toString('hex')+'.part';
    regular(local(name));let fd;
    try{fd=fs.openSync(local(part),'wx',0o600);fs.writeFileSync(fd,text,'utf8');fs.fsyncSync(fd);}
    finally{if(fd!==undefined)fs.closeSync(fd);}
    fs.renameSync(local(part),local(name));syncDirectory();return record;
  }
  function fit(record,previous){
    const anticipated={...record,revision:(previous?.revision||0)+1,previousChecksum:previous?.checksum||null};anticipated.checksum=recordHash(anticipated);
    const bytes=Buffer.byteLength(safeJson(anticipated)),items=inventory(),replaced=nameFor(record.scope,record.id);
    let count=items.length+(previous?0:1),total=items.reduce((sum,item)=>sum+item.bytes,0)-(items.find(item=>item.name===replaced)?.bytes||0)+bytes;
    const removable=items.filter(item=>item.record.status==='committed'&&item.name!==replaced).sort((a,b)=>a.record.updatedAt.localeCompare(b.record.updatedAt));
    const prune=[];for(const item of removable){if(count<=maxEntries&&total<=maxTotalBytes)break;prune.push(item);count--;total-=item.bytes;}
    if(count>maxEntries||total>maxTotalBytes)fail('OUTBOX_FULL','Локальная очередь заполнена. Разберите ожидающие операции; данные не удалены');
    prune.forEach(item=>fs.unlinkSync(local(item.name)));if(prune.length)syncDirectory();return prune.length;
  }
  function stage(scope,input,options={}){
    scopeValue(scope);if(options.supportsOperations!==true)fail('OUTBOX_LEGACY','Хранилище не поддерживает квитанции операций');
    const parsed=parsePayload(input);
    return locked(()=>{
      recover();const name=nameFor(scope,parsed.id),previous=readRecord(name);
      if(previous&&previous.bodyHash!==parsed.bodyHash&&!['conflict','rejected'].includes(previous.status))fail('OUTBOX_OPERATION_REUSED','Этот ID связан с другим ожидающим запросом');
      if(previous?.status==='committed')return metadata(previous);
      const keepExact=previous?.bodyHash===parsed.bodyHash&&['pending','unknown'].includes(previous.status);
      const payloadJson=keepExact?previous.payloadJson:parsed.json;
      const record={format:FORMAT,version:VERSION,ownerId,scope,id:parsed.id,bodyHash:parsed.bodyHash,requestDigest:parsed.requestDigest,payloadJson,
        sections:parsed.sections,status:previous?.status==='unknown'?'unknown':'pending',createdAt:previous?.createdAt||now(),updatedAt:now(),attempts:(previous?.attempts||0)+1};
      if(previous?.bodyHash!==undefined&&previous.bodyHash!==record.bodyHash)record.priorBodyHash=previous.bodyHash;
      else if(previous?.priorBodyHash)record.priorBodyHash=previous.priorBodyHash;
      const prunedCommitted=fit(record,previous);writeRecord(record,previous);
      return {...metadata(record),...(prunedCommitted?{prunedCommitted}:{})};
    });
  }
  function list(scope){scopeValue(scope);return locked(()=>{recover();return inventory().filter(item=>item.record.scope===scope).map(item=>metadata(item.record)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));});}
  function getForRetry(scope,id){
    scopeValue(scope);identifier(id);return locked(()=>{
      recover();const record=readRecord(nameFor(scope,id));if(!record)return null;
      return {metadata:metadata(record),payload:record.payloadJson===null?null:JSON.parse(record.payloadJson),json:record.payloadJson,
        bodyHash:record.bodyHash,requestDigest:record.requestDigest,...(record.priorBodyHash?{priorBodyHash:record.priorBodyHash}:{}),...(record.receipt?{receipt:clone(record.receipt)}:{})};
    });
  }
  function updateOutcome(scope,id,outcome){
    scopeValue(scope);identifier(id);safeJson(outcome);
    if(!outcome||!['committed','conflict','rejected','unknown'].includes(outcome.status)||Object.keys(outcome).some(key=>!['status','receipt','code'].includes(key)))fail('OUTBOX_OUTCOME','Некорректный результат операции');
    if(outcome.code!==undefined&&(typeof outcome.code!=='string'||!/^[a-zA-Z0-9_.:-]{1,80}$/.test(outcome.code)))fail('OUTBOX_OUTCOME','В результате допустим только короткий код ошибки');
    return locked(()=>{
      recover();const previous=readRecord(nameFor(scope,id));if(!previous)return null;if(previous.status==='committed')return metadata(previous);
      const record={...previous,status:outcome.status,updatedAt:now()};delete record.code;delete record.receipt;
      if(outcome.status==='committed'){
        if(!validReceipt(record,outcome.receipt)){record.status='unknown';record.code='ACK_MISMATCH';}
        else{
          const receipt={id:outcome.receipt.id,status:outcome.receipt.status};
          if(Object.hasOwn(outcome.receipt,'digest'))receipt.digest=outcome.receipt.digest;
          record.receipt=receipt;record.payloadJson=null;
        }
      }else if(outcome.code)record.code=outcome.code;
      fit(record,previous);writeRecord(record,previous);return metadata(record);
    });
  }
  function discard(scope,id){scopeValue(scope);identifier(id);return locked(()=>{
    recover();const name=nameFor(scope,id),record=readRecord(name);if(!record)return false;fs.unlinkSync(local(name));syncDirectory();return true;
  });}
  initialize();locked(()=>{recover();inventory();});
  return Object.freeze({stage,list,getForRetry,updateOutcome,discard,recovery:Object.freeze({...recovery})});
}
module.exports={createCommandOutbox};
