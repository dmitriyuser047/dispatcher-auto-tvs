// One application-wide write gateway. UI forms keep their domain editors;
// the platform prepares, checks and records every save through the same bus.
let _platformRuntime = null, _platformRuntimeIdentity = null, _platformLastError = null;
let _platformPrepareActive=null,_platformPrepareSequence=0;
const _platformPrepareQueue=[],PLATFORM_PREPARE_LIMIT=8,PLATFORM_PREPARE_CHARACTERS=1048576;

function platformPrepareBackgroundStatus(){return {active:_platformPrepareActive?1:0,queued:_platformPrepareQueue.length,limit:PLATFORM_PREPARE_LIMIT};}
function platformPrepareAccessStamp(context){
  const list=value=>value==null?null:[...new Set(value)].sort();
  const procurement=context.procurementActions==null?null:{tank:list(context.procurementActions.tank),part:list(context.procurementActions.part)};
  return PlatformKernel.stableSerialize({identity:context.identity,actor:context.actor||null,policyStamp:context.policyStamp||null,readable:list(context.readable),writable:list(context.writable),periodActions:list(context.periodActions),fuelActions:list(context.fuelActions),procurementActions:procurement,costActions:list(context.costActions),repairActions:list(context.repairActions),calendarActions:list(context.calendarActions),printActions:list(context.printActions),importActions:list(context.importActions),calendar:context.calendar||null,fieldPermissions:context.fieldPermissions||null,blocked:!!context.blocked});
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
  const calendar=typeof BusinessCalendar==='object'?BusinessCalendar.resolve(data,new Date().toISOString()):null;
  return { identity:base.identity, readable:base.readable,
    ...(access?.policyStamp ? {policyStamp:access.policyStamp}:{}),
    ...(access?.accessPolicy ? {accessPolicy:JSON.parse(JSON.stringify(access.accessPolicy))}:{}),
    writable:access && Array.isArray(access.writable) ? access.writable.slice() : undefined,
    periodActions:access && Array.isArray(access.periodActions) ? access.periodActions.slice() : undefined,
    fuelActions:access && Array.isArray(access.fuelActions) ? access.fuelActions.slice() : undefined,
    procurementActions:access?.procurementActions?{tank:Array.isArray(access.procurementActions.tank)?access.procurementActions.tank.slice():[],part:Array.isArray(access.procurementActions.part)?access.procurementActions.part.slice():[]}:undefined,
    costActions:access&&Array.isArray(access.costActions)?access.costActions.slice():undefined,
    repairActions:access&&Array.isArray(access.repairActions)?access.repairActions.slice():undefined,
    calendarActions:access&&Array.isArray(access.calendarActions)?access.calendarActions.slice():undefined,
    ...(Array.isArray(access?.printActions)?{printActions:access.printActions.slice()}:{}),
    ...(Array.isArray(access?.importActions)?{importActions:access.importActions.slice()}:{}),
    calendar:calendar?{version:calendar.version,mode:calendar.mode,timeZone:calendar.timeZone,stamp:calendar.stamp}:undefined,
    fieldPermissions:access?.fieldPermissions || null,
    actor:user ? { id:user.id, name:user.name || user.id, role:user.role } : { id:'local', name:'Локальный пользователь', role:'admin' },
    revisions:typeof _sync === 'undefined' ? {} : { ..._sync.revs },
    today:calendar?.today||dispatcherLocalDate(),
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
    if(['dispatchJobs','workOrders'].some(name=>JSON.stringify(previous[name]||[])!==JSON.stringify(database[name]||[]))&&_sync.platform?.calendar!==1)
      throw platformPrepareError('UNSUPPORTED_CALENDAR','Подключение не поддерживает проверку учётного календаря. Загрузите данные из совместимой версии программы.');
    const result = await platformRuntime().run({ id:options?.operation?.id, previous, next:database, identity:context.identity,
      options:{ allowLegacy:true, ...(options || {}), requireOperationReceipt:!!_sync.platform?.operations } }, async plan => {
      if (!platformSameSession(context)) throw Object.assign(Error('База или пользователь изменились. Откройте форму заново.'),{code:'SESSION_CHANGED'});
      if(platformPrepareAccessStamp(platformSessionContext())!==platformPrepareAccessStamp(context))throw platformPrepareError('STALE_ACCESS','Права или учётный календарь изменились. Проверьте форму заново.');
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
function platformCapturePrintArchiveContext(){
  return {database:data,stamp:syncSessionStamp(),access:platformPrepareAccessStamp(platformSessionContext()),databaseToken:_sync.databaseToken,
    source:Object.fromEntries(['appMeta','auditLog'].map(name=>[name,JSON.stringify(data[name]||[])])),
    synced:Object.fromEntries(['appMeta','auditLog'].map(name=>[name,_sync.synced[name]||'[]']))};
}
function platformApplyPrintArchiveAck(result,captured){
  if(result?.archiveHeadChanged!==true)return {ok:true};
  try{
    if(!captured||captured.database!==data||captured.stamp!==syncSessionStamp()||captured.access!==platformPrepareAccessStamp(platformSessionContext())||captured.databaseToken!==_sync.databaseToken||result.databaseToken!==captured.databaseToken||_sync.platform?.documentPrint!==1)
      throw Error('База или права изменились во время выгрузки.');
    const canonical=result.canonicalSections,names=['appMeta','auditLog'];
    if(!canonical||Object.keys(canonical).some(name=>!names.includes(name))||names.some(name=>!Array.isArray(canonical[name])||!Number.isSafeInteger(result.revisions?.[name])||result.revisions[name]<(_sync.revs[name]||0)))throw Error('Не подтверждены версии архива печати.');
    PlatformContracts.validateSections(canonical,PlatformSchema.sections);
    if(names.some(name=>captured.source[name]!==captured.synced[name]||captured.source[name]!==JSON.stringify(data[name]||[])||captured.synced[name]!==(_sync.synced[name]||'[]')))throw Error('В связанных настройках или истории появились изменения.');
    const ordinary=rows=>rows.filter(row=>row.id!=='document-archive-head'&&row.kind!=='documentArchive');
    if(PlatformKernel.stableSerialize(ordinary(canonical.appMeta))!==PlatformKernel.stableSerialize(ordinary(data.appMeta||[])))throw Error('Настройки базы изменились на другом компьютере.');
    const baseline=platformSaveBaseline();
    for(const name of names){const rows=JSON.parse(JSON.stringify(canonical[name]));data[name]=rows;baseline[name]=JSON.parse(JSON.stringify(rows));_sync.synced[name]=JSON.stringify(rows);_sync.revs[name]=result.revisions[name];}
    if(typeof syncInstallScopeViews==='function')syncInstallScopeViews(result,names);
    _lastPersisted=JSON.stringify(baseline);scheduleLocalBackup(_lastPersisted);return {ok:true};
  }catch(error){
    _sync.needRefresh=[...new Set([...(_sync.needRefresh||[]),'appMeta','auditLog'])];
    return {ok:false,needsReload:true,code:'PRINT_ARCHIVE_RELOAD',error:error.message+' Сохранённый экземпляр не потерян; обновите данные перед следующей операцией.'};
  }
}
function platformCommandFailure(code,message,extra={}){return {ok:false,code,error:message,message,...extra};}
function platformCompactCommandResult(result){
  const retained={};
  for(const key of ['ok','unknown','queued','committed','needsReload','code','databaseToken'])if(Object.hasOwn(result,key))retained[key]=result[key];
  for(const key of ['error','message'])if(typeof result[key]==='string')retained[key]=result[key].slice(0,2000);
  if(result.operationReceipt)retained.operationReceipt=Object.fromEntries(['id','digest','status','at'].filter(key=>Object.hasOwn(result.operationReceipt,key)).map(key=>[key,result.operationReceipt[key]]));
  if(result.archive&&typeof result.archive.id==='string')retained.archive=Object.fromEntries(['id','snapshotFingerprint'].filter(key=>typeof result.archive[key]==='string').map(key=>[key,result.archive[key]]));
  return retained;
}
function platformCommandDocumentScope(command,source){
  if(command.type!=='DocumentAction')return null;
  const input=command.input,section=input.section,list=source[section]||[],candidates=[];
  if(input.payload)candidates.push(input.payload);
  const draft=input.draftId===undefined?null:(source.documentDrafts||[]).find(row=>row.id===input.draftId&&row.section===section);
  if(draft?.payload)candidates.push(draft.payload);
  const ids=new Set(),pending=[input.id,input.correctionOf?.id,draft?.correctionOf?.id].filter(value=>value!==undefined);
  while(pending.length&&ids.size<128){
    const id=pending.pop(),key=JSON.stringify(id);if(ids.has(key))continue;ids.add(key);
    for(const row of list.filter(row=>row.id===id)){candidates.push(row);if(row.lifecycle?.correctionOf?.section===section)pending.push(row.lifecycle.correctionOf.id);}
  }
  return {section,candidates,ids};
}
function platformCommandNeedsProcurement(command,source){
  if(command.type==='ProcurementAction')return true;
  const scope=platformCommandDocumentScope(command,source);if(!scope||!['tankIncomes','fuelMovements','partMovements'].includes(scope.section))return false;
  return scope.candidates.some(row=>Object.hasOwn(row,'procurementReceipt')||Object.hasOwn(row,'procurementReturn'))||(source.procurementOrders||[]).some(order=>order.procurement?.receiptRefs?.some(ref=>ref.section===scope.section&&scope.ids.has(JSON.stringify(ref.id))));
}
function platformCommandNeedsCostAccounting(command,source){
  if(command.type==='CostAction')return true;
  const valued=(section,id)=>(source[section]||[]).some(row=>row.id===id&&Object.hasOwn(row,'costValuation'));
  if(command.type==='IssueFuel')return valued('tanks',command.input.tankId)||valued(command.input.target.section,command.input.target.id);
  const scope=platformCommandDocumentScope(command,source);if(!scope)return false;
  if((source.costEntries||[]).some(row=>row.costAllocation?.source?.section===scope.section&&scope.ids.has(JSON.stringify(row.costAllocation.source.id))))return true;
  return scope.candidates.some(row=>{
    if(scope.section==='payments')return ['tankIncome','partReceipt'].includes(row.source);
    if(scope.section==='partMovements')return ['sum','unitCost','vatRate','vatAmount','grossSum'].some(field=>Object.hasOwn(row,field))||valued('parts',row.partId);
    if(scope.section==='tankIncomes')return valued('tanks',row.tankId);
    if(scope.section==='fuelMovements')return valued('tanks',row.fromTankId)||valued('tanks',row.toTankId);
    return false;
  });
}
function platformCommandNeedsRepairs(command,source){
  if(command.type==='RepairAction')return true;
  const scope=platformCommandDocumentScope(command,source);if(!scope)return false;
  return scope.section==='workOrders'||scope.section==='partMovements'&&scope.candidates.some(row=>row.workOrderId!==undefined&&row.workOrderId!==null&&row.workOrderId!==''||Object.hasOwn(row,'repairReturn'));
}
function platformCommandNeedsPersonnelPlanning(command,source){
  if(command.type==='AssignPerson'||command.type==='AcceptShift')return true;
  const scope=platformCommandDocumentScope(command,source);
  return !!scope&&(scope.section==='shiftReports'||scope.section==='dispatchJobs'&&scope.candidates.some(row=>row.driverId!==undefined&&row.driverId!==null&&row.driverId!==''||Object.hasOwn(row,'personnelRequirements')));
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
        if(command.type==='GeneratorMaintenanceAction'&&!_sync.platform?.negotiation?.selectedProfile?.capabilities?.some(item=>item.name==='generatorMaintenanceV1'&&item.version===1))
          throw platformPrepareError('UNSUPPORTED_GENERATOR_MAINTENANCE','Подключение не поддерживает график ТО ДЭС. Обновите основную программу.');
        if(command.type==='AssetInventoryAction'&&(!_sync.platform?.negotiation?.selectedProfile?.capabilities?.some(item=>item.name==='inventoryV1'&&item.version===1)||_sync.platform?.storageKind!=='sqlite'))
          throw platformPrepareError('UNSUPPORTED_ASSET_INVENTORY','Для инвентаризации нужна SQLite-база и совместимая версия сервера. Создайте отдельную обновлённую копию.');
        if(command.type==='PeriodAction'&&_sync.platform?.periods!==1)
          throw platformPrepareError('UNSUPPORTED_PERIODS','Подключение не поддерживает проверенное закрытие периодов. Загрузите данные из совместимой версии программы.');
        if((command.type==='FuelAction'||command.type==='DocumentAction'&&command.input.section==='tankIncomes')&&_sync.platform?.fuelOperations!==1)
          throw platformPrepareError('UNSUPPORTED_FUEL_OPERATIONS','Подключение не поддерживает проверенные операции с ёмкостями. Загрузите данные из совместимой версии программы.');
        if(platformCommandNeedsProcurement(command,source)&&_sync.platform?.procurement!==1)
          throw platformPrepareError('UNSUPPORTED_PROCUREMENT','Подключение не поддерживает связанные закупки и поставки. Загрузите данные из совместимой версии программы.');
        if(platformCommandNeedsCostAccounting(command,source)&&_sync.platform?.costAccounting!==1)
          throw platformPrepareError('UNSUPPORTED_COST_ACCOUNTING','Подключение не поддерживает проверенную оценку и распределение затрат. Загрузите данные из совместимой версии программы.');
        if(platformCommandNeedsRepairs(command,source)&&_sync.platform?.repairs!==1)
          throw platformPrepareError('UNSUPPORTED_REPAIRS','Подключение не поддерживает проверенный ремонтный процесс. Загрузите данные из совместимой версии программы.');
        if(command.type==='CalendarAction'&&_sync.platform?.calendar!==1)
          throw platformPrepareError('UNSUPPORTED_CALENDAR','Подключение не поддерживает учётный календарь. Загрузите данные из совместимой версии программы.');
        if(command.type==='PrintAction'&&_sync.platform?.documentPrint!==1)
          throw platformPrepareError('UNSUPPORTED_DOCUMENT_PRINT','Подключение не поддерживает сохранённые печатные редакции. Загрузите данные из совместимой версии программы.');
        if(command.type==='ImportAction'&&_sync.platform?.controlledImports!==1)
          throw platformPrepareError('UNSUPPORTED_CONTROLLED_IMPORTS','Подключение не поддерживает проверяемый импорт. Загрузите данные из совместимой версии программы.');
        if(platformCommandNeedsPersonnelPlanning(command,source)&&_sync.platform?.personnelPlanning!==1)
          throw platformPrepareError('UNSUPPORTED_PERSONNEL_PLANNING','Подключение не поддерживает планирование сотрудников. Загрузите данные из совместимой версии программы.');
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
        let canonical=typeof syncAuditDelta==='function'?syncAuditDelta(response,response.canonicalSections||{}):response.canonicalSections,revisions=response.revisions,scopeResponse=response;
        const archiveExtra=response.archiveHeadChanged===true&&_sync.platform?.documentPrint===1?['appMeta']:[];
        const requiredWrites=[...new Set([...writes,...archiveExtra])];
        const expected=[...new Set([...writes,...archiveExtra,'auditLog'])];
        if(!canonical||requiredWrites.some(name=>!Array.isArray(canonical[name]))){
          const raw=await window.electronAPI.readSnapshot({hello:typeof PlatformCompatibility==='undefined'?null:PlatformCompatibility.describe().hello});syncEnsureSession(stamp);
          const snapshot=typeof raw==='string'?JSON.parse(raw):raw;
          syncAssertDatabase(snapshot);guard();
          if(JSON.stringify(snapshot?.access||null)!==JSON.stringify(_sync.access||null))throw platformPrepareError('STALE_ACCESS','Права изменились. Загрузите базу заново.');
          canonical=Object.fromEntries(expected.filter(name=>Array.isArray(snapshot?.data?.[name])).map(name=>[name,snapshot.data[name]]));revisions=snapshot?.revisions;scopeResponse=snapshot;
        }
        if(!canonical||Object.keys(canonical).some(name=>!expected.includes(name))||requiredWrites.some(name=>!Array.isArray(canonical[name]))||Object.keys(canonical).some(name=>!Number.isSafeInteger(revisions?.[name])||revisions[name]<0))
          throw platformPrepareError('CANONICAL_ACK_REQUIRED','Операция сохранена, но её данные не удалось подтвердить. Загрузите базу заново.');
        PlatformContracts.validateSections(canonical,PlatformSchema.sections);guard();
        // Only acknowledged sections become persisted. Other unsaved local
        // editors keep their values and are absent from the backup baseline.
        for(const [name,rows]of Object.entries(canonical)){
          const copy=JSON.parse(JSON.stringify(rows));source[name]=copy;persisted[name]=JSON.parse(JSON.stringify(rows));
          _sync.synced[name]=JSON.stringify(rows);_sync.revs[name]=revisions[name];
        }
        if(response.auditDelta&&!canonical.auditLog){source.auditLog=JSON.parse(_sync.synced.auditLog||'[]');persisted.auditLog=JSON.parse(_sync.synced.auditLog||'[]');}
        if(typeof syncInstallScopeViews==='function')syncInstallScopeViews(scopeResponse,Object.keys(canonical));
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
  // A save can settle and leave the shared set while another editor flushes.
  // Retain operations already in flight so a rejected ACK still blocks close.
  const closingOperations=new Set(typeof _pendingSaveOperations!=='undefined'?[..._pendingSaveOperations]:[]);
  let ready=typeof frcFlush==='function'?await frcFlush():true;
  if(typeof personnelPlanningFlush==='function'&&!await personnelPlanningFlush())ready=false;
  if(typeof documentPrintFlush==='function'&&!await documentPrintFlush())ready=false;
  if(typeof generatorMaintenanceFlush==='function'&&!await generatorMaintenanceFlush())ready=false;
  if(typeof generatorMaintenancePrintFlush==='function'&&!await generatorMaintenancePrintFlush())ready=false;
  if(typeof assetInventoryWorkspaceFlush==='function'&&!await assetInventoryWorkspaceFlush())ready=false;
  if(typeof accessPolicyFlush==='function'&&!await accessPolicyFlush())ready=false;
  if(typeof reviewedImportFlush==='function'&&!await reviewedImportFlush())ready=false;
  if(typeof reestrImportFlush==='function'&&!await reestrImportFlush())ready=false;
  if(ready)document.activeElement?.blur();
  while(closingOperations.size||typeof _pendingSaveOperations!=='undefined'&&_pendingSaveOperations.size){
    if(typeof _pendingSaveOperations!=='undefined')for(const operation of _pendingSaveOperations)closingOperations.add(operation);
    const results=await Promise.allSettled([...closingOperations]);closingOperations.clear();
    if(results.some(result=>result.status!=='fulfilled'||result.value!==true))ready=false;
  }
  if(typeof frcHasPendingEdits==='function'&&frcHasPendingEdits())ready=false;
  if(typeof personnelPlanningHasPendingEdits==='function'&&personnelPlanningHasPendingEdits())ready=false;
  if(typeof documentPrintHasPendingEdits==='function'&&documentPrintHasPendingEdits())ready=false;
  if(typeof generatorMaintenanceHasPendingEdits==='function'&&generatorMaintenanceHasPendingEdits())ready=false;
  if(typeof generatorMaintenancePrintHasPendingEdits==='function'&&generatorMaintenancePrintHasPendingEdits())ready=false;
  if(typeof assetInventoryWorkspaceHasPendingEdits==='function'&&assetInventoryWorkspaceHasPendingEdits())ready=false;
  if(typeof reviewedImportHasPendingEdits==='function'&&reviewedImportHasPendingEdits())ready=false;
  if(typeof reestrImportHasPendingEdits==='function'&&reestrImportHasPendingEdits())ready=false;
  return ready;
}
if(window.electronAPI?.onPrepareClose)window.electronAPI.onPrepareClose(async nonce=>{
  let ready=false;try{ready=await platformFlushForClose();}catch{}
  try{await window.electronAPI.finishClose({nonce,ready});}catch{}
});
