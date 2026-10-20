// Чистый расчёт ГСМ: общая бочка организации и партии топлива в машинах.
const GSM_UNKNOWN_ORG = 'Организация не определена';
const GSM_EPS = 0.001;

function gsmNumber(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function gsmRound(value) { return Math.round(gsmNumber(value) * 1000) / 1000; }
function gsmCardKey(value) {
  const text = String(value || '').trim();
  return text.replace(/\D/g, '') || text.toUpperCase();
}
function gsmOrgKey(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');
}
function gsmGrade(value, fallback) {
  return (typeof parseFuelGrade === 'function' && parseFuelGrade(value)) || (String(value || '').trim() === 'Бензин' ? 'Бензин' : '') || fallback || 'Не указано';
}
function gsmVehicleGrade(v) {
  return typeof vehicleFuelGrade === 'function' ? vehicleFuelGrade(v) : gsmGrade(v.fuelGrade, v.fuel === 'gasoline' ? 'Бензин' : 'ДТ');
}
function gsmFamily(grade) { return grade === 'ДТ' ? 'diesel' : grade === 'Газ' ? 'gas' : /^АИ-\d+$/.test(grade) || grade === 'Бензин' ? 'gasoline' : 'unknown'; }
function gsmInPeriod(date, from, to) { return (!from || date >= from) && (!to || date <= to); }
function gsmValidDate(date) {
  const parsed = new Date(date + 'T12:00:00Z');
  return /^\d{4}-\d{2}-\d{2}$/.test(date || '') && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}
function gsmMonthRange(month) {
  if (!month || month === 'all') return { from: '', to: '' };
  const [y, m] = month.split('-').map(Number);
  return { from: month + '-01', to: month + '-' + new Date(Date.UTC(y, m, 0)).getUTCDate() };
}
function gsmVehicleOrgAt(v, date) {
  if (!v) return '';
  const history = (v.orgHistory || []).filter(h => (!h.from || h.from <= date) && (!h.to || h.to >= date));
  return String(history.length ? history[history.length - 1].org : v.org || '').trim();
}
function gsmCardAt(db, number, date) {
  const key = gsmCardKey(number);
  const card = key && (db.fuelCards || []).find(c => gsmCardKey(c.number) === key);
  const assignments = card ? (card.assignments || []).filter(a => (!a.from || a.from <= date) && (!a.to || a.to >= date)) : [];
  const assignment = assignments[assignments.length - 1];
  const holders = (db.vehicles || []).filter(v => key && gsmCardKey(v.fuelcard) === key);
  const vehicle = assignment ? (db.vehicles || []).find(v => v.id === assignment.vehicleId) : (!card && holders.length === 1 ? holders[0] : null);
  const history = card ? (card.orgHistory || []).filter(h => (!h.from || h.from <= date) && (!h.to || h.to >= date)) : [];
  const org = String(history.length ? history[history.length - 1].org : (card && card.org) || (assignment && assignment.org) || gsmVehicleOrgAt(vehicle, date) || '').trim();
  return { card, org, provider: card && card.provider || '', vehicleId: vehicle && vehicle.id || assignment && assignment.vehicleId || '', vehicle };
}
function gsmStampPurchase(p, db) {
  if (!p || p.sourceOrg) return;
  const owner = gsmCardAt(db, p.cardNo, p.date);
  if (!owner.org) return;
  p.sourceOrg = owner.org;
  p.sourceProvider = owner.provider;
  p.cardVehicleId = owner.vehicleId;
}
function gsmPreserveCardHistory(db, number) {
  (db.fuelPurchases || []).filter(p => gsmCardKey(p.cardNo) === gsmCardKey(number)).forEach(p => gsmStampPurchase(p, db));
  (db.records || []).filter(r => gsmCardKey(r.fuelCardNum) === gsmCardKey(number) && !r.fuelOrg).forEach(r => {
    const owner = gsmCardAt(db, number, r.date);
    if (owner.org) { r.fuelOrg = owner.org; r.fuelProvider = owner.provider; }
  });
}
function gsmPreserveVehicleHistory(db, vehicle) {
  (db.fuelCards || []).forEach(c => gsmPreserveCardHistory(db, c.number));
  (db.records || []).filter(r => r.vehicleId === vehicle.id && !r.fuelOrg && !r.fuelCardNum && gsmNumber(r.fuelIssued) > 0)
    .forEach(r => { r.fuelOrg = gsmVehicleOrgAt(vehicle, r.date); });
  if (!vehicle.fuelBalanceSources) vehicle.fuelBalanceSources = [{ org: vehicle.org || GSM_UNKNOWN_ORG, grade: gsmVehicleGrade(vehicle), qty: gsmNumber(vehicle.fuelBalance) }];
}

function gsmBuildLedger(db, options) {
  options = options || {};
  const from = options.from || '', to = options.to || '';
  const vehicles = new Map((db.vehicles || []).map(v => [v.id, v]));
  const records = (db.records || []).filter(r => vehicles.has(r.vehicleId));
  const canonicalDays=new Set(records.filter(r=>r.glonassCanonical).map(r=>r.vehicleId+'|'+r.date));
  const byRecord = new Map(records.map(r => [r.id, []])), ambiguous = new Set();
  const receipts = [], issues = [], rows = new Map(), movements = [], journal = [];
  const issueKeys = new Set();
  const issue = (code, severity, details) => {
    const key = [code, details.recordId || '', details.purchaseId || '', details.vehicleId || '', details.date || '', details.org || '', details.grade || ''].join('|');
    if (!issueKeys.has(key)) { issues.push(Object.assign({ code, severity }, details)); issueKeys.add(key); }
  };
  const rowFor = (vehicleId, org, grade) => {
    const key = [vehicleId, gsmOrgKey(org), grade].join('|');
    if (!rows.has(key)) rows.set(key, { key, vehicleId, vehicle: vehicles.get(vehicleId), org: org || GSM_UNKNOWN_ORG, grade,
      start: 0, issued: 0, spent: 0, idle: 0, norm: 0, km: 0, glonass: 0, end: 0, correction: 0, providers: {}, cards: new Set(), active: false });
    return rows.get(key);
  };
  const addReceipt = receipt => {
    receipts.push(receipt);
    if (!receipt.org) receipt.org = GSM_UNKNOWN_ORG;
    if (receipt.org === GSM_UNKNOWN_ORG) issue('source-org', 'error', { date: receipt.date, vehicleId: receipt.vehicleId,
      purchaseId: receipt.purchaseId, recordId: receipt.recordId, qty: receipt.qty, message: 'Не определена организация карты', org: receipt.org, grade: receipt.grade });
    const v = vehicles.get(receipt.vehicleId);
    if (!v) { issue('vehicle', 'error', { purchaseId: receipt.purchaseId, date: receipt.date, qty: receipt.qty, org: receipt.org, grade: receipt.grade, message: 'Не выбрана фактически заправленная машина' }); return; }
    if (receipt.grade !== gsmVehicleGrade(v)) issue('fuel-grade', 'warning', {
      purchaseId: receipt.purchaseId, vehicleId: v.id, date: receipt.date, org: receipt.org, grade: receipt.grade,
      message: 'Топливо ' + receipt.grade + ' отличается от топлива машины ' + gsmVehicleGrade(v) });
  };
  const duplicateGroups = new Map();
  (db.fuelPurchases || []).filter(p => !p.deleted && gsmNumber(p.qty) > 0).forEach(p => {
    const key = [p.date, gsmCardKey(p.cardNo), gsmRound(p.qty), gsmGrade(p.grade || p.product)].join('|');
    if (!duplicateGroups.has(key)) duplicateGroups.set(key, []);
    duplicateGroups.get(key).push(p);
  });
  duplicateGroups.forEach(list => {
    if (list.length < 2 || !list.some(p => p.restored)) return;
    list.forEach(p => issue('purchase-duplicate', 'error', { purchaseId: p.id, vehicleId: p.vehicleId, date: p.date,
      org: p.sourceOrg || gsmCardAt(db, p.cardNo, p.date).org, grade: gsmGrade(p.grade || p.product), qty: gsmNumber(p.qty),
      message: 'Возможный повтор восстановления: ' + list.length + ' операций по ' + p.qty + ' л. Сверьте с исходной выпиской' }));
  });

  (db.fuelPurchases || []).filter(p => !p.deleted && gsmNumber(p.qty) > 0).forEach(p => {
    if (!gsmValidDate(p.date)) {
      issue('date', 'error', { purchaseId: p.id, vehicleId: p.vehicleId, message: 'Некорректная дата покупки' });
      return;
    }
    const v = vehicles.get(p.vehicleId);
    const owner = gsmCardAt(db, p.cardNo, p.date);
    const rawGrade = p.grade || p.product;
    const grade = gsmGrade(rawGrade, rawGrade ? 'Не указано' : v ? gsmVehicleGrade(v) : 'Не указано');
    if (grade === 'Не указано' || !rawGrade) issue('unknown-grade', 'error', { purchaseId: p.id, vehicleId: p.vehicleId, date: p.date, org: p.sourceOrg || owner.org,
      message: 'Проверьте марку топлива покупки: ' + (rawGrade || 'не указана') });
    let linked = records.find(r => r.id === p.recordId && r.vehicleId === p.vehicleId && r.date === p.date);
    if (!linked && v) {
      const candidates = records.filter(r => r.vehicleId === p.vehicleId && r.date === p.date && gsmGrade(r.fuelGrade, gsmVehicleGrade(v)) === grade);
      if (candidates.length === 1) linked = candidates[0];
      else candidates.forEach(r => ambiguous.add(r.id));
    }
    const receipt = { id: p.id, purchaseId: p.id, vehicleId: p.vehicleId || '', date: p.date || '', time: p.time || '',
      qty: gsmNumber(p.qty), sum: fqValue(p.sum), grade, cardNo: p.cardNo || '', org: p.sourceOrg || owner.org || (p.manual && v ? gsmVehicleOrgAt(v, p.date) : ''),
      provider: p.sourceProvider || owner.provider || '', cardVehicleId: p.cardVehicleId || owner.vehicleId,
      recordId: linked && linked.id || '', manual: !!p.manual, product: p.product || grade };
    addReceipt(receipt);
    if (linked) byRecord.get(linked.id).push(receipt);
    else if (v) issue('journal-missing', 'error', { vehicleId: v.id, purchaseId: p.id, date: p.date, org: receipt.org, grade,
      qty: receipt.qty, message: 'Покупка не связана со строкой журнала пробега' });
  });

  records.forEach(r => {
    const v = vehicles.get(r.vehicleId), list = byRecord.get(r.id), qty = gsmNumber(r.fuelIssued);
    const grade = gsmGrade(r.fuelGrade, gsmVehicleGrade(v));
    if (r.fuelGrade && gsmGrade(r.fuelGrade) === 'Не указано') issue('unknown-grade', 'error', {
      vehicleId: v.id, recordId: r.id, date: r.date, orgs: list.length ? [...new Set(list.map(p => p.org))] : [r.fuelOrg || gsmCardAt(db, r.fuelCardNum, r.date).org || gsmVehicleOrgAt(v, r.date)], message: 'Не распознана марка топлива журнала: ' + r.fuelGrade });
    if (!gsmValidDate(r.date)) {
      issue('date', 'error', { vehicleId: v.id, recordId: r.id, message: 'Некорректная дата журнала' });
      return;
    }
    if (list.length) {
      const total = gsmRound(list.reduce((s, p) => s + p.qty, 0));
      if (Math.abs(total - qty) > 0.011) issue('journal-difference', 'error', { vehicleId: v.id, recordId: r.id, date: r.date,
        orgs: [...new Set(list.map(p => p.org))], grade, qty: total, journalQty: qty,
        message: 'Выписка ' + total + ' л, журнал ' + qty + ' л' });
      return;
    }
    if (qty <= 0) return;
    if (ambiguous.has(r.id)) {
      issue('journal-ambiguous', 'error', { vehicleId: v.id, recordId: r.id, date: r.date, grade,
        message: 'Несколько строк журнала: нужно явно привязать покупки; ручной приход не добавлен повторно' });
      return;
    }
    const owner = gsmCardAt(db, r.fuelCardNum, r.date);
    const cardReference = !r.fuelCardNum && !r.fuelOrg && /карт[а-яё]*/i.test(r.note || '');
    const org = r.fuelOrg || owner.org || (!r.fuelCardNum && !cardReference ? gsmVehicleOrgAt(v, r.date) : '');
    if (cardReference) issue('manual-card-reference', 'error', { vehicleId: v.id, recordId: r.id, date: r.date,
      message: 'В примечании указана карта, но номер не выбран: ' + r.note });
    addReceipt({ id: 'journal:' + r.id, recordId: r.id, vehicleId: v.id, date: r.date, time: '', qty, sum: fqValue(r.fuelSum),
      grade, cardNo: r.fuelCardNum || '', org, provider: r.fuelProvider || owner.provider || v.supplier || 'Ручное поступление',
      cardVehicleId: owner.vehicleId, manual: true, product: grade });
    if (!r.fuelCardNum && !r.fuelOrg) issue('manual-source', 'warning', { vehicleId: v.id, recordId: r.id, date: r.date, org, grade, qty,
      message: 'Ручная заправка отнесена к организации машины; карта не указана' });
  });

  (db.monthlyFuel || []).filter(m => m.liters != null && m.liters !== '').forEach(m => {
    const list = receipts.filter(p => p.vehicleId === m.vehicleId && p.date.slice(0, 7) === m.month && (!m.cardNumber || gsmCardKey(p.cardNo) === gsmCardKey(m.cardNumber)));
    const total = gsmRound(list.reduce((s, p) => s + p.qty, 0));
    if (Math.abs(total - gsmNumber(m.liters)) > 0.011) issue('monthly-difference', 'error', { vehicleId: m.vehicleId, date: m.month + '-01',
      org: gsmCardAt(db, m.cardNumber, m.month + '-01').org, qty: total, journalQty: gsmNumber(m.liters),
      message: 'Месячная сверка: указано ' + m.liters + ' л, в операциях ' + total + ' л' });
  });

  vehicles.forEach(v => {
    const lots = [], defaultGrade = gsmVehicleGrade(v), defaultOrg = gsmVehicleOrgAt(v, '') || GSM_UNKNOWN_ORG;
    const initial = gsmNumber(v.fuelBalance);
    const initialSources = Array.isArray(v.fuelBalanceSources) && v.fuelBalanceSources.length ? v.fuelBalanceSources : [{ org: defaultOrg, grade: defaultGrade, qty: initial }];
    if (Math.abs(initialSources.reduce((s, x) => s + gsmNumber(x.qty), 0) - initial) > 0.011) issue('opening-difference', 'error', {
      vehicleId: v.id, date: '', org: defaultOrg, message: 'Распределение начального остатка не совпадает с карточкой машины' });
    let reconciliationSequence = 0;
    const supply = (source, qty, context) => {
      let left = qty;
      for (const lot of lots) {
        if (left <= 0) break;
        if (lot.qty < 0 && gsmOrgKey(lot.org) === gsmOrgKey(source.org) && lot.grade === source.grade) { const q = Math.min(left, -lot.qty); lot.qty += q; left -= q; }
      }
      const org = source.org || defaultOrg, grade = source.grade || defaultGrade;
      if (left > 0.0000001 && context && gsmOrgKey(org) && gsmOrgKey(org) !== gsmOrgKey(GSM_UNKNOWN_ORG) &&
          ['Бензин', 'АИ-92', 'АИ-95', 'АИ-98', 'АИ-100'].includes(grade)) {
        for (const debt of lots) {
          if (left <= 0.0000001) break;
          if (debt.qty >= 0 || debt.origin !== 'shortage' || gsmOrgKey(debt.org) !== gsmOrgKey(org) || debt.grade === grade ||
              !['Бензин', 'АИ-92', 'АИ-95', 'АИ-98', 'АИ-100'].includes(debt.grade)) continue;
          const q = Math.min(left, -debt.qty);
          debt.qty += q; left -= q;
          if (gsmInPeriod(context.date, from, to)) {
            rowFor(v.id, org, debt.grade).correction += q;
            rowFor(v.id, org, grade).correction -= q;
            const pairId = 'grade:' + v.id + ':' + (++reconciliationSequence);
            const movement = { kind: 'grade-reconciliation', pairId, date: context.date, vehicleId: v.id, org,
              fromGrade: grade, toGrade: debt.grade, qty: q, purchaseId: context.purchaseId || '', recordId: context.recordId || '',
              debtRecordId: debt.recordId || '', debtDate: debt.date || '', reason: 'Уточнение марки топлива ранее неподкреплённого расхода' };
            movements.push({ ...movement, grade: debt.grade, delta: q }, { ...movement, grade, delta: -q });
          }
        }
      }
      if (Math.abs(left) > 0.0000001) lots.push({ org, grade, qty: left, provider: source.provider || '',
        origin: source.origin || '', recordId: source.recordId || '', date: source.date || '' });
    };
    initialSources.forEach(s => supply({ org: s.org || defaultOrg, grade: gsmGrade(s.grade, defaultGrade), provider: 'Начальный остаток' }, gsmNumber(s.qty)));
    const snapshot = field => {
      lots.forEach(lot => { if (Math.abs(lot.qty) > 0.0000001) rowFor(v.id, lot.org, lot.grade)[field] += lot.qty; });
    };
    let started = !from;
    if (started) snapshot('start');
    const events = [];
    const vr = records.filter(r => r.vehicleId === v.id && gsmValidDate(r.date)).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const measurementPlan = fqMeasurementPlan(vr, v);
    receipts.filter(p => p.vehicleId === v.id).forEach(p => events.push({ date: p.date, order: 0, time: p.time, receipt: p }));
    vr.forEach(r => events.push({ date: r.date, order: 1, time: '', record: r }));
    events.sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.order - b.order || a.time.localeCompare(b.time));

    const consume = (qty, grade, date, recordId) => {
      let left = qty;
      const used = [];
      for (const lot of lots) {
        if (left <= 0.0000001) break;
        if (lot.qty <= 0 || gsmFamily(lot.grade) !== gsmFamily(grade)) continue;
        const q = Math.min(lot.qty, left); lot.qty -= q; left -= q;
        used.push({ org: lot.org, grade: lot.grade, qty: q });
      }
      if (left > 0.0000001) {
        supply({ org: defaultOrg, grade, origin: 'shortage', recordId, date }, -left);
        used.push({ org: defaultOrg, grade, qty: left });
        issue('shortage', 'error', { vehicleId: v.id, date, recordId, org: defaultOrg, grade, qty: gsmRound(left),
          message: 'Для списания не хватает ' + gsmRound(left) + ' л ' + grade });
      }
      return used;
    };

    for (const event of events) {
      if (to && event.date > to) break;
      if (!started && event.date >= from) { snapshot('start'); started = true; }
      const included = gsmInPeriod(event.date, from, to);
      if (event.receipt) {
        const p = event.receipt; supply(p, p.qty, p);
        if (included) {
          const row = rowFor(v.id, p.org, p.grade); row.issued += p.qty; row.active = true;
          row.providers[p.provider || 'Поставщик не указан'] = (row.providers[p.provider || 'Поставщик не указан'] || 0) + p.qty;
          if (p.cardNo) row.cards.add(p.cardNo);
          movements.push(Object.assign({ kind: 'receipt' }, p));
        }
        continue;
      }
      const r = event.record, grade = gsmGrade(r.fuelGrade, defaultGrade);
      const fuel = fqRecord(r,v);
      const norm = fuel.norm;
      const driving = fuel.driving;
      const idle = fuel.idle;
      if (driving < 0 || idle < 0 || gsmNumber(r.fuelIssued) < 0) issue('negative-input', 'error', {
        vehicleId: v.id, date: r.date, recordId: r.id, org: defaultOrg, orgs: [...new Set(lots.map(l => l.org))], grade, message: 'Отрицательные литры в журнале' });
      let spent = Math.max(0, fuel.total || 0);
      const measured = fqValue(r.tankMeasured) != null;
      const measurementKey = measurementPlan.keyFor(r);
      const appliedMeasurement=measurementPlan.lastOnDate.get(measurementKey) === r.id ? measurementPlan.measurements.get(measurementKey) : null;
      if (fuel.source === 'missing' && gsmNumber(r.km) > 0 && !appliedMeasurement) issue('consumption-missing','error',{vehicleId:v.id,date:r.date,recordId:r.id,grade,message:'Есть пробег, но не указан факт расхода и нет нормы для расчёта'});
      if (measured && Number(r.tankMeasured) < 0) issue('negative-measurement','error',{vehicleId:v.id,date:r.date,recordId:r.id,grade,message:'Отрицательный замер остатка'});
      if (appliedMeasurement) {
        const available = lots.filter(l => gsmFamily(l.grade) === gsmFamily(grade)).reduce((s, l) => s + l.qty, 0);
        const measuredSpent = available - Number(appliedMeasurement.tankMeasured);
        if (measuredSpent >= 0) spent = measuredSpent;
        else {
          const correction = -measuredSpent;
          supply({ org: defaultOrg, grade }, correction, { date: r.date, recordId: r.id }); spent = 0;
          if (included) {
            rowFor(v.id, defaultOrg, grade).correction += correction;
            movements.push({ kind: 'measurement-correction', source: 'measurement', date: r.date, vehicleId: v.id,
              recordId: r.id, measurementRecordId: appliedMeasurement.id, org: defaultOrg, grade,
              qty: correction, delta: correction, reason: 'Остаток по замеру выше расчётного' });
          }
          issue('measurement-surplus', 'error', { vehicleId: v.id, date: r.date, recordId: r.id, org: defaultOrg, grade,
            qty: gsmRound(correction), message: 'Замер выше расчётного остатка: нужен приход ' + gsmRound(correction) + ' л' });
        }
      } else if (measured) issue('multiple-measurements', 'warning', { vehicleId: v.id, recordId: r.id, date: r.date, grade,
        message: 'Замер дня применяется после всех строк дня; при нескольких замерах берётся последний' });
      const used = consume(spent, grade, r.date, r.id);
      if (included) {
        const shares = used.length ? used : [{ org: defaultOrg, grade, qty: 0 }];
        shares.forEach(part => {
          const share = spent > 0 ? part.qty / spent : 1;
          const row = rowFor(v.id, part.org, part.grade); row.active = true;
          row.spent += part.qty; row.idle += Math.min(idle, spent) * share;
          row.norm += norm * share; row.km += gsmNumber(r.km) * share; row.glonass += (!canonicalDays.has(r.vehicleId+'|'+r.date)||r.glonassCanonical?gsmNumber(r.kmGlonass):0)*share;
          movements.push({ kind: 'consumption', source:appliedMeasurement?'measurement':fuel.source, date: r.date, vehicleId: v.id, recordId: r.id, org: part.org, grade: part.grade, qty: part.qty,
            idle: Math.min(idle, spent) * share, norm: norm == null ? null : norm * share, totalNorm:norm == null ? null : (norm+idle)*share, km: gsmNumber(r.km) * share });
        });
        journal.push({ recordId: r.id, vehicleId: v.id, date: r.date, grade, km: gsmNumber(r.km), norm, spent,
          issued: gsmNumber(r.fuelIssued), statement: gsmRound((byRecord.get(r.id) || []).reduce((s, p) => s + p.qty, 0)), hasPurchases: (byRecord.get(r.id) || []).length > 0,
          balance: gsmRound(lots.reduce((s, l) => s + l.qty, 0)) });
      }
    }
    if (!started) snapshot('start');
    snapshot('end');
    lots.filter(l => l.qty > GSM_EPS && gsmFamily(l.grade) === 'unknown').forEach(l => issue('carry-unknown-grade', 'error', {
      vehicleId: v.id, date: '', org: l.org, grade: l.grade, message: 'В переходящем остатке не определена марка топлива' }));
    lots.filter(l => l.qty < -GSM_EPS).forEach(l => issue('carry-shortage', 'error', { vehicleId: v.id, date: '',
      org: l.org, grade: l.grade, qty: gsmRound(-l.qty), message: 'Непокрытый остаток: ' + gsmRound(l.qty) + ' л. Проверьте начальный остаток и поступления' }));
  });

  const resultRows = [...rows.values()].filter(r => r.active || Math.abs(r.start) > GSM_EPS || Math.abs(r.end) > GSM_EPS);
  const barrels = new Map();
  resultRows.forEach(row => {
    ['start', 'issued', 'spent', 'idle', 'norm', 'km', 'glonass', 'end', 'correction'].forEach(k => { row[k] = gsmRound(row[k]); });
    const key = [gsmOrgKey(row.org), row.grade].join('|');
    if (!barrels.has(key)) barrels.set(key, { org: row.org, grade: row.grade, start: 0, issued: 0, spent: 0, end: 0, correction: 0 });
    const barrel = barrels.get(key);
    ['start', 'issued', 'spent', 'end', 'correction'].forEach(k => { barrel[k] = gsmRound(barrel[k] + row[k]); });
  });
  const currentIssues = issues.filter(i => !i.date || gsmInPeriod(i.date, from, to) || i.code === 'purchase-duplicate' && (!to || i.date <= to));
  const resultBarrels = [...barrels.values()].sort((a, b) => a.org.localeCompare(b.org, 'ru') || a.grade.localeCompare(b.grade, 'ru'));
  return { from, to, rows: resultRows, barrels: resultBarrels, journal, movements,
    receipts: receipts.filter(p => gsmInPeriod(p.date, from, to)), issues: currentIssues,
    errors: currentIssues.filter(i => i.severity === 'error'), organizations: [...new Set(resultRows.map(r => r.org))].sort((a, b) => a.localeCompare(b, 'ru')) };
}
