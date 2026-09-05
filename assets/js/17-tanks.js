// Топливные ёмкости и приход топлива
// Выделено из index.html

// ═══════════════════════════════════════════════════════
// ЁМКОСТИ (топливные) — привязаны к ДЭС
// ═══════════════════════════════════════════════════════
let genSubView = 'generators';
let selectedTankId = null;
let editingTankId = null;
let editingTankIncomeId = null;

const TANK_FUEL_LABELS = { diesel:'Дизель', gasoline:'Бензин', gas:'Газ' };

function tanksAll() { return data.tanks || []; }

// Остаток ёмкости = начальный + приход − выдано в привязанные ДЭС
function computeTankBalance(tankId) {
  const t = tanksAll().find(x => x.id === tankId);
  if (!t) return { init:0, income:0, issued:0, balance:0, capacity:0, fillPct:0 };
  const income = (data.tankIncomes || []).filter(r => r.tankId === tankId).reduce((s,r) => s + (r.amount || 0), 0);
  const boundGenIds = new Set((data.generators || []).filter(g => g.tankId === tankId).map(g => g.id));
  const issued = (data.genRecords || []).filter(r => boundGenIds.has(r.generatorId)).reduce((s,r) => s + (r.fuelIssued || 0), 0);
  const init = t.balanceInit || 0;
  const balance = +(init + income - issued).toFixed(2);
  const capacity = t.capacity || 0;
  const fillPct = capacity > 0 ? Math.max(0, Math.min(100, Math.round(balance / capacity * 100))) : 0;
  return { init, income, issued, balance, capacity, fillPct };
}

function switchGenSubView(view) {
  genSubView = view;
  document.getElementById('subTabGens').classList.toggle('active', view === 'generators');
  document.getElementById('subTabTanks').classList.toggle('active', view === 'tanks');
  document.getElementById('genSearchWrap').style.display  = view === 'generators' ? '' : 'none';
  document.getElementById('tankSearchWrap').style.display = view === 'tanks' ? '' : 'none';
  document.getElementById('generatorList').style.display  = view === 'generators' ? '' : 'none';
  document.getElementById('tankList').style.display       = view === 'tanks' ? '' : 'none';
  document.getElementById('btnAddGen').style.display      = view === 'generators' ? '' : 'none';
  document.getElementById('btnAddTank').style.display     = view === 'tanks' ? '' : 'none';
  document.getElementById('sidebarSummary').style.display = view === 'generators' ? '' : 'none';
  selectedTankId = null;
  selectedGeneratorId = null;
  if (view === 'tanks') {
    document.getElementById('mainContent').innerHTML = `<div class="welcome">
      <svg width="72" height="72" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1"><path d="M5 8h14M5 8a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v1a2 2 0 01-2 2M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8"/></svg>
      <h2>Выберите ёмкость</h2><p>Выберите ёмкость из списка слева или добавьте новую</p></div>`;
    renderTankList();
  } else {
    document.getElementById('mainContent').innerHTML = `<div class="welcome">
      <svg width="72" height="72" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-4 0v2"/><path d="M12 12v4m-2-2h4"/></svg>
      <h2>Выберите дизельный генератор</h2><p>Выберите ДЭС из списка слева или добавьте новый</p></div>`;
    renderGeneratorList();
  }
}

function renderTankList() {
  const list = document.getElementById('tankList');
  const tanks = tanksAll();
  if (!tanks.length) {
    list.innerHTML = `<div class="empty-list">
      <svg width="40" height="40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" style="display:block;margin:0 auto 8px"><path d="M5 8h14M5 8a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v1a2 2 0 01-2 2M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8"/></svg>
      Нет ёмкостей.<br>Нажмите «Добавить ёмкость»</div>`;
    return;
  }
  const sorted = tanks.slice().sort((a,b) => (a.name||'').toLowerCase() < (b.name||'').toLowerCase() ? -1 : 1);
  let html = '';
  sorted.forEach(t => {
    const b = computeTankBalance(t.id);
    const balColor = b.balance < 0 ? 'var(--red)' : b.balance < (b.capacity*0.1||50) ? 'var(--yellow)' : 'var(--green)';
    const boundCount = (data.generators || []).filter(g => g.tankId === t.id).length;
    html += `<div class="vehicle-card ${selectedTankId === t.id ? 'active' : ''}" onclick="selectTank('${t.id}')" style="display:flex;flex-direction:column">
      <div style="flex:1;min-width:0;overflow:hidden">
        <div class="vc-make" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.name}</div>
        ${t.serial ? `<div class="vc-driver" style="font-family:'Courier New',monospace;letter-spacing:0.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Зав.№ ${t.serial}</div>` : ''}
        ${t.object ? `<div class="vc-driver" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Объект: ${t.object}</div>` : ''}
        ${t.location ? `<div class="vc-driver" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.location}</div>` : ''}
        ${t.capacity ? `<div class="vc-org">Объём: ${t.capacity.toLocaleString('ru')} л</div>` : ''}
      </div>
      ${t.capacity ? `<div style="height:6px;background:var(--border);border-radius:4px;margin-top:8px;overflow:hidden"><div style="height:100%;width:${b.fillPct}%;background:${balColor}"></div></div>` : ''}
      <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:8px;align-items:center">
        <div style="font-size:11px;font-weight:700;color:${balColor};background:${balColor}1a;border:1px solid ${balColor}4d;padding:3px 9px;border-radius:20px;white-space:nowrap">${b.balance.toLocaleString('ru',{maximumFractionDigits:1})} л</div>
        <span class="fuel-tag ${t.fuel||'diesel'}" style="font-size:11px;padding:3px 9px">${TANK_FUEL_LABELS[t.fuel||'diesel']}</span>
        <div class="vc-badge">ДЭС: ${boundCount}</div>
      </div>
    </div>`;
  });
  list.innerHTML = html;
}

function selectTank(id) {
  selectedTankId = id;
  renderTankList();
  const t = tanksAll().find(x => x.id === id);
  if (t) renderTankDetail(t);
}

function renderTankDetail(t) {
  const b = computeTankBalance(t.id);
  const balColor = b.balance < 0 ? 'var(--red)' : b.balance < (b.capacity*0.1||50) ? 'var(--yellow)' : 'var(--green)';
  const incomes = (data.tankIncomes || []).filter(r => r.tankId === t.id).sort((a,b2) => new Date(b2.date) - new Date(a.date));
  const boundGens = (data.generators || []).filter(g => g.tankId === t.id);
  const fmtL = x => (x||0).toLocaleString('ru',{maximumFractionDigits:1});

  let incRows = incomes.length ? incomes.map(r => `<tr>
      <td>${fmtDate(r.date)}</td>
      <td style="text-align:right;font-weight:600;color:var(--green)">+${fmtL(r.amount)} л</td>
      <td>${r.source || '—'}</td>
      <td>${r.note || ''}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="icon-btn" onclick="openEditTankIncome('${r.id}')" title="Изменить"><svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z"/></svg></button>
        <button class="icon-btn" onclick="deleteTankIncome('${r.id}')" title="Удалить"><svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>
      </td>
    </tr>`).join('') : `<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:14px">Нет записей прихода</td></tr>`;

  const boundHtml = boundGens.length ? boundGens.map(g => {
    const issued = (data.genRecords || []).filter(r => r.generatorId === g.id).reduce((s,r) => s + (r.fuelIssued || 0), 0);
    return `<div style="display:flex;justify-content:space-between;padding:7px 12px;border-bottom:1px solid var(--border);font-size:13px;cursor:pointer" onclick="switchGenSubView('generators');selectGenerator('${g.id}')">
      <span>${g.name}${g.location ? ` <span style="color:var(--text3)">· ${g.location}</span>` : ''}</span>
      <span style="color:var(--red);font-weight:600;white-space:nowrap">−${fmtL(issued)} л</span>
    </div>`;
  }).join('') : `<div style="padding:12px;color:var(--text3);font-size:13px">Нет привязанных ДЭС. Привяжите в карточке ДЭС (поле «Ёмкость»).</div>`;

  document.getElementById('mainContent').innerHTML = `
    <div class="vehicle-detail-header">
      <div>
        <h1 style="margin:0">${t.name}</h1>
        <div style="color:var(--text3);font-size:13px;margin-top:3px">${TANK_FUEL_LABELS[t.fuel||'diesel']}${t.location ? ' · '+t.location : ''}${t.capacity ? ' · объём '+t.capacity.toLocaleString('ru')+' л' : ''}</div>
        <div style="color:var(--text3);font-size:13px;margin-top:2px">${t.serial ? 'Зав.№ '+t.serial : ''}${t.object ? (t.serial?' · ':'')+'Объект: '+t.object : ''}${t.owner ? ((t.serial||t.object)?' · ':'')+'Собственник: '+t.owner : ''}</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary" onclick="openAddTankIncome()"><svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Приход</button>
        <button class="btn btn-ghost" onclick="openEditTank('${t.id}')"><svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z"/></svg> Изменить</button>
      </div>
    </div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;margin:16px 0">
      <div class="ss-card" style="flex:1;min-width:150px;background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:14px">
        <div style="font-size:12px;color:var(--text3)">Остаток</div>
        <div style="font-size:26px;font-weight:800;color:${balColor}">${fmtL(b.balance)} <span style="font-size:14px">л</span></div>
        ${b.capacity ? `<div style="height:8px;background:var(--border);border-radius:5px;margin-top:8px;overflow:hidden"><div style="height:100%;width:${b.fillPct}%;background:${balColor}"></div></div><div style="font-size:11px;color:var(--text3);margin-top:4px">${b.fillPct}% от ${b.capacity.toLocaleString('ru')} л</div>` : ''}
      </div>
      <div class="ss-card" style="flex:1;min-width:120px;background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:14px">
        <div style="font-size:12px;color:var(--text3)">Начальный остаток</div>
        <div style="font-size:20px;font-weight:700">${fmtL(b.init)} л</div>
        <div style="font-size:12px;color:var(--text3);margin-top:10px">Приход всего</div>
        <div style="font-size:18px;font-weight:700;color:var(--green)">+${fmtL(b.income)} л</div>
      </div>
      <div class="ss-card" style="flex:1;min-width:120px;background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:14px">
        <div style="font-size:12px;color:var(--text3)">Выдано в ДЭС</div>
        <div style="font-size:20px;font-weight:700;color:var(--red)">−${fmtL(b.issued)} л</div>
        <div style="font-size:12px;color:var(--text3);margin-top:10px">Привязано ДЭС</div>
        <div style="font-size:18px;font-weight:700">${boundGens.length}</div>
      </div>
    </div>
    <div class="ss-title" style="margin:18px 0 8px">Журнал прихода топлива</div>
    <table class="data-table" style="width:100%">
      <thead><tr><th>Дата</th><th style="text-align:right">Количество</th><th>Источник</th><th>Примечание</th><th></th></tr></thead>
      <tbody>${incRows}</tbody>
    </table>
    <div class="ss-title" style="margin:22px 0 4px">Привязанные ДЭС (выдача из ёмкости)</div>
    <div style="border:1px solid var(--border);border-radius:10px;overflow:hidden">${boundHtml}</div>`;
}

// Подсказки объектов для ёмкости (из ТС, местонахождений ДЭС и ёмкостей)
function populateTankObjectList() {
  const dl = document.getElementById('tk_object_list');
  if (!dl) return;
  const set = new Set();
  (data.vehicles || []).forEach(v => { if (v.object) set.add(v.object.trim()); });
  (data.generators || []).forEach(g => { if (g.location) set.add(g.location.trim()); });
  (data.tanks || []).forEach(t => { if (t.object) set.add(t.object.trim()); });
  dl.innerHTML = Array.from(set).sort((a,b)=>a.toLowerCase()<b.toLowerCase()?-1:1)
    .map(o => `<option value="${o.replace(/"/g,'&quot;')}">`).join('');
}

// Заполнить выпадающий список ёмкостей в карточке ДЭС
function populateGenTankSelect(selected) {
  const sel = document.getElementById('gm_tank');
  if (!sel) return;
  const tanks = tanksAll();
  sel.innerHTML = '<option value="">— не привязана —</option>' +
    tanks.map(t => `<option value="${t.id}"${t.id === selected ? ' selected' : ''}>${(t.name||'').replace(/</g,'&lt;')}${t.location ? ' ('+t.location+')' : ''}</option>`).join('');
  sel.value = selected || '';
}

// ─── TANK CRUD ───────────────────────────────────────────
function openAddTank() {
  editingTankId = null;
  document.getElementById('tankModalTitle').textContent = 'Добавить ёмкость';
  document.getElementById('tankDeleteBtn').style.display = 'none';
  ['tk_name','tk_serial','tk_location','tk_object','tk_owner','tk_note'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('tk_fuel').value = 'diesel';
  ['tk_capacity','tk_balance'].forEach(id => document.getElementById(id).value = '');
  populateTankObjectList();
  openModal('tankModal');
}

function openEditTank(id) {
  const t = tanksAll().find(x => x.id === id);
  if (!t) return;
  editingTankId = id;
  document.getElementById('tankModalTitle').textContent = 'Редактировать ёмкость';
  document.getElementById('tankDeleteBtn').style.display = '';
  document.getElementById('tk_name').value     = t.name || '';
  document.getElementById('tk_serial').value   = t.serial || '';
  document.getElementById('tk_fuel').value     = t.fuel || 'diesel';
  document.getElementById('tk_capacity').value = t.capacity ?? '';
  document.getElementById('tk_balance').value  = t.balanceInit ?? '';
  document.getElementById('tk_location').value = t.location || '';
  document.getElementById('tk_object').value   = t.object || '';
  document.getElementById('tk_owner').value    = t.owner || '';
  document.getElementById('tk_note').value     = t.note || '';
  populateTankObjectList();
  openModal('tankModal');
}

function saveTank() {
  const name = document.getElementById('tk_name').value.trim();
  if (!name) { showFieldError('Укажите наименование ёмкости', 'tk_name'); return; }
  if (!data.tanks) data.tanks = [];
  const obj = {
    name,
    serial:      document.getElementById('tk_serial').value.trim(),
    fuel:        document.getElementById('tk_fuel').value,
    capacity:    parseFloat(document.getElementById('tk_capacity').value) || null,
    balanceInit: parseFloat(document.getElementById('tk_balance').value)  || 0,
    location:    document.getElementById('tk_location').value.trim(),
    object:      document.getElementById('tk_object').value.trim(),
    owner:       document.getElementById('tk_owner').value.trim(),
    note:        document.getElementById('tk_note').value.trim(),
  };
  if (editingTankId) {
    Object.assign(data.tanks.find(x => x.id === editingTankId), obj);
  } else {
    obj.id = 't_' + Date.now();
    data.tanks.push(obj);
    selectedTankId = obj.id;
  }
  saveData(data);
  closeModal('tankModal');
  renderTankList();
  const t = tanksAll().find(x => x.id === selectedTankId);
  if (t) renderTankDetail(t);
}

function deleteTank(id) {
  const t = tanksAll().find(x => x.id === id);
  if (!t) return;
  const bound = (data.generators || []).filter(g => g.tankId === id);
  let msg = 'Удалить ёмкость «' + t.name + '» и весь её журнал прихода?';
  if (bound.length) msg += '\n\nПривязка у ' + bound.length + ' ДЭС будет снята.';
  if (!confirm(msg)) return;
  data.tanks = (data.tanks || []).filter(x => x.id !== id);
  data.tankIncomes = (data.tankIncomes || []).filter(r => r.tankId !== id);
  (data.generators || []).forEach(g => { if (g.tankId === id) g.tankId = null; });
  saveData(data);
  closeModal('tankModal');
  selectedTankId = null;
  renderTankList();
  document.getElementById('mainContent').innerHTML = `<div class="welcome">
    <svg width="72" height="72" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1"><path d="M5 8h14M5 8a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v1a2 2 0 01-2 2M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8"/></svg>
    <h2>Выберите ёмкость</h2><p>Выберите ёмкость из списка слева или добавьте новую</p></div>`;
}

// ─── TANK INCOME (приход) ────────────────────────────────
function openAddTankIncome() {
  if (!selectedTankId) return;
  editingTankIncomeId = null;
  document.getElementById('tankIncomeModalTitle').textContent = 'Приход топлива';
  document.getElementById('ti_date').value = fmtDate(new Date().toISOString().split('T')[0]);
  ['ti_amount','ti_source','ti_note'].forEach(id => document.getElementById(id).value = '');
  openModal('tankIncomeModal');
}

function openEditTankIncome(id) {
  const r = (data.tankIncomes || []).find(x => x.id === id);
  if (!r) return;
  editingTankIncomeId = id;
  document.getElementById('tankIncomeModalTitle').textContent = 'Изменить приход';
  document.getElementById('ti_date').value   = fmtDate(r.date);
  document.getElementById('ti_amount').value = r.amount ?? '';
  document.getElementById('ti_source').value = r.source || '';
  document.getElementById('ti_note').value   = r.note || '';
  openModal('tankIncomeModal');
}

function saveTankIncome() {
  const date = parseDate(document.getElementById('ti_date').value.trim());
  const amount = parseFloat(document.getElementById('ti_amount').value);
  if (!date) { showFieldError('Укажите дату в формате ДД.ММ.ГГГГ', 'ti_date'); return; }
  if (!amount || amount <= 0) { showFieldError('Укажите количество (л)', 'ti_amount'); return; }
  if (!data.tankIncomes) data.tankIncomes = [];
  const obj = {
    tankId: selectedTankId, date, amount,
    source: document.getElementById('ti_source').value.trim(),
    note:   document.getElementById('ti_note').value.trim(),
  };
  if (editingTankIncomeId) {
    Object.assign(data.tankIncomes.find(x => x.id === editingTankIncomeId), obj);
  } else {
    obj.id = 'ti_' + Date.now();
    data.tankIncomes.push(obj);
  }
  saveData(data);
  closeModal('tankIncomeModal');
  const t = tanksAll().find(x => x.id === selectedTankId);
  if (t) renderTankDetail(t);
  renderTankList();
}

function deleteTankIncome(id) {
  if (!confirm('Удалить запись прихода?')) return;
  data.tankIncomes = (data.tankIncomes || []).filter(r => r.id !== id);
  saveData(data);
  const t = tanksAll().find(x => x.id === selectedTankId);
  if (t) renderTankDetail(t);
  renderTankList();
}

