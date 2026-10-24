// Document commands only save fuelWriteoffs. Fuel movements remain source facts.
let gsmWriteoffPending = null, gsmWriteoffVoidPending = null, gsmWriteoffSaving = false, gsmWriteoffPreparing = false;

function gsmWriteoffCanRead() {
  return typeof _sync === 'undefined' || !_sync.access || !Array.isArray(_sync.access.readable) ||
    ['vehicles', 'records', 'fuelPurchases', 'fuelCards', 'monthlyFuel', 'fuelWriteoffs'].every(name => _sync.access.readable.includes(name));
}
function gsmWriteoffStorageReady() {
  return !!window.electronAPI?.writeSections && typeof _sync !== 'undefined' && _sync.enabled && Number.isSafeInteger(_sync.revs.fuelWriteoffs);
}
function gsmWriteoffCanWrite() {
  return gsmWriteoffStorageReady() && gsmWriteoffCanRead() && !(typeof _loadWriteBlocked !== 'undefined' && _loadWriteBlocked) &&
    (typeof _sync === 'undefined' || !_sync.access || Array.isArray(_sync.access.writable) && _sync.access.writable.includes('fuelWriteoffs'));
}
function gsmWriteoffScope() { return { month:fpMonth, org:gsmOrg || '', grade:gsmFuel || '' }; }
function gsmWriteoffModel() {
  if(gsmBackgroundRequired()) {
    const prepared=gsmPreparedWriteoff();
    if(!prepared)throw Error('Расчёт ГСМ не готов или источники изменились. Обновите раздел и дождитесь новой проверки.');
    return prepared;
  }
  return dispatcherQuery('writeoff', { ...gsmWriteoffScope(), date:gsmActDateValue() });
}
function gsmWriteoffIdentity() { return dispatcherContext().identity; }
function gsmWriteoffActor() {
  const user = typeof _sync === 'undefined' ? null : _sync.access?.user;
  return user ? { id:user.id, name:user.name || user.id, role:user.role } : { id:'local', name:'Локальный пользователь', role:'admin' };
}
function gsmWriteoffActorName(actor) { return typeof actor === 'string' ? actor : actor?.name || actor?.id || ''; }
function gsmWriteoffDocs() {
  if (!gsmWriteoffCanRead()) return [];
  return (data.fuelWriteoffs || []).filter(doc => doc.scope?.month === fpMonth &&
    (!gsmOrg || !doc.scope.org || gsmOrgKey(doc.scope.org) === gsmOrgKey(gsmOrg)) &&
    (!gsmFuel || !doc.scope.grade || doc.scope.grade === gsmFuel)).slice().sort((a, b) => b.postedAt.localeCompare(a.postedAt));
}
function gsmWriteoffBasis(model) {
  const totals = { actual:0, norm:0, measurement:0, missing:0 };
  (model.consumption || []).forEach(row => { const source = Object.hasOwn(totals, row.source) ? row.source : 'missing'; totals[source] += gsmNumber(row.qty); });
  return totals;
}
function gsmWriteoffWorkspaceHtml() {
  let model;
  try { model = gsmWriteoffModel(); }
  catch (error) { return '<section class="gsm-writeoff-intro"><h3>Списание ГСМ</h3><p>Выберите один месяц, организацию и топливо для подготовки акта.</p><p class="gsm-error" role="status">' + fpEsc(error.message) + '</p></section>'; }
  const errors = model.issues.filter(issue => issue.severity === 'error'), warnings = model.issues.filter(issue => issue.severity !== 'error');
  const basis = gsmWriteoffBasis(model), docs = gsmWriteoffDocs(), canPost = model.canPost && gsmWriteoffCanWrite();
  const total = key => fpNum(model.totals[key] || 0, 3);
  const issues = model.issues.slice(0, 20).map(issue => '<li><strong>' + fpEsc(issue.severity === 'error' ? 'Ошибка' : 'Проверить') + '</strong> · ' +
    fpEsc([issue.date && fmtDate(issue.date), issue.vehicleId != null ? fpVehicleTitle(gsmVehicle(issue.vehicleId)) : '', issue.org, issue.grade].filter(Boolean).join(' · ')) +
    '<p>' + fpEsc(issue.message || issue.title || issue.code) + '</p>' + gsmWriteoffIssueLinks(issue) + '</li>').join('');
  const rows = model.rows.map(row => {
    const movements = (model.consumption || []).filter(item => item.vehicleId === row.vehicleId && gsmOrgKey(item.org) === gsmOrgKey(row.org) && item.grade === row.grade);
    const sources = [...new Set(movements.filter(item => item.qty || item.km).map(item => gsmConsumptionSourceLabel(item.source)))];
    const broken = errors.some(issue => issue.vehicleId === row.vehicleId && (!issue.grade || issue.grade === row.grade));
    return '<tr data-writeoff-vehicle="' + fpEsc(row.vehicleId) + '"><td><strong>' + fpEsc(fpVehicleTitle(row.vehicle)) + '</strong><small>' + fpEsc(row.org) + '</small></td>' + gsmCell(row.grade) +
      ['start', 'issued', 'spent', 'correction', 'end'].map(key => '<td class="gsm-number' + (key === 'end' && row.end < -GSM_EPS ? ' gsm-error' : '') + '">' + fpNum(row[key], 3) + '</td>').join('') +
      '<td><span class="gsm-writeoff-state' + (broken ? ' is-error' : '') + '">' + (broken ? 'Нужна сверка' : 'Рассчитано') + '</span><small>' + fpEsc(sources.join(' · ') || 'Движений нет') + '</small></td>' +
      '<td><button type="button" class="btn btn-ghost btn-sm" data-writeoff-action="details" onclick="gsmWriteoffDetails(' + [row.vehicleId, row.org, row.grade].map(gsmArg).join(',') + ')">Основание</button></td></tr>';
  });
  return '<section class="gsm-writeoff" aria-label="Подготовка списания"><div class="gsm-writeoff-intro"><div><h3>Списание ГСМ</h3><p>Подготовка → проверка источников → проведение → сохранённый акт.</p></div><span class="gsm-writeoff-state' + (errors.length ? ' is-error' : '') + '" role="status">' +
    (errors.length ? 'Проведение заблокировано · ' + errors.length : 'Расчёт готов к проверке') + '</span></div>' +
    '<p class="gsm-overview-note">Проведение сохраняет состав и основания акта. Расход уже учтён в журнале и повторно не списывается. Для исправления источников проведённый акт сначала аннулируют с причиной.</p>' +
    '<div class="gsm-writeoff-metrics">' + [['На начало',total('start')],['Поступило',total('issued')],['К списанию · х/х включён',total('spent')],['Остаток на конец',total('end')]].map(([label,value]) => '<div><span>' + label + '</span><strong>' + value + '<small> л</small></strong></div>').join('') + '</div>' +
    '<div class="gsm-writeoff-basis">' + Object.entries(basis).map(([key,value]) => '<span>' + fpEsc(gsmConsumptionSourceLabel(key)) + ': <strong>' + fpNum(value,3) + ' л</strong></span>').join('') + '</div>' +
    '<div class="gsm-actions gsm-writeoff-toolbar"><button type="button" class="btn btn-ghost" onclick="gsmExportWriteoffDraft()">Выгрузить черновик</button><button type="button" class="btn btn-primary" data-writeoff-action="post" onclick="gsmPostWriteoffDialog()" ' + (canPost ? '' : 'disabled') + '>Проверить и провести</button></div>' +
    (!gsmWriteoffCanWrite() ? '<p class="gsm-status">' + (gsmWriteoffStorageReady() ? 'Проведение недоступно для текущих прав доступа.' : 'Для проведения требуется хранилище с поддержкой сохранённых актов. Доступна подготовка черновика.') + '</p>' : '') +
    (issues ? '<details class="gsm-writeoff-checks"' + (errors.length ? ' open' : '') + '><summary>Проверка источников · ошибок ' + errors.length + ', предупреждений ' + warnings.length + '</summary><ul>' + issues + '</ul>' +
      (model.issues.length > 20 ? '<p>Показано 20 из ' + model.issues.length + ' замечаний.</p>' : '') + '<button type="button" class="btn btn-ghost btn-sm" onclick="gsmOpenDiagnostics()">Открыть проверку ГСМ</button></details>' : '') +
    gsmTable(['Машина / организация', 'Топливо', 'Начало, л', 'Приход, л', 'К списанию, л', 'Корректировка ±, л', 'Конец, л', 'Проверка / основание', ''], rows) +
    '<section class="gsm-writeoff-registry" aria-label="Сохранённые акты"><h3>Сохранённые акты <span>' + docs.length + '</span></h3><p class="gsm-status">Выгрузка проведённого акта использует сохранённый снимок. Аннулированные акты остаются в истории.</p>' +
    (docs.length ? docs.map(doc => '<article class="gsm-writeoff-document"><div><strong>Акт № ' + fpEsc(doc.number) + '</strong><span class="gsm-writeoff-state' + (doc.status === 'void' ? ' is-void' : '') + '">' + (doc.status === 'void' ? 'Аннулирован' : 'Проведён') + '</span><p>' + fpEsc([doc.scope.org || 'Все организации', doc.scope.grade || 'Все марки топлива', fmtDate(doc.date)].join(' · ')) + '</p><small>' + fpEsc(gsmWriteoffActorName(doc.postedBy)) + ' · ' + fpEsc(new Date(doc.postedAt).toLocaleString('ru-RU')) + '</small>' +
      (doc.basisNote ? '<p>Основание: ' + fpEsc(doc.basisNote) + '</p>' : '') + (doc.status === 'void' ? '<p>Причина: ' + fpEsc(doc.voidReason || doc.reason || '') + '</p>' : '') + '</div><div class="gsm-actions"><button type="button" class="btn btn-ghost btn-sm" data-writeoff-action="export-posted" data-writeoff-id="' + fpEsc(doc.id) + '" onclick="gsmExportPostedWriteoff(' + gsmArg(doc.id) + ')">Выгрузить ' + (doc.status === 'void' ? 'копию' : 'акт') + '</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-writeoff-action="print-copy" onclick="gsmPrintWriteoff(' + gsmArg(doc.id) + ')">Предпросмотр / сохранить печатный экземпляр</button><button type="button" class="btn btn-ghost btn-sm" data-writeoff-action="print-archive" onclick="documentPrintArchiveOpen({section:&quot;fuelWriteoffs&quot;,id:' + gsmArg(doc.id) + '})">Архив печати</button>' +
      (doc.status === 'posted' && gsmWriteoffCanWrite() ? '<button type="button" class="btn btn-ghost btn-sm" data-writeoff-action="void" data-writeoff-id="' + fpEsc(doc.id) + '" onclick="gsmVoidWriteoffDialog(' + gsmArg(doc.id) + ')">Аннулировать</button>' : '') + '</div></article>').join('') : '<div class="gsm-overview-empty">За выбранный месяц и фильтры проведённых актов пока нет.</div>') + '</section></section>';
}
function gsmWriteoffIssueLinks(issue) {
  const buttons = [];
  if (issue.purchaseId != null && fpById(issue.purchaseId)) buttons.push('<button type="button" class="btn btn-ghost btn-sm" onclick="fpEdit(' + gsmArg(issue.purchaseId) + ')">Открыть покупку</button>');
  if (issue.recordId != null && (data.records || []).some(row => row.id === issue.recordId)) buttons.push('<button type="button" class="btn btn-ghost btn-sm" onclick="gsmEditRecord(' + gsmArg(issue.recordId) + ')">Открыть журнал</button>');
  return buttons.join('');
}
function gsmWriteoffDetails(vehicleId, org, grade) {
  let model;
  try { model = gsmWriteoffModel(); } catch (error) { showToast(error.message); return; }
  const row = model.rows.find(row => row.vehicleId === vehicleId && gsmOrgKey(row.org) === gsmOrgKey(org) && row.grade === grade);
  if (!row) return;
  const ledger = model.snapshot.ledger, visible = item => item.vehicleId === vehicleId && gsmOrgKey(item.org) === gsmOrgKey(org) && item.grade === grade;
  const movements = ledger.movements.filter(visible), receipts = ledger.receipts.filter(visible);
  openGenericModal('Основание списания · ' + fpVehicleTitle(row.vehicle), '<p>' + fpEsc(org + ' · ' + grade + ' · ' + fpMonthLabel(model.scope.month)) + '</p><p class="gsm-writeoff-equation">' +
    fpNum(row.start,3) + ' + ' + fpNum(row.issued,3) + ' + (' + fpNum(row.correction,3) + ') − ' + fpNum(row.spent,3) + ' = <strong>' + fpNum(row.end,3) + ' л</strong></p>' +
    '<p class="gsm-status">Начало + приход + корректировка − расход = конец. Холостой ход входит в расход. Сверка марок переносит остаток между марками и не создаёт приход.</p><h4>Основания расхода и корректировки</h4>' +
    gsmTable(['Дата', 'Операция / основание', 'Пробег, км', 'Литры', 'Источник'], movements.filter(item => item.kind !== 'receipt').map(item => '<tr>' + gsmCell(fmtDate(item.date)) + gsmCell(gsmMovementSource(item)) + gsmCell(item.km || 0, true) + gsmCell(item.kind === 'consumption' ? item.qty : item.delta, true) + '<td>' + gsmMovementLinks(item) + '</td></tr>')) +
    '<h4>Поступления по выпискам и журналу</h4>' + gsmTable(['Дата', 'Поставщик', 'Карта', 'Литры', 'Источник'], receipts.map(item => '<tr>' + gsmCell(fmtDate(item.date)) + gsmCell(item.provider) + gsmCell(item.cardNo) + gsmCell(item.qty,true) + '<td>' + gsmMovementLinks(item) + '</td></tr>')), 1040);
}
function gsmPostWriteoffDialog() {
  if (gsmWriteoffSaving || gsmWriteoffPreparing) return;
  try {
    if (!gsmWriteoffCanWrite()) throw Error('Для вашей роли проведение актов запрещено.');
    const model = gsmWriteoffModel();
    if (!model.canPost) throw Error('Проведение заблокировано. Исправьте ошибки источников и повторите проверку.');
    gsmWriteoffPending = { model, identity:gsmWriteoffIdentity(), scope:gsmWriteoffScope(), databaseRef:data };
    const basis = gsmWriteoffBasis(model);
    openGenericModal('Проверка перед проведением', '<form id="gsmWriteoffPostForm"><p>' + fpEsc([fpMonthLabel(model.scope.month),model.scope.org || 'Все организации',model.scope.grade || 'Все марки топлива'].join(' · ')) + '</p>' +
      '<p>Строк: <strong>' + model.rows.length + '</strong> · К списанию: <strong>' + fpNum(model.totals.spent,3) + ' л</strong> · Остаток: <strong>' + fpNum(model.totals.end,3) + ' л</strong></p>' +
      '<p class="gsm-status">Введённый факт: ' + fpNum(basis.actual,3) + ' л · По норме: ' + fpNum(basis.norm,3) + ' л · По замеру: ' + fpNum(basis.measurement,3) + ' л. Замечаний: ' + model.issues.length + '.</p>' +
      '<div class="form-row"><label class="form-group">Номер акта<input name="actNo" aria-label="Номер акта" required maxlength="80" value="' + fpEsc(gsmActNo) + '"></label><label class="form-group">Дата акта<input name="actDate" aria-label="Дата акта" type="date" required value="' + fpEsc(gsmActDateValue()) + '"></label></div>' +
      '<label class="form-group">Основание / документ' + (basis.norm > 0 ? ' (обязательно для расчёта по норме)' : '') + '<textarea name="basisNote" rows="3" maxlength="4000" ' + (basis.norm > 0 ? 'required' : '') + ' placeholder="Например: путевые листы, утверждённые нормы и период"></textarea></label>' +
      '<p class="gsm-overview-note">Акт сохранит именно этот расчёт. Изменения источников после просмотра потребуют новой проверки. Исправление проведённого документа выполняется через аннулирование и новый акт.</p><div id="gsmWriteoffPostError" class="gsm-error" role="alert"></div><div class="gsm-actions"><button type="button" class="btn btn-ghost" onclick="closeModal(\'genericModal\')">Отмена</button><button type="submit" class="btn btn-primary">Провести акт</button></div></form>', 740);
    document.getElementById('gsmWriteoffPostForm').onsubmit = gsmPostWriteoff;
  } catch (error) { showToast(error.message); }
}
async function gsmWriteoffStore(doc, original, pending) {
  if (gsmWriteoffSaving) throw Error('Дождитесь завершения сохранения.');
  if (!gsmWriteoffCanWrite()) throw Error('Для вашей роли проведение и аннулирование актов запрещено.');
  if (data !== pending.databaseRef || gsmWriteoffIdentity() !== pending.identity) throw Error('Выбранная база или пользователь изменились. Откройте проверку заново.');
  const previous = data.fuelWriteoffs || [], current = previous.find(row => row.id === doc.id);
  if (JSON.stringify(current || null) !== JSON.stringify(original || null)) throw Error('Акт уже изменён. Обновите раздел и откройте его заново.');
  const candidate = previous.filter(row => row.id !== doc.id).concat(doc);
  TvsWriteoffEngine.validateDocuments(data, { ...data, fuelWriteoffs:candidate });
  const target = data;
  gsmWriteoffSaving = true; data.fuelWriteoffs = candidate;
  const rollback = () => {
    if (data === target && JSON.stringify(data.fuelWriteoffs?.find(row => row.id === doc.id)) === JSON.stringify(doc)) {
      data.fuelWriteoffs = data.fuelWriteoffs.flatMap(row => row.id === doc.id ? original ? [original] : [] : [row]);
      rebuildIndex();
    }
  };
  try {
    const ok = await saveData(data, { noMerge:true, requiredCanonicalSections:['fuelWriteoffs'] });
    if (ok !== true) { rollback(); throw Error('Сохранение акта не подтверждено. Проверьте подключение и реестр актов перед повторной попыткой.'); }
    if (data !== target && gsmWriteoffIdentity() !== pending.identity) throw Error('База изменилась во время сохранения. Проверьте акт в исходной базе.');
    const stored = (data.fuelWriteoffs || []).find(row => row.id === doc.id);
    if (!stored || stored.status !== doc.status || stored.sourceFingerprint !== doc.sourceFingerprint) throw Error('Сохранение акта не подтверждено. Обновите раздел.');
    return stored;
  } catch (error) {
    rollback();
    // A failed save may replace data with an owned persisted snapshot. Rebind
    // this form only after proving its reviewed facts and row are unchanged.
    if (gsmWriteoffIdentity() === pending.identity && JSON.stringify((data.fuelWriteoffs || []).find(row => row.id === doc.id) || null) === JSON.stringify(original || null)) {
      try {
        if (!pending.model || TvsWriteoffEngine.fingerprint(data, { ...pending.scope, date:pending.model.date }) === pending.model.sourceFingerprint) pending.databaseRef = data;
      } catch { /* An invalid or stale source keeps the original form blocked. */ }
    }
    throw error;
  }
  finally { gsmWriteoffSaving = false; }
}
async function gsmPostWriteoff(event) {
  event?.preventDefault();
  const form = document.querySelector('#genericModal.open #gsmWriteoffPostForm'), pending = gsmWriteoffPending;
  if (!form || !pending || gsmWriteoffSaving || gsmWriteoffPreparing) return;
  const button = form.querySelector('[type="submit"]'), errorBox = form.querySelector('#gsmWriteoffPostError');
  button.disabled = true; errorBox.textContent = '';gsmWriteoffPreparing=true;
  try {
    if (!gsmWriteoffCanWrite()) throw Error('Для вашей роли проведение актов запрещено.');
    if (JSON.stringify(gsmWriteoffScope()) !== JSON.stringify(pending.scope)) throw Error('Фильтры периода изменились. Откройте проверку заново.');
    const fresh = gsmWriteoffModel();
    if (!fresh.canPost || fresh.sourceFingerprint !== pending.model.sourceFingerprint) throw Error('Источники изменились после просмотра. Откройте проверку заново.');
    const number = form.elements.actNo.value.trim(), date = form.elements.actDate.value, basisNote = form.elements.basisNote.value.trim();
    const request={...pending.scope,date,basisNote},metadata={id:wfId('fuel-act'),number,expectedFingerprint:pending.model.sourceFingerprint,postedAt:new Date().toISOString(),postedBy:gsmWriteoffActor()};
    const stamp=gsmBackgroundRequired()?gsmBackgroundStamp():null;
    const doc = stamp ? await dispatcherQueryAsync('writeoffPost',{request,metadata}) : TvsWriteoffEngine.post(data,request,metadata);
    if(stamp&&(stamp!==gsmBackgroundStamp()||data!==pending.databaseRef||gsmWriteoffIdentity()!==pending.identity||activeSection!=='fuelPurchases'||!form.isConnected||!form.closest('#genericModal.open')||form.elements.actNo.value.trim()!==number||form.elements.actDate.value!==date||form.elements.basisNote.value.trim()!==basisNote))
      throw Error('Источники, сеанс или параметры акта изменились во время расчёта. Откройте проверку заново.');
    await gsmWriteoffStore(doc, null, pending);
    gsmActNo = number; gsmActDate = date; gsmWriteoffPending = null;
    if (form.isConnected && activeSection === 'fuelPurchases' && fpView === 'writeoff' && typeof gsmActStepsDocumentSaved === 'function') gsmActStepsDocumentSaved();
    if (form.isConnected) { closeModal('genericModal'); renderFuelPurchases(); }
    showToast('Акт проведён. Состав и основания сохранены.');
  } catch (error) { if (errorBox.isConnected) errorBox.textContent = error.message; }
  finally { gsmWriteoffPreparing=false;if (button.isConnected) button.disabled = false; }
}
function gsmVoidWriteoffDialog(id) {
  if (gsmWriteoffSaving || gsmWriteoffPreparing) return;
  if (!gsmWriteoffCanWrite()) { showToast('Для вашей роли аннулирование запрещено.'); return; }
  const doc = (data.fuelWriteoffs || []).find(row => row.id === id && row.status === 'posted');
  if (!doc) { showToast('Проведённый акт не найден. Обновите раздел.'); return; }
  gsmWriteoffVoidPending = { original:JSON.parse(JSON.stringify(doc)), identity:gsmWriteoffIdentity(), databaseRef:data };
  openGenericModal('Аннулировать акт № ' + doc.number, '<form id="gsmWriteoffVoidForm"><p>Сохранённый состав и история останутся. После аннулирования можно исправить подтверждённые ошибки источников и провести новый акт.</p><label class="form-group">Причина аннулирования<textarea name="reason" required minlength="3" maxlength="2000" rows="3"></textarea></label><div id="gsmWriteoffVoidError" class="gsm-error" role="alert"></div><div class="gsm-actions"><button type="button" class="btn btn-ghost" onclick="closeModal(\'genericModal\')">Отмена</button><button type="submit" class="btn btn-primary">Аннулировать акт</button></div></form>', 640);
  document.getElementById('gsmWriteoffVoidForm').onsubmit = gsmVoidWriteoff;
}
async function gsmVoidWriteoff(event) {
  event?.preventDefault();
  const form = document.querySelector('#genericModal.open #gsmWriteoffVoidForm'), pending = gsmWriteoffVoidPending;
  if (!form || !pending || gsmWriteoffSaving) return;
  const button = form.querySelector('[type="submit"]'), errorBox = form.querySelector('#gsmWriteoffVoidError'); button.disabled = true; errorBox.textContent = '';
  try {
    const doc = TvsWriteoffEngine.voidDocument(pending.original, { reason:form.elements.reason.value.trim(), voidedAt:new Date().toISOString(), voidedBy:gsmWriteoffActor() });
    await gsmWriteoffStore(doc, pending.original, pending); gsmWriteoffVoidPending = null;
    if (form.isConnected && activeSection === 'fuelPurchases' && fpView === 'writeoff' && typeof gsmActStepsDocumentSaved === 'function') gsmActStepsDocumentSaved();
    if (form.isConnected) { closeModal('genericModal'); renderFuelPurchases(); }
    showToast('Акт аннулирован. История сохранена.');
  } catch (error) { if (errorBox.isConnected) errorBox.textContent = error.message; }
  finally { if (button.isConnected) button.disabled = false; }
}
function gsmWriteoffWorkbook(doc, draft) {
  const sourceData = { vehicles:doc.snapshot.vehicles, records:doc.snapshot.records };
  const wb = gsmActWorkbook(doc.snapshot.ledger, doc.scope.org, { sourceData, issues:doc.issues, draft:!!draft, voided:doc.status === 'void', voidReason:doc.voidReason,
    actNo:doc.number || gsmActNo, actDate:doc.date || gsmActDateValue(), fuelGrade:doc.scope.grade });
  gsmExportSheet(wb, 'Паспорт акта', [['Поле','Значение'], ['Статус',doc.status === 'void' ? 'Аннулирован' : draft ? 'Черновик' : 'Проведён'],
    ['Идентификатор',doc.id ?? ''], ['Номер',doc.number || ''], ['Период',doc.scope.month], ['Организация',doc.scope.org || 'Все организации'], ['Топливо',doc.scope.grade || 'Все марки'],
    ['Проведён',doc.postedAt || ''], ['Пользователь',gsmWriteoffActorName(doc.postedBy)], ['Основание',doc.basisNote || ''], ['Отпечаток источников',doc.sourceFingerprint],
    ['Аннулирован',doc.voidedAt || ''], ['Кем аннулирован',gsmWriteoffActorName(doc.voidedBy)], ['Причина аннулирования',doc.voidReason || doc.reason || '']], 2);
  return wb;
}
function gsmExportWriteoffDraft() {
  try {
    if (!gsmWriteoffCanRead()) throw Error('Для подготовки акта нужны права чтения всех разделов ГСМ.');
    const model = gsmWriteoffModel(), wb = gsmWriteoffWorkbook(model, true);
    XLSX.writeFile(wb, 'Черновик_акта_ГСМ_' + model.scope.month + '.xlsx'); return wb;
  } catch (error) { showToast(error.message); return null; }
}
function gsmExportPostedWriteoff(id) {
  try {
    if (!gsmWriteoffCanRead()) throw Error('Недостаточно прав для чтения акта.');
    const doc = (data.fuelWriteoffs || []).find(row => row.id === id);
    if (!doc) throw Error('Акт не найден. Обновите раздел.');
    const wb = gsmWriteoffWorkbook(doc, false), name = String(doc.number).replace(/[<>:"/\\|?*]/g, '').slice(0,80);
    XLSX.writeFile(wb, (doc.status === 'void' ? 'Аннулированный_акт_ГСМ_' : 'Акт_ГСМ_') + name + '_' + doc.scope.month + '.xlsx'); return wb;
  } catch (error) { showToast(error.message); return null; }
}

function gsmPrintWriteoff(id){if(!gsmWriteoffCanRead()){showToast('Недостаточно прав для чтения сохранённого акта.');return null;}return documentPrintOpen({mode:'document',source:{section:'fuelWriteoffs',id},revision:'exact',templateId:'fuelWriteoff',templateVersion:1});}
