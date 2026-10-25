/* Generated from src/ui/gsm-statement-host.d.ts, src/ui/gsm-statement.ts by scripts/build-gsm-ui.cjs.
 * TypeScript 5.9.3; source/config sha256:113384eabc0b6200baecb5a7d5f82a17dd57dea372acdaccd90830c5ac5a394f. Do not edit directly. */
"use strict";
// Read-only presentation of the already prepared fuel ledger. Source forms own
// all editing and persistence; this module changes only the expanded row.
let gsmStatementSelectedToken = null, gsmStatementContext = null;
function gsmStatementEsc(value) { return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])); }
function gsmStatementNumber(value) {
    if (typeof value !== 'number' && typeof value !== 'string')
        return null;
    if (typeof DecimalCore !== 'undefined' && typeof DecimalCore.parse === 'function' && typeof DecimalCore.toNumberExact === 'function') {
        try {
            return DecimalCore.toNumberExact(DecimalCore.parse(value));
        }
        catch {
            return null;
        }
    }
    // Small legacy embedders may omit the decimal module. Keep its decimal-only
    // syntax rather than interpreting hexadecimal, booleans or empty values.
    if (typeof value === 'string' && !/^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value.trim()))
        return null;
    return Number.isFinite(Number(value)) ? Number(value) : null;
}
function gsmStatementFormat(value) { const number = gsmStatementNumber(value); return number === null ? 'Не определён' : number.toLocaleString('ru-RU', { maximumFractionDigits: 3 }); }
function gsmStatementHasId(value) { return typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && value !== ''; }
function gsmStatementId(value) { return JSON.stringify([typeof value, value]); }
function gsmStatementOrg(value) { return typeof gsmOrgKey === 'function' ? gsmOrgKey(value) : String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru'); }
function gsmStatementFamily(value) { return typeof gsmFamily === 'function' ? gsmFamily(value) : String(value ?? ''); }
function gsmStatementFuelApi() { return typeof TvsFuelEngine === 'undefined' ? null : TvsFuelEngine; }
function gsmStatementValidDate(value) { const api = gsmStatementFuelApi(); if (api?.fqDate)
    return api.fqDate(value); if (!/^\d{4}-\d{2}-\d{2}$/.test(value || ''))
    return false; const day = new Date(value + 'T12:00:00Z'); return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === value; }
function gsmStatementRecordFamily(record, vehicle) { const api = gsmStatementFuelApi(); return api?.fqRecordFuelFamily ? api.fqRecordFuelFamily(record, vehicle) : gsmStatementFamily(record.fuelGrade || vehicle.fuelGrade); }
function gsmStatementInPeriod(date, ledger) { return !gsmStatementValidDate(date) || (!ledger.from || date >= ledger.from) && (!ledger.to || date <= ledger.to); }
function gsmStatementToken(row) { return JSON.stringify([typeof row.vehicleId, row.vehicleId, gsmStatementOrg(row.org), row.grade ?? '']); }
function gsmStatementDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? typeof fmtDate === 'function' ? fmtDate(value) : value : 'Дата не задана'; }
function gsmStatementStamp() { return typeof dispatcherAnalysisStamp === 'function' ? dispatcherAnalysisStamp() : typeof syncSessionStamp === 'function' ? syncSessionStamp() : null; }
function gsmStatementSourceData() { return typeof data === 'undefined' ? null : data; }
function gsmStatementCurrent() {
    const context = gsmStatementContext;
    if (context && context.database === gsmStatementSourceData() && context.stamp === gsmStatementStamp())
        return context;
    if (typeof showToast === 'function')
        showToast('Данные или сеанс изменились. Обновите ведомость перед открытием источника.');
    return null;
}
function gsmStatementSelect(value) {
    const context = gsmStatementCurrent();
    if (!context)
        return false;
    const token = typeof value === 'number' && Number.isInteger(value) ? context.rows[value]?.token : value;
    if (typeof token !== 'string' || !context.rows.some(row => row.token === token))
        return false;
    gsmStatementSelectedToken = gsmStatementSelectedToken === token ? null : token;
    if (typeof renderFuelPurchases === 'function')
        renderFuelPurchases();
    return true;
}
function gsmStatementOpenSource(index) {
    const context = gsmStatementCurrent(), ref = context?.refs[index];
    if (!ref)
        return false;
    const db = context.database;
    if (ref.kind === 'vehicle') {
        if ((db?.vehicles || []).filter(row => row.id === ref.id).length !== 1)
            return false;
        if (typeof switchSection === 'function' && typeof selectVehicle === 'function') {
            switchSection('vehicles');
            selectVehicle(ref.id);
            return true;
        }
    }
    if (ref.kind === 'opening' && typeof fuelAccountingOpen === 'function') {
        if ((db?.vehicles || []).filter(row => row.id === ref.id).length !== 1)
            return false;
        fuelAccountingOpen('vehicles', ref.id);
        return true;
    }
    const section = ref.kind === 'purchase' ? 'fuelPurchases' : 'records';
    if ((db?.[section] || []).filter(row => row.id === ref.id).length !== 1)
        return false;
    if (ref.kind === 'purchase' && typeof fpEdit === 'function') {
        fpEdit(ref.id);
        return true;
    }
    if (ref.kind === 'record' && typeof gsmEditRecord === 'function') {
        gsmEditRecord(ref.id);
        return true;
    }
    return false;
}
function gsmStatementSourceButton(kind, id, label) {
    if (!gsmStatementHasId(id))
        return '';
    const context = gsmStatementContext, index = context.refs.push({ kind, id }) - 1;
    return '<button type="button" class="btn btn-ghost btn-sm" data-gsm-statement-source="' + gsmStatementEsc(kind) + '" onclick="gsmStatementOpenSource(' + index + ')">' + gsmStatementEsc(label) + '</button>';
}
function gsmStatementIndex(values, field) {
    const index = new Map();
    for (const value of values || []) {
        const key = gsmStatementId(value[field]);
        if (!index.has(key))
            index.set(key, []);
        index.get(key).push(value);
    }
    return index;
}
function gsmStatementIssueMatches(issue, row) {
    if (issue.vehicleId !== row.vehicleId)
        return false;
    if (issue.grade && gsmStatementFamily(issue.grade) !== gsmStatementFamily(row.grade))
        return false;
    // A missing amount can affect every organisation that owns the same fuel.
    if (['consumption-missing', 'date', 'negative-input'].includes(issue.code))
        return true;
    const organizations = [issue.org, ...(issue.orgs || [])].filter(Boolean);
    return !organizations.length || organizations.some(org => gsmStatementOrg(org) === gsmStatementOrg(row.org));
}
function gsmStatementIssues(ledger) {
    const issues = new Map();
    for (const issue of [...(ledger.issues || []), ...(ledger.errors || [])]) {
        const key = JSON.stringify([issue.code, typeof issue.vehicleId, issue.vehicleId, typeof issue.recordId, issue.recordId, typeof issue.purchaseId, issue.purchaseId, issue.org, issue.grade, issue.field, issue.date, issue.message]);
        if (!issues.has(key))
            issues.set(key, issue);
    }
    return [...issues.values()];
}
function gsmStatementHistory(row, ledger, index, vehicle, accountingFrom) {
    const family = gsmStatementFamily(row.grade), cacheKey = JSON.stringify([typeof row.vehicleId, row.vehicleId, family, accountingFrom]);
    if (index.history.has(cacheKey))
        return index.history.get(cacheKey);
    const records = (index.records.get(gsmStatementId(row.vehicleId)) || []).filter(record => !record.deleted && !record.cancelled && record.status !== 'cancelled' && gsmStatementValidDate(record.date) && (!accountingFrom || record.date >= accountingFrom) && (!ledger.to || record.date <= ledger.to))
        .slice().sort((a, b) => a.date.localeCompare(b.date));
    const api = gsmStatementFuelApi(), plan = api?.fqMeasurementPlan ? api.fqMeasurementPlan(records, vehicle) : null;
    const measurements = records.filter(record => record.tankMeasured !== null && record.tankMeasured !== undefined && String(record.tankMeasured).trim() !== '' && gsmStatementRecordFamily(record, vehicle) === family)
        .map((record, order) => ({ record, order, qty: gsmStatementNumber(record.tankMeasured) })).sort((a, b) => b.record.date.localeCompare(a.record.date) || b.order - a.order);
    // The engine applies the day's last valid measurement at the last journal
    // row of the same fuel family. It can restore a missing historical opening;
    // an observation in another family, after the cutoff or before accounting
    // began cannot do so. No ledger amount is recalculated here.
    const applied = plan ? [...plan.measurements.values()].filter(record => gsmStatementRecordFamily(record, vehicle) === family) : measurements.filter(item => item.qty !== null && item.qty >= 0).map(item => item.record);
    const priorMeasurement = ledger.from ? applied.filter(record => record.date < ledger.from).sort((a, b) => b.date.localeCompare(a.date))[0] || null : null;
    const gaps = new Set((index.issues.get(gsmStatementId(row.vehicleId)) || []).filter(issue => issue.code === 'consumption-missing' && gsmStatementIssueMatches(issue, row) && gsmStatementValidDate(issue.date) && ledger.from && issue.date < ledger.from).map(issue => issue.date));
    if (ledger.from && api?.fqRecord)
        for (const record of records) {
            if (record.date >= ledger.from || gsmStatementRecordFamily(record, vehicle) !== family || !((gsmStatementNumber(record.km) ?? 0) > 0))
                continue;
            const key = plan?.keyFor(record), measured = plan && plan.lastOnDate.get(key) === record.id && plan.measurements.has(key);
            if (!measured && api.fqRecord(record, vehicle).source === 'missing')
                gaps.add(record.date);
        }
    // A measurement is an end-of-day anchor, including earlier gaps that day.
    const unresolvedOpeningGap = [...gaps].some(date => !priorMeasurement || date > priorMeasurement.date);
    const result = { records, measurements, priorMeasurement, unresolvedOpeningGap };
    index.history.set(cacheKey, result);
    return result;
}
function gsmStatementBuildVehicleRow(row, ledger, index) {
    const key = gsmStatementId(row.vehicleId), vehicle = index.vehicles.get(key)?.[0] || row.vehicle || {}, issues = (index.issues.get(key) || []).filter(issue => gsmStatementIssueMatches(issue, row));
    const currentIssues = issues.filter(issue => gsmStatementInPeriod(issue.date, ledger));
    const movements = (index.movements.get(key) || []).filter(item => gsmStatementOrg(item.org) === gsmStatementOrg(row.org) && item.grade === row.grade && gsmStatementInPeriod(item.date, ledger));
    const consumption = movements.filter(item => item.kind === 'consumption'), receipts = movements.filter(item => item.kind === 'receipt');
    const accounting = (ledger.accounting || []).find(item => item.vehicleId === row.vehicleId);
    const anchor = vehicle.fuelAccounting && typeof vehicle.fuelAccounting === 'object' ? vehicle.fuelAccounting : null;
    const accountingFrom = accounting?.from || anchor?.from || row.accountingFrom || '', history = gsmStatementHistory(row, ledger, index, vehicle, accountingFrom), { measurements, priorMeasurement } = history;
    const explicitOpening = accounting ? gsmStatementNumber(accounting.opening) : anchor ? gsmStatementNumber(anchor.opening) : null;
    let openingMissing = explicitOpening === null && gsmStatementNumber(vehicle.fuelBalance) === null && !priorMeasurement;
    const api = gsmStatementFuelApi();
    if (typeof api?.openingEvidence === 'function') {
        try {
            openingMissing = api.openingEvidence(gsmStatementSourceData() || {}, row.vehicleId, { before: ledger.from, family: gsmStatementFamily(row.grade) }).status !== 'known';
        }
        catch {
            openingMissing = true;
        }
    }
    const has = (code) => currentIssues.some(issue => issue.code === code);
    const missingConsumption = has('consumption-missing') || consumption.some(item => item.source === 'missing');
    const invalidRecordDate = currentIssues.some(issue => issue.code === 'date' && gsmStatementHasId(issue.recordId));
    const invalidPurchaseDate = currentIssues.some(issue => issue.code === 'date' && gsmStatementHasId(issue.purchaseId));
    const fields = { opening: gsmStatementNumber(row.start), issued: gsmStatementNumber(row.issued), spent: gsmStatementNumber(row.spent), correction: gsmStatementNumber(row.correction), end: gsmStatementNumber(row.end) };
    const reasons = {};
    if (openingMissing)
        reasons.opening = 'Не задан исходный остаток или подтверждённое начало учёта';
    if (history.unresolvedOpeningGap)
        reasons.opening = 'В истории до начала периода есть пробег без расхода, не покрытый последующим замером';
    if (missingConsumption || invalidRecordDate || has('negative-input'))
        reasons.spent = missingConsumption ? 'Есть пробег без расхода и применимого замера' : 'Проверьте исходную запись журнала';
    if (invalidPurchaseDate || has('negative-input'))
        reasons.issued = 'Не все исходные поступления могут быть учтены';
    if (reasons.opening || reasons.spent || reasons.issued)
        reasons.end = 'Недостаточно исходных данных для полного остатка';
    for (const name of Object.keys(fields))
        if (fields[name] === null)
            reasons[name] = reasons[name] || 'В расчёте нет значения';
    const sources = [...new Set(consumption.map(item => item.source))], labels = { actual: 'Введённый расход', norm: 'По норме', measurement: 'По замеру', missing: 'Не задан' };
    const sourceLabel = sources.map(source => labels[source] || 'Проверьте основание').join(' · ') || (fields.spent === 0 ? 'Нет записей расхода' : 'Основание не указано');
    const negative = fields.end !== null && fields.end < -0.000001, unknown = Object.keys(reasons).length > 0;
    const review = currentIssues.some(issue => issue.severity === 'error');
    return { row, vehicle, token: gsmStatementToken(row), issues, movements, consumption, receipts, measurements, fields, reasons, negative, unknown, review, sourceLabel,
        basis: priorMeasurement ? 'Перенос по операциям после замера ' + gsmStatementDate(priorMeasurement.date) + ' (' + gsmStatementFormat(priorMeasurement.tankMeasured) + ' л, весь бак)' : accounting?.basis || anchor?.basis || (ledger.from ? 'Перенос по истории операций' : 'Исходный остаток карточки'), accountingFrom };
}
function gsmStatementValue(model, name, options = {}) {
    const value = model.fields[name], unknown = !!model.reasons[name], negative = value !== null && value < -0.000001;
    const status = unknown ? 'unknown' : negative ? 'negative' : 'known';
    return '<td class="gsm-statement-number' + (negative ? ' gsm-statement-negative' : '') + '" data-gsm-value="' + name + '" data-status="' + status + '"' + (negative ? ' data-negative="true"' : '') + '>' +
        (unknown ? '<span class="gsm-statement-unknown" title="' + gsmStatementEsc(model.reasons[name]) + '">Не определён</span>' + (negative ? '<small>В расчёте ' + gsmStatementEsc(gsmStatementFormat(value)) + ' л</small>' : '') : gsmStatementEsc((options.signed && value !== null && value > 0 ? '+' : '') + gsmStatementFormat(value))) + '</td>';
}
function gsmStatementStatus(model) {
    const tone = model.negative ? 'negative' : model.unknown ? 'unknown' : model.review ? 'review' : 'calculated';
    const label = model.negative ? 'Отрицательный остаток' : model.unknown ? 'Не хватает данных' : model.review ? 'Проверить источники' : 'Расчёт';
    return '<span class="gsm-statement-status gsm-statement-status-' + tone + '" data-gsm-statement-status="' + tone + '">' + label + '</span>' +
        (model.negative && model.unknown ? '<small>Исходные данные неполны</small>' : '') + (model.issues.length ? '<small>' + model.issues.length + ' замечаний к источникам</small>' : '');
}
function gsmStatementVehicleCell(model) {
    const title = model.vehicle.plate || model.vehicle.name || 'Машина ' + String(model.row.vehicleId), expanded = gsmStatementSelectedToken === model.token;
    return '<th scope="row"><button type="button" class="gsm-statement-select" data-gsm-statement-select aria-expanded="' + expanded + '" onclick="gsmStatementSelect(' + gsmStatementEsc(JSON.stringify(model.token)) + ')">' + gsmStatementEsc(title) + ' <span aria-hidden="true">' + (expanded ? '▴' : '▾') + '</span></button>' +
        (model.vehicle.make ? '<small>' + gsmStatementEsc(model.vehicle.make) + '</small>' : '') + '<div class="gsm-statement-owner">' + gsmStatementEsc(model.row.org || 'Организация не указана') + '<span>' + gsmStatementEsc(model.row.grade || 'Топливо не указано') + '</span></div></th>';
}
function gsmStatementList(title, items, render, empty) {
    const shown = items.slice(0, 8), rest = items.slice(8);
    return '<section class="gsm-statement-evidence"><h4>' + title + ' <span>' + items.length + '</span></h4>' + (items.length ? '<ul>' + shown.map(render).join('') + '</ul>' + (rest.length ? '<details><summary>Ещё ' + rest.length + '</summary><ul>' + rest.map(render).join('') + '</ul></details>' : '') : '<p>' + empty + '</p>') + '</section>';
}
function gsmStatementDetail(model, ledger, columnCount) {
    const quantity = (name) => model.reasons[name] ? 'не определён' : gsmStatementFormat(model.fields[name]) + ' л';
    const formula = quantity('opening') + ' + ' + quantity('issued') + ' − ' + quantity('spent') + ' + (' + quantity('correction') + ') = ' + quantity('end');
    const movementSource = (item) => gsmStatementHasId(item.purchaseId) ? gsmStatementSourceButton('purchase', item.purchaseId, 'Проверить заправку') : gsmStatementSourceButton('record', item.recordId, 'Проверить запись');
    const receipts = gsmStatementList('Поступления', model.receipts, item => '<li><div><strong>' + gsmStatementEsc(gsmStatementDate(item.date)) + ' · ' + gsmStatementEsc(gsmStatementFormat(item.qty)) + ' л</strong><small>' + gsmStatementEsc([item.manual ? 'Ручное поступление' : 'Выписка', item.cardNo ? 'Карта ' + item.cardNo : '', item.provider].filter(Boolean).join(' · ')) + '</small></div>' + movementSource(item) + '</li>', 'В этом расчёте нет поступлений по строке.');
    const labels = { actual: 'Введённый расход', norm: 'Расчёт по норме', measurement: 'По замеру остатка', missing: 'Расход не задан' };
    const consumption = gsmStatementList('Основания расхода', model.consumption, item => '<li><div><strong>' + gsmStatementEsc(gsmStatementDate(item.date)) + ' · ' + gsmStatementEsc(gsmStatementFormat(item.qty)) + ' л</strong><small>' + gsmStatementEsc(labels[item.source] || 'Основание не указано') + ((gsmStatementNumber(item.idle) ?? 0) > 0 ? ' · холостой ход включён' : '') + '</small></div>' + gsmStatementSourceButton('record', item.recordId, 'Проверить журнал') + '</li>', 'Нет строк расхода. Это не подтверждает фактический нулевой расход.');
    const measurements = gsmStatementList('Замеры всего бака', model.measurements, item => '<li><div><strong>' + gsmStatementEsc(gsmStatementDate(item.record.date)) + ' · ' + gsmStatementEsc(item.qty === null || item.qty < 0 ? 'Некорректный замер' : gsmStatementFormat(item.qty) + ' л') + '</strong><small>' + gsmStatementEsc(ledger.from && item.record.date < ledger.from ? 'Ранее выбранного периода' : 'Факт замера по журналу') + '</small></div>' + gsmStatementSourceButton('record', item.record.id, 'Проверить замер') + '</li>', 'Замеров до даты среза нет. Расчётный остаток не является замером.');
    const corrections = model.movements.filter(item => ['grade-reconciliation', 'measurement-correction'].includes(item.kind));
    const correctionHtml = gsmStatementList('Корректировки и сверка марок', corrections, item => '<li><div><strong>' + gsmStatementEsc(gsmStatementDate(item.date)) + ' · ' + gsmStatementEsc(gsmStatementFormat(item.delta)) + ' л</strong><small>' + gsmStatementEsc(item.kind === 'grade-reconciliation' ? (item.fromGrade || '') + ' → ' + (item.toGrade || '') : 'Корректировка по замеру') + '</small></div>' + movementSource(item) + '</li>', 'Отдельных корректировок по строке нет.');
    const issues = model.issues.length ? '<details class="gsm-statement-notes"' + (model.unknown || model.negative ? ' open' : '') + '><summary>Что проверить</summary><ul>' + model.issues.map(issue => '<li>' + gsmStatementEsc(issue.message || issue.code) + '</li>').join('') + '</ul></details>' : '';
    return '<tr class="gsm-statement-detail-row" data-gsm-statement-detail="' + gsmStatementEsc(model.token) + '"><td colspan="' + columnCount + '"><div class="gsm-statement-detail"><div class="gsm-statement-detail-heading"><h3>Как получен остаток</h3><div>' + gsmStatementSourceButton('vehicle', model.row.vehicleId, 'Карточка машины') + gsmStatementSourceButton('opening', model.row.vehicleId, 'Проверить начало учёта') + '</div></div><p class="gsm-statement-formula-label">На начало + поступило − расход + корректировки = на конец</p><p class="gsm-statement-formula">' + gsmStatementEsc(formula) + '</p><p class="gsm-statement-explanation">' + gsmStatementEsc(model.basis) + (model.accountingFrom ? ' · Начало учёта ' + gsmStatementEsc(gsmStatementDate(model.accountingFrom)) : '') + '. Объёмы показаны с точностью до 0,001 л. Замер относится ко всему баку и семейству топлива; доля организации не считается отдельным физическим замером.</p>' + issues + '<div class="gsm-statement-evidence-grid">' + receipts + consumption + measurements + correctionHtml + '</div></div></td></tr>';
}
function gsmStatementMeasurementCells(model, ledger, allModels) {
    const last = model.measurements[0], valid = !!last && last.qty !== null && last.qty >= 0;
    const group = allModels.filter(item => item.row.vehicleId === model.row.vehicleId && gsmStatementFamily(item.row.grade) === gsmStatementFamily(model.row.grade));
    const comparable = valid && !!ledger.to && last.record.date === ledger.to && group.length === 1 && !model.reasons.end;
    const comparison = comparable ? Math.abs(last.qty - (model.fields.end ?? 0)) <= 0.001000001 ? 'Совпадает на дату среза' : 'Есть разница на дату среза' : !last ? 'Нет фактического замера' : !valid ? 'Проверьте запись замера' : group.length > 1 ? 'Замер всего бака, не доли организации' : 'Дата замера отличается от среза';
    return '<td data-gsm-value="measured" data-status="' + (valid ? 'known' : 'unknown') + '">' + (valid ? gsmStatementEsc(gsmStatementFormat(last.qty)) : '<span class="gsm-statement-unknown">' + (last ? 'Некорректный замер' : 'Нет замера') + '</span>') + '</td><td>' + (last ? gsmStatementEsc(gsmStatementDate(last.record.date)) : '—') + '</td>' + gsmStatementValue(model, 'end') + '<td class="gsm-statement-comparison">' + comparison + '</td><td>' + gsmStatementStatus(model) + '</td>';
}
function gsmVehicleStatementHtml(ledger, options = {}) {
    options = options && typeof options === 'object' ? options : {};
    const stage = options.stage === 'opening' || options.stage === 'measurements' ? options.stage : 'statement';
    if (!ledger || !Array.isArray(ledger.rows)) {
        gsmStatementContext = null;
        gsmStatementSelectedToken = null;
        return '<section class="gsm-statement" data-gsm-statement="' + stage + '"><p role="status">Подготовьте расчёт ГСМ, чтобы открыть ведомость.</p></section>';
    }
    const db = gsmStatementSourceData(), stamp = gsmStatementStamp(), index = { vehicles: gsmStatementIndex(db?.vehicles || [], 'id'), records: gsmStatementIndex(db?.records || [], 'vehicleId'), movements: gsmStatementIndex(ledger.movements || [], 'vehicleId'), issues: gsmStatementIndex(gsmStatementIssues(ledger), 'vehicleId'), history: new Map() };
    const allModels = ledger.rows.map(row => gsmStatementBuildVehicleRow(row, ledger, index)), models = allModels.filter(model => typeof gsmVisible !== 'function' || gsmVisible(model.row));
    if (gsmStatementContext && (gsmStatementContext.database !== db || gsmStatementContext.stamp !== stamp))
        gsmStatementSelectedToken = null;
    gsmStatementContext = { ledger, database: db, stamp, rows: models, refs: [] };
    const cutoff = ledger.to ? 'на конец ' + gsmStatementDate(ledger.to) : 'после всех операций';
    const period = ledger.from ? 'С ' + gsmStatementDate(ledger.from) + (ledger.to ? ' по ' + gsmStatementDate(ledger.to) : '') : 'Вся история';
    const headers = stage === 'opening' ? ['Машина', 'Дата начала учёта', 'На начало, л', 'Основание', 'Проверка'] : stage === 'measurements' ? ['Машина', 'Замер всего бака, л', 'Дата замера', 'Расчётный остаток, л', 'Сопоставление', 'Проверка'] : ['Машина', 'На начало, л', 'Поступило, л', 'Расход, л', 'Корректировки ±, л', 'На конец, л', 'Основание расхода', 'Проверка'];
    const rows = models.map(model => '<tr class="gsm-statement-row' + (model.negative ? ' gsm-statement-row-negative' : '') + '" data-gsm-vehicle-ref="' + gsmStatementEsc(JSON.stringify(['vehicles', typeof model.row.vehicleId, model.row.vehicleId])) + '" data-gsm-statement-token="' + gsmStatementEsc(model.token) + '">' + gsmStatementVehicleCell(model) +
        (stage === 'opening' ? '<td>' + gsmStatementEsc(model.accountingFrom ? gsmStatementDate(model.accountingFrom) : 'По всей истории') + '</td>' + gsmStatementValue(model, 'opening') + '<td class="gsm-statement-basis">' + gsmStatementEsc(model.basis) + '</td><td>' + gsmStatementStatus(model) + '</td>' : stage === 'measurements' ? gsmStatementMeasurementCells(model, ledger, allModels) : gsmStatementValue(model, 'opening') + gsmStatementValue(model, 'issued') + gsmStatementValue(model, 'spent') + gsmStatementValue(model, 'correction', { signed: true }) + gsmStatementValue(model, 'end') + '<td class="gsm-statement-basis">' + gsmStatementEsc(model.sourceLabel) + '</td><td>' + gsmStatementStatus(model) + '</td>') + '</tr>' + (gsmStatementSelectedToken === model.token ? gsmStatementDetail(model, ledger, headers.length) : '')).join('');
    return '<section class="gsm-statement" data-gsm-statement="' + stage + '"><div class="gsm-statement-heading"><div><h3>' + (stage === 'opening' ? 'Входящие остатки по машинам' : stage === 'measurements' ? 'Замеры и расчётные остатки' : 'Ведомость по машинам') + '</h3><p>' + gsmStatementEsc(period) + ' · Срез ' + gsmStatementEsc(cutoff) + '</p></div><span class="gsm-statement-count">' + models.length + ' строк</span></div><p class="gsm-statement-hint">Одна строка — машина, организация и марка топлива. Все объёмы в литрах. Расчётное число не подтверждает фактический замер; откройте машину, чтобы увидеть исходные записи.</p><div class="gsm-statement-scroll"><table class="gsm-statement-table"><thead><tr>' + headers.map(header => '<th scope="col">' + header + '</th>').join('') + '</tr></thead><tbody>' + (rows || '<tr><td colspan="' + headers.length + '" class="gsm-statement-empty">За выбранный период и фильтры расчётных строк нет. Это не подтверждает нулевые остатки машин.</td></tr>') + '</tbody></table></div></section>';
}
