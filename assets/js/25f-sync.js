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
// Для записи нужны согласованный протокол и явные исходные версии разделов.

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

const _sync = { enabled: false, revs: {}, synced: {}, scopeViews: {}, databaseToken:null, access:null, platform:null, lastResult:null, chain: Promise.resolve(), polling: null, needRefresh: [] };

function syncSessionStamp() {
  return JSON.stringify([typeof dispatcherContext === 'function' ? dispatcherContext().identity : _sync.databaseToken,
    _sync.access?.user?.id, _sync.access?.user?.role, _sync.access?.policyStamp, _sync.access?.readable, _sync.access?.writable, _sync.access?.fieldPermissions, _sync.access?.periodActions, _sync.access?.fuelActions, _sync.access?.procurementActions, _sync.access?.costActions, _sync.access?.repairActions, _sync.access?.calendarActions, _sync.access?.printActions, _sync.access?.importActions]);
}

// Only a full canonical projection supplies a write witness. Query pages never
// become the baseline of a replacement save.
function syncInstallScopeViews(response,names) {
  if(!response?.scopeViews)return;
  _sync.scopeViews ||= {};
  for(const name of names){
    const view=response.scopeViews[name];
    if(view && view.version===1 && view.policyStamp===_sync.access?.policyStamp && view.revision===_sync.revs[name] && /^sha256:[a-f0-9]{64}$/.test(view.visibleFingerprint))
      _sync.scopeViews[name]=JSON.parse(JSON.stringify(view));
    else delete _sync.scopeViews[name];
  }
}

// A compact ACK carries only freshly committed visible events. Apply it to the
// acknowledged baseline, never to client-generated audit hints or another rev.
function syncAuditDelta(response,canonical) {
  const delta=response?.auditDelta;
  if(delta===undefined)return canonical;
  const bad=()=>{throw Object.assign(Error('Некорректное подтверждение истории. Обновите данные.'),{code:'AUDIT_ACK_INVALID'});};
  if(!delta||delta.version!==1||!Number.isSafeInteger(delta.revision)||delta.revision<0||response.revisions?.auditLog!==delta.revision||Object.hasOwn(canonical,'auditLog'))bad();
  if(delta.invalidated===true){if(Object.keys(delta).some(key=>!['version','revision','invalidated'].includes(key)))bad();return canonical;}
  if(Object.keys(delta).some(key=>!['version','revision','baseRevision','appended'].includes(key))||!Number.isSafeInteger(delta.baseRevision)||delta.baseRevision<0||delta.revision!==delta.baseRevision+1||!Array.isArray(delta.appended)||delta.appended.length>2000)bad();
  if(delta.baseRevision!==(_sync.revs.auditLog||0))return canonical;
  const baseline=JSON.parse(_sync.synced.auditLog||'[]');if(!Array.isArray(baseline))bad();
  const rows=baseline.concat(JSON.parse(JSON.stringify(delta.appended)));
  if(typeof PlatformContracts!=='undefined')PlatformContracts.validateSections({auditLog:rows},SYNC_SECTIONS);
  return {...canonical,auditLog:rows};
}

function syncEnsureSession(stamp) {
  if (stamp !== syncSessionStamp()) throw Object.assign(new Error('База или права пользователя изменились во время операции. Обновите данные перед повтором.'),{code:'SESSION_CHANGED'});
}

function syncEditingAllowed(){
  if(typeof _loadWriteBlocked!=='undefined'&&_loadWriteBlocked||_sync.platform?.negotiation&&_sync.platform.negotiation.writeCompatible!==true){showToast('Сейчас доступен только просмотр. Проверьте совместимость и подключение в «Состоянии программы».');return false;}
  return true;
}
function syncCompatibilityNotice(){
  if(typeof document==='undefined'||typeof document.getElementById!=='function')return;
  const notice=document.getElementById('compatibilityNotice'),profile=_sync.platform?.negotiation;if(!notice)return;
  notice.hidden=!profile||profile.writeCompatible===true;
  notice.textContent=notice.hidden?'':_sync.platform.needsSchemaUpgrade?'Только просмотр. Для этой базы нужна обновлённая копия в отдельном каталоге.':'Только просмотр. Клиент и сервер не подтвердили совместимость для записи. Проверьте версии программы и подключение в «Состоянии программы».';
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
  const raw = await window.electronAPI.readSnapshot({hello:typeof PlatformCompatibility==='undefined'?null:PlatformCompatibility.describe().hello});
  if (!raw) return null;
  const snap = JSON.parse(raw);
  if (!snap || !snap.data) return null;
  _sync.enabled = false;
  _sync.revs = {};
  _sync.synced = {};
  _sync.scopeViews = JSON.parse(JSON.stringify(snap.scopeViews || {}));
  _sync.databaseToken = typeof snap.databaseToken === 'string' ? snap.databaseToken : null;
  _sync.access=snap.access||null;
  _sync.platform=snap.platform?.apiVersion === 1 ? { ...snap.platform } : null;
  if(snap.readOnly||snap.platform?.legacyReadOnly||snap.platform?.negotiation&&snap.platform.negotiation.writeCompatible!==true){_loadWriteBlocked=true;_sync.platform={...(_sync.platform||{}),readOnly:true,scopedAccess:1};}
  syncCompatibilityNotice();
  if((typeof _loadWriteBlocked==='undefined'||!_loadWriteBlocked)&&typeof wfInitData==='function')wfInitData(snap.data);
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
    const revs = { ..._sync.revs }, synced = { ..._sync.synced }, scopeViews = { ...(_sync.scopeViews || {}) };
    let saved = false;
    try { saved = await syncSaveNow(d, options, stamp); return saved; }
    finally {
      // A failed merge must not turn the old form into a new change relative
      // to a newer server baseline when the user retries the same operation.
      if (!saved && stamp === syncSessionStamp()) { _sync.revs = revs; _sync.synced = synced; _sync.scopeViews = scopeViews; }
    }
  });
  _sync.chain = p.catch(() => false);
  return p;
}

async function syncSaveNow(d, options, stamp = syncSessionStamp()) {
  _sync.lastResult=null;
  if(!syncEditingAllowed())throw Object.assign(Error('Подключение доступно только для просмотра'),{code:'PROTOCOL_RENEGOTIATE'});
  const requiredCanonical = options && options.requiredCanonicalSections || [];
  if (!Array.isArray(requiredCanonical) || requiredCanonical.some(name => !SYNC_SECTIONS.includes(name)))
    throw new Error('Некорректный список разделов для подтверждённого сохранения.');
  const atomicSections=options?.atomicSections||[];
  if(!Array.isArray(atomicSections)||atomicSections.some(name=>!SYNC_SECTIONS.includes(name)))
    throw new Error('Некорректный список разделов атомарной проверки.');
  let cur = {};
  const changedNow = () => {
    const actual=SYNC_SECTIONS.filter(n=>{if(n==='auditLog'&&_sync.platform?.compactAck===1)return false;cur[n]=JSON.stringify(d[n]||[]);return cur[n]!==_sync.synced[n];});
    // Send reviewed read dependencies with their baseline versions as well.
    // An unchanged directory must still invalidate links reviewed before a concurrent edit.
    return actual.length?SYNC_SECTIONS.filter(name=>(name!=='auditLog'||_sync.platform?.compactAck!==1)&&(actual.includes(name)||atomicSections.includes(name))):[];
  };
  let changed = changedNow();
  if (!changed.length) {if(_sync.platform?.compactAck===1)d.auditLog=JSON.parse(_sync.synced.auditLog||'[]');return true;}
  const mergedNames = new Set();
  for (let attempt = 0; attempt < 4; attempt++) {
    syncEnsureSession(stamp);
    const payload = { base: {}, sections: {}, ...(options?.operation ? {operation:options.operation} : {}), ...(_sync.databaseToken ? {databaseToken:_sync.databaseToken} : {}) };
    changed.filter(n=>n!=='auditLog'||_sync.platform?.compactAck!==1).forEach(n => { payload.base[n] = _sync.revs[n] || 0; payload.sections[n] = d[n] || []; });
    if (_sync.access?.accessPolicy) {
      if (_sync.platform?.scopedAccess !== 1) throw Error('Сервер не поддерживает безопасное сохранение ограниченного представления');
      payload.scopeViews = Object.fromEntries(changed.map(name => {
        const view=_sync.scopeViews?.[name];
        if(!view || view.policyStamp!==_sync.access.policyStamp) throw Error('Загрузите полное представление раздела перед сохранением');
        return [name,view];
      }));
    }
    // A concurrently changed business calendar must invalidate a reviewed wall
    // time even when the caller is not writing the calendar section itself.
    if(changed.some(name=>name==='dispatchJobs'||name==='workOrders'))payload.base.appMeta=_sync.revs.appMeta||0;
    const res = await window.electronAPI.writeSections(JSON.stringify(payload));
    syncEnsureSession(stamp);
    if (res && (res.databaseToken != null || res.ok || res.conflicts || res.databaseChanged)) syncAssertDatabase(res);
    if (res && res.unsupported) {
      if (_sync.access?.accessPolicy) throw Error('Сервер не поддерживает безопасное сохранение ограниченных данных');
      if (options?.requireOperationReceipt) throw new Error('Хранилище перестало поддерживать подтверждение операций. Загрузите базу заново перед сохранением.');
      if (requiredCanonical.length) throw new Error('Сервер не поддерживает подтверждённое сохранение актов. Обновите сервер перед проведением или аннулированием.');
      throw Object.assign(Error('Сервер не поддерживает согласованную запись. Загрузите данные из совместимой версии программы.'),{code:'UNSUPPORTED_PROTOCOL'});
    }
    if (res && res.ok) {
      if (options?.operation && (options.requireOperationReceipt || res.operationReceipt) &&
          (!res.operationReceipt || res.operationReceipt.id !== options.operation.id || !['committed','replayed'].includes(res.operationReceipt.status)))
        throw Object.assign(new Error('Хранилище не подтвердило именно эту операцию. Обновите данные и проверьте историю.'),{code:'OPERATION_ACK_REQUIRED'});
      const acknowledged=syncAuditDelta(res,res.canonicalSections||{});
      if (requiredCanonical.some(name => name==='auditLog'&&res.auditDelta?false:!Array.isArray(acknowledged[name]) ||
        !Number.isSafeInteger(res.revisions?.[name]) || res.revisions[name] < 0))
        throw new Error('Сервер не подтвердил сохранённый акт. Обновите данные и проверьте журнал актов; повторное проведение пока не подтверждено.');
      changed.forEach(n => {
        _sync.synced[n] = cur[n];
        if (res.revisions && n in res.revisions) _sync.revs[n] = res.revisions[n];
      });
      // IPC structured cloning can retain shared objects between a source row
      // and audit.after. Each live section must own its JSON tree: editing the
      // next document must never mutate its earlier historical snapshot.
      const canonical=Object.fromEntries(Object.entries(acknowledged).map(([name,rows])=>[name,JSON.parse(JSON.stringify(rows))]));
      Object.entries(canonical).forEach(([name,rows])=>{d[name]=rows;_sync.synced[name]=JSON.stringify(rows);if(res.revisions&&name in res.revisions)_sync.revs[name]=res.revisions[name];});
      if(res.auditDelta&&!canonical.auditLog)d.auditLog=JSON.parse(_sync.synced.auditLog||'[]');
      syncInstallScopeViews(res, Object.keys(canonical));
      _sync.lastResult=res;
      if (mergedNames.size) {
        rebuildIndex();
        showToast('Сохранено вместе с правками другого пользователя: ' + [...mergedNames].map(n => SYNC_NAMES[n] || n).join(', '));
        syncRefreshView([...mergedNames]);
      }
      return true;
    }
    if (!res || !res.conflicts) { if (res && res.error) throw Object.assign(new Error(res.error),typeof res.code==='string'?{code:res.code}:{}); return false; }
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
      syncInstallScopeViews(remote,[n]);
      mergedNames.add(n);
    }
    if (mergedNames.has('reestrRows') && typeof reestrRows !== 'undefined') reestrRows = d.reestrRows;
    changed = changedNow();
    if (!changed.length) {if(_sync.platform?.compactAck===1)d.auditLog=JSON.parse(_sync.synced.auditLog||'[]');rebuildIndex(); syncRefreshView([...mergedNames]); return true; }
  }
  return false;
}

// Подтянуть чужие изменения
async function syncPoll() {
  const accessStamp=syncSessionStamp();
  if(window.electronAPI?.getDataCacheContext){
    try{
      const current=await window.electronAPI.getDataCacheContext();
      if(accessStamp!==syncSessionStamp())return;
      // Error properties do not survive Electron IPC/contextBridge. Decode only
      // this fixed, data-free result in the main world, after the session check.
      if(current&&typeof current==='object'&&Object.hasOwn(current,'unavailable')){
        const known=Object.hasOwn(current,'version')&&Reflect.ownKeys(current).length===2&&current.version===1&&['DB_BUSY','ACCESS_REVOKED'].includes(current.unavailable);
        const code=known?current.unavailable:'ACCESS_UNVERIFIED';
        throw Object.assign(Error(code==='DB_BUSY'?'База временно занята':code==='ACCESS_REVOKED'?'Доступ к серверу отозван':'Состояние подключения не подтверждено'),{code});
      }
      if(current?.mode==='client'){
        if(current.legacy){_loadWriteBlocked=true;return;}
        if(!/^sha256:[a-f0-9]{64}$/.test(current.policyStamp||'')||current.access?.policyStamp!==current.policyStamp)throw Object.assign(Error('Права сервера не подтверждены'),{code:'ACCESS_UNVERIFIED'});
        if(current.policyStamp!==_sync.access?.policyStamp||current.databaseToken!==_sync.databaseToken||_loadWriteBlocked||!_sync.enabled){
          syncClearAccessView('Права изменились. Загружаются доступные данные.');
          const fresh=await loadData();data=fresh;
          if(typeof reestrRows!=='undefined')reestrRows=data.reestrRows||[];
          rebuildIndex();syncRefreshView(SYNC_SECTIONS);return;
        }
      }
    }catch(error){
      if(accessStamp!==syncSessionStamp())return;
      if(error.code==='DB_BUSY'){console.warn('[sync access] '+error.message);return;}
      _loadWriteBlocked=true;localCacheKey=null;_sync.enabled=false;_sync.scopeViews={};
      if(error.code==='ACCESS_REVOKED'||[401,403].includes(error.status))syncClearAccessView('Доступ к серверу отозван. Данные скрыты.');
      console.warn('[sync access] '+error.message);return;
    }
  }
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
      syncInstallScopeViews(remote,[n]);
      got.push(n);
    }
    if (!got.length) return;
    if (got.includes('reestrRows') && typeof reestrRows !== 'undefined') reestrRows = data.reestrRows;
    rebuildIndex();
    showToast('Обновлено другим пользователем: ' + got.map(n => SYNC_NAMES[n] || n).join(', '));
    syncRefreshView(got);
  }).catch(e => { console.warn('[sync] ' + (e && e.message)); if (e?.databaseChanged) showToast(e.message); });
}

function syncClearAccessView(message){
  if(typeof assetInventoryWorkspaceRevoke==='function')assetInventoryWorkspaceRevoke();
  _loadWriteBlocked=true;_sync.enabled=false;_sync.revs={};_sync.synced={};_sync.scopeViews={};_sync.lastResult=null;_sync.needRefresh=[];
  _sync.access=null;_sync.databaseToken=null;_lastPersisted=null;localCacheKey=null;
  if(typeof _lsTimer!=='undefined'&&_lsTimer){clearTimeout(_lsTimer);_lsTimer=null;_lsPending=null;}
  data=Object.fromEntries(SYNC_SECTIONS.map(name=>[name,[]]));
  if(typeof reestrRows!=='undefined')reestrRows=[];
  document.querySelectorAll?.('.modal-overlay.open').forEach(modal=>modal.classList.remove('open'));
  const host=document.getElementById?.('mainContent');if(host){host.replaceChildren();const note=document.createElement('p');note.textContent=message;host.append(note);}
  rebuildIndex();
  for(const action of [typeof populateOrgSelect==='function'?populateOrgSelect:null,typeof renderVehicleList==='function'?renderVehicleList:null])if(action)action();
  showToast(message);
}

// Перерисовать текущий экран, но не мешать вводу: если открыто окно или
// курсор стоит в поле — отложить до следующей проверки
function syncRefreshView(names) {
  _sync.needRefresh = [...new Set([..._sync.needRefresh, ...names])];
  const busy = document.querySelector('.modal-overlay.open') ||
    (document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) &&
     document.getElementById('mainContent')?.contains(document.activeElement));
  if (busy) return;
  const pending = _sync.needRefresh;
  try {
    if (renderWorkspaceSection(activeSection)) {
      _sync.needRefresh = _sync.needRefresh.filter(name => !pending.includes(name));
      if (typeof unifiedRefreshNav === 'function') unifiedRefreshNav();
    }
  } catch (e) { console.warn('[sync] перерисовка: ' + e.message); }
}

function syncStartPolling() {
  if (_sync.polling || !_sync.enabled) return;
  _sync.polling = setInterval(syncPoll, SYNC_POLL_MS);
}
