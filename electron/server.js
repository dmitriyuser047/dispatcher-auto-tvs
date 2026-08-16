const http = require('http');
const fs   = require('fs');
const os   = require('os');

let _server    = null;
let _dataFile  = null;
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

function start({ port, dataFile, backupFn, serverName }) {
  if (_server) return { ok: false, error: 'Сервер уже запущен' };
  _dataFile = dataFile;
  _backupFn = backupFn;

  _server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (req.method === 'GET' && req.url === '/api/ping') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, name: serverName || os.hostname(), version: '1.0' }));
      return;
    }

    if (req.method === 'GET' && req.url === '/api/data') {
      try {
        if (fs.existsSync(_dataFile)) {
          const content = fs.readFileSync(_dataFile, 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(content);
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ vehicles: [], records: [] }));
        }
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
          JSON.parse(body);
          if (_backupFn) _backupFn();
          fs.writeFileSync(_dataFile, body, 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true }));
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
