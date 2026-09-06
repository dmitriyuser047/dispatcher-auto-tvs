// Отчёт по топливу: приход и расход
// Приход берётся из журнала ёмкостей, расход — из записей ДЭС.

// Ставка НДС. Суммы прихода хранятся без НДС — так же, как в карточке счёта
// 10.03.1, где НДС учитывается отдельно на счёте 19.
const FUEL_VAT_RATE = 22;

let fuelRepYear  = String(new Date().getFullYear());
let fuelRepTab   = 'in';        // 'in' — приход, 'out' — расход
let fuelRepGroup = 'object';    // 'object' — по объектам, 'month' — по месяцам

const FR_MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь',
                   'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

function frTankObject(tankId) {
  const t = (data.tanks || []).find(x => x.id === tankId);
  return t ? (t.object || t.name) : '—';
}

// Приход — только закупка. Перемещения между объектами исключены обеими
// сторонами: это не покупка, у них нет ни накладной, ни НДС, а в итоге по
// компании один и тот же объём считался бы дважды — при покупке и при перевозке.
function frIncomeRows(year) {
  return (data.tankIncomes || []).filter(r =>
    (r.date || '').slice(0, 4) === year && !r.linkId && (+r.amount || 0) > 0);
}

function frConsumptionRows(year) {
  const linked = {};
  (data.generators || []).forEach(g => { if (g.tankId) linked[g.id] = g; });
  return (data.genRecords || [])
    .filter(r => (r.date || '').slice(0, 4) === year && linked[r.generatorId])
    .map(r => ({ rec: r, gen: linked[r.generatorId] }));
}

function frYears() {
  const s = new Set();
  (data.tankIncomes || []).forEach(r => { if (r.date) s.add(r.date.slice(0, 4)); });
  (data.genRecords  || []).forEach(r => { if (r.date) s.add(r.date.slice(0, 4)); });
  if (!s.size) s.add(String(new Date().getFullYear()));
  return [...s].sort().reverse();
}

function frAggIncome(year, group) {
  const agg = {};
  frIncomeRows(year).forEach(r => {
    const key = group === 'object' ? frTankObject(r.tankId) : r.date.slice(0, 7);
    agg[key] = agg[key] || { l: 0, s: 0, n: 0 };
    agg[key].l += +r.amount || 0;
    agg[key].s += Math.abs(+r.sum || 0);
    agg[key].n++;
  });
  return agg;
}

function frAggSpend(year, group) {
  const agg = {};
  frConsumptionRows(year).forEach(({ rec, gen }) => {
    const key = group === 'object' ? frTankObject(gen.tankId) : rec.date.slice(0, 7);
    agg[key] = agg[key] || { iss: 0, norm: 0, act: 0, h: 0, n: 0 };
    agg[key].iss  += +rec.fuelIssued || 0;
    agg[key].norm += genNormSpent(gen, rec);
    agg[key].act  += genActualSpent(gen, rec);
    agg[key].h    += +rec.hours || 0;
    agg[key].n++;
  });
  return agg;
}

function frLabel(k) {
  return /^\d{4}-\d{2}$/.test(k) ? FR_MONTHS[+k.slice(5, 7) - 1] + ' ' + k.slice(0, 4) : k;
}

function renderFuelReport() {
  const years = frYears();
  if (!years.includes(fuelRepYear)) fuelRepYear = years[0];
  const L = n => (n || 0).toLocaleString('ru', { maximumFractionDigits: 1 });
  const R = n => (n || 0).toLocaleString('ru', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const yearTabs = years.map(y =>
    '<button class="mtab ' + (fuelRepYear === y ? 'active' : '') + '" onclick="fuelRepYear=\'' + y + '\';renderFuelReport()">' + y + '</button>').join('');
  const tabBtn = (id, label) =>
    '<button class="sec-tab ' + (fuelRepTab === id ? 'active' : '') + '" onclick="fuelRepTab=\'' + id + '\';renderFuelReport()">' + label + '</button>';
  const grpBtn = (id, label) =>
    '<button class="mtab ' + (fuelRepGroup === id ? 'active' : '') + '" onclick="fuelRepGroup=\'' + id + '\';renderFuelReport()">' + label + '</button>';

  const colTitle = fuelRepGroup === 'object' ? 'Объект' : 'Месяц';
  let body;

  if (fuelRepTab === 'in') {
    const agg = frAggIncome(fuelRepYear, fuelRepGroup);
    const keys = Object.keys(agg).sort();
    const tot = { l: 0, s: 0, n: 0 };
    keys.forEach(k => { tot.l += agg[k].l; tot.s += agg[k].s; tot.n += agg[k].n; });
    const line = (name, v, bold) => {
      const price = v.l ? v.s / v.l : 0;
      const vat = v.s * FUEL_VAT_RATE / 100;
      const w = bold ? 'font-weight:700;' : '';
      return '<tr>' +
        '<td style="' + w + '">' + name + '</td>' +
        '<td style="text-align:right;' + w + '">' + v.n + '</td>' +
        '<td style="text-align:right;font-weight:600;' + w + '">' + L(v.l) + '</td>' +
        '<td style="text-align:right;' + w + '">' + (price ? R(price) : '—') + '</td>' +
        '<td style="text-align:right;' + w + '">' + R(v.s) + '</td>' +
        '<td style="text-align:right;color:var(--text3);' + w + '">' + R(vat) + '</td>' +
        '<td style="text-align:right;font-weight:700">' + R(v.s + vat) + '</td></tr>';
    };
    body =
      '<div class="table-wrap"><div class="table-toolbar">' +
        '<div class="table-toolbar-left">Приход за ' + fuelRepYear + ' &nbsp; ' + grpBtn('object', 'По объектам') + grpBtn('month', 'По месяцам') + '</div>' +
        '<button class="btn btn-ghost btn-sm" onclick="exportFuelReportXlsx()">Выгрузить в Excel</button>' +
      '</div><div class="table-scroll"><table class="data-table" style="width:100%"><thead><tr>' +
        '<th>' + colTitle + '</th>' +
        '<th style="text-align:right">Поставок</th>' +
        '<th style="text-align:right">Литров</th>' +
        '<th style="text-align:right">Цена за литр, ₽</th>' +
        '<th style="text-align:right">Сумма без НДС, ₽</th>' +
        '<th style="text-align:right">НДС ' + FUEL_VAT_RATE + '%, ₽</th>' +
        '<th style="text-align:right">Всего с НДС, ₽</th>' +
      '</tr></thead><tbody>' +
        (keys.length
          ? keys.map(k => line(frLabel(k), agg[k])).join('') + line('ИТОГО', tot, true)
          : '<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:14px">Нет данных за ' + fuelRepYear + '</td></tr>') +
      '</tbody></table></div></div>' +
      '<div style="font-size:12px;color:var(--text3);margin-top:10px">' +
        'Суммы хранятся без НДС — как в карточке счёта 10.03.1. Цена за литр посчитана ' +
        'как сумма без НДС, делённая на объём. Перемещения между объектами в приход не входят.' +
      '</div>';
  } else {
    const agg = frAggSpend(fuelRepYear, fuelRepGroup);
    const keys = Object.keys(agg).sort();
    const tot = { iss: 0, norm: 0, act: 0, h: 0, n: 0 };
    keys.forEach(k => ['iss','norm','act','h','n'].forEach(f => { tot[f] += agg[k][f]; }));
    const line = (name, v, bold) => {
      const dev = v.act - v.norm;
      const pct = v.norm ? Math.round(dev / v.norm * 1000) / 10 : null;
      const col = !v.norm ? 'var(--text3)' : dev > 0 ? 'var(--red)' : dev < 0 ? 'var(--green)' : 'var(--text3)';
      const w = bold ? 'font-weight:700;' : '';
      return '<tr>' +
        '<td style="' + w + '">' + name + '</td>' +
        '<td style="text-align:right;' + w + '">' + v.n + '</td>' +
        '<td style="text-align:right;' + w + '">' + L(v.h) + '</td>' +
        '<td style="text-align:right;font-weight:600;' + w + '">' + L(v.iss) + '</td>' +
        '<td style="text-align:right;' + w + '">' + (v.norm ? L(v.norm) : '—') + '</td>' +
        '<td style="text-align:right;' + w + '">' + L(v.act) + '</td>' +
        '<td style="text-align:right;font-weight:700;color:' + col + '">' +
          (v.norm ? (dev > 0 ? '+' : '') + L(dev) + (pct !== null ? ' · ' + (dev > 0 ? '+' : '') + pct + '%' : '') : '—') +
        '</td></tr>';
    };
    body =
      '<div class="table-wrap"><div class="table-toolbar">' +
        '<div class="table-toolbar-left">Расход за ' + fuelRepYear + ' &nbsp; ' + grpBtn('object', 'По объектам') + grpBtn('month', 'По месяцам') + '</div>' +
        '<button class="btn btn-ghost btn-sm" onclick="exportFuelReportXlsx()">Выгрузить в Excel</button>' +
      '</div><div class="table-scroll"><table class="data-table" style="width:100%"><thead><tr>' +
        '<th>' + colTitle + '</th>' +
        '<th style="text-align:right">Записей</th>' +
        '<th style="text-align:right">Моточасов</th>' +
        '<th style="text-align:right">Выдано, л</th>' +
        '<th style="text-align:right">По норме, л</th>' +
        '<th style="text-align:right">По факту, л</th>' +
        '<th style="text-align:right">Отклонение</th>' +
      '</tr></thead><tbody>' +
        (keys.length
          ? keys.map(k => line(frLabel(k), agg[k])).join('') + line('ИТОГО', tot, true)
          : '<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:14px">Нет данных за ' + fuelRepYear + '</td></tr>') +
      '</tbody></table></div></div>' +
      '<div style="font-size:12px;color:var(--text3);margin-top:10px">' +
        '«По норме» — расход при фактической нагрузке, умноженный на моточасы. ' +
        '«По факту» — реально израсходовано. Перерасход красным, экономия зелёной. ' +
        'Прочерк значит, что у ДЭС не заполнена норма или в записи нет моточасов.' +
      '</div>';
  }

  document.getElementById('mainContent').innerHTML =
    '<div style="padding:4px 0 14px">' +
      '<div class="section-header" style="margin-bottom:10px"><div class="section-title">Отчёт по топливу</div></div>' +
      '<div style="display:flex;gap:6px;margin-bottom:12px">' + tabBtn('in', 'Приход') + tabBtn('out', 'Расход') + '</div>' +
      '<div class="month-tabs" style="margin-bottom:14px">' + yearTabs + '</div>' +
      body +
    '</div>';
}

function exportFuelReportXlsx() {
  const L = n => +(n || 0).toFixed(1), R = n => +(n || 0).toFixed(2);
  const colTitle = fuelRepGroup === 'object' ? 'Объект' : 'Месяц';
  const aoa = [];
  if (fuelRepTab === 'in') {
    const agg = frAggIncome(fuelRepYear, fuelRepGroup);
    aoa.push([colTitle, 'Поставок', 'Литров', 'Цена за литр, руб.', 'Сумма без НДС, руб.',
              'НДС ' + FUEL_VAT_RATE + '%, руб.', 'Всего с НДС, руб.']);
    const tot = { l: 0, s: 0, n: 0 };
    Object.keys(agg).sort().forEach(k => {
      const v = agg[k]; tot.l += v.l; tot.s += v.s; tot.n += v.n;
      aoa.push([frLabel(k), v.n, L(v.l), R(v.l ? v.s / v.l : 0), R(v.s),
                R(v.s * FUEL_VAT_RATE / 100), R(v.s * (1 + FUEL_VAT_RATE / 100))]);
    });
    aoa.push(['ИТОГО', tot.n, L(tot.l), R(tot.l ? tot.s / tot.l : 0), R(tot.s),
              R(tot.s * FUEL_VAT_RATE / 100), R(tot.s * (1 + FUEL_VAT_RATE / 100))]);
  } else {
    const agg = frAggSpend(fuelRepYear, fuelRepGroup);
    aoa.push([colTitle, 'Записей', 'Моточасов', 'Выдано, л', 'По норме, л', 'По факту, л',
              'Отклонение, л', 'Отклонение, %']);
    const tot = { iss: 0, norm: 0, act: 0, h: 0, n: 0 };
    Object.keys(agg).sort().forEach(k => {
      const v = agg[k]; ['iss','norm','act','h','n'].forEach(f => { tot[f] += v[f]; });
      aoa.push([frLabel(k), v.n, L(v.h), L(v.iss), L(v.norm), L(v.act), L(v.act - v.norm),
                v.norm ? +((v.act - v.norm) / v.norm * 100).toFixed(1) : '']);
    });
    aoa.push(['ИТОГО', tot.n, L(tot.h), L(tot.iss), L(tot.norm), L(tot.act), L(tot.act - tot.norm),
              tot.norm ? +((tot.act - tot.norm) / tot.norm * 100).toFixed(1) : '']);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = aoa[0].map((_, i) => ({ wch: i === 0 ? 22 : 18 }));
  const wb = XLSX.utils.book_new();
  const name = fuelRepTab === 'in' ? 'Приход' : 'Расход';
  XLSX.utils.book_append_sheet(wb, ws, name + ' ' + fuelRepYear);
  XLSX.writeFile(wb, 'Топливо_' + name + '_' + fuelRepYear + '.xlsx');
}
