const { app, BrowserWindow, ipcMain, shell, dialog, session } = require('electron');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const updater = require('./updater');

const DATA_DIR   = path.join(os.homedir(), 'Documents', 'ДЭС_ТВС');
const DATA_FILE  = path.join(DATA_DIR, 'data.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR))   fs.mkdirSync(DATA_DIR,   { recursive: true });
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function createDailyBackup() {
  if (!fs.existsSync(DATA_FILE)) return;
  const today = new Date().toISOString().slice(0, 10);
  const dest  = path.join(BACKUP_DIR, `data_${today}.json`);
  if (!fs.existsSync(dest)) {
    fs.copyFileSync(DATA_FILE, dest);
    // Оставляем последние 30 ежедневных бэкапов
    const list = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('data_') && f.endsWith('.json'))
      .sort();
    if (list.length > 30) {
      list.slice(0, list.length - 30)
        .forEach(f => fs.unlinkSync(path.join(BACKUP_DIR, f)));
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
    title: 'ДЭС — ООО "Технрайз Велл Сервис"',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '../index.html'));

  // Проверка обновлений через 4 сек после запуска
  win.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      const info = await updater.checkForUpdate();
      if (info) win.webContents.send('update-available', info);
    }, 4000);
  });

  // Периодическая проверка каждые 5 минут
  setInterval(async () => {
    const info = await updater.checkForUpdate();
    if (info) win.webContents.send('update-available', info);
  }, 5 * 60 * 1000);

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

  ipcMain.handle('read-data', () => {
    if (fs.existsSync(DATA_FILE)) {
      return fs.readFileSync(DATA_FILE, 'utf8');
    }
    return null;
  });

  ipcMain.handle('write-data', (_event, jsonStr) => {
    ensureDirs();
    createDailyBackup();
    fs.writeFileSync(DATA_FILE, jsonStr, 'utf8');
    return true;
  });

  ipcMain.handle('get-data-path', () => DATA_DIR);

  // Экспорт произвольного JSON-подмножества данных в файл (для передачи в основную программу)
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

  // Импорт JSON-файла — выбор файла и чтение содержимого
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

  ipcMain.handle('open-data-folder', () => shell.openPath(DATA_DIR));

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

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
