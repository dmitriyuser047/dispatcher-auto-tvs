/* Posted fuel acts are immutable calculations, never adjustments to source records. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./fuel-engine.js'),()=>require('./accounting-boundary.js'),()=>require('./decimal-core.js'),()=>require('./effective-periods.js'),()=>require('./temporal-policy.js'));
  else root.TvsWriteoffEngine = factory(root.TvsFuelEngine,()=>root.AccountingBoundary,()=>root.DecimalCore,()=>root.EffectivePeriods,()=>root.TemporalPolicy);
})(typeof globalThis === 'object' ? globalThis : this, function (fuelRoot,getAccounting,getDecimal,getPeriods,getTemporal) {
  'use strict';
  function makeEngine(calculationVersion){
  const fuel=fuelRoot.forVersion(calculationVersion),modern=calculationVersion>=2,temporal=calculationVersion>=3,corrected=calculationVersion>=4,verified=calculationVersion>=6;
  if (!fuel || fuel.apiVersion !== 1) throw Error('Не загружено ядро расчёта ГСМ');
  const sumValues=values=>modern?getDecimal().toNumberExact(getDecimal().sum(values)):values.reduce((sum,value)=>sum+value,0);
  const sourceSections = Object.freeze(['vehicles', 'records', 'fuelPurchases', 'fuelCards', 'monthlyFuel']);
  const requiredSections = Object.freeze([...sourceSections, 'fuelWriteoffs']);
  const grades = ['ДТ', 'Бензин', 'АИ-92', 'АИ-95', 'АИ-98', 'АИ-100'];
  const vehicleFields = ['id','plate','make','org','fuel','fuelGrade','fuelBalance','fuelBalanceSources','norm','normCity','normHighway','normIdle','tankVolume','fuelcard','orgHistory','object','driver','supplier'];
  const tag = value => Object.prototype.toString.call(value);
  const present = value => value != null && !(typeof value === 'string' && !value.trim());
  const idOr=(value,fallback='')=>corrected?(value??fallback):(value||fallback);
  const live=value=>!value.deleted&&!value.cancelled&&value.status!=='cancelled';
  const plain = value => value != null && tag(value) === '[object Object]';
  const rounded = fuel.gsmRound;
  const orgKey = fuel.gsmOrgKey;
  function fail(code, message) { const error = new Error(message); error.name = 'FuelWriteoffError'; error.code = code; throw error; }
  function stableSerialize(input) {
    const parents = new WeakSet();
    function visit(value, depth) {
      if (depth > 100) fail('INVALID_SNAPSHOT', 'Слишком глубокая структура источника');
      if (value == null || typeof value === 'string' || typeof value === 'boolean') return value;
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) fail('INVALID_SNAPSHOT', 'Источник содержит нечисловое значение');
        return value;
      }
      if (typeof value === 'undefined') return undefined;
      if (!Array.isArray(value) && !plain(value)) fail('INVALID_SNAPSHOT', 'Источник должен содержать только данные JSON');
      if (parents.has(value)) fail('INVALID_SNAPSHOT', 'Циклическая структура источника');
      parents.add(value);
      let out;
      if (Array.isArray(value)) out = Array.from(value, item => visit(item, depth + 1) ?? null);
      else {
        out = {};
        Object.keys(value).sort().forEach(key => {
          if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('INVALID_SNAPSHOT', 'Недопустимое поле источника');
          const child = visit(value[key], depth + 1);
          if (child !== undefined) out[key] = child;
        });
      }
      parents.delete(value); return out;
    }
    return JSON.stringify(visit(input, 0));
  }
  const clone = value => JSON.parse(stableSerialize(value));
  function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  }
  function vehicleProjection(vehicle) {
    const result = {};
    vehicleFields.forEach(field=>{ if (Object.prototype.hasOwnProperty.call(vehicle,field)) result[field]=vehicle[field]; });
    if(Object.prototype.hasOwnProperty.call(vehicle,'fuelAccounting'))result.fuelAccounting=vehicle.fuelAccounting;
    return result;
  }
  // All callers use database()'s privately cloned rows, never mutable UI cards.
  // Cache only these owned objects; a later source read creates a fresh clone.
  const accountingCache=new WeakMap();
  function accounting(vehicle){
    if(!vehicle||!Object.prototype.hasOwnProperty.call(vehicle,'fuelAccounting'))return {mode:'legacy'};
    if(accountingCache.has(vehicle))return accountingCache.get(vehicle);
    const api=getAccounting();if(api?.apiVersion!==1)fail('MODULE_UNAVAILABLE','Не загружены правила начала учёта ГСМ');
    const value=api.resolve('vehicles',vehicle);accountingCache.set(vehicle,value);return value;
  }
  function currentSource(vehicle,date){const boundary=accounting(vehicle);return boundary.mode!=='explicit'||!fuel.gsmValidDate(date)||date>=boundary.from;}
  // Synchronous SHA-256 over UTF-8 keeps browser and storage fingerprints identical.
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
    const high = Math.floor(bits / 0x100000000), low = bits >>> 0;
    for (const part of [high, low]) for (let shift = 24; shift >= 0; shift -= 8) bytes.push(part >>> shift & 255);
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
        const s1 = rotate(e,6) ^ rotate(e,11) ^ rotate(e,25), choice = e & f ^ ~e & g;
        const t1 = j + s1 + choice + k[i] + w[i] | 0;
        const s0 = rotate(a,2) ^ rotate(a,13) ^ rotate(a,22), majority = a & b ^ a & c ^ b & c, t2 = s0 + majority | 0;
        j=g; g=f; f=e; e=d+t1|0; d=c; c=b; b=a; a=t1+t2|0;
      }
      [a,b,c,d,e,f,g,j].forEach((value, i) => { h[i] = h[i] + value | 0; });
    }
    return h.map(value => (value >>> 0).toString(16).padStart(8, '0')).join('');
  }
  function normalize(request) {
    if (!plain(request)) fail('INVALID_SCOPE', 'Укажите параметры акта');
    const month = request.month;
    if (typeof month !== 'string' || !/^(?:19|[2-9]\d)\d{2}-(?:0[1-9]|1[0-2])$/.test(month)) fail('INVALID_PERIOD', 'Акт формируется за полный календарный месяц');
    const range = fuel.gsmMonthRange(month);
    if (!fuel.gsmValidDate(range.from) || !fuel.gsmValidDate(range.to)) fail('INVALID_PERIOD', 'Некорректный месяц акта');
    if (request.from != null && request.from !== range.from || request.to != null && request.to !== range.to) fail('INVALID_PERIOD', 'Нельзя провести акт за неполный месяц');
    for (const field of ['org', 'grade', 'basisNote']) if (request[field] != null && typeof request[field] !== 'string') fail('INVALID_SCOPE', 'Некорректное поле ' + field);
    const org = String(request.org || '').trim().replace(/\s+/g, ' '), grade = String(request.grade || '').trim();
    if (org.length > 500 || grade && !grades.includes(grade)) fail('INVALID_SCOPE', 'Выберите организацию и марку дизельного топлива или бензина');
    if (typeof request.date !== 'string' || !fuel.gsmValidDate(request.date)) fail('INVALID_DATE', 'Укажите действительную дату акта');
    const basisNote = String(request.basisNote || '').trim();
    if (basisNote.length > 10000) fail('INVALID_BASIS', 'Слишком длинное основание списания');
    return { scope: { month, from:range.from, to:range.to, org, grade }, date:request.date, basisNote };
  }
  function database(input) {
    if (!plain(input)) fail('INVALID_DATABASE', 'Требуется база источников ГСМ');
    const out = {};
    requiredSections.forEach(section => {
      const rows = input[section] == null ? [] : input[section];
      if (!Array.isArray(rows) || rows.some(row => !plain(row))) fail('INVALID_DATABASE', 'Раздел «' + section + '» должен содержать записи');
      out[section] = rows;
    });
    const db = clone(out);
    for (const [section, fields] of [['vehicles',['orgHistory']], ['fuelCards',['orgHistory','assignments']]]) {
      for (const row of db[section]) for (const field of fields) if (row[field] != null && (!Array.isArray(row[field]) || row[field].some(item => !plain(item)))) fail('INVALID_HISTORY', 'Повреждена история ' + section + ':' + (row.id || row.number || '') + '.' + field);
    }
    return db;
  }
  const eligibleVehicle = vehicle => vehicle && ['diesel', 'gasoline'].includes(fuel.gsmFamily(fuel.gsmVehicleGrade(vehicle)));
  const visible = (row, scope) => (!scope.org || orgKey(row.org) === orgKey(scope.org)) && (!scope.grade || row.grade === scope.grade);
  function issueVisible(issue, scope, ids) {
    if (issue.grade === 'Газ') return false;
    if ((corrected?present(issue.vehicleId):issue.vehicleId) && ids.has(issue.vehicleId) && !issue.org && !(issue.orgs || []).length && !issue.grade) return true;
    const unknownOrg = !issue.org || orgKey(issue.org) === orgKey('Организация не определена');
    return (!scope.grade || !issue.grade || issue.grade === scope.grade) && (!scope.org || unknownOrg && !(issue.orgs || []).length ||
      orgKey(issue.org) === orgKey(scope.org) || (issue.orgs || []).some(org => orgKey(org) === orgKey(scope.org)));
  }
  function selection(db, scope, ledger) {
    const selected = ledger.rows.filter(row => eligibleVehicle(row.vehicle) && fuel.gsmFamily(row.grade) !== 'gas' && visible(row, scope));
    const represented = new Set(ledger.rows.map(row => row.vehicleId));
    db.vehicles.filter(vehicle => eligibleVehicle(vehicle) && !represented.has(vehicle.id)).forEach(vehicle => {
      const boundary=accounting(vehicle);if(boundary.mode==='explicit'&&scope.to<boundary.from)return;
      const row = { vehicleId:vehicle.id, vehicle, org:fuel.gsmVehicleOrgAt(vehicle, scope.to) || 'Организация не определена', grade:fuel.gsmVehicleGrade(vehicle),
        ...(boundary.mode==='explicit'?{accountingFrom:boundary.from}:{}),
        key:[vehicle.id, orgKey(fuel.gsmVehicleOrgAt(vehicle, scope.to)), fuel.gsmVehicleGrade(vehicle)].join('|'),
        start:0, issued:0, spent:0, idle:0, norm:0, km:0, glonass:0, end:0, correction:0, providers:{}, cards:new Set(), active:false };
      if (visible(row, scope)) selected.push(row);
    });
    return { rows:selected, ids:new Set(selected.map(row => row.vehicleId)) };
  }
  function sourceProjection(db, scope, selected) {
    const ids = selected.ids, vehicles = new Map(db.vehicles.map(row => [row.id, row]));
    const until = date => !fuel.gsmValidDate(date) || date <= scope.to;
    const potentialPurchase = row => {
      const vehicle = vehicles.get(row.vehicleId), owner = fuel.gsmCardAt(db,row.cardNo,row.date);
      if (vehicle && !eligibleVehicle(vehicle) && !ids.has(vehicle.id)) return false;
      const org = row.sourceOrg || owner.org || (row.manual && vehicle ? fuel.gsmVehicleOrgAt(vehicle,row.date) : '');
      const grade = fuel.gsmGrade(row.grade || row.product, vehicle ? fuel.gsmVehicleGrade(vehicle) : '');
      return (!scope.org || !org || orgKey(org) === orgKey(scope.org)) && (!scope.grade || grade === 'Не указано' || grade === scope.grade);
    };
    const orphanRelevant = (row, purchase) => {
      if (vehicles.has(row.vehicleId)) return false;
      const grade = fuel.gsmGrade(row.grade || row.fuelGrade || row.product, '');
      if (grade === 'Газ') return false;
      const explicit = purchase ? row.sourceOrg : row.fuelOrg;
      return (!scope.org || !explicit || orgKey(explicit) === orgKey(scope.org)) && (!scope.grade || grade === 'Не указано' || grade === scope.grade);
    };
    const purchases = db.fuelPurchases.filter(row => (!corrected||live(row))&&until(row.date) && currentSource(vehicles.get(row.vehicleId),row.date) && (ids.has(row.vehicleId) || potentialPurchase(row) || orphanRelevant(row, true)));
    const dependencyIds = new Set([...ids,...purchases.map(row=>row.vehicleId)]);
    const records = db.records.filter(row => (!corrected||live(row))&&until(row.date) && currentSource(vehicles.get(row.vehicleId),row.date) && (dependencyIds.has(row.vehicleId) || orphanRelevant(row, false)));
    const cardKeys = new Set([...records.map(row => row.fuelCardNum), ...purchases.map(row => row.cardNo), ...db.vehicles.filter(row => ids.has(row.id)).map(row => row.fuelcard)].filter(Boolean).map(fuel.gsmCardKey));
    const historicalHistory = entries => entries.filter(item=>!fuel.gsmValidDate(item.from)||item.from<=scope.to).map(item=>{
      const value = {...item};
      // An end date after the act month and an open interval have the same
      // historical meaning. Future assignments cannot lock an earlier act.
      value.to = !present(item.to) || fuel.gsmValidDate(item.to) && item.to > scope.to ? '' : item.to;
      return value;
    });
    const cards = db.fuelCards.filter(row => cardKeys.has(fuel.gsmCardKey(row.number))).map(row=>({...row,
      ...(row.assignments?{assignments:historicalHistory(row.assignments)}:{}),...(row.orgHistory?{orgHistory:historicalHistory(row.orgHistory)}:{})}));
    const effective=(section,row,dates,kind)=>{
      const api=getPeriods();let legacy;
      if(api?.apiVersion!==1){
        if(Object.prototype.hasOwnProperty.call(row,kind)&&!(kind==='orgHistory'&&Array.isArray(row[kind])&&!row[kind].length))fail('MODULE_UNAVAILABLE','Не загружены датированные параметры');
        // Missing optional history dependencies must not disable ordinary
        // legacy sources. This is scalar JSON projection, never dated fallback.
        const parameters=kind==='orgHistory'?{org:typeof row.org==='string'?row.org:''}:Object.fromEntries(['norm','normCity','normHighway','normIdle'].map(field=>[field,typeof row[field]==='number'||typeof row[field]==='string'&&row[field].trim()?fuel.fqValue(row[field]):null]));
        legacy=Object.values(parameters).every(value=>value===null)||kind==='orgHistory'&&!parameters.org.trim()?{status:'missing',parameters:null}:{status:'known',parameters};
      }
      return [...new Set([scope.from,scope.to,...dates].filter(fuel.gsmValidDate))].sort().map(date=>({date,...(legacy||api.projection(section,row,date,kind))}));
    };
    if(temporal)for(const row of cards){
      const cardKey=fuel.gsmCardKey(row.number),dates=[...records.filter(record=>fuel.gsmCardKey(record.fuelCardNum)===cardKey).map(record=>record.date),...purchases.filter(record=>fuel.gsmCardKey(record.cardNo)===cardKey).map(record=>record.date)];
      row.effectiveOrganizations=effective('fuelCards',row,dates,'orgHistory');delete row.orgHistory;delete row.orgHistoryOrigin;
    }
    const dependencyVehicles = db.vehicles.filter(row => dependencyIds.has(row.id) || row.fuelcard && cardKeys.has(fuel.gsmCardKey(row.fuelcard)));
    const projectedVehicles=dependencyVehicles.map(vehicle=>{
      const result=vehicleProjection(vehicle);
      if(temporal){
        const dates=records.filter(record=>record.vehicleId===vehicle.id).map(record=>record.date);
        // Uniform legacy/dated VALUES let an explicitly reviewed equal-value
        // bridge preserve old calculations. Provenance stays in the snapshot.
        result.effectiveNorms=effective('vehicles',vehicle,dates,'fuelNorms');
        result.effectiveOrganizations=effective('vehicles',vehicle,[...dates,...purchases.filter(row=>row.vehicleId===vehicle.id).map(row=>row.date)],'orgHistory');
        for(const field of ['norm','normCity','normHighway','normIdle'])delete result[field];
        delete result.orgHistory;delete result.orgHistoryOrigin;
      }
      if(result.orgHistory)result.orgHistory=historicalHistory(result.orgHistory);
      return result;
    });
    return { vehicles:projectedVehicles, records, fuelPurchases:purchases, fuelCards:cards,
      monthlyFuel:db.monthlyFuel.filter(row => (!corrected||live(row))&&ids.has(row.vehicleId) && (typeof row.month !== 'string' || row.month <= scope.month) && currentSource(vehicles.get(row.vehicleId),typeof row.month==='string'&&/^\d{4}-(?:0[1-9]|1[0-2])$/.test(row.month)?fuel.gsmMonthRange(row.month).to:'')) };
  }
  function projectionFingerprint(source, scope) { return 'sha256:' + sha256(stableSerialize({ schemaVersion:1,...(modern?{calculationVersion}:{}), scope:{month:scope.month,org:orgKey(scope.org),grade:scope.grade}, source })); }
  function fingerprint(input, request) {
    const { scope } = normalize(request), db = database(input), ledger = fuel.buildLedger(db, scope);
    return projectionFingerprint(sourceProjection(db, scope, selection(db, scope, ledger)), scope);
  }
  const scopesOverlap = (a,b) => a.month === b.month && (!a.org || !b.org || orgKey(a.org) === orgKey(b.org)) && (!a.grade || !b.grade || a.grade === b.grade);
  function prepare(input, request) {
    const parameters = normalize(request), { scope } = parameters, db = database(input), ledger = fuel.buildLedger(db, scope);
    const selected = selection(db, scope, ledger), projection = sourceProjection(db, scope, selected), issues = [], issueKeys = new Set();
    const dependencyIds = new Set(projection.vehicles.map(row=>row.id));
    const add = issue => {
      const value = { severity:'error', date:'', vehicleId:'', recordId:'', purchaseId:'', ...issue };
      const key = stableSerialize([value.code,value.vehicleId,value.recordId,value.purchaseId,value.field || '',value.date,value.org || '',value.grade || '',value.section || '',value.sourceId || '',value.documentId || '']);
      if (!issueKeys.has(key)) { issueKeys.add(key); issues.push(value); }
    };
    if (request.readable != null && (!Array.isArray(request.readable) || requiredSections.some(section => !request.readable.includes(section)))) add({code:'access-incomplete',message:'Для проведения акта необходим доступ ко всем источникам ГСМ и журналу актов'});
    for(const vehicle of db.vehicles.filter(eligibleVehicle)){
      const boundary=accounting(vehicle);if(boundary.mode!=='explicit')continue;
      const org=fuel.gsmVehicleOrgAt(vehicle,boundary.from),grade=fuel.gsmVehicleGrade(vehicle);
      if(!issueVisible({vehicleId:vehicle.id,org,grade},scope,new Set([vehicle.id])))continue;
      const coverage=getAccounting().window(boundary,{from:scope.from,to:scope.to});
      if(coverage.status==='outside-accounting')add({code:'outside-accounting',vehicleId:vehicle.id,date:scope.to,message:'Период акта полностью предшествует началу учёта ГСМ '+boundary.from});
      else if(coverage.status==='partial')add({code:'accounting-period-partial',vehicleId:vehicle.id,date:boundary.from,message:'Учёт ГСМ начинается '+boundary.from+' внутри месяца. Полный месячный акт до этой даты сформировать нельзя'});
    }
    // Earlier operations establish opening stock. Their audit must not be replayed
    // as this month's errors after a confirmed tank measurement has anchored it.
    for (const item of ledger.issues) {
      if (fuel.gsmValidDate(item.date) && item.date < scope.from) continue;
      if (item.vehicleId && !dependencyIds.has(item.vehicleId) && db.vehicles.some(vehicle => vehicle.id === item.vehicleId) && item.code !== 'source-org') continue;
      if (issueVisible(item, scope, selected.ids)) add(item);
    }
    const vehicles = new Map(db.vehicles.map(row => [row.id,row]));
    if(verified)for(const row of selected.rows){
      const evidence=fuel.openingEvidence(db,row.vehicleId,{before:scope.from,family:fuel.gsmFamily(row.grade)});
      if(evidence.status==='missing')add({code:'opening-missing',vehicleId:row.vehicleId,org:row.org,grade:row.grade,date:scope.from,section:'vehicles',sourceId:row.vehicleId,field:'fuelBalance',message:'Входящий остаток не подтверждён. Укажите начальный остаток, включая явный ноль, начало учёта или подтвердите остаток замером до начала периода'});
    }
    const measurementPlans = new Map();
    function appliedMeasurement(record) {
      if (!measurementPlans.has(record.vehicleId)) measurementPlans.set(record.vehicleId,fuel.fqMeasurementPlan(db.records.filter(item=>item.vehicleId===record.vehicleId&&fuel.gsmValidDate(item.date)&&currentSource(vehicles.get(item.vehicleId),item.date)).slice().sort((a,b)=>a.date.localeCompare(b.date)),vehicles.get(record.vehicleId)));
      const plan=measurementPlans.get(record.vehicleId),key=plan.keyFor(record);
      return plan.lastOnDate.get(key)===record.id ? plan.measurements.get(key) : null;
    }
    function historicalOpeningUncertain(row, section, field, message) {
      if (!fuel.gsmValidDate(row.date) || row.date >= scope.from) return;
      const vehicle = vehicles.get(row.vehicleId);
      const family = section === 'fuelPurchases'
        ? fuel.gsmFamily(fuel.gsmGrade(row.grade || row.product, vehicle ? fuel.gsmVehicleGrade(vehicle) : ''))
        : fuel.fqRecordFuelFamily(row,vehicle);
      const anchored = family !== 'unknown' && db.records.some(candidate=>{
        if (candidate.vehicleId !== row.vehicleId || !fuel.gsmValidDate(candidate.date) || candidate.date < row.date || candidate.date >= scope.from || fuel.fqRecordFuelFamily(candidate,vehicle) !== family) return false;
        if (present(candidate.fuelGrade) && !fuel.parseFuelGrade(candidate.fuelGrade) && String(candidate.fuelGrade).trim() !== 'Бензин') return false;
        const measurement = appliedMeasurement(candidate), value = measurement && measurement.tankMeasured;
        return measurement && present(value) && ['number','string'].includes(typeof value) && Number.isFinite(Number(value)) && Number(value) >= 0;
      });
      if (!anchored) add({code:'opening-source-invalid',field,section,sourceId:idOr(row.id),vehicleId:idOr(row.vehicleId),
        recordId:section === 'records' ? idOr(row.id) : '',purchaseId:section === 'fuelPurchases' ? idOr(row.id) : '',
        date:scope.from,earliestCauseDate:row.date,message:'Входящий остаток опирается на некорректный исторический источник без последующего замера: ' + message});
    }
    const fieldLabels = { fuelActual:'фактический расход',fuelUsed:'расход по норме',fuelIssued:'получено по журналу',fuelIdle:'холостой ход',
      tankMeasured:'замер остатка',qty:'литры покупки или начального источника',norm:'норма расхода',normCity:'городская норма',normHighway:'трассовая норма',normIdle:'норма холостого хода',
      km:'пробег',kmGlonass:'пробег ГЛОНАСС',fuelBalance:'начальный остаток',tankVolume:'вместимость бака',sum:'сумма покупки',price:'цена топлива',liters:'литры месячной сверки' };
    function checkNumeric(row, section, fields) {
      const historical = fuel.gsmValidDate(row.date) && row.date < scope.from;
      for (const field of fields) {
        const value = row[field];
        if (!present(value)) continue;
        if (!['number','string'].includes(typeof value) || (verified?fuel.fqValue(value)===null||fuel.fqValue(value)<0:!Number.isFinite(Number(value))||Number(value)<0)) {
          add({ code:'invalid-number', severity:historical?'warning':'error', field, message:(historical?'Исторический источник переноса: ':'')+'Укажите корректное неотрицательное число — ' + (fieldLabels[field] || field),
            vehicleId:idOr(row.vehicleId,(section === 'vehicles' ? row.id : '')), recordId:section === 'records' ? row.id : '', purchaseId:section === 'fuelPurchases' ? row.id : '', date:row.date || '', section, sourceId:idOr(row.id) });
          if (section === 'records' && ['km','fuelIssued','fuelActual','fuelUsed','fuelIdle','tankMeasured'].includes(field) || section === 'fuelPurchases' && field === 'qty') historicalOpeningUncertain(row,section,field,fieldLabels[field] || field);
        }
      }
    }
    for (const section of sourceSections) {
      const ids = new Set();
      for (const row of projection[section]) {
        const severity = fuel.gsmValidDate(row.date) && row.date < scope.from ? 'warning' : 'error';
        if (!['monthlyFuel','fuelCards'].includes(section) && !(typeof row.id==='string'&&row.id.trim()||typeof row.id==='number'&&Number.isFinite(row.id))) add({code:'source-id-missing',severity,section,sourceId:row.id ?? '',message:'У источника отсутствует устойчивый ID'});
        if ((corrected?present(row.id):row.id) && ids.has(row.id)) add({code:'source-id-duplicate',severity,section,sourceId:row.id,message:'Повторяется ID источника: ' + row.id});
        ids.add(row.id);
      }
    }
    for (const row of projection.vehicles) {
      const boundary=accounting(row);
      checkNumeric(verified?vehicles.get(row.id)||row:row,'vehicles',[...(boundary.mode==='legacy'?['fuelBalance']:[]),'norm','normCity','normHighway','normIdle','tankVolume']);
      if (boundary.mode==='legacy'&&row.fuelBalanceSources != null && !Array.isArray(row.fuelBalanceSources)) fail('INVALID_OPENING','Распределение начального остатка должно быть массивом');
      for (const source of boundary.mode==='explicit'?boundary.sources||[]:row.fuelBalanceSources || []) {
        if (!plain(source)) fail('INVALID_OPENING','Повреждён источник начального остатка');
        checkNumeric({...source,vehicleId:row.id},'opening',['qty']);
        if (!present(source.qty) || !present(source.org) || !grades.includes(fuel.gsmGrade(source.grade))) add({code:'opening-source-invalid',vehicleId:row.id,message:'Уточните организацию, марку и литры начального остатка'});
      }
      for (const historyRow of row.orgHistory || []) for (const field of ['from','to']) if (present(historyRow[field]) && !fuel.gsmValidDate(historyRow[field])) add({code:'history-date-invalid',vehicleId:row.id,message:'Некорректная дата истории организации',field});
    }
    const referencedRecords = new Map(db.records.map(row => [row.id,row]));
    for (const [section,purchase] of [['records',false],['fuelPurchases',true]]) for (const row of projection[section]) {
      if (purchase && row.deleted) continue;
      const historical = fuel.gsmValidDate(row.date) && row.date < scope.from;
      const details = { severity:historical?'warning':'error',vehicleId:idOr(row.vehicleId), recordId:purchase ? '' : idOr(row.id), purchaseId:purchase ? idOr(row.id) : '', date:row.date || '' };
      if (!fuel.gsmValidDate(row.date)) add({...details,code:'source-date-invalid',message:'Некорректная дата источника'});
      if (!vehicles.has(row.vehicleId)) add({...details,code:'source-vehicle-missing',message:'Источник не связан с существующей машиной'});
      checkNumeric(row,section,purchase ? ['qty','sum','price'] : ['km','kmGlonass','fuelIssued','fuelActual','fuelUsed','fuelIdle','tankMeasured']);
      const rawGrade = row.grade || row.fuelGrade || row.product;
      const grade = present(rawGrade) ? fuel.gsmGrade(rawGrade) : purchase ? 'Не указано' : fuel.gsmVehicleGrade(vehicles.get(row.vehicleId));
      if (!grades.includes(grade)) {
        add({...details,code:'source-grade-invalid',grade,message:'Марка топлива не подходит для акта дизельного топлива или бензина'});
        historicalOpeningUncertain(row,section,'grade','не распознана марка топлива');
      }
      if (purchase && (!present(row.qty) || Number(row.qty) <= 0)) {
        add({...details,code:'purchase-quantity-missing',message:'В покупке должны быть указаны положительные литры'});
        historicalOpeningUncertain(row,section,'qty','не указаны положительные литры покупки');
      }
      if (purchase && row.recordId) {
        const linked = referencedRecords.get(row.recordId);
        if (!linked || linked.vehicleId !== row.vehicleId || linked.date !== row.date) {
          const vehicle = vehicles.get(row.vehicleId), candidates = db.records.filter(item=>item.vehicleId===row.vehicleId&&item.date===row.date&&fuel.gsmGrade(item.fuelGrade,fuel.gsmVehicleGrade(vehicle))===grade);
          if (candidates.length === 1) add({...details,severity:'warning',code:'purchase-link-resolved',resolvedRecordId:candidates[0].id,message:'Старая ссылка покупки однозначно разрешена по машине, дате и марке; повторный приход не нужен'});
          else add({...details,code:'purchase-link-invalid',message:'У покупки неверная или неоднозначная ссылка на запись журнала'});
        }
      }
      if (!purchase && Number(row.km) > 0 && fuel.fqRecord(row,vehicles.get(row.vehicleId)).source === 'missing' && !appliedMeasurement(row)) {
        add({...details,code:'consumption-basis-missing',message:'Для пробега не указан факт расхода, отсутствуют норма и применимый замер'});
        historicalOpeningUncertain(row,section,'fuelActual','нет основания расхода при наличии пробега');
      }
    }
    const cardNumbers = new Set();
    for (const card of projection.fuelCards) {
      const number = fuel.gsmCardKey(card.number);
      if (!number || cardNumbers.has(number)) add({code:'card-number-invalid',section:'fuelCards',sourceId:card.id || number,message:'Отсутствует или повторяется номер топливной карты'});
      cardNumbers.add(number);
      for (const field of ['assignments','orgHistory']) for (const item of card[field] || []) {
        for (const dateField of ['from','to']) if (present(item[dateField]) && !fuel.gsmValidDate(item[dateField])) add({code:'card-history-date',section:'fuelCards',sourceId:card.id,field:dateField,message:'Некорректная дата истории карты'});
        if (item.from && item.to && item.from > item.to) add({code:'card-history-range',section:'fuelCards',sourceId:card.id,message:'Конец периода карты раньше начала'});
        if (field === 'assignments' && item.vehicleId && !vehicles.has(item.vehicleId)) add({code:'card-assignment-orphan',section:'fuelCards',sourceId:card.id,message:'История карты ссылается на отсутствующую машину'});
      }
    }
    for (const row of projection.monthlyFuel) {
      if (typeof row.month === 'string' && row.month < scope.month) continue;
      if (typeof row.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(row.month)) add({code:'monthly-period-invalid',vehicleId:row.vehicleId,message:'Некорректный месяц контрольного значения'});
      checkNumeric(row,'monthlyFuel',['liters']);
    }
    const duplicatePurchases = new Map();
    for (const row of projection.fuelPurchases.filter(row => !row.deleted && Number(row.qty) > 0 && fuel.gsmInPeriod(row.date,scope.from,scope.to))) {
      const key = stableSerialize([row.date,fuel.gsmCardKey(row.cardNo),rounded(row.qty),fuel.gsmGrade(row.grade || row.product),row.vehicleId,row.time || '']);
      if (!duplicatePurchases.has(key)) duplicatePurchases.set(key,[]);
      duplicatePurchases.get(key).push(row);
    }
    duplicatePurchases.forEach(rows => { if (rows.length > 1) add({code:'possible-duplicate-purchases',purchaseId:rows[0].id,vehicleId:rows[0].vehicleId,date:rows[0].date,message:'Совпали признаки покупок; необходима сверка с исходной выпиской',sourceIds:rows.map(row=>row.id)}); });
    const movementVisible = movement => selected.ids.has(movement.vehicleId) && fuel.gsmFamily(movement.grade) !== 'gas' && visible(movement,scope);
    const movements = ledger.movements.filter(movementVisible);
    const consumed = movements.filter(row => row.kind === 'consumption');
    const consumption = consumed.map(row => {
      const record = referencedRecords.get(row.recordId) || {}, vehicle = vehicles.get(row.vehicleId), basis = fuel.fqRecord(record,vehicle);
      const measurement = row.source === 'measurement' ? appliedMeasurement(record) : null;
      return { ...row, ...(modern?{km:rounded(row.km),totalNorm:row.totalNorm==null?null:rounded(row.totalNorm)}:{}),qty:rounded(row.qty), idle:rounded(row.idle), norm:row.norm == null ? null : rounded(row.norm), enteredActual:basis.actual,
        enteredIdle:fuel.fqValue(record.fuelIdle), normSource:basis.normSource, measurement:measurement ? fuel.fqValue(measurement.tankMeasured) : null,measurementRecordId:measurement ? measurement.id : '' };
    });
    if(modern){
      // Allocate display quanta only. Preserve every original journal fact in
      // enteredActual/snapshot, and expose adjustments instead of losing them.
      const d=getDecimal(),groups=new Map(),key=row=>stableSerialize([row.vehicleId,orgKey(row.org),row.grade]);
      consumption.forEach((item,index)=>{const id=key(item);if(!groups.has(id))groups.set(id,[]);groups.get(id).push({item,raw:consumed[index],index});});
      function align(parts,field,target,row){
        if(target==null||parts.some(part=>part.item[field]==null))return;
        const difference=d.mul(d.sub(target,d.sum(parts.map(part=>part.item[field]))),1000),units=d.toNumberExact(difference);
        if(!Number.isSafeInteger(units)||Math.abs(units)>parts.length)fail('ROUNDING_RANGE','Не удалось согласовать точность строк акта');
        if(!units)return;
        const sign=units<0?-1:1,ordered=parts.map(part=>({...part,error:d.sub(calculationVersion>=5?part.raw.allocation?.[field]??part.raw[field]:part.raw[field],part.item[field]),stable:stableSerialize([part.item.recordId,part.index])}));
        ordered.sort((a,b)=>sign*d.compare(b.error,a.error)||a.stable.localeCompare(b.stable));
        for(const part of ordered.slice(0,Math.abs(units))){const delta=sign*.001;part.item[field]=d.toNumberExact(d.add(part.item[field],delta));(part.item.roundingAdjustment||(part.item.roundingAdjustment={}))[field]=delta;}
        add({code:'rounding-allocation',severity:'warning',vehicleId:row.vehicleId,org:row.org,grade:row.grade,field,qty:d.toNumberExact(d.div(units,1000,{scale:3,rounding:'half-away-from-zero'})),message:'Округление подробных строк согласовано с итогом до 0,001; исходные значения сохранены в снимке'});
      }
      for(const row of selected.rows){const parts=groups.get(key(row));if(!parts?.length)continue;align(parts,'qty',row.spent,row);align(parts,'idle',row.idle,row);align(parts,'norm',row.norm,row);align(parts,'km',row.km,row);}
    }
    for (const item of consumption) {
      if (!['actual','norm','measurement'].includes(item.source) && (item.qty > 0 || item.km > 0)) add({...item,code:'consumption-source-unknown',message:'Нет подтверждённого основания расхода'});
      if (item.norm == null && (item.qty > 0 || item.km > 0)) add({...item,severity:'warning',code:'norm-unknown',message:'Норма неизвестна; нормативный расход и экономия не определяются'});
    }
    const rows = selected.rows.map(row => {
      const parts = consumption.filter(item => item.vehicleId === row.vehicleId && orgKey(item.org) === orgKey(row.org) && item.grade === row.grade);
      const norm = parts.some(item => item.norm == null && (item.qty || item.km)) ? null : rounded(parts.reduce((sum,item)=>sum+(item.norm || 0),0));
      const value = { ...row, vehicle:temporal?projection.vehicles.find(vehicle=>vehicle.id===row.vehicleId)||vehicleProjection(row.vehicle):vehicleProjection(row.vehicle),cards:[...(row.cards || [])], norm, balanceDelta:rounded(sumValues([row.start,row.issued,row.correction,-row.spent,-row.end])) };
      if (!grades.includes(row.grade)) add({code:'row-grade-invalid',vehicleId:row.vehicleId,org:row.org,grade:row.grade,message:'В строке текущего акта не определена допустимая марка топлива'});
      if ((!row.org || orgKey(row.org)===orgKey('Организация не определена')) && ['start','issued','spent','end','correction'].some(field=>Math.abs(row[field])>0.0005)) add({code:'row-org-unknown',vehicleId:row.vehicleId,org:row.org,grade:row.grade,message:'Для текущего остатка или движения не определена организация топлива'});
      if (value.start < -0.0005 || value.end < -0.0005) add({code:'negative-balance',vehicleId:row.vehicleId,org:row.org,grade:row.grade,message:'Отрицательный входящий или конечный остаток'});
      if (Math.abs(value.balanceDelta) > 0.00101) add({code:'row-not-balanced',vehicleId:row.vehicleId,org:row.org,grade:row.grade,message:'Не сходится построчный баланс акта'});
      else if (value.balanceDelta) add({code:'rounding-residual',severity:'warning',vehicleId:row.vehicleId,org:row.org,grade:row.grade,qty:value.balanceDelta,message:'Расхождение отображения в пределах 0,001 л показано явно'});
      return value;
    });
    const totals = { start:0,issued:0,spent:0,idle:0,correction:0,end:0,km:0,glonass:0,norm:rows.some(row=>row.norm==null)?null:0,basis:{actual:0,norm:0,measurement:0,missing:0} };
    for (const row of rows) for (const field of ['start','issued','spent','idle','correction','end','km','glonass']) totals[field] = rounded(sumValues([totals[field],row[field]]));
    if (totals.norm !== null) totals.norm = rounded(rows.reduce((sum,row)=>sum+(row.norm || 0),0));
    consumption.forEach(row => { const source = Object.prototype.hasOwnProperty.call(totals.basis,row.source)?row.source:'missing'; totals.basis[source] = rounded(sumValues([totals.basis[source],row.qty])); });
    const requiresBasisNote = consumption.some(row=>row.source==='norm'&&row.qty>0);
    if (requiresBasisNote) add({code:'norm-basis',severity:'warning',message:'Часть расхода рассчитана по норме; при проведении требуется явное основание'});
    if (!rows.length) add({code:'empty-scope',message:'В выбранной области нет транспорта для акта'});
    for (const document of db.fuelWriteoffs) if (document.status === 'posted') {
      if (!plain(document.scope)) { add({code:'writeoff-invalid',message:'Повреждён журнал проведённых актов'}); continue; }
      if (scopesOverlap(scope,document.scope)) add({code:'writeoff-overlap',documentId:document.id,message:'В этой области уже проведён акт; сначала аннулируйте его с причиной'});
    }
    const refs = [];
    sourceSections.forEach(section => projection[section].forEach(row => refs.push({section,id:idOr(row.id,(section==='fuelCards'?fuel.gsmCardKey(row.number):[row.vehicleId,row.month,row.cardNumber || ''].join(':')))})));
    const barrelMap = new Map();
    rows.forEach(row=>{
      const key = stableSerialize([orgKey(row.org),row.grade]);
      if (!barrelMap.has(key)) barrelMap.set(key,{org:row.org,grade:row.grade,start:0,issued:0,spent:0,end:0,correction:0});
      const barrel=barrelMap.get(key);
      for (const field of ['start','issued','spent','end','correction']) barrel[field]=rounded(sumValues([barrel[field],row[field]]));
    });
    const snapshotLedger = { from:scope.from,to:scope.to,rows,barrels:[...barrelMap.values()].sort((a,b)=>a.org.localeCompare(b.org,'ru')||a.grade.localeCompare(b.grade,'ru')),movements,
      receipts:ledger.receipts.filter(movementVisible),journal:ledger.journal.filter(row=>selected.ids.has(row.vehicleId)),issues,
      errors:issues.filter(row=>row.severity==='error'),organizations:[...new Set(rows.map(row=>row.org))].sort((a,b)=>a.localeCompare(b,'ru')) };
    const snapshot = { ledger:snapshotLedger,vehicles:temporal?projection.vehicles.filter(row=>selected.ids.has(row.id)):db.vehicles.filter(row=>selected.ids.has(row.id)).map(vehicleProjection),records:db.records.filter(row=>selected.ids.has(row.vehicleId)&&fuel.gsmInPeriod(row.date,scope.from,scope.to)) };
    return freeze(clone({ schemaVersion:1,...(modern?{calculationVersion}:{}),...parameters,sourceFingerprint:projectionFingerprint(projection,scope),sourceRefs:refs,rows,totals,consumption,
      issues,canPost:!issues.some(row=>row.severity==='error'),requiresBasisNote,snapshot }));
  }
  function actor(value) {
    if (!plain(value) || !(typeof value.id === 'string' && value.id.trim() || Number.isInteger(value.id) && value.id >= 0) || typeof value.name !== 'string' || !value.name.trim()) fail('INVALID_ACTOR','Укажите автора действия');
    return clone(value);
  }
  function timestamp(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().replace('.000Z','Z') === value.replace('.000Z','Z'); }
  function post(input, request, metadata) {
    if (!plain(metadata) || typeof metadata.id !== 'string' || !metadata.id.trim() || metadata.id.length > 200 || ['__proto__','constructor','prototype'].includes(metadata.id)) fail('INVALID_DOCUMENT_ID','Укажите устойчивый ID акта');
    if (typeof metadata.number !== 'string' || !metadata.number.trim() || metadata.number.length > 200) fail('INVALID_DOCUMENT_NUMBER','Укажите номер акта');
    if (!timestamp(metadata.postedAt)) fail('INVALID_TIMESTAMP','Некорректное время проведения');
    if ((input.fuelWriteoffs || []).some(row=>row.id===metadata.id)) fail('DOCUMENT_EXISTS','Акт с таким ID уже существует');
    const prepared = prepare(input,request);
    if (typeof metadata.expectedFingerprint !== 'string' || metadata.expectedFingerprint !== prepared.sourceFingerprint) fail('STALE_SOURCES','Источники изменились после предварительного расчёта; пересчитайте акт');
    if (!prepared.canPost) fail('WRITE_OFF_BLOCKED','Акт содержит ошибки источников: ' + prepared.issues.filter(row=>row.severity==='error').slice(0,5).map(row=>row.message).join('; '));
    if (prepared.requiresBasisNote && prepared.basisNote.length < 3) fail('BASIS_REQUIRED','Укажите основание нормативного списания');
    const by = actor(metadata.postedBy);
    return freeze(clone({...prepared,id:metadata.id,number:metadata.number.trim(),status:'posted',postedAt:metadata.postedAt,postedBy:by,events:[{type:'posted',at:metadata.postedAt,by}]}));
  }
  function voidDocument(document, metadata) {
    if (!plain(document) || document.status !== 'posted' || document.schemaVersion !== 1) fail('INVALID_TRANSITION','Аннулировать можно только проведённый акт');
    if (!plain(metadata) || typeof metadata.reason !== 'string' || metadata.reason.trim().length < 3 || metadata.reason.trim().length > 2000) fail('VOID_REASON_REQUIRED','Укажите причину аннулирования (от 3 до 2000 знаков)');
    if (!timestamp(metadata.voidedAt) || Date.parse(metadata.voidedAt) < Date.parse(document.postedAt)) fail('INVALID_TIMESTAMP','Некорректное время аннулирования');
    const by = actor(metadata.voidedBy), reason = metadata.reason.trim();
    return freeze(clone({...document,status:'void',voidedAt:metadata.voidedAt,voidedBy:by,voidReason:reason,events:[...(document.events || []),{type:'void',at:metadata.voidedAt,by,reason}]}));
  }
  function validateWriteoffChanges(previous, next) {
    if (!plain(previous) || !plain(next)) fail('INVALID_DATABASE','Требуется предыдущая и новая база');
    const before = previous.fuelWriteoffs == null ? [] : previous.fuelWriteoffs, after = next.fuelWriteoffs == null ? [] : next.fuelWriteoffs;
    for (const rows of [before,after]) {
      if (!Array.isArray(rows)) fail('INVALID_DOCUMENTS','Журнал актов должен быть массивом');
      const ids = new Set();
      for (const document of rows) {
        if (!plain(document) || typeof document.id !== 'string' || !document.id || ids.has(document.id) || !['posted','void'].includes(document.status)) fail('INVALID_DOCUMENTS','Повреждён журнал актов или повторяется ID');
        if(calculationVersion>=5)documentVersion(document,calculationVersion);
        ids.add(document.id);
      }
    }
    const old = new Map(before.map(document=>[document.id,document])), current = new Map(after.map(document=>[document.id,document]));
    let compatibility;
    const organizationHistories=input=>['vehicles','fuelCards'].map(section=>(input[section]||[]).map((row,index)=>({row,index})).filter(({row})=>Object.prototype.hasOwnProperty.call(row,'orgHistory')).map(({row,index})=>[row.id??row.number??index,row.orgHistory]));
    const organizationChanged=temporal&&(stableSerialize(organizationHistories(previous))!==stableSerialize(organizationHistories(next))||['vehicles','fuelCards'].some(section=>(next[section]||[]).some(row=>Object.prototype.hasOwnProperty.call(row,'orgHistoryOrigin'))));
    for (const document of before) {
      const changed = current.get(document.id);
      if (!changed) fail('DOCUMENT_DELETE_FORBIDDEN','Проведённые и аннулированные акты нельзя удалять');
      if (document.status === 'posted' && changed.status === 'void') {
        const expected = voidDocument(document,{voidedAt:changed.voidedAt,voidedBy:changed.voidedBy,reason:changed.voidReason});
        if (stableSerialize(expected) !== stableSerialize(changed)) fail('DOCUMENT_IMMUTABLE','При аннулировании нельзя изменять снимок акта');
      } else if (stableSerialize(document) !== stableSerialize(changed)) fail('DOCUMENT_IMMUTABLE','Сохранённый акт неизменяем; сначала аннулируйте его');
      if(changed.status==='posted'){
        const version=documentVersion(document,calculationVersion>=5?calculationVersion:4);let source=next;
        if(organizationChanged&&version<3){
          if(!compatibility){const api=getTemporal();if(api?.apiVersion!==1||typeof api.compatibilitySnapshot!=='function')fail('MODULE_UNAVAILABLE','Не загружена проверка совместимости истории организации');compatibility=api.compatibilitySnapshot(previous,next);}
          source=compatibility;
        }
        if(forVersion(version).fingerprint(source,{...changed.scope,date:changed.date})!==changed.sourceFingerprint)fail('POSTED_SOURCE_LOCKED','Источники проведённого акта изменены; сначала аннулируйте акт');
      }
    }
    for (const document of after) if (!old.has(document.id)) {
      if (document.status !== 'posted') fail('INVALID_TRANSITION','Нельзя создать сразу аннулированный акт');
      const withoutOwn = {...next,fuelWriteoffs:after.filter(row=>row.id!==document.id)};
      const expected = forVersion(calculationVersion>=5?calculationVersion:corrected?4:temporal?3:2).post(withoutOwn,{...document.scope,date:document.date,basisNote:document.basisNote},
        {id:document.id,number:document.number,postedAt:document.postedAt,postedBy:document.postedBy,expectedFingerprint:document.sourceFingerprint});
      if (stableSerialize(expected) !== stableSerialize(document)) fail('DOCUMENT_RECALCULATION_FAILED','Снимок акта не совпадает с серверным пересчётом');
    }
    return true;
  }
  return Object.freeze({apiVersion:1,schemaVersion:1,calculationVersion,sourceSections,requiredSections,prepare,preview:prepare,fingerprint,post,voidDocument,
    validateWriteoffChanges,validateDocuments:validateWriteoffChanges,stableSerialize,sha256});
  }
  function documentVersion(document,maxVersion=6){const version=Object.prototype.hasOwnProperty.call(document,'calculationVersion')?document.calculationVersion:Object.prototype.hasOwnProperty.call(document,'algorithmVersion')?document.algorithmVersion:1;if(version!==1&&version!==2&&version!==3&&version!==4&&version!==5&&version!==6||version>maxVersion)throw Object.assign(Error('Неизвестная версия расчёта проведённого акта'),{name:'FuelWriteoffError',code:'CALCULATION_VERSION'});return version;}
  const legacy=makeEngine(1),decimalVersion=makeEngine(2),temporalVersion=makeEngine(3),correctedVersion=makeEngine(4),allocatedVersion=makeEngine(5),current=makeEngine(6);
  function forVersion(version){if(version!==1&&version!==2&&version!==3&&version!==4&&version!==5&&version!==6)throw Object.assign(Error('Неизвестная версия расчёта акта'),{name:'FuelWriteoffError',code:'CALCULATION_VERSION'});return version===1?legacy:version===2?decimalVersion:version===3?temporalVersion:version===4?correctedVersion:version===5?allocatedVersion:current;}
  return Object.freeze({...current,forVersion});
});
