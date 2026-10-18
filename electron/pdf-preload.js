const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pdfEditor', {
  getTheme:     () => ipcRenderer.invoke('get-theme'),
  setTheme:     theme => ipcRenderer.invoke('set-theme', theme),
  onThemeChanged: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, theme) => callback(theme);
    ipcRenderer.on('workspace-theme-changed', listener);
    return () => ipcRenderer.removeListener('workspace-theme-changed', listener);
  },
  getData:      () => ipcRenderer.invoke('pdf-editor-data'),
  openFile:     () => ipcRenderer.invoke('pdf-editor-open'),
  commitOpen:   (token) => ipcRenderer.invoke('pdf-editor-commit-open', token),
  cancelOpen:   (token) => ipcRenderer.invoke('pdf-editor-cancel-open', token),
  getFont:      (style = 'regular') => ipcRenderer.invoke('pdf-editor-font', style),
  save:         (pdfBase64, filePath) => ipcRenderer.invoke('pdf-editor-save', { pdfBase64, filePath }),
  saveAs:       (pdfBase64) => ipcRenderer.invoke('pdf-editor-save-as', { pdfBase64 }),
  mergePdf:     () => ipcRenderer.invoke('pdf-editor-merge'),
  insertImage:  () => ipcRenderer.invoke('pdf-editor-insert-image'),
  ocr:          (imageBase64, options = {}) => ipcRenderer.invoke('pdf-editor-ocr', { imageBase64, options }),
  ocrInfo:      () => ipcRenderer.invoke('pdf-editor-ocr-info'),
  processContent: (payload) => ipcRenderer.invoke('pdf-editor-process-content', payload),
  adoptProject: (payload) => ipcRenderer.invoke('pdf-editor-adopt-project', payload),
  exportDocument: (payload) => ipcRenderer.invoke('pdf-studio-export', payload),
  saveProject: (payload) => ipcRenderer.invoke('pdf-studio-save-project', payload),
  openProject: () => ipcRenderer.invoke('pdf-studio-open-project'),
  autosave: (payload) => ipcRenderer.invoke('pdf-studio-autosave', payload),
  recoveryList: () => ipcRenderer.invoke('pdf-studio-recovery-list'),
  recoveryOpen: (id) => ipcRenderer.invoke('pdf-studio-recovery-open', { id }),
  recoveryDelete: (id) => ipcRenderer.invoke('pdf-studio-recovery-delete', { id }),
  compareFile: () => ipcRenderer.invoke('pdf-studio-compare-file'),
  exportPages: (payload) => ipcRenderer.invoke('pdf-studio-export-pages', payload),
  onOcrProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('pdf-editor-ocr-progress', listener);
    return () => ipcRenderer.removeListener('pdf-editor-ocr-progress', listener);
  },
});
