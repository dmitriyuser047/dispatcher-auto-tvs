'use strict';
// Pure recipes only. The receiving command service owns writer proofs, durable
// envelopes, CAS, permissions, receipts and commits. No database is opened here.
const crypto=require('node:crypto');
const exchange=require('../assets/core/des-object-exchange.js');
const documents=require('../assets/core/document-engine.js');
const commands=require('../assets/core/platform-commands.js');
const calendarApi=require('../assets/core/business-calendar.js');
const contracts=require('../assets/core/platform-contracts.js');
const identity=require('../assets/core/entity-identity.js');
const spares=require('../assets/core/generator-spares.js');
const accessContext=require('./access-context.cjs');
const access=require('./access-control.js');
const commandService=require('./command-service.cjs');
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const clone=value=>JSON.parse(JSON.stringify(value));
const factFields=Object.freeze(['date','partId','kind','qty','assetRef','workOrderId','meter','reason','sum','unitCost','vatRate','vatAmount','grossSum','taxSource','invoiceNo','source']);
const attributionFields=new Set(['id','lifecycle','createdAt','createdBy','updatedAt','updatedBy','scopeSnapshot']);
function fail(code,message,issues){throw Object.assign(new Error(message),{code,...(issues?{issues}:{})});}
function problem(error,operation){return{code:error.code||'DES_DOMAIN_BLOCKED',message:error.message,section:operation?.section||null,recordId:contracts.identifier(operation?.id)?operation.id:null,requiresDomainAction:true,...(Array.isArray(error.issues)?{details:error.issues}:{} )};}
function requiresDomainAction(operation){return operation?.section==='partMovements';}
function stepIds(operation,originId){
 exchange.digest(operation); // Validate strict JSON before reading/copying fields.
 if(typeof originId!=='string'||!originId||originId.length>256||originId!==operation.operationId)fail('DES_DOMAIN_ORIGIN','Не подтверждён исходный ID операции');
 const hash=crypto.createHash('sha256').update(exchange.digest({version:1,originId,operation})).digest('hex');
 return{draftId:'des-domain:draft:'+hash,postId:'des-domain:post:'+hash};
}
function factualPayload(operation){
 if(operation.before!==null||!operation.after)fail('DES_DOMAIN_TRANSITION','Исправление, удаление и сторно движения требуют отдельного штатного действия');
 const after=operation.after;
 if(!contracts.identifier(operation.id)||after.id!==operation.id)fail('DES_DOMAIN_ID','Исходный типизированный ID документа не совпадает');
 if(!['receipt','issue'].includes(after.kind))fail('DES_DOMAIN_KIND','В обмене пока поддерживаются приход и выдача запчастей; возврат и списание требуют штатного действия');
 for(const field of Object.keys(after))if(!factFields.includes(field)&&!attributionFields.has(field))fail('DES_DOMAIN_FIELDS','Движение содержит неподдерживаемые поля: '+field);
 if(own(after,'lifecycle')){
  const meta=after.lifecycle;
  if(!meta||typeof meta!=='object'||Array.isArray(meta)||meta.version!==1||!meta.postedAt||!meta.postedActor||typeof meta.operationId!=='string'||Object.keys(meta).some(key=>!['version','postedAt','postedActor','operationId'].includes(key)))fail('DES_DOMAIN_TRANSITION','Поддерживается только исходное проведение без исправления или отмены');
 }
 const payload={};for(const field of factFields)if(own(after,field))payload[field]=clone(after[field]);
 return payload;
}
function authorize(database,command,principal){
 const context=accessContext.create(database,database,principal),reads=commands.dependencies(command),writes=commands.footprint(command),action=commandService.semanticAction(command);
 if(!access.actionAvailable(principal,action,command.input.section)||reads.some(name=>!context.context.readable.includes(name))||writes.some(name=>!context.context.writable.includes(name)))fail('ACCESS_DENIED','Недостаточно прав для штатного проведения движения');
 commandService.assertCommandScope(database,command,reads,principal);
 return context;
}
/**
 * Derive and simulate the exact ordinary commands, with receiving metadata.
 * `sections` is a PRIVATE scratch projection; never expose it as an API preview.
 * Persist steps + now before execution. Resume those envelopes, never regenerate
 * an already started recipe with a new clock, base revision or fingerprint.
 */
function derive(database,operation,options={}){
 const result={supported:false,canApply:false,steps:[],issues:[],recordMapping:null,sections:{}};
 if(!requiresDomainAction(operation)){result.issues.push(problem({code:'DES_DOMAIN_UNSUPPORTED',message:'Для этого раздела нет рецепта штатного проведения'},operation));return result;}
 try{
  const ids=stepIds(operation,options.originId??operation.operationId),payload=factualPayload(operation);
  if(!options.principal)fail('ACCESS_DENIED','Не подтверждён принимающий пользователь');
  const principal=accessContext.normalizePrincipal(options.principal);
  if(!options.scope)fail('DES_DOMAIN_SCOPE','Не подтверждён объект принимаемого движения');
  const projected=exchange.project(database,options.scope),part=(projected.sections.parts||[]).filter(row=>row.id===payload.partId);
  if(part.length!==1)fail('DES_DOMAIN_SCOPE','Запчасть не принадлежит подтверждённому объекту');
  if(payload.kind==='issue'){
   const target=identity.resolveAsset(database,payload.assetRef);
   if(target.status!=='known'||target.section!=='generators'||target.id!==part[0].generatorId)fail('SPARES_TARGET','Выдача должна относиться к однозначно определённой ДЭС владельца запчасти');
  }
  const now=options.now;
  if(typeof now!=='string'||!Number.isFinite(Date.parse(now)))fail('DES_DOMAIN_CLOCK','Нужно фиксированное время принимающего сервера');
  const clock=calendarApi.resolve(database,now);
  if(options.today!==undefined&&options.today!==clock.today)fail('DES_DOMAIN_CLOCK','Рабочая дата не совпадает с календарём принимающей базы');
  const draftRows=(database.documentDrafts||[]).filter(row=>row.id===ids.draftId),physical=(database.partMovements||[]).filter(row=>row.id===ids.postId||row.id===operation.id);
  if(draftRows.length||physical.length)fail('DES_DOMAIN_RECOVERY','Результат прежнего проведения нужно сверить по сохранённым конвертам и журналу операций');
  result.supported=true;
  let scratch=database;
  const changed={};
  function simulate(operationId,input){
   const command={type:'DocumentAction',version:1,input},auth=authorize(scratch,command,principal);
   const planned=commands.plan(scratch,command,{id:operationId,now,today:clock.today,calendar:clock,actor:auth.actor,readable:auth.context.readable,writable:auth.context.writable});
   commandService.assertSemanticChanges(scratch,planned.sections,command,principal);
   spares.validateChanges(scratch,{...scratch,...planned.sections});
   scratch={...scratch,...planned.sections};Object.assign(changed,planned.sections);
   result.steps.push({operationId,command});
  }
  simulate(ids.draftId,{action:'saveDraft',section:'partMovements',payload});
  const action={action:'postDraft',section:'partMovements',draftId:ids.draftId},context=accessContext.create(scratch,scratch,principal);
  const review=documents.preview(scratch,action,{today:clock.today,calendar:clock,readable:context.context.readable});
  if(!review.canPost)fail('DES_DOMAIN_DOCUMENT_BLOCKED',review.issues.map(issue=>issue.message).join('; '),review.issues);
  simulate(ids.postId,{...action,reviewFingerprint:review.fingerprint});
  result.canApply=true;result.sections=changed;result.now=now;result.today=clock.today;result.calendar=clock;
  result.recordMapping={section:'partMovements',sourceId:operation.id,targetId:ids.postId};
 }catch(error){result.canApply=false;result.steps=[];result.sections={};result.recordMapping=null;result.issues.push(problem(error,operation));}
 return result;
}
module.exports=Object.freeze({apiVersion:1,requiresDomainAction,derive});
