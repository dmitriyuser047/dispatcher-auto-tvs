/* Generated from src/server by scripts/build-inventory-server.cjs.
 * TypeScript 5.9.3; Node types 24.19.2; source/config sha256:809f63c1db8eb780156769a6c61010673a0a978136ad9c755657cc312b6a5ca5. Do not edit directly. */
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prepare = prepare;
exports.xlsx = xlsx;
exports.html = html;
exports.digestBytes = digestBytes;
const crypto = require("node:crypto");
const storage = require('./storage'), policy = require('./access-context.cjs'), access = require('./access-control'), core = require('../assets/core/asset-inventory.js'), hash = require('../assets/core/request-fingerprint.js');
const sections = ['inventoryOrgs', 'inventoryObjects', 'inventoryMols', 'inventoryItems', 'inventorySessions'];
const headers = ['№', 'Организация', 'Объект', 'МОЛ', 'Счёт', 'Наименование', 'Инвентарный номер', 'Ед.', 'По учёту (количество)', 'По учёту (сумма)', 'Фактически (количество)', 'Фактически (сумма)', 'Расхождение (количество)', 'Расхождение (сумма)', 'Решение', 'Примечание'];
function fail(code, message, status = 400) { throw Object.assign(Error(message), { code, status }); }
function row(value) { if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('INVENTORY_EXPORT_DATA', 'Повреждены данные описи'); return value; }
const values = (value) => Array.isArray(value) ? value.map(row) : [];
const text = (value) => typeof value === 'string' ? value : '';
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch));
const actionName = (value) => value === 'writeoff' ? 'Списать' : value === 'transfer' ? 'Переместить' : '';
const display = (value) => value === null || value === undefined ? 'Не определено' : String(value).replace('.', ',');
const fingerprint = (value) => 'sha256:' + hash.sha256(hash.stableSerialize(value));
function numeric(value) { if (value === null || value === undefined)
    return null; const source = String(value); if (!/^-?\d+(?:\.\d+)?$/.test(source))
    fail('INVENTORY_EXPORT_NUMBER', 'Некорректное число в описи'); const significant = source.replace(/[-.]/g, '').replace(/^0+/, '').length; return significant > 15 ? source : Number(source); }
function costOrQuantity(value, name) { const exact = value[name + 'Decimal']; return exact === null ? null : exact ?? value[name] ?? null; }
function reportRows(model) { return values(model.rows).map((value, index) => [index + 1, value.orgName, value.objectName, value.molName, value.accountCode, value.name, String(value.code ?? ''), value.unit, numeric(value.qtyAcct), numeric(value.costAcct), numeric(value.qtyFact), numeric(value.costFact), numeric(costOrQuantity(value, 'qtyDifference')), numeric(costOrQuantity(value, 'costDifference')), actionName(value.action), value.note]); }
function prepare(directory, payloadValue, principalValue) {
    const payload = row(payloadValue);
    if (Object.keys(payload).some(key => !['format', 'sessionId', 'databaseToken', 'sourceFingerprint'].includes(key)))
        fail('INVENTORY_EXPORT_REQUEST', 'Неизвестные параметры выгрузки');
    const format = payload.format;
    if (format !== 'pdf' && format !== 'xlsx')
        fail('INVENTORY_EXPORT_FORMAT', 'Выберите PDF или Excel');
    const id = payload.sessionId;
    if (!(typeof id === 'string' && id.length > 0 || typeof id === 'number' && Number.isFinite(id)))
        fail('INVENTORY_EXPORT_ID', 'Укажите опись');
    const principal = policy.normalizePrincipal(principalValue);
    if (!principal.id)
        fail('ACCESS_DENIED', 'Учётная запись не подтверждена', 403);
    return storage.withDatabaseLock(directory, () => {
        if (!require('./sqlite-storage.cjs').exists(directory) || storage.schemaVersion(directory) !== 6)
            fail('INVENTORY_SQLITE_REQUIRED', 'Для выгрузки нужна база инвентаризации SQLite', 428);
        const token = storage.databaseToken(directory);
        if (payload.databaseToken !== token)
            fail('DATABASE_CHANGED', 'База изменилась. Откройте опись заново.', 409);
        if (sections.some(name => !access.authorize(principal, 'read', name)))
            fail('ACCESS_DENIED', 'Нет права на полную инвентаризационную опись', 403);
        const accessPolicy = principal.accessPolicy && typeof principal.accessPolicy === 'object' ? row(principal.accessPolicy) : {}, rules = accessPolicy.sections && typeof accessPolicy.sections === 'object' ? row(accessPolicy.sections) : {};
        for (const name of sections) {
            const rule = rules[name];
            if (rule && typeof rule === 'object') {
                const allowed = row(rule).readFields;
                if (Array.isArray(allowed) && !allowed.includes('*'))
                    fail('ACCESS_DENIED', 'Для полной выгрузки нужен доступ ко всем полям инвентаризации', 403);
            }
        }
        const db = storage.readAll(directory), matches = (db.inventorySessions ?? []).filter(value => value.id === id);
        if (matches.length !== 1)
            fail('INVENTORY_EXPORT_MISSING', 'Опись не найдена или её идентификатор неоднозначен', 404);
        const source = matches[0], scope = policy.create(db, db, principal);
        if (!scope.permits('inventorySessions', 'read', source) || hash.stableSerialize(scope.projectRows('inventorySessions', [source])[0]) !== hash.stableSerialize(source))
            fail('ACCESS_DENIED', 'Нет права на полный документ', 403);
        const sourceFingerprint = fingerprint(source);
        if (payload.sourceFingerprint !== undefined && payload.sourceFingerprint !== sourceFingerprint)
            fail('INVENTORY_EXPORT_STALE', 'Опись изменилась. Повторите выгрузку.', 409);
        const model = core.exportModel(source), name = ('Инвентаризация_' + text(model.objectName) + '_' + text(model.date)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120);
        return { ok: true, sessionId: id, format, databaseToken: token, sourceFingerprint, model, defaultFileName: (name || 'Инвентаризация') + '.' + format, templateVersion: 1 };
    });
}
function summaryRows(model) {
    const summary = row(model.summary), costs = row(summary.costs), out = [['Организация', 'Единица', 'Учёт, кол.', 'Факт, кол.', 'Расхождение, кол.']];
    for (const organization of values(model.organizations)) {
        for (const unit of values(row(organization.summary).quantities))
            out.push([organization.name, unit.unit ?? 'Не указана', numeric(costOrQuantity(unit, 'qtyAcct')), numeric(costOrQuantity(unit, 'qtyFact')), numeric(costOrQuantity(unit, 'difference'))]);
    }
    out.push([], ['Строк', summary.rows], ['Проверено', summary.checked], ['Недостач, позиций', summary.shortage], ['Излишков, позиций', summary.surplus], [], ['Учётная стоимость', numeric(costOrQuantity(costs, 'costAcct'))], ['Фактическая стоимость', numeric(costOrQuantity(costs, 'costFact'))], ['Разница стоимости', numeric(costOrQuantity(costs, 'difference'))]);
    return out;
}
function amendmentRows(model) {
    const entries = values(model.rows);
    return values(model.amendments).map(change => { const item = entries.find(value => value.id === change.rowId), before = row(change.before), after = row(change.after); const describe = (value) => 'Ед.: ' + (text(value.unit) || 'Не указана') + '; количество: ' + display(value.qtyAcct) + '; сумма: ' + display(value.costAcct); return [change.at, change.reason, text(change.actor), item ? String(item.code ?? '') + ' · ' + text(item.name) : String(change.rowId), describe(before), describe(after)]; });
}
async function xlsx(report) {
    const Excel = require('exceljs'), book = new Excel.Workbook(), model = report.model, date = text(model.updatedAt) || text(model.createdAt) || text(row(model.approval ?? {}).at) || '2000-01-01T00:00:00.000Z';
    book.creator = 'Диспетчер ТВС';
    book.created = new Date(date);
    book.modified = new Date(date);
    const sheet = book.addWorksheet('Опись');
    sheet.addRow(['ИНВЕНТАРИЗАЦИОННАЯ ОПИСЬ · ' + text(model.title)]);
    sheet.mergeCells('A1:P1');
    sheet.addRow(['Объект: ' + text(model.objectName)]);
    sheet.addRow(['Дата: ' + text(model.date)]);
    sheet.addRow(['Статус: ' + (model.status === 'approved' ? 'Утверждена' : 'Проект · Не утверждена')]);
    sheet.addRow(['Редакция: ' + String(model.revision ?? 1), 'Примечание: ' + text(model.note)]);
    sheet.addRow([]);
    const heading = sheet.addRow(headers);
    heading.font = { bold: true };
    heading.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDE8FA' } };
    heading.alignment = { wrapText: true, vertical: 'middle' };
    for (const cells of reportRows(model)) {
        const added = sheet.addRow(cells);
        added.eachCell((cell, column) => { if ([9, 11, 13].includes(column))
            cell.numFmt = '0.###';
        else if ([10, 12, 14].includes(column))
            cell.numFmt = '#,##0.00'; });
    }
    sheet.columns = [5, 24, 24, 26, 12, 40, 20, 10, 16, 20, 16, 20, 16, 20, 18, 30].map(width => ({ width }));
    sheet.views = [{ state: 'frozen', ySplit: 7 }];
    sheet.autoFilter = 'A7:P7';
    sheet.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:7' };
    const summary = book.addWorksheet('Итоги');
    for (const cells of summaryRows(model))
        summary.addRow(cells);
    summary.columns = [36, 24, 22, 22, 24].map(width => ({ width }));
    const commission = book.addWorksheet('Комиссия'), members = row(model.commission ?? {});
    commission.addRow(['Председатель', text(row(members.chairman ?? {}).name), text(row(members.chairman ?? {}).position)]);
    for (const member of values(members.members))
        commission.addRow(['Член комиссии', member.name, member.position]);
    const approval = row(model.approval ?? {});
    commission.addRow([]);
    commission.addRow(['Дата решения', approval.date ?? '']);
    commission.addRow(['Решение', approval.document ?? '']);
    commission.addRow(['Подписи проставляются на бумажном экземпляре']);
    commission.addRow(['Контрольный отпечаток', report.sourceFingerprint]);
    commission.columns = [32, 52, 36].map(width => ({ width }));
    if (values(model.amendments).length) {
        const changes = book.addWorksheet('Поправки');
        changes.addRow(['Дата', 'Основание', 'Пользователь', 'Имущество', 'До исправления', 'После исправления']);
        for (const cells of amendmentRows(model))
            changes.addRow(cells);
        changes.columns = [28, 48, 30, 40, 48, 48].map(width => ({ width }));
    }
    const result = await book.xlsx.writeBuffer(), bytes = result instanceof ArrayBuffer ? Buffer.from(result) : Buffer.from(result);
    if (bytes.length > 128 * 1024 * 1024)
        fail('INVENTORY_EXPORT_LIMIT', 'Слишком большой файл описи');
    return bytes;
}
function html(report) {
    const model = report.model, summary = row(model.summary), status = model.status === 'approved' ? 'Утверждена' : 'ПРОЕКТ · НЕ УТВЕРЖДЕНА';
    const columns = ['№', 'Наименование', 'Инвентарный номер', 'Счёт', 'Ед.', 'Учёт, кол.', 'Учёт, сумма', 'Факт, кол.', 'Факт, сумма', 'Δ кол.', 'Δ сумма', 'Решение', 'Примечание'];
    let sequence = 0;
    const tables = values(model.organizations).map(organization => {
        const groups = new Map();
        for (const value of values(organization.rows)) {
            const key = JSON.stringify([typeof value.molId, value.molId, value.objectId]);
            const group = groups.get(key) ?? [];
            group.push(value);
            groups.set(key, group);
        }
        return [...groups.values()].map(group => { const first = group[0]; return '<section><h2>' + escape(organization.name) + ' · ' + escape(first.objectName) + ' · МОЛ: ' + escape(first.molName) + '</h2><table class="ai-lines"><thead><tr>' + columns.map(label => '<th>' + escape(label) + '</th>').join('') + '</tr></thead><tbody>' + group.map(value => '<tr>' + [++sequence, value.name, value.code, value.accountCode, value.unit || 'Не указана', display(value.qtyAcct), display(value.costAcct), display(value.qtyFact), display(value.costFact), display(costOrQuantity(value, 'qtyDifference')), display(costOrQuantity(value, 'costDifference')), actionName(value.action), value.note].map(cell => '<td>' + escape(cell) + '</td>').join('') + '</tr>').join('') + '</tbody></table></section>'; }).join('');
    }).join('');
    const totals = summaryRows(model).filter(cells => cells.length === 5).map(cells => '<tr>' + cells.map(cell => '<td>' + escape(cell === null ? 'Не определено' : cell) + '</td>').join('') + '</tr>').join('');
    const corrections = amendmentRows(model), amendments = corrections.length ? '<h2>История исправлений учётных данных</h2><table class="ai-corrections"><thead><tr>' + ['Дата', 'Основание', 'Пользователь', 'Имущество', 'До исправления', 'После исправления'].map(value => '<th>' + escape(value) + '</th>').join('') + '</tr></thead><tbody>' + corrections.map(cells => '<tr>' + cells.map(value => '<td>' + escape(value) + '</td>').join('') + '</tr>').join('') + '</tbody></table>' : '';
    const commission = row(model.commission ?? {}), people = [row(commission.chairman ?? {}), ...values(commission.members)], approval = row(model.approval ?? {}), costs = row(summary.costs);
    return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Инвентаризационная опись</title><style>@page{size:A4 landscape;margin:10mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#16253c;font-size:9pt;margin:0}h1{font-size:16pt;margin:0 0 8pt}h2{font-size:10pt;margin:12pt 0 5pt;break-after:avoid}p{margin:4pt 0}table{width:100%;border-collapse:collapse;table-layout:fixed;margin:5pt 0 12pt}th,td{border:1px solid #aebaca;padding:4pt 3pt;vertical-align:top;overflow-wrap:anywhere}th{background:#e9eef7;font-weight:bold}thead{display:table-header-group}tr{break-inside:avoid}.ai-lines th:first-child,.ai-lines td:first-child{width:3%}.ai-lines th:nth-child(2),.ai-lines td:nth-child(2){width:18%}.ai-lines th:last-child,.ai-lines td:last-child{width:13%}.ai-totals td{width:20%}.ai-totals td:first-child{width:30%}.ai-totals td:nth-child(2){width:10%}.ai-totals tr:first-child{font-weight:bold;background:#e9eef7}.ai-corrections th,.ai-corrections td{width:14%}.ai-corrections th:first-child,.ai-corrections td:first-child{width:16%}.ai-corrections th:nth-child(2),.ai-corrections td:nth-child(2){width:22%}.ai-corrections th:nth-child(3),.ai-corrections td:nth-child(3){width:16%}.ai-corrections th:nth-child(4),.ai-corrections td:nth-child(4){width:18%}.status{font-weight:bold;color:#244eb1}.commission{break-inside:avoid}.sign{margin-top:12pt}footer{font-size:7pt;color:#586579;margin-top:14pt}</style></head><body><h1>Инвентаризационная опись</h1><p>' + escape(model.title) + '</p><p>' + escape(model.note) + '</p><p>Объект: ' + escape(model.objectName) + ' · Дата: ' + escape(model.date) + ' · Редакция: ' + escape(model.revision ?? 1) + '</p><p class="status">' + escape(status) + '</p><p>Строк: ' + escape(summary.rows) + ' · Проверено: ' + escape(summary.checked) + ' · Недостач: ' + escape(summary.shortage) + ' · Излишков: ' + escape(summary.surplus) + '</p>' + tables + '<h2>Итоги по организациям и единицам</h2><table class="ai-totals">' + totals + '</table><p>Учётная стоимость: ' + escape(display(costOrQuantity(costs, 'costAcct'))) + ' · Фактическая стоимость: ' + escape(display(costOrQuantity(costs, 'costFact'))) + '</p><p>Неизвестные значения отмечены «Не определено».</p>' + amendments + '<div class="commission"><h2>Комиссия</h2>' + people.map(person => '<p class="sign">' + escape(person.position) + ' · ' + escape(person.name) + ' ____________________</p>').join('') + '<p>Решение: ' + escape(approval.document) + ' · Дата: ' + escape(approval.date) + '</p><p>Подписи проставляются на бумажном экземпляре.</p></div><footer>Версия формы 1 · ' + escape(report.sourceFingerprint) + '</footer></body></html>';
}
function digestBytes(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
