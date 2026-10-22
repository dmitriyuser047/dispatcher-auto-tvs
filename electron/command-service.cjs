'use strict';

// Semantic commands are planned against one locked, current database. The pure
// planner cannot choose a principal, clock, receipt or commit boundary.
const storage=require('./storage');
const sqlite=require('./sqlite-storage.cjs');
const access=require('./access-control');
const platform=require('./platform-service.cjs');
const contracts=require('../assets/core/platform-contracts.js');
const schema=require('../assets/core/platform-schema.js');
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
function fail(code,message,status=400){const error=new Error(message);error.code=code;error.status=status;throw error;}
function checkedPrincipal(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.id!=='string'||!value.id||!Object.hasOwn(access.ROLES,value.role))fail('ACCESS_DENIED','Не подтверждена действующая учётная запись.',403);
  for(const field of ['readable','writable'])if(value[field]!==undefined&&(!Array.isArray(value[field])||value[field].some(name=>!schema.sections.includes(name)&&name!=='*')))fail('ACCESS_DENIED','Не подтверждены действующие права.',403);
  return require('./access-context.cjs').normalizePrincipal({...value,id:value.id,name:typeof value.name==='string'&&value.name?value.name:value.id});
}
function permitted(principal,action,name){
  const narrowed=principal[action==='read'?'readable':'writable'];
  return access.authorize(principal,action,name)&&(!narrowed||narrowed.includes('*')||narrowed.includes(name));
}
function requireAccess(principal,action,names){if(names.some(name=>!permitted(principal,action,name)))fail('ACCESS_DENIED','Недостаточно прав для выполнения этой команды.',403);}
const stable=value=>require('../assets/core/platform-kernel.js').stableSerialize(value);
function filteredResult(result,principal,database){return platform.filteredResult(result,principal,database);}
function semanticAction(command){
  const names={DocumentAction:'document',FuelAction:'fuel',ProcurementAction:'procurement',CostAction:'cost',RepairAction:'repair',CalendarAction:'calendar',PeriodAction:'period'};
  if(names[command.type])return names[command.type]+':'+command.input.action;
  return command.type==='ImportAction'?'import:'+command.input.profile:command.type==='PrintAction'?'print:capture':command.type==='MergeCatalog'?'catalog:merge':command.type==='IssueFuel'?'fuel:issue':command.type==='AcceptShift'?'shift:accept':'assignment:save';
}
function assertCommandScope(database,command,dependencies,principal){
  if(!require('./access-context.cjs').hasNarrowing(principal))return;
  const context=require('./access-context.cjs').create(database,database,principal),selected=new Map(),keys=new Map(),assets=new Set();
  const add=(name,id)=>{if(id===undefined||id===null||id==='')return;const key=stable([name,typeof id,id]);if(!keys.has(name))keys.set(name,new Set());keys.get(name).add(stable([typeof id,id]));const rows=(database[name]||[]).filter(row=>row.id===id);if(rows.length!==1)fail('ACCESS_DENIED','Недостаточно прав или не подтверждён источник команды.',403);if(selected.has(key))return;selected.set(key,{name,row:rows[0]});if(['vehicles','generators','tanks'].includes(name))assets.add(({vehicles:'v',generators:'g',tanks:'t'})[name]+':'+String(id));};
  const fieldSections={vehicleId:'vehicles',generatorId:'generators',tankId:'tanks',fromTankId:'tanks',toTankId:'tanks',driverId:'drivers',jobId:'dispatchJobs',shiftId:'shiftReports',assignmentId:'assetAssignments',replacesAssignmentId:'assetAssignments',measurementId:'fuelMovements',outId:'tankIncomes',inId:'tankIncomes',partId:'parts',workOrderId:'workOrders',repairId:'repairs',vehicleToId:'vehicleTo',toRecordId:'toRecords',allocationId:'costEntries',draftId:'documentDrafts',contragentId:'contragents'};
  const scan=value=>{if(Array.isArray(value)){value.forEach(scan);return;}if(!value||typeof value!=='object')return;if(typeof value.section==='string'&&schema.sections.includes(value.section)&&own(value,'id'))add(value.section,value.id);for(const [field,item]of Object.entries(value)){if(fieldSections[field])add(fieldSections[field],item);else if(field==='assetRef'&&typeof item==='string'){const result=require('../assets/core/entity-identity.js').resolveAsset(database,item);if(result.status!=='known')fail('ACCESS_DENIED','Не подтверждён источник команды.',403);add(result.section,result.id);}else if(item&&typeof item==='object')scan(item);}};
  scan(command.type==='DocumentAction'&&command.input.payload&&!(database[command.input.section]||[]).some(row=>row.id===command.input.id)?{...command.input,id:undefined}:command.input);
  if(command.input.orderId!==undefined)add(command.type==='RepairAction'?'workOrders':'procurementOrders',command.input.orderId);
  if(command.type==='DocumentAction'&&command.input.id!==undefined&&(database[command.input.section]||[]).some(row=>row.id===command.input.id))add(command.input.section,command.input.id);
  if(command.type==='MergeCatalog'){add(command.input.section,command.input.sourceId);add(command.input.section,command.input.targetId);}
  if(command.type==='ProcurementAction'&&command.input.payload)add(command.input.payload.kind==='tank'?'tanks':'parts',command.input.payload.itemId);
  // Related balance/history rows are checked against the complete locked source,
  // so a hidden contributing movement never becomes an apparent zero balance.
  let count=-1;
  while(count!==selected.size){count=selected.size;for(const {row}of [...selected.values()])scan(row);for(const name of dependencies)for(const row of database[name]||[]){
    const related=typeof row.assetRef==='string'&&assets.has(row.assetRef)||Object.entries(fieldSections).some(([field,section])=>keys.get(section)?.has(stable([typeof row[field],row[field]])))||row.month&&row.month===(command.input.month||command.input.date?.slice(0,7));
    if(related){if(row.id!==undefined)add(name,row.id);else if(!context.permits(name,'read',row)||stable(context.projectRows(name,[row])[0])!==stable(row))fail('ACCESS_DENIED','Недостаточно прав для всех источников команды.',403);}
  }}
  if(!selected.size||['PeriodAction','ImportAction','MergeCatalog'].includes(command.type))for(const name of dependencies)for(const row of database[name]||[])if(row.id!==undefined)add(name,row.id);else{if(!context.permits(name,'read',row)||stable(context.projectRows(name,[row])[0])!==stable(row))fail('ACCESS_DENIED','Недостаточно прав для всех источников команды.',403);}
  for(const {name,row}of selected.values())if(!context.permits(name,'read',row)||stable(context.projectRows(name,[row])[0])!==stable(row))fail('ACCESS_DENIED','Недостаточно прав для всех источников команды.',403);
  return context;
}
function assertSemanticChanges(database,sections,command,principal){
  if(!require('./access-context.cjs').hasNarrowing(principal))return;
  const next={...database,...sections},ctx=require('./access-context.cjs').create(database,next,principal),action=semanticAction(command),key=row=>stable([typeof row.id,row.id]);
  for(const [name,rows]of Object.entries(sections)){
    if(name==='auditLog')continue;const before=database[name]||[],old=new Map(before.map(row=>[key(row),row])),after=new Map(rows.map(row=>[key(row),row]));
    for(const row of before)if(!after.has(key(row))&&!ctx.permits(name,action,row,'before'))fail('ACCESS_DENIED','Нет права на выбранное действие.',403);
    for(const row of rows)if(stable(old.get(key(row)))!==stable(row)&&(!ctx.permits(name,action,row,'after')||old.has(key(row))&&!ctx.permits(name,action,old.get(key(row)),'before')))fail('ACCESS_DENIED','Нет права на выбранное действие.',403);
  }
}
function executeInternal(dataDir,input,options={}){
  const commands=require('../assets/core/platform-commands.js');
  const envelope=contracts.parseCommandEnvelope(input,schema.sections),command=commands.parseCommand(envelope.command),principal=checkedPrincipal(options.principal);
  const catalogMerge=command.type==='MergeCatalog';
  const periodAction=command.type==='PeriodAction',costPolicy=command.type==='CostAction'&&command.input.action==='savePolicy';
  const dependencies=commands.dependencies(command),footprint=commands.footprint(command);
  const primary=command.type==='PrintAction'?[command.input.request.source?.section||command.input.request.target?.section]:command.type==='DocumentAction'?[command.input.section]:command.type==='CostAction'?[command.input.action==='savePolicy'?'costProfiles':'costEntries']:command.type==='RepairAction'?['workOrders']:command.type==='PeriodAction'?['fuelPeriods']:command.type==='CalendarAction'?[command.input.target?.section||'appMeta']:footprint;
  const authorizeNewIntent=()=>{
  if(command.type==='ImportAction'&&!require('./import-source.cjs').actions(principal).includes(command.input.profile))fail('ACCESS_DENIED','Недостаточно прав для выбранного профиля импорта.',403);
  if(catalogMerge&&principal.role!=='admin')fail('ACCESS_DENIED','Объединение справочников доступно администратору.',403);
  if(periodAction&&!require('./period-access.cjs').canManage(principal,command.input.scope))fail('ACCESS_DENIED','Недостаточно прав для управления выбранной областью периода.',403);
  if(command.type==='FuelAction'&&!permitted(principal,'write','fuelMovements'))fail('ACCESS_DENIED','Недостаточно прав для проведения операций с топливом.',403);
  if(command.type==='ProcurementAction'&&!access.procurementActions(principal)[command.input.action==='saveOrder'?command.input.payload.kind:command.input.kind]?.includes(command.input.action))fail('ACCESS_DENIED','Недостаточно прав для выбранного действия с закупкой.',403);
  if(command.type==='CostAction'&&!access.costActions(principal).includes(command.input.action))fail('ACCESS_DENIED','Недостаточно прав для выбранного действия со стоимостью.',403);
  if(command.type==='RepairAction'&&!access.repairActions(principal).includes(command.input.action))fail('ACCESS_DENIED','Недостаточно прав для выбранного действия с ремонтом.',403);
  if(command.type==='CalendarAction'&&!access.canCalendarAction(principal,command.input))fail('ACCESS_DENIED','Недостаточно прав для выбранного действия рабочего календаря.',403);
  if(!primary.some(name=>access.actionAvailable(principal,semanticAction(command),name)))fail('ACCESS_DENIED','Нет права на выбранное действие.',403);
  requireAccess(principal,'write',periodAction?footprint.filter(name=>name!=='fuelPeriods'):costPolicy?footprint.filter(name=>name!==command.input.target.section):command.type==='PrintAction'?[]:footprint);
  };
  if(!Array.isArray(dependencies)||!Array.isArray(footprint)||dependencies.some(name=>!schema.sections.includes(name)||name==='auditLog'&&!catalogMerge)||footprint.some(name=>name==='auditLog'||!dependencies.includes(name)))fail('COMMAND_DEFINITION','Некорректно определены зависимости команды',500);
  requireAccess(principal,'read',dependencies);
  return storage.withDatabaseLock(dataDir,()=>{
    const action=()=>{
      const snapshot=storage.readSnapshot(dataDir),token=snapshot.databaseToken;
      if(envelope.databaseToken!==token)return {ok:false,databaseChanged:true,databaseToken:token,code:'DATABASE_CHANGED',error:'База изменилась. Загрузите её заново перед выполнением команды.'};
      // A previously committed intent wins before stale dependency versions,
      // changing source objects and newly generated timestamps are consulted.
      const info=platform.operationInfo(snapshot.data,{}, {operation:envelope.operation,principal,databaseToken:token,commandIntent:envelope});
      if(info?.receipt){
        if(info.receipt.importReadSections)requireAccess(principal,'read',info.receipt.importReadSections);
        const changed=info.receipt.changedSections;
        if(!Array.isArray(changed)||changed.some(name=>!schema.sections.includes(name)))fail('COMMAND_RECEIPT','Повреждена квитанция команды',500);
        requireAccess(principal,'read',changed);
        return filteredResult(platform.replayResult(snapshot.data,snapshot.revisions,token,info,changed),principal,snapshot.data);
      }
      authorizeNewIntent();
      storage.assertWriteCompatibility(dataDir,options,command.type==='ImportAction'?'controlledImports':command.type==='PrintAction'?'documentPrint':undefined);
      storage.assertWritable(dataDir,options);
      const importSource=command.type==='ImportAction'?require('./import-source.cjs').load(dataDir,command.input.sourceId,principal):null;
      const missing=dependencies.filter(name=>!own(envelope.base,name));
      if(missing.length)fail('COMMAND_BASE_REQUIRED','Для команды нужны версии всех её зависимостей: '+missing.join(', '),428);
      const conflicts=dependencies.filter(name=>envelope.base[name]!==snapshot.revisions[name]);
      if(conflicts.length)return filteredResult({ok:false,command:true,code:'COMMAND_CONFLICT',conflicts,revisions:snapshot.revisions,databaseToken:token,error:'Источники команды изменились. Загрузите данные и повторите проверку.'},principal);
      assertCommandScope(snapshot.data,command,dependencies,principal);
      const now=options.now||new Date().toISOString();
      if(typeof now!=='string'||!Number.isFinite(Date.parse(now)))fail('INVALID_CLOCK','Некорректное время команды');
      const actor={id:principal.id,name:principal.name,role:principal.role};
      const clock=require('../assets/core/business-calendar.js').resolve(snapshot.data,now);
      const planned=commands.plan(snapshot.data,command,{id:envelope.operation.id,now,today:clock.today,calendar:clock,actor,
        ...(importSource?{importSource}:{}),readable:schema.sections.filter(name=>permitted(principal,'read',name)),writable:schema.sections.filter(name=>permitted(principal,'write',name))});
      if(!planned||!planned.sections||Object.keys(planned.sections).some(name=>!footprint.includes(name)))fail('COMMAND_DEFINITION','Команда попыталась изменить посторонний раздел',500);
      contracts.validateSections(planned.sections,schema.sections);
      assertSemanticChanges(snapshot.data,planned.sections,command,principal);
      // The shared kernel validates precision with the same trusted intent,
      // after receipt lookup and before backup/commit. Do not prevalidate a
      // correction without its independently reproducible document proof.
      const result=storage.writeSections(dataDir,{databaseToken:token,base:envelope.base,sections:planned.sections,operation:envelope.operation},
        {principal,now,commandIntent:envelope,...(importSource?{importSource}:{}),requireNegotiatedWriter:options.requireNegotiatedWriter,assertWriteCompatibility:options.assertWriteCompatibility,requireWriterSchema:options.requireWriterSchema,writerSchemaVersion:options.writerSchemaVersion,beforeCommit:options.beforeCommit});
      return {...result,command:true};
    };
    // Do not split snapshot, dependency checks and business/audit writes across
    // SQLite snapshots. Nested storage calls reuse this write connection.
    const readOnly=storage.schemaVersion(dataDir)<require('./storage-format.cjs').SCHEMA_VERSION||options.requireWriterSchema===true&&options.writerSchemaVersion!==require('./storage-format.cjs').SCHEMA_VERSION||!storage.hasWriteCompatibility(dataDir,options,command.type==='ImportAction'?'controlledImports':command.type==='PrintAction'?'documentPrint':undefined),result=sqlite.exists(dataDir)?sqlite.transaction(dataDir,action,{readOnly}):action();
    if(!readOnly&&!result?.replayed)require('./document-archive.cjs').recover(dataDir,undefined,options);return result;
  });
}
function execute(dataDir,input,options={}){try{return executeInternal(dataDir,input,options);}catch(error){throw access.publicError(error,options.principal);}}
module.exports=Object.freeze({execute,assertCommandScope,assertSemanticChanges,semanticAction});
