'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), crypto = require('node:crypto');
const { Worker } = require('node:worker_threads'), { setTimeout: delay } = require('node:timers/promises');
const { createGateway } = require('../web/server.cjs'), access = require('../electron/access-control.js'), sqlite = require('../electron/sqlite-storage.cjs');
const storage = require('../electron/storage.js'), compatibility = require('../assets/core/platform-compatibility.js');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function call(port, route, { method = 'GET', payload, cookie, csrf, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const raw = payload === undefined ? undefined : JSON.stringify(payload);
    const request = http.request({ hostname: '127.0.0.1', port, path: route, method, agent: false, headers: {
      ...(raw === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw) }),
      ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...headers,
    } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let body; try { body = JSON.parse(text); } catch {} resolve({ status: response.statusCode, body, text, headers: response.headers }); });
    });
    request.on('error', reject); request.setTimeout(15000, () => request.destroy(Error('Synthetic gateway request timeout'))); request.end(raw);
  });
}
async function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tvs-web-features-gateway-')), dataDir = path.join(root, 'db'), usersFile = path.join(root, 'users.json');
  sqlite.create(dataDir, { data: { vehicles: [{ id: 0, plate: 'SYNTHETIC-FEATURES-ZERO', org: 'Synthetic', site: 'north' }], records: [{ id: 'r1', vehicleId: 0, date: '2026-10-28', km: 12 }], payments: [{ id: 'private-payment', description: 'SYNTHETIC-PRIVATE-FINANCE', sum: 87654321 }] } });
  const tokens = Object.fromEntries(['owner', 'keeper', 'viewer', 'narrow'].map(id => [id, access.issueToken()]));
  const rows = Object.entries(tokens).map(([id, issued]) => ({ id, name: 'Synthetic ' + id, role: id === 'viewer' ? 'viewer' : 'admin', enabled: true, tokenHash: issued.tokenHash, ...(id === 'narrow' ? { readable: ['vehicles'], writable: ['vehicles'] } : {}) }));
  fs.writeFileSync(usersFile, JSON.stringify({ serverUsers: rows }, null, 2));
  const settings = () => ({ serverAccessConfigured: true, serverUsers: access.normalizeServerUsers(JSON.parse(fs.readFileSync(usersFile, 'utf8')).serverUsers) });
  const gateway = await createGateway({ dataDir, usersFile, settings, backup: { directory: path.join(root, 'backups'), keep: 2 }, renderDocument: ({ user }) => '<p>' + (user ? 'Synthetic workspace' : 'Synthetic login') + '</p>', ...options });
  t.after(async () => { await gateway.close(); const resolved = path.resolve(root); assert.equal(path.dirname(resolved), path.resolve(os.tmpdir())); assert.match(path.basename(resolved), /^tvs-web-features-gateway-/); assert.equal(fs.lstatSync(resolved).isSymbolicLink(), false); fs.rmSync(resolved, { recursive: true, force: true }); });
  return { ...gateway, root, dataDir, usersFile, tokens, async login(token = tokens.owner.token, headers = {}) {
    const response = await call(gateway.port, '/web-api/login', { method: 'POST', payload: { token }, headers });
    assert.equal(response.status, 200);
    return { cookie: response.headers['set-cookie'][0].split(';')[0], csrf: response.body.csrf, headers };
  } };
}
const post = (h, session, route, payload, extra = {}) => call(h.port, route, { ...session, method: 'POST', payload, ...extra });
function keyFrom(response) { assert.equal(response.status, 200); assert.equal(typeof response.body.key, 'string'); assert.equal(/^tvs_[a-f0-9]{64}$/.test(response.body.key), true); return response.body.key; }
function coalescingBarrier(t, count) {
  // Align real HTTP requests at the queue boundary, independently of whether
  // Windows delivers their separate sockets in the same event-loop turn.
  const filename = require.resolve('../web/read-cohorts.cjs'), original = require(filename); let waiting = [], aligned = false;
  require.cache[filename].exports = { createReadCohorts(options) {
    const queue = original.createReadCohorts(options);
    return { ...queue, enqueue(value) {
      if (aligned || value.kind !== 'workspace') return queue.enqueue(value);
      return new Promise((resolve, reject) => {
        waiting.push({ value, resolve, reject });
        if (waiting.length === count) { aligned = true; const closed = waiting; waiting = []; for (const item of closed) queue.enqueue(item.value).then(item.resolve, item.reject); }
      });
    }, close() { for (const item of waiting) item.reject(Error('Synthetic request barrier closed')); waiting = []; return queue.close(); } };
  } };
  t.after(() => { require.cache[filename].exports = original; });
}

test('failed durable operations have explicit HTTP failure status and are never resent', async t => {
  const outcomes = [
    { ok: false, code: 'DB_BUSY', queued: false, error: 'Synthetic pre-dispatch contention' },
    { ok: false, code: 'ACCESS_DENIED', queued: false, error: 'Synthetic rejected intent' },
    { ok: false, code: 'ACK_REQUIRED', queued: true, error: 'Synthetic missing acknowledgement' },
    { ok: false, conflicts: ['vehicles'], error: 'Synthetic stale version' },
  ];
  let sends = 0;
  const h = await fixture(t, { outbox: { execute: async () => outcomes[sends++] } }), session = await h.login();
  for (const status of [503, 400, 503, 409]) {
    const response = await post(h, session, '/web-api/sections', { operation: { id: 'synthetic-status-' + sends } });
    assert.equal(response.status, status); assert.equal(response.body.ok, false);
  }
  assert.equal(sends, outcomes.length);
  assert.equal(storage.readAll(h.dataDir).vehicles[0].note, undefined);
});

test('user HTTP management enforces admin, CSRF and CAS and immediately revokes rotated or disabled keys', async t => {
  const h = await fixture(t), owner = await h.login(), viewer = await h.login(h.tokens.viewer.token), narrow = await h.login(h.tokens.narrow.token);
  assert.equal((await call(h.port, '/web-api/users')).status, 401);
  for (const session of [viewer, narrow]) {
    assert.equal((await call(h.port, '/web-api/users', session)).status, 403);
    assert.equal((await post(h, session, '/web-api/users', { action: 'create' })).status, 403);
  }
  const initial = (await call(h.port, '/web-api/users', owner)).body;
  assert.equal(initial.users.length, 4); assert.equal(JSON.stringify(initial).includes('tokenHash'), false);
  const create = { action: 'create', version: initial.version, name: 'Synthetic employee', role: 'dispatcher', enabled: true };
  assert.equal((await post(h, owner, '/web-api/users', create, { csrf: undefined })).status, 403);
  const created = await post(h, owner, '/web-api/users', create), firstKey = keyFrom(created), id = created.body.user.id;
  assert.equal(fs.readFileSync(h.usersFile, 'utf8').includes(firstKey), false);
  assert.equal((await call(h.port, '/web-api/users', owner)).body.key, undefined);
  let employee = await h.login(firstKey), version = created.body.version;
  const update = enabled => ({ action: 'update', version, id, name: 'Synthetic employee', role: 'dispatcher', enabled });
  const disabled = await post(h, owner, '/web-api/users', update(false)); assert.equal(disabled.status, 200); version = disabled.body.version;
  assert.equal((await call(h.port, '/web-api/bootstrap', employee)).status, 401);
  assert.equal((await post(h, {}, '/web-api/login', { token: firstKey })).status, 401);
  const enabled = await post(h, owner, '/web-api/users', update(true)); assert.equal(enabled.status, 200); version = enabled.body.version;
  employee = await h.login(firstKey);
  const rotated = await post(h, owner, '/web-api/users', { action: 'rotate-key', version, id }), secondKey = keyFrom(rotated);
  assert.equal((await call(h.port, '/web-api/bootstrap', employee)).status, 401);
  assert.equal((await post(h, {}, '/web-api/login', { token: firstKey })).status, 401);
  assert.equal(typeof (await h.login(secondKey)).cookie, 'string');
  const beforeStale = hash(fs.readFileSync(h.usersFile));
  const stale = await post(h, owner, '/web-api/users', { action: 'update', version: initial.version, id, name: 'Synthetic stale overwrite', role: 'viewer', enabled: false });
  assert.equal(stale.status, 409); assert.equal(stale.body.code, 'USERS_CHANGED'); assert.equal(hash(fs.readFileSync(h.usersFile)), beforeStale);
  const self = await post(h, owner, '/web-api/users', { action: 'rotate-key', version: rotated.body.version, id: 'owner' }), ownerKey = keyFrom(self);
  assert.equal(self.body.reauthenticate, true); assert.equal(self.headers['set-cookie'].some(value => value.includes('Max-Age=0')), true);
  assert.equal((await call(h.port, '/web-api/bootstrap', owner)).status, 401);
  assert.equal((await post(h, {}, '/web-api/login', { token: h.tokens.owner.token })).status, 401);
  assert.equal(typeof (await h.login(ownerKey)).cookie, 'string');
});

test('workspace HTTP response declares canonical sections and uses the actual requested compatibility profile', async t => {
  const h = await fixture(t), session = await h.login(), before = storage.readSnapshot(h.dataDir), hello = compatibility.describe().hello;
  const workspace = profile => '/web-api/workspace?hello=' + encodeURIComponent(JSON.stringify(profile));
  const response = await call(h.port, workspace(hello), session);
  assert.equal(response.status, 200); assert.equal(response.body.data.vehicles.length, 1); assert.equal(response.body.data.records.length, 1);
  assert.equal(Object.hasOwn(response.body.data, 'auditLog'), false); assert.equal(response.body.loadedSections.includes('auditLog'), false);
  assert.equal(response.body.loadedSections.every(name => Array.isArray(response.body.data[name])), true);
  assert.equal(response.body.databaseToken, before.databaseToken); assert.equal(response.body.revisions.vehicles, before.revisions.vehicles);
  assert.equal(response.body.platform.negotiation.writeCompatible, true); assert.equal(response.body.readOnly, false);
  assert.equal(/writeTicket|tokenHash/.test(response.text), false);
  const incompatible = await call(h.port, workspace({ ...hello, readerSchemaVersions: [65535] }), session);
  assert.equal(incompatible.status, 200); assert.equal(incompatible.body.platform.negotiation.readCompatible, false); assert.equal(incompatible.body.readOnly, true);
  for (const profile of [{ ...hello, writerSchemaVersions: [] }, { ...hello, protocolVersions: [65535] }]) {
    const readonly = await call(h.port, workspace(profile), session);
    assert.equal(readonly.status, 200); assert.equal(readonly.body.platform.negotiation.readCompatible, true);
    assert.equal(readonly.body.platform.negotiation.writeCompatible, false); assert.equal(readonly.body.readOnly, true);
  }
  for (const profile of [null, { ...hello, capabilities: 'invalid' }]) {
    const invalid = await call(h.port, workspace(profile), session);
    assert.equal(invalid.status, 200); assert.equal(invalid.body.platform.negotiation.readCompatible, false); assert.equal(invalid.body.readOnly, true);
  }
  const history = await call(h.port, '/web-api/workspace?sections=' + encodeURIComponent(JSON.stringify(['auditLog'])), session);
  assert.equal(history.status, 200); assert.equal(history.body.loadedSections.includes('auditLog'), true); assert.equal(Array.isArray(history.body.data.auditLog), true);
  for (const suffix of ['?sections=%7B', '?other=1', '?sections=%5B%22vehicles%22%5D&sections=%5B%22records%22%5D']) assert.equal((await call(h.port, '/web-api/workspace' + suffix, session)).status, 400);
  assert.deepEqual(storage.readSnapshot(h.dataDir), before);
});

test('workspace publishes one fresh locked frame with per-user access and no loopback writer negotiation', async t => {
  const h = await fixture(t), owner = await h.login(), viewer = await h.login(h.tokens.viewer.token), narrow = await h.login(h.tokens.narrow.token);
  const originalRequest = http.request, originalHead = http.ServerResponse.prototype.writeHead;
  let internalNegotiations = 0, lockedPublications = 0;
  http.request = function (...args) { if (args[0]?.path === '/api/negotiate') internalNegotiations++; return originalRequest.apply(this, args); };
  http.ServerResponse.prototype.writeHead = function (...args) {
    if (this.req?.url === '/web-api/workspace' && args[0] === 200) {
      assert.equal(fs.existsSync(path.join(h.dataDir, '.tvs-database.lock')), true); lockedPublications++;
    }
    return originalHead.apply(this, args);
  };
  try {
    for (const [session, id] of [[owner, 'owner'], [viewer, 'viewer'], [narrow, 'narrow']]) {
      const result = await call(h.port, '/web-api/workspace', session);
      assert.equal(result.status, 200); assert.equal(result.body.access.user.id, id);
      assert.equal(result.headers['cache-control'], 'no-store'); assert.equal(result.headers.etag, undefined);
      assert.equal(/writeTicket|tokenHash/.test(result.text), false);
      if (id === 'narrow') { assert.equal(result.body.loadedSections.includes('auditLog'), true); assert.deepEqual(result.body.data.payments, []); assert.doesNotMatch(result.text, /SYNTHETIC-PRIVATE-FINANCE|87654321/); }
    }
  } finally { http.request = originalRequest; http.ServerResponse.prototype.writeHead = originalHead; }
  assert.equal(internalNegotiations, 0); assert.equal(lockedPublications, 3);
});

test('a disabled key or changed policy after frame preparation withholds the complete workspace', async t => {
  const h = await fixture(t), session = await h.login(), workspacePath = require.resolve('../web/workspace.cjs'), original = require(workspacePath);
  const usersBefore = fs.readFileSync(h.usersFile, 'utf8'); let mutation;
  require.cache[workspacePath].exports = { ...original, withWorkspaceFrame(dataDir, options, consume) {
    return original.withWorkspaceFrame(dataDir, options, frame => { if (mutation) { const change = mutation; mutation = null; change(); } return consume(frame); });
  } };
  try {
    for (const [change, status] of [[user => { user.enabled = false; }, 401], [user => { user.readable = ['vehicles']; user.writable = ['vehicles']; }, 409]]) {
      fs.writeFileSync(h.usersFile, usersBefore);
      mutation = () => { const settings = JSON.parse(usersBefore); change(settings.serverUsers.find(user => user.id === 'owner')); fs.writeFileSync(h.usersFile, JSON.stringify(settings)); };
      const result = await call(h.port, '/web-api/workspace', status === 401 ? session : await h.login());
      assert.equal(result.status, status); assert.equal(mutation, null);
      for (const key of ['data', 'revisions', 'access', 'databaseToken', 'loadedSections']) assert.equal(Object.hasOwn(result.body, key), false);
      assert.doesNotMatch(result.text, /SYNTHETIC-FEATURES-ZERO|SYNTHETIC-PRIVATE-FINANCE|87654321/);
    }
  } finally { require.cache[workspacePath].exports = original; fs.writeFileSync(h.usersFile, usersBefore); }
});

test('overlapping equal-role requests share one fresh read but retain independent actors and browser profiles', async t => {
  coalescingBarrier(t, 3);
  const h = await fixture(t), owner = await h.login(), keeper = await h.login(h.tokens.keeper.token), original = sqlite.readRawSections;
  const hello = compatibility.describe().hello, route = '/web-api/workspace?hello=' + encodeURIComponent(JSON.stringify({ ...hello, writerSchemaVersions: [] }));
  let reads = 0; sqlite.readRawSections = function (...args) { reads++; return original.apply(this, args); };
  try {
    const results = await Promise.all([call(h.port, '/web-api/workspace', owner), call(h.port, route, keeper), call(h.port, '/web-api/workspace', keeper)]);
    assert.equal(reads, 1);
    assert.deepEqual(results.map(result => result.status), [200, 200, 200]);
    assert.deepEqual(results.map(result => result.body.access.user.id), ['owner', 'keeper', 'keeper']);
    assert.deepEqual(results.map(result => result.body.platform.negotiation.writeCompatible), [true, false, true]);
    assert.deepEqual(results.map(result => result.body.readOnly), [false, true, false]);
    assert.deepEqual(results[0].body.data, results[1].body.data);
    const revision = results[0].body.revisions.vehicles;
    const db = new (require('node:sqlite').DatabaseSync)(sqlite.filename(h.dataDir));
    try { const current = JSON.parse(db.prepare("SELECT row_json FROM section_rows WHERE section='vehicles'").get().row_json); db.prepare("UPDATE section_rows SET row_json=? WHERE section='vehicles'").run(JSON.stringify({ ...current, note: 'Synthetic fresh cohort without a revision increment' })); } finally { db.close(); }
    const later = await call(h.port, '/web-api/workspace', owner);
    assert.equal(later.status, 200); assert.equal(reads, 2); assert.equal(later.body.revisions.vehicles, revision);
    assert.equal(later.body.data.vehicles[0].note, 'Synthetic fresh cohort without a revision increment');
  } finally { sqlite.readRawSections = original; }
});

test('a policy change before one shared acknowledgement does not expose data or deny its unaffected peer', async t => {
  coalescingBarrier(t, 2);
  const h = await fixture(t), owner = await h.login(), keeper = await h.login(h.tokens.keeper.token), filename = require.resolve('../web/workspace.cjs'), original = require(filename);
  let changed = false;
  require.cache[filename].exports = { ...original, withWorkspaceFrame(dataDir, options, consume) {
    return original.withWorkspaceFrame(dataDir, options, frame => {
      if (!changed) { changed = true; const settings = JSON.parse(fs.readFileSync(h.usersFile, 'utf8')); const user = settings.serverUsers.find(row => row.id === 'owner'); user.readable = ['vehicles']; user.writable = ['vehicles']; fs.writeFileSync(h.usersFile, JSON.stringify(settings)); }
      return consume(frame);
    });
  } };
  try {
    const [denied, allowed] = await Promise.all([call(h.port, '/web-api/workspace', owner), call(h.port, '/web-api/workspace', keeper)]);
    assert.equal(changed, true); assert.equal(denied.status, 409); assert.equal(denied.body.data, undefined);
    assert.doesNotMatch(denied.text, /SYNTHETIC-FEATURES-ZERO|SYNTHETIC-PRIVATE-FINANCE|87654321/);
    assert.equal(allowed.status, 200); assert.equal(allowed.body.access.user.id, 'keeper'); assert.equal(allowed.body.data.payments.length, 1);
  } finally { require.cache[filename].exports = original; }
});

test('different roles, section sets and narrowed accounts never share a business frame', async t => {
  coalescingBarrier(t, 4);
  const h = await fixture(t), users = JSON.parse(fs.readFileSync(h.usersFile, 'utf8'));
  users.serverUsers.find(row => row.id === 'viewer').role = 'dispatcher'; fs.writeFileSync(h.usersFile, JSON.stringify(users));
  const owner = await h.login(), dispatcher = await h.login(h.tokens.viewer.token), narrow = await h.login(h.tokens.narrow.token);
  const filename = require.resolve('../web/workspace.cjs'), original = require(filename); let frames = 0;
  require.cache[filename].exports = { ...original, withWorkspaceFrame(...args) { frames++; return original.withWorkspaceFrame(...args); } };
  try {
    const selected = '/web-api/workspace?sections=' + encodeURIComponent(JSON.stringify(['vehicles']));
    const results = await Promise.all([call(h.port, '/web-api/workspace', owner), call(h.port, '/web-api/workspace', dispatcher), call(h.port, selected, owner), call(h.port, '/web-api/workspace', narrow)]);
    assert.equal(frames, 4); assert.deepEqual(results.map(result => result.status), [200, 200, 200, 200]);
    assert.equal(results[0].body.data.payments.length, 1); assert.deepEqual(results[1].body.data.payments, []);
    assert.deepEqual(Object.keys(results[2].body.data), ['vehicles']); assert.deepEqual(results[3].body.data.payments, []);
    for (const result of [results[1], results[3]]) assert.doesNotMatch(result.text, /SYNTHETIC-PRIVATE-FINANCE|87654321/);
  } finally { require.cache[filename].exports = original; }
});

test('bootstrap shares only current storage metadata and gives every browser its own user and CSRF', async t => {
  const h = await fixture(t), owner = await h.login(), keeper = await h.login(h.tokens.keeper.token), narrow = await h.login(h.tokens.narrow.token);
  const responses = await Promise.all([call(h.port, '/web-api/bootstrap', owner), call(h.port, '/web-api/bootstrap', keeper), call(h.port, '/web-api/bootstrap', narrow)]);
  assert.deepEqual(responses.map(result => result.status), [200, 200, 200]);
  assert.deepEqual(responses.map(result => result.body.user.id), ['owner', 'keeper', 'narrow']);
  assert.deepEqual(responses.map(result => result.body.csrf), [owner.csrf, keeper.csrf, narrow.csrf]);
  assert.deepEqual(responses[2].body.access.readable, ['vehicles']);
  assert.equal(new Set(responses.map(result => result.body.databaseToken)).size, 1);
  for (const result of responses) { assert.equal(result.headers['cache-control'], 'no-store'); assert.doesNotMatch(result.text, /writeTicket|tokenHash|SYNTHETIC-PRIVATE-FINANCE|87654321/); assert.equal(result.body.data, undefined); }
  const ping = await call(h.port, '/web-api/ping', narrow);
  assert.equal(ping.status, 200); assert.equal(ping.body.access.user.id, 'narrow'); assert.deepEqual(ping.body.access.readable, ['vehicles']);
  assert.equal(ping.body.databaseToken, responses[2].body.databaseToken); assert.equal(ping.body.csrf, undefined); assert.equal(ping.body.sections, true);
});

test('fresh bootstrap and cache-context ping withhold metadata after a late key revocation', async t => {
  const h = await fixture(t), filename = require.resolve('../web/status.cjs'), original = require(filename), before = fs.readFileSync(h.usersFile, 'utf8'); let revoke = false;
  require.cache[filename].exports = { ...original, withStorageStatus(dataDir, consume) {
    return original.withStorageStatus(dataDir, fresh => { if (revoke) { revoke = false; const users = JSON.parse(before); users.serverUsers.find(user => user.id === 'owner').enabled = false; fs.writeFileSync(h.usersFile, JSON.stringify(users)); } return consume(fresh); });
  } };
  try {
    for (const route of ['/web-api/bootstrap', '/web-api/ping']) {
      fs.writeFileSync(h.usersFile, before); const owner = await h.login(); revoke = true;
      const result = await call(h.port, route, owner); assert.equal(result.status, 401); assert.equal(revoke, false);
      for (const key of ['data', 'access', 'csrf', 'databaseToken', 'platform']) assert.equal(Object.hasOwn(result.body, key), false);
    }
  } finally { require.cache[filename].exports = original; fs.writeFileSync(h.usersFile, before); }
});

test('HTTP gzip workspace decodes to the same current data and respects an explicit refusal', async t => {
  const h = await fixture(t), owner = await h.login(), baseline = await call(h.port, '/web-api/workspace', owner);
  const compressed = await fetch('http://127.0.0.1:' + h.port + '/web-api/workspace', { headers: { Cookie: owner.cookie, 'Accept-Encoding': 'gzip' } });
  assert.equal(compressed.status, 200); assert.equal(compressed.headers.get('content-encoding'), 'gzip'); assert.equal(compressed.headers.get('vary'), 'Accept-Encoding');
  assert.ok(Number(compressed.headers.get('content-length')) < Buffer.byteLength(baseline.text));
  assert.deepEqual(await compressed.json(), baseline.body);
  const refused = await call(h.port, '/web-api/workspace', { ...owner, headers: { 'Accept-Encoding': 'gzip;q=0, *;q=1' } });
  assert.equal(refused.status, 200); assert.equal(refused.headers['content-encoding'], undefined); assert.deepEqual(refused.body, baseline.body);
});

async function holdLock(dataDir, commitNote = false) {
  const memory = new SharedArrayBuffer(4), signal = new Int32Array(memory);
  const worker = new Worker("const {workerData,parentPort}=require('node:worker_threads');const storage=require(workerData.storage);storage.withDatabaseLock(workerData.dataDir,()=>{parentPort.postMessage('locked');Atomics.wait(new Int32Array(workerData.memory),0,0,10000);if(workerData.commitNote){const snapshot=storage.readSnapshot(workerData.dataDir);storage.writeSections(workerData.dataDir,{databaseToken:snapshot.databaseToken,base:{vehicles:snapshot.revisions.vehicles},sections:{vehicles:snapshot.data.vehicles.map(row=>({...row,note:'Synthetic committed while readers waited'}))}},{principal:{id:'synthetic-worker',name:'Synthetic worker',role:'admin'}});}});parentPort.close();", { eval: true, workerData: { dataDir, memory, commitNote, storage: require.resolve('../electron/storage.js') } });
  const finished = new Promise((resolve, reject) => { worker.once('exit', code => code === 0 ? resolve() : reject(Error('Synthetic lock worker failed'))); worker.once('error', reject); });
  await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
  let released = false;
  return async () => { if (released) return; released = true; Atomics.store(signal, 0, 1); Atomics.notify(signal, 0); await finished; };
}
test('LAN workspace waits safely for a managed writer and accepts only exact configured Host and Origin', async t => {
  const h = await fixture(t, { host: '0.0.0.0', allowedHosts: ['synthetic-tvs-server', '192.168.123.88'] });
  const host = 'synthetic-tvs-server:' + h.port, headers = { Host: host, Origin: 'http://' + host };
  const session = await h.login(undefined, headers), before = storage.readSnapshot(h.dataDir), release = await holdLock(h.dataDir);
  let result;
  try { const pending = call(h.port, '/web-api/workspace', session); await delay(120); await release(); result = await pending; }
  finally { await release(); }
  assert.equal(result.status, 200); assert.equal(result.body.platform.negotiation.writeCompatible, true); assert.equal(result.headers['set-cookie'], undefined);
  for (const rejected of [{ Host: 'synthetic-tvs-server.invalid:' + h.port }, { Host: 'synthetic-tvs-server:' + (h.port + 1) }, { Host: host, Origin: 'http://untrusted.invalid' }]) assert.equal((await call(h.port, '/web-api/workspace', { ...session, headers: rejected })).status, 403);
  assert.deepEqual(storage.readSnapshot(h.dataDir), before);
});

test('waiting page reads publish the committed state after the writer releases its lock', async t => {
  const h = await fixture(t), owner = await h.login(), keeper = await h.login(h.tokens.keeper.token), before = storage.readSnapshot(h.dataDir);
  const release = await holdLock(h.dataDir, true); let results;
  try {
    const reading = Promise.all([call(h.port, '/web-api/bootstrap', owner), call(h.port, '/web-api/workspace', owner), call(h.port, '/web-api/workspace', keeper)]);
    await delay(120); await release(); results = await reading;
  } finally { await release(); }
  assert.deepEqual(results.map(result => result.status), [200, 200, 200]);
  for (const result of results.slice(1)) { assert.equal(result.body.data.vehicles[0].note, 'Synthetic committed while readers waited'); assert.equal(result.body.revisions.vehicles, before.revisions.vehicles + 1); }
});

test('document HTTP adapters return exact PDF and attachment bytes, deny viewer uploads and route native sources', async t => {
  const rendered = [], pdf = Buffer.from('%PDF-1.7\nSynthetic trusted server PDF bytes\n%%EOF');
  const h = await fixture(t, { documentRenderHtmlPdf: async (html, options, assertCurrent) => { assertCurrent(); rendered.push({ html, options }); return pdf; } });
  const owner = await h.login(), viewer = await h.login(h.tokens.viewer.token), snapshot = (await call(h.port, '/web-api/snapshot', owner)).body;
  const original = Buffer.from('Synthetic original attachment · 923,537'), upload = { action: 'attachmentAdd', origin: { section: 'vehicles', id: 0 }, databaseToken: snapshot.databaseToken, source: { name: 'Synthetic.txt', base64: original.toString('base64') } };
  assert.equal((await post(h, viewer, '/web-api/attachment', upload)).status, 403);
  const added = await post(h, owner, '/web-api/attachment', upload); assert.equal(added.status, 200); assert.equal(added.body.file.sha256, hash(original)); assert.equal(added.body.file.proof.binding.id, 0);
  const saved = await post(h, owner, '/web-api/sections', { databaseToken: snapshot.databaseToken, base: { vehicles: snapshot.revisions.vehicles }, operation: { id: 'synthetic-gateway-attachment' }, sections: { vehicles: snapshot.data.vehicles.map(row => ({ ...row, attachments: [added.body.file] })) } });
  assert.equal(saved.status, 200); assert.equal(saved.body.ok, true);
  const downloaded = await post(h, viewer, '/web-api/attachment', { action: 'attachmentRead', origin: { section: 'vehicles', id: 0, fileId: added.body.file.id } });
  assert.equal(downloaded.status, 200); assert.equal(Buffer.from(downloaded.body.base64, 'base64').equals(original), true); assert.equal(downloaded.body.sha256, hash(original)); assert.equal(downloaded.body.bytes, original.length);
  const exported = await post(h, owner, '/web-api/export-pdf', { html: '<h1>Synthetic PDF source</h1>', defaultFileName: 'Synthetic.pdf' });
  assert.equal(exported.status, 200); assert.equal(rendered.length, 1); assert.equal(rendered[0].html.includes('Synthetic PDF source'), true);
  assert.equal(exported.body.mime, 'application/pdf'); assert.equal(exported.body.bytes, pdf.length); assert.equal(exported.body.sha256, hash(pdf)); assert.equal(Buffer.from(exported.body.base64, 'base64').equals(pdf), true);
  const list = await post(h, owner, '/web-api/document-print', { action: 'list' }); assert.equal(list.status, 200); assert.deepEqual(list.body.archives, []);
  const missing = await post(h, owner, '/web-api/inventory-report', { format: 'xlsx', sessionId: 'synthetic-missing', databaseToken: snapshot.databaseToken });
  assert.equal(missing.status, 404); assert.equal(missing.body.code, 'INVENTORY_EXPORT_MISSING');
  const source = Buffer.from('PK synthetic original Excel bytes'), native = { action: 'glonass', databaseToken: snapshot.databaseToken, source: { name: 'Synthetic.xlsx', base64: source.toString('base64') } };
  assert.equal((await post(h, viewer, '/web-api/native-import', native)).status, 403);
  const imported = await post(h, owner, '/web-api/native-import', native); assert.equal(imported.status, 200); assert.equal(imported.body.kind, 'xlsx'); assert.equal(Buffer.from(imported.body.base64, 'base64').equals(source), true); assert.equal(imported.body.sha256, hash(source));
});
