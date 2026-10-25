const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const Timesheet = require('../assets/core/personnel-timesheet.js');
const vendor = { Buffer, Date, Uint8Array, ArrayBuffer, console };
vm.createContext(vendor);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../vendor/xlsx.bundle.js'), 'utf8'), vendor, { filename: 'xlsx-vendor' });
const XLSX = vendor.XLSX;
const row = (patch = {}) => ({ id: 'employee-a', name: 'Тестовый сотрудник', position: 'Водитель', personnelNumber: '001', department: 'ТЕСТ', site: 'Тестовый объект', days: {}, note: '', ...patch });
const model = (patch = {}) => Timesheet.create({ kind: 'driver', from: '2026-08-01', to: '2026-08-15', org: 'Тестовая организация', rows: [row()], ...patch });
const workbook = (value = model()) => Timesheet.toWorkbook(value, XLSX);
function xml(bytes, name) {
  const zip = XLSX.CFB.read(bytes, { type: 'array' });
  const index = zip.FullPaths.findIndex(value => value.endsWith('/' + name));
  assert.ok(index >= 0, name);
  return new TextDecoder().decode(new Uint8Array(zip.FileIndex[index].content));
}

test('monthly creation has separate role labels and validates actual one-month periods', () => {
  assert.equal(model().departmentLabel, 'Юр лицо');
  assert.equal(model({ kind: 'operator' }).departmentLabel, 'Юр лицо');
  assert.equal(model().signatureLabel, 'Куратор');
  assert.equal(model().noteLabel, 'Комментарии');
  for (const patch of [{ kind: 'other' }, { from: '2026-02-30' }, { to: '2026-09-01' }, { from: '2026-08-16' }]) assert.throws(() => model(patch), { code: 'PERSONNEL_TIMESHEET_INVALID' });
  assert.throws(() => model({ rows: [row(), row()] }), { code: 'PERSONNEL_TIMESHEET_INVALID' });
  assert.throws(() => model({ rows: [row({ name: ' ' })] }), { code: 'PERSONNEL_TIMESHEET_INVALID' });
});

test('summaries count only the selected period and preserve unknown codes, blanks, zero and fractional hours', () => {
  const value = model({ rows: [row({ days: { '2026-08-01': 11, '2026-08-02': '11', '2026-08-03': '7,5', '2026-08-04': 0, '2026-08-05': 'МВ', '2026-08-06': 'Д', '2026-08-07': 'ЯС', '2026-08-08': 'Я', '2026-08-09': 'НН', '2026-08-10': 'ПТД', '2026-08-16': 24, '2026-08-31': 'ОТ' } })] });
  const snapshot = structuredClone(value), summary = Timesheet.summarize(value);
  assert.deepEqual(summary.rows[0].counts, { МВ: 1, Д: 1, ЯС: 1, Я: 4 });
  assert.equal(summary.totals.hours, 29.5);
  assert.equal(summary.totals.workedDays, 5);
  assert.equal(summary.totals.totalDays, 6);
  assert.equal(summary.totals.blankDays, 5);
  assert.equal(summary.totals.markedDays, 10);
  assert.deepEqual(summary.otherCodes, { НН: 1, ПТД: 1 });
  assert.deepEqual(value, snapshot);
});

test('source totals remain intact and blanks conflicting with recorded days are exposed', () => {
  const value = model({ rows: [row({ days: { '2026-08-01': 'МВ', '2026-08-02': 11 }, sourceTotals: { МВ: null, Д: '', ЯС: null, Я: 2, totalDays: 2 } })] });
  const summary = Timesheet.summarize(value);
  assert.equal(summary.warnings.length, 3);
  assert.deepEqual(summary.rows[0].mismatches.map(value => value.code), ['МВ', 'Я', 'totalDays']);
  assert.equal(value.rows[0].sourceTotals.МВ, null);
  assert.equal(value.rows[0].sourceTotals.Я, 2);
});

test('marks require real dates in the month and hours from zero to 24', () => {
  for (const days of [{ '2026-08-32': 11 }, { '2026-09-01': 11 }, { '2026-08-01': -1 }, { '2026-08-01': '-1' }, { '2026-08-01': 25 }, { '2026-08-01': Infinity }, { '2026-08-01': {} }]) assert.throws(() => model({ rows: [row({ days })] }), { code: 'PERSONNEL_TIMESHEET_INVALID' });
  const leap = model({ from: '2028-02-01', to: '2028-02-29', rows: [row({ days: { '2028-02-29': 11 } })] });
  assert.equal(Timesheet.monthDays(leap).length, 31);
  assert.equal(Timesheet.monthDays(leap)[28].valid, true);
  assert.equal(Timesheet.monthDays(leap)[29].date, null);
});

test('sheet selection respects activeTab and authoritative period cells over stale sheet names', () => {
  const first = workbook(model({ from: '2026-07-01', to: '2026-07-15' }));
  const second = workbook(model());
  const data = { SheetNames: ['Справочник', 'май26', 'ЗПиюнь26'], Sheets: { Справочник: { A1: { v: 'Справочник' } }, 'май26': first.Sheets.Водители, 'ЗПиюнь26': second.Sheets.Водители }, Workbook: { WBView: [{ activeTab: 2 }] } };
  assert.deepEqual(Timesheet.listSheets(data).map(value => value.valid), [false, true, true]);
  const imported = Timesheet.fromWorkbook(data, { kind: 'driver', fileName: 'reference.xlsx' });
  assert.equal(imported.from, '2026-08-01');
  assert.equal(imported.to, '2026-08-15');
  assert.equal(imported.source.sheetName, 'ЗПиюнь26');
  assert.equal(Timesheet.fromWorkbook(data, { kind: 'driver', sheetName: 'май26' }).from, '2026-07-01');
  assert.throws(() => Timesheet.fromWorkbook(data, { kind: 'driver', sheetName: 'Справочник' }), { code: 'PERSONNEL_TIMESHEET_INVALID' });
});

test('February and 30-day templates accept stars on nonexistent dates without inventing marks', () => {
  const value = model({ from: '2026-02-01', to: '2026-02-15' });
  const data = workbook(value), sheet = data.Sheets.Водители;
  assert.equal(sheet.AH9.v, '*');
  assert.equal(sheet.AI9.v, '*');
  assert.equal(sheet.AJ9.v, '*');
  assert.equal(Timesheet.listSheets(data)[0].valid, true);
  assert.equal(Timesheet.fromWorkbook(data, { kind: 'driver' }).from, '2026-02-01');
  sheet.AH11.v = 11;
  assert.throws(() => Timesheet.fromWorkbook(data, { kind: 'driver' }), { code: 'PERSONNEL_TIMESHEET_INVALID' });
});

test('import preserves inactive-period values, textual identifiers, curator, notes and source counts', () => {
  const value = model({ curator: 'Тестовый куратор', footer: { label: 'Ответственное лицо (куратор)', position: 'Механик', name: 'Тестовый куратор', positionLabel: 'Должность', nameLabel: 'ФИО работника' }, rows: [row({ personnelNumber: '00001', days: { '2026-08-01': 11, '2026-08-31': 'ПТД' }, note: 'Тестовый комментарий' })] });
  const imported = Timesheet.fromWorkbook(workbook(value), { kind: 'driver' });
  assert.equal(imported.rows[0].personnelNumber, '00001');
  assert.equal(imported.rows[0].position, 'Водитель');
  assert.equal(imported.rows[0].days['2026-08-31'], 'ПТД');
  assert.equal(imported.rows[0].note, 'Тестовый комментарий');
  assert.equal(imported.curator, 'Тестовый куратор');
  assert.equal(imported.footer.position, 'Механик');
  assert.equal(imported.rows[0].sourceTotals.Я, 1);
});

test('serialized Excel preserves the template grid, live totals, print area, style and frozen panes', async () => {
  const value = model({ rows: [row({ days: { '2026-08-01': 11, '2026-08-15': 'Д', '2026-08-31': 'ПТД' } })] });
  const bytes = Timesheet.toXlsx(value, XLSX), sheet = xml(bytes, 'xl/worksheets/sheet1.xml'), book = xml(bytes, 'xl/workbook.xml'), styles = xml(bytes, 'xl/styles.xml');
  assert.ok(bytes instanceof Uint8Array);
  assert.match(sheet, /<pane xSplit="5" ySplit="10" topLeftCell="F11" activePane="bottomRight" state="frozen"\/>/);
  assert.match(sheet, /<pageSetup paperSize="8" orientation="landscape" fitToWidth="1" fitToHeight="0"\/>/);
  assert.match(sheet, /<pageSetUpPr fitToPage="1"\/>/);
  assert.match(sheet, /<mergeCell ref="C1:AI1"\/>/);
  assert.match(sheet, /<mergeCell ref="AK9:AN9"\/>/);
  assert.match(book, /_xlnm.Print_Area/);
  assert.match(book, /\$A\$1:\$AQ\$14/);
  assert.match(book, /_xlnm.Print_Titles/);
  assert.match(styles, /FBE5D6/);
  assert.match(styles, /0000CC/);
  const roundtrip = XLSX.read(bytes, { type: 'array', cellStyles: true });
  const ws = roundtrip.Sheets.Водители;
  assert.equal(ws.F11.v, 11);
  assert.equal(ws.AJ11.v, 'ПТД');
  assert.equal(ws.AN11.f, 'COUNTIFS(F11:T11,"Я")+COUNTIFS(F11:T11,">0")');
  assert.equal(ws.AO11.f, 'SUM(AL11:AN11)');
  assert.equal(ws.AO11.v, 2);
  const ExcelJS = require('exceljs'), native = new ExcelJS.Workbook();
  await native.xlsx.load(Buffer.from(bytes));
  assert.equal(native.worksheets[0].pageSetup.orientation, 'landscape');
  assert.equal(native.worksheets[0].pageSetup.paperSize, 8);
  assert.equal(native.worksheets[0].views[0].state, 'frozen');
  assert.equal(native.worksheets[0].views[0].xSplit, 5);
  assert.equal(native.worksheets[0].getCell('C9').fill.fgColor.argb, 'FFFBE5D6');
});

test('spreadsheet-like names and notes remain literal strings and cannot inject formulas', () => {
  const value = model({ rows: [row({ name: '=HYPERLINK("https://invalid.example","test")', note: '+SUM(1,1)', days: { '2026-08-01': '=SUM(1,1)' } })] });
  const bytes = Timesheet.toXlsx(value, XLSX), roundtrip = XLSX.read(bytes, { type: 'array' }).Sheets.Водители;
  for (const address of ['C11', 'AQ11', 'F11']) { assert.equal(roundtrip[address].t, 's'); assert.equal(roundtrip[address].f, undefined); }
  assert.equal(roundtrip.AQ11.v, '+SUM(1,1)');
  assert.equal(Timesheet.summarize(value).totals.hours, 0);
});

test('export types numeric-looking hour marks as numbers while keeping the source model intact', () => {
  const value = model({ rows: [row({ days: { '2026-08-01': '11' } })] });
  const bytes = Timesheet.toXlsx(value, XLSX), sheet = XLSX.read(bytes, { type: 'array' }).Sheets.Водители;
  assert.equal(sheet.F11.t, 'n');
  assert.equal(sheet.F11.v, 11);
  assert.equal(sheet.AN11.v, 1);
  assert.equal(value.rows[0].days['2026-08-01'], '11');
  const restored = Timesheet.fromWorkbook(XLSX.read(bytes, { type: 'array' }), { kind: 'driver' });
  assert.equal(Timesheet.summarize(restored).totals.hours, 11);
});

test('import and export retain original numbering gaps and identify source Excel rows', () => {
  const value = model({ rows: [row(), row({ id: 'employee-b', name: 'Второй тестовый сотрудник' })] }), source = workbook(value);
  source.Sheets.Водители.A11.v = 2;
  source.Sheets.Водители.A12.v = 7;
  source.Sheets.Водители.F12.v = 'МВ';
  const imported = Timesheet.fromWorkbook(source, { kind: 'driver' });
  assert.deepEqual(imported.rows.map(row => row.number), [2, 7]);
  assert.deepEqual(imported.rows.map(row => row.sourceRow), [11, 12]);
  assert.match(Timesheet.summarize(imported).warnings[0], /^Строка Excel 12:/);
  const bytes = Timesheet.toXlsx(imported, XLSX), exported = XLSX.read(bytes, { type: 'array' });
  assert.equal(exported.Sheets.Водители.A11.t, 'n');
  assert.equal(exported.Sheets.Водители.A11.v, 2);
  assert.equal(exported.Sheets.Водители.A12.v, 7);
  assert.deepEqual(Timesheet.fromWorkbook(exported, { kind: 'driver' }).rows.map(row => row.number), [2, 7]);
  for (const number of [0, -1, 1.5, '2', Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => model({ rows: [row({ number })] }), { code: 'PERSONNEL_TIMESHEET_INVALID' });
});

test('1904 date-system books use their own epoch', () => {
  const data = workbook();
  data.Workbook.WBProps = { date1904: true };
  for (const address of ['P7', 'T7']) data.Sheets.Водители[address].v -= 1462;
  assert.equal(Timesheet.fromWorkbook(data, { kind: 'driver' }).from, '2026-08-01');
});

test('Excel local-midnight Date cells retain civil dates in Moscow and western time zones', () => {
  const before = process.env.TZ;
  try {
    for (const timezone of ['Europe/Moscow', 'America/New_York', 'UTC']) {
      process.env.TZ = timezone;
      const data = workbook();
      data.Sheets.Водители.P7 = { t: 'd', v: new Date(2026, 7, 1) };
      data.Sheets.Водители.T7 = { t: 'd', v: new Date(2026, 7, 15) };
      const value = Timesheet.fromWorkbook(data, { kind: 'driver' });
      assert.equal(value.from, '2026-08-01', timezone);
      assert.equal(value.to, '2026-08-15', timezone);
    }
    const skewed = workbook();
    skewed.Sheets.Водители.P7 = { t: 'd', v: new Date('2026-07-31T20:59:43Z'), w: '01.08.2026' };
    skewed.Sheets.Водители.T7 = { t: 'd', v: new Date('2026-08-14T20:59:43Z'), w: '15.08.2026' };
    assert.equal(Timesheet.fromWorkbook(skewed, { kind: 'driver' }).from, '2026-08-01');
  } finally { if (before === undefined) delete process.env.TZ; else process.env.TZ = before; }
});

for (const [kind, variable, expected] of [
  ['operator', 'TVS_DES_TIMESHEET_SAMPLE', { employees: 8, hours: 715, workedDays: 65, totalDays: 71, counts: { МВ: 49, Д: 6, ЯС: 0, Я: 65 }, from: '2026-10-01', to: '2026-10-15', warnings: 5 }],
  ['driver', 'TVS_DRIVER_TIMESHEET_SAMPLE', { employees: 19, hours: 1320, workedDays: 120, totalDays: 120, counts: { МВ: 45, Д: 0, ЯС: 0, Я: 120 }, from: '2026-08-01', to: '2026-08-15', warnings: 1 }]
]) test('provided ' + kind + ' workbook reconciles independent sample controls', { skip: !process.env[variable] }, () => {
  const data = XLSX.read(fs.readFileSync(process.env[variable]), { type: 'buffer', cellDates: false });
  const value = Timesheet.fromWorkbook(data, { kind, fileName: path.basename(process.env[variable]) }), summary = Timesheet.summarize(value);
  for (const field of ['employees', 'hours', 'workedDays', 'totalDays', 'counts']) assert.deepEqual(summary.totals[field], expected[field]);
  assert.equal(value.from, expected.from); assert.equal(value.to, expected.to);
  const asDates = Timesheet.fromWorkbook(XLSX.read(fs.readFileSync(process.env[variable]), { type: 'buffer', cellDates: true }), { kind });
  assert.equal(asDates.from, expected.from); assert.equal(asDates.to, expected.to);
  assert.equal(summary.warnings.length, expected.warnings);
  const bytes = Timesheet.toXlsx(value, XLSX), restored = Timesheet.fromWorkbook(XLSX.read(bytes, { type: 'array' }), { kind });
  assert.deepEqual(restored.rows.map(value => value.days), value.rows.map(value => value.days));
  assert.equal(Timesheet.summarize(restored).warnings.length, 0);
  if (kind === 'driver') { assert.equal(Timesheet.activeSheet(data), 'ЗПиюнь26'); assert.equal(summary.blankDays, 15); assert.deepEqual(summary.otherCodes, { ПТД: 30, НН: 60, ОТ: 15 }); }
});
