let gsmOrg = '', gsmFuel = '', gsmActNo = '', gsmActDate = new Date().toISOString().slice(0, 10);
const GSM_MAIN_VIEWS = [['receipts', 'Выписка'], ['manual', 'Добавить вручную'], ['journal', 'Журнал и остатки'], ['writeoff', 'Списание']];
const GSM_EXTRA_VIEWS = [['fcards', 'Топливные карты'], ['cards', 'По машинам'], ['doubles', 'Повторные заправки'], ['checks', 'Проверки'],
  ['measures', 'Замеры'], ['compare', 'Сравнение месяцев'], ['negative', 'Отрицательные остатки'], ['recon', 'Сверка с 1С'],
  ['monthly', 'Старая месячная сверка'], ['close', 'Закрытие месяца'], ['unmatched', 'Без машины'], ['history', 'История загрузок'], ['glonass', 'ГЛОНАСС']];
function gsmArg(value) { return fpEsc(JSON.stringify(String(value || ''))); }
function gsmVisible(row) { return (!gsmOrg || gsmOrgKey(row.org) === gsmOrgKey(gsmOrg)) && (!gsmFuel || row.grade === gsmFuel); }
function gsmVehicle(id) { return (data.vehicles || []).find(v => v.id === id); }
function gsmTable(head, rows, footer) {
  return '<div class="gsm-table-scroll"><table class="data-table gsm-table"><thead><tr>' + head.map(h => '<th>' + h + '</th>').join('') +
    '</tr></thead><tbody>' + (rows.join('') || '<tr><td colspan="' + head.length + '" class="gsm-empty">Нет данных за выбранный период</td></tr>') + '</tbody>' + (footer ? '<tfoot>' + footer + '</tfoot>' : '') + '</table></div>';
}
function gsmCell(value, number) { return '<td' + (number ? ' class="gsm-number"' : '') + '>' + (number ? fpNum(value, 3) : fpEsc(value)) + '</td>'; }
function gsmConsumptionBasisHtml(ledger, recordId) {
  const sources = [...new Set((ledger.movements || []).filter(row => row.kind === 'consumption' && row.recordId === recordId).map(row => row.source))];
  return sources.length ? '<small>' + sources.map(source => fpEsc(gsmConsumptionSourceLabel(source))).join(' · ') + '</small>' : '';
}
function gsmGradeReconciliationHtml(ledger) {
  const movements = gsmGradeReconciliations(ledger, gsmOrg, gsmFuel);
  if (!movements.length) return '';
  const rows = movements.map(row => '<tr>' + gsmCell(fmtDate(row.date)) + gsmCell(fpVehicleTitle(gsmVehicle(row.vehicleId))) + gsmCell(row.org) + gsmCell(row.fromGrade + ' → ' + row.toGrade) + gsmCell(row.grade) +
    '<td class="gsm-number">' + (row.delta > 0 ? '+' : '') + fpNum(row.delta, 3) + '</td><td>' +
    fpEsc((row.purchaseId ? 'Заправка' : 'Замер остатка') + ' от ' + fmtDate(row.date) + '; ранее учтённый расход' + (row.debtDate ? ' от ' + fmtDate(row.debtDate) : '')) +
    '<details><summary>Связанные записи</summary>' + fpEsc(gsmReconciliationBasis(row)) + '<small>Пара: ' + fpEsc(row.pairId) + '</small></details></td></tr>');
  return '<section class="gsm-band" aria-label="Сверка марок топлива"><h3>Сверка марок <span>аналитическое перераспределение остатков</span></h3>' +
    '<p class="gsm-status">Корректировки идут парой −/+ в одной машине и организации. Они не меняют марку покупки, приход или расход. При фильтре по топливу показана только сторона выбранной марки; направление и номер пары сохранены.</p>' +
    gsmTable(['Дата', 'Машина', 'Организация', 'Направление пары', 'Марка строки', 'Корректировка ±, л', 'Основание'], rows) + '</section>';
}
function gsmReceiptSummary(ledger, org) {
  const receipts = ledger.receipts.filter(p => !org || gsmOrgKey(p.org) === gsmOrgKey(org));
  const grades = [...new Set([...FP_GRADES, ...receipts.map(p => p.grade || 'Не указано')])];
  const groups = new Map();
  const groupFor = name => {
    const label = String(name || GSM_UNKNOWN_ORG).trim().replace(/\s+/g, ' '), key = gsmOrgKey(label);
    if (!groups.has(key)) groups.set(key, { org: label, quantities: new Map() });
    return groups.get(key);
  };
  (ledger.organizations || []).filter(name => !org || gsmOrgKey(name) === gsmOrgKey(org)).forEach(groupFor);
  // Поступления без машины входят в приход организации, даже если ещё не попали в остатки ТС.
  receipts.forEach(p => {
    const group = groupFor(p.org), grade = p.grade || 'Не указано';
    group.quantities.set(grade, (group.quantities.get(grade) || 0) + gsmNumber(p.qty));
  });
  const rows = [...groups.values()].sort((a, b) => a.org.localeCompare(b.org, 'ru')).map(group => {
    const quantities = grades.map(grade => gsmRound(group.quantities.get(grade) || 0));
    return { org: group.org, quantities, total: gsmRound(quantities.reduce((sum, qty) => sum + qty, 0)) };
  });
  const totals = grades.map((_, index) => gsmRound(rows.reduce((sum, row) => sum + row.quantities[index], 0)));
  return { grades, rows, totals, total: gsmRound(totals.reduce((sum, qty) => sum + qty, 0)), count: receipts.length };
}
function gsmReceiptSummaryHtml(ledger) {
  const summary = gsmReceiptSummary(ledger, gsmOrg);
  const amount = (qty, org, grade) => '<td class="gsm-number"' + (grade ? ' data-grade="' + fpEsc(grade) + '"' : '') + '>' +
    (qty > 0 ? '<button type="button" class="gsm-receipt-amount" title="' + fpEsc([org || 'Все организации', grade || 'Все марки топлива', 'Поступления'].join(' · ')) +
      '" onclick="gsmShowReceipts(' + gsmArg(org) + ',' + gsmArg(grade) + ')">' + fpNum(qty, 3) + '</button>' : '<span class="gsm-zero">' + fpNum(qty, 3) + '</span>') + '</td>';
  const rows = summary.rows.map(row => '<tr data-org="' + fpEsc(row.org) + '"><th scope="row"' + (row.org === GSM_UNKNOWN_ORG ? ' class="gsm-error"' : '') + '>' + fpEsc(row.org) + '</th>' +
    row.quantities.map((qty, index) => amount(qty, row.org, summary.grades[index])).join('') + amount(row.total, row.org, '') + '</tr>');
  const footer = '<tr><th scope="row">Итого</th>' + summary.totals.map((qty, index) => amount(qty, gsmOrg, summary.grades[index])).join('') + amount(summary.total, gsmOrg, '') + '</tr>';
  return '<section class="gsm-band gsm-income-summary" id="gsmIncomeSummary" aria-label="Приход топлива по организациям"><h3>Приход топлива по организациям <span>Все марки · литры · ' + summary.count + ' операций</span></h3>' +
    gsmTable(['Организация', ...summary.grades.map(fpEsc), 'Всего, л'], rows, footer) + '</section>';
}
function gsmShowReceipts(org, grade) {
  gsmOrg = org || ''; gsmFuel = grade || ''; fpView = 'receipts';
  renderFuelPurchases();
  document.getElementById('gsmReceiptOperations')?.scrollIntoView({ block: 'start' });
}
function gsmBarrelsHtml(ledger) {
  const rows = ledger.barrels.filter(gsmVisible).map(b => '<tr>' + gsmCell(b.org) + gsmCell(b.grade) +
    ['start', 'issued', 'spent', 'correction', 'end'].map(k => gsmCell(b[k], true)).join('') + '</tr>');
  return '<section class="gsm-band"><h3>Общие бочки организаций <span>литры</span></h3>' +
    gsmTable(['Организация', 'Топливо', 'На начало', 'Поступило', 'К списанию', 'Корректировка/сверка, л', 'Остаток в машинах'], rows) + '</section>' + gsmGradeReconciliationHtml(ledger);
}
function gsmIssuesHtml(ledger) {
  const issues = gsmRelevantIssues(ledger, gsmOrg).filter(i => !gsmFuel || !i.grade || i.grade === gsmFuel);
  if (!issues.length) return '<div class="gsm-status gsm-ok">Расхождений за период нет</div>';
  const errors = issues.filter(i => i.severity === 'error').length;
  return '<details class="gsm-issues"><summary>Расхождения: ' + errors + ' · На проверку: ' + (issues.length - errors) + '</summary>' +
    gsmTable(['Дата', 'Машина', 'Организация', 'Проверка', ''], issues.map(i => '<tr>' + gsmCell(i.date ? fmtDate(i.date) : 'Входящий остаток') +
      gsmCell(fpVehicleTitle(gsmVehicle(i.vehicleId))) + gsmCell(i.org || (i.orgs || []).join(', ')) + '<td class="' + (i.severity === 'error' ? 'gsm-error' : '') + '">' + fpEsc(i.message) + '</td><td>' +
      (i.purchaseId && fpById(i.purchaseId) ? '<button class="btn btn-ghost btn-sm" onclick="fpEdit(' + gsmArg(i.purchaseId) + ')">Покупка</button>' : '') +
      (i.recordId ? '<button class="btn btn-ghost btn-sm" onclick="gsmEditRecord(' + gsmArg(i.recordId) + ')">Журнал</button>' : '') + '</td></tr>')) + '</details>';
}
function gsmReceiptsHtml(ledger) {
  return gsmStatementHtml(ledger);
}
function gsmJournalHtml(ledger) {
  const visibleVehicles = new Set(ledger.rows.filter(gsmVisible).map(r => r.vehicleId));
  return '<div class="gsm-section-title"><h3>Журнал пробега</h3><button class="btn btn-ghost" onclick="gsmOpeningDialog()">Начальные остатки</button></div>' +
    gsmTable(['Дата', 'Машина', 'Топливо', 'Пробег, км', 'Журнал, л', 'Покупки, л', 'К списанию, л', 'Бак после строки, л', ''],
      ledger.journal.filter(r => visibleVehicles.has(r.vehicleId)).slice().sort((a, b) => b.date.localeCompare(a.date)).map(r => '<tr>' + gsmCell(fmtDate(r.date)) + gsmCell(fpVehicleTitle(gsmVehicle(r.vehicleId))) +
        gsmCell(r.grade) + gsmCell(r.km, true) + gsmCell(r.issued, true) + (r.hasPurchases ? gsmCell(r.statement, true) : gsmCell('Ручной приход')) + '<td class="gsm-number">' + fpNum(r.spent, 3) + gsmConsumptionBasisHtml(ledger, r.recordId) + '</td>' + gsmCell(r.balance, true) +
        '<td><button class="btn btn-ghost btn-sm" onclick="gsmEditRecord(' + gsmArg(r.recordId) + ')">Изменить</button>' +
        (r.hasPurchases && Math.abs(r.issued - r.statement) > 0.011 ? '<button class="btn btn-ghost btn-sm" onclick="fpSyncRecord(' + gsmArg(r.recordId) + ')">По выписке</button>' : '') + '</td></tr>'));
}
function gsmWriteoffHtml(ledger) {
  const errors = gsmRelevantIssues(ledger, gsmOrg, gsmFuel).filter(i => i.severity === 'error');
  return '<div class="gsm-section-title"><h3>Акт списания</h3><button class="btn btn-primary" onclick="gsmExportCurrentAct()">Выгрузить акт</button></div>' +
    '<div class="gsm-filters"><label>Номер акта <input aria-label="Номер акта" value="' + fpEsc(gsmActNo) + '" onchange="gsmActNo=this.value"></label><label>Дата акта <input aria-label="Дата акта" type="date" value="' + gsmActDate + '" onchange="gsmActDate=this.value"></label></div>' +
    (errors.length ? '<div class="gsm-status gsm-error">Акт требует проверки: расхождений ' + errors.length + '</div>' : '') +
    '<p class="gsm-status">К списанию — итоговый расход с учётом холостого хода. Расчёт по норме или замеру не обозначается как введённый факт; основания указаны в журнале и приложении к выгрузке.</p>' +
    gsmTable(['Организация списания', 'Машина', 'Организация машины', 'Топливо', 'На начало, л', 'Поступило, л', 'К списанию, л', 'В т.ч. х/х, л', 'Корректировка/сверка, л', 'Остаток, л'],
      ledger.rows.filter(gsmVisible).map(r => '<tr>' + gsmCell(r.org) + gsmCell(fpVehicleTitle(r.vehicle)) + gsmCell(r.vehicle.org || '') + gsmCell(r.grade) +
        ['start', 'issued', 'spent', 'idle', 'correction', 'end'].map(k => gsmCell(r[k], true)).join('') + '</tr>'));
}
function gsmRenderWorkspace() {
  if (fpView === 'vehicle' && fpVehicle) return fpRenderVehicle();
  const months = [...new Set([...(data.records || []).map(r => (r.date || '').slice(0, 7)), ...fpLive().map(p => (p.date || '').slice(0, 7))])].filter(m => /^\d{4}-\d{2}$/.test(m)).sort().reverse();
  if (!fpMonth) fpMonth = fpView === 'receipts' ? 'all' : months[0] || 'all';
  const ledger = gsmBuildLedger(data, gsmMonthRange(fpMonth));
  const orgs = [...new Map([...ledger.organizations, ...ledger.receipts.map(p => p.org), ...(data.vehicles || []).map(v => v.org), ...(data.fuelCards || []).map(c => c.org)].filter(Boolean).map(org =>
    [gsmOrgKey(org), String(org).trim().replace(/\s+/g, ' ')])).values()].sort((a, b) => a.localeCompare(b, 'ru'));
  const grades = [...new Set([...ledger.rows.map(r => r.grade), ...ledger.receipts.map(p => p.grade)])].sort();
  if (gsmOrg && fpView !== 'manual') gsmOrg = orgs.find(org => gsmOrgKey(org) === gsmOrgKey(gsmOrg)) || '';
  if (gsmFuel && !grades.includes(gsmFuel)) gsmFuel = '';
  const mainView = GSM_MAIN_VIEWS.some(([id]) => id === fpView) && fpView !== 'manual';
  let body;
  if (fpView === 'manual') body = gsmManualHtml();
  else if (fpView === 'receipts') body = gsmReceiptsHtml(ledger);
  else if (fpView === 'journal') body = gsmJournalHtml(ledger);
  else if (fpView === 'writeoff') body = gsmWriteoffHtml(ledger);
  else {
    const renderers = { cards: fpCardsHtml, doubles: () => fpDoublesHtml(fpDoubles()), checks: fkChecksHtml, measures: fkMeasuresHtml, compare: fpCompareHtml,
      negative: fpNegativeHtml, recon: frcHtml, fcards: fcCardsHtml, monthly: fpMonthlyHtml, close: fcCloseHtml, unmatched: () => fpUnmatchedHtml(fpLive().filter(p => !p.vehicleId)), history: fpHistoryHtml, glonass: fgHtml };
    body = (renderers[fpView] || fpCardsHtml)();
  }
  document.getElementById('mainContent').innerHTML = '<div class="gsm-workspace"><div class="gsm-heading"><h2>ГСМ</h2><div class="gsm-actions">' +
    '<button class="btn btn-ghost" onclick="document.getElementById(\'fuelImportInput\').click()">Загрузить выписку</button>' +
    '<button class="btn btn-ghost" onclick="document.getElementById(\'officeFuelImportInput\').click()">Машины офис</button>' +
    '<button class="btn btn-ghost" onclick="gsmExportReconciliation()">Выгрузить сверку</button></div></div>' +
    '<div class="gsm-nav">' + GSM_MAIN_VIEWS.map(([id, label]) => '<button class="sec-tab ' + (fpView === id ? 'active' : '') + '" onclick="fpView=' + gsmArg(id) + ';renderFuelPurchases()">' + label + '</button>').join('') +
    '<select aria-label="Дополнительно" class="fsel" onchange="if(this.value){fpView=this.value;renderFuelPurchases()}"><option value="">Дополнительно</option>' +
    GSM_EXTRA_VIEWS.map(([id, label]) => '<option value="' + id + '"' + (fpView === id ? ' selected' : '') + '>' + label + '</option>').join('') + '</select></div>' +
    (fpView === 'manual' ? '' : '<div class="gsm-filters"><select aria-label="Месяц" class="fsel" onchange="fpMonth=this.value;renderFuelPurchases()">' + [...new Set([fpMonth, ...months, 'all'])].map(m => '<option value="' + fpEsc(m) + '"' + (m === fpMonth ? ' selected' : '') + '>' + fpMonthLabel(m) + '</option>').join('') + '</select>' +
    (mainView ? '<select aria-label="Организация" class="fsel" onchange="gsmOrg=this.value;renderFuelPurchases()"><option value="">Все организации</option>' + orgs.map(o => '<option' + (o === gsmOrg ? ' selected' : '') + '>' + fpEsc(o) + '</option>').join('') + '</select>' +
      '<select aria-label="Топливо" class="fsel" onchange="gsmFuel=this.value;renderFuelPurchases()"><option value="">Все марки топлива</option>' + grades.map(g => '<option' + (g === gsmFuel ? ' selected' : '') + '>' + fpEsc(g) + '</option>').join('') + '</select>' : '') + '</div>') +
    (mainView ? (fpView === 'receipts' ? gsmReceiptSummaryHtml(ledger) : gsmBarrelsHtml(ledger)) + gsmIssuesHtml(ledger) : '') + '<div id="fpBody">' + body + '</div></div>';
  if (fpView === 'manual') gsmManualTotals();
}
function gsmEditRecord(id) {
  const r = (data.records || []).find(x => x.id === id);
  if (!r || !fuelEditAllowed(r.date)) return;
  selectedVehicleId = r.vehicleId;
  openEditRecord(id);
}
function gsmAddReceipt() {
  openGenericModal('Новая заправка', '<div class="form-row"><div class="form-group"><label>Дата</label><input id="gsm_new_date" type="date" value="' + new Date().toISOString().slice(0, 10) + '"></div>' +
    '<div class="form-group"><label>Машина</label><select id="gsm_new_vehicle">' + fuelImportVehicleOptions('', true) + '</select></div></div>' +
    '<div class="form-row"><div class="form-group"><label>Карта</label><select id="gsm_new_card"><option value="">Без карты</option>' + fcList().filter(c => c.status !== 'blocked').map(c => '<option value="' + fpEsc(c.number) + '">' + fpEsc(fcFormat(c.number) + ' / ' + (c.org || 'по закреплению')) + '</option>').join('') + '</select></div>' +
    '<div class="form-group"><label>Организация (если без карты)</label><input id="gsm_new_org" value="' + fpEsc(gsmOrg) + '"></div></div>' +
    '<div class="form-row"><div class="form-group"><label>Топливо</label><select id="gsm_new_grade">' + FP_GRADES.map(g => '<option>' + g + '</option>').join('') + '</select></div>' +
    '<div class="form-group"><label>Литры</label><input id="gsm_new_qty" type="number" min="0.001" step="0.001"></div></div>' +
    '<div class="gsm-actions"><button class="btn btn-ghost" onclick="closeModal(\'genericModal\')">Отмена</button><button class="btn btn-primary" onclick="gsmSaveReceipt()">Добавить</button></div>', 650);
}
async function gsmSaveReceipt() {
  const val = id => document.getElementById('gsm_new_' + id).value;
  const date = val('date'), vehicleId = val('vehicle'), qty = Number(val('qty')), cardNo = val('card'), grade = val('grade');
  const sourceOrg = cardNo ? gsmCardAt(data, cardNo, date).org : val('org').trim();
  if (!gsmValidDate(date) || !gsmVehicle(vehicleId) || !Number.isFinite(qty) || qty <= 0 || !sourceOrg) { alert('Укажите дату, машину, литры и организацию поступления. Для карты проверьте её организацию.'); return; }
  if (!fuelEditAllowed(date)) return;
  const before = JSON.stringify(data);
  const p = fpCreate({ date, qty, cardNo, fuel: grade }, { vehicleId, date, grade });
  Object.assign(p, { manual: true, sourceOrg }); fpApply(p, 1);
  if (await saveData(data) === false) { data = JSON.parse(before); rebuildIndex(); return; }
  fpMonth = date.slice(0, 7); closeModal('genericModal'); renderFuelPurchases();
}
function gsmOpeningDialog(vid) {
  const v = gsmVehicle(vid) || (data.vehicles || [])[0];
  if (!v) return;
  const sources = v.fuelBalanceSources || [{ org: v.org || '', grade: gsmVehicleGrade(v), qty: gsmNumber(v.fuelBalance) }];
  openGenericModal('Распределение начального остатка', '<div class="form-group"><label>Машина</label><select id="gsm_open_vehicle" onchange="gsmOpeningDialog(this.value)">' + fuelImportVehicleOptions(v.id, false) + '</select></div>' +
    '<p>Начальный остаток по карточке: <strong>' + fpNum(v.fuelBalance, 3) + ' л</strong></p><div id="gsm_open_rows">' + sources.map(gsmOpeningRow).join('') + '</div>' +
    '<div class="gsm-actions"><button class="btn btn-ghost" onclick="document.getElementById(\'gsm_open_rows\').insertAdjacentHTML(\'beforeend\',gsmOpeningRow({}))">Добавить источник</button>' +
    '<button class="btn btn-primary" onclick="gsmSaveOpening()">Сохранить</button></div>', 720);
}
function gsmOpeningRow(source) {
  return '<div class="gsm-opening-row"><input aria-label="Организация остатка" data-field="org" placeholder="Организация" value="' + fpEsc(source.org || '') + '"><select aria-label="Топливо остатка" data-field="grade">' +
    [...new Set([...FP_GRADES, source.grade].filter(Boolean))].map(g => '<option' + (g === source.grade ? ' selected' : '') + '>' + fpEsc(g) + '</option>').join('') + '</select>' +
    '<input aria-label="Литры остатка" data-field="qty" type="number" step="0.001" min="0" value="' + gsmNumber(source.qty) + '"><button class="btn btn-ghost" title="Удалить источник" aria-label="Удалить источник" onclick="this.parentElement.remove()">×</button></div>';
}
async function gsmSaveOpening() {
  const v = gsmVehicle(document.getElementById('gsm_open_vehicle').value);
  const sources = [...document.querySelectorAll('#gsm_open_rows .gsm-opening-row')].map(el => ({ org: el.querySelector('[data-field="org"]').value.trim(), grade: el.querySelector('[data-field="grade"]').value, qty: Number(el.querySelector('[data-field="qty"]').value) }));
  if (!sources.length || sources.some(s => !s.org || !Number.isFinite(s.qty) || s.qty < 0) || Math.abs(sources.reduce((sum, s) => sum + s.qty, 0) - gsmNumber(v.fuelBalance)) > 0.001) { alert('Укажите организации и распределите весь начальный остаток без изменения общей суммы.'); return; }
  if ((data.fuelPeriods || []).some(p => p.closed)) { alert('Начальный остаток влияет на закрытые месяцы. Сначала откройте их.'); return; }
  const before = v.fuelBalanceSources; v.fuelBalanceSources = sources;
  if (await saveData(data) === false) { v.fuelBalanceSources = before; rebuildIndex(); return; }
  closeModal('genericModal'); renderFuelPurchases();
}
