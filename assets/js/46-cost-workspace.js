// Financial workspace. Facts and user rate scenarios are displayed separately.
let costPeriodFrom = '', costPeriodTo = '', costAssetRef = '', costPending = false;
function costCanRead(section) { return typeof _sync === 'undefined' || !_sync.access || !Array.isArray(_sync.access.readable) || _sync.access.readable.includes(section); }
function costCanWrite(section) { if (typeof _loadWriteBlocked !== 'undefined' && _loadWriteBlocked) return false; return typeof _sync === 'undefined' || !_sync.access || Array.isArray(_sync.access.writable) && _sync.access.writable.includes(section); }
function costMoney(value) { return value == null ? '—' : value.toLocaleString('ru-RU', { minimumFractionDigits:2, maximumFractionDigits:2 }) + ' ₽'; }
function costNumber(value) { return value == null ? '—' : value.toLocaleString('ru-RU', { maximumFractionDigits:2 }); }
function costAssets() { return wfAssets().filter(asset => /^[vg]:/.test(asset.ref) && costCanRead(asset.ref.startsWith('v:') ? 'vehicles' : 'generators')); }
function costAssetOptions(value) { return costAssets().map(asset => `<option value="${htmlEsc(asset.ref)}" ${asset.ref === value ? 'selected' : ''}>${htmlEsc(asset.label)}${asset.row.archived ? ' · архив' : ''}</option>`).join(''); }
function costReadable() { return typeof _sync !== 'undefined' && Array.isArray(_sync.access?.readable) ? _sync.access.readable : undefined; }
function costFormIdentity() {
  return JSON.stringify({ cache:typeof localCacheKey !== 'undefined' ? localCacheKey : null,
    token:typeof _sync !== 'undefined' ? _sync.databaseToken : null,
    user:typeof _sync !== 'undefined' ? _sync.access?.user?.id || null : null,
    role:typeof _sync !== 'undefined' ? _sync.access?.user?.role || null : null });
}
function costAssertFormIdentity(identity) { if (identity !== costFormIdentity()) throw Error('База, профиль или учётная запись изменились. Закройте форму и откройте её заново; введённые значения остаются в полях.'); }
function costInitPeriod() {
  if (costPeriodFrom || costPeriodTo) return;
  const today = wfToday(); costPeriodFrom = today.slice(0, 7) + '-01'; costPeriodTo = today;
}
function renderCostsSection() {
  if (activeSection !== 'costs') return;
  costInitPeriod();
  const content = document.getElementById('mainContent');
  if (!costCanRead('costEntries')) { content.innerHTML = '<div class="cost-workspace"><h2>Затраты техники</h2><p>Для вашей роли финансовые расчёты недоступны.</p></div>'; return; }
  let report;
  try { report = TvsCostEngine.buildReport(data, { from:costPeriodFrom, to:costPeriodTo, assetRef:costAssetRef, readable:costReadable() }); }
  catch (error) { showToast(error.message); return; }
  const selected = costAssetRef ? report.rows[0] : null;
  const metric = (label, value, note) => `<article class="cost-metric"><span>${htmlEsc(label)}</span><strong>${htmlEsc(value)}</strong><small>${htmlEsc(note)}</small></article>`;
  const unknownCount = report.rows.reduce((sum, row) => sum + row.issues.length, 0) + report.issues.length;
  const permissionNote = report.unavailable.length ? '<p class="cost-note">Часть источников недоступна для вашей роли. Показаны только разрешённые документы; итог неполный.</p>' : '';
  content.innerHTML = `<div class="cost-workspace">
    <header class="cost-heading"><div><h2>Затраты техники</h2><p>Расходы на километр и моточас по документам и журналам.</p></div><div class="cost-actions">
      ${costCanWrite('costProfiles') ? '<button class="btn btn-ghost" data-cost-action="profile">Ставки для оценки</button>' : ''}
      ${costCanWrite('costEntries') ? `<button class="btn btn-primary" data-cost-action="new" ${!costAssets().length ? 'disabled' : ''}>Добавить операцию</button>` : ''}
    </div></header>
    <form id="costFilters" class="cost-filters"><label><span>С даты</span><input type="date" id="costFrom" value="${htmlEsc(costPeriodFrom)}" required></label><label><span>По дату включительно</span><input type="date" id="costTo" value="${htmlEsc(costPeriodTo)}" required></label><label class="cost-filter-asset"><span>Техника</span><select id="costAsset"><option value="">Весь парк</option>${costAssetOptions(costAssetRef)}</select></label><button class="btn btn-ghost" type="submit">Показать</button><button class="btn btn-ghost" type="button" data-cost-action="month">Текущий месяц</button><div id="costFilterError" class="cost-form-error" role="alert"></div></form>
    ${permissionNote}<div class="cost-metrics">
    ${metric('Учтённые расходы', costMoney(report.totals.expenses), 'Только документы с известной суммой')}
    ${metric('Учтённая выручка', costMoney(report.totals.income), 'Введённые самостоятельные операции')}
    ${selected ? metric('Учтённые расходы на ' + selected.unit, selected.rate == null ? '—' : costMoney(selected.rate) + '/' + selected.unit, selected.quantityComplete && selected.quantity > 0 ? costNumber(selected.quantity) + ' ' + selected.unit + ' по журналу' : 'Нужен полный журнал с положительным пробегом/часами') : metric('Техника в расчёте', String(report.rows.length), 'Откройте строку для состава расходов')}
    ${metric('Требуют внимания', String(unknownCount), 'Нет суммы, неполный журнал или спорная связь')}
    </div><p class="cost-note">Это учтённые расходы, а не полная себестоимость. Неизвестные зарплата, амортизация, стоимость топлива и прочие расходы не заменяются нулями.</p>
    ${selected ? costDetailHtml(selected) : costFleetHtml(report.rows)}
    ${(report.unassigned.length || report.exclusions.length || report.issues.length) ? `<section class="cost-panel"><h3>Документы без привязки и общие вопросы</h3><p class="cost-note">Общие расходы не распределяются между машинами произвольно и не включены в показатели техники.</p>${costEntriesHtml(report.unassigned, false)}${costIssuesHtml(report.issues)}${costExclusionsHtml(report.exclusions)}</section>` : ''}
    <details class="cost-panel cost-method"><summary>Как считается показатель</summary><p>${htmlEsc(report.method)}</p><p>Связанные платежи не прибавляются к ремонту и ТО повторно. Платежи категорий ремонт/ТО/ГСМ без связи исключены до сверки. Планы ТО, согласованные суммы непринятых заказов, восстановленные оценки покупок ГСМ и ставки не являются фактическими затратами.</p><p>Запчасти, включённые в стоимость ремонта, не добавляются второй раз. Для самостоятельного расхода введите операцию и подтвердите отсутствие повтора. Разные документы одного ремонта связывайте первичным документом; спорные совпадения будут показаны для сверки.</p><p>Километры и часы берутся только из журналов ТС/ДЭС; заявки, сменные формы и ГЛОНАСС повторно не суммируются. Общая ставка для парка с разными единицами не рассчитывается. Ставки — отдельный сценарий по текущим значениям, без прибавления к фактическим документам.</p></details>
    </div>`;
  const wrapper = content.querySelector('.cost-workspace');
  wrapper.addEventListener('click', event => {
    const button = event.target.closest('[data-cost-action]'); if (!button) return;
    switch (button.dataset.costAction) {
      case 'new': costEditEntry(); break;
      case 'edit': costEditEntry(button.dataset.id); break;
      case 'delete': void costDeleteEntry(button.dataset.id); break;
      case 'profile': costEditProfile(); break;
      case 'asset': costAssetRef = button.dataset.ref; renderCostsSection(); break;
      case 'all': costAssetRef = ''; renderCostsSection(); break;
      case 'month': costPeriodFrom = ''; costPeriodTo = ''; renderCostsSection(); break;
    }
  });
  document.getElementById('costFilters').addEventListener('submit', event => {
    event.preventDefault(); const from = document.getElementById('costFrom').value, to = document.getElementById('costTo').value;
    if (!TvsCostEngine.validDate(from) || !TvsCostEngine.validDate(to) || from > to) { document.getElementById('costFilterError').textContent = 'Начало периода должно быть не позже конца'; return; }
    costPeriodFrom = from; costPeriodTo = to; costAssetRef = document.getElementById('costAsset').value; renderCostsSection();
  });
}
function costFleetHtml(rows) {
  if (!rows.length) return '<section class="cost-panel cost-empty"><h3>Техника пока не добавлена</h3><p>Добавьте транспорт или ДЭС, затем заполните журнал пробега/наработки и документы затрат.</p></section>';
  return `<section class="cost-panel"><h3>Расходы по технике</h3><div class="cost-table-scroll"><table class="cost-table"><thead><tr><th>Техника</th><th>Пробег / часы</th><th>Учтено расходов</th><th>Расходы на км/ч</th><th>Выручка</th><th>Результат по учтённым данным</th><th>Внимание</th></tr></thead><tbody>${rows.map(row => `<tr><td><button class="cost-asset-link" data-cost-action="asset" data-ref="${htmlEsc(row.assetRef)}">${htmlEsc(row.label)}</button>${row.row.archived ? '<small>Архивная техника</small>' : ''}</td><td>${costNumber(row.quantity)} ${row.unit}${row.unknownQuantityRows ? '<small>Журнал неполный</small>' : ''}</td><td>${costMoney(row.expenses)}</td><td>${costMoney(row.rate)}${row.rate != null ? '/' + row.unit : ''}</td><td>${costMoney(row.income)}</td><td>${costMoney(row.result)}</td><td>${row.issues.length ? `<span class="cost-warning">${row.issues.length}</span>` : '—'}</td></tr>`).join('')}</tbody></table></div><p class="cost-note">«—» означает отсутствие достаточных данных, а не нулевые затраты. Результат доступен при положительной выручке и наличии учтённых расходов.</p></section>`;
}
function costDetailHtml(row) {
  const categories = new Map(); row.entries.filter(entry => entry.kind === 'expense').forEach(entry => categories.set(entry.category, (categories.get(entry.category) || 0) + entry.amount));
  return `<section class="cost-panel"><div class="cost-heading"><h3>${htmlEsc(row.label)}</h3><button class="btn btn-ghost btn-sm" data-cost-action="all">Весь парк</button></div>
    <div class="cost-detail-grid"><div><h4>Состав учтённых расходов</h4>${categories.size ? `<dl class="cost-breakdown">${[...categories].map(([category, amount]) => `<div><dt>${htmlEsc(category)}</dt><dd>${costMoney(amount)}</dd></div>`).join('')}</dl>` : '<p class="cost-note">Нет документов с известной суммой. Добавьте самостоятельный расход либо заполните первичные документы.</p>'}
    <p class="cost-result">Результат по учтённым данным: <strong>${costMoney(row.result)}</strong>${row.margin != null ? `<small>${costNumber(row.margin)}% от учтённой выручки</small>` : ''}</p><p class="cost-note">Это разность введённой выручки и известных расходов. Неучтённые затраты могут изменить результат.</p></div>
    <div><h4>Оценка по ставкам · отдельно от факта</h4>${costScenarioHtml(row)}${costCanWrite('costProfiles') ? '<button class="btn btn-ghost btn-sm" data-cost-action="profile">Настроить ставки</button>' : ''}</div></div>
    ${costIssuesHtml(row.issues)}<h4>Первичные документы и ручные операции · ${row.entries.length}</h4>${costEntriesHtml(row.entries, true)}
    ${row.estimates.length ? `<details class="cost-review"><summary>Оценки из документов · ${row.estimates.length} · в фактический итог не входят</summary>${costEntriesHtml(row.estimates, false)}</details>` : ''}
    ${costExclusionsHtml(row.exclusions)}</section>`;
}
function costScenarioHtml(row) {
  const scenario = row.scenario;
  if (!scenario || scenario.rate == null) return '<p class="cost-note">Ставки не заданы. Укажите оплату труда и амортизацию на ' + row.unit + ', норму топлива и цену. Пустое поле остаётся неизвестным.</p>';
  return `<dl class="cost-breakdown">${scenario.pieces.map(piece => `<div><dt>${htmlEsc(piece.label)}</dt><dd>${costMoney(piece.rate)}${piece.rate != null ? '/' + row.unit : ''}</dd></div>`).join('')}<div class="cost-breakdown-total"><dt>${scenario.complete ? 'Оценка по трём статьям' : 'Известная часть оценки'}</dt><dd>${costMoney(scenario.rate)}/${row.unit}</dd></div><div><dt>На учтённый пробег / часы</dt><dd>${costMoney(scenario.amount)}</dd></div></dl><p class="cost-note">Сценарий по текущим ставкам. Ремонт, налоги и прочие статьи сюда не входят. Сумма не прибавляется к фактическим документам.${scenario.complete ? '' : ' Не все ставки заданы.'}</p>${scenario.note ? `<p class="cost-note">${htmlEsc(scenario.note)}</p>` : ''}`;
}
function costEntriesHtml(entries, editable) {
  if (!entries.length) return '<p class="cost-note">Нет операций за выбранный период.</p>';
  return `<div class="cost-table-scroll"><table class="cost-table"><thead><tr><th>Дата</th><th>Источник / описание</th><th>Статья</th><th>Тип</th><th>Сумма</th>${editable ? '<th>Действия</th>' : ''}</tr></thead><tbody>${entries.map(entry => `<tr><td>${htmlEsc(entry.date || '—')}</td><td>${htmlEsc(entry.title)}<small>${htmlEsc(entry.sourceLabel)}${entry.sourceId ? ' · ' + htmlEsc(entry.sourceId) : ''}</small>${entry.note ? `<small>${htmlEsc(entry.note)}</small>` : ''}</td><td>${htmlEsc(entry.category || '')}</td><td>${entry.kind === 'income' ? 'Выручка' : 'Расход'}</td><td>${costMoney(entry.amount)}</td>${editable ? `<td>${entry.source === 'costEntries' && costCanWrite('costEntries') ? `<div class="cost-actions"><button class="btn btn-ghost btn-sm" data-cost-action="edit" data-id="${htmlEsc(entry.sourceId)}">Изменить</button><button class="btn btn-ghost btn-sm" data-cost-action="delete" data-id="${htmlEsc(entry.sourceId)}">Удалить</button></div>` : 'В первичном разделе'}</td>` : ''}</tr>`).join('')}</tbody></table></div>`;
}
function costIssuesHtml(issues) { return issues.length ? `<div class="cost-attention"><h4>Проверьте данные · ${issues.length}</h4><ul>${issues.map(issue => `<li>${htmlEsc(issue.message)}${issue.sourceKey ? `<small>${htmlEsc(issue.sourceKey)}</small>` : ''}</li>`).join('')}</ul></div>` : ''; }
function costExclusionsHtml(entries) { return entries.length ? `<details class="cost-review"><summary>Исключённые и связанные документы · ${entries.length}</summary><ul>${entries.map(entry => `<li><strong>${htmlEsc(entry.sourceLabel)} · ${htmlEsc(entry.date || 'без даты')} · ${costMoney(entry.amount)}</strong><p>${htmlEsc(entry.reason)}</p><small>${htmlEsc(entry.sourceKey)}</small></li>`).join('')}</ul></details>` : ''; }
async function costPersistRows(section, nextRows) {
  if (costPending) throw Error('Дождитесь завершения сохранения');
  if (!costCanWrite(section)) throw Error('Для вашей роли доступно только чтение');
  TvsCostEngine.validateSection(section, nextRows, data);
  const submitted = data, previousRows = data[section];
  data[section] = nextRows; costPending = true;
  try {
    const ok = await saveData(data);
    if (ok !== true) throw Error('Изменения не записаны. Введённые значения сохранены в форме; повторите после восстановления подключения.');
    if (typeof rebuildIndex === 'function') rebuildIndex();
    return true;
  } catch (error) {
    // Core save may already replace data with a rollback/merged remote snapshot.
    // Restore only our still-installed array; never overwrite such a snapshot.
    if (data === submitted && data[section] === nextRows) data[section] = previousRows;
    throw error;
  } finally { costPending = false; }
}
function costEditEntry(id) {
  if (!costCanWrite('costEntries')) { showToast('Для вашей роли доступно только чтение'); return; }
  if (!costAssets().length) { showToast('Сначала добавьте транспорт или ДЭС'); return; }
  const previous = (data.costEntries || []).find(row => row.id === id);
  if (id && !previous) { showToast('Операция уже удалена. Обновите раздел.'); return; }
  const baseline = previous ? JSON.stringify(previous) : null;
  const identity = costFormIdentity();
  const row = { ...(previous || { id:wfId('cost'), date:wfToday(), assetRef:costAssetRef || costAssets()[0].ref, kind:'expense', amount:null, title:'', category:'Прочее', note:'', independent:false }) };
  wfShowDialog(previous ? 'Изменить операцию' : 'Добавить расход или выручку', `<form id="costEntryForm" class="wf-form cost-form">
    <label><span>Техника *</span><select name="assetRef" required>${costAssetOptions(row.assetRef)}</select></label><label><span>Дата документа *</span><input name="date" type="date" required value="${htmlEsc(row.date)}"></label>
    <label><span>Тип *</span><select name="kind"><option value="expense" ${row.kind === 'expense' ? 'selected' : ''}>Расход</option><option value="income" ${row.kind === 'income' ? 'selected' : ''}>Выручка</option></select></label><label><span>Сумма, ₽ *</span><input name="amount" type="number" min="0" max="1000000000000" step="0.01" required value="${row.amount ?? ''}"></label>
    <label class="wf-wide"><span>Описание *</span><input name="title" maxlength="500" required value="${htmlEsc(row.title)}" placeholder="Например, аренда техники за октябрь"></label><label class="wf-wide"><span>Статья</span><input name="category" maxlength="200" list="costCategories" value="${htmlEsc(row.category || '')}"><datalist id="costCategories"><option>Заработная плата</option><option>Амортизация</option><option>Аренда</option><option>Страхование</option><option>Запчасти</option><option>ГСМ</option><option>Выручка</option><option>Прочее</option></datalist></label>
    <label class="wf-wide"><span>Примечание / основание</span><textarea name="note" maxlength="10000" rows="2">${htmlEsc(row.note || '')}</textarea></label><label class="wf-wide cost-confirm"><input name="independent" type="checkbox" required ${row.independent ? 'checked' : ''}><span>Это самостоятельная операция: она не повторяет сумму ремонта, ТО, заказа, заправки или платежа, уже включённую в расчёт.</span></label>
    <p class="wf-wide cost-note">Ноль можно ввести явно. Пустая сумма не считается нулевой. Для исправления суммы первичного документа откройте исходный раздел.</p><div id="costEntryError" class="wf-wide cost-form-error" role="alert"></div><div class="wf-wide cost-actions"><button class="btn btn-ghost" type="button" onclick="closeModal('wfModal')">Отмена</button><button class="btn btn-primary" type="submit">Сохранить</button></div></form>`);
  const form = document.getElementById('costEntryForm'); let busy = false;
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return;
    const error = form.querySelector('#costEntryError'), button = form.querySelector('[type="submit"]'); error.textContent = '';
    try { costAssertFormIdentity(identity); } catch (failure) { error.textContent = failure.message; return; }
    const values = new FormData(form), amount = TvsCostEngine.number(values.get('amount'));
    if (amount == null) { error.textContent = 'Укажите сумму не меньше нуля'; return; }
    const current = (data.costEntries || []).find(item => item.id === row.id);
    if (JSON.stringify(current || null) !== (baseline || 'null')) { error.textContent = 'Операция изменилась в другом окне. Закройте форму и откройте её заново; ваши значения остаются в полях.'; return; }
    const next = { ...row, date:values.get('date'), assetRef:values.get('assetRef'), kind:values.get('kind'), amount, title:String(values.get('title') || '').trim(), category:String(values.get('category') || '').trim(), note:String(values.get('note') || '').trim(), independent:values.get('independent') === 'on' };
    busy = true; button.disabled = true;
    try {
      await costPersistRows('costEntries', [...(data.costEntries || []).filter(item => item.id !== row.id), next]);
      closeModal('wfModal'); renderCostsSection(); showToast('Операция сохранена');
    } catch (failure) { error.textContent = failure.message || String(failure); }
    finally { busy = false; button.disabled = false; }
  });
}
function costEditProfile() {
  if (!costCanWrite('costProfiles')) { showToast('Для вашей роли доступно только чтение'); return; }
  if (!costAssets().length) { showToast('Сначала добавьте транспорт или ДЭС'); return; }
  let assetRef = costAssetRef || costAssets()[0].ref, previous = (data.costProfiles || []).find(row => row.assetRef === assetRef);
  const identity = costFormIdentity();
  let baseline = JSON.stringify(previous || null);
  wfShowDialog('Ставки для оценки затрат', `<form id="costProfileForm" class="wf-form cost-form"><label class="wf-wide"><span>Техника</span><select name="assetRef">${costAssetOptions(assetRef)}</select></label><p id="costRateUnit" class="wf-wide cost-note"></p>
    <label><span>Оплата труда, ₽/ед.</span><input type="number" name="salaryRate" min="0" max="1000000000" step="any"></label><label><span>Амортизация, ₽/ед.</span><input type="number" name="depreciationRate" min="0" max="1000000000" step="any"></label><label><span id="costFuelRateLabel">Норма топлива</span><input type="number" name="fuelRate" min="0" max="1000000000" step="any"></label><label><span>Цена топлива, ₽/л</span><input type="number" name="fuelPrice" min="0" max="1000000000" step="any"></label>
    <label class="wf-wide"><span>Основание ставок / примечание</span><textarea name="note" maxlength="10000" rows="2"></textarea></label><p class="wf-wide cost-note">Это отдельный сценарий по текущим ставкам, без включения в фактические документы. Оставьте поле пустым, если ставка неизвестна; введите 0, если статья действительно нулевая. Ремонт, налоги и прочие расходы в сценарий не входят.</p><div id="costProfileError" class="wf-wide cost-form-error" role="alert"></div><div class="wf-wide cost-actions"><button class="btn btn-ghost" type="button" onclick="closeModal('wfModal')">Отмена</button><button class="btn btn-primary" type="submit">Сохранить ставки</button></div></form>`);
  const form = document.getElementById('costProfileForm'), fields = ['salaryRate', 'depreciationRate', 'fuelRate', 'fuelPrice']; let busy = false;
  const populate = () => {
    assetRef = form.elements.assetRef.value; previous = (data.costProfiles || []).find(row => row.assetRef === assetRef); baseline = JSON.stringify(previous || null);
    const unit = assetRef.startsWith('v:') ? 'км' : 'ч';
    document.getElementById('costRateUnit').textContent = 'Единица оценки: ' + (unit === 'км' ? 'километр. Норма топлива — литры на 100 км.' : 'моточас. Норма топлива — литры на час.');
    document.getElementById('costFuelRateLabel').textContent = unit === 'км' ? 'Норма топлива, л/100 км' : 'Норма топлива, л/ч';
    fields.forEach(key => { form.elements[key].value = previous?.[key] ?? ''; }); form.elements.note.value = previous?.note || '';
  };
  populate(); form.elements.assetRef.addEventListener('change', populate);
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return;
    const error = document.getElementById('costProfileError'), button = form.querySelector('[type="submit"]'); error.textContent = '';
    try { costAssertFormIdentity(identity); } catch (failure) { error.textContent = failure.message; return; }
    const current = (data.costProfiles || []).find(row => row.assetRef === assetRef);
    if (JSON.stringify(current || null) !== baseline) { error.textContent = 'Ставки изменились в другом окне. Выберите технику заново, чтобы проверить актуальные значения.'; return; }
    const next = { ...(previous || { id:wfId('costprofile') }), assetRef, note:form.elements.note.value.trim() };
    for (const key of fields) { const raw = form.elements[key].value; next[key] = raw === '' ? null : TvsCostEngine.number(raw); if (raw !== '' && next[key] == null) { error.textContent = 'Введите неотрицательные ставки'; return; } }
    busy = true; button.disabled = true; form.elements.assetRef.disabled = true;
    try {
      await costPersistRows('costProfiles', [...(data.costProfiles || []).filter(row => row.assetRef !== assetRef), next]);
      closeModal('wfModal'); renderCostsSection(); showToast('Ставки сохранены');
    } catch (failure) { error.textContent = failure.message || String(failure); }
    finally { busy = false; button.disabled = false; form.elements.assetRef.disabled = false; }
  });
}
async function costDeleteEntry(id) {
  if (!costCanWrite('costEntries') || costPending) return;
  if (!(data.costEntries || []).some(row => row.id === id)) return;
  const identity = costFormIdentity(), baseline = JSON.stringify((data.costEntries || []).find(row => row.id === id));
  if (!await confirmAction('Удалить самостоятельную операцию из расчёта затрат?')) return;
  try {
    costAssertFormIdentity(identity);
    if (JSON.stringify((data.costEntries || []).find(row => row.id === id)) !== baseline) throw Error('Операция изменилась. Проверьте её заново перед удалением.');
    await costPersistRows('costEntries', (data.costEntries || []).filter(row => row.id !== id)); renderCostsSection(); showToast('Операция удалена');
  }
  catch (error) { showToast(error.message); }
}
