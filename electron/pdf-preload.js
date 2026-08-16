const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pdfEditor', {
  getData:  () => ipcRenderer.invoke('pdf-editor-data'),
  save:     (pdfBase64, filePath) => ipcRenderer.invoke('pdf-editor-save', { pdfBase64, filePath }),
  saveAs:   (pdfBase64) => ipcRenderer.invoke('pdf-editor-save-as', { pdfBase64 }),
});
