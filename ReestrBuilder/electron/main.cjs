const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");

let mainWindow;

function getUserConfigPath() {
  const userDir = app.getPath("userData");
  const userConfigPath = path.join(userDir, "config.json");
  if (!fs.existsSync(userConfigPath)) {
    const bundledConfigPath = path.join(__dirname, "..", "config.json");
    if (fs.existsSync(bundledConfigPath)) {
      fs.mkdirSync(userDir, { recursive: true });
      fs.copyFileSync(bundledConfigPath, userConfigPath);
    }
  }
  return userConfigPath;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 850,
    minWidth: 800,
    minHeight: 650,
    title: "Реестр-Билдер",
    backgroundColor: "#14161a",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "..", "build", "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, "..", "public", "index.html"));
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Шаг 1: разбор архива — возвращает массив распознанных строк (без генерации Excel)
ipcMain.handle("parse-invoices", async (event, zipArrayBuffer) => {
  const { parseInvoices, loadConfig } = await import("../lib.mjs");
  const config = loadConfig(getUserConfigPath());
  const log = [];
  const zipBuffer = Buffer.from(zipArrayBuffer);
  const rows = await parseInvoices(zipBuffer, config, (msg) => log.push(msg));
  return { log, rows, config };
});

// Шаг 1 (альт.): разбор отдельных PDF-файлов
ipcMain.handle("parse-pdfs", async (event, pdfFilesRaw) => {
  const { parsePdfFiles, loadConfig } = await import("../lib.mjs");
  const config = loadConfig(getUserConfigPath());
  const log = [];
  const pdfFiles = pdfFilesRaw.map(f => ({
    name: f.name,
    buffer: Buffer.from(f.buffer),
  }));
  const rows = await parsePdfFiles(pdfFiles, config, (msg) => log.push(msg));
  return { log, rows, config };
});

// Шаг 2: генерация Excel из отредактированных строк
ipcMain.handle("build-xlsx", async (event, { rows }) => {
  const { buildXlsxFromRows, loadConfig } = await import("../lib.mjs");
  const config = loadConfig(getUserConfigPath());
  const { buffer, total } = await buildXlsxFromRows(rows, config);
  return {
    filename: `Реестр_${new Date().toISOString().slice(0, 10)}.xlsx`,
    xlsxBase64: buffer.toString("base64"),
    total,
  };
});

// Загрузка справочника статей
ipcMain.handle("load-statyi", async () => {
  const statyiPath = path.join(__dirname, "..", "statyi.json");
  if (fs.existsSync(statyiPath)) {
    return JSON.parse(fs.readFileSync(statyiPath, "utf-8"));
  }
  return [];
});

ipcMain.handle("open-config", async () => {
  const configPath = getUserConfigPath();
  await shell.openPath(configPath);
  return { path: configPath };
});

ipcMain.handle("save-xlsx", async (event, { filename, xlsxBase64 }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Сохранить реестр",
    defaultPath: path.join(app.getPath("downloads"), filename),
    filters: [{ name: "Excel", extensions: ["xlsx"] }],
  });
  if (result.canceled || !result.filePath) return { saved: false };
  fs.writeFileSync(result.filePath, Buffer.from(xlsxBase64, "base64"));
  shell.showItemInFolder(result.filePath);
  return { saved: true, path: result.filePath };
});
