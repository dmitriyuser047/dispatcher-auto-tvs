/* Read-only acceptance and reversal facts, independent of document planning. */
(function(root,factory){'use strict';if(typeof module==='object'&&module.exports)module.exports=factory();else root.DocumentFacts=factory();})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const rows=(db,section)=>Array.isArray(db?.[section])?db[section].filter(row=>row&&typeof row==='object'&&!Array.isArray(row)):[];
  const present=value=>value!==undefined&&value!==null&&String(value).trim()!=='';
  const inversePart={receipt:'writeoff',issue:'return',writeoff:'return',return:'issue',supplierReturn:'return'};
  function stable(value){if(value===undefined)return 'undefined';if(value===null||typeof value!=='object')return JSON.stringify(value);return Array.isArray(value)?'['+value.map(stable).join(',')+']':'{'+Object.keys(value).sort().map(name=>JSON.stringify(name)+':'+stable(value[name])).join(',')+'}';}
  const number=value=>typeof value==='number'&&Number.isFinite(value)?value:typeof value==='string'&&value.trim()&&Number.isFinite(Number(value))?Number(value):NaN;
  const sameQty=(a,b)=>Number.isFinite(number(a))&&Number.isFinite(number(b))&&number(a)===number(b);
  const sameRef=(a,b)=>!present(a)&&!present(b)||a===b;
  const active=row=>!!row&&!row.cancelled&&!row.deleted;
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
  return Object.freeze({apiVersion:1,reversalCheck,inspect});
});
