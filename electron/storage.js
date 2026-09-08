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

// Порядок важен только для читаемости — файлы независимы
const SECTIONS = [
  'vehicles', 'records', 'generators', 'genRecords', 'toRecords',
  'tanks', 'tankIncomes', 'vehicleTo', 'repairs',
  'reestrRows', 'savedReestrs', 'payments', 'budget', 'contragents',
];

const REVISIONS_FILE = 'revisions.json';

function sectionsDir(dataDir) { return path.join(dataDir, 'sections'); }
function sectionFile(dataDir, name) { return path.join(sectionsDir(dataDir), name + '.json'); }
function revisionsFile(dataDir) { return path.join(sectionsDir(dataDir), REVISIONS_FILE); }
function legacyFile(dataDir) { return path.join(dataDir, 'data.json'); }

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.error('[storage] не прочитан ' + path.basename(file) + ': ' + e.message);
    return fallback;
  }
}

// Пишем через временный файл: если процесс упадёт на середине,
// рабочий файл останется целым, а не обрежется наполовину.
function writeJsonAtomic(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
  fs.renameSync(tmp, file);
}

function readRevisions(dataDir) {
  return readJson(revisionsFile(dataDir), {});
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
  if (isSplit(dataDir)) return { migrated: false, reason: 'уже разделено' };
  const legacy = legacyFile(dataDir);
  fs.mkdirSync(sectionsDir(dataDir), { recursive: true });

  const data = fs.existsSync(legacy) ? readJson(legacy, null) : null;
  const revisions = {};
  let records = 0;

  SECTIONS.forEach(name => {
    const arr = data && Array.isArray(data[name]) ? data[name] : [];
    writeJsonAtomic(sectionFile(dataDir, name), arr);
    revisions[name] = 1;
    records += arr.length;
  });
  writeJsonAtomic(revisionsFile(dataDir), revisions);

  if (data) {
    // Помечаем исходник, чтобы было видно: он больше не рабочий
    const marker = path.join(dataDir, 'data.json.before-split');
    try { if (!fs.existsSync(marker)) fs.copyFileSync(legacy, marker); } catch {}
  }
  return { migrated: true, sections: SECTIONS.length, records, hadLegacy: !!data };
}

/** Собрать все разделы в один объект — в том же виде, что раньше отдавал data.json */
function readAll(dataDir) {
  if (!isSplit(dataDir)) migrate(dataDir);
  const out = {};
  SECTIONS.forEach(name => { out[name] = readJson(sectionFile(dataDir, name), []); });
  return out;
}

/**
 * Записать данные, тронув только изменившиеся разделы.
 * Возвращает список записанных разделов и новые номера версий.
 */
function writeAll(dataDir, data) {
  if (!isSplit(dataDir)) migrate(dataDir);
  const revisions = readRevisions(dataDir);
  const changed = [];

  SECTIONS.forEach(name => {
    const next = Array.isArray(data[name]) ? data[name] : [];
    const file = sectionFile(dataDir, name);
    const nextRaw = JSON.stringify(next);
    let prevRaw = null;
    try { prevRaw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null; } catch {}
    if (prevRaw === nextRaw) return;         // раздел не менялся — не трогаем
    writeJsonAtomic(file, next);
    revisions[name] = (revisions[name] || 0) + 1;
    changed.push(name);
  });

  if (changed.length) writeJsonAtomic(revisionsFile(dataDir), revisions);
  return { changed, revisions };
}

/** Ежедневная резервная копия: складываем разделы обратно в один файл */
function makeDailyBackup(dataDir, backupDir, keepDays) {
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
  SECTIONS, sectionsDir, sectionFile, revisionsFile,
  isSplit, migrate, readAll, writeAll, readRevisions, makeDailyBackup,
};
