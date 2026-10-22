/* Pure document-based operating cost calculation, shared by UI and storage validation. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(()=>require('../core/decimal-core.js'),()=>require('../core/effective-periods.js'),()=>require('../core/document-engine.js'),()=>require('../core/cost-valuation.js'),()=>require('../core/cost-operations.js'),()=>require('../core/financial-recognition.js'),()=>require('../core/entity-identity.js'));
  else root.TvsCostEngine = factory(()=>root.DecimalCore,()=>root.EffectivePeriods,()=>root.DocumentEngine,()=>root.CostValuation,()=>root.CostOperations,()=>root.DomainSources,()=>root.EntityIdentity);
})(typeof globalThis === 'object' ? globalThis : this, function (getDecimal,getPeriods,getDocuments,getValuation,getCostOperations,getSources,getIdentity) {
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
  function periods(){let api;try{api=getPeriods();}catch{}if(api?.apiVersion!==1)throw Object.assign(Error('Не загружены правила периодов ставок'),{code:'MODULE_UNAVAILABLE'});return api;}
  function norm(value) { return String(value || '').trim().replace(/\s+/g, '').toLocaleLowerCase('ru'); }
  function invoiceKey(entry) {
    return entry.assetRef && entry.invoiceNo && entry.date ? [entry.assetRef, entry.date, norm(entry.invoiceNo), norm(entry.party), entry.party ? '' : String(entry.amount)].join('|') : '';
  }
  function refOf(row) { return row.assetRef || (row.vehicleId!=null&&row.vehicleId!=='' ? 'v:' + row.vehicleId : row.generatorId!=null&&row.generatorId!=='' ? 'g:' + row.generatorId : ''); }
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
      // Semantic allocation rows have their own independently replanned proof.
      if(section==='costEntries'&&row.kind==='allocation'&&row.costAllocation?.version===1)return;
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
  function scenario(profile, quantity, unit, date) {
    if (!profile) return null;
    if(own(profile,'ratePeriods')){
      const resolved=periods().resolve('costProfiles',profile,date,'ratePeriods');
      if(resolved.status!=='known')return {pieces:[],rate:null,amount:null,complete:false,mode:'dated',coverageComplete:false,uncoveredQuantity:quantity,note:profile.note||''};
      return {...scenario({...resolved.parameters,note:profile.note},quantity,unit),mode:'dated',periodId:resolved.periodId,from:resolved.from,toExclusive:resolved.toExclusive,basis:resolved.basis||'',coverageComplete:true};
    }
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
  function datedScenario(profile, quantityRows, unit, quantityComplete){
    const api=periods();api.validate('costProfiles',profile,'ratePeriods');
    const groups=new Map();
    for(const row of quantityRows){
      const selected=api.resolve('costProfiles',profile,row.date,'ratePeriods'),key=JSON.stringify([selected.status,typeof selected.periodId,selected.periodId??null,selected.from??null,selected.toExclusive??null]);
      if(!groups.has(key))groups.set(key,{selected,dates:[],quantities:[]});const group=groups.get(key);group.dates.push(row.date);group.quantities.push(row.quantity);
    }
    const values=[...groups.values()].map(group=>{
      const selected=group.selected,quantity=exactSum(group.quantities),value=selected.status==='known'?scenario({...selected.parameters,note:profile.note},quantityComplete?quantity:null,unit):{pieces:[],rate:null,amount:null,complete:false};
      return {...value,status:selected.status,periodId:selected.periodId??null,from:selected.from??null,toExclusive:selected.toExclusive??null,basis:selected.basis||'',parameters:selected.parameters,quantity,firstRecordDate:group.dates.slice().sort()[0],lastRecordDate:group.dates.slice().sort().at(-1)};
    }).sort((a,b)=>a.firstRecordDate.localeCompare(b.firstRecordDate));
    const covered=values.filter(value=>value.status==='known'),coverageComplete=!!values.length&&quantityComplete&&covered.length===values.length;
    const same=(list,field)=>list.length&&list[0][field]!=null&&list.every(value=>value[field]!=null&&decimal().compare(value[field],list[0][field])===0)?list[0][field]:null;
    const pieces=['salary','depreciation','fuel'].map(key=>{
      const matched=values.map(value=>value.pieces.find(piece=>piece.key===key)),known=matched.filter(piece=>piece?.amount!=null),first=matched.find(Boolean);
      return {key,label:first?.label||{salary:'Оплата труда',depreciation:'Амортизация',fuel:'Топливо по норме'}[key],rate:matched.every(Boolean)?same(matched,'rate'):null,amount:matched.length&&matched.every(piece=>piece?.amount!=null)?exactSum(matched.map(piece=>piece.amount)):null,knownAmount:known.length?exactSum(known.map(piece=>piece.amount)):null};
    });
    const known=covered.filter(value=>value.amount!=null);
    return {mode:'dated',historyVersion:1,periods:values,pieces,rate:coverageComplete?same(values,'rate'):null,amount:coverageComplete&&known.length===values.length?exactSum(known.map(value=>value.amount)):null,knownAmount:known.length?exactSum(known.map(value=>value.amount)):null,
      complete:coverageComplete&&values.every(value=>value.complete),coverageComplete,uncoveredQuantity:exactSum(values.filter(value=>value.status!=='known').map(value=>value.quantity)),fuelRate:coverageComplete?same(values,'fuelRate'):null,fuelPrice:coverageComplete?same(values,'fuelPrice'):null,note:profile.note||''};
  }
  function buildReport(database, options) {
    options = options || {}; database = database || {};
    const from = options.from || '', to = options.to || '';
    if ((from && !validDate(from)) || (to && !validDate(to)) || (from && to && from > to)) throw Error('Проверьте начало и конец периода');
    const allowed = Array.isArray(options.readable) ? new Set(options.readable) : null;
    const db = Object.fromEntries(SOURCES.map(section => [section, !allowed || allowed.has(section) ? list(database, section) : []]));
    const documentIdentities=new Map(),documentIssues=[];
    for(const section of ['repairs','vehicleTo','toRecords','workOrders','payments','partMovements']){
      if(!db[section].some(row=>own(row,'lifecycle')||own(row,'paymentSettlements')))continue;
      const engine=getDocuments?.();if(engine?.apiVersion!==1)throw Object.assign(Error('Не загружены правила версий документов'),{code:'MODULE_UNAVAILABLE'});
      const resolved=engine.resolveSection(db,section);db[section]=resolved.rows;documentIssues.push(...resolved.diagnostics.map(item=>({...item,sourceSection:section})));
      documentIdentities.set(section,new Map(resolved.identities.map(item=>[item.id,item])));
    }
    const allAssets = [...db.vehicles.map(row => ({ assetRef:'v:' + row.id, label:[row.plate, row.make].filter(Boolean).join(' · ') || row.id, kind:'vehicle', row })),
      ...db.generators.map(row => ({ assetRef:'g:' + row.id, label:'ДЭС ' + (row.name || row.id), kind:'generator', row }))];
    const knownAssetRefs = new Set(allAssets.map(asset => asset.assetRef));
    const assets = allAssets.filter(asset => (!options.assetRef || asset.assetRef === options.assetRef) && (!options.kind || asset.kind === options.kind));
    const identities=new Map();for(const asset of allAssets)identities.set(asset.assetRef,(identities.get(asset.assetRef)||0)+1);
    if(assets.some(asset=>identities.get(asset.assetRef)!==1))throw Object.assign(Error('Ссылка на технику неоднозначна. Проверьте совпадающие ID карточек перед расчётом стоимости.'),{code:'AMBIGUOUS_ASSET'});
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
    const sourceEntry = (source, row, fields) => {const identity=documentIdentities.get(source)?.get(row.id);return { source, sourceKey:source + ':' + (identity?.recognitionKey??row.id??''), sourceId:row.id??'', ...(identity?{rootSourceId:identity.rootId,recognitionKey:identity.recognitionKey}:{}),sourceLabel:LABELS[source] || source,
      party:row.contragentId!=null&&row.contragentId!=='' ? 'id:' + JSON.stringify(row.contragentId) : row.contragent || row.performer || row.supplier || '',
      assetRef:refOf(row), title:row.title || row.description || row.type || row.category || LABELS[source], invoiceNo:row.invoiceNo || '', kind:'expense', ...fields };};
    for(const diagnostic of documentIssues)issue(diagnostic.assetRef||'',diagnostic.code||'document-version',diagnostic.message||'Версии документа требуют сверки',diagnostic.sourceSection+':'+(diagnostic.id??''));
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
      if ([row.repairId,row.vehicleToId,row.toRecordId].some(value=>value!==undefined&&value!==null&&value!=='')) { if (inPeriod(entry.date)) exclude(entry, 'Заказ связан с первичным журналом; используется сумма журнала', true); continue; }
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
      if(['tankIncome','partReceipt'].includes(row.source)&&row.sourceId!==undefined&&row.sourceId!==null&&row.sourceId!==''){exclude(entry,'Обязательство связано с приобретением запаса; поступление и расходование показаны в полной себестоимости отдельно от оплаты',false);continue;}
      if (row.sourceId!=null&&row.sourceId!=='' && own(sourceSections, row.source)) {
        const section = sourceSections[row.source], source = db[section].find(item => (documentIdentities.get(section)?.get(item.id)?.rootId??item.id) === row.sourceId && live(item));
        if(source){const amount=number(section==='workOrders'?source.actualCost??(source.incurred===true?source.cost:null):source.cost);if(amount!=null&&entry.amount!=null&&differenceExceeds(amount,entry.amount,'0.005'))issue(entry.assetRef,'source-discrepancy','Сумма сохранённого расхода отличается от действующей версии первичного документа; требуется сверка',entry.sourceKey);}
        exclude(entry, source ? 'Связанный платёж: расход учитывается по первичному документу' : 'Источник связанного платежа отсутствует или недоступен; требуется сверка', !source); continue;
      }
      const invoice = entry.invoiceNo && documents.find(item => invoiceKey(item) === invoiceKey(entry));
      if (invoice) { exclude(entry, 'Спорное совпадение даты, счёта и техники с первичным документом; исключено до сверки' + (differenceExceeds(invoice.amount,entry.amount,'0.005') ? '; суммы различаются' : ''), true); continue; }
      if (/ремонт|топлив|гсм|запчаст|^то$/i.test(row.category || '')) { exclude(entry, 'Платёж ремонт/ТО/ГСМ без связи с первичным документом. Исключён до сверки, чтобы не повторить расход', true); continue; }
      add(entry);
    }
    for (const row of db.costEntries.filter(live)) {
      const entry = sourceEntry('costEntries', row, { date:dateOf(row.date), amount:number(row.amount), kind:row.kind, category:row.category || (row.kind === 'income' ? 'Выручка' : 'Прочее'), note:row.note || '' });
      if(row.kind==='allocation'&&row.costAllocation?.version===1){if(inPeriod(entry.date))exclude(entry,'Распределение первичного расхода показано в полной себестоимости; новый расход не создаётся',false);continue;}
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
      target.scenario = profiles.length === 1 ? own(profiles[0],'ratePeriods')?datedScenario(profiles[0],target.quantityRows,target.unit,target.quantityComplete):scenario(profiles[0], target.quantityComplete ? target.quantity : null, target.unit) : null;
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
  /** Inventory consumption, document expenses and cash remain separate views. */
  function buildFullReport(database,options={}){
    const db=database||{},allowed=Array.isArray(options.readable)?new Set(options.readable):null,can=name=>!allowed||allowed.has(name),from=options.from||null,to=options.to||null;
    if(from&&!validDate(from)||to&&!validDate(to)||from&&to&&from>to)throw Error('Проверьте период полной себестоимости');
    const ids=getIdentity(),valuationApi=getValuation(),costs=getCostOperations(),sourcesApi=getSources();
    if(ids?.apiVersion!==1||valuationApi?.apiVersion!==1||costs?.apiVersion!==1||typeof sourcesApi?.projectExpenses!=='function')throw Object.assign(Error('Не загружено ядро полной себестоимости'),{code:'MODULE_UNAVAILABLE'});
    const key=target=>ids.typedKey(target.section,target.id),issues=[],unavailable=[],unassigned=[],inPeriod=date=>typeof date==='string'&&(!from||date>=from)&&(!to||date<=to),rows=[],byTarget=new Map();
    const notice=(code,message,source=null,target=null)=>{const item={severity:'error',code,message,...(source?{source}:{}),...(target?{target}:{})};issues.push(item);const row=target&&byTarget.get(key(target));if(row){row.complete=false;row.issues.push(item);}return item;};
    let selected=null,selection=null;if(options.assetRef){const resolved=ids.resolveAsset(db,options.assetRef,{v:'vehicles',g:'generators'});if(resolved.status!=='known')throw Object.assign(Error('Техника для отчёта не найдена однозначно'),{code:'AMBIGUOUS_ASSET'});selected={section:resolved.section,id:resolved.id};selection=new Set([key(selected)]);}
    if(options.targets!==undefined){if(!Array.isArray(options.targets))throw Object.assign(Error('Нужны типизированные цели отчёта'),{code:'COST_TARGET'});selection=new Set();for(const target of options.targets){if(!target||!['tanks','parts','vehicles','generators'].includes(target.section)||!ids.identifier(target.id))throw Object.assign(Error('Некорректная цель отчёта'),{code:'COST_TARGET'});if(!can(target.section))throw Object.assign(Error('Цель отчёта недоступна'),{code:'ACCESS_DENIED'});if(list(db,target.section).filter(value=>value.id===target.id).length!==1)throw Object.assign(Error('Цель отчёта не найдена однозначно'),{code:'COST_TARGET'});if(selection.has(key(target)))throw Object.assign(Error('Цели отчёта повторяются'),{code:'COST_TARGET'});selection.add(key(target));}}
    const selectedTarget=target=>!selection||!!target&&selection.has(key(target));
    if(!selection&&options.kind){const section=options.kind==='vehicle'?'vehicles':options.kind==='generator'?'generators':null;if(!section)throw Object.assign(Error('Неизвестный вид техники'),{code:'COST_TARGET'});selection=new Set(list(db,section).filter(value=>ids.identifier(value.id)).map(value=>key({section,id:value.id})));}
    const journalGroups={};for(const [section,parent]of [['records','vehicleId'],['genRecords','generatorId']]){const index=new Map();if(can(section))for(const value of list(db,section))if(live(value)&&ids.identifier(value[parent])&&inPeriod(dateOf(value.date))){const group=index.get(value[parent])||[];group.push(value);index.set(value[parent],group);}journalGroups[section]=index;}
    for(const section of ['vehicles','generators'])if(can(section))for(const asset of list(db,section)){
      const target={section,id:asset.id};if(!ids.identifier(asset.id)||!selectedTarget(target)||options.kind&&options.kind!==(section==='vehicles'?'vehicle':'generator'))continue;
      const row={target,label:section==='vehicles'?[asset.plate,asset.make].filter(Boolean).join(' · '):asset.name||String(asset.id),quantity:null,unit:section==='vehicles'?'км':'ч',recognizedAmount:null,consumptionAmount:null,knownSubtotal:0,total:null,complete:true,entries:[],issues:[]};rows.push(row);if(byTarget.has(key(target)))notice('COST_TARGET_AMBIGUOUS','Типизированный ID техники повторяется',null,target);else byTarget.set(key(target),row);
      const journal=section==='vehicles'?'records':'genRecords',field=section==='vehicles'?'km':'hours',facts=journalGroups[journal].get(asset.id)||[];
      if(can(journal)&&facts.length&&facts.every(value=>number(value[field])!==null))row.quantity=exactSum(facts.map(value=>number(value[field])));
    }
    const targets=[];for(const section of ['tanks','parts','vehicles','generators'])if(can(section)){
      const descriptor=valuationApi.describe(section);if(descriptor.readSections.every(can)){for(const asset of list(db,section))if(ids.identifier(asset.id))targets.push({section,id:asset.id});}else unavailable.push(...descriptor.readSections.filter(name=>!can(name)));
    }
    const physicalReady=targets.length>0||['tanks','parts','vehicles','generators'].every(can)&&['tanks','parts','vehicles','generators'].every(section=>valuationApi.describe(section).readSections.every(can));
    const valuationAll=targets.length?valuationApi.project(db,{...(from?{from}:{}),...(to?{to}:{}),targets},{...(allowed?{readable:[...allowed]}:{})}):{apiVersion:1,from,to,rows:[],diagnostics:[],complete:physicalReady},shown=valuationAll.rows.filter(row=>selectedTarget(row.target)),valuation={...valuationAll,rows:shown,diagnostics:valuationAll.diagnostics.filter(issue=>!issue.target||selectedTarget(issue.target)),complete:physicalReady&&shown.every(row=>row.status==='known')};
    if(!physicalReady)unavailable.push(...['tanks','parts','vehicles','generators'].filter(name=>!can(name)));
    issues.push(...valuation.diagnostics);
    const financeReads=['costEntries','tankIncomes','partMovements','payments','repairs','vehicleTo','toRecords','workOrders','vehicles','generators','records','genRecords','fuelPeriods','assetAssignments','contragents'],financeReady=financeReads.every(can);
    const recognized=financeReady?sourcesApi.projectExpenses(db):{sources:[],excluded:[],diagnostics:[],complete:false,unavailable:financeReads.filter(name=>!can(name))};
    const expenseBySource=new Map();for(const source of recognized.sources)for(const ref of [source.root,source.current]){const k=key(ref),group=expenseBySource.get(k)||[];if(!group.includes(source))group.push(source);expenseBySource.set(k,group);}
    const allocations=financeReady?costs.allocations(db,{...(from?{from}:{}),...(to?{to}:{})},{...(allowed?{readable:[...allowed]}:{})}):{rows:[],issues:[],complete:false,unavailable:financeReads.filter(name=>!can(name))};
    if(!financeReady)unavailable.push(...financeReads.filter(name=>!can(name)));issues.push(...recognized.diagnostics,...allocations.issues);
    const allocated=new Map(allocations.rows.map(value=>[key(value.source),value])),add=(target,entry,origin=null)=>{
      if(!selectedTarget(target)){if(origin&&selectedTarget(origin))target=origin;else return;}const row=target&&byTarget.get(key(target));if(row){row.entries.push(entry);if(entry.amount===null)row.complete=false;}else unassigned.push({...entry,target:target||null});
    };
    if(financeReady)for(const source of recognized.sources){if(!inPeriod(source.date))continue;const distribution=allocated.get(key(source.root));if(distribution){if(distribution.status!=='known'){notice('COST_ALLOCATION_STALE','Распределение первичного расхода требует нового подтверждения',source.root);continue;}for(const target of distribution.targets)add({section:target.section,id:target.id},{source:source.root,date:source.date,kind:'recognized',amount:target.amount,basis:distribution.basis,allocationId:distribution.rootId});continue;}
      const resolved=source.assetRef?ids.resolveAsset(db,source.assetRef,{v:'vehicles',g:'generators'}):null;add(source.assetTarget||(resolved?.status==='known'?{section:resolved.section,id:resolved.id}:null),{source:source.root,date:source.date,kind:'recognized',amount:source.amount,basis:source.description||source.category||'Первичный расход'});
    }
    const rawBySource=new Map();for(const section of ['partMovements','workOrders','repairs','vehicleTo','toRecords'])for(const value of list(db,section))if(ids.identifier(value.id)){const k=key({section,id:value.id}),old=rawBySource.get(k);rawBySource.set(k,old?null:value);}
    for(const store of valuationAll.rows){
      const assetTarget=['vehicles','generators'].includes(store.target.section)?store.target:null;
      if(assetTarget&&byTarget.has(key(assetTarget))&&store.status!=='known')notice('COST_VALUATION_INCOMPLETE','Стоимость топлива или его остатка определена не полностью',null,assetTarget);
      for(const entry of store.consumptions){let target=assetTarget||entry.counterparty||null,raw=null;if(store.target.section==='parts'){
        raw=ids.identifier(entry.source.id)?rawBySource.get(key(entry.source)):null;if(raw?.assetRef){const resolved=ids.resolveAsset(db,raw.assetRef,{v:'vehicles',g:'generators'});target=resolved.status==='known'?{section:resolved.section,id:resolved.id}:null;}
        if(!selectedTarget(target)&&!selectedTarget(store.target))continue;
        if(raw&&ids.presentId(raw.workOrderId)){
          const order=rawBySource.get(key({section:'workOrders',id:raw.workOrderId})),primary=order?[['repairId','repairs'],['vehicleToId','vehicleTo'],['toRecordId','toRecords']].filter(([field])=>ids.presentId(order[field])):[],bindings=primary.length?primary.map(([field,section])=>({section,id:order[field]})):[{section:'workOrders',id:raw.workOrderId}],matched=[...new Set(bindings.flatMap(ref=>expenseBySource.get(key(ref))||[]))],included=matched.length===1?matched[0].snapshot.costIncludesMaterials:undefined;
          if(included===true)continue;
          if(included!==false){notice('COST_MATERIAL_SCOPE_UNKNOWN','Не подтверждено, включена ли стоимость запчастей в первичный расход по ремонту; сумма не прибавлена повторно',entry.source,target);continue;}
        }
      }
      if(!selectedTarget(target)&&!selectedTarget(store.target))continue;add(target,{source:entry.source,date:entry.date,kind:'consumption',amount:entry.amount,basis:entry.basis,quantityBasis:entry.quantityBasis||'unknown'},store.target);if(entry.amount===null)notice('COST_CONSUMPTION_UNKNOWN','Стоимость расходованного запаса неизвестна',entry.source,target);
      }
    }
    const cash={scope:'all-accessible-obligations',rows:[],knownTotal:null,complete:financeReady};if(financeReady){
      for(const root of list(db,'payments')){if(root.lifecycle?.correctionOf)continue;const ref={section:'payments',id:root.id},baseline=root.paidAmount!==undefined&&root.paidAmount!==null?number(root.paidAmount):root.paid===true?number(root.sum):0;
        if(baseline===null){cash.complete=false;notice('COST_CASH_UNKNOWN','Историческая сумма оплаты неизвестна',ref);}
        else if(baseline>0){const date=dateOf(root.paidDate);if(!date){cash.complete=false;cash.rows.push({source:ref,date:null,kind:'baseline',amount:baseline,basis:'Историческая оплата без даты'});}else if(inPeriod(date))cash.rows.push({source:ref,date,kind:'baseline',amount:baseline,basis:'Сохранённая фактическая оплата'});}
        if(root.paymentSettlements){const events=root.paymentSettlements.version===1&&Array.isArray(root.paymentSettlements.events)?root.paymentSettlements.events:null;if(!events){cash.complete=false;notice('COST_CASH_HISTORY','Повреждена история фактических оплат',ref);}else for(const event of events){if(number(event.amount)===null||!validDate(event.date)){cash.complete=false;notice('COST_CASH_HISTORY','У события оплаты нет корректных суммы или даты',ref);continue;}if(inPeriod(event.date))cash.rows.push({source:ref,date:event.date,kind:'settlement',amount:event.amount,basis:event.reason||'',operationId:event.operationId});}}
      }
      cash.knownTotal=exactSum(cash.rows.filter(value=>value.date!==null).map(value=>value.amount));
    }
    for(const row of rows){const stock=valuationAll.rows.find(value=>key(value.target)===key(row.target)),stockVisible=stock?.status==='known';row.recognizedAmount=financeReady?exactSum(row.entries.filter(value=>value.kind==='recognized'&&value.amount!==null).map(value=>value.amount)):null;const consumption=row.entries.filter(value=>value.kind==='consumption');row.consumptionAmount=!stockVisible||consumption.some(value=>value.amount===null)?null:exactSum(consumption.map(value=>value.amount));row.knownSubtotal=exactSum(row.entries.filter(value=>value.amount!==null).map(value=>value.amount));row.complete=row.complete&&stockVisible&&financeReady&&recognized.complete&&allocations.complete;row.total=row.complete?row.knownSubtotal:null;}
    const entries=[...rows.flatMap(row=>row.entries),...unassigned],knownSubtotal=exactSum(entries.filter(value=>value.amount!==null).map(value=>value.amount)),inventoryComplete=valuation.complete,complete=financeReady&&recognized.complete&&allocations.complete&&inventoryComplete&&rows.every(row=>row.complete)&&!issues.some(value=>value.severity==='error');
    const acquisitions=valuation.rows.flatMap(row=>row.acquisitions),stockAmounts=valuation.rows.map(row=>row.closing.amount);
    return {apiVersion:1,calculationVersion:1,from,to,valuation,allocations,recognized,cash,rows,unassigned,issues,unavailable:[...new Set(unavailable)].sort(),totals:{recognizedAmount:financeReady?exactSum(entries.filter(value=>value.kind==='recognized'&&value.amount!==null).map(value=>value.amount)):null,consumptionAmount:!physicalReady||!valuation.complete||rows.some(row=>row.consumptionAmount===null)||entries.some(value=>value.kind==='consumption'&&value.amount===null)?null:exactSum(entries.filter(value=>value.kind==='consumption').map(value=>value.amount)),knownSubtotal,total:complete?knownSubtotal:null,acquisitions:!physicalReady||acquisitions.some(value=>value.amount===null)?null:exactSum(acquisitions.map(value=>value.amount)),stock:!physicalReady||stockAmounts.some(value=>value===null)?null:exactSum(stockAmounts),cash:cash.complete?cash.knownTotal:null,complete},method:'Первичные расходы, стоимость израсходованных запасов и фактические оплаты показаны раздельно. Поступление на склад не признаётся повторным расходом.'};
  }
  return Object.freeze({ buildReport,buildFullReport, validateSection, number, validDate, scenario, datedScenario, sourceLabels:LABELS });
});
