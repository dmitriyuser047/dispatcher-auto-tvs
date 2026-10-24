/* Catalog alias facts and diagnostics. No merge commands or integrity orchestration. */
(function(root,factory){'use strict';if(typeof module==='object'&&module.exports)module.exports=factory();else root.CatalogFacts=factory();})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const catalogs=Object.freeze(['vehicles','generators','tanks','drivers','parts','contragents','fuelCards']);
  const own=(row,key)=>!!row&&Object.prototype.hasOwnProperty.call(row,key);
  const plain=value=>value!==null&&Object.prototype.toString.call(value)==='[object Object]';
  const identifier=value=>typeof value==='string'&&!!value.trim()||typeof value==='number'&&Number.isFinite(value);
  const key=value=>typeof value+':'+JSON.stringify(value);
  const rows=(db,section)=>Array.isArray(db?.[section])?db[section].filter(plain):[];
  const readable=(context,section)=>!Array.isArray(context?.readable)||context.readable.includes('*')||context.readable.includes(section);
  function stable(value,parents=new Set(),depth=0){
    if(depth>100)return '<depth>';if(value===undefined)return '<undefined>';if(value===null||typeof value!=='object')return JSON.stringify(value)??'<'+typeof value+'>';
    if(parents.has(value))return '<cycle>';parents.add(value);
    const result=Array.isArray(value)?'['+value.map(child=>stable(child,parents,depth+1)).join(',')+']':'{'+Object.keys(value).sort().map(field=>JSON.stringify(field)+':'+stable(value[field],parents,depth+1)).join(',')+'}';parents.delete(value);return result;
  }
  function metadataValid(value,section){
    return plain(value)&&Object.keys(value).sort().join('|')==='actor|at|id|operationId|reason|section|version'&&value.version===1&&value.section===section&&identifier(value.id)&&
      typeof value.reason==='string'&&!!value.reason.trim()&&value.reason.length<=4000&&typeof value.operationId==='string'&&/^[a-zA-Z0-9._:-]{1,200}$/.test(value.operationId)&&
      typeof value.at==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(value.at)&&Number.isFinite(Date.parse(value.at))&&plain(value.actor)&&Object.keys(value.actor).sort().join('|')==='id|name|role'&&
      typeof value.actor.id==='string'&&!!value.actor.id&&typeof value.actor.name==='string'&&!!value.actor.name&&value.actor.role==='admin';
  }
  function inspect(db,context={}){
    const issues=[],add=(section,row,code,field,message,proof,severity='error')=>issues.push({severity,section,recordId:identifier(row?.id)?row.id:'',code,field,message,proof});
    for(const section of catalogs){if(!readable(context,section))continue;const list=rows(db,section);
      for(const row of list){if(!own(row,'mergedInto'))continue;const metadata=row.mergedInto;
        if(!metadataValid(metadata,section)){add(section,row,'CATALOG_ALIAS_INVALID','mergedInto','Повреждены реквизиты объединения карточки',stable(metadata));continue;}
        if(row.archived!==true||row.archivedAt!==metadata.at)add(section,row,'CATALOG_ALIAS_NOT_ARCHIVED','archived','Объединённая карточка должна сохраняться в архиве',[row.archived,row.archivedAt,metadata.at]);
        const targets=list.filter(target=>target.id===metadata.id);
        if(targets.length!==1){add(section,row,'CATALOG_ALIAS_TARGET','mergedInto.id','Не удалось однозначно найти основную карточку',[metadata.id,targets.length]);continue;}
        const target=targets[0];
        if(target===row||target.deleted||own(target,'mergedInto'))add(section,row,'CATALOG_ALIAS_TARGET','mergedInto.id','Основная карточка должна сохраняться как самостоятельная запись; цепочки объединений недопустимы',[metadata.id,target.deleted,stable(target.mergedInto)]);
        const seen=new Set([key(row.id)]);let current=row;
        while(metadataValid(current.mergedInto,section)){
          const targetKey=key(current.mergedInto.id);if(seen.has(targetKey)){add(section,row,'CATALOG_ALIAS_CYCLE','mergedInto.id','Объединение содержит циклическую ссылку',targetKey);break;}
          seen.add(targetKey);const matches=list.filter(item=>item.id===current.mergedInto.id);if(matches.length!==1)break;current=matches[0];
        }
      }
    }
    return {issues,counts:{error:issues.filter(issue=>issue.severity==='error').length,warning:0,total:issues.length}};
  }
  return Object.freeze({apiVersion:1,catalogs,metadataValid,inspect});
});
