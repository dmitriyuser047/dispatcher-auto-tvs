'use strict';
const http = require('http');
const https = require('https');
const os = require('os');
const net = require('net');
const dns = require('dns').promises;
const storage = require('./storage');
const access = require('./access-control');

let _server = null, _dataDir = null, _backupFn = null, _writeLock = false, _writeProof=null, _localWriteProof=null;
let _clientKey = '', _transport = { protocol:'http:', ca:null }, _accessSettings = {};
const MAX_BODY = 32 * 1024 * 1024, MAX_IMPORT_BODY = 40 * 1024 * 1024, MAX_RESPONSE = 64 * 1024 * 1024;
const compatibility=()=>require('../assets/core/platform-compatibility.js');
function proofProvider(){return require('./write-proof.cjs').createWriteProof({compatibility:compatibility()});}
function localWriteOptions({hello,databaseToken,principal}){_localWriteProof??=proofProvider();const credential='trusted-local-main',issued=_localWriteProof.negotiate(hello,{databaseToken,principal,descriptor:require('./storage-format.cjs').describe(3),credential});return {requireWriterSchema:true,writerSchemaVersion:3,..._localWriteProof.writeOptions(issued.writeTicket,{credential})};}
function writerContext(req) {
  const raw=req.headers['x-tvs-writer-schema'];
  const version=typeof raw==='string'&&/^[1-9][0-9]{0,8}$/.test(raw)?Number(raw):raw===undefined?undefined:null;
  const credential=/^Bearer (.+)$/.exec(String(req.headers.authorization||''))?.[1];
  return {requireWriterSchema:true,writerSchemaVersion:version,...(_writeProof?_writeProof.writeOptions(require('./write-proof.cjs').readTicket(req),{credential}):{requireNegotiatedWriter:true})};
}
function storageProfile(dataDir) {
  const format=require('./storage-format.cjs'),descriptor=storage.descriptor(dataDir);
  return {descriptor,readOnly:!format.isCurrent(descriptor.schemaVersion),compatibility:compatibility().describe().serverProfile};
}
function configureKey(key) { _clientKey = String(key || ''); }
function configureAccess(settings) { _accessSettings = settings || {}; }
function configureTransport(options = {}) {
  const protocol = options.protocol || 'http:';
  if (!['http:', 'https:'].includes(protocol)) throw new Error('Поддерживаются только HTTP и HTTPS');
  if (options.ca && typeof options.ca !== 'string' && !Buffer.isBuffer(options.ca)) throw new Error('Неверный сертификат доверия');
  _transport = { protocol, ca: options.ca || null };
}
function authHeaders() { return { Authorization:'Bearer ' + _clientKey }; }
function respond(res, status, value) {
  if (res.destroyed || res.headersSent) return;
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
  res.end(JSON.stringify(value));
}
function readable(principal, section) { return access.authorize(principal, 'read', section); }
function visibleAudit(rows, principal) { return require('./platform-service.cjs').visibleAudit(rows,principal); }
function filteredData(all, principal) {
  return Object.fromEntries(storage.SECTIONS.map(name => [name, !readable(principal, name) ? [] : require('./platform-service.cjs').visibleRows(name,all[name],principal)]));
}
function filteredRevisions(revisions, principal) {
  return Object.fromEntries(storage.SECTIONS.map(name => [name, readable(principal, name) ? revisions[name] || 0 : 0]));
}
function publicAccess(principal) {
  const normalized=require('./access-context.cjs').normalizePrincipal(principal);
  return { policyStamp:normalized.policyStamp,...(normalized.accessPolicy!==undefined?{accessPolicy:normalized.accessPolicy}:{}),user:{ id:principal.id, name:principal.name, role:principal.role, legacy:!!principal.legacy }, readable:storage.SECTIONS.filter(n => readable(principal,n)), writable:storage.SECTIONS.filter(n => access.authorize(principal,'write',n)), fieldPermissions:access.fieldPermissions(principal),periodActions:require('./period-access.cjs').actions(principal),fuelActions:access.fuelActions(principal),procurementActions:access.procurementActions(principal),costActions:access.costActions(principal),repairActions:access.repairActions(principal),calendarActions:access.calendarActions(principal),printActions:access.printActions(principal),importActions:access.importActions(principal) };
}

function readBody(req,limit=MAX_BODY) {
  return new Promise((resolve,reject) => {
    const chunks = []; let size = 0, finished = false;
    const cleanup = () => { clearTimeout(timer); req.removeListener('data',chunk); req.removeListener('end',end); req.removeListener('aborted',abort); req.removeListener('error',fail); req.removeListener('close',close); };
    const fail = error => { if (finished) return; finished = true; cleanup(); req.once('error',()=>{}); reject(error); };
    const abort = () => fail(new Error('Соединение прервано'));
    const close = () => { if (!req.complete) abort(); };
    const chunk = value => {
      size += value.length;
      if (size > limit) { fail(new Error('Слишком большой запрос')); req.resume(); }
      else chunks.push(value);
    };
    const end = () => { if (finished) return; finished = true; cleanup(); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('Некорректный JSON запроса')); } };
    const timer = setTimeout(() => fail(new Error('Время запроса истекло')), 30000);
    req.on('data',chunk); req.on('end',end); req.on('aborted',abort); req.on('error',fail); req.on('close',close);
  });
}

async function writeRequest(req,res,full,authenticateRequest) {
  const dataDir = _dataDir, backup = _backupFn;
  try {
    const payload = await readBody(req);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Некорректные данные');
    if (_writeLock) { respond(res,423,{ok:false,error:'Повторите сохранение'}); return; }
    _writeLock = true;
    try {
      return storage.withDatabaseLock(dataDir, () => {
      // The request body may take seconds to arrive. Roles, token rotation and
      // expiry must be checked again under the write lock, before any backup or
      // data mutation, and this current principal also owns the audit and ACK.
      const principal = authenticateRequest();
      if (!principal) { respond(res,401,{ok:false,error:'Неверный или отозванный ключ доступа'}); return; }
      const token = storage.databaseToken(dataDir);
      if (full && !access.authorize(principal,'replace')) { respond(res,403,{ok:false,error:'Полная замена базы разрешена только администратору'}); return; }
      const supplied = full ? (payload.data || payload) : payload.sections;
      if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) throw new Error('Не указаны разделы');
      if (full && (!Array.isArray(supplied.vehicles) || !Array.isArray(supplied.records))) throw new Error('Неполная база: нужны vehicles и records');
      const sections = full ? Object.fromEntries(storage.SECTIONS.filter(name => name in supplied).map(name => [name,supplied[name]])) : { ...supplied };
      const names = Object.keys(sections);
      if (names.some(name => !storage.SECTIONS.includes(name) || !Array.isArray(sections[name]))) throw new Error('Некорректные разделы');
      if (typeof payload.databaseToken !== 'string' || !payload.databaseToken) { respond(res,428,{ok:false,databaseToken:token,error:'Обновите клиент и заново загрузите базу: для сохранения нужен идентификатор прочитанной базы.'}); return; }
      if (payload.databaseToken !== token) { respond(res,409,{ok:false,databaseChanged:true,databaseToken:token,error:'База данных на сервере изменилась. Заново откройте её перед сохранением.'}); return; }
      const writeContext = { principal, ...writerContext(req), now:new Date().toISOString(),beforeCommit:backup||undefined };
      const result = full
        ? storage.writeAll(dataDir,sections,{databaseToken:payload.databaseToken,operation:payload.operation,scopeViews:payload.scopeViews,base:payload.base,requireBase:true,...writeContext})
        : storage.writeSections(dataDir,{base:payload.base || {},sections,databaseToken:payload.databaseToken,operation:payload.operation,scopeViews:payload.scopeViews},writeContext);
      result.databaseToken = token;
      if (result.revisions) result.revisions = filteredRevisions(result.revisions,principal);
      respond(res,result.ok ? 200 : 409,result);
      });
    } finally { _writeLock = false; }
  } catch (e) { respond(res,e.status || 400,{ok:false,error:e.message,...(e.code ? {code:e.code} : {})}); }
}
async function commandRequest(req,res,authenticateRequest) {
  const dataDir=_dataDir,backup=_backupFn;
  try {
    const envelope=await readBody(req);
    if(_writeLock){respond(res,423,{ok:false,error:'Повторите сохранение'});return;}
    _writeLock=true;
    try {
      return storage.withDatabaseLock(dataDir,()=>{
        // A token accepted before a slow upload may have been revoked or had
        // its role changed. Only this current principal owns the command.
        const principal=authenticateRequest();
        if(!principal){respond(res,401,{ok:false,error:'Неверный или отозванный ключ доступа'});return;}
        const result=storage.executeCommand(dataDir,envelope,{principal,...writerContext(req),now:new Date().toISOString(),beforeCommit:backup || undefined});
        respond(res,result.ok?200:409,result);
      });
    } finally {_writeLock=false;}
  } catch(error){respond(res,error.status||400,{ok:false,error:error.message,...(error.code?{code:error.code}:{})});}
}

function getLocalIPs() {
  return Object.values(os.networkInterfaces()).flat().filter(net => net && net.family === 'IPv4' && !net.internal).map(net => net.address);
}

function start({port,dataDir,backupFn,serverName,key,settings,users,tls,renderPdf}) {
  if (_server) return {ok:false,error:'Сервер уже запущен'};
  if (typeof settings !== 'function') configureAccess(settings || {networkKey:key,serverUsers:users || []});
  const settingsProvider = typeof settings === 'function' ? settings : () => _accessSettings;
  const current = settingsProvider();
  const configuredUsers = Array.isArray(current.serverUsers) ? current.serverUsers : [];
  if (configuredUsers.length || current.serverAccessConfigured) {
    if (!configuredUsers.some(user => user.enabled !== false && user.role === 'admin' && (!user.expiresAt || Date.parse(user.expiresAt) > Date.now()))) return {ok:false,error:'Нужна действующая учётная запись администратора'};
  } else if (!current.networkKey || String(current.networkKey).length < 16) return {ok:false,error:'Нужен ключ сети длиной от 16 знаков'};
  if (tls && (!tls.cert || !tls.key)) return {ok:false,error:'Для HTTPS нужны сертификат и закрытый ключ сервера'};
  _dataDir = dataDir; _backupFn = backupFn;_writeProof=proofProvider();
  const handler = (req,res) => {
    const header = String(req.headers.authorization || ''), match = /^Bearer (.+)$/.exec(header);
    const authenticateRequest = () => !req.headers.origin && match ? access.authenticate(match[1],settingsProvider()) : null;
    const currentPrincipal=()=>{const value=authenticateRequest();if(!value)throw Object.assign(Error('Неверный или отозванный ключ доступа'),{code:'ACCESS_REVOKED',status:401});return value;};
    const principal = authenticateRequest();
    if (!principal) { respond(res,401,{ok:false,error:'Неверный или отозванный ключ доступа'}); return; }
    if(req.method==='POST'&&req.url==='/api/negotiate'){
      void(async()=>{try{const hello=await readBody(req,32*1024);storage.withDatabaseLock(dataDir,()=>{const current=authenticateRequest();if(!current){respond(res,401,{ok:false,error:'Неверный или отозванный ключ доступа'});return;}const databaseToken=storage.databaseToken(dataDir),platform=storageProfile(dataDir),credential=/^Bearer (.+)$/.exec(String(req.headers.authorization||''))?.[1],issued=_writeProof.negotiate(hello,{databaseToken,principal:current,descriptor:platform.descriptor,credential});respond(res,200,{ok:true,databaseToken,access:publicAccess(current),platform,...issued});});}catch(error){respond(res,error.status||400,{ok:false,code:error.code||'NEGOTIATION_INVALID',error:error.message});}})();return;
    }
    if (req.method === 'GET' && req.url === '/api/ping') {
      try { respond(res,200,{ok:true,name:serverName || os.hostname(),version:require('../package.json').version,sections:true,databaseToken:storage.databaseToken(_dataDir),protocol:tls ? 'https:' : 'http:',platform:storageProfile(_dataDir),access:publicAccess(principal)}); }
      catch (e) { respond(res,500,{ok:false,error:e.message}); } return;
    }
    if (req.method === 'POST' && ['/api/sections','/api/data'].includes(req.url)) {
      void writeRequest(req,res,req.url === '/api/data',authenticateRequest); return;
    }
    if(req.method==='POST'&&req.url==='/api/commands'){
      void commandRequest(req,res,authenticateRequest);return;
    }
    if(req.method==='POST'&&req.url==='/api/import-source'){
      void (async()=>{try{const payload=await readBody(req,MAX_IMPORT_BODY),principal=currentPrincipal();const result=await require('./import-source.cjs').handle(dataDir,payload,{principal,...writerContext(req),getPrincipal:currentPrincipal});respond(res,200,result);}catch(error){respond(res,error.status||400,{ok:false,code:error.code||'IMPORT_SOURCE_FAILED',error:error.message});}})();return;
    }
    if(req.method==='POST'&&req.url==='/api/document-print'){
      void (async()=>{try{const payload=await readBody(req),principal=currentPrincipal();const result=await require('./document-archive.cjs').handle(dataDir,payload,{principal,...writerContext(req),renderPdf,getPrincipal:currentPrincipal});respond(res,200,result);}catch(error){respond(res,error.status||400,{ok:false,code:error.code||'DOCUMENT_PRINT_FAILED',error:error.message});}})();return;
    }
    if (req.method !== 'GET') { respond(res,404,{ok:false,error:'Неизвестный запрос'}); return; }
    try {
      if(req.url.startsWith('/api/query?')) {
        if(req.url.length>12000){respond(res,400,{ok:false,code:'QUERY_INVALID',error:'Слишком длинный запрос выборки'});return;}
        const parameters=new URL(req.url,'http://localhost').searchParams;
        if([...parameters.keys()].length!==1||!parameters.has('query')){respond(res,400,{ok:false,code:'QUERY_INVALID',error:'Неверные параметры выборки'});return;}
        let query;try{query=JSON.parse(parameters.get('query'));}catch{respond(res,400,{ok:false,code:'QUERY_INVALID',error:'Неверные параметры выборки'});return;}
        try{respond(res,200,require('./data-query.cjs').queryRows(_dataDir,query,principal));}
        catch(error){respond(res,error.status||500,{ok:false,code:error.code||'QUERY_FAILED',error:error.message});}
        return;
      }
      if(req.url.startsWith('/api/operation?')){
        const query=new URL(req.url,'http://localhost').searchParams;
        respond(res,200,storage.readOperation(_dataDir,{id:query.get('id'),digest:query.get('digest')},principal));return;
      }
      if (req.url === '/api/revisions') { respond(res,200,{...filteredRevisions(storage.readRevisions(_dataDir),principal),databaseToken:storage.databaseToken(_dataDir)}); return; }
      const sectionMatch = /^\/api\/section\/([A-Za-z]+)$/.exec(req.url);
      if (sectionMatch) {
        const name = sectionMatch[1];
        if (!storage.SECTIONS.includes(name)) { respond(res,404,{ok:false,error:'Неизвестный раздел'}); return; }
        if (!readable(principal,name)) { respond(res,200,{name,rev:0,rows:[],databaseToken:storage.databaseToken(_dataDir)}); return; }
        const section = storage.readSection(_dataDir,name,{principal});
        respond(res,200,section); return;
      }
      if (req.url === '/api/data' || req.url === '/api/snapshot') {
        const snapshot = storage.readSnapshot(_dataDir,{principal});
        respond(res,200,req.url === '/api/data' ? snapshot.data : {...snapshot,access:publicAccess(principal)}); return;
      }
      respond(res,404,{ok:false,error:'Неизвестный запрос'});
    } catch (e) { respond(res,500,{ok:false,error:e.message}); }
  };
  try { _server = tls ? https.createServer({cert:tls.cert,key:tls.key,minVersion:'TLSv1.2'},handler) : http.createServer(handler); }
  catch (e) { _server = null; return {ok:false,error:'Не удалось настроить сервер: ' + e.message}; }
  const instance = _server;
  instance.requestTimeout = 30000; instance.headersTimeout = 15000;
  return new Promise(resolve => {
    instance.once('error',e => { if (_server === instance) _server = null; resolve({ok:false,error:e.message}); });
    instance.listen(port,'0.0.0.0',() => resolve({ok:true,port:instance.address().port,ips:getLocalIPs(),protocol:tls ? 'https:' : 'http:'}));
  });
}

function stop() {
  const instance = _server; _server = null;_writeProof=null;
  if (!instance) return;
  instance.close(); if (instance.closeIdleConnections) instance.closeIdleConnections();
}
function isRunning() { return !!_server; }

function privateAddress(value) {
  const address = String(value).toLowerCase().split('%')[0];
  if (address.startsWith('::ffff:')) return privateAddress(address.slice(7));
  if (net.isIP(address) === 4) {
    const bytes = address.split('.').map(Number);
    return bytes[0] === 127 || bytes[0] === 10 || bytes[0] === 192 && bytes[1] === 168 || bytes[0] === 172 && bytes[1] >= 16 && bytes[1] <= 31 || bytes[0] === 169 && bytes[1] === 254;
  }
  return address === '::1' || /^(fc|fd)[a-f\d]{2}:/.test(address) || /^fe[89ab][a-f\d]:/.test(address);
}

async function endpointOptions(host,port,apiPath) {
  if (typeof host !== 'string' || !host || /[\s\/@?#]/.test(host) || host.includes('://')) throw new Error('Укажите имя или IP сервера без протокола и пути');
  const hostname = host.replace(/^\[|\]$/g,''), serverPort = Number(port);
  if (!Number.isInteger(serverPort) || serverPort < 1 || serverPort > 65535) throw new Error('Некорректный порт сервера');
  const transport = {..._transport};
  const options = {hostname,port:serverPort,path:apiPath,headers:authHeaders(),protocol:transport.protocol};
  if (transport.protocol === 'https:') { if (transport.ca) options.ca = transport.ca; return options; }
  // Resolve once and pin this request to the checked LAN address. Public
  // endpoints always require TLS, including hostnames that resolve publicly.
  const addresses = net.isIP(hostname) ? [{address:hostname,family:net.isIP(hostname)}] : await dns.lookup(hostname,{all:true});
  if (!addresses.length || addresses.some(row => !privateAddress(row.address))) throw new Error('Для подключения вне локальной сети требуется HTTPS');
  options.lookup = (_name,opts,callback) => { if (opts && opts.all) callback(null,addresses); else callback(null,addresses[0].address,addresses[0].family); };
  return options;
}

async function request(host,port,apiPath,body,timeout=15000,transportOptions={}) {
  const options = await endpointOptions(host,port,apiPath);
  options.timeout = timeout; options.method = body == null ? 'GET' : 'POST';
  if (body != null) {
    if (typeof body !== 'string' || Buffer.byteLength(body) > (apiPath==='/api/import-source'?MAX_IMPORT_BODY:MAX_BODY)) throw new Error('Слишком большой или неверный запрос');
    options.headers = {...options.headers,'X-TVS-Writer-Schema':String(require('./storage-format.cjs').SCHEMA_VERSION),'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body)};
    if(transportOptions.ticket!==undefined){if(typeof transportOptions.ticket!=='string'||Buffer.byteLength(transportOptions.ticket)>4096)throw Object.assign(Error('Требуется повторная проверка совместимости'),{code:'PROTOCOL_RENEGOTIATE',status:428});options.headers['X-TVS-Write-Ticket']=transportOptions.ticket;}
  }
  return await new Promise((resolve,reject) => {
    let req, settled = false;
    const timer = setTimeout(() => { if (req) req.destroy(new Error('Время запроса истекло')); else finish(new Error('Время запроса истекло')); },Math.max(timeout * 3,30000));
    const finish = (error,value) => { if (settled) return; settled = true; clearTimeout(timer); if (error) reject(error); else resolve(value); };
    try { req = (options.protocol === 'https:' ? https : http).request(options,res => {
      const chunks = []; let size = 0;
      res.on('data',chunk => { size += chunk.length; if (size > MAX_RESPONSE) res.destroy(new Error('Слишком большой ответ сервера')); else chunks.push(chunk); });
      res.on('error',error => finish(error));
      res.on('aborted',() => finish(new Error('Ответ сервера прерван')));
      res.on('end',() => {
        if (!res.complete) { finish(new Error('Ответ сервера загружен не полностью')); return; }
        finish(null,{status:res.statusCode,text:Buffer.concat(chunks).toString('utf8')});
      });
    }); } catch (error) { finish(error); return; }
    req.on('error',error => finish(error));
    req.on('timeout',() => req.destroy(new Error('Таймаут соединения')));
    req.end(body == null ? undefined : body);
  });
}

function parseResponse(response,allowConflict) {
  let value;
  try { value = JSON.parse(response.text); } catch { throw new Error('Сервер вернул неверный ответ'); }
  if (response.status >= 200 && response.status < 300 || allowConflict && response.status === 409) return value;
  const error=new Error('HTTP ' + response.status + (value?.error ? ': ' + value.error : ''));
  error.status=response.status;error.code=value?.code||'HTTP_RESPONSE';error.definitive=response.status>=400&&response.status<500&&response.status!==408;
  throw error;
}
async function fetchData(host,port) { const response = await request(host,port,'/api/data',null,10000); parseResponse(response); return response.text; }
async function postData(host,port,jsonStr,options) { return parseResponse(await request(host,port,'/api/data',jsonStr,15000,options),true); }
async function getJson(host,port,apiPath,timeout) { return parseResponse(await request(host,port,apiPath,null,timeout || 15000)); }
async function postSections(host,port,jsonStr,options) {
  const response = await request(host,port,'/api/sections',jsonStr,15000,options);
  if (response.status === 404) return {ok:false,unsupported:true};
  return parseResponse(response,true);
}
async function postCommands(host,port,jsonStr,options) {
  const response=await request(host,port,'/api/commands',jsonStr,15000,options);
  if(response.status===404)return {ok:false,unsupported:true,code:'UNSUPPORTED_COMMANDS'};
  return parseResponse(response,true);
}
async function postImportSource(host,port,jsonStr,options){const response=await request(host,port,'/api/import-source',jsonStr,45000,options);if(response.status===404)return {ok:false,unsupported:true,code:'UNSUPPORTED_IMPORT_SOURCE'};return parseResponse(response,true);}
async function postDocumentPrint(host,port,jsonStr,options){const response=await request(host,port,'/api/document-print',jsonStr,45000,options);if(response.status===404)return {ok:false,unsupported:true,code:'UNSUPPORTED_DOCUMENT_PRINT'};return parseResponse(response,true);}
async function negotiate(host,port,hello){const json=JSON.stringify(hello);if(typeof json!=='string'||Buffer.byteLength(json)>32*1024)throw Object.assign(Error('Некорректный профиль совместимости'),{code:'NEGOTIATION_INVALID',status:400});return parseResponse(await request(host,port,'/api/negotiate',json));}
async function ping(host,port) { try { return parseResponse(await request(host,port,'/api/ping',null,5000)); } catch { return null; } }

module.exports = {start,stop,isRunning,fetchData,postData,ping,getLocalIPs,getJson,postSections,postCommands,postDocumentPrint,postImportSource,negotiate,localWriteOptions,configureKey,configureTransport,configureAccess};
