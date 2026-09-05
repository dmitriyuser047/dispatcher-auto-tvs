// Список ТС и подробная карточка ТС
// Выделено из index.html

// ─── VEHICLE LIST ────────────────────────────────────────
function renderVehicleList() {
  if (activeSection === 'vehicles' && !selectedVehicleId && typeof renderVehicleCards === 'function') {
    renderVehicleCards();
  }
  const searchEl = document.getElementById('searchInput');
  if (!searchEl) return;
  const q = searchEl.value.toLowerCase().trim();
  const list = document.getElementById('vehicleList');
  updateFilterBadge();

  const filtered = data.vehicles.filter(v => {
    // Расширенный текстовый поиск
    if (q) {
      const fields = [
        v.plate, v.make, v.driver,
        v.org, v.object, v.responsible, v.fuelcard, v.status, v.note
      ].map(f => (f || '').toLowerCase());
      if (!fields.some(f => f.includes(q))) return false;
    }
    // Фильтр по статусу (частичное совпадение, нечувствительно к регистру)
    if (filterStatus && !(v.status || '').toLowerCase().includes(filterStatus)) return false;
    // Фильтр по топливу
    if (filterFuel && v.fuel !== filterFuel) return false;
    // Фильтр по организации
    if (filterOrg && (v.org || '') !== filterOrg) return false;
    return true;
  });
  renderSidebarSummary();
  if (!filtered.length) {
    list.innerHTML = `<div class="empty-list">
      <svg width="40" height="40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" style="display:block;margin:0 auto 8px">
        <path d="M1 17l2-6h18l2 6M5 11l1-4h12l1 4"/>
      </svg>
      ${data.vehicles.length ? 'Ничего не найдено' : 'Нет транспортных средств.<br>Нажмите «Добавить ТС»'}
    </div>`;
    return;
  }
  list.innerHTML = filtered.map(v => {
    const statusColor = !v.status ? null
      : v.status === 'На ходу' ? 'var(--green)'
      : v.status === 'В резерве' ? 'var(--accent)'
      : v.status === 'В ремонте' || v.status === 'После ДТП' ? 'var(--red)'
      : 'var(--yellow)';
    return `<div class="vehicle-row ${selectedVehicleId === v.id ? 'active' : ''}" onclick="selectVehicle('${v.id}')">
      ${statusColor ? `<span class="vr-dot" style="background:${statusColor}"></span>` : '<span class="vr-dot" style="background:var(--text3);opacity:.3"></span>'}
      <span class="vr-plate">${v.plate}</span>
      <span class="vr-info">
        <span class="vr-make">${v.make}</span>
        <span class="vr-driver">${v.driver || ''}</span>
      </span>
    </div>`;
  }).join('');
}

// ─── SELECT VEHICLE ──────────────────────────────────────
function selectVehicle(id) {
  selectedVehicleId = id;
  vehicleDetailView = 'cards';
  const v = data.vehicles.find(x => x.id === id);
  if (!v) return;

  // pick default month
  const recs = recsFor(id);
  const months = getMonthsForVehicle(id);
  if (months.length) {
    selectedYear = months[months.length - 1].year;
    selectedMonth = months[months.length - 1].month;
  } else {
    const now = new Date();
    selectedYear = now.getFullYear();
    selectedMonth = now.getMonth() + 1;
  }

  const backBtn = document.getElementById('hdrBackBtn');
  backBtn.style.display = 'flex';
  backBtn.onclick = () => { selectedVehicleId = null; switchSection('vehicles'); };
  document.getElementById('hdrSectionTitle').textContent = v.plate + ' — ' + (v.make || '');

  renderDetail(v);
}

function openVehicleJournal(view) {
  vehicleDetailView = view;
  const backBtn = document.getElementById('hdrBackBtn');
  const v = data.vehicles.find(x => x.id === selectedVehicleId);
  const titles = { journal: 'Журнал пробега', to: 'График ТО', repairs: 'Журнал ремонта' };
  document.getElementById('hdrSectionTitle').textContent = (v ? v.plate + ' — ' : '') + (titles[view] || '');
  backBtn.style.display = 'flex';
  backBtn.onclick = () => {
    vehicleDetailView = 'cards';
    if (v) {
      document.getElementById('hdrSectionTitle').textContent = v.plate + ' — ' + (v.make || '');
      backBtn.onclick = () => { selectedVehicleId = null; switchSection('vehicles'); };
      renderDetail(v);
    }
  };
  if (v) renderDetail(v);
}

function getMonthsForVehicle(id) {
  const recs = recsFor(id);
  const map = {};
  recs.forEach(r => {
    const d = new Date(r.date);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    map[key] = { year: d.getFullYear(), month: d.getMonth() + 1, key };
  });
  return Object.values(map).sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
}

const MONTHS_RU = ['Январь','Февраль','Март','Апрель','Май','Июнь',
  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const MONTHS_SHORT = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
const DAYS_RU = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];

function renderDetail(v) {
  const recs = recsFor(v.id);
  const totalKm = recs.reduce((s, r) => s + (r.km || 0), 0);
  const totalFuel = recs.reduce((s, r) => s + (r.fuelActual || 0), 0);
  const totalFuelIssued = recs.reduce((s, r) => s + (r.fuelIssued || 0), 0);
  const avgConsumption = totalKm > 0 && totalFuel > 0 ? (totalFuel / totalKm * 100) : 0;

  const fuelLabels = { diesel: 'Дизельное', gasoline: 'Бензин', gas: 'Газ (ГБО)' };
  const fuelClasses = { diesel: 'diesel', gasoline: 'gasoline', gas: 'gas' };

  const months = getMonthsForVehicle(v.id);
  // ensure current selected is valid
  const curKey = `${selectedYear}-${selectedMonth}`;

  // monthly records
  const monthRecs = recs.filter(r => {
    const d = new Date(r.date);
    return d.getFullYear() === selectedYear && (d.getMonth() + 1) === selectedMonth;
  }).sort((a, b) => cmpDateAsc(a.date, b.date));

  const monthKm = monthRecs.reduce((s, r) => s + (r.km || 0), 0);
  const monthFuel = monthRecs.reduce((s, r) => s + (r.fuelActual || 0), 0);

  // build month tabs grouped by year
  let monthTabsHtml = '';
  if (months.length === 0) {
    monthTabsHtml = '<span style="color:var(--text3);font-size:12px">Нет данных</span>';
  } else {
    const years = [...new Set(months.map(m => m.year))];
    years.forEach(yr => {
      monthTabsHtml += `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span class="year-label">${yr}</span>`;
      months.filter(m => m.year === yr).forEach(m => {
        const active = m.year === selectedYear && m.month === selectedMonth;
        monthTabsHtml += `<div class="month-tab ${active ? 'active' : ''}" onclick="selectMonth(${m.year},${m.month})">${MONTHS_SHORT[m.month - 1]}</div>`;
      });
      monthTabsHtml += `</div>`;
    });
  }

  // add current month button if not in list
  const now = new Date();
  const nowY = now.getFullYear(), nowM = now.getMonth() + 1;
  const hasNow = months.some(m => m.year === nowY && m.month === nowM);
  if (!hasNow) {
    monthTabsHtml += `<div class="month-tab ${selectedYear === nowY && selectedMonth === nowM ? 'active' : ''}" onclick="selectMonth(${nowY},${nowM})" style="border-style:dashed">${MONTHS_SHORT[nowM-1]} ${nowY}</div>`;
  }

  // fuel balance running total (all vehicle records sorted by date)
  const balMap = computeFuelBalances(v.id);

  // current fuel balance = balance after last record (or initial if no records)
  const allRecsSorted = recs.slice().sort((a, b) => cmpDateAsc(a.date, b.date));
  const lastRec = allRecsSorted[allRecsSorted.length - 1];
  const currentFuelBalance = lastRec != null
    ? (balMap[lastRec.id] ?? (v.fuelBalance || 0))
    : (v.fuelBalance || 0);

  // rows
  let tableRows = '';
  if (monthRecs.length === 0) {
    tableRows = `<tr><td colspan="12" class="empty-table">Нет записей за этот месяц. Нажмите «+ Запись» чтобы добавить.</td></tr>`;
  } else {
    monthRecs.forEach(r => {
      const d = new Date(r.date);
      const dayName = DAYS_RU[d.getDay()];
      const dayNum = d.getDate().toString().padStart(2, '0');
      const fullDate = fmtDate(r.date);
      const normL100   = v.norm ? v.norm : null;
      const factL100   = r.fuelActual && r.km > 0 ? r.fuelActual / r.km * 100 : null;
      const factDev    = factL100 !== null && normL100 !== null ? factL100 - normL100 : null;
      const factDevHtml = factDev !== null
        ? ` <span style="font-size:11px;color:${factDev > 0 ? 'var(--red)' : 'var(--green)'};font-weight:600">${factDev > 0 ? '+' : ''}${factDev.toFixed(1)}</span>`
        : '';
      const balance = balMap[r.id];
      const balColor = balance < 0 ? 'var(--red)' : balance === 0 ? 'var(--text3)' : 'var(--green)';
      tableRows += `<tr>
        <td class="td-day">${fullDate} <span style="color:var(--text3)">${dayName}</span></td>
        <td class="td-num">${r.km ? r.km.toLocaleString('ru', {maximumFractionDigits:1}) : '—'}</td>
        <td class="td-num">${r.odoStart ? r.odoStart.toLocaleString('ru') : '—'} → ${r.odoEnd ? r.odoEnd.toLocaleString('ru') : '—'}</td>
        <td class="td-num">${r.fuelIssued ? r.fuelIssued.toLocaleString('ru', {maximumFractionDigits:1}) : '—'}</td>
        <td class="td-num">${r.fuelUsed ? r.fuelUsed.toLocaleString('ru', {maximumFractionDigits:1}) : '—'}</td>
        <td class="td-num">${r.fuelActual != null ? r.fuelActual.toLocaleString('ru', {minimumFractionDigits:2, maximumFractionDigits:2}) : '—'}</td>
        <td class="td-num">${r.fuelIdle != null ? r.fuelIdle.toLocaleString('ru', {minimumFractionDigits:2, maximumFractionDigits:2}) : '—'}</td>
        <td class="td-num" style="color:${balColor};font-weight:600">${balance != null ? balance.toLocaleString('ru', {minimumFractionDigits:2, maximumFractionDigits:2}) : '—'}</td>
        <td class="td-num">${normL100 !== null ? normL100.toFixed(1) : '—'}</td>
        <td class="td-num">${factL100 !== null ? factL100.toFixed(1) + factDevHtml : '—'}</td>
        <td style="padding:10px 14px;font-size:13px;color:var(--text2)">${r.driver || '—'}</td>
        <td class="td-actions">
          <button class="icon-btn" title="Редактировать" onclick="openEditRecord('${r.id}')">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="icon-btn del" title="Удалить" onclick="deleteRecord('${r.id}')">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
          </button>
        </td>
      </tr>`;
    });
  }

  const vehicleHeaderHtml = `
    <!-- Vehicle header -->
    <div class="vehicle-detail-header">
      <div class="vdh-left">
        <div class="vdh-plate">${v.plate}</div>
        <div class="vdh-make">${v.make}</div>
        <div class="vdh-meta">
          <div class="vdh-meta-item">
            <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M6 20v-2a6 6 0 0112 0v2"/></svg>
            ${v.driver}
          </div>
          ${v.org ? `<div class="vdh-meta-item">
            <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></svg>
            ${v.org}
          </div>` : ''}
          ${v.object ? `<div class="vdh-meta-item">
            <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
            ${v.object}
          </div>` : ''}
          ${v.fuel ? `<div class="vdh-meta-item">
            <span class="fuel-tag ${fuelClasses[v.fuel]}">${fuelLabels[v.fuel]}</span>
          </div>` : ''}
          ${v.norm ? `<div class="vdh-meta-item" style="color:var(--text3);font-size:12px">Норма: ${v.norm} л/100км</div>` : ''}
          ${v.odometer != null ? `<div class="vdh-meta-item" style="color:var(--text3);font-size:12px">
            <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l2 2"/></svg>
            Нач. пробег: ${v.odometer.toLocaleString('ru')} км
          </div>` : ''}
          ${v.responsible ? `<div class="vdh-meta-item">
            <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
            Отв.: ${v.responsible}
          </div>` : ''}
          ${v.fuelcard ? `<div class="vdh-meta-item">
            <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
            <span style="font-family:'Courier New',monospace;letter-spacing:0.5px">№ карты: ${v.fuelcard}</span>
          </div>` : ''}
          ${v.status ? `<div class="vdh-meta-item">
            <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span style="color:${v.status === 'На ходу' ? 'var(--green)' : v.status === 'В ремонте' ? 'var(--red)' : v.status === 'После ДТП' ? 'var(--red)' : 'var(--yellow)'}">${v.status}</span>
          </div>` : ''}
        </div>
        ${v.justification ? `<div style="margin-top:8px;font-size:12px;color:var(--text2);background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:8px 12px;max-width:600px"><span style="color:var(--text3);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Обоснование: </span>${v.justification}</div>` : ''}
      </div>
      <div class="vdh-actions">
        <button class="btn btn-ghost btn-sm" onclick="openEditVehicle('${v.id}')">
          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Изменить
        </button>
        <button class="btn btn-danger btn-sm" onclick="deleteVehicle('${v.id}')">
          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
          Удалить
        </button>
      </div>
    </div>`;

  const statsHtml = `
    <!-- Stats -->
    <div class="stats-row">
      <div class="stat-card accent-blue">
        <div class="stat-label">Общий пробег</div>
        <div class="stat-value">${Math.round(totalKm).toLocaleString('ru')} <span class="stat-unit">км</span></div>
        <div class="stat-sub">За всё время</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Пробег за месяц</div>
        <div class="stat-value">${Math.round(monthKm).toLocaleString('ru')} <span class="stat-unit">км</span></div>
        <div class="stat-sub">${MONTHS_RU[selectedMonth-1]} ${selectedYear}</div>
      </div>
      <div class="stat-card accent-yellow">
        <div class="stat-label">Расход топлива</div>
        <div class="stat-value">${totalFuel.toLocaleString('ru', {maximumFractionDigits:1})} <span class="stat-unit">л</span></div>
        <div class="stat-sub">Фактический, всего</div>
      </div>
      <div class="stat-card accent-green">
        <div class="stat-label">Ср. расход</div>
        <div class="stat-value">${avgConsumption > 0 ? avgConsumption.toFixed(1) : '—'} <span class="stat-unit">л/100км</span></div>
        <div class="stat-sub">${v.norm ? 'Норма: ' + v.norm + ' л/100км' : 'Норма не задана'}</div>
      </div>
      <div class="stat-card ${currentFuelBalance < 0 ? 'accent-red' : currentFuelBalance < 20 ? 'accent-yellow' : 'accent-green'}">
        <div class="stat-label">Остаток топлива</div>
        <div class="stat-value" style="color:${currentFuelBalance < 0 ? 'var(--red)' : currentFuelBalance < 20 ? 'var(--yellow)' : 'inherit'}">${currentFuelBalance.toLocaleString('ru', {maximumFractionDigits:1})} <span class="stat-unit">л</span></div>
        <div class="stat-sub">${lastRec ? 'После последней записи' : 'Начальный остаток'}</div>
      </div>
    </div>`;

  if (vehicleDetailView === 'cards') {
    // --- Journal cards view ---
    const toRecs = vehicleToFor(v.id);
    const repairRecs = repairsFor(v.id);
    const repairTotal = repairRecs.reduce((s, r) => s + (r.cost || 0), 0);
    const repairUnpaid = repairRecs.filter(r => !r.paid).reduce((s, r) => s + (r.cost || 0), 0);
    const currentOdo = (v.odometer || 0) + totalKm;

    // TO status
    const lastTo = toRecs.slice().sort((a, b) => cmpDateAsc(a.date, b.date)).pop();
    let toBadge = '';
    if (lastTo) {
      if (lastTo.nextOdometerAbs != null) {
        const diff = lastTo.nextOdometerAbs - currentOdo;
        if (diff <= 0) toBadge = `<span class="vd-journal-card-badge" style="background:#fee2e2;color:#dc2626">Просрочено на ${Math.abs(diff).toLocaleString('ru',{maximumFractionDigits:0})} км</span>`;
        else if (diff <= 1000) toBadge = `<span class="vd-journal-card-badge" style="background:#fef3c7;color:#d97706">До ТО: ${diff.toLocaleString('ru',{maximumFractionDigits:0})} км</span>`;
        else toBadge = `<span class="vd-journal-card-badge" style="background:#dcfce7;color:#16a34a">До ТО: ${diff.toLocaleString('ru',{maximumFractionDigits:0})} км</span>`;
      }
      if (lastTo.nextDate) {
        const nd = new Date(lastTo.nextDate);
        const today = new Date(); today.setHours(0,0,0,0);
        const daysLeft = Math.ceil((nd - today) / 86400000);
        if (daysLeft <= 0) toBadge += ` <span class="vd-journal-card-badge" style="background:#fee2e2;color:#dc2626">Дата просрочена</span>`;
        else if (daysLeft <= 14) toBadge += ` <span class="vd-journal-card-badge" style="background:#fef3c7;color:#d97706">Через ${daysLeft} дн.</span>`;
      }
    }
    if (!toBadge && !toRecs.length) toBadge = `<span class="vd-journal-card-badge" style="background:var(--bg3);color:var(--text3)">Нет записей</span>`;

    document.getElementById('mainContent').innerHTML = vehicleHeaderHtml + statsHtml + `
      <div class="vd-journals-grid">
        <!-- Журнал пробега -->
        <div class="vd-journal-card" onclick="openVehicleJournal('journal')">
          <div class="vd-journal-card-header">
            <div class="vd-journal-card-icon" style="background:#dbeafe">
              <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="#2563eb" stroke-width="2">
                <path d="M12 20V10M6 20V4M18 20v-4"/>
              </svg>
            </div>
            <div>
              <div class="vd-journal-card-title">Журнал пробега</div>
            </div>
          </div>
          <div class="vd-journal-card-stats">
            <div class="stat-item"><span class="stat-num">${recs.length}</span> записей</div>
            <div class="stat-item"><span class="stat-num">${Math.round(totalKm).toLocaleString('ru')}</span> км</div>
            <div class="stat-item"><span class="stat-num">${totalFuel.toLocaleString('ru',{maximumFractionDigits:0})}</span> л</div>
          </div>
          <div class="vd-journal-card-actions" onclick="event.stopPropagation()">
            <button class="btn btn-ghost btn-sm" onclick="exportToXlsx()">
              <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Excel
            </button>
            <button class="btn btn-ghost btn-sm" onclick="openActGsmModal()">
              <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              Акт ГСМ
            </button>
          </div>
        </div>

        <!-- График ТО -->
        <div class="vd-journal-card" onclick="openVehicleJournal('to')">
          <div class="vd-journal-card-header">
            <div class="vd-journal-card-icon" style="background:#ede9fe">
              <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="#7c3aed" stroke-width="2">
                <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>
              </svg>
            </div>
            <div>
              <div class="vd-journal-card-title">График ТО</div>
            </div>
          </div>
          <div class="vd-journal-card-stats">
            <div class="stat-item"><span class="stat-num">${toRecs.length}</span> записей</div>
            <div class="stat-item">Пробег: <span class="stat-num">${currentOdo.toLocaleString('ru',{maximumFractionDigits:0})}</span> км</div>
          </div>
          <div>${toBadge}</div>
        </div>

        <!-- Журнал ремонтов -->
        <div class="vd-journal-card" onclick="openVehicleJournal('repairs')">
          <div class="vd-journal-card-header">
            <div class="vd-journal-card-icon" style="background:#fee2e2">
              <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="#dc2626" stroke-width="2">
                <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>
              </svg>
            </div>
            <div>
              <div class="vd-journal-card-title">Журнал ремонта</div>
            </div>
          </div>
          <div class="vd-journal-card-stats">
            <div class="stat-item"><span class="stat-num">${repairRecs.length}</span> записей</div>
            <div class="stat-item"><span class="stat-num">${repairTotal.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})}</span> ₽</div>
            ${repairUnpaid > 0 ? `<div class="stat-item" style="color:var(--red)"><span class="stat-num" style="color:var(--red)">${repairUnpaid.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})}</span> ₽ не опл.</div>` : ''}
          </div>
        </div>
      </div>
    `;
  } else if (vehicleDetailView === 'journal') {
    // --- Full journal view ---
    document.getElementById('mainContent').innerHTML = vehicleHeaderHtml + statsHtml + `
    <div>
      <div class="section-header">
        <div class="section-title">История по месяцам</div>
        <button class="btn btn-ghost btn-sm" onclick="exportToXlsx()">
          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Выгрузить в Excel
        </button>
      </div>
      <div class="month-tabs" id="monthTabs">${monthTabsHtml}</div>
    </div>
    <div class="table-wrap${historyFullscreen ? ' fullscreen' : ''}" id="historyTableWrap">
      <div class="table-toolbar">
        <div class="table-toolbar-left">
          ${MONTHS_RU[selectedMonth-1]} ${selectedYear}
          <span style="color:var(--text3);font-weight:400;font-size:12px;margin-left:10px">${monthRecs.length} записей · ${Math.round(monthKm).toLocaleString('ru')} км · ${monthFuel.toLocaleString('ru',{maximumFractionDigits:1})} л</span>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <button class="btn btn-ghost btn-sm" onclick="toggleHistoryFullscreen()" id="historyFsBtn" title="${historyFullscreen ? 'Свернуть' : 'Развернуть на весь экран'}">
            ${historyFullscreen
              ? `<svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3"/></svg> Свернуть`
              : `<svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/></svg> На весь экран`}
          </button>
          <button class="btn btn-primary btn-sm" onclick="openAddRecord()">
            <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            + Запись
          </button>
        </div>
      </div>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Дата</th>
              <th>Пробег, км</th>
              <th>Одометр</th>
              <th>Выдано, л</th>
              <th>По норме, л</th>
              <th>Факт. расход, л</th>
              <th>Расход ХХ, л</th>
              <th>Остаток, л</th>
              <th>Норма л/100</th>
              <th>Факт л/100</th>
              <th>Водитель</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    </div>
    `;
  } else if (vehicleDetailView === 'to') {
    document.getElementById('mainContent').innerHTML = vehicleHeaderHtml + statsHtml +
      renderVehicleToSection(v.id, (v.odometer || 0) + totalKm);
  } else if (vehicleDetailView === 'repairs') {
    document.getElementById('mainContent').innerHTML = vehicleHeaderHtml + statsHtml +
      renderRepairSection(v.id);
  }
}

function selectMonth(year, month) {
  selectedYear = year;
  selectedMonth = month;
  const v = data.vehicles.find(x => x.id === selectedVehicleId);
  if (v) renderDetail(v);
}

