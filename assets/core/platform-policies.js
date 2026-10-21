/* Shared dispatch, acceptance and inventory rules from the existing workflows. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(() => require('./personnel-engine.js'),() => require('./fuel-movement-policy.js'),() => require('./document-lifecycle.js'),() => require('./workflow-policy.js'));
  else root.PlatformPolicies = factory(() => root.TvsPersonnelEngine,() => root.FuelMovementPolicy,() => root.DocumentLifecycle,() => root.WorkflowPolicy);
})(typeof globalThis === 'object' ? globalThis : this, function (getPersonnel,getFuelMovements,getDocuments,getWorkflow) {
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
  const overlap = (a,b) => date(a.start,true) && date(a.end,true) && date(b.start,true) && date(b.end,true) && Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end);
  function asset(db, ref) {
    if (typeof ref !== 'string' || !/^[vgt]:/.test(ref)) return null;
    return rows(db, { v:'vehicles',g:'generators',t:'tanks' }[ref[0]]).find(row => String(row.id) === ref.slice(2));
  }
  function inspect(db, context) {
    context = context || {};
    const issues = [];
    const add = (section,row,code,field,message,proof,extra) => issues.push({ severity:'error',section,recordId:row.id ?? '',code,field,message,proof,...extra });
    const jobs = rows(db,'dispatchJobs');
    for (const job of jobs) {
      if (!date(job.start,true) || !date(job.end,true) || Date.parse(job.start) >= Date.parse(job.end))
        add('dispatchJobs',job,'DISPATCH_INTERVAL','start/end','Начало задания должно быть раньше окончания',[job.start,job.end]);
      if (!job.archived && assigned.has(job.status)) {
        if (!asset(db,job.assetRef)) add('dispatchJobs',job,'DISPATCH_ASSET_REQUIRED','assetRef','Для назначения нужна существующая техника',[job.status,job.assetRef]);
        if (!rows(db,'drivers').some(driver => driver.id === job.driverId)) add('dispatchJobs',job,'DISPATCH_DRIVER_REQUIRED','driverId','Для назначения нужен существующий сотрудник',[job.status,job.driverId]);
        for (const other of jobs) {
          if (other === job || other.id === job.id || other.archived || ['cancelled','done','confirmed'].includes(other.status) || !overlap(job,other)) continue;
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
    const stockAt = (partId, until) => movements.filter(row => row.partId === partId && !row.cancelled && !row.deleted && date(row.date,false) && row.date <= until)
      .reduce((total,row) => total + (['receipt','return'].includes(row.kind) ? 1 : -1) * (Number(row.qty) || 0),0);
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
    for (const module of [getFuelMovements(),getDocuments(),getWorkflow()]) if (module && module.apiVersion === 1) issues.push(...module.inspect(db,context).issues);
    return { issues,counts:{ error:issues.filter(issue=>issue.severity==='error').length,warning:issues.filter(issue=>issue.severity==='warning').length,total:issues.length } };
  }
  function validateChanges(previous,next,context) {
    const old = inspect(previous,context).issues, current = inspect(next,context).issues;
    const key = issue => JSON.stringify([issue.section,issue.recordId,issue.code,issue.field,issue.relatedRecordId || '']);
    const prior = new Map(old.map(issue => [key(issue),issue]));
    const blocking = current.filter(issue => {
      // Personnel uses field/assignment delta semantics below. Its read-only
      // report may show legacy rows and active links that need manual review.
      if (/^(PERSONNEL_|FUEL_|DOCUMENT_|WORKFLOW_)/.test(issue.code)) return false;
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
    for (const module of [getDocuments(),getFuelMovements(),getWorkflow()]) {
      if (!module || module.apiVersion !== 1) {
        const error = new Error('Не загружены правила проведения документов и движения топлива');error.code='MODULE_UNAVAILABLE';throw error;
      }
      module.validateChanges(previous,next,context);
    }
    return true;
  }
  return Object.freeze({ apiVersion:1,inspect,validateChanges });
});
