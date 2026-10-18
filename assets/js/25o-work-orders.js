// Work orders and invoice links use the existing accounting sections.
// Helpers above the DOM functions are also used by the regression tests.
const WO_STATUSES = { assigned: 'Назначено', in_progress: 'В работе', completed: 'Выполнено' };
const WO_SECTIONS = ['repairs', 'vehicleTo', 'toRecords'];
function woStatus(record) { return Object.hasOwn(WO_STATUSES, record?.workStatus) ? record.workStatus : record?.planned ? 'assigned' : 'completed'; }
function woMoney(value) { return Math.round((Number(value) || 0) * 100) / 100; }
function woValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(value + 'T12:00:00Z');
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
}
function woSourceSection(payment, db) {
  if (WO_SECTIONS.includes(payment?.sourceSection)) return payment.sourceSection;
  if (payment?.source === 'repair') return 'repairs';
  if (payment?.source === 'to') return 'vehicleTo';
  if (payment?.source === 'generatorTo' || payment?.source === 'genTo') return 'toRecords';
  return '';
}
function woSource(payment, db) {
  const section = woSourceSection(payment, db);
  return section && payment.sourceId ? (db[section] || []).find(row => row.id === payment.sourceId) || null : null;
}
function woLinkedPayments(db, section, id) {
  return (db.payments || []).filter(p => woSourceSection(p, db) === section && p.sourceId === id);
}
function woPaidAmount(payment) {
  const amount = payment?.paidAmount;
  return amount != null && amount !== '' && Number.isFinite(Number(amount)) ? Math.max(0, woMoney(amount)) : payment?.paid ? Math.max(0, woMoney(payment.sum)) : 0;
}
function woPaymentBalance(payment) { return Math.max(0, woMoney(woMoney(payment?.sum) - woPaidAmount(payment))); }
function woPaymentState(payment, db, today) {
  const section = woSourceSection(payment, db), source = woSource(payment, db);
  const paidAmount = woPaidAmount(payment), balance = woPaymentBalance(payment);
  return { paidAmount, balance, overdue: !!payment.dueDate && payment.dueDate < today && balance > 0,
    sourceSection: section, source, sourceMissing: !!section && !!payment.sourceId && !source,
    sourceCost: source ? woMoney(source.cost) : null,
    amountMismatch: !!source && Math.abs(woMoney(source.cost) - woMoney(payment.sum)) > 0.009,
    duplicateLink: !!section && !!payment.sourceId && woLinkedPayments(db, section, payment.sourceId).length > 1 };
}
function woValidateFields(fields) {
  if (!Object.hasOwn(WO_STATUSES, fields.workStatus)) throw Error('Выберите состояние заявки');
  for (const key of ['expectedReady', 'downtimeStart', 'downtimeEnd', 'paymentDueDate']) {
    if (fields[key] && !woValidDate(fields[key])) throw Error('Укажите действительные даты заявки');
  }
  if (fields.downtimeEnd && !fields.downtimeStart) throw Error('Укажите начало простоя');
  if (fields.downtimeStart && fields.downtimeEnd && fields.downtimeEnd < fields.downtimeStart) throw Error('Конец простоя раньше начала');
  if (fields.workStatus !== 'completed' && fields.downtimeEnd) throw Error('Конец простоя указывается после выполнения заявки');
  return fields;
}
function woApplyFields(record, fields, section, today) {
  woValidateFields(fields);
  const result = { ...record, ...fields };
  if (section !== 'repairs') result.planned = fields.workStatus !== 'completed';
  if (fields.workStatus === 'completed') {
    result.completedAt = record.completedAt || (woStatus(record) === 'completed' ? record.date || record.invoiceDate : null) || today;
    if (result.downtimeStart && !result.downtimeEnd) result.downtimeEnd = today;
  } else result.completedAt = null;
  woValidateFields(result);
  return result;
}
function woDowntime(record, today) {
  if (!woValidDate(record?.downtimeStart)) return null;
  const end = record.downtimeEnd || today;
  if (!woValidDate(end)) return null;
  return Math.max(0, Math.round((Date.parse(end + 'T12:00:00Z') - Date.parse(record.downtimeStart + 'T12:00:00Z')) / 86400000));
}
function woFinishRecord(previous, next, section, today) {
  if (!previous || woStatus(previous) === 'completed' || woStatus(next) !== 'completed' || section === 'repairs') return next;
  const result = { ...next, plannedFor: previous.plannedFor || previous.date };
  if (result.date === previous.date) result.date = today;
  result.completedAt = result.date;
  // Auto plans store the target meter in both columns. On completion the next
  // service must advance by one interval rather than remaining immediately due.
  if (section === 'vehicleTo' && previous.planned && previous.nextOdometerAbs === previous.odometer && Number(result.nextKm) > 0) {
    result.nextOdometerAbs = Math.round((Number(result.odometer) || 0) + Number(result.nextKm));
    if (result.nextDate === previous.date) result.nextDate = null;
  }
  if (section === 'toRecords' && previous.planned && previous.nextHoursAbs === previous.hours && Number(result.nextHours) > 0) {
    result.nextHoursAbs = woMoney((Number(result.hours) || 0) + Number(result.nextHours));
    if (result.nextDate === previous.date) result.nextDate = null;
  }
  return result;
}
function woSyncSourcePaid(db, section, id) {
  const source = (db[section] || []).find(row => row.id === id);
  if (!source) return;
  const linked = woLinkedPayments(db, section, id);
  if (linked.length !== 1) return;
  const state = woPaymentState(linked[0], db, '');
  source.paid = !state.amountMismatch && state.balance <= 0;
}
function woSourceBalance(record, section, db) {
  const linked = woLinkedPayments(db, section, record.id);
  return linked.length === 1 ? Math.max(0, woMoney(record.cost) - woPaidAmount(linked[0])) : record.paid ? 0 : woMoney(record.cost);
}
function woInvoiceFromSource(db, section, id, paymentId, today) {
  const record = (db[section] || []).find(row => row.id === id);
  if (!record) throw Error('Заявка не найдена');
  if (woLinkedPayments(db, section, id).length) throw Error('Счёт по заявке уже существует');
  if (!Number.isFinite(Number(record.cost)) || Number(record.cost) <= 0) throw Error('Сначала укажите стоимость заявки больше нуля');
  return { id: paymentId, date: record.invoiceDate || record.date || today, sum: woMoney(record.cost),
    category: section === 'repairs' ? 'Ремонт' : 'ТО', description: record.description || record.type || 'Техническое обслуживание',
    vehicleId: record.vehicleId || null, generatorId: record.generatorId || null, contragent: record.serviceCenter || record.performer || '',
    reestrNo: null, invoiceNo: record.invoiceNo || '', paid: !!record.paid, paidAmount: record.paid ? woMoney(record.cost) : 0,
    dueDate: record.paymentDueDate || null, note: '', source: section === 'repairs' ? 'repair' : section === 'vehicleTo' ? 'to' : 'generatorTo', sourceSection: section, sourceId: id };
}
function woAddSettlement(payment, entry) {
  const amount = woMoney(entry.amount);
  if (!woValidDate(entry.date)) throw Error('Укажите действительную дату оплаты');
  if (!Number.isFinite(Number(entry.amount)) || amount <= 0) throw Error('Сумма оплаты должна быть больше нуля');
  if (amount > woPaymentBalance(payment)) throw Error('Оплата больше остатка по счёту');
  const paidAmount = woMoney(woPaidAmount(payment) + amount);
  return { ...payment, paidAmount, paid: woPaymentBalance({ ...payment, paidAmount }) <= 0,
    settlements: [...(payment.settlements || []), { id: entry.id, date: entry.date, amount, note: String(entry.note || '').trim() }] };
}
function woKeepPlanned(record, db) {
  return !record.planned || !!record.workStatus || !!record.performer || !!record.serviceCenter || !!record.workDescription || !!record.materials ||
    !!record.expectedReady || !!record.downtimeStart || woLinkedPayments(db, 'vehicleTo', record.id).length > 0;
}

function woFind(section, id) { return WO_SECTIONS.includes(section) ? (data[section] || []).find(row => row.id === id) : null; }
function woCurrency(value) { return woMoney(value).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽'; }
function woBadge(record) {
  const status = woStatus(record);
  return '<span class="workspace-badge ' + (status === 'completed' ? 'is-success' : status === 'in_progress' ? 'is-warning' : 'is-neutral') + '">' + WO_STATUSES[status] + '</span>';
}
function woSummaryHtml(record, section) {
  const days = woDowntime(record, todayIso());
  return '<div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-top:5px">' + woBadge(record) +
    (record.expectedReady ? '<small>Готовность: ' + htmlEsc(fmtDate(record.expectedReady)) + '</small>' : '') +
    (days != null ? '<small>Простой: ' + days + ' дн.</small>' : '') +
    '<button type="button" class="btn btn-ghost btn-sm" onclick="woOpen(' + htmlJs(section) + ',' + htmlJs(record.id) + ')">Заявка</button></div>';
}
function woFormMount(modalId, prefix, record, section) {
  const body = document.querySelector('#' + modalId + ' .modal-body');
  if (!body) return;
  let panel = document.getElementById(prefix + '_work_order');
  if (!panel) { panel = document.createElement('div'); panel.id = prefix + '_work_order'; body.appendChild(panel); }
  const row = record || {}, status = record ? woStatus(row) : 'assigned';
  panel._woBaseline = JSON.parse(JSON.stringify({ ...row, workStatus: status }));
  const field = (key, label, type, value) => '<div class="form-group"><label for="' + prefix + '_wo_' + key + '">' + label + '</label><input id="' + prefix + '_wo_' + key + '" type="' + type + '" value="' + htmlEsc(value || '') + '"></div>';
  panel.innerHTML = '<h3 style="font-size:14px;margin:18px 0 12px">Заявка и простой</h3><div class="form-row"><div class="form-group"><label for="' + prefix + '_wo_workStatus">Состояние заявки</label><select id="' + prefix + '_wo_workStatus">' +
    Object.entries(WO_STATUSES).map(([value, label]) => '<option value="' + value + '"' + (value === status ? ' selected' : '') + '>' + label + '</option>').join('') + '</select></div>' +
    field('serviceCenter', 'Сервис / подрядчик', 'text', row.serviceCenter) + '</div>' +
    (section === 'repairs' ? field('performer', 'Исполнитель заявки', 'text', row.performer) : '') +
    '<div class="form-row">' + field('expectedReady', 'Ожидаемая готовность', 'date', row.expectedReady) + field('paymentDueDate', 'Срок оплаты счёта', 'date', row.paymentDueDate) + '</div>' +
    '<div class="form-row">' + field('downtimeStart', 'Начало простоя', 'date', row.downtimeStart) + field('downtimeEnd', 'Конец простоя', 'date', row.downtimeEnd) + '</div>' +
    '<div class="form-group"><label for="' + prefix + '_wo_workDescription">Работы по заявке</label><textarea id="' + prefix + '_wo_workDescription" rows="2">' + htmlEsc(row.workDescription || '') + '</textarea></div>' +
    '<div class="form-group"><label for="' + prefix + '_wo_materials">Материалы и запчасти</label><textarea id="' + prefix + '_wo_materials" rows="2">' + htmlEsc(row.materials || '') + '</textarea></div>' +
    (section !== 'repairs' ? field('invoiceNo', 'Номер счёта', 'text', row.invoiceNo) : '') +
    '<p style="color:var(--text3);font-size:12px">Сохраните заявку. Создать или открыть связанный счёт можно в её карточке по кнопке «Заявка».</p>';
  if (section === 'repairs') {
    const paid = document.getElementById('rp_paid');
    if (paid) { paid.disabled = !!row.id && woLinkedPayments(data, section, row.id).length > 0; paid.title = paid.disabled ? 'Оплата учитывается в связанном счёте' : ''; }
  }
}
function woFormRead(prefix, record, section) {
  const fields = {}, baseline = document.getElementById(prefix + '_work_order')?._woBaseline;
  for (const key of ['workStatus', 'serviceCenter', 'workDescription', 'materials', 'expectedReady', 'downtimeStart', 'downtimeEnd', 'paymentDueDate', ...(section === 'repairs' ? ['performer'] : ['invoiceNo'])]) {
    const input = document.getElementById(prefix + '_wo_' + key);
    if (!input) return record || {};
    const value = input.value.trim() || null;
    const oldValue = key === 'workStatus' ? baseline?.workStatus : baseline?.[key] || null;
    if (record?.id && baseline && value === oldValue) continue;
    const current = key === 'workStatus' ? woStatus(record) : record?.[key] || null;
    if (record?.id && baseline && current !== oldValue && current !== value) throw Error('Поле заявки уже изменено другим пользователем. Откройте заявку заново и сверьте изменения.');
    fields[key] = value;
  }
  return woApplyFields(record || {}, { ...record, ...fields, workStatus: fields.workStatus || (record ? woStatus(record) : 'assigned') }, section, todayIso());
}
function woMergeFormRecord(current, proposed, prefix) {
  const baseline = document.getElementById(prefix + '_work_order')?._woBaseline;
  if (!current || !baseline) return proposed;
  const merged = { ...proposed };
  const value = (row, key) => key === 'paidAmount' ? woPaidAmount(row) : key === 'workStatus' ? woStatus(row) : row[key] === undefined || row[key] === '' ? null : row[key];
  for (const key of Object.keys(proposed)) {
    const old = JSON.stringify(value(baseline, key)), next = JSON.stringify(value(proposed, key)), live = JSON.stringify(value(current, key));
    if (next === old) { merged[key] = key === 'workStatus' ? woStatus(current) : current[key]; continue; }
    if (live !== old && live !== next) throw Error('Поле уже изменено другим пользователем. Откройте запись заново и сверьте изменения.');
  }
  return merged;
}
function woPaymentSourceHtml(record, section) {
  const linked = woLinkedPayments(data, section, record.id);
  if (!linked.length) return '<button type="button" class="btn btn-ghost btn-sm" onclick="woEnsurePayment(' + htmlJs(section) + ',' + htmlJs(record.id) + ')">Создать счёт по заявке</button>';
  return linked.map(p => {
    const state = woPaymentState(p, data, todayIso());
    return '<p style="margin:8px 0">Счёт ' + htmlEsc(p.invoiceNo || 'без номера') + ': ' + woCurrency(p.sum) + ' · оплачено ' + woCurrency(state.paidAmount) + ' · остаток ' + woCurrency(state.balance) +
      (state.amountMismatch ? ' <span class="workspace-badge is-warning">Сумма заявки отличается</span>' : '') +
      (state.duplicateLink ? ' <span class="workspace-badge is-danger">Несколько счетов по одной заявке</span>' : '') +
      ' <button type="button" class="btn btn-ghost btn-sm" onclick="woOpenPayment(' + htmlJs(p.id) + ')">Открыть счёт</button></p>';
  }).join('');
}
function woRepairPaymentHtml(record) {
  const linked = woLinkedPayments(data, 'repairs', record.id), remaining = woSourceBalance(record, 'repairs', data);
  if (!linked.length) return '<label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:' + (record.paid ? 'var(--green)' : 'var(--red)') + '">' +
    '<input type="checkbox"' + (record.paid ? ' checked' : '') + ' onchange="toggleRepairPaid(' + htmlJs(record.id) + ')" style="width:auto;accent-color:var(--accent)">' + (record.paid ? 'Оплачено' : 'Не оплачено') + '</label>';
  const paid = woPaidAmount(linked[0]), state = woPaymentState(linked[0], data, todayIso());
  return '<span class="workspace-badge ' + (remaining <= 0 && !state.amountMismatch ? 'is-success' : paid > 0 ? 'is-warning' : 'is-neutral') + '">' +
    (state.amountMismatch ? 'Расхождение суммы' : remaining <= 0 ? 'Оплачено' : paid > 0 ? 'Частично оплачено' : 'Не оплачено') + '</span><div style="font-size:11px;margin-top:5px">Остаток: ' + woCurrency(remaining) + '</div>' +
    '<button type="button" class="btn btn-ghost btn-sm" onclick="woOpenPayment(' + htmlJs(linked[0].id) + ')">Счёт и оплаты</button>';
}
function woOpen(section, id) {
  const r = woFind(section, id);
  if (!r) { showToast('Заявка не найдена'); return; }
  const object = r.vehicleId ? (data.vehicles || []).find(v => v.id === r.vehicleId) : (data.generators || []).find(g => g.id === r.generatorId);
  const days = woDowntime(r, todayIso());
  const value = (label, text) => '<div style="padding:7px 0"><strong>' + label + '</strong><div style="white-space:pre-wrap;overflow-wrap:anywhere">' + htmlEsc(text || '—') + '</div></div>';
  openGenericModal(section === 'repairs' ? 'Заявка на ремонт' : 'Заявка на ТО', '<div>' + woBadge(r) + '</div>' +
    value('Техника', object?.plate || object?.name) + value('Работы', r.workDescription || r.description || r.type) + value('Материалы', r.materials) +
    value('Исполнитель', r.performer) + value('Сервис / подрядчик', r.serviceCenter) + value('Ожидаемая готовность', r.expectedReady ? fmtDate(r.expectedReady) : '') +
    value('Простой', days != null ? fmtDate(r.downtimeStart) + ' — ' + (r.downtimeEnd ? fmtDate(r.downtimeEnd) : 'продолжается') + ' · ' + days + ' дн.' : '') +
    value('Стоимость', woCurrency(r.cost)) + woPaymentSourceHtml(r, section) + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">' +
    '<button type="button" class="btn btn-ghost" onclick="woEdit(' + htmlJs(section) + ',' + htmlJs(id) + ')">Редактировать заявку</button>' +
    (woStatus(r) === 'assigned' ? '<button type="button" class="btn btn-primary" onclick="woSetStatus(' + htmlJs(section) + ',' + htmlJs(id) + ',\'in_progress\')">Начать работы</button>' : '') +
    (woStatus(r) !== 'completed' ? '<button type="button" class="btn btn-primary" onclick="woSetStatus(' + htmlJs(section) + ',' + htmlJs(id) + ',\'completed\')">Завершить работы</button>' : '') + '</div>', 720);
}
function woEdit(section, id) {
  closeModal('genericModal');
  if (section === 'repairs') openEditRepair(id); else tssEditRecord(id, section);
}
async function woSetStatus(section, id, status) {
  const record = woFind(section, id);
  if (!record) return;
  const before = JSON.stringify(data);
  try {
    const fields = { workStatus: status, expectedReady: record.expectedReady || null, downtimeStart: record.downtimeStart || null, downtimeEnd: record.downtimeEnd || null };
    if (status === 'in_progress') { fields.downtimeStart ||= todayIso(); fields.downtimeEnd = null; }
    Object.assign(record, woFinishRecord(record, woApplyFields(record, fields, section, todayIso()), section, todayIso()));
    if (!await saveData(data, { history: { action: 'Изменение состояния заявки' } })) { data = JSON.parse(before); rebuildIndex(); return; }
    woRefresh(); woOpen(section, id);
  } catch (error) { data = JSON.parse(before); rebuildIndex(); showToast(error.message); }
}
function woRefresh() {
  if (activeSection === 'toSchedule') renderToScheduleSection();
  else if (activeSection === 'finances') renderFinancesSection();
  else if (activeSection === 'vehicles' && selectedVehicleId) { const v = data.vehicles.find(v => v.id === selectedVehicleId); if (v) renderDetail(v); }
  else if (activeSection === 'generators' && selectedGeneratorId) selectGenerator(selectedGeneratorId);
  if (document.getElementById('repairsJournalModal')?.classList.contains('open')) renderRepairsJournal();
}
async function woEnsurePayment(section, id) {
  const existing = woLinkedPayments(data, section, id);
  if (existing.length) { woOpenPayment(existing[0].id); return; }
  const before = JSON.stringify(data);
  try {
    const invoice = woInvoiceFromSource(data, section, id, newId('pay'), todayIso());
    (data.payments || (data.payments = [])).push(invoice);
    if (!await saveData(data, { history: { action: 'Счёт по заявке' } })) { data = JSON.parse(before); rebuildIndex(); return; }
    woOpenPayment(invoice.id);
  } catch (error) { showToast(error.message); }
}
function woOpenPayment(id) {
  closeModal('genericModal');
  for (const modal of ['repairModal', 'vehicleToModal', 'toScheduleModal', 'toModal', 'repairsJournalModal']) if (document.getElementById(modal)?.classList.contains('open')) closeModal(modal);
  openEditPayment(id);
}
function woDeleteAllowed(section, id) {
  if (!woLinkedPayments(data, section, id).length) return true;
  showToast('У заявки есть связанный счёт. Сначала удалите счёт или сохраните заявку для истории.'); return false;
}
function woPaymentFormMount(payment) {
  const body = document.querySelector('#paymentModal .modal-body');
  if (!body) return;
  let panel = document.getElementById('pay_work_order');
  if (!panel) { panel = document.createElement('div'); panel.id = 'pay_work_order'; body.appendChild(panel); }
  const p = payment || { sum: 0, paid: false }, state = woPaymentState(p, data, todayIso());
  panel._woBaseline = JSON.parse(JSON.stringify(p));
  panel.innerHTML = '<div class="form-row"><div class="form-group"><label for="pay_due_date">Срок оплаты</label><input type="date" id="pay_due_date" value="' + htmlEsc(p.dueDate || '') + '"></div>' +
    '<div class="form-group"><label for="pay_paid_amount">Оплачено всего, ₽</label><input type="number" min="0" step="0.01" id="pay_paid_amount" value="' + state.paidAmount + '" oninput="woPaymentAmountChanged()"></div></div>' +
    (state.sourceSection ? '<div style="padding:10px;border:1px solid var(--border);border-radius:7px;margin:10px 0">' +
      (state.sourceMissing ? '<span class="workspace-badge is-danger">Связанная заявка не найдена</span>' : 'Связана с заявкой: ' + htmlEsc(state.source.description || state.source.type || 'Ремонт / ТО') +
      ' · стоимость ' + woCurrency(state.sourceCost) + '<button type="button" class="btn btn-ghost btn-sm" onclick="closeModal(\'paymentModal\');woOpen(' + htmlJs(state.sourceSection) + ',' + htmlJs(p.sourceId) + ')">Открыть заявку</button>') +
      (state.amountMismatch ? '<p class="gsm-error">Сумма счёта ' + woCurrency(p.sum) + ' отличается от заявки ' + woCurrency(state.sourceCost) + '. Проверьте документы.</p><button type="button" class="btn btn-ghost btn-sm" onclick="woAlignPaymentForm()">Взять сумму из заявки</button>' : '') +
      (state.duplicateLink ? '<p class="gsm-error">К заявке привязано несколько счетов. Проверьте дубли.</p>' : '') + '</div>' : '') +
    (p.id ? '<div style="margin:12px 0">Осталось оплатить: <strong>' + woCurrency(state.balance) + '</strong>' + (state.overdue ? ' <span class="workspace-badge is-danger">Срок просрочен</span>' : '') +
      (state.balance > 0 ? ' <button type="button" class="btn btn-ghost btn-sm" onclick="woPaymentDialog(' + htmlJs(p.id) + ')">Внести оплату</button>' : '') + '</div>' +
      ((p.settlements || []).length ? '<details><summary>Внесённые оплаты (' + p.settlements.length + ')</summary>' + p.settlements.map(s => '<p>' + htmlEsc(fmtDate(s.date)) + ' · ' + woCurrency(s.amount) + ' · ' + htmlEsc(s.note || '') + '</p>').join('') + '</details>' : '') : '');
  const check = document.getElementById('pay_paid');
  check.onchange = () => { document.getElementById('pay_paid_amount').value = check.checked ? document.getElementById('pay_sum').value || 0 : 0; };
}
function woPaymentAmountChanged() {
  const amount = Number(document.getElementById('pay_paid_amount').value), sum = Number(document.getElementById('pay_sum').value);
  document.getElementById('pay_paid').checked = sum > 0 && amount >= sum;
}
function woAlignPaymentForm() {
  const payment = (data.payments || []).find(p => p.id === editingPaymentId), source = payment && woSource(payment, data);
  if (!source) return;
  document.getElementById('pay_sum').value = woMoney(source.cost); woPaymentAmountChanged();
}
function woPaymentFormRead(sum) {
  const dueDate = document.getElementById('pay_due_date')?.value || null;
  if (dueDate && !woValidDate(dueDate)) throw Error('Укажите действительный срок оплаты');
  const input = document.getElementById('pay_paid_amount');
  if (input && (!Number.isFinite(Number(input.value)) || Number(input.value) < 0 || woMoney(input.value) > woMoney(sum))) throw Error('Оплаченная сумма должна быть от нуля до суммы счёта');
  const paidAmount = document.getElementById('pay_paid').checked ? woMoney(sum) : input ? Number(input.value) : 0;
  if (!Number.isFinite(paidAmount) || paidAmount < 0 || woMoney(paidAmount) > woMoney(sum)) throw Error('Оплаченная сумма должна быть от нуля до суммы счёта');
  return { dueDate, paidAmount: woMoney(paidAmount), paid: woMoney(sum) > 0 && woMoney(paidAmount) === woMoney(sum) };
}
function woPaymentDialog(id) {
  const p = (data.payments || []).find(p => p.id === id);
  if (!p) return;
  closeModal('paymentModal');
  openGenericModal('Внести оплату', '<p>Счёт ' + htmlEsc(p.invoiceNo || 'без номера') + ' · остаток ' + woCurrency(woPaymentBalance(p)) + '</p>' +
    '<div class="form-row"><div class="form-group"><label for="wo_settlement_date">Дата оплаты</label><input type="date" id="wo_settlement_date" value="' + todayIso() + '"></div>' +
    '<div class="form-group"><label for="wo_settlement_amount">Сумма оплаты, ₽</label><input type="number" id="wo_settlement_amount" min="0.01" step="0.01" value="' + woPaymentBalance(p) + '"></div></div>' +
    '<div class="form-group"><label for="wo_settlement_note">Основание / примечание</label><input id="wo_settlement_note" type="text" placeholder="Номер платёжного поручения"></div><button type="button" class="btn btn-primary" onclick="woSaveSettlement(' + htmlJs(id) + ')">Сохранить оплату</button>', 580);
}
async function woSaveSettlement(id) {
  const p = (data.payments || []).find(p => p.id === id);
  if (!p) return;
  const before = JSON.stringify(data);
  try {
    Object.assign(p, woAddSettlement(p, { id: newId('settle'), date: document.getElementById('wo_settlement_date').value,
      amount: document.getElementById('wo_settlement_amount').value, note: document.getElementById('wo_settlement_note').value }));
    const section = woSourceSection(p, data); if (section) woSyncSourcePaid(data, section, p.sourceId);
    if (!await saveData(data, { history: { action: 'Оплата счёта' } })) { data = JSON.parse(before); rebuildIndex(); return; }
    closeModal('genericModal'); woRefresh(); woOpenPayment(id);
  } catch (error) { data = JSON.parse(before); rebuildIndex(); showToast(error.message); }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { woStatus, woMoney, woValidDate, woSourceSection, woSource, woLinkedPayments, woPaidAmount, woPaymentBalance, woPaymentState, woValidateFields, woApplyFields, woDowntime, woFinishRecord, woSyncSourcePaid, woSourceBalance, woInvoiceFromSource, woAddSettlement, woKeepPlanned };
