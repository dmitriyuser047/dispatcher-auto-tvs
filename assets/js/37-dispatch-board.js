// Доска и фактическое расписание заявок. Изменения проходят через штатную форму wfEdit.
let dxJobsView = 'board';
let dxJobsDate = '';
let dxJobsAllDates = false;
let dxJobsSiteUnset = false;
const DX_JOB_COLUMNS = [
  { status: 'new', title: 'К назначению', note: 'Подобрать технику и сотрудника' },
  { status: 'assigned', title: 'Готовы к выезду', note: 'Техника и сотрудник выбраны' },
  { status: 'started', title: 'В работе', note: 'Задания выполняются' },
  { status: 'done', title: 'К приёмке', note: 'Проверить результат работы' },
];

function dxJobCanRead(section) {
  return typeof _sync === 'undefined' || !_sync.access ||
    !Array.isArray(_sync.access.readable) || _sync.access.readable.includes(section);
}

function dxJobCanWrite() {
  return typeof _sync === 'undefined' || !_sync.access ||
    Array.isArray(_sync.access.writable) && _sync.access.writable.includes('dispatchJobs');
}

function dxJobCalendar(){return BusinessCalendar.resolve(data,new Date().toISOString());}
function dxJobCivilNext(date){const next=new Date(date+'T12:00:00Z');next.setUTCDate(next.getUTCDate()+1);return next.toISOString().slice(0,10);}
function dxJobDayBounds(date){try{if(!dxJobCanRead('appMeta'))throw Error('Рабочий календарь недоступен');const timeZone=dxJobCalendar().timeZone,start=BusinessCalendar.parseTime(date+'T00:00',{timeZone}),end=BusinessCalendar.parseTime(dxJobCivilNext(date)+'T00:00',{timeZone});return{status:'known',start:Date.parse(start.instant),end:Date.parse(end.instant),timeZone};}catch(error){return{status:'unknown',start:null,end:null,reason:error.message};}}
function dxJobFieldInstant(row,field){if(!dxJobCanRead('appMeta'))return null;try{const value=BusinessCalendar.timeAt(data,'dispatchJobs',row,field);return value.status==='known'?value.instant:null;}catch{return null;}}
function dxJobWindow(row){const start=dxJobFieldInstant(row,'start'),end=dxJobFieldInstant(row,'end');return start&&end&&Date.parse(start)<Date.parse(end)?{status:'known',start,end,from:Date.parse(start),to:Date.parse(end)}:{status:'unknown',start:null,end:null,from:null,to:null};}
function dxJobTime(value){if(typeof value!=='string'||!/(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))return 'Время не подтверждено';return new Date(value).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',timeZone:dxJobCalendar().timeZone});}
function dxJobDateLabel(value,full=false){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}/.test(value))return 'Дата не указана';const instant=/(?:Z|[+-]\d{2}:\d{2})$/.test(value),date=new Date(instant?value:value.slice(0,10)+'T12:00:00Z');return Number.isFinite(date.getTime())?date.toLocaleDateString('ru-RU',{...(full?{weekday:'long',day:'numeric',month:'long'}:{day:'numeric',month:'short'}),timeZone:instant?dxJobCalendar().timeZone:'UTC'}):'Дата не указана';}
function dxJobRange(row,includeDate=false){const window=dxJobWindow(row);if(window.status!=='known')return 'Время не подтверждено: '+(row.start||'начало не указано')+' — '+(row.end||'конец не указан');const zone=dxJobCalendar().timeZone,crossesDay=BusinessCalendar.dateAt(window.start,zone)!==BusinessCalendar.dateAt(window.end,zone),from=(includeDate?dxJobDateLabel(window.start)+', ':'')+dxJobTime(window.start),until=(crossesDay?dxJobDateLabel(window.end)+', ':'')+dxJobTime(window.end);return from+' — '+until;}
function dxJobActual(row,field){const value=dxJobFieldInstant(row,field);return value?dxJobDateLabel(value)+', '+dxJobTime(value):row[field]?row[field]+' · пояс не подтверждён':'не указано';}
function dxJobUnknownHtml(rows){const unknown=rows.filter(row=>dxJobWindow(row).status!=='known');if(!unknown.length)return '';return '<section class="wf-note" data-dx-time-unknown><h3>Интервалы без подтверждённой даты · '+unknown.length+'</h3><p>Эти заявки не включены в итоги выбранного дня, просрочку и распределение времени. Исходные поля сохранены; проверьте часовой пояс.</p>'+unknown.map(row=>'<article><strong>'+htmlEsc(row.title||'Заявка')+'</strong><p>'+htmlEsc(dxJobRange(row,true))+'</p><button type="button" class="btn btn-ghost btn-sm" onclick="'+(dxJobCanWrite()?"wfEdit('dispatchJobs',"+htmlJs(row.id)+")":"dxJobDetails("+htmlJs(row.id)+")")+'">Открыть</button>'+(!['confirmed','cancelled'].includes(row.status)&&!row.archived&&typeof personnelCalendarAllowed==='function'&&personnelCalendarAllowed('confirmInterval',{section:'dispatchJobs',id:row.id})?'<button type="button" class="btn btn-ghost btn-sm" onclick="personnelCalendarOpen({section:\'dispatchJobs\',id:'+htmlJs(row.id)+'})">Подтвердить пояс интервала</button>':'')+'</article>').join('')+'</section>';}

function dxJobAsset(row) {
  if (!row.assetRef) return null;
  const section = row.assetRef.startsWith('v:') ? 'vehicles' : row.assetRef.startsWith('g:') ? 'generators' : 'tanks';
  if (!dxJobCanRead(section)) return { label: 'Техника · доступ ограничен', restricted: true };
  return wfAsset(row.assetRef) || { label: 'Связанная техника недоступна', missing: true };
}

function dxJobDriver(row) {
  if (!EntityIdentity.presentId(row.driverId)) return null;
  if (!dxJobCanRead('drivers')) return { name: 'Сотрудник · доступ ограничен', restricted: true };
  return (data.drivers || []).find(driver => driver.id === row.driverId) ||
    { name: 'Связанный сотрудник недоступен', missing: true };
}

function dxJobIsLate(row,now=Date.now()){const interval=dxJobWindow(row);if(row.archived||interval.status!=='known')return false;return row.status==='started'?interval.to<now:['new','assigned'].includes(row.status)&&interval.from<now;}

function dxJobRows() {
  const query = String(wfQuery || '').trim().toLocaleLowerCase('ru-RU');
  const bounds = dxJobDayBounds(dxJobsDate || wfToday());
  return (data.dispatchJobs || []).filter(row => {
    if (!wfShowArchive && row.archived) return false;
    if (dxJobsSiteUnset && String(row.site || '').trim() !== '') return false;
    if (wfSite && row.site !== wfSite || wfOrg && row.org !== wfOrg) return false;
    if (!dxJobsAllDates) {
      const interval=dxJobWindow(row);if(interval.status==='known'&&bounds.status==='known'&&!(interval.from<bounds.end&&interval.to>bounds.start))return false;
    }
    if (query) {
      const haystack = [row.title, row.site, row.org, row.customer, row.points,
        row.requirements, row.result, row.id, dxJobAsset(row)?.label, dxJobDriver(row)?.name]
        .filter(Boolean).join(' ').toLocaleLowerCase('ru-RU');
      if (!haystack.includes(query)) return false;
    }
    return true;
  }).slice().sort((a,b)=>(dxJobWindow(a).from??Number.MAX_SAFE_INTEGER)-(dxJobWindow(b).from??Number.MAX_SAFE_INTEGER)||
    String(a.title || '').localeCompare(String(b.title || ''), 'ru'));
}

function dxJobFact(value) {
  if (value == null || value === '') return '—';
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) : '—';
}

function dxJobStatusClass(status) {
  return ['new', 'assigned', 'started', 'done', 'confirmed', 'cancelled'].includes(status) ? status : 'unknown';
}

function dxJobNext(row) {
  return ({ new: ['assigned', 'Назначить'], assigned: ['started', 'Начать работу'],
    started: ['done', 'Завершить'], done: ['confirmed', 'Принять работу'] })[row.status];
}

function dxJobCard(row, compact = false) {
  const asset = dxJobAsset(row), driver = dxJobDriver(row), next = dxJobNext(row);
  const writable = dxJobCanWrite() && !row.archived;
  const late = dxJobIsLate(row);
  const missing = !row.assetRef || !EntityIdentity.presentId(row.driverId);
  const factKm = row.plannedKm != null || row.actualKm != null;
  const factHours = row.plannedHours != null || row.actualHours != null;
  const status = dxJobStatusClass(row.status);
  return `<article class="dx-job-card dx-status-${status}${late ? ' is-overdue' : ''}${row.archived ? ' is-archived' : ''}">
    <div class="dx-job-top"><span class="dx-job-time">${htmlEsc(dxJobRange(row, dxJobsAllDates))}</span>
      ${row.archived ? '<span class="dx-job-flag">Архив</span>' : late ?
        `<span class="dx-job-flag is-danger">${row.status === 'started' ? 'Срок прошёл' : 'Пора начать'}</span>` :
        compact ? `<span class="dx-job-flag">${htmlEsc(WF_STATUS[row.status] || row.status || 'Без состояния')}</span>` : ''}
    </div>
    <h4>${htmlEsc(row.title || 'Заявка без названия')}</h4>
    <div class="dx-job-site">${htmlEsc(row.site || 'Объект не указан')}${row.customer ? ` <span>· ${htmlEsc(row.customer)}</span>` : ''}</div>
    <div class="dx-job-resources">
      <div class="${!asset || asset.missing ? 'is-missing' : ''}"><span class="dx-resource-mark" aria-hidden="true">ТС</span><div><small>Техника</small><strong>${htmlEsc(asset?.label || 'Выбрать технику')}</strong></div></div>
      <div class="${!driver || driver.missing ? 'is-missing' : ''}"><span class="dx-resource-mark" aria-hidden="true">С</span><div><small>${htmlEsc(wfPersonnelFieldLabel(row.assetRef))}</small><strong>${htmlEsc(driver?.name || 'Назначить сотрудника')}</strong></div></div>
    </div>
    ${row.points ? `<p class="dx-job-route" title="${htmlEsc(row.points)}">${htmlEsc(row.points)}</p>` : ''}
    ${factKm || factHours ? `<div class="dx-job-facts">${factKm ? `<span><small>км · план / факт</small><b>${dxJobFact(row.plannedKm)} / ${dxJobFact(row.actualKm)}</b></span>` : ''}${factHours ? `<span><small>ч · план / факт</small><b>${dxJobFact(row.plannedHours)} / ${dxJobFact(row.actualHours)}</b></span>` : ''}</div>` : ''}
    ${row.actualStart || row.actualEnd ? `<p class="dx-job-actual">Факт: ${htmlEsc(row.actualStart ? dxJobActual(row,'actualStart') : 'начало не указано')} → ${htmlEsc(row.actualEnd ? dxJobActual(row,'actualEnd') : 'окончание не указано')}</p>` : ''}
    ${row.result && ['done', 'confirmed'].includes(row.status) ? `<p class="dx-job-result">${htmlEsc(row.result)}</p>` : ''}
    <footer class="dx-job-footer">
      ${writable && next ? `<button type="button" class="btn btn-primary btn-sm" onclick="dxJobAdvance(${htmlJs(row.id)},${htmlJs(next[0])})">${next[1]}<span aria-hidden="true"> →</span></button>` : ''}
      ${writable ? `<button type="button" class="btn btn-ghost btn-sm" onclick="wfEdit('dispatchJobs',${htmlJs(row.id)})">Открыть</button>` : `<button type="button" class="btn btn-ghost btn-sm" onclick="dxJobDetails(${htmlJs(row.id)})">Подробнее</button>`}
      ${driver&&!driver.missing&&!driver.restricted?`<button type="button" class="btn btn-ghost btn-sm" data-personnel-job="${htmlEsc(row.id)}" data-personnel-job-key="${htmlEsc(JSON.stringify(row.id))}">Сотрудник</button>`:''}
      ${writable ? `<button type="button" class="btn btn-ghost btn-sm dx-job-files" onclick="wfAttachments('dispatchJobs',${htmlJs(row.id)})" title="Документы и файлы заявки">Файлы${(row.attachments || []).length ? ' · ' + (row.attachments || []).length : ''}</button>` :
        (row.attachments || []).length ? `<span class="dx-job-files" title="Прикреплённые файлы">${(row.attachments || []).length} файл.</span>` : ''}
      ${row.archived && dxJobCanWrite() ? `<button type="button" class="btn btn-ghost btn-sm" onclick="wfArchive('dispatchJobs',${htmlJs(row.id)})">Восстановить</button>` : ''}
    </footer>
    ${missing && row.status === 'new' ? '<small class="dx-job-hint">Назначение проверит занятость и допуски</small>' : ''}
  </article>`;
}

function dxJobDetails(id) {
  const row = (data.dispatchJobs || []).find(job => job.id === id);
  if (!row || !dxJobCanRead('dispatchJobs')) return;
  const details = [
    ['Состояние', WF_STATUS[row.status] || row.status], ['Плановое время', dxJobRange(row, true)],
    ['Объект', row.site], ['Организация', row.org], ['Заказчик', row.customer],
    ['Техника', dxJobAsset(row)?.label], [wfPersonnelFieldLabel(row.assetRef), dxJobDriver(row)?.name],
    ['Маршрут', row.points], ['Допуски', row.requirements],
    ['План / факт, км', dxJobFact(row.plannedKm) + ' / ' + dxJobFact(row.actualKm)],
    ['План / факт, ч', dxJobFact(row.plannedHours) + ' / ' + dxJobFact(row.actualHours)],
    ['Результат', row.result], ['Принял', row.confirmedBy],
  ];
  const files = (row.attachments || []).map((file, index) => `<button type="button" class="btn btn-ghost btn-sm" onclick="dxJobOpenFile(${htmlJs(row.id)},${index})">${htmlEsc(file.name || 'Файл ' + (index + 1))}</button>`).join('');
  wfShowDialog(row.title || 'Заявка', `<dl class="dx-job-details">${details.filter(([, value]) => value != null && value !== '').map(([label, value]) => `<div><dt>${htmlEsc(label)}</dt><dd>${htmlEsc(value)}</dd></div>`).join('')}</dl>${files ? `<div class="wf-actions">${files}</div>` : ''}`);
}

async function dxJobOpenFile(id, index) {
  if (!dxJobCanRead('dispatchJobs')) return;
  const file = (data.dispatchJobs || []).find(row => row.id === id)?.attachments?.[index];
  if (!file) return;
  try {
    if (!window.electronAPI?.openAttachment) { showToast('Открытие файлов доступно в приложении на компьютере.'); return; }
    const result = await window.electronAPI.openAttachment(file.id);
    if (result?.error) showToast(result.error);
  } catch (error) { showToast(error.message); }
}

function dxJobAdvance(id, status) {
  const row = (data.dispatchJobs || []).find(job => job.id === id);
  if (!row || row.archived || !dxJobCanWrite()) return;
  const allowed = WF_TRANSITIONS.dispatchJobs[row.status] || [];
  if (!allowed.includes(status)) { showToast('Переход недоступен. Откройте заявку и проверьте её состояние.'); return; }
  wfEdit('dispatchJobs', id);
  const select = document.getElementById('wf_status');
  if (!select) return;
  select.value = status;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  const note = document.createElement('p');
  note.className = 'wf-note wf-wide';
  note.textContent = 'Переход в состояние «' + (WF_STATUS[status] || status) + '». Проверьте данные и сохраните форму.';
  document.getElementById('wfForm')?.prepend(note);
  const focus = status === 'assigned' && !row.assetRef ? document.getElementById('wf_assetRef') :
    status === 'assigned' && !row.driverId ? document.getElementById('wf_driverId') :
    status === 'confirmed' && !row.result ? document.getElementById('wf_result') : select;
  focus?.focus();
}

function dxJobNew() {
  if (!dxJobCanWrite()) return;
  const date = dxJobsDate || wfToday();
  wfEdit('dispatchJobs', null, { id: wfId('dispatchJobs'), status: 'new',
    start: '', end: '', site: wfSite || '', org: wfOrg || '' });const note=document.createElement('p');note.className='wf-wide wf-note';note.textContent='День просмотра: '+fmtDate(date)+'. Начало и конец задания задайте явно; длительность не подставляется.';document.getElementById('wfForm')?.prepend(note);
}

function dxJobChangeDate(delta) {
  const date = new Date((dxJobsDate || wfToday()) + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + delta);
  dxJobsDate = date.toISOString().slice(0,10);
  dxJobsAllDates = false;
  dxRenderJobs();
}

function dxJobSetView(view) {
  dxJobsView = view === 'timeline' ? 'timeline' : 'board';
  if (dxJobsView === 'timeline') dxJobsAllDates = false;
  dxRenderJobs();
}

function dxJobBoardHtml(rows) {
  const board = DX_JOB_COLUMNS.map(column => {
    const jobs = rows.filter(row => row.status === column.status);
    return `<section class="dx-board-column" data-status="${column.status}" aria-label="${column.title}">
      <header class="dx-column-head"><span class="dx-column-dot" aria-hidden="true"></span><strong>${column.title}</strong><small>${jobs.length}</small></header>
      <p class="dx-column-note">${column.note}</p><div class="dx-column-body">${jobs.map(row => dxJobCard(row)).join('') || '<div class="dx-column-empty">Пока нет заявок</div>'}</div>
    </section>`;
  }).join('');
  const closed = rows.filter(row => !DX_JOB_COLUMNS.some(column => column.status === row.status));
  return `<div class="dx-board">${board}</div>${closed.length ? `<details class="dx-closed-list"><summary>Завершённые и отменённые <span>${closed.length}</span></summary><div class="dx-closed-grid">${closed.map(row => dxJobCard(row, true)).join('')}</div></details>` : ''}`;
}

function dxJobTimelineHtml(rows) {
  const bounds = dxJobDayBounds(dxJobsDate), span = bounds.end - bounds.start;
  if(bounds.status!=='known')return '<p class="wf-note">Лента дня недоступна: '+htmlEsc(bounds.reason)+'.</p>'+dxJobUnknownHtml(rows);
  const jobs = rows.filter(row => row.status !== 'cancelled'&&dxJobWindow(row).status==='known');
  const lanes = new Map();
  for (const row of jobs) {
    const start = Math.max(bounds.start, dxJobWindow(row).from);
    const end = Math.min(bounds.end, dxJobWindow(row).to);
    if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) continue;
    const key = row.assetRef || '__unassigned';
    if (!lanes.has(key)) lanes.set(key, { ref: row.assetRef, label: dxJobAsset(row)?.label || 'Без назначения', jobs: [] });
    lanes.get(key).jobs.push({ row, start, end });
  }
  const sorted = [...lanes.values()].sort((a, b) => !a.ref ? 1 : !b.ref ? -1 : a.label.localeCompare(b.label, 'ru'));
  const now = Date.now(), showNow = now >= bounds.start && now < bounds.end;
  const laneHtml = sorted.map(lane => {
    const ends = [];
    const intervals = lane.jobs.sort((a, b) => a.start - b.start || a.end - b.end).map(item => {
      let track = ends.findIndex(end => end <= item.start);
      if (track < 0) track = ends.length;
      ends[track] = item.end;
      const left = (item.start - bounds.start) / span * 100;
      const width = (item.end - item.start) / span * 100;
      const status = dxJobStatusClass(item.row.status), driver = dxJobDriver(item.row);
      const title = [item.row.title, WF_STATUS[item.row.status], dxJobRange(item.row, true), driver?.name, item.row.site].filter(Boolean).join(' · ');
      return `<button type="button" class="dx-time-job dx-status-${status}${dxJobIsLate(item.row) ? ' is-overdue' : ''}${item.row.archived ? ' is-archived' : ''}" style="left:${left.toFixed(4)}%;width:${width.toFixed(4)}%;top:${track * 58 + 8}px" title="${htmlEsc(title)}" aria-label="${htmlEsc(title)}" onclick="${dxJobCanWrite() && !item.row.archived ? `wfEdit('dispatchJobs',${htmlJs(item.row.id)})` : `dxJobDetails(${htmlJs(item.row.id)})`}"><strong>${htmlEsc(item.row.title || 'Заявка')}</strong><span>${htmlEsc(dxJobRange(item.row))}${driver?.name ? ' · ' + htmlEsc(driver.name) : ''}</span></button>`;
    }).join('');
    return `<div class="dx-time-row"><div class="dx-time-resource"><strong>${htmlEsc(lane.label)}</strong><span>${lane.jobs.length} ${lane.jobs.length === 1 ? 'заявка' : lane.jobs.length < 5 ? 'заявки' : 'заявок'}</span></div><div class="dx-time-track" style="height:${Math.max(74, ends.length * 58 + 16)}px">${intervals}${showNow ? `<span class="dx-time-now" style="left:${((now - bounds.start) / span * 100).toFixed(4)}%" aria-hidden="true"></span>` : ''}</div></div>`;
  }).join('');
  return `<section class="dx-timeline-panel"><header class="dx-timeline-head"><div><h3>Распределение техники на день</h3><p>Часовой пояс просмотра: ${htmlEsc(dxJobCalendar().timeZone)}. Подтверждённые интервалы; пересечения показаны на отдельных строках.</p></div><span>${dxJobDateLabel(dxJobsDate + 'T12:00', true)}</span></header>
    ${sorted.length ? `<div class="dx-timeline-scroll"><div class="dx-timeline"><div class="dx-time-ruler"><div>Техника / время</div><div class="dx-time-grid">${[0,4,8,12,16,20,24].map(hour=>{const instant=hour===24?bounds.end:Date.parse(BusinessCalendar.parseTime(dxJobsDate+'T'+String(hour).padStart(2,'0')+':00',{timeZone:bounds.timeZone}).instant);return `<span style="left:${(instant-bounds.start)/span*100}%">${String(hour).padStart(2,'0')}:00</span>`;}).join('')}</div></div>${laneHtml}</div></div><div class="dx-timeline-legend">${DX_JOB_COLUMNS.map(column => `<span class="dx-status-${column.status}"><i aria-hidden="true"></i>${column.title}</span>`).join('')}${showNow ? '<span><i class="dx-legend-now" aria-hidden="true"></i>Текущее время при открытии</span>' : ''}</div>` : '<div class="dx-empty-state"><strong>На этот день работа ещё не распределена</strong><p>Создайте заявку или выберите другую дату.</p></div>'}
    ${rows.some(row => row.status === 'cancelled') ? '<p class="dx-timeline-note">Отменённые заявки доступны на доске и не занимают время техники в ленте.</p>' : ''}</section>`;
}

function dxRenderJobs() {
  if (!dxJobCanRead('dispatchJobs')) {
    document.getElementById('mainContent').innerHTML = '<div class="wf-workspace dx-workspace"><div class="dx-empty-state"><strong>Заявки недоступны для вашей роли</strong><p>Доступ к разделам настраивает администратор сервера.</p></div></div>';
    return;
  }
  wfInitData(data);
  dxJobsDate = dxJobsDate || wfToday();
  const allRows=dxJobRows(),rows=allRows.filter(row=>dxJobWindow(row).status==='known');
  const active = rows.filter(row => !row.archived && !['confirmed', 'cancelled'].includes(row.status));
  const unassigned = active.filter(row => !row.assetRef || !EntityIdentity.presentId(row.driverId)).length;
  const late = active.filter(row => dxJobIsLate(row)).length;
  const inProgress = active.filter(row => row.status === 'started').length;
  const sites = [...new Set((data.dispatchJobs || []).map(row => row.site).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  const orgs = [...new Set((data.dispatchJobs || []).map(row => row.org).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  const select = (id, label, list, value) => `<select id="${id}" aria-label="${label}"><option value="">${label}</option>${list.map(item => `<option value="${htmlEsc(item)}" ${item === value ? 'selected' : ''}>${htmlEsc(item)}</option>`).join('')}</select>`;
  const siteSelect = `<select id="dxJobSite" aria-label="Объект заявок"><option value="" ${!dxJobsSiteUnset && !wfSite ? 'selected' : ''}>Все объекты</option><option value="__dx_without_site" ${dxJobsSiteUnset ? 'selected' : ''}>Без объекта</option>${sites.map(site => `<option value="${htmlEsc(site)}" ${!dxJobsSiteUnset && site === wfSite ? 'selected' : ''}>${htmlEsc(site)}</option>`).join('')}</select>`;
  document.getElementById('mainContent').innerHTML = `<div class="wf-workspace dx-workspace dx-jobs">
    <header class="dx-board-heading"><div class="dx-board-title"><div class="dx-eyebrow">Диспетчерская / Заявки</div><h2>Каждое задание под контролем</h2><p>От первого назначения до принятого результата.</p></div><div class="dx-board-tools">${dxJobCanWrite() ? '<button type="button" class="btn btn-primary" onclick="dxJobNew()"><span aria-hidden="true">＋</span> Новая заявка</button>' : '<span class="dx-readonly">Режим просмотра</span>'}</div></header>
    ${wfTabsHtml(WF_DISPATCH_TABS)}
    <div class="dx-board-metrics" aria-label="Сводка по выбранным фильтрам"><div class="dx-board-metric"><span>В выбранном периоде</span><strong>${rows.length}</strong><small>${dxJobsAllDates ? 'все даты' : htmlEsc(dxJobDateLabel(dxJobsDate + 'T12:00', true))}</small></div><div class="dx-board-metric${unassigned ? ' is-warning' : ''}"><span>Нужны назначения</span><strong>${unassigned}</strong><small>техника или сотрудник</small></div><div class="dx-board-metric is-accent"><span>В работе</span><strong>${inProgress}</strong><small>по состоянию заявок</small></div><div class="dx-board-metric${late ? ' is-danger' : ''}"><span>Требуют проверки срока</span><strong>${late}</strong><small>начало или окончание прошло</small></div></div>
    <div class="dx-board-controls"><div class="dx-date-nav"><button type="button" class="btn btn-ghost btn-sm" onclick="dxJobChangeDate(-1)" aria-label="Предыдущий день">‹</button><input id="dxJobDate" type="date" value="${htmlEsc(dxJobsDate)}" aria-label="День расписания"><button type="button" class="btn btn-ghost btn-sm" onclick="dxJobChangeDate(1)" aria-label="Следующий день">›</button><button type="button" class="btn btn-ghost btn-sm" id="dxJobToday">Сегодня</button>${dxJobsView === 'board' ? `<button type="button" class="btn btn-ghost btn-sm${dxJobsAllDates ? ' is-active' : ''}" id="dxJobAllDates" aria-pressed="${dxJobsAllDates}">Все даты</button>` : ''}</div><div class="dx-view-switch" role="group" aria-label="Вид заявок"><button type="button" class="${dxJobsView === 'board' ? 'is-active' : ''}" aria-pressed="${dxJobsView === 'board'}" onclick="dxJobSetView('board')">Доска</button><button type="button" class="${dxJobsView === 'timeline' ? 'is-active' : ''}" aria-pressed="${dxJobsView === 'timeline'}" onclick="dxJobSetView('timeline')">Лента дня</button></div></div>
    <div class="dx-board-filter"><input id="dxJobSearch" type="search" placeholder="Заявка, техника, сотрудник или маршрут" value="${htmlEsc(wfQuery)}" aria-label="Поиск заявок">${siteSelect}${select('dxJobOrg', 'Все организации', orgs, wfOrg)}<label><input id="dxJobArchive" type="checkbox" ${wfShowArchive ? 'checked' : ''}> С архивом</label>${wfQuery || wfSite || wfOrg || wfShowArchive || dxJobsSiteUnset ? '<button type="button" class="btn btn-ghost btn-sm" id="dxJobReset">Сбросить</button>' : ''}</div>
    <p class="wf-note">Часовой пояс просмотра: ${htmlEsc(dxJobCalendar().timeZone)}.</p>${dxJobsView === 'timeline' ? dxJobTimelineHtml(rows) : dxJobBoardHtml(rows)}${dxJobUnknownHtml(allRows)}
    ${rows.length === 0 && dxJobsView === 'board' ? `<div class="dx-board-empty-note">${wfQuery || wfSite || wfOrg || dxJobsSiteUnset ? 'По выбранным фильтрам заявок нет. Измените поиск или сбросьте фильтры.' : 'Для этого периода заявок пока нет. Начните с новой заявки или посмотрите все даты.'}</div>` : ''}
  </div>`;
  document.querySelectorAll('#mainContent [data-personnel-job]').forEach(button=>button.addEventListener('click',()=>{const row=(data.dispatchJobs||[]).find(item=>item.id===JSON.parse(button.dataset.personnelJobKey));if(row&&dxJobCanRead('drivers')&&typeof personnelOpenPerson==='function')personnelOpenPerson(row.driverId);}));
  document.getElementById('dxJobDate').addEventListener('change', event => {
    if (!wfValidDate(event.target.value)) return;
    dxJobsDate = event.target.value; dxJobsAllDates = false; dxRenderJobs();
  });
  document.getElementById('dxJobToday').addEventListener('click', () => {
    dxJobsDate = wfToday(); dxJobsAllDates = false; dxRenderJobs();
  });
  document.getElementById('dxJobAllDates')?.addEventListener('click', () => {
    dxJobsAllDates = !dxJobsAllDates; dxRenderJobs();
  });
  document.getElementById('dxJobSearch').addEventListener('input', event => {
    const position = event.target.selectionStart;
    wfQuery = event.target.value; dxRenderJobs();
    const input = document.getElementById('dxJobSearch'); input.focus();
    input.setSelectionRange(position, position);
  });
  document.getElementById('dxJobSite').addEventListener('change', event => {
    dxJobsSiteUnset = event.target.value === '__dx_without_site';
    wfSite = dxJobsSiteUnset ? '' : event.target.value; dxRenderJobs();
  });
  document.getElementById('dxJobOrg').addEventListener('change', event => { wfOrg = event.target.value; dxRenderJobs(); });
  document.getElementById('dxJobArchive').addEventListener('change', event => { wfShowArchive = event.target.checked; dxRenderJobs(); });
  document.getElementById('dxJobReset')?.addEventListener('click', () => {
    wfQuery = ''; wfSite = ''; wfOrg = ''; wfShowArchive = false; dxJobsSiteUnset = false; dxRenderJobs();
  });
}
