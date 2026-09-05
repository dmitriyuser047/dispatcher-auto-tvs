// Журнал ремонта: по одному ТС и общий
// Выделено из index.html

// ═══════════════════════════════════════════════════════
// ЖУРНАЛ РЕМОНТА (ТРАНСПОРТ)
// ═══════════════════════════════════════════════════════
function renderRepairSection(vid) {
  const recs = repairsFor(vid).slice().sort((a, b) => cmpDateDesc(a.invoiceDate, b.invoiceDate));
  const totalCost   = recs.reduce((s, r) => s + (r.cost || 0), 0);
  const unpaidCost  = recs.filter(r => !r.paid).reduce((s, r) => s + (r.cost || 0), 0);

  let rows = '';
  if (!recs.length) {
    rows = `<tr><td colspan="7" class="empty-table">Нет записей о ремонте. Нажмите «+ Ремонт» чтобы добавить.</td></tr>`;
  } else {
    recs.forEach(r => {
      rows += `<tr>
        <td class="td-day">${fmtDate(r.invoiceDate)}</td>
        <td style="padding:10px 14px;font-size:13px;font-weight:600">${r.invoiceNo ? '<span class="invoice-badge"><svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="var(--accent)" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' + r.invoiceNo + '</span>' : '—'}</td>
        <td class="td-num">${r.mileage != null ? r.mileage.toLocaleString('ru') + ' км' : '—'}</td>
        <td class="td-num" style="font-weight:600">${r.cost != null ? r.cost.toLocaleString('ru-RU', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' ₽' : '—'}</td>
        <td style="padding:10px 14px;font-size:13px;color:var(--text2);max-width:320px">${r.description || '—'}${r.category ? '<div style="margin-top:3px"><span class="category-tag">' + r.category.split(',')[0].trim() + '</span></div>' : ''}</td>
        <td class="td-num">
          <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;font-weight:700;color:${r.paid ? 'var(--green)' : 'var(--red)'}">
            <input type="checkbox" ${r.paid ? 'checked' : ''} onchange="toggleRepairPaid('${r.id}')" style="width:auto;accent-color:var(--accent)">
            ${r.paid ? 'Оплачено' : 'Не оплачено'}
          </label>
        </td>
        <td class="td-actions">
          <button class="icon-btn" onclick="openEditRepair('${r.id}')">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="icon-btn del" onclick="deleteRepair('${r.id}')">
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
        Журнал ремонта
        <span style="color:var(--text3);font-weight:400;font-size:12px;margin-left:10px">${recs.length} записей · ${totalCost.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})} ₽ всего${unpaidCost > 0 ? ` · <span style="color:var(--red);font-weight:600">${unpaidCost.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})} ₽ не оплачено</span>` : ''}</span>
      </div>
      <button class="btn btn-primary btn-sm" onclick="openAddRepair('${vid}')">
        <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        + Ремонт
      </button>
    </div>
    <div class="table-scroll">
      <table>
        <thead><tr>
          <th>Дата счёта</th><th>№ счёта</th><th>Пробег</th><th>Сумма</th>
          <th>Описание</th><th>Статус оплаты</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

async function populateRepairCategorySelect(presetValue) {
  await loadReestrStatyi();
  const sel = document.getElementById('rp_category');
  sel.innerHTML = '<option value="">— не указана —</option>' +
    reestrStatyi.map(s => `<option value="${s.label}">${s.label}</option>`).join('');
  if (presetValue) sel.value = presetValue;
}

function populateRepairVehicleSelect(selEl, presetVid) {
  selEl.innerHTML = data.vehicles.slice().sort((a,b) => (a.plate||'').localeCompare(b.plate||'', 'ru'))
    .map(v => `<option value="${v.id}">${v.plate} — ${v.make}${v.driver ? ' · ' + v.driver : ''}</option>`).join('');
  if (presetVid) selEl.value = presetVid;
}

function openAddRepair(vid) {
  editingRepairId = null;
  document.getElementById('repairModalTitle').textContent = 'Добавить ремонт';
  document.getElementById('repairDeleteBtn').style.display = 'none';
  const sel = document.getElementById('rp_vehicle');
  populateRepairVehicleSelect(sel, vid || selectedVehicleId);
  document.getElementById('rp_vehicle_wrap').style.display = vid ? 'none' : '';
  const now = new Date();
  document.getElementById('rp_invoice_date').value = fmtDate(now.toISOString().split('T')[0]);
  ['rp_invoice_no','rp_description','rp_note'].forEach(id => document.getElementById(id).value = '');
  ['rp_cost','rp_mileage'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('rp_paid').checked = false;
  populateRepairCategorySelect('');
  // предзаполнить пробег из последней записи по ТС, если известен
  const presetVid = vid || selectedVehicleId;
  const v = presetVid && data.vehicles.find(x => x.id === presetVid);
  if (v) {
    const totalKm = recsFor(v.id).reduce((s, r) => s + (r.km || 0), 0);
    const curOdo = (v.odometer || 0) + totalKm;
    if (curOdo > 0) document.getElementById('rp_mileage').value = Math.round(curOdo);
  }
  openModal('repairModal');
}

function openEditRepair(id) {
  const r = (data.repairs || []).find(x => x.id === id);
  if (!r) return;
  editingRepairId = id;
  document.getElementById('repairModalTitle').textContent = 'Редактировать ремонт';
  document.getElementById('repairDeleteBtn').style.display = '';
  const sel = document.getElementById('rp_vehicle');
  populateRepairVehicleSelect(sel, r.vehicleId);
  document.getElementById('rp_vehicle_wrap').style.display = '';
  document.getElementById('rp_invoice_no').value   = r.invoiceNo || '';
  document.getElementById('rp_invoice_date').value = fmtDate(r.invoiceDate);
  document.getElementById('rp_cost').value         = r.cost ?? '';
  document.getElementById('rp_mileage').value      = r.mileage ?? '';
  document.getElementById('rp_description').value  = r.description || '';
  document.getElementById('rp_paid').checked       = !!r.paid;
  document.getElementById('rp_note').value         = r.note || '';
  populateRepairCategorySelect(r.category || '');
  openModal('repairModal');
}

function saveRepair() {
  const vehicleId   = document.getElementById('rp_vehicle').value;
  const invoiceDate = parseDate(document.getElementById('rp_invoice_date').value.trim());
  const cost        = parseFloat(document.getElementById('rp_cost').value);
  const description = document.getElementById('rp_description').value.trim();
  if (!vehicleId)     { showFieldError('Выберите транспортное средство', 'rp_vehicle'); return; }
  if (!invoiceDate)   { showFieldError('Укажите дату счёта в формате ДД.ММ.ГГГГ', 'rp_invoice_date'); return; }
  if (isNaN(cost))    { showFieldError('Укажите сумму ремонта', 'rp_cost'); return; }
  if (!description)   { showFieldError('Укажите описание ремонта', 'rp_description'); return; }
  const obj = {
    vehicleId,
    invoiceNo:   document.getElementById('rp_invoice_no').value.trim(),
    invoiceDate,
    cost,
    mileage:     parseFloat(document.getElementById('rp_mileage').value) || null,
    description,
    paid:        document.getElementById('rp_paid').checked,
    note:        document.getElementById('rp_note').value.trim(),
    category:    document.getElementById('rp_category').value,
  };
  if (!data.repairs) data.repairs = [];
  if (editingRepairId) {
    Object.assign(data.repairs.find(x => x.id === editingRepairId), obj);
  } else {
    obj.id = 'rp_' + Date.now();
    data.repairs.push(obj);
  }
  saveData(data);
  closeModal('repairModal');
  const v = data.vehicles.find(x => x.id === selectedVehicleId);
  if (v) renderDetail(v);
  if (document.getElementById('repairsJournalModal').classList.contains('open')) {
    repairsJournalSummaryMode ? renderRepairsSummary() : renderRepairsJournal();
  }
  if (document.getElementById('reestrReviewBody') && reestrRows.length) reestrRenderTable();
}

function deleteRepair(id) {
  if (!confirm('Удалить эту запись о ремонте?')) return;
  data.repairs = (data.repairs || []).filter(r => r.id !== id);
  saveData(data);
  closeModal('repairModal');
  const v = data.vehicles.find(x => x.id === selectedVehicleId);
  if (v) renderDetail(v);
  if (document.getElementById('repairsJournalModal').classList.contains('open')) renderRepairsJournal();
}

function toggleRepairPaid(id) {
  const r = (data.repairs || []).find(x => x.id === id);
  if (!r) return;
  r.paid = !r.paid;
  saveData(data);
  const v = data.vehicles.find(x => x.id === selectedVehicleId);
  if (v) renderDetail(v);
  if (document.getElementById('repairsJournalModal').classList.contains('open')) renderRepairsJournal();
}

// ─── ОБЩИЙ ЖУРНАЛ РЕМОНТА (ВСЕ ТС) ───────────────────────
function openRepairsJournal() {
  const sel = document.getElementById('rj_vehicle_filter');
  const cur = sel.value;
  sel.innerHTML = '<option value="">Все ТС</option>' + data.vehicles.slice()
    .sort((a,b) => (a.plate||'').localeCompare(b.plate||'', 'ru'))
    .map(v => `<option value="${v.id}">${v.plate} — ${v.make}</option>`).join('');
  sel.value = cur || '';
  repairsJournalSummaryMode = false;
  const togBtn = document.getElementById('rjSummaryToggle');
  if (togBtn) { togBtn.textContent = 'Сводка'; togBtn.classList.remove('active'); }
  renderRepairsJournal();
  openModal('repairsJournalModal');
}

function renderRepairsJournal() {
  const vidFilter    = document.getElementById('rj_vehicle_filter').value;
  const statusFilter = document.getElementById('rj_status_filter').value;
  let recs = (data.repairs || []).slice();
  if (vidFilter)    recs = recs.filter(r => r.vehicleId === vidFilter);
  if (statusFilter) recs = recs.filter(r => statusFilter === 'paid' ? r.paid : !r.paid);
  recs.sort((a, b) => cmpDateDesc(a.invoiceDate, b.invoiceDate));

  const totalCost  = recs.reduce((s, r) => s + (r.cost || 0), 0);
  const unpaidCost = recs.filter(r => !r.paid).reduce((s, r) => s + (r.cost || 0), 0);

  let rows = '';
  if (!recs.length) {
    rows = `<tr><td colspan="8" class="empty-table">Нет записей о ремонте.</td></tr>`;
  } else {
    recs.forEach(r => {
      const v = data.vehicles.find(x => x.id === r.vehicleId);
      rows += `<tr>
        <td style="padding:10px 14px;font-size:13px;font-weight:600">${v ? v.plate : '—'}<div style="font-weight:400;color:var(--text3);font-size:11px">${v ? v.make : ''}</div></td>
        <td class="td-day">${fmtDate(r.invoiceDate)}</td>
        <td style="padding:10px 14px;font-size:13px">${r.invoiceNo ? '<span class="invoice-badge"><svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="var(--accent)" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' + r.invoiceNo + '</span>' : '—'}</td>
        <td class="td-num">${r.mileage != null ? r.mileage.toLocaleString('ru') + ' км' : '—'}</td>
        <td class="td-num" style="font-weight:600">${r.cost != null ? r.cost.toLocaleString('ru-RU', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' ₽' : '—'}</td>
        <td style="padding:10px 14px;font-size:13px;color:var(--text2);max-width:320px">${r.description || '—'}${r.category ? '<div style="margin-top:3px"><span class="category-tag">' + r.category.split(',')[0].trim() + '</span></div>' : ''}</td>
        <td class="td-num">
          <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;font-weight:700;color:${r.paid ? 'var(--green)' : 'var(--red)'}">
            <input type="checkbox" ${r.paid ? 'checked' : ''} onchange="toggleRepairPaid('${r.id}')" style="width:auto;accent-color:var(--accent)">
            ${r.paid ? 'Оплачено' : 'Не оплачено'}
          </label>
        </td>
        <td class="td-actions">
          <button class="icon-btn" onclick="openEditRepair('${r.id}')">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="icon-btn del" onclick="deleteRepair('${r.id}')">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
          </button>
        </td>
      </tr>`;
    });
  }

  document.getElementById('repairsJournalBody').innerHTML = `
    <div class="table-wrap" style="margin-top:14px">
      <div class="table-toolbar">
        <div class="table-toolbar-left">
          <span style="color:var(--text3);font-weight:400;font-size:12px">${recs.length} записей · ${totalCost.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})} ₽ всего${unpaidCost > 0 ? ` · <span style="color:var(--red);font-weight:600">${unpaidCost.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})} ₽ не оплачено</span>` : ''}</span>
        </div>
      </div>
      <div class="table-scroll" style="max-height:52vh">
        <table>
          <thead><tr>
            <th>ТС</th><th>Дата счёта</th><th>№ счёта</th><th>Пробег</th>
            <th>Сумма</th><th>Описание</th><th>Статус оплаты</th><th></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

let repairsJournalSummaryMode = false;

function toggleRepairsSummary() {
  repairsJournalSummaryMode = !repairsJournalSummaryMode;
  const btn = document.getElementById('rjSummaryToggle');
  btn.textContent = repairsJournalSummaryMode ? 'Таблица' : 'Сводка';
  btn.classList.toggle('active', repairsJournalSummaryMode);
  if (repairsJournalSummaryMode) renderRepairsSummary();
  else renderRepairsJournal();
}

function renderRepairsSummary() {
  const vidFilter    = document.getElementById('rj_vehicle_filter').value;
  const statusFilter = document.getElementById('rj_status_filter').value;
  let recs = (data.repairs || []).slice();
  if (vidFilter)    recs = recs.filter(r => r.vehicleId === vidFilter);
  if (statusFilter) recs = recs.filter(r => statusFilter === 'paid' ? r.paid : !r.paid);

  const groups = {};
  recs.forEach(r => {
    if (!groups[r.vehicleId]) groups[r.vehicleId] = [];
    groups[r.vehicleId].push(r);
  });

  const grandTotal = recs.reduce((s, r) => s + (r.cost || 0), 0);
  const grandUnpaid = recs.filter(r => !r.paid).reduce((s, r) => s + (r.cost || 0), 0);

  let html = '<div style="margin-top:14px">';
  const vids = Object.keys(groups).sort((a, b) => {
    const va = data.vehicles.find(x => x.id === a);
    const vb = data.vehicles.find(x => x.id === b);
    return ((va && va.plate) || '').localeCompare((vb && vb.plate) || '', 'ru');
  });

  if (!recs.length) {
    html += '<div class="empty-table">Нет записей о ремонте.</div>';
  }

  vids.forEach(vid => {
    const v = data.vehicles.find(x => x.id === vid);
    const items = groups[vid];
    const total = items.reduce((s, r) => s + (r.cost || 0), 0);
    const unpaid = items.filter(r => !r.paid).reduce((s, r) => s + (r.cost || 0), 0);

    const cats = {};
    items.forEach(r => {
      const cat = r.category ? r.category.split(',')[0].trim() : 'Без категории';
      if (!cats[cat]) cats[cat] = { sum: 0, count: 0 };
      cats[cat].sum += (r.cost || 0);
      cats[cat].count++;
    });

    let catRows = '';
    Object.keys(cats).sort().forEach(cat => {
      catRows += `<div class="summary-cat-row">
        <span>${cat} (${cats[cat].count})</span>
        <span style="font-weight:600">${cats[cat].sum.toLocaleString('ru-RU', {minimumFractionDigits:2, maximumFractionDigits:2})} &#8381;</span>
      </div>`;
    });

    html += `<div class="summary-card">
      <div class="summary-card-header">
        <div>
          <span style="font-weight:700;font-size:14px">${v ? v.plate : '—'}</span>
          <span style="color:var(--text3);font-size:12px;margin-left:8px">${v ? v.make : ''}</span>
        </div>
        <div style="text-align:right">
          <span style="font-weight:700;font-size:14px">${total.toLocaleString('ru-RU', {minimumFractionDigits:2, maximumFractionDigits:2})} &#8381;</span>
          <span style="font-size:11px;color:var(--text3);margin-left:6px">${items.length} рем.</span>
          ${unpaid > 0 ? '<div style="font-size:11px;color:var(--red);font-weight:600">' + unpaid.toLocaleString('ru-RU', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' &#8381; не оплачено</div>' : ''}
        </div>
      </div>
      <div class="summary-card-cats">${catRows}</div>
    </div>`;
  });

  if (recs.length) {
    html += `<div class="summary-total">
      <span>Итого по всем ТС</span>
      <span>${grandTotal.toLocaleString('ru-RU', {minimumFractionDigits:2, maximumFractionDigits:2})} &#8381;${grandUnpaid > 0 ? ' <span style="font-size:12px;color:var(--red);font-weight:600">(' + grandUnpaid.toLocaleString('ru-RU', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' &#8381; не оплачено)</span>' : ''}</span>
    </div>`;
  }
  html += '</div>';

  document.getElementById('repairsJournalBody').innerHTML = html;
}

