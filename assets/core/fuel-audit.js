/* Portable read-only fuel diagnostics; the original audit algorithm is unchanged. */
(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./fuel-engine.js'),()=>require('./accounting-boundary.js'));
  else root.TvsFuelAudit=factory(root.TvsFuelEngine,()=>root.AccountingBoundary);
})(typeof globalThis==='object'?globalThis:this,function(fuel,getAccounting){
  'use strict';
  if(!fuel||fuel.apiVersion!==1)throw Error('Fuel calculation core is unavailable');
  const {gsmNumber,gsmRound,gsmCardKey,gsmOrgKey,gsmGrade,gsmVehicleGrade,gsmFamily,gsmInPeriod,gsmValidDate,gsmCardAt,gsmVehicleOrgAt,fqValue}=fuel;
  const gsmBuildLedger=fuel.buildLedger,GSM_EPS=fuel.constants.epsilon,GSM_UNKNOWN_ORG=fuel.constants.unknownOrg;

const GSM_AUDIT_RULES = {
  'source-org': ['error', 'Не определена организация поступления', 'Сверьте владельца карты на дату покупки и организацию самой покупки.'],
  vehicle: ['error', 'Поступление без фактической машины', 'Выберите фактически заправленную машину по исходной выписке.'],
  'unknown-grade': ['error', 'Не указана марка топлива', 'Укажите марку из исходной выписки, сохранив её литры.'],
  'journal-difference': ['evidence', 'Литры покупки и журнала различаются', 'Сравните все покупки дня с журналом и первичной выпиской. Не добавляйте приход повторно.'],
  'journal-missing': ['error', 'Покупка не связана с журналом', 'Проверьте дату, фактическую машину и марку покупки; затем сохраните исправленную покупку.'],
  'journal-ambiguous': ['evidence', 'Несколько возможных записей журнала', 'Сверьте записи одного дня и привяжите покупку к правильной машине и виду топлива.'],
  'opening-difference': ['error', 'Начальные источники не равны остатку карточки', 'Сначала проверьте общий начальный остаток в карточке ТС, затем распределение этого же остатка. Это не остаток выбранного месяца.'],
  'outside-accounting': ['warning','Период до начала учёта ГСМ','Выберите период начиная с указанной в карточке даты. Входящий остаток не является остатком на более раннюю дату.'],
  'accounting-partial-month': ['warning','Месяц начинается до учёта ГСМ','Полная месячная сверка не сравнивается с частью месяца после начала учёта.'],
  'measurement-surplus': ['evidence', 'Замер выше расчётного остатка', 'Сверьте сам замер, заправки до него и ранее введённый расход. Корректировка не заменяет документ поступления.'],
  'consumption-missing': ['error', 'Есть пробег без основания расхода', 'Проверьте введённый расход или норму. Пробег не требуется менять.'],
  'negative-input': ['error', 'Отрицательное значение в журнале', 'Сверьте литры и пробег с источником; не заменяйте их целевым остатком.'],
  'negative-measurement': ['error', 'Отрицательный замер остатка', 'Уточните фактический замер по его источнику.'],
  'multiple-measurements': ['warning', 'Несколько замеров за день', 'В расчёте используется последний замер данного вида топлива после всех строк дня. Сверьте даты и порядок записей.'],
  'fuel-grade': ['warning', 'Марка отличается от карточки машины', 'Другая марка бензина может быть допустима. Изменяйте только подтверждённую ошибку выписки или карточки.'],
  'manual-source': ['warning', 'Ручной приход без выбранной карты', 'Организация взята из карточки машины. Проверьте источник поступления.'],
  'manual-card-reference': ['evidence', 'Карта указана только в примечании', 'Выберите реальную карту в записи журнала; текст примечания сам по себе не определяет организацию.'],
  'monthly-difference': ['evidence', 'Месячная сверка не совпадает с операциями', 'Сверьте месячное значение с документами и отдельными заправками.'],
  'carry-unknown-grade': ['error', 'В остатке неизвестна марка топлива', 'Проверьте марку начального источника и исходных покупок.'],
  date: ['error', 'Некорректная дата источника', 'Укажите подтверждённую дату исходной покупки или записи журнала.'],
};
function gsmAuditModel(input, options) {
  input = input || {};
  options = options || {};
  const array = value => Array.isArray(value) ? value.filter(row => row && typeof row === 'object') : [];
  const db = { ...input, vehicles: array(input.vehicles), records: array(input.records), fuelPurchases: array(input.fuelPurchases),
    fuelCards: array(input.fuelCards), monthlyFuel: array(input.monthlyFuel) };
  const corrected=fuel.calculationVersion>=4,live=row=>!row.deleted&&!row.cancelled&&row.status!=='cancelled',idOr=value=>corrected?(value??''):(value||'');
  if(corrected)for(const section of ['records','fuelPurchases','monthlyFuel'])db[section]=db[section].filter(live);
  const boundaries=new Map(db.vehicles.map(vehicle=>{
    if(!Object.prototype.hasOwnProperty.call(vehicle,'fuelAccounting'))return [vehicle.id,{mode:'legacy'}];
    const api=getAccounting();if(api?.apiVersion!==1)throw Object.assign(Error('Не загружены правила начала учёта ГСМ'),{code:'MODULE_UNAVAILABLE'});
    return [vehicle.id,api.resolve('vehicles',vehicle)];
  }));
  const explicit=[...boundaries.values()].some(value=>value.mode==='explicit');
  const current=row=>{const boundary=boundaries.get(row.vehicleId);return boundary?.mode!=='explicit'||!gsmValidDate(row.date)||row.date>=boundary.from;};
  if(explicit){db.records=db.records.filter(current);db.fuelPurchases=db.fuelPurchases.filter(current);}
  const from = options.from || '', to = options.to || '';
  const vehicles = new Map(db.vehicles.map(row => [row.id, row]));
  const records = new Map(db.records.map(row => [row.id, row]));
  const purchases = new Map(db.fuelPurchases.filter(row => !row.deleted).map(row => [row.id, row]));
  const ledger = explicit?gsmBuildLedger(db,{from,to}):options.ledger || gsmBuildLedger(db, { from, to });
  const items = [], seen = new Set();
  const present = value => value != null && String(value).trim() !== '';
  const inPeriod = date => !gsmValidDate(date) || gsmInPeriod(date, from, to);
  const uniqueRefs = refs => [...new Map(refs.filter(Boolean).map(ref => [JSON.stringify([ref.type,idOr(ref.id),idOr(ref.vehicleId),ref.month||'']), ref])).values()];
  const ref = (type, id, label, extra) => ({ type, id: idOr(id), label, ...extra });
  const sourceScope = (row, type) => {
    if (!row) return { org: '', orgs: [], grade: '' };
    const v = vehicles.get(row.vehicleId), number = type === 'purchase' ? row.cardNo : row.fuelCardNum;
    const card = number && db.fuelCards.find(c => gsmCardKey(c.number) === gsmCardKey(number));
    const explicit = type === 'purchase' ? row.sourceOrg : row.fuelOrg;
    let org = explicit || '', orgs = [];
    if (!org && !(corrected&&type==='record'&&Object.prototype.hasOwnProperty.call(row,'fuelOrg'))&&gsmValidDate(row.date)) org = gsmCardAt(db, number, row.date).org ||
      (type === 'record' && !number || row.manual ? gsmVehicleOrgAt(v, row.date) : '') || '';
    if (!org && !gsmValidDate(row.date)) {
      const source = card || (type === 'record' && !number || row.manual ? v : null);
      orgs = [...new Set([source && source.org, ...((source && source.orgHistory) || []).map(h => h.org)].filter(Boolean))];
      if (orgs.length === 1) org = orgs[0];
    }
    const rawGrade = row.grade || row.fuelGrade || row.product;
    return { org, orgs, grade: gsmGrade(rawGrade, rawGrade ? 'Не указано' : v ? gsmVehicleGrade(v) : '') };
  };
  const refsFor = row => {
    const out = [], p = (corrected?present(row.purchaseId):row.purchaseId)&&purchases.get(row.purchaseId), r = (corrected?present(row.recordId):row.recordId)&&records.get(row.recordId);
    if (p) out.push(ref('purchase', p.id, 'Покупка', { date: p.date, vehicleId: p.vehicleId }));
    if (r) out.push(ref(vehicles.has(r.vehicleId) ? 'record' : 'orphan-record', r.id,
      vehicles.has(r.vehicleId) ? 'Журнал' : 'Восстановить связь с ТС', { date: r.date, vehicleId: r.vehicleId }));
    const cardNo = row.cardNo || p && p.cardNo || r && r.fuelCardNum;
    const card = cardNo && db.fuelCards.find(card => gsmCardKey(card.number) === gsmCardKey(cardNo));
    if (card) out.push(ref('card', card.id, 'Карта и история', { cardNo: card.number }));
    return uniqueRefs(out);
  };
  const linkedPurchasesFor = recordId => [...purchases.values()].filter(p => {
    if (p.recordId === recordId) return true;
    const r = records.get(recordId), v = r && vehicles.get(r.vehicleId);
    if (!r || !v || p.vehicleId !== r.vehicleId || p.date !== r.date) return false;
    const grade = gsmGrade(p.grade || p.product, gsmVehicleGrade(v));
    const candidates = db.records.filter(candidate => candidate.vehicleId === p.vehicleId && candidate.date === p.date &&
      gsmGrade(candidate.fuelGrade, gsmVehicleGrade(v)) === grade);
    return candidates.length === 1 && candidates[0].id === recordId;
  });
  const add = value => {
    const id = value.id || JSON.stringify([value.code, value.vehicleId || '', gsmOrgKey(value.org), value.grade || '', value.recordId || '', value.purchaseId || '', value.observedDate || '']);
    if (seen.has(id)) return;
    seen.add(id);
    const category = value.category || 'evidence';
    const sourceRefs = uniqueRefs(value.sourceRefs || refsFor(value));
    const vehicleRefs = vehicles.has(value.vehicleId) ? [ref('vehicle', value.vehicleId, 'Карточка ТС', { vehicleId: value.vehicleId })] : [];
    items.push({ title: '', message: '', whatToCheck: '', observedDate: '', earliestCauseDate: '', org: '', orgs: [], grade: '',
      vehicleId: '', impact: {}, chronology: [], chronologyCount: 0, ...value, id, category,
      severity: category === 'error' ? 'error' : category === 'warning' ? 'info' : 'warning',
      sourceRefs, repairRefs: uniqueRefs(value.repairRefs || [...sourceRefs, ...vehicleRefs]) });
  };
  const history = from && ledger.rows.some(row => row.start < -GSM_EPS || row.end < -GSM_EPS)
    ? gsmBuildLedger(db, { to }) : ledger;
  const stockKey = row => JSON.stringify([row.vehicleId, gsmOrgKey(row.org), row.grade]);
  const movementDelta = row => row.kind === 'consumption' ? -gsmNumber(row.qty)
    : row.kind === 'receipt' ? gsmNumber(row.qty) : gsmNumber(row.delta);
  const historyByStock = new Map();
  (history.movements || []).forEach((row, index) => {
    const key = stockKey(row);
    if (!historyByStock.has(key)) historyByStock.set(key, []);
    historyByStock.get(key).push({ ...row, index });
  });
  function stockTrace(row, cutoff) {
    const v = vehicles.get(row.vehicleId), grade = gsmVehicleGrade(v);
    const boundary=boundaries.get(v.id),at=boundary?.mode==='explicit'?boundary.from:'';
    const initial = boundary?.mode==='explicit'?(boundary.sources||[{org:gsmVehicleOrgAt(v,at)||GSM_UNKNOWN_ORG,grade,qty:boundary.opening}]):Array.isArray(v.fuelBalanceSources) && v.fuelBalanceSources.length ? v.fuelBalanceSources
      : [{ org: gsmVehicleOrgAt(v, '') || GSM_UNKNOWN_ORG, grade, qty: gsmNumber(v.fuelBalance) }];
    let balance = initial.filter(source => gsmOrgKey(source.org || gsmVehicleOrgAt(v, '') || GSM_UNKNOWN_ORG) === gsmOrgKey(row.org) &&
      gsmGrade(source.grade, grade) === row.grade).reduce((sum, source) => sum + gsmNumber(source.qty), 0);
    const events = (historyByStock.get(stockKey(row)) || []).filter(event => !cutoff || event.date <= cutoff)
      .slice().sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.index - b.index);
    const days = new Map();
    events.forEach(event => { if (!days.has(event.date)) days.set(event.date, []); days.get(event.date).push(event); });
    let trace = balance < -GSM_EPS ? [{ date: '', title: 'Общий начальный остаток и его распределение', qty: balance, balance,
      sourceRefs: [ref('vehicle', v.id, 'Карточка ТС', { vehicleId: v.id }), ref('opening', v.id, 'Начальные источники', { vehicleId: v.id })] }] : [];
    for (const [date, day] of days) {
      const before = balance;
      balance = gsmRound(balance + day.reduce((sum, event) => sum + movementDelta(event), 0));
      if (balance >= -GSM_EPS) { trace = []; continue; }
      if (before >= -GSM_EPS) trace = [];
      day.forEach(event => trace.push({ date, title: event.kind === 'consumption' ? 'Списание по записи журнала'
        : event.kind === 'receipt' ? 'Поступление' : event.kind === 'measurement-correction' ? 'Корректировка по замеру' : 'Сверка марок',
      qty: gsmRound(movementDelta(event)), balance, sourceRefs: refsFor(event) }));
    }
    return trace;
  }
  const negativeStocks = new Set();
  ledger.rows.filter(row => row.end < -GSM_EPS || row.start < -GSM_EPS).forEach(row => {
    const endNegative = row.end < -GSM_EPS;
    if (endNegative) negativeStocks.add(stockKey(row));
    const cutoff = endNegative ? to : from ? new Date(Date.parse(from + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10) : '';
    const trace = stockTrace(row, cutoff), first = trace[0], sourceRefs = uniqueRefs(trace.flatMap(event => event.sourceRefs));
    const earliest = trace.find(event => event.date);
    add({ code: endNegative ? 'negative-ending' : 'negative-opening', category: 'evidence', vehicleId: row.vehicleId, org: row.org, grade: row.grade,
      title: endNegative ? 'Отрицательный остаток на конец периода' : 'Отрицательный входящий остаток',
      message: endNegative ? 'Расчётный остаток не покрыт поступлениями и подтверждёнными исходными данными.' : 'Минус пришёл из предыдущих операций, а не возник при экспорте акта.',
      observedDate: endNegative ? to : from, earliestCauseDate: earliest && earliest.date || '',
      whatToCheck: 'Начните с первой записи в истории причины. Проверьте поступления, замеры и введённый расход. Не меняйте общий начальный остаток карточки вместо остатка отдельного месяца.',
      impact: { kind: endNegative ? 'ending' : 'opening', qty: endNegative ? row.end : row.start, opening: row.start, closing: row.end },
      chronology: trace, chronologyCount: trace.length, sourceRefs,
      repairRefs: uniqueRefs([...(first ? first.sourceRefs : []), ...sourceRefs.slice(0, 6), ref('journal', row.vehicleId, 'История машины', { vehicleId: row.vehicleId, date: earliest && earliest.date || from })]) });
  });
  const shortageGroups = new Map();
  (ledger.issues || []).forEach(issue => {
    if (issue.code === 'carry-shortage' || issue.code === 'purchase-duplicate') return;
    if (issue.code === 'shortage') {
      if (negativeStocks.has(stockKey(issue))) return;
      const key = stockKey(issue);
      if (!shortageGroups.has(key)) shortageGroups.set(key, []);
      shortageGroups.get(key).push(issue); return;
    }
    const rule = GSM_AUDIT_RULES[issue.code] || ['evidence', 'Нужно сверить источник', 'Сверьте исходную запись с документом.'];
    const vehicleId = corrected?(issue.vehicleId??purchases.get(issue.purchaseId)?.vehicleId??''):issue.vehicleId || issue.purchaseId && purchases.get(issue.purchaseId)?.vehicleId || '';
    const sourceScopeValue = (corrected?present(issue.purchaseId):issue.purchaseId) ? sourceScope(purchases.get(issue.purchaseId), 'purchase') : sourceScope(records.get(issue.recordId), 'record');
    const sourceRefs = refsFor(issue);
    if (issue.code === 'journal-difference' || issue.code === 'journal-ambiguous')
      linkedPurchasesFor(issue.recordId).forEach(p => sourceRefs.push(...refsFor({ purchaseId: p.id })));
    const repairRefs = sourceRefs.slice();
    if (issue.code === 'opening-difference' && vehicles.has(vehicleId)) repairRefs.push(ref('vehicle', vehicleId, 'Общий начальный остаток', { vehicleId }), ref('opening', vehicleId, 'Распределение источников', { vehicleId }));
    if (issue.code === 'monthly-difference') repairRefs.push(ref('monthly', vehicleId, 'Месячная сверка', { vehicleId, month: String(issue.date || '').slice(0, 7) }));
    add({ code: issue.code, category: rule[0], title: rule[1], message: issue.message, whatToCheck: rule[2],
      vehicleId, org: issue.org || sourceScopeValue.org, orgs: (issue.orgs || []).length ? issue.orgs : sourceScopeValue.orgs,
      grade: issue.grade || sourceScopeValue.grade, recordId: issue.recordId, purchaseId: issue.purchaseId,
      observedDate: issue.date || (issue.purchaseId ? purchases.get(issue.purchaseId)?.date : '') || '',
      impact: { kind: issue.code, qty: issue.qty, journalQty: issue.journalQty }, sourceRefs,
      repairRefs: uniqueRefs([...repairRefs, ...(vehicles.has(vehicleId) ? [ref('vehicle', vehicleId, 'Карточка ТС', { vehicleId })] : [])]) });
  });
  shortageGroups.forEach(group => {
    group.sort((a, b) => a.date.localeCompare(b.date));
    const first = group[0];
    add({ code: 'unfunded-consumption', category: 'evidence', title: 'Расход раньше подтверждённого прихода',
      message: 'Конечный остаток покрыт, но внутри периода были неподкреплённые списания. Проверьте даты и источники.',
      whatToCheck: 'Сравните ранние списания с поступлениями и предыдущими замерами; поздний приход не подтверждает наличие топлива раньше своей даты.',
      vehicleId: first.vehicleId, org: first.org, grade: first.grade, observedDate: first.date, earliestCauseDate: first.date,
      impact: { kind: 'unfunded-consumption', qty: gsmRound(group.reduce((sum, issue) => sum + gsmNumber(issue.qty), 0)) },
      sourceRefs: group.flatMap(refsFor), chronology: group.map(issue => ({ date: issue.date, title: issue.message, qty: issue.qty, sourceRefs: refsFor(issue) })), chronologyCount: group.length });
  });
  const duplicateGroups = new Map();
  purchases.forEach(p => {
    if (!gsmValidDate(p.date) || !present(p.qty) || !Number.isFinite(Number(p.qty)) || Number(p.qty) <= 0) return;
    const key = JSON.stringify([p.date, gsmCardKey(p.cardNo), gsmRound(p.qty), gsmGrade(p.grade || p.product)]);
    if (!duplicateGroups.has(key)) duplicateGroups.set(key, []);
    duplicateGroups.get(key).push(p);
  });
  function addDuplicateGroup(group, restored) {
    if (group.length < 2 || !group.some(p => inPeriod(p.date))) return;
    const first = group[0], orgs = [...new Set(group.map(p => p.sourceOrg || gsmCardAt(db, p.cardNo, p.date).org || GSM_UNKNOWN_ORG))];
    add({ id: 'duplicate:' + JSON.stringify(group.map(p => p.id).sort()), code: 'possible-duplicate', category: 'evidence',
      title: 'Совпадают признаки нескольких покупок', message: group.length + ' покупок с одинаковыми ' +
        (restored ? 'датой, картой, маркой и литрами; среди них есть восстановленные строки. Время и машина могут различаться.' : 'датой, временем, машиной, картой, маркой и литрами.') + ' Это ещё не доказательство дубля.',
      whatToCheck: 'Откройте все совпавшие покупки и исходную выписку. Две реальные заправки могут иметь одинаковые литры. Снятие признака восстановления не доказывает устранение повтора.',
      observedDate: first.date, vehicleId: first.vehicleId, org: orgs.length === 1 ? orgs[0] : '', orgs, grade: gsmGrade(first.grade || first.product),
      impact: { kind: 'possible-duplicate', qty: gsmRound(first.qty) }, sourceRefs: group.flatMap(p => refsFor({ purchaseId: p.id, recordId: p.recordId })) });
  }
  duplicateGroups.forEach(group => {
    if (group.some(p => p.restored)) { addDuplicateGroup(group, true); return; }
    const exact = new Map();
    group.forEach(p => { const key = JSON.stringify([p.time || '', p.vehicleId || '']); if (!exact.has(key)) exact.set(key, []); exact.get(key).push(p); });
    exact.forEach(list => addDuplicateGroup(list, false));
  });
  function validateSource(row, type) {
    if (type === 'purchase' && row.deleted || !inPeriod(row.date)) return;
    const vehicle = vehicles.get(row.vehicleId);
    const details = { vehicleId: row.vehicleId || '', ...sourceScope(row, type), observedDate: row.date || '',
      purchaseId: type === 'purchase' ? row.id : '', recordId: type === 'record' ? row.id : '' };
    if (!vehicle && type === 'record') add({ ...details, code: 'record-vehicle-missing', category: 'error', title: 'Запись журнала без существующей машины',
      message: 'Эта запись не участвует в расчёте ГСМ, поскольку её машина не найдена.', whatToCheck: 'Восстановите связь с подтверждённой карточкой ТС отдельным действием. Покупки при этом автоматически не переносятся; не создавайте повторный приход.' });
    const fields = type === 'purchase' ? ['qty', 'sum', 'price'] : ['km', 'fuelIssued', 'fuelActual', 'fuelUsed', 'fuelIdle', 'tankMeasured'];
    fields.forEach(field => {
      if (!present(row[field]) || Number.isFinite(Number(row[field])) && Number(row[field]) >= 0 && (field !== 'qty' || Number(row[field]) > 0)) return;
      const labels = { qty: 'Литры', sum: 'Сумма', price: 'Цена', km: 'Пробег', fuelIssued: 'Получено', fuelActual: 'Расход по факту',
        fuelUsed: 'Введённый расход', fuelIdle: 'Холостой ход', tankMeasured: 'Замер остатка' };
      add({ ...details, id: JSON.stringify(['invalid-value', type, row.id, field]), code: 'invalid-value', category: 'error', title: 'Некорректное числовое значение',
        message: labels[field] + ': ' + String(row[field]), whatToCheck: 'Исправьте поле по исходному документу. Отрицательные или нечисловые значения не заменяются нулём автоматически.', impact: { kind: 'invalid-value', field } });
    });
    if (type === 'purchase' && !present(row.qty)) add({ ...details, code: 'missing-quantity', category: 'error', title: 'У покупки не указаны литры',
      message: 'Покупка без количества не попадает в приход.', whatToCheck: 'Укажите литры исходной операции.' });
    const rawGrade = row.grade || row.fuelGrade || row.product;
    if (present(rawGrade) && !['ДТ', 'Газ', 'Бензин', 'АИ-92', 'АИ-95', 'АИ-98', 'АИ-100'].includes(gsmGrade(rawGrade))) add({ ...details, code: 'unsupported-grade', category: 'warning', title: 'Марка отсутствует в справочнике ГСМ',
      message: String(rawGrade), whatToCheck: 'Сверьте марку с исходной выпиской. Старые значения не заменяются автоматически.' });
    if (type === 'purchase' && row.recordId) {
      const linked = records.get(row.recordId);
      if (!linked || linked.vehicleId !== row.vehicleId || linked.date !== row.date) {
        const candidates = vehicle ? db.records.filter(r => r.vehicleId === row.vehicleId && r.date === row.date &&
          gsmGrade(r.fuelGrade, gsmVehicleGrade(vehicle)) === gsmGrade(row.grade || row.product, gsmVehicleGrade(vehicle))) : [];
        const resolved = candidates.length === 1 ? candidates[0] : null;
        add({ ...details, code: 'stale-record-link', category: resolved ? 'warning' : 'error', title: 'Сохранена устаревшая ссылка на журнал',
          message: resolved ? 'Расчёт уже находит единственную подходящую запись по машине, дате и марке. Приход учтён; повторная заправка не требуется.' : 'Указанная запись отсутствует либо относится к другой машине или дате. Покупка уже учтена в приходе без связи с журналом.',
          whatToCheck: 'Откройте покупку и сверьте фактическую машину, дату и марку. Сохранение подтверждённой правки пересчитает связь с журналом.',
          sourceRefs: [...refsFor(details), ...(resolved ? refsFor({ recordId: resolved.id }) : [])] });
      }
    }
  }
  db.records.forEach(row => validateSource(row, 'record'));
  db.fuelPurchases.forEach(row => validateSource(row, 'purchase'));
  if (options.coverage !== false && to) {
    const byFamily = new Map();
    ledger.rows.forEach(row => {
      if (!row.km && !row.issued && !row.spent && Math.abs(row.end) <= GSM_EPS) return;
      const family = gsmFamily(row.grade), key = JSON.stringify([row.vehicleId, family]);
      if (!byFamily.has(key)) byFamily.set(key, { row, family, orgs: new Set() });
      byFamily.get(key).orgs.add(row.org);
    });
    byFamily.forEach(({ row, family, orgs }) => {
      const list = db.records.filter(record => record.vehicleId === row.vehicleId && record.date <= to &&
        gsmFamily(gsmGrade(record.fuelGrade, gsmVehicleGrade(row.vehicle))) === family).slice().sort((a, b) => a.date.localeCompare(b.date));
      const measured = list.filter(record => fqValue(record.tankMeasured) != null && Number(record.tankMeasured) >= 0);
      const latest = measured.at(-1);
      if (latest && latest.date === to) return;
      const lastRecord = list.filter(record => gsmInPeriod(record.date, from, to)).at(-1);
      add({ id: 'coverage:' + JSON.stringify([row.vehicleId, family, to]), code: 'ending-unmeasured', category: 'warning', title: 'Остаток на конец периода расчётный',
        message: latest ? 'Последний записанный замер: ' + latest.date + '. Замера на ' + to + ' нет.' : 'В базе нет замера этого вида топлива на конец периода.',
        whatToCheck: 'Если есть реальный замер, внесите его в соответствующую запись журнала. Отсутствие замера само по себе не доказывает ошибку расхода.',
        vehicleId: row.vehicleId, orgs: [...orgs], family, grade: family === 'gasoline' ? '' : row.grade, observedDate: to,
        sourceRefs: latest ? refsFor({ recordId: latest.id }) : [], repairRefs: uniqueRefs([...(lastRecord ? refsFor({ recordId: lastRecord.id }) : []),
          ref('journal', row.vehicleId, 'Журнал машины', { vehicleId: row.vehicleId, date: to })]) });
    });
  }
  items.sort((a, b) => ({ error: 0, evidence: 1, warning: 2 }[a.category] - { error: 0, evidence: 1, warning: 2 }[b.category]) ||
    String(a.earliestCauseDate || a.observedDate).localeCompare(String(b.earliestCauseDate || b.observedDate)) || a.id.localeCompare(b.id));
  return { from, to, items, summary: { error: items.filter(row => row.category === 'error').length,
    evidence: items.filter(row => row.category === 'evidence').length, warning: items.filter(row => row.category === 'warning').length, total: items.length } };
}

  Object.values(GSM_AUDIT_RULES).forEach(Object.freeze);Object.freeze(GSM_AUDIT_RULES);
  return Object.freeze({apiVersion:1,buildModel:gsmAuditModel,rules:GSM_AUDIT_RULES});
});
