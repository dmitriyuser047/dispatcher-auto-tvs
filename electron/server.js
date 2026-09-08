const http = require('http');
const fs   = require('fs');
const os   = require('os');
const storage = require('./storage');

let _server    = null;
let _dataDir   = null;
let _backupFn  = null;
let _writeLock = false;

function getLocalIPs() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

function start({ port, dataDir, backupFn, serverName }) {
  if (_server) return { ok: false, error: 'Сервер уже запущен' };
  _dataDir  = dataDir;
  _backupFn = backupFn;

  _server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (req.method === 'GET' && req.url === '/api/ping') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, name: serverName || os.hostname(), version: '2.0', sections: true }));
      return;
    }

    // Номера версий разделов — несколько сотен байт. По ним клиент понимает,
    // что менялось, и не тянет весь массив данных ради проверки.
    if (req.method === 'GET' && req.url === '/api/revisions') {
      try {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(storage.readRevisions(_dataDir)));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // Один раздел целиком
    const secMatch = req.method === 'GET' && /^\/api\/section\/([A-Za-z]+)$/.exec(req.url);
    if (secMatch) {
      const name = secMatch[1];
      if (!storage.SECTIONS.includes(name)) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Неизвестный раздел' }));
        return;
      }
      try {
        const all = storage.readAll(_dataDir);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ name, rev: storage.readRevisions(_dataDir)[name] || 0, rows: all[name] || [] }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    if (req.method === 'GET' && req.url === '/api/data') {
      try {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(storage.readAll(_dataDir)));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    if (req.method === 'POST' && req.url === '/api/data') {
      if (_writeLock) {
        res.writeHead(423, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Запись заблокирована, попробуйте снова' }));
        return;
      }
      _writeLock = true;
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (_backupFn) _backupFn();
          const r = storage.writeAll(_dataDir, data);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, changed: r.changed, revisions: r.revisions }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: e.message }));
        } finally {
          _writeLock = false;
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  return new Promise((resolve) => {
    _server.listen(port, '0.0.0.0', () => {
      const ips = getLocalIPs();
      resolve({ ok: true, port, ips });
    });
    _server.on('error', (e) => {
      _server = null;
      resolve({ ok: false, error: e.message });
    });
  });
}

function stop() {
  if (!_server) return;
  _server.close();
  _server = null;
}

function isRunning() { return !!_server; }

function fetchData(host, port) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: host, port, path: '/api/data', timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try { resolve(body); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Таймаут соединения')); });
  });
}

function postData(host, port, jsonStr) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: host, port, path: '/api/data', method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(jsonStr) },
      timeout: 10000,
    };
    const req = http.request(opts, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Таймаут соединения')); });
    req.write(jsonStr);
    req.end();
  });
}

function ping(host, port) {
  return new Promise((resolve) => {
    const req = http.get({ hostname: host, port, path: '/api/ping', timeout: 3000 }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

module.exports = { start, stop, isRunning, fetchData, postData, ping, getLocalIPs };
