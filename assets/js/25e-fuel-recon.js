// Сверки: пробег по ГЛОНАСС против пробега в журнале и заправки против 1С.
//
// ГЛОНАСС — независимый источник пробега. Если водитель пишет больше, чем
// показал трекер, по норме списывается лишнее топливо. Сравниваем по дням,
// где заполнены оба пробега.
//
// Сверка с 1С — по поставщикам топливных карт за месяц: литры и суммы по
// выпискам против того, что проведено в 1С. Цифры 1С вносятся вручную
// (из оборотки по счёту 10.03 или из актов поставщика) и хранятся в месяце.

// ─── ГЛОНАСС ──────────────────────────────────────────────

const FG_DIFF_PCT = 10;   // расхождение за день в процентах
const FG_DIFF_KM = 20;    // и не меньше чем на столько км

let fgNoOffice = true;
let fgOpen = '';          // машина с раскрытыми днями

function fgRows(month) {
  return (data.vehicles || []).map(v => {
    if (fgNoOffice && fpIsOffice(v)) return null;
    const recs = recsFor(v.id).filter(r => !month || month === 'all' || r.date.startsWith(month));
    const withKm = recs.filter(r => +r.km > 0);
    if (!withKm.length) return null;
    const both = recs.filter(r => r.kmGlonass != null && r.kmGlonass !== '' && (+r.km > 0 || +r.kmGlonass > 0));
    const km = both.reduce((s, r) => s + (+r.km || 0), 0);
    const gl = both.reduce((s, r) => s + (+r.kmGlonass || 0), 0);
    const bad = both.filter(r => {
      const d = (+r.km || 0) - (+r.kmGlonass || 0);
      return Math.abs(d) >= FG_DIFF_KM && (!+r.kmGlonass || Math.abs(d) / +r.kmGlonass * 100 >= FG_DIFF_PCT);
    }).sort((a, b) => cmpDateAsc(a.date, b.date));
    // Расход по датчику ГЛОНАСС — только дни, где датчик дал данные
    const sens = recs.filter(r => r.glonassFuel != null && r.glonassFuel !== '' && +r.kmGlonass > 0);
    const sensL = sens.reduce((s, r) => s + (+r.glonassFuel || 0), 0);
    const sensKm = sens.reduce((s, r) => s + (+r.kmGlonass || 0), 0);
    const sens100 = sensKm >= 50 ? sensL / sensKm * 100 : null;
    const sensDev = sens100 != null && v.norm ? (sens100 - v.norm) / v.norm * 100 : null;
    return { v, sensL, sensKm, sens100, sensDev, sensDays: sens.length,
             days: withKm.length, both: both.length, noGl: withKm.length - both.filter(r => +r.km > 0).length,
             km, gl, diff: km - gl, pct: gl ? (km - gl) / gl * 100 : null, bad,
             totalKm: withKm.reduce((s, r) => s + (+r.km || 0), 0) };
  }).filter(Boolean).sort((a, b) => b.diff - a.diff);
}

function fgHtml() {
  const rows = fgRows(fpMonth);
  const over = rows.filter(r => r.diff >= FG_DIFF_KM && r.pct != null && r.pct >= FG_DIFF_PCT);
  const noGl = rows.filter(r => !r.both);
  const f = (x, d) => x == null ? '—' : fpNum(x, d);
  const body = rows.map(r => {
    const cls = r.pct != null && r.pct >= FG_DIFF_PCT && r.diff >= FG_DIFF_KM ? 'color:var(--red);font-weight:700'
      : r.pct != null && r.pct <= -FG_DIFF_PCT && -r.diff >= FG_DIFF_KM ? 'color:#d97706;font-weight:700' : '';
    const open = fgOpen === r.v.id;
    return `<tr style="cursor:pointer" onclick="fgOpen=fgOpen==='${r.v.id}'?'':'${r.v.id}';renderFuelPurchases()">
      <td><b>${fpEsc(r.v.plate)}</b><div style="font-size:12px;color:var(--text3)">${fpEsc(r.v.make || '')}</div></td>
      <td style="text-align:right">${r.days}</td>
      <td style="text-align:right">${r.both}${r.noGl ? `<div style="font-size:11px;color:#d97706">без ГЛОНАСС: ${r.noGl}</div>` : ''}</td>
      <td style="text-align:right">${f(r.km, 0)}</td>
      <td style="text-align:right">${f(r.gl, 0)}</td>
      <td style="text-align:right;${cls}">${r.both ? (r.diff > 0 ? '+' : '') + fpNum(r.diff, 0) : '—'}</td>
      <td style="text-align:right;${cls}">${r.pct == null ? '—' : (r.pct > 0 ? '+' : '') + fpNum(r.pct, 1) + '%'}</td>
      <td style="text-align:right">${r.bad.length || '—'}</td>
      <td style="text-align:right">${r.sensDays ? fpNum(r.sensL, 1) + '<div style="font-size:11px;color:var(--text3)">' + r.sensDays + ' дн.</div>' : '—'}</td>
      <td style="text-align:right;font-weight:700;${r.sensDev != null && r.sensDev >= 10 ? 'color:var(--red)' : ''}">${r.sens100 != null ? fpNum(r.sens100, 1) : '—'}${r.v.norm ? '<div style="font-size:11px;color:var(--text3);font-weight:400">норма ' + fpNum(r.v.norm, 1) + '</div>' : ''}</td>
      <td style="text-align:right;${r.sensDev != null && r.sensDev >= 10 ? 'color:var(--red);font-weight:700' : r.sensDev != null && r.sensDev <= -10 ? 'color:#d97706' : ''}">${r.sensDev == null ? '—' : (r.sensDev > 0 ? '+' : '') + fpNum(r.sensDev, 1) + '%'}</td>
      <td style="font-size:12px;color:var(--text3)">${open ? '▲' : r.bad.length ? '▼ дни' : ''}</td>
    </tr>${open && r.bad.length ? `<tr><td colspan="12" style="background:var(--bg2)">
      <table class="data-table" style="width:100%;margin:4px 0"><thead><tr><th>Дата</th><th style="text-align:right">Журнал, км</th><th style="text-align:right">ГЛОНАСС, км</th><th style="text-align:right">Разница, км</th><th>Водитель</th><th></th></tr></thead>
      <tbody>${r.bad.map(x => `<tr><td>${fmtDate(x.date)}</td><td style="text-align:right">${fpNum(x.km, 0)}</td><td style="text-align:right">${fpNum(x.kmGlonass, 0)}</td>
        <td style="text-align:right;font-weight:700">${(x.km - x.kmGlonass > 0 ? '+' : '') + fpNum(x.km - x.kmGlonass, 0)}</td><td>${fpEsc(x.driver || r.v.driver || '')}</td>
        <td><a href="#" onclick="event.preventDefault();event.stopPropagation();fpOpenJournal('${r.v.id}','${x.date.slice(0, 7)}')">в журнал</a></td></tr>`).join('')}</tbody></table>
    </td></tr>` : ''}`;
  }).join('');

  return `
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
      <label style="font-size:13px;display:flex;gap:6px;align-items:center;cursor:pointer">
        <input type="checkbox" ${fgNoOffice ? 'checked' : ''} onchange="fgNoOffice=this.checked;renderFuelPurchases()"> без офисных машин</label>
      <button class="btn btn-primary" style="margin-left:auto" onclick="importGlonassTrips()">Загрузить отчёт ГЛОНАСС</button>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
      ${fkCard('Пробег в журнале больше ГЛОНАСС', over.length + ' машин', 'от ' + FG_DIFF_PCT + '% и ' + FG_DIFF_KM + ' км', over.length ? '#dc2626' : '#16a34a')}
      ${fkCard('Без данных ГЛОНАСС', noGl.length + ' машин', 'ездили, но ГЛОНАСС не внесён', noGl.length ? '#d97706' : '#16a34a')}
      ${fkCard('Дней с расхождением', rows.reduce((s, r) => s + r.bad.length, 0), '', '#64748b')}
    </div>
    <div class="table-wrap"><div class="table-scroll" style="overflow-x:auto">
      <table class="data-table" style="width:100%">
        <thead><tr><th>Машина</th><th style="text-align:right">Дней с пробегом</th><th style="text-align:right">С ГЛОНАСС</th>
          <th style="text-align:right">Журнал, км</th><th style="text-align:right">ГЛОНАСС, км</th><th style="text-align:right">Разница, км</th>
          <th style="text-align:right">%</th><th style="text-align:right">Дней с расхождением</th>
          <th style="text-align:right">Датчик ГЛОНАСС, л</th><th style="text-align:right">Датчик, л/100 км</th><th style="text-align:right">К норме</th><th></th></tr></thead>
        <tbody>${body || '<tr><td colspan="12" style="text-align:center;color:var(--text3);padding:16px">Нет данных</td></tr>'}</tbody>
      </table></div></div>
    <div style="font-size:12px;color:var(--text3);margin-top:10px">
      Сравниваются дни, где в журнале заполнены и пробег, и «Пробег по Глонассу». Пробег в журнале больше ГЛОНАСС — красным:
      по норме за такой пробег списывается лишнее топливо. Меньше — оранжевым. День считается расхождением от ${FG_DIFF_KM} км и ${FG_DIFF_PCT}%.
      Нажмите на машину, чтобы увидеть дни. «Датчик ГЛОНАСС» — расход по датчику уровня топлива из отчёта «Рейсы» за дни, где датчик дал данные;
      сравнивается с нормой из карточки машины, превышение от 10% — красным.
    </div>`;
}

// ─── Сверка с 1С ──────────────────────────────────────────

let frcMonth = '';

function frcProvider(p) {
  const c = fcByNumber(p.cardNo);
  return (c && c.provider) || fcGuessProvider(fcNorm(p.cardNo)) || 'Прочие карты';
}

function frcData(month) {
  const by = new Map();
  fpLive().filter(p => (p.date || '').startsWith(month)).forEach(p => {
    const k = frcProvider(p);
    const x = by.get(k) || { litres: 0, sum: 0, n: 0, noSum: 0 };
    x.litres += +p.qty || 0; x.sum += +p.sum || 0; x.n++; if (!+p.sum) x.noSum++;
    by.set(k, x);
  });
  return by;
}

function frcHtml() {
  const months = [...new Set([...fpMonthsList(), ...fpCmpMonths()])].sort().reverse();
  if (!frcMonth || !months.includes(frcMonth)) frcMonth = months[0] || '';
  if (!frcMonth) return '<div class="welcome" style="padding:60px 0"><p>Нет данных</p></div>';
  const per = fuelPeriod(frcMonth) || {};
  const recon = per.recon || {};
  const closed = fuelMonthClosed(frcMonth);
  const by = frcData(frcMonth);
  const providers = [...new Set([...by.keys(), ...Object.keys(recon)])].sort((a, b) => a.localeCompare(b, 'ru'));
  const journal = (data.records || []).filter(r => r.date.startsWith(frcMonth)).reduce((s, r) => s + (+r.fuelIssued || 0), 0);

  const dif = (a, b, d) => {
    if (a == null || b == null || b === '') return '<span style="color:var(--text3)">—</span>';
    const x = a - b;
    return `<span style="font-weight:700;color:${Math.abs(x) < (d ? 1 : 0.5) ? 'var(--green)' : 'var(--red)'}">${x > 0 ? '+' : ''}${fpNum(x, d ? 2 : 1)}</span>`;
  };
  const inp = (prov, field, val, step) => `<input type="number" step="${step}" value="${val ?? ''}" ${closed ? 'disabled' : ''}
      style="width:110px;text-align:right" onchange="frcSet('${frcMonth}', ${JSON.stringify(prov).replace(/"/g, '&quot;')}, '${field}', this.value)">`;

  let tS = { l: 0, s: 0 }, t1 = { l: 0, s: 0, has: false };
  const rows = providers.map(prov => {
    const s = by.get(prov) || { litres: 0, sum: 0, n: 0, noSum: 0 };
    const r = recon[prov] || {};
    tS.l += s.litres; tS.s += s.sum;
    if (r.litres != null && r.litres !== '') { t1.l += +r.litres; t1.has = true; }
    if (r.sum != null && r.sum !== '') { t1.s += +r.sum; t1.has = true; }
    return `<tr>
      <td><b>${fpEsc(prov)}</b><div style="font-size:12px;color:var(--text3)">${s.n} покупок${s.noSum ? ', без суммы: ' + s.noSum : ''}</div></td>
      <td style="text-align:right">${fpNum(s.litres, 1)}</td>
      <td style="text-align:right">${fpNum(s.sum)}</td>
      <td style="text-align:right">${inp(prov, 'litres', r.litres, '0.01')}</td>
      <td style="text-align:right">${inp(prov, 'sum', r.sum, '0.01')}</td>
      <td style="text-align:right">${dif(s.litres, r.litres === '' ? null : r.litres, false)}</td>
      <td style="text-align:right">${dif(s.sum, r.sum === '' ? null : r.sum, true)}</td>
      <td><input type="text" value="${fpEsc(r.note || '')}" ${closed ? 'disabled' : ''} style="width:100%"
        onchange="frcSet('${frcMonth}', ${JSON.stringify(prov).replace(/"/g, '&quot;')}, 'note', this.value)"></td>
    </tr>`;
  }).join('');

  return `
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px">
      <select class="fsel" onchange="frcMonth=this.value;renderFuelPurchases()">
        ${months.map(m => `<option value="${m}"${m === frcMonth ? ' selected' : ''}>${fpMonthLabel(m)}${fuelMonthClosed(m) ? ' — закрыт' : ''}</option>`).join('')}
      </select>
      ${closed ? '<span style="color:var(--text3)">месяц закрыт — цифры 1С не правятся</span>' : ''}
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
      ${fkCard('Выдано по журналу', fpNum(journal, 1) + ' л', 'все заправки машин за месяц', '#64748b')}
      ${fkCard('По выпискам', fpNum(tS.l, 1) + ' л', fpNum(tS.s) + ' ₽', '#2563eb')}
      ${fkCard('В 1С', t1.has ? fpNum(t1.l, 1) + ' л' : 'не внесено', t1.has ? fpNum(t1.s) + ' ₽' : '', t1.has ? '#16a34a' : '#d97706')}
      ${fkCard('Журнал без выписок', fpNum(journal - tS.l, 1) + ' л', 'внесено вручную или по картам без выписки', Math.abs(journal - tS.l) > 1 ? '#d97706' : '#16a34a')}
    </div>
    <div class="table-wrap"><div class="table-scroll" style="overflow-x:auto">
      <table class="data-table" style="width:100%">
        <thead><tr><th>Поставщик карт</th><th style="text-align:right">Выписки, л</th><th style="text-align:right">Выписки, ₽</th>
          <th style="text-align:right">1С, л</th><th style="text-align:right">1С, ₽</th><th style="text-align:right">Разница, л</th><th style="text-align:right">Разница, ₽</th><th>Примечание</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:16px">За месяц нет покупок по выпискам</td></tr>'}
          <tr style="border-top:2px solid var(--border);font-weight:700"><td>ИТОГО</td><td style="text-align:right">${fpNum(tS.l, 1)}</td><td style="text-align:right">${fpNum(tS.s)}</td>
            <td style="text-align:right">${t1.has ? fpNum(t1.l, 1) : '—'}</td><td style="text-align:right">${t1.has ? fpNum(t1.s) : '—'}</td>
            <td style="text-align:right">${t1.has ? dif(tS.l, t1.l, false) : '—'}</td><td style="text-align:right">${t1.has ? dif(tS.s, t1.s, true) : '—'}</td><td></td></tr>
        </tbody>
      </table></div></div>
    <div style="font-size:12px;color:var(--text3);margin-top:10px">
      В колонки «1С» внесите литры и сумму, проведённые в 1С по поставщику за месяц (оборотка по счёту 10.03 или акты поставщика).
      Суммы выписок — как в выписке («Сумма к оплате» / «Сумма клиента»). Разница выделяется красным, если больше 0,5 л или 1 ₽.
      Покупки без суммы (загружены до версии 2.0.66) сумму не дают — загрузите выписку повторно.
    </div>`;
}

let _frcSaveTimer = null;
function frcSet(month, provider, field, value) {
  if (fuelMonthClosed(month)) return;
  let p = fuelPeriod(month);
  if (!p) { p = { month, history: [] }; fuelPeriods().push(p); }
  const r = (p.recon || (p.recon = {}))[provider] || (p.recon[provider] = {});
  r[field] = field === 'note' ? String(value || '').trim() : (value === '' ? '' : +value);
  clearTimeout(_frcSaveTimer);
  _frcSaveTimer = setTimeout(async () => { await saveData(data); renderFuelPurchases(); }, 300);
}
