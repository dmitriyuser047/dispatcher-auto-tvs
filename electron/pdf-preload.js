const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pdfEditor', {
  getData:      () => ipcRenderer.invoke('pdf-editor-data'),
  save:         (pdfBase64, filePath) => ipcRenderer.invoke('pdf-editor-save', { pdfBase64, filePath }),
  saveAs:       (pdfBase64) => ipcRenderer.invoke('pdf-editor-save-as', { pdfBase64 }),
  mergePdf:     () => ipcRenderer.invoke('pdf-editor-merge'),
  insertImage:  () => ipcRenderer.invoke('pdf-editor-insert-image'),
  ocr:          (imageBase64) => ipcRenderer.invoke('pdf-editor-ocr', { imageBase64 }),
});
