// PDF-редактор, настройки и пользователи, автообновление, календарь, маршруты
// Выделено из index.html

// ─── PDF EDITOR ──────────────────────────────────────────
async function openPdfEditor() {
  if (window.electronAPI && window.electronAPI.openPdfEditor) {
    await window.electronAPI.openPdfEditor();
  }
}

// ─── НАСТРОЙКИ / ПОЛЬЗОВАТЕЛИ ────────────────────────────
let _appSettings = null;

async function openSettingsModal() {
  if (!window.electronAPI || !window.electronAPI.getSettings) {
    alert('Настройки доступны только в Electron-приложении');
    return;
  }
  _appSettings = await window.electronAPI.getSettings();
  renderSettingsBody();
  openModal('settingsModal');
}

async function renderSettingsBody() {
  const s = _appSettings;
  if (!s || !s.users) return;
  const body = document.getElementById('settingsBody');
  const users = s.users;
  const activeIdx = s.activeUser || 0;
  const mode = s.networkMode || 'local';

  let serverStatusHtml = '';
  if (mode === 'server' && window.electronAPI.serverStatus) {
    const st = await window.electronAPI.serverStatus();
    if (st.running) {
      serverStatusHtml = `<div style="margin-top:8px;padding:8px 12px;background:var(--bg3);border-radius:6px;font-size:12px">
        <span style="color:#22c55e;font-weight:700">● Сервер запущен</span><br>
        <span style="color:var(--text2)">Порт: ${st.port}</span><br>
        <span style="color:var(--text2)">IP-адреса: ${st.ips.join(', ') || 'нет сети'}</span><br>
        <span style="color:var(--text3);font-size:11px">Клиенты подключаются по адресу: <b>${st.ips[0] || '?'}:${st.port}</b></span>
        <div style="margin-top:6px"><button class="btn btn-ghost btn-sm" onclick="settingsStopServer()" style="font-size:11px;color:var(--danger,#ef4444)">Остановить сервер</button></div>
      </div>`;
    } else {
      serverStatusHtml = `<div style="margin-top:8px;padding:8px 12px;background:var(--bg3);border-radius:6px;font-size:12px">
        <span style="color:var(--text3)">● Сервер не запущен</span>
        <div style="margin-top:6px"><button class="btn btn-primary btn-sm" onclick="settingsStartServer()" style="font-size:11px">Запустить сервер</button></div>
      </div>`;
    }
  }

  let clientStatusHtml = '';
  if (mode === 'client') {
    clientStatusHtml = `<div style="margin-top:8px">
      <div style="display:flex;gap:6px;align-items:center">
        <input type="text" id="set_remote_host" value="${s.remoteHost || ''}" placeholder="IP-адрес сервера (напр. 192.168.1.10)" style="flex:1;padding:6px 10px;font-size:12px;border:1px solid var(--border);border-radius:6px;background:var(--bg2);color:var(--text);font-family:inherit">
        <input type="number" id="set_remote_port" value="${s.remotePort || 3377}" style="width:70px;padding:6px 10px;font-size:12px;border:1px solid var(--border);border-radius:6px;background:var(--bg2);color:var(--text);font-family:inherit" placeholder="Порт">
        <button class="btn btn-primary btn-sm" onclick="settingsTestConnection()" style="font-size:11px;white-space:nowrap">Проверить</button>
      </div>
      <div id="connectionTestResult" style="margin-top:6px;font-size:11px"></div>
    </div>`;
  }

  body.innerHTML = `
    <div class="settings-section">
      <div class="settings-section-title">Режим работы</div>
      <div style="display:flex;gap:6px">
        <button class="btn ${mode === 'local' ? 'btn-primary' : 'btn-ghost'} btn-sm" onclick="settingsSetMode('local')" style="flex:1;font-size:12px;padding:8px">
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="vertical-align:-2px"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          Локальный
        </button>
        <button class="btn ${mode === 'server' ? 'btn-primary' : 'btn-ghost'} btn-sm" onclick="settingsSetMode('server')" style="flex:1;font-size:12px;padding:8px">
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="vertical-align:-2px"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
          Сервер
        </button>
        <button class="btn ${mode === 'client' ? 'btn-primary' : 'btn-ghost'} btn-sm" onclick="settingsSetMode('client')" style="flex:1;font-size:12px;padding:8px">
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="vertical-align:-2px"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          Клиент
        </button>
      </div>
      <div style="margin-top:6px;font-size:11px;color:var(--text3)">
        ${mode === 'local' ? 'Данные хранятся локально на этом компьютере.' :
          mode === 'server' ? 'Этот компьютер раздаёт данные другим по сети. Данные хранятся здесь.' :
          'Данные загружаются с другого компьютера (сервера) по сети.'}
      </div>
      ${mode === 'server' ? `
        <div style="margin-top:6px;display:flex;gap:6px;align-items:center">
          <span style="font-size:12px;color:var(--text2)">Порт:</span>
          <input type="number" id="set_server_port" value="${s.serverPort || 3377}" style="width:80px;padding:4px 8px;font-size:12px;border:1px solid var(--border);border-radius:6px;background:var(--bg2);color:var(--text);font-family:inherit" onchange="settingsUpdatePort(this.value)">
        </div>
        ${serverStatusHtml}` : ''}
      ${clientStatusHtml}
    </div>

    ${mode !== 'client' ? `
    <div class="settings-section">
      <div class="settings-section-title">Пользователи</div>
      ${users.map((u, i) => `
        <div class="settings-user-card ${i === activeIdx ? 'active' : ''}" onclick="settingsSwitchUser(${i})">
          <div class="settings-user-avatar">${(u.name || 'П')[0].toUpperCase()}</div>
          <div style="flex:1;min-width:0">
            <div class="settings-user-name">${u.name || 'Без имени'}</div>
            <div class="settings-user-path" title="${u.dataDir || ''}">${u.dataDir || 'путь не задан'}</div>
          </div>
          <div class="settings-actions">
            <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();settingsEditUser(${i})" title="Редактировать" style="font-size:11px;padding:3px 8px">
              <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            ${users.length > 1 ? `<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();settingsDeleteUser(${i})" title="Удалить" style="font-size:11px;padding:3px 8px;color:var(--danger,#ef4444)">
              <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            </button>` : ''}
          </div>
        </div>
      `).join('')}
      <button class="btn btn-ghost" onclick="settingsAddUser()" style="width:100%;margin-top:6px;font-size:12px;padding:8px;border:1px dashed var(--border);border-radius:8px">
        + Добавить пользователя
      </button>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Путь хранения данных</div>
      <div class="settings-path-row">
        <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="color:var(--text3);flex-shrink:0">
          <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
        </svg>
        <span class="settings-path-text">${users[activeIdx].dataDir || 'не задан'}</span>
        <button class="btn btn-ghost btn-sm" onclick="settingsChooseFolder()" style="font-size:11px;padding:3px 10px;white-space:nowrap">Изменить</button>
        <button class="btn btn-ghost btn-sm" onclick="window.electronAPI.openDataFolder()" style="font-size:11px;padding:3px 10px;white-space:nowrap">Открыть</button>
      </div>
    </div>` : ''}
  `;
}

let _settingsPromptCallback = null;
function showSettingsPrompt(title, defaultValue) {
  document.getElementById('settingsPromptTitle').textContent = title;
  const inp = document.getElementById('settingsPromptInput');
  inp.value = defaultValue || '';
  openModal('settingsPromptModal');
  setTimeout(() => inp.focus(), 100);
}
function settingsPromptOk() {
  const val = document.getElementById('settingsPromptInput').value;
  closeModal('settingsPromptModal');
  if (_settingsPromptCallback) _settingsPromptCallback(val);
  _settingsPromptCallback = null;
}

async function settingsSwitchUser(idx) {
  if (!_appSettings || idx === _appSettings.activeUser) return;
  await window.electronAPI.switchUser(idx);
  _appSettings.activeUser = idx;
  data = await loadData();
  rebuildIndex();
  populateOrgSelect();
  updateFilterUI();
  renderVehicleList();
  renderSettingsBody();
  updateSidebarDataPath();
  showToast('Пользователь: ' + (_appSettings.users[idx].name || 'Без имени'));
}

function settingsAddUser() {
  _settingsPromptCallback = async (name) => {
    if (!name || !name.trim()) return;
    const folderResult = await window.electronAPI.chooseDataFolder();
    if (!folderResult.ok) return;
    _appSettings.users.push({ name: name.trim(), dataDir: folderResult.path });
    await window.electronAPI.saveSettings(_appSettings);
    renderSettingsBody();
  };
  showSettingsPrompt('Имя нового пользователя:', '');
}

function settingsEditUser(idx) {
  const u = _appSettings.users[idx];
  if (!u) return;
  _settingsPromptCallback = async (name) => {
    if (name === null) return;
    u.name = name.trim() || 'Пользователь';
    await window.electronAPI.saveSettings(_appSettings);
    renderSettingsBody();
    updateSidebarDataPath();
  };
  showSettingsPrompt('Имя пользователя:', u.name || '');
}

async function settingsDeleteUser(idx) {
  if (_appSettings.users.length <= 1) return;
  const u = _appSettings.users[idx];
  if (!confirm('Удалить пользователя "' + (u.name || '') + '"?\nДанные на диске НЕ удаляются.')) return;
  const wasActive = _appSettings.activeUser;
  _appSettings.users.splice(idx, 1);
  if (wasActive === idx) _appSettings.activeUser = 0;
  else if (wasActive > idx) _appSettings.activeUser = wasActive - 1;
  await window.electronAPI.saveSettings(_appSettings);
  data = await loadData();
  rebuildIndex();
  populateOrgSelect();
  updateFilterUI();
  renderVehicleList();
  renderSettingsBody();
  updateSidebarDataPath();
}

async function settingsChooseFolder() {
  const result = await window.electronAPI.chooseDataFolder();
  if (!result.ok) return;
  const idx = _appSettings.activeUser || 0;
  _appSettings.users[idx].dataDir = result.path;
  await window.electronAPI.saveSettings(_appSettings);
  data = await loadData();
  rebuildIndex();
  populateOrgSelect();
  updateFilterUI();
  renderVehicleList();
  renderSettingsBody();
  updateSidebarDataPath();
  showToast('Путь данных изменён');
}

async function settingsSetMode(mode) {
  _appSettings.networkMode = mode;
  if (mode === 'server') {
    await window.electronAPI.saveSettings(_appSettings);
    await settingsStartServer();
  } else if (mode === 'client') {
    await window.electronAPI.serverStop();
    await window.electronAPI.saveSettings(_appSettings);
  } else {
    await window.electronAPI.serverStop();
    await window.electronAPI.saveSettings(_appSettings);
    data = await loadData();
    rebuildIndex();
    renderVehicleList();
  }
  renderSettingsBody();
  updateSidebarDataPath();
}

async function settingsStartServer() {
  const st = await window.electronAPI.serverStatus();
  if (st.running) {
    showToast('Сервер уже запущен на порту ' + st.port);
    renderSettingsBody();
    return;
  }
  const result = await window.electronAPI.serverStart();
  if (result.ok) {
    showToast('Сервер запущен на порту ' + (result.port) + '\nIP: ' + (result.ips.join(', ')));
  } else {
    showToast('Ошибка: ' + (result.error || 'не удалось запустить'));
  }
  renderSettingsBody();
}

async function settingsStopServer() {
  await window.electronAPI.serverStop();
  showToast('Сервер остановлен');
  renderSettingsBody();
}

async function settingsUpdatePort(val) {
  const port = parseInt(val) || 3377;
  _appSettings.serverPort = port;
  await window.electronAPI.saveSettings(_appSettings);
}

async function settingsTestConnection() {
  const host = document.getElementById('set_remote_host').value.trim();
  const port = parseInt(document.getElementById('set_remote_port').value) || 3377;
  const el = document.getElementById('connectionTestResult');
  if (!host) { el.innerHTML = '<span style="color:var(--danger,#ef4444)">Введите IP-адрес сервера</span>'; return; }
  el.innerHTML = '<span style="color:var(--text3)">Проверка соединения...</span>';
  _appSettings.remoteHost = host;
  _appSettings.remotePort = port;
  await window.electronAPI.saveSettings(_appSettings);
  const result = await window.electronAPI.serverPing(host, port);
  if (result && result.ok) {
    el.innerHTML = '<span style="color:#22c55e;font-weight:600">Подключено! Сервер: ' + (result.name || host) + '</span>';
    data = await loadData();
    rebuildIndex();
    populateOrgSelect();
    updateFilterUI();
    renderVehicleList();
    updateSidebarDataPath();
    showToast('Подключено к серверу ' + host + ':' + port);
  } else {
    el.innerHTML = '<span style="color:var(--danger,#ef4444)">Не удалось подключиться к ' + host + ':' + port + '</span>';
  }
}

function updateSidebarDataPath() {
  if (!_appSettings || !_appSettings.users) return;
  const mode = _appSettings.networkMode || 'local';
  const u = _appSettings.users[_appSettings.activeUser || 0];
  if (!u) return;
  const ul = document.getElementById('sidebarUserLabel');
  if (ul) ul.textContent = u.name || 'Пользователь';
  const dp = document.getElementById('sidebarDataPath');
  if (dp) {
    if (mode === 'client') {
      dp.textContent = 'Сервер: ' + (_appSettings.remoteHost || '?') + ':' + (_appSettings.remotePort || 3377);
    } else {
      dp.textContent = 'Данные: ' + (u.dataDir || '').replace(/\\/g, '\\');
    }
  }
  const modeEl = document.getElementById('sidebarModeLabel');
  if (modeEl) {
    modeEl.style.display = mode !== 'local' ? '' : 'none';
    modeEl.textContent = mode === 'server' ? 'Режим: Сервер' : mode === 'client' ? 'Режим: Клиент' : '';
  }
}

// ─── AUTO UPDATER ─────────────────────────────────────────
let _updateInfo = null;

function showUpdateBanner(info) {
  _updateInfo = info;
  const banner = document.getElementById('updateBanner');
  const title  = document.getElementById('updateTitle');
  const notes  = document.getElementById('updateNotes');
  if (!banner) return;
  title.textContent = `Доступно обновление v${info.version}` +
    (info.currentVersion ? ` (у вас v${info.currentVersion})` : '');
  notes.textContent = info.notes || '';
  banner.style.display = 'flex';
}

if (window.electronAPI && window.electronAPI.onUpdateAvailable) {
  window.electronAPI.onUpdateAvailable(info => showUpdateBanner(info));

  window.electronAPI.onDownloadProgress(pct => {
    const bar = document.getElementById('updateProgressBar');
    const txt = document.getElementById('updatePct');
    if (bar) bar.style.width = pct + '%';
    if (txt) txt.textContent = pct + '%';
    if (pct >= 100) {
      document.getElementById('updateProgress').style.display  = 'none';
      document.getElementById('updateInstallBtn').style.display = '';
    }
  });

  // Проверка при возврате в приложение (фокус окна)
  window.addEventListener('focus', async () => {
    if (_updateInfo) return; // баннер уже показан
    const info = await window.electronAPI.checkUpdate();
    if (info) showUpdateBanner(info);
  });
}

// Показать версию в сайдбаре
if (window.electronAPI && window.electronAPI.getAppVersion) {
  window.electronAPI.getAppVersion().then(v => {
    const el = document.getElementById('sidebarVersionLabel');
    if (el) el.textContent = 'Версия ' + v;
  });
}


async function startUpdateDownload() {
  if (!_updateInfo || !_updateInfo.url) return;
  document.getElementById('updateDownloadBtn').style.display = 'none';
  document.getElementById('updateProgress').style.display    = 'flex';
  document.getElementById('updateProgress').style.flexDirection = 'column';
  const result = await window.electronAPI.downloadUpdate(_updateInfo.url);
  if (!result.ok) {
    document.getElementById('updateProgress').style.display   = 'none';
    document.getElementById('updateDownloadBtn').style.display = '';
    showToast('Ошибка загрузки: ' + (result.error || 'неизвестная ошибка'));
  }
}

function installUpdate() {
  window.electronAPI.installUpdate();
}

// ─── CALENDAR ────────────────────────────────────────────
var calY = 0, calM = 0, calMode = 'days', calTargetField = 'rec_date';
var CAL_MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
var CAL_DAYS = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

function calOpen() { calOpenFor('rec_date'); }

function calOpenFor(fieldId) {
  calTargetField = fieldId;
  var inp = document.getElementById(fieldId);
  var pop = document.getElementById('calPopup');
  var v = inp.value, now = new Date();
  calMode = 'days';
  if (v && v.length === 10) {
    var p = v.split('.'); calY = +p[2]; calM = +p[1] - 1;
  } else { calY = now.getFullYear(); calM = now.getMonth(); }
  calRender();
  var r = inp.parentNode.getBoundingClientRect();
  var top = r.bottom + 4, left = r.left;
  if (left + 264 > window.innerWidth) left = window.innerWidth - 268;
  if (top + 280 > window.innerHeight) top = r.top - 284;
  pop.style.top = top + 'px'; pop.style.left = left + 'px';
  pop.style.display = 'block';
}

function calRender() {
  if (calMode === 'months') { calRenderMonths(); return; }
  var pop = document.getElementById('calPopup');
  var inp = document.getElementById(calTargetField);
  var today = new Date();
  var sel = null;
  var v = inp ? inp.value : '';
  if (v && v.length === 10) { var p = v.split('.'); sel = { y:+p[2], m:+p[1]-1, d:+p[0] }; }
  var first = new Date(calY, calM, 1);
  var dow = first.getDay(); dow = dow === 0 ? 6 : dow - 1;
  var dim = new Date(calY, calM + 1, 0).getDate();
  var diPrev = new Date(calY, calM, 0).getDate();
  var cells = CAL_DAYS.map(function(d){ return '<div class="cal-dow">'+d+'</div>'; }).join('');
  for (var i = 0; i < dow; i++) { cells += '<div class="cal-day other">'+(diPrev-dow+1+i)+'</div>'; }
  for (var d = 1; d <= dim; d++) {
    var isT = today.getFullYear()===calY && today.getMonth()===calM && today.getDate()===d;
    var isS = sel && sel.y===calY && sel.m===calM && sel.d===d;
    cells += '<div class="cal-day'+(isT?' today':'')+(isS?' selected':'')+'" onclick="calPick('+d+')">'+d+'</div>';
  }
  var rem = (dow+dim)%7; if (rem) for (var d=1; d<=7-rem; d++) cells += '<div class="cal-day other">'+d+'</div>';
  pop.innerHTML = '<div class="cal-header"><button class="cal-nav" onclick="calNav(-1)">&#8249;</button><div class="cal-title" onclick="calMode=\'months\';calRender()">'+CAL_MONTHS[calM]+' '+calY+'</div><button class="cal-nav" onclick="calNav(1)">&#8250;</button></div><div class="cal-grid">'+cells+'</div>';
}

function calRenderMonths() {
  var pop = document.getElementById('calPopup');
  var cells = CAL_MONTHS.map(function(m,i){ return '<div class="cal-mon'+(i===calM?' selected':'')+'" onclick="calPickM('+i+')">'+m+'</div>'; }).join('');
  pop.innerHTML = '<div class="cal-header"><button class="cal-nav" onclick="calNav(-1)">&#8249;</button><div class="cal-title">'+calY+'</div><button class="cal-nav" onclick="calNav(1)">&#8250;</button></div><div class="cal-months">'+cells+'</div>';
}

function calNav(dir) {
  if (calMode === 'months') { calY += dir; }
  else { calM += dir; if (calM < 0){calM=11;calY--;} else if (calM>11){calM=0;calY++;} }
  calRender();
}

function calPick(d) {
  var dd = String(d).padStart(2,'0'), mm = String(calM+1).padStart(2,'0');
  document.getElementById(calTargetField).value = dd+'.'+mm+'.'+calY;
  document.getElementById('calPopup').style.display = 'none';
}

function calPickM(m) { calM = m; calMode = 'days'; calRender(); }

document.addEventListener('mousedown', function(e) {
  var pop = document.getElementById('calPopup');
  if (!pop || pop.style.display === 'none') return;
  var inp = document.getElementById(calTargetField);
  if (!pop.contains(e.target) && !(inp && inp.parentNode.contains(e.target))) {
    pop.style.display = 'none';
  }
});

function calcFuelAuto() {
  const km  = parseFloat(document.getElementById('rec_km').value);
  const v   = data.vehicles.find(x => x.id === selectedVehicleId);
  const inp = document.getElementById('rec_fuel_used');
  if (!inp) return;
  if (!v || !v.norm || isNaN(km) || km <= 0) { inp.value = ''; return; }
  inp.value = Math.round(v.norm * km / 100 * 10) / 10;
}

function toggleHistoryFullscreen() {
  historyFullscreen = !historyFullscreen;
  const v = data.vehicles.find(x => x.id === selectedVehicleId);
  if (v) renderDetail(v);
}

// Закрыть полноэкранный режим по Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && historyFullscreen) {
    historyFullscreen = false;
    const v = data.vehicles.find(x => x.id === selectedVehicleId);
    if (v) renderDetail(v);
  }
});

function calcOdoEnd() {
  const start = parseFloat(document.getElementById('rec_odo_start').value);
  const km    = parseFloat(document.getElementById('rec_km').value);
  if (!isNaN(start) && !isNaN(km)) {
    document.getElementById('rec_odo_end').value = Math.round((start + km) * 10) / 10;
  }
}

function calcKmFromOdo() {
  const start = parseFloat(document.getElementById('rec_odo_start').value);
  const end   = parseFloat(document.getElementById('rec_odo_end').value);
  if (!isNaN(start) && !isNaN(end) && end > start) {
    document.getElementById('rec_km').value = Math.round((end - start) * 10) / 10;
    calcFuelAuto();
  }
}


// ─── ROUTES ──────────────────────────────────────────────
function routeAdd(value) {
  var list = document.getElementById('routesList');
  var row = document.createElement('div');
  row.className = 'route-row';
  var ta = document.createElement('textarea');
  ta.className = 'route-ta';
  ta.rows = 2;
  ta.placeholder = 'Карьер → База, объект...';
  if (value) ta.value = value;
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'route-remove';
  btn.title = 'Удалить';
  btn.innerHTML = '<svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  btn.onclick = function() { list.removeChild(row); };
  row.appendChild(ta);
  row.appendChild(btn);
  list.appendChild(row);
  ta.focus();
}

function routeSet(arr) {
  var list = document.getElementById('routesList');
  list.innerHTML = '';
  if (!arr || !arr.length) { routeAdd(''); return; }
  arr.forEach(function(v) { routeAdd(v); });
}

function routeGet() {
  var tas = document.querySelectorAll('#routesList .route-ta');
  var arr = [];
  tas.forEach(function(ta) { var v = ta.value.trim(); if (v) arr.push(v); });
  return arr;
}

