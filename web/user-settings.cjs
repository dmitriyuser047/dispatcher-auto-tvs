'use strict';

// Authentication still receives a fresh settings snapshot on every request.
// Only validation of identical private file bytes is reused; file metadata is
// never an authorization witness, and callers never receive cached objects.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const access = require('../electron/access-control.js');
const MAX_FILE_BYTES = 2 * 1024 * 1024, MAX_CACHE_BYTES = 4 * 1024 * 1024, MAX_ENTRIES = 8;
const validated = new Map();
let retainedBytes = 0;
const invalid = () => Object.assign(Error('Нужен обычный файл персональных учётных записей размером до 2 МиБ.'), { code: 'WEB_USERS_FILE_INVALID' });
const changed = () => Object.assign(Error('Файл персональных учётных записей изменился во время чтения.'), { code: 'WEB_USERS_FILE_CHANGED' });
const same = (left, right) => ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs', 'nlink'].every(key => left[key] === right[key]);
function regular(stat) { if (!stat.isFile() || stat.isSymbolicLink() || !Number.isSafeInteger(stat.size) || stat.size < 2 || stat.size > MAX_FILE_BYTES) throw invalid(); }
function readCurrent(filename) {
  const file = path.resolve(filename), before = fs.lstatSync(file); regular(before);
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const opened = fs.fstatSync(fd); regular(opened); if (!same(before, opened)) throw changed();
    const bytes = Buffer.allocUnsafe(before.size); let count = 0;
    while (count < bytes.length) { const size = fs.readSync(fd, bytes, count, bytes.length - count, null); if (!size) break; count += size; }
    const extra = Buffer.allocUnsafe(1);
    if (count !== bytes.length || fs.readSync(fd, extra, 0, 1, null) !== 0) throw changed();
    const after = fs.fstatSync(fd), current = fs.lstatSync(file); regular(after); regular(current);
    if (!same(before, after) || !same(before, current)) throw changed();
    return bytes;
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
function remember(key, bytes, json) {
  const size = bytes.length + 2 * (key.length + json.length);
  if (size > MAX_CACHE_BYTES) return;
  if (validated.has(key)) { retainedBytes -= validated.get(key).size; validated.delete(key); }
  while (validated.size >= MAX_ENTRIES || retainedBytes + size > MAX_CACHE_BYTES) {
    const oldest = validated.keys().next().value; retainedBytes -= validated.get(oldest).size; validated.delete(oldest);
  }
  validated.set(key, { bytes: Buffer.from(bytes), json, size }); retainedBytes += size;
}
function activeAdministrator(settings) {
  const now = Date.now();
  if (!settings.serverUsers.some(user => user.enabled && user.role === 'admin' && (!user.expiresAt || Date.parse(user.expiresAt) > now)))
    throw Error('Оставьте хотя бы одну действующую учётную запись администратора');
}
function loadUsers(filename) {
  const bytes = readCurrent(filename), key = crypto.createHash('sha256').update(bytes).digest('hex');
  const cached = validated.get(key); let json;
  if (cached && cached.bytes.equals(bytes)) {
    validated.delete(key); validated.set(key, cached); json = cached.json;
  } else {
    const input = JSON.parse(bytes.toString('utf8'));
    const serverUsers = access.normalizeServerUsers(Array.isArray(input) ? input : input?.serverUsers);
    if (!serverUsers.length) throw Error('Нужны персональные учётные записи. Общий сетевой ключ в веб-версии не используется.');
    json = JSON.stringify({ serverAccessConfigured: true, serverUsers }); remember(key, bytes, json);
  }
  const settings = JSON.parse(json);
  // The file may stay byte-identical while the last administrator expires.
  activeAdministrator(settings);
  return settings;
}

module.exports = Object.freeze({ loadUsers });
