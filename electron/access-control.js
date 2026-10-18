'use strict';

const crypto = require('crypto');

const FINANCIAL_SECTIONS = Object.freeze(['payments', 'budget', 'contragents']);
const DISPATCHER_WRITES = Object.freeze([
  'vehicles', 'records', 'generators', 'genRecords', 'tanks', 'tankIncomes',
  'fuelPurchases', 'fuelImports', 'fuelCards', 'fuelPeriods', 'monthlyFuel',
  'dispatchJobs', 'drivers', 'assetAssignments', 'opsTasks', 'assetDocuments',
  'fuelMovements', 'shiftReports', 'savedViews', 'glonassTrips', 'glonassImports', 'appMeta',
]);
const MECHANIC_WRITES = Object.freeze([
  'vehicleTo', 'toRecords', 'repairs', 'workOrders', 'opsTasks', 'assetDocuments',
  'parts', 'partMovements', 'shiftReports', 'savedViews', 'appMeta', 'vehicles', 'generators',
]);
const ACCOUNTANT_WRITES = Object.freeze([
  'payments', 'budget', 'contragents', 'reestrRows', 'savedReestrs',
  'fuelPurchases', 'fuelImports', 'fuelPeriods', 'monthlyFuel', 'opsTasks', 'savedViews', 'appMeta',
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
    return { id, name, role, enabled:user.enabled !== false, tokenHash,
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
    return match ? Object.freeze({ id:String(match.id), name:String(match.name), role:match.role, legacy:false }) : null;
  }
  // Existing installations continue to connect until personal accounts are
  // configured. A configured server never falls back to its old shared key.
  if (options.allowLegacy === false || typeof settings.networkKey !== 'string' || settings.networkKey.length < 16) return null;
  if (!constantTimeHashEqual(supplied, hashToken(settings.networkKey))) return null;
  return Object.freeze({ id:'legacy-shared-key', name:'Общий ключ сети', role:'admin', legacy:true });
}

/** Sections must also be checked against storage.SECTIONS by the HTTP handler. */
function authorize(principal, action, section) {
  if (!principal || !Object.hasOwn(ROLES,principal.role)) return false;
  const role = principal.role;
  if (action === 'ping') return true;
  if (action === 'admin' || action === 'replace') return role === 'admin';
  if (typeof section !== 'string' || !/^[a-zA-Z]+$/.test(section)) return false;
  if (action === 'read') return !FINANCIAL_SECTIONS.includes(section) || ['admin','accountant','viewer'].includes(role);
  // The HTTP handler MUST enforce append-only history, ignoring client authors.
  if ((action === 'append' || action === 'write') && section === 'auditLog') return true;
  if (action !== 'write') return false;
  return role === 'admin' || ROLES[role].write.includes(section);
}

const MECHANIC_ASSET_FIELDS = Object.freeze({
  vehicles:Object.freeze(['maintenanceRules','toSevereConditions','toIntervalKm','toIntervalMonths']),
  generators:Object.freeze(['maintenanceRules']),
});

/** A section permission does not let a mechanic replace a technical passport. */
function validateAssetChanges(principal, section, previous, next) {
  if (principal?.role !== 'mechanic' || !Object.hasOwn(MECHANIC_ASSET_FIELDS,section)) return;
  if (!Array.isArray(previous) || !Array.isArray(next) || previous.length !== next.length) throw new Error('Механик может изменять регламенты ТО существующей техники; добавление и удаление карточек разрешены диспетчеру');
  const key = (row,index) => row && typeof row === 'object' && !Array.isArray(row) ? row.id != null ? 'id:' + String(row.id) : 'row:' + index : null;
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

function publicUser(user) {
  return { id:user.id, name:user.name, role:user.role, enabled:user.enabled !== false,
    createdAt:user.createdAt || null, rotatedAt:user.rotatedAt || null, expiresAt:user.expiresAt || null };
}

module.exports = { ROLES, FINANCIAL_SECTIONS, hashToken, issueToken, normalizeServerUsers, authenticate, authorize, publicUser, validateAssetChanges, fieldPermissions };
