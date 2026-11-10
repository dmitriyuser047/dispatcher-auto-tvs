(function(root,factory){'use strict';if(typeof module==='object'&&module.exports)module.exports=factory(()=>require('./registry-import.js'),()=>require('./request-fingerprint.js'));else root.RegistryAccounting=factory(()=>root.RegistryImport,()=>root.RequestFingerprint);})(typeof globalThis==='object'?globalThis:this,function(getCore,getFingerprint){
  'use strict';
  const text=value=>String(value??'').trim();
  const fail=(message,code='REGISTRY_ACCOUNTING')=>{throw Object.assign(Error(message),{code});};
  const normalized=value=>text(value).toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/\s+/g,' ');
  const number=value=>normalized(value).replace(/^№\s*/,'').replace(/\s+/g,'');
  const registerNumber=value=>number(value).replace(/\//g,'-');
  const sorted=values=>[...new Set(values)].sort();
  const canonical=value=>JSON.stringify(value);
  const compare=(a,b)=>a<b?-1:a>b?1:0;
  const digest=value=>'sha256:'+getFingerprint().sha256(canonical(value));
  const invoiceKey=(registerId,invoiceId)=>canonical([getCore().typed(registerId),getCore().typed(invoiceId)]);
  const registerKey=registerId=>canonical(['register',getCore().typed(registerId)]);
  const includedIndexes=new WeakMap();
  const decisionKey=decision=>canonical([decision.groupId,decision.basis,sorted(decision.includedKeys),decision.separate,decision.reason]);
  const invoiceId=invoice=>invoice.registryInvoiceId??invoice.id;

  function safeAmount(value){try{return getCore().amount(value);}catch{return null;}}
  function sum(values){try{return getCore().total(values);}catch{return null;}}
  function buyer(entry,invoice){return getCore().key(invoice?.buyerOrganization||entry.buyerOrganization);}
  function uins(invoice){
    const found=[];
    if(/^\d{20}(?:\d{5})?$/.test(text(invoice.uin)))found.push(text(invoice.uin));
    const source=[invoice.description,invoice.osn,invoice.invoiceNo].map(text).join('\n');
    for(const match of source.matchAll(/(?:^|[^а-яa-z0-9])(?:уин|уникальный идентификатор начисления)\s*[:№#-]?\s*(\d{25}|\d{20})(?!\d)/giu))found.push(match[1]);
    return sorted(found);
  }
  function invoiceFacts(entry,invoice){
    const core=getCore(),details=core.invoiceDetails(invoice.osn),date=core.isoDate(invoice.date)||details.date;
    return [core.typed(entry.id),core.typed(invoiceId(invoice)),text(entry.source?.sha256),text(entry.source?.table),registerNumber(entry.number),core.isoDate(entry.date),buyer(entry,invoice),core.key(invoice.supplier||invoice.contractor),number(invoice.invoiceNo||details.invoiceNo),date,safeAmount(invoice.sum),text(invoice.description),text(invoice.osn),uins(invoice)];
  }
  function tokenFor(entry,invoice){
    const core=getCore(),details=core.invoiceDetails(invoice.osn),supplier=core.key(invoice.supplier||invoice.contractor),no=number(invoice.invoiceNo||details.invoiceNo),date=core.isoDate(invoice.date)||details.date;
    return {identity:supplier&&no&&date?canonical(['invoice',supplier,no,date]):null,base:supplier&&no?canonical(['invoice-without-date',supplier,no]):null,date};
  }
  function components(nodes,tokens){
    const parent=nodes.map((_,index)=>index),find=index=>{while(parent[index]!==index){parent[index]=parent[parent[index]];index=parent[index];}return index;},join=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent[b]=a;},buckets=new Map();
    for(let index=0;index<nodes.length;index++)for(const token of tokens(nodes[index])){
      if(!buckets.has(token.key))buckets.set(token.key,{buyers:new Map(),unknown:null,global:null});
      const bucket=buckets.get(token.key),scope=nodes[index].buyer;
      if(token.global){if(bucket.global!==null)join(index,bucket.global);else bucket.global=index;continue;}
      if(scope){
        if(bucket.buyers.has(scope))join(index,bucket.buyers.get(scope));else bucket.buyers.set(scope,index);
        if(bucket.unknown!==null)join(index,bucket.unknown);
      }else if(bucket.unknown!==null)join(index,bucket.unknown);
      else{bucket.unknown=index;for(const representative of bucket.buyers.values())join(index,representative);}
    }
    const groups=new Map();for(let index=0;index<nodes.length;index++){const root=find(index);if(!groups.has(root))groups.set(root,[]);groups.get(root).push(nodes[index]);}
    return [...groups.values()].filter(group=>group.length>1);
  }
  function metadata(entry){return entry.registryAccounting;}
  function validDecision(decision,group,owner){
    const members=group.members.filter(member=>owner===undefined||getCore().typed(member.registerId)===owner);
    if(!decision||decision.groupId!==group.id||decision.basis!==group.basis||typeof decision.reason!=='string'||text(decision.reason).length<3||typeof decision.separate!=='boolean'||!Array.isArray(decision.includedKeys)||!Array.isArray(decision.memberKeys)||canonical(sorted(decision.memberKeys))!==canonical(members.map(member=>member.key).sort()))return false;
    if(!decision.includedKeys.length||new Set(decision.includedKeys).size!==decision.includedKeys.length||decision.includedKeys.some(key=>typeof key!=='string'||!group.members.some(member=>member.key===key)))return false;
    return decision.separate||decision.includedKeys.length===1;
  }
  function applyDecision(group,entries){
    const owners=sorted(group.members.map(member=>getCore().typed(member.registerId))),found=[];
    for(const owner of owners){
      const entry=entries.get(owner),meta=metadata(entry);
      if(meta?.version!==1||!Array.isArray(meta.decisions))return group;
      const decisions=meta.decisions.filter(decision=>decision.groupId===group.id);
      if(decisions.length!==1||!validDecision(decisions[0],group,owner))return group;
      found.push(decisions[0]);
    }
    if(!found.length||found.some(decision=>decisionKey(decision)!==decisionKey(found[0])))return group;
    return {...group,resolved:true,includedKeys:sorted(found[0].includedKeys),separate:found[0].separate,reason:found[0].reason,choice:found[0].separate?'separate':'single'};
  }
  function groupFor(kind,nodes,identity,entries,staleId){
    const members=nodes.map(node=>node.member).sort((a,b)=>compare(a.key,b.key)),facts=nodes.map(node=>[node.member.key,node.facts]).sort((a,b)=>compare(a[0],b[0]));
    const id=staleId||kind+':'+digest([sorted(identity),sorted(nodes.map(node=>node.buyer))]),basis=digest(facts),title=staleId?'Изменённые реквизиты — повторная сверка':kind==='version'?'Версии или одноимённые реестры':'Повторяющиеся счета / УИН';
    return applyDecision({id,kind,title,basis,members,resolved:false,includedKeys:[],separate:false,reason:'',stale:!!staleId,restricted:nodes.some(node=>node.restricted)},entries);
  }
  function staleGroups(kind,nodes,currentGroups,entries){
    const existing=new Map(currentGroups.map(group=>[group.id,group])),references=new Map(),byKey=new Map(nodes.map(node=>[node.member.key,node])),naturalByMembers=new Map(currentGroups.filter(group=>!group.stale).map(group=>[canonical(group.members.map(member=>member.key).sort()),group]));
    for(const entry of entries.values())for(const decision of Array.isArray(metadata(entry)?.decisions)?metadata(entry).decisions:[]){
      if(typeof decision.groupId!=='string'||!decision.groupId.startsWith(kind+':')||!Array.isArray(decision.memberKeys))continue;
      if(!references.has(decision.groupId))references.set(decision.groupId,new Set());
      for(const key of decision.memberKeys)references.get(decision.groupId).add(key);
    }
    for(const [id,keys]of references){
      const current=existing.get(id);for(const member of current?.members||[])keys.add(member.key);
      const members=[...keys].map(key=>byKey.get(key)).filter(Boolean);
      if(members.length&&(!current||members.length!==current.members.length)){
        // Filling missing dates can change the natural token while the reviewed
        // documents stay the same. Keep the review identity and refresh its basis.
        if(!current){const memberKeys=canonical(members.map(node=>node.member.key).sort()),equivalent=naturalByMembers.get(memberKeys);if(equivalent){existing.delete(equivalent.id);naturalByMembers.delete(memberKeys);}}
        existing.set(id,groupFor(kind,members,[],entries,id));
      }
    }
    return [...existing.values()];
  }
  function applyState(item,group,memberKey,reviewReason){
    if(item.state==='excluded')return;
    if(!group.resolved){item.state='review';item.reason=reviewReason;}
    else if(!group.includedKeys.includes(memberKey)){item.state='excluded';item.reason=group.reason;}
    else if(item.state==='included')item.reason=group.reason;
  }
  function project(database,options={}){
    const core=getCore(),entries=new Map(),invoices=[],registerNodes=[],byRegister=new Map(),groups=[];
    for(const entry of database.savedReestrs||[]){
      if(!core.isImportedRegister(entry))continue;
      const entryKey=core.typed(entry.id);entries.set(entryKey,entry);
      const rows=core.invoices(entry),items=rows.map(invoice=>{
        const id=invoiceId(invoice),key=invoiceKey(entry.id,id),facts=invoiceFacts(entry,invoice);
        return {key,registerId:entry.id,invoiceId:id,state:'included',reason:'',sum:safeAmount(invoice.sum),registerNumber:text(entry.number),registerDate:core.isoDate(entry.date),invoiceNo:text(invoice.invoiceNo||invoice.osn),date:core.isoDate(invoice.date),supplier:text(invoice.supplier),description:text(invoice.description),buyer:buyer(entry,invoice),facts,invoice,entry};
      });
      invoices.push(...items);byRegister.set(entryKey,items);
      const title=text(entry.title)||'Реестр №'+text(entry.number)+' от '+text(entry.date),invoiceBuyers=sorted(items.map(item=>item.buyer)),scope=buyer(entry)||(invoiceBuyers.length===1?invoiceBuyers[0]:''),no=registerNumber(entry.number),date=core.isoDate(entry.date);
      registerNodes.push({buyer:scope,identity:no&&date?canonical(['register',no,date]):null,source:entry.source?.sha256?canonical(['source',entry.source.sha256,text(entry.source.table)]):null,facts:[scope,...items.map(item=>item.facts).sort((a,b)=>compare(canonical(a),canonical(b)))],restricted:!options.ignoreView&&entry.registryAccountingView?.restricted===true,member:{key:registerKey(entry.id),registerId:entry.id,label:title,sum:sum(items.map(item=>item.sum))}});
    }
    const versions=components(registerNodes,node=>[...(node.identity?[{key:node.identity}]:[]),...(node.source?[{key:node.source,global:true}]:[])]),versionGroups=[];
    for(const nodes of versions){
      const identity=nodes.map(node=>node.identity).filter(Boolean),group=groupFor('version',nodes,identity.length?identity:nodes.map(node=>node.source).filter(Boolean),entries);versionGroups.push(group);
    }
    for(const group of options.ignoreStale?versionGroups:staleGroups('version',registerNodes,versionGroups,entries)){
      groups.push(group);
      for(const member of group.members)for(const item of byRegister.get(core.typed(member.registerId))||[]){
        applyState(item,group,member.key,'Выберите учитываемую версию реестра или подтвердите разные обязательства.');
      }
    }
    const candidates=invoices.filter(item=>item.state==='included').map(item=>({item,buyer:item.buyer,...tokenFor(item.entry,item.invoice),uins:uins(item.invoice),facts:item.facts,restricted:!options.ignoreView&&item.entry.registryAccountingView?.restricted===true,member:{key:item.key,registerId:item.registerId,invoiceId:item.invoiceId,label:[item.supplier,item.invoiceNo||'Без номера','реестр №'+item.registerNumber].filter(Boolean).join(' · '),sum:item.sum}}));
    // A missing date is uncertainty, never proof that the same supplier/number
    // denotes a different invoice. Build this bridge once for each base identity.
    const missingDates=new Set(candidates.filter(node=>node.base&&!node.date).map(node=>node.base));
    for(const node of candidates)if(node.base&&missingDates.has(node.base))node.identity=node.base;
    const duplicates=components(candidates,node=>[...(node.identity?[{key:node.identity}]:[]),...node.uins.map(uin=>({key:canonical(['uin',uin]),global:true}))]),invoiceGroups=[];
    for(const nodes of duplicates){
      const group=groupFor('invoice',nodes,nodes.flatMap(node=>[node.identity,...node.uins.map(uin=>canonical(['uin',uin]))].filter(Boolean)),entries);invoiceGroups.push(group);
    }
    const candidateIndex=new Map(candidates.map(node=>[node.member.key,node]));
    for(const group of options.ignoreStale?invoiceGroups:staleGroups('invoice',candidates,invoiceGroups,entries)){
      groups.push(group);
      for(const member of group.members){const node=candidateIndex.get(member.key);if(node)applyState(node.item,group,node.member.key,'Выберите один учитываемый счёт или подтвердите разные обязательства.');}
    }
    if(!options.ignoreView)for(const item of invoices){
      const view=item.entry.registryAccountingView;if(view?.version!==1)continue;
      const matches=Array.isArray(view.invoices)?view.invoices.filter(row=>row.invoiceId===item.invoiceId):[];
      const trusted=matches.length===1&&['included','excluded','review'].includes(matches[0].state)?matches[0]:null;
      item.state=trusted?.state||'review';item.reason=trusted?text(trusted.reason):'Состояние учёта счёта не подтверждено сервером.';
    }
    const publicInvoices=invoices.map(({facts,invoice,entry,buyer,...item})=>item),summary={};
    for(const state of ['included','excluded','review']){const selected=publicInvoices.filter(item=>item.state===state);summary[state]={invoices:selected.length,sum:sum(selected.map(item=>item.sum))};}
    const report={invoices:publicInvoices,groups,summary};includedIndexes.set(report,new Set(publicInvoices.filter(item=>item.state==='included').map(item=>item.key)));return report;
  }
  function included(database,entry,row,projection){
    const key=invoiceKey(entry.id,row.registryInvoiceId??row.id),current=projection||project(database);
    if(!includedIndexes.has(current))includedIndexes.set(current,new Set(current.invoices.filter(item=>item.state==='included').map(item=>item.key)));
    return includedIndexes.get(current).has(key);
  }
  function validateMetadata(meta){
    if(!meta||typeof meta!=='object'||Array.isArray(meta)||meta.version!==1||!Array.isArray(meta.decisions)||Object.keys(meta).some(key=>!['version','decisions'].includes(key)))fail('Не подтверждён формат решения по учёту реестра.');
    const seen=new Set();for(const decision of meta.decisions){
      if(!decision||typeof decision!=='object'||Array.isArray(decision)||Object.keys(decision).some(key=>!['groupId','basis','memberKeys','includedKeys','separate','reason'].includes(key))||typeof decision.groupId!=='string'||!decision.groupId||typeof decision.basis!=='string'||!decision.basis||!Array.isArray(decision.memberKeys)||!decision.memberKeys.length||decision.memberKeys.some(key=>typeof key!=='string'||!key)||new Set(decision.memberKeys).size!==decision.memberKeys.length||!Array.isArray(decision.includedKeys)||!decision.includedKeys.length||decision.includedKeys.some(key=>typeof key!=='string'||!key)||new Set(decision.includedKeys).size!==decision.includedKeys.length||typeof decision.separate!=='boolean'||typeof decision.reason!=='string'||text(decision.reason).length<3||seen.has(decision.groupId))fail('Проверьте решение по повтору и основание сверки.');
      if(!decision.separate&&decision.includedKeys.length!==1)fail('Для повтора можно учитывать только один документ. Для разных обязательств нужно отдельное подтверждение.','REGISTRY_DOUBLE_COUNT');
      seen.add(decision.groupId);
    }
  }
  function validateChanges(previous,next){
    const core=getCore(),before=new Map((previous.savedReestrs||[]).map(entry=>[core.typed(entry.id),entry])),changed=[];
    for(const entry of next.savedReestrs||[]){
      const old=before.get(core.typed(entry.id)),meta=metadata(entry),oldMeta=old&&metadata(old);
      if(canonical(meta)===canonical(oldMeta))continue;
      if(oldMeta!==undefined&&meta===undefined)fail('Сохранённое решение по учёту потеряно. Обновите программу и откройте реестр заново.');
      if(!core.isImportedRegister(entry))fail('Решение по учёту относится только к загруженному реестру.');
      validateMetadata(meta);
      const oldDecisions=new Map((oldMeta?.decisions||[]).map(decision=>[decision.groupId,decision]));
      for(const id of oldDecisions.keys())if(!meta.decisions.some(decision=>decision.groupId===id))fail('Сохранённое решение по повтору нельзя удалять без новой сверки.');
      for(const decision of meta.decisions)if(canonical(decision)!==canonical(oldDecisions.get(decision.groupId)))changed.push({entry,decision});
    }
    if(!changed.length)return;
    const projection=project(next,{ignoreView:true}),groups=new Map(projection.groups.map(group=>[group.id,group])),allowed=new Set([...project(previous,{ignoreView:true}).groups,...project(next,{ignoreView:true,ignoreStale:true}).groups].map(group=>group.id));
    for(const {entry,decision}of changed){
      const group=groups.get(decision.groupId);
      if(!group||!allowed.has(group.id)||!group.members.some(member=>core.typed(member.registerId)===core.typed(entry.id))||!validDecision(decision,group,core.typed(entry.id))||!group.resolved)fail('Состав или реквизиты повторов изменились. Откройте сверку заново; решение должно сохраняться для всех документов группы.');
    }
  }
  function resolve(database,input){
    if(!input||typeof input.groupId!=='string'||!Array.isArray(input.includedKeys)||new Set(input.includedKeys).size!==input.includedKeys.length||typeof input.separate!=='boolean'||typeof input.reason!=='string'||text(input.reason).length<3)fail('Выберите учитываемый документ и укажите основание сверки.');
    const current=project(database),group=current.groups.find(item=>item.id===input.groupId);
    if(!group||input.basis!==undefined&&input.basis!==group.basis)fail('Состав или реквизиты повторов изменились. Откройте сверку заново.');
    if(group.restricted)fail('Для сверки нужен доступ ко всем документам группы. Обратитесь к администратору.');
    const decision={groupId:group.id,basis:group.basis,memberKeys:group.members.map(member=>member.key).sort(),includedKeys:sorted(input.includedKeys),separate:input.separate,reason:text(input.reason)};
    if(!validDecision(decision,group))fail('Выберите один учитываемый документ или явно подтвердите разные обязательства.','REGISTRY_DOUBLE_COUNT');
    const owners=new Set(group.members.map(member=>getCore().typed(member.registerId)));
    const savedReestrs=(database.savedReestrs||[]).map(entry=>{
      if(!owners.has(getCore().typed(entry.id)))return entry;
      const old=metadata(entry);if(old!==undefined)validateMetadata(old);
      return {...entry,registryAccounting:{version:1,decisions:[...(old?.decisions||[]).filter(item=>item.groupId!==group.id),{...decision,memberKeys:group.members.filter(member=>getCore().typed(member.registerId)===getCore().typed(entry.id)).map(member=>member.key).sort(),includedKeys:[...decision.includedKeys]}]}};
    });
    validateChanges(database,{...database,savedReestrs});return savedReestrs;
  }
  return Object.freeze({invoiceKey,registerKey,project,included,resolve,validateChanges});
});
