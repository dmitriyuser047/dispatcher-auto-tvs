// Заправки по выпискам топливных карт.
//
// Каждая строка выписки хранится отдельной покупкой в data.fuelPurchases:
// дата и время, карта, АЗС, товар, литры, цена, сумма, машина. Журнал пробега
// собирается из покупок: покупка прибавляет литры и сумму к записи машины
// за этот день и этот вид топлива. Правка покупки сначала снимает её старые
// литры и сумму с записи, потом прибавляет новые — так в журнале остаётся всё,
// что внесено вручную, а меняется только доля выписки.
//
// Главной считается выписка. Если литры записи журнала разошлись с суммой
// её покупок (запись поправили руками), раздел подсвечивает расхождение.
//
// Удалённая покупка не стирается, а помечается deleted: иначе повторная
// загрузка той же выписки вернула бы её обратно.

let fpView    = 'cards';   // 'cards' | 'vehicle' | 'unmatched' | 'history'
let fpMonth   = '';        // 'ГГГГ-ММ' или 'all'
let fpVehicle = null;
let fpSearch  = '';
let fpOrg     = '';

const FP_GRADES = ['ДТ', 'АИ-92', 'АИ-95', 'АИ-98', 'АИ-100', 'Газ'];
const FP_MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

function fpEsc(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fpRound(v) { return Math.round((+v || 0) * 100) / 100; }
function fpNum(v, dec) {
  return (+v || 0).toLocaleString('ru', { minimumFractionDigits: dec ?? 2, maximumFractionDigits: dec ?? 2 });
}
function fpList() { return data.fuelPurchases || (data.fuelPurchases = []); }
function fpLive() { return fpList().filter(p => !p.deleted); }
function fpById(id) { return fpList().find(p => p.id === id); }
function fpByKey(key) { return key ? fpList().find(p => p.importKey === key) : null; }
// АЗС и комментарий без повторов: в офисной выписке номер АЗС уже вписан
// в комментарий, а пустой поставщик приходит строкой «null»
function fpPlace(p) {
  const seen = new Set(), out = [];
  [p.azs, ...String(p.comment || '').split(/;\s*/)].forEach(part => {
    part = String(part || '').trim();
    const k = part.toLowerCase().replace(/азс/g, '').replace(/[\s,.]+/g, '');
    if (!part || k === 'null' || seen.has(k)) return;
    seen.add(k); out.push(part);
  });
  return out.join('; ');
}
function fpVehicleTitle(v) { return v ? ([v.plate, v.make].filter(Boolean).join(' — ') || v.id) : '—'; }

// ─── Связь покупки с журналом ─────────────────────────────

function fpRecordFor(vehicleId, date, grade, create) {
  const v = (data.vehicles || []).find(x => x.id === vehicleId);
  let rec = (data.records || []).find(r => r.vehicleId === vehicleId && r.date === date && recordFuelGrade(r, v) === grade);
  if (!rec && create) {
    rec = { id: 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            vehicleId, date, km: 0, fuelIssued: 0, fuelGrade: grade, note: '' };
    (data.records || (data.records = [])).push(rec);
  }
  return rec;
}

// Запись пустая, если в ней не осталось ничего, кроме снятой заправки
function fpRecordIsEmpty(rec) {
  return !(+rec.fuelIssued) && !(+rec.km) && !(+rec.fuelActual) && !(+rec.fuelUsed) && !(+rec.fuelIdle) &&
    !(+rec.odoStart) && !(+rec.odoEnd) && !(+rec.kmGlonass) && !(Array.isArray(rec.route) ? rec.route.length : rec.route) &&
    !fpLive().some(p => p.recordId === rec.id);
}

// sign = +1 — добавить покупку в журнал, −1 — снять
function fpApply(p, sign) {
  if (!p || !p.vehicleId || p.deleted) { if (sign < 0 && p) p.recordId = null; return null; }
  if (sign > 0) {
    let rec = p.recordId && (data.records || []).find(r => r.id === p.recordId);
    const v = (data.vehicles || []).find(x => x.id === p.vehicleId);
    if (!rec || rec.vehicleId !== p.vehicleId || rec.date !== p.date || recordFuelGrade(rec, v) !== p.grade) {
      rec = fpRecordFor(p.vehicleId, p.date, p.grade, true);
    }
    const before = +rec.fuelIssued || 0;
    rec.fuelIssued = fpRound(before + (+p.qty || 0)) || null;
    if (+p.sum) rec.fuelSum = fpRound((+rec.fuelSum || 0) + (+p.sum)) || null;
    if (!rec.fuelGrade) rec.fuelGrade = p.grade;
    if (p.importKey && typeof fuelImportAppendNote === 'function') {
      fuelImportAppendNote(rec, 'заправка: ' + (p.product || p.grade) + ' ' + fpRound(p.qty) + 'л; импорт заправок: ' + p.importKey);
    }
    p.recordId = rec.id;
    return { record: rec, before, after: rec.fuelIssued };
  }
  const rec = p.recordId && (data.records || []).find(r => r.id === p.recordId);
  p.recordId = null;
  if (!rec) return null;
  const before = +rec.fuelIssued || 0;
  const left = fpRound(before - (+p.qty || 0));
  rec.fuelIssued = left > 0 ? left : null;
  if (+p.sum && rec.fuelSum) {
    const s = fpRound(rec.fuelSum - p.sum);
    rec.fuelSum = s > 0 ? s : null;
  }
  if (fpRecordIsEmpty(rec)) data.records = data.records.filter(r => r !== rec);
  return { record: rec, before, after: rec.fuelIssued };
}

// Правка покупки: снять старое, применить изменения, добавить новое
function fpUpdate(p, changes) {
  fpApply(p, -1);
  Object.assign(p, changes, { editedAt: new Date().toISOString() });
  if (p.qty && p.sum) p.price = fpRound(p.sum / p.qty);
  return fpApply(p, +1);
}

function fpCreate(tx, opts) {
  const p = {
    id: 'fp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    importId: opts.importId || null,
    importKey: tx.importKey || null,
    date: opts.date || tx.date,
    time: tx.time || '',
    vehicleId: opts.vehicleId || null,
    recordId: opts.recordId || null,
    grade: opts.grade || parseFuelGrade(tx.fuel) || '',
    product: tx.fuel || '',
    qty: fpRound(tx.qty),
    price: tx.price ? fpRound(tx.price) : (tx.sum && tx.qty ? fpRound(tx.sum / tx.qty) : null),
    sum: tx.sum ? fpRound(tx.sum) : null,
    cardNo: tx.cardNo || '',
    vehicleText: tx.vehicleText || '',
    azs: tx.azs || '',
    comment: tx.comment || '',
    sourceRow: tx.sourceRow || null,
  };
  fpList().push(p);
  return p;
}

// Покупка уже есть — при повторной загрузке уточняем то, чего не хватало:
// у восстановленных из примечаний нет цены, времени и АЗС.
function fpRefreshFromTx(p, tx) {
  if (tx.time && !p.time) p.time = tx.time;
  if (tx.azs && !p.azs) p.azs = tx.azs;
  if (tx.fuel && !p.product) p.product = tx.fuel;
  if (tx.sum && (p.restored || !p.sum) && Math.abs((+p.sum || 0) - tx.sum) >= 0.01) {
    const delta = fpRound(tx.sum - (+p.sum || 0));
    p.sum = fpRound(tx.sum);
    p.price = tx.price ? fpRound(tx.price) : fpRound(tx.sum / (p.qty || tx.qty || 1));
    const rec = p.recordId && !p.deleted && (data.records || []).find(r => r.id === p.recordId);
    if (rec) rec.fuelSum = fpRound((+rec.fuelSum || 0) + delta) || null;
  }
  if (tx.price && !p.price) p.price = fpRound(tx.price);
  p.restored = false;
}

// ─── Восстановление покупок из примечаний журнала ─────────
// Заправки, загруженные до появления раздела, известны только по примечанию
// записи: «импорт заправок: дата|литры|карта|номер|комментарий». Из него
// восстанавливаем покупки, сумма делится по литрам. Точные цены подтянутся
// при повторной загрузке выписки.

// Примечание устроено так: «заправка: Аи-92 40л, Аи-92 40л; импорт заправок: ключ | ключ».
// Две одинаковые покупки за день по одной карте дают одинаковый ключ, поэтому
// ключи считаются с повторами. Товар берётся из списка «заправка:» по порядку.
function fpKeysFromNote(note) {
  note = String(note || '');
  const segments = [];
  const markRe = /(?:заправка: ([^;]*); )?импорт заправок: /g;
  const marks = [];
  let mm;
  while ((mm = markRe.exec(note))) marks.push({ at: markRe.lastIndex, fuels: mm[1] || '' });
  marks.forEach((mk, mi) => {
    const tail = note.slice(mk.at, mi + 1 < marks.length ? marks[mi + 1].at : note.length);
    const re = /(\d{4}-\d{2}-\d{2})\|(\d+(?:\.\d+)?)\|(\d*)\|([^|;]*)\|/g;
    const hits = [];
    let m;
    while ((m = re.exec(tail))) hits.push({ start: m.index, end: re.lastIndex, head: m[0], date: m[1], qty: +m[2], card: m[3] });
    const products = mk.fuels.split(/,\s*/).map(x => x.replace(/\s*[\d.]+\s*л\s*$/i, '').trim());
    segments.push(hits.map((h, i) => {
      let comment = tail.slice(h.end, i + 1 < hits.length ? hits[i + 1].start : tail.length);
      const cut = comment.search(/ \| $|; (заправка: |импорт заправок: |тс выбрано|тс изменено|перенос заправки)/i);
      if (cut >= 0) comment = comment.slice(0, cut);
      return { key: h.head + comment, date: h.date, qty: h.qty, card: h.card, comment,
               product: products.length === hits.length ? products[i] : '' };
    }));
  });
  return segments;
}

function fpRestoreFromJournal() {
  const known = new Map();   // ключ → сколько покупок уже есть
  fpList().forEach(p => { if (p.importKey) known.set(p.importKey, (known.get(p.importKey) || 0) + 1); });
  const owner = new Map();   // ключ → { rec, list } — где заправка числится сейчас
  (data.records || []).forEach(rec => {
    if (!/импорт заправок/.test(rec.note || '')) return;
    // Одинаковые блоки в примечании повторяются — берём наибольшее число повторов ключа
    const best = new Map();
    fpKeysFromNote(rec.note).forEach(seg => {
      const cnt = new Map();
      seg.forEach(k => { if (!cnt.has(k.key)) cnt.set(k.key, []); cnt.get(k.key).push(k); });
      cnt.forEach((list, key) => { if (!best.has(key) || best.get(key).length < list.length) best.set(key, list); });
    });
    best.forEach((list, key) => {
      const prev = owner.get(key);
      // Перенесённая в отчёте импорта заправка остаётся ключом и в старой записи
      if (!prev || /перенос заправки/.test(prev.rec.note || '')) owner.set(key, { rec, list });
    });
  });
  const byRec = new Map();
  owner.forEach(({ rec, list }, key) => {
    const todo = list.slice(known.get(key) || 0);
    if (!todo.length) return;
    if (!byRec.has(rec)) byRec.set(rec, []);
    byRec.get(rec).push(...todo);
  });
  let created = 0;
  byRec.forEach((keys, rec) => {
    const v = (data.vehicles || []).find(x => x.id === rec.vehicleId);
    const totalQty = keys.reduce((s, k) => s + k.qty, 0);
    keys.forEach(k => {
      const sum = +rec.fuelSum && totalQty ? fpRound(rec.fuelSum * k.qty / totalQty) : null;
      const p = fpCreate({ importKey: k.key, date: k.date, qty: k.qty, sum, cardNo: k.card, comment: k.comment, fuel: k.product },
        { vehicleId: rec.vehicleId, recordId: rec.id, grade: parseFuelGrade(k.product) || recordFuelGrade(rec, v), date: k.date });
      p.restored = true;
      created++;
    });
  });
  return created;
}

// ─── Расхождения с журналом ───────────────────────────────

function fpStats() {
  const byRecord = new Map();
  fpLive().forEach(p => {
    if (!p.recordId) return;
    byRecord.set(p.recordId, fpRound((byRecord.get(p.recordId) || 0) + (+p.qty || 0)));
  });
  return byRecord;
}

// Состояние покупки относительно журнала: ok | missing | diff
function fpJournalState(p, byRecord) {
  if (!p.vehicleId) return { state: 'none' };
  const rec = p.recordId && (data.records || []).find(r => r.id === p.recordId);
  if (!rec) return { state: 'missing' };
  const j = +rec.fuelIssued || 0, s = byRecord.get(rec.id) || 0;
  return Math.abs(j - s) > 0.05 ? { state: 'diff', journal: j, statement: s, rec } : { state: 'ok', rec };
}

// ─── Раздел ───────────────────────────────────────────────

function fpMonthsList() {
  const s = new Set(fpLive().map(p => (p.date || '').slice(0, 7)).filter(Boolean));
  return [...s].sort().reverse();
}
function fpMonthLabel(m) {
  if (m === 'all') return 'Все месяцы';
  const [y, mo] = m.split('-');
  return FP_MONTHS[+mo - 1] + ' ' + y;
}
function fpInMonth(p) { return fpMonth === 'all' || (p.date || '').startsWith(fpMonth); }

async function renderFuelPurchases() {
  if (fpRestoreFromJournal()) await saveData(data);
  const months = fpMonthsList();
  if (!fpMonth || (fpMonth !== 'all' && !months.includes(fpMonth))) fpMonth = months[0] || 'all';
  if (fpView === 'vehicle' && fpVehicle) return fpRenderVehicle();
  const main = document.getElementById('mainContent');

  const unmatched = fpLive().filter(p => !p.vehicleId);
  const tabs = [['cards', 'По машинам'], ['unmatched', 'Без машины' + (unmatched.length ? ' (' + unmatched.length + ')' : '')],
                ['history', 'История загрузок']]
    .map(([id, label]) => `<button class="sec-tab ${fpView === id ? 'active' : ''}" onclick="fpView='${id}';renderFuelPurchases()">${label}</button>`).join('');
  const monthSel = `<select class="fsel" onchange="fpMonth=this.value;renderFuelPurchases()">
      ${months.concat(['all']).map(m => `<option value="${m}"${m === fpMonth ? ' selected' : ''}>${fpMonthLabel(m)}</option>`).join('')}
    </select>`;
  const loadBtns = `
    <button class="btn btn-ghost" onclick="document.getElementById('fuelImportInput').click()">Загрузить выписку</button>
    <button class="btn btn-ghost" onclick="document.getElementById('officeFuelImportInput').click()">Машины офис</button>`;

  let body = '';
  if (fpView === 'unmatched') body = fpUnmatchedHtml(unmatched);
  else if (fpView === 'history') body = fpHistoryHtml();
  else body = fpCardsHtml();

  main.innerHTML = `
    <div style="padding:24px 28px;width:100%;box-sizing:border-box;overflow-y:auto;height:100%">
      <div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap">${tabs}</div>
      <div class="vehicle-cards-toolbar">
        ${fpView === 'cards' ? `<input type="text" placeholder="Поиск по номеру, марке, карте..." value="${fpEsc(fpSearch)}"
          oninput="fpSearch=this.value;fpRefreshCards()">
        <select class="fsel" onchange="fpOrg=this.value;fpRefreshCards()">
          <option value="">Все организации</option>
          ${[...new Set((data.vehicles || []).map(v => v.org).filter(Boolean))].sort()
            .map(o => `<option${o === fpOrg ? ' selected' : ''}>${fpEsc(o)}</option>`).join('')}
        </select>` : ''}
        ${fpView !== 'history' ? monthSel : ''}
        ${loadBtns}
      </div>
      <div id="fpBody">${body}</div>
    </div>`;
}

function fpRefreshCards() {
  const el = document.getElementById('fpBody');
  if (el) el.innerHTML = fpCardsHtml();
}

function fpCardsHtml() {
  const byRecord = fpStats();
  const q = fpSearch.toLowerCase().trim();
  const groups = new Map();
  fpLive().filter(p => p.vehicleId && fpInMonth(p)).forEach(p => {
    if (!groups.has(p.vehicleId)) groups.set(p.vehicleId, []);
    groups.get(p.vehicleId).push(p);
  });
  const cards = [...groups.entries()].map(([vid, list]) => {
    const v = (data.vehicles || []).find(x => x.id === vid);
    if (!v) return null;
    if (fpOrg && (v.org || '') !== fpOrg) return null;
    if (q) {
      const hay = [v.plate, v.make, v.org, v.object, v.fuelcard, ...list.map(p => p.cardNo)].join(' ').toLowerCase();
      if (!q.split(/\s+/).every(w => hay.includes(w))) return null;
    }
    const litres = list.reduce((s, p) => s + (+p.qty || 0), 0);
    const sum = list.reduce((s, p) => s + (+p.sum || 0), 0);
    const grades = [...new Set(list.map(p => p.grade).filter(Boolean))];
    const problems = new Set(list.filter(p => fpJournalState(p, byRecord).state !== 'ok').map(p => p.date)).size;
    return { v, html: `
      <div class="vehicle-card" onclick="fpOpenVehicle('${vid}')">
        <div class="vc-accent-bar" style="background:${problems ? '#d97706' : '#16a34a'}"></div>
        <div class="vc-plate">${fpEsc(v.plate)}</div>
        <div class="vc-make">${fpEsc(v.make || '—')}</div>
        <div class="vc-driver">${fpEsc(v.org || '')}</div>
        <div style="font-size:18px;font-weight:800;margin:6px 0 2px">${fpNum(litres, 1)} л</div>
        <div style="font-size:12px;color:var(--text3)">${sum ? fpNum(sum) + ' ₽ · ' : ''}${list.length} заправ.</div>
        <div class="vc-meta">
          ${grades.map(g => `<span class="fuel-tag ${fuelTypeFromGrade(g)}" style="font-size:10px;padding:1px 6px">${g}</span>`).join('')}
          ${problems ? `<span style="color:#d97706;font-weight:600">⚠ расхождение: ${problems} дн.</span>` : ''}
        </div>
      </div>` };
  }).filter(Boolean).sort((a, b) => (a.v.plate || '').localeCompare(b.v.plate || '', 'ru'));

  if (!cards.length) {
    return `<div class="welcome" style="padding:60px 0"><p>${fpList().length
      ? 'За ' + fpMonthLabel(fpMonth).toLowerCase() + ' заправок по выпискам нет'
      : 'Заправок по выпискам пока нет. Загрузите выписку топливных карт.'}</p></div>`;
  }
  return `<div class="vehicle-cards-grid">${cards.map(c => c.html).join('')}</div>
    <div style="text-align:center;margin-top:16px;font-size:13px;color:var(--text3)">${cards.length} машин · ${fpMonthLabel(fpMonth)}</div>`;
}

function fpOpenVehicle(vid) {
  fpVehicle = vid;
  fpView = 'vehicle';
  renderFuelPurchases();
}

function fpRenderVehicle() {
  const v = (data.vehicles || []).find(x => x.id === fpVehicle);
  if (!v) { fpView = 'cards'; return renderFuelPurchases(); }
  const byRecord = fpStats();
  const list = fpLive().filter(p => p.vehicleId === v.id && fpInMonth(p))
    .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  const months = [...new Set(fpLive().filter(p => p.vehicleId === v.id).map(p => (p.date || '').slice(0, 7)))].sort().reverse();

  const litres = list.reduce((s, p) => s + (+p.qty || 0), 0);
  const sum = list.reduce((s, p) => s + (+p.sum || 0), 0);
  const sumL = list.filter(p => +p.sum).reduce((s, p) => s + (+p.qty || 0), 0);
  const recs = recsFor(v.id).filter(r => fpMonth === 'all' || (r.date || '').startsWith(fpMonth));
  const journal = recs.reduce((s, r) => s + (+r.fuelIssued || 0), 0);
  // Заправки журнала, которых нет в выписках (внесены вручную или по другой карте)
  const onlyJournal = recs.map(r => ({ r, extra: fpRound((+r.fuelIssued || 0) - (byRecord.get(r.id) || 0)) }))
    .filter(x => Math.abs(x.extra) > 0.05 && !(byRecord.get(x.r.id)));

  const stateHtml = p => {
    const st = fpJournalState(p, byRecord);
    if (st.state === 'ok') return '<span style="color:var(--green)" title="В журнале совпадает">✓</span>';
    if (st.state === 'missing') return `<span style="color:var(--red)">нет в журнале</span>
      <button class="btn btn-ghost btn-sm" style="padding:2px 8px;font-size:11px" onclick="fpReturnToJournal('${p.id}')">Вернуть</button>`;
    return `<span style="color:#d97706" title="Запись журнала поправлена вручную">журнал ${fpNum(st.journal, 2)} л,<br>по выпискам ${fpNum(st.statement, 2)} л</span>
      <button class="btn btn-ghost btn-sm" style="padding:2px 8px;font-size:11px" onclick="fpSyncRecord('${st.rec.id}')" title="Поставить в журнал литры и сумму по выпискам">Как в выписке</button>`;
  };

  const rows = list.map(p => `
    <tr>
      <td>${fmtDate(p.date)}</td>
      <td>${fpEsc(p.time || '')}</td>
      <td><span class="fuel-tag ${fuelTypeFromGrade(p.grade)}" style="font-size:10px;padding:1px 6px">${fpEsc(p.grade || '—')}</span></td>
      <td style="max-width:150px;white-space:normal">${fpEsc(p.product || '—')}</td>
      <td style="text-align:right;font-weight:700">${fpNum(p.qty)}</td>
      <td style="text-align:right">${p.price ? fpNum(p.price) : '—'}</td>
      <td style="text-align:right">${p.sum ? fpNum(p.sum) : '—'}${p.restored ? '<div style="font-size:10px;color:var(--text3)" title="Восстановлено из журнала, точная сумма подтянется при повторной загрузке выписки">≈ по журналу</div>' : ''}</td>
      <td>${fpEsc(p.cardNo || '—')}</td>
      <td style="max-width:280px;white-space:normal;font-size:12px">${fpEsc(fpPlace(p) || '—')}</td>
      <td style="font-size:12px">${stateHtml(p)}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-ghost btn-sm" style="padding:3px 8px" onclick="fpEdit('${p.id}')">Изменить</button>
        <button class="btn btn-ghost btn-sm" style="padding:3px 8px;color:var(--red)" onclick="fpDelete('${p.id}')" title="Удалить заправку и снять её с журнала">✕</button>
      </td>
    </tr>`).join('');

  const onlyJournalHtml = onlyJournal.length ? `
    <div class="table-wrap" style="margin-top:14px">
      <div class="table-toolbar"><div class="table-toolbar-left">В журнале, но нет в выписках</div></div>
      <table class="data-table" style="width:100%">
        <thead><tr><th>Дата</th><th>Топливо</th><th style="text-align:right">Выдано по журналу, л</th><th style="text-align:right">Сумма, ₽</th><th>Примечание</th></tr></thead>
        <tbody>${onlyJournal.map(({ r }) => `<tr>
          <td>${fmtDate(r.date)}</td><td>${fpEsc(recordFuelGrade(r, v))}</td>
          <td style="text-align:right">${fpNum(r.fuelIssued)}</td>
          <td style="text-align:right">${r.fuelSum ? fpNum(r.fuelSum) : '—'}</td>
          <td style="font-size:12px;color:var(--text3)">${fpEsc((r.note || '').slice(0, 120))}</td></tr>`).join('')}</tbody>
      </table>
      <div style="font-size:12px;color:var(--text3);padding:8px 12px">Внесено вручную или по карте, выписка по которой не загружалась.</div>
    </div>` : '';

  const card = (t, val, sub, color) => `<div style="flex:1;min-width:150px;background:var(--bg2);border:1px solid var(--border);border-left:4px solid ${color};border-radius:8px;padding:10px 14px">
      <div style="font-size:12px;color:var(--text3)">${t}</div><div style="font-size:19px;font-weight:800">${val}</div>
      ${sub ? `<div style="font-size:12px;color:var(--text3)">${sub}</div>` : ''}</div>`;
  const diff = fpRound(journal - litres);

  document.getElementById('mainContent').innerHTML = `
    <div style="padding:24px 28px;width:100%;box-sizing:border-box;overflow-y:auto;height:100%">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" onclick="fpView='cards';fpVehicle=null;renderFuelPurchases()">← К машинам</button>
        <div style="font-size:20px;font-weight:800">${fpEsc(v.plate)}</div>
        <div style="color:var(--text3)">${fpEsc(v.make || '')}${v.org ? ' · ' + fpEsc(v.org) : ''}</div>
        <select class="fsel" style="margin-left:auto" onchange="fpMonth=this.value;fpRenderVehicle()">
          ${months.concat(['all']).map(m => `<option value="${m}"${m === fpMonth ? ' selected' : ''}>${fpMonthLabel(m)}</option>`).join('')}
        </select>
        <button class="btn btn-ghost btn-sm" onclick="selectVehicleFromFp('${v.id}')">Журнал пробега</button>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        ${card('По выпискам', fpNum(litres, 1) + ' л', list.length + ' заправ.', '#2563eb')}
        ${card('Сумма', sum ? fpNum(sum) + ' ₽' : '—', sumL ? 'ср. цена ' + fpNum(sum / sumL) + ' ₽/л' : '', '#16a34a')}
        ${card('В журнале пробега', fpNum(journal, 1) + ' л', Math.abs(diff) > 0.05 ? (diff > 0 ? '+' : '') + fpNum(diff, 1) + ' л к выпискам' : 'совпадает с выписками', Math.abs(diff) > 0.05 ? '#d97706' : '#94a3b8')}
      </div>
      <div class="table-wrap"><div class="table-scroll" style="overflow-x:auto">
        <table class="data-table" style="width:100%">
          <thead><tr><th>Дата</th><th>Время</th><th>Топливо</th><th>Товар</th><th style="text-align:right">Литры</th>
            <th style="text-align:right">Цена, ₽/л</th><th style="text-align:right">Сумма, ₽</th><th>Карта</th><th>АЗС / комментарий</th><th>Журнал</th><th></th></tr></thead>
          <tbody>${rows || `<tr><td colspan="11" style="text-align:center;color:var(--text3);padding:16px">Нет заправок за ${fpMonthLabel(fpMonth).toLowerCase()}</td></tr>`}</tbody>
        </table>
      </div></div>
      ${onlyJournalHtml}
    </div>`;
}

function selectVehicleFromFp(vid) {
  switchSection('vehicles');
  selectVehicle(vid);
  if (fpMonth && fpMonth !== 'all') {
    const [y, m] = fpMonth.split('-');
    selectedYear = +y; selectedMonth = +m;
    if (typeof vehicleDetailView !== 'undefined') vehicleDetailView = 'journal';
    const v = data.vehicles.find(x => x.id === vid);
    if (v) renderDetail(v);
  }
}

function fpUnmatchedHtml(list) {
  list = list.filter(fpInMonth).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  if (!list.length) return `<div style="background:#dcfce7;color:#166534;border:1px solid #bbf7d0;border-radius:8px;padding:12px 14px">
    Все заправки${fpMonth === 'all' ? '' : ' за ' + fpMonthLabel(fpMonth).toLowerCase()} привязаны к машинам.</div>`;
  return `<div class="table-wrap"><div class="table-scroll" style="overflow-x:auto">
    <table class="data-table" style="width:100%">
      <thead><tr><th>Дата</th><th>Товар</th><th style="text-align:right">Литры</th><th style="text-align:right">Сумма, ₽</th>
        <th>Карта</th><th>ТС в выписке</th><th>АЗС / комментарий</th><th>Привязать к машине</th><th></th></tr></thead>
      <tbody>${list.map(p => `<tr>
        <td>${fmtDate(p.date)} ${fpEsc(p.time || '')}</td>
        <td>${fpEsc(p.product || p.grade || '—')}</td>
        <td style="text-align:right;font-weight:700">${fpNum(p.qty)}</td>
        <td style="text-align:right">${p.sum ? fpNum(p.sum) : '—'}</td>
        <td>${fpEsc(p.cardNo || '—')}</td>
        <td>${fpEsc(p.vehicleText || '—')}</td>
        <td style="max-width:260px;white-space:normal;font-size:12px">${fpEsc(fpPlace(p) || '—')}</td>
        <td style="white-space:nowrap">
          <select id="fpAssign_${p.id}" class="fsel" style="max-width:210px">${fuelImportVehicleOptions('', true)}</select>
          <button class="btn btn-primary btn-sm" onclick="fpAssign('${p.id}')">Привязать</button>
        </td>
        <td><button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="fpDelete('${p.id}')">✕</button></td>
      </tr>`).join('')}</tbody>
    </table></div></div>`;
}

function fpHistoryHtml() {
  const list = (data.fuelImports || []).slice().sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  if (!list.length) return '<div class="welcome" style="padding:60px 0"><p>Загрузок пока не было</p></div>';
  return `<div class="table-wrap"><table class="data-table" style="width:100%">
    <thead><tr><th>Когда</th><th>Файл</th><th style="text-align:right">Строк</th><th style="text-align:right">Литры</th>
      <th style="text-align:right">Сумма, ₽</th><th style="text-align:right">Новых</th><th style="text-align:right">Уже было</th><th style="text-align:right">Без машины</th></tr></thead>
    <tbody>${list.map(i => `<tr>
      <td>${fpEsc(new Date(i.at).toLocaleString('ru'))}</td>
      <td>${fpEsc(i.fileName)}</td>
      <td style="text-align:right">${i.rows}</td>
      <td style="text-align:right">${fpNum(i.litres, 1)}</td>
      <td style="text-align:right">${i.sum ? fpNum(i.sum) : '—'}</td>
      <td style="text-align:right">${i.added}</td>
      <td style="text-align:right">${i.duplicates}</td>
      <td style="text-align:right;${i.skipped ? 'color:var(--red)' : ''}">${i.skipped}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

// ─── Действия ─────────────────────────────────────────────

async function fpSaveAndRender() {
  await saveData(data);
  renderFuelPurchases();
}

function fpEdit(id) {
  const p = fpById(id);
  if (!p) return;
  const grades = FP_GRADES.includes(p.grade) ? FP_GRADES : FP_GRADES.concat([p.grade]);
  openGenericModal('Заправка ' + fmtDate(p.date), `
    <div class="form-row">
      <div class="form-group"><label>Дата</label><input type="text" id="fpe_date" value="${fmtDate(p.date)}" placeholder="ДД.ММ.ГГГГ"></div>
      <div class="form-group"><label>Время</label><input type="text" id="fpe_time" value="${fpEsc(p.time || '')}" placeholder="ЧЧ:ММ"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Вид топлива</label><select id="fpe_grade">${grades.filter(Boolean)
        .map(g => `<option${g === p.grade ? ' selected' : ''}>${g}</option>`).join('')}</select></div>
      <div class="form-group"><label>Машина</label><select id="fpe_vehicle">${fuelImportVehicleOptions(p.vehicleId, true)}</select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Литры</label><input type="number" id="fpe_qty" step="0.01" value="${p.qty ?? ''}" oninput="fpEditRecalc('qty')"></div>
      <div class="form-group"><label>Цена, ₽/л</label><input type="number" id="fpe_price" step="0.01" value="${p.price ?? ''}" oninput="fpEditRecalc('price')"></div>
      <div class="form-group"><label>Сумма, ₽</label><input type="number" id="fpe_sum" step="0.01" value="${p.sum ?? ''}"></div>
    </div>
    <div class="form-group"><label>Комментарий</label><input type="text" id="fpe_comment" value="${fpEsc(p.comment || '')}"></div>
    <div style="font-size:12px;color:var(--text3);margin:4px 0 12px">Изменения сразу переносятся в журнал пробега: старые литры и сумма снимаются с записи, новые добавляются в запись этого дня и вида топлива.</div>
    <div style="display:flex;justify-content:flex-end;gap:8px">
      <button class="btn btn-ghost" onclick="closeModal('genericModal')">Отмена</button>
      <button class="btn btn-primary" onclick="fpEditSave('${p.id}')">Сохранить</button>
    </div>`, 620);
}

// Литры или цена изменились — пересчитать сумму
function fpEditRecalc() {
  const q = parseFloat(document.getElementById('fpe_qty').value);
  const pr = parseFloat(document.getElementById('fpe_price').value);
  if (q && pr) document.getElementById('fpe_sum').value = fpRound(q * pr);
}

async function fpEditSave(id) {
  const p = fpById(id);
  if (!p) return;
  const date = parseDate(document.getElementById('fpe_date').value.trim());
  const qty = parseFloat(document.getElementById('fpe_qty').value);
  if (!date) { showFieldError('Укажите дату в формате ДД.ММ.ГГГГ', 'fpe_date'); return; }
  if (!(qty > 0)) { showFieldError('Укажите литры', 'fpe_qty'); return; }
  const sum = parseFloat(document.getElementById('fpe_sum').value) || null;
  fpUpdate(p, {
    date, qty: fpRound(qty), sum: sum ? fpRound(sum) : null,
    price: parseFloat(document.getElementById('fpe_price').value) || null,
    time: document.getElementById('fpe_time').value.trim(),
    grade: document.getElementById('fpe_grade').value,
    vehicleId: document.getElementById('fpe_vehicle').value || null,
    comment: document.getElementById('fpe_comment').value.trim(),
    restored: false,
  });
  closeModal('genericModal');
  if (fpView === 'vehicle' && p.vehicleId !== fpVehicle) showToast && showToast('Заправка перенесена на ' + fpVehicleTitle((data.vehicles || []).find(v => v.id === p.vehicleId)));
  fpSaveAndRender();
}

async function fpDelete(id) {
  const p = fpById(id);
  if (!p) return;
  if (!confirm('Удалить заправку ' + fmtDate(p.date) + ' на ' + fpNum(p.qty) + ' л?' + (p.vehicleId ? '\nЛитры и сумма будут сняты с журнала пробега.' : ''))) return;
  fpApply(p, -1);
  p.deleted = true;
  p.editedAt = new Date().toISOString();
  fpSaveAndRender();
}

async function fpAssign(id) {
  const p = fpById(id);
  const vid = document.getElementById('fpAssign_' + id)?.value;
  if (!p || !vid) { alert('Выберите машину'); return; }
  const v = (data.vehicles || []).find(x => x.id === vid);
  fpUpdate(p, { vehicleId: vid, grade: parseFuelGrade(p.product) || p.grade || vehicleFuelGrade(v) });
  fpSaveAndRender();
}

async function fpReturnToJournal(id) {
  const p = fpById(id);
  if (!p) return;
  fpApply(p, +1);
  fpSaveAndRender();
}

// Запись журнала поправили руками — вернуть литры и сумму как в выписках
async function fpSyncRecord(recordId) {
  const rec = (data.records || []).find(r => r.id === recordId);
  if (!rec) return;
  const list = fpLive().filter(p => p.recordId === recordId);
  const qty = fpRound(list.reduce((s, p) => s + (+p.qty || 0), 0));
  const sum = fpRound(list.reduce((s, p) => s + (+p.sum || 0), 0));
  if (!confirm(`Поставить в журнал за ${fmtDate(rec.date)}: ${fpNum(qty)} л вместо ${fpNum(rec.fuelIssued)} л?`)) return;
  rec.fuelIssued = qty || null;
  if (sum) rec.fuelSum = sum;
  fpSaveAndRender();
}
