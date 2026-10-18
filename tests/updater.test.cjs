const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');

const installerUrl = version => `https://github.com/dmitriyuser047/dispatcher-auto-tvs/releases/download/v${version}/Dispatcher-Setup-${version}.exe`;
const installer = Buffer.from('fixture installer bytes; never executed');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const stableManifest = overrides => ({
  version: '3.5.2', date: '2026-10-18', notes: 'Production release',
  url: installerUrl('3.5.2'), sha256: digest(installer), ...overrides
});

function fixture(t, { current = '2.0.104', manifest = stableManifest(), body = installer, downloadResponse } = {}) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatcher-updater-test-'));
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  const requests = [], launches = [], warnings = [];
  let quits = 0, now = Date.now();
  const fakeHttps = { get(url, options, callback) {
    const href = String(url);
    requests.push(href);
    const request = new EventEmitter();
    request.destroy = error => queueMicrotask(() => request.emit('error', error || new Error('destroyed')));
    queueMicrotask(() => {
      const isManifest = href.startsWith('https://raw.githubusercontent.com/');
      const descriptor = isManifest
        ? { body: Buffer.from(JSON.stringify(manifest)) }
        : typeof downloadResponse === 'function' ? downloadResponse(href) : { body };
      if (!descriptor) { request.emit('error', new Error('Unexpected network request: ' + href)); return; }
      const data = descriptor.body || Buffer.alloc(0);
      const response = Readable.from([data]);
      response.statusCode = descriptor.statusCode || 200;
      response.headers = descriptor.headers || { 'content-length': String(data.length) };
      response.complete = descriptor.complete !== false;
      callback(response);
    });
    return request;
  } };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../electron/updater.js'), 'utf8'), {
    module, exports: module.exports, URL, Buffer, AbortController, setTimeout, clearTimeout,
    Date: class extends Date { static now() { return now; } },
    console: { warn: message => warnings.push(message) },
    require(name) {
      if (name === 'electron') return { app: { getVersion: () => current, quit() { quits++; } } };
      if (name === 'https') return fakeHttps;
      if (name === 'os') return { tmpdir: () => temporaryRoot };
      if (name === 'child_process') return { spawn(file, args, options) {
        const child = new EventEmitter();
        child.unref = () => {};
        launches.push({ file, args: Array.from(args), options });
        queueMicrotask(() => child.emit('spawn'));
        return child;
      } };
      return require(name);
    }
  });
  return {
    updater: module.exports, requests, launches, warnings, temporaryRoot,
    advance(ms) { now += ms; }, get quits() { return quits; }
  };
}

test('stable 3.5.2 is offered directly to an installed 2.0.104', async t => {
  const context = fixture(t);
  const info = await context.updater.checkForUpdate();
  assert.equal(info.version, '3.5.2');
  assert.equal(info.currentVersion, '2.0.104');
  assert.equal(info.url, installerUrl('3.5.2'));
  assert.equal(info.canInstall, true);
  assert.equal(info.blockedReason, '');
  assert.equal(context.requests.length, 1);
  assert.match(context.requests[0], /^https:\/\/raw\.githubusercontent\.com\/dmitriyuser047\/dispatcher-auto-tvs\/main\/version\.json\?t=\d+$/);
});

test('the installed stable version and older releases are ignored', async t => {
  for (const version of ['3.5.2', '3.5.1', '2.0.104']) {
    const context = fixture(t, { current: '3.5.2', manifest: stableManifest({ version, url: installerUrl(version) }) });
    assert.equal(await context.updater.checkForUpdate(), null);
    await assert.rejects(context.updater.downloadFile(installerUrl(version)), /повторно проверьте/);
  }
});

test('prereleases and malformed versions cannot enter the stable update channel', async t => {
  for (const version of ['3.5.3-prototype.1', '3.6.0-beta.1', 'v3.5.3', '3.5', '3.5.3.0', 'invalid']) {
    const context = fixture(t, { manifest: stableManifest({ version, url: installerUrl(version) }) });
    assert.equal(await context.updater.checkForUpdate(), null, version);
    await assert.rejects(context.updater.downloadFile(installerUrl(version)), /повторно проверьте/);
  }
});

test('a missing or invalid SHA-256 allows announcement but prevents download', async t => {
  for (const sha256 of [undefined, '', '1234', 'g'.repeat(64)]) {
    const context = fixture(t, { manifest: stableManifest({ sha256 }) });
    const info = await context.updater.checkForUpdate();
    assert.equal(info.canInstall, false);
    assert.match(info.blockedReason, /SHA-256/);
    await assert.rejects(context.updater.downloadFile(info.url), /SHA-256/);
    assert.equal(context.requests.length, 1);
  }
});

test('other repositories, release paths, protocols and URL decorations are rejected', async t => {
  for (const url of [
    'https://github.com/another/project/releases/download/v3.5.2/Dispatcher-Setup-3.5.2.exe',
    installerUrl('3.5.1'),
    installerUrl('3.5.2').replace('Dispatcher-Setup', 'Dispatcher-Prototype'),
    installerUrl('3.5.2') + '?download=1', installerUrl('3.5.2') + '#asset',
    installerUrl('3.5.2').replace('https:', 'http:'),
    installerUrl('3.5.2').replace('github.com', 'github.com.evil.example'),
    installerUrl('3.5.2').replace('github.com', 'user:password@github.com'),
    installerUrl('3.5.2').replace('github.com', 'github.com:8443')
  ]) {
    const context = fixture(t, { manifest: stableManifest({ url }) });
    assert.equal(await context.updater.checkForUpdate(), null, url);
    await assert.rejects(context.updater.downloadFile(url), /повторно проверьте/);
    assert.equal(context.requests.length, 1);
  }
});

test('compatibility and migration requirements prevent automatic installation', async t => {
  for (const restriction of [{ minAppVersion: '3.0.0' }, { maxAppVersion: '2.0.103' }, { requiresDataMigration: true }]) {
    const context = fixture(t, { manifest: stableManifest(restriction) });
    const info = await context.updater.checkForUpdate();
    assert.equal(info.canInstall, false);
    assert.notEqual(info.blockedReason, '');
    await assert.rejects(context.updater.downloadFile(info.url));
    assert.equal(context.requests.length, 1);
  }
});

test('an unchecked URL and an expired release cannot be downloaded', async t => {
  const context = fixture(t);
  await assert.rejects(context.updater.downloadFile(installerUrl('3.5.2')), /повторно проверьте/);
  await context.updater.checkForUpdate();
  context.advance(30 * 60 * 1000 + 1);
  await assert.rejects(context.updater.downloadFile(installerUrl('3.5.2')), /повторно проверьте/);
  assert.equal(context.requests.length, 1);
});

test('verified installer is downloaded with progress and only then launched through a mock', async t => {
  const context = fixture(t, { manifest: stableManifest({ sha256: digest(installer).toUpperCase() }) });
  const info = await context.updater.checkForUpdate();
  const progress = [];
  const file = await context.updater.downloadFile(info.url, value => progress.push(value));
  assert.equal(fs.readFileSync(file).equals(installer), true);
  assert.equal(path.dirname(path.dirname(file)), context.temporaryRoot);
  assert.equal(progress.at(-1), 100);
  assert.equal(context.launches.length, 0);
  await context.updater.launchInstaller(file);
  assert.equal(context.launches.length, 1);
  assert.equal(context.launches[0].file, file);
  assert.equal(context.launches[0].options.detached, true);
  assert.equal(context.launches[0].options.stdio, 'ignore');
  assert.equal(context.quits, 1);
});

test('hash mismatch removes all installer bytes and never launches', async t => {
  const context = fixture(t, { body: Buffer.from('substituted installer') });
  const info = await context.updater.checkForUpdate();
  await assert.rejects(context.updater.downloadFile(info.url), /Контрольная сумма не совпадает/);
  assert.deepEqual(fs.readdirSync(context.temporaryRoot), []);
  assert.equal(context.launches.length, 0);
  assert.equal(context.quits, 0);
});

test('an incomplete installer is removed even if its received bytes match the digest', async t => {
  const context = fixture(t, { downloadResponse: () => ({ body: installer, complete: false }) });
  const info = await context.updater.checkForUpdate();
  await assert.rejects(context.updater.downloadFile(info.url), /не полностью/);
  assert.deepEqual(fs.readdirSync(context.temporaryRoot), []);
});

test('an arbitrary file and a verified installer changed on disk cannot be launched', async t => {
  const context = fixture(t);
  const arbitrary = path.join(context.temporaryRoot, 'untrusted.exe');
  fs.writeFileSync(arbitrary, installer);
  await assert.rejects(context.updater.launchInstaller(arbitrary), /не прошёл проверку/);
  const info = await context.updater.checkForUpdate();
  const file = await context.updater.downloadFile(info.url);
  fs.appendFileSync(file, 'tampered');
  await assert.rejects(context.updater.launchInstaller(file), /изменился после проверки/);
  assert.equal(context.launches.length, 0);
  assert.equal(context.quits, 0);
});

test('installer redirects cannot escape trusted HTTPS hosts', async t => {
  for (const location of ['http://github.com/asset.exe', 'https://evil.example/asset.exe']) {
    const context = fixture(t, { downloadResponse: () => ({ statusCode: 302, headers: { location } }) });
    const info = await context.updater.checkForUpdate();
    await assert.rejects(context.updater.downloadFile(info.url), /HTTPS|Недоверенный/);
    assert.equal(context.requests.length, 2);
    assert.deepEqual(fs.readdirSync(context.temporaryRoot), []);
  }
});

test('GitHub release asset redirects retain digest verification', async t => {
  const assetUrl = 'https://release-assets.githubusercontent.com/github-production-release-asset/fixture';
  const context = fixture(t, { downloadResponse: href => href === assetUrl
    ? { body: installer }
    : { statusCode: 302, headers: { location: assetUrl } }
  });
  const info = await context.updater.checkForUpdate();
  const file = await context.updater.downloadFile(info.url);
  assert.equal(digest(fs.readFileSync(file)), info.sha256);
  assert.equal(context.requests.length, 3);
  assert.equal(context.launches.length, 0);
});
