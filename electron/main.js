const { app, BrowserWindow, ipcMain, shell, dialog, session } = require('electron');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const http    = require('http');
const updater = require('./updater');
const server  = require('./server');
const { createExtractorFromData } = require('node-unrar-js');
const storage = require('./storage');
const { writeAtomic, validateSettings, databaseIdentity } = require('./settings');
const { trustedPage, canInvoke, staticFile } = require('./security');
const { pathToFileURL } = require('node:url');
const requestedProfile = app.commandLine.getSwitchValue('user-data-dir');
if (requestedProfile) app.setPath('userData', path.resolve(requestedProfile));

// A second writer must not open the same transaction journal in another process.
if (!app.requestSingleInstanceLock()) { app.exit(0); }
app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
});

const DEFAULT_DATA_DIR = path.join(os.homedir(), 'Documents', 'ДиспетчеризацияАвто_ТВС');
const SETTINGS_FILE   = path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  const defaults = {
    users: [{ name: 'Пользователь', dataDir: DEFAULT_DATA_DIR }], activeUser: 0,
    networkMode: 'local', serverPort: 3377, remoteHost: '', remotePort: 3377,
  };
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      const checked = validateSettings({ ...defaults, ...saved, networkKey: saved.networkKey || require('crypto').randomBytes(24).toString('hex') });
      if (!saved.networkKey) saveSettings(checked);
      return checked;
    }
  } catch (e) {
    dialog.showErrorBox('Не прочитаны настройки', 'Файл настроек повреждён. Сохраните его и восстановите корректную копию:\n' + SETTINGS_FILE + '\n' + e.message);
    app.exit(1);
  }
  return defaults;
}

function saveSettings(s) {
  const dir = path.dirname(SETTINGS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  writeAtomic(SETTINGS_FILE, JSON.stringify(s, null, 2));
}

let settings = loadSettings();
if (!settings.networkKey) {
  settings.networkKey = require('crypto').randomBytes(24).toString('hex');
  saveSettings(settings);
}
server.configureKey(settings.networkKey);

function getActiveUser() {
  const idx = settings.activeUser || 0;
  return settings.users[idx] || settings.users[0] || { name: 'Пользователь', dataDir: DEFAULT_DATA_DIR };
}

function getDataDir()   { return getActiveUser().dataDir || DEFAULT_DATA_DIR; }
function getDataFile()  { return path.join(getDataDir(), 'data.json'); }
function getBackupDir() { return path.join(getDataDir(), 'backups'); }
function getCacheFile() { return path.join(app.getPath('userData'), 'cache', databaseIdentity(settings) + '.json'); }
function rememberSnapshot(json, file = getCacheFile()) {
  try {
    const snapshot = JSON.parse(json);
    if (!Array.isArray(snapshot.vehicles) || !Array.isArray(snapshot.records)) throw new Error('Некорректный снимок базы');
    storage.SECTIONS.forEach(name => { if (name in snapshot) storage.validateRows(name, snapshot[name]); });
    writeAtomic(file, json);
  }
  catch (e) { console.warn('[cache] ' + e.message); }
  return json;
}
function rememberSections(sections, file = getCacheFile()) {
  try {
    const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
    rememberSnapshot(JSON.stringify({ ...cached, ...sections }), file);
  } catch (e) { console.warn('[cache] ' + e.message); }
}

let settingsChain = Promise.resolve();
function queueSettings(next) {
  const operation = settingsChain.then(() => applySettings(next));
  settingsChain = operation.catch(() => {});
  return operation;
}
async function applySettings(next) {
  const checked = validateSettings(next);
  const changed = databaseIdentity(settings) !== databaseIdentity(checked) || settings.networkMode !== checked.networkMode ||
    settings.serverPort !== checked.serverPort || settings.networkKey !== checked.networkKey;
  const restart = checked.networkMode === 'server' && (server.isRunning() || settings.networkMode !== 'server');
  if (changed) await server.stop();
  saveSettings(checked);
  settings = checked;
  server.configureKey(settings.networkKey);
  if (settings.networkMode !== 'client') ensureDirs();
  if (changed && restart) {
    const result = await startDataServer();
    if (!result.ok) throw new Error('Настройки сохранены, но сервер не запущен: ' + result.error);
  }
}

function startDataServer() {
  const dir = getDataDir();
  return server.start({ port: settings.serverPort || 3377, dataDir: dir,
    backupFn: () => storage.makeDailyBackup(dir, path.join(dir, 'backups'), 30),
    serverName: getActiveUser().name || os.hostname(), key: settings.networkKey });
}

// Check both the frame and the individual IPC capability before native access.
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => handle(channel, (event, ...args) => {
  const page = trustedPage(event.senderFrame?.url, path.join(__dirname, '..'), app._localServerPort);
  if (event.senderFrame !== event.sender.mainFrame || !canInvoke(page, channel)) throw new Error('Недоверенный источник запроса');
  return listener(event, ...args);
});
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => { if (url !== contents.getURL()) event.preventDefault(); });
  contents.on('will-attach-webview', event => event.preventDefault());
});

function ensureDirs() {
  const dd = getDataDir();
  const bd = getBackupDir();
  if (!fs.existsSync(dd)) fs.mkdirSync(dd, { recursive: true });
  if (!fs.existsSync(bd)) fs.mkdirSync(bd, { recursive: true });
}

// Копия собирается из разделов обратно в один файл — так её удобно
// открыть, переслать и при необходимости загрузить обратно целиком.
function createDailyBackup() {
  try { storage.makeDailyBackup(getDataDir(), getBackupDir(), 30); }
  catch (e) { console.error('[backup] ' + e.message); }
}

function applyBundledDataSeedOnce() {
  if (settings.networkMode === 'client') return;

  const seedVersion = '2.0.57';
  const seedFile = path.join(__dirname, '..', 'bundled-data', 'data-' + seedVersion + '.json');
  if (!fs.existsSync(seedFile)) return;

  const dataDir = getDataDir();
  const markerFile = path.join(dataDir, '.bundled-db-' + seedVersion + '.applied.json');
  if (fs.existsSync(markerFile)) return;

  try {
    ensureDirs();
    // Встроенная база нужна только для первой установки, не для обновления рабочих данных.
    const sectionDir = path.join(dataDir, 'sections');
    if (fs.existsSync(path.join(dataDir, 'data.json')) ||
        fs.existsSync(sectionDir) && fs.readdirSync(sectionDir).some(name => name.endsWith('.json'))) {
      console.log('[bundled-db] existing database preserved');
      return;
    }
    fs.mkdirSync(getBackupDir(), { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(getBackupDir(), 'data_before_bundled_' + seedVersion + '_' + stamp + '.json');
    fs.writeFileSync(backupFile, JSON.stringify(storage.readAll(dataDir), null, 2), 'utf8');

    const seed = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
    const res = storage.writeAll(dataDir, seed);
    fs.writeFileSync(markerFile, JSON.stringify({
      version: seedVersion,
      appliedAt: new Date().toISOString(),
      backupFile,
      changed: res.changed,
    }, null, 2), 'utf8');
    console.log('[bundled-db] applied ' + seedVersion + ', changed: ' + res.changed.join(', '));
  } catch (e) {
    console.error('[bundled-db] ' + e.message);
  }
}

function createWindow() {
  const iconPath = path.join(__dirname, '../build/icon.ico');
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 620,
    title: 'Диспетчеризация авто группы компаний ООО "Технрайз Велл Сервис"',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.webContents.on('will-navigate', (event, url) => {
    const origin = 'http://127.0.0.1:' + app._localServerPort;
    if (!url.startsWith(origin + '/')) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Serve index.html via local HTTP to avoid file:// rendering bugs
  const rootDir = path.join(__dirname, '..');
  const mime = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.ico':'image/x-icon', '.svg':'image/svg+xml' };
  if (!app._localServer) {
    app._localServer = http.createServer((req, res) => {
      const filePath = staticFile(rootDir, req.url);
      if (!filePath || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(403); res.end(); return; }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'none'; frame-ancestors 'none'" });
        res.end(req.method === 'HEAD' ? undefined : data);
      });
    });
    app._localServer.listen(0, '127.0.0.1', () => {
      const port = app._localServer.address().port;
      app._localServerPort = port;
      win.loadURL(`http://127.0.0.1:${port}/index.html`);
    });
  } else {
    win.loadURL(`http://127.0.0.1:${app._localServerPort}/index.html`);
  }

  // Проверка обновлений через 5 сек после запуска
  win.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      const info = await updater.checkForUpdate();
      if (info && !win.isDestroyed()) win.webContents.send('update-available', info);
    }, 5000);
  });

  // Периодическая проверка каждые 3 минуты
  const updateTimer = setInterval(async () => {
    const info = await updater.checkForUpdate();
    if (info && !win.isDestroyed()) win.webContents.send('update-available', info);
  }, 3 * 60 * 1000);
  win.once('closed', () => clearInterval(updateTimer));

  // Проверка при показе/разворачивании окна
  win.on('show', async () => {
    const info = await updater.checkForUpdate();
    if (info && !win.isDestroyed()) win.webContents.send('update-available', info);
  });

  return win;
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  ensureDirs();
  applyBundledDataSeedOnce();

  // Экспорт сводок/актов (XLSX) идёт через обычную загрузку браузера —
  // открываем файл сразу после сохранения, чтобы не искать его в "Загрузках".
  session.defaultSession.on('will-download', (_event, item) => {
    item.once('done', (_e, state) => {
      if (state === 'completed' && /\.(xlsx?|pdf|json)$/i.test(item.getSavePath())) shell.openPath(item.getSavePath());
    });
  });

  function isClientMode() { return settings.networkMode === 'client'; }

  ipcMain.handle('read-data', async () => {
    const cacheFile = getCacheFile();
    if (isClientMode()) {
      try {
        return rememberSnapshot(await server.fetchData(settings.remoteHost, settings.remotePort || 3377), cacheFile);
      } catch (e) {
        return null;
      }
    }
    try {
      return rememberSnapshot(JSON.stringify(storage.readAll(getDataDir())));
    } catch (e) {
      console.error('[read-data] ' + e.message);
      return null;
    }
  });

  ipcMain.handle('read-cached-data', () => {
    try { return fs.readFileSync(getCacheFile(), 'utf8'); } catch { return null; }
  });

  ipcMain.handle('database-health', async () => {
    try {
      const { inspectData } = require('./database-health');
      const data = isClientMode()
        ? (await server.getJson(settings.remoteHost, settings.remotePort, '/api/snapshot', 15000)).data
        : storage.readAll(getDataDir());
      const dir = isClientMode() ? path.join(app.getPath('userData'), 'client-backups', databaseIdentity(settings)) : getBackupDir();
      const backups = fs.existsSync(dir) ? fs.readdirSync(dir).filter(name => /^(data_|manual_).*\.json$/.test(name)) : [];
      const latest = backups.map(name => ({ name, date: fs.statSync(path.join(dir, name)).mtime.toISOString() })).sort((a, b) => b.date.localeCompare(a.date))[0];
      return { ok: true, ...inspectData(data), backupCount: backups.length, lastBackup: latest?.date || null, path: isClientMode() ? settings.remoteHost + ':' + settings.remotePort : getDataDir() };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('create-backup', async () => {
    const clientBackupDir = path.join(app.getPath('userData'), 'client-backups', databaseIdentity(settings));
    try {
      let filePath;
      if (isClientMode()) {
        const snapshot = await server.getJson(settings.remoteHost, settings.remotePort, '/api/snapshot', 15000);
        require('./database-health').inspectData(snapshot.data);
        const dir = clientBackupDir;
        filePath = path.join(dir, 'manual_' + require('crypto').randomUUID() + '.json');
        writeAtomic(filePath, JSON.stringify(snapshot.data));
      } else filePath = storage.makeManualBackup(getDataDir(), getBackupDir());
      shell.showItemInFolder(filePath);
      return { ok: true, filePath };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('write-data', async (_event, jsonStr) => {
    const cacheFile = getCacheFile();
    if (isClientMode()) {
      try {
        const res = await server.postData(settings.remoteHost, settings.remotePort || 3377, jsonStr);
        if (res && res.ok) rememberSnapshot(jsonStr, cacheFile);
        return res && res.ok;
      } catch (e) {
        return false;
      }
    }
    ensureDirs();
    createDailyBackup();
    try {
      const res = storage.writeAll(getDataDir(), JSON.parse(jsonStr));
      rememberSnapshot(JSON.stringify(storage.readAll(getDataDir())));
      if (res.changed.length) console.log('[write-data] разделы: ' + res.changed.join(', '));
      return true;
    } catch (e) {
      console.error('[write-data] ' + e.message);
      return false;
    }
  });

  // ── Синхронизация по разделам ──
  // Снимок: данные + версии разделов. На старом сервере (без /api/snapshot)
  // версии неизвестны — клиент работает по-старому, целиком.
  ipcMain.handle('read-snapshot', async () => {
    const cacheFile = getCacheFile();
    if (isClientMode()) {
      const host = settings.remoteHost, port = settings.remotePort || 3377;
      try {
        const snap = await server.getJson(host, port, '/api/snapshot', 15000);
        rememberSnapshot(JSON.stringify(snap.data), cacheFile);
        return JSON.stringify(snap);
      }
      catch (e) {
        try { return JSON.stringify({ data: JSON.parse(await server.fetchData(host, port)), revisions: null }); }
        catch { return null; }
      }
    }
    try {
      const data = storage.readAll(getDataDir()); rememberSnapshot(JSON.stringify(data));
      return JSON.stringify({ data, revisions: storage.readRevisions(getDataDir()) });
    } catch (e) {
      console.error('[read-snapshot] ' + e.message);
      return null;
    }
  });

  ipcMain.handle('get-revisions', async () => {
    try {
      if (isClientMode()) return await server.getJson(settings.remoteHost, settings.remotePort || 3377, '/api/revisions', 5000);
      return storage.readRevisions(getDataDir());
    } catch (e) { return null; }
  });

  ipcMain.handle('read-section', async (_event, name) => {
    const cacheFile = getCacheFile();
    try {
      if (isClientMode()) {
        const section = await server.getJson(settings.remoteHost, settings.remotePort || 3377, '/api/section/' + encodeURIComponent(name), 15000);
        rememberSections({ [name]: section.rows }, cacheFile);
        return section;
      }
      return storage.readSection(getDataDir(), name);
    } catch (e) { return null; }
  });

  ipcMain.handle('write-sections', async (_event, jsonStr) => {
    const cacheFile = getCacheFile();
    if (isClientMode()) {
      try {
        const result = await server.postSections(settings.remoteHost, settings.remotePort || 3377, jsonStr);
        if (result.ok) rememberSections(JSON.parse(jsonStr).sections, cacheFile);
        return result;
      }
      catch (e) { return { ok: false, error: e.message }; }
    }
    ensureDirs();
    createDailyBackup();
    try {
      const res = storage.writeSections(getDataDir(), JSON.parse(jsonStr));
      if (res.ok) rememberSnapshot(JSON.stringify(storage.readAll(getDataDir())));
      if (res.ok && res.changed.length) console.log('[write-sections] ' + res.changed.join(', '));
      return res;
    } catch (e) {
      console.error('[write-sections] ' + e.message);
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('get-data-path', () => getDataDir());

  ipcMain.handle('get-settings', () => settings);
  ipcMain.handle('get-theme', () => settings.uiTheme || null);
  ipcMain.handle('set-theme', async (_event, theme) => {
    if (!['light', 'dark'].includes(theme)) throw new Error('Неизвестная тема');
    await queueSettings({ ...settings, uiTheme: theme });
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('workspace-theme-changed', theme);
    return true;
  });

  ipcMain.handle('save-settings', async (_event, newSettings) => {
    await queueSettings(newSettings);
    return true;
  });

  ipcMain.handle('switch-user', async (_event, idx) => {
    if (idx < 0 || idx >= settings.users.length) return { ok: false };
    await queueSettings({ ...settings, activeUser: idx });
    return { ok: true };
  });

  ipcMain.handle('choose-data-folder', async (event) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(senderWin, {
      title: 'Выберите папку для хранения данных',
      defaultPath: getDataDir(),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || !filePaths || !filePaths[0]) return { ok: false };
    return { ok: true, path: filePaths[0] };
  });

  ipcMain.handle('server-start', async () => {
    return startDataServer();
  });

  ipcMain.handle('server-stop', async () => {
    await server.stop();
    return { ok: true };
  });

  ipcMain.handle('server-status', () => {
    return {
      running: server.isRunning(),
      ips: server.getLocalIPs(),
      port: settings.serverPort || 3377,
    };
  });

  ipcMain.handle('server-ping', async (_event, host, port) => {
    return await server.ping(host, port || 3377);
  });

  // Автозапуск сервера если настроен режим "server"
  if (settings.networkMode === 'server') {
    startDataServer().then(result => { if (!result.ok) console.error('[server] ' + result.error); });
  }

  // Импорт данных из RAR-архива (data.json + backups) для пополнения базы
  ipcMain.handle('import-rar', async (event) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(senderWin, {
      title: 'Выберите RAR-архив с данными',
      filters: [{ name: 'RAR архив', extensions: ['rar'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths || !filePaths[0]) return { ok: false, canceled: true };

    const KEYS = ['vehicles', 'records', 'generators', 'genRecords', 'toRecords', 'tanks', 'tankIncomes'];
    const pick = (obj) => {
      const o = {};
      KEYS.forEach(k => { o[k] = Array.isArray(obj[k]) ? obj[k] : []; });
      return o;
    };

    try {
      const buf = fs.readFileSync(filePaths[0]);
      const ab  = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      const extractor = await createExtractorFromData({ data: ab });
      const headers = [...extractor.getFileList().fileHeaders];
      const jsonNames = headers
        .filter(h => !h.flags.directory && h.name.toLowerCase().endsWith('.json'))
        .map(h => h.name);
      if (!jsonNames.length) return { ok: false, error: 'В архиве не найдено JSON-файлов с данными.' };

      const extracted = extractor.extract({ files: jsonNames });
      const dec = new TextDecoder('utf-8');
      let main = null;
      const backupObjs = [];
      for (const f of extracted.files) {
        const name = f.fileHeader.name.split('\\').join('/');
        let obj;
        try { obj = JSON.parse(dec.decode(f.extraction)); } catch { continue; }
        if (!obj || typeof obj !== 'object') continue;
        const isBackup = /backups\//i.test(name);
        const isMain   = /(^|\/)data\.json$/i.test(name) && !isBackup;
        if (isMain) main = pick(obj);
        else if (isBackup) backupObjs.push(pick(obj));
        else if (!main) main = pick(obj); // запасной вариант: любой не-backup json
      }
      if (!main) main = pick({});

      // Данные, которые есть в бэкапах, но отсутствуют в основном data.json (по id)
      const backupExtra = {};
      KEYS.forEach(k => {
        const seen = new Set(main[k].map(x => x && x.id).filter(Boolean));
        const extra = [];
        backupObjs.forEach(bo => {
          bo[k].forEach(item => {
            const id = item && item.id;
            if (!id || seen.has(id)) return;
            seen.add(id);
            extra.push(item);
          });
        });
        backupExtra[k] = extra;
      });

      return { ok: true, fileName: path.basename(filePaths[0]), backupCount: backupObjs.length, main, backupExtra };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Экспорт произвольного JSON-подмножества данных в файл (для передачи между приложениями)
  ipcMain.handle('export-json', async (event, jsonStr, defaultFileName) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePath } = await dialog.showSaveDialog(senderWin, {
      title: 'Сохранить JSON-файл',
      defaultPath: path.join(app.getPath('documents'), defaultFileName || 'export.json'),
      filters: [{ name: 'JSON файл', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    fs.writeFileSync(filePath, jsonStr, 'utf8');
    shell.showItemInFolder(filePath);
    return { ok: true, filePath };
  });

  // Импорт JSON-файла (сырые данные, без RAR) — выбор файла и чтение содержимого
  ipcMain.handle('import-json-file', async (event) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(senderWin, {
      title: 'Выберите JSON-файл с данными',
      filters: [{ name: 'JSON файл', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths || !filePaths[0]) return { ok: false, canceled: true };
    try {
      return { ok: true, fileName: path.basename(filePaths[0]), content: fs.readFileSync(filePaths[0], 'utf8') };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('open-data-folder', () => shell.openPath(getDataDir()));

  ipcMain.handle('get-app-version', () => app.getVersion());
  // Список изменений — assets/CHANGELOG.md внутри программы
  ipcMain.handle('get-changelog', () => {
    try { return fs.readFileSync(path.join(__dirname, '..', 'assets', 'CHANGELOG.md'), 'utf8'); }
    catch (e) { return ''; }
  });

  // Экспорт HTML-сводки в PDF (рендер через printToPDF — корректная кириллица)
  ipcMain.handle('export-pdf', async (event, payload) => {
    const html = payload && payload.html;
    const defaultFileName = (payload && payload.defaultFileName) || 'Сводка.pdf';
    if (!html) return { ok: false, error: 'Пустой документ' };

    const senderWin = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePath } = await dialog.showSaveDialog(senderWin, {
      title: 'Сохранить сводку в PDF',
      defaultPath: path.join(app.getPath('documents'), defaultFileName),
      filters: [{ name: 'PDF документ', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };

    const tmpFile = path.join(os.tmpdir(), `svodka_${Date.now()}.html`);
    const pdfWin = new BrowserWindow({
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, javascript: false },
    });
    try {
      fs.writeFileSync(tmpFile, html, 'utf8');
      await pdfWin.loadFile(tmpFile);
      const pdfData = await pdfWin.webContents.printToPDF({
        printBackground: true,
        landscape: true,
        pageSize: 'A4',
        margins: { top: 0.4, bottom: 0.4, left: 0.3, right: 0.3 },
      });
      fs.writeFileSync(filePath, pdfData);
      shell.openPath(filePath);
      return { ok: true, path: filePath };
    } catch (e) {
      return { ok: false, error: e.message };
    } finally {
      pdfWin.destroy();
      try { fs.unlinkSync(tmpFile); } catch (_) { /* ignore */ }
    }
  });

  ipcMain.handle('check-update', async () => {
    return await updater.checkForUpdate();
  });

  let downloadedPath = null;
  ipcMain.handle('download-update', async (event, url) => {
    downloadedPath = null;
    try {
      const filePath = await updater.downloadFile(url, pct => {
        if (!event.sender.isDestroyed()) event.sender.send('download-progress', pct);
      });
      downloadedPath = filePath;
      return { ok: true, path: filePath };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('install-update', async () => {
    if (downloadedPath && fs.existsSync(downloadedPath)) {
      await updater.launchInstaller(downloadedPath);
    }
  });

  // ─── РЕЕСТР-БИЛДЕР ──────────────────────────────────────
  const REESTR_DIR = path.join(__dirname, '..', 'ReestrBuilder');
  const REESTR_LIB_URL = pathToFileURL(path.join(REESTR_DIR, 'lib.mjs')).href;
  const reestrLibrary = () => import(REESTR_LIB_URL).then(lib => {
    lib.setKnowledgeDir(path.join(app.getPath('userData'), 'ReestrBuilder'));
    return lib;
  });

  ipcMain.handle('reestr-parse-invoices', async (event, zipArrayBuffer) => {
    console.log('[reestr] parse-invoices start');
    const { parseInvoices, loadConfig } = await reestrLibrary();
    const config = loadConfig(path.join(REESTR_DIR, 'config.json'));
    const log = [];
    const rows = await parseInvoices(Buffer.from(zipArrayBuffer), config, (msg) => { log.push(msg); console.log('[reestr] log:', msg.type, msg.text); });
    console.log('[reestr] parse-invoices done, rows:', rows.length);
    return { log, rows, config };
  });

  ipcMain.handle('reestr-parse-pdfs', async (event, pdfFilesRaw) => {
    console.log('[reestr] parse-pdfs start, files:', pdfFilesRaw.length);
    const { parsePdfFiles, loadConfig } = await reestrLibrary();
    const config = loadConfig(path.join(REESTR_DIR, 'config.json'));
    const log = [];
    const pdfFiles = pdfFilesRaw.map(f => ({ name: f.name, buffer: Buffer.from(f.buffer) }));
    const rows = await parsePdfFiles(pdfFiles, config,
      (msg) => { log.push(msg); console.log('[reestr] log:', msg.type, msg.text); },
      (progress) => { event.sender.send('reestr-progress', progress); },
      (ocr) => { event.sender.send('reestr-ocr-page', ocr); }
    );
    console.log('[reestr] parse-pdfs done, rows:', rows.length);
    return { log, rows, config };
  });

  ipcMain.handle('reestr-build-xlsx', async (event, { rows }) => {
    const { buildXlsxFromRows, loadConfig } = await reestrLibrary();
    const config = loadConfig(path.join(REESTR_DIR, 'config.json'));
    const { buffer, total } = await buildXlsxFromRows(rows, config);
    return {
      filename: `Реестр_${new Date().toISOString().slice(0, 10)}.xlsx`,
      xlsxBase64: buffer.toString('base64'),
      total,
    };
  });

  ipcMain.handle('reestr-learn', async (event, rows) => {
    const { learnFromRows } = await reestrLibrary();
    return learnFromRows(rows);
  });

  ipcMain.handle('reestr-apply-knowledge', async (event, rows) => {
    const { applyKnowledge } = await reestrLibrary();
    return applyKnowledge(rows);
  });

  ipcMain.handle('reestr-analytics', async (event, rows) => {
    const { getAnalytics } = await reestrLibrary();
    return getAnalytics(rows);
  });

  ipcMain.handle('reestr-load-statyi', async () => {
    const p = path.join(REESTR_DIR, 'statyi.json');
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
    return [];
  });

  ipcMain.handle('reestr-load-contracts', async () => {
    const p = path.join(REESTR_DIR, 'contracts.json');
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
    return [];
  });

  ipcMain.handle('reestr-save-xlsx', async (event, { filename, xlsxBase64 }) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePath } = await dialog.showSaveDialog(senderWin, {
      title: 'Сохранить реестр',
      defaultPath: path.join(app.getPath('downloads'), filename),
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (canceled || !filePath) return { saved: false };
    fs.writeFileSync(filePath, Buffer.from(xlsxBase64, 'base64'));
    shell.showItemInFolder(filePath);
    return { saved: true, path: filePath };
  });

  // ─── Отдельное окно реестра ───
  const reestrWindowData = new Map();

  ipcMain.handle('open-reestr-window', (event, data) => {
    const parentWin = BrowserWindow.fromWebContents(event.sender);
    const iconPath = path.join(__dirname, '../build/icon.ico');
    const reestrWin = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 900,
      minHeight: 600,
      title: 'Реестр счетов',
      icon: fs.existsSync(iconPath) ? iconPath : undefined,
      parent: parentWin || undefined,
      webPreferences: {
        preload: path.join(__dirname, 'reestr-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    reestrWin.setMenuBarVisibility(false);
    reestrWindowData.set(reestrWin.webContents.id, { ...data, theme: settings.uiTheme || 'light', databaseIdentity: databaseIdentity(settings), ownerId: event.sender.id });
    const reestrId = reestrWin.webContents.id;
    reestrWin.once('closed', () => reestrWindowData.delete(reestrId));
    reestrWin.loadFile(path.join(__dirname, '../reestr-window.html'));
    return true;
  });

  // ─── PDF Editor ───
  ipcMain.handle('open-pdf-editor', async (event) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(senderWin, {
      title: 'Выберите PDF-файл для редактирования',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths || !filePaths[0]) return { ok: false };

    const pdfPath = filePaths[0];
    const pdfData = fs.readFileSync(pdfPath);

    const iconPath = path.join(__dirname, '../build/icon.ico');
    const pdfWin = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 900,
      minHeight: 600,
      title: 'PDF-редактор — ' + path.basename(pdfPath),
      icon: fs.existsSync(iconPath) ? iconPath : undefined,
      parent: senderWin || undefined,
      webPreferences: {
        preload: path.join(__dirname, 'pdf-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    pdfWin.setMenuBarVisibility(false);
    const editorId = pdfWin.webContents.id;
    pdfEditorData.set(editorId, { pdfBase64: pdfData.toString('base64'), filePath: pdfPath, fileName: path.basename(pdfPath), theme: settings.uiTheme || 'light' });
    pdfWin.once('closed', () => pdfEditorData.delete(editorId));
    pdfWin.loadFile(path.join(__dirname, '../pdf-editor.html'));
    return { ok: true };
  });

  const pdfEditorData = new Map();

  ipcMain.handle('pdf-editor-data', event => pdfEditorData.get(event.sender.id));

  ipcMain.handle('pdf-editor-save', async (event, { pdfBase64, filePath }) => {
    const editor = pdfEditorData.get(event.sender.id);
    if (!editor || filePath && filePath !== editor.filePath) throw new Error('Выберите путь через «Сохранить как»');
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    let savePath = filePath;
    if (!savePath) {
      const { canceled, filePath: fp } = await dialog.showSaveDialog(senderWin, {
        title: 'Сохранить PDF',
        defaultPath: editor.filePath,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (canceled || !fp) return { saved: false };
      savePath = fp;
    }
    writeAtomic(savePath, Buffer.from(pdfBase64, 'base64'));
    return { saved: true, path: savePath };
  });

  ipcMain.handle('pdf-editor-merge', async (event) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(senderWin, {
      title: 'Выберите PDF для объединения',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['openFile', 'multiSelections'],
    });
    if (canceled || !filePaths || !filePaths.length) return { ok: false };
    const files = filePaths.map(fp => ({
      name: path.basename(fp),
      base64: fs.readFileSync(fp).toString('base64'),
    }));
    return { ok: true, files };
  });

  ipcMain.handle('pdf-editor-insert-image', async (event) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(senderWin, {
      title: 'Выберите изображение',
      filters: [{ name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'webp'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths || !filePaths[0]) return { ok: false };
    const imgPath = filePaths[0];
    const ext = path.extname(imgPath).toLowerCase();
    const base64 = fs.readFileSync(imgPath).toString('base64');
    const dataUrl = `data:image/${ext === '.jpg' || ext === '.jpeg' ? 'jpeg' : 'png'};base64,${base64}`;
    return { ok: true, dataUrl, name: path.basename(imgPath) };
  });

  let ocrWorker = null;
  ipcMain.handle('pdf-editor-ocr', async (event, { imageBase64 }) => {
    const Tesseract = require('tesseract.js');
    if (!ocrWorker) {
      const langDir = (() => {
        const dirs = [
          path.join(process.resourcesPath, 'app.asar.unpacked'),
          path.join(process.resourcesPath, 'app'),
          path.join(__dirname, '..'),
        ];
        for (const d of dirs) {
          if (fs.existsSync(path.join(d, 'rus.traineddata'))) return d;
        }
        return null;
      })();
      const opts = langDir ? { langPath: langDir, gzip: false } : {};
      ocrWorker = await Tesseract.createWorker('rus+eng', undefined, opts);
    }
    const buf = Buffer.from(imageBase64, 'base64');
    const tmpFile = path.join(os.tmpdir(), `ocr_pdf_${Date.now()}.png`);
    try {
      fs.writeFileSync(tmpFile, buf);
      await ocrWorker.setParameters({
        tessedit_pageseg_mode: '3',
        // Страница приходит из редактора отрисованной в 300 DPI. Без явного
        // указания Tesseract пытается угадать разрешение по картинке и при
        // ошибке неверно оценивает размер шрифта, что портит распознавание.
        user_defined_dpi: '300',
        preserve_interword_spaces: '1',
      });
      const result = await Promise.race([
        ocrWorker.recognize(tmpFile),
        new Promise((_, rej) => setTimeout(() => rej(new Error('OCR timeout')), 180000)),
      ]);
      let lines = [];
      if (result.data.lines && result.data.lines.length > 0) {
        lines = result.data.lines.map(line => ({
          text: line.text.trim(),
          bbox: { x: line.bbox.x0, y: line.bbox.y0, w: line.bbox.x1 - line.bbox.x0, h: line.bbox.y1 - line.bbox.y0 },
        })).filter(l => l.text.length > 0);
      } else if (result.data.blocks && result.data.blocks.length > 0) {
        for (const block of result.data.blocks) {
          for (const par of (block.paragraphs || [])) {
            for (const line of (par.lines || [])) {
              const text = (line.words || []).map(w => w.text).join(' ').trim();
              if (!text) continue;
              const bb = line.bbox;
              lines.push({
                text,
                bbox: { x: bb.x0, y: bb.y0, w: bb.x1 - bb.x0, h: bb.y1 - bb.y0 },
              });
            }
          }
        }
      } else if (result.data.text && result.data.text.trim().length > 0) {
        const textLines = result.data.text.trim().split('\n').filter(l => l.trim().length > 0);
        const imgH = 1000;
        const lineH = Math.round(imgH / (textLines.length || 1));
        textLines.forEach((t, i) => {
          lines.push({ text: t.trim(), bbox: { x: 50, y: i * lineH + 10, w: 500, h: lineH - 5 } });
        });
      }
      return { ok: true, lines };
    } catch (e) {
      return { ok: false, error: e.message };
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  });

  // ─── Импорт Сводки из PDF ───
  ipcMain.handle('import-svodka-pdf', async (event) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(senderWin, {
      title: 'Выберите PDF-файл сводки',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths || !filePaths[0]) return { ok: false };
    try {
      const pdfData = new Uint8Array(fs.readFileSync(filePaths[0]));
      const pdfjsPkg = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const { getDocument } = pdfjsPkg;
      const doc = await getDocument({ data: pdfData, useSystemFonts: true }).promise;
      const allItems = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        for (const item of content.items) {
          if (!item.str || !item.str.trim()) continue;
          allItems.push({
            str: item.str,
            x: Math.round(item.transform[4] * 10) / 10,
            y: Math.round(item.transform[5] * 10) / 10,
            w: Math.round((item.width || 0) * 10) / 10,
            h: Math.round((item.height || 0) * 10) / 10,
            page: i,
          });
        }
      }
      return { ok: true, items: allItems, fileName: path.basename(filePaths[0]) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Отчёт ГЛОНАСС: PDF отдаём текстом с координатами, Excel — как есть
  ipcMain.handle('import-glonass-file', async (event) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(senderWin, {
      title: 'Выберите отчёт ГЛОНАСС («Рейсы» или суточный пробег)',
      filters: [{ name: 'Отчёт ГЛОНАСС', extensions: ['pdf', 'xlsx', 'xls'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths || !filePaths[0]) return { ok: false };
    const file = filePaths[0];
    try {
      if (!/\.pdf$/i.test(file)) {
        return { ok: true, kind: 'xlsx', base64: fs.readFileSync(file).toString('base64'), fileName: path.basename(file) };
      }
      const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true }).promise;
      const items = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        for (const it of content.items) {
          if (!it.str || !it.str.trim()) continue;
          items.push({ str: it.str, x: Math.round(it.transform[4] * 10) / 10, y: Math.round(it.transform[5] * 10) / 10, page: i });
        }
      }
      return { ok: true, kind: 'pdf', items, fileName: path.basename(file) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('pdf-editor-save-as', async (event, { pdfBase64 }) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePath } = await dialog.showSaveDialog(senderWin, {
      title: 'Сохранить PDF как…',
      defaultPath: pdfEditorData.get(event.sender.id)?.filePath.replace(/\.pdf$/i, '_edited.pdf') || 'edited.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return { saved: false };
    writeAtomic(filePath, Buffer.from(pdfBase64, 'base64'));
    shell.showItemInFolder(filePath);
    return { saved: true, path: filePath };
  });

  ipcMain.handle('reestr-window-data', event => {
    return reestrWindowData.get(event.sender.id);
  });

  ipcMain.handle('reestr-save-rows', async (event, rows) => {
    try {
      storage.validateRows('reestrRows', rows);
      const context = reestrWindowData.get(event.sender.id), identity = databaseIdentity(settings), cacheFile = getCacheFile();
      if (!context || context.databaseIdentity !== identity) throw new Error('База переключена. Откройте реестр заново в нужной базе.');
      const client = isClientMode(), dir = getDataDir();
      const snapshot = client ? await server.getJson(settings.remoteHost, settings.remotePort, '/api/snapshot', 15000)
        : { data: storage.readAll(dir), revisions: storage.readRevisions(dir) };
      if (databaseIdentity(settings) !== identity || JSON.stringify(snapshot.data.reestrRows || []) !== JSON.stringify(context.rows || [])) throw new Error('Реестр изменён другим пользователем. Сверьте строки и откройте его заново.');
      const payload = { base: { reestrRows: snapshot.revisions.reestrRows }, sections: { reestrRows: rows } };
      if (!client) storage.makeDailyBackup(dir, path.join(dir, 'backups'), 30);
      const result = client ? await server.postSections(settings.remoteHost, settings.remotePort, JSON.stringify(payload)) : storage.writeSections(dir, payload);
      if (!result.ok) throw new Error(result.error || 'Реестр изменён другим пользователем. Откройте его заново.');
      context.rows = rows;
      rememberSections({ reestrRows: rows }, cacheFile);
      const owner = BrowserWindow.getAllWindows().find(win => win.webContents.id === context.ownerId);
      if (owner && databaseIdentity(settings) === identity) owner.webContents.send('reestr-rows-saved', { rows, revision: result.revisions.reestrRows });
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
