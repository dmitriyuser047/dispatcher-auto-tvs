const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const updater = require('./updater');

const DATA_DIR   = path.join(os.homedir(), 'Documents', 'ДиспетчеризацияАвто_ТВС');
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
    title: 'Диспетчеризация авто группы компаний ООО "Технрайз Велл Сервис"',
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

  // Периодическая проверка каждые 30 минут
  setInterval(async () => {
    const info = await updater.checkForUpdate();
    if (info) win.webContents.send('update-available', info);
  }, 30 * 60 * 1000);

  return win;
}

app.whenReady().then(() => {
  ensureDirs();

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

  ipcMain.handle('open-data-folder', () => shell.openPath(DATA_DIR));

  ipcMain.handle('get-app-version', () => app.getVersion());

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
