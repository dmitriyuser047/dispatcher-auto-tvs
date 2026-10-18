#!/usr/bin/env node
'use strict';
// A traineddata directory is uint32 count + count signed int64 offsets,
// followed by uncompressed components. No OCR or training is performed here.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const ROOT=path.resolve(__dirname,'..');
const MAX_BYTES=96*1024*1024;
const NAMES=['config','unicharset','unicharambigs','inttemp','pffmtable','normproto','punc-dawg','word-dawg','number-dawg','freq-dawg','fixed-length-dawgs','cube-unicharset','cube-word-dawg','shapetable','bigram-dawg','unambig-dawg','params-model','lstm','lstm-punc-dawg','lstm-word-dawg','lstm-number-dawg','lstm-unicharset','lstm-recoder','version'];
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const blobSha1=bytes=>crypto.createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
function confined(relative){if(typeof relative!=='string'||!relative||path.isAbsolute(relative))throw Error('Нужен относительный путь внутри проекта');const full=path.resolve(ROOT,relative),prefix=ROOT+path.sep;if(!full.toLowerCase().startsWith(prefix.toLowerCase()))throw Error('Путь выходит за пределы проекта');return full;}
function noLinks(full){let current=full;while(current!==ROOT){if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw Error('Символические ссылки для моделей не поддерживаются');const parent=path.dirname(current);if(parent===current)throw Error('Путь вне проекта');current=parent;}}
function writeNew(relative,bytes){const full=confined(relative);noLinks(full);if(fs.existsSync(full)){if(sha256(fs.readFileSync(full))!==sha256(bytes))throw Error('Файл уже существует с другим содержимым: '+relative);return;}fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,bytes,{flag:'wx'});}
function inspectBuffer(bytes,label='model'){
  if(!Buffer.isBuffer(bytes)||bytes.length<12||bytes.length>MAX_BYTES)throw Error('Недопустимый размер traineddata: '+label);
  let endian='LE',count=bytes.readUInt32LE(0);if(count>1000){endian='BE';count=bytes.readUInt32BE(0);}if(count<1||count>1000||4+count*8>bytes.length)throw Error('Повреждён заголовок traineddata: '+label);
  const offsets=Array.from({length:count},(_,index)=>{const value=bytes['readBigInt64'+endian](4+index*8);if(value===-1n)return -1;if(value<BigInt(4+count*8)||value>BigInt(bytes.length))throw Error('Недопустимое смещение компонента '+index);return Number(value);});
  const present=offsets.map((offset,id)=>({id,offset})).filter(item=>item.offset>=0),components=[];
  if(!present.length||present[0].offset!==4+count*8)throw Error('Неверное начало данных контейнера');
  present.forEach((item,index)=>{const end=index+1<present.length?present[index+1].offset:bytes.length;if(end<=item.offset)throw Error('Компоненты пусты, перекрываются или не упорядочены');const data=bytes.subarray(item.offset,end);components.push({id:item.id,name:NAMES[item.id]||'unknown-'+item.id,offset:item.offset,bytes:data.length,sha256:sha256(data)});});
  const component=id=>{const item=components.find(item=>item.id===id);return item?bytes.subarray(item.offset,item.offset+item.bytes):null;};
  const version=(component(23)?.toString('utf8')||'Pre-4.0.0').replace(/\0+$/,'');
  const result={label,bytes:bytes.length,sha256:sha256(bytes),gitBlobSha1:blobSha1(bytes),container:{format:'tesseract-traineddata',endianness:endian,entryCount:count,headerBytes:4+count*8,valid:true},version,hasLegacy:!!component(1)&&!!component(3),hasLstm:!!component(17),components,precision:'unknown',precisionEvidence:null};
  // With external unicharset + recoder, the 4.x recognizer trailer contains
  // network_string, flags, four-byte iteration fields and three float32s.
  // Recognize only this validated layout; do not infer precision from size.
  const lstm=component(17);
  if(lstm&&component(21)&&component(22)&&lstm.length>32){
    const flagsAt=lstm.length-28,readUInt=offset=>lstm['readUInt32'+endian](offset),readInt=offset=>lstm['readInt32'+endian](offset),readFloat=offset=>lstm['readFloat'+endian](offset);
    for(let start=Math.max(0,flagsAt-4096);start<flagsAt-4;start++){
      const length=readUInt(start);if(!length||length>4092||start+4+length!==flagsAt)continue;
      const network=lstm.subarray(start+4,flagsAt).toString('ascii');if(!/^\[[\x20-\x7e]+\]$/.test(network))continue;
      const flags=readUInt(flagsAt),iteration=readInt(flagsAt+4),sampleIteration=readInt(flagsAt+8),nullCharacter=readInt(flagsAt+12),adamBeta=readFloat(flagsAt+16),learningRate=readFloat(flagsAt+20),momentum=readFloat(flagsAt+24);
      if((flags&~65)!==0||iteration<0||sampleIteration<0||nullCharacter<0||nullCharacter>1000000||![adamBeta,learningRate,momentum].every(Number.isFinite)||adamBeta<0||adamBeta>1.01||learningRate<0||learningRate>10||momentum<0||momentum>1.01)continue;
      result.precision=(flags&1)?'integer':'float';result.precisionEvidence={method:'validated-v4-lstm-recognizer-trailer',trainingFlags:flags,intMode:!!(flags&1),recoding:!!(flags&64),network,iteration,sampleIteration,nullCharacter,adamBeta,learningRate,momentum,source:'https://github.com/tesseract-ocr/tesseract/blob/4.1.0/src/lstm/lstmrecognizer.cpp#L73-L88',flagDefinition:'https://github.com/tesseract-ocr/tesseract/blob/4.1.0/src/lstm/lstmrecognizer.h'};break;
    }
  }
  if(!result.hasLstm&&!result.hasLegacy)throw Error('В traineddata нет распознающей модели');
  return result;
}
function inspectFile(relative){const full=confined(relative);noLinks(full);const stat=fs.statSync(full);if(!stat.isFile()||stat.size>MAX_BYTES)throw Error('Недопустимый файл модели');return inspectBuffer(fs.readFileSync(full),relative);}
function repackWithout(bytes,removeIds){
  const original=inspectBuffer(bytes),count=original.container.entryCount,remove=new Set(removeIds);
  if([...remove].some(id=>!Number.isInteger(id)||id<0||id>=count))throw Error('Недопустимые номера удаляемых компонентов');
  if(remove.has(17)||remove.has(21)||remove.has(22)||remove.has(23))throw Error('Производная LSTM обязана сохранить модель, алфавит, recoder и version');
  if(!original.hasLstm)throw Error('Производная требует исходную LSTM-модель');
  const header=Buffer.alloc(4+count*8),endian=original.container.endianness;header['writeUInt32'+endian](count,0);
  const chunks=[header];let offset=header.length;
  for(let id=0;id<count;id++){const component=original.components.find(item=>item.id===id);if(!component||remove.has(id)){header['writeBigInt64'+endian](-1n,4+id*8);continue;}header['writeBigInt64'+endian](BigInt(offset),4+id*8);const data=bytes.subarray(component.offset,component.offset+component.bytes);chunks.push(data);offset+=data.length;}
  const derived=Buffer.concat(chunks),analysis=inspectBuffer(derived);
  for(const item of analysis.components){const source=original.components.find(source=>source.id===item.id);if(item.sha256!==source.sha256)throw Error('Изменился сохраняемый компонент '+item.id);}
  return {bytes:derived,analysis,derivedFromSha256:original.sha256,removedComponents:original.components.filter(item=>remove.has(item.id)).map(item=>({id:item.id,name:item.name,bytes:item.bytes,sha256:item.sha256}))};
}
function loadManifest(relative='assets/ocr/models-manifest.json'){
  const full=confined(relative);noLinks(full);if(fs.statSync(full).size>2*1024*1024)throw Error('Манифест слишком большой');const manifest=JSON.parse(fs.readFileSync(full,'utf8'));
  if(manifest.schemaVersion!==1||!Array.isArray(manifest.models)||!manifest.models.length||manifest.models.length>30||!manifest.profiles||typeof manifest.profiles!=='object')throw Error('Неподдерживаемый манифест моделей');
  const ids=new Set();for(const model of manifest.models){if(!model||typeof model.id!=='string'||ids.has(model.id)||!['rus','eng'].includes(model.language)||!/^[a-f0-9]{64}$/.test(model.sha256||'')||!Number.isSafeInteger(model.bytes)||model.bytes<=0||model.bytes>MAX_BYTES)throw Error('Повреждена запись модели');ids.add(model.id);confined(model.path);}
  for(const profile of Object.values(manifest.profiles)){if(!Array.isArray(profile.modelIds)||!profile.modelIds.length||profile.modelIds.some(id=>!ids.has(id))||profile.oem!==1||profile.gzip!==false)throw Error('Неверный профиль декодирования');}
  return manifest;
}
function verifyManifest(manifest){
  const models=manifest.models.map(model=>{try{const actual=inspectFile(model.path);if(actual.sha256!==model.sha256||actual.bytes!==model.bytes)throw Error('Контрольная сумма/размер не совпадают');if(actual.precision!==model.precision)throw Error('Точность хранения весов не совпадает');if(!actual.hasLstm)throw Error('Профиль требует LSTM');if(Array.isArray(model.components)&&(model.components.length!==actual.components.length||model.components.some(expected=>{const item=actual.components.find(item=>item.id===expected.id);return !item||item.sha256!==expected.sha256||item.bytes!==expected.bytes;})))throw Error('Компоненты не совпадают с манифестом');const source=model.provenance?.derivedFromModelId?manifest.models.find(item=>item.id===model.provenance.derivedFromModelId):null;if(source){const parent=inspectFile(source.path);if(parent.sha256!==model.provenance.derivedFromSha256)throw Error('Исходная модель производной изменена');for(const component of actual.components)if(parent.components.find(item=>item.id===component.id)?.sha256!==component.sha256)throw Error('Производная изменила веса/данные сохраняемого компонента');for(const removed of model.provenance.removedComponents||[])if(actual.components.some(item=>item.id===removed.id))throw Error('Словарный компонент не удалён');}return {id:model.id,ok:true,analysis:actual};}catch(error){return {id:model.id,ok:false,error:error.message};}});
  const licenses=(manifest.licenses||[]).filter(item=>item.path&&item.sha256).map(item=>{try{const full=confined(item.path);noLinks(full);if(fs.statSync(full).size>1024*1024)throw Error('Файл лицензии слишком большой');if(sha256(fs.readFileSync(full))!==item.sha256)throw Error('Контрольная сумма лицензии не совпадает');return {path:item.path,ok:true};}catch(error){return {path:item.path,ok:false,error:error.message};}});
  return {ok:models.every(model=>model.ok)&&licenses.every(item=>item.ok),schemaVersion:manifest.schemaVersion,models,licenses,profiles:manifest.profiles};
}
async function downloadOfficial(url,expectedBytes){
  if(!/^https:\/\/raw\.githubusercontent\.com\/tesseract-ocr\/(?:tessdata|tessdata_best|tessdata_fast)\/[a-f0-9]{40}\/(?:rus\.traineddata|eng\.traineddata|LICENSE)$/.test(url))throw Error('Допустим только официальный файл Tesseract с полным commit SHA');
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(90000)});if(!response.ok)throw Error('HTTP '+response.status+' при загрузке модели');const advertised=Number(response.headers.get('content-length')||0);if(advertised>MAX_BYTES)throw Error('Модель слишком большая');const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>MAX_BYTES)throw Error('Загрузка превысила предел размера');chunks.push(Buffer.from(chunk));}const bytes=Buffer.concat(chunks);if(expectedBytes!=null&&bytes.length!==expectedBytes)throw Error('Размер официального файла не совпадает');return bytes;
}
function argsOf(values){const options={},positionals=[];for(let index=0;index<values.length;index++){const value=values[index];if(value.startsWith('--')){const key=value.slice(2);if(['online','help'].includes(key))options[key]=true;else{if(index+1>=values.length||values[index+1].startsWith('--'))throw Error('Нет значения для '+value);options[key]=values[++index];}}else positionals.push(value);}return {options,positionals};}
async function main(){
  const {options,positionals}=argsOf(process.argv.slice(2)),command=positionals.shift()||'help';let output;
  if(command==='help'||options.help){console.log('Offline: inspect [project paths] | verify [--manifest path] | profiles | analyze [--output audit/file.json]\nDerive: derive --source accurate-rus --remove 18,19,20 --output assets/ocr/models/codes/rus.traineddata\nExplicit network: fetch --profile accurate --online. Existing different files are never overwritten.');return;}
  if(command==='inspect'){output=(positionals.length?positionals:['rus.traineddata','eng.traineddata']).map(inspectFile);}
  else{
    const manifest=loadManifest(options.manifest);
    if(command==='profiles')output=manifest.profiles;
    else if(command==='verify'||command==='analyze'){output=verifyManifest(manifest);if(command==='analyze')output={...output,generatedAt:new Date().toISOString(),scope:'Static container, checksum, provenance and profile analysis only. No OCR benchmark or model training.',references:manifest.references||[],provenance:manifest.models.map(model=>({id:model.id,...model.provenance}))};if(!output.ok)process.exitCode=1;}
    else if(command==='derive'){const source=manifest.models.find(model=>model.id===options.source);if(!source||!options.output||!options.remove)throw Error('Нужны --source, --remove, --output');if(!options.output.replace(/\\/g,'/').startsWith('assets/ocr/models/'))throw Error('Производные сохраняются только в assets/ocr/models');const actual=inspectFile(source.path);if(actual.sha256!==source.sha256)throw Error('Исходная модель не совпадает с манифестом');const ids=options.remove.split(',').map(value=>Number(value)),derived=repackWithout(fs.readFileSync(confined(source.path)),ids);writeNew(options.output,derived.bytes);output={path:options.output,...derived.analysis,derivedFromSha256:derived.derivedFromSha256,removedComponents:derived.removedComponents,trained:false};}
    else if(command==='fetch'){if(!options.online)throw Error('Сеть выключена. Для явной загрузки укажите --online');const profile=manifest.profiles[options.profile||'accurate'];if(!profile)throw Error('Неизвестный профиль');output=[];for(const id of profile.modelIds){const model=manifest.models.find(item=>item.id===id);if(model.provenance?.kind!=='official'||!model.path.replace(/\\/g,'/').startsWith('assets/ocr/models/'))throw Error('Загружать можно только отдельные официальные модели');const bytes=await downloadOfficial(model.provenance.url,model.bytes);if(sha256(bytes)!==model.sha256||model.provenance.gitBlobSha1&&blobSha1(bytes)!==model.provenance.gitBlobSha1)throw Error('Контрольные суммы загруженной модели не совпадают');inspectBuffer(bytes);writeNew(model.path,bytes);output.push({id,ok:true,path:model.path});}}
    else throw Error('Неизвестная команда: '+command);
  }
  const json=JSON.stringify(output,null,2)+'\n';
  if(options.output&&command!=='derive'){const full=confined(options.output);noLinks(full);if(!options.output.replace(/\\/g,'/').startsWith('audit/'))throw Error('Отчёты сохраняются только в audit/');fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,json);console.log(JSON.stringify({ok:output.ok??true,report:options.output,models:output.models?.length}));}else console.log(json);
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={inspectBuffer,inspectFile,repackWithout,sha256,blobSha1,loadManifest,verifyManifest,downloadOfficial};
