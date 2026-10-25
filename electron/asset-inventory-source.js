/* Generated from src/server by scripts/build-inventory-server.cjs.
 * TypeScript 5.9.3; Node types 24.19.2; source/config sha256:8a7fc6b8092c258ae6cf000c69b509fbff1b4ab0ffc7e2085e20891dc5f18165. Do not edit directly. */
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handle = handle;
const path = require("node:path");
const crypto = require("node:crypto");
const node_worker_threads_1 = require("node:worker_threads");
const node_url_1 = require("node:url");
const storage = require('./storage'), access = require('./access-control');
const SECTIONS = ['inventoryOrgs', 'inventoryObjects', 'inventoryMols', 'inventoryItems', 'inventorySessions'], PROFILE = 'asset-inventory';
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
function fail(code, message, status = 400) { throw Object.assign(Error(message), { code, status }); }
function record(value) { if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('IMPORT_MAPPING', 'Нужен объект параметров импорта'); return value; }
function mapping(value, support) {
    const row = record(support.json(value ?? {})), allowed = ['format', 'defaultOrgName', 'defaultObjectName', 'date', 'title', 'useOpeningIfNoClosing', 'target'];
    if (Object.keys(row).some(key => !allowed.includes(key)) || !['legacy', 'osv', 'comparison'].includes(row.format))
        fail('IMPORT_MAPPING', 'Выберите явный формат прежней базы, ОСВ или описи');
    for (const key of ['defaultOrgName', 'defaultObjectName', 'date', 'title'])
        if (Object.hasOwn(row, key) && (typeof row[key] !== 'string' || row[key].length > 2000 || !String(row[key]).trim()))
            fail('IMPORT_MAPPING', 'Заполните непустые параметры импорта');
    if (Object.hasOwn(row, 'useOpeningIfNoClosing') && (typeof row.useOpeningIfNoClosing !== 'boolean' || row.format !== 'osv'))
        fail('IMPORT_MAPPING', 'Начальное сальдо доступно только для ОСВ');
    if (Object.hasOwn(row, 'target')) {
        if (row.format === 'legacy')
            fail('IMPORT_MAPPING', 'Прежняя база переносится отдельным набором справочников');
        const target = record(row.target);
        if (!Object.keys(target).length || Object.keys(target).some(key => !['orgId', 'objectId', 'molId'].includes(key)) || Object.values(target).some(value => typeof value !== 'string' && typeof value !== 'number' || typeof value === 'string' && (!value.trim() || value.length > 500) || typeof value === 'number' && !Number.isFinite(value)))
            fail('IMPORT_MAPPING', 'Нужны точные собственные идентификаторы назначения');
    }
    return row;
}
function allowed(user, action, name) { const selected = user[action === 'read' ? 'readable' : 'writable']; return access.authorize(user, action, name) && (!Array.isArray(selected) || selected.includes('*') || selected.includes(name)); }
function ensure(dir, payload, user, options, support) {
    const token = support.checkBinding(dir, payload, user, options, true);
    if (!['admin', 'accountant'].includes(user.role) || !support.actions(user).includes(PROFILE) || SECTIONS.some(name => !allowed(user, 'write', name) || !access.actionAvailable(user, 'import:' + PROFILE, name)))
        fail('ACCESS_DENIED', 'Импорт инвентаризации доступен администратору и бухгалтеру с полными правами собственных разделов', 403);
    support.requireRead(user, SECTIONS);
    storage.assertWriteCompatibility(dir, options, 'inventoryV1');
    const snapshot = storage.readSnapshot(dir);
    if (snapshot.platform.schemaVersion !== 6 || snapshot.platform.storageKind !== 'sqlite')
        fail('INVENTORY_SQLITE_REQUIRED', 'Импорт инвентаризации требует проверенную базу SQLite схемы 6', 428);
    return token;
}
async function decode(file, selected) {
    const tools = await import((0, node_url_1.pathToFileURL)(path.join(__dirname, '../ReestrBuilder/archive-budget.mjs')).href), temp = tools.createOwnedTemp('reestr-inventory-');
    let worker, timer;
    try {
        const request = { file: { name: file.name, bytes: file.bytes }, mapping: selected, tempDirectory: temp.directory };
        worker = new node_worker_threads_1.Worker(path.join(__dirname, 'asset-inventory-decode-worker.js'), { workerData: request, resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32 } });
        const current = worker;
        return await new Promise((resolve, reject) => {
            let done = false;
            const finish = (error, value) => { if (done)
                return; done = true; if (timer)
                clearTimeout(timer); if (error)
                reject(error);
            else if (value)
                resolve(value);
            else
                reject(Object.assign(Error('Нет результата разбора'), { code: 'IMPORT_DECODE' })); };
            timer = setTimeout(() => finish(Object.assign(Error('Разбор источника превысил 30 секунд'), { code: 'IMPORT_DECODE_TIMEOUT', status: 400 })), 30000);
            current.once('message', (message) => { const value = message; finish(value.ok ? null : Object.assign(Error(value.error || 'Источник не прочитан'), { code: value.code || 'IMPORT_DECODE', status: 400 }), value.value); });
            current.once('error', error => finish(error));
            current.once('exit', () => finish(Object.assign(Error('Разбор завершился без результата'), { code: 'IMPORT_DECODE' })));
        });
    }
    finally {
        if (timer)
            clearTimeout(timer);
        if (worker)
            await worker.terminate();
        tools.removeOwnedTemp(temp);
    }
}
async function stage(dir, payload, options, support) {
    const user = support.principal(options.getPrincipal ? options.getPrincipal() : options.principal), token = ensure(dir, payload, user, options, support), parser = record(payload.parser);
    if (parser.id !== PROFILE || parser.version !== 1 || Object.keys(parser).some(key => !['id', 'version'].includes(key)))
        fail('IMPORT_PARSER', 'Неизвестная версия разбора инвентаризации');
    if (!Array.isArray(payload.sections) || payload.sections.length !== SECTIONS.length || new Set(payload.sections).size !== SECTIONS.length || payload.sections.some(name => typeof name !== 'string' || !SECTIONS.includes(name)))
        fail('IMPORT_SECTIONS', 'Для источника нужны все пять собственных разделов инвентаризации');
    if (Object.hasOwn(payload, 'rows') || Object.hasOwn(payload, 'interpretation'))
        fail('IMPORT_INTERPRETATION_REQUIRED', 'Импорт инвентаризации принимает только исходные байты, без расшифровки из окна');
    const fileInput = record(payload.source);
    if (Object.keys(fileInput).some(key => !['name', 'bytes', 'base64'].includes(key)) || Object.hasOwn(fileInput, 'bytes') === Object.hasOwn(fileInput, 'base64'))
        fail('IMPORT_FILE', 'Выберите один исходный файл и один способ передачи байтов');
    const selected = mapping(payload.mapping, support), file = support.bytesOf(fileInput), result = await decode(file, selected);
    return storage.withDatabaseLock(dir, () => {
        const current = support.principal(options.getPrincipal ? options.getPrincipal() : options.principal);
        if (current.id !== user.id || current.role !== user.role || current.policyStamp !== user.policyStamp)
            fail('ACCESS_DENIED', 'Права изменились во время чтения файла', 403);
        if (ensure(dir, payload, current, options, support) !== token)
            fail('DATABASE_CHANGED', 'База изменилась во время чтения файла', 409);
        if (!result.canImport)
            return { ok: true, canImport: false, issues: result.issues, warnings: result.warnings, databaseToken: token };
        if (!result.data || Object.keys(result.data).length !== SECTIONS.length || SECTIONS.some(name => !Array.isArray(result.data[name])) || !SECTIONS.some(name => result.data[name].length))
            fail('IMPORT_EMPTY', 'В исходнике нет собственных данных инвентаризации');
        const preliminary = { version: 1, profile: PROFILE, sha256: sha(file.bytes), format: selected.format === 'legacy' ? 'inventory-legacy-json' : selected.format === 'osv' ? 'inventory-osv' : 'inventory-comparison', parserVersion: 1, name: file.name, data: result.data, sections: SECTIONS.slice(), sourceScopes: SECTIONS.slice(), warnings: result.warnings, accessScope: { version: 1, policyStamp: current.policyStamp || '' }, ...(selected.target ? { target: selected.target } : {}) };
        support.verifyScopedSource(storage.readAll(dir), preliminary, current, true);
        const folder = support.root(dir, true), original = support.descriptor(file);
        support.writeImmutable(path.join(folder, original.id), file.bytes);
        const source = { ...preliminary, sourceArchive: original }, sql = require('./sqlite-storage.cjs'), body = { version: 1, kind: 'trusted-import-source', binding: { databaseToken: token, sourceDatabase: sql.readIdentity(dir), principal: { id: current.id, role: current.role, ...(current.policyStamp ? { policyStamp: current.policyStamp } : {}) } }, source }, signature = crypto.createHmac('sha256', support.authority(dir, true)).update(support.stable(body)).digest('hex'), bytes = Buffer.from(support.stable({ ...body, signature })), sourceId = sha(bytes);
        if (bytes.length > 32 * 1024 * 1024)
            fail('IMPORT_LIMIT', 'Подготовленный источник превышает 32 МБ');
        support.writeImmutable(path.join(folder, sourceId + '.json'), bytes);
        const loaded = support.load(dir, sourceId, current);
        return { ok: true, canImport: true, sourceId, source: loaded, warnings: result.warnings, issues: [], databaseToken: token };
    });
}
function preview(dir, payload, options, support) {
    return storage.withDatabaseLock(dir, () => {
        const user = support.principal(options.getPrincipal ? options.getPrincipal() : options.principal);
        ensure(dir, payload, user, options, support);
        const snapshot = storage.readSnapshot(dir);
        if (typeof payload.sourceId !== 'string')
            fail('IMPORT_SOURCE', 'Не выбран подготовленный источник');
        const source = support.load(dir, payload.sourceId, user, { database: snapshot.data });
        if (source.profile !== PROFILE)
            fail('IMPORT_PROFILE', 'Источник относится к другому профилю');
        if (typeof payload.reason !== 'string' || payload.reason.trim().length < 3 || payload.reason.length > 20000)
            fail('IMPORT_REASON', 'Укажите основание импорта');
        const input = { action: source.format === 'inventory-legacy-json' ? 'importLegacy' : 'importRows', sourceId: payload.sourceId, reason: payload.reason, ...(Object.hasOwn(payload, 'sessionIds') ? { sessionIds: payload.sessionIds } : {}) }, now = options.now || new Date().toISOString(), calendar = require('../assets/core/business-calendar.js').resolve(snapshot.data, now), readable = SECTIONS.filter(name => allowed(user, 'read', name)), writable = SECTIONS.filter(name => allowed(user, 'write', name)), core = require('../assets/core/asset-inventory.js');
        const reviewed = core.preview(snapshot.data, input, { today: calendar.today, importSource: source, readable }), context = { id: 'inventory-import-preview', now, today: calendar.today, calendar, actor: { id: user.id, name: user.name || user.id, role: user.role }, readable, writable, importSource: source };
        support.requireRead(user, reviewed.readSections);
        require('./command-service.cjs').assertCommandScope(snapshot.data, { type: 'AssetInventoryAction', input }, reviewed.readSections, user);
        if (reviewed.writeSections.some(name => !allowed(user, 'write', name)))
            fail('ACCESS_DENIED', 'Недостаточно прав для всех изменений импорта', 403);
        let authoritative = reviewed;
        if (reviewed.canApply) {
            const operation = { id: context.id }, command = { type: 'AssetInventoryAction', version: 1, input: { ...input, reviewFingerprint: reviewed.fingerprint } }, intent = { protocolVersion: 1, databaseToken: snapshot.databaseToken, operation, base: Object.fromEntries(reviewed.readSections.map(name => [name, snapshot.revisions[name]])), command };
            try {
                const planned = core.plan(snapshot.data, command.input, context);
                require('./platform-service.cjs').prepareTransaction(snapshot.data, planned.sections, { principal: user, now, commandIntent: intent, importSource: source, operation, base: intent.base, revisions: snapshot.revisions, databaseToken: snapshot.databaseToken, dataDir: dir });
            }
            catch (error) {
                const e = error, items = e.issues?.length ? e.issues.map(value => ({ severity: 'error', code: value.code || e.code || 'IMPORT_POLICY', message: value.message || e.message })) : [{ severity: 'error', code: e.code || 'IMPORT_POLICY', message: e.message }];
                authoritative = { ...reviewed, canApply: false, issues: [...reviewed.issues, ...items] };
            }
        }
        return support.json({ ok: true, preview: authoritative, reviewFingerprint: reviewed.fingerprint, base: Object.fromEntries(reviewed.readSections.map(name => [name, snapshot.revisions[name]])), databaseToken: snapshot.databaseToken, input });
    });
}
async function handle(dir, payloadValue, options, support) { const payload = record(support.json(payloadValue)); if (payload.profile !== PROFILE)
    fail('IMPORT_PROFILE', 'Неверный профиль источника'); if (payload.action === 'stage')
    return stage(dir, payload, options, support); if (payload.action === 'preview')
    return preview(dir, payload, options, support); return fail('IMPORT_ACTION', 'Неизвестное действие с источником инвентаризации'); }
