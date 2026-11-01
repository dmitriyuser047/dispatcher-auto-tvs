/* Browser transport for the existing domain controllers. No Electron runtime,
 * shared-key fallback, local database, or browser-side bearer credentials. */
(function () {
  'use strict';
  const API = '/web-api/';
  const MAX_FILE = 25 * 1024 * 1024;
  let bootstrapPromise = null;
  let versionPromise = null;
  let snapshotToken = null;
  let latestSnapshot = null;
  let csrf = document.querySelector('meta[name="tvs-csrf"]')?.content || '';
  const themeListeners = new Set();

  const unsupported = label => async () => {
    throw Object.assign(Error(label + ': перенос этой функции в веб-версию ещё не завершён.'), { code: 'WEB_NOT_IMPLEMENTED' });
  };
  function connectionError(error) {
    const show = () => {
      if (document.getElementById('webConnectionError')) return;
      const panel = document.createElement('section');
      panel.id = 'webConnectionError';
      panel.setAttribute('role', 'alert');
      panel.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-content:center;gap:16px;padding:32px;background:#0c1b34;color:#e7f4ff;font:16px system-ui';
      const title = document.createElement('h1'); title.textContent = 'Подключение к общей базе не подтверждено';
      const detail = document.createElement('p'); detail.textContent = error?.message || 'Проверьте соединение и войдите повторно.';
      const link = document.createElement('a'); link.href = '/login'; link.textContent = 'Войти заново'; link.style.color = '#99eaff';
      const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Обновить страницу'; retry.onclick = () => location.reload();
      panel.append(title, detail, link, retry); document.body.append(panel);
    };
    if (document.body) show(); else document.addEventListener('DOMContentLoaded', show, { once: true });
  }
  async function request(route, options = {}) {
    const { body, preserveFailure = false, method = body === undefined ? 'GET' : 'POST' } = options;
    let response;
    try {
      response = await fetch(API + route, { method, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      throw Object.assign(Error('Сервер недоступен. Результат отправленной операции нужно проверить в «Состоянии программы».'), { code: 'WEB_TRANSPORT', unknown: method !== 'GET', cause: error });
    }
    let value;
    try { value = await response.json(); }
    catch { throw Object.assign(Error('Сервер вернул неподтверждённый ответ.'), { code: 'WEB_RESPONSE', status: response.status, unknown: method !== 'GET' }); }
    if ([401, 403].includes(response.status)) {
      const error = Object.assign(Error(value.error || 'Сеанс завершён или доступ отозван.'), value, { status: response.status });
      if (response.status === 401) connectionError(error);
      throw error;
    }
    if (!response.ok && !preserveFailure)
      throw Object.assign(Error(value.error || 'Запрос к серверу не выполнен.'), value, { status: response.status });
    if (typeof value.csrf === 'string') csrf = value.csrf;
    return value;
  }
  function bootstrap() {
    if (!bootstrapPromise) bootstrapPromise = request('bootstrap').catch(error => { bootstrapPromise = null; throw error; });
    return bootstrapPromise;
  }
  const parse = value => typeof value === 'string' ? JSON.parse(value) : structuredClone(value);
  async function readSnapshot(payload = {}, endpoint = 'snapshot') {
    try {
      // The snapshot gateway negotiates this exact client profile alongside
      // the fresh rows. Both initial reads can run together; neither needs CSRF.
      const query=new URLSearchParams();if(payload.hello)query.set('hello',JSON.stringify(payload.hello));
      const route=endpoint+(query.size?'?'+query:'');
      const [, snapshot] = await Promise.all([bootstrap(), request(route)]);
      const negotiated = payload.hello && !snapshot.platform?.negotiation ? await request('negotiate', { body: payload.hello }) : null;
      if (!Array.isArray(snapshot?.data?.vehicles) || !Array.isArray(snapshot.data.records) ||
          !snapshot.revisions || typeof snapshot.databaseToken !== 'string' || !snapshot.access?.user?.id ||
          !/^sha256:[a-f0-9]{64}$/.test(snapshot.access.policyStamp || ''))
        throw Object.assign(Error('Сервер не подтвердил актуальные данные и права.'), { code: 'ACCESS_UNVERIFIED' });
      if (negotiated?.compatibility && !snapshot.platform?.negotiation)
        snapshot.platform = { ...snapshot.platform, compatibility: negotiated.platform?.compatibility, negotiation: negotiated.compatibility };
      if (snapshot.platform?.negotiation?.readCompatible === false)
        throw Error('Версия клиента несовместима с форматом общей базы.');
      snapshotToken = snapshot.databaseToken;
      latestSnapshot = snapshot;
      return JSON.stringify(snapshot);
    } catch (error) { connectionError(error); throw error; }
  }
  async function cacheContext() {
    const ping = await request('ping');
    if (!ping.ok || !ping.access?.user?.id || !/^sha256:[a-f0-9]{64}$/.test(ping.access.policyStamp || '') || !ping.databaseToken)
      throw Object.assign(Error('Текущие права сервера не подтверждены.'), { code: 'ACCESS_UNVERIFIED' });
    return { version: 1, mode: 'client', identity: 'web:' + location.origin + ':user:' + ping.access.user.id + ':' + ping.databaseToken,
      databaseToken: ping.databaseToken, access: ping.access, policyStamp: ping.access.policyStamp, readOnly: ping.platform?.readOnly === true };
  }
  async function mutate(route, payload) {
    await bootstrap();
    return request(route, { body: parse(payload), preserveFailure: true });
  }
  function safeName(value, fallback) {
    const name = String(value || fallback).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 180);
    return name || fallback;
  }
  function download(bytes, name, mime) {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime || 'application/octet-stream' }));
    const link = document.createElement('a'); link.href = url; link.download = safeName(name, 'Документ'); document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return { ok: true, downloadStarted: true, message: 'Файл передан в загрузки браузера.' };
  }
  function base64(bytes) {
    let binary = '';
    for (let start = 0; start < bytes.length; start += 32768) binary += String.fromCharCode(...bytes.subarray(start, start + 32768));
    return btoa(binary);
  }
  function encodedSource(value) {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value.files)) return { ...value, files: value.files.map(encodedSource) };
    if (value.bytes === undefined) return value;
    if (value.base64 !== undefined) throw Error('Источник задан дважды.');
    const source = value.bytes;
    const bytes = source instanceof ArrayBuffer ? new Uint8Array(source) : ArrayBuffer.isView(source) ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength) :
      Array.isArray(source) && source.every(item => Number.isInteger(item) && item >= 0 && item <= 255) ? Uint8Array.from(source) : null;
    if (!bytes || bytes.length > MAX_FILE) throw Error('Некорректный исходный файл или размер больше 25 МБ.');
    const { bytes: omitted, ...rest } = value;
    return { ...rest, base64: base64(bytes) };
  }
  async function verifiedDownload(result, name, format) {
    if (typeof result.base64 !== 'string') throw Error('Сервер не передал файл для загрузки.');
    const binary = atob(result.base64), bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    if (result.bytes !== undefined && Number.isSafeInteger(result.bytes) && result.bytes !== bytes.length) throw Error('Размер файла не совпадает с подтверждением сервера.');
    if (typeof result.sha256 === 'string') {
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
      if (digest !== result.sha256.replace(/^sha256:/, '')) throw Error('Контрольная сумма файла не совпадает.');
    }
    const started = download(bytes, name, format === 'pdf' ? 'application/pdf' : format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : undefined);
    const { base64: omitted, ...rest } = result;
    return { ...rest, ...started };
  }
  function chooseFile(accept) {
    return new Promise(resolve => {
      const input = document.createElement('input'); input.type = 'file'; input.accept = accept; input.style.display = 'none';
      const finish = file => { input.remove(); resolve(file || null); };
      input.addEventListener('change', () => finish(input.files?.[0]), { once: true });
      input.addEventListener('cancel', () => finish(null), { once: true });
      document.body.append(input); input.click();
    });
  }
  async function importJsonFile() {
    const file = await chooseFile('.json,application/json');
    if (!file) return { ok: false, canceled: true };
    if (!file.size || file.size > MAX_FILE) throw Error('Выберите непустой JSON размером до 25 МБ.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    return { ok: true, fileName: file.name, source: { name: file.name, bytes }, content: new TextDecoder().decode(bytes) };
  }
  async function importSource(payload) {
    const request = parse(payload);
    request.databaseToken ??= snapshotToken;
    if (request.source) request.source = encodedSource(request.source);
    return mutate('import-source', request);
  }
  async function nativeImport(action,accept){
    const file=await chooseFile(accept);if(!file)return {ok:false,canceled:true};
    if(!file.size||file.size>MAX_FILE)throw Error('Выберите непустой файл размером до 25 МБ.');
    return mutate('native-import',{action,databaseToken:snapshotToken,source:{name:file.name,base64:base64(new Uint8Array(await file.arrayBuffer()))}});
  }
  async function addAttachment(origin){
    const file=await chooseFile('.pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.xlsx,.xls,.docx,.odt,.ods');if(!file)return {ok:false,canceled:true};
    if(!file.size||file.size>MAX_FILE)throw Error('Размер вложения должен быть от 1 байта до 25 МБ.');
    return mutate('attachment',{action:'attachmentAdd',origin,databaseToken:snapshotToken,source:{name:file.name,base64:base64(new Uint8Array(await file.arrayBuffer()))}});
  }
  async function openAttachment(origin){
    if(typeof origin==='string'){
      const matches=[];for(const [section,rows]of Object.entries(typeof data==='object'?data:latestSnapshot?.data||{}))if(Array.isArray(rows))for(const row of rows)if(row.attachments?.some(file=>file.id===origin))matches.push({section,id:row.id,fileId:origin});
      if(matches.length!==1)throw Error('Откройте вложение из карточки исходной записи.');origin=matches[0];
    }
    const result=await mutate('attachment',{action:'attachmentRead',origin});return result.ok?verifiedDownload(result,result.name):result;
  }
  async function inventoryDatabase(payload) {
    const request = parse(payload);
    const downloadOriginal = request.action === 'documentSave';
    if (request.action === 'openFolder') return unsupported('Папка базы находится на сервере')();
    if (request.action === 'importSource' && request.request?.source) request.request.source = encodedSource(request.request.source);
    if (request.action === 'documentSave') request.action = 'documentRead';
    const result = await mutate('inventory-database', request);
    if (result.ok && (downloadOriginal || request.action === 'export') && typeof result.base64 === 'string')
      return verifiedDownload(result, result.name || result.defaultFileName || 'Инвентаризация.' + (request.request?.format || 'bin'), request.request?.format);
    return result;
  }
  async function printDocument(payload) {
    const result = await mutate('document-print', payload);
    return result.ok && payload.action === 'export' ? verifiedDownload(result, 'Документ_' + payload.archiveId + '.' + payload.format, payload.format) : result;
  }
  const api = {
    readData: async () => JSON.stringify((await request('snapshot')).data),
    readSnapshot,
    readWorkspace: payload => {
      const query=new URLSearchParams(location.search);
      return query.get('tab')==='auditLog'||location.pathname?.startsWith('/people/')?readSnapshot(payload):readSnapshot(payload,'workspace');
    },
    ensureSections: names => request('workspace?sections='+encodeURIComponent(JSON.stringify(names))),
    getRevisions: () => request('revisions'),
    readSection: name => request('section/' + encodeURIComponent(name)),
    queryRows: query => request('query?query=' + encodeURIComponent(JSON.stringify(query))),
    queryHistory: query => request('history?query=' + encodeURIComponent(JSON.stringify(query))),
    writeSections: payload => mutate('sections', payload),
    executeCommand: payload => mutate('commands', payload),
    writeData: unsupported('Полная замена общей базы через браузер'),
    getPendingOperations: () => request('pending-operations'),
    reconcileOperation: id => mutate('reconcile-operation', { id }),
    retryOperation: id => mutate('retry-operation', { id }),
    discardOperation: id => mutate('discard-operation', { id }),
    getDataCacheContext: cacheContext,
    getDataIdentity: async () => (await cacheContext()).identity,
    getDataPath: async () => 'Общая серверная база',
    getSettings: async () => structuredClone((await bootstrap()).settings),
    getAppVersion: () => versionPromise ||= bootstrap().then(result => typeof result.version === 'string' ? result.version : request('ping').then(value => value.version)),
    getDataHealth: async () => { const value = await request('ping'); return { mode: 'client', available: value.ok, serverName: value.name, checkedAt: new Date().toISOString() }; },
    getTheme: async () => localStorage.getItem('theme') === 'light' ? 'light' : 'dark',
    setTheme: async theme => { const selected = theme === 'light' ? 'light' : 'dark'; localStorage.setItem('theme', selected); themeListeners.forEach(listener => listener(selected)); return selected; },
    onThemeChanged: listener => { themeListeners.add(listener); return () => themeListeners.delete(listener); },
    importJsonFile,
    importSource,
    inventoryDatabase,
    documentPrint: printDocument,
    assetInventoryExport: async payload => { const result = await mutate('inventory-report', payload); if (!result.ok) return result; return verifiedDownload(result, result.defaultFileName || 'Инвентаризация.' + payload.format, payload.format); },
    exportJson: async (json, name) => { if (typeof json !== 'string' || new TextEncoder().encode(json).byteLength > 32 * 1024 * 1024) throw Error('JSON превышает 32 МБ.'); return download(json, name || 'ТВС.json', 'application/json;charset=utf-8'); },
    exportPdf: async (html,defaultFileName) => {const result=await mutate('export-pdf',{html,defaultFileName});return result.ok?verifiedDownload(result,result.name,'pdf'):result;},
    importRar: () => nativeImport('rar','.rar'),
    importSvodkaPdf: () => nativeImport('svodka','.pdf,application/pdf'),
    importGlonassFile: () => nativeImport('glonass','.pdf,.xls,.xlsx'),
    addAttachment,
    openAttachment,
    archiveImportSource: payload => mutate('native-import',{action:'archiveSource',databaseToken:snapshotToken,source:encodedSource(payload)}),
    decodeRegistry: payload => mutate('native-import',{action:'registry',databaseToken:snapshotToken,source:encodedSource(payload)}),
    createBackupPackage: unsupported('Резервное копирование'),
    verifyBackupPackage: unsupported('Восстановление базы'),
    openDataFolder: unsupported('Папка базы находится на сервере'),
    chooseDataFolder: unsupported('Выбор папки базы'),
    chooseCertificate: unsupported('Изменение сертификатов'),
    saveSettings: unsupported('Изменение серверных настроек'),
    switchUser: unsupported('Переключение профиля: используйте выход и новый вход'),
    serverStart: unsupported('Управление сервером'),
    serverStop: unsupported('Управление сервером'),
    serverStatus: async () => ({ running: true, protocol: location.protocol, port: Number(location.port || (location.protocol === 'https:' ? 443 : 80)) }),
    serverPing: unsupported('Подключение к другому серверу'),
    openPdfEditor: async () => {window.open('/pdf-studio','_blank','noopener');return {ok:true,web:true};},
    openReestrWindow: unsupported('Отдельное окно реестра'),
    checkUpdate: async () => ({ available: false, web: true, message: 'Веб-приложение обновляет администратор сервера.' }),
    downloadUpdate: unsupported('Установка обновлений Windows'),
    installUpdate: unsupported('Установка обновлений Windows'),
  };
  window.tvsWeb = { active: true, connectionError, get latestSnapshot() { return latestSnapshot; } };
  window.electronAPI = Object.freeze(api);
  window.addEventListener('storage', event => { if (event.key === 'theme') themeListeners.forEach(listener => listener(event.newValue === 'light' ? 'light' : 'dark')); });
})();
