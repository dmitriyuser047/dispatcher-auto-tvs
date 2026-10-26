import path=require('node:path');
import crypto=require('node:crypto');
import {Worker} from 'node:worker_threads';
import {pathToFileURL} from 'node:url';
import type {Json,Row,Mapping,DecodeRequest,DecodeResult} from './asset-inventory-decode-worker';

interface Principal {id:string;name:string;role:string;policyStamp?:string;[key:string]:unknown}
interface Options {principal?:unknown;getPrincipal?:()=>unknown;now?:string;[key:string]:unknown}
interface Descriptor {id:string;sha256:string;size:number;name:string}
export interface InventorySupport {
 checkBinding(dir:string,payload:Row,user:Principal,options:Options,writing?:boolean):string;
 principal(value:unknown):Principal;actions(user:Principal):string[];requireRead(user:Principal,names:readonly string[]):void;
 root(dir:string,create?:boolean):string;readFile(file:string,max?:number):Buffer;writeImmutable(file:string,bytes:Buffer):void;authority(dir:string,create?:boolean):Buffer;
 bytesOf(file:unknown):{name:string;bytes:Buffer};descriptor(file:{name:string;bytes:Buffer}):Descriptor;verifyDescriptor(dir:string,descriptor:unknown):Buffer;json(value:unknown):Json;stable(value:unknown):string;
 load(dir:string,id:string,user:Principal,options?:{historical?:boolean;database?:Record<string,Row[]>}):Row;
 verifyScopedSource(database:Record<string,Row[]>,source:Row,user:Principal,proofRequired?:boolean):void;
}
interface Snapshot {data:Record<string,Row[]>;revisions:Record<string,number>;databaseToken:string;platform:{schemaVersion:number;storageKind?:string}}
interface Storage {withDatabaseLock<T>(dir:string,action:()=>T):T;readSnapshot(dir:string):Snapshot;readAll(dir:string):Record<string,Row[]>;assertWriteCompatibility(dir:string,options:Options,capability:string):unknown}
interface Access {authorize(user:Principal,action:string,section:string):boolean;actionAvailable(user:Principal,action:string,section:string):boolean}
interface Preview {canApply:boolean;fingerprint:string;readSections:string[];writeSections:string[];sections:Record<string,Row[]>;issues:Row[];warnings:Row[];[key:string]:unknown}
interface Core {preview(db:Record<string,Row[]>,input:Row,context:Record<string,unknown>):Preview;plan(db:Record<string,Row[]>,input:Row,context:Record<string,unknown>):{sections:Record<string,Row[]>}}
interface Temp {directory:string}
interface ArchiveTools {createOwnedTemp(prefix:string):Temp;removeOwnedTemp(temp:Temp):void}
interface ImportError extends Error {code?:string;status?:number;issues?:Row[]}
const storage=require('./storage') as Storage,access=require('./access-control') as Access;
const SECTIONS=['inventoryOrgs','inventoryObjects','inventoryMols','inventoryItems','inventorySessions'],PROFILE='asset-inventory';
const sha=(value:Buffer):string=>crypto.createHash('sha256').update(value).digest('hex');
function fail(code:string,message:string,status=400):never {throw Object.assign(Error(message),{code,status});}
function record(value:unknown):Row {if(!value||typeof value!=='object'||Array.isArray(value))fail('IMPORT_MAPPING','Нужен объект параметров импорта');return value as Row;}
function mapping(value:unknown,support:InventorySupport):Mapping {
 const row=record(support.json(value??{})),allowed=['format','defaultOrgName','defaultObjectName','date','title','useOpeningIfNoClosing','target'];
 if(Object.keys(row).some(key=>!allowed.includes(key))||!['auto','legacy','osv','comparison'].includes(row.format as string))fail('IMPORT_MAPPING','Выберите автоматическое распознавание или явный формат прежней базы, ОСВ или описи');
 for(const key of ['defaultOrgName','defaultObjectName','date','title'])if(Object.hasOwn(row,key)&&(typeof row[key]!=='string'||(row[key] as string).length>2000||!String(row[key]).trim()))fail('IMPORT_MAPPING','Заполните непустые параметры импорта');
 if(Object.hasOwn(row,'useOpeningIfNoClosing')&&(typeof row.useOpeningIfNoClosing!=='boolean'||!['osv','auto'].includes(row.format as string)))fail('IMPORT_MAPPING','Начальное сальдо доступно только для ОСВ');
 if(Object.hasOwn(row,'target')){if(row.format==='legacy')fail('IMPORT_MAPPING','Прежняя база переносится отдельным набором справочников');const target=record(row.target);if(!Object.keys(target).length||Object.keys(target).some(key=>!['orgId','objectId','molId'].includes(key))||Object.values(target).some(value=>typeof value!=='string'&&typeof value!=='number'||typeof value==='string'&&(!value.trim()||value.length>500)||typeof value==='number'&&!Number.isFinite(value)))fail('IMPORT_MAPPING','Нужны точные собственные идентификаторы назначения');}
 return row as unknown as Mapping;
}
function allowed(user:Principal,action:string,name:string):boolean {const selected=user[action==='read'?'readable':'writable'];return access.authorize(user,action,name)&&(!Array.isArray(selected)||selected.includes('*')||selected.includes(name));}
function ensure(dir:string,payload:Row,user:Principal,options:Options,support:InventorySupport):string {
 const token=support.checkBinding(dir,payload,user,options,true);
 if(!['admin','accountant'].includes(user.role)||!support.actions(user).includes(PROFILE)||SECTIONS.some(name=>!allowed(user,'write',name)||!access.actionAvailable(user,'import:'+PROFILE,name)))fail('ACCESS_DENIED','Импорт инвентаризации доступен администратору и бухгалтеру с полными правами собственных разделов',403);
 support.requireRead(user,SECTIONS);storage.assertWriteCompatibility(dir,options,'inventoryV1');const snapshot=storage.readSnapshot(dir);if(snapshot.platform.schemaVersion!==6||snapshot.platform.storageKind!=='sqlite')fail('INVENTORY_SQLITE_REQUIRED','Импорт инвентаризации требует проверенную базу SQLite схемы 6',428);return token;
}
async function decode(file:{name:string;bytes:Buffer},selected:Mapping):Promise<DecodeResult> {
 const tools=await import(pathToFileURL(path.join(__dirname,'../ReestrBuilder/archive-budget.mjs')).href) as ArchiveTools,temp=tools.createOwnedTemp('reestr-inventory-');let worker:Worker|undefined,timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const request:DecodeRequest={file:{name:file.name,bytes:file.bytes},mapping:selected,tempDirectory:temp.directory};worker=new Worker(path.join(__dirname,'asset-inventory-decode-worker.js'),{workerData:request,resourceLimits:{maxOldGenerationSizeMb:192,maxYoungGenerationSizeMb:32}});const current=worker;
  return await new Promise<DecodeResult>((resolve,reject)=>{
   let done=false;const finish=(error:unknown,value?:DecodeResult):void=>{if(done)return;done=true;if(timer)clearTimeout(timer);if(error)reject(error);else if(value)resolve(value);else reject(Object.assign(Error('Нет результата разбора'),{code:'IMPORT_DECODE'}));};
   timer=setTimeout(()=>finish(Object.assign(Error('Разбор источника превысил 30 секунд'),{code:'IMPORT_DECODE_TIMEOUT',status:400})),30000);
   current.once('message',(message:unknown)=>{const value=message as {ok?:boolean;value?:DecodeResult;error?:string;code?:string};finish(value.ok?null:Object.assign(Error(value.error||'Источник не прочитан'),{code:value.code||'IMPORT_DECODE',status:400}),value.value);});current.once('error',error=>finish(error));current.once('exit',()=>finish(Object.assign(Error('Разбор завершился без результата'),{code:'IMPORT_DECODE'})));
  });
 }finally{if(timer)clearTimeout(timer);if(worker)await worker.terminate();tools.removeOwnedTemp(temp);}
}
async function stage(dir:string,payload:Row,options:Options,support:InventorySupport):Promise<Row> {
 const user=support.principal(options.getPrincipal?options.getPrincipal():options.principal),token=ensure(dir,payload,user,options,support),parser=record(payload.parser);
 if(parser.id!==PROFILE||parser.version!==1||Object.keys(parser).some(key=>!['id','version'].includes(key)))fail('IMPORT_PARSER','Неизвестная версия разбора инвентаризации');
 if(!Array.isArray(payload.sections)||payload.sections.length!==SECTIONS.length||new Set(payload.sections).size!==SECTIONS.length||payload.sections.some(name=>typeof name!=='string'||!SECTIONS.includes(name)))fail('IMPORT_SECTIONS','Для источника нужны все пять собственных разделов инвентаризации');
 if(Object.hasOwn(payload,'rows')||Object.hasOwn(payload,'interpretation'))fail('IMPORT_INTERPRETATION_REQUIRED','Импорт инвентаризации принимает только исходные байты, без расшифровки из окна');
 const fileInput=record(payload.source);if(Object.keys(fileInput).some(key=>!['name','bytes','base64'].includes(key))||Object.hasOwn(fileInput,'bytes')===Object.hasOwn(fileInput,'base64'))fail('IMPORT_FILE','Выберите один исходный файл и один способ передачи байтов');const selected=mapping(payload.mapping,support),file=support.bytesOf(fileInput),result=await decode(file,selected);
 return storage.withDatabaseLock(dir,()=>{
  const current=support.principal(options.getPrincipal?options.getPrincipal():options.principal);if(current.id!==user.id||current.role!==user.role||current.policyStamp!==user.policyStamp)fail('ACCESS_DENIED','Права изменились во время чтения файла',403);if(ensure(dir,payload,current,options,support)!==token)fail('DATABASE_CHANGED','База изменилась во время чтения файла',409);
  if(!result.canImport)return {ok:true,canImport:false,issues:result.issues,warnings:result.warnings,databaseToken:token};
  if(!result.data||Object.keys(result.data).length!==SECTIONS.length||SECTIONS.some(name=>!Array.isArray(result.data[name]))||!SECTIONS.some(name=>result.data[name]!.length))fail('IMPORT_EMPTY','В исходнике нет собственных данных инвентаризации');
  const detected=result.detectedFormat||selected.format;if(detected==='legacy'&&selected.target)fail('IMPORT_MAPPING','Прежняя база переносится отдельным набором справочников');
  const preliminary:Row={version:1,profile:PROFILE,sha256:sha(file.bytes),format:detected==='legacy'?'inventory-legacy-json':detected==='osv'?'inventory-osv':'inventory-comparison',parserVersion:1,name:file.name,data:result.data,sections:SECTIONS.slice(),sourceScopes:SECTIONS.slice(),warnings:result.warnings,accessScope:{version:1,policyStamp:current.policyStamp||''},...(selected.target?{target:selected.target}:{})};
  support.verifyScopedSource(storage.readAll(dir),preliminary,current,true);
  const folder=support.root(dir,true),original=support.descriptor(file);support.writeImmutable(path.join(folder,original.id),file.bytes);const source:Row={...preliminary,sourceArchive:original as unknown as Row},sql=require('./sqlite-storage.cjs') as {readIdentity(dir:string):unknown},body={version:1,kind:'trusted-import-source',binding:{databaseToken:token,sourceDatabase:sql.readIdentity(dir),principal:{id:current.id,role:current.role,...(current.policyStamp?{policyStamp:current.policyStamp}:{})}},source},signature=crypto.createHmac('sha256',support.authority(dir,true)).update(support.stable(body)).digest('hex'),bytes=Buffer.from(support.stable({...body,signature})),sourceId=sha(bytes);
  if(bytes.length>32*1024*1024)fail('IMPORT_LIMIT','Подготовленный источник превышает 32 МБ');support.writeImmutable(path.join(folder,sourceId+'.json'),bytes);const loaded=support.load(dir,sourceId,current);return {ok:true,canImport:true,sourceId,source:loaded,warnings:result.warnings,issues:[],databaseToken:token};
 });
}
function preview(dir:string,payload:Row,options:Options,support:InventorySupport):Row {
 return storage.withDatabaseLock(dir,()=>{
  const user=support.principal(options.getPrincipal?options.getPrincipal():options.principal);ensure(dir,payload,user,options,support);const snapshot=storage.readSnapshot(dir);if(typeof payload.sourceId!=='string')fail('IMPORT_SOURCE','Не выбран подготовленный источник');const source=support.load(dir,payload.sourceId,user,{database:snapshot.data});if(source.profile!==PROFILE)fail('IMPORT_PROFILE','Источник относится к другому профилю');
  if(typeof payload.reason!=='string'||payload.reason.trim().length<3||payload.reason.length>20000)fail('IMPORT_REASON','Укажите основание импорта');const input:Row={action:source.format==='inventory-legacy-json'?'importLegacy':'importRows',sourceId:payload.sourceId,reason:payload.reason,...(Object.hasOwn(payload,'sessionIds')?{sessionIds:payload.sessionIds!}:{})},now=options.now||new Date().toISOString(),calendar=(require('../assets/core/business-calendar.js') as {resolve(db:unknown,now:string):{today:string}}).resolve(snapshot.data,now),readable=SECTIONS.filter(name=>allowed(user,'read',name)),writable=SECTIONS.filter(name=>allowed(user,'write',name)),core=require('../assets/core/asset-inventory.js') as Core;
  const reviewed=core.preview(snapshot.data,input,{today:calendar.today,importSource:source,readable}),context={id:'inventory-import-preview',now,today:calendar.today,calendar,actor:{id:user.id,name:user.name||user.id,role:user.role},readable,writable,importSource:source};support.requireRead(user,reviewed.readSections);
  (require('./command-service.cjs') as {assertCommandScope(db:unknown,command:unknown,names:string[],user:Principal):void}).assertCommandScope(snapshot.data,{type:'AssetInventoryAction',input},reviewed.readSections,user);
  if(reviewed.writeSections.some(name=>!allowed(user,'write',name)))fail('ACCESS_DENIED','Недостаточно прав для всех изменений импорта',403);let authoritative=reviewed;
  if(reviewed.canApply){const operation={id:context.id},command={type:'AssetInventoryAction',version:1,input:{...input,reviewFingerprint:reviewed.fingerprint}},intent={protocolVersion:1,databaseToken:snapshot.databaseToken,operation,base:Object.fromEntries(reviewed.readSections.map(name=>[name,snapshot.revisions[name]])),command};
   try{const planned=core.plan(snapshot.data,command.input,context);(require('./platform-service.cjs') as {prepareTransaction(previous:unknown,next:unknown,options:unknown):unknown}).prepareTransaction(snapshot.data,planned.sections,{principal:user,now,commandIntent:intent,importSource:source,operation,base:intent.base,revisions:snapshot.revisions,databaseToken:snapshot.databaseToken,dataDir:dir});}catch(error){const e=error as ImportError,items=e.issues?.length?e.issues.map(value=>({severity:'error',code:value.code||e.code||'IMPORT_POLICY',message:value.message||e.message})): [{severity:'error',code:e.code||'IMPORT_POLICY',message:e.message}];authoritative={...reviewed,canApply:false,issues:[...reviewed.issues,...items]};}
  }
  return support.json({ok:true,preview:authoritative,reviewFingerprint:reviewed.fingerprint,base:Object.fromEntries(reviewed.readSections.map(name=>[name,snapshot.revisions[name]])),databaseToken:snapshot.databaseToken,input}) as Row;
 });
}
export async function handle(dir:string,payloadValue:unknown,options:Options,support:InventorySupport):Promise<Row> {const payload=record(support.json(payloadValue));if(payload.profile!==PROFILE)fail('IMPORT_PROFILE','Неверный профиль источника');if(payload.action==='stage')return stage(dir,payload,options,support);if(payload.action==='preview')return preview(dir,payload,options,support);return fail('IMPORT_ACTION','Неизвестное действие с источником инвентаризации');}
