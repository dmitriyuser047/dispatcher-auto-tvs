const { app, BrowserWindow, ipcMain, shell, dialog, session } = require('electron');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const http    = require('http');
const updater = require('./updater');
const server  = require('./server');
const { createExtractorFromData } = require('node-unrar-js');
const storage = require('./storage');

const DEFAULT_DATA_DIR = path.join(os.homedir(), 'Documents', 'ДиспетчеризацияАвто_ТВС');
const SETTINGS_FILE   = path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {}
  return {
    users: [{ name: 'Пользователь', dataDir: DEFAULT_DATA_DIR }],
    activeUser: 0,
    networkMode: 'local',
    serverPort: 3377,
    remoteHost: '',
    remotePort: 3377,
  };
}

function saveSettings(s) {
  const dir = path.dirname(SETTINGS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const temp=SETTINGS_FILE+'.tmp';const fd=fs.openSync(temp,'w');try{fs.writeFileSync(fd,JSON.stringify(s,null,2),'utf8');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,SETTINGS_FILE);
}

let settings = loadSettings();
if (!settings.networkKey) {
  settings.networkKey = require('crypto').randomBytes(24).toString('hex');
  saveSettings(settings);
}
server.configureKey(settings.networkKey);
let networkConfigError='';
function configureNetwork(s){
  const ca=s.networkMode==='client'&&s.remoteCaFile?fs.readFileSync(s.remoteCaFile):null;
  server.configureTransport({protocol:s.remoteProtocol||'http:',ca});
  server.configureKey(s.networkKey);networkConfigError='';
}
try{configureNetwork(settings);}catch(e){networkConfigError=e.message;server.configureTransport({protocol:'https:'});console.error('[network] '+e.message);}

function getActiveUser() {
  const idx = settings.activeUser || 0;
  return settings.users[idx] || settings.users[0] || { name: 'Пользователь', dataDir: DEFAULT_DATA_DIR };
}

function getDataDir()   { return getActiveUser().dataDir || DEFAULT_DATA_DIR; }
function getDataFile()  { return path.join(getDataDir(), 'data.json'); }
function getBackupDir() { return path.join(getDataDir(), 'backups'); }

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
      const url = req.url === '/' ? '/index.html' : req.url.split('?')[0];
      let filePath;
      try { filePath = path.resolve(rootDir, '.' + decodeURIComponent(url)); }
      catch { res.writeHead(400); res.end(); return; }
      const relative = path.relative(rootDir, filePath);
      if (relative.startsWith('..') || path.isAbsolute(relative)) { res.writeHead(403); res.end(); return; }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
        res.end(data);
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
      if (info) win.webContents.send('update-available', info);
    }, 5000);
  });

  // Периодическая проверка каждые 3 минуты
  setInterval(async () => {
    const info = await updater.checkForUpdate();
    if (info) win.webContents.send('update-available', info);
  }, 3 * 60 * 1000);

  // Проверка при показе/разворачивании окна
  win.on('show', async () => {
    const info = await updater.checkForUpdate();
    if (info) win.webContents.send('update-available', info);
  });

  return win;
}

app.whenReady().then(() => {
  require('./artifacts').register({ipcMain,getDataDir,isClientMode,getSettings:()=>settings,knowledgeDir:()=>path.join(getDataDir(),'reestr-knowledge')});
  ensureDirs();
  applyBundledDataSeedOnce();

  // Экспорт сводок/актов (XLSX) идёт через обычную загрузку браузера —
  // открываем файл сразу после сохранения, чтобы не искать его в "Загрузках".
  session.defaultSession.on('will-download', (_event, item) => {
    item.once('done', (_e, state) => {
      if (state === 'completed') shell.openPath(item.getSavePath());
    });
  });

  function isClientMode() { return settings.networkMode === 'client' && settings.remoteHost; }

  ipcMain.handle('read-data', async () => {
    if (isClientMode()) {
      if(networkConfigError)return null;
      try {
        return await server.fetchData(settings.remoteHost, settings.remotePort || 3377);
      } catch (e) {
        return null;
      }
    }
    try {
      return JSON.stringify(storage.readAll(getDataDir()));
    } catch (e) {
      console.error('[read-data] ' + e.message);
      return null;
    }
  });

  ipcMain.handle('write-data', async (_event, jsonStr) => {
    if (isClientMode()) {
      if(networkConfigError)return false;
      try {
        const res = await server.postData(settings.remoteHost, settings.remotePort || 3377, jsonStr);
        return res && res.ok;
      } catch (e) {
        return false;
      }
    }
    ensureDirs();
    createDailyBackup();
    try {
      const res = storage.writeAll(getDataDir(), JSON.parse(jsonStr));
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
    if (isClientMode()) {
      if(networkConfigError)return null;
      const host = settings.remoteHost, port = settings.remotePort || 3377;
      try { return JSON.stringify(await server.getJson(host, port, '/api/snapshot', 15000)); }
      catch (e) {
        try { return JSON.stringify({ data: JSON.parse(await server.fetchData(host, port)), revisions: null }); }
        catch { return null; }
      }
    }
    try {
      return JSON.stringify({ data: storage.readAll(getDataDir()), revisions: storage.readRevisions(getDataDir()) });
    } catch (e) {
      console.error('[read-snapshot] ' + e.message);
      return null;
    }
  });

  ipcMain.handle('get-revisions', async () => {
    if(isClientMode()&&networkConfigError)return null;
    try {
      if (isClientMode()) return await server.getJson(settings.remoteHost, settings.remotePort || 3377, '/api/revisions', 5000);
      return storage.readRevisions(getDataDir());
    } catch (e) { return null; }
  });

  ipcMain.handle('read-section', async (_event, name) => {
    if(isClientMode()&&networkConfigError)return null;
    try {
      if (isClientMode()) return await server.getJson(settings.remoteHost, settings.remotePort || 3377, '/api/section/' + encodeURIComponent(name), 15000);
      return storage.readSection(getDataDir(), name);
    } catch (e) { return null; }
  });

  ipcMain.handle('write-sections', async (_event, jsonStr) => {
    if (isClientMode()) {
      if(networkConfigError)return {ok:false,error:networkConfigError};
      try { return await server.postSections(settings.remoteHost, settings.remotePort || 3377, jsonStr); }
      catch (e) { return { ok: false, error: e.message }; }
    }
    ensureDirs();
    createDailyBackup();
    try {
      const res = storage.writeSections(getDataDir(), JSON.parse(jsonStr));
      if (res.ok && res.changed.length) console.log('[write-sections] ' + res.changed.join(', '));
      return res;
    } catch (e) {
      console.error('[write-sections] ' + e.message);
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('get-data-path', () => getDataDir());
  ipcMain.handle('choose-certificate',async(event)=>{const r=await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender),{title:'Сертификат или ключ PEM',properties:['openFile'],filters:[{name:'PEM / CRT / KEY',extensions:['pem','crt','key']}]});return r.canceled?null:r.filePaths[0];});

  ipcMain.handle('get-data-health', async () => {
    const mode = settings.networkMode || 'local';
    if (mode === 'client') {
      if(networkConfigError)return {mode,available:false,error:networkConfigError};
      try {
        const ping = await server.ping(settings.remoteHost, settings.remotePort || 3377);
        return { mode, available: !!(ping && ping.ok), serverName: ping && ping.name || '', checkedAt: new Date().toISOString() };
      } catch (e) {
        return { mode, available: false, error: e.message, checkedAt: new Date().toISOString() };
      }
    }
    try {
      const dir = getDataDir();
      const sections = path.join(dir, 'sections');
      const hasSplit = fs.existsSync(path.join(sections, 'revisions.json'));
      const hasLegacy = fs.existsSync(path.join(dir, 'data.json'));
      let backups = [];
      try {
        backups = fs.readdirSync(getBackupDir()).filter(name => /^data_\d{4}-\d{2}-\d{2}\.json$/.test(name))
          .map(name => ({ name, time: fs.statSync(path.join(getBackupDir(), name)).mtimeMs }))
          .sort((a, b) => b.time - a.time);
      } catch {}
      return {
        mode, available: hasSplit || hasLegacy,
        storage: hasSplit ? 'Разделённая база' : hasLegacy ? 'Файл базы' : 'База не найдена',
        backupCount: backups.length,
        lastBackupAt: backups.length ? new Date(backups[0].time).toISOString() : null,
        checkedAt: new Date().toISOString(),
      };
    } catch (e) {
      return { mode, available: false, error: e.message, checkedAt: new Date().toISOString() };
    }
  });

  ipcMain.handle('get-settings', () => settings);

  ipcMain.handle('save-settings', (_event, newSettings) => {
    if(!newSettings||!Array.isArray(newSettings.users)||!newSettings.users.length)throw new Error('Нужен хотя бы один профиль данных');
    if(newSettings.serverUsers)newSettings.serverUsers=require('./access-control').normalizeServerUsers(newSettings.serverUsers);
    configureNetwork(newSettings);
    const connectionChanged=JSON.stringify([settings.activeUser,settings.users,settings.serverPort,settings.serverProtocol,settings.serverTlsCert,settings.serverTlsKey,settings.networkMode])!==JSON.stringify([newSettings.activeUser,newSettings.users,newSettings.serverPort,newSettings.serverProtocol,newSettings.serverTlsCert,newSettings.serverTlsKey,newSettings.networkMode]);
    if(connectionChanged&&server.isRunning())server.stop();
    settings = newSettings;
    saveSettings(settings);
    if (!isClientMode()) ensureDirs();
    return true;
  });

  ipcMain.handle('switch-user', async (_event, idx) => {
    if (idx < 0 || idx >= settings.users.length) return { ok: false };
    if(server.isRunning())server.stop();
    settings.activeUser = idx;
    saveSettings(settings);
    if (!isClientMode()) ensureDirs();
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

  async function startConfiguredServer(){try{
    const port = settings.serverPort || 3377;
    const user = getActiveUser();
    const startupDir=getDataDir();
    return await server.start({
      port,
      dataDir: startupDir,
      backupFn: () => { storage.makeDailyBackup(startupDir,path.join(startupDir,'backups'),30); },
      serverName: user.name || os.hostname(),
      key: settings.networkKey,
      settings:()=>settings,
      tls:settings.serverProtocol==='https:'?{cert:fs.readFileSync(settings.serverTlsCert),key:fs.readFileSync(settings.serverTlsKey)}:null,
    });
  }catch(e){return {ok:false,error:'Сервер не запущен: '+e.message};}}
  ipcMain.handle('server-start',startConfiguredServer);

  ipcMain.handle('server-stop', () => {
    server.stop();
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
    if(networkConfigError)return {ok:false,error:networkConfigError};
    return await server.ping(host, port || 3377);
  });

  // Автозапуск сервера если настроен режим "server"
  if (settings.networkMode === 'server') {
    startConfiguredServer().then(r=>{if(!r.ok)console.error(r.error);});
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
      webPreferences: { contextIsolation: true, nodeIntegration: false },
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
        event.sender.send('download-progress', pct);
      });
      downloadedPath = filePath;
      return { ok: true, path: filePath };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('install-update', async () => {
    try {
      if(!downloadedPath || !fs.existsSync(downloadedPath))throw new Error('Установщик не загружен');
      await updater.launchInstaller(downloadedPath);
      return {ok:true};
    } catch(e) {return {ok:false,error:e.message};}
  });

  // ─── РЕЕСТР-БИЛДЕР ──────────────────────────────────────
  const REESTR_DIR = path.join(__dirname, '..', 'ReestrBuilder');
  const REESTR_LIB_URL = 'file:///' + path.join(REESTR_DIR, 'lib.mjs').replace(/\\/g, '/');
  async function loadReestrLib(){const lib=await import(REESTR_LIB_URL);lib.configureKnowledgePath(path.join(getDataDir(),'reestr-knowledge'));return lib;}

  ipcMain.handle('reestr-parse-invoices', async (event, zipArrayBuffer) => {
    console.log('[reestr] parse-invoices start');
    const { parseInvoices, loadConfig } = await loadReestrLib();
    const config = loadConfig(path.join(REESTR_DIR, 'config.json'));
    const log = [];
    const rows = await parseInvoices(Buffer.from(zipArrayBuffer), config, (msg) => { log.push(msg); console.log('[reestr] log:', msg.type, msg.text); });
    console.log('[reestr] parse-invoices done, rows:', rows.length);
    return { log, rows, config };
  });

  ipcMain.handle('reestr-parse-pdfs', async (event, pdfFilesRaw) => {
    console.log('[reestr] parse-pdfs start, files:', pdfFilesRaw.length);
    const { parsePdfFiles, loadConfig } = await loadReestrLib();
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
    const { buildXlsxFromRows, loadConfig } = await loadReestrLib();
    const config = loadConfig(path.join(REESTR_DIR, 'config.json'));
    const { buffer, total } = await buildXlsxFromRows(rows, config);
    return {
      filename: `Реестр_${new Date().toISOString().slice(0, 10)}.xlsx`,
      xlsxBase64: buffer.toString('base64'),
      total,
    };
  });

  ipcMain.handle('reestr-learn', async (event, rows) => {
    const { learnFromRows } = await loadReestrLib();
    return learnFromRows(rows);
  });

  ipcMain.handle('reestr-apply-knowledge', async (event, rows) => {
    const { applyKnowledge } = await loadReestrLib();
    return applyKnowledge(rows);
  });

  ipcMain.handle('reestr-analytics', async (event, rows) => {
    const { getAnalytics } = await loadReestrLib();
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
  let reestrWindowData = null;

  ipcMain.handle('open-reestr-window', (event, data) => {
    reestrWindowData = data;
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
    reestrWin.loadFile(path.join(__dirname, '../reestr-window.html'));
    return true;
  });

  // PDF-редактор: независимые документы окон, шрифты, сохранение и OCR.
  require('./pdf-editor-service.cjs').registerPdfEditorService({ app, BrowserWindow, ipcMain, dialog });

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
      const pdfjsPkg = require('pdfjs-dist/build/pdf.js');
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
      const { getDocument } = require('pdfjs-dist/build/pdf.js');
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

  ipcMain.handle('reestr-window-data', () => {
    console.log('[reestr-window] data request, rows:', reestrWindowData?.rows?.length, 'statyi:', reestrWindowData?.statyi?.length);
    return reestrWindowData;
  });

  ipcMain.handle('reestr-save-rows', (event, rows) => {
    const allWindows = BrowserWindow.getAllWindows();
    for (const w of allWindows) {
      if (w.webContents !== event.sender) {
        w.webContents.send('reestr-rows-saved', rows);
      }
    }
    return { ok: true };
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
