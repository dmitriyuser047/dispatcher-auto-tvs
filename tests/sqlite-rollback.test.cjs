'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), { DatabaseSync } = require('node:sqlite');
const guard = require('../electron/sqlite-rollback.cjs');
const sqlite = require('../electron/sqlite-storage.cjs');
function temporary(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tvs-rollback23-')); t.after(() => { assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir())); assert.ok(path.basename(root).startsWith('tvs-rollback23-')); assert.equal(fs.lstatSync(root).isSymbolicLink(), false); fs.rmSync(root, { recursive: true, force: true }); }); return root; }
function tree(root) { const result = {}; for (const name of fs.readdirSync(root)) { const file = path.join(root, name); if (fs.statSync(file).isFile()) result[name] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } return result; }
test('missing, empty and complete zero-header journals have detached frozen observations and no filesystem writes', t => {
  const root = temporary(t), file = path.join(root, 'platform.sqlite'); fs.writeFileSync(file, 'synthetic metadata sentinel');
  for (const [state, bytes] of [['missing', null], ['empty', Buffer.alloc(0)], ['cold', Buffer.alloc(1024)]]) {
    if (bytes) fs.writeFileSync(file + '-journal', bytes);
    const before = tree(root), token = guard.assertQuiescent(file); assert.equal(token.state, state); assert.ok(Object.isFrozen(token)); assert.match(token.stamp, /^sha256:[a-f0-9]{64}$/); assert.equal(guard.assertUnchanged(file, token), token); assert.deepEqual(tree(root), before);
  }
});
test('a real committed PERSIST journal is cold and remains byte-exact', t => {
  const root = temporary(t), folder = path.join(root, 'profile'); sqlite.create(folder, { data: {} }); const file = sqlite.filename(folder), db = new DatabaseSync(file);
  try { db.exec('PRAGMA journal_mode=PERSIST;'); db.prepare("UPDATE metadata SET value='7' WHERE key='generation'").run(); } finally { db.close(); }
  const bytes = fs.readFileSync(file + '-journal'); assert.ok(bytes.length > 28); assert.ok(bytes.subarray(0, 28).every(value => value === 0)); const before = tree(folder), token = guard.assertQuiescent(file); assert.equal(token.state, 'cold'); guard.assertUnchanged(file, token); assert.deepEqual(tree(folder), before);
});
test('a real uncommitted DELETE journal blocks before recovery and leaves the live transaction untouched', t => {
  const root = temporary(t), folder = path.join(root, 'profile'); sqlite.create(folder, { data: {} }); const file = sqlite.filename(folder), db = new DatabaseSync(file);
  try { db.exec('PRAGMA journal_mode=DELETE; PRAGMA cache_size=1; BEGIN EXCLUSIVE;'); const insert = db.prepare('INSERT INTO metadata(key,value) VALUES(?,?)'); for (let index = 0; index < 100; index++) insert.run('spill-' + index, 'x'.repeat(8192)); assert.ok(fs.statSync(file + '-journal').size > 28); const before = tree(folder); assert.throws(() => guard.assertQuiescent(file), { code: 'SQLITE_ROLLBACK_BUSY' }); assert.deepEqual(tree(folder), before); assert.equal(db.isTransaction, true); } finally { if (db.isTransaction) db.exec('ROLLBACK;'); db.close(); }
});
test('partial zero and nonzero headers cannot impersonate a committed PERSIST journal', t => {
  const root = temporary(t), file = path.join(root, 'platform.sqlite');
  for (const bytes of [Buffer.alloc(1), Buffer.alloc(27), Buffer.from([1, ...Array(27).fill(0)]), Buffer.from([...Array(27).fill(0), 1])]) { fs.writeFileSync(file + '-journal', bytes); assert.throws(() => guard.assertQuiescent(file), { code: 'SQLITE_ROLLBACK_BUSY' }); }
});
test('observations cannot be forged or moved to another SQLite path', t => {
  const root = temporary(t), file = path.join(root, 'platform.sqlite'), token = guard.assertQuiescent(file);
  assert.throws(() => guard.assertUnchanged(file, { ...token }), { code: 'SQLITE_ROLLBACK_TOKEN' }); assert.throws(() => guard.assertUnchanged(path.join(root, 'another.sqlite'), token), { code: 'SQLITE_ROLLBACK_TOKEN' }); assert.throws(() => guard.assertQuiescent('relative.sqlite'), { code: 'SQLITE_ROLLBACK_PATH' });
});
test('appearance, deletion and a changed cold file invalidate the captured observation', t => {
  const root = temporary(t), file = path.join(root, 'platform.sqlite'), missing = guard.assertQuiescent(file); fs.writeFileSync(file + '-journal', Buffer.alloc(28)); assert.throws(() => guard.assertUnchanged(file, missing), { code: 'SQLITE_ROLLBACK_CHANGED' }); const cold = guard.assertQuiescent(file); fs.appendFileSync(file + '-journal', Buffer.from('after')); assert.throws(() => guard.assertUnchanged(file, cold), { code: 'SQLITE_ROLLBACK_CHANGED' }); const changed = guard.assertQuiescent(file); fs.unlinkSync(file + '-journal'); assert.throws(() => guard.assertUnchanged(file, changed), { code: 'SQLITE_ROLLBACK_CHANGED' });
});
test('a linked journal is refused and the guard reads only its bounded coordination header', t => {
  const root = temporary(t), file = path.join(root, 'platform.sqlite'), journal = file + '-journal'; fs.writeFileSync(journal, Buffer.alloc(1000)); const read = fs.readSync; let calls = 0;
  fs.readSync = function (fd, bytes, offset, length, position) { calls++; assert.equal(length, 28); assert.equal(position, 0); return read.apply(this, arguments); };
  try { const token = guard.assertQuiescent(file); guard.assertUnchanged(file, token); } finally { fs.readSync = read; }
  assert.equal(calls, 2); fs.linkSync(journal, path.join(root, 'journal-alias')); assert.throws(() => guard.assertQuiescent(file), { code: 'SQLITE_ROLLBACK_UNSAFE' });
});
