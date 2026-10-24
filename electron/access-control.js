'use strict';

const crypto = require('crypto');

const FINANCIAL_SECTIONS = Object.freeze(['payments', 'budget', 'contragents', 'costEntries', 'costProfiles']);
const DISPATCHER_WRITES = Object.freeze([
  'vehicles', 'records', 'generators', 'genRecords', 'tanks', 'tankIncomes',
  'fuelPurchases', 'fuelImports', 'fuelCards', 'fuelPeriods', 'fuelWriteoffs', 'monthlyFuel',
  'dispatchJobs', 'drivers', 'assetAssignments', 'opsTasks', 'assetDocuments',
  'fuelMovements', 'shiftReports', 'savedViews', 'glonassTrips', 'glonassImports', 'appMeta',
  'procurementOrders', 'procurementRules',
]);
const MECHANIC_WRITES = Object.freeze([
  'vehicleTo', 'toRecords', 'repairs', 'workOrders', 'opsTasks', 'assetDocuments', 'generatorMaintenancePlans',
  'parts', 'partMovements', 'shiftReports', 'savedViews', 'appMeta', 'vehicles', 'generators',
  'procurementOrders', 'procurementRules',
]);
const ACCOUNTANT_WRITES = Object.freeze([
  'payments', 'budget', 'contragents', 'reestrRows', 'savedReestrs',
  'fuelPurchases', 'fuelImports', 'fuelPeriods', 'fuelWriteoffs', 'monthlyFuel', 'opsTasks', 'savedViews', 'appMeta',
  'costEntries', 'costProfiles', 'procurementOrders', 'procurementRules',
]);

const ROLES = Object.freeze({
  admin: Object.freeze({ label:'Администратор', description:'Все данные и операции', write:Object.freeze(['*']) }),
  dispatcher: Object.freeze({ label:'Диспетчер', description:'Транспорт, назначения, журналы и ГСМ; финансовые справочники закрыты', write:DISPATCHER_WRITES }),
  mechanic: Object.freeze({ label:'Механик', description:'Регламенты ТО техники, ремонт, запчасти и документы; финансовые справочники закрыты', write:MECHANIC_WRITES }),
  accountant: Object.freeze({ label:'Бухгалтер', description:'Финансы, реестры, закупки и закрытие ГСМ; остальное для чтения', write:ACCOUNTANT_WRITES }),
  viewer: Object.freeze({ label:'Наблюдатель · все данные', description:'Чтение всех разделов, включая финансовые; без изменения учётных записей', write:Object.freeze([]) }),
});

function hashToken(token) {
  if (typeof token !== 'string' || !token || token.length > 4096) throw new Error('Некорректный персональный токен');
  // Токен состоит из 256 случайных бит. Быстрый SHA-256 подходит для такого
  // секрета; пользовательские пароли в этом механизме не используются.
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function issueToken() {
  const token = 'tvs_' + crypto.randomBytes(32).toString('hex');
  return { token, tokenHash:hashToken(token) };
}

function normalizeServerUsers(users) {
  if (!Array.isArray(users) || users.length > 100) throw new Error('Некорректный список сетевых учётных записей');
  const ids = new Set(), hashes = new Set();
  const normalized = users.map(user => {
    if (!user || typeof user !== 'object' || Array.isArray(user)) throw new Error('Некорректная сетевая учётная запись');
    const id = String(user.id || ''), name = String(user.name || '').trim(), role = String(user.role || '');
    const tokenHash = String(user.tokenHash || '').toLowerCase();
    if (!/^[a-z0-9_-]{1,80}$/i.test(id) || ids.has(id)) throw new Error('ID сетевой учётной записи должен быть уникальным');
    if (!name || name.length > 120 || !Object.hasOwn(ROLES, role)) throw new Error('Укажите имя и допустимую роль сетевой учётной записи');
    if (!/^[a-f0-9]{64}$/.test(tokenHash) || hashes.has(tokenHash)) throw new Error('Для каждой учётной записи нужен уникальный хэш токена');
    const expiresAt = user.expiresAt ? String(user.expiresAt) : null;
    if (expiresAt && !Number.isFinite(Date.parse(expiresAt))) throw new Error('Некорректный срок действия токена');
    ids.add(id); hashes.add(tokenHash);
    const restrictions = require('./access-context.cjs').normalizePrincipal({ ...user, id, name, role });
    return { id, name, role, ...(restrictions.accessPolicy !== undefined ? {accessPolicy:restrictions.accessPolicy}:{}), ...Object.fromEntries(['readable','writable'].filter(key=>restrictions[key]!==undefined).map(key=>[key,restrictions[key]])), enabled:user.enabled !== false, tokenHash,
      createdAt:typeof user.createdAt === 'string' ? user.createdAt : null,
      rotatedAt:typeof user.rotatedAt === 'string' ? user.rotatedAt : null, expiresAt };
  });
  if (normalized.length && !normalized.some(u => u.enabled && u.role === 'admin' && (!u.expiresAt || Date.parse(u.expiresAt) > Date.now()))) {
    throw new Error('Оставьте хотя бы одну действующую учётную запись администратора');
  }
  return normalized;
}

function constantTimeHashEqual(left, right) {
  if (!/^[a-f0-9]{64}$/i.test(String(left)) || !/^[a-f0-9]{64}$/i.test(String(right))) return false;
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

/** Server calls this on every request using its current settings snapshot. */
function authenticate(token, settings = {}, options = {}) {
  if (typeof token !== 'string' || !token || token.length > 4096) return null;
  let supplied;
  try { supplied = hashToken(token); } catch { return null; }
  const users = Array.isArray(settings.serverUsers) ? settings.serverUsers : [];
  if (users.length || settings.serverAccessConfigured) {
    let match = null;
    for (const user of users) {
      const equal = constantTimeHashEqual(supplied, user?.tokenHash);
      if (equal && user.enabled !== false && Object.hasOwn(ROLES,user.role) && (!user.expiresAt || Date.parse(user.expiresAt) > Date.now())) match = user;
    }
    if (!match) return null;
    try { return Object.freeze(require('./access-context.cjs').normalizePrincipal({...match,id:String(match.id),name:String(match.name),role:match.role,legacy:false})); } catch { return null; }
  }
  // Existing installations continue to connect until personal accounts are
  // configured. A configured server never falls back to its old shared key.
  if (options.allowLegacy === false || typeof settings.networkKey !== 'string' || settings.networkKey.length < 16) return null;
  if (!constantTimeHashEqual(supplied, hashToken(settings.networkKey))) return null;
  return Object.freeze({ id:'legacy-shared-key', name:'Общий ключ сети', role:'admin', legacy:true });
}

/** Sections must also be checked against storage.SECTIONS by the HTTP handler. */
function authorizeRole(principal, action, section) {
  if (!principal || !Object.hasOwn(ROLES,principal.role)) return false;
  const role = principal.role;
  if (action === 'ping') return true;
  if (action === 'admin' || action === 'replace') return role === 'admin';
  if (typeof section !== 'string' || !/^[a-zA-Z]+$/.test(section)) return false;
  if(section==='documentDrafts'&&['read','write'].includes(action))return ['shiftReports','workOrders','dispatchJobs','fuelMovements','partMovements','fuelWriteoffs','payments','repairs','vehicleTo','toRecords','tankIncomes'].some(name=>authorizeRole(principal,action,name));
  if (action === 'read') return !FINANCIAL_SECTIONS.includes(section) || ['admin','accountant','viewer'].includes(role);
  // The HTTP handler MUST enforce append-only history, ignoring client authors.
  if ((action === 'append' || action === 'write') && section === 'auditLog') return true;
  if (action !== 'write') return false;
  return role === 'admin' || ROLES[role].write.includes(section);
}

function authorize(principal,action,section) {
  if(['ping','admin','replace'].includes(action)){
    if(!authorizeRole(principal,action,section))return false;
    const normalized=require('./access-context.cjs').normalizePrincipal(principal);
    return action!=='replace'||!require('./access-context.cjs').hasNarrowing(normalized)&&!['readable','writable'].some(field=>normalized[field]&&!normalized[field].includes('*'));
  }
  if(!require('./access-context.cjs').hasPolicy(principal)){const list=principal?.[action==='read'?'readable':'writable'];return authorizeRole(principal,action,section)&&(!list||list.includes('*')||list.includes(section));}
  return require('./access-context.cjs').sectionAllowed(principal,action,section);
}

const MECHANIC_ASSET_FIELDS = Object.freeze({
  vehicles:Object.freeze(['maintenanceRules','toSevereConditions','toIntervalKm','toIntervalMonths']),
  generators:Object.freeze(['maintenanceRules']),
});

/** A section permission does not let a mechanic replace a technical passport. */
function validateAssetChanges(principal, section, previous, next) {
  if (principal?.role !== 'mechanic' || !Object.hasOwn(MECHANIC_ASSET_FIELDS,section)) return;
  if (!Array.isArray(previous) || !Array.isArray(next) || previous.length !== next.length) throw new Error('Механик может изменять регламенты ТО существующей техники; добавление и удаление карточек разрешены диспетчеру');
  const key = (row,index) => row && typeof row === 'object' && !Array.isArray(row) ? row.id != null ? 'id:' + typeof row.id + ':' + JSON.stringify(row.id) : 'row:' + index : null;
  const oldRows = new Map(previous.map((row,index) => [key(row,index),row]));
  const seen = new Set(), allowed = new Set(MECHANIC_ASSET_FIELDS[section]);
  for (let index=0;index<next.length;index++) {
    const row=next[index],id=key(row,index),old=oldRows.get(id);
    if (!id || !old || seen.has(id)) throw new Error('Механик не может заменять ID или состав карточек техники');
    seen.add(id);
    const changed = [...new Set([...Object.keys(old),...Object.keys(row)])].filter(field => JSON.stringify(old[field]) !== JSON.stringify(row[field]));
    if (changed.some(field => !allowed.has(field))) throw new Error('Для механика в карточке техники доступны только виды, интервалы и условия ТО');
    if (changed.includes('maintenanceRules') && row.maintenanceRules !== undefined) {
      if (!Array.isArray(row.maintenanceRules) || row.maintenanceRules.length > 100) throw new Error('Некорректные регламенты ТО');
      const ids = new Set();
      for (const rule of row.maintenanceRules) {
        const meter=section==='vehicles'?'km':'hours';
        if (!rule || typeof rule!=='object' || Array.isArray(rule) || typeof rule.id!=='string' || !rule.id || rule.id.length>200 || ids.has(rule.id) || typeof rule.label!=='string' || !rule.label.trim() || rule.label.length>200 || Object.keys(rule).some(field => !['id','label',meter,'months','enabled'].includes(field))) throw new Error('Проверьте название и ID вида ТО');
        ids.add(rule.id);
        if (rule.enabled!==undefined && typeof rule.enabled!=='boolean') throw new Error('Некорректное состояние регламента ТО');
        if (rule[meter]!=null && (typeof rule[meter]!=='number' || !Number.isFinite(rule[meter]) || rule[meter]<=0) || rule.months!=null && (!Number.isInteger(rule.months) || rule.months<=0) || !(rule[meter]>0 || rule.months>0)) throw new Error('Интервал ТО должен быть положительным числом, месяцы — целым числом');
      }
    }
    if (changed.includes('toSevereConditions') && row.toSevereConditions!==undefined && typeof row.toSevereConditions!=='boolean') throw new Error('Некорректное условие эксплуатации');
    for (const field of ['toIntervalKm','toIntervalMonths']) if (changed.includes(field) && row[field]!=null && (typeof row[field]!=='number' || !Number.isFinite(row[field]) || row[field]<0 || field==='toIntervalMonths' && !Number.isInteger(row[field]))) throw new Error('Некорректный базовый интервал ТО');
  }
}

function fieldPermissions(principal) {
  return principal?.role === 'mechanic' ? MECHANIC_ASSET_FIELDS : {};
}
function actionAvailable(principal,action,section){if(!require('./access-context.cjs').hasPolicy(principal)&&principal?.actions===undefined)return true;try{return require('./access-context.cjs').sectionAllowed(principal,action,section);}catch{return false;}}
function fuelActions(principal) {
  const narrowed=principal?.writable;
  return authorize(principal,'write','fuelMovements')&&(!narrowed||narrowed.includes('*')||narrowed.includes('fuelMovements'))
    ? ['measure','applyDifference','voidMeasurement','reverseLegacyTransfer'].filter(action=>actionAvailable(principal,'fuel:'+action,'fuelMovements')) : [];
}
function procurementActions(principal) {
  const narrowed=principal?.writable;
  const writable=name=>authorize(principal,'write',name)&&(!narrowed||narrowed.includes('*')||narrowed.includes(name));
  const planning=writable('procurementOrders');
  return Object.fromEntries(['tank','part'].map(kind=>[kind,!planning?[]:['saveOrder','activateLegacy','cancelRemaining',...(writable(kind==='tank'?'fuelMovements':'partMovements')?['supplierReturn']:[])].filter(action=>actionAvailable(principal,'procurement:'+action,action==='supplierReturn'?(kind==='tank'?'fuelMovements':'partMovements'):'procurementOrders'))]));
}
function costActions(principal) {
  if(!['admin','accountant'].includes(principal?.role))return [];
  const narrowed=principal?.writable,writable=name=>authorize(principal,'write',name)&&(!narrowed||narrowed.includes('*')||narrowed.includes(name));
  return [...(writable('costProfiles')?['savePolicy']:[]),...(writable('costEntries')?['saveAllocation']:[])].filter(action=>actionAvailable(principal,'cost:'+action,action==='savePolicy'?'costProfiles':'costEntries'));
}
function repairActions(principal) {
  const narrowed=principal?.writable;
  return ['admin','mechanic'].includes(principal?.role)&&authorize(principal,'write','workOrders')&&(!narrowed||narrowed.includes('*')||narrowed.includes('workOrders'))
    ? ['saveOrder','approve','start','cancel'].filter(action=>actionAvailable(principal,'repair:'+action,'workOrders')) : [];
}
function calendarActions(principal) {
  const narrowed=principal?.writable,readable=principal?.readable;
  const can=(action,name)=>authorize(principal,action,name)&&(!(action==='write'?narrowed:readable)||(action==='write'?narrowed:readable).includes('*')||(action==='write'?narrowed:readable).includes(name));
  if(!can('read','appMeta'))return [];
  const configure=principal?.role==='admin'&&can('write','appMeta');
  const confirm=(['admin','dispatcher'].includes(principal?.role)&&can('write','dispatchJobs')&&can('read','dispatchJobs'))||(['admin','mechanic'].includes(principal?.role)&&can('write','workOrders')&&can('read','workOrders'));
  return [...(configure&&actionAvailable(principal,'calendar:configure','appMeta')?['configure']:[]),...(confirm&&['dispatchJobs','workOrders'].some(name=>can('write',name)&&actionAvailable(principal,'calendar:confirmInterval',name))?['confirmInterval']:[])];
}
function canCalendarAction(principal,input) {
  if(!calendarActions(principal).includes(input?.action))return false;
  if(input.action==='configure')return true;
  const section=input.target?.section,roles=section==='dispatchJobs'?['admin','dispatcher']:section==='workOrders'?['admin','mechanic']:[];
  return roles.includes(principal?.role)&&authorize(principal,'write',section)&&(!principal.writable||principal.writable.includes('*')||principal.writable.includes(section))&&authorize(principal,'read',section)&&(!principal.readable||principal.readable.includes('*')||principal.readable.includes(section));
}

function publicUser(user) {
  const normalized=require('./access-context.cjs').normalizePrincipal(user);
  return { id:user.id, name:user.name, role:user.role, ...(normalized.accessPolicy!==undefined?{accessPolicy:normalized.accessPolicy}:{}), ...Object.fromEntries(['readable','writable'].filter(key=>normalized[key]!==undefined).map(key=>[key,normalized[key]])), policyStamp:normalized.policyStamp, enabled:user.enabled !== false,
    createdAt:user.createdAt || null, rotatedAt:user.rotatedAt || null, expiresAt:user.expiresAt || null };
}
function printActions(principal){const narrowed=principal?.readable,can=name=>authorize(principal,'read',name)&&(!narrowed||narrowed.includes('*')||narrowed.includes(name));return can('appMeta')&&['vehicles','shiftReports','workOrders','dispatchJobs','fuelMovements','partMovements','fuelWriteoffs','payments','repairs','vehicleTo','toRecords','tankIncomes'].some(name=>can(name)&&actionAvailable(principal,'print:capture',name))?['capture']:[];}

function publicError(error,principal){
  const context=require('./access-context.cjs');if(!(context.hasNarrowing||context.hasPolicy)(principal))return error;
  const safe=['SCOPE_VIEW_REQUIRED','CURSOR_INVALID','CURSOR_STALE','QUERY_FIELD_ACCESS','ACCESS_DENIED'].includes(error?.code)?error.message:'Операция не выполнена: проверьте доступные данные и текущие права.';
  return Object.assign(new Error(safe),{code:error?.code||'OPERATION_FAILED',status:error?.status||400});
}
const POLICY_ACTIONS=Object.freeze(['read','create','update','delete','document:saveDraft','document:postDraft','document:discardDraft','document:post','document:void','document:reverse','document:settle','fuel:issue','fuel:measure','fuel:applyDifference','fuel:voidMeasurement','fuel:reverseLegacyTransfer','procurement:saveOrder','procurement:activateLegacy','procurement:cancelRemaining','procurement:supplierReturn','cost:savePolicy','cost:saveAllocation','repair:saveOrder','repair:approve','repair:start','repair:cancel','maintenance:saveDraft','maintenance:approve','maintenance:revise','calendar:configure','calendar:confirmInterval','period:close','period:reopen','shift:accept','assignment:save','catalog:merge','print:capture','print:export',...['glonass','fuel-statement','section-data','vehicles','catalog','personnel','registry','provider-totals'].map(profile=>'import:'+profile)]);
module.exports = { POLICY_ACTIONS,actionAvailable,publicError, ROLES, FINANCIAL_SECTIONS, hashToken, issueToken, normalizeServerUsers, authenticate, authorize, authorizeRole, publicUser, validateAssetChanges, fieldPermissions,fuelActions,procurementActions,costActions,repairActions,calendarActions,canCalendarAction,printActions,importActions:principal=>require('./import-source.cjs').actions(principal) };
