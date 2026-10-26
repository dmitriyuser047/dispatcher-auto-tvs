const { contextBridge, ipcRenderer } = require('electron');

async function invokeOperation(channel,json){
  try{
    const payload=typeof json==='string'?JSON.parse(json):json,operation=payload&&Object.getOwnPropertyDescriptor(payload,'operation')?.value,id=operation&&Object.getOwnPropertyDescriptor(operation,'id')?.value;
    if(typeof id==='string'&&/^[a-zA-Z0-9._:-]{1,200}$/.test(id)){
      let timer;try{await Promise.race([ipcRenderer.invoke('operation-phase',{phase:'ui-prepared',operationId:id}),new Promise(resolve=>{timer=setTimeout(resolve,250);})]);}finally{if(timer!==undefined)clearTimeout(timer);}
    }
  }catch{}
  return ipcRenderer.invoke(channel,json);
}

contextBridge.exposeInMainWorld('electronAPI', {
  readData:       ()        => ipcRenderer.invoke('read-data'),
  writeData:      (json)    => ipcRenderer.invoke('write-data', json),
  readSnapshot:   payload   => ipcRenderer.invoke('read-snapshot',payload),
  getRevisions:   ()        => ipcRenderer.invoke('get-revisions'),
  readSection:    (name)    => ipcRenderer.invoke('read-section', name),
  queryRows:      (query)   => ipcRenderer.invoke('query-rows', query),
  queryHistory:   query     => ipcRenderer.invoke('query-history',query),
  documentPrint:  payload   => ipcRenderer.invoke('document-print', payload),
  importSource:   payload   => ipcRenderer.invoke('import-source', payload),
  assetInventoryExport:payload=>ipcRenderer.invoke('asset-inventory-export',payload),
  inventoryDatabase:payload=>ipcRenderer.invoke('inventory-database',payload),
  writeSections:  (json)    => invokeOperation('write-sections', json),
  executeCommand:(json)    => invokeOperation('execute-command', json),
  getOperationDiagnostics:query=>ipcRenderer.invoke('get-operation-diagnostics',query),
  exportOperationSupport:()=>ipcRenderer.invoke('export-operation-support'),
  getPendingOperations:()=>ipcRenderer.invoke('get-pending-operations'),
  reconcileOperation:id=>ipcRenderer.invoke('reconcile-operation',id),
  retryOperation:id=>ipcRenderer.invoke('retry-operation',id),
  discardOperation:id=>ipcRenderer.invoke('discard-operation',id),
  finishClose:payload=>ipcRenderer.invoke('finish-close',payload),
  onPrepareClose:callback=>{
    const listener=(_event,nonce)=>callback(nonce);ipcRenderer.on('prepare-close',listener);
    return ()=>ipcRenderer.removeListener('prepare-close',listener);
  },
  getDataPath:    ()        => ipcRenderer.invoke('get-data-path'),
  getDataIdentity:()        => ipcRenderer.invoke('get-data-identity'),
  getDataCacheContext:()    => ipcRenderer.invoke('get-data-cache-context'),
  getDataHealth:  ()        => ipcRenderer.invoke('get-data-health'),
  inspectSchemaUpgrade:payload=>ipcRenderer.invoke('inspect-schema-upgrade',payload),
  upgradeSchemaCopy:payload=>ipcRenderer.invoke('upgrade-schema-copy',payload),
  databaseMaintenance:payload=>ipcRenderer.invoke('database-maintenance',payload),
  chooseMaintenanceBackup:()=>ipcRenderer.invoke('choose-maintenance-backup'),
  addAttachment:  origin    => ipcRenderer.invoke('add-attachment',origin),
  openAttachment: origin    => ipcRenderer.invoke('open-attachment',origin),
  archiveImportSource:(payload) => ipcRenderer.invoke('archive-import-source',payload),
  createBackupPackage:()=>ipcRenderer.invoke('create-backup-package'),
  verifyBackupPackage:()=>ipcRenderer.invoke('verify-backup-package'),
  openDataFolder: ()        => ipcRenderer.invoke('open-data-folder'),
  exportPdf:      (html, defaultFileName) => ipcRenderer.invoke('export-pdf', { html, defaultFileName }),
  importRar:      ()        => ipcRenderer.invoke('import-rar'),
  exportJson:     (jsonStr, defaultFileName) => ipcRenderer.invoke('export-json', jsonStr, defaultFileName),
  importJsonFile: ()        => ipcRenderer.invoke('import-json-file'),

  // Настройки / пользователи
  getSettings:       ()          => ipcRenderer.invoke('get-settings'),
  getAccessCatalog:  ()          => ipcRenderer.invoke('get-access-catalog'),
  getTheme:          ()          => ipcRenderer.invoke('get-theme'),
  setTheme:          (theme)     => ipcRenderer.invoke('set-theme', theme),
  onThemeChanged:    (cb)        => ipcRenderer.on('workspace-theme-changed', (_event, theme) => cb(theme)),
  saveSettings:      (s)         => ipcRenderer.invoke('save-settings', s),
  switchUser:        (idx)       => ipcRenderer.invoke('switch-user', idx),
  chooseDataFolder:  ()          => ipcRenderer.invoke('choose-data-folder'),
  chooseCertificate:()=>ipcRenderer.invoke('choose-certificate'),
  getNotificationSettings:()=>ipcRenderer.invoke('get-notification-settings'),
  saveNotificationSettings:payload=>ipcRenderer.invoke('save-notification-settings',payload),
  snoozeNotifications:payload=>ipcRenderer.invoke('snooze-notifications',payload),
  submitNotifications:payload=>ipcRenderer.invoke('submit-notifications',payload),
  testNotification:payload=>ipcRenderer.invoke('test-notification',payload),
  onNotificationOpen:cb=>{
    const listener=(_event,target)=>cb(target);
    ipcRenderer.on('notification-open',listener);
    return ()=>ipcRenderer.removeListener('notification-open',listener);
  },

  // Окно реестра
  openReestrWindow: (data) => ipcRenderer.invoke('open-reestr-window', data),
  openPdfEditor: () => ipcRenderer.invoke('open-pdf-editor'),

  // Сетевой сервер
  serverStart:   ()              => ipcRenderer.invoke('server-start'),
  serverStop:    ()              => ipcRenderer.invoke('server-stop'),
  serverStatus:  ()              => ipcRenderer.invoke('server-status'),
  serverPing:    (host, port)    => ipcRenderer.invoke('server-ping', host, port),

  // Обновления
  getAppVersion:  ()        => ipcRenderer.invoke('get-app-version'),
  getChangelog:   ()        => ipcRenderer.invoke('get-changelog'),
  checkUpdate:    ()        => ipcRenderer.invoke('check-update'),
  downloadUpdate: (url)     => ipcRenderer.invoke('download-update', url),
  installUpdate:  ()        => ipcRenderer.invoke('install-update'),
  onUpdateAvailable: (cb)   => ipcRenderer.on('update-available',  (_e, info) => cb(info)),
  onDownloadProgress: (cb)  => ipcRenderer.on('download-progress', (_e, pct)  => cb(pct)),
  onReestrRowsSaved: (cb)   => ipcRenderer.on('reestr-rows-saved', (_e, rows) => cb(rows)),
  importSvodkaPdf:   ()     => ipcRenderer.invoke('import-svodka-pdf'),
  importGlonassFile: ()     => ipcRenderer.invoke('import-glonass-file'),
});

contextBridge.exposeInMainWorld('reestrAPI', {
  parseInvoices: (arrayBuffer) => ipcRenderer.invoke('reestr-parse-invoices', arrayBuffer),
  parsePdfs:     (pdfFiles)    => ipcRenderer.invoke('reestr-parse-pdfs', pdfFiles),
  buildXlsx:     (data)        => ipcRenderer.invoke('reestr-build-xlsx', data),
  loadStatyi:    ()            => ipcRenderer.invoke('reestr-load-statyi'),
  loadContracts: ()            => ipcRenderer.invoke('reestr-load-contracts'),
  save:          (filename, xlsxBase64) => ipcRenderer.invoke('reestr-save-xlsx', { filename, xlsxBase64 }),
  learn:         (rows)        => ipcRenderer.invoke('reestr-learn', rows),
  applyKnowledge:(rows)        => ipcRenderer.invoke('reestr-apply-knowledge', rows),
  analytics:     (rows)        => ipcRenderer.invoke('reestr-analytics', rows),
  onProgress:    (cb)          => ipcRenderer.on('reestr-progress', (_e, p) => cb(p)),
  onOcrPage:     (cb)          => ipcRenderer.on('reestr-ocr-page', (_e, p) => cb(p)),
  offProgress:   ()            => { ipcRenderer.removeAllListeners('reestr-progress'); ipcRenderer.removeAllListeners('reestr-ocr-page'); },
});
