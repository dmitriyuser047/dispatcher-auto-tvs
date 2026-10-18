// Global navigation and overview. Rendering reads the working database only.
function workspaceIcon(name) {
  const shapes = {
    overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    vehicles: '<path d="m3 12 2-6h14l2 6v7H3zM3 12h18M7 16h.01M17 16h.01M5 19v2M19 19v2"/>',
    generators: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V3h8v4m-4 4-3 4h6l-3 4"/>',
    tanks: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
    fuel: '<path d="M3 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M2 21h14M6 7h6M15 10h2a2 2 0 0 1 2 2v5a1 1 0 0 0 2 0V8l-3-3"/>',
    maintenance: '<path d="M14 6a5 5 0 0 0-6 6L3 17a3 3 0 0 0 4 4l5-5a5 5 0 0 0 6-6l-3 3-4-4z"/>',
    repair: '<path d="m15 4 5 5M3 21l7-7m-4-4 8 8M4 3l5 2 1 5-5-1zM12 12l8-8"/>',
    finances: '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9h18m-7 4h7v4h-7zM7 5V3h11"/>',
    reestr: '<path d="M14 2H5v20h14V7zM14 2v5h5M8 12h8M8 16h8"/>',
    users: '<circle cx="9" cy="7" r="4"/><path d="M2 21v-3a6 6 0 0 1 12 0v3m2-18a4 4 0 0 1 0 8m3 10v-3a6 6 0 0 0-2-4"/>',
    reports: '<path d="M3 3v18h18M8 16v-5m5 5V6m5 10v-3"/>',
    print: '<path d="M6 9V3h12v6M6 18H3V9h18v9h-3M6 14h12v7H6z"/>',
    file: '<path d="M14 2H5v20h14V7zM14 2v5h5M8 12h8M8 16h6"/>',
    settings: '<path d="m9 3-1 3-3 1-2 4 2 2 1 4 3 1 2 3 4-1 1-3 3-1 2-4-2-2-1-4-3-1-2-3z"/><circle cx="12" cy="12" r="3"/>',
    database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 9v12"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    'arrow-right': '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    alert: '<path d="m12 3 10 18H2zM12 9v5m0 3h.01"/>',
  };
  return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (shapes[name] || shapes.file) + '</svg>';
}

const WORKSPACE_NAV = [
  ['', [['home', 'Обзор', 'overview']]],
  ['Техника', [['vehicles', 'Транспорт', 'vehicles', 'vehicles'], ['generators', 'ДЭС', 'generators', 'generators'], ['tanks', 'Ёмкости', 'tanks', 'tanks']]],
  ['Операции', [['fuelPurchases', 'ГСМ и заправки', 'fuel'], ['toSchedule', 'График ТО', 'maintenance'], ['repairs', 'Ремонты', 'repair']]],
  ['Финансы', [['finances', 'Платежи и бюджет', 'finances'], ['reestr', 'Реестры счетов', 'reestr'], ['contragents', 'Контрагенты', 'users']]],
  ['Документы', [['reports', 'Отчёты', 'reports'], ['fuelReport', 'Отчёт по топливу', 'fuel'], ['printForms', 'Печатные формы', 'print'], ['pdf', 'PDF-редактор', 'file']]],
];

function workspaceMount() {
  const nav = document.getElementById('workspaceNav');
  if (!nav) return;
  nav.innerHTML = `<a href="#" class="workspace-brand" onclick="event.preventDefault();workspaceNavigate('home')" aria-label="ТВС — обзор">
      <span class="workspace-brand-mark">Т</span><span class="workspace-brand-name">ТВС<span>Диспетчеризация</span></span>
    </a>
    <div class="workspace-nav-groups">${WORKSPACE_NAV.map(([label, entries]) => `<div class="workspace-nav-group">${label ? '<div class="workspace-nav-group-title">' + label + '</div>' : ''}${entries.map(([section, title, icon, count]) => `<button type="button" class="workspace-nav-link" data-section="${section}" onclick="workspaceNavigate('${section}')">${workspaceIcon(icon)}<span class="workspace-nav-label">${title}</span>${count ? '<span class="workspace-nav-count" data-count="' + count + '">0</span>' : ''}</button>`).join('')}</div>`).join('')}</div>
    <div class="workspace-nav-footer"><button class="workspace-nav-link" type="button" onclick="openSettingsModal()">${workspaceIcon('settings')}<span>Настройки и база</span></button>
      <button class="workspace-user" type="button" onclick="openSettingsModal()"><span class="workspace-user-avatar" id="workspaceUserAvatar">Т</span><span><span class="workspace-user-name" id="workspaceUserName">Рабочая база</span><span class="workspace-user-mode" id="workspaceConnection">Локальный режим</span></span></button>
      <button class="workspace-version" type="button" onclick="clShowAll()">Версия <span id="workspaceVersion">3.0.0</span><span>Что нового ↗</span></button>
    </div>`;
  workspaceRefresh();
  if (window.electronAPI?.getAppVersion) window.electronAPI.getAppVersion().then(version => {
    const label = document.getElementById('workspaceVersion'); if (label) label.textContent = version;
  }).catch(() => {});
}

function workspaceNavigate(section) {
  if (_activeSaves) { showToast('Дождитесь завершения сохранения'); return; }
  if (section === 'repairs') { openRepairsJournal(); return; }
  if (section === 'pdf') { openPdfEditor(); return; }
  switchSection(section);
}

function workspaceRefresh() {
  document.querySelectorAll('.workspace-nav-link[data-section]').forEach(button => {
    const selected = button.dataset.section === activeSection;
    button.classList.toggle('active', selected);
    if (selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  document.querySelectorAll('.workspace-nav-count[data-count]').forEach(label => { label.textContent = (data[label.dataset.count] || []).length; });
  const settings = typeof _appSettings !== 'undefined' ? _appSettings : null;
  const profile = settings?.users?.[settings.activeUser || 0];
  const name = document.getElementById('workspaceUserName'), avatar = document.getElementById('workspaceUserAvatar'), mode = document.getElementById('workspaceConnection');
  if (name) name.textContent = profile?.name || 'Рабочая база';
  if (avatar) avatar.textContent = (profile?.name || 'ТВС').slice(0, 1).toUpperCase();
  if (mode) mode.textContent = _loadWriteBlocked ? 'Только просмотр' : settings?.networkMode === 'client' ? 'Подключение по сети' : settings?.networkMode === 'server' ? 'Режим сервера' : 'Локальная база';
  const section = document.getElementById('workspaceBreadcrumb');
  if (section) section.textContent = activeSection === 'home' ? 'Рабочий обзор' : 'Рабочее пространство';
}

function workspaceUpdateStatus(state) {
  const status = document.getElementById('workspaceSaveStatus');
  if (!status) return;
  status.dataset.state = state;
  const labels = { ready: 'Данные загружены', saving: 'Сохранение…', saved: 'Изменения сохранены', error: 'Не сохранено', offline: 'Только просмотр' };
  status.textContent = labels[state] || labels.ready;
  workspaceRefresh();
}

function workspaceNumber(value, digits = 0) {
  const number = Number(value);
  return (Number.isFinite(number) ? number : 0).toLocaleString('ru-RU', { maximumFractionDigits: digits });
}

function workspaceFleetTools(section) {
  if (section === 'generators') return `<button type="button" class="btn btn-ghost" onclick="exportDesForOtherComputer()">${workspaceIcon('file')}Экспорт ДЭС</button>`;
  return [['importMenu', 'workspaceFleetImport', 'Импорт'], ['exportSvodkaMenu', 'workspaceFleetExport', 'Выгрузка']].map(([source, id, label]) => {
    const menu = document.getElementById(source);
    return menu ? `<div class="dropdown"><button type="button" class="btn btn-ghost" onclick="toggleDropdown('${id}')">${workspaceIcon('file')}${label}<span aria-hidden="true">⌄</span></button><div class="dropdown-menu" id="${id}">${menu.innerHTML}</div></div>` : '';
  }).join('');
}

function workspaceOverview() {
  const today = todayIso(), from = today.slice(0, 7) + '-01';
  const inPeriod = date => date && date >= from && date <= today;
  const records = (data.records || []).filter(row => inPeriod(row.date));
  const payments = (data.payments || []).filter(row => typeof woPaymentBalance==='function'?woPaymentBalance(row)>.009:!row.paid);
  const planned = [...(data.vehicleTo || []), ...(data.toRecords || [])].filter(row => row.planned && row.date);
  const horizon = new Date(); horizon.setDate(horizon.getDate() + 7);
  const due = planned.filter(row => row.date <= todayIso(horizon));
  const workQueue=typeof workspaceBuildIssues==='function'?workspaceBuildIssues('maintenance'):null;
  let ledger = { receipts: [], errors: [], barrels: [] };
  if (typeof gsmBuildLedger === 'function') ledger = gsmBuildLedger(data, { from, to: today });
  const vehicles = new Map((data.vehicles || []).map(row => [row.id, row]));
  const generators = new Map((data.generators || []).map(row => [row.id, row]));
  const recent = [
    ...(data.records || []).map(row => ({ id: row.id, date: row.date, kind: 'Пробег', section: 'records', title: vehicles.get(row.vehicleId)?.plate || 'ТС не найдено', note: vehicles.get(row.vehicleId)?.make || '', value: workspaceNumber(row.km, 1) + ' км', detail: row.note || '' })),
    ...(data.genRecords || []).map(row => ({ id: row.id, date: row.date, kind: 'Наработка ДЭС', section: 'genRecords', title: generators.get(row.generatorId)?.name || 'ДЭС не найдена', note: generators.get(row.generatorId)?.location || '', value: workspaceNumber(row.hours, 1) + ' мтч', detail: row.note || '' })),
  ].filter(row => row.date).sort((a, b) => cmpDateDesc(a.date, b.date)).slice(0, 6);
  return { today, from, vehicleCount: vehicles.size, generatorCount: generators.size,
    repairCount: (data.vehicles || []).filter(row => /ремонт|дтп/i.test(row.status || '')).length,
    orgCount: new Set((data.vehicles || []).map(row => String(row.org || '').trim()).filter(Boolean)).size,
    km: records.reduce((sum, row) => sum + (Number(row.km) || 0), 0), recordCount: records.length,
    received: ledger.receipts.reduce((sum, row) => sum + (Number(row.qty) || 0), 0),
    fuelIssues: ledger.errors.length, pendingReceipts: ledger.receipts.filter(row => !row.recordId).length,
    due: workQueue?workQueue.length:due.length, overdue: workQueue?workQueue.filter(row=>row.date&&row.date<today).length:due.filter(row => row.date < today).length,
    paymentCount: payments.length, payable: payments.reduce((sum, row) => sum + (typeof woPaymentBalance==='function'?woPaymentBalance(row):Number(row.sum)||0), 0), recent };
}

function workspaceOpenEntry(section, id) {
  if(typeof workspaceFocusRecord==='function')return workspaceFocusRecord(section,id);
  switchSection(section);
  if (section === 'vehicles' && (data.vehicles || []).some(row => row.id === id)) selectVehicle(id);
  if (section === 'generators' && (data.generators || []).some(row => row.id === id)) openGeneratorDetail(id);
}

function renderWorkspaceDashboard() {
  const view = workspaceOverview();
  const month = new Date().toLocaleDateString('ru-RU', { month: 'long' });
  const metric = (label, value, unit, note, icon) => `<article class="workspace-metric"><div class="workspace-metric-label">${label}${workspaceIcon(icon)}</div><div class="workspace-metric-value">${value}<span>${unit}</span></div><div class="workspace-metric-note">${note}</div></article>`;
  const queue = (icon, label, note, amount, destination, warning) => `<button type="button" class="workspace-queue-item" onclick="workspaceOpenIssues('${destination}')"><span class="workspace-queue-icon ${warning ? 'is-warning' : ''}">${workspaceIcon(icon)}</span><span class="workspace-queue-copy"><span class="workspace-queue-label">${label}</span><span class="workspace-queue-note">${note}</span></span><span class="workspace-queue-count">${amount}</span>${workspaceIcon('arrow-right')}</button>`;
  document.getElementById('mainContent').innerHTML = `<div class="workspace-dashboard">
    <div class="workspace-page-intro"><div><div class="workspace-eyebrow">Ежедневная работа</div><h1 class="workspace-page-title">Рабочий обзор</h1><p class="workspace-page-subtitle">Техника, топливо и задачи — в одном пространстве.</p></div><div class="workspace-page-actions"><span class="workspace-date">${new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</span><button type="button" class="btn btn-primary" onclick="workspaceNavigate('vehicles')">${workspaceIcon('vehicles')}Открыть транспорт</button></div></div>
    <div class="workspace-metrics">
      ${metric('Транспорт в базе', workspaceNumber(view.vehicleCount), 'ТС', view.orgCount + ' орг. · ' + view.repairCount + ' в ремонте', 'vehicles')}
      ${metric('Пробег за ' + month, workspaceNumber(view.km, 1), 'км', view.recordCount + ' записей с начала месяца', 'reports')}
      ${metric('Получено топлива', workspaceNumber(view.received, 1), 'л', 'С ' + fmtDate(view.from) + ' по ' + fmtDate(view.today), 'fuel')}
      ${metric('Ожидают оплаты', workspaceNumber(view.payable, 2), '₽', view.paymentCount + ' записей в журнале платежей', 'finances')}
    </div>
    <div class="workspace-overview-grid"><section class="workspace-panel"><div class="workspace-panel-heading"><h2 class="workspace-panel-title">Требует внимания</h2><span class="workspace-badge is-neutral">По данным базы</span></div>
      ${queue('fuel', 'Проверка ГСМ', view.fuelIssues ? 'Замечания в расчёте за текущий месяц' : 'Замечаний в расчёте за месяц нет', workspaceNumber(view.fuelIssues), 'fuel', view.fuelIssues > 0)}
      ${queue('maintenance', 'Ближайшее обслуживание', view.overdue ? view.overdue + ' просроченных работ по графику' : 'Запланированные работы на 7 дней', workspaceNumber(view.due), 'maintenance', view.overdue > 0)}
      ${queue('finances', 'Неоплаченные платежи', 'Проверить даты, суммы и получателей', workspaceNumber(view.paymentCount), 'payments', view.paymentCount > 0)}
    </section><section class="workspace-panel"><div class="workspace-panel-heading"><h2 class="workspace-panel-title">Быстрые действия</h2><span class="workspace-panel-caption">Частые операции</span></div><div class="workspace-shortcuts">
      <button type="button" onclick="workspaceNavigate('fuelPurchases')">${workspaceIcon('fuel')}<span>Выписки и заправки<small>Проверить и связать с журналом</small></span>${workspaceIcon('arrow-right')}</button>
      <button type="button" onclick="workspaceNavigate('toSchedule')">${workspaceIcon('maintenance')}<span>График обслуживания<small>Работы по транспорту и ДЭС</small></span>${workspaceIcon('arrow-right')}</button>
      <button type="button" onclick="workspaceNavigate('reestr')">${workspaceIcon('reestr')}<span>Собрать реестр счетов<small>Импорт документов и выгрузка</small></span>${workspaceIcon('arrow-right')}</button>
    </div></section></div>
    <section class="workspace-panel"><div class="workspace-panel-heading"><div><h2 class="workspace-panel-title">Последние записи</h2><p class="workspace-panel-caption">Пробег транспорта и наработка генераторов</p></div><button type="button" class="btn btn-ghost btn-sm" onclick="workspaceNavigate('reports')">Все отчёты ${workspaceIcon('arrow-right')}</button></div>
      <div class="workspace-table-wrap"><table class="workspace-table"><thead><tr><th scope="col">Дата</th><th scope="col">Техника</th><th scope="col">Операция</th><th scope="col" class="workspace-number">Объём работы</th><th scope="col">Примечание</th><th scope="col"><span class="sr-only">Открыть</span></th></tr></thead><tbody>
      ${view.recent.length ? view.recent.map(row => `<tr><td>${htmlEsc(fmtDate(row.date))}</td><td><strong>${htmlEsc(row.title)}</strong><small>${htmlEsc(row.note)}</small></td><td><span class="workspace-badge is-neutral">${row.kind}</span></td><td class="workspace-number">${row.value}</td><td class="workspace-recent-note">${htmlEsc(row.detail || '—')}</td><td><button type="button" class="icon-btn" aria-label="Открыть ${htmlEsc(row.title)}" onclick="workspaceOpenEntry('${row.section}',${htmlJs(row.id)})">${workspaceIcon('arrow-right')}</button></td></tr>`).join('') : '<tr><td colspan="6"><div class="workspace-empty">' + workspaceIcon('file') + '<strong>Здесь появятся рабочие записи</strong><span>Добавьте технику и внесите пробег или наработку. Показатели обзора заполнятся автоматически.</span></div></td></tr>'}
      </tbody></table></div></section>
    <div class="workspace-dashboard-footnote">Обзор использует текущую базу. ГСМ — с начала месяца по сегодня; суммы — по неоплаченным записям платежей.</div>
  </div>`;
  workspaceRefresh();
}
