// Карточка ДЭС, график ТО ДЭС, баланс топлива, акт на списание
// Выделено из index.html

// ─── GENERATOR DETAIL VIEW ───────────────────────────────
function renderGenDetail(g) {
  const recs       = genRecsFor(g.id);
  const totalHours = recs.reduce((s, r) => s + (r.hours || 0), 0);
  const totalFuel  = recs.reduce((s, r) => s + (r.fuelActual || 0), 0);
  const avgConsumption = totalHours > 0 && totalFuel > 0 ? totalFuel / totalHours : 0;

  const fuelLabels  = { diesel: 'Дизельное', gasoline: 'Бензин', gas: 'Газ (ГБО)' };
  const fuelClasses = { diesel: 'diesel', gasoline: 'gasoline', gas: 'gas' };

  const monthRecs = recs.filter(r => {
    const d = new Date(r.date);
    return d.getFullYear() === selectedGenYear && (d.getMonth()+1) === selectedGenMonth;
  }).sort((a,b) => cmpDateAsc(a.date, b.date));

  const monthHours = monthRecs.reduce((s, r) => s + (r.hours || 0), 0);
  const monthFuel  = monthRecs.reduce((s, r) => s + (r.fuelActual || 0), 0);

  // Month tabs
  const months = getMonthsForGenerator(g.id);
  let monthTabsHtml = '';
  if (!months.length) {
    monthTabsHtml = '<span style="color:var(--text3);font-size:12px">Нет данных</span>';
  } else {
    [...new Set(months.map(m => m.year))].forEach(yr => {
      monthTabsHtml += `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><span class="year-label">${yr}</span>`;
      months.filter(m => m.year === yr).forEach(m => {
        const active = m.year === selectedGenYear && m.month === selectedGenMonth;
        monthTabsHtml += `<div class="month-tab ${active?'active':''}" onclick="selectGenMonth(${m.year},${m.month})">${MONTHS_SHORT[m.month-1]}</div>`;
      });
      monthTabsHtml += '</div>';
    });
  }
  const now = new Date(); const nowY = now.getFullYear(), nowM = now.getMonth()+1;
  if (!months.some(m => m.year === nowY && m.month === nowM)) {
    monthTabsHtml += `<div class="month-tab ${selectedGenYear===nowY&&selectedGenMonth===nowM?'active':''}" onclick="selectGenMonth(${nowY},${nowM})" style="border-style:dashed">${MONTHS_SHORT[nowM-1]} ${nowY}</div>`;
  }

  // Fuel balance
  const balMap      = computeGenFuelBalances(g.id);
  const allSorted   = recs.slice().sort((a,b) => cmpDateAsc(a.date, b.date));
  const lastRec     = allSorted[allSorted.length - 1];
  const currentBal  = lastRec != null ? (balMap[lastRec.id] ?? (g.fuelBalance||0)) : (g.fuelBalance||0);

  // Table rows
  let tableRows = '';
  if (!monthRecs.length) {
    tableRows = `<tr><td colspan="12" class="empty-table">Нет записей за этот месяц. Нажмите «+ Запись» чтобы добавить.</td></tr>`;
  } else {
    monthRecs.forEach(r => {
      const dayName = DAYS_RU[new Date(r.date).getDay()];
      const normLh  = g.norm || null;
      const factLh  = r.fuelActual && r.hours > 0 ? r.fuelActual / r.hours : null;
      const factDev = factLh !== null && normLh !== null ? factLh - normLh : null;
      const factDevHtml = factDev !== null
        ? ` <span style="font-size:11px;color:${factDev>0?'var(--red)':'var(--green)'};font-weight:600">${factDev>0?'+':''}${factDev.toFixed(1)}</span>`
        : '';
      const bal      = balMap[r.id];
      const balColor = bal < 0 ? 'var(--red)' : bal === 0 ? 'var(--text3)' : 'var(--green)';
      tableRows += `<tr>
        <td class="td-day">${fmtDate(r.date)} <span style="color:var(--text3)">${dayName}</span></td>
        <td class="td-num">${r.hours!=null ? r.hours.toLocaleString('ru',{maximumFractionDigits:1}) : '—'}</td>
        <td class="td-num">${r.meterStart!=null?r.meterStart.toLocaleString('ru',{maximumFractionDigits:1}):'—'} → ${r.meterEnd!=null?r.meterEnd.toLocaleString('ru',{maximumFractionDigits:1}):'—'}</td>
        <td class="td-num" style="cursor:pointer" title="Изменить нагрузку" onclick="event.stopPropagation();openEditGenRecord('${r.id}')">${r.load!=null?r.load.toLocaleString('ru',{maximumFractionDigits:1}):'—'}</td>
        <td class="td-num">${r.fuelIssued!=null?r.fuelIssued.toLocaleString('ru',{maximumFractionDigits:1}):'—'}</td>
        <td class="td-num">${r.fuelUsed!=null?r.fuelUsed.toLocaleString('ru',{maximumFractionDigits:1}):'—'}</td>
        <td class="td-num">${r.fuelActual!=null?r.fuelActual.toLocaleString('ru',{minimumFractionDigits:2,maximumFractionDigits:2}):'—'}</td>
        <td class="td-num" style="color:${balColor};font-weight:600">${bal!=null?bal.toLocaleString('ru',{minimumFractionDigits:2,maximumFractionDigits:2}):'—'}</td>
        <td class="td-num">${normLh!==null?normLh.toFixed(1):'—'}</td>
        <td class="td-num">${factLh!==null?factLh.toFixed(1)+factDevHtml:'—'}</td>
        <td style="padding:10px 14px;font-size:13px;color:var(--text2)">${r.note||'—'}</td>
        <td class="td-actions">
          <button class="icon-btn" title="Редактировать" onclick="openEditGenRecord('${r.id}')">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="icon-btn del" title="Удалить" onclick="deleteGenRecord('${r.id}')">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
          </button>
        </td>
      </tr>`;
    });
  }

  const stColor = g.status === 'В работе' ? 'var(--green)' : g.status === 'Резерв' ? 'var(--accent)' : g.status ? 'var(--red)' : null;

  document.getElementById('mainContent').innerHTML = `
    <div class="vehicle-detail-header">
      <div class="vdh-left">
        <div class="vdh-make">${g.name}</div>
        <div class="vdh-meta">
          ${g.serial?`<div class="vdh-meta-item"><svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg><span style="font-family:'Courier New',monospace;letter-spacing:0.5px">С/н: ${g.serial}</span></div>`:''}
          ${g.location?`<div class="vdh-meta-item"><svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>${g.location}</div>`:''}
          ${g.responsible?`<div class="vdh-meta-item"><svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>${g.responsible}</div>`:''}
          ${g.power!=null?`<div class="vdh-meta-item" style="color:var(--text3);font-size:12px"><svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>${g.power} кВт</div>`:''}
          ${g.fuel?`<div class="vdh-meta-item"><span class="fuel-tag ${fuelClasses[g.fuel]}">${fuelLabels[g.fuel]}</span></div>`:''}
          ${g.norm?`<div class="vdh-meta-item" style="color:var(--text3);font-size:12px">Норма: ${g.norm} л/мтч</div>`:''}
          ${g.cost!=null?`<div class="vdh-meta-item" style="color:var(--text3);font-size:12px">Стоимость: ${g.cost.toLocaleString('ru-RU')} руб.</div>`:''}
          ${stColor?`<div class="vdh-meta-item"><span style="color:${stColor};font-weight:600">${g.status}</span></div>`:''}
        </div>
        ${g.note?`<div style="margin-top:8px;font-size:12px;color:var(--text2);background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:8px 12px;max-width:600px">${g.note}</div>`:''}
      </div>
      <div class="vdh-actions">
        <button class="btn btn-ghost btn-sm" onclick="openGenExportOneModal('${g.id}')">
          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          XLS
        </button>
        <button class="btn btn-ghost btn-sm" onclick="openEditGenerator('${g.id}')">
          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Изменить
        </button>
        <button class="btn btn-danger btn-sm" onclick="deleteGenerator('${g.id}')">
          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
          Удалить
        </button>
      </div>
    </div>

    <div class="stats-row">
      <div class="stat-card accent-blue">
        <div class="stat-label">Общая наработка</div>
        <div class="stat-value">${totalHours.toLocaleString('ru',{maximumFractionDigits:1})} <span class="stat-unit">мтч</span></div>
        <div class="stat-sub">За всё время</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">За месяц</div>
        <div class="stat-value">${monthHours.toLocaleString('ru',{maximumFractionDigits:1})} <span class="stat-unit">мтч</span></div>
        <div class="stat-sub">${MONTHS_RU[selectedGenMonth-1]} ${selectedGenYear}</div>
      </div>
      <div class="stat-card accent-yellow">
        <div class="stat-label">Расход топлива</div>
        <div class="stat-value">${totalFuel.toLocaleString('ru',{maximumFractionDigits:1})} <span class="stat-unit">л</span></div>
        <div class="stat-sub">Фактический, всего</div>
      </div>
      <div class="stat-card accent-green">
        <div class="stat-label">Ср. расход</div>
        <div class="stat-value">${avgConsumption>0?avgConsumption.toFixed(1):'—'} <span class="stat-unit">л/мтч</span></div>
        <div class="stat-sub">${g.norm?'Норма: '+g.norm+' л/мтч':'Норма не задана'}</div>
      </div>
      <div class="stat-card ${currentBal<0?'accent-red':currentBal<50?'accent-yellow':'accent-green'}">
        <div class="stat-label">Остаток в баке</div>
        <div class="stat-value" style="color:${currentBal<0?'var(--red)':currentBal<50?'var(--yellow)':'inherit'}">${currentBal.toLocaleString('ru',{maximumFractionDigits:1})} <span class="stat-unit">л</span></div>
        <div class="stat-sub">${lastRec?'После последней записи':'Начальный остаток'}</div>
      </div>
    </div>

    <div>
      <div class="section-header"><div class="section-title">История по месяцам</div></div>
      <div class="month-tabs">${monthTabsHtml}</div>
    </div>

    <div class="table-wrap" id="genHistoryTableWrap">
      <div class="table-toolbar">
        <div class="table-toolbar-left">
          ${MONTHS_RU[selectedGenMonth-1]} ${selectedGenYear}
          <span style="color:var(--text3);font-weight:400;font-size:12px;margin-left:10px">${monthRecs.length} записей · ${monthHours.toLocaleString('ru',{maximumFractionDigits:1})} мтч · ${monthFuel.toLocaleString('ru',{maximumFractionDigits:1})} л</span>
        </div>
        <button class="btn btn-primary btn-sm" onclick="openAddGenRecord()">
          <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          + Запись
        </button>
      </div>
      <div class="table-scroll">
        <table>
          <thead><tr>
            <th>Дата</th><th>Наработка, мтч</th><th>Счётчик</th>
            <th>Нагрузка, кВт</th>
            <th>Выдано, л</th><th>По норме, л</th><th>Факт. расход, л</th>
            <th>Остаток, л</th><th>Норма л/мтч</th><th>Факт л/мтч</th>
            <th>Примечание</th><th></th>
          </tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    </div>

    ${renderToSection(g.id, totalHours + (g.hoursInit || 0))}`;
}

// ─── ГРАФИК ТО ───────────────────────────────────────────
let editingToId = null;

function toRecsFor(gid) {
  return (data.toRecords || []).filter(r => r.generatorId === gid)
    .sort((a, b) => cmpDateAsc(a.date, b.date));
}

function renderToSection(gid, currentHours) {
  const recs = toRecsFor(gid);
  const last = recs[recs.length - 1];

  // Статус следующего ТО
  let statusHtml = '';
  if (last) {
    const parts = [];
    if (last.nextHoursAbs != null) {
      const diff = last.nextHoursAbs - currentHours;
      if (diff <= 0) {
        parts.push(`<span style="color:var(--red);font-weight:600">⚠ ТО просрочено на ${Math.abs(diff).toFixed(0)} мтч!</span>`);
      } else if (diff <= 50) {
        parts.push(`<span style="color:var(--yellow);font-weight:600">⚡ До ТО: ${diff.toFixed(0)} мтч</span>`);
      } else {
        parts.push(`<span style="color:var(--green);font-weight:600">До ТО: ${diff.toFixed(0)} мтч</span>`);
      }
    }
    if (last.nextDate) {
      const nd = new Date(last.nextDate);
      const today = new Date(); today.setHours(0,0,0,0);
      const daysLeft = Math.ceil((nd - today) / 86400000);
      if (daysLeft <= 0) {
        parts.push(`<span style="color:var(--red);font-weight:600">⚠ Дата ТО просрочена (${fmtDate(last.nextDate)})</span>`);
      } else if (daysLeft <= 14) {
        parts.push(`<span style="color:var(--yellow);font-weight:600">⚡ Дата ТО: ${fmtDate(last.nextDate)} (через ${daysLeft} дн.)</span>`);
      } else {
        parts.push(`<span style="color:var(--green);font-weight:600">Дата ТО: ${fmtDate(last.nextDate)}</span>`);
      }
    }
    if (parts.length) statusHtml = `<div style="display:flex;flex-wrap:wrap;gap:14px;margin-bottom:8px">${parts.join('')}</div>`;
  }

  let rows = '';
  if (!recs.length) {
    rows = `<tr><td colspan="8" class="empty-table">Нет записей ТО. Нажмите «+ ТО» чтобы добавить.</td></tr>`;
  } else {
    [...recs].reverse().forEach(r => {
      rows += `<tr>
        <td class="td-day">${fmtDate(r.date)}</td>
        <td style="padding:10px 14px;font-size:13px;font-weight:600">${r.type || '—'}</td>
        <td class="td-num">${r.hours != null ? r.hours.toLocaleString('ru', {maximumFractionDigits:1}) : '—'}</td>
        <td class="td-num">${r.nextHoursAbs != null ? r.nextHoursAbs.toLocaleString('ru', {maximumFractionDigits:0}) : (r.nextHours ? '+'+r.nextHours+' мтч' : '—')}</td>
        <td class="td-day">${r.nextDate ? fmtDate(r.nextDate) : '—'}</td>
        <td class="td-num">${r.cost != null ? r.cost.toLocaleString('ru-RU') + ' ₽' : '—'}</td>
        <td style="padding:10px 14px;font-size:13px;color:var(--text2)">${r.performer || '—'}</td>
        <td style="padding:10px 14px;font-size:13px;color:var(--text2)">${r.note || '—'}</td>
        <td class="td-actions">
          <button class="icon-btn" onclick="openEditToRecord('${r.id}')">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="icon-btn del" onclick="deleteToRecord('${r.id}')">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
          </button>
        </td>
      </tr>`;
    });
  }

  return `<div class="table-wrap" style="margin-top:24px">
    <div class="table-toolbar">
      <div class="table-toolbar-left">
        <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="color:var(--accent)"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>
        График ТО
        <span style="color:var(--text3);font-weight:400;font-size:12px;margin-left:10px">${recs.length} записей · Текущий счётчик: ${currentHours.toLocaleString('ru',{maximumFractionDigits:1})} мтч</span>
      </div>
      <button class="btn btn-primary btn-sm" onclick="openAddToRecord('${gid}')">
        <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        + ТО
      </button>
    </div>
    ${statusHtml}
    <div class="table-scroll">
      <table>
        <thead><tr>
          <th>Дата</th><th>Вид ТО</th><th>Счётчик, мтч</th><th>След. ТО (мтч)</th>
          <th>Дата след. ТО</th><th>Стоимость</th><th>Исполнитель</th><th>Примечание</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

function openAddToRecord(gid) {
  editingToId = null;
  document.getElementById('toModalTitle').textContent = 'Добавить запись ТО';
  const now = new Date();
  document.getElementById('to_date').value = fmtDate(now.toISOString().split('T')[0]);
  ['to_type','to_next_date','to_performer','to_note'].forEach(id => document.getElementById(id).value = '');
  ['to_hours','to_next_hours','to_cost'].forEach(id => document.getElementById(id).value = '');
  // предзаполнить текущий счётчик из последней записи
  const g = (data.generators || []).find(x => x.id === gid);
  if (g) {
    const last = toRecsFor(gid).pop();
    const recs = genRecsFor(gid).slice().sort((a,b) => cmpDateAsc(a.date, b.date));
    const lastRec = recs[recs.length-1];
    const curH = (g.hoursInit||0) + recs.reduce((s,r)=>s+(r.hours||0),0);
    document.getElementById('to_hours').value = curH > 0 ? curH.toFixed(1) : '';
    if (last && last.nextHours) document.getElementById('to_next_hours').value = last.nextHours;
  }
  document.getElementById('toModal').dataset.gid = gid;
  openModal('toModal');
}

function openEditToRecord(id) {
  const r = (data.toRecords || []).find(x => x.id === id);
  if (!r) return;
  editingToId = id;
  document.getElementById('toModalTitle').textContent = 'Редактировать запись ТО';
  document.getElementById('to_date').value       = fmtDate(r.date);
  document.getElementById('to_type').value       = r.type        || '';
  document.getElementById('to_hours').value      = r.hours       ?? '';
  document.getElementById('to_next_hours').value = r.nextHours   ?? '';
  document.getElementById('to_next_date').value  = r.nextDate    ? fmtDate(r.nextDate) : '';
  document.getElementById('to_cost').value       = r.cost        ?? '';
  document.getElementById('to_performer').value  = r.performer   || '';
  document.getElementById('to_note').value       = r.note        || '';
  document.getElementById('toModal').dataset.gid = r.generatorId;
  openModal('toModal');
}

function saveToRecord() {
  const dateIso = parseDate(document.getElementById('to_date').value.trim());
  const type    = document.getElementById('to_type').value.trim();
  if (!dateIso) { showFieldError('Укажите дату проведения ТО', 'to_date'); return; }
  if (!type)    { showFieldError('Укажите вид ТО', 'to_type'); return; }
  const nextHours   = parseFloat(document.getElementById('to_next_hours').value) || null;
  const hours       = parseFloat(document.getElementById('to_hours').value) ?? null;
  const nextDate    = parseDate(document.getElementById('to_next_date').value.trim()) || null;
  const nextHoursAbs = hours != null && nextHours != null ? +(hours + nextHours).toFixed(1) : null;
  const obj = {
    generatorId:  document.getElementById('toModal').dataset.gid,
    date:         dateIso,
    type,
    hours:        hours != null ? +hours : null,
    nextHours,
    nextHoursAbs,
    nextDate,
    cost:         parseFloat(document.getElementById('to_cost').value) || null,
    performer:    document.getElementById('to_performer').value.trim(),
    note:         document.getElementById('to_note').value.trim(),
  };
  if (!data.toRecords) data.toRecords = [];
  if (editingToId) {
    Object.assign(data.toRecords.find(x => x.id === editingToId), obj);
  } else {
    obj.id = 'to_' + Date.now();
    data.toRecords.push(obj);
  }
  saveData(data);
  closeModal('toModal');
  const g = (data.generators || []).find(x => x.id === obj.generatorId);
  if (g) renderGenDetail(g);
}

function deleteToRecord(id) {
  if (!confirm('Удалить эту запись ТО?')) return;
  data.toRecords = (data.toRecords || []).filter(r => r.id !== id);
  saveData(data);
  const g = (data.generators || []).find(x => x.id === selectedGeneratorId);
  if (g) renderGenDetail(g);
}

// ─── GENERATOR FUEL BALANCE ──────────────────────────────
function computeGenFuelBalances(gid) {
  if (_genBalCache[gid]) return _genBalCache[gid];
  const gen  = (data.generators || []).find(g => g.id === gid);
  const recs = genRecsFor(gid).slice().sort((a,b) => cmpDateAsc(a.date, b.date));
  let balance = gen ? (gen.fuelBalance || 0) : 0;
  const balMap = {};
  recs.forEach(r => {
    const spent = r.fuelActual != null ? r.fuelActual : (r.fuelUsed || 0);
    balance += (r.fuelIssued || 0) - spent;
    balMap[r.id] = +balance.toFixed(2);
  });
  _genBalCache[gid] = balMap;
  return balMap;
}

// ═══════════════════════════════════════════════════════
// АКТ НА СПИСАНИЕ ГСМ (ДЭС) — по образцу
// ═══════════════════════════════════════════════════════
function genActLocations() {
  const set = new Set();
  (data.generators || []).forEach(g => set.add((g.location || '').trim() || '— Без местонахождения —'));
  return Array.from(set).sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0);
}

function openGenActModal() {
  if (!(data.generators || []).length) { showToast('Нет ДЭС для формирования акта'); return; }
  document.getElementById('ga2_all').checked = true;
  document.getElementById('ga2_range_inputs').style.display = 'none';
  const now = new Date();
  const y = now.getFullYear(), m = (now.getMonth() + 1).toString().padStart(2, '0');
  document.getElementById('ga2_date').value = fmtDate(now.toISOString().split('T')[0]);
  document.getElementById('ga2_date_from').value = `01.${m}.${y}`;
  document.getElementById('ga2_date_to').value = fmtDate(now.toISOString().split('T')[0]);
  document.getElementById('ga2_no').value = '';
  document.getElementById('ga2_owner').value = '';
  const sel = document.getElementById('ga2_loc');
  sel.innerHTML = '<option value="__ALL__">Все местонахождения (по отдельности)</option>' +
    genActLocations().map(l => `<option value="${l.replace(/"/g, '&quot;')}">${l}</option>`).join('');
  document.querySelectorAll('input[name="ga2_period"]').forEach(r => r.onchange = () => {
    document.getElementById('ga2_range_inputs').style.display = document.getElementById('ga2_range').checked ? 'block' : 'none';
  });
  openModal('genActModal');
}

function doExportGenAct() {
  const isRange = document.getElementById('ga2_range').checked;
  let dateFrom = null, dateTo = null;
  if (isRange) {
    dateFrom = parseDate(document.getElementById('ga2_date_from').value.trim());
    dateTo   = parseDate(document.getElementById('ga2_date_to').value.trim());
    if (!dateFrom || !dateTo) { alert('Укажите обе даты периода в формате ДД.ММ.ГГГГ'); return; }
    if (dateFrom > dateTo) { alert('Дата «с» не может быть позже даты «по»'); return; }
  }
  const opts = {
    actNo:  document.getElementById('ga2_no').value.trim(),
    actDate: parseDate(document.getElementById('ga2_date').value.trim()) || new Date().toISOString().split('T')[0],
    loc:    document.getElementById('ga2_loc').value,
    owner:  document.getElementById('ga2_owner').value.trim(),
  };
  closeModal('genActModal');
  exportGenWriteOffAct(dateFrom, dateTo, opts);
}

// Баланс ёмкости на дату: до (inclusive=false) или включительно (inclusive=true)
function computeTankBalanceAt(tankId, boundary, inclusive) {
  const t = tanksAll().find(x => x.id === tankId);
  if (!t) return 0;
  const okDate = d => !boundary || (inclusive ? d <= boundary : d < boundary);
  const income = (data.tankIncomes || []).filter(r => r.tankId === tankId && okDate(r.date)).reduce((s, r) => s + (r.amount || 0), 0);
  const boundGenIds = new Set((data.generators || []).filter(g => g.tankId === tankId).map(g => g.id));
  const issued = (data.genRecords || []).filter(r => boundGenIds.has(r.generatorId) && okDate(r.date)).reduce((s, r) => s + (r.fuelIssued || 0), 0);
  return +((t.balanceInit || 0) + income - issued).toFixed(2);
}

// Баланс генератора без привязанной ёмкости на дату (аналог computeTankBalanceAt)
// Расход топлива (л/час) при заданной нагрузке — линейная интерполяция между
// нормой при 50% и нормой при 100% (кривая расхода дизель-генератора не
// пропорциональна напрямую нагрузке от нуля, поэтому одной нормы100 мало).
function genFuelRate(g, load) {
  if (!g.norm100 || !g.power) return null;
  const loadPct = (load / g.power) * 100;
  if (g.norm50 != null) {
    if (loadPct <= 50 && g.normIdle != null) {
      return g.normIdle + (g.norm50 - g.normIdle) * loadPct / 50;
    }
    return g.norm50 + (g.norm100 - g.norm50) * (loadPct - 50) / 50;
  }
  return g.norm100 * (loadPct / 100);
}

function computeGenBalanceAt(gid, boundary, inclusive) {
  const g = (data.generators || []).find(x => x.id === gid);
  if (!g) return 0;
  const okDate = d => !boundary || (inclusive ? d <= boundary : d < boundary);
  const recs = (data.genRecords || []).filter(r => r.generatorId === gid && okDate(r.date))
    .slice().sort((a,b) => cmpDateAsc(a.date, b.date));
  let bal = g.fuelBalance || 0;
  recs.forEach(r => { const spent = r.fuelActual != null ? r.fuelActual : (r.fuelUsed || 0); bal += (r.fuelIssued || 0) - spent; });
  return +bal.toFixed(2);
}

function exportGenWriteOffAct(dateFrom, dateTo, opts) {
  opts = opts || {};
  const MONTHS_RU = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
  const fuelLabels = { diesel:'Дизельное топливо', gasoline:'Бензин', gas:'Газ' };
  const inPeriod = r => (!dateFrom || r.date >= dateFrom) && (!dateTo || r.date <= dateTo);
  let periodLabel;
  if (dateFrom && dateTo) {
    const df = new Date(dateFrom), dt = new Date(dateTo);
    periodLabel = (df.getFullYear() === dt.getFullYear() && df.getMonth() === dt.getMonth())
      ? `${MONTHS_RU[df.getMonth()]} ${df.getFullYear()}г.` : `${fmtDate(dateFrom)} — ${fmtDate(dateTo)}`;
  } else periodLabel = 'всё время';

  const allLocs = genActLocations();
  const locsToRender = (opts.loc && opts.loc !== '__ALL__') ? [opts.loc] : allLocs;
  if (!locsToRender.length) { alert('Нет ДЭС для акта.'); return; }

  const P = { navy:'1B3A6B', navyMid:'2D5A8E', navyLight:'D6E4F7', white:'FFFFFF',
    gray1:'F8FAFC', gray2:'F1F5F9', gray3:'E2E8F0', gray4:'94A3B8', text:'1E293B', green:'16A34A', red:'DC2626' };
  const bAll = (st, rgb) => { const b = { style:st, color:{rgb} }; return { top:b, bottom:b, left:b, right:b }; };
  const cs = (font, fill, align, border) => ({ font:font||{}, fill:fill?{patternType:'solid',fgColor:{rgb:fill}}:{patternType:'none'}, alignment:align||{vertical:'center'}, border:border||{} });
  const NC = 11;
  const ST = {
    appr:  cs({sz:10,color:{rgb:P.text}}, null, {horizontal:'left',vertical:'center',wrapText:true}, {}),
    org:   cs({bold:true,sz:11,color:{rgb:P.text}}, null, {horizontal:'left',vertical:'center'}, {}),
    title: cs({bold:true,sz:13,color:{rgb:P.text}}, null, {horizontal:'center',vertical:'center'}, {}),
    plain: cs({sz:10,color:{rgb:P.text}}, null, {horizontal:'left',vertical:'center',wrapText:true}, {}),
    head:  cs({bold:true,sz:9,color:{rgb:P.white}}, P.navyMid, {horizontal:'center',vertical:'center',wrapText:true}, bAll('medium',P.navy)),
    tot:   cs({bold:true,sz:10,color:{rgb:P.text}}, P.navyLight, {horizontal:'center',vertical:'center'}, bAll('medium',P.navy)),
    totL:  cs({bold:true,sz:10,color:{rgb:P.text}}, P.navyLight, {horizontal:'left',vertical:'center',indent:1}, bAll('medium',P.navy)),
    tdC: bg => cs({sz:9,color:{rgb:P.text}}, bg, {horizontal:'center',vertical:'center',wrapText:true}, bAll('thin',P.gray3)),
    tdL: bg => cs({sz:9,color:{rgb:P.text}}, bg, {horizontal:'left',vertical:'center',wrapText:true,indent:1}, bAll('thin',P.gray3)),
    tdR: bg => cs({sz:9,color:{rgb:P.text}}, bg, {horizontal:'right',vertical:'center',indent:1}, bAll('thin',P.gray3)),
    sp:    cs(null, null, null, {}),
  };
  const ws = { '!merges':[], '!rows':[], '!cols':[] };
  let n = 0;
  const put = (r, c, val, style) => { ws[XLSX.utils.encode_cell({r,c})] = { v: val==null?'':val, t: typeof val==='number'?'n':'s', s: style }; ws['!ref'] = XLSX.utils.encode_range({ s:{r:0,c:0}, e:{r:Math.max(r,0),c:NC} }); };
  const merge = (r1,c1,r2,c2) => ws['!merges'].push({ s:{r:r1,c:c1}, e:{r:r2,c:c2} });
  const fillRow = (r, style) => { for (let c=0;c<=NC;c++) if (!ws[XLSX.utils.encode_cell({r,c})]) put(r,c,'',style); };
  const rowH = (r, h) => ws['!rows'][r] = { hpt:h };
  const num = (x, d) => +(Number(x)||0).toFixed(d==null?2:d);

  let rendered = false;

  locsToRender.forEach((loc, li) => {
    const gens = (data.generators || []).filter(g => (((g.location||'').trim()) || '— Без местонахождения —') === loc)
      .sort((a,b) => (a.name||'').toLowerCase() < (b.name||'').toLowerCase() ? -1 : 1);
    if (!gens.length) return;
    rendered = true;
    const linkedTanks = [...new Set(gens.map(g => g.tankId).filter(Boolean))];
    const ownerFromTank = (linkedTanks.map(id => (tanksAll().find(t=>t.id===id)||{}).owner).find(Boolean)) || '';
    const owner = opts.owner || ownerFromTank || '';

    if (li > 0) { put(n,0,'',ST.sp); merge(n,0,n,NC); rowH(n,12); n++; }

    // Утверждаю
    put(n,8,'УТВЕРЖДАЮ:',ST.appr); merge(n,8,n,NC); rowH(n,14); n++;
    put(n,8,'_______________ /______________/',ST.appr); merge(n,8,n,NC); rowH(n,14); n++;
    put(n,8,'«___» ____________ 20__ г.',ST.appr); merge(n,8,n,NC); rowH(n,14); n++;
    // Шапка организации
    if (owner) { put(n,0,owner,ST.org); merge(n,0,n,6); rowH(n,15); n++; }
    put(n,0,loc,ST.org); merge(n,0,n,6); rowH(n,15); n++;
    put(n,0,'',ST.sp); merge(n,0,n,NC); rowH(n,4); n++;
    // Заголовок
    put(n,0,`Акт на списание материалов № ${opts.actNo||'____'} от ${fmtDate(opts.actDate)} г.`,ST.title); merge(n,0,n,NC); fillRow(n,ST.title); rowH(n,20); n++;
    put(n,0,'Настоящий акт составлен о том, что нижеперечисленные материалы израсходованы в полном объеме.',ST.plain); merge(n,0,n,NC); rowH(n,14); n++;
    put(n,0,`Цель расхода: Производственно-хозяйственные нужды ${loc}   ·   Период: ${periodLabel}`,ST.plain); merge(n,0,n,NC); rowH(n,14); n++;
    put(n,0,'',ST.sp); merge(n,0,n,NC); rowH(n,4); n++;

    // Шапка таблицы (2 строки)
    const h1 = n, h2 = n+1;
    const vh = (c, label) => { put(h1,c,label,ST.head); merge(h1,c,h2,c); };
    vh(0,'Наименование оборудования'); vh(1,'Наименование ГСМ'); vh(2,'Ед. изм.'); vh(3,'Кол-во мото-часов');
    vh(4,'Показания мтч на начало'); vh(5,'Показания мтч на конец'); vh(6,'Факт. нагрузка, кВт');
    put(h1,7,'Норма л/час',ST.head); merge(h1,7,h1,8); put(h2,7,'при 100%',ST.head); put(h2,8,'при 50%',ST.head);
    put(h1,9,'Расход ГСМ, л',ST.head); merge(h1,9,h1,10); put(h2,9,'по норме',ST.head); put(h2,10,'факт',ST.head);
    vh(11,'Остаток на конец мес., л');
    rowH(h1,16); rowH(h2,26); n += 2;

    let tHours=0, tNorm=0, tAct=0, tOstNoTank=0, i=0;
    gens.forEach(g => {
      const recs = genRecsFor(g.id).filter(inPeriod).slice().sort((a,b)=>cmpDateAsc(a.date, b.date));
      const hours = recs.reduce((s,r)=>s+(r.hours||0),0);
      const meterStart = recs.length ? (recs[0].meterStart!=null?recs[0].meterStart:(g.hoursInit!=null?g.hoursInit:'')) : (g.hoursInit!=null?g.hoursInit:'');
      const meterEnd = recs.length ? (recs[recs.length-1].meterEnd!=null?recs[recs.length-1].meterEnd:'') : '';
      const loadHours = recs.reduce((s,r)=>s+((r.load!=null?r.load:0)*(r.hours||0)),0);
      const loadAvg = hours>0 && loadHours>0 ? loadHours/hours : null;
      const normSpent = recs.reduce((s,r)=>{ if (g.norm100 && g.power && r.load!=null) { const rate=genFuelRate(g,r.load); return s+Math.max(0,rate||0)*(r.hours||0); } return s+(r.fuelUsed||0); },0);
      const actSpent = recs.reduce((s,r)=>s+(r.fuelActual!=null?r.fuelActual:(r.fuelUsed||0)),0);
      const ostKon = g.tankId ? computeTankBalanceAt(g.tankId, dateTo, true) : computeGenBalanceAt(g.id, dateTo, true);
      if (!g.tankId) tOstNoTank += ostKon; // ёмкости считаются один раз ниже (linkedTanks), без ёмкости — суммируем по генератору
      const bg = i%2===0?P.white:P.gray1; i++;
      tHours+=hours; tNorm+=normSpent; tAct+=actSpent;
      const nameCell = g.name + (g.serial ? ', ' + g.serial : '');
      put(n,0,nameCell,ST.tdL(bg));
      put(n,1,fuelLabels[g.fuel||'diesel'],ST.tdC(bg));
      put(n,2,'л',ST.tdC(bg));
      put(n,3,num(hours,1),ST.tdC(bg));
      put(n,4,meterStart===''?'—':+meterStart,ST.tdR(bg));
      put(n,5,meterEnd===''?'—':+meterEnd,ST.tdR(bg));
      put(n,6,loadAvg!=null?num(loadAvg,1):'—',ST.tdC(bg));
      put(n,7,g.norm100!=null?+g.norm100:'—',ST.tdC(bg));
      put(n,8,g.norm50!=null?+g.norm50:'—',ST.tdC(bg));
      put(n,9,num(normSpent),ST.tdR(bg));
      put(n,10,num(actSpent),ST.tdR(bg));
      put(n,11,num(ostKon),ST.tdR(bg));
      rowH(n,18); n++;
    });
    // ИТОГО
    put(n,0,'ИТОГО',ST.totL); merge(n,0,n,2); fillRow(n,ST.totL);
    put(n,3,num(tHours,1),ST.tot); put(n,4,'',ST.tot); put(n,5,'',ST.tot); put(n,6,'',ST.tot); put(n,7,'',ST.tot); put(n,8,'',ST.tot);
    put(n,9,num(tNorm),ST.tot); put(n,10,num(tAct),ST.tot);
    put(n,11, num(tOstNoTank + linkedTanks.reduce((s,id)=>s+computeTankBalanceAt(id,dateTo,true),0)), ST.tot);
    rowH(n,20); n++;
    put(n,0,'',ST.sp); merge(n,0,n,NC); rowH(n,6); n++;

    // Приход топлива за период (из привязанных ёмкостей)
    const incomes = (data.tankIncomes || []).filter(r => linkedTanks.includes(r.tankId) && inPeriod(r)).sort((a,b)=>cmpDateAsc(a.date, b.date));
    put(n,0,'Приход топлива за отчётный период',ST.totL); merge(n,0,n,3); fillRow(n,ST.totL); rowH(n,18); n++;
    put(n,0,'Дата привоза',ST.head); merge(n,0,n,1); put(n,2,'Объём, л',ST.head); merge(n,2,n,3); rowH(n,16); n++;
    if (incomes.length) {
      incomes.forEach((r,k)=>{ const bg=k%2===0?P.white:P.gray1; put(n,0,fmtDate(r.date),ST.tdC(bg)); merge(n,0,n,1); put(n,2,num(r.amount),ST.tdR(bg)); merge(n,2,n,3); rowH(n,16); n++; });
    } else { put(n,0,'Нет прихода за период',ST.tdC(P.white)); merge(n,0,n,3); rowH(n,16); n++; }
    // Остаток ДТ
    const noTankGenIds = gens.filter(g => !g.tankId).map(g => g.id);
    const ostNach = linkedTanks.reduce((s,id)=>s+computeTankBalanceAt(id, dateFrom, false), 0)
      + noTankGenIds.reduce((s,id)=>s+computeGenBalanceAt(id, dateFrom, false), 0);
    const ostKonAll = linkedTanks.reduce((s,id)=>s+computeTankBalanceAt(id, dateTo, true), 0)
      + noTankGenIds.reduce((s,id)=>s+computeGenBalanceAt(id, dateTo, true), 0);
    put(n,0,'Остаток ДТ, л:',ST.totL); merge(n,0,n,1); put(n,2,'на начало',ST.head); put(n,3,'на конец',ST.head); rowH(n,16); n++;
    put(n,0,'',ST.tdC(P.white)); merge(n,0,n,1); put(n,2,num(ostNach),ST.tdR(P.white)); put(n,3,num(ostKonAll),ST.tdR(P.white)); rowH(n,16); n++;
    put(n,0,'',ST.sp); merge(n,0,n,NC); rowH(n,8); n++;

    // Подписи
    put(n,0,'Председатель комиссии:',ST.plain); merge(n,0,n,NC); rowH(n,14); n++;
    put(n,0,'Управляющий директор _______________ /______________________/',ST.plain); merge(n,0,n,NC); rowH(n,16); n++;
    put(n,0,'Директор по ПНГ      _______________ /______________________/',ST.plain); merge(n,0,n,NC); rowH(n,16); n++;
    put(n,0,'Члены комиссии:',ST.plain); merge(n,0,n,NC); rowH(n,14); n++;
    put(n,0,'Главный механик      _______________ /______________________/',ST.plain); merge(n,0,n,NC); rowH(n,16); n++;
    put(n,0,'Руководитель проекта _______________ /______________________/',ST.plain); merge(n,0,n,NC); rowH(n,16); n++;
    put(n,0,'Инженер-энергетик    _______________ /______________________/',ST.plain); merge(n,0,n,NC); rowH(n,16); n++;
  });

  if (!rendered) { alert('Нет ДЭС для выбранного местонахождения.'); return; }

  ws['!cols'] = [{wch:30},{wch:16},{wch:7},{wch:11},{wch:12},{wch:12},{wch:11},{wch:9},{wch:9},{wch:11},{wch:11},{wch:14}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Акт списания ГСМ ДЭС');
  const d = new Date();
  const ds = `${d.getDate().toString().padStart(2,'0')}.${(d.getMonth()+1).toString().padStart(2,'0')}.${d.getFullYear()}`;
  const suffix = (opts.loc && opts.loc!=='__ALL__') ? '_'+opts.loc.replace(/[^\wА-Яа-яЁё]+/g,'').slice(0,20) : '_все';
  XLSX.writeFile(wb, `Акт_ГСМ_ДЭС${suffix}_${ds}.xlsx`);
}

