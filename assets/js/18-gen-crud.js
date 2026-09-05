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

function saveGenerator() {
  const name     = document.getElementById('gm_name').value.trim();
  const location = document.getElementById('gm_location').value.trim();
  if (!name)     { showFieldError('Укажите наименование ДЭС', 'gm_name'); return; }
  if (!location) { showFieldError('Укажите местонахождение', 'gm_location'); return; }
  if (!data.generators) data.generators = [];
  const obj = {
    name, location,
    serial:      document.getElementById('gm_serial').value.trim(),
    responsible: document.getElementById('gm_responsible').value.trim(),
    power:       parseFloat(document.getElementById('gm_power').value)        || null,
    fuel:        document.getElementById('gm_fuel').value,
    norm:        parseFloat(document.getElementById('gm_norm').value)         || null,
    norm100:     parseFloat(document.getElementById('gm_norm100').value)      || null,
    norm50:      parseFloat(document.getElementById('gm_norm50').value)       || null,
    normIdle:    parseFloat(document.getElementById('gm_norm_idle').value)    || null,
    hoursInit:   parseFloat(document.getElementById('gm_hours_init').value)   || 0,
    fuelBalance: parseFloat(document.getElementById('gm_fuel_balance').value) || 0,
    cost:        parseFloat(document.getElementById('gm_cost').value)         || null,
    status:      document.getElementById('gm_status').value.trim(),
    note:        document.getElementById('gm_note').value.trim(),
    tankId:      document.getElementById('gm_tank').value || null,
  };
  if (editingGeneratorId) {
    Object.assign(data.generators.find(x => x.id === editingGeneratorId), obj);
  } else {
    obj.id = 'g_' + Date.now();
    data.generators.push(obj);
    selectedGeneratorId = obj.id;
  }
  saveData(data);
  closeModal('generatorModal');
  renderGeneratorList();
  const g = data.generators.find(x => x.id === selectedGeneratorId);
  if (g) renderGenDetail(g);
}

function deleteGenerator(id) {
  if (!confirm('Удалить этот ДЭС и все его записи?')) return;
  data.generators = (data.generators || []).filter(g => g.id !== id);
  data.genRecords  = (data.genRecords  || []).filter(r => r.generatorId !== id);
  data.toRecords   = (data.toRecords   || []).filter(r => r.generatorId !== id);
  saveData(data);
  selectedGeneratorId = null;
  renderGeneratorList();
  document.getElementById('mainContent').innerHTML = `<div class="welcome">
    <svg width="72" height="72" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-4 0v2"/><path d="M12 12v4m-2-2h4"/></svg>
    <h2>Выберите дизельный генератор</h2><p>Выберите ДЭС из списка слева или добавьте новый</p></div>`;
}

// ─── GENERATOR RECORDS CRUD ──────────────────────────────
function openAddGenRecord() {
  editingGenRecordId = null;
  document.getElementById('genRecordModalTitle').textContent = 'Добавить запись';
  const now = new Date();
  document.getElementById('gen_rec_date').value = fmtDate(now.toISOString().split('T')[0]);
  ['gen_rec_hours','gen_rec_meter_start','gen_rec_meter_end','gen_rec_fuel_issued','gen_rec_fuel_used','gen_rec_fuel_actual','gen_rec_load','gen_rec_note']
    .forEach(id => document.getElementById(id).value = '');
  const g    = (data.generators || []).find(x => x.id === selectedGeneratorId);
  const last = genRecsFor(selectedGeneratorId).slice().sort((a,b)=>new Date(a.date)-new Date(b.date)).pop();
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
  openModal('genRecordModal');
}

function saveGenRecord() {
  const dateRaw = document.getElementById('gen_rec_date').value.trim();
  const date    = parseDate(dateRaw);
  const hours   = parseFloat(document.getElementById('gen_rec_hours').value);
  if (!date)              { showFieldError('Укажите дату в формате ДД.ММ.ГГГГ', 'gen_rec_date'); return; }
  if (!hours && hours !== 0) { showFieldError('Укажите наработку за сессию', 'gen_rec_hours'); return; }
  if (!data.genRecords) data.genRecords = [];
  const obj = {
    generatorId: selectedGeneratorId, date, hours,
    meterStart:  parseFloat(document.getElementById('gen_rec_meter_start').value) || null,
    meterEnd:    parseFloat(document.getElementById('gen_rec_meter_end').value)   || null,
    fuelIssued:  parseFloat(document.getElementById('gen_rec_fuel_issued').value) || null,
    fuelUsed:    parseFloat(document.getElementById('gen_rec_fuel_used').value)   || null,
    fuelActual:  parseFloat(document.getElementById('gen_rec_fuel_actual').value) || null,
    load:        parseFloat(document.getElementById('gen_rec_load').value)        || null,
    note:        document.getElementById('gen_rec_note').value.trim(),
  };
  if (editingGenRecordId) {
    Object.assign(data.genRecords.find(x => x.id === editingGenRecordId), obj);
  } else {
    obj.id = 'gr_' + Date.now();
    data.genRecords.push(obj);
  }
  const d = new Date(date);
  selectedGenYear  = d.getFullYear();
  selectedGenMonth = d.getMonth() + 1;
  saveData(data);
  closeModal('genRecordModal');
  const g = (data.generators || []).find(x => x.id === selectedGeneratorId);
  if (g) renderGenDetail(g);
}

function deleteGenRecord(id) {
  if (!confirm('Удалить эту запись?')) return;
  data.genRecords = (data.genRecords || []).filter(r => r.id !== id);
  saveData(data);
  const g = (data.generators || []).find(x => x.id === selectedGeneratorId);
  if (g) renderGenDetail(g);
}

// ─── GENERATOR RECORD AUTO-CALC ──────────────────────────
function calcGenFuelAuto() {
  const hours = parseFloat(document.getElementById('gen_rec_hours').value);
  const g   = (data.generators || []).find(x => x.id === selectedGeneratorId);
  const inp = document.getElementById('gen_rec_fuel_used');
  if (!inp) return;
  if (!g || !g.norm || isNaN(hours) || hours <= 0) { inp.value = ''; return; }
  inp.value = Math.round(g.norm * hours * 10) / 10;
}

// Фактический расход = норма@100% × (факт. нагрузка / номинальная мощность) × моточасы
function calcGenActualAuto() {
  const g     = (data.generators || []).find(x => x.id === selectedGeneratorId);
  const hours = parseFloat(document.getElementById('gen_rec_hours').value);
  const load  = parseFloat(document.getElementById('gen_rec_load').value);
  const inp   = document.getElementById('gen_rec_fuel_actual');
  if (!inp || !g) return;
  if (!g.norm100 || !g.power || isNaN(hours) || isNaN(load) || hours < 0 || load < 0) return;
  const rate = genFuelRate(g, load);
  if (rate == null) return;
  inp.value = Math.round(Math.max(0, rate) * hours * 10) / 10;
  inp.classList.add('auto-filled');
}

function calcGenHoursEnd() {
  const start = parseFloat(document.getElementById('gen_rec_meter_start').value);
  const hours = parseFloat(document.getElementById('gen_rec_hours').value);
  if (!isNaN(start) && !isNaN(hours))
    document.getElementById('gen_rec_meter_end').value = Math.round((start + hours) * 10) / 10;
}

function calcGenHoursFromMeter() {
  const start = parseFloat(document.getElementById('gen_rec_meter_start').value);
  const end   = parseFloat(document.getElementById('gen_rec_meter_end').value);
  if (!isNaN(start) && !isNaN(end) && end > start) {
    document.getElementById('gen_rec_hours').value = Math.round((end - start) * 10) / 10;
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
  let issued = 0, used = 0, balance = 0;
  const countedTanks = new Set();
  gens.forEach(g => {
    const gRecs = genRecsFor(g.id).slice().sort((a, b) => new Date(a.date) - new Date(b.date));
    gRecs.forEach(r => {
      totalHours += r.hours || 0;
      issued     += r.fuelIssued || 0;
      used       += r.fuelActual != null ? r.fuelActual : (r.fuelUsed || 0);
    });
    if (g.tankId) {
      if (!countedTanks.has(g.tankId)) { countedTanks.add(g.tankId); balance += computeTankBalance(g.tankId).balance; }
    } else {
      const balMap  = computeGenFuelBalances(g.id);
      const lastRec = gRecs[gRecs.length - 1];
      balance += lastRec ? (balMap[lastRec.id] ?? (g.fuelBalance || 0)) : (g.fuelBalance || 0);
    }
  });
  const balColor = balance < 0 ? 'var(--red)' : balance === 0 ? 'var(--text3)' : 'var(--green)';

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
      <div class="ss-row"><span class="ss-label">Израсходовано</span><span class="ss-value">${used.toLocaleString('ru',{maximumFractionDigits:1})} л</span></div>
      <div class="ss-row"><span class="ss-label">Остаток</span><span class="ss-value" style="color:${balColor}">${balance.toLocaleString('ru',{maximumFractionDigits:1})} л</span></div>
    </div>
  </div>`;
  list?.appendChild(div);
}

