/* Trusted lifecycle guards for posted movements and accepted shift documents. */
(function(root,factory){'use strict';if(typeof module==='object'&&module.exports)module.exports=factory();else root.DocumentLifecycle=factory();})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const own=(row,key)=>Object.prototype.hasOwnProperty.call(row,key);
  const rows=(db,section)=>Array.isArray(db?.[section])?db[section].filter(row=>row&&typeof row==='object'&&!Array.isArray(row)):[];
  const present=value=>value!==undefined&&value!==null&&String(value).trim()!=='';
  const key=value=>typeof value+':'+String(value);
  const metadata=new Set(['attachments','updatedAt']);
  const inversePart={receipt:'writeoff',issue:'return',writeoff:'return',return:'issue'};
  function stable(value){if(value===undefined)return 'undefined';if(value===null||typeof value!=='object')return JSON.stringify(value);return Array.isArray(value)?'['+value.map(stable).join(',')+']':'{'+Object.keys(value).sort().map(name=>JSON.stringify(name)+':'+stable(value[name])).join(',')+'}';}
  const number=value=>typeof value==='number'&&Number.isFinite(value)?value:typeof value==='string'&&value.trim()&&Number.isFinite(Number(value))?Number(value):NaN;
  const sameQty=(a,b)=>Number.isFinite(number(a))&&Number.isFinite(number(b))&&number(a)===number(b);
  const sameRef=(a,b)=>!present(a)&&!present(b)||a===b;
  const active=row=>!!row&&!row.cancelled&&!row.deleted;
  function equalExcept(before,after,allowed){return [...new Set([...Object.keys(before),...Object.keys(after)])].every(field=>allowed.has(field)||stable(before[field])===stable(after[field]));}
  function reversalCheck(db,section,original) {
    const list=rows(db,section),reversal=list.find(row=>row.id===original?.reversedBy);
    if(!original||!reversal||original.id===reversal.id||!active(original)||!active(reversal)||original.originalMovementId||reversal.reversedBy||reversal.originalMovementId!==original.id||
      list.filter(row=>row.originalMovementId===original.id).length!==1||!sameQty(original.qty,reversal.qty)||!(number(original.qty)>0)||!present(reversal.reason)||
      !present(original.reversedAt)||original.reversedAt!==reversal.createdAt||!Number.isFinite(Date.parse(original.reversedAt)))return false;
    if(section==='fuelMovements')return reversal.kind==='adjustment'&&reversal.date===original.date&&sameRef(reversal.fromTankId,original.toTankId)&&
      sameRef(reversal.toTankId,original.fromTankId)&&sameRef(reversal.assetRef,original.assetRef)&&stable(reversal.sourceSnapshot??null)===stable(original.sourceSnapshot??null);
    return reversal.kind===inversePart[original.kind]&&reversal.partId===original.partId&&reversal.date===original.date&&sameRef(reversal.assetRef,original.assetRef)&&
      sameRef(reversal.workOrderId,original.workOrderId);
  }
  function inspect(db,context={}) {
    const canRead=section=>!Array.isArray(context.readable)||context.readable.includes('*')||context.readable.includes(section),issues=[];
    if(canRead('shiftReports'))for(const row of rows(db,'shiftReports'))if(row.status==='accepted'&&!present(row.acceptedBy))issues.push({severity:'error',section:'shiftReports',recordId:row.id??'',code:'DOCUMENT_ACCEPTANCE_REQUIRED',field:'acceptedBy',message:'Для принятой сменной формы укажите принявшего',proof:row.acceptedBy});
    for(const section of ['fuelMovements','partMovements'])if(canRead(section))for(const row of rows(db,section)) {
      if(!present(row.reversedBy)&&!present(row.originalMovementId))continue;
      const original=present(row.originalMovementId)?rows(db,section).find(item=>item.id===row.originalMovementId):row;
      if(!reversalCheck(db,section,original))issues.push({severity:'error',section,recordId:row.id??'',code:'DOCUMENT_REVERSAL_INVALID',field:present(row.originalMovementId)?'originalMovementId':'reversedBy',message:'Сторно должно содержать единственное согласованное обратное движение с причиной',proof:[row.originalMovementId,row.reversedBy,row.qty,row.date]});
    }
    return {issues,counts:{error:issues.length,warning:0,total:issues.length}};
  }
  function validateChanges(previous,next) {
    const issues=[],add=(section,row,code,field,message)=>issues.push({severity:'error',section,recordId:row.id??'',code,field,message});
    for(const section of ['fuelMovements','partMovements','shiftReports']) {
      const beforeRows=rows(previous,section),afterRows=rows(next,section),beforeById=new Map(beforeRows.map(row=>[key(row.id),row])),afterById=new Map(afterRows.map(row=>[key(row.id),row]));
      for(const before of beforeRows) {
        if(section==='shiftReports'&&before.status!=='accepted')continue;
        const after=afterById.get(key(before.id));
        if(!after){add(section,before,'DOCUMENT_DELETE_FORBIDDEN','id','Проведённый документ нельзя удалить. Оформите исправление с сохранением исходника');continue;}
        if(equalExcept(before,after,metadata))continue;
        const allowed=new Set([...metadata,'reversedBy','reversedAt']);
        const isNewReversal=section!=='shiftReports'&&!before.originalMovementId&&!before.reversedBy&&after.reversedBy&&!beforeById.has(key(after.reversedBy))&&
          reversalCheck(next,section,after)&&equalExcept(before,after,allowed);
        if(!isNewReversal)add(section,before,'DOCUMENT_FROZEN','content',section==='shiftReports'?'Принятая сменная форма неизменяема. Создайте корректировку':'Проведённое движение неизменяемо. Оформите согласованное сторно или отдельный возврат');
      }
    }
    const old=inspect(previous).issues,newIssues=inspect(next).issues,signature=issue=>stable([issue.section,issue.recordId,issue.code,issue.field,issue.proof]),existing=new Set(old.map(signature));
    issues.push(...newIssues.filter(issue=>!existing.has(signature(issue))));
    // A newly submitted reversal must be valid even if an old malformed pair has
    // the same outward error; unrelated legacy damage is otherwise grandfathered.
    for(const section of ['fuelMovements','partMovements']) {
      const oldById=new Map(rows(previous,section).map(row=>[key(row.id),row]));
      for(const row of rows(next,section))if(row.originalMovementId&&!oldById.has(key(row.id))) {
        const original=rows(next,section).find(item=>item.id===row.originalMovementId);
        if(!reversalCheck(next,section,original))add(section,row,'DOCUMENT_REVERSAL_INVALID','originalMovementId','Некорректное обратное движение: исходник, количество, дата и направление должны совпадать');
      }
    }
    if(issues.length){const error=new Error(issues.slice(0,5).map(issue=>issue.message).join('; '));error.name='DocumentLifecycleError';error.code='POLICY_VIOLATION';error.issues=issues;error.details={issues};throw error;}
    return true;
  }
  return Object.freeze({apiVersion:1,inspect,validateChanges,reversalCheck});
});
