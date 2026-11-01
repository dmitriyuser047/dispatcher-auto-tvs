'use strict';

// Trusted workspace JSON only: the producer already projected canonical data,
// and this envelope contains response metadata rather than CSRF/login secrets.
// Each cohort owns one codec; there is intentionally no process-wide cache.
// One gzip member per response preserves browser decoder compatibility.
const zlib = require('node:zlib');
const MAX_BYTES = 64 * 1024 * 1024;
const fail = message => Object.assign(new Error(message), { code: 'JSON_FRAME_INVALID' });

function acceptsGzip(value) {
  if (typeof value !== 'string') return false;
  const gzip = [], wildcard = [];
  for (const item of value.split(',')) {
    const [coding, ...parameters] = item.split(';'), name = coding.trim().toLowerCase();
    if (name !== 'gzip' && name !== '*') continue;
    const qualities = parameters.filter(parameter => /^\s*q\s*=/i.test(parameter));
    let quality = 1;
    if (qualities.length) {
      const match = qualities.length === 1 && /^\s*q\s*=\s*(0(?:\.[0-9]{0,3})?|1(?:\.0{0,3})?)\s*$/i.exec(qualities[0]);
      quality = match ? Number(match[1]) : 0;
    }
    (name === 'gzip' ? gzip : wildcard).push(quality);
  }
  const selected = gzip.length ? gzip : wildcard;
  // An explicit refusal wins over wildcard support and ambiguous duplicates.
  return selected.length > 0 && !selected.includes(0) && selected.some(quality => quality > 0);
}

function createJsonFrame(dataJSON) {
  if (typeof dataJSON !== 'string' || !dataJSON.length) throw fail('Нужна проверенная JSON-строка данных.');
  const prefix = '{"data":' + dataJSON, prefixBytes = Buffer.byteLength(prefix, 'utf8');
  if (prefixBytes >= MAX_BYTES) throw fail('JSON-ответ превышает 64 МиБ.');
  function prepare(envelope, acceptEncoding) {
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || Object.hasOwn(envelope, 'data')) throw fail('Метаданные ответа не должны содержать раздел data.');
    const metadata = JSON.stringify(envelope);
    if (typeof metadata !== 'string' || !metadata.startsWith('{') || !metadata.endsWith('}') || Object.hasOwn(JSON.parse(metadata), 'data')) throw fail('Метаданные ответа должны быть JSON-объектом без раздела data.');
    const suffix = metadata === '{}' ? '}' : ',' + metadata.slice(1), suffixBytes = Buffer.byteLength(suffix, 'utf8');
    if (prefixBytes + suffixBytes > MAX_BYTES) throw fail('JSON-ответ превышает 64 МиБ.');
    const compressed = acceptsGzip(acceptEncoding);
    let body, encoding, contentLength;
    if (compressed) {
      // Binary strings are immutable. No cached Buffer or mutable view ever
      // leaves the codec, including through an injected/fake HTTP response.
      body = zlib.gzipSync(prefix + suffix, { level: zlib.constants.Z_BEST_SPEED }).toString('latin1');
      encoding = 'latin1'; contentLength = body.length;
    } else {
      body = prefix + suffix; encoding = 'utf8'; contentLength = prefixBytes + suffixBytes;
    }
    const headers = Object.freeze({
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      Vary: 'Accept-Encoding', 'Content-Length': contentLength, ...(compressed ? { 'Content-Encoding': 'gzip' } : {}),
    });
    return Object.freeze({ send(res) { res.writeHead(200, headers); return res.end(body, encoding); } });
  }
  return Object.freeze({ prepare });
}

module.exports = Object.freeze({ createJsonFrame });
