// Учёт топлива: справочник топливных карт и закрытие месяца.
//
// Карта закрепляется за машиной с даты: assignments = [{ vehicleId, from, to }].
// Загрузка выписок опознаёт машину в первую очередь по карте на дату покупки —
// это надёжнее номера в комментарии. Передали карту другой машине — добавляется
// новое закрепление, история остаётся.
//
// Закрытый месяц защищён от правок: журнал пробега, заправки из выписок
// и загрузка выписок в него не пишут. Месяц можно открыть обратно —
// открытие и закрытие записываются в историю месяца.

// ─── Топливные карты ──────────────────────────────────────

function fcList() { return data.fuelCards || (data.fuelCards = []); }
function fcNorm(s) { return String(s || '').replace(/\D/g, ''); }
function fcFormat(n) { return String(n || '').replace(/(\d{4})(?=\d)/g, '$1 '); }

// Поставщик по началу номера — для подписи, на сопоставление не влияет
function fcGuessProvider(n) {
  if (/^7005/.test(n)) return 'Газпромнефть';
  if (/^78248677/.test(n)) return 'Лукойл';
  if (/^78248610/.test(n)) return 'Офисные карты';
  return '';
}

function fcByNumber(num) {
  const n = fcNorm(num);
  return n ? fcList().find(c => c.number === n) : null;
}

// Машина, за которой карта числилась на дату
function fcVehicleAt(num, date) {
  const c = fcByNumber(num);
  if (!c || c.status === 'blocked') return null;
  const a = (c.assignments || []).filter(x => (!x.from || x.from <= date) && (!x.to || x.to >= date));
  const last = a[a.length - 1];
  return last && (data.vehicles || []).find(v => v.id === last.vehicleId) || null;
}

function fcCurrentVehicleId(c) {
  const a = c.assignments || [];
  const open = a.filter(x => !x.to);
  return (open[open.length - 1] || {}).vehicleId || '';
}

// Первичное заполнение: номера из карточек машин и карты из выписок.
// Карта закрепляется за машиной, которой по ней больше всего покупок;
// если покупок нет — за машиной, в карточке которой записан номер.
function fcSeed() {
  const known = new Set(fcList().map(c => c.number));
  const stats = new Map();
  fpLive().forEach(p => {
    const n = fcNorm(p.cardNo);
    if (n.length < 8 || !p.vehicleId) return;
    const s = stats.get(n) || { veh: new Map(), first: p.date };
    s.veh.set(p.vehicleId, (s.veh.get(p.vehicleId) || 0) + 1);
    if (p.date < s.first) s.first = p.date;
    stats.set(n, s);
  });
  const fromVehicles = new Map();
  (data.vehicles || []).forEach(v => {
    const n = fcNorm(v.fuelcard);
    if (n.length >= 10) { if (!fromVehicles.has(n)) fromVehicles.set(n, []); fromVehicles.get(n).push(v.id); }
  });
  let added = 0;
  new Set([...stats.keys(), ...fromVehicles.keys()]).forEach(n => {
    if (known.has(n)) return;
    const s = stats.get(n);
    const top = s ? [...s.veh.entries()].sort((a, b) => b[1] - a[1])[0][0] : fromVehicles.get(n)[0];
    const shared = (fromVehicles.get(n) || []).length > 1;
    fcList().push({
      id: 'fc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      number: n, provider: fcGuessProvider(n), status: 'active', limit: null,
      assignments: [{ vehicleId: top, from: '', to: '' }],
      note: shared ? 'номер записан в карточках нескольких машин' : '',
    });
    added++;
  });
  return added;
}

// ─── Закрытые месяцы ──────────────────────────────────────

function fuelPeriods() { return data.fuelPeriods || (data.fuelPeriods = []); }
function fuelPeriod(month) { return fuelPeriods().find(p => p.month === month); }
function fuelMonthClosed(dateOrMonth) {
  const m = String(dateOrMonth || '').slice(0, 7);
  const p = m && fuelPeriod(m);
  return !!(p && p.closed);
}
// Проверка перед правкой: true — можно, false — месяц закрыт (с сообщением)
function fuelEditAllowed(...dates) {
  const closed = [...new Set(dates.filter(Boolean).map(d => String(d).slice(0, 7)))].filter(fuelMonthClosed);
  if (!closed.length) return true;
  alert('Месяц закрыт: ' + closed.map(m => fpMonthLabel(m)).join(', ') +
    '.\nЧтобы внести правку, откройте месяц: Заправки → Закрытие месяца.');
  return false;
}

// ─── Вкладка «Карты» ──────────────────────────────────────

let fcSearch = '';

function fcCardsHtml() {
  const month = fpMonth && fpMonth !== 'all' ? fpMonth : new Date().toISOString().slice(0, 7);
  const q = fcSearch.toLowerCase().trim();
  const used = new Map(), last = new Map(), unassigned = new Map();
  fpLive().forEach(p => {
    const n = fcNorm(p.cardNo);
    if (!n) return;
    if ((p.date || '').startsWith(month)) used.set(n, (used.get(n) || 0) + (+p.qty || 0));
    if (!last.has(n) || p.date > last.get(n)) last.set(n, p.date);
    if (!p.vehicleId) unassigned.set(n, (unassigned.get(n) || 0) + 1);
  });
  const vt = id => { const v = (data.vehicles || []).find(x => x.id === id); return v ? fpVehicleTitle(v) : '—'; };
  const list = fcList().filter(c => {
    if (!q) return true;
    return [c.number, c.provider, c.note, vt(fcCurrentVehicleId(c))].join(' ').toLowerCase().includes(q);
  }).sort((a, b) => vt(fcCurrentVehicleId(a)).localeCompare(vt(fcCurrentVehicleId(b)), 'ru'));

  // Карты из выписок, которых нет в справочнике
  const unknown = [...last.keys()].filter(n => !fcByNumber(n));

  const rows = list.map(c => {
    const u = used.get(c.number) || 0;
    const over = c.limit && u > c.limit;
    const hist = (c.assignments || []).length > 1
      ? `<div style="font-size:11px;color:var(--text3)">${c.assignments.map(a => vt(a.vehicleId).split(' — ')[0] +
          (a.from ? ' с ' + fmtDate(a.from) : '') + (a.to ? ' по ' + fmtDate(a.to) : '')).join('<br>')}</div>` : '';
    return `<tr>
      <td style="font-family:monospace;white-space:nowrap">${fcFormat(c.number)}</td>
      <td>${fpEsc(c.provider || '—')}</td>
      <td>${c.status === 'blocked' ? '<span style="color:var(--text3)">заблокирована</span>' : fpEsc(vt(fcCurrentVehicleId(c)))}${hist}</td>
      <td style="text-align:right">${c.limit ? fpNum(c.limit, 0) : '—'}</td>
      <td style="text-align:right;${over ? 'color:var(--red);font-weight:700' : ''}">${u ? fpNum(u, 1) : '—'}${over ? '<div style="font-size:11px">лимит превышен</div>' : ''}</td>
      <td>${last.has(c.number) ? fmtDate(last.get(c.number)) : '—'}</td>
      <td style="font-size:12px;color:var(--text3);max-width:200px;white-space:normal">${fpEsc(c.note || '')}${unassigned.get(c.number) ? `<div style="color:#d97706">без машины: ${unassigned.get(c.number)}</div>` : ''}</td>
      <td style="white-space:nowrap"><button class="btn btn-ghost btn-sm" onclick="fcEdit('${c.id}')">Изменить</button></td>
    </tr>`;
  }).join('');

  return `
    <div class="vehicle-cards-toolbar">
      <input type="text" placeholder="Поиск по номеру, машине..." value="${fpEsc(fcSearch)}" oninput="fcSearch=this.value;renderFuelPurchases()">
      <button class="btn btn-ghost" onclick="fcSeedClick()">Заполнить из карточек и выписок</button>
      <button class="btn btn-primary" onclick="fcEdit('')">Добавить карту</button>
    </div>
    ${unknown.length ? `<div style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:13px">
      В выписках есть карты, которых нет в справочнике: ${unknown.map(fcFormat).join(', ')}. Нажмите «Заполнить из карточек и выписок».</div>` : ''}
    <div class="table-wrap"><div class="table-scroll" style="overflow-x:auto">
      <table class="data-table" style="width:100%">
        <thead><tr><th>Номер карты</th><th>Поставщик</th><th>Машина</th><th style="text-align:right">Лимит, л/мес</th>
          <th style="text-align:right">Заправлено за ${fpMonthLabel(month).toLowerCase()}, л</th><th>Последняя заправка</th><th>Примечание</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:16px">Карт нет. Нажмите «Заполнить из карточек и выписок».</td></tr>'}</tbody>
      </table>
    </div></div>
    <div style="font-size:12px;color:var(--text3);margin-top:10px">
      Загрузка выписок опознаёт машину в первую очередь по карте на дату покупки. Если карту передали другой машине,
      укажите новую машину и дату — прежнее закрепление сохранится в истории, а покупки с этой даты можно перенести.
    </div>`;
}

async function fcSeedClick() {
  const n = fcSeed();
  await saveData(data);
  showToast && showToast(n ? 'Добавлено карт: ' + n : 'Новых карт не найдено');
  renderFuelPurchases();
}

function fcEdit(id) {
  const c = id ? fcList().find(x => x.id === id) : null;
  const cur = c ? fcCurrentVehicleId(c) : '';
  openGenericModal(c ? 'Карта ' + fcFormat(c.number) : 'Новая карта', `
    <div class="form-row">
      <div class="form-group"><label>Номер карты</label><input type="text" id="fc_number" value="${c ? fcFormat(c.number) : ''}" ${c ? 'readonly' : ''}></div>
      <div class="form-group"><label>Поставщик</label><input type="text" id="fc_provider" value="${fpEsc(c ? c.provider : '')}" placeholder="Газпромнефть, Лукойл..."></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Машина</label><select id="fc_vehicle">${fuelImportVehicleOptions(cur, true)}</select></div>
      <div class="form-group"><label>С даты (если машина меняется)</label><input type="text" id="fc_from" placeholder="ДД.ММ.ГГГГ"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Лимит, л в месяц</label><input type="number" id="fc_limit" value="${c && c.limit ? c.limit : ''}"></div>
      <div class="form-group"><label>Состояние</label><select id="fc_status">
        <option value="active"${!c || c.status !== 'blocked' ? ' selected' : ''}>Действует</option>
        <option value="blocked"${c && c.status === 'blocked' ? ' selected' : ''}>Заблокирована</option></select></div>
    </div>
    <div class="form-group"><label>Примечание</label><input type="text" id="fc_note" value="${fpEsc(c ? c.note : '')}"></div>
    <label style="font-size:13px;display:flex;gap:6px;align-items:center;margin:6px 0 12px">
      <input type="checkbox" id="fc_move" checked> перенести покупки по карте с этой даты на новую машину (кроме закрытых месяцев)</label>
    <div style="display:flex;justify-content:space-between;gap:8px">
      ${c ? `<button class="btn btn-ghost" style="color:var(--red)" onclick="fcDelete('${c.id}')">Удалить карту</button>` : '<span></span>'}
      <span><button class="btn btn-ghost" onclick="closeModal('genericModal')">Отмена</button>
      <button class="btn btn-primary" onclick="fcSave('${c ? c.id : ''}')">Сохранить</button></span>
    </div>`, 620);
}

async function fcSave(id) {
  let c = id ? fcList().find(x => x.id === id) : null;
  const number = fcNorm(document.getElementById('fc_number').value);
  if (!c) {
    if (number.length < 6) { showFieldError('Укажите номер карты', 'fc_number'); return; }
    if (fcByNumber(number)) { alert('Такая карта уже есть в справочнике'); return; }
    c = { id: 'fc_' + Date.now(), number, assignments: [] };
    fcList().push(c);
  }
  c.provider = document.getElementById('fc_provider').value.trim();
  c.limit = parseFloat(document.getElementById('fc_limit').value) || null;
  c.status = document.getElementById('fc_status').value;
  c.note = document.getElementById('fc_note').value.trim();
  const vid = document.getElementById('fc_vehicle').value;
  const fromRaw = document.getElementById('fc_from').value.trim();
  const from = fromRaw ? parseDate(fromRaw) : '';
  if (fromRaw && !from) { showFieldError('Дата в формате ДД.ММ.ГГГГ', 'fc_from'); return; }
  let moved = 0, skipped = 0;
  if (vid !== fcCurrentVehicleId(c)) {
    const a = c.assignments || (c.assignments = []);
    const open = a.filter(x => !x.to).pop();
    if (open) {
      if (from) { const d = new Date(from); d.setDate(d.getDate() - 1); open.to = d.toISOString().slice(0, 10); }
      else a.splice(a.indexOf(open), 1);   // без даты — просто исправляем закрепление
    }
    if (vid) a.push({ vehicleId: vid, from: from || '', to: '' });
    if (vid && document.getElementById('fc_move').checked) {
      fpLive().filter(p => fcNorm(p.cardNo) === c.number && (!from || p.date >= from) && p.vehicleId !== vid).forEach(p => {
        if (fuelMonthClosed(p.date)) { skipped++; return; }
        const v = (data.vehicles || []).find(x => x.id === vid);
        fpUpdate(p, { vehicleId: vid, grade: parseFuelGrade(p.product) || p.grade || vehicleFuelGrade(v) });
        moved++;
      });
    }
  }
  closeModal('genericModal');
  await saveData(data);
  if (moved || skipped) alert('Перенесено покупок: ' + moved + (skipped ? '\nВ закрытых месяцах не тронуто: ' + skipped : ''));
  renderFuelPurchases();
}

async function fcDelete(id) {
  if (!confirm('Удалить карту из справочника? Покупки по ней останутся.')) return;
  data.fuelCards = fcList().filter(c => c.id !== id);
  closeModal('genericModal');
  await saveData(data);
  renderFuelPurchases();
}

// ─── Вкладка «Закрытие месяца» ────────────────────────────

let fcCloseMonth = '';

function fcMonthEndBalance(vid, month) {
  const bal = computeFuelBalances(vid);
  const recs = recsFor(vid).filter(r => r.date <= month + '-31').sort((a, b) => cmpDateAsc(a.date, b.date));
  return recs.length ? bal[recs[recs.length - 1].id] : null;
}

function fcChecklist(month) {
  const items = [];
  const inM = p => (p.date || '').startsWith(month);
  const prevM = fpPrevMonth(month), prev2 = fpPrevMonth(prevM);

  // 1. Выписки: карта работала в прошлые два месяца, а в этом покупок нет
  const cardsBefore = new Set(), cardsNow = new Set();
  fpLive().forEach(p => {
    const n = fcNorm(p.cardNo); if (!n) return;
    if (inM(p)) cardsNow.add(n);
    else if (p.date.startsWith(prevM) || p.date.startsWith(prev2)) cardsBefore.add(n);
  });
  const silent = [...cardsBefore].filter(n => !cardsNow.has(n) && (fcByNumber(n) || {}).status !== 'blocked');
  items.push({ title: 'Выписки загружены по всем картам', bad: silent.length,
    detail: silent.length ? 'нет покупок за месяц по картам, которые работали раньше: ' + silent.map(n => {
      const v = fcVehicleAt(n, month + '-15'); return fcFormat(n) + (v ? ' (' + v.plate + ')' : ''); }).join(', ') : '',
    tab: 'cards' });

  // 2. Покупки без машины
  const unm = fpLive().filter(p => !p.vehicleId && inM(p));
  items.push({ title: 'Все покупки привязаны к машинам', bad: unm.length,
    detail: unm.length ? unm.length + ' покупок на ' + fpNum(unm.reduce((s, p) => s + p.qty, 0), 1) + ' л' : '', tab: 'unmatched' });

  // 3. Журнал совпадает с выписками
  const byRecord = fpStats();
  const diffRecs = new Set();
  fpLive().filter(p => p.vehicleId && inM(p)).forEach(p => {
    const st = fpJournalState(p, byRecord);
    if (st.state !== 'ok') diffRecs.add(p.vehicleId + p.date);
  });
  items.push({ title: 'Журнал совпадает с выписками', bad: diffRecs.size,
    detail: diffRecs.size ? diffRecs.size + ' дн. с расхождением' : '', tab: 'cards' });

  // 4. Сдвоенные заправки разобраны
  const saveM = fpMonth; fpMonth = month;
  const dbl = fpDoubles().filter(d => d.flags.length && !d.checked);
  fpMonth = saveM;
  items.push({ title: 'Сдвоенные заправки с отметками проверены', bad: dbl.length,
    detail: dbl.length ? dbl.map(d => d.v.plate + ' ' + fmtDate(d.date).slice(0, 5)).join(', ') : '', tab: 'doubles' });

  // 4а. Проверки заправок: бак, цена, регион
  if (typeof fkChecks === 'function') {
    const chk = fkChecks(month).filter(x => !x.p.checkOk);
    items.push({ title: 'Проверки заправок разобраны (бак, цена, регион)', bad: chk.length,
      detail: chk.length ? chk.slice(0, 12).map(x => x.v.plate + ' ' + fmtDate(x.p.date).slice(0, 5)).join(', ') + (chk.length > 12 ? '…' : '') : '', tab: 'checks' });
  }

  // 5. Нет отрицательного остатка на конец месяца
  const neg = (data.vehicles || []).map(v => ({ v, b: fcMonthEndBalance(v.id, month) }))
    .filter(x => x.b != null && x.b < -0.05 && recsFor(x.v.id).some(r => r.date.startsWith(month)));
  items.push({ title: 'Нет машин с отрицательным остатком на конец месяца', bad: neg.length,
    detail: neg.length ? neg.map(x => x.v.plate + ' ' + fpNum(x.b, 0) + ' л').join(', ') : '', tab: 'negative' });

  // 5а. Пробег по ГЛОНАСС
  if (typeof fgRows === 'function') {
    const saveNo = fgNoOffice; fgNoOffice = true;
    const gl = fgRows(month).filter(r => r.diff >= FG_DIFF_KM && r.pct != null && r.pct >= FG_DIFF_PCT);
    fgNoOffice = saveNo;
    items.push({ title: 'Пробег в журнале не больше ГЛОНАСС', bad: gl.length, soft: true,
      detail: gl.length ? gl.map(r => r.v.plate + ' +' + fpNum(r.diff, 0) + ' км').join(', ') : '', tab: 'glonass' });
  }

  // 5б. Сверка с 1С внесена
  if (typeof frcData === 'function') {
    const recon = (fuelPeriod(month) || {}).recon || {};
    const missing = [...frcData(month).keys()].filter(k => !recon[k] || recon[k].litres === '' || recon[k].litres == null);
    items.push({ title: 'Сверка с 1С внесена по всем поставщикам', bad: missing.length, soft: true,
      detail: missing.length ? 'нет цифр 1С: ' + missing.join(', ') : '', tab: 'recon' });
  }

  // 6. Лимиты карт
  const overs = fcList().filter(c => c.limit).map(c => ({ c, u: fpLive().filter(p => inM(p) && fcNorm(p.cardNo) === c.number).reduce((s, p) => s + p.qty, 0) }))
    .filter(x => x.u > x.c.limit);
  items.push({ title: 'Лимиты карт не превышены', bad: overs.length,
    detail: overs.length ? overs.map(x => fcFormat(x.c.number) + ': ' + fpNum(x.u, 0) + ' из ' + fpNum(x.c.limit, 0) + ' л').join(', ') : '', tab: 'cards' });

  // 7. Госномера уникальны
  const plates = new Map();
  (data.vehicles || []).forEach(v => { const k = plateKey(v.plate); if (!plates.has(k)) plates.set(k, []); plates.get(k).push(v); });
  const dup = [...plates.entries()].filter(([k, l]) => l.length > 1);
  items.push({ title: 'Госномера машин не повторяются', bad: dup.length, soft: true,
    detail: dup.length ? dup.map(([k, l]) => '«' + k + '» — ' + l.length + ' машины (' + l.map(v => v.make).join(', ') + ')').join('; ') : '' });

  return items;
}

function fcCloseHtml() {
  const months = [...new Set([...fpCmpMonths(), ...fpMonthsList()])].sort().reverse();
  if (!fcCloseMonth || !months.includes(fcCloseMonth)) fcCloseMonth = months.find(m => !fuelMonthClosed(m)) || months[0] || '';
  if (!fcCloseMonth) return '<div class="welcome" style="padding:60px 0"><p>Нет данных</p></div>';
  const per = fuelPeriod(fcCloseMonth);
  const closed = fuelMonthClosed(fcCloseMonth);
  const items = fcChecklist(fcCloseMonth);
  const problems = items.filter(i => i.bad);

  const list = items.map(i => `
    <div style="display:flex;gap:12px;align-items:flex-start;padding:10px 14px;border-bottom:1px solid var(--border)">
      <div style="font-size:18px;line-height:1.2;color:${i.bad ? (i.soft ? '#d97706' : 'var(--red)') : 'var(--green)'}">${i.bad ? '⚠' : '✓'}</div>
      <div style="flex:1">
        <div style="font-weight:600">${fpEsc(i.title)}${i.bad ? ` <span style="color:var(--text3);font-weight:400">— ${i.bad}</span>` : ''}</div>
        ${i.detail ? `<div style="font-size:12px;color:var(--text3);margin-top:2px">${fpEsc(i.detail)}</div>` : ''}
      </div>
      ${i.bad && i.tab ? `<button class="btn btn-ghost btn-sm" onclick="fpView='${i.tab}';fpMonth='${fcCloseMonth}';frcMonth='${fcCloseMonth}';renderFuelPurchases()">Открыть</button>` : ''}
    </div>`).join('');

  const hist = (per && per.history || []).slice().reverse().map(h =>
    `<div style="font-size:12px;color:var(--text3)">${new Date(h.at).toLocaleString('ru')} — ${h.action === 'close' ? 'закрыт' : 'открыт'}${h.note ? ': ' + fpEsc(h.note) : ''}</div>`).join('');

  return `
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px">
      <select class="fsel" onchange="fcCloseMonth=this.value;renderFuelPurchases()">
        ${months.map(m => `<option value="${m}"${m === fcCloseMonth ? ' selected' : ''}>${fpMonthLabel(m)}${fuelMonthClosed(m) ? ' — закрыт' : ''}</option>`).join('')}
      </select>
      <span style="font-weight:700;color:${closed ? 'var(--green)' : 'var(--text2)'}">${closed ? '🔒 Месяц закрыт' : 'Месяц открыт'}</span>
      <span style="margin-left:auto"></span>
      ${closed
        ? `<button class="btn btn-ghost" onclick="fcReopen('${fcCloseMonth}')">Открыть месяц</button>`
        : `<button class="btn btn-primary" onclick="fcClose('${fcCloseMonth}')">Закрыть месяц</button>`}
    </div>
    <div class="table-wrap" style="margin-bottom:14px">
      <div class="table-toolbar"><div class="table-toolbar-left">Проверка перед закрытием · ${fpMonthLabel(fcCloseMonth)}</div>
        <div style="font-size:13px;color:${problems.length ? '#d97706' : 'var(--green)'}">${problems.length ? 'замечаний: ' + problems.length : 'всё в порядке'}</div></div>
      ${list}
    </div>
    ${hist ? `<div style="margin-bottom:10px"><div style="font-weight:600;margin-bottom:4px">История</div>${hist}</div>` : ''}
    <div style="font-size:12px;color:var(--text3)">
      В закрытом месяце нельзя менять журнал пробега и заправки, а загрузка выписок пропускает его строки.
      Закрыть можно и с замечаниями — программа покажет их ещё раз. Месяц можно открыть обратно, это попадёт в историю.
    </div>`;
}

async function fcClose(month) {
  const problems = fcChecklist(month).filter(i => i.bad);
  if (problems.length && !confirm('Есть замечания:\n— ' + problems.map(i => i.title + ' (' + i.bad + ')').join('\n— ') +
      '\n\nВсё равно закрыть ' + fpMonthLabel(month).toLowerCase() + '?')) return;
  if (!problems.length && !confirm('Закрыть ' + fpMonthLabel(month).toLowerCase() + '? Журнал и заправки за месяц станут недоступны для правки.')) return;
  let p = fuelPeriod(month);
  if (!p) { p = { month, history: [] }; fuelPeriods().push(p); }
  p.closed = true;
  p.closedAt = new Date().toISOString();
  (p.history || (p.history = [])).push({ action: 'close', at: p.closedAt, note: problems.length ? 'с замечаниями: ' + problems.length : '' });
  await saveData(data);
  renderFuelPurchases();
}

function fcReopen(month) {
  openGenericModal('Открыть ' + fpMonthLabel(month).toLowerCase(), `
    <div class="form-group"><label>Причина (попадёт в историю месяца)</label>
      <input type="text" id="fcReopenNote" placeholder="например: пришла выписка за конец месяца"></div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">
      <button class="btn btn-ghost" onclick="closeModal('genericModal')">Отмена</button>
      <button class="btn btn-primary" onclick="fcReopenSave('${month}')">Открыть месяц</button>
    </div>`, 480);
}

async function fcReopenSave(month) {
  const p = fuelPeriod(month);
  if (!p) return;
  p.closed = false;
  (p.history || (p.history = [])).push({ action: 'open', at: new Date().toISOString(),
    note: (document.getElementById('fcReopenNote')?.value || '').trim() });
  closeModal('genericModal');
  await saveData(data);
  renderFuelPurchases();
}
