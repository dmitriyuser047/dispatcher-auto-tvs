/* Calculation runtime shared by the renderer and Node.js. No storage or DOM access. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DispatcherCore = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const tag = value => Object.prototype.toString.call(value);
  const forbidden = key => ['__proto__', 'prototype', 'constructor'].includes(key);
  function fail(code, message) { const error = new Error(message); error.name = 'DispatcherCoreError'; error.code = code; throw error; }
  function object(value, label) {
    if (!value || tag(value) !== '[object Object]') fail('INVALID_ARGUMENT', label + ': требуется объект');
  }
  // Canonical JSON fingerprints detect in-place edits without trusting array identities.
  // Object property order has no meaning; source array order is deliberately retained.
  function serialize(input) {
    const parents = new WeakSet();
    function scan(value, path, depth, inArray) {
      if (depth > 128) fail('INVALID_SNAPSHOT', 'Слишком глубокая структура: ' + path);
      if (value === undefined) return inArray ? null : undefined;
      if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) fail('INVALID_SNAPSHOT', 'Нечисловое значение: ' + path);
        return value;
      }
      if (typeof value !== 'object' || !Array.isArray(value) && tag(value) !== '[object Object]')
        fail('INVALID_SNAPSHOT', 'Неподдерживаемое значение: ' + path);
      if (parents.has(value)) fail('INVALID_SNAPSHOT', 'Циклическая структура: ' + path);
      if (Object.getOwnPropertySymbols(value).length || Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor => descriptor.get || descriptor.set))
        fail('INVALID_SNAPSHOT', 'Источник должен содержать только данные: ' + path);
      parents.add(value);
      let result;
      if (Array.isArray(value)) result = Array.from(value, (item, index) => scan(item, path + '[' + index + ']', depth + 1, true));
      else {
        result = {};
        Object.keys(value).sort().forEach(key => {
          if (forbidden(key)) fail('INVALID_SNAPSHOT', 'Недопустимое поле: ' + path + '.' + key);
          const child = scan(value[key], path + '.' + key, depth + 1, false);
          if (child !== undefined) result[key] = child;
        });
      }
      parents.delete(value); return result;
    }
    return JSON.stringify(scan(input, 'snapshot', 0, false));
  }
  function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(freeze); Object.freeze(value);
    }
    return value;
  }
  // Results may contain sets/maps (fuel lots and card sets). Preserve these while
  // severing all references to both the live database and the private cached value.
  function copy(value, seen) {
    if (value == null || typeof value !== 'object') {
      if (typeof value === 'function' || typeof value === 'symbol') fail('INVALID_RESULT', 'Расчёт вернул неподдерживаемое значение');
      if (typeof value === 'number' && !Number.isFinite(value)) fail('INVALID_RESULT', 'Расчёт вернул нечисловой результат');
      return value;
    }
    seen = seen || new Map(); if (seen.has(value)) return seen.get(value);
    const kind = tag(value);
    let result;
    if (kind === '[object Map]') {
      result = new Map(); seen.set(value, result); value.forEach((v, k) => result.set(copy(k, seen), copy(v, seen))); return result;
    }
    if (kind === '[object Set]') {
      result = new Set(); seen.set(value, result); value.forEach(v => result.add(copy(v, seen))); return result;
    }
    if (kind === '[object Date]') return new Date(value.getTime());
    if (!Array.isArray(value) && kind !== '[object Object]') fail('INVALID_RESULT', 'Расчёт вернул неподдерживаемый тип');
    result = Array.isArray(value) ? new Array(value.length) : {}; seen.set(value, result);
    Object.keys(value).forEach(key => Object.defineProperty(result, key, { value: copy(value[key], seen), enumerable: true, configurable: true, writable: true }));
    return result;
  }
  function contentSize(value, seen) {
    if (typeof value === 'string') return value.length;
    if (value == null) return 4;
    if (typeof value !== 'object') return 16;
    seen = seen || new Set(); if (seen.has(value)) return 0; seen.add(value);
    if (tag(value) === '[object Map]') { let size = 2; value.forEach((v, k) => { size += contentSize(k, seen) + contentSize(v, seen); }); return size; }
    if (tag(value) === '[object Set]') { let size = 2; value.forEach(v => { size += contentSize(v, seen); }); return size; }
    return Object.keys(value).reduce((size, key) => size + key.length + 4 + contentSize(value[key], seen), 2);
  }
  function readable(value) {
    if (value == null) return null;
    if (!Array.isArray(value) || value.some(section => typeof section !== 'string')) fail('INVALID_ACCESS', 'Проверьте список доступных разделов');
    return [...new Set(value)].sort();
  }
  function createEngine(configuration) {
    configuration = configuration == null ? {} : configuration; object(configuration, 'Настройки ядра');
    const maximum = configuration.maxEntries == null ? 16 : configuration.maxEntries;
    if (!Number.isInteger(maximum) || maximum < 0 || maximum > 64) fail('INVALID_CONFIGURATION', 'Размер кеша должен быть от 0 до 64');
    const budget = configuration.maxCacheCharacters == null ? 8000000 : configuration.maxCacheCharacters;
    if (!Number.isInteger(budget) || budget < 0 || budget > 64000000) fail('INVALID_CONFIGURATION', 'Проверьте ограничение объёма кеша');
    if (configuration.fingerprint != null && typeof configuration.fingerprint !== 'function') fail('INVALID_CONFIGURATION', 'Отпечаток источника должен вычисляться функцией');
    const fingerprint = text => {
      const result = configuration.fingerprint ? configuration.fingerprint(text) : text;
      if (typeof result !== 'string' || !result) fail('INVALID_CONFIGURATION', 'Не получен отпечаток источника');
      return result;
    };
    const descriptors = configuration.modules || {}; object(descriptors, 'Модули ядра');
    const modules = new Map(), cache = new Map(), snapshots = new WeakMap();
    const counters = { queries: 0, hits: 0, calculations: 0, evictions: 0, failures: 0, uncached: 0, captures:0, sourceFingerprints:0, projectionHits:0, projectionEvictions:0 };
    let cachedCharacters = 0;
    Object.keys(descriptors).forEach(name => {
      const descriptor = descriptors[name];
      if (!/^[a-z][a-zA-Z0-9]*$/.test(name) || forbidden(name)) fail('INVALID_CONFIGURATION', 'Недопустимое имя модуля');
      object(descriptor, 'Модуль ' + name);
      if (typeof descriptor.calculate !== 'function' || !Array.isArray(descriptor.sections) || !descriptor.sections.length ||
        descriptor.sections.some(section => typeof section !== 'string' || !/^[a-z][a-zA-Z0-9]*$/.test(section) || forbidden(section)))
        fail('INVALID_CONFIGURATION', 'Проверьте расчёт и зависимости модуля ' + name);
      modules.set(name, { calculate: descriptor.calculate, sections: [...new Set(descriptor.sections)].sort(), version: String(descriptor.version || '1') });
    });
    function query(name, database, options, context, captured) {
      counters.queries++;
      try {
        if (!modules.has(name)) fail('UNKNOWN_MODULE', 'Модуль расчёта не подключён: ' + String(name));
        object(database, 'Данные'); options = options == null ? {} : options; context = context == null ? {} : context;
        object(options, 'Параметры расчёта'); object(context, 'Контекст расчёта');
        if (context.identity != null && typeof context.identity !== 'string') fail('INVALID_ACCESS', 'Проверьте идентификатор базы и пользователя');
        const module = modules.get(name), requested = readable(options.readable), permitted = readable(context.readable);
        const access = permitted === null ? requested : requested === null ? permitted : permitted.filter(section => requested.includes(section));
        const allowed = access === null ? null : new Set(access);
        const optionText = serialize(options), normalizedOptions = JSON.parse(optionText);
        if (access !== null) normalizedOptions.readable = access;
        else delete normalizedOptions.readable;
        const source = {};
        module.sections.forEach(section => {
          if (allowed && !allowed.has(section)) { source[section] = []; return; }
          if (database[section] != null && !Array.isArray(database[section])) fail('INVALID_SNAPSHOT', 'Раздел должен содержать массив: ' + section);
          source[section] = database[section] || [];
        });
        const projectionKey = JSON.stringify([name, access]);
        let projection = captured && captured.projections.get(projectionKey);
        if (projection) { captured.projections.delete(projectionKey);captured.projections.set(projectionKey,projection);counters.projectionHits++; }
        if (!projection) {
          const snapshotText = serialize(source);
          counters.sourceFingerprints++;
          projection = { source:captured ? freeze(source) : null, fingerprint:fingerprint(snapshotText), text:captured ? null : snapshotText };
          if (captured) {
            const cost=projectionKey.length+projection.fingerprint.length+module.sections.reduce((sum,name)=>sum+name.length+8,0);
            // Parameter-specific readable subsets must not grow an unbounded
            // side cache outside the result budget. Only small shallow plans
            // are retained; the caller owns the single immutable source.
            if (cost<=64000) {
              while(captured.projections.size&&(captured.projections.size>=32||captured.projectionCharacters+cost>64000)){
                const oldest=captured.projections.keys().next().value;captured.projectionCharacters-=captured.projections.get(oldest).cost;captured.projections.delete(oldest);counters.projectionEvictions++;
              }
              projection.cost=cost;captured.projections.set(projectionKey,projection);captured.projectionCharacters+=cost;
            }
          }
        }
        // Application engines supply the existing SHA-256 implementation. The
        // key no longer contains another JSON-escaped copy of every source row.
        const key = JSON.stringify([name, module.version, context.identity || '', access, serialize(normalizedOptions), projection.fingerprint]);
        if (cache.has(key)) {
          counters.hits++;
          const cached = cache.get(key); cache.delete(key); cache.set(key, cached);
          return copy(cached.value);
        }
        const snapshot = projection.source || freeze(JSON.parse(projection.text));
        const result = module.calculate(snapshot, freeze(normalizedOptions));
        if (result && typeof result.then === 'function') fail('ASYNC_RESULT', 'Модуль должен возвращать готовый расчёт');
        const stored = copy(result); counters.calculations++;
        // A few huge periods must not consume an unbounded cache. This is a
        // content-character budget, not an assertion about JavaScript heap bytes.
        const cost = key.length + contentSize(stored);
        if (maximum && cost <= budget) {
          cache.set(key, { value: stored, cost }); cachedCharacters += cost;
          while (cache.size > maximum || cachedCharacters > budget) {
            const oldest = cache.keys().next().value;
            cachedCharacters -= cache.get(oldest).cost; cache.delete(oldest); counters.evictions++;
          }
        } else counters.uncached++;
        return copy(stored);
      } catch (error) { counters.failures++; throw error; }
    }
    function capture(database, context) {
      object(database, 'Данные');context = context == null ? {} : context;object(context, 'Контекст расчёта');
      if (context.identity != null && typeof context.identity !== 'string') fail('INVALID_ACCESS', 'Проверьте идентификатор базы и пользователя');
      const access = readable(context.readable), allowed = access === null ? null : new Set(access), source = {};
      for (const module of modules.values()) for (const section of module.sections) {
        if (own(source,section)) continue;
        if (allowed && !allowed.has(section)) {source[section]=[];continue;}
        if (database[section] != null && !Array.isArray(database[section])) fail('INVALID_SNAPSHOT', 'Раздел должен содержать массив: ' + section);
        source[section]=database[section] || [];
      }
      const text=serialize(source), owned=freeze(JSON.parse(text));
      const sourceFingerprint=configuration.fingerprint ? fingerprint(text) : 'snapshot:'+String(counters.captures+1);
      const handle=Object.freeze({apiVersion:1,sourceFingerprint,identity:context.identity || '',sections:Object.freeze(Object.keys(source).sort())});
      snapshots.set(handle,{database:owned,context:freeze({identity:context.identity || '',...(access===null?{}:{readable:access})}),projections:new Map(),projectionCharacters:0});counters.captures++;
      return handle;
    }
    function querySnapshot(name, handle, options) {
      const captured=handle && snapshots.get(handle);
      if (!captured) fail('INVALID_SNAPSHOT','Используйте снимок, созданный этим экземпляром ядра');
      return query(name,captured.database,options,captured.context,captured);
    }
    return Object.freeze({
      query:(name,database,options,context)=>query(name,database,options,context),capture,querySnapshot,
      clear() { cache.clear(); cachedCharacters = 0; },
      stats() { return { ...counters, entries: cache.size, maxEntries: maximum, cachedCharacters, maxCacheCharacters: budget }; },
      describe() { return [...modules].map(([name, descriptor]) => ({ name, version: descriptor.version, sections: descriptor.sections.slice() })); },
    });
  }
  return Object.freeze({ apiVersion: 1, createEngine, cloneData:value=>JSON.parse(serialize(value)) });
});
