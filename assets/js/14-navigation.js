// Переключение разделов и главное меню
// Выделено из index.html

// ─── SECTION SWITCHER ────────────────────────────────────
function switchSection(section) {
  showProgress();
  activeSection = section;
  const isHome = section === 'home';
  const hasSidebar = section === 'tanks';
  const sectionTitles = {
    vehicles: 'Транспорт', generators: 'ДЭС', tanks: 'Ёмкости',
    reestr: 'Реестр', toSchedule: 'График ТО', repairs: 'Журнал ремонта',
    finances: 'Финансы', contragents: 'Контрагенты', reports: 'Отчёты',
    printForms: 'Печатные формы'
  };

  // Header: menu button (always in sections), back button (detail views only)
  document.getElementById('hdrMenuBtn').style.display = isHome ? 'none' : 'flex';
  document.getElementById('hdrBackBtn').style.display = 'none';
  document.getElementById('hdrBackBtn').onclick = () => switchSection('home');
  document.getElementById('hdrSectionTitle').style.display = isHome ? 'none' : '';
  document.getElementById('hdrSectionTitle').textContent = sectionTitles[section] || '';

  // Section-specific header buttons
  document.getElementById('hdrVehicles').style.display    = section === 'vehicles'   ? 'flex' : 'none';
  document.getElementById('hdrGenerators').style.display  = section === 'tanks' ? 'flex' : 'none';
  document.getElementById('hdrReestr').style.display      = 'none';

  // Sidebar elements
  document.getElementById('sidebarVehicleHeader').style.display   = section === 'vehicles'   ? '' : 'none';
  document.getElementById('sidebarGeneratorHeader').style.display = section === 'tanks' ? '' : 'none';
  document.getElementById('vehicleList').style.display    = section === 'vehicles'   ? '' : 'none';
  document.getElementById('generatorList').style.display  = 'none';

  // Sub-navigation for generators/tanks
  if (section === 'tanks') {
    genSubView = 'tanks';
    const _stg = document.getElementById('subTabGens'), _stt = document.getElementById('subTabTanks');
    if (_stg && _stt) { _stg.classList.remove('active'); _stt.classList.add('active'); }
    document.getElementById('genSearchWrap').style.display  = 'none';
    document.getElementById('tankSearchWrap').style.display = '';
    document.getElementById('tankList').style.display       = '';
    document.getElementById('btnAddTank').style.display     = '';
    document.getElementById('btnAddGen').style.display      = 'none';
  } else {
    genSubView = 'generators';
    selectedTankId = null;
    const _stg = document.getElementById('subTabGens'), _stt = document.getElementById('subTabTanks');
    if (_stg && _stt) { _stg.classList.add('active'); _stt.classList.remove('active'); }
    document.getElementById('genSearchWrap').style.display  = 'none';
    document.getElementById('tankSearchWrap').style.display = 'none';
    document.getElementById('tankList').style.display       = 'none';
    document.getElementById('btnAddTank').style.display     = 'none';
    document.getElementById('btnAddGen').style.display      = 'none';
  }

  document.getElementById('sidebarSummary').style.display  = hasSidebar ? '' : 'none';
  historyFullscreen = false;
  selectedVehicleId = null;
  selectedGeneratorId = null;

  // Sidebar visibility
  document.querySelector('.sidebar').style.display = hasSidebar ? '' : 'none';

  if (isHome) {
    renderMainMenu();
  } else if (section === 'toSchedule') {
    renderToScheduleSection();
  } else if (section === 'reestr') {
    renderReestrSection();
  } else if (section === 'vehicles') {
    renderVehicleCards();
  } else if (section === 'generators') {
    renderGeneratorCards();
  } else if (section === 'tanks') {
    document.getElementById('mainContent').innerHTML = `<div class="welcome">
      <svg width="72" height="72" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
      <h2>Выберите ёмкость</h2><p>Выберите ёмкость из списка слева или добавьте новую</p></div>`;
    renderTankList();
  } else if (section === 'finances') {
    renderFinancesSection();
  } else if (section === 'contragents') {
    renderContragentsSection();
  } else if (section === 'reports') {
    renderReportsSection();
  } else if (section === 'printForms') {
    renderPrintFormsSection();
  }
  hideProgress();
  setTimeout(() => animateCounters(), 50);
}

function renderMainMenu() {
  const vCount = (data.vehicles || []).length;
  const gCount = (data.generators || []).length;
  const tCount = (data.tanks || []).length;
  document.getElementById('mainContent').innerHTML = `
    <div style="padding:40px 28px;max-width:900px;margin:0 auto;width:100%;box-sizing:border-box">
      <div style="text-align:center;margin-bottom:32px">
        <h2 style="margin:0;font-size:24px;font-weight:700;letter-spacing:-0.025em">Главное меню</h2>
        <p style="margin:8px 0 0;color:var(--text3);font-size:14px;letter-spacing:0.01em;font-weight:400">Выберите раздел для работы</p>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px;margin-bottom:28px">

        <div class="menu-tile" onclick="switchSection('vehicles')">
          <div class="menu-tile-icon" style="background:#dbeafe">
            <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="#2563eb" stroke-width="2"><path d="M1 17l2-6h18l2 6M5 11l1-4h12l1 4"/><circle cx="7" cy="18.5" r="1.5" fill="#2563eb" stroke="none"/><circle cx="17" cy="18.5" r="1.5" fill="#2563eb" stroke="none"/></svg>
          </div>
          <div class="aero-shine"></div>
          <div class="menu-tile-title">Транспорт</div>
          <div class="menu-tile-sub">${vCount} ТС</div>
        </div>

        <div class="menu-tile" onclick="switchSection('generators')">
          <div class="menu-tile-icon" style="background:#fef3c7">
            <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="#d97706" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-4 0v2"/><path d="M12 12v4m-2-2h4"/></svg>
          </div>
          <div class="aero-shine"></div>
          <div class="menu-tile-title">ДЭС</div>
          <div class="menu-tile-sub">${gCount} генераторов</div>
        </div>

        <div class="menu-tile" onclick="switchSection('tanks')">
          <div class="menu-tile-icon" style="background:#e0f2fe">
            <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="#0284c7" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          </div>
          <div class="aero-shine"></div>
          <div class="menu-tile-title">Ёмкости</div>
          <div class="menu-tile-sub">${tCount} ёмкостей</div>
        </div>

        <div class="menu-tile" onclick="switchSection('reestr')">
          <div class="menu-tile-icon" style="background:#dcfce7">
            <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="#16a34a" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          </div>
          <div class="aero-shine"></div>
          <div class="menu-tile-title">Реестр</div>
          <div class="menu-tile-sub">Счета</div>
        </div>

        <div class="menu-tile" onclick="switchSection('toSchedule')">
          <div class="menu-tile-icon" style="background:#ede9fe">
            <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="#7c3aed" stroke-width="2"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>
          </div>
          <div class="aero-shine"></div>
          <div class="menu-tile-title">График ТО</div>
          <div class="menu-tile-sub">Обслуживание</div>
        </div>

        <div class="menu-tile" onclick="openPdfEditor()">
          <div class="menu-tile-icon" style="background:#fce7f3">
            <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="#db2777" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </div>
          <div class="aero-shine"></div>
          <div class="menu-tile-title">PDF</div>
          <div class="menu-tile-sub">Документы</div>
        </div>

        <div class="menu-tile" onclick="openRepairsJournal()">
          <div class="menu-tile-icon" style="background:#fee2e2">
            <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="#dc2626" stroke-width="2"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>
          </div>
          <div class="aero-shine"></div>
          <div class="menu-tile-title">Ремонт</div>
          <div class="menu-tile-sub">Журнал</div>
        </div>

        <div class="menu-tile" onclick="switchSection('finances')">
          <div class="menu-tile-icon" style="background:#d1fae5">
            <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="#059669" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 10h20"/><path d="M6 16h2m4 0h6"/></svg>
          </div>
          <div class="aero-shine"></div>
          <div class="menu-tile-title">Финансы</div>
          <div class="menu-tile-sub">${(data.payments||[]).length} записей</div>
        </div>

        <div class="menu-tile" onclick="switchSection('contragents')">
          <div class="menu-tile-icon" style="background:#fef9c3">
            <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="#ca8a04" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>
          </div>
          <div class="aero-shine"></div>
          <div class="menu-tile-title">Контрагенты</div>
          <div class="menu-tile-sub">${(data.contragents||[]).length} записей</div>
        </div>

        <div class="menu-tile" onclick="switchSection('reports')">
          <div class="menu-tile-icon" style="background:#e0e7ff">
            <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="#4f46e5" stroke-width="2"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>
          </div>
          <div class="aero-shine"></div>
          <div class="menu-tile-title">Отчёты</div>
          <div class="menu-tile-sub">Оборотка</div>
        </div>

        <div class="menu-tile" onclick="switchSection('printForms')">
          <div class="menu-tile-icon" style="background:#f0fdf4">
            <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="#15803d" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          </div>
          <div class="aero-shine"></div>
          <div class="menu-tile-title">Печать</div>
          <div class="menu-tile-sub">Документы</div>
        </div>

      </div>
    </div>
  `;
}

