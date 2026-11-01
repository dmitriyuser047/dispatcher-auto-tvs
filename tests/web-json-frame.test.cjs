'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http'), zlib = require('node:zlib');
const { createJsonFrame } = require('../web/json-frame.cjs');
const data = { vehicles: [{ id: 0, name: 'Синтетическая ДЭС · 923,537', note: '"},"data":{"injected":true},"x":"<script>\n\u2028' }], auditLog: [] };
const dataJSON = JSON.stringify(data);
function deliver(prepared) {
  let status, headers, bytes, sends = 0;
  const response = { writeHead(code, value) { status = code; headers = { ...value }; }, end(body, encoding) { sends++; bytes = Buffer.from(body, encoding); } };
  prepared.send(response);
  return { status, headers, bytes, sends };
}
function decoded(result) { return (result.headers['Content-Encoding'] === 'gzip' ? zlib.gunzipSync(result.bytes) : result.bytes).toString('utf8'); }

test('identity is byte-exact baseline JSON and one gzip member decodes to the same Unicode and injection-safe response', () => {
  const codec = createJsonFrame(dataJSON), envelope = { loadedSections: ['vehicles', 'auditLog'], access: { user: { id: 'actor-0', name: 'Имя "},"data":null\n' } }, databaseToken: 'synthetic-db' };
  assert.equal(Object.isFrozen(codec), true);
  const expected = JSON.stringify({ data, ...envelope });
  for (const encoding of [undefined, 'gzip']) {
    const prepared = codec.prepare(envelope, encoding), result = deliver(prepared);
    assert.equal(Object.isFrozen(prepared), true); assert.equal(result.status, 200); assert.equal(result.sends, 1);
    assert.equal(decoded(result), expected); assert.deepEqual(JSON.parse(decoded(result)), { data, ...envelope });
    assert.equal(result.headers['Content-Length'], result.bytes.length); assert.equal(result.headers['Content-Type'], 'application/json; charset=utf-8');
    assert.equal(result.headers['Cache-Control'], 'no-store'); assert.equal(result.headers['X-Content-Type-Options'], 'nosniff'); assert.equal(result.headers.Vary, 'Accept-Encoding');
    assert.equal(result.headers['Content-Encoding'], encoding === 'gzip' ? 'gzip' : undefined);
  }
  assert.equal(decoded(deliver(codec.prepare({}, 'gzip'))), JSON.stringify({ data }));
});

test('gzip requires explicit support or a positive wildcard and never overrides an explicit zero quality', () => {
  const codec = createJsonFrame('{}');
  for (const value of ['gzip', 'GZip', 'br, gzip;q=0.7', 'gzip;Q=1.000', '*', '*;q=0.1', '*;q=0, gzip;q=1'])
    assert.equal(deliver(codec.prepare({ actor: 'A' }, value)).headers['Content-Encoding'], 'gzip', value);
  for (const value of [undefined, '', 'br', 'identity', 'gzip;q=0', '*;q=0', '*;q=1, gzip;q=0', 'gzip;q=0, gzip;q=1', 'gzip;q=invalid', 'gzip;q=1.1', 'gzip;q=.5', 'gzip;q=0.0000', 'gzip;q=0;q=1'])
    assert.equal(deliver(codec.prepare({ actor: 'A' }, value)).headers['Content-Encoding'], undefined, value);
});

test('prepare owns envelope bytes and actors cannot alias another prepared response or codec', () => {
  const codec = createJsonFrame(dataJSON), envelope = { access: { user: { id: 'first' } }, marker: 'Original' };
  const first = codec.prepare(envelope, 'gzip'); envelope.access.user.id = 'mutated'; envelope.marker = 'Changed';
  const second = codec.prepare({ access: { user: { id: 'second' } } }, 'gzip');
  assert.equal(JSON.parse(decoded(deliver(first))).access.user.id, 'first'); assert.equal(JSON.parse(decoded(deliver(first))).marker, 'Original');
  assert.equal(JSON.parse(decoded(deliver(second))).access.user.id, 'second');
  let intercepted;
  first.send({ writeHead() {}, end(body, encoding) { assert.equal(typeof body, 'string'); intercepted = Buffer.from(body, encoding); intercepted.fill(0); } });
  assert.equal(JSON.parse(decoded(deliver(first))).access.user.id, 'first'); assert.deepEqual(JSON.parse(decoded(deliver(second))).data, data);
});

test('each gzip response is one complete fastest-level member prepared before send', () => {
  const original = zlib.gzipSync, inputs = [];
  zlib.gzipSync = function (input, options) { inputs.push({ json: Buffer.isBuffer(input) ? input.toString('utf8') : input, options }); return original.call(this, input, options); };
  try {
    const codec = createJsonFrame(dataJSON);
    const identity = codec.prepare({ actor: 'identity' }); assert.equal(inputs.length, 0);
    const first = codec.prepare({ actor: 'first' }, 'gzip'), second = codec.prepare({ actor: 'second' }, 'gzip');
    assert.equal(inputs.length, 2); assert.deepEqual(inputs.map(value => JSON.parse(value.json).actor), ['first', 'second']);
    assert.equal(inputs.every(value => value.options.level === zlib.constants.Z_BEST_SPEED), true);
    const emitted = deliver(first);
    assert.equal(emitted.bytes.equals(original(JSON.stringify({ data, actor: 'first' }), { level: zlib.constants.Z_BEST_SPEED })), true);
    deliver(identity); deliver(second); deliver(first); assert.equal(inputs.length, 2);
    createJsonFrame(dataJSON).prepare({ actor: 'new-cohort' }, 'gzip'); assert.equal(inputs.length, 3);
  } finally { zlib.gzipSync = original; }
});

test('prepare errors precede any HTTP headers and reject data collisions including custom JSON conversion', () => {
  const codec = createJsonFrame(dataJSON), sent = [];
  const response = { writeHead() { sent.push('headers'); }, end() { sent.push('body'); } };
  const invalid = [null, [], { data: {} }, { toJSON() { return { data: 'forged' }; } }, { toJSON() { return 'wrong-shape'; } }];
  const cyclic = {}; cyclic.self = cyclic; invalid.push(cyclic);
  for (const envelope of invalid) assert.throws(() => codec.prepare(envelope, 'gzip').send(response));
  assert.deepEqual(sent, []);
  assert.throws(() => createJsonFrame(null), { code: 'JSON_FRAME_INVALID' }); assert.throws(() => createJsonFrame(''), { code: 'JSON_FRAME_INVALID' });
  assert.throws(() => createJsonFrame('x'.repeat(64 * 1024 * 1024)), { code: 'JSON_FRAME_INVALID' });
});

function rawRequest(port, acceptEncoding) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: '/', headers: acceptEncoding ? { 'Accept-Encoding': acceptEncoding } : {}, agent: false }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ headers: response.headers, bytes: Buffer.concat(chunks), status: response.statusCode })); response.on('error', reject);
    }); request.on('error', reject);
  });
}
test('real HTTP identity remains exact while node HTTP and fetch decode a single gzip response', async t => {
  const codec = createJsonFrame(dataJSON), envelope = { actor: 'synthetic-http', loadedSections: ['vehicles', 'auditLog'] };
  const server = http.createServer((request, response) => codec.prepare(envelope, request.headers['accept-encoding']).send(response));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const port = server.address().port, expected = JSON.stringify({ data, ...envelope });
  const identity = await rawRequest(port); assert.equal(identity.status, 200); assert.equal(identity.headers['content-encoding'], undefined); assert.equal(identity.bytes.toString('utf8'), expected); assert.equal(Number(identity.headers['content-length']), identity.bytes.length);
  const gzip = await rawRequest(port, 'gzip'); assert.equal(gzip.headers['content-encoding'], 'gzip'); assert.equal(zlib.gunzipSync(gzip.bytes).toString('utf8'), expected); assert.equal(Number(gzip.headers['content-length']), gzip.bytes.length); assert.equal(gzip.headers.vary, 'Accept-Encoding');
  const response = await fetch('http://127.0.0.1:' + port, { headers: { 'Accept-Encoding': 'gzip' } }); assert.equal(response.headers.get('content-encoding'), 'gzip'); assert.equal(await response.text(), expected);
});
