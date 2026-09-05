// График ТО — отдельная вкладка
// Выделено из index.html

// ═══════════════════════════════════════════════════════
// ГРАФИК ТО — ОТДЕЛЬНАЯ ВКЛАДКА
// ═══════════════════════════════════════════════════════
let tssMonth = new Date().getMonth() + 1;
let tssYear  = new Date().getFullYear();
let tssFilter = 'all'; // 'all' | 'vehicle' | 'generator'
let tssEditingId = null;
let tssEditingSource = null; // 'vehicleTo' | 'toRecords' | null

function tssGetAllRecords() {
  const vRecs = (data.vehicleTo || []).map(r => {
    const v = (data.vehicles || []).find(x => x.id === r.vehicleId);
    return {
      ...r,
      source: 'vehicleTo',
      objType: 'vehicle',
      objName: v ? `${v.plate} — ${v.make}` : '(удалён)',
      objId: r.vehicleId,
      meter: r.odometer,
      meterUnit: 'км',
    };
  });
  const gRecs = (data.toRecords || []).map(r => {
    const g = (data.generators || []).find(x => x.id === r.generatorId);
    return {
      ...r,
      source: 'toRecords',
      objType: 'generator',
      objName: g ? `${g.name}${g.location ? ' — '+g.location : ''}` : '(удалён)',
      objId: r.generatorId,
      meter: r.hours,
      meterUnit: 'мтч',
    };
  });
  let all = [...vRecs, ...gRecs];
  if (tssFilter === 'vehicle')   all = all.filter(r => r.objType === 'vehicle');
  if (tssFilter === 'generator') all = all.filter(r => r.objType === 'generator');
  return all;
}

function tssGetMonths() {
  const all = tssGetAllRecords();
  const set = new Set();
  all.forEach(r => {
    const d = new Date(r.date);
    if (!isNaN(d)) set.add(`${d.getFullYear()}-${d.getMonth()+1}`);
  });
  const now = new Date();
  set.add(`${now.getFullYear()}-${now.getMonth()+1}`);
  return [...set].map(s => { const [y,m] = s.split('-').map(Number); return {year:y, month:m}; })
    .sort((a,b) => a.year - b.year || a.month - b.month);
}

function renderToScheduleSection() {
  const mc = document.getElementById('mainContent');
  const all = tssGetAllRecords();
  const monthRecs = all.filter(r => {
    const d = new Date(r.date);
    return d.getFullYear() === tssYear && (d.getMonth()+1) === tssMonth;
  }).sort((a, b) => cmpDateAsc(a.date, b.date));

  const months = tssGetMonths();
  let monthTabsHtml = '';
  const years = [...new Set(months.map(m => m.year))];
  years.forEach(yr => {
    monthTabsHtml += `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
      <span class="year-label">${yr}</span>`;
    months.filter(m => m.year === yr).forEach(m => {
      const active = m.year === tssYear && m.month === tssMonth;
      monthTabsHtml += `<div class="month-tab ${active ? 'active' : ''}" onclick="tssSelectMonth(${m.year},${m.month})">${MONTHS_SHORT[m.month-1]}</div>`;
    });
    monthTabsHtml += `</div>`;
  });

  const totalCost = monthRecs.reduce((s,r) => s + (r.cost || 0), 0);
  const vCount = monthRecs.filter(r => r.objType === 'vehicle').length;
  const gCount = monthRecs.filter(r => r.objType === 'generator').length;

  let rows = '';
  if (!monthRecs.length) {
    rows = `<tr><td colspan="8" class="empty-table">Нет записей ТО за этот месяц. Нажмите «+ Запись ТО» чтобы добавить.</td></tr>`;
  } else {
    monthRecs.forEach(r => {
      const icon = r.objType === 'vehicle'
        ? `<svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:4px"><path d="M1 17l2-6h18l2 6"/><circle cx="7" cy="18.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="17" cy="18.5" r="1.5" fill="currentColor" stroke="none"/></svg>`
        : `<svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:4px"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M12 12v4m-2-2h4"/></svg>`;
      rows += `<tr>
        <td class="td-day">${fmtDate(r.date)}</td>
        <td style="padding:10px 14px;font-size:13px">${icon}${r.objName}</td>
        <td style="padding:10px 14px;font-size:13px;font-weight:600">${r.type || '—'}</td>
        <td class="td-num">${r.meter != null ? r.meter.toLocaleString('ru',{maximumFractionDigits:1})+' '+r.meterUnit : '—'}</td>
        <td class="td-num">${r.cost != null ? r.cost.toLocaleString('ru-RU')+' ₽' : '—'}</td>
        <td style="padding:10px 14px;font-size:13px;color:var(--text2)">${r.performer || '—'}</td>
        <td style="padding:10px 14px;font-size:13px;color:var(--text2);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.note || '—'}</td>
        <td class="td-actions">
          <button class="icon-btn" onclick="tssEditRecord('${r.id}','${r.source}')">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="icon-btn del" onclick="if(confirm('Удалить запись ТО?'))tssDeleteDirect('${r.id}','${r.source}')">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
          </button>
        </td>
      </tr>`;
    });
  }

  mc.innerHTML = `
    <div style="padding:28px;max-width:1200px;margin:0 auto;overflow-y:auto;height:100%">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:18px">
        <svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" style="color:var(--accent)"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>
        <div>
          <h2 style="margin:0;font-size:20px;font-weight:700">График ТО</h2>
          <p style="margin:2px 0 0;color:var(--text3);font-size:13px">Техническое обслуживание транспорта и ДЭС</p>
        </div>
      </div>

      <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;align-items:center">
        <button class="btn btn-ghost btn-sm ${tssFilter==='all'?'active':''}" onclick="tssSetFilter('all')" style="${tssFilter==='all'?'background:var(--accent);color:#fff':''}">Все</button>
        <button class="btn btn-ghost btn-sm ${tssFilter==='vehicle'?'active':''}" onclick="tssSetFilter('vehicle')" style="${tssFilter==='vehicle'?'background:var(--accent);color:#fff':''}">Транспорт</button>
        <button class="btn btn-ghost btn-sm ${tssFilter==='generator'?'active':''}" onclick="tssSetFilter('generator')" style="${tssFilter==='generator'?'background:var(--accent);color:#fff':''}">ДЭС</button>
        <div style="flex:1"></div>
        <button class="btn btn-ghost btn-sm" onclick="tssExportExcel()">
          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Excel
        </button>
        <button class="btn btn-primary btn-sm" onclick="tssOpenAdd()">
          <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          + Запись ТО
        </button>
      </div>

      <div class="month-tabs" style="margin-bottom:14px">${monthTabsHtml}</div>

      <div class="table-wrap">
        <div class="table-toolbar">
          <div class="table-toolbar-left">
            ${MONTHS_RU[tssMonth-1]} ${tssYear}
            <span style="color:var(--text3);font-weight:400;font-size:12px;margin-left:10px">${monthRecs.length} записей · ТС: ${vCount} · ДЭС: ${gCount}${totalCost > 0 ? ' · '+totalCost.toLocaleString('ru-RU')+' ₽' : ''}</span>
          </div>
        </div>
        <div class="table-scroll">
          <table>
            <thead><tr>
              <th>Дата</th><th>Объект</th><th>Вид ТО</th><th>Пробег / мтч</th>
              <th>Стоимость</th><th>Исполнитель</th><th>Примечание</th><th></th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function tssSelectMonth(y, m) { tssYear = y; tssMonth = m; renderToScheduleSection(); }
function tssSetFilter(f) { tssFilter = f; renderToScheduleSection(); }

function tssObjTypeChanged() {
  const type = document.getElementById('tss_obj_type').value;
  const sel = document.getElementById('tss_obj_id');
  const label = document.getElementById('tss_odo_label');
  if (type === 'vehicle') {
    sel.innerHTML = (data.vehicles || []).slice().sort((a,b) => (a.plate||'').localeCompare(b.plate||''))
      .map(v => `<option value="${v.id}">${v.plate} — ${v.make}</option>`).join('');
    label.textContent = 'Пробег (км)';
    document.getElementById('tss_odometer').placeholder = '0';
  } else {
    sel.innerHTML = (data.generators || []).slice().sort((a,b) => (a.name||'').localeCompare(b.name||''))
      .map(g => `<option value="${g.id}">${g.name}${g.location ? ' — '+g.location : ''}</option>`).join('');
    label.textContent = 'Моточасы';
    document.getElementById('tss_odometer').placeholder = '0';
  }
}

function tssOpenAdd() {
  tssEditingId = null;
  tssEditingSource = null;
  document.getElementById('toScheduleModalTitle').textContent = 'Добавить запись ТО';
  document.getElementById('tssDeleteBtn').style.display = 'none';
  const now = new Date();
  document.getElementById('tss_date').value = fmtDate(now.toISOString().split('T')[0]);
  ['tss_type','tss_performer','tss_note'].forEach(id => document.getElementById(id).value = '');
  ['tss_odometer','tss_cost'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('tss_obj_type').value = tssFilter === 'generator' ? 'generator' : 'vehicle';
  tssObjTypeChanged();
  openModal('toScheduleModal');
}

function tssEditRecord(id, source) {
  tssEditingId = id;
  tssEditingSource = source;
  document.getElementById('toScheduleModalTitle').textContent = 'Редактировать запись ТО';
  document.getElementById('tssDeleteBtn').style.display = '';
  if (source === 'vehicleTo') {
    const r = (data.vehicleTo || []).find(x => x.id === id);
    if (!r) return;
    document.getElementById('tss_obj_type').value = 'vehicle';
    tssObjTypeChanged();
    document.getElementById('tss_obj_id').value = r.vehicleId;
    document.getElementById('tss_date').value = fmtDate(r.date);
    document.getElementById('tss_type').value = r.type || '';
    document.getElementById('tss_odometer').value = r.odometer ?? '';
    document.getElementById('tss_cost').value = r.cost ?? '';
    document.getElementById('tss_performer').value = r.performer || '';
    document.getElementById('tss_note').value = r.note || '';
  } else {
    const r = (data.toRecords || []).find(x => x.id === id);
    if (!r) return;
    document.getElementById('tss_obj_type').value = 'generator';
    tssObjTypeChanged();
    document.getElementById('tss_obj_id').value = r.generatorId;
    document.getElementById('tss_date').value = fmtDate(r.date);
    document.getElementById('tss_type').value = r.type || '';
    document.getElementById('tss_odometer').value = r.hours ?? '';
    document.getElementById('tss_cost').value = r.cost ?? '';
    document.getElementById('tss_performer').value = r.performer || '';
    document.getElementById('tss_note').value = r.note || '';
  }
  openModal('toScheduleModal');
}

function tssSaveRecord() {
  const dateIso = parseDate(document.getElementById('tss_date').value.trim());
  const type = document.getElementById('tss_type').value.trim();
  if (!dateIso) { showFieldError('Укажите дату', 'tss_date'); return; }
  if (!type) { showFieldError('Укажите вид ТО', 'tss_type'); return; }
  const objType = document.getElementById('tss_obj_type').value;
  const objId = document.getElementById('tss_obj_id').value;
  if (!objId) { showFieldError('Выберите объект', 'tss_obj_id'); return; }
  const meter = parseFloat(document.getElementById('tss_odometer').value);
  const cost = parseFloat(document.getElementById('tss_cost').value) || null;
  const performer = document.getElementById('tss_performer').value.trim();
  const note = document.getElementById('tss_note').value.trim();

  if (objType === 'vehicle') {
    const obj = {
      vehicleId: objId, date: dateIso, type,
      odometer: !isNaN(meter) ? meter : null,
      nextKm: null, nextOdometerAbs: null, nextDate: null,
      cost, performer, note,
    };
    if (!data.vehicleTo) data.vehicleTo = [];
    if (tssEditingId && tssEditingSource === 'vehicleTo') {
      Object.assign(data.vehicleTo.find(x => x.id === tssEditingId), obj);
    } else {
      obj.id = 'vto_' + Date.now();
      data.vehicleTo.push(obj);
    }
  } else {
    const obj = {
      generatorId: objId, date: dateIso, type,
      hours: !isNaN(meter) ? +meter : null,
      nextHours: null, nextHoursAbs: null, nextDate: null,
      cost, performer, note,
    };
    if (!data.toRecords) data.toRecords = [];
    if (tssEditingId && tssEditingSource === 'toRecords') {
      Object.assign(data.toRecords.find(x => x.id === tssEditingId), obj);
    } else {
      obj.id = 'to_' + Date.now();
      data.toRecords.push(obj);
    }
  }
  saveData(data);
  closeModal('toScheduleModal');
  renderToScheduleSection();
}

function tssDeleteRecord() {
  if (!confirm('Удалить эту запись ТО?')) return;
  tssDeleteDirect(tssEditingId, tssEditingSource);
  closeModal('toScheduleModal');
}

function tssDeleteDirect(id, source) {
  if (!id) return;
  if (source === 'vehicleTo') {
    data.vehicleTo = (data.vehicleTo || []).filter(r => r.id !== id);
  } else {
    data.toRecords = (data.toRecords || []).filter(r => r.id !== id);
  }
  saveData(data);
  if (activeSection === 'toSchedule') renderToScheduleSection();
}

function tssExportExcel() {
  if (typeof XLSX === 'undefined') { alert('Библиотека XLSX не загружена'); return; }
  const all = tssGetAllRecords();
  const monthRecs = all.filter(r => {
    const d = new Date(r.date);
    return d.getFullYear() === tssYear && (d.getMonth()+1) === tssMonth;
  }).sort((a, b) => cmpDateAsc(a.date, b.date));

  const header = ['Дата', 'Тип', 'Объект', 'Вид ТО', 'Пробег/Моточасы', 'Ед.', 'Стоимость, руб.', 'Исполнитель', 'Примечание'];
  const rows = monthRecs.map(r => [
    fmtDate(r.date),
    r.objType === 'vehicle' ? 'ТС' : 'ДЭС',
    r.objName,
    r.type || '',
    r.meter != null ? r.meter : '',
    r.meterUnit,
    r.cost || '',
    r.performer || '',
    r.note || '',
  ]);

  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws['!cols'] = [{wch:12},{wch:6},{wch:30},{wch:18},{wch:14},{wch:6},{wch:14},{wch:24},{wch:30}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'График ТО');
  XLSX.writeFile(wb, `График_ТО_${MONTHS_RU[tssMonth-1]}_${tssYear}.xlsx`);
}

function renderReestrSection() {
  loadReestrStatyi();
  const mc = document.getElementById('mainContent');
  mc.innerHTML = `
    <div style="padding:28px;max-width:1100px;margin:0 auto;overflow-y:auto;height:100%">
      <h2 style="font-size:22px;font-weight:700;margin:0 0 4px;display:flex;align-items:center;gap:8px">
        <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="var(--accent)" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        Реестр-Билдер
      </h2>
      <p style="color:var(--text2);margin:0 0 20px;font-size:13px">Собирает реестр на оплату из архива со счетами и УПД</p>

      <!-- Шаг 1: Загрузка -->
      <div id="reestrUpload" style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:20px;margin-bottom:16px">
        <div id="reestrDropzone" style="border:2px dashed var(--border);border-radius:10px;padding:32px 20px;text-align:center;cursor:pointer;transition:border-color .15s,background .15s">
          <div style="font-size:28px;margin-bottom:6px">📦</div>
          <div style="font-size:14px;font-weight:600">Перетащите сюда файлы со счетами</div>
          <div style="font-size:12px;color:var(--text3);margin-top:4px">ZIP, PDF, JPG, PNG, TIFF, BMP — можно несколько</div>
          <input type="file" id="reestrFileInput" accept=".zip,.pdf,.jpg,.jpeg,.png,.tif,.tiff,.bmp" multiple style="display:none">
        </div>
        <div id="reestrFileChips" style="display:flex;flex-direction:column;gap:6px;margin-top:12px"></div>
        <button class="btn btn-primary" id="reestrParseBtn" disabled style="width:100%;margin-top:14px;justify-content:center">
          <span class="reestr-spinner" style="display:none;width:14px;height:14px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite"></span>
          <span id="reestrParseBtnLabel">Распознать счета</span>
        </button>
        <div id="reestrProgressWrap" style="display:none;margin-top:10px">
          <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-secondary);margin-bottom:4px">
            <span id="reestrProgressFile"></span>
            <span id="reestrProgressCount"></span>
          </div>
          <div style="height:6px;border-radius:3px;background:var(--surface-alt);overflow:hidden">
            <div id="reestrProgressBar" style="height:100%;border-radius:3px;background:var(--primary);transition:width .3s;width:0%"></div>
          </div>
        </div>
        <button class="btn btn-ghost" id="reestrOpenWindowBtn" style="display:none;width:100%;margin-top:8px;justify-content:center">Открыть реестр</button>
        <div id="reestrError" style="display:none;border:1px solid var(--red);background:color-mix(in srgb,var(--red) 8%,transparent);color:var(--red);border-radius:8px;padding:10px 12px;font-size:13px;margin-top:12px"></div>
      </div>

      <!-- Сохранённые реестры -->
      <div id="reestrSavedCard" style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:20px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h3 style="margin:0;font-size:15px;font-weight:700;display:flex;align-items:center;gap:6px">
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="var(--accent)" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            Сохранённые реестры
          </h3>
          <span id="reestrSavedCount" style="font-size:12px;color:var(--text3)"></span>
        </div>
        <div id="reestrSavedList"></div>
        <div id="reestrSavedEmpty" style="text-align:center;padding:16px 0;color:var(--text3);font-size:13px">
          Нет сохранённых реестров
        </div>
      </div>

      <!-- Лог -->
      <div id="reestrLogCard" style="display:none;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:20px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px;flex-wrap:wrap;gap:6px">
          <span id="reestrSummaryCount" style="font-size:16px;font-weight:700">—</span>
          <span id="reestrSummaryAmount" style="font-size:13px;color:var(--text2)"></span>
        </div>
        <div id="reestrLog" style="max-height:180px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;font-family:ui-monospace,monospace;font-size:12px"></div>
      </div>

      <!-- Шаг 2: Таблица -->
      <div id="reestrReviewCard" style="display:none;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:20px;margin-bottom:16px">
        <h3 style="margin:0 0 4px;font-size:16px;font-weight:700">Проверка и выбор статей</h3>
        <p style="color:var(--text3);font-size:12px;margin:0 0 14px">Проверьте распознанные данные. Измените статью БДДС в выпадающем списке, если нужно.</p>
        <div style="overflow-x:auto;border:1px solid var(--border);border-radius:8px">
          <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:700px">
            <thead><tr style="background:var(--accent);color:#fff">
              <th style="padding:8px;text-align:left;font-weight:600">№</th>
              <th style="padding:8px;text-align:left;font-weight:600">Сумма</th>
              <th style="padding:8px;text-align:left;font-weight:600">Описание</th>
              <th style="padding:8px;text-align:left;font-weight:600">Объект</th>
              <th style="padding:8px;text-align:left;font-weight:600">Номер ТС</th>
              <th style="padding:8px;text-align:left;font-weight:600">Статья БДДС</th>
              <th style="padding:8px;width:36px" title="В журнал ремонта"></th>
              <th style="padding:8px;width:36px"></th>
            </tr></thead>
            <tbody id="reestrReviewBody"></tbody>
          </table>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:baseline;padding:10px 0 0;font-size:14px;font-weight:700">
          <span style="color:var(--text2)">Итого:</span>
          <span id="reestrReviewTotal">0,00 руб.</span>
        </div>
        <div style="display:flex;gap:10px;margin-top:14px">
          <button class="btn btn-ghost" id="reestrAddRowBtn" style="flex:1;justify-content:center">+ Добавить строку</button>
          <button class="btn btn-ghost" id="reestrSaveBtn" style="flex:0;justify-content:center">💾 Сохранить</button>
          <button class="btn btn-ghost" id="reestrAnalyticsBtn" style="flex:0;justify-content:center" onclick="reestrShowAnalytics()">Аналитика</button>
          <button class="btn btn-ghost" id="reestrBackBtn" style="flex:0;justify-content:center">← Назад</button>
          <button class="btn btn-primary" id="reestrBuildBtn" style="flex:1;justify-content:center">
            <span class="reestr-spinner" style="display:none;width:14px;height:14px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite"></span>
            <span id="reestrBuildBtnLabel">Сформировать реестр</span>
          </button>
        </div>
      </div>

      <!-- Шаг 3: Готово -->
      <div id="reestrDoneCard" style="display:none;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:20px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px">
          <span id="reestrDoneCount" style="font-size:16px;font-weight:700">—</span>
          <span id="reestrDoneAmount" style="font-size:13px;color:var(--text2)"></span>
        </div>
        <button class="btn btn-primary" id="reestrDownloadBtn" style="width:100%;justify-content:center">⬇ Скачать реестр.xlsx</button>
      </div>

      <p style="color:var(--text3);font-size:11px;text-align:center;margin-top:20px">
        Правила определения объектов и категорий — в файле <code style="background:var(--bg3);padding:1px 5px;border-radius:4px">config.json</code>.
        Справочник статей БДДС: <span id="reestrStatyiCount">...</span> статей.
      </p>
    </div>`;

  reestrBindEvents();
  if (reestrStatyi.length) {
    const el = document.getElementById('reestrStatyiCount');
    if (el) el.textContent = reestrStatyi.length;
  }
  if (reestrRows.length > 0) {
    document.getElementById('reestrOpenWindowBtn').style.display = '';
  }
}

function reestrBindEvents() {
  const dropzone = document.getElementById('reestrDropzone');
  const fileInput = document.getElementById('reestrFileInput');
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => { reestrAddFiles(e.target.files); fileInput.value = ''; });
  ['dragenter','dragover'].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.style.borderColor = 'var(--accent)'; dropzone.style.background = 'color-mix(in srgb, var(--accent) 6%, transparent)'; }));
  ['dragleave','drop'].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.style.borderColor = ''; dropzone.style.background = ''; }));
  dropzone.addEventListener('drop', e => reestrAddFiles(e.dataTransfer.files));
  document.getElementById('reestrParseBtn').addEventListener('click', reestrParse);
  document.getElementById('reestrOpenWindowBtn').addEventListener('click', async () => {
    if (reestrRows.length > 0) {
      await loadReestrStatyi();
      await loadReestrContracts();
      await window.electronAPI.openReestrWindow({ rows: reestrRows, log: [], statyi: reestrStatyi, contracts: reestrContracts, vehicles: data.vehicles || [] });
    }
  });
  document.getElementById('reestrAddRowBtn').addEventListener('click', () => {
    reestrRows.push({ sum:0, date:new Date().toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'}), category:'', description:'', razdel:'', naz:'', obj:'', dog:'', osn:'', updLabel:'', 'statья':'', sourceFolder:'вручную' });
    data.reestrRows = reestrRows;
    saveData(data);
    reestrRenderTable();
  });
  document.getElementById('reestrBackBtn').addEventListener('click', () => {
    document.getElementById('reestrReviewCard').style.display = 'none';
    document.getElementById('reestrDoneCard').style.display = 'none';
    document.getElementById('reestrLogCard').style.display = 'none';
    reestrRows = [];
  });
  document.getElementById('reestrSaveBtn').addEventListener('click', reestrSaveCurrent);
  document.getElementById('reestrBuildBtn').addEventListener('click', reestrBuild);
  document.getElementById('reestrDownloadBtn').addEventListener('click', reestrDownload);
  reestrRenderSavedList();
}

const REESTR_IMG_EXTS = ['jpg','jpeg','png','tif','tiff','bmp'];
function reestrAddFiles(fileList) {
  for (const file of fileList) {
    const ext = file.name.toLowerCase().split('.').pop();
    const type = ext === 'zip' ? 'zip' : ext === 'pdf' ? 'pdf' : REESTR_IMG_EXTS.includes(ext) ? 'img' : null;
    if (!type) continue;
    if (type === 'zip' && reestrFiles.some(f => f.type === 'zip')) continue;
    if (reestrFiles.some(f => f.file.name === file.name && f.file.size === file.size)) continue;
    reestrFiles.push({ file, type });
  }
  reestrRenderChips();
  document.getElementById('reestrParseBtn').disabled = reestrFiles.length === 0;
}

function reestrRenderChips() {
  const el = document.getElementById('reestrFileChips');
  el.innerHTML = '';
  reestrFiles.forEach((f, i) => {
    const chip = document.createElement('div');
    chip.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 12px;border:1px solid var(--border);border-radius:8px;font-size:12px';
    const icon = f.type === 'zip' ? '📦' : f.type === 'img' ? '🖼' : '📄';
    const color = f.type === 'zip' ? 'var(--accent)' : f.type === 'img' ? 'var(--yellow)' : 'var(--green)';
    const label = f.type === 'img' ? f.file.name.split('.').pop().toUpperCase() : f.type.toUpperCase();
    chip.innerHTML = `<span>${icon}</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.file.name}</span><span style="font-size:10px;padding:1px 6px;border-radius:4px;font-weight:600;background:${color};color:#fff">${label}</span><span style="cursor:pointer;color:var(--text3)" onclick="reestrRemoveFile(${i})">✕</span>`;
    el.appendChild(chip);
  });
}

function reestrRemoveFile(i) {
  reestrFiles.splice(i, 1);
  reestrRenderChips();
  document.getElementById('reestrParseBtn').disabled = reestrFiles.length === 0;
}

async function reestrParse() {
  if (!reestrFiles.length) return;
  const errorEl = document.getElementById('reestrError');
  errorEl.style.display = 'none';
  document.getElementById('reestrLogCard').style.display = 'none';
  document.getElementById('reestrReviewCard').style.display = 'none';
  document.getElementById('reestrDoneCard').style.display = 'none';
  const btn = document.getElementById('reestrParseBtn');
  btn.disabled = true;
  btn.querySelector('.reestr-spinner').style.display = 'inline-block';
  document.getElementById('reestrParseBtnLabel').textContent = 'Распознаю…';
  const progressWrap = document.getElementById('reestrProgressWrap');
  const progressBar = document.getElementById('reestrProgressBar');
  const progressFile = document.getElementById('reestrProgressFile');
  const progressCount = document.getElementById('reestrProgressCount');
  progressWrap.style.display = 'none';
  window.reestrAPI.onProgress(({ current, total, fileName }) => {
    progressWrap.style.display = '';
    progressBar.style.width = Math.round((current / total) * 100) + '%';
    const shortName = fileName.length > 40 ? fileName.slice(0, 37) + '…' : fileName;
    progressFile.textContent = shortName;
    progressCount.textContent = current + ' / ' + total;
    document.getElementById('reestrParseBtnLabel').textContent = 'Распознаю ' + current + '/' + total + '…';
  });
  window.reestrAPI.onOcrPage(({ page, totalPages }) => {
    progressWrap.style.display = '';
    progressFile.textContent = 'OCR стр. ' + page + ' / ' + totalPages;
    progressBar.style.width = Math.round((page / totalPages) * 100) + '%';
    document.getElementById('reestrParseBtnLabel').textContent = 'OCR стр. ' + page + '/' + totalPages + '…';
  });
  try {
    const zipFiles = reestrFiles.filter(f => f.type === 'zip');
    const pdfFiles = reestrFiles.filter(f => f.type === 'pdf');
    const imgFiles = reestrFiles.filter(f => f.type === 'img');
    let allRows = [], allLog = [];
    if (zipFiles.length > 0) {
      const ab = await zipFiles[0].file.arrayBuffer();
      const d = await window.reestrAPI.parseInvoices(ab);
      allRows.push(...d.rows); allLog.push(...d.log);
    }
    if (pdfFiles.length > 0 || imgFiles.length > 0) {
      const payload = [];
      for (const pf of pdfFiles) { payload.push({ name: pf.file.name, buffer: await pf.file.arrayBuffer() }); }
      for (const im of imgFiles) { payload.push({ name: im.file.name, buffer: await im.file.arrayBuffer() }); }
      const d = await window.reestrAPI.parsePdfs(payload);
      allRows.push(...d.rows); allLog.push(...d.log);
    }
    // Применяем базу знаний: автозаполнение + поиск дубликатов
    if (window.reestrAPI.applyKnowledge) {
      try {
        const kbResult = await window.reestrAPI.applyKnowledge(allRows);
        allRows = kbResult.rows;
        if (kbResult.duplicates && kbResult.duplicates.length) {
          reestrDuplicates = kbResult.duplicates;
          allLog.push({ type: 'warn', text: `Найдено возможных дубликатов: ${kbResult.duplicates.length}` });
        }
        const autoFilled = allRows.filter(r => r._knownContractor).length;
        if (autoFilled > 0) {
          allLog.push({ type: 'info', text: `Автозаполнение из истории: ${autoFilled} строк` });
        }
      } catch {}
    }
    reestrRows = allRows;
    data.reestrRows = reestrRows;
    saveData(data);
    if (reestrRows.length > 0) {
      await loadReestrStatyi();
      await loadReestrContracts();
      document.getElementById('reestrOpenWindowBtn').style.display = '';
      await window.electronAPI.openReestrWindow({ rows: reestrRows, log: allLog, statyi: reestrStatyi, contracts: reestrContracts, vehicles: data.vehicles || [] });
    } else {
      document.getElementById('reestrOpenWindowBtn').style.display = 'none';
      reestrRenderLog(allLog);
    }
  } catch (e) {
    errorEl.textContent = '⚠ ' + e.message;
    errorEl.style.display = '';
  } finally {
    window.reestrAPI.offProgress();
    progressWrap.style.display = 'none';
    btn.disabled = false;
    btn.querySelector('.reestr-spinner').style.display = 'none';
    document.getElementById('reestrParseBtnLabel').textContent = 'Распознать счета';
  }
}

function reestrRenderLog(entries) {
  document.getElementById('reestrLogCard').style.display = '';
  const logEl = document.getElementById('reestrLog');
  logEl.innerHTML = '';
  const icons = { ok: '✓', warn: '!', info: '·' };
  const colors = { ok: 'var(--green)', warn: 'var(--yellow)', info: 'var(--text3)' };
  entries.forEach(({ type, text }) => {
    const row = document.createElement('div');
    row.style.cssText = `padding:5px 10px;border-bottom:1px solid var(--border);display:flex;gap:6px;color:${colors[type] || 'var(--text)'}`;
    row.innerHTML = `<span style="width:14px;text-align:center;flex-shrink:0">${icons[type] || '·'}</span><span>${text}</span>`;
    logEl.appendChild(row);
  });
  const okCount = entries.filter(l => l.type === 'ok').length;
  const warnCount = entries.filter(l => l.type === 'warn').length;
  document.getElementById('reestrSummaryCount').textContent = okCount + (warnCount ? ' из ' + (okCount + warnCount) : '') + ' счетов распознано';
  const totalSum = reestrRows.reduce((s, r) => s + r.sum, 0);
  document.getElementById('reestrSummaryAmount').textContent = 'на сумму ' + totalSum.toLocaleString('ru-RU') + ' руб.';
}

function reestrUpdateTotal() {
  const total = reestrRows.reduce((s, r) => s + (r.sum || 0), 0);
  const el = document.getElementById('reestrReviewTotal');
  if (el) el.textContent = total.toLocaleString('ru-RU', { minimumFractionDigits: 2 }) + ' руб.';
}

function reestrBuildStatyaSelect(row, idx) {
  const sel = document.createElement('select');
  sel.style.cssText = 'width:100%;min-width:200px;padding:4px 6px;font-size:11px;border:1px solid var(--border);border-radius:5px;background:var(--bg2);color:var(--text);cursor:pointer;font-family:inherit';
  const emptyOpt = document.createElement('option');
  emptyOpt.value = ''; emptyOpt.textContent = '— выберите —';
  sel.appendChild(emptyOpt);
  const groups = {};
  reestrStatyi.forEach(s => { const g = s.vid || 'Прочее'; if (!groups[g]) groups[g] = []; groups[g].push(s); });
  for (const [gName, items] of Object.entries(groups)) {
    const og = document.createElement('optgroup'); og.label = gName;
    items.forEach(s => { const o = document.createElement('option'); o.value = s.label; o.textContent = s.label; if (row['statья'] && s.label === row['statья']) o.selected = true; og.appendChild(o); });
    sel.appendChild(og);
  }
  if (row['statья'] && !sel.value) {
    const code = row['statья'].split(',')[0].trim();
    for (const o of sel.options) { if (o.value.startsWith(code + ',')) { o.selected = true; break; } }
  }
  if (row['statья'] && !sel.value) {
    const c = document.createElement('option'); c.value = row['statья']; c.textContent = row['statья'] + ' (авто)'; c.selected = true;
    sel.insertBefore(c, sel.children[1]);
  }
  sel.addEventListener('change', () => { reestrRows[idx]['statья'] = sel.value; });
  return sel;
}

function reestrRenderTable() {
  const tbody = document.getElementById('reestrReviewBody');
  tbody.innerHTML = '';
  reestrRows.forEach((row, i) => {
    const isDup = row._duplicate || reestrDuplicates.some(d => d.rowIndex === i);
    const isKnown = row._knownContractor;
    const tr = document.createElement('tr');
    if (isDup) tr.style.background = 'color-mix(in srgb, var(--red) 10%, transparent)';
    else if (i % 2 === 1) tr.style.background = 'var(--bg3)';

    const tdN = document.createElement('td'); tdN.style.cssText = 'padding:6px 8px;text-align:center;font-weight:700;color:var(--text3);border-bottom:1px solid var(--border)';
    if (isDup) {
      const dupInfo = reestrDuplicates.find(d => d.rowIndex === i);
      tdN.innerHTML = `<span title="Возможный дубликат!\nРанее: ${dupInfo ? dupInfo.originalDate : ''}" style="color:var(--red);cursor:help">⚠ ${i + 1}</span>`;
    } else if (isKnown) {
      tdN.innerHTML = `<span title="Контрагент из базы знаний (${row._contractorHits || 0} счетов ранее)" style="color:var(--green,#22c55e);cursor:help">✓ ${i + 1}</span>`;
    } else {
      tdN.textContent = i + 1;
    }
    tr.appendChild(tdN);

    const tdS = document.createElement('td'); tdS.style.cssText = 'padding:6px 8px;text-align:right;border-bottom:1px solid var(--border)';
    const sumInp = document.createElement('input'); sumInp.type = 'text'; sumInp.value = (row.sum || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2 });
    sumInp.style.cssText = 'width:90px;text-align:right;padding:3px 5px;font-size:11px;border:1px solid var(--border);border-radius:5px;background:var(--bg2);color:var(--text);font-family:inherit;font-weight:700';
    sumInp.addEventListener('change', () => { const v = parseFloat(sumInp.value.replace(/\s/g,'').replace(',','.')); reestrRows[i].sum = isNaN(v) ? 0 : v; sumInp.value = reestrRows[i].sum.toLocaleString('ru-RU',{minimumFractionDigits:2}); reestrUpdateTotal(); });
    tdS.appendChild(sumInp); tr.appendChild(tdS);

    const tdD = document.createElement('td'); tdD.style.cssText = 'padding:6px 8px;border-bottom:1px solid var(--border)';
    const descInp = document.createElement('textarea'); descInp.value = (row.description || '').replace(/\\n/g, '\n');
    descInp.style.cssText = 'width:100%;padding:3px 5px;font-size:11px;border:1px solid var(--border);border-radius:5px;background:var(--bg2);color:var(--text);font-family:inherit;resize:vertical;min-height:40px';
    descInp.addEventListener('change', () => { reestrRows[i].description = descInp.value; });
    tdD.appendChild(descInp); tr.appendChild(tdD);

    const tdO = document.createElement('td'); tdO.style.cssText = 'padding:6px 8px;border-bottom:1px solid var(--border)';
    const objInp = document.createElement('input'); objInp.type = 'text'; objInp.value = row.obj || '';
    objInp.style.cssText = 'width:100%;padding:3px 5px;font-size:11px;border:1px solid var(--border);border-radius:5px;background:var(--bg2);color:var(--text);font-family:inherit';
    objInp.addEventListener('change', () => { reestrRows[i].obj = objInp.value; });
    tdO.appendChild(objInp); tr.appendChild(tdO);

    const tdVeh = document.createElement('td'); tdVeh.style.cssText = 'padding:6px 8px;border-bottom:1px solid var(--border)';
    const vehSel = document.createElement('select');
    vehSel.style.cssText = 'width:100%;min-width:120px;padding:4px 6px;font-size:11px;border:1px solid var(--border);border-radius:5px;background:var(--bg2);color:var(--text);cursor:pointer;font-family:inherit';
    const vehEmpty = document.createElement('option'); vehEmpty.value = ''; vehEmpty.textContent = '— не указан —'; vehSel.appendChild(vehEmpty);
    (data.vehicles || []).slice().sort((a,b) => (a.plate||'').localeCompare(b.plate||'','ru')).forEach(v => {
      const o = document.createElement('option'); o.value = v.plate; o.textContent = v.plate + ' — ' + v.make;
      if (row.vehiclePlate && row.vehiclePlate === v.plate) o.selected = true;
      vehSel.appendChild(o);
    });
    if (row.vehiclePlate && !vehSel.value) { const c = document.createElement('option'); c.value = row.vehiclePlate; c.textContent = row.vehiclePlate; c.selected = true; vehSel.insertBefore(c, vehSel.children[1]); }
    vehSel.addEventListener('change', () => { reestrRows[i].vehiclePlate = vehSel.value; });
    tdVeh.appendChild(vehSel); tr.appendChild(tdVeh);

    const tdSt = document.createElement('td'); tdSt.style.cssText = 'padding:6px 8px;border-bottom:1px solid var(--border)';
    tdSt.appendChild(reestrBuildStatyaSelect(row, i)); tr.appendChild(tdSt);

    const tdRep = document.createElement('td'); tdRep.style.cssText = 'padding:6px 8px;text-align:center;border-bottom:1px solid var(--border)';
    const alreadyLinked = (data.repairs || []).some(r => r.invoiceNo && row.osn && r.invoiceNo === row.osn);
    if (alreadyLinked) {
      tdRep.innerHTML = '<span class="reestr-linked" title="Уже в журнале ремонта">&#10003;</span>';
    } else {
      const repBtn = document.createElement('button'); repBtn.title = 'В журнал ремонта';
      repBtn.className = 'reestr-action-btn repair';
      repBtn.innerHTML = '<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>';
      repBtn.addEventListener('click', () => reestrToRepair(i));
      tdRep.appendChild(repBtn);
    }
    tr.appendChild(tdRep);

    const tdDel = document.createElement('td'); tdDel.style.cssText = 'padding:6px 8px;text-align:center;border-bottom:1px solid var(--border)';
    const delBtn = document.createElement('button'); delBtn.textContent = '✕';
    delBtn.className = 'reestr-action-btn delete';
    delBtn.addEventListener('click', () => { reestrRows.splice(i, 1); data.reestrRows = reestrRows; saveData(data); reestrRenderTable(); });
    tdDel.appendChild(delBtn); tr.appendChild(tdDel);

    tbody.appendChild(tr);
  });
  reestrUpdateTotal();
}

function reestrToRepair(idx) {
  const row = reestrRows[idx];
  if (!row) return;
  editingRepairId = null;
  document.getElementById('repairModalTitle').textContent = 'Добавить ремонт';
  document.getElementById('repairDeleteBtn').style.display = 'none';
  const sel = document.getElementById('rp_vehicle');
  populateRepairVehicleSelect(sel);
  document.getElementById('rp_vehicle_wrap').style.display = '';
  if (row.obj) {
    const objLow = row.obj.toLowerCase();
    const match = data.vehicles.find(v =>
      (v.plate && v.plate.toLowerCase().includes(objLow)) ||
      (v.make && v.make.toLowerCase().includes(objLow)) ||
      (v.object && v.object.toLowerCase().includes(objLow)) ||
      (objLow.includes((v.plate||'').toLowerCase()) && v.plate)
    );
    if (match) sel.value = match.id;
  }
  document.getElementById('rp_invoice_date').value = row.date || fmtDate(new Date().toISOString().split('T')[0]);
  document.getElementById('rp_invoice_no').value = row.osn || '';
  document.getElementById('rp_cost').value = row.sum || '';
  document.getElementById('rp_description').value = (row.description || '').replace(/\\n/g, '\n');
  document.getElementById('rp_mileage').value = '';
  document.getElementById('rp_paid').checked = false;
  document.getElementById('rp_note').value = '';
  populateRepairCategorySelect(row['statья'] || '');
  openModal('repairModal');
}

async function reestrBuild() {
  const btn = document.getElementById('reestrBuildBtn');
  btn.disabled = true;
  btn.querySelector('.reestr-spinner').style.display = 'inline-block';
  document.getElementById('reestrBuildBtnLabel').textContent = 'Формирую…';
  try {
    // Сохраняем в базу знаний перед формированием
    if (window.reestrAPI.learn) {
      try { await window.reestrAPI.learn(reestrRows); } catch {}
    }
    const d = await window.reestrAPI.buildXlsx({ rows: reestrRows });
    reestrLastResult = d;
    document.getElementById('reestrDoneCard').style.display = '';
    document.getElementById('reestrDoneCount').textContent = reestrRows.length + ' строк в реестре';
    document.getElementById('reestrDoneAmount').textContent = 'на сумму ' + d.total.toLocaleString('ru-RU') + ' руб.';
    document.getElementById('reestrReviewCard').style.display = 'none';
  } catch (e) {
    const errorEl = document.getElementById('reestrError');
    errorEl.textContent = '⚠ ' + e.message;
    errorEl.style.display = '';
  } finally {
    btn.disabled = false;
    btn.querySelector('.reestr-spinner').style.display = 'none';
    document.getElementById('reestrBuildBtnLabel').textContent = 'Сформировать реестр';
  }
}

async function reestrDownload() {
  if (!reestrLastResult) return;
  const r = await window.reestrAPI.save(reestrLastResult.filename, reestrLastResult.xlsxBase64);
  if (r.saved) {
    const btn = document.getElementById('reestrDownloadBtn');
    btn.textContent = '✓ Сохранено';
    setTimeout(() => { btn.textContent = '⬇ Скачать реестр.xlsx'; }, 2000);
  }
}

function reestrRenderSavedList() {
  const list = document.getElementById('reestrSavedList');
  const empty = document.getElementById('reestrSavedEmpty');
  const countEl = document.getElementById('reestrSavedCount');
  if (!list) return;
  const saved = data.savedReestrs || [];
  if (!saved.length) {
    list.innerHTML = '';
    empty.style.display = '';
    countEl.textContent = '';
    return;
  }
  empty.style.display = 'none';
  countEl.textContent = saved.length + ' шт.';
  list.innerHTML = `<div style="overflow-x:auto;border:1px solid var(--border);border-radius:8px">
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:var(--accent);color:#fff">
        <th style="padding:7px 10px;text-align:center;font-weight:600;width:50px">№</th>
        <th style="padding:7px 10px;text-align:left;font-weight:600">Дата</th>
        <th style="padding:7px 10px;text-align:center;font-weight:600">Счетов</th>
        <th style="padding:7px 10px;text-align:right;font-weight:600">Сумма</th>
        <th style="padding:7px 10px;text-align:center;font-weight:600;width:36px"></th>
      </tr></thead>
      <tbody>${saved.map((r, i) => {
        const bg = i % 2 ? 'var(--bg3)' : 'transparent';
        return `<tr style="background:${bg};cursor:pointer" onclick="reestrOpenSaved(${i})" title="Открыть реестр №${r.number}">
          <td style="padding:7px 10px;text-align:center;font-weight:700;color:var(--accent);border-bottom:1px solid var(--border)">${r.number}</td>
          <td style="padding:7px 10px;border-bottom:1px solid var(--border)">${r.date}</td>
          <td style="padding:7px 10px;text-align:center;border-bottom:1px solid var(--border)">${r.rowCount}</td>
          <td style="padding:7px 10px;text-align:right;font-weight:600;border-bottom:1px solid var(--border)">${r.totalSum.toLocaleString('ru-RU', {minimumFractionDigits:2})} руб.</td>
          <td style="padding:7px 10px;text-align:center;border-bottom:1px solid var(--border)"><button class="reestr-action-btn delete" onclick="event.stopPropagation();reestrDeleteSaved(${i})" title="Удалить реестр">✕</button></td>
        </tr>`;
      }).join('')}</tbody>
    </table>
  </div>`;
}

function reestrSaveCurrent() {
  if (!reestrRows.length) return;
  const saved = data.savedReestrs || [];
  const nextNum = saved.length > 0 ? Math.max(...saved.map(r => r.number)) + 1 : 1;
  const totalSum = reestrRows.reduce((s, r) => s + (r.sum || 0), 0);
  saved.push({
    number: nextNum,
    date: new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    rowCount: reestrRows.length,
    totalSum: totalSum,
    rows: JSON.parse(JSON.stringify(reestrRows)),
  });
  data.savedReestrs = saved;
  saveData(data);
  reestrRenderSavedList();
  const btn = document.getElementById('reestrSaveBtn');
  if (btn) { btn.textContent = '✓ Сохранено'; setTimeout(() => { btn.textContent = '💾 Сохранить'; }, 1500); }
}

function reestrOpenSaved(idx) {
  const saved = data.savedReestrs || [];
  const entry = saved[idx];
  if (!entry) return;
  reestrRows = JSON.parse(JSON.stringify(entry.rows));
  data.reestrRows = reestrRows;
  saveData(data);
  document.getElementById('reestrReviewCard').style.display = '';
  document.getElementById('reestrDoneCard').style.display = 'none';
  document.getElementById('reestrLogCard').style.display = 'none';
  reestrRenderTable();
  document.getElementById('reestrReviewCard').scrollIntoView({ behavior: 'smooth' });
}

function reestrDeleteSaved(idx) {
  const saved = data.savedReestrs || [];
  const entry = saved[idx];
  if (!entry || !confirm('Удалить реестр №' + entry.number + '?')) return;
  saved.splice(idx, 1);
  data.savedReestrs = saved;
  saveData(data);
  reestrRenderSavedList();
}

async function reestrShowAnalytics() {
  if (!reestrRows.length) return;
  let analytics;
  try {
    analytics = await window.reestrAPI.analytics(reestrRows);
  } catch {
    analytics = localAnalytics(reestrRows);
  }

  const fmtSum = (n) => n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (part, total) => total > 0 ? Math.round(part / total * 100) : 0;

  let html = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px">
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:14px;text-align:center">
        <div style="font-size:24px;font-weight:800;color:var(--accent)">${analytics.totalRows}</div>
        <div style="font-size:11px;color:var(--text3)">Счетов</div>
      </div>
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:14px;text-align:center">
        <div style="font-size:24px;font-weight:800;color:var(--accent)">${fmtSum(analytics.totalSum)}</div>
        <div style="font-size:11px;color:var(--text3)">Общая сумма (руб.)</div>
      </div>
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:14px;text-align:center">
        <div style="font-size:24px;font-weight:800;color:var(--accent)">${analytics.bySupplier.length}</div>
        <div style="font-size:11px;color:var(--text3)">Контрагентов</div>
      </div>
    </div>`;

  // Таблица по контрагентам
  html += `<h4 style="margin:0 0 8px;font-size:14px;font-weight:700">По контрагентам</h4>
    <div style="overflow-x:auto;border:1px solid var(--border);border-radius:8px;margin-bottom:16px;max-height:250px;overflow-y:auto">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:var(--accent);color:#fff;position:sticky;top:0">
          <th style="padding:6px 8px;text-align:left">Контрагент</th>
          <th style="padding:6px 8px;text-align:center">Кол-во</th>
          <th style="padding:6px 8px;text-align:right">Сумма</th>
          <th style="padding:6px 8px;text-align:right">%</th>
        </tr></thead><tbody>`;
  analytics.bySupplier.forEach((s, i) => {
    html += `<tr style="background:${i%2?'var(--bg3)':'transparent'}">
      <td style="padding:5px 8px;border-bottom:1px solid var(--border)">${s.name}</td>
      <td style="padding:5px 8px;text-align:center;border-bottom:1px solid var(--border)">${s.count}</td>
      <td style="padding:5px 8px;text-align:right;border-bottom:1px solid var(--border);font-weight:600">${fmtSum(s.sum)}</td>
      <td style="padding:5px 8px;text-align:right;border-bottom:1px solid var(--border);color:var(--text3)">${pct(s.sum, analytics.totalSum)}%</td>
    </tr>`;
  });
  html += '</tbody></table></div>';

  // По объектам
  if (analytics.byObject.length > 1 || (analytics.byObject.length === 1 && analytics.byObject[0].name !== 'Не указан')) {
    html += `<h4 style="margin:0 0 8px;font-size:14px;font-weight:700">По объектам</h4>
      <div style="overflow-x:auto;border:1px solid var(--border);border-radius:8px;margin-bottom:16px;max-height:200px;overflow-y:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="background:var(--accent);color:#fff;position:sticky;top:0">
            <th style="padding:6px 8px;text-align:left">Объект</th>
            <th style="padding:6px 8px;text-align:center">Кол-во</th>
            <th style="padding:6px 8px;text-align:right">Сумма</th>
            <th style="padding:6px 8px;text-align:right">%</th>
          </tr></thead><tbody>`;
    analytics.byObject.forEach((s, i) => {
      html += `<tr style="background:${i%2?'var(--bg3)':'transparent'}">
        <td style="padding:5px 8px;border-bottom:1px solid var(--border)">${s.name}</td>
        <td style="padding:5px 8px;text-align:center;border-bottom:1px solid var(--border)">${s.count}</td>
        <td style="padding:5px 8px;text-align:right;border-bottom:1px solid var(--border);font-weight:600">${fmtSum(s.sum)}</td>
        <td style="padding:5px 8px;text-align:right;border-bottom:1px solid var(--border);color:var(--text3)">${pct(s.sum, analytics.totalSum)}%</td>
      </tr>`;
    });
    html += '</tbody></table></div>';
  }

  // По статьям БДДС
  html += `<h4 style="margin:0 0 8px;font-size:14px;font-weight:700">По статьям БДДС</h4>
    <div style="overflow-x:auto;border:1px solid var(--border);border-radius:8px;margin-bottom:16px;max-height:200px;overflow-y:auto">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:var(--accent);color:#fff;position:sticky;top:0">
          <th style="padding:6px 8px;text-align:left">Статья</th>
          <th style="padding:6px 8px;text-align:center">Кол-во</th>
          <th style="padding:6px 8px;text-align:right">Сумма</th>
          <th style="padding:6px 8px;text-align:right">%</th>
        </tr></thead><tbody>`;
  analytics.byCategory.forEach((s, i) => {
    const label = s.name.replace(/^[\d.,\s]+/, '').replace(/^,\s*/, '').trim() || s.name;
    html += `<tr style="background:${i%2?'var(--bg3)':'transparent'}">
      <td style="padding:5px 8px;border-bottom:1px solid var(--border)">${label}</td>
      <td style="padding:5px 8px;text-align:center;border-bottom:1px solid var(--border)">${s.count}</td>
      <td style="padding:5px 8px;text-align:right;border-bottom:1px solid var(--border);font-weight:600">${fmtSum(s.sum)}</td>
      <td style="padding:5px 8px;text-align:right;border-bottom:1px solid var(--border);color:var(--text3)">${pct(s.sum, analytics.totalSum)}%</td>
    </tr>`;
  });
  html += '</tbody></table></div>';

  // По месяцам
  if (analytics.byMonth.length > 1) {
    html += `<h4 style="margin:0 0 8px;font-size:14px;font-weight:700">По месяцам</h4>
      <div style="overflow-x:auto;border:1px solid var(--border);border-radius:8px;margin-bottom:16px">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="background:var(--accent);color:#fff">
            <th style="padding:6px 8px;text-align:left">Месяц</th>
            <th style="padding:6px 8px;text-align:center">Кол-во</th>
            <th style="padding:6px 8px;text-align:right">Сумма</th>
          </tr></thead><tbody>`;
    analytics.byMonth.forEach((s, i) => {
      html += `<tr style="background:${i%2?'var(--bg3)':'transparent'}">
        <td style="padding:5px 8px;border-bottom:1px solid var(--border)">${s.name}</td>
        <td style="padding:5px 8px;text-align:center;border-bottom:1px solid var(--border)">${s.count}</td>
        <td style="padding:5px 8px;text-align:right;border-bottom:1px solid var(--border);font-weight:600">${fmtSum(s.sum)}</td>
      </tr>`;
    });
    html += '</tbody></table></div>';
  }

  openGenericModal('Аналитика реестра', html, 700);
}

function localAnalytics(rows) {
  const bySupplier = {}, byObject = {}, byCategory = {}, byMonth = {};
  let totalSum = 0;
  for (const row of rows) {
    const sum = row.sum || 0;
    totalSum += sum;
    const s = row.supplier || 'Не указан';
    if (!bySupplier[s]) bySupplier[s] = { count:0, sum:0 }; bySupplier[s].count++; bySupplier[s].sum += sum;
    const o = row.obj || 'Не указан';
    if (!byObject[o]) byObject[o] = { count:0, sum:0 }; byObject[o].count++; byObject[o].sum += sum;
    const c = row['statья'] || row.category || 'Без категории';
    if (!byCategory[c]) byCategory[c] = { count:0, sum:0 }; byCategory[c].count++; byCategory[c].sum += sum;
    if (row.date) { const p = row.date.split('.'); if (p.length===3) { const mk = `${p[1]}.${p[2]}`; if (!byMonth[mk]) byMonth[mk]={count:0,sum:0}; byMonth[mk].count++; byMonth[mk].sum+=sum; } }
  }
  const sort = (o) => Object.entries(o).sort((a,b)=>b[1].sum-a[1].sum).map(([name,d])=>({name,...d}));
  return { totalRows:rows.length, totalSum, bySupplier:sort(bySupplier), byObject:sort(byObject), byCategory:sort(byCategory),
    byMonth: Object.entries(byMonth).sort((a,b)=>a[0].localeCompare(b[0])).map(([name,d])=>({name,...d})) };
}

