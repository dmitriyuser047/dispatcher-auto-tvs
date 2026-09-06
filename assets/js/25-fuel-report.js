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
// Оформление сдержанное: тёмная шапка, серые линии, зебра по строкам.
// Цветом выделяется только отклонение — там знак и есть смысл показателя.
function exportFuelReportXlsx() {
  const { grid, objs, months, rowTot, colTot, grand } = frBuild();
  if (!objs.length) { alert('Нет данных за ' + fuelRepYear); return; }

  const P = { dark:'0F1117', navy:'1B3A6B', white:'FFFFFF', gray1:'F8FAFC',
              gray3:'E2E8F0', gray4:'94A3B8', text:'1E293B',
              red:'B91C1C', green:'15803D' };
  const bd = (style, rgb) => ({ style, color:{ rgb } });
  const bAll = (style, rgb) => { const b = bd(style, rgb); return { top:b, bottom:b, left:b, right:b }; };
  const st = (font, fill, align, border) => ({
    font: font || {},
    fill: fill ? { patternType:'solid', fgColor:{ rgb: fill } } : { patternType:'none' },
    alignment: align || { vertical:'center' },
    border: border || {},
  });
  const num = dec => (dec === 0 ? '#,##0' : dec === 1 ? '#,##0.0' : '#,##0.00');

  const S = {
    title:   st({ bold:true, sz:14, color:{ rgb:P.white } }, P.dark,
                { horizontal:'center', vertical:'center' }, bAll('medium', P.dark)),
    caption: st({ bold:true, sz:11, color:{ rgb:P.text } }, null,
                { horizontal:'left', vertical:'center' }),
    head:    st({ bold:true, sz:10, color:{ rgb:P.white } }, P.navy,
                { horizontal:'center', vertical:'center', wrapText:true }, bAll('thin', P.navy)),
    headL:   st({ bold:true, sz:10, color:{ rgb:P.white } }, P.navy,
                { horizontal:'left', vertical:'center', indent:1 }, bAll('thin', P.navy)),
    objCell: bg => st({ sz:10, color:{ rgb:P.text } }, bg,
                { horizontal:'left', vertical:'center', indent:1 }, bAll('thin', P.gray3)),
    valCell: (bg, rgb) => st({ sz:10, color:{ rgb: rgb || P.text } }, bg,
                { horizontal:'right', vertical:'center' }, bAll('thin', P.gray3)),
    totRow:  st({ bold:true, sz:10, color:{ rgb:P.text } }, P.gray3,
                { horizontal:'right', vertical:'center' }, bAll('thin', P.gray4)),
    totRowL: st({ bold:true, sz:10, color:{ rgb:P.text } }, P.gray3,
                { horizontal:'left', vertical:'center', indent:1 }, bAll('thin', P.gray4)),
  };

  const NC = months.length + 1;   // последний столбец: объект + месяцы + итого
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

  const title = (fuelRepTab === 'in' ? 'ПРИХОД ТОПЛИВА' : 'РАСХОД ТОПЛИВА') + ' — ' + fuelRepYear + ' Г.';
  put(row, 0, title, S.title);
  ws['!merges'].push({ s:{ r:row, c:0 }, e:{ r:row, c:NC } });
  fill(row, S.title); rowH(row, 30); row += 2;

  FR_METRICS[fuelRepTab].forEach(M => {
    put(row, 0, M.label, S.caption); rowH(row, 18); row++;

    put(row, 0, 'Объект', S.headL);
    months.forEach((m, i) => put(row, i + 1, FR_MONTHS[m], S.head));
    put(row, NC, 'Итого', S.head);
    rowH(row, 22); row++;

    objs.forEach((o, i) => {
      const bg = i % 2 ? P.gray1 : P.white;
      put(row, 0, o, S.objCell(bg));
      const cells = months.map(m => grid[o][m]).concat([rowTot[o]]);
      cells.forEach((c, k) => {
        const v = M.get(c);
        const show = v == null || (M.id === 'price' && !c.l) || (M.id === 'devpct' && !c.norm) ? null : v;
        const rgb = M.sign && show ? (show > 0 ? P.red : P.green) : null;
        put(row, k + 1, show == null ? '—' : +show.toFixed(M.dec), S.valCell(bg, rgb), num(M.dec));
      });
      row++;
    });

    put(row, 0, 'ИТОГО', S.totRowL);
    const tCells = months.map(m => colTot[m]).concat([grand]);
    tCells.forEach((c, k) => {
      const v = M.get(c);
      const show = v == null || (M.id === 'price' && !c.l) || (M.id === 'devpct' && !c.norm) ? null : v;
      put(row, k + 1, show == null ? '—' : +show.toFixed(M.dec), S.totRow, num(M.dec));
    });
    rowH(row, 20); row += 2;
  });

  ws['!cols'] = [{ wch: 24 }].concat(months.map(() => ({ wch: 13 }))).concat([{ wch: 15 }]);
  ws['!freeze'] = { xSplit: 1, ySplit: 0 };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, (fuelRepTab === 'in' ? 'Приход ' : 'Расход ') + fuelRepYear);
  XLSX.writeFile(wb, 'Топливо_' + (fuelRepTab === 'in' ? 'Приход' : 'Расход') + '_' + fuelRepYear + '.xlsx');
}
