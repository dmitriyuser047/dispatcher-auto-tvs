const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const http = require('node:http');
const storage = require('../electron/storage');
const root = path.resolve(__dirname, '..');
let pw;
try { pw = require('playwright'); }
catch {
  const modules = process.env.TVS_PLAYWRIGHT_MODULES || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
  pw = createRequire(path.join(modules, 'package.json'))('playwright');
}
async function freePort() {
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}

test('Electron opens every section, writes the chosen database, switches the server and edits isolated PDFs', { timeout: 120000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tvs-electron-test-'));
  let app;
  t.after(async () => {
    await app?.close();
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('tvs-electron-test-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const profile = path.join(dir, 'profile'), dataA = path.join(dir, 'A'), dataB = path.join(dir, 'B');
  fs.mkdirSync(profile);
  const fixture = id => ({ vehicles: [{ id, make: 'Test', plate: id, driver: 'Driver', org: 'A', norm: 10, fuelGrade: 'ДТ' }], records: [], appMeta: [{ id: 'meta', toPlanInit: 'smoke' }] });
  storage.writeAll(dataA, fixture('A')); storage.writeAll(dataB, fixture('B'));
  const port = await freePort();
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ users: [{ name: 'A', dataDir: dataA }, { name: 'B', dataDir: dataB }], activeUser: 0, networkMode: 'local', serverPort: port, remotePort: port, remoteHost: '127.0.0.1', networkKey: 'smoke-key-not-a-real-secret-1234' }));
  const bootstrap = path.join(dir, 'bootstrap.cjs');
  fs.writeFileSync(bootstrap, `const {app}=require('electron'); app.setPath('userData',${JSON.stringify(profile)}); app.setAppPath(${JSON.stringify(root)}); require(${JSON.stringify(path.join(root, 'electron/main.js'))});`);
  app = await pw._electron.launch({ executablePath: process.env.TVS_PACKAGED_EXE || require('electron'), args: process.env.TVS_PACKAGED_EXE ? ['--user-data-dir=' + profile] : [bootstrap], cwd: root });
  const page = await app.firstWindow(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(win => win.hide()));
  await page.waitForFunction(() => typeof data !== 'undefined' && data.vehicles[0]?.id === 'A');
  const initial = await page.evaluate(async () => {
    const version = await window.electronAPI.getAppVersion();
    for (const section of ['home', 'vehicles', 'generators', 'tanks', 'reestr', 'toSchedule', 'repairs', 'finances', 'contragents', 'reports', 'printForms', 'fuelReport', 'fuelPurchases']) switchSection(section);
    data.vehicles[0].driver = 'Saved from Electron';
    const saved = await saveData(data);
    const health = await window.electronAPI.databaseHealth();
    const register = await window.reestrAPI.buildXlsx({ rows: [{ date: '18.10.2026', sum: 123, description: 'Smoke invoice', osn: '42' }] });
    return { version, saved, total: health.counts.vehicles, xlsx: register.xlsxBase64.length > 100 };
  });
  assert.equal(initial.saved, true); assert.equal(initial.total, 1);
  assert.equal(initial.xlsx, true);
  if (process.env.TVS_PACKAGED_EXE) assert.equal(initial.version, require('../package.json').version);
  assert.equal(storage.readAll(dataA).vehicles[0].driver, 'Saved from Electron');
  const forbidden = await page.evaluate(async () => (await fetch('/bundled-data/data-2.0.57.json')).status);
  assert.equal(forbidden, 403);
  await page.evaluate(() => window.electronAPI.setTheme('dark'));
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  const openingRegister = app.waitForEvent('window');
  await page.evaluate(() => window.electronAPI.openReestrWindow({ rows: [], log: [], statyi: [], contracts: [], vehicles: data.vehicles }));
  const register = await openingRegister;
  await register.waitForFunction(() => typeof rows !== 'undefined');
  await register.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  const registerResult = await register.evaluate(() => window.reestrWindow.saveRows([{ date: '18.10.2026', sum: 123, description: 'Saved invoice' }]));
  assert.equal(registerResult.ok, true);
  assert.equal(storage.readAll(dataA).reestrRows[0].sum, 123);
  await page.evaluate(async () => {
    const settings = await window.electronAPI.getSettings(); settings.networkMode = 'server';
    await window.electronAPI.saveSettings(settings);
    const result = await window.electronAPI.switchUser(1); if (!result.ok) throw Error('Switch failed');
    data = await loadData(); rebuildIndex();
  });
  const remoteData = await new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: '/api/data', headers: { Authorization: 'Bearer smoke-key-not-a-real-secret-1234' } }, res => {
      let raw = ''; res.setEncoding('utf8'); res.on('data', value => { raw += value; }); res.on('end', () => resolve(JSON.parse(raw)));
    }).on('error', reject);
  });
  assert.equal(remoteData.vehicles[0].id, 'B');
  assert.equal((await register.evaluate(() => window.reestrWindow.saveRows([]))).ok, false);
  const { PDFDocument, StandardFonts } = require('pdf-lib');
  const pdfs = [];
  for (const text of ['First PDF', 'Second PDF']) {
    const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage().drawText(text, { x: 50, y: 700, font });
    const file = path.join(dir, text + '.pdf'); fs.writeFileSync(file, await doc.save()); pdfs.push(file);
  }
  await app.evaluate(({ dialog }, pdfs) => { let i = 0; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [pdfs[i++]] }); }, pdfs);
  const editors = [];
  for (let i = 0; i < 2; i++) {
    const waiting = app.waitForEvent('window');
    await page.evaluate(() => window.electronAPI.openPdfEditor());
    const editor = await waiting; editors.push(editor);
    editor.on('pageerror', error => errors.push(error.message));
    await editor.waitForFunction(() => typeof pdfDoc !== 'undefined' && pdfDoc?.numPages === 1);
    await editor.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await editor.waitForFunction(() => document.querySelector('#pagesPanel canvas'));
  }
  assert.equal(await editors[0].evaluate(async () => (await window.pdfEditor.getData()).fileName), 'First PDF.pdf');
  assert.equal(await editors[1].evaluate(async () => (await window.pdfEditor.getData()).fileName), 'Second PDF.pdf');
  const savedPdf = await editors[0].evaluate(async () => {
    const base64 = await buildEditedPdf(); return window.pdfEditor.save(base64, filePath);
  });
  assert.equal(savedPdf.saved, true);
  assert.equal((await PDFDocument.load(fs.readFileSync(pdfs[0]))).getPageCount(), 1);
  const denied = await editors[0].evaluate(async () => {
    try { await window.pdfEditor.save(btoa('bad'), filePath + '.unapproved'); return false; }
    catch { return true; }
  });
  assert.equal(denied, true);
  await page.evaluate(() => window.electronAPI.setTheme('light'));
  for (const child of [register, ...editors]) await child.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8')).uiTheme, 'light');
  assert.deepEqual(errors, []);
});
