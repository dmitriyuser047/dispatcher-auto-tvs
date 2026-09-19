// Контроль расхода: замеры остатка в баке и проверки заправок.
//
// Замер — фактический остаток в баке на конец дня (поле «Остаток в баке по
// замеру» в записи пробега). Между двумя замерами фактический расход считается
// без допущений: остаток на начало + выдано − остаток на конец. Его и сравниваем
// с нормой за пробег — это единственный способ увидеть перерасход, если
// «факт. расход» в журнале заполняется по норме.
//
// Проверки заправок: больше объёма бака, цена выше средней по марке,
// АЗС вне обычного региона машины. Каждую можно отметить «Проверено».

// ─── Замеры ───────────────────────────────────────────────

const FK_ALERT_PCT = 10;   // отклонение от нормы, после которого период красный

function fkHasMeasure(r) { return r.tankMeasured != null && r.tankMeasured !== '' && !isNaN(+r.tankMeasured); }

// Периоды между соседними замерами машины
function fkPeriods(v) {
  const recs = recsFor(v.id).slice().sort((a, b) => cmpDateAsc(a.date, b.date));
  const out = [];
  let start = null, issued = 0, km = 0, journal = 0;
  recs.forEach(r => {
    if (start) {
      issued += +r.fuelIssued || 0;
      km += +r.km || 0;
      journal += (r.fuelActual != null ? +r.fuelActual : (+r.fuelUsed || 0)) + (+r.fuelIdle || 0);
    }
    if (fkHasMeasure(r)) {
      if (start) {
        const fact = +start.tankMeasured + issued - (+r.tankMeasured);
        const norm = v.norm && km ? km * v.norm / 100 : null;
        out.push({ v, from: start.date, to: r.date, startBal: +start.tankMeasured, endBal: +r.tankMeasured,
                   issued, km, fact, journal, norm,
                   per100: km >= 50 ? fact / km * 100 : null,
                   dev: norm != null ? fact - norm : null,
                   devPct: norm ? (fact - norm) / norm * 100 : null });
      }
      start = r; issued = 0; km = 0; journal = 0;
    }
  });
  return out;
}

let fkMeasNoOffice = true;

function fkMeasuresHtml() {
  const month = fpMonth && fpMonth !== 'all' ? fpMonth : '';
  const vehicles = (data.vehicles || []).filter(v => !(fkMeasNoOffice && fpIsOffice(v)));
  const periods = vehicles.flatMap(fkPeriods).filter(p => !month || p.to.startsWith(month))
    .sort((a, b) => (b.devPct ?? -1e9) - (a.devPct ?? -1e9));
  // Машины, которые ездили в месяце, но без замера
  const noMeasure = month ? vehicles.filter(v => {
    const rs = recsFor(v.id).filter(r => r.date.startsWith(month));
    return rs.some(r => +r.km) && !rs.some(fkHasMeasure);
  }) : [];
  const over = periods.filter(p => p.devPct != null && p.devPct >= FK_ALERT_PCT);

  const f = (x, d) => x == null ? '—' : fpNum(x, d);
  const rows = periods.map(p => `
    <tr style="cursor:pointer" onclick="fpOpenJournal('${p.v.id}','${p.to.slice(0, 7)}')">
      <td><b>${fpEsc(p.v.plate)}</b><div style="font-size:12px;color:var(--text3)">${fpEsc(p.v.make || '')}</div></td>
      <td style="white-space:nowrap">${fmtDate(p.from)} — ${fmtDate(p.to)}</td>
      <td style="text-align:right">${f(p.startBal, 1)}</td>
      <td style="text-align:right">${f(p.issued, 1)}</td>
      <td style="text-align:right">${f(p.endBal, 1)}</td>
      <td style="text-align:right;font-weight:700">${f(p.fact, 1)}</td>
      <td style="text-align:right">${f(p.km, 0)}</td>
      <td style="text-align:right">${f(p.per100, 2)}</td>
      <td style="text-align:right">${f(p.norm, 1)}${p.v.norm ? `<div style="font-size:11px;color:var(--text3)">${fpNum(p.v.norm, 2)} л/100</div>` : ''}</td>
      <td style="text-align:right;font-weight:700;color:${p.devPct == null ? 'var(--text3)' : p.devPct >= FK_ALERT_PCT ? 'var(--red)' : p.devPct <= -FK_ALERT_PCT ? '#d97706' : 'var(--green)'}">
        ${p.dev == null ? '—' : (p.dev > 0 ? '+' : '') + fpNum(p.dev, 1) + ' л'}<div style="font-size:11px">${p.devPct == null ? '' : (p.devPct > 0 ? '+' : '') + fpNum(p.devPct, 1) + '%'}</div></td>
      <td style="text-align:right;color:var(--text3)">${f(p.journal, 1)}</td>
    </tr>`).join('');

  return `
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
      <label style="font-size:13px;display:flex;gap:6px;align-items:center;cursor:pointer">
        <input type="checkbox" ${fkMeasNoOffice ? 'checked' : ''} onchange="fkMeasNoOffice=this.checked;renderFuelPurchases()"> без офисных машин</label>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
      ${fkCard('Периодов между замерами', periods.length, month ? 'заканчиваются в ' + fpMonthLabel(month).toLowerCase() : 'за всё время', '#2563eb')}
      ${fkCard('Перерасход от ' + FK_ALERT_PCT + '%', over.length, over.length ? 'стоит разобраться' : 'нет', over.length ? '#dc2626' : '#16a34a')}
      ${month ? fkCard('Ездили без замера', noMeasure.length + ' машин', 'за ' + fpMonthLabel(month).toLowerCase(), noMeasure.length ? '#d97706' : '#16a34a') : ''}
    </div>
    ${periods.length ? `<div class="table-wrap"><div class="table-scroll" style="overflow-x:auto">
      <table class="data-table" style="width:100%">
        <thead><tr><th>Машина</th><th>Период</th><th style="text-align:right">Остаток на начало, л</th><th style="text-align:right">Выдано, л</th>
          <th style="text-align:right">Остаток на конец, л</th><th style="text-align:right">Факт по замерам, л</th><th style="text-align:right">Пробег, км</th>
          <th style="text-align:right">Факт, л/100 км</th><th style="text-align:right">По норме, л</th><th style="text-align:right">Отклонение</th>
          <th style="text-align:right">В журнале, л</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div></div>` : `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:14px">
        Замеров пока нет. Внесите «Остаток в баке по замеру» в запись пробега — лучше в последний день месяца,
        по фото датчика или показаниям водителя. После двух замеров у машины здесь появится фактический расход за период.</div>`}
    ${noMeasure.length ? `<div style="margin-top:14px"><div style="font-weight:600;margin-bottom:6px">Ездили в ${fpMonthLabel(month).toLowerCase()} без замера остатка</div>
      <div style="font-size:13px;color:var(--text2)">${noMeasure.map(v => `<a href="#" onclick="event.preventDefault();fpOpenJournal('${v.id}','${month}')">${fpEsc(v.plate)}</a>`).join(', ')}</div></div>` : ''}
    <div style="font-size:12px;color:var(--text3);margin-top:10px">
      Факт по замерам = остаток на начало + выдано за период − остаток на конец. Отклонение — от нормы за пробег по норме из карточки машины.
      Перерасход от ${FK_ALERT_PCT}% — красным, экономия больше ${FK_ALERT_PCT}% — оранжевым (часто это пропущенная заправка или ошибка замера).
      «В журнале» — сколько расхода записано в журнале за тот же период. С записи, где есть замер, расчётный остаток машины начинается с замера.
    </div>`;
}

function fkCard(t, val, sub, color) {
  return `<div style="flex:1;min-width:170px;background:var(--bg2);border:1px solid var(--border);border-left:4px solid ${color};border-radius:8px;padding:10px 14px">
    <div style="font-size:12px;color:var(--text3)">${t}</div><div style="font-size:19px;font-weight:800">${val}</div>
    ${sub ? `<div style="font-size:12px;color:var(--text3)">${sub}</div>` : ''}</div>`;
}

// ─── Проверки заправок ────────────────────────────────────

const FK_PRICE_PCT = 5;    // цена выше медианы по марке за месяц на столько процентов
const FK_PRICE_MIN = 2;    // и не меньше чем на столько рублей

let fkChecksNoOffice = false;
let fkChecksOnlyOpen = true;

function fkMedian(a) {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Регион в выписках пишут по-разному: «Республика Татарстан», «Татарстан
// республика», «ЯНАО», а иногда вместо названия приходит код. Сравниваем по
// ключу без служебных слов; код и пустое значение — «регион неизвестен».
const FK_REGION_ALIAS = { 'янао': 'ямалоненецкий', 'хмао': 'хантымансийский', 'хмаоюгра': 'хантымансийский' };
function fkRegionKey(region) {
  let s = String(region || '').split(',')[0].toLowerCase().replace(/ё/g, 'е');
  if (!/[а-яa-z]/.test(s)) return '';
  s = s.replace(/автономный округ|республика|респ\.?|область|обл\.?|край|г\.|город|\bао\b|-|—|югра/g, ' ')
    .replace(/[^а-яa-z ]/g, ' ').split(/\s+/).filter(Boolean).join('');
  return FK_REGION_ALIAS[s] || s;
}

// Обычный регион машины — где сделано не меньше 60% её заправок (от трёх)
function fkHomeRegions() {
  const by = new Map();
  fpLive().forEach(p => {
    const key = fkRegionKey(p.region);
    if (!p.vehicleId || !key) return;
    const r = by.get(p.vehicleId) || new Map();
    r.set(key, (r.get(key) || 0) + 1);
    by.set(p.vehicleId, r);
  });
  const home = new Map();
  by.forEach((m, vid) => {
    const total = [...m.values()].reduce((s, x) => s + x, 0);
    const [top, n] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    if (total >= 3 && n / total >= 0.6) home.set(vid, top);
  });
  return home;
}

function fkChecks(month) {
  const list = fpLive().filter(p => p.vehicleId && (!month || month === 'all' || (p.date || '').startsWith(month)));
  // Медиана цены по марке за месяц — по всем покупкам месяца
  const prices = new Map();
  list.forEach(p => { if (+p.price && !p.restored) { const k = p.grade + '|' + p.date.slice(0, 7); if (!prices.has(k)) prices.set(k, []); prices.get(k).push(+p.price); } });
  const med = new Map([...prices.entries()].map(([k, a]) => [k, fkMedian(a)]));
  const home = fkHomeRegions();
  const dayTotals = new Map();
  list.forEach(p => { const k = p.vehicleId + '|' + p.date; dayTotals.set(k, (dayTotals.get(k) || 0) + (+p.qty || 0)); });

  const out = [];
  list.forEach(p => {
    const v = (data.vehicles || []).find(x => x.id === p.vehicleId);
    if (!v || (fkChecksNoOffice && fpIsOffice(v))) return;
    const flags = [];
    const vol = +v.tankVolume;
    if (vol && p.qty > vol * 1.05) flags.push({ type: 'tank', text: 'заправка ' + fpNum(p.qty, 1) + ' л больше объёма бака ' + fpNum(vol, 0) + ' л' });
    const day = dayTotals.get(p.vehicleId + '|' + p.date);
    if (vol && day > vol * 1.5 && !flags.length) flags.push({ type: 'tank', text: 'за день ' + fpNum(day, 1) + ' л — больше полутора баков' });
    const m = med.get(p.grade + '|' + p.date.slice(0, 7));
    if (m && +p.price && !p.restored && p.price > m * (1 + FK_PRICE_PCT / 100) && p.price - m >= FK_PRICE_MIN)
      flags.push({ type: 'price', text: 'цена ' + fpNum(p.price) + ' ₽ выше средней ' + fpNum(m) + ' ₽ на ' + fpNum((p.price / m - 1) * 100, 1) + '%' });
    const h = home.get(p.vehicleId);
    const reg = fkRegionKey(p.region);
    if (h && reg && reg !== h) {
      // Для подписи — как обычный регион записан в выписках этой машины
      const homeName = (fpLive().find(x => x.vehicleId === p.vehicleId && fkRegionKey(x.region) === h) || {}).region || h;
      flags.push({ type: 'region', text: 'АЗС: ' + p.region + ' (обычно — ' + homeName.split(',')[0] + ')' });
    }
    if (flags.length) out.push({ p, v, flags });
  });
  return out.sort((a, b) => (a.p.date + (a.p.time || '')).localeCompare(b.p.date + (b.p.time || '')));
}

function fkChecksHtml() {
  const all = fkChecks(fpMonth);
  const list = fkChecksOnlyOpen ? all.filter(x => !x.p.checkOk) : all;
  const cnt = t => all.filter(x => !x.p.checkOk && x.flags.some(f => f.type === t)).length;
  const noVol = (data.vehicles || []).filter(v => !v.tankVolume && fpLive().some(p => p.vehicleId === v.id)).length;
  const noRegion = fpLive().filter(p => p.vehicleId && fpInMonth(p) && !p.region).length;

  const rows = list.map(({ p, v, flags }) => `
    <tr>
      <td>${fmtDate(p.date)} ${fpEsc(p.time || '')}</td>
      <td style="cursor:pointer" onclick="fpOpenVehicle('${v.id}')"><b>${fpEsc(v.plate)}</b><div style="font-size:12px;color:var(--text3)">${fpEsc(v.make || '')}</div></td>
      <td><span class="fuel-tag ${fuelTypeFromGrade(p.grade)}" style="font-size:10px;padding:1px 6px">${fpEsc(p.grade || '—')}</span></td>
      <td style="text-align:right;font-weight:700">${fpNum(p.qty)}</td>
      <td style="text-align:right">${p.price ? fpNum(p.price) : '—'}</td>
      <td style="text-align:right">${p.sum ? fpNum(p.sum) : '—'}</td>
      <td style="font-size:12px;max-width:220px;white-space:normal">${fpEsc(fpPlace(p) || '—')}</td>
      <td style="font-size:12px;color:#b45309;max-width:260px;white-space:normal">${flags.map(f => fpEsc(f.text)).join('<br>')}
        ${p.checkOk ? `<div style="color:var(--green);margin-top:3px">✓ проверено${p.checkNote ? ': ' + fpEsc(p.checkNote) : ''}</div>` : ''}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-ghost btn-sm" style="padding:3px 8px;font-size:11px" onclick="fkToggleOk('${p.id}')">${p.checkOk ? 'Снять' : 'Проверено'}</button>
        <a href="#" style="font-size:11px;margin-left:4px" onclick="event.preventDefault();fpEdit('${p.id}')">изменить</a>
      </td>
    </tr>`).join('');

  return `
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
      <label style="font-size:13px;display:flex;gap:6px;align-items:center;cursor:pointer">
        <input type="checkbox" ${fkChecksNoOffice ? 'checked' : ''} onchange="fkChecksNoOffice=this.checked;renderFuelPurchases()"> без офисных машин</label>
      <label style="font-size:13px;display:flex;gap:6px;align-items:center;cursor:pointer">
        <input type="checkbox" ${fkChecksOnlyOpen ? 'checked' : ''} onchange="fkChecksOnlyOpen=this.checked;renderFuelPurchases()"> только непроверенные</label>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
      ${fkCard('Больше объёма бака', cnt('tank'), noVol ? 'объём бака не указан у ' + noVol + ' машин' : '', cnt('tank') ? '#dc2626' : '#16a34a')}
      ${fkCard('Цена выше средней', cnt('price'), 'от ' + FK_PRICE_PCT + '% и ' + FK_PRICE_MIN + ' ₽ по марке за месяц', cnt('price') ? '#d97706' : '#16a34a')}
      ${fkCard('АЗС вне обычного региона', cnt('region'), noRegion ? 'без региона: ' + noRegion + ' покупок' : '', cnt('region') ? '#d97706' : '#16a34a')}
    </div>
    ${list.length ? `<div class="table-wrap"><div class="table-scroll" style="overflow-x:auto">
      <table class="data-table" style="width:100%">
        <thead><tr><th>Дата</th><th>Машина</th><th>Топливо</th><th style="text-align:right">Литры</th><th style="text-align:right">Цена, ₽/л</th>
          <th style="text-align:right">Сумма, ₽</th><th>АЗС</th><th>Замечание</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div></div>`
      : `<div style="background:#dcfce7;color:#166534;border:1px solid #bbf7d0;border-radius:8px;padding:12px 14px">Замечаний нет.</div>`}
    <div style="font-size:12px;color:var(--text3);margin-top:10px">
      Объём бака указывается в карточке машины. Средняя цена — медиана по марке топлива за месяц по всем машинам.
      Регион АЗС берётся из выписки; у заправок, загруженных до этой версии, его нет — он подтянется при повторной загрузке выписки.
      Обычный регион машины — где сделано не меньше 60% её заправок.
    </div>`;
}

function fkToggleOk(id) {
  const p = fpById(id);
  if (!p) return;
  if (p.checkOk) { p.checkOk = false; p.checkNote = ''; fpSaveAndRender(); return; }
  openGenericModal('Проверено: ' + fmtDate(p.date) + ', ' + fpNum(p.qty) + ' л', `
    <div class="form-group"><label>Комментарий (необязательно)</label>
      <input type="text" id="fkOkNote" placeholder="например: командировка, АЗС по пути"></div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">
      <button class="btn btn-ghost" onclick="closeModal('genericModal')">Отмена</button>
      <button class="btn btn-primary" onclick="fkSaveOk('${id}')">Отметить</button>
    </div>`, 460);
  setTimeout(() => document.getElementById('fkOkNote')?.focus(), 50);
}

function fkSaveOk(id) {
  const p = fpById(id);
  if (!p) return;
  p.checkOk = true;
  p.checkNote = (document.getElementById('fkOkNote')?.value || '').trim();
  closeModal('genericModal');
  fpSaveAndRender();
}
