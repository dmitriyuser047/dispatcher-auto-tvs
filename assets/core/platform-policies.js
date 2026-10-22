/* Shared dispatch, acceptance and inventory rules from the existing workflows. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(() => require('./personnel-engine.js'),() => require('./fuel-movement-policy.js'),() => require('./document-lifecycle.js'),() => require('./workflow-policy.js'),()=>require('./temporal-policy.js'),()=>require('./catalog-policy.js'),()=>require('./entity-identity.js'));
  else root.PlatformPolicies = factory(() => root.TvsPersonnelEngine,() => root.FuelMovementPolicy,() => root.DocumentLifecycle,() => root.WorkflowPolicy,()=>root.TemporalPolicy,()=>root.CatalogPolicy,()=>root.EntityIdentity);
})(typeof globalThis === 'object' ? globalThis : this, function (getPersonnel,getFuelMovements,getDocuments,getWorkflow,getTemporal,getCatalog,getIdentity) {
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
  function dispatchOverlapPeers(jobs) {
    const peers=jobs.map(()=>new Set()),groups=new Map();
    const entries=jobs.map((job,index)=>{
      const start=job.start,end=job.end;
      return {job,index,start:date(start,true)?Date.parse(start):null,end:date(end,true)?Date.parse(end):null,
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
  function partStockIndex(movements) {
    const groups=new Map();
    for(const row of movements){
      if(row.cancelled||row.deleted||!date(row.date,false)||row.partId!==row.partId)continue;
      if(!groups.has(row.partId))groups.set(row.partId,{entries:[],safe:true,absolute:0,cache:new Map()});
      const group=groups.get(row.partId),amount=(['receipt','return'].includes(row.kind)?1:-1)*(Number(row.qty)||0);
      group.entries.push({date:row.date,amount});group.absolute+=Math.abs(amount);
      if(!Number.isSafeInteger(amount)||group.absolute>Number.MAX_SAFE_INTEGER)group.safe=false;
    }
    return (partId,until)=>{
      const group=groups.get(partId);if(!group||partId!==partId)return 0;
      if(!group.safe){
        // Reordering IEEE-754 additions changes legacy deficits. Decimal/unsafe
        // inputs retain the exact original left fold, memoized per part/date.
        if(!group.cache.has(until))group.cache.set(until,group.entries.reduce((sum,entry)=>entry.date<=until?sum+entry.amount:sum,0));
        return group.cache.get(until);
      }
      if(!group.prefix){
        const ordered=group.entries.slice().sort((a,b)=>a.date.localeCompare(b.date));let total=0;
        group.prefix=ordered.map(entry=>({date:entry.date,balance:total+=entry.amount}));
      }
      let low=0,high=group.prefix.length;while(low<high){const middle=(low+high)>>>1;if(group.prefix[middle].date<=until)low=middle+1;else high=middle;}
      return low?group.prefix[low-1].balance:0;
    };
  }
  function inspect(db, context) {
    context = context || {};
    const issues = [];
    const add = (section,row,code,field,message,proof,extra) => issues.push({ severity:'error',section,recordId:row.id ?? '',code,field,message,proof,...extra });
    const jobs = rows(db,'dispatchJobs'), dispatchIndex=dispatchOverlapPeers(jobs);
    for (const [jobIndex,job] of jobs.entries()) {
      const interval=dispatchIndex.intervals[jobIndex];
      if (interval.start===null || interval.end===null || interval.start>=interval.end)
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
      if (order.downtimeFrom && order.downtimeTo && Date.parse(order.downtimeFrom) > Date.parse(order.downtimeTo))
        add('workOrders',order,'WORK_ORDER_INTERVAL','downtimeFrom/downtimeTo','Конец простоя раньше начала',[order.downtimeFrom,order.downtimeTo]);
      if (order.status === 'accepted') for (const [field,label] of [['acceptedBy','принявший'],['result','результат'],['downtimeTo','конец простоя']])
        if (!present(order[field])) add('workOrders',order,'WORK_ORDER_ACCEPTANCE_REQUIRED',field,'Для приёмки нужен ' + label,[order[field]]);
    }
    const clock = new Date(context.now || Date.now());
    const localDay = Number.isFinite(clock.getTime()) ? `${clock.getFullYear()}-${String(clock.getMonth()+1).padStart(2,'0')}-${String(clock.getDate()).padStart(2,'0')}` : '';
    const today = date(context.today,false) ? context.today : localDay;
    const movements = rows(db,'partMovements');
    const stockAt = partStockIndex(movements);
    for (const row of movements) {
      if (!(Number.isFinite(Number(row.qty)) && Number(row.qty) > 0)) add('partMovements',row,'PART_QUANTITY','qty','Количество должно быть больше нуля',[row.qty]);
      if (!['receipt','return','issue','writeoff'].includes(row.kind)) add('partMovements',row,'PART_KIND','kind','Неизвестный вид складской операции',[row.kind]);
      if (!present(row.partId) || !rows(db,'parts').some(part => part.id === row.partId)) add('partMovements',row,'PART_REQUIRED','partId','Выберите существующую номенклатуру',[row.partId]);
      if (row.cancelled || row.deleted || !['issue','writeoff'].includes(row.kind) || !date(row.date,false)) continue;
      for (const [field,at,label] of [['date',row.date,'на дату операции'],['today',today,'на текущую дату']]) {
        const balance = stockAt(row.partId,at);
        if (balance < -1e-9) add('partMovements',row,'PART_STOCK_DEFICIT',field,'Недостаточно остатка на складе ' + label,[row.partId,at],{ partId:row.partId,deficit:-balance });
      }
    }
    const personnel = getPersonnel();
    if (personnel && personnel.apiVersion === 1) issues.push(...personnel.inspect(db,context).issues);
    for (const module of [getFuelMovements(),getDocuments(),getWorkflow(),getTemporal()]) if (module && module.apiVersion === 1) issues.push(...module.inspect(db,context).issues);
    const catalog=catalogModule(db);if(catalog)issues.push(...catalog.inspect(db,context).issues);
    return { issues,counts:{ error:issues.filter(issue=>issue.severity==='error').length,warning:issues.filter(issue=>issue.severity==='warning').length,total:issues.length } };
  }
  function validateChanges(previous,next,context) {
    const old = inspect(previous,context).issues, current = inspect(next,context).issues;
    const key = issue => JSON.stringify([issue.section,issue.recordId,issue.code,issue.field,issue.relatedRecordId || '']);
    const prior = new Map(old.map(issue => [key(issue),issue]));
    const blocking = current.filter(issue => {
      // Personnel uses field/assignment delta semantics below. Its read-only
      // report may show legacy rows and active links that need manual review.
      if (/^(PERSONNEL_|FUEL_|DOCUMENT_|WORKFLOW_|TEMPORAL_|CATALOG_)/.test(issue.code)) return false;
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
    for (const module of [getDocuments(),getFuelMovements(),getWorkflow(),getTemporal()]) {
      if (!module || module.apiVersion !== 1) {
        const error = new Error('Не загружены правила проведения документов и движения топлива');error.code='MODULE_UNAVAILABLE';throw error;
      }
      module.validateChanges(previous,next,context);
    }
    const catalog=catalogModule(previous,next);if(catalog)catalog.validateChanges(previous,next,context);
    return true;
  }
  return Object.freeze({ apiVersion:1,inspect,validateChanges });
});
