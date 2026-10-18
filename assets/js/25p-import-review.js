// Import planning is synchronous and isolated. No database write happens until
// the user applies the reviewed row diff; rollback uses ordinary versioned saves.
let _importReviewPending = null;
let _importReviewBusy = false;
let _importMapping = null;
const IMPORT_REVIEW_LABELS = { vehicles: 'Транспорт', records: 'Журнал транспорта', generators: 'ДЭС', genRecords: 'Журнал ДЭС',
  toRecords: 'ТО ДЭС', vehicleTo: 'ТО транспорта', tanks: 'Ёмкости', tankIncomes: 'Приход топлива', fuelPurchases: 'Покупки топлива', fuelImports: 'Загрузки выписок', fuelCards: 'Топливные карты' };
const IMPORT_FIELD_LABELS = { plate: 'Госномер', make: 'Марка', driver: 'Водитель', org: 'Организация', object: 'Объект', justification: 'Обоснование',
  responsible: 'Ответственный', status: 'Состояние', fuelcard: 'Топливная карта', fuel: 'Вид топлива', norm: 'Норма расхода', note: 'Примечание',
  date: 'Дата', time: 'Время', km: 'Пробег, км', fuelIssued: 'Выдано топлива, л', fuelActual: 'Фактический расход, л', fuelUsed: 'Расход по норме, л',
  fuelSum: 'Сумма заправки, ₽', fuelGrade: 'Марка топлива', vehicleId: 'Автомобиль', generatorId: 'Генератор', recordId: 'Запись журнала', importId: 'Пакет выписки',
  grade: 'Марка топлива', product: 'Товар', qty: 'Количество, л', price: 'Цена, ₽', sum: 'Сумма, ₽', cardNo: 'Номер карты', vehicleText: 'ТС в выписке',
  azs: 'АЗС', region: 'Регион', comment: 'Комментарий', sourceRow: 'Строка файла', sourceOrg: 'Организация карты', sourceProvider: 'Поставщик',
  cardVehicleId: 'Закрепление карты', fileName: 'Файл', mode: 'Вид загрузки', at: 'Время загрузки', rows: 'Операций', litres: 'Литры',
  added: 'Новых', duplicates: 'Уже загружено', skipped: 'Без машины', route: 'Маршрут', name: 'Название', location: 'Расположение',
  hours: 'Наработка, мтч', tankId: 'Ёмкость', balanceInit: 'Начальный остаток', capacity: 'Вместимость', deleted: 'Удалено',
  glonassAliases: 'Объекты ГЛОНАСС', kmGlonass: 'Пробег ГЛОНАСС, км', glonassFuel: 'Расход по датчику, л', glonassEngineH: 'Моточасы ГЛОНАСС',
  glonassIdleH: 'Холостой ход ГЛОНАСС, ч', odoStart: 'Одометр в начале', odoEnd: 'Одометр в конце' };
const IMPORT_VEHICLE_FIELDS = [
  ['make', 'Марка ТС', ['марка']], ['plate', 'Госномер', ['гос'], true], ['driver', 'Водитель', ['ф.и.о', 'фио', 'водител']],
  ['org', 'Организация', ['организац', 'исполнит']], ['object', 'Объект', ['объект']], ['justification', 'Обоснование', ['обоснован']],
  ['responsible', 'Ответственный', ['ответствен']], ['status', 'Состояние', ['состоян']], ['fuelcard', 'Топливная карта', ['топливн', 'карт']],
].map(([key, label, keywords, required]) => ({ key, label, keywords, required }));
const IMPORT_FUEL_FIELDS = [
  ['date', 'Дата операции', ['дата транзакц', 'дата'], true], ['qty', 'Количество, л', ['количество'], true],
  ['type', 'Тип операции', ['тип транзакц', 'тип операции']], ['fuel', 'Товар / топливо', ['товар']], ['comment', 'Комментарий', ['комментар', 'местонахождение']],
  ['card', 'Номер карты', ['номер карт']], ['vehicle', 'Автомобиль / закреплена', ['закреплена', 'тс', 'транспорт', 'авто']], ['price', 'Цена клиента', ['цена клиента', 'цена']],
  ['sum', 'Сумма клиента', ['сумма к оплате', 'сумма клиента']], ['supplier', 'Поставщик', ['поставщик']], ['azs', 'Номер АЗС', ['№ азс']],
  ['azsAddress', 'Адрес АЗС', ['адрес азс']], ['region', 'Регион', ['регион азс', 'регион']], ['city', 'Город АЗС', ['город азс']],
].map(([key, label, keywords, required]) => ({ key, label, keywords, required }));
async function importReviewDataIdentity() {
  if (window.electronAPI?.getDataIdentity) return String(await window.electronAPI.getDataIdentity());
  return 'browser:' + (typeof STORAGE_KEY !== 'undefined' ? STORAGE_KEY : 'current');
}
function importReviewClone(value) { return JSON.parse(JSON.stringify(value)); }
function importReviewCanonical(value) {
  if (Array.isArray(value)) return '[' + value.map(importReviewCanonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + importReviewCanonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function importReviewEqual(a, b) { return importReviewCanonical(a ?? null) === importReviewCanonical(b ?? null); }
function importReviewDiff(before, after) {
  const changes = [];
  for (const section of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (section === 'appMeta' || importReviewEqual(before[section], after[section])) continue;
    if (!Array.isArray(before[section] || []) || !Array.isArray(after[section] || [])) throw new Error('Импорт не поддерживает раздел ' + section);
    const index = rows => {
      const out = new Map();
      for (const row of rows || []) {
        if (!row || row.id == null || String(row.id) === '' || out.has(String(row.id))) throw new Error('В разделе «' + section + '» отсутствуют уникальные ID. Сначала проверьте базу.');
        out.set(String(row.id), row);
      }
      return out;
    };
    const a = index(before[section]), b = index(after[section]);
    for (const id of new Set([...a.keys(), ...b.keys()])) {
      const previous = a.get(id) || null, next = b.get(id) || null;
      if (!importReviewEqual(previous, next)) changes.push({ section, id, before: importReviewClone(previous), after: importReviewClone(next) });
    }
  }
  return changes;
}
function importReviewBuildPlan(meta, mutate) {
  if (_importReviewBusy || (typeof _activeSaves !== 'undefined' && _activeSaves)) throw new Error('Дождитесь завершения сохранения.');
  if (typeof mutate !== 'function' || mutate.constructor.name === 'AsyncFunction') throw new Error('Подготовка импорта должна быть синхронной.');
  const original = data, before = importReviewClone(original);
  const indexes = typeof recsByVid !== 'undefined' ? { recsByVid, genRecsByGid, vehicleToByVid, repairsByVid, _fuelBalCache, _genBalCache } : null;
  let result, after;
  try {
    data = importReviewClone(original);
    if (typeof rebuildIndex === 'function') rebuildIndex();
    result = mutate();
    if (result && typeof result.then === 'function') throw new Error('Подготовка импорта должна завершаться до сохранения.');
    after = importReviewClone(data);
  } finally {
    data = original;
    if (indexes) ({ recsByVid, genRecsByGid, vehicleToByVid, repairsByVid, _fuelBalCache, _genBalCache } = indexes);
    else if (typeof rebuildIndex === 'function') rebuildIndex();
  }
  const changes = importReviewDiff(before, after);
  return { id: newId('ib'), at: new Date().toISOString(), ...meta, changes, result,
    referencesBefore: importReviewReferences(before, changes), dependencies: importReviewDependencies(before, changes),
    naturalBefore: importReviewNaturalState(before, changes) };
}
function importReviewRowTitle(row) {
  if (!row) return '—';
  return [row.plate || row.make || row.name || row.fileName || row.date || row.id, row.vehicleId && fuelImportVehicleTitle(row.vehicleId)].filter(Boolean).join(' · ');
}
function importReviewValue(value) {
  if (value == null || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
function importReviewFieldValue(key, value) {
  if (value == null || value === '') return '—';
  const planned = _importReviewPending?.plan;
  if (key === 'vehicleId' || key === 'cardVehicleId') {
    const vehicle = (data.vehicles || []).find(row => row.id === value) || planned?.changes.find(row => row.section === 'vehicles' && row.id === String(value))?.after;
    return vehicle ? [vehicle.plate, vehicle.make].filter(Boolean).join(' — ') : 'Автомобиль не найден';
  }
  if (key === 'recordId') {
    const record = (data.records || []).find(row => row.id === value) || planned?.changes.find(row => row.section === 'records' && row.id === String(value))?.after;
    return record ? 'Журнал за ' + (typeof fmtDate === 'function' ? fmtDate(record.date) : record.date) : 'Запись журнала';
  }
  if (key === 'importId') return (data.fuelImports || []).find(row => row.id === value)?.fileName || planned?.fileName || 'Текущая выписка';
  if (key === 'fuel') return ({ diesel: 'Дизельное', gasoline: 'Бензин', gas: 'Газ' })[value] || importReviewValue(value);
  if (key === 'mode') return ({ fuel: 'Топливные карты', office: 'Машины офис' })[value] || importReviewValue(value);
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
  return importReviewValue(value);
}
function importReviewChangeHtml(change) {
  const fields = [...new Set([...Object.keys(change.before || {}), ...Object.keys(change.after || {})])]
    .filter(key => !['id', 'importKey', 'restored'].includes(key) && !importReviewEqual(change.before?.[key], change.after?.[key]));
  const escape = htmlEsc;
  return '<tr><td>' + escape(IMPORT_REVIEW_LABELS[change.section] || change.section) + '<small>' + escape(importReviewRowTitle(change.after || change.before)) + '</small></td>' +
    '<td>' + (!change.before ? 'Добавление' : !change.after ? 'Удаление' : 'Изменение') + '</td><td>' + fields.map(key => '<div><b>' + escape(IMPORT_FIELD_LABELS[key] || key) + '</b>: ' + escape(importReviewFieldValue(key, change.before?.[key])) + '</div>').join('') +
    '</td><td>' + fields.map(key => '<div><b>' + escape(IMPORT_FIELD_LABELS[key] || key) + '</b>: ' + escape(importReviewFieldValue(key, change.after?.[key])) + '</div>').join('') + '</td></tr>';
}
function importReviewPresent(plan, onApplied) {
  _importReviewPending = { plan, onApplied, page: 0 };
  const added = plan.changes.filter(row => !row.before).length, removed = plan.changes.filter(row => !row.after).length;
  const modified = plan.changes.length - added - removed;
  const notes = Array.isArray(plan.notes) ? plan.notes : [];
  openGenericModal('Проверка импорта: ' + (plan.title || plan.fileName || 'файл'),
    '<div id="importReviewSummary" role="status"><p>Данные ещё не сохранены. Проверьте изменения перед применением.</p><p style="margin-top:8px">Добавится: <b>' + added + '</b> · Изменится: <b>' + modified + '</b> · Удалится: <b>' + removed + '</b></p>' +
    notes.map(note => '<p style="margin-top:6px">' + htmlEsc(note) + '</p>').join('') + '</div>' +
    '<div class="gsm-table-scroll" style="max-height:45vh"><table class="gsm-table"><thead><tr><th>Раздел / строка</th><th>Действие</th><th>Было</th><th>Станет</th></tr></thead><tbody id="importReviewRows">' +
    (plan.changes.slice(0, 50).map(importReviewChangeHtml).join('') || '<tr><td colspan="4">Новых изменений нет.</td></tr>') + '</tbody></table></div>' +
    (plan.changes.length > 50 ? '<div class="gsm-actions"><button class="btn btn-ghost btn-sm" id="importReviewPrevious" onclick="importReviewPage(-1)" disabled>Предыдущие</button><span id="importReviewPageLabel">1–50 из ' + plan.changes.length + '</span><button class="btn btn-ghost btn-sm" id="importReviewNext" onclick="importReviewPage(1)">Следующие</button></div>' : '') +
    (plan.template ? '<p>Шаблон «' + htmlEsc(plan.template.name) + '» сохранится вместе с импортом. Отмена пакета не удаляет шаблон.</p>' : '') +
    '<div id="importReviewError" role="alert" class="gsm-error"></div><div class="gsm-actions"><button class="btn btn-ghost" onclick="importReviewCancel()">Отмена</button>' +
    '<button id="importReviewApply" class="btn btn-primary" onclick="importReviewApply()"' + (!plan.changes.length && !plan.template ? ' disabled' : '') + '>Применить импорт</button></div>', 1100);
}
function importReviewPage(delta) {
  const pending = _importReviewPending; if (!pending) return;
  const pages = Math.ceil(pending.plan.changes.length / 50);
  pending.page = Math.max(0, Math.min(pages - 1, (pending.page || 0) + delta));
  const start = pending.page * 50, end = Math.min(start + 50, pending.plan.changes.length);
  document.getElementById('importReviewRows').innerHTML = pending.plan.changes.slice(start, end).map(importReviewChangeHtml).join('');
  document.getElementById('importReviewPageLabel').textContent = (start + 1) + '–' + end + ' из ' + pending.plan.changes.length;
  document.getElementById('importReviewPrevious').disabled = pending.page === 0;
  document.getElementById('importReviewNext').disabled = pending.page >= pages - 1;
}
function importReviewCancel() { if (_importReviewBusy) return; _importReviewPending = null; closeModal('genericModal'); }
function importReviewClosedChanges(db, changes) {
  const protectedSections = new Set(['records', 'genRecords', 'fuelPurchases', 'monthlyFuel', 'tankIncomes']);
  const closed = new Set((db.fuelPeriods || []).filter(row => row.closed).map(row => row.month));
  return changes.filter(change => protectedSections.has(change.section) && [change.before, change.after].some(row => row && closed.has(String(row.date || row.month || '').slice(0, 7))));
}
function importReviewApplyChanges(db, changes, direction) {
  for (const change of changes) {
    const expected = direction === 'undo' ? change.after : change.before;
    const desired = direction === 'undo' ? change.before : change.after;
    const rows = db[change.section] || (db[change.section] = []), matches = rows.filter(row => String(row.id) === change.id);
    if (matches.length > 1 || !importReviewEqual(matches[0] || null, expected)) throw new Error('Строка «' + importReviewRowTitle(expected || desired) + '» изменена после подготовки пакета. Повторите проверку.');
    const index = rows.findIndex(row => String(row.id) === change.id);
    if (!desired) { if (index >= 0) rows.splice(index, 1); }
    else if (index < 0) rows.push(importReviewClone(desired));
    else rows[index] = importReviewClone(desired);
  }
}
function importReviewReferences(db, changes) {
  const ids = new Set(changes.map(change => change.id));
  const own = new Set(changes.map(change => change.section + ':' + change.id)), refs = {};
  const references = value => {
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).some(([key, child]) =>
      (/Ids?$/.test(key) && key !== 'id' && (Array.isArray(child) ? child.some(id => ids.has(String(id))) : child != null && ids.has(String(child)))) ||
      child && typeof child === 'object' && references(child));
  };
  for (const [section, rows] of Object.entries(db)) {
    if (section === 'appMeta' || !Array.isArray(rows)) continue;
    for (const row of rows) if (!own.has(section + ':' + row.id) && references(row)) {
      const key = section + ':' + (row.id ?? importReviewCanonical(row));
      refs[key] = importReviewCanonical(row);
    }
  }
  return refs;
}
function importReviewDependencies(db, changes) {
  const ids = new Set(), cards = new Set(), out = [];
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (/Id$/.test(key) && child != null) ids.add(String(child));
      if (key === 'cardNo' && child) cards.add(String(child).replace(/\D/g, ''));
      if (child && typeof child === 'object') visit(child);
    }
  };
  changes.forEach(change => { visit(change.before); visit(change.after); });
  const own = new Set(changes.map(change => change.section + ':' + change.id));
  for (const [section, rows] of Object.entries(db)) if (section !== 'appMeta' && Array.isArray(rows)) {
    for (const row of rows) if (!own.has(section + ':' + row.id) && (ids.has(String(row.id)) || section === 'fuelCards' && cards.has(String(row.number || '').replace(/\D/g, '')))) {
      out.push({ section, id: row.id ?? null, number: row.number ?? null, row: importReviewClone(row) });
    }
  }
  return out;
}
function importReviewNaturalState(db, changes) {
  const out = {};
  for (const change of changes.filter(row => !row.before && row.after)) {
    const field = change.section === 'vehicles' ? 'plate' : change.section === 'fuelPurchases' ? 'importKey' : null;
    if (!field || !change.after[field]) continue;
    const normalize = value => field === 'plate' ? String(value || '').replace(/[\s-]/g, '').toUpperCase() : String(value || '');
    const key = normalize(change.after[field]);
    out[change.section + ':' + key] = (db[change.section] || []).filter(row => normalize(row[field]) === key);
  }
  return importReviewClone(out);
}
function importReviewStoreTemplate(db, template) {
  if (!template) return;
  const list = db.appMeta || (db.appMeta = []), name = template.name.trim();
  const old = list.find(row => row.type === 'importTemplate' && row.kind === template.kind && row.name.toLowerCase() === name.toLowerCase());
  const saved = { ...importReviewClone(template), id: old?.id || newId('it'), type: 'importTemplate', at: new Date().toISOString() };
  if (old) list[list.indexOf(old)] = saved; else list.push(saved);
}
async function importReviewApply() {
  if (_importReviewBusy || !_importReviewPending) return false;
  if (typeof _activeSaves !== 'undefined' && _activeSaves) { showToast('Дождитесь завершения сохранения.'); return false; }
  const { plan, onApplied } = _importReviewPending;
  let original;
  let candidate;
  try {
    _importReviewBusy = true;
    if (plan.identity !== await importReviewDataIdentity()) throw new Error('Выбрана другая база. Загрузите файл заново в нужную базу.');
    original = data;
    if (!importReviewEqual(importReviewNaturalState(data, plan.changes), plan.naturalBefore)) throw new Error('После предпросмотра появились совпадающие строки. Повторите импорт для проверки дубликатов.');
    for (const dep of plan.dependencies || []) {
      const rows = (data[dep.section] || []).filter(row => dep.id != null ? String(row.id) === String(dep.id) : row.number === dep.number);
      if (rows.length !== 1 || !importReviewEqual(rows[0], dep.row)) throw new Error('Связанные данные изменились после предпросмотра. Загрузите файл заново.');
    }
    if (!importReviewEqual(importReviewReferences(data, plan.changes), plan.referencesBefore)) throw new Error('После предпросмотра изменились связанные записи. Загрузите файл заново.');
    if (importReviewClosedChanges(data, plan.changes).length) throw new Error('Пакет затрагивает закрытый месяц. Сначала проверьте закрытие периода.');
    candidate = importReviewClone(data);
    importReviewApplyChanges(candidate, plan.changes, 'apply');
    importReviewStoreTemplate(candidate, plan.template);
    (candidate.appMeta || (candidate.appMeta = [])).push({ id: plan.id, type: 'importBatch', format: 1, status: 'applied', at: plan.at,
      title: plan.title || '', fileName: plan.fileName || '', kind: plan.kind || '', changes: importReviewClone(plan.changes),
      references: importReviewReferences(candidate, plan.changes) });
    _importReviewBusy = true;
    const button = document.getElementById('importReviewApply'); if (button) button.disabled = true;
    data = candidate;
    if (!await saveData(data, { noMerge: true, history: { action: 'Импорт: ' + (plan.fileName || plan.title) } })) { data = original; rebuildIndex(); throw new Error('Пакет не сохранён. Проверьте соединение и повторите применение.'); }
    _importReviewPending = null;
  } catch (error) {
    if (candidate && data === candidate) { data = original; rebuildIndex(); }
    const message = document.getElementById('importReviewError'); if (message) message.textContent = error.message;
    else showToast(error.message);
    return false;
  } finally {
    _importReviewBusy = false;
    const button = document.getElementById('importReviewApply'); if (button) button.disabled = false;
  }
  closeModal('genericModal');
  if (typeof workspaceRefresh === 'function') workspaceRefresh();
  try { if (onApplied) await onApplied(plan.result); }
  catch (error) { showToast('Импорт сохранён, но экран не обновился: ' + error.message); return true; }
  showToast('Импорт сохранён. Отмена пакета доступна в истории импортов.');
  return true;
}
function importReviewUndoCheck(db, batch) {
  if (!batch || batch.type !== 'importBatch' || batch.status !== 'applied' || batch.format !== 1 || !Array.isArray(batch.changes)) throw new Error('Этот пакет недоступен для отмены.');
  const candidate = importReviewClone(db);
  importReviewApplyChanges(candidate, batch.changes, 'undo');
  if (importReviewClosedChanges(db, batch.changes).length) throw new Error('Отмена затрагивает закрытый месяц. Сначала откройте период.');
  if (!importReviewEqual(importReviewReferences(db, batch.changes), batch.references || {})) throw new Error('После импорта появились или изменились связанные записи. Отмена заблокирована, чтобы сохранить последующие правки.');
  return candidate;
}
async function importReviewUndo(id) {
  if (_importReviewBusy) return false;
  if (typeof _activeSaves !== 'undefined' && _activeSaves) { showToast('Дождитесь завершения сохранения.'); return false; }
  let original;
  _importReviewBusy = true;
  try {
    const identity = await importReviewDataIdentity(), batch = (data.appMeta || []).find(row => row.id === id);
    importReviewUndoCheck(data, batch);
    if (!await confirmAction('Отменить весь импорт «' + (batch.fileName || batch.title) + '»? Будут восстановлены только строки этого пакета.')) return false;
    if (identity !== await importReviewDataIdentity()) throw new Error('Выбрана другая база. Откройте историю заново.');
    original = data;
    const candidate = importReviewUndoCheck(data, batch);
    const target = candidate.appMeta.find(row => row.id === id); target.status = 'undone'; target.undoneAt = new Date().toISOString();
    _importReviewBusy = true; data = candidate;
    if (!await saveData(data, { noMerge: true, history: { action: 'Отмена импорта: ' + (batch.fileName || batch.title) } })) { data = original; rebuildIndex(); return false; }
  } catch (error) { if (original) { data = original; rebuildIndex(); } showToast(error.message); return false; }
  finally { _importReviewBusy = false; }
  importReviewHistory();
  if (typeof workspaceRefresh === 'function') workspaceRefresh();
  showToast('Пакет импорта отменён. Остальные записи сохранены.');
  return true;
}
function importReviewHistoryHtml() {
  const batches = (data.appMeta || []).filter(row => row.type === 'importBatch').slice().reverse();
  return '<h3>Пакеты импорта</h3><p>Отмена доступна, пока строки и их связи не изменены после импорта. Закрытые месяцы защищены.</p><div class="gsm-table-scroll"><table class="gsm-table"><thead><tr><th>Когда</th><th>Файл / источник</th><th>Изменений</th><th>Состояние</th><th>Действие</th></tr></thead><tbody>' +
    (batches.map(batch => '<tr><td>' + htmlEsc(new Date(batch.at).toLocaleString('ru-RU')) + '</td><td>' + htmlEsc(batch.fileName || batch.title) + '</td><td>' + (batch.changes || []).length + '</td><td>' + (batch.status === 'undone' ? 'Отменён' : 'Применён') + '</td><td>' + (batch.status === 'applied' ? '<button class="btn btn-ghost btn-sm" onclick="importReviewUndo(' + htmlJs(batch.id) + ')">Отменить пакет</button>' : '—') + '</td></tr>').join('') || '<tr><td colspan="5">Применённых пакетов пока нет.</td></tr>') + '</tbody></table></div>';
}
function importReviewHistory() { openGenericModal('История импортов', importReviewHistoryHtml(), 1050); }

// Provider mappings use header text + occurrence, so column reordering is safe.
function importReviewHeader(value) { return String(value || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function importReviewTemplateMapping(template, headers) {
  const normalized = headers.map(importReviewHeader), out = {};
  for (const [field, source] of Object.entries(template.columns || {})) {
    const matches = normalized.map((value, index) => value === source.header ? index : -1).filter(index => index >= 0);
    out[field] = matches[source.occurrence || 0] ?? -1;
  }
  return out;
}
function importReviewTemplateColumns(headers, mapping) {
  const normalized = headers.map(importReviewHeader), columns = {};
  for (const [field, index] of Object.entries(mapping)) if (index >= 0) columns[field] = {
    header: normalized[index], occurrence: normalized.slice(0, index).filter(value => value === normalized[index]).length };
  return columns;
}
function importReviewConfigureColumns(options) {
  if (_importMapping) { _importMapping.resolve(null); _importMapping = null; }
  return new Promise(resolve => {
    _importMapping = { ...options, resolve, headerRow: Math.max(0, options.headerRow), mapping: { ...options.mapping } };
    importReviewRenderMapping();
    if (typeof MutationObserver !== 'undefined') {
      const session = _importMapping, modal = document.getElementById('genericModal');
      const observer = new MutationObserver(() => {
        if (!modal.classList.contains('open')) { observer.disconnect(); if (_importMapping === session) { _importMapping = null; session.resolve(null); } }
      });
      observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
      session.observer = observer;
    }
  });
}
function importReviewRenderMapping() {
  const state = _importMapping; if (!state) return;
  const headers = state.rows[state.headerRow] || [], templates = (data.appMeta || []).filter(row => row.type === 'importTemplate' && row.kind === state.kind);
  openGenericModal('Сопоставление столбцов: ' + state.fileName,
    '<p>Выберите столбцы поставщика. На следующем шаге будет показано, что изменится в базе.</p><div class="form-row"><div class="form-group"><label for="importHeaderRow">Строка заголовков</label><select id="importHeaderRow" onchange="importReviewMappingHeaderChange(this.value)">' +
    state.rows.slice(0, 30).map((row, index) => '<option value="' + index + '"' + (index === state.headerRow ? ' selected' : '') + '>Строка ' + (index + 1) + ': ' + htmlEsc(row.map(String).join(' · ').slice(0, 120)) + '</option>').join('') + '</select></div><div class="form-group"><label for="importColumnTemplate">Шаблон поставщика</label><select id="importColumnTemplate" onchange="importReviewMappingTemplate(this.value)"><option value="">Автоматическое сопоставление</option>' +
    templates.map(row => '<option value="' + htmlEsc(row.id) + '"' + (state.templateId === row.id ? ' selected' : '') + '>' + htmlEsc(row.name) + '</option>').join('') + '</select></div></div>' +
    '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">' + state.fields.map(field => '<div class="form-group"><label for="importCol_' + field.key + '">' + htmlEsc(field.label) + (field.required ? ' *' : '') + '</label><select id="importCol_' + field.key + '" aria-label="' + htmlEsc(field.label) + '"><option value="-1">Не использовать</option>' + headers.map((header, index) => '<option value="' + index + '"' + (Number(state.mapping[field.key]) === index ? ' selected' : '') + '>' + (index + 1) + '. ' + htmlEsc(header || '(без названия)') + '</option>').join('') + '</select></div>').join('') + '</div>' +
    '<label style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="importSaveTemplate">Сохранить это сопоставление как шаблон</label><input id="importTemplateName" aria-label="Название шаблона" maxlength="80" placeholder="Например: Поставщик — ежемесячная выписка" value="' + htmlEsc(state.templateName || state.fileName.replace(/\.[^.]+$/, '').slice(0, 80)) + '">' +
    '<details><summary>Пример исходных строк</summary><div class="gsm-table-scroll"><table class="gsm-table"><thead><tr>' + headers.map(header => '<th>' + htmlEsc(header) + '</th>').join('') + '</tr></thead><tbody>' + state.rows.slice(state.headerRow + 1, state.headerRow + 5).map(row => '<tr>' + headers.map((_, index) => '<td>' + htmlEsc(row[index] instanceof Date ? row[index].toLocaleString('ru-RU') : row[index] ?? '') + '</td>').join('') + '</tr>').join('') + '</tbody></table></div></details>' +
    '<div id="importMappingError" role="alert" class="gsm-error"></div><div class="gsm-actions"><button class="btn btn-ghost" onclick="importReviewMappingCancel()">Отмена</button><button class="btn btn-primary" id="importMappingContinue" onclick="importReviewMappingContinue()">Показать изменения</button></div>', 950);
}
function importReviewGuessMapping(state) {
  const headers = (state.rows[state.headerRow] || []).map(importReviewHeader);
  return Object.fromEntries(state.fields.map(field => [field.key, headers.findIndex(header => (field.keywords || []).some(word => header.includes(word)))]));
}
function importReviewMappingHeaderChange(index) {
  if (!_importMapping) return; _importMapping.headerRow = Number(index); _importMapping.templateId = '';
  _importMapping.mapping = importReviewGuessMapping(_importMapping); importReviewRenderMapping();
}
function importReviewMappingTemplate(id) {
  if (!_importMapping) return;
  const template = (data.appMeta || []).find(row => row.id === id && row.type === 'importTemplate' && row.kind === _importMapping.kind);
  _importMapping.templateId = template?.id || '';
  _importMapping.mapping = template ? importReviewTemplateMapping(template, _importMapping.rows[_importMapping.headerRow] || []) : importReviewGuessMapping(_importMapping);
  if (template) _importMapping.templateName = template.name;
  importReviewRenderMapping();
}
function importReviewMappingCancel() {
  const state = _importMapping; _importMapping = null; state?.observer?.disconnect(); state?.resolve(null); closeModal('genericModal');
}
function importReviewMappingContinue() {
  const state = _importMapping; if (!state) return;
  const headers = state.rows[state.headerRow] || [], mapping = {};
  for (const field of state.fields) mapping[field.key] = Number(document.getElementById('importCol_' + field.key).value);
  const missing = state.fields.filter(field => field.required && !(mapping[field.key] >= 0 && mapping[field.key] < headers.length));
  const used = Object.values(mapping).filter(index => index >= 0);
  const name = document.getElementById('importTemplateName').value.trim();
  const saveTemplate = document.getElementById('importSaveTemplate').checked;
  const error = missing.length ? 'Выберите обязательные столбцы: ' + missing.map(field => field.label).join(', ') :
    new Set(used).size !== used.length ? 'Один исходный столбец нельзя назначить нескольким полям. Проверьте сопоставление.' : saveTemplate && !name ? 'Введите название шаблона.' : '';
  if (error) { document.getElementById('importMappingError').textContent = error; return; }
  _importMapping = null; state.observer?.disconnect(); closeModal('genericModal');
  state.resolve({ headerRow: state.headerRow, mapping, template: saveTemplate ? { kind: state.kind, name, columns: importReviewTemplateColumns(headers, mapping) } : null });
}
if (typeof fpHistoryHtml === 'function') {
  const importReviewOriginalFuelHistory = fpHistoryHtml;
  fpHistoryHtml = function() { return importReviewOriginalFuelHistory() + '<div style="margin-top:24px">' + importReviewHistoryHtml() + '</div>'; };
}
