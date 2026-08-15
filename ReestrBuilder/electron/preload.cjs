const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("reestrAPI", {
  parseInvoices: (arrayBuffer) => ipcRenderer.invoke("parse-invoices", arrayBuffer),
  parsePdfs: (pdfFiles) => ipcRenderer.invoke("parse-pdfs", pdfFiles),
  buildXlsx: (data) => ipcRenderer.invoke("build-xlsx", data),
  loadStatyi: () => ipcRenderer.invoke("load-statyi"),
  openConfig: () => ipcRenderer.invoke("open-config"),
  save: (filename, xlsxBase64) => ipcRenderer.invoke("save-xlsx", { filename, xlsxBase64 }),
});
