'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const access = require('../electron/access-control.js');
const MAX_FILE_BYTES = 2 * 1024 * 1024;
function freshLoader() { const filename = require.resolve('../web/user-settings.cjs'); delete require.cache[filename]; return require(filename).loadUsers; }
function fixture(t, { expiry = null, scoped = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tvs-web-user-settings-')), filename = path.join(root, 'users.json');
  const owner = access.issueToken(), worker = access.issueToken();
  const rows = [
    { id: 'owner', name: 'Synthetic owner', role: 'admin', enabled: true, tokenHash: owner.tokenHash, ...(expiry ? { expiresAt: expiry } : {}) },
    { id: 'worker', name: 'Synthetic worker A', role: 'viewer', enabled: true, tokenHash: worker.tokenHash, ...(scoped ? { accessPolicy: { version: 1, grants: [{ org: 'A', site: 'north' }] }, readable: ['vehicles'], writable: [] } : {}) },
  ];
  const write = value => fs.writeFileSync(filename, typeof value === 'string' ? value : JSON.stringify(value)); write({ serverUsers: rows });
  t.after(() => { const absolute = fs.realpathSync(root); assert.equal(path.dirname(absolute), fs.realpathSync(os.tmpdir())); assert.match(path.basename(absolute), /^tvs-web-user-settings-/); assert.equal(fs.lstatSync(root).isSymbolicLink(), false); fs.rmSync(absolute, { recursive: true, force: true }); });
  return { root, filename, rows, owner, worker, write };
}
function countNormalizations() {
  const original = access.normalizeServerUsers; let calls = 0;
  access.normalizeServerUsers = (...args) => { calls++; return original(...args); };
  return { get calls() { return calls; }, restore() { access.normalizeServerUsers = original; } };
}

test('identical fresh bytes reuse validation while every caller receives separate mutable settings', t => {
  const f = fixture(t, { scoped: true }), loadUsers = freshLoader(), counter = countNormalizations();
  const read = fs.readSync; let fileReads = 0; fs.readSync = (...args) => { fileReads++; return read(...args); };
  try {
    const first = loadUsers(f.filename), beforeWarm = fileReads;
    assert.equal(first.serverAccessConfigured, true); assert.equal(Object.isFrozen(first), false); assert.equal(Object.isFrozen(first.serverUsers), false);
    first.serverUsers[0].enabled = false; first.serverUsers[1].name = 'Caller mutation'; first.serverUsers[1].accessPolicy.grants[0].org = 'POISON'; first.serverUsers[1].readable.push('payments');
    const second = loadUsers(f.filename);
    assert.equal(counter.calls, 1); assert.ok(fileReads > beforeWarm, 'A warm hit must still read current file bytes.');
    assert.equal(second.serverUsers[0].enabled, true); assert.equal(second.serverUsers[1].name, 'Synthetic worker A'); assert.equal(second.serverUsers[1].accessPolicy.grants[0].org, 'A'); assert.deepEqual(second.serverUsers[1].readable, ['vehicles']);
    assert.notEqual(first, second); assert.notEqual(first.serverUsers, second.serverUsers);
  } finally { fs.readSync = read; counter.restore(); }
});

test('same size and restored mtime do not hide changed bytes', t => {
  const f = fixture(t), loadUsers = freshLoader(), counter = countNormalizations();
  try {
    loadUsers(f.filename); const before = fs.statSync(f.filename), content = fs.readFileSync(f.filename, 'utf8');
    f.write(content.replace('Synthetic worker A', 'Synthetic worker B')); fs.utimesSync(f.filename, before.atime, before.mtime);
    assert.equal(fs.statSync(f.filename).size, before.size); assert.equal(loadUsers(f.filename).serverUsers[1].name, 'Synthetic worker B'); assert.equal(counter.calls, 2);
  } finally { counter.restore(); }
});

test('fresh role, scope, key rotation and disable changes reach authentication immediately', t => {
  const f = fixture(t, { scoped: true }), loadUsers = freshLoader();
  const authenticate = token => access.authenticate(token, loadUsers(f.filename), { allowLegacy: false });
  const initial = authenticate(f.worker.token); assert.equal(initial.role, 'viewer');
  f.rows[1].role = 'dispatcher'; f.write({ serverUsers: f.rows }); assert.equal(authenticate(f.worker.token).role, 'dispatcher');
  f.rows[1].accessPolicy.grants[0].org = 'B'; f.write({ serverUsers: f.rows });
  const narrowed = authenticate(f.worker.token); assert.equal(narrowed.accessPolicy.grants[0].org, 'B'); assert.notEqual(narrowed.policyStamp, initial.policyStamp);
  const rotated = access.issueToken(); f.rows[1].tokenHash = rotated.tokenHash; f.write({ serverUsers: f.rows });
  assert.equal(authenticate(f.worker.token), null); assert.equal(authenticate(rotated.token).id, 'worker');
  f.rows[1].enabled = false; f.write({ serverUsers: f.rows }); assert.equal(authenticate(rotated.token), null);
});

test('byte-identical warm settings still fail when the last enabled administrator expires', t => {
  const expires = Date.parse('2035-01-01T00:00:00.000Z'), f = fixture(t, { expiry: new Date(expires).toISOString() }), loadUsers = freshLoader(), counter = countNormalizations(), now = Date.now;
  try {
    Date.now = () => expires - 1; loadUsers(f.filename); assert.equal(counter.calls, 1);
    Date.now = () => expires; assert.throws(() => loadUsers(f.filename), /действующую учётную запись администратора/); assert.equal(counter.calls, 1);
    Date.now = () => expires + 86400000; assert.throws(() => loadUsers(f.filename), /действующую учётную запись администратора/); assert.equal(counter.calls, 1);
  } finally { Date.now = now; counter.restore(); }
});

test('a missing, invalid, oversized or nonregular file cannot fall back to previously validated users', t => {
  const f = fixture(t), loadUsers = freshLoader(); loadUsers(f.filename);
  fs.unlinkSync(f.filename); assert.throws(() => loadUsers(f.filename), { code: 'ENOENT' });
  f.write('{"serverUsers":'); assert.throws(() => loadUsers(f.filename), SyntaxError);
  f.write({ serverUsers: [] }); assert.throws(() => loadUsers(f.filename), /Нужны персональные/);
  fs.writeFileSync(f.filename, Buffer.alloc(MAX_FILE_BYTES + 1, 0x20)); assert.throws(() => loadUsers(f.filename), { code: 'WEB_USERS_FILE_INVALID' });
  fs.unlinkSync(f.filename); fs.mkdirSync(f.filename); assert.throws(() => loadUsers(f.filename), { code: 'WEB_USERS_FILE_INVALID' }); fs.rmdirSync(f.filename);
  const target = path.join(f.root, 'target.json'); fs.writeFileSync(target, JSON.stringify({ serverUsers: f.rows }));
  // Exercise the warm kind check even on Windows accounts that cannot create
  // an actual symlink without administrator/developer-mode privileges.
  fs.copyFileSync(target, f.filename); const lstat = fs.lstatSync;
  fs.lstatSync = (filename, ...args) => { const stat = lstat(filename, ...args); return path.resolve(filename) === f.filename ? { ...stat, isFile: () => true, isSymbolicLink: () => true } : stat; };
  try { assert.throws(() => loadUsers(f.filename), { code: 'WEB_USERS_FILE_INVALID' }); }
  finally { fs.lstatSync = lstat; fs.unlinkSync(f.filename); }
  try { fs.symlinkSync(target, f.filename, 'file'); }
  catch (error) { if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error; t.diagnostic('Symlink creation unavailable; other fail-closed file checks completed.'); return; }
  assert.throws(() => loadUsers(f.filename), { code: 'WEB_USERS_FILE_INVALID' });
});

test('eight-entry LRU bounds validation memo rather than retaining every historical settings file', t => {
  const f = fixture(t), loadUsers = freshLoader(), counter = countNormalizations();
  try {
    const first = JSON.stringify({ serverUsers: f.rows }); loadUsers(f.filename);
    for (let index = 1; index <= 8; index++) { f.rows[0].name = 'Synthetic owner ' + index; f.write({ serverUsers: f.rows }); loadUsers(f.filename); }
    assert.equal(counter.calls, 9); loadUsers(f.filename); assert.equal(counter.calls, 9);
    f.write(first); loadUsers(f.filename); assert.equal(counter.calls, 10);
  } finally { counter.restore(); }
});

test('four MiB byte budget evicts large raw files even before the eight-entry limit', t => {
  const f = fixture(t), loadUsers = freshLoader(), counter = countNormalizations();
  const base = JSON.stringify({ serverUsers: f.rows, padding: '' }), length = MAX_FILE_BYTES - 8 - Buffer.byteLength(base);
  const document = value => JSON.stringify({ serverUsers: f.rows, padding: value.repeat(length) });
  try {
    const first = document('a'), second = document('b'); assert.equal(Buffer.byteLength(first), MAX_FILE_BYTES - 8);
    f.write(first); loadUsers(f.filename); f.write(second); loadUsers(f.filename); assert.equal(counter.calls, 2);
    f.write(first); loadUsers(f.filename); assert.equal(counter.calls, 3);
  } finally { counter.restore(); }
});

test('exact raw-byte equality is mandatory even if SHA digests collide', t => {
  const f = fixture(t), loadUsers = freshLoader(), counter = countNormalizations(), createHash = crypto.createHash;
  crypto.createHash = function (...args) { const value = createHash.apply(this, args), digest = value.digest; value.digest = function (...params) { const result = digest.apply(this, params); return params[0] === 'hex' ? 'f'.repeat(64) : result; }; return value; };
  try {
    loadUsers(f.filename); f.rows[1].name = 'Synthetic worker B'; f.write({ serverUsers: f.rows });
    assert.equal(loadUsers(f.filename).serverUsers[1].name, 'Synthetic worker B'); assert.equal(counter.calls, 2);
    loadUsers(f.filename); assert.equal(counter.calls, 2);
  } finally { crypto.createHash = createHash; counter.restore(); }
});

test('CLI loadUsers retains its public loader contract', t => {
  const f = fixture(t), cli = require('../web/cli.cjs');
  const settings = cli.loadUsers(f.filename); assert.equal(settings.serverAccessConfigured, true); assert.equal(settings.serverUsers.length, 2); assert.equal(settings.serverUsers[0].id, 'owner');
});
