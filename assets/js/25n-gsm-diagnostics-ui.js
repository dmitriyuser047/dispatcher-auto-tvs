// Read-only diagnosis view. All edits use the existing manual source forms.
let gsmDiagnosticsModel = null, gsmDiagnosticsSearch = '', gsmDiagnosticsCategory = 'all', gsmDiagnosticsLimit = 30;
let gsmDiagnosticsRefs = [], gsmDiagnosticsVehicleReturn = false, gsmOrphanState = null, gsmOrphanPending = null, gsmOrphanSaving = false;
const GSM_DIAGNOSTIC_CATEGORIES = { error: 'Ошибки учёта', evidence: 'Нужны документы', warning: 'Предупреждения' };
const GSM_DIAGNOSTIC_REF_TYPES = new Set(['purchase', 'record', 'vehicle', 'card', 'journal', 'opening', 'period', 'receipts', 'monthly', 'orphan-record']);

function gsmOpenDiagnostics() { fpView = 'diagnostics'; renderFuelPurchases(); }
function gsmDiagnosticsVisible(item) {
  const organizations = [item.org, ...(item.orgs || [])].filter(Boolean);
  return (!gsmOrg || !organizations.length || organizations.some(org => gsmOrgKey(org) === gsmOrgKey(gsmOrg))) &&
    (!gsmFuel || item.grade === gsmFuel || item.family && item.family === gsmFamily(gsmFuel));
}
function gsmDiagnosticsBaseItems() { return (gsmDiagnosticsModel?.items || []).filter(gsmDiagnosticsVisible); }
function gsmDiagnosticsFilteredItems() {
  const query = gsmDiagnosticsSearch.trim().toLocaleLowerCase('ru').replace(/ё/g, 'е');
  return gsmDiagnosticsBaseItems().filter(item => {
    if (gsmDiagnosticsCategory !== 'all' && item.category !== gsmDiagnosticsCategory) return false;
    if (!query) return true;
    return [item.title, item.message, item.whatToCheck, item.observedDate, item.observedDate ? fmtDate(item.observedDate) : '', item.earliestCauseDate, item.earliestCauseDate ? fmtDate(item.earliestCauseDate) : '', item.org, ...(item.orgs || []), item.grade,
      fpVehicleTitle(gsmVehicle(item.vehicleId)), ...(item.sourceRefs || []).flatMap(ref => [ref.label, ref.cardNo, ref.date])]
      .join(' ').toLocaleLowerCase('ru').replace(/ё/g, 'е').includes(query);
  });
}
function gsmDiagnosticsRefButton(ref, fallbackLabel) {
  if (!ref || !GSM_DIAGNOSTIC_REF_TYPES.has(ref.type)) return '';
  const index = gsmDiagnosticsRefs.push({ ...ref }) - 1;
  const label = (ref.label || fallbackLabel || 'Открыть источник') + (['purchase', 'record'].includes(ref.type) && ref.date ? ' · ' + fmtDate(ref.date) : '');
  return '<button type="button" class="btn btn-ghost btn-sm" data-audit-ref="' + fpEsc(ref.type) + '" onclick="gsmDiagnosticsOpenRef(' + index + ')">' + fpEsc(label) + '</button>';
}
function gsmDiagnosticsImpactHtml(impact) {
  if (!impact) return '';
  const parts = [], numeric = value => typeof value === 'number' && Number.isFinite(value);
  if (numeric(impact.qty)) parts.push('<span>Объём: <strong>' + fpNum(impact.qty, 3) + ' л</strong></span>');
  if (numeric(impact.opening)) parts.push('<span>Входящий: <strong>' + fpNum(impact.opening, 3) + ' л</strong></span>');
  if (numeric(impact.closing)) parts.push('<span>На конец: <strong>' + fpNum(impact.closing, 3) + ' л</strong></span>');
  return parts.length ? '<div class="gsm-audit-impact">' + parts.join('') + '</div>' : '';
}
function gsmDiagnosticsChronologyHtml(item) {
  const chronology = (item.chronology || []).slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))), total = item.chronologyCount || chronology.length;
  if (!chronology.length) return '';
  const rows = chronology.map(event => '<tr><td class="gsm-date">' + fpEsc(event.date ? fmtDate(event.date) : 'Начало учёта') + '</td>' + gsmCell(event.title || 'Операция') +
    (typeof event.qty === 'number' ? gsmCell(event.qty, true) : gsmCell('—')) + (typeof event.balance === 'number' ? gsmCell(event.balance, true) : gsmCell('—')) +
    '<td>' + (event.sourceRefs || []).map(ref => gsmDiagnosticsRefButton(ref)).join('') + '</td></tr>');
  return '<details class="gsm-audit-chronology"><summary>Откуда пришёл остаток <span>' + total + ' событий' + (item.earliestCauseDate ? ' · причина с ' + fpEsc(fmtDate(item.earliestCauseDate)) : '') + '</span></summary>' +
    (total > chronology.length ? '<p class="gsm-overview-note">Показано ' + chronology.length + ' из ' + total + ' событий. Полная история доступна в журнале машины.</p>' : '') +
    gsmTable(['Дата', 'Событие', 'Объём, л', 'Остаток дня, л', 'Источник'], rows) + '</details>';
}
function gsmDiagnosticsItemHtml(item) {
  const category = Object.hasOwn(GSM_DIAGNOSTIC_CATEGORIES, item.category) ? item.category : 'warning';
  const vehicle = gsmVehicle(item.vehicleId), context = [vehicle ? fpVehicleTitle(vehicle) : '', item.org || (item.orgs || []).join(', '), item.grade].filter(Boolean);
  const sourceRefs = (item.sourceRefs || []).filter(ref => GSM_DIAGNOSTIC_REF_TYPES.has(ref.type));
  const repairRefs = (item.repairRefs || []).filter(ref => GSM_DIAGNOSTIC_REF_TYPES.has(ref.type));
  return '<article class="gsm-audit-item is-' + category + '" data-audit-id="' + fpEsc(item.id) + '" data-audit-code="' + fpEsc(item.code) + '" data-audit-category="' + category + '">' +
    '<div class="gsm-audit-item-heading"><h3>' + fpEsc(item.title || item.message || 'Проверка источника') + '</h3><span class="gsm-audit-category">' + GSM_DIAGNOSTIC_CATEGORIES[category] + '</span></div>' +
    (context.length ? '<p class="gsm-audit-context">' + context.map(fpEsc).join(' · ') + '</p>' : '') +
    '<div class="gsm-audit-dates">' + (item.observedDate ? '<span>Проверяемая дата: ' + fpEsc(fmtDate(item.observedDate)) + '</span>' : '<span>Дата первоисточника не указана</span>') +
    (item.earliestCauseDate && item.earliestCauseDate !== item.observedDate ? '<span>Первая причина: ' + fpEsc(fmtDate(item.earliestCauseDate)) + '</span>' : '') + '</div>' +
    (item.message ? '<p class="gsm-audit-message">' + fpEsc(item.message) + '</p>' : '') + gsmDiagnosticsImpactHtml(item.impact) +
    (item.whatToCheck ? '<p class="gsm-audit-next"><strong>Что проверить:</strong> ' + fpEsc(item.whatToCheck) + '</p>' : '') +
    (repairRefs.length ? '<div class="gsm-audit-repairs">' + repairRefs.map(ref => gsmDiagnosticsRefButton(ref)).join('') + '</div>' : '') +
    (sourceRefs.length ? '<details class="gsm-audit-sources"><summary>Исходные записи <span>' + sourceRefs.length + '</span></summary><div class="gsm-audit-repairs">' + sourceRefs.map(ref => gsmDiagnosticsRefButton(ref)).join('') + '</div></details>' : '') +
    gsmDiagnosticsChronologyHtml(item) + '</article>';
}
function gsmDiagnosticsResultsHtml() {
  gsmDiagnosticsRefs = [];
  const items = gsmDiagnosticsFilteredItems(), shown = items.slice(0, gsmDiagnosticsLimit);
  return '<p class="gsm-audit-count" role="status">Показано ' + shown.length + ' из ' + items.length + ' замечаний</p>' +
    (shown.length ? shown.map(gsmDiagnosticsItemHtml).join('') : '<div class="gsm-overview-empty">Для выбранных фильтров замечаний нет.</div>') +
    (shown.length < items.length ? '<div class="gsm-show-more"><button type="button" class="btn btn-ghost" onclick="gsmDiagnosticsShowMore()">Показать ещё замечания</button></div>' : '');
}
function gsmRefreshDiagnostics() {
  const target = document.getElementById('gsmDiagnosticsResults');
  if (target) target.innerHTML = gsmDiagnosticsResultsHtml();
  document.querySelectorAll('[data-audit-filter]').forEach(button => {
    const active = button.dataset.auditFilter === gsmDiagnosticsCategory;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  const select = document.getElementById('gsmDiagnosticsCategory');
  if (select) select.value = gsmDiagnosticsCategory;
}
function gsmSetDiagnosticsSearch(value) { gsmDiagnosticsSearch = String(value || ''); gsmDiagnosticsLimit = 30; gsmRefreshDiagnostics(); }
function gsmSetDiagnosticsCategory(value) { gsmDiagnosticsCategory = value === 'all' || Object.hasOwn(GSM_DIAGNOSTIC_CATEGORIES, value) ? value : 'all'; gsmDiagnosticsLimit = 30; gsmRefreshDiagnostics(); }
function gsmDiagnosticsShowMore() { gsmDiagnosticsLimit += 30; gsmRefreshDiagnostics(); }
function gsmDiagnosticsHtml(ledger) {
  if (typeof gsmAuditModel !== 'function') return '<p class="gsm-status">Модуль расчёта проверки данных не подключён.</p>';
  const background=typeof gsmBackgroundRequired==='function'&&gsmBackgroundRequired(),prepared=background?gsmPreparedWorkspace()?.audit:null;
  if(background&&!prepared){gsmDiagnosticsModel=null;return '<p class="gsm-status" role="status">Проверка ГСМ не готова или источники изменились. Обновите расчёт.</p>';}
  gsmDiagnosticsModel = background ? prepared : gsmAuditModel(data, { ...gsmMonthRange(fpMonth), ledger });
  const items = gsmDiagnosticsBaseItems(), count = category => items.filter(item => item.category === category).length;
  return '<section class="gsm-diagnostics" id="gsmDiagnostics" aria-label="Проверка данных ГСМ"><div class="gsm-audit-intro"><h3>Проверка данных ГСМ</h3><p>' +
    fpEsc([fpMonthLabel(fpMonth), gsmOrg || 'Все организации', gsmFuel || 'Все марки топлива'].join(' · ')) + '</p><p>Откройте первоисточник и внесите подтверждённую правку вручную. Проверка пересчитывается после сохранения. Открытие проверки ничего не меняет.</p></div>' +
    '<div class="gsm-audit-summary">' + Object.entries(GSM_DIAGNOSTIC_CATEGORIES).map(([category, label]) => '<button type="button" class="gsm-audit-summary-card is-' + category + (gsmDiagnosticsCategory === category ? ' active' : '') + '" data-audit-filter="' + category + '" aria-pressed="' + (gsmDiagnosticsCategory === category) + '" onclick="gsmSetDiagnosticsCategory(' + gsmArg(category) + ')"><span>' + label + '</span><strong>' + count(category) + '</strong></button>').join('') + '</div>' +
    '<div class="gsm-movement-filters gsm-audit-filters"><label class="gsm-movement-search"><span>Найти причину</span><input type="search" aria-label="Поиск проверок ГСМ" placeholder="Машина, организация, причина, дата…" value="' + fpEsc(gsmDiagnosticsSearch) + '" oninput="gsmSetDiagnosticsSearch(this.value)"></label>' +
    '<label><span>Категория проверки</span><select id="gsmDiagnosticsCategory" class="fsel" aria-label="Категория проверки" onchange="gsmSetDiagnosticsCategory(this.value)">' + [['all', 'Все замечания'], ...Object.entries(GSM_DIAGNOSTIC_CATEGORIES)].map(([value, label]) => '<option value="' + value + '"' + (gsmDiagnosticsCategory === value ? ' selected' : '') + '>' + label + '</option>').join('') + '</select></label></div>' +
    '<div id="gsmDiagnosticsResults">' + gsmDiagnosticsResultsHtml() + '</div></section>';
}
function gsmDiagnosticsOpenRef(index) {
  if (!Number.isInteger(index)) return;
  const ref = gsmDiagnosticsRefs[index];
  if (!ref || !GSM_DIAGNOSTIC_REF_TYPES.has(ref.type)) return;
  const vid = ref.vehicleId || (ref.type === 'vehicle' || ref.type === 'opening' || ref.type === 'journal' ? ref.id : '');
  if (ref.type === 'purchase') {
    const purchase = fpById(ref.id);
    if (purchase && !purchase.deleted) fpEdit(purchase.id); else showToast('Покупка не найдена или уже удалена. Обновите проверку.');
  } else if (ref.type === 'record') {
    const record = (data.records || []).find(row => row.id === ref.id);
    if (!record) { showToast('Запись журнала не найдена. Обновите проверку.'); return; }
    if (record.fuelMovementId) {
      fpOpenJournal(record.vehicleId, (record.date || '').slice(0, 7));
      showToast('Выдача связана с движением топлива. Она корректируется отдельным движением.');
    } else gsmEditRecord(record.id);
  } else if (ref.type === 'vehicle') {
    if (!gsmVehicle(vid)) { showToast('Машина не найдена. Обновите проверку.'); return; }
    gsmDiagnosticsVehicleReturn = true; openEditVehicle(vid);
  } else if (ref.type === 'opening') {
    if (gsmVehicle(vid)) fuelAccountingOpen('vehicles',vid); else showToast('Машина не найдена. Обновите проверку.');
  } else if (ref.type === 'card') {
    const card = fcList().find(row => row.id === ref.id) || fcByNumber(ref.cardNo || ref.id);
    fcEdit(card?.id || '');
    if (!card && ref.cardNo) document.getElementById('fc_number').value = ref.cardNo;
  } else if (ref.type === 'journal') {
    const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(ref.month || '') ? ref.month : gsmValidDate(ref.date) ? ref.date.slice(0, 7) : fpMonth === 'all' ? '' : fpMonth;
    if (gsmVehicle(vid)) fpOpenJournal(vid, month);
    else showToast('Машина не найдена. Обновите проверку.');
  } else if (ref.type === 'period') {
    const month = ref.month || ref.id;
    if (!/^\d{4}-\d{2}$/.test(month || '')) return;
    if (fuelMonthClosed(month)) fcReopen(month);
    else { fpMonth = month; fpView = 'close'; renderFuelPurchases(); }
  } else if (ref.type === 'receipts') {
    if (/^\d{4}-\d{2}$/.test(ref.month || '')) fpMonth = ref.month;
    fpView = 'receipts'; renderFuelPurchases();
  } else if (ref.type === 'monthly') {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ref.month || '')) return;
    fpMonth = ref.month; fpView = 'monthly'; renderFuelPurchases();
  } else if (ref.type === 'orphan-record') {
    void gsmOpenOrphanRecord(ref.id);
  }
}
function gsmOrphanRelatedPurchases(id) { return (data.fuelPurchases || []).filter(row => row.recordId === id); }
async function gsmOrphanIdentity() {
  if (window.electronAPI?.getDataIdentity) {
    const identity = await window.electronAPI.getDataIdentity();
    if (typeof identity !== 'string' || !identity) throw Error('Не удалось подтвердить открытую базу. Откройте проверку заново.');
    return identity;
  }
  return JSON.stringify([typeof localCacheKey === 'undefined' ? null : localCacheKey, typeof _sync === 'undefined' ? null : _sync.databaseToken]);
}
function gsmOrphanCurrent(state) {
  if (!state || data !== state.databaseRef) throw Error('База изменилась. Откройте проверку заново.');
  const record = (data.records || []).find(row => row.id === state.recordId);
  if (!record || JSON.stringify(record) !== state.recordJson) throw Error('Исходная запись уже изменена. Откройте проверку заново.');
  if (gsmVehicle(record.vehicleId)) throw Error('У записи уже есть существующая машина. Откройте проверку заново.');
  return record;
}
function gsmOrphanSourceHtml(record) {
  const value = key => record[key] == null || record[key] === '' ? 'не указано' : String(record[key]);
  return '<div class="gsm-audit-impact"><span>Дата: <strong>' + fpEsc(fmtDate(record.date)) + '</strong></span><span>Пробег: <strong>' + fpEsc(value('km')) + ' км</strong></span>' +
    '<span>Поступило: <strong>' + fpEsc(value('fuelIssued')) + ' л</strong></span><span>Расход: <strong>' + fpEsc(value('fuelActual')) + ' л</strong></span><span>Замер: <strong>' + fpEsc(value('tankMeasured')) + ' л</strong></span></div>';
}
function gsmRenderOrphanForm(state) {
  const record = gsmOrphanCurrent(state), purchases = gsmOrphanRelatedPurchases(record.id).filter(row => !row.deleted);
  const options = (data.vehicles || []).slice().sort((a, b) => fpVehicleTitle(a).localeCompare(fpVehicleTitle(b), 'ru'));
  openGenericModal('Выбрать машину для записи журнала', '<div class="gsm-orphan-form"><p>Машина исходной записи не найдена. Выберите существующую карточку по первичному документу. Поля пробега, топлива, замера и даты сохранятся.</p>' + gsmOrphanSourceHtml(record) +
    '<p class="gsm-overview-note">Связанных покупок: <strong>' + purchases.length + '</strong>. Покупки не будут перенесены. Проверьте их получателя отдельно.</p><div class="form-group"><label for="gsm_orphan_vehicle">Существующая машина</label><select id="gsm_orphan_vehicle"><option value="">Выберите машину</option>' +
    options.map(vehicle => '<option value="' + fpEsc(vehicle.id) + '"' + (state.targetId === vehicle.id ? ' selected' : '') + '>' + fpEsc(fpVehicleTitle(vehicle) + (vehicle.org ? ' · ' + vehicle.org : '') + (vehicle.archived ? ' · архив' : '')) + '</option>').join('') + '</select></div>' +
    '<div class="form-group"><label for="gsm_orphan_reason">Основание привязки</label><textarea id="gsm_orphan_reason" rows="3" placeholder="Документ и причина выбора машины">' + fpEsc(state.reason || '') + '</textarea></div>' +
    '<div id="gsmOrphanError" class="gsm-error" role="alert"></div><div class="gsm-actions"><button type="button" class="btn btn-ghost" onclick="closeModal(\'genericModal\')">Отмена</button><button type="button" id="gsmOrphanPreview" class="btn btn-primary" onclick="gsmOrphanReview()">Предпросмотр привязки</button></div></div>', 720);
}
async function gsmOpenOrphanRecord(id) {
  if (gsmOrphanSaving) return;
  const record = (data.records || []).find(row => row.id === id);
  if (!record || gsmVehicle(record.vehicleId)) { showToast('Запись не найдена или её машина уже существует. Обновите проверку.'); return; }
  if (!fuelEditAllowed(record.date)) return;
  const state = { databaseRef: data, recordId: id, recordJson: JSON.stringify(record), targetId: '', reason: '' }, section = activeSection, view = fpView;
  try {
    state.identity = await gsmOrphanIdentity();
    if (activeSection !== section || fpView !== view) return;
    gsmOrphanCurrent(state); gsmOrphanState = state; gsmOrphanPending = null; gsmRenderOrphanForm(state);
  } catch (error) { showToast(error.message); }
}
async function gsmOrphanReview() {
  const error = document.getElementById('gsmOrphanError'), button = document.getElementById('gsmOrphanPreview');
  if (!button || button.disabled || gsmOrphanSaving) return;
  button.disabled = true;
  try {
    const state = gsmOrphanState, record = gsmOrphanCurrent(state);
    state.targetId = document.getElementById('gsm_orphan_vehicle').value;
    state.reason = document.getElementById('gsm_orphan_reason').value.trim();
    const vehicle = gsmVehicle(state.targetId);
    if (!vehicle || !state.reason) throw Error('Выберите существующую машину и укажите основание привязки.');
    if (!fuelEditAllowed(record.date)) return;
    if (await gsmOrphanIdentity() !== state.identity) throw Error('Открытая база изменилась. Откройте проверку заново.');
    if (!button.isConnected || !document.getElementById('genericModal')?.classList.contains('open')) return;
    gsmOrphanCurrent(state);
    gsmOrphanPending = { ...state, targetJson: JSON.stringify(vehicle), purchasesJson: JSON.stringify(gsmOrphanRelatedPurchases(record.id)) };
    const purchaseCount = gsmOrphanRelatedPurchases(record.id).filter(row => !row.deleted).length;
    openGenericModal('Предпросмотр привязки записи', '<div class="gsm-orphan-preview"><h3>' + fpEsc(fpVehicleTitle(vehicle)) + '</h3><p>Будет изменена только ссылка на машину этой записи. Пробег, литры, замер, дата и все покупки сохранятся.</p>' + gsmOrphanSourceHtml(record) +
      '<p><strong>Основание:</strong> ' + fpEsc(state.reason) + '</p><p class="gsm-overview-note">Связанных покупок: <strong>' + purchaseCount + '</strong>. Они останутся у прежнего получателя и требуют отдельной проверки.</p>' +
      '<div id="gsmOrphanError" class="gsm-error" role="alert"></div><div class="gsm-actions"><button type="button" class="btn btn-ghost" onclick="gsmOrphanBack()">Назад</button><button type="button" class="btn btn-ghost" onclick="closeModal(\'genericModal\')">Отмена</button><button type="button" id="gsmOrphanCommit" class="btn btn-primary" onclick="gsmOrphanCommit()">Применить привязку</button></div></div>', 720);
  } catch (failure) { if (error) error.textContent = failure.message; }
  finally { if (button.isConnected) button.disabled = false; }
}
function gsmOrphanBack() { try { gsmRenderOrphanForm(gsmOrphanState); } catch (failure) { showToast(failure.message); } }
async function gsmOrphanCommit() {
  const button = document.getElementById('gsmOrphanCommit'), error = document.getElementById('gsmOrphanError');
  if (!button || !document.getElementById('genericModal')?.classList.contains('open') || gsmOrphanSaving || !gsmOrphanPending) return;
  gsmOrphanSaving = true; button.disabled = true;
  try {
    const plan = gsmOrphanPending, record = gsmOrphanCurrent(plan), vehicle = gsmVehicle(plan.targetId);
    if (!vehicle || JSON.stringify(vehicle) !== plan.targetJson || JSON.stringify(gsmOrphanRelatedPurchases(record.id)) !== plan.purchasesJson) throw Error('Машина или связанные покупки уже изменены. Откройте проверку заново.');
    if (!fuelEditAllowed(record.date)) return;
    if (await gsmOrphanIdentity() !== plan.identity) throw Error('Открытая база изменилась. Откройте проверку заново.');
    if (!button.isConnected || !document.getElementById('genericModal')?.classList.contains('open')) return;
    gsmOrphanCurrent(plan);
    if (!fuelEditAllowed(record.date)) return;
    if (JSON.stringify(gsmVehicle(plan.targetId)) !== plan.targetJson || JSON.stringify(gsmOrphanRelatedPurchases(record.id)) !== plan.purchasesJson) throw Error('Данные изменены во время проверки. Откройте проверку заново.');
    const next = JSON.parse(JSON.stringify(data)), rollback = captureSaveRollback(data,next), at = new Date().toISOString();
    next.records.find(row => row.id === plan.recordId).vehicleId = plan.targetId;
    (next.appMeta || (next.appMeta = [])).push({ id: 'gsm-record-link:' + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36)), rowType: 'gsm-record-vehicle-correction', recordId: plan.recordId,
      fromVehicleId: record.vehicleId || '', toVehicleId: plan.targetId, reason: plan.reason, at });
    data = next; rebuildIndex();
    let saved;
    try { saved = await saveData(data, { noMerge: true, history: { action: 'Ручная привязка записи журнала', reason: plan.reason } }); }
    catch (failure) {
      if (restoreSaveRollback(rollback)) throw Error('Привязка не записана. Данные восстановлены: ' + failure.message);
      throw Error('Привязка не записана. База обновилась; откройте проверку заново. ' + failure.message);
    }
    if (!saved) {
      if (restoreSaveRollback(rollback)) throw Error('Привязка не записана. Данные восстановлены. Проверьте соединение и повторите.');
      throw Error('Привязка не записана. База обновилась; откройте проверку заново.');
    }
    gsmOrphanPending = null; gsmOrphanState = null; closeModal('genericModal'); renderFuelPurchases();
    showToast('Машина записи сохранена. Связанные покупки не переносились.');
  } catch (failure) { if (error?.isConnected) error.textContent = failure.message; }
  finally { gsmOrphanSaving = false; if (button.isConnected) button.disabled = false; }
}
// Vehicle save keeps its legacy transport renderer. Return to the diagnosis only
// after this view opened that form; cancellation follows the same read-only path.
if (typeof MutationObserver === 'function') {
  const modal = document.getElementById('vehicleModal');
  if (modal) new MutationObserver(() => {
    if (!gsmDiagnosticsVehicleReturn || modal.classList.contains('open')) return;
    gsmDiagnosticsVehicleReturn = false;
    queueMicrotask(() => { if (activeSection === 'fuelPurchases' && fpView === 'diagnostics') renderFuelPurchases(); });
  }).observe(modal, { attributes: true, attributeFilter: ['class'] });
}
