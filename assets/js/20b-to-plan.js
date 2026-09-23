// Регламенты ТО и построение графика обслуживания.
//
// Интервал берётся из карточки машины («Интервал ТО, км» и «мес»), а если он
// не заполнен — из таблицы регламентов по марке (данные заводов и официальных
// дилеров для России). План строится от последнего выполненного ТО, а если
// его нет — от ближайшего кратного интервалу пробега. Дата считается по
// среднему пробегу машины за последние три месяца и ограничивается сроком
// по времени (обычно 12 месяцев).
//
// Плановые записи помечены planned: true — при пересчёте они заменяются,
// выполненные ТО не трогаются.

// Регламенты по маркам: интервал (км), срок (мес), интервал в тяжёлых
// условиях (км) и источник. Тяжёлые условия — Крайний Север, бездорожье,
// пыль, морозы: заводы рекомендуют сокращать интервал примерно вдвое.
const TO_REGS = [
  { re: /mitsubishi|l\s?200/i,            km: 15000, months: 12, hard: 7500,  src: 'Mitsubishi, дилеры РФ' },
  { re: /уаз|патриот|patriot/i,           km: 10000, months: 12, hard: 5000,  src: 'УАЗ, сервисная книжка' },
  { re: /нива\s*тр[еэ]вел|niva\s*travel/i, km: 15000, months: 12, hard: 7500, src: 'АвтоВАЗ, Niva Travel' },
  { re: /шевроле\s*нива|chevrolet\s*niva/i, km: 15000, months: 12, hard: 7500, src: 'Chevrolet Niva (ВАЗ-2123)' },
  { re: /лада\s*нива|lada\s*2121|нива/i,  km: 10000, months: 12, hard: 5000,  src: 'АвтоВАЗ, Niva Legend' },
  { re: /duster|дастер/i,                 km: 15000, months: 12, hard: 10000, src: 'Renault, бензин (дизель — 10 000)' },
  { re: /sandero|сандеро/i,               km: 15000, months: 12, hard: 10000, src: 'Renault Sandero' },
  { re: /hilux|хайлюкс/i,                 km: 10000, months: 12, hard: 5000,  src: 'Toyota, дилеры РФ' },
  { re: /land\s*rover|ленд\s*ровер/i,     km: 13000, months: 12, hard: 13000, src: 'Land Rover, РФ («тяжёлые условия»)' },
  { re: /bmw|бмв/i,                       km: 10000, months: 12, hard: 7000,  src: 'BMW, сервис РФ' },
  { re: /mercedes|мерседес|майбах|гелен/i, km: 15000, months: 12, hard: 10000, src: 'Mercedes-Benz: бензин 15 000, дизель 10 000' },
  { re: /audi|ауди/i,                     km: 15000, months: 12, hard: 15000, src: 'Audi, инспекционный сервис' },
  { re: /zeekr|зикр/i,                    km: 10000, months: 12, hard: 10000, src: 'Zeekr, дилеры РФ' },
  { re: /tank|танк/i,                     km: 10000, months: 12, hard: 10000, src: 'TANK 500, дилеры РФ' },
  { re: /jac/i,                           km: 10000, months: 12, hard: 5000,  src: 'JAC, регламент РФ' },
  { re: /садко|газ\b|газель|газон/i,      km: 10000, months: 12, hard: 10000, src: 'ГАЗ: ТО-1 10 000, ТО-2 20 000' },
  { re: /урал/i,                          km: 4000,  months: 6,  hard: 4000,  src: 'Урал-4320: ТО-1 4 000 км, ТО-2 16 000 км' },
  { re: /тр[эе]кол|trekol/i,              km: 5000,  months: 6,  hard: 5000,  src: 'ТРЭКОЛ 39041: ТО-0 1 500 км, далее каждые 5 000' },
];
const TO_DEFAULT = { km: 10000, months: 12, hard: 5000, src: 'общее правило для парка' };

// В марках попадаются русские буквы-двойники («MERСEDES» с русской С),
// поэтому ищем и по исходному тексту, и по переводу кириллицы в латиницу
const TO_CYR2LAT = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X' };
function toRegFor(v) {
  const text = [v.make, v.model].filter(Boolean).join(' ');
  const lat = text.toUpperCase().replace(/[АВЕКМНОРСТУХ]/g, ch => TO_CYR2LAT[ch]);
  return TO_REGS.find(r => r.re.test(text) || r.re.test(lat)) || TO_DEFAULT;
}

// Интервал машины: из карточки, иначе по регламенту марки
function toIntervalKm(v) { return +v.toIntervalKm || toRegFor(v).km; }
function toIntervalMonths(v) { return +v.toIntervalMonths || toRegFor(v).months; }

// Текущий пробег: начальный одометр плюс журнал
function toCurrentOdo(v) {
  return (+v.odometer || 0) + recsFor(v.id).reduce((s, r) => s + (+r.km || 0), 0);
}

// Средний пробег в сутки за последние 90 дней с записями
function toDailyKm(v) {
  const recs = recsFor(v.id).filter(r => +r.km > 0).sort((a, b) => cmpDateAsc(a.date, b.date));
  if (!recs.length) return 0;
  const last = recs[recs.length - 1].date;
  const from = new Date(new Date(last) - 89 * 86400000).toISOString().slice(0, 10);
  const tail = recs.filter(r => r.date >= from);
  const km = tail.reduce((s, r) => s + (+r.km || 0), 0);
  const days = Math.max(1, (new Date(last) - new Date(tail[0].date)) / 86400000 + 1);
  return km / days;
}

function toAddMonths(dateIso, months) {
  const d = new Date(dateIso);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

// План ТО машины на horizon месяцев вперёд
function toPlanFor(v, horizonMonths) {
  const interval = toIntervalKm(v), months = toIntervalMonths(v);
  const cur = toCurrentOdo(v);
  const perDay = toDailyKm(v);
  const today = new Date().toISOString().slice(0, 10);
  const done = vehicleToFor(v.id).filter(r => !r.planned).sort((a, b) => cmpDateAsc(a.date, b.date));
  const last = done[done.length - 1];

  // Отсчёт: от последнего ТО, иначе от ближайшего кратного интервалу пробега
  let nextOdo = last && last.nextOdometerAbs != null ? +last.nextOdometerAbs
    : last && last.odometer != null ? +last.odometer + interval
    : Math.floor(cur / interval) * interval + interval;
  let nextDate = last && last.date ? toAddMonths(last.date, months) : toAddMonths(today, months);

  const limit = toAddMonths(today, horizonMonths || 12);
  const out = [];
  for (let i = 0; i < 6; i++) {
    // Дата по пробегу: сколько дней до нужного пробега при текущем темпе
    const byKm = perDay > 0 ? new Date(Date.now() + Math.max(0, (nextOdo - cur) / perDay) * 86400000).toISOString().slice(0, 10) : null;
    const date = byKm && byKm < nextDate ? byKm : nextDate;
    if (date > limit) break;
    out.push({ date: date < today ? today : date, odo: nextOdo, overdue: date < today, byKm: !!(byKm && byKm < nextDate) });
    nextOdo += interval;
    nextDate = toAddMonths(date, months);
  }
  return { interval, months, cur, perDay, last, items: out };
}

// Пересчёт планов по всему парку: плановые записи заменяются, факт не трогается
async function toRebuildPlan(horizonMonths) {
  const vehicles = (data.vehicles || []).filter(v => !/списан|продан/i.test(v.status || ''));
  data.vehicleTo = (data.vehicleTo || []).filter(r => !r.planned);
  let added = 0;
  vehicles.forEach(v => {
    const p = toPlanFor(v, horizonMonths || 12);
    const reg = toRegFor(v);
    p.items.forEach((it, i) => {
      data.vehicleTo.push({
        id: 'vto_plan_' + v.id + '_' + i + '_' + Date.now().toString(36),
        vehicleId: v.id,
        date: it.date,
        type: 'ТО по регламенту (план)',
        planned: true,
        odometer: Math.round(it.odo),
        nextKm: p.interval,
        nextOdometerAbs: Math.round(it.odo),
        nextDate: it.date,
        cost: null,
        performer: '',
        note: 'Регламент: каждые ' + p.interval.toLocaleString('ru') + ' км или ' + p.months + ' мес. (' + reg.src + '). ' +
          (it.byKm ? 'Срок по пробегу' : 'Срок по времени') +
          (p.perDay ? ', средний пробег ' + Math.round(p.perDay) + ' км/сут' : ', пробег не ведётся') +
          (it.overdue ? '. ТО просрочено — поставлено на сегодня' : ''),
      });
      added++;
    });
  });
  await saveData(data);
  return added;
}

// Кнопка в разделе «График ТО»
async function toRebuildPlanClick() {
  if (!confirm('Построить план ТО по регламентам на 12 месяцев вперёд?\n\nПлановые записи будут пересозданы, выполненные ТО не изменятся.')) return;
  const n = await toRebuildPlan(12);
  showToast('План ТО построен: ' + n + ' записей');
  renderToScheduleSection();
}

// Таблица регламентов и ближайших ТО — для просмотра и выгрузки
function toPlanOverview() {
  return (data.vehicles || []).map(v => {
    const p = toPlanFor(v, 12);
    const reg = toRegFor(v);
    const next = p.items[0];
    return { v, reg, interval: p.interval, months: p.months, cur: p.cur, perDay: p.perDay,
             last: p.last, next, count: p.items.length };
  }).sort((a, b) => (a.next ? a.next.date : '9').localeCompare(b.next ? b.next.date : '9'));
}

// ─── Окно «Регламенты ТО» ─────────────────────────────────

function toShowRegs() {
  const list = toPlanOverview();
  const n = (x, d) => (+x || 0).toLocaleString('ru', { maximumFractionDigits: d ?? 0 });
  const today = new Date().toISOString().slice(0, 10);
  const rows = list.map(r => {
    const left = r.next ? r.next.odo - r.cur : null;
    const soon = r.next && (r.next.overdue || left <= r.interval * 0.15);
    return `<tr>
      <td><b>${fpEsc(r.v.plate)}</b><div style="font-size:12px;color:var(--text3)">${fpEsc(r.v.make || '')}</div></td>
      <td style="font-size:12px">${fpEsc(r.v.org || '')}<div style="color:var(--text3)">${fpEsc(r.v.status || '')}</div></td>
      <td style="text-align:right">${n(r.interval)} км<div style="font-size:11px;color:var(--text3)">${r.months} мес</div></td>
      <td style="font-size:12px;color:var(--text3);max-width:220px;white-space:normal">${fpEsc(r.reg.src)}${r.v.toIntervalKm ? '<div style="color:var(--green)">задан в карточке</div>' : ''}</td>
      <td style="text-align:right">${n(r.cur)}</td>
      <td style="text-align:right">${r.perDay ? n(r.perDay) + ' км/сут' : '—'}</td>
      <td>${r.last ? fmtDate(r.last.date) + '<div style="font-size:11px;color:var(--text3)">' + n(r.last.odometer) + ' км</div>' : '<span style="color:#d97706">не внесено</span>'}</td>
      <td style="${soon ? 'color:var(--red);font-weight:700' : ''}">${r.next ? fmtDate(r.next.date) : '—'}
        <div style="font-size:11px;font-weight:400;color:var(--text3)">${r.next ? n(r.next.odo) + ' км' + (left != null ? ', через ' + n(Math.max(0, left)) + ' км' : '') : ''}</div></td>
    </tr>`;
  }).join('');
  openGenericModal('Регламенты ТО и ближайшие сроки', `
    <div style="font-size:13px;color:var(--text3);margin-bottom:10px">
      Интервал берётся из карточки машины, а если там пусто — из заводского регламента по марке.
      Дата следующего ТО — по среднему пробегу за последние три месяца или по сроку в месяцах, что наступит раньше.</div>
    <div style="max-height:60vh;overflow:auto"><table class="data-table" style="width:100%">
      <thead><tr><th>Машина</th><th>Организация</th><th style="text-align:right">Интервал</th><th>Источник регламента</th>
        <th style="text-align:right">Пробег, км</th><th style="text-align:right">Темп</th><th>Последнее ТО</th><th>Следующее ТО</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div style="display:flex;justify-content:space-between;gap:8px;margin-top:12px">
      <button class="btn btn-ghost" onclick="toExportRegs()">Выгрузить в Excel</button>
      <span>
        <button class="btn btn-ghost" onclick="closeModal('genericModal')">Закрыть</button>
        <button class="btn btn-primary" onclick="closeModal('genericModal');toRebuildPlanClick()">Построить план</button>
      </span>
    </div>`, 1100);
}

function toExportRegs() {
  const list = toPlanOverview();
  const P = { navy: '1B3A6B', white: 'FFFFFF', gray1: 'F8FAFC', gray3: 'E2E8F0', text: '1E293B', red: 'B91C1C' };
  const b = { style: 'thin', color: { rgb: P.gray3 } }, border = { top: b, bottom: b, left: b, right: b };
  const st = o => Object.assign({ font: { sz: 10, color: { rgb: P.text } }, border, alignment: { vertical: 'center', wrapText: true } }, o);
  const head = st({ font: { bold: true, sz: 10, color: { rgb: P.white } }, fill: { patternType: 'solid', fgColor: { rgb: P.navy } },
                    alignment: { horizontal: 'center', vertical: 'center', wrapText: true } });
  const cols = ['Госномер', 'Марка', 'Организация', 'Объект', 'Состояние', 'Интервал ТО, км', 'Интервал, мес', 'Источник регламента',
                'Пробег сейчас, км', 'Средний пробег, км/сут', 'Последнее ТО', 'Пробег на последнем ТО',
                'Следующее ТО (дата)', 'Следующее ТО (пробег)', 'Осталось, км', 'Плановых ТО за год'];
  const ws = {};
  const put = (r, c, v, s, z) => { const cell = { v: v == null ? '' : v, t: typeof v === 'number' ? 'n' : 's', s }; if (z && typeof v === 'number') cell.z = z; ws[XLSX.utils.encode_cell({ r, c })] = cell; };
  put(0, 0, 'Регламенты ТО и график обслуживания на ' + fmtDate(new Date().toISOString().slice(0, 10)), { font: { bold: true, sz: 13 } });
  cols.forEach((c, i) => put(2, i, c, head));
  list.forEach((r, i) => {
    const R = i + 3, fill = i % 2 ? { fill: { patternType: 'solid', fgColor: { rgb: P.gray1 } } } : {};
    const s = st(fill), num = st(Object.assign({ alignment: { horizontal: 'right', vertical: 'center' } }, fill));
    const left = r.next ? Math.round(r.next.odo - r.cur) : null;
    const red = st(Object.assign({ alignment: { horizontal: 'right', vertical: 'center' }, font: { sz: 10, bold: true, color: { rgb: P.red } } }, fill));
    [r.v.plate, r.v.make, r.v.org || '', r.v.object || '', r.v.status || '', r.interval, r.months, r.reg.src,
     Math.round(r.cur), Math.round(r.perDay), r.last ? fmtDate(r.last.date) : 'не внесено', r.last ? Math.round(r.last.odometer || 0) : '',
     r.next ? fmtDate(r.next.date) : '', r.next ? Math.round(r.next.odo) : '', left, r.count]
      .forEach((v, c) => put(R, c, v, c === 14 && left != null && left <= r.interval * 0.15 ? red : typeof v === 'number' ? num : s, '#,##0'));
  });
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: list.length + 2, c: cols.length - 1 } });
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: cols.length - 1 } }];
  ws['!cols'] = [13, 20, 12, 24, 14, 12, 10, 34, 13, 12, 13, 14, 14, 14, 11, 10].map(wch => ({ wch }));
  ws['!rows'] = [{ hpt: 22 }, {}, { hpt: 40 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Регламенты ТО');
  XLSX.writeFile(wb, 'Регламенты_и_график_ТО_' + new Date().toISOString().slice(0, 10) + '.xlsx');
}


// ─── Разовая настройка после обновления ───────────────────
// Проставляет регламент машинам, у которых он не заполнен, и один раз строит
// график ТО, если плановых записей ещё нет. Отметка хранится в базе, поэтому
// на всех компьютерах это делается один раз, а не при каждом запуске.

async function toAutoSetupOnce() {
  if (!data.vehicles || !data.vehicles.length) return;
  const meta = (data.appMeta && data.appMeta[0]) || { id: 'meta' };
  if (!data.appMeta || !data.appMeta.length) (data.appMeta = data.appMeta || []).push(meta);

  let changed = 0;
  data.vehicles.forEach(v => {
    if (!v.toIntervalKm) {
      const reg = toRegFor(v);
      v.toIntervalKm = reg.km;
      v.toIntervalMonths = reg.months;
      changed++;
    }
  });

  const hasPlan = (data.vehicleTo || []).some(r => r.planned);
  const needPlan = !meta.toPlanInit && !hasPlan;
  if (!changed && !needPlan) return;

  if (needPlan) {
    await toRebuildPlan(12);          // внутри сохраняет данные
    meta.toPlanInit = new Date().toISOString();
    await saveData(data);
    showToast && showToast('Построен график ТО по регламентам');
  } else {
    await saveData(data);
    if (changed) showToast && showToast('Регламент ТО проставлен: ' + changed + ' машин');
  }
}
