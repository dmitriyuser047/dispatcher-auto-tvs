'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const FILE='database-identity.json';
function fail(message){const error=new Error(message);error.code='DATABASE_IDENTITY';throw error;}
function validate(value){
  if(!value||Array.isArray(value)||value.format!=='tvs-database-identity'||value.version!==1||
    typeof value.uuid!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.uuid)||
    !Number.isSafeInteger(value.generation)||value.generation<1)fail('Повреждён идентификатор базы. Запись остановлена; восстановите служебный файл из копии.');
  return Object.freeze({format:value.format,version:1,uuid:value.uuid,generation:value.generation});
}
// Caller holds the same directory lock used by storage transactions. Identity
// is separate from accounting rows; reading never repairs an invalid identity.
function readOrCreate(dataDir){
  const file=path.join(dataDir,FILE);
  let info;
  try{info=fs.lstatSync(file);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(info){
    if(!info.isFile()||info.isSymbolicLink()||info.nlink>1)fail('Служебный идентификатор базы не должен быть ссылкой');
    if(info.size>4096)fail('Неверный размер служебного идентификатора базы');
    let value;try{value=JSON.parse(fs.readFileSync(file,'utf8'));}catch{fail('Не прочитан служебный идентификатор базы');}
    return validate(value);
  }
  const identity=validate({format:'tvs-database-identity',version:1,uuid:crypto.randomUUID(),generation:1});
  const fd=fs.openSync(file,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(identity),'utf8');fs.fsyncSync(fd);}
  catch(error){try{fs.unlinkSync(file);}catch{}throw error;}
  finally{fs.closeSync(fd);}
  return identity;
}
module.exports=Object.freeze({FILE,validate,readOrCreate});
