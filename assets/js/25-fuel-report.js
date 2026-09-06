// Отчёт по топливу: приход и расход в разрезе месяцев.
// Строки — объекты, столбцы — месяцы, последний столбец и строка — итоги.
// Показатель переключается кнопками: литры, суммы, нормы, отклонение.

// Ставка НДС. Суммы прихода хранятся без НДС — так же, как в карточке счёта
// 10.03.1, где налог учитывается отдельно на счёте 19.
const FUEL_VAT_RATE = 22;

let fuelRepYear   = String(new Date().getFullYear());
let fuelRepTab    = 'in';        // 'in' — приход, 'out' — расход
let fuelRepMetric = 'litres';    // выбранный показатель

const FR_MONTHS = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];

// Показатели: как считать из накопленных сумм и как выводить
const FR_METRICS = {
  in: [
    { id:'litres', label:'Литры',          get:v => v.l,                      dec:1 },
    { id:'net',    label:'Сумма без НДС',  get:v => v.s,                      dec:2 },
    { id:'vat',    label:'НДС ' + FUEL_VAT_RATE + '%', get:v => v.s * FUEL_VAT_RATE / 100, dec:2 },
    { id:'gross',  label:'Всего с НДС',    get:v => v.s * (1 + FUEL_VAT_RATE / 100), dec:2 },
    { id:'price',  label:'Цена за литр',   get:v => v.l ? v.s / v.l : 0,      dec:2 },
    { id:'count',  label:'Поставок',       get:v => v.n,                      dec:0 },
  ],
  out: [
    { id:'issued', label:'Выдано, л',      get:v => v.iss,                    dec:1 },
    { id:'norm',   label:'По норме, л',    get:v => v.norm,                   dec:1 },
    { id:'act',    label:'По факту, л',    get:v => v.act,                    dec:1 },
    { id:'dev',    label:'Отклонение, л',  get:v => v.act - v.norm,           dec:1, sign:true },
    { id:'devpct', label:'Отклонение, %',  get:v => v.norm ? (v.act - v.norm) / v.norm * 100 : null, dec:1, sign:true },
    { id:'hours',  label:'Моточасы',       get:v => v.h,                      dec:1 },
  ],
};

function frMetric() {
  const list = FR_METRICS[fuelRepTab];
  return list.find(m => m.id === fuelRepMetric) || list[0];
}

function frTankObject(tankId) {
  const t = (data.tanks || []).find(x => x.id === tankId);
  return t ? (t.object || t.name) : '—';
}

function frYears() {
  const s = new Set();
  (data.tankIncomes || []).forEach(r => { if (r.date) s.add(r.date.slice(0, 4)); });
  (data.genRecords  || []).forEach(r => { if (r.date) s.add(r.date.slice(0, 4)); });
  if (!s.size) s.add(String(new Date().getFullYear()));
  return [...s].sort().reverse();
}

// Приход — только закупка. Перемещения между объектами исключены обеими
// сторонами: это не покупка, у них нет ни накладной, ни НДС, а по компании
// один и тот же объём считался бы дважды — при покупке и при перевозке.
function frGridIncome(year) {
  const g = {};
  (data.tankIncomes || []).forEach(r => {
    if ((r.date || '').slice(0, 4) !== year || r.linkId || (+r.amount || 0) <= 0) return;
    const o = frTankObject(r.tankId), m = +r.date.slice(5, 7) - 1;
    g[o] = g[o] || Array.from({ length: 12 }, () => ({ l:0, s:0, n:0 }));
    g[o][m].l += +r.amount || 0;
    g[o][m].s += Math.abs(+r.sum || 0);
    g[o][m].n++;
  });
  return g;
}

function frGridSpend(year) {
  const linked = {};
  (data.generators || []).forEach(x => { if (x.tankId) linked[x.id] = x; });
  const g = {};
  (data.genRecords || []).forEach(r => {
    const gen = linked[r.generatorId];
    if (!gen || (r.date || '').slice(0, 4) !== year) return;
    const o = frTankObject(gen.tankId), m = +r.date.slice(5, 7) - 1;
    g[o] = g[o] || Array.from({ length: 12 }, () => ({ iss:0, norm:0, act:0, h:0, n:0 }));
    g[o][m].iss  += +r.fuelIssued || 0;
    g[o][m].norm += genNormSpent(gen, r);
    g[o][m].act  += genActualSpent(gen, r);
    g[o][m].h    += +r.hours || 0;
    g[o][m].n++;
  });
  return g;
}

function frEmptyCell() {
  return fuelRepTab === 'in' ? { l:0, s:0, n:0 } : { iss:0, norm:0, act:0, h:0, n:0 };
}

function frAddCell(a, b) {
  const r = {};
  Object.keys(a).forEach(k => { r[k] = a[k] + b[k]; });
  return r;
}

function frCellEmpty(v) {
  return Object.keys(v).every(k => !v[k]);
}

// Данные отчёта: сетка объект × месяц, итоги по строкам и столбцам
function frBuild() {
  const grid = fuelRepTab === 'in' ? frGridIncome(fuelRepYear) : frGridSpend(fuelRepYear);
  const objs = Object.keys(grid).sort();
  const months = [];
  for (let m = 0; m < 12; m++) {
    if (objs.some(o => !frCellEmpty(grid[o][m]))) months.push(m);
  }
  const rowTot = {}, colTot = {};
  let grand = frEmptyCell();
  objs.forEach(o => {
    rowTot[o] = months.reduce((s, m) => frAddCell(s, grid[o][m]), frEmptyCell());
  });
  months.forEach(m => {
    colTot[m] = objs.reduce((s, o) => frAddCell(s, grid[o][m]), frEmptyCell());
    grand = frAddCell(grand, colTot[m]);
  });
  return { grid, objs, months, rowTot, colTot, grand };
}

function renderFuelReport() {
  const years = frYears();
  if (!years.includes(fuelRepYear)) fuelRepYear = years[0];
  if (!FR_METRICS[fuelRepTab].some(m => m.id === fuelRepMetric)) fuelRepMetric = FR_METRICS[fuelRepTab][0].id;

  const M = frMetric();
  const { grid, objs, months, rowTot, colTot, grand } = frBuild();

  const fmt = (v, cell) => {
    if (v == null) return '—';
    if (M.id === 'price' && (!cell || !cell.l)) return '—';
    if (M.id === 'devpct' && (!cell || !cell.norm)) return '—';
    if (!v && M.id !== 'devpct') return '<span style="color:var(--border)">—</span>';
    const s = v.toLocaleString('ru', { minimumFractionDigits: M.dec, maximumFractionDigits: M.dec });
    return (M.sign && v > 0 ? '+' : '') + s;
  };
  const devColor = (v, cell) => {
    if (!M.sign || v == null || !cell || !cell.norm) return '';
    return 'color:' + (v > 0 ? 'var(--red)' : v < 0 ? 'var(--green)' : 'var(--text3)') + ';';
  };

  const yearTabs = years.map(y =>
    '<button class="mtab ' + (fuelRepYear === y ? 'active' : '') + '" onclick="fuelRepYear=\'' + y + '\';renderFuelReport()">' + y + '</button>').join('');
  const tabBtn = (id, label) =>
    '<button class="sec-tab ' + (fuelRepTab === id ? 'active' : '') + '" onclick="fuelRepTab=\'' + id + '\';renderFuelReport()">' + label + '</button>';
  const metricBtns = FR_METRICS[fuelRepTab].map(m =>
    '<button class="mtab ' + (fuelRepMetric === m.id ? 'active' : '') + '" onclick="fuelRepMetric=\'' + m.id + '\';renderFuelReport()">' + m.label + '</button>').join('');

  let head = '<tr><th style="position:sticky;left:0;background:var(--bg2);z-index:2;min-width:170px">Объект</th>';
  months.forEach(m => { head += '<th style="text-align:right;min-width:88px">' + FR_MONTHS[m] + '</th>'; });
  head += '<th style="text-align:right;min-width:105px;border-left:2px solid var(--border)">Итого</th></tr>';

  let body = '';
  objs.forEach(o => {
    body += '<tr><td style="position:sticky;left:0;background:var(--bg1);z-index:1;font-weight:500">' + o + '</td>';
    months.forEach(m => {
      const c = grid[o][m], v = M.get(c);
      body += '<td style="text-align:right;' + devColor(v, c) + '">' + fmt(v, c) + '</td>';
    });
    const rt = rowTot[o], rv = M.get(rt);
    body += '<td style="text-align:right;font-weight:700;border-left:2px solid var(--border);' + devColor(rv, rt) + '">' + fmt(rv, rt) + '</td></tr>';
  });
  if (objs.length) {
    body += '<tr style="border-top:2px solid var(--border)"><td style="position:sticky;left:0;background:var(--bg2);z-index:1;font-weight:700">ИТОГО</td>';
    months.forEach(m => {
      const c = colTot[m], v = M.get(c);
      body += '<td style="text-align:right;font-weight:700;' + devColor(v, c) + '">' + fmt(v, c) + '</td>';
    });
    const gv = M.get(grand);
    body += '<td style="text-align:right;font-weight:800;border-left:2px solid var(--border);' + devColor(gv, grand) + '">' + fmt(gv, grand) + '</td></tr>';
  } else {
    body = '<tr><td colspan="' + (months.length + 2) + '" style="text-align:center;color:var(--text3);padding:16px">Нет данных за ' + fuelRepYear + '</td></tr>';
  }

  const hint = fuelRepTab === 'in'
    ? 'Суммы хранятся без НДС — как в карточке счёта 10.03.1, где налог идёт отдельно на счёте 19. ' +
      'Цена за литр считается от суммы без НДС. Перемещения между объектами в приход не входят: это не закупка.'
    : '«По норме» — расход при фактической нагрузке, умноженный на моточасы. «По факту» — реально израсходовано. ' +
      'Перерасход красным, экономия зелёной. Прочерк значит, что у ДЭС не заполнена норма или в записи нет моточасов.';

  document.getElementById('mainContent').innerHTML =
    '<div style="padding:4px 0 14px">' +
      '<div class="section-header" style="margin-bottom:10px"><div class="section-title">Отчёт по топливу</div></div>' +
      '<div style="display:flex;gap:6px;margin-bottom:12px">' + tabBtn('in', 'Приход') + tabBtn('out', 'Расход') + '</div>' +
      '<div class="month-tabs" style="margin-bottom:10px">' + yearTabs + '</div>' +
      '<div class="month-tabs" style="margin-bottom:14px">' + metricBtns + '</div>' +
      '<div class="table-wrap"><div class="table-toolbar">' +
        '<div class="table-toolbar-left">' + M.label + ' за ' + fuelRepYear + ' по месяцам</div>' +
        '<button class="btn btn-ghost btn-sm" onclick="exportFuelReportXlsx()">Выгрузить в Excel</button>' +
      '</div><div class="table-scroll" style="overflow-x:auto">' +
        '<table class="data-table" style="width:100%"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>' +
      '</div></div>' +
      '<div style="font-size:12px;color:var(--text3);margin-top:10px">' + hint + '</div>' +
    '</div>';
}

// В Excel уходят все показатели вкладки — отдельным блоком каждый,
// чтобы не выгружать отчёт по нескольку раз.
function exportFuelReportXlsx() {
  const { grid, objs, months, rowTot, colTot, grand } = frBuild();
  if (!objs.length) { alert('Нет данных за ' + fuelRepYear); return; }
  const aoa = [];
  const title = fuelRepTab === 'in' ? 'Приход топлива' : 'Расход топлива';
  aoa.push([title + ' за ' + fuelRepYear + ' г.']);
  aoa.push([]);
  FR_METRICS[fuelRepTab].forEach(M => {
    aoa.push([M.label]);
    aoa.push(['Объект'].concat(months.map(m => FR_MONTHS[m])).concat(['Итого']));
    objs.forEach(o => {
      aoa.push([o].concat(months.map(m => {
        const v = M.get(grid[o][m]);
        return v == null ? '' : +v.toFixed(M.dec);
      })).concat([(() => { const v = M.get(rowTot[o]); return v == null ? '' : +v.toFixed(M.dec); })()]));
    });
    aoa.push(['ИТОГО'].concat(months.map(m => {
      const v = M.get(colTot[m]);
      return v == null ? '' : +v.toFixed(M.dec);
    })).concat([(() => { const v = M.get(grand); return v == null ? '' : +v.toFixed(M.dec); })()]));
    aoa.push([]);
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 24 }].concat(months.map(() => ({ wch: 13 }))).concat([{ wch: 15 }]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, (fuelRepTab === 'in' ? 'Приход ' : 'Расход ') + fuelRepYear);
  XLSX.writeFile(wb, 'Топливо_' + (fuelRepTab === 'in' ? 'Приход' : 'Расход') + '_' + fuelRepYear + '.xlsx');
}
