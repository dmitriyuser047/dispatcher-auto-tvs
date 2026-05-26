const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  readData:       ()        => ipcRenderer.invoke('read-data'),
  writeData:      (json)    => ipcRenderer.invoke('write-data', json),
  getDataPath:    ()        => ipcRenderer.invoke('get-data-path'),
  openDataFolder: ()        => ipcRenderer.invoke('open-data-folder'),

  // Обновления
  getAppVersion:  ()        => ipcRenderer.invoke('get-app-version'),
  checkUpdate:    ()        => ipcRenderer.invoke('check-update'),
  downloadUpdate: (url)     => ipcRenderer.invoke('download-update', url),
  installUpdate:  ()        => ipcRenderer.invoke('install-update'),
  onUpdateAvailable: (cb)   => ipcRenderer.on('update-available',  (_e, info) => cb(info)),
  onDownloadProgress: (cb)  => ipcRenderer.on('download-progress', (_e, pct)  => cb(pct)),
});
