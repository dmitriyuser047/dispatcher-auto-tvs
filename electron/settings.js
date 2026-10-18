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
  return structuredClone(value);
}

function databaseIdentity(settings) {
  const target = settings.networkMode === 'client'
    ? ['remote', settings.remoteHost.toLowerCase(), settings.remotePort, settings.networkKey]
    : ['local', path.resolve(settings.users[settings.activeUser].dataDir).toLowerCase()];
  return crypto.createHash('sha256').update(JSON.stringify(target)).digest('hex');
}

module.exports = { writeAtomic, validateSettings, databaseIdentity };
