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
  return {...value,id:value.id,name:typeof value.name==='string'&&value.name?value.name:value.id};
}
function permitted(principal,action,name){
  const narrowed=principal[action==='read'?'readable':'writable'];
  return access.authorize(principal,action,name)&&(!narrowed||narrowed.includes('*')||narrowed.includes(name));
}
function requireAccess(principal,action,names){if(names.some(name=>!permitted(principal,action,name)))fail('ACCESS_DENIED','Недостаточно прав для выполнения этой команды.',403);}
function visibleAudit(rows,principal){
  return platform.visibleAudit(rows,principal).filter(row=>permitted(principal,'read',row.section)&&
    (row.type!=='transaction'||Array.isArray(row.changedSections)&&row.changedSections.every(name=>permitted(principal,'read',name))));
}
function filteredResult(result,principal){
  const out={...result};
  if(out.revisions)out.revisions=Object.fromEntries(Object.entries(out.revisions).filter(([name])=>permitted(principal,'read',name)));
  if(out.canonicalSections)out.canonicalSections=Object.fromEntries(Object.entries(out.canonicalSections).filter(([name])=>permitted(principal,'read',name)).map(([name,rows])=>[name,name==='auditLog'?visibleAudit(rows,principal):platform.visibleRows(name,rows,principal)]));
  return out;
}
function execute(dataDir,input,options={}){
  const commands=require('../assets/core/platform-commands.js');
  const envelope=contracts.parseCommandEnvelope(input,schema.sections),command=commands.parseCommand(envelope.command),principal=checkedPrincipal(options.principal);
  const catalogMerge=command.type==='MergeCatalog';
  if(catalogMerge&&principal.role!=='admin')fail('ACCESS_DENIED','Объединение справочников доступно администратору.',403);
  const periodAction=command.type==='PeriodAction';
  if(periodAction&&!require('./period-access.cjs').canManage(principal,command.input.scope))fail('ACCESS_DENIED','Недостаточно прав для управления выбранной областью периода.',403);
  if(command.type==='FuelAction'&&!permitted(principal,'write','fuelMovements'))fail('ACCESS_DENIED','Недостаточно прав для проведения операций с топливом.',403);
  if(command.type==='ProcurementAction'&&!access.procurementActions(principal)[command.input.action==='saveOrder'?command.input.payload.kind:command.input.kind]?.includes(command.input.action))fail('ACCESS_DENIED','Недостаточно прав для выбранного действия с закупкой.',403);
  const costPolicy=command.type==='CostAction'&&command.input.action==='savePolicy';
  if(command.type==='CostAction'&&!access.costActions(principal).includes(command.input.action))fail('ACCESS_DENIED','Недостаточно прав для выбранного действия со стоимостью.',403);
  if(command.type==='RepairAction'&&!access.repairActions(principal).includes(command.input.action))fail('ACCESS_DENIED','Недостаточно прав для выбранного действия с ремонтом.',403);
  const dependencies=commands.dependencies(command),footprint=commands.footprint(command);
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
        const changed=info.receipt.changedSections;
        if(!Array.isArray(changed)||changed.some(name=>!schema.sections.includes(name)))fail('COMMAND_RECEIPT','Повреждена квитанция команды',500);
        requireAccess(principal,'read',changed);
        return filteredResult(platform.replayResult(snapshot.data,snapshot.revisions,token,info,changed),principal);
      }
      storage.assertWritable(dataDir);
      requireAccess(principal,'write',periodAction?footprint.filter(name=>name!=='fuelPeriods'):costPolicy?footprint.filter(name=>name!==command.input.target.section):footprint);
      const missing=dependencies.filter(name=>!own(envelope.base,name));
      if(missing.length)fail('COMMAND_BASE_REQUIRED','Для команды нужны версии всех её зависимостей: '+missing.join(', '),428);
      const conflicts=dependencies.filter(name=>envelope.base[name]!==snapshot.revisions[name]);
      if(conflicts.length)return filteredResult({ok:false,command:true,code:'COMMAND_CONFLICT',conflicts,revisions:snapshot.revisions,databaseToken:token,error:'Источники команды изменились. Загрузите данные и повторите проверку.'},principal);
      const now=options.now||new Date().toISOString();
      if(typeof now!=='string'||!Number.isFinite(Date.parse(now)))fail('INVALID_CLOCK','Некорректное время команды');
      const actor={id:principal.id,name:principal.name,role:principal.role};
      const planned=commands.plan(snapshot.data,command,{id:envelope.operation.id,now,today:now.slice(0,10),actor});
      if(!planned||!planned.sections||Object.keys(planned.sections).some(name=>!footprint.includes(name)))fail('COMMAND_DEFINITION','Команда попыталась изменить посторонний раздел',500);
      contracts.validateSections(planned.sections,schema.sections);
      // The shared kernel validates precision with the same trusted intent,
      // after receipt lookup and before backup/commit. Do not prevalidate a
      // correction without its independently reproducible document proof.
      const result=storage.writeSections(dataDir,{databaseToken:token,base:envelope.base,sections:planned.sections,operation:envelope.operation},
        {principal,now,commandIntent:envelope,beforeCommit:options.beforeCommit});
      return filteredResult({...result,command:true},principal);
    };
    // Do not split snapshot, dependency checks and business/audit writes across
    // SQLite snapshots. Nested storage calls reuse this write connection.
    return sqlite.exists(dataDir)?sqlite.transaction(dataDir,action,{readOnly:sqlite.schemaVersion(dataDir)<2}):action();
  });
}
module.exports=Object.freeze({execute});
