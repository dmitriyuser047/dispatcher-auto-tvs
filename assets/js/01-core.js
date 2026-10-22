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
    if (document.getElementById('confirmModal')?.classList.contains('open')) return;
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
// Сравнение дат для сортировок.
// Даты хранятся как ГГГГ-ММ-ДД с ведущими нулями, поэтому строки сравниваются
// напрямую — это примерно в 19 раз быстрее, чем создавать объекты Date внутри
// компаратора (а компаратор вызывается тысячи раз за одну отрисовку).
// Пустая или отсутствующая дата считается равной любой другой — так же вёл себя
// прежний вариант через new Date (получался NaN, что сортировка трактует как 0).
function cmpDateAsc(a, b)  { if (!a || !b) return 0; return a < b ? -1 : a > b ? 1 : 0; }
function cmpDateDesc(a, b) { if (!a || !b) return 0; return a < b ?  1 : a > b ? -1 : 0; }

// ДД.ММ.ГГГГ → ISO (ГГГГ-ММ-ДД)
function parseDate(ddmmyyyy) {
  if (!ddmmyyyy) return '';
  const parts = ddmmyyyy.split('.');
  if (parts.length !== 3 || parts[2].length !== 4) return '';
  const [d, m, y] = parts;
  if (!/^\d{1,2}$/.test(d) || !/^\d{1,2}$/.test(m) || !/^\d{4}$/.test(y)) return '';
  const iso = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  const dt = new Date(iso + 'T12:00:00Z');
  return Number.isFinite(dt.getTime()) && dt.toISOString().slice(0, 10) === iso ? iso : '';
}

function optionalNumber(id) {
  const text = document.getElementById(id).value.trim();
  return text === '' ? null : Number(text.replace(',', '.'));
}
function validNonnegativeFields(ids) {
  for (const id of ids) {
    const n = optionalNumber(id);
    if (n != null && (!Number.isFinite(n) || n < 0)) { showFieldError('Введите неотрицательное число', id); return false; }
  }
  return true;
}
function htmlEsc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function htmlJs(value) { return htmlEsc(JSON.stringify(typeof value==='number'&&Number.isFinite(value)?value:String(value??''))); }
// Автоматически ставит точки при вводе даты
function autoDateSep(el) {
  let v = el.value.replace(/[^\d]/g, '');
  if (v.length > 2) v = v.slice(0,2) + '.' + v.slice(2);
  if (v.length > 5) v = v.slice(0,5) + '.' + v.slice(5);
  el.value = v.slice(0, 10);
}

// ─── DATA ───────────────────────────────────────────────
const STORAGE_KEY = 'fuel_tracker_v1';
let localCacheKey=STORAGE_KEY;
let _loadWriteBlocked = false;
let _lastPersisted = null;
function validDatabase(value) {
  if (!value || !Array.isArray(value.vehicles) || !Array.isArray(value.records)) return false;
  const sections = typeof SYNC_SECTIONS !== 'undefined' ? SYNC_SECTIONS : ['vehicles','records','generators','genRecords'];
  return sections.every(name => !(name in value) || Array.isArray(value[name]) && value[name].every(row => row && typeof row === 'object' && !Array.isArray(row)));
}

async function loadData() {
  let d = null;
  _loadWriteBlocked = false;
  if (typeof _sync !== 'undefined') { _sync.enabled=false; _sync.revs={}; _sync.synced={}; _sync.databaseToken=null; _sync.access=null; _sync.platform=null; _sync.lastResult=null; }
  localCacheKey = window.electronAPI ? null : STORAGE_KEY;
  // Снимок с версиями разделов — для синхронизации нескольких пользователей
  if (typeof syncLoad === 'function') {
    try { d = await syncLoad(); } catch (e) { console.warn('[loadData] снимок: ' + e.message); }
  }
  if (!d && window.electronAPI) {
    try { const raw = await window.electronAPI.readData(); if (raw) d = JSON.parse(raw); } catch {}
  }
  // Bind the cache to the live served database as well as endpoint/account.
  // A replacement folder behind an unchanged host must not inherit its cache.
  if (window.electronAPI) { try {
    let identity;
    if (window.electronAPI.getDataIdentity) identity = await window.electronAPI.getDataIdentity();
    else if (window.electronAPI.getSettings) {
      const s=await window.electronAPI.getSettings(), profile=(s.users||[])[s.activeUser||0]||{};
      if (s.networkMode==='client' && !d) throw Error('Сервер недоступен; принадлежность кеша не подтверждена');
      identity=JSON.stringify(s.networkMode==='client'?['client',s.remoteProtocol||'http:',s.remoteHost,s.remotePort,s.networkKey,s.remoteCa||null]:['local',profile.dataDir])+':'+(typeof _sync!=='undefined'&&_sync.databaseToken||'legacy');
    }
    if (typeof identity!=='string' || !identity) throw Error('База не определена');
    if (typeof _sync!=='undefined' && _sync.databaseToken && !identity.endsWith(':'+_sync.databaseToken)) { _loadWriteBlocked=true; throw Error('База переключена во время загрузки. Откройте программу заново.'); }
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity));
    localCacheKey=STORAGE_KEY+':'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  } catch(error) { localCacheKey=null; console.warn('[cache] '+error.message); } }
  if (d && !validDatabase(d)) d = null;
  if (!d && window.electronAPI) {
    _loadWriteBlocked = true;
    showToast('Основная база недоступна. Открыта резервная копия только для просмотра. Проверьте подключение и файлы базы.');
  }
  if (!d) {
    try { if(localCacheKey)d = JSON.parse(localStorage.getItem(localCacheKey)); } catch {}
  }
  if (d && !validDatabase(d)) d = null;
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
  if (!d.fuelPurchases) d.fuelPurchases = [];
  if (!d.fuelImports)   d.fuelImports   = [];
  if (!d.fuelCards)     d.fuelCards     = [];
  const lastClosedFuelMonth=(d.fuelPeriods||[]).filter(period=>period.closed).map(period=>period.month).sort().at(-1);
  const cashCardKey=value=>{const text=String(value||'').trim();return text.replace(/\D/g,'')||text.toUpperCase();};
  // A default card must not retroactively bind unresolved historical cash
  // receipts: opening a closed database is a read, not a fuel correction.
  const cashTouchesClosedHistory=lastClosedFuelMonth&&[...(d.records||[]),...(d.fuelPurchases||[]),...(d.monthlyFuel||[])].some(row=>{
    const month=String(row.date||row.month||'').slice(0,7);
    return /^\d{4}-\d{2}$/.test(month)&&month<=lastClosedFuelMonth&&cashCardKey(row.fuelCardNum||row.cardNo||row.cardNumber)==='НАЛИЧКА';
  });
  if (!_loadWriteBlocked&&!cashTouchesClosedHistory&&(typeof _sync==='undefined'||!_sync.access||_sync.access.writable.includes('fuelCards'))&&!d.fuelCards.some(c => /наличк/i.test(c.number) || /наличк/i.test(c.provider)))
    d.fuelCards.push({ id: 'fc_cash', number: 'НАЛИЧКА', provider: 'Наличка', org: '', status: 'active', limit: null, assignments: [], note: 'Для учёта наличных закупок топлива' });
  if (!d.fuelPeriods)   d.fuelPeriods   = [];
  if (!d.fuelWriteoffs)  d.fuelWriteoffs  = [];
  if (!d.monthlyFuel)   d.monthlyFuel   = [];
  if (!d.appMeta)       d.appMeta       = [];
  if (typeof PlatformSchema !== 'undefined') PlatformSchema.sections.forEach(name => { if (!d[name]) d[name]=[]; });
  if (typeof wfInitData === 'function') wfInitData(d);
  _lastPersisted = JSON.stringify(d);
  return d;
}
// Резервная копия в localStorage. Основное хранилище — файл data.json через
// electronAPI, а localStorage нужен только чтобы не остаться без данных, если
// файл или сервер недоступны при следующем запуске. На больших объёмах эта
// запись занимает сотни миллисекунд, поэтому она вынесена из основного пути:
// интерфейс успевает отрисоваться, а копия дописывается следом.
// Повторные вызовы схлопываются — пишется только последнее состояние.
let _lsPending = null, _lsTimer = null;
function scheduleLocalBackup(json) {
  if(!localCacheKey)return;
  _lsPending = {key:localCacheKey,json};
  if (_lsTimer) return;
  _lsTimer = setTimeout(() => {
    _lsTimer = null;
    const payload = _lsPending; _lsPending = null;
    try {
      localStorage.setItem(payload.key, payload.json);
    } catch (e) {
      // Чаще всего это переполнение квоты localStorage на больших объёмах.
      // Основные данные уже записаны в файл, поэтому работу не прерываем.
      console.warn('[saveData] резервная копия в localStorage не сохранена:', e && e.name);
    }
  }, 0);
}

const _pendingSaveOperations=new Set();
async function saveData(d = data, options) {
  const operation=typeof platformExecuteSave === 'function' ? platformExecuteSave(d,options,nextOptions=>persistData(d,nextOptions)) : persistData(d,options);
  _pendingSaveOperations.add(operation);
  try{return await operation;}finally{_pendingSaveOperations.delete(operation);}
}
function restoreSaveBaseline(d) {
  if (d !== data || !_lastPersisted) return;
  data = JSON.parse(_lastPersisted);
  if (typeof _sync !== 'undefined' && _sync.enabled) Object.entries(_sync.synced).forEach(([name,json]) => { data[name]=JSON.parse(json); });
  if (typeof reestrRows !== 'undefined') reestrRows=data.reestrRows || [];
  rebuildIndex();
}
async function persistData(d = data, options) {
  const identity = typeof dispatcherContext === 'function' ? dispatcherContext().identity : null;
  const sameSession = () => identity === (typeof dispatcherContext === 'function' ? dispatcherContext().identity : null);
  showProgress();
  rebuildIndex();
  try {
    if (_loadWriteBlocked) throw new Error('Основная база не прочитана. Сначала восстановите подключение или базу.');
    if (typeof wfAppendAudit === 'function') wfAppendAudit(d, _lastPersisted);
    const json = JSON.stringify(d);
    if (window.electronAPI) {
      // По разделам с проверкой версии; на старом сервере — целиком, как раньше
      const ok = typeof _sync !== 'undefined' && _sync.enabled
        ? await syncSave(d, options)
        : await window.electronAPI.writeData(typeof _sync!=='undefined'&&_sync.databaseToken ? JSON.stringify({databaseToken:_sync.databaseToken,data:d}) : json);
      if (ok !== true) throw new Error('Изменения не записаны. Проверьте соединение и состояние базы.');
    }
    if (!sameSession()) throw Object.assign(new Error('База или пользователь изменились во время сохранения. Проверьте результат в исходной базе.'),{code:'SESSION_CHANGED'});
    _lastPersisted = JSON.stringify(d);
    scheduleLocalBackup(_lastPersisted);
    // A successful section save can replace rows with the server's canonical
    // values even when there was no merge and the indexes were not rebuilt.
    rebuildIndex();
    return true;
  } catch (e) {
    if (sameSession()) restoreSaveBaseline(d);
    if (options?._platformManaged) throw e;
    showToast('Ошибка сохранения: ' + (e.message || e));
    return false;
  } finally {
    setTimeout(hideProgress, 300);
  }
}

let data = { vehicles: [], records: [], generators: [], genRecords: [] };
let recsByVid = new Map();
let genRecsByGid = new Map();
let vehicleToByVid = new Map();
let repairsByVid = new Map();
// Кеш остатков ДЭС. Расчёты транспорта кешируются общим ядром.
let _genBalCache = {};
function rebuildIndex() {
  if (typeof dispatcherInvalidate === 'function') dispatcherInvalidate();
  const index=(rows,field)=>{const grouped=new Map();for(const row of rows||[]){if(!row||typeof row!=='object')continue;const id=row[field];if(!grouped.has(id))grouped.set(id,[]);grouped.get(id).push(row);}return grouped;};
  recsByVid = index(data.records,'vehicleId');
  genRecsByGid = index(data.genRecords,'generatorId');
  vehicleToByVid = index(data.vehicleTo,'vehicleId');
  repairsByVid = index(data.repairs,'vehicleId');
  _genBalCache = {};
}
function recsFor(vid) { return recsByVid.get(vid) || []; }
function genRecsFor(gid) { return genRecsByGid.get(gid) || []; }
function vehicleToFor(vid) { return vehicleToByVid.get(vid) || []; }
function repairsFor(vid) { return repairsByVid.get(vid) || []; }

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
// Госномер для сравнения: только буквы и цифры, без пробелов и регистра,
// латинские буквы-двойники (A, B, E, K, M, H, O, P, C, T, Y, X) — как русские.
// «К 424 АМ 716», «к424ам716» и «K424AM 716» дают один и тот же ключ.
const PLATE_LAT = { A: 'А', B: 'В', E: 'Е', K: 'К', M: 'М', H: 'Н', O: 'О', P: 'Р', C: 'С', T: 'Т', Y: 'У', X: 'Х' };
function plateKey(s) {
  return String(s || '').toUpperCase().replace(/Ё/g, 'Е')
    .replace(/[ABEKMHOPCTYX]/g, ch => PLATE_LAT[ch]).replace(/[^А-Я0-9]/g, '');
}

// Марка из произвольной строки: «ДТ-Л-К5», «Аи 95 Евро», «Дизельное топливо»…
// Пустая строка — марку распознать не удалось.
function parseFuelGrade(text) { return TvsFuelEngine.parseFuelGrade(text); }
function vehicleFuelGrade(vehicle) { return TvsFuelEngine.vehicleFuelGrade(vehicle); }
function fuelTypeFromGrade(grade) { return TvsFuelEngine.fuelTypeFromGrade(grade); }
function recordFuelGrade(record, vehicle) { return TvsFuelEngine.recordFuelGrade(record, vehicle, data); }
// Марка по строкам выписки: берём ту, что залита в наибольшем объёме
function fuelGradeFromTransactions(transactions, v) {
  const byGrade = {};
  (transactions || []).forEach(tx => {
    const g = parseFuelGrade(tx && tx.fuel);
    if (g) byGrade[g] = (byGrade[g] || 0) + (+tx.qty || 0);
  });
  const best = Object.keys(byGrade).sort((a, b) => byGrade[b] - byGrade[a])[0];
  return best || vehicleFuelGrade(v);
}

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

