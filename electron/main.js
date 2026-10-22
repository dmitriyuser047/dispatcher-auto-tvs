const { app, BrowserWindow, ipcMain, shell, dialog, session, Notification } = require('electron');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const http    = require('http');
const updater = require('./updater');
const server  = require('./server');
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
  const ca=s.networkMode==='client'&&s.remoteCaFile?require('./safe-file.cjs').readRegularFileSync(s.remoteCaFile,{maxBytes:2*1024*1024,minBytes:1}):null;
  server.configureTransport({protocol:s.remoteProtocol||'http:',ca});
  server.configureKey(s.networkKey);networkConfigError='';
}
try{configureNetwork(settings);}catch(e){networkConfigError=e.message;server.configureTransport({protocol:'https:'});console.error('[network] '+e.message);}

const dataBindings = new Map();
const reestrWindowData = new Map();
const dataReadGenerations=new Map();
const saveBarriers=new Map(),approvedCloseWindows=new Set();
function finishSaveBarrier(senderId,ready){
  const pending=saveBarriers.get(senderId);if(!pending)return;
  clearTimeout(pending.timer);saveBarriers.delete(senderId);pending.resolve(ready===true);
}
function requestSaveBarrier(win){
  if(!win||win.isDestroyed())return Promise.resolve(false);
  const senderId=win.webContents.id;
  if(!dataBindings.has(senderId))return Promise.resolve(true);
  if(saveBarriers.has(senderId))return saveBarriers.get(senderId).promise;
  const nonce=require('node:crypto').randomUUID();let resolve;
  const promise=new Promise(done=>{resolve=done;});
  const timer=setTimeout(()=>finishSaveBarrier(senderId,false),10000);
  saveBarriers.set(senderId,{nonce,promise,resolve,timer});
  try{win.webContents.send('prepare-close',nonce);}catch{finishSaveBarrier(senderId,false);}return promise;
}
let notificationService = null;
const settingsIdentity = () => databaseIdentity(settings);
function bindData(event, token, access = null, revisions = null, platform = null) {
  const previous=dataBindings.get(event.sender.id);
  if(previous&&(previous.identity!==settingsIdentity()||previous.databaseToken!==(token||null)||JSON.stringify(previous.notificationAccess)!==JSON.stringify(access)))notificationService?.invalidate();
  dataBindings.set(event.sender.id, { identity:settingsIdentity(), databaseToken:token || null, notificationAccess:access,
    revisions:revisions && { ...revisions },platform:platform && { ...platform } });
}
function assertDataBinding(event, token) {
  const binding = dataBindings.get(event.sender.id);
  if (!binding || binding.identity !== settingsIdentity() || token && token !== binding.databaseToken) throw new Error('База переключена. Загрузите выбранную базу заново перед сохранением.');
  if (settings.networkMode !== 'client' && binding.databaseToken !== storage.databaseToken(getDataDir())) throw new Error('База изменилась. Загрузите её заново.');
  return binding;
}
function validPublicAccess(access) {
  return !!access&&typeof access==='object'&&typeof access.user?.id==='string'&&!!access.user.id&&['admin','dispatcher','mechanic','accountant','viewer'].includes(access.user?.role)&&
    /^sha256:[a-f0-9]{64}$/.test(access.policyStamp||'')&&['readable','writable'].every(field=>Array.isArray(access[field])&&access[field].every(name=>storage.SECTIONS.includes(name)));
}
function legacyPing(ping) { return ping?.ok===true&&ping.sections!==true&&!ping.access&&!ping.platform?.scopedAccess; }
function readonlyLegacyAccess(){return {user:{id:'legacy-readonly',name:'Старый сервер · только просмотр',role:'viewer'},readable:storage.SECTIONS.slice(),writable:[],fieldPermissions:{},periodActions:[],fuelActions:[],procurementActions:{tank:[],part:[]},costActions:[],repairActions:[],calendarActions:[],printActions:[],importActions:[]};}
function invalidateDataBinding(event){dataBindings.delete(event.sender.id);notificationService?.invalidate();}
function beginDataRead(event){const generation=(dataReadGenerations.get(event.sender.id)||0)+1;dataReadGenerations.set(event.sender.id,generation);return generation;}
function assertDataRead(event,generation,identity){if(dataReadGenerations.get(event.sender.id)!==generation||identity!==settingsIdentity())throw Object.assign(Error('База или права изменились во время чтения'),{code:'SESSION_CHANGED'});}
async function readRemoteSnapshot(event){
  const identity=settingsIdentity(),generation=beginDataRead(event),host=settings.remoteHost,port=settings.remotePort||3377;
  try{
    let snapshot,provenLegacy=false;
    try{snapshot=await server.getJson(host,port,'/api/snapshot',15000);}
    catch(error){
      if(![404,405].includes(error.status))throw error;
      const ping=await server.getJson(host,port,'/api/ping',5000);
      if(!legacyPing(ping))throw Object.assign(Error('Сервер не подтвердил безопасный старый протокол чтения'),{code:'ACCESS_UNVERIFIED'});
      provenLegacy=true;
      snapshot={data:JSON.parse(await server.fetchData(host,port)),databaseToken:ping.databaseToken||null,revisions:null,access:readonlyLegacyAccess(),readOnly:true,platform:{legacyReadOnly:1,scopedAccess:1}};
    }
    assertDataRead(event,generation,identity);
    if(!snapshot?.data||!Array.isArray(snapshot.data.vehicles)||!Array.isArray(snapshot.data.records)||!provenLegacy&&(!validPublicAccess(snapshot.access)||typeof snapshot.databaseToken!=='string'||!snapshot.databaseToken))throw Object.assign(Error('Сервер не подтвердил актуальные права снимка'),{code:'ACCESS_UNVERIFIED'});
    bindData(event,snapshot.databaseToken,snapshot.access,snapshot.revisions,snapshot.platform);return {snapshot,generation,identity};
  }catch(error){assertDataRead(event,generation,identity);invalidateDataBinding(event);throw error;}
}
async function freshDataCacheContext(event){
  const identity=settingsIdentity(),generation=beginDataRead(event);
  if(!(settings.networkMode==='client'&&settings.remoteHost)){const token=storage.databaseToken(getDataDir());return {version:1,mode:'local',identity:identity+':'+token,databaseToken:token,access:null,policyStamp:null};}
  try{
    if(networkConfigError)throw Error(networkConfigError);
    const ping=await server.getJson(settings.remoteHost,settings.remotePort||3377,'/api/ping',5000);
    assertDataRead(event,generation,identity);
    const previous=dataBindings.get(event.sender.id);
    if(legacyPing(ping)&&previous?.platform?.legacyReadOnly===1)return {version:1,mode:'client',identity:identity+':'+(ping.databaseToken||'legacy'),databaseToken:ping.databaseToken||null,access:readonlyLegacyAccess(),policyStamp:null,readOnly:true,legacy:true};
    if(!ping?.ok||typeof ping.databaseToken!=='string'||!ping.databaseToken||!validPublicAccess(ping.access))throw Object.assign(Error('Актуальные права сервера не подтверждены'),{code:'ACCESS_UNVERIFIED'});
    if(!previous||previous.identity!==identity||previous.databaseToken!==ping.databaseToken||JSON.stringify(previous.notificationAccess)!==JSON.stringify(ping.access))bindData(event,ping.databaseToken,ping.access,null,previous?.platform||{apiVersion:1,scopedAccess:1});
    return {version:1,mode:'client',identity:identity+':'+ping.databaseToken,databaseToken:ping.databaseToken,access:ping.access,policyStamp:ping.access.policyStamp};
  }catch(error){assertDataRead(event,generation,identity);invalidateDataBinding(event);throw Object.assign(new Error([401,403].includes(error.status)?'Доступ к серверу отозван':'Не удалось подтвердить текущие права сервера'),{code:[401,403].includes(error.status)?'ACCESS_REVOKED':error.code||'ACCESS_UNVERIFIED',status:error.status||0});}
}
let recoveryService=null;
let documentPrintRenderer=null;
function renderArchivedDocumentPdf(snapshot){
  if(!documentPrintRenderer)documentPrintRenderer=require('./document-print-renderer.cjs').createDocumentPrintRenderer({BrowserWindow,session});
  return documentPrintRenderer(snapshot);
}
function readImportOriginal(filename,context){
  const bytes=require('./safe-file.cjs').readRegularFileSync(filename,{maxBytes:25*1024*1024,minBytes:1,assertCurrent:()=>{if(context)assertFileContextSync(context);}});
  return {name:path.basename(filename),bytes};
}
async function captureFileContext(event){
  if(!event?.sender||event.sender.isDestroyed())throw Object.assign(Error('Окно закрыто'),{code:'SESSION_CHANGED'});
  const sender=event.sender,url=sender.getURL(),frame=sender.mainFrame,registry=reestrWindowData.get(sender.id)||null;
  const operation=await verifiedOperationContext(registry?{sender:{id:registry.ownerId}}:event);
  const context={operation,sender,url,frame,registry,accessJSON:JSON.stringify(dataBindings.get(operation.senderId)?.notificationAccess),progress:Promise.resolve(),failure:null};
  assertFileContextSync(context);return context;
}
function assertFileContextSync(context){
  if(context.failure)throw context.failure;
  if(context.sender.isDestroyed()||context.sender.getURL()!==context.url||context.sender.mainFrame!==context.frame)throw Object.assign(Error('Окно закрыто или изменилось'),{code:'SESSION_CHANGED'});
  assertOperationContext(context.operation);
  if(context.registry&&(reestrWindowData.get(context.sender.id)!==context.registry||context.registry.identity!==settingsIdentity()))throw Object.assign(Error('Окно реестра изменилось'),{code:'SESSION_CHANGED'});
}
async function assertFileContext(context){
  assertFileContextSync(context);
  if(context.operation.client){
    let ping;try{ping=await server.getJson(context.operation.host,context.operation.port,'/api/ping',5000);}catch{throw Object.assign(Error('Текущие права не подтверждены. Повторите действие после загрузки данных.'),{code:'SESSION_CHANGED'});}
    assertFileContextSync(context);
    if(!ping?.ok||ping.databaseToken!==context.operation.databaseToken||JSON.stringify(ping.access)!==context.accessJSON)throw Object.assign(Error('База или права изменились. Повторите действие после загрузки данных.'),{code:'SESSION_CHANGED'});
  }else if(storage.databaseToken(context.operation.directory)!==context.operation.databaseToken)throw Object.assign(Error('База изменилась'),{code:'SESSION_CHANGED'});
}
function sendFileProgress(context,channel,payload){
  if(context.failure)return;
  context.progress=context.progress.then(async()=>{await assertFileContext(context);context.sender.send(channel,payload);}).catch(error=>{context.failure=error;});
}
function selectedFileName(value,extension,fallback){
  const name=value==null?fallback:value;
  if(typeof name!=='string'||!name||name.length>240||path.basename(name)!==name||/[<>:"/\\|?*\x00-\x1f]/.test(name)||/[. ]$/.test(name)||!name.toLowerCase().endsWith('.'+extension))throw Error('Недопустимое имя файла');
  return name;
}
function capturedOperationContext(event,binding=assertDataBinding(event)){
  const client=settings.networkMode==='client',principal=client?(binding.notificationAccess?.user?{...binding.notificationAccess.user,...(binding.notificationAccess?.accessPolicy?{accessPolicy:binding.notificationAccess.accessPolicy}:{}),...(binding.notificationAccess?.readable?{readable:binding.notificationAccess.readable}:{}),...(binding.notificationAccess?.writable?{writable:binding.notificationAccess.writable}:{}),...(binding.notificationAccess?.policyStamp?{policyStamp:binding.notificationAccess.policyStamp}:{})}:null):{id:'local-profile',name:getActiveUser().name||'Локальный пользователь',role:'admin'};
  const identity=settingsIdentity(),scope=require('node:crypto').createHash('sha256').update(JSON.stringify([
    identity,binding.databaseToken,client?null:settings.activeUser,principal?.id,principal?.role,binding.notificationAccess||'local-admin'
  ])).digest('hex');
  return {scope,identity,senderId:event.sender.id,databaseToken:binding.databaseToken,principal,client,
    directory:getDataDir(),host:settings.remoteHost,port:settings.remotePort||3377,
    supportsOperations:binding.platform?.apiVersion===1&&binding.platform?.operations===1&&binding.platform?.outbox===1&&!!principal,
    supportsCommands:binding.platform?.apiVersion===1&&binding.platform?.commands===1&&!!principal};
}
function assertOperationContext(context){
  const binding=dataBindings.get(context.senderId);
  if(!binding||settingsIdentity()!==context.identity||capturedOperationContext({sender:{id:context.senderId}},binding).scope!==context.scope)
    throw Object.assign(Error('База или учётная запись изменились. Очередь не применялась.'),{code:'SESSION_CHANGED',definitive:true});
}
async function verifiedOperationContext(event){
  const context=capturedOperationContext(event);
  if(context.client){
    if(networkConfigError)throw Error(networkConfigError);
    const ping=await server.getJson(context.host,context.port,'/api/ping',5000);
    assertOperationContext(context);
    if(!ping?.ok||ping.databaseToken!==context.databaseToken||JSON.stringify(ping.access)!==JSON.stringify(dataBindings.get(context.senderId)?.notificationAccess))
      throw Object.assign(Error('База или права изменились. Загрузите данные заново.'),{code:'SESSION_CHANGED'});
  }else if(storage.databaseToken(context.directory)!==context.databaseToken)throw Error('База изменилась. Загрузите её заново.');
  return context;
}
function operationRecovery(){
  if(!recoveryService){
    const outbox=require('./command-outbox.cjs').createCommandOutbox({rootDir:path.join(app.getPath('userData'),'pending-operations'),maxEntries:128,maxPayloadBytes:64*1024*1024,maxTotalBytes:256*1024*1024});
    recoveryService=require('./operation-recovery.cjs').createOperationRecovery({outbox,
      send:async(context,json)=>{
        assertOperationContext(context);
        const payload=JSON.parse(json),command=Object.hasOwn(payload,'command');
        if(command&&!context.supportsCommands)throw Object.assign(Error('Подключение не поддерживает атомарные команды'),{code:'UNSUPPORTED_COMMANDS',definitive:true});
        if(context.client){if(networkConfigError)throw Error(networkConfigError);return command?server.postCommands(context.host,context.port,json):server.postSections(context.host,context.port,json);}
        ensureDirs();
        if(command)return storage.executeCommand(context.directory,payload,{principal:context.principal,beforeCommit:createDailyBackup});
        createDailyBackup();return storage.writeSections(context.directory,payload,{principal:context.principal});
      },
      lookup:async(context,id,digest)=>{
        assertOperationContext(context);
        if(context.client)return server.getJson(context.host,context.port,'/api/operation?id='+encodeURIComponent(id)+'&digest='+encodeURIComponent(digest),5000);
        return storage.readOperation(context.directory,{id,digest},context.principal);
      },onWarning:code=>console.warn('[outbox] '+code)
    });
  }
  return recoveryService;
}

let settingsChain = Promise.resolve(), restartConfiguredServer = null;
function queueSettings(next) {
  const operation = settingsChain.then(async () => {
    const checked = validateSettings(typeof next === 'function' ? next(settings) : next);
    // Validate the CA before mutating the active transport or settings.
    if (checked.networkMode === 'client' && checked.remoteCaFile) require('./safe-file.cjs').readRegularFileSync(checked.remoteCaFile,{maxBytes:2*1024*1024,minBytes:1});
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
  contents.once('destroyed', () => {dataBindings.delete(contents.id);dataReadGenerations.delete(contents.id);});
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
  if (storage.schemaVersion(dd) < 2) return;
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
  const closeSenderId=win.webContents.id,closeWindowId=win.id;
  let closing=false;
  win.on('close',event=>{
    if(approvedCloseWindows.has(win.id))return;
    event.preventDefault();if(closing)return;closing=true;
    void(async()=>{
      let ready=await requestSaveBarrier(win);if(win.isDestroyed())return;
      if(!ready&&!hiddenTest){
        const choice=await dialog.showMessageBox(win,{type:'warning',buttons:['Продолжить работу','Закрыть программу'],defaultId:0,cancelId:0,
          title:'Изменения не подтверждены',message:'Не удалось подтвердить последние изменения.',detail:'Продолжите работу, чтобы проверить их и повторить сохранение. Операции, уже записанные в локальную очередь, останутся доступны при следующем запуске.'});
        ready=choice.response===1;
      }
      if(win.isDestroyed())return;
      if(ready){approvedCloseWindows.add(win.id);win.close();}else closing=false;
    })().catch(()=>{closing=false;});
  });
  win.on('closed',()=>{approvedCloseWindows.delete(closeWindowId);finishSaveBarrier(closeSenderId,false);});
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
          'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'" });
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
  ipcMain.handle('finish-close',(event,payload)=>{
    const pending=saveBarriers.get(event.sender.id);
    if(!pending||payload?.nonce!==pending.nonce||typeof payload.ready!=='boolean')return false;
    finishSaveBarrier(event.sender.id,payload.ready);return true;
  });
  require('./artifacts').register({ipcMain,getDataDir,isClientMode,getSettings:()=>settings,knowledgeDir:()=>path.join(getDataDir(),'reestr-knowledge'),getPrincipal:event=>capturedOperationContext(event).principal,getContext:capturedOperationContext,assertContext:assertOperationContext});
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
  app.once('will-quit',()=>notificationService.dispose());
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
        const read=await readRemoteSnapshot(event);assertDataRead(event,read.generation,read.identity);
        return JSON.stringify(read.snapshot.data);
      } catch (e) {
        return null;
      }
    }
    try {
      const snapshot = storage.readSnapshot(getDataDir());
      bindData(event, snapshot.databaseToken, null, snapshot.revisions, snapshot.platform);
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
      if(binding.platform?.legacyReadOnly)return false;
      try {
        const body = binding.databaseToken ? { databaseToken:binding.databaseToken, data, base:payload.base ?? binding.revisions,
          ...(payload.operation ? {operation:payload.operation} : {}),...(payload.scopeViews?{scopeViews:payload.scopeViews}:{}) } : data;
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
        base:payload.base ?? binding.revisions, scopeViews:payload.scopeViews, requireBase:true,
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
      try {
        const read=await readRemoteSnapshot(event);assertDataRead(event,read.generation,read.identity);
        return JSON.stringify(read.snapshot);
      }
      catch { return null; }
    }
    try {
      const dir = getDataDir();
      const snapshot = storage.readSnapshot(dir);
      bindData(event, snapshot.databaseToken, null, snapshot.revisions, snapshot.platform);
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

  ipcMain.handle('query-rows', async (event, query) => {
    try {
      const binding=assertDataBinding(event), identity=settingsIdentity(), token=binding.databaseToken;
      let result;
      if(isClientMode()) {
        if(networkConfigError)throw Error(networkConfigError);
        result=await server.getJson(settings.remoteHost,settings.remotePort||3377,'/api/query?query='+encodeURIComponent(JSON.stringify(query)),15000);
      } else {
        result=require('./data-query.cjs').queryRows(getDataDir(),query,{id:'local-profile',role:'admin'});
      }
      if(identity!==settingsIdentity()||dataBindings.get(event.sender.id)!==binding||result.databaseToken!==token)
        return {ok:false,code:'CURSOR_STALE',error:'База изменилась. Загрузите раздел заново.'};
      return result;
    } catch(error) { return {ok:false,code:error.code||'QUERY_FAILED',error:error.message}; }
  });

  ipcMain.handle('write-sections', async (_event, jsonStr) => {
    let payload,binding;
    try {
      payload = JSON.parse(jsonStr);
      binding = assertDataBinding(_event, payload.databaseToken);
      if (binding.databaseToken) payload.databaseToken = binding.databaseToken;
    } catch (e) { return { ok:false, error:e.message }; }
    const identity = settingsIdentity();
    try {
      const res=await operationRecovery().execute(capturedOperationContext(_event,binding),payload);
      if (identity !== settingsIdentity()) return {ok:false,error:'База переключена во время сохранения. Загрузите выбранную базу заново.'};
      if (res?.ok && res.changed?.length) console.log('[write-sections] ' + res.changed.join(', '));
      return res;
    } catch (e) {
      console.error('[write-sections] ' + e.message);
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('document-print',async(event,payload)=>{
    let archiveAck={};
    try{
      const fileContext=await captureFileContext(event),context=fileContext.operation;
      if(dataBindings.get(context.senderId)?.platform?.documentPrint!==1)return {ok:false,unsupported:true,code:'UNSUPPORTED_DOCUMENT_PRINT',error:'Подключение не поддерживает сохранённые печатные редакции.'};
      if(!payload||typeof payload!=='object'||Array.isArray(payload)||!['preview','list','read','export'].includes(payload.action))throw Object.assign(Error('Неизвестное действие печати'),{code:'PRINT_ACTION'});
      const invoke=()=>context.client?server.postDocumentPrint(context.host,context.port,JSON.stringify(payload)):require('./document-archive.cjs').handle(context.directory,payload,{principal:context.principal,renderPdf:renderArchivedDocumentPdf});
      const result=await invoke();await assertFileContext(fileContext);
      if(payload.action!=='export'||result?.ok!==true)return result;
      archiveAck=Object.fromEntries(['archiveHeadChanged','canonicalSections','revisions','databaseToken'].filter(name=>Object.hasOwn(result,name)).map(name=>[name,result[name]]));
      const bytes=require('./document-print-export.cjs').verifiedBytes(result,payload);
      const format=payload.format;
      const choice=await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender),{title:'Сохранить печатную редакцию',defaultPath:path.join(app.getPath('documents'),'Документ_'+payload.archiveId+'.'+format),filters:[{name:format==='pdf'?'PDF документ':'Книга Excel',extensions:[format]}]});
      await assertFileContext(fileContext);
      if(choice.canceled||!choice.filePath)return {ok:false,canceled:true,archiveId:payload.archiveId,format,...archiveAck};
      await require('./safe-file.cjs').writeRegularFileAtomic(choice.filePath,bytes,{maxBytes:128*1024*1024,assertCurrent:()=>assertFileContextSync(fileContext)});
      await assertFileContext(fileContext);
      return {ok:true,saved:true,archiveId:payload.archiveId,format,size:bytes.length,sha256:result.sha256,path:choice.filePath,...archiveAck};
    }catch(error){return {ok:false,code:error.code||'PRINT_FAILED',error:error.message,...(error.code==='SESSION_CHANGED'?{}:archiveAck)};}
  });
  ipcMain.handle('import-source',async(event,payload)=>{
    try{
      const fileContext=await captureFileContext(event),context=fileContext.operation;
      if(dataBindings.get(context.senderId)?.platform?.controlledImports!==1)return {ok:false,unsupported:true,code:'UNSUPPORTED_CONTROLLED_IMPORTS',error:'Подключение не поддерживает проверяемый импорт.'};
      if(!payload||typeof payload!=='object'||Array.isArray(payload)||!['stage','preview','read'].includes(payload.action))throw Object.assign(Error('Неизвестное действие источника импорта'),{code:'IMPORT_SOURCE_ACTION'});
      const request=structuredClone(payload);
      if(request.databaseToken!==undefined&&request.databaseToken!==context.databaseToken)throw Object.assign(Error('База изменилась после выбора файла'),{code:'DATABASE_CHANGED'});
      request.databaseToken=context.databaseToken;
      const encode=source=>{if(!source||typeof source!=='object')return source;if(source.bytes!==undefined){if(source.base64!==undefined)throw Error('Источник задан дважды');const raw=source.bytes;let bytes;if(raw instanceof ArrayBuffer)bytes=Buffer.from(raw);else if(ArrayBuffer.isView(raw))bytes=Buffer.from(raw.buffer,raw.byteOffset,raw.byteLength);else if(Array.isArray(raw)&&raw.every(value=>Number.isInteger(value)&&value>=0&&value<=255))bytes=Buffer.from(raw);else throw Error('Некорректные байты источника');if(bytes.length>25*1024*1024)throw Error('Исходный файл больше 25 МБ');source.base64=bytes.toString('base64');delete source.bytes;}return source;};
      if(request.source){if(Array.isArray(request.source.files))request.source.files=request.source.files.map(encode);else request.source=encode(request.source);}
      const result=context.client?await server.postImportSource(context.host,context.port,JSON.stringify(request)):await require('./import-source.cjs').handle(context.directory,request,{principal:context.principal});
      await assertFileContext(fileContext);
      if(result?.ok===true&&result.databaseToken!==context.databaseToken)throw Object.assign(Error('Ответ импорта относится к другой базе'),{code:'DATABASE_CHANGED'});
      return result;
    }catch(error){return {ok:false,code:error.code||'IMPORT_SOURCE_FAILED',error:error.message,...(Array.isArray(error.issues)?{issues:error.issues}:{})};}
  });
  ipcMain.handle('execute-command',async(event,json)=>{
    try{
      const contracts=require('../assets/core/platform-contracts.js');
      const payload=contracts.parseCommandEnvelope(typeof json==='string'?JSON.parse(json):json,storage.SECTIONS);
      const binding=assertDataBinding(event,payload.databaseToken),context=capturedOperationContext(event,binding);
      if(!context.supportsOperations||!context.supportsCommands)
        return {ok:false,unsupported:true,code:'UNSUPPORTED_COMMANDS',error:'Подключение не поддерживает атомарные команды. Загрузите данные из совместимой версии программы.'};
      const result=await operationRecovery().execute(context,payload);
      assertOperationContext(context);
      return result;
    }catch(error){return {ok:false,code:error.code||'COMMAND_FAILED',error:error.message,...(Array.isArray(error.issues)?{issues:error.issues}:{})};}
  });
  ipcMain.handle('get-pending-operations',async event=>{try{
    const context=await verifiedOperationContext(event);
    return {ok:true,supported:context.supportsOperations,operations:context.supportsOperations?operationRecovery().list(context):[]};
  }catch(error){return {ok:false,error:error.message};}});
  for(const [channel,action]of [['reconcile-operation','reconcile'],['retry-operation','retry'],['discard-operation','discard']])ipcMain.handle(channel,async(event,id)=>{try{
    require('../assets/core/platform-contracts.js').validateOperation({id});
    const context=await verifiedOperationContext(event);
    if(!context.supportsOperations)throw Error('Сервер не поддерживает восстановление операций. Загрузите данные заново.');
    const result=await operationRecovery()[action](context,id);assertOperationContext(context);
    return action==='discard'?{ok:true}:result;
  }catch(error){return {ok:false,error:error.message,code:error.code};}});

  ipcMain.handle('get-data-path', () => getDataDir());
  for(const [channel,action]of [['inspect-schema-upgrade','inspect'],['upgrade-schema-copy','copy']])ipcMain.handle(channel,async(event,payload)=>{
    try{
      const handlers=require('./schema-upgrade-ipc.cjs').createHandlers({
        getContext:()=>{const binding=assertDataBinding(event),context=capturedOperationContext(event,binding);return {binding,identity:context.identity,sourceDir:context.directory,role:context.principal?.role,client:context.client};},
        assertContext:context=>{if(settingsIdentity()!==context.identity||dataBindings.get(event.sender.id)!==context.binding||getDataDir()!==context.sourceDir)throw Object.assign(Error('База или пользователь изменились. Повторите проверку выбранной базы.'),{code:'SESSION_CHANGED'});},
        inspectSource:input=>require('./schema-upgrade.cjs').inspectSource(input),
        upgradeCopy:input=>require('./schema-upgrade.cjs').upgradeCopy(input)
      });
      return await handlers[action](payload);
    }catch(error){return {ok:false,code:error.code||'SCHEMA_UPGRADE_FAILED',error:error.message};}
  });
  ipcMain.handle('get-data-identity', async () => {
    const identity = settingsIdentity();
    if (!isClientMode()) return identity + ':' + storage.databaseToken(getDataDir());
    if (networkConfigError) throw new Error(networkConfigError);
    const ping = await server.getJson(settings.remoteHost, settings.remotePort || 3377, '/api/ping', 5000);
    if (identity !== settingsIdentity() || !ping?.ok) throw new Error('База переключена или недоступна. Повторите действие.');
    return identity + ':' + (ping.databaseToken || 'legacy');
  });
  ipcMain.handle('get-data-cache-context',event=>freshDataCacheContext(event));
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
        backups = fs.readdirSync(getBackupDir()).filter(name => /^data_\d{4}-\d{2}-\d{2}\.(?:json|zip)$/.test(name))
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
  ipcMain.handle('get-access-catalog',()=>({actions:require('./access-control').POLICY_ACTIONS.slice(),sections:storage.SECTIONS.slice()}));
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
      renderPdf:renderArchivedDocumentPdf,
      key: settings.networkKey,
      settings:()=>settings,
      tls:settings.serverProtocol==='https:'?{cert:require('./safe-file.cjs').readRegularFileSync(settings.serverTlsCert,{maxBytes:2*1024*1024,minBytes:1}),key:require('./safe-file.cjs').readRegularFileSync(settings.serverTlsKey,{maxBytes:2*1024*1024,minBytes:1})}:null,
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
    const context=await captureFileContext(event);
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(senderWin, {
      title: 'Выберите RAR-архив с данными',
      filters: [{ name: 'RAR архив', extensions: ['rar'] }],
      properties: ['openFile'],
    });
    await assertFileContext(context);
    if (canceled || !filePaths || !filePaths[0]) return { ok: false, canceled: true };

    const KEYS = ['vehicles', 'records', 'generators', 'genRecords', 'toRecords', 'tanks', 'tankIncomes'];
    const pick = (obj) => {
      const o = {};
      KEYS.forEach(k => { o[k] = Array.isArray(obj[k]) ? obj[k] : []; });
      return o;
    };

    try {
      const source=readImportOriginal(filePaths[0],context),buf=source.bytes;
      const entries=await require('./archive-decoder.cjs').extractRAR(buf,{assertCurrent:()=>assertFileContextSync(context)});
      await assertFileContext(context);
      const jsonEntries=entries.filter(entry=>!entry.isDirectory&&entry.name.toLowerCase().endsWith('.json'));
      if (!jsonEntries.length) return { ok: false, error: 'В архиве не найдено JSON-файлов с данными.' };
      const dec = new TextDecoder('utf-8');
      let main = null;
      const backupObjs = [];
      for (const f of jsonEntries) {
        assertFileContextSync(context);
        const name = f.name;
        let obj;
        try { obj = JSON.parse(dec.decode(f.bytes)); } catch { continue; }
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

      await assertFileContext(context);
      return { ok: true, fileName: path.basename(filePaths[0]), source, backupCount: backupObjs.length, main, backupExtra };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Экспорт произвольного JSON-подмножества данных в файл (для передачи между приложениями)
  ipcMain.handle('export-json', async (event, jsonStr, defaultFileName) => {
    const context=await captureFileContext(event);
    const name=selectedFileName(defaultFileName,'json','export.json');
    if(typeof jsonStr!=='string'||Buffer.byteLength(jsonStr)>32*1024*1024)throw Error('JSON превышает 32 МБ');
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePath } = await dialog.showSaveDialog(senderWin, {
      title: 'Сохранить JSON-файл',
      defaultPath: path.join(app.getPath('documents'), name),
      filters: [{ name: 'JSON файл', extensions: ['json'] }],
    });
    await assertFileContext(context);
    if (canceled || !filePath) return { ok: false, canceled: true };
    await require('./safe-file.cjs').writeRegularFileAtomic(filePath,Buffer.from(jsonStr,'utf8'),{maxBytes:32*1024*1024,assertCurrent:()=>assertFileContextSync(context)});
    await assertFileContext(context);
    shell.showItemInFolder(filePath);
    return { ok: true, filePath };
  });

  // Импорт JSON-файла (сырые данные, без RAR) — выбор файла и чтение содержимого
  ipcMain.handle('import-json-file', async (event) => {
    const context=await captureFileContext(event);
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(senderWin, {
      title: 'Выберите JSON-файл с данными',
      filters: [{ name: 'JSON файл', extensions: ['json'] }],
      properties: ['openFile'],
    });
    await assertFileContext(context);
    if (canceled || !filePaths || !filePaths[0]) return { ok: false, canceled: true };
    try {
      const source=readImportOriginal(filePaths[0],context);
      await assertFileContext(context);
      return { ok: true, fileName: source.name, source, content:source.bytes.toString('utf8') };
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
    const context=await captureFileContext(event);
    const html = payload && payload.html;
    const defaultFileName = selectedFileName(payload?.defaultFileName,'pdf','Сводка.pdf');
    if (!html) return { ok: false, error: 'Пустой документ' };

    const senderWin = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePath } = await dialog.showSaveDialog(senderWin, {
      title: 'Сохранить сводку в PDF',
      defaultPath: path.join(app.getPath('documents'), defaultFileName),
      filters: [{ name: 'PDF документ', extensions: ['pdf'] }],
    });
    await assertFileContext(context);
    if (canceled || !filePath) return { ok: false, canceled: true };
    try {
      const renderPdf=require('./safe-html-pdf.cjs').createSafeHtmlPdfRenderer({BrowserWindow,session});
      const pdfData=await renderPdf(html,{landscape:true,pageSize:'A4',preferCSSPageSize:false},()=>assertFileContextSync(context));
      await assertFileContext(context);
      await require('./safe-file.cjs').writeRegularFileAtomic(filePath,pdfData,{maxBytes:128*1024*1024,assertCurrent:()=>assertFileContextSync(context)});
      await assertFileContext(context);
      await shell.openPath(filePath);
      await assertFileContext(context);
      return { ok: true, path: filePath };
    } catch (e) {
      return { ok: false, error: e.message };
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

  ipcMain.handle('install-update', async event => {
    try {
      if(!downloadedPath || !fs.existsSync(downloadedPath))throw new Error('Установщик не загружен');
      const win=BrowserWindow.fromWebContents(event.sender);
      if(BrowserWindow.getAllWindows().some(other=>other!==win))throw Error('Закройте окна документов перед установкой обновления');
      if(!await requestSaveBarrier(win))throw Error('Последние изменения не подтверждены. Проверьте сохранение перед установкой.');
      approvedCloseWindows.add(win.id);
      await updater.launchInstaller(downloadedPath);
      return {ok:true};
    } catch(e) {const win=BrowserWindow.fromWebContents(event.sender);if(win)approvedCloseWindows.delete(win.id);return {ok:false,error:e.message};}
  });

  // ─── РЕЕСТР-БИЛДЕР ──────────────────────────────────────
  const REESTR_DIR = path.join(__dirname, '..', 'ReestrBuilder');
  const REESTR_LIB_URL = pathToFileURL(path.join(REESTR_DIR, 'lib.mjs'));
  async function loadReestrLib(event,context) {
    context=context||await captureFileContext(event);
    const identity = settingsIdentity(), directory = path.join(getDataDir(), 'reestr-knowledge');
    const registry = event && reestrWindowData.get(event.sender.id);
    if (registry && registry.identity !== identity) throw new Error('База переключена. Откройте реестр заново.');
    if (event && !registry) assertDataBinding(event);
    const url = new URL(REESTR_LIB_URL); url.searchParams.set('profile', identity);
    // Each database owns its module instance and knowledge path during long OCR jobs.
    const lib = await import(url.href);
    await assertFileContext(context);
    lib.configureKnowledgePath(directory);
    return lib;
  }

  ipcMain.handle('reestr-parse-invoices', async (event, zipArrayBuffer) => {
    const context=await captureFileContext(event);
    console.log('[reestr] parse-invoices start');
    const { parseInvoices, loadConfig,createArchiveBudget } = await loadReestrLib(event,context);
    const config = loadConfig(path.join(REESTR_DIR, 'config.json'));
    const log = [];
    if(!zipArrayBuffer||!Number.isSafeInteger(zipArrayBuffer.byteLength??zipArrayBuffer.length)||(zipArrayBuffer.byteLength??zipArrayBuffer.length)>25*1024*1024)throw Error('Исходные файлы превышают 25 МБ');
    const rows = await parseInvoices(Buffer.from(zipArrayBuffer), config, (msg) => { assertFileContextSync(context);log.push(msg); },{budget:createArchiveBudget()});
    await assertFileContext(context);
    console.log('[reestr] parse-invoices done, rows:', rows.length);
    return { log, rows, config };
  });

  ipcMain.handle('reestr-parse-pdfs', async (event, pdfFilesRaw) => {
    const context=await captureFileContext(event);
    if(!Array.isArray(pdfFilesRaw)||!pdfFilesRaw.length||pdfFilesRaw.length>1000)throw Error('Нужно от 1 до 1000 исходных файлов');
    let inputBytes=0;for(const file of pdfFilesRaw){const size=file?.buffer?.byteLength??file?.buffer?.length;if(!Number.isSafeInteger(size)||size<1||(inputBytes+=size)>25*1024*1024)throw Error('Исходные файлы превышают 25 МБ');}
    console.log('[reestr] parse-pdfs start, files:', pdfFilesRaw.length);
    const { parsePdfFiles, loadConfig,createArchiveBudget } = await loadReestrLib(event,context);
    const config = loadConfig(path.join(REESTR_DIR, 'config.json'));
    const log = [];
    const pdfFiles = pdfFilesRaw.map(f => ({ name: f.name, buffer: Buffer.from(f.buffer) }));
    const rows = await parsePdfFiles(pdfFiles, config,
      (msg) => { assertFileContextSync(context);log.push(msg); },
      (progress) => { sendFileProgress(context,'reestr-progress',progress); },
      (ocr) => { sendFileProgress(context,'reestr-ocr-page',ocr); },
      {budget:createArchiveBudget()}
    );
    await context.progress;await assertFileContext(context);
    console.log('[reestr] parse-pdfs done, rows:', rows.length);
    return { log, rows, config };
  });

  ipcMain.handle('reestr-build-xlsx', async (event, { rows }) => {
    const context=await captureFileContext(event);
    const { buildXlsxFromRows, loadConfig } = await loadReestrLib(event,context);
    const config = loadConfig(path.join(REESTR_DIR, 'config.json'));
    const { buffer, total } = await buildXlsxFromRows(rows, config);
    await assertFileContext(context);
    return {
      filename: `Реестр_${new Date().toISOString().slice(0, 10)}.xlsx`,
      xlsxBase64: buffer.toString('base64'),
      total,
    };
  });

  ipcMain.handle('reestr-learn', async (event, rows) => {
    const context=await captureFileContext(event);
    const { learnFromRows } = await loadReestrLib(event,context);
    await assertFileContext(context);
    return learnFromRows(rows);
  });

  ipcMain.handle('reestr-apply-knowledge', async (event, rows) => {
    const context=await captureFileContext(event);
    const { applyKnowledge } = await loadReestrLib(event,context);
    return applyKnowledge(rows);
  });

  ipcMain.handle('reestr-analytics', async (event, rows) => {
    const context=await captureFileContext(event);
    const { getAnalytics } = await loadReestrLib(event,context);
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
    const context=await captureFileContext(event);
    const name=selectedFileName(filename,'xlsx','Реестр.xlsx');
    if(typeof xlsxBase64!=='string'||!xlsxBase64.length||xlsxBase64.length>Math.ceil(128*1024*1024*4/3)+4||xlsxBase64.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(xlsxBase64))throw Error('Некорректный размер Excel');
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePath } = await dialog.showSaveDialog(senderWin, {
      title: 'Сохранить реестр',
      defaultPath: path.join(app.getPath('downloads'), name),
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    await assertFileContext(context);
    if (canceled || !filePath) return { saved: false };
    await require('./safe-file.cjs').writeRegularFileAtomic(filePath,Buffer.from(xlsxBase64,'base64'),{maxBytes:128*1024*1024,assertCurrent:()=>assertFileContextSync(context)});
    await assertFileContext(context);
    shell.showItemInFolder(filePath);
    return { saved: true, path: filePath };
  });

  // ─── Отдельное окно реестра ───
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
  require('./pdf-editor-service.cjs').registerPdfEditorService({ app, BrowserWindow, ipcMain, dialog,getOpeningContext:captureFileContext,assertOpeningContext:assertFileContext,assertOpeningContextSync:assertFileContextSync });

  // ─── Импорт Сводки из PDF ───
  ipcMain.handle('import-svodka-pdf', async (event) => {
    const context=await captureFileContext(event);
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(senderWin, {
      title: 'Выберите PDF-файл сводки',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['openFile'],
    });
    await assertFileContext(context);
    if (canceled || !filePaths || !filePaths[0]) return { ok: false };
    let loadingTask;
    try {
      const source=readImportOriginal(filePaths[0],context),pdfData=new Uint8Array(source.bytes);
      const pdfjsPkg = await require('./pdfjs-runtime.cjs').loadPdfJs();
      await assertFileContext(context);
      const { getDocument } = pdfjsPkg;
      loadingTask = getDocument({ ...require('./pdfjs-runtime.cjs').pdfDocumentOptions(), data:pdfData });
      const doc = await loadingTask.promise;
      await assertFileContext(context);
      const allItems = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        await assertFileContext(context);
        const content = await page.getTextContent();
        await assertFileContext(context);
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
      await assertFileContext(context);
      return { ok: true, items: allItems, source, fileName: path.basename(filePaths[0]) };
    } catch (e) {
      return { ok: false, error: e.message };
    } finally { if (loadingTask) await loadingTask.destroy().catch(() => {}); }
  });

  // Отчёт ГЛОНАСС: PDF отдаём текстом с координатами, Excel — как есть
  ipcMain.handle('import-glonass-file', async (event) => {
    const context=await captureFileContext(event);
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(senderWin, {
      title: 'Выберите отчёт ГЛОНАСС («Рейсы» или суточный пробег)',
      filters: [{ name: 'Отчёт ГЛОНАСС', extensions: ['pdf', 'xlsx', 'xls'] }],
      properties: ['openFile'],
    });
    await assertFileContext(context);
    if (canceled || !filePaths || !filePaths[0]) return { ok: false };
    const file = filePaths[0];
    let loadingTask;
    try {
      const source=readImportOriginal(file,context);
      if (!/\.pdf$/i.test(file)) {
        await assertFileContext(context);
        return { ok: true, kind: 'xlsx', base64:source.bytes.toString('base64'), source, fileName:path.basename(file) };
      }
      const { getDocument } = await require('./pdfjs-runtime.cjs').loadPdfJs();
      await assertFileContext(context);
      loadingTask = getDocument({ ...require('./pdfjs-runtime.cjs').pdfDocumentOptions(), data:new Uint8Array(source.bytes) });
      const doc = await loadingTask.promise;
      await assertFileContext(context);
      const items = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        await assertFileContext(context);
        const content = await page.getTextContent();
        await assertFileContext(context);
        for (const it of content.items) {
          if (!it.str || !it.str.trim()) continue;
          items.push({ str: it.str, x: Math.round(it.transform[4] * 10) / 10, y: Math.round(it.transform[5] * 10) / 10, page: i });
        }
      }
      await assertFileContext(context);
      return { ok: true, kind: 'pdf', items, source, fileName: path.basename(file) };
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
