'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createWebOutbox } = require('../web/outbox.cjs');
const storage = require('../electron/storage');
const principal = { id: 'synthetic-web-admin', name: 'Synthetic web admin', role: 'admin' };

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tvs-web-outbox-'));
  t.after(() => { assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('tvs-web-outbox-')); fs.rmSync(root, { recursive: true, force: true }); });
  const directory = path.join(root, 'database'), rootDir = path.join(root, 'outbox');
  const data = Object.fromEntries(storage.SECTIONS.map(name => [name, []]));
  data.vehicles = [{ id: 'web-car', plate: 'SYNTHETIC WEB' }];
  storage.createJson(directory, { data, revisions: Object.fromEntries(storage.SECTIONS.map(name => [name, 0])) });
  const snapshot = storage.readSnapshot(directory), access = { user: principal, policyStamp: 'sha256:' + 'a'.repeat(64), readable: storage.SECTIONS, writable: storage.SECTIONS };
  const context = { databaseToken: snapshot.databaseToken, principal, access, webSession: { token: 'synthetic-secret-never-persist' } };
  const payload = { databaseToken: snapshot.databaseToken, base: snapshot.revisions, sections: { vehicles: [{ ...data.vehicles[0], note: 'Reviewed synthetic note' }] }, operation: { id: 'web-lost-ack' } };
  const send = async (current, json) => storage.writeSections(directory, JSON.parse(json), { principal: current.principal });
  const lookup = async (current, id, digest) => storage.readOperation(directory, { id, digest }, current.principal);
  return { root, directory, rootDir, context, payload, send, lookup };
}

test('web outbox recovers a lost ACK after restart without persisting credentials or a second write', async t => {
  const f = fixture(t); let writes = 0;
  const box = createWebOutbox({ rootDir: f.rootDir, lookup: f.lookup, send: async (context, json) => { writes++; await f.send(context, json); throw Error('Synthetic lost ACK'); } });
  const unknown = await box.execute(f.context, f.payload);
  assert.equal(unknown.queued, true);
  const rows = await box.list(f.context);
  assert.equal(rows[0].status, 'unknown');
  const persisted = fs.readdirSync(f.rootDir).filter(name => name.endsWith('.json')).map(name => fs.readFileSync(path.join(f.rootDir, name), 'utf8')).join('');
  assert.ok(!persisted.includes(f.context.webSession.token));
  const restarted = createWebOutbox({ rootDir: f.rootDir, lookup: f.lookup, send: async () => { throw Error('Read-only reconciliation must not send'); } });
  assert.equal((await restarted.reconcile(f.context, f.payload.operation.id)).committed, true);
  assert.equal(writes, 1);
  assert.equal(storage.readAll(f.directory).vehicles[0].note, 'Reviewed synthetic note');
  const other = { ...f.context, access: { ...f.context.access, user: { ...principal, id: 'other-synthetic-user' } } };
  assert.equal((await restarted.list(other)).length, 0);
});

test('web outbox verifies current access before saving any intent', async t => {
  const f = fixture(t); let sends = 0;
  const box = createWebOutbox({ rootDir: f.rootDir, lookup: f.lookup, send: async () => { sends++; }, assertCurrent: () => { throw Object.assign(Error('Synthetic revoked user'), { code: 'ACCESS_REVOKED' }); } });
  await assert.rejects(box.execute(f.context, f.payload), error => error.code === 'ACCESS_REVOKED');
  assert.equal(sends, 0);
  assert.ok(!fs.readdirSync(f.rootDir).some(name => !name.startsWith('.')));
});

test('revocation after backend commit leaves an uncertain ACK for receipt reconciliation', async t => {
  const f = fixture(t); let revoked = false;
  const box = createWebOutbox({ rootDir: f.rootDir, lookup: f.lookup,
    assertCurrent: () => { if (revoked) throw Object.assign(Error('Synthetic post-commit revocation'), { code: 'ACCESS_REVOKED', status: 401 }); },
    send: async (context, json) => { const response = await f.send(context, json); revoked = true; return response; },
  });
  await assert.rejects(box.execute(f.context, f.payload), error => error.unknown === true && error.definitive === false && error.code === 'STORAGE_ACK_STALE');
  revoked = false;
  assert.equal((await box.list(f.context))[0].status, 'unknown');
  assert.equal((await box.reconcile(f.context, f.payload.operation.id)).committed, true);
});
