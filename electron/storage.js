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
const history = require('./change-history');

// Порядок важен только для читаемости — файлы независимы
const SECTIONS = [
  'vehicles', 'records', 'generators', 'genRecords', 'toRecords',
  'tanks', 'tankIncomes', 'vehicleTo', 'repairs',
  'reestrRows', 'savedReestrs', 'payments', 'budget', 'contragents',
  'fuelPurchases', 'fuelImports', 'fuelCards', 'fuelPeriods', 'monthlyFuel', 'appMeta',
];

const REVISIONS_FILE = 'revisions.json';

function sectionsDir(dataDir) { return path.join(dataDir, 'sections'); }
function sectionFile(dataDir, name) { return path.join(sectionsDir(dataDir), name + '.json'); }
function revisionsFile(dataDir) { return path.join(sectionsDir(dataDir), REVISIONS_FILE); }
function legacyFile(dataDir) { return path.join(dataDir, 'data.json'); }
function databaseToken(dataDir) {
  let resolved=path.resolve(dataDir);
  try {resolved=fs.realpathSync(resolved);}catch{}
  return require('node:crypto').createHash('sha256').update('tvs-database:'+(process.platform==='win32'?resolved.toLowerCase():resolved)).digest('hex');
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
  recoverTransaction(dataDir);
  const revs = readJson(revisionsFile(dataDir));
  if (!revs || ['vehicles', 'records'].some(n => !Number.isSafeInteger(revs[n]) || revs[n] < 0) ||
      SECTIONS.some(n => n in revs && (!Number.isSafeInteger(revs[n]) || revs[n] < 0))) throw new Error('Повреждены версии разделов');
  const added = {};
  SECTIONS.filter(n => !(n in revs)).forEach(n => {
    added[n] = fs.existsSync(sectionFile(dataDir, n)) ? readRows(dataDir, n) : [];
    revs[n] = Date.now();
  });
  commitSections(dataDir, added, revs);
  return revs;
}

function readRows(dataDir, name) {
  const rows = readJson(sectionFile(dataDir, name));
  validateRows(name, rows);
  return rows;
}

function validateRows(name, rows) {
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('Раздел ' + name + ' должен содержать массив объектов');
}

// Revisions are the commit point. Before that point a failed or interrupted
// multi-file save rolls back; after it recovery finishes the committed save.
function recoverTransaction(dataDir) {
  const journal = path.join(sectionsDir(dataDir), '.transaction.json');
  if (!fs.existsSync(journal)) return;
  const tx = readJson(journal);
  if (!tx || !tx.sections || !tx.before || !tx.revisions || Object.keys(tx.sections).some(n => !SECTIONS.includes(n) || !Array.isArray(tx.sections[n]) || !(n in tx.before) || tx.before[n] !== null && !Array.isArray(tx.before[n])) ||
      SECTIONS.some(n => !Number.isSafeInteger(tx.revisions[n]) || tx.revisions[n] < 0) || tx.audit && !history.validEvent(tx.audit, SECTIONS)) throw new Error('Повреждён журнал сохранения');
  const committed = JSON.stringify(readJson(revisionsFile(dataDir), null)) === JSON.stringify(tx.revisions);
  const target = committed ? tx.sections : tx.before;
  Object.keys(tx.sections).forEach(name => {
    const file = sectionFile(dataDir, name), rows = target[name];
    if (rows === null) { if (fs.existsSync(file)) fs.unlinkSync(file); }
    else writeJsonAtomic(file, rows);
  });
  if (tx.audit) {
    const file = historyFile(dataDir, tx.audit.id);
    if (committed) { fs.mkdirSync(path.dirname(file), { recursive:true }); writeJsonAtomic(file, tx.audit); }
    else if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  if (committed || tx.base !== null) writeJsonAtomic(revisionsFile(dataDir), committed ? tx.revisions : tx.base);
  else if (fs.existsSync(revisionsFile(dataDir))) fs.unlinkSync(revisionsFile(dataDir));
  fs.unlinkSync(journal);
}

function commitSections(dataDir, sections, revisions, context) {
  const changed = Object.keys(sections);
  if (!changed.length) return;
  const journal = path.join(sectionsDir(dataDir), '.transaction.json');
  const before = Object.fromEntries(changed.map(n => [n, readJson(sectionFile(dataDir, n), null)]));
  const base = readJson(revisionsFile(dataDir), null);
  const audit = context ? history.createEvent(before, sections, context) : null;
  if (audit) fs.mkdirSync(path.dirname(historyFile(dataDir, audit.id)), { recursive:true });
  writeJsonAtomic(journal, { before, base, sections, revisions, audit });
  try {
    changed.forEach(n => writeJsonAtomic(sectionFile(dataDir, n), sections[n]));
    if (audit) writeJsonAtomic(historyFile(dataDir, audit.id), audit);
    writeJsonAtomic(revisionsFile(dataDir), revisions);
  } catch (e) {
    recoverTransaction(dataDir);
    throw e;
  }
  try { fs.unlinkSync(journal); } catch (e) { console.error('[storage] cleanup: ' + e.message); }
}

function checkClosedPeriods(previous, next) {
  const closed = new Set((previous.fuelPeriods || []).filter(p => p.closed).map(p => p.month));
  if (!closed.size) return;
  for (const name of ['records', 'fuelPurchases', 'monthlyFuel']) {
    if (!(name in next)) continue;
    const old = previous[name] || [], rows = next[name];
    for (const month of closed) {
      const select = list => list.filter(r => String(r.date || r.month || '').slice(0, 7) === month);
      if (JSON.stringify(select(old)) !== JSON.stringify(select(rows))) throw new Error('Месяц закрыт: ' + month + '. Сначала откройте его.');
    }
  }
}

function isSplit(dataDir) {
  return fs.existsSync(revisionsFile(dataDir));
}

/**
 * Разложить старый data.json по разделам. Вызывается один раз: как только
 * появился revisions.json, миграция считается выполненной. Исходный файл не
 * удаляем и не трогаем — он остаётся резервной копией на случай отката.
 */
function migrate(dataDir) {
  recoverTransaction(dataDir);
  if (isSplit(dataDir)) return { migrated: false, reason: 'уже разделено' };
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
  recoverTransaction(dataDir);
  if (!isSplit(dataDir)) migrate(dataDir);
  readRevisions(dataDir);
  const out = {};
  SECTIONS.forEach(name => { out[name] = readRows(dataDir, name); });
  return out;
}

/**
 * Записать данные, тронув только изменившиеся разделы.
 * Возвращает список записанных разделов и новые номера версий.
 */
function writeAll(dataDir, data, context = {}) {
  if (!data || !Array.isArray(data.vehicles) || !Array.isArray(data.records)) throw new Error('Неполная база: нужны vehicles и records');
  SECTIONS.forEach(n => { if (n in data) validateRows(n, data[n]); });
  const previous = readAll(dataDir);
  checkClosedPeriods(previous, data);
  if (!isSplit(dataDir)) migrate(dataDir);
  const revisions = readRevisions(dataDir);
  const changed = [];
  const sections = {};

  SECTIONS.forEach(name => {
    const next = name in data ? data[name] : previous[name];
    const file = sectionFile(dataDir, name);
    const nextRaw = JSON.stringify(next);
    let prevRaw = null;
    try { prevRaw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null; } catch {}
    if (prevRaw === nextRaw) return;         // раздел не менялся — не трогаем
    sections[name] = next;
    revisions[name] = (revisions[name] || 0) + 1;
    changed.push(name);
  });

  commitSections(dataDir, sections, revisions, context);
  return { changed, revisions };
}

/** Один раздел и его версия */
function readSection(dataDir, name) {
  if (!SECTIONS.includes(name)) throw new Error('Неизвестный раздел');
  recoverTransaction(dataDir);
  if (!isSplit(dataDir)) migrate(dataDir);
  return { name, rev: readRevisions(dataDir)[name] || 0, rows: readRows(dataDir, name) };
}

/**
 * Записать только переданные разделы — с проверкой версии.
 * base: { раздел: версия, от которой клиент вносил правки }. Если на диске
 * версия другая, значит раздел успел поменять кто-то ещё: ничего не пишем
 * и возвращаем список конфликтов — клиент сольёт правки и повторит.
 * Так правки двух людей не затирают друг друга молча.
 */
function writeSections(dataDir, payload, context = {}) {
  const previous = readAll(dataDir);
  if (!isSplit(dataDir)) migrate(dataDir);
  const base = (payload && payload.base) || {};
  const sections = (payload && payload.sections) || {};
  const names = Object.keys(sections);
  if (names.some(n => !SECTIONS.includes(n) || !Array.isArray(sections[n]))) throw new Error('Некорректные разделы');
  names.forEach(n => validateRows(n, sections[n]));
  const revisions = readRevisions(dataDir);
  const conflicts = names.filter(n => (revisions[n] || 0) !== (base[n] || 0));
  if (conflicts.length) return { ok: false, conflicts, revisions };
  checkClosedPeriods(previous, sections);
  const changed = [];
  const pending = {};
  names.forEach(name => {
    const next = Array.isArray(sections[name]) ? sections[name] : [];
    const file = sectionFile(dataDir, name);
    const nextRaw = JSON.stringify(next);
    let prevRaw = null;
    try { prevRaw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null; } catch {}
    if (prevRaw === nextRaw) return;
    pending[name] = next;
    revisions[name] = (revisions[name] || 0) + 1;
    changed.push(name);
  });
  commitSections(dataDir, pending, revisions, context);
  return { ok: true, changed, revisions };
}

/** Ежедневная резервная копия: складываем разделы обратно в один файл */
function makeDailyBackup(dataDir, backupDir, keepDays) {
  if (!isSplit(dataDir)) return null;
  const today = localDate();
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

function localDate(now = new Date()) {
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
}

function makeManualBackup(dataDir, backupDir) {
  const data = readAll(dataDir);
  fs.mkdirSync(backupDir, { recursive: true });
  const dest = path.join(backupDir, 'manual_' + localDate() + '_' + require('crypto').randomUUID() + '.json');
  writeJsonAtomic(dest, data);
  return dest;
}

function historyFile(dataDir, id) {
  if (!history.ID.test(id || '')) throw new Error('Неверный идентификатор истории');
  return path.join(dataDir, 'history', id + '.json');
}
function readHistoryEntry(dataDir, id) {
  recoverTransaction(dataDir);
  const event = readJson(historyFile(dataDir,id));
  if (!history.validEvent(event,SECTIONS)) throw new Error('Повреждена запись истории');
  return event;
}
function listHistory(dataDir, options = {}) {
  recoverTransaction(dataDir);
  const dir = path.join(dataDir,'history'), limit = Math.min(100,Math.max(1,Number(options.limit)||50));
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json') && history.ID.test(f.slice(0,-5))) : [];
  const ids = files.map(f=>f.slice(0,-5)).sort().reverse().filter(id=>!options.before || id < options.before);
  const selected = ids.slice(0,limit);
  return { items:selected.map(id=>history.summary(readHistoryEntry(dataDir,id))), next:ids.length>limit ? selected.at(-1) : null };
}
function restoreHistoryEntry(dataDir, id, context = {}) {
  const event = readHistoryEntry(dataDir,id), previous = readAll(dataDir);
  const sections = history.restoration(previous,event,SECTIONS);
  checkClosedPeriods(previous,sections);
  // Restoring old opening inputs can recalculate an already closed fuel act,
  // even when the dated journal rows themselves have not changed.
  if((previous.fuelPeriods||[]).some(period=>period.closed)) {
    const fields=['id','fuelBalance','fuelBalanceSources','fuelGrade','fuel','org','orgHistory','norm'];
    for(const change of event.changes) {
      const fuelInput=change.section==='fuelCards' || change.section==='vehicles' && (change.key===null || !change.before || !change.after || fields.some(field=>JSON.stringify(change.before[field])!==JSON.stringify(change.after[field])));
      if(fuelInput)throw new Error('Восстановление меняет исходные данные ГСМ закрытого месяца. Сначала откройте и перепроверьте период.');
    }
  }
  const revisions = readRevisions(dataDir);
  Object.keys(sections).forEach(name=>{ revisions[name]++; });
  commitSections(dataDir,sections,revisions,{...context,action:'Восстановление операции',reverts:id});
  return {ok:true,data:readAll(dataDir),revisions:readRevisions(dataDir)};
}

module.exports = {
  SECTIONS, sectionsDir, sectionFile, revisionsFile,
  isSplit, migrate, readAll, writeAll, readRevisions, makeDailyBackup,
  readSection, writeSections, makeManualBackup, validateRows,
  listHistory, readHistoryEntry, restoreHistoryEntry,
  databaseToken,
};
