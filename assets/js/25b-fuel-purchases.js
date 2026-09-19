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
  const doubles = fpDoubles();
  const tabs = [['cards', 'По машинам'], ['doubles', 'Сдвоенные заправки' + (doubles.length ? ' (' + doubles.length + ')' : '')],
                ['compare', 'Сравнение месяцев'],
                ['negative', 'Отрицательный остаток'],
                ['unmatched', 'Без машины' + (unmatched.length ? ' (' + unmatched.length + ')' : '')],
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
  else if (fpView === 'doubles') body = fpDoublesHtml(doubles);
  else if (fpView === 'compare') body = fpCompareHtml();
  else if (fpView === 'negative') body = fpNegativeHtml();
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
        ${!['history', 'compare', 'negative'].includes(fpView) ? monthSel : ''}
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

// ─── Сдвоенные заправки ───────────────────────────────────
// Дни, когда машина заправлялась два раза и больше. Офисные машины (объект
// «… (офис)») не входят: там несколько заправок в день — обычное дело.
// Отметки — поводы присмотреться, а не приговор.

const FP_DAY_LIMIT = 100;   // литров за день, после которых день отмечается

function fpIsOffice(v) { return /офис/i.test((v && v.object) || ''); }

// Бензин и дизель — разные «семьи»: АИ-92 и АИ-95 в одной машине допустимы,
// ДТ в бензиновой — нет
function fpFuelFamily(g) { return g === 'ДТ' ? 'diesel' : g === 'Газ' ? 'gas' : g ? 'gasoline' : ''; }

function fpDoubles() {
  const groups = new Map();
  fpLive().filter(p => p.vehicleId && fpInMonth(p)).forEach(p => {
    const k = p.vehicleId + '|' + p.date;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  });
  const out = [];
  groups.forEach(list => {
    if (list.length < 2) return;
    const v = (data.vehicles || []).find(x => x.id === list[0].vehicleId);
    if (!v || fpIsOffice(v)) return;
    list.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    const litres = fpRound(list.reduce((s, p) => s + (+p.qty || 0), 0));
    const sum = fpRound(list.reduce((s, p) => s + (+p.sum || 0), 0));
    const journal = fpRound(recsFor(v.id).filter(r => r.date === list[0].date).reduce((s, r) => s + (+r.fuelIssued || 0), 0));
    const own = fpFuelFamily(vehicleFuelGrade(v));
    const grades = [...new Set(list.map(p => p.grade).filter(Boolean))];
    const flags = [];
    if (litres > FP_DAY_LIMIT) flags.push('больше ' + FP_DAY_LIMIT + ' л за день');
    if (grades.some(g => own && fpFuelFamily(g) !== own)) flags.push('топливо не той марки, что у машины');
    else if (grades.length > 1) flags.push('разные марки в один день');
    if (/ремонт|дтп/i.test(v.status || '')) flags.push('статус «' + v.status + '»');
    if (new Set(list.map(p => p.cardNo).filter(Boolean)).size > 1) flags.push('разные карты');
    const times = list.map(p => p.time).filter(Boolean);
    if (times.length === list.length) {
      const mins = times.map(t => +t.slice(0, 2) * 60 + +t.slice(3, 5));
      for (let i = 1; i < mins.length; i++) if (mins[i] - mins[i - 1] <= 30) { flags.push('заправки с разницей до 30 мин'); break; }
    }
    if (Math.abs(journal - litres) > 0.05) flags.push('журнал ' + fpNum(journal, 2) + ' л');
    const checked = list.every(p => p.doubleChecked);
    out.push({ v, date: list[0].date, list, litres, sum, journal, flags, checked,
               checkNote: (list.find(p => p.doubleCheckNote) || {}).doubleCheckNote || '' });
  });
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.v.plate || '').localeCompare(b.v.plate || '', 'ru'));
}

let fpDoublesOnlyFlagged = false;

function fpDoublesHtml(all) {
  const open = d => d.flags.length && !d.checked;
  const list = fpDoublesOnlyFlagged ? all.filter(open) : all;
  if (!all.length) return `<div style="background:#dcfce7;color:#166534;border:1px solid #bbf7d0;border-radius:8px;padding:12px 14px">
    ${fpMonth === 'all' ? 'Сдвоенных заправок нет' : 'За ' + fpMonthLabel(fpMonth).toLowerCase() + ' сдвоенных заправок нет'} (офисные машины не учитываются).</div>`;

  const litres = all.reduce((s, d) => s + d.litres, 0);
  const sum = all.reduce((s, d) => s + d.sum, 0);
  const cars = new Set(all.map(d => d.v.id)).size;
  const flagged = all.filter(open).length;
  const card = (t, val, sub, color) => `<div style="flex:1;min-width:150px;background:var(--bg2);border:1px solid var(--border);border-left:4px solid ${color};border-radius:8px;padding:10px 14px">
      <div style="font-size:12px;color:var(--text3)">${t}</div><div style="font-size:19px;font-weight:800">${val}</div>
      ${sub ? `<div style="font-size:12px;color:var(--text3)">${sub}</div>` : ''}</div>`;

  // По машинам: сколько дней со сдвоенными заправками
  const byCar = new Map();
  all.forEach(d => {
    const c = byCar.get(d.v.id) || { v: d.v, days: 0, litres: 0, flagged: 0 };
    c.days++; c.litres += d.litres; if (open(d)) c.flagged++;
    byCar.set(d.v.id, c);
  });
  const carRows = [...byCar.values()].sort((a, b) => b.days - a.days || b.litres - a.litres).map(c => `
    <tr style="cursor:pointer" onclick="fpOpenVehicle('${c.v.id}')">
      <td style="font-weight:700">${fpEsc(c.v.plate)}</td><td>${fpEsc(c.v.make || '')}</td>
      <td style="font-size:12px;color:var(--text3)">${fpEsc(c.v.object || '')}</td>
      <td style="text-align:right">${c.days}</td><td style="text-align:right">${fpNum(c.litres, 1)}</td>
      <td style="text-align:right;${c.flagged ? 'color:#d97706;font-weight:700' : ''}">${c.flagged || '—'}</td>
    </tr>`).join('');

  const rows = list.map(d => `
    <tr>
      <td>${fmtDate(d.date)}</td>
      <td style="cursor:pointer" onclick="fpOpenVehicle('${d.v.id}')"><b>${fpEsc(d.v.plate)}</b><div style="font-size:12px;color:var(--text3)">${fpEsc(d.v.make || '')} · ${fpEsc(vehicleFuelGrade(d.v))}</div></td>
      <td style="font-size:12px;color:var(--text3);max-width:180px;white-space:normal">${fpEsc(d.v.object || '')}</td>
      <td style="text-align:center">${d.list.length}</td>
      <td style="font-size:12px">${d.list.map(p => `<div>${fpEsc(p.time || '—:—')} · <span class="fuel-tag ${fuelTypeFromGrade(p.grade)}" style="font-size:10px;padding:0 5px">${fpEsc(p.grade || '—')}</span> ${fpNum(p.qty)} л${p.sum ? ' · ' + fpNum(p.sum) + ' ₽' + (p.restored ? '≈' : '') : ''}
        <a href="#" style="margin-left:6px;font-size:11px" onclick="event.preventDefault();fpEdit('${p.id}')">изменить</a>
        <a href="#" style="margin-left:4px;font-size:11px;color:var(--red)" title="Удалить заправку и снять её с журнала" onclick="event.preventDefault();fpDelete('${p.id}')">✕</a></div>`).join('')}</td>
      <td style="text-align:right;font-weight:700;${d.litres > FP_DAY_LIMIT ? 'color:var(--red)' : ''}">${fpNum(d.litres)}</td>
      <td style="text-align:right">${d.sum ? fpNum(d.sum) : '—'}</td>
      <td style="font-size:12px;color:#b45309;max-width:220px;white-space:normal">${d.flags.map(fpEsc).join('<br>') || '<span style="color:var(--text3)">—</span>'}
        ${d.checked ? `<div style="color:var(--green);margin-top:4px">✓ проверено${d.checkNote ? ': ' + fpEsc(d.checkNote) : ''}</div>` : ''}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-ghost btn-sm" style="padding:3px 8px;font-size:11px" onclick="fpToggleChecked('${d.v.id}','${d.date}')">${d.checked ? 'Снять отметку' : 'Проверено'}</button>
      </td>
    </tr>`).join('');

  return `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
      ${card('Случаев', all.length, cars + ' машин', '#2563eb')}
      ${card('Литров в эти дни', fpNum(litres, 1) + ' л', sum ? fpNum(sum) + ' ₽' : '', '#16a34a')}
      ${card('С отметками', flagged, flagged ? 'стоит проверить' : 'вопросов нет', flagged ? '#d97706' : '#94a3b8')}
    </div>
    <div class="table-wrap" style="margin-bottom:14px">
      <div class="table-toolbar"><div class="table-toolbar-left">По машинам</div></div>
      <table class="data-table" style="width:100%">
        <thead><tr><th>Госномер</th><th>Марка</th><th>Объект</th><th style="text-align:right">Дней</th><th style="text-align:right">Литров</th><th style="text-align:right">С отметками</th></tr></thead>
        <tbody>${carRows}</tbody>
      </table>
    </div>
    <div class="table-wrap">
      <div class="table-toolbar">
        <div class="table-toolbar-left">Сдвоенные заправки · ${fpMonthLabel(fpMonth)} · без офисных машин</div>
        <label style="font-size:12px;display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="checkbox" ${fpDoublesOnlyFlagged ? 'checked' : ''} onchange="fpDoublesOnlyFlagged=this.checked;renderFuelPurchases()"> только непроверенные с отметками
        </label>
        <button class="btn btn-ghost btn-sm" onclick="fpExportDoubles()">Выгрузить в Excel</button>
      </div>
      <div class="table-scroll" style="overflow-x:auto">
        <table class="data-table" style="width:100%">
          <thead><tr><th>Дата</th><th>Машина</th><th>Объект</th><th style="text-align:center">Заправок</th><th>Заправки</th>
            <th style="text-align:right">Итого, л</th><th style="text-align:right">Сумма, ₽</th><th>Отметки</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="9" style="text-align:center;color:var(--text3);padding:16px">Случаев с отметками нет</td></tr>'}</tbody>
        </table>
      </div>
    </div>
    <div style="font-size:12px;color:var(--text3);margin-top:10px">
      Отметки: больше ${FP_DAY_LIMIT} л за день; дизель в бензиновой машине или наоборот; разные марки бензина в один день;
      машина в ремонте; разные карты; заправки с разницей до 30 минут; литры в журнале не совпадают с выписками.
      Офисные машины (объект «… (офис)») не учитываются. «≈» — сумма восстановлена из журнала, точная подтянется при повторной загрузке выписки.
    </div>`;
}

function fpExportDoubles() {
  const list = fpDoubles().filter(d => !fpDoublesOnlyFlagged || (d.flags.length && !d.checked));
  if (!list.length) { alert('Нет сдвоенных заправок'); return; }
  const P = { navy: '1B3A6B', white: 'FFFFFF', gray1: 'F8FAFC', gray3: 'E2E8F0', text: '1E293B', amber: 'B45309' };
  const b = { style: 'thin', color: { rgb: P.gray3 } };
  const border = { top: b, bottom: b, left: b, right: b };
  const st = (o) => Object.assign({ font: { sz: 10, color: { rgb: P.text } }, border, alignment: { vertical: 'top', wrapText: true } }, o);
  const head = st({ font: { bold: true, sz: 10, color: { rgb: P.white } }, fill: { patternType: 'solid', fgColor: { rgb: P.navy } },
                    alignment: { horizontal: 'center', vertical: 'center', wrapText: true } });
  const title = 'Сдвоенные заправки — ' + fpMonthLabel(fpMonth) + ' (без офисных машин)';
  const cols = ['Дата', 'Госномер', 'Марка', 'Объект', 'Заправок', 'Заправки', 'Итого, л', 'Сумма, ₽', 'Отметки'];
  const ws = {};
  const put = (r, c, v, s, z) => { const cell = { v, t: typeof v === 'number' ? 'n' : 's', s }; if (z) cell.z = z; ws[XLSX.utils.encode_cell({ r, c })] = cell; };
  put(0, 0, title, { font: { bold: true, sz: 13 } });
  cols.forEach((c, i) => put(2, i, c, head));
  list.forEach((d, i) => {
    const r = i + 3, fill = i % 2 ? { patternType: 'solid', fgColor: { rgb: P.gray1 } } : undefined;
    const s = st(fill ? { fill } : {}), sn = st(Object.assign({ alignment: { horizontal: 'right', vertical: 'top' } }, fill ? { fill } : {}));
    put(r, 0, fmtDate(d.date), s);
    put(r, 1, d.v.plate || '', s);
    put(r, 2, d.v.make || '', s);
    put(r, 3, d.v.object || '', s);
    put(r, 4, d.list.length, sn);
    put(r, 5, d.list.map(p => (p.time || '—') + ' ' + (p.grade || '') + ' ' + fpNum(p.qty) + ' л' + (p.sum ? ' · ' + fpNum(p.sum) + ' ₽' : '')).join('\n'), s);
    put(r, 6, d.litres, sn, '#,##0.00');
    put(r, 7, d.sum || '', sn, '#,##0.00');
    put(r, 8, d.flags.join('; ') + (d.checked ? (d.flags.length ? '; ' : '') + 'проверено' + (d.checkNote ? ': ' + d.checkNote : '') : ''), st(Object.assign({ font: { sz: 10, color: { rgb: P.amber } } }, fill ? { fill } : {})));
  });
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: list.length + 2, c: cols.length - 1 } });
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: cols.length - 1 } }];
  ws['!cols'] = [11, 14, 18, 30, 9, 40, 11, 13, 40].map(wch => ({ wch }));
  ws['!freeze'] = { xSplit: 0, ySplit: 3 };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Сдвоенные');
  XLSX.writeFile(wb, 'Сдвоенные_заправки_' + (fpMonth === 'all' ? 'все' : fpMonth) + '.xlsx');
}

// Отметка «проверено» для дня хранится на покупках этого дня.
// Добавится новая покупка за этот день — отметку нужно поставить заново.
function fpToggleChecked(vehicleId, date) {
  const list = fpLive().filter(p => p.vehicleId === vehicleId && p.date === date);
  if (!list.length) return;
  if (list.every(p => p.doubleChecked)) {
    list.forEach(p => { p.doubleChecked = false; p.doubleCheckNote = ''; });
    fpSaveAndRender();
    return;
  }
  const v = (data.vehicles || []).find(x => x.id === vehicleId);
  openGenericModal('Проверено: ' + (v ? v.plate : '') + ', ' + fmtDate(date), `
    <div class="form-group"><label>Комментарий (необязательно)</label>
      <input type="text" id="fpCheckNote" placeholder="например: дальний рейс, две смены"></div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">
      <button class="btn btn-ghost" onclick="closeModal('genericModal')">Отмена</button>
      <button class="btn btn-primary" onclick="fpSaveChecked('${vehicleId}','${date}')">Отметить</button>
    </div>`, 460);
  setTimeout(() => document.getElementById('fpCheckNote')?.focus(), 50);
}

function fpSaveChecked(vehicleId, date) {
  const note = (document.getElementById('fpCheckNote')?.value || '').trim();
  fpLive().filter(p => p.vehicleId === vehicleId && p.date === date)
    .forEach(p => { p.doubleChecked = true; p.doubleCheckNote = note; });
  closeModal('genericModal');
  fpSaveAndRender();
}

// ─── Сравнение месяцев ────────────────────────────────────
// Выбранный месяц против предыдущего по каждой машине. Считается по журналу
// пробега — в нём и выписки, и ручные заправки, и фактический расход.
// Главный показатель — фактический расход на 100 км: литры сами по себе
// растут вместе с пробегом, а рост на 100 км значит, что машина стала есть больше.

let fpCmpMonth = '';
let fpCmpMetric = 'per100';      // per100 | act | issued | sum
let fpCmpNoOffice = true;
let fpCmpOnlyUp = false;
let fpCmpOrg = '';
const FP_CMP_ALERT = 10;         // рост на столько процентов и больше — красным
const FP_CMP_MIN_KM = 100;       // меньше — л/100 км слишком неустойчив для сравнения

const FP_CMP_METRICS = {
  per100: { label: 'Факт. расход, л/100 км', dec: 2 },
  iss100: { label: 'Выдано на 100 км, л',    dec: 2 },
  act:    { label: 'Факт. расход, л',        dec: 1 },
  issued: { label: 'Выдано, л',              dec: 1 },
  sum:    { label: 'Сумма заправок, ₽',      dec: 2 },
};

// «против июля 2026» — месяц в родительном падеже
function fpMonthGen(m) {
  const [y, mo] = m.split('-');
  return ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'][+mo - 1] + ' ' + y;
}

function fpPrevMonth(m) {
  let [y, mo] = m.split('-').map(Number);
  mo--; if (!mo) { mo = 12; y--; }
  return y + '-' + String(mo).padStart(2, '0');
}

function fpCmpMonths() {
  const s = new Set((data.records || []).map(r => (r.date || '').slice(0, 7)).filter(Boolean));
  return [...s].sort().reverse();
}

function fpCmpAgg(vehicleId, month) {
  const a = { km: 0, act: 0, issued: 0, sum: 0, n: 0 };
  recsFor(vehicleId).forEach(r => {
    if (!(r.date || '').startsWith(month)) return;
    a.km += +r.km || 0;
    // фактический расход: если не заполнен — расход по норме, как в карточке машины
    a.act += +r.fuelActual || +r.fuelUsed || 0;
    a.issued += +r.fuelIssued || 0;
    a.sum += +r.fuelSum || 0;
    a.n++;
  });
  a.per100 = a.km >= FP_CMP_MIN_KM ? a.act / a.km * 100 : null;
  // Выдано на 100 км: сколько топлива ушло в машину на единицу пробега.
  // За месяц заправки и пробег могут не совпасть (залили в конце месяца),
  // поэтому показатель шумнее, зато не зависит от того, как заполнен факт. расход.
  a.iss100 = a.km >= FP_CMP_MIN_KM && a.issued ? a.issued / a.km * 100 : null;
  return a;
}

function fpCmpRows() {
  const cur = fpCmpMonth, prev = fpPrevMonth(cur);
  const key = fpCmpMetric;
  return (data.vehicles || []).map(v => {
    if (fpCmpNoOffice && fpIsOffice(v)) return null;
    if (fpCmpOrg && (v.org || '') !== fpCmpOrg) return null;
    const a = fpCmpAgg(v.id, prev), b = fpCmpAgg(v.id, cur);
    if (!a.n && !b.n) return null;
    const pv = a[key], cv = b[key];
    const delta = pv != null && cv != null ? cv - pv : null;
    const pct = delta != null && pv ? delta / pv * 100 : null;
    const norm = +v.norm || null;
    return { v, a, b, pv, cv, delta, pct, norm };
  }).filter(Boolean);
}

function fpCompareHtml() {
  const months = fpCmpMonths();
  if (!fpCmpMonth || !months.includes(fpCmpMonth)) fpCmpMonth = months[0] || '';
  if (!fpCmpMonth) return '<div class="welcome" style="padding:60px 0"><p>В журнале пробега нет записей</p></div>';
  const prev = fpPrevMonth(fpCmpMonth);
  const M = FP_CMP_METRICS[fpCmpMetric];
  const all = fpCmpRows();
  const up = all.filter(r => r.pct != null && r.pct >= FP_CMP_ALERT);
  const list = (fpCmpOnlyUp ? up : all).slice().sort((x, y) =>
    (y.pct ?? -Infinity) - (x.pct ?? -Infinity) || (x.v.plate || '').localeCompare(y.v.plate || '', 'ru'));

  const tot = (k, side) => all.reduce((s, r) => s + (r[side][k] || 0), 0);
  const totKmA = tot('km', 'a'), totKmB = tot('km', 'b'), totActA = tot('act', 'a'), totActB = tot('act', 'b');
  const fleetA = totKmA ? totActA / totKmA * 100 : null, fleetB = totKmB ? totActB / totKmB * 100 : null;

  const f = (v, dec) => v == null ? '—' : fpNum(v, dec);
  const pctHtml = p => p == null ? '<span style="color:var(--text3)">—</span>'
    : `<span style="font-weight:700;color:${p >= FP_CMP_ALERT ? 'var(--red)' : p <= -FP_CMP_ALERT ? 'var(--green)' : 'var(--text2)'}">${p > 0 ? '+' : ''}${fpNum(p, 1)}%</span>`;
  const card = (t, val, sub, color) => `<div style="flex:1;min-width:170px;background:var(--bg2);border:1px solid var(--border);border-left:4px solid ${color};border-radius:8px;padding:10px 14px">
      <div style="font-size:12px;color:var(--text3)">${t}</div><div style="font-size:19px;font-weight:800">${val}</div>
      ${sub ? `<div style="font-size:12px;color:var(--text3)">${sub}</div>` : ''}</div>`;
  const fleetPct = fleetA && fleetB ? (fleetB - fleetA) / fleetA * 100 : null;

  const rows = list.map(r => {
    const overNorm = r.norm && r.b.per100 != null && r.b.per100 > r.norm * 1.1;
    return `<tr style="cursor:pointer" onclick="fpOpenVehicle('${r.v.id}')">
      <td><b>${fpEsc(r.v.plate)}</b><div style="font-size:12px;color:var(--text3)">${fpEsc(r.v.make || '')}</div></td>
      <td style="font-size:12px;color:var(--text3);max-width:170px;white-space:normal">${fpEsc(r.v.object || '')}</td>
      <td style="text-align:right">${fpNum(r.a.km, 0)}</td>
      <td style="text-align:right">${fpNum(r.b.km, 0)}</td>
      <td style="text-align:right">${f(r.pv, M.dec)}</td>
      <td style="text-align:right;font-weight:700">${f(r.cv, M.dec)}</td>
      <td style="text-align:right">${r.delta == null ? '—' : (r.delta > 0 ? '+' : '') + fpNum(r.delta, M.dec)}</td>
      <td style="text-align:right">${pctHtml(r.pct)}</td>
      <td style="text-align:right;font-size:12px">${r.norm ? fpNum(r.norm, 1) : '—'}${overNorm ? '<div style="color:var(--red)">выше нормы</div>' : ''}</td>
    </tr>`;
  }).join('');

  const metricBtns = Object.entries(FP_CMP_METRICS).map(([id, m]) =>
    `<button class="mtab ${fpCmpMetric === id ? 'active' : ''}" onclick="fpCmpMetric='${id}';renderFuelPurchases()">${m.label}</button>`).join('');
  const orgs = [...new Set((data.vehicles || []).map(v => v.org).filter(Boolean))].sort();

  return `
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
      <select class="fsel" onchange="fpCmpMonth=this.value;renderFuelPurchases()">
        ${months.map(m => `<option value="${m}"${m === fpCmpMonth ? ' selected' : ''}>${fpMonthLabel(m)}</option>`).join('')}
      </select>
      <span style="color:var(--text3)">против ${fpMonthGen(prev)}</span>
      <select class="fsel" onchange="fpCmpOrg=this.value;renderFuelPurchases()">
        <option value="">Все организации</option>
        ${orgs.map(o => `<option${o === fpCmpOrg ? ' selected' : ''}>${fpEsc(o)}</option>`).join('')}
      </select>
      <label style="font-size:13px;display:flex;gap:6px;align-items:center;cursor:pointer">
        <input type="checkbox" ${fpCmpNoOffice ? 'checked' : ''} onchange="fpCmpNoOffice=this.checked;renderFuelPurchases()"> без офисных машин</label>
      <label style="font-size:13px;display:flex;gap:6px;align-items:center;cursor:pointer">
        <input type="checkbox" ${fpCmpOnlyUp ? 'checked' : ''} onchange="fpCmpOnlyUp=this.checked;renderFuelPurchases()"> только рост от ${FP_CMP_ALERT}%</label>
    </div>
    <div class="month-tabs" style="margin-bottom:14px">${metricBtns}</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
      ${card('Машин с ростом от ' + FP_CMP_ALERT + '%', up.length, 'из ' + all.filter(r => r.pct != null).length + ' сравнимых', up.length ? '#dc2626' : '#16a34a')}
      ${card('Расход по парку, л/100 км', f(fleetB, 2), 'было ' + f(fleetA, 2) + (fleetPct != null ? ' · ' + (fleetPct > 0 ? '+' : '') + fpNum(fleetPct, 1) + '%' : ''), '#2563eb')}
      ${card('Факт. расход по парку', fpNum(totActB, 0) + ' л', 'было ' + fpNum(totActA, 0) + ' л', '#64748b')}
      ${card('Пробег по парку', fpNum(totKmB, 0) + ' км', 'было ' + fpNum(totKmA, 0) + ' км', '#64748b')}
    </div>
    <div class="table-wrap">
      <div class="table-toolbar">
        <div class="table-toolbar-left">${M.label}: ${fpMonthLabel(fpCmpMonth)} против ${fpMonthGen(prev)}</div>
        <button class="btn btn-ghost btn-sm" onclick="fpExportCompare()">Выгрузить в Excel</button>
      </div>
      <div class="table-scroll" style="overflow-x:auto">
        <table class="data-table" style="width:100%">
          <thead><tr>
            <th>Машина</th><th>Объект</th>
            <th style="text-align:right">Пробег, км<br><span style="font-weight:400">${fpMonthLabel(prev)}</span></th>
            <th style="text-align:right">Пробег, км<br><span style="font-weight:400">${fpMonthLabel(fpCmpMonth)}</span></th>
            <th style="text-align:right">${M.label}<br><span style="font-weight:400">${fpMonthLabel(prev)}</span></th>
            <th style="text-align:right">${M.label}<br><span style="font-weight:400">${fpMonthLabel(fpCmpMonth)}</span></th>
            <th style="text-align:right">Изменение</th><th style="text-align:right">%</th>
            <th style="text-align:right">Норма, л/100 км</th>
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="9" style="text-align:center;color:var(--text3);padding:16px">Машин с ростом нет</td></tr>'}</tbody>
        </table>
      </div>
    </div>
    <div style="font-size:12px;color:var(--text3);margin-top:10px">
      По журналу пробега. Фактический расход — поле «Факт. расход», а где оно пустое — расход по норме.
      Л/100 км считается при пробеге от ${FP_CMP_MIN_KM} км за месяц, иначе «—». Рост от ${FP_CMP_ALERT}% — красным, снижение — зелёным.
      «Выше нормы» — фактический расход за месяц больше нормы из карточки машины более чем на 10%. Нажмите на строку, чтобы открыть заправки машины.
    </div>`;
}

function fpExportCompare() {
  const prev = fpPrevMonth(fpCmpMonth);
  const rows = fpCmpRows().filter(r => !fpCmpOnlyUp || (r.pct != null && r.pct >= FP_CMP_ALERT))
    .sort((x, y) => (y.pct ?? -Infinity) - (x.pct ?? -Infinity));
  if (!rows.length) { alert('Нет данных для выгрузки'); return; }
  const P = { navy: '1B3A6B', white: 'FFFFFF', gray1: 'F8FAFC', gray3: 'E2E8F0', text: '1E293B', red: 'B91C1C', green: '15803D' };
  const b = { style: 'thin', color: { rgb: P.gray3 } };
  const border = { top: b, bottom: b, left: b, right: b };
  const st = (o) => Object.assign({ font: { sz: 10, color: { rgb: P.text } }, border, alignment: { vertical: 'center' } }, o);
  const head = st({ font: { bold: true, sz: 10, color: { rgb: P.white } }, fill: { patternType: 'solid', fgColor: { rgb: P.navy } },
                    alignment: { horizontal: 'center', vertical: 'center', wrapText: true } });
  const A = fpMonthLabel(prev), B = fpMonthLabel(fpCmpMonth);
  const cols = ['Госномер', 'Марка', 'Объект', 'Пробег ' + A, 'Пробег ' + B,
    'л/100 км ' + A, 'л/100 км ' + B, 'Изм. л/100, %',
    'Факт. расход, л ' + A, 'Факт. расход, л ' + B, 'Выдано, л ' + A, 'Выдано, л ' + B,
    'Сумма, ₽ ' + A, 'Сумма, ₽ ' + B, 'Норма, л/100 км'];
  const ws = {};
  const put = (r, c, v, s, z) => { const cell = { v: v == null ? '' : v, t: typeof v === 'number' ? 'n' : 's', s }; if (z && typeof v === 'number') cell.z = z; ws[XLSX.utils.encode_cell({ r, c })] = cell; };
  put(0, 0, 'Сравнение расхода: ' + B + ' против ' + fpMonthGen(prev) + (fpCmpNoOffice ? ' (без офисных машин)' : ''), { font: { bold: true, sz: 13 } });
  cols.forEach((c, i) => put(2, i, c, head));
  rows.forEach((r, i) => {
    const R = i + 3, fill = i % 2 ? { fill: { patternType: 'solid', fgColor: { rgb: P.gray1 } } } : {};
    const s = st(fill), n = st(Object.assign({ alignment: { horizontal: 'right' } }, fill));
    const pct = r.a.per100 && r.b.per100 != null ? (r.b.per100 - r.a.per100) / r.a.per100 * 100 : null;
    const pc = st(Object.assign({ alignment: { horizontal: 'right' },
      font: { sz: 10, bold: true, color: { rgb: pct >= FP_CMP_ALERT ? P.red : pct <= -FP_CMP_ALERT ? P.green : P.text } } }, fill));
    const vals = [r.v.plate, r.v.make, r.v.object, r.a.km, r.b.km,
      r.a.per100 != null ? fpRound(r.a.per100) : null, r.b.per100 != null ? fpRound(r.b.per100) : null,
      pct != null ? Math.round(pct * 10) / 10 : null,
      fpRound(r.a.act), fpRound(r.b.act), fpRound(r.a.issued), fpRound(r.b.issued), fpRound(r.a.sum), fpRound(r.b.sum), r.norm];
    vals.forEach((v, c) => put(R, c, v, c < 3 ? s : c === 7 ? pc : n, c === 7 ? '+0.0;-0.0;0' : c >= 12 && c <= 13 ? '#,##0.00' : '#,##0.##'));
  });
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length + 2, c: cols.length - 1 } });
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: cols.length - 1 } }];
  ws['!cols'] = [14, 18, 28, 10, 10, 10, 10, 10, 11, 11, 11, 11, 13, 13, 10].map(wch => ({ wch }));
  ws['!rows'] = [{ hpt: 22 }, {}, { hpt: 42 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Сравнение');
  XLSX.writeFile(wb, 'Сравнение_расхода_' + fpCmpMonth + '_к_' + prev + '.xlsx');
}

// ─── Отрицательный остаток ────────────────────────────────
// Машины, у которых остаток топлива по журналу ушёл в минус. Остаток
// считается той же функцией, что в карточке машины: начальный остаток
// плюс выдано минус факт. расход (или расход по норме) минус холостой ход.
// Минус почти всегда значит, что заправка не попала в журнал: не загружена
// выписка, заправляли по другой карте, или завышен факт. расход.

let fpNegNoOffice = false;
let fpNegWithRecovered = false;
let fpNegOrg = '';

function fpNegRows() {
  return (data.vehicles || []).map(v => {
    if (fpNegNoOffice && fpIsOffice(v)) return null;
    if (fpNegOrg && (v.org || '') !== fpNegOrg) return null;
    const recs = recsFor(v.id).slice().sort((a, b) => cmpDateAsc(a.date, b.date));
    if (!recs.length) return null;
    const bal = computeFuelBalances(v.id);
    let min = Infinity, minDate = '', firstNeg = '', negRecs = 0, issued = 0, spent = 0;
    const monthEnd = {}, monthIssued = {}, monthKm = {};
    recs.forEach(r => {
      const b = bal[r.id];
      if (b < min) { min = b; minDate = r.date; }
      if (b < -0.05) { negRecs++; if (!firstNeg) firstNeg = r.date; }
      const m = r.date.slice(0, 7);
      monthEnd[m] = b;
      monthIssued[m] = (monthIssued[m] || 0) + (+r.fuelIssued || 0);
      monthKm[m] = (monthKm[m] || 0) + (+r.km || 0);
      issued += +r.fuelIssued || 0;
      spent += (r.fuelActual != null ? +r.fuelActual : (+r.fuelUsed || 0)) + (+r.fuelIdle || 0);
    });
    if (!(min < -0.05)) return null;
    const now = bal[recs[recs.length - 1].id];
    if (now >= -0.05 && !fpNegWithRecovered) return null;
    // Подсказка: месяцы, где машина ездила, а выдачи нет
    const dryMonths = Object.keys(monthKm).filter(m => monthKm[m] > 0 && !monthIssued[m]).sort();
    const hint = !issued ? 'в журнале нет ни одной заправки'
      : dryMonths.length ? 'нет заправок за ' + dryMonths.map(m => fpMonthLabel(m).toLowerCase()).join(', ')
      : 'расход больше выдачи';
    return { v, now, min, minDate, firstNeg, negRecs, issued, spent, start: +v.fuelBalance || 0,
             monthEnd, last: recs[recs.length - 1].date, hint, recovered: now >= -0.05 };
  }).filter(Boolean).sort((a, b) => a.now - b.now);
}

function fpNegativeHtml() {
  const list = fpNegRows();
  const months = [...new Set(list.flatMap(r => Object.keys(r.monthEnd)))].sort().slice(-4);
  const orgs = [...new Set((data.vehicles || []).map(v => v.org).filter(Boolean))].sort();
  const cur = list.filter(r => !r.recovered);
  const totalNeg = cur.reduce((s, r) => s + r.now, 0);
  const card = (t, val, sub, color) => `<div style="flex:1;min-width:170px;background:var(--bg2);border:1px solid var(--border);border-left:4px solid ${color};border-radius:8px;padding:10px 14px">
      <div style="font-size:12px;color:var(--text3)">${t}</div><div style="font-size:19px;font-weight:800">${val}</div>
      ${sub ? `<div style="font-size:12px;color:var(--text3)">${sub}</div>` : ''}</div>`;
  const b = x => x == null ? '<span style="color:var(--text3)">—</span>'
    : `<span style="${x < -0.05 ? 'color:var(--red);font-weight:700' : ''}">${fpNum(x, 1)}</span>`;

  const rows = list.map(r => `
    <tr style="cursor:pointer" onclick="fpOpenJournal('${r.v.id}','${(r.firstNeg || r.last).slice(0, 7)}')" title="Открыть журнал пробега с месяца, когда остаток ушёл в минус">
      <td><b>${fpEsc(r.v.plate)}</b><div style="font-size:12px;color:var(--text3)">${fpEsc(r.v.make || '')}</div></td>
      <td style="font-size:12px">${fpEsc(r.v.org || '')}<div style="color:var(--text3);max-width:180px;white-space:normal">${fpEsc(r.v.object || '')}</div></td>
      <td style="text-align:right;font-size:15px">${b(r.now)}${r.recovered ? '<div style="font-size:11px;color:var(--green)">вышел из минуса</div>' : ''}</td>
      <td style="text-align:right">${b(r.min)}<div style="font-size:11px;color:var(--text3)">${fmtDate(r.minDate)}</div></td>
      <td>${fmtDate(r.firstNeg)}</td>
      ${months.map(m => `<td style="text-align:right">${b(r.monthEnd[m])}</td>`).join('')}
      <td style="text-align:right">${fpNum(r.issued, 0)}</td>
      <td style="text-align:right">${fpNum(r.spent, 0)}</td>
      <td style="font-size:12px;color:#b45309;max-width:200px;white-space:normal">${fpEsc(r.hint)}</td>
    </tr>`).join('');

  return `
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
      <select class="fsel" onchange="fpNegOrg=this.value;renderFuelPurchases()">
        <option value="">Все организации</option>
        ${orgs.map(o => `<option${o === fpNegOrg ? ' selected' : ''}>${fpEsc(o)}</option>`).join('')}
      </select>
      <label style="font-size:13px;display:flex;gap:6px;align-items:center;cursor:pointer">
        <input type="checkbox" ${fpNegNoOffice ? 'checked' : ''} onchange="fpNegNoOffice=this.checked;renderFuelPurchases()"> без офисных машин</label>
      <label style="font-size:13px;display:flex;gap:6px;align-items:center;cursor:pointer">
        <input type="checkbox" ${fpNegWithRecovered ? 'checked' : ''} onchange="fpNegWithRecovered=this.checked;renderFuelPurchases()"> показать и вышедших из минуса</label>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
      ${card('Сейчас в минусе', cur.length + ' машин', '', cur.length ? '#dc2626' : '#16a34a')}
      ${card('Сумма минусов', fpNum(totalNeg, 1) + ' л', 'не хватает в журнале', '#dc2626')}
      ${card('Без единой заправки', cur.filter(r => !r.issued).length + ' машин', 'расход есть, выдачи нет', '#d97706')}
    </div>
    ${list.length ? `<div class="table-wrap">
      <div class="table-toolbar">
        <div class="table-toolbar-left">Машины с отрицательным остатком топлива</div>
        <button class="btn btn-ghost btn-sm" onclick="fpExportNegative()">Выгрузить в Excel</button>
      </div>
      <div class="table-scroll" style="overflow-x:auto">
        <table class="data-table" style="width:100%">
          <thead><tr><th>Машина</th><th>Организация / объект</th><th style="text-align:right">Остаток сейчас, л</th>
            <th style="text-align:right">Минимум, л</th><th>В минусе с</th>
            ${months.map(m => `<th style="text-align:right">На конец<br><span style="font-weight:400">${fpMonthLabel(m)}</span></th>`).join('')}
            <th style="text-align:right">Выдано всего, л</th><th style="text-align:right">Расход всего, л</th><th>Вероятная причина</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>` : `<div style="background:#dcfce7;color:#166534;border:1px solid #bbf7d0;border-radius:8px;padding:12px 14px">Машин с отрицательным остатком нет.</div>`}
    <div style="font-size:12px;color:var(--text3);margin-top:10px">
      Остаток — как в карточке машины: начальный остаток + выдано − факт. расход (где он пустой — расход по норме) − холостой ход.
      Минус обычно значит, что заправка не попала в журнал: не загружена выписка за месяц, машину заправляли по другой карте,
      или факт. расход завышен. Нажмите на строку — откроется журнал пробега с месяца, когда остаток ушёл в минус.
    </div>`;
}

function fpOpenJournal(vid, month) {
  switchSection('vehicles');
  selectVehicle(vid);
  if (month) {
    const [y, m] = month.split('-');
    selectedYear = +y; selectedMonth = +m;
  }
  if (typeof vehicleDetailView !== 'undefined') vehicleDetailView = 'journal';
  const v = data.vehicles.find(x => x.id === vid);
  if (v) renderDetail(v);
}

function fpExportNegative() {
  const list = fpNegRows();
  if (!list.length) { alert('Машин с отрицательным остатком нет'); return; }
  const months = [...new Set(list.flatMap(r => Object.keys(r.monthEnd)))].sort().slice(-4);
  const P = { navy: '1B3A6B', white: 'FFFFFF', gray1: 'F8FAFC', gray3: 'E2E8F0', text: '1E293B', red: 'B91C1C', amber: 'B45309' };
  const bd = { style: 'thin', color: { rgb: P.gray3 } };
  const border = { top: bd, bottom: bd, left: bd, right: bd };
  const st = o => Object.assign({ font: { sz: 10, color: { rgb: P.text } }, border, alignment: { vertical: 'center', wrapText: true } }, o);
  const head = st({ font: { bold: true, sz: 10, color: { rgb: P.white } }, fill: { patternType: 'solid', fgColor: { rgb: P.navy } },
                    alignment: { horizontal: 'center', vertical: 'center', wrapText: true } });
  const cols = ['Госномер', 'Марка', 'Организация', 'Объект', 'Статус', 'Остаток сейчас, л', 'Минимум, л', 'Дата минимума', 'В минусе с']
    .concat(months.map(m => 'На конец ' + fpMonthGen(m) + ', л'))
    .concat(['Начальный остаток, л', 'Выдано всего, л', 'Расход всего, л', 'Вероятная причина']);
  const ws = {};
  const put = (r, c, v, s, z) => { const cell = { v: v == null ? '' : v, t: typeof v === 'number' ? 'n' : 's', s }; if (z && typeof v === 'number') cell.z = z; ws[XLSX.utils.encode_cell({ r, c })] = cell; };
  put(0, 0, 'Машины с отрицательным остатком топлива на ' + new Date().toLocaleDateString('ru'), { font: { bold: true, sz: 13 } });
  cols.forEach((c, i) => put(2, i, c, head));
  list.forEach((r, i) => {
    const R = i + 3, fill = i % 2 ? { fill: { patternType: 'solid', fgColor: { rgb: P.gray1 } } } : {};
    const s = st(fill), n = st(Object.assign({ alignment: { horizontal: 'right' } }, fill));
    const neg = x => st(Object.assign({ alignment: { horizontal: 'right' }, font: { sz: 10, bold: x < -0.05, color: { rgb: x < -0.05 ? P.red : P.text } } }, fill));
    const vals = [r.v.plate, r.v.make, r.v.org, r.v.object, r.v.status, fpRound(r.now), fpRound(r.min), fmtDate(r.minDate), fmtDate(r.firstNeg)]
      .concat(months.map(m => r.monthEnd[m] != null ? fpRound(r.monthEnd[m]) : null))
      .concat([fpRound(r.start), fpRound(r.issued), fpRound(r.spent), r.hint]);
    vals.forEach((v, c) => {
      const isBal = c === 5 || c === 6 || (c >= 9 && c < 9 + months.length);
      put(R, c, v, c === vals.length - 1 ? st(Object.assign({ font: { sz: 10, color: { rgb: P.amber } } }, fill))
        : isBal ? neg(v) : typeof v === 'number' ? n : s, '#,##0.0');
    });
  });
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: list.length + 2, c: cols.length - 1 } });
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: cols.length - 1 } }];
  ws['!cols'] = [14, 18, 13, 28, 11, 11, 11, 11, 11].concat(months.map(() => 12)).concat([11, 11, 11, 36]).map(wch => ({ wch }));
  ws['!rows'] = [{ hpt: 22 }, {}, { hpt: 40 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Минус по остатку');
  XLSX.writeFile(wb, 'Отрицательный_остаток_' + new Date().toISOString().slice(0, 10) + '.xlsx');
}
