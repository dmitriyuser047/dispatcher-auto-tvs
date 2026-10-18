// Загрузка отчётов ГЛОНАСС в журнал пробега. Поддерживаются:
//  • «Рейсы» (PDF или Excel) — выезды с одометром, моточасами и расходом по датчику;
//  • суточный отчёт «Пройденный путь» (report.xls — это HTML-таблица) — пробег
//    и время холостого хода по дням, без датчика топлива.
//
// В отчёте по каждой машине за каждый выезд: начало и конец, пробег,
// одометр на начало и конец, моточасы, холостой ход и расход топлива
// по датчику уровня. Выезды за день складываются:
//  • в запись журнала за этот день пишутся «Пробег по Глонассу», расход по
//    датчику, моточасы и холостой ход; то, что внёс водитель, не трогается;
//  • если записи за день нет, а машина ездила — создаётся запись с пробегом
//    и одометром из ГЛОНАСС и расходом по норме.
// Закрытые месяцы пропускаются.

// Колонки отчёта: по началу склеенного заголовка
const FG_COLS = [
  ['n', /^№/], ['object', /^Объект/i], ['start', /^Начало/i], ['end', /^Конец/i],
  ['km', /^Пробег,?км/i], ['odoStart', /^Нач\.?пробег/i], ['odoEnd', /^Кон\.?пробег/i],
  ['engine', /^Моточасы$/i], ['idle', /^(Холостойход,?время|Времяхолостогохода)/i],
  ['date', /^Дата$/i], ['path', /^Пройденныйпуть/i], ['total', /^Общеерасстояние/i],
  ['fuel', /^РасходГСМ,?л$/i], ['fuelIdle', /^РасходГСМприхолостом/i],
];

function fgNum(s) { const n = parseFloat(String(s ?? '').replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? null : n; }
// «4 ч.56мин.», «11ч.22мин.», «43мин.», «1 ч.» → часы
function fgHours(s) {
  s = String(s || '').replace(/\s/g, '');
  if (/^\d+(?:[.,]\d+)?$/.test(s)) return fgNum(s);
  const clock = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (clock) return +clock[1] + +clock[2] / 60 + +(clock[3] || 0) / 3600;
  const hms = /^(?:(\d+):)?(\d+):(\d{2}):(\d{2})$/.exec(s);
  if (hms) return (+(hms[1] || 0)) * 24 + +hms[2] + +hms[3] / 60 + +hms[4] / 3600;
  const d = /(\d+)д/.exec(s), h = /(\d+)ч/.exec(s), m = /(\d+)мин/.exec(s);
  if (!d && !h && !m) return null;
  return (d ? +d[1] * 24 : 0) + (h ? +h[1] : 0) + (m ? +m[1] / 60 : 0);
}
// «17.09.202604:14» или «17.09.2026 04:14» → «2026-09-17»
function fgDate(s) {
  const iso = /\d{4}-\d{2}-\d{2}/.exec(String(s || ''));
  if (iso && fqDate(iso[0])) return iso[0];
  const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(String(s || ''));
  const date = m ? m[3] + '-' + m[2] + '-' + m[1] : '';
  return fqDate(date) ? date : '';
}

// Таблица из PDF: колонки по X заголовка, строка таблицы — блок от номера в первой колонке
function fgTableFromPdf(items) {
  const pages = [...new Set(items.map(i => i.page))];
  let colX = null, header = null;
  const rows = [];
  pages.forEach(pg => {
    const its = items.filter(i => i.page === pg);
    const hdr = its.find(i => i.str.trim() === '№');
    if (!hdr) return;
    const line = its.filter(i => Math.abs(i.y - hdr.y) <= 2).sort((a, b) => a.x - b.x);
    if (!colX) colX = line.map(i => i.x);
    const colOf = x => { let c = 0; colX.forEach((cx, k) => { if (x >= cx - 3) c = k; }); return c; };
    const below = its.filter(i => i.y <= hdr.y + 2).sort((a, b) => b.y - a.y || a.x - b.x);
    const isStart = i => colOf(i.x) === 0 && /^\d+$/.test(i.str.trim()) && i.y < hdr.y - 5;
    const starts = below.filter(isStart).map(i => i.y).sort((a, b) => b - a);
    if (!header) {
      header = colX.map(() => '');
      below.filter(i => !starts.length || i.y > starts[0] + 2).forEach(i => { header[colOf(i.x)] += i.str.replace(/\s/g, ''); });
    }
    starts.forEach((y0, k) => {
      const y1 = k + 1 < starts.length ? starts[k + 1] : -Infinity;
      const cells = colX.map(() => '');
      below.filter(i => i.y <= y0 + 2 && i.y > y1 + 2).forEach(i => {
        const c = colOf(i.x);
        cells[c] += (cells[c] && /^[А-ЯA-Z]/.test(i.str) && !/[-.:]$/.test(cells[c]) ? ' ' : '') + i.str;
      });
      if (cells.slice(1).some(Boolean)) rows.push(cells);
    });
  });
  return header ? { header, rows } : null;
}

function fgTableFromXlsx(base64) {
  let rows = null;
  // Многие системы мониторинга отдают «xls», который на деле HTML-таблица.
  // Её читаем сами: при разборе как Excel запятая в «62,87» теряется и выходит 6287.
  const head = atob(base64.slice(0, 200));
  if (/^\s*</.test(head)) {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const html = new TextDecoder(/charset=windows-1251/i.test(head) ? 'windows-1251' : 'utf-8').decode(bytes);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // Берём таблицу, где есть заголовок «Объект»
    const table = [...doc.querySelectorAll('table')].find(t => /Объект/.test(t.textContent) && /(Пробег|Пройденный путь)/i.test(t.textContent));
    if (!table) return null;
    rows = [...table.querySelectorAll('tr')].map(tr => [...tr.children].map(td => td.textContent.trim()));
  } else {
    const wb = XLSX.read(base64, { type: 'base64', cellDates: false });
    for (const sn of wb.SheetNames) {
      const r = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '', raw: false });
      if (r.some(x => x.some(c => /^Объект/i.test(String(c).trim())) && x.some(c => /(Пробег|Пройденный)/i.test(String(c))))) { rows = r; break; }
    }
    if (!rows) return null;
  }
  const h = rows.findIndex(r => r.some(c => /^Объект/i.test(String(c).trim())) && r.some(c => /(Пробег|Пройденный)/i.test(String(c))));
  if (h < 0) return null;
  const header = rows[h].map(c => String(c).replace(/\s/g, ''));
  const dc = header.findIndex(c => /^(Начало|Дата)$/i.test(c));
  return { header, rows: rows.slice(h + 1).filter(r => dc >= 0 && fgDate(r[dc])) };
}

function fgTrips(table) {
  const idx = {};
  FG_COLS.forEach(([k, re]) => { idx[k] = table.header.findIndex(h => re.test(h)); });
  if (idx.object < 0 || (idx.start < 0 && idx.date < 0) || (idx.km < 0 && idx.total < 0 && idx.path < 0)) return null;
  const val = (r, k) => idx[k] >= 0 ? r[idx[k]] : '';
  return table.rows.map(r => ({
    object: String(val(r, 'object')).trim(),
    start: String(val(r, 'start')).trim(), end: String(val(r, 'end')).trim(),
    kind: idx.start >= 0 && /\d{1,2}:\d{2}/.test(String(val(r, 'start'))) ? 'trip' : 'day',
    date: fgDate(val(r, 'start')) || fgDate(val(r, 'date')),
    // «Общее расстояние» включает участки без связи с трекером — берём его
    km: fgNum(val(r, 'km')) ?? fgNum(val(r, 'total')) ?? fgNum(val(r, 'path')) ?? 0,
    odoStart: fgNum(val(r, 'odoStart')),
    odoEnd: fgNum(val(r, 'odoEnd')),
    engine: fgHours(val(r, 'engine')),
    idle: fgHours(val(r, 'idle')),
    fuel: fgNum(val(r, 'fuel')),
    fuelIdle: fgNum(val(r, 'fuelIdle')),
  })).filter(t => t.date && t.object);
}

// Машина по госномеру в названии объекта: «Mitsubishi L200 Р030 НВ716»
function fgMatchVehicle(text, db = data) {
  const norm = plateKey;
  const t = norm(text);
  // Объект, который уже привязали вручную
  const aliases = (db.vehicles || []).filter(v => (v.glonassAliases || []).includes(t));
  if (aliases.length) return aliases.length === 1 ? aliases[0] : null;
  // Номер в отчёте бывает без региона («НИВА М800ВХ»): сравниваем по основе номера
  const cores = t.match(/[АВЕКМНОРСТУХ]\d{3}[АВЕКМНОРСТУХ]{2}|\d{4}[АВЕКМНОРСТУХ]{2}/g) || [];
  const vs = (db.vehicles || []).filter(v => norm(v.plate).length >= 5);
  // Полный номер с регионом в тексте — точное совпадение, самый длинный номер
  const exact = vs.filter(v => t.includes(norm(v.plate))).sort((a, b) => norm(b.plate).length - norm(a.plate).length);
  if (exact.length) return exact.length === 1 ? exact[0] : null;
  // Только основа номера: берём, если подходит ровно одна машина, иначе — неоднозначно
  const byCore = vs.filter(v => cores.some(c => norm(v.plate).startsWith(c)));
  return byCore.length === 1 ? byCore[0] : null;
}

let _fgLast = null, _fgPending = null, _fgSaving = false;
function fgFingerprint(db) { return JSON.stringify(['vehicles','records','fuelPeriods','glonassTrips','glonassImports'].map(name => db[name] || [])); }
function fgContentKey(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(36);
}
function fgTripKey(trip, vehicleId) {
  const timestamp=value => {
    const text=String(value || ''), time=/(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(text);
    return fgDate(text)+(time ? 'T'+String(time[1]).padStart(2,'0')+':'+time[2]+':'+(time[3] || '00') : '');
  };
  return JSON.stringify([vehicleId, trip.date, trip.kind || 'day', trip.kind === 'trip' ? timestamp(trip.start) : '', trip.kind === 'trip' ? timestamp(trip.end) : '']);
}
function fgAggregateTrips(trips, vehicle, date) {
  const result = { v: vehicle, date, km: 0, fuel: 0, sensorKm: 0, sensorTrips: 0, fuelIdle: 0, engine: 0, idle: 0, odoStart: null, odoEnd: null, trips: trips.length, sensor: false, hasFuelIdle: false, hasEngine: false, hasIdle: false };
  trips.forEach(trip => {
    result.km += fqValue(trip.km) || 0;
    if (fqValue(trip.fuel) != null) { result.sensorKm += fqValue(trip.km) || 0; result.sensorTrips++; }
    [['fuel','sensor'],['fuelIdle','hasFuelIdle'],['engine','hasEngine'],['idle','hasIdle']].forEach(([field,known]) => {
      const value = fqValue(trip[field]); if (value != null) { result[field] += value; result[known] = true; }
    });
    const start = fqValue(trip.odoStart), end = fqValue(trip.odoEnd);
    if (start != null && (result.odoStart == null || start < result.odoStart)) result.odoStart = start;
    if (end != null && (result.odoEnd == null || end > result.odoEnd)) result.odoEnd = end;
  });
  return result;
}
function fgPlanTrips(db, trips, overrides) {
  const days = new Map(), unknown = new Map(), invalid = [];
  trips.forEach(trip => {
    if (!fqDate(trip.date) || ['km','fuel','fuelIdle','engine','idle'].some(field => fqValue(trip[field]) != null && Number(trip[field]) < 0)) { invalid.push(trip); return; }
    const assigned = overrides && overrides[trip.object];
    const vehicle = assigned ? (db.vehicles || []).find(v => v.id === assigned) : fgMatchVehicle(trip.object, db);
    if (!vehicle) { const item = unknown.get(trip.object) || {trips:0,km:0}; item.trips++; item.km += trip.km || 0; unknown.set(trip.object,item); return; }
    const key = vehicle.id + '|' + trip.date;
    if (!days.has(key)) days.set(key,{key,vehicle,date:trip.date,trips:[]}); days.get(key).trips.push(trip);
  });
  const entries = [...days.values()].map(day => {
    const records = (db.records || []).filter(r => r.vehicleId === day.vehicle.id && r.date === day.date);
    const existing = (db.glonassTrips || []).filter(t => t.vehicleId === day.vehicle.id && t.date === day.date && !t.supersededBy);
    const legacy = !existing.length && records.some(r => ['kmGlonass','glonassFuel','glonassEngineH','glonassIdleH'].some(field => fqValue(r[field]) != null));
    const kinds = new Set([...existing,...day.trips].map(trip => trip.kind || 'day'));
    const mixed = kinds.size > 1;
    const closed = (db.fuelPeriods || []).some(p => p.closed && p.month === day.date.slice(0,7));
    return {...day,existing,legacy,mixed,closed,incoming:fgAggregateTrips(day.trips,day.vehicle,day.date),
      mode:closed || legacy || mixed ? 'keep' : 'merge',
      reason:closed ? 'Закрытый месяц' : legacy ? 'Есть прежний дневной итог без исходных рейсов' : mixed ? 'Суточный итог и отдельные рейсы могут пересекаться' : 'Рейсы объединяются по времени начала и конца; совпавшие уточняются'};
  });
  return {entries,unknown,invalid,fingerprint:fgFingerprint(db)};
}
async function importGlonassTrips() {
  if (!window.electronAPI || !window.electronAPI.importGlonassFile) { alert('Загрузка ГЛОНАСС доступна в программе для компьютера'); return; }
  const res = await window.electronAPI.importGlonassFile();
  if (!res || !res.ok) { if (res && res.error) alert('Не удалось прочитать файл: ' + res.error); return; }
  try {
    const table = res.kind === 'pdf' ? fgTableFromPdf(res.items) : fgTableFromXlsx(res.base64), trips = table && fgTrips(table);
    if (!trips || !trips.length) { alert('Не найдена таблица с объектом, датой и пробегом.'); return; }
    fgStartPreview(trips,{fileName:res.fileName,kind:res.kind,contentFingerprint:fgContentKey(JSON.stringify(trips))});
  } catch (error) { alert('Не удалось подготовить ГЛОНАСС: ' + error.message); }
}
function fgStartPreview(trips,meta,overrides) {
  _fgPending = {trips,meta,overrides:overrides || {},modes:{},plan:null}; fgPreview();
}
function fgPreview() {
  if (!_fgPending || _fgSaving) return;
  const pending = _fgPending, plan = fgPlanTrips(data,pending.trips,pending.overrides); pending.plan = plan;
  const rows = plan.entries.map((entry,index) => {
    const allowed = entry.closed ? [['keep','Пропустить: месяц закрыт']] : entry.legacy || entry.mixed ? [['keep','Сохранить прежний день'],['replace','Заменить день этим отчётом (прежнее в истории)']] : [['merge','Объединить исходные рейсы / уточнить совпавшие'],['replace','Заменить день этим отчётом'],['keep','Пропустить этот день']];
    entry.mode = allowed.some(([id]) => id === pending.modes[entry.key]) ? pending.modes[entry.key] : entry.mode;
    const previous = entry.existing.length ? fgAggregateTrips(entry.existing,entry.vehicle,entry.date).km : (data.records || []).filter(r => r.vehicleId === entry.vehicle.id && r.date === entry.date).reduce((sum,r) => sum + (fqValue(r.kmGlonass) || 0),0);
    return '<tr><td>'+fmtDate(entry.date)+'</td><td>'+fpEsc(fpVehicleTitle(entry.vehicle))+'</td><td>'+fpNum(previous,2)+'</td><td>'+fpNum(entry.incoming.km,2)+'</td><td>'+entry.trips.length+'</td><td>'+fpEsc(entry.reason)+'</td><td><select aria-label="Обработка дня" onchange="_fgPending.modes['+fpEsc(JSON.stringify(entry.key))+']=this.value">'+allowed.map(([id,label]) => '<option value="'+id+'"'+(entry.mode === id ? ' selected' : '')+'>'+label+'</option>').join('')+'</select></td></tr>';
  }).join('');
  const unknown = [...plan.unknown].map(([object,item],index) => { const suggested = fgSuggest(object); return '<div style="margin:6px 0"><b>'+fpEsc(object)+'</b> · '+item.trips+' строк, '+fpNum(item.km,1)+' км <select id="fgPreviewVehicle_'+index+'">'+fuelImportVehicleOptions(suggested && suggested.id || '',true)+'</select><button class="btn btn-ghost" onclick="fgPreviewAssign('+index+')">Сопоставить</button></div>'; }).join('');
  openGenericModal('Проверка ГЛОНАСС: '+pending.meta.fileName,
    '<div class="gsm-status">Строк: '+pending.trips.length+' · машино-дней: '+plan.entries.length+' · не сопоставлено объектов: '+plan.unknown.size+'. Проверьте обработку пересекающихся дней до сохранения.</div>'+
    (plan.invalid.length ? '<div class="gsm-status gsm-error">Некорректных строк: '+plan.invalid.length+'. Они будут пропущены; исходные значения останутся в истории загрузки.</div>' : '')+
    (unknown ? '<details open><summary>Машины для сопоставления</summary>'+unknown+'</details>' : '')+
    '<div class="table-scroll" style="max-height:50vh"><table class="data-table"><thead><tr><th>Дата</th><th>Машина</th><th>Было, км</th><th>В файле, км</th><th>Строк</th><th>Проверка</th><th>Действие</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
    '<div id="fgPreviewError" class="gsm-status gsm-error" role="alert"></div><div style="display:flex;justify-content:end;gap:8px"><button class="btn btn-ghost" onclick="closeModal(\'genericModal\')">Отмена</button><button class="btn btn-ghost" onclick="fgPreview()">Повторить проверку</button><button id="fgCommitButton" class="btn btn-primary" onclick="fgCommitImport()">Сохранить проверенные дни</button></div>',1150);
}
function fgPreviewAssign(index) {
  const object = [..._fgPending.plan.unknown.keys()][index], vehicleId = document.getElementById('fgPreviewVehicle_'+index)?.value;
  if (!object || !vehicleId) { alert('Выберите машину'); return; }
  _fgPending.overrides[object] = vehicleId; fgPreview();
}
function fgApplyTrips(trips,options) {
  options = options || {};
  const db = options.db || data, plan = options.plan || fgPlanTrips(db,trips,options.overrides), next = JSON.parse(JSON.stringify(db));
  if (plan.fingerprint !== fgFingerprint(db)) throw Error('Данные изменились. Проверьте импорт заново.');
  next.glonassTrips = next.glonassTrips || []; next.glonassImports = next.glonassImports || []; next.records = next.records || [];
  const importId = 'gi_'+Date.now()+'_'+Math.random().toString(36).slice(2,8), at = new Date().toISOString(), report = [];
  Object.entries(options.overrides || {}).forEach(([object,vehicleId]) => {
    const vehicle = next.vehicles.find(v => v.id === vehicleId), alias = plateKey(object);
    next.vehicles.filter(previous => previous.id !== vehicleId && (previous.glonassAliases || []).includes(alias)).forEach(previous => {
      (previous.glonassAliasHistory || (previous.glonassAliasHistory=[])).push({alias,at,importId,reassignedTo:vehicleId});
      previous.glonassAliases=previous.glonassAliases.filter(value => value !== alias);
    });
    if (vehicle && !(vehicle.glonassAliases || []).includes(alias)) (vehicle.glonassAliases || (vehicle.glonassAliases=[])).push(alias);
  });
  plan.entries.forEach(entry => {
    const mode = entry.closed ? 'keep' : options.modes && options.modes[entry.key] || entry.mode;
    if (!['keep','merge','replace'].includes(mode) || mode === 'merge' && (entry.legacy || entry.mixed)) throw Error('Для пересекающегося дня выберите сохранить или заменить.');
    if (mode === 'keep') { report.push({d:entry.incoming,action:entry.closed ? 'closed' : 'kept'}); return; }
    if (mode === 'replace') next.glonassTrips.filter(t => t.vehicleId === entry.vehicle.id && t.date === entry.date && !t.supersededBy).forEach(t => { t.supersededBy=importId; });
    entry.trips.forEach((trip,index) => {
      const key = fgTripKey(trip,entry.vehicle.id);
      let row = next.glonassTrips.find(t => t.key === key && !t.supersededBy);
      if (row) {
        const changed = ['km','fuel','fuelIdle','engine','idle','odoStart','odoEnd'].some(field => fqValue(trip[field]) != null && fqValue(row[field]) !== fqValue(trip[field]));
        if (changed) (row.history || (row.history=[])).push({at,importId:row.importId,values:Object.fromEntries(['km','fuel','fuelIdle','engine','idle','odoStart','odoEnd'].map(field => [field,row[field] ?? null]))});
        ['km','fuel','fuelIdle','engine','idle','odoStart','odoEnd'].forEach(field => { if (fqValue(trip[field]) != null) row[field]=Number(trip[field]); });
        row.importId=importId; row.updatedAt=at; (row.importIds || (row.importIds=[])).push(importId);
      } else {
        row={...trip,id:'gt_'+importId+'_'+index+'_'+fgContentKey(key),key,vehicleId:entry.vehicle.id,importId,importIds:[importId],createdAt:at}; next.glonassTrips.push(row);
      }
    });
    const active = next.glonassTrips.filter(t => t.vehicleId === entry.vehicle.id && t.date === entry.date && !t.supersededBy), d = fgAggregateTrips(active,entry.vehicle,entry.date);
    const recs = next.records.filter(r => r.vehicleId === entry.vehicle.id && r.date === entry.date);
    let record = recs.find(r => r.glonassCanonical) || recs.slice().sort((a,b) => (+b.km || 0)-(+a.km || 0))[0], action='updated';
    if (!record && !(d.km > 0 || d.engine > 0 || d.idle > 0 || d.fuel > 0)) { report.push({d,action:'stored'}); return; }
    if (!record) {
      record={id:'r_'+importId+'_'+fgContentKey(entry.key),vehicleId:entry.vehicle.id,date:entry.date,km:Math.round(d.km*100)/100,odoStart:d.odoStart,odoEnd:d.odoEnd,fuelUsed:entry.vehicle.norm ? Math.round(d.km*entry.vehicle.norm)/100 : null,fuelGrade:vehicleFuelGrade(entry.vehicle),note:'пробег из ГЛОНАСС'};
      next.records.push(record); action='created';
    }
    const fields=['kmGlonass','glonassFuel','glonassFuelIdle','glonassEngineH','glonassIdleH','glonassFuelKm'], before=Object.fromEntries(fields.map(field => [field,record[field] ?? null]));
    const round=value => Math.round(value*100)/100;
    const values={kmGlonass:round(d.km),glonassFuel:d.sensor ? round(d.fuel) : null,glonassFuelIdle:d.hasFuelIdle ? round(d.fuelIdle) : null,glonassEngineH:d.hasEngine ? round(d.engine) : null,glonassIdleH:d.hasIdle ? round(d.idle) : null,glonassFuelKm:d.sensor ? round(d.sensorKm) : null};
    // An absent sensor column does not erase an earlier measurement on merge.
    if (mode === 'merge') fields.slice(1).forEach(field => { if (values[field] == null && before[field] != null) values[field]=before[field]; });
    if (JSON.stringify(before) !== JSON.stringify(values)) (record.glonassHistory || (record.glonassHistory=[])).push({at,importId,values:before,reason:mode});
    else if (action !== 'created') action='same';
    Object.assign(record,values,{glonassCanonical:true,glonassProvenance:{importId,rawIds:active.map(t => t.id),at,mode}});
    report.push({d,action,rec:record});
  });
  const meta=options.meta || {};
  next.glonassImports.push({id:importId,at,fileName:meta.fileName || 'Ручное сопоставление',kind:meta.kind || '',contentFingerprint:meta.contentFingerprint || fgContentKey(JSON.stringify(trips)),trips,overrides:options.overrides || {},unknownObjects:[...plan.unknown.keys()],invalidRows:plan.invalid.length,decisions:plan.entries.map(entry => ({vehicleId:entry.vehicle.id,date:entry.date,mode:options.modes && options.modes[entry.key] || entry.mode})),counts:report.reduce((result,row) => { result[row.action]=(result[row.action] || 0)+1; return result; },{})});
  return {next,report,unknown:plan.unknown,importId};
}
async function fgCommitImport() {
  if (!_fgPending || _fgSaving) return;
  const error=document.getElementById('fgPreviewError');
  try {
    const pending=_fgPending;
    const result=fgApplyTrips(pending.trips,{plan:pending.plan,modes:pending.modes,meta:pending.meta,overrides:pending.overrides});
    _fgSaving=true; document.getElementById('fgCommitButton').disabled=true;
    data=result.next; rebuildIndex();
    if (!await saveData(data,{noMerge:true})) { error.textContent='Изменения не сохранены. Проверьте соединение и нажмите «Повторить проверку».'; return; }
    _fgLast={fileName:pending.meta.fileName,trips:pending.trips,report:result.report,unknown:result.unknown,importId:result.importId}; _fgPending=null;
    closeModal('genericModal'); if (activeSection === 'fuelPurchases') renderFuelPurchases(); fgShowImportReport();
  } catch (failure) { if (error) error.textContent=failure.message; }
  finally { _fgSaving=false; const button=document.getElementById('fgCommitButton'); if(button) button.disabled=false; }
}
async function fgAssign(idx) {
  if (!_fgLast) return;
  const object=[..._fgLast.unknown.keys()][idx], vehicleId=document.getElementById('fgAssign_'+idx)?.value;
  if (!object || !vehicleId) { alert('Выберите машину'); return; }
  fgStartPreview(_fgLast.trips.filter(trip => trip.object === object),{fileName:_fgLast.fileName,kind:'assignment'},{[object]:vehicleId});
}
function fgHistoryDialog() {
  const imports=(data.glonassImports || []).slice().reverse();
  openGenericModal('История загрузок ГЛОНАСС','<div class="gsm-status">Исходные строки и предыдущие версии показаний сохраняются. Повторное открытие загрузки выполняет проверку сопоставления и пересечений заново.</div><div class="table-scroll" style="max-height:65vh"><table class="data-table"><thead><tr><th>Загрузка</th><th>Файл</th><th>Строк</th><th></th></tr></thead><tbody>'+imports.map(batch => '<tr><td>'+fpEsc(new Date(batch.at).toLocaleString('ru'))+'</td><td>'+fpEsc(batch.fileName)+'</td><td>'+(batch.trips || []).length+'</td><td><button class="btn btn-ghost" onclick="fgOpenImport('+fpEsc(JSON.stringify(batch.id))+')">Открыть исходные строки</button></td></tr>').join('')+'</tbody></table></div>',900);
}
function fgOpenImport(id) {
  const batch=(data.glonassImports || []).find(item => item.id === id);
  if (batch) fgStartPreview(batch.trips || [],{fileName:batch.fileName,kind:batch.kind,contentFingerprint:batch.contentFingerprint},batch.overrides || {});
}
function fgShowImportReport() {
  if (!_fgLast) return;
  const {fileName,trips,report,unknown,importId}=_fgLast;
  const labels={created:'Создана запись',updated:'Показания обновлены',same:'Показания без изменений',closed:'Закрытый месяц, пропущено',kept:'Прежний день сохранён',stored:'Исходные показания сохранены без пробега'};
  const rows=report.map(item => '<tr><td>'+fmtDate(item.d.date)+'</td><td>'+fpEsc(fpVehicleTitle(item.d.v))+'</td><td>'+fpEsc(labels[item.action] || item.action)+'</td><td>'+fpNum(item.d.km,2)+'</td><td>'+(item.rec && fqValue(item.rec.glonassFuel) != null ? fpNum(item.rec.glonassFuel,2) : '—')+'</td><td>'+(item.rec && fqValue(item.rec.glonassEngineH) != null ? fpNum(item.rec.glonassEngineH,2) : '—')+'</td><td>'+(item.rec && fqValue(item.rec.glonassIdleH) != null ? fpNum(item.rec.glonassIdleH,2) : '—')+'</td></tr>').join('');
  const unknownHtml=[...unknown].map(([object,item],index) => { const suggested=fgSuggest(object); return '<div style="margin:6px 0"><b>'+fpEsc(object)+'</b> · '+item.trips+' строк <select id="fgAssign_'+index+'">'+fuelImportVehicleOptions(suggested && suggested.id || '',true)+'</select><button class="btn btn-ghost" onclick="fgAssign('+index+')">Сопоставить и проверить</button></div>'; }).join('');
  openGenericModal('ГЛОНАСС сохранён: '+fileName,'<div class="gsm-status gsm-ok">Загрузка записана. Исходных строк: '+trips.length+' · машино-дней: '+report.length+'. Источник: '+fpEsc(importId)+'</div>'+(unknownHtml ? '<details open><summary>Не сопоставленные объекты (сохранены в истории)</summary>'+unknownHtml+'</details>' : '')+'<div class="table-scroll" style="max-height:55vh"><table class="data-table"><thead><tr><th>Дата</th><th>Машина</th><th>Результат</th><th>Итог ГЛОНАСС, км</th><th>Датчик, л</th><th>Двигатель, ч</th><th>Холостой ход, ч</th></tr></thead><tbody>'+rows+'</tbody></table></div><div style="margin-top:12px;display:flex;justify-content:end;gap:8px"><button class="btn btn-ghost" onclick="fgHistoryDialog()">История загрузок</button><button class="btn btn-primary" onclick="closeModal(\'genericModal\')">Готово</button></div>',1100);
}
