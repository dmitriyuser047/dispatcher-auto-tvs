/**
 * Updater module — проверка и загрузка обновлений
 *
 * Разместите файл version.json на любом доступном URL:
 *
 *   {
 *     "version": "1.1.0",
 *     "date": "2026-06-01",
 *     "notes": "Исправлены ошибки. Добавлены новые поля.",
 *     "url": "https://example.com/updates/Dispatcher-Setup-1.1.0.exe"
 *   }
 *
 * Затем задайте URL ниже в переменной UPDATE_CHECK_URL.
 */

// ─── НАСТРОЙКА ───────────────────────────────────────────────────────────────
const UPDATE_CHECK_URL = 'https://raw.githubusercontent.com/dmitriyuser047/dispatcher-auto-tvs/main/version.json';
// Примеры:
//   'https://raw.githubusercontent.com/ВАШ_ORG/ВАШ_REPO/main/version.json'
//   'https://ваш-сервер.ru/updates/version.json'
//   'http://192.168.1.100/version.json'   ← локальный сервер в сети
// ─────────────────────────────────────────────────────────────────────────────

const { app } = require('electron');
const https   = require('https');
const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');

function compareVersions(v1, v2) {
  const parse = v => (v || '0').split('.').map(n => parseInt(n) || 0);
  const a = parse(v1), b = parse(v2);
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return  1;
    if (a[i] < b[i]) return -1;
  }
  return 0;
}

function fetchText(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    if (redirects <= 0) return reject(new Error('Too many redirects'));
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: 12000 }, res => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        return fetchText(res.headers.location, redirects - 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

/** Проверить обновление. Возвращает объект инфо или null */
async function checkForUpdate() {
  if (!UPDATE_CHECK_URL) return null;
  try {
    // Добавляем timestamp чтобы обойти CDN-кэш GitHub
    const url  = UPDATE_CHECK_URL + '?t=' + Date.now();
    const text = await fetchText(url);
    const info = JSON.parse(text);
    const current = app.getVersion();
    if (compareVersions(info.version, current) > 0) {
      return { ...info, currentVersion: current };
    }
    return null;
  } catch (e) {
    console.log('[updater] check failed:', e.message);
    return null;
  }
}

/** Скачать файл по URL в папку temp, с прогресс-коллбэком */
function downloadFile(url, onProgress, redirects = 5) {
  return new Promise((resolve, reject) => {
    if (redirects <= 0) return reject(new Error('Too many redirects'));
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: 0 }, res => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        return downloadFile(res.headers.location, onProgress, redirects - 1)
          .then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const total    = parseInt(res.headers['content-length']) || 0;
      let received   = 0;
      const tmpPath  = path.join(os.tmpdir(), 'dispatcher-update-setup.exe');
      const stream   = fs.createWriteStream(tmpPath);
      res.on('data', chunk => {
        received += chunk.length;
        if (total > 0 && onProgress) onProgress(Math.round(received / total * 100));
      });
      res.pipe(stream);
      stream.on('finish', () => { stream.close(); resolve(tmpPath); });
      stream.on('error', reject);
    });
    req.on('error', reject);
  });
}

/** Запустить установщик и выйти из приложения */
function launchInstaller(filePath) {
  const { spawn } = require('child_process');
  spawn(filePath, [], { detached: true, stdio: 'ignore' }).unref();
  app.quit();
}

module.exports = { checkForUpdate, downloadFile, launchInstaller, UPDATE_CHECK_URL };
