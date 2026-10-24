/* Business workflow validation over lower domain planners. No public integrity facade. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(() => require('./personnel-engine.js'),() => require('./fuel-movement-policy.js'),() => require('./document-lifecycle.js'),() => require('./workflow-policy.js'),()=>require('./temporal-policy.js'),()=>require('./catalog-policy.js'),()=>require('./period-policy.js'),()=>require('./inventory-stock.js'),()=>require('./procurement-operations.js'),()=>require('./cost-operations.js'),()=>require('./repair-process.js'),()=>require('./repair-operations.js'),()=>require('./calendar-operations.js'),()=>require('./import-planner.js'),require('./workflow-inspection.js'),require('./record-identity.js'),()=>require('./generator-spares.js'),()=>require('./generator-maintenance.js'));
  else root.WorkflowValidation = factory(() => root.TvsPersonnelEngine,() => root.FuelMovementPolicy,() => root.DocumentLifecycle,() => root.WorkflowPolicy,()=>root.TemporalPolicy,()=>root.CatalogPolicy,()=>root.PeriodPolicy,()=>root.InventoryStock,()=>root.ProcurementOperations,()=>root.CostOperations,()=>root.RepairProcess,()=>root.RepairOperations,()=>root.CalendarOperations,()=>root.ImportPlanner,root.WorkflowInspection,root.RecordIdentity,()=>root.GeneratorSpares,()=>root.GeneratorMaintenance);
})(typeof globalThis === 'object' ? globalThis : this, function (getPersonnel,getFuelMovements,getDocuments,getWorkflow,getTemporal,getCatalog,getPeriods,getInventory,getProcurement,getCosts,getRepairs,getRepairOperations,getCalendarOperations,getImports,inspection,recordIdentity,getGeneratorSpares,getGeneratorMaintenance) {
  'use strict';
  const rows = (db, section) => Array.isArray(db?.[section]) ? db[section] : [];
  const present = value => value != null && String(value).trim() !== '';

  function catalogModule(previous,next){let api;try{api=getCatalog();}catch{}if(api?.apiVersion===1)return api;
    if([previous,next].some(db=>['vehicles','generators','tanks','drivers','parts','contragents','fuelCards'].some(section=>rows(db,section).some(row=>Object.hasOwn(row,'mergedInto'))))){const error=new Error('Не загружены правила объединения справочников');error.code='MODULE_UNAVAILABLE';throw error;}return null;
  }
  function repairModuleRequired(previous,next){
    const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),fields=['status','assetRef','repairId','vehicleToId','toRecordId','downtime','downtimeFrom','downtimeTo','completedAt','repairProcess','defectSource','defectSnapshot'];
    for(const value of rows(next,'workOrders')){const matches=rows(previous,'workOrders').filter(old=>old.id===value.id),old=matches.length===1?matches[0]:null;if(['repairProcess','downtime','defectSource','defectSnapshot'].some(key=>Object.hasOwn(value,key)))return true;if(!old){if(value.status!=='new'||['repairId','vehicleToId','toRecordId'].some(key=>present(value[key])))return true;continue;}if(fields.some(key=>!same(old[key],value[key])))return true;if(['approved','repairing'].includes(old.status)&&['description','work','cost','repeatOf','warrantyUntil'].some(key=>!same(old[key],value[key])))return true;}
    for(const value of rows(previous,'workOrders'))if((Object.hasOwn(value,'repairProcess')||['approved','repairing','accepted','cancelled'].includes(value.status))&&!rows(next,'workOrders').some(row=>row.id===value.id))return true;
    for(const [field,name]of [['repairId','repairs'],['vehicleToId','vehicleTo'],['toRecordId','toRecords']])if([...rows(previous,'workOrders'),...rows(next,'workOrders')].some(value=>present(value[field]))&&!same(rows(previous,name),rows(next,name)))return true;
    for(const value of rows(next,'partMovements')){const matches=rows(previous,'partMovements').filter(old=>old.id===value.id),old=matches.length===1?matches[0]:null;if((present(value.workOrderId)||present(old?.workOrderId)||Object.hasOwn(value,'repairReturn')||old&&Object.hasOwn(old,'repairReturn'))&&!same(old,value))return true;}
    return false;
  }

  function inventoryModule(){const api=getInventory();if(!api||api.apiVersion!==1)throw Object.assign(Error('Не загружено ядро складского запаса'),{code:'MODULE_UNAVAILABLE'});return api;}
  function inspectStock(db,context){return inventoryModule().inspect(db,context);}
  function validateStockChanges(previous,next,context){return inventoryModule().validateChanges(previous,next,context);}
  function validateFuelChanges(previous,next,context){return getFuelMovements().validateChanges(previous,next,context);}
  function scopePeriods(db,scope){return periodsModule().scopePeriods(db,scope);}
  function inspectFuel(db,context) {return getFuelMovements().inspect(db,context);}
  function periodRowIdentity(section,row,index) {return recordIdentity.rowIdentity(section,row,index);}
  function periodsModule() {const api=getPeriods();if(!api||api.apiVersion!==1){const error=new Error('Не загружены правила закрытия периодов');error.code='MODULE_UNAVAILABLE';throw error;}return api;}
  function validatePeriodChanges(previous,next,context) {return periodsModule().validateChanges(previous,next,context);}
  const inspect=inspection.inspect;
  function validateChanges(previous,next,context) {
    const archiveRows=db=>rows(db,'appMeta').filter(row=>row.id==='document-archive-head'||row.kind==='documentArchive').map(row=>Object.keys(row).sort().map(key=>[key,row[key]]));
    if(JSON.stringify(archiveRows(previous))!==JSON.stringify(archiveRows(next))){const error=new Error('Архив печати изменяется только проверенным сохранением снимка');error.code='DOCUMENT_ARCHIVE_IMMUTABLE';error.status=403;throw error;}
    const calendar=getCalendarOperations?.();if(calendar?.apiVersion===1)calendar.validateChanges(previous,next,context);else if(['appMeta'].some(name=>JSON.stringify(rows(previous,name).filter(row=>row.id==='business-calendar'||row.kind==='businessCalendar'))!==JSON.stringify(rows(next,name).filter(row=>row.id==='business-calendar'||row.kind==='businessCalendar')))||['dispatchJobs','workOrders'].some(name=>rows(next,name).some(row=>{const matches=rows(previous,name).filter(old=>old.id===row.id),old=matches.length===1?matches[0]:{};return (name==='dispatchJobs'?['start','end','actualStart','actualEnd','timeContext']:['downtimeFrom','downtimeTo','completedAt','timeContext']).some(field=>JSON.stringify(old[field])!==JSON.stringify(row[field]));})))throw Object.assign(Error('Не загружены правила рабочего календаря'),{code:'MODULE_UNAVAILABLE'});
    const old = inspect(previous,context).issues, current = inspect(next,context).issues;
    const key = issue => JSON.stringify([issue.section,issue.recordId,issue.code,issue.field,issue.relatedRecordId || '']);
    const prior = new Map(old.map(issue => [key(issue),issue]));
    const blocking = current.filter(issue => {
      // Personnel uses field/assignment delta semantics below. Its read-only
      // report may show legacy rows and active links that need manual review.
      if (/^(PERSONNEL_|FUEL_|DOCUMENT_|WORKFLOW_|TEMPORAL_|CATALOG_|PERIOD_|PART_|PROCUREMENT_|COST_|REPAIR_)/.test(issue.code)) return false;
      const before = prior.get(key(issue));
      if (!before) return true;
      if (issue.code === 'PART_STOCK_DEFICIT') return issue.deficit > before.deficit + 1e-9;
      return JSON.stringify(before.proof) !== JSON.stringify(issue.proof);
    });
    if (blocking.length) {
      const error = new Error(blocking.map(issue => issue.message).slice(0,5).join('; '));
      error.name = 'PlatformPolicyError'; error.code = 'POLICY_VIOLATION'; error.issues = blocking; error.details = { issues:blocking }; throw error;
    }
    const personnel = getPersonnel();
    if (!personnel || personnel.apiVersion !== 1) {
      const error = new Error('Не загружено ядро сотрудников');error.code='MODULE_UNAVAILABLE';throw error;
    }
    personnel.validateChanges(previous,next,context);
    const spares=getGeneratorSpares?.(),maintenance=getGeneratorMaintenance?.();
    if(spares?.apiVersion===1)spares.validateChanges(previous,next,context);
    else if([previous,next].some(db=>rows(db,'parts').some(row=>Object.hasOwn(row,'generatorId'))))throw Object.assign(Error('Не загружена защита запаса ДЭС'),{code:'MODULE_UNAVAILABLE'});
    if(maintenance?.apiVersion===1)maintenance.validateChanges(previous,next,context);
    else if(rows(previous,'generatorMaintenancePlans').length||rows(next,'generatorMaintenancePlans').length)throw Object.assign(Error('Не загружена защита графиков ТО ДЭС'),{code:'MODULE_UNAVAILABLE'});
    validateStockChanges(previous,next,context);
    for (const module of [getDocuments(),getFuelMovements(),getWorkflow(),getTemporal(),periodsModule()]) {
      if (!module || module.apiVersion !== 1) {
        const error = new Error('Не загружены правила проведения документов и движения топлива');error.code='MODULE_UNAVAILABLE';throw error;
      }
      module.validateChanges(previous,next,context);
    }
    const catalog=catalogModule(previous,next);if(catalog)catalog.validateChanges(previous,next,context);
    const procurement=getProcurement();if(!procurement||procurement.apiVersion!==1)throw Object.assign(Error('Не загружены правила исполнения закупок'),{code:'MODULE_UNAVAILABLE'});procurement.validateChanges(previous,next,context);
    let costs;try{costs=getCosts();}catch{}
    if(costs?.apiVersion===1)costs.validateChanges(previous,next,context);
    else if([previous,next].some(db=>['tanks','parts','vehicles','generators'].some(name=>rows(db,name).some(row=>Object.hasOwn(row,'costValuation')))||rows(db,'costEntries').some(row=>Object.hasOwn(row,'costAllocation')||row.kind==='allocation')))throw Object.assign(Error('Не загружены правила стоимости'),{code:'MODULE_UNAVAILABLE'});
    let repairs,repairOperations;try{repairs=getRepairs();repairOperations=getRepairOperations();}catch{}
    if(repairs?.apiVersion===1&&repairOperations?.apiVersion===1){repairOperations.validateChanges(previous,next,context);repairs.validateChanges(previous,next,context);}
    else if(repairModuleRequired(previous,next))throw Object.assign(Error('Не загружены правила ремонтного процесса'),{code:'MODULE_UNAVAILABLE'});
    let imports;try{imports=getImports();}catch{}
    if(imports?.apiVersion===1&&typeof imports.validateChanges==='function')imports.validateChanges(previous,next,context);
    else if(context?.commandIntent?.command?.type==='ImportAction'||Object.keys(next||{}).some(name=>JSON.stringify(rows(previous,name))!==JSON.stringify(rows(next,name))&&(['fuelImports','glonassImports'].includes(name)||[...rows(previous,name),...rows(next,name)].some(row=>['importProvenance','importBatch','glonassProvenance',...(name==='fuelPurchases'?['importKey','importKeyV2','importKeyV3','sourceTransaction','sourceVersions','sourceArchive','sourceArchives','lastImportArchive','importId']:[])].some(field=>Object.hasOwn(row,field))||name==='fuelPeriods'&&Object.values(row.recon||{}).some(entry=>entry&&(entry.importSource||entry.importHistory))))))throw Object.assign(Error('Не загружены правила проверенного импорта'),{code:'MODULE_UNAVAILABLE'});
    return true;
  }

  return Object.freeze({ apiVersion:1,inspect,inspectStock,inspectFuel,periodRowIdentity,scopePeriods,validatePeriodChanges,validateStockChanges,validateFuelChanges,validateChanges });
});
