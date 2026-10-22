import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import iconv from 'iconv-lite';
import { createExtractorFromData } from 'node-unrar-js';

export const ARCHIVE_LIMITS = Object.freeze({ inputBytes: 25 * 1024 * 1024, entries: 1000, entryBytes: 25 * 1024 * 1024, extractedBytes: 100 * 1024 * 1024, depth: 4 });
const ownedBudgets = new WeakSet(), ownedTemps = new WeakSet();
const MAX_ZIP_COMMENT = 65535;
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function integer(value, name, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) fail('ARCHIVE_INVALID', 'Некорректный размер: ' + name);
  return value;
}
export function createArchiveBudget(options = {}) {
  const limits = { ...ARCHIVE_LIMITS };
  for (const key of Object.keys(options)) {
    if (!Object.hasOwn(limits, key)) fail('ARCHIVE_INVALID', 'Неизвестный лимит архива');
    limits[key] = integer(options[key], key);
  }
  Object.freeze(limits);
  const counts = { inputBytes: 0, entries: 0, extractedBytes: 0 };
  function add(key, count, max) {
    integer(count, key);
    if (count > max - counts[key]) fail('ARCHIVE_LIMIT', 'Превышен общий лимит архива: ' + key);
    counts[key] += count;
  }
  const budget = Object.freeze({ limits,
    input(bytes) { integer(bytes, 'inputBytes'); if (bytes > limits.entryBytes) fail('ARCHIVE_LIMIT', 'Превышен размер загруженного файла'); add('inputBytes', bytes, limits.inputBytes); add('entries', 1, limits.entries); },
    reserve(entries) {
      let total = 0;
      for (const entry of entries) { const size = integer(entry.size, 'entryBytes'); if (size > limits.entryBytes) fail('ARCHIVE_LIMIT', 'Превышен размер файла в архиве'); total += size; if (!Number.isSafeInteger(total)) fail('ARCHIVE_LIMIT', 'Превышен размер архива'); }
      // Validate the whole list before creating any output or allocating decompressed data.
      if (entries.length > limits.entries - counts.entries || total > limits.extractedBytes - counts.extractedBytes) fail('ARCHIVE_LIMIT', 'Превышен общий лимит распаковки');
      counts.entries += entries.length; counts.extractedBytes += total;
    },
    depth(value) { integer(value, 'depth'); if (value > limits.depth) fail('ARCHIVE_LIMIT', 'Превышена глубина вложенных архивов'); },
    snapshot() { return Object.freeze({ ...counts }); }
  });
  ownedBudgets.add(budget); return budget;
}
export function requireArchiveBudget(value) {
  if (!ownedBudgets.has(value)) fail('ARCHIVE_INVALID', 'Нужен общий бюджет распаковки');
  return value;
}
export function createOwnedTemp(prefix = 'reestr-') {
  if (!/^reestr-(?:[a-z]+-)?$/.test(prefix)) fail('ARCHIVE_TEMP', 'Некорректный префикс временной папки');
  const parent = fs.realpathSync(os.tmpdir()), directory = fs.mkdtempSync(path.join(parent, prefix));
  const stat = fs.lstatSync(directory);
  const handle = Object.freeze({ directory, parent, prefix, dev: stat.dev, ino: stat.ino, birthtimeMs: stat.birthtimeMs });
  ownedTemps.add(handle); return handle;
}
function assertOwned(handle) {
  if (!ownedTemps.has(handle) || !path.isAbsolute(handle.directory) || path.dirname(handle.directory) !== handle.parent || !path.basename(handle.directory).startsWith(handle.prefix)) fail('ARCHIVE_TEMP', 'Чужая временная папка');
  const stat = fs.lstatSync(handle.directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== handle.dev || stat.ino !== handle.ino || stat.birthtimeMs !== handle.birthtimeMs || fs.realpathSync(handle.directory) !== handle.directory) fail('ARCHIVE_TEMP', 'Временная папка была подменена');
}
export function removeOwnedTemp(handle) {
  assertOwned(handle);
  // This is the only recursive removal: its absolute target, parent, prefix and identity were checked above.
  fs.rmSync(handle.directory, { recursive: true, force: true }); ownedTemps.delete(handle);
}
export function safeArchivePath(directory, entryName) {
  if (typeof entryName !== 'string') fail('ARCHIVE_PATH', 'Недопустимый путь в архиве');
  const name = entryName.replace(/\\/g, '/');
  if (!name || name.includes('\0') || /^(?:\/|[a-z]:)/i.test(name)) fail('ARCHIVE_PATH', 'Недопустимый путь в архиве: ' + entryName);
  const parts = name.replace(/\/$/, '').split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) fail('ARCHIVE_PATH', 'Путь выходит из папки архива или недопустим: ' + entryName);
  const target = path.resolve(directory, ...parts), relative = path.relative(path.resolve(directory), target);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) fail('ARCHIVE_PATH', 'Путь выходит из папки архива: ' + entryName);
  return target;
}
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
export function crc32(bytes) { let crc = 0xffffffff; for (const value of bytes) crc = crcTable[(crc ^ value) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function bufferOf(value) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) fail('ARCHIVE_INVALID', 'Нужны байты исходного файла');
  return Buffer.isBuffer(value) ? value : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}
function zipName(bytes, utf8) {
  if (utf8) { try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail('ARCHIVE_INVALID', 'Повреждённое UTF-8 имя ZIP'); } }
  // Existing documents include CP866 ZIPs and older ZIPs with UTF-8 but no flag.
  try { const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes); if (/^[\x00-\x7f]*$/.test(decoded) || /[А-яёЁ]/.test(decoded)) return decoded; } catch {}
  return iconv.decode(bytes, 'cp866');
}
function uniquePath(entry, directory, seen) {
  const outPath = safeArchivePath(directory, entry.name), key = path.relative(directory, outPath).normalize('NFC').toLowerCase();
  if (seen.has(key)) fail('ARCHIVE_PATH', 'Повторный путь в архиве: ' + entry.name);
  seen.add(key); return outPath;
}
function zipEntries(buffer, directory, budget) {
  if (buffer.length < 22) fail('ARCHIVE_INVALID', 'Повреждён ZIP');
  let end = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 22 - MAX_ZIP_COMMENT); offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50 && offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length) { end = offset; break; }
  }
  if (end < 0) fail('ARCHIVE_INVALID', 'Не найден конец ZIP');
  const count = buffer.readUInt16LE(end + 10), size = buffer.readUInt32LE(end + 12), central = buffer.readUInt32LE(end + 16);
  if (buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6) || buffer.readUInt16LE(end + 8) !== count || count === 65535 || size === 0xffffffff || central === 0xffffffff) fail('ARCHIVE_UNSUPPORTED', 'Многотомный ZIP и ZIP64 не поддерживаются');
  if (central + size !== end || count > budget.limits.entries - budget.snapshot().entries) fail(count > budget.limits.entries - budget.snapshot().entries ? 'ARCHIVE_LIMIT' : 'ARCHIVE_INVALID', 'Некорректный каталог ZIP или превышен лимит файлов');
  const entries = [], seen = new Set(), ranges = [];
  let cursor = central;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || buffer.readUInt32LE(cursor) !== 0x02014b50) fail('ARCHIVE_INVALID', 'Повреждён каталог ZIP');
    const flags = buffer.readUInt16LE(cursor + 8), method = buffer.readUInt16LE(cursor + 10), crc = buffer.readUInt32LE(cursor + 16), packed = buffer.readUInt32LE(cursor + 20), unpacked = buffer.readUInt32LE(cursor + 24);
    const nameSize = buffer.readUInt16LE(cursor + 28), extraSize = buffer.readUInt16LE(cursor + 30), commentSize = buffer.readUInt16LE(cursor + 32), disk = buffer.readUInt16LE(cursor + 34), attrs = buffer.readUInt32LE(cursor + 38), local = buffer.readUInt32LE(cursor + 42);
    if (cursor + 46 + nameSize + extraSize + commentSize > end) fail('ARCHIVE_INVALID', 'Повреждена запись ZIP');
    if ((flags & 0x2041) || ![0, 8].includes(method) || disk || packed === 0xffffffff || unpacked === 0xffffffff || local === 0xffffffff) fail('ARCHIVE_UNSUPPORTED', 'Зашифрованный или неподдерживаемый ZIP');
    const mode = (attrs >>> 16) & 0xf000;
    if (mode && mode !== 0x8000 && mode !== 0x4000) fail('ARCHIVE_UNSUPPORTED', 'Ссылки и специальные файлы ZIP не поддерживаются');
    const rawName = buffer.subarray(cursor + 46, cursor + 46 + nameSize), name = zipName(rawName, !!(flags & 0x800)), isDirectory = /[\\/]$/.test(name) || mode === 0x4000;
    const entry = { name, directory: isDirectory, size: unpacked, packed, crc, method, flags };
    entry.path = uniquePath(entry, directory, seen);
    if (isDirectory && (packed || unpacked)) fail('ARCHIVE_INVALID', 'Каталог ZIP содержит данные');
    if (local + 30 > central || buffer.readUInt32LE(local) !== 0x04034b50) fail('ARCHIVE_INVALID', 'Повреждён заголовок ZIP');
    const localNameSize = buffer.readUInt16LE(local + 26), localExtraSize = buffer.readUInt16LE(local + 28), start = local + 30 + localNameSize + localExtraSize;
    if (start > central || packed > central - start || buffer.readUInt16LE(local + 6) !== flags || buffer.readUInt16LE(local + 8) !== method || !buffer.subarray(local + 30, local + 30 + localNameSize).equals(rawName)) fail('ARCHIVE_INVALID', 'Заголовки ZIP не совпадают');
    for (const [offset, expected] of [[14, crc], [18, packed], [22, unpacked]]) { const actual = buffer.readUInt32LE(local + offset); if (actual !== expected && !((flags & 8) && actual === 0)) fail('ARCHIVE_INVALID', 'Размеры или CRC заголовков ZIP не совпадают'); }
    entry.start = start; ranges.push([local, start + packed]); entries.push(entry);
    cursor += 46 + nameSize + extraSize + commentSize;
  }
  if (cursor !== end) fail('ARCHIVE_INVALID', 'Лишние записи каталога ZIP');
  ranges.sort((a, b) => a[0] - b[0]);
  for (let index = 1; index < ranges.length; index++) if (ranges[index][0] < ranges[index - 1][1]) fail('ARCHIVE_INVALID', 'Перекрывающиеся записи ZIP');
  budget.reserve(entries); return entries;
}
function validateEntryBytes(entry, bytes) {
  if (bytes.length !== entry.size || crc32(bytes) !== (entry.crc >>> 0)) fail('ARCHIVE_INVALID', 'Размер или CRC содержимого не совпадает: ' + entry.name);
}
function writeEntry(entry, bytes) {
  validateEntryBytes(entry, bytes);
  if (entry.directory) { fs.mkdirSync(entry.path, { recursive: true }); return; }
  fs.mkdirSync(path.dirname(entry.path), { recursive: true });
  fs.writeFileSync(entry.path, bytes, { flag: 'wx' });
}
export function extractZipBounded(value, directory, budget, options = {}) {
  const buffer = bufferOf(value); requireArchiveBudget(budget);
  const entries = zipEntries(buffer, directory, budget);
  for (const entry of entries) {
    const compressed = buffer.subarray(entry.start, entry.start + entry.packed);
    let bytes;
    if (entry.method === 0) bytes = compressed;
    else {
      try { bytes = zlib.inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.size), info: true }); }
      catch (error) { fail(error.code === 'ERR_BUFFER_TOO_LARGE' ? 'ARCHIVE_LIMIT' : 'ARCHIVE_INVALID', 'Ошибка ограниченной распаковки ZIP: ' + entry.name); }
      if (bytes.engine.bytesWritten !== entry.packed) fail('ARCHIVE_INVALID', 'Лишние сжатые данные ZIP: ' + entry.name);
      bytes = bytes.buffer;
    }
    if (options.collectBytes === true) { validateEntryBytes(entry, bytes); entry.bytes = bytes; }
    else writeEntry(entry, bytes);
  }
  return options.includeDirectories === true ? entries : entries.filter(entry => !entry.directory);
}
function rarHeader(header, directory, seen, budget) {
  if (!header || typeof header.name !== 'string' || !header.flags || header.flags.encrypted || header.method === 'Unknown') fail('ARCHIVE_UNSUPPORTED', 'Зашифрованный или неподдерживаемый RAR');
  if (!Number.isInteger(header.crc) || header.crc < -2147483648 || header.crc > 0xffffffff) fail('ARCHIVE_INVALID', 'Некорректный CRC RAR');
  const entry = { name: header.name, directory: !!header.flags.directory, size: integer(header.unpSize, 'RAR unpSize'), packed: integer(header.packSize, 'RAR packSize'), crc: header.crc >>> 0 };
  if (entry.size > budget.limits.entryBytes || (entry.directory && entry.size)) fail('ARCHIVE_LIMIT', 'Превышен размер файла RAR');
  entry.path = uniquePath(entry, directory, seen); return entry;
}
function closeRar(extractor) { if (extractor?._archive && typeof extractor.closeArc === 'function') extractor.closeArc(); }
export async function extractRarInProcess(value, directory, budget, options = {}) {
  const buffer = bufferOf(value); requireArchiveBudget(budget);
  // factory is injectable only at this low-level module for decoder boundary tests, never via renderer options.
  const extractor = await (options.createExtractor || createExtractorFromData)({ data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) });
  const entries = [], seen = new Set();
  try {
    const list = extractor.getFileList();
    if (list.arcHeader?.flags?.volume || list.arcHeader?.flags?.headerEncrypted) fail('ARCHIVE_UNSUPPORTED', 'Многотомный или зашифрованный RAR');
    for (const header of list.fileHeaders) {
      if (entries.length >= budget.limits.entries - budget.snapshot().entries) fail('ARCHIVE_LIMIT', 'Превышен лимит файлов RAR');
      entries.push(rarHeader(header, directory, seen, budget));
    }
    budget.reserve(entries);
    const byName = new Map(entries.map(entry => [entry.name, entry])), descriptors = new Map();
    const originalCreate = extractor.create.bind(extractor), originalWrite = extractor.write.bind(extractor);
    extractor.create = function (name) {
      const entry = byName.get(name);
      if (!entry || entry.directory) fail('ARCHIVE_INVALID', 'RAR создал необъявленный файл');
      const fd = originalCreate(name); descriptors.set(fd, { entry, written: 0 }); return fd;
    };
    extractor.write = function (fd, pointer, size) {
      const descriptor = descriptors.get(fd); integer(size, 'RAR write');
      if (!descriptor || size > descriptor.entry.size - descriptor.written) fail('ARCHIVE_LIMIT', 'RAR превысил объявленный размер до выделения памяти');
      descriptor.written += size; return originalWrite(fd, pointer, size);
    };
    const actualNames = new Set();
    for (const file of extractor.extract({ files: header => !header.flags.directory }).files) {
      const entry = byName.get(file.fileHeader.name);
      if (!entry || actualNames.has(entry.name) || !file.extraction) fail('ARCHIVE_INVALID', 'Список RAR изменился при распаковке');
      if (file.fileHeader.unpSize !== entry.size || (file.fileHeader.crc >>> 0) !== entry.crc) fail('ARCHIVE_INVALID', 'Заголовок RAR изменился');
      actualNames.add(entry.name);
      const bytes = bufferOf(file.extraction);
      if (options.collectBytes === true) { validateEntryBytes(entry, bytes); entry.bytes = bytes; }
      else writeEntry(entry, bytes);
    }
    if (actualNames.size !== entries.filter(entry => !entry.directory).length) fail('ARCHIVE_INVALID', 'RAR распакован не полностью');
    return entries;
  } finally { closeRar(extractor); }
}
export async function extractRarBounded(value, directory, budget, options = {}) {
  requireArchiveBudget(budget);
  // Function-valued decoder doubles are accepted only by trusted Node tests.
  // Renderer/IPC objects cannot provide executable callbacks or select this path.
  if (typeof options.createExtractor === 'function') return (await extractRarInProcess(value, directory, budget, options)).filter(entry => !entry.directory);
  const { default: decoder } = await import('../electron/archive-decoder.cjs');
  const remaining = budget.snapshot(), entries = await decoder.extractRAR(bufferOf(value), {
    limits: { entryBytes: budget.limits.entryBytes,
      entries: budget.limits.entries - remaining.entries,
      extractedBytes: budget.limits.extractedBytes - remaining.extractedBytes },
    ...(options.signal ? { signal: options.signal } : {})
  });
  if (!Array.isArray(entries) || entries.length > budget.limits.entries - budget.snapshot().entries) fail('ARCHIVE_LIMIT', 'Превышен лимит файлов RAR');
  const seen = new Set(), outputs = [];
  for (const entry of entries) {
    if (!entry || typeof entry.name !== 'string' || typeof entry.isDirectory !== 'boolean' || !Buffer.isBuffer(entry.bytes) || (!entry.isDirectory && (!Number.isInteger(entry.crc) || entry.crc < 0 || entry.crc > 0xffffffff)) || (entry.isDirectory && entry.bytes.length)) fail('ARCHIVE_INVALID', 'Некорректный результат декодера RAR');
    const output = { name: entry.name, directory: entry.isDirectory, size: entry.bytes.length, crc: entry.isDirectory ? 0 : entry.crc, bytes: entry.bytes };
    output.path = uniquePath(output, directory, seen); outputs.push(output);
  }
  // The entire decoded response is revalidated against the common batch budget.
  // Concurrent uploads cannot reserve the same remaining capacity twice.
  budget.reserve(outputs);
  for (const entry of outputs) writeEntry(entry, entry.bytes);
  return outputs.filter(entry => !entry.directory).map(({ bytes, ...entry }) => entry);
}
export async function extractArchiveTree(value, directory, budget, depth = 0, options = {}) {
  requireArchiveBudget(budget).depth(depth);
  const buffer = bufferOf(value);
  const entries = buffer.subarray(0, 4).equals(Buffer.from([0x52, 0x61, 0x72, 0x21]))
    ? await extractRarBounded(buffer, directory, budget, options)
    : extractZipBounded(buffer, directory, budget);
  const documents = [];
  for (const entry of entries) {
    if (/\.(zip|rar)$/i.test(entry.name)) {
      budget.depth(depth + 1);
      // A generated extraction directory cannot collide with untrusted entry paths.
      const nested = fs.mkdtempSync(path.join(directory, '.reestr-nested-'));
      for (const child of await extractArchiveTree(fs.readFileSync(entry.path), nested, budget, depth + 1, options)) documents.push({ ...child, name: entry.name + '/' + child.name });
    } else if (/\.(pdf|jpe?g|png|tiff?|bmp)$/i.test(entry.name)) documents.push(entry);
  }
  return documents;
}
