const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function writeAtomic(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(tmp, contents, { encoding: 'utf8', flush: true });
    fs.renameSync(tmp, file);
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

function validateSettings(value) {
  if (!value || !Array.isArray(value.users) || !value.users.length ||
      !value.users.every(u => u && typeof u.name === 'string' && typeof u.dataDir === 'string' && path.isAbsolute(u.dataDir)) ||
      !Number.isInteger(value.activeUser) || value.activeUser < 0 || value.activeUser >= value.users.length ||
      !['local', 'server', 'client'].includes(value.networkMode)) throw new Error('Некорректные настройки базы');
  for (const field of ['serverPort', 'remotePort']) {
    if (!Number.isInteger(value[field]) || value[field] < 1 || value[field] > 65535) throw new Error('Порт должен быть целым числом от 1 до 65535');
  }
  if (typeof value.remoteHost !== 'string' || /[\s/@?#\\]/.test(value.remoteHost)) throw new Error('Укажите имя или IP-адрес сервера без протокола и пути');
  if (typeof value.networkKey !== 'string' || value.networkKey.length < 16) throw new Error('Ключ сети должен содержать не менее 16 знаков');
  for (const field of ['serverProtocol', 'remoteProtocol']) if (value[field] !== undefined && !['http:', 'https:'].includes(value[field])) throw new Error('Поддерживаются только HTTP и HTTPS');
  for (const field of ['remoteCaFile', 'serverTlsCert', 'serverTlsKey']) if (value[field] !== undefined && (typeof value[field] !== 'string' || value[field] && !path.isAbsolute(value[field]))) throw new Error('Укажите абсолютный путь к сертификату');
  if (value.uiTheme !== undefined && !['light', 'dark'].includes(value.uiTheme)) throw new Error('Неизвестная тема');
  if (value.serverUsers !== undefined) value = { ...value, serverUsers:require('./access-control').normalizeServerUsers(value.serverUsers) };
  return structuredClone(value);
}

function databaseIdentity(settings) {
  const target = settings.networkMode === 'client'
    ? ['remote', settings.remoteProtocol || 'http:', settings.remoteHost.toLowerCase(), settings.remotePort, settings.networkKey, settings.remoteCaFile || '']
    : ['local', process.platform === 'win32' ? path.resolve(settings.users[settings.activeUser].dataDir).toLowerCase() : path.resolve(settings.users[settings.activeUser].dataDir)];
  return crypto.createHash('sha256').update(JSON.stringify(target)).digest('hex');
}

module.exports = { writeAtomic, validateSettings, databaseIdentity };
