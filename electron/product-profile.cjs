'use strict';
const path=require('node:path'),fs=require('node:fs');
const OBJECT_SECTIONS=Object.freeze(['home','desObjects','generators','tanks','fuelPurchases','fuelReport','toSchedule','generatorSpares','repairs','workflows','operators','operatorTimesheets','reports','printForms','system']);
const OBJECT_CHANNELS=new Set(['get-product-profile','des-object','read-data','write-data','read-snapshot','get-revisions','read-section','query-rows','query-history','document-print','write-sections','execute-command','operation-phase','get-operation-diagnostics','export-operation-support','get-pending-operations','reconcile-operation','retry-operation','discard-operation','finish-close','get-data-path','get-data-identity','get-data-cache-context','get-data-health','get-settings','get-access-catalog','get-theme','set-theme','get-notification-settings','save-notification-settings','snooze-notifications','submit-notifications','test-notification','get-app-version','get-changelog','open-data-folder','export-pdf','export-json','add-attachment','open-attachment','archive-import-source','import-source','create-backup-package','verify-backup-package','choose-certificate']);
function fail(code,message){throw Object.assign(Error(message),{code,status:403});}
function field(value,key){if(value===null||value===undefined)return undefined;if(typeof value!=='object'||Array.isArray(value))fail('PRODUCT_PROFILE_INVALID','Некорректные метаданные программы');const property=Object.getOwnPropertyDescriptor(value,key);if(property&&(property.get||property.set))fail('PRODUCT_PROFILE_INVALID','Исполняемые метаданные программы запрещены');return property?.value;}
function describeProduct(metadata){
 const kind=field(metadata,'tvsProductProfile')??'dispatcher';
 if(!['dispatcher','des-object'].includes(kind))fail('PRODUCT_PROFILE_INVALID','Неизвестный профиль приложения');
 const name=field(metadata,'name'),appId=field(field(metadata,'build'),'appId');
 if(kind==='des-object'&&(name!=='dispatcher-des-object'||appId!==undefined&&appId!=='com.tvs.dispatcher-des-object'))fail('PRODUCT_PROFILE_INVALID','Некорректная идентичность программы ДЭС объекта');
 if(kind==='dispatcher'&&(name==='dispatcher-des-object'||appId==='com.tvs.dispatcher-des-object'))fail('PRODUCT_PROFILE_INVALID','Идентичность ДЭС объекта не соответствует профилю приложения');
 return Object.freeze(kind==='des-object'?{kind,appId:'com.tvs.dispatcher-des-object',userDataName:'dispatcher-des-object',title:'ДЭС объекта',sections:OBJECT_SECTIONS,standardUpdates:false}:{kind,appId:'com.tvs.dispetcherizaciya-avto',userDataName:'dispetcherizaciya-avto',title:'Диспетчеризация авто группы компаний ООО "Технрайз Велл Сервис"',sections:null,standardUpdates:true});
}
function within(root,selected){const relative=path.relative(path.resolve(root),path.resolve(selected));return relative===''||!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep);}
const pathBindings=new WeakMap();
function localAbsolute(value){if(typeof value!=='string'||!value||value.includes('\0')||!path.isAbsolute(value)||/^[\\/]{2}/.test(value))fail('PRODUCT_PATH_INVALID','Для программы объекта нужен абсолютный локальный каталог');return path.resolve(value);}
// Resolve existing ancestors as well as a not-yet-created suffix. Re-check on
// every use, since a directory could have been replaced after initial setup.
function physicalDirectory(value,rejectLinks){
 const absolute=localAbsolute(value),parsed=path.parse(absolute),segments=absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);let current=parsed.root;
 for(let index=0;index<segments.length;index++){
  const candidate=path.join(current,segments[index]);let info;
  try{info=fs.lstatSync(candidate);}catch(error){if(error.code!=='ENOENT')throw error;return path.join(current,...segments.slice(index));}
  if(rejectLinks&&info.isSymbolicLink())fail('PRODUCT_PATH_LINK','Каталог программы объекта не должен проходить через символические ссылки или junction');
  if(!info.isDirectory()&&!info.isSymbolicLink())fail('PRODUCT_PATH_INVALID','Путь программы объекта проходит через файл');
  try{current=fs.realpathSync.native(candidate);}catch{fail('PRODUCT_PATH_INVALID','Не удалось проверить физический каталог программы объекта');}
  if(!fs.statSync(current).isDirectory())fail('PRODUCT_PATH_INVALID','Каталог программы объекта не является папкой');
 }
 return current;
}
function isolated(userData,central){
 const actual=physicalDirectory(userData,true),centralActual=physicalDirectory(central,false);
 if(within(central,userData)||within(userData,central)||within(centralActual,actual)||within(actual,centralActual))fail('PRODUCT_PATH_CENTRAL','Программа объекта не может использовать профиль Диспетчера или его родительский каталог');
 return actual;
}
function profilePaths(profile,{appData,override}){
 const central=path.join(appData,'dispetcherizaciya-avto'),userData=override?path.resolve(override):path.join(appData,profile.userDataName),dataRoot=profile.kind==='des-object'?path.join(userData,'databases'):null;
 if(profile.kind==='des-object'){localAbsolute(appData);if(override)localAbsolute(override);isolated(userData,central);physicalDirectory(dataRoot,true);}
 const result=Object.freeze({userData,dataRoot});pathBindings.set(result,{kind:profile.kind,central});return result;
}
function permitsChannel(profile,channel){return profile.kind!=='des-object'||OBJECT_CHANNELS.has(channel);}
function assertOwnedData(profile,paths,dataDir){
 if(profile.kind!=='des-object')return path.resolve(dataDir);
 const binding=pathBindings.get(paths);if(!binding||binding.kind!=='des-object')fail('PRODUCT_PATH_INVALID','Не подтверждены каталоги профиля программы объекта');
 const selected=localAbsolute(dataDir),userData=isolated(paths.userData,binding.central),root=physicalDirectory(paths.dataRoot,true),actual=physicalDirectory(selected,true);
 if(!within(paths.userData,paths.dataRoot)||!within(userData,root)||!within(paths.dataRoot,selected)||!within(root,actual))fail('PRODUCT_PATH_OWNERSHIP','База объекта должна находиться в отдельном каталоге программы объекта');
 return selected;
}
function assertCommandAllowed(profile,envelope){
 if(profile.kind!=='des-object')return envelope;
 const supplied=field(envelope,'command');
 const command=require('../assets/core/platform-contracts.js').validateCommand(supplied),input=command.input,action=input.action;
 const centralOnly=command.type==='PeriodAction'||command.type==='MergeCatalog'||command.type==='AcceptShift'
  ||command.type==='GeneratorMaintenanceAction'&&['approve','revise'].includes(action)
  ||command.type==='AssetInventoryAction'&&['approve','revise'].includes(action)
  ||command.type==='RepairAction'&&action==='approve'
  ||command.type==='CalendarAction'&&action==='configure'
  ||command.type==='CostAction'&&action==='savePolicy'
  ||command.type==='DocumentAction'&&['workOrders','dispatchJobs','shiftReports'].includes(input.section)&&['post','postDraft','void'].includes(action);
 if(centralOnly)fail('PRODUCT_CENTRAL_ACTION','Это действие выполняется в центральном Диспетчере. В программе объекта сохраните черновик и передайте изменения в центр');
 return envelope;
}
module.exports=Object.freeze({describeProduct,profilePaths,permitsChannel,assertOwnedData,assertCommandAllowed,OBJECT_SECTIONS});
