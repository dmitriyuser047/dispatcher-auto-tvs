let gsmPendingAct = null;
function gsmRelevantIssues(ledger, org, grade) {
  return ledger.issues.filter(i => (!grade || !i.grade || grade === i.grade) && (!org || !i.org && !i.orgs || gsmOrgKey(i.org) === gsmOrgKey(org) || (i.orgs || []).some(o => gsmOrgKey(o) === gsmOrgKey(org))));
}
function gsmExportSheet(wb, name, values, numericFrom) {
  const ws = XLSX.utils.aoa_to_sheet(values);
  ws['!cols'] = (values[0] || []).map((v, i) => ({ wch: i < (numericFrom || 0) ? 23 : 14 }));
  values.forEach((row, r) => row.forEach((value, c) => {
    const cell = ws[XLSX.utils.encode_cell({ r, c })];
    if (!cell) return;
    cell.s = { font: { name: 'Arial', sz: 10, bold: r === 0 }, alignment: { vertical: 'center', wrapText: true },
      fill: { patternType: 'solid', fgColor: { rgb: r === 0 ? 'DCEAE4' : r % 2 ? 'FFFFFF' : 'F4F6F5' } } };
    if (typeof value === 'number') cell.z = '0.000';
  }));
  if (values.length > 1) ws['!autofilter'] = { ref: ws['!ref'] };
  XLSX.utils.book_append_sheet(wb, ws, name);
  return ws;
}
function gsmAppendReconciliation(wb, ledger, org, grade) {
  const relevant = r => (!org || gsmOrgKey(r.org) === gsmOrgKey(org)) && (!grade || r.grade === grade);
  gsmExportSheet(wb, 'Бочки организаций', [['Организация', 'Топливо', 'На начало, л', 'Приход, л', 'Расход, л', 'Корректировка, л', 'На конец, л'],
    ...ledger.barrels.filter(relevant).map(b => [b.org, b.grade, b.start, b.issued, b.spent, b.correction, b.end])], 2);
  const vehicle = id => fpVehicleTitle((data.vehicles || []).find(v => v.id === id));
  gsmExportSheet(wb, 'Поступления', [['Дата', 'Карта', 'Организация карты', 'Закреплённая машина', 'Заправленная машина', 'Топливо', 'Поставщик', 'Литры', 'Сумма', 'Строка журнала'],
    ...ledger.receipts.filter(relevant).map(p => [p.date, p.cardNo, p.org, vehicle(p.cardVehicleId), vehicle(p.vehicleId), p.grade, p.provider, p.qty, p.sum, p.recordId])], 7);
  gsmExportSheet(wb, 'Расход по партиям', [['Дата', 'Организация', 'Машина', 'Топливо', 'Списано, л', 'Строка журнала'],
    ...ledger.movements.filter(m => m.kind === 'consumption' && relevant(m)).map(m => [m.date, m.org, vehicle(m.vehicleId), m.grade, gsmRound(m.qty), m.recordId])], 4);
  gsmExportSheet(wb, 'Расхождения', [['Уровень', 'Дата', 'Организация', 'Машина', 'Топливо', 'Расхождение', 'Покупка', 'Запись'],
    ...gsmRelevantIssues(ledger, org, grade).map(i => [i.severity === 'error' ? 'Ошибка' : 'Проверить', i.date, i.org || (i.orgs || []).join(', '), vehicle(i.vehicleId), i.grade, i.message, i.purchaseId, i.recordId])], 8);
}
function gsmActRows(ledger, org, grade) {
  const eligible = v => v && ['diesel', 'gasoline'].includes(v.fuel || 'diesel');
  const rows = ledger.rows.filter(r => eligible(r.vehicle)).slice();
  const represented = new Set(ledger.rows.map(r => r.vehicleId));
  // Стоящие машины сохраняются в старом бланке, но не создают движения в расчёте.
  (data.vehicles || []).filter(v => eligible(v) && !represented.has(v.id)).forEach(v => {
    const owner = gsmCardAt(data, v.fuelcard, ledger.to).org || gsmVehicleOrgAt(v, ledger.to) || GSM_UNKNOWN_ORG;
    rows.push({ vehicle: v, vehicleId: v.id, org: owner, grade: gsmVehicleGrade(v), providers: {},
      start: 0, issued: 0, spent: 0, idle: 0, norm: 0, km: 0, glonass: 0, end: 0, correction: 0 });
  });
  return rows.filter(r => (!org || gsmOrgKey(r.org) === gsmOrgKey(org)) && (!grade || r.grade === grade));
}
function gsmActPeriod(from, to) {
  const months = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  if (from && to) return from.slice(0, 7) === to.slice(0, 7)
    ? months[Number(from.slice(5, 7)) - 1] + ' ' + from.slice(0, 4) + 'г.' : fmtDate(from) + ' — ' + fmtDate(to);
  if (from) return 'период с ' + fmtDate(from);
  if (to) return 'период по ' + fmtDate(to);
  return 'всё время';
}
function gsmActWorkbook(ledger, org, opts) {
  opts = opts || {};
  const rows = gsmActRows(ledger, org, opts.fuelGrade);
  const organizations = [...new Map(rows.map(r => [gsmOrgKey(r.org), r.org])).values()].sort((a, b) => a.localeCompare(b, 'ru'));
  const wb = XLSX.utils.book_new(), ws = { '!merges': [], '!rows': [] };
  const P = { navy: '1B3A6B', navyMid: '2D5A8E', navyLight: 'D6E4F7', white: 'FFFFFF', gray1: 'F8FAFC',
    gray3: 'E2E8F0', text: '1E293B', green: '16A34A', red: 'DC2626', greenPale: 'DCFCE7', redPale: 'FEE2E2' };
  const border = (style, rgb) => Object.fromEntries(['top', 'bottom', 'left', 'right'].map(side => [side, { style, color: { rgb } }]));
  const style = (font, fill, alignment, lines) => ({ font: font || {},
    fill: fill ? { patternType: 'solid', fgColor: { rgb: fill } } : { patternType: 'none' },
    alignment: alignment || { vertical: 'center' }, border: lines || {} });
  const ST = {
    appr: style({ sz: 10, color: { rgb: P.text } }, null, { horizontal: 'left', vertical: 'center', wrapText: true }),
    title: style({ bold: true, sz: 13, color: { rgb: P.text } }, null, { horizontal: 'center', vertical: 'center', wrapText: true }),
    center: style({ sz: 10, color: { rgb: P.text } }, null, { horizontal: 'center', vertical: 'center' }),
    plain: style({ sz: 10, color: { rgb: P.text } }, null, { horizontal: 'left', vertical: 'center', wrapText: true }),
    head: style({ bold: true, sz: 9, color: { rgb: P.white } }, P.navyMid, { horizontal: 'center', vertical: 'center', wrapText: true }, border('medium', P.navy)),
    total: style({ bold: true, sz: 10, color: { rgb: P.text } }, P.navyLight, { horizontal: 'center', vertical: 'center' }, border('medium', P.navy)),
    totalLabel: style({ bold: true, sz: 10, color: { rgb: P.text } }, P.navyLight, { horizontal: 'left', vertical: 'center', indent: 1 }, border('medium', P.navy)),
    cell: (bg, horizontal) => style({ sz: 9, color: { rgb: P.text } }, bg,
      { horizontal, vertical: 'center', wrapText: horizontal !== 'right', indent: horizontal === 'center' ? 0 : 1 }, border('thin', P.gray3)),
  };
  let n = 0;
  function put(r, c, value, s) {
    ws[XLSX.utils.encode_cell({ r, c })] = { v: value == null ? '' : value, t: typeof value === 'number' ? 'n' : 's', s };
  }
  function merge(r1, c1, r2, c2) { ws['!merges'].push({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } }); }
  function line(text, s, height, column) {
    const c = column || 0;
    for (let j = c; j <= 25; j++) put(n, j, j === c ? text : '', s);
    merge(n, c, n, 25); ws['!rows'][n++] = { hpt: height };
  }
  const numeric = (value, decimals) => +gsmNumber(value).toFixed(decimals == null ? 2 : decimals);
  const suppliers = [/газпром/i, /волга/i, /спс/i, /наличк|наличн|cash/i];
  const periodRecords = new Map();
  (data.records || []).filter(r => gsmValidDate(r.date) && gsmInPeriod(r.date, ledger.from, ledger.to)).forEach(r => {
    if (!periodRecords.has(r.vehicleId)) periodRecords.set(r.vehicleId, []);
    periodRecords.get(r.vehicleId).push(r);
  });
  periodRecords.forEach(list => list.sort((a, b) => a.date.localeCompare(b.date)));
  organizations.forEach((owner, section) => {
    const orgRows = rows.filter(r => gsmOrgKey(r.org) === gsmOrgKey(owner)).sort((a, b) =>
      (a.vehicle.object || '\uffff').localeCompare(b.vehicle.object || '\uffff', 'ru'));
    if (section) line('', {}, 10);
    if (opts.draft) {
      const count = gsmRelevantIssues(ledger, owner, opts.fuelGrade).filter(i => i.severity === 'error').length;
      line('ЧЕРНОВИК. Не утверждён. Расхождений: ' + count,
        style({ bold: true, sz: 12, color: { rgb: P.red } }, P.redPale, { horizontal: 'center', vertical: 'center' }), 22);
    }
    line('Утверждаю:', ST.appr, 14, 18);
    line('Руководитель ' + owner, ST.appr, 14, 18);
    line('_______________ / ______________ /', ST.appr, 14, 18);
    line('Акт списания ГСМ по ' + owner + ' за ' + gsmActPeriod(ledger.from, ledger.to), ST.title, 22);
    if (opts.actNo) line('Акт № ' + opts.actNo + '   ·   Дата составления: ' + fmtDate(opts.actDate || ''), ST.center, 14);
    line('', {}, 4);
    const h1 = n, h2 = n + 1;
    for (let r = h1; r <= h2; r++) for (let c = 0; c <= 25; c++) put(r, c, '', ST.head);
    const vh = (c, label) => { put(h1, c, label, ST.head); merge(h1, c, h2, c); };
    const gh = (c1, c2, label, subs) => { put(h1, c1, label, ST.head); merge(h1, c1, h1, c2); subs.forEach((s, k) => put(h2, c1 + k, s, ST.head)); };
    vh(0, '№ п/п'); vh(1, 'Марка а/м'); vh(2, '№ а/м'); vh(3, 'Объект'); vh(4, 'Марка топлива'); vh(5, 'ФИО водителя');
    gh(6, 7, 'Спидометр', ['на нач', 'на кон']);
    gh(8, 10, 'Норма, л/100км', ['город', 'трасса', 'х/х']);
    vh(11, 'Пробег, км'); vh(12, 'Пробег Глонасс, км'); vh(13, 'Остаток на нач., л');
    gh(14, 19, 'Получено, л', ['Газпром', 'Волга-Интер', 'СПС', 'Наличка', 'Другой', 'Всего']);
    gh(20, 22, 'Списано, л', ['по норме', 'по факту', 'х/х']);
    vh(23, 'Остаток на кон., л'); vh(24, 'Экономия(+)/ Перерасход(-), л'); vh(25, 'Поставщик');
    ws['!rows'][h1] = { hpt: 16 }; ws['!rows'][h2] = { hpt: 30 }; n += 2;
    const totals = Array(26).fill(0), measuredPlates = new Set();
    orgRows.forEach((r, i) => {
      const v = r.vehicle, per = periodRecords.get(v.id) || [], split = [0, 0, 0, 0, 0];
      Object.entries(r.providers).forEach(([provider, qty]) => { const k = suppliers.findIndex(re => re.test(provider)); split[k < 0 ? 4 : k] += qty; });
      const eco = numeric(r.norm - (r.spent - r.idle));
      const values = [i + 1, v.make || '—', v.plate || '—', v.object || '—', r.grade, (v.driver || '—').replace(/\r?\n/g, ', '),
        (per.length ? per[0].odoStart : v.odometer) ?? '—', (per.length ? per[per.length - 1].odoEnd : v.odometer) ?? '—',
        v.normCity ?? v.norm ?? '—', v.normHighway ?? '—', v.normIdle ?? '—', numeric(r.km, 1), r.glonass > 0 ? numeric(r.glonass, 1) : '—', numeric(r.start),
        ...split.map(q => q ? numeric(q) : ''), numeric(r.issued), numeric(r.norm), numeric(r.spent), numeric(r.idle), numeric(r.end), eco,
        Object.keys(r.providers).join(', ') || v.supplier || '—'];
      const bg = i % 2 === 0 ? P.white : P.gray1;
      values.forEach((value, c) => {
        let s = ST.cell(bg, [1, 3, 5].includes(c) ? 'left' : c >= 6 && c <= 24 ? 'right' : 'center');
        if (c === 24) s = style({ bold: true, sz: 9, color: { rgb: eco < 0 ? P.red : eco > 0 ? P.green : P.text } },
          eco < 0 ? P.redPale : eco > 0 ? P.greenPale : bg, { horizontal: 'right', vertical: 'center', indent: 1 }, border('thin', P.gray3));
        put(n, c, value, s);
        if (c >= 11 && c <= 24) totals[c] += gsmNumber(value);
      });
      if (per.some(x => x.tankMeasured != null && x.tankMeasured !== '')) measuredPlates.add(v.plate);
      ws['!rows'][n++] = { hpt: 16 };
    });
    for (let c = 0; c <= 25; c++) put(n, c, c === 0 ? 'ИТОГО:' : c >= 11 && c <= 24 ? numeric(totals[c], c <= 12 ? 1 : 2) : '', c < 11 ? ST.totalLabel : ST.total);
    if (!totals[12]) put(n, 12, '—', ST.total);
    merge(n, 0, n, 10); ws['!rows'][n++] = { hpt: 18 };
    if (measuredPlates.size) line('Списано по факту с учётом замеров остатка в баке: ' + [...measuredPlates].join(', ') + '.', ST.plain, 16);
    line('', {}, 6);
    line('Комиссия:   Главный механик _______________ / ________________ /', ST.plain, 16);
    line('Управляющий директор _______________ / ________________ /', ST.plain, 16);
  });
  ws['!cols'] = [4, 18, 12, 14, 8, 18, 9, 9, 7, 7, 6, 9, 10, 9, 9, 10, 8, 8, 8, 9, 9, 9, 8, 9, 11, 13].map(wch => ({ wch }));
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(n - 1, 0), c: 25 } });
  XLSX.utils.book_append_sheet(wb, ws, 'Акт списания ГСМ');
  return wb;
}
function gsmReviewActExport(ledger, org, opts) {
  const errors = gsmRelevantIssues(ledger, org, opts.fuelGrade).filter(i => i.severity === 'error');
  const labels = { 'purchase-duplicate': 'Возможные повторы покупок', 'journal-missing': 'Нет связи покупки с журналом',
    'journal-difference': 'Разница литров журнала и выписки', 'manual-card-reference': 'Не уточнена карта ручной заправки',
    'source-org': 'Не определена организация карты', shortage: 'Недостаток расчётного остатка',
    'carry-shortage': 'Неподтверждённый переходящий остаток', 'measurement-surplus': 'Замер выше расчётного остатка',
    'unknown-grade': 'Не уточнена марка топлива' };
  const groups = new Map();
  errors.forEach(i => {
    const label = labels[i.code] || i.message;
    groups.set(label, (groups.get(label) || 0) + 1);
  });
  gsmPendingAct = { from: ledger.from, to: ledger.to, opts: { ...opts, org } };
  openGenericModal('Проверка акта ГСМ', '<div class="gsm-act-review"><p>' + fpEsc(org || 'Все организации') + ' · ' +
    fpEsc(opts.fuelGrade || 'Все марки топлива') + '</p><p>Период: ' + fpEsc(fmtDate(ledger.from) || 'Начало учёта') + ' — ' +
    fpEsc(fmtDate(ledger.to) || 'Все даты') + '</p><div class="gsm-status gsm-error">Расчёт требует проверки: ' + errors.length +
    '. Статус выгрузки: черновик, не утверждён.</div><ul>' + [...groups].map(([label, count]) => '<li>' + fpEsc(label) + ': ' + count + '</li>').join('') +
    '</ul><div class="gsm-actions"><button class="btn btn-ghost" onclick="gsmCancelActExport()">Отмена</button>' +
    '<button class="btn btn-ghost" onclick="gsmExportPendingActReconciliation()">Выгрузить сверку</button>' +
    '<button class="btn btn-primary" onclick="gsmExportActDraft()">Выгрузить черновик</button></div></div>', 680);
  return null;
}
function gsmCancelActExport() { gsmPendingAct = null; closeModal('genericModal'); }
function gsmExportActDraft() {
  const pending = gsmPendingAct;
  if (!pending) return null;
  const wb = exportFuelWriteOffAct(pending.from, pending.to, { ...pending.opts, draft: true });
  if (wb) gsmCancelActExport();
  return wb;
}
function gsmExportPendingActReconciliation() {
  if (!gsmPendingAct) return null;
  const pending = gsmPendingAct, wb = XLSX.utils.book_new();
  const ledger = gsmBuildLedger(data, { from: pending.from, to: pending.to });
  gsmAppendReconciliation(wb, ledger, pending.opts.org, pending.opts.fuelGrade);
  XLSX.writeFile(wb, 'Сверка_акта_ГСМ_' + (pending.from || 'начало') + '_' + (pending.to || 'всё') + '.xlsx');
  return wb;
}
function gsmExportCurrentAct() {
  if (!gsmValidDate(gsmActDate)) { alert('Укажите дату акта'); return null; }
  const range = gsmMonthRange(fpMonth);
  return exportFuelWriteOffAct(range.from, range.to, { org: gsmOrg, fuelGrade: gsmFuel, actNo: gsmActNo, actDate: gsmActDate });
}
function gsmExportReconciliation() {
  const ledger = gsmBuildLedger(data, gsmMonthRange(fpMonth)), wb = XLSX.utils.book_new();
  gsmAppendReconciliation(wb, ledger, gsmOrg, gsmFuel);
  XLSX.writeFile(wb, 'Сверка_ГСМ_' + fpMonth + '.xlsx');
}
