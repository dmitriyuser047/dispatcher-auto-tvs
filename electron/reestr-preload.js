const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('reestrAPI', {
  buildXlsx: (data) => ipcRenderer.invoke('reestr-build-xlsx', data),
  save:      (filename, xlsxBase64) => ipcRenderer.invoke('reestr-save-xlsx', { filename, xlsxBase64 }),
  learn:     (rows) => ipcRenderer.invoke('reestr-learn', rows),
  analytics: (rows) => ipcRenderer.invoke('reestr-analytics', rows),
});

contextBridge.exposeInMainWorld('reestrWindow', {
  getTheme: () => ipcRenderer.invoke('get-theme'),
  setTheme: (theme) => ipcRenderer.invoke('set-theme', theme),
  onThemeChanged: (cb) => ipcRenderer.on('workspace-theme-changed', (_event, theme) => cb(theme)),
  getData: () => ipcRenderer.invoke('reestr-window-data'),
  toRepair: (rowData) => ipcRenderer.send('reestr-to-repair', rowData),
  saveRows: (rows) => ipcRenderer.invoke('reestr-save-rows', rows),
});
