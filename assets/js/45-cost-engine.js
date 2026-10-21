/* Pure document-based operating cost calculation, shared by UI and storage validation. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(()=>require('../core/decimal-core.js'));
  else root.TvsCostEngine = factory(()=>root.DecimalCore);
})(typeof globalThis === 'object' ? globalThis : this, function (getDecimal) {
  'use strict';
  const SOURCES = ['vehicles', 'generators', 'records', 'genRecords', 'repairs', 'vehicleTo', 'toRecords', 'workOrders', 'payments', 'fuelPurchases', 'partMovements', 'costEntries', 'costProfiles'];
  const LABELS = { records:'Журнал ТС', genRecords:'Журнал ДЭС', repairs:'Ремонт', vehicleTo:'ТО транспорта', toRecords:'ТО ДЭС', workOrders:'Ремонтный заказ', payments:'Финансы', fuelPurchases:'Покупка ГСМ', costEntries:'Ручная операция', partMovements:'Движение запчастей' };
  const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const live = row => row && !row.deleted && !row.cancelled && row.status !== 'cancelled';
  const list = (db, key) => Array.isArray(db[key]) ? db[key] : [];
  function number(value) {
    if (value == null || value === '' || typeof value === 'boolean' || typeof value === 'object') return null;
    if (typeof value === 'string' && !value.trim()) return null;
    const result = typeof value === 'number' ? value : Number(String(value).trim().replace(',', '.'));
    return Number.isFinite(result) && result >= 0 ? result : null;
  }
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T12:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function dateOf(value) { const valueDate = typeof value === 'string' ? value.slice(0, 10) : ''; return validDate(valueDate) ? valueDate : ''; }
  function decimal(){const api=getDecimal();if(!api||api.apiVersion!==1)throw Object.assign(Error('Не загружено десятичное ядро денежных расчётов'),{code:'MODULE_UNAVAILABLE'});return api;}
  function exactSum(values){return decimal().toNumberExact(decimal().sum(values));}
  function amountSum(rows) { return rows.length ? exactSum(rows.map(row=>row.amount)) : null; }
  function differenceExceeds(a,b,tolerance){const difference=decimal().sub(a,b);return decimal().compare(difference,tolerance)>0||decimal().compare(difference,decimal().sub(0,tolerance))<0;}
  function roundedMoney(value){return decimal().toNumberExact(decimal().quantize(value,{scale:2,rounding:'half-away-from-zero'}));}
  function norm(value) { return String(value || '').trim().replace(/\s+/g, '').toLocaleLowerCase('ru'); }
  function invoiceKey(entry) {
    return entry.assetRef && entry.invoiceNo && entry.date ? [entry.assetRef, entry.date, norm(entry.invoiceNo), norm(entry.party), entry.party ? '' : String(entry.amount)].join('|') : '';
  }
  function refOf(row) { return row.assetRef || (row.vehicleId ? 'v:' + row.vehicleId : row.generatorId ? 'g:' + row.generatorId : ''); }
  function checkObject(row) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw Error('Операция должна быть объектом');
    const scan = value => {
      if (!value || typeof value !== 'object') return;
      for (const key of Object.keys(value)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw Error('Недопустимое поле операции');
        scan(value[key]);
      }
    };
    scan(row);
  }
  function text(row, field, maximum, required) {
    if (row[field] == null && !required) return;
    if (typeof row[field] !== 'string' || row[field].length > maximum || (required && !row[field].trim())) throw Error('Проверьте поле «' + field + '»');
  }
  /** Throws on invalid financial rows. db is the complete prospective database snapshot. */
  function validateSection(section, rows, db) {
    if (!['costEntries', 'costProfiles'].includes(section) || !Array.isArray(rows)) throw Error('Недопустимый раздел расчёта затрат');
    if (rows.length > 100000) throw Error('Слишком много операций расчёта затрат');
    const ids = new Set(), profiles = new Set();
    const refs = new Set([...list(db || {}, 'vehicles').map(row => 'v:' + row.id), ...list(db || {}, 'generators').map(row => 'g:' + row.id)]);
    rows.forEach(row => {
      checkObject(row); text(row, 'id', 200, true);
      if (ids.has(row.id) || ['__proto__', 'constructor', 'prototype'].includes(row.id)) throw Error('ID операций должны быть уникальными');
      ids.add(row.id);
      if (typeof row.assetRef !== 'string' || !/^[vg]:.+/.test(row.assetRef) || !refs.has(row.assetRef)) throw Error('Выберите существующий транспорт или ДЭС');
      text(row, 'note', 10000);
      if (section === 'costEntries') {
        if (!validDate(row.date)) throw Error('Укажите действительную дату операции');
        if (!['expense', 'income'].includes(row.kind)) throw Error('Выберите расход или выручку');
        if (typeof row.amount !== 'number' || number(row.amount) == null || row.amount > 1e12) throw Error('Сумма должна быть числом от 0 до 1 000 000 000 000');
        text(row, 'title', 500, true); text(row, 'category', 200);
        if (row.independent !== true) throw Error('Подтвердите, что операция не дублирует учтённый документ');
      } else {
        if (profiles.has(row.assetRef)) throw Error('Для каждой единицы техники допускается один профиль ставок');
        profiles.add(row.assetRef);
        for (const key of ['salaryRate', 'depreciationRate', 'fuelRate', 'fuelPrice']) {
          if (row[key] == null) continue;
          if (typeof row[key] !== 'number' || number(row[key]) == null || row[key] > 1e9) throw Error('Ставки должны быть неотрицательными числами или пустыми');
        }
      }
    });
    return true;
  }
  function scenario(profile, quantity, unit) {
    if (!profile) return null;
    const salaryRate = number(profile.salaryRate), depreciationRate = number(profile.depreciationRate);
    const fuelRate = number(profile.fuelRate), fuelPrice = number(profile.fuelPrice);
    const rawFuelRate=fuelRate!=null&&fuelPrice!=null?decimal().mul(fuelRate,fuelPrice):null;
    const fuelDivisor=unit==='км'?100:1;
    const pieces = [
      { key:'salary', label:'Оплата труда', rate:salaryRate },
      { key:'depreciation', label:'Амортизация', rate:depreciationRate },
      { key:'fuel', label:'Топливо по норме', rate:rawFuelRate!=null?decimal().toNumberExact(decimal().div(rawFuelRate,fuelDivisor,{scale:6,rounding:'half-away-from-zero'})):null },
    ].map(piece => ({ ...piece, amount:piece.rate!=null&&quantity!=null?piece.key==='fuel'
      ?decimal().toNumberExact(decimal().div(decimal().mul(rawFuelRate,quantity),fuelDivisor,{scale:2,rounding:'half-away-from-zero'}))
      :roundedMoney(decimal().mul(piece.rate,quantity)):null }));
    const known = pieces.filter(piece => piece.rate != null);
    return { pieces, rate:known.length ? exactSum(known.map(piece=>piece.rate)) : null,
      amount:known.length && quantity != null ? exactSum(known.map(piece=>piece.amount)) : null,
      complete:known.length === pieces.length, fuelRate, fuelPrice, note:profile.note || '' };
  }
  function buildReport(database, options) {
    options = options || {}; database = database || {};
    const from = options.from || '', to = options.to || '';
    if ((from && !validDate(from)) || (to && !validDate(to)) || (from && to && from > to)) throw Error('Проверьте начало и конец периода');
    const allowed = Array.isArray(options.readable) ? new Set(options.readable) : null;
    const db = Object.fromEntries(SOURCES.map(section => [section, !allowed || allowed.has(section) ? list(database, section) : []]));
    const allAssets = [...db.vehicles.map(row => ({ assetRef:'v:' + row.id, label:[row.plate, row.make].filter(Boolean).join(' · ') || row.id, kind:'vehicle', row })),
      ...db.generators.map(row => ({ assetRef:'g:' + row.id, label:'ДЭС ' + (row.name || row.id), kind:'generator', row }))];
    const knownAssetRefs = new Set(allAssets.map(asset => asset.assetRef));
    const assets = allAssets.filter(asset => (!options.assetRef || asset.assetRef === options.assetRef) && (!options.kind || asset.kind === options.kind));
    const rows = assets.map(asset => ({ ...asset, unit:asset.kind === 'vehicle' ? 'км' : 'ч', entries:[], estimates:[], exclusions:[], issues:[], quantityRows:[], unknownQuantityRows:0 }));
    const rowMap = new Map(rows.map(row => [row.assetRef, row]));
    const refInScope = ref => {
      if (!ref || rowMap.has(ref)) return true;
      // An existing card outside the requested filter is not an orphan.
      if (knownAssetRefs.has(ref) || options.assetRef && ref !== options.assetRef) return false;
      if (options.kind && (options.kind === 'vehicle' ? !ref.startsWith('v:') : !ref.startsWith('g:'))) return false;
      const section = ref.startsWith('v:') ? 'vehicles' : ref.startsWith('g:') ? 'generators' : '';
      return !allowed || !section || allowed.has(section);
    };
    const unassigned = [], exclusions = [], issues = [], seen = new Set(), documents = [], invoiceMap = new Map();
    const inPeriod = date => !!date && (!from || date >= from) && (!to || date <= to);
    const issue = (ref, code, message, sourceKey) => {
      if (!refInScope(ref)) return;
      const target = rowMap.get(ref), item = { code, message, sourceKey:sourceKey || '', assetRef:ref || '' };
      const key = [ref, code, sourceKey || '', message].join('|');
      if (seen.has(key)) return; seen.add(key);
      if (target) target.issues.push(item); else if (!options.assetRef || !ref || ref === options.assetRef) issues.push(item);
    };
    const exclude = (entry, message, important) => {
      if (!refInScope(entry.assetRef)) return;
      const item = { ...entry, reason:message, review:!!important };
      const target = rowMap.get(entry.assetRef);
      if (target) target.exclusions.push(item);
      else if (!options.assetRef || entry.assetRef === options.assetRef || !entry.assetRef) exclusions.push(item);
      if (important) issue(entry.assetRef, 'review', message, entry.sourceKey);
    };
    const sourceEntry = (source, row, fields) => ({ source, sourceKey:source + ':' + (row.id || ''), sourceId:row.id || '', sourceLabel:LABELS[source] || source,
      party:row.contragentId ? 'id:' + row.contragentId : row.contragent || row.performer || row.supplier || '',
      assetRef:refOf(row), title:row.title || row.description || row.type || row.category || LABELS[source], invoiceNo:row.invoiceNo || '', kind:'expense', ...fields });
    const add = (entry, primary) => {
      if (!refInScope(entry.assetRef)) return;
      if (!entry.date) { issue(entry.assetRef, 'date', entry.sourceLabel + ': дата не задана или недействительна; запись исключена', entry.sourceKey); return; }
      if (!inPeriod(entry.date)) return;
      if (entry.assetRef && !knownAssetRefs.has(entry.assetRef)) {
        const message = 'Карточка техники ' + entry.assetRef + ' не найдена. Документ требует сверки; сумма не распределена по парку.';
        issue(entry.assetRef, 'orphan-asset', message, entry.sourceKey);
        unassigned.push({ ...entry, review:true, reason:message,
          sourceLabel:entry.sourceLabel + (entry.estimated ? ' · оценка' : ''), note:[entry.note, message].filter(Boolean).join(' ') });
        return;
      }
      if (entry.amount == null) { issue(entry.assetRef, 'amount', entry.sourceLabel + ': сумма не задана; не считается нулевой', entry.sourceKey); return; }
      try{decimal().parse(entry.amount,{scale:2,max:'1000000000000'});}
      catch(error){if(error.code==='MODULE_UNAVAILABLE')throw error;entry.precisionLegacy=true;issue(entry.assetRef,'precision','Историческая сумма показана с исходной точностью; источник не округлён и не изменён',entry.sourceKey);}
      if (entry.estimated) { const target = rowMap.get(entry.assetRef); if (target) target.estimates.push(entry); return; }
      const key = invoiceKey(entry);
      if (key && invoiceMap.has(key)) {
        const previous = invoiceMap.get(key);
        exclude(entry, 'Спорное совпадение реквизитов счёта ' + entry.invoiceNo + ' на одну дату для той же техники; временно учтён ' + previous.sourceLabel + (differenceExceeds(previous.amount,entry.amount,'0.005') ? '. Суммы различаются — нужна сверка' : '. Проверьте, не самостоятельные ли это операции'), true); return;
      }
      if (key) invoiceMap.set(key, entry);
      const target = rowMap.get(entry.assetRef);
      if (target) target.entries.push(entry);
      else unassigned.push(entry);
      if (primary) documents.push(entry);
    };
    // Only actual journal distances/hours are denominators. Jobs and shifts may
    // repeat journals, and GLONASS kilometres are a separate comparison metric.
    for (const target of rows) {
      const section = target.kind === 'vehicle' ? 'records' : 'genRecords', field = target.kind === 'vehicle' ? 'km' : 'hours';
      if (allowed && !allowed.has(section)) issue(target.assetRef, 'access', 'Нет доступа к журналу ' + target.unit + '; показатель на единицу недоступен');
      for (const row of db[section].filter(row => live(row) && refOf(row) === target.assetRef)) {
        const date = dateOf(row.date);
        if (!date) { target.unknownQuantityRows++; issue(target.assetRef, 'date', 'В журнале есть запись без действительной даты; нельзя определить её период', section + ':' + row.id); continue; }
        if (!inPeriod(date)) continue;
        const quantity = number(row[field]);
        // Fuel-only synthetic records do not certify a zero kilometre/hour day.
        if (quantity == null) { target.unknownQuantityRows++; continue; }
        target.quantityRows.push({ sourceKey:section + ':' + row.id, date, quantity });
      }
      target.quantity = target.quantityRows.length ? exactSum(target.quantityRows.map(row=>row.quantity)) : null;
      target.quantityComplete = target.quantityRows.length > 0 && target.unknownQuantityRows === 0 && (!allowed || allowed.has(section));
      if (target.unknownQuantityRows) issue(target.assetRef, 'quantity', 'В ' + target.unknownQuantityRows + ' строках журнала не указаны ' + target.unit + '; расчёт на единицу недоступен');
    }
    for (const row of db.repairs.filter(live)) add(sourceEntry('repairs', row, { date:dateOf(row.invoiceDate), amount:number(row.cost), category:'Ремонт' }), true);
    for (const section of ['vehicleTo', 'toRecords']) for (const row of db[section].filter(live)) {
      const entry = sourceEntry(section, row, { date:dateOf(row.date), amount:number(row.cost), category:'ТО' });
      if (row.planned) { if (inPeriod(entry.date)) exclude(entry, 'Плановое ТО: фактические затраты ещё не подтверждены', false); continue; }
      add(entry, true);
    }
    for (const row of db.workOrders.filter(live)) {
      const entry = sourceEntry('workOrders', row, { date:dateOf(row.downtimeTo || row.completedAt), amount:number(row.actualCost != null && row.actualCost !== '' ? row.actualCost : row.incurred === true ? row.cost : null), category:'Ремонт' });
      if (row.status !== 'accepted') { if (inPeriod(entry.date)) exclude(entry, 'Заказ не принят: согласованная сумма не является фактическим расходом', false); continue; }
      if (row.repairId || row.vehicleToId || row.toRecordId) { if (inPeriod(entry.date)) exclude(entry, 'Заказ связан с первичным журналом; используется сумма журнала', true); continue; }
      const possible = documents.find(document => document.assetRef === entry.assetRef && document.date === entry.date && document.category === 'Ремонт');
      if (possible && !entry.invoiceNo) { if (inPeriod(entry.date)) exclude(entry, 'На эту дату уже есть ремонт в журнале. Подтвердите отдельный расход ручной операцией, если заказ самостоятельный', true); continue; }
      add(entry, true);
    }
    // Journal fuelSum already includes linked purchase sums. Purchases are the
    // primary documents; never sum them again with the aggregate journal field.
    const recordsById = new Map(db.records.map(row => [row.id, row])), coveredRecords = new Set();
    const groups = new Map(), purchaseEntries = [];
    for (const purchase of db.fuelPurchases.filter(live)) {
      const entry = sourceEntry('fuelPurchases', purchase, { date:dateOf(purchase.date), amount:number(purchase.sum), title:purchase.product || purchase.grade || 'Покупка топлива', category:'ГСМ · закупки', estimated:!!purchase.restored });
      let record = recordsById.get(purchase.recordId);
      if (record && (!live(record) || record.vehicleId !== purchase.vehicleId || dateOf(record.date) !== entry.date)) record = null;
      let candidates = record ? [record] : db.records.filter(row => live(row) && row.vehicleId === purchase.vehicleId && dateOf(row.date) === entry.date && (!purchase.grade || row.fuelGrade === purchase.grade));
      if (candidates.length === 1) {
        record = candidates[0]; coveredRecords.add(record.id);
        if (!groups.has(record.id)) groups.set(record.id, []);
        groups.get(record.id).push(entry);
      } else if (candidates.length > 1) {
        if (!entry.estimated) candidates.forEach(row => coveredRecords.add(row.id));
        if (inPeriod(entry.date)) issue(entry.assetRef, 'fuel-link', entry.estimated
          ? 'Восстановленная покупка неоднозначно связана с журналом. Оценка не заменяет сохранённые суммы журналов; нужна сверка'
          : 'Несколько строк журнала для покупки ГСМ: в расходах используются только покупки; суммы журналов исключены', entry.sourceKey);
      }
      purchaseEntries.push(entry);
    }
    const aggregateCoveredEntries = new Set();
    for (const [recordId, entries] of groups) {
      const record = recordsById.get(recordId), journal = number(record.fuelSum), exact = entries.filter(entry => !entry.estimated && entry.amount != null);
      if (journal != null && entries.some(entry => entry.estimated)) {
        // fpRestoreFromJournal creates uncertain purchase splits from this
        // previously recorded aggregate. Those splits must not erase its fact
        // or be added again alongside it, even when some purchases are exact.
        const note = 'Есть восстановленные покупки ГСМ; сохранена известная общая сумма журнала. Покупки группы не добавляются к ней повторно: ' + entries.map(entry => entry.sourceKey).join(', ');
        add(sourceEntry('records', record, { date:dateOf(record.date), amount:journal, title:'ГСМ · сохранённая сумма журнала', category:'ГСМ · закупки', note }), true);
        entries.forEach(entry => aggregateCoveredEntries.add(entry));
        if (inPeriod(dateOf(record.date))) issue(refOf(record), 'fuel-restored', note, 'records:' + recordId);
      }
      if (inPeriod(dateOf(record.date)) && journal != null && exact.length === entries.length && differenceExceeds(journal,exactSum(exact.map(entry=>entry.amount)),'0.01'))
        issue(refOf(record), 'fuel-sum', 'Сумма журнала ГСМ отличается от покупок; учтены покупки, разность автоматически не добавлена', 'records:' + recordId);
    }
    for (const entry of purchaseEntries) {
      if (aggregateCoveredEntries.has(entry) && !entry.estimated) {
        if (inPeriod(entry.date)) exclude(entry, 'Покупка входит в сохранённую общую сумму журнала; в группе есть восстановленные оценки. Повторно не добавлена', false);
      } else add(entry, true);
    }
    for (const section of ['records', 'genRecords']) for (const row of db[section].filter(live)) {
      const date = dateOf(row.date), ref = refOf(row);
      if (!inPeriod(date) || (options.assetRef && ref !== options.assetRef)) continue;
      if (section === 'records' && coveredRecords.has(row.id)) continue;
      const amount = number(row.fuelSum);
      if (amount != null) add(sourceEntry(section, row, { date, amount, title:'ГСМ по журналу', category:'ГСМ · закупки' }), true);
      else if (number(row.fuelIssued) > 0 || number(row.fuelActual) > 0 || number(row.fuelUsed) > 0)
        issue(ref, 'fuel-price', 'Для топлива есть литры, но нет суммы документа; стоимость не считается нулевой', section + ':' + row.id);
    }
    const sourceSections = { repair:'repairs', to:'vehicleTo', workOrder:'workOrders', fuelPurchase:'fuelPurchases', vehicleTo:'vehicleTo', toRecord:'toRecords' };
    for (const row of db.payments.filter(live)) {
      const entry = sourceEntry('payments', row, { date:dateOf(row.date), amount:number(row.sum), category:row.category || 'Прочее' });
      if (!inPeriod(entry.date)) { if (!entry.date) add(entry); continue; }
      if (row.sourceId && own(sourceSections, row.source)) {
        const section = sourceSections[row.source], source = db[section].find(item => item.id === row.sourceId && live(item));
        exclude(entry, source ? 'Связанный платёж: расход учитывается по первичному документу' : 'Источник связанного платежа отсутствует или недоступен; требуется сверка', !source); continue;
      }
      const invoice = entry.invoiceNo && documents.find(item => invoiceKey(item) === invoiceKey(entry));
      if (invoice) { exclude(entry, 'Спорное совпадение даты, счёта и техники с первичным документом; исключено до сверки' + (differenceExceeds(invoice.amount,entry.amount,'0.005') ? '; суммы различаются' : ''), true); continue; }
      if (/ремонт|топлив|гсм|запчаст|^то$/i.test(row.category || '')) { exclude(entry, 'Платёж ремонт/ТО/ГСМ без связи с первичным документом. Исключён до сверки, чтобы не повторить расход', true); continue; }
      add(entry);
    }
    for (const row of db.costEntries.filter(live)) {
      const entry = sourceEntry('costEntries', row, { date:dateOf(row.date), amount:number(row.amount), kind:row.kind, category:row.category || (row.kind === 'income' ? 'Выручка' : 'Прочее'), note:row.note || '' });
      if (!['expense', 'income'].includes(row.kind) || row.independent !== true) { if (inPeriod(entry.date)) exclude(entry, 'Ручная операция не подтверждена как самостоятельная', true); continue; }
      // A manual operation is explicitly certified as independent by the user.
      add(entry);
    }
    for (const row of db.partMovements.filter(row => live(row) && ['issue', 'writeoff'].includes(row.kind))) {
      if (row.assetRef && inPeriod(dateOf(row.date)) && !row.workOrderId) issue(row.assetRef, 'parts-price', 'В движении запчастей нет стоимости; внесите отдельный расход, если он не включён в ремонт', 'partMovements:' + row.id);
    }
    for (const target of rows) {
      target.expenses = amountSum(target.entries.filter(entry => entry.kind === 'expense'));
      target.income = amountSum(target.entries.filter(entry => entry.kind === 'income'));
      target.rate = target.expenses != null && target.quantityComplete && target.quantity > 0 ? decimal().toNumberExact(decimal().div(target.expenses,target.quantity,{scale:6,rounding:'half-away-from-zero'})) : null;
      target.result = target.expenses != null && target.income > 0 ? decimal().toNumberExact(decimal().sub(target.income,target.expenses)) : null;
      target.margin = target.result != null ? target.result / target.income * 100 : null;
      const profiles = db.costProfiles.filter(profile => profile.assetRef === target.assetRef);
      target.scenario = profiles.length === 1 ? scenario(profiles[0], target.quantityComplete ? target.quantity : null, target.unit) : null;
      if (profiles.length > 1) issue(target.assetRef, 'profile', 'Найдено несколько профилей ставок; оценка недоступна до сверки');
      target.entries.sort((a, b) => b.date.localeCompare(a.date) || a.sourceKey.localeCompare(b.sourceKey));
    }
    const exactExpenses = rows.flatMap(row => row.entries.filter(entry => entry.kind === 'expense'));
    const exactIncome = rows.flatMap(row => row.entries.filter(entry => entry.kind === 'income'));
    return { calculationVersion:2,from, to, rows, unassigned, exclusions, issues,
      totals:{ expenses:amountSum(exactExpenses), income:amountSum(exactIncome), review:rows.reduce((sum, row) => sum + row.exclusions.filter(entry => entry.review).length, 0) + exclusions.filter(entry => entry.review).length + unassigned.filter(entry => entry.review).length },
      unavailable:allowed ? SOURCES.filter(section => !allowed.has(section)) : [],
      method:'Учтённые расходы по датам первичных документов. Покупки ГСМ признаются в дату покупки и не означают стоимость израсходованного топлива. Журналы пробега и наработки — единственный источник км/ч. Полная себестоимость и прибыль могут отличаться: неучтённые расходы не заменяются нулями.' };
  }
  return Object.freeze({ buildReport, validateSection, number, validDate, scenario, sourceLabels:LABELS });
});
