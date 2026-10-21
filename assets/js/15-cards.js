// Плитки ТС и ДЭС, список и выбор ДЭС
// Выделено из index.html

// ─── VEHICLE CARDS ──────────────────────────────────────
let vcSearchQuery = '';
let vcShowArchive=false,genShowArchive=false;
function personnelMountAssetPeople(host,ref){
  if(!host)return;
  if(host.nextElementSibling?.hasAttribute('data-personnel-for-asset'))host.nextElementSibling.remove();
  if(typeof personnelRows!=='function'||typeof personnelCanRead!=='function'||!personnelCanRead('drivers')||!personnelCanRead('assetAssignments'))return;
  const today=wfToday(),people=personnelRows(),seen=new Set(),current=[];
  for(const assignment of data.assetAssignments||[]){
    if(assignment.archived||assignment.deleted||assignment.assetRef!==ref||!assignment.from||assignment.from>today||assignment.to&&assignment.to<today)continue;
    const person=people.find(row=>row.id===assignment.driverId);if(!person)continue;
    const key=typeof person.id+':'+person.id;if(seen.has(key))continue;seen.add(key);current.push(person);
  }
  if(!current.length)return;
  const panel=document.createElement('div');panel.className='personnel-asset-people wf-actions';panel.dataset.personnelForAsset=ref;
  const label=document.createElement('small');label.textContent=wfPersonnelFieldLabel(ref)+' · закрепление на '+fmtDate(today)+':';panel.appendChild(label);
  for(const person of current){const button=document.createElement('button');button.type='button';button.className='btn btn-ghost btn-sm';button.textContent=person.name;button.setAttribute('aria-label','Открыть карточку: '+person.name);button.addEventListener('click',event=>{event.stopPropagation();personnelOpenPerson(person.id);});panel.appendChild(button);}
  host.insertAdjacentElement('afterend',panel);
}
function renderVehicleCards() {
  const q = vcSearchQuery.toLowerCase().trim();
  const fuelLabels = { diesel: 'Дизельное', gasoline: 'Бензин', gas: 'Газ' };

  const filtered = data.vehicles.filter(v => {
    if(Boolean(v.archived)!==vcShowArchive)return false;
    if (q) {
      const combined = [v.plate, v.make, v.model, v.driver, v.org, v.object, v.responsible, v.status, v.note, v.vin, v.fuel]
        .map(f => (f || '').toLowerCase()).join(' ');
      const words = q.split(/\s+/);
      if (!words.every(w => combined.includes(w))) return false;
    }
    if (filterStatus && !(v.status || '').toLowerCase().includes(filterStatus)) return false;
    if (filterFuel && v.fuel !== filterFuel) return false;
    if (filterOrg && (v.org || '') !== filterOrg) return false;
    return true;
  });

  const statusStyle = (s) => {
    if (!s) return '';
    const bg = s === 'На ходу' ? '#dcfce7' : s === 'В резерве' ? '#dbeafe'
      : (s === 'В ремонте' || s === 'После ДТП') ? '#fee2e2' : '#fef9c3';
    const color = s === 'На ходу' ? '#16a34a' : s === 'В резерве' ? '#2563eb'
      : (s === 'В ремонте' || s === 'После ДТП') ? '#dc2626' : '#a16207';
    const border = s === 'На ходу' ? 'rgba(22,163,74,0.2)' : s === 'В резерве' ? 'rgba(37,99,235,0.2)'
      : (s === 'В ремонте' || s === 'После ДТП') ? 'rgba(220,38,38,0.2)' : 'rgba(161,98,7,0.2)';
    return `background:${bg};color:${color};border:1px solid ${border}`;
  };

  const cards = filtered.map(v => {
    const recs = recsFor(v.id);
    const totalKm = recs.reduce((s, r) => s + (r.km || 0), 0);
    const lastRec = recs.length ? recs.sort((a,b) => cmpDateDesc(a.date, b.date))[0] : null;
    const accentColor = v.status === 'На ходу' ? '#16a34a' : (v.status === 'В ремонте' || v.status === 'После ДТП') ? '#dc2626' : v.status === 'В резерве' ? '#2563eb' : v.status ? '#d97706' : 'transparent';
    return `<div class="vehicle-card" onclick="selectVehicle(${htmlJs(v.id)})">
      <div class="vc-accent-bar" style="background:${accentColor}"></div>
      <div class="vc-plate">${htmlEsc(v.plate)}</div>
      <div class="vc-make">${htmlEsc(v.make || '—')}</div>
      <div class="vc-driver">${v.driver ? '<svg class="vc-meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> ' + htmlEsc(v.driver) : ''}</div>
      ${v.status ? `<span class="vc-status" style="${statusStyle(v.status)}"><span style="width:6px;height:6px;border-radius:50%;background:currentColor;flex-shrink:0"></span>${htmlEsc(v.status)}</span>` : ''}
      <div class="vc-meta">
        <span class="fuel-tag ${fuelTypeFromGrade(vehicleFuelGrade(v))}" style="font-size:10px;padding:1px 6px">${vehicleFuelGrade(v)}</span>
        ${totalKm > 0 ? '<span><svg class="vc-meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/></svg> ' + totalKm.toLocaleString('ru') + ' км</span>' : ''}
        ${v.org ? '<span>' + htmlEsc(v.org) + '</span>' : ''}
      </div>
    </div>`;
  }).join('');

  const gridHtml = filtered.length
    ? `<div class="vehicle-cards-grid">${cards}</div>`
    : `<div class="welcome" style="padding:60px 0">
        <svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1"><path d="M1 17l2-6h18l2 6M5 11l1-4h12l1 4"/></svg>
        <p>${data.vehicles.length ? 'Ничего не найдено' : 'Нет транспортных средств. Нажмите «Добавить ТС»'}</p>
      </div>`;
  const countHtml = `${filtered.length} из ${data.vehicles.length} ТС`;

  const existing = document.getElementById('vcGridArea');
  if (existing) {
    existing.innerHTML = gridHtml;
    document.getElementById('vcCountArea').textContent = countHtml;
    return;
  }
  document.getElementById('mainContent').innerHTML = `
    <div style="padding:24px 28px;width:100%;box-sizing:border-box;overflow-y:auto;height:100%">
      <div class="vehicle-cards-toolbar">
        <label><input type="checkbox" ${vcShowArchive?'checked':''} onchange="vcShowArchive=this.checked;renderVehicleCards()"> Архив ТС</label>
        <input type="text" id="vcSearchInput" placeholder="Поиск по номеру, марке, водителю, объекту..." value="${vcSearchQuery.replace(/"/g, '&quot;')}"
          oninput="vcSearchQuery=this.value;renderVehicleCards()" />
        <button class="btn btn-ghost" onclick="openActGsmModal()" title="Акт на списание ГСМ по транспорту">
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>
          Акт ГСМ
        </button>
        <div class="dropdown">
          <button type="button" class="btn btn-ghost" onclick="toggleDropdown('vehicleSummaryExportMenu')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
            Выгрузить сводку
          </button>
          <div class="dropdown-menu" id="vehicleSummaryExportMenu">
            <button type="button" class="dropdown-item" onclick="openExportPeriodModal('xls');closeDropdowns()">Сводка в XLS</button>
            <button type="button" class="dropdown-item" onclick="openExportPeriodModal('pdf');closeDropdowns()">Сводка в PDF</button>
          </div>
        </div>
        <button class="btn btn-primary" onclick="openAddVehicle()">
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Добавить ТС
        </button>
      </div>
      <div id="vcGridArea">${gridHtml}</div>
      <div id="vcCountArea" style="text-align:center;margin-top:16px;font-size:13px;color:var(--text3)">
        ${countHtml}
      </div>
    </div>
  `;
}

// ─── GENERATOR CARDS (tile view like vehicles) ──────────
let genSearchQuery = '';
function renderGeneratorCards() {
  const q = genSearchQuery.toLowerCase().trim();
  const gens = (data.generators || []);
  const fuelLabels = { diesel: 'Дизель', gasoline: 'Бензин', gas: 'Газ' };

  const filtered = gens.filter(g => {
    if(Boolean(g.archived)!==genShowArchive)return false;
    if (!q) return true;
    return [g.name, g.serial, g.location, g.status, g.note]
      .some(f => (f || '').toLowerCase().includes(q));
  });

  const cards = filtered.map(g => {
    const gRecs = genRecsFor(g.id);
    const totalHours = gRecs.reduce((s, r) => s + (r.hours || 0), 0);
    let fuelBal;
    if(fuelAccountingFor('generators',g).mode==='explicit'&&fuelAccountingOpening('generators',g,dispatcherLocalDate())===null){
      fuelBal=null;
    } else if (g.tankId) {
      fuelBal = computeTankBalance(g.tankId).balance;
    } else {
      const balMap = computeGenFuelBalances(g.id);
      const sorted = gRecs.slice().sort((a,b) => cmpDateAsc(a.date, b.date));
      const lastRec = sorted[sorted.length - 1];
      fuelBal = fuelAccountingCurrentBalance('generators',g,gRecs,balMap);
    }
    const stColor = g.status === 'В работе' ? '#22c55e' : g.status === 'Резерв' ? '#3b82f6' : g.status ? '#ef4444' : 'transparent';
    const stBg = g.status === 'В работе' ? '#dcfce7' : g.status === 'Резерв' ? '#dbeafe' : g.status ? '#fee2e2' : '';
    const stBorder = g.status === 'В работе' ? 'rgba(22,163,74,0.2)' : g.status === 'Резерв' ? 'rgba(37,99,235,0.2)' : g.status ? 'rgba(220,38,38,0.2)' : '';
    const balColor = fuelBal < 0 ? 'var(--red)' : fuelBal < 50 ? 'var(--yellow)' : 'var(--green)';

    return `<div class="vehicle-card" onclick="openGeneratorDetail(${htmlJs(g.id)})" style="min-height:120px">
      <div class="vc-accent-bar" style="background:${stColor}"></div>
      <div class="vc-plate">${htmlEsc(g.name)}</div>
      <div class="vc-make">${htmlEsc(g.location || '—')}</div>
      <div class="vc-driver">${g.serial ? '<svg class="vc-meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg> С/н: ' + htmlEsc(g.serial) : ''}</div>
      ${g.status ? `<span class="vc-status" style="background:${stBg};color:${stColor};border:1px solid ${stBorder}"><span style="width:6px;height:6px;border-radius:50%;background:currentColor;flex-shrink:0"></span>${htmlEsc(g.status)}</span>` : ''}
      <div class="vc-meta">
        ${g.power != null ? '<span><svg class="vc-meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> ' + g.power + ' кВт</span>' : ''}
        <span style="font-variant-numeric:tabular-nums">${totalHours.toLocaleString('ru',{maximumFractionDigits:1})} мтч</span>
        <span style="color:${balColor};font-variant-numeric:tabular-nums">${fuelBal===null?'Учёт ещё не начат':fuelBal.toLocaleString('ru',{maximumFractionDigits:3})+' л'}</span>
        ${g.fuel ? '<span>' + htmlEsc(fuelLabels[g.fuel] || g.fuel) + '</span>' : ''}
      </div>
    </div>`;
  }).join('');

  const gridHtml = filtered.length
    ? `<div class="vehicle-cards-grid">${cards}</div>`
    : `<div class="welcome" style="padding:60px 0">
        <svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-4 0v2"/><path d="M12 12v4m-2-2h4"/></svg>
        <p>${gens.length ? 'Ничего не найдено' : 'Нет дизельных генераторов. Нажмите «Добавить ДЭС»'}</p>
      </div>`;
  const countHtml = `${genShowArchive?'Архив':'Действующих'}: ${filtered.length} генераторов`;

  const existing = document.getElementById('genGridArea');
  if (existing) {
    existing.innerHTML = gridHtml;
    document.getElementById('genCountArea').textContent = countHtml;
    return;
  }
  document.getElementById('mainContent').innerHTML = `
    <div style="padding:24px 28px;width:100%;box-sizing:border-box;overflow-y:auto;height:100%">
      <div class="vehicle-cards-toolbar">
        <label><input type="checkbox" ${genShowArchive?'checked':''} onchange="genShowArchive=this.checked;renderGeneratorCards()"> Архив ДЭС</label>
        <input type="text" id="genSearchInput" placeholder="Поиск по наименованию, серийному №, месту..." value="${genSearchQuery.replace(/"/g, '&quot;')}"
          oninput="genSearchQuery=this.value;renderGeneratorCards()" />
        <button class="btn btn-ghost" onclick="openGenActModal()" title="Акт на списание ГСМ по ДЭС">
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>
          Акт ГСМ
        </button>
        <button class="btn btn-primary" onclick="openAddGenerator()">
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Добавить ДЭС
        </button>
      </div>
      <div id="genGridArea">${gridHtml}</div>
      <div id="genCountArea" style="text-align:center;margin-top:16px;font-size:13px;color:var(--text3)">
        ${countHtml}
      </div>
    </div>`;
}

function openGeneratorDetail(id) {
  document.querySelector('.sidebar').style.display = '';
  document.getElementById('sidebarSummary').style.display = '';
  document.getElementById('sidebarGeneratorHeader').style.display = '';
  document.getElementById('generatorList').style.display = '';
  document.getElementById('genSearchWrap').style.display = '';
  document.getElementById('btnAddGen').style.display = '';
  genSubView = 'generators';
  const _stg = document.getElementById('subTabGens'), _stt = document.getElementById('subTabTanks');
  if (_stg && _stt) { _stg.classList.add('active'); _stt.classList.remove('active'); }
  document.getElementById('tankSearchWrap').style.display = 'none';
  document.getElementById('tankList').style.display = 'none';
  document.getElementById('btnAddTank').style.display = 'none';
  renderGeneratorList();
  selectGenerator(id);
}

// ─── GENERATOR LIST ──────────────────────────────────────
function renderGeneratorList() {
  const q    = (document.getElementById('searchGenInput')?.value || '').toLowerCase().trim();
  const list = document.getElementById('generatorList');
  const gens = data.generators || [];

  const filtered = gens.filter(g => {
    if (!q) return true;
    return [g.name, g.serial, g.location, g.status, g.note]
      .some(f => (f || '').toLowerCase().includes(q));
  });

  if (!filtered.length) {
    list.innerHTML = `<div class="empty-list">
      <svg width="40" height="40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" style="display:block;margin:0 auto 8px">
        <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-4 0v2"/><path d="M12 12v4m-2-2h4"/>
      </svg>
      ${gens.length ? 'Ничего не найдено' : 'Нет дизельных генераторов.<br>Нажмите «Добавить ДЭС»'}
    </div>`;
    renderGenSidebarSummary();
    return;
  }

  const fuelLabels  = { diesel: 'Дизель', gasoline: 'Бензин', gas: 'Газ' };
  const fuelClasses = { diesel: 'diesel', gasoline: 'gasoline', gas: 'gas' };

  // Сортируем по местонахождению (без местонахождения — в конец)
  const sortedFiltered = filtered.slice().sort((a, b) => {
    const la = (a.location || '').toLowerCase();
    const lb = (b.location || '').toLowerCase();
    if (!la && lb) return 1;
    if (la && !lb) return -1;
    return la < lb ? -1 : la > lb ? 1 : 0;
  });

  let html = '';
  let curLoc = null;

  sortedFiltered.forEach(g => {
    const locGroup = g.location || '— Без местонахождения —';
    if (locGroup !== curLoc) {
      curLoc = locGroup;
      html += `<div class="gen-loc-header">
        <svg width="10" height="10" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
        ${htmlEsc(locGroup)}
      </div>`;
    }
    const gRecs      = genRecsFor(g.id);
    const totalHours = gRecs.reduce((s, r) => s + (r.hours || 0), 0);
    let fuelBal;
    if(fuelAccountingFor('generators',g).mode==='explicit'&&fuelAccountingOpening('generators',g,dispatcherLocalDate())===null){
      fuelBal=null;
    } else if (g.tankId) {
      fuelBal = computeTankBalance(g.tankId).balance;
    } else {
      const balMap  = computeGenFuelBalances(g.id);
      const sorted  = gRecs.slice().sort((a,b) => cmpDateAsc(a.date, b.date));
      const lastRec = sorted[sorted.length - 1];
      fuelBal = fuelAccountingCurrentBalance('generators',g,gRecs,balMap);
    }
    const balColor   = fuelBal < 0 ? 'var(--red)' : fuelBal < 50 ? 'var(--yellow)' : 'var(--green)';
    const stColor    = g.status === 'В работе' ? '#22c55e' : g.status === 'Резерв' ? '#3b82f6' : g.status ? '#ef4444' : null;
    const stDot      = stColor ? `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${stColor};flex-shrink:0"></span>` : '';
    const fb         = g.fuel ? { label: fuelLabels[g.fuel], cls: fuelClasses[g.fuel] } : null;
    html += `<div class="gen-card ${selectedGeneratorId === g.id ? 'active' : ''}" onclick="selectGenerator(${htmlJs(g.id)})">
      <div class="gen-card-top">
        <div style="flex:1;min-width:0">
          <div class="gen-card-name">${stDot} ${htmlEsc(g.name)}</div>
          <div class="gen-card-sub">${g.serial ? 'С/н: '+ htmlEsc(g.serial) : ''}${g.responsible ? (g.serial?' · ':'')+'Отв.: '+ htmlEsc(g.responsible) : ''}</div>
        </div>
        ${g.power != null ? `<div class="gen-card-power">${htmlEsc(g.power)} кВт</div>` : ''}
      </div>
      <div class="gen-card-badges">
        <div class="gen-badge">${totalHours.toLocaleString('ru',{maximumFractionDigits:1})} мтч</div>
        <div class="gen-badge" style="color:${balColor};border-color:${balColor}4d;background:${balColor}1a">${fuelBal===null?'Учёт ещё не начат':fuelBal.toLocaleString('ru',{maximumFractionDigits:3})+' л'}</div>
        ${g.status ? `<div class="gen-badge" style="color:${stColor};border-color:${stColor}4d;background:${stColor}1a">${htmlEsc(g.status)}</div>` : ''}
        ${fb ? `<span class="fuel-tag ${fb.cls}" style="font-size:10px;padding:1px 6px">${fb.label}</span>` : ''}
      </div>
    </div>`;
  });

  list.innerHTML = html;
  renderGenSidebarSummary();
}

// ─── SELECT GENERATOR ────────────────────────────────────
function selectGenerator(id) {
  selectedGeneratorId = id;
  const g = (data.generators || []).find(x => x.id === id);
  if (!g) return;
  const months = getMonthsForGenerator(id);
  if (months.length) {
    selectedGenYear  = months[months.length - 1].year;
    selectedGenMonth = months[months.length - 1].month;
  } else {
    const now = new Date();
    selectedGenYear  = now.getFullYear();
    selectedGenMonth = now.getMonth() + 1;
  }
  renderGeneratorList();
  renderGenDetail(g);
}

function getMonthsForGenerator(id) {
  const map = {};
  genRecsFor(id).forEach(r => {
    const d   = new Date(r.date);
    const key = `${d.getFullYear()}-${d.getMonth()+1}`;
    map[key]  = { year: d.getFullYear(), month: d.getMonth()+1, key };
  });
  return Object.values(map).sort((a,b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
}

function selectGenMonth(year, month) {
  selectedGenYear  = year;
  selectedGenMonth = month;
  const g = (data.generators || []).find(x => x.id === selectedGeneratorId);
  if (g) renderGenDetail(g);
}

