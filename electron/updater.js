/** Updates are accepted only from the project HTTPS manifest, with SHA-256. */
const { app } = require('electron');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');

const UPDATE_CHECK_URL = 'https://raw.githubusercontent.com/dmitriyuser047/dispatcher-auto-tvs/main/version.json';
const MANIFEST_MAX_BYTES = 1024 * 1024;
const INSTALLER_MAX_BYTES = 1024 * 1024 * 1024;
const TRUST_MS = 30 * 60 * 1000;
const trustedReleases = new Map();
const verifiedDownloads = new Map();
let downloadInProgress = false;

function compareVersions(v1, v2) {
  const parse = value => {
    if (!/^\d+\.\d+\.\d+$/.test(String(value))) throw new Error('Некорректная версия обновления');
    return String(value).split('.').map(Number);
  };
  const a = parse(v1), b = parse(v2);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

function safeUrl(value, kind) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443') {
    throw new Error('Для обновлений разрешён только HTTPS');
  }
  const allowed = kind === 'manifest'
    ? ['raw.githubusercontent.com']
    : ['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'];
  if (!allowed.includes(url.hostname)) throw new Error('Недоверенный адрес обновления');
  return url;
}

function getResponse(value, kind, signal, redirects = 5) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = safeUrl(value, kind); } catch (e) { reject(e); return; }
    const request = https.get(url, { signal, timeout: 30000, headers: { 'User-Agent': 'Dispatcher-TVS-Updater', 'Accept-Encoding': 'identity' } }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        if (!response.headers.location || redirects <= 0) { reject(new Error('Слишком много перенаправлений обновления')); return; }
        let next;
        try { next = new URL(response.headers.location, url).href; } catch (e) { reject(e); return; }
        getResponse(next, kind, signal, redirects - 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) { response.resume(); reject(new Error('HTTP ' + response.statusCode)); return; }
      resolve(response);
    });
    request.on('timeout', () => request.destroy(new Error('Сервер обновлений не отвечает')));
    request.on('error', reject);
  });
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await getResponse(url, 'manifest', controller.signal);
    const chunks = []; let size = 0;
    for await (const chunk of response) {
      size += chunk.length;
      if (size > MANIFEST_MAX_BYTES) { response.destroy(); throw new Error('Слишком большой манифест обновления'); }
      chunks.push(chunk);
    }
    if (!response.complete) throw new Error('Манифест загружен не полностью');
    return Buffer.concat(chunks).toString('utf8');
  } finally { clearTimeout(timer); }
}

async function checkForUpdate() {
  try {
    const info = JSON.parse(await fetchText(UPDATE_CHECK_URL + '?t=' + Date.now()));
    const current = app.getVersion();
    if (compareVersions(info.version, current) <= 0) return null;
    const url = safeUrl(info.url, 'installer');
    const expectedPath = '/dmitriyuser047/dispatcher-auto-tvs/releases/download/v' + info.version + '/Dispatcher-Setup-' + info.version + '.exe';
    if (url.hostname !== 'github.com' || url.pathname !== expectedPath || url.search || url.hash) throw new Error('Установщик не относится к выпуску проекта');
    let blockedReason = '';
    if (!/^[a-fA-F0-9]{64}$/.test(info.sha256 || '')) blockedReason = 'Издатель ещё не опубликовал контрольную сумму SHA-256. Автоматическая установка недоступна.';
    if (info.minAppVersion && compareVersions(current, info.minAppVersion) < 0) blockedReason = 'Нужна промежуточная версия ' + info.minAppVersion + '. Обновите программу по инструкции издателя.';
    if (info.maxAppVersion && compareVersions(current, info.maxAppVersion) > 0) blockedReason = 'Этот выпуск несовместим с установленной версией.';
    if (info.requiresDataMigration === true) blockedReason = 'Для этого выпуска требуется отдельная миграция данных по инструкции издателя.';
    const trusted = { url: url.href, sha256: String(info.sha256 || '').toLowerCase(), version: info.version, checkedAt: Date.now(), blockedReason };
    trustedReleases.set(url.href, trusted);
    return { ...info, url: url.href, currentVersion: current, canInstall: !blockedReason, blockedReason };
  } catch (e) {
    console.warn('[updater] ' + e.message);
    return null;
  }
}

async function downloadFile(url, onProgress) {
  const release = trustedReleases.get(String(url));
  if (!release || Date.now() - release.checkedAt > TRUST_MS) throw new Error('Сначала повторно проверьте обновления');
  if (release.blockedReason) throw new Error(release.blockedReason);
  if (downloadInProgress) throw new Error('Обновление уже загружается');
  downloadInProgress = true;
  let directory, partial, finalPath;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10 * 60 * 1000);
  try {
    directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dispatcher-update-'));
    partial = path.join(directory, 'setup.exe.part'); finalPath = path.join(directory, 'setup.exe');
    const response = await getResponse(release.url, 'installer', controller.signal);
    const total = Number(response.headers['content-length']) || 0;
    if (total > INSTALLER_MAX_BYTES) { response.destroy(); throw new Error('Превышен размер установщика'); }
    let received = 0;
    const hash = crypto.createHash('sha256');
    const measure = new Transform({ transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > INSTALLER_MAX_BYTES) { callback(new Error('Превышен размер установщика')); return; }
      hash.update(chunk);
      if (total && onProgress) onProgress(Math.min(99, Math.round(received / total * 100)));
      callback(null, chunk);
    } });
    await pipeline(response, measure, fs.createWriteStream(partial, { flags: 'wx', mode: 0o600 }), { signal: controller.signal });
    if (!response.complete || total && total !== received || received === 0) throw new Error('Установщик загружен не полностью');
    const digest = hash.digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(release.sha256, 'hex'))) throw new Error('Контрольная сумма не совпадает. Установщик удалён.');
    await fs.promises.rename(partial, finalPath);
    verifiedDownloads.set(finalPath, { sha256: digest, directory });
    if (onProgress) onProgress(100);
    return finalPath;
  } catch (e) {
    if (partial) await fs.promises.unlink(partial).catch(() => {});
    if (finalPath) { verifiedDownloads.delete(finalPath); await fs.promises.unlink(finalPath).catch(() => {}); }
    if (directory) await fs.promises.rmdir(directory).catch(() => {});
    throw new Error(e.name === 'AbortError' ? 'Время загрузки обновления истекло' : e.message);
  } finally { clearTimeout(timer); downloadInProgress = false; }
}

async function launchInstaller(filePath) {
  const verified = verifiedDownloads.get(filePath);
  if (!verified || !fs.existsSync(filePath)) throw new Error('Установщик не прошёл проверку');
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  if (hash.digest('hex') !== verified.sha256) throw new Error('Файл установщика изменился после проверки. Загрузите его заново.');
  const { spawn } = require('child_process');
  await new Promise((resolve, reject) => {
    const child = spawn(filePath, [], { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
  app.quit();
}

module.exports = { checkForUpdate, downloadFile, launchInstaller, UPDATE_CHECK_URL };
