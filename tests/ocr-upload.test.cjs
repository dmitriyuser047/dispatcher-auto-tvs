const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const plain = value => JSON.parse(JSON.stringify(value));

function element() {
  return {
    style: {}, textContent: '', disabled: false, children: [], _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(value) { this._html = value; this.children = []; },
    appendChild(child) { this.children.push(child); return child; },
    querySelector(selector) { assert.equal(selector, '.reestr-spinner'); return this.spinner ||= element(); },
  };
}

function fixture(options = {}) {
  const elements = new Map(), calls = [], opened = [], saved = [], listeners = {};
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const db = { vehicles: [{ id: 'synthetic-vehicle' }], reestrRows: [] };
  const row = (id, method = 'text') => ({ id, sum: 100, supplierInn: '7701234560', recognition: { method, sourceFile: id + '.pdf', fields: { total: { found: true, value: '100,00', sourceText: 'Всего к оплате: 100,00' } }, warnings: method === 'ocr' ? [{ code: 'ocr_visual_check', message: 'Сверьте оригинал' }] : [], rawText: 'Синтетический источник ' + id } });
  const api = {
    onProgress(callback) { listeners.progress = callback; },
    onOcrPage(callback) { listeners.ocr = callback; },
    offProgress() { calls.push(['offProgress']); delete listeners.progress; delete listeners.ocr; },
    async parseInvoices(buffer) {
      buffer = Buffer.from(buffer).toString('utf8');
      calls.push(['parseInvoices', buffer]);
      if (options.failArchive && buffer === 'archive-two') throw new Error('<img src=x onerror=alert(1)>');
      return { rows: [row(buffer)], log: [{ type: 'ok', text: 'Документ ' + buffer }] };
    },
    async parsePdfs(payload) {
      calls.push(['parsePdfs', payload]);
      listeners.progress({ current: 1, total: 2, fileName: '<img src=x onerror=alert(1)>.pdf' });
      assert.equal(get('reestrProgressFile').textContent, '<img src=x onerror=alert(1)>.pdf');
      assert.equal(get('reestrProgressFile').innerHTML, '');
      listeners.ocr({ page: 1, totalPages: 1 });
      return { rows: [row('pdf'), row('image', 'ocr')], log: [{ type: 'ok', text: 'PDF и изображение' }] };
    },
    async applyKnowledge(rows) { calls.push(['knowledge', rows]); return { rows: plain(rows), duplicates: [] }; },
    async loadStatyi() { return [{ label: 'Тестовая статья' }]; },
    async loadContracts() { return [{ name: 'Тестовый договор' }]; },
  };
  const context = vm.createContext({ console, structuredClone, syncSessionStamp:()=>'synthetic-ocr', window: { reestrAPI: api, electronAPI: { async openReestrWindow(value) { opened.push(value); } } }, document: { getElementById: get, createElement: element, addEventListener() {}, documentElement: { removeAttribute() {} } }, localStorage: { getItem() { return null; } }, setTimeout, clearTimeout, testDb: db });
  vm.runInContext(fs.readFileSync(path.join(root, 'assets/core/decimal-core.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(root, 'assets/core/fuel-engine.js'), 'utf8'), context, { filename: 'assets/core/fuel-engine.js' });
  for (const file of ['55-precision-input.js', '01-core.js', '19-reestr.js', '20-to-schedule.js']) vm.runInContext(fs.readFileSync(path.join(root, 'assets', 'js', file), 'utf8'), context, { filename: file });
  context.saveData = async value => { saved.push(plain(value)); return options.saveResult !== false; };
  context.reestrRenderTable = () => {};
  context.showToast = () => {};
  context.reviewedImportOpen = async () => ({ok:false,error:'Synthetic reviewed apply rejected'});
  vm.runInContext('data = testDb;', context);
  const files = [
    { name: 'Первый.zip', size: 1, async arrayBuffer() { return new TextEncoder().encode('archive-one').buffer; } },
    { name: 'Второй.zip', size: 2, async arrayBuffer() { return new TextEncoder().encode('archive-two').buffer; } },
    { name: 'Документ.pdf', size: 3, async arrayBuffer() { return new TextEncoder().encode('pdf-buffer').buffer; } },
    { name: '<img src=x onerror=alert(1)>.png', size: 4, async arrayBuffer() { return new TextEncoder().encode('image-buffer').buffer; } },
  ];
  return { context, get, calls, opened, saved, listeners, files };
}

function assertIdle(harness) {
  assert.equal(harness.get('reestrParseBtn').disabled, false);
  assert.equal(harness.get('reestrParseBtn').querySelector('.reestr-spinner').style.display, 'none');
  assert.equal(harness.get('reestrParseBtnLabel').textContent, 'Распознать счета');
  assert.equal(harness.get('reestrProgressWrap').style.display, 'none');
  assert.deepEqual(Object.keys(harness.listeners), [], 'both progress and OCR subscriptions must be released');
  assert.equal(harness.calls.filter(([name]) => name === 'offProgress').length, 1);
}

test('OCR upload accepts two ZIPs plus PDF/image and preserves every row and recognition evidence', async () => {
  const h = fixture();
  h.context.reestrAddFiles(h.files);
  assert.equal(vm.runInContext('reestrFiles.length', h.context), 4, 'the second selected ZIP must not be dropped');
  const chips = h.get('reestrFileChips').children;
  assert.equal(chips.length, 4);
  assert.ok(chips[3].innerHTML.includes('&lt;img'));
  assert.ok(!chips[3].innerHTML.includes('<img'));
  await h.context.reestrParse();
  const parseCalls = h.calls.filter(([name]) => name === 'parseInvoices' || name === 'parsePdfs');
  assert.deepEqual(parseCalls.map(([name]) => name), ['parseInvoices', 'parseInvoices', 'parsePdfs']);
  assert.deepEqual(parseCalls.slice(0, 2).map(([, buffer]) => buffer), ['archive-one', 'archive-two']);
  assert.deepEqual(plain(parseCalls[2][1]).map(file => file.name), ['Документ.pdf', '<img src=x onerror=alert(1)>.png']);
  assert.equal(h.saved.length, 0);
  assert.equal(h.opened.length, 0);
  const rows=plain(vm.runInContext('reestrRows',h.context));
  assert.deepEqual(rows.map(row=>row.id),['archive-one','archive-two','pdf','image']);
  assert.equal(rows[3].recognition.rawText,'Синтетический источник image');
  assert.equal(rows[3].recognition.fields.total.sourceText,'Всего к оплате: 100,00');
  assert.equal(rows[3].recognition.warnings[0].code,'ocr_visual_check');
  assert.equal(vm.runInContext('reestrImportDraft.source.files.length',h.context),4);
  assert.deepEqual(plain(vm.runInContext('data.reestrRows',h.context)),[]);
  assertIdle(h);
});

test('OCR upload failure displays plain error text and restores controls/subscriptions', async () => {
  const h = fixture({ failArchive: true });
  h.context.reestrAddFiles(h.files);
  await h.context.reestrParse();
  assert.equal(h.saved.length, 0);
  assert.equal(h.opened.length, 0);
  assert.equal(h.get('reestrError').textContent, '⚠ <img src=x onerror=alert(1)>');
  assert.equal(h.get('reestrError').innerHTML, '');
  assertIdle(h);
});

test('OCR upload retains its draft after rejected reviewed import without opening a success window', async () => {
  const h = fixture({ saveResult: false });
  h.context.reestrAddFiles(h.files);
  await h.context.reestrParse();
  await h.context.reestrReviewImport();
  assert.equal(h.saved.length, 0);
  assert.equal(h.opened.length, 0);
  assert.equal(h.context.reestrImportHasPendingEdits(),true);
  assert.deepEqual(plain(vm.runInContext('data.reestrRows',h.context)),[]);
  assertIdle(h);
});

test('OCR log escapes document-supplied markup', () => {
  const h = fixture();
  h.context.reestrRenderLog([{ type: 'warn', text: '<img src=x onerror=alert(1)> & "документ"' }]);
  const log = h.get('reestrLog').children[0].innerHTML;
  assert.ok(log.includes('&lt;img'));
  assert.ok(log.includes('&amp;'));
  assert.ok(log.includes('&quot;'));
  assert.ok(!log.includes('<img'));
});
