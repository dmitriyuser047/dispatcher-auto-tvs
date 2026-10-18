'use strict';
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
    if (marker === 225 && length >= 16 && String.fromCharCode(...data.subarray(pos + 2, pos + 8)) === 'Exif\0\0') {
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
  if (data.length >= 33 && data[0] === 137 && four(data, 1) === 'PNG\r' && data[5] === 10 && data[6] === 26 && data[7] === 10) {
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
