const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const iconv = require('iconv-lite');
const root = path.resolve(__dirname, '..');
let m, lib;
before(async () => { m = await import('../ReestrBuilder/archive-budget.mjs'); });
after(async () => { if (lib) await lib.disposeOcrWorker(); });
async function recognition() { return lib ||= await import('../ReestrBuilder/lib.mjs'); }
function zip(files) {
  const local = [], central = []; let offset = 0;
  for (const file of files) {
    const name = file.rawName || Buffer.from(file.name), value = file.value || Buffer.alloc(0), method = file.method ?? 8;
    const packed = method === 0 ? value : zlib.deflateRawSync(value);
    const head = Buffer.alloc(30); head.writeUInt32LE(0x04034b50); head.writeUInt16LE(20, 4); head.writeUInt16LE(file.flags ?? 0x800, 6); head.writeUInt16LE(method, 8);
    head.writeUInt32LE(m.crc32(value), 14); head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(file.declaredSize ?? value.length, 22); head.writeUInt16LE(name.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(0x314, 4); c.writeUInt16LE(20, 6); head.copy(c, 8, 6, 26); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(file.attrs ?? 0x81a40000, 38); c.writeUInt32LE(offset, 42);
    local.push(head, name, packed); central.push(c, name); offset += head.length + name.length + packed.length;
  }
  const catalogue = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(catalogue.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, catalogue, end]);
}
function rarStored(name, value) {
  const stamp = buffer => { buffer.writeUInt16LE(m.crc32(buffer.subarray(2)) & 0xffff); return buffer; };
  const main = Buffer.alloc(13); main[2] = 0x73; main.writeUInt16LE(main.length, 5);
  const rawName = Buffer.from(name), file = Buffer.alloc(32 + rawName.length); file[2] = 0x74; file.writeUInt16LE(0x8000, 3); file.writeUInt16LE(file.length, 5); file.writeUInt32LE(value.length, 7); file.writeUInt32LE(value.length, 11); file[15] = 2; file.writeUInt32LE(m.crc32(value), 16); file[24] = 20; file[25] = 0x30; file.writeUInt16LE(rawName.length, 26); file.writeUInt32LE(0x20, 28); rawName.copy(file, 32);
  const end = Buffer.alloc(7); end[2] = 0x7b; end.writeUInt16LE(7, 5);
  return Buffer.concat([Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0]), stamp(main), stamp(file), value, stamp(end)]);
}
function temp() { return m.createOwnedTemp('reestr-test-'); }
function budget(overrides = {}) { return m.createArchiveBudget({ inputBytes: 100000, entries: 100, entryBytes: 20000, extractedBytes: 50000, depth: 4, ...overrides }); }
function withTemp(run) { const t = temp(); try { return run(t.directory); } finally { m.removeOwnedTemp(t); } }
async function withTempAsync(run) { const t = temp(); try { return await run(t.directory); } finally { m.removeOwnedTemp(t); } }
test('STORE and DEFLATE preserve exact bytes, zero files and Cyrillic names', () => withTemp(directory => {
  const source = zip([{ name: 'папка/счет.pdf', value: Buffer.from('invoice'), method: 0 }, { name: 'second.pdf', value: Buffer.from('second') }, { name: 'empty.pdf' }]);
  const result = m.extractZipBounded(source, directory, budget()); assert.equal(result.length, 3); assert.equal(fs.readFileSync(result[0].path, 'utf8'), 'invoice'); assert.equal(fs.readFileSync(result[2].path).length, 0);
}));
test('CP866 and old unflagged UTF8 entry names remain readable', () => withTemp(directory => {
  const source = zip([{ rawName: iconv.encode('счет.pdf', 'cp866'), flags: 0, value: Buffer.from('one') }, { name: 'акт.pdf', flags: 0, value: Buffer.from('two') }]);
  assert.deepEqual(m.extractZipBounded(source, directory, budget()).map(row => row.name), ['счет.pdf', 'акт.pdf']);
}));
test('disk-free ZIP collection preserves verified bytes without creating an extraction directory', () => withTemp(directory => {
  const namespace = path.join(directory, 'not-created'), value = Buffer.from('{"known":0,"unknown":null}');
  const source = zip([{ name: 'database.json', value }, { name: 'extra/', method: 0, attrs: 0x41ed0000 }]);
  const rows = m.extractZipBounded(source, namespace, budget(), { collectBytes: true, includeDirectories: true });
  assert.equal(fs.existsSync(namespace), false); assert.equal(rows[0].name, 'database.json'); assert.deepEqual(rows[0].bytes, value);
  assert.equal(rows.length, 2); assert.equal(rows[1].directory, true); assert.equal(rows[1].bytes.length, 0);
  const lying = zip([{ name: 'bomb.json', value: Buffer.alloc(1000000, 65), declaredSize: 8 }]);
  assert.throws(() => m.extractZipBounded(lying, namespace, budget(), { collectBytes: true }), { code: 'ARCHIVE_LIMIT' }); assert.equal(fs.existsSync(namespace), false);
}));
test('declared oversized ZIP is rejected before any output file', () => withTemp(directory => {
  const source = zip([{ name: 'first.pdf', value: Buffer.from('ok') }, { name: 'bomb.pdf', value: Buffer.alloc(16), declaredSize: 20001 }]);
  assert.throws(() => m.extractZipBounded(source, directory, budget()), { code: 'ARCHIVE_LIMIT' }); assert.deepEqual(fs.readdirSync(directory), []);
}));
test('lying small size bounds real DEFLATE output before allocation', () => withTemp(directory => {
  const source = zip([{ name: 'bomb.pdf', value: Buffer.alloc(1000000, 65), declaredSize: 8 }]);
  assert.throws(() => m.extractZipBounded(source, directory, budget()), { code: 'ARCHIVE_LIMIT' }); assert.deepEqual(fs.readdirSync(directory), []);
}));
test('ZIP CRC mismatch, unsupported encryption and compression are rejected', () => {
  for (const mode of ['crc', 'encrypted', 'method']) withTemp(directory => {
    const source = zip([{ name: 'a.pdf', value: Buffer.from('value') }]), central = source.indexOf(Buffer.from([0x50, 0x4b, 1, 2]));
    if (mode === 'crc') { source.writeUInt32LE(1, 14); source.writeUInt32LE(1, central + 16); }
    if (mode === 'encrypted') { source.writeUInt16LE(0x801, 6); source.writeUInt16LE(0x801, central + 8); }
    if (mode === 'method') { source.writeUInt16LE(12, 8); source.writeUInt16LE(12, central + 10); }
    assert.throws(() => m.extractZipBounded(source, directory, budget()), error => /^ARCHIVE_/.test(error.code)); assert.equal(fs.existsSync(path.join(directory, 'a.pdf')), false);
  });
});
test('ZIP traversal, alternate streams, devices, special links and case collisions reject', () => {
  for (const name of ['../x.pdf', '/x.pdf', 'C:/x.pdf', 'a:secret.pdf', 'NUL.pdf', 'a./x.pdf', 'a\\..\\x.pdf']) withTemp(directory => assert.throws(() => m.extractZipBounded(zip([{ name }]), directory, budget()), { code: 'ARCHIVE_PATH' }));
  withTemp(directory => assert.throws(() => m.extractZipBounded(zip([{ name: 'x.pdf', attrs: 0xa1ff0000 }]), directory, budget()), { code: 'ARCHIVE_UNSUPPORTED' }));
  withTemp(directory => assert.throws(() => m.extractZipBounded(zip([{ name: 'A.pdf' }, { name: 'a.pdf' }]), directory, budget()), { code: 'ARCHIVE_PATH' }));
});
test('many tiny entries are counted before extraction', () => withTemp(directory => {
  const source = zip(Array.from({ length: 8 }, (_, index) => ({ name: index + '.pdf' })));
  assert.throws(() => m.extractZipBounded(source, directory, budget({ entries: 7 })), { code: 'ARCHIVE_LIMIT' }); assert.deepEqual(fs.readdirSync(directory), []);
}));
test('all original uploads share compressed input and entry counters', async () => {
  const shared = budget({ inputBytes: 9, entryBytes: 9, entries: 2 }); shared.input(4); shared.input(5); assert.throws(() => shared.input(1), { code: 'ARCHIVE_LIMIT' });
  const recognitionLib = await recognition(); let callbacks = 0;
  await assert.rejects(recognitionLib.parsePdfFiles([{ name: 'a.pdf', buffer: Buffer.alloc(5) }, { name: 'b.pdf', buffer: Buffer.alloc(5) }], recognitionLib.DEFAULT_CONFIG, () => callbacks++, undefined, undefined, { budget: budget({ inputBytes: 9 }), precharged: true }), { code: 'ARCHIVE_LIMIT' });
  assert.equal(callbacks, 0, 'public precharged option cannot bypass common batch budget');
});
test('nested ZIP shares total extracted budget and cannot return a partial review', async () => withTempAsync(async directory => {
  const inner = zip([{ name: 'a.pdf', value: Buffer.alloc(1000, 1) }]), outer = zip([{ name: 'inner.zip', value: inner }]);
  const shared = budget({ extractedBytes: inner.length + 999 }); shared.input(outer.length);
  await assert.rejects(m.extractArchiveTree(outer, directory, shared), { code: 'ARCHIVE_LIMIT' }); assert.equal(shared.snapshot().extractedBytes, inner.length);
}));
test('separate top-level archives share one extracted budget across a batch', async () => {
  const shared = budget({ extractedBytes: 900 }), source = zip([{ name: 'a.pdf', value: Buffer.alloc(500, 1) }]);
  await withTempAsync(async directory => { shared.input(source.length); assert.equal((await m.extractArchiveTree(source, directory, shared)).length, 1); });
  await withTempAsync(async directory => { shared.input(source.length); await assert.rejects(m.extractArchiveTree(source, directory, shared), { code: 'ARCHIVE_LIMIT' }); assert.deepEqual(fs.readdirSync(directory), []); });
  assert.equal(shared.snapshot().extractedBytes, 500);
});
test('central/local mismatch, ZIP64 and overlapping ZIP payloads fail closed', () => {
  for (const mode of ['local-size', 'zip64', 'overlap']) withTemp(directory => {
    const source = zip([{ name: 'a.pdf', value: Buffer.from('one'), method: 0 }, { name: 'b.pdf', value: Buffer.from('two'), method: 0 }]);
    const first = source.indexOf(Buffer.from([0x50, 0x4b, 1, 2])), second = source.indexOf(Buffer.from([0x50, 0x4b, 1, 2]), first + 4);
    if (mode === 'local-size') source.writeUInt32LE(4, 22);
    if (mode === 'zip64') source.writeUInt32LE(0xffffffff, first + 24);
    if (mode === 'overlap') {
      // Both local headers/names, central CRCs and sizes are independently valid.
      // The first STORE payload includes the second local header and payload.
      const start = 30 + Buffer.byteLength('a.pdf'), bytes = source.subarray(start, first), crc = m.crc32(bytes);
      for (const offset of [0, first]) { const base = offset ? 16 : 14; source.writeUInt32LE(crc, offset + base); source.writeUInt32LE(bytes.length, offset + base + 4); source.writeUInt32LE(bytes.length, offset + base + 8); }
    }
    assert.throws(() => m.extractZipBounded(source, directory, budget()), error => /^ARCHIVE_/.test(error.code)); assert.deepEqual(fs.readdirSync(directory), []);
  });
});
test('depth is strict and common across nested archives', async () => withTempAsync(async directory => {
  let source = zip([{ name: 'a.pdf', value: Buffer.from('x') }]); for (let index = 0; index < 3; index++) source = zip([{ name: 'inner.zip', value: source }]);
  await assert.rejects(m.extractArchiveTree(source, directory, budget({ depth: 2 })), { code: 'ARCHIVE_LIMIT' });
}));
test('corrupt nested archive rejects whole parse instead of warning plus partial rows', async () => {
  const recognitionLib = await recognition(); const source = zip([{ name: 'good.pdf', value: fs.readFileSync(path.join(root, 'tests/fixtures/ocr/synthetic-text.pdf')) }, { name: 'bad.zip', value: Buffer.from('broken') }]);
  await assert.rejects(recognitionLib.parseInvoices(source, recognitionLib.DEFAULT_CONFIG), { code: 'ARCHIVE_INVALID' });
});
test('real RAR4 stored document extraction checks headers, bytes and CRC', async () => withTempAsync(async directory => {
  const value = Buffer.from('actual stored RAR fixture'); const source = rarStored('invoice.pdf', value);
  const rows = await m.extractRarBounded(source, directory, budget()); assert.equal(rows.length, 1); assert.deepEqual(fs.readFileSync(rows[0].path), value);
}));
function fakeRar({ size = 3, writeSize = size, count = 1, encrypted = false, volume = false, corrupt = false } = {}) {
  const state = { extracted: false, copied: 0, closed: false }; const value = Buffer.alloc(size, 65);
  const headers = Array.from({ length: count }, (_, index) => ({ name: index + '.pdf', flags: { encrypted, directory: false }, method: 'Storing', unpSize: size, packSize: size, crc: m.crc32(value) }));
  const extractor = { _archive: {}, getFileList() { return { arcHeader: { flags: { volume } }, fileHeaders: headers.values() }; }, closeArc() { state.closed = true; this._archive = null; }, create() { return 1; }, write(fd, pointer, bytes) { state.copied += bytes; return true; }, extract() { state.extracted = true; const self = this; return { files: (function* () { for (const h of headers) { const fd = self.create(h.name); self.write(fd, 0, writeSize); yield { fileHeader: h, extraction: corrupt ? Buffer.alloc(size, 66) : value }; } })() }; } };
  return { state, createExtractor: async () => extractor };
}
test('RAR validates all header counts and size totals before extract', async () => {
  for (const options of [{ count: 9 }, { size: 20001 }, { count: 3, size: 19000 }, { encrypted: true }, { volume: true }]) await withTempAsync(async directory => {
    const fake = fakeRar(options); await assert.rejects(m.extractRarBounded(Buffer.alloc(1), directory, budget({ entries: 8 }), fake), error => /^ARCHIVE_/.test(error.code)); assert.equal(fake.state.extracted, false); assert.equal(fake.state.copied, 0); assert.equal(fake.state.closed, true);
  });
});
test('RAR blocks lying actual write before underlying allocation/copy', async () => withTempAsync(async directory => {
  const fake = fakeRar({ size: 3, writeSize: 1000000 }); await assert.rejects(m.extractRarBounded(Buffer.alloc(1), directory, budget(), fake), { code: 'ARCHIVE_LIMIT' }); assert.equal(fake.state.copied, 0); assert.equal(fake.state.closed, true);
}));
test('RAR rejects final byte/CRC mismatch', async () => withTempAsync(async directory => {
  const fake = fakeRar({ corrupt: true }); await assert.rejects(m.extractRarBounded(Buffer.alloc(1), directory, budget(), fake), { code: 'ARCHIVE_INVALID' }); assert.deepEqual(fs.readdirSync(directory), []);
}));
test('owned cleanup cannot delete supplied source path or a replaced temp directory', () => {
  const owner = temp(), foreign = temp(), sentinel = path.join(foreign.directory, 'source.pdf'); fs.writeFileSync(sentinel, 'unchanged');
  const moved = owner.directory + '-moved';
  try {
    assert.throws(() => m.removeOwnedTemp({ ...owner, directory: foreign.directory }), { code: 'ARCHIVE_TEMP' }); assert.equal(fs.readFileSync(sentinel, 'utf8'), 'unchanged');
    fs.renameSync(owner.directory, moved); fs.mkdirSync(owner.directory); fs.writeFileSync(path.join(owner.directory, 'foreign.txt'), 'keep');
    assert.throws(() => m.removeOwnedTemp(owner), { code: 'ARCHIVE_TEMP' }); assert.equal(fs.readFileSync(path.join(owner.directory, 'foreign.txt'), 'utf8'), 'keep');
  } finally {
    // Only test-created exact paths under the verified temp parent are removed.
    for (const target of [owner.directory, moved]) { assert.equal(path.dirname(target), owner.parent); assert.ok(path.basename(target).startsWith(owner.prefix)); if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true }); }
    m.removeOwnedTemp(foreign);
  }
});
test('staged recognition retains ordinary/nested ZIP, stored RAR and PDF source values', { timeout: 30000 }, async () => {
  const recognitionLib = await recognition(), value = fs.readFileSync(path.join(root, 'tests/fixtures/ocr/synthetic-text.pdf'));
  const expected = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/ocr/expected.json'), 'utf8'));
  for (const archive of [zip([{ name: 'счет.pdf', value }]), zip([{ name: 'пакет.zip', value: zip([{ name: 'счет.pdf', value }]) }]), rarStored('invoice.pdf', value)]) {
    const rows = await recognitionLib.parseInvoices(archive, recognitionLib.DEFAULT_CONFIG); assert.equal(rows.length, 1); assert.equal(rows[0].sum, expected.text.sum); assert.equal(rows[0].date, expected.date); assert.equal(rows[0].supplierInn, expected.supplierInn); assert.equal(rows[0].recognition.confidence, null);
  }
  const rows = await recognitionLib.parsePdfFiles([{ name: 'zero-safe.pdf', buffer: value }], recognitionLib.DEFAULT_CONFIG); assert.equal(rows[0].sum, expected.text.sum);
});
