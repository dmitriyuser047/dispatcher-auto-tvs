/* Read-only single-job diagnostics endpoint. Its host owns source/session stamps. */
(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./platform-schema.js'),require('./platform-integrity.js'));
  else{
    if((!root.PlatformIntegrity||!root.PlatformPolicies)&&typeof importScripts==='function')importScripts(
      './dispatcher-core.js','./entity-identity.js','./accounting-boundary.js','./decimal-core.js','./effective-periods.js','./temporal-policy.js','./fuel-engine.js','./writeoff-engine.js','./platform-schema.js','./reference-graph.js','./catalog-merge.js','./catalog-policy.js','./platform-contracts.js','./document-engine.js','./precision-policy.js',
      './personnel-engine.js','./financial-recognition.js','./fuel-movement-policy.js','./document-lifecycle.js',
      './workflow-policy.js','./platform-policies.js','./platform-integrity.js');
    const api=factory(root.PlatformSchema,root.PlatformIntegrity);root.PlatformHealthWorker=api;
    if(typeof root.postMessage==='function'&&typeof importScripts==='function'){
      const endpoint=api.createHandler({postMessage:message=>root.postMessage(message)});
      root.onmessage=event=>endpoint.handle(event.data);
    }
  }
})(typeof globalThis==='object'?globalThis:this,function(schema,integrity){
  'use strict';
  if(schema?.apiVersion!==1||integrity?.apiVersion!==1||typeof integrity.inspect!=='function')throw Error('Не загружены модули диагностики');
  const plain=value=>value!==null&&Object.prototype.toString.call(value)==='[object Object]';
  const marker=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value);
  const identity=value=>typeof value==='string'&&value.length>0&&value.length<=16384;
  const fields=Object.freeze(['code','severity','section','recordId','rowIndex','field','message','targetSection','targetId','relatedRecordId']);
  function publicReport(report){
    return {counts:{error:report.counts.error,warning:report.counts.warning,total:report.counts.total},
      sections:report.sections.map(row=>({section:row.section,label:row.label,module:row.module,readable:row.readable,rows:row.rows})),
      issues:report.issues.map(issue=>Object.fromEntries(fields.filter(field=>issue[field]!=null&&['string','number'].includes(typeof issue[field])).map(field=>[field,issue[field]])))};
  }
  function createHandler(configuration){
    if(!plain(configuration)||typeof configuration.postMessage!=='function')throw Error('Нужен канал ответа диагностики');
    const post=configuration.postMessage,schedule=configuration.schedule||((action)=>setTimeout(action,0));
    if(typeof schedule!=='function')throw Error('Нужен планировщик диагностики');
    let pending=null,closed=false;
    function respond(message,extra){post({protocolVersion:1,type:'result',...(marker(message?.requestId)?{requestId:message.requestId}:{}),
      ...(marker(message?.sourceStamp)?{sourceStamp:message.sourceStamp}:{}),...(identity(message?.context?.identity)?{identity:message.context.identity}:{}),...extra});}
    function reject(message,code,text){respond(message,{ok:false,error:{code,message:text}});return false;}
    function handle(message){
      if(closed)return false;
      if(!plain(message)||message.protocolVersion!==1||message.type!=='inspect'||!marker(message.requestId)||!marker(message.sourceStamp))return reject(message,'INVALID_REQUEST','Некорректный запрос диагностики');
      const context=message.context;
      if(!plain(context)||!identity(context.identity)||context.readable!=null&&(!Array.isArray(context.readable)||context.readable.some(name=>typeof name!=='string'||!schema.sections.includes(name)))||
          !integrity.dateValid(context.today,'date'))return reject(message,'INVALID_CONTEXT','Проверьте контекст доступа и дату диагностики');
      if(pending)return reject(message,'BUSY','Проверка уже выполняется');
      let source,options;
      try{
        // The worker boundary normally already clones messages. This second
        // copy also isolates an embedding CommonJS host from queued mutations.
        // structuredClone preserves damaged numeric/cyclic data for inspection.
        const readable=context.readable==null?null:new Set(context.readable);
        const projection=plain(message.source)?Object.fromEntries(schema.sections.map(name=>[name,!readable||readable.has(name)?message.source[name]:[]])):message.source;
        source=structuredClone(projection);options=structuredClone({identity:context.identity,readable:context.readable,today:context.today});
      }catch{return reject(message,'INVALID_SOURCE','Не удалось подготовить снимок диагностики');}
      const job={message:{requestId:message.requestId,sourceStamp:message.sourceStamp,context:{identity:context.identity}},source,options};pending=job;
      try{schedule(()=>{
        if(closed||pending!==job)return;
        try{const value=publicReport(integrity.inspect(job.source,job.options));if(!closed&&pending===job)respond(job.message,{ok:true,value});}
        catch{if(!closed&&pending===job)reject(job.message,'INSPECTION_FAILED','Не удалось выполнить проверку. Проверьте исходные данные.');}
        finally{if(pending===job)pending=null;}
      });}catch{pending=null;return reject(job.message,'SCHEDULE_FAILED','Не удалось запустить фоновую проверку');}
      return true;
    }
    return Object.freeze({handle,close(){closed=true;pending=null;},stats:()=>({pending:pending?1:0,closed})});
  }
  return Object.freeze({protocolVersion:1,createHandler});
});
