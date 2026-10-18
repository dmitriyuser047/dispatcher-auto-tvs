'use strict';
// Reproducible, hash-pinned patches to Tesseract.js's native worker bindings.
// Does not change node_modules or the compiled C++/WASM binary.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const upstream = path.dirname(require.resolve('tesseract.js/package.json'));
const target = path.join(root, 'vendor', 'tesseract-worker');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const expected = {
  'worker-script/index.js': 'a5759d6d3d8beda31134dd041e2d3482b3adf26b6da4a3e7da9b1c5379114268',
  'worker-script/utils/dump.js': '09a7e2585627056d48e5ae0facf77cd21a97fcd8219f0ca6abd21065d157ad9f',
  'worker-script/utils/setImage.js': '608f928a37d0c456ef60ec3a6b1e9b17acc14ce3363fb39fed138aba7208490c',
};
if (JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'))).version !== '7.0.0') throw Error('Worker patches require Tesseract.js 7.0.0');
fs.mkdirSync(target, { recursive: true });
const ledger = [];
function read(file) {
  const data = fs.readFileSync(path.join(upstream, 'src', file));
  if (sha(data) !== expected[file]) throw Error('Upstream worker source changed: ' + file);
  return data.toString('utf8').replace(/\r\n/g, '\n');
}
function replace(source, before, after) {
  const index = source.indexOf(before);
  if (index < 0 || source.indexOf(before, index + before.length) >= 0) throw Error('Patch context is missing or ambiguous: ' + before.slice(0, 70));
  return source.slice(0, index) + after + source.slice(index + before.length);
}
function write(name, text, source) {
  const file = path.join(target, name);
  fs.writeFileSync(file + '.next', text);
  fs.renameSync(file + '.next', file);
  ledger.push({ file: name, sha256: sha(Buffer.from(text)), upstreamFile: source || null, upstreamSha256: source ? expected[source] : null });
}

write('upstream.cjs', `'use strict';
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const logicalFile = __filename.replace(/([\\\\/])app\\.asar\\.unpacked(?=[\\\\/]|$)/i, '$1app.asar');
const appRequire = createRequire(logicalFile);
const entry = appRequire.resolve('tesseract.js/package.json');
if (JSON.parse(fs.readFileSync(entry, 'utf8')).version !== '7.0.0') throw Error('Нужна комплектная версия Tesseract.js 7.0.0');
module.exports = createRequire(entry);
`);

let worker = read('worker-script/index.js');
worker = replace(worker, "require('regenerator-runtime/runtime');", "const upstreamRequire = require('./upstream.cjs');\nupstreamRequire('regenerator-runtime/runtime');");
worker = replace(worker, "const isURL = require('is-url');", "const isURL = upstreamRequire('is-url');");
for (const [before, after] of [
  ["require('./utils/dump')", "require('./dump.cjs')"],
  ["require('../utils/getEnvironment')", "upstreamRequire('./src/utils/getEnvironment')"],
  ["require('./utils/setImage')", "require('./set-image.cjs')"],
  ["require('./constants/defaultOutput')", "upstreamRequire('./src/worker-script/constants/defaultOutput')"],
  ["require('../utils/log')", "upstreamRequire('./src/utils/log')"],
  ["require('../constants/PSM')", "upstreamRequire('./src/constants/PSM')"],
]) worker = replace(worker, before, after);
worker = replace(worker, '    Core({', '    try {\n      TessModule = await Core({');
worker = replace(worker, `    }).then((tessModule) => {
      TessModule = tessModule;
      res.progress({ workerId, status: statusText, progress: 1 });
      res.resolve({ loaded: true });
    });`, `      });
      res.progress({ workerId, status: statusText, progress: 1 });
      res.resolve({ loaded: true });
    } catch (error) { res.reject(String(error && error.message || error)); }`);
// WebIDL wrapper objects need their destructor; End() does not delete the API.
worker = worker.replace(/      api\.End\(\);/g, '      TessModule.destroy(api);\n      api = null;');
worker = replace(worker, `    if (status === -1) {
      res.reject('initialization failed');
    }`, `    if (status !== 0) {
      if (api !== null) { TessModule.destroy(api); api = null; }
      throw Error('Tesseract initialization failed (code ' + status + ')');
    }`);
worker = replace(worker, '      api.SetVariable(key, _params[key]);', `      if (!api.SetVariable(key, String(_params[key]))) throw Error('Неизвестный или недоступный параметр Tesseract: ' + key);`);
worker = replace(worker, '    if (output.debug) {', '    let restoreParameters = false;\n    let debugFile = false;\n    let result;\n    try {\n    if (output.debug) {');
worker = replace(worker, "      TessModule.FS.writeFile('/debugInternal.txt', '');", "      TessModule.FS.writeFile('/debugInternal.txt', '');\n      debugFile = true;");
worker = replace(worker, '      api.SaveParameters();', '      api.SaveParameters();\n      restoreParameters = true;');
worker = replace(worker, '        api.SetVariable(prop, optionsTess[prop]);', "        if (!api.SetVariable(prop, String(optionsTess[prop]))) throw Error('Неизвестный параметр Tesseract: ' + prop);");
worker = replace(worker, '      api.Recognize(null);', "      if (api.Recognize(null) !== 0) { api.Clear(); throw Error('Ошибка нативного распознавания Tesseract'); }");
worker = replace(worker, `      setImage(TessModule, api, image);
      api.FindLines();

      // The function GetAngle will be replaced with GetGradient in 4.0.4,
      // but for now we want to maintain compatibility.
      // We can switch to only using GetGradient in v5.
      const rotateRadiansCalc = api.GetGradient ? api.GetGradient() : api.GetAngle();

      // Restore user-provided PSM setting
      if (psmEdit) {
        api.SetVariable('tessedit_pageseg_mode', String(psmInit));
      }`, `      let rotateRadiansCalc;
      try {
        setImage(TessModule, api, image);
        if (api.FindLines() !== 0) throw Error('Tesseract не смог определить строки страницы');
        rotateRadiansCalc = api.GetGradient ? api.GetGradient() : api.GetAngle();
        if (!Number.isFinite(rotateRadiansCalc)) throw Error('Tesseract вернул недопустимый угол страницы');
      } finally {
        if (psmEdit) api.SetVariable('tessedit_pageseg_mode', String(psmInit));
      }`);
worker = replace(worker, '    const result = dump(TessModule, api, workingOutput, { pdfTitle, pdfTextOnly, skipRecognition });', '    result = dump(TessModule, api, workingOutput, { pdfTitle, pdfTextOnly, skipRecognition });');
worker = replace(worker, `    if (output.debug) TessModule.FS.unlink('/debugInternal.txt');

    if (Object.keys(optionsTess).length > 0) {
      api.RestoreParameters();
    }

    res.resolve(result);`, `    } finally {
      try { if (restoreParameters) api.RestoreParameters(); }
      finally { if (debugFile) { try { TessModule.FS.unlink('/debugInternal.txt'); } catch (_) {} } }
    }
    res.resolve(result);`);
// Temporary dictionary configuration must not survive reinitialization.
worker = replace(worker, '    api = new TessModule.TessBaseAPI();', '    params = {};\n    api = new TessModule.TessBaseAPI();');
worker = worker.replace(/res\.resolve\(\{ loaded: true \}\);/g, 'res.resolve({ loaded: true, coreInfo: TessModule.__tvsCoreInfo || null });');
write('worker.cjs', '// Modified for TVS OCR binding; see PATCHES.md and UPSTREAM.json.\n' + worker, 'worker-script/index.js');

let dump = read('worker-script/utils/dump.js');
dump = replace(dump, "const arrayBufferToBase64 = require('./arrayBufferToBase64');", "const upstreamRequire = require('./upstream.cjs');\nconst arrayBufferToBase64 = upstreamRequire('./src/worker-script/utils/arrayBufferToBase64');");
dump = replace(dump, "const imageType = require('../../constants/imageType');", "const imageType = upstreamRequire('./src/constants/imageType');");
dump = replace(dump, '    version: api.Version(),', '    version: api.Version(),\n    imageTransform: api.__tvsImageTransform || null,');
dump = replace(dump, `    api.WriteImage(type, '/image.png');
    const pngBuffer = TessModule.FS.readFile('/image.png');
    const pngStr = \`data:image/png;base64,\${arrayBufferToBase64(pngBuffer.buffer)}\`;
    TessModule.FS.unlink('/image.png');
    return pngStr;`, `    try {
      api.WriteImage(type, '/image.png');
      const pngBuffer = TessModule.FS.readFile('/image.png');
      const exact = pngBuffer.buffer.slice(pngBuffer.byteOffset, pngBuffer.byteOffset + pngBuffer.byteLength);
      return \`data:image/png;base64,\${arrayBufferToBase64(exact)}\`;
    } finally { try { TessModule.FS.unlink('/image.png'); } catch (_) {} }`);
dump = replace(dump, `    pdfRenderer.BeginDocument(title);
    pdfRenderer.AddImage(api);
    pdfRenderer.EndDocument();
    TessModule._free(pdfRenderer);

    return TessModule.FS.readFile('/tesseract-ocr.pdf');`, `    try {
      if (!pdfRenderer.BeginDocument(title) || !pdfRenderer.AddImage(api) || !pdfRenderer.EndDocument()) throw Error('Не удалось сформировать поисковый PDF');
      return TessModule.FS.readFile('/tesseract-ocr.pdf').slice();
    } finally {
      try { TessModule.destroy(pdfRenderer); }
      finally { try { TessModule.FS.unlink('/tesseract-ocr.pdf'); } catch (_) {} }
    }`);
write('dump.cjs', '// Modified for TVS OCR binding; see PATCHES.md and UPSTREAM.json.\n' + dump, 'worker-script/utils/dump.js');

// The source image helper is deliberately replaced, with its upstream origin
// recorded: bounds-aware EXIF, temporary FS cleanup and clearing stale images.
read('worker-script/utils/setImage.js');
write('set-image.cjs', `'use strict';
// Derived from Tesseract.js 7.0.0 setImage.js, Apache-2.0. Modified for TVS.
const upstreamRequire = require('./upstream.cjs');
const bmp = upstreamRequire('bmp-js');
const MAX_PIXELS = 30000000;
function dimensions(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width * height > MAX_PIXELS) throw Error('Изображение OCR превышает 30 мегапикселей или имеет неверный размер');
  return { width, height };
}
function malformed(format) { throw Error('Повреждён заголовок изображения ' + format); }
function four(data, offset) { return String.fromCharCode(...data.subarray(offset, offset + 4)); }
function parseExif(data, base, end) {
  if (base + 8 > end) return null;
  const little = data[base] === 73 && data[base + 1] === 73;
  if (!little && !(data[base] === 77 && data[base + 1] === 77)) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint16(base + 2, little) !== 42) return null;
  const table = base + view.getUint32(base + 4, little);
  if (table < base + 8 || table + 2 > end) return null;
  const count = view.getUint16(table, little);
  for (let i = 0; i < count; i++) {
    const entry = table + 2 + i * 12;
    if (entry + 12 > end) return null;
    if (view.getUint16(entry, little) === 274 && view.getUint16(entry + 2, little) === 3 && view.getUint32(entry + 4, little) === 1) {
      const value = view.getUint16(entry + 8, little);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}
function jpegInfo(data) {
  let pos = 2, exif = 1, size = null;
  while (pos + 2 <= data.length) {
    if (data[pos] !== 255) malformed('JPEG');
    while (pos < data.length && data[pos] === 255) pos++;
    if (pos >= data.length) malformed('JPEG');
    const marker = data[pos++];
    if (marker === 217 || marker === 218) break;
    if (marker === 1 || marker >= 208 && marker <= 215) continue;
    if (pos + 2 > data.length) malformed('JPEG');
    const length = data[pos] * 256 + data[pos + 1];
    if (length < 2 || pos + length > data.length) malformed('JPEG');
    if (marker === 225 && length >= 16 && String.fromCharCode(...data.subarray(pos + 2, pos + 8)) === 'Exif\\0\\0') {
      exif = parseExif(data, pos + 8, pos + length) ?? exif;
      // Continue to SOF even after a valid orientation or invalid EXIF block.
    }
    if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
      if (length < 8) malformed('JPEG');
      size = dimensions(data[pos + 5] * 256 + data[pos + 6], data[pos + 3] * 256 + data[pos + 4]);
    }
    pos += length;
  }
  if (!size) malformed('JPEG');
  return { format: 'jpeg', ...size, exifOrientation: exif };
}
function bmpInfo(data) {
  if (data.length < 26) malformed('BMP');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const dib = view.getUint32(14, true);
  if (![12,40,52,56,108,124].includes(dib) || data.length < 14 + dib) malformed('BMP');
  const size = dib === 12
    ? dimensions(view.getUint16(18, true), view.getUint16(20, true))
    : dimensions(view.getInt32(18, true), Math.abs(view.getInt32(22, true)));
  const offset = view.getUint32(10, true);
  if (offset < 14 + dib || offset >= data.length) malformed('BMP');
  let bmpJs = false;
  if (dib === 40) {
    const bits = view.getUint16(28, true), compression = view.getUint32(30, true), colors = view.getUint32(46, true);
    const palette = bits <= 8 ? (colors || 2 ** bits) : 0;
    const masks = compression === 3 && [16,32].includes(bits) ? 12 : 0;
    // bmp-js assumes a 40-byte DIB and ignores the pixel offset it reads.
    // Send other layouts, including OS/2 (12-byte), directly to Leptonica.
    bmpJs = [1,4,8,16,24,32].includes(bits) && (compression === 0 || compression === 1 && bits === 8 || compression === 2 && bits === 4 || compression === 3 && [16,32].includes(bits))
      && palette <= 256 && offset === 54 + palette * 4 + masks;
  }
  return { format: 'bmp', ...size, exifOrientation: 1, bmpJs };
}
function tiffInfo(data) {
  if (data.length < 8) malformed('TIFF');
  const little = data[0] === 73;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const range = (offset, length) => {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset > data.length - length) malformed('TIFF');
  };
  const integer64 = offset => {
    range(offset, 8);
    const value = view.getBigUint64(offset, little);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) malformed('BigTIFF');
    return Number(value);
  };
  const magic = view.getUint16(2, little), big = magic === 43;
  if (magic !== 42 && !big) malformed('TIFF');
  if (big && (data.length < 16 || view.getUint16(4, little) !== 8 || view.getUint16(6, little) !== 0)) malformed('BigTIFF');
  const table = big ? integer64(8) : view.getUint32(4, little);
  if (table < (big ? 16 : 8)) malformed('TIFF');
  range(table, big ? 8 : 2);
  const count = big ? integer64(table) : view.getUint16(table, little);
  if (count > 4096) throw Error('TIFF содержит слишком много тегов в первой странице');
  const first = table + (big ? 8 : 2), step = big ? 20 : 12, inline = big ? 8 : 4;
  range(first, count * step);
  let width, height, samples = 1, bits = [1], sawSamples = false, sawBits = false;
  for (let i = 0; i < count; i++) {
    const entry = first + i * step, tag = view.getUint16(entry, little);
    if (![256,257,258,277].includes(tag)) continue;
    const type = view.getUint16(entry + 2, little), typeSize = ({3:2,4:4,16:8})[type];
    const amount = big ? integer64(entry + 4) : view.getUint32(entry + 4, little);
    if (!typeSize || amount < 1 || amount > 4 || tag !== 258 && amount !== 1) malformed('TIFF');
    let valuePos = entry + (big ? 12 : 8);
    if (amount * typeSize > inline) valuePos = big ? integer64(valuePos) : view.getUint32(valuePos, little);
    range(valuePos, amount * typeSize);
    const values = [];
    for (let n = 0; n < amount; n++) {
      const at = valuePos + n * typeSize;
      values.push(type === 3 ? view.getUint16(at, little) : type === 4 ? view.getUint32(at, little) : integer64(at));
    }
    const value = values[0];
    if (tag === 256 || tag === 257) {
      if (value <= 0 || value > MAX_PIXELS) dimensions(tag === 256 ? value : 1, tag === 257 ? value : 1);
      if (tag === 256) { if (width != null && width !== value) malformed('TIFF'); width = value; }
      else { if (height != null && height !== value) malformed('TIFF'); height = value; }
    } else if (tag === 258) {
      if (values.some(bit => ![1,2,4,8,16].includes(bit))) throw Error('TIFF OCR поддерживает до 16 бит на канал');
      if (sawBits && (values.length !== bits.length || values.some((bit, index) => bit !== bits[index]))) malformed('TIFF');
      bits = values; sawBits = true;
    } else {
      if (![1,2,3,4].includes(value)) throw Error('TIFF OCR поддерживает до 4 каналов');
      if (sawSamples && samples !== value) malformed('TIFF');
      samples = value; sawSamples = true;
    }
  }
  if (![1,2,3,4].includes(samples) || bits.some(value => ![1,2,4,8,16].includes(value))) throw Error('TIFF OCR поддерживает до 4 каналов и до 16 бит на канал');
  return { format: big ? 'bigtiff' : 'tiff', ...dimensions(width, height), exifOrientation: 1, firstPageOnly: true };
}
function webpInfo(data) {
  if (data.length < 20) malformed('WebP');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const end = view.getUint32(4, true) + 8;
  if (end > data.length || end < 20) malformed('WebP');
  let size = null, canvas = null, chunks = 0;
  for (let pos = 12; pos + 8 <= end;) {
    if (++chunks > 4096) malformed('WebP');
    const kind = four(data, pos), length = view.getUint32(pos + 4, true), at = pos + 8;
    if (length > end - at) malformed('WebP');
    if (kind === 'ANIM' || kind === 'ANMF') throw Error('Анимированный WebP не поддерживается OCR. Сохраните нужный кадр в PNG');
    if (kind === 'VP8X') {
      if (length < 10) malformed('WebP');
      if (data[at] & 2) throw Error('Анимированный WebP не поддерживается OCR. Сохраните нужный кадр в PNG');
      const value24 = offset => data[offset] + data[offset + 1] * 256 + data[offset + 2] * 65536;
      canvas = dimensions(value24(at + 4) + 1, value24(at + 7) + 1);
    } else if (kind === 'VP8 ') {
      if (length < 10 || data[at] & 1 || data[at + 3] !== 157 || data[at + 4] !== 1 || data[at + 5] !== 42) malformed('WebP');
      size = dimensions(view.getUint16(at + 6, true) & 16383, view.getUint16(at + 8, true) & 16383);
    } else if (kind === 'VP8L') {
      if (length < 5 || data[at] !== 47) malformed('WebP');
      const packed = view.getUint32(at + 1, true);
      size = dimensions((packed & 16383) + 1, ((packed >>> 14) & 16383) + 1);
    }
    pos = at + length + (length & 1);
    if (pos > end) malformed('WebP');
  }
  if (!size || canvas && (canvas.width !== size.width || canvas.height !== size.height)) malformed('WebP');
  return { format: 'webp', ...size, exifOrientation: 1 };
}
function inspectImage(data) {
  if (data[0] === 255 && data[1] === 216) return jpegInfo(data);
  if (data[0] === 66 && data[1] === 77) return bmpInfo(data);
  if (data[0] === 73 && data[1] === 73 || data[0] === 77 && data[1] === 77) return tiffInfo(data);
  if (four(data, 0) === 'GIF8') throw Error('GIF не поддерживается OCR. Сохраните нужный кадр в PNG');
  if (four(data, 0) === 'RIFF' && four(data, 8) === 'WEBP') return webpInfo(data);
  if (data.length >= 33 && data[0] === 137 && four(data, 1) === 'PNG\\r' && data[5] === 10 && data[6] === 26 && data[7] === 10) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (view.getUint32(8) !== 13 || four(data, 12) !== 'IHDR') malformed('PNG');
    return { format: 'png', ...dimensions(view.getUint32(16), view.getUint32(20)), exifOrientation: 1 };
  }
  throw Error('OCR принимает PNG, JPEG, BMP, TIFF и статический WebP');
}
module.exports = (TessModule, api, input, angle = 0) => {
  // A rejected header is also a failed image request: clear the preceding page
  // before validation, not only before the native decoder.
  api.Clear();
  delete api.__tvsImageTransform;
  try {
    const data = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : null;
    if (!data || !data.length || data.length > 64 * 1024 * 1024 || !Number.isFinite(angle)) throw Error('Не получено допустимое изображение OCR');
    const info = inspectImage(data);
    const bytes = info.bmpJs ? bmp.encode(bmp.decode(Buffer.from(data))).data : data;
    TessModule.FS.writeFile('/input', bytes);
    if (api.SetImageFile(info.exifOrientation, angle) !== 0) throw Error('Tesseract не смог прочитать изображение');
    api.__tvsImageTransform = { exifOrientation: info.exifOrientation, rotateRadians: angle,
      format: info.format, width: info.width, height: info.height, firstPageOnly: info.firstPageOnly === true };
    return info;
  } catch (error) { try { api.Clear(); } catch (_) {} throw error; }
  finally { try { TessModule.FS.unlink('/input'); } catch (_) {} }
};
`, 'worker-script/utils/setImage.js');

write('get-core.cjs', String.raw`'use strict';

// Hash-verified local native core adapter for the TVS Tesseract.js 7 worker.
// Native source patch provenance is separate from the JS binding patch ledger.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KNOWN_VARIANTS = Object.freeze({
  lstm: { stem: 'tesseract-core-lstm', features: [], priority: 0 },
  'simd-lstm': { stem: 'tesseract-core-simd-lstm', features: ['simd'], priority: 1 },
  'relaxedsimd-lstm': { stem: 'tesseract-core-relaxedsimd-lstm', features: ['simd', 'relaxed-simd'], priority: 2 },
});
const NATIVE_CORE_CONTRACT = Object.freeze({
  artifactKind: 'tvs-tesseract-wasm-core', nativeVersion: '5.3.0-tvs1',
  tesseractJs: '7.0.0', upstreamCorePackage: '7.0.0', workerProtocol: 'tesseract-js-node-worker-7',
  abi: 'tesseract-webidl7-tvs1', oem: 1,
  requiredPatchIds: Object.freeze(['0001-lstm-dictionary-flags', '0002-clear-image-on-decode-failure', '0003-portable-wasm-build-paths', '0004-tvs-native-version', '0005-glue-overload-dispatch', '0006-lstm-unavailable-legacy-api']),
});
const API_METHODS = Object.freeze([
  'Version', 'Init', 'End', 'Clear', 'SetVariable', 'SetImageFile', 'SetRectangle',
  'Recognize', 'GetUTF8Text', 'GetJSONText', 'MeanTextConf', 'GetPageSegMode',
  'SaveParameters', 'RestoreParameters', 'FindLines', 'GetGradient', 'oem',
]);
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw Object.assign(new Error(message), { code: 'OCR_CUSTOM_CORE' }); };
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const samePath = (left, right) => process.platform === 'win32' ? left.toLocaleLowerCase('en-US') === right.toLocaleLowerCase('en-US') : left === right;

function verifiedAsset(root, descriptor, expectedName) {
  if (!descriptor || descriptor.path !== expectedName || path.isAbsolute(descriptor.path) || descriptor.path.includes('\\') || descriptor.path.split('/').some(part => !part || part === '.' || part === '..')) fail('Недопустимое имя артефакта custom core');
  if (!isHash(descriptor.sha256) || !Number.isSafeInteger(descriptor.bytes) || descriptor.bytes <= 0) fail('Не заполнены размер и hash артефакта custom core');
  const filename = path.join(root, descriptor.path), physicalRoot = fs.realpathSync(root), physicalFile = fs.realpathSync(filename);
  const relative = path.relative(physicalRoot, physicalFile);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) fail('Артефакт custom core выходит за пределы своего каталога');
  const bytes = fs.readFileSync(physicalFile);
  if (bytes.length !== descriptor.bytes || sha256(bytes) !== descriptor.sha256) fail('Размер или SHA256 custom core не совпадает с manifest: ' + descriptor.path);
  return { path: physicalFile, bytes };
}

function readManifest(coreDirectory, expected = {}) {
  if (!isHash(expected.manifestSha256)) fail('Runtime не передал закреплённый manifest hash custom core');
  const filename = path.join(coreDirectory, 'manifest.json'), bytes = fs.readFileSync(filename);
  if (sha256(bytes) !== expected.manifestSha256) fail('Manifest custom core не совпадает с проверенным runtime hash');
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (manifest.schemaVersion !== 1 || manifest.artifactKind !== 'tvs-tesseract-wasm-core') fail('Неподдерживаемый manifest custom core');
  if (typeof manifest.buildId !== 'string' || !manifest.buildId || expected.buildId && manifest.buildId !== expected.buildId) fail('Build ID custom core отличается от ожидаемого');
  if (manifest.expectedRuntimeVersion !== NATIVE_CORE_CONTRACT.nativeVersion) fail('Не совпадает закреплённая строка TessBaseAPI.Version()');
  const compatible = manifest.compatibility;
  for (const key of ['tesseractJs', 'upstreamCorePackage', 'workerProtocol', 'abi', 'oem']) if (compatible?.[key] !== NATIVE_CORE_CONTRACT[key]) fail('Custom core не соответствует контракту ' + key);
  if (compatible.wasmMemory64 !== false || compatible.pthreads !== false) fail('Custom core требует неподдерживаемую память/потоки');
  if (!isHash(manifest.patchSetSha256) || expected.patchSetSha256 && manifest.patchSetSha256 !== expected.patchSetSha256 || !Array.isArray(manifest.patches) || !manifest.patches.length) fail('Не совпадает набор патчей нативных исходников custom core');
  const patchLedger = manifest.patches.map(patch => {
    if (typeof patch.id !== 'string' || !patch.id || !isHash(patch.sha256) || !/^patches\/[a-zA-Z0-9_.-]+\.patch$/.test(patch.path || '') || !Number.isSafeInteger(patch.bytes) || patch.bytes <= 0) fail('Повреждён список патчей нативных исходников custom core');
    return { id: patch.id, sha256: patch.sha256 };
  }).sort((a, b) => a.id.localeCompare(b.id, 'en'));
  if (sha256(Buffer.from(JSON.stringify(patchLedger), 'utf8')) !== manifest.patchSetSha256) fail('Содержимое patch ledger не соответствует patchSet hash');
  if (new Set(patchLedger.map(patch => patch.id)).size !== patchLedger.length) fail('Повторяющийся ID патча нативных исходников custom core');
  for (const patchId of NATIVE_CORE_CONTRACT.requiredPatchIds) if (!patchLedger.some(patch => patch.id === patchId)) fail('Отсутствует обязательный патч нативных исходников custom core: ' + patchId);
  if (!Array.isArray(manifest.variants) || !manifest.variants.length || manifest.variants.length > 3) fail('Нужен непустой перечень реально собранных LSTM-вариантов');
  const seen = new Set();
  for (const variant of manifest.variants) {
    const known = KNOWN_VARIANTS[variant.id];
    if (!known || seen.has(variant.id)) fail('Неизвестный или повторный вариант custom core');
    seen.add(variant.id);
    if (variant.lstmOnly !== true || variant.available !== true || JSON.stringify(variant.requiredFeatures) !== JSON.stringify(known.features)) fail('Feature flags custom core не соответствуют варианту');
    if (variant.js?.path !== known.stem + '.js' || variant.wasm?.path !== known.stem + '.wasm') fail('Имена glue/WASM не соответствуют варианту custom core');
  }
  if (!seen.has('lstm')) fail('Необходим scalar LSTM вариант для устройств без SIMD');
  return manifest;
}

function verifyManifestAssets(coreDirectory, manifest) {
  const variants = manifest.variants.map(variant => {
    const known = KNOWN_VARIANTS[variant.id];
    if (!known) fail('Неизвестный вариант custom core');
    const js = verifiedAsset(coreDirectory, variant.js, known.stem + '.js');
    const wasm = verifiedAsset(coreDirectory, variant.wasm, known.stem + '.wasm');
    if (wasm.bytes.length < 8 || wasm.bytes.readUInt32LE(0) !== 0x6d736100 || wasm.bytes.readUInt32LE(4) !== 1) fail('Файл custom core не является WASM v1');
    return { id: variant.id, js: { path: js.path, bytes: js.bytes.length, sha256: variant.js.sha256 }, wasm: { path: wasm.path, bytes: wasm.bytes.length, sha256: variant.wasm.sha256 } };
  });
  const patches = manifest.patches.map(patch => {
    const file = verifiedAsset(coreDirectory, patch, patch.path);
    return { id: patch.id, path: file.path, bytes: file.bytes.length, sha256: patch.sha256 };
  });
  return { variants, patches };
}

function validateModule(module, expectedVersion) {
  if (!module || typeof module.TessBaseAPI !== 'function' || typeof module.destroy !== 'function' || typeof module.getPointer !== 'function') fail('Custom core не экспортирует WebIDL/helpers Tesseract.js');
  for (const method of ['writeFile', 'readFile', 'unlink', 'mkdir']) if (typeof module.FS?.[method] !== 'function') fail('Custom core не экспортирует FS.' + method);
  for (const method of API_METHODS) if (typeof module.TessBaseAPI.prototype?.[method] !== 'function') fail('В custom core отсутствует обязательный API: ' + method);
  if (module.TessBaseAPI.prototype.Init.length !== 4) fail('ABI Init должен поддерживать четвёртый аргумент configFilename');
  // Validate the loaded module before the worker initializes any language.
  // Constructing this short-lived API object does not recognize an image.
  let probe;
  try {
    probe = new module.TessBaseAPI();
    const version = probe.Version();
    if (version !== expectedVersion) fail('Фактическая версия custom core отличается от manifest: ' + version);
    return version;
  } finally { if (probe) module.destroy(probe); }
}

function createLocalCoreAdapter({ coreDirectory, expected, featureDetect }) {
  if (!path.isAbsolute(coreDirectory)) fail('Нужен физический абсолютный каталог custom core');
  if (typeof featureDetect?.simd !== 'function' || typeof featureDetect?.relaxedSimd !== 'function') fail('Не передан штатный wasm-feature-detect');
  let selectedFactory = null, selection = null;
  const getCore = async (lstmOnly, suppliedCorePath, response) => {
    if (![true, 1, 3].includes(lstmOnly)) fail('Этот custom core поддерживает только LSTM OEM 1');
    if (!samePath(path.resolve(suppliedCorePath), path.resolve(coreDirectory))) fail('Worker получил другой путь custom core');
    if (selectedFactory) return selectedFactory;
    const manifest = readManifest(coreDirectory, expected);
    const hostSimd = await featureDetect.simd().catch(() => false), hostRelaxed = hostSimd && await featureDetect.relaxedSimd().catch(() => false);
    const available = manifest.variants.filter(variant => variant.requiredFeatures.every(feature => feature === 'simd' ? hostSimd : feature === 'relaxed-simd' ? hostRelaxed : false));
    available.sort((left, right) => KNOWN_VARIANTS[right.id].priority - KNOWN_VARIANTS[left.id].priority);
    const variant = available[0];
    if (!variant) fail('Нет совместимого с устройством custom core. Стоковое ядро не используется.');
    response?.progress?.({ status: 'loading tesseract core', progress: 0 });
    const known = KNOWN_VARIANTS[variant.id], js = verifiedAsset(coreDirectory, variant.js, known.stem + '.js'), wasm = verifiedAsset(coreDirectory, variant.wasm, known.stem + '.wasm');
    // require only the selected, hash-verified local glue. No package-level
    // tesseract.js-core fallback and no network fetch are permitted here.
    const exported = require(js.path), factory = typeof exported === 'function' ? exported : exported?.default;
    if (typeof factory !== 'function') fail('Glue custom core не экспортирует Emscripten MODULARIZE factory');
    selection = Object.freeze({
      buildId: manifest.buildId, manifestSha256: expected.manifestSha256, patchSetSha256: manifest.patchSetSha256,
      variant: variant.id, requiredFeatures: [...variant.requiredFeatures], jsSha256: variant.js.sha256, wasmSha256: variant.wasm.sha256,
      expectedRuntimeVersion: manifest.expectedRuntimeVersion, abi: manifest.compatibility.abi,
      corePath: coreDirectory, source: 'custom-local-wasm', stockFallback: false,
    });
    selectedFactory = async options => {
      const module = await factory({
        ...options,
        // Compile the exact verified bytes, not a second unverified disk read.
        wasmBinary: new Uint8Array(wasm.bytes),
        locateFile(name) { if (name === variant.wasm.path) return wasm.path; fail('Custom core запросил непредусмотренный файл: ' + name); },
      });
      const actualVersion = validateModule(module, manifest.expectedRuntimeVersion);
      Object.defineProperty(module, '__tvsCoreInfo', { value: Object.freeze({ ...selection, actualRuntimeVersion: actualVersion }), enumerable: false });
      return module;
    };
    response?.progress?.({ status: 'loading tesseract core', progress: 1 });
    return selectedFactory;
  };
  getCore.selection = () => selection;
  return getCore;
}

module.exports = { createLocalCoreAdapter, readManifest, verifyManifestAssets, validateModule, KNOWN_VARIANTS, API_METHODS, NATIVE_CORE_CONTRACT };
`);

write('index.cjs', `'use strict';
// Node worker entry for the patched, local Tesseract.js native binding.
const { parentPort, workerData } = require('worker_threads');
const upstreamRequire = require('./upstream.cjs');
const worker = require('./worker.cjs');
const { createLocalCoreAdapter } = require('./get-core.cjs');
if (!workerData || !workerData.tvsCore) throw Error('Runtime не передал ожидаемый manifest custom core');
const getCore = createLocalCoreAdapter({
  coreDirectory: workerData.tvsCore.corePath, expected: workerData.tvsCore,
  featureDetect: upstreamRequire('wasm-feature-detect'),
});
worker.setAdapter({
  getCore,
  gunzip: upstreamRequire('./src/worker-script/node/gunzip'),
  fetch: async () => { throw Error('Сетевое получение моделей OCR отключено: используйте комплектные локальные модели'); },
  ...upstreamRequire('./src/worker-script/node/cache'),
});
parentPort.on('message', packet => worker.dispatchHandlers(packet, response => parentPort.postMessage(response)));
`);
fs.copyFileSync(path.join(upstream, 'LICENSE.md'), path.join(target, 'LICENSE.md'));
fs.writeFileSync(path.join(target, 'UPSTREAM.json'), JSON.stringify({ upstream: 'https://github.com/naptha/tesseract.js', packageVersion: '7.0.0', patchSetVersion: 2, bindingPatchSetVersion: 2, nativeCorePolicy: 'custom-manifest-required; separate native patch ledger', nativeCoreManifest: 'vendor/tesseract-core/manifest.json', files: ledger }, null, 2) + '\n');
console.log(JSON.stringify({ target, generatedFiles: ledger.length, upstreamVersion: '7.0.0', bindingPatchSetVersion: 2, nativeCorePolicy: 'custom-manifest-required' }));
