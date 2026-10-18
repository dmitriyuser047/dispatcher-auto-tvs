import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { parsePdfFiles, parseInvoices, DEFAULT_CONFIG, disposeOcrWorker } from '../ReestrBuilder/lib.mjs';
import AdmZip from 'adm-zip';

const directory = path.resolve('tests/fixtures/ocr');
const checks = [];
try {
  for (const name of ['synthetic-text.pdf', 'synthetic-missing-date.pdf', 'synthetic-invoice.png', 'synthetic-monochrome.png', 'synthetic-scan-logo.pdf', 'synthetic-mixed.pdf']) {
    console.log('Recognizing ' + name);
    const logs = [], pages = [], started = performance.now();
    const rows = await parsePdfFiles([{ name, buffer: fs.readFileSync(path.join(directory, name)) }], DEFAULT_CONFIG, entry => logs.push(entry), () => {}, entry => pages.push(entry));
    const result = { input: name, seconds: +( (performance.now() - started) / 1000).toFixed(2), rows, logs, ocrPages: pages };
    checks.push(result);
    console.log(JSON.stringify({ input: name, seconds: result.seconds, rows: rows.map(row => ({ sum: row.sum, date: row.date, osn: row.osn, supplier: row.supplier, supplierInn: row.supplierInn, method: row.recognition?.method, confidence: row.recognition?.confidence })), logs }));
  }
  for (const nested of [false, true]) {
    const inner = new AdmZip();
    inner.addFile('счет.pdf', fs.readFileSync(path.join(directory, 'synthetic-text.pdf')));
    const zip = new AdmZip();
    if (nested) zip.addFile('пакет.zip', inner.toBuffer());
    else zip.addFile('счет.pdf', fs.readFileSync(path.join(directory, 'synthetic-text.pdf')));
    const started = performance.now(), logs = [];
    const rows = await parseInvoices(zip.toBuffer(), DEFAULT_CONFIG, entry => logs.push(entry));
    checks.push({ input: nested ? 'nested-zip' : 'flat-zip', seconds: +((performance.now() - started) / 1000).toFixed(2), rows, logs });
  }
  const expected = JSON.parse(fs.readFileSync(path.join(directory, 'expected.json'), 'utf8'));
  for (const check of checks) {
    check.expectations = check.rows.map((row, index) => {
      const scanned = /(?:invoice\.png|monochrome|scan-logo)/.test(check.input) || check.input === 'synthetic-mixed.pdf' && index === 1;
      const doc = scanned ? expected.scan : expected.text;
      const values = { supplier: expected.supplier, supplierInn: expected.supplierInn, date: check.input.includes('missing-date') ? '' : expected.date, sum: doc.sum, number: doc.number };
      const actual = { supplier: row.supplier, supplierInn: row.supplierInn, date: row.date, sum: row.sum, number: row.recognition?.fields.number.value };
      return { expected: values, actual, matches: Object.fromEntries(Object.keys(values).map(key => [key, values[key] === actual[key]])), note: actual.number !== values.number ? 'OCR returned Latin T instead of Cyrillic Т; retained for visual review.' : '' };
    });
  }
  const report = { date: '2026-10-16', synthetic: true, workingDatabaseTouched: false, localModelsOnly: true, engine: 'Tesseract.js 7 rus+eng bundled models', expected, baselineObservations: [
    { scenario: 'Russian workspace path', actualBefore: 'URL.pathname contains percent-encoded Cyrillic; local models not found, allowing unexpected CDN fallback', corrected: 'fileURLToPath and mandatory bundled local rus+eng models' },
    { scenario: 'synthetic-text.pdf', actualBefore: 'supplier INN missing; description included Итого:', corrected: 'supplier INN and source evidence retained; totals excluded from description' },
    { scenario: 'synthetic-missing-date.pdf', actualBefore: 'date replaced by current date; UPD label contained undefined despite absent UPD', corrected: 'empty date with missing_date warning; absent UPD remains empty' },
    { scenario: 'Mixed text/scan PDF', actualBefore: 'any text anywhere suppressed OCR of every page', corrected: 'text quality checked and OCR selected separately for each page' },
    { scenario: 'PDF with first image logo', actualBefore: 'first image selected and small/dark images silently discarded', corrected: 'largest raster selected, grayscale/packed input handled, unavailable raster reported' },
    { scenario: 'Ordinary ZIP', actualBefore: 'only nested archives processed', corrected: 'ordinary and nested packages use same multi-document parser' },
  ], checks, limitations: ['Manufactured, clean, unskewed documents; not an estimate of accuracy on user scans.', 'PDF OCR extracts the largest raster on a page. Split-image scans, arbitrary vector paths, perspective distortion and signed originals require separate acceptance.', 'Confidence is Tesseract page-level output; it is not field-level correctness probability.', 'Cyrillic Т and Latin T are confused in the manufactured scan number. A warning requires visual comparison; the application does not silently rewrite it.', 'RAR extraction inspected but not executed because no local RAR encoder/fixture is available.'] };
  fs.writeFileSync(path.resolve('audit/ocr-review-2026-10-16.json'), JSON.stringify(report, null, 2));
} finally { await disposeOcrWorker(); }
