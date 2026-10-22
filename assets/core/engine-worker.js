/* Read-only calculation endpoint. The host owns worker lifetime and UI state. */
(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./application-engine.js'),require('./dispatcher-core.js'));
  else{
    if(!root.DispatcherEngine&&typeof importScripts==='function')importScripts('./dispatcher-core.js','./entity-identity.js','./decimal-core.js','./accounting-boundary.js','./effective-periods.js','./temporal-policy.js','./fuel-engine.js','./fuel-audit.js','./writeoff-engine.js','./platform-schema.js','./platform-contracts.js','./business-calendar.js','./calendar-operations.js','./personnel-planning.js','./document-print.js','./import-engine.js','./access-policy.js','./access-scope.js','./database-lifecycle.js','./document-engine.js','./fuel-stock.js','./inventory-stock.js','./period-policy.js','./fuel-operations.js','./procurement-operations.js','./financial-recognition.js','./fuel-movement-policy.js','./cost-valuation.js','./cost-operations.js','./repair-process.js','./repair-operations.js','../js/45-cost-engine.js','../js/47-procurement-engine.js','./application-engine.js');
    const api=factory(root.DispatcherEngine,root.DispatcherCore);root.DispatcherAnalysisWorker=api;
    if(typeof root.postMessage==='function'&&typeof importScripts==='function'){
      const endpoint=api.createHandler({postMessage:message=>root.postMessage(message)});
      root.onmessage=event=>endpoint.handle(event.data);
    }
  }
})(typeof globalThis==='object'?globalThis:this,function(application,core){
  'use strict';
  const plain=value=>value!==null&&Object.prototype.toString.call(value)==='[object Object]';
  const requestId=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value);
  const generation=value=>Number.isSafeInteger(value)&&value>=0;
  function createHandler(configuration){
    if(!plain(configuration)||typeof configuration.postMessage!=='function')throw Error('Нужен канал ответа расчётного потока');
    const post=configuration.postMessage,schedule=configuration.schedule||((action)=>setTimeout(action,0));
    if(typeof schedule!=='function')throw Error('Нужен планировщик расчёта');
    const engine=application.create(configuration.engineOptions),pending=new Map();let state=null,closed=false,lastGeneration=-1;
    function response(message,extra){post({protocolVersion:1,requestId:message.requestId,generation:message.generation,...extra});}
    function reject(message,code,text){response(message,{type:'result',ok:false,error:{code,message:text}});}
    function cancelAll(code){for(const job of pending.values())reject(job.message,code,'Расчёт отменён: источник изменился');pending.clear();}
    function matching(message,current){return current&&message.generation===current.generation&&message.identity===current.snapshot.identity&&message.sourceFingerprint===current.snapshot.sourceFingerprint;}
    function handle(message){
      if(closed)return;
      if(!plain(message)||!requestId(message.requestId)){post({protocolVersion:1,type:'result',ok:false,error:{code:'INVALID_REQUEST',message:'Некорректный запрос расчёта'}});return;}
      try{
        if(message.type==='cancel'){
          const job=pending.get(message.requestId);if(job){pending.delete(message.requestId);reject(job.message,'CANCELLED','Расчёт отменён');}
          return;
        }
        if(!generation(message.generation)){reject(message,'INVALID_GENERATION','Некорректное поколение источника');return;}
        if(message.type==='clear'){
          if(message.generation<lastGeneration){reject(message,'STALE_QUERY','Источник расчёта уже изменился');return;}
          cancelAll('STALE_QUERY');state=null;lastGeneration=message.generation;engine.clear();response(message,{type:'cleared',ok:true});return;
        }
        if(message.type==='load'){
          if(message.generation<=lastGeneration){reject(message,'STALE_QUERY','Источник расчёта уже изменился');return;}
          if(!plain(message.context)||typeof message.context.identity!=='string'||!message.context.identity){reject(message,'INVALID_ACCESS','Не определён контекст расчёта');return;}
          const snapshot=engine.capture(message.database,message.context);
          if(message.sourceFingerprint!=null&&message.sourceFingerprint!==snapshot.sourceFingerprint){reject(message,'SOURCE_MISMATCH','Отпечаток источника не совпал');return;}
          cancelAll('STALE_QUERY');engine.clear();lastGeneration=message.generation;state={generation:message.generation,snapshot};
          response(message,{type:'loaded',ok:true,identity:snapshot.identity,sourceFingerprint:snapshot.sourceFingerprint});return;
        }
        if(message.type!=='query'){reject(message,'INVALID_REQUEST','Неизвестный запрос расчёта');return;}
        if(!matching(message,state)){reject(message,'STALE_QUERY','Источник или доступ расчёта изменился');return;}
        if(pending.has(message.requestId)){reject(message,'DUPLICATE_REQUEST','Расчёт с этим ID уже выполняется');return;}
        if(pending.size>=32){reject(message,'QUERY_LIMIT','Слишком много ожидающих расчётов');return;}
        if(typeof message.name!=='string'||!plain(message.options==null?{}:message.options)){reject(message,'INVALID_REQUEST','Проверьте параметры расчёта');return;}
        // Copy parameters at the boundary; a queued request must not observe a
        // later mutation made by an embedding host or another message handler.
        const parameters=core.cloneData(message.options||{}),current=state;
        const job={message:{requestId:message.requestId,generation:message.generation,identity:message.identity,sourceFingerprint:message.sourceFingerprint},name:message.name,parameters,current};
        pending.set(message.requestId,job);
        schedule(()=>{
          if(closed||pending.get(job.message.requestId)!==job)return;
          if(state!==current){pending.delete(job.message.requestId);reject(job.message,'STALE_QUERY','Источник расчёта уже изменился');return;}
          try{
            const value=engine.querySnapshot(job.name,current.snapshot,job.parameters);
            if(pending.get(job.message.requestId)!==job||state!==current||closed)return;
            pending.delete(job.message.requestId);response(job.message,{type:'result',ok:true,identity:current.snapshot.identity,sourceFingerprint:current.snapshot.sourceFingerprint,value,stats:engine.stats()});
          }catch(error){pending.delete(job.message.requestId);reject(job.message,typeof error.code==='string'?error.code:'CALCULATION_FAILED','Не удалось выполнить расчёт. Проверьте исходные данные.');}
        });
      }catch(error){reject(message,typeof error.code==='string'?error.code:'INVALID_REQUEST','Не удалось подготовить расчёт. Проверьте исходные данные.');}
    }
    return Object.freeze({handle,close(){if(closed)return;cancelAll('CANCELLED');closed=true;state=null;engine.clear();},stats:()=>({...engine.stats(),pending:pending.size,generation:lastGeneration})});
  }
  return Object.freeze({protocolVersion:1,createHandler});
});
