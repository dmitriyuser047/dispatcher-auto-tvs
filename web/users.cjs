'use strict';

// The browser never supplies user-file rows or hashes. Every operation starts
// with the current private file and authenticates the caller again.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const access = require('../electron/access-control.js');
const context = require('../electron/access-context.cjs');
const MAX_BYTES = 2 * 1024 * 1024;
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const own = (value, key) => Object.hasOwn(value, key);

function canManageUsers(principal) {
  try {
    return principal?.role === 'admin' && principal.legacy !== true &&
      !context.hasNarrowing(principal) &&
      !['readable', 'writable'].some(key => principal[key] && !principal[key].includes('*')) &&
      access.authorize(principal, 'replace');
  } catch { return false; }
}

function createUserService({ usersFile } = {}) {
  if (typeof usersFile !== 'string' || !path.isAbsolute(usersFile)) throw Error('Нужен абсолютный путь к файлу учётных записей.');
  const filename = path.resolve(usersFile);
  function read() {
    try {
      const stat = fs.lstatSync(filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) throw Error('Invalid user file');
      const bytes = fs.readFileSync(filename);
      if (bytes.length > MAX_BYTES) throw Error('Invalid user file');
      const document = JSON.parse(bytes.toString('utf8'));
      const users = access.normalizeServerUsers(Array.isArray(document) ? document : document?.serverUsers);
      if (!users.length) throw Error('Empty user file');
      return { document, users, version: digest(bytes) };
    } catch {
      throw fail(503, 'USERS_UNAVAILABLE', 'Файл учётных записей недоступен. Обратитесь к владельцу сервера.');
    }
  }
  function current(snapshot, token) {
    const principal = access.authenticate(token, { serverAccessConfigured: true, serverUsers: snapshot.users }, { allowLegacy: false });
    if (!principal) throw fail(401, 'ACCESS_REVOKED', 'Доступ отозван. Войдите заново.');
    if (!canManageUsers(principal)) throw fail(403, 'USERS_ACCESS_DENIED', 'Управление сотрудниками доступно администратору с полными правами.');
    return principal;
  }
  function state(snapshot, principal) {
    return {
      ok: true, version: snapshot.version, selfId: principal.id,
      users: snapshot.users.map(user => ({ ...access.publicUser(user), restricted: !canManageUsers({ ...user, legacy: false }) && user.role === 'admin' })),
      roles: Object.entries(access.ROLES).map(([id, role]) => ({ id, label: role.label, description: role.description })),
    };
  }
  function list({ token } = {}) {
    const snapshot = read();
    return state(snapshot, current(snapshot, token));
  }
  function validate(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail(400, 'USER_INPUT_INVALID', 'Некорректный запрос учётной записи.');
    const allowed = { create: ['action', 'version', 'name', 'role', 'enabled'], update: ['action', 'version', 'id', 'name', 'role', 'enabled'], 'rotate-key': ['action', 'version', 'id'] };
    if (!own(allowed, input.action) || Object.keys(input).some(key => !allowed[input.action].includes(key))) throw fail(400, 'USER_INPUT_INVALID', 'Некорректные поля учётной записи.');
    if (typeof input.version !== 'string' || !/^[a-f0-9]{64}$/.test(input.version)) throw fail(400, 'USERS_VERSION_REQUIRED', 'Обновите список сотрудников перед сохранением.');
    if (input.action !== 'create' && (typeof input.id !== 'string' || !/^[a-z0-9_-]{1,80}$/i.test(input.id))) throw fail(400, 'USER_INPUT_INVALID', 'Выберите учётную запись.');
    if (input.action !== 'rotate-key') {
      if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 120 || /[\u0000-\u001f\u007f]/.test(input.name)) throw fail(400, 'USER_INPUT_INVALID', 'Укажите имя сотрудника длиной до 120 символов.');
      if (typeof input.role !== 'string' || !own(access.ROLES, input.role)) throw fail(400, 'USER_INPUT_INVALID', 'Выберите допустимую роль сотрудника.');
      if (typeof input.enabled !== 'boolean') throw fail(400, 'USER_INPUT_INVALID', 'Укажите состояние доступа.');
    }
  }
  function mutate({ token, input } = {}) {
    // Authenticate even malformed requests; they must never disclose file state
    // to callers who lost their role between opening the page and saving.
    current(read(), token);
    validate(input);
    let lock;
    const lockFile = filename + '.lock';
    try { lock = fs.openSync(lockFile, 'wx', 0o600); }
    catch (error) {
      if (error.code === 'EEXIST') throw fail(503, 'USERS_BUSY', 'Другой администратор сохраняет доступ. Обновите список и повторите.');
      throw fail(503, 'USERS_UNAVAILABLE', 'Не удалось открыть файл учётных записей для сохранения.');
    }
    let temporary = null;
    try {
      const before = read(), principal = current(before, token);
      if (before.version !== input.version) throw fail(409, 'USERS_CHANGED', 'Список сотрудников изменился. Обновите его и проверьте изменения перед сохранением.');
      const users = before.users.map(user => ({ ...user }));
      let user, issued;
      const now = new Date().toISOString();
      if (input.action === 'create') {
        if (users.length >= 2000) throw fail(400, 'USERS_LIMIT', 'Достигнут предел числа учётных записей.');
        issued = access.issueToken();
        user = { id: 'employee-' + crypto.randomUUID(), name: input.name.trim(), role: input.role, enabled: input.enabled, tokenHash: issued.tokenHash, createdAt: now, rotatedAt: null, expiresAt: null };
        users.push(user);
      } else {
        user = users.find(row => row.id === input.id);
        if (!user) throw fail(404, 'USER_NOT_FOUND', 'Учётная запись не найдена. Обновите список.');
        if (input.action === 'update') {
          if (user.id === principal.id && (!input.enabled || input.role !== 'admin')) throw fail(409, 'USER_SELF_ACCESS', 'Нельзя отключить собственный доступ или изменить свою роль администратора.');
          Object.assign(user, { name: input.name.trim(), role: input.role, enabled: input.enabled });
        } else {
          issued = access.issueToken();
          Object.assign(user, { tokenHash: issued.tokenHash, rotatedAt: now });
        }
      }
      // A narrowed or expired admin cannot be the sole remaining owner.
      if (!users.some(row => row.enabled && (!row.expiresAt || Date.parse(row.expiresAt) > Date.now()) && canManageUsers({ ...row, legacy: false }))) throw fail(409, 'USER_LAST_ADMIN', 'Оставьте хотя бы одного действующего администратора с полными правами.');
      let normalized;
      try { normalized = access.normalizeServerUsers(users); }
      catch { throw fail(400, 'USER_INPUT_INVALID', 'Проверьте имя, роль и состояние учётной записи.'); }
      const document = Array.isArray(before.document) ? normalized : { ...before.document, serverUsers: normalized };
      const bytes = Buffer.from(JSON.stringify(document, null, 2) + '\n', 'utf8');
      if (bytes.length > MAX_BYTES) throw fail(400, 'USERS_LIMIT', 'Файл учётных записей достиг предельного размера.');
      temporary = filename + '.' + crypto.randomBytes(12).toString('hex') + '.tmp';
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
      // Catch direct file edits as well as writes through another service.
      const latest = read();
      current(latest, token);
      if (latest.version !== before.version) throw fail(409, 'USERS_CHANGED', 'Список сотрудников изменился. Обновите его перед сохранением.');
      fs.renameSync(temporary, filename);
      temporary = null;
      const result = state({ users: normalized, version: digest(bytes) }, principal);
      result.user = access.publicUser(normalized.find(row => row.id === user.id));
      if (issued) result.key = issued.token;
      if (issued && user.id === principal.id) result.reauthenticate = true;
      return result;
    } catch (error) {
      if (error.status) throw error;
      throw fail(503, 'USERS_SAVE_FAILED', 'Не удалось сохранить учётную запись. Обновите список перед повтором.');
    } finally {
      if (temporary) { try { fs.unlinkSync(temporary); } catch {} }
      try { fs.closeSync(lock); } finally { try { fs.unlinkSync(lockFile); } catch {} }
    }
  }
  return Object.freeze({ list, mutate });
}

module.exports = Object.freeze({ createUserService, canManageUsers });
