/* The sole adapter between read-only calculations and the current application session. */
let _dispatcherRuntime = null;
let _dispatcherWorker = null, _dispatcherWorkerSource = null, _dispatcherWorkerSequence = 0, _dispatcherWorkerGeneration = 0;
const _dispatcherWorkerPending = new Map();
const _dispatcherPrepared = new Map();
let _dispatcherPreparedStamp = null, _dispatcherPreparedCharacters = 0, _dispatcherHealthCancel = null;

function dispatcherLocalDate() {
  if(typeof BusinessCalendar==='object'&&typeof data!=='undefined')return BusinessCalendar.resolve(data,new Date().toISOString()).today;
  if (typeof wfToday === 'function') return wfToday();
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dispatcherContext() {
  const sync = typeof _sync === 'undefined' ? null : _sync;
  const access = sync && sync.access;
  const settings = typeof _appSettings === 'undefined' ? null : _appSettings;
  const profile = settings && (settings.users || [])[settings.activeUser || 0];
  return {
    identity: JSON.stringify([
      typeof localCacheKey === 'string' ? localCacheKey : null,
      sync && sync.databaseToken || null,
      access && access.user && access.user.id || null,
      access && access.user && access.user.role || null,
      access && access.policyStamp || null,
      settings ? [settings.networkMode, settings.activeUser, profile && profile.dataDir,
        settings.remoteProtocol, settings.remoteHost, settings.remotePort] : null
    ]),
    readable: access && Array.isArray(access.readable) ? access.readable.slice() : undefined
  };
}

function dispatcherQuery(name, options) {
  if (options != null && (typeof options !== 'object' || Array.isArray(options)))
    throw Error('Параметры расчёта должны быть объектом');
  const query = { ...(options || {}) };
  // Resolve the moving date before constructing a cache key; yesterday's plan
  // must never be returned for an otherwise identical query after midnight.
  if (name === 'procurement' && !query.date) query.date = dispatcherLocalDate();
  if(['fuel','fuelAudit','writeoff','costs','costValuation','repairProcess','procurement'].includes(name)) { const prepared=dispatcherPreparedQuery(name,query);if(prepared!==null)return prepared; }
  if (!_dispatcherRuntime) _dispatcherRuntime = DispatcherEngine.create({ maxEntries:16 });
  return _dispatcherRuntime.query(name, data, query, dispatcherContext());
}

function dispatcherInvalidate() {
  if (_dispatcherRuntime) _dispatcherRuntime.clear();
  _dispatcherPrepared.clear();_dispatcherPreparedStamp=null;_dispatcherPreparedCharacters=0;
  _dispatcherHealthCancel?.('STALE_QUERY');
  dispatcherStopWorker('STALE_QUERY');
}

function dispatcherEngineStats() {
  return _dispatcherRuntime ? _dispatcherRuntime.stats() : null;
}

function dispatcherBackgroundNeeded() {
  if(Object.values(data).reduce((sum,rows)=>sum+(Array.isArray(rows)?rows.length:0),0)>=1000)return true;
  try{return JSON.stringify(data).length>=1024*1024;}catch{return true;}
}
function dispatcherWorkerError(code,message) { return Object.assign(Error(message),{code}); }
function dispatcherStopWorker(code='CANCELLED') {
  if(_dispatcherWorker)_dispatcherWorker.terminate();
  _dispatcherWorker=null;_dispatcherWorkerSource=null;_dispatcherWorkerGeneration++;
  for(const pending of _dispatcherWorkerPending.values()) {
    clearTimeout(pending.timer);pending.cleanup?.();
    pending.reject(dispatcherWorkerError(code,code==='STALE_QUERY'?'Источник расчёта изменился. Откройте расчёт заново.':'Расчёт отменён. Можно запустить его заново.'));
  }
  _dispatcherWorkerPending.clear();
}
function dispatcherAnalysisSource() {
  const readable=dispatcherContext().readable, allowed=readable&&new Set(readable);
  return Object.fromEntries([...new Set(Object.values(DispatcherEngine.sections).flat())]
    .filter(section=>!allowed||allowed.has(section)).map(section=>[section,data[section]||[]]));
}
function dispatcherAnalysisStamp() { return JSON.stringify([dispatcherContext(),dispatcherAnalysisSource()]); }
function dispatcherPreparedKey(name,options) { return name+':'+PlatformKernel.stableSerialize(options||{}); }
function dispatcherPreparedQuery(name,options) {
  if(!_dispatcherPrepared.size)return null;
  if(_dispatcherPreparedStamp!==dispatcherAnalysisStamp()) {
    _dispatcherPrepared.clear();_dispatcherPreparedStamp=null;_dispatcherPreparedCharacters=0;return null;
  }
  const entry=_dispatcherPrepared.get(dispatcherPreparedKey(name,options));
  return entry?structuredClone(entry.value):null;
}
function dispatcherRememberPrepared(name,options,value,stamp) {
  if(!['fuel','fuelAudit','writeoff','costs','costValuation','repairProcess','procurement'].includes(name))return;
  if(_dispatcherPreparedStamp!==stamp){_dispatcherPrepared.clear();_dispatcherPreparedCharacters=0;_dispatcherPreparedStamp=stamp;}
  const key=dispatcherPreparedKey(name,options),characters=JSON.stringify(value).length;
  if(characters>32*1024*1024)return;
  const previous=_dispatcherPrepared.get(key);if(previous){_dispatcherPreparedCharacters-=previous.characters;_dispatcherPrepared.delete(key);}
  while(_dispatcherPrepared.size&&(_dispatcherPrepared.size>=4||_dispatcherPreparedCharacters+characters>32*1024*1024)) {
    const oldest=_dispatcherPrepared.keys().next().value;_dispatcherPreparedCharacters-=_dispatcherPrepared.get(oldest).characters;_dispatcherPrepared.delete(oldest);
  }
  _dispatcherPrepared.set(key,{value:structuredClone(value),characters});_dispatcherPreparedCharacters+=characters;
}
function dispatcherWorkerRequest(message,signal) {
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(dispatcherWorkerError('CANCELLED','Расчёт отменён'));return;}
    if(_dispatcherWorkerPending.size>=16){reject(dispatcherWorkerError('QUERY_LIMIT','Дождитесь завершения расчётов'));return;}
    const requestId='analysis-'+(++_dispatcherWorkerSequence),generation=_dispatcherWorkerGeneration;
    const cancel=()=>dispatcherStopWorker('CANCELLED');
    const cleanup=()=>signal?.removeEventListener('abort',cancel);
    const timer=setTimeout(()=>dispatcherStopWorker('QUERY_TIMEOUT'),45000);
    _dispatcherWorkerPending.set(requestId,{resolve,reject,timer,cleanup,generation});
    signal?.addEventListener('abort',cancel,{once:true});
    try{_dispatcherWorker.postMessage({protocolVersion:1,...message,requestId,generation});}
    catch{dispatcherStopWorker('WORKER_FAILED');}
  });
}
async function dispatcherQueryAsync(name,options,{signal}={}) {
  if(options!=null&&(typeof options!=='object'||Array.isArray(options)))throw Error('Параметры расчёта должны быть объектом');
  const parameters=DispatcherCore.cloneData(options||{});if(name==='procurement'&&!parameters.date)parameters.date=dispatcherLocalDate();
  const context=dispatcherContext(),stamp=dispatcherAnalysisStamp();
  if(!_dispatcherWorkerSource||_dispatcherWorkerSource.stamp!==stamp) {
    dispatcherStopWorker('STALE_QUERY');
    if(typeof Worker!=='function')throw dispatcherWorkerError('WORKER_UNAVAILABLE','Фоновый расчёт недоступен в этом окне. Откройте программу заново.');
    const worker=new Worker('assets/core/engine-worker.js');_dispatcherWorker=worker;
    worker.onerror=event=>{event.preventDefault?.();if(_dispatcherWorker===worker)dispatcherStopWorker('WORKER_FAILED');};
    worker.onmessage=event=>{
      if(_dispatcherWorker!==worker)return;
      const reply=event.data,pending=_dispatcherWorkerPending.get(reply?.requestId);
      if(!pending||reply.protocolVersion!==1||reply.generation!==pending.generation)return;
      _dispatcherWorkerPending.delete(reply.requestId);clearTimeout(pending.timer);pending.cleanup();
      if(reply.ok!==true)pending.reject(dispatcherWorkerError(reply.error?.code||'CALCULATION_FAILED',reply.error?.message||'Не удалось выполнить расчёт'));
      else pending.resolve(reply);
    };
    const source={stamp,worker,ready:null,fingerprint:null};_dispatcherWorkerSource=source;
    source.ready=dispatcherWorkerRequest({type:'load',database:dispatcherAnalysisSource(),context},signal).then(reply=>{
      if(_dispatcherWorkerSource!==source||stamp!==dispatcherAnalysisStamp())throw dispatcherWorkerError('STALE_QUERY','Источник расчёта изменился');
      source.fingerprint=reply.sourceFingerprint;return source;
    });
  }
  const source=await _dispatcherWorkerSource.ready;
  if(source.stamp!==stamp||source.worker!==_dispatcherWorker)throw dispatcherWorkerError('STALE_QUERY','Источник расчёта изменился');
  const reply=await dispatcherWorkerRequest({type:'query',identity:context.identity,sourceFingerprint:source.fingerprint,name,options:parameters},signal);
  if(stamp!==dispatcherAnalysisStamp()||source!==_dispatcherWorkerSource||reply.identity!==context.identity||reply.sourceFingerprint!==source.fingerprint)
    throw dispatcherWorkerError('STALE_QUERY','Данные или права изменились во время расчёта. Запустите его заново.');
  dispatcherRememberPrepared(name,parameters,reply.value,stamp);
  return reply.value;
}
async function dispatcherHealthAsync({signal}={}) {
  _dispatcherHealthCancel?.('CANCELLED');
  const context={...dispatcherContext(),today:dispatcherLocalDate()},allowed=context.readable&&new Set(context.readable);
  const source=()=>Object.fromEntries(PlatformSchema.sections.filter(section=>!allowed||allowed.has(section)).map(section=>[section,data[section]]));
  const stamp=JSON.stringify([context,source()]),requestId='health-'+(++_dispatcherWorkerSequence);
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(dispatcherWorkerError('CANCELLED','Проверка отменена'));return;}
    if(typeof Worker!=='function'){reject(dispatcherWorkerError('WORKER_UNAVAILABLE','Фоновая проверка недоступна. Откройте программу заново.'));return;}
    const worker=new Worker('assets/core/health-worker.js');let finished=false;
    const cleanup=()=>{worker.terminate();clearTimeout(timer);signal?.removeEventListener('abort',cancel);if(_dispatcherHealthCancel===cancel)_dispatcherHealthCancel=null;};
    const cancel=(code='CANCELLED')=>{if(finished)return;finished=true;cleanup();reject(dispatcherWorkerError(typeof code==='string'?code:'CANCELLED','Проверка отменена. Можно запустить её заново.'));};
    _dispatcherHealthCancel=cancel;const timer=setTimeout(()=>cancel('QUERY_TIMEOUT'),45000);
    signal?.addEventListener('abort',cancel,{once:true});
    worker.onerror=event=>{event.preventDefault?.();cancel('WORKER_FAILED');};
    worker.onmessage=event=>{
      const reply=event.data;if(finished||reply?.requestId!==requestId||reply.protocolVersion!==1||reply.sourceStamp!==requestId)return;
      finished=true;cleanup();
      if(reply.ok!==true){reject(dispatcherWorkerError(reply.error?.code||'INSPECTION_FAILED',reply.error?.message||'Не удалось проверить данные'));return;}
      if(reply.identity!==context.identity||stamp!==JSON.stringify([{...dispatcherContext(),today:dispatcherLocalDate()},source()])) {
        reject(dispatcherWorkerError('STALE_QUERY','Данные или права изменились. Запустите проверку заново.'));return;
      }
      resolve(reply.value);
    };
    try{worker.postMessage({protocolVersion:1,type:'inspect',requestId,sourceStamp:requestId,source:source(),context});}catch{cancel('WORKER_FAILED');}
  });
}
function dispatcherRenderBackground(section,name,options,render) {
  const content=document.getElementById('mainContent'),panel=document.createElement('div');
  panel.className='platform-workspace';panel.innerHTML='<p role="status">Выполняется расчёт… Можно перейти в другой раздел.</p><button type="button" class="btn btn-ghost">Отменить</button>';
  content.replaceChildren(panel);
  const controller=new AbortController();panel.querySelector('button').onclick=()=>controller.abort();
  const current=()=>activeSection===section&&panel.isConnected;
  const calculation=name==='health'?dispatcherHealthAsync({signal:controller.signal}):dispatcherQueryAsync(name,options,{signal:controller.signal});
  void calculation.then(value=>{
    if(!current())return;
    if(name==='procurement'&&options.date!==dispatcherLocalDate()){render();return;}
    render(value);
  }).catch(error=>{
    if(!current())return;
    panel.querySelector('p').textContent=error.message;
    const button=panel.querySelector('button');button.textContent='Повторить';button.onclick=()=>render();
  });
}
