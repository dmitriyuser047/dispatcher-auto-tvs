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
  return (rows || []).filter(row => row && typeof row.section === 'string' && require('./document-access.cjs').permitted(principal, 'read', row.section) &&
    (row.type !== 'transaction' || Array.isArray(row.changedSections) && row.changedSections.every(name => require('./document-access.cjs').permitted(principal, 'read', name)))&&require('./document-access.cjs').auditAccess(principal,row)&&require('./period-access.cjs').auditAccess(principal,row)).map(row=>require('./period-access.cjs').visibleAuditRow(row,principal));
}
function visibleRows(name,rows,principal){return name==='auditLog'?visibleAudit(rows,principal):name==='fuelPeriods'?require('./period-access.cjs').visibleRows(rows,principal):require('./document-access.cjs').visibleRows(name,rows,principal);}
function filteredResult(result,principal){if(!principal)return result;const out={...result};if(out.canonicalSections)out.canonicalSections=Object.fromEntries(Object.entries(out.canonicalSections).filter(([name])=>require('./document-access.cjs').permitted(principal,'read',name)).map(([name,rows])=>[name,visibleRows(name,rows,principal)]));return out;}
function findReceipt(rows,query,principal,token){
  const operation=contracts().validateOperation(query),actor=principalOf(principal);
  const receipt=(rows||[]).find(row=>row?.source==='platform'&&row.type==='transaction'&&row.operationId===operation.id&&
    row.actorId===actor.id&&row.actorRole===actor.role&&row.databaseToken===token&&row.requestDigest===operation.digest&&
    Array.isArray(row.changedSections)&&row.changedSections.every(name=>require('./document-access.cjs').permitted(principal||actor,'read',name))&&require('./document-access.cjs').auditAccess(principal||actor,row)&&require('./period-access.cjs').auditAccess(principal||actor,row));
  return receipt ? {id:operation.id,digest:receipt.requestDigest,status:'committed',at:receipt.at} : null;
}
function operationInfo(previous, sections, options = {}) {
  if (!options.operation) return null;
  const operation = contracts().validateOperation(options.operation);
  const actor = principalOf(options.principal);
  // commandIntent is a trusted internal option, never accepted from the raw
  // sections/full-write transport. Generated rows and server clocks must not
  // change the identity of a semantic command or prevent its receipt replay.
  const digest = kernel().requestDigest(options.commandIntent || { base:options.base || {}, sections });
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
    canonicalSections[name] = visibleRows(name,previous[name],info.actor);
  }
  return { ok:true, changed:[], revisions, databaseToken:token, canonicalSections, replayed:true,
    operationReceipt:{ id:info.id, digest:info.digest, status:'replayed', at:info.receipt.at } };
}
function assertAuditPrefix(previous, sections, actor) {
  if (!Object.hasOwn(sections, 'auditLog')) return;
  const prefix = visibleAudit(previous.auditLog, actor), received = sections.auditLog;
  // JSON object key order may change during a portable kernel plan. Immutable
  // values, typed IDs and array order are checked canonically; stored originals
  // remain the prefix that is appended to below.
  const unchanged = rows => received.length >= rows.length && rows.every((row, index) => kernel().stableSerialize(row) === kernel().stableSerialize(received[index]));
  // Native snapshots include unchanged historical rows with obsolete section
  // names; HTTP snapshots contain only the principal's visible history.
  if (!Array.isArray(received) || !unchanged(previous.auditLog || []) && !unchanged(prefix))
    fail('AUDIT_IMMUTABLE', 'Сохранённую историю нельзя изменять или удалять. Обновите данные.', 403);
}
function canonicalShiftAcceptance(previous,sections,actor,at) {
  if(!Object.hasOwn(sections,'shiftReports'))return sections;
  const old=new Map();
  for(const row of previous.shiftReports || []){const key=typeof row.id+':'+JSON.stringify(row.id);if(!old.has(key))old.set(key,[]);old.get(key).push(row);}
  const rows=sections.shiftReports.map(row=>{
    const matches=old.get(typeof row.id+':'+JSON.stringify(row.id)) || [],before=matches.length===1?matches[0]:null;
    if(row.status==='accepted'&&matches.some(item=>item.status!=='accepted')) {
      if(matches.length!==1)fail('SHIFT_ACCEPTANCE_AMBIGUOUS','Нельзя принять сменную форму с неоднозначным ID. Сначала проверьте её историю.',409);
      if(before.status!=='sent')fail('SHIFT_ACCEPTANCE_TRANSITION','Принять можно только отправленную сменную форму.',409);
      return {...row,acceptedActor:{...actor},acceptedAt:at};
    }
    if(row.status==='accepted'&&!matches.length)return {...row,acceptedActor:{...actor},acceptedAt:at};
    // An accepted historical row remains immutable, including its old metadata.
    // Unaccepted rows cannot manufacture approval metadata in advance.
    if(row.status!=='accepted'&&['acceptedActor','acceptedAt'].some(field=>JSON.stringify(row[field])!==JSON.stringify(before?.[field])))
      fail('SHIFT_ACCEPTANCE_METADATA','Реквизиты учётной записи и времени приёмки формируются программой.',403);
    return row;
  });
  return {...sections,shiftReports:rows};
}
function prepareTransaction(previous, supplied, options = {}) {
  const registry = schema().sections, actor = principalOf(options.principal);
  contracts().validateSections(supplied,registry);
  const info = operationInfo(previous, supplied, { ...options, principal:actor });
  if (info?.receipt) return { replayed:true, operation:info };
  assertAuditPrefix(previous, supplied, options.principal||actor);
  // Client-generated audit suffixes are hints, never persisted as trusted facts.
  let sections = require('./period-access.cjs').mergePeriods(previous,require('./document-access.cjs').mergeDrafts(previous,Object.fromEntries(Object.entries(supplied).filter(([name]) => name !== 'auditLog')),options.principal||actor),options.principal||actor);
  const periodCommand=options.commandIntent?.command?.type==='PeriodAction'&&require('./period-access.cjs').canManage(options.principal||actor,options.commandIntent.command.input?.scope);
  const costCommand=options.commandIntent?.command?.type==='CostAction'&&options.commandIntent.command.input?.action==='savePolicy'&&access.costActions(options.principal||actor).includes('savePolicy');
  const costTarget=costCommand?options.commandIntent.command.input.target?.section:null;
  for (const [name, rows] of Object.entries(sections)) {
    if (JSON.stringify(previous[name] || []) === JSON.stringify(rows)) continue;
    if (!access.authorize(actor, 'write', name)&&!(name==='fuelPeriods'&&periodCommand)&&!(name===costTarget&&costCommand)) fail('ACCESS_DENIED', 'Роль не разрешает изменение раздела: ' + name, 403);
    try { access.validateAssetChanges(actor, name, previous[name] || [], rows); }
    catch (error) { fail('ACCESS_DENIED', error.message, 403); }
  }
  const at = options.now || new Date().toISOString();
  if (!Number.isFinite(Date.parse(at))) fail('INVALID_CLOCK', 'Некорректное время операции');
  sections=canonicalShiftAcceptance(previous,sections,actor,at);
  sections=require('../assets/core/temporal-policy.js').canonicalizeOrigins(previous,sections);
  if (options.prepareSections) sections = options.prepareSections(sections);
  const id = info?.id || 'backend:' + crypto.randomUUID();
  // This proof is derived from the semantic execution option, never a section
  // request field. Raw/full writes cannot authorize their own catalog aliases.
  const commandProof=['MergeCatalog','DocumentAction','PeriodAction','FuelAction','ProcurementAction','CostAction'].includes(options.commandIntent?.command?.type)
    ? {commandIntent:contracts().parseCommandEnvelope(options.commandIntent,registry)} : {};
  const plan = kernel().prepare(previous, sections, { id, identity:options.databaseToken || 'local-storage', actor,
    revisions:options.revisions || {}, now:at,today:at.slice(0,10),...commandProof,
    readable:registry.filter(name => require('./document-access.cjs').permitted(options.principal||actor, 'read', name)),
    writable:registry.filter(name => require('./document-access.cjs').permitted(options.principal||actor, 'write', name)||name==='fuelPeriods'&&periodCommand||name===costTarget&&costCommand) });
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
  if(changed.includes('documentDrafts'))receipt.changedDocumentSections=require('./document-access.cjs').changedOrigins(previous.documentDrafts,result.documentDrafts);
  if(changed.includes('fuelPeriods'))receipt.changedPeriodScopes=require('./period-access.cjs').changedScopes(previous.fuelPeriods,result.fuelPeriods);
  result.auditLog = [...(previous.auditLog || []), ...entries, receipt];
  return { sections:result, plan, operationReceipt:{ id, digest, status:'committed', at } };
}

module.exports = { prepareTransaction, operationInfo, replayResult, visibleAudit,visibleRows,filteredResult,findReceipt };
