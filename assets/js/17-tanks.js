// Топливные ёмкости и приход топлива
// Выделено из index.html

// ═══════════════════════════════════════════════════════
// ЁМКОСТИ (топливные) — привязаны к ДЭС
// ═══════════════════════════════════════════════════════
let genSubView = 'generators';
let selectedTankId = null;
let editingTankId = null;
let editingTankIncomeId = null;
let tankShowArchived = false;

const TANK_FUEL_LABELS = { diesel:'Дизель', gasoline:'Бензин', gas:'Газ' };

function tanksAll() { return data.tanks || []; }

function tankReserveState(tank, balance) {
  if(balance===null)return {level:'unstarted',color:'var(--text3)',label:'Топливный учёт ещё не начат'};
  const reserve = Number(tank.reserveLevel);
  if (balance < 0) return { level:'negative', color:'var(--red)', label:'Отрицательный расчётный остаток' };
  if (Number.isFinite(reserve) && reserve > 0 && balance <= reserve) return { level:'low', color:'var(--yellow)', label:'Достигнут резерв ' + reserve.toLocaleString('ru') + ' л' };
  return { level:'normal', color:'var(--green)', label:reserve > 0 ? 'Резерв ' + reserve.toLocaleString('ru') + ' л' : 'Порог резерва не задан' };
}

function tankToggleArchive() { tankShowArchived = !tankShowArchived; renderTankList(); }

// Остаток ёмкости = начальный + приход − выдано в привязанные ДЭС
function computeTankBalance(tankId) {
  const t = tanksAll().find(x => x.id === tankId);
  if (!t) return { init:0, income:0, issued:0, balance:0, capacity:0, fillPct:0 };
  const accounting=fuelAccountingFor('tanks',t);
  if(accounting.mode==='explicit'){
    const today=dispatcherLocalDate(),active=row=>row.date<=today&&fuelAccountingIncludes('tanks',t,row.date);
    const init=fuelAccountingOpening('tanks',t,today);
    const flows=DomainSources.projectTankFlows(data,[tankId],{accounting:true,to:today});
    const income=DecimalCore.toNumberExact(DecimalCore.sum(flows.filter(row=>row.sourceSection==='tankIncomes').map(row=>row.amount)));
    const movements=DecimalCore.toNumberExact(DecimalCore.sum(flows.filter(row=>row.sourceSection!=='tankIncomes').map(row=>row.amount)));
    const issued=DecimalCore.toNumberExact(DecimalCore.sum((data.genRecords||[]).filter(row=>genRecordTankId(row)===tankId&&active(row)).map(row=>row.fuelIssued??0)));
    const balance=init===null?null:DecimalCore.toNumberExact(DecimalCore.sub(DecimalCore.sum([init,income,movements]),issued)),capacity=t.capacity||0;
    return {init,income,movements,issued,balance,capacity,fillPct:capacity>0&&balance!==null?Math.max(0,Math.min(100,Math.round(balance/capacity*100))):0,accountingFrom:accounting.from};
  }
  const income = DecimalCore.toNumberExact(DecimalCore.sum((data.tankIncomes || []).filter(r => r.tankId === tankId).map(r=>r.amount??0)));
  const issued = DecimalCore.toNumberExact(DecimalCore.sum((data.genRecords || []).filter(r => genRecordTankId(r) === tankId).map(r=>r.fuelIssued??0)));
  const init = t.balanceInit ?? 0;
  const movements = DecimalCore.toNumberExact((data.fuelMovements || []).filter(r => !r.deleted && !r.cancelled && (r.toTankId===tankId||r.fromTankId===tankId)).reduce((sum,r) => {
    const qty = Number(r.qty);
    if (!Number.isFinite(qty) || qty < 0) throw Error('Некорректные литры в движении топлива '+r.id);
    return DecimalCore.sub(DecimalCore.add(sum,r.toTankId===tankId?qty:0),r.fromTankId===tankId?qty:0);
  }, '0'));
  const balance = DecimalCore.toNumberExact(DecimalCore.sub(DecimalCore.sum([init,income,movements]),issued));
  const capacity = t.capacity || 0;
  const fillPct = capacity > 0 ? Math.max(0, Math.min(100, Math.round(balance / capacity * 100))) : 0;
  return { init, income, issued, movements, balance, capacity, fillPct };
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
  const tanks = tanksAll().filter(t => !!t.archived === tankShowArchived);
  const archiveButton = `<button class="btn btn-ghost btn-sm" onclick="tankToggleArchive()" style="margin:8px">${tankShowArchived ? 'Рабочие ёмкости' : 'Архив (' + tanksAll().filter(t => t.archived).length + ')'}</button>`;
  if (!tanks.length) {
    list.innerHTML = archiveButton + `<div class="empty-list">
      <svg width="40" height="40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" style="display:block;margin:0 auto 8px"><path d="M5 8h14M5 8a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v1a2 2 0 01-2 2M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8"/></svg>
      ${tankShowArchived ? 'Архив ёмкостей пуст.' : 'Нет ёмкостей.<br>Нажмите «Добавить ёмкость»'}</div>`;
    return;
  }
  const sorted = tanks.slice().sort((a,b) => (a.name||'').toLowerCase() < (b.name||'').toLowerCase() ? -1 : 1);
  let html = archiveButton;
  sorted.forEach(t => {
    const b = computeTankBalance(t.id);
    const balColor = tankReserveState(t, b.balance).color;
    const boundCount = (data.generators || []).filter(g => g.tankId === t.id).length;
    html += `<div class="vehicle-card ${selectedTankId === t.id ? 'active' : ''}" onclick="selectTank(${htmlJs(t.id)})" style="display:flex;flex-direction:column">
      <div style="flex:1;min-width:0;overflow:hidden">
        <div class="vc-make" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${htmlEsc(t.name)}${t.archived ? ' · архив' : ''}</div>
        ${t.serial ? `<div class="vc-driver" style="font-family:'Courier New',monospace;letter-spacing:0.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Зав.№ ${htmlEsc(t.serial)}</div>` : ''}
        ${t.object ? `<div class="vc-driver" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Объект: ${htmlEsc(t.object)}</div>` : ''}
        ${t.location ? `<div class="vc-driver" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${htmlEsc(t.location)}</div>` : ''}
        ${t.capacity ? `<div class="vc-org">Объём: ${t.capacity.toLocaleString('ru')} л</div>` : ''}
      </div>
      ${t.capacity ? `<div style="height:6px;background:var(--border);border-radius:4px;margin-top:8px;overflow:hidden"><div style="height:100%;width:${b.fillPct}%;background:${balColor}"></div></div>` : ''}
      <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:8px;align-items:center">
        <div style="font-size:11px;font-weight:700;color:${balColor};background:${balColor}1a;border:1px solid ${balColor}4d;padding:3px 9px;border-radius:20px;white-space:nowrap">${b.balance===null?'Учёт ещё не начат':b.balance.toLocaleString('ru',{maximumFractionDigits:3})+' л'}</div>
        <span class="fuel-tag ${htmlEsc(t.fuel||'diesel')}" style="font-size:11px;padding:3px 9px">${TANK_FUEL_LABELS[t.fuel||'diesel']}</span>
        <div class="vc-badge">ДЭС: ${boundCount}</div>
      </div>
    </div>`;
  });
  list.innerHTML = html;
}

function selectTank(id) {
  selectedTankId = id;
  const found = tanksAll().find(t => t.id === id);
  if (found) tankShowArchived = !!found.archived;
  renderTankList();
  const t = tanksAll().find(x => x.id === id);
  if (t) renderTankDetail(t);
}

function renderTankDetail(t) {
  const b = computeTankBalance(t.id);
  const reserveState = tankReserveState(t, b.balance);
  const balColor = reserveState.color;
  const incomes = (data.tankIncomes || []).filter(r => r.tankId === t.id).sort((a, b2) => cmpDateDesc(a.date, b2.date));
  const boundGens = (data.generators || []).filter(g => g.tankId === t.id);
  const fmtL = x => precisionFormat(x);

  const fmtR = x => precisionFormat(x,{minimumScale:2});
  const tankName = id => { const q = tanksAll().find(x => x.id === id); return q ? (q.object || q.name) : '—'; };
  let incRows = incomes.length ? incomes.map(r => {
    const isMove = r.kind === 'in' || r.kind === 'out';
    const neg = (r.amount || 0) < 0;
    const col = neg ? 'var(--red)' : 'var(--green)';
    const label = isMove
      ? (r.kind === 'out' ? 'Перемещение на ' : 'Перемещение с ') + tankName(r.counterTankId)
      : (r.source || '—');
    return `<tr>
      <td>${fmtDate(r.date)}${isMove ? ' <span style="font-size:10px;color:var(--text3);border:1px solid var(--border);border-radius:4px;padding:1px 4px">перемещение</span>' : ''}${fuelAccountingIncludes('tanks',t,r.date)?'':'<small> · До начала учёта</small>'}</td>
      <td style="text-align:right;font-weight:600;color:${col}">${neg ? '−' : '+'}${fmtL(Math.abs(r.amount))} л</td>
      <td style="text-align:right;white-space:nowrap">${r.sum ? fmtR(Math.abs(r.sum)) + ' ₽' : ''}</td>
      <td>${htmlEsc(label)}</td>
      <td>${htmlEsc(r.note || '')}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="icon-btn" onclick="openEditTankIncome(${htmlJs(r.id)})" title="Изменить"><svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z"/></svg></button>
        <button class="icon-btn" onclick="deleteTankIncome(${htmlJs(r.id)})" title="Удалить"><svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>
      </td>
    </tr>`; }).join('') : `<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:14px">Нет записей прихода</td></tr>`;

  const boundHtml = boundGens.length ? boundGens.map(g => {
    const issued = (data.genRecords || []).filter(r => r.generatorId === g.id && genRecordTankId(r) === t.id&&fuelAccountingCurrentIncludes('tanks',t,r.date)).reduce((s,r) => s + (r.fuelIssued || 0), 0);
    return `<div style="display:flex;justify-content:space-between;padding:7px 12px;border-bottom:1px solid var(--border);font-size:13px;cursor:pointer" onclick="switchGenSubView('generators');selectGenerator(${htmlJs(g.id)})">
      <span>${htmlEsc(g.name)}${g.location ? ` <span style="color:var(--text3)">· ${htmlEsc(g.location)}</span>` : ''}</span>
      <span style="color:var(--red);font-weight:600;white-space:nowrap">−${fmtL(issued)} л</span>
    </div>`;
  }).join('') : `<div style="padding:12px;color:var(--text3);font-size:13px">Нет привязанных ДЭС. Привяжите в карточке ДЭС (поле «Ёмкость»).</div>`;

  document.getElementById('mainContent').innerHTML = `
    <div class="vehicle-detail-header">
      <div>
        <h1 style="margin:0">${htmlEsc(t.name)}${t.archived ? ' · архив' : ''}</h1>
        <div style="color:var(--text3);font-size:13px;margin-top:3px">${TANK_FUEL_LABELS[t.fuel||'diesel']}${t.location ? ' · '+ htmlEsc(t.location) : ''}${t.capacity ? ' · объём '+t.capacity.toLocaleString('ru')+' л' : ''}</div>
        <div style="color:var(--text3);font-size:13px;margin-top:2px">${t.serial ? 'Зав.№ '+ htmlEsc(t.serial) : ''}${t.object ? (t.serial?' · ':'')+'Объект: '+ htmlEsc(t.object) : ''}${t.owner ? ((t.serial||t.object)?' · ':'')+'Собственник: '+ htmlEsc(t.owner) : ''}</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost" onclick="fuelAccountingOpen('tanks',${htmlEsc(JSON.stringify(t.id))})">Начало учёта ГСМ</button>
        ${t.archived ? `<button class="btn btn-primary" onclick="restoreTank(${htmlJs(t.id)})">Восстановить из архива</button>` : `<button class="btn btn-primary" onclick="openAddTankIncome()">Приход</button><button class="btn btn-ghost" onclick="openTankTransfer()">Перемещение</button>`}
        <button class="btn btn-ghost" onclick="openEditTank(${htmlJs(t.id)})"><svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z"/></svg> Изменить</button>
      </div>
    </div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;margin:16px 0">
      <div class="ss-card" style="flex:1;min-width:150px;background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:14px">
        <div style="font-size:12px;color:var(--text3)">Остаток</div>
        <div style="font-size:26px;font-weight:800;color:${balColor}">${fmtL(b.balance)} <span style="font-size:14px">л</span></div>
        <div style="font-size:12px;color:var(--text3);margin-top:6px">${htmlEsc(reserveState.label)}<br>${fuelAccountingStatusHtml('tanks',t)}</div>
        ${b.capacity ? `<div style="height:8px;background:var(--border);border-radius:5px;margin-top:8px;overflow:hidden"><div style="height:100%;width:${b.fillPct}%;background:${balColor}"></div></div><div style="font-size:11px;color:var(--text3);margin-top:4px">${b.fillPct}% от ${b.capacity.toLocaleString('ru')} л</div>` : ''}
      </div>
      <div class="ss-card" style="flex:1;min-width:120px;background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:14px">
        <div style="font-size:12px;color:var(--text3)">Начальный остаток</div>
        <div style="font-size:20px;font-weight:700">${fmtL(b.init)} л</div>
        <div style="font-size:12px;color:var(--text3);margin-top:10px">Приход всего</div>
        <div style="font-size:18px;font-weight:700;color:var(--green)">+${fmtL(b.income)} л</div>
        ${b.movements ? `<div style="font-size:12px;color:var(--text3)">Дополнительные движения: ${fmtL(b.movements)} л</div>` : ''}
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
      <thead><tr><th>Дата</th><th style="text-align:right">Количество</th><th style="text-align:right">Сумма</th><th>Источник</th><th>Примечание</th><th></th></tr></thead>
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
  const tanks = tanksAll().filter(t => !t.archived || t.id === selected);
  sel.innerHTML = '<option value="">— не привязана —</option>' +
    tanks.map(t => `<option value="${htmlEsc(t.id)}"${t.id === selected ? ' selected' : ''}>${(t.name||'').replace(/</g,'&lt;')}${t.location ? ' ('+ htmlEsc(t.location)+')' : ''}</option>`).join('');
  sel.value = selected || '';
}

// ─── TANK CRUD ───────────────────────────────────────────
function openAddTank() {
  editingTankId = null;
  document.getElementById('tankModalTitle').textContent = 'Добавить ёмкость';
  document.getElementById('tankDeleteBtn').style.display = 'none';
  ['tk_name','tk_serial','tk_location','tk_object','tk_owner','tk_note'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('tk_fuel').value = 'diesel';
  ['tk_capacity','tk_balance','tk_reserve'].forEach(id => document.getElementById(id).value = '');
  populateTankObjectList();
  openModal('tankModal');
}

function openEditTank(id) {
  const t = tanksAll().find(x => x.id === id);
  if (!t) return;
  editingTankId = id;
  document.getElementById('tankModalTitle').textContent = 'Редактировать ёмкость';
  document.getElementById('tankDeleteBtn').style.display = '';
  document.getElementById('tankDeleteBtn').textContent = t.archived ? 'В архиве' : 'В архив';
  document.getElementById('tankDeleteBtn').disabled = !!t.archived;
  document.getElementById('tk_name').value     = t.name || '';
  document.getElementById('tk_serial').value   = t.serial || '';
  document.getElementById('tk_fuel').value     = t.fuel || 'diesel';
  document.getElementById('tk_capacity').value = t.capacity ?? '';
  document.getElementById('tk_balance').value  = t.balanceInit ?? '';
  document.getElementById('tk_reserve').value  = t.reserveLevel ?? '';
  document.getElementById('tk_location').value = t.location || '';
  document.getElementById('tk_object').value   = t.object || '';
  document.getElementById('tk_owner').value    = t.owner || '';
  document.getElementById('tk_note').value     = t.note || '';
  populateTankObjectList();
  openModal('tankModal');
}

async function saveTank() {
  const name = document.getElementById('tk_name').value.trim();
  if (!name) { showFieldError('Укажите наименование ёмкости', 'tk_name'); return; }
  const numeric=precisionRead({capacity:['tk_capacity',3],balanceInit:['tk_balance',3,'zero'],reserveLevel:['tk_reserve',3]},editingTankId==null?null:tanksAll().find(t=>t.id===editingTankId));if(!numeric)return;
  if (!data.tanks) data.tanks = [];
  const obj = {
    name, ...numeric,
    serial:      document.getElementById('tk_serial').value.trim(),
    fuel:        document.getElementById('tk_fuel').value,
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
  if (!await saveData(data)) return;
  closeModal('tankModal');
  renderTankList();
  const t = tanksAll().find(x => x.id === selectedTankId);
  if (t) renderTankDetail(t);
}

async function deleteTank(id) {
  const t = tanksAll().find(x => x.id === id);
  if (!t) return;
  if (t.archived) return;
  if (!await confirmAction('Переместить ёмкость «' + t.name + '» в архив? Все остатки, приходы, перемещения и связи с ДЭС сохранятся. Для новых операций ёмкость нужно восстановить.')) return;
  t.archived = true;
  t.archivedAt = new Date().toISOString();
  if (!await saveData(data)) return;
  closeModal('tankModal');
  selectedTankId = null;
  renderTankList();
  document.getElementById('mainContent').innerHTML = `<div class="welcome">
    <svg width="72" height="72" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1"><path d="M5 8h14M5 8a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v1a2 2 0 01-2 2M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8"/></svg>
    <h2>Выберите ёмкость</h2><p>Выберите ёмкость из списка слева или добавьте новую</p></div>`;
}

async function restoreTank(id) {
  const t = tanksAll().find(x => x.id === id);
  if (!t?.archived) return;
  if (!await confirmAction('Восстановить ёмкость «' + t.name + '» из архива?')) return;
  t.archived = false;
  t.restoredAt = new Date().toISOString();
  if (!await saveData(data)) return;
  tankShowArchived = false;
  selectTank(id);
  showToast('Ёмкость восстановлена');
}

// ─── TANK INCOME (приход) ────────────────────────────────
function openAddTankIncome() {
  if (!selectedTankId) return;
  if (tanksAll().find(t => t.id === selectedTankId)?.archived) { showToast('Восстановите ёмкость для новых операций'); return; }
  editingTankIncomeId = null;
  document.getElementById('tankIncomeModalTitle').textContent = 'Приход топлива';
  document.getElementById('ti_date').value = fmtDate(new Date().toISOString().split('T')[0]);
  ['ti_amount','ti_source','ti_note','ti_sum'].forEach(id => document.getElementById(id).value = '');
  openModal('tankIncomeModal');
}

function openEditTankIncome(id) {
  const r = (data.tankIncomes || []).find(x => x.id === id);
  if (!r) return;
  if (r.kind === 'in' || r.kind === 'out') {
    alert('Это половина перемещения между ёмкостями. Удалите его и создайте заново — иначе вторая сторона останется несогласованной.');
    return;
  }
  editingTankIncomeId = id;
  document.getElementById('tankIncomeModalTitle').textContent = 'Изменить приход';
  document.getElementById('ti_date').value   = fmtDate(r.date);
  document.getElementById('ti_amount').value = r.amount ?? '';
  document.getElementById('ti_source').value = r.source || '';
  document.getElementById('ti_note').value   = r.note || '';
  document.getElementById('ti_sum').value    = r.sum ?? '';
  openModal('tankIncomeModal');
}

async function saveTankIncome() {
  if (tanksAll().find(t => t.id === selectedTankId)?.archived) { showToast('Восстановите ёмкость для изменения операций'); return; }
  const date = parseDate(document.getElementById('ti_date').value.trim());
  const numeric=precisionRead({amount:['ti_amount',3,'error'],sum:['ti_sum',2,'zero']},editingTankIncomeId==null?null:(data.tankIncomes||[]).find(r=>r.id===editingTankIncomeId));if(!numeric)return;
  const {amount,sum}=numeric;
  if (!date) { showFieldError('Укажите дату в формате ДД.ММ.ГГГГ', 'ti_date'); return; }
  if (!amount || amount <= 0) { showFieldError('Укажите количество (л)', 'ti_amount'); return; }
  if (!data.tankIncomes) data.tankIncomes = [];
  const obj = {
    tankId: selectedTankId, date, amount,
    source: document.getElementById('ti_source').value.trim(),
    note:   document.getElementById('ti_note').value.trim(),
    sum,
  };
  if (editingTankIncomeId) {
    Object.assign(data.tankIncomes.find(x => x.id === editingTankIncomeId), obj);
  } else {
    obj.id = 'ti_' + Date.now();
    data.tankIncomes.push(obj);
  }
  if (!await saveData(data)) return;
  closeModal('tankIncomeModal');
  const t = tanksAll().find(x => x.id === selectedTankId);
  if (t) renderTankDetail(t);
  renderTankList();
}

async function deleteTankIncome(id) {
  const r = (data.tankIncomes || []).find(x => x.id === id);
  if (r && tanksAll().find(t => t.id === r.tankId)?.archived) { showToast('Для изменения истории восстановите ёмкость из архива'); return; }
  // У перемещения две половины: минус на ёмкости-источнике и плюс на приёмнике.
  // Удаляем обе разом, иначе топливо появится или исчезнет из ниоткуда.
  if (r && r.linkId) {
    if (!await confirmAction('Это перемещение между ёмкостями. Удалить его целиком — обе стороны?')) return;
    data.tankIncomes = (data.tankIncomes || []).filter(x => x.linkId !== r.linkId);
  } else {
    if (!await confirmAction('Удалить запись прихода?')) return;
    data.tankIncomes = (data.tankIncomes || []).filter(x => x.id !== id);
  }
  if (!await saveData(data)) return;
  const t = tanksAll().find(x => x.id === selectedTankId);
  if (t) renderTankDetail(t);
  renderTankList();
}

// ─── ПЕРЕМЕЩЕНИЕ ТОПЛИВА МЕЖДУ ЁМКОСТЯМИ ─────────────────
// Хранится двумя связанными записями в tankIncomes: минус на ёмкости-источнике
// и плюс на приёмнике. Тогда остаток обеих считается существующей формулой
// «начальный + сумма приходов − выдано в ДЭС», пересчитывать ничего не нужно.
// Половины связаны полем linkId и удаляются только вместе.

function openTankTransfer() {
  if (!selectedTankId) return;
  if (tanksAll().find(t => t.id === selectedTankId)?.archived) { showToast('Восстановите ёмкость для новых операций'); return; }
  const others = tanksAll().filter(t => t.id !== selectedTankId && !t.archived);
  if (!others.length) { alert('Нужна хотя бы ещё одна ёмкость, чтобы переместить топливо.'); return; }
  document.getElementById('tt_date').value = fmtDate(new Date().toISOString().split('T')[0]);
  ['tt_amount','tt_sum','tt_note'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('tt_dir').value = 'out';
  document.getElementById('tt_counter').innerHTML = others.map(t =>
    `<option value="${htmlEsc(t.id)}">${htmlEsc(t.object || t.name)} — ${htmlEsc(t.name)}</option>`).join('');
  document.getElementById('tt_counter').onchange = renderTransferHint;
  renderTransferHint();
  openModal('tankTransferModal');
}

function renderTransferHint() {
  const dir = document.getElementById('tt_dir').value;
  const here = tanksAll().find(t => t.id === selectedTankId);
  const other = tanksAll().find(t => t.id === document.getElementById('tt_counter').value);
  document.getElementById('tt_counterLabel').textContent =
    dir === 'out' ? 'Ёмкость-получатель *' : 'Ёмкость-источник *';
  if (!here || !other) { document.getElementById('tt_hint').textContent = ''; return; }
  const from = dir === 'out' ? here : other, to = dir === 'out' ? other : here;
  document.getElementById('tt_hint').innerHTML =
    `Спишется с <b>${htmlEsc(from.object || from.name)}</b> (остаток ${computeTankBalance(from.id).balance.toLocaleString('ru')} л), ` +
    `поступит на <b>${htmlEsc(to.object || to.name)}</b> (остаток ${computeTankBalance(to.id).balance.toLocaleString('ru')} л). ` +
    `Создадутся две связанные записи.`;
}

async function saveTankTransfer() {
  const date = parseDate(document.getElementById('tt_date').value.trim());
  const numeric=precisionRead({amount:['tt_amount',3,'error'],sum:['tt_sum',2,'zero']});if(!numeric)return;
  const {amount,sum}=numeric;
  const note = document.getElementById('tt_note').value.trim();
  const dir = document.getElementById('tt_dir').value;
  const otherId = document.getElementById('tt_counter').value;
  if (!date) { showFieldError('Укажите дату в формате ДД.ММ.ГГГГ', 'tt_date'); return; }
  if (!amount || amount <= 0) { showFieldError('Укажите количество (л)', 'tt_amount'); return; }
  if (!otherId || otherId === selectedTankId) { showFieldError('Выберите другую ёмкость', 'tt_counter'); return; }
  const fromId = dir === 'out' ? selectedTankId : otherId;
  const toId   = dir === 'out' ? otherId : selectedTankId;
  const fromT = tanksAll().find(t => t.id === fromId);
  const toT = tanksAll().find(t => t.id === toId);
  if (!fromT || !toT || fromT.archived || toT.archived) { showToast('Для перемещения нужны две действующие ёмкости'); return; }
  if ((fromT.fuel || 'diesel') !== (toT.fuel || 'diesel')) { showToast('Перемещение между ёмкостями разных видов топлива запрещено'); return; }
  const bal = typeof wfTankBalanceAt === 'function' ? wfTankBalanceAt(fromId, date) : computeTankBalance(fromId).balance;
  if (amount > bal && !confirm(`На «${fromT.object || fromT.name}» остаток ${bal.toLocaleString('ru')} л, а перемещается ${amount.toLocaleString('ru')} л. Остаток уйдёт в минус. Продолжить?`)) return;
  addTankTransfer({ fromId, toId, date, amount, sum, note });
  if (!await saveData(data)) return;
  closeModal('tankTransferModal');
  const t = tanksAll().find(x => x.id === selectedTankId);
  if (t) renderTankDetail(t);
  renderTankList();
  showToast('Перемещено ' + amount.toLocaleString('ru') + ' л');
}

// Создаёт пару записей. Вынесено отдельно, чтобы можно было переносить перемещения и из импорта.
function addTankTransfer({ fromId, toId, date, amount, sum, note }) {
  if (!data.tankIncomes) data.tankIncomes = [];
  const link = 'tr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const nameOf = id => { const q = tanksAll().find(x => x.id === id); return q ? (q.object || q.name) : ''; };
  data.tankIncomes.push({
    id: link + '_out', linkId: link, kind: 'out', tankId: fromId, counterTankId: toId,
    date, amount: -Math.abs(amount), sum: -Math.abs(sum || 0),
    source: 'Перемещение на ' + nameOf(toId), note: note || '',
  });
  data.tankIncomes.push({
    id: link + '_in', linkId: link, kind: 'in', tankId: toId, counterTankId: fromId,
    date, amount: Math.abs(amount), sum: Math.abs(sum || 0),
    source: 'Перемещение с ' + nameOf(fromId), note: note || '',
  });
  return link;
}
