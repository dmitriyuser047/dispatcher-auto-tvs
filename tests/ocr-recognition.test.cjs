const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AdmZip = require('adm-zip');

let lib;
const fixtures = path.join(__dirname, 'fixtures', 'ocr');
const expected = JSON.parse(fs.readFileSync(path.join(fixtures, 'expected.json'), 'utf8'));
const file = name => ({ name, buffer: fs.readFileSync(path.join(fixtures, name)) });
before(async () => { lib = await import('../ReestrBuilder/lib.mjs'); });
after(async () => { await lib.disposeOcrWorker(); });

function assertFields(row, amount) {
  assert.equal(row.sum, amount);
  assert.equal(row.date, expected.date);
  assert.equal(row.supplier, expected.supplier);
  assert.equal(row.supplierInn, expected.supplierInn, 'must use supplier INN, not buyer INN');
  assert.ok(!row.description.includes('Итого'), 'total is not a supplied item');
  assert.equal(row.updLabel, '', 'an invoice must not fabricate a UPD');
  for (const field of ['supplier', 'supplierInn', 'number', 'date', 'total']) {
    assert.equal(row.recognition.fields[field].found, true);
    assert.ok(row.recognition.fields[field].sourceText, 'field needs source evidence: ' + field);
  }
}

test('text PDF retains document fields and evidence without invented OCR confidence', async () => {
  const rows = await lib.parsePdfFiles([file('synthetic-text.pdf')], lib.DEFAULT_CONFIG);
  assert.equal(rows.length, 1);
  assertFields(rows[0], expected.text.sum);
  assert.ok(rows[0].osn.includes(expected.text.number));
  assert.equal(rows[0].recognition.method, 'text');
  assert.equal(rows[0].recognition.confidence, null);
  assert.equal(rows[0].recognition.sourceFile, 'synthetic-text.pdf');
});

test('missing and impossible dates remain missing for review instead of becoming today', async () => {
  const rows = await lib.parsePdfFiles([file('synthetic-missing-date.pdf')], lib.DEFAULT_CONFIG);
  assert.equal(rows[0].date, '');
  assert.ok(rows[0].recognition.warnings.some(warning => warning.code === 'missing_date'));
  assert.ok(!JSON.stringify(rows[0]).includes('undefined'));
  const parsed = lib.parseInvoiceText('Счет на оплату № 7 от 31.02.2026\nПоставщик: ООО «ТЕСТ»\nВсего к оплате: 1 000,00');
  assert.equal(parsed.invoiceDate, '');
});

test('payable amount wins over subtotal when both share one PDF text run', () => {
  const parsed = lib.parseInvoiceText('Счет на оплату № 7 от 14.10.2026\nПоставщик: ООО «ТЕСТ»\nИтого: 100 000,00  Всего к оплате: 120 000,00');
  assert.equal(parsed.total, '120000,00');
});

test('ordinary and nested ZIPs both recognize PDF documents', async () => {
  const inner = new AdmZip(); inner.addFile('счет.pdf', file('synthetic-text.pdf').buffer);
  for (const nested of [false, true]) {
    const archive = new AdmZip();
    archive.addFile(nested ? 'пакет.zip' : 'счет.pdf', nested ? inner.toBuffer() : file('synthetic-text.pdf').buffer);
    const rows = await lib.parseInvoices(archive.toBuffer(), lib.DEFAULT_CONFIG);
    assert.equal(rows.length, 1);
    assertFields(rows[0], expected.text.sum);
  }
});

test('archive extraction rejects entries outside its isolated working folder', async () => {
  const zip = new AdmZip(); zip.addFile('safe/invoice.pdf', file('synthetic-text.pdf').buffer);
  const malicious = Buffer.from(zip.toBuffer());
  const from = Buffer.from('safe/invoice.pdf'), to = Buffer.from('../x/invoice.pdf');
  for (let offset = malicious.indexOf(from); offset >= 0; offset = malicious.indexOf(from, offset + to.length)) to.copy(malicious, offset);
  await assert.rejects(lib.parseInvoices(malicious, lib.DEFAULT_CONFIG), /Путь выходит|Недопустимый путь/);
});

test('real local OCR reads RGB and monochrome images and signals visual review', { timeout: 120000 }, async () => {
  for (const name of ['synthetic-invoice.png', 'synthetic-monochrome.png']) {
    const rows = await lib.parsePdfFiles([file(name)], lib.DEFAULT_CONFIG);
    assert.equal(rows.length, 1);
    assertFields(rows[0], expected.scan.sum);
    assert.equal(rows[0].recognition.method, 'ocr');
    assert.ok(rows[0].recognition.confidence >= 0 && rows[0].recognition.confidence <= 100);
    // Cyrillic Т and Latin T are visually identical; retain the engine output for review.
    assert.match(rows[0].osn, /315\/[ТT]-26/);
    assert.ok(rows[0].recognition.warnings.some(warning => warning.code === 'ocr_visual_check'));
  }
});

test('scan PDF chooses full page over its first logo and OCRs each mixed-document page', { timeout: 180000 }, async () => {
  const scanRows = await lib.parsePdfFiles([file('synthetic-scan-logo.pdf')], lib.DEFAULT_CONFIG);
  assert.equal(scanRows.length, 1);
  assertFields(scanRows[0], expected.scan.sum);
  const pages = [];
  const mixedRows = await lib.parsePdfFiles([file('synthetic-mixed.pdf')], lib.DEFAULT_CONFIG, () => {}, () => {}, page => pages.push(page));
  assert.equal(mixedRows.length, 2, 'a text page must not hide the next scanned invoice');
  assertFields(mixedRows[0], expected.text.sum);
  assertFields(mixedRows[1], expected.scan.sum);
  assert.deepEqual(pages.map(page => page.page), [2]);
  assert.deepEqual(mixedRows[1].recognition.sourcePages, [2]);
});
