/* Portable fuel calculations. Input databases are read-only; browser/storage state stays in adapters. */
(function (root, factory) {
  'use strict';
  const api = factory(typeof module === 'object' && module.exports ? () => require('./accounting-boundary.js') : () => root.AccountingBoundary,
    typeof module === 'object' && module.exports ? () => require('./decimal-core.js') : () => root.DecimalCore,
    typeof module === 'object' && module.exports ? () => require('./effective-periods.js') : () => root.EffectivePeriods);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TvsFuelEngine = api;
})(typeof globalThis === 'object' ? globalThis : this, function (getAccounting,getDecimal,getPeriods) {
  'use strict';
  // JSON-safe typed index survives calculation caches, structured cloning and
  // worker transport. Ordinary unique IDs keep their former property aliases.
  const balanceIndexField='$fuelRecordBalances';
  const balanceId=id=>typeof id==='string'||typeof id==='number'&&Number.isFinite(id);
  const balanceKey=id=>JSON.stringify([typeof id,id]);
  function recordBalanceMap(entries){
    const values={},aliases=new Map();
    for(const [id,value] of entries){
      if(!balanceId(id))continue;
      const key=balanceKey(id),alias=String(id);
      values[key]=value;
      const group=aliases.get(alias)||new Set();group.add(key);aliases.set(alias,group);
    }
    if(!Object.keys(values).length)return {};
    const result={[balanceIndexField]:{version:1,values}};
    for(const [alias,keys]of aliases)if(keys.size===1&&![balanceIndexField,'__proto__','constructor','prototype'].includes(alias))
      Object.defineProperty(result,alias,{value:values[[...keys][0]],enumerable:true,configurable:true,writable:true});
    return result;
  }
  function recordBalanceAt(balances,id){
    if(!balances||typeof balances!=='object'||!balanceId(id))return undefined;
    const index=Object.prototype.hasOwnProperty.call(balances,balanceIndexField)?balances[balanceIndexField]:null;
    if(index&&typeof index==='object'&&index.version===1&&index.values&&typeof index.values==='object'){
      const key=balanceKey(id);return Object.prototype.hasOwnProperty.call(index.values,key)?index.values[key]:undefined;
    }
    // Frozen historical readers and older generator adapters return plain maps.
    return Object.prototype.hasOwnProperty.call(balances,id)?balances[id]:undefined;
  }
  function makeEngine(calculationVersion,liveJournal=false){
  const modern=calculationVersion>=2,temporal=calculationVersion>=3,corrected=calculationVersion>=4,allocated=calculationVersion>=5,verified=calculationVersion>=6;
  const has=(row,key)=>row&&Object.prototype.hasOwnProperty.call(row,key);
  const live=row=>!row.deleted&&!row.cancelled&&row.status!=='cancelled';
  const idOr=(id,fallback='')=>corrected?(id??fallback):(id||fallback);
  function periods(){const api=getPeriods();if(api?.apiVersion!==1)throw Object.assign(Error('Не загружены датированные параметры'),{code:'MODULE_UNAVAILABLE'});return api;}
  function preparedVehicle(row){
    if(!temporal||!row)return row;
    let result=row;
    for(const kind of ['fuelNorms','orgHistory'])if(has(row,kind)){
      if(kind==='orgHistory'&&Array.isArray(row.orgHistory)&&!row.orgHistory.length)continue;
      const validated=periods().validate('vehicles',row,kind);if(validated.mode==='legacy')continue;
      if(result===row)result={...row};result[kind]=validated;
    }return result;
  }
  function organization(section,row,date){
    if(!temporal||!has(row,'orgHistory')||Array.isArray(row.orgHistory)&&!row.orgHistory.length)return null;
    if(!gsmValidDate(date))return {status:'missing',parameters:null,reason:'invalid-date'};
    return periods().resolve(section,row,date,'orgHistory');
  }
  function decimal(){const api=getDecimal();if(api?.apiVersion!==1)throw Object.assign(Error('Не загружена десятичная арифметика'),{code:'MODULE_UNAVAILABLE'});return api;}
  // Intermediate ratios have an explicit 12-place budget; recorded facts remain untouched.
  function decimalNumber(value,places=12){const d=decimal();return d.toNumberExact(d.quantize(value,{scale:places,rounding:'half-away-from-zero'}));}
  function millilitres(value){
    if(typeof value!=='number'||!Number.isFinite(value))return null;
    const text=String(value),match=/^(-?)(\d+)(?:\.(\d{1,3}))?$/.exec(text);if(!match)return null;
    const units=Number((match[1]||'')+match[2]+(match[3]||'').padEnd(3,'0'));return Number.isSafeInteger(units)?units:null;
  }
  function fixedAdd(a,b,subtract){
    const left=millilitres(a),right=millilitres(b);
    if(left!==null&&right!==null){const units=subtract?left-right:left+right,result=units/1000;if(Number.isSafeInteger(units)&&millilitres(result)===units)return result;}
    const result=subtract?decimal().sub(a,b):decimal().add(a,b);return corrected?decimal().toNumberExact(result):decimalNumber(result);
  }
  const plus=(a,b)=>modern?fixedAdd(a,b,false):a+b;
  const minus=(a,b)=>modern?fixedAdd(a,b,true):a-b;
  const times=(a,b)=>!modern?a*b:Number.isFinite(a)&&Number.isFinite(b)&&(a===0||b===0||a===1||b===1)?a===0||b===0?0:a===1?b:a:decimalNumber(decimal().mul(a,b));
  const ratio=(a,b)=>!modern?a/b:Number.isFinite(a)&&Number.isFinite(b)&&b!==0&&(a===0||a===b)?a===0?0:1:decimalNumber(decimal().div(a,b,{scale:12,rounding:'half-away-from-zero'}));
  // Allocation is derived data, unlike the exact source litres above. Keep its
  // twelve-place intermediates in decimal form until the public 0.001 quantum.
  // Converting a long accumulated fraction to Number sooner can reject ordinary
  // kilometre totals even though their final three-place result is representable.
  const allocatedPart=(value,qty,total)=>total>0?decimal().div(decimal().mul(value,qty),total,{scale:12,rounding:'half-away-from-zero'}):decimal().parse(value);
  const allocatedNumber=value=>decimal().toNumberExact(decimal().quantize(value,{scale:3,rounding:'half-away-from-zero'}));
  const allocatedOutput=value=>{const number=Number(value);return Number.isFinite(number)&&decimal().parse(number)===value?number:allocatedNumber(value);};

function fuelAccounting(section,asset) {
  const api=getAccounting();
  if(api?.apiVersion===1)return api.resolve(section,asset||{});
  if(asset&&Object.prototype.hasOwnProperty.call(asset,'fuelAccounting'))throw Object.assign(Error('Не загружены правила начала учёта ГСМ'),{code:'MODULE_UNAVAILABLE'});
  return {mode:'legacy'};
}

function parseFuelGrade(text) {
  const source = String(text || '').toUpperCase().replace(/Ё/g, 'Е')
    .replace(/A/g, 'А').replace(/I/g, 'И').replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-');
  const g = source.replace(/[\s_]+/g, '');
  if (/(^|[^А-Я])ДТ|ДИЗ|^DT/.test(g)) return 'ДТ';
  // Keep the separator before a receipt quantity: «Аи-92 30л» is АИ-92,
  // not АИ-923. Preserve already stored 2/3-digit legacy grade tokens.
  const ai = source.match(/А[\s_]*И[\s_]*-?[\s_]*(\d{2,3})(?!\d)/);
  if (ai) return 'АИ-' + ai[1];
  if (/ГАЗ|ГБО|ПРОПАН|МЕТАН|СУГ/.test(g)) return 'Газ';
  // Фирменные бензины: «G-Drive 95», «Бензин 92», «Ultimate 98»
  const oct = source.match(/(?:^|\D)(92|95|98|100)(?:\D|$)/);
  if (oct) return 'АИ-' + oct[1];
  return '';
}
// Вид топлива машины. Марка (ДТ, АИ-92…) — главное поле, общий признак
// fuel (diesel/gasoline/gas) выводится из неё: по нему работают фильтры и сводки.
function vehicleFuelGrade(v) {
  const g = parseFuelGrade(v && v.fuelGrade);
  if (g) return g;
  const f = v && v.fuel;
  return f === 'gasoline' ? 'Бензин' : f === 'gas' ? 'Газ' : 'ДТ';
}
function fuelTypeFromGrade(grade) {
  return grade === 'ДТ' ? 'diesel' : grade === 'Газ' ? 'gas' : 'gasoline';
}
// Вид топлива записи пробега: своя марка из записи, иначе — марка машины
function recordFuelGrade(r, v, db) {
  return parseFuelGrade(r && r.fuelGrade) || vehicleFuelGrade(v || (db && db.vehicles || []).find(x => x.id === (r && r.vehicleId)));
}

function fqValue(value) {
  if (value == null || typeof value === 'string' && value.trim() === '') return null;
  if(verified)return sourceNumber(value);
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function fqRecord(record, vehicle) {
  const km = Math.max(0, fqValue(record.km) || 0);
  const storedNorm = fqValue(record.fuelUsed);
  const issueOnly=temporal&&record.km===0&&fqValue(record.fuelActual)==null&&storedNorm==null&&(fqValue(record.fuelIdle)==null||fqValue(record.fuelIdle)===0)&&
    (typeof record.fuelMovementId==='string'&&record.fuelMovementId.trim()!==''||typeof record.fuelMovementId==='number'&&Number.isFinite(record.fuelMovementId));
  const selected=temporal&&has(vehicle,'fuelNorms')&&storedNorm==null&&!issueOnly?periods().resolve('vehicles',vehicle,record.date,'fuelNorms'):null;
  const rate=selected?(selected.status==='known'?fqValue(selected.parameters.norm):null):fqValue(vehicle && vehicle.norm);
  const norm = storedNorm != null ? storedNorm : issueOnly?0:rate != null ? (allocated?allocatedNumber(decimal().div(decimal().mul(km,rate),100,{scale:12,rounding:'half-away-from-zero'})):modern?gsmRound(ratio(times(km,rate),100)):km * rate / 100) : null;
  const actual = fqValue(record.fuelActual), idleValue = fqValue(record.fuelIdle), idle = idleValue || 0;
  const driving = actual != null ? actual : norm;
  return { driving, norm, idle, total: driving == null ? idleValue : plus(driving,idle), partial:driving == null && idleValue != null,
    source: actual != null ? 'actual' : norm != null ? 'norm' : 'missing',
    actual, actualKm: actual != null ? km : 0,
    normSource: storedNorm != null ? 'record' : issueOnly?'issue':norm != null ? (selected?'period':'vehicle') : 'missing',
    ...(temporal&&selected?{normPeriod:selected}:{}) };
}
function fqFuelFamily(grade) {
  return grade === 'ДТ' ? 'diesel' : grade === 'Газ' ? 'gas' : /^АИ-\d+$/.test(grade || '') || grade === 'Бензин' ? 'gasoline' : 'unknown';
}
function fqRecordFuelFamily(record, vehicle) {
  const grade = parseFuelGrade(record.fuelGrade) || (String(record.fuelGrade || '').trim() === 'Бензин' ? 'Бензин' : vehicleFuelGrade(vehicle));
  return fqFuelFamily(grade);
}
function fqMeasurementPlan(records, vehicle) {
  const keyFor = record => record.date + '|' + fqRecordFuelFamily(record, vehicle);
  const lastOnDate = new Map(records.map(record => [keyFor(record), record.id]));
  const measurements = new Map(records.filter(record => verified ? sourceQuantity(record.tankMeasured) !== null && fqDate(record.date) : fqValue(record.tankMeasured) != null && Number(record.tankMeasured) >= 0)
    .map(record => [keyFor(record), record]));
  return { keyFor, lastOnDate, measurements };
}
function fqDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(value + 'T12:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function fqShiftDate(value, days) {
  const date = new Date(value + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function fqDays(from, to) {
  return fqDate(from) && fqDate(to) && to >= from ? Math.round((new Date(to + 'T12:00:00Z') - new Date(from + 'T12:00:00Z')) / 86400000) + 1 : 0;
}

const GSM_UNKNOWN_ORG = 'Организация не определена';
const GSM_EPS = corrected?0:modern?0.0000001:0.001;
const SOURCE_EPS = corrected?0:modern?0.0000001:0.011;
const LOT_EPS=corrected?0:0.0000001;

function gsmNumber(value) { if(verified)return fqValue(value)??0;const n = Number(value); return Number.isFinite(n) ? n : 0; }
function gsmRound(value) { const number=gsmNumber(value);return allocated&&(typeof value==='number'&&Number.isFinite(value)||typeof value==='string'&&/^[+-]?(?:\d+)(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value)&&Number.isFinite(Number(value)))?allocatedNumber(value):modern?(millilitres(number)!==null?number===0?0:number:decimalNumber(number,3)):Math.round(number * 1000) / 1000; }
function gsmCardKey(value) {
  const text = String(corrected?(value??''):(value || '')).trim();
  return text.replace(/\D/g, '') || text.toUpperCase();
}
function gsmOrgKey(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');
}
function gsmGrade(value, fallback) {
  return (typeof parseFuelGrade === 'function' && parseFuelGrade(value)) || (String(value || '').trim() === 'Бензин' ? 'Бензин' : '') || fallback || 'Не указано';
}
function gsmVehicleGrade(v) {
  return typeof vehicleFuelGrade === 'function' ? vehicleFuelGrade(v) : gsmGrade(v.fuelGrade, v.fuel === 'gasoline' ? 'Бензин' : 'ДТ');
}
function gsmFamily(grade) { return grade === 'ДТ' ? 'diesel' : grade === 'Газ' ? 'gas' : /^АИ-\d+$/.test(grade) || grade === 'Бензин' ? 'gasoline' : 'unknown'; }
function gsmInPeriod(date, from, to) { return (!from || date >= from) && (!to || date <= to); }
function gsmValidDate(date) {
  const parsed = new Date(date + 'T12:00:00Z');
  return /^\d{4}-\d{2}-\d{2}$/.test(date || '') && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}
function gsmMonthRange(month) {
  if (!month || month === 'all') return { from: '', to: '' };
  const [y, m] = month.split('-').map(Number);
  return { from: month + '-01', to: month + '-' + new Date(Date.UTC(y, m, 0)).getUTCDate() };
}
function gsmVehicleOrgAt(v, date) {
  if (!v) return '';
  const dated=organization('vehicles',v,date);if(dated)return dated.status==='known'?dated.parameters.org:'';
  const history = (v.orgHistory || []).filter(h => (!h.from || h.from <= date) && (!h.to || h.to >= date));
  return String(history.length ? history[history.length - 1].org : v.org || '').trim();
}
function gsmCardAt(db, number, date) {
  const key = gsmCardKey(number);
  const card = key && (db.fuelCards || []).find(c => gsmCardKey(c.number) === key);
  const assignments = card ? (card.assignments || []).filter(a => (!a.from || a.from <= date) && (!a.to || a.to >= date)) : [];
  const assignment = assignments[assignments.length - 1];
  const holders = (db.vehicles || []).filter(v => key && gsmCardKey(v.fuelcard) === key);
  const vehicle = assignment ? (db.vehicles || []).find(v => v.id === assignment.vehicleId) : (!card && holders.length === 1 ? holders[0] : null);
  const history = card ? (card.orgHistory || []).filter(h => (!h.from || h.from <= date) && (!h.to || h.to >= date)) : [];
  const dated=card&&organization('fuelCards',card,date);
  const org = dated?(dated.status==='known'?dated.parameters.org:''):String(history.length ? history[history.length - 1].org : (card && card.org) || (assignment && assignment.org) || gsmVehicleOrgAt(vehicle, date) || '').trim();
  return { card, org, provider: card && card.provider || '', vehicleId: corrected?(vehicle?vehicle.id:idOr(assignment?.vehicleId)):vehicle && vehicle.id || assignment && assignment.vehicleId || '', vehicle };
}

function sourceNumber(value) {
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  if(typeof value!=='number'&&typeof value!=='string'||typeof value==='string'&&!value.trim())return null;
  try{return decimal().toNumberExact(decimal().parse(value));}catch{return null;}
}
function sourceQuantity(value) { const number=sourceNumber(value);return number!==null&&number>=0?number:null; }
function openingEvidence(db,vehicleId,options={}) {
  const vehicle=(db.vehicles||[]).find(row=>row.id===vehicleId),family=options.family||fqRecordFuelFamily({},vehicle),before=options.before||'';
  if(!vehicle)return {status:'missing',family,reason:'vehicle-missing'};
  const boundary=fuelAccounting('vehicles',vehicle);
  if(boundary.mode==='explicit')return before&&before<boundary.from?{status:'outside-accounting',family,date:boundary.from}:{status:'known',source:'accounting',family,date:boundary.from,value:boundary.opening};
  const legacy=sourceQuantity(vehicle.fuelBalance);
  if(legacy!==null)return {status:'known',source:'legacy',family,value:legacy};
  if(before){
    const records=(db.records||[]).filter(row=>row.vehicleId===vehicleId&&live(row)&&fqDate(row.date)&&row.date<before).slice().sort((a,b)=>a.date.localeCompare(b.date));
    const plan=fqMeasurementPlan(records,vehicle);
    const measurement=[...plan.measurements.values()].filter(row=>fqRecordFuelFamily(row,vehicle)===family&&
      (!row.fuelGrade||parseFuelGrade(row.fuelGrade)||String(row.fuelGrade).trim()==='Бензин')).sort((a,b)=>b.date.localeCompare(a.date))[0];
    if(measurement)return {status:'known',source:'measurement',family,date:measurement.date,recordId:measurement.id,value:sourceQuantity(measurement.tankMeasured)};
  }
  return {status:'missing',family,reason:'opening-not-confirmed'};
}

function gsmBuildLedger(db, options) {
  options = options || {};
  const from = options.from || '', to = options.to || '';
  const vehicles = new Map((db.vehicles || []).map(v => [v.id, preparedVehicle(v)]));
  const boundaries=new Map([...vehicles].map(([id,vehicle])=>[id,fuelAccounting('vehicles',vehicle)]));
  const hasExplicit=[...boundaries.values()].some(boundary=>boundary.mode==='explicit');
  const current=(id,date)=>{const boundary=boundaries.get(id);return boundary?.mode!=='explicit'||!gsmValidDate(date)||date>=boundary.from;};
  const purchases=(db.fuelPurchases||[]).filter(row=>(!corrected||live(row))&&current(row.vehicleId,row.date));
  const records = (db.records || []).filter(r => (!corrected||live(r))&&vehicles.has(r.vehicleId)&&current(r.vehicleId,r.date));
  const accounting=[];
  const canonicalDays=new Set(records.filter(r=>r.glonassCanonical).map(r=>JSON.stringify([r.vehicleId,r.date])));
  const byRecord = new Map(records.map(r => [r.id, []])), ambiguous = new Set();
  const receipts = [], issues = [], rows = new Map(), movements = [], journal = [];
  const issueKeys = new Set();
  const issue = (code, severity, details) => {
    const parts=[code,idOr(details.recordId),idOr(details.purchaseId),idOr(details.vehicleId),details.date||'',details.org||'',details.grade||''];if(allocated&&code==='rounding-allocation'||verified&&code==='source-number')parts.push(details.field||'');const key=corrected?JSON.stringify(parts):parts.join('|');
    if (!issueKeys.has(key)) { issues.push(Object.assign({ code, severity }, details)); issueKeys.add(key); }
  };
  if(modern){
    const inspectPrecision=(section,list,fields)=>list.forEach(row=>Object.entries(fields).forEach(([field,places])=>{
      const raw=row[field],value=fqValue(raw);
      if(verified&&raw!=null&&!(typeof raw==='string'&&!raw.trim())&&(value===null||value<0)){
        issue('source-number','error',{section,sourceId:row.id,vehicleId:section==='vehicles'?row.id:row.vehicleId,date:row.date||'',field,
          ...(section==='records'?{recordId:row.id}:section==='fuelPurchases'?{purchaseId:row.id}:{}),...(row.org?{org:row.org}:{}),...(row.grade?{grade:row.grade}:{}),
          message:'Некорректное числовое значение '+field+'. Укажите полное неотрицательное десятичное число по первоисточнику; исходное значение сохранено'});
        return;
      }
      if(value===null)return;
      try{decimal().parse(value,{scale:places});}catch(error){if(error.code!=='PRECISION')throw error;
        issue('source-precision','warning',{section,sourceId:row.id,vehicleId:section==='vehicles'?row.id:row.vehicleId,date:row.date||'',field,qty:value,
          message:'Сохранённый источник содержит расширенную точность '+field+' = '+String(value)+'; исходное значение сохранено, отображение округлено явно'});
      }
    }));
    inspectPrecision('records',records,{fuelIssued:3,fuelActual:3,fuelUsed:3,fuelIdle:3,tankMeasured:3,km:3,kmGlonass:3});
    inspectPrecision('fuelPurchases',purchases,{qty:3,...(verified?{sum:2,price:6}:{})});
    inspectPrecision('vehicles',[...vehicles.values()].filter(row=>boundaries.get(row.id).mode==='legacy'),{fuelBalance:3});
    if(verified){
      inspectPrecision('vehicles',[...vehicles.values()],{norm:6,normCity:6,normHighway:6,normIdle:6,tankVolume:3});
      for(const vehicle of vehicles.values())if(boundaries.get(vehicle.id).mode==='legacy'&&Array.isArray(vehicle.fuelBalanceSources))inspectPrecision('opening',vehicle.fuelBalanceSources.map(source=>({...source,id:vehicle.id,vehicleId:vehicle.id})),{qty:3});
    }
  }
  const rowFor = (vehicleId, org, grade) => {
    const key = [vehicleId, gsmOrgKey(org), grade].join('|');
    const mapKey=JSON.stringify([vehicleId,gsmOrgKey(org),grade]);
    if (!rows.has(mapKey)) rows.set(mapKey, { key, vehicleId, vehicle: vehicles.get(vehicleId), org: org || GSM_UNKNOWN_ORG, grade,
      ...(boundaries.get(vehicleId)?.mode==='explicit'?{accountingFrom:boundaries.get(vehicleId).from}:{}),
      start: 0, issued: 0, spent: 0, idle: 0, norm: 0, km: 0, glonass: 0, end: 0, correction: 0, providers: {}, cards: new Set(), active: false });
    return rows.get(mapKey);
  };
  const addReceipt = receipt => {
    receipts.push(receipt);
    if (!receipt.org) receipt.org = GSM_UNKNOWN_ORG;
    if (receipt.org === GSM_UNKNOWN_ORG) issue('source-org', 'error', { date: receipt.date, vehicleId: receipt.vehicleId,
      purchaseId: receipt.purchaseId, recordId: receipt.recordId, qty: receipt.qty, message: 'Не определена организация карты', org: receipt.org, grade: receipt.grade });
    const v = vehicles.get(receipt.vehicleId);
    if (!v) { issue('vehicle', 'error', { purchaseId: receipt.purchaseId, date: receipt.date, qty: receipt.qty, org: receipt.org, grade: receipt.grade, message: 'Не выбрана фактически заправленная машина' }); return; }
    if (receipt.grade !== gsmVehicleGrade(v)) issue('fuel-grade', 'warning', {
      purchaseId: receipt.purchaseId, vehicleId: v.id, date: receipt.date, org: receipt.org, grade: receipt.grade,
      message: 'Топливо ' + receipt.grade + ' отличается от топлива машины ' + gsmVehicleGrade(v) });
  };
  const duplicateGroups = new Map();
  purchases.filter(p => !p.deleted && gsmNumber(p.qty) > 0).forEach(p => {
    const key = [p.date, gsmCardKey(p.cardNo), gsmRound(p.qty), gsmGrade(p.grade || p.product)].join('|');
    if (!duplicateGroups.has(key)) duplicateGroups.set(key, []);
    duplicateGroups.get(key).push(p);
  });
  duplicateGroups.forEach(list => {
    if (list.length < 2 || !list.some(p => p.restored)) return;
    list.forEach(p => issue('purchase-duplicate', 'error', { purchaseId: p.id, vehicleId: p.vehicleId, date: p.date,
      org: p.sourceOrg || gsmCardAt(db, p.cardNo, p.date).org, grade: gsmGrade(p.grade || p.product), qty: gsmNumber(p.qty),
      message: 'Возможный повтор восстановления: ' + list.length + ' операций по ' + p.qty + ' л. Сверьте с исходной выпиской' }));
  });

  purchases.filter(p => !p.deleted && gsmNumber(p.qty) > 0).forEach(p => {
    if (!gsmValidDate(p.date)) {
      issue('date', 'error', { purchaseId: p.id, vehicleId: p.vehicleId, message: 'Некорректная дата покупки' });
      return;
    }
    const v = vehicles.get(p.vehicleId);
    const owner = gsmCardAt(db, p.cardNo, p.date);
    const rawGrade = p.grade || p.product;
    const grade = gsmGrade(rawGrade, rawGrade ? 'Не указано' : v ? gsmVehicleGrade(v) : 'Не указано');
    if (grade === 'Не указано' || !rawGrade) issue('unknown-grade', 'error', { purchaseId: p.id, vehicleId: p.vehicleId, date: p.date, org: p.sourceOrg || owner.org,
      message: 'Проверьте марку топлива покупки: ' + (rawGrade || 'не указана') });
    let linked = records.find(r => r.id === p.recordId && r.vehicleId === p.vehicleId && r.date === p.date);
    if (!linked && v) {
      const candidates = records.filter(r => r.vehicleId === p.vehicleId && r.date === p.date && gsmGrade(r.fuelGrade, gsmVehicleGrade(v)) === grade);
      if (candidates.length === 1) linked = candidates[0];
      else candidates.forEach(r => ambiguous.add(r.id));
    }
    const receipt = { id: p.id, purchaseId: p.id, vehicleId: idOr(p.vehicleId), date: p.date || '', time: p.time || '',
      qty: gsmNumber(p.qty), sum: fqValue(p.sum), grade, cardNo: p.cardNo || '', org: p.sourceOrg || owner.org || (p.manual && v ? gsmVehicleOrgAt(v, p.date) : ''),
      provider: p.sourceProvider || owner.provider || '', cardVehicleId: idOr(p.cardVehicleId,owner.vehicleId),
      recordId: corrected?(linked?linked.id:''):linked && linked.id || '', manual: !!p.manual, product: p.product || grade };
    addReceipt(receipt);
    if (linked) byRecord.get(linked.id).push(receipt);
    else if (v) issue('journal-missing', 'error', { vehicleId: v.id, purchaseId: p.id, date: p.date, org: receipt.org, grade,
      qty: receipt.qty, message: 'Покупка не связана со строкой журнала пробега' });
  });

  records.forEach(r => {
    const v = vehicles.get(r.vehicleId), list = byRecord.get(r.id), qty = gsmNumber(r.fuelIssued);
    const grade = gsmGrade(r.fuelGrade, gsmVehicleGrade(v));
    if (r.fuelGrade && gsmGrade(r.fuelGrade) === 'Не указано') issue('unknown-grade', 'error', {
      vehicleId: v.id, recordId: r.id, date: r.date, orgs: list.length ? [...new Set(list.map(p => p.org))] : [r.fuelOrg || gsmCardAt(db, r.fuelCardNum, r.date).org || gsmVehicleOrgAt(v, r.date)], message: 'Не распознана марка топлива журнала: ' + r.fuelGrade });
    if (!gsmValidDate(r.date)) {
      issue('date', 'error', { vehicleId: v.id, recordId: r.id, message: 'Некорректная дата журнала' });
      return;
    }
    const effectiveOwner=organization('vehicles',v,r.date);
    if(effectiveOwner?.status==='missing')issue('organization-period-missing','error',{vehicleId:v.id,recordId:r.id,date:r.date,grade,reason:effectiveOwner.reason,
      message:'Нет однозначной организации техники на '+r.date+'; проверьте пробелы и пересечения истории принадлежности'});
    if (list.length) {
      const summed=list.reduce((s,p)=>plus(s,p.qty),0),total=corrected?summed:gsmRound(summed);
      if (Math.abs(total - qty) > SOURCE_EPS) issue('journal-difference', 'error', { vehicleId: v.id, recordId: r.id, date: r.date,
        orgs: [...new Set(list.map(p => p.org))], grade, qty: total, journalQty: qty,
        message: 'Выписка ' + total + ' л, журнал ' + qty + ' л' });
      return;
    }
    if (qty <= 0) return;
    if (ambiguous.has(r.id)) {
      issue('journal-ambiguous', 'error', { vehicleId: v.id, recordId: r.id, date: r.date, grade,
        message: 'Несколько строк журнала: нужно явно привязать покупки; ручной приход не добавлен повторно' });
      return;
    }
    const owner = gsmCardAt(db, r.fuelCardNum, r.date);
    const cardReference = !r.fuelCardNum && !r.fuelOrg && /карт[а-яё]*/i.test(r.note || '');
    const org = corrected&&has(r,'fuelOrg')?r.fuelOrg:r.fuelOrg || owner.org || (!r.fuelCardNum && !cardReference ? gsmVehicleOrgAt(v, r.date) : '');
    if (cardReference) issue('manual-card-reference', 'error', { vehicleId: v.id, recordId: r.id, date: r.date,
      message: 'В примечании указана карта, но номер не выбран: ' + r.note });
    addReceipt({ id: 'journal:' + r.id, recordId: r.id, vehicleId: v.id, date: r.date, time: '', qty, sum: fqValue(r.fuelSum),
      grade, cardNo: r.fuelCardNum || '', org, provider: r.fuelProvider || owner.provider || v.supplier || 'Ручное поступление',
      cardVehicleId: owner.vehicleId, manual: true, product: grade });
    if (!r.fuelCardNum && !r.fuelOrg&&(!corrected||!has(r,'fuelOrg'))) issue('manual-source', 'warning', { vehicleId: v.id, recordId: r.id, date: r.date, org, grade, qty,
      message: 'Ручная заправка отнесена к организации машины; карта не указана' });
  });

  (db.monthlyFuel || []).filter(m => (!corrected||live(m))&&m.liters != null && m.liters !== '').forEach(m => {
    const boundary=boundaries.get(m.vehicleId);
    if(boundary?.mode==='explicit'&&typeof m.month==='string'&&/^\d{4}-\d{2}$/.test(m.month)){
      const coverage=getAccounting().window(boundary,gsmMonthRange(m.month));
      if(coverage.status==='outside-accounting')return;
      if(coverage.status==='partial'){issue('accounting-partial-month','warning',{vehicleId:m.vehicleId,date:m.month+'-01',message:'Месячная сверка включает дни до начала учёта ГСМ; она не сравнивается с частичным периодом'});return;}
    }
    const list = receipts.filter(p => p.vehicleId === m.vehicleId && p.date.slice(0, 7) === m.month && (!m.cardNumber || gsmCardKey(p.cardNo) === gsmCardKey(m.cardNumber)));
    const summed=list.reduce((s,p)=>plus(s,p.qty),0),total=corrected?summed:gsmRound(summed);
    if (Math.abs(total - gsmNumber(m.liters)) > SOURCE_EPS) issue('monthly-difference', 'error', { vehicleId: m.vehicleId, date: m.month + '-01',
      org: gsmCardAt(db, m.cardNumber, m.month + '-01').org, qty: total, journalQty: gsmNumber(m.liters),
      message: 'Месячная сверка: указано ' + m.liters + ' л, в операциях ' + total + ' л' });
  });

  vehicles.forEach(v => {
    const boundary=boundaries.get(v.id);
    if(boundary.mode==='explicit'){
      const coverage=getAccounting().window(boundary,{from,to});accounting.push({vehicleId:v.id,...coverage,from:boundary.from,opening:boundary.opening,basis:boundary.basis});
      if(coverage.status==='outside-accounting'){issue('outside-accounting','warning',{vehicleId:v.id,date:to,message:'Период полностью предшествует началу учёта ГСМ '+boundary.from});return;}
    }
    const lots = [], defaultGrade = gsmVehicleGrade(v), defaultOrg = (temporal&&boundary.mode!=='explicit'?String(v.org||'').trim():gsmVehicleOrgAt(v, boundary.mode==='explicit'?boundary.from:'')) || GSM_UNKNOWN_ORG;
    const initialKnown=!verified||openingEvidence(db,v.id,{family:gsmFamily(defaultGrade)}).status==='known',measuredFamilies=new Set();
    let lotTotal=0;const familyTotals=new Map();
    const changeStock=(grade,qty)=>{if(modern){lotTotal=plus(lotTotal,qty);const family=gsmFamily(grade);familyTotals.set(family,plus(familyTotals.get(family)||0,qty));}};
    const initial = boundary.mode==='explicit'?boundary.opening:gsmNumber(v.fuelBalance);
    const initialSources = boundary.mode==='explicit'?(boundary.sources||[{org:defaultOrg,grade:defaultGrade,qty:initial}]):Array.isArray(v.fuelBalanceSources) && v.fuelBalanceSources.length ? v.fuelBalanceSources : [{ org: defaultOrg, grade: defaultGrade, qty: initial }];
    if (Math.abs(minus(initialSources.reduce((s, x) => plus(s,gsmNumber(x.qty)), 0),initial)) > SOURCE_EPS) issue('opening-difference', 'error', {
      vehicleId: v.id, date: '', org: defaultOrg, message: 'Распределение начального остатка не совпадает с карточкой машины' });
    let reconciliationSequence = 0;
    const supply = (source, qty, context) => {
      changeStock(source.grade,qty);
      let left = qty;
      for (const lot of lots) {
        if (left <= 0) break;
        if (lot.qty < 0 && gsmOrgKey(lot.org) === gsmOrgKey(source.org) && lot.grade === source.grade) { const q = Math.min(left, -lot.qty); lot.qty=plus(lot.qty,q); left=minus(left,q); }
      }
      const org = source.org || defaultOrg, grade = source.grade || defaultGrade;
      if (left > LOT_EPS && context && gsmOrgKey(org) && gsmOrgKey(org) !== gsmOrgKey(GSM_UNKNOWN_ORG) &&
          ['Бензин', 'АИ-92', 'АИ-95', 'АИ-98', 'АИ-100'].includes(grade)) {
        for (const debt of lots) {
          if (left <= LOT_EPS) break;
          if (debt.qty >= 0 || debt.origin !== 'shortage' || gsmOrgKey(debt.org) !== gsmOrgKey(org) || debt.grade === grade ||
              !['Бензин', 'АИ-92', 'АИ-95', 'АИ-98', 'АИ-100'].includes(debt.grade)) continue;
          const q = Math.min(left, -debt.qty);
          debt.qty=plus(debt.qty,q); left=minus(left,q);
          if (gsmInPeriod(context.date, from, to)) {
            rowFor(v.id, org, debt.grade).correction=plus(rowFor(v.id,org,debt.grade).correction,q);
            rowFor(v.id, org, grade).correction=minus(rowFor(v.id,org,grade).correction,q);
            const pairId = 'grade:' + v.id + ':' + (++reconciliationSequence);
            const movement = { kind: 'grade-reconciliation', pairId, date: context.date, vehicleId: v.id, org,
              fromGrade: grade, toGrade: debt.grade, qty: q, purchaseId: idOr(context.purchaseId), recordId: idOr(context.recordId),
              debtRecordId: idOr(debt.recordId), debtDate: debt.date || '', reason: 'Уточнение марки топлива ранее неподкреплённого расхода' };
            movements.push({ ...movement, grade: debt.grade, delta: q }, { ...movement, grade, delta: -q });
          }
        }
      }
      if (Math.abs(left) > LOT_EPS) lots.push({ org, grade, qty: left, provider: source.provider || '',
        origin: source.origin || '', recordId: idOr(source.recordId), date: source.date || '' });
    };
    initialSources.forEach(s => supply({ org: s.org || defaultOrg, grade: gsmGrade(s.grade, defaultGrade), provider: 'Начальный остаток' }, gsmNumber(s.qty)));
    const snapshot = field => {
      lots.forEach(lot => { if (Math.abs(lot.qty) > LOT_EPS) rowFor(v.id, lot.org, lot.grade)[field]=plus(rowFor(v.id,lot.org,lot.grade)[field],lot.qty); });
    };
    let started = !from;
    if (started) snapshot('start');
    const events = [];
    const vr = records.filter(r => r.vehicleId === v.id && gsmValidDate(r.date)).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const measurementPlan = fqMeasurementPlan(vr, v);
    receipts.filter(p => p.vehicleId === v.id).forEach(p => events.push({ date: p.date, order: 0, time: p.time, receipt: p }));
    vr.forEach(r => events.push({ date: r.date, order: 1, time: '', record: r }));
    events.sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.order - b.order || a.time.localeCompare(b.time));

    const consume = (qty, grade, date, recordId) => {
      let left = qty;
      const used = [];
      for (const lot of lots) {
        if (left <= LOT_EPS) break;
        if (lot.qty <= 0 || gsmFamily(lot.grade) !== gsmFamily(grade)) continue;
        const q = Math.min(lot.qty, left); lot.qty=minus(lot.qty,q); left=minus(left,q);changeStock(lot.grade,-q);
        used.push({ org: lot.org, grade: lot.grade, qty: q });
      }
      if (left > LOT_EPS) {
        supply({ org: defaultOrg, grade, origin: 'shortage', recordId, date }, -left);
        used.push({ org: defaultOrg, grade, qty: left });
        issue('shortage', 'error', { vehicleId: v.id, date, recordId, org: defaultOrg, grade, qty: corrected?left:gsmRound(left),
          message: 'Для списания не хватает ' + (corrected?decimal().parse(left):gsmRound(left)) + ' л ' + grade });
      }
      return used;
    };

    for (const event of events) {
      if (to && event.date > to) break;
      if (!started && event.date >= from) { snapshot('start'); started = true; }
      const included = gsmInPeriod(event.date, from, to);
      if (event.receipt) {
        const p = event.receipt; supply(p, p.qty, p);
        if (included) {
          const row = rowFor(v.id, p.org, p.grade); row.issued=plus(row.issued,p.qty); row.active = true;
          row.providers[p.provider || 'Поставщик не указан'] = plus((row.providers[p.provider || 'Поставщик не указан'] || 0),p.qty);
          if (p.cardNo) row.cards.add(p.cardNo);
          movements.push(Object.assign({ kind: 'receipt' }, p));
        }
        continue;
      }
      const r = event.record, grade = gsmGrade(r.fuelGrade, defaultGrade);
      const fuel = fqRecord(r,v);
      const norm = fuel.norm;
      const driving = fuel.driving;
      const idle = fuel.idle;
      if (driving < 0 || idle < 0 || gsmNumber(r.fuelIssued) < 0) issue('negative-input', 'error', {
        vehicleId: v.id, date: r.date, recordId: r.id, org: defaultOrg, orgs: [...new Set(lots.map(l => l.org))], grade, message: 'Отрицательные литры в журнале' });
      let spent = Math.max(0, fuel.total || 0);
      const measured = fqValue(r.tankMeasured) != null;
      const measurementKey = measurementPlan.keyFor(r);
      const appliedMeasurement=measurementPlan.lastOnDate.get(measurementKey) === r.id ? measurementPlan.measurements.get(measurementKey) : null;
      if (fuel.source === 'missing' && gsmNumber(r.km) > 0 && !appliedMeasurement) issue('consumption-missing','error',{vehicleId:v.id,date:r.date,recordId:r.id,grade,message:'Есть пробег, но не указан факт расхода и нет нормы для расчёта'});
      if (measured && Number(r.tankMeasured) < 0) issue('negative-measurement','error',{vehicleId:v.id,date:r.date,recordId:r.id,grade,message:'Отрицательный замер остатка'});
      if (appliedMeasurement) {
        const available = modern?(familyTotals.get(gsmFamily(grade))||0):lots.filter(l => gsmFamily(l.grade) === gsmFamily(grade)).reduce((s, l) => plus(s,l.qty), 0);
        const measuredSpent = minus(available,Number(appliedMeasurement.tankMeasured));
        if(verified&&(initialKnown||measuredFamilies.has(gsmFamily(grade)))&&measuredSpent>=0&&measuredSpent<idle)issue('measurement-idle-conflict','error',{
          vehicleId:v.id,date:r.date,recordId:r.id,measurementRecordId:appliedMeasurement.id,section:'records',sourceId:r.id,org:defaultOrg,grade,qty:measuredSpent,idle,
          message:'Расход по замеру '+decimal().parse(measuredSpent)+' л меньше введённого расхода на холостом ходу '+decimal().parse(idle)+' л. Проверьте замер и запись расхода; исходные значения сохранены'});
        if (measuredSpent >= 0) spent = measuredSpent;
        else {
          const correction = -measuredSpent;
          supply({ org: defaultOrg, grade }, correction, { date: r.date, recordId: r.id }); spent = 0;
          if (included) {
            rowFor(v.id, defaultOrg, grade).correction=plus(rowFor(v.id,defaultOrg,grade).correction,correction);
            movements.push({ kind: 'measurement-correction', source: 'measurement', date: r.date, vehicleId: v.id,
              recordId: r.id, measurementRecordId: appliedMeasurement.id, org: defaultOrg, grade,
              qty: correction, delta: correction, reason: 'Остаток по замеру выше расчётного' });
          }
          issue('measurement-surplus', 'error', { vehicleId: v.id, date: r.date, recordId: r.id, org: defaultOrg, grade,
            qty: gsmRound(correction), message: 'Замер выше расчётного остатка: нужен приход ' + gsmRound(correction) + ' л' });
        }
        if(verified)measuredFamilies.add(gsmFamily(grade));
      } else if (measured) issue('multiple-measurements', 'warning', { vehicleId: v.id, recordId: r.id, date: r.date, grade,
        message: 'Замер дня применяется после всех строк дня; при нескольких замерах берётся последний' });
      const used = consume(spent, grade, r.date, r.id);
      if (included) {
        const shares = used.length ? used : [{ org: defaultOrg, grade, qty: 0 }];
        let allocations;
        if(allocated){
          const source={idle:verified?idle:Math.min(idle,spent),norm,totalNorm:norm==null?null:plus(norm,idle),km:gsmNumber(r.km),glonass:(!canonicalDays.has(JSON.stringify([r.vehicleId,r.date]))||r.glonassCanonical?gsmNumber(r.kmGlonass):0)};
          allocations=shares.map(part=>Object.fromEntries(Object.entries(source).map(([field,value])=>[field,value==null?null:allocatedPart(value,part.qty,spent)])));
          // Give one stable part the exact decimal residual. A repeating ratio
          // must not multiply its twelve-place truncation by a large distance.
          const last=shares.map((part,index)=>({index,key:JSON.stringify([gsmOrgKey(part.org),part.grade,index])})).sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0)[0].index;
          for(const [field,value]of Object.entries(source))if(value!=null)allocations[last][field]=decimal().sub(value,decimal().sum(allocations.filter((_,index)=>index!==last).map(item=>item[field])));
          allocations=allocations.map(value=>Object.freeze({version:1,scale:12,rounding:'half-away-from-zero',...value}));
        }
        shares.forEach((part,partIndex) => {
          const share = spent > 0 ? ratio(part.qty,spent) : 1;
          const row = rowFor(v.id, part.org, part.grade); row.active = true;
          if(allocated){
            const allocation=allocations[partIndex];
            row.spent=plus(row.spent,part.qty);
            for(const field of ['idle','norm','km','glonass'])row[field]=decimal().add(row[field],allocation[field]??0);
            const movement={kind:'consumption',source:appliedMeasurement?'measurement':fuel.source,date:r.date,vehicleId:v.id,recordId:r.id,org:part.org,grade:part.grade,qty:part.qty,
              idle:allocatedOutput(allocation.idle),norm:allocation.norm==null?null:allocatedOutput(allocation.norm),totalNorm:allocation.totalNorm==null?null:allocatedOutput(allocation.totalNorm),km:allocatedOutput(allocation.km),...(shares.length>1?{allocation}:{}),
              ...(temporal&&fuel.normPeriod?{normPeriod:fuel.normPeriod}:{})};
            movements.push(movement);
            return;
          }
          row.spent=plus(row.spent,part.qty); row.idle=plus(row.idle,times(Math.min(idle,spent),share));
          row.norm=plus(row.norm,times(norm||0,share)); row.km=plus(row.km,times(gsmNumber(r.km),share)); row.glonass=plus(row.glonass,times((!canonicalDays.has(JSON.stringify([r.vehicleId,r.date]))||r.glonassCanonical?gsmNumber(r.kmGlonass):0),share));
          movements.push({ kind: 'consumption', source:appliedMeasurement?'measurement':fuel.source, date: r.date, vehicleId: v.id, recordId: r.id, org: part.org, grade: part.grade, qty: part.qty,
            idle: times(Math.min(idle,spent),share), norm: norm == null ? null : times(norm,share), totalNorm:norm == null ? null : times(plus(norm,idle),share), km: times(gsmNumber(r.km),share),...(temporal&&fuel.normPeriod?{normPeriod:fuel.normPeriod}:{}) });
        });
        journal.push({ recordId: r.id, vehicleId: v.id, date: r.date, grade, km: gsmNumber(r.km), norm, spent,
          issued: gsmNumber(r.fuelIssued), statement: corrected?(byRecord.get(r.id)||[]).reduce((s,p)=>plus(s,p.qty),0):gsmRound((byRecord.get(r.id) || []).reduce((s, p) => plus(s,p.qty), 0)), hasPurchases: (byRecord.get(r.id) || []).length > 0,
          balance: gsmRound(modern?lotTotal:lots.reduce((s, l) => plus(s,l.qty), 0)) });
      }
    }
    if (!started) snapshot('start');
    snapshot('end');
    lots.filter(l => l.qty > GSM_EPS && gsmFamily(l.grade) === 'unknown').forEach(l => issue('carry-unknown-grade', 'error', {
      vehicleId: v.id, date: '', org: l.org, grade: l.grade, message: 'В переходящем остатке не определена марка топлива' }));
    lots.filter(l => l.qty < -GSM_EPS).forEach(l => issue('carry-shortage', 'error', { vehicleId: v.id, date: '',
      org: l.org, grade: l.grade, qty: corrected?-l.qty:gsmRound(-l.qty), message: 'Непокрытый остаток: ' + (corrected?decimal().parse(l.qty):gsmRound(l.qty)) + ' л. Проверьте начальный остаток и поступления' }));
  });

  const resultRows = [...rows.values()].filter(r => r.active || Math.abs(r.start) > GSM_EPS || Math.abs(r.end) > GSM_EPS);
  if(verified){
    const evidenceByVehicle=new Map();
    for(const row of resultRows){
      let families=evidenceByVehicle.get(row.vehicleId);if(!families)evidenceByVehicle.set(row.vehicleId,families=new Map());
      const family=gsmFamily(row.grade);if(!families.has(family))families.set(family,openingEvidence(db,row.vehicleId,{before:from,family}));
      if(families.get(family).status==='missing')issue('opening-missing','error',{vehicleId:row.vehicleId,org:row.org,grade:row.grade,date:from,section:'vehicles',sourceId:row.vehicleId,field:'fuelBalance',message:'Входящий остаток не подтверждён. Укажите начальный остаток, включая явный ноль, начало учёта или подтвердите остаток замером до начала периода'});
    }
  }
  if(allocated){
    // Reconcile presentation across every source organisation/grade of the same
    // vehicle, before an act selects its organisation. Only display quanta move;
    // the unrounded decimal allocation remains on each source movement.
    const groups=new Map();for(const row of resultRows){if(!groups.has(row.vehicleId))groups.set(row.vehicleId,[]);groups.get(row.vehicleId).push(row);}
    for(const [vehicleId,group]of groups)for(const field of ['idle','norm','km','glonass']){
      const d=decimal(),parts=group.map(row=>({row,raw:d.parse(row[field]),rounded:allocatedNumber(row[field]),key:JSON.stringify([typeof vehicleId,vehicleId,gsmOrgKey(row.org),row.grade])}));
      const target=d.quantize(d.sum(parts.map(part=>part.raw)),{scale:3,rounding:'half-away-from-zero'}),units=d.toNumberExact(d.mul(d.sub(target,d.sum(parts.map(part=>part.rounded))),1000));
      if(!Number.isSafeInteger(units)||Math.abs(units)>parts.length)throw Object.assign(Error('Не удалось распределить точность производных итогов ГСМ'),{code:'ALLOCATION_RANGE'});
      for(const part of parts)part.row[field]=part.rounded;
      if(!units)continue;
      const sign=units<0?-1:1;parts.sort((a,b)=>sign*d.compare(d.sub(b.raw,b.rounded),d.sub(a.raw,a.rounded))||(a.key<b.key?-1:a.key>b.key?1:0));
      for(const part of parts.slice(0,Math.abs(units))){const delta=sign*.001;part.row[field]=d.toNumberExact(d.add(part.rounded,delta));(part.row.roundingAdjustment||(part.row.roundingAdjustment={}))[field]=delta;}
      const label={km:'пробега',norm:'нормативного расхода',idle:'расхода на холостом ходу',glonass:'пробега ГЛОНАСС'}[field],unit=field==='km'||field==='glonass'?'км':'л';
      issue('rounding-allocation','warning',{vehicleId,date:from||to,field,qty:d.toNumberExact(d.div(units,1000,{scale:3,rounding:'half-away-from-zero'})),message:'Округление '+label+' согласовано между организациями и марками с точностью до 0,001 '+unit+'. Исходные данные сохранены.'});
    }
  }
  // Preserve published legacy keys unless their string representation collides.
  // Numeric 7 and string '7' remain different assets and different UI/report keys.
  const exposedKeys=new Map();for(const row of resultRows){if(!exposedKeys.has(row.key))exposedKeys.set(row.key,[]);exposedKeys.get(row.key).push(row);}
  for(const group of exposedKeys.values())if(group.length>1)for(const row of group)row.key='typed:'+JSON.stringify([typeof row.vehicleId,row.vehicleId,gsmOrgKey(row.org),row.grade]);
  const barrels = new Map();
  resultRows.forEach(row => {
    ['start', 'issued', 'spent', 'idle', 'norm', 'km', 'glonass', 'end', 'correction'].forEach(k => { row[k] = gsmRound(row[k]); });
    const key = [gsmOrgKey(row.org), row.grade].join('|');
    if (!barrels.has(key)) barrels.set(key, { org: row.org, grade: row.grade, start: 0, issued: 0, spent: 0, end: 0, correction: 0 });
    const barrel = barrels.get(key);
    ['start', 'issued', 'spent', 'end', 'correction'].forEach(k => { barrel[k] = gsmRound(plus(barrel[k],row[k])); });
  });
  const currentIssues = issues.filter(i => !i.date || gsmInPeriod(i.date, from, to) || i.code === 'purchase-duplicate' && (!to || i.date <= to));
  const resultBarrels = [...barrels.values()].sort((a, b) => a.org.localeCompare(b.org, 'ru') || a.grade.localeCompare(b.grade, 'ru'));
  return { from, to, rows: resultRows, barrels: resultBarrels, journal, movements,
    receipts: receipts.filter(p => gsmInPeriod(p.date, from, to)), issues: currentIssues,
    errors: currentIssues.filter(i => i.severity === 'error'), organizations: [...new Set(resultRows.map(r => r.org))].sort((a, b) => a.localeCompare(b, 'ru')), ...(hasExplicit?{accounting}: {}) };
}

// The journal balance deliberately retains its historical two-decimal presentation.
// Receipts from statements belong to buildLedger; the two views have distinct semantics.
// options.from does not discard earlier movements: opening stock requires full history.
function cmpDateAsc(a, b) { if (!a || !b) return 0; return a < b ? -1 : a > b ? 1 : 0; }
function recordBalances(db, vehicleId, options) {
  options = options || {};
  const dateTo = options.to || '';
  const vehicle = preparedVehicle((db.vehicles || []).find(v => v.id === vehicleId));
  const boundary=fuelAccounting('vehicles',vehicle);
  if(boundary.mode==='explicit'&&dateTo&&dateTo<boundary.from)return {};
  const recs = (db.records || []).filter(r => r.vehicleId === vehicleId)
    .filter(r => {
      if(corrected&&!live(r))return false;
      if(boundary.mode==='explicit'&&(!gsmValidDate(r.date)||r.date<boundary.from))return false;
      if (dateTo   && r.date > dateTo)   return false;
      return true;
    })
    .sort((a, b) => cmpDateAsc(a.date, b.date));
  const opening = boundary.mode==='explicit'?boundary.opening:fqValue(vehicle && vehicle.fuelBalance) || 0;
  const defaultFamily = fqFuelFamily(vehicleFuelGrade(vehicle));
  const familyBalances = new Map([[defaultFamily, opening]]);
  const sources = boundary.mode==='explicit'?boundary.sources:vehicle && vehicle.fuelBalanceSources;
  if (Array.isArray(sources) && sources.length && (corrected?Math.abs(minus(sources.reduce((sum, source) => plus(sum,(fqValue(source.qty) || 0)), 0),opening))===0:Math.abs(minus(sources.reduce((sum, source) => plus(sum,(fqValue(source.qty) || 0)), 0),opening)) < SOURCE_EPS)) {
    familyBalances.clear();
    sources.forEach(source => {
      const family = fqRecordFuelFamily({ fuelGrade: source.grade }, vehicle);
      familyBalances.set(family, plus((familyBalances.get(family) || 0),(fqValue(source.qty) || 0)));
    });
  }
  const { keyFor, lastOnDate, measurements } = fqMeasurementPlan(recs, vehicle);
  const initialKnown=!verified||openingEvidence(db,vehicleId,{family:defaultFamily}).status==='known',confirmedFamilies=new Set();
  const balMap = {},balanceEntries=[],unknownFamilies=new Set(verified&&!initialKnown?[defaultFamily]:[]);
  recs.forEach(r => {
    // Остаток считается по фактическому расходу; если не введён — по норме
    const fuel = fqRecord(r, vehicle);
    const family = fqRecordFuelFamily(r, vehicle);
    if(verified&&!initialKnown&&!confirmedFamilies.has(family))unknownFamilies.add(family);
    if(verified&&['km','kmGlonass','fuelIssued','fuelActual','fuelUsed','fuelIdle','tankMeasured'].some(field=>r[field]!=null&&!(typeof r[field]==='string'&&!r[field].trim())&&fqValue(r[field])===null))unknownFamilies.add(family);
    if(temporal&&(liveJournal||fuel.normPeriod)&&fuel.source==='missing'&&gsmNumber(r.km)>0)unknownFamilies.add(family);
    let balance = minus(plus((familyBalances.get(family) || 0),(fqValue(r.fuelIssued) || 0)),(fuel.total || 0));
    // Замер остатка в баке — фактическое значение: расчёт с него начинается заново
    const key = keyFor(r);
    if (lastOnDate.get(key) === r.id && measurements.has(key)) {balance = Number(measurements.get(key).tankMeasured);unknownFamilies.delete(family);if(verified)confirmedFamilies.add(family);}
    familyBalances.set(family, balance);
    const total=[...familyBalances.values()].reduce((sum,qty)=>plus(sum,qty),0);
    const value=temporal&&unknownFamilies.size?null:corrected?total:modern?gsmRound(total):boundary.mode==='explicit'?total:+total.toFixed(2);
    if(liveJournal)balanceEntries.push([r.id,value]);else balMap[r.id]=value;
  });
  return liveJournal?recordBalanceMap(balanceEntries):balMap;
}


  return Object.freeze({
    apiVersion: 1,
    calculationVersion,
    constants: Object.freeze({ unknownOrg: GSM_UNKNOWN_ORG, epsilon: GSM_EPS }),
    parseFuelGrade,
    vehicleFuelGrade,
    fuelTypeFromGrade,
    recordFuelGrade,
    fqValue,
    fqRecord,
    fqFuelFamily,
    fqRecordFuelFamily,
    fqMeasurementPlan,
    fqDate,
    fqShiftDate,
    fqDays,
    gsmNumber,
    gsmRound,
    gsmCardKey,
    gsmOrgKey,
    gsmGrade,
    gsmVehicleGrade,
    gsmFamily,
    gsmInPeriod,
    gsmValidDate,
    gsmMonthRange,
    gsmVehicleOrgAt,
    gsmCardAt,
    recordBalances,
    ...(verified?{openingEvidence}:{}),
    buildLedger: gsmBuildLedger
  });
  }
  // Posted acts keep all historical algorithms. Journal presentation evolves
  // separately, without rewriting an act's source contract or version.
  const legacy=makeEngine(1),decimalVersion=makeEngine(2),temporalVersion=makeEngine(3),correctedVersion=makeEngine(4),allocatedVersion=makeEngine(5),current=makeEngine(6,true),live=current;
  function forVersion(version){if(version!==1&&version!==2&&version!==3&&version!==4&&version!==5&&version!==6)throw Object.assign(Error('Неизвестная версия расчёта ГСМ'),{code:'CALCULATION_VERSION'});return version===1?legacy:version===2?decimalVersion:version===3?temporalVersion:version===4?correctedVersion:version===5?allocatedVersion:current;}
  return Object.freeze({...current,recordBalances:live.recordBalances,recordBalanceMap,recordBalanceAt,forVersion});
});
