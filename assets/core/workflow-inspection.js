/* Read-only workflow diagnostics and lower period/stock checks. No command orchestration. */
(function(root,factory){'use strict';if(typeof module==='object'&&module.exports)module.exports=factory(()=>require('./personnel-engine.js'),()=>require('./fuel-movement-policy.js'),()=>require('./document-facts.js'),()=>require('./workflow-policy.js'),()=>require('./temporal-policy.js'),()=>require('./catalog-facts.js'),()=>require('./entity-identity.js'),()=>require('./period-policy.js'),()=>require('./inventory-stock.js'),()=>require('./cost-operations.js'),()=>require('./repair-process.js'),()=>require('./business-calendar.js'));else root.WorkflowInspection=factory(()=>root.TvsPersonnelEngine,()=>root.FuelMovementPolicy,()=>root.DocumentFacts,()=>root.WorkflowPolicy,()=>root.TemporalPolicy,()=>root.CatalogFacts,()=>root.EntityIdentity,()=>root.PeriodPolicy,()=>root.InventoryStock,()=>root.CostOperations,()=>root.RepairProcess,()=>root.BusinessCalendar);})(typeof globalThis==='object'?globalThis:this,function(getPersonnel,getFuelMovements,getDocuments,getWorkflow,getTemporal,getCatalog,getIdentity,getPeriods,getInventory,getCosts,getRepairs,getCalendar){
  'use strict';
  const rows = (db, section) => Array.isArray(db?.[section]) ? db[section] : [];
  const present = value => value != null && String(value).trim() !== '';
  const assigned = new Set(['assigned','started','done','confirmed']);
  function date(value, time) {
    if (typeof value !== 'string' || !(time ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?(?:Z|[+-]\d{2}:\d{2})?$/ : /^\d{4}-\d{2}-\d{2}$/).test(value)) return false;
    const day = new Date(value.slice(0,10) + 'T12:00:00Z');
    return Number.isFinite(day.getTime()) && day.toISOString().slice(0,10) === value.slice(0,10) &&
      (!time || +value.slice(11,13) < 24 && +value.slice(14,16) < 60 && (!value.slice(17,19) || +value.slice(17,19) < 60) && Number.isFinite(Date.parse(value)));
  }
  function asset(db, ref) {
    let identity;try{identity=getIdentity();}catch{}
    if(identity?.apiVersion===1){const resolved=identity.resolveAsset(db,ref);return resolved.status==='known'?resolved.row:null;}
    if (typeof ref !== 'string' || !/^[vgt]:/.test(ref)) return null;
    const matches=rows(db, { v:'vehicles',g:'generators',t:'tanks' }[ref[0]]).filter(row => String(row.id) === ref.slice(2));return matches.length===1?matches[0]:null;
  }
  function catalogModule(previous,next){let api;try{api=getCatalog();}catch{}if(api?.apiVersion===1)return api;
    if([previous,next].some(db=>['vehicles','generators','tanks','drivers','parts','contragents','fuelCards'].some(section=>rows(db,section).some(row=>Object.hasOwn(row,'mergedInto'))))){const error=new Error('Не загружены правила объединения справочников');error.code='MODULE_UNAVAILABLE';throw error;}return null;
  }
  function dispatchOverlapPeers(jobs,db) {
    const peers=jobs.map(()=>new Set()),groups=new Map();
    const entries=jobs.map((job,index)=>{
      const calendar=getCalendar?.(),a=calendar?.apiVersion===1?calendar.timeAt(db,'dispatchJobs',job,'start'):null,b=calendar?.apiVersion===1?calendar.timeAt(db,'dispatchJobs',job,'end'):null;const start=job.start,end=job.end;return {job,index,start:a?.status==='known'?Date.parse(a.instant):date(start,true)&&/(?:Z|[+-]\d{2}:\d{2})$/.test(start)?Date.parse(start):null,end:b?.status==='known'?Date.parse(b.instant):date(end,true)&&/(?:Z|[+-]\d{2}:\d{2})$/.test(end)?Date.parse(end):null,
        outer:!job.archived&&assigned.has(job.status),inner:!job.archived&&!['cancelled','done','confirmed'].includes(job.status)};
    });
    for(const entry of entries){
      if(entry.start===null||entry.end===null||!entry.outer&&!entry.inner)continue;
      for(const field of ['assetRef','driverId']){
        const value=entry.job[field];
        // Map uses SameValueZero; the old strict comparison never matches NaN.
        if(!present(value)||value!==value)continue;
        if(!groups.has(field))groups.set(field,new Map());const byValue=groups.get(field);
        if(!byValue.has(value))byValue.set(value,[]);byValue.get(value).push(entry);
      }
    }
    const pair=(a,b)=>{
      if(a.job===b.job||a.job.id===b.job.id||a.start>=b.end||b.start>=a.end)return;
      // Keep the existing asymmetric rules: done/confirmed can be outer rows;
      // new rows can be counterparts of an assigned row.
      if(a.outer&&b.inner)peers[a.index].add(b.index);
      if(b.outer&&a.inner)peers[b.index].add(a.index);
    };
    for(const byValue of groups.values())for(const group of byValue.values()){
      if(!group.some(entry=>entry.outer)||!group.some(entry=>entry.inner))continue;
      const proper=group.filter(entry=>entry.start<entry.end).sort((a,b)=>a.start-b.start||a.index-b.index);
      let activeOuter=[],activeInner=[];
      for(const entry of proper){
        if(entry.outer){activeInner=activeInner.filter(other=>other.end>entry.start);for(const other of activeInner)pair(other,entry);}
        if(entry.inner){activeOuter=activeOuter.filter(other=>other.end>entry.start);for(const other of activeOuter)if(!entry.outer||!other.inner)pair(other,entry);}
        if(entry.outer)activeOuter.push(entry);if(entry.inner)activeInner.push(entry);
      }
      // Legacy zero/reversed intervals also participated in the old strict
      // pairwise formula, even while DISPATCH_INTERVAL reported their damage.
      for(const entry of group)if(entry.start>=entry.end)for(const other of group){
        if(other===entry||other.start>=other.end&&other.index<entry.index)continue;pair(entry,other);
      }
    }
    // Inspect has always emitted outer -> original inner order -> field order.
    return {intervals:entries,peers:peers.map(set=>[...set].sort((a,b)=>a-b).map(index=>jobs[index]))};
  }
  function inventoryModule(){const api=getInventory();if(!api||api.apiVersion!==1)throw Object.assign(Error('Не загружено ядро складского запаса'),{code:'MODULE_UNAVAILABLE'});return api;}
  function inspectStock(db,context){return inventoryModule().inspect(db,context);}
  function validateStockChanges(previous,next,context){return inventoryModule().validateChanges(previous,next,context);}
  function scopePeriods(db,scope){return periodsModule().scopePeriods(db,scope);}
  function periodsModule() {const api=getPeriods();if(!api||api.apiVersion!==1){const error=new Error('Не загружены правила закрытия периодов');error.code='MODULE_UNAVAILABLE';throw error;}return api;}
  function validatePeriodChanges(previous,next,context) {return periodsModule().validateChanges(previous,next,context);}
  function inspect(db, context) {
    context = context || {};
    const issues = [];
    const add = (section,row,code,field,message,proof,extra) => issues.push({ severity:'error',section,recordId:row.id ?? '',code,field,message,proof,...extra });
    const jobs = rows(db,'dispatchJobs'), dispatchIndex=dispatchOverlapPeers(jobs,db);
    for (const [jobIndex,job] of jobs.entries()) {
      const interval=dispatchIndex.intervals[jobIndex];
      if (!date(job.start,true)||!date(job.end,true)||interval.start!==null&&interval.end!==null&&interval.start>=interval.end)
        add('dispatchJobs',job,'DISPATCH_INTERVAL','start/end','Начало задания должно быть раньше окончания',[job.start,job.end]);
      if (!job.archived && assigned.has(job.status)) {
        if (!asset(db,job.assetRef)) add('dispatchJobs',job,'DISPATCH_ASSET_REQUIRED','assetRef','Для назначения нужна существующая техника',[job.status,job.assetRef]);
        if (!rows(db,'drivers').some(driver => driver.id === job.driverId)) add('dispatchJobs',job,'DISPATCH_DRIVER_REQUIRED','driverId','Для назначения нужен существующий сотрудник',[job.status,job.driverId]);
        for (const other of dispatchIndex.peers[jobIndex]) {
          for (const [field,code,message] of [['assetRef','DISPATCH_ASSET_OVERLAP','Техника уже назначена на пересекающееся время'],['driverId','DISPATCH_DRIVER_OVERLAP','Сотрудник уже назначен на пересекающееся время']]) {
            if (present(job[field]) && job[field] === other[field]) add('dispatchJobs',job,code,field,message,
              [job[field],job.start,job.end,other.start,other.end],{ relatedRecordId:other.id ?? '' });
          }
        }
      }
      if (job.status === 'confirmed') for (const [field,label] of [['confirmedBy','принявшего'],['result','результат']])
        if (!present(job[field])) add('dispatchJobs',job,'DISPATCH_CONFIRMATION_REQUIRED',field,'Для подтверждения укажите ' + label,[job[field]]);
    }
    for (const order of rows(db,'workOrders')) {
      const calendar=getCalendar?.(),from=calendar?.apiVersion===1?calendar.timeAt(db,'workOrders',order,'downtimeFrom'):null,to=calendar?.apiVersion===1?calendar.timeAt(db,'workOrders',order,'downtimeTo'):null;if (from?.status==='known'&&to?.status==='known'&&Date.parse(from.instant)>Date.parse(to.instant))
        add('workOrders',order,'WORK_ORDER_INTERVAL','downtimeFrom/downtimeTo','Конец простоя раньше начала',[order.downtimeFrom,order.downtimeTo]);
      if (order.status === 'accepted'&&!Object.hasOwn(order,'downtime')&&!Object.hasOwn(order,'repairProcess')) for (const [field,label] of [['acceptedBy','принявший'],['result','результат'],['downtimeTo','конец простоя']])
        if (!present(order[field])) add('workOrders',order,'WORK_ORDER_ACCEPTANCE_REQUIRED',field,'Для приёмки нужен ' + label,[order[field]]);
    }
    issues.push(...inspectStock(db,context).issues);
    const personnel = getPersonnel();
    if (personnel && personnel.apiVersion === 1) issues.push(...personnel.inspect(db,context).issues);
    for (const module of [getFuelMovements(),getDocuments(),getWorkflow(),getTemporal(),periodsModule()]) if (module && module.apiVersion === 1) issues.push(...module.inspect(db,context).issues);
    const catalog=catalogModule(db);if(catalog)issues.push(...catalog.inspect(db,context).issues);
    const calendar=getCalendar?.();if(calendar?.apiVersion===1)issues.push(...calendar.inspect(db,context).issues);let costs;try{costs=getCosts();}catch{}if(costs?.apiVersion===1&&typeof costs.inspect==='function')issues.push(...costs.inspect(db,context).issues);
    let repairs;try{repairs=getRepairs();}catch{}if(repairs?.apiVersion===1)issues.push(...repairs.inspect(db,context).issues);
    return { issues,counts:{ error:issues.filter(issue=>issue.severity==='error').length,warning:issues.filter(issue=>issue.severity==='warning').length,total:issues.length } };
  }
  return Object.freeze({apiVersion:1,inspect,scopePeriods,validatePeriodChanges,validateStockChanges});
});
