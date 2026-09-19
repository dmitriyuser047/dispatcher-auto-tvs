// Синхронизация данных по разделам (работа нескольких людей с одной базой).
//
// Раньше каждое сохранение отправляло все данные целиком, а чужие правки
// появлялись только после перезапуска: кто сохранил последним, тот молча
// затирал работу другого. Теперь:
//  • сохраняются только изменившиеся разделы, с номером версии, от которой
//    шла правка;
//  • если раздел за это время поменял кто-то ещё, сервер отказывает, а
//    программа сливает правки по записям (по id) и повторяет сохранение:
//    свои изменения поверх чужих, поле за полем, удалённое остаётся удалённым;
//  • раз в 20 секунд программа сверяет версии и подтягивает чужие изменения.
//
// Если сервер старый (без записи по разделам), работает прежний способ.

const SYNC_SECTIONS = [
  'vehicles', 'records', 'generators', 'genRecords', 'toRecords',
  'tanks', 'tankIncomes', 'vehicleTo', 'repairs',
  'reestrRows', 'savedReestrs', 'payments', 'budget', 'contragents',
  'fuelPurchases', 'fuelImports', 'fuelCards', 'fuelPeriods',
];
const SYNC_NAMES = {
  vehicles: 'машины', records: 'журнал пробега', generators: 'ДЭС', genRecords: 'наработка ДЭС',
  toRecords: 'график ТО', tanks: 'ёмкости', tankIncomes: 'приход в ёмкости', vehicleTo: 'ТО машин',
  repairs: 'ремонты', reestrRows: 'реестр', savedReestrs: 'реестры', payments: 'платежи', budget: 'бюджет',
  contragents: 'контрагенты', fuelPurchases: 'заправки', fuelImports: 'история загрузок',
  fuelCards: 'топливные карты', fuelPeriods: 'закрытие месяцев',
};
const SYNC_POLL_MS = 20000;

const _sync = { enabled: false, revs: {}, synced: {}, chain: Promise.resolve(), polling: null, needRefresh: [] };

function syncKey(row) { return row && typeof row === 'object' ? (row.id ?? row.month ?? null) : null; }

// Слияние раздела: base — как было при последней синхронизации, local — наше
// сейчас, remote — на сервере сейчас. Результат: серверные данные плюс наши
// изменения относительно base.
function syncMerge(base, local, remote) {
  base = base || []; local = local || []; remote = remote || [];
  const keyed = a => a.every(r => syncKey(r) != null);
  if (!keyed(base) || !keyed(local) || !keyed(remote)) {
    // Без ключей по записям слить нельзя: если мы меняли раздел — берём своё
    return JSON.stringify(local) !== JSON.stringify(base) ? local : remote;
  }
  const bMap = new Map(base.map(r => [syncKey(r), r]));
  const lMap = new Map(local.map(r => [syncKey(r), r]));
  const out = new Map(remote.map(r => [syncKey(r), r]));
  lMap.forEach((l, k) => {
    const b = bMap.get(k);
    if (!b) { out.set(k, l); return; }                        // добавили мы
    if (JSON.stringify(l) === JSON.stringify(b)) return;       // не трогали
    const r = out.get(k);
    if (!r) { out.set(k, l); return; }                         // у них удалили, у нас правили — оставляем
    const m = Object.assign({}, r);                            // правили оба — наши поля поверх
    new Set([...Object.keys(l), ...Object.keys(b)]).forEach(f => {
      if (JSON.stringify(l[f]) !== JSON.stringify(b[f])) { if (f in l) m[f] = l[f]; else delete m[f]; }
    });
    out.set(k, m);
  });
  bMap.forEach((b, k) => { if (!lMap.has(k)) out.delete(k); }); // удалили мы
  // Порядок: как на сервере, новые наши — в конце, в своём порядке
  const order = remote.map(syncKey).filter(k => out.has(k));
  local.forEach(r => { const k = syncKey(r); if (!order.includes(k) && out.has(k)) order.push(k); });
  return order.map(k => out.get(k));
}

async function syncLoad() {
  if (!window.electronAPI || !window.electronAPI.readSnapshot) return null;
  const raw = await window.electronAPI.readSnapshot();
  if (!raw) return null;
  const snap = JSON.parse(raw);
  if (!snap || !snap.data) return null;
  if (snap.revisions) {
    _sync.enabled = true;
    _sync.revs = Object.assign({}, snap.revisions);
  }
  SYNC_SECTIONS.forEach(n => { _sync.synced[n] = JSON.stringify(snap.data[n] || []); });
  return snap.data;
}

// Сохранения идут строго по очереди — иначе два быстрых сохранения
// отправили бы одну и ту же версию и поссорились друг с другом
function syncSave(d) {
  const p = _sync.chain.then(() => syncSaveNow(d));
  _sync.chain = p.catch(() => false);
  return p;
}

async function syncSaveNow(d) {
  let cur = {};
  const changedNow = () => SYNC_SECTIONS.filter(n => {
    cur[n] = JSON.stringify(d[n] || []);
    return cur[n] !== _sync.synced[n];
  });
  let changed = changedNow();
  if (!changed.length) return true;
  const mergedNames = new Set();
  for (let attempt = 0; attempt < 4; attempt++) {
    const payload = { base: {}, sections: {} };
    changed.forEach(n => { payload.base[n] = _sync.revs[n] || 0; payload.sections[n] = d[n] || []; });
    const res = await window.electronAPI.writeSections(JSON.stringify(payload));
    if (res && res.unsupported) {
      // Сервер старой версии — сохраняем по-старому, целиком
      _sync.enabled = false;
      return await window.electronAPI.writeData(JSON.stringify(d)) !== false;
    }
    if (res && res.ok) {
      changed.forEach(n => { _sync.synced[n] = cur[n]; });
      _sync.revs = Object.assign(_sync.revs, res.revisions || {});
      if (mergedNames.size) {
        rebuildIndex();
        showToast('Сохранено вместе с правками другого пользователя: ' + [...mergedNames].map(n => SYNC_NAMES[n] || n).join(', '));
        syncRefreshView([...mergedNames]);
      }
      return true;
    }
    if (!res || !res.conflicts) return false;
    // Кто-то успел поменять эти разделы — сливаем и пробуем снова
    for (const n of res.conflicts) {
      const remote = await window.electronAPI.readSection(n);
      if (!remote) return false;
      const base = JSON.parse(_sync.synced[n] || '[]');
      d[n] = syncMerge(base, d[n] || [], remote.rows || []);
      _sync.synced[n] = JSON.stringify(remote.rows || []);
      _sync.revs[n] = remote.rev || 0;
      mergedNames.add(n);
    }
    if (mergedNames.has('reestrRows') && typeof reestrRows !== 'undefined') reestrRows = d.reestrRows;
    changed = changedNow();
    if (!changed.length) { rebuildIndex(); syncRefreshView([...mergedNames]); return true; }
  }
  return false;
}

// Подтянуть чужие изменения
async function syncPoll() {
  if (!_sync.enabled || !window.electronAPI.getRevisions) return;
  if (_sync.needRefresh.length) syncRefreshView([]);
  const revs = await window.electronAPI.getRevisions();
  if (!revs) return;
  const stale = SYNC_SECTIONS.filter(n => (revs[n] || 0) !== (_sync.revs[n] || 0));
  if (!stale.length) return;
  // В очередь с сохранениями, чтобы не подтягивать посреди записи
  _sync.chain = _sync.chain.then(async () => {
    const got = [];
    for (const n of stale) {
      const remote = await window.electronAPI.readSection(n);
      if (!remote) continue;
      const localStr = JSON.stringify(data[n] || []);
      if (localStr !== _sync.synced[n]) {
        // У нас есть несохранённые правки в этом разделе — сливаем
        data[n] = syncMerge(JSON.parse(_sync.synced[n] || '[]'), data[n] || [], remote.rows || []);
      } else {
        data[n] = remote.rows || [];
      }
      _sync.synced[n] = JSON.stringify(remote.rows || []);
      _sync.revs[n] = remote.rev || 0;
      got.push(n);
    }
    if (!got.length) return;
    if (got.includes('reestrRows') && typeof reestrRows !== 'undefined') reestrRows = data.reestrRows;
    rebuildIndex();
    showToast('Обновлено другим пользователем: ' + got.map(n => SYNC_NAMES[n] || n).join(', '));
    syncRefreshView(got);
  }).catch(e => console.warn('[sync] ' + (e && e.message)));
}

// Перерисовать текущий экран, но не мешать вводу: если открыто окно или
// курсор стоит в поле — отложить до следующей проверки
function syncRefreshView(names) {
  _sync.needRefresh = [...new Set([..._sync.needRefresh, ...names])];
  const busy = document.querySelector('.modal-overlay.open') ||
    (document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) &&
     document.getElementById('mainContent')?.contains(document.activeElement));
  if (busy) return;
  _sync.needRefresh = [];
  try {
    if (activeSection === 'vehicles') {
      const v = selectedVehicleId && data.vehicles.find(x => x.id === selectedVehicleId);
      if (v) renderDetail(v); else if (typeof renderVehicleCards === 'function') renderVehicleCards();
    } else if (activeSection === 'fuelPurchases') renderFuelPurchases();
    else if (activeSection === 'home') renderMainMenu();
    else if (activeSection === 'reports') renderReportsSection();
    else if (activeSection === 'fuelReport') renderFuelReport();
    else if (activeSection === 'generators' && typeof renderGeneratorCards === 'function' && !selectedGeneratorId) renderGeneratorCards();
  } catch (e) { console.warn('[sync] перерисовка: ' + e.message); }
}

function syncStartPolling() {
  if (_sync.polling || !_sync.enabled) return;
  _sync.polling = setInterval(syncPoll, SYNC_POLL_MS);
}
