'use strict';
// Explicit offline COPY migration. The source is never opened through storage:
// even a read through that adapter could migrate or recover the original JSON.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const schema = require('../assets/core/platform-schema.js');
const contracts = require('../assets/core/platform-contracts.js');
const sqlite = require('./sqlite-storage.cjs');
const sections = schema.sections;
const managed = ['attachments','import-sources','reestr-knowledge','document-archive'];
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fold = value => process.platform === 'win32' ? value.toLowerCase() : value;
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function stat(filename) {
  try { return fs.lstatSync(filename); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function safeName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 240 &&
    !/[\x00-\x1f\\/:*?"<>|]/.test(name) && !/[. ]$/.test(name) && name !== '.' && name !== '..' &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);
}
function localAbsolute(value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || /^\\\\|^\/\//.test(value) || /^[a-z]:[^\\/]/i.test(value))
    fail('MIGRATION_PATH','Нужен явный локальный путь без UNC, устройств и относительного пути диска');
  return path.resolve(value);
}
function checkedDirectory(directory) {
  const absolute = localAbsolute(directory), root = path.parse(absolute).root;
  let current = root;
  for (const component of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current,component);
    const info = stat(current);
    if (!info || !info.isDirectory() || info.isSymbolicLink()) fail('MIGRATION_PATH','Каталог отсутствует или проходит через символическую ссылку');
  }
  const info = stat(absolute);
  if (!info || !info.isDirectory() || info.isSymbolicLink()) fail('MIGRATION_PATH','Нужен существующий обычный каталог');
  const real = fs.realpathSync(absolute);
  if (/^\\\\|^\/\//.test(real)) fail('MIGRATION_PATH','Каталог указывает на сетевую папку');
  return real;
}
function within(parent, child) {
  const relative = path.relative(fold(parent),fold(child));
  return relative === '' || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
function paths(sourceDir,targetDir) {
  const source = checkedDirectory(sourceDir), proposed = localAbsolute(targetDir);
  if (!safeName(path.basename(proposed))) fail('MIGRATION_PATH','Недопустимое имя целевого каталога');
  const parent = checkedDirectory(path.dirname(proposed)), target = path.join(parent,path.basename(proposed));
  if (within(source,target) || within(target,source)) fail('MIGRATION_PATH','Источник и цель должны быть разными и не вложенными друг в друга каталогами');
  if (stat(target)) fail('MIGRATION_TARGET_EXISTS','Целевой каталог уже существует; выберите новый путь');
  return { source,parent,target };
}
function ordinaryFile(root,relative) {
  const filename = path.join(root,...relative.split('/')), info = stat(filename);
  if (!info || !info.isFile() || info.isSymbolicLink()) fail('MIGRATION_SOURCE_FILE','Исходный файл отсутствует, не является обычным файлом или является ссылкой: ' + relative);
  if (!within(root,fs.realpathSync(filename))) fail('MIGRATION_PATH','Файл находится за пределами исходного каталога');
  return { filename,info };
}
function hashFile(filename) {
  const fd = fs.openSync(filename,'r'), hash = crypto.createHash('sha256'), buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    const first = fs.fstatSync(fd);
    let bytes;
    do { bytes = fs.readSync(fd,buffer,0,buffer.length,null); if (bytes) hash.update(buffer.subarray(0,bytes)); } while (bytes);
    const last = fs.fstatSync(fd);
    if (first.size !== last.size || first.mtimeMs !== last.mtimeMs || first.ino !== last.ino)
      fail('MIGRATION_SOURCE_CHANGED','Исходный файл изменился во время чтения');
    return { size:last.size,sha256:hash.digest('hex') };
  } finally { fs.closeSync(fd); }
}
function sourceManifest(source) {
  for (const relative of ['.tvs-database.lock','.tvs-database.lock.recovery','sections/.transaction.json']) {
    if (stat(path.join(source,...relative.split('/')))) fail('MIGRATION_SOURCE_BUSY','Источник занят или содержит незавершённое сохранение. Закройте программу и восстановите JSON штатным способом.');
  }
  if (stat(path.join(source,'platform.sqlite'))) fail('MIGRATION_SOURCE_SQLITE','Источник уже содержит SQLite; этот инструмент копирует только JSON');
  const manifest = [];
  const addFile = relative => {
    const {filename} = ordinaryFile(source,relative);
    manifest.push({ path:relative,type:'file',...hashFile(filename) });
  };
  for (const name of ['data.json','data.json.before-split','database-identity.json']) if (stat(path.join(source,name))) addFile(name);
  for (const directory of ['sections',...managed]) {
    const info = stat(path.join(source,directory));
    if (!info) continue;
    if (!info.isDirectory() || info.isSymbolicLink()) fail('MIGRATION_SOURCE_FILE','Недопустимый каталог источника: ' + directory);
    manifest.push({path:directory,type:'directory'});
    const names = fs.readdirSync(path.join(source,directory)).sort(), seen = new Set();
    for (const name of names) {
      if (!safeName(name) || seen.has(name.toLowerCase())) fail('MIGRATION_SOURCE_FILE','Недопустимое или неоднозначное имя файла в ' + directory);
      seen.add(name.toLowerCase());
      if (directory === 'sections' && name !== 'revisions.json' && !sections.some(section => name === section + '.json'))
        fail('MIGRATION_SOURCE_SCHEMA','Источник содержит неизвестный раздел или незавершённый временный файл');
      addFile(directory + '/' + name);
    }
  }
  manifest.sort((a,b) => a.path.localeCompare(b.path));
  return manifest;
}
function readSource(source,manifest) {
  const byPath = new Map(manifest.filter(file => file.type === 'file').map(file => [file.path,file]));
  const read = relative => {
    const expected = byPath.get(relative);
    if (!expected) fail('MIGRATION_SOURCE_INCOMPLETE','Не хватает исходного файла: ' + relative);
    const bytes = fs.readFileSync(ordinaryFile(source,relative).filename);
    if (bytes.length !== expected.size || sha(bytes) !== expected.sha256) fail('MIGRATION_SOURCE_CHANGED','Исходный JSON изменился во время чтения');
    try { return JSON.parse(bytes.toString('utf8')); }
    catch { fail('MIGRATION_SOURCE_JSON','Не удалось разобрать JSON: ' + relative); }
  };
  let data, revisions, format;
  if (manifest.some(file => file.path === 'sections')) {
    const rawRevisions=read('sections/revisions.json');let decoded;
    try{decoded=require('./storage-format.cjs').decodeRevisions(rawRevisions);}catch{fail('MIGRATION_SOURCE_REVISIONS','Повреждены версии исходных разделов');}
    revisions = decoded.revisions; data = {}; format = 'split-json';
    for (const section of sections) {
      const relative = 'sections/' + section + '.json';
      if (byPath.has(relative)) data[section] = read(relative);
      else {
        if (decoded.schemaVersion===2 || Object.hasOwn(rawRevisions,section) || ['vehicles','records'].includes(section)) fail('MIGRATION_SOURCE_INCOMPLETE','Не хватает обязательного файла раздела: ' + section);
        data[section] = [];
      }
      if (!Object.hasOwn(revisions,section)) revisions[section] = 0;
    }
  } else {
    data = read('data.json'); format = 'legacy-json';
    if (!plain(data) || !Object.hasOwn(data,'vehicles') || !Object.hasOwn(data,'records') || Object.keys(data).some(name => !sections.includes(name)))
      fail('MIGRATION_SOURCE_SCHEMA','Некорректная или неизвестная структура старой JSON базы');
    revisions = Object.fromEntries(sections.map(section => [section,0]));
    data = Object.fromEntries(sections.map(section => [section,Object.hasOwn(data,section) ? data[section] : []]));
  }
  for (const section of sections) if (!Array.isArray(data[section]) || data[section].some(row => !plain(row)))
    fail('MIGRATION_SOURCE_ROWS','Раздел должен содержать массив объектов: ' + section);
  // Runtime shape validation only: legacy negative balances and broken domain
  // links must survive unchanged. In particular JSON numeric overflow must not
  // turn Infinity into null during serialization to the new store.
  try { contracts.validateSections(data,sections); }
  catch { fail('MIGRATION_SOURCE_JSON_SHAPE','Исходная база содержит небезопасные или непредставимые значения JSON'); }
  return { data,revisions,format };
}
function referencedFiles(data,manifest) {
  const files = new Map(manifest.filter(file => file.type === 'file').map(file => [file.path,file]));
  const checked = new Set();
  const reference = (directory,row) => {
    if (!plain(row) || typeof row.id !== 'string' || !/^[a-f0-9]{64}\.[a-z0-9]{1,6}$/.test(row.id))
      fail('MIGRATION_FILE_REFERENCE','Некорректная ссылка на управляемый файл');
    const relative = directory + '/' + row.id, file = files.get(relative);
    if (!file) fail('MIGRATION_FILE_MISSING','Не найден управляемый файл, на который ссылается база: ' + relative);
    if (file.sha256 !== row.id.slice(0,64) || row.sha256 != null && row.sha256 !== file.sha256 || row.size != null && row.size !== file.size)
      fail('MIGRATION_FILE_HASH','Контрольная сумма или размер управляемого файла не совпадает: ' + relative);
    checked.add(relative);
  };
  const visit = value => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!plain(value)) return;
    for (const [name,child] of Object.entries(value)) {
      if (name === 'attachments' && Array.isArray(child)) child.forEach(row => reference('attachments',row));
      if (['sourceArchive','lastImportArchive','sourceManifest'].includes(name) && plain(child) && (child.available === true || child.id != null)) reference('import-sources',child);
      if (name === 'sourceArchives' && Array.isArray(child)) child.forEach(row => { if (plain(row) && (row.available === true || row.id != null)) reference('import-sources',row); });
      visit(child);
    }
  };
  visit(data);
  return checked.size;
}
function copyManaged(source,stage,manifest,data) {
  const copied = [];
  const reachable=require('./document-archive.cjs').managedNames(source,data);
  for (const entry of manifest) {
    const directory = entry.path.split('/')[0];
    if (!managed.includes(directory)||directory==='document-archive'&&entry.type==='file'&&!reachable.has(entry.path.slice('document-archive/'.length))) continue;
    if (entry.type === 'directory') { fs.mkdirSync(path.join(stage,directory),{mode:0o700}); continue; }
    const {filename} = ordinaryFile(source,entry.path), target = path.join(stage,...entry.path.split('/'));
    fs.copyFileSync(filename,target,fs.constants.COPYFILE_EXCL);
    const actual = hashFile(target);
    if (actual.size !== entry.size || actual.sha256 !== entry.sha256) fail('MIGRATION_SOURCE_CHANGED','Управляемый файл изменился при копировании');
    const basename = path.basename(target);
    if (directory !== 'reestr-knowledge' && /^[a-f0-9]{64}\.[a-z0-9]{1,6}$/.test(basename) && basename.slice(0,64) !== actual.sha256)
      fail('MIGRATION_FILE_HASH','Имя управляемого файла не совпадает с его SHA256');
    copied.push({path:entry.path,...actual});
  }
  return copied;
}
function verifyDatabase(stage,source) {
  const data = sqlite.readAll(stage), revisions = sqlite.readRevisions(stage), inspected = sqlite.inspect(stage);
  require('./document-archive.cjs').validateState(stage,data);require('./import-source.cjs').validateState(stage,data);
  if (!inspected.ok || !Array.isArray(inspected.integrity) || inspected.integrity.length !== 1 || inspected.integrity[0] !== 'ok' ||
      !Array.isArray(inspected.foreignKeyErrors) || inspected.foreignKeyErrors.length)
    fail('MIGRATION_SQLITE_INTEGRITY','Проверка целостности SQLite не пройдена');
  if (!plain(data) || Object.keys(data).length !== sections.length || !plain(revisions) || Object.keys(revisions).length !== sections.length)
    fail('MIGRATION_PARITY','Набор разделов SQLite отличается от исходного');
  for (const section of sections) if (JSON.stringify(data[section]) !== JSON.stringify(source.data[section]) || revisions[section] !== source.revisions[section])
    fail('MIGRATION_PARITY','Данные или версия раздела не совпали после копирования: ' + section);
  return { sections:sections.map(name => ({name,count:data[name].length,revision:revisions[name],sha256:sha(JSON.stringify(data[name]))})),
    rowCount:sections.reduce((count,name) => count + data[name].length,0),linkCount:inspected.linkCount,
    legacyIssueCount:Array.isArray(inspected.legacyIssues) ? inspected.legacyIssues.length : 0,
    integrity:inspected.integrity.slice(),foreignKeyErrorCount:inspected.foreignKeyErrors.length };
}
function cleanupStage(stage,parent,identity) {
  if (!stage) return;
  const absolute = path.resolve(stage), info = stat(absolute);
  if (!info) return;
  if (fold(path.dirname(absolute)) !== fold(parent) || !path.basename(absolute).startsWith('.tvs-sqlite-stage-') ||
      !info.isDirectory() || info.isSymbolicLink() || info.dev !== identity.dev || info.ino !== identity.ino)
    fail('MIGRATION_CLEANUP','Временный каталог изменился; автоматическое удаление остановлено');
  const scan = directory => {
    for (const name of fs.readdirSync(directory)) {
      const filename = path.join(directory,name), entry = fs.lstatSync(filename);
      if (entry.isSymbolicLink() || !within(absolute,filename)) fail('MIGRATION_CLEANUP','Временный каталог содержит недопустимую ссылку');
      if (entry.isDirectory()) scan(filename);
    }
  };
  scan(absolute);
  fs.rmSync(absolute,{recursive:true,force:false});
}
function migrateCopy({sourceDir,targetDir} = {}) {
  const {source,parent,target} = paths(sourceDir,targetDir);
  let stage = null, identity;
  try {
    const manifest = sourceManifest(source), original = readSource(source,manifest);
    require('./document-archive.cjs').validateState(source,original.data);require('./import-source.cjs').validateState(source,original.data);
    const referencedFileCount = referencedFiles(original.data,manifest);
    stage = fs.mkdtempSync(path.join(parent,'.tvs-sqlite-stage-')); identity = fs.lstatSync(stage);
    sqlite.create(stage,{data:original.data,revisions:original.revisions});
    const copiedFiles = copyManaged(source,stage,manifest,original.data), parity = verifyDatabase(stage,original);
    const after = sourceManifest(source);
    if (JSON.stringify(manifest) !== JSON.stringify(after)) fail('MIGRATION_SOURCE_CHANGED','Исходная база изменилась во время копирования. Целевая база не создана.');
    if (stat(target) || fold(checkedDirectory(path.dirname(target))) !== fold(parent)) fail('MIGRATION_TARGET_EXISTS','Целевой путь изменился во время копирования');
    const database = ordinaryFile(stage,'platform.sqlite');
    const wal = stat(database.filename + '-wal');
    if (wal?.size) fail('MIGRATION_SQLITE_CHECKPOINT','SQLite не закрыла журнал перед публикацией копии');
    // Read-only verification may leave an SHM coordination file although every
    // adapter connection is closed and the WAL is empty. This unpublished stage
    // is exclusively ours: discard only these ordinary, no-longer-needed files.
    for (const suffix of ['-wal','-shm']) if (stat(database.filename + suffix)) {
      const sidecar = ordinaryFile(stage,'platform.sqlite' + suffix);
      fs.unlinkSync(sidecar.filename);
    }
    const report = { ok:true,format:'tvs-sqlite-copy-migration',version:1,sourceFormat:original.format,
      sourceFingerprint:sha(JSON.stringify(manifest)),sourceFileCount:manifest.filter(file => file.type === 'file').length,
      sourceFiles:manifest.filter(file => file.type === 'file'),referencedFileCount,copiedFileCount:copiedFiles.length,copiedFiles,
      databaseSha256:hashFile(database.filename).sha256,...parity };
    fs.writeFileSync(path.join(stage,'migration-report.json'),JSON.stringify(report,null,2) + '\n',{flag:'wx',mode:0o600});
    fs.renameSync(stage,target); stage = null;
    return report;
  } catch (error) {
    try { cleanupStage(stage,parent,identity); }
    catch (cleanupError) { cleanupError.cause = error; throw cleanupError; }
    if (error.code?.startsWith('MIGRATION_')) throw error;
    const wrapped = new Error('Не удалось создать и проверить отдельную SQLite копию. Исходная база не изменялась.');
    wrapped.code = 'MIGRATION_FAILED'; wrapped.cause = error; throw wrapped;
  }
}
module.exports = Object.freeze({ migrateCopy });
