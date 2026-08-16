const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  readData:       ()        => ipcRenderer.invoke('read-data'),
  writeData:      (json)    => ipcRenderer.invoke('write-data', json),
  getDataPath:    ()        => ipcRenderer.invoke('get-data-path'),
  openDataFolder: ()        => ipcRenderer.invoke('open-data-folder'),
  exportPdf:      (html, defaultFileName) => ipcRenderer.invoke('export-pdf', { html, defaultFileName }),
  importRar:      ()        => ipcRenderer.invoke('import-rar'),
  exportJson:     (jsonStr, defaultFileName) => ipcRenderer.invoke('export-json', jsonStr, defaultFileName),
  importJsonFile: ()        => ipcRenderer.invoke('import-json-file'),

  // Настройки / пользователи
  getSettings:       ()          => ipcRenderer.invoke('get-settings'),
  saveSettings:      (s)         => ipcRenderer.invoke('save-settings', s),
  switchUser:        (idx)       => ipcRenderer.invoke('switch-user', idx),
  chooseDataFolder:  ()          => ipcRenderer.invoke('choose-data-folder'),

  // Сетевой сервер
  serverStart:   ()              => ipcRenderer.invoke('server-start'),
  serverStop:    ()              => ipcRenderer.invoke('server-stop'),
  serverStatus:  ()              => ipcRenderer.invoke('server-status'),
  serverPing:    (host, port)    => ipcRenderer.invoke('server-ping', host, port),

  // Обновления
  getAppVersion:  ()        => ipcRenderer.invoke('get-app-version'),
  checkUpdate:    ()        => ipcRenderer.invoke('check-update'),
  downloadUpdate: (url)     => ipcRenderer.invoke('download-update', url),
  installUpdate:  ()        => ipcRenderer.invoke('install-update'),
  onUpdateAvailable: (cb)   => ipcRenderer.on('update-available',  (_e, info) => cb(info)),
  onDownloadProgress: (cb)  => ipcRenderer.on('download-progress', (_e, pct)  => cb(pct)),
});

contextBridge.exposeInMainWorld('reestrAPI', {
  parseInvoices: (arrayBuffer) => ipcRenderer.invoke('reestr-parse-invoices', arrayBuffer),
  parsePdfs:     (pdfFiles)    => ipcRenderer.invoke('reestr-parse-pdfs', pdfFiles),
  buildXlsx:     (data)        => ipcRenderer.invoke('reestr-build-xlsx', data),
  loadStatyi:    ()            => ipcRenderer.invoke('reestr-load-statyi'),
  save:          (filename, xlsxBase64) => ipcRenderer.invoke('reestr-save-xlsx', { filename, xlsxBase64 }),
  onProgress:    (cb)          => ipcRenderer.on('reestr-progress', (_e, p) => cb(p)),
  offProgress:   ()            => ipcRenderer.removeAllListeners('reestr-progress'),
});
