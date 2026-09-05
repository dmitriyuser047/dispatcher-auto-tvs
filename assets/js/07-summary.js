// Сводка в боковой панели, состояние ТС по объектам, баланс топлива
// Выделено из index.html

// ─── SIDEBAR SUMMARY ────────────────────────────────────
function renderSidebarSummary() {
  const el = document.getElementById('sidebarSummary');
  if (!data.vehicles.length) { el.innerHTML = ''; return; }

  const fuelTypes = ['diesel', 'gasoline', 'gas'];
  const fuelLabels = { diesel: 'Дизельное', gasoline: 'Бензин', gas: 'Газ (ГБО)' };
  const fuelColors = { diesel: 'var(--yellow)', gasoline: 'var(--accent-light)', gas: 'var(--green)' };

  let totalKm = 0;
  let totalKmGlonass = 0;
  const issued  = { diesel: 0, gasoline: 0, gas: 0 };
  const used    = { diesel: 0, gasoline: 0, gas: 0 };
  const balance = { diesel: 0, gasoline: 0, gas: 0 };

  data.vehicles.forEach(v => {
    const ft = v.fuel || 'diesel';
    const vRecs = recsFor(v.id);
    vRecs.forEach(r => {
      totalKm        += r.km         || 0;
      totalKmGlonass += r.kmGlonass  || 0;
      issued[ft]     += r.fuelIssued || 0;
      used[ft]       += r.fuelUsed   || 0;
    });
    // end balance for this vehicle
    const bMap = computeFuelBalances(v.id);
    const sorted = vRecs.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
    if (sorted.length) {
      const last = sorted[sorted.length - 1];
      balance[ft] += bMap[last.id] || 0;
    } else {
      // Нет записей — остаток равен начальному значению из карточки ТС
      balance[ft] += v.fuelBalance || 0;
    }
  });

  const vehicleFuelTypes = new Set(data.vehicles.map(v => v.fuel || 'diesel'));
  const activeFuels = fuelTypes.filter(ft => vehicleFuelTypes.has(ft));

  let fuelHtml = '';
  activeFuels.forEach(ft => {
    const bal = balance[ft];
    const balColor = bal < 0 ? 'var(--red)' : bal === 0 ? 'var(--text3)' : 'var(--green)';
    fuelHtml += `
      <div class="ss-fuel-block">
        <div class="ss-fuel-title" style="color:${fuelColors[ft]}">${fuelLabels[ft]}</div>
        <div class="ss-row">
          <span class="ss-label">Выдано</span>
          <span class="ss-value">${issued[ft].toLocaleString('ru',{maximumFractionDigits:1})} л</span>
        </div>
        <div class="ss-row">
          <span class="ss-label">Израсходовано</span>
          <span class="ss-value">${used[ft].toLocaleString('ru',{maximumFractionDigits:1})} л</span>
        </div>
        <div class="ss-row">
          <span class="ss-label">Остаток</span>
          <span class="ss-value" style="color:${balColor}">${bal.toLocaleString('ru',{maximumFractionDigits:1})} л</span>
        </div>
      </div>`;
  });

  if (!fuelHtml) {
    fuelHtml = `<div style="color:var(--text3);font-size:12px">Нет данных о топливе</div>`;
  }

  const summaryOpen = el.dataset.open !== 'false';
  el.innerHTML = `
    <div class="sidebar-summary">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;cursor:pointer" onclick="toggleSidebarSummary()">
        <div class="ss-title" style="margin-bottom:0">Общая сводка</div>
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:12px;font-weight:600;color:var(--text2)">${data.vehicles.length} ТС</span>
          <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="color:var(--text3);transition:transform .2s;transform:rotate(${summaryOpen?'180':'0'}deg)"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
      </div>
      <div style="display:${summaryOpen?'block':'none'}">
      <div style="display:flex;gap:6px;margin:8px 0 10px">
          <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openActGsmModal()" style="font-size:11px;padding:4px 10px" title="Сформировать акт на списание ГСМ (бензин/дизель)">
            <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/>
            </svg>
            Акт ГСМ
          </button>
          <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openExportPeriodModal('xls')" style="font-size:11px;padding:4px 10px">
            <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            XLS
          </button>
          <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openExportPeriodModal('pdf')" style="font-size:11px;padding:4px 10px" title="Выгрузить общую сводку в PDF">
            <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            PDF
          </button>
        </div>
      <div class="ss-row">
        <span class="ss-label">Транспортных средств</span>
        <span class="ss-value">${data.vehicles.length}</span>
      </div>
      <div class="ss-row">
        <span class="ss-label">Общий пробег</span>
        <span class="ss-value">${Math.round(totalKm).toLocaleString('ru')} км</span>
      </div>
      ${totalKmGlonass > 0 ? `
      <div class="ss-row">
        <span class="ss-label">Пробег по Глонасс</span>
        <span class="ss-value">${Math.round(totalKmGlonass).toLocaleString('ru')} км</span>
      </div>` : ''}
      <div class="ss-divider"></div>
      ${fuelHtml}
      <div class="ss-divider"></div>
      ${renderObjStatusHtml()}
      ${window.electronAPI ? `
      <div class="ss-divider"></div>
      <div style="display:flex;align-items:center;gap:6px;margin-top:4px">
        <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="color:var(--text3);flex-shrink:0">
          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
        </svg>
        <span style="font-size:10px;color:var(--text2);flex:1" id="sidebarUserLabel">Пользователь</span>
      </div>
      <span style="font-size:10px;color:#3b82f6;font-weight:600;display:none" id="sidebarModeLabel"></span>
      <div style="display:flex;align-items:center;gap:6px;margin-top:4px">
        <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="color:var(--text3);flex-shrink:0">
          <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
        </svg>
        <span style="font-size:10px;color:var(--text3);flex:1" id="sidebarDataPath">Данные: ...</span>
        <button class="btn btn-ghost btn-sm" onclick="window.electronAPI.openDataFolder()" style="font-size:10px;padding:2px 7px;white-space:nowrap" title="Открыть папку с данными и бэкапами">Открыть</button>
      </div>
      <div style="display:flex;align-items:center;gap:6px;margin-top:4px">
        <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="color:var(--text3);flex-shrink:0">
          <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
        </svg>
        <span style="font-size:10px;color:var(--text3)" id="sidebarVersionLabel">Версия ...</span>
      </div>` : ''}
      </div>
    </div>`;
}
function toggleSidebarSummary() {
  const el = document.getElementById('sidebarSummary');
  el.dataset.open = el.dataset.open === 'false' ? 'true' : 'false';
  renderSidebarSummary();
}

// ─── СОСТОЯНИЕ ТС ПО ОБЪЕКТАМ (компактный блок в сводке) ─
function renderObjStatusHtml() {
  const rows = computeObjectStatusBreakdown();
  if (!rows.length) return '';
  let t = { run:0, repair:0, need:0, other:0, total:0 };
  const badge = (val, cls, title) => val > 0 ? `<span class="objst-badge ${cls}" title="${title}">${val}</span>` : '';
  const items = rows.map(([name, r]) => {
    t.run += r.run; t.repair += r.repair; t.need += r.need; t.other += r.other; t.total += r.total;
    return `<div class="objst-row" title="${name.replace(/"/g,'&quot;')}">
      <span class="objst-name">${name}</span>
      <span class="objst-badges">
        ${badge(r.run,'run','На ходу')}${badge(r.repair,'repair','В ремонте')}${badge(r.need,'need','Требуется ремонт')}${badge(r.other,'other','Без статуса')}
        <span class="objst-total">${r.total}</span>
      </span>
    </div>`;
  }).join('');
  return `
    <div class="ss-title" style="margin-bottom:6px">Состояние ТС по объектам</div>
    <div class="objst-list">${items}</div>
    <div class="objst-row objst-total-row">
      <span class="objst-name">Итого</span>
      <span class="objst-badges">
        ${badge(t.run,'run','На ходу')}${badge(t.repair,'repair','В ремонте')}${badge(t.need,'need','Требуется ремонт')}${badge(t.other,'other','Без статуса')}
        <span class="objst-total">${t.total}</span>
      </span>
    </div>`;
}

// ─── FUEL BALANCE ───────────────────────────────────────
function computeFuelBalances(vehicleId, dateFrom, dateTo) {
  // Кэшируем частый случай без диапазона дат (используется в списках)
  const cacheable = !dateFrom && !dateTo;
  if (cacheable && _fuelBalCache[vehicleId]) return _fuelBalCache[vehicleId];
  const vehicle = data.vehicles.find(v => v.id === vehicleId);
  const recs = recsFor(vehicleId)
    .filter(r => {
      if (dateFrom && r.date < dateFrom) return false;
      if (dateTo   && r.date > dateTo)   return false;
      return true;
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  let balance = (vehicle && !dateFrom) ? (vehicle.fuelBalance || 0) : 0;
  const balMap = {};
  recs.forEach(r => {
    // Остаток считается по фактическому расходу; если не введён — по норме
    const spent = r.fuelActual != null ? r.fuelActual : (r.fuelUsed || 0);
    balance += (r.fuelIssued || 0) - spent - (r.fuelIdle || 0);
    balMap[r.id] = +balance.toFixed(2);
  });
  if (cacheable) _fuelBalCache[vehicleId] = balMap;
  return balMap;
}

