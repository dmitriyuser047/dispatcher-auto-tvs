// Drivers and DES operators share people, documents and dated assignments.
const PERSONNEL_STATUS = { active:'Работает', vacation:'В отпуске', sick:'На больничном', unavailable:'Не назначать' };
const PERSONNEL_DATES = { driverLicenseExpires:'Водительское удостоверение', certificateExpires:'Удостоверение оператора', medicalExpires:'Медосмотр', briefingExpires:'Инструктаж' };
let personnelSession = null, personnelSaving = false;
let personnelViews = {};

function personnelCanRead(section = 'drivers') {
  return typeof _sync === 'undefined' || !_sync.access || Array.isArray(_sync.access.readable) && _sync.access.readable.includes(section);
}
function personnelCanWrite(section = 'drivers') {
  return !(typeof _loadWriteBlocked !== 'undefined' && _loadWriteBlocked) &&
    (typeof _sync === 'undefined' || !_sync.access || Array.isArray(_sync.access.writable) && _sync.access.writable.includes(section));
}
function personnelIdentity() { return dispatcherContext().identity; }
function personnelKind() { return activeSection === 'operators' ? 'operator' : 'driver'; }
function personnelView(kind = personnelKind()) {
  const identity = personnelIdentity();
  if (personnelSession !== identity) { personnelSession = identity; personnelViews = {}; }
  return personnelViews[kind] || (personnelViews[kind] = { query:'', org:'', status:'', archive:false, selected:null, date:wfToday() });
}
function personnelRows(kind) {
  if (!personnelCanRead()) return [];
  return (data.drivers || []).filter(row => !kind || TvsPersonnelEngine.matchesRole(row,kind));
}
function personnelFind(id) { return personnelRows().find(row => row.id === id); }
function personnelPersonLabel(id) { return personnelFind(id)?.name || 'Сотрудник'; }
function personnelDate(value) {
  if (value == null || value === '') return '—';
  return typeof value === 'string' && PlatformIntegrity.dateValid(value,'date') ? fmtDate(value) : 'Проверьте дату';
}
function personnelAsset(ref) {
  if (typeof ref !== 'string') return null;
  const section = ref.startsWith('v:') ? 'vehicles' : ref.startsWith('g:') ? 'generators' : null;
  if (!section || !personnelCanRead(section)) return null;
  if(typeof EntityIdentity==='undefined'||typeof EntityIdentity.resolveAsset!=='function')return null;
  const resolved=EntityIdentity.resolveAsset(data,ref);
  if(resolved.status!=='known'||resolved.section!==section)return null;
  const row=resolved.row;
  return { ref, row, label:section === 'vehicles' ? [row.plate,row.make].filter(Boolean).join(' · ') : [row.name || row.code || row.number || 'ДЭС',row.model].filter(Boolean).join(' · ') };
}
function personnelAssignments(id) {
  if (!personnelCanRead('assetAssignments')) return [];
  return (data.assetAssignments || []).filter(row => row.driverId === id).slice().sort((a,b) => String(b.from || '').localeCompare(String(a.from || '')));
}
function personnelCurrentAssignments(id) {
  const today = personnelView().date || wfToday();
  return personnelAssignments(id).filter(row => !row.archived && row.from <= today && (!row.to || row.to >= today));
}
function personnelOpenLinks(id) {
  const today = wfToday(), result = [];
  personnelAssignments(id).filter(row => !row.archived && !row.deleted && (!row.to || row.to >= today)).forEach(row => result.push(row));
  for (const section of ['dispatchJobs','shiftReports']) {
    if (!personnelCanRead(section)) continue;
    (typeof DocumentEngine!=='undefined'?DocumentEngine.activeRows(data,section):data[section]||[]).filter(row => row.driverId === id && !row.archived && !row.deleted &&
      !(section === 'dispatchJobs' ? ['done','confirmed','cancelled'] : ['accepted','cancelled']).includes(row.status)).forEach(row => result.push(row));
  }
  return result;
}
function personnelLinkWarnings(person) {
  const warnings = [], links = personnelOpenLinks(person.id);
  if (links.length && !TvsPersonnelEngine.availability(person,wfToday()).available) warnings.push('Сотрудник недоступен, но у него есть незавершённые назначения или задания. Проверьте замену.');
  if (links.some(row => { const kind = TvsPersonnelEngine.kindForAsset(row.assetRef); return kind && !TvsPersonnelEngine.matchesRole(person,kind); })) warnings.push('Роль сотрудника не соответствует технике в одном из незавершённых назначений. Проверьте карточку и историю закрепления.');
  return warnings;
}
function personnelWarnings(row) {
  const today = personnelView().date || wfToday(), soon = new Date(today + 'T12:00:00Z'); soon.setUTCDate(soon.getUTCDate()+30);
  const threshold = soon.toISOString().slice(0,10), roles = TvsPersonnelEngine.rolesOf(row), warnings = [];
  Object.entries(PERSONNEL_DATES).forEach(([field,label]) => {
    if (field === 'driverLicenseExpires' && !roles.includes('driver') || field === 'certificateExpires' && !roles.includes('operator')) return;
    if (row[field] && row[field] <= threshold) warnings.push({ label, date:row[field], expired:row[field] < today });
  });
  if (personnelCanRead('assetDocuments')) (data.assetDocuments || []).filter(doc => doc.driverId === row.id && !doc.archived && doc.expires && doc.expires <= threshold)
    .forEach(doc => warnings.push({ label:doc.title || 'Документ', date:doc.expires, expired:doc.expires < today }));
  return warnings;
}
function personnelButton(action,label,id,attributes = '') {
  return `<button type="button" class="btn btn-ghost btn-sm" data-personnel-action="${action}" ${id === undefined ? '' : `data-personnel-id="${htmlEsc(String(id))}" data-personnel-key="${htmlEsc(JSON.stringify(id))}"`} ${attributes}>${htmlEsc(label)}</button>`;
}
function personnelOpenPerson(id) {
  const person = personnelFind(id);
  if (!person) { showToast('Сотрудник недоступен или запись удалена'); return; }
  const roles = TvsPersonnelEngine.rolesOf(person), kind = roles.includes(personnelKind()) ? personnelKind() : roles.includes('driver') ? 'driver' : 'operator';
  personnelView(kind).selected = id;
  const section = kind === 'operator' ? 'operators' : 'drivers';
  if (activeSection !== section) switchSection(section); else renderPersonnelSection();
}
function personnelRoleLabel(row) { return TvsPersonnelEngine.rolesOf(row).map(role => role === 'operator' ? 'Оператор ДЭС' : 'Водитель').join(' · '); }
function personnelStatusOnDate(row){if(row.archived)return 'Архив';if(row.personnelPlanning){try{const result=TvsPersonnelEngine.availability(row,personnelView().date||wfToday());return result.available===true?'Рабочий день по графику':result.available===false?'Отсутствие / нерабочий день':'График на дату не подтверждён';}catch{return 'Планирование требует проверки';}}return PERSONNEL_STATUS[row.employmentStatus||'active'];}
function personnelCard(row) {
  const current = personnelCurrentAssignments(row.id), warnings = personnelWarnings(row), status = personnelStatusOnDate(row);
  const initials = String(row.name || '?').trim().split(/\s+/).slice(0,2).map(word => word[0]).join('');
  return `<article class="personnel-card" data-personnel-id="${htmlEsc(String(row.id))}">
    <div class="personnel-card-heading"><span class="personnel-avatar" aria-hidden="true">${htmlEsc(initials)}</span><div><h3>${htmlEsc(row.name || 'Без имени')}</h3><small>${htmlEsc(personnelRoleLabel(row))}</small></div><span class="personnel-badge ${row.archived || row.employmentStatus && row.employmentStatus !== 'active' ? 'personnel-muted' : ''}">${htmlEsc(status)}</span></div>
    <dl class="personnel-facts"><div><dt>Организация / объект</dt><dd>${htmlEsc([row.org,row.site].filter(Boolean).join(' · ') || 'Не указаны')}</dd></div><div><dt>Телефон</dt><dd>${htmlEsc(row.phone || 'Не указан')}</dd></div><div><dt>Категории / допуски</dt><dd>${htmlEsc(row.skills || 'Не указаны')}</dd></div><div><dt>Закреплённая техника</dt><dd>${htmlEsc(current.map(assignment => personnelAsset(assignment.assetRef)?.label || 'Техника недоступна').join('; ') || 'Нет текущего назначения')}</dd></div></dl>
    ${warnings.length ? `<p class="personnel-warning">${warnings.some(item => item.expired) ? 'Есть истёкшие документы' : 'Срок документа истекает в ближайшие 30 дней'} · ${warnings.length}</p>` : ''}
    ${personnelLinkWarnings(row).length ? '<p class="personnel-warning">Проверьте назначения и доступность сотрудника</p>' : ''}
    ${typeof catalogMergeAliasHtml==='function'?catalogMergeAliasHtml('drivers',row):''}
    <div class="personnel-actions">${personnelButton('open','Карточка',row.id)}${!row.archived && personnelCanWrite('assetAssignments') ? personnelButton('assign','Закрепить технику',row.id) : ''}${!row.mergedInto&&personnelCanWrite()&&typeof catalogMergeOpen==='function'&&catalogMergeReadable()&&catalogMergeWritable(['drivers'])?personnelButton('merge','Объединить дубль',row.id):''}</div>
  </article>`;
}
function renderPersonnelSection(){try{return personnelRenderCurrentSection();}catch(error){const host=document.getElementById('mainContent');if(host)host.innerHTML='<div class="wf-note" role="alert"><h3>Карточки сотрудников недоступны</h3><p>'+htmlEsc(error.message)+'</p><p>Проверьте историю документа и диагностику базы. Неполные итоги не показаны.</p></div>';}}
function personnelRenderCurrentSection(){
  if (!['drivers','operators'].includes(activeSection)) return;
  const kind = personnelKind(), view = personnelView(kind), title = kind === 'operator' ? 'Операторы ДЭС' : 'Водители';
  const host = document.getElementById('mainContent');
  if (!personnelCanRead()) { host.innerHTML = '<div class="personnel-workspace"><h2>Сотрудники</h2><p>Для вашей роли справочник недоступен.</p></div>'; return; }
  if (view.selected !== null) {
    const person = personnelFind(view.selected);
    if (person && TvsPersonnelEngine.matchesRole(person,kind)) { personnelRenderDetail(person); return; }
    view.selected = null;
  }
  const all = personnelRows(kind), active = all.filter(row => !row.archived), query = view.query.trim().toLocaleLowerCase('ru');
  const rows = all.filter(row => (view.archive || !row.archived) && (!view.org || row.org === view.org) && (!view.status || (row.employmentStatus || 'active') === view.status) &&
    (!query || [row.name,row.phone,row.org,row.site,row.skills].join(' ').toLocaleLowerCase('ru').includes(query))).sort((a,b) => String(a.name || '').localeCompare(String(b.name || ''),'ru'));
  const orgs = [...new Set(all.map(row => row.org).filter(Boolean))].sort((a,b) => a.localeCompare(b,'ru'));
  host.innerHTML = `<div class="personnel-workspace">
    <header class="personnel-heading"><div><p class="personnel-eyebrow">Команда · ${kind === 'operator' ? 'Дизельные электростанции' : 'Автопарк'}</p><h2>${title}</h2><p>Контакты, допуски, документы и история закрепления за техникой.</p></div>${personnelCanWrite() ? '<button type="button" class="btn btn-primary" data-personnel-action="new">Добавить '+(kind === 'operator' ? 'оператора' : 'водителя')+'</button>' : ''}</header>
    <div class="personnel-metrics"><article><span>В справочнике</span><strong>${active.length}</strong><small>Сотрудники вне архива</small></article><article><span>Закреплены на дату</span><strong>${personnelCanRead('assetAssignments') ? active.filter(row => personnelCurrentAssignments(row.id).length).length : '—'}</strong><small>По действующим назначениям</small></article><article><span>Требуют внимания</span><strong>${active.filter(row => personnelWarnings(row).length || personnelLinkWarnings(row).length).length}</strong><small>Документы и действующие назначения</small></article></div>
    <div class="personnel-toolbar"><label class="personnel-search"><span>Поиск</span><input type="search" id="personnelSearch" placeholder="ФИО, телефон, объект, допуск" value="${htmlEsc(view.query)}"></label><label><span>Организация</span><select id="personnelOrg"><option value="">Все организации</option>${orgs.map(org => `<option value="${htmlEsc(org)}" ${org === view.org ? 'selected' : ''}>${htmlEsc(org)}</option>`).join('')}</select></label><label><span>Состояние</span><select id="personnelStatus"><option value="">Все состояния</option>${Object.entries(PERSONNEL_STATUS).map(([value,label]) => `<option value="${value}" ${view.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label class="personnel-check"><input type="checkbox" id="personnelArchived" ${view.archive ? 'checked' : ''}> Показывать архив</label></div>
    <div class="personnel-list-heading"><h3>${title} · ${rows.length}</h3><span>Один сотрудник может совмещать обе роли</span></div>
    <div class="personnel-grid">${rows.map(personnelCard).join('') || `<div class="personnel-empty"><h3>${all.length ? 'По выбранным условиям сотрудников нет' : kind === 'operator' ? 'Добавьте первого оператора ДЭС' : 'Добавьте первого водителя'}</h3><p>${all.length ? 'Измените поиск или фильтры.' : 'Заполните карточку, затем закрепите за сотрудником технику и добавьте документы.'}</p></div>`}</div></div>`;
  personnelBindActions(host);
  document.getElementById('personnelSearch').oninput = event => { const cursor = event.target.selectionStart; view.query = event.target.value; renderPersonnelSection(); const input = document.getElementById('personnelSearch'); input.focus(); input.setSelectionRange(cursor,cursor); };
  document.getElementById('personnelOrg').onchange = event => { view.org = event.target.value; renderPersonnelSection(); };
  document.getElementById('personnelStatus').onchange = event => { view.status = event.target.value; renderPersonnelSection(); };
  document.getElementById('personnelArchived').onchange = event => { view.archive = event.target.checked; renderPersonnelSection(); };
}
function personnelRenderDetail(person) {
  const assignments = personnelAssignments(person.id), current = personnelCurrentAssignments(person.id), warnings = personnelWarnings(person);
  const linkWarnings = personnelLinkWarnings(person);
  const documents = personnelCanRead('assetDocuments') ? (data.assetDocuments || []).filter(row => row.driverId === person.id && !row.archived) : [];
  const shifts = personnelCanRead('shiftReports') ? (typeof DocumentEngine!=='undefined'?DocumentEngine.activeRows(data,'shiftReports'):data.shiftReports||[]).filter(row => row.driverId === person.id && !row.archived).slice().sort((a,b) => String(b.date || '').localeCompare(String(a.date || ''))) : [];
  const history = personnelCanRead('auditLog') ? (data.auditLog || []).filter(row => row.section === 'drivers' && row.recordId === String(person.id)).slice(-8).reverse() : [];
  const detail = (label,value) => `<div><dt>${htmlEsc(label)}</dt><dd>${htmlEsc(value || 'Не указано')}</dd></div>`;
  document.getElementById('mainContent').innerHTML = `<div class="personnel-workspace">
    <div class="personnel-back">${personnelButton('list',personnelKind() === 'operator' ? '← Все операторы ДЭС' : '← Все водители')}</div>
    <header class="personnel-heading"><div><p class="personnel-eyebrow">${htmlEsc(personnelRoleLabel(person))}</p><h2>${htmlEsc(person.name || 'Без имени')}</h2><p>${htmlEsc(person.archived ? 'Карточка в архиве' : personnelStatusOnDate(person))}</p></div><div class="personnel-actions">${!person.mergedInto&&personnelCanWrite() ? personnelButton('edit','Изменить карточку',person.id)+personnelButton('archive',person.archived ? 'Восстановить' : 'В архив',person.id) : ''}${!person.archived && personnelCanWrite('assetAssignments') ? personnelButton('assign','Закрепить технику',person.id) : ''}${!person.mergedInto&&personnelCanWrite()&&typeof catalogMergeOpen==='function'&&catalogMergeReadable()&&catalogMergeWritable(['drivers'])?personnelButton('merge','Объединить дубль',person.id):''}</div></header>
    ${typeof catalogMergeAliasHtml==='function'?catalogMergeAliasHtml('drivers',person):''}
    ${warnings.length ? `<div class="personnel-notice"><strong>Проверьте сроки документов</strong><ul>${warnings.map(item => `<li>${htmlEsc(item.label)} · ${personnelDate(item.date)} · ${item.expired ? 'срок истёк' : 'скоро истекает'}</li>`).join('')}</ul></div>` : ''}
    ${linkWarnings.length ? `<div class="personnel-notice"><strong>Проверьте назначения сотрудника</strong><ul>${linkWarnings.map(message => `<li>${htmlEsc(message)}</li>`).join('')}</ul></div>` : ''}
    <div class="personnel-detail-grid"><section class="personnel-panel"><h3>Карточка сотрудника</h3><dl class="personnel-facts">${detail('Телефон',person.phone)}${detail('Организация',person.org)}${detail('Объект',person.site)}${detail('Категории / допуски',person.skills)}${TvsPersonnelEngine.matchesRole(person,'driver') ? detail('Водительское удостоверение',person.driverLicenseNumber)+detail('Действует до',personnelDate(person.driverLicenseExpires)) : ''}${TvsPersonnelEngine.matchesRole(person,'operator') ? detail('Удостоверение оператора',person.certificateNumber)+detail('Действует до',personnelDate(person.certificateExpires)) : ''}${detail('Медосмотр до',personnelDate(person.medicalExpires))}${detail('Инструктаж до',personnelDate(person.briefingExpires))}</dl>${person.note ? `<p class="personnel-note">${htmlEsc(person.note)}</p>` : ''}</section>
    <section class="personnel-panel"><h3>Закрепление за техникой</h3><p class="personnel-caption">На выбранную дату: ${current.length}. Назначения сохраняются с датами и основанием.</p>${!personnelCanRead('assetAssignments') ? '<p class="personnel-caption">Назначения недоступны для вашей роли.</p>' : assignments.length ? `<div class="personnel-timeline">${assignments.map(row => `<article><strong>${htmlEsc(personnelAsset(row.assetRef)?.label || 'Техника недоступна')}</strong><p>${personnelDate(row.from)} — ${row.to ? personnelDate(row.to) : 'без даты окончания'}${row.archived ? ' · архив' : ''}</p><p>${htmlEsc([row.site,row.org,row.reason].filter(Boolean).join(' · '))}</p>${row.cancellationReason ? `<p>Отменено: ${htmlEsc(row.cancellationReason)}</p>` : ''}${!row.archived && (!row.to || row.to >= wfToday()) && personnelCanWrite('assetAssignments') ? personnelButton('end-assignment','Изменить дату завершения',person.id,`data-assignment-key="${htmlEsc(JSON.stringify(row.id))}"`)+(row.from > wfToday() ? personnelButton('cancel-assignment','Отменить будущее назначение',person.id,`data-assignment-key="${htmlEsc(JSON.stringify(row.id))}"`) : '') : ''}</article>`).join('')}</div>` : '<p class="personnel-empty-inline">Техника пока не закреплена.</p>'}</section></div>
    <section class="personnel-panel"><div class="personnel-list-heading"><h3>Документы · ${documents.length}</h3>${!person.archived && personnelCanWrite('assetDocuments') ? personnelButton('document','Добавить документ',person.id) : ''}</div>${!personnelCanRead('assetDocuments') ? '<p class="personnel-caption">Документы недоступны для вашей роли.</p>' : documents.length ? `<div class="personnel-document-grid">${documents.map(doc => `<article><strong>${htmlEsc(doc.title || 'Документ')}</strong><p>${htmlEsc(doc.number || 'Без номера')}</p><p>Действует до: ${personnelDate(doc.expires)}${doc.mandatory ? ' · обязательный' : ''}</p>${personnelCanWrite('assetDocuments') ? personnelButton('open-document','Открыть',person.id,`data-document-key="${htmlEsc(JSON.stringify(doc.id))}"`) : ''}${personnelButton('document-files','Файлы · '+(doc.attachments || []).length,person.id,`data-document-key="${htmlEsc(JSON.stringify(doc.id))}"`)}</article>`).join('')}</div>` : '<p class="personnel-empty-inline">Документы пока не добавлены. Сроки из карточки показаны выше.</p>'}</section>
    <section class="personnel-panel"><h3>Последние смены · ${shifts.length}</h3>${shifts.length ? `<div class="personnel-timeline">${shifts.slice(0,10).map(row => `<article><strong>${htmlEsc(row.title || 'Смена')}</strong><p>${personnelDate(row.date)} · ${htmlEsc(personnelAsset(row.assetRef)?.label || 'Техника недоступна')} · ${htmlEsc(WF_STATUS[row.status] || row.status || '')}</p></article>`).join('')}</div>` : '<p class="personnel-empty-inline">Сменных форм пока нет.</p>'}</section>
    ${history.length ? `<section class="personnel-panel"><h3>Изменения карточки</h3><div class="personnel-timeline">${history.map(event => `<article><strong>${htmlEsc(event.action === 'create' ? 'Карточка создана' : event.action === 'delete' ? 'Карточка удалена' : 'Карточка изменена')}</strong><p>${htmlEsc(new Date(event.at).toLocaleString('ru-RU'))} · ${htmlEsc(event.actor || '')}</p></article>`).join('')}</div></section>` : ''}</div>`;
  personnelBindActions(document.getElementById('mainContent'));
}
function personnelBindActions(host) {
  if(typeof personnelPlanningEnhance==='function')personnelPlanningEnhance(host);
  host.querySelectorAll('[data-personnel-action]').forEach(button => button.addEventListener('click',() => {
    const id = button.dataset.personnelKey ? JSON.parse(button.dataset.personnelKey) : undefined;
    switch (button.dataset.personnelAction) {
      case 'new': personnelEditPerson(); break;
      case 'merge': catalogMergeOpen('drivers',id); break;
      case 'open': personnelOpenPerson(id); break;
      case 'list': personnelView().selected = null; renderPersonnelSection(); break;
      case 'edit': personnelEditPerson(id); break;
      case 'archive': void personnelArchive(id); break;
      case 'assign': personnelEditAssignment(id); break;
      case 'end-assignment': personnelEditAssignment(id,JSON.parse(button.dataset.assignmentKey)); break;
      case 'cancel-assignment': personnelCancelAssignment(id,JSON.parse(button.dataset.assignmentKey)); break;
      case 'document': wfEdit('assetDocuments',null,{id:wfId('person-document'),driverId:id,date:wfToday(),mandatory:false}); break;
      case 'open-document': wfEdit('assetDocuments',JSON.parse(button.dataset.documentKey)); break;
      case 'document-files': personnelOpenDocumentFiles(JSON.parse(button.dataset.documentKey)); break;
    }
  }));
}
function personnelOpenDocumentFiles(id) {
  if (!personnelCanRead('assetDocuments')) return;
  const doc = (data.assetDocuments || []).find(row => row.id === id);
  if (!doc) return;
  if (personnelCanWrite('assetDocuments')) { void wfAttachments('assetDocuments',id); return; }
  wfShowDialog('Файлы · '+(doc.title || 'Документ'),`<div class="personnel-timeline">${(doc.attachments || []).map((file,index) => `<article><strong>${htmlEsc(file.name || 'Файл')}</strong><p>${Math.ceil((Number(file.size) || 0)/1024)} КБ</p><button type="button" class="btn btn-ghost btn-sm" data-personnel-file="${index}">Открыть файл</button></article>`).join('') || '<p>Файлы пока не добавлены.</p>'}</div>`);
  const identity = personnelIdentity();
  document.querySelectorAll('#wfModal [data-personnel-file]').forEach(button => button.onclick = async () => {
    try {
      personnelAssertIdentity(identity);
      const result = await window.electronAPI?.openAttachment?.(doc.attachments[Number(button.dataset.personnelFile)].id);
      if (result?.error) showToast(result.error);
    } catch (error) { showToast(error.message); }
  });
}
function personnelAssertIdentity(identity) {
  if (identity !== personnelIdentity()) throw Error('База или пользователь изменились. Откройте карточку заново.');
}
async function personnelStore(section,row,original,identity) {
  if (personnelSaving || typeof unifiedPendingSaves !== 'undefined' && unifiedPendingSaves) throw Error('Дождитесь завершения сохранения');
  personnelAssertIdentity(identity);
  if (!personnelCanWrite(section)) throw Error('Для вашей роли изменение недоступно');
  const rows = data[section] || [], current = rows.find(item => item.id === row.id);
  if (JSON.stringify(current || null) !== JSON.stringify(original || null)) throw Error('Запись уже изменена. Закройте форму и откройте актуальную карточку. Введённые значения остаются в полях.');
  const candidate = {...row,updatedAt:new Date().toISOString()};
  if (!original) candidate.createdAt = candidate.updatedAt;
  const next = {...data,[section]:current ? rows.map(item => item.id === row.id ? candidate : item) : rows.concat(candidate)};
  TvsPersonnelEngine.validateChanges(data,next,{today:wfToday()});
  const target = data;
  data[section] = next[section]; personnelSaving = true;
  try {
    const saved = await saveData(data,{noMerge:true});
    if (!saved) throw Error('Изменения не сохранены. Проверьте подключение и повторите. Введённые значения остаются в форме.');
    personnelAssertIdentity(identity);
    return true;
  } catch (error) {
    if (data === target && data[section] === next[section]) { data[section] = rows; rebuildIndex(); }
    throw error;
  } finally { personnelSaving = false; }
}
function personnelInput(label,name,type,value,extra='') {
  return `<label><span>${htmlEsc(label)}</span><input name="${name}" id="personnel_${name}" type="${type}" value="${htmlEsc(value || '')}" ${extra}></label>`;
}
function personnelEditPerson(id) {
  if (!personnelCanWrite()) { showToast('Справочник доступен только для просмотра'); return; }
  const person = id === undefined ? null : personnelFind(id);
  if(person?.mergedInto){showToast('Архивная ссылка объединения доступна только для просмотра. История остаётся у исходной карточки.');return;}
  if (id !== undefined && !person) { showToast('Сотрудник недоступен'); return; }
  const original = person ? JSON.parse(JSON.stringify(person)) : null, identity = personnelIdentity();
  const row = person || {id:wfId('person'),personnelRoles:[personnelKind()],employmentStatus:'active'};
  const roles = TvsPersonnelEngine.rolesOf(row);
  wfShowDialog(person ? 'Изменить карточку сотрудника' : personnelKind() === 'operator' ? 'Новый оператор ДЭС' : 'Новый водитель',`<form id="personnelForm" class="wf-form personnel-form">
    <label class="wf-wide"><span>ФИО *</span><input name="name" id="personnel_name" required maxlength="200" value="${htmlEsc(row.name || '')}" autocomplete="name"></label>
    <fieldset class="wf-wide personnel-roles"><legend>Роли сотрудника *</legend><label><input type="checkbox" name="personnelRoles" value="driver" ${roles.includes('driver') ? 'checked' : ''}> Водитель</label><label><input type="checkbox" name="personnelRoles" value="operator" ${roles.includes('operator') ? 'checked' : ''}> Оператор ДЭС</label></fieldset>
    ${personnelInput('Телефон','phone','tel',row.phone,'maxlength="80" autocomplete="tel"')}${personnelInput('Организация','org','text',row.org,'maxlength="200"')}${personnelInput('Объект','site','text',row.site,'maxlength="200"')}
    <label><span>Состояние</span><select name="employmentStatus">${Object.entries(PERSONNEL_STATUS).map(([value,label]) => `<option value="${value}" ${value === (row.employmentStatus || 'active') ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
    <label class="wf-wide"><span>Категории и допуски</span><input name="skills" maxlength="1000" value="${htmlEsc(row.skills || '')}" placeholder="Например: B, C, CE; допуски к оборудованию"></label>
    <div class="wf-wide personnel-form-group" data-personnel-fields="driver"><h3>Водительское удостоверение</h3><div>${personnelInput('Номер','driverLicenseNumber','text',row.driverLicenseNumber,'maxlength="100"')}${personnelInput('Действует до','driverLicenseExpires','date',row.driverLicenseExpires)}</div></div>
    <div class="wf-wide personnel-form-group" data-personnel-fields="operator"><h3>Удостоверение оператора ДЭС</h3><div>${personnelInput('Номер','certificateNumber','text',row.certificateNumber,'maxlength="100"')}${personnelInput('Действует до','certificateExpires','date',row.certificateExpires)}</div></div>
    ${personnelInput('Медосмотр действует до','medicalExpires','date',row.medicalExpires)}${personnelInput('Инструктаж действует до','briefingExpires','date',row.briefingExpires)}
    <label class="wf-wide"><span>Примечание</span><textarea name="note" maxlength="4000" rows="3">${htmlEsc(row.note || '')}</textarea></label><div id="personnelError" class="wf-error wf-wide" role="alert"></div><div class="wf-wide personnel-actions"><button type="button" class="btn btn-ghost" data-personnel-cancel>Отмена</button><button type="submit" class="btn btn-primary">Сохранить карточку</button></div></form>`);
  const form = document.getElementById('personnelForm');
  const refreshRoles = () => form.querySelectorAll('[data-personnel-fields]').forEach(group => { group.hidden = !form.querySelector(`[name="personnelRoles"][value="${group.dataset.personnelFields}"]`).checked; });
  form.querySelectorAll('[name="personnelRoles"]').forEach(input => input.onchange = refreshRoles); refreshRoles();
  form.querySelector('[data-personnel-cancel]').onclick = () => closeModal('wfModal');
  let pending = false;
  form.onsubmit = async event => {
    event.preventDefault(); if (pending) return;
    const errorNode = form.querySelector('#personnelError'), button = form.querySelector('[type="submit"]');
    errorNode.textContent = ''; pending = true; button.disabled = true;
    try {
      const candidate = {...row};
      for (const field of ['name','phone','org','site','skills','employmentStatus','driverLicenseNumber','driverLicenseExpires','certificateNumber','certificateExpires','medicalExpires','briefingExpires','note']) candidate[field] = form.elements[field].value.trim();
      candidate.personnelRoles = [...form.querySelectorAll('[name="personnelRoles"]:checked')].map(input => input.value);
      await personnelStore('drivers',candidate,original,identity);
      closeModal('wfModal'); personnelOpenPerson(candidate.id); if (typeof unifiedRefreshNav === 'function') unifiedRefreshNav(); showToast('Карточка сотрудника сохранена');
    } catch (error) { errorNode.textContent = error.message; }
    finally { pending = false; button.disabled = false; }
  };
}
async function personnelArchive(id) {
  const person = personnelFind(id);
  if (!person || !personnelCanWrite()) return;
  if(person.mergedInto){showToast('Архивная ссылка объединения сохраняет историю и не восстанавливается отдельно');return;}
  if (personnelOpenLinks(id).length && !person.archived) { showToast('Сначала завершите или переназначьте действующие и будущие назначения, задания и смены. История закрепления сохранится.'); return; }
  const original = JSON.parse(JSON.stringify(person)), identity = personnelIdentity();
  if (!await confirmAction(person.archived ? 'Восстановить карточку сотрудника?' : 'Переместить сотрудника в архив? Документы и история сохранятся.')) return;
  try { await personnelStore('drivers',{...original,archived:!person.archived},original,identity); renderPersonnelSection(); if (typeof unifiedRefreshNav === 'function') unifiedRefreshNav(); showToast(person.archived ? 'Карточка восстановлена' : 'Карточка перемещена в архив'); }
  catch (error) { showToast(error.message); }
}
function personnelEditAssignment(personId,assignmentId) {
  const person = personnelFind(personId);
  if (!person || !personnelCanWrite('assetAssignments')) { showToast('Закрепление техники недоступно'); return; }
  const existing = assignmentId === undefined ? null : personnelAssignments(personId).find(row => row.id === assignmentId);
  if (assignmentId !== undefined && !existing) { showToast('Назначение не найдено'); return; }
  if (!existing && (person.archived || person.deleted)) { showToast('Сотрудник в архиве. Новое назначение недоступно.'); return; }
  const identity = personnelIdentity(), original = existing ? JSON.parse(JSON.stringify(existing)) : null;
  const row = original || {id:wfId('person-assignment'),driverId:personId,from:'',to:'',site:person.site || '',org:person.org || '',reason:''};
  const commandState=wfCommandState('assetAssignments',row.id,original);
  const validFrom = typeof row.from === 'string' && PlatformIntegrity.dateValid(row.from,'date');
  const presentText = value => typeof value === 'string' && !!value.trim();
  const assets = ['vehicles','generators'].flatMap(section => personnelCanRead(section) ? (data[section] || []).filter(asset => !asset.archived).map(asset => personnelAsset((section === 'vehicles' ? 'v:' : 'g:')+asset.id)).filter(Boolean) : [])
    .filter(asset => TvsPersonnelEngine.matchesRole(person,TvsPersonnelEngine.kindForAsset(asset.ref)));
  if (existing && !assets.some(asset => asset.ref === row.assetRef)) assets.push({ref:row.assetRef,label:personnelAsset(row.assetRef)?.label || 'Прежняя техника'});
  wfShowDialog(existing ? 'Дата завершения назначения' : 'Закрепить технику · '+person.name,`<form id="personnelAssignmentForm" class="wf-form personnel-form"><label class="wf-wide"><span>Техника *</span><select name="assetRef" required ${existing ? 'disabled' : ''}><option value="">Выберите технику</option>${assets.map(asset => `<option value="${htmlEsc(asset.ref)}" ${asset.ref === row.assetRef ? 'selected' : ''}>${htmlEsc(asset.label)}</option>`).join('')}</select></label>
    ${personnelInput('С даты *','from','date',row.from,existing && validFrom ? 'required readonly' : 'required')}${personnelInput('По дату включительно','to','date',row.to,existing ? 'required' : '')}${personnelInput('Объект *','site','text',row.site,'required maxlength="200" '+(existing && presentText(row.site) ? 'readonly' : ''))}${personnelInput('Организация','org','text',row.org,'maxlength="200" '+(existing ? 'readonly' : ''))}
    <label class="wf-wide"><span>Основание *</span><textarea name="reason" required maxlength="4000" rows="3" ${existing && presentText(row.reason) ? 'readonly' : ''}>${htmlEsc(row.reason || '')}</textarea></label>${existing?'':wfAssignmentReplacementField()}<p class="personnel-caption wf-wide">${existing ? 'Исходное назначение остаётся в истории. Укажите последний день закрепления и заполните отсутствующие обязательные сведения.' : 'Для смены сотрудника выберите прежнее назначение. Оно завершится одновременно с сохранением нового закрепления.'}</p><div id="personnelAssignmentError" class="wf-error wf-wide" role="alert"></div><div class="personnel-actions wf-wide"><button type="button" class="btn btn-ghost" data-personnel-cancel>Отмена</button><button type="submit" class="btn btn-primary">${existing ? 'Сохранить дату' : 'Закрепить технику'}</button></div></form>`);
  const form = document.getElementById('personnelAssignmentForm'); form.querySelector('[data-personnel-cancel]').onclick = () => closeModal('wfModal');
  commandState.form=form;
  const refreshReplacement=()=>wfRefreshAssignmentReplacements(form,form.elements.assetRef.value,form.elements.from.value,form.elements.to.value);
  for(const field of ['assetRef','from','to'])form.elements[field].addEventListener('change',refreshReplacement);refreshReplacement();
  let pending = false;
  form.onsubmit = async event => {
    event.preventDefault(); if (pending) return;
    const errorNode = form.querySelector('#personnelAssignmentError'); pending = true;const unlock=wfLockCommandForm(form);errorNode.textContent = '';
    try {
      personnelAssertIdentity(identity);
      const candidate = {...row};
      if (existing) {
        candidate.to = form.elements.to.value;
        if (!validFrom) candidate.from = form.elements.from.value;
        if (!presentText(row.site)) candidate.site = form.elements.site.value.trim();
        if (!presentText(row.reason)) candidate.reason = form.elements.reason.value.trim();
      }
      else for (const field of ['assetRef','from','to','site','org','reason']) candidate[field] = form.elements[field].value.trim();
      if (!candidate.to && existing) throw Error('Укажите дату завершения');
      const replacesAssignmentId=wfSelectedAssignmentReplacement(form);
      wfAssertCommandState(commandState);wfValidate('assetAssignments',candidate,original,{replacesAssignmentId});
      await wfExecuteSemanticCommand({type:'AssignPerson',version:1,input:wfAssignmentInput(candidate,original,replacesAssignmentId)},commandState);
      if(document.getElementById('wfModal')?.contains(form)){closeModal('wfModal');personnelOpenPerson(personId);}showToast(existing ? 'Дата завершения сохранена' : 'Техника закреплена');
    } catch (error) { wfShowCommandError(errorNode,error); }
    finally { pending = false;unlock(); }
  };
}
function personnelCancelAssignment(personId,assignmentId) {
  const existing = personnelAssignments(personId).find(row => row.id === assignmentId);
  if (!existing || existing.archived || existing.from <= wfToday() || !personnelCanWrite('assetAssignments')) { showToast('Отменить можно только будущее назначение. Для действующего укажите дату завершения.'); return; }
  const original = JSON.parse(JSON.stringify(existing)), identity = personnelIdentity();
  wfShowDialog('Отмена будущего назначения',`<p class="personnel-caption">${htmlEsc(personnelAsset(existing.assetRef)?.label || 'Техника')} · с ${personnelDate(existing.from)}. Запись и основание отмены останутся в истории.</p><form id="personnelCancelAssignmentForm" class="wf-form personnel-form"><label class="wf-wide"><span>Причина отмены *</span><textarea name="reason" required maxlength="4000" rows="3"></textarea></label><div id="personnelCancelAssignmentError" class="wf-error wf-wide" role="alert"></div><div class="personnel-actions wf-wide"><button type="button" class="btn btn-ghost" data-personnel-cancel>Закрыть</button><button type="submit" class="btn btn-primary">Отменить назначение</button></div></form>`);
  const form = document.getElementById('personnelCancelAssignmentForm'); form.querySelector('[data-personnel-cancel]').onclick = () => closeModal('wfModal');
  let pending = false;
  form.onsubmit = async event => {
    event.preventDefault(); if (pending) return;
    const button = form.querySelector('[type="submit"]'), errorNode = form.querySelector('#personnelCancelAssignmentError'); pending = true; button.disabled = true;
    try {
      const reason = form.elements.reason.value.trim();
      if (!reason) throw Error('Укажите причину отмены');
      await personnelStore('assetAssignments',{...original,archived:true,archivedAt:new Date().toISOString(),cancellationReason:reason},original,identity);
      closeModal('wfModal'); personnelOpenPerson(personId); showToast('Будущее назначение отменено');
    } catch (error) { errorNode.textContent = error.message; }
    finally { pending = false; button.disabled = false; }
  };
}
