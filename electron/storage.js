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
  // A crash during the very first current-format commit may leave section
  // files but no revision commit point. Only its explicit empty-before journal
  // identifies a new database; it never authorizes recovery of old data.json.
  const initialJournal=path.join(sectionsDir(dataDir),'.transaction.json');
  if(!fs.existsSync(legacyFile(dataDir))&&fs.existsSync(initialJournal)){
    const tx=readJson(initialJournal);
    if(tx?.schemaVersion===storageFormat.SCHEMA_VERSION&&tx.base===null&&tx.before&&Object.keys(tx.before).length===SECTIONS.length&&SECTIONS.every(name=>Object.hasOwn(tx.before,name)&&tx.before[name]===null)&&((tx.version===2&&tx.initial===true)||(tx.version===undefined&&storageFormat.decodeRevisions(tx.revisions).schemaVersion===storageFormat.SCHEMA_VERSION)))return storageFormat.SCHEMA_VERSION;
  }
  if(fs.existsSync(sectionFile(dataDir,'documentDrafts')))throw Object.assign(new Error('Повреждены версии новой базы. Восстановите их из копии; автоматическое создание запрещено.'),{code:'STORAGE_REVISIONS'});
  if(fs.existsSync(legacyFile(dataDir))){const legacy=readJson(legacyFile(dataDir));if(Array.isArray(legacy?.documentDrafts)&&legacy.documentDrafts.length)throw Object.assign(new Error('Неверсионированный файл содержит новые документы. Восстановите его в отдельную базу из резервного пакета; документы не были скрыты или удалены.'),{code:'STORAGE_FORMAT'});}
  return fs.existsSync(legacyFile(dataDir))||storageFormat.legacySections().some(name=>fs.existsSync(sectionFile(dataDir,name)))?1:storageFormat.SCHEMA_VERSION;
}
function assertWritable(dataDir,options={}){if(!storageFormat.isCurrent(schemaVersion(dataDir)))storageFormat.upgradeRequired();storageFormat.assertWriter(options);}
function assertWriteCompatibility(dataDir,options={},requiredCapability){if(options.requireNegotiatedWriter!==true)return null;return require('./write-proof.cjs').assertWriteCompatibility(options,{databaseToken:databaseToken(dataDir),principal:options.getPrincipal?options.getPrincipal():options.principal,descriptor:descriptor(dataDir),requiredCapability});}
function hasWriteCompatibility(dataDir,options={},requiredCapability){if(options.requireNegotiatedWriter!==true)return true;try{assertWriteCompatibility(dataDir,options,requiredCapability);return true;}catch{return false;}}
function descriptor(dataDir){const sql=sqliteBackend(dataDir);return sql?sql.readDescriptor(dataDir):fs.existsSync(revisionsFile(dataDir))?storageFormat.decodeRevisions(readJson(revisionsFile(dataDir))).descriptor:storageFormat.describe(schemaVersion(dataDir));}
function canonicalDirectory(dataDir) {
  const resolved = fs.realpathSync(path.resolve(dataDir));
  return runtimeProcess.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
function databaseToken(dataDir) {
  return withDatabaseLock(dataDir,physical=>{
    dataDir=physical;
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
  // Reading an older schema must not create or recover a lock, identity, WAL,
  // transaction journal or any other file in the original directory.
  if(fs.existsSync(dataDir)&&schemaVersion(dataDir)<storageFormat.SCHEMA_VERSION){
    const physical=fs.realpathSync(path.resolve(dataDir)),key=runtimeProcess.platform==='win32'?physical.toLowerCase():physical;if(heldLocks.has(key))return action(physical);
    const locks=['.tvs-database.lock','.tvs-database.lock.recovery'];if(locks.some(name=>fs.existsSync(path.join(key,name))))throw lockError(path.join(key,locks[0]),'Старая база открыта другим процессом; изменение её блокировок запрещено.');
    const files=sqliteBackend(dataDir)?['platform.sqlite','platform.sqlite-wal','platform.sqlite-shm']:['data.json','database-identity.json',...SECTIONS.map(name=>path.join('sections',name+'.json')),path.join('sections',REVISIONS_FILE),path.join('sections','.transaction.json')];
    const stamp=()=>JSON.stringify(files.map(name=>{const target=path.join(dataDir,name);try{const info=fs.lstatSync(target);if(!info.isFile()||info.isSymbolicLink())throw Error('Недопустимый исходный файл старой базы');return [name,info.size,crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex')];}catch(error){if(error.code==='ENOENT')return [name,null];throw error;}}));
    const before=stamp();heldLocks.set(key,{readOnly:true});try{const result=action(physical);if(result&&typeof result.then==='function')throw Error('Чтение старой базы должно быть синхронным');if(stamp()!==before)throw Object.assign(Error('Старая база изменилась во время чтения'),{code:'SCHEMA_SOURCE_CHANGED'});return result;}finally{heldLocks.delete(key);}
  }
  fs.mkdirSync(dataDir, { recursive: true });
  const physical=fs.realpathSync(path.resolve(dataDir)),key=runtimeProcess.platform==='win32'?physical.toLowerCase():physical;
  if (heldLocks.has(key)) return action(physical);
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
    const result = action(physical);
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
    if (!access.authorize(principal, 'write', name)&&!(name==='fuelPeriods'&&options.commandIntent?.command?.type==='PeriodAction'&&require('./period-access.cjs').canManage(principal,options.commandIntent.command.input?.scope))&&!(options.commandIntent?.command?.type==='CostAction'&&options.commandIntent.command.input?.action==='savePolicy'&&options.commandIntent.command.input.target?.section===name&&access.costActions(principal).includes('savePolicy'))) throw new Error('Роль не разрешает изменение раздела: ' + name);
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
  if(schemaVersion(dataDir)<storageFormat.SCHEMA_VERSION)throw Object.assign(Error('В старой базе обнаружено незавершённое сохранение; используйте прежнюю программу для восстановления перед копированием.'),{code:'SCHEMA_RECOVERY_REQUIRED'});
  const managed=require('./operation-store.cjs').managedFiles(path.resolve(dataDir)),snapshot=managed.read(journal,192*1024*1024),tx=JSON.parse(snapshot.bytes.toString('utf8'));
  if(tx?.version===2)return recoverCurrentTransaction(dataDir,managed,snapshot,tx);
  // Schema 4 has never used the old unbound repair format. A legacy journal
  // must be recovered by its original writer before the separate copy upgrade.
  throw Object.assign(Error('Не поддерживается журнал восстановления этой базы'),{code:'SCHEMA_RECOVERY_REQUIRED'});
}

function commitSections(dataDir, sections, revisions, options={}) {
  assertWritable(dataDir);
  const sqlite = sqliteBackend(dataDir);
  if (sqlite) return sqlite.commitSections(dataDir,sections,revisions,options);
  const store=require('./operation-store.cjs'),managed=store.managedFiles(path.resolve(dataDir)),changed=Object.keys(sections),journal=path.join(sectionsDir(dataDir),'.transaction.json'),base=managed.read(revisionsFile(dataDir)),before={},after={},current={};
  if(changed.some(name=>!SECTIONS.includes(name)))throw Object.assign(Error('Неизвестный раздел сохранения'),{code:'STORAGE_TRANSACTION'});
  managed.verifyDirectory(sectionsDir(dataDir),true);
  for(const name of changed){validateRows(name,sections[name]);current[name]=managed.read(sectionFile(dataDir,name),64*1024*1024);before[name]=current[name]?.bytes.toString('base64')??null;after[name]=Buffer.from(JSON.stringify(sections[name])).toString('base64');}
  let operation,operationState;
  if(options.initialSeed){
    if(base||fs.existsSync(legacyFile(dataDir))||changed.length!==SECTIONS.length||Object.values(before).some(value=>value!==null))throw Object.assign(Error('Инициализация разрешена только новой базе'),{code:'OPERATION_INITIALIZE'});
    const seed=store.validateSeed({operationState:options.initialSeed.operationState,operationObjects:options.initialSeed.objects,hotRows:sections.auditLog});store.putObjects(dataDir,seed.objects);operationState=seed.operationState;operation={objects:seed.objects.map(object=>object.id)};
  }else{
    if(!base)throw Object.assign(Error('Отсутствует состояние текущей базы'),{code:'OPERATION_STATE_MISSING'});
    const previousHotRows=changed.includes('auditLog')?JSON.parse(Buffer.from(before.auditLog,'base64')):readRows(dataDir,'auditLog'),plan=store.validateCommit(dataDir,{expectedOperationState:options.expectedOperationState??store.readState(dataDir),nextOperationState:options.nextOperationState??storageFormat.createOperationState(store.readState(dataDir).head),operationPlans:options.operationPlans??[]},{previousHotRows,nextHotRows:sections.auditLog??previousHotRows});store.putObjects(dataDir,plan.objects);operation=plan.reference;operationState=plan.nextOperationState;
  }
  const encoded=Buffer.from(JSON.stringify(storageFormat.encodeRevisions(revisions,storageFormat.describe(4),operationState))),tx={version:2,schemaVersion:4,initial:!!options.initialSeed,before,after,base:base?.bytes.toString('base64')??null,next:encoded.toString('base64'),operation},journalBytes=Buffer.from(JSON.stringify(tx));
  const journalSnapshot=managed.atomic(journal,journalBytes,null,192*1024*1024);
  try {
    // Revalidate the complete durable intent before the first business change.
    validateCurrentTransaction(dataDir,managed,journalSnapshot,tx);
    changed.forEach(name=>managed.atomic(sectionFile(dataDir,name),Buffer.from(after[name],'base64'),current[name],64*1024*1024));
    managed.atomic(revisionsFile(dataDir),encoded,base);
  } catch (e) {
    recoverTransaction(dataDir);
    throw e;
  }
  managed.unlink(journal,journalSnapshot,192*1024*1024);
  if(sections.auditLog)require('./platform-service.cjs').bindHistory({auditLog:sections.auditLog},dataDir);
}

function transactionFailure(){throw Object.assign(Error('Журнал сохранения или файлы базы изменены. Автоматическое восстановление остановлено.'),{code:'STORAGE_TRANSACTION',status:409});}
function journalBytes(value,nullable=false){if(value===null&&nullable)return null;if(typeof value!=='string'||value.length>256*1024*1024||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))transactionFailure();const bytes=Buffer.from(value,'base64');if(bytes.toString('base64')!==value)transactionFailure();return bytes;}
function validateCurrentTransaction(dataDir,managed,snapshot,tx){
  const object=value=>value&&typeof value==='object'&&!Array.isArray(value),keys=value=>Object.keys(value).sort().join('|');
  if(!object(tx)||keys(tx)!==['version','schemaVersion','initial','before','after','base','next','operation'].sort().join('|')||tx.version!==2||tx.schemaVersion!==4||typeof tx.initial!=='boolean'||!object(tx.before)||!object(tx.after)||keys(tx.before)!==keys(tx.after)||Object.keys(tx.before).some(name=>!SECTIONS.includes(name)))transactionFailure();
  const before={},after={},files={},base=journalBytes(tx.base,true),next=journalBytes(tx.next),decode=bytes=>{const value=storageFormat.decodeRevisions(JSON.parse(bytes));if(value.schemaVersion!==4)transactionFailure();return value;},nextDecoded=decode(next),baseDecoded=base?decode(base):null;
  for(const name of Object.keys(tx.before)){before[name]=journalBytes(tx.before[name],true);after[name]=journalBytes(tx.after[name]);for(const bytes of [before[name],after[name]])if(bytes!==null){if(bytes.length>64*1024*1024)transactionFailure();validateRows(name,JSON.parse(bytes));}files[name]=managed.read(sectionFile(dataDir,name),64*1024*1024);const bytes=files[name]?.bytes??null;if(!(bytes===null&&before[name]===null)&&!bytes?.equals(before[name]??Buffer.alloc(0))&&!bytes?.equals(after[name]))transactionFailure();}
  const revisionSnapshot=managed.read(revisionsFile(dataDir)),actual=revisionSnapshot?.bytes??null,committed=!!actual?.equals(next);if(!committed&&!(actual===null&&base===null)&&!actual?.equals(base??Buffer.alloc(0)))transactionFailure();
  const store=require('./operation-store.cjs');
  if(tx.initial){if(base!==null||fs.existsSync(legacyFile(dataDir))||Object.keys(before).length!==SECTIONS.length||Object.values(before).some(value=>value!==null)||!object(tx.operation)||keys(tx.operation)!=='objects'||!Array.isArray(tx.operation.objects))transactionFailure();const objects=tx.operation.objects.map(id=>{const bytes=store.readObject(dataDir,id);if(!bytes)transactionFailure();return {id,json:bytes.toString('utf8')};});store.validateSeed({operationState:nextDecoded.operationState,operationObjects:objects,hotRows:JSON.parse(after.auditLog)});}
  else{if(!baseDecoded||!object(tx.operation)||JSON.stringify(baseDecoded.operationState)!==JSON.stringify(tx.operation.expectedOperationState)||JSON.stringify(nextDecoded.operationState)!==JSON.stringify(tx.operation.nextOperationState))transactionFailure();const hot=managed.read(sectionFile(dataDir,'auditLog'),64*1024*1024);if(!hot)transactionFailure();store.validateCommit(dataDir,tx.operation,{previousHotRows:JSON.parse(before.auditLog??hot.bytes),nextHotRows:JSON.parse(after.auditLog??hot.bytes),recovery:true});}
  managed.assertFile(path.join(sectionsDir(dataDir),'.transaction.json'),snapshot,192*1024*1024);
  return {before,after,files,base,next,committed,revisionSnapshot};
}
function recoverCurrentTransaction(dataDir,managed,snapshot,tx){
  const checked=validateCurrentTransaction(dataDir,managed,snapshot,tx),target=checked.committed?checked.after:checked.before;
  // All bytes and object references were checked before any recovery mutation.
  for(const [name,bytes]of Object.entries(target)){const current=checked.files[name];if(bytes===null){if(current)managed.unlink(sectionFile(dataDir,name),current,64*1024*1024);}else if(!current?.bytes.equals(bytes))managed.atomic(sectionFile(dataDir,name),bytes,current,64*1024*1024);}
  const revisions=checked.committed?checked.next:checked.base;if(revisions===null){if(checked.revisionSnapshot)managed.unlink(revisionsFile(dataDir),checked.revisionSnapshot);}else if(!checked.revisionSnapshot?.bytes.equals(revisions))managed.atomic(revisionsFile(dataDir),revisions,checked.revisionSnapshot);
  managed.unlink(path.join(sectionsDir(dataDir),'.transaction.json'),snapshot,192*1024*1024);
}

// Explicit trusted NEW-target initializer. It validates JSON structure but does
// not reinterpret or repair old domain facts through a new-transaction planner.
function createJson(dataDir,input){
  if(!input||typeof input!=='object'||Array.isArray(input)||!input.data||typeof input.data!=='object'||Array.isArray(input.data)||Object.keys(input.data).some(name=>!SECTIONS.includes(name)))throw Object.assign(Error('Для создания нужны исходные разделы базы'),{code:'JSON_CREATE'});
  const safe=require('./safe-file.cjs'),store=require('./operation-store.cjs'),location=path.resolve(dataDir),parent=safe.verifiedDirectory(path.dirname(location)),descriptor=storageFormat.validateDescriptor(input.descriptor??storageFormat.describe(4),4),identity=require('./database-identity.cjs').validate(input.identity??{format:'tvs-database-identity',version:1,uuid:crypto.randomUUID(),generation:1});
  const data=require('../assets/core/platform-contracts.js').validateSections(Object.fromEntries(SECTIONS.map(name=>[name,Object.hasOwn(input.data,name)?input.data[name]:[]])),SECTIONS),raw=input.revisions??{};
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(name=>!SECTIONS.includes(name))||Object.values(raw).some(value=>!Number.isSafeInteger(value)||value<0))throw Object.assign(Error('Некорректные исходные версии разделов'),{code:'JSON_CREATE'});
  const revisions=Object.fromEntries(SECTIONS.map(name=>[name,raw[name]??0])),provided=Object.hasOwn(input,'operationState')||Object.hasOwn(input,'operationObjects'),seed=provided?store.validateSeed({operationState:input.operationState,operationObjects:input.operationObjects,hotRows:data.auditLog}):store.bootstrap({auditRows:data.auditLog});data.auditLog=seed.hotRows;
  safe.assertDirectory(parent);if(fs.existsSync(location)){safe.verifiedDirectory(location);if(fs.readdirSync(location).length)throw Object.assign(Error('База создаётся только в новом или пустом отдельном каталоге'),{code:'JSON_TARGET_NOT_EMPTY'});}else fs.mkdirSync(location,{mode:0o700});
  const files=store.managedFiles(location);store.putObjects(location,seed.objects);files.atomic(path.join(location,'database-identity.json'),Buffer.from(JSON.stringify(identity)),null,4096);files.verifyDirectory(path.join(location,'sections'),true);
  for(const name of SECTIONS)files.atomic(sectionFile(location,name),Buffer.from(JSON.stringify(data[name])),null,64*1024*1024);
  files.atomic(revisionsFile(location),Buffer.from(JSON.stringify(storageFormat.encodeRevisions(revisions,descriptor,seed.operationState))),null);return {ok:true,path:location,schemaVersion:4,descriptor,identity};
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
  if(schemaVersion(dataDir)<storageFormat.SCHEMA_VERSION)return {migrated:false,reason:'Старая база доступна только для чтения; обновление выполняется отдельной копией'};
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
  const seed=require('./operation-store.cjs').bootstrap({auditRows:sections.auditLog});sections.auditLog=seed.hotRows;
  commitSections(dataDir, sections, revisions,{initialSeed:seed});

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
  if(schemaVersion(dataDir)===4){require('./operation-store.cjs').validateHot(dataDir,out.auditLog);require('./platform-service.cjs').bindHistory(out,dataDir);}
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
  const historyInputSections=Object.keys(data);
  const previous = readAll(dataDir);
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
  if (operation?.receipt) return platform.filteredResult(platform.replayResult(previous, revisions, token, operation, Object.keys(data)),options.principal,previous);
  assertWriteCompatibility(dataDir,options);
  if(options.requireNegotiatedWriter===true&&(typeof options.databaseToken!=='string'||!options.databaseToken))throw Object.assign(Error('Для записи нужен явный идентификатор прочитанной базы'),{code:'DATABASE_TOKEN_REQUIRED',status:428});
  require('./document-archive.cjs').validateState(dataDir,previous);
  assertWritable(dataDir,options);
  if (!isSplit(dataDir)) migrate(dataDir);
  if (options.replace !== true && (options.requireNegotiatedWriter===true || options.requireBase || options.base !== undefined)) {
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
    // Modern full writes must name every supplied base, even unchanged rows.
    const candidates = SECTIONS.filter(name => Object.hasOwn(data, name) && (options.requireNegotiatedWriter===true || name !== 'auditLog' && JSON.stringify(previous[name]) !== JSON.stringify(data[name])));
    if(candidates.some(name=>name==='dispatchJobs'||name==='workOrders')){
      if(!Object.hasOwn(base,'appMeta')){const error=new Error('Для сохранения интервала нужна исходная версия рабочего календаря. Загрузите базу заново.');error.code='CALENDAR_CONTEXT_REQUIRED';error.status=428;throw error;}
      if(!candidates.includes('appMeta'))candidates.push('appMeta');
    }
    const missing = candidates.filter(name => !Object.hasOwn(base, name));
    if (missing.length) {
      const error = new Error('Не указаны исходные версии изменённых разделов: ' + missing.join(', '));
      error.code = 'BASE_REQUIRED'; error.status = 428; throw error;
    }
    const conflicts = candidates.filter(name => revisions[name] !== base[name]);
    if (conflicts.length) return { ok:false, conflicts, revisions, databaseToken:token };
  }
  let prepared = platform.prepareTransaction(previous, data, { ...options,dataDir, databaseToken:token, revisions,
    prepareSections:sections => {
      const canonical = prepareWriteoffSections(previous, sections, options);
      validatePlanningChanges(previous, canonical); return canonical;
    } });
  if (prepared.replayed) return platform.filteredResult(platform.replayResult(previous, revisions, token, prepared.operation, Object.keys(data)),options.principal,previous);
  prepared=require('./document-archive.cjs').prepareCommit(dataDir,previous,prepared,options);
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

  const history=sections.auditLog?platform.prepareHistoryCommit(dataDir,previous,sections,revisions,{...options,historyInputSections}):{sections};
  if(changed.length&&options.beforeCommit!==undefined){if(typeof options.beforeCommit!=='function')throw Error('Ожидалась синхронная подготовка записи');const result=options.beforeCommit();if(result&&typeof result.then==='function')throw Error('Подготовка записи должна быть синхронной');}
  if(changed.length||history.nextOperationState)commitSections(dataDir, history.sections, revisions,history);
  return platform.filteredResult({ ok:true, changed, revisions, databaseToken:token, canonicalSections:history.sections,
    ...(prepared.archiveHeadChanged?{archiveHeadChanged:true}:{}),...(prepared.archive?{archive:prepared.archive}:{}),
    ...(prepared.operationReceipt ? { operationReceipt:prepared.operationReceipt } : {}) },options.principal,{...previous,...sections});
}

/** Один раздел и его версия */
function readSection(dataDir, name,options={}) {
  if (!SECTIONS.includes(name)) throw new Error('Неизвестный раздел');
  recoverTransaction(dataDir);
  if (!isSplit(dataDir)) migrate(dataDir);
  const database=options.principal?readAll(dataDir):null,rows=database?database[name]:readRows(dataDir,name),revisions=readRevisions(dataDir),platform=require('./platform-service.cjs');
  const allowed=!options.principal||require('./document-access.cjs').permitted(options.principal,'read',name);
  const visible=options.principal?(allowed?platform.visibleRows(name,rows,options.principal,database):[]):rows;
  return {name,rev:allowed?revisions[name]||0:0,rows:visible,databaseToken:databaseToken(dataDir),...(options.principal?{scopeViews:platform.scopeViews(database,revisions,options.principal,[name])}:{})};
}

function readSnapshot(dataDir,options={}) {
  const database=readAll(dataDir),revisions=readRevisions(dataDir),platform=require('./platform-service.cjs');
  require('./document-archive.cjs').validateState(dataDir,database);
  const data=options.principal?Object.fromEntries(SECTIONS.map(name=>[name,require('./document-access.cjs').permitted(options.principal,'read',name)?platform.visibleRows(name,database[name],options.principal,database):[]])):database;
  const version=schemaVersion(dataDir);
  return {data,revisions:options.principal?Object.fromEntries(SECTIONS.map(name=>[name,require('./document-access.cjs').permitted(options.principal,'read',name)?revisions[name]:0])):revisions,databaseToken:databaseToken(dataDir),...(options.principal?{scopeViews:platform.scopeViews(database,revisions,options.principal)}:{}),platform:{apiVersion:1,operations:1,outbox:1,receiptQuery:1,commands:1,...(require('./access-context.cjs').hasNarrowing(options.principal)?{scopedAccess:1}:{}),schemaVersion:version,currentSchemaVersion:storageFormat.SCHEMA_VERSION,descriptor:descriptor(dataDir),readOnly:version<storageFormat.SCHEMA_VERSION,documentDrafts:version>=2?1:0,periods:version>=2?1:0,fuelOperations:version>=2?1:0,procurement:version>=2?1:0,costAccounting:version>=2?1:0,repairs:version>=2?1:0,calendar:version>=2?1:0,personnelPlanning:version>=2?1:0,documentPrint:version>=2?1:0,controlledImports:version>=2?1:0,needsSchemaUpgrade:version<storageFormat.SCHEMA_VERSION}};
}
function readOperation(dataDir,query,principal){
  if(schemaVersion(dataDir)===4)return require('./platform-service.cjs').readReceipt(dataDir,query,principal);
  const token=databaseToken(dataDir),database=readAll(dataDir);
  return {ok:true,databaseToken:token,operationReceipt:require('./platform-service.cjs').findReceipt(database.auditLog,query,principal,token,database)};
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
  const base = (payload && payload.base) || {};
  let sections = (payload && payload.sections) || {};
  const names = Object.keys(sections);
  if (names.some(n => !SECTIONS.includes(n) || !Array.isArray(sections[n]))) throw new Error('Некорректные разделы');
  names.forEach(n => validateRows(n, sections[n]));
  const revisions = readRevisions(dataDir);
  const platform = require('./platform-service.cjs');
  const context = { ...options,dataDir, operation:payload?.operation || options.operation, scopeViews:payload?.scopeViews||options.scopeViews, base, revisions, databaseToken:token };
  const operation = platform.operationInfo(previous, sections, context);
  if (operation?.receipt) return platform.filteredResult(platform.replayResult(previous, revisions, token, operation, names),options.principal,previous);
  assertWriteCompatibility(dataDir,options);
  require('./document-archive.cjs').validateState(dataDir,previous);
  assertWritable(dataDir,options);
  if (!isSplit(dataDir)) migrate(dataDir);
  if(options.requireNegotiatedWriter===true){if(!payload||typeof payload.databaseToken!=='string'||!payload.databaseToken)throw Object.assign(Error('Для записи нужен явный идентификатор прочитанной базы'),{code:'DATABASE_TOKEN_REQUIRED',status:428});if(!payload.base||Object.prototype.toString.call(payload.base)!=='[object Object]'||Object.keys(payload.base).some(name=>!SECTIONS.includes(name)||!Number.isSafeInteger(payload.base[name])||payload.base[name]<0))throw Object.assign(Error('Нужны явные исходные версии разделов'),{code:'INVALID_BASE',status:400});if(names.some(name=>!Object.hasOwn(payload.base,name)))throw Object.assign(Error('Не указаны исходные версии переданных разделов'),{code:'BASE_REQUIRED',status:428});}
  const calendarRead=names.some(name=>(name==='dispatchJobs'||name==='workOrders')&&JSON.stringify(previous[name])!==JSON.stringify(sections[name]));
  if(calendarRead&&(!Object.hasOwn(base,'appMeta')||!Number.isSafeInteger(base.appMeta)||base.appMeta<0)){const error=new Error('Для сохранения интервала нужна исходная версия рабочего календаря. Загрузите базу заново.');error.code='CALENDAR_CONTEXT_REQUIRED';error.status=428;throw error;}
  const conflicts = [...new Set([...names,...(calendarRead?['appMeta']:[])])].filter(n => (revisions[n] || 0) !== (base[n] || 0));
  if (conflicts.length) return { ok: false, conflicts, revisions, databaseToken: token };
  let prepared = platform.prepareTransaction(previous, sections, { ...context,
    prepareSections:supplied => {
      const canonical = prepareWriteoffSections(previous, supplied, options);
      validatePlanningChanges(previous, canonical); return canonical;
    } });
  prepared=require('./document-archive.cjs').prepareCommit(dataDir,previous,prepared,options);
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
  const history=pending.auditLog?platform.prepareHistoryCommit(dataDir,previous,pending,revisions,{...context,historyInputSections:names}):{sections:pending};
  // Trusted maintenance hooks run only for a new, fully validated commit. A
  // replay, conflict or refused command must not create a backup as a side effect.
  if (changed.length && options.beforeCommit !== undefined) {
    if (typeof options.beforeCommit !== 'function') throw new Error('Ожидалась синхронная подготовка записи');
    const preparedCommit = options.beforeCommit();
    if (preparedCommit && typeof preparedCommit.then === 'function') throw new Error('Подготовка записи должна быть синхронной');
  }
  if(changed.length||history.nextOperationState)commitSections(dataDir, history.sections, revisions,history);
  return platform.filteredResult({ ok: true, changed, revisions, databaseToken: token,
    canonicalSections:pending,...(prepared.archiveHeadChanged?{archiveHeadChanged:true}:{}),...(prepared.archive?{archive:prepared.archive}:{}), ...(prepared.operationReceipt ? { operationReceipt:prepared.operationReceipt } : {}) },options.principal,{...previous,...pending});
}

function archiveHistory(dataDir,input,options={}){
  const principal=options.getPrincipal?options.getPrincipal():options.principal,access=require('./access-context.cjs');
  const broad=principal&&['readable','writable'].every(key=>principal[key]===undefined||principal[key]===null||Array.isArray(principal[key])&&principal[key].includes('*'));
  if(!principal||principal.role!=='admin'||!broad||access.hasNarrowing(principal))throw Object.assign(Error('Архивация истории разрешена действующему администратору без ограничений доступа'),{code:'ACCESS_DENIED',status:403});
  assertWritable(dataDir,options);assertWriteCompatibility(dataDir,{...options,principal});
  const token=databaseToken(dataDir),store=require('./operation-store.cjs'),state=store.readState(dataDir);
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['databaseToken','expectedTransactionId','throughSeq'].includes(key))||input.databaseToken!==token)throw Object.assign(Error('База данных изменилась'),{code:'DATABASE_CHANGED',status:409});
  if(input.expectedTransactionId!==state.transactionId)throw Object.assign(Error('История изменилась; перечитайте состояние перед архивацией'),{code:'OPERATION_STATE_CONFLICT',status:409});
  if(!Number.isSafeInteger(input.throughSeq)||input.throughSeq<0||input.throughSeq>state.head.lastSeq)throw Object.assign(Error('Некорректная граница архивации'),{code:'HISTORY_RANGE',status:400});
  const before=readAll(dataDir),revisions=readRevisions(dataDir),plan=store.prepareCommit(dataDir,{expectedOperationState:state,previousHotRows:before.auditLog,archiveThroughSeq:input.throughSeq}),changed=JSON.stringify(before.auditLog)!==JSON.stringify(plan.hotRows),sections=changed?{auditLog:plan.hotRows}:{};
  if(changed)revisions.auditLog++;
  if(options.beforeCommit!==undefined){if(typeof options.beforeCommit!=='function')throw Error('Ожидалась синхронная подготовка записи');if(options.beforeCommit()?.then)throw Error('Подготовка записи должна быть синхронной');}
  commitSections(dataDir,sections,revisions,plan);
  return require('./platform-service.cjs').filteredResult({ok:true,databaseToken:token,revisions,canonicalSections:{auditLog:plan.hotRows}},principal,{...before,auditLog:plan.hotRows});
}

function commitPrintArtifact(dataDir,input,options={}){
  return withDatabaseLock(dataDir,physical=>{
    dataDir=physical;
    const sql=sqliteBackend(dataDir),readOnly=schemaVersion(dataDir)<storageFormat.SCHEMA_VERSION||options.requireWriterSchema===true&&options.writerSchemaVersion!==storageFormat.SCHEMA_VERSION||!hasWriteCompatibility(dataDir,options,'documentPrint');
    const action=()=>require('./document-archive.cjs').commitArtifact(dataDir,input,options,(directory,sections,revisions)=>{
      const previous=readAll(directory),history=require('./platform-service.cjs').prepareHistoryCommit(directory,previous,sections,revisions,options);commitSections(directory,history.sections,revisions,history);
    });
    const result=sql?sql.transaction(dataDir,action,{readOnly}):action();if(!readOnly&&!result?.replayed)require('./document-archive.cjs').recover(dataDir,undefined,options);return result;
  });
}

/** Ежедневная резервная копия: складываем разделы обратно в один файл */
function makeDailyBackup(dataDir, backupDir, keepDays) {
  if(schemaVersion(dataDir)<storageFormat.SCHEMA_VERSION)return null;
  if (!isSplit(dataDir)) return null;
  const today = new Date().toISOString().slice(0, 10);
  // The compact receipt/index closure is authoritative even without a printed
  // document. A schema-4 daily copy must always use the service-aware package.
  const archiveAware=schemaVersion(dataDir)>=4||!!require('./document-archive.cjs').head(readAll(dataDir));
  const dest = path.join(backupDir, 'data_' + today + (archiveAware?'.zip':'.json'));
  if (fs.existsSync(dest)) return null;
  fs.mkdirSync(backupDir, { recursive: true });
  if(archiveAware)require('./backup-service.cjs').createPackage({sourceDir:dataDir,archivePath:dest,allowOwnedLock:true});else writeJsonAtomic(dest, readAll(dataDir));
  const list = fs.readdirSync(backupDir)
    .filter(f => /^data_\d{4}-\d{2}-\d{2}\.(?:json|zip)$/.test(f)).sort();
  const keep = keepDays || 30;
  if (list.length > keep) {
    list.slice(0, list.length - keep).forEach(f => {
      try { fs.unlinkSync(path.join(backupDir, f)); } catch {}
    });
  }
  return dest;
}

module.exports = {
  SECTIONS, sectionsDir, sectionFile, revisionsFile,schemaVersion,descriptor,assertWritable,assertWriteCompatibility,hasWriteCompatibility,encodeRevisions:storageFormat.encodeRevisions,
  databaseToken, withDatabaseLock, validateRows, prepareWriteoffSections,createJson,
  executeCommand:(dataDir,envelope,options)=>require('./diagnostic-boundary.cjs').withCommit(envelope,envelope?.databaseToken,sqliteBackend(dataDir)?'sqlite':'json',()=>require('./command-service.cjs').execute(dataDir,envelope,options)),
  commitPrintArtifact,
  isDatabaseLockHeld:dataDir=>heldLocks.has(canonicalDirectory(dataDir)),
  ...Object.fromEntries(Object.entries({ isSplit, migrate, readAll, writeAll, readRevisions, makeDailyBackup, readSection, writeSections, readSnapshot,readOperation,archiveHistory }).map(([name, operation]) => [name, (dataDir, ...args) => withDatabaseLock(dataDir, physical => {
    dataDir=physical;
    const sqlite = sqliteBackend(dataDir), action = () => {try{return operation(dataDir,...args);}catch(error){const principal=name==='readSnapshot'?args[0]?.principal:name==='readOperation'?args[1]:args[1]?.principal;throw require('./access-control').publicError(error,principal);}};
    const writing=['writeAll','writeSections','archiveHistory'].includes(name),nested=sqlite?.inTransaction(dataDir),readOnly=!writing||schemaVersion(dataDir)<storageFormat.SCHEMA_VERSION||args[1]?.requireWriterSchema===true&&args[1]?.writerSchemaVersion!==storageFormat.SCHEMA_VERSION||writing&&!hasWriteCompatibility(dataDir,args[1]);
    const commit=()=>!sqlite||['isSplit','migrate'].includes(name)?action():sqlite.transaction(dataDir,action,{readOnly});
    const payload=name==='writeAll'?{operation:args[1]?.operation}:args[0];
    const result=writing&&!nested&&name!=='archiveHistory'?require('./diagnostic-boundary.cjs').withCommit(payload,payload?.databaseToken||args[1]?.databaseToken,sqlite?'sqlite':'json',commit):commit();
    if(writing&&!nested&&!readOnly&&!result?.replayed)require('./document-archive.cjs').recover(dataDir,undefined,args[1]);
    return result;
  })])),
};
