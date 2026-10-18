// Плитки ТС и ДЭС, список и выбор ДЭС
// Выделено из index.html

// ─── FLEET WORKSPACE ────────────────────────────────────
let vcSearchQuery = '';
let genSearchQuery = '';
const fleetViewModes = { vehicles: 'table', generators: 'table' };
// Profile preferences are loaded by productivityInitialize; never inherit another base's view.

function setFleetView(section, view) {
  if (!Object.prototype.hasOwnProperty.call(fleetViewModes, section)) return;
  fleetViewModes[section] = view === 'cards' ? 'cards' : 'table';
  if (typeof productivitySetPreference === 'function') productivitySetPreference('fleetView.' + section, fleetViewModes[section]);
  if (section === 'vehicles') renderVehicleCards(); else renderGeneratorCards();
  document.querySelectorAll('[data-fleet-view="' + section + '"]').forEach(button => {
    const active = button.dataset.view === fleetViewModes[section];
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function fleetSetFilter(name, value) {
  if (name === 'status') filterStatus = value;
  if (name === 'fuel') filterFuel = value;
  if (name === 'org') filterOrg = value;
  renderVehicleCards();
}

function fleetFiltersHtml() {
  const option = (value, label, current) => `<option value="${htmlEsc(value)}" ${value === current ? 'selected' : ''}>${htmlEsc(label)}</option>`;
  return `<div class="fleet-filters">
    <select aria-label="Статус транспорта" onchange="fleetSetFilter('status',this.value)">${option('', 'Все статусы', filterStatus)}${[...new Set((data.vehicles || []).map(v => v.status).filter(Boolean))].sort().map(s => option(s.toLowerCase(), s, filterStatus)).join('')}</select>
    <select aria-label="Топливо транспорта" onchange="fleetSetFilter('fuel',this.value)">${[['','Все виды топлива'],['diesel','Дизель'],['gasoline','Бензин'],['gas','Газ']].map(([v,l]) => option(v,l,filterFuel)).join('')}</select>
    <select aria-label="Организация транспорта" onchange="fleetSetFilter('org',this.value)">${option('', 'Все организации', filterOrg)}${[...new Set((data.vehicles || []).map(v => v.org).filter(Boolean))].sort().map(s => option(s,s,filterOrg)).join('')}</select>
    <button type="button" class="btn btn-ghost btn-sm" onclick="openSavedViews()">Выборки</button>
  </div>`;
}

function fleetStatusBadge(status) {
  const variant = ['На ходу', 'В работе'].includes(status) ? 'is-success'
    : ['В ремонте', 'После ДТП', 'Неисправен'].includes(status) ? 'is-danger'
    : !status || ['В резерве', 'Резерв'].includes(status) ? 'is-neutral' : 'is-warning';
  return `<span class="workspace-badge ${variant}">${htmlEsc(status || 'Не указан')}</span>`;
}

function fleetViewSwitch(section) {
  return `<div class="fleet-view-switch" role="group" aria-label="Вид списка">
    ${[['table', 'table', 'Таблица'], ['cards', 'grid', 'Карточки']].map(([view, icon, label]) =>
      `<button type="button" class="${fleetViewModes[section] === view ? 'active' : ''}" data-fleet-view="${section}" data-view="${view}" aria-pressed="${fleetViewModes[section] === view}" onclick="setFleetView('${section}','${view}')">${workspaceIcon(icon)}<span>${label}</span></button>`).join('')}
  </div>`;
}

function fleetEmptyHtml(hasData, noun, icon) {
  return `<div class="fleet-empty">${workspaceIcon(icon)}
    <strong>${hasData ? 'Ничего не найдено' : 'Добавьте ' + noun}</strong>
    <p>${hasData ? 'Измените поисковый запрос или сбросьте фильтры.' : 'Здесь появятся техника, её состояние и данные журналов.'}</p>
  </div>`;
}

function renderVehicleCards() {
  const q = vcSearchQuery.toLowerCase().trim();
  const vehicles = data.vehicles || [];
  const filtered = vehicles.filter(v => {
    const combined = [v.plate, v.make, v.model, v.driver, v.org, v.object, v.responsible, v.status, v.note, v.vin, v.fuel]
      .map(value => String(value || '').toLowerCase()).join(' ');
    if (q && !q.split(/\s+/).every(word => combined.includes(word))) return false;
    if (filterStatus && !String(v.status || '').toLowerCase().includes(filterStatus)) return false;
    if (filterFuel && v.fuel !== filterFuel) return false;
    if (filterOrg && (v.org || '') !== filterOrg) return false;
    return true;
  });
  const entries = filtered.map(v => ({ v, km: recsFor(v.id).reduce((sum, r) => sum + (Number(r.km) || 0), 0) }));
  let gridHtml;
  if (!filtered.length) {
    gridHtml = fleetEmptyHtml(vehicles.length > 0, 'первое транспортное средство', 'vehicles');
  } else if (fleetViewModes.vehicles === 'cards') {
    gridHtml = `<div class="vehicle-cards-grid">${entries.map(({v, km}) => `
      <button type="button" class="vehicle-card fleet-card" onclick="selectVehicle(${htmlJs(v.id)})" aria-label="${htmlEsc('Открыть ' + (v.plate || v.make || 'ТС'))}">
        <span class="fleet-card-heading"><span class="vc-plate">${htmlEsc(v.plate || 'Без номера')}</span>${fleetStatusBadge(v.status)}</span>
        <span class="vc-make">${htmlEsc([v.make, v.model].filter(Boolean).join(' ') || 'Марка не указана')}</span>
        <span class="fleet-card-label">Водитель</span><span>${htmlEsc(v.driver || 'Не назначен')}</span>
        <span class="fleet-card-label">Организация · объект</span><span>${htmlEsc([v.org, v.object].filter(Boolean).join(' · ') || 'Не указаны')}</span>
        <span class="fleet-card-metrics"><span class="workspace-badge is-neutral">${htmlEsc(vehicleFuelGrade(v) || 'Топливо не указано')}</span><span class="fleet-number">${km.toLocaleString('ru')} км</span></span>
      </button>`).join('')}</div>`;
  } else {
    gridHtml = `<div class="workspace-table-wrap"><table class="workspace-table fleet-table">
      <thead><tr><th scope="col">Транспортное средство</th><th scope="col">Водитель</th><th scope="col">Организация / объект</th><th scope="col">Статус</th><th scope="col">Топливо</th><th scope="col">Пробег по журналу</th><th scope="col"><span class="sr-only">Действия</span></th></tr></thead>
      <tbody>${entries.map(({v, km}) => `<tr>
        <td><span class="fleet-table-primary">${htmlEsc(v.plate || 'Без номера')}</span><span class="fleet-table-secondary">${htmlEsc([v.make, v.model].filter(Boolean).join(' ') || 'Марка не указана')}</span></td>
        <td>${htmlEsc(v.driver || 'Не назначен')}</td>
        <td><span>${htmlEsc(v.org || '—')}</span><span class="fleet-table-secondary">${htmlEsc(v.object || 'Объект не указан')}</span></td>
        <td>${fleetStatusBadge(v.status)}</td><td><span class="workspace-badge is-neutral">${htmlEsc(vehicleFuelGrade(v) || '—')}</span></td>
        <td class="fleet-number">${km.toLocaleString('ru')} <span class="fleet-card-label">км</span></td>
        <td><button type="button" class="btn btn-ghost btn-sm" onclick="selectVehicle(${htmlJs(v.id)})" aria-label="${htmlEsc('Открыть ' + (v.plate || v.make || 'ТС'))}">Открыть ${workspaceIcon('arrow-right')}</button></td>
      </tr>`).join('')}</tbody></table></div>`;
  }
  const countHtml = `Показано ${filtered.length} из ${vehicles.length} ТС`;
  const existing = document.getElementById('vcGridArea');
  if (existing) {
    existing.innerHTML = gridHtml;
    document.getElementById('vcCountArea').textContent = countHtml;
    return;
  }
  document.getElementById('mainContent').innerHTML = `<div class="fleet-page">
    <div class="workspace-page-intro"><div><span class="workspace-eyebrow">Управление парком</span><h1 class="workspace-page-title">Транспорт</h1><p class="workspace-page-subtitle">Автомобили, водители и состояние автопарка</p></div>
      <div class="workspace-page-actions">${workspaceFleetTools('vehicles')}<button type="button" class="btn btn-ghost" onclick="openShiftEntry()">${workspaceIcon('table')} Ввод смены</button><button type="button" class="btn btn-ghost" onclick="openActGsmModal()">${workspaceIcon('file')} Акт ГСМ</button><button type="button" class="btn btn-primary" onclick="openAddVehicle()">${workspaceIcon('plus')} Добавить ТС</button></div></div>
    <div class="fleet-summary"><div><span>Всего в парке</span><strong>${vehicles.length}<small> ТС</small></strong></div><div><span>На ходу</span><strong>${vehicles.filter(v => v.status === 'На ходу').length}<small> ТС</small></strong></div><div><span>В ремонте / после ДТП</span><strong>${vehicles.filter(v => ['В ремонте', 'После ДТП'].includes(v.status)).length}<small> ТС</small></strong></div></div>
    <section class="workspace-panel" aria-label="Список транспорта"><div class="fleet-list-toolbar">
      <label class="fleet-search">${workspaceIcon('search')}<input type="search" id="vcSearchInput" aria-label="Поиск транспорта" placeholder="Номер, марка, водитель или объект" value="${htmlEsc(vcSearchQuery)}" oninput="vcSearchQuery=this.value;renderVehicleCards()"></label>
      ${fleetViewSwitch('vehicles')}
    </div>${fleetFiltersHtml()}<div id="vcGridArea">${gridHtml}</div><div id="vcCountArea" class="fleet-count" role="status">${countHtml}</div></section>
  </div>`;
}

function renderGeneratorCards() {
  const q = genSearchQuery.toLowerCase().trim();
  const gens = data.generators || [];
  const filtered = gens.filter(g => {
    const text = [g.name, g.serial, g.location, g.status, g.note].map(value => String(value || '').toLowerCase()).join(' ');
    return !q || q.split(/\s+/).every(word => text.includes(word));
  });
  const entries = filtered.map(g => {
    const records = genRecsFor(g.id);
    const hours = records.reduce((sum, r) => sum + (Number(r.hours) || 0), 0);
    let balance;
    if (g.tankId) balance = computeTankBalance(g.tankId).balance;
    else {
      const balances = computeGenFuelBalances(g.id);
      const last = records.slice().sort((a, b) => cmpDateAsc(a.date, b.date)).pop();
      balance = last ? balances[last.id] ?? g.fuelBalance ?? 0 : g.fuelBalance || 0;
    }
    return { g, hours, balance: Number(balance) || 0 };
  });
  const formatNumber = value => value.toLocaleString('ru', { maximumFractionDigits: 1 });
  const balanceBadge = balance => `<span class="workspace-badge ${balance < 0 ? 'is-danger' : balance < 50 ? 'is-warning' : 'is-success'} fleet-number">${formatNumber(balance)} л</span>`;
  let gridHtml;
  if (!filtered.length) gridHtml = fleetEmptyHtml(gens.length > 0, 'первую ДЭС', 'generators');
  else if (fleetViewModes.generators === 'cards') {
    gridHtml = `<div class="vehicle-cards-grid">${entries.map(({g, hours, balance}) => `
      <button type="button" class="vehicle-card fleet-card" onclick="openGeneratorDetail(${htmlJs(g.id)})" aria-label="${htmlEsc('Открыть ' + (g.name || 'ДЭС'))}">
        <span class="fleet-card-heading"><span class="vc-plate">${htmlEsc(g.name || 'Без названия')}</span>${fleetStatusBadge(g.status)}</span>
        <span class="vc-make">${htmlEsc(g.location || 'Место не указано')}</span><span class="fleet-card-label">Серийный номер</span><span>${htmlEsc(g.serial || 'Не указан')}</span>
        <span class="fleet-card-label">Мощность</span><span>${g.power != null ? htmlEsc(g.power) + ' кВт' : 'Не указана'}</span>
        <span class="fleet-card-metrics"><span class="fleet-number">${formatNumber(hours)} мтч</span>${balanceBadge(balance)}</span>
      </button>`).join('')}</div>`;
  } else {
    gridHtml = `<div class="workspace-table-wrap"><table class="workspace-table fleet-table">
      <thead><tr><th scope="col">Дизельная электростанция</th><th scope="col">Серийный номер</th><th scope="col">Местонахождение</th><th scope="col">Статус</th><th scope="col">Наработка по журналу</th><th scope="col">Остаток топлива</th><th scope="col"><span class="sr-only">Действия</span></th></tr></thead>
      <tbody>${entries.map(({g, hours, balance}) => `<tr>
        <td><span class="fleet-table-primary">${htmlEsc(g.name || 'Без названия')}</span><span class="fleet-table-secondary">${g.power != null ? htmlEsc(g.power) + ' кВт' : 'Мощность не указана'}</span></td>
        <td>${htmlEsc(g.serial || '—')}</td><td>${htmlEsc(g.location || 'Не указано')}</td><td>${fleetStatusBadge(g.status)}</td>
        <td class="fleet-number">${formatNumber(hours)} <span class="fleet-card-label">мтч</span></td><td>${balanceBadge(balance)}</td>
        <td><button type="button" class="btn btn-ghost btn-sm" onclick="openGeneratorDetail(${htmlJs(g.id)})" aria-label="${htmlEsc('Открыть ' + (g.name || 'ДЭС'))}">Открыть ${workspaceIcon('arrow-right')}</button></td>
      </tr>`).join('')}</tbody></table></div>`;
  }
  const countHtml = `Показано ${filtered.length} из ${gens.length} ДЭС`;
  const existing = document.getElementById('genGridArea');
  if (existing) {
    existing.innerHTML = gridHtml;
    document.getElementById('genCountArea').textContent = countHtml;
    return;
  }
  document.getElementById('mainContent').innerHTML = `<div class="fleet-page">
    <div class="workspace-page-intro"><div><span class="workspace-eyebrow">Энергетическое оборудование</span><h1 class="workspace-page-title">Дизельные электростанции</h1><p class="workspace-page-subtitle">Состояние, наработка и топливо на каждом объекте</p></div>
      <div class="workspace-page-actions">${workspaceFleetTools('generators')}<button type="button" class="btn btn-ghost" onclick="openGenActModal()">${workspaceIcon('file')} Акт ГСМ</button><button type="button" class="btn btn-primary" onclick="openAddGenerator()">${workspaceIcon('plus')} Добавить ДЭС</button></div></div>
    <div class="fleet-summary"><div><span>Всего электростанций</span><strong>${gens.length}<small> ДЭС</small></strong></div><div><span>В работе</span><strong>${gens.filter(g => g.status === 'В работе').length}<small> ДЭС</small></strong></div><div><span>В резерве</span><strong>${gens.filter(g => g.status === 'Резерв').length}<small> ДЭС</small></strong></div></div>
    <section class="workspace-panel" aria-label="Список ДЭС"><div class="fleet-list-toolbar">
      <label class="fleet-search">${workspaceIcon('search')}<input type="search" id="genSearchInput" aria-label="Поиск ДЭС" placeholder="Название, серийный номер или объект" value="${htmlEsc(genSearchQuery)}" oninput="genSearchQuery=this.value;renderGeneratorCards()"></label>
      ${fleetViewSwitch('generators')}
    </div><div id="genGridArea">${gridHtml}</div><div id="genCountArea" class="fleet-count" role="status">${countHtml}</div></section>
  </div>`;
}

function openGeneratorDetail(id) {
  document.querySelector('.sidebar').style.display = '';
  document.getElementById('sidebarSummary').style.display = '';
  document.getElementById('sidebarGeneratorHeader').style.display = '';
  document.getElementById('generatorList').style.display = '';
  document.getElementById('genSearchWrap').style.display = '';
  document.getElementById('btnAddGen').style.display = '';
  genSubView = 'generators';
  const _stg = document.getElementById('subTabGens'), _stt = document.getElementById('subTabTanks');
  if (_stg && _stt) { _stg.classList.add('active'); _stt.classList.remove('active'); }
  document.getElementById('tankSearchWrap').style.display = 'none';
  document.getElementById('tankList').style.display = 'none';
  document.getElementById('btnAddTank').style.display = 'none';
  renderGeneratorList();
  selectGenerator(id);
}

// ─── GENERATOR LIST ──────────────────────────────────────
function renderGeneratorList() {
  const q    = (document.getElementById('searchGenInput')?.value || '').toLowerCase().trim();
  const list = document.getElementById('generatorList');
  const gens = data.generators || [];

  const filtered = gens.filter(g => {
    if (!q) return true;
    return [g.name, g.serial, g.location, g.status, g.note]
      .some(f => (f || '').toLowerCase().includes(q));
  });

  if (!filtered.length) {
    list.innerHTML = `<div class="empty-list">
      <svg width="40" height="40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" style="display:block;margin:0 auto 8px">
        <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-4 0v2"/><path d="M12 12v4m-2-2h4"/>
      </svg>
      ${gens.length ? 'Ничего не найдено' : 'Нет дизельных генераторов.<br>Нажмите «Добавить ДЭС»'}
    </div>`;
    renderGenSidebarSummary();
    return;
  }

  const fuelLabels  = { diesel: 'Дизель', gasoline: 'Бензин', gas: 'Газ' };
  const fuelClasses = { diesel: 'diesel', gasoline: 'gasoline', gas: 'gas' };

  // Сортируем по местонахождению (без местонахождения — в конец)
  const sortedFiltered = filtered.slice().sort((a, b) => {
    const la = (a.location || '').toLowerCase();
    const lb = (b.location || '').toLowerCase();
    if (!la && lb) return 1;
    if (la && !lb) return -1;
    return la < lb ? -1 : la > lb ? 1 : 0;
  });

  let html = '';
  let curLoc = null;

  sortedFiltered.forEach(g => {
    const locGroup = g.location || '— Без местонахождения —';
    if (locGroup !== curLoc) {
      curLoc = locGroup;
      html += `<div class="gen-loc-header">
        <svg width="10" height="10" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
        ${htmlEsc(locGroup)}
      </div>`;
    }
    const gRecs      = genRecsFor(g.id);
    const totalHours = gRecs.reduce((s, r) => s + (r.hours || 0), 0);
    let fuelBal;
    if (g.tankId) {
      fuelBal = computeTankBalance(g.tankId).balance;
    } else {
      const balMap  = computeGenFuelBalances(g.id);
      const sorted  = gRecs.slice().sort((a,b) => cmpDateAsc(a.date, b.date));
      const lastRec = sorted[sorted.length - 1];
      fuelBal = lastRec ? (balMap[lastRec.id] ?? (g.fuelBalance || 0)) : (g.fuelBalance || 0);
    }
    const balColor   = fuelBal < 0 ? 'var(--red)' : fuelBal < 50 ? 'var(--yellow)' : 'var(--green)';
    const stColor    = g.status === 'В работе' ? '#22c55e' : g.status === 'Резерв' ? '#3b82f6' : g.status ? '#ef4444' : null;
    const stDot      = stColor ? `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${stColor};flex-shrink:0"></span>` : '';
    const fb         = g.fuel ? { label: fuelLabels[g.fuel], cls: fuelClasses[g.fuel] } : null;
    html += `<div class="gen-card ${selectedGeneratorId === g.id ? 'active' : ''}" onclick="selectGenerator(${htmlJs(g.id)})">
      <div class="gen-card-top">
        <div style="flex:1;min-width:0">
          <div class="gen-card-name">${stDot} ${htmlEsc(g.name)}</div>
          <div class="gen-card-sub">${g.serial ? 'С/н: '+ htmlEsc(g.serial) : ''}${g.responsible ? (g.serial?' · ':'')+'Отв.: '+ htmlEsc(g.responsible) : ''}</div>
        </div>
        ${g.power != null ? `<div class="gen-card-power">${htmlEsc(g.power)} кВт</div>` : ''}
      </div>
      <div class="gen-card-badges">
        <div class="gen-badge">${totalHours.toLocaleString('ru',{maximumFractionDigits:1})} мтч</div>
        <div class="gen-badge" style="color:${balColor};border-color:${balColor}4d;background:${balColor}1a">${fuelBal.toLocaleString('ru',{maximumFractionDigits:1})} л</div>
        ${g.status ? `<div class="gen-badge" style="color:${stColor};border-color:${stColor}4d;background:${stColor}1a">${htmlEsc(g.status)}</div>` : ''}
        ${fb ? `<span class="fuel-tag ${fb.cls}" style="font-size:10px;padding:1px 6px">${fb.label}</span>` : ''}
      </div>
    </div>`;
  });

  list.innerHTML = html;
  renderGenSidebarSummary();
}

// ─── SELECT GENERATOR ────────────────────────────────────
function selectGenerator(id) {
  selectedGeneratorId = id;
  const g = (data.generators || []).find(x => x.id === id);
  if (!g) return;
  const months = getMonthsForGenerator(id);
  if (months.length) {
    selectedGenYear  = months[months.length - 1].year;
    selectedGenMonth = months[months.length - 1].month;
  } else {
    const now = new Date();
    selectedGenYear  = now.getFullYear();
    selectedGenMonth = now.getMonth() + 1;
  }
  renderGeneratorList();
  renderGenDetail(g);
}

function getMonthsForGenerator(id) {
  const map = {};
  genRecsFor(id).forEach(r => {
    const d   = new Date(r.date);
    const key = `${d.getFullYear()}-${d.getMonth()+1}`;
    map[key]  = { year: d.getFullYear(), month: d.getMonth()+1, key };
  });
  return Object.values(map).sort((a,b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
}

function selectGenMonth(year, month) {
  selectedGenYear  = year;
  selectedGenMonth = month;
  const g = (data.generators || []).find(x => x.id === selectedGeneratorId);
  if (g) renderGenDetail(g);
}

