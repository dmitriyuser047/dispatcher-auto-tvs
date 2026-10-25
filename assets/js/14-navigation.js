// Переключение разделов и главное меню
// Выделено из index.html

// Navigation and incoming changes use the same screen registry. Refreshing a
// screen retains its selection; opening a section starts its normal list view.
const WORKSPACE_RENDERERS = Object.freeze({
  home: () => renderMainMenu(),
  system: () => renderPlatformSystem(),
  assetInventory: () => renderAssetInventorySection(),
  drivers: () => renderPersonnelSection(),
  operators: () => renderPersonnelSection(),
  workflows: () => renderWorkflows(),
  dispatch: () => renderWorkflows(),
  toSchedule: () => renderToScheduleSection(),
  reestr: () => renderReestrSection(),
  vehicles: opening => {
    const vehicle = !opening && data.vehicles.find(row => row.id === selectedVehicleId);
    if (vehicle) renderDetail(vehicle); else renderVehicleCards();
  },
  generators: opening => {
    const generator = !opening && data.generators.find(row => row.id === selectedGeneratorId);
    if (generator) renderGenDetail(generator); else renderGeneratorCards();
  },
  tanks: opening => {
    const tank = !opening && (data.tanks || []).find(row => row.id === selectedTankId);
    if (!tank) {
      selectedTankId = null;
      document.getElementById('mainContent').innerHTML = `<div class="welcome">
        <svg width="72" height="72" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
        <h2>Выберите ёмкость</h2><p>Выберите ёмкость из списка слева или добавьте новую</p></div>`;
    }
    renderTankList();
    if (tank) renderTankDetail(tank);
  },
  finances: () => renderFinancesSection(),
  costs: () => renderCostsSection(),
  procurement: () => renderProcurementSection(),
  contragents: () => renderContragentsSection(),
  reports: () => renderReportsSection(),
  repairs: () => repairsJournalSummaryMode ? renderRepairsSummary() : renderRepairsJournal(),
  printForms: () => renderPrintFormsSection(),
  fuelReport: () => renderFuelReport(),
  fuelPurchases: opening => {
    if (opening) { if (fpView === 'vehicle') fpView = 'receipts'; fpVehicle = null; }
    renderFuelPurchases();
  }
});
function renderWorkspaceSection(section, { opening = false } = {}) {
  const render = Object.hasOwn(WORKSPACE_RENDERERS, section) && WORKSPACE_RENDERERS[section];
  if (!render) return false;
  render(opening);
  return true;
}

// ─── SECTION SWITCHER ────────────────────────────────────
function switchSection(section, options = {}) {
  if(typeof activeSection!=='undefined'&&activeSection==='assetInventory'&&section!=='assetInventory'&&typeof assetInventoryWorkspaceLeave==='function'&&!assetInventoryWorkspaceLeave())return;
  showProgress();
  if(typeof wfSwitchWorkspace==='function')wfSwitchWorkspace(activeSection,section,options);
  activeSection = section;
  if(typeof xpRememberSection==='function')xpRememberSection(section);
  const isHome = section === 'home';
  const hasSidebar = section === 'tanks';
  const sectionTitles = {
    vehicles: 'Транспорт', generators: 'ДЭС', tanks: 'Ёмкости', drivers:'Водители', operators:'Операторы ДЭС', workflows:'Рабочие процессы', dispatch:'Диспетчерская',
    reestr: 'Реестр', toSchedule: 'График ТО', repairs: 'Журнал ремонта', assetInventory:'Инвентаризация ОС',
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

  renderWorkspaceSection(section, { opening:true });
  hideProgress();
  setTimeout(() => animateCounters(), 50);
}

function renderMainMenu(){renderLaunchpad();}
