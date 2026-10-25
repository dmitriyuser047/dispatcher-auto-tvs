/* Portable request bytes and fingerprints. No validation, command or storage dependencies. */
(function(root,factory){'use strict';if(typeof module==='object'&&module.exports)module.exports=factory();else root.RequestFingerprint=factory();})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const tag=value=>Object.prototype.toString.call(value),plain=value=>value!=null&&tag(value)==='[object Object]',own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
  function fail(code,message,details){const error=new Error(message);error.name='PlatformKernelError';error.code=code;if(details!==undefined)error.details=details;throw error;}
  function stableSerialize(input) {
    const parents = new WeakSet();
    function visit(value, depth, inArray) {
      if (depth > 128) fail('INVALID_SNAPSHOT', 'Слишком глубокая структура данных');
      if (value === undefined) return inArray ? null : undefined;
      if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) fail('INVALID_SNAPSHOT', 'Данные содержат неконечное число');
        return value;
      }
      if (!Array.isArray(value) && !plain(value)) fail('INVALID_SNAPSHOT', 'Допустимы только данные JSON');
      if (parents.has(value)) fail('INVALID_SNAPSHOT', 'Циклическая структура данных');
      parents.add(value);
      let out;
      if (Array.isArray(value)) out = Array.from(value, item => visit(item, depth + 1, true));
      else {
        out = {};
        Object.keys(value).sort().forEach(key => {
          if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('INVALID_SNAPSHOT', 'Недопустимое поле данных: ' + key);
          const child = visit(value[key], depth + 1, false);
          if (child !== undefined) out[key] = child;
        });
      }
      parents.delete(value); return out;
    }
    return JSON.stringify(visit(input, 0, false));
  }
  // UTF-8 SHA-256 is synchronous and identical in the browser and Node backend.
  function sha256(text) {
    const bytes = [];
    for (const character of String(text)) {
      let code = character.codePointAt(0);
      if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
      if (code < 0x80) bytes.push(code);
      else if (code < 0x800) bytes.push(0xc0 | code >>> 6, 0x80 | code & 63);
      else if (code < 0x10000) bytes.push(0xe0 | code >>> 12, 0x80 | code >>> 6 & 63, 0x80 | code & 63);
      else bytes.push(0xf0 | code >>> 18, 0x80 | code >>> 12 & 63, 0x80 | code >>> 6 & 63, 0x80 | code & 63);
    }
    const bits = bytes.length * 8;
    bytes.push(0x80); while (bytes.length % 64 !== 56) bytes.push(0);
    for (const part of [Math.floor(bits / 0x100000000), bits >>> 0]) for (let shift = 24; shift >= 0; shift -= 8) bytes.push(part >>> shift & 255);
    const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19], w = new Int32Array(64);
    const rotate = (n, count) => n >>> count | n << 32 - count;
    for (let offset = 0; offset < bytes.length; offset += 64) {
      for (let i = 0; i < 16; i++) w[i] = bytes[offset + 4*i] << 24 | bytes[offset + 4*i+1] << 16 | bytes[offset + 4*i+2] << 8 | bytes[offset + 4*i+3];
      for (let i = 16; i < 64; i++) {
        const x = w[i-15], y = w[i-2], s0 = rotate(x,7) ^ rotate(x,18) ^ x >>> 3, s1 = rotate(y,17) ^ rotate(y,19) ^ y >>> 10;
        w[i] = w[i-16] + s0 + w[i-7] + s1 | 0;
      }
      let [a,b,c,d,e,f,g,j] = h;
      for (let i = 0; i < 64; i++) {
        const t1 = j + (rotate(e,6) ^ rotate(e,11) ^ rotate(e,25)) + (e & f ^ ~e & g) + k[i] + w[i] | 0;
        const t2 = (rotate(a,2) ^ rotate(a,13) ^ rotate(a,22)) + (a & b ^ a & c ^ b & c) | 0;
        j=g; g=f; f=e; e=d+t1|0; d=c; c=b; b=a; a=t1+t2|0;
      }
      [a,b,c,d,e,f,g,j].forEach((value, i) => { h[i] = h[i] + value | 0; });
    }
    return h.map(value => (value >>> 0).toString(16).padStart(8, '0')).join('');
  }
  function requestDigest(payload) {
    if(plain(payload)&&Object.prototype.hasOwnProperty.call(payload,'command')) {
      if(payload.protocolVersion!==1||!plain(payload.base)||!plain(payload.command)||Object.prototype.hasOwnProperty.call(payload,'sections'))
        fail('INVALID_ARGUMENT','Для отпечатка команды нужны её версия и исходные версии разделов');
      return 'sha256:'+sha256(stableSerialize({kind:'semantic-command',version:1,base:payload.base,command:payload.command}));
    }
    if (!plain(payload) || !plain(payload.base || {}) || !plain(payload.sections || {})) fail('INVALID_ARGUMENT', 'Для отпечатка нужны разделы и версии');
    const omitAudit = object => Object.fromEntries(Object.entries(object).filter(([name]) => name !== 'auditLog'));
    return 'sha256:' + sha256(stableSerialize({ base:omitAudit(payload.base || {}), sections:omitAudit(payload.sections || {}), ...(own(payload,'scopeViews')?{scopeViews:payload.scopeViews}:{}) }));
  }
  return Object.freeze({apiVersion:1,stableSerialize,sha256,requestDigest});
});
