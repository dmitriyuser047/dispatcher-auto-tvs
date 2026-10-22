// Диспетчерская — самостоятельный раздел с собственной навигацией и фильтрами.
const WF_DISPATCH_TABS = {
  overview:'Обзор', dispatchJobs:'Заявки', assetAssignments:'Назначения',
  drivers:'Водители', operators:'Операторы ДЭС', shiftReports:'Сменные формы',
};
const wfWorkspaceState = {
  dispatch:{tab:'overview',query:'',site:'',org:'',archive:false},
  workflows:{tab:'opsTasks',query:'',site:'',org:'',archive:false},
};
function wfSectionForTab(tab){return Object.hasOwn(WF_DISPATCH_TABS,tab)?'dispatch':'workflows';}
function wfVisibleTabs(section=activeSection){
  return section==='dispatch'?WF_DISPATCH_TABS:Object.fromEntries(Object.entries(WF_TABS).filter(([key])=>wfSectionForTab(key)==='workflows'));
}
function wfSwitchWorkspace(previous,next,options={}){
  if(wfWorkspaceState[previous]&&Object.hasOwn(wfVisibleTabs(previous),wfTab)){
    wfWorkspaceState[previous]={tab:wfTab,query:wfQuery,site:wfSite,org:wfOrg,archive:wfShowArchive};
  }
  if(!wfWorkspaceState[next]||previous===next&&!options.workflowTab)return;
  const state=wfWorkspaceState[next],tabs=wfVisibleTabs(next);
  wfTab=Object.hasOwn(tabs,options.workflowTab)?options.workflowTab:state.tab;
  wfQuery=options.query??state.query;wfSite=options.site??state.site;
  wfOrg=options.org??state.org;wfShowArchive=options.archive??state.archive;
}
function wfOpenTab(tab,view={}){
  if(tab==='drivers'||tab==='operators'){switchSection(tab);return;}
  if(tab==='dispatchJobs' && typeof dxJobsSiteUnset!=='undefined')dxJobsSiteUnset=!!view.siteUnset;
  switchSection(wfSectionForTab(tab),{...view,workflowTab:tab});
}
function wfTabsHtml(tabs=wfVisibleTabs()){
  return `<nav class="wf-tabs" aria-label="${activeSection==='dispatch'?'Разделы диспетчерской':'Рабочие процессы'}">${Object.entries(tabs).filter(([key])=>!['drivers','operators'].includes(key)||dxOverviewCanRead('drivers')).map(([key,label])=>`<button type="button" class="btn ${wfTab===key?'btn-primary':'btn-ghost'} btn-sm" aria-current="${wfTab===key?'page':'false'}" onclick="wfOpenTab(${htmlJs(key)})">${htmlEsc(label)}${key==='overview'?'':` <small>${['drivers','operators'].includes(key)&&typeof personnelRows==='function'?personnelRows(key==='drivers'?'driver':'operator').filter(row=>!row.archived).length:(data[key]||[]).length}</small>`}</button>`).join('')}</nav>`;
}
let dxOverviewDate = '';
let dxOverviewSite = '';

function dxOverviewCanRead(section) {
  return typeof _sync === 'undefined' || !_sync.access ||
    !Array.isArray(_sync.access.readable) || _sync.access.readable.includes(section);
}

function dxOverviewCanWrite(section) {
  return typeof _sync === 'undefined' || !_sync.access ||
    Array.isArray(_sync.access.writable) && _sync.access.writable.includes(section);
}

function dxOverviewSiteKey(value) { return String(value || '').trim() || '__without_site'; }
function dxOverviewSiteLabel(value) { return value === '__without_site' ? 'Без объекта' : value; }

function dxOverviewDayJobs(date) {
  if (!dxOverviewCanRead('dispatchJobs')) return [];
  const bounds=dxJobDayBounds(date);if(bounds.status!=='known')return [];
  return (data.dispatchJobs||[]).filter(job=>{if(job.archived)return false;const window=dxJobWindow(job);return window.status==='known'&&window.from<bounds.end&&window.to>bounds.start;});
}

function dxOverviewAssets(date) {
  const assets = [];
  if (dxOverviewCanRead('vehicles')) (data.vehicles || []).filter(row => !row.archived).forEach(row =>
    assets.push({ ref: 'v:' + row.id, label: [row.plate, row.make].filter(Boolean).join(' · ') || 'Транспорт', icon: 'car', row }));
  if (dxOverviewCanRead('generators')) (data.generators || []).filter(row => !row.archived).forEach(row =>
    assets.push({ ref: 'g:' + row.id, label: row.name || 'ДЭС', icon: 'power', row }));
  return assets.map(asset => {
    const context = dxOverviewCanRead('assetAssignments') ? wfContext(asset.ref, date) : asset.row;
    return { ...asset, context, site: dxOverviewSiteKey(context.site || context.object || context.location) };
  });
}

function dxOverviewFleetState(asset, jobs, date) {
  const linked = jobs.filter(job => job.assetRef === asset.ref && ['assigned', 'started'].includes(job.status));
  const status = String(asset.context.status || asset.row.status || '').trim();
  const orders=dxOverviewCanRead('workOrders')?(data.workOrders||[]).filter(order=>!order.archived&&order.assetRef===asset.ref&&order.downtime?.mode!=='none'&&['approved','repairing'].includes(order.status)):[],bounds=dxJobDayBounds(date);
  const repair=orders.some(order=>{if(bounds.status!=='known')return false;const from=BusinessCalendar.timeAt(data,'workOrders',order,'downtimeFrom'),to=BusinessCalendar.timeAt(data,'workOrders',order,'downtimeTo');return from.status==='known'&&(to.status==='known'||to.status==='missing')&&Date.parse(from.instant)<bounds.end&&(to.status==='missing'||Date.parse(to.instant)>bounds.start);});
  const uncertain=orders.some(order=>{const from=BusinessCalendar.timeAt(data,'workOrders',order,'downtimeFrom'),to=BusinessCalendar.timeAt(data,'workOrders',order,'downtimeTo');return from.status!=='known'||to.status==='unknown';});
  if(uncertain&&!repair)return{label:'Проверить время',tone:'is-warning',detail:'Часовой пояс или начало простоя не подтверждены',rank:1};
  if (repair || /ремонт|дтп|списан|продан/i.test(status)) return { label: 'Проверить статус', tone: 'is-danger', detail: repair ? 'Есть незакрытый ремонтный заказ' : status, rank: 0 };
  const document = dxOverviewCanRead('assetDocuments') && (data.assetDocuments || []).find(row =>
    !row.archived && row.mandatory && row.assetRef === asset.ref && row.expires && row.expires < date);
  if (document) return { label: 'Документы', tone: 'is-warning', detail: 'Истёк срок: ' + (document.title || 'обязательный документ'), rank: 1 };
  const inProgress = linked.find(job => job.status === 'started');
  if (inProgress) return { label: 'В работе', tone: 'is-active', detail: inProgress.title || 'Есть начатая заявка', rank: 2 };
  if (linked.length) return { label: 'Назначена', tone: 'is-good', detail: linked.length === 1 ? linked[0].title : `${linked.length} заявок на день`, rank: 3 };
  return { label: 'Без заявки', tone: '', detail: status ? 'По карточке: ' + status : 'Состояние в карточке не указано', rank: 4 };
}

function dxOverviewOpenJobs(view = 'board', site = dxOverviewSite) {
  dxJobsDate = dxOverviewDate || wfToday(); dxJobsAllDates = false; dxJobsView = view;
  wfOpenTab('dispatchJobs', { query: '', site: site === '__without_site' ? '' : site, siteUnset: site === '__without_site', org: '', archive: false });
}

function dxOverviewNewJob() {
  if (!dxOverviewCanWrite('dispatchJobs')) return;
  dxOverviewOpenJobs('board'); dxJobNew();
}

function dxOverviewOpenAsset(ref) {
  const vehicle = ref.startsWith('v:');
  if (!dxOverviewCanRead(vehicle ? 'vehicles' : 'generators')) return;
  switchSection(vehicle ? 'vehicles' : 'generators');
  if (vehicle) selectVehicle(wfAsset(ref)?.id); else openGeneratorDetail(wfAsset(ref)?.id);
}

function dxOverviewOpenJob(id) {
  if (!dxOverviewCanRead('dispatchJobs')) return;
  if (dxOverviewCanWrite('dispatchJobs')) wfEdit('dispatchJobs', id); else dxJobDetails(id);
}

function dxOverviewMoveDate(delta) {
  const date = new Date((dxOverviewDate || wfToday()) + 'T12:00:00Z'); date.setUTCDate(date.getUTCDate() + delta);
  dxOverviewDate = date.toISOString().slice(0,10);
  renderDispatchOverview();
}

function dxOverviewSetSite(site) { dxOverviewSite = site; renderDispatchOverview(); }

function renderDispatchOverview() {
  wfTab = 'overview'; dxOverviewDate = dxOverviewDate || wfToday();
  const date = dxOverviewDate, selected = new Date(date + 'T12:00:00');
  const allJobs = dxOverviewDayJobs(date), allAssets = dxOverviewAssets(date);
  const matchesSite = value => !dxOverviewSite || value === dxOverviewSite;
  const jobs = allJobs.filter(job => matchesSite(dxOverviewSiteKey(job.site)));
  const assets = allAssets.filter(asset => matchesSite(asset.site));
  const unknownJobs=dxOverviewCanRead('dispatchJobs')?(data.dispatchJobs||[]).filter(job=>!job.archived&&dxJobWindow(job).status!=='known'&&matchesSite(dxOverviewSiteKey(job.site))):[];
  const active = jobs.filter(job => ['new', 'assigned', 'started'].includes(job.status));
  const assigned = active.filter(job => job.assetRef && EntityIdentity.presentId(job.driverId)).length;
  const completed = jobs.filter(job => ['done', 'confirmed'].includes(job.status)).length;
  const confirmed = jobs.filter(job => job.status === 'confirmed').length;
  const started = active.filter(job => job.status === 'started').length;
  const fleet = assets.map(asset => ({ ...asset, state: dxOverviewFleetState(asset, allJobs, date) }))
    .sort((a, b) => a.state.rank - b.state.rank || a.label.localeCompare(b.label, 'ru'));
  const sites = [...new Set([...allAssets.map(asset => asset.site), ...allJobs.map(job => dxOverviewSiteKey(job.site))])]
    .sort((a, b) => dxOverviewSiteLabel(a).localeCompare(dxOverviewSiteLabel(b), 'ru'));
  if (dxOverviewSite && !sites.includes(dxOverviewSite)) sites.push(dxOverviewSite);
  const visibleSites = sites.filter(matchesSite);
  const schedule = jobs.filter(job => job.status !== 'cancelled').slice().sort((a, b) => {
    const rank = status => status === 'started' ? 0 : ['new', 'assigned'].includes(status) ? 1 : 2;
    return rank(a.status) - rank(b.status) || String(a.start).localeCompare(String(b.start));
  });
  const canReadJobs = dxOverviewCanRead('dispatchJobs');
  const canReadFleet = dxOverviewCanRead('vehicles') || dxOverviewCanRead('generators');
  const jobMetric = value => canReadJobs ? value : '—';
  const empty = (icon, title, text, action = '') => `<div class="dx-empty">${xpIcon(icon, 30)}<strong>${title}</strong><span>${text}</span>${action}</div>`;
  const scheduleHtml = schedule.slice(0, 6).map(job => {
    const interval=dxJobWindow(job),zone=dxJobCalendar().timeZone;const firstDay=BusinessCalendar.dateAt(interval.start,zone)===date,lastDay=BusinessCalendar.dateAt(interval.end,zone)===date;
    const asset = dxJobAsset(job), driver = dxJobDriver(job);
    const detail = [asset?.label || 'Техника не назначена', driver?.name || 'Сотрудник не назначен', job.site].filter(Boolean).join(' · ');
    const tone = job.status === 'started' ? 'is-active' : ['done', 'confirmed'].includes(job.status) ? 'is-good' : dxJobIsLate(job) ? 'is-warning' : '';
    return `<button type="button" class="dx-schedule-item" onclick="dxOverviewOpenJob(${htmlJs(job.id)})" title="${htmlEsc(dxJobRange(job, true))}"><span class="dx-time">${firstDay ? dxJobTime(interval.start) : htmlEsc(dxJobDateLabel(interval.start))}<small>${lastDay ? 'до ' + dxJobTime(interval.end) : 'до ' + htmlEsc(dxJobDateLabel(interval.end))}</small></span><span class="dx-schedule-copy"><strong>${htmlEsc(job.title || 'Заявка')}</strong><span>${htmlEsc(detail)}</span></span><span class="dx-status-pill ${tone}">${htmlEsc(WF_STATUS[job.status] || job.status || 'Без состояния')}</span></button>`;
  }).join('');
  const fleetHtml = fleet.slice(0, 6).map(asset => `<button type="button" class="dx-fleet-item" onclick="dxOverviewOpenAsset(${htmlJs(asset.ref)})"><span class="dx-asset-mark">${xpIcon(asset.icon, 19)}</span><span class="dx-asset-copy"><strong>${htmlEsc(asset.label)}</strong><small title="${htmlEsc(asset.state.detail)}">${htmlEsc(asset.state.detail || dxOverviewSiteLabel(asset.site))}</small></span><span class="dx-asset-state ${asset.state.tone}">${asset.state.label}</span></button>`).join('');
  const sitesHtml = visibleSites.slice(0, 9).map(site => {
    const siteAssets = allAssets.filter(asset => asset.site === site);
    const siteJobs = allJobs.filter(job => job.status !== 'cancelled' && dxOverviewSiteKey(job.site) === site);
    const siteDone = siteJobs.filter(job => ['done', 'confirmed'].includes(job.status)).length;
    const siteStarted = siteJobs.filter(job => job.status === 'started').length;
    const siteAssigned = siteJobs.filter(job => job.status === 'assigned').length;
    const denominator = siteJobs.length || 1;
    return `<article class="dx-site-item"><div class="dx-site-heading"><button type="button" class="dx-panel-action" onclick="dxOverviewSetSite(${htmlJs(site)})" title="Показать объект">${htmlEsc(dxOverviewSiteLabel(site))}</button><small>${siteAssets.length} ед.</small></div><div class="dx-site-track" aria-label="${siteDone} из ${siteJobs.length} заявок завершено"><i class="is-good" style="width:${siteDone / denominator * 100}%"></i><i style="width:${siteStarted / denominator * 100}%"></i><i class="is-warning" style="width:${siteAssigned / denominator * 100}%"></i></div><div class="dx-site-stats"><span>Завершено <strong>${siteDone}/${siteJobs.length}</strong></span><span>В работе <strong>${siteStarted}</strong></span></div></article>`;
  }).join('');
  const vehicleCount = assets.filter(asset => asset.ref.startsWith('v:')).length;
  const generatorCount = assets.length - vehicleCount;
  document.getElementById('mainContent').innerHTML = `<div class="wf-workspace dispatch-workspace dx-workspace"><div class="home-dashboard dispatch-dashboard dx-shell">
    <header class="dx-hero"><div class="dx-hero-copy"><div class="dx-kicker">Диспетчерская · Пульт управления</div><h2>Смена под контролем.</h2><p>Заявки, техника и выполнение работ — собраны в одном месте. Откройте задание и переходите к следующему действию.</p></div><div class="dx-hero-actions">${dxOverviewCanWrite('dispatchJobs') ? `<button type="button" class="dx-primary-action" onclick="dxOverviewNewJob()">${xpIcon('calendar', 17)} Новая заявка</button>` : ''}<button type="button" class="dx-secondary-action" onclick="xpToggleFocus()" title="Режим фокуса · F8">${xpIcon('expand', 17)} Режим фокуса</button></div><div class="dx-hero-bottom"><span class="dx-shift-title"><strong>Сводка из рабочих записей</strong></span><span class="dx-mode-tag">${dxOverviewSite ? htmlEsc(dxOverviewSiteLabel(dxOverviewSite)) : 'Все объекты'}</span><span class="dx-date">${htmlEsc(selected.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</span></div></header>
    <div class="dx-overview-tabs">${wfTabsHtml(WF_DISPATCH_TABS)}</div>
    <div class="dx-overview-controls"><div class="dx-date-nav"><button type="button" class="btn btn-ghost btn-sm" onclick="dxOverviewMoveDate(-1)" aria-label="Предыдущий день">‹</button><input id="dxOverviewDate" type="date" value="${htmlEsc(date)}" aria-label="День сводки"><button type="button" class="btn btn-ghost btn-sm" onclick="dxOverviewMoveDate(1)" aria-label="Следующий день">›</button><button type="button" class="btn btn-ghost btn-sm" id="dxOverviewToday">Сегодня</button></div><select id="dxOverviewSite" aria-label="Объект сводки"><option value="">Все объекты</option>${sites.map(site => `<option value="${htmlEsc(site)}" ${site === dxOverviewSite ? 'selected' : ''}>${htmlEsc(dxOverviewSiteLabel(site))}</option>`).join('')}</select></div>
    <p class="wf-note">Часовой пояс просмотра: ${htmlEsc(dxJobCalendar().timeZone)}.</p>${dxJobUnknownHtml(unknownJobs)}<div class="home-kpis dx-metrics" aria-label="Сводка по выбранному дню и объекту"><article class="dx-metric"><span class="dx-metric-label">Активные заявки</span><strong class="dx-metric-value">${jobMetric(active.length)}</strong><span class="dx-metric-note">${canReadJobs ? `${started} в работе · ${active.length - started} ожидают` : 'Доступ к заявкам ограничен'}</span></article><article class="dx-metric${canReadJobs && assigned < active.length ? ' is-warning' : ''}"><span class="dx-metric-label">Ресурсы назначены</span><strong class="dx-metric-value">${jobMetric(assigned)}<small>${canReadJobs ? '/ ' + active.length : ''}</small></strong><span class="dx-metric-note">указаны техника и сотрудник</span></article><article class="dx-metric"><span class="dx-metric-label">Работы завершены</span><strong class="dx-metric-value">${jobMetric(completed)}</strong><span class="dx-metric-note">${canReadJobs ? `${confirmed} с подтверждением результата` : 'Доступ к заявкам ограничен'}</span></article><article class="dx-metric"><span class="dx-metric-label">Техника по учёту</span><strong class="dx-metric-value">${canReadFleet ? assets.length : '—'}</strong><span class="dx-metric-note">${canReadFleet ? `${vehicleCount} ТС · ${generatorCount} ДЭС · без архива` : 'Доступ к карточкам ограничен'}</span></article></div>
    <div class="dx-main-grid"><section class="dx-panel"><header class="dx-panel-heading"><div><h3 class="dx-panel-title">План на день</h3><p class="dx-panel-subtitle">Сначала текущие и незавершённые задания</p></div>${canReadJobs ? `<button type="button" class="dx-panel-action" onclick="dxOverviewOpenJobs('timeline')">Лента дня ${xpIcon('arrow', 15)}</button>` : ''}</header>${scheduleHtml ? `<div class="dx-schedule-list">${scheduleHtml}</div>${schedule.length > 6 ? `<div class="dx-panel-footer"><button type="button" class="dx-panel-action" onclick="dxOverviewOpenJobs('board')">Все ${schedule.length} заявок ${xpIcon('arrow', 15)}</button></div>` : ''}` : empty('calendar', canReadJobs ? 'День пока не расписан' : 'Заявки недоступны', canReadJobs ? 'Создайте заявку, выберите технику и назначьте сотрудника.' : 'Доступ определяется вашей сетевой ролью.', dxOverviewCanWrite('dispatchJobs') ? '<button type="button" class="dx-panel-action" onclick="dxOverviewNewJob()">Создать первую заявку →</button>' : '')}</section>
    <section class="dx-panel"><header class="dx-panel-heading"><div><h3 class="dx-panel-title">Парк и назначения</h3><p class="dx-panel-subtitle">Состояния по карточкам и рабочим записям</p></div>${dxOverviewCanRead('assetAssignments') ? `<button type="button" class="dx-panel-action" onclick="wfOpenTab('assetAssignments')">Назначения ${xpIcon('arrow', 15)}</button>` : ''}</header>${fleetHtml ? `<div class="dx-fleet-list">${fleetHtml}</div><div class="dx-panel-footer"><span class="dx-overview-caption">${fleet.length > 6 ? `Показано 6 из ${fleet.length}. ` : ''}Откройте карточку для проверки состояния и истории.</span></div>` : empty('car', canReadFleet ? 'Нет техники для выбранного объекта' : 'Карточки техники недоступны', canReadFleet ? 'Проверьте объект в карточках и периоды назначений.' : 'Доступ определяется вашей сетевой ролью.')}</section></div>
    <section class="dx-panel"><header class="dx-panel-heading"><div><h3 class="dx-panel-title">Работа по объектам</h3><p class="dx-panel-subtitle">Заявки выбранного дня и закреплённая техника</p></div>${dxOverviewSite ? '<button type="button" class="dx-panel-action" onclick="dxOverviewSetSite(\'\')">Все объекты →</button>' : `<span class="dx-chip">${sites.length} объектов</span>`}</header>${sitesHtml ? `<div class="dx-site-grid">${sitesHtml}</div>${visibleSites.length > 9 ? `<div class="dx-panel-footer"><span class="dx-overview-caption">Показаны первые 9 объектов. Выберите нужный объект в фильтре сводки.</span></div>` : ''}` : empty('grid', 'Объекты ещё не указаны', 'Укажите объект в карточке техники, назначении или заявке.')}</section>
    <div class="dx-command-strip"><div>${xpIcon('search', 18)}<span><strong>Найти за секунды</strong> · раздел, машину, сотрудника или документ</span></div><button type="button" class="dx-command-button" onclick="openCommandPalette()">Открыть поиск <kbd>Ctrl K</kbd></button></div>
  </div></div>`;
  document.getElementById('dxOverviewDate').addEventListener('change', event => {
    if (wfValidDate(event.target.value)) { dxOverviewDate = event.target.value; renderDispatchOverview(); }
  });
  document.getElementById('dxOverviewToday').addEventListener('click', () => { dxOverviewDate = wfToday(); renderDispatchOverview(); });
  document.getElementById('dxOverviewSite').addEventListener('change', event => dxOverviewSetSite(event.target.value));
  renderOpsCenter();
  const attention = document.querySelector('#opsCenter .ops-panel-head p');
  if (attention) attention.textContent = 'Проверки на ' + new Date(wfToday()+'T12:00:00Z').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone:'UTC' }) + ' и ближайшие события';
}
