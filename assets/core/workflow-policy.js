/* Shared dispatch readiness and completion details. No DOM, storage or clock. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(() => require('./personnel-planning.js'),() => require('./business-calendar.js'));
  else root.WorkflowPolicy = factory(() => root.PersonnelPlanning,() => root.BusinessCalendar);
})(typeof globalThis === 'object' ? globalThis : this, function (getPlanning,getCalendar) {
  'use strict';
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const rows = (db, section) => Array.isArray(db?.[section]) ? db[section].filter(object) : [];
  const present = value => value != null && String(value).trim() !== '';
  const text = value => typeof value === 'string' && value.trim() !== '';
  const active = new Set(['assigned','started','done','confirmed']);
  const canRead = (context, section) => !Array.isArray(context.readable) || context.readable.includes('*') || context.readable.includes(section);
  const idKey = value => typeof value + ':' + String(value);
  const rowKey = (row, index) => present(row.id) ? idKey(row.id) : '@' + index;
  const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  const assetSection = ref => typeof ref === 'string' && ({ v:'vehicles', g:'generators', t:'tanks' })[ref.split(':')[0]] || null;
  function day(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const timestamp = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0,10) === value ? timestamp : null;
  }
  function time(value,db,context={},section,row,field) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value) || day(value.slice(0,10)) === null ||
        +value.slice(11,13) > 23 || +value.slice(14,16) > 59 || +value.slice(17,19) > 59) return null;
    let calendar;try{calendar=getCalendar();}catch{}let timestamp;
    if(calendar?.apiVersion===1&&db){try{if(row&&typeof calendar.timeAt==='function'){const parsed=calendar.timeAt(db,section,row,field);if(parsed.status!=='known'||parsed.instant===null)return null;timestamp=Date.parse(parsed.instant);}else{const resolved=calendar.resolve(db,context.now||(context.today?context.today+'T12:00:00.000Z':'2000-01-01T12:00:00.000Z')),parsed=calendar.parseTime(value,{timeZone:resolved.timeZone});timestamp=typeof parsed.instant==='number'?parsed.instant:Date.parse(parsed.instant);}}catch{return null;}}
    else timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  function workDays(db,job,context) {
    let calendar;try{calendar=getCalendar();}catch{}
    if(calendar?.apiVersion===1){try{const saved=calendar.persistedInterval?.(db,'dispatchJobs',job,{fromField:'start',toField:'end'},context);return saved?.status==='known'&&day(saved.fromDate)!==null&&day(saved.toDate)!==null?{from:saved.fromDate,to:saved.toDate}:null;}catch{return null;}}
    return {from:job.start.slice(0,10),to:job.end.slice(0,10)};
  }
  const tokens = value => [...new Set(String(value || '').toLocaleLowerCase('ru').split(',').map(item => item.trim()).filter(Boolean))].sort();
  const subset = (current, prior) => current.every(value => prior.includes(value));
  const contained = (current, prior) => current[0] >= prior[0] && current[1] <= prior[1];
  function analyze(db, context = {}) {
    const entries = [], unavailable = new Set();
    const add = (section,row,index,code,field,message,evidence,extra = {}) => {
      const issue = { severity:'error', section, recordId:row.id ?? '', rowIndex:index, code, field, message, ...extra };
      entries.push({ issue, key:JSON.stringify([section,rowKey(row,index),code,field,extra.targetSection || '',extra.relatedRecordId ?? '']), evidence });
    };
    const missing = (job,index,dependency,rule,risk) => {
      // Warnings are aggregated by dependency; validation privately retains the
      // visible job's relevant inputs to distinguish a new use from an old row.
      entries.push({ unavailable:true, section:'dispatchJobs', row:job, index, dependency, rule, risk });
      const key = 'dispatchJobs:' + dependency;
      if (!unavailable.has(key)) {
        unavailable.add(key);
        entries.push({ warning:true, issue:{ severity:'warning',section:'dispatchJobs',recordId:'',rowIndex:-1,
          code:'WORKFLOW_DEPENDENCY_UNAVAILABLE',field:'',targetSection:dependency,
          message:'Для проверки готовности задания недоступен связанный раздел' } });
      }
    };
    if (canRead(context,'dispatchJobs')) rows(db,'dispatchJobs').forEach((job,index) => {
      if (job.archived || job.deleted || !active.has(job.status)) return;
      if(!canRead(context,'appMeta')){missing(job,index,'appMeta','calendar',[job.start,job.end,job.timeContext||null]);return;}
      const start = time(job.start,db,context,'dispatchJobs',job,'start'), end = time(job.end,db,context,'dispatchJobs',job,'end');
      if (start === null || end === null || start >= end) {if(typeof job.start==='string'&&typeof job.end==='string'&&day(job.start.slice(0,10))!==null&&day(job.end.slice(0,10))!==null)add('dispatchJobs',job,index,'WORKFLOW_DISPATCH_CALENDAR_TIME','start/end','Время задания неоднозначно или не существует в рабочем часовом поясе',{kind:'time',binding:[job.start,job.end]});return;}
      const window=workDays(db,job,context);
      if(!window){add('dispatchJobs',job,index,'WORKFLOW_DISPATCH_CALENDAR_TIME','start/end','Исторические рабочие даты задания не подтверждены',{kind:'time',binding:[job.start,job.end,job.timeContext??null]});return;}
      const startDay = window.from, endDay = window.to;
      const section = assetSection(job.assetRef);
      const assetVisible = section && canRead(context,section);
      const matchingEquipment=assetVisible?rows(db,section).filter(row=>String(row.id)===job.assetRef.slice(2)):[];
      const equipment = matchingEquipment.length===1?matchingEquipment[0]:null;
      const baseRisk = [job.assetRef,job.driverId,job.start,job.end,job.requirements || ''];
      if (section) {
        const visibleAssetStatus = equipment?.status;
        if (!assetVisible) missing(job,index,section,'asset-status',baseRisk);
        else if (!canRead(context,'assetAssignments')) missing(job,index,'assetAssignments','asset-status',[baseRisk,visibleAssetStatus]);
        else if (equipment) {
          const assignments = rows(db,'assetAssignments').filter(row => !row.archived && !row.deleted && row.status !== 'cancelled' &&
            row.assetRef === job.assetRef && day(row.from) !== null && row.from <= startDay && (!row.to || row.to >= startDay))
            .sort((a,b) => String(b.from).localeCompare(String(a.from)));
          const effective = { ...equipment, ...(assignments[0] || {}) };
          if (/ремонт|списан|дтп|продан/i.test(String(effective.status || ''))) add('dispatchJobs',job,index,
            'WORKFLOW_DISPATCH_ASSET_STATUS','assetRef','Статус техники не позволяет назначение',
            { kind:'interval',binding:[job.assetRef,effective.status,assignments[0]?.id ?? null],window:[start,end] });
        }
      }
      if (!canRead(context,'workOrders')) missing(job,index,'workOrders','repair',[job.assetRef,job.start,job.end]);
      else if (present(job.assetRef)) rows(db,'workOrders').forEach((order,orderIndex) => {
        if (order.assetRef !== job.assetRef || !['approved','repairing'].includes(order.status)) return;
        if(order.downtime?.mode==='none'||!present(order.downtimeFrom))return;
        const from = time(order.downtimeFrom,db,context,'workOrders',order,'downtimeFrom'), to = present(order.downtimeTo) ? time(order.downtimeTo,db,context,'workOrders',order,'downtimeTo') : Infinity;
        if(from===null||to===null){add('dispatchJobs',job,index,'WORKFLOW_DISPATCH_REPAIR_TIME_UNKNOWN','start/end','Время простоя ремонта не подтверждено; отсутствие пересечения не доказано',{kind:'time',binding:[job.assetRef,job.start,job.end,order.id??null,order.downtimeFrom??null,order.downtimeTo??null]},{targetSection:'workOrders',relatedRecordId:order.id??'@'+orderIndex});return;}
        if (from >= end || to <= start) return;
        add('dispatchJobs',job,index,'WORKFLOW_DISPATCH_REPAIR_DOWNTIME','start/end','Задание пересекается с простоем по ремонту',
          { kind:'interval',binding:[job.assetRef],window:[Math.max(start,from),Math.min(end,to)] },
          { targetSection:'workOrders', relatedRecordId:order.id ?? '@' + orderIndex });
      });
      if (!canRead(context,'assetDocuments')) missing(job,index,'assetDocuments','document',baseRisk);
      else rows(db,'assetDocuments').forEach((document,documentIndex) => {
        if (document.archived || document.deleted || !document.mandatory || day(document.expires) === null || document.expires >= endDay) return;
        const bindings = [];
        if (present(job.assetRef) && present(document.assetRef) && document.assetRef === job.assetRef) bindings.push('asset:' + job.assetRef);
        if (present(job.driverId) && present(document.driverId) && document.driverId === job.driverId) bindings.push('driver:' + idKey(job.driverId));
        if (!bindings.length) return;
        add('dispatchJobs',job,index,'WORKFLOW_DISPATCH_DOCUMENT_EXPIRED','end','Обязательный документ истёк к дате окончания задания',
          { kind:'document',bindings,expires:document.expires,end:endDay },
          { targetSection:'assetDocuments',relatedRecordId:document.id ?? '@' + documentIndex });
      });
      if (tokens(job.requirements).length) {
        if (!canRead(context,'drivers')) missing(job,index,'drivers','skills',[job.driverId,job.requirements]);
        else {
          const driver = rows(db,'drivers').find(row => row.id === job.driverId);
          if (driver) {
            const skills = tokens(driver.skills), absent = tokens(job.requirements).filter(value => !skills.includes(value));
            if (absent.length) add('dispatchJobs',job,index,'WORKFLOW_DISPATCH_SKILLS_REQUIRED','requirements',
              'Не подтверждены все требуемые допуски сотрудника',{ kind:'skills',binding:[job.driverId],missing:absent });
          }
        }
      }
      const maintenance = section === 'vehicles' ? 'vehicleTo' : section === 'generators' ? 'toRecords' : null;
      if (maintenance) {
        if (!canRead(context,maintenance)) missing(job,index,maintenance,'maintenance',[job.assetRef,job.start,job.end]);
        else rows(db,maintenance).forEach((record,recordIndex) => {
          const target = section === 'vehicles' ? record.vehicleId : record.generatorId;
          if (!present(target) || String(target) !== job.assetRef.slice(2) || !record.planned || record.completedAt ||
              day(record.date) === null || record.date < startDay || record.date > endDay) return;
          add('dispatchJobs',job,index,'WORKFLOW_DISPATCH_MAINTENANCE','start/end','В интервале задания запланировано незавершённое ТО',
            { kind:'interval',binding:[job.assetRef,record.date],window:[day(startDay),day(endDay)] },
            { targetSection:maintenance,relatedRecordId:record.id ?? '@' + recordIndex });
        });
      }
    });
    for (const [section,status,field,code,message] of [
      ['opsTasks','closed','result','WORKFLOW_TASK_RESULT_REQUIRED','Укажите результат решения задачи'],
      ['shiftReports','rejected','rejectionReason','WORKFLOW_SHIFT_REJECTION_REQUIRED','Укажите причину отклонения сменной формы'],
      ['shiftReports','accepted','acceptedBy','WORKFLOW_SHIFT_ACCEPTANCE_REQUIRED','Укажите принявшего сменную форму'],
    ]) {
      if (!canRead(context,section)) continue;
      rows(db,section).forEach((row,index) => {
        if (row.status === status && !text(row[field])) add(section,row,index,code,field,message,
          { kind:'required',binding:[row[field] ?? null] });
      });
    }
    return entries;
  }
  function inspect(db, context = {}) {
    const issues = analyze(db,context).filter(entry => entry.issue).map(entry => entry.issue);
    return { issues, counts:{ error:issues.filter(issue => issue.severity === 'error').length,
      warning:issues.filter(issue => issue.severity === 'warning').length,total:issues.length } };
  }
  function worsened(current, previous) {
    if (!previous) return true;
    const a = current.evidence, b = previous.evidence;
    if (a.kind !== b.kind) return true;
    if (a.kind === 'document') return !subset(a.bindings,b.bindings) || a.expires < b.expires || a.end > b.end;
    if (!same(a.binding,b.binding)) return true;
    if (a.kind === 'skills') return !subset(a.missing,b.missing);
    return a.kind === 'interval' && !contained(a.window,b.window);
  }
  function validateChanges(previous, next, context = {}) {
    const before = analyze(previous,context), after = analyze(next,context), issues = [];
    const prior = new Map(before.filter(entry => entry.key).map(entry => [entry.key,entry]));
    const unchangedJob=entry=>{const old=rows(previous,'dispatchJobs').filter(row=>row.id===entry.issue.recordId),current=rows(next,'dispatchJobs').filter(row=>row.id===entry.issue.recordId);return old.length===1&&current.length===1&&['assetRef','driverId','start','end','requirements','personnelRequirements','status','archived','deleted'].every(field=>same(old[0][field],current[0][field]));};
    for (const entry of after) if (entry.key && worsened(entry,prior.get(entry.key))) {
      const personnelFact=entry.issue.code==='WORKFLOW_DISPATCH_SKILLS_REQUIRED'||entry.issue.code==='WORKFLOW_DISPATCH_DOCUMENT_EXPIRED'&&entry.evidence.bindings?.some(binding=>binding.startsWith('driver:'));
      if(personnelFact&&unchangedJob(entry))continue;
      issues.push(entry.issue);
    }
    const hiddenKey = entry => JSON.stringify([rowKey(entry.row,entry.index),entry.dependency,entry.rule]);
    const hiddenBefore = new Map(before.filter(entry => entry.unavailable).map(entry => [hiddenKey(entry),entry]));
    const inaccessible = new Set();
    for (const entry of after.filter(entry => entry.unavailable)) {
      const old = hiddenBefore.get(hiddenKey(entry));
      if (old && same(old.risk,entry.risk)) continue;
      const key = JSON.stringify([rowKey(entry.row,entry.index),entry.dependency]);
      if (inaccessible.has(key)) continue;
      inaccessible.add(key);
      issues.push({ severity:'error',section:'dispatchJobs',recordId:entry.row.id ?? '',rowIndex:entry.index,
        code:'WORKFLOW_DEPENDENCY_UNAVAILABLE',field:'',targetSection:entry.dependency,
        message:'Для нового назначения или изменения его условий нужен доступ к связанному разделу' });
    }
    if (issues.length) {
      const error = new Error(issues.slice(0,5).map(issue => issue.message).join('; '));
      error.name = 'WorkflowPolicyError'; error.code = 'WORKFLOW_VIOLATION'; error.issues = issues; error.details = { issues }; throw error;
    }
    let planning;try{planning=getPlanning();}catch{}if(planning?.apiVersion===1)planning.validateChanges(previous,next,context);else if(rows(next,'drivers').some(row=>Object.hasOwn(row,'personnelPlanning'))||['vehicles','generators','dispatchJobs'].some(section=>rows(next,section).some(row=>Object.hasOwn(row,'personnelRequirements'))))throw Object.assign(Error('Не загружено датированное планирование сотрудников'),{code:'MODULE_UNAVAILABLE'});
    return true;
  }
  function intervalOverlap(db,first,second,context={}){
    if(!canRead(context,'appMeta'))return null;
    const interval=value=>{if(!object(value))return null;const old=rows(db,'dispatchJobs').filter(row=>present(value.id)&&row.id===value.id);if(old.length>1)return null;const persisted=old.length===1&&old[0].start===value.start&&old[0].end===value.end?old[0]:null,start=time(value.start,db,context,persisted?'dispatchJobs':undefined,persisted,'start'),end=time(value.end,db,context,persisted?'dispatchJobs':undefined,persisted,'end');return start!==null&&end!==null&&start<end?[start,end]:null;};
    const a=interval(first),b=interval(second);return a&&b?a[0]<b[1]&&b[0]<a[1]:null;
  }
  return Object.freeze({ apiVersion:1,inspect,validateChanges,intervalOverlap });
});
