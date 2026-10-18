const { app } = require('electron');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const UPDATE_CHECK_URL = 'https://raw.githubusercontent.com/dmitriyuser047/dispatcher-auto-tvs/main/version.json';
const RELEASE_PREFIX = '/dmitriyuser047/dispatcher-auto-tvs/releases/download/';
let available = null, checking = null, downloading = null;

function compareVersions(left, right) {
  const parse = value => /^\d+\.\d+\.\d+$/.test(String(value)) ? String(value).split('.').map(Number) : null;
  const a = parse(left), b = parse(right);
  if (!a || !b) throw new Error('Некорректный номер версии');
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}
function validateManifest(info) {
  if (!info || !/^\d+\.\d+\.\d+$/.test(info.version)) throw new Error('Некорректное описание обновления');
  const url = new URL(info.url);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password ||
      url.search || url.hash || url.pathname !== RELEASE_PREFIX + 'v' + info.version + '/Dispatcher-Setup-' + info.version + '.exe') throw new Error('Недоверенный адрес обновления');
  if (!/^[a-f0-9]{64}$/i.test(info.sha256 || '') || !Number.isSafeInteger(info.size) || info.size <= 0 || info.size > 1024 ** 3) throw new Error('Нет контрольной суммы или размера обновления');
  return { ...info, url: url.href, sha256: info.sha256.toLowerCase() };
}
function request(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (target.protocol !== 'https:' || target.port || target.username || target.password ||
        !['raw.githubusercontent.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(target.hostname)) {
      reject(new Error('Недоверенный адрес загрузки')); return;
    }
    const req = https.get(target, { timeout: 30000, headers: { 'User-Agent': 'TVS-Dispatcher-Updater' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirects <= 0) { reject(new Error('Слишком много перенаправлений')); return; }
        request(new URL(res.headers.location, target).href, redirects - 1).then(resolve, reject);
      } else if (res.statusCode !== 200) {
        res.resume(); reject(new Error('HTTP ' + res.statusCode));
      } else { res.on('error', () => {}); resolve(res); }
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Время загрузки истекло')));
  });
}
async function fetchText(url) {
  const res = await request(url);
  const chunks = []; let bytes = 0;
  for await (const chunk of res) {
    bytes += chunk.length;
    if (bytes > 256 * 1024) { res.destroy(); throw new Error('Слишком большое описание обновления'); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
function checkForUpdate() {
  if (checking) return checking;
  checking = (async () => {
    try {
      const info = JSON.parse(await fetchText(UPDATE_CHECK_URL + '?t=' + Date.now()));
      if (compareVersions(info.version, app.getVersion()) <= 0) return null;
      available = validateManifest(info);
      return { ...available, currentVersion: app.getVersion() };
    } catch (e) { console.warn('[updater] ' + e.message); return null; }
  })().finally(() => { checking = null; });
  return checking;
}
function downloadFile(url, onProgress) {
  if (downloading) return downloading;
  downloading = (async () => {
    if (!available || url !== available.url) throw new Error('Сначала проверьте наличие обновления');
    const info = { ...available };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tvs-update-'));
    const partial = path.join(dir, 'setup.exe.part'), final = path.join(dir, 'setup.exe');
    try {
      const res = await request(info.url);
      if (res.headers['content-length'] && Number(res.headers['content-length']) !== info.size) {
        res.destroy(); throw new Error('Размер установщика не совпадает с описанием');
      }
      const hash = crypto.createHash('sha256'); let received = 0;
      const verify = new Transform({ transform(chunk, _encoding, callback) {
        received += chunk.length;
        if (received > info.size) { callback(new Error('Превышен размер установщика')); return; }
        hash.update(chunk);
        if (onProgress) onProgress(Math.min(99, Math.floor(received / info.size * 100)));
        callback(null, chunk);
      } });
      await pipeline(res, verify, fs.createWriteStream(partial, { flags: 'wx' }));
      if (received !== info.size || hash.digest('hex') !== info.sha256) throw new Error('Установщик повреждён: контрольная сумма не совпадает. Повторите загрузку.');
      fs.renameSync(partial, final);
      if (onProgress) onProgress(100);
      return final;
    } catch (e) {
      for (const file of [partial, final]) if (fs.existsSync(file)) fs.unlinkSync(file);
      fs.rmdirSync(dir); throw e;
    }
  })().finally(() => { downloading = null; });
  return downloading;
}
async function launchInstaller(filePath) {
  if (!fs.existsSync(filePath) || !available) throw new Error('Установщик не загружен');
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  if (hash.digest('hex') !== available.sha256) throw new Error('Установщик изменён после загрузки');
  const { spawn } = require('node:child_process');
  const child = spawn(filePath, [], { detached: true, stdio: 'ignore', windowsHide: true });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref(); app.quit();
}
module.exports = { checkForUpdate, downloadFile, launchInstaller, compareVersions, validateManifest, UPDATE_CHECK_URL };
