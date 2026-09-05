// Экспорт в XLSX
// Выделено из index.html

// ─── EXPORT TO XLSX ─────────────────────────────────────
function exportToXlsx() {
  if (!selectedVehicleId) return;
  const v = data.vehicles.find(x => x.id === selectedVehicleId);
  if (!v) return;

  const MONTHS_RU_EXP = ['Январь','Февраль','Март','Апрель','Май','Июнь',
    'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const DAYS_RU_EXP   = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
  const fuelLabels    = { diesel:'Дизельное', gasoline:'Бензин', gas:'Газ (ГБО)' };
  const monthLabel    = `${MONTHS_RU_EXP[selectedMonth - 1]} ${selectedYear}`;

  // ── Records ──────────────────────────────────────────────
  const monthRecs = data.records.filter(rec => {
    if (rec.vehicleId !== v.id) return false;
    const d = new Date(rec.date);
    return d.getFullYear() === selectedYear && (d.getMonth() + 1) === selectedMonth;
  }).sort((a, b) => cmpDateAsc(a.date, b.date));

  const allRecs  = recsFor(v.id);
  const totalKm  = allRecs.reduce((s, rec) => s + (rec.km || 0), 0);
  const monthKm  = monthRecs.reduce((s, rec) => s + (rec.km || 0), 0);
  const totalFuel= allRecs.reduce((s, rec) => s + (rec.fuelActual || 0), 0);
  const monthIss = monthRecs.reduce((s, rec) => s + (rec.fuelIssued || 0), 0);
  const monthUsed= monthRecs.reduce((s, rec) => s + (rec.fuelActual || 0), 0);
  const avgAll   = totalKm > 0 && totalFuel > 0 ? +(totalFuel / totalKm * 100).toFixed(1) : null;
  const avgMonth = monthKm > 0 && monthUsed > 0 ? +(monthUsed / monthKm * 100).toFixed(2) : null;

  // ── Palette ──────────────────────────────────────────────
  const P = {
    dark:       '0F1117',
    navy:       '1B3A6B',
    navyMid:    '2D5A8E',
    navyLight:  'D6E4F7',
    white:      'FFFFFF',
    gray1:      'F8FAFC',
    gray2:      'F1F5F9',
    gray3:      'E2E8F0',
    gray4:      '94A3B8',
    text:       '1E293B',
    textMid:    '475569',
    blue:       '2563EB',
    bluePale:   'DBEAFE',
    green:      '16A34A',
    greenPale:  'DCFCE7',
    yellow:     'D97706',
    yellowPale: 'FEF3C7',
    teal:       '0D9488',
    tealPale:   'CCFBF1',
  };

  // ── Style helpers ─────────────────────────────────────────
  const NC = 15; // last column index (0-based), total 16 cols (A-P)

  function bd(style, rgb) { return { style, color: { rgb } }; }
  function bAll(style, rgb) {
    const b = bd(style, rgb);
    return { top: b, bottom: b, left: b, right: b };
  }
  function bSides(top, right, bottom, left, style, rgb) {
    const b = bd(style, rgb);
    return {
      top:    top    ? b : undefined,
      right:  right  ? b : undefined,
      bottom: bottom ? b : undefined,
      left:   left   ? b : undefined,
    };
  }

  function s(font, fill, align, border) {
    return {
      font:      font   || {},
      fill:      fill   ? { patternType:'solid', fgColor:{ rgb: fill } } : { patternType:'none' },
      alignment: align  || { vertical:'center' },
      border:    border || {},
    };
  }

  const STYLES = {
    title: s(
      { bold:true, sz:15, color:{ rgb: P.white } },
      P.dark,
      { horizontal:'center', vertical:'center' },
      bAll('medium', P.dark)
    ),
    subtitle: s(
      { sz:10, italic:true, color:{ rgb: P.gray4 } },
      P.dark,
      { horizontal:'center', vertical:'center' },
      bAll('medium', P.dark)
    ),
    secHeader: s(
      { bold:true, sz:11, color:{ rgb: P.white } },
      P.navy,
      { horizontal:'left', vertical:'center', indent:1 },
      bAll('medium', P.navy)
    ),
    infoLabel: s(
      { bold:true, sz:10, color:{ rgb: P.text } },
      P.navyLight,
      { horizontal:'left', vertical:'center', indent:1 },
      bAll('thin', P.gray3)
    ),
    infoValue: s(
      { sz:10, color:{ rgb: P.text } },
      P.white,
      { horizontal:'left', vertical:'center', indent:1 },
      bAll('thin', P.gray3)
    ),
    infoGap: s(
      null, P.gray2, null,
      bAll('thin', P.gray3)
    ),
    spacer: s(null, P.white, null, {}),
    tableHead: s(
      { bold:true, sz:10, color:{ rgb: P.white } },
      P.navyMid,
      { horizontal:'center', vertical:'center', wrapText:true },
      bAll('medium', P.navy)
    ),
    tdCenter: (bg) => s(
      { sz:10, color:{ rgb: P.text } },
      bg,
      { horizontal:'center', vertical:'center' },
      bAll('thin', P.gray3)
    ),
    tdRight: (bg) => s(
      { sz:10, color:{ rgb: P.text } },
      bg,
      { horizontal:'right', vertical:'center', indent:1 },
      bAll('thin', P.gray3)
    ),
    tdLeft: (bg) => s(
      { sz:10, color:{ rgb: P.text } },
      bg,
      { horizontal:'left', vertical:'center', indent:1 },
      bAll('thin', P.gray3)
    ),
    totals: s(
      { bold:true, sz:10, color:{ rgb: P.text } },
      P.navyLight,
      { horizontal:'center', vertical:'center' },
      bAll('medium', P.navy)
    ),
    totalsLeft: s(
      { bold:true, sz:10, color:{ rgb: P.text } },
      P.navyLight,
      { horizontal:'left', vertical:'center', indent:1 },
      bAll('medium', P.navy)
    ),
  };

  // ── Worksheet builder ─────────────────────────────────────
  const ws  = {};
  ws['!merges'] = [];
  ws['!rows']   = [];
  let row = 0;

  function put(r, c, val, style) {
    const addr = XLSX.utils.encode_cell({ r, c });
    const t = typeof val === 'number' ? 'n' : 's';
    ws[addr] = { v: val ?? '', t, s: style };
    ws['!ref'] = XLSX.utils.encode_range({ s:{r:0,c:0}, e:{r, c:NC} });
  }
  function merge(r1, c1, r2, c2) {
    ws['!merges'].push({ s:{r:r1,c:c1}, e:{r:r2,c:c2} });
  }
  function fillEmpty(r, style, from, to) {
    for (let c = (from||0); c <= (to ?? NC); c++) {
      if (!ws[XLSX.utils.encode_cell({r, c})]) put(r, c, '', style);
    }
  }
  function rowH(r, hpt) { ws['!rows'][r] = { hpt }; }

  // ════════════════════════════════════════════════
  // BLOCK 1 — TITLE
  // ════════════════════════════════════════════════
  put(row, 0, `ОТЧЁТ ПО ПРОБЕГУ И РАСХОДУ ТОПЛИВА — ${monthLabel.toUpperCase()}`, STYLES.title);
  merge(row, 0, row, NC); fillEmpty(row, STYLES.title); rowH(row, 34); row++;

  put(row, 0, `${v.make}   ·   ${v.plate}   ·   ${v.driver}`, STYLES.subtitle);
  merge(row, 0, row, NC); fillEmpty(row, STYLES.subtitle); rowH(row, 18); row++;

  // spacer
  put(row, 0, '', STYLES.spacer); merge(row, 0, row, NC); fillEmpty(row, STYLES.spacer); rowH(row, 6); row++;

  // ════════════════════════════════════════════════
  // BLOCK 2 — VEHICLE INFO
  // cols: 0-1 label | 2-4 value | 5 gap | 6-7 label | 8-10 value
  // ════════════════════════════════════════════════
  put(row, 0, '  СВЕДЕНИЯ О ТРАНСПОРТНОМ СРЕДСТВЕ', STYLES.secHeader);
  merge(row, 0, row, NC); fillEmpty(row, STYLES.secHeader); rowH(row, 22); row++;

  function infoRow(l1, v1, l2, v2) {
    put(row, 0, l1, STYLES.infoLabel); merge(row, 0, row, 1);
    put(row, 2, v1, STYLES.infoValue); merge(row, 2, row, 4);
    put(row, 5, '',  STYLES.infoGap);
    if (l2 != null) {
      put(row, 6, l2, STYLES.infoLabel); merge(row, 6, row, 7);
      put(row, 8, v2, STYLES.infoValue); merge(row, 8, row, NC);
    } else {
      put(row, 6, '', STYLES.infoValue); merge(row, 6, row, NC);
    }
    rowH(row, 20); row++;
  }

  infoRow('Марка / Модель ТС',        v.make,                   'ФИО водителя',             v.driver);
  infoRow('Государственный номер',    v.plate,                   'Организация / Исполнитель', v.org    || '—');
  infoRow('Вид топлива',              fuelLabels[v.fuel] || '—', 'Объект',                   v.object || '—');
  infoRow('Норма расхода, л/100 км',  v.norm ? String(v.norm) : '—', 'Примечание',           v.note   || '—');

  put(row, 0, '', STYLES.spacer); merge(row, 0, row, NC); fillEmpty(row, STYLES.spacer); rowH(row, 8); row++;

  // ════════════════════════════════════════════════
  // BLOCK 3 — STAT BOXES (mirror 4 cards from HTML)
  // 4 boxes: cols 0-2 | 3-5 | 6-8 | 9-10
  // ════════════════════════════════════════════════
  put(row, 0, '  СВОДНЫЕ ПОКАЗАТЕЛИ', STYLES.secHeader);
  merge(row, 0, row, NC); fillEmpty(row, STYLES.secHeader); rowH(row, 22); row++;

  const boxes = [
    { label:'ОБЩИЙ ПРОБЕГ',    val: Math.round(totalKm).toLocaleString('ru') + ' км',
      sub:'За всё время',          c1:0, c2:2, labelC:P.blue,   paleC:P.bluePale },
    { label:'ПРОБЕГ ЗА МЕСЯЦ', val: Math.round(monthKm).toLocaleString('ru') + ' км',
      sub: monthLabel,             c1:3, c2:5, labelC:P.navyMid, paleC:P.navyLight },
    { label:'РАСХОД ТОПЛИВА',   val: totalFuel.toLocaleString('ru',{maximumFractionDigits:1}) + ' л',
      sub:'Факт., всё время',      c1:6, c2:8, labelC:P.yellow,  paleC:P.yellowPale },
    { label:'СРЕДНИЙ РАСХОД',   val: avgAll ? avgAll + ' л/100 км' : '—',
      sub: v.norm ? 'Норма: ' + v.norm + ' л/100 км' : 'Норма не задана',
      c1:9, c2:NC, labelC:P.green, paleC:P.greenPale },
  ];

  const labelRow = row, valRow = row + 1, subRow = row + 2;
  rowH(labelRow, 20); rowH(valRow, 26); rowH(subRow, 18);

  boxes.forEach(b => {
    const sLbl = s({ bold:true, sz:9,  color:{ rgb: P.white } }, b.labelC,
      { horizontal:'center', vertical:'center' }, bAll('medium', b.labelC));
    const sVal = s({ bold:true, sz:14, color:{ rgb: b.labelC } }, b.paleC,
      { horizontal:'center', vertical:'center' }, bAll('medium', b.labelC));
    const sSub = s({ sz:9, italic:true, color:{ rgb: P.textMid } }, b.paleC,
      { horizontal:'center', vertical:'center' }, bAll('medium', b.labelC));

    put(labelRow, b.c1, b.label, sLbl); merge(labelRow, b.c1, labelRow, b.c2);
    for (let c = b.c1; c <= b.c2; c++) fillEmpty(labelRow, sLbl, c, c);

    put(valRow,   b.c1, b.val,   sVal); merge(valRow,   b.c1, valRow,   b.c2);
    for (let c = b.c1; c <= b.c2; c++) fillEmpty(valRow, sVal, c, c);

    put(subRow,   b.c1, b.sub,   sSub); merge(subRow,   b.c1, subRow,   b.c2);
    for (let c = b.c1; c <= b.c2; c++) fillEmpty(subRow, sSub, c, c);
  });

  row += 3;
  put(row, 0, '', STYLES.spacer); merge(row, 0, row, NC); fillEmpty(row, STYLES.spacer); rowH(row, 8); row++;

  // ════════════════════════════════════════════════
  // BLOCK 4 — DAILY RECORDS TABLE
  // ════════════════════════════════════════════════
  put(row, 0, `  ЕЖЕДНЕВНЫЕ ЗАПИСИ — ${monthLabel}`, STYLES.secHeader);
  merge(row, 0, row, NC); fillEmpty(row, STYLES.secHeader); rowH(row, 22); row++;

  const monthFuelIdle   = monthRecs.reduce((s, rec) => s + (rec.fuelIdle   || 0), 0);
  const monthFuelActual = monthRecs.reduce((s, rec) => s + (rec.fuelActual || 0), 0);

  const TH = ['№','Дата','День','Пробег, км','Одометр нач.','Одометр кон.',
               'Выдано, л','Расход по норме, л','Факт. расход, л','Расход ХХ, л','Остаток, л',
               'Норма л/100','Факт л/100','Маршрут / Описание','Примечание','Водитель'];
  TH.forEach((h, c) => put(row, c, h, STYLES.tableHead));
  rowH(row, 24); row++;

  const xlsBalMap = computeFuelBalances(v.id);

  monthRecs.forEach((rec, i) => {
    const d    = new Date(rec.date);
    const bg   = i % 2 === 0 ? P.white : P.gray1;
    const bal      = xlsBalMap[rec.id] != null ? xlsBalMap[rec.id] : '';
    const normL100 = v.norm ? v.norm : '';
    const factL100 = rec.fuelActual && rec.km > 0 ? +(rec.fuelActual / rec.km * 100).toFixed(2) : '';

    put(row, 0,  i + 1,                                       STYLES.tdCenter(bg));
    put(row, 1,  fmtDate(rec.date),                           STYLES.tdCenter(bg));
    put(row, 2,  DAYS_RU_EXP[d.getDay()],                    STYLES.tdCenter(bg));
    put(row, 3,  rec.km          || 0,                        STYLES.tdRight(bg));
    put(row, 4,  rec.odoStart    != null ? rec.odoStart : '', STYLES.tdRight(bg));
    put(row, 5,  rec.odoEnd      != null ? rec.odoEnd   : '', STYLES.tdRight(bg));
    put(row, 6,  rec.fuelIssued  != null ? rec.fuelIssued  :'', STYLES.tdRight(bg));
    put(row, 7,  rec.fuelUsed    != null ? rec.fuelUsed    :'', STYLES.tdRight(bg));
    put(row, 8,  rec.fuelActual  != null ? rec.fuelActual  :'', STYLES.tdRight(bg));
    put(row, 9,  rec.fuelIdle    != null ? rec.fuelIdle    :'', STYLES.tdRight(bg));
    put(row, 10, bal,                                          STYLES.tdRight(bg));
    put(row, 11, normL100,                                     STYLES.tdRight(bg));
    put(row, 12, factL100,                                     STYLES.tdRight(bg));
    put(row, 13, Array.isArray(rec.route) ? rec.route.join(' | ') : (rec.route || ''), STYLES.tdLeft(bg));
    put(row, 14, rec.note   || '',                             STYLES.tdLeft(bg));
    put(row, 15, rec.driver || '',                             STYLES.tdLeft(bg));
    rowH(row, 19); row++;
  });

  // end-of-month balance = balance of last record in month
  const lastRec = monthRecs[monthRecs.length - 1];
  const endBal  = lastRec ? (xlsBalMap[lastRec.id] ?? '') : '';

  // Totals row
  put(row, 0,  '',                                            STYLES.totals);
  put(row, 1,  'ИТОГО',                                       STYLES.totalsLeft);
  put(row, 2,  '',                                            STYLES.totals);
  put(row, 3,  monthKm   || 0,                                STYLES.totals);
  put(row, 4,  '',                                            STYLES.totals);
  put(row, 5,  '',                                            STYLES.totals);
  put(row, 6,  monthIss        || 0,  STYLES.totals);
  put(row, 7,  monthUsed       || 0,  STYLES.totals);
  put(row, 8,  monthFuelActual || 0,  STYLES.totals);
  put(row, 9,  monthFuelIdle   || '', STYLES.totals);
  const avgFactL100 = monthKm > 0 && monthFuelActual > 0 ? +(monthFuelActual / monthKm * 100).toFixed(2) : '';
  put(row, 10, endBal,               STYLES.totals);
  put(row, 11, v.norm || '',         STYLES.totals);
  put(row, 12, avgFactL100,          STYLES.totals);
  put(row, 13, '',                   STYLES.totals);
  put(row, 14, '',                   STYLES.totals);
  put(row, 15, '',                   STYLES.totals);
  rowH(row, 22);

  // ── Column widths ──────────────────────────────────────────
  ws['!cols'] = [
    {wch:4}, {wch:12}, {wch:6}, {wch:13}, {wch:15},
    {wch:15}, {wch:14}, {wch:15}, {wch:15}, {wch:13}, {wch:13}, {wch:12}, {wch:12}, {wch:30}, {wch:30}, {wch:24},
  ];

  const wb = XLSX.utils.book_new();
  const safeplate = v.plate.replace(/[\/\\?*[\]]/g, '_');
  XLSX.utils.book_append_sheet(wb, ws, monthLabel);
  XLSX.writeFile(wb, `Пробег_${safeplate}_${monthLabel}.xlsx`);
}

// ─── EXPORT ALL TO XLSX ──────────────────────────────────
let transportExportFormat = 'xls';
function openExportPeriodModal(fmt) {
  if (!data.vehicles.length) return;
  transportExportFormat = fmt === 'pdf' ? 'pdf' : 'xls';
  const t = document.getElementById('exportPeriodTitle');
  if (t) t.textContent = transportExportFormat === 'pdf' ? 'Выгрузка сводки в PDF' : 'Выгрузка сводки в Excel';
  document.getElementById('ep_all').checked = true;
  document.getElementById('ep_range_inputs').style.display = 'none';
  const now = new Date();
  const y = now.getFullYear(), m = (now.getMonth()+1).toString().padStart(2,'0');
  document.getElementById('ep_date_from').value = `01.${m}.${y}`;
  document.getElementById('ep_date_to').value = fmtDate(now.toISOString().split('T')[0]);
  openModal('exportPeriodModal');
}

// Наклон карточки под курсором.
// Раньше на каждое событие mousemove (их до 120 в секунду) вызывался
// getBoundingClientRect и сразу записывался transform — браузер был вынужден
// пересчитывать раскладку по нескольку раз за кадр. Теперь размеры карточки
// берутся один раз при наведении, а запись стилей происходит не чаще одного
// раза за кадр через requestAnimationFrame.
const CARD_SEL = '.menu-tile, .vehicle-card, .vd-journal-card';
const _reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let _tiltCard = null, _tiltRect = null, _tiltX = 0, _tiltY = 0, _tiltPending = false;

function _tiltApply() {
  _tiltPending = false;
  if (!_tiltCard || !_tiltRect) return;
  const px = (_tiltX - _tiltRect.left) / _tiltRect.width;
  const py = (_tiltY - _tiltRect.top) / _tiltRect.height;
  _tiltCard.style.setProperty('--mouse-x', (px * 100) + '%');
  _tiltCard.style.setProperty('--mouse-y', (py * 100) + '%');
  _tiltCard.style.transform =
    `perspective(600px) rotateX(${(py - 0.5) * -6}deg) rotateY(${(px - 0.5) * 6}deg) translateY(-2px)`;
}

function _tiltReset() {
  if (_tiltCard) _tiltCard.style.transform = '';
  _tiltCard = null; _tiltRect = null;
}

if (!_reduceMotion) {
  // Смена карточки под курсором — единственный момент, когда нужны её размеры.
  document.addEventListener('mouseover', (e) => {
    const card = e.target.closest(CARD_SEL);
    if (card === _tiltCard) return;
    _tiltReset();
    if (card) { _tiltCard = card; _tiltRect = card.getBoundingClientRect(); }
  });

  document.addEventListener('mousemove', (e) => {
    if (!_tiltCard) return;
    _tiltX = e.clientX; _tiltY = e.clientY;
    if (_tiltPending) return;
    _tiltPending = true;
    requestAnimationFrame(_tiltApply);
  }, { passive: true });

  document.addEventListener('mouseout', (e) => {
    if (_tiltCard && !_tiltCard.contains(e.relatedTarget)) _tiltReset();
  });

  // При прокрутке запомненные размеры устаревают — проще сбросить наклон.
  document.addEventListener('scroll', () => { if (_tiltCard) _tiltReset(); }, true);
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn');
  if (!btn) return;
  const existing = btn.querySelector('.ripple');
  if (existing) existing.remove();
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  const r = btn.getBoundingClientRect();
  const sz = Math.max(r.width, r.height);
  ripple.style.width = ripple.style.height = sz + 'px';
  ripple.style.left = (e.clientX - r.left - sz / 2) + 'px';
  ripple.style.top = (e.clientY - r.top - sz / 2) + 'px';
  btn.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove());
});

