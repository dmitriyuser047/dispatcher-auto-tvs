const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('reestrAPI', {
  buildXlsx: (data) => ipcRenderer.invoke('reestr-build-xlsx', data),
  save:      (filename, xlsxBase64) => ipcRenderer.invoke('reestr-save-xlsx', { filename, xlsxBase64 }),
});

contextBridge.exposeInMainWorld('reestrWindow', {
  getData: () => ipcRenderer.invoke('reestr-window-data'),
  toRepair: (rowData) => ipcRenderer.send('reestr-to-repair', rowData),
});
