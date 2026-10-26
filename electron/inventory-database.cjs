'use strict';

// Inventory owns its SQLite store. Opening this section never upgrades, writes
// an identity into, or rebinds the fleet database selected in the application.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const storage=require('./storage'),sqlite=require('./sqlite-storage.cjs'),access=require('./access-control'),policy=require('./access-context.cjs');
const compatibility=require('../assets/core/platform-compatibility.js'),commands=require('../assets/core/platform-commands.js');
const SECTIONS=Object.freeze(['inventoryOrgs','inventoryObjects','inventoryMols','inventoryItems','inventorySessions']);
const READ_SECTIONS=Object.freeze([...SECTIONS,'appMeta']);
const STORE='inventory-data',MAX_SEED_BYTES=128*1024*1024;
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
function fail(code,message,status=400){throw Object.assign(Error(message),{code,status});}
function row(value){if(!value||typeof value!=='object'||Array.isArray(value))fail('INVENTORY_REQUEST','Некорректный запрос базы инвентаризации');return value;}
function principal(value){if(!value||typeof value.id!=='string'||!value.id)fail('ACCESS_DENIED','Не подтверждена учётная запись',403);return policy.normalizePrincipal(value);}
function readable(user,name){return access.authorize(user,'read',name)&&(!Array.isArray(user.readable)||user.readable.includes('*')||user.readable.includes(name));}
function writable(user,name){return access.authorize(user,'write',name)&&(!Array.isArray(user.writable)||user.writable.includes('*')||user.writable.includes(name));}
function checkedUser(value){const user=principal(value);if(!SECTIONS.some(name=>readable(user,name)))fail('ACCESS_DENIED','Нет доступа к базе инвентаризации',403);return user;}
function parentDirectory(value){
 if(typeof value!=='string'||!path.isAbsolute(value))fail('INVENTORY_DIRECTORY','Нужна папка текущей базы');
 const full=path.resolve(value),info=fs.lstatSync(full);if(!info.isDirectory()||info.isSymbolicLink())fail('INVENTORY_DIRECTORY','Папка базы не должна быть ссылкой');
 return fs.realpathSync.native(full);
}
function assertDirectory(full){const info=fs.lstatSync(full);if(!info.isDirectory()||info.isSymbolicLink()||path.resolve(fs.realpathSync.native(full))!==path.resolve(full))fail('INVENTORY_DIRECTORY','Папка инвентаризации не должна быть ссылкой');return info;}
function directory(parentDir){const parent=parentDirectory(parentDir),full=path.join(parent,STORE);if(fs.existsSync(full))assertDirectory(full);else{try{fs.lstatSync(full);fail('INVENTORY_DIRECTORY','Недопустимая папка инвентаризации');}catch(error){if(error.code!=='ENOENT')throw error;}}return full;}
function regular(full,max=MAX_SEED_BYTES){
 const info=fs.lstatSync(full);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>max)fail('INVENTORY_SOURCE_PATH','Недопустимый исходный файл инвентаризации');
 const bytes=fs.readFileSync(full),after=fs.lstatSync(full);if(info.dev!==after.dev||info.ino!==after.ino||info.size!==after.size||info.mtimeMs!==after.mtimeMs||bytes.length!==info.size)fail('INVENTORY_SOURCE_CHANGED','Исходная база изменилась при чтении',409);return bytes;
}
function json(full){try{return JSON.parse(regular(full).toString('utf8'));}catch(error){if(error.code)throw error;fail('INVENTORY_SOURCE_DATA','Не прочитаны исходные данные инвентаризации');}}
// This is the storage token formula with read-only identity access. In
// particular, unversioned JSON must retain its legacy-readonly identity.
function parentToken(parentDir){
 const parent=parentDirectory(parentDir),file=path.join(parent,'platform.sqlite');
 const identity=fs.existsSync(file)?sqlite.readIdentity(parent):require('./database-identity.cjs').readOrCreate(parent,{create:false});
 const canonical=process.platform==='win32'?parent.toLowerCase():parent;
 return crypto.createHash('sha256').update(JSON.stringify(['tvs-database',canonical,identity?.uuid??'legacy-readonly',identity?.generation??0])).digest('hex');
}
function seed(parent){
 let data;
 if(fs.existsSync(path.join(parent,'platform.sqlite')))data=sqlite.transaction(parent,()=>Object.fromEntries(SECTIONS.map(name=>[name,sqlite.readRows(parent,name)])),{readOnly:true});
 else{
  const folder=path.join(parent,'sections'),files=[];data={};
  if(fs.existsSync(folder)){
   assertDirectory(folder);
   for(const name of SECTIONS){const file=path.join(folder,name+'.json');if(fs.existsSync(file)){const bytes=regular(file);files.push([file,bytes]);try{data[name]=JSON.parse(bytes.toString('utf8'));}catch{fail('INVENTORY_SOURCE_DATA','Не прочитан раздел '+name);}}else data[name]=[];}
  }else if(fs.existsSync(path.join(parent,'data.json'))){const file=path.join(parent,'data.json'),bytes=regular(file);files.push([file,bytes]);let old;try{old=JSON.parse(bytes.toString('utf8'));}catch{fail('INVENTORY_SOURCE_DATA','Не прочитана прежняя база');}row(old);data=Object.fromEntries(SECTIONS.map(name=>[name,own(old,name)?old[name]:[]]));}
  else data=Object.fromEntries(SECTIONS.map(name=>[name,[]]));
  for(const [file,bytes]of files)if(!regular(file).equals(bytes))fail('INVENTORY_SOURCE_CHANGED','Исходная база изменилась при чтении',409);
 }
 for(const name of SECTIONS)storage.validateRows(name,data[name]);
 // Preserve only originals actually referenced by the inventory being copied.
 // Existing signatures and provenance survive the move into an independent DB.
 const artifacts=new Map();require('./import-source.cjs').validateManaged(data,name=>{
  if(!/^import-sources\/(?:import-authority\.key|[a-f0-9]{64}\.[a-z0-9]{1,6})$/.test(name))fail('INVENTORY_SOURCE_PATH','Недопустимый путь исходника');
  assertDirectory(path.join(parent,'import-sources'));const bytes=regular(path.join(parent,...name.split('/')),40*1024*1024);artifacts.set(name,bytes);return bytes;
 });return {data,artifacts};
}
function ensure(parentDir){
 const parent=parentDirectory(parentDir),target=directory(parent);
 if(fs.existsSync(target)){if(!sqlite.exists(target))fail('INVENTORY_DATABASE_FORMAT','Папка инвентаризации не содержит проверенную базу SQLite',428);return target;}
 const input=seed(parent),stage=fs.mkdtempSync(path.join(parent,'.inventory-data-')),pin=fs.lstatSync(stage);let published=false;
 try{
  sqlite.create(stage,{data:input.data});
  for(const [name,bytes]of input.artifacts){const full=path.join(stage,...name.split('/'));if(!fs.existsSync(path.dirname(full)))fs.mkdirSync(path.dirname(full));fs.writeFileSync(full,bytes,{flag:'wx',mode:0o600});}
  require('./import-source.cjs').validateState(stage,sqlite.readAll(stage));
  try{fs.renameSync(stage,target);published=true;}
  catch(error){if(!fs.existsSync(target))throw error;assertDirectory(target);if(!sqlite.exists(target))throw error;}
  assertDirectory(target);return target;
 }finally{
  if(!published&&fs.existsSync(stage)){const current=fs.lstatSync(stage);if(path.dirname(stage)!==parent||!path.basename(stage).startsWith('.inventory-data-')||current.isSymbolicLink()||current.dev!==pin.dev||current.ino!==pin.ino)fail('INVENTORY_CLEANUP','Не подтверждён временный каталог');fs.rmSync(stage,{recursive:true,force:true});}
 }
}
function ownResult(value){
 const result={...value};for(const field of ['data','revisions','canonicalSections','scopeViews'])if(result[field]&&typeof result[field]==='object')result[field]=Object.fromEntries(Object.entries(result[field]).filter(([name])=>(field==='canonicalSections'?SECTIONS:READ_SECTIONS).includes(name)));
 if(Array.isArray(result.changed))result.changed=result.changed.filter(name=>SECTIONS.includes(name));return result;
}
function writeOptions(dir,user,options={}){
 return {principal:user,...require('./server').localWriteOptions({hello:compatibility.describe().hello,databaseToken:storage.databaseToken(dir),principal:user}),...(options.getPrincipal?{getPrincipal:options.getPrincipal}:{}),...(options.now?{now:options.now}:{})};
}
function fence(dir,payload){if(typeof payload.databaseToken!=='string'||!payload.databaseToken||payload.databaseToken!==storage.databaseToken(dir))fail('DATABASE_CHANGED','База инвентаризации изменилась. Откройте раздел заново.',409);}
function snapshot(parentDir,value){
 const user=checkedUser(value),dir=ensure(parentDir),result=storage.readSnapshot(dir,{principal:user}),negotiation=compatibility.negotiate(compatibility.describe().hello,compatibility.describe().serverProfile,result.platform.descriptor);
 if(!negotiation.writeCompatible||!negotiation.selectedProfile?.capabilities.some(cap=>cap.name==='inventoryV1'&&cap.version===1))fail('INVENTORY_DATABASE_FORMAT','База инвентаризации не поддерживает текущую версию',428);
 return ownResult({ok:true,...result,platform:{...result.platform,negotiation},access:{policyStamp:user.policyStamp,...(user.accessPolicy?{accessPolicy:user.accessPolicy}:{}),user:{id:user.id,name:user.name,role:user.role},readable:READ_SECTIONS.filter(name=>readable(user,name)),writable:SECTIONS.filter(name=>writable(user,name)),fieldPermissions:access.fieldPermissions(user),importActions:access.importActions(user).filter(name=>name==='asset-inventory')}});
}
function execute(parentDir,payload,value,options={}){
 const user=checkedUser(value);row(payload);if(payload.command?.type!=='AssetInventoryAction')fail('INVENTORY_COMMAND','Эта база принимает только операции инвентаризации');
 const command=commands.parseCommand(payload.command);if(commands.dependencies(command).some(name=>!READ_SECTIONS.includes(name))||commands.footprint(command).some(name=>!SECTIONS.includes(name))||Object.keys(row(payload.base)).some(name=>!READ_SECTIONS.includes(name)))fail('INVENTORY_COMMAND','Команда затрагивает посторонние разделы');
 const dir=ensure(parentDir);fence(dir,payload);if(!['admin','accountant'].includes(user.role)||commands.footprint(command).some(name=>!writable(user,name)))fail('ACCESS_DENIED','Нет права изменения инвентаризации',403);
 storage.makeDailyBackup(dir,path.join(dir,'backups'),30);return ownResult(storage.executeCommand(dir,payload,writeOptions(dir,user,options)));
}
async function importSource(parentDir,payload,value,options={}){
 const user=checkedUser(value);row(payload);if(payload.profile!=='asset-inventory'||!['stage','preview','read'].includes(payload.action))fail('INVENTORY_IMPORT','Выберите источник инвентаризации');
 const dir=ensure(parentDir);fence(dir,payload);const result=await require('./import-source.cjs').handle(dir,payload,writeOptions(dir,user,options));
 if(result.base)result.base={...result.base,appMeta:storage.readRevisions(dir).appMeta};return result;
}
function report(parentDir,payload,value){const user=checkedUser(value);row(payload);const dir=ensure(parentDir);fence(dir,payload);return require('./asset-inventory-export.js').prepare(dir,payload,user);}
async function handle(parentDir,payload,value,options={}){
 row(payload);if(Object.keys(payload).some(name=>!['action','parentDatabaseToken','request'].includes(name))||!['snapshot','execute','importSource','report','documentsList','documentsUpload','documentRead'].includes(payload.action)||typeof payload.parentDatabaseToken!=='string'||!payload.parentDatabaseToken)fail('INVENTORY_REQUEST','Не подтверждена текущая база программы');
 const parent=parentDirectory(parentDir),user=checkedUser(value),stamp=JSON.stringify([user.id,user.role,user.policyStamp]);
 const current=()=>{
  if(parentToken(parent)!==payload.parentDatabaseToken)fail('DATABASE_CHANGED','Основная база изменилась. Откройте раздел заново.',409);
  const active=checkedUser(options.getPrincipal?options.getPrincipal():user);if(JSON.stringify([active.id,active.role,active.policyStamp])!==stamp)fail('ACCESS_DENIED','Права изменились во время операции',403);return active;
 };
 if(options.assertCurrent)await options.assertCurrent();current();
 const extra={getPrincipal:current,...(options.now?{now:options.now}:{})};
 let result;
 if(['documentsList','documentsUpload','documentRead'].includes(payload.action)){
  const documents=require('./inventory-documents.cjs'),dir=ensure(parent),method={documentsList:'list',documentsUpload:'upload',documentRead:'read'}[payload.action];
  result=await documents[method](dir,row(payload.request),current(),extra);
 }else result=payload.action==='snapshot'?snapshot(parent,current()):payload.action==='execute'?execute(parent,row(payload.request),current(),extra):payload.action==='importSource'?await importSource(parent,row(payload.request),current(),extra):report(parent,row(payload.request),current());
 try{if(options.assertCurrent)await options.assertCurrent();current();return result;}
 catch(error){if(payload.action==='documentsUpload'&&result?.ok){error.unknown=true;error.definitive=false;}throw error;}
}
module.exports=Object.freeze({SECTIONS,directory,snapshot,execute,importSource,report,handle});
