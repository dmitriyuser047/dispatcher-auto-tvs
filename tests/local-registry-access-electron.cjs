'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');

const root = path.resolve(process.env.TVS_APP_ROOT || path.join(__dirname, '..'));
assert.ok(fs.existsSync(path.join(root, 'electron/main.js')), 'TVS_APP_ROOT must identify the application source tree');
const fromRoot = createRequire(path.join(root, 'package.json'));
const storage = fromRoot('./electron/storage.js');
const sqlite = fromRoot('./electron/sqlite-storage.cjs');
const { observeDatabase } = fromRoot('./tests/helpers/native-database-observer.cjs');
let pw;
try { pw = fromRoot('playwright'); }
catch {
  const modules = process.env.TVS_PLAYWRIGHT_MODULES || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
  pw = createRequire(path.join(modules, 'package.json'))('playwright');
}

test('local Electron exposes its real admin grants, imports a registry through native IPC and retains it after restart', { timeout: 180000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tvs-local-registry-access-'));
  const owned = fs.lstatSync(directory);
  const profile = path.join(directory, 'profile');
  const dataDir = path.join(directory, 'sqlite');
  const filename = path.join(directory, 'SYNTHETIC-local-registry.xlsx');
  let app;
  const errors = [];
  const stop = async () => {
    if (!app) return;
    const current = app;
    app = null;
    await current.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(win => win.destroy())).catch(() => {});
    await current.close().catch(() => {});
  };
  t.after(async () => {
    await stop();
    const resolved = path.resolve(directory), actual = fs.lstatSync(resolved);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.match(path.basename(resolved), /^tvs-local-registry-access-/);
    assert.equal(actual.isSymbolicLink(), false);
    assert.equal(actual.dev, owned.dev);
    assert.equal(actual.ino, owned.ino);
    fs.rmSync(resolved, { recursive: true, force: true });
  });

  fs.mkdirSync(profile);
  const database = Object.fromEntries(storage.SECTIONS.map(name => [name, []]));
  database.vehicles = [{ id: 0, plate: 'SYNTHETIC-LOCAL-0', make: 'Synthetic registry vehicle', org: 'Synthetic organization' }];
  database.fuelCards = [{ id: 'synthetic-cash', number: 'НАЛИЧКА', provider: 'Наличка', assignments: [] }];
  database.appMeta = [{ id: 'meta', toPlanInit: 'synthetic' }];
  sqlite.create(dataDir, { data: database });
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
    users: [{ name: 'Synthetic local registry', dataDir }], activeUser: 0,
    networkMode: 'local', networkKey: 'synthetic-local-registry-key-not-a-secret',
    serverPort: 3377, remotePort: 3377, remoteHost: '127.0.0.1',
  }));

  const ExcelJS = fromRoot('exceljs'), workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Реестр');
  sheet.addRows([
    ['Реестр 88 от 01.11.2026'],
    ['№', 'Сумма, руб.', 'Контрагент', 'Назначение платежа', 'ОСНОВАНИЕ'],
    [1, 100.1, 'Synthetic registry supplier', 'Synthetic service for SYNTHETIC-LOCAL-0', 'Счёт №LOCAL-001 от 01.11.2026'],
    ['', 100.1, 'ВСЕГО по организации'],
  ]);
  await workbook.xlsx.writeFile(filename);
  const original = fs.readFileSync(filename), sourceHash = crypto.createHash('sha256').update(original).digest('hex');

  const bootstrap = path.join(directory, 'bootstrap.cjs');
  fs.writeFileSync(bootstrap, `const Module=require('node:module'),original=Module._load,electron=original('electron',module,false);const HiddenWindow=new Proxy(electron.BrowserWindow,{construct(Target,args){const win=new Target({...args[0],show:false});win.show=()=>{};win.showInactive=()=>{};return win;}});Module._load=function(request,parent,isMain){if(request==='electron')return {...electron,BrowserWindow:HiddenWindow};return original.apply(this,arguments);};electron.app.setAppPath(${JSON.stringify(root)});require(${JSON.stringify(path.join(root, 'electron/main.js'))});`);
  async function launch() {
    const packaged = process.env.TVS_PACKAGED_EXE;
    app = await pw._electron.launch({
      executablePath: packaged || fromRoot('electron'),
      args: [...(packaged ? [] : [bootstrap]), '--user-data-dir=' + profile, '--tvs-test-hidden'],
      cwd: root,
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(30000);
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof data !== 'undefined' && data.vehicles?.some(row => row.plate === 'SYNTHETIC-LOCAL-0') && typeof desktopWebFeatures !== 'undefined');
    assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(win => win.isVisible())), false);
    await page.evaluate(async () => {
      localStorage.setItem('changelogSeenVersion', await electronAPI.getAppVersion());
      if (document.getElementById('genericModal')) closeModal('genericModal');
      await desktopWebFeatures.ensure();
    });
    return page;
  }

  let page = await launch();
  const proof = await page.evaluate(async () => {
    const snapshot = JSON.parse(await electronAPI.readSnapshot({ hello: PlatformCompatibility.describe().hello }));
    const cache = await electronAPI.getDataCacheContext();
    return { access: snapshot.access, cache, token: snapshot.databaseToken,
      writeCompatible: snapshot.platform.negotiation.writeCompatible,
      loadedAccess: _sync.access, loadedWriteCompatible: _sync.platform.negotiation.writeCompatible,
      blocked: _loadWriteBlocked };
  });
  assert.equal(proof.access?.user.id, 'local-profile');
  assert.equal(proof.access?.user.role, 'admin');
  assert.ok(proof.access.writable.includes('savedReestrs'));
  assert.ok(proof.access.writable.includes('contragents'));
  assert.equal(proof.cache.mode, 'local');
  assert.equal(proof.cache.databaseToken, proof.token);
  assert.equal(proof.cache.access?.user.role, 'admin');
  assert.ok(proof.cache.access.writable.includes('savedReestrs'));
  assert.equal(proof.cache.policyStamp, proof.access.policyStamp);
  assert.equal(proof.loadedAccess?.policyStamp, proof.access.policyStamp);
  assert.equal(proof.writeCompatible, true);
  assert.equal(proof.loadedWriteCompatible, true);
  assert.equal(proof.blocked, false);

  await page.evaluate(() => switchSection('registries'));
  await page.locator('[data-registry-pick]').waitFor();
  assert.equal(await page.locator('[data-registry-pick]').isEnabled(), true);
  assert.doesNotMatch(await page.locator('[data-registry-status]').innerText(), /недоступно изменение реестров|не подтвердила совместимость/i);
  const before = await observeDatabase(() => storage.readSnapshot(dataDir));
  await page.locator('[data-registry-file]').setInputFiles(filename);
  await page.locator('[data-registry-editor]').waitFor();
  assert.equal(await page.locator('[data-registry-invoice]').count(), 1);
  assert.equal(await page.locator('[data-invoice-field="supplier"]').inputValue(), 'Synthetic registry supplier');
  assert.equal(await page.locator('[data-allocation-kind]').inputValue(), 'vehicle');
  assert.equal(await page.locator('[data-allocation-asset]').inputValue(), '["number",0]');
  assert.deepEqual((await observeDatabase(() => storage.readSnapshot(dataDir))).data, before.data, 'A decoded preview must not commit registry rows or counterparties');

  const editor = page.locator('[data-registry-editor]');
  await editor.locator('[name=number]').fill('SYNTHETIC-LOCAL-88');
  await editor.locator('[name=date]').fill('2026-11-01');
  await editor.locator('[name=reason]').fill('Synthetic reviewed local registry import');
  await editor.locator('[name=confirmed]').check();
  assert.equal(await editor.locator('button[type=submit]').isEnabled(), true);
  await editor.locator('button[type=submit]').click();
  await page.waitForFunction(() => !document.querySelector('[data-registry-editor]') && data.savedReestrs.some(row => row.number === 'SYNTHETIC-LOCAL-88') || !!document.querySelector('[data-registry-save-error]')?.textContent.trim());
  assert.equal(await editor.count(), 0, await page.evaluate(() => document.querySelector('[data-registry-save-error]')?.textContent || 'The registry was not committed'));

  const saved = await observeDatabase(() => storage.readSnapshot(dataDir));
  assert.equal(saved.data.savedReestrs.length, 1);
  const entry = saved.data.savedReestrs[0];
  assert.equal(entry.source.sha256, sourceHash);
  assert.equal(entry.totalSum, 100.1);
  assert.equal(entry.rows[0].vehicleId, 0);
  assert.equal(entry.rows[0].invoiceNo, 'LOCAL-001');
  assert.equal(saved.data.contragents.length, 1);
  assert.equal(saved.data.contragents[0].name, 'Synthetic registry supplier');
  assert.deepEqual(saved.data.vehicles, before.data.vehicles);
  assert.deepEqual(saved.data.payments, before.data.payments);
  assert.deepEqual(fs.readFileSync(path.join(dataDir, 'import-sources', entry.source.id)), original);

  await stop();
  page = await launch();
  await page.evaluate(() => switchSection('registries'));
  await page.locator('[data-registry-pick]').waitFor();
  assert.equal(await page.locator('[data-registry-pick]').isEnabled(), true);
  assert.match(await page.locator('.registry-page').innerText(), /SYNTHETIC-LOCAL-88/);
  assert.equal(await page.evaluate(() => data.savedReestrs[0].rows[0].vehicleId), 0);
  assert.deepEqual((await observeDatabase(() => storage.readSnapshot(dataDir))).data.savedReestrs, saved.data.savedReestrs);
  assert.deepEqual(errors, []);
});
