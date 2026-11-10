(function(root,factory){'use strict';if(typeof module==='object'&&module.exports)module.exports=factory(require('./registry-import.js'),require('./registry-accounting.js'));else root.RegistryCounterparties=factory(root.RegistryImport,root.RegistryAccounting);})(typeof globalThis==='object'?globalThis:this,function(core,accounting){
  'use strict';
  const clone=value=>JSON.parse(JSON.stringify(value));
  const nameKey=value=>String(value??'').normalize('NFKC').trim().toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/[«»„“”"']/g,'').replace(/\s+/g,' ');
  const identifier=value=>typeof value==='string'&&value.trim()||typeof value==='number'&&Number.isFinite(value);
  function prepare(database,entries,{createId}={}){
    const list=(database.contragents||[]).slice(),added=[],ambiguous=new Set(),ids=new Map(),names=new Map();for(const party of list){const id=core.typed(party.id);if(!ids.has(id))ids.set(id,[]);ids.get(id).push(party);const name=nameKey(party.name);if(name){if(!names.has(name))names.set(name,[]);names.get(name).push(party);}}
    const result=entries.map(entry=>{if(!core.isImportedRegister(entry))return entry;let changed=false;const rows=entry.rows.map(row=>{const name=String(row.supplier||'').trim(),normalized=nameKey(name);if(!normalized)return row;let party=null;if(row.contragentId!==undefined&&row.contragentId!==null){const bound=ids.get(core.typed(row.contragentId))||[];if(bound.length===1)party=bound[0];}
      if(!party){const matches=names.get(normalized)||[];if(matches.length>1){ambiguous.add(name);return row;}if(matches.length===1)party=matches[0];else{if(typeof createId!=='function')throw Object.assign(Error('Не подтверждено создание контрагента.'),{code:'REGISTRY_COUNTERPARTY'});const id=createId();if(!identifier(id)||ids.has(core.typed(id)))throw Object.assign(Error('Не удалось создать уникальный ID контрагента.'),{code:'REGISTRY_COUNTERPARTY'});party={id,name,inn:'',contact:'',phone:'',category:'',note:'Добавлен из реестров',archived:false};list.push(party);added.push(party);ids.set(core.typed(id),[party]);names.set(normalized,[party]);}}
      if(row.contragentId===party.id)return row;changed=true;return {...clone(row),contragentId:party.id};});return changed?{...entry,rows}:entry;});
    return {entries:result,contragents:list,added,ambiguous:[...ambiguous]};
  }
  function statistics(database){
    const projection=accounting.project(database);
    const byId=new Map(),byName=new Map();for(const party of database.contragents||[]){const id=core.typed(party.id);if(!byId.has(id))byId.set(id,[]);byId.get(id).push(party);const name=nameKey(party.name);if(!byName.has(name))byName.set(name,[]);byName.get(name).push(party);}
    const groups=new Map();for(const entry of database.savedReestrs||[]){if(!core.isImportedRegister(entry))continue;for(const invoice of core.invoices(entry)){if(!accounting.included(database,entry,invoice,projection))continue;const candidates=invoice.contragentId!==undefined&&invoice.contragentId!==null?byId.get(core.typed(invoice.contragentId)):byName.get(nameKey(invoice.supplier));if(candidates?.length!==1)continue;const id=candidates[0].id;if(!groups.has(id))groups.set(id,[]);groups.get(id).push(invoice.sum);}}
    return new Map([...groups].map(([id,amounts])=>[id,{count:amounts.length,sum:core.total(amounts)}]));
  }
  return Object.freeze({nameKey,prepare,statistics});
});
