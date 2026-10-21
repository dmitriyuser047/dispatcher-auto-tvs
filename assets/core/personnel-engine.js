/* Shared personnel directory and assignment rules. No storage, DOM or clock writes. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TvsPersonnelEngine = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const own = (row, field) => !!row && Object.prototype.hasOwnProperty.call(row, field);
  const object = row => row !== null && typeof row === 'object' && !Array.isArray(row);
  const rows = (db, section) => Array.isArray(db?.[section]) ? db[section].filter(object) : [];
  const kinds = Object.freeze(['driver', 'operator']);
  const statuses = Object.freeze(['active', 'vacation', 'sick', 'unavailable']);
  const credentialFields = Object.freeze(['driverLicenseExpires', 'medicalExpires', 'briefingExpires', 'certificateExpires']);
  const statusLabels = { vacation:'В отпуске', sick:'На больничном', unavailable:'Недоступен' };
  const roleLabels = { driver:'водитель', operator:'оператор ДЭС' };
  const present = value => value !== undefined && value !== null && value !== '';
  const idKey = value => typeof value + ':' + String(value);
  const stable = value => value === undefined ? 'undefined' : JSON.stringify(value);
  function dateValid(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(value + 'T12:00:00Z');
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === value;
  }
  function rolesOf(row) {
    if (!object(row)) return [];
    // Old directory entries were drivers. Do not rewrite their rows during reads.
    if (!own(row, 'personnelRoles')) return ['driver'];
    if (!Array.isArray(row.personnelRoles)) return [];
    return kinds.filter(kind => row.personnelRoles.includes(kind));
  }
  function kindForAsset(assetRef) {
    if (typeof assetRef !== 'string') return null;
    if (/^v:.+$/.test(assetRef)) return 'driver';
    if (/^g:.+$/.test(assetRef)) return 'operator';
    return null;
  }
  function matchesRole(row, kind) { return kinds.includes(kind) && rolesOf(row).includes(kind); }
  function availability(row, _date) {
    if (!object(row)) return { available:false, status:'unavailable', reason:'Сотрудник не найден' };
    if (row.archived || row.deleted) return { available:false, status:'archived', reason:'Сотрудник в архиве' };
    const status = own(row, 'employmentStatus') ? row.employmentStatus : 'active';
    if (status === 'active') return { available:true, status, reason:'' };
    return { available:false, status, reason:statusLabels[status] || 'Недопустимый статус сотрудника' };
  }
  function readable(context, section) {
    return !Array.isArray(context?.readable) || context.readable.includes('*') || context.readable.includes(section);
  }
  function todayFor(context) {
    if (dateValid(context?.today)) return context.today;
    const date = new Date(context?.now || Date.now());
    return Number.isFinite(date.getTime()) ? `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}` : '';
  }
  function employeeIssues(row, rowIndex) {
    const issues = [];
    const add = (code, field, message) => issues.push({ severity:'error', section:'drivers', recordId:row.id ?? '', rowIndex, code, field, message, proof:row[field] });
    if (typeof row.name !== 'string' || !row.name.trim()) add('PERSONNEL_NAME', 'name', 'Укажите ФИО сотрудника');
    if (own(row, 'personnelRoles') && (!Array.isArray(row.personnelRoles) || row.personnelRoles.length === 0 || row.personnelRoles.some(role => !kinds.includes(role)) || new Set(row.personnelRoles).size !== row.personnelRoles.length))
      add('PERSONNEL_ROLES', 'personnelRoles', 'Выберите водителя, оператора ДЭС или обе роли без повторений');
    if (own(row, 'employmentStatus') && !statuses.includes(row.employmentStatus)) add('PERSONNEL_STATUS', 'employmentStatus', 'Выберите допустимый статус сотрудника');
    for (const field of credentialFields) if (present(row[field]) && !dateValid(row[field])) add('PERSONNEL_DATE', field, 'Проверьте дату допуска сотрудника');
    return issues;
  }
  function linkRelevant(section, row, today) {
    if (row.archived || row.deleted || row.status === 'cancelled') return false;
    if (section === 'assetAssignments') return !dateValid(row.to) || !today || row.to >= today;
    if (section === 'dispatchJobs') return !['done','confirmed'].includes(row.status) && (!row.end || !today || row.end.slice(0,10) >= today);
    return row.status !== 'accepted' && (!dateValid(row.date) || !today || row.date >= today);
  }
  function liveReferences(db, employeeId, today, archive) {
    const references=[];
    for (const section of ['assetAssignments','dispatchJobs','shiftReports']) for (const row of rows(db,section)) {
      if (row.driverId !== employeeId || row.archived || row.deleted || row.status === 'cancelled') continue;
      // Unfinished jobs and unaccepted shifts need resolution before archiving,
      // even if their planned date has already passed.
      const relevant = archive && section === 'dispatchJobs' ? !['done','confirmed'].includes(row.status) :
        archive && section === 'shiftReports' ? row.status !== 'accepted' : linkRelevant(section,row,today);
      if (relevant) references.push({section,row,kind:kindForAsset(row.assetRef)});
    }
    return references;
  }
  function linkIssues(db, section, row, rowIndex, severity) {
    const kind = kindForAsset(row.assetRef);
    if (!kind || !present(row.driverId)) return [];
    const employee = rows(db, 'drivers').find(person => person.id === row.driverId);
    const base = { severity, section, recordId:row.id ?? '', rowIndex, field:'driverId', targetSection:'drivers', targetId:row.driverId };
    if (!employee) return [{ ...base, code:'PERSONNEL_NOT_FOUND', message:'Выберите существующего сотрудника', proof:[row.driverId,row.assetRef] }];
    const issues = [];
    if (!matchesRole(employee, kind)) issues.push({ ...base, code:'PERSONNEL_ROLE_MISMATCH', message:'Для выбранной техники нужен ' + roleLabels[kind], proof:[row.driverId,row.assetRef,employee.personnelRoles] });
    const state = availability(employee);
    if (!state.available) issues.push({ ...base, code:'PERSONNEL_UNAVAILABLE', message:state.reason + ': новое назначение недоступно', proof:[row.driverId,row.assetRef,state.status] });
    return issues;
  }
  function assignmentOverlaps(db) {
    const groups=new Map(), overlaps=[];
    rows(db,'assetAssignments').forEach((row,index)=>{
      if (row.archived || row.deleted || row.status==='cancelled' || typeof row.assetRef!=='string' || !row.assetRef || !dateValid(row.from) || present(row.to) && !dateValid(row.to)) return;
      const end=present(row.to)?row.to:'9999-12-31';
      if (end<row.from) return;
      if (!groups.has(row.assetRef)) groups.set(row.assetRef,[]);
      groups.get(row.assetRef).push({row,index,end});
    });
    for (const [assetRef,entries] of groups) for (let first=0;first<entries.length;first++) for (let second=first+1;second<entries.length;second++) {
      const a=entries[first], b=entries[second], from=a.row.from>b.row.from?a.row.from:b.row.from, to=a.end<b.end?a.end:b.end;
      if (from>to) continue;
      const identities=[present(a.row.id)?idKey(a.row.id):'@'+a.index,present(b.row.id)?idKey(b.row.id):'@'+b.index].sort();
      overlaps.push({key:JSON.stringify([assetRef,...identities]),from,to,issue:{severity:'error',section:'assetAssignments',recordId:a.row.id??'',relatedRecordId:b.row.id??'',rowIndex:a.index,
        field:'from/to',code:'PERSONNEL_ASSIGNMENT_OVERLAP',message:'Периоды закрепления одной техники пересекаются. Завершите прежнее назначение до начала нового.',proof:[assetRef,from,to]}});
    }
    return overlaps;
  }
  function inspect(db, context = {}) {
    const issues = [], today = todayFor(context);
    if (readable(context, 'drivers')) rows(db, 'drivers').forEach((row,index) => {
      issues.push(...employeeIssues(row,index));
      if (row.archived || row.deleted) return;
      for (const field of credentialFields) if (dateValid(row[field]) && today && row[field] < today)
        issues.push({ severity:'warning', section:'drivers', recordId:row.id ?? '', rowIndex:index, code:'PERSONNEL_DOCUMENT_EXPIRED', field, message:'Истёк срок документа сотрудника', proof:[row[field],today] });
    });
    if (readable(context, 'drivers')) for (const section of ['assetAssignments','dispatchJobs','shiftReports']) {
      if (!readable(context, section)) continue;
      rows(db, section).forEach((row,index) => { if (linkRelevant(section,row,today)) issues.push(...linkIssues(db,section,row,index,'warning')); });
    }
    if (readable(context,'assetAssignments')) issues.push(...assignmentOverlaps(db).map(overlap=>overlap.issue));
    return { issues, counts:{ error:issues.filter(issue=>issue.severity==='error').length, warning:issues.filter(issue=>issue.severity==='warning').length, total:issues.length } };
  }
  function validateChanges(previous, next, context = {}) {
    const issues = [], today=todayFor(context), oldEmployees = new Map(rows(previous,'drivers').map(row => [idKey(row.id),row]));
    rows(next,'drivers').forEach((row,index) => {
      const before = oldEmployees.get(idKey(row.id));
      if (before && stable(before) === stable(row)) return;
      // A touched legacy employee must have a usable name. Other unchanged old
      // invalid fields can be repaired independently instead of blocking work.
      const priorIssues = new Map(before ? employeeIssues(before,index).map(issue=>[issue.code+':'+issue.field,issue]) : []);
      for (const issue of employeeIssues(row,index)) {
        const old = priorIssues.get(issue.code+':'+issue.field);
        if (issue.code === 'PERSONNEL_NAME' || !old || stable(old.proof) !== stable(issue.proof)) issues.push(issue);
      }
      const wasArchived = before && (before.archived || before.deleted);
      if ((row.archived || row.deleted) && !wasArchived) {
        const references=liveReferences(next,row.id,today,true);
        if (references.length) issues.push({ severity:'error',section:'drivers',recordId:row.id??'',rowIndex:index,field:row.deleted?'deleted':'archived',code:'PERSONNEL_ARCHIVE_IN_USE',
          message:'Сначала завершите назначения, задания и непринятые смены сотрудника',proof:references.length });
      }
      if (before) for (const kind of kinds) {
        if (!matchesRole(before,kind) || matchesRole(row,kind)) continue;
        const references=liveReferences(next,row.id,today,false).filter(item=>item.kind===kind);
        if (references.length) issues.push({ severity:'error',section:'drivers',recordId:row.id??'',rowIndex:index,field:'personnelRoles',code:'PERSONNEL_ROLE_IN_USE',
          message:'Нельзя снять роль «'+roleLabels[kind]+'»: есть действующие или будущие назначения. Сначала завершите или переназначьте их.',proof:[kind,references.length] });
      }
    });
    for (const section of ['assetAssignments','dispatchJobs','shiftReports']) {
      const beforeRows = new Map(rows(previous,section).map(row => [idKey(row.id),row]));
      rows(next,section).forEach((row,index) => {
        const before = beforeRows.get(idKey(row.id));
        // Historical links do not become invalid merely because a directory
        // card changes. Explicit new/reassigned/reopened links use current rules.
        const reassigned = !before || before.driverId !== row.driverId || before.assetRef !== row.assetRef ||
          (!!before.archived && !row.archived) || (!!before.deleted && !row.deleted) || (before.status === 'cancelled' && row.status !== 'cancelled');
        if (!reassigned || row.archived || row.deleted || row.status === 'cancelled') return;
        if (!readable(context,'drivers') && present(row.driverId)) {
          issues.push({ severity:'error',section,recordId:row.id??'',rowIndex:index,field:'driverId',code:'PERSONNEL_ACCESS_DENIED',message:'Нет доступа к справочнику сотрудников для нового назначения' });return;
        }
        issues.push(...linkIssues(next,section,row,index,'error'));
      });
    }
    const previousOverlaps=new Map(assignmentOverlaps(previous).map(overlap=>[overlap.key,overlap]));
    for (const overlap of assignmentOverlaps(next)) {
      const old=previousOverlaps.get(overlap.key);
      // Existing overlap can be reduced or resolved independently. New days of
      // double assignment are a regression even when another end was shortened.
      if (!old || overlap.from<old.from || overlap.to>old.to) issues.push(overlap.issue);
    }
    if (issues.length) {
      const error = new Error(issues.slice(0,5).map(issue=>issue.message).join('; '));
      error.name='PersonnelValidationError'; error.code='PERSONNEL_VALIDATION'; error.issues=issues; error.details={issues}; throw error;
    }
    return true;
  }
  return Object.freeze({ apiVersion:1, rolesOf, kindForAsset, matchesRole, availability, inspect, validateChanges });
});
