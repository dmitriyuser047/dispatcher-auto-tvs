// Отчёт по топливу: приход, расход по машинам и расход по ДЭС — в разрезе месяцев.
// Строки — техника (или объекты для прихода), сгруппированные по видам топлива,
// столбцы — месяцы. Внутри группы — промежуточный итог по виду топлива,
// внизу — общий итог. Показатель переключается кнопками.

// Ставка НДС. Суммы прихода хранятся без НДС — так же, как в карточке счёта
// 10.03.1, где налог учитывается отдельно на счёте 19.
const FUEL_VAT_RATE = 22;

let fuelRepYear   = String(new Date().getFullYear());
let fuelRepTab    = 'veh';       // 'in' — приход, 'veh' — расход ТС, 'gen' — расход ДЭС
let fuelRepMetric = 'issued';    // выбранный показатель
let fuelRepFuel   = '';          // фильтр по виду топлива, '' — все
let fuelRepView   = 'detail';    // 'detail' — по технике, 'fuel' — только итоги по видам топлива
let fuelRepDim    = 'object';    // приход: 'object' — по объектам, 'supplier' — по поставщикам
let fuelRepShowSkipped = false;  // показывать ли исключённые приходы

// Приходы, которые не идут в отчёт: это не закупка топлива у поставщика
// (ГПНЗ и Диэлком — свои перемещения и разовые поступления без накладной,
// приходы без источника — неизвестного происхождения).
const FR_IN_SKIP = [/гпнз/i, /диэлком/i, /перемещ/i];
function frIncomeSkipped(r) {
  const s = String(r.source || '').trim();
  return !s || FR_IN_SKIP.some(re => re.test(s));
}

const FR_MONTHS = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
const FR_TABS = { in: 'Приход', veh: 'Расход ТС', gen: 'Расход ДЭС' };
const FR_FUEL_ORDER = ['ДТ', 'АИ-92', 'АИ-95', 'АИ-98', 'АИ-100', 'Газ'];

// Показатель с парой (pair) выводится двумя колонками в каждом месяце —
// литры и сумма видны сразу, без переключения.
const FR_METRICS = {
  in: [
    { id:'both',   label:'Литры и сумма с НДС', pair:['litres', 'gross'] },
    { id:'litres', label:'Литры',          get:v => v.l,                              dec:1, short:'л' },
    { id:'net',    label:'Сумма без НДС',  get:v => v.s,                              dec:2 },
    { id:'vat',    label:'НДС ' + FUEL_VAT_RATE + '%', get:v => v.s * FUEL_VAT_RATE / 100, dec:2 },
    { id:'gross',  label:'Всего с НДС',    get:v => v.s * (1 + FUEL_VAT_RATE / 100),  dec:2, short:'₽ с НДС' },
    { id:'price',  label:'Цена за литр',   get:v => v.l ? v.s / v.l : null,           dec:2 },
    { id:'count',  label:'Поставок',       get:v => v.n,                              dec:0 },
  ],
  veh: [
    { id:'both',   label:'Литры и сумма',  pair:['issued', 'sum'] },
    { id:'issued', label:'Выдано, л',      get:v => v.iss,                            dec:1, short:'л' },
    { id:'norm',   label:'По норме, л',    get:v => v.norm,                           dec:1 },
    { id:'act',    label:'По факту, л',    get:v => v.act,                            dec:1 },
    { id:'dev',    label:'Отклонение, л',  get:v => v.norm ? v.act - v.norm : null,   dec:1, sign:true },
    { id:'devpct', label:'Отклонение, %',  get:v => v.norm ? (v.act - v.norm) / v.norm * 100 : null, dec:1, sign:true },
    { id:'sum',    label:'Сумма, ₽',       get:v => v.sum,                            dec:2, short:'₽' },
    { id:'price',  label:'Цена за литр',   get:v => v.sumL ? v.sum / v.sumL : null,   dec:2 },
    { id:'km',     label:'Пробег, км',     get:v => v.km,                             dec:0 },
  ],
  gen: [
    { id:'issued', label:'Выдано, л',      get:v => v.iss,                            dec:1 },
    { id:'norm',   label:'По норме, л',    get:v => v.norm,                           dec:1 },
    { id:'act',    label:'По факту, л',    get:v => v.act,                            dec:1 },
    { id:'dev',    label:'Отклонение, л',  get:v => v.norm ? v.act - v.norm : null,   dec:1, sign:true },
    { id:'devpct', label:'Отклонение, %',  get:v => v.norm ? (v.act - v.norm) / v.norm * 100 : null, dec:1, sign:true },
    { id:'hours',  label:'Моточасы',       get:v => v.h,                              dec:1 },
  ],
};

function fpNumSafe(v) {
  return (+v || 0).toLocaleString('ru', { maximumFractionDigits: 1 });
}

function frMetric() {
  const list = FR_METRICS[fuelRepTab];
  return list.find(m => m.id === fuelRepMetric) || list[0];
}

// Вид топлива. Марка из карточки точнее общего признака «бензин/дизель»:
// по ней и заправляют. Без марки — по признаку.
function frFuelLabel(fuel, grade) {
  const g = String(grade || '').toUpperCase().replace(/\s+/g, '');
  if (/^ДТ|ДИЗ/.test(g)) return 'ДТ';
  const ai = g.match(/АИ-?(\d{2,3})/);
  if (ai) return 'АИ-' + ai[1];
  if (fuel === 'gas') return 'Газ';
  if (fuel === 'gasoline') return 'Бензин';
  return 'ДТ';
}

function frFuelSort(a, b) {
  const ia = FR_FUEL_ORDER.indexOf(a), ib = FR_FUEL_ORDER.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b, 'ru');
}

function frYears() {
  const s = new Set();
  (data.tankIncomes || []).forEach(r => { if (r.date) s.add(r.date.slice(0, 4)); });
  (data.genRecords  || []).forEach(r => { if (r.date) s.add(r.date.slice(0, 4)); });
  (data.records     || []).forEach(r => { if (r.date) s.add(r.date.slice(0, 4)); });
  if (!s.size) s.add(String(new Date().getFullYear()));
  return [...s].sort().reverse();
}

function frEmptyCell(tab) {
  tab = tab || fuelRepTab;
  if (tab === 'in')  return { l:0, s:0, n:0 };
  if (tab === 'veh') return { iss:0, norm:0, act:0, km:0, sum:0, sumL:0, n:0 };
  return { iss:0, norm:0, act:0, h:0, n:0 };
}

function frAddCell(a, b) {
  const r = {};
  Object.keys(a).forEach(k => { r[k] = a[k] + (b[k] || 0); });
  return r;
}

function frCellEmpty(v) { return Object.keys(v).every(k => !v[k]); }

// Сырые строки отчёта: { key, label, fuel, cells[12] }
function frRows(tab, year) {
  const rows = {};
  const row = (key, label, fuel) =>
    rows[key] || (rows[key] = { key, label, fuel, cells: Array.from({ length: 12 }, () => frEmptyCell(tab)) });

  if (tab === 'in') {
    // Приход — только закупка. Перемещения между объектами исключены обеими
    // сторонами: у них нет ни накладной, ни НДС, а по компании один и тот же
    // объём считался бы дважды — при покупке и при перевозке.
    (data.tankIncomes || []).forEach(r => {
      if ((r.date || '').slice(0, 4) !== year || r.linkId || (+r.amount || 0) <= 0) return;
      if (!fuelRepShowSkipped && frIncomeSkipped(r)) return;
      const t = (data.tanks || []).find(x => x.id === r.tankId);
      // Разрез: объект (куда привезли) или поставщик (от кого) — поле «Источник»
      const label = fuelRepDim === 'supplier'
        ? ((r.source || '').trim() || 'Поставщик не указан')
        : (t ? (t.object || t.name) : '—');
      const c = row('t:' + label, label, frFuelLabel(t && t.fuel, 'ДТ')).cells[+r.date.slice(5, 7) - 1];
      c.l += +r.amount || 0;
      c.s += Math.abs(+r.sum || 0);
      c.n++;
    });
  } else if (tab === 'veh') {
    const byId = {};
    (data.vehicles || []).forEach(v => { byId[v.id] = v; });
    (data.records || []).forEach(r => {
      const v = byId[r.vehicleId];
      if (!v || (r.date || '').slice(0, 4) !== year) return;
      const issued = +r.fuelIssued || 0;
      const km = +r.km || 0;
      const norm = r.fuelUsed != null && r.fuelUsed !== ''
        ? (+r.fuelUsed || 0)
        : ((+v.norm || 0) && km ? km * (+v.norm) / 100 : 0);
      const act = r.fuelActual != null && r.fuelActual !== '' ? (+r.fuelActual || 0) : norm;
      if (!issued && !norm && !act && !km) return;
      // Вид топлива — из записи: если машину заправляли разным топливом,
      // у неё будет строка на каждый вид
      const fuel = recordFuelGrade(r, v);
      const label = [v.plate, v.make].filter(Boolean).join(' — ') || 'ТС без номера';
      const c = row('v:' + v.id + '|' + fuel, label, fuel).cells[+r.date.slice(5, 7) - 1];
      c.iss += issued; c.norm += norm; c.act += act; c.km += km; c.n++;
      // Цена — только по заправкам с известной суммой, иначе литры без суммы её занизят
      if (+r.fuelSum) { c.sum += +r.fuelSum; c.sumL += issued; }
    });
  } else {
    const byId = {};
    (data.generators || []).forEach(g => { byId[g.id] = g; });
    (data.genRecords || []).forEach(r => {
      const g = byId[r.generatorId];
      if (!g || (r.date || '').slice(0, 4) !== year) return;
      const place = g.location || (g.tankId ? ((data.tanks || []).find(t => t.id === g.tankId) || {}).object : '') || '';
      const label = (place ? place + ' · ' : '') + g.name;
      const c = row('g:' + g.id, label, frFuelLabel(g.fuel, '')).cells[+r.date.slice(5, 7) - 1];
      c.iss  += +r.fuelIssued || 0;
      c.norm += genNormSpent(g, r);
      c.act  += genActualSpent(g, r);
      c.h    += +r.hours || 0;
      c.n++;
    });
  }
  return Object.values(rows).filter(r => r.cells.some(c => !frCellEmpty(c)));
}

// Готовая к выводу таблица: строки с группами по виду топлива, итоги
function frBuild() {
  const tab = fuelRepTab;
  const all = frRows(tab, fuelRepYear);
  const fuels = [...new Set(all.map(r => r.fuel))].sort(frFuelSort);
  const rows = all.filter(r => !fuelRepFuel || r.fuel === fuelRepFuel);

  const months = [];
  for (let m = 0; m < 12; m++) if (rows.some(r => !frCellEmpty(r.cells[m]))) months.push(m);

  const total = cells => cells.reduce((s, c) => frAddCell(s, c), frEmptyCell(tab));
  const sumRows = list => Array.from({ length: 12 }, (_, m) => total(list.map(r => r.cells[m])));

  const groups = [...new Set(rows.map(r => r.fuel))].sort(frFuelSort).map(fuel => {
    const list = rows.filter(r => r.fuel === fuel).sort((a, b) => a.label.localeCompare(b.label, 'ru'));
    const cells = sumRows(list);
    return { fuel, rows: list, cells, tot: total(months.map(m => cells[m])) };
  });
  groups.forEach(g => g.rows.forEach(r => { r.tot = total(months.map(m => r.cells[m])); }));
  const grandCells = sumRows(rows);
  const grand = total(months.map(m => grandCells[m]));
  return { fuels, groups, months, grandCells, grand, count: rows.length };
}

// Переключатель в разделе «Отчёты»: топливо или платежи
function reportsKindSwitchHtml(active) {
  const b = (id, label) =>
    '<button class="sec-tab ' + (active === id ? 'active' : '') + '" onclick="reportKind=\'' + id + '\';switchSection(\'reports\')">' + label + '</button>';
  return '<div style="display:flex;gap:6px;margin-bottom:14px">' + b('fuel', 'Топливо') + b('payments', 'Платежи (оборотка)') + '</div>';
}

function renderFuelReport() {
  const years = frYears();
  if (!years.includes(fuelRepYear)) fuelRepYear = years[0];
  if (!FR_METRICS[fuelRepTab]) fuelRepTab = 'veh';
  if (!FR_METRICS[fuelRepTab].some(m => m.id === fuelRepMetric)) fuelRepMetric = FR_METRICS[fuelRepTab][0].id;

  const M = frMetric();
  const B = frBuild();
  if (fuelRepFuel && !B.fuels.includes(fuelRepFuel)) { fuelRepFuel = ''; return renderFuelReport(); }

// Пара показателей: две колонки в каждом месяце (литры и сумма)
  const list = FR_METRICS[fuelRepTab];
  const PAIR = M.pair ? M.pair.map(id => list.find(x => x.id === id)) : null;
  const span = PAIR ? 2 : 1;

  const fmtBy = (mm, v) => {
    if (v == null) return '—';
    if (!v && !mm.sign) return '<span style="color:var(--border)">—</span>';
    const s = v.toLocaleString('ru', { minimumFractionDigits: mm.dec, maximumFractionDigits: mm.dec });
    return (mm.sign && v > 0 ? '+' : '') + s;
  };
  const colorBy = (mm, v) => (!mm.sign || v == null || !v) ? '' : 'color:' + (v > 0 ? 'var(--red)' : 'var(--green)') + ';';
  const val = cell => M.get(cell);
  const fmt = v => fmtBy(M, v);
  const color = v => colorBy(M, v);

  const btn = (cls, active, onclick, label) =>
    '<button class="' + cls + (active ? ' active' : '') + '" onclick="' + onclick + '">' + label + '</button>';
  const tabBtns = Object.keys(FR_TABS).map(id =>
    btn('sec-tab', fuelRepTab === id, "fuelRepTab='" + id + "';fuelRepFuel='';fuelRepMetric='';renderFuelReport()", FR_TABS[id])).join('');
  const yearBtns = years.map(y => btn('mtab', fuelRepYear === y, "fuelRepYear='" + y + "';renderFuelReport()", y)).join('');
  const fuelBtns = B.fuels.length > 1
    ? btn('mtab', !fuelRepFuel, "fuelRepFuel='';renderFuelReport()", 'Все виды') +
      B.fuels.map(f => btn('mtab', fuelRepFuel === f, "fuelRepFuel='" + f + "';renderFuelReport()", f)).join('')
    : '';
  const skipped = fuelRepTab === 'in'
    ? (data.tankIncomes || []).filter(r => (r.date || '').slice(0, 4) === fuelRepYear && !r.linkId && (+r.amount || 0) > 0 && frIncomeSkipped(r))
    : [];
  const skippedL = skipped.reduce((s, r) => s + (+r.amount || 0), 0);
  const dimBtns = fuelRepTab === 'in'
    ? btn('mtab', fuelRepDim === 'object', "fuelRepDim='object';renderFuelReport()", 'По объектам') +
      btn('mtab', fuelRepDim === 'supplier', "fuelRepDim='supplier';renderFuelReport()", 'По поставщикам') +
      (skipped.length || fuelRepShowSkipped
        ? btn('mtab', fuelRepShowSkipped, "fuelRepShowSkipped=" + !fuelRepShowSkipped + ";renderFuelReport()",
            fuelRepShowSkipped ? 'Скрыть ГПНЗ, Диэлком и без поставщика' : 'Показать ГПНЗ, Диэлком и без поставщика')
        : '')
    : '';
  const viewBtns = btn('mtab', fuelRepView === 'detail', "fuelRepView='detail';renderFuelReport()", 'По технике') +
                   btn('mtab', fuelRepView === 'fuel', "fuelRepView='fuel';renderFuelReport()", 'Итоги по видам топлива');
  const metricBtns = FR_METRICS[fuelRepTab].map(m =>
    btn('mtab', fuelRepMetric === m.id, "fuelRepMetric='" + m.id + "';renderFuelReport()", m.label)).join('');

  const firstCol = fuelRepTab === 'in' ? (fuelRepDim === 'supplier' ? 'Поставщик' : 'Объект') : fuelRepTab === 'veh' ? 'Машина' : 'ДЭС';
  const stick = 'position:sticky;left:0;z-index:1;';
  const colCount = B.months.length * span + span + 1;
  const firstTh = '<th ' + (PAIR ? 'rowspan="2" ' : '') + 'style="' + stick + 'z-index:2;background:var(--bg2);min-width:240px">' +
    (fuelRepView === 'fuel' ? 'Вид топлива' : firstCol) + '</th>';
  let head;
  if (PAIR) {
    const sub = (mm, extra) => '<th style="text-align:right;min-width:92px;font-weight:400;color:var(--text3);' + (extra || '') + '">' + (mm.short || mm.label) + '</th>';
    head = '<tr>' + firstTh +
      B.months.map(m => '<th colspan="2" style="text-align:center">' + FR_MONTHS[m] + '</th>').join('') +
      '<th colspan="2" style="text-align:center;border-left:2px solid var(--border)">Итого</th></tr><tr>' +
      B.months.map(() => sub(PAIR[0]) + sub(PAIR[1])).join('') +
      sub(PAIR[0], 'border-left:2px solid var(--border);') + sub(PAIR[1]) + '</tr>';
  } else {
    head = '<tr>' + firstTh +
      B.months.map(m => '<th style="text-align:right;min-width:86px">' + FR_MONTHS[m] + '</th>').join('') +
      '<th style="text-align:right;min-width:105px;border-left:2px solid var(--border)">Итого</th></tr>';
  }

  const line = (label, cells, tot, kind) => {
    const bg = kind === 'grand' ? 'var(--bg2)' : kind === 'sub' ? 'var(--bg2)' : 'var(--bg1)';
    const w = kind === 'grand' ? 'font-weight:800;' : kind === 'sub' ? 'font-weight:700;' : '';
    let h = '<tr' + (kind === 'grand' ? ' style="border-top:2px solid var(--border)"' : '') + '>' +
      '<td style="' + stick + 'background:' + bg + ';' + w + (kind === 'row' ? 'padding-left:18px;' : '') + '">' + label + '</td>';
    if (PAIR) {
      B.months.forEach(m => PAIR.forEach(mm => {
        const v = mm.get(cells[m]);
        h += '<td style="text-align:right;' + w + colorBy(mm, v) + '">' + fmtBy(mm, v) + '</td>';
      }));
      PAIR.forEach((mm, i) => {
        const v = mm.get(tot);
        h += '<td style="text-align:right;font-weight:700;' + (i ? '' : 'border-left:2px solid var(--border);') + w + colorBy(mm, v) + '">' + fmtBy(mm, v) + '</td>';
      });
      return h + '</tr>';
    }
    B.months.forEach(m => { const v = val(cells[m]); h += '<td style="text-align:right;' + w + color(v) + '">' + fmt(v) + '</td>'; });
    const tv = val(tot);
    h += '<td style="text-align:right;font-weight:700;border-left:2px solid var(--border);' + w + color(tv) + '">' + fmt(tv) + '</td></tr>';
    return h;
  };

  let body = '';
  if (!B.count) {
    body = '<tr><td colspan="' + colCount + '" style="text-align:center;color:var(--text3);padding:16px">Нет данных за ' + fuelRepYear + '</td></tr>';
  } else if (fuelRepView === 'fuel') {
    B.groups.forEach(g => { body += line(g.fuel, g.cells, g.tot, 'sub'); });
    if (B.groups.length > 1) body += line('ИТОГО', B.grandCells, B.grand, 'grand');
  } else {
    const many = B.groups.length > 1;
    B.groups.forEach(g => {
      if (many) body += '<tr><td colspan="' + colCount + '" style="' + stick + 'background:var(--bg2);font-weight:700;color:var(--text2)">' + g.fuel + '</td></tr>';
      g.rows.forEach(r => { body += line(r.label, r.cells, r.tot, 'row'); });
      if (many) body += line('Итого ' + g.fuel, g.cells, g.tot, 'sub');
    });
    body += line('ИТОГО', B.grandCells, B.grand, 'grand');
  }

  const hint = {
    in:  'Суммы в базе хранятся без НДС — как в карточке счёта 10.03.1, где налог идёт отдельно на счёте 19; «с НДС» — плюс ' + FUEL_VAT_RATE + '%. ' +
         'Цена за литр — от суммы без НДС. Поставщик берётся из поля «Источник» прихода в ёмкость. ' +
         'Перемещения между объектами в приход не входят: это не закупка.' +
         (skipped.length && !fuelRepShowSkipped
           ? ' Не включены приходы ГПНЗ, Диэлком и без указанного поставщика: ' + skipped.length + ' шт. на ' +
             fpNumSafe(skippedL) + ' л — их видно кнопкой выше.'
           : ''),
    veh: '«Выдано» — заправлено в машину. «По норме» — расход по норме за пробег. «По факту» — реально израсходовано. ' +
         'Вид топлива — по марке из карточки машины. Перерасход красным, экономия зелёной.',
    gen: '«Выдано» — отпущено в ДЭС. «По норме» — расход при фактической нагрузке, умноженный на моточасы. ' +
         '«По факту» — реально израсходовано. Перерасход красным, экономия зелёной.',
  }[fuelRepTab];

  const fromReports = activeSection === 'reports';
  document.getElementById('mainContent').innerHTML =
    '<div style="padding:4px 0 14px">' +
      (fromReports ? reportsKindSwitchHtml('fuel') : '<div class="section-header" style="margin-bottom:10px"><div class="section-title">Отчёт по топливу</div></div>') +
      '<div style="display:flex;gap:6px;margin-bottom:12px">' + tabBtns + '</div>' +
      '<div class="month-tabs" style="margin-bottom:10px">' + yearBtns + '</div>' +
      (dimBtns ? '<div class="month-tabs" style="margin-bottom:10px">' + dimBtns + '</div>' : '') +
      (fuelBtns ? '<div class="month-tabs" style="margin-bottom:10px">' + fuelBtns + '</div>' : '') +
      '<div class="month-tabs" style="margin-bottom:10px">' + viewBtns + '</div>' +
      '<div class="month-tabs" style="margin-bottom:14px">' + metricBtns + '</div>' +
      '<div class="table-wrap"><div class="table-toolbar">' +
        '<div class="table-toolbar-left">' + FR_TABS[fuelRepTab] + ' · ' + M.label + ' за ' + fuelRepYear +
          (fuelRepFuel ? ' · ' + fuelRepFuel : '') + '</div>' +
        (fuelRepTab === 'in' ? '<button class="btn btn-ghost btn-sm" onclick="exportFuelIncomeSummaryXlsx()" title="Объекты и поставщики: литры, цена за литр и сумма по месяцам в одной таблице">Сводная по объектам и поставщикам</button> ' : '') +
        '<button class="btn btn-ghost btn-sm" onclick="exportFuelReportXlsx()">Выгрузить в Excel</button>' +
      '</div><div class="table-scroll" style="overflow-x:auto">' +
        '<table class="data-table" style="width:100%"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>' +
      '</div></div>' +
      '<div style="font-size:12px;color:var(--text3);margin-top:10px">' + hint + '</div>' +
    '</div>';
}

// В Excel уходят все показатели вкладки — отдельным блоком каждый.
// Оформление сдержанное: тёмная шапка, серые линии, зебра по строкам.
// Цветом выделяется только отклонение — там знак и есть смысл показателя.
function exportFuelReportXlsx() {
  const B = frBuild();
  if (!B.count) { alert('Нет данных за ' + fuelRepYear); return; }
  const { groups, months, grandCells, grand } = B;

  const P = { dark:'0F1117', navy:'1B3A6B', white:'FFFFFF', gray1:'F8FAFC', gray2:'F1F5F9',
              gray3:'E2E8F0', gray4:'94A3B8', text:'1E293B', red:'B91C1C', green:'15803D' };
  const bd = (style, rgb) => ({ style, color:{ rgb } });
  const bAll = (style, rgb) => { const b = bd(style, rgb); return { top:b, bottom:b, left:b, right:b }; };
  const st = (font, fill, align, border) => ({
    font: font || {},
    fill: fill ? { patternType:'solid', fgColor:{ rgb: fill } } : { patternType:'none' },
    alignment: align || { vertical:'center' },
    border: border || {},
  });
  const num = dec => (dec === 0 ? '#,##0' : dec === 1 ? '#,##0.0' : '#,##0.00');
  const L = (bold, fill, indent) => st({ bold, sz:10, color:{ rgb:P.text } }, fill,
    { horizontal:'left', vertical:'center', indent: indent || 1 }, bAll('thin', bold ? P.gray4 : P.gray3));
  const R = (bold, fill, rgb) => st({ bold, sz:10, color:{ rgb: rgb || P.text } }, fill,
    { horizontal:'right', vertical:'center' }, bAll('thin', bold ? P.gray4 : P.gray3));
  const S = {
    title:   st({ bold:true, sz:14, color:{ rgb:P.white } }, P.dark, { horizontal:'center', vertical:'center' }, bAll('medium', P.dark)),
    caption: st({ bold:true, sz:11, color:{ rgb:P.text } }, null, { horizontal:'left', vertical:'center' }),
    head:    st({ bold:true, sz:10, color:{ rgb:P.white } }, P.navy, { horizontal:'center', vertical:'center', wrapText:true }, bAll('thin', P.navy)),
    headL:   st({ bold:true, sz:10, color:{ rgb:P.white } }, P.navy, { horizontal:'left', vertical:'center', indent:1 }, bAll('thin', P.navy)),
    group:   st({ bold:true, sz:10, color:{ rgb:P.navy } }, P.gray2, { horizontal:'left', vertical:'center', indent:1 }, bAll('thin', P.gray3)),
  };

  // Парный показатель занимает две колонки на месяц — лист считаем по нему
  const hasPair = FR_METRICS[fuelRepTab].some(m => m.pair);
  const NC = months.length * (hasPair ? 2 : 1) + (hasPair ? 2 : 1);
  const ws = { '!merges': [], '!rows': [] };
  let row = 0;
  const put = (r, c, v, s, z) => {
    const cell = { v: v == null ? '' : v, t: typeof v === 'number' ? 'n' : 's', s };
    if (z && typeof v === 'number') cell.z = z;
    ws[XLSX.utils.encode_cell({ r, c })] = cell;
    ws['!ref'] = XLSX.utils.encode_range({ s:{ r:0, c:0 }, e:{ r, c:NC } });
  };
  const fill = (r, s) => { for (let c = 0; c <= NC; c++) if (!ws[XLSX.utils.encode_cell({ r, c })]) put(r, c, '', s); };
  const rowH = (r, hpt) => { ws['!rows'][r] = { hpt }; };

  const tabTitle = { in:'ПРИХОД ТОПЛИВА', veh:'РАСХОД ТОПЛИВА — ТРАНСПОРТ', gen:'РАСХОД ТОПЛИВА — ДЭС' }[fuelRepTab];
  put(row, 0, tabTitle + ' — ' + fuelRepYear + ' Г.' + (fuelRepFuel ? ' — ' + fuelRepFuel : ''), S.title);
  ws['!merges'].push({ s:{ r:row, c:0 }, e:{ r:row, c:NC } });
  fill(row, S.title); rowH(row, 30); row += 2;

  const firstCol = fuelRepTab === 'in' ? (fuelRepDim === 'supplier' ? 'Поставщик' : 'Объект') : fuelRepTab === 'veh' ? 'Машина' : 'ДЭС';
  const many = groups.length > 1;

  FR_METRICS[fuelRepTab].forEach(M => {
    const list = FR_METRICS[fuelRepTab];
    const PAIR = M.pair ? M.pair.map(id => list.find(x => x.id === id)) : null;
    const span = PAIR ? 2 : 1;
    const cellVal = (mm, c) => { const v = mm.get(c); return v == null ? '—' : +v.toFixed(mm.dec); };
    const tint = (mm, v) => (mm.sign && typeof v === 'number' && v) ? (v > 0 ? P.red : P.green) : null;
    const writeLine = (label, cells, tot, kind, bg) => {
      const bold = kind !== 'row';
      const f = kind === 'grand' ? P.gray3 : kind === 'sub' ? P.gray2 : bg;
      put(row, 0, label, L(bold, f, kind === 'row' && many ? 2 : 1));
      const src = months.map(m => cells[m]).concat([tot]);
      src.forEach((c, k) => {
        (PAIR || [M]).forEach((mm, j) => {
          const v = cellVal(mm, c);
          put(row, k * span + j + 1, v, R(bold, f, kind === 'row' ? tint(mm, v) : null), num(mm.dec));
        });
      });
      if (kind === 'grand') rowH(row, 20);
      row++;
    };

    put(row, 0, M.label, S.caption); rowH(row, 18); row++;
    put(row, 0, fuelRepView === 'fuel' ? 'Вид топлива' : firstCol, PAIR ? S.headL : S.headL);
    if (PAIR) {
      // Месяц — над парой колонок, под ним подписи «л» и «₽ с НДС»
      ws['!merges'].push({ s:{ r:row, c:0 }, e:{ r:row + 1, c:0 } });
      months.forEach((m, i) => {
        put(row, i * 2 + 1, FR_MONTHS[m], S.head);
        put(row, i * 2 + 2, '', S.head);
        ws['!merges'].push({ s:{ r:row, c:i * 2 + 1 }, e:{ r:row, c:i * 2 + 2 } });
      });
      put(row, NC - 1, 'Итого', S.head); put(row, NC, '', S.head);
      ws['!merges'].push({ s:{ r:row, c:NC - 1 }, e:{ r:row, c:NC } });
      rowH(row, 20); row++;
      months.concat(['tot']).forEach((m, i) => PAIR.forEach((mm, j) =>
        put(row, i * 2 + j + 1, mm.short || mm.label, S.head)));
      rowH(row, 18); row++;
    } else {
      months.forEach((m, i) => put(row, i + 1, FR_MONTHS[m], S.head));
      put(row, months.length + 1, 'Итого', S.head);
      for (let c = months.length + 2; c <= NC; c++) put(row, c, '', S.head);
      rowH(row, 22); row++;
    }

    if (fuelRepView === 'fuel') {
      groups.forEach(g => writeLine(g.fuel, g.cells, g.tot, 'sub'));
      if (many) writeLine('ИТОГО', grandCells, grand, 'grand');
    } else {
      groups.forEach(g => {
        if (many) {
          put(row, 0, g.fuel, S.group);
          ws['!merges'].push({ s:{ r:row, c:0 }, e:{ r:row, c:NC } });
          fill(row, S.group); row++;
        }
        g.rows.forEach((r, i) => writeLine(r.label, r.cells, r.tot, 'row', i % 2 ? P.gray1 : P.white));
        if (many) writeLine('Итого ' + g.fuel, g.cells, g.tot, 'sub');
      });
      writeLine('ИТОГО', grandCells, grand, 'grand');
    }
    row++;
  });

  ws['!cols'] = [{ wch: 46 }].concat(
    hasPair ? months.flatMap(() => [{ wch: 12 }, { wch: 15 }]).concat([{ wch: 13 }, { wch: 16 }])
            : months.map(() => ({ wch: 13 })).concat([{ wch: 15 }]));
  const wb = XLSX.utils.book_new();
  const short = { in:'Приход', veh:'Расход ТС', gen:'Расход ДЭС' }[fuelRepTab];
  XLSX.utils.book_append_sheet(wb, ws, short + ' ' + fuelRepYear);
  XLSX.writeFile(wb, 'Топливо_' + short.replace(/\s+/g, '_') + '_' + fuelRepYear + (fuelRepFuel ? '_' + fuelRepFuel : '') + '.xlsx');
}


// ─── Сводная по приходу: объект → поставщик, по месяцам ───
// Одна таблица: в каждом месяце литры, цена за литр и сумма. Суммы с НДС,
// цена — из суммы с НДС; в базе суммы хранятся без НДС.
function frIncomeSummary(year) {
  const objs = new Map();
  (data.tankIncomes || []).forEach(r => {
    if ((r.date || '').slice(0, 4) !== year || r.linkId || (+r.amount || 0) <= 0) return;
    if (frIncomeSkipped(r)) return;
    const t = (data.tanks || []).find(x => x.id === r.tankId);
    const obj = t ? (t.object || t.name) : '—';
    const sup = (r.source || '').trim() || 'Поставщик не указан';
    const o = objs.get(obj) || { obj, sup: new Map() };
    const s = o.sup.get(sup) || { sup, m: Array.from({ length: 12 }, () => ({ l: 0, s: 0 })) };
    const c = s.m[+r.date.slice(5, 7) - 1];
    c.l += +r.amount || 0;
    c.s += Math.abs(+r.sum || 0) * (1 + FUEL_VAT_RATE / 100);
    s.sup = sup; o.sup.set(sup, s); objs.set(obj, o);
  });
  const months = [];
  for (let m = 0; m < 12; m++) {
    let has = false;
    objs.forEach(o => o.sup.forEach(s => { if (s.m[m].l) has = true; }));
    if (has) months.push(m);
  }
  return { objs: [...objs.values()].sort((a, b) => a.obj.localeCompare(b.obj, 'ru')), months };
}

function exportFuelIncomeSummaryXlsx() {
  const { objs, months } = frIncomeSummary(fuelRepYear);
  if (!objs.length) { alert('Нет приходов за ' + fuelRepYear); return; }

  const P = { navy: '1B3A6B', navyLight: 'D6E4F7', white: 'FFFFFF', gray1: 'F8FAFC', gray3: 'E2E8F0', text: '1E293B' };
  const bd = (st, rgb) => ({ style: st, color: { rgb } });
  const bAll = (st, rgb) => { const b = bd(st, rgb); return { top: b, bottom: b, left: b, right: b }; };
  const cs = (font, fill, align, border) => ({ font: font || {},
    fill: fill ? { patternType: 'solid', fgColor: { rgb: fill } } : { patternType: 'none' },
    alignment: align || { vertical: 'center' }, border: border || {} });
  const S = {
    title: cs({ bold: true, sz: 14, color: { rgb: P.white } }, '0F1117', { horizontal: 'center', vertical: 'center' }, bAll('medium', '0F1117')),
    head:  cs({ bold: true, sz: 10, color: { rgb: P.white } }, P.navy, { horizontal: 'center', vertical: 'center', wrapText: true }, bAll('thin', P.navy)),
    headL: cs({ bold: true, sz: 10, color: { rgb: P.white } }, P.navy, { horizontal: 'left', vertical: 'center', indent: 1 }, bAll('thin', P.navy)),
    objL:  cs({ bold: true, sz: 10, color: { rgb: P.navy } }, P.navyLight, { horizontal: 'left', vertical: 'center', indent: 1 }, bAll('thin', P.navy)),
    objN:  cs({ bold: true, sz: 10, color: { rgb: P.navy } }, P.navyLight, { horizontal: 'right', vertical: 'center' }, bAll('thin', P.navy)),
    totL:  cs({ bold: true, sz: 11, color: { rgb: P.text } }, P.gray3, { horizontal: 'left', vertical: 'center', indent: 1 }, bAll('medium', P.navy)),
    totN:  cs({ bold: true, sz: 11, color: { rgb: P.text } }, P.gray3, { horizontal: 'right', vertical: 'center' }, bAll('medium', P.navy)),
  };
  const L = (bg, indent) => cs({ sz: 10, color: { rgb: P.text } }, bg, { horizontal: 'left', vertical: 'center', indent: indent || 1, wrapText: true }, bAll('thin', P.gray3));
  const R = (bg) => cs({ sz: 10, color: { rgb: P.text } }, bg, { horizontal: 'right', vertical: 'center' }, bAll('thin', P.gray3));

  const NC = 1 + (months.length + 1) * 3;
  const ws = { '!merges': [], '!rows': [] };
  let row = 0;
  const put = (r, c, v, s, z) => {
    const cell = { v: v == null ? '' : v, t: typeof v === 'number' ? 'n' : 's', s };
    if (z && typeof v === 'number') cell.z = z;
    ws[XLSX.utils.encode_cell({ r, c })] = cell;
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r, c: NC } });
  };
  const fill = (r, s) => { for (let c = 0; c <= NC; c++) if (!ws[XLSX.utils.encode_cell({ r, c })]) put(r, c, '', s); };

  put(row, 0, 'ПРИХОД ТОПЛИВА ПО ОБЪЕКТАМ И ПОСТАВЩИКАМ — ' + fuelRepYear + ' Г. (суммы с НДС ' + FUEL_VAT_RATE + '%)', S.title);
  ws['!merges'].push({ s: { r: row, c: 0 }, e: { r: row, c: NC } });
  fill(row, S.title); ws['!rows'][row] = { hpt: 30 }; row += 2;

  // шапка: месяц над тройкой колонок
  const hRow = row, sRow = row + 1;
  put(hRow, 0, 'Объект', S.headL); put(hRow, 1, 'Поставщик', S.headL);
  ws['!merges'].push({ s: { r: hRow, c: 0 }, e: { r: sRow, c: 0 } });
  ws['!merges'].push({ s: { r: hRow, c: 1 }, e: { r: sRow, c: 1 } });
  const blocks = months.map(m => FR_MONTHS[m]).concat(['Итого']);
  blocks.forEach((name, i) => {
    const c0 = 2 + i * 3;
    put(hRow, c0, name, S.head); put(hRow, c0 + 1, '', S.head); put(hRow, c0 + 2, '', S.head);
    ws['!merges'].push({ s: { r: hRow, c: c0 }, e: { r: hRow, c: c0 + 2 } });
    ['Литры', 'Цена, ₽/л', 'Сумма, ₽'].forEach((t, k) => put(sRow, c0 + k, t, S.head));
  });
  ws['!rows'][hRow] = { hpt: 20 }; ws['!rows'][sRow] = { hpt: 20 };
  row += 2;

  const r2 = x => Math.round((+x || 0) * 100) / 100;
  const writeCells = (cells, tot, sL, sN) => {
    cells.concat([tot]).forEach((c, i) => {
      const c0 = 2 + i * 3;
      put(row, c0, c.l ? r2(c.l) : '—', sN, '#,##0.0');
      put(row, c0 + 1, c.l && c.s ? r2(c.s / c.l) : '—', sN, '#,##0.00');
      put(row, c0 + 2, c.s ? r2(c.s) : '—', sN, '#,##0.00');
    });
  };
  const sumCells = list => {
    const out = months.map(m => list.reduce((a, s) => ({ l: a.l + s.m[m].l, s: a.s + s.m[m].s }), { l: 0, s: 0 }));
    const tot = out.reduce((a, c) => ({ l: a.l + c.l, s: a.s + c.s }), { l: 0, s: 0 });
    return { cells: out, tot };
  };

  const all = [];
  objs.forEach((o, oi) => {
    const sups = [...o.sup.values()].sort((a, b) => a.sup.localeCompare(b.sup, 'ru'));
    sups.forEach((s, i) => {
      all.push(s);
      const bg = i % 2 ? P.gray1 : P.white;
      put(row, 0, i === 0 ? o.obj : '', L(bg));
      put(row, 1, s.sup, L(bg, 2));
      const cells = months.map(m => s.m[m]);
      const tot = cells.reduce((a, c) => ({ l: a.l + c.l, s: a.s + c.s }), { l: 0, s: 0 });
      writeCells(cells, tot, L(bg), R(bg));
      row++;
    });
    if (sups.length > 1) {
      const { cells, tot } = sumCells(sups);
      put(row, 0, 'Итого ' + o.obj, S.objL); put(row, 1, '', S.objL);
      writeCells(cells, tot, S.objL, S.objN);
      row++;
    }
    if (sups.length) ws['!merges'].push({ s: { r: row - sups.length - (sups.length > 1 ? 1 : 0), c: 0 }, e: { r: row - 1 - (sups.length > 1 ? 1 : 0), c: 0 } });
  });
  const { cells, tot } = sumCells(all);
  put(row, 0, 'ВСЕГО', S.totL); put(row, 1, '', S.totL);
  writeCells(cells, tot, S.totL, S.totN);
  ws['!rows'][row] = { hpt: 22 };

  ws['!cols'] = [{ wch: 26 }, { wch: 28 }].concat(blocks.flatMap(() => [{ wch: 11 }, { wch: 10 }, { wch: 14 }]));
  ws['!freeze'] = { xSplit: 2, ySplit: sRow + 1 };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Приход ' + fuelRepYear);
  XLSX.writeFile(wb, 'Приход_топлива_объекты_поставщики_' + fuelRepYear + '.xlsx');
}
