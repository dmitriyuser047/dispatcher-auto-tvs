/* Public data health and validation orchestration over structural facts and workflow rules. */
(function(root,factory){'use strict';if(typeof module==='object'&&module.exports)module.exports=factory(require('./platform-schema.js'),require('./integrity-facts.js'),()=>require('./workflow-validation.js'),()=>require('./precision-policy.js'));else root.PlatformIntegrity=factory(root.PlatformSchema,root.IntegrityFacts,()=>root.WorkflowValidation,()=>root.PrecisionPolicy);})(typeof globalThis==='object'?globalThis:this,function(schema,facts,getPolicies,getPrecision){
  'use strict';
  if(schema?.apiVersion!==1||facts?.apiVersion!==1)throw Error('Не загружены структурные правила платформы');
  const plain=value=>value!==null&&Object.prototype.toString.call(value)==='[object Object]';
  function makeError(code,issues){const error=new Error(issues.map(issue=>issue.message).slice(0,6).join('; ')||'Нарушена целостность базы');error.name='PlatformIntegrityError';error.code=code;error.issues=issues;return error;}
  function allowed(value,label){if(value==null)return null;if(!Array.isArray(value)||value.some(item=>typeof item!=='string'))throw makeError('INVALID_ACCESS',[{code:'invalid-access',severity:'error',section:'',recordId:'',field:'',message:'Проверьте права '+label}]);return value.includes('*')?null:new Set(value);}
  const rowsOf=(db,section)=>plain(db)&&Array.isArray(db[section])?db[section]:[];
  const {dateValid,rowIdentity}=facts;
  function inspect(db,options={}){
    const result=facts.analyze(db,options),readable=allowed(options.readable,'чтения');
    const canRead=section=>!readable||readable.has(section),policies=getPolicies();
    if(policies&&typeof policies.inspect==='function'){
      const projection=Object.fromEntries(schema.sections.map(section=>[section,canRead(section)?rowsOf(db,section).filter(plain):[]]));
      const unavailable=new Set();
      for(const issue of policies.inspect(projection,options).issues){
        if(!canRead(issue.section))continue;
        const dependency=issue.code==='DISPATCH_ASSET_REQUIRED'?{v:'vehicles',g:'generators',t:'tanks'}[String(projection.dispatchJobs.find(row=>row.id===issue.recordId)?.assetRef||'')[0]]:issue.code==='DISPATCH_DRIVER_REQUIRED'?'drivers':issue.code==='PART_REQUIRED'?'parts':null;
        if(dependency&&!canRead(dependency)){
          const key=issue.section+':'+dependency;if(!unavailable.has(key)){unavailable.add(key);result.issues.push({code:'policy-reference-unavailable',severity:'warning',section:issue.section,recordId:'',rowIndex:-1,field:'',targetSection:dependency,message:'Для проверки рабочего правила недоступен связанный раздел'});}continue;
        }
        // Proof is used by transition validation, never by the public health panel.
        const {proof,...publicIssue}=issue;result.issues.push(publicIssue);
      }
    }else result.issues.push({code:'policy-module-unavailable',severity:'warning',section:'',recordId:'',rowIndex:-1,field:'',message:'Общие правила рабочих процессов недоступны для проверки'});
    let precision;try{precision=getPrecision();}catch{}
    if(precision?.apiVersion===1){
      try{for(const issue of precision.inspect(db,options).issues)if(canRead(issue.section))result.issues.push(issue);}
      catch(error){result.issues.push({code:'precision-module-unavailable',severity:'warning',section:'',recordId:'',rowIndex:-1,field:'',message:'Правила точности чисел недоступны для проверки'});}
    }else result.issues.push({code:'precision-module-unavailable',severity:'warning',section:'',recordId:'',rowIndex:-1,field:'',message:'Правила точности чисел недоступны для проверки'});
    const sections=schema.sections.map(section=>({section,label:schema.descriptors[section].label,module:schema.descriptors[section].module,readable:!readable||readable.has(section),rows:readable&&!readable.has(section)?null:rowsOf(db,section).length}));
    return {apiVersion:1,issues:result.issues,counts:{error:result.issues.filter(issue=>issue.severity==='error').length,warning:result.issues.filter(issue=>issue.severity==='warning').length,total:result.issues.length},sections};
  }
  function validateChanges(previous,next,context={}){
    facts.validateChanges(previous,next,context);
    const readable=allowed(context.readable,'чтения');
    const policies=getPolicies();
    if(!policies||policies.apiVersion!==1||typeof policies.validateChanges!=='function')throw makeError('MODULE_UNAVAILABLE',[{code:'policy-module-unavailable',severity:'error',section:'',recordId:'',field:'',message:'Не загружены общие правила рабочих процессов'}]);
    try{policies.validateChanges(previous,next,context);}catch(error){
      if(readable&&Array.isArray(error.issues)){error.issues=error.issues.map(issue=>readable.has(issue.section)?issue:{code:issue.code,severity:'error',section:issue.section,recordId:'',field:'',message:'Изменение нарушает правило раздела, недоступного текущей роли'});error.message=error.issues.map(issue=>issue.message).slice(0,6).join('; ');if(error.details)error.details={...error.details,issues:error.issues};}
      throw error;
    }
    return true;
  }
  return Object.freeze({apiVersion:1,inspect,validateChanges,dateValid,rowIdentity});
});
