'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '../web/public/bridge.js'), 'utf8');
const access = { policyStamp: 'sha256:' + 'a'.repeat(64), user: { id: 'synthetic-browser', name: 'Synthetic browser', role: 'admin' }, readable: ['vehicles', 'records'], writable: ['vehicles', 'records'] };

function fixture(handler) {
  const calls = [], appended = [], settings = new Map();
  const node = () => ({ style: {}, append(...items) { appended.push(...items); }, setAttribute() {}, remove() {}, click() {}, addEventListener() {} });
  const document = { body: node(), querySelector: () => ({ content: 'synthetic-csrf' }), getElementById: () => null, createElement: node, addEventListener() {} };
  const window = { addEventListener() {} };
  const context = vm.createContext({ window, document, location: { origin: 'http://localhost:9393', protocol: 'http:', port: '9393', reload() {} },
    localStorage: { getItem: key => settings.get(key), setItem: (key, value) => settings.set(key, value) },
    URL, URLSearchParams, Blob, TextEncoder, TextDecoder, structuredClone, crypto: webcrypto, Uint8Array, ArrayBuffer, btoa, atob, setTimeout() {},
    fetch: async (url, request) => { calls.push({ url, request }); const result = await handler(url, request); return { status: result.status || 200, ok: (result.status || 200) < 400, json: async () => result.body }; },
  });
  vm.runInContext(source, context, { filename: 'bridge.js' });
  return { api: window.electronAPI, web: window.tvsWeb, calls, settings, appended };
}

test('browser snapshot keeps per-user compatibility and posts no bearer credential', async () => {
  const f = fixture(url => {
    if (url.endsWith('/bootstrap')) return { body: { ok: true, csrf: 'renewed-csrf', settings: { networkMode: 'client' } } };
    if (url.endsWith('/negotiate')) return { body: { compatibility: { readCompatible: true, writeCompatible: true } } };
    if (url.startsWith('/web-api/snapshot')) return { body: { data: { vehicles: [], records: [] }, revisions: {}, access, databaseToken: 'synthetic-database', platform: { apiVersion: 1 } } };
    if (url.endsWith('/ping')) return { body: { ok: true, databaseToken: 'synthetic-database', access } };
    throw Error('Unexpected route');
  });
  const snapshot = JSON.parse(await f.api.readSnapshot({ hello: { version: 1 } }));
  assert.equal(snapshot.platform.negotiation.writeCompatible, true);
  const read = f.calls.find(call => call.url.startsWith('/web-api/snapshot'));
  assert.deepEqual(JSON.parse(new URL(read.url, 'http://localhost').searchParams.get('hello')), { version: 1 });
  const sent = f.calls.find(call => call.url.endsWith('/negotiate'));
  assert.equal(sent.request.headers['X-CSRF-Token'], 'renewed-csrf');
  assert.equal(sent.request.headers.Authorization, undefined);
  assert.equal(sent.request.credentials, 'same-origin');
  const identity = await f.api.getDataCacheContext();
  assert.equal(identity.mode, 'client');
  assert.equal(identity.policyStamp, access.policyStamp);
  assert.equal(f.settings.size, 0, 'no database or credential is persisted in localStorage');
});

test('startup overlaps initial reads, negotiates the supplied profile once and shares bootstrap version', async () => {
  let completeBootstrap;
  const waiting = new Promise(resolve => { completeBootstrap = resolve; });
  const hello = { protocolVersion: 1, capabilities: [{ name: 'customClient', versions: [2] }] };
  const f = fixture(url => {
    if (url.endsWith('/bootstrap')) return waiting;
    if (url.startsWith('/web-api/snapshot')) return { body: { data: { vehicles: [], records: [] }, revisions: {}, access, databaseToken: 'synthetic-database', platform: { apiVersion: 1, negotiation: { readCompatible: true, writeCompatible: false } } } };
    if (url.endsWith('/ping')) return { body: { ok: true, databaseToken: 'synthetic-database', access } };
    throw Error('Unexpected startup request');
  });
  const reading = f.api.readSnapshot({ hello });
  const version = f.api.getAppVersion();
  const settings = f.api.getSettings();
  assert.deepEqual(f.calls.map(call => call.url.split('?')[0]), ['/web-api/bootstrap', '/web-api/snapshot']);
  const read = f.calls.find(call => call.url.startsWith('/web-api/snapshot'));
  assert.deepEqual(JSON.parse(new URL(read.url, 'http://localhost').searchParams.get('hello')), hello);
  completeBootstrap({ body: { ok: true, version: '3.5.18', settings: { networkMode: 'client' } } });
  const [snapshot, appVersion, appSettings] = await Promise.all([reading, version, settings]);
  assert.equal(JSON.parse(snapshot).platform.negotiation.writeCompatible, false, 'gateway result for the supplied profile is retained');
  assert.equal(appVersion, '3.5.18');
  assert.equal(appSettings.networkMode, 'client');
  assert.equal(f.calls.length, 2, 'no extra version ping or compatibility preflight');
  await f.api.getDataCacheContext();
  await f.api.getDataCacheContext();
  assert.equal(f.calls.filter(call => call.url.endsWith('/ping')).length, 2, 'current access checks remain fresh');
});

test('a failed bootstrap or incompatible client profile never installs a snapshot', async () => {
  const denied = fixture(url => url.endsWith('/bootstrap') ? { status: 401, body: { error: 'Synthetic revoked session' } } :
    { body: { data: { vehicles: [], records: [] }, revisions: {}, access, databaseToken: 'synthetic-database', platform: { apiVersion: 1, negotiation: { readCompatible: true } } } });
  await assert.rejects(denied.api.readSnapshot({ hello: { version: 1 } }), error => error.status === 401);
  assert.equal(denied.web.latestSnapshot, null);
  const incompatible = fixture(url => url.endsWith('/bootstrap') ? { body: { settings: {} } } :
    { body: { data: { vehicles: [], records: [] }, revisions: {}, access, databaseToken: 'synthetic-database', platform: { apiVersion: 1, negotiation: { readCompatible: false, writeCompatible: false } } } });
  await assert.rejects(incompatible.api.readSnapshot({ hello: { version: 99 } }), /несовместима/);
  assert.equal(incompatible.web.latestSnapshot, null);
});

test('CAS conflicts remain structured and a write transport failure never retries', async () => {
  const f = fixture(url => url.endsWith('/bootstrap') ? { body: { settings: {} } } : { status: 409, body: { ok: false, conflicts: ['records'], databaseToken: 'db' } });
  assert.deepEqual(Array.from((await f.api.writeSections('{"sections":{"records":[]}}')).conflicts), ['records']);
  assert.equal(f.calls.filter(call => call.url.endsWith('/sections')).length, 1);
  const broken = fixture(url => { if (url.endsWith('/bootstrap')) return { body: { settings: {} } }; throw Error('Synthetic lost ACK'); });
  await assert.rejects(broken.api.executeCommand({ operation: { id: 'synthetic-operation' } }), error => error.code === 'WEB_TRANSPORT' && error.unknown === true);
  assert.equal(broken.calls.filter(call => call.url.endsWith('/commands')).length, 1);
});

test('missing authoritative snapshot blocks the UI and unsupported native actions report a gap', async () => {
  const f = fixture(url => url.endsWith('/bootstrap') ? { body: { settings: {} } } : { body: { data: { vehicles: [], records: [] } } });
  await assert.rejects(f.api.readSnapshot(), error => error.code === 'ACCESS_UNVERIFIED');
  assert.ok(f.appended.some(element => element.id === 'webConnectionError'));
  await assert.rejects(f.api.chooseDataFolder(), error => error.code === 'WEB_NOT_IMPLEMENTED');
});

test('import source transports original bytes as base64 without editing the caller', async () => {
  const f = fixture(url => ({ body: url.endsWith('/bootstrap') ? { settings: {} } : { ok: true } }));
  const payload = { action: 'stage', databaseToken: 'synthetic-db', source: { name: 'sample.json', bytes: [123, 125] } };
  assert.equal((await f.api.importSource(payload)).ok, true);
  const sent = JSON.parse(f.calls.find(call => call.url.endsWith('/import-source')).request.body);
  assert.equal(sent.source.base64, 'e30=');
  assert.equal(sent.source.bytes, undefined);
  assert.deepEqual(payload.source.bytes, [123, 125]);
});

test('file download rejects a mismatched checksum before creating a download', async () => {
  const f = fixture(url => ({ body: url.endsWith('/bootstrap') ? { settings: {} } : { ok: true, base64: 'e30=', sha256: '0'.repeat(64) } }));
  await assert.rejects(f.api.documentPrint({ action: 'export', archiveId: 'synthetic', format: 'xlsx' }), /Контрольная сумма/);
});
