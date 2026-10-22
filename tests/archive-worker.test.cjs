'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { execFile } = require('node:child_process');
const decoder = require('../electron/archive-decoder.cjs');
const workerPath = path.resolve(__dirname, '../electron/archive-decoder-worker.cjs');

test('actual supervisor remains able to exit on disconnect and deadline with an unresponsive codec thread', () => {
  const processStub = new EventEmitter(), exits = [], timers = [], threads = [];
  Object.assign(processStub, { execArgv: [...decoder.EXEC_ARGS], versions: {}, env: {}, connected: true, exit: code => exits.push(code), send: () => assert.fail('an unresponsive codec must not produce a result') });
  class BlockedCodec extends EventEmitter { constructor(filename, options) { super(); threads.push({ filename, options }); } }
  const context = { Buffer, Uint8Array, process: processStub, __filename: workerPath, __dirname: path.dirname(workerPath), setTimeout: (run, ms) => { timers.push({ run, ms }); return timers.length; }, clearTimeout: () => {}, require(name) { return name === 'node:worker_threads' ? { Worker: BlockedCodec, isMainThread: true } : require(name); } };
  vm.runInNewContext(fs.readFileSync(workerPath, 'utf8'), context, { filename: workerPath, timeout: 1000 });
  processStub.emit('message', { kind: 'decode', id: 'blocked-native', bytes: Buffer.from('Rar!'), limits: decoder.DEFAULT_LIMITS });
  assert.equal(threads.length, 1); assert.equal(threads[0].filename, workerPath); assert.equal(threads[0].options.resourceLimits.maxOldGenerationSizeMb, 256);
  processStub.emit('disconnect'); assert.deepEqual(exits, [0], 'loss of the owning IPC channel kills the whole supervisor even while codec thread cannot respond');
  assert.equal(timers[0].ms, 30000); timers[0].run(); assert.deepEqual(exits, [0, 124], 'deadline belongs to the responsive supervisor, never to the blocked native thread');
});

function storedRar(value) {
  let table = Uint32Array.from({ length: 256 }, (_, number) => { for (let bit = 0; bit < 8; bit++) number = number & 1 ? 0xedb88320 ^ (number >>> 1) : number >>> 1; return number >>> 0; });
  const crc = bytes => { let result = 0xffffffff; for (const byte of bytes) result = table[(result ^ byte) & 255] ^ (result >>> 8); return (result ^ 0xffffffff) >>> 0; };
  const stamp = bytes => { bytes.writeUInt16LE(crc(bytes.subarray(2)) & 65535); return bytes; }, name = Buffer.from('data.json');
  const main = Buffer.alloc(13); main[2] = 0x73; main.writeUInt16LE(13, 5);
  const file = Buffer.alloc(32 + name.length); file[2] = 0x74; file.writeUInt16LE(0x8000, 3); file.writeUInt16LE(file.length, 5); file.writeUInt32LE(value.length, 7); file.writeUInt32LE(value.length, 11); file[15] = 2; file.writeUInt32LE(crc(value), 16); file[24] = 20; file[25] = 0x30; file.writeUInt16LE(name.length, 26); file.writeUInt32LE(0x20, 28); name.copy(file, 32);
  const end = Buffer.alloc(7); end[2] = 0x7b; end.writeUInt16LE(7, 5);
  return Buffer.concat([Buffer.from([82, 97, 114, 33, 26, 7, 0]), stamp(main), stamp(file), value, stamp(end)]);
}
function execute(binary, args, options) { return new Promise((resolve, reject) => execFile(binary, args, options, (error, stdout, stderr) => error ? reject(Object.assign(error, { stdout, stderr })) : resolve({ stdout, stderr }))); }

test('actual Electron run-as-node can supervise and decode a generated RAR using capped child and inner thread', { timeout: 15000 }, async () => {
  const expected = Buffer.from('{"records":[{"id":0,"km":0}]}'), bytes = storedRar(expected), binary = require('electron');
  const code = `const decoder=require(${JSON.stringify(path.resolve(__dirname, '../electron/archive-decoder.cjs'))});decoder.extractRAR(Buffer.from(process.argv[1],'base64')).then(entries=>{process.stdout.write(JSON.stringify({electron:!!process.versions.electron,name:entries[0].name,value:entries[0].bytes.toString('base64')}));},error=>{process.stderr.write(error.code+':'+error.message);process.exitCode=1;});`;
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }; delete env.NODE_OPTIONS;
  const result = await execute(binary, ['-e', code, bytes.toString('base64')], { env, windowsHide: true, timeout: 12000, maxBuffer: 1024 * 1024 });
  const response = JSON.parse(result.stdout); assert.equal(response.electron, true); assert.equal(response.name, 'data.json'); assert.equal(response.value, expected.toString('base64'));
});

test('controlled import RAR path retains raw typed zero facts through the actual isolated decoder', async () => {
  const expected = { vehicles: [{ id: 0, make: 'Numeric zero', plate: 'zero' }, { id: '0', make: 'Text zero', plate: 'text' }] };
  const { decode } = require('../electron/import-decoder.cjs');
  const result = await decode({ profile: 'vehicles', sections: ['vehicles'], files: [{ name: 'synthetic.rar', base64: storedRar(Buffer.from(JSON.stringify(expected))).toString('base64') }] });
  assert.equal(result.rows.length, 2); assert.deepEqual(result.rows.map(row => row.normalized), expected.vehicles); assert.deepEqual(result.scopes, ['vehicles']); assert.ok(result.rows.every(row => row.locator.entry === 'synthetic.rar/data.json'));
});
