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
function gsmActWorkbook(ledger, org, opts) {
  const wb = XLSX.utils.book_new(), organizations = org ? [org] : ledger.organizations;
  const suppliers = [/газпром/i, /волга/i, /спс/i, /наличк|наличн|cash/i];
  organizations.forEach((owner, index) => {
    const rows = ledger.rows.filter(r => gsmOrgKey(r.org) === gsmOrgKey(owner) && (!opts.fuelGrade || r.grade === opts.fuelGrade));
    if (!rows.length) return;
    const values = [[ 'Акт списания ГСМ', owner, ledger.from, ledger.to, opts.actNo || '', opts.actDate || '' ],
      ['№', 'Марка машины', 'Госномер', 'Объект / организация машины', 'Топливо', 'Водитель', 'Одометр начало', 'Одометр конец', 'Норма город', 'Норма трасса', 'Норма х/х',
        'Пробег (доля), км', 'ГЛОНАСС (доля), км', 'На начало, л', 'Газпром', 'Волга-Интер', 'СПС', 'Наличные', 'Другие', 'Приход всего, л', 'Норма, л', 'Расход всего, л', 'В т.ч. х/х, л', 'На конец, л', 'Экономия, л', 'Поставщики']];
    rows.sort((a, b) => fpVehicleTitle(a.vehicle).localeCompare(fpVehicleTitle(b.vehicle), 'ru') || a.grade.localeCompare(b.grade, 'ru')).forEach((r, i) => {
      const v = r.vehicle, per = (data.records || []).filter(x => x.vehicleId === v.id && gsmInPeriod(x.date, ledger.from, ledger.to)).sort((a, b) => a.date.localeCompare(b.date));
      const split = [0, 0, 0, 0, 0];
      Object.entries(r.providers).forEach(([provider, qty]) => { const k = suppliers.findIndex(re => re.test(provider)); split[k < 0 ? 4 : k] += qty; });
      values.push([i + 1, v.make || '', v.plate || '', [v.object, v.org].filter(Boolean).join(' / '), r.grade, v.driver || '',
        per.length ? per[0].odoStart ?? '' : '', per.length ? per[per.length - 1].odoEnd ?? '' : '', v.normCity ?? v.norm ?? '', v.normHighway ?? '', v.normIdle ?? '',
        r.km, r.glonass, r.start, ...split.map(gsmRound), r.issued, r.norm, r.spent, r.idle, r.end, gsmRound(r.norm - (r.spent - r.idle)), Object.keys(r.providers).join(', ')]);
    });
    const total = Array(26).fill(''); total[0] = 'Итого';
    for (let c = 11; c <= 24; c++) total[c] = gsmRound(values.slice(2).reduce((s, r) => s + gsmNumber(r[c]), 0));
    values.push(total, ['Комиссия: ____________________', 'Руководитель: ____________________']);
    const ws = gsmExportSheet(wb, 'Акт ' + (index + 1), values, 6);
    ws['!autofilter'] = { ref: 'A2:Z' + (values.length - 2) };
    ws['!merges'] = [{ s: { r: 0, c: 6 }, e: { r: 0, c: 25 } }];
    ws['!cols'] = Array.from({ length: 26 }, (_, c) => ({ wch: c === 0 ? 5 : [1, 3, 5, 25].includes(c) ? 25 : 14 }));
    ws['!rows'] = values.map((_, r) => ({ hpt: r === 1 ? 45 : 30 }));
  });
  gsmAppendReconciliation(wb, ledger, org, opts.fuelGrade);
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
