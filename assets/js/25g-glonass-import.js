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
  const hms = /^(?:(\d+):)?(\d+):(\d{2}):(\d{2})$/.exec(s);
  if (hms) return (+(hms[1] || 0)) * 24 + +hms[2] + +hms[3] / 60 + +hms[4] / 3600;
  const d = /(\d+)д/.exec(s), h = /(\d+)ч/.exec(s), m = /(\d+)мин/.exec(s);
  if (!d && !h && !m) return null;
  return (d ? +d[1] * 24 : 0) + (h ? +h[1] : 0) + (m ? +m[1] / 60 : 0);
}
// «17.09.202604:14» или «17.09.2026 04:14» → «2026-09-17»
function fgDate(s) {
  const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(String(s || ''));
  return m ? m[3] + '-' + m[2] + '-' + m[1] : '';
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
function fgMatchVehicle(text) {
  const lat = { A: 'А', B: 'В', E: 'Е', K: 'К', M: 'М', H: 'Н', O: 'О', P: 'Р', C: 'С', T: 'Т', Y: 'У', X: 'Х' };
  const norm = s => String(s || '').toUpperCase().replace(/[ABEKMHOPCTYX]/g, ch => lat[ch]).replace(/[^А-ЯЁ0-9]/g, '');
  const t = norm(text);
  // Номер в отчёте бывает без региона («НИВА М800ВХ»): сравниваем по основе номера
  const cores = t.match(/[АВЕКМНОРСТУХ]\d{3}[АВЕКМНОРСТУХ]{2}|\d{4}[АВЕКМНОРСТУХ]{2}/g) || [];
  const vs = (data.vehicles || []).filter(v => norm(v.plate).length >= 5);
  // Полный номер с регионом в тексте — точное совпадение, самый длинный номер
  const exact = vs.filter(v => t.includes(norm(v.plate))).sort((a, b) => norm(b.plate).length - norm(a.plate).length);
  if (exact.length) return exact[0];
  // Только основа номера: берём, если подходит ровно одна машина, иначе — неоднозначно
  const byCore = vs.filter(v => cores.some(c => norm(v.plate).startsWith(c)));
  return byCore.length === 1 ? byCore[0] : null;
}

async function importGlonassTrips() {
  if (!window.electronAPI || !window.electronAPI.importGlonassFile) { alert('Загрузка ГЛОНАСС доступна в программе для компьютера'); return; }
  const res = await window.electronAPI.importGlonassFile();
  if (!res || !res.ok) { if (res && res.error) alert('Не удалось прочитать файл: ' + res.error); return; }
  const table = res.kind === 'pdf' ? fgTableFromPdf(res.items) : fgTableFromXlsx(res.base64);
  const trips = table && fgTrips(table);
  if (!trips || !trips.length) { alert('В файле не найдена таблица ГЛОНАСС: нужны колонки «Объект», «Начало» или «Дата» и «Пробег, км» или «Пройденный путь, км».'); return; }

  // Выезды → машина × день
  const days = new Map(), unknown = new Map();
  trips.forEach(t => {
    const v = fgMatchVehicle(t.object);
    if (!v) { unknown.set(t.object, (unknown.get(t.object) || 0) + 1); return; }
    const k = v.id + '|' + t.date;
    const d = days.get(k) || { v, date: t.date, km: 0, fuel: 0, fuelIdle: 0, engine: 0, idle: 0, odoStart: null, odoEnd: null, trips: 0, sensor: false };
    d.km += t.km; d.trips++;
    if (t.fuel != null) { d.fuel += t.fuel; if (t.fuel > 0) d.sensor = true; }
    d.fuelIdle += t.fuelIdle || 0; d.engine += t.engine || 0; d.idle += t.idle || 0;
    if (t.odoStart && (d.odoStart == null || t.odoStart < d.odoStart)) d.odoStart = t.odoStart;
    if (t.odoEnd && (d.odoEnd == null || t.odoEnd > d.odoEnd)) d.odoEnd = t.odoEnd;
    days.set(k, d);
  });

  const report = [];
  const r2 = x => Math.round(x * 100) / 100;
  days.forEach(d => {
    if (fuelMonthClosed(d.date)) { report.push({ d, action: 'closed' }); return; }
    const recs = recsFor(d.v.id).filter(r => r.date === d.date);
    // Запись дня с пробегом; если у дня только записи-заправки — первая из них
    let rec = recs.slice().sort((a, b) => (+b.km || 0) - (+a.km || 0))[0];
    if (!rec && !(d.km > 0)) { report.push({ d, action: 'skip' }); return; }
    let action = 'updated';
    if (!rec) {
      rec = { id: 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), vehicleId: d.v.id, date: d.date,
              km: r2(d.km), odoStart: d.odoStart, odoEnd: d.odoEnd,
              fuelUsed: d.v.norm ? r2(d.km * d.v.norm / 100) : null, fuelGrade: vehicleFuelGrade(d.v),
              note: 'пробег из ГЛОНАСС' };
      data.records.push(rec);
      action = 'created';
    }
    const before = rec.kmGlonass;
    rec.kmGlonass = r2(d.km);
    // Расход по датчику: ноль при пробеге значит, что датчика нет или он не работал
    rec.glonassFuel = d.sensor ? r2(d.fuel) : null;
    rec.glonassEngineH = d.engine ? r2(d.engine) : null;
    rec.glonassIdleH = d.idle ? r2(d.idle) : null;
    if (action === 'updated' && before === rec.kmGlonass) action = 'same';
    report.push({ d, action, rec });
  });
  await saveData(data);
  fgShowImportReport(res.fileName, trips.length, report, unknown);
  if (activeSection === 'fuelPurchases') renderFuelPurchases();
}

function fgShowImportReport(fileName, tripCount, report, unknown) {
  const cnt = a => report.filter(x => x.action === a).length;
  const label = { created: 'создана запись', updated: 'добавлен ГЛОНАСС', same: 'без изменений', closed: 'месяц закрыт', skip: 'не ездила' };
  const color = { created: '#15803d', updated: '#1d4ed8', same: 'var(--text3)', closed: '#b45309', skip: 'var(--text3)' };
  const rows = report.slice().sort((a, b) => (a.d.v.plate || '').localeCompare(b.d.v.plate || '', 'ru') || a.d.date.localeCompare(b.d.date)).map(x => {
    const j = x.rec ? +x.rec.km || 0 : null;
    const diff = j != null ? j - x.d.km : null;
    return `<tr>
      <td>${fmtDate(x.d.date)}</td><td><b>${fpEsc(x.d.v.plate)}</b> ${fpEsc(x.d.v.make || '')}</td>
      <td style="color:${color[x.action]}">${label[x.action]}</td>
      <td style="text-align:right">${fpNum(x.d.km, 0)}</td>
      <td style="text-align:right">${j == null ? '—' : fpNum(j, 0)}${diff != null && Math.abs(diff) >= 20 ? `<div style="font-size:11px;color:var(--red)">${diff > 0 ? '+' : ''}${fpNum(diff, 0)} км</div>` : ''}</td>
      <td style="text-align:right">${x.d.sensor ? fpNum(x.d.fuel, 1) : '<span style="color:var(--text3)">нет данных</span>'}</td>
      <td style="text-align:right">${x.d.km >= 20 && x.d.sensor ? fpNum(x.d.fuel / x.d.km * 100, 1) : '—'}</td>
      <td style="text-align:right">${x.d.engine ? fpNum(x.d.engine, 1) : '—'}</td>
    </tr>`;
  }).join('');
  openGenericModal('Загрузка ГЛОНАСС: ' + fileName, `
    <div style="font-size:13px;margin-bottom:10px">Выездов в отчёте: <b>${tripCount}</b>, машино-дней: <b>${report.length}</b>.
      Добавлен ГЛОНАСС: <b>${cnt('updated')}</b>, создано записей: <b>${cnt('created')}</b>, без изменений: ${cnt('same')}${cnt('closed') ? ', в закрытом месяце: ' + cnt('closed') : ''}.</div>
    ${unknown.size ? `<div style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;border-radius:8px;padding:8px 12px;margin-bottom:10px;font-size:13px">
      Не найдены машины по номеру: ${[...unknown.keys()].map(fpEsc).join('; ')}</div>` : ''}
    <div style="max-height:55vh;overflow:auto"><table class="data-table" style="width:100%">
      <thead><tr><th>Дата</th><th>Машина</th><th>Что сделано</th><th style="text-align:right">ГЛОНАСС, км</th><th style="text-align:right">Журнал, км</th>
        <th style="text-align:right">Датчик, л</th><th style="text-align:right">Датчик, л/100</th><th style="text-align:right">Моточасы</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div style="font-size:12px;color:var(--text3);margin-top:8px">Пробег и одометр, внесённые водителем, не меняются: ГЛОНАСС пишется в отдельные поля.
      Сравнение и расход по датчику — во вкладке «ГЛОНАСС».</div>
    <div style="text-align:right;margin-top:10px"><button class="btn btn-primary" onclick="closeModal('genericModal')">Готово</button></div>`, 900);
}
