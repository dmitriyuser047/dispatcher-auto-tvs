/* Minimal HTTP-LAN compatibility for UUIDv4 and SHA-256. Native crypto APIs
 * remain intact. UUID entropy comes only from native getRandomValues. */
(function () {
  'use strict';
  const engine = typeof crypto === 'object' && crypto;
  if (!engine) return;
  if (typeof engine.randomUUID !== 'function' && typeof engine.getRandomValues === 'function') {
    Object.defineProperty(engine, 'randomUUID', { configurable: true, value() {
      const bytes = engine.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
      const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
      return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
    } });
  }
  if (typeof engine.subtle?.digest === 'function') return;
  const constants = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
  const rotate = (value, count) => value >>> count | value << (32 - count);
  function sha256(bytes) {
    const state = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]), padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64), words = new Uint32Array(64);
    padded.set(bytes); padded[bytes.length] = 128;
    const view = new DataView(padded.buffer); view.setUint32(padded.length - 8, Math.floor(bytes.length / 0x20000000)); view.setUint32(padded.length - 4, bytes.length * 8 >>> 0);
    for (let offset = 0; offset < padded.length; offset += 64) {
      for (let index = 0; index < 16; index++) words[index] = view.getUint32(offset + index * 4);
      for (let index = 16; index < 64; index++) { const a = words[index - 15], b = words[index - 2]; words[index] = (words[index - 16] + (rotate(a, 7) ^ rotate(a, 18) ^ a >>> 3) + words[index - 7] + (rotate(b, 17) ^ rotate(b, 19) ^ b >>> 10)) >>> 0; }
      let [a,b,c,d,e,f,g,h] = state;
      for (let index = 0; index < 64; index++) { const first = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + (e & f ^ ~e & g) + constants[index] + words[index]) >>> 0, second = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + (a & b ^ a & c ^ b & c)) >>> 0; h = g; g = f; f = e; e = d + first >>> 0; d = c; c = b; b = a; a = first + second >>> 0; }
      [a,b,c,d,e,f,g,h].forEach((value, index) => { state[index] = state[index] + value >>> 0; });
    }
    const output = new ArrayBuffer(32), digest = new DataView(output); state.forEach((value, index) => digest.setUint32(index * 4, value)); return output;
  }
  function bufferSource(value) {
    const byteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
    if (ArrayBuffer.isView(value)) {
      try { byteLength.call(value.buffer); } catch { throw TypeError('SharedArrayBuffer is not supported.'); }
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
    }
    try { byteLength.call(value); } catch { throw TypeError('digest requires an ArrayBuffer or an ArrayBuffer view.'); }
    return new Uint8Array(value).slice();
  }
  async function digest(algorithm, data) {
    const name = typeof algorithm === 'string' ? algorithm : algorithm?.name;
    if (typeof name !== 'string' || name.toUpperCase() !== 'SHA-256') {
      const error = typeof DOMException === 'function' ? new DOMException('Only SHA-256 is supported.', 'NotSupportedError') : Object.assign(Error('Only SHA-256 is supported.'), { name: 'NotSupportedError' }); throw error;
    }
    const bytes = bufferSource(data); await Promise.resolve(); return sha256(bytes);
  }
  if (engine.subtle) Object.defineProperty(engine.subtle, 'digest', { configurable: true, value: digest });
  else Object.defineProperty(engine, 'subtle', { configurable: true, value: Object.freeze({ digest }) });
})();
