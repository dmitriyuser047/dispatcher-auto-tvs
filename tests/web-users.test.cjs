'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const vm = require('node:vm');
const access = require('../electron/access-control.js');
const { createUserService, canManageUsers } = require('../web/users.cjs');

function fixture(t, { object = false, users = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tvs-web-users-synthetic-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const usersFile = path.join(root, 'users.json'), owner = access.issueToken(), employee = access.issueToken();
  const rows = [
    { id: 'owner', name: 'Synthetic owner', role: 'admin', enabled: true, tokenHash: owner.tokenHash },
    { id: 'employee', name: 'Synthetic employee', role: 'viewer', enabled: true, tokenHash: employee.tokenHash },
    ...users,
  ];
  const write = rows => fs.writeFileSync(usersFile, JSON.stringify(object ? { serverUsers: rows, serverAccessConfigured: true, label: 'Synthetic metadata' } : rows, null, 2));
  write(rows);
  const service = createUserService({ usersFile });
  const list = () => service.list({ token: owner.token });
  const mutate = input => service.mutate({ token: owner.token, input: { version: list().version, ...input } });
  const read = () => { const doc = JSON.parse(fs.readFileSync(usersFile, 'utf8')); return Array.isArray(doc) ? doc : doc.serverUsers; };
  return { root, usersFile, service, owner, employee, rows, read, write, list, mutate };
}
const denied = (run, code, status) => assert.throws(run, error => error.code === code && (!status || error.status === status));

test('only current unrestricted personal administrators can list or change employees', t => {
  const narrow = access.issueToken(), scoped = access.issueToken();
  const f = fixture(t, { users: [
    { id: 'narrow', name: 'Synthetic narrow admin', role: 'admin', enabled: true, tokenHash: narrow.tokenHash, readable: ['vehicles'], writable: ['vehicles'] },
    { id: 'scoped', name: 'Synthetic scoped admin', role: 'admin', enabled: true, tokenHash: scoped.tokenHash, accessPolicy: { version: 1, grants: [] } },
  ] });
  for (const token of [f.employee.token, narrow.token, scoped.token]) {
    denied(() => f.service.list({ token }), 'USERS_ACCESS_DENIED', 403);
    denied(() => f.service.mutate({ token, input: null }), 'USERS_ACCESS_DENIED', 403);
  }
  denied(() => f.service.list({ token: 'tvs_synthetic-invalid-key' }), 'ACCESS_REVOKED', 401);
  assert.equal(canManageUsers({ id: 'legacy', role: 'admin', legacy: true }), false);
  assert.equal(canManageUsers({ id: 'full', role: 'admin', readable: ['*'], writable: ['*'] }), true);
  assert.equal(canManageUsers({ id: 'fields', role: 'admin', readFields: { vehicles: ['id'] } }), false);
  const result = f.list();
  assert.equal(result.selfId, 'owner'); assert.match(result.version, /^[a-f0-9]{64}$/);
  assert.equal(result.users.find(row => row.id === 'narrow').restricted, true);
  assert.equal(result.roles.length, 5);
  const output = JSON.stringify(result);
  assert.doesNotMatch(output, /tokenHash|"key"|tvs_/);
  assert.ok(!output.includes(f.owner.tokenHash));
});

test('create returns a random personal key once and persists only its hash', t => {
  const f = fixture(t, { object: true });
  const result = f.mutate({ action: 'create', name: '  Synthetic dispatcher  ', role: 'dispatcher', enabled: true });
  assert.match(result.key, /^tvs_[a-f0-9]{64}$/);
  assert.match(result.user.id, /^employee-[a-f0-9-]+$/);
  assert.equal(result.user.name, 'Synthetic dispatcher');
  const content = fs.readFileSync(f.usersFile, 'utf8'), document = JSON.parse(content);
  assert.ok(!content.includes(result.key)); assert.equal(document.label, 'Synthetic metadata');
  const saved = f.read().find(row => row.id === result.user.id);
  assert.equal(saved.tokenHash, access.hashToken(result.key));
  assert.equal(saved.createdAt, result.user.createdAt);
  assert.equal(access.authenticate(result.key, { serverUsers: f.read() }, { allowLegacy: false }).role, 'dispatcher');
  assert.equal(f.list().key, undefined);
  assert.equal(f.list().version, result.version);
  assert.deepEqual(fs.readdirSync(f.root), ['users.json']);
});

test('updates preserve restrictions, rotate revokes previous key and disabled account stays disabled', t => {
  const f = fixture(t);
  const rows = f.read(); rows[1].readable = ['vehicles']; rows[1].writable = []; f.write(rows);
  const updated = f.mutate({ action: 'update', id: 'employee', name: 'Synthetic mechanic', role: 'mechanic', enabled: false });
  assert.equal(updated.key, undefined);
  assert.equal(updated.user.enabled, false);
  assert.deepEqual(f.read()[1].readable, ['vehicles']); assert.deepEqual(f.read()[1].writable, []);
  const oldHash = f.read()[1].tokenHash;
  const rotated = f.mutate({ action: 'rotate-key', id: 'employee' });
  assert.notEqual(f.read()[1].tokenHash, oldHash);
  assert.ok(rotated.user.rotatedAt); assert.equal(rotated.user.enabled, false);
  assert.equal(access.authenticate(f.employee.token, { serverUsers: f.read() }), null);
  assert.equal(access.authenticate(rotated.key, { serverUsers: f.read() }), null);
  f.mutate({ action: 'update', id: 'employee', name: 'Synthetic mechanic', role: 'mechanic', enabled: true });
  assert.equal(access.authenticate(rotated.key, { serverUsers: f.read() }).id, 'employee');
  assert.deepEqual(f.read()[1].readable, ['vehicles']);
});

test('self disable and self demotion are rejected even with another administrator', t => {
  const other = access.issueToken();
  const f = fixture(t, { users: [{ id: 'other-admin', name: 'Synthetic other admin', role: 'admin', enabled: true, tokenHash: other.tokenHash }] });
  const before = fs.readFileSync(f.usersFile, 'utf8');
  denied(() => f.mutate({ action: 'update', id: 'owner', name: 'Synthetic owner', role: 'admin', enabled: false }), 'USER_SELF_ACCESS', 409);
  denied(() => f.mutate({ action: 'update', id: 'owner', name: 'Synthetic owner', role: 'viewer', enabled: true }), 'USER_SELF_ACCESS', 409);
  assert.equal(fs.readFileSync(f.usersFile, 'utf8'), before);
  f.mutate({ action: 'update', id: 'other-admin', name: 'Synthetic other admin', role: 'viewer', enabled: false });
  assert.equal(f.read().filter(row => row.enabled && row.role === 'admin').length, 1);
});

test('self rotation returns one-time key and requires a new login', t => {
  const f = fixture(t), result = f.mutate({ action: 'rotate-key', id: 'owner' });
  assert.equal(result.reauthenticate, true);
  denied(f.list, 'ACCESS_REVOKED', 401);
  assert.equal(f.service.list({ token: result.key }).selfId, 'owner');
  assert.ok(!fs.readFileSync(f.usersFile, 'utf8').includes(result.key));
});

test('stale versions do not overwrite newer employee changes', t => {
  const f = fixture(t), before = f.list();
  f.mutate({ action: 'update', id: 'employee', name: 'Synthetic newer name', role: 'dispatcher', enabled: true });
  const latest = fs.readFileSync(f.usersFile, 'utf8');
  denied(() => f.service.mutate({ token: f.owner.token, input: { action: 'update', version: before.version, id: 'employee', name: 'Synthetic stale name', role: 'viewer', enabled: false } }), 'USERS_CHANGED', 409);
  assert.equal(fs.readFileSync(f.usersFile, 'utf8'), latest);
  assert.deepEqual(fs.readdirSync(f.root), ['users.json']);
});

test('rights are revalidated from disk for each mutation', t => {
  const other = access.issueToken();
  const f = fixture(t, { users: [{ id: 'other-admin', name: 'Synthetic other admin', role: 'admin', enabled: true, tokenHash: other.tokenHash }] });
  const captured = f.list(), rows = f.read(); rows[0].role = 'viewer'; f.write(rows);
  denied(() => f.service.mutate({ token: f.owner.token, input: { action: 'create', version: captured.version, name: 'Synthetic rejected', role: 'admin', enabled: true } }), 'USERS_ACCESS_DENIED', 403);
  rows[0].enabled = false; f.write(rows);
  denied(() => f.service.mutate({ token: f.owner.token, input: { action: 'rotate-key', version: captured.version, id: 'employee' } }), 'ACCESS_REVOKED', 401);
  assert.equal(f.read().length, 3);
});

test('exclusive file lock prevents overlapping writers without deleting another lock', t => {
  const f = fixture(t), lockFile = f.usersFile + '.lock'; fs.writeFileSync(lockFile, 'synthetic other writer');
  const before = fs.readFileSync(f.usersFile, 'utf8');
  denied(() => f.mutate({ action: 'rotate-key', id: 'employee' }), 'USERS_BUSY', 503);
  assert.equal(fs.readFileSync(f.usersFile, 'utf8'), before);
  assert.equal(fs.readFileSync(lockFile, 'utf8'), 'synthetic other writer');
});

test('external file edit before replace is caught and temporary key file is removed', t => {
  const f = fixture(t), original = fs.fsyncSync;
  const external = f.read(); external[1].name = 'Synthetic external edit';
  fs.fsyncSync = fd => { original(fd); f.write(external); };
  try { denied(() => f.mutate({ action: 'rotate-key', id: 'employee' }), 'USERS_CHANGED', 409); }
  finally { fs.fsyncSync = original; }
  assert.equal(f.read()[1].name, 'Synthetic external edit');
  assert.equal(f.read()[1].tokenHash, f.employee.tokenHash);
  assert.deepEqual(fs.readdirSync(f.root), ['users.json']);
});

test('failure to replace file preserves prior keys and does not return generated key', t => {
  const f = fixture(t), before = fs.readFileSync(f.usersFile, 'utf8'), original = fs.renameSync;
  fs.renameSync = () => { throw Object.assign(Error('Synthetic replace denied'), { code: 'EACCES' }); };
  try { denied(() => f.mutate({ action: 'rotate-key', id: 'employee' }), 'USERS_SAVE_FAILED', 503); }
  finally { fs.renameSync = original; }
  assert.equal(fs.readFileSync(f.usersFile, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(f.root), ['users.json']);
});

test('browser cannot supply a key, hash, restrictions or unsupported role', t => {
  const f = fixture(t), base = { action: 'create', name: 'Synthetic invalid', role: 'viewer', enabled: true };
  for (const extra of [{ tokenHash: 'a'.repeat(64) }, { key: 'tvs_synthetic-key' }, { accessPolicy: { version: 1, grants: [] } }, { readable: ['*'] }, { id: 'attacker' }, { role: '__proto__' }, { enabled: 'true' }, { name: 'Synthetic\nnewline' }]) {
    denied(() => f.mutate({ ...base, ...extra }), 'USER_INPUT_INVALID', 400);
  }
  assert.equal(f.read().length, 2);
});

test('invalid private file fails closed without returning parse details or hashes', t => {
  const f = fixture(t); fs.writeFileSync(f.usersFile, '{"tokenHash":"synthetic-private-detail"');
  assert.throws(f.list, error => error.code === 'USERS_UNAVAILABLE' && !error.message.includes('synthetic-private-detail'));
});

test('employee page sends captured version and CSRF, copies key only on click and wipes it on close', async () => {
  class Node {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.events = {}; this.attributes = {}; this.className = ''; this.textContent = ''; this._value = ''; this.classList = { add: name => { this.className += ' ' + name; } }; }
    append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, listener) { (this.events[name] ||= []).push(listener); }
    dispatch(name) { for (const listener of this.events[name] || []) listener({ preventDefault() {} }); }
    querySelectorAll(selector) { const tags = selector.split(',').map(value => value.trim().toUpperCase()); return this.children.flatMap(child => [...(tags.includes(child.tagName) ? [child] : []), ...child.querySelectorAll(selector)]); }
    get value() { return this.tagName === 'SELECT' ? this.children.find(child => child.selected)?._value || this._value : this._value; }
    set value(value) { this._value = value; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    remove() { this.removed = true; if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
    focus() {}
    select() {}
    reportValidity() { return true; }
  }
  const root = new Node('main'), requests = [], copied = [], pageEvents = {};
  const publicState = { ok: true, version: 'a'.repeat(64), selfId: 'owner', roles: [{ id: 'admin', label: 'Administrator', description: 'All' }, { id: 'viewer', label: 'Viewer', description: 'Read' }], users: [{ id: 'owner', name: 'Synthetic owner', role: 'admin', enabled: true }] };
  const oneTimeKey = 'tvs_' + 'b'.repeat(64);
  const document = { readyState: 'complete', createElement: tag => new Node(tag), createTextNode: text => new Node('#text'), querySelector: selector => selector === 'meta[name="tvs-csrf"]' ? { content: 'synthetic-csrf' } : null };
  const window = { tvsWeb: {}, addEventListener: (name, handler) => { pageEvents[name] = handler; } };
  const sandbox = vm.createContext({ document, window, location: { assign() {} }, navigator: { clipboard: { writeText: async value => copied.push(value) } },
    fetch: async (route, options) => {
      requests.push({ route, options });
      const payload = options.method === 'POST' ? JSON.parse(options.body) : null;
      return { ok: true, json: async () => payload ? { ...publicState, version: 'c'.repeat(64), user: { id: 'new', name: payload.name, role: payload.role, enabled: payload.enabled }, key: oneTimeKey } : structuredClone(publicState) };
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../web/public/users.js'), 'utf8'), sandbox, { filename: 'users.js' });
  await window.tvsWeb.mountUsers(root);
  assert.equal(requests[0].options.method, 'GET');
  const tick = () => new Promise(resolve => setImmediate(resolve));
  root.querySelectorAll('button').find(node => node.textContent === 'Добавить сотрудника').dispatch('click'); await tick();
  assert.equal(requests[1].options.method, 'GET');
  const form = root.querySelectorAll('form')[0];
  form.querySelectorAll('input').find(node => node.name === 'name').value = 'Synthetic new employee';
  form.dispatch('submit'); form.dispatch('submit'); await tick();
  const posts = requests.filter(row => row.options.method === 'POST'); assert.equal(posts.length, 1);
  assert.equal(posts[0].route, '/web-api/users');
  assert.equal(posts[0].options.headers['X-CSRF-Token'], 'synthetic-csrf');
  assert.deepEqual(JSON.parse(posts[0].options.body), { action: 'create', version: publicState.version, name: 'Synthetic new employee', role: 'viewer', enabled: true });
  assert.deepEqual(copied, []);
  const keyInput = root.querySelectorAll('input').find(node => node.readOnly);
  assert.equal(keyInput.value, oneTimeKey);
  root.querySelectorAll('button').find(node => node.textContent === 'Скопировать ключ').dispatch('click'); await tick();
  assert.deepEqual(copied, [oneTimeKey]);
  root.querySelectorAll('button').find(node => node.textContent === 'Ключ сохранён, закрыть').dispatch('click');
  assert.equal(keyInput.value, ''); assert.equal(root.querySelectorAll('dialog').length, 0);
  assert.equal(typeof pageEvents.pagehide, 'function');
});
