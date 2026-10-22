/**
 * Хранилище данных по разделам.
 *
 * Раньше всё лежало в одном data.json: любое изменение переписывало файл
 * целиком и целиком же уходило по сети. На типовой операции — добавили одну
 * заправку на 276 байт — передавалось 446 КБ, из них 80 % журнал пробега,
 * который не менялся.
 *
 * Теперь каждый раздел лежит в своём файле в папке sections. При сохранении
 * переписываются только те файлы, содержимое которых действительно
 * изменилось, и у каждого растёт номер версии в revisions.json. Номера нужны
 * следующему этапу: по ним клиент поймёт, какие разделы подтянуть, и сервер
 * отклонит запись поверх чужих правок.
 *
 * Наружу модуль отдаёт и принимает всё те же данные целиком, поэтому
 * остальной код менять не нужно.
 */

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const runtimeProcess = require('node:process');
const heldLocks = runtimeProcess[Symbol.for('tvs.storage.databaseLocks')] || (runtimeProcess[Symbol.for('tvs.storage.databaseLocks')] = new Map());

// Порядок важен только для читаемости — файлы независимы
const SECTIONS = require('../assets/core/platform-schema.js').sections.slice();
const storageFormat=require('./storage-format.cjs');

const REVISIONS_FILE = 'revisions.json';
// SQLite is opt-in: only an explicitly created database file selects it. A
// damaged or unsupported SQLite file never falls back to an empty JSON base.
function sqliteBackend(dataDir) {
  try { fs.lstatSync(path.join(dataDir,'platform.sqlite')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  return require('./sqlite-storage.cjs');
}

function sectionsDir(dataDir) { return path.join(dataDir, 'sections'); }
function sectionFile(dataDir, name) { return path.join(sectionsDir(dataDir), name + '.json'); }
function revisionsFile(dataDir) { return path.join(sectionsDir(dataDir), REVISIONS_FILE); }
function legacyFile(dataDir) { return path.join(dataDir, 'data.json'); }
function schemaVersion(dataDir){
  const sql=sqliteBackend(dataDir);if(sql)return sql.schemaVersion(dataDir);
  if(fs.existsSync(revisionsFile(dataDir)))return storageFormat.decodeRevisions(readJson(revisionsFile(dataDir))).schemaVersion;
  if(fs.existsSync(sectionFile(dataDir,'documentDrafts')))throw Object.assign(new Error('Повреждены версии новой базы. Восстановите их из копии; автоматическое создание запрещено.'),{code:'STORAGE_REVISIONS'});
  if(fs.existsSync(legacyFile(dataDir))){const legacy=readJson(legacyFile(dataDir));if(Array.isArray(legacy?.documentDrafts)&&legacy.documentDrafts.length)throw Object.assign(new Error('Неверсионированный файл содержит новые документы. Восстановите его в отдельную базу из резервного пакета; документы не были скрыты или удалены.'),{code:'STORAGE_FORMAT'});}
  return fs.existsSync(legacyFile(dataDir))||storageFormat.legacySections().some(name=>fs.existsSync(sectionFile(dataDir,name)))?1:storageFormat.SCHEMA_VERSION;
}
function assertWritable(dataDir){if(schemaVersion(dataDir)<storageFormat.SCHEMA_VERSION)storageFormat.upgradeRequired();}
function canonicalDirectory(dataDir) {
  const resolved = fs.realpathSync(path.resolve(dataDir));
  return runtimeProcess.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
function databaseToken(dataDir) {
  return withDatabaseLock(dataDir,()=>{
    const sqlite=sqliteBackend(dataDir);
    const identity=sqlite ? sqlite.readIdentity(dataDir) : require('./database-identity.cjs').readOrCreate(dataDir,{create:schemaVersion(dataDir)>=storageFormat.SCHEMA_VERSION});
    return crypto.createHash('sha256').update(JSON.stringify(['tvs-database',canonicalDirectory(dataDir),identity?.uuid??'legacy-readonly',identity?.generation??0])).digest('hex');
  });
}
function lockError(file, detail) {
  const error = new Error('База занята другим процессом. Повторите операцию после окончания сохранения. ' + detail + ' Если все экземпляры программы закрыты, сохраните копию папки базы и удалите оставшийся файл блокировки: ' + file);
  error.code = 'DB_BUSY';
  return error;
}
function lockOwner(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
function sameHostDead(owner) {
  if (!owner || owner.host !== os.hostname() || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 || typeof owner.nonce !== 'string') return false;
  try { runtimeProcess.kill(owner.pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; }
}
function createLock(file, owner) {
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(owner), 'utf8'); fs.fsyncSync(fd); }
  catch (error) { fs.closeSync(fd); try { fs.unlinkSync(file); } catch {} throw error; }
  return fd;
}
function releaseLock(file, fd, owner) {
  fs.closeSync(fd);
  if (lockOwner(file)?.nonce === owner.nonce) fs.unlinkSync(file);
}
/** Synchronous, reentrant across modules in one process; readers also lock so
 * recovery cannot mistake a live writer's journal for an interrupted save. */
function withDatabaseLock(dataDir, action) {
  fs.mkdirSync(dataDir, { recursive: true });
  const key = canonicalDirectory(dataDir);
  if (heldLocks.has(key)) return action();
  const file = path.join(key, '.tvs-database.lock'), recovery = file + '.recovery';
  const owner = { host: os.hostname(), pid: runtimeProcess.pid, nonce: crypto.randomUUID(), startedAt: new Date().toISOString() };
  if (fs.existsSync(recovery)) throw lockError(recovery, 'Проверяется аварийная блокировка.');
  let fd;
  try { fd = createLock(file, owner); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const stale = lockOwner(file);
    if (!sameHostDead(stale)) throw lockError(file, 'Владелец: ' + (stale ? stale.host + ', PID ' + stale.pid : 'неизвестен') + '.');
    let recoveryFd;
    try { recoveryFd = createLock(recovery, owner); }
    catch (recoverError) { if (recoverError.code === 'EEXIST') throw lockError(recovery, 'Проверяется аварийная блокировка.'); throw recoverError; }
    try {
      const current = lockOwner(file);
      if (!current || current.nonce !== stale.nonce || !sameHostDead(current)) throw lockError(file, 'Владелец изменился во время проверки.');
      fs.unlinkSync(file);
      try { fd = createLock(file, owner); }
      catch (acquireError) { if (acquireError.code === 'EEXIST') throw lockError(file, 'Базу успел открыть другой процесс.'); throw acquireError; }
    } finally { releaseLock(recovery, recoveryFd, owner); }
  }
  // An ordinary acquisition that raced with stale-lock recovery yields rather
  // than entering the transaction while the recovery guard is present.
  if (fs.existsSync(recovery)) { releaseLock(file, fd, owner); throw lockError(recovery, 'Проверяется аварийная блокировка.'); }
  heldLocks.set(key, owner);
  try {
    const result = action();
    if (result && typeof result.then === 'function') throw new Error('Блокировка базы поддерживает только синхронные операции');
    return result;
  } finally { heldLocks.delete(key); releaseLock(file, fd, owner); }
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file) && fallback !== undefined) return fallback;
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    throw new Error('Не прочитан ' + path.basename(file) + '. Запись остановлена: ' + e.message);
  }
}

// Пишем через временный файл: если процесс упадёт на середине,
// рабочий файл останется целым, а не обрежется наполовину.
function writeJsonAtomic(file, data) {
  const tmp = file + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeFileSync(fd, JSON.stringify(data), 'utf8'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

function readRevisions(dataDir) {
  const sqlite = sqliteBackend(dataDir);
  if (sqlite) return sqlite.readRevisions(dataDir);
  recoverTransaction(dataDir);
  if(!fs.existsSync(revisionsFile(dataDir))){if(schemaVersion(dataDir)===1)return Object.fromEntries(SECTIONS.map(name=>[name,0]));migrate(dataDir);}
  return storageFormat.decodeRevisions(readJson(revisionsFile(dataDir))).revisions;
}

function readRows(dataDir, name) {
  const sqlite = sqliteBackend(dataDir);
  if (sqlite) return sqlite.readRows(dataDir,name);
  if(!fs.existsSync(sectionFile(dataDir,name))&&schemaVersion(dataDir)===1){
    if(name==='documentDrafts')return [];
    if(!fs.existsSync(revisionsFile(dataDir))){const legacy=readJson(legacyFile(dataDir),null);if(legacy)return Array.isArray(legacy[name])?legacy[name]:[];}
    const versions=readJson(revisionsFile(dataDir),{});if(!Object.hasOwn(versions,name)&&!['vehicles','records'].includes(name))return [];
    if(['vehicles','records'].includes(name))throw Error('Неполный набор разделов. Отсутствует '+name+'. Восстановите базу из копии.');
  }
  const rows = readJson(sectionFile(dataDir, name));
  validateRows(name, rows);
  return rows;
}
function validateRows(name, rows) {
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('Раздел ' + name + ' должен содержать массив объектов');
}

// The same pure rules protect desktop saves and remote writes. A client cannot
// bypass the cost/procurement forms by submitting a malformed JSON section.
function validatePlanningChanges(previous, sections) {
  const next = { ...previous, ...sections };
  for (const name of ['costEntries', 'costProfiles']) {
    if (name in sections) require('../assets/js/45-cost-engine.js').validateSection(name, sections[name], next);
  }
  // Linked orders and their derived fulfillment are protected by the shared
  // semantic procurement policy. The old UI validator cannot validate them.
  for (const name of ['procurementRules']) {
    if (!(name in sections)) continue;
    require('../assets/js/47-procurement-engine.js').validateSection(name, sections[name], next);
    const oldRows = new Map((previous[name] || []).map(row => [row.id, row]));
    for (const row of sections[name]) {
      const old = oldRows.get(row.id);
      const item = (next[row.kind === 'tank' ? 'tanks' : 'parts'] || []).find(item => item.id === row.itemId);
      if (item?.archived && (!old || old.kind !== row.kind || old.itemId !== row.itemId)) {
        throw new Error('Новый заказ или правило нельзя привязать к архивной номенклатуре. Существующие заказы доступны для завершения.');
      }
    }
  }
}

// Run inside the existing database lock. First validate the submitted snapshot
// without rewriting it; only then replace untrusted authors/times with backend
// metadata. A forged quantity, source fingerprint or old event remains an error.
function prepareWriteoffSections(previous, sections, options = {}) {
  const oldRows = previous.fuelWriteoffs || [];
  const rows = Object.hasOwn(sections, 'fuelWriteoffs') ? sections.fuelWriteoffs : oldRows;
  if (!oldRows.length && !rows.length) return sections;
  const access = require('./access-control');
  const principal = options.principal || { id:'local-profile', name:'Локальный пользователь', role:'admin' };
  for (const name of SECTIONS.filter(name => Object.hasOwn(sections, name))) {
    if (JSON.stringify(previous[name] || []) === JSON.stringify(sections[name])) continue;
    if (!access.authorize(principal, 'write', name)&&!(name==='fuelPeriods'&&options.commandIntent?.command?.type==='PeriodAction'&&require('./period-access.cjs').canManage(principal,options.commandIntent.command.input?.scope))) throw new Error('Роль не разрешает изменение раздела: ' + name);
    access.validateAssetChanges(principal, name, previous[name] || [], sections[name]);
  }
  const documentSources = ['fuelWriteoffs', 'vehicles', 'records', 'fuelPurchases', 'fuelCards', 'monthlyFuel'];
  if (!documentSources.some(name => Object.hasOwn(sections, name) &&
    JSON.stringify(previous[name] || []) !== JSON.stringify(sections[name]))) return sections;
  const engine = require('../assets/core/writeoff-engine.js');
  const next = { ...previous, ...sections };
  engine.validateWriteoffChanges(previous, next);
  if (!Object.hasOwn(sections, 'fuelWriteoffs')) return sections;
  const oldById = new Map(oldRows.map(row => [row.id, row]));
  const at = options.now || new Date().toISOString();
  const actor = { id:principal.id, name:principal.name, role:principal.role };
  const canonical = rows.map(row => {
    const old = oldById.get(row.id);
    if (!old) {
      const withoutOwnDocument = { ...next, fuelWriteoffs:rows.filter(other => other.id !== row.id) };
      return engine.forVersion(4).post(withoutOwnDocument, { ...row.scope, date:row.date, basisNote:row.basisNote },
        { id:row.id, number:row.number, postedAt:at, postedBy:actor, expectedFingerprint:row.sourceFingerprint });
    }
    if (old.status === 'posted' && row.status === 'void')
      return engine.voidDocument(old, { voidedAt:at, voidedBy:actor, reason:row.voidReason });
    return row;
  });
  const result = { ...sections, fuelWriteoffs:canonical };
  engine.validateWriteoffChanges(previous, { ...previous, ...result });
  return result;
}

// Revisions are the commit point. Before that point a failed or interrupted
// multi-file save rolls back; after it recovery finishes the committed save.
function recoverTransaction(dataDir) {
  if (sqliteBackend(dataDir)) return;
  const journal = path.join(sectionsDir(dataDir), '.transaction.json');
  if (!fs.existsSync(journal)) return;
  const tx = readJson(journal);
  if(tx?.schemaVersion!==storageFormat.SCHEMA_VERSION){const error=new Error('Старая база содержит незавершённое сохранение. Восстановите её прежней версией программы перед созданием обновлённой копии.');error.code='SCHEMA_RECOVERY_REQUIRED';throw error;}
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const names = object(tx?.sections) ? Object.keys(tx.sections) : null;
  // Recover using the schema recorded by the interrupted transaction. New
  // optional sections are added by readRevisions only after recovery finishes.
  const revisionsValid = value => {try{return storageFormat.decodeRevisions(value).schemaVersion===storageFormat.SCHEMA_VERSION;}catch{return false;}};
  if (!tx || !names || !object(tx.before) ||
      names.some(n => !SECTIONS.includes(n) || !Array.isArray(tx.sections[n]) || !Object.hasOwn(tx.before, n) || tx.before[n] !== null && !Array.isArray(tx.before[n])) ||
      !revisionsValid(tx.revisions, ['vehicles', 'records', ...names]) ||
      tx.base !== null && !revisionsValid(tx.base, ['vehicles', 'records'])) throw new Error('Повреждён журнал сохранения');
  const committed = JSON.stringify(readJson(revisionsFile(dataDir), null)) === JSON.stringify(tx.revisions);
  const target = committed ? tx.sections : tx.before;
  Object.keys(tx.sections).forEach(name => {
    const file = sectionFile(dataDir, name), rows = target[name];
    if (rows === null) { if (fs.existsSync(file)) fs.unlinkSync(file); }
    else writeJsonAtomic(file, rows);
  });
  if (committed || tx.base !== null) writeJsonAtomic(revisionsFile(dataDir), committed ? tx.revisions : tx.base);
  else if (fs.existsSync(revisionsFile(dataDir))) fs.unlinkSync(revisionsFile(dataDir));
  fs.unlinkSync(journal);
}

function commitSections(dataDir, sections, revisions) {
  if (!Object.keys(sections).length) return;
  const sqlite = sqliteBackend(dataDir);
  if (sqlite) return sqlite.commitSections(dataDir,sections,revisions);
  const changed = Object.keys(sections);
  if (!changed.length) return;
  const journal = path.join(sectionsDir(dataDir), '.transaction.json');
  const before = Object.fromEntries(changed.map(n => [n, readJson(sectionFile(dataDir, n), null)]));
  const base = readJson(revisionsFile(dataDir), null);
  const encoded=storageFormat.encodeRevisions(revisions);
  writeJsonAtomic(journal, {schemaVersion:storageFormat.SCHEMA_VERSION, before, base, sections, revisions:encoded });
  try {
    changed.forEach(n => writeJsonAtomic(sectionFile(dataDir, n), sections[n]));
    writeJsonAtomic(revisionsFile(dataDir), encoded);
  } catch (e) {
    recoverTransaction(dataDir);
    throw e;
  }
  try { fs.unlinkSync(journal); } catch (e) { console.error('[storage] cleanup: ' + e.message); }
}

// PeriodPolicy, registered in the shared kernel, owns fuel/stock/finance
// cutoffs for every write path. Its fuel projection preserves the previous
// historical-opening guard and typed identity semantics.
function isSplit(dataDir) {
  if (sqliteBackend(dataDir)) return true;
  return fs.existsSync(revisionsFile(dataDir));
}

/**
 * Разложить старый data.json по разделам. Вызывается один раз: как только
 * появился revisions.json, миграция считается выполненной. Исходный файл не
 * удаляем и не трогаем — он остаётся резервной копией на случай отката.
 */
function migrate(dataDir) {
  if (sqliteBackend(dataDir)) return { migrated:false, reason:'SQLite: явный перенос уже выполнен' };
  recoverTransaction(dataDir);
  if (isSplit(dataDir)) return { migrated: false, reason: 'уже разделено' };
  if(schemaVersion(dataDir)===1)return {migrated:false,reason:'Старая база доступна только для чтения; обновление выполняется отдельной копией'};
  const legacy = legacyFile(dataDir);
  fs.mkdirSync(sectionsDir(dataDir), { recursive: true });

  const existing = SECTIONS.filter(n => fs.existsSync(sectionFile(dataDir, n)));
  if (existing.length && (!existing.includes('vehicles') || !existing.includes('records'))) throw new Error('Неполный набор разделов. Восстановите базу из резервной копии.');
  const data = !existing.length && fs.existsSync(legacy) ? readJson(legacy) : null;
  if (data && (!Array.isArray(data.vehicles) || !Array.isArray(data.records))) throw new Error('Некорректная старая база');
  const revisions = {};
  let records = 0;
  const sections = {};
  SECTIONS.forEach(name => {
    const arr = existing.includes(name) ? readRows(dataDir, name) : data && Array.isArray(data[name]) ? data[name] : [];
    validateRows(name, arr);
    sections[name] = arr;
    revisions[name] = existing.length ? Date.now() : 1;
    records += arr.length;
  });
  commitSections(dataDir, sections, revisions);

  if (data) {
    // Помечаем исходник, чтобы было видно: он больше не рабочий
    const marker = path.join(dataDir, 'data.json.before-split');
    try { if (!fs.existsSync(marker)) fs.copyFileSync(legacy, marker); } catch {}
  }
  return { migrated: true, sections: SECTIONS.length, records, hadLegacy: !!data };
}

/** Собрать все разделы в один объект — в том же виде, что раньше отдавал data.json */
function readAll(dataDir) {
  const sqlite = sqliteBackend(dataDir);
  if (sqlite) return sqlite.readAll(dataDir);
  recoverTransaction(dataDir);
  if (!isSplit(dataDir)) migrate(dataDir);
  readRevisions(dataDir);
  const out = {};
  SECTIONS.forEach(name => { out[name] = readRows(dataDir, name); });
  require('../assets/core/platform-contracts.js').validateSections(out,SECTIONS);
  return out;
}

/**
 * Записать данные, тронув только изменившиеся разделы.
 * Возвращает список записанных разделов и новые номера версий.
 */
function writeAll(dataDir, data, options = {}) {
  if (options.databaseToken != null && options.databaseToken !== databaseToken(dataDir)) throw new Error('База данных изменилась. Заново откройте её перед сохранением.');
  if (!data || !Array.isArray(data.vehicles) || !Array.isArray(data.records)) throw new Error('Неполная база: нужны vehicles и records');
  SECTIONS.forEach(n => { if (n in data) validateRows(n, data[n]); });
  const previous = readAll(dataDir);
  if (!isSplit(dataDir)) migrate(dataDir);
  const revisions = readRevisions(dataDir);
  const platform = require('./platform-service.cjs'), token = databaseToken(dataDir);
  if (options.replace === true) {
    // This is a trusted maintenance option, never a field accepted from HTTP.
    // It bypasses revision comparison only; domain rules and audit remain intact.
    if (!options.principal || !require('./access-control').authorize(options.principal, 'replace')) {
      const error = new Error('Явная замена базы разрешена только действующему администратору');
      error.code = 'REPLACE_ACCESS_DENIED'; error.status = 403; throw error;
    }
  }
  const operation = platform.operationInfo(previous, data, { ...options, databaseToken:token });
  // A confirmed command can be retried after its own commit advanced revisions.
  // Resolve it before CAS, just as writeSections does.
  if (operation?.receipt) return platform.filteredResult(platform.replayResult(previous, revisions, token, operation, Object.keys(data)),options.principal);
  assertWritable(dataDir);
  if (options.replace !== true && (options.requireBase || options.base !== undefined)) {
    const base = options.base;
    if (base === undefined) {
      const error = new Error('Для сохранения всей базы нужны исходные версии разделов. Загрузите базу заново.');
      error.code = 'BASE_REQUIRED'; error.status = 428; throw error;
    }
    if (!base || Object.prototype.toString.call(base) !== '[object Object]' ||
        Object.keys(base).some(name => !SECTIONS.includes(name) || !Number.isSafeInteger(base[name]) || base[name] < 0)) {
      const error = new Error('Некорректные исходные версии разделов');
      error.code = 'INVALID_BASE'; error.status = 400; throw error;
    }
    // A full snapshot may include unchanged sections without their base version.
    // Only actual application-data changes participate; history is server-owned.
    const candidates = SECTIONS.filter(name => name !== 'auditLog' && Object.hasOwn(data, name) &&
      JSON.stringify(previous[name]) !== JSON.stringify(data[name]));
    const missing = candidates.filter(name => !Object.hasOwn(base, name));
    if (missing.length) {
      const error = new Error('Не указаны исходные версии изменённых разделов: ' + missing.join(', '));
      error.code = 'BASE_REQUIRED'; error.status = 428; throw error;
    }
    const conflicts = candidates.filter(name => revisions[name] !== base[name]);
    if (conflicts.length) return { ok:false, conflicts, revisions, databaseToken:token };
  }
  const prepared = platform.prepareTransaction(previous, data, { ...options, databaseToken:token, revisions,
    prepareSections:sections => {
      const canonical = prepareWriteoffSections(previous, sections, options);
      validatePlanningChanges(previous, canonical); return canonical;
    } });
  if (prepared.replayed) return platform.filteredResult(platform.replayResult(previous, revisions, token, prepared.operation, Object.keys(data)),options.principal);
  data = prepared.sections;
  const changed = [];
  const sections = {};

  SECTIONS.forEach(name => {
    const next = name in data ? data[name] : previous[name];
    const file = sectionFile(dataDir, name);
    const nextRaw = JSON.stringify(next);
    let prevRaw = sqliteBackend(dataDir) ? JSON.stringify(previous[name]) : null;
    if (!sqliteBackend(dataDir)) try { prevRaw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null; } catch {}
    if (prevRaw === nextRaw) return;         // раздел не менялся — не трогаем
    sections[name] = next;
    revisions[name] = (revisions[name] || 0) + 1;
    changed.push(name);
  });

  if(changed.length&&options.beforeCommit!==undefined){if(typeof options.beforeCommit!=='function')throw Error('Ожидалась синхронная подготовка записи');const result=options.beforeCommit();if(result&&typeof result.then==='function')throw Error('Подготовка записи должна быть синхронной');}
  commitSections(dataDir, sections, revisions);
  return platform.filteredResult({ ok:true, changed, revisions, databaseToken:token, canonicalSections:sections,
    ...(prepared.operationReceipt ? { operationReceipt:prepared.operationReceipt } : {}) },options.principal);
}

/** Один раздел и его версия */
function readSection(dataDir, name,options={}) {
  if (!SECTIONS.includes(name)) throw new Error('Неизвестный раздел');
  recoverTransaction(dataDir);
  if (!isSplit(dataDir)) migrate(dataDir);
  const rows=readRows(dataDir,name),visible=options.principal?(require('./document-access.cjs').permitted(options.principal,'read',name)?require('./platform-service.cjs').visibleRows(name,rows,options.principal):[]):rows;
  return { name, rev: readRevisions(dataDir)[name] || 0, rows: visible, databaseToken: databaseToken(dataDir) };
}

function readSnapshot(dataDir,options={}) {
  let data = readAll(dataDir);
  if(options.principal)data=Object.fromEntries(SECTIONS.map(name=>[name,require('./document-access.cjs').permitted(options.principal,'read',name)?require('./platform-service.cjs').visibleRows(name,data[name],options.principal):[]]));
  const version=schemaVersion(dataDir);
  return { data, revisions: readRevisions(dataDir), databaseToken: databaseToken(dataDir), platform:{ apiVersion:1, operations:1,outbox:1,receiptQuery:1,commands:1,schemaVersion:version,documentDrafts:version>=2?1:0,periods:version>=2?1:0,fuelOperations:version>=2?1:0,procurement:version>=2?1:0,needsSchemaUpgrade:version<2 } };
}
function readOperation(dataDir,query,principal){
  const token=databaseToken(dataDir),audit=readSection(dataDir,'auditLog');
  return {ok:true,databaseToken:token,operationReceipt:require('./platform-service.cjs').findReceipt(audit.rows,query,principal,token)};
}

/**
 * Записать только переданные разделы — с проверкой версии.
 * base: { раздел: версия, от которой клиент вносил правки }. Если на диске
 * версия другая, значит раздел успел поменять кто-то ещё: ничего не пишем
 * и возвращаем список конфликтов — клиент сольёт правки и повторит.
 * Так правки двух людей не затирают друг друга молча.
 */
function writeSections(dataDir, payload, options = {}) {
  const token = databaseToken(dataDir);
  if (payload && payload.databaseToken != null && payload.databaseToken !== token) return { ok: false, databaseChanged: true, databaseToken: token, error: 'База данных изменилась. Заново откройте её перед сохранением.' };
  const previous = readAll(dataDir);
  if (!isSplit(dataDir)) migrate(dataDir);
  const base = (payload && payload.base) || {};
  let sections = (payload && payload.sections) || {};
  const names = Object.keys(sections);
  if (names.some(n => !SECTIONS.includes(n) || !Array.isArray(sections[n]))) throw new Error('Некорректные разделы');
  names.forEach(n => validateRows(n, sections[n]));
  const revisions = readRevisions(dataDir);
  const platform = require('./platform-service.cjs');
  const context = { ...options, operation:payload?.operation || options.operation, base, revisions, databaseToken:token };
  const operation = platform.operationInfo(previous, sections, context);
  if (operation?.receipt) return platform.filteredResult(platform.replayResult(previous, revisions, token, operation, names),options.principal);
  assertWritable(dataDir);
  const conflicts = names.filter(n => (revisions[n] || 0) !== (base[n] || 0));
  if (conflicts.length) return { ok: false, conflicts, revisions, databaseToken: token };
  const prepared = platform.prepareTransaction(previous, sections, { ...context,
    prepareSections:supplied => {
      const canonical = prepareWriteoffSections(previous, supplied, options);
      validatePlanningChanges(previous, canonical); return canonical;
    } });
  sections = prepared.sections;
  const changed = [];
  const pending = {};
  Object.keys(sections).forEach(name => {
    const next = Array.isArray(sections[name]) ? sections[name] : [];
    const file = sectionFile(dataDir, name);
    const nextRaw = JSON.stringify(next);
    let prevRaw = sqliteBackend(dataDir) ? JSON.stringify(previous[name]) : null;
    if (!sqliteBackend(dataDir)) try { prevRaw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null; } catch {}
    if (prevRaw === nextRaw) return;
    pending[name] = next;
    revisions[name] = (revisions[name] || 0) + 1;
    changed.push(name);
  });
  // Trusted maintenance hooks run only for a new, fully validated commit. A
  // replay, conflict or refused command must not create a backup as a side effect.
  if (changed.length && options.beforeCommit !== undefined) {
    if (typeof options.beforeCommit !== 'function') throw new Error('Ожидалась синхронная подготовка записи');
    const preparedCommit = options.beforeCommit();
    if (preparedCommit && typeof preparedCommit.then === 'function') throw new Error('Подготовка записи должна быть синхронной');
  }
  commitSections(dataDir, pending, revisions);
  return platform.filteredResult({ ok: true, changed, revisions, databaseToken: token,
    canonicalSections:pending, ...(prepared.operationReceipt ? { operationReceipt:prepared.operationReceipt } : {}) },options.principal);
}

/** Ежедневная резервная копия: складываем разделы обратно в один файл */
function makeDailyBackup(dataDir, backupDir, keepDays) {
  if(schemaVersion(dataDir)<storageFormat.SCHEMA_VERSION)return null;
  if (!isSplit(dataDir)) return null;
  const today = new Date().toISOString().slice(0, 10);
  const dest = path.join(backupDir, 'data_' + today + '.json');
  if (fs.existsSync(dest)) return null;
  fs.mkdirSync(backupDir, { recursive: true });
  writeJsonAtomic(dest, readAll(dataDir));
  const list = fs.readdirSync(backupDir)
    .filter(f => f.startsWith('data_') && f.endsWith('.json')).sort();
  const keep = keepDays || 30;
  if (list.length > keep) {
    list.slice(0, list.length - keep).forEach(f => {
      try { fs.unlinkSync(path.join(backupDir, f)); } catch {}
    });
  }
  return dest;
}

module.exports = {
  SECTIONS, sectionsDir, sectionFile, revisionsFile,schemaVersion,assertWritable,encodeRevisions:storageFormat.encodeRevisions,
  databaseToken, withDatabaseLock, validateRows, prepareWriteoffSections,
  executeCommand:(dataDir,envelope,options)=>require('./command-service.cjs').execute(dataDir,envelope,options),
  ...Object.fromEntries(Object.entries({ isSplit, migrate, readAll, writeAll, readRevisions, makeDailyBackup, readSection, writeSections, readSnapshot,readOperation }).map(([name, operation]) => [name, (dataDir, ...args) => withDatabaseLock(dataDir, () => {
    const sqlite = sqliteBackend(dataDir), action = () => operation(dataDir,...args);
    if (!sqlite || ['isSplit','migrate'].includes(name)) return action();
    return sqlite.transaction(dataDir,action,{ readOnly:!['writeAll','writeSections'].includes(name)||sqlite.schemaVersion(dataDir)<storageFormat.SCHEMA_VERSION });
  })])),
};
