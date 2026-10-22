import type { AssetTarget, CostActionInput, DocumentActionInput, FuelActionInput, Identifier, JsonRow, JsonValue, MergeCatalogInput, PeriodActionInput, PlatformCommand, ProcurementActionInput, SectionRows, createPlatformContracts } from './platform-contracts';

export interface CommandActor { id: string; name: string; role: string }
export interface CommandContext { id: string; now: string; today: string; actor: CommandActor; readable?:string[]; writable?:string[] }
export interface CommandPlan { sections: SectionRows; readSections: string[]; writeSections: string[]; entityIds: Record<string, Identifier> }
interface PersonnelRules { apiVersion: number; validateChanges(previous: unknown, next: unknown, context?: unknown): unknown }
interface FuelRules { apiVersion: number; validateChanges(previous: unknown, next: unknown): unknown }
interface FuelEngine { parseFuelGrade(value: unknown): string }
interface CatalogMerge { apiVersion: number; footprint(input: MergeCatalogInput): string[]; plan(database: unknown,input: MergeCatalogInput,context: CommandContext): CommandPlan }
interface SectionRegistry { sections: readonly string[] }
interface DocumentActions {apiVersion:number;dependencies(input:DocumentActionInput):string[];footprint(input:DocumentActionInput):string[];plan(database:unknown,input:DocumentActionInput,context:CommandContext):CommandPlan}
interface PeriodActions {apiVersion:number;dependencies(input:PeriodActionInput):string[];footprint(input:PeriodActionInput):string[];plan(database:unknown,input:PeriodActionInput,context:CommandContext):CommandPlan}
interface FuelActions {apiVersion:number;dependencies(input:FuelActionInput):string[];footprint(input:FuelActionInput):string[];plan(database:unknown,input:FuelActionInput,context:CommandContext):CommandPlan}
interface ProcurementActions {apiVersion:number;dependencies(input:ProcurementActionInput):string[];footprint(input:ProcurementActionInput):string[];plan(database:unknown,input:ProcurementActionInput,context:CommandContext):CommandPlan}
interface CostActions {apiVersion:number;dependencies(input:CostActionInput):string[];footprint(input:CostActionInput):string[];plan(database:unknown,input:CostActionInput,context:CommandContext):CommandPlan}
type Contracts = ReturnType<typeof createPlatformContracts>;
interface CommandError extends Error { code: string; status: number; field?: string }

/** Pure semantic actions. Storage still owns ACL, CAS, audit and atomic commit. */
export function createPlatformCommands(contracts: Contracts, personnel: PersonnelRules, fuel: FuelRules, fuelEngine: FuelEngine,catalog?: CatalogMerge,registry?: SectionRegistry,documents?:DocumentActions,periods?:PeriodActions,fuelActions?:FuelActions,procurementActions?:ProcurementActions,costActions?:CostActions) {
  if (!contracts || contracts.apiVersion !== 1 || !personnel || personnel.apiVersion !== 1 || !fuel || fuel.apiVersion !== 1 || typeof fuelEngine?.parseFuelGrade !== 'function')
    throw new Error('Не загружены общие правила команд платформы');
  function fail(code: string,message: string,field?: string): never {
    const error=new Error(message) as CommandError;error.name='PlatformCommandError';error.code=code;error.status=400;
    if(field!==undefined)error.field=field;throw error;
  }
  function copy(value: JsonValue): JsonValue {
    if(value===null||typeof value!=='object')return value;
    if(Array.isArray(value))return value.map(copy);
    const result:JsonRow={};for(const key of Object.keys(value))result[key]=copy(value[key] as JsonValue);return result;
  }
  function parseCommand(value: unknown): PlatformCommand {return contracts.validateCommand(value);}
  function mergeModule(): CatalogMerge {
    if(!catalog||catalog.apiVersion!==1||!registry)fail('MODULE_UNAVAILABLE','Не загружены правила управляемого объединения');
    return catalog;
  }
  function documentModule():DocumentActions {if(!documents||documents.apiVersion!==1)fail('MODULE_UNAVAILABLE','Не загружен общий движок документов');return documents;}
  function periodModule():PeriodActions {if(!periods||periods.apiVersion!==1)fail('MODULE_UNAVAILABLE','Не загружены правила закрытия периодов');return periods;}
  function fuelOperations():FuelActions {if(!fuelActions||fuelActions.apiVersion!==1)fail('MODULE_UNAVAILABLE','Не загружен общий движок операций с топливом');return fuelActions;}
  function procurementOperations():ProcurementActions {if(!procurementActions||procurementActions.apiVersion!==1)fail('MODULE_UNAVAILABLE','Не загружен общий движок закупок и поставок');return procurementActions;}
  function costOperations():CostActions {if(!costActions||costActions.apiVersion!==1)fail('MODULE_UNAVAILABLE','Не загружены общие правила себестоимости');return costActions;}
  function footprint(value: unknown): string[] {
    const command=parseCommand(value);
    if(command.type==='DocumentAction')return documentModule().footprint(command.input);
    if(command.type==='PeriodAction')return periodModule().footprint(command.input);
    if(command.type==='FuelAction')return fuelOperations().footprint(command.input);
    if(command.type==='ProcurementAction')return procurementOperations().footprint(command.input);
    if(command.type==='CostAction')return costOperations().footprint(command.input);
    if(command.type==='MergeCatalog'){
      const names=mergeModule().footprint(command.input);
      if(names.includes('auditLog'))fail('INVALID_COMMAND','Исторические ссылки аудита нельзя выбирать для переноса','mutableRefs');
      return names;
    }
    if(command.type==='IssueFuel')return ['fuelMovements',command.input.target.section==='vehicles'?'records':'genRecords'].sort();
    return [command.type==='AcceptShift'?'shiftReports':'assetAssignments'];
  }
  function dependencies(value: unknown,_database?: unknown): string[] {
    const command=parseCommand(value);
    if(command.type==='DocumentAction')return documentModule().dependencies(command.input);
    if(command.type==='PeriodAction')return periodModule().dependencies(command.input);
    if(command.type==='FuelAction')return fuelOperations().dependencies(command.input);
    if(command.type==='ProcurementAction')return procurementOperations().dependencies(command.input);
    if(command.type==='CostAction')return costOperations().dependencies(command.input);
    if(command.type==='MergeCatalog'){mergeModule();return [...(registry as SectionRegistry).sections].sort();}
    if(command.type==='IssueFuel')return ['tanks','tankIncomes','genRecords','generators','fuelMovements','records','vehicles','assetAssignments','fuelPeriods','fuelWriteoffs','fuelPurchases','monthlyFuel'].sort();
    if(command.type==='AcceptShift')return ['shiftReports','vehicles','generators','drivers','dispatchJobs'].sort();
    return ['assetAssignments','drivers','vehicles','generators','fuelPeriods'].sort();
  }
  function database(value: unknown,names: string[]): SectionRows {
    if(value===null||typeof value!=='object'||Array.isArray(value))fail('INVALID_COMMAND_SOURCE','Для команды нужен снимок базы');
    const source=value as Record<string,unknown>, projection:Record<string,unknown>={};
    for(const name of names){
      const descriptor=Object.getOwnPropertyDescriptor(source,name);
      if(descriptor?.get||descriptor?.set)fail('INVALID_COMMAND_SOURCE','Снимок содержит исполняемые свойства',name);
      projection[name]=descriptor?descriptor.value:[];
    }
    const valid=contracts.validateSections(projection,names),result:SectionRows={};
    for(const name of names)result[name]=copy(valid[name] as JsonRow[]) as JsonRow[];
    return result;
  }
  function rows(db:SectionRows,name:string):JsonRow[]{return db[name]||[];}
  function find(db:SectionRows,name:string,id:Identifier):JsonRow {
    const matches=rows(db,name).filter(row=>row.id===id);
    if(matches.length!==1)fail(matches.length?'AMBIGUOUS_REFERENCE':'COMMAND_NOT_FOUND',matches.length?'Идентификатор неоднозначен':'Не найдена запись команды',name);
    return matches[0] as JsonRow;
  }
  function live(row:JsonRow):boolean{return !row.archived&&!row.deleted;}
  function targetFor(db:SectionRows,target:AssetTarget,allowArchived=false):{row:JsonRow;ref:string} {
    const row=find(db,target.section,target.id);
    // Existing assetRef is a string. Even a typed command must not write a link
    // whose persisted representation could resolve to either 7 or '7'.
    if(rows(db,target.section).filter(item=>String(item.id)===String(target.id)).length!==1)
      fail('AMBIGUOUS_ASSET','У техники совпадают строковые идентификаторы. Сначала устраните неоднозначность','target.id');
    if(!allowArchived&&!live(row))fail('COMMAND_ARCHIVED','Нельзя выбрать технику из архива','target');
    return {row,ref:(target.section==='vehicles'?'v:':'g:')+String(target.id)};
  }
  function targetFromRef(db:SectionRows,ref:JsonValue|undefined):AssetTarget {
    if(typeof ref!=='string'||!/^([vg]):.+$/.test(ref))fail('INVALID_ASSET','Сменная форма должна быть связана с транспортом или ДЭС','assetRef');
    const section=ref.startsWith('v:')?'vehicles':'generators',matches=rows(db,section).filter(row=>String(row.id)===ref.slice(2));
    if(matches.length!==1)fail(matches.length?'AMBIGUOUS_ASSET':'COMMAND_NOT_FOUND','Не удалось однозначно найти технику смены','assetRef');
    const id=matches[0]?.id;if(!contracts.identifier(id))fail('INVALID_ASSET','Некорректный идентификатор техники','assetRef');
    return {section,id};
  }
  function validDate(value:unknown):value is string {
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
    const day=new Date(value+'T12:00:00Z');return Number.isFinite(day.getTime())&&day.toISOString().slice(0,10)===value;
  }
  function context(value:unknown):CommandContext {
    const checked=contracts.validateSections({appMeta:[value]},['appMeta']).appMeta?.[0];
    if(!checked)fail('INVALID_COMMAND_CONTEXT','Нет контекста команды');
    const id=contracts.validateOperation({id:checked.id}).id, actor=checked.actor;
    if(typeof checked.now!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(checked.now)||!validDate(checked.now.slice(0,10))||Number(checked.now.slice(11,13))>23||Number(checked.now.slice(14,16))>59||Number(checked.now.slice(17,19))>59||!Number.isFinite(Date.parse(checked.now))||!validDate(checked.today)||actor===null||typeof actor!=='object'||Array.isArray(actor))
      fail('INVALID_COMMAND_CONTEXT','Нужны время, дата и автор команды');
    for(const field of ['id','name','role'])if(typeof actor[field]!=='string'||!(actor[field] as string).trim())fail('INVALID_COMMAND_CONTEXT','Некорректный автор команды');
    const result:CommandContext={id,now:checked.now,today:checked.today,actor:{id:actor.id as string,name:actor.name as string,role:actor.role as string}};
    for(const field of ['readable','writable'] as const)if(checked[field]!==undefined){const values=checked[field];if(!Array.isArray(values)||values.some(value=>typeof value!=='string'||!value.trim()))fail('INVALID_COMMAND_CONTEXT','Некорректные полномочия команды',field);result[field]=values.slice() as string[];}
    return result;
  }
  function noId(db:SectionRows,section:string,id:string):void {
    if(rows(db,section).some(row=>row.id===id))fail('COMMAND_ID_EXISTS','Запись с идентификатором команды уже существует',section);
  }
  function stamp(row:JsonRow,ctx:CommandContext,created:boolean):void {row.updatedAt=ctx.now;if(created)row.createdAt=ctx.now;}
  function family(row:JsonRow):string {
    const grade=fuelEngine.parseFuelGrade(row.fuelGrade);
    if(grade==='ДТ')return 'diesel';if(grade==='Газ')return 'gas';if(/^АИ-/.test(grade)||/^бензин$/i.test(String(row.fuelGrade||'').trim()))return 'gasoline';
    return typeof row.fuel==='string'&&row.fuel?row.fuel:'diesel';
  }
  function effectiveOrg(db:SectionRows,ref:string,date:string,asset:JsonRow):JsonValue {
    const applicable=rows(db,'assetAssignments').filter(row=>!row.archived&&row.assetRef===ref&&typeof row.from==='string'&&row.from<=date&&(!row.to||typeof row.to==='string'&&row.to>=date))
      .slice().sort((a,b)=>String(b.from).localeCompare(String(a.from)));
    return applicable[0]?.org??asset.org??'';
  }
  function issueFuel(db:SectionRows,command:Extract<PlatformCommand,{type:'IssueFuel'}>,ctx:CommandContext):CommandPlan {
    const input=command.input,tank=find(db,'tanks',input.tankId),target=targetFor(db,input.target);
    if(!live(tank))fail('COMMAND_ARCHIVED','Нельзя выдавать топливо из архивной ёмкости','tankId');
    if(rows(db,'fuelPeriods').some(row=>row.month===input.date.slice(0,7)&&row.closed))fail('PERIOD_CLOSED','Топливный месяц закрыт','date');
    const journal=input.target.section==='vehicles'?'records':'genRecords',recordId='fuel-movement:'+ctx.id;
    noId(db,'fuelMovements',ctx.id);noId(db,journal,recordId);
    if(rows(db,'records').concat(rows(db,'genRecords')).some(row=>row.fuelMovementId===ctx.id))fail('COMMAND_ID_EXISTS','Связанная выдача уже есть в журнале');
    const fuelFamily=family(tank),assetOrg=effectiveOrg(db,target.ref,input.date,target.row);
    const source:JsonRow={tankId:input.tankId,tankName:tank.name??'',tankOrg:tank.org??'',assetOrg,fuel:fuelFamily};
    const movement:JsonRow={id:ctx.id,date:input.date,kind:'issue',fromTankId:input.tankId,toTankId:'',qty:input.qty,assetRef:target.ref,reason:input.reason,recordId,sourceSnapshot:source};
    if(input.legacyOverlapConfirmed!==undefined)movement.legacyOverlapConfirmed=input.legacyOverlapConfirmed;
    const linked:JsonRow={id:recordId,date:input.date,fuelIssued:input.qty,fuelUsed:0,fuelActual:null,fuelMovementId:ctx.id,note:'Выдача из ёмкости: '+String(tank.name||'')+'. '+input.reason,
      fuelOrg:tank.org??'',fuelProvider:'Ёмкость '+String(tank.name||''),fuelSourceSnapshot:copy(source)};
    if(journal==='records')Object.assign(linked,{vehicleId:input.target.id,km:0,fuelGrade:fuelEngine.parseFuelGrade(tank.fuelGrade)||(fuelFamily==='gasoline'?'Бензин':fuelFamily==='gas'?'Газ':'ДТ')});
    else Object.assign(linked,{generatorId:input.target.id,hours:0,tankId:null,fuelActualSource:'movement'});
    stamp(movement,ctx,true);stamp(linked,ctx,true);
    const sections:SectionRows={fuelMovements:rows(db,'fuelMovements').concat(movement),[journal]:rows(db,journal).concat(linked)};
    fuel.validateChanges(db,{...db,...sections});
    return {sections,readSections:dependencies(command),writeSections:footprint(command),entityIds:{movementId:ctx.id,recordId}};
  }
  function acceptShift(db:SectionRows,command:Extract<PlatformCommand,{type:'AcceptShift'}>,ctx:CommandContext):CommandPlan {
    const before=find(db,'shiftReports',command.input.shiftId);
    if(before.status!=='sent'||!live(before))fail('INVALID_TRANSITION','Принимать можно только отправленную действующую сменную форму','status');
    const changes=command.input.changes,after:JsonRow={...before},selected=changes.target||targetFromRef(db,before.assetRef);
    const ref=(selected.section==='vehicles'?'v:':'g:')+String(selected.id),sameAsset=before.assetRef===ref;
    const target=targetFor(db,selected,sameAsset);
    for(const [key,value]of Object.entries(changes))if(key!=='target')after[key]=value as JsonValue;
    after.assetRef=target.ref;
    if(typeof after.title!=='string'||!after.title.trim()||!validDate(after.date)||!contracts.identifier(after.driverId))fail('INVALID_SHIFT','Укажите название, дату, технику и сотрудника смены');
    for(const field of ['odoStart','odoEnd','hours','fuelIssued','tankMeasured']) {
      const amount=after[field];if(amount!==undefined&&amount!==null&&amount!==''&&(typeof amount!=='number'||!Number.isFinite(amount)||amount<0))fail('INVALID_SHIFT','Проверьте числовые реквизиты смены',field);
    }
    find(db,'drivers',after.driverId);
    if(after.jobId!==undefined&&after.jobId!==null&&after.jobId!==''){
      if(!contracts.identifier(after.jobId))fail('INVALID_SHIFT','Некорректная заявка смены','jobId');find(db,'dispatchJobs',after.jobId);
    }
    if(typeof after.odoStart==='number'&&typeof after.odoEnd==='number'&&after.odoEnd<after.odoStart)fail('INVALID_SHIFT','Конечный одометр меньше начального','odoEnd');
    after.status='accepted';after.acceptedActor={...ctx.actor};after.acceptedAt=ctx.now;stamp(after,ctx,false);
    const sections:SectionRows={shiftReports:rows(db,'shiftReports').map(row=>row===before?after:row)};
    personnel.validateChanges(db,{...db,...sections},{today:ctx.today,now:ctx.now});
    return {sections,readSections:dependencies(command),writeSections:footprint(command),entityIds:{shiftId:command.input.shiftId}};
  }
  function assignPerson(db:SectionRows,command:Extract<PlatformCommand,{type:'AssignPerson'}>,ctx:CommandContext):CommandPlan {
    const input=command.input,before=input.assignmentId===undefined?null:find(db,'assetAssignments',input.assignmentId),id=input.assignmentId??ctx.id;
    if(before&&!live(before))fail('COMMAND_ARCHIVED','Архивное назначение нельзя изменить этой командой');
    if(!before)noId(db,'assetAssignments',ctx.id);
    const ref=(input.target.section==='vehicles'?'v:':'g:')+String(input.target.id),unchanged=before?.assetRef===ref&&before.driverId===input.driverId;
    targetFor(db,input.target,unchanged);find(db,'drivers',input.driverId);
    const after:JsonRow={...(before||{}),id,assetRef:ref,driverId:input.driverId,from:input.from,to:input.to??before?.to??'',site:input.site,org:input.org??before?.org??'',reason:input.reason};
    if(after.to!==''&&after.to!==null&&after.to!==undefined&&(!validDate(after.to)||after.to<input.from))fail('INVALID_COMMAND','Дата окончания раньше начала или не заполнена правильно','to');
    if(input.status!==undefined)after.status=input.status;stamp(after,ctx,!before);
    const assignments=rows(db,'assetAssignments').map(row=>row===before?after:row);
    if(!before)assignments.push(after);
    const entityIds:Record<string,Identifier>={assignmentId:id};
    if(input.replacesAssignmentId!==undefined){
      if(input.replacesAssignmentId===id)fail('INVALID_REPLACEMENT','Нельзя заменить назначение самим собой','replacesAssignmentId');
      const previous=find(db,'assetAssignments',input.replacesAssignmentId);
      if(!live(previous)||previous.status==='cancelled'||previous.assetRef!==ref||!validDate(previous.from)||previous.from>=input.from||typeof previous.to==='string'&&previous.to!==''&&previous.to<input.from)
        fail('INVALID_REPLACEMENT','Прежнее назначение должно действовать для той же техники на дату замены','replacesAssignmentId');
      const end=new Date(input.from+'T12:00:00Z');end.setUTCDate(end.getUTCDate()-1);
      const closed:JsonRow={...previous,to:end.toISOString().slice(0,10)};stamp(closed,ctx,false);
      const index=assignments.indexOf(previous);assignments[index]=closed;entityIds.replacedAssignmentId=input.replacesAssignmentId;
    }
    const sections:SectionRows={assetAssignments:assignments};
    personnel.validateChanges(db,{...db,...sections},{today:ctx.today,now:ctx.now});
    return {sections,readSections:dependencies(command),writeSections:footprint(command),entityIds};
  }
  function plan(source:unknown,value:unknown,metadata:unknown):CommandPlan {
    const command=parseCommand(value),ctx=context(metadata),db=database(source,dependencies(command));
    if(command.type==='DocumentAction')return documentModule().plan(db,command.input,ctx);
    if(command.type==='PeriodAction')return periodModule().plan(db,command.input,ctx);
    if(command.type==='FuelAction')return fuelOperations().plan(db,command.input,ctx);
    if(command.type==='ProcurementAction')return procurementOperations().plan(db,command.input,ctx);
    if(command.type==='CostAction')return costOperations().plan(db,command.input,ctx);
    if(command.type==='MergeCatalog')return mergeModule().plan(db,command.input,ctx);
    if(command.type==='IssueFuel')return issueFuel(db,command,ctx);
    if(command.type==='AcceptShift')return acceptShift(db,command,ctx);
    return assignPerson(db,command,ctx);
  }
  return Object.freeze({apiVersion:1 as const,parseCommand,footprint,dependencies,plan});
}
