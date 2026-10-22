/* Shared dispatch, acceptance and inventory rules from the existing workflows. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(() => require('./personnel-engine.js'),() => require('./fuel-movement-policy.js'),() => require('./document-lifecycle.js'),() => require('./workflow-policy.js'),()=>require('./temporal-policy.js'),()=>require('./catalog-policy.js'),()=>require('./entity-identity.js'),()=>require('./period-policy.js'),()=>require('./platform-integrity.js'),()=>require('./inventory-stock.js'),()=>require('./procurement-operations.js'),()=>require('./cost-operations.js'),()=>require('./repair-process.js'),()=>require('./repair-operations.js'),()=>require('./calendar-operations.js'),()=>require('./business-calendar.js'));
  else root.PlatformPolicies = factory(() => root.TvsPersonnelEngine,() => root.FuelMovementPolicy,() => root.DocumentLifecycle,() => root.WorkflowPolicy,()=>root.TemporalPolicy,()=>root.CatalogPolicy,()=>root.EntityIdentity,()=>root.PeriodPolicy,()=>root.PlatformIntegrity,()=>root.InventoryStock,()=>root.ProcurementOperations,()=>root.CostOperations,()=>root.RepairProcess,()=>root.RepairOperations,()=>root.CalendarOperations,()=>root.BusinessCalendar);
})(typeof globalThis === 'object' ? globalThis : this, function (getPersonnel,getFuelMovements,getDocuments,getWorkflow,getTemporal,getCatalog,getIdentity,getPeriods,getIntegrity,getInventory,getProcurement,getCosts,getRepairs,getRepairOperations,getCalendarOperations,getCalendar) {
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
  function repairModuleRequired(previous,next){
    const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),fields=['status','assetRef','repairId','vehicleToId','toRecordId','downtime','downtimeFrom','downtimeTo','completedAt','repairProcess','defectSource','defectSnapshot'];
    for(const value of rows(next,'workOrders')){const matches=rows(previous,'workOrders').filter(old=>old.id===value.id),old=matches.length===1?matches[0]:null;if(['repairProcess','downtime','defectSource','defectSnapshot'].some(key=>Object.hasOwn(value,key)))return true;if(!old){if(value.status!=='new'||['repairId','vehicleToId','toRecordId'].some(key=>present(value[key])))return true;continue;}if(fields.some(key=>!same(old[key],value[key])))return true;if(['approved','repairing'].includes(old.status)&&['description','work','cost','repeatOf','warrantyUntil'].some(key=>!same(old[key],value[key])))return true;}
    for(const value of rows(previous,'workOrders'))if((Object.hasOwn(value,'repairProcess')||['approved','repairing','accepted','cancelled'].includes(value.status))&&!rows(next,'workOrders').some(row=>row.id===value.id))return true;
    for(const [field,name]of [['repairId','repairs'],['vehicleToId','vehicleTo'],['toRecordId','toRecords']])if([...rows(previous,'workOrders'),...rows(next,'workOrders')].some(value=>present(value[field]))&&!same(rows(previous,name),rows(next,name)))return true;
    for(const value of rows(next,'partMovements')){const matches=rows(previous,'partMovements').filter(old=>old.id===value.id),old=matches.length===1?matches[0]:null;if((present(value.workOrderId)||present(old?.workOrderId)||Object.hasOwn(value,'repairReturn')||old&&Object.hasOwn(old,'repairReturn'))&&!same(old,value))return true;}
    return false;
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
  function validateFuelChanges(previous,next,context){return getFuelMovements().validateChanges(previous,next,context);}
  function scopePeriods(db,scope){return periodsModule().scopePeriods(db,scope);}
  function inspectFuel(db,context) {return getFuelMovements().inspect(db,context);}
  function periodRowIdentity(section,row,index) {return getIntegrity().rowIdentity(section,row,index);}
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
  function validateChanges(previous,next,context) {
    const archiveRows=db=>rows(db,'appMeta').filter(row=>row.id==='document-archive-head'||row.kind==='documentArchive').map(row=>Object.keys(row).sort().map(key=>[key,row[key]]));
    if(JSON.stringify(archiveRows(previous))!==JSON.stringify(archiveRows(next))){const error=new Error('Архив печати изменяется только проверенным сохранением снимка');error.code='DOCUMENT_ARCHIVE_IMMUTABLE';error.status=403;throw error;}
    const calendar=getCalendarOperations?.();if(calendar?.apiVersion===1)calendar.validateChanges(previous,next,context);else if(['appMeta'].some(name=>JSON.stringify(rows(previous,name).filter(row=>row.id==='business-calendar'||row.kind==='businessCalendar'))!==JSON.stringify(rows(next,name).filter(row=>row.id==='business-calendar'||row.kind==='businessCalendar')))||['dispatchJobs','workOrders'].some(name=>rows(next,name).some(row=>{const matches=rows(previous,name).filter(old=>old.id===row.id),old=matches.length===1?matches[0]:{};return (name==='dispatchJobs'?['start','end','actualStart','actualEnd','timeContext']:['downtimeFrom','downtimeTo','completedAt','timeContext']).some(field=>JSON.stringify(old[field])!==JSON.stringify(row[field]));})))throw Object.assign(Error('Не загружены правила рабочего календаря'),{code:'MODULE_UNAVAILABLE'});
    const old = inspect(previous,context).issues, current = inspect(next,context).issues;
    const key = issue => JSON.stringify([issue.section,issue.recordId,issue.code,issue.field,issue.relatedRecordId || '']);
    const prior = new Map(old.map(issue => [key(issue),issue]));
    const blocking = current.filter(issue => {
      // Personnel uses field/assignment delta semantics below. Its read-only
      // report may show legacy rows and active links that need manual review.
      if (/^(PERSONNEL_|FUEL_|DOCUMENT_|WORKFLOW_|TEMPORAL_|CATALOG_|PERIOD_|PART_|PROCUREMENT_|COST_|REPAIR_)/.test(issue.code)) return false;
      const before = prior.get(key(issue));
      if (!before) return true;
      if (issue.code === 'PART_STOCK_DEFICIT') return issue.deficit > before.deficit + 1e-9;
      return JSON.stringify(before.proof) !== JSON.stringify(issue.proof);
    });
    if (blocking.length) {
      const error = new Error(blocking.map(issue => issue.message).slice(0,5).join('; '));
      error.name = 'PlatformPolicyError'; error.code = 'POLICY_VIOLATION'; error.issues = blocking; error.details = { issues:blocking }; throw error;
    }
    const personnel = getPersonnel();
    if (!personnel || personnel.apiVersion !== 1) {
      const error = new Error('Не загружено ядро сотрудников');error.code='MODULE_UNAVAILABLE';throw error;
    }
    personnel.validateChanges(previous,next,context);
    validateStockChanges(previous,next,context);
    for (const module of [getDocuments(),getFuelMovements(),getWorkflow(),getTemporal(),periodsModule()]) {
      if (!module || module.apiVersion !== 1) {
        const error = new Error('Не загружены правила проведения документов и движения топлива');error.code='MODULE_UNAVAILABLE';throw error;
      }
      module.validateChanges(previous,next,context);
    }
    const catalog=catalogModule(previous,next);if(catalog)catalog.validateChanges(previous,next,context);
    const procurement=getProcurement();if(!procurement||procurement.apiVersion!==1)throw Object.assign(Error('Не загружены правила исполнения закупок'),{code:'MODULE_UNAVAILABLE'});procurement.validateChanges(previous,next,context);
    let costs;try{costs=getCosts();}catch{}
    if(costs?.apiVersion===1)costs.validateChanges(previous,next,context);
    else if([previous,next].some(db=>['tanks','parts','vehicles','generators'].some(name=>rows(db,name).some(row=>Object.hasOwn(row,'costValuation')))||rows(db,'costEntries').some(row=>Object.hasOwn(row,'costAllocation')||row.kind==='allocation')))throw Object.assign(Error('Не загружены правила стоимости'),{code:'MODULE_UNAVAILABLE'});
    let repairs,repairOperations;try{repairs=getRepairs();repairOperations=getRepairOperations();}catch{}
    if(repairs?.apiVersion===1&&repairOperations?.apiVersion===1){repairOperations.validateChanges(previous,next,context);repairs.validateChanges(previous,next,context);}
    else if(repairModuleRequired(previous,next))throw Object.assign(Error('Не загружены правила ремонтного процесса'),{code:'MODULE_UNAVAILABLE'});
    return true;
  }
  return Object.freeze({ apiVersion:1,inspect,inspectStock,inspectFuel,periodRowIdentity,scopePeriods,validatePeriodChanges,validateStockChanges,validateFuelChanges,validateChanges });
});
