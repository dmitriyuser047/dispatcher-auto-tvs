const http = require('http');
const os   = require('os');
const storage = require('./storage');
const crypto = require('crypto');

let _server    = null;
let _dataDir   = null;
let _backupFn  = null;
let _writeLock = false;
let _clientKey = '';
let _generation = 0;
let _actor = '';
function configureKey(key,actor) { _clientKey = String(key || ''); _actor = String(actor || ''); }
function authHeaders() { return { Authorization: 'Bearer ' + _clientKey, 'X-TVS-Actor':encodeURIComponent(_actor.slice(0,120)) }; }
function requestContext(req,meta = {}) {
  let actor = 'Сетевой клиент';
  try { actor = decodeURIComponent(String(req.headers['x-tvs-actor'] || '')).slice(0,120) || actor; } catch {}
  return { actor,action:typeof meta.action === 'string' ? meta.action.slice(0,160) : 'Изменение по сети' };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    const timer = setTimeout(() => fail(new Error('Время запроса истекло')), 30000);
    const cleanup = () => { clearTimeout(timer); req.removeListener('data', chunk); req.removeListener('end', end); req.removeListener('aborted', abort); req.removeListener('error', fail); req.removeListener('close', close); };
    const fail = e => { cleanup(); req.once('error', () => {}); reject(e); };
    const abort = () => fail(new Error('Соединение прервано'));
    const close = () => { if (!req.complete) abort(); };
    const chunk = value => { size += value.length; if (size > 32 * 1024 * 1024) { fail(new Error('Слишком большой запрос')); req.resume(); } else chunks.push(value); };
    const end = () => { cleanup(); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); } };
    req.on('data', chunk); req.on('end', end); req.on('aborted', abort); req.on('error', fail); req.on('close', close);
  });
}

async function writeRequest(req, res, full, generation) {
  const dataDir = _dataDir, backup = _backupFn;
  try {
    const payload = await readBody(req);
    if (generation !== _generation) throw new Error('Сервер переключён на другую базу. Подключитесь заново.');
    const databaseToken = storage.databaseToken(dataDir);
    if (payload?.databaseToken != null && payload.databaseToken !== databaseToken) throw new Error('Сервер выбрал другую базу. Загрузите данные заново.');
    if (_writeLock) { res.writeHead(423); res.end(JSON.stringify({ error: 'Повторите сохранение' })); return; }
    _writeLock = true;
    try {
      if (backup) backup();
      const r = full ? { ok: true, ...storage.writeAll(dataDir, payload,requestContext(req)) } : storage.writeSections(dataDir, payload,requestContext(req,payload.meta));
      res.writeHead(r.ok ? 200 : 409, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ...r, databaseToken }));
    } finally { _writeLock = false; }
  } catch (e) {
    if (!res.destroyed && !res.headersSent) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: e.message })); }
  }
}

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

function start({ port, dataDir, backupFn, serverName, key }) {
  if (_server) return { ok: false, error: 'Сервер уже запущен' };
  if (!key || String(key).length < 16) return { ok: false, error: 'Нужен ключ сети длиной от 16 знаков' };
  _dataDir  = dataDir;
  _backupFn = backupFn;
  const generation = ++_generation;

  _server = http.createServer((req, res) => {
    const supplied = Buffer.from(String(req.headers.authorization || ''));
    const expected = Buffer.from('Bearer ' + key);
    if (req.headers.origin || supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
      res.writeHead(401); res.end(JSON.stringify({ error: 'Неверный ключ сети' })); return;
    }

    if (req.method === 'GET' && req.url === '/api/ping') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, name: serverName || os.hostname(), version: '2.0', sections: true, databaseToken: storage.databaseToken(_dataDir) }));
      return;
    }

    let historyURL;
    try { historyURL = new URL(req.url,'http://localhost'); }
    catch {res.writeHead(400);res.end(JSON.stringify({error:'Неверный адрес запроса'}));return;}
    if (req.method === 'GET' && historyURL.pathname === '/api/history') {
      try {
        const result = storage.listHistory(_dataDir,{before:historyURL.searchParams.get('before'),limit:historyURL.searchParams.get('limit')});
        res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({ ...result, databaseToken: storage.databaseToken(_dataDir) }));
      } catch(e) {res.writeHead(400);res.end(JSON.stringify({error:e.message}));}
      return;
    }
    const historyMatch = /^\/api\/history\/(change_[a-z0-9]+_[a-f0-9-]{36})$/.exec(historyURL.pathname);
    if (historyMatch && req.method === 'GET') {
      try {const event=storage.readHistoryEntry(_dataDir,historyMatch[1]);res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({ ...event, databaseToken: storage.databaseToken(_dataDir) }));}
      catch(e){res.writeHead(400);res.end(JSON.stringify({error:e.message}));}return;
    }
    if (req.method === 'POST' && req.url === '/api/history/restore') {
      const dataDir=_dataDir,backup=_backupFn;
      void (async()=>{try{
        const request=await readBody(req);
        if(generation!==_generation)throw new Error('Сервер переключён на другую базу');
        const databaseToken=storage.databaseToken(dataDir);
        if(!request?.databaseToken||request.databaseToken!==databaseToken)throw new Error('Выбрана другая база. Откройте историю заново.');
        if(_writeLock)throw new Error('Повторите сохранение');
        _writeLock=true;
        try{if(backup)backup();const result=storage.restoreHistoryEntry(dataDir,request.id,requestContext(req));res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({ ...result,databaseToken }));}
        finally{_writeLock=false;}
      }catch(e){if(!res.destroyed&&!res.headersSent){res.writeHead(409);res.end(JSON.stringify({ok:false,error:e.message}));}}})();return;
    }

    // Номера версий разделов — несколько сотен байт. По ним клиент понимает,
    // что менялось, и не тянет весь массив данных ради проверки.
    if (req.method === 'GET' && req.url === '/api/revisions') {
      try {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ...storage.readRevisions(_dataDir), databaseToken: storage.databaseToken(_dataDir) }));
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
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ...storage.readSection(_dataDir, name), databaseToken: storage.databaseToken(_dataDir) }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // Все данные вместе с версиями разделов — одним ответом, чтобы версии
    // точно соответствовали данным
    if (req.method === 'GET' && req.url === '/api/snapshot') {
      try {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ data: storage.readAll(_dataDir), revisions: storage.readRevisions(_dataDir), databaseToken: storage.databaseToken(_dataDir) }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // Запись только изменившихся разделов с проверкой версии
    if (req.method === 'POST' && req.url === '/api/sections') {
      void writeRequest(req, res, false, generation);
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
      void writeRequest(req, res, true, generation);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  _server.requestTimeout = 30000;
  _server.headersTimeout = 15000;
  return new Promise((resolve) => {
    _server.listen(port, '0.0.0.0', () => {
      const ips = getLocalIPs();
      resolve({ ok: true, port: _server.address().port, ips });
    });
    _server.on('error', (e) => {
      _server = null;
      resolve({ ok: false, error: e.message });
    });
  });
}

function stop() {
  ++_generation;
  if (!_server) return Promise.resolve();
  const instance = _server;
  _server = null;
  _writeLock = false;
  return new Promise(resolve => { instance.close(resolve); instance.closeAllConnections(); });
}

function isRunning() { return !!_server; }

function fetchData(host, port) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: host, port, path: '/api/data', timeout: 5000, headers: authHeaders() }, (res) => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
      let body = '';
      res.setEncoding('utf8');
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
      headers: { ...authHeaders(), 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(jsonStr) },
      timeout: 10000,
    };
    const req = http.request(opts, (res) => {
      let body = '';
      res.setEncoding('utf8');
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

function getJson(host, port, path, timeout) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: host, port, path, timeout: timeout || 8000, headers: authHeaders() }, (res) => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Таймаут соединения')); });
  });
}

function postSections(host, port, jsonStr,endpoint='/api/sections') {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: host, port, path: endpoint, method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(jsonStr) },
      timeout: 15000,
    };
    const req = http.request(opts, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode === 404) { resolve({ ok: false, unsupported: true }); return; }
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
    const req = http.get({ hostname: host, port, path: '/api/ping', timeout: 3000, headers: authHeaders() }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

module.exports = { start, stop, isRunning, fetchData, postData, ping, getLocalIPs, getJson, postSections, configureKey };
