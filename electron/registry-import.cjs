'use strict';
const path=require('node:path'),core=require('../assets/core/registry-import.js');
function validateChanges(previous,next,{dataDir,principal}={}){
  core.validateChanges(previous,next);
  const before=new Map((previous.savedReestrs||[]).map(entry=>[core.typed(entry.id),JSON.stringify(entry)]));
  const access=require('./access-context.cjs').create(previous,next,principal);
  for(const entry of next.savedReestrs||[]){
    if(entry.kind!=='payment-registry'||before.get(core.typed(entry.id))===JSON.stringify(entry))continue;
    const old=(previous.savedReestrs||[]).find(item=>item.id===entry.id),oldRows=new Map((old?.rows||[]).map(row=>[row.id,row]));
    for(const row of entry.rows||[]){if(row.contragentId!==null&&row.contragentId!==undefined&&oldRows.get(row.id)?.contragentId!==row.contragentId){const party=(next.contragents||[]).find(item=>item.id===row.contragentId);if(!party||!access.canRead('contragents',party,'after'))throw Object.assign(Error('Нет доступа к контрагенту счёта.'),{code:'ACCESS_DENIED',status:403});}if(!row.serviceRef||JSON.stringify(oldRows.get(row.id)?.serviceRef)===JSON.stringify(row.serviceRef))continue;const target=core.serviceTarget(next,row.serviceRef);if(!access.canRead(row.serviceRef.section,target.row,'after'))throw Object.assign(Error('Нет доступа к записи ремонта или ТО.'),{code:'ACCESS_DENIED',status:403});}
    if(typeof dataDir!=='string')throw Object.assign(Error('Не подтверждён каталог оригинала реестра.'),{code:'REGISTRY_SOURCE'});
    const sources=require('./import-source.cjs').inventorySupport,file=path.join(sources.root(dataDir,false),entry.source.id);
    const bytes=require('./safe-file.cjs').readRegularFileSync(file,{maxBytes:25*1024*1024,minBytes:1});
    const descriptor=sources.descriptor({name:entry.source.name,bytes});
    if(descriptor.id!==entry.source.id||descriptor.sha256!==entry.source.sha256||descriptor.size!==entry.source.size)throw Object.assign(Error('Оригинал реестра изменён или не найден.'),{code:'REGISTRY_SOURCE'});
  }
}
module.exports={validateChanges};
