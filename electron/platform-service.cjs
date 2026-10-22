'use strict';

// The only trusted transaction policy. Storage invokes it while holding the
// physical database lock; browser metadata never supplies an author or clock.
const crypto = require('node:crypto');
const access = require('./access-control');
const kernel = () => require('../assets/core/platform-kernel.js');
const schema = () => require('../assets/core/platform-schema.js');
const contracts = () => require('../assets/core/platform-contracts.js');
const accessContext = () => require('./access-context.cjs');
// Kept outside serializable database rows. Object spreads retain the raw hot
// array, while a renderer clone cannot manufacture this trusted capability.
const historyBindings = new WeakMap();
function bindHistory(database,dataDir){
  if(!Array.isArray(database?.auditLog))return database;
  const store=require('./operation-store.cjs');
  historyBindings.set(database.auditLog,{state:store.readState(dataDir),engine:store.engine(dataDir),receipts:new Map()});
  return database;
}
function boundReceipt(binding,id){
  if(!binding.receipts.has(id))binding.receipts.set(id,binding.engine.inspectReceipt(binding.state.head,id));
  return binding.receipts.get(id);
}
function projectHistoryEvent(event,principal,binding){
  const evidence=require('./operation-evidence.cjs'),stored=typeof event?.operationId==='string'?boundReceipt(binding,event.operationId):null;
  return publicAuditRow(stored?.kind==='receipt'&&!stored.legacy?evidence.projectEvent(event,stored.proof,principal):evidence.projectLegacyEvent(event,principal));
}
function publicAuditRow(row){if(!row)return null;const {archiveScope,...publicRow}=row;return publicRow;}
function literalReceipt(stored){
  const value=stored.receipt,result=value.result||{};
  return {...result,id:result.id??'operation:'+value.operation.id,type:'transaction',source:'platform',section:'auditLog',operationId:value.operation.id,requestDigest:value.operation.digest,databaseToken:value.operation.databaseToken,actorId:value.operation.actorId,actorRole:value.operation.actorRole,at:value.at,changedSections:value.changedSections,revisions:value.revisions};
}
function authorizeStoredProof(proof,principal,receipt){
  const evidence=require('./operation-evidence.cjs');
  try{return evidence.authorizeProof(proof.status==='legacy-unverified'&&proof.request?.status==='unknown'?evidence.createLegacyProof(receipt):proof,principal,receipt);}catch{return false;}
}

function fail(code, message, status) {
  const error = new Error(message); error.code = code; error.status = status || 400; throw error;
}
function principalOf(principal) {
  const value = principal || { id:'local-profile', name:'Локальный пользователь', role:'admin' };
  if (!access.ROLES[value.role]) fail('ACCESS_DENIED', 'Не определена действующая роль пользователя', 403);
  return { id:String(value.id || 'local-profile'), name:String(value.name || 'Локальный пользователь'), role:value.role };
}
function visibleAudit(rows, principal, database) {
  const binding=historyBindings.get(rows);
  if(binding)return (rows||[]).map(row=>projectHistoryEvent(row,principal||{id:'local-profile',name:'Локальный пользователь',role:'admin'},binding)).filter(Boolean);
  // Older history has no sealed completeness or ownership witness. A limited
  // reader cannot acquire one by finding only the remaining hot siblings.
  if(accessContext().hasNarrowing(principal))return [];
  const db=database||{auditLog:rows||[]}, scoped=accessContext().hasNarrowing(principal), context=accessContext().create(db,db,{...principal,id:principal?.id||'legacy-role-check'});
  return (rows || []).filter(row => row && typeof row.section === 'string' && require('./document-access.cjs').permitted(principal, 'read', row.section) &&
    (!(row.printCapture||row.printArtifact)||Array.isArray(row.archiveReadSections)&&row.archiveReadSections.every(name=>require('./document-access.cjs').permitted(principal,'read',name)))&&
    (!row.importReadSections||row.importReadSections.every(name=>require('./document-access.cjs').permitted(principal,'read',name)))&&
    (row.type !== 'transaction' || Array.isArray(row.changedSections) && row.changedSections.every(name => require('./document-access.cjs').permitted(principal, 'read', name)))&&require('./document-access.cjs').auditAccess(principal,row)&&require('./period-access.cjs').auditAccess(principal,row))
    .filter(row=>!scoped||auditRowAllowed(row,principal,db,context)).map(row=>{
      let result=require('./period-access.cjs').visibleAuditRow(row,principal);
      if(row.type==='transaction'){const {archiveScope,...publicRow}=result;return publicRow;}
      const project=(value,phase)=>value?context.projectRows(row.section,[value],phase)[0]:undefined;
      const before=project(result.before,'before'),after=project(result.after,'after');
      const fields=Array.isArray(row.fields)?row.fields.filter(field=>(before&&Object.hasOwn(before,field))||(after&&Object.hasOwn(after,field))):row.fields;
      return {...result,...(row.before?{before}:{}),...(row.after?{after}:{}),...(fields?{fields}:{})};
    });
}
function auditRowAllowed(row,principal,db,context=accessContext().create(db,db,principal)) {
  if(row.type==='transaction') {
    if(row.printCapture||row.printArtifact||row.archiveSeals?.length){const proof=row.archiveScope;if(proof?.version!==1||!Array.isArray(proof.rows)||!proof.rows.length)return false;const frozen=Object.fromEntries(schema().sections.map(name=>[name,proof.rows.filter(item=>item.section===name).map(item=>item.row)])),ctx=accessContext().create(frozen,frozen,principal);if(!proof.rows.every(item=>ctx.permits(item.section,'read',item.row)&&kernel().stableSerialize(ctx.projectRows(item.section,[item.row])[0])===kernel().stableSerialize(item.row)))return false;if(row.changedSections?.every(name=>name==='appMeta'))return true;}
    const changes=(db.auditLog||[]).filter(value=>value?.source==='platform'&&value.operationId===row.operationId&&value.type!=='transaction');
    if(!changes.length)return !row.changedSections?.length;
    return changes.every(value=>auditRowAllowed(value,principal,db,context));
  }
  const values=[['before',row.before],['after',row.after]].filter(([,value])=>value);
  return values.length>0&&values.every(([phase,value])=>context.permits(row.section,'read',value,phase));
}
function visibleRows(name,rows,principal,database,preparedContext){
  const db=database||{[name]:rows||[]};
  if(name==='auditLog')return visibleAudit(rows,principal,db);
  const legacy=name==='fuelPeriods'?require('./period-access.cjs').visibleRows(rows,principal):require('./document-access.cjs').visibleRows(name,rows,principal);
  return (preparedContext||accessContext().create(db,db,{...principal,id:principal?.id||'legacy-role-check'})).projectRows(name,legacy);
}
function scopeViews(database,revisions,principal,names=Object.keys(database)) {
  if(!accessContext().hasNarrowing(principal))return {};
  const policyStamp=accessContext().policyStamp(principal);
  return Object.fromEntries(names.filter(name=>schema().sections.includes(name)&&require('./document-access.cjs').permitted(principal,'read',name)).map(name=>[name,{version:1,policyStamp,revision:revisions?.[name]||0,visibleFingerprint:'sha256:'+crypto.createHash('sha256').update(kernel().stableSerialize(visibleRows(name,database[name],principal,database))).digest('hex')}]));
}
function assertScopeViews(previous,sections,options={}) {
  if(!accessContext().hasNarrowing(options.principal)||options.commandIntent)return;
  const expected=scopeViews(previous,options.revisions,options.principal,Object.keys(sections));
  for(const name of Object.keys(sections)){
    if(name==='auditLog')continue;
    const witness=options.scopeViews?.[name],trusted=expected[name];
    if(!trusted||!witness||kernel().stableSerialize(witness)!==kernel().stableSerialize(trusted)||options.base?.[name]!==trusted.revision)
      fail('SCOPE_VIEW_REQUIRED','Загрузите полный доступный раздел перед сохранением: данные или права изменились.',428);
  }
}
function filteredResult(result,principal,database){
  if(!principal)return result;
  const out={...result},db=database||out.canonicalSections||{};
  if(out.revisions)out.revisions=Object.fromEntries(Object.entries(out.revisions).filter(([name])=>require('./document-access.cjs').permitted(principal,'read',name)));
  if(out.canonicalSections){out.scopeViews=scopeViews(db,out.revisions,principal,Object.keys(out.canonicalSections));out.canonicalSections=Object.fromEntries(Object.entries(out.canonicalSections).filter(([name])=>require('./document-access.cjs').permitted(principal,'read',name)).map(([name,rows])=>[name,visibleRows(name,rows,principal,db)]));}
  return out;
}
function findReceipt(rows,query,principal,token,database){
  const operation=contracts().validateOperation(query),actor=principalOf(principal);
  const binding=historyBindings.get(rows);
  if(binding){const result=binding.engine.lookup(binding.state.head,{id:operation.id,digest:operation.digest,actorId:actor.id,actorRole:actor.role,databaseToken:token},(proof,receipt)=>authorizeStoredProof(proof,principal||actor,receipt));return result?{id:result.id,digest:result.digest,status:'committed',at:result.at}:null;}
  if(accessContext().hasNarrowing(principal))return null;
  const receipt=(rows||[]).find(row=>row?.source==='platform'&&row.type==='transaction'&&row.operationId===operation.id&&
    (!row.importReadSections||row.importReadSections.every(name=>require('./document-access.cjs').permitted(principal||actor,'read',name)))&&row.actorId===actor.id&&row.actorRole===actor.role&&row.databaseToken===token&&row.requestDigest===operation.digest&&
    (!(row.printCapture||row.printArtifact)||Array.isArray(row.archiveReadSections)&&row.archiveReadSections.every(name=>require('./document-access.cjs').permitted(principal||actor,'read',name)))&&
    Array.isArray(row.changedSections)&&row.changedSections.every(name=>require('./document-access.cjs').permitted(principal||actor,'read',name))&&require('./document-access.cjs').auditAccess(principal||actor,row)&&require('./period-access.cjs').auditAccess(principal||actor,row));
  return receipt && (!accessContext().hasNarrowing(principal)||auditRowAllowed(receipt,principal,database||{auditLog:rows})) ? {id:operation.id,digest:receipt.requestDigest,status:'committed',at:receipt.at} : null;
}
function operationInfo(previous, sections, options = {}) {
  if (!options.operation) return null;
  const operation = contracts().validateOperation(options.operation);
  const actor = principalOf(options.principal);
  // commandIntent is a trusted internal option, never accepted from the raw
  // sections/full-write transport. Generated rows and server clocks must not
  // change the identity of a semantic command or prevent its receipt replay.
  const digest = kernel().requestDigest(options.commandIntent || { base:options.base || {}, sections,...(options.scopeViews?{scopeViews:options.scopeViews}:{}) });
  if (operation.digest != null && operation.digest !== digest) fail('OPERATION_DIGEST', 'Состав операции изменился после подготовки', 409);
  const binding=historyBindings.get(previous.auditLog);
  if(binding){
    let result;
    try{result=binding.engine.lookup(binding.state.head,{id:operation.id,digest,actorId:actor.id,actorRole:actor.role,databaseToken:options.databaseToken},(proof,receipt)=>authorizeStoredProof(proof,options.principal||actor,receipt),{mode:'replay'});}
    catch(error){if(error.code==='OPERATION_REUSED')error.status=409;else if(error.code==='ACCESS_DENIED')error.status=403;throw error;}
    return {id:operation.id,digest,actor,principal:options.principal||actor,receipt:result?literalReceipt(result):null,historyValidated:!!result};
  }
  const receipt = (previous.auditLog || []).find(row => row.source === 'platform' && row.type === 'transaction' && row.operationId === operation.id);
  if (receipt && (receipt.requestDigest !== digest || receipt.actorId !== actor.id || receipt.actorRole !== actor.role || receipt.databaseToken !== options.databaseToken))
    fail('OPERATION_REUSED', 'Этот идентификатор операции уже использован для другого состава, пользователя или базы', 409);
  return { id:operation.id, digest, actor, principal:options.principal||actor, receipt };
}
function replayResult(previous, revisions, token, info, names) {
  if (!info?.receipt) return null;
  if(!info.historyValidated&&accessContext().hasNarrowing(info.principal))fail('ACCESS_DENIED','Нет полного подтверждённого свидетельства для результата прежней операции.',403);
  if(info.receipt.importReadSections?.some(name=>!require('./document-access.cjs').permitted(info.principal||info.actor,'read',name)))fail('ACCESS_DENIED','Нет доступа ко всему исходному файлу импорта',403);
  const canonicalSections = {};
  for (const name of new Set([...names, 'auditLog'])) {
    if (!access.authorize(info.principal||info.actor, 'read', name)) continue;
    canonicalSections[name] = previous[name]||[];
  }
  const archive=info.receipt.printCapture?info.receipt.archiveSeals?.[0]:null;
  if(archive&&Array.isArray(info.receipt.archiveReadSections)&&info.receipt.archiveReadSections.some(name=>!require('./document-access.cjs').permitted(info.principal||info.actor,'read',name)))fail('ACCESS_DENIED','Недостаточно прав для печатного снимка',403);
  return { ok:true, changed:[], revisions, databaseToken:token, canonicalSections, replayed:true,
    ...(info.receipt.archiveSeals?.length?{archiveHeadChanged:true}:{}),...(archive?{archive:{id:archive.id,snapshotFingerprint:archive.snapshotFingerprint}}:{}),
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
function canonicalShiftAcceptance(previous,sections,actor,at,context) {
  if(!Object.hasOwn(sections,'shiftReports'))return sections;
  const old=new Map();
  for(const row of previous.shiftReports || []){const key=typeof row.id+':'+JSON.stringify(row.id);if(!old.has(key))old.set(key,[]);old.get(key).push(row);}
  const rows=sections.shiftReports.map(row=>{
    const matches=old.get(typeof row.id+':'+JSON.stringify(row.id)) || [],before=matches.length===1?matches[0]:null;
    if(row.status==='accepted'&&matches.some(item=>item.status!=='accepted')) {
      if(matches.length!==1)fail('SHIFT_ACCEPTANCE_AMBIGUOUS','Нельзя принять сменную форму с неоднозначным ID. Сначала проверьте её историю.',409);
      if(before.status!=='sent')fail('SHIFT_ACCEPTANCE_TRANSITION','Принять можно только отправленную сменную форму.',409);
      const accepted={...row,acceptedActor:{...actor},acceptedAt:at};
      accepted.personnelSnapshot=require('../assets/core/personnel-planning.js').captureShiftContext({...previous,...sections},accepted,context).snapshot;
      return accepted;
    }
    if(row.status==='accepted'&&!matches.length){
      if(context.commandIntent?.command?.type!=='DocumentAction')fail('SHIFT_ACCEPTANCE_COMMAND','Новую принятую смену оформляйте проверенным действием документа.',403);
      const accepted={...row,acceptedActor:{...actor},acceptedAt:at};
      accepted.personnelSnapshot=require('../assets/core/personnel-planning.js').captureShiftContext({...previous,...sections},accepted,context).snapshot;
      return accepted;
    }
    // An accepted historical row remains immutable, including its old metadata.
    // Unaccepted rows cannot manufacture approval metadata in advance.
    if(row.status!=='accepted'&&['acceptedActor','acceptedAt'].some(field=>JSON.stringify(row[field])!==JSON.stringify(before?.[field])))
      fail('SHIFT_ACCEPTANCE_METADATA','Реквизиты учётной записи и времени приёмки формируются программой.',403);
    return row;
  });
  return {...sections,shiftReports:rows};
}
function assertScopeSnapshots(previous,sections,commandIntent){
  const key=row=>typeof row.id+':'+JSON.stringify(row.id),stable=kernel().stableSerialize;
  const inputHasProof=value=>!!value&&typeof value==='object'&&(Object.hasOwn(value,'scopeSnapshot')||Object.values(value).some(inputHasProof));
  if(commandIntent&&inputHasProof(commandIntent.command?.input))fail('ACCESS_SCOPE_IMMUTABLE','Принадлежность проведённой записи формируется программой.',403);
  for(const [name,rows]of Object.entries(sections)){
    if(name==='auditLog')continue;const before=previous[name]||[];
    const groups=new Map();let snapshots;
    for(const row of before){const id=key(row),group=groups.get(id);if(group)group.push(row);else groups.set(id,[row]);}
    for(const row of rows){const matches=groups.get(key(row)),old=matches?.length===1?matches[0]:null;
      if(old&&stable(old.scopeSnapshot)!==stable(row.scopeSnapshot)||!old&&row.scopeSnapshot!==undefined&&(!commandIntent||!(snapshots??=new Set(before.map(value=>stable(value.scopeSnapshot)))).has(stable(row.scopeSnapshot))))fail('ACCESS_SCOPE_IMMUTABLE','Сохранённую принадлежность записи нельзя менять или задавать вручную.',403);
    }
  }
}
function stampPostingScopes(previous,plan,context){
  const next={...previous,...plan.sections},requests=require('../assets/core/document-print.js').postingRequests(previous,next),sections={...plan.sections},stamped=new Map();
  for(const request of requests){const name=request.source.section,id=request.source.id,rows=sections[name];if(!rows)continue;const matches=rows.filter(row=>row.id===id);if(matches.length!==1||matches[0].scopeSnapshot!==undefined)continue;
    const row=matches[0],snapshot=require('../assets/core/access-scope.js').capture(next,name,row,{now:context.now,actor:context.actor});
    if(snapshot.complete!==true)continue;
    const after={...row,scopeSnapshot:snapshot};sections[name]=rows.map(value=>value===row?after:value);next[name]=sections[name];stamped.set(name+'|'+typeof id+':'+JSON.stringify(id),after);
  }
  if(!stamped.size)return plan;
  const rowChanges=plan.rowChanges.map(change=>{const after=stamped.get(change.section+'|'+typeof change.recordId+':'+JSON.stringify(change.recordId));return after?{...change,after,fields:[...new Set([...change.fields,'scopeSnapshot'])].sort()}:change;});
  return {...plan,sections,rowChanges};
}
function prepareTransaction(previous, supplied, options = {}) {
  const registry = schema().sections, principal=accessContext().normalizePrincipal(options.principal||{id:'local-profile',name:'Локальный пользователь',role:'admin'}), actor = principalOf(principal);
  options={...options,principal};
  contracts().validateSections(supplied,registry);
  const info = operationInfo(previous, supplied, { ...options, principal:options.principal||actor });
  if (info?.receipt) return { replayed:true, operation:info };
  assertScopeViews(previous,supplied,options);
  require('./document-archive.cjs').assertHead(previous,{...previous,...supplied});
  assertAuditPrefix(previous, supplied, options.principal||actor);
  // Client-generated audit suffixes are hints, never persisted as trusted facts.
  const scoped=accessContext().create(previous,previous,principal);
  const merged=Object.fromEntries(Object.entries(supplied).map(([name,rows])=>[name,name==='auditLog'||options.commandIntent||!accessContext().hasNarrowing(principal)?rows:scoped.mergeVisibleChanges(name,rows)]));
  let sections = require('./period-access.cjs').mergePeriods(previous,require('./document-access.cjs').mergeDrafts(previous,Object.fromEntries(Object.entries(merged).filter(([name]) => name !== 'auditLog')),options.principal||actor),options.principal||actor);
  const periodCommand=options.commandIntent?.command?.type==='PeriodAction'&&require('./period-access.cjs').canManage(options.principal||actor,options.commandIntent.command.input?.scope);
  const costCommand=options.commandIntent?.command?.type==='CostAction'&&options.commandIntent.command.input?.action==='savePolicy'&&access.costActions(options.principal||actor).includes('savePolicy');
  const costTarget=costCommand?options.commandIntent.command.input.target?.section:null;
  for (const [name, rows] of Object.entries(sections)) {
    if (JSON.stringify(previous[name] || []) === JSON.stringify(rows)) continue;
    if (!access.authorize(principal, 'write', name)&&!(name==='fuelPeriods'&&periodCommand)&&!(name===costTarget&&costCommand)) fail('ACCESS_DENIED', 'Роль не разрешает изменение раздела: ' + name, 403);
    try { access.validateAssetChanges(actor, name, previous[name] || [], rows); }
    catch (error) { fail('ACCESS_DENIED', error.message, 403); }
  }
  assertScopeSnapshots(previous,sections,options.commandIntent);
  const at = options.now || new Date().toISOString();
  if (!Number.isFinite(Date.parse(at))) fail('INVALID_CLOCK', 'Некорректное время операции');
  const id = info?.id || 'backend:' + crypto.randomUUID();
  const calendar=require('../assets/core/business-calendar.js'),clock=calendar.resolve(previous,at);
  const commandProof=['MergeCatalog','AcceptShift','DocumentAction','PeriodAction','FuelAction','ProcurementAction','CostAction','RepairAction','CalendarAction','ImportAction'].includes(options.commandIntent?.command?.type)
    ? {commandIntent:contracts().parseCommandEnvelope(options.commandIntent,registry)} : {};
  const importProof=commandProof.commandIntent?.command?.type==='ImportAction'&&options.importSource?{importSource:options.importSource}:{};
  const temporalContext={id,now:at,today:clock.today,calendar:clock,actor,...commandProof,...importProof};
  calendar.assertSuppliedMetadata(previous,sections,temporalContext);
  const calendarInput=commandProof.commandIntent?.command?.type==='CalendarAction'?commandProof.commandIntent.command.input:null;
  sections=calendar.canonicalizeIntervals(previous,sections,temporalContext,calendarInput?.action==='confirmInterval'?{confirm:calendarInput.target,reason:calendarInput.reason}:{});
  sections=canonicalShiftAcceptance(previous,sections,actor,at,temporalContext);
  sections=require('../assets/core/temporal-policy.js').canonicalizeOrigins(previous,sections);
  if (options.prepareSections) sections = options.prepareSections(sections);
  // This proof is derived from the semantic execution option, never a section
  // request field. Raw/full writes cannot authorize their own catalog aliases.
  const kernelPrevious=commandProof.commandIntent?.command?.type==='MergeCatalog'?require('./catalog-history.cjs').reviewDatabase(options.dataDir,previous,options.principal||actor):previous;
  let plan = kernel().prepare(kernelPrevious, sections, { id, identity:options.databaseToken || 'local-storage', actor,
    revisions:options.revisions || {}, now:at,today:clock.today,calendar:clock,...commandProof,...importProof,
    readable:registry.filter(name => require('./document-access.cjs').permitted(options.principal||actor, 'read', name)),
    writable:registry.filter(name => require('./document-access.cjs').permitted(options.principal||actor, 'write', name)||name==='fuelPeriods'&&periodCommand||name===costTarget&&costCommand) });
  plan=stampPostingScopes(previous,plan,{now:at,actor});
  const finalAccess=accessContext().create(previous,{...previous,...plan.sections},principal,{writableOverrides:[...(periodCommand?['fuelPeriods']:[]),...(costTarget?[costTarget]:[])],...(costTarget?{writeFields:{[costTarget]:['costProfile']}}:{})});
  if(accessContext().hasNarrowing(principal))for(const [name,rows] of Object.entries(plan.sections))if(name!=='auditLog'){
    const firstById=new Map();for(const row of previous[name]||[])if(!firstById.has(row.id))firstById.set(row.id,row);
    finalAccess.validateChanges(name,rows.map(row=>{const old=firstById.get(row.id);if(!old?.scopeSnapshot&&row.scopeSnapshot){const {scopeSnapshot,...business}=row;return business;}return row;}));
  }
  require('./attachment-access.cjs').validateChanges(options.dataDir,previous,{...previous,...plan.sections},{principal,databaseToken:options.databaseToken});
  const changes = (plan.rowChanges || []).filter(row => row.section !== 'auditLog');
  const result = { ...plan.sections };
  delete result.auditLog;
  const changed = Object.keys(result);
  if (!changed.length && !info) return { sections:{}, plan, operationReceipt:null };
  const digest = info?.digest || kernel().requestDigest({ base:options.base || {}, sections:supplied,...(options.scopeViews?{scopeViews:options.scopeViews}:{}) });
  const entries = changes.map(row => ({ id:'audit_' + crypto.randomUUID(), at, actor:actor.name, actorId:actor.id, actorRole:actor.role,
    source:'platform', operationId:id, section:row.section, recordId:String(row.recordId ?? row.key), action:row.action,
    fields:row.fields, before:row.before, after:row.after,...(importProof.importSource?{importReadSections:importProof.importSource.sourceScopes||importProof.importSource.sections}:{} ) }));
  const revisions = {};
  for (const name of [...changed, 'auditLog']) revisions[name] = (options.revisions?.[name] || 0) + 1;
  const receipt = { id:'operation:' + id, type:'transaction', action:'transaction', source:'platform', section:'auditLog', recordId:id,
    operationId:id, requestDigest:digest, databaseToken:options.databaseToken, at,
    actor:actor.name, actorId:actor.id, actorRole:actor.role, changedSections:changed, revisions };
  if(importProof.importSource)receipt.importReadSections=importProof.importSource.sourceScopes||importProof.importSource.sections;
  if(changed.includes('documentDrafts'))receipt.changedDocumentSections=require('./document-access.cjs').changedOrigins(previous.documentDrafts,result.documentDrafts);
  if(changed.includes('fuelPeriods'))receipt.changedPeriodScopes=require('./period-access.cjs').changedScopes(previous.fuelPeriods,result.fuelPeriods);
  result.auditLog = [...(previous.auditLog || []), ...entries, receipt];
  return { sections:result, plan, operationReceipt:{ id, digest, status:'committed', at } };
}

function prepareHistoryCommit(dataDir,previous,sections,revisions,options={}){
  const store=require('./operation-store.cjs'),evidence=require('./operation-evidence.cjs'),before=previous.auditLog||[],after=sections.auditLog;
  if(!Array.isArray(after)||after.length<before.length||before.some((row,index)=>JSON.stringify(row)!==JSON.stringify(after[index])))fail('AUDIT_IMMUTABLE','История изменяется только доверенным добавлением событий.',403);
  const events=after.slice(before.length),summaries=events.filter(row=>row.source==='platform'&&row.type==='transaction');
  if(summaries.length!==1)fail('OPERATION_RECEIPT_REQUIRED','Для сохранения нужно одно каноническое подтверждение операции.',409);
  const literal=summaries[0],receipt=require('./operation-record.cjs').fromAuditRow(literal),next={...previous,...sections};
  const principal=accessContext().normalizePrincipal(options.principal||{id:'local-profile',name:'Локальный пользователь',role:'admin'}),writes=Object.keys(sections).filter(name=>name!=='auditLog');
  let collector;
  if(options.commandIntent){const command=options.commandIntent.command,dependencies=require('../assets/core/platform-commands.js').dependencies(command);collector=require('./command-service.cjs').collectCommandEvidence(previous,command,dependencies,{strict:false});}
  else{
    const reads=[...new Set([...(options.historyInputSections||Object.keys(options.base||{})),...writes])].filter(name=>name!=='auditLog'&&schema().sections.includes(name)),selectedTargets=[];
    const readContext=accessContext().create(previous,previous,principal);
    for(const name of reads){const counts=new Map();for(const row of previous[name]||[])if(Object.hasOwn(row,'id'))counts.set(row.id,(counts.get(row.id)||0)+1);
      (previous[name]||[]).forEach((row,index)=>{
        if(!visibleRows(name,[row],principal,previous,readContext).length)return;
        if(Object.hasOwn(row,'id')&&counts.get(row.id)===1)selectedTargets.push({section:name,id:row.id});
        else selectedTargets.push({section:name,before:row,after:null,beforeIndex:index});
      });
    }
    collector={complete:true,readSections:reads,selectedTargets};
  }
  const selected=collector.selectedTargets.slice();
  if(options.importSource){const section=options.importSource.sourceScopes?.[0];if(!schema().sections.includes(section))fail('OPERATION_EVIDENCE_INVALID','Не подтверждены разделы исходного импорта',409);selected.push({section,kind:'source',value:options.importSource});}
  selected.push(...require('./document-archive.cjs').operationEvidenceModels(dataDir,literal,sections));
  const proof=evidence.createProof({previous,next,principal,mode:'transaction',sections:{complete:collector.complete,readSections:collector.readSections,writeSections:writes,selectedTargets:selected},receipt,events,...(options.commandIntent?{commandIntent:options.commandIntent}:{})});
  if(!evidence.authorizeProof(proof,principal,receipt))fail('OPERATION_EVIDENCE_ACCESS','Текущие права не подтверждают все источники и результат операции.',403);
  const prepared=store.prepareCommit(dataDir,{expectedOperationState:store.readState(dataDir),previousHotRows:before,newEvents:events,receipt,evidence:proof});
  // Keep the array capability and the artifact caller's canonical reference.
  after.splice(0,after.length,...prepared.hotRows);
  return {sections,...prepared};
}
function readReceipt(dataDir,query,principal){
  const operation=contracts().validateOperation(query),actor=principalOf(principal),store=require('./operation-store.cjs'),token=require('./storage').databaseToken(dataDir),state=store.readState(dataDir);
  const result=store.engine(dataDir).lookup(state.head,{id:operation.id,digest:operation.digest,actorId:actor.id,actorRole:actor.role,databaseToken:token},(proof,receipt)=>authorizeStoredProof(proof,principal||actor,receipt));
  return {ok:true,databaseToken:token,operationReceipt:result?{id:result.id,digest:result.digest,status:'committed',at:result.at}:null};
}
function queryHistoryInternal(dataDir,input,principal){
  const normalized=accessContext().normalizePrincipal(principal),store=require('./operation-store.cjs');
  if(!require('./document-access.cjs').permitted(normalized,'read','auditLog'))fail('ACCESS_DENIED','Нет доступа к истории операций.',403);
  if(!input||typeof input!=='object'||Array.isArray(input)||Buffer.byteLength(JSON.stringify(input))>8192)fail('HISTORY_QUERY','Некорректный запрос истории.');
  const value=contracts().validateSections({appMeta:[input]},schema().sections).appMeta[0];
  if(Object.keys(value).some(name=>!['query','limit','cursor'].includes(name)))fail('HISTORY_QUERY','Некорректный запрос истории.');
  const token=require('./storage').databaseToken(dataDir),state=store.readState(dataDir),evidence=require('./operation-evidence.cjs'),principalStamp='sha256:'+crypto.createHash('sha256').update(kernel().stableSerialize([normalized.id,normalized.role,normalized.policyStamp])).digest('hex');
  return {ok:true,databaseToken:token,...store.engine(dataDir).page(state.head,{databaseToken:token,principalStamp,query:value.query||{},limit:value.limit??25,...(value.cursor===undefined?{}:{cursor:value.cursor})},(event,context)=>publicAuditRow(context.proof.status==='legacy-unverified'&&context.proof.request?.status==='unknown'?evidence.projectLegacyEvent(event,normalized):evidence.projectEvent(event,context.proof,normalized)))};
}
function queryHistory(dataDir,input,principal){return require('./storage').withDatabaseLock(dataDir,()=>{const sqlite=require('./sqlite-storage.cjs'),action=()=>queryHistoryInternal(dataDir,input,principal);return sqlite.exists(dataDir)?sqlite.transaction(dataDir,action,{readOnly:true}):action();});}

module.exports = { prepareTransaction, prepareHistoryCommit, bindHistory, readReceipt, queryHistory, operationInfo, replayResult, visibleAudit,visibleRows,filteredResult,findReceipt,scopeViews,assertScopeViews,auditRowAllowed };
