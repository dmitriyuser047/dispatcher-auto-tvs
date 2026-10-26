'use strict';
function validateSources(data,read,files){require('./import-source.cjs').validateManaged(data,read);require('./attachment-access.cjs').validateManaged(data,read);require('./inventory-documents.cjs').validateManaged(files,read);}

// Format 3 preserves the immutable operation closure. Legacy formats 1/2 remain readable. No Electron, profile selection or settings
// mutation lives here; callers must explicitly provide every source/target path.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const AdmZip = require('adm-zip');
const schema = require('../assets/core/platform-schema.js');
const contracts = require('../assets/core/platform-contracts.js');
const storage = require('./storage');
const sqlite = require('./sqlite-storage.cjs');
const SECTIONS = schema.sections, MANAGED = ['attachments', 'import-sources', 'reestr-knowledge','document-archive','migration-history','inventory-documents'];
const MAX_BYTES = 512 * 1024 * 1024, MAX_FILES = 10000;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fold = value => process.platform === 'win32' ? value.toLowerCase() : value;
const operationObjectsName=/^operation-ledger\/objects\/([a-f0-9]{64})\.json$/;
const operations=()=>require('./operation-store.cjs');
function operationSeed(data,transactionId){const seed=operations().bootstrap({auditRows:data.auditLog||[],archiveLegacy:(data.auditLog||[]).length>5000});return transactionId?{...seed,operationState:require('./storage-format.cjs').validateOperationState({...seed.operationState,transactionId})}:seed;}
function operationFiles(seed){return [{name:'operation-state.json',bytes:Buffer.from(JSON.stringify({format:'tvs-operation-state',version:1,operationState:seed.operationState}))},...seed.objects.map(object=>({name:'operation-ledger/objects/'+object.id+'.json',bytes:Buffer.from(object.json)}))];}
function readOperations(files){const entry=files.find(entry=>entry.name==='operation-state.json');if(!entry)fail('BACKUP_OPERATION_STATE','В пакете отсутствует состояние истории операций');const raw=jsonObject(json(entry.bytes,entry.name),entry.name);if(Object.keys(raw).length!==3||raw.format!=='tvs-operation-state'||raw.version!==1)fail('BACKUP_OPERATION_STATE','Неизвестный формат истории операций');try{const operationState=require('./storage-format.cjs').validateOperationState(raw.operationState),objects=files.filter(entry=>operationObjectsName.test(entry.name)).map(entry=>({id:operationObjectsName.exec(entry.name)[1],json:entry.bytes.toString('utf8')}));return operations().fromClosure({version:1,kind:'operation-ledger-closure',head:operationState.head,objects},{operationState});}catch(error){fail('BACKUP_OPERATION_STATE','Не подтверждена полная история операций: '+(error.code||''));}}
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
    return false; if (['database.json', 'settings.json', 'manifest.json','operation-state.json'].includes(name)||operationObjectsName.test(name))
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
function readFile(filename) { return require('./safe-file.cjs').readRegularFileSync(explicit(filename),{maxBytes:MAX_BYTES}); }
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
function sourceRollback(source){try{return require('./sqlite-rollback.cjs').assertQuiescent(path.join(source,'platform.sqlite'));}catch{fail('BACKUP_SOURCE_BUSY','В SQLite есть неподтверждённый журнал. Завершите сохранение в прежней программе перед резервированием.');}}
function verifySourceRollback(source,token){try{require('./sqlite-rollback.cjs').assertUnchanged(path.join(source,'platform.sqlite'),token);}catch{fail('BACKUP_SOURCE_BUSY','Журнал исходной SQLite изменился во время резервирования.');}}
function snapshotFiles(source,allowOwnedLock=false) {
    const rollback=sourceRollback(source);
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
    const operationDirectory=stat(path.join(source,'operation-ledger'));
    if(operationDirectory){if(!operationDirectory.isDirectory()||operationDirectory.isSymbolicLink())fail('BACKUP_PATH','Недопустимый каталог истории операций');for(const name of fs.readdirSync(path.join(source,'operation-ledger')))if(name!=='objects')fail('BACKUP_PATH','Неизвестный файл истории операций');const objects=path.join(source,'operation-ledger','objects'),info=stat(objects);if(info){if(!info.isDirectory()||info.isSymbolicLink())fail('BACKUP_PATH','Недопустимый каталог объектов истории');for(const name of fs.readdirSync(objects).sort()){if(!/^[a-f0-9]{64}\.json$/.test(name))fail('BACKUP_PATH','Неизвестное имя объекта истории');add('operation-ledger/objects/'+name);}}}
    verifySourceRollback(source,rollback);return result.sort((a, b) => a.name.localeCompare(b.name));
}
function sourceSnapshot(source, files) {
    const rollback=sourceRollback(source);try{
    const expected = new Map(files.map(entry => [entry.name, entry]));
    const read = relative => { const bytes = readFile(path.join(source, ...relative.split('/'))), entry = expected.get(relative); if (!entry || entry.size !== bytes.length || entry.sha256 !== sha(bytes))
        fail('BACKUP_SOURCE_CHANGED', 'Исходная база изменилась'); return json(bytes, relative); };
    if (expected.has('platform.sqlite')) {
        const result = sqlite.transaction(source, () => {const sourceDescriptor=sqlite.readDescriptor(source);return { data: database(sqlite.readAll(source)), revisions: revisions(sqlite.readRevisions(source)), sourceFormat: 'sqlite', sourceDescriptor, sourceIdentity: sqlite.readIdentity(source),...(sourceDescriptor.schemaVersion>=4?{operationSeed:operations().fromClosure(operations().exportClosure(source),{operationState:operations().readState(source)})}:{})};}, { readOnly: true });
        return result;
    }
    if (expected.has('sections')) {
        const rawVersions = read('sections/revisions.json');
        let decoded;try{decoded=require('./storage-format.cjs').decodeRevisions(rawVersions);}catch{fail('BACKUP_REVISIONS','Неполные или неподдерживаемые версии JSON базы');}
        const versions = decoded.revisions;
        if (!plain(versions) || !Object.hasOwn(versions, 'vehicles') || !Object.hasOwn(versions, 'records'))
            fail('BACKUP_REVISIONS', 'Неполные версии JSON базы');
        const data = {};
        const sourceSections = require('./storage-format.cjs').sectionsFor(decoded.schemaVersion);
        for (const name of SECTIONS) {
            if (expected.has('sections/' + name + '.json')) {
                if(!sourceSections.includes(name))fail('BACKUP_DATABASE','Исходная схема не поддерживает раздел базы');
                data[name] = read('sections/' + name + '.json');
            }
            else {
                if (sourceSections.includes(name)&&(decoded.schemaVersion>=2 || Object.hasOwn(rawVersions, name) || ['vehicles', 'records'].includes(name)))
                    fail('BACKUP_DATABASE', 'Отсутствует исходный раздел базы');
                data[name] = [];
            }
        }
        require('./storage-format.cjs').assertInventoryBackend(data,'json');
        return { data: database(data), revisions: revisions(versions), sourceFormat: 'json', sourceDescriptor: decoded.descriptor, sourceIdentity: require('./database-identity.cjs').readOrCreate(source,{create:false}),...(decoded.schemaVersion>=4?{operationSeed:operations().fromClosure(operations().exportClosure(source),{operationState:decoded.operationState})}:{}) };
    }
    return { data: database(read('data.json')), revisions: revisions(), sourceFormat: 'json', sourceDescriptor: require('./storage-format.cjs').describe(1), sourceIdentity: require('./database-identity.cjs').readOrCreate(source,{create:false}) };
    }finally{verifySourceRollback(source,rollback);}
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
    return { ok: true, format: 'tvs-backup', version: checked.version, sourceDescriptor:checked.sourceDescriptor, sourceIdentity:checked.sourceIdentity, rows: SECTIONS.reduce((total, name) => total + checked.data[name].length, 0), fileCount: checked.files.length,
        sections: SECTIONS.map(name => ({ name, count: checked.data[name].length, sha256: sha(JSON.stringify(checked.data[name])) })), databaseSha256: sha(JSON.stringify(checked.data)), archiveSha256: checked.archiveSha256,
        referencedFileCount: checked.referencedFileCount, sourceFormat: checked.sourceFormat, ...(checked.sourceFingerprint ? { sourceFingerprint: checked.sourceFingerprint } : {}) };
}
function readPackage(archivePath) {
    const archive = readFile(explicit(archivePath));
    if (archive.length > MAX_BYTES)
        fail('BACKUP_LIMIT', 'Резервный пакет превышает 512 МБ');
    let zip;
    try {
        const bounded=require('../ReestrBuilder/archive-budget.mjs');
        const budget=bounded.createArchiveBudget({inputBytes:MAX_BYTES,entries:MAX_FILES+1,entryBytes:MAX_BYTES,extractedBytes:MAX_BYTES,depth:0});
        budget.input(archive.length);
        const decoded=bounded.extractZipBounded(archive,path.join(require('node:os').tmpdir(),'tvs-backup-memory'),budget,{collectBytes:true,includeDirectories:true});
        const entries=decoded.map(entry=>({entryName:entry.name,isDirectory:entry.directory,attr:0,header:{size:entry.size},getData:()=>entry.bytes}));
        zip={getEntries:()=>entries,getEntry:name=>entries.find(entry=>entry.entryName===name)};
    }
    catch (error) {
        fail(error.code==='ARCHIVE_LIMIT'?'BACKUP_LIMIT':error.code==='ARCHIVE_PATH'?'BACKUP_PATH':'BACKUP_ARCHIVE', 'Повреждён ZIP пакет или превышены пределы безопасной распаковки');
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
            if (!MANAGED.some(name => entry.entryName === name + '/')&&!['operation-ledger/','operation-ledger/objects/'].includes(entry.entryName))
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
    if (manifest.format !== 'tvs-backup' || ![1,2,3].includes(manifest.version) || !Array.isArray(manifest.files) || manifest.files.length >= MAX_FILES)
        fail('BACKUP_MANIFEST', 'Неподдерживаемый манифест резервного пакета');
    let sourceDescriptor=null,sourceIdentity=null;
    if(manifest.version>=2){
        if(!plain(manifest.database)||Object.keys(manifest.database).some(name=>!['descriptor','identity'].includes(name))||!Object.hasOwn(manifest.database,'identity'))fail('BACKUP_MANIFEST','Отсутствуют метаданные исходного формата базы');
        try{sourceDescriptor=require('./storage-format.cjs').validateDescriptor(manifest.database.descriptor);sourceIdentity=manifest.database.identity===null?null:require('./database-identity.cjs').validate(manifest.database.identity);}catch{fail('BACKUP_MANIFEST','Повреждён или несовместим формат исходной базы');}
    }else if(Object.hasOwn(manifest,'database'))fail('BACKUP_MANIFEST','Версия резервного пакета не согласована с метаданными базы');
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
    const rawDatabase=json(primary.bytes,'database.json');
    if((sourceDescriptor?.schemaVersion??1)<5&&plain(rawDatabase)&&Object.hasOwn(rawDatabase,'generatorMaintenancePlans'))fail('BACKUP_DATABASE','Исходная схема не поддерживает планы обслуживания ДЭС');
    if((sourceDescriptor?.schemaVersion??1)<6&&plain(rawDatabase)&&require('./storage-format.cjs').INVENTORY_SECTIONS.some(name=>Object.hasOwn(rawDatabase,name)))fail('BACKUP_DATABASE','Исходная схема не поддерживает инвентаризацию');
    if(sourceDescriptor?.schemaVersion===6&&(!plain(rawDatabase)||SECTIONS.some(name=>!Object.hasOwn(rawDatabase,name))))fail('BACKUP_DATABASE','В резервном пакете отсутствует раздел схемы 6');
    const sourceSections=require('./storage-format.cjs').sectionsFor(sourceDescriptor?.schemaVersion??1);
    if((manifest.revisions!==undefined||manifest.version!==1)&&(!plain(manifest.revisions)||Object.keys(manifest.revisions).some(name=>!sourceSections.includes(name))||sourceDescriptor?.schemaVersion===6&&(Object.keys(manifest.revisions).length!==SECTIONS.length||SECTIONS.some(name=>!Object.hasOwn(manifest.revisions,name)))))fail('BACKUP_REVISIONS','Версии разделов не соответствуют исходной схеме резервного пакета');
    const data = database(rawDatabase), settings = files.find(entry => entry.name === 'settings.json');
    if (manifest.sourceFormat !== undefined && !['json', 'sqlite'].includes(manifest.sourceFormat))
        fail('BACKUP_MANIFEST', 'Неизвестный исходный формат базы');
    require('./storage-format.cjs').assertInventoryBackend(data,manifest.sourceFormat);
    const checked = { version:manifest.version,sourceDescriptor,sourceIdentity,files, data, settings: settings ? jsonObject(json(settings.bytes, 'settings.json'), 'settings.json') : null, revisions: revisions(manifest.revisions), sourceFormat: manifest.sourceFormat === 'sqlite' ? 'sqlite' : 'json', sourceFingerprint: typeof manifest.sourceFingerprint === 'string' && /^[a-f0-9]{64}$/.test(manifest.sourceFingerprint) ? manifest.sourceFingerprint : null, archiveSha256: sha(archive) };
    if(sourceDescriptor?.schemaVersion>=4&&manifest.version!==3||manifest.version===3&&!(sourceDescriptor?.schemaVersion>=4)||manifest.version<3&&entries.some(entry=>entry.entryName==='operation-state.json'||entry.entryName.startsWith('operation-ledger/')))fail('BACKUP_OPERATION_STATE','Версия пакета не сохраняет историю операций исходной базы');
    if(manifest.version===3){checked.operationSeed=readOperations(files);if(JSON.stringify(checked.operationSeed.hotRows)!==JSON.stringify(data.auditLog))fail('BACKUP_OPERATION_STATE','Горячая история не соответствует полному журналу операций');}
    checked.referencedFileCount = references(data, files);
    require('./document-archive.cjs').validateManaged(data,name=>files.find(entry=>entry.name===name)?.bytes);validateSources(data,name=>files.find(entry=>entry.name===name)?.bytes,files);
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
    if (within(source, target) && !require('./storage-format.cjs').isCurrent(storage.schemaVersion(source)))
        fail('BACKUP_PATH', 'Для старой базы выберите папку резервной копии вне исходной базы.');
    if (within(source, target) && !within(path.join(source, 'backups'), parent))
        fail('BACKUP_PATH', 'Внутри базы пакет можно сохранить только в существующую папку backups. Выберите отдельную папку для резервной копии.');
    jsonObject(settings, 'settings');
    let stage, identity, published = false;
    try {
        const before = snapshotFiles(source,allowOwnedLock), snapshot = sourceSnapshot(source, before), reachable=require('./document-archive.cjs').managedNames(source,snapshot.data),zip = new AdmZip(), files = [];
        let total = 0;
        const add = (name, bytes) => { total += bytes.length; if (total > MAX_BYTES || files.length >= MAX_FILES - 2)
            fail('BACKUP_LIMIT', 'Резервный пакет превышает допустимый размер'); zip.addFile(name, bytes); files.push({ name, size: bytes.length, sha256: sha(bytes) }); };
        const packageSections=require('./storage-format.cjs').sectionsFor(snapshot.sourceDescriptor.schemaVersion),packageData=Object.fromEntries(packageSections.map(name=>[name,snapshot.data[name]])),packageRevisions=Object.fromEntries(packageSections.map(name=>[name,snapshot.revisions[name]]));
        add('database.json', Buffer.from(JSON.stringify(packageData)));
        add('settings.json', Buffer.from(JSON.stringify(settings)));
        if(snapshot.operationSeed)for(const entry of operationFiles(snapshot.operationSeed))add(entry.name,entry.bytes);
        for (const entry of before) {
            if (entry.type === 'directory' || !MANAGED.includes(entry.name.split('/')[0])||entry.name.startsWith('document-archive/')&&!reachable.has(entry.name.slice('document-archive/'.length)))
                continue;
            const bytes = readFile(path.join(source, ...entry.name.split('/')));
            if (bytes.length !== entry.size || sha(bytes) !== entry.sha256)
                fail('BACKUP_SOURCE_CHANGED', 'Управляемый файл изменился');
            add(entry.name, bytes);
        }
        references(snapshot.data, files);
        require('./document-archive.cjs').validateManaged(snapshot.data,name=>before.some(entry=>entry.name===name)?readFile(path.join(source,...name.split('/'))):null);validateSources(snapshot.data,name=>before.some(entry=>entry.name===name)?readFile(path.join(source,...name.split('/'))):null,before);
        const sourceFingerprint = sha(JSON.stringify(before));
        zip.addFile('manifest.json', Buffer.from(JSON.stringify({ format: 'tvs-backup', version: snapshot.operationSeed?3:2, database:{descriptor:snapshot.sourceDescriptor,identity:snapshot.sourceIdentity}, createdAt: new Date().toISOString(), files, revisions: packageRevisions, sourceFormat: snapshot.sourceFormat, sourceFingerprint })));
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
function restoreLegacyPackage({ archivePath, targetDir, format, protectedDir } = {}) {
    const archive = explicit(archivePath), checked = readPackage(archive), { parent, target } = newTarget(targetDir);
    const seed=checked.operationSeed||operationSeed(checked.data),restoredData={...checked.data,auditLog:seed.hotRows};
    if (protectedDir) {
        const protectedPath = directory(protectedDir);
        if (within(protectedPath, target) || within(target, protectedPath))
            fail('BACKUP_PATH', 'Восстановление должно выполняться вне рабочей папки базы');
    }
    if (within(target, archive))
        fail('BACKUP_PATH', 'Целевая папка не может содержать исходный пакет');
    const chosen = format ?? 'sqlite';
    if (!['json', 'sqlite'].includes(chosen))
        fail('BACKUP_FORMAT', 'Неизвестный формат восстановления');
    require('./storage-format.cjs').assertInventoryBackend(restoredData,chosen);
    let stage, identity;
    try {
        stage = fs.mkdtempSync(path.join(parent, '.tvs-backup-stage-'));
        identity = fs.lstatSync(stage);
        if (chosen === 'sqlite')
            sqlite.create(stage, { data: restoredData, revisions: checked.revisions,operationState:seed.operationState,operationObjects:seed.objects });
        else {
            fs.mkdirSync(path.join(stage, 'sections'));
            for (const name of SECTIONS)
                writeFile(path.join(stage, 'sections', name + '.json'), Buffer.from(JSON.stringify(restoredData[name])));
            writeFile(path.join(stage, 'sections/revisions.json'), Buffer.from(JSON.stringify(storage.encodeRevisions(checked.revisions,require('./storage-format.cjs').describe(require('./storage-format.cjs').SCHEMA_VERSION),seed.operationState))));
            require('./database-identity.cjs').readOrCreate(stage);operations().putObjects(stage,seed.objects);
        }
        for (const entry of checked.files) {
            if (entry.name === 'database.json'||entry.name==='operation-state.json'||operationObjectsName.test(entry.name))
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
            if (JSON.stringify(actual.data[name]) !== JSON.stringify(restoredData[name]) || actual.revisions[name] !== checked.revisions[name])
                fail('BACKUP_PARITY', 'Восстановленные данные или версии не совпали');
        const restored=operations().fromClosure(operations().exportClosure(stage),{operationState:operations().readState(stage)});
        if(JSON.stringify(restored.operationState)!==JSON.stringify(seed.operationState)||JSON.stringify(restored.objects)!==JSON.stringify(seed.objects))
            fail('BACKUP_OPERATION_STATE','Восстановленная история операций отличается от пакета');
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
        const result = { ...report(checked), path: target, restoredFormat: chosen, restoredDescriptor: require('./storage-format.cjs').describe(require('./storage-format.cjs').SCHEMA_VERSION) };
        fs.renameSync(stage, target);
        stage = null;
        return result;
    }
    catch (error) {
        cleanStage(stage, parent, identity);
        throw error;
    }
}
function restoreReviewedPackage({ archivePath, targetDir, format, protectedDir } = {}, options, journal) {
    const plan=options.lifecyclePlan;
    if(!plain(plan)||!['clone','restoreContinuation'].includes(plan.action)||plan.source?.format!=='backup'||typeof options.assertLifecycleCurrent!=='function')
        fail('BACKUP_LIFECYCLE','Нужен подтверждённый план копии или продолжения резервного пакета и проверка его актуальности');
    const requested=explicit(archivePath),archive=path.join(directory(path.dirname(requested)),path.basename(requested)),proposed=explicit(targetDir),parent=directory(path.dirname(proposed)),target=path.join(parent,path.basename(proposed));
    if(!safeName(path.basename(target))||within(target,archive))fail('BACKUP_PATH','Нужна новая отдельная папка вне исходного резервного пакета');
    if(protectedDir){const protectedPath=directory(protectedDir);if(within(protectedPath,target)||within(target,protectedPath))fail('BACKUP_PATH','Восстановление должно выполняться вне рабочей папки базы');}
    const chosen=format??plan.target?.format,descriptor=require('./storage-format.cjs').describe(require('./storage-format.cjs').SCHEMA_VERSION);
    if(!['json','sqlite'].includes(chosen))fail('BACKUP_FORMAT','Неизвестный формат восстановления');
    let checked=null;
    const load=()=>{
        if(!checked){
            const value=readPackage(archive);
            if('sha256:'+value.archiveSha256!==plan.source.fingerprint||JSON.stringify(value.sourceIdentity)!==JSON.stringify(plan.source.identity)||JSON.stringify(value.sourceDescriptor)!==JSON.stringify(plan.source.descriptor))fail('BACKUP_SOURCE_CHANGED','Резервный пакет не совпадает с проверенным планом');
            require('./storage-format.cjs').assertInventoryBackend(value.data,chosen);
            checked=value;
        }
        return checked;
    };
    const verifyIdentity=(location,metadata)=>{
        const inspected=require('./database-lifecycle.cjs').inspectMetadata(location);
        if(inspected.state!=='known'||JSON.stringify(inspected.identity)!==JSON.stringify(metadata.identity)||JSON.stringify(inspected.descriptor)!==JSON.stringify(metadata.descriptor))fail('BACKUP_IDENTITY','Не подтверждена идентичность восстановленной базы');
    };
    return journal({sourceDir:archive,targetDir:target,sourceFingerprint:plan.source.fingerprint,targetFormat:chosen,kind:'backup-restore',descriptor,sourceIdentity:plan.source.identity,reportName:'backup-restore-report.json',
        verifySource(){load();if('sha256:'+sha(readFile(archive))!==plan.source.fingerprint)fail('BACKUP_SOURCE_CHANGED','Резервный пакет изменился после проверки');},
        create(stage,metadata){
            const value=load();
            const seed=value.operationSeed||operationSeed(value.data,metadata.migrationId),restoredData={...value.data,auditLog:seed.hotRows};
            value.restoreSeed=seed;value.restoredData=restoredData;
            if(value.files.some(entry=>entry.name==='migration-history/'+metadata.migrationId+'.json'))fail('BACKUP_HISTORY_COLLISION','Новый идентификатор восстановления совпал с сохранённой историей');
            if(chosen==='sqlite'){
                const child=path.join(stage,'sqlite-data');sqlite.create(child,{data:restoredData,revisions:value.revisions,descriptor:metadata.descriptor,identity:metadata.identity,operationState:seed.operationState,operationObjects:seed.objects});
                for(const suffix of ['-wal','-shm']){const filename=path.join(child,'platform.sqlite'+suffix),state=stat(filename);if(state){if(!state.isFile()||state.isSymbolicLink()||state.nlink!==1||suffix==='-wal'&&state.size)fail('BACKUP_INTEGRITY','Не завершён или небезопасен журнал новой SQLite');fs.unlinkSync(filename);}}
                if(JSON.stringify(fs.readdirSync(child).sort())!==JSON.stringify(['platform.sqlite','sections']))fail('BACKUP_INTEGRITY','Неожиданные файлы в новой SQLite');
                for(const name of ['platform.sqlite','sections'])fs.renameSync(path.join(child,name),path.join(stage,name));fs.rmdirSync(child);
            }else{
                fs.mkdirSync(path.join(stage,'sections'));
                for(const name of SECTIONS)writeFile(path.join(stage,'sections',name+'.json'),Buffer.from(JSON.stringify(restoredData[name])));
                writeFile(path.join(stage,'sections/revisions.json'),Buffer.from(JSON.stringify(storage.encodeRevisions(value.revisions,metadata.descriptor,seed.operationState))));
                writeFile(path.join(stage,'database-identity.json'),Buffer.from(JSON.stringify(metadata.identity)));
                operations().putObjects(stage,seed.objects);
            }
            for(const entry of value.files){
                if(entry.name==='database.json'||entry.name==='operation-state.json'||operationObjectsName.test(entry.name))continue;
                const filename=path.join(stage,...entry.name.split('/'));if(entry.name!=='settings.json')fs.mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});
                writeFile(filename,entry.bytes);if(sha(readFile(filename))!==entry.sha256)fail('BACKUP_HASH','Восстановленный файл не совпал с пакетом');
            }
        },
        verify(stage,metadata){
            const value=load(),actual=storage.readSnapshot(stage);
            const seed=value.restoreSeed||value.operationSeed||operationSeed(value.data,metadata.migrationId),restoredData=value.restoredData||{...value.data,auditLog:seed.hotRows};
            for(const name of SECTIONS)if(JSON.stringify(actual.data[name])!==JSON.stringify(restoredData[name])||actual.revisions[name]!==value.revisions[name])fail('BACKUP_PARITY','Восстановленные данные или версии не совпали');
            const restored=operations().fromClosure(operations().exportClosure(stage),{operationState:operations().readState(stage)});if(JSON.stringify(restored.operationState)!==JSON.stringify(seed.operationState)||JSON.stringify(restored.objects)!==JSON.stringify(seed.objects))fail('BACKUP_OPERATION_STATE','Восстановленная история операций отличается от пакета');
            if(chosen==='sqlite'){
                const inspected=sqlite.inspect(stage);if(!inspected.ok||inspected.integrity.length!==1||inspected.integrity[0]!=='ok'||inspected.foreignKeyErrors.length)fail('BACKUP_INTEGRITY','Проверка целостности восстановленной SQLite не пройдена');
                if(stat(path.join(stage,'platform.sqlite-wal'))?.size)fail('BACKUP_INTEGRITY','Не завершён журнал восстановленной SQLite');
                for(const suffix of ['-wal','-shm']){const filename=path.join(stage,'platform.sqlite'+suffix),state=stat(filename);if(state){if(!state.isFile()||state.isSymbolicLink()||state.nlink!==1)fail('BACKUP_INTEGRITY','Небезопасный служебный файл восстановленной SQLite');fs.unlinkSync(filename);}}
            }
            verifyIdentity(stage,metadata);
        },
        verifyPublishedIdentity:verifyIdentity,
        report(stage,metadata){return {...report(load()),path:target,restoredFormat:chosen,restoredDescriptor:metadata.descriptor,targetIdentity:metadata.identity,migrationId:metadata.migrationId,startedAt:metadata.startedAt,retainedStages:metadata.retainedStages};}
    },options);
}
function createBackupService({journal}={}){
    if(journal!==undefined&&typeof journal!=='function')throw new TypeError('Нужен доверенный журнал восстановления');
    function restorePackage(request,options={}){
        if(!plain(options)||Object.keys(options).some(key=>!['lifecyclePlan','assertLifecycleCurrent'].includes(key)))fail('BACKUP_LIFECYCLE','Некорректные доверенные параметры восстановления');
        if(options.lifecyclePlan===undefined){if(options.assertLifecycleCurrent!==undefined)fail('BACKUP_LIFECYCLE','Проверке актуальности нужен подтверждённый план');return restoreLegacyPackage(request);}
        return restoreReviewedPackage(request,options,journal??require('./migration-journal.cjs').runCopy);
    }
    return Object.freeze({packageNameSafe,createPackage,verifyPackage,restorePackage});
}
module.exports = Object.freeze({...createBackupService(),createBackupService});
