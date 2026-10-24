'use strict';
const {schemaWriterHeaders}=require('./helpers/http-writer.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const storage = require('../electron/storage');
const access = require('../electron/access-control');

const admin = { id:'admin', name:'Synthetic admin', role:'admin' };
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tvs-protocol-hardening-'));
  t.after(() => {
    const resolved = path.resolve(dir);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('tvs-protocol-hardening-'));
    fs.rmSync(resolved, { recursive:true, force:true });
  });
  storage.writeAll(dir, { vehicles:[{ id:'vehicle', name:'Original' }], records:[],
    payments:[{ id:'payment', date:'2026-10-01', amount:100 }] });
  return dir;
}
function changedData(snapshot, name) {
  return { vehicles:snapshot.data.vehicles.map(row => ({ ...row, name })), records:snapshot.data.records };
}
function fullOptions(snapshot, extra = {}) {
  return { databaseToken:snapshot.databaseToken, base:snapshot.revisions, principal:admin, ...extra };
}

// Exercise the real HTTP handler, access policy and on-disk storage without
// opening sockets. Only the temporary synthetic fixture is ever persisted.
async function protocol(t, { hook = () => {} } = {}) {
  const dir = fixture(t), serverPath = path.join(__dirname, '../electron/server.js');
  const localRequire = createRequire(serverPath), credentials = { admin:'synthetic-primary-admin-token', other:'synthetic-secondary-admin-token' };
  let settings = { serverAccessConfigured:true, serverUsers:access.normalizeServerUsers([
    { ...admin, enabled:true, tokenHash:access.hashToken(credentials.admin) },
    { id:'other', name:'Other admin', role:'admin', enabled:true, tokenHash:access.hashToken(credentials.other) },
  ]) };
  let handler, locked = false, backups = 0, requestPhase='idle', committed=false;
  const authLockStates = [], authEvents=[];
  const fakeHttp = { createServer(fn) {
    handler = fn;
    return Object.assign(new EventEmitter(), {
      listen(_port, _host, ready) { ready(); return this; }, address() { return { port:1 }; },
      close(done) { queueMicrotask(() => { this.emit('close'); done?.(); }); return this; },
    });
  } };
  const storageProxy = { ...storage,
    writeAll(...args) { const result=storage.writeAll(...args);if(result.ok===true&&!result.replayed)committed=true;return result; },
    writeSections(...args) { const result=storage.writeSections(...args);if(result.ok===true&&!result.replayed)committed=true;return result; },
    withDatabaseLock(dataDir, action) {
    return storage.withDatabaseLock(dataDir, () => {
      locked = true;
      try { if(requestPhase==='write')hook(); return action(); }
      finally { locked = false; }
    });
  } };
  const accessProxy = { ...access, authenticate(token, current) {
    authLockStates.push(locked);
    authEvents.push({locked,committed});
    return access.authenticate(token, current);
  } };
  const exported = { exports:{} };
  const context = { module:exported, exports:exported.exports, Buffer, console, setTimeout, clearTimeout,
    require(name) {
      if (name === 'http' || name === 'https') return fakeHttp;
      if (name === './storage') return storageProxy;
      if (name === './access-control') return accessProxy;
      return localRequire(name);
    } };
  vm.runInNewContext(fs.readFileSync(serverPath, 'utf8'), context, { filename:serverPath });
  const api = exported.exports;
  const started = await api.start({ port:0, dataDir:dir, settings:() => settings, backupFn:() => { backups++; } });
  assert.equal(started.ok, true);
  t.after(() => api.stop());
  async function dispatch(route,raw,headers,beforeEnd=()=>{},phase='write'){
    const req=Object.assign(new EventEmitter(),{method:'POST',url:route,headers,complete:false,resume(){}});let status;
    requestPhase=phase;
    try{return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Synthetic HTTP handler did not answer')),3000),res={destroyed:false,headersSent:false,writeHead(code){status=code;},end(text){clearTimeout(timer);resolve({status,body:JSON.parse(text)});}};handler(req,res);beforeEnd();req.emit('data',Buffer.from(raw));req.complete=true;req.emit('end');});}
    finally{requestPhase='idle';}
  }
  const harness = { dir, credentials, authLockStates, authEvents, get backups() { return backups; },
    changeUser(change) {
      settings = { ...settings, serverUsers:access.normalizeServerUsers(settings.serverUsers.map(user =>
        user.id === 'admin' ? { ...user, ...change } : user)) };
    },
    async request(route, body, beforeEnd = () => {}) {
      const raw=JSON.stringify(body),authentication={authorization:'Bearer '+credentials.admin};
      // The same real handler authenticates and signs the proof. Only transport
      // is virtual; no test secret, minted ticket or bypass enters production.
      const negotiated=await dispatch('/api/negotiate',JSON.stringify(require('../assets/core/platform-compatibility.js').describe().hello),authentication,()=>{},'negotiate');
      const headers={...schemaWriterHeaders(),...authentication,...(negotiated.body.writeTicket?{'x-tvs-write-ticket':negotiated.body.writeTicket}:{})};
      authLockStates.length=0;authEvents.length=0;committed=false;
      return dispatch(route,raw,headers,beforeEnd);
    },
    payload(name, operationId) {
      const snapshot = storage.readSnapshot(dir);
      return { databaseToken:snapshot.databaseToken, base:snapshot.revisions, data:changedData(snapshot, name),
        ...(operationId ? { operation:{ id:operationId } } : {}) };
    },
  };
  return harness;
}

test('ordinary full writes reject stale changed sections while legacy local calls remain compatible', t => {
  const dir = fixture(t), stale = storage.readSnapshot(dir);
  assert.equal(storage.writeSections(dir, { databaseToken:stale.databaseToken, base:stale.revisions,
    sections:{ vehicles:changedData(stale, 'Colleague').vehicles } }).ok, true);
  const before = storage.readSnapshot(dir);
  const rejected = storage.writeAll(dir, changedData(stale, 'Mine'), fullOptions(stale));
  assert.equal(rejected.ok, false); assert.deepEqual(rejected.conflicts, ['vehicles']);
  assert.deepEqual(storage.readSnapshot(dir), before);
  assert.equal(storage.writeAll(dir, changedData(before, 'Legacy local')).ok, true);
  assert.equal(storage.readAll(dir).vehicles[0].name, 'Legacy local');
});

test('full CAS requires versions only for actual changes and never a client version for trusted audit', t => {
  const dir = fixture(t), before = storage.readSnapshot(dir);
  const submitted = { ...before.data, vehicles:changedData(before, 'Mine').vehicles };
  const result = storage.writeAll(dir, submitted, fullOptions(before, { base:{ vehicles:before.revisions.vehicles, records:0 } }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.changed.sort(), ['auditLog', 'vehicles']);
  assert.equal(storage.readRevisions(dir).records, before.revisions.records);
  const unchanged = storage.readSnapshot(dir);
  const noop = storage.writeAll(dir, { vehicles:unchanged.data.vehicles, records:unchanged.data.records },
    { requireBase:true, base:{}, databaseToken:unchanged.databaseToken });
  assert.equal(noop.ok, true); assert.deepEqual(noop.changed, []);
});

test('modern full writes require complete, well-formed base revisions before persistence', t => {
  const dir = fixture(t), before = storage.readSnapshot(dir), data = changedData(before, 'Invalid');
  assert.throws(() => storage.writeAll(dir, data, { requireBase:true }), error => error.code === 'BASE_REQUIRED' && error.status === 428);
  for (const base of [null, [], '1', new Date(), { vehicles:-1 }, { vehicles:1.5 }, { vehicles:NaN }, { vehicles:Infinity }, { unknown:1 }]) {
    assert.throws(() => storage.writeAll(dir, data, { requireBase:true, base }), error => error.code === 'INVALID_BASE');
  }
  assert.throws(() => storage.writeAll(dir, data, { base:{} }), error => error.code === 'BASE_REQUIRED');
  assert.deepEqual(storage.readSnapshot(dir), before);
});

test('full operation replay precedes the revision conflict caused by its own commit', t => {
  const dir = fixture(t), original = storage.readSnapshot(dir), data = changedData(original, 'Committed');
  const options = fullOptions(original, { requireBase:true, operation:{ id:'full-replay' } });
  const first = storage.writeAll(dir, data, options), committed = storage.readSnapshot(dir);
  assert.equal(first.operationReceipt.status, 'committed');
  const replayed = storage.writeAll(dir, data, options);
  assert.equal(replayed.ok, true); assert.equal(replayed.replayed, true);
  assert.equal(replayed.operationReceipt.status, 'replayed'); assert.deepEqual(replayed.changed, []);
  assert.deepEqual(storage.readSnapshot(dir), committed);
});

test('only a trusted explicit administrator replacement can bypass full-write CAS', t => {
  const dir = fixture(t), stale = storage.readSnapshot(dir);
  storage.writeAll(dir, changedData(stale, 'Colleague'));
  const before = storage.readSnapshot(dir);
  for (const principal of [undefined, { id:'viewer', name:'Viewer', role:'viewer' }]) {
    assert.throws(() => storage.writeAll(dir, changedData(stale, 'Replace'), {
      ...fullOptions(stale), principal, replace:true,
    }), error => error.code === 'REPLACE_ACCESS_DENIED');
  }
  assert.deepEqual(storage.readSnapshot(dir), before);
  assert.equal(storage.writeAll(dir, changedData(stale, 'Restore'), fullOptions(stale, { replace:true })).ok, true);
  assert.equal(storage.readAll(dir).vehicles[0].name, 'Restore');
  assert.throws(() => storage.writeAll(dir, { vehicles:before.data.vehicles,
    records:[{ id:'bad', vehicleId:'missing', date:'2026-10-01', km:10 }] },
  fullOptions(before, { replace:true })), /связ|источник|отсутств|reference/i);
});

test('HTTP full writes require valid base and cannot opt into trusted replacement', async t => {
  const h = await protocol(t), before = storage.readSnapshot(h.dir), missing = h.payload('Missing');
  delete missing.base;
  const absent = await h.request('/api/data', missing);
  assert.equal(absent.status, 428); assert.equal(absent.body.code, 'BASE_REQUIRED');
  const invalid = await h.request('/api/data', { ...h.payload('Invalid'), base:{ vehicles:-1 } });
  assert.equal(invalid.status, 400); assert.equal(invalid.body.code, 'INVALID_BASE');
  const incomplete = await h.request('/api/data', { ...h.payload('Incomplete'), base:{} });
  assert.equal(incomplete.status, 428);
  assert.deepEqual(storage.readSnapshot(h.dir), before);
  const stale = h.payload('Stale');
  storage.writeAll(h.dir, changedData(before, 'Colleague'));
  const current = storage.readSnapshot(h.dir);
  const rejected = await h.request('/api/data', { ...stale, replace:true, requireBase:false });
  assert.equal(rejected.status, 409); assert.deepEqual(rejected.body.conflicts, ['vehicles']);
  assert.deepEqual(storage.readSnapshot(h.dir), current);
});

test('HTTP full writes acknowledge and replay one durable operation exactly once', async t => {
  const h = await protocol(t), body = h.payload('HTTP commit', 'http-full-replay');
  const first = await h.request('/api/data', body), beforeRetry = storage.readSnapshot(h.dir);
  assert.equal(first.status, 200); assert.equal(first.body.operationReceipt.status, 'committed');
  const second = await h.request('/api/data', body);
  assert.equal(second.status, 200); assert.equal(second.body.replayed, true);
  assert.equal(second.body.operationReceipt.status, 'replayed');
  assert.deepEqual(storage.readSnapshot(h.dir), beforeRetry);
  assert.equal(beforeRetry.data.auditLog.filter(row => row.type === 'transaction' && row.operationId === 'http-full-replay').length, 1);
});

for (const route of ['/api/data', '/api/sections']) {
  test('revoking an authenticated user while reading ' + route + ' prevents backup and write', async t => {
    const h = await protocol(t), before = storage.readSnapshot(h.dir), body = h.payload('Revoked');
    if (route.endsWith('sections')) { body.sections = { vehicles:body.data.vehicles }; delete body.data; }
    const result = await h.request(route, body, () => h.changeUser({ enabled:false }));
    assert.equal(result.status, 401); assert.equal(h.backups, 0);
    assert.deepEqual(storage.readSnapshot(h.dir), before);
    assert.deepEqual(h.authLockStates, [false, false]);
  });
  test('revoking an authenticated user under the lock for ' + route + ' prevents backup and write', async t => {
    let h;h=await protocol(t,{hook:()=>h.changeUser({enabled:false})});
    const before=storage.readSnapshot(h.dir),body=h.payload('Revoked under lock');
    if(route.endsWith('sections')){body.sections={vehicles:body.data.vehicles};delete body.data;}
    const result=await h.request(route,body);
    assert.equal(result.status,401);assert.equal(result.body.code,'ACCESS_REVOKED');assert.equal(h.backups,0);
    assert.deepEqual(storage.readSnapshot(h.dir),before);assert.deepEqual(h.authLockStates,[false,false,true]);
    assert.equal(h.authEvents.some(event=>event.committed),false);
  });
}

for (const change of [{ tokenHash:access.hashToken('rotated-synthetic-token') }, { expiresAt:'2000-01-01T00:00:00Z' }]) {
  test('token rotation or expiry during body upload prevents committing the old authorization ' + Object.keys(change)[0], async t => {
    const h = await protocol(t), before = storage.readSnapshot(h.dir), full = h.payload('Expired');
    const body = { databaseToken:full.databaseToken, base:full.base, sections:{ vehicles:full.data.vehicles } };
    const result = await h.request('/api/sections', body, () => h.changeUser(change));
    assert.equal(result.status, 401); assert.equal(h.backups, 0);
    assert.deepEqual(storage.readSnapshot(h.dir), before);
  });
}

test('a changed role is enforced under the database lock before an ordinary write', async t => {
  const h = await protocol(t), before = storage.readSnapshot(h.dir), full = h.payload('Denied');
  const body = { databaseToken:full.databaseToken, base:full.base, sections:{ vehicles:full.data.vehicles } };
  const result = await h.request('/api/sections', body, () => h.changeUser({ role:'viewer' }));
  assert.equal(result.status,428);assert.equal(result.body.code,'PROTOCOL_RENEGOTIATE');
  assert.deepEqual(storage.readSnapshot(h.dir),before);
  const current = await h.request('/api/sections',body);
  assert.equal(current.status,403);
  assert.deepEqual(storage.readSnapshot(h.dir), before);
});

test('the current permitted role and name own canonical audit and ACK filtering', async t => {
  let h;
  h = await protocol(t, { hook:() => h.changeUser({ role:'dispatcher', name:'Current dispatcher' }) });
  const full = h.payload('Permitted', 'current-principal'), body = {
    databaseToken:full.databaseToken, base:full.base, operation:full.operation, sections:{ vehicles:full.data.vehicles },
  };
  const before=storage.readSnapshot(h.dir),stale = await h.request('/api/sections', body);
  assert.equal(stale.status,403);assert.equal(stale.body.code,'ACCESS_CHANGED');assert.equal(h.backups,0);
  assert.deepEqual(storage.readSnapshot(h.dir),before);assert.equal(h.authEvents.at(-1).locked,true);assert.equal(h.authEvents.some(event=>event.committed),false);
  const result = await h.request('/api/sections', body);
  assert.equal(result.status, 200); assert.equal(result.body.revisions.payments, 0);
  const event = storage.readAll(h.dir).auditLog.find(row => row.operationId === 'current-principal' && row.section === 'vehicles');
  assert.equal(event.actorRole, 'dispatcher'); assert.equal(event.actor, 'Current dispatcher');
  assert.ok(result.body.canonicalSections.auditLog.every(row => row.section !== 'payments'));
  assert.equal(h.authEvents[0].locked,false);
  assert.ok(h.authEvents.some(event=>event.locked&&!event.committed));
  assert.deepEqual(h.authEvents.at(-1),{locked:false,committed:true});
});

test('a revoked user cannot receive even a replay acknowledgement for a prior operation', async t => {
  const h = await protocol(t), body = h.payload('Committed', 'revoke-before-replay');
  assert.equal((await h.request('/api/data', body)).status, 200);
  const committed = storage.readSnapshot(h.dir), priorBackups = h.backups;
  const result = await h.request('/api/data', body, () => h.changeUser({ enabled:false }));
  assert.equal(result.status, 401); assert.equal(h.backups, priorBackups);
  assert.deepEqual(storage.readSnapshot(h.dir), committed);
});
