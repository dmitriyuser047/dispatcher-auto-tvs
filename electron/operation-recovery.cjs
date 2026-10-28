'use strict';

// The coordinator never chooses a database or principal. Main supplies a freshly
// verified context, transport and receipt lookup; the durable store is local to
// this application's profile and contains the exact request sent to the backend.
function createOperationRecovery({outbox,send,lookup,onWarning=()=>{},onEvent,recoverTransport=()=>false}){
  if(!outbox||typeof send!=='function'||typeof lookup!=='function'||typeof recoverTransport!=='function')throw Error('Нужны очередь, транспорт и проверка результата операции');
  function observed(context,operationId,phase,code){
    if(typeof onEvent!=='function'||typeof operationId!=='string'||!/^[a-zA-Z0-9._:-]{1,200}$/.test(operationId)||typeof context.databaseToken!=='string'||!context.databaseToken)return;
    try{const result=onEvent(Object.freeze({phase,code,operationId,databaseToken:context.databaseToken,backend:['json','sqlite','remote','local'].includes(context.backend)?context.backend:context.client?'remote':'local'}));if(result&&typeof result.catch==='function')result.catch(()=>{});}catch{}
  }
  function outcome(context,id,value){
    try{return outbox.updateOutcome(context.scope,id,value);}
    catch(error){try{onWarning(error.code||'OUTBOX_OUTCOME');}catch{}return null;}
  }
  function errorResult(error,queued){return {ok:false,error:error.message||'Операция не подтверждена',code:error.code||'SAVE_FAILED',queued};}
  const matchesReceipt=(receipt,id,digest)=>receipt?.id===id&&['committed','replayed'].includes(receipt.status)&&receipt.digest===digest;
  function settle(context,payload,response,requestDigest){
    const id=payload.operation.id;
    if(response?.databaseChanged||response?.databaseToken&&response.databaseToken!==context.databaseToken){
      outcome(context,id,{status:'rejected',code:'DATABASE_CHANGED'});
      observed(context,id,'ack-received','conflict');
      return {ok:false,databaseChanged:true,code:'DATABASE_CHANGED',error:'База изменилась. Загрузите её заново перед повтором.'};
    }
    if(response?.ok===true){
      if(response.databaseToken!==context.databaseToken||!matchesReceipt(response.operationReceipt,id,requestDigest)){
        outcome(context,id,{status:'unknown',code:'ACK_REQUIRED'});
        observed(context,id,'ack-received','unknown');
        return {ok:false,queued:true,code:'ACK_REQUIRED',error:'Ответ не подтвердил операцию. Её запрос сохранён в очереди для проверки.'};
      }
      const updated=outcome(context,id,{status:'committed',receipt:response.operationReceipt});
      if(updated?.status==='unknown'){observed(context,id,'ack-received','unknown');return {ok:false,queued:true,code:'ACK_MISMATCH',error:'Ответ не совпал с сохранённым запросом. Проверьте результат операции.'};}
      observed(context,id,'ack-received',updated?.status==='committed'?response.operationReceipt.status:'unknown');
      return response;
    }
    if(Array.isArray(response?.conflicts))outcome(context,id,{status:'conflict',code:'REVISION_CONFLICT'});
    else if(response?.unsupported)outcome(context,id,{status:'rejected',code:'UNSUPPORTED_PROTOCOL'});
    else outcome(context,id,{status:'unknown',code:response?.code||'UNCONFIRMED'});
    observed(context,id,'ack-received',Array.isArray(response?.conflicts)?'conflict':'unknown');
    return response||{ok:false,queued:true,error:'Ответ не получен. Запрос сохранён для проверки.',code:'UNCONFIRMED'};
  }
  async function sendSaved(context,payload,json,requestDigest){
    observed(context,payload.operation.id,'transport-sent','pending');
    try{return settle(context,payload,await send(context,json),requestDigest);}
    catch(error){
      const definitive=error.unknown!==true&&error.definitive!==false&&(error.definitive===true||error.status>=400&&error.status<500&&error.status!==408||Array.isArray(error.issues)||Array.isArray(error.details?.issues));
      // A lost reply is not a failed write. Recover only after an exact,
      // authorized receipt lookup, and replay the very same saved request once
      // to obtain its canonical rows. A miss never authorizes a second write.
      let recover=false;if(!definitive)try{recover=recoverTransport(context)===true;}catch{}
      if(recover)try{
        const checked=await lookup(context,payload.operation.id,requestDigest);
        if(checked?.ok===true&&checked.databaseToken===context.databaseToken&&matchesReceipt(checked.operationReceipt,payload.operation.id,requestDigest)){
          observed(context,payload.operation.id,'recovery-looked-up','committed');
          return settle(context,payload,await send(context,json),requestDigest);
        }
      }catch{}
      outcome(context,payload.operation.id,{status:definitive?'rejected':'unknown',code:error.code||'TRANSPORT_FAILED'});
      observed(context,payload.operation.id,'ack-received',definitive?'denied':'unknown');
      return errorResult(error,!definitive);
    }
  }
  async function execute(context,payload){
    if(payload?.databaseToken!==context.databaseToken||typeof context.databaseToken!=='string'||!context.databaseToken)
      return {ok:false,databaseChanged:true,code:'DATABASE_CHANGED',error:'Запрос относится к другой базе. Загрузите выбранную базу перед сохранением.'};
    const command=payload&&Object.hasOwn(payload,'command');
    if(command&&(!context.supportsOperations||context.supportsCommands!==true||!payload.operation))
      return {ok:false,unsupported:true,code:'UNSUPPORTED_COMMANDS',error:'Это подключение не поддерживает атомарные команды. Загрузите данные из совместимой версии программы.'};
    if(!context.supportsOperations||!payload?.operation){
      try{return await send(context,JSON.stringify(payload));}catch(error){return errorResult(error,false);}
    }
    try{
      const sections=new Set((command?require('../assets/core/platform-commands.js').dependencies(payload.command):Object.keys(payload.sections||{})).filter(name=>name!=='auditLog'));
      const unresolved=outbox.list(context.scope).some(row=>row.id!==payload.operation.id&&['pending','unknown'].includes(row.status)&&row.sections.some(name=>sections.has(name)));
      if(unresolved)return {ok:false,queued:false,needsReload:true,code:'PENDING_OPERATION',error:'В этом разделе есть операция с неподтверждённым результатом. Откройте «Состояние программы» и проверьте её перед новым сохранением.'};
      outbox.stage(context.scope,payload,{supportsOperations:true});
      observed(context,payload.operation.id,'outbox-persisted','pending');
      const stored=outbox.getForRetry(context.scope,payload.operation.id);
      return await sendSaved(context,payload,stored.json??JSON.stringify(payload),stored.requestDigest);
    }catch(error){return errorResult(error,false);}
  }
  async function reconcile(context,id){
    const stored=outbox.getForRetry(context.scope,id);
    if(!stored)throw Error('Операция не найдена в очереди этой базы и учётной записи');
    if(stored.metadata.status==='committed'&&matchesReceipt(stored.receipt,id,stored.requestDigest)){observed(context,id,'recovery-looked-up','committed');return {ok:true,committed:true,operationReceipt:stored.receipt};}
    let result;try{result=await lookup(context,id,stored.requestDigest);}catch(error){observed(context,id,'recovery-looked-up','unknown');throw error;}
    if(result?.databaseToken!==context.databaseToken){observed(context,id,'recovery-looked-up','unknown');throw Object.assign(Error('База изменилась. Очередь не применялась.'),{code:'DATABASE_CHANGED'});}
    if(result.ok!==true){observed(context,id,'recovery-looked-up','unknown');throw Object.assign(Error('Сервер не подтвердил результат проверки'),{code:'LOOKUP_UNCONFIRMED'});}
    if(!result.operationReceipt){if(stored.metadata.status==='committed'){observed(context,id,'recovery-looked-up','unknown');throw Object.assign(Error('Прежнее подтверждение не содержит точного отпечатка запроса; сервер не подтвердил его повторно.'),{code:'LOOKUP_UNCONFIRMED'});}observed(context,id,'recovery-looked-up','not-found');return {ok:true,committed:false,status:stored.metadata.status};}
    if(!matchesReceipt(result.operationReceipt,id,stored.requestDigest)){
      outcome(context,id,{status:'unknown',code:'ACK_MISMATCH'});
      observed(context,id,'recovery-looked-up','unknown');
      throw Object.assign(Error('Подтверждение не совпало с запросом'),{code:'ACK_MISMATCH'});
    }
    const updated=outcome(context,id,{status:'committed',receipt:result.operationReceipt});
    if(updated?.status==='unknown'){observed(context,id,'recovery-looked-up','unknown');throw Object.assign(Error('Подтверждение не совпало с запросом'),{code:'ACK_MISMATCH'});}
    observed(context,id,'recovery-looked-up',updated?.status==='committed'?'committed':'unknown');
    return {ok:true,committed:true,operationReceipt:result.operationReceipt};
  }
  async function retry(context,id){
    const checked=await reconcile(context,id);
    if(checked.committed)return checked;
    const stored=outbox.getForRetry(context.scope,id);
    if(!stored)throw Error('Операция больше не находится в очереди');
    if(!stored.payload||!stored.json)throw Error('Сохранённый запрос недоступен');
    if(Object.hasOwn(stored.payload,'command')&&context.supportsCommands!==true)
      return {ok:false,unsupported:true,code:'UNSUPPORTED_COMMANDS',error:'Подключение не поддерживает сохранённую команду. Повтор не выполнялся.'};
    return sendSaved(context,stored.payload,stored.json,stored.requestDigest);
  }
  return Object.freeze({execute,reconcile,retry,list:context=>outbox.list(context.scope),discard:(context,id)=>outbox.discard(context.scope,id)});
}
module.exports={createOperationRecovery};
