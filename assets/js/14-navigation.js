// Переключение разделов и главное меню
// Выделено из index.html

// ─── SECTION SWITCHER ────────────────────────────────────
function switchSection(section, options = {}) {
  showProgress();
  if(typeof wfSwitchWorkspace==='function')wfSwitchWorkspace(activeSection,section,options);
  activeSection = section;
  if(typeof xpRememberSection==='function')xpRememberSection(section);
  const isHome = section === 'home';
  const hasSidebar = section === 'tanks';
  const sectionTitles = {
    vehicles: 'Транспорт', generators: 'ДЭС', tanks: 'Ёмкости', drivers:'Водители', operators:'Операторы ДЭС', workflows:'Рабочие процессы', dispatch:'Диспетчерская',
    reestr: 'Реестр', toSchedule: 'График ТО', repairs: 'Журнал ремонта',
    finances: 'Финансы', contragents: 'Контрагенты', reports: 'Отчёты',
    costs: 'Стоимость работы', procurement: 'Планирование закупок', system:'Состояние программы',
    printForms: 'Печатные формы', fuelReport: 'Отчёт по топливу', fuelPurchases: 'ГСМ'
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
  } else if (section === 'system') {
    renderPlatformSystem();
  } else if (section === 'drivers' || section === 'operators') {
    renderPersonnelSection();
  } else if (section === 'workflows' || section === 'dispatch') {
    renderWorkflows();
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
  } else if (section === 'costs') {
    renderCostsSection();
  } else if (section === 'procurement') {
    renderProcurementSection();
  } else if (section === 'contragents') {
    renderContragentsSection();
  } else if (section === 'reports') {
    renderReportsSection();
  } else if (section === 'printForms') {
    renderPrintFormsSection();
  } else if (section === 'fuelReport') {
    renderFuelReport();
  } else if (section === 'fuelPurchases') {
    if (fpView === 'vehicle') fpView = 'receipts';
    fpVehicle = null;
    renderFuelPurchases();
  }
  hideProgress();
  setTimeout(() => animateCounters(), 50);
}

function renderMainMenu(){renderLaunchpad();}
