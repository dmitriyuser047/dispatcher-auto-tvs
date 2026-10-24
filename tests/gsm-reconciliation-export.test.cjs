const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '..');
// Synthetic fixtures only. No application profile or working database is opened.
function createContext(extraFiles = []) {
  const context = vm.createContext({ console, window: {}, document: { addEventListener() {}, documentElement: { removeAttribute() {} }, getElementById() {} }, localStorage: { getItem() {} } });
  for (const file of ['assets/core/decimal-core.js','assets/core/fuel-engine.js', 'assets/core/fuel-audit.js','assets/js/55-precision-input.js', 'assets/js/01-core.js', 'assets/js/29-fuel-quality.js', 'vendor/xlsx.bundle.js', 'assets/js/10-pdf-reports.js', 'assets/js/25-fuel-report.js',
    'assets/js/25b-fuel-purchases.js', 'assets/js/25c-fuel-control.js', 'assets/js/25i-gsm-ledger.js', 'assets/js/25j-gsm-workspace.js', 'assets/js/25k-gsm-export.js', ...extraFiles]) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  return context;
}
const ctx = createContext();
function database() {
  return { vehicles: [{ id: 'synthetic-v', plate: 'SYNTHETIC', make: 'Synthetic car', org: 'A', fuel: 'gasoline', fuelGrade: 'АИ-100', fuelBalance: 0, norm: 10 }],
    fuelCards: [{ number: '111111', org: 'A', provider: 'Synthetic supplier', assignments: [{ vehicleId: 'synthetic-v', from: '', to: '' }] }],
    records: [], fuelPurchases: [], monthlyFuel: [] };
}
function setDatabase(db) { ctx.inputData = db; vm.runInContext('data=inputData;gsmOrg="";gsmFuel=""', ctx); }
function ledger(db) { return ctx.gsmBuildLedger(db, { from: '2026-10-01', to: '2026-10-31' }); }
function sheetRows(wb, sheet) { return ctx.XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: '' }); }
function actRows(wb) { return sheetRows(wb, 'Акт списания ГСМ').filter(row => typeof row[0] === 'number'); }
function close(actual, expected) { assert.ok(Math.abs(actual - expected) < 0.002, `${actual} != ${expected}`); }
function pairedDatabase() {
  const db = database();
  db.records = [
    { id: 'synthetic-debt', vehicleId: 'synthetic-v', date: '2026-10-01', fuelGrade: 'АИ-100', km: 300, fuelActual: 30 },
    { id: 'synthetic-supply', vehicleId: 'synthetic-v', date: '2026-10-02', fuelGrade: 'АИ-95', km: 0, fuelActual: 0, fuelIssued: 50 },
  ];
  db.fuelPurchases = [{ id: 'synthetic-purchase', vehicleId: 'synthetic-v', recordId: 'synthetic-supply', date: '2026-10-02', grade: 'АИ-95', cardNo: '111111', qty: 50 }];
  return db;
}
function provenanceDatabase() {
  const db = database(); Object.assign(db.vehicles[0], { fuelGrade: 'АИ-95', fuelBalance: 100 });
  db.records = [
    { id: 'synthetic-norm', vehicleId: 'synthetic-v', date: '2026-10-01', fuelGrade: 'АИ-95', km: 100, fuelIdle: 2 },
    { id: 'synthetic-actual', vehicleId: 'synthetic-v', date: '2026-10-02', fuelGrade: 'АИ-95', km: 100, fuelActual: 5, fuelIdle: 1 },
    { id: 'synthetic-measurement', vehicleId: 'synthetic-v', date: '2026-10-03', fuelGrade: 'АИ-95', km: 0, fuelActual: 0, tankMeasured: 70 },
  ];
  return db;
}

test('grade reconciliation UI exposes neutral signed corrections and pair basis without changing receipts', () => {
  const db = pairedDatabase(); setDatabase(db); const before = JSON.stringify(db), result = ledger(db);
  const html = ctx.gsmBarrelsHtml(result);
  assert.match(html, /Корректировка\/сверка/); assert.doesNotMatch(html, /Неразобранный приход/);
  assert.match(html, /Сверка марок/); assert.match(html, /\+30,000/); assert.match(html, /-30,000/);
  assert.match(html, /АИ-95 → АИ-100/); assert.match(html, /synthetic-purchase/); assert.match(html, /synthetic-debt/);
  assert.match(html, /не меняют марку покупки, приход или расход/);
  vm.runInContext('gsmFuel="АИ-95"', ctx);
  const filtered = ctx.gsmGradeReconciliationHtml(result);
  assert.equal((filtered.match(/synthetic-purchase/g) || []).length, 1);
  assert.match(filtered, /-30,000/); assert.doesNotMatch(filtered, /\+30,000/); assert.match(filtered, /АИ-95 → АИ-100/);
  assert.equal(result.receipts[0].grade, 'АИ-95'); close(result.receipts[0].qty, 50);
  assert.equal(JSON.stringify(db), before);
});

test('reconciliation workbook contains two opposite numeric sides with the original source grade unchanged', () => {
  const db = pairedDatabase(); setDatabase(db); const before = JSON.stringify(db), result = ledger(db), wb = ctx.XLSX.utils.book_new();
  ctx.gsmAppendReconciliation(wb, result, 'A', '');
  const pairs = sheetRows(wb, 'Сверка марок').slice(1);
  assert.equal(pairs.length, 2); assert.equal(new Set(pairs.map(row => row[9])).size, 1);
  close(pairs.reduce((sum, row) => sum + row[6], 0), 0);
  assert.deepEqual(new Set(pairs.map(row => row[6])), new Set([30, -30]));
  assert.ok(pairs.every(row => row[0] === '2026-10-02' && row[1] === 'A' && row[2].includes('SYNTHETIC') && row[3] === 'АИ-95' && row[4] === 'АИ-100'));
  assert.ok(pairs.every(row => row[10] === 'synthetic-purchase' && row[11] === 'synthetic-supply' && row[12] === 'synthetic-debt'));
  assert.match(wb.Sheets['Сверка марок'].G2.z, /^\+/);
  const receipts = sheetRows(wb, 'Поступления').slice(1);
  assert.equal(receipts.length, 1); assert.equal(receipts[0][5], 'АИ-95'); close(receipts[0][7], 50);
  close(sheetRows(wb, 'Расход по партиям').slice(1).reduce((sum, row) => sum + row[4], 0), 30);
  assert.equal(JSON.stringify(db), before);
});

test('grade-filtered workbooks keep one signed side but preserve the counterpart grade and identifiers', () => {
  const db = pairedDatabase(); setDatabase(db); const result = ledger(db);
  for (const [grade, delta, issued] of [['АИ-95', -30, 50], ['АИ-100', 30, 0]]) {
    const wb = ctx.gsmActWorkbook(result, 'A', { fuelGrade: grade });
    const pairs = sheetRows(wb, 'Сверка марок').slice(1); assert.equal(pairs.length, 1);
    assert.equal(pairs[0][5], grade); close(pairs[0][6], delta); assert.equal(pairs[0][3], 'АИ-95'); assert.equal(pairs[0][4], 'АИ-100');
    assert.match(pairs[0][8], /synthetic-purchase.*synthetic-debt/);
    const rows = actRows(wb); assert.equal(rows.length, 1); assert.equal(rows[0][4], grade); close(rows[0][19], issued);
    const note = sheetRows(wb, 'Акт списания ГСМ').flat().find(value => typeof value === 'string' && value.startsWith('Корректировка/сверка марок:'));
    assert.match(note, /не приход и не расход/); assert.ok(note.includes((delta > 0 ? '+' : '') + delta));
  }
  const otherOrg = ctx.XLSX.utils.book_new(); ctx.gsmAppendReconciliation(otherOrg, result, 'B', '');
  assert.equal(otherOrg.SheetNames.includes('Сверка марок'), false);
});

test('act retains its 26-column accounting values and explains why grade totals differ from receipt minus expense', () => {
  const db = pairedDatabase(); setDatabase(db); const result = ledger(db), wb = ctx.gsmActWorkbook(result, 'A', {});
  const ws = wb.Sheets['Акт списания ГСМ']; assert.equal(ctx.XLSX.utils.decode_range(ws['!ref']).e.c, 25); assert.equal(ws['!cols'].length, 26);
  const rows = actRows(wb), incoming = rows.find(row => row[4] === 'АИ-95'), debt = rows.find(row => row[4] === 'АИ-100');
  close(incoming[19], 50); close(incoming[21], 0); close(incoming[23], 20);
  close(debt[19], 0); close(debt[21], 30); close(debt[23], 0);
  const labels = sheetRows(wb, 'Акт списания ГСМ').flat();
  assert.ok(labels.includes('к списанию')); assert.ok(labels.includes('в т.ч. х/х')); assert.equal(labels.includes('по факту'), false);
  assert.ok(labels.some(value => typeof value === 'string' && value.includes('АИ-95: -30 л') && value.includes('АИ-100: +30 л')));
});

test('norm and tank measurement consumption retain their true basis and do not double idle litres', () => {
  const db = provenanceDatabase(); setDatabase(db); const before = JSON.stringify(db), result = ledger(db), wb = ctx.gsmActWorkbook(result, 'A', {});
  const basis = sheetRows(wb, 'Основание расхода').slice(1);
  assert.deepEqual(new Set(basis.map(row => row[7])), new Set(['actual', 'norm', 'measurement']));
  const norm = basis.find(row => row[8] === 'synthetic-norm'), actual = basis.find(row => row[8] === 'synthetic-actual'), measurement = basis.find(row => row[8] === 'synthetic-measurement');
  close(norm[4], 12); close(norm[5], 2); assert.equal(norm[6], 'Расчёт по норме');
  close(actual[4], 6); close(actual[5], 1); assert.equal(actual[6], 'Введённый факт');
  close(measurement[4], 12); assert.equal(measurement[6], 'Расчёт по замеру остатка');
  const act = actRows(wb)[0]; close(act[21], 30); close(act[22], 3); close(act[23], 70);
  close(basis.reduce((sum, row) => sum + row[4], 0), act[21]);
  const labels = sheetRows(wb, 'Акт списания ГСМ').flat();
  assert.ok(labels.some(value => typeof value === 'string' && value.includes('холостой ход') && value.includes('повторно не прибавляется')));
  assert.ok(labels.some(value => typeof value === 'string' && value.includes('Основание расхода')));
  const html = ctx.gsmJournalHtml(result); assert.match(html, /Расчёт по норме/); assert.match(html, /Расчёт по замеру остатка/); assert.match(html, /Введённый факт/);
  assert.equal(JSON.stringify(db), before);
});

test('provenance sheets respect organization and grade filters and persist through XLSX readback', () => {
  const db = provenanceDatabase(); setDatabase(db); const result = ledger(db), wb = ctx.XLSX.utils.book_new();
  ctx.gsmAppendReconciliation(wb, result, 'A', 'АИ-95');
  assert.ok(wb.SheetNames.includes('Основание расхода'));
  assert.ok(sheetRows(wb, 'Основание расхода').slice(1).every(row => row[1] === 'A' && row[3] === 'АИ-95'));
  const excluded = ctx.XLSX.utils.book_new(); ctx.gsmAppendReconciliation(excluded, result, 'A', 'ДТ');
  assert.equal(excluded.SheetNames.includes('Основание расхода'), false);
  const act = ctx.gsmActWorkbook(result, 'A', {}), bytes = ctx.XLSX.write(act, { type: 'buffer', bookType: 'xlsx' });
  const restored = ctx.XLSX.read(bytes, { type: 'buffer', cellStyles: true });
  assert.deepEqual(Array.from(restored.SheetNames), ['Акт списания ГСМ', 'Основание расхода']);
  close(actRows(restored)[0][21], 30); assert.equal(sheetRows(restored, 'Основание расхода').slice(1).length, 3);
});

test('ordinary actual-only exports retain one original act sheet with the same fuel numbers', () => {
  const db = database(); db.vehicles[0].fuelBalance = 50;
  db.records = [{ id: 'synthetic-actual-only', vehicleId: 'synthetic-v', date: '2026-10-01', fuelGrade: 'АИ-100', km: 100, fuelActual: 10, fuelIdle: 2 }];
  setDatabase(db); const result = ledger(db), wb = ctx.gsmActWorkbook(result, 'A', {});
  assert.deepEqual(Array.from(wb.SheetNames), ['Акт списания ГСМ']);
  const row = actRows(wb)[0]; close(row[13], 50); close(row[19], 0); close(row[21], 12); close(row[22], 2); close(row[23], 38);
});

test('act preserves ledger precision and its total equals written detail without changing source mileage or fuel', () => {
  const db = database(); db.vehicles[0].fuelBalance = 0.004;
  db.vehicles.push({ ...db.vehicles[0], id:'synthetic-second', plate:'SECOND', fuelBalance:0.006 });
  db.records = [{id:'precision-record',vehicleId:'synthetic-v',date:'2026-10-01',fuelGrade:'АИ-100',km:1.234,fuelIssued:0.004,fuelActual:0.001}];
  db.fuelPurchases = [{id:'precision-purchase',recordId:'precision-record',vehicleId:'synthetic-v',date:'2026-10-01',grade:'АИ-100',qty:0.004,cardNo:'111111'}];
  setDatabase(db); const before=JSON.stringify(db), result=ledger(db), wb=ctx.gsmActWorkbook(result,'A',{});
  const restored=ctx.XLSX.read(ctx.XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),{type:'buffer',cellStyles:true});
  const rows=actRows(restored), first=rows.find(row=>row[2]==='SYNTHETIC');
  assert.equal(first[11],1.234); assert.equal(first[13],0.004); assert.equal(first[19],0.004);
  assert.equal(first[21],0.001); assert.equal(first[23],0.007);
  for(const row of rows)assert.ok(Math.abs(row[13]+row[19]-row[21]-row[23])<1e-9);
  const total=sheetRows(restored,'Акт списания ГСМ').find(row=>row[0]==='ИТОГО:');
  for(const col of [11,13,19,21,22,23])assert.ok(Math.abs(total[col]-rows.reduce((sum,row)=>sum+(+row[col]||0),0))<1e-9);
  assert.equal(total[23],0.013);assert.equal(JSON.stringify(db),before);
});

test('supplier columns reconcile to their three-decimal receipt total',()=>{
  const db=database();db.records=[{id:'multi-provider',vehicleId:'synthetic-v',date:'2026-10-01',fuelGrade:'АИ-100',fuelIssued:0.012,fuelActual:0,km:0}];
  db.fuelPurchases=['Газпром','Волга-Интер','Synthetic other'].map((sourceProvider,index)=>({id:'provider-'+index,recordId:'multi-provider',vehicleId:'synthetic-v',date:'2026-10-01',grade:'АИ-100',qty:0.004,cardNo:'111111',sourceProvider}));
  setDatabase(db);const before=JSON.stringify(db),wb=ctx.gsmActWorkbook(ledger(db),'A',{}),row=actRows(wb)[0];
  assert.equal(row[14],0.004);assert.equal(row[15],0.004);assert.equal(row[18],0.004);assert.equal(row[19],0.012);
  assert.ok(Math.abs(row.slice(14,19).reduce((sum,value)=>sum+(+value||0),0)-row[19])<1e-9);
  assert.equal(JSON.stringify(db),before);
});

test('sub-millilitre supplier display rounding stays traceable and never changes a purchase',()=>{
  const db=database();db.records=[{id:'tiny-provider',vehicleId:'synthetic-v',date:'2026-10-01',fuelGrade:'АИ-100',fuelIssued:0.0018,fuelActual:0,km:0}];
  db.fuelPurchases=['Газпром','Волга-Интер','Synthetic other'].map((sourceProvider,index)=>({id:'tiny-'+index,recordId:'tiny-provider',vehicleId:'synthetic-v',date:'2026-10-01',grade:'АИ-100',qty:0.0006,cardNo:'111111',sourceProvider}));
  setDatabase(db);const before=JSON.stringify(db),wb=ctx.gsmActWorkbook(ledger(db),'A',{}),row=actRows(wb)[0];
  assert.equal(row[19],0.002);assert.equal(row.slice(14,19).reduce((sum,value)=>sum+(+value||0),0),0.002);
  const rounding=sheetRows(wb,'Округление поставщиков').slice(1);assert.equal(rounding.length,3);
  assert.ok(rounding.every(item=>item[6]===0.0006));
  assert.ok(Math.abs(rounding.reduce((sum,item)=>sum+item[7],0)-0.002)<1e-9);
  assert.ok(sheetRows(wb,'Акт списания ГСМ').flat().some(value=>typeof value==='string'&&value.includes('покупки не изменены')));
  assert.equal(JSON.stringify(db),before);
});

test('grade corrections have an explicit per-act-row balance instead of only an organization aggregate',()=>{
  const db=pairedDatabase();setDatabase(db);const before=JSON.stringify(db),wb=ctx.gsmActWorkbook(ledger(db),'A',{});
  const balance=sheetRows(wb,'Баланс строк акта').slice(1);assert.equal(balance.length,2);
  for(const row of balance){assert.ok(Math.abs(row[5]+row[6]+row[7]-row[8]-row[9])<1e-9);assert.equal(row[10],0);}
  assert.deepEqual(new Set(balance.map(row=>row[7])),new Set([30,-30]));
  assert.ok(sheetRows(wb,'Акт списания ГСМ').flat().some(value=>typeof value==='string'&&value.includes('Баланс строк акта')&&value.includes('В строках №')));
  assert.equal(JSON.stringify(db),before);
});

test('a physical measurement gain stays an unexplained correction in a marked draft with source identifiers',()=>{
  const db=database();db.records=[{id:'surplus-measurement',vehicleId:'synthetic-v',date:'2026-10-01',fuelGrade:'АИ-100',fuelActual:0,tankMeasured:5,km:0}];
  setDatabase(db);const before=JSON.stringify(db),wb=ctx.gsmActWorkbook(ledger(db),'A',{}),row=actRows(wb)[0];
  assert.match(wb.Sheets['Акт списания ГСМ'].A1.v,/ЧЕРНОВИК.*Не утверждён/);
  assert.equal(row[19],0);assert.equal(row[21],0);assert.equal(row[23],5);
  const correction=sheetRows(wb,'Корректировки по замерам').slice(1);assert.equal(correction.length,1);assert.equal(correction[0][4],5);
  assert.equal(correction[0][6],'surplus-measurement');assert.equal(correction[0][7],'surplus-measurement');
  const balance=sheetRows(wb,'Баланс строк акта')[1];assert.equal(balance[7],5);assert.equal(balance[10],0);
  assert.ok(sheetRows(wb,'Акт списания ГСМ').flat().some(value=>typeof value==='string'&&value.includes('не является подтверждённым приходом')));
  assert.equal(JSON.stringify(db),before);
});

test('an entered actual without a norm does not become a fictitious overspend against zero',()=>{
  const db=database();delete db.vehicles[0].norm;db.vehicles[0].fuelBalance=100;
  db.records=[{id:'actual-without-norm',vehicleId:'synthetic-v',date:'2026-10-01',fuelGrade:'АИ-100',fuelActual:10,km:100}];
  setDatabase(db);const wb=ctx.gsmActWorkbook(ledger(db),'A',{}),row=actRows(wb)[0];
  assert.equal(row[20],'—');assert.equal(row[24],'—');assert.equal(row[21],10);
  const total=sheetRows(wb,'Акт списания ГСМ').find(row=>row[0]==='ИТОГО:');assert.equal(total[20],'—');assert.equal(total[24],'—');
  assert.ok(sheetRows(wb,'Акт списания ГСМ').flat().some(value=>typeof value==='string'&&value.includes('не является нулевой нормой')));
});

test('known odometer readings retain their dates when the period boundary records have missing readings',()=>{
  const db=database();db.vehicles[0].fuelBalance=100;db.vehicles[0].odometer=99999;
  db.records=[{id:'odo-first',vehicleId:'synthetic-v',date:'2026-10-01',fuelActual:1,km:10},
   {id:'odo-known',vehicleId:'synthetic-v',date:'2026-10-02',fuelActual:1,km:10,odoStart:110,odoEnd:120},
   {id:'odo-last',vehicleId:'synthetic-v',date:'2026-10-03',fuelActual:1,km:10}];
  setDatabase(db);const before=JSON.stringify(db),wb=ctx.gsmActWorkbook(ledger(db),'A',{}),row=actRows(wb)[0];
  assert.equal(row[6],110);assert.equal(row[7],120);assert.equal(row[11],30);
  const note=sheetRows(wb,'Акт списания ГСМ').flat().find(value=>typeof value==='string'&&value.includes('Даты при пропусках'));
  assert.match(note,/начало 02\.10\.2026, конец 02\.10\.2026/);assert.equal(JSON.stringify(db),before);
});

test('standing vehicles follow their own organization and canonical grade rather than a foreign card or stale fuel flag',()=>{
  const db=database();db.vehicles[0].fuelcard='222222';db.fuelCards.push({number:'222222',org:'B',provider:'Synthetic foreign supplier'});
  db.vehicles.push({...db.vehicles[0],id:'canonical-gas',plate:'GAS',fuel:'diesel',fuelGrade:'Газ'});
  db.vehicles.push({...db.vehicles[0],id:'canonical-diesel',plate:'DIESEL',fuel:'gas',fuelGrade:'ДТ'});
  setDatabase(db);const before=JSON.stringify(db),result=ledger(db),rows=ctx.gsmActRows(result,'A','');
  assert.deepEqual(new Set(rows.map(row=>row.vehicleId)),new Set(['synthetic-v','canonical-diesel']));
  assert.equal(ctx.gsmActRows(result,'B','').length,0);assert.equal(JSON.stringify(db),before);
});

test('v6 ledger numeric errors and audit-only sources require one marked draft issue per independent source', () => {
  const context = createContext(['assets/js/25m-gsm-diagnostics.js']), db = database();
  db.fuelPurchases = ['bad', -2, ''].map((qty, index) => ({ id: 'invalid-source-' + index, vehicleId: 'synthetic-v',
    date: '2026-10-01', cardNo: '111111', grade: 'АИ-100', qty }));
  db.records = [{ id: 'orphan-source', vehicleId: 'missing', date: '2026-10-01', fuelGrade: 'АИ-100', fuelOrg: 'A', km: 1 }];
  const before = JSON.stringify(db); context.inputData = db;
  vm.runInContext('data=inputData', context);
  const result = context.gsmBuildLedger(db, { from: '2026-10-01', to: '2026-10-31' });
  assert.equal(result.errors.length, 2, 'v6 reports malformed and negative numeric sources before excluding them');
  assert.deepEqual(new Set(result.errors.map(issue=>issue.purchaseId)),new Set(['invalid-source-0','invalid-source-1']));
  assert.ok(result.errors.every(issue=>issue.code==='source-number'&&issue.field==='qty'));
  const errors = context.gsmRelevantIssues(result, 'A', 'АИ-100').filter(issue => issue.severity === 'error');
  assert.equal(errors.length, 4);
  assert.equal(context.gsmRelevantIssues(result, 'B', 'АИ-100').length, 0);
  assert.equal(context.gsmRelevantIssues(result, 'A', 'ДТ').length, 0);
  const wb = context.gsmActWorkbook(result, 'A', {});
  assert.match(wb.Sheets['Акт списания ГСМ'].A1.v, /ЧЕРНОВИК.*Не утверждён/);
  const issues = context.XLSX.utils.sheet_to_json(wb.Sheets['Расхождения'], { header: 1, defval: '' }).slice(1);
  assert.equal(issues.length, 4);
  assert.ok(issues.some(row => row[8].includes('record: orphan-source')));
  for (let i = 0; i < 3; i++) assert.ok(issues.some(row => row[8].includes('purchase: invalid-source-' + i)));
  let reviews = 0, writes = 0;
  context.openGenericModal = () => { reviews++; }; context.XLSX.writeFile = () => { writes++; };
  assert.equal(context.exportFuelWriteOffAct('2026-10-01', '2026-10-31', { org: 'A' }), null);
  assert.equal(reviews, 1); assert.equal(writes, 0);
  assert.equal(JSON.stringify(db), before);
});

test('diagnostic warnings and evidence do not turn a source-valid act into a draft or duplicate ledger errors', () => {
  const context = createContext(['assets/js/25m-gsm-diagnostics.js']), db = database();
  db.vehicles[0].fuelBalance = 100;
  db.records = [{ id: 'actual-source', vehicleId: 'synthetic-v', date: '2026-10-01', fuelGrade: 'АИ-95', fuelIssued: 20, fuelActual: 1, km: 10 }];
  db.fuelPurchases = [0, 1].map(index => ({ id: 'separate-real-purchase-' + index, recordId: 'actual-source', vehicleId: 'synthetic-v',
    date: '2026-10-01', grade: 'АИ-95', qty: 10, cardNo: '111111' }));
  context.inputData = db; vm.runInContext('data=inputData', context);
  let result = context.gsmBuildLedger(db, { from: '2026-10-01', to: '2026-10-31' });
  const audit = context.gsmAuditModel(db, { ...result, ledger: result, coverage: false });
  assert.ok(audit.items.some(item => item.category === 'evidence'));
  assert.ok(audit.items.some(item => item.category === 'warning'));
  assert.equal(context.gsmRelevantIssues(result, 'A', '').filter(issue => issue.severity === 'error').length, 0);
  let wb = context.gsmActWorkbook(result, 'A', {});
  assert.ok(!Object.values(wb.Sheets['Акт списания ГСМ']).some(cell => typeof cell?.v === 'string' && cell.v.includes('ЧЕРНОВИК')));
  assert.equal(wb.SheetNames.includes('Расхождения'), false);
  db.records[0].date = 'not-a-date';
  result = context.gsmBuildLedger(db, { from: '2026-10-01', to: '2026-10-31' });
  const errors = context.gsmRelevantIssues(result, 'A', '').filter(issue => issue.severity === 'error');
  assert.equal(errors.filter(issue => issue.code === 'date').length, 1);
  assert.equal(context.gsmRelevantIssues(result, 'B', '').filter(issue => issue.code === 'date').length, 0);
  assert.equal(context.gsmRelevantIssues(result, 'A', 'ДТ').filter(issue => issue.code === 'date').length, 0);
  assert.ok(errors.find(issue => issue.code === 'date').sourceRefs.some(ref => ref.type === 'record' && ref.id === 'actual-source'));
});
