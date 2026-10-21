/* Portable transaction planning and serialized commands. No storage or application globals. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./platform-schema.js'), require('./platform-integrity.js'), require('./platform-contracts.js'),require('./precision-policy.js'));
  else root.PlatformKernel = factory(root.PlatformSchema, root.PlatformIntegrity, root.PlatformContracts,root.PrecisionPolicy);
})(typeof globalThis === 'object' ? globalThis : this, function (schema, integrity, contracts,precision) {
  'use strict';
  const tag = value => Object.prototype.toString.call(value);
  const plain = value => value != null && tag(value) === '[object Object]';
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  function fail(code, message, details) {
    const error = new Error(message); error.name = 'PlatformKernelError'; error.code = code;
    if (details !== undefined) error.details = details;
    throw error;
  }
  function commandError(error) {
    if (error instanceof Error && typeof error.code === 'string') return error;
    return Object.assign(new Error(error?.message || 'Сохранение не выполнено'), { name:'PlatformKernelError', code:'PERSIST_FAILED' });
  }
  function stableSerialize(input) {
    const parents = new WeakSet();
    function visit(value, depth, inArray) {
      if (depth > 128) fail('INVALID_SNAPSHOT', 'Слишком глубокая структура данных');
      if (value === undefined) return inArray ? null : undefined;
      if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) fail('INVALID_SNAPSHOT', 'Данные содержат неконечное число');
        return value;
      }
      if (!Array.isArray(value) && !plain(value)) fail('INVALID_SNAPSHOT', 'Допустимы только данные JSON');
      if (parents.has(value)) fail('INVALID_SNAPSHOT', 'Циклическая структура данных');
      parents.add(value);
      let out;
      if (Array.isArray(value)) out = Array.from(value, item => visit(item, depth + 1, true));
      else {
        out = {};
        Object.keys(value).sort().forEach(key => {
          if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('INVALID_SNAPSHOT', 'Недопустимое поле данных: ' + key);
          const child = visit(value[key], depth + 1, false);
          if (child !== undefined) out[key] = child;
        });
      }
      parents.delete(value); return out;
    }
    return JSON.stringify(visit(input, 0, false));
  }
  const clone = value => value === undefined ? undefined : JSON.parse(stableSerialize(value));
  function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  }
  // UTF-8 SHA-256 is synchronous and identical in the browser and Node backend.
  function sha256(text) {
    const bytes = [];
    for (const character of String(text)) {
      let code = character.codePointAt(0);
      if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
      if (code < 0x80) bytes.push(code);
      else if (code < 0x800) bytes.push(0xc0 | code >>> 6, 0x80 | code & 63);
      else if (code < 0x10000) bytes.push(0xe0 | code >>> 12, 0x80 | code >>> 6 & 63, 0x80 | code & 63);
      else bytes.push(0xf0 | code >>> 18, 0x80 | code >>> 12 & 63, 0x80 | code >>> 6 & 63, 0x80 | code & 63);
    }
    const bits = bytes.length * 8;
    bytes.push(0x80); while (bytes.length % 64 !== 56) bytes.push(0);
    for (const part of [Math.floor(bits / 0x100000000), bits >>> 0]) for (let shift = 24; shift >= 0; shift -= 8) bytes.push(part >>> shift & 255);
    const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19], w = new Int32Array(64);
    const rotate = (n, count) => n >>> count | n << 32 - count;
    for (let offset = 0; offset < bytes.length; offset += 64) {
      for (let i = 0; i < 16; i++) w[i] = bytes[offset + 4*i] << 24 | bytes[offset + 4*i+1] << 16 | bytes[offset + 4*i+2] << 8 | bytes[offset + 4*i+3];
      for (let i = 16; i < 64; i++) {
        const x = w[i-15], y = w[i-2], s0 = rotate(x,7) ^ rotate(x,18) ^ x >>> 3, s1 = rotate(y,17) ^ rotate(y,19) ^ y >>> 10;
        w[i] = w[i-16] + s0 + w[i-7] + s1 | 0;
      }
      let [a,b,c,d,e,f,g,j] = h;
      for (let i = 0; i < 64; i++) {
        const t1 = j + (rotate(e,6) ^ rotate(e,11) ^ rotate(e,25)) + (e & f ^ ~e & g) + k[i] + w[i] | 0;
        const t2 = (rotate(a,2) ^ rotate(a,13) ^ rotate(a,22)) + (a & b ^ a & c ^ b & c) | 0;
        j=g; g=f; f=e; e=d+t1|0; d=c; c=b; b=a; a=t1+t2|0;
      }
      [a,b,c,d,e,f,g,j].forEach((value, i) => { h[i] = h[i] + value | 0; });
    }
    return h.map(value => (value >>> 0).toString(16).padStart(8, '0')).join('');
  }
  function requestDigest(payload) {
    if(plain(payload)&&Object.prototype.hasOwnProperty.call(payload,'command')) {
      if(payload.protocolVersion!==1||!plain(payload.base)||!plain(payload.command)||Object.prototype.hasOwnProperty.call(payload,'sections'))
        fail('INVALID_ARGUMENT','Для отпечатка команды нужны её версия и исходные версии разделов');
      return 'sha256:'+sha256(stableSerialize({kind:'semantic-command',version:1,base:payload.base,command:payload.command}));
    }
    if (!plain(payload) || !plain(payload.base || {}) || !plain(payload.sections || {})) fail('INVALID_ARGUMENT', 'Для отпечатка нужны разделы и версии');
    const omitAudit = object => Object.fromEntries(Object.entries(object).filter(([name]) => name !== 'auditLog'));
    return 'sha256:' + sha256(stableSerialize({ base:omitAudit(payload.base || {}), sections:omitAudit(payload.sections || {}) }));
  }
  function accessList(value, name) {
    if (value == null) return null;
    if (!Array.isArray(value) || value.some(section => typeof section !== 'string')) fail('INVALID_CONTEXT', 'Некорректные права: ' + name);
    return [...new Set(value)].sort();
  }
  function validateContext(context) {
    if (!plain(context) || typeof context.identity !== 'string' || !context.identity || context.identity.length > 16384) fail('INVALID_CONTEXT', 'Укажите идентификатор базы и сеанса');
    if (context.blocked === true) fail('LOAD_BLOCKED', 'Основная база недоступна. Сначала восстановите подключение или загрузите её заново.');
    return { ...clone(context), readable:accessList(context.readable, 'readable'), writable:accessList(context.writable, 'writable') };
  }
  function rowChanges(name, before, after) {
    const identityField = schema.descriptors?.[name]?.identity?.field || (name === 'fuelPeriods' ? 'month' : 'id');
    function keyed(rows) {
      const seen = new Map();
      return new Map(rows.map((row, index) => {
        const value = row[identityField];
        const explicit = typeof value === 'string' && value !== '' || typeof value === 'number' && Number.isFinite(value);
        const basic = typeof integrity.rowIdentity === 'function' ? integrity.rowIdentity(name, row, index)
          : explicit ? identityField + ':' + stableSerialize(value) : 'row:' + index;
        const occurrence = seen.get(basic) || 0; seen.set(basic, occurrence + 1);
        return [basic + (occurrence ? ':duplicate:' + occurrence : ''), { row, recordId:explicit ? value : basic }];
      }));
    }
    const old = keyed(before), next = keyed(after), changes = [];
    for (const key of new Set([...old.keys(), ...next.keys()])) {
      const a = old.get(key), b = next.get(key);
      if (a && b && stableSerialize(a.row) === stableSerialize(b.row)) continue;
      const fields = [...new Set([...Object.keys(a?.row || {}), ...Object.keys(b?.row || {})])]
        .filter(field => stableSerialize(a?.row[field]) !== stableSerialize(b?.row[field])).sort();
      changes.push({ section:name, recordId:(b || a).recordId, key,
        action:!a ? 'create' : !b ? 'delete' : 'update', before:a?.row || null, after:b?.row || null, fields });
    }
    return changes;
  }
  function prepare(previous, next, context) {
    if (!schema || schema.apiVersion !== 1 || !integrity || integrity.apiVersion !== 1 || contracts?.apiVersion !== 1) fail('MODULE_UNAVAILABLE', 'Не загружены правила платформы');
    if (!plain(previous) || !plain(next)) fail('INVALID_ARGUMENT', 'Источник и изменения должны быть объектами');
    const ctx = validateContext(context);
    if (typeof ctx.id !== 'string' || !ctx.id || ctx.id.length > 200 || !/^[a-z0-9_.:-]+$/i.test(ctx.id)) fail('INVALID_OPERATION_ID', 'Некорректный ID операции');
    const prior = clone(previous), patch = clone(next), target = { ...prior, ...patch };
    const names = schema.sections;
    for (const name of new Set([...Object.keys(prior), ...Object.keys(patch)])) {
      if (!names.includes(name) && stableSerialize(prior[name]) !== stableSerialize(target[name])) fail('UNKNOWN_SECTION', 'Неизвестный раздел: ' + name, { section:name });
    }
    const sections = {}, sourceSnapshot = {}, base = {}, changed = [];
    for (const name of names) {
      const before = own(prior, name) ? prior[name] : [], after = own(target, name) ? target[name] : [];
      if (!Array.isArray(before) || !Array.isArray(after) || [...before,...after].some(row => !plain(row))) fail('INVALID_SECTION', 'Раздел должен содержать массив записей: ' + name, { section:name });
      if (stableSerialize(before) === stableSerialize(after)) continue;
      if (ctx.readable && !ctx.readable.includes(name) || ctx.writable && !ctx.writable.includes(name)) fail('ACCESS_DENIED', 'Недостаточно прав на изменение раздела: ' + name, { section:name });
      const revision = ctx.revisions?.[name] == null ? 0 : ctx.revisions[name];
      if (!Number.isSafeInteger(revision) || revision < 0) fail('INVALID_REVISION', 'Некорректная версия раздела: ' + name, { section:name });
      changed.push(name); sections[name] = after; sourceSnapshot[name] = before; base[name] = revision;
    }
    contracts.validateOperation({ id:ctx.id });
    contracts.validateSections(sections,names);
    contracts.validateRevisions(base,names);
    try {
      if(!precision||precision.apiVersion!==1)fail('MODULE_UNAVAILABLE','Не загружены правила точности чисел');
      precision.validateChanges(prior,target,ctx);
      integrity.validateChanges(prior, target, ctx);
    }
    catch (error) {
      if (error?.name === 'PlatformKernelError') throw error;
      fail(error?.code || 'INTEGRITY_VIOLATION', error?.message || 'Изменения нарушают связи данных', { issues:clone(error?.issues || error?.details?.issues || []) });
    }
    const at = ctx.now || new Date().toISOString();
    if (typeof at !== 'string' || !Number.isFinite(Date.parse(at))) fail('INVALID_TIMESTAMP', 'Некорректное время операции');
    return freeze({ schemaVersion:1, id:ctx.id, identity:ctx.identity, actor:ctx.actor || null, base, changed, sections,
      sourceSnapshot, rowChanges:changed.flatMap(name => rowChanges(name, sourceSnapshot[name], sections[name])),
      requestDigest:requestDigest({ base, sections }), metadata:{ createdAt:at } });
  }
  let sequence = 0;
  function newId() {
    return typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID()
      : 'operation-' + Date.now().toString(36) + '-' + (++sequence).toString(36) + '-' + Math.random().toString(36).slice(2);
  }
  function createRuntime(configuration) {
    if (!plain(configuration) || typeof configuration.getContext !== 'function') fail('INVALID_CONFIGURATION', 'Нужен источник контекста операций');
    const limit = configuration.maxReceipts == null ? 64 : configuration.maxReceipts;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1024) fail('INVALID_CONFIGURATION', 'Размер истории операций должен быть от 1 до 1024');
    const characterBudget = configuration.maxReceiptCharacters == null ? 2000000 : configuration.maxReceiptCharacters;
    if (!Number.isSafeInteger(characterBudget) || characterBudget < 0 || characterBudget > 64000000) fail('INVALID_CONFIGURATION', 'Некорректный бюджет квитанций операций');
    const now = configuration.now || (() => new Date().toISOString());
    if (typeof now !== 'function') fail('INVALID_CONFIGURATION', 'Некорректный источник времени');
    if (configuration.prepare != null && typeof configuration.prepare !== 'function') fail('INVALID_CONFIGURATION','Подготовка операции должна быть функцией');
    const injectedPrepare=configuration.prepare;
    const pendingLimit=configuration.maxPending == null ? 16 : configuration.maxPending;
    if(!Number.isSafeInteger(pendingLimit)||pendingLimit<1||pendingLimit>128)fail('INVALID_CONFIGURATION','Предел ожидающих операций должен быть от 1 до 128');
    const entries = new Map(), listeners = new Set(), recent = [], preparationJobs=new Map();
    const counts = { queued:0, running:0, committed:0, unchanged:0, failed:0, deduplicated:0 };
    let retainedCharacters = 0;
    let tail = Promise.resolve();
    function context() {
      const value = configuration.getContext();
      if (value && typeof value.then === 'function') fail('INVALID_CONTEXT', 'Контекст операций должен читаться синхронно');
      return validateContext(value);
    }
    const accessStamp = ctx => stableSerialize({ readable:ctx.readable, writable:ctx.writable, actor:ctx.actor || null, fieldPermissions:ctx.fieldPermissions || null });
    function guard(captured) {
      const current = context();
      if (current.identity !== captured.identity) fail('STALE_IDENTITY', 'База или сеанс изменились. Откройте форму заново.');
      if (accessStamp(current) !== accessStamp(captured)) fail('STALE_ACCESS', 'Права или пользователь изменились. Откройте форму заново.');
    }
    function prune() {
      for (const [id, entry] of entries) {
        if (entries.size <= limit && retainedCharacters <= characterBudget) break;
        if (entry.state !== 'pending') { retainedCharacters -= entry.characters || 0; entries.delete(id); }
      }
    }
    function safeNow(fallback) {
      try { const value = now(); return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : fallback; }
      catch { return fallback; }
    }
    function remember(plan, succeeded, at, code, status) {
      recent.push(freeze({ id:plan.id, sections:plan.changed.slice(), status:status || (succeeded ? 'committed' : 'failed'), succeeded, ...(code ? { code } : {}), at }));
      if (recent.length > limit) recent.splice(0, recent.length - limit);
    }
    function checkAck(ack, plan, options) {
      if (ack === true && options.allowLegacy === true && !options.requireOperationReceipt && !(options.requiredCanonicalSections || []).length) return true;
      if (!plain(ack) || ack.ok !== true) fail('UNCONFIRMED_COMMIT', 'Сохранение не подтверждено хранилищем');
      if (ack.identity != null && ack.identity !== plan.identity || ack.operationId != null && ack.operationId !== plan.id)
        fail('MISMATCHED_ACK', 'Подтверждение относится к другой операции или базе');
      if (options.requireOperationReceipt === true || ack.operationReceipt != null) {
        const receipt = ack.operationReceipt;
        if (!plain(receipt) || !['committed','replayed'].includes(receipt.status))
          fail('OPERATION_RECEIPT_REQUIRED', 'Хранилище не подтвердило выполнение операции');
        if (receipt.id !== plan.id) fail('MISMATCHED_ACK', 'Квитанция относится к другой операции');
      }
      for (const name of options.requiredCanonicalSections || []) {
        if (!Array.isArray(ack.canonicalSections?.[name]) || !Number.isSafeInteger(ack.revisions?.[name]) || ack.revisions[name] < 0)
          fail('CANONICAL_ACK_REQUIRED', 'Хранилище не подтвердило сохранённый раздел: ' + name, { section:name });
      }
      return clone(ack);
    }
    function preparedPlan(value, previous, next, captured) {
      if (!plain(value))
        fail('INVALID_PREPARED_PLAN','Подготовленный план относится к другой операции или базе');
      // The provider is trusted calculation code, but its response is still an
      // unknown DTO. Do not rerun domain policies; check the complete JSON shape
      // and its binding to the captured inputs before accepting a worker plan.
      try { contracts.validateSections({appMeta:[value]},schema.sections); }
      catch { fail('INVALID_PREPARED_PLAN','Подготовленный план содержит неподдерживаемые данные'); }
      if(value.schemaVersion!==1 || value.id!==captured.id || value.identity!==captured.identity)
        fail('INVALID_PREPARED_PLAN','Подготовленный план относится к другой операции или базе');
      const result=clone(value), names=schema.sections;
      const validNames=value=>Array.isArray(value)&&new Set(value).size===value.length&&value.every(name=>names.includes(name));
      if (!validNames(result.changed) || !plain(result.sections) || !plain(result.sourceSnapshot) || !plain(result.base) ||
          !plain(result.metadata) || result.metadata.createdAt!==captured.now || stableSerialize(result.actor)!==stableSerialize(captured.actor || null) ||
          !Array.isArray(result.rowChanges) || typeof result.requestDigest!=='string' || !/^sha256:[a-f0-9]{64}$/.test(result.requestDigest))
        fail('INVALID_PREPARED_PLAN','Некорректная структура подготовленной операции');
      const sameNames=value=>JSON.stringify(Object.keys(value).sort())===JSON.stringify(result.changed.slice().sort());
      if (!sameNames(result.sections) || !sameNames(result.sourceSnapshot) || !sameNames(result.base))
        fail('INVALID_PREPARED_PLAN','Разделы подготовленного плана не согласованы');
      try { contracts.validateSections(result.sections,names);contracts.validateSections(result.sourceSnapshot,names);contracts.validateRevisions(result.base,names); }
      catch { fail('INVALID_PREPARED_PLAN','Некорректные разделы или версии подготовленного плана'); }
      const target={...previous,...next}, changed=[];
      for (const name of new Set([...Object.keys(previous),...Object.keys(next)]))
        if (!names.includes(name) && JSON.stringify(previous[name])!==JSON.stringify(target[name]))
          fail('INVALID_PREPARED_PLAN','Подготовленный план изменяет неизвестный раздел');
      for (const name of names) {
        const before=previous[name] || [], after=target[name] || [];
        if (JSON.stringify(before)!==JSON.stringify(after)) changed.push(name);
      }
      if (JSON.stringify(changed)!==JSON.stringify(result.changed)) fail('INVALID_PREPARED_PLAN','Подготовленный план не соответствует изменениям');
      for (const name of result.changed) {
        if (result.base[name] !== (captured.revisions?.[name] ?? 0) || JSON.stringify(result.sections[name])!==JSON.stringify(target[name] || []) ||
            JSON.stringify(result.sourceSnapshot[name])!==JSON.stringify(previous[name] || []))
          fail('INVALID_PREPARED_PLAN','Источники или версии подготовленного плана изменились');
      }
      for (const row of result.rowChanges) if (!plain(row) || !result.changed.includes(row.section) || typeof row.key!=='string' ||
          !['create','update','delete'].includes(row.action) || !Array.isArray(row.fields) || row.fields.some(field=>typeof field!=='string') ||
          !(row.before===null||plain(row.before)) || !(row.after===null||plain(row.after)))
        fail('INVALID_PREPARED_PLAN','Некорректные изменения записей подготовленного плана');
      if (result.requestDigest!==requestDigest({base:result.base,sections:result.sections}))
        fail('INVALID_PREPARED_PLAN','Отпечаток подготовленной операции не совпал');
      return freeze(result);
    }
    function runPrepared(command,persist) {
      let captured,options,nextRef,nextText,previousText,previous,next,reservation,leader;
      try {
        if (!plain(command) || typeof persist!=='function') fail('INVALID_ARGUMENT','Нужны команда и адаптер сохранения');
        if(counts.queued+counts.running>=pendingLimit)fail('QUEUE_LIMIT','Дождитесь завершения ожидающих операций');
        captured=context();
        if(command.identity!=null&&command.identity!==captured.identity)fail('STALE_IDENTITY','Команда относится к другой базе или сеансу');
        options=clone(command.options || {});
        if(!plain(options)||options.requiredCanonicalSections!=null&&(!Array.isArray(options.requiredCanonicalSections)||options.requiredCanonicalSections.some(name=>!schema.sections.includes(name))))
          fail('INVALID_ARGUMENT','Некорректные параметры подтверждения операции');
        if(!plain(command.previous)||!plain(command.next))fail('INVALID_ARGUMENT','Источник и изменения должны быть объектами');
        nextRef=command.next;nextText=stableSerialize(nextRef);next=freeze(JSON.parse(nextText));previousText=stableSerialize(command.previous);previous=freeze(JSON.parse(previousText));
        captured=freeze({...captured,id:command.id || newId(),now:now()});contracts.validateOperation({id:captured.id});
        if(typeof captured.now!=='string'||!Number.isFinite(Date.parse(captured.now)))fail('INVALID_TIMESTAMP','Некорректное время операции');
        options=freeze(options);
        const peers=preparationJobs.get(captured.id);leader=peers && peers.values().next().value;
        const stamp=stableSerialize({identity:captured.identity,access:accessStamp(captured),revisions:captured.revisions || {},options});
        // Identical concurrent callers join before the first save can install
        // canonical audit rows into their shared live nextRef. Their immutable
        // initial command is already bound; no second prepare or persist occurs.
        if(leader&&leader.nextText===nextText&&leader.previousText===previousText&&leader.stamp===stamp){
          counts.deduplicated++;return leader.promise.then(receipt=>{guard(captured);return freeze({...receipt,duplicate:true});});
        }
        reservation={nextText,previousText,stamp,promise:null,binding:null};
        if(peers)peers.add(reservation);else preparationJobs.set(captured.id,new Set([reservation]));
      } catch(error) { return Promise.reject(commandError(error)); }
      counts.queued++;
      // Reserve the FIFO slot before asynchronous preparation starts. A faster
      // second worker response can never overtake the first caller's commit.
      const task=tail.then(async()=>{
        counts.queued--;counts.running++;
        let plan={id:captured.id,changed:[],metadata:{createdAt:captured.now}},entry=null,binding='';
        const unchangedSource=()=>{if(stableSerialize(nextRef)!==nextText)fail('STALE_COMMAND','Данные изменились после постановки операции в очередь');};
        try {
          guard(captured);unchangedSource();
          const raw=await injectedPrepare(previous,next,captured);
          guard(captured);unchangedSource();plan=preparedPlan(raw,previous,next,captured);
          guard(captured);unchangedSource();
          binding=sha256(stableSerialize({identity:captured.identity,access:accessStamp(captured),digest:plan.requestDigest,options}));
          reservation.binding=binding;
          // A non-identical input may still produce the same canonical plan.
          // Retain its in-flight leader binding independently of receipt pruning.
          if(leader?.binding){
            if(leader.binding!==binding)fail('OPERATION_ID_REUSE','ID операции уже связан с другими изменениями');
            counts.deduplicated++;const receipt=await leader.promise;guard(captured);return freeze({...receipt,plan,duplicate:true});
          }
          const existing=entries.get(plan.id);
          if(existing&&existing.binding!==binding)fail('OPERATION_ID_REUSE','ID операции уже связан с другими изменениями');
          if(existing&&existing.state!=='failed') {
            counts.deduplicated++;const receipt=await existing.promise;guard(captured);return freeze({plan,...clone(receipt),duplicate:true});
          }
          if(existing)retainedCharacters-=existing.characters || 0;
          entry={binding,state:'pending',promise:null,characters:0};entries.set(plan.id,entry);
          if(!plan.changed.length) {
            const ack={ok:true,unchanged:true},receipt=freeze({ack,result:ack});entry.state='unchanged';counts.unchanged++;
            entry.characters=stableSerialize(receipt).length+binding.length+plan.id.length;retainedCharacters+=entry.characters;entry.promise=Promise.resolve(receipt);
            remember(plan,true,safeNow(plan.metadata.createdAt),undefined,'unchanged');return freeze({plan,...receipt,duplicate:false});
          }
          const rawAck=await persist(plan);guard(captured);const ack=checkAck(rawAck,plan,options),at=safeNow(plan.metadata.createdAt),receipt=freeze({ack,result:ack});
          entry.characters=stableSerialize(receipt).length+binding.length+plan.id.length;retainedCharacters+=entry.characters;
          entry.state='committed';entry.promise=Promise.resolve(receipt);counts.committed++;remember(plan,true,at);
          const event=freeze({type:'committed',id:plan.id,sections:plan.changed.slice(),at});
          for(const listener of [...listeners]){try{listener(event);}catch{}}
          return freeze({plan,...receipt,duplicate:false});
        } catch(error) {
          const failure=commandError(error);
          if(entry){entry.state='failed';entry.promise=null;entry.characters=binding.length+plan.id.length;retainedCharacters+=entry.characters;}
          counts.failed++;remember(plan,false,safeNow(plan.metadata.createdAt),failure.code);throw failure;
        } finally {
          counts.running--;const peers=preparationJobs.get(captured.id);peers?.delete(reservation);if(!peers?.size)preparationJobs.delete(captured.id);prune();
        }
      });
      reservation.promise=task;tail=task.catch(()=>{});prune();return task;
    }
    function run(command, persist) {
      if(injectedPrepare)return runPrepared(command,persist);
      let plan, captured, options, nextRef, nextText;
      try {
        if (!plain(command) || typeof persist !== 'function') fail('INVALID_ARGUMENT', 'Нужны команда и адаптер сохранения');
        captured = context();
        if (command.identity != null && command.identity !== captured.identity) fail('STALE_IDENTITY', 'Команда относится к другой базе или сеансу');
        options = clone(command.options || {});
        if (!plain(options) || options.requiredCanonicalSections != null && (!Array.isArray(options.requiredCanonicalSections) || options.requiredCanonicalSections.some(name => !schema.sections.includes(name))))
          fail('INVALID_ARGUMENT', 'Некорректные параметры подтверждения операции');
        nextRef = command.next; nextText = stableSerialize(nextRef);
        plan = prepare(command.previous, nextRef, { ...captured, id:command.id || newId(), now:now() });
      } catch (error) { return Promise.reject(commandError(error)); }
      const binding = sha256(stableSerialize({ identity:captured.identity, access:accessStamp(captured), digest:plan.requestDigest, options }));
      const existing = entries.get(plan.id);
      if (existing && existing.binding !== binding) return Promise.reject(Object.assign(new Error('ID операции уже связан с другими изменениями'), { name:'PlatformKernelError', code:'OPERATION_ID_REUSE' }));
      if (existing && existing.state !== 'failed') {
        counts.deduplicated++;
        return existing.promise.then(receipt => freeze({ plan, ...clone(receipt), duplicate:true }));
      }
      if (existing) retainedCharacters -= existing.characters || 0;
      const entry = { binding, state:'pending', promise:null, characters:0 };
      entries.set(plan.id, entry); counts.queued++;
      const task = tail.then(async () => {
        counts.queued--; counts.running++;
        try {
          guard(captured);
          if (stableSerialize(nextRef) !== nextText) fail('STALE_COMMAND', 'Данные изменились после постановки операции в очередь');
          if (!plan.changed.length) {
            const ack = { ok:true, unchanged:true };
            entry.state = 'unchanged'; counts.unchanged++;
            entry.characters = stableSerialize({ ack,result:ack }).length + binding.length + plan.id.length;
            retainedCharacters += entry.characters;
            remember(plan, true, safeNow(plan.metadata.createdAt), undefined, 'unchanged');
            return freeze({ ack,result:ack });
          }
          const raw = await persist(plan);
          guard(captured);
          const ack = checkAck(raw, plan, options);
          const at = safeNow(plan.metadata.createdAt);
          entry.characters = stableSerialize({ ack, result:ack }).length + binding.length + plan.id.length;
          retainedCharacters += entry.characters;
          entry.state = 'committed'; counts.committed++; remember(plan, true, at);
          const event = freeze({ type:'committed', id:plan.id, sections:plan.changed.slice(), at });
          for (const listener of [...listeners]) { try { listener(event); } catch { /* Observers cannot roll back a completed transaction. */ } }
          return freeze({ ack, result:ack });
        } catch (error) {
          const failure = commandError(error);
          entry.state = 'failed'; entry.promise = null; entry.characters = binding.length + plan.id.length;
          retainedCharacters += entry.characters;
          counts.failed++; remember(plan, false, safeNow(plan.metadata.createdAt), failure.code); throw failure;
        } finally { counts.running--; prune(); }
      });
      entry.promise = task; tail = task.catch(() => {}); prune();
      return task.then(receipt => freeze({ plan, ...clone(receipt), duplicate:false }));
    }
    return Object.freeze({ run,
      status() { return freeze({ ...counts, ...(injectedPrepare?{maxPending:pendingLimit}:{}), retained:entries.size, maxReceipts:limit, retainedCharacters,
        maxReceiptCharacters:characterBudget, recent:clone(recent) }); },
      subscribe(listener) {
        if (typeof listener !== 'function') fail('INVALID_ARGUMENT', 'Нужен обработчик завершённых операций');
        listeners.add(listener); return () => listeners.delete(listener);
      }
    });
  }
  return Object.freeze({ apiVersion:1, prepare, createRuntime, stableSerialize, requestDigest });
});
