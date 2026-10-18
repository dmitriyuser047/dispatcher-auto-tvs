const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const { validateSettings, databaseIdentity, writeAtomic } = require('../electron/settings');
const { staticFile, trustedPage, canInvoke } = require('../electron/security');
const { inspectData } = require('../electron/database-health');
const storage = require('../electron/storage');
const root = path.resolve(__dirname, '..');
const settings = () => ({ users: [{ name: 'A', dataDir: path.join(os.tmpdir(), 'tvs-A') }, { name: 'B', dataDir: path.join(os.tmpdir(), 'tvs-B') }], activeUser: 0, networkMode: 'local', serverPort: 3377, remotePort: 3377, remoteHost: '', networkKey: 'not-a-real-secret-network-key' });
function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tvs-v3-test-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('tvs-v3-test-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

test('invalid ports, hosts, profiles and network keys cannot replace settings', () => {
  for (const port of [0, -1, 65536, 3377.5, NaN, '3377']) assert.throws(() => validateSettings({ ...settings(), serverPort: port }));
  for (const remoteHost of ['http://127.0.0.1', 'host/path', 'host user', 'user@host']) assert.throws(() => validateSettings({ ...settings(), remoteHost }));
  assert.throws(() => validateSettings({ ...settings(), activeUser: 3 }));
  assert.throws(() => validateSettings({ ...settings(), networkKey: '' }));
  assert.deepEqual(validateSettings(settings()), settings());
});

test('offline cache identity separates profiles, servers and keys but survives local/server mode changes', () => {
  const base = settings(), id = databaseIdentity(base);
  assert.notEqual(databaseIdentity({ ...base, activeUser: 1 }), id);
  assert.equal(databaseIdentity({ ...base, networkMode: 'server' }), id);
  const remote = { ...base, networkMode: 'client', remoteHost: 'server' };
  assert.notEqual(databaseIdentity(remote), id);
  assert.notEqual(databaseIdentity(remote), databaseIdentity({ ...remote, remoteHost: 'other' }));
  assert.notEqual(databaseIdentity(remote), databaseIdentity({ ...remote, networkKey: 'different-network-key' }));
});

test('atomic settings files contain complete UTF-8 JSON and no temporary files', t => {
  const dir = temporary(t), file = path.join(dir, 'nested', 'settings.json');
  writeAtomic(file, JSON.stringify({ name: 'Уренгой Ёж' }));
  writeAtomic(file, JSON.stringify({ name: 'ТВС' }));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { name: 'ТВС' });
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['settings.json']);
});

test('UI server cannot expose application source, bundled databases or escaped paths', () => {
  assert.equal(staticFile(root, '/'), path.join(root, 'index.html'));
  assert.equal(staticFile(root, '/assets/js/01-core.js?v=3'), path.join(root, 'assets/js/01-core.js'));
  for (const url of ['/electron/main.js', '/bundled-data/data-2.0.57.json', '/package.json', '/.git/config', '/assets/../electron/main.js', '/assets/%2e%2e/%2e%2e/secret', '/assets/%00', '/%xx']) assert.equal(staticFile(root, url), null, url);
});

test('IPC permissions are limited to each trusted entry page', () => {
  assert.equal(trustedPage('http://127.0.0.1:123/index.html', root, 123), 'main');
  for (const url of ['https://evil.invalid/index.html', 'http://127.0.0.1:124/index.html', 'http://127.0.0.1:123/assets/view.html']) assert.equal(trustedPage(url, root, 123), null);
  assert.equal(trustedPage(pathToFileURL(path.join(root, 'pdf-editor.html')).href, root, 123), 'pdf');
  assert.equal(canInvoke('pdf', 'write-data'), false);
  assert.equal(canInvoke('pdf', 'pdf-editor-save'), true);
  assert.equal(canInvoke('reestr', 'install-update'), false);
  assert.equal(canInvoke('main', 'pdf-editor-save'), false);
});

test('health inspection detects duplicate IDs and orphan links without changing data', () => {
  const db = { vehicles: [{ id: 'v' }, { id: 'v' }], records: [{ id: 'r', vehicleId: 'missing' }] };
  const before = JSON.stringify(db), health = inspectData(db);
  assert.equal(health.total, 3);
  assert.deepEqual(health.issues.map(issue => issue.code), ['duplicate-id', 'missing-parent']);
  assert.equal(JSON.stringify(db), before);
});

test('malformed rows are rejected before migrating or writing the working database', t => {
  const dir = temporary(t), db = { vehicles: [{ id: 'v' }], records: [] };
  storage.writeAll(dir, db);
  assert.throws(() => storage.writeSections(dir, { base: storage.readRevisions(dir), sections: { records: [null] } }), /массив объектов/);
  assert.equal(storage.readAll(dir).vehicles[0].id, 'v');
});

test('manual backups preserve all sections and are independent of the daily backup', t => {
  const dir = temporary(t), db = { vehicles: [{ id: 'v' }], records: [] };
  storage.writeAll(dir, db);
  const backup = path.join(dir, 'backups');
  storage.makeDailyBackup(dir, backup);
  const first = storage.makeManualBackup(dir, backup), second = storage.makeManualBackup(dir, backup);
  assert.notEqual(first, second);
  assert.deepEqual(JSON.parse(fs.readFileSync(first, 'utf8')), storage.readAll(dir));
  assert.equal(fs.readdirSync(backup).length, 3);
});

test('archive paths cannot escape through traversal, Windows drives, ADS or device names', async () => {
  const { safeArchivePath, checkArchiveSize, MAX_FILE_BYTES } = await import('../ReestrBuilder/archive-safety.mjs');
  const dir = path.join(os.tmpdir(), 'archive-root');
  assert.equal(safeArchivePath(dir, 'счета/счёт.pdf'), path.join(dir, 'счета', 'счёт.pdf'));
  for (const name of ['../secret', '..\\secret', '/etc/file', 'C:\\secret', 'folder/name:stream', 'NUL.pdf', 'foo/.. /file']) assert.throws(() => safeArchivePath(dir, name), undefined, name);
  assert.throws(() => checkArchiveSize([MAX_FILE_BYTES + 1]));
  assert.throws(() => checkArchiveSize(Array(2001).fill(1)));
  assert.doesNotThrow(() => checkArchiveSize([1024, 2048]));
});

function updaterFixture(payload, override = {}) {
  let requests = 0;
  const url = 'https://github.com/dmitriyuser047/dispatcher-auto-tvs/releases/download/v3.0.1/Dispatcher-Setup-3.0.1.exe';
  const manifest = { version: '3.0.1', url, sha256: crypto.createHash('sha256').update(payload).digest('hex'), size: payload.length, ...override };
  const fakeHttps = { get(target, _options, callback) {
    const req = new EventEmitter(); req.destroy = error => req.emit('error', error);
    process.nextTick(() => {
      requests++;
      const isManifest = target.hostname === 'raw.githubusercontent.com';
      const body = isManifest ? Buffer.from(JSON.stringify(manifest)) : payload;
      const res = Readable.from([body]); res.statusCode = 200; res.headers = { 'content-length': body.length };
      callback(res);
    });
    return req;
  } };
  const ctx = { require: id => id === 'electron' ? { app: { getVersion: () => '3.0.0' } } : id === 'node:https' ? fakeHttps : require(id), module: { exports: {} }, console, Buffer, URL };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'electron/updater.js'), 'utf8'), ctx);
  return { updater: ctx.module.exports, manifest, requests: () => requests };
}

test('updater rejects untrusted installers and manifests without integrity metadata', () => {
  const { updater, manifest } = updaterFixture(Buffer.from('setup'));
  assert.equal(updater.compareVersions('3.0.0', '2.0.104'), 1);
  assert.throws(() => updater.validateManifest({ ...manifest, url: 'http://github.com/file.exe' }));
  assert.throws(() => updater.validateManifest({ ...manifest, url: 'https://evil.invalid/setup.exe' }));
  assert.throws(() => updater.validateManifest({ ...manifest, sha256: '' }));
  assert.throws(() => updater.compareVersions('3.bad.0', '3.0.0'));
});

test('updater deduplicates downloads and verifies bytes before exposing an executable', async t => {
  const payload = Buffer.from('MZ test installer, never executed'), fixture = updaterFixture(payload);
  const info = await fixture.updater.checkForUpdate();
  const first = fixture.updater.downloadFile(info.url), second = fixture.updater.downloadFile(info.url);
  assert.equal(first, second);
  const file = await first;
  t.after(() => { assert.equal(path.dirname(path.dirname(file)), os.tmpdir()); fs.unlinkSync(file); fs.rmdirSync(path.dirname(file)); });
  assert.deepEqual(fs.readFileSync(file), payload);
  assert.equal(fixture.requests(), 2);
});

test('corrupt update downloads fail without returning an installer path', async () => {
  const fixture = updaterFixture(Buffer.from('corrupt'), { sha256: 'a'.repeat(64) });
  await fixture.updater.checkForUpdate();
  await assert.rejects(fixture.updater.downloadFile(fixture.manifest.url), /контрольная сумма/);
});

test('PDF text extraction and register XLSX still work after the PDF.js migration', async () => {
  const { PDFDocument, StandardFonts } = require('pdf-lib');
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage().drawText('Invoice 42 - test document', { x: 40, y: 700, font });
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({ data: await doc.save(), isEvalSupported: false });
  const pdf = await loadingTask.promise;
  try { assert.match((await (await pdf.getPage(1)).getTextContent()).items.map(item => item.str).join(' '), /Invoice 42/); }
  finally { await loadingTask.destroy(); }
  const lib = await import('../ReestrBuilder/lib.mjs');
  const { buffer } = await lib.buildXlsxFromRows([{ sum: 1234, date: '18.10.2026', description: 'Test', osn: '42' }], lib.DEFAULT_CONFIG);
  const workbook = new (require('exceljs').Workbook)(); await workbook.xlsx.load(buffer);
  assert.ok(workbook.worksheets.length > 0);
});
