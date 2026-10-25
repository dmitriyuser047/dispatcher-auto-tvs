/* Pure transaction preparation. The host retains all persistence and session IO. */
(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./platform-kernel.js'));
  else{
    if(!root.PlatformKernel&&typeof importScripts==='function')importScripts(
      './dispatcher-core.js','./entity-identity.js','./accounting-boundary.js','./decimal-core.js','./effective-periods.js','./generator-fuel.js','./seasonal-fuel.js','./temporal-policy.js','./fuel-engine.js','./writeoff-engine.js','./platform-schema.js','./record-identity.js','./reference-graph.js','./request-fingerprint.js','./catalog-merge.js','./catalog-facts.js','./catalog-policy.js','./platform-contracts.js','./command-source.js','./business-calendar.js','./calendar-operations.js','./personnel-planning.js','./document-print.js','./import-planner.js','./import-engine.js','./access-policy.js','./access-scope.js','./database-lifecycle.js','./platform-compatibility.js','./fuel-movement-policy.js','./issue-fuel.js','./document-state.js','./document-engine.js','./fuel-stock.js','./inventory-stock.js','./period-policy.js','./fuel-operations.js','./procurement-operations.js','./precision-policy.js',
      './personnel-kinds.js','./personnel-engine.js','./financial-recognition.js','./cost-valuation.js','./cost-operations.js','./generator-spares.js','./generator-maintenance.js','./asset-inventory.js','./repair-process.js','./repair-operations.js','./document-facts.js','./document-lifecycle.js',
      './workflow-policy.js','./workflow-inspection.js','./workflow-validation.js','./platform-policies.js','./integrity-facts.js','./platform-integrity.js','./platform-kernel.js');
    const api=factory(root.PlatformKernel);root.PlatformTransactionWorker=api;
    if(typeof root.postMessage==='function'&&typeof importScripts==='function'){
      const endpoint=api.createHandler({postMessage:message=>root.postMessage(message)});
      root.onmessage=event=>endpoint.handle(event.data);
    }
  }
})(typeof globalThis==='object'?globalThis:this,function(kernel){
  'use strict';
  if(kernel?.apiVersion!==1||typeof kernel.prepare!=='function')throw Error('Не загружено ядро транзакций');
  const plain=value=>value!==null&&Object.prototype.toString.call(value)==='[object Object]';
  const marker=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value);
  function failure(error){
    return {name:typeof error?.name==='string'?error.name:'PlatformKernelError',code:typeof error?.code==='string'?error.code:'PREPARE_FAILED',
      message:typeof error?.message==='string'?error.message:'Не удалось подготовить сохранение',
      ...(error?.details!==undefined?{details:structuredClone(error.details)}:{}),
      ...(Array.isArray(error?.issues||error?.details?.issues)?{issues:structuredClone(error.issues||error.details.issues)}:{}),
      ...(typeof error?.field==='string'?{field:error.field}:{}),...(typeof error?.status==='number'?{status:error.status}:{})};
  }
  function createHandler(configuration){
    if(!plain(configuration)||typeof configuration.postMessage!=='function')throw Error('Нужен канал ответа подготовки');
    const post=configuration.postMessage,schedule=configuration.schedule||((action)=>setTimeout(action,0));
    if(typeof schedule!=='function')throw Error('Нужен планировщик подготовки');
    let pending=null,closed=false;
    const respond=(message,extra)=>post({protocolVersion:1,type:'result',...(marker(message?.requestId)?{requestId:message.requestId}:{}),
      ...(typeof message?.context?.identity==='string'&&message.context.identity.length<=16384?{identity:message.context.identity}:{}),...extra});
    function execute(job){
      try{respond(job.message,{ok:true,plan:kernel.prepare(job.previous,job.next,job.context)});}
      catch(error){respond(job.message,{ok:false,error:failure(error)});}
    }
    function handle(message){
      if(closed)return false;
      if(!plain(message)||message.protocolVersion!==1||message.type!=='prepare'||!marker(message.requestId)){
        respond(message,{ok:false,error:{name:'PlatformKernelError',code:'INVALID_REQUEST',message:'Некорректный запрос подготовки'}});return false;
      }
      if(pending){respond(message,{ok:false,error:{name:'PlatformKernelError',code:'PREPARE_BUSY',message:'Подготовка уже выполняется'}});return false;}
      let captured;
      try{captured=structuredClone({previous:message.previous,next:message.next,context:message.context});}
      catch{
        // For non-cloneable direct CommonJS inputs, preserve the strict kernel's
        // original validation order and error instead of inventing a DTO error.
        execute({message,previous:message.previous,next:message.next,context:message.context});return false;
      }
      const job={...captured,message:{requestId:message.requestId,context:{identity:captured.context?.identity}}};pending=job;
      try{schedule(()=>{if(closed||pending!==job)return;try{execute(job);}finally{if(pending===job)pending=null;}});}
      catch(error){pending=null;respond(job.message,{ok:false,error:failure(error)});return false;}
      return true;
    }
    return Object.freeze({handle,close(){closed=true;pending=null;},stats:()=>({pending:pending?1:0,closed})});
  }
  return Object.freeze({protocolVersion:1,createHandler});
});
