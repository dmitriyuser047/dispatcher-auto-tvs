/* The sole adapter between read-only calculations and the current application session. */
let _dispatcherRuntime = null;

function dispatcherLocalDate() {
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
  if (!_dispatcherRuntime) _dispatcherRuntime = DispatcherEngine.create({ maxEntries:16 });
  return _dispatcherRuntime.query(name, data, query, dispatcherContext());
}

function dispatcherInvalidate() {
  if (_dispatcherRuntime) _dispatcherRuntime.clear();
}

function dispatcherEngineStats() {
  return _dispatcherRuntime ? _dispatcherRuntime.stats() : null;
}
