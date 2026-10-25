'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto'), vm = require('node:vm');
const { createRequire } = require('node:module');
const AdmZip = require('adm-zip'), schema = require('../assets/core/platform-schema.js'), storage = require('../electron/storage'), sqlite = require('../electron/sqlite-storage.cjs');
const backup = require('../electron/backup-service.cjs');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function temp(t) { const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'tvs-backup-recovery-')); t.after(() => { const target = path.resolve(parent); assert.equal(path.dirname(target), path.resolve(os.tmpdir())); assert.ok(path.basename(target).startsWith('tvs-backup-recovery-')); fs.rmSync(target, { recursive: true, force: true }); }); const sourceDir = path.join(parent, 'source'), archivePath = path.join(parent, 'backup.zip'), targetDir = path.join(parent, 'restored'); fs.mkdirSync(sourceDir); return { parent, sourceDir, archivePath, targetDir }; }
function data() { return { ...Object.fromEntries(schema.sections.map(name => [name, []])), vehicles: [{ id: 7, fuelBalance: 923.537, plate: 'SYNTHETIC' }, { id: '7', fuelBalance: -2.125 }, { id: 'duplicate', note: 'first' }, { id: 'duplicate', note: 'second' }, { plate: 'Legacy missing id' }], records: [{ id: 'old-orphan', vehicleId: 'missing', date: 'legacy date', km: -3.125 }], auditLog: [{ id: 'old-audit', section: 'vehicles', recordId: 7, before: { fuelBalance: 900 }, after: { fuelBalance: 923.537 } }] }; }
function source(paths, format = 'json') { const input = data(), revisions = Object.fromEntries(schema.sections.map((name, index) => [name, index + 3])); if (format === 'sqlite')
    sqlite.create(paths.sourceDir, { data: input, revisions });
else
    fs.writeFileSync(path.join(paths.sourceDir, 'data.json'), JSON.stringify(input, null, 2)); return { input, revisions: format === 'sqlite' ? revisions : Object.fromEntries(schema.sections.map(name => [name, 0])) }; }
function businessTree(directory) { const result = []; const walk = (base, prefix = '') => { for (const name of fs.readdirSync(base).sort()) {
    if (name.endsWith('-shm') || name.endsWith('-wal') && fs.statSync(path.join(base, name)).size === 0)
        continue;
    const filename = path.join(base, name), relative = prefix ? prefix + '/' + name : name, info = fs.lstatSync(filename);
    if (info.isSymbolicLink())
        result.push({ name: relative, link: fs.readlinkSync(filename) });
    else if (info.isDirectory()) {
        result.push({ name: relative, type: 'directory' });
        walk(filename, relative);
    }
    else
        result.push({ name: relative, sha256: sha(fs.readFileSync(filename)) });
} }; walk(directory); return result; }
function noStage(parent) { assert.deepEqual(fs.readdirSync(parent).filter(name => name.startsWith('.tvs-backup-')), []); }
function managed(paths, directory, bytes, extension) { const hash = sha(bytes), id = hash + extension; fs.mkdirSync(path.join(paths.sourceDir, directory), { recursive: true }); fs.writeFileSync(path.join(paths.sourceDir, directory, id), bytes); return { id, sha256: hash, size: bytes.length, name: 'Synthetic document' + extension }; }
function rewrite(archivePath, mutate) { const zip = new AdmZip(archivePath), manifest = JSON.parse(zip.getEntry('manifest.json').getData().toString('utf8')); mutate(zip, manifest); zip.updateFile('manifest.json', Buffer.from(JSON.stringify(manifest))); zip.writeZip(archivePath); }
function replaceMember(zip, manifest, name, bytes) { zip.updateFile(name, bytes); Object.assign(manifest.files.find(row => row.name === name), { size: bytes.length, sha256: sha(bytes) }); }
for(const kind of ['json','sqlite'])test(kind+' schema-2 backup preserves mixed document drafts and their managed evidence in a separate restored database',t=>{
 const paths=temp(t),input=data(),evidence=managed(paths,'attachments',Buffer.from('Synthetic draft evidence'),'.txt');input.documentDrafts=[{id:0,section:'payments',status:'draft',payload:{date:'2026-10-20',sum:7.01,description:'Synthetic financial draft',attachments:[evidence]},createdAt:'2026-10-22T12:00:00.000Z',createdBy:{id:'draft-admin',name:'Synthetic administrator',role:'admin'},updatedAt:'2026-10-22T12:00:00.000Z'}];const names=require('../electron/storage-format.cjs').sectionsFor(2),revisions=Object.fromEntries(names.map(name=>[name,7])),sourceInput=Object.fromEntries(names.map(name=>[name,input[name]]));
 if(kind==='sqlite'){const attachmentDir=path.join(paths.parent,'evidence');fs.renameSync(path.join(paths.sourceDir,'attachments'),attachmentDir);require('./helpers/schema-format-support.cjs').oldSqlite.create(paths.sourceDir,{data:sourceInput,revisions});fs.renameSync(attachmentDir,path.join(paths.sourceDir,'attachments'));}else{fs.mkdirSync(storage.sectionsDir(paths.sourceDir));for(const name of names)fs.writeFileSync(storage.sectionFile(paths.sourceDir,name),JSON.stringify(input[name]));fs.writeFileSync(storage.revisionsFile(paths.sourceDir),JSON.stringify(require('./helpers/schema-format-support.cjs').oldFormat.encodeRevisions(revisions)));}
 const before=businessTree(paths.sourceDir);backup.createPackage(paths);backup.verifyPackage(paths);backup.restorePackage(paths);const restored=storage.readSnapshot(paths.targetDir);assert.equal(restored.platform.schemaVersion,require('../electron/storage-format.cjs').SCHEMA_VERSION);assert.deepEqual(restored.data.documentDrafts,input.documentDrafts);assert.equal(restored.revisions.documentDrafts,7);assert.deepEqual(fs.readFileSync(path.join(paths.targetDir,'attachments',evidence.id)),Buffer.from('Synthetic draft evidence'));assert.deepEqual(businessTree(paths.sourceDir),before);
});
function service(overrides = {}) { const filename = path.join(__dirname, '../electron/backup-service.cjs'), requireHere = createRequire(filename), exports = { exports: {} }; vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: exports, exports: exports.exports, Buffer, process, console, require(name) { return Object.hasOwn(overrides, name) ? overrides[name] : requireHere(name); } }, { filename }); return exports.exports; }
for (const format of ['json', 'sqlite'])
    test(format + ' backup verifies and restores 40 sections without changing typed, missing or duplicate legacy IDs', t => {
        const paths = temp(t), expected = source(paths, format), before = businessTree(paths.sourceDir), settings = { networkKey: 'SECRET-NETWORK-TOKEN', users: [{ name: 'Synthetic', dataDir: 'Synthetic path' }] };
        const created = backup.createPackage({ ...paths, settings }), verified = backup.verifyPackage(paths);
        assert.equal(created.ok, true, JSON.stringify(created));
        assert.equal(verified.sections.length, schema.sections.length);
        assert.equal(verified.sourceFormat, format);
        assert.equal(JSON.stringify(created).includes('SECRET-NETWORK-TOKEN'), false);
        assert.equal(JSON.stringify(verified).includes('networkKey'), false);
        const restored = backup.restorePackage({...paths,format}), actual = storage.readSnapshot(paths.targetDir);
        assert.equal(restored.restoredFormat, format);
        assert.deepEqual(actual.data, expected.input);
        assert.deepEqual(actual.revisions, expected.revisions);
        assert.equal(actual.data.vehicles[0].fuelBalance, 923.537);
        assert.equal(typeof actual.data.vehicles[0].id, 'number');
        assert.equal(typeof actual.data.vehicles[1].id, 'string');
        assert.equal(actual.data.vehicles[2].id, actual.data.vehicles[3].id);
        assert.equal(Object.hasOwn(actual.data.vehicles[4], 'id'), false);
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(paths.targetDir, 'settings.json'), 'utf8')), settings);
        assert.deepEqual(businessTree(paths.sourceDir), before);
        noStage(paths.parent);
    });
test('managed attachment/import-source references and knowledge survive byte-for-byte, including historic audit metadata', t => {
    const paths = temp(t), expected = source(paths), attachment = managed(paths, 'attachments', Buffer.from('Synthetic attachment'), '.pdf'), original = managed(paths, 'import-sources', Buffer.from('Synthetic original statement'), '.xlsx');
    expected.input.vehicles[0].attachments = [attachment];
    expected.input.auditLog[0].before.attachments = [attachment];
    expected.input.records[0].sourceArchives = [{ available: true, ...original }];
    fs.writeFileSync(path.join(paths.sourceDir, 'data.json'), JSON.stringify(expected.input));
    fs.mkdirSync(path.join(paths.sourceDir, 'reestr-knowledge'));
    fs.writeFileSync(path.join(paths.sourceDir, 'reestr-knowledge/knowledge.json'), ' {"example":true}\n');
    const before = businessTree(paths.sourceDir), created = backup.createPackage(paths);
    assert.equal(created.referencedFileCount, 2);
    backup.restorePackage(paths);
    for (const [directory, entry] of [['attachments', attachment], ['import-sources', original]])
        assert.deepEqual(fs.readFileSync(path.join(paths.targetDir, directory, entry.id)), fs.readFileSync(path.join(paths.sourceDir, directory, entry.id)));
    assert.deepEqual(storage.readSnapshot(paths.targetDir).data, expected.input);
    assert.deepEqual(businessTree(paths.sourceDir), before);
    noStage(paths.parent);
});
test('old format-1 packages without source format or revision metadata remain recoverable', t => {
    const paths = temp(t), input = { vehicles: [{ id: 7, fuelBalance: 923.537 }, { id: '7' }, { id: 'same' }, { id: 'same' }, {}], records: [{ id: 'orphan', vehicleId: 'gone' }] }, bytes = Buffer.from(JSON.stringify(input));
    const zip = new AdmZip();
    zip.addFile('database.json', bytes);
    zip.addFile('manifest.json', Buffer.from(JSON.stringify({ format: 'tvs-backup', version: 1, files: [{ name: 'database.json', size: bytes.length, sha256: sha(bytes) }] })));
    zip.writeZip(paths.archivePath);
    assert.equal(backup.verifyPackage(paths).ok, true);
    backup.restorePackage(paths);
    const actual = storage.readSnapshot(paths.targetDir);
    assert.deepEqual(actual.data.vehicles, input.vehicles);
    assert.deepEqual(actual.data.records, input.records);
    assert.equal(actual.data.fuelPurchases.length, 0);
    noStage(paths.parent);
});
test('existing destination files and directories are never overwritten', t => {
    const paths = temp(t);
    source(paths);
    backup.createPackage(paths);
    const original = fs.readFileSync(paths.archivePath);
    assert.throws(() => backup.createPackage(paths), { code: 'BACKUP_TARGET_EXISTS' });
    assert.deepEqual(fs.readFileSync(paths.archivePath), original);
    fs.mkdirSync(paths.targetDir);
    fs.writeFileSync(path.join(paths.targetDir, 'keep.txt'), 'Keep');
    assert.throws(() => backup.restorePackage(paths), { code: 'BACKUP_TARGET_EXISTS' });
    assert.equal(fs.readFileSync(path.join(paths.targetDir, 'keep.txt'), 'utf8'), 'Keep');
    noStage(paths.parent);
});
for (const kind of ['legacy-json', 'sqlite'])
    test(kind + ' backup protects source paths and permits an internal backup only for a current writable source', t => {
        const paths = temp(t);
        if (kind === 'sqlite') source(paths, kind);
        else {
            const legacy = require('../electron/storage-format.cjs').legacySections(), input = data();
            fs.mkdirSync(storage.sectionsDir(paths.sourceDir));
            for (const name of legacy) fs.writeFileSync(storage.sectionFile(paths.sourceDir, name), JSON.stringify(input[name]));
            fs.writeFileSync(storage.revisionsFile(paths.sourceDir), JSON.stringify(Object.fromEntries(legacy.map(name => [name, 0]))));
        }
        const before = businessTree(paths.sourceDir);
        for (const name of ['platform.sqlite', 'platform.sqlite-wal', 'platform.sqlite-shm', 'data.json', 'data.json.before-split', 'database-identity.json', '.tvs-database.lock', '.tvs-database.lock.recovery', 'backups', 'ordinary.zip']) {
            assert.throws(() => backup.createPackage({ ...paths, archivePath: path.join(paths.sourceDir, name) }), error => ['BACKUP_PATH', 'BACKUP_TARGET_EXISTS'].includes(error.code), name);
            assert.deepEqual(businessTree(paths.sourceDir), before, name);
        }
        const snapshot = storage.readSnapshot(paths.sourceDir);
        assert.equal(snapshot.platform.schemaVersion, kind === 'legacy-json' ? 1 : require('../electron/storage-format.cjs').SCHEMA_VERSION);
        assert.deepEqual(businessTree(paths.sourceDir), before);
        fs.mkdirSync(path.join(paths.sourceDir, 'backups'));
        const archivePath = path.join(paths.sourceDir, 'backups', 'verified.zip');
        if(kind==='legacy-json'){
            assert.throws(()=>backup.createPackage({...paths,archivePath}),{code:'BACKUP_PATH'});
            assert.deepEqual(fs.readdirSync(path.join(paths.sourceDir,'backups')),[]);
            assert.equal(backup.createPackage(paths).ok,true);
        }else{
            assert.equal(backup.createPackage({ ...paths, archivePath }).ok, true);
            assert.equal(backup.verifyPackage({ archivePath }).ok, true);
        }
        assert.deepEqual(businessTree(paths.sourceDir).filter(entry => !entry.name.startsWith('backups')), before);
        noStage(paths.parent);
        noStage(path.join(paths.sourceDir, 'backups'));
    });

test('restore cannot stage inside the protected working directory or over its ancestor', t => {
    const paths = temp(t);
    source(paths);
    backup.createPackage(paths);
    assert.throws(() => backup.restorePackage({ ...paths, targetDir: path.join(paths.sourceDir, 'inside'), protectedDir: paths.sourceDir }), { code: 'BACKUP_PATH' });
    assert.throws(() => backup.restorePackage({ ...paths, targetDir: paths.sourceDir, protectedDir: paths.sourceDir }), { code: 'BACKUP_TARGET_EXISTS' });
    noStage(paths.parent);
});
for (const mode of ['tamper', 'missing', 'unlisted'])
    test('package verification rejects ' + mode + ' payloads before creating a target', t => {
        const paths = temp(t);
        source(paths);
        backup.createPackage(paths);
        rewrite(paths.archivePath, (zip, manifest) => { if (mode === 'tamper')
            zip.updateFile('database.json', Buffer.from('{}')); if (mode === 'missing')
            zip.deleteFile('database.json'); if (mode === 'unlisted')
            zip.addFile('settings.json.extra', Buffer.from('Unknown file')); });
        assert.throws(() => backup.restorePackage(paths));
        assert.equal(fs.existsSync(paths.targetDir), false);
        noStage(paths.parent);
    });
test('removing both the managed file and its manifest entry still fails reference completeness', t => {
    const paths = temp(t), expected = source(paths), attachment = managed(paths, 'attachments', Buffer.from('Required attachment'), '.pdf');
    expected.input.vehicles[0].attachments = [attachment];
    fs.writeFileSync(path.join(paths.sourceDir, 'data.json'), JSON.stringify(expected.input));
    backup.createPackage(paths);
    rewrite(paths.archivePath, (zip, manifest) => { zip.deleteFile('attachments/' + attachment.id); manifest.files = manifest.files.filter(row => row.name !== 'attachments/' + attachment.id); });
    assert.throws(() => backup.verifyPackage(paths), { code: 'BACKUP_REFERENCE_MISSING' });
    assert.equal(fs.existsSync(paths.targetDir), false);
    noStage(paths.parent);
});
test('ZIP traversal and duplicate names cannot escape the explicitly selected target', t => {
    const paths = temp(t);
    source(paths);
    backup.createPackage(paths);
    const zip = new AdmZip(paths.archivePath);
    zip.addFile('evil.txt', Buffer.from('evil'));
    let bytes = zip.toBuffer();
    const from = Buffer.from('evil.txt'), to = Buffer.from('../x.txt');
    for (let offset = bytes.indexOf(from); offset >= 0; offset = bytes.indexOf(from, offset + to.length))
        to.copy(bytes, offset);
    fs.writeFileSync(paths.archivePath, bytes);
    assert.throws(() => backup.restorePackage(paths), { code: 'BACKUP_PATH' });
    assert.equal(fs.existsSync(path.join(paths.parent, 'x.txt')), false);
    assert.equal(fs.existsSync(paths.targetDir), false);
    noStage(paths.parent);
});
test('finite JSON and unsafe-field checks apply to verified archive payloads, not just their hashes', t => {
    for (const raw of ['{"vehicles":[{"id":7,"fuelBalance":1e400}],"records":[]}', '{"vehicles":[{"id":7,"__proto__":{"secret":true}}],"records":[]}']) {
        const paths = temp(t);
        source(paths);
        backup.createPackage(paths);
        rewrite(paths.archivePath, (zip, manifest) => replaceMember(zip, manifest, 'database.json', Buffer.from(raw)));
        assert.throws(() => backup.restorePackage(paths), { code: 'BACKUP_DATABASE' });
        assert.equal(fs.existsSync(paths.targetDir), false);
        noStage(paths.parent);
    }
});
test('creation rejects missing managed references and unsafe raw JSON without touching source files', t => {
    for (const mode of ['reference', 'json']) {
        const paths = temp(t), expected = source(paths);
        if (mode === 'reference') {
            expected.input.vehicles[0].attachments = [{ id: 'a'.repeat(64) + '.pdf' }];
            fs.writeFileSync(path.join(paths.sourceDir, 'data.json'), JSON.stringify(expected.input));
        }
        else
            fs.writeFileSync(path.join(paths.sourceDir, 'data.json'), '{"vehicles":[{"id":7,"norm":1e400}],"records":[]}');
        const before = businessTree(paths.sourceDir);
        assert.throws(() => backup.createPackage(paths));
        assert.deepEqual(businessTree(paths.sourceDir), before);
        assert.equal(fs.existsSync(paths.archivePath), false);
        noStage(paths.parent);
    }
});
test('creation self-verifies its written archive before exclusive publication', t => {
    const paths = temp(t);
    source(paths);
    const before = businessTree(paths.sourceDir);
    function BrokenZip() { const instance = new AdmZip(); instance.toBuffer = () => Buffer.from('Not a ZIP archive'); return instance; }
    const failing = service({ 'adm-zip': BrokenZip });
    assert.throws(() => failing.createPackage(paths));
    assert.deepEqual(businessTree(paths.sourceDir), before);
    assert.equal(fs.existsSync(paths.archivePath), false);
    noStage(paths.parent);
});
test('exclusive ZIP publication preserves a file created during the final race', t => {
    const paths = temp(t);
    source(paths);
    const other = Buffer.from('Unrelated file created by another process');
    const racing = service({ 'node:fs': { ...fs, linkSync(from, target) {
        fs.writeFileSync(target, other, { flag: 'wx' });
        fs.linkSync(from, target);
    } } });
    assert.throws(() => racing.createPackage(paths), { code: 'BACKUP_TARGET_EXISTS' });
    assert.deepEqual(fs.readFileSync(paths.archivePath), other);
    noStage(paths.parent);
});
test('exclusive publication exposes a complete verified archive and leaves no temporary file', t => {
    const paths = temp(t);
    source(paths);
    let observed = false;
    const checking = service({ 'node:fs': { ...fs, linkSync(from, target) {
        const bytes = fs.readFileSync(from), zip = new AdmZip(bytes);
        assert.equal(JSON.parse(zip.getEntry('manifest.json').getData().toString('utf8')).format, 'tvs-backup');
        assert.equal(JSON.parse(zip.getEntry('database.json').getData().toString('utf8')).vehicles[0].fuelBalance, 923.537);
        fs.linkSync(from, target);
        assert.deepEqual(fs.readFileSync(target), bytes);
        observed = true;
    } } });
    assert.equal(checking.createPackage(paths).ok, true);
    assert.equal(observed, true);
    assert.equal(backup.verifyPackage(paths).ok, true);
    noStage(paths.parent);
});
for (const code of ['ENOTSUP', 'EPERM']) test('unsupported exclusive publication fails explicitly without rename fallback: ' + code, t => {
    const paths = temp(t);
    source(paths);
    let renamed = false;
    const failing = service({ 'node:fs': { ...fs, linkSync() { const error = new Error('Synthetic unsupported filesystem'); error.code = code; throw error; }, renameSync() { renamed = true; throw Error('Unsafe fallback must not be used'); } } });
    assert.throws(() => failing.createPackage(paths), error => error.code === 'BACKUP_FILESYSTEM' && /NTFS/.test(error.message));
    assert.equal(renamed, false);
    assert.equal(fs.existsSync(paths.archivePath), false);
    noStage(paths.parent);
});
test('restored JSON gets a new database UUID while an existing source sidecar remains unchanged', t => {
    const paths = temp(t);
    source(paths);
    const identity = require('../electron/database-identity.cjs').readOrCreate(paths.sourceDir), before = businessTree(paths.sourceDir);
    backup.createPackage(paths);
    backup.restorePackage({...paths,format:'json'});
    const restored = JSON.parse(fs.readFileSync(path.join(paths.targetDir, 'database-identity.json'), 'utf8'));
    assert.notEqual(restored.uuid, identity.uuid);
    assert.deepEqual(businessTree(paths.sourceDir), before);
    assert.equal(new AdmZip(paths.archivePath).getEntry('database-identity.json'), null);
    noStage(paths.parent);
});
test('a change only to source database identity is detected during backup creation', t => {
    const paths = temp(t);
    source(paths);
    const identity = require('../electron/database-identity.cjs').readOrCreate(paths.sourceDir);
    function IdentityRace(...args) {
        const zip = new AdmZip(...args), encode = zip.toBuffer.bind(zip);
        if (!args.length) zip.toBuffer = () => {
            const bytes = encode();
            fs.writeFileSync(path.join(paths.sourceDir, 'database-identity.json'), JSON.stringify({ ...identity, generation: identity.generation + 1 }));
            return bytes;
        };
        return zip;
    }
    const racing = service({ 'adm-zip': IdentityRace });
    assert.throws(() => racing.createPackage(paths), { code: 'BACKUP_SOURCE_CHANGED' });
    assert.equal(fs.existsSync(paths.archivePath), false);
    noStage(paths.parent);
});
test('a source change while compressing aborts publication and cleans the owned temporary file', t => {
    const paths = temp(t);
    source(paths);
    const filename = path.join(paths.sourceDir, 'data.json'), original = fs.readFileSync(filename, 'utf8');
    function RacingZip(...args) { const zip = new AdmZip(...args), encode = zip.toBuffer.bind(zip); if (!args.length)
        zip.toBuffer = () => { const result = encode(); fs.appendFileSync(filename, '\n'); return result; }; return zip; }
    const racing = service({ 'adm-zip': RacingZip });
    assert.throws(() => racing.createPackage(paths), { code: 'BACKUP_SOURCE_CHANGED' });
    assert.equal(fs.readFileSync(filename, 'utf8'), original + '\n');
    assert.equal(fs.existsSync(paths.archivePath), false);
    noStage(paths.parent);
});
test('failed staged restore cleans only its own folder and leaves archive and source unchanged', t => {
    const paths = temp(t);
    source(paths);
    backup.createPackage(paths);
    const before = businessTree(paths.sourceDir), archive = fs.readFileSync(paths.archivePath);
    const failing = service({ './storage': { ...storage, readSnapshot() { throw Error('Synthetic stage verification failure'); } } });
    assert.throws(() => failing.restorePackage(paths));
    assert.deepEqual(fs.readFileSync(paths.archivePath), archive);
    assert.deepEqual(businessTree(paths.sourceDir), before);
    assert.equal(fs.existsSync(paths.targetDir), false);
    noStage(paths.parent);
});
test('unsafe managed-directory links are rejected before reading outside the selected database', t => {
    const paths = temp(t);
    source(paths);
    const outside = path.join(paths.parent, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'keep.txt'), 'Keep');
    try {
        fs.symlinkSync(outside, path.join(paths.sourceDir, 'attachments'), process.platform === 'win32' ? 'junction' : 'dir');
    }
    catch (error) {
        if (['EPERM', 'EACCES'].includes(error.code)) {
            t.skip('Directory links unavailable');
            return;
        }
        throw error;
    }
    assert.throws(() => backup.createPackage(paths), { code: 'BACKUP_PATH' });
    assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'Keep');
    assert.equal(fs.existsSync(paths.archivePath), false);
    noStage(paths.parent);
});
test('Electron archive IPC stays a thin compatible wrapper around the tested service', async (t) => {
    const paths = temp(t);
    source(paths);
    const filename = path.join(__dirname, '../electron/artifacts.js'), requireHere = createRequire(filename), exported = { exports: {} }, handlers = {};
    let selection = 0;
    const electron = { dialog: { showSaveDialog: async () => ({ canceled: false, filePath: paths.archivePath }), showOpenDialog: async () => ({ canceled: false, filePaths: [selection++ === 0 ? paths.archivePath : paths.parent] }) }, shell: {}, BrowserWindow: { fromWebContents: () => null } };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: exported, exports: exported.exports, Buffer, Date, require(name) { return name === 'electron' ? electron : requireHere(name); } }, { filename });
    exported.exports.register({ ipcMain: { handle(name, handler) { handlers[name] = handler; } }, getDataDir: () => paths.sourceDir, isClientMode: () => false, getSettings: () => ({ networkKey: 'PRIVATE-KEY' }), knowledgeDir: () => path.join(paths.sourceDir, 'reestr-knowledge') });
    const event={sender:{id:1,getURL:()=> 'http://127.0.0.1/synthetic',isDestroyed:()=>false,mainFrame:{}}};
    const created = await handlers['create-backup-package'](event);
    assert.equal(created.ok, true, JSON.stringify(created));
    const restored = await handlers['verify-backup-package'](event);
    assert.equal(restored.ok, true);
    assert.ok(restored.path);
    assert.deepEqual(storage.readSnapshot(restored.path).data, data());
    assert.equal(JSON.stringify(restored).includes('PRIVATE-KEY'), false);
    noStage(paths.parent);
});
