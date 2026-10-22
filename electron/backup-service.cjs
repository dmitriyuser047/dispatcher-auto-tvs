'use strict';
function validateSources(data,read){require('./import-source.cjs').validateManaged(data,read);require('./attachment-access.cjs').validateManaged(data,read);}

// Backup format 1 remains compatible. No Electron, profile selection or settings
// mutation lives here; callers must explicitly provide every source/target path.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const AdmZip = require('adm-zip');
const schema = require('../assets/core/platform-schema.js');
const contracts = require('../assets/core/platform-contracts.js');
const storage = require('./storage');
const sqlite = require('./sqlite-storage.cjs');
const SECTIONS = schema.sections, MANAGED = ['attachments', 'import-sources', 'reestr-knowledge','document-archive'];
const MAX_BYTES = 512 * 1024 * 1024, MAX_FILES = 10000;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fold = value => process.platform === 'win32' ? value.toLowerCase() : value;
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function stat(filename) { try {
    return fs.lstatSync(filename);
}
catch (error) {
    if (error.code === 'ENOENT')
        return null;
    throw error;
} }
function safeName(name) { return typeof name === 'string' && !!name && name.length <= 240 && !/[\x00-\x1f\\/:*?"<>|]/.test(name) && !/[. ]$/.test(name) && !['.', '..'].includes(name) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name); }
function packageNameSafe(name) { if (typeof name !== 'string' || name.length > 240)
    return false; if (['database.json', 'settings.json', 'manifest.json'].includes(name))
    return true; const parts = name.split('/'); return parts.length === 2 && MANAGED.includes(parts[0]) && safeName(parts[1]); }
function explicit(value) { if (typeof value !== 'string' || !value.trim() || value.includes('\0') || /^\\\\[?.]\\/.test(value) || /^[a-z]:[^\\/]/i.test(value))
    fail('BACKUP_PATH', 'Нужен явный обычный путь'); return path.resolve(value); }
function directory(value) { const result = explicit(value), root = path.parse(result).root; let current = root; for (const part of result.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const info = stat(current);
    if (!info || !info.isDirectory() || info.isSymbolicLink())
        fail('BACKUP_PATH', 'Каталог отсутствует или проходит через символическую ссылку');
} return fs.realpathSync(result); }
function within(parent, child) { const relative = path.relative(fold(parent), fold(child)); return relative === '' || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); }
function newTarget(value) { const proposed = explicit(value), parent = directory(path.dirname(proposed)), target = path.join(parent, path.basename(proposed)); if (!safeName(path.basename(target)))
    fail('BACKUP_PATH', 'Недопустимое имя целевого файла или каталога'); if (stat(target))
    fail('BACKUP_TARGET_EXISTS', 'Целевой путь уже существует; выберите новый'); return { parent, target }; }
function file(filename) { const parent = directory(path.dirname(filename)), target = path.join(parent, path.basename(filename)), info = stat(target); if (!info || !info.isFile() || info.isSymbolicLink())
    fail('BACKUP_FILE', 'Нужен обычный файл без ссылок'); return { target, info }; }
function readFile(filename) { const { target, info } = file(filename); const bytes = fs.readFileSync(target), after = stat(target); if (!after || after.ino !== info.ino || after.dev !== info.dev || after.size !== bytes.length || after.mtimeMs !== info.mtimeMs)
    fail('BACKUP_SOURCE_CHANGED', 'Файл изменился во время чтения'); return bytes; }
function writeFile(filename, bytes) { const fd = fs.openSync(filename, 'wx', 0o600), identity = fs.fstatSync(fd); let failed = false; try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
}
catch (error) {
    failed = true;
    throw error;
}
finally {
    fs.closeSync(fd);
    if (failed) {
        const current = stat(filename);
        if (current?.isFile() && !current.isSymbolicLink() && current.ino === identity.ino && current.dev === identity.dev)
            fs.unlinkSync(filename);
    }
} }
function json(bytes, label) { try {
    return JSON.parse(bytes.toString('utf8'));
}
catch {
    fail('BACKUP_JSON', 'Не удалось прочитать JSON: ' + label);
} }
function jsonObject(value, label) { if (!plain(value))
    fail('BACKUP_JSON', 'Нужен объект JSON: ' + label); try {
    contracts.validateSections({ appMeta: [value] }, SECTIONS);
}
catch {
    fail('BACKUP_JSON', 'JSON содержит небезопасные или непредставимые значения: ' + label);
} return value; }
function database(value) { if (!plain(value) || !Object.hasOwn(value, 'vehicles') || !Object.hasOwn(value, 'records') || Object.keys(value).some(name => !SECTIONS.includes(name)))
    fail('BACKUP_DATABASE', 'Неполная или неизвестная структура базы'); const result = Object.fromEntries(SECTIONS.map(name => [name, Object.hasOwn(value, name) ? value[name] : []])); try {
    contracts.validateSections(result, SECTIONS);
}
catch {
    fail('BACKUP_DATABASE', 'Недопустимая структура JSON базы');
} return result; }
function revisions(value = {}) { try {
    contracts.validateRevisions(value, SECTIONS);
}
catch {
    fail('BACKUP_REVISIONS', 'Некорректные версии разделов');
} return Object.fromEntries(SECTIONS.map(name => [name, value[name] ?? 0])); }
function snapshotFiles(source,allowOwnedLock=false) {
    for (const name of ['.tvs-database.lock', '.tvs-database.lock.recovery', 'sections/.transaction.json'])
        if (!(name==='.tvs-database.lock'&&allowOwnedLock&&storage.isDatabaseLockHeld(source))&&stat(path.join(source, ...name.split('/'))))
            fail('BACKUP_SOURCE_BUSY', 'База занята или содержит незавершённое сохранение');
    const result = [];
    let total = 0;
    const add = relative => { const bytes = readFile(path.join(source, ...relative.split('/'))); total += bytes.length; if (total > MAX_BYTES)
        fail('BACKUP_LIMIT', 'Исходные файлы превышают предел резервного пакета'); result.push({ name: relative, size: bytes.length, sha256: sha(bytes) }); };
    for (const name of ['data.json', 'data.json.before-split', 'database-identity.json', 'platform.sqlite', 'platform.sqlite-wal']) {
        const info = stat(path.join(source, name));
        if (info && (name !== 'platform.sqlite-wal' || info.size))
            add(name);
    }
    for (const name of ['sections', ...MANAGED]) {
        const info = stat(path.join(source, name));
        if (!info)
            continue;
        if (!info.isDirectory() || info.isSymbolicLink())
            fail('BACKUP_PATH', 'Недопустимый каталог управляемых файлов');
        result.push({ name, type: 'directory' });
        const seen = new Set();
        for (const entry of fs.readdirSync(path.join(source, name)).sort()) {
            if (!safeName(entry) || seen.has(entry.toLowerCase()))
                fail('BACKUP_PATH', 'Недопустимое или неоднозначное имя исходного файла');
            seen.add(entry.toLowerCase());
            if (name === 'sections' && entry !== 'revisions.json' && !SECTIONS.some(section => entry === section + '.json'))
                fail('BACKUP_DATABASE', 'Неизвестный или незавершённый раздел JSON');
            add(name + '/' + entry);
        }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
}
function sourceSnapshot(source, files) {
    const expected = new Map(files.map(entry => [entry.name, entry]));
    const read = relative => { const bytes = readFile(path.join(source, ...relative.split('/'))), entry = expected.get(relative); if (!entry || entry.size !== bytes.length || entry.sha256 !== sha(bytes))
        fail('BACKUP_SOURCE_CHANGED', 'Исходная база изменилась'); return json(bytes, relative); };
    if (expected.has('platform.sqlite')) {
        const result = sqlite.transaction(source, () => ({ data: database(sqlite.readAll(source)), revisions: revisions(sqlite.readRevisions(source)), sourceFormat: 'sqlite' }), { readOnly: true });
        return result;
    }
    if (expected.has('sections')) {
        const rawVersions = read('sections/revisions.json');
        let decoded;try{decoded=require('./storage-format.cjs').decodeRevisions(rawVersions);}catch{fail('BACKUP_REVISIONS','Неполные или неподдерживаемые версии JSON базы');}
        const versions = decoded.revisions;
        if (!plain(versions) || !Object.hasOwn(versions, 'vehicles') || !Object.hasOwn(versions, 'records'))
            fail('BACKUP_REVISIONS', 'Неполные версии JSON базы');
        const data = {};
        for (const name of SECTIONS) {
            if (expected.has('sections/' + name + '.json'))
                data[name] = read('sections/' + name + '.json');
            else {
                if (decoded.schemaVersion===2 || Object.hasOwn(rawVersions, name) || ['vehicles', 'records'].includes(name))
                    fail('BACKUP_DATABASE', 'Отсутствует исходный раздел базы');
                data[name] = [];
            }
        }
        return { data: database(data), revisions: revisions(versions), sourceFormat: 'json' };
    }
    return { data: database(read('data.json')), revisions: revisions(), sourceFormat: 'json' };
}
function references(data, files) {
    const byName = new Map(files.map(entry => [entry.name, entry])), used = new Set();
    const check = (prefix, row) => { if (!plain(row) || typeof row.id !== 'string' || !/^[a-f0-9]{64}\.[a-z0-9]{1,6}$/.test(row.id))
        fail('BACKUP_REFERENCE', 'Некорректная ссылка на управляемый файл'); const name = prefix + '/' + row.id, entry = byName.get(name); if (!entry)
        fail('BACKUP_REFERENCE_MISSING', 'Не найден файл, на который ссылается база'); if (entry.sha256 !== row.id.slice(0, 64) || row.sha256 != null && row.sha256 !== entry.sha256 || row.size != null && row.size !== entry.size)
        fail('BACKUP_REFERENCE_HASH', 'Контрольная сумма или размер связанного файла не совпадает'); used.add(name); };
    const visit = value => { if (Array.isArray(value)) {
        value.forEach(visit);
        return;
    } if (!plain(value))
        return; for (const [key, child] of Object.entries(value)) {
        if (key === 'attachments' && Array.isArray(child))
            child.forEach(row => check('attachments', row));
        if (['sourceArchive', 'lastImportArchive','sourceManifest'].includes(key) && plain(child) && (child.available === true || child.id != null))
            check('import-sources', child);
        if (key === 'sourceArchives' && Array.isArray(child))
            child.forEach(row => { if (plain(row) && (row.available === true || row.id != null))
                check('import-sources', row); });
        visit(child);
    } };
    visit(data);
    return used.size;
}
function report(checked) {
    return { ok: true, format: 'tvs-backup', version: 1, rows: SECTIONS.reduce((total, name) => total + checked.data[name].length, 0), fileCount: checked.files.length,
        sections: SECTIONS.map(name => ({ name, count: checked.data[name].length, sha256: sha(JSON.stringify(checked.data[name])) })), databaseSha256: sha(JSON.stringify(checked.data)), archiveSha256: checked.archiveSha256,
        referencedFileCount: checked.referencedFileCount, sourceFormat: checked.sourceFormat, ...(checked.sourceFingerprint ? { sourceFingerprint: checked.sourceFingerprint } : {}) };
}
function readPackage(archivePath) {
    const archive = readFile(explicit(archivePath));
    if (archive.length > MAX_BYTES)
        fail('BACKUP_LIMIT', 'Резервный пакет превышает 512 МБ');
    let zip;
    try {
        zip = new AdmZip(archive);
    }
    catch {
        fail('BACKUP_ARCHIVE', 'Повреждён ZIP пакет');
    }
    const entries = zip.getEntries(), seen = new Set();
    let total = 0;
    if (entries.length > MAX_FILES)
        fail('BACKUP_LIMIT', 'Слишком много файлов в резервном пакете');
    for (const entry of entries) {
        const mode = (entry.attr >>> 16) & 0o170000;
        if (mode === 0o120000)
            fail('BACKUP_PATH', 'Ссылки в ZIP не допускаются');
        if (entry.isDirectory) {
            if (!MANAGED.some(name => entry.entryName === name + '/'))
                fail('BACKUP_PATH', 'Недопустимый каталог ZIP');
            continue;
        }
        if (!packageNameSafe(entry.entryName) || seen.has(entry.entryName.toLowerCase()))
            fail('BACKUP_PATH', 'Недопустимое имя или дубликат в ZIP');
        seen.add(entry.entryName.toLowerCase());
        if (!Number.isSafeInteger(entry.header.size) || entry.header.size < 0)
            fail('BACKUP_ARCHIVE', 'Некорректный размер файла');
        total += entry.header.size;
        if (total > MAX_BYTES)
            fail('BACKUP_LIMIT', 'Распакованные файлы превышают 512 МБ');
    }
    const manifestEntry = zip.getEntry('manifest.json');
    if (!manifestEntry || manifestEntry.isDirectory || manifestEntry.header.size > 5 * 1024 * 1024)
        fail('BACKUP_MANIFEST', 'Нет корректного манифеста');
    const manifest = jsonObject(json(manifestEntry.getData(), 'manifest.json'), 'manifest.json');
    if (manifest.format !== 'tvs-backup' || manifest.version !== 1 || !Array.isArray(manifest.files) || manifest.files.length >= MAX_FILES)
        fail('BACKUP_MANIFEST', 'Неподдерживаемый манифест резервного пакета');
    const files = [], names = new Set();
    for (const entry of manifest.files) {
        if (!plain(entry) || !packageNameSafe(entry.name) || entry.name === 'manifest.json' || names.has(entry.name.toLowerCase()) || !Number.isSafeInteger(entry.size) || entry.size < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256))
            fail('BACKUP_MANIFEST', 'Некорректные метаданные файла');
        names.add(entry.name.toLowerCase());
        const member = zip.getEntry(entry.name);
        if (!member || member.isDirectory || member.header.size !== entry.size)
            fail('BACKUP_FILE_MISSING', 'Нет файла из манифеста или его размер изменён');
        let bytes;
        try {
            bytes = member.getData();
        }
        catch {
            fail('BACKUP_HASH', 'Не удалось проверить содержимое файла');
        }
        if (bytes.length !== entry.size || sha(bytes) !== entry.sha256)
            fail('BACKUP_HASH', 'Ошибка контрольной суммы файла');
        if (/^(attachments|import-sources)\/[a-f0-9]{64}\.[a-z0-9]{1,6}$/.test(entry.name) && path.posix.basename(entry.name).slice(0, 64) !== entry.sha256)
            fail('BACKUP_HASH', 'Имя управляемого файла не совпадает с SHA256');
        files.push({ ...entry, bytes });
    }
    if (entries.some(entry => !entry.isDirectory && entry.entryName !== 'manifest.json' && !names.has(entry.entryName.toLowerCase())))
        fail('BACKUP_MANIFEST', 'В ZIP есть файлы вне манифеста');
    const primary = files.find(entry => entry.name === 'database.json');
    if (!primary)
        fail('BACKUP_DATABASE', 'В пакете нет базы');
    const data = database(json(primary.bytes, 'database.json')), settings = files.find(entry => entry.name === 'settings.json');
    if (manifest.sourceFormat !== undefined && !['json', 'sqlite'].includes(manifest.sourceFormat))
        fail('BACKUP_MANIFEST', 'Неизвестный исходный формат базы');
    const checked = { files, data, settings: settings ? jsonObject(json(settings.bytes, 'settings.json'), 'settings.json') : null, revisions: revisions(manifest.revisions), sourceFormat: manifest.sourceFormat === 'sqlite' ? 'sqlite' : 'json', sourceFingerprint: typeof manifest.sourceFingerprint === 'string' && /^[a-f0-9]{64}$/.test(manifest.sourceFingerprint) ? manifest.sourceFingerprint : null, archiveSha256: sha(archive) };
    checked.referencedFileCount = references(data, files);
    require('./document-archive.cjs').validateManaged(data,name=>files.find(entry=>entry.name===name)?.bytes);validateSources(data,name=>files.find(entry=>entry.name===name)?.bytes);
    return checked;
}
function verifyPackage({ archivePath }) { return report(readPackage(archivePath)); }
function cleanStage(stage, parent, identity) { if (!stage)
    return; const info = stat(stage); if (!info)
    return; if (fold(path.dirname(stage)) !== fold(parent) || !path.basename(stage).startsWith('.tvs-backup-stage-') || !info.isDirectory() || info.isSymbolicLink() || info.dev !== identity.dev || info.ino !== identity.ino)
    fail('BACKUP_CLEANUP', 'Временный каталог изменился; удаление остановлено'); const scan = dir => { for (const name of fs.readdirSync(dir)) {
    const child = path.join(dir, name), entry = fs.lstatSync(child);
    if (entry.isSymbolicLink() || !within(stage, child))
        fail('BACKUP_CLEANUP', 'Недопустимая ссылка во временном каталоге');
    if (entry.isDirectory())
        scan(child);
} }; scan(stage); fs.rmSync(stage, { recursive: true, force: false }); }
function cleanPackage(filename, parent, identity) { if (!filename)
    return; const info = stat(filename); if (!info)
    return; if (fold(path.dirname(filename)) !== fold(parent) || !path.basename(filename).startsWith('.tvs-backup-package-') || !info.isFile() || info.isSymbolicLink() || info.dev !== identity.dev || info.ino !== identity.ino)
    fail('BACKUP_CLEANUP', 'Временный файл изменился; удаление остановлено'); fs.unlinkSync(filename); }
function createPackage({ sourceDir, archivePath, settings = {}, knowledgeDir,allowOwnedLock=false } = {}) {
    const source = directory(sourceDir), { parent, target } = newTarget(archivePath);
    if (knowledgeDir && fold(explicit(knowledgeDir)) !== fold(path.join(source, 'reestr-knowledge')))
        fail('BACKUP_PATH', 'База знаний должна принадлежать выбранной базе');
    // Publishing a ZIP under a missing primary filename (for example
    // platform.sqlite in a JSON profile) would change the selected storage
    // format on the next read. Only the existing, dedicated backup directory
    // may receive an archive inside the source profile.
    if (within(source, target) && !within(path.join(source, 'backups'), parent))
        fail('BACKUP_PATH', 'Внутри базы пакет можно сохранить только в существующую папку backups. Выберите отдельную папку для резервной копии.');
    jsonObject(settings, 'settings');
    let stage, identity, published = false;
    try {
        const before = snapshotFiles(source,allowOwnedLock), snapshot = sourceSnapshot(source, before), reachable=require('./document-archive.cjs').managedNames(source,snapshot.data),zip = new AdmZip(), files = [];
        let total = 0;
        const add = (name, bytes) => { total += bytes.length; if (total > MAX_BYTES || files.length >= MAX_FILES - 2)
            fail('BACKUP_LIMIT', 'Резервный пакет превышает допустимый размер'); zip.addFile(name, bytes); files.push({ name, size: bytes.length, sha256: sha(bytes) }); };
        add('database.json', Buffer.from(JSON.stringify(snapshot.data)));
        add('settings.json', Buffer.from(JSON.stringify(settings)));
        for (const entry of before) {
            if (entry.type === 'directory' || !MANAGED.includes(entry.name.split('/')[0])||entry.name.startsWith('document-archive/')&&!reachable.has(entry.name.slice('document-archive/'.length)))
                continue;
            const bytes = readFile(path.join(source, ...entry.name.split('/')));
            if (bytes.length !== entry.size || sha(bytes) !== entry.sha256)
                fail('BACKUP_SOURCE_CHANGED', 'Управляемый файл изменился');
            add(entry.name, bytes);
        }
        references(snapshot.data, files);
        require('./document-archive.cjs').validateManaged(snapshot.data,name=>before.some(entry=>entry.name===name)?readFile(path.join(source,...name.split('/'))):null);validateSources(snapshot.data,name=>before.some(entry=>entry.name===name)?readFile(path.join(source,...name.split('/'))):null);
        const sourceFingerprint = sha(JSON.stringify(before));
        zip.addFile('manifest.json', Buffer.from(JSON.stringify({ format: 'tvs-backup', version: 1, createdAt: new Date().toISOString(), files, revisions: snapshot.revisions, sourceFormat: snapshot.sourceFormat, sourceFingerprint })));
        stage = path.join(parent, '.tvs-backup-package-' + crypto.randomUUID() + '.zip');
        writeFile(stage, zip.toBuffer());
        identity = fs.lstatSync(stage);
        const verified = verifyPackage({ archivePath: stage });
        if (JSON.stringify(before) !== JSON.stringify(snapshotFiles(source,allowOwnedLock)))
            fail('BACKUP_SOURCE_CHANGED', 'Источник изменился во время резервирования');
        if (stat(target) || fold(directory(parent)) !== fold(parent))
            fail('BACKUP_TARGET_EXISTS', 'Целевой путь изменился');
        // A checked rename can still replace a file created by another process
        // between the last check and rename. Link publishes complete bytes with
        // an atomic EEXIST guarantee; unsupported filesystems fail explicitly.
        try { fs.linkSync(stage, target); }
        catch (error) {
            if (error.code === 'EEXIST')
                fail('BACKUP_TARGET_EXISTS', 'Целевой файл уже создан другим процессом');
            if (['ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EPERM', 'EXDEV'].includes(error.code))
                fail('BACKUP_FILESYSTEM', 'Этот диск не поддерживает безопасную публикацию ZIP. Выберите локальный диск NTFS.');
            throw error;
        }
        published = true;
        cleanPackage(stage, parent, identity);
        stage = null;
        published = false;
        return { ...verified, path: target };
    }
    catch (error) {
        if (published) {
            const current = stat(target);
            if (!current?.isFile() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino)
                fail('BACKUP_CLEANUP', 'Опубликованный файл изменился; автоматическое удаление остановлено');
            fs.unlinkSync(target);
        }
        if (identity)
            cleanPackage(stage, parent, identity);
        throw error;
    }
}
function restorePackage({ archivePath, targetDir, format, protectedDir } = {}) {
    const archive = explicit(archivePath), checked = readPackage(archive), { parent, target } = newTarget(targetDir);
    if (protectedDir) {
        const protectedPath = directory(protectedDir);
        if (within(protectedPath, target) || within(target, protectedPath))
            fail('BACKUP_PATH', 'Восстановление должно выполняться вне рабочей папки базы');
    }
    if (within(target, archive))
        fail('BACKUP_PATH', 'Целевая папка не может содержать исходный пакет');
    const chosen = format ?? checked.sourceFormat;
    if (!['json', 'sqlite'].includes(chosen))
        fail('BACKUP_FORMAT', 'Неизвестный формат восстановления');
    let stage, identity;
    try {
        stage = fs.mkdtempSync(path.join(parent, '.tvs-backup-stage-'));
        identity = fs.lstatSync(stage);
        if (chosen === 'sqlite')
            sqlite.create(stage, { data: checked.data, revisions: checked.revisions });
        else {
            fs.mkdirSync(path.join(stage, 'sections'));
            for (const name of SECTIONS)
                writeFile(path.join(stage, 'sections', name + '.json'), Buffer.from(JSON.stringify(checked.data[name])));
            writeFile(path.join(stage, 'sections/revisions.json'), Buffer.from(JSON.stringify(storage.encodeRevisions(checked.revisions))));
        }
        for (const entry of checked.files) {
            if (entry.name === 'database.json')
                continue;
            const filename = path.join(stage, ...entry.name.split('/'));
            if (entry.name !== 'settings.json')
                fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
            writeFile(filename, entry.bytes);
            if (sha(readFile(filename)) !== entry.sha256)
                fail('BACKUP_HASH', 'Восстановленный файл не совпал с пакетом');
        }
        const actual = storage.readSnapshot(stage);
        for (const name of SECTIONS)
            if (JSON.stringify(actual.data[name]) !== JSON.stringify(checked.data[name]) || actual.revisions[name] !== checked.revisions[name])
                fail('BACKUP_PARITY', 'Восстановленные данные или версии не совпали');
        if (chosen === 'sqlite') {
            const inspected = sqlite.inspect(stage);
            if (!inspected.ok || inspected.integrity.length !== 1 || inspected.integrity[0] !== 'ok' || inspected.foreignKeyErrors.length)
                fail('BACKUP_INTEGRITY', 'Проверка целостности восстановленной SQLite не пройдена');
            const wal = stat(path.join(stage, 'platform.sqlite-wal'));
            if (wal?.size)
                fail('BACKUP_INTEGRITY', 'Не завершён журнал восстановленной SQLite');
            for (const suffix of ['-wal', '-shm'])
                if (stat(path.join(stage, 'platform.sqlite' + suffix)))
                    fs.unlinkSync(file(path.join(stage, 'platform.sqlite' + suffix)).target);
        }
        if (sha(readFile(archive)) !== checked.archiveSha256)
            fail('BACKUP_SOURCE_CHANGED', 'Резервный пакет изменился во время восстановления');
        if (stat(target) || fold(directory(parent)) !== fold(parent))
            fail('BACKUP_TARGET_EXISTS', 'Целевой путь изменился');
        const result = { ...report(checked), path: target, restoredFormat: chosen };
        fs.renameSync(stage, target);
        stage = null;
        return result;
    }
    catch (error) {
        cleanStage(stage, parent, identity);
        throw error;
    }
}
module.exports = Object.freeze({ packageNameSafe, createPackage, verifyPackage, restorePackage });
