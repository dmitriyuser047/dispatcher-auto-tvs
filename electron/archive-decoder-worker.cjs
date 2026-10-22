'use strict';
// The child main thread stays responsive while unrar's synchronous WASM runs
// in an inner thread. It can kill the whole child on timeout or IPC disconnect.
// No database, application, PDF/OCR module or extracted temporary file is used.
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const CAPS = ['--max-old-space-size=256', '--wasm-max-mem-pages=8192', '--wasm-max-table-size=100000', '--wasm-max-code-space-size-mb=64'];

function error(code, message) { return Object.assign(new Error(message), { code }); }
function limit(value, fallback, maximum) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw error('ARCHIVE_INVALID', 'Некорректный лимит декодера архива');
  return value;
}
function requestOf(message, cloned = false) {
  if (!message || message.kind !== 'decode' || typeof message.id !== 'string' || !(Buffer.isBuffer(message.bytes) || (cloned && message.bytes instanceof Uint8Array)) || message.bytes.length > 25 * 1024 * 1024 || !message.limits || typeof message.limits !== 'object') throw error('ARCHIVE_INVALID', 'Некорректный запрос декодера RAR');
  return { ...message, bytes: Buffer.from(message.bytes.buffer, message.bytes.byteOffset, message.bytes.byteLength), limits: {
    entryBytes: limit(message.limits.entryBytes, 25 * 1024 * 1024, 25 * 1024 * 1024),
    entries: limit(message.limits.entries, 1000, 1000),
    extractedBytes: limit(message.limits.extractedBytes, 100 * 1024 * 1024, 100 * 1024 * 1024)
  } };
}
function rejected(id, caught) { return { id, ok: false, code: typeof caught.code === 'string' ? caught.code : 'ARCHIVE_INVALID', error: caught.message || 'Не удалось распаковать RAR' }; }

if (isMainThread) {
  let inner, timer, settled = false;
  const finish = result => {
    if (settled) return; settled = true; clearTimeout(timer);
    if (!process.connected || typeof process.send !== 'function') process.exit(0);
    process.send(result, () => process.exit(0));
  };
  // Registered before imports/decoding, so a terminated enclosing Worker cannot
  // leave an orphaned codec or remove the only timeout owner.
  process.on('disconnect', () => process.exit(0));
  process.once('message', message => {
    try {
      if (!CAPS.every(cap => process.execArgv.includes(cap)) || (process.versions.electron && process.env.ELECTRON_RUN_AS_NODE !== '1')) throw error('ARCHIVE_WORKER_LIMIT', 'Декодер RAR должен запускаться с ограничением памяти');
      const request = requestOf(message);
      timer = setTimeout(() => process.exit(124), 30000);
      inner = new Worker(__filename, { workerData: request, resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 16 } });
      inner.once('message', response => {
        if (response && response.ok === true && Array.isArray(response.entries)) response = { ...response, entries: response.entries.map(entry => ({ ...entry, bytes: entry.bytes instanceof Uint8Array ? Buffer.from(entry.bytes.buffer, entry.bytes.byteOffset, entry.bytes.byteLength) : entry.bytes })) };
        finish(response);
      });
      inner.once('error', caught => finish(rejected(request.id, caught)));
      inner.once('exit', code => { if (!settled) finish(rejected(request.id, error('ARCHIVE_DECODE', 'Декодер RAR завершился без результата: ' + code))); });
    } catch (caught) { finish(rejected(message && message.id, caught)); }
  });
} else {
  (async () => {
    const request = requestOf(workerData, true);
    const archive = await import(pathToFileURL(path.join(__dirname, '../ReestrBuilder/archive-budget.mjs')).href);
    const budget = archive.createArchiveBudget(request.limits);
    // The path is only a namespace for path validation, never created or read.
    const decoded = await archive.extractRarInProcess(request.bytes, path.join(os.tmpdir(), 'reestr-rar-memory'), budget, { collectBytes: true });
    return { id: request.id, ok: true, entries: decoded.map(entry => ({ name: entry.name, isDirectory: entry.directory, crc: entry.crc, bytes: entry.directory ? Buffer.alloc(0) : entry.bytes })) };
  })().then(value => parentPort.postMessage(value), caught => parentPort.postMessage(rejected(workerData && workerData.id, caught)));
}
