const { app, BrowserWindow, ipcMain, shell, dialog, session } = require('electron');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const http    = require('http');
const updater = require('./updater');
const server  = require('./server');
const { createExtractorFromData } = require('node-unrar-js');

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
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2), 'utf8');
}

let settings = loadSettings();

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

function createDailyBackup() {
  const dataFile  = getDataFile();
  const backupDir = getBackupDir();
  if (!fs.existsSync(dataFile)) return;
  const today = new Date().toISOString().slice(0, 10);
  const dest  = path.join(backupDir, `data_${today}.json`);
  if (!fs.existsSync(dest)) {
    fs.copyFileSync(dataFile, dest);
    const list = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('data_') && f.endsWith('.json'))
      .sort();
    if (list.length > 30) {
      list.slice(0, list.length - 30)
        .forEach(f => fs.unlinkSync(path.join(backupDir, f)));
    }
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

  // Serve index.html via local HTTP to avoid file:// rendering bugs
  const rootDir = path.join(__dirname, '..');
  const mime = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.ico':'image/x-icon', '.svg':'image/svg+xml' };
  if (!app._localServer) {
    app._localServer = http.createServer((req, res) => {
      const url = req.url === '/' ? '/index.html' : req.url.split('?')[0];
      const filePath = path.join(rootDir, decodeURIComponent(url));
      if (!filePath.startsWith(rootDir)) { res.writeHead(403); res.end(); return; }
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
  ensureDirs();

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
      try {
        return await server.fetchData(settings.remoteHost, settings.remotePort || 3377);
      } catch (e) {
        return null;
      }
    }
    const f = getDataFile();
    if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
    return null;
  });

  ipcMain.handle('write-data', async (_event, jsonStr) => {
    if (isClientMode()) {
      try {
        const res = await server.postData(settings.remoteHost, settings.remotePort || 3377, jsonStr);
        return res && res.ok;
      } catch (e) {
        return false;
      }
    }
    ensureDirs();
    createDailyBackup();
    fs.writeFileSync(getDataFile(), jsonStr, 'utf8');
    return true;
  });

  ipcMain.handle('get-data-path', () => getDataDir());

  ipcMain.handle('get-settings', () => settings);

  ipcMain.handle('save-settings', (_event, newSettings) => {
    settings = newSettings;
    saveSettings(settings);
    if (!isClientMode()) ensureDirs();
    return true;
  });

  ipcMain.handle('switch-user', async (_event, idx) => {
    if (idx < 0 || idx >= settings.users.length) return { ok: false };
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

  ipcMain.handle('server-start', async () => {
    const port = settings.serverPort || 3377;
    const user = getActiveUser();
    return await server.start({
      port,
      dataFile: getDataFile(),
      backupFn: () => { ensureDirs(); createDailyBackup(); },
      serverName: user.name || os.hostname(),
    });
  });

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
    return await server.ping(host, port || 3377);
  });

  // Автозапуск сервера если настроен режим "server"
  if (settings.networkMode === 'server') {
    server.start({
      port: settings.serverPort || 3377,
      dataFile: getDataFile(),
      backupFn: () => { ensureDirs(); createDailyBackup(); },
      serverName: getActiveUser().name || os.hostname(),
    });
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

  ipcMain.handle('install-update', () => {
    if (downloadedPath && fs.existsSync(downloadedPath)) {
      updater.launchInstaller(downloadedPath);
    }
  });

  // ─── РЕЕСТР-БИЛДЕР ──────────────────────────────────────
  const REESTR_DIR = path.join(__dirname, '..', 'ReestrBuilder');
  const REESTR_LIB_URL = 'file:///' + path.join(REESTR_DIR, 'lib.mjs').replace(/\\/g, '/');

  ipcMain.handle('reestr-parse-invoices', async (event, zipArrayBuffer) => {
    console.log('[reestr] parse-invoices start');
    const { parseInvoices, loadConfig } = await import(REESTR_LIB_URL);
    const config = loadConfig(path.join(REESTR_DIR, 'config.json'));
    const log = [];
    const rows = await parseInvoices(Buffer.from(zipArrayBuffer), config, (msg) => { log.push(msg); console.log('[reestr] log:', msg.type, msg.text); });
    console.log('[reestr] parse-invoices done, rows:', rows.length);
    return { log, rows, config };
  });

  ipcMain.handle('reestr-parse-pdfs', async (event, pdfFilesRaw) => {
    console.log('[reestr] parse-pdfs start, files:', pdfFilesRaw.length);
    const { parsePdfFiles, loadConfig } = await import(REESTR_LIB_URL);
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
    const { buildXlsxFromRows, loadConfig } = await import(REESTR_LIB_URL);
    const config = loadConfig(path.join(REESTR_DIR, 'config.json'));
    const { buffer, total } = await buildXlsxFromRows(rows, config);
    return {
      filename: `Реестр_${new Date().toISOString().slice(0, 10)}.xlsx`,
      xlsxBase64: buffer.toString('base64'),
      total,
    };
  });

  ipcMain.handle('reestr-learn', async (event, rows) => {
    const { learnFromRows } = await import(REESTR_LIB_URL);
    return learnFromRows(rows);
  });

  ipcMain.handle('reestr-apply-knowledge', async (event, rows) => {
    const { applyKnowledge } = await import(REESTR_LIB_URL);
    return applyKnowledge(rows);
  });

  ipcMain.handle('reestr-analytics', async (event, rows) => {
    const { getAnalytics } = await import(REESTR_LIB_URL);
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
    pdfEditorData = { pdfBase64: pdfData.toString('base64'), filePath: pdfPath, fileName: path.basename(pdfPath) };
    pdfWin.loadFile(path.join(__dirname, '../pdf-editor.html'));
    return { ok: true };
  });

  let pdfEditorData = null;

  ipcMain.handle('pdf-editor-data', () => pdfEditorData);

  ipcMain.handle('pdf-editor-save', async (event, { pdfBase64, filePath }) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    let savePath = filePath;
    if (!savePath) {
      const { canceled, filePath: fp } = await dialog.showSaveDialog(senderWin, {
        title: 'Сохранить PDF',
        defaultPath: pdfEditorData ? pdfEditorData.filePath : 'edited.pdf',
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (canceled || !fp) return { saved: false };
      savePath = fp;
    }
    fs.writeFileSync(savePath, Buffer.from(pdfBase64, 'base64'));
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
      await ocrWorker.setParameters({ tessedit_pageseg_mode: '3' });
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

  ipcMain.handle('pdf-editor-save-as', async (event, { pdfBase64 }) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePath } = await dialog.showSaveDialog(senderWin, {
      title: 'Сохранить PDF как…',
      defaultPath: pdfEditorData ? pdfEditorData.filePath.replace('.pdf', '_edited.pdf') : 'edited.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return { saved: false };
    fs.writeFileSync(filePath, Buffer.from(pdfBase64, 'base64'));
    shell.showItemInFolder(filePath);
    return { saved: true, path: filePath };
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
