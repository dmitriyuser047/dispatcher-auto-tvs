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

function tankReserveState(tank, balance,status) {
  if(balance===null)return {level:status==='outside-accounting'?'unstarted':'unknown',color:'var(--text3)',label:status==='outside-accounting'?'Топливный учёт ещё не начат':'Расчётный остаток не определён. Проверьте источники.'};
  const reserve = Number(tank.reserveLevel);
  if (balance < 0) return { level:'negative', color:'var(--red)', label:'Отрицательный расчётный остаток' };
  if (Number.isFinite(reserve) && reserve > 0 && balance <= reserve) return { level:'low', color:'var(--yellow)', label:'Достигнут резерв ' + reserve.toLocaleString('ru') + ' л' };
  return { level:'normal', color:'var(--green)', label:reserve > 0 ? 'Резерв ' + reserve.toLocaleString('ru') + ' л' : 'Порог резерва не задан' };
}

function tankToggleArchive() { tankShowArchived = !tankShowArchived; renderTankList(); }

// Остаток ёмкости = начальный + приход − выдано в привязанные ДЭС
function computeTankBalance(tankId) {
  if(!tankStockReadAllowed())return{init:null,income:null,issued:null,movements:null,received:null,outgoing:null,balance:null,capacity:null,status:'unknown',fillPct:0,diagnostics:[{code:'ACCESS_DENIED',message:'Недостаточно доступа для проверки источников остатка ёмкости.'}]};
  const tank=tanksAll().find(row=>row.id===tankId);if(!tank)return{init:null,income:null,issued:null,movements:null,received:null,outgoing:null,balance:null,capacity:null,status:'invalid',fillPct:0,diagnostics:[{code:'STOCK_TARGET_MISSING',message:'Ёмкость-источник не найдена. Проверьте историческую привязку ДЭС.'}]};
  const snapshot=tankStockSnapshot(),stock=tankStockAt(tankId,dispatcherLocalDate(),true,snapshot),events=tankStockEvents(tankId,dispatcherLocalDate(),snapshot),sum=rows=>DecimalCore.toNumberExact(DecimalCore.sum(rows.map(row=>row.deltaDecimal)));
  const init=stock.openingDecimal==null||stock.diagnostics.some(issue=>issue.code==='STOCK_OPENING_INVALID')?null:DecimalCore.toNumberExact(stock.openingDecimal),income=sum(events.filter(row=>row.source.section==='tankIncomes')),
    issued=DecimalCore.toNumberExact(DecimalCore.sub(0,sum(events.filter(row=>row.source.section==='genRecords')))),movements=sum(events.filter(row=>row.source.section==='fuelMovements')),
    balance=stock.balance,capacity=tank.capacity??0;
  const received=sum(events.filter(row=>row.stockAffects&&DecimalCore.compare(row.deltaDecimal,0)>0)),outgoing=DecimalCore.toNumberExact(DecimalCore.sub(0,sum(events.filter(row=>row.stockAffects&&DecimalCore.compare(row.deltaDecimal,0)<0))));
  return {init,income,issued,movements,received,outgoing,balance,capacity,status:stock.status,diagnostics:stock.diagnostics||[],fillPct:capacity>0&&balance!==null?Math.max(0,Math.min(100,Math.round(balance/capacity*100))):0};
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

function renderTankList() {return tankStockWithSnapshot(()=>renderTankListProjected());}
function renderTankListProjected() {
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
    const balColor = tankReserveState(t, b.balance,b.status).color;
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
        <div style="font-size:11px;font-weight:700;color:${balColor};background:${balColor}1a;border:1px solid ${balColor}4d;padding:3px 9px;border-radius:20px;white-space:nowrap">${b.balance===null?(b.status==='outside-accounting'?'Учёт ещё не начат':'Остаток не определён'):b.balance.toLocaleString('ru',{maximumFractionDigits:3})+' л'}</div>
        <span class="fuel-tag ${htmlEsc(t.fuel||'diesel')}" style="font-size:11px;padding:3px 9px">${TANK_FUEL_LABELS[t.fuel||'diesel']}</span>
        <div class="vc-badge">ДЭС: ${boundCount}</div>
      </div>
    </div>`;
  });
  list.innerHTML = html;
}

function selectTank(id){return tankStockWithSnapshot(()=>selectTankProjected(id));}
function selectTankProjected(id) {
  selectedTankId = id;
  const found = tanksAll().find(t => t.id === id);
  if (found) tankShowArchived = !!found.archived;
  renderTankList();
  const t = tanksAll().find(x => x.id === id);
  if (t) renderTankDetail(t);
}

function renderTankDetail(t) {return tankStockWithSnapshot(()=>renderTankDetailProjected(t));}
function renderTankDetailProjected(t) {
  const b = computeTankBalance(t.id);
  const reserveState = tankReserveState(t, b.balance,b.status);
  const balColor = reserveState.color;
  const stock=tankStockAt(t.id),history=(tankStockRow(t.id)?.events||[]).slice().sort((a,b)=>b.date.localeCompare(a.date)||b.source.rowIndex-a.source.rowIndex);
  const boundGens = (data.generators || []).filter(g => g.tankId === t.id);
  const fmtL = x => precisionFormat(x),fmtR = x => precisionFormat(x,{minimumScale:2});
  const eventLabels={receipt:'Приход',issue:'Выдача',transfer:'Перемещение',return:'Возврат',adjustment:'Корректировка',measurement:'Замер',legacy:'Старая запись','generator-issue':'Выдача по журналу ДЭС'};
  const incRows=history.map(event=>{
    const raw=(data[event.source.section]||[])[event.source.rowIndex],id=event.source.id,negative=DecimalCore.compare(event.deltaDecimal,0)<0,neutral=!event.stockAffects;
    const action=id==null?'':event.source.section==='tankIncomes'?`<button class="btn btn-ghost btn-sm" onclick="${EntityIdentity.presentId(raw?.linkId)?'tankLegacyTransferOpen('+htmlJs(id)+')':'lifecycleOpen(\'tankIncomes\','+htmlJs(id)+')'}">${EntityIdentity.presentId(raw?.linkId)?'Проверить отмену перемещения':'Документ / исправление'}</button>`:event.source.section==='fuelMovements'?`<button class="btn btn-ghost btn-sm" onclick="lifecycleOpen('fuelMovements',${htmlJs(id)})">${raw?.kind==='measurement'?'Замер / действия':'Документ / сторно'}</button>`:`<button class="btn btn-ghost btn-sm" onclick="switchGenSubView('generators');selectGenerator(${htmlJs(raw?.generatorId)});openEditGenRecord(${htmlJs(id)})">Журнал ДЭС</button>`;
    const label=event.kind==='measurement'?'Замер: '+fmtL(event.measurement?.observedQty)+' л'+(event.void?' · отменён':''):raw?.kind==='in'?'Перемещение в ёмкость':raw?.kind==='out'?'Перемещение из ёмкости':eventLabels[event.kind]||event.kind;
    return `<tr><td>${fmtDate(event.date)}${fuelAccountingIncludes('tanks',t,event.date)?'':'<small> · До начала учёта: в расчёте не учитывается</small>'}</td><td>${htmlEsc(label)}${neutral?'<small> · Остаток не меняет</small>':''}</td><td style="text-align:right;color:${neutral?'var(--text3)':negative?'var(--red)':'var(--green)'}">${neutral?'—':fmtL(event.deltaDecimal)+' л'}</td><td style="text-align:right">${fmtL(event.balanceDecimal)} л</td><td>${htmlEsc(raw?.source||raw?.reason||raw?.note||'')}${raw?.sum!=null?'<small> · '+fmtR(raw.sum)+' ₽</small>':''}</td><td>${action}</td></tr>`;
  }).join('')||'<tr><td colspan="6">Событий нет</td></tr>';

  const boundHtml = boundGens.length ? boundGens.map(g => {
    const issued=DecimalCore.toNumberExact(DecimalCore.sub(0,DecimalCore.sum(tankStockEvents(t.id).filter(event=>(event.source.section==='genRecords'&&(data.genRecords||[])[event.source.rowIndex]?.generatorId===g.id||event.source.section==='fuelMovements'&&event.kind==='issue'&&(()=>{const recipient=wfAsset((data.fuelMovements||[])[event.source.rowIndex]?.assetRef);return recipient?.section==='generators'&&recipient.id===g.id;})())).map(event=>event.deltaDecimal))));
    return `<div data-tank-generator style="display:flex;justify-content:space-between;padding:7px 12px;border-bottom:1px solid var(--border);font-size:13px;cursor:pointer" onclick="switchGenSubView('generators');selectGenerator(${htmlJs(g.id)})">
      <span>${htmlEsc(g.name)}${g.location ? ` <span style="color:var(--text3)">· ${htmlEsc(g.location)}</span>` : ''}</span>
      <span style="color:var(--red);font-weight:600;white-space:nowrap">−${fmtL(issued)} л</span>
    </div>`;
  }).join('') : `<div style="padding:12px;color:var(--text3);font-size:13px">Нет привязанных ДЭС. Привяжите в карточке ДЭС (поле «Ёмкость»).</div>`;

  document.getElementById('mainContent').innerHTML = `
    <div class="vehicle-detail-header">
      <div>
        <h1 style="margin:0">${htmlEsc(t.name)}${t.archived ? ' · архив' : ''}</h1>
        <div style="color:var(--text3);font-size:13px;margin-top:3px">${htmlEsc(tankFuelGrade(t))} · ${htmlEsc(tankFuelOrg(t))}${t.location ? ' · '+ htmlEsc(t.location) : ''}${t.capacity ? ' · объём '+t.capacity.toLocaleString('ru')+' л' : ''}</div>
        <div style="color:var(--text3);font-size:13px;margin-top:2px">${t.serial ? 'Зав.№ '+ htmlEsc(t.serial) : ''}${t.object ? (t.serial?' · ':'')+'Объект: '+ htmlEsc(t.object) : ''}${t.owner ? ((t.serial||t.object)?' · ':'')+'Собственник: '+ htmlEsc(t.owner) : ''}</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost" onclick="fuelAccountingOpen('tanks',${htmlEsc(JSON.stringify(t.id))})">Начало учёта ГСМ</button>
        ${t.archived ? `<button class="btn btn-primary" onclick="restoreTank(${htmlJs(t.id)})">Восстановить из архива</button>` : `<button class="btn btn-primary" onclick="openAddTankIncome()">Приход</button><button class="btn btn-ghost" onclick="tankMovementOpen('issue',${htmlJs(t.id)})">Выдать</button><button class="btn btn-ghost" onclick="openTankTransfer()">Перемещение</button><button class="btn btn-ghost" onclick="tankFuelActionOpen('measure',{tankId:${htmlJs(t.id)}})">Записать замер</button>`}
        <button class="btn btn-ghost" onclick="openEditTank(${htmlJs(t.id)})"><svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z"/></svg> Изменить</button>
      </div>
    </div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;margin:16px 0">
      <div class="ss-card" style="flex:1;min-width:150px;background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:14px">
        <div style="font-size:12px;color:var(--text3)">Расчётный остаток на конец ${fmtDate(dispatcherLocalDate())}</div>
        <div style="font-size:26px;font-weight:800;color:${balColor}">${b.balance===null?htmlEsc(tankStockLabel(stock)):fmtL(b.balance)+' <span style="font-size:14px">л</span>'}</div>
        <div style="font-size:12px;color:var(--text3);margin-top:6px">${htmlEsc(reserveState.label)}<br>${fuelAccountingStatusHtml('tanks',t)}</div>
        ${b.capacity ? `<div style="height:8px;background:var(--border);border-radius:5px;margin-top:8px;overflow:hidden"><div style="height:100%;width:${b.fillPct}%;background:${balColor}"></div></div><div style="font-size:11px;color:var(--text3);margin-top:4px">${b.fillPct}% от ${b.capacity.toLocaleString('ru')} л</div>` : ''}
      </div>
      <div class="ss-card" style="flex:1;min-width:120px;background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:14px">
        <div style="font-size:12px;color:var(--text3)">Начальный остаток</div>
        <div style="font-size:20px;font-weight:700">${fmtL(b.init)} л</div>
        <div style="font-size:12px;color:var(--text3);margin-top:10px">Поступило по всем операциям</div>
        <div style="font-size:18px;font-weight:700;color:var(--green)">+${fmtL(b.status==='known'?b.received:null)} л</div>
      </div>
      <div class="ss-card" style="flex:1;min-width:120px;background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:14px">
        <div style="font-size:12px;color:var(--text3)">Выбыло по всем операциям</div>
        <div style="font-size:20px;font-weight:700;color:var(--red)">−${fmtL(b.status==='known'?b.outgoing:null)} л</div>
        <div style="font-size:12px;color:var(--text3);margin-top:10px">Привязано ДЭС</div>
        <div style="font-size:18px;font-weight:700">${boundGens.length}</div>
      </div>
    </div>
    ${typeof costValuationCardHtml==='function'?costValuationCardHtml({section:'tanks',id:t.id}):''}
    ${b.diagnostics.length?'<div class="wf-note" role="alert">'+b.diagnostics.map(issue=>htmlEsc(issue.message)).join('<br>')+'</div>':''}
    <div class="ss-title" style="margin:18px 0 8px">Все события ёмкости</div>
    <table class="data-table" style="width:100%">
      <thead><tr><th>Дата</th><th>Событие</th><th style="text-align:right">Изменение</th><th style="text-align:right">Расчётный остаток</th><th>Документ / основание</th><th></th></tr></thead>
      <tbody>${incRows}</tbody>
    </table>
    <div class="ss-title" style="margin:22px 0 4px">Привязанные ДЭС (выдача из ёмкости)</div>
    <div style="border:1px solid var(--border);border-radius:10px;overflow:hidden">${boundHtml}</div>`;
  if(typeof costValuationMountCards==='function')void costValuationMountCards();
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
  const tanks = tanksAll().filter(t => !t.archived&&!t.mergedInto || t.id === selected);
  sel.innerHTML = '<option value="">— не привязана —</option>' +
    tanks.map(t => `<option value="${htmlEsc(t.id)}" data-typed-id="${htmlEsc(JSON.stringify(t.id))}"${t.id === selected ? ' selected' : ''}>${(t.name||'').replace(/</g,'&lt;')}${t.location ? ' ('+ htmlEsc(t.location)+')' : ''}</option>`).join('');
  if(selected!=null&&selected!==''&&!tanks.some(t=>t.id===selected)){const option=new Option('Прежняя ёмкость · карточка недоступна',String(selected),false,true);option.dataset.typedId=JSON.stringify(selected);sel.add(option);}
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
    name, ...Object.fromEntries(Object.entries(numeric).filter(([,value])=>value!==undefined)),
    serial:      document.getElementById('tk_serial').value.trim(),
    fuel:        document.getElementById('tk_fuel').value,
    location:    document.getElementById('tk_location').value.trim(),
    object:      document.getElementById('tk_object').value.trim(),
    owner:       document.getElementById('tk_owner').value.trim(),
    note:        document.getElementById('tk_note').value.trim(),
  };
  if (editingTankId!=null&&editingTankId!=='') {
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
  if(!EntityIdentity.presentId(selectedTankId))return;
  const tank=tanksAll().find(row=>row.id===selectedTankId);if(!tank||tank.archived||tank.mergedInto){showToast('Для нового прихода нужна действующая ёмкость');return;}
  return newDocument('tankIncomes',{tankId:tank.id});
}
function openEditTankIncome(id){const row=(data.tankIncomes||[]).find(item=>item.id===id);if(!row)return;if(row.kind==='in'||row.kind==='out'||EntityIdentity.presentId(row.linkId))return tankLegacyTransferOpen(id);return lifecycleOpen('tankIncomes',id);}
function saveTankIncome(){showToast('Сохраните приход через черновик и отдельное проведение. Старое окно не меняет учёт.');return false;}
function deleteTankIncome(id){return openEditTankIncome(id);}
function openTankTransfer(){if(!EntityIdentity.presentId(selectedTankId))return;return tankMovementOpen('transfer',selectedTankId);}
function renderTransferHint(){return false;}
function saveTankTransfer(){showToast('Проверьте и проведите перемещение через документ. Старое окно не меняет учёт.');return false;}
