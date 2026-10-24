/* Catalog aliases preserve original identities and never authorize raw rewrites. */
(function(root,factory){'use strict';if(typeof module==='object'&&module.exports)module.exports=factory(require('./platform-schema.js'),()=>require('./catalog-merge.js'),()=>require('./reference-graph.js'),require('./record-identity.js'),require('./catalog-facts.js'));else root.CatalogPolicy=factory(root.PlatformSchema,()=>root.MergeCatalog,()=>root.ReferenceGraph,root.RecordIdentity,root.CatalogFacts);})(typeof globalThis==='object'?globalThis:this,function(schema,getMerge,getGraph,recordIdentity,catalogFacts){
  'use strict';
  const catalogs=catalogFacts.catalogs;
  const own=(row,key)=>!!row&&Object.prototype.hasOwnProperty.call(row,key);
  const plain=value=>value!==null&&Object.prototype.toString.call(value)==='[object Object]';
  const identifier=value=>typeof value==='string'&&!!value.trim()||typeof value==='number'&&Number.isFinite(value);
  const key=value=>typeof value+':'+JSON.stringify(value);
  const rows=(db,section)=>Array.isArray(db?.[section])?db[section].filter(plain):[];
  const readable=(context,section)=>!Array.isArray(context?.readable)||context.readable.includes('*')||context.readable.includes(section);
  const card=value=>String(value??'').replace(/\D/g,'')||String(value??'').trim().toUpperCase();
  function stable(value,parents=new Set(),depth=0){
    if(depth>100)return '<depth>';if(value===undefined)return '<undefined>';if(value===null||typeof value!=='object')return JSON.stringify(value)??'<'+typeof value+'>';
    if(parents.has(value))return '<cycle>';parents.add(value);
    const result=Array.isArray(value)?'['+value.map(child=>stable(child,parents,depth+1)).join(',')+']':'{'+Object.keys(value).sort().map(field=>JSON.stringify(field)+':'+stable(value[field],parents,depth+1)).join(',')+'}';parents.delete(value);return result;
  }
  function values(row,path){
    const result=[],tokens=path.split('.');
    function walk(value,index,actual){if(index===tokens.length){result.push({value,path:actual});return;}if(!plain(value))return;
      const token=tokens[index],many=token.endsWith('[]'),field=many?token.slice(0,-2):token,next=actual?actual+'.'+field:field;
      if(many){if(Array.isArray(value[field]))value[field].forEach((child,i)=>walk(child,index+1,next+'['+i+']'));}
      else walk(value[field],index+1,next);
    }walk(row,0,'');return result;
  }
  const inspect=catalogFacts.inspect;
  function aliasIndexes(db){const result={};for(const section of catalogs){const typed=new Set(),text=new Set(),numbers=new Set();for(const row of rows(db,section))if(own(row,'mergedInto')){typed.add(key(row.id));text.add(String(row.id));if(section==='fuelCards')numbers.add(card(row.number));}result[section]={typed,text,numbers};}return result;}
  function aliasTargets(indexes,relation,row,value,path){
    let section=relation.target,expected=value,byString=false;
    if(relation.kind==='assetRef'){
      const match=typeof value==='string'&&value.match(/^([vgt]):(.+)$/);if(!match)return false;section=relation.targets[match[1]];expected=match[2];byString=true;
    }else if(relation.kind==='discriminator'){
      let selector=relation.selectorAligned===true?schema.referenceSelector(row,relation,path):values(row,relation.selector)[0]?.value;if(relation.prefix&&typeof selector==='string')selector=selector.split(':')[0];section=relation.targets[selector];
    }
    if(!catalogs.includes(section))return false;
    const index=indexes[section];return relation.kind==='lookup'?index.numbers.has(card(value)):byString?index.text.has(expected):index.typed.has(key(expected));
  }
  function descriptiveOnly(before,after){
    const permitted=new Set(['note','description','title','name','attachments','updatedAt']);
    return [...new Set([...Object.keys(before),...Object.keys(after)])].every(field=>permitted.has(field)||stable(before[field])===stable(after[field]));
  }
  function assignmentNarrows(section,before,after){
    const day=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const parsed=new Date(value+'T12:00:00Z');return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;};
    if(section!=='assetAssignments'||!day(after.to)||!day(before.from)||after.to<before.from)return false;
    if(before.to!=null&&before.to!==''&&(!day(before.to)||after.to>before.to))return false;
    return descriptiveOnly({...before,to:after.to},after);
  }
  function validateChanges(previous,next,context={}){
    if(![previous,next].some(db=>catalogs.some(section=>rows(db,section).some(row=>own(row,'mergedInto')))))return true;
    const issues=[],add=(section,row,code,field,message)=>issues.push({severity:'error',section,recordId:identifier(row?.id)?row.id:'',code,field,message});
    const oldIssues=new Set(inspect(previous).issues.map(issue=>stable([issue.section,issue.recordId,issue.code,issue.field,issue.proof])));
    for(const issue of inspect(next).issues)if(!oldIssues.has(stable([issue.section,issue.recordId,issue.code,issue.field,issue.proof])))issues.push(issue);
    const introduced=[];
    for(const section of catalogs){const before=rows(previous,section),after=rows(next,section);
      for(const row of before)if(own(row,'mergedInto')){
        const matches=after.filter(item=>item.id===row.id),saved=matches.length===1?matches[0]:matches.find(item=>stable(item)===stable(row));
        if(!saved||stable(saved.mergedInto)!==stable(row.mergedInto)||saved.archived!==row.archived||stable(saved.archivedAt)!==stable(row.archivedAt))add(section,row,'CATALOG_ALIAS_IMMUTABLE','mergedInto','Объединение и исходную карточку нельзя удалить, восстановить или изменить напрямую');
        else if(!descriptiveOnly(row,saved))add(section,row,'CATALOG_ALIAS_SOURCE_FROZEN','content','У архивного дубля сохраняются реквизиты, нормы, остатки и прочие исходные факты; доступны только описательные уточнения');
      }
      for(const row of after)if(own(row,'mergedInto')){
        const matches=before.filter(item=>item.id===row.id);if(matches.length!==1||!own(matches[0],'mergedInto'))introduced.push({section,row});
      }
    }
    if(introduced.length){
      try{
        const intent=context.commandIntent,command=intent?.command;
        if(command?.type!=='MergeCatalog'||context.actor?.role!=='admin'||intent.operation?.id!==context.id)throw Error('Объединение создаётся только предметной командой администратора');
        const merge=getMerge();if(!merge||merge.apiVersion!==1)throw Error('Не загружены правила объединения');
        const planned=merge.plan(previous,command.input,{id:context.id,now:context.now,today:context.now?.slice(0,10),actor:context.actor,readable:context.readable});
        const expected={...previous,...planned.sections};
        if(schema.sections.some(section=>section!=='auditLog'&&stable(next[section]||[])!==stable(expected[section]||[])))throw Error('Состав изменения не совпадает с проверенной командой объединения');
      }catch(error){for(const {section,row}of introduced)add(section,row,'CATALOG_ALIAS_COMMAND_REQUIRED','mergedInto',error.message||'Требуется проверенная команда объединения');}
    }
    // Existing historical references remain attached to their original card.
    // A new fact, or a changed factual field, cannot reuse the archived alias.
    const indexes=aliasIndexes(next),priorAliases=aliasIndexes(previous),oldRows={},nextRows={};
    if(recordIdentity?.apiVersion!==1||typeof recordIdentity.rowIdentity!=='function'){const error=new Error('Не загружены устойчивые идентификаторы записей');error.code='MODULE_UNAVAILABLE';throw error;}
    const rowKey=(section,row,index)=>recordIdentity.rowIdentity(section,row,index);
    for(const section of schema.sections){const before=rows(previous,section),exact=new Set(before.map(row=>stable(row))),byId=new Map();before.forEach((row,index)=>{const value=rowKey(section,row,index);if(!byId.has(value))byId.set(value,[]);byId.get(value).push(row);});oldRows[section]={exact,byId};}
    for(const section of schema.sections){const byId=new Map();rows(next,section).forEach((row,index)=>{const value=rowKey(section,row,index);if(!byId.has(value))byId.set(value,[]);byId.get(value).push(row);});nextRows[section]=byId;}
    const graph=getGraph();if(graph?.apiVersion!==1||typeof graph.classify!=='function'){const error=new Error('Не загружена классификация связей справочников');error.code='MODULE_UNAVAILABLE';throw error;}
    const today=typeof context.today==='string'?context.today:typeof context.now==='string'?context.now.slice(0,10):new Date().toISOString().slice(0,10);
    for(const relation of schema.relations){if(relation.kind==='historical')continue;const prior=oldRows[relation.from];
      for(const [index,before]of rows(previous,relation.from).entries()){
        const protectedLink=values(before,relation.field).some(entry=>aliasTargets(priorAliases,relation,before,entry.value,entry.path)&&graph.classify(relation.from,before,entry.path,today,previous).classification!=='mutable');
        if(!protectedLink)continue;
        const matches=nextRows[relation.from].get(rowKey(relation.from,before,index))||[];
        if(matches.some(row=>stable(row)===stable(before)))continue;
        if(matches.length===1&&(descriptiveOnly(before,matches[0])||assignmentNarrows(relation.from,before,matches[0])))continue;
        add(relation.from,before,'CATALOG_ALIAS_HISTORY_FROZEN',relation.field,'Историческую ссылку на дубль нельзя удалить или перепривязать к основной карточке; исходный факт сохраняется');
      }
      for(const [index,row]of rows(next,relation.from).entries()){
        if(!values(row,relation.field).some(entry=>aliasTargets(indexes,relation,row,entry.value,entry.path)))continue;
        if(prior.exact.has(stable(row)))continue;
        const matches=prior.byId.get(rowKey(relation.from,row,index))||[];
        if(matches.length===1&&(descriptiveOnly(matches[0],row)||assignmentNarrows(relation.from,matches[0],row)))continue;
        add(relation.from,row,'CATALOG_ALIAS_NEW_FACT',relation.field,'Для нового или изменённого факта выберите действующую основную карточку; историческая ссылка на дубль сохраняется');
      }
    }
    if(issues.length){
      const safe=issues.map(issue=>readable(context,issue.section)?issue:{severity:'error',section:issue.section,recordId:'',code:issue.code,field:'',message:'Изменение затрагивает недоступные связи справочника'});
      const error=new Error(safe.slice(0,5).map(issue=>issue.message).join('; '));error.name='CatalogPolicyError';error.code='CATALOG_POLICY_VIOLATION';error.status=409;error.issues=safe;error.details={issues:safe};throw error;
    }
    return true;
  }
  return Object.freeze({apiVersion:1,catalogSections:catalogs,inspect,validateChanges});
});
