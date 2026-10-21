/* Read-only data health and delta validation for every business section. */
(function(root,factory){'use strict';if(typeof module==='object'&&module.exports)module.exports=factory(require('./platform-schema.js'),()=>require('./platform-policies.js'),()=>require('./precision-policy.js'));else root.PlatformIntegrity=factory(root.PlatformSchema,()=>root.PlatformPolicies,()=>root.PrecisionPolicy);})(typeof globalThis==='object'?globalThis:this,function(schema,getPolicies,getPrecision){
  'use strict';
  if(!schema||schema.apiVersion!==1)throw Error('Не загружен реестр разделов платформы');
  const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
  const plain=value=>value!==null&&Object.prototype.toString.call(value)==='[object Object]';
  const present=value=>value!==undefined&&value!==null&&value!=='';
  const scalarId=value=>typeof value==='string'&&!!value.trim()&&value.length<=500&&!['__proto__','constructor','prototype'].includes(value)||typeof value==='number'&&Number.isSafeInteger(value);
  const idKey=value=>typeof value+':'+String(value);
  const card=value=>String(value||'').replace(/\D/g,'')||String(value||'').trim().toUpperCase();
  const numeric=value=>typeof value==='number'?value:typeof value==='string'&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())?Number(value):NaN;
  function stable(value,parents=new Set()){
    if(value===undefined)return 'undefined';if(typeof value==='number'&&!Number.isFinite(value))return '<number:'+String(value)+'>';
    if(value===null||typeof value!=='object')return JSON.stringify(value)??'<'+typeof value+'>';
    if(parents.has(value))return '<cycle>';parents.add(value);
    const result=Array.isArray(value)?'['+value.map(child=>stable(child,parents)).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key],parents)).join(',')+'}';
    parents.delete(value);return result;
  }
  function dateValid(value,kind){
    if(typeof value!=='string')return false;
    if(kind==='month')return /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value);
    const day=value.slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return false;
    const parsed=new Date(day+'T12:00:00Z');if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==day)return false;
    if(kind==='date')return value===day;
    if(kind==='dateOrDatetime'&&value===day)return true;
    const match=value.match(/^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-](\d{2}):(\d{2}))?$/);
    return !!match&&Number(match[1])<24&&Number(match[2])<60&&Number(match[3]||0)<60&&Number(match[4]||0)<24&&Number(match[5]||0)<60;
  }
  function values(row,path){
    const parts=path.split('.'),out=[];
    function walk(value,index,actual){
      if(index===parts.length){out.push({value,path:actual});return;}
      if(value==null)return;
      const token=parts[index],many=token.endsWith('[]'),field=many?token.slice(0,-2):token,pathPart=actual?actual+'.'+field:field;
      if(!plain(value)){out.push({value,path:actual||field,shape:true});return;}
      const child=value[field];
      if(many){if(child==null)return;if(!Array.isArray(child)){out.push({value:child,path:pathPart,shape:true});return;}child.forEach((item,position)=>walk(item,index+1,pathPart+'['+position+']'));}
      else walk(child,index+1,pathPart);
    }
    walk(row,0,'');return out;
  }
  function fieldValue(row,path){const entries=values(row,path);return entries.length?entries[0].value:undefined;}
  function allowed(value,label){if(value==null)return null;if(!Array.isArray(value)||value.some(item=>typeof item!=='string'))throw makeError('INVALID_ACCESS',[{code:'invalid-access',severity:'error',section:'',recordId:'',field:'',message:'Проверьте права '+label}]);return value.includes('*')?null:new Set(value);}
  function makeError(code,issues){const error=new Error(issues.map(issue=>issue.message).slice(0,6).join('; ')||'Нарушена целостность базы');error.name='PlatformIntegrityError';error.code=code;error.issues=issues;return error;}
  function rowsOf(db,section){return plain(db)&&Array.isArray(db[section])?db[section]:[];}
  function rowIdentity(section,row,index){const identity=schema.descriptors[section].identity;if(plain(row)&&scalarId(row[identity.field]))return idKey(row[identity.field]);if(plain(row)&&identity.natural&&scalarId(row[identity.natural.field])){const key=identity.natural.normalize==='card'?card(row[identity.natural.field]):row[identity.natural.field];if(present(key))return 'natural:'+idKey(key);}if(plain(row)&&identity.composite&&identity.composite.some(field=>present(row[field])))return 'composite:'+stable(identity.composite.map(field=>row[field]??''));return '@'+index;}
  function indexDatabase(db){
    const indexes={};
    for(const section of schema.sections){const byId=new Map(),byString=new Map();rowsOf(db,section).forEach((row,index)=>{if(!plain(row)||!scalarId(row.id))return;const key=idKey(row.id),text=String(row.id);if(!byId.has(key))byId.set(key,[]);byId.get(key).push({row,index});if(!byString.has(text))byString.set(text,[]);byString.get(text).push({row,index});});indexes[section]={byId,byString};}
    return indexes;
  }
  function relationTarget(relation,row,value){
    if(relation.kind==='historical')return null;
    if(relation.kind==='assetRef'){
      if(typeof value!=='string'||!/^([vgt]):(.+)$/.test(value))return {invalid:true};
      const [,prefix,id]=value.match(/^([vgt]):(.+)$/),section=relation.targets[prefix];return section?{section,id,string:true}:{invalid:true};
    }
    if(relation.kind==='discriminator'){
      const selector=fieldValue(row,relation.selector),key=relation.prefix&&typeof selector==='string'?selector.split(':')[0]:selector,section=relation.targets[key];
      return section?{section,id:value}:relation.unknownPolicy==='advisory'?{unknown:true}:{invalid:true};
    }
    return {section:relation.target,id:value,lookup:relation.kind==='lookup'};
  }
  function findTarget(indexes,db,relation,target){
    if(target.lookup){const expected=relation.normalize==='card'?card(target.id):target.id;return rowsOf(db,target.section).filter(row=>plain(row)&&(relation.normalize==='card'?card(row[relation.targetField]):row[relation.targetField])===expected).map(row=>({row}));}
    return (target.string?indexes[target.section]?.byString.get(String(target.id)):indexes[target.section]?.byId.get(idKey(target.id)))||[];
  }
  function analyze(db,options={}){
    if(!plain(db))return {issues:[{code:'invalid-database',severity:'error',section:'',recordId:'',rowIndex:-1,field:'',message:'База должна быть объектом с разделами'}],relationStates:[]};
    const readable=allowed(options.readable,'чтения'),indexes=indexDatabase(db),issues=[],seen=new Set(),relationStates=[];
    const canRead=section=>!readable||readable.has(section);
    const add=(section,row,index,code,field,message,extra={})=>{
      const identity=schema.descriptors[section]?.identity.field||'id',recordId=plain(row)&&scalarId(row[identity])?row[identity]:'';
      const issue={code,severity:'error',section,recordId,rowIndex:index,field,message,...extra};
      const key=stable([section,rowIdentitySafe(section,row,index),code,field,issue.relationId||'',issue.value,issue.targetSection||'',issue.targetId]);
      if(!seen.has(key)){seen.add(key);issues.push(issue);}
    };
    const rowIdentitySafe=(section,row,index)=>schema.descriptors[section]?rowIdentity(section,row,index):'@'+index;
    const jsonCheck=(section,row,index)=>{
      const parents=new Set();
      function visit(value,path,depth){
        if(depth>100){add(section,row,index,'invalid-json-depth',path,'Слишком глубокая структура записи',{value:'depth'});return;}
        if(typeof value==='number'&&!Number.isFinite(value)){add(section,row,index,'invalid-json-number',path,'В записи есть бесконечное или нечисловое значение',{value:String(value)});return;}
        if(value==null||typeof value!=='object'){if(typeof value==='function'||typeof value==='symbol'||typeof value==='bigint')add(section,row,index,'invalid-json-value',path,'Значение нельзя сохранить в формате базы',{value:typeof value});return;}
        if(parents.has(value)){add(section,row,index,'invalid-json-cycle',path,'Циклическая структура записи',{value:'cycle'});return;}parents.add(value);
        Object.keys(value).forEach(key=>{const next=path?path+'.'+key:key;if(['__proto__','constructor','prototype'].includes(key))add(section,row,index,'unsafe-field',next,'Недопустимое имя поля записи',{value:key});else visit(value[key],next,depth+1);});parents.delete(value);
      }
      visit(row,'',0);
    };
    for(const section of schema.sections){
      if(!canRead(section)){issues.push({code:'section-unavailable',severity:'warning',section,recordId:'',rowIndex:-1,field:'',message:'Раздел недоступен для проверки: '+schema.descriptors[section].label});continue;}
      const descriptor=schema.descriptors[section],raw=plain(db)?db[section]:undefined;
      if(raw!=null&&!Array.isArray(raw)){add(section,{},-1,'invalid-section','','Раздел должен содержать массив записей',{value:raw});continue;}
      const identities=new Map();
      rowsOf(db,section).forEach((row,index)=>{
        if(!plain(row)){add(section,{},index,'invalid-row','','Запись должна быть объектом',{value:row});return;}
        jsonCheck(section,row,index);
        const identity=descriptor.identity.field,value=row[identity],composite=!scalarId(value)&&descriptor.identity.composite&&descriptor.identity.composite.slice(0,2).every(field=>scalarId(row[field])),natural=!scalarId(value)&&descriptor.identity.natural&&scalarId(row[descriptor.identity.natural.field])&&present(descriptor.identity.natural.normalize==='card'?card(row[descriptor.identity.natural.field]):row[descriptor.identity.natural.field]);
        if(!scalarId(value)&&!composite&&!natural){add(section,row,index,'missing-id',identity,'У записи нет корректного устойчивого идентификатора',{severity:descriptor.identity.requiredForNew?'error':'warning',value});}
        else if(composite||natural){const key=rowIdentity(section,row,index);if(!identities.has(key))identities.set(key,[]);identities.get(key).push(index);}
        else {const key=idKey(value);if(!identities.has(key))identities.set(key,[]);identities.get(key).push(index);}
        for(const spec of descriptor.numbers)for(const entry of values(row,spec.field)){
          if(entry.shape){add(section,row,index,'invalid-field-container',entry.path,'Повреждена структура числового поля',{value:entry.value});continue;}
          const value=entry.value;if(!present(value))continue;
          const parsed=numeric(value);
          const negativeAllowed=spec.allowNegativeWhen&&spec.allowNegativeWhen.values.includes(fieldValue(row,spec.allowNegativeWhen.field));
          if(!Number.isFinite(parsed)||spec.integer&&!Number.isInteger(parsed)||spec.min!=null&&parsed<spec.min&&!negativeAllowed||spec.max!=null&&parsed>spec.max)add(section,row,index,'invalid-number',entry.path,'Проверьте числовое поле «'+entry.path+'»',{value});
        }
        for(const spec of descriptor.dates)for(const entry of values(row,spec.field)){
          if(entry.shape){add(section,row,index,'invalid-field-container',entry.path,'Повреждена структура даты',{value:entry.value});continue;}
          if(present(entry.value)&&!dateValid(entry.value,spec.kind))add(section,row,index,'invalid-date',entry.path,'Проверьте дату «'+entry.path+'»',{value:entry.value});
        }
        for(const spec of descriptor.enums){const value=fieldValue(row,spec.field);if(present(value)&&!spec.values.includes(value))add(section,row,index,'invalid-state',spec.field,'Недопустимое состояние записи',{value});}
        for(const range of descriptor.ranges){const first=fieldValue(row,range.from),last=fieldValue(row,range.to);if(!present(first)||!present(last))continue;const comparable=typeof first==='number'&&Number.isFinite(first)&&typeof last==='number'&&Number.isFinite(last)||typeof first==='string'&&typeof last==='string'&&dateValid(first,first.includes('T')?'datetime':'date')&&dateValid(last,last.includes('T')?'datetime':'date');if(comparable&&(range.strict?first>=last:first>last))add(section,row,index,'invalid-range',range.from+'..'+range.to,'Конец периода или показание меньше начала',{value:[first,last]});}
      });
      for(const [key,positions]of identities)if(positions.length>1){const row=raw[positions[0]];add(section,row,positions[0],'duplicate-id',descriptor.identity.field,'Идентификатор записи повторяется',{value:{id:row[descriptor.identity.field],count:positions.length},rowIndexes:positions});}
      for(const unique of descriptor.unique||[]){const groups=new Map();rowsOf(db,section).forEach((row,index)=>{if(!plain(row)||!present(row[unique.field]))return;const key=unique.normalize==='card'?card(row[unique.field]):row[unique.field];if(!groups.has(key))groups.set(key,[]);groups.get(key).push(index);});for(const [key,positions]of groups)if(positions.length>1)add(section,raw[positions[0]],positions[0],'duplicate-business-key',unique.field,'Повторяется уникальный номер или код справочника',{value:{key,count:positions.length},rowIndexes:positions});}
    }
    for(const relation of schema.relations){
      if(relation.kind==='historical'||!canRead(relation.from))continue;
      rowsOf(db,relation.from).forEach((row,index)=>{if(!plain(row)||row.deleted)return;
        for(const entry of values(row,relation.field)){
          if(entry.shape){add(relation.from,row,index,'invalid-reference-container',entry.path,'Повреждена структура связи',{relationId:relation.id,value:entry.value});continue;}
          if(!present(entry.value))continue;
          const target=relationTarget(relation,row,entry.value),severity=relation.strength==='advisory'?'warning':'error';
          if(!target)continue;
          if(target.unknown){add(relation.from,row,index,'reference-unrecognized-source',entry.path,'Источник связи относится к внешней или неизвестной системе',{severity:'warning',relationId:relation.id,value:entry.value});continue;}
          if(target.invalid||!scalarId(target.id)){add(relation.from,row,index,'invalid-reference',entry.path,'Некорректный идентификатор связанной записи',{severity,relationId:relation.id,value:entry.value});continue;}
          if(!canRead(target.section)){add(relation.from,row,index,'reference-unavailable',entry.path,'Нет доступа для проверки связанного раздела',{severity:'warning',relationId:relation.id,targetSection:target.section});continue;}
          let matches=findTarget(indexes,db,relation,target),resolvedLegacy=false;
          // A legacy purchase's stale raw pointer is resolved by the canonical fuel
          // rules when exactly one vehicle/date/grade record exists. Never add stock.
          if(!matches.length&&relation.resolve==='fuel-purchase-journal'){
            const candidates=rowsOf(db,'records').filter(candidate=>plain(candidate)&&candidate.vehicleId===row.vehicleId&&candidate.date===row.date&&(!row.grade||candidate.fuelGrade===row.grade));
            if(candidates.length===1){add(relation.from,row,index,'reference-resolved-legacy',entry.path,'Старая ссылка однозначно разрешена по машине, дате и марке',{severity:'warning',relationId:relation.id,value:entry.value,targetSection:target.section,targetId:candidates[0].id});matches=[{row:candidates[0]}];resolvedLegacy=true;}
          }
          if(matches.length!==1)add(relation.from,row,index,matches.length?'ambiguous-reference':'missing-reference',entry.path,matches.length?'Связанный идентификатор неоднозначен':'Не найдена связанная запись',{severity,relationId:relation.id,value:entry.value,targetSection:target.section,targetId:target.id});
          relationStates.push({section:relation.from,row,index,path:entry.path,value:entry.value,relation,target,matches,resolvedLegacy});
        }
      });
    }
    return {issues,relationStates};
  }
  function inspect(db,options={}){
    const result=analyze(db,options),readable=allowed(options.readable,'чтения');
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
    if(!plain(previous)||!plain(next))throw makeError('INVALID_DATABASE',[{code:'invalid-database',severity:'error',section:'',recordId:'',field:'',message:'Для проверки нужны предыдущий и новый снимки базы'}]);
    const writable=allowed(context.writable,'записи'),readable=allowed(context.readable,'чтения'),changed=schema.sections.filter(section=>stable(previous[section]||[])!==stable(next[section]||[]));
    const errors=[];
    const add=issue=>errors.push({severity:'error',...issue});
    for(const section of changed)if(writable&&!writable.has(section)||readable&&!readable.has(section))add({code:'section-write-denied',section,recordId:'',field:'',message:'Недостаточно прав на изменение раздела «'+schema.descriptors[section].label+'»'});
    if(errors.length)throw makeError('ACCESS_DENIED',errors);
    const oldReport=analyze(previous),nextReport=analyze(next),oldIssues=new Set();
    const oldRows=new Map(),mapping=new Map();
    for(const section of schema.sections){
      const before=rowsOf(previous,section),after=rowsOf(next,section),used=new Set();
      const identities=new Map();before.forEach((row,index)=>{const key=rowIdentity(section,row,index);if(!identities.has(key))identities.set(key,[]);identities.get(key).push(index);});
      after.forEach((row,index)=>{
        const candidates=identities.get(rowIdentity(section,row,index))||[];let match=candidates.find(position=>!used.has(position)&&stable(before[position])===stable(row));
        if(match===undefined)match=candidates.find(position=>!used.has(position));
        if(match===undefined&&plain(row)&&!scalarId(row[schema.descriptors[section].identity.field]))match=before.findIndex((candidate,position)=>!used.has(position)&&stable(candidate)===stable(row));
        if(match!==undefined&&match>=0){used.add(match);mapping.set(section+':'+index,match);oldRows.set(section+':'+index,before[match]);}
      });
    }
    const signature=(issue,old)=>stable([issue.section,old?issue.rowIndex:mapping.get(issue.section+':'+issue.rowIndex)??'new:'+issue.rowIndex,issue.code,issue.field,issue.relationId||'',issue.value,issue.targetSection||'',issue.targetId]);
    oldReport.issues.filter(issue=>issue.severity==='error').forEach(issue=>oldIssues.add(signature(issue,true)));
    for(const issue of nextReport.issues)if(issue.severity==='error'&&!oldIssues.has(signature(issue,false)))add(issue);
    for(const state of nextReport.relationStates){
      if(state.matches.length!==1||state.relation.strength==='advisory')continue;
      const old=oldRows.get(state.section+':'+state.index);
      // Nested actual indexes are accessed separately because a wildcard would
      // compare the wrong sibling when a card has several assignments.
      const exactOld=old&&state.path.split('.').reduce((value,key)=>{const match=key.match(/^(.*?)\[(\d+)\]$/);return match?value?.[match[1]]?.[Number(match[2])]:value?.[key];},old);
      if(state.resolvedLegacy){
        const priorMatches=old?findTarget(indexDatabase(previous),previous,state.relation,{...state.target,id:exactOld}):[];
        if(!old||stable(exactOld)!==stable(state.value)||priorMatches.length===1)add({code:'new-stale-reference',section:state.section,recordId:state.row.id??'',rowIndex:state.index,field:state.path,message:'Нельзя создавать или повреждать прямую ссылку на запись журнала',targetSection:state.target.section,targetId:state.value});
      }
      if(!old||stable(exactOld)!==stable(state.value)){
        if(readable&&!readable.has(state.target.section))add({code:'reference-access-denied',section:state.section,recordId:state.row.id??'',rowIndex:state.index,field:state.path,message:'Нет права чтения связанного раздела',targetSection:state.target.section});
        else if(state.matches[0].row.archived&&!state.row.archived)add({code:'archived-reference',section:state.section,recordId:state.row.id??'',rowIndex:state.index,field:state.path,message:'Нельзя создавать новую связь с архивной карточкой',targetSection:state.target.section,targetId:state.target.id});
      }
    }
    for(const section of changed){const descriptor=schema.descriptors[section];if(!descriptor.terminalStates)continue;rowsOf(next,section).forEach((row,index)=>{const old=oldRows.get(section+':'+index);if(plain(row)&&old&&descriptor.terminalStates.includes(old.status)&&row.status!==old.status)add({code:'terminal-state-change',section,recordId:row.id??'',rowIndex:index,field:'status',value:row.status,message:'Завершённое состояние этого документа нельзя изменить напрямую'});});}
    if(errors.length){
      const safe=errors.map(issue=>readable&&!readable.has(issue.section)?{code:issue.code,severity:'error',section:issue.section,recordId:'',field:'',message:'Изменение нарушает связи с разделом, недоступным текущей роли'}:issue);
      throw makeError('INTEGRITY_VIOLATION',safe);
    }
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
