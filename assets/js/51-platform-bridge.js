// One application-wide write gateway. UI forms keep their domain editors;
// the platform prepares, checks and records every save through the same bus.
let _platformRuntime = null, _platformRuntimeIdentity = null, _platformLastError = null;

function platformSessionContext() {
  const base = dispatcherContext(), access = typeof _sync === 'undefined' ? null : _sync.access;
  const user = access?.user;
  return { identity:base.identity, readable:base.readable,
    writable:access && Array.isArray(access.writable) ? access.writable.slice() : undefined,
    actor:user ? { id:user.id, name:user.name || user.id, role:user.role } : { id:'local', name:'Локальный пользователь', role:'admin' },
    revisions:typeof _sync === 'undefined' ? {} : { ..._sync.revs },
    today:dispatcherLocalDate(),
    blocked:typeof _loadWriteBlocked !== 'undefined' && _loadWriteBlocked };
}
function platformRuntime() {
  const identity=platformSessionContext().identity;
  if (!_platformRuntime || _platformRuntimeIdentity !== identity) {
    _platformRuntimeIdentity=identity; _platformLastError=null;
    _platformRuntime = PlatformKernel.createRuntime({ getContext:platformSessionContext, maxReceipts:64 });
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
