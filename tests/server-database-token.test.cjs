const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), vm = require('node:vm');
const storage = require('../electron/storage'), server = require('../electron/server');
const networkKey = 'database-token-test-network-key';
function request(port, route, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: route, method: body == null ? 'GET' : 'POST', agent: false,
      headers: { Authorization: 'Bearer ' + networkKey, 'Content-Type': 'application/json' } }, res => {
      let raw = ''; res.setEncoding('utf8'); res.on('data', part => raw += part);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); } catch (error) { reject(error); } });
    });
    req.on('error', reject); req.end(body == null ? undefined : JSON.stringify(body));
  });
}
test('cloned server databases expose distinct tokens and refuse stale history and section writes at the same endpoint', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tvs-token-test-')), a = path.join(dir, 'A'), b = path.join(dir, 'B');
  t.after(async () => { await server.stop(); assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir())); assert.ok(path.basename(dir).startsWith('tvs-token-test-')); fs.rmSync(dir, { recursive: true, force: true }); });
  storage.writeAll(a, { vehicles: [{ id: 'v', driver: 'Original' }], records: [] });
  const changed = storage.readAll(a); changed.vehicles[0].driver = 'Updated'; storage.writeAll(a, changed, { action: 'Target operation' });
  const event = storage.listHistory(a).items.find(e => e.action === 'Target operation'); fs.cpSync(a, b, { recursive: true });
  const first = await server.start({ port: 0, dataDir: a, key: networkKey }); assert.equal(first.ok, true);
  const pingA = (await request(first.port, '/api/ping')).body, snapA = (await request(first.port, '/api/snapshot')).body;
  const historyA = (await request(first.port, '/api/history')).body, detailA = (await request(first.port, '/api/history/' + event.id)).body;
  const tokenA = storage.databaseToken(a), tokenB = storage.databaseToken(b);
  assert.notEqual(tokenA, tokenB);
  for (const response of [pingA, snapA, historyA, detailA]) assert.equal(response.databaseToken, tokenA);
  await server.stop(); const second = await server.start({ port: first.port, dataDir: b, key: networkKey }); assert.equal(second.ok, true);
  const pingB = (await request(second.port, '/api/ping')).body, snapshotB = (await request(second.port, '/api/snapshot')).body;
  assert.equal(pingB.databaseToken, tokenB); assert.deepEqual(snapshotB.revisions, snapA.revisions);
  const before = storage.readAll(b), revisions = storage.readRevisions(b), events = storage.listHistory(b).items.length;
  for (const databaseToken of [undefined, tokenA]) {
    const restored = await request(second.port, '/api/history/restore', { id: event.id, databaseToken });
    assert.equal(restored.status, 409); assert.equal(restored.body.ok, false); assert.match(restored.body.error, /другая база/);
  }
  const staleWrite = await request(second.port, '/api/sections', { databaseToken: tokenA, base: snapA.revisions, sections: { vehicles: [{ id: 'v', driver: 'Wrong database overwrite' }] } });
  assert.equal(staleWrite.status, 400); assert.match(staleWrite.body.error, /другую базу/);
  assert.deepEqual(storage.readAll(b), before); assert.deepEqual(storage.readRevisions(b), revisions); assert.equal(storage.listHistory(b).items.length, events);
  const valid = await request(second.port, '/api/history/restore', { id: event.id, databaseToken: tokenB });
  assert.equal(valid.body.ok, true); assert.equal(valid.body.databaseToken, tokenB); assert.equal(storage.readAll(b).vehicles[0].driver, 'Original');
  assert.equal(storage.readAll(a).vehicles[0].driver, 'Updated');
  const legacy = await request(second.port, '/api/sections', { base: storage.readRevisions(b), sections: { vehicles: [{ id: 'v', driver: 'Legacy client' }] } });
  assert.equal(legacy.body.ok, true); assert.equal(legacy.body.databaseToken, tokenB);
});

function identityHandler(getJson) {
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8');
  const start = source.indexOf("  ipcMain.handle('get-data-identity', async () => {");
  const end = source.indexOf('\n  async function historyRead', start);
  assert.ok(start > 0 && end > start);
  const handlers = {}, state = { identity: 'same-endpoint', networkMode: 'client', remoteHost: 'server', remotePort: 3377 };
  const context = { settings: state, databaseIdentity: value => value.identity, isClientMode: () => state.networkMode === 'client',
    ipcMain: { handle: (name, callback) => handlers[name] = callback }, server: { getJson } };
  vm.runInNewContext(source.slice(start, end), context);
  return { state, call: handlers['get-data-identity'] };
}
test('native client identity distinguishes the served database, handles legacy servers and refuses offline or switched profiles', async () => {
  let token = 'A'; const handler = identityHandler(async () => ({ ok: true, databaseToken: token }));
  assert.equal(await handler.call(), 'same-endpoint:A'); token = 'B'; assert.equal(await handler.call(), 'same-endpoint:B');
  token = undefined; assert.equal(await handler.call(), 'same-endpoint:legacy');
  const offline = identityHandler(async () => { throw Error('Offline'); }); await assert.rejects(offline.call(), /Offline/);
  let release; const switched = identityHandler(() => new Promise(resolve => { release = resolve; })); const pending = switched.call();
  switched.state.identity = 'other-profile'; release({ ok: true, databaseToken: 'A' }); await assert.rejects(pending, /другая база/);
  handler.state.networkMode = 'local'; assert.equal(await handler.call(), 'same-endpoint');
});

test('renderer binds section payloads to its loaded snapshot and rejects a different database before merging rows', async () => {
  const context = { window: { electronAPI: {} }, console, data: { vehicles: [{ id: 'v', driver: 'Original' }] }, rebuildIndex() {}, showToast() {} };
  vm.createContext(context); vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/js/25f-sync.js'), 'utf8'), context);
  context.window.electronAPI.readSnapshot = async () => JSON.stringify({ data: context.data, revisions: { vehicles: 2 }, databaseToken: 'A' });
  await vm.runInContext('syncLoad()', context);
  context.data.vehicles[0].driver = 'Local'; let sent;
  context.window.electronAPI.writeSections = async raw => { sent = JSON.parse(raw); return { ok: false, conflicts: ['vehicles'], databaseToken: 'B' }; };
  await assert.rejects(vm.runInContext('syncSaveNow(data)', context), /другую базу/);
  assert.equal(sent.databaseToken, 'A'); assert.equal(context.data.vehicles[0].driver, 'Local');
  context.window.electronAPI.writeSections = async () => ({ ok: false, conflicts: ['vehicles'] });
  context.window.electronAPI.readSection = async () => ({ rows: [{ id: 'v', driver: 'Other database' }], rev: 2, databaseToken: 'B' });
  await assert.rejects(vm.runInContext('syncSaveNow(data)', context), /другую базу/);
  assert.equal(context.data.vehicles[0].driver, 'Local');
});
