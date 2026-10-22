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

const SYNC_SECTIONS = typeof PlatformSchema !== 'undefined' ? PlatformSchema.sections.slice() : [
  'vehicles', 'records', 'generators', 'genRecords', 'toRecords',
  'tanks', 'tankIncomes', 'vehicleTo', 'repairs',
  'reestrRows', 'savedReestrs', 'payments', 'budget', 'contragents',
  'fuelPurchases', 'fuelImports', 'fuelCards', 'fuelPeriods', 'fuelWriteoffs', 'monthlyFuel', 'appMeta',
  'dispatchJobs', 'drivers', 'assetAssignments', 'workOrders', 'opsTasks',
  'assetDocuments', 'fuelMovements', 'parts', 'partMovements', 'shiftReports',
  'connectors', 'auditLog', 'savedViews', 'glonassTrips', 'glonassImports',
  'costEntries', 'costProfiles', 'procurementOrders', 'procurementRules',
];
const SYNC_NAMES = {
  vehicles: 'машины', records: 'журнал пробега', generators: 'ДЭС', genRecords: 'наработка ДЭС',
  toRecords: 'график ТО', tanks: 'ёмкости', tankIncomes: 'приход в ёмкости', vehicleTo: 'ТО машин',
  repairs: 'ремонты', reestrRows: 'реестр', savedReestrs: 'реестры', payments: 'платежи', budget: 'бюджет',
  contragents: 'контрагенты', fuelPurchases: 'заправки', fuelImports: 'история загрузок',
  fuelCards: 'топливные карты', fuelPeriods: 'закрытие месяцев', fuelWriteoffs:'акты списания ГСМ', monthlyFuel: 'топливо за месяц', appMeta: 'настройки',
  dispatchJobs:'заявки', drivers:'сотрудники', assetAssignments:'назначения', workOrders:'заказы на ремонт', opsTasks:'задачи',
  assetDocuments:'документы', fuelMovements:'движения топлива', parts:'запчасти и шины', partMovements:'движения запчастей', shiftReports:'сменные формы',
  connectors:'обмен', auditLog:'история действий', savedViews:'представления', glonassTrips:'исходные рейсы', glonassImports:'импорты ГЛОНАСС',
  costEntries:'операции стоимости', costProfiles:'ставки стоимости', procurementOrders:'заказы поставщикам', procurementRules:'правила закупок',
};
const SYNC_POLL_MS = 20000;

const _sync = { enabled: false, revs: {}, synced: {}, databaseToken:null, access:null, platform:null, lastResult:null, chain: Promise.resolve(), polling: null, needRefresh: [] };

function syncSessionStamp() {
  return JSON.stringify([typeof dispatcherContext === 'function' ? dispatcherContext().identity : _sync.databaseToken,
    _sync.access?.user?.id, _sync.access?.user?.role, _sync.access?.readable, _sync.access?.writable, _sync.access?.fieldPermissions, _sync.access?.periodActions, _sync.access?.fuelActions, _sync.access?.procurementActions, _sync.access?.costActions, _sync.access?.repairActions, _sync.access?.calendarActions]);
}
function syncEnsureSession(stamp) {
  if (stamp !== syncSessionStamp()) throw Object.assign(new Error('База или права пользователя изменились во время операции. Обновите данные перед повтором.'),{code:'SESSION_CHANGED'});
}

function syncAssertDatabase(response) {
  if (!_sync.databaseToken || response?.databaseToken === _sync.databaseToken) return;
  _sync.enabled = false;
  if (_sync.polling) { clearInterval(_sync.polling); _sync.polling = null; }
  if (typeof _loadWriteBlocked !== 'undefined') _loadWriteBlocked = true;
  const error = new Error('База данных на сервере изменилась. Перезапустите программу и проверьте выбранную базу. Текущие данные не объединялись с другой базой.');
  error.databaseChanged = true;
  throw error;
}

function syncKey(row, section) {
  if (!row || typeof row !== 'object') return null;
  if (row.id != null) return row.id;
  if (section && typeof PlatformIntegrity !== 'undefined') {
    const key = PlatformIntegrity.rowIdentity(section,row,0);
    return key.startsWith('@') ? null : key;
  }
  if (section === 'monthlyFuel' || !section && row.vehicleId != null && row.month != null)
    return 'monthlyFuel:'+JSON.stringify([row.vehicleId ?? '',row.month ?? '',row.cardNumber ?? '']);
  if (section === 'fuelCards' && row.number != null)
    return 'fuelCards:'+(String(row.number).replace(/\D/g,'') || String(row.number).trim().toUpperCase());
  return row.month ?? null;
}

// Слияние раздела: base — как было при последней синхронизации, local — наше
// сейчас, remote — на сервере сейчас. Результат: серверные данные плюс наши
// изменения относительно base.
function syncMerge(base, local, remote, choose, section) {
  base = base || []; local = local || []; remote = remote || [];
  const keyOf = row => syncKey(row,section);
  const keyed = rows => rows.every(row => keyOf(row) != null) && new Set(rows.map(keyOf)).size === rows.length;
  if (!keyed(base) || !keyed(local) || !keyed(remote)) {
    // Без ключей по записям слить нельзя: если мы меняли раздел — берём своё
    if (JSON.stringify(local) === JSON.stringify(base)) return remote;
    if (JSON.stringify(remote) === JSON.stringify(base) || JSON.stringify(local) === JSON.stringify(remote)) return local;
    return syncConflictValue({key:'section',field:'Весь раздел',base,local,remote},choose);
  }
  const bMap = new Map(base.map(r => [keyOf(r), r]));
  const lMap = new Map(local.map(r => [keyOf(r), r]));
  const out = new Map(remote.map(r => [keyOf(r), r]));
  lMap.forEach((l, k) => {
    const b = bMap.get(k);
    if (!b) {
      const r=out.get(k);
      out.set(k,r&&JSON.stringify(r)!==JSON.stringify(l)?syncConflictValue({key:k,field:'Запись',base:null,local:l,remote:r},choose):l);return;
    }
    if (JSON.stringify(l) === JSON.stringify(b)) return;       // не трогали
    const r = out.get(k);
    if (!r) { const value=syncConflictValue({key:k,field:'Удаление на сервере',base:b,local:l,remote:null},choose);if(value!=null)out.set(k,value);return; }
    const m = Object.assign({}, r);                            // правили оба — наши поля поверх
    new Set([...Object.keys(l), ...Object.keys(b)]).forEach(f => {
      if (JSON.stringify(l[f]) !== JSON.stringify(b[f])) {
        const conflict=JSON.stringify(r[f])!==JSON.stringify(b[f])&&JSON.stringify(r[f])!==JSON.stringify(l[f]);
        const value=conflict?syncConflictValue({key:k,field:f,base:b[f],local:l[f],remote:r[f]},choose):l[f];
        if(value===undefined)delete m[f];else m[f]=value;
      }
    });
    out.set(k, m);
  });
  bMap.forEach((b,k)=>{if(!lMap.has(k)){const r=out.get(k);if(r&&JSON.stringify(r)!==JSON.stringify(b)){const value=syncConflictValue({key:k,field:'Локальное удаление',base:b,local:null,remote:r},choose);if(value!=null)out.set(k,value);else out.delete(k);}else out.delete(k);}});
  // Порядок: как на сервере, новые наши — в конце, в своём порядке
  const order = remote.map(keyOf).filter(k => out.has(k));
  local.forEach(r => { const k = keyOf(r); if (!order.includes(k) && out.has(k)) order.push(k); });
  return order.map(k => out.get(k));
}

function syncConflictValue(conflict,choose){if(choose)return choose(conflict);const error=new Error('Требуется решение конфликта: '+conflict.key+' · '+conflict.field);error.syncConflict=conflict;throw error;}
async function syncResolveMerge(section,base,local,remote){
  const conflicts=[];
  syncMerge(base,local,remote,c=>{conflicts.push(c);return c.remote;},section);
  if(!conflicts.length)return syncMerge(base,local,remote,undefined,section);
  if(typeof wfShowDialog!=='function')throw Error('Конфликт данных. Откройте программу заново для выбора версии.');
  const resolution=await new Promise(resolve=>{
    wfShowDialog('Совместное изменение · '+(SYNC_NAMES[section]||section),`<p>Выберите значение каждого поля. Остальные изменения объединятся автоматически.</p><form id="syncConflictForm">${conflicts.map((c,i)=>`<article class="wf-card"><strong>${htmlEsc(c.key)} · ${htmlEsc(c.field)}</strong><details><summary>Было</summary><pre>${htmlEsc(JSON.stringify(c.base,null,2))}</pre></details><div class="wf-grid"><div><b>Моя версия</b><pre>${htmlEsc(JSON.stringify(c.local,null,2))}</pre></div><div><b>На сервере</b><pre>${htmlEsc(JSON.stringify(c.remote,null,2))}</pre></div></div><select name="choice${i}" required><option value="">Выберите версию</option><option value="local">Моя версия</option><option value="remote">На сервере</option></select></article>`).join('')}<button class="btn btn-primary">Объединить и сохранить</button></form>`);
    const modal=document.getElementById('wfModal');let settled=false;const finish=value=>{if(settled)return;settled=true;observer.disconnect();resolve(value);};const observer=new MutationObserver(()=>{if(!modal.classList.contains('open')||!modal.isConnected)finish(null);});observer.observe(modal,{attributes:true,attributeFilter:['class']});observer.observe(document.body,{childList:true});
    document.getElementById('syncConflictForm').onsubmit=e=>{e.preventDefault();const fd=new FormData(e.target);finish(conflicts.map((_,i)=>fd.get('choice'+i)));closeModal('wfModal');};
  });
  if(!resolution)throw Error('Сохранение отменено: конфликт требует решения');
  let index=0;return syncMerge(base,local,remote,c=>c[resolution[index++]],section);
}

async function syncLoad() {
  if (!window.electronAPI || !window.electronAPI.readSnapshot) return null;
  const raw = await window.electronAPI.readSnapshot();
  if (!raw) return null;
  const snap = JSON.parse(raw);
  if (!snap || !snap.data) return null;
  _sync.enabled = false;
  _sync.revs = {};
  _sync.synced = {};
  _sync.databaseToken = typeof snap.databaseToken === 'string' ? snap.databaseToken : null;
  _sync.access=snap.access||null;
  _sync.platform=snap.platform?.apiVersion === 1 ? { ...snap.platform } : null;
  if(typeof wfInitData==='function')wfInitData(snap.data);
  if (snap.revisions) {
    _sync.enabled = true;
    _sync.revs = Object.assign({}, snap.revisions);
  }
  SYNC_SECTIONS.forEach(n => { _sync.synced[n] = JSON.stringify(snap.data[n] || []); });
  return snap.data;
}

// Сохранения идут строго по очереди — иначе два быстрых сохранения
// отправили бы одну и ту же версию и поссорились друг с другом
function syncSave(d, options) {
  const stamp=syncSessionStamp();
  const p = _sync.chain.then(async () => {
    syncEnsureSession(stamp);
    const revs = { ..._sync.revs }, synced = { ..._sync.synced };
    let saved = false;
    try { saved = await syncSaveNow(d, options, stamp); return saved; }
    finally {
      // A failed merge must not turn the old form into a new change relative
      // to a newer server baseline when the user retries the same operation.
      if (!saved && stamp === syncSessionStamp()) { _sync.revs = revs; _sync.synced = synced; }
    }
  });
  _sync.chain = p.catch(() => false);
  return p;
}

async function syncSaveNow(d, options, stamp = syncSessionStamp()) {
  _sync.lastResult=null;
  const requiredCanonical = options && options.requiredCanonicalSections || [];
  if (!Array.isArray(requiredCanonical) || requiredCanonical.some(name => !SYNC_SECTIONS.includes(name)))
    throw new Error('Некорректный список разделов для подтверждённого сохранения.');
  let cur = {};
  const changedNow = () => SYNC_SECTIONS.filter(n => {
    cur[n] = JSON.stringify(d[n] || []);
    return cur[n] !== _sync.synced[n];
  });
  let changed = changedNow();
  if (!changed.length) return true;
  const mergedNames = new Set();
  for (let attempt = 0; attempt < 4; attempt++) {
    syncEnsureSession(stamp);
    const payload = { base: {}, sections: {}, ...(options?.operation ? {operation:options.operation} : {}), ...(_sync.databaseToken ? {databaseToken:_sync.databaseToken} : {}) };
    changed.forEach(n => { payload.base[n] = _sync.revs[n] || 0; payload.sections[n] = d[n] || []; });
    // A concurrently changed business calendar must invalidate a reviewed wall
    // time even when the caller is not writing the calendar section itself.
    if(changed.some(name=>name==='dispatchJobs'||name==='workOrders'))payload.base.appMeta=_sync.revs.appMeta||0;
    const res = await window.electronAPI.writeSections(JSON.stringify(payload));
    syncEnsureSession(stamp);
    if (res && (res.databaseToken != null || res.ok || res.conflicts || res.databaseChanged)) syncAssertDatabase(res);
    if (res && res.unsupported) {
      if (options?.requireOperationReceipt) throw new Error('Хранилище перестало поддерживать подтверждение операций. Загрузите базу заново перед сохранением.');
      if (requiredCanonical.length) throw new Error('Сервер не поддерживает подтверждённое сохранение актов. Обновите сервер перед проведением или аннулированием.');
      // Сервер старой версии — сохраняем по-старому, целиком
      _sync.enabled = false;
      const legacy=await window.electronAPI.writeData(JSON.stringify(_sync.databaseToken ? {databaseToken:_sync.databaseToken,data:d} : d));
      syncEnsureSession(stamp); return legacy === true;
    }
    if (res && res.ok) {
      if (options?.operation && (options.requireOperationReceipt || res.operationReceipt) &&
          (!res.operationReceipt || res.operationReceipt.id !== options.operation.id || !['committed','replayed'].includes(res.operationReceipt.status)))
        throw Object.assign(new Error('Хранилище не подтвердило именно эту операцию. Обновите данные и проверьте историю.'),{code:'OPERATION_ACK_REQUIRED'});
      if (requiredCanonical.some(name => !Array.isArray(res.canonicalSections?.[name]) ||
        !Number.isSafeInteger(res.revisions?.[name]) || res.revisions[name] < 0))
        throw new Error('Сервер не подтвердил сохранённый акт. Обновите данные и проверьте журнал актов; повторное проведение пока не подтверждено.');
      changed.forEach(n => {
        _sync.synced[n] = cur[n];
        if (res.revisions && n in res.revisions) _sync.revs[n] = res.revisions[n];
      });
      // IPC structured cloning can retain shared objects between a source row
      // and audit.after. Each live section must own its JSON tree: editing the
      // next document must never mutate its earlier historical snapshot.
      const canonical=Object.fromEntries(Object.entries(res.canonicalSections||{}).map(([name,rows])=>[name,JSON.parse(JSON.stringify(rows))]));
      Object.entries(canonical).forEach(([name,rows])=>{d[name]=rows;_sync.synced[name]=JSON.stringify(rows);if(res.revisions&&name in res.revisions)_sync.revs[name]=res.revisions[name];});
      _sync.lastResult=res;
      if (mergedNames.size) {
        rebuildIndex();
        showToast('Сохранено вместе с правками другого пользователя: ' + [...mergedNames].map(n => SYNC_NAMES[n] || n).join(', '));
        syncRefreshView([...mergedNames]);
      }
      return true;
    }
    if (!res || !res.conflicts) { if (res && res.error) throw new Error(res.error); return false; }
    if(res.conflicts.includes('appMeta')&&changed.some(name=>name==='dispatchJobs'||name==='workOrders'))
      throw Object.assign(new Error('Учётный календарь изменился после проверки. Обновите данные и явно проверьте интервал заново.'),{code:'CALENDAR_CHANGED'});
    if (options && options.noMerge) throw new Error('База изменена другим пользователем. Обновите данные и проверьте строки заново.');
    // Кто-то успел поменять эти разделы — сливаем и пробуем снова
    for (const n of res.conflicts) {
      const remote = await window.electronAPI.readSection(n);
      syncEnsureSession(stamp);
      if (!remote) return false;
      syncAssertDatabase(remote);
      const base = JSON.parse(_sync.synced[n] || '[]');
      d[n] = await syncResolveMerge(n,base,d[n]||[],remote.rows||[]);
      syncEnsureSession(stamp);
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
  const stamp=syncSessionStamp();
  if (document.querySelector('.modal-overlay.open')) return;
  if (_sync.needRefresh.length) syncRefreshView([]);
  let revs;
  try { revs = await window.electronAPI.getRevisions(); if (stamp !== syncSessionStamp()) return; if (revs) syncAssertDatabase(revs); }
  catch (error) { if (stamp !== syncSessionStamp()) return; console.warn('[sync] ' + error.message); if (error.databaseChanged) showToast(error.message); return; }
  if (!revs) return;
  const stale = SYNC_SECTIONS.filter(n => (revs[n] || 0) !== (_sync.revs[n] || 0));
  if (!stale.length) return;
  // В очередь с сохранениями, чтобы не подтягивать посреди записи
  _sync.chain = _sync.chain.then(async () => {
    if (stamp !== syncSessionStamp()) return;
    if (document.querySelector('.modal-overlay.open')) return;
    const got = [];
    for (const n of stale) {
      const remote = await window.electronAPI.readSection(n);
      if (stamp !== syncSessionStamp()) return;
      if (!remote) continue;
      syncAssertDatabase(remote);
      if (document.querySelector('.modal-overlay.open')) return;
      const localStr = JSON.stringify(data[n] || []);
      if (localStr !== _sync.synced[n]) {
        // У нас есть несохранённые правки в этом разделе — сливаем
        try { data[n] = syncMerge(JSON.parse(_sync.synced[n] || '[]'), data[n] || [], remote.rows || [],undefined,n); }
        catch(e) { if(e.syncConflict){showToast('Есть конфликт в разделе «'+(SYNC_NAMES[n]||n)+'». При сохранении выберите значения.');continue;}throw e; }
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
  }).catch(e => { console.warn('[sync] ' + (e && e.message)); if (e?.databaseChanged) showToast(e.message); });
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
    else if (activeSection === 'workflows' || activeSection === 'dispatch') renderWorkflows();
    else if (activeSection === 'reports') renderReportsSection();
    else if (activeSection === 'fuelReport') renderFuelReport();
    else if (activeSection === 'costs') renderCostsSection();
    else if (activeSection === 'procurement') renderProcurementSection();
    else if (activeSection === 'system') renderPlatformSystem();
    else if (activeSection === 'drivers' || activeSection === 'operators') renderPersonnelSection();
    else if (activeSection === 'generators' && typeof renderGeneratorCards === 'function' && !selectedGeneratorId) renderGeneratorCards();
  } catch (e) { console.warn('[sync] перерисовка: ' + e.message); }
}

function syncStartPolling() {
  if (_sync.polling || !_sync.enabled) return;
  _sync.polling = setInterval(syncPoll, SYNC_POLL_MS);
}
