// Тема, горячие клавиши, утилиты дат, загрузка/сохранение данных, фильтры
// Выделено из index.html

// ─── ТЕМА (светлая / тёмная) ────────────────────────────
function applyTheme(theme) {
  if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  const moon = document.getElementById('themeIconMoon');
  const sun  = document.getElementById('themeIconSun');
  if (moon && sun) {
    moon.style.display = theme === 'dark' ? 'none' : '';
    sun.style.display  = theme === 'dark' ? '' : 'none';
  }
}
function toggleDropdown(id) {
  const menu = document.getElementById(id);
  const wasOpen = menu.classList.contains('open');
  closeDropdowns();
  if (!wasOpen) menu.classList.add('open');
}
function closeDropdowns() {
  document.querySelectorAll('.dropdown-menu.open').forEach(m => m.classList.remove('open'));
}
document.addEventListener('click', e => {
  if (!e.target.closest('.dropdown')) closeDropdowns();
});

function toggleTheme() {
  const cur = localStorage.getItem('theme') === 'dark' ? 'dark' : 'light';
  const next = cur === 'dark' ? 'light' : 'dark';
  localStorage.setItem('theme', next);
  applyTheme(next);
}
// Раннее применение — до отрисовки, чтобы не было мигания
try { applyTheme(localStorage.getItem('theme') === 'dark' ? 'dark' : 'light'); } catch (e) {}

// ─── ГОРЯЧИЕ КЛАВИШИ ────────────────────────────────────
document.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
  // Esc — закрыть любое открытое модальное окно
  if (e.key === 'Escape') {
    const open = document.querySelectorAll('.modal-overlay.open');
    if (open.length) { open.forEach(m => m.classList.remove('open')); e.preventDefault(); }
    return;
  }
  // "/" — фокус на активное поле поиска
  if (e.key === '/' && !typing) {
    const id = (typeof activeSection !== 'undefined' && activeSection === 'generators' && genSubView === 'generators')
      ? 'searchGenInput'
      : (typeof activeSection === 'undefined' || activeSection === 'vehicles') ? 'searchInput' : null;
    const el = id && document.getElementById(id);
    if (el && el.offsetParent !== null) { e.preventDefault(); el.focus(); el.select(); }
  }
});

// ─── UTILS ──────────────────────────────────────────────
// ISO → ДД.ММ.ГГГГ
function fmtDate(isoStr) {
  if (!isoStr) return '';
  const [y, m, d] = isoStr.split('-');
  return `${d}.${m}.${y}`;
}
// ДД.ММ.ГГГГ → ISO (ГГГГ-ММ-ДД)
function parseDate(ddmmyyyy) {
  if (!ddmmyyyy) return '';
  const parts = ddmmyyyy.split('.');
  if (parts.length !== 3 || parts[2].length !== 4) return '';
  const [d, m, y] = parts;
  return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
}
// Автоматически ставит точки при вводе даты
function autoDateSep(el) {
  let v = el.value.replace(/[^\d]/g, '');
  if (v.length > 2) v = v.slice(0,2) + '.' + v.slice(2);
  if (v.length > 5) v = v.slice(0,5) + '.' + v.slice(5);
  el.value = v.slice(0, 10);
}

// ─── DATA ───────────────────────────────────────────────
const STORAGE_KEY = 'fuel_tracker_v1';

async function loadData() {
  let d = null;
  if (window.electronAPI) {
    try { const raw = await window.electronAPI.readData(); if (raw) d = JSON.parse(raw); } catch {}
  }
  if (!d) {
    try { d = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch {}
  }
  if (!d) d = { vehicles: [], records: [] };
  if (!d.generators)  d.generators  = [];
  if (!d.genRecords)  d.genRecords   = [];
  if (!d.toRecords)   d.toRecords    = [];
  if (!d.tanks)       d.tanks        = [];
  if (!d.tankIncomes) d.tankIncomes  = [];
  if (!d.vehicleTo)   d.vehicleTo    = [];
  if (!d.repairs)     d.repairs      = [];
  if (!d.payments)    d.payments     = [];
  if (!d.budget)      d.budget       = [];
  if (!d.reestrRows)  d.reestrRows   = [];
  if (!d.savedReestrs) d.savedReestrs = [];
  if (!d.contragents) d.contragents = [];
  return d;
}
async function saveData(d) {
  showProgress();
  rebuildIndex();
  const json = JSON.stringify(d);
  if (window.electronAPI) {
    const ok = await window.electronAPI.writeData(json);
    if (ok === false) {
      showToast('Ошибка сохранения на сервер. Проверьте соединение.');
    }
  }
  localStorage.setItem(STORAGE_KEY, json);
  setTimeout(hideProgress, 300);
}

let data = { vehicles: [], records: [], generators: [], genRecords: [] };
let recsByVid = {};
let genRecsByGid = {};
let vehicleToByVid = {};
let repairsByVid = {};
// Кэши балансов (сбрасываются при любом изменении данных через rebuildIndex)
let _fuelBalCache = {};
let _genBalCache = {};
function rebuildIndex() {
  recsByVid = {};
  data.records.forEach(r => {
    if (!recsByVid[r.vehicleId]) recsByVid[r.vehicleId] = [];
    recsByVid[r.vehicleId].push(r);
  });
  genRecsByGid = {};
  (data.genRecords || []).forEach(r => {
    if (!genRecsByGid[r.generatorId]) genRecsByGid[r.generatorId] = [];
    genRecsByGid[r.generatorId].push(r);
  });
  vehicleToByVid = {};
  (data.vehicleTo || []).forEach(r => {
    if (!vehicleToByVid[r.vehicleId]) vehicleToByVid[r.vehicleId] = [];
    vehicleToByVid[r.vehicleId].push(r);
  });
  repairsByVid = {};
  (data.repairs || []).forEach(r => {
    if (!repairsByVid[r.vehicleId]) repairsByVid[r.vehicleId] = [];
    repairsByVid[r.vehicleId].push(r);
  });
  _fuelBalCache = {};
  _genBalCache = {};
}
function recsFor(vid) { return recsByVid[vid] || []; }
function genRecsFor(gid) { return genRecsByGid[gid] || []; }
function vehicleToFor(vid) { return vehicleToByVid[vid] || []; }
function repairsFor(vid) { return repairsByVid[vid] || []; }

// Debounce для поиска — не перерисовываем список на каждый символ
function debounce(fn, ms) {
  let t;
  return function() { clearTimeout(t); t = setTimeout(fn, ms); };
}
const debouncedVehicleSearch = debounce(() => renderVehicleList(), 150);
const debouncedGenSearch     = debounce(() => renderGeneratorList(), 150);
let selectedVehicleId = null;
let selectedYear = null;
let selectedMonth = null;
let editingVehicleId = null;
let editingRecordId = null;
let activeSection = 'home';
let vehicleDetailView = 'cards';
let selectedGeneratorId = null;
let selectedGenYear = null;
let selectedGenMonth = null;
let editingGeneratorId = null;
let editingGenRecordId = null;
let editingVehicleToId = null;
let editingRepairId = null;

// ─── FILTERS ─────────────────────────────────────────────
let filterStatus = '';   // '' = все
let filterFuel = '';     // '' = все
let filterOrg = '';      // '' = все
let historyFullscreen = false;

// ─── FILTERS LOGIC ───────────────────────────────────────
function populateOrgSelect() {
  const orgs = [...new Set(data.vehicles.map(v => v.org).filter(Boolean))].sort();
  const orgRow = document.getElementById('filterOrgRow');
  const sel = document.getElementById('filterOrgSel');
  if (!sel) return;
  if (orgs.length > 1) {
    orgRow.style.display = 'flex';
    sel.innerHTML = `<option value="">Все организации</option>` +
      orgs.map(o => `<option value="${o.replace(/"/g,'&quot;')}">${o}</option>`).join('');
    sel.value = filterOrg;
  } else {
    orgRow.style.display = 'none';
  }
}

function updateFilterUI() {
  const statusSel = document.getElementById('filterStatusSel');
  const fuelSel   = document.getElementById('filterFuelSel');
  const orgSel    = document.getElementById('filterOrgSel');
  if (statusSel) { statusSel.value = filterStatus; statusSel.classList.toggle('active', !!filterStatus); }
  if (fuelSel)   { fuelSel.value   = filterFuel;   fuelSel.classList.toggle('active', !!filterFuel); }
  if (orgSel)    { orgSel.value    = filterOrg;    orgSel.classList.toggle('active', !!filterOrg); }

  const activeCount = (filterStatus ? 1 : 0) + (filterFuel ? 1 : 0) + (filterOrg ? 1 : 0);
  const q = (document.getElementById('searchInput')?.value || '').trim();
  const anyActive = activeCount > 0 || !!q;

  // Reset button: show inside org row if org row visible, else standalone
  const orgRow = document.getElementById('filterOrgRow');
  const orgVisible = orgRow && orgRow.style.display !== 'none';
  const resetInOrg = document.getElementById('filterResetBtn');
  const resetStand = document.getElementById('filterResetRowStandalone');
  if (orgVisible) {
    if (resetInOrg) resetInOrg.style.display = anyActive ? '' : 'none';
    if (resetStand) resetStand.style.display = 'none';
  } else {
    if (resetInOrg) resetInOrg.style.display = 'none';
    if (resetStand) resetStand.style.display = anyActive ? 'flex' : 'none';
  }
}

function setStatusFilter(val) { filterStatus = val; updateFilterUI(); renderVehicleList(); }
function setFuelFilter(val)   { filterFuel   = val; updateFilterUI(); renderVehicleList(); }
function setOrgFilter(val)    { filterOrg    = val; updateFilterUI(); renderVehicleList(); }

function resetFilters() {
  filterStatus = ''; filterFuel = ''; filterOrg = '';
  const s = document.getElementById('searchInput');
  if (s) s.value = '';
  updateFilterUI();
  renderVehicleList();
}

function updateFilterBadge() { updateFilterUI(); }

