const { app, BrowserWindow, ipcMain, shell, dialog, session, Notification } = require('electron');
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
const { createNotificationService, bindingKey } = require('./notifications');
const hiddenTest = app.commandLine.hasSwitch('tvs-test-hidden');
app.setAppUserModelId('com.tvs.dispetcherizaciya-avto');
const requestedProfile = app.commandLine.getSwitchValue('user-data-dir');
if (requestedProfile) app.setPath('userData', path.resolve(requestedProfile));
else app.setPath('userData', path.join(app.getPath('appData'), 'dispetcherizaciya-avto'));

// Storage transactions belong to one application process at a time.
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !hiddenTest) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
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
      const checked = validateSettings({ ...defaults, ...saved, networkKey:saved.networkKey || require('crypto').randomBytes(24).toString('hex') });
      if (!saved.networkKey) saveSettings(checked);
      return checked;
    }
  } catch (e) {
    dialog.showErrorBox('Не прочитаны настройки', 'Файл настроек повреждён. Восстановите его копию:\n' + SETTINGS_FILE + '\n' + e.message);
    app.exit(1);
    throw e;
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
let networkConfigError='';
function configureNetwork(s){
  const ca=s.networkMode==='client'&&s.remoteCaFile?fs.readFileSync(s.remoteCaFile):null;
  server.configureTransport({protocol:s.remoteProtocol||'http:',ca});
  server.configureKey(s.networkKey);networkConfigError='';
}
try{configureNetwork(settings);}catch(e){networkConfigError=e.message;server.configureTransport({protocol:'https:'});console.error('[network] '+e.message);}

const dataBindings = new Map();
let notificationService = null;
const settingsIdentity = () => databaseIdentity(settings);
function bindData(event, token, access = null, revisions = null) {
  const previous=dataBindings.get(event.sender.id);
  if(previous&&(previous.identity!==settingsIdentity()||previous.databaseToken!==(token||null)||JSON.stringify(previous.notificationAccess)!==JSON.stringify(access)))notificationService?.invalidate();
  dataBindings.set(event.sender.id, { identity:settingsIdentity(), databaseToken:token || null, notificationAccess:access,
    revisions:revisions && { ...revisions } });
}
function assertDataBinding(event, token) {
  const binding = dataBindings.get(event.sender.id);
  if (!binding || binding.identity !== settingsIdentity() || token && token !== binding.databaseToken) throw new Error('База переключена. Загрузите выбранную базу заново перед сохранением.');
  if (settings.networkMode !== 'client' && binding.databaseToken !== storage.databaseToken(getDataDir())) throw new Error('База изменилась. Загрузите её заново.');
  return binding;
}

let settingsChain = Promise.resolve(), restartConfiguredServer = null;
function queueSettings(next) {
  const operation = settingsChain.then(async () => {
    const checked = validateSettings(typeof next === 'function' ? next(settings) : next);
    // Validate the CA before mutating the active transport or settings.
    if (checked.networkMode === 'client' && checked.remoteCaFile) fs.readFileSync(checked.remoteCaFile);
    const changed = settingsIdentity() !== databaseIdentity(checked) || settings.networkMode !== checked.networkMode ||
      JSON.stringify([settings.serverPort,settings.serverProtocol,settings.serverTlsCert,settings.serverTlsKey]) !== JSON.stringify([checked.serverPort,checked.serverProtocol,checked.serverTlsCert,checked.serverTlsKey]);
    const restart = changed && checked.networkMode === 'server' && server.isRunning();
    if (changed && server.isRunning()) await server.stop();
    saveSettings(checked);
    settings = checked;
    notificationService?.invalidate();
    configureNetwork(settings);
    if (settings.networkMode !== 'client') ensureDirs();
    if (restart && restartConfiguredServer) {
      const result = await restartConfiguredServer();
      if (!result.ok) throw new Error('Настройки сохранены, но сервер не запущен: ' + result.error);
    }
    return true;
  });
  settingsChain = operation.catch(() => {});
  return operation;
}

// Validate the exact trusted top frame and the capabilities of each window.
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => handle(channel, (event, ...args) => {
  const page = trustedPage(event.senderFrame?.url, path.join(__dirname, '..'), app._localServerPort);
  if (event.senderFrame !== event.sender.mainFrame || !canInvoke(page, channel)) throw new Error('Недоверенный источник запроса');
  return listener(event, ...args);
});
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action:'deny' }));
  contents.on('will-navigate', (event, url) => { if (url !== contents.getURL()) event.preventDefault(); });
  contents.on('will-attach-webview', event => event.preventDefault());
  contents.once('destroyed', () => dataBindings.delete(contents.id));
});

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

function createWindow() {
  const iconPath = path.join(__dirname, '../build/icon.ico');
  const win = new BrowserWindow({
    show:!hiddenTest,
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
      if (!filePath || !['GET','HEAD'].includes(req.method)) { res.writeHead(403); res.end(); return; }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream', 'X-Content-Type-Options':'nosniff',
          'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'none'; frame-ancestors 'none'" });
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
    if (hiddenTest) return;
    setTimeout(async () => {
      const info = await updater.checkForUpdate();
      if (info && !win.isDestroyed()) win.webContents.send('update-available', info);
    }, 5000);
  });

  // Периодическая проверка каждые 3 минуты
  const updateTimer = setInterval(async () => {
    if (hiddenTest) return;
    const info = await updater.checkForUpdate();
    if (info && !win.isDestroyed()) win.webContents.send('update-available', info);
  }, 3 * 60 * 1000);
  win.once('closed', () => clearInterval(updateTimer));

  // Проверка при показе/разворачивании окна
  win.on('show', async () => {
    if (hiddenTest) return;
    const info = await updater.checkForUpdate();
    if (info && !win.isDestroyed()) win.webContents.send('update-available', info);
  });

  return win;
}

app.whenReady().then(() => {
  require('./artifacts').register({ipcMain,getDataDir,isClientMode,getSettings:()=>settings,knowledgeDir:()=>path.join(getDataDir(),'reestr-knowledge')});
  if (settings.networkMode !== 'client') ensureDirs();

  // Экспорт сводок/актов (XLSX) идёт через обычную загрузку браузера —
  // открываем файл сразу после сохранения, чтобы не искать его в "Загрузках".
  session.defaultSession.on('will-download', (_event, item) => {
    item.once('done', (_e, state) => {
      if (state === 'completed' && ['.xlsx','.csv','.pdf','.docx','.txt'].includes(path.extname(item.getSavePath()).toLowerCase())) shell.openPath(item.getSavePath());
    });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  function isClientMode() { return settings.networkMode === 'client' && settings.remoteHost; }

  async function notificationContext(event) {
    if(event.sender.isDestroyed())throw Error('Окно закрыто');
    const binding=assertDataBinding(event), identity=settingsIdentity();
    let access=binding.notificationAccess;
    if(isClientMode()) {
      if(networkConfigError)throw Error('Сервер недоступен. Напоминания приостановлены.');
      const ping=await server.getJson(settings.remoteHost,settings.remotePort||3377,'/api/ping',5000);
      if(identity!==settingsIdentity()||!ping?.ok||!binding.databaseToken||ping.databaseToken!==binding.databaseToken||!access||JSON.stringify(ping.access)!==JSON.stringify(access)) {
        notificationService?.invalidate();
        throw Error('База или права доступа изменились. Обновите данные перед включением напоминаний.');
      }
      assertDataBinding(event);
    }
    const readable=isClientMode()?access.readable:storage.SECTIONS;
    const user=isClientMode()?access.user:{id:'local',role:'admin',name:getActiveUser().name};
    const key=bindingKey([identity,binding.databaseToken,settings.activeUser,getActiveUser().name,user.id,user.role,readable]);
    return {key,readable,databaseToken:binding.databaseToken,user,senderId:event.sender.id,event};
  }
  const NOTIFICATIONS_FILE=path.join(app.getPath('userData'),'notifications.json');
  notificationService=createNotificationService({Notification,hidden:hiddenTest,
    readState:()=>fs.existsSync(NOTIFICATIONS_FILE)?JSON.parse(fs.readFileSync(NOTIFICATIONS_FILE,'utf8')):{},
    writeState:value=>writeAtomic(NOTIFICATIONS_FILE,JSON.stringify(value)),
    isCurrent:async context=>{try{return(await notificationContext(context.event)).key===context.key;}catch{return false;}},
    onOpen:({key,issueId,senderId})=>{
      for(const win of BrowserWindow.getAllWindows()) {
        if(win.isDestroyed()||win.webContents.id!==senderId||trustedPage(win.webContents.getURL(),path.join(__dirname,'..'),app._localServerPort)!=='main')continue;
        if(win.isMinimized())win.restore();win.show();win.focus();
        win.webContents.send('notification-open',{key,issueId});break;
      }
    }
  });
  app.once('before-quit',()=>notificationService.dispose());
  ipcMain.handle('get-notification-settings',async event=>{try{
    const context=await notificationContext(event);
    return {...notificationService.status(context),databaseToken:context.databaseToken,user:context.user};
  }catch(error){notificationService.invalidate();return{ok:false,error:error.message};}});
  function notificationEnvelope(payload,fields) {
    if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(k=>!fields.includes(k))||typeof payload.key!=='string'||!/^[a-f0-9]{64}$/.test(payload.key))throw Error('Некорректный запрос напоминаний');
  }
  for(const [channel,fields,action] of [
    ['save-notification-settings',['key','preferences'],(context,payload)=>notificationService.update(context,payload.preferences)],
    ['snooze-notifications',['key','minutes'],(context,payload)=>notificationService.snooze(context,payload.minutes)],
    ['submit-notifications',['key','issues'],(context,payload)=>notificationService.submit(context,payload)],
    ['test-notification',['key'],(context,payload)=>notificationService.test(context,payload.key)]
  ])ipcMain.handle(channel,async(event,payload)=>{try{
    notificationEnvelope(payload,fields);
    const context=await notificationContext(event);
    if(payload.key!==context.key)throw Error('База или учётная запись переключена. Откройте настройки заново.');
    return action(context,payload);
  }catch(error){notificationService.invalidate();return{ok:false,error:error.message};}});

  ipcMain.handle('read-data', async (event) => {
    const identity = settingsIdentity();
    if (isClientMode()) {
      if(networkConfigError)return null;
      try {
        let snapshot;
        try { snapshot = await server.getJson(settings.remoteHost, settings.remotePort || 3377, '/api/snapshot', 15000); }
        catch { snapshot = { data:JSON.parse(await server.fetchData(settings.remoteHost, settings.remotePort || 3377)) }; }
        if (identity !== settingsIdentity()) throw new Error('База переключена во время чтения');
        bindData(event, snapshot.databaseToken, snapshot.access, snapshot.revisions);
        return JSON.stringify(snapshot.data);
      } catch (e) {
        return null;
      }
    }
    try {
      const snapshot = storage.readSnapshot(getDataDir());
      bindData(event, snapshot.databaseToken, null, snapshot.revisions);
      return JSON.stringify(snapshot.data);
    } catch (e) {
      console.error('[read-data] ' + e.message);
      return null;
    }
  });

  ipcMain.handle('write-data', async (_event, jsonStr) => {
    let payload, binding;
    try {
      payload = JSON.parse(jsonStr);
      binding = assertDataBinding(_event, payload.databaseToken);
    } catch (e) { console.error('[write-data] ' + e.message); return false; }
    const data = payload.data && !Array.isArray(payload.data) && Array.isArray(payload.data.vehicles) ? payload.data : payload;
    const identity = settingsIdentity();
    if (isClientMode()) {
      if(networkConfigError)return false;
      try {
        const body = binding.databaseToken ? { databaseToken:binding.databaseToken, data, base:payload.base ?? binding.revisions,
          ...(payload.operation ? {operation:payload.operation} : {}) } : data;
        const res = await server.postData(settings.remoteHost, settings.remotePort || 3377, JSON.stringify(body));
        if (identity !== settingsIdentity() || !res?.ok) return false;
        binding.revisions = res.revisions && { ...res.revisions };
        return true;
      } catch (e) {
        return false;
      }
    }
    ensureDirs();
    createDailyBackup();
    try {
      const res = storage.writeAll(getDataDir(), data, { databaseToken:binding.databaseToken, operation:payload.operation,
        base:payload.base ?? binding.revisions, requireBase:true,
        principal:{ id:'local-profile', name:getActiveUser().name || 'Локальный пользователь', role:'admin' } });
      if (!res.ok) return false;
      binding.revisions = { ...res.revisions };
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
  ipcMain.handle('read-snapshot', async (event) => {
    const identity = settingsIdentity();
    if (isClientMode()) {
      if(networkConfigError)return null;
      const host = settings.remoteHost, port = settings.remotePort || 3377;
      try {
        const snapshot = await server.getJson(host, port, '/api/snapshot', 15000);
        if (identity !== settingsIdentity()) return null;
        bindData(event, snapshot.databaseToken, snapshot.access, snapshot.revisions);
        return JSON.stringify(snapshot);
      }
      catch (e) {
        try {
          const data = JSON.parse(await server.fetchData(host, port));
          if (identity !== settingsIdentity()) return null;
          bindData(event, null);
          return JSON.stringify({ data, revisions:null });
        }
        catch { return null; }
      }
    }
    try {
      const dir = getDataDir();
      const snapshot = storage.readSnapshot(dir);
      bindData(event, snapshot.databaseToken, null, snapshot.revisions);
      return JSON.stringify(snapshot);
    } catch (e) {
      console.error('[read-snapshot] ' + e.message);
      return null;
    }
  });

  ipcMain.handle('get-revisions', async () => {
    const identity = settingsIdentity();
    if(isClientMode()&&networkConfigError)return null;
    try {
      if (isClientMode()) {
        const result = await server.getJson(settings.remoteHost, settings.remotePort || 3377, '/api/revisions', 5000);
        return identity === settingsIdentity() ? result : null;
      }
        return { ...storage.readRevisions(getDataDir()), databaseToken:storage.databaseToken(getDataDir()) };
    } catch (e) { return null; }
  });

  ipcMain.handle('read-section', async (_event, name) => {
    const identity = settingsIdentity();
    if(isClientMode()&&networkConfigError)return null;
    try {
      if (isClientMode()) {
        const result = await server.getJson(settings.remoteHost, settings.remotePort || 3377, '/api/section/' + encodeURIComponent(name), 15000);
        return identity === settingsIdentity() ? result : null;
      }
      return storage.readSection(getDataDir(), name);
    } catch (e) { return null; }
  });

  ipcMain.handle('write-sections', async (_event, jsonStr) => {
    let payload;
    try {
      payload = JSON.parse(jsonStr);
      const binding = assertDataBinding(_event, payload.databaseToken);
      if (binding.databaseToken) payload.databaseToken = binding.databaseToken;
    } catch (e) { return { ok:false, error:e.message }; }
    const identity = settingsIdentity();
    if (isClientMode()) {
      if(networkConfigError)return {ok:false,error:networkConfigError};
      try {
        const result = await server.postSections(settings.remoteHost, settings.remotePort || 3377, JSON.stringify(payload));
        if (identity !== settingsIdentity()) return { ok:false, error:'База переключена во время сохранения. Загрузите выбранную базу заново.' };
        return result;
      }
      catch (e) { return { ok: false, error: e.message }; }
    }
    ensureDirs();
    createDailyBackup();
    try {
      const res = storage.writeSections(getDataDir(), payload, {
        principal:{ id:'local-profile', name:getActiveUser().name || 'Локальный пользователь', role:'admin' } });
      if (res.ok && res.changed.length) console.log('[write-sections] ' + res.changed.join(', '));
      return res;
    } catch (e) {
      console.error('[write-sections] ' + e.message);
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('get-data-path', () => getDataDir());
  ipcMain.handle('get-data-identity', async () => {
    const identity = settingsIdentity();
    if (!isClientMode()) return identity + ':' + storage.databaseToken(getDataDir());
    if (networkConfigError) throw new Error(networkConfigError);
    const ping = await server.getJson(settings.remoteHost, settings.remotePort || 3377, '/api/ping', 5000);
    if (identity !== settingsIdentity() || !ping?.ok) throw new Error('База переключена или недоступна. Повторите действие.');
    return identity + ':' + (ping.databaseToken || 'legacy');
  });
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
      const hasSqlite = fs.existsSync(path.join(dir,'platform.sqlite'));
      if (hasSqlite) storage.readRevisions(dir);
      const hasSplit = fs.existsSync(path.join(sections, 'revisions.json'));
      const hasLegacy = fs.existsSync(path.join(dir, 'data.json'));
      let backups = [];
      try {
        backups = fs.readdirSync(getBackupDir()).filter(name => /^data_\d{4}-\d{2}-\d{2}\.json$/.test(name))
          .map(name => ({ name, time: fs.statSync(path.join(getBackupDir(), name)).mtimeMs }))
          .sort((a, b) => b.time - a.time);
      } catch {}
      return {
        mode, available: hasSqlite || hasSplit || hasLegacy,
        storage: hasSqlite ? 'SQLite (транзакционная база)' : hasSplit ? 'Разделённая база' : hasLegacy ? 'Файл базы' : 'База не найдена',
        backupCount: backups.length,
        lastBackupAt: backups.length ? new Date(backups[0].time).toISOString() : null,
        checkedAt: new Date().toISOString(),
      };
    } catch (e) {
      return { mode, available: false, error: e.message, checkedAt: new Date().toISOString() };
    }
  });

  ipcMain.handle('get-settings', () => settings);
  ipcMain.handle('get-theme', () => settings.uiTheme || null);
  ipcMain.handle('set-theme', async (_event, theme) => {
    if (!['light','dark'].includes(theme)) throw new Error('Неизвестная тема');
    await queueSettings(current => ({ ...current, uiTheme:theme }));
    for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('workspace-theme-changed', theme);
    return true;
  });

  ipcMain.handle('save-settings', async (_event, newSettings) => {
    await queueSettings(newSettings);
    return true;
  });

  ipcMain.handle('switch-user', async (_event, idx) => {
    if (!Number.isInteger(idx) || idx < 0 || idx >= settings.users.length) return { ok: false };
    await queueSettings(current => ({ ...current, activeUser:idx }));
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
  restartConfiguredServer = startConfiguredServer;
  ipcMain.handle('server-start',startConfiguredServer);

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
  const REESTR_LIB_URL = pathToFileURL(path.join(REESTR_DIR, 'lib.mjs'));
  async function loadReestrLib(event) {
    const identity = settingsIdentity(), directory = path.join(getDataDir(), 'reestr-knowledge');
    const registry = event && reestrWindowData.get(event.sender.id);
    if (registry && registry.identity !== identity) throw new Error('База переключена. Откройте реестр заново.');
    if (event && !registry) assertDataBinding(event);
    const url = new URL(REESTR_LIB_URL); url.searchParams.set('profile', identity);
    // Each database owns its module instance and knowledge path during long OCR jobs.
    const lib = await import(url.href);
    if (identity !== settingsIdentity()) throw new Error('База переключена во время обработки реестра. Повторите действие.');
    lib.configureKnowledgePath(directory);
    return lib;
  }

  ipcMain.handle('reestr-parse-invoices', async (event, zipArrayBuffer) => {
    console.log('[reestr] parse-invoices start');
    const { parseInvoices, loadConfig } = await loadReestrLib(event);
    const config = loadConfig(path.join(REESTR_DIR, 'config.json'));
    const log = [];
    const rows = await parseInvoices(Buffer.from(zipArrayBuffer), config, (msg) => { log.push(msg); console.log('[reestr] log:', msg.type, msg.text); });
    console.log('[reestr] parse-invoices done, rows:', rows.length);
    return { log, rows, config };
  });

  ipcMain.handle('reestr-parse-pdfs', async (event, pdfFilesRaw) => {
    console.log('[reestr] parse-pdfs start, files:', pdfFilesRaw.length);
    const { parsePdfFiles, loadConfig } = await loadReestrLib(event);
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
    const { buildXlsxFromRows, loadConfig } = await loadReestrLib(event);
    const config = loadConfig(path.join(REESTR_DIR, 'config.json'));
    const { buffer, total } = await buildXlsxFromRows(rows, config);
    return {
      filename: `Реестр_${new Date().toISOString().slice(0, 10)}.xlsx`,
      xlsxBase64: buffer.toString('base64'),
      total,
    };
  });

  ipcMain.handle('reestr-learn', async (event, rows) => {
    const { learnFromRows } = await loadReestrLib(event);
    return learnFromRows(rows);
  });

  ipcMain.handle('reestr-apply-knowledge', async (event, rows) => {
    const { applyKnowledge } = await loadReestrLib(event);
    return applyKnowledge(rows);
  });

  ipcMain.handle('reestr-analytics', async (event, rows) => {
    const { getAnalytics } = await loadReestrLib(event);
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
  const registryRows = rows => {
    if (!Array.isArray(rows) || rows.length > 100000 || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row)) || Buffer.byteLength(JSON.stringify(rows)) > 32 * 1024 * 1024) throw new Error('Некорректные строки реестра');
    return rows;
  };
  const localRegistrySnapshot = dir => storage.readSnapshot(dir);

  ipcMain.handle('open-reestr-window', async (event, data) => {
    registryRows(data?.rows);
    const identity = settingsIdentity(), client = isClientMode(), dir = getDataDir();
    const snapshot = client ? await server.getJson(settings.remoteHost, settings.remotePort || 3377, '/api/snapshot', 15000)
      : storage.withDatabaseLock(dir, () => localRegistrySnapshot(dir));
    if (identity !== settingsIdentity()) throw new Error('База переключена. Откройте реестр заново.');
    assertDataBinding(event, snapshot.databaseToken);
    const parentWin = BrowserWindow.fromWebContents(event.sender);
    const iconPath = path.join(__dirname, '../build/icon.ico');
    const reestrWin = new BrowserWindow({
      show:!hiddenTest,
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
        sandbox: true,
      },
    });
    reestrWin.setMenuBarVisibility(false);
    const id = reestrWin.webContents.id;
    reestrWindowData.set(id, { ...data, theme:settings.uiTheme || 'light', identity, databaseToken:snapshot.databaseToken || null,
      revision:snapshot.revisions?.reestrRows, baseRows:snapshot.data.reestrRows || [], ownerId:event.sender.id, busy:false });
    reestrWin.once('closed', () => reestrWindowData.delete(id));
    try { await reestrWin.loadFile(path.join(__dirname, '../reestr-window.html')); }
    catch (e) { reestrWindowData.delete(id); reestrWin.destroy(); throw e; }
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
    let loadingTask;
    try {
      const pdfData = new Uint8Array(fs.readFileSync(filePaths[0]));
      const pdfjsPkg = await require('./pdfjs-runtime.cjs').loadPdfJs();
      const { getDocument } = pdfjsPkg;
      loadingTask = getDocument({ ...require('./pdfjs-runtime.cjs').pdfDocumentOptions(), data:pdfData });
      const doc = await loadingTask.promise;
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
    } finally { if (loadingTask) await loadingTask.destroy().catch(() => {}); }
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
    let loadingTask;
    try {
      if (!/\.pdf$/i.test(file)) {
        return { ok: true, kind: 'xlsx', base64: fs.readFileSync(file).toString('base64'), fileName: path.basename(file) };
      }
      const { getDocument } = await require('./pdfjs-runtime.cjs').loadPdfJs();
      loadingTask = getDocument({ ...require('./pdfjs-runtime.cjs').pdfDocumentOptions(), data:new Uint8Array(fs.readFileSync(file)) });
      const doc = await loadingTask.promise;
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
    } finally { if (loadingTask) await loadingTask.destroy().catch(() => {}); }
  });

  ipcMain.handle('reestr-window-data', event => {
    const context = reestrWindowData.get(event.sender.id);
    if (!context) throw new Error('Окно реестра закрыто');
    const { rows,log,statyi,contracts,vehicles,theme } = context;
    return { rows,log,statyi,contracts,vehicles,theme };
  });

  ipcMain.handle('reestr-save-rows', async (event, rows) => {
    let context, ownsBusy = false;
    try {
      registryRows(rows);
      context = reestrWindowData.get(event.sender.id);
      const identity = settingsIdentity(), client = isClientMode(), dir = getDataDir();
      if (!context || context.identity !== identity) throw new Error('База переключена. Откройте реестр заново в нужной базе.');
      if (context.busy) throw new Error('Сохранение уже выполняется');
      context.busy = true; ownsBusy = true;
      const checkSnapshot = snapshot => {
        if (identity !== settingsIdentity() || (snapshot.databaseToken || null) !== context.databaseToken ||
            !Number.isSafeInteger(context.revision) || snapshot.revisions?.reestrRows !== context.revision ||
            JSON.stringify(snapshot.data.reestrRows || []) !== JSON.stringify(context.baseRows)) throw new Error('База или реестр изменены. Сверьте строки и откройте реестр заново.');
      };
      let result;
      if (client) {
        const host = settings.remoteHost, port = settings.remotePort || 3377;
        const snapshot = await server.getJson(host, port, '/api/snapshot', 15000);
        checkSnapshot(snapshot);
        result = await server.postSections(host, port, JSON.stringify({ databaseToken:context.databaseToken, base:{ reestrRows:context.revision }, sections:{ reestrRows:rows } }));
      } else result = storage.withDatabaseLock(dir, () => {
        const snapshot = localRegistrySnapshot(dir);
        checkSnapshot(snapshot);
        storage.makeDailyBackup(dir, path.join(dir, 'backups'), 30);
        const sections = { reestrRows:rows }, base = { reestrRows:context.revision };
        return storage.writeSections(dir, { databaseToken:context.databaseToken, base, sections }, {
          principal:{ id:'local-profile', name:getActiveUser().name || 'Локальный пользователь', role:'admin' } });
      });
      if (!result?.ok) throw new Error(result?.error || 'Реестр изменён другим пользователем. Откройте его заново.');
      context.rows = rows; context.baseRows = rows; context.revision = result.revisions.reestrRows;
      const owner = BrowserWindow.getAllWindows().find(win => win.webContents.id === context.ownerId);
      if (owner && identity === settingsIdentity()) owner.webContents.send('reestr-rows-saved', { rows, revision:context.revision, revisions:result.revisions, databaseToken:context.databaseToken, canonicalSections:result.canonicalSections });
      return { ok:true };
    } catch (e) { return { ok:false, error:e.message }; }
    finally { if (context && ownsBusy) context.busy = false; }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch(error => {
  console.error('[startup]', error && error.stack || error);
  if (!hiddenTest) dialog.showErrorBox('Не удалось запустить программу', String(error && error.message || error));
  app.exit(1);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
