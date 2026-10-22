/* Shared business-section catalog. No application state, storage or DOM access. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PlatformSchema=api;})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const sections=['vehicles','records','generators','genRecords','toRecords','tanks','tankIncomes','vehicleTo','repairs','reestrRows','savedReestrs','payments','budget','contragents','fuelPurchases','fuelImports','fuelCards','fuelPeriods','fuelWriteoffs','monthlyFuel','appMeta','dispatchJobs','drivers','assetAssignments','workOrders','opsTasks','assetDocuments','fuelMovements','parts','partMovements','shiftReports','connectors','auditLog','savedViews','glonassTrips','glonassImports','costEntries','costProfiles','procurementOrders','procurementRules','documentDrafts'];
  const moduleDefinitions=[
    ['fleet','Транспорт',['vehicles','records']],
    ['power','ДЭС и ёмкости',['generators','genRecords','tanks','tankIncomes']],
    ['maintenance','ТО и ремонт',['vehicleTo','toRecords','repairs','workOrders']],
    ['finance','Финансы и реестры',['payments','budget','contragents','reestrRows','savedReestrs','costEntries','costProfiles']],
    ['fuel','ГСМ и списание',['fuelPurchases','fuelImports','fuelCards','fuelPeriods','fuelWriteoffs','monthlyFuel']],
    ['dispatch','Диспетчерская',['dispatchJobs','drivers','assetAssignments','shiftReports']],
    ['operations','Задачи и документы',['opsTasks','assetDocuments','documentDrafts']],
    ['inventory','Склад и закупки',['parts','partMovements','fuelMovements','procurementOrders','procurementRules']],
    ['integration','Обмен и ГЛОНАСС',['connectors','glonassTrips','glonassImports']],
    ['system','История и настройки',['appMeta','auditLog','savedViews']]
  ];
  const labels={documentDrafts:'Черновики документов',vehicles:'Транспорт',records:'Журнал пробега',generators:'ДЭС',genRecords:'Журнал ДЭС',toRecords:'ТО ДЭС',tanks:'Ёмкости',tankIncomes:'Приходы в ёмкости',vehicleTo:'ТО транспорта',repairs:'Ремонты',reestrRows:'Строки реестров',savedReestrs:'Сохранённые реестры',payments:'Платежи',budget:'Бюджет',contragents:'Контрагенты',fuelPurchases:'Покупки ГСМ',fuelImports:'Импорты выписок',fuelCards:'Топливные карты',fuelPeriods:'Топливные периоды',fuelWriteoffs:'Акты списания',monthlyFuel:'Месячные сверки ГСМ',appMeta:'Настройки базы',dispatchJobs:'Диспетчерские заявки',drivers:'Водители и операторы ДЭС',assetAssignments:'Назначения техники',workOrders:'Ремонтные заказы',opsTasks:'Операционные задачи',assetDocuments:'Документы техники и сотрудников',fuelMovements:'Движения топлива',parts:'Номенклатура склада',partMovements:'Движения запчастей',shiftReports:'Сменные формы',connectors:'Подключения обмена',auditLog:'История изменений',savedViews:'Сохранённые представления',glonassTrips:'Данные ГЛОНАСС',glonassImports:'Импорты ГЛОНАСС',costEntries:'Операции затрат',costProfiles:'Профили расчёта затрат',procurementOrders:'Заказы закупок',procurementRules:'Правила закупок'};
  const modules=moduleDefinitions.map(([id,label,names])=>({id,label,sections:names}));
  const descriptors={};
  sections.forEach(id=>{descriptors[id]={id,label:labels[id],module:modules.find(module=>module.sections.includes(id)).id,identity:{field:id==='fuelPeriods'?'month':'id',requiredForNew:!['reestrRows','savedReestrs'].includes(id)},dates:[],numbers:[],enums:[],ranges:[]};});
  descriptors.monthlyFuel.identity={field:'id',requiredForNew:false,composite:['vehicleId','month','cardNumber']};
  descriptors.fuelCards.identity={field:'id',requiredForNew:false,natural:{field:'number',normalize:'card'}};
  descriptors.fuelCards.unique=[{field:'number',normalize:'card'}];
  const date=(section,fields,kind='date')=>fields.split(' ').filter(Boolean).forEach(field=>descriptors[section].dates.push({field,kind}));
  const number=(section,fields,options={})=>fields.split(' ').filter(Boolean).forEach(field=>descriptors[section].numbers.push({field,...options}));
  sections.forEach(section=>date(section,'createdAt updatedAt archivedAt','datetime'));
  date('records','date');date('vehicles','orgHistory[].from orgHistory[].to');date('genRecords','date');date('vehicleTo','date nextDate');date('toRecords','date nextDate');date('vehicleTo','completedAt','dateOrDatetime');date('toRecords','completedAt','dateOrDatetime');date('repairs','invoiceDate');date('tankIncomes','date');
  date('payments','date dueDate paidDate');date('fuelPurchases','date');date('fuelImports','at','datetime');date('fuelCards','assignments[].from assignments[].to orgHistory[].from orgHistory[].to');date('fuelPeriods','month','month');date('fuelPeriods','closedAt reopenedAt','datetime');date('fuelWriteoffs','date');date('fuelWriteoffs','postedAt voidedAt','datetime');date('monthlyFuel','month','month');date('appMeta','at','datetime');
  date('dispatchJobs','start end actualStart actualEnd','datetime');date('assetAssignments','from to');date('workOrders','downtimeFrom downtimeTo','datetime');date('workOrders','warrantyUntil');date('opsTasks','due','date');date('assetDocuments','date expires');date('fuelMovements','date');date('partMovements','date');date('shiftReports','date');date('auditLog','at','datetime');date('glonassTrips','date');date('glonassImports','at','datetime');date('costEntries','date');date('procurementOrders','deliveryDate');
  date('drivers','driverLicenseExpires medicalExpires briefingExpires certificateExpires');
  number('vehicles','norm normCity normHighway normIdle odometer fuelBalance tankVolume toIntervalKm toIntervalMonths maintenanceRules[].km maintenanceRules[].months',{min:0});
  number('records','km kmGlonass fuelIssued fuelActual fuelUsed fuelIdle fuelSum odoStart odoEnd tankMeasured',{min:0});
  number('generators','power norm norm100 norm50 normIdle hoursInit fuelBalance maintenanceRules[].hours maintenanceRules[].months',{min:0});number('generators','cost');
  number('genRecords','hours meterStart meterEnd fuelIssued fuelUsed fuelActual load',{min:0});number('toRecords','hours nextHours nextHoursAbs',{min:0});number('toRecords','cost');
  number('tanks','capacity balanceInit reserveLevel',{min:0});number('tankIncomes','amount liters litres qty',{min:0,allowNegativeWhen:{field:'kind',values:['out']}});number('tankIncomes','sum vatAmount grossSum');number('tankIncomes','vatRate',{min:0,max:100});
  number('vehicleTo','odometer nextKm nextOdometerAbs',{min:0});number('vehicleTo','cost');number('repairs','mileage',{min:0});number('repairs','cost');number('payments','sum paidAmount');number('budget','sum');number('budget','year',{integer:true,min:1900,max:9999});number('budget','month',{integer:true,min:1,max:12});
  number('fuelPurchases','qty price sum',{min:0});number('monthlyFuel','liters sum',{min:0});number('dispatchJobs','plannedKm actualKm plannedHours actualHours cost partRequirements[].qty',{min:0});number('workOrders','cost actualCost',{min:0});number('fuelMovements','qty',{min:0});number('parts','minStock',{min:0});number('partMovements','qty meter',{min:0});number('shiftReports','odoStart odoEnd hours fuelIssued tankMeasured',{min:0});
  number('glonassTrips','km fuel fuelIdle engine idle odoStart odoEnd',{min:0});number('costEntries','amount',{min:0});number('costProfiles','salaryRate depreciationRate fuelRate fuelPrice',{min:0});number('procurementOrders','quantity receivedQty stockPostedQty',{min:0});number('procurementRules','leadDays reserveQty coverDays expectedDaily',{min:0});
  const states={dispatchJobs:['new','assigned','started','done','confirmed','cancelled'],workOrders:['new','approved','repairing','accepted','cancelled'],opsTasks:['open','started','snoozed','closed'],shiftReports:['prepared','sent','accepted','rejected'],procurementOrders:['draft','ordered','partial','received','cancelled'],fuelWriteoffs:['posted','void']};
  Object.entries(states).forEach(([section,values])=>descriptors[section].enums.push({field:'status',values}));
  descriptors.drivers.enums.push({field:'employmentStatus',values:['active','vacation','sick','unavailable']});
  // These terminal changes are already forbidden by the existing workflow forms.
  descriptors.dispatchJobs.terminalStates=['confirmed'];descriptors.workOrders.terminalStates=['accepted'];descriptors.shiftReports.terminalStates=['accepted'];descriptors.fuelWriteoffs.terminalStates=['void'];
  for(const [section,from,to,strict]of [['dispatchJobs','start','end',true],['dispatchJobs','actualStart','actualEnd',false],['assetAssignments','from','to',false],['workOrders','downtimeFrom','downtimeTo',false],['assetDocuments','date','expires',false],['records','odoStart','odoEnd',false],['genRecords','meterStart','meterEnd',false],['shiftReports','odoStart','odoEnd',false]])descriptors[section].ranges.push({from,to,strict});
  const relations=[];
  const direct=(from,field,target,extra={})=>relations.push({id:from+'.'+field,from,field,kind:'id',target,optional:true,archivePolicy:'existing',...extra});
  const asset=(from,field='assetRef',targets={v:'vehicles',g:'generators',t:'tanks'})=>relations.push({id:from+'.'+field,from,field,kind:'assetRef',targets,optional:true,archivePolicy:'existing'});
  for(const section of ['records','vehicleTo','repairs','payments','monthlyFuel','fuelPurchases','glonassTrips'])direct(section,'vehicleId','vehicles');
  for(const section of ['genRecords','toRecords'])direct(section,'generatorId','generators');
  for(const section of ['generators','genRecords','tankIncomes'])direct(section,'tankId','tanks');direct('tankIncomes','counterTankId','tanks');
  for(const section of ['dispatchJobs','assetAssignments','workOrders','opsTasks','assetDocuments','fuelMovements','partMovements','shiftReports','payments','vehicleTo','toRecords','repairs'])asset(section);
  asset('costEntries','assetRef',{v:'vehicles',g:'generators'});asset('costProfiles','assetRef',{v:'vehicles',g:'generators'});
  for(const section of ['dispatchJobs','assetAssignments','assetDocuments','shiftReports'])direct(section,'driverId','drivers');
  for(const section of ['payments','budget','repairs','vehicleTo','toRecords','workOrders'])direct(section,'contragentId','contragents');
  direct('partMovements','partId','parts');direct('partMovements','workOrderId','workOrders');direct('workOrders','repeatOf','workOrders');direct('workOrders','repairId','repairs');direct('workOrders','vehicleToId','vehicleTo');direct('workOrders','toRecordId','toRecords');direct('shiftReports','jobId','dispatchJobs');direct('dispatchJobs','partRequirements[].partId','parts');
  for(const field of ['fromTankId','toTankId'])direct('fuelMovements',field,'tanks');
  for(const field of ['originalMovementId','reversedBy'])direct('fuelMovements',field,'fuelMovements');
  for(const field of ['originalMovementId','reversedBy'])direct('partMovements',field,'partMovements');
  for(const section of ['records','genRecords']){direct(section,'fuelMovementId','fuelMovements');direct(section,'reversalId','fuelMovements');}
  relations.push({id:'fuelMovements.recordId',from:'fuelMovements',field:'recordId',kind:'discriminator',selector:'assetRef',prefix:true,targets:{v:'records',g:'genRecords'},optional:true,archivePolicy:'existing'});
  direct('fuelPurchases','recordId','records',{resolve:'fuel-purchase-journal'});direct('fuelPurchases','cardVehicleId','vehicles');direct('fuelPurchases','importId','fuelImports');direct('fuelCards','assignments[].vehicleId','vehicles');
  for(const [section,field]of [['vehicles','fuelcard'],['records','fuelCardNum'],['fuelPurchases','cardNo'],['monthlyFuel','cardNumber']])relations.push({id:section+'.'+field,from:section,field,kind:'lookup',target:'fuelCards',targetField:'number',normalize:'card',optional:true,strength:'advisory'});
  for(const section of ['payments','costEntries'])relations.push({id:section+'.sourceId',from:section,field:'sourceId',kind:'discriminator',selector:'source',targets:{repair:'repairs',to:'vehicleTo',vehicleTo:'vehicleTo',toRecord:'toRecords',workOrder:'workOrders',fuelPurchase:'fuelPurchases'},unknownPolicy:'advisory',optional:true,archivePolicy:'existing'});
  for(const section of ['procurementOrders','procurementRules'])relations.push({id:section+'.itemId',from:section,field:'itemId',kind:'discriminator',selector:'kind',targets:{tank:'tanks',part:'parts'},optional:true,archivePolicy:'existing'});
  direct('glonassTrips','importId','glonassImports');direct('glonassTrips','importIds[]','glonassImports');direct('glonassTrips','supersededBy','glonassImports');direct('records','glonassProvenance.importId','glonassImports');direct('records','glonassProvenance.rawIds[]','glonassTrips');
  const documentTargets=Object.fromEntries(['shiftReports','workOrders','dispatchJobs','fuelMovements','partMovements','fuelWriteoffs','payments','repairs','vehicleTo','toRecords'].map(name=>[name,name]));
  for(const section of Object.keys(documentTargets))relations.push({id:section+'.lifecycle.correctionOf.id',from:section,field:'lifecycle.correctionOf.id',kind:'discriminator',selector:'lifecycle.correctionOf.section',targets:documentTargets,optional:true,archivePolicy:'existing'});
  for(const prefix of ['correctionOf','result'])relations.push({id:'documentDrafts.'+prefix+'.id',from:'documentDrafts',field:prefix+'.id',kind:'discriminator',selector:prefix+'.section',targets:documentTargets,optional:true,archivePolicy:'existing'});
  asset('documentDrafts','payload.assetRef');
  for(const [field,target]of [['vehicleId','vehicles'],['generatorId','generators'],['driverId','drivers'],['partId','parts'],['fromTankId','tanks'],['toTankId','tanks'],['workOrderId','workOrders'],['jobId','dispatchJobs'],['contragentId','contragents'],['repeatOf','workOrders'],['repairId','repairs'],['vehicleToId','vehicleTo'],['toRecordId','toRecords']])direct('documentDrafts','payload.'+field,target);
  relations.push({id:'documentDrafts.payload.sourceId',from:'documentDrafts',field:'payload.sourceId',kind:'discriminator',selector:'payload.source',targets:{repair:'repairs',to:'vehicleTo',vehicleTo:'vehicleTo',toRecord:'toRecords',workOrder:'workOrders',fuelPurchase:'fuelPurchases'},unknownPolicy:'advisory',optional:true,archivePolicy:'existing'});
  direct('documentDrafts','payload.partRequirements[].partId','parts');
  // Audit and posted-document source snapshots intentionally refer to historical
  // rows, including deleted ones. They are evidence, not live foreign keys.
  relations.push({id:'auditLog.recordId',from:'auditLog',field:'recordId',kind:'historical',selector:'section',optional:true,strength:'historical'});
  function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
  function describe(){return JSON.parse(JSON.stringify({apiVersion:1,sections,modules,descriptors,relations}));}
  return freeze({apiVersion:1,sections,modules,descriptors,relations,describe});
});
