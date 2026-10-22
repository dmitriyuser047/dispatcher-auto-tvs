'use strict';
// Main owns the source, principal, profile list and durable review directory.
// Renderer input can choose a mode and a new destination, never an identity.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const safe=require('./safe-file.cjs'),metadata=require('./database-lifecycle.cjs');
const engine=require('../assets/core/database-lifecycle.js'),format=require('./storage-format.cjs');
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const stable=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(stable).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}';
const fold=value=>process.platform==='win32'?value.toLowerCase():value;
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
function object(value,keys){
 if(!value||typeof value!=='object'||Array.isArray(value)||![null,Object.prototype].includes(Object.getPrototypeOf(value)))fail('MAINTENANCE_INPUT','Нужны параметры действия с базой');
 for(const key of Reflect.ownKeys(value)){const d=Object.getOwnPropertyDescriptor(value,key);if(typeof key!=='string'||!keys.includes(key)||!d?.enumerable||d.get||d.set)fail('MAINTENANCE_INPUT','Недопустимые параметры действия с базой');}
 return value;
}
const contains=(parent,target)=>{const rel=path.relative(parent,target);return !rel||!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep);};
function createDatabaseMaintenance(options){
 for(const name of ['reviewDir','assertContext','knownProfiles'])if(typeof options?.[name]!=='function')throw TypeError('Missing maintenance capability: '+name);
 const inspectSource=options.inspectSource||require('./schema-upgrade.cjs').inspectSource;
 const copy=options.upgradeCopy||require('./schema-upgrade.cjs').upgradeCopy;
 const backup=options.backup||require('./backup-service.cjs');
 const selections=new Map();
 function check(context){options.assertContext(context);if(context.client||context.actor?.role!=='admin'||typeof context.scope!=='string'||!context.scope||!path.isAbsolute(context.sourceDir||''))fail('MAINTENANCE_ACCESS','Действия с базой доступны администратору на основном компьютере');}
 function profiles(context){check(context);const list=options.knownProfiles(context);const result=metadata.diagnoseKnownProfiles(list);check(context);return {...result,profiles:result.profiles.map(row=>({...row,name:list.find(p=>p.id===row.id)?.name||String(row.id),dataDir:list.find(p=>p.id===row.id)?.dataDir}))};}
 function store(context,create=false){check(context);return safe.verifiedDirectory(options.reviewDir(context),{create});}
 function key(directory,create=false){const file=path.join(directory.path,'maintenance.key');try{return safe.readRegularFileSync(file,{maxBytes:32,minBytes:32});}catch(error){if(error.code!=='ENOENT'||!create)throw error;safe.assertDirectory(directory);const bytes=crypto.randomBytes(32);fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600,flush:true});safe.assertDirectory(directory);return bytes;}}
 const mac=(bytes,secret)=>crypto.createHmac('sha256',secret).update(bytes).digest('hex');
 function load(context,id){
  if(!uuid(id))fail('MAINTENANCE_REVIEW','Сначала проверьте параметры копии');
  const directory=store(context),secret=key(directory),envelope=JSON.parse(safe.readRegularFileSync(path.join(directory.path,'review-'+id+'.json'),{maxBytes:1024*1024,minBytes:1}).toString('utf8'));
  if(!envelope||typeof envelope.mac!=='string'||!/^[a-f0-9]{64}$/.test(envelope.mac)||!envelope.value||!crypto.timingSafeEqual(Buffer.from(envelope.mac,'hex'),Buffer.from(mac(stable(envelope.value),secret),'hex')))fail('MAINTENANCE_REVIEW','Сохранённый план изменён или не подтверждён');
  const value=envelope.value;
  if(value.version!==1||value.reviewId!==id||value.contextKey!==context.scope)fail('MAINTENANCE_REVIEW','План принадлежит другой базе или учётной записи');
  const rebuilt=engine.plan({...value.input,reviewFingerprint:value.plan.reviewFingerprint},value.operationContext);
  if(stable(rebuilt)!==stable(value.plan))fail('MAINTENANCE_REVIEW','Сохранённый план не совпал с проверкой');
  safe.assertDirectory(directory);check(context);return value;
 }
 function summary(value){return {reviewId:value.reviewId,reviewFingerprint:value.plan.reviewFingerprint,mode:value.plan.action,targetDir:value.executor.targetDir,targetFormat:value.plan.target.format,sourceLabel:value.executor.archivePath||value.executor.sourceDir,sourceFormat:value.plan.source.format,sourceIdentity:value.plan.source.identity,targetIdentity:value.plan.target.identity,predecessor:value.plan.predecessor,sourceDescriptor:value.plan.source.descriptor,targetDescriptor:value.plan.target.descriptor,reason:value.plan.history.reason,at:value.plan.history.at,warnings:value.plan.warnings,rows:value.rows};}
 function list(context){check(context);let directory;try{directory=store(context);}catch(error){if(error.code==='ENOENT')return {ok:true,reviews:[]};throw error;}const names=fs.readdirSync(directory.path).filter(name=>/^review-[a-f0-9-]{36}\.json$/.test(name));if(names.length>128)fail('MAINTENANCE_LIMIT','Слишком много сохранённых планов обслуживания');const reviews=[];for(const name of names){try{reviews.push(summary(load(context,name.slice(7,-5))));}catch(error){if(error.code!=='MAINTENANCE_REVIEW')throw error;}}return {ok:true,reviews};}
 function target(context,raw){
  if(typeof raw!=='string'||!raw.trim()||raw.length>32768||raw.includes('\0')||!path.isAbsolute(raw))fail('MAINTENANCE_TARGET','Укажите полный путь к новому каталогу');
  const resolved=path.resolve(raw),parent=safe.verifiedDirectory(path.dirname(resolved)),source=fs.realpathSync.native(context.sourceDir);
  if(contains(source,resolved)||contains(resolved,source)||contains(options.reviewDir(context),resolved)||contains(resolved,options.reviewDir(context)))fail('MAINTENANCE_TARGET','Новый каталог должен находиться отдельно от исходной базы и настроек программы');
  return {path:resolved,parent,physicalKey:fold(path.join(parent.path,path.basename(resolved)))};
 }
 function selectBackup(context,archivePath){
  check(context);const checked=backup.verifyPackage({archivePath});check(context);
  const canonical=fs.realpathSync.native(archivePath);if(fold(canonical)!==fold(path.resolve(archivePath)))fail('MAINTENANCE_SOURCE','Исходный пакет содержит ссылку');
  const backupId=crypto.randomUUID();while(selections.size>=16)selections.delete(selections.keys().next().value);
  selections.set(backupId,{contextKey:context.scope,archivePath:canonical,checked});
  return {ok:true,backupId,name:path.basename(canonical),rows:checked.rows,sourceIdentity:checked.sourceIdentity,sourceDescriptor:checked.sourceDescriptor};
 }
 function preview(context,payload){
  object(payload,['mode','targetDir','targetFormat','reason','backupId','headProfileId']);check(context);
  if(!['clone','relocate','restoreContinuation'].includes(payload.mode)||!['json','sqlite'].includes(payload.targetFormat)||typeof payload.reason!=='string'||payload.reason.trim().length<3||payload.reason.length>2000)fail('MAINTENANCE_INPUT','Выберите действие, формат и укажите основание');
  const destination=target(context,payload.targetDir),known=profiles(context),knownHeads=known.profiles.filter(row=>row.identity&&['known','legacy'].includes(row.state)).map(row=>({identity:row.identity,physicalKey:row.physicalKey,metadataStamp:row.metadataStamp}));
  let source,executor,rows;
  if(payload.backupId!==undefined){
   const selection=selections.get(payload.backupId);if(!selection||selection.contextKey!==context.scope)fail('MAINTENANCE_SOURCE','Выберите резервный пакет заново');
   const checked=backup.verifyPackage({archivePath:selection.archivePath});if(checked.archiveSha256!==selection.checked.archiveSha256)fail('MAINTENANCE_SOURCE','Резервный пакет изменился после выбора');
   source={format:'backup',identity:checked.sourceIdentity,descriptor:checked.sourceDescriptor,fingerprint:'sha256:'+checked.archiveSha256,physicalKey:fold(selection.archivePath)};
   executor={archivePath:selection.archivePath,targetDir:destination.path,format:payload.targetFormat,protectedDir:context.sourceDir};rows=checked.rows;
  }else{
   if(payload.mode==='restoreContinuation')fail('MAINTENANCE_SOURCE','Для продолжения нужен выбранный резервный пакет');
   const inspected=inspectSource({sourceDir:context.sourceDir});source={format:inspected.sourceFormat,identity:inspected.sourceIdentity,descriptor:inspected.descriptor,fingerprint:inspected.sourceFingerprint,physicalKey:fold(fs.realpathSync.native(context.sourceDir))};executor={sourceDir:context.sourceDir,targetDir:destination.path,targetFormat:payload.targetFormat,expectedSourceFingerprint:inspected.sourceFingerprint};rows=inspected.counts.reduce((n,row)=>n+row.count,0);
  }
  const head=payload.mode==='restoreContinuation'?known.profiles.find(row=>row.id===payload.headProfileId):null;
  if(payload.mode==='restoreContinuation'&&(!head||head.state!=='known'||!head.identity))fail('MAINTENANCE_HEAD','Выберите профиль с подтверждённым текущим поколением');
  const input={action:payload.mode,source,target:{format:payload.targetFormat,descriptor:format.describe(3),physicalKey:destination.physicalKey},reason:payload.reason.trim(),knownHeads,...(head?{continuationOf:{identity:head.identity,physicalKey:head.physicalKey,metadataStamp:head.metadataStamp}}:{})};
  const operationContext={operationId:crypto.randomUUID(),at:new Date().toISOString(),actor:{id:context.actor.id,name:context.actor.name,role:context.actor.role},newUuid:crypto.randomUUID()},review=engine.preview(input,operationContext);
  if(!review.canApply)return {ok:false,code:review.issues[0]?.code||'MAINTENANCE_PLAN',error:review.issues[0]?.message||'План не подтверждён',issues:review.issues};
  if(fs.existsSync(destination.path))fail('MAINTENANCE_TARGET','Целевой каталог уже существует. Для прерванной операции откройте её сохранённый план.');
  const directory=store(context,true),secret=key(directory,true),names=fs.readdirSync(directory.path).filter(name=>/^review-.*\.json$/.test(name));if(names.length>=128)fail('MAINTENANCE_LIMIT','Достигнут предел сохранённых планов обслуживания');
  const reviewId=crypto.randomUUID(),value={version:1,reviewId,contextKey:context.scope,input,operationContext,plan:review.plan,executor,targetParent:destination.parent,rows};check(context);safe.assertDirectory(destination.parent);safe.assertDirectory(directory);
  const envelope={value,mac:mac(stable(value),secret)};fs.writeFileSync(path.join(directory.path,'review-'+reviewId+'.json'),JSON.stringify(envelope),{flag:'wx',mode:0o600,flush:true});check(context);return {ok:true,...summary(value)};
 }
 async function apply(context,payload){
  object(payload,['reviewId','reviewFingerprint']);check(context);const value=load(context,payload.reviewId);if(value.plan.reviewFingerprint!==payload.reviewFingerprint)fail('MAINTENANCE_REVIEW','Параметры изменились. Проверьте план заново');
  const parent=value.targetParent;safe.assertDirectory(parent);
  const assertLifecycleCurrent=plan=>{
   check(context);safe.assertDirectory(parent);if(stable(plan)!==stable(value.plan))fail('MAINTENANCE_REVIEW','Исполнитель изменил проверенный план');
   const known=profiles(context),heads=known.profiles.filter(row=>row.identity&&['known','legacy'].includes(row.state)).map(row=>({identity:row.identity,physicalKey:row.physicalKey,metadataStamp:row.metadataStamp}));
   const current=engine.preview({...value.input,knownHeads:heads},value.operationContext);
   if(!current.canApply||stable(current.targetIdentity)!==stable(plan.target.identity))fail('MAINTENANCE_HEAD_CHANGED','Известные поколения или назначение изменились после проверки');
   if(plan.predecessor&&!heads.some(head=>stable(head)===stable(plan.predecessor)))fail('MAINTENANCE_HEAD_CHANGED','Текущее поколение изменилось после проверки');
   if(plan.predecessor&&heads.some(head=>head.identity.uuid===plan.predecessor.identity.uuid&&head.identity.generation>plan.predecessor.identity.generation))fail('MAINTENANCE_HEAD_CHANGED','Найдено более новое поколение базы');
  };
  // The executor checks this callback before publication. A published replay
  // verifies its actual target and returns the original result without recopy.
  const trusted={lifecyclePlan:value.plan,assertLifecycleCurrent};
  const result=value.plan.source.format==='backup'?await backup.restorePackage(value.executor,trusted):await copy(value.executor,trusted);
  check(context);return {...result,ok:true,reviewId:value.reviewId,targetDir:value.executor.targetDir,targetIdentity:value.plan.target.identity};
 }
 return Object.freeze({profiles,selectBackup,preview,apply,list,inspect:context=>{check(context);const result=inspectSource({sourceDir:context.sourceDir});check(context);return {...result,ok:true};}});
}
module.exports=Object.freeze({createDatabaseMaintenance});
