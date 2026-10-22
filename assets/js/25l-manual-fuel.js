let gsmManual = null, gsmManualPending = null, gsmManualSaving = false;
function gsmManualToday() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function gsmManualId() { return Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10); }
function gsmManualBlank(date) { return { id: gsmManualId(), date: date || '', vehicleId: '', grade: '', cardNo: '', qty: '', sum: '', comment: '' }; }
function gsmManualInit() {
  if (gsmManual) return;
  const month = /^\d{4}-\d{2}$/.test(fpMonth) ? fpMonth : gsmManualToday().slice(0, 7);
  gsmManual = { org: gsmOrg, month, rows: [gsmManualBlank(gsmManualToday().startsWith(month) ? gsmManualToday() : '')] };
}
function gsmManualDirty() { return !!gsmManual?.rows.some(r => r.vehicleId || r.cardNo || r.qty !== '' || r.sum !== '' || r.comment); }
function gsmManualOrganizations() {
  const names = [...(data.vehicles || []).map(v => v.org), ...(data.fuelCards || []).flatMap(c => [c.org, ...(c.orgHistory || []).map(h => h.org)]),
    ...(data.fuelPurchases || []).map(p => p.sourceOrg), gsmManual?.org];
  return [...new Map(names.filter(Boolean).map(n => [gsmOrgKey(n), String(n).trim().replace(/\s+/g, ' ')])).values()].sort((a, b) => a.localeCompare(b, 'ru'));
}
function gsmManualFingerprint(db) { return JSON.stringify(['vehicles', 'records', 'fuelPurchases', 'fuelCards', 'fuelPeriods'].map(k => db[k] || [])); }
function gsmManualRecipientError(db, vehicleId, cardNo, date, grade) {
  const vehicle = (db.vehicles || []).find(v => v.id === vehicleId);
  if (!vehicle) return 'Выберите машину';
  if (gsmFamily(grade) !== gsmFamily(gsmVehicleGrade(vehicle))) return 'Вид топлива не соответствует машине';
  const owner = gsmCardAt(db, cardNo, date);
  const holder = owner.vehicle;
  if (holder && holder.id !== vehicle.id) {
    const objectKey = v => String(v.object || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');
    if (!objectKey(holder) || !objectKey(vehicle)) return 'Для карты и машины нужно указать объект';
    if (objectKey(holder) !== objectKey(vehicle)) return 'Карта и машина относятся к разным объектам';
  }
  return '';
}
function gsmManualPlan(db, draft) {
  if (!draft.org?.trim() || gsmOrgKey(draft.org) === gsmOrgKey(GSM_UNKNOWN_ORG)) throw Error('Выберите организацию');
  if (!gsmValidDate(draft.month + '-01')) throw Error('Выберите месяц');
  const rows = draft.rows.filter(r => r.vehicleId || r.cardNo || r.qty !== '' || r.sum !== '' || r.comment);
  if (!rows.length) throw Error('Заполните хотя бы одну заправку');
  const live = (db.fuelPurchases || []).filter(p => !p.deleted), records = db.records || [], entries = [], groups = new Map(), keys = new Set();
  const duplicateKey = r => [r.date, r.vehicleId, gsmCardKey(r.cardNo), r.grade, fpQtyRound(r.qty)].join('|');
  rows.forEach((row, index) => {
    const fail = text => { throw Error('Строка ' + (index + 1) + ': ' + text); };
    if (!gsmValidDate(row.date) || !row.date.startsWith(draft.month + '-')) fail('укажите дату выбранного месяца');
    if ((db.fuelPeriods || []).some(p => p.closed && p.month === draft.month)) fail('месяц закрыт');
    let qty,sum;try{qty=precisionParse(row.qty,{scale:3,blank:'error'});sum=precisionParse(row.sum,{scale:2,blank:'null'});}catch(error){fail(error.code==='PRECISION'?'литры — до трёх знаков, сумма — до копеек':'введите полные неотрицательные числа');}
    if (!Number.isFinite(qty) || qty <= 0 || Math.abs(qty - fpQtyRound(qty)) > 0.000001) fail('укажите положительные литры, до трёх знаков после запятой');
    if (sum != null && (!Number.isFinite(sum) || sum < 0 || Math.abs(sum - fpRound(sum)) > 0.000001)) fail('укажите неотрицательную сумму, до копеек');
    if (!FP_GRADES.includes(row.grade)) fail('выберите марку топлива');
    const problem = gsmManualRecipientError(db, row.vehicleId, row.cardNo, row.date, row.grade);
    if (problem) fail(problem);
    const owner = gsmCardAt(db, row.cardNo, row.date);
    if (row.cardNo && (!owner.org || gsmOrgKey(owner.org) !== gsmOrgKey(draft.org))) fail('карта не принадлежит выбранной организации на эту дату');
    const key = duplicateKey({...row,qty}), existing = live.filter(p => duplicateKey(p) === key);
    const entry = { ...row, qty: fpQtyRound(qty), sum, org: draft.org.trim(), provider: owner.provider, cardVehicleId: owner.vehicleId,
      duplicate: existing.length > 0 || keys.has(key) };
    keys.add(key); entries.push(entry);
    const groupKey = JSON.stringify([row.vehicleId, row.date, row.grade]);
    if (!groups.has(groupKey)) groups.set(groupKey, { key: groupKey, entries: [], choices: [{ value: 'new', label: 'Новая строка выдачи без пробега' }], mode: 'new' });
    groups.get(groupKey).entries.push(entry);
  });
  groups.forEach(group => {
    const first = group.entries[0], vehicle = (db.vehicles || []).find(v => v.id === first.vehicleId);
    const matching = records.filter(r => r.vehicleId === first.vehicleId && r.date === first.date && recordFuelGrade(r, vehicle) === first.grade);
    const qty = fpQtyRound(group.entries.reduce((s, e) => s + e.qty, 0));
    matching.forEach(r => {
      const linked = live.filter(p => {
        if (p.vehicleId !== r.vehicleId || p.date !== r.date) return false;
        const direct = records.find(x => x.id === p.recordId && x.vehicleId === p.vehicleId && x.date === p.date);
        if (direct) return direct.id === r.id;
        const rawGrade = p.grade || p.product;
        return matching.length === 1 && gsmGrade(rawGrade, rawGrade ? 'Не указано' : gsmVehicleGrade(vehicle)) === first.grade;
      });
      const linkedQty = fpQtyRound(linked.reduce((s, p) => s + (+p.qty || 0), 0));
      const manualQty = fpQtyRound((+r.fuelIssued || 0) - linkedQty);
      if (Math.abs(manualQty) < 0.000001) group.choices.push({ value: 'add:' + r.id, label: 'Добавить ' + fpNum(qty) + ' л в строку журнала (' + fpNum(r.fuelIssued) + ' л)' });
      else if (Math.abs(manualQty - qty) < 0.000001) group.choices.push({ value: 'link:' + r.id, label: 'Связать с уже выданными ' + fpNum(manualQty) + ' л, не прибавлять' });
    });
    if (matching.length === 1 && group.choices.length === 2) group.mode = group.choices[1].value;
  });
  return { org: draft.org, month: draft.month, entries, groups: [...groups.values()], total: fpQtyRound(entries.reduce((s, e) => s + e.qty, 0)),
    sum: fpRound(entries.reduce((s, e) => s + (e.sum || 0), 0)), fingerprint: gsmManualFingerprint(db) };
}
function gsmManualApply(db, plan, confirmedDuplicates) {
  if (gsmManualFingerprint(db) !== plan.fingerprint) throw Error('Данные изменились. Проверьте заправки заново');
  if (plan.entries.some(e => e.duplicate) && !confirmedDuplicates) throw Error('Подтвердите, что совпадающие строки — отдельные заправки');
  plan.groups.forEach(group => { if (!group.choices.some(c => c.value === group.mode)) throw Error('Выберите способ записи в журнал'); });
  const next = JSON.parse(JSON.stringify(db));
  next.records = next.records || []; next.fuelPurchases = next.fuelPurchases || [];
  plan.groups.forEach(group => {
    const first = group.entries[0], linkOnly = group.mode.startsWith('link:');
    let rec = group.mode === 'new' ? null : next.records.find(r => r.id === group.mode.slice(group.mode.indexOf(':') + 1));
    if (!rec) {
      rec = { id: 'r_manual_' + first.id, vehicleId: first.vehicleId, date: first.date, fuelGrade: first.grade, km: 0, fuelIssued: 0, note: '' };
      next.records.push(rec);
    }
    group.entries.forEach(entry => {
      const id = 'fp_manual_' + entry.id;
      if (next.fuelPurchases.some(p => p.id === id)) throw Error('Эта заправка уже сохранена');
      next.fuelPurchases.push({ id, date: entry.date, time: '', vehicleId: entry.vehicleId, recordId: rec.id, grade: entry.grade, product: entry.grade,
        qty: entry.qty, sum: entry.sum, price: entry.sum != null ? precisionRound(DecimalCore.div(entry.sum,entry.qty,{scale:12,rounding:'half-away-from-zero'}),6) : null, cardNo: entry.cardNo || '',
        sourceOrg: entry.org, sourceProvider: entry.provider || '', cardVehicleId: entry.cardVehicleId || '', comment: entry.comment || '', manual: true, manualStatement: true });
      if (!linkOnly) {
        rec.fuelIssued = fpQtyRound((+rec.fuelIssued || 0) + entry.qty);
        if (entry.sum != null) rec.fuelSum = fpRound((+rec.fuelSum || 0) + entry.sum);
      }
    });
  });
  return next;
}
function gsmManualCards(row) {
  const selected=gsmCardKey(row.cardNo),list = (data.fuelCards || []).filter(c => selected&&gsmCardKey(c.number)===selected||!c.archived&&!c.mergedInto&&c.status!=='blocked'&&gsmOrgKey(gsmCardAt(data, c.number, row.date || gsmManual.month + '-01').org) === gsmOrgKey(gsmManual.org));
  if (row.cardNo && !list.some(c => gsmCardKey(c.number) === gsmCardKey(row.cardNo))) list.push({ number: row.cardNo, provider: 'Проверьте организацию' });
  return '<option value="">Без карты</option>' + list.map(c => '<option value="' + fpEsc(c.number) + '"' + (gsmCardKey(row.cardNo) === gsmCardKey(c.number) ? ' selected' : '') + '>' +
    fpEsc(fcFormat(c.number) + (c.provider ? ' · ' + c.provider : '') + (c.status === 'blocked' ? ' · заблокирована' : '')+(c.mergedInto?' · архивная ссылка':c.archived?' · архив':'')) + '</option>').join('');
}
function gsmManualRowHtml(row, index) {
  const disabled = !gsmManual.org || gsmManualSaving ? ' disabled' : '';
  const field = (name, attrs, tag, content) => '<' + (tag || 'input') + ' data-field="' + name + '" aria-label="' + fpEsc({ date: 'Дата', vehicleId: 'Машина', grade: 'Топливо', cardNo: 'Карта', qty: 'Литры', sum: 'Сумма', comment: 'Комментарий' }[name] + ' ' + (index + 1)) + '"' + disabled + ' ' + attrs +
    ' on' + (tag ? 'change' : 'input') + '="gsmManualUpdate(' + gsmArg(row.id) + ',' + gsmArg(name) + ',this.value)">' + (tag ? content + '</' + tag + '>' : '');
  const vehicles = (data.vehicles || []).slice().sort((a, b) => (a.plate || '').localeCompare(b.plate || '', 'ru'));
  return '<tr data-draft-id="' + fpEsc(row.id) + '"><td>' + (index + 1) + '</td><td>' + field('date', 'type="date" min="' + gsmManual.month + '-01" max="' + gsmMonthRange(gsmManual.month).to + '" value="' + fpEsc(row.date) + '"') + '</td>' +
    '<td>' + field('vehicleId', '', 'select', '<option value="">Выберите машину</option>' + vehicles.map(v => '<option value="' + fpEsc(v.id) + '"' + (v.id === row.vehicleId ? ' selected' : '') + '>' + fpEsc(fpVehicleTitle(v) + (v.object ? ' · ' + v.object : '')) + '</option>').join('')) + '</td>' +
    '<td>' + field('grade', '', 'select', '<option value="">Выберите</option>' + FP_GRADES.map(g => '<option' + (g === row.grade ? ' selected' : '') + '>' + g + '</option>').join('')) + '</td>' +
    '<td>' + field('cardNo', '', 'select', gsmManualCards(row)) + '</td><td>' + field('qty', 'type="number" min="0.001" step="0.001" value="' + fpEsc(row.qty) + '"') + '</td>' +
    '<td>' + field('sum', 'type="number" min="0" step="0.01" value="' + fpEsc(row.sum) + '"') + '</td><td>' + field('comment', 'value="' + fpEsc(row.comment) + '"') + '</td>' +
    '<td><button class="icon-btn" title="Убрать строку" aria-label="Убрать строку ' + (index + 1) + '" onclick="gsmManualRemove(' + gsmArg(row.id) + ')"' + disabled + '>&times;</button></td></tr>';
}
function gsmManualHtml() {
  gsmManualInit();
  const locked = gsmManualDirty() || gsmManualSaving ? ' disabled title="Сохраните или очистите строки"' : '';
  const ledger = gsmBuildLedger(data, gsmMonthRange(gsmManual.month));
  const list = gsmManual.org ? ledger.receipts.filter(p => gsmOrgKey(p.org) === gsmOrgKey(gsmManual.org)).sort((a, b) => b.date.localeCompare(a.date)) : [];
  return '<div class="gsm-section-title"><h3>Ручная выписка</h3></div><div class="gsm-filters gsm-manual-context"><label>Организация <select aria-label="Организация выписки" onchange="gsmManualContext(\'org\',this.value)"' + locked + '><option value="">Выберите организацию</option>' +
    gsmManualOrganizations().map(org => '<option value="' + fpEsc(org) + '"' + (gsmOrgKey(org) === gsmOrgKey(gsmManual.org) ? ' selected' : '') + '>' + fpEsc(org) + '</option>').join('') + '</select></label>' +
    '<label>Месяц <input aria-label="Месяц выписки" type="month" value="' + fpEsc(gsmManual.month) + '" onchange="gsmManualContext(\'month\',this.value)"' + locked + '></label></div>' +
    '<div id="gsmManualStatus" class="gsm-status gsm-error" role="alert"></div><div class="gsm-manual-grid">' + gsmTable(['№', 'Дата', 'Машина', 'Топливо', 'Карта', 'Литры', 'Сумма, ₽', 'Комментарий', ''], gsmManual.rows.map(gsmManualRowHtml)) + '</div>' +
    '<div class="gsm-manual-toolbar"><button class="btn btn-ghost" onclick="gsmManualAdd()"' + (!gsmManual.org || gsmManualSaving ? ' disabled' : '') + '>+ Строка</button><button class="btn btn-ghost" onclick="gsmManualClear()"' + (gsmManualSaving ? ' disabled' : '') + '>Очистить</button>' +
    '<span id="gsmManualTotal" class="gsm-manual-total"></span><button class="btn btn-primary" onclick="gsmManualReview()"' + (!gsmManual.org || gsmManualSaving ? ' disabled' : '') + '>Заправить</button></div>' +
    '<div class="gsm-section-title"><h3>Сохранённые заправки <span>' + list.length + ' операций</span></h3></div>' +
    gsmTable(['Дата', 'Машина', 'Топливо', 'Карта', 'Литры', 'Комментарий', ''], list.map(p => '<tr>' + gsmCell(fmtDate(p.date)) + gsmCell(fpVehicleTitle(gsmVehicle(p.vehicleId))) + gsmCell(p.grade) + gsmCell(p.cardNo || 'Без карты') + gsmCell(p.qty, true) + gsmCell(p.comment || '') +
      '<td><button class="btn btn-ghost btn-sm" onclick="' + (p.purchaseId ? 'fpEdit(' + gsmArg(p.purchaseId) : 'gsmEditRecord(' + gsmArg(p.recordId)) + ')">Изменить</button>' +
      (p.purchaseId ? '<button class="btn btn-ghost btn-sm" onclick="fpDelete(' + gsmArg(p.purchaseId) + ')">Удалить</button>' : '') + '</td></tr>'));
}
function gsmManualContext(field, value) {
  if (gsmManualDirty() || gsmManualSaving) return;
  gsmManual[field] = value;
  if (field === 'month') gsmManual.rows = [gsmManualBlank(gsmManualToday().startsWith(value) ? gsmManualToday() : '')];
  renderFuelPurchases();
}
function gsmManualUpdate(id, field, value) {
  if (gsmManualSaving) return;
  const row = gsmManual.rows.find(r => r.id === id); if (!row) return;
  row[field] = value;
  if (field === 'vehicleId') {
    const v = gsmVehicle(value);
    if (v && !row.grade && FP_GRADES.includes(gsmVehicleGrade(v))) row.grade = gsmVehicleGrade(v);
    if (v?.fuelcard && !row.cardNo && gsmOrgKey(gsmCardAt(data, v.fuelcard, row.date).org) === gsmOrgKey(gsmManual.org)) row.cardNo = v.fuelcard;
  }
  if (field === 'vehicleId' || field === 'date') {
    const el = [...document.querySelectorAll('[data-draft-id]')].find(el => el.dataset.draftId === id);
    if (el) {
      const focus = document.activeElement?.dataset.field;
      el.outerHTML = gsmManualRowHtml(row, gsmManual.rows.indexOf(row));
      if (focus) [...document.querySelectorAll('[data-draft-id]')].find(el => el.dataset.draftId === id)?.querySelector('[data-field="' + focus + '"]')?.focus();
    }
  }
  gsmManualTotals();
}
function gsmManualTotals() {
  const total = document.getElementById('gsmManualTotal');
  if(total&&gsmManual){const quantities=[];let invalid=false;for(const row of gsmManual.rows){try{const qty=precisionParse(row.qty,{scale:3,blank:'null'});if(qty!=null&&qty>0)quantities.push(qty);}catch{invalid=true;}}total.textContent=quantities.length+' заправок · '+fpNum(DecimalCore.toNumberExact(DecimalCore.sum(quantities)))+' л'+(invalid?' · проверьте ввод литров':'');}
  document.querySelectorAll('.gsm-manual-context select,.gsm-manual-context input').forEach(el => { el.disabled = gsmManualDirty() || gsmManualSaving; });
}
function gsmManualAdd() {
  if (gsmManualSaving) return;
  gsmManual.rows.push(gsmManualBlank(gsmManual.rows[gsmManual.rows.length - 1]?.date)); renderFuelPurchases();
  [...document.querySelectorAll('[data-draft-id]')].pop()?.querySelector('[data-field="vehicleId"]')?.focus();
}
function gsmManualRemove(id) { if (gsmManualSaving) return; gsmManual.rows = gsmManual.rows.filter(r => r.id !== id); if (!gsmManual.rows.length) gsmManual.rows.push(gsmManualBlank()); renderFuelPurchases(); }
function gsmManualClear() {
  if (gsmManualSaving) return;
  if (!gsmManualDirty()) { gsmManual.rows = [gsmManualBlank()]; renderFuelPurchases(); return; }
  openGenericModal('Очистить незаписанные строки?', '<div class="gsm-manual-review"><div class="gsm-actions"><button class="btn btn-ghost" onclick="closeModal(\'genericModal\')">Отмена</button><button class="btn btn-primary" onclick="gsmManual.rows=[gsmManualBlank()];closeModal(\'genericModal\');renderFuelPurchases()">Очистить строки</button></div></div>', 480);
}
function gsmManualReview() {
  if (gsmManualSaving) return;
  try {
    gsmManualPending = gsmManualPlan(data, gsmManual);
    const plan = gsmManualPending;
    const body = plan.groups.map((group, index) => '<tr>' + gsmCell(fmtDate(group.entries[0].date)) + gsmCell(fpVehicleTitle(gsmVehicle(group.entries[0].vehicleId))) + gsmCell(group.entries[0].grade) + gsmCell(group.entries.reduce((s, e) => s + e.qty, 0), true) +
      '<td><select aria-label="Запись в журнал ' + (index + 1) + '" onchange="gsmManualPending.groups[' + index + '].mode=this.value">' + group.choices.map(choice => '<option value="' + fpEsc(choice.value) + '"' + (choice.value === group.mode ? ' selected' : '') + '>' + fpEsc(choice.label) + '</option>').join('') + '</select></td></tr>');
    const duplicates = plan.entries.filter(e => e.duplicate).length;
    openGenericModal('Заправить: ' + plan.entries.length + ' операций · ' + fpNum(plan.total) + ' л', '<div class="gsm-manual-review"><div class="gsm-status">' + fpEsc(plan.org) + '</div>' +
      gsmTable(['Дата', 'Машина', 'Топливо', 'Литры', 'Запись в журнал'], body) +
      (duplicates ? '<label class="gsm-manual-duplicate"><input id="gsmManualDuplicates" type="checkbox">Подтверждаю отдельные заправки с совпадающими датой, машиной, картой и литрами: ' + duplicates + '</label>' : '') +
      '<div id="gsmManualReviewError" class="gsm-status gsm-error" role="alert"></div><div class="gsm-actions"><button class="btn btn-ghost" onclick="closeModal(\'genericModal\')">Назад</button><button id="gsmManualCommit" class="btn btn-primary" onclick="gsmManualCommit()">Заправить</button></div></div>', 1000);
  } catch (e) { document.getElementById('gsmManualStatus').textContent = e.message; }
}
async function gsmManualCommit() {
  if (gsmManualSaving || !gsmManualPending) return;
  const error = document.getElementById('gsmManualReviewError');
  try {
    const next = gsmManualApply(data, gsmManualPending, !!document.getElementById('gsmManualDuplicates')?.checked), before = data;
    gsmManualSaving = true; document.getElementById('gsmManualCommit').disabled = true;
    data = next; rebuildIndex();
    if (!await saveData(data, { noMerge: true })) {
      data = before; rebuildIndex(); error.textContent = 'Не записано. Строки сохранены в форме; проверьте соединение или обновление базы и повторите.'; return;
    }
    gsmOrg = gsmManual.org; fpMonth = gsmManual.month;
    const date = gsmManual.rows[gsmManual.rows.length - 1]?.date;
    gsmManual.rows = [gsmManualBlank(date)]; gsmManualPending = null;
    closeModal('genericModal'); showToast('Заправки сохранены');
  } catch (e) { error.textContent = e.message; }
  finally {
    gsmManualSaving = false;
    const button = document.getElementById('gsmManualCommit'); if (button) button.disabled = false;
    if (!gsmManualPending) renderFuelPurchases();
  }
}

const gsmStatementDrafts = new Map();
let gsmStatementPending = null, gsmStatementSaving = false;
function gsmStatementLinked(db, p) {
  const records = db.records || [], vehicle = (db.vehicles || []).find(v => v.id === p.vehicleId);
  const direct = records.find(r => r.id === p.recordId && r.vehicleId === p.vehicleId && r.date === p.date);
  if (direct) return direct;
  const grade = gsmGrade(p.grade || p.product, vehicle && gsmVehicleGrade(vehicle));
  const candidates = records.filter(r => r.vehicleId === p.vehicleId && r.date === p.date && recordFuelGrade(r, vehicle) === grade);
  return candidates.length === 1 ? candidates[0] : null;
}
function gsmStatementPlan(db, id, changes) {
  const original = (db.fuelPurchases || []).find(p => p.id === id && !p.deleted);
  if (!original) throw Error('Строка выписки больше не существует');
  const date = changes.date, grade = changes.grade, vehicleId = changes.vehicleId;
  const qty=changes.qty===original.qty?original.qty:precisionParse(changes.qty,{scale:3,blank:'error'});
  const sum=changes.sum===original.sum?original.sum:precisionParse(changes.sum,{scale:2,blank:'null'});
  if (!gsmValidDate(date)) throw Error('Укажите правильную дату');
  if ((db.fuelPeriods || []).some(p => p.closed && [String(original.date || '').slice(0, 7), date.slice(0, 7)].includes(p.month))) throw Error('Месяц закрыт для изменения');
  if (!Number.isFinite(qty) || qty <= 0) throw Error('Укажите положительные литры, до трёх знаков после запятой');
  if (sum != null && (!Number.isFinite(sum) || sum < 0)) throw Error('Сумма должна быть неотрицательной');
  if (!FP_GRADES.includes(grade)) throw Error('Выберите вид топлива');
  const cardNo = changes.cardNo ?? original.cardNo;
  const problem = gsmManualRecipientError(db, vehicleId, cardNo, date, grade);
  if (problem) throw Error(problem);
  const owner = gsmCardAt(db, cardNo, date);
  const sameDate = date === original.date && gsmCardKey(cardNo) === gsmCardKey(original.cardNo);
  const sourceChanges = fpSourceOrgEdit(original, changes, db), org = sourceChanges.sourceOrg;
  if (!org || gsmOrgKey(org) === gsmOrgKey(GSM_UNKNOWN_ORG)) throw Error('Не определена организация карты. Укажите её через «Изменить»');
  const holderId = sameDate && original.cardVehicleId || owner.vehicleId;
  const holder = (db.vehicles || []).find(v => v.id === holderId), vehicle = (db.vehicles || []).find(v => v.id === vehicleId);
  if (holder && holder.id !== vehicleId) {
    const objectKey = v => String(v.object || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');
    if (!objectKey(holder) || !objectKey(vehicle) || objectKey(holder) !== objectKey(vehicle)) throw Error('Карта и машина должны относиться к одному объекту');
  }
  const next = JSON.parse(JSON.stringify(db)), p = next.fuelPurchases.find(p => p.id === id);
  const previous = gsmStatementLinked(next, p);
  const samePosting = previous && p.vehicleId === vehicleId && p.date === date && gsmGrade(p.grade || p.product, gsmVehicleGrade(vehicle)) === grade;
  const choices = [];
  // Не переписываем ручной журнал при подтверждении уже учтённой операции.
  if (samePosting) choices.push({ value: 'keep:' + previous.id, label: 'Сохранить связь с журналом; изменить только разницу литров и суммы' });
  else {
    if (previous) {
      if ((+previous.fuelIssued || 0) + 0.000001 < +p.qty) throw Error('В старой строке журнала меньше литров, чем в покупке. Сначала проверьте эту строку');
      previous.fuelIssued = fpQtyRound((+previous.fuelIssued || 0) - (+p.qty || 0));
      if (p.sum != null && previous.fuelSum != null) previous.fuelSum = Math.max(0, fpRound(previous.fuelSum - p.sum));
    }
    p.recordId = null;
    choices.push({ value: 'new', label: 'Создать отдельную выдачу без пробега' });
    const remaining = next.fuelPurchases.filter(x => x.id !== id && !x.deleted);
    const candidates = (next.records || []).filter(r => r.vehicleId === vehicleId && r.date === date && recordFuelGrade(r, vehicle) === grade);
    candidates.forEach(r => {
      const linkedQty = fpQtyRound(remaining.filter(x => gsmStatementLinked(next, x)?.id === r.id).reduce((s, x) => s + (+x.qty || 0), 0));
      const manualQty = fpQtyRound((+r.fuelIssued || 0) - linkedQty);
      if (Math.abs(manualQty - qty) < 0.000001) choices.push({ value: 'link:' + r.id, label: 'Связать с уже выданными ' + fpNum(qty) + ' л; повторно не добавлять' });
      else if (Math.abs(manualQty) < 0.000001) choices.push({ value: 'add:' + r.id, label: 'Добавить ' + fpNum(qty) + ' л в журнал этой даты' });
    });
  }
  Object.assign(p, { date, qty, sum, grade, vehicleId, cardNo, ...sourceChanges,
    sourceProvider: sameDate && original.sourceProvider || owner.provider || '', cardVehicleId: holderId || '',
    price: Object.hasOwn(changes,'price')?(changes.price===original.price?original.price:precisionParse(changes.price,{scale:6,blank:'null'})):qty===original.qty&&sum===original.sum?original.price:sum==null?null:precisionRound(DecimalCore.div(sum,qty,{scale:12,rounding:'half-away-from-zero'}),6), statementReviewed: true });
  return { id, original: { ...original }, next, choices, mode: choices.length === 2 ? choices[1].value : choices[0].value, fingerprint: gsmManualFingerprint(db) };
}
function gsmStatementApply(db, plan) {
  if (gsmManualFingerprint(db) !== plan.fingerprint) throw Error('База изменилась. Проверьте строку выписки заново');
  if (!plan.choices.some(c => c.value === plan.mode)) throw Error('Выберите запись журнала');
  const next = JSON.parse(JSON.stringify(plan.next)), p = next.fuelPurchases.find(p => p.id === plan.id);
  let rec = plan.mode === 'new' ? null : next.records.find(r => r.id === plan.mode.slice(plan.mode.indexOf(':') + 1));
  if (!rec) {
    rec = { id: 'r_statement_' + gsmManualId(), vehicleId: p.vehicleId, date: p.date, fuelGrade: p.grade, km: 0, fuelIssued: 0, note: '' };
    (next.records || (next.records = [])).push(rec);
  }
  if (plan.mode.startsWith('keep:')) {
    const delta = fpQtyRound(p.qty - plan.original.qty);
    if ((+rec.fuelIssued || 0) + delta < -0.000001) throw Error('После правки литры журнала станут отрицательными. Проверьте журнал');
    if (delta) rec.fuelIssued = fpQtyRound((+rec.fuelIssued || 0) + delta);
    if ((p.sum ?? null) !== (plan.original.sum ?? null)) rec.fuelSum = Math.max(0, fpRound((+rec.fuelSum || 0) + (+p.sum || 0) - (+plan.original.sum || 0)));
  } else if (!plan.mode.startsWith('link:')) {
    rec.fuelIssued = fpQtyRound((+rec.fuelIssued || 0) + p.qty);
    if (p.sum != null) rec.fuelSum = fpRound((+rec.fuelSum || 0) + p.sum);
  }
  p.recordId = rec.id; p.editedAt = new Date().toISOString();
  return next;
}
function gsmStatementUpdate(id, field, value) {
  if (gsmStatementSaving) return;
  const p = fpById(id); if (!p) return;
  if (!gsmStatementDrafts.has(id)) gsmStatementDrafts.set(id, { original: JSON.stringify(p), values: {} });
  gsmStatementDrafts.get(id).values[field] = value;
  const row = [...document.querySelectorAll('[data-purchase-id]')].find(el => el.dataset.purchaseId === id);
  if (row) { row.classList.add('gsm-statement-dirty'); row.querySelector('[data-post]').disabled = false; row.querySelector('[data-row-error]').textContent = ''; }
}
function gsmStatementRow(p) {
  const row = { ...p, ...gsmStatementDrafts.get(p.id)?.values }, linked = gsmStatementLinked(data, p);
  const owner = gsmCardAt(data, p.cardNo, p.date), org = p.sourceOrg || owner.org || GSM_UNKNOWN_ORG;
  const closed = fuelMonthClosed(p.date), disabled = closed || gsmStatementSaving ? ' disabled' : '';
  const field = (name, tag, attrs, content) => '<' + tag + ' data-field="' + name + '" aria-label="' + fpEsc({ date: 'Дата операции', grade: 'Топливо операции', qty: 'Литры операции', sum: 'Сумма операции', vehicleId: 'Заправленная машина' }[name]) + '" ' + attrs + disabled +
    ' on' + (tag === 'select' ? 'change' : 'input') + '="gsmStatementUpdate(' + gsmArg(p.id) + ',' + gsmArg(name) + ',this.value)">' + (tag === 'select' ? content + '</select>' : '');
  const vehicles = (data.vehicles || []).slice().sort((a, b) => fpVehicleTitle(a).localeCompare(fpVehicleTitle(b), 'ru'));
  return '<tr data-purchase-id="' + fpEsc(p.id) + '"' + (gsmStatementDrafts.has(p.id) ? ' class="gsm-statement-dirty"' : '') + '><td>' + field('date', 'input', 'type="date" value="' + fpEsc(row.date) + '"') + '<small>' + fpEsc(p.time || '') + '</small></td>' +
    '<td>' + fpEsc(p.cardNo || 'Без карты') + '<small>' + fpEsc(org) + '</small><small>' + fpEsc(p.sourceProvider || owner.provider || '') + '</small></td>' +
    '<td>' + fpEsc(p.vehicleText || fpVehicleTitle(gsmVehicle(p.cardVehicleId || owner.vehicleId))) + '<small>' + fpEsc(fpPlace(p)) + '</small></td>' +
    '<td>' + field('grade', 'select', '', '<option value="">Выберите</option>' + [...new Set([...FP_GRADES, row.grade].filter(Boolean))].map(g => '<option' + (g === row.grade ? ' selected' : '') + '>' + fpEsc(g) + '</option>').join('')) + '</td>' +
    '<td>' + field('qty', 'input', 'type="number" min="0.001" step="0.001" value="' + fpEsc(row.qty) + '"') + '</td>' +
    '<td>' + field('sum', 'input', 'type="number" min="0" step="0.01" value="' + fpEsc(row.sum ?? '') + '"') + '</td>' +
    '<td>' + field('vehicleId', 'select', '', '<option value="">Выберите машину</option>' + vehicles.map(v => '<option value="' + fpEsc(v.id) + '"' + (v.id === row.vehicleId ? ' selected' : '') + '>' + fpEsc(fpVehicleTitle(v) + (v.object ? ' · ' + v.object : '')) + '</option>').join('')) + '</td>' +
    '<td><span class="' + (linked ? 'gsm-ok' : 'gsm-error') + '">' + (closed ? 'Месяц закрыт' : linked ? 'В журнале' : 'Не заправлено') + '</span>' +
    '<div class="gsm-statement-actions"><button data-post class="btn btn-primary btn-sm" onclick="gsmStatementReview(' + gsmArg(p.id) + ')"' + disabled + '>Заправить</button>' +
    '<button class="btn btn-ghost btn-sm" onclick="gsmStatementEdit(' + gsmArg(p.id) + ')"' + disabled + '>Изменить</button></div><div data-row-error class="gsm-error" role="alert"></div></td></tr>';
}
function gsmStatementHtml(ledger) {
  const purchases = fpLive().filter(p => {
    const owner = gsmCardAt(data, p.cardNo, p.date);
    return fpInMonth(p) && gsmVisible({ org: p.sourceOrg || owner.org || (p.manual && gsmVehicle(p.vehicleId)?.org) || GSM_UNKNOWN_ORG, grade: gsmGrade(p.grade || p.product) });
  }).sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.time || '').localeCompare(String(b.time || '')));
  const manual = ledger.receipts.filter(p => !p.purchaseId && gsmVisible(p));
  return '<div class="gsm-section-title" id="gsmReceiptOperations"><h3>Загруженная выписка <span>' + purchases.length + ' операций · ' + fpNum(purchases.reduce((s, p) => s + (+p.qty || 0), 0)) + ' л</span></h3>' +
    '<div class="gsm-actions"><button class="btn btn-ghost" onclick="gsmOpenStatement()">Все заправки</button><button class="btn btn-ghost" onclick="gsmAddReceipt()">Добавить заправку</button></div></div>' +
    '<div class="gsm-statement-grid">' + gsmTable(['Дата / время', 'Карта / организация', 'ТС в выписке / АЗС', 'Топливо', 'Литры', 'Сумма, ₽', 'Заправленная машина', 'Статус / действия'], purchases.map(gsmStatementRow)) + '</div>' +
    (manual.length ? '<details class="gsm-journal-receipts"><summary>Ручные заправки журнала: ' + manual.length + ' · ' + fpNum(manual.reduce((s, p) => s + p.qty, 0)) + ' л</summary>' +
      gsmTable(['Дата', 'Машина', 'Организация', 'Топливо', 'Литры', ''], manual.map(p => '<tr>' + gsmCell(fmtDate(p.date)) + gsmCell(fpVehicleTitle(gsmVehicle(p.vehicleId))) + gsmCell(p.org) + gsmCell(p.grade) + gsmCell(p.qty, true) +
        '<td><button class="btn btn-ghost btn-sm" onclick="gsmEditRecord(' + gsmArg(p.recordId) + ')">Изменить</button></td></tr>')) + '</details>' : '');
}
function gsmOpenStatement() {
  fpView = 'receipts'; fpMonth = 'all'; gsmOrg = ''; gsmFuel = '';
  closeModal('fuelImportReportModal'); switchSection('fuelPurchases');
}
function gsmStatementEdit(id) {
  fpEdit(id);
  const draft = gsmStatementDrafts.get(id);
  if (!draft || !document.getElementById('genericModal')?.classList.contains('open')) return;
  Object.entries(draft.values).forEach(([key, value]) => {
    const input = document.getElementById('fpe_' + (key === 'vehicleId' ? 'vehicle' : key));
    if (input) input.value = key === 'date' ? fmtDate(value) : value;
  });
}
function gsmStatementReview(id) {
  if (gsmStatementSaving) return;
  const row = [...document.querySelectorAll('[data-purchase-id]')].find(el => el.dataset.purchaseId === id);
  try {
    const p = fpById(id), draft = gsmStatementDrafts.get(id);
    if (draft && draft.original !== JSON.stringify(p)) throw Error('Строка выписки изменилась. Обновите её перед правкой');
    const plan = gsmStatementPlan(data, id, { ...p, ...draft?.values }), after = plan.next.fuelPurchases.find(p => p.id === id);
    gsmStatementPending = plan;
    openGenericModal('Заправить машину из выписки', '<div class="gsm-manual-review">' +
      gsmTable(['Дата', 'Машина', 'Топливо', 'Литры', 'Организация карты'], ['<tr>' + gsmCell(fmtDate(after.date)) + gsmCell(fpVehicleTitle(gsmVehicle(after.vehicleId))) + gsmCell(after.grade) + gsmCell(after.qty, true) + gsmCell(after.sourceOrg) + '</tr>']) +
      (plan.original.vehicleId && plan.original.vehicleId !== after.vehicleId ? '<p>Перенос с ' + fpEsc(fpVehicleTitle(gsmVehicle(plan.original.vehicleId))) + ': старые литры снимаются, новые записываются выбранной машине.</p>' : '') +
      '<label>Запись в журнал <select aria-label="Запись заправки в журнал" onchange="gsmStatementPending.mode=this.value">' + plan.choices.map(c => '<option value="' + fpEsc(c.value) + '"' + (c.value === plan.mode ? ' selected' : '') + '>' + fpEsc(c.label) + '</option>').join('') + '</select></label>' +
      '<div id="gsmStatementError" class="gsm-status gsm-error" role="alert"></div><div class="gsm-actions"><button class="btn btn-ghost" onclick="closeModal(\'genericModal\')">Назад</button>' +
      '<button id="gsmStatementCommit" class="btn btn-primary" onclick="gsmStatementCommit()">Заправить</button></div></div>', 1000);
  } catch (e) { if (row) row.querySelector('[data-row-error]').textContent = e.message; }
}
async function gsmStatementCommit() {
  if (gsmStatementSaving || !gsmStatementPending) return;
  const error = document.getElementById('gsmStatementError');
  let before;
  try {
    const next = gsmStatementApply(data, gsmStatementPending); before = data;
    gsmStatementSaving = true; document.getElementById('gsmStatementCommit').disabled = true;
    data = next; rebuildIndex();
    if (!await saveData(data, { noMerge: true })) {
      data = before; rebuildIndex(); error.textContent = 'Не записано. Изменения в строке сохранены; проверьте соединение и повторите.'; return;
    }
    gsmStatementDrafts.delete(gsmStatementPending.id); gsmStatementPending = null;
    closeModal('genericModal'); showToast('Заправка записана в журнал и учтена в акте');
  } catch (e) { if (before) { data = before; rebuildIndex(); } error.textContent = e.message; }
  finally {
    gsmStatementSaving = false;
    const button = document.getElementById('gsmStatementCommit'); if (button) button.disabled = false;
    if (!gsmStatementPending) renderFuelPurchases();
  }
}
