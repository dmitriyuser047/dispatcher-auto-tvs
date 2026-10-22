// One application-wide write gateway. UI forms keep their domain editors;
// the platform prepares, checks and records every save through the same bus.
let _platformRuntime = null, _platformRuntimeIdentity = null, _platformLastError = null;
let _platformPrepareActive=null,_platformPrepareSequence=0;
const _platformPrepareQueue=[],PLATFORM_PREPARE_LIMIT=8,PLATFORM_PREPARE_CHARACTERS=1048576;

function platformPrepareBackgroundStatus(){return {active:_platformPrepareActive?1:0,queued:_platformPrepareQueue.length,limit:PLATFORM_PREPARE_LIMIT};}
function platformPrepareAccessStamp(context){
  const list=value=>value==null?null:[...new Set(value)].sort();
  return PlatformKernel.stableSerialize({identity:context.identity,actor:context.actor||null,readable:list(context.readable),writable:list(context.writable),fieldPermissions:context.fieldPermissions||null,blocked:!!context.blocked});
}
function platformPrepareError(code,message){return Object.assign(Error(message),{name:'PlatformKernelError',code});}
function platformPrepareGuard(job){
  const current=platformSessionContext();
  if(current.identity!==job.context.identity)throw platformPrepareError('STALE_IDENTITY','База или сеанс изменились. Откройте форму заново.');
  if(platformPrepareAccessStamp(current)!==job.access)throw platformPrepareError('STALE_ACCESS','Права или пользователь изменились. Откройте форму заново.');
  if(JSON.stringify(job.previous)!==job.previousText||JSON.stringify(job.next)!==job.nextText)throw platformPrepareError('STALE_COMMAND','Данные изменились во время подготовки. Повторите проверку формы.');
}
function platformDrainPrepareQueue(){
  if(_platformPrepareActive||!_platformPrepareQueue.length)return;
  const job=_platformPrepareQueue.shift();
  try{platformPrepareGuard(job);}catch(error){job.reject(error);platformDrainPrepareQueue();return;}
  if(typeof Worker!=='function'){job.reject(platformPrepareError('WORKER_UNAVAILABLE','Фоновая подготовка недоступна. Откройте программу заново.'));platformDrainPrepareQueue();return;}
  let worker;try{worker=new Worker('assets/core/transaction-worker.js');}catch{job.reject(platformPrepareError('WORKER_FAILED','Не удалось запустить фоновую подготовку'));platformDrainPrepareQueue();return;}
  _platformPrepareActive=job;job.worker=worker;
  let finished=false;
  const finish=(error,plan)=>{
    if(finished)return;finished=true;clearTimeout(timer);worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;try{worker.terminate();}catch{}
    if(_platformPrepareActive===job)_platformPrepareActive=null;
    if(error)job.reject(error);else job.resolve(plan);platformDrainPrepareQueue();
  };
  const timer=setTimeout(()=>finish(platformPrepareError('PREPARE_TIMEOUT','Подготовка не завершилась. Повторите сохранение.')),45000);
  worker.onerror=event=>{event.preventDefault?.();finish(platformPrepareError('WORKER_FAILED','Не удалось выполнить фоновую подготовку'));};
  worker.onmessageerror=()=>finish(platformPrepareError('WORKER_FAILED','Не удалось прочитать результат подготовки'));
  worker.onmessage=event=>{
    const reply=event.data;if(finished||reply?.protocolVersion!==1||reply.requestId!==job.requestId)return;
    try{
      platformPrepareGuard(job);
      if(reply.identity!==job.context.identity)throw platformPrepareError('STALE_IDENTITY','Результат подготовки относится к другой базе');
      if(reply.ok!==true){const detail=reply.error||{};throw Object.assign(platformPrepareError(detail.code||'PREPARE_FAILED',detail.message||'Не удалось подготовить сохранение'),detail);}
      if(reply.plan?.id!==job.context.id||reply.plan?.identity!==job.context.identity)throw platformPrepareError('MISMATCHED_PREPARE','План относится к другой операции');
      finish(null,reply.plan);
    }catch(error){finish(error);}
  };
  try{worker.postMessage({protocolVersion:1,type:'prepare',requestId:job.requestId,previous:job.previous,next:job.next,context:job.context});}
  catch{finish(platformPrepareError('WORKER_FAILED','Не удалось передать снимок для подготовки'));}
}
function platformPrepareInBackground(previous,next,context){
  const count=database=>Object.values(database||{}).reduce((total,value)=>total+(Array.isArray(value)?value.length:0),0);
  let previousText,nextText;
  try{previousText=JSON.stringify(previous);nextText=JSON.stringify(next);}
  catch{return PlatformKernel.prepare(previous,next,context);}
  if(Math.max(count(previous),count(next))<1000&&Math.max(previousText?.length||0,nextText?.length||0)<PLATFORM_PREPARE_CHARACTERS)return PlatformKernel.prepare(previous,next,context);
  return new Promise((resolve,reject)=>{
    if(_platformPrepareQueue.length+(_platformPrepareActive?1:0)>=PLATFORM_PREPARE_LIMIT){reject(platformPrepareError('PREPARE_LIMIT','Дождитесь завершения предыдущих сохранений'));return;}
    try{
      const captured=structuredClone(context),job={requestId:'prepare-'+(++_platformPrepareSequence),previous,next,context:captured,
        previousText,nextText,access:platformPrepareAccessStamp(captured),resolve,reject};
      _platformPrepareQueue.push(job);platformDrainPrepareQueue();
    }catch(error){reject(error);}
  });
}

function platformSessionContext() {
  const base = dispatcherContext(), access = typeof _sync === 'undefined' ? null : _sync.access;
  const user = access?.user;
  return { identity:base.identity, readable:base.readable,
    writable:access && Array.isArray(access.writable) ? access.writable.slice() : undefined,
    fieldPermissions:access?.fieldPermissions || null,
    actor:user ? { id:user.id, name:user.name || user.id, role:user.role } : { id:'local', name:'Локальный пользователь', role:'admin' },
    revisions:typeof _sync === 'undefined' ? {} : { ..._sync.revs },
    today:dispatcherLocalDate(),
    blocked:typeof _loadWriteBlocked !== 'undefined' && _loadWriteBlocked };
}
function platformRuntime() {
  const identity=platformSessionContext().identity;
  if (!_platformRuntime || _platformRuntimeIdentity !== identity) {
    _platformRuntimeIdentity=identity; _platformLastError=null;
    _platformRuntime = PlatformKernel.createRuntime({ getContext:platformSessionContext, maxReceipts:64, prepare:platformPrepareInBackground });
    _platformRuntime.subscribe(() => dispatcherInvalidate());
  }
  return _platformRuntime;
}
function platformRuntimeStatus() {
  const status = platformRuntime().status();
  return { ...status, lastError:_platformLastError ? { ..._platformLastError } : null };
}
function platformSaveBaseline() {
  let previous = {};
  try { previous = _lastPersisted ? JSON.parse(_lastPersisted) : {}; } catch { throw Error('Не удалось прочитать исходный снимок. Загрузите базу заново.'); }
  if (typeof _sync !== 'undefined' && _sync.enabled) {
    Object.entries(_sync.synced).forEach(([section,json]) => { previous[section]=JSON.parse(json); });
  }
  return previous;
}
function platformSameSession(context) { return context.identity === platformSessionContext().identity; }
async function platformExecuteSave(database, options, persist) {
  const context = platformSessionContext();
  let submitted;
  try {
    if (context.blocked) throw Error('Основная база не прочитана. Сначала восстановите подключение или базу.');
    if(typeof _sync!=='undefined'&&_sync.platform?.needsSchemaUpgrade)throw Object.assign(Error('База открыта только для чтения. В разделе «Состояние программы» создайте отдельную обновлённую копию; исходная база останется прежней.'),{code:'SCHEMA_UPGRADE_REQUIRED'});
    submitted = JSON.stringify(database);
    const previous = platformSaveBaseline();
    const result = await platformRuntime().run({ id:options?.operation?.id, previous, next:database, identity:context.identity,
      options:{ allowLegacy:true, ...(options || {}), requireOperationReceipt:!!_sync.platform?.operations } }, async plan => {
      if (!platformSameSession(context)) throw Object.assign(Error('База или пользователь изменились. Откройте форму заново.'),{code:'SESSION_CHANGED'});
      if (JSON.stringify(database) !== submitted) throw Object.assign(Error('Данные изменились в ожидании сохранения. Повторите проверку формы.'),{code:'STALE_DRAFT'});
      if (typeof _sync !== 'undefined') _sync.lastResult=null;
      const saved = await persist({ ...(options || {}), _platformManaged:true, requireOperationReceipt:!!_sync.platform?.operations, operation:{ id:plan.id } });
      if (saved !== true) throw Error('Сохранение не подтверждено. Проверьте подключение и состояние базы.');
      if (!platformSameSession(context)) throw Object.assign(Error('База изменилась во время сохранения. Проверьте результат в исходной базе.'),{code:'SESSION_CHANGED'});
      const ack = typeof _sync === 'undefined' ? null : _sync.lastResult;
      return ack?.ok ? { ...ack, identity:context.identity, operationId:ack.operationReceipt?.id } : true;
    });
    _platformLastError=null;
    return !!result;
  } catch (error) {
    // Domain editors often stage values in data before calling saveData. The
    // shared failure path restores only this session, never a newly opened DB.
    if (platformSameSession(context) && database === data && typeof restoreSaveBaseline === 'function') restoreSaveBaseline(database);
    const detail = (error.issues || []).slice(0,3).map(issue => issue.message).filter(Boolean).join('; ');
    const message = error.message + (detail && !error.message.includes(detail) ? ': '+detail : '');
    if (platformSameSession(context)) _platformLastError={ code:error.code || 'SAVE_FAILED', message, at:new Date().toISOString() };
    showToast('Сохранение остановлено: '+message);
    return false;
  }
}
const _platformCommandIntents=new Map(),PLATFORM_COMMAND_HISTORY=64;
function platformCommandFailure(code,message,extra={}){return {ok:false,code,error:message,message,...extra};}
function platformCompactCommandResult(result){
  const retained={};
  for(const key of ['ok','unknown','queued','committed','needsReload','code','databaseToken'])if(Object.hasOwn(result,key))retained[key]=result[key];
  for(const key of ['error','message'])if(typeof result[key]==='string')retained[key]=result[key].slice(0,2000);
  if(result.operationReceipt)retained.operationReceipt=Object.fromEntries(['id','digest','status','at'].filter(key=>Object.hasOwn(result.operationReceipt,key)).map(key=>[key,result.operationReceipt[key]]));
  return retained;
}
function platformExecuteCommand(value,options={}){
  let command,id,stamp,signature,entry;
  try{
    command=PlatformCommands.parseCommand(value);
    id=options.operationId||crypto.randomUUID();PlatformContracts.validateOperation({id});
    stamp=syncSessionStamp();signature=PlatformKernel.stableSerialize(command);
    entry=_platformCommandIntents.get(id);
    if(entry&&(entry.signature!==signature||entry.stamp!==stamp))
      return Promise.resolve(platformCommandFailure('COMMAND_ID_REUSED','Этот ID уже связан с другой командой или сеансом. Откройте форму заново.'));
    if(entry?.pending)return entry.pending;
    if(entry?.result?.ok===true)return Promise.resolve({...entry.result,alreadyApplied:true});
    if(!entry){
      if(_platformCommandIntents.size>=PLATFORM_COMMAND_HISTORY){
        const removable=[..._platformCommandIntents].find(([,item])=>!item.pending&&!item.result?.unknown&&!item.result?.queued);
        if(!removable)return Promise.resolve(platformCommandFailure('COMMAND_LIMIT','Разберите неподтверждённые операции перед новым сохранением.'));
        _platformCommandIntents.delete(removable[0]);
      }
      entry={signature,stamp,command};_platformCommandIntents.set(id,entry);
    }
    const source=data,context=platformSessionContext(),access=platformPrepareAccessStamp(context);
    const dependencies=PlatformCommands.dependencies(command),writes=PlatformCommands.footprint(command),names=[...new Set([...dependencies,'auditLog'])];
    const captured=Object.fromEntries(names.map(name=>[name,JSON.stringify(source[name]||[])]));
    const guard=()=>{
      syncEnsureSession(stamp);
      if(source!==data||platformPrepareAccessStamp(platformSessionContext())!==access)throw platformPrepareError('STALE_ACCESS','База, пользователь или права изменились. Откройте форму заново.');
      if(names.some(name=>JSON.stringify(source[name]||[])!==captured[name]))throw platformPrepareError('STALE_COMMAND','Исходные данные изменились во время операции. Обновите данные и проверьте результат в истории.');
    };
    const operation=_sync.chain.then(async()=>{
      let acknowledged=false,sent=false;
      try{
        guard();
        if(context.blocked||!_sync.enabled||!_sync.databaseToken)throw platformPrepareError('COMMAND_CONNECTION_REQUIRED','Для команды нужно подтверждённое подключение к основной базе.');
        if(_sync.platform?.apiVersion!==1||_sync.platform?.commands!==1||_sync.platform?.operations!==1||_sync.platform?.outbox!==1||!window.electronAPI?.executeCommand)
          throw platformPrepareError('UNSUPPORTED_COMMANDS','Подключение не поддерживает атомарные команды. Загрузите данные из совместимой версии программы.');
        if(names.some(name=>captured[name]!==(_sync.synced[name]||'[]')))
          throw platformPrepareError('UNSAVED_COMMAND_SOURCE','Сначала сохраните или отмените изменения исходных данных команды.');
        const persisted=platformSaveBaseline();
        if(!entry.envelope){
          const base=Object.fromEntries(dependencies.map(name=>[name,_sync.revs[name]||0]));
          entry.envelope={protocolVersion:1,databaseToken:_sync.databaseToken,base,operation:{id},command};
          entry.envelope.operation.digest=PlatformKernel.requestDigest(entry.envelope);
        }
        const envelope=entry.envelope;
        if(envelope.databaseToken!==_sync.databaseToken)throw platformPrepareError('STALE_IDENTITY','Команда относится к другой базе.');
        sent=true;const response=await window.electronAPI.executeCommand(JSON.stringify(envelope));
        syncEnsureSession(stamp);
        if(response&&(response.databaseToken||response.databaseChanged))syncAssertDatabase(response);
        if(response?.ok!==true)return {...platformCommandFailure(response?.code||'COMMAND_FAILED',response?.error||'Операция не подтверждена.'),...response,ok:false,unknown:response?.queued===true||response?.unknown===true};
        const receipt=response.operationReceipt;
        if(response.databaseToken!==envelope.databaseToken||receipt?.id!==id||receipt.digest!==envelope.operation.digest||!['committed','replayed'].includes(receipt.status))
          return platformCommandFailure('ACK_REQUIRED','Ответ не подтвердил именно эту команду. Проверьте её в очереди операций.',{unknown:true,queued:true});
        acknowledged=true;guard();
        let canonical=response.canonicalSections,revisions=response.revisions;
        const expected=[...new Set([...writes,'auditLog'])];
        if(!canonical||writes.some(name=>!Array.isArray(canonical[name]))){
          const raw=await window.electronAPI.readSnapshot();syncEnsureSession(stamp);
          const snapshot=typeof raw==='string'?JSON.parse(raw):raw;
          syncAssertDatabase(snapshot);guard();
          if(JSON.stringify(snapshot?.access||null)!==JSON.stringify(_sync.access||null))throw platformPrepareError('STALE_ACCESS','Права изменились. Загрузите базу заново.');
          canonical=Object.fromEntries(expected.filter(name=>Array.isArray(snapshot?.data?.[name])).map(name=>[name,snapshot.data[name]]));revisions=snapshot?.revisions;
        }
        if(!canonical||Object.keys(canonical).some(name=>!expected.includes(name))||writes.some(name=>!Array.isArray(canonical[name]))||Object.keys(canonical).some(name=>!Number.isSafeInteger(revisions?.[name])||revisions[name]<0))
          throw platformPrepareError('CANONICAL_ACK_REQUIRED','Операция сохранена, но её данные не удалось подтвердить. Загрузите базу заново.');
        PlatformContracts.validateSections(canonical,PlatformSchema.sections);guard();
        // Only acknowledged sections become persisted. Other unsaved local
        // editors keep their values and are absent from the backup baseline.
        for(const [name,rows]of Object.entries(canonical)){
          const copy=JSON.parse(JSON.stringify(rows));source[name]=copy;persisted[name]=JSON.parse(JSON.stringify(rows));
          _sync.synced[name]=JSON.stringify(rows);_sync.revs[name]=revisions[name];
        }
        _lastPersisted=JSON.stringify(persisted);scheduleLocalBackup(_lastPersisted);_sync.lastResult=response;
        rebuildIndex();dispatcherInvalidate();_platformLastError=null;
        return {...response,ok:true,canonicalSections:canonical,revisions};
      }catch(error){return platformCommandFailure(error.code||'COMMAND_FAILED',error.message,{...(acknowledged?{committed:true,needsReload:true}:sent?{unknown:true,queued:true}:{}),...(Array.isArray(error.issues)?{issues:error.issues}:{})});}
    });
    entry.pending=operation;_sync.chain=operation.then(()=>true,()=>false);
    const barrier=operation.then(result=>result.ok===true);
    if(typeof _pendingSaveOperations!=='undefined')_pendingSaveOperations.add(barrier);
    operation.then(result=>{entry.result=platformCompactCommandResult(result);entry.pending=null;if(typeof _pendingSaveOperations!=='undefined')_pendingSaveOperations.delete(barrier);});
    return operation;
  }catch(error){return Promise.resolve(platformCommandFailure(error.code||'INVALID_COMMAND',error.message));}
}
async function platformFlushForClose(){
  let ready=typeof frcFlush==='function'?await frcFlush():true;
  if(ready)document.activeElement?.blur();
  while(typeof _pendingSaveOperations!=='undefined'&&_pendingSaveOperations.size){
    const results=await Promise.allSettled([..._pendingSaveOperations]);
    if(results.some(result=>result.status!=='fulfilled'||result.value!==true))ready=false;
  }
  if(typeof frcHasPendingEdits==='function'&&frcHasPendingEdits())ready=false;
  return ready;
}
if(window.electronAPI?.onPrepareClose)window.electronAPI.onPrepareClose(async nonce=>{
  let ready=false;try{ready=await platformFlushForClose();}catch{}
  try{await window.electronAPI.finishClose({nonce,ready});}catch{}
});
