// Карточка ДЭС, график ТО ДЭС, баланс топлива, акт на списание
// Выделено из index.html

// ─── GENERATOR DETAIL VIEW ───────────────────────────────
function genFuelSum(values){return values.some(value=>value===null)?null:DecimalCore.toNumberExact(DecimalCore.sum(values));}
function renderGenDetail(g) {
  const datedParameters=Object.hasOwn(g,'fuelNorms')?EffectivePeriods.resolve('generators',g,dispatcherLocalDate(),'fuelNorms'):null;
  const displayPower=datedParameters?datedParameters.parameters?.power:g.power,displayNorm=datedParameters?datedParameters.parameters?.norm:g.norm;
  const recs       = genRecsFor(g.id);
  const totalHours = recs.reduce((s, r) => s + (r.hours || 0), 0);
  const fuelRecs=recs.filter(r=>fuelAccountingCurrentIncludes('generators',g,r.date));
  const totalFuel  = genFuelSum(fuelRecs.map(r=>genActualSpent(g,r)));
  const fuelHours=fuelRecs.reduce((s,r)=>s+(r.hours||0),0);
  const avgConsumption = fuelHours > 0 && totalFuel > 0 ? totalFuel / fuelHours : 0;

  const fuelLabels  = { diesel: 'Дизельное', gasoline: 'Бензин', gas: 'Газ (ГБО)' };
  const fuelClasses = { diesel: 'diesel', gasoline: 'gasoline', gas: 'gas' };

  const monthRecs = recs.filter(r => {
    const d = new Date(r.date);
    return d.getFullYear() === selectedGenYear && (d.getMonth()+1) === selectedGenMonth;
  }).sort((a,b) => cmpDateAsc(a.date, b.date));

  const monthHours = monthRecs.reduce((s, r) => s + (r.hours || 0), 0);
  const monthFuel  = genFuelSum(monthRecs.filter(r=>fuelAccountingIncludes('generators',g,r.date)).map(r=>genActualSpent(g,r)));

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
  const currentBal  = fuelAccountingCurrentBalance('generators',g,recs,balMap);

  // Table rows
  let tableRows = '';
  if (!monthRecs.length) {
    tableRows = `<tr><td colspan="12" class="empty-table">Нет записей за этот месяц. Нажмите «+ Запись» чтобы добавить.</td></tr>`;
  } else {
    monthRecs.forEach(r => {
      const dayName = DAYS_RU[new Date(r.date).getDay()];
      const normAmount=genNormSpent(g,r),normLh=r.hours>0&&normAmount!==null?normAmount/r.hours:null;
      const factLh  = r.fuelActualSource!=='estimate' && fqValue(r.fuelActual)!=null && r.hours>0 ? Number(r.fuelActual)/r.hours : null;
      const factDev = factLh !== null && normLh !== null ? factLh - normLh : null;
      const factDevHtml = factDev !== null
        ? ` <span style="font-size:11px;color:${factDev>0?'var(--red)':'var(--green)'};font-weight:600">${factDev>0?'+':''}${factDev.toFixed(1)}</span>`
        : '';
      const bal      = TvsFuelEngine.recordBalanceAt(balMap,r.id);
      const balColor = bal < 0 ? 'var(--red)' : bal === 0 ? 'var(--text3)' : 'var(--green)';
      tableRows += `<tr>
        <td class="td-day">${fmtDate(r.date)} <span style="color:var(--text3)">${dayName}</span></td>
        <td class="td-num">${r.hours!=null ? r.hours.toLocaleString('ru',{maximumFractionDigits:1}) : '—'}</td>
        <td class="td-num">${r.meterStart!=null?r.meterStart.toLocaleString('ru',{maximumFractionDigits:1}):'—'} → ${r.meterEnd!=null?r.meterEnd.toLocaleString('ru',{maximumFractionDigits:1}):'—'}</td>
        <td class="td-num" style="cursor:pointer" title="Изменить нагрузку" onclick="event.stopPropagation();openEditGenRecord(${htmlJs(r.id)})">${r.load!=null?r.load.toLocaleString('ru',{maximumFractionDigits:1}):'—'}</td>
        <td class="td-num">${r.fuelIssued!=null?r.fuelIssued.toLocaleString('ru',{maximumFractionDigits:1}):'—'}</td>
        <td class="td-num">${r.fuelUsed!=null?r.fuelUsed.toLocaleString('ru',{maximumFractionDigits:1}):'—'}</td>
        <td class="td-num">${r.fuelActual!=null?Number(r.fuelActual).toLocaleString('ru',{minimumFractionDigits:2,maximumFractionDigits:2}):'—'}<small style="display:block;color:var(--text3)">${r.fuelActualSource==='estimate'?'Оценка по нагрузке':r.fuelActualSource==='manual'?'Введено вручную':r.fuelActual!=null?'Источник не указан':''}</small></td>
        <td class="td-num" style="color:${balColor};font-weight:600">${bal!=null?bal.toLocaleString('ru',{minimumFractionDigits:2,maximumFractionDigits:3}):fuelAccountingIncludes('generators',g,r.date)?'—':'<small>До начала учёта</small>'}</td>
        <td class="td-num">${normLh!==null?normLh.toFixed(1):'—'}</td>
        <td class="td-num">${factLh!==null?factLh.toFixed(1)+factDevHtml:'—'}</td>
        <td style="padding:10px 14px;font-size:13px;color:var(--text2)">${htmlEsc(r.note||'—')}</td>
        <td class="td-actions">
          <button class="icon-btn" title="Редактировать" onclick="openEditGenRecord(${htmlJs(r.id)})">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="icon-btn del" title="Удалить" onclick="deleteGenRecord(${htmlJs(r.id)})">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
          </button>
        </td>
      </tr>`;
    });
  }

  const stColor = g.status === 'В работе' ? 'var(--green)' : g.status === 'Резерв' ? 'var(--accent)' : g.status ? 'var(--red)' : null;

  document.getElementById('mainContent').innerHTML = `
    <div class="vehicle-detail-header generator-detail-header">
      <div class="vdh-left">
        <div class="vdh-make">${htmlEsc(g.name)}</div>
        <div class="vdh-meta">
          ${g.serial?`<div class="vdh-meta-item"><svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg><span style="font-family:'Courier New',monospace;letter-spacing:0.5px">С/н: ${htmlEsc(g.serial)}</span></div>`:''}
          ${g.location?`<div class="vdh-meta-item"><svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>${htmlEsc(g.location)}</div>`:''}
          ${g.responsible?`<div class="vdh-meta-item"><svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>${htmlEsc(g.responsible)}</div>`:''}
          ${displayPower!=null?`<div class="vdh-meta-item" style="color:var(--text3);font-size:12px"><svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>${htmlEsc(displayPower)} кВт${datedParameters?' · на '+fmtDate(dispatcherLocalDate()):''}</div>`:''}
          ${g.fuel?`<div class="vdh-meta-item"><span class="fuel-tag ${fuelClasses[g.fuel]}">${fuelLabels[g.fuel]}</span></div>`:''}
          ${displayNorm!=null?`<div class="vdh-meta-item" style="color:var(--text3);font-size:12px">Норма: ${htmlEsc(displayNorm)} л/мтч${datedParameters?' · на '+fmtDate(dispatcherLocalDate()):''}</div>`:datedParameters?.status==='missing'?'<div class="vdh-meta-item">Норма на сегодня не задана</div>':''}
          ${g.cost!=null?`<div class="vdh-meta-item" style="color:var(--text3);font-size:12px">Стоимость: ${g.cost.toLocaleString('ru-RU')} руб.</div>`:''}
          ${stColor?`<div class="vdh-meta-item"><span style="color:${stColor};font-weight:600">${htmlEsc(g.status)}</span></div>`:''}
        </div>
        ${g.note?`<div style="margin-top:8px;font-size:12px;color:var(--text2);background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:8px 12px;max-width:600px">${htmlEsc(g.note)}</div>`:''}
      </div>
      <div class="vdh-actions">
        <button class="btn btn-ghost btn-sm" onclick="fuelAccountingOpen('generators',${htmlEsc(JSON.stringify(g.id))})">Начало учёта ГСМ</button>
        <button class="btn btn-ghost btn-sm" onclick="fuelNormsOpen('generators',${htmlEsc(JSON.stringify(g.id))})">Нормы по датам</button>
        ${typeof seasonalFuelCardButton === 'function' ? seasonalFuelCardButton('generators',g.id) : ''}
        ${typeof generatorMaintenanceCardButtons === 'function' ? generatorMaintenanceCardButtons(g.id) : ''}
        <button class="btn btn-ghost btn-sm" onclick="personnelRequirementsOpen('generators',${htmlEsc(JSON.stringify(g.id))})">Допуски оператора</button>
        <button class="btn btn-ghost btn-sm" onclick="openGenExportOneModal(${htmlJs(g.id)})">
          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          XLS
        </button>
        <button class="btn btn-ghost btn-sm" onclick="openEditGenerator(${htmlJs(g.id)})">
          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Изменить
        </button>
        <button class="btn btn-ghost btn-sm" onclick="wfTimeline(${htmlJs('g:'+g.id)})">История</button>
        <button class="btn btn-danger btn-sm" onclick="${g.archived?'restoreGenerator':'deleteGenerator'}(${htmlJs(g.id)})">
          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
          ${g.archived?'Восстановить':'В архив'}
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
        <div class="stat-value">${totalFuel===null?'Не определён':totalFuel.toLocaleString('ru',{maximumFractionDigits:3})} <span class="stat-unit">л</span></div>
        <div class="stat-sub">Для баланса: факт и оценка</div>
      </div>
      <div class="stat-card accent-green">
        <div class="stat-label">Ср. расход</div>
        <div class="stat-value">${avgConsumption>0?avgConsumption.toFixed(1):'—'} <span class="stat-unit">л/мтч</span></div>
        <div class="stat-sub">${g.norm?'Норма: '+g.norm+' л/мтч':'Норма не задана'}</div>
      </div>
      <div class="stat-card ${currentBal<0?'accent-red':currentBal<50?'accent-yellow':'accent-green'}">
        <div class="stat-label">Остаток в баке</div>
        <div class="stat-value" style="color:${currentBal<0?'var(--red)':currentBal<50?'var(--yellow)':'inherit'}">${currentBal===null?'—':currentBal.toLocaleString('ru',{maximumFractionDigits:3})} <span class="stat-unit">л</span></div>
        <div class="stat-sub">${currentBal===null?(fuelAccountingOpening('generators',g,dispatcherLocalDate())===null?'Учёт ещё не начат':'Нет нормы или расхода на одну из дат'):fuelAccountingStatusHtml('generators',g)}</div>
      </div>
    </div>

    ${typeof costValuationCardHtml==='function'?costValuationCardHtml({section:'generators',id:g.id}):''}
    <div>
      <div class="section-header"><div class="section-title">История по месяцам</div></div>
      <div class="month-tabs">${monthTabsHtml}</div>
    </div>

    <div class="table-wrap" id="genHistoryTableWrap">
      <div class="table-toolbar">
        <div class="table-toolbar-left">
          ${MONTHS_RU[selectedGenMonth-1]} ${selectedGenYear}
          <span style="color:var(--text3);font-weight:400;font-size:12px;margin-left:10px">${monthRecs.length} записей · ${monthHours.toLocaleString('ru',{maximumFractionDigits:3})} мтч · ${monthFuel===null?'Расход не определён':monthFuel.toLocaleString('ru',{maximumFractionDigits:3})+' л'}</span>
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

    ${renderToSection(g.id, totalHours + (g.hoursInit || 0))}
    ${typeof generatorSparesSectionHtml === 'function' ? generatorSparesSectionHtml(g.id) : ''}`;
  if(typeof personnelMountAssetPeople==='function')personnelMountAssetPeople(document.querySelector('#mainContent .vehicle-detail-header'),'g:'+g.id);
  if(typeof costValuationMountCards==='function')void costValuationMountCards();
}

// ─── ГРАФИК ТО ───────────────────────────────────────────
let editingToId = null;

function toRecsFor(gid) {
  return (typeof DocumentEngine!=='undefined'?DocumentEngine.activeRows(data,'toRecords'):data.toRecords||[]).filter(r => r.generatorId === gid)
    .sort((a, b) => cmpDateAsc(a.date, b.date));
}

function renderToSection(gid, currentHours) {
  const recs = toRecsFor(gid);
  const last = recs.filter(r=>!r.planned).at(-1);

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
        <td style="padding:10px 14px;font-size:13px;font-weight:600">${htmlEsc(r.type || '—')}</td>
        <td class="td-num">${r.hours != null ? r.hours.toLocaleString('ru', {maximumFractionDigits:1}) : '—'}</td>
        <td class="td-num">${r.nextHoursAbs != null ? r.nextHoursAbs.toLocaleString('ru', {maximumFractionDigits:0}) : (r.nextHours ? '+'+r.nextHours+' мтч' : '—')}</td>
        <td class="td-day">${r.nextDate ? fmtDate(r.nextDate) : '—'}</td>
        <td class="td-num">${r.cost != null ? r.cost.toLocaleString('ru-RU') + ' ₽' : '—'}</td>
        <td style="padding:10px 14px;font-size:13px;color:var(--text2)">${htmlEsc(r.performer || '—')}</td>
        <td style="padding:10px 14px;font-size:13px;color:var(--text2)">${htmlEsc(r.note || '—')}</td>
        <td class="td-actions">
          ${r.planned?`<button class="btn btn-primary btn-sm" onclick="tssCompletePlan(${htmlJs(r.id)},'toRecords')">Выполнить план</button>`:''}
          <button class="icon-btn" onclick="${r.planned?'tssEditRecord':'openEditToRecord'}(${htmlJs(r.id)}${r.planned?",'toRecords'":''})">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="icon-btn del" onclick="deleteToRecord(${htmlJs(r.id)})">
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
      <button class="btn btn-primary btn-sm" onclick="openAddToRecord(${htmlJs(gid)})">
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

function openAddToRecord(gid) { return newDocument('toRecords',{generatorId:gid}); }

function openEditToRecord(id) {
  const r = (data.toRecords || []).find(x => x.id === id);
  if (!r) return;
  if(!r.planned&&typeof DocumentEngine!=='undefined'&&DocumentEngine.state('toRecords',r)!=='legacy-live')return lifecycleOpen('toRecords',id);
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
  document.getElementById('toModal').dataset.gid = JSON.stringify(r.generatorId);
  openModal('toModal');
}

async function saveToRecord() {
  const protectedRow=(data.toRecords||[]).find(row=>row.id===editingToId);if(protectedRow&&!protectedRow.planned&&typeof DocumentEngine!=='undefined'&&DocumentEngine.state('toRecords',protectedRow)!=='legacy-live')return lifecycleOpen('toRecords',protectedRow.id);
  let generatorId;try{generatorId=JSON.parse(document.getElementById('toModal').dataset.gid);}catch{showToast('Не удалось определить ДЭС в форме ТО. Откройте запись заново.');return;}
  if(!EntityIdentity.identifier(generatorId)||(data.generators||[]).filter(row=>row.id===generatorId).length!==1){showToast('ДЭС в форме ТО не найдена или ID неоднозначен');return;}
  const dateIso = parseDate(document.getElementById('to_date').value.trim());
  const type    = document.getElementById('to_type').value.trim();
  if (!dateIso) { showFieldError('Укажите дату проведения ТО', 'to_date'); return; }
  if (!type)    { showFieldError('Укажите вид ТО', 'to_type'); return; }
  const previous=editingToId!=null&&editingToId!==''?(data.toRecords || []).find(row=>row.id===editingToId):undefined;
  const numbers=precisionRead({hours:['to_hours',3,'null'],nextHours:['to_next_hours',3,'null'],cost:['to_cost',2,'null']},previous);
  if(!numbers)return;
  const {nextHours,hours}=numbers;
  const nextDate    = parseDate(document.getElementById('to_next_date').value.trim()) || null;
  const nextHoursAbs = hours != null && nextHours != null ? DecimalCore.toNumberExact(DecimalCore.add(hours,nextHours)) : null;
  const obj = {
    generatorId,
    date:         dateIso,
    type,
    hours:        hours != null ? +hours : null,
    nextHours,
    nextHoursAbs,
    nextDate,
    cost:         numbers.cost,
    performer:    document.getElementById('to_performer').value.trim(),
    note:         document.getElementById('to_note').value.trim(),
  };
  if (!data.toRecords) data.toRecords = [];
  if (editingToId!=null&&editingToId!=='') {
    Object.assign(data.toRecords.find(x => x.id === editingToId), obj);
  } else {
    obj.id = 'to_' + Date.now();
    data.toRecords.push(obj);
  }
  if (!await saveData(data)) return;
  closeModal('toModal');
  const g = (data.generators || []).find(x => x.id === obj.generatorId);
  if (g) renderGenDetail(g);
}

async function deleteToRecord(id) {
  const protectedRow=(data.toRecords||[]).find(row=>row.id===id);if(protectedRow&&!protectedRow.planned&&typeof DocumentEngine!=='undefined'&&DocumentEngine.state('toRecords',protectedRow)!=='legacy-live')return lifecycleOpen('toRecords',id);
  if (!await confirmAction('Удалить эту запись ТО?')) return;
  data.toRecords = (data.toRecords || []).filter(r => r.id !== id);
  if (!await saveData(data)) return;
  const g = (data.generators || []).find(x => x.id === selectedGeneratorId);
  if (g) renderGenDetail(g);
}

// ─── GENERATOR FUEL BALANCE ──────────────────────────────
function computeGenFuelBalances(gid) {
  const cacheKey=JSON.stringify([typeof gid,gid]);
  if (Object.prototype.hasOwnProperty.call(_genBalCache,cacheKey)) return _genBalCache[cacheKey];
  const gen  = (data.generators || []).find(g => g.id === gid);
  const recs = genRecsFor(gid).slice().sort((a,b) => cmpDateAsc(a.date, b.date));
  let balance = fuelAccountingOpening('generators',gen);
  const balanceEntries = [];
  recs.forEach(r => {
    if(!fuelAccountingIncludes('generators',gen,r.date))return;
    const spent = genActualSpent(gen, r);
    balance = balance===null||spent===null?null:DecimalCore.toNumberExact(DecimalCore.sub(DecimalCore.add(balance,fqValue(r.fuelIssued)||0),spent));
    balanceEntries.push([r.id,balance]);
  });
  const balMap=TvsFuelEngine.recordBalanceMap(balanceEntries);
  _genBalCache[cacheKey] = balMap;
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
function computeTankBalanceAt(tankId,boundary,inclusive){return tankStockAt(tankId,boundary||dispatcherLocalDate(),inclusive).balance;}

function genRecordTankId(r) {
  return Object.prototype.hasOwnProperty.call(r, 'tankId') ? r.tankId : ((data.generators || []).find(g => g.id === r.generatorId) || {}).tankId ?? null;
}
function genPreserveTankHistory(g) {
  (data.genRecords || []).filter(r => r.generatorId === g.id && !Object.prototype.hasOwnProperty.call(r, 'tankId'))
    .forEach(r => { r.tankId = g.tankId ?? null; });
}

// Баланс генератора без привязанной ёмкости на дату (аналог computeTankBalanceAt)
// Расход топлива (л/час) при заданной нагрузке — линейная интерполяция между
// нормой при 50% и нормой при 100% (кривая расхода дизель-генератора не
// пропорциональна напрямую нагрузке от нуля, поэтому одной нормы100 мало).
function genFuelRate(g, load) {
  const n100=fqValue(g.norm100),power=fqValue(g.power),n50=fqValue(g.norm50),idle=fqValue(g.normIdle);
  if(n100==null||!(power>0)||fqValue(load)==null)return null;
  const loadPct = (Number(load)/power)*100;
  if (n50 != null) {
    if (loadPct <= 50 && idle != null) {
      return Math.max(0,idle+(n50-idle)*loadPct/50);
    }
    return Math.max(0,n50+(n100-n50)*(loadPct-50)/50);
  }
  return Math.max(0,n100*(loadPct/100));
}
function genNormKnown(g,r){return FuelMovementPolicy.generatorNormKnown(g,r);}

// ─── ЕДИНЫЙ РАСЧЁТ РАСХОДА ДЭС ──────────────────────────
// Раньше расход считался в трёх местах по-разному: остаток ёмкости брал
// «выдано», остаток генератора — «факт», а акт на списание пересчитывал норму
// заново и при отсутствии norm100 подставлял «по норме», которое всегда пустое.
// Теперь все места зовут эти две функции.
//
// По норме  — норма при номинальной мощности × моточасы. Сколько ДЭС должен был
//             израсходовать, работая под полной нагрузкой.
// По факту  — норма, пересчитанная под реальную нагрузку, × моточасы. Если в
//             записи проставлен фактический расход вручную, берётся он.
function genNormSpent(g, r) {
  if(typeof FuelMovementPolicy==='undefined')throw Error('Не загружены общие правила расчёта ДЭС');
  return FuelMovementPolicy.generatorNormSpent(g,r);
}

function genActualSpent(g, r) {
  if(typeof FuelMovementPolicy==='undefined')throw Error('Не загружены общие правила расчёта ДЭС');
  return FuelMovementPolicy.generatorSpent(g,r);
}

function computeGenBalanceAt(gid, boundary, inclusive) {
  const g = (data.generators || []).find(x => x.id === gid);
  if (!g) return 0;
  const initial=fuelAccountingOpening('generators',g,boundary);
  if(initial===null)return null;
  const okDate = d => fuelAccountingIncludes('generators',g,d)&&(!boundary || (inclusive ? d <= boundary : d < boundary));
  const recs = (data.genRecords || []).filter(r => r.generatorId === gid && okDate(r.date))
    .slice().sort((a,b) => cmpDateAsc(a.date, b.date));
  let bal = initial;
  recs.forEach(r => { const spent=genActualSpent(g,r);bal=bal===null||spent===null?null:DecimalCore.toNumberExact(DecimalCore.sub(DecimalCore.add(bal,fqValue(r.fuelIssued)||0),spent)); });
  return bal;
}

function genActNormColumn(generator,from,to,field){
  if(!Object.hasOwn(generator,'fuelNorms'))return generator[field]!=null?+generator[field]:'—';
  const starts=[...new Set([from,...generator.fuelNorms.periods.map(period=>period.from).filter(date=>date>from&&date<=to)])].sort();
  const spans=starts.map((date,index)=>{
    const resolved=EffectivePeriods.resolve('generators',generator,date,'fuelNorms');
    return {from:date,to:starts[index+1]?TvsFuelEngine.fqShiftDate(starts[index+1],-1):to,value:resolved.status==='known'?resolved.parameters[field]:null};
  });
  if(spans.every(span=>span.value===spans[0].value))return spans[0].value??'Не задано';
  return spans.map(span=>fmtDate(span.from)+' — '+fmtDate(span.to)+': '+(span.value??'Не задано')).join('\n');
}

function exportGenWriteOffAct(dateFrom,dateTo,opts){return tankStockWithSnapshot(()=>exportGenWriteOffActProjected(dateFrom,dateTo,opts));}
function exportGenWriteOffActProjected(dateFrom, dateTo, opts) {
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
  try{
    const selected=(data.generators||[]).filter(g=>locsToRender.includes((g.location||'').trim()||'— Без местонахождения —'));
    for(const generator of selected){
      fuelAccountingRequireActRange('generators',generator,dateFrom,dateTo);
      if(Object.hasOwn(generator,'fuelNorms')){
        if(!dateFrom||!dateTo||!TvsFuelEngine.gsmValidDate(dateFrom)||!TvsFuelEngine.gsmValidDate(dateTo)||dateFrom>dateTo)throw Error('Для акта с датированными нормами укажите обе корректные даты периода по порядку');
        if(typeof EffectivePeriods==='undefined')throw Error('Не загружены датированные параметры ДЭС');
        EffectivePeriods.validate('generators',generator,'fuelNorms');
        const included=genRecsFor(generator.id).filter(row=>row.date>=dateFrom&&row.date<=dateTo&&fuelAccountingIncludes('generators',generator,row.date));
        if(included.some(row=>genNormSpent(generator,row)===null||genActualSpent(generator,row)===null)||computeGenBalanceAt(generator.id,dateFrom,false)===null||computeGenBalanceAt(generator.id,dateTo,true)===null)throw Error('У ДЭС «'+generator.name+'» есть даты без нормы или расхода. Укажите подтверждённые параметры перед формированием акта.');
      }
    }
    const selectedTankIds=new Set(selected.map(g=>g.tankId).filter(id=>id!=null&&id!==''));
    for(const tank of tanksAll().filter(tank=>selectedTankIds.has(tank.id)))fuelAccountingRequireActRange('tanks',tank,dateFrom,dateTo);
  }catch(error){alert(error.message);return false;}

  const P = { navy:'1B3A6B', navyMid:'2D5A8E', navyLight:'D6E4F7', white:'FFFFFF',
    gray1:'F8FAFC', gray2:'F1F5F9', gray3:'E2E8F0', gray4:'94A3B8', text:'1E293B', green:'16A34A', red:'DC2626' };
  const bAll = (st, rgb) => { const b = { style:st, color:{rgb} }; return { top:b, bottom:b, left:b, right:b }; };
  const cs = (font, fill, align, border) => ({ font:font||{}, fill:fill?{patternType:'solid',fgColor:{rgb:fill}}:{patternType:'none'}, alignment:align||{vertical:'center'}, border:border||{} });
  const NC = 12;   // добавлена колонка «Остаток в баке ДЭС»
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
  const num = (x, d) => DecimalCore.toNumberExact(d==null?DecimalCore.parse(x??0):DecimalCore.quantize(x??0,{scale:d,rounding:'half-away-from-zero'}));
  const sum = values => DecimalCore.toNumberExact(DecimalCore.sum(values));
  const add = (a,b) => DecimalCore.toNumberExact(DecimalCore.add(a,b));

  let rendered = false;

  locsToRender.forEach((loc, li) => {
    const gens = (data.generators || []).filter(g => (((g.location||'').trim()) || '— Без местонахождения —') === loc)
      .sort((a,b) => (a.name||'').toLowerCase() < (b.name||'').toLowerCase() ? -1 : 1);
    if (!gens.length) return;
    rendered = true;
    const linkedTanks = [...new Set(gens.map(g => g.tankId).filter(id=>id!=null&&id!==''))];
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
    put(n,0,'ЧЕРНОВИК · По текущим данным · Не проведённый документ',ST.title); merge(n,0,n,NC); fillRow(n,ST.title); rowH(n,20); n++;
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
    vh(11,'Остаток в баке ДЭС, л');
    vh(12,'Остаток на конец мес., л');
    rowH(h1,16); rowH(h2,26); n += 2;

    let tHours=0, tNorm=0, tAct=0, tBak=0, i=0;
    gens.forEach(g => {
      const recs = genRecsFor(g.id).filter(inPeriod).filter(row=>fuelAccountingIncludes('generators',g,row.date)).slice().sort((a,b)=>cmpDateAsc(a.date, b.date));
      const hours = sum(recs.map(r=>r.hours||0));
      const explicit=fuelAccountingFor('generators',g).mode==='explicit';
      const meterStart = recs.length ? (recs[0].meterStart!=null?recs[0].meterStart:explicit?'':(g.hoursInit!=null?g.hoursInit:'')) : (explicit?'':g.hoursInit!=null?g.hoursInit:'');
      const meterEnd = recs.length ? (recs[recs.length-1].meterEnd!=null?recs[recs.length-1].meterEnd:'') : '';
      const loadHours = recs.reduce((s,r)=>s+((r.load!=null?r.load:0)*(r.hours||0)),0);
      const loadAvg = hours>0 && loadHours>0 ? loadHours/hours : null;
      // «По норме» — паспортная норма при номинальной мощности × моточасы.
      // Раньше здесь норма пересчитывалась под фактическую нагрузку: у ДЭС,
      // работающих на 10% мощности, «норма» падала ниже реального расхода,
      // и в акте везде получался перерасход, хотя на деле экономия.
      const normSpent = sum(recs.map(r=>genNormSpent(g,r)));
      const actSpent  = sum(recs.map(r=>genActualSpent(g,r)));
      // Остаток в баке самого ДЭС: начальный + выдано − израсходовано.
      const bakKon = computeGenBalanceAt(g.id, dateTo, true);
      tBak = add(tBak,bakKon);
      // Остаток по строке: то, что в ёмкости, плюс то, что уже залито в бак этой машины.
      // У ДЭС без привязанной ёмкости весь остаток и так лежит в баке.
      const ostTank = g.tankId!=null&&g.tankId!=='' ? computeTankBalanceAt(g.tankId, dateTo, true) : 0;
      const ostKon = add(ostTank,bakKon);
      const bg = i%2===0?P.white:P.gray1; i++;
      tHours=add(tHours,hours); tNorm=add(tNorm,normSpent); tAct=add(tAct,actSpent);
      const nameCell = g.name + (g.serial ? ', ' + g.serial : '')+(explicit?' · учёт ГСМ с '+fuelAccountingFor('generators',g).from:'');
      put(n,0,nameCell,ST.tdL(bg));
      put(n,1,fuelLabels[g.fuel||'diesel'],ST.tdC(bg));
      put(n,2,'л',ST.tdC(bg));
      put(n,3,num(hours),ST.tdC(bg));
      put(n,4,meterStart===''?'—':+meterStart,ST.tdR(bg));
      put(n,5,meterEnd===''?'—':+meterEnd,ST.tdR(bg));
      put(n,6,loadAvg!=null?num(loadAvg,1):'—',ST.tdC(bg));
      const printedNorm100=genActNormColumn(g,dateFrom,dateTo,'norm100'),printedNorm50=genActNormColumn(g,dateFrom,dateTo,'norm50');
      put(n,7,printedNorm100,ST.tdC(bg));
      put(n,8,printedNorm50,ST.tdC(bg));
      put(n,9,num(normSpent),ST.tdR(bg));
      put(n,10,num(actSpent),ST.tdR(bg));
      put(n,11,num(bakKon),ST.tdR(bg));
      put(n,12,num(ostKon),ST.tdR(bg));
      rowH(n,Math.max(18,...[printedNorm100,printedNorm50].map(value=>String(value).split('\n').length*24))); n++;
    });
    // ИТОГО
    put(n,0,'ИТОГО',ST.totL); merge(n,0,n,2); fillRow(n,ST.totL);
    put(n,3,num(tHours),ST.tot); put(n,4,'',ST.tot); put(n,5,'',ST.tot); put(n,6,'',ST.tot); put(n,7,'',ST.tot); put(n,8,'',ST.tot);
    put(n,9,num(tNorm),ST.tot); put(n,10,num(tAct),ST.tot);
    put(n,11, num(tBak), ST.tot);
    // Итог: ёмкости считаем по разу, баки — по всем машинам
    put(n,12, add(sum(linkedTanks.map(id=>computeTankBalanceAt(id,dateTo,true))),tBak), ST.tot);
    rowH(n,20); n++;
    put(n,0,'',ST.sp); merge(n,0,n,NC); rowH(n,6); n++;

    // The same signed source projection feeds the balance and its breakdown.
    // Reversals remain separate opposite entries; internal transfers net to 0.
    const incomes = DomainSources.projectTankFlows(data,linkedTanks,{from:dateFrom,to:dateTo,accounting:true});
    put(n,0,'Приход и движения топлива за отчётный период',ST.totL); merge(n,0,n,NC); fillRow(n,ST.totL); rowH(n,18); n++;
    put(n,0,'Дата операции',ST.head); merge(n,0,n,1); put(n,2,'Изменение, л',ST.head); merge(n,2,n,3); put(n,4,'Источник / основание',ST.head); merge(n,4,n,NC); rowH(n,16); n++;
    if (incomes.length) {
      incomes.forEach((r,k)=>{ const bg=k%2===0?P.white:P.gray1; put(n,0,fmtDate(r.date),ST.tdC(bg)); merge(n,0,n,1); put(n,2,num(r.amount),ST.tdR(bg)); merge(n,2,n,3); put(n,4,[r.sourceSection==='tankIncomes'?'Журнал ёмкости':'Движение топлива',r.sourceId,r.originalMovementId?'Сторно '+r.originalMovementId:'',r.reason].filter(Boolean).join(' · '),ST.tdL(bg)); merge(n,4,n,NC); rowH(n,28); n++; });
    } else { put(n,0,'Нет прихода и движений за период',ST.tdC(P.white)); merge(n,0,n,NC); rowH(n,16); n++; }
    // Остаток ДТ
    // Остаток = топливо в ёмкостях плюс топливо в баках самих ДЭС.
    // Баки берём по всем машинам, а не только по тем, что без ёмкости.
    const allGenIds = gens.map(g => g.id);
    const ostNach = sum([...linkedTanks.map(id=>computeTankBalanceAt(id,dateFrom,false)),...allGenIds.map(id=>computeGenBalanceAt(id,dateFrom,false))]);
    const ostKonAll = sum([...linkedTanks.map(id=>computeTankBalanceAt(id,dateTo,true)),...allGenIds.map(id=>computeGenBalanceAt(id,dateTo,true))]);
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

  ws['!cols'] = [{wch:30},{wch:16},{wch:7},{wch:11},{wch:12},{wch:12},{wch:11},{wch:9},{wch:9},{wch:11},{wch:11},{wch:13},{wch:14}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Акт списания ГСМ ДЭС');
  const d = new Date();
  const ds = `${d.getDate().toString().padStart(2,'0')}.${(d.getMonth()+1).toString().padStart(2,'0')}.${d.getFullYear()}`;
  const suffix = (opts.loc && opts.loc!=='__ALL__') ? '_'+opts.loc.replace(/[^\wА-Яа-яЁё]+/g,'').slice(0,20) : '_все';
  XLSX.writeFile(wb, `Черновик_Акт_ГСМ_ДЭС${suffix}_${ds}.xlsx`);
}

