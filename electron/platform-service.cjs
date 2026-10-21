'use strict';

// The only trusted transaction policy. Storage invokes it while holding the
// physical database lock; browser metadata never supplies an author or clock.
const crypto = require('node:crypto');
const access = require('./access-control');
const kernel = () => require('../assets/core/platform-kernel.js');
const schema = () => require('../assets/core/platform-schema.js');
const contracts = () => require('../assets/core/platform-contracts.js');

function fail(code, message, status) {
  const error = new Error(message); error.code = code; error.status = status || 400; throw error;
}
function principalOf(principal) {
  const value = principal || { id:'local-profile', name:'Локальный пользователь', role:'admin' };
  if (!access.ROLES[value.role]) fail('ACCESS_DENIED', 'Не определена действующая роль пользователя', 403);
  return { id:String(value.id || 'local-profile'), name:String(value.name || 'Локальный пользователь'), role:value.role };
}
function visibleAudit(rows, principal) {
  return (rows || []).filter(row => row && typeof row.section === 'string' && access.authorize(principal, 'read', row.section) &&
    (row.type !== 'transaction' || Array.isArray(row.changedSections) && row.changedSections.every(name => access.authorize(principal, 'read', name))));
}
function operationInfo(previous, sections, options = {}) {
  if (!options.operation) return null;
  const operation = contracts().validateOperation(options.operation);
  const actor = principalOf(options.principal);
  const digest = kernel().requestDigest({ base:options.base || {}, sections });
  if (operation.digest != null && operation.digest !== digest) fail('OPERATION_DIGEST', 'Состав операции изменился после подготовки', 409);
  const receipt = (previous.auditLog || []).find(row => row.source === 'platform' && row.type === 'transaction' && row.operationId === operation.id);
  if (receipt && (receipt.requestDigest !== digest || receipt.actorId !== actor.id || receipt.actorRole !== actor.role || receipt.databaseToken !== options.databaseToken))
    fail('OPERATION_REUSED', 'Этот идентификатор операции уже использован для другого состава, пользователя или базы', 409);
  return { id:operation.id, digest, actor, receipt };
}
function replayResult(previous, revisions, token, info, names) {
  if (!info?.receipt) return null;
  const canonicalSections = {};
  for (const name of new Set([...names, 'auditLog'])) {
    if (!access.authorize(info.actor, 'read', name)) continue;
    canonicalSections[name] = name === 'auditLog' ? visibleAudit(previous.auditLog, info.actor) : previous[name] || [];
  }
  return { ok:true, changed:[], revisions, databaseToken:token, canonicalSections, replayed:true,
    operationReceipt:{ id:info.id, digest:info.digest, status:'replayed', at:info.receipt.at } };
}
function assertAuditPrefix(previous, sections, actor) {
  if (!Object.hasOwn(sections, 'auditLog')) return;
  const prefix = visibleAudit(previous.auditLog, actor), received = sections.auditLog;
  const unchanged = rows => received.length >= rows.length && rows.every((row, index) => JSON.stringify(row) === JSON.stringify(received[index]));
  // Native snapshots include unchanged historical rows with obsolete section
  // names; HTTP snapshots contain only the principal's visible history.
  if (!Array.isArray(received) || !unchanged(previous.auditLog || []) && !unchanged(prefix))
    fail('AUDIT_IMMUTABLE', 'Сохранённую историю нельзя изменять или удалять. Обновите данные.', 403);
}
function prepareTransaction(previous, supplied, options = {}) {
  const registry = schema().sections, actor = principalOf(options.principal);
  contracts().validateSections(supplied,registry);
  const info = operationInfo(previous, supplied, { ...options, principal:actor });
  if (info?.receipt) return { replayed:true, operation:info };
  assertAuditPrefix(previous, supplied, actor);
  // Client-generated audit suffixes are hints, never persisted as trusted facts.
  let sections = Object.fromEntries(Object.entries(supplied).filter(([name]) => name !== 'auditLog'));
  for (const [name, rows] of Object.entries(sections)) {
    if (JSON.stringify(previous[name] || []) === JSON.stringify(rows)) continue;
    if (!access.authorize(actor, 'write', name)) fail('ACCESS_DENIED', 'Роль не разрешает изменение раздела: ' + name, 403);
    try { access.validateAssetChanges(actor, name, previous[name] || [], rows); }
    catch (error) { fail('ACCESS_DENIED', error.message, 403); }
  }
  if (options.prepareSections) sections = options.prepareSections(sections);
  const at = options.now || new Date().toISOString();
  if (!Number.isFinite(Date.parse(at))) fail('INVALID_CLOCK', 'Некорректное время операции');
  const id = info?.id || 'backend:' + crypto.randomUUID();
  const plan = kernel().prepare(previous, sections, { id, identity:options.databaseToken || 'local-storage', actor,
    revisions:options.revisions || {}, now:at,
    readable:registry.filter(name => access.authorize(actor, 'read', name)),
    writable:registry.filter(name => access.authorize(actor, 'write', name)) });
  const changes = (plan.rowChanges || []).filter(row => row.section !== 'auditLog');
  const result = { ...plan.sections };
  delete result.auditLog;
  const changed = Object.keys(result);
  if (!changed.length && !info) return { sections:{}, plan, operationReceipt:null };
  const digest = info?.digest || kernel().requestDigest({ base:options.base || {}, sections:supplied });
  const entries = changes.map(row => ({ id:'audit_' + crypto.randomUUID(), at, actor:actor.name, actorId:actor.id, actorRole:actor.role,
    source:'platform', operationId:id, section:row.section, recordId:String(row.recordId ?? row.key), action:row.action,
    fields:row.fields, before:row.before, after:row.after }));
  const revisions = {};
  for (const name of [...changed, 'auditLog']) revisions[name] = (options.revisions?.[name] || 0) + 1;
  const receipt = { id:'operation:' + id, type:'transaction', action:'transaction', source:'platform', section:'auditLog', recordId:id,
    operationId:id, requestDigest:digest, databaseToken:options.databaseToken, at,
    actor:actor.name, actorId:actor.id, actorRole:actor.role, changedSections:changed, revisions };
  result.auditLog = [...(previous.auditLog || []), ...entries, receipt];
  return { sections:result, plan, operationReceipt:{ id, digest, status:'committed', at } };
}

module.exports = { prepareTransaction, operationInfo, replayResult, visibleAudit };
