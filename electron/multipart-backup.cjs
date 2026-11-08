'use strict';
// A checkpoint publishes its small index LAST. History objects are verified and
// packed one bounded part at a time; total history size is never a save budget.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite'), Zip = require('adm-zip'), safe = require('./safe-file.cjs');
const format = require('./storage-format.cjs'), schema = require('../assets/core/platform-schema.js');
const PART_BYTES = 32 * 1024 * 1024, CHUNK_BYTES = 4 * 1024 * 1024, OBJECT_BYTES = 8 * 1024 * 1024, INDEX_BYTES = 8 * 1024 * 1024, DATA_BYTES = 512 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/, PART = /^part-[0-9]{8}-[a-f0-9]{64}\.zip$/, OBJECT = /^objects\/([a-f0-9]{64})\.json$/, CHUNK = /^chunks\/[0-9]{8}\/[0-9]{8}\.bin$/;
const sha = b => crypto.createHash('sha256').update(b).digest('hex'), plain = v => v !== null && typeof v === 'object' && !Array.isArray(v), same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const support = () => require('./backup-service.cjs').multipartSupport;
function fail(code, message) { throw Object.assign(Error(message), { code }); }
function integer(v) { return Number.isSafeInteger(v) && v >= 0; }
function read(file, max = DATA_BYTES) { return safe.readRegularFileSync(file, { maxBytes: max }); }
function write(file, bytes) { const fd = fs.openSync(file, 'wx', 0o600); try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
}
finally {
    fs.closeSync(fd);
} }
function atomic(file, bytes) { const parent = safe.verifiedDirectory(path.dirname(file)), temporary = path.join(parent.path, '.backup-' + crypto.randomUUID() + '.tmp'); write(temporary, bytes); safe.assertDirectory(parent); fs.renameSync(temporary, file); }
function temporary(parent, prefix) { const pin = safe.verifiedDirectory(parent), directory = fs.mkdtempSync(path.join(pin.path, prefix)), identity = fs.lstatSync(directory); return { directory, parent: pin.path, identity }; }
function clean(work) { if (!work || !fs.existsSync(work.directory))
    return; const s = fs.lstatSync(work.directory); if (path.dirname(work.directory) !== work.parent || !path.basename(work.directory).startsWith('.tvs-backup-') || s.isSymbolicLink() || s.dev !== work.identity.dev || s.ino !== work.identity.ino)
    fail('BACKUP_CLEANUP', 'Изменён временный каталог резервирования'); safe.verifiedDirectory(work.directory); for (const name of fs.readdirSync(work.directory)) {
    const p = path.join(work.directory, name), i = fs.lstatSync(p);
    if (!i.isFile() || i.isSymbolicLink() || i.nlink !== 1)
        fail('BACKUP_CLEANUP', 'Небезопасный временный файл');
} fs.rmSync(work.directory, { recursive: true }); }
function identity(source) { return fs.existsSync(path.join(source, 'platform.sqlite')) ? require('./sqlite-storage.cjs').readIdentity(source) : require('./database-identity.cjs').readOrCreate(source, { create: false }); }
function retainParts(parent, parts, indexName) { const root = safe.verifiedDirectory(parent), pin = safe.verifiedDirectory(parts); if (path.dirname(pin.path) !== root.path || path.basename(pin.path) !== indexName + '.parts')
    fail('BACKUP_PATH', 'Папка частей находится вне резервного каталога'); const owner = JSON.parse(read(path.join(pin.path, 'owner.json'), 4096)); if (owner.format !== 'tvs-backup-parts' || owner.version !== 1 || owner.index !== indexName || !HASH.test(owner.checkpointSha256))
    fail('BACKUP_TARGET_EXISTS', 'Существующая папка частей не принадлежит этой копии'); for (const n of fs.readdirSync(pin.path)) {
    if (n !== 'owner.json' && !PART.test(n))
        fail('BACKUP_TARGET_EXISTS', 'В папке частей есть неизвестные файлы');
    const s = fs.lstatSync(path.join(pin.path, n));
    if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1)
        fail('BACKUP_PATH', 'Недопустимый файл резервной части');
} const retained = path.join(root.path, '.tvs-backup-retained-parts-' + crypto.randomUUID()); safe.assertDirectory(root); safe.assertDirectory(pin); fs.renameSync(pin.path, retained); return retained; }
function describeFiles(source) { const result = []; for (const folder of support().MANAGED) {
    const full = path.join(source, folder);
    if (!fs.existsSync(full))
        continue;
    safe.verifiedDirectory(full);
    for (const name of fs.readdirSync(full).sort()) {
        if (!support().safeName(name))
            fail('BACKUP_PATH', 'Недопустимое имя исходного файла');
        const file = path.join(full, name), s = fs.lstatSync(file);
        if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1)
            fail('BACKUP_PATH', 'Недопустимый исходный файл');
        result.push({ name: folder + '/' + name, dev: s.dev, ino: s.ino, size: s.size, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs });
    }
} return result; }
function assertSourceFile(source, item) { const file = path.join(source, ...item.name.split('/')), s = fs.lstatSync(file); safe.verifiedDirectory(path.dirname(file)); if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].some(k => s[k] !== item[k]))
    fail('BACKUP_SOURCE_CHANGED', 'Исходный документ изменился после фиксации резервной точки'); return file; }
function capture(sourceDir, capturePath, { settings = {} } = {}) {
    const storage = require('./storage'), source = fs.realpathSync.native(sourceDir), pin = safe.verifiedDirectory(source);
    if (!storage.isDatabaseLockHeld(source))
        fail('BACKUP_LOCK_REQUIRED', 'Резервная точка требует краткой блокировки базы');
    const descriptor = storage.descriptor(source);
    if (!format.isCurrent(descriptor.schemaVersion))
        fail('BACKUP_FORMAT', 'Для фоновой копии нужен текущий формат базы');
    const revisions = storage.readRevisions(source), sql = require('./sqlite-storage.cjs'), data = Object.fromEntries(schema.sections.map(n => [n, []]));
    if (sql.exists(source)) {
        for (const row of sql.readRawSections(source, schema.sections).rows)
            data[row.section].push(JSON.parse(row.row_json));
    }
    else
        for (const name of schema.sections)
            data[name] = JSON.parse(read(storage.sectionFile(source, name)).toString('utf8'));
    require('../assets/core/platform-contracts.js').validateSections(data, schema.sections);
    const operationState = require('./operation-store.cjs').readState(source), files = describeFiles(source);
    const checkpoint = { version: 1, kind: 'multipart-checkpoint', source: { path: source, dev: pin.dev, ino: pin.ino, identity: identity(source) }, descriptor, revisions, operationState, data, settings, files, at: new Date().toISOString() };
    const bytes = Buffer.from(JSON.stringify(checkpoint));
    write(capturePath, bytes);
    safe.assertDirectory(pin);
    return { sha256: sha(bytes), bytes: bytes.length, checkpoint };
}
function captured(capturePath, sourceDir) { const bytes = read(capturePath), v = JSON.parse(bytes); if (!plain(v) || v.kind !== 'multipart-checkpoint' || v.version !== 1 || !plain(v.source) || v.source.path !== fs.realpathSync.native(sourceDir))
    fail('BACKUP_CHECKPOINT', 'Не подтверждена резервная точка'); const pin = safe.verifiedDirectory(v.source.path); if (pin.dev !== v.source.dev || pin.ino !== v.source.ino || !same(identity(pin.path), v.source.identity))
    fail('BACKUP_SOURCE_CHANGED', 'База резервной точки заменена'); format.validateDescriptor(v.descriptor); format.validateOperationState(v.operationState); support().database(v.data); support().revisions(v.revisions); return { value: v, pin, digest: sha(bytes) }; }
function createFromCapture({ sourceDir, capturePath, archivePath, partBytes = PART_BYTES } = {}) {
    if (!integer(partBytes) || partBytes < OBJECT_BYTES || partBytes > PART_BYTES)
        fail('BACKUP_LIMIT', 'Некорректный размер части резервной копии');
    const { value: checkpoint, pin, digest } = captured(capturePath, sourceDir), parent = safe.verifiedDirectory(path.dirname(archivePath)), target = path.join(parent.path, path.basename(archivePath));
    if (!support().safeName(path.basename(target)) || fs.existsSync(target))
        fail('BACKUP_TARGET_EXISTS', 'Резервный пакет уже существует');
    const partsName = path.basename(target) + '.parts', partsTarget = path.join(parent.path, partsName);
    if (fs.existsSync(partsTarget))
        retainParts(parent.path, partsTarget, path.basename(target));
    const stage = fs.mkdtempSync(path.join(parent.path, '.tvs-backup-parts-')), stagePin = fs.lstatSync(stage), indexWork = temporary(fs.realpathSync.native(os.tmpdir()), '.tvs-backup-index-');
    let catalog, partsPublished = false;
    try {
        catalog = new DatabaseSync(path.join(indexWork.directory, 'index.sqlite'));
        catalog.exec('CREATE TABLE seen(id TEXT PRIMARY KEY) WITHOUT ROWID;');
        const seen = catalog.prepare('INSERT OR IGNORE INTO seen VALUES(?)');
        const manifest = { format: 'tvs-backup', version: 4, createdAt: checkpoint.at, database: { descriptor: checkpoint.descriptor, identity: checkpoint.source.identity }, revisions: checkpoint.revisions, sourceFormat: fs.existsSync(path.join(pin.path, 'platform.sqlite')) ? 'sqlite' : 'json', checkpointSha256: digest, partsDirectory: partsName, parts: [], files: [], historyObjects: 0 };
        let zip = new Zip(), rawBytes = 0, entryCount = 0;
        const flush = () => { if (!entryCount)
            return; const bytes = zip.toBuffer(), hash = sha(bytes), name = 'part-' + String(manifest.parts.length).padStart(8, '0') + '-' + hash + '.zip'; write(path.join(stage, name), bytes); manifest.parts.push({ name, sha256: hash, size: bytes.length, rawBytes, entries: entryCount }); zip = new Zip(); rawBytes = 0; entryCount = 0; };
        const add = (name, bytes) => { if (bytes.length > OBJECT_BYTES)
            fail('BACKUP_LIMIT', 'Фрагмент превышает допустимый размер'); if (entryCount && (rawBytes + bytes.length > partBytes || entryCount >= 1000))
            flush(); const part = manifest.parts.length; zip.addFile(name, bytes); rawBytes += bytes.length; entryCount++; return { part, entry: name, size: bytes.length }; };
        const addBuffer = (name, bytes) => { const file = { name, size: bytes.length, sha256: sha(bytes), chunks: [] }, id = manifest.files.length; for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES)
            file.chunks.push(add('chunks/' + String(id).padStart(8, '0') + '/' + String(file.chunks.length).padStart(8, '0') + '.bin', bytes.subarray(offset, offset + CHUNK_BYTES))); manifest.files.push(file); };
        addBuffer('database.json', Buffer.from(JSON.stringify(checkpoint.data)));
        addBuffer('settings.json', Buffer.from(JSON.stringify(checkpoint.settings)));
        addBuffer('operation-state.json', Buffer.from(JSON.stringify({ format: 'tvs-operation-state', version: 1, operationState: checkpoint.operationState })));
        for (const item of checkpoint.files) {
            const file = assertSourceFile(pin.path, item), id = manifest.files.length, metadata = { name: item.name, size: item.size, sha256: '', chunks: [] }, hash = crypto.createHash('sha256'), fd = fs.openSync(file, 'r');
            let offset = 0;
            try {
                while (offset < item.size) {
                    const b = Buffer.allocUnsafe(Math.min(CHUNK_BYTES, item.size - offset)), size = fs.readSync(fd, b, 0, b.length, null);
                    if (size !== b.length)
                        fail('BACKUP_SOURCE_CHANGED', 'Изменён исходный документ');
                    offset += size;
                    hash.update(b);
                    metadata.chunks.push(add('chunks/' + String(id).padStart(8, '0') + '/' + String(metadata.chunks.length).padStart(8, '0') + '.bin', b));
                }
            }
            finally {
                fs.closeSync(fd);
            }
            assertSourceFile(pin.path, item);
            metadata.sha256 = hash.digest('hex');
            manifest.files.push(metadata);
        }
        const walk = () => require('./operation-store.cjs').walkClosure(pin.path, object => { if (seen.run(object.id).changes) {
            manifest.historyObjects++;
            add('objects/' + object.id + '.json', Buffer.from(object.json));
        } }, { operationState: checkpoint.operationState });
        // The captured head addresses immutable objects. Each provider read is short;
        // a transaction around compression would hold DELETE/PERSIST readers open
        // and delay another process committing a business save.
        walk();
        flush();
        safe.assertDirectory(pin);
        const owner = { format: 'tvs-backup-parts', version: 1, index: path.basename(target), checkpointSha256: digest };
        write(path.join(stage, 'owner.json'), Buffer.from(JSON.stringify(owner)));
        const index = new Zip(), manifestBytes = Buffer.from(JSON.stringify(manifest));
        if (manifestBytes.length > INDEX_BYTES)
            fail('BACKUP_INDEX_LIMIT', 'Индекс резервной копии требует отдельного тома');
        index.addFile('manifest.json', manifestBytes);
        const indexBytes = index.toBuffer();
        // The temporary index has the final basename, so all relative part references
        // are verified in the same directory before the public index can exist.
        safe.assertDirectory(parent);
        fs.renameSync(stage, partsTarget);
        partsPublished = true;
        const stagedIndex = path.join(parent.path, '.tvs-backup-check-' + crypto.randomUUID() + '.zip');
        write(stagedIndex, indexBytes);
        try {
            const reader = openPackage(stagedIndex, { partsDirectory: partsTarget, expectedIndexName: path.basename(target) });
            try {
                reader.verify();
                reader.assertCurrent();
            }
            finally {
                reader.close();
            }
            safe.assertDirectory(parent);
            if (fs.existsSync(target))
                fail('BACKUP_TARGET_EXISTS', 'Целевой файл появился во время резервирования');
            fs.linkSync(stagedIndex, target);
        }
        finally {
            fs.unlinkSync(stagedIndex);
        }
        return { ok: true, version: 4, path: target, partsDirectory: partsTarget, parts: manifest.parts.length, historyObjects: manifest.historyObjects, archiveSha256: sha(indexBytes), rows: schema.sections.reduce((n, k) => n + checkpoint.data[k].length, 0), sourceDescriptor: checkpoint.descriptor, sourceIdentity: checkpoint.source.identity };
    }
    catch (error) {
        if (partsPublished && !fs.existsSync(target) && fs.existsSync(partsTarget))
            retainParts(parent.path, partsTarget, path.basename(target));
        if (!partsPublished && fs.existsSync(stage)) {
            const s = fs.lstatSync(stage);
            if (s.isSymbolicLink() || s.dev !== stagePin.dev || s.ino !== stagePin.ino)
                fail('BACKUP_CLEANUP', 'Изменена временная папка частей');
            for (const name of fs.readdirSync(stage)) {
                if (!PART.test(name) && name !== 'owner.json')
                    fail('BACKUP_CLEANUP', 'Неизвестный файл части');
                const file = path.join(stage, name), i = fs.lstatSync(file);
                if (!i.isFile() || i.isSymbolicLink() || i.nlink !== 1)
                    fail('BACKUP_CLEANUP', 'Небезопасный файл части');
                fs.unlinkSync(file);
            }
            fs.rmdirSync(stage);
        }
        throw error;
    }
    finally {
        catalog?.close();
        clean(indexWork);
    }
}
function indexManifest(bytes) { const bounded = require('../ReestrBuilder/archive-budget.mjs'), budget = bounded.createArchiveBudget({ inputBytes: INDEX_BYTES + 1024 * 1024, entries: 2, entryBytes: INDEX_BYTES + 1024 * 1024, extractedBytes: INDEX_BYTES, depth: 0 }); budget.input(bytes.length); const entries = bounded.extractZipBounded(bytes, os.tmpdir(), budget, { collectBytes: true }); if (entries.length !== 1 || entries[0].name !== 'manifest.json' || entries[0].directory)
    fail('BACKUP_MANIFEST', 'Некорректный индекс резервной копии'); return JSON.parse(entries[0].bytes.toString('utf8')); }
function probe(archivePath) { try {
    const s = fs.lstatSync(archivePath);
    if (!s.isFile() || s.isSymbolicLink() || s.size > INDEX_BYTES + 1024 * 1024)
        return false;
    return indexManifest(read(archivePath, INDEX_BYTES + 1024 * 1024)).version === 4;
}
catch {
    return false;
} }
function openPackage(archivePath, internal = {}) {
    const indexPin = safe.verifiedDirectory(path.dirname(archivePath)), indexFile = path.join(indexPin.path, path.basename(archivePath)), indexBytes = read(indexFile, INDEX_BYTES + 1024 * 1024), indexHash = sha(indexBytes), m = indexManifest(indexBytes);
    if (!plain(m) || m.format !== 'tvs-backup' || m.version !== 4 || !Array.isArray(m.parts) || !Array.isArray(m.files) || m.files.length > 10000 || !integer(m.historyObjects) || !HASH.test(m.checkpointSha256) || m.partsDirectory !== (internal.expectedIndexName || path.basename(indexFile)) + '.parts')
        fail('BACKUP_MANIFEST', 'Не подтверждены части резервной копии');
    let partsRoot;
    try { partsRoot = safe.verifiedDirectory(internal.partsDirectory || path.join(indexPin.path, m.partsDirectory)); }
    catch (error) { if (error.code === 'ENOENT') fail('BACKUP_PART_MISSING', 'Рядом с ZIP отсутствует папка его частей. Перенесите ZIP и папку .parts вместе.'); throw error; }
    const owner = JSON.parse(read(path.join(partsRoot.path, 'owner.json'), 4096));
    if (owner.format !== 'tvs-backup-parts' || owner.version !== 1 || owner.index !== (internal.expectedIndexName || path.basename(indexFile)) || owner.checkpointSha256 !== m.checkpointSha256)
        fail('BACKUP_MANIFEST', 'Папка частей принадлежит другой копии');
    if (!['json', 'sqlite'].includes(m.sourceFormat) || !plain(m.revisions) || Object.keys(m.revisions).length !== schema.sections.length || schema.sections.some(n => !Object.hasOwn(m.revisions, n)))
        fail('BACKUP_MANIFEST', 'Неполные версии разделов резервной копии');
    const descriptor = format.validateDescriptor(m.database?.descriptor), sourceIdentity = require('./database-identity.cjs').validate(m.database?.identity), revisions = support().revisions(m.revisions), partNames = new Set();
    for (const p of m.parts) {
        if (!plain(p) || !PART.test(p.name) || !HASH.test(p.sha256) || !p.name.endsWith('-' + p.sha256 + '.zip') || !integer(p.size) || p.size > PART_BYTES * 2 + 1024 * 1024 || !integer(p.rawBytes) || p.rawBytes > PART_BYTES || !integer(p.entries) || p.entries > 1000 || partNames.has(p.name))
            fail('BACKUP_MANIFEST', 'Некорректная часть резервной копии');
        partNames.add(p.name);
    }
    const actualNames = fs.readdirSync(partsRoot.path);
    if (actualNames.length !== partNames.size + 1 || actualNames.some(n => n !== 'owner.json' && !partNames.has(n)))
        fail('BACKUP_MANIFEST', 'Папка содержит лишние или отсутствующие части');
    const work = temporary(fs.realpathSync.native(os.tmpdir()), '.tvs-backup-reader-'), catalog = new DatabaseSync(path.join(work.directory, 'index.sqlite'));
    let closed = false;
    catalog.exec('CREATE TABLE objects(id TEXT PRIMARY KEY,part INTEGER,entry TEXT,seen INTEGER NOT NULL DEFAULT 0) WITHOUT ROWID;');
    const put = catalog.prepare('INSERT INTO objects(id,part,entry) VALUES(?,?,?)'), find = catalog.prepare('SELECT part,entry FROM objects WHERE id=?'), seen = catalog.prepare('UPDATE objects SET seen=1 WHERE id=?');
    const files = new Map(), chunks = new Map();
    let cachedPart = -1, cachedEntries = null;
    function loadPart(index) { if (cachedPart === index)
        return cachedEntries; const p = m.parts[index]; if (!p)
        fail('BACKUP_PART_MISSING', 'Часть не найдена'); safe.assertDirectory(partsRoot); const bytes = read(path.join(partsRoot.path, p.name), PART_BYTES * 2 + 1024 * 1024); if (bytes.length !== p.size || sha(bytes) !== p.sha256)
        fail('BACKUP_HASH', 'Часть резервной копии повреждена'); for (const entry of new Zip(bytes).getEntries())
        if (entry.header.size > OBJECT_BYTES)
            fail('BACKUP_LIMIT', 'Файл части превышает допустимый размер'); const budget = require('../ReestrBuilder/archive-budget.mjs').createArchiveBudget({ inputBytes: PART_BYTES * 2 + 1024 * 1024, entries: 1001, entryBytes: PART_BYTES * 2 + 1024 * 1024, extractedBytes: PART_BYTES, depth: 0 }); budget.input(bytes.length); const decoded = require('../ReestrBuilder/archive-budget.mjs').extractZipBounded(bytes, work.directory, budget, { collectBytes: true }); if (decoded.length !== p.entries || decoded.reduce((n, e) => n + e.size, 0) !== p.rawBytes)
        fail('BACKUP_MANIFEST', 'Состав части не совпал'); cachedEntries = new Map(); for (const e of decoded) {
        if (e.directory || cachedEntries.has(e.name) || !OBJECT.test(e.name) && !CHUNK.test(e.name))
            fail('BACKUP_PATH', 'Недопустимый файл части');
        cachedEntries.set(e.name, e.bytes);
    } cachedPart = index; return cachedEntries; }
    function fileBytes(name, max = DATA_BYTES) { const f = files.get(name); if (!f || f.size > max)
        fail('BACKUP_FILE_MISSING', 'Нет исходного файла или превышен размер: ' + name); const result = Buffer.concat(f.chunks.map(c => { const b = loadPart(c.part).get(c.entry); if (!b || b.length !== c.size)
        fail('BACKUP_HASH', 'Фрагмент файла повреждён'); return b; }), f.size); if (sha(result) !== f.sha256)
        fail('BACKUP_HASH', 'Контрольная сумма файла не совпала'); return result; }
    try {
        for (const [id, f] of m.files.entries()) {
            if (!plain(f) || !support().packageNameSafe(f.name) || f.name === 'manifest.json' || OBJECT.test(f.name) || f.name.startsWith('operation-ledger/') || !integer(f.size) || !HASH.test(f.sha256) || !Array.isArray(f.chunks) || files.has(f.name))
                fail('BACKUP_MANIFEST', 'Некорректный файл резервной копии');
            let size = 0;
            for (const [n, c] of f.chunks.entries()) {
                if (!plain(c) || !integer(c.part) || c.part >= m.parts.length || c.entry !== 'chunks/' + String(id).padStart(8, '0') + '/' + String(n).padStart(8, '0') + '.bin' || !integer(c.size) || c.size > CHUNK_BYTES || chunks.has(c.part + ':' + c.entry))
                    fail('BACKUP_MANIFEST', 'Некорректный фрагмент файла');
                size += c.size;
                chunks.set(c.part + ':' + c.entry, c);
            }
            if (size !== f.size)
                fail('BACKUP_MANIFEST', 'Размер фрагментов не совпал');
            files.set(f.name, f);
        }
        for (let i = 0; i < m.parts.length; i++)
            for (const [name, bytes] of loadPart(i)) {
                const match = OBJECT.exec(name);
                if (match) {
                    if (sha(bytes) !== match[1])
                        fail('BACKUP_HASH', 'Объект истории повреждён');
                    try {
                        put.run(match[1], i, name);
                    }
                    catch {
                        fail('BACKUP_MANIFEST', 'Повторяющийся объект истории');
                    }
                }
                else {
                    const c = chunks.get(i + ':' + name);
                    if (!c || c.size !== bytes.length)
                        fail('BACKUP_MANIFEST', 'Лишний фрагмент файла');
                }
            }
        if (catalog.prepare('SELECT count(*) AS n FROM objects').get().n !== m.historyObjects)
            fail('BACKUP_MANIFEST', 'Количество объектов истории не совпало');
        const rawData = JSON.parse(fileBytes('database.json'));
        if (!plain(rawData) || Object.keys(rawData).length !== schema.sections.length || schema.sections.some(n => !Object.hasOwn(rawData, n)))
            fail('BACKUP_MANIFEST', 'Отсутствует раздел резервной копии');
        const data = support().database(rawData), stateFile = JSON.parse(fileBytes('operation-state.json', OBJECT_BYTES));
        if (stateFile.format !== 'tvs-operation-state' || stateFile.version !== 1)
            fail('BACKUP_OPERATION_STATE', 'Нет состояния истории');
        const operationState = format.validateOperationState(stateFile.operationState);
        const settings = JSON.parse(fileBytes('settings.json'));
        if (!plain(settings))
            fail('BACKUP_MANIFEST', 'Настройки должны быть объектом');
        require('../assets/core/platform-contracts.js').validateSections({ appMeta: [settings] }, schema.sections);
        function readObject(id) { const r = find.get(id); if (!r)
            return null; const bytes = loadPart(r.part).get(r.entry); if (!bytes || sha(bytes) !== id)
            fail('BACKUP_HASH', 'Объект истории изменился'); return bytes; }
        function assertCurrent() { safe.assertDirectory(indexPin); safe.assertDirectory(partsRoot); if (sha(read(indexFile, INDEX_BYTES + 1024 * 1024)) !== indexHash)
            fail('BACKUP_SOURCE_CHANGED', 'Индекс изменился'); for (const p of m.parts)
            if (sha(read(path.join(partsRoot.path, p.name), PART_BYTES * 2 + 1024 * 1024)) !== p.sha256)
                fail('BACKUP_SOURCE_CHANGED', 'Резервная часть изменена'); }
        function verify() { for (const f of files.values()) {
            let size = 0;
            const hash = crypto.createHash('sha256');
            for (const c of f.chunks) {
                const b = loadPart(c.part).get(c.entry);
                if (!b || b.length !== c.size)
                    fail('BACKUP_HASH', 'Фрагмент файла отсутствует или повреждён');
                size += b.length;
                hash.update(b);
            }
            if (size !== f.size || hash.digest('hex') !== f.sha256 || /^(attachments|import-sources)\/[a-f0-9]{64}\.[a-z0-9]{1,6}$/.test(f.name) && f.name.split('/')[1].slice(0, 64) !== f.sha256)
                fail('BACKUP_HASH', 'Контрольная сумма файла не совпала');
        } catalog.exec('UPDATE objects SET seen=0'); const result = require('./operation-store.cjs').verifyProvider({ operationState, readObject, hotRows: data.auditLog }, o => seen.run(o.id)); if (catalog.prepare('SELECT count(*) AS n FROM objects WHERE seen=0').get().n)
            fail('BACKUP_OPERATION_STATE', 'Есть объекты вне подтверждённой истории'); support().references(data, m.files); support().validateSources(data, name => files.has(name) ? fileBytes(name) : null, m.files); require('./document-archive.cjs').validateManaged(data, name => files.has(name) ? fileBytes(name) : null); assertCurrent(); return result; }
        function close() { if (closed)
            return; closed = true; cachedEntries = null; catalog.close(); clean(work); }
        return { manifest: m, data, revisions, operationState, sourceDescriptor: descriptor, sourceIdentity, archiveSha256: indexHash, files: [...files.values()], readObject, readFile: fileBytes, verify, assertCurrent, close, copyFiles(target) { for (const f of files.values()) {
                if (['database.json', 'operation-state.json'].includes(f.name))
                    continue;
                const output = path.join(target, ...f.name.split('/'));
                fs.mkdirSync(path.dirname(output), { recursive: true });
                const fd = fs.openSync(output, 'wx', 0o600), hash = crypto.createHash('sha256');
                let size = 0;
                try {
                    for (const c of f.chunks) {
                        const bytes = loadPart(c.part).get(c.entry);
                        if (!bytes || bytes.length !== c.size)
                            fail('BACKUP_HASH', 'Фрагмент изменён');
                        fs.writeSync(fd, bytes);
                        hash.update(bytes);
                        size += bytes.length;
                    }
                    fs.fsyncSync(fd);
                }
                finally {
                    fs.closeSync(fd);
                }
                if (size !== f.size || hash.digest('hex') !== f.sha256)
                    fail('BACKUP_HASH', 'Восстановленный файл отличается');
            } } };
    }
    catch (error) {
        catalog.close();
        clean(work);
        throw error;
    }
}
function report(reader) { return { ok: true, format: 'tvs-backup', version: 4, rows: schema.sections.reduce((n, k) => n + reader.data[k].length, 0), fileCount: reader.files.length, parts: reader.manifest.parts.length, historyObjects: reader.manifest.historyObjects, archiveSha256: reader.archiveSha256, sourceFormat: reader.manifest.sourceFormat, sourceDescriptor: reader.sourceDescriptor, sourceIdentity: reader.sourceIdentity, sections: schema.sections.map(name => ({ name, count: reader.data[name].length, sha256: sha(JSON.stringify(reader.data[name])) })), databaseSha256: sha(JSON.stringify(reader.data)), referencedFileCount: reader.files.length }; }
function verifyPackage({ archivePath }) { const r = openPackage(archivePath); try {
    r.verify();
    return report(r);
}
finally {
    r.close();
} }
function createPackage({ sourceDir, archivePath, settings = {}, partBytes } = {}) { const parent = safe.verifiedDirectory(path.dirname(archivePath)), work = temporary(parent.path, '.tvs-backup-capture-'); try {
    const storage = require('./storage');
    storage.withDatabaseLock(sourceDir, physical => { const action = () => capture(physical, path.join(work.directory, 'checkpoint.json'), { settings }); const sql = require('./sqlite-storage.cjs'); return sql.exists(physical) ? sql.transaction(physical, action, { readOnly: true }) : action(); });
    return createFromCapture({ sourceDir, capturePath: path.join(work.directory, 'checkpoint.json'), archivePath, ...(partBytes ? { partBytes } : {}) });
}
finally {
    clean(work);
} }
function build(reader, stage, chosen, metadata = {}) { const data = reader.data, input = { data, revisions: reader.revisions, operationState: reader.operationState, operationProvider: { readObject: reader.readObject }, ...(metadata.identity ? { identity: metadata.identity } : {}), ...(metadata.descriptor ? { descriptor: metadata.descriptor } : {}) }; format.assertInventoryBackend(data, chosen); const child = path.join(stage, 'multipart-database'); if (chosen === 'sqlite')
    require('./sqlite-storage.cjs').create(child, input);
else
    require('./storage').createJson(child, input); for (const suffix of ['-wal', '-shm']) {
    const p = path.join(child, 'platform.sqlite' + suffix);
    if (fs.existsSync(p)) {
        const s = fs.lstatSync(p);
        if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || suffix === '-wal' && s.size)
            fail('BACKUP_INTEGRITY', 'Не завершён журнал новой SQLite');
        fs.unlinkSync(p);
    }
} for (const n of fs.readdirSync(child))
    fs.renameSync(path.join(child, n), path.join(stage, n)); fs.rmdirSync(child); reader.copyFiles(stage); }
function verifyTarget(reader, stage) { const snapshot = require('./storage').readSnapshot(stage); for (const name of schema.sections)
    if (!same(snapshot.data[name], reader.data[name]) || snapshot.revisions[name] !== reader.revisions[name])
        fail('BACKUP_PARITY', 'Восстановленная база отличается от резервной точки'); const state = require('./operation-store.cjs').readState(stage); if (!same(state, reader.operationState))
    fail('BACKUP_OPERATION_STATE', 'Восстановленная история отличается'); require('./operation-store.cjs').walkClosure(stage, () => { }); reader.assertCurrent(); }
function restorePackage({ archivePath, targetDir, format: chosen, protectedDir } = {}, options = {}, journal) {
    chosen = chosen ?? options.lifecyclePlan?.target?.format ?? 'sqlite';
    if (!['sqlite', 'json'].includes(chosen))
        fail('BACKUP_FORMAT', 'Неизвестный формат восстановления');
    const parent = safe.verifiedDirectory(path.dirname(targetDir)), target = path.join(parent.path, path.basename(targetDir)), archive = path.resolve(archivePath), contains = (a, b) => { const r = path.relative(a, b); return r === '' || r !== '..' && !r.startsWith('..' + path.sep) && !path.isAbsolute(r); };
    let reader, work;
    const close = () => { reader?.close(); reader = null; };
    // A published migration replays its frozen report before consulting the
    // source or a newer head. Open/verify parts only if the journal still needs
    // source data for an unpublished creation or continuation.
    const load = () => {
        if (reader)
            return reader;
        const candidate = openPackage(archivePath);
        try {
            candidate.verify();
            format.assertInventoryBackend(candidate.data, chosen);
            const plan = options.lifecyclePlan;
            if (plan && (plan.source.fingerprint !== 'sha256:' + candidate.archiveSha256 || !same(plan.source.identity, candidate.sourceIdentity) || !same(plan.source.descriptor, candidate.sourceDescriptor)))
                fail('BACKUP_LIFECYCLE', 'Резервный пакет не совпадает с подтверждённым планом');
            reader = candidate;
            return reader;
        }
        catch (error) {
            candidate.close();
            throw error;
        }
    };
    try {
        const partsSource = archive + '.parts';
        if (!support().safeName(path.basename(target)) || contains(target, archive) || contains(partsSource, target) || contains(target, partsSource) || protectedDir && (contains(fs.realpathSync.native(protectedDir), target) || contains(target, fs.realpathSync.native(protectedDir))))
            fail('BACKUP_PATH', 'Восстановление требует отдельной новой папки вне индекса и частей резервной копии');
        if (options.lifecyclePlan) {
            const plan = options.lifecyclePlan;
            if (typeof options.assertLifecycleCurrent !== 'function' || !['clone', 'restoreContinuation'].includes(plan.action) || plan.source?.format !== 'backup')
                fail('BACKUP_LIFECYCLE', 'Нужен подтверждённый план восстановления');
            const verifyIdentity = (location, metadata) => { const inspected = require('./database-lifecycle.cjs').inspectMetadata(location); if (inspected.state !== 'known' || !same(inspected.identity, metadata.identity) || !same(inspected.descriptor, metadata.descriptor))
                fail('BACKUP_IDENTITY', 'Не совпадает идентичность восстановленной базы'); };
            const result = (journal || require('./migration-journal.cjs').runCopy)({ sourceDir: archive, targetDir: target, sourceFingerprint: plan.source.fingerprint, targetFormat: chosen, kind: 'backup-restore', descriptor: format.describe(format.SCHEMA_VERSION), sourceIdentity: plan.source.identity, reportName: 'backup-restore-report.json', verifySource: () => load().assertCurrent(), create(stage, metadata) { const value = load(); if (value.files.some(f => f.name === 'migration-history/' + metadata.migrationId + '.json'))
                    fail('BACKUP_HISTORY_COLLISION', 'Коллизия истории восстановления'); build(value, stage, chosen, metadata); }, verify(stage, metadata) { verifyTarget(load(), stage); verifyIdentity(stage, metadata); }, verifyPublishedIdentity: verifyIdentity, report(stage, metadata) { return { ...report(load()), path: target, restoredFormat: chosen, restoredDescriptor: metadata.descriptor, targetIdentity: metadata.identity, migrationId: metadata.migrationId, startedAt: metadata.startedAt, retainedStages: metadata.retainedStages }; } }, options);
            if (result && typeof result.then === 'function')
                return result.finally(close);
            close();
            return result;
        }
        const value = load();
        if (fs.existsSync(target))
            fail('BACKUP_TARGET_EXISTS', 'Целевая папка уже существует');
        work = temporary(parent.path, '.tvs-backup-stage-');
        build(value, work.directory, chosen);
        verifyTarget(value, work.directory);
        safe.assertDirectory(parent);
        if (fs.existsSync(target))
            fail('BACKUP_TARGET_EXISTS', 'Целевая папка появилась');
        const result = { ...report(value), path: target, restoredFormat: chosen, restoredDescriptor: format.describe(format.SCHEMA_VERSION) };
        fs.renameSync(work.directory, target);
        work = null;
        close();
        return result;
    }
    catch (error) {
        close();
        if (work)
            support().cleanStage(work.directory, work.parent, work.identity);
        throw error;
    }
}
module.exports = Object.freeze({ PART_BYTES, capture, createFromCapture, createPackage, openPackage, verifyPackage, probe, report, restorePackage });
