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
function regular(file, info) { if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || fold(fs.realpathSync.native(file)) !== fold(file)) fail('SQLITE_ROLLBACK_UNSAFE'); }
function observation(databaseFile) {
  const file = key(databaseFile), before = stat(file);
  if (!before) return { file, state: 'missing', stamp: digest({ state: 'missing' }) };
  regular(file, before);
  const header = Buffer.alloc(28), fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)); let count;
  try {
    const opened = fs.fstatSync(fd); if (!same(before, opened)) fail('SQLITE_ROLLBACK_CHANGED');
    count = fs.readSync(fd, header, 0, 28, 0);
    if (!same(opened, fs.fstatSync(fd))) fail('SQLITE_ROLLBACK_CHANGED');
  } finally { fs.closeSync(fd); }
  const after = stat(file); if (!same(before, after)) fail('SQLITE_ROLLBACK_CHANGED'); regular(file, after);
  const state = after.size === 0 ? 'empty' : count === 28 && header.every(value => value === 0) ? 'cold' : 'hot';
  return { file, state, stamp: digest({ state, dev: after.dev, ino: after.ino, size: after.size, mtimeMs: after.mtimeMs, ctimeMs: after.ctimeMs, birthtimeMs: after.birthtimeMs, header: header.subarray(0, count).toString('hex') }) };
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
