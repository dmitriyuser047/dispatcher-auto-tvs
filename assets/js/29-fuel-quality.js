// Числа и происхождение расхода для отчётов: единое переносимое ядро ГСМ.
if (typeof TvsFuelEngine === 'undefined' || TvsFuelEngine.apiVersion !== 1) throw new Error('Не загружено ядро расчётов ГСМ (assets/core/fuel-engine.js)');
function fqValue(value) { return TvsFuelEngine.fqValue(value); }
function fqRecord(record, vehicle) { return TvsFuelEngine.fqRecord(record, vehicle); }
function fqFuelFamily(grade) { return TvsFuelEngine.fqFuelFamily(grade); }
function fqRecordFuelFamily(record, vehicle) { return TvsFuelEngine.fqRecordFuelFamily(record, vehicle); }
function fqMeasurementPlan(records, vehicle) { return TvsFuelEngine.fqMeasurementPlan(records, vehicle); }
function fqDate(value) { return TvsFuelEngine.fqDate(value); }
function fqShiftDate(value, days) { return TvsFuelEngine.fqShiftDate(value, days); }
function fqDays(from, to) { return TvsFuelEngine.fqDays(from, to); }
// This scope applies to physical fuel only. recsFor/genRecsFor deliberately
// retain the complete mileage, hour-meter and maintenance history.
function fuelAccountingFor(section,asset){
  if(typeof AccountingBoundary!=='undefined')return AccountingBoundary.resolve(section,asset==null?{}:asset);
  if(asset&&Object.prototype.hasOwnProperty.call(asset,'fuelAccounting'))throw Error('Не загружен модуль начала топливного учёта');
  return {mode:'legacy'};
}
function fuelAccountingIncludes(section,asset,date){
  const boundary=fuelAccountingFor(section,asset);
  return boundary.mode==='legacy'||AccountingBoundary.classify(boundary,date)==='current';
}
function fuelAccountingCurrentIncludes(section,asset,date){
  const boundary=fuelAccountingFor(section,asset);
  return boundary.mode==='legacy'||date<=dispatcherLocalDate()&&AccountingBoundary.classify(boundary,date)==='current';
}
function fuelAccountingOpening(section,asset,date){
  const boundary=fuelAccountingFor(section,asset);
  if(boundary.mode==='explicit')return date&&date<boundary.from?null:boundary.opening;
  return fqValue(section==='tanks'?asset?.balanceInit:asset?.fuelBalance)||0;
}
function fuelAccountingCurrentBalance(section,asset,records,balances,to=''){
  const boundary=fuelAccountingFor(section,asset);
  const until=to||(boundary.mode==='explicit'?dispatcherLocalDate():'');
  if(boundary.mode==='explicit'&&until&&until<boundary.from)return null;
  const eligible=records.filter(row=>(!until||row.date<=until)&&fuelAccountingIncludes(section,asset,row.date)).slice().sort((a,b)=>cmpDateAsc(a.date,b.date));
  const last=eligible.at(-1);
  return last&&Object.hasOwn(balances,last.id)?balances[last.id]:fuelAccountingOpening(section,asset,until);
}
function fuelAccountingStatusHtml(section,asset){
  const boundary=fuelAccountingFor(section,asset);
  return boundary.mode==='explicit'?'<small>Топливный учёт с '+htmlEsc(boundary.from)+' · '+htmlEsc(boundary.basis)+'</small>':'<small>Начало топливного учёта не задано</small>';
}
function fuelAccountingRequireActRange(section,asset,from,to){
  const boundary=fuelAccountingFor(section,asset);if(boundary.mode==='legacy')return;
  const label=asset.name||asset.plate||String(asset.id);
  if(!from||!to)throw Error('Для акта «'+label+'» укажите обе даты периода: начало учёта ГСМ задано на '+boundary.from+'.');
  const range=AccountingBoundary.window(boundary,{from,to});
  if(range.status==='outside-accounting')throw Error('За выбранный период учёт ГСМ «'+label+'» ещё не начат. Дата начала: '+boundary.from+'.');
  if(range.status==='partial')throw Error('У «'+label+'» учёт ГСМ начинается '+boundary.from+'. Выберите период с этой даты, чтобы акт не выдавал входящий остаток за остаток на более раннюю дату.');
}
function fqSourceLabel(source) {
  return ({ actual: 'Введённый факт', norm: 'Расчёт по норме', missing: 'Нет расхода' })[source] || source;
}

let fqComparison = null, fqComparisonOpen = '';
function fqCompareInit() {
  if (fqComparison) return fqComparison;
  const month = fpCmpMonth || fpCmpMonths()[0] || BusinessCalendar.resolve(data,new Date().toISOString()).today.slice(0,7);
  const current = gsmMonthRange(month), previous = gsmMonthRange(fpPrevMonth(month));
  const today = BusinessCalendar.resolve(data,new Date().toISOString()).today;
  if (today.startsWith(month)) current.to = today;
  fqComparison = { aFrom: previous.from, aTo: previous.to, bFrom: current.from, bTo: current.to, equalDays: true, sameFleet: true, group: 'vehicle' };
  return fqComparison;
}
function fqComparePeriods() {
  const state = fqCompareInit();
  const a = { from: state.aFrom, to: state.aTo }, b = { from: state.bFrom, to: state.bTo };
  if (!fqDays(a.from, a.to) || !fqDays(b.from, b.to)) return null;
  if (state.equalDays) {
    const days = Math.min(fqDays(a.from, a.to), fqDays(b.from, b.to));
    a.to = fqShiftDate(a.from, days - 1); b.to = fqShiftDate(b.from, days - 1);
  }
  return { a, b };
}
function fqCompareSet(field, value) {
  fqCompareInit()[field] = value; fqComparisonOpen = ''; renderFuelPurchases();
}
function fqComparePreset(kind) {
  const state = fqCompareInit(), month = state.bFrom.slice(0, 7), b = gsmMonthRange(month);
  const today = BusinessCalendar.resolve(data,new Date().toISOString()).today;
  if (today.startsWith(month)) b.to = today;
  const a = kind === 'year' ? gsmMonthRange((Number(month.slice(0, 4)) - 1) + month.slice(4)) : gsmMonthRange(fpPrevMonth(month));
  Object.assign(state, { aFrom: a.from, aTo: a.to, bFrom: b.from, bTo: b.to, equalDays: true });
  fqComparisonOpen = ''; renderFuelPurchases();
}
function fqCompareEmpty() {
  return { km: 0, act: null, actualLitres: 0, actualKm: 0, actualNorm: 0, actualNormKm: 0,
    calculated: 0, calculatedComparable:0, calculatedKm: 0, estimated: 0, norm: 0, normKm: 0, issued: 0, sum: 0,
    sumKnown: 0, moneyCount: 0, issuedCount: 0, normCount: 0, issueCount: 0, actualCount: 0, workCount: 0, missingCount: 0, idle: 0, n: 0, details: [], costByGrade:{} };
}
function fqCompareFinish(aggregate) {
  aggregate.act = aggregate.actualCount ? aggregate.actualLitres : null;
  aggregate.per100 = aggregate.actualKm >= FP_CMP_MIN_KM ? aggregate.actualLitres / aggregate.actualKm * 100 : null;
  aggregate.calculated100 = aggregate.calculatedKm >= FP_CMP_MIN_KM ? aggregate.calculatedComparable / aggregate.calculatedKm * 100 : null;
  aggregate.iss100 = aggregate.km >= FP_CMP_MIN_KM && aggregate.issueCount ? aggregate.issued / aggregate.km * 100 : null;
  aggregate.weightedNorm = aggregate.normKm ? aggregate.norm / aggregate.normKm * 100 : null;
  aggregate.actualWeightedNorm = aggregate.actualNormKm ? aggregate.actualNorm / aggregate.actualNormKm * 100 : null;
  aggregate.actualNormCoverage=aggregate.actualKm ? Math.min(100,aggregate.actualNormKm/aggregate.actualKm*100) : null;
  aggregate.coverage = aggregate.km ? Math.min(100, aggregate.actualKm / aggregate.km * 100) : null;
  return aggregate;
}
function fqCompareAggregate(vehicleId, period) {
  const aggregate = fqCompareEmpty(), vehicle = (data.vehicles || []).find(v => v.id === vehicleId);
  (data.records || []).filter(r => r.vehicleId === vehicleId && fqDate(r.date) && r.date >= period.from && r.date <= period.to).forEach(record => {
    const quality = fqRecord(record, vehicle), km = Math.max(0, fqValue(record.km) || 0), issued = fqValue(record.fuelIssued), sum = fqValue(record.fuelSum);
    aggregate.n++; aggregate.km += km; aggregate.idle += quality.idle;
    if (km > 0 || quality.total != null && quality.total > 0) aggregate.workCount++;
    if (quality.norm != null) { aggregate.normCount++; aggregate.norm += quality.norm + quality.idle; aggregate.normKm += km; }
    if (quality.actual != null) {
      aggregate.actualCount++; aggregate.actualLitres += quality.actual + quality.idle; aggregate.actualKm += km;
      if (quality.norm != null) { aggregate.actualNorm += quality.norm + quality.idle; aggregate.actualNormKm += km; }
    } else if (quality.source === 'norm') aggregate.estimated += quality.total;
    else if (km > 0) aggregate.missingCount++;
    if (quality.total != null) { aggregate.calculated += quality.total; if (!quality.partial) { aggregate.calculatedComparable+=quality.total; aggregate.calculatedKm += km; } }
    if (issued != null) { aggregate.issuedCount++; aggregate.issued += issued; if (issued > 0) { aggregate.issueCount++; if (sum != null) aggregate.sumKnown++; } }
    if (sum != null) { aggregate.moneyCount++; aggregate.sum += sum; }
    if (issued != null && issued > 0) {
      const grade=recordFuelGrade(record,vehicle), cost=aggregate.costByGrade[grade] || (aggregate.costByGrade[grade]={qty:0,sum:0,rows:0,known:0});
      cost.qty+=issued; cost.rows++; if(sum != null) {cost.sum+=sum;cost.known++;}
    }
    aggregate.details.push({ record, vehicle, quality });
  });
  return fqCompareFinish(aggregate);
}
function fqCompareCombine(list) {
  const result = fqCompareEmpty();
  const fields = ['km', 'actualLitres', 'actualKm', 'actualNorm', 'actualNormKm', 'calculated', 'calculatedComparable', 'calculatedKm', 'estimated', 'norm', 'normKm', 'issued', 'sum', 'sumKnown', 'moneyCount', 'issuedCount', 'normCount', 'issueCount', 'actualCount', 'workCount', 'missingCount', 'idle', 'n'];
  list.forEach(item => {
    fields.forEach(field => { result[field] += item[field]; }); result.details.push(...item.details);
    Object.entries(item.costByGrade).forEach(([grade,cost]) => { const total=result.costByGrade[grade] || (result.costByGrade[grade]={qty:0,sum:0,rows:0,known:0}); ['qty','sum','rows','known'].forEach(field => {total[field]+=cost[field];}); });
  });
  return fqCompareFinish(result);
}
function fqCompareRows() {
  const periods = fqComparePeriods(); if (!periods) return [];
  const state = fqCompareInit(), key = fpCmpMetric;
  let rows = (data.vehicles || []).filter(v => !(fpCmpNoOffice && fpIsOffice(v)) && (!fpCmpOrg || (v.org || '') === fpCmpOrg)).map(v => {
    const a = fqCompareAggregate(v.id, periods.a), b = fqCompareAggregate(v.id, periods.b);
    return { id: v.id, label: fpVehicleTitle(v), v, a, b, members: [v] };
  }).filter(row => state.sameFleet ? row.a.n && row.b.n : row.a.n || row.b.n);
  if (state.group !== 'vehicle') {
    const groups = new Map();
    rows.forEach(row => {
      const label = String(row.v[state.group === 'object' ? 'object' : 'org'] || 'Не указано').trim();
      if (!groups.has(label)) groups.set(label, []); groups.get(label).push(row);
    });
    rows = [...groups].map(([label, list]) => ({ id: label, label, v: null, members: list.map(row => row.v),
      a: fqCompareCombine(list.map(row => row.a)), b: fqCompareCombine(list.map(row => row.b)) }));
  }
  return rows.map(row => {
    const metricValue=aggregate => !aggregate.n || key === 'sum' && !aggregate.moneyCount || key === 'issued' && !aggregate.issuedCount || key === 'norm' && !aggregate.normCount ? null : aggregate[key];
    const pv = metricValue(row.a), cv = metricValue(row.b);
    const delta = pv != null && cv != null ? cv - pv : null;
    return { ...row, pv, cv, delta, pct: delta != null && pv !== 0 ? delta / Math.abs(pv) * 100 : null,
      norm: row.b.weightedNorm, zeroBase: pv === 0 && cv != null && cv !== 0 };
  });
}
function fqCompareRangeLabel(period) { return fmtDate(period.from) + ' — ' + fmtDate(period.to); }
function fqCostDecomposition(a,b) {
  const result={volume:0,price:0,residual:0,delta:b.sum-a.sum,grades:[],complete:a.issueCount > 0 && b.issueCount > 0 && a.sumKnown === a.issueCount && b.sumKnown === b.issueCount};
  [...new Set([...Object.keys(a.costByGrade),...Object.keys(b.costByGrade)])].forEach(grade => {
    const x=a.costByGrade[grade],y=b.costByGrade[grade];
    if (!x || !y || !x.qty || !y.qty || x.known !== x.rows || y.known !== y.rows) return;
    const pA=x.sum/x.qty,pB=y.sum/y.qty,volume=(y.qty-x.qty)*(pA+pB)/2,price=(pB-pA)*(x.qty+y.qty)/2;
    result.volume+=volume; result.price+=price; result.grades.push({grade,pA,pB,qA:x.qty,qB:y.qty,volume,price});
  });
  result.residual=result.delta-result.volume-result.price;
  return result;
}
function fqCostHtml(a,b) {
  if (!a.moneyCount || !b.moneyCount) return '<div class="gsm-status">Для объяснения изменения стоимости нужны заполненные суммы в обоих периодах.</div>';
  const cost=fqCostDecomposition(a,b), signed=value => (value > 0 ? '+' : '')+fpNum(value,2)+' ₽';
  return '<details style="margin:14px 0" open><summary><b>Почему изменилась стоимость заправок: '+signed(cost.delta)+'</b></summary><div class="gsm-status">Объём: <b>'+signed(cost.volume)+'</b> · средняя цена внутри марки: <b>'+signed(cost.price)+'</b> · остаток изменения: <b>'+signed(cost.residual)+'</b></div>'+
    '<p style="font-size:12px">'+(cost.complete ? 'Суммы заполнены по всем записям выдачи.' : 'Суммы заполнены не полностью: сравниваются только записанные деньги, это не полная оценка затрат.')+' Объём и цена разделены симметрично по каждой марке, присутствующей в обоих периодах с полной стоимостью. Остаток включает новые/исчезнувшие марки, неполные суммы и прочие суммы журнала. Средняя цена включает изменение поставщиков и условий закупки; это не доказательство изменения тарифа одного поставщика.</p>'+
    '<table class="data-table"><thead><tr><th>Марка</th><th>Литры А / Б</th><th>Цена А / Б, ₽/л</th><th>Объём, ₽</th><th>Цена, ₽</th></tr></thead><tbody>'+cost.grades.map(row => '<tr><td>'+fpEsc(row.grade)+'</td><td>'+fpNum(row.qA,1)+' / '+fpNum(row.qB,1)+'</td><td>'+fpNum(row.pA,2)+' / '+fpNum(row.pB,2)+'</td><td>'+signed(row.volume)+'</td><td>'+signed(row.price)+'</td></tr>').join('')+'</tbody></table></details>';
}
function fqCompareCoverage(aggregate) {
  return (aggregate.coverage == null ? 'нет пробега' : fpNum(aggregate.coverage, 0) + '% пробега с фактом') +
    ' · ' + aggregate.actualCount + ' записей с фактом · ' + aggregate.missingCount + ' без расхода';
}
function fqCompareDetail(row) {
  const rows = ['a', 'b'].flatMap(side => row[side].details.map(detail => {
    const r = detail.record, q = detail.quality;
    return '<tr><td>' + (side === 'a' ? 'A' : 'Б') + '</td><td>' + fmtDate(r.date) + '</td><td>' + fpEsc(fpVehicleTitle(detail.vehicle)) + '</td><td>' + fpNum(r.km || 0, 0) + '</td><td>' + (q.total == null ? '—' : fpNum(q.total, 2)) + '</td><td>' + fpEsc(fqSourceLabel(q.source)) + (q.normSource === 'vehicle' ? ' · текущая норма карточки' : '') + '</td><td>' + fpNum(q.idle, 2) + '</td><td><button class="btn btn-ghost btn-sm" onclick="fpOpenJournal(' + fpEsc(JSON.stringify(r.vehicleId)) + ',' + fpEsc(JSON.stringify(r.date.slice(0, 7))) + ')">Журнал</button></td></tr>';
  }));
  return '<tr><td colspan="9"><div style="padding:12px"><b>Записи, формирующие показатели</b><div class="table-scroll"><table class="data-table"><thead><tr><th>Период</th><th>Дата</th><th>Машина</th><th>Км</th><th>Расход с холостым ходом, л</th><th>Источник</th><th>Холостой ход, л</th><th></th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div></div></td></tr>';
}
function fqCompareHtml() {
  const state = fqCompareInit(), periods = fqComparePeriods(), metric = FP_CMP_METRICS[fpCmpMetric] || FP_CMP_METRICS.per100;
  const dateInput = (field, label) => '<label>' + label + '<input type="date" class="fsel" value="' + fpEsc(state[field]) + '" onchange="fqCompareSet(\'' + field + '\',this.value)"></label>';
  const controls = '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-bottom:12px">' + dateInput('aFrom', 'А: с ') + dateInput('aTo', ' по ') + dateInput('bFrom', 'Б: с ') + dateInput('bTo', ' по ') +
    '<button class="btn btn-ghost" onclick="fqComparePreset(\'month\')">Предыдущий месяц</button><button class="btn btn-ghost" onclick="fqComparePreset(\'year\')">Год назад</button></div>' +
    '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px"><label><input type="checkbox" ' + (state.equalDays ? 'checked' : '') + ' onchange="fqCompareSet(\'equalDays\',this.checked)"> Равное число дней от начала периодов</label>' +
    '<label><input type="checkbox" ' + (state.sameFleet ? 'checked' : '') + ' onchange="fqCompareSet(\'sameFleet\',this.checked)"> Только машины с записями в обоих периодах</label>' +
    '<label><input type="checkbox" ' + (fpCmpNoOffice ? 'checked' : '') + ' onchange="fpCmpNoOffice=this.checked;renderFuelPurchases()"> Без офисных</label>' +
    '<label><input type="checkbox" ' + (fpCmpOnlyUp ? 'checked' : '') + ' onchange="fpCmpOnlyUp=this.checked;renderFuelPurchases()"> Рост от ' + FP_CMP_ALERT + '%</label></div>';
  if (!periods) return controls + '<div class="gsm-status gsm-error">Укажите две правильные даты начала и конца каждого периода.</div>';
  const all = fqCompareRows(), rows = all.filter(row => !fpCmpOnlyUp || row.pct != null && row.pct >= FP_CMP_ALERT).sort((a, b) => (b.pct ?? -Infinity) - (a.pct ?? -Infinity));
  const totalA = fqCompareCombine(all.map(row => row.a)), totalB = fqCompareCombine(all.map(row => row.b));
  const val = (value, decimals) => value == null ? '—' : fpNum(value, decimals == null ? metric.dec : decimals);
  const normValue = aggregate => aggregate.actualWeightedNorm == null ? '—' : fpNum(aggregate.actualWeightedNorm, 2);
  const up = all.filter(row => row.pct != null && row.pct >= FP_CMP_ALERT).length;
  const card = (title, value, sub) => '<div class="gsm-status" style="flex:1;min-width:210px"><div>' + title + '</div><b style="font-size:20px">' + value + '</b><div style="font-size:12px">' + sub + '</div></div>';
  const orgs = [...new Set((data.vehicles || []).map(v => v.org).filter(Boolean))].sort();
  const body = rows.map((row, index) => {
    const color = row.pct >= FP_CMP_ALERT ? 'var(--red)' : row.pct != null && row.pct <= -FP_CMP_ALERT ? 'var(--green)' : 'inherit';
    const open = fqComparisonOpen === row.id;
    return '<tr><td><button class="btn btn-ghost btn-sm" onclick="fqComparisonOpen=' + (open ? "''" : fpEsc(JSON.stringify(row.id))) + ';renderFuelPurchases()">' + (open ? '▴ ' : '▾ ') + fpEsc(row.label) + '</button>' + (row.v ? '<div style="font-size:12px">' + fpEsc(row.v.object || '') + '</div>' : '<div>' + row.members.length + ' машин</div>') + '</td>' +
      '<td style="text-align:right">' + val(row.pv) + '</td><td style="text-align:right">' + val(row.cv) + '</td><td style="text-align:right">' + (row.delta != null && row.delta > 0 ? '+' : '') + val(row.delta) + '</td><td style="color:' + color + '">' + (row.zeroBase ? 'новое значение, база 0' : row.pct == null ? '—' : (row.pct > 0 ? '+' : '') + fpNum(row.pct, 1) + '%') + '</td>' +
      '<td>' + fqCompareCoverage(row.a) + '</td><td>' + fqCompareCoverage(row.b) + '</td><td style="text-align:right">' + val(row.a.weightedNorm, 2) + '</td><td style="text-align:right">' + val(row.b.weightedNorm, 2) + '</td></tr>' + (open ? fqCompareDetail(row) : '');
  }).join('');
  return controls + '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px"><select class="fsel" onchange="fqCompareSet(\'group\',this.value)">' + [['vehicle','По машинам'],['object','По объектам'],['org','По организациям']].map(([id,label]) => '<option value="' + id + '"' + (state.group === id ? ' selected' : '') + '>' + label + '</option>').join('') + '</select>' +
    '<select class="fsel" onchange="fpCmpOrg=this.value;renderFuelPurchases()"><option value="">Все организации</option>' + orgs.map(org => '<option' + (org === fpCmpOrg ? ' selected' : '') + '>' + fpEsc(org) + '</option>').join('') + '</select></div>' +
    '<div class="month-tabs" style="margin-bottom:12px">' + Object.entries(FP_CMP_METRICS).map(([id,m]) => '<button class="mtab ' + (id === fpCmpMetric ? 'active' : '') + '" onclick="fpCmpMetric=\'' + id + '\';renderFuelPurchases()">' + m.label + '</button>').join('') + '</div>' +
    '<div class="gsm-status">А: ' + fqCompareRangeLabel(periods.a) + ' · Б: ' + fqCompareRangeLabel(periods.b) + ' · ' + fqDays(periods.a.from, periods.a.to) + ' / ' + fqDays(periods.b.from, periods.b.to) + ' дней</div>' +
    '<div style="display:flex;gap:10px;flex-wrap:wrap;margin:12px 0">' + card('Введённый факт парка, л/100 км', val(totalB.per100,2), 'А: ' + val(totalA.per100,2) + ' · по пробегу с введённым фактом') +
      card('Норма на пробеге с фактом, л/100 км', normValue(totalB), 'А: ' + normValue(totalA) + ' · норма известна на ' + (totalB.actualNormCoverage == null ? '—' : fpNum(totalB.actualNormCoverage,0)+'%') + ' этого пробега в Б') +
      card('Полнота факта в периоде Б', totalB.coverage == null ? 'нет пробега' : fpNum(totalB.coverage,0) + '%', 'А: ' + (totalA.coverage == null ? 'нет пробега' : fpNum(totalA.coverage,0) + '%') + ' · групп с ростом: ' + up) + '</div>' +
    fqCostHtml(totalA,totalB) + '<div class="table-toolbar"><b>' + metric.label + '</b><button class="btn btn-ghost" onclick="fpExportCompare()">Выгрузить сравнение и записи</button></div><div class="table-scroll"><table class="data-table"><thead><tr><th>Группа / раскрыть</th><th>А</th><th>Б</th><th>Разница</th><th>Изменение</th><th>Полнота А</th><th>Полнота Б</th><th>Норма А, л/100</th><th>Норма Б, л/100</th></tr></thead><tbody>' + (body || '<tr><td colspan="9">Нет данных по выбранным условиям.</td></tr>') + '</tbody></table></div>' +
    '<div style="font-size:12px;color:var(--text3);margin-top:12px">Введённый факт и расчёт с подстановкой нормы показаны отдельно. Ноль сохраняется как факт; пустое значение означает отсутствие данных. Расход включает отдельно введённый холостой ход. Фактические л/100 считаются только по пробегу записей с фактом, от ' + FP_CMP_MIN_KM + ' км. Норма взвешивается по пробегу; при отсутствии сохранённой нормы берётся текущая карточка, что отмечено в детализации. Объект и организация — текущие карточки машин. Стоимость: заполнено ' + totalB.sumKnown + ' из ' + totalB.issueCount + ' записей выдачи в периоде Б. Нажмите группу для исходных записей.</div>';
}
function fqExportCompare() {
  const periods = fqComparePeriods(); if (!periods) return;
  const rows = fqCompareRows().filter(row => !fpCmpOnlyUp || row.pct != null && row.pct >= FP_CMP_ALERT);
  if (!rows.length) { alert('Нет данных для выгрузки'); return; }
  const metric = FP_CMP_METRICS[fpCmpMetric], wb = XLSX.utils.book_new();
  const summary = [['Сравнение', metric.label], ['А', fqCompareRangeLabel(periods.a)], ['Б', fqCompareRangeLabel(periods.b)],
    ['Группа', 'А', 'Б', 'Разница', 'Изменение, %', 'Факт А, % пробега', 'Факт Б, % пробега', 'Норма А, л/100', 'Норма Б, л/100', 'Записей выдачи с суммой А', 'Записей выдачи с суммой Б'],
    ...rows.map(row => [row.label, row.pv, row.cv, row.delta, row.pct, row.a.coverage, row.b.coverage, row.a.weightedNorm, row.b.weightedNorm, row.a.sumKnown, row.b.sumKnown])];
  const detailRows = [['Период','Группа','Машина','Дата','Пробег','Факт движения','Холостой ход','Расчёт нормы','Источник расхода','Источник нормы','Выдано','Сумма','ID записи']];
  rows.forEach(row => ['a','b'].forEach(side => row[side].details.forEach(({record:r, vehicle:v, quality:q}) => detailRows.push([side === 'a' ? 'А' : 'Б',row.label,fpVehicleTitle(v),r.date,fqValue(r.km),q.actual,q.idle,q.norm,fqSourceLabel(q.source),q.normSource === 'record' ? 'Сохранено в записи' : q.normSource === 'vehicle' ? 'Текущая карточка' : 'Нет данных',fqValue(r.fuelIssued),fqValue(r.fuelSum),r.id]))));
  [summary, detailRows].forEach((values, index) => { const sheet = XLSX.utils.aoa_to_sheet(values); sheet['!cols'] = values[values.length > 3 ? 3 : 0].map(() => ({wch:22})); XLSX.utils.book_append_sheet(wb,sheet,index ? 'Исходные записи' : 'Сравнение'); });
  const cost=fqCostDecomposition(fqCompareCombine(rows.map(row => row.a)),fqCompareCombine(rows.map(row => row.b)));
  const costRows=[['Причина изменения стоимости','Сумма, ₽'],['Объём',cost.volume],['Цена внутри марки',cost.price],['Остаток изменения записанных сумм',cost.residual],['Полнота стоимости',cost.complete ? 'Все записи выдачи с суммой' : 'Неполные суммы: не оценка всех затрат'],[],['Марка','Литры А','Литры Б','Цена А','Цена Б','Вклад объёма','Вклад цены'],...cost.grades.map(row => [row.grade,row.qA,row.qB,row.pA,row.pB,row.volume,row.price])];
  const costSheet=XLSX.utils.aoa_to_sheet(costRows); costSheet['!cols']=Array.from({length:7},() => ({wch:25})); XLSX.utils.book_append_sheet(wb,costSheet,'Изменение стоимости');
  XLSX.writeFile(wb, 'Сравнение_' + periods.a.from + '_' + periods.b.to + '.xlsx');
}
