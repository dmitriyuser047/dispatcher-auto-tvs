// Добавление/изменение ДЭС и записей наработки
// Выделено из index.html

// ─── GENERATOR CRUD ──────────────────────────────────────
function openAddGenerator() {
  editingGeneratorId = null;
  document.getElementById('generatorModalTitle').textContent = 'Добавить дизельный генератор';
  ['gm_name','gm_serial','gm_location','gm_responsible','gm_status','gm_note'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('gm_fuel').value = 'diesel';
  ['gm_norm','gm_norm100','gm_norm50','gm_norm_idle','gm_power','gm_hours_init','gm_fuel_balance','gm_cost'].forEach(id => document.getElementById(id).value = '');
  populateGenTankSelect('');
  openModal('generatorModal');
}

function openEditGenerator(id) {
  const g = (data.generators || []).find(x => x.id === id);
  if (!g) return;
  editingGeneratorId = id;
  document.getElementById('generatorModalTitle').textContent = 'Редактировать ДЭС';
  document.getElementById('gm_name').value         = g.name        || '';
  document.getElementById('gm_serial').value       = g.serial      || '';
  document.getElementById('gm_power').value        = g.power       ?? '';
  document.getElementById('gm_location').value     = g.location    || '';
  document.getElementById('gm_responsible').value  = g.responsible || '';
  document.getElementById('gm_fuel').value         = g.fuel        || 'diesel';
  document.getElementById('gm_norm').value         = g.norm        ?? '';
  document.getElementById('gm_norm100').value      = g.norm100     ?? '';
  document.getElementById('gm_norm50').value       = g.norm50      ?? '';
  document.getElementById('gm_norm_idle').value    = g.normIdle    ?? '';
  document.getElementById('gm_hours_init').value   = g.hoursInit   ?? '';
  document.getElementById('gm_fuel_balance').value = g.fuelBalance ?? '';
  document.getElementById('gm_cost').value         = g.cost        ?? '';
  document.getElementById('gm_status').value       = g.status      || '';
  document.getElementById('gm_note').value         = g.note        || '';
  populateGenTankSelect(g.tankId || '');
  openModal('generatorModal');
}

async function saveGenerator() {
  const name     = document.getElementById('gm_name').value.trim();
  const location = document.getElementById('gm_location').value.trim();
  if (!name)     { showFieldError('Укажите наименование ДЭС', 'gm_name'); return; }
  if (!location) { showFieldError('Укажите местонахождение', 'gm_location'); return; }
  if (!data.generators) data.generators = [];
  const numeric=precisionRead({power:['gm_power',3],norm:['gm_norm',6],norm100:['gm_norm100',6],norm50:['gm_norm50',6],normIdle:['gm_norm_idle',6],hoursInit:['gm_hours_init',3,'zero'],fuelBalance:['gm_fuel_balance',3,'zero'],cost:['gm_cost',2]},editingGeneratorId==null?null:data.generators.find(x=>x.id===editingGeneratorId));
  if(!numeric)return;
  const obj = {
    name, location, ...numeric,
    serial:      document.getElementById('gm_serial').value.trim(),
    responsible: document.getElementById('gm_responsible').value.trim(),
    fuel:        document.getElementById('gm_fuel').value,
    status:      document.getElementById('gm_status').value.trim(),
    note:        document.getElementById('gm_note').value.trim(),
    tankId:      document.getElementById('gm_tank').value || null,
  };
  if (editingGeneratorId) {
    const g = data.generators.find(x => x.id === editingGeneratorId);
    if (!g) return;
    if (g.tankId !== obj.tankId) genPreserveTankHistory(g);
    Object.assign(g, obj);
  } else {
    obj.id = 'g_' + Date.now();
    data.generators.push(obj);
    selectedGeneratorId = obj.id;
  }
  if (!await saveData(data)) return;
  closeModal('generatorModal');
  renderGeneratorList();
  const g = data.generators.find(x => x.id === selectedGeneratorId);
  if (g) renderGenDetail(g);
}

async function deleteGenerator(id) {
  const g = (data.generators || []).find(x => x.id === id);
  if (!g || g.archived) return;
  if (!await confirmAction('Переместить ДЭС «' + g.name + '» в архив? Журналы наработки, ТО и все выдачи из ёмкостей сохранятся. ДЭС можно восстановить.')) return;
  genPreserveTankHistory(g);
  g.archived = true;
  g.archivedAt = new Date().toISOString();
  if (!await saveData(data)) return;
  selectedGeneratorId = null;
  renderGeneratorList();
  document.getElementById('mainContent').innerHTML = `<div class="welcome">
    <svg width="72" height="72" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-4 0v2"/><path d="M12 12v4m-2-2h4"/></svg>
    <h2>Выберите дизельный генератор</h2><p>Выберите ДЭС из списка слева или добавьте новый</p></div>`;
}

async function restoreGenerator(id) {
  const g = (data.generators || []).find(x => x.id === id);
  if (!g?.archived) return;
  if (!await confirmAction('Восстановить ДЭС «' + g.name + '» из архива?')) return;
  g.archived = false;
  g.restoredAt = new Date().toISOString();
  if (!await saveData(data)) return;
  selectedGeneratorId = id;
  renderGeneratorList();
  renderGenDetail(g);
  showToast('ДЭС восстановлен');
}

// ─── GENERATOR RECORDS CRUD ──────────────────────────────
function genPrepareActualInput(source) {
  const input = document.getElementById('gen_rec_fuel_actual');
  input.dataset.source = source || '';
  input.classList.toggle('auto-filled', source === 'estimate');
  input.oninput = () => {
    input.dataset.source = 'manual';
    input.classList.remove('auto-filled');
  };
}

function openAddGenRecord() {
  editingGenRecordId = null;
  document.getElementById('genRecordModalTitle').textContent = 'Добавить запись';
  const now = new Date();
  document.getElementById('gen_rec_date').value = fmtDate(now.toISOString().split('T')[0]);
  ['gen_rec_hours','gen_rec_meter_start','gen_rec_meter_end','gen_rec_fuel_issued','gen_rec_fuel_used','gen_rec_fuel_actual','gen_rec_load','gen_rec_note']
    .forEach(id => document.getElementById(id).value = '');
  genPrepareActualInput(null);
  const g    = (data.generators || []).find(x => x.id === selectedGeneratorId);
  const last = genRecsFor(selectedGeneratorId).slice().sort((a, b) => cmpDateAsc(a.date, b.date)).pop();
  if (last?.meterEnd != null) {
    document.getElementById('gen_rec_meter_start').value = last.meterEnd;
  } else if (g?.hoursInit) {
    document.getElementById('gen_rec_meter_start').value = g.hoursInit;
  }
  openModal('genRecordModal');
}

function openEditGenRecord(id) {
  const r = (data.genRecords || []).find(x => x.id === id);
  if (!r) return;
  if (r.fuelMovementId) { showToast('Это выдача из раздела «Движения топлива». Связанная запись не изменяется; оформите отдельное движение с основанием.'); return; }
  editingGenRecordId = id;
  document.getElementById('genRecordModalTitle').textContent = 'Редактировать запись';
  document.getElementById('gen_rec_date').value         = fmtDate(r.date);
  document.getElementById('gen_rec_hours').value        = r.hours      ?? '';
  document.getElementById('gen_rec_meter_start').value  = r.meterStart ?? '';
  document.getElementById('gen_rec_meter_end').value    = r.meterEnd   ?? '';
  document.getElementById('gen_rec_fuel_issued').value  = r.fuelIssued ?? '';
  document.getElementById('gen_rec_fuel_used').value    = r.fuelUsed   ?? '';
  document.getElementById('gen_rec_fuel_actual').value  = r.fuelActual ?? '';
  document.getElementById('gen_rec_load').value         = r.load       ?? '';
  document.getElementById('gen_rec_note').value         = r.note || '';
  genPrepareActualInput(r.fuelActualSource);
  openModal('genRecordModal');
}

async function saveGenRecord() {
  if (editingGenRecordId && (data.genRecords || []).find(r => r.id === editingGenRecordId)?.fuelMovementId) { showToast('Связанная выдача из движения топлива не редактируется в журнале'); return; }
  const generator = (data.generators || []).find(g => g.id === selectedGeneratorId);
  if (!generator || generator.archived) { showToast('Для новой записи восстановите ДЭС из архива'); return; }
  const dateRaw = document.getElementById('gen_rec_date').value.trim();
  const date    = parseDate(dateRaw);
  const old=editingGenRecordId==null?null:(data.genRecords||[]).find(r=>r.id===editingGenRecordId);
  const numeric=precisionRead({hours:['gen_rec_hours',3,'error'],meterStart:['gen_rec_meter_start',3],meterEnd:['gen_rec_meter_end',3],fuelIssued:['gen_rec_fuel_issued',3],fuelUsed:['gen_rec_fuel_used',3],fuelActual:['gen_rec_fuel_actual',3],load:['gen_rec_load',3]},old);
  if(!numeric)return;
  const {hours,meterStart,meterEnd}=numeric;
  if (!date)              { showFieldError('Укажите дату в формате ДД.ММ.ГГГГ', 'gen_rec_date'); return; }
  if (!Number.isFinite(hours) || hours < 0) { showFieldError('Укажите неотрицательную наработку', 'gen_rec_hours'); return; }
  if (+document.getElementById('gen_rec_fuel_issued').value > 0 && (data.tanks || []).find(t => t.id === generator.tankId)?.archived) {
    showFieldError('Выберите действующую ёмкость в карточке ДЭС или восстановите прежнюю', 'gen_rec_fuel_issued'); return;
  }
  if (meterStart != null && meterEnd != null && (meterEnd < meterStart || Math.abs((meterEnd - meterStart) - hours) > 0.11) && (!old||old.meterStart!==meterStart||old.meterEnd!==meterEnd||old.hours!==hours)) {
    showFieldError('Разность показаний счётчика должна совпадать с наработкой', 'gen_rec_meter_end'); return;
  }
  if (!data.genRecords) data.genRecords = [];
  const obj = {
    generatorId: selectedGeneratorId, date, ...numeric,
    note:        document.getElementById('gen_rec_note').value.trim(),
  };
  const actualSource = document.getElementById('gen_rec_fuel_actual').dataset.source;
  if (actualSource === 'estimate' || actualSource === 'manual' || !editingGenRecordId && obj.fuelActual != null) {
    obj.fuelActualSource = actualSource || 'manual';
    obj.modelVersion = obj.fuelActualSource === 'estimate' ? 'gen-load-curve-v1' : null;
  }
  if (editingGenRecordId) {
    const old = data.genRecords.find(x => x.id === editingGenRecordId);
    if (!old) return;
    obj.tankId = genRecordTankId(old);
    Object.assign(old, obj);
  } else {
    obj.tankId = ((data.generators || []).find(g => g.id === selectedGeneratorId) || {}).tankId || null;
    obj.id = 'gr_' + Date.now();
    data.genRecords.push(obj);
  }
  const d = new Date(date);
  selectedGenYear  = d.getFullYear();
  selectedGenMonth = d.getMonth() + 1;
  if (!await saveData(data)) return;
  closeModal('genRecordModal');
  const g = (data.generators || []).find(x => x.id === selectedGeneratorId);
  if (g) renderGenDetail(g);
}

async function deleteGenRecord(id) {
  if ((data.genRecords || []).find(r => r.id === id)?.fuelMovementId) { showToast('Связанная выдача топлива сохраняется в истории. Удаление нарушит остатки.'); return; }
  if (!await confirmAction('Удалить эту запись?')) return;
  data.genRecords = (data.genRecords || []).filter(r => r.id !== id);
  if (!await saveData(data)) return;
  const g = (data.generators || []).find(x => x.id === selectedGeneratorId);
  if (g) renderGenDetail(g);
}

// ─── GENERATOR RECORD AUTO-CALC ──────────────────────────
function calcGenFuelAuto() {
  let hours;try{hours=precisionInput('gen_rec_hours',{scale:3,blank:'null'});}catch{return;}
  const g   = (data.generators || []).find(x => x.id === selectedGeneratorId);
  const inp = document.getElementById('gen_rec_fuel_used');
  if (!inp) return;
  // Раньше здесь бралось поле norm — плоская норма, которой нет ни у одного ДЭС,
  // поэтому «по норме» всегда оставалось пустым. Считаем через genNormSpent:
  // норма при номинальной мощности × моточасы.
  if (!g || isNaN(hours) || hours <= 0) { inp.value = ''; return; }
  const v = genNormSpent(g, { hours });
  inp.value = v==null?'':precisionRound(v,3);
}

// Фактический расход = норма@100% × (факт. нагрузка / номинальная мощность) × моточасы
function calcGenActualAuto() {
  const g     = (data.generators || []).find(x => x.id === selectedGeneratorId);
  let hours;try{hours=precisionInput('gen_rec_hours',{scale:3,blank:'null'});}catch{return;}
  let load;try{load=precisionInput('gen_rec_load',{scale:3,blank:'null'});}catch{return;}
  const inp   = document.getElementById('gen_rec_fuel_actual');
  if (!inp || !g) return;
  if (inp.dataset.source === 'manual' && inp.value !== '') return;
  if (!g.norm100 || !g.power || hours==null || load==null || hours < 0 || load < 0) {
    if (inp.dataset.source === 'estimate') { inp.value = ''; inp.dataset.source = ''; inp.classList.remove('auto-filled'); }
    return;
  }
  const spent=genActualSpent(g,{hours,load});
  if(spent==null)return;
  inp.value=spent;
  inp.dataset.source = 'estimate';
  inp.classList.add('auto-filled');
}

function calcGenHoursEnd() {
  let start;try{start=precisionInput('gen_rec_meter_start',{scale:3,blank:'null'});}catch{return;}
  let hours;try{hours=precisionInput('gen_rec_hours',{scale:3,blank:'null'});}catch{return;}
  if (start!=null && hours!=null)
    document.getElementById('gen_rec_meter_end').value = DecimalCore.toNumberExact(DecimalCore.add(start,hours));
}

function calcGenHoursFromMeter() {
  let start;try{start=precisionInput('gen_rec_meter_start',{scale:3,blank:'null'});}catch{return;}
  let end;try{end=precisionInput('gen_rec_meter_end',{scale:3,blank:'null'});}catch{return;}
  if (start!=null && end!=null && end >= start) {
    document.getElementById('gen_rec_hours').value = DecimalCore.toNumberExact(DecimalCore.sub(end,start));
    calcGenFuelAuto();
  }
}

// ─── GENERATOR SIDEBAR SUMMARY ───────────────────────────
function renderGenSidebarSummary() {
  document.getElementById('sidebarSummary').innerHTML = '';
  const list = document.getElementById('generatorList');
  const gens = data.generators || [];

  const existing = list?.querySelector('.gen-sidebar-summary');
  if (existing) existing.remove();
  if (!gens.length) return;

  // ─── Агрегированная сводка (по подобию транспорта) ───
  let totalHours = 0;
  let issued = 0, used = 0, byNorm = 0, balance = 0;
  let trackedFuel=0,unstartedFuel=0;
  const countedTanks = new Set();
  gens.forEach(g => {
    const gRecs = genRecsFor(g.id).slice().sort((a, b) => cmpDateAsc(a.date, b.date));
    gRecs.forEach(r => {
      totalHours += r.hours || 0;
      if(!fuelAccountingCurrentIncludes('generators',g,r.date))return;
      issued     += r.fuelIssued || 0;
      used       += genActualSpent(g, r);
      byNorm     += genNormSpent(g, r);
    });
    if(fuelAccountingFor('generators',g).mode==='explicit'&&fuelAccountingOpening('generators',g,dispatcherLocalDate())===null){unstartedFuel++;return;}
    if (g.tankId) {
      if (!countedTanks.has(g.tankId)) { countedTanks.add(g.tankId); const value=computeTankBalance(g.tankId).balance;if(value===null)unstartedFuel++;else{balance+=value;trackedFuel++;} }
    } else {
      const balMap  = computeGenFuelBalances(g.id);
      const lastRec = gRecs[gRecs.length - 1];
      const value=fuelAccountingCurrentBalance('generators',g,gRecs,balMap);if(value===null)unstartedFuel++;else{balance+=value;trackedFuel++;}
    }
  });
  const balColor = balance < 0 ? 'var(--red)' : balance === 0 ? 'var(--text3)' : 'var(--green)';
  // Отклонение факта от нормы: перерасход красный, экономия зелёная
  const dev = +(used - byNorm).toFixed(1);
  const devPct = byNorm ? Math.round(dev / byNorm * 1000) / 10 : null;
  const devColor = !byNorm ? 'var(--text3)' : dev > 0 ? 'var(--red)' : dev < 0 ? 'var(--green)' : 'var(--text3)';

  const div = document.createElement('div');
  div.className = 'gen-sidebar-summary';
  div.innerHTML = `<div class="sidebar-summary" style="margin-top:8px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <div class="ss-title" style="margin-bottom:0">Общая сводка</div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-ghost btn-sm" onclick="openGenActModal()" style="font-size:11px;padding:4px 10px" title="Акт на списание ГСМ (ДЭС)">
          <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/>
          </svg>
          Акт ГСМ
        </button>
        <button class="btn btn-ghost btn-sm" onclick="openGenExportAllModal('xls')" style="font-size:11px;padding:4px 10px">
          <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          XLS
        </button>
        <button class="btn btn-ghost btn-sm" onclick="openGenExportAllModal('pdf')" style="font-size:11px;padding:4px 10px" title="Выгрузить общую сводку ДЭС в PDF">
          <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          PDF
        </button>
      </div>
    </div>
    <div class="ss-row"><span class="ss-label">Генераторов</span><span class="ss-value">${gens.length}</span></div>
    <div class="ss-row"><span class="ss-label">Всего моточасов</span><span class="ss-value">${totalHours.toLocaleString('ru',{maximumFractionDigits:1})} мтч</span></div>
    <div class="ss-divider"></div>
    <div class="ss-fuel-block">
      <div class="ss-fuel-title" style="color:var(--yellow)">Дизельное топливо</div>
      <div class="ss-row"><span class="ss-label">Выдано</span><span class="ss-value">${issued.toLocaleString('ru',{maximumFractionDigits:1})} л</span></div>
      <div class="ss-row"><span class="ss-label">Расход по норме</span><span class="ss-value">${byNorm ? byNorm.toLocaleString('ru',{maximumFractionDigits:1}) + ' л' : '—'}</span></div>
      <div class="ss-row"><span class="ss-label">Расход по факту</span><span class="ss-value">${used.toLocaleString('ru',{maximumFractionDigits:1})} л</span></div>
      <div class="ss-row"><span class="ss-label">Отклонение</span><span class="ss-value" style="color:${devColor}" title="Факт минус норма. Плюс — перерасход, минус — экономия.">${byNorm ? (dev > 0 ? '+' : '') + dev.toLocaleString('ru',{maximumFractionDigits:1}) + ' л' + (devPct !== null ? ' · ' + (dev > 0 ? '+' : '') + devPct + '%' : '') : '—'}</span></div>
      <div class="ss-divider"></div>
      <div class="ss-row"><span class="ss-label">Остаток</span><span class="ss-value" style="color:${balColor}">${trackedFuel?balance.toLocaleString('ru',{maximumFractionDigits:3})+' л':'Учёт ещё не начат'}</span></div>
      ${unstartedFuel?'<small>Учёт ещё не начат: '+unstartedFuel+'</small>':''}
    </div>
  </div>`;
  list?.appendChild(div);
}

