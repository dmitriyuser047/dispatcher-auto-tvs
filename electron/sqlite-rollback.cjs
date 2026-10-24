'use strict';
// A closed rollback journal can be checked without opening or recovering SQLite.
// Tokens are process-local observations, never renderer/journal authority.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const issued = new WeakMap();
const fold = value => process.platform === 'win32' ? value.toLowerCase() : value;
const digest = value => 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fail(code) { throw Object.assign(new Error('Не подтверждено завершение журнала SQLite.'), { code }); }
function key(databaseFile) {
  if (typeof databaseFile !== 'string' || !path.isAbsolute(databaseFile) || databaseFile.includes('\0')) fail('SQLITE_ROLLBACK_PATH');
  return path.resolve(databaseFile) + '-journal';
}
function stat(file) { try { return fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
function same(first, second) { return !!first && !!second && first.dev === second.dev && first.ino === second.ino && first.size === second.size && first.mtimeMs === second.mtimeMs && first.ctimeMs === second.ctimeMs && first.birthtimeMs === second.birthtimeMs; }
function regular(file, info) {
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) fail('SQLITE_ROLLBACK_UNSAFE');
  const parents = []; let current = path.dirname(file);
  while (true) { parents.unshift(current); const parent = path.dirname(current); if (parent === current) break; current = parent; }
  const proof = parents.map(parent => {
    const before = fs.lstatSync(parent); if (!before.isDirectory() || before.isSymbolicLink()) fail('SQLITE_ROLLBACK_UNSAFE');
    const canonical = fs.realpathSync.native(parent), physical = fs.lstatSync(canonical), after = fs.lstatSync(parent);
    if (!physical.isDirectory() || physical.isSymbolicLink() || !after.isDirectory() || after.isSymbolicLink() || physical.dev !== before.dev || physical.ino !== before.ino || after.dev !== before.dev || after.ino !== before.ino) fail('SQLITE_ROLLBACK_UNSAFE');
    return { path: fold(canonical), dev: before.dev, ino: before.ino };
  });
  const canonical = fs.realpathSync.native(file), physical = fs.lstatSync(canonical), after = fs.lstatSync(file);
  if (!physical.isFile() || physical.isSymbolicLink() || physical.nlink !== 1 || !after.isFile() || after.isSymbolicLink() || after.nlink !== 1 || !same(info, physical) || !same(info, after)) fail('SQLITE_ROLLBACK_UNSAFE');
  return proof;
}
function observation(databaseFile) {
  const file = key(databaseFile), before = stat(file);
  if (!before) return { file, state: 'missing', stamp: digest({ state: 'missing' }) };
  const parents = regular(file, before);
  const header = Buffer.alloc(28), fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)); let count;
  try {
    const opened = fs.fstatSync(fd); if (!same(before, opened)) fail('SQLITE_ROLLBACK_CHANGED');
    count = fs.readSync(fd, header, 0, 28, 0);
    if (!same(opened, fs.fstatSync(fd))) fail('SQLITE_ROLLBACK_CHANGED');
  } finally { fs.closeSync(fd); }
  const after = stat(file); if (!same(before, after)) fail('SQLITE_ROLLBACK_CHANGED'); const afterParents = regular(file, after);
  if (JSON.stringify(parents) !== JSON.stringify(afterParents)) fail('SQLITE_ROLLBACK_CHANGED');
  const state = after.size === 0 ? 'empty' : count === 28 && header.every(value => value === 0) ? 'cold' : 'hot';
  return { file, state, stamp: digest({ state, parents, dev: after.dev, ino: after.ino, size: after.size, mtimeMs: after.mtimeMs, ctimeMs: after.ctimeMs, birthtimeMs: after.birthtimeMs, header: header.subarray(0, count).toString('hex') }) };
}
function assertQuiescent(databaseFile) {
  const observed = observation(databaseFile); if (observed.state === 'hot') fail('SQLITE_ROLLBACK_BUSY');
  const token = Object.freeze({ state: observed.state, stamp: observed.stamp }); issued.set(token, observed.file); return token;
}
function assertUnchanged(databaseFile, token) {
  if (!token || issued.get(token) !== key(databaseFile)) fail('SQLITE_ROLLBACK_TOKEN');
  const observed = observation(databaseFile);
  if (observed.state === 'hot') fail('SQLITE_ROLLBACK_BUSY');
  if (observed.stamp !== token.stamp) fail('SQLITE_ROLLBACK_CHANGED');
  return token;
}
module.exports = Object.freeze({ assertQuiescent, assertUnchanged });
