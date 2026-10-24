import type { AssetTarget, CalendarActionInput, CostActionInput, DocumentActionInput, FuelActionInput, Identifier, ImportActionInput, JsonRow, JsonValue, MergeCatalogInput, PeriodActionInput, PlatformCommand, ProcurementActionInput, RepairActionInput, SectionRows, createPlatformContracts } from './platform-contracts';

export type {CommandActor,CommandContext,CommandPlan} from './command-source';
import type {CommandContext,CommandPlan,CommandSourceAPI} from './command-source';
import type {IssueFuelAPI} from './issue-fuel';
interface PersonnelRules { apiVersion: number; validateChanges(previous: unknown, next: unknown, context?: unknown): unknown }
interface CatalogMerge { apiVersion: number; footprint(input: MergeCatalogInput): string[]; plan(database: unknown,input: MergeCatalogInput,context: CommandContext): CommandPlan }
interface SectionRegistry { sections: readonly string[] }
interface DocumentActions {apiVersion:number;dependencies(input:DocumentActionInput):string[];footprint(input:DocumentActionInput):string[];plan(database:unknown,input:DocumentActionInput,context:CommandContext):CommandPlan}
interface PeriodActions {apiVersion:number;dependencies(input:PeriodActionInput):string[];footprint(input:PeriodActionInput):string[];plan(database:unknown,input:PeriodActionInput,context:CommandContext):CommandPlan}
interface FuelActions {apiVersion:number;dependencies(input:FuelActionInput):string[];footprint(input:FuelActionInput):string[];plan(database:unknown,input:FuelActionInput,context:CommandContext):CommandPlan}
interface ProcurementActions {apiVersion:number;dependencies(input:ProcurementActionInput):string[];footprint(input:ProcurementActionInput):string[];plan(database:unknown,input:ProcurementActionInput,context:CommandContext):CommandPlan}
interface CostActions {apiVersion:number;dependencies(input:CostActionInput):string[];footprint(input:CostActionInput):string[];plan(database:unknown,input:CostActionInput,context:CommandContext):CommandPlan}
interface RepairActions {apiVersion:number;dependencies(input:RepairActionInput):string[];footprint(input:RepairActionInput):string[];plan(database:unknown,input:RepairActionInput,context:CommandContext):CommandPlan}
interface CalendarActions {apiVersion:number;dependencies(input:CalendarActionInput):string[];footprint(input:CalendarActionInput):string[];plan(database:unknown,input:CalendarActionInput,context:CommandContext):CommandPlan}
interface BusinessCalendar {apiVersion:number;context(database:unknown,context:CommandContext):unknown;canonicalizeIntervals(previous:unknown,sections:SectionRows,context:CommandContext,options?:unknown):SectionRows}
interface PersonnelPlanning {apiVersion:number;dependencies():string[];captureShiftContext(database:unknown,shift:JsonRow,context:CommandContext):{snapshot:JsonRow}}
interface DocumentPrint {apiVersion:number;dependencies(request:unknown):string[];prepare(database:unknown,request:unknown,context:unknown):{canCapture:boolean;sourceFingerprint:string;blockers:unknown[]};capture(database:unknown,request:unknown,context:unknown):unknown}
interface ImportEngine {apiVersion:number;dependencies(input:ImportActionInput):string[];footprint(input:ImportActionInput):string[];plan(database:unknown,input:ImportActionInput,context:CommandContext):CommandPlan}
type Contracts = ReturnType<typeof createPlatformContracts>;

/** Pure semantic actions. Storage still owns ACL, CAS, audit and atomic commit. */
export function createPlatformCommands(contracts: Contracts, personnel: PersonnelRules, commandSource:CommandSourceAPI, issueFuel:IssueFuelAPI,catalog?: CatalogMerge,registry?: SectionRegistry,documents?:DocumentActions,periods?:PeriodActions,fuelActions?:FuelActions,procurementActions?:ProcurementActions,costActions?:CostActions,repairActions?:RepairActions,calendarActions?:CalendarActions,calendar?:BusinessCalendar,planning?:PersonnelPlanning,getPrinting?:()=>DocumentPrint,getImports?:()=>ImportEngine) {
  if (!contracts || contracts.apiVersion !== 1 || !personnel || personnel.apiVersion !== 1 || commandSource?.apiVersion!==1 || issueFuel?.apiVersion!==1)
    throw new Error('Не загружены общие правила команд платформы');
  const fail:(code:string,message:string,field?:string)=>never=commandSource.fail;
  const {database,rows,find,live,targetFor,validDate,context,noId,stamp}=commandSource;
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
  function repairOperations():RepairActions {if(!repairActions||repairActions.apiVersion!==1)fail('MODULE_UNAVAILABLE','Не загружены общие правила ремонтного процесса');return repairActions;}
  function calendarOperations():CalendarActions {if(!calendarActions||calendarActions.apiVersion!==1)fail('MODULE_UNAVAILABLE','Не загружены правила учётного календаря');return calendarActions;}
  function printModule():DocumentPrint {const printing=getPrinting?.();if(!printing||printing.apiVersion!==1)fail('MODULE_UNAVAILABLE','Не загружены печатные модели документов');return printing;}
  function importModule():ImportEngine {const imports=getImports?.();if(!imports||imports.apiVersion!==1)fail('MODULE_UNAVAILABLE','Не загружены правила подтверждённого импорта');return imports;}
  function footprint(value: unknown): string[] {
    const command=parseCommand(value);
    if(command.type==='ImportAction')return importModule().footprint(command.input);
    if(command.type==='PrintAction')return ['appMeta'];
    if(command.type==='DocumentAction')return documentModule().footprint(command.input);
    if(command.type==='PeriodAction')return periodModule().footprint(command.input);
    if(command.type==='FuelAction')return fuelOperations().footprint(command.input);
    if(command.type==='ProcurementAction')return procurementOperations().footprint(command.input);
    if(command.type==='CostAction')return costOperations().footprint(command.input);
    if(command.type==='RepairAction')return repairOperations().footprint(command.input);
    if(command.type==='CalendarAction')return calendarOperations().footprint(command.input);
    if(command.type==='MergeCatalog'){
      const names=mergeModule().footprint(command.input);
      if(names.includes('auditLog'))fail('INVALID_COMMAND','Исторические ссылки аудита нельзя выбирать для переноса','mutableRefs');
      return names;
    }
    if(command.type==='IssueFuel')return issueFuel.footprint(command);
    return [command.type==='AcceptShift'?'shiftReports':'assetAssignments'];
  }
  function commandDependencies(value: unknown): string[] {
    const command=parseCommand(value);
    if(command.type==='ImportAction')return importModule().dependencies(command.input);
    if(command.type==='PrintAction')return printModule().dependencies(command.input.request);
    if(command.type==='DocumentAction')return documentModule().dependencies(command.input);
    if(command.type==='PeriodAction')return periodModule().dependencies(command.input);
    if(command.type==='FuelAction')return fuelOperations().dependencies(command.input);
    if(command.type==='ProcurementAction')return procurementOperations().dependencies(command.input);
    if(command.type==='CostAction')return costOperations().dependencies(command.input);
    if(command.type==='RepairAction')return repairOperations().dependencies(command.input);
    if(command.type==='CalendarAction')return calendarOperations().dependencies(command.input);
    if(command.type==='MergeCatalog'){mergeModule();return [...(registry as SectionRegistry).sections].sort();}
    if(command.type==='IssueFuel')return issueFuel.dependencies(command);
    if(command.type==='AcceptShift')return [...new Set(['shiftReports','vehicles','generators','drivers','dispatchJobs','assetAssignments',...(planning?.dependencies()||[])])].sort();
    return [...new Set(['assetAssignments','drivers','vehicles','generators','fuelPeriods',...(planning?.dependencies()||[])])].sort();
  }
  function dependencies(value:unknown,_database?:unknown):string[]{return [...new Set([...commandDependencies(value),'appMeta'])].sort();}
  function targetFromRef(db:SectionRows,ref:JsonValue|undefined):AssetTarget {
    if(typeof ref!=='string'||!/^([vg]):.+$/.test(ref))fail('INVALID_ASSET','Сменная форма должна быть связана с транспортом или ДЭС','assetRef');
    const section=ref.startsWith('v:')?'vehicles':'generators',matches=rows(db,section).filter(row=>String(row.id)===ref.slice(2));
    if(matches.length!==1)fail(matches.length?'AMBIGUOUS_ASSET':'COMMAND_NOT_FOUND','Не удалось однозначно найти технику смены','assetRef');
    const id=matches[0]?.id;if(!contracts.identifier(id))fail('INVALID_ASSET','Некорректный идентификатор техники','assetRef');
    return {section,id};
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
    if(planning)after.personnelSnapshot=planning.captureShiftContext(db,after,ctx).snapshot;
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
    const command=parseCommand(value);
    if(command.type==='IssueFuel')return issueFuel.plan(source,command,metadata);
    const ctx=context(metadata),db=database(source,dependencies(command));
    calendar?.context(db,ctx);
    let result:CommandPlan;
    if(command.type==='ImportAction')result=importModule().plan(db,command.input,ctx);
    else if(command.type==='PrintAction'){
      const prepared=printModule().prepare(db,command.input.request,{...ctx,timing:command.input.request.mode==='manual'?'manual':'late'});
      if(!prepared.canCapture)fail('PRINT_SOURCE_UNAVAILABLE','Печатная модель недоступна; проверьте исходный документ');
      if(prepared.sourceFingerprint!==command.input.reviewFingerprint)fail('STALE_REVIEW','Источники печати изменились после проверки');
      printModule().capture(db,command.input.request,{...ctx,timing:command.input.request.mode==='manual'?'manual':'late'});
      result={sections:{},readSections:dependencies(command),writeSections:['appMeta'],entityIds:{}};
    }
    else if(command.type==='DocumentAction')result=documentModule().plan(db,command.input,ctx);
    else if(command.type==='PeriodAction')result=periodModule().plan(db,command.input,ctx);
    else if(command.type==='FuelAction')result=fuelOperations().plan(db,command.input,ctx);
    else if(command.type==='ProcurementAction')result=procurementOperations().plan(db,command.input,ctx);
    else if(command.type==='CostAction')result=costOperations().plan(db,command.input,ctx);
    else if(command.type==='RepairAction')result=repairOperations().plan(db,command.input,ctx);
    else if(command.type==='CalendarAction')result=calendarOperations().plan(db,command.input,ctx);
    else if(command.type==='MergeCatalog')result=mergeModule().plan(db,command.input,ctx);
    else if(command.type==='AcceptShift')result=acceptShift(db,command,ctx);
    else result=assignPerson(db,command,ctx);
    const timeOptions=command.type==='CalendarAction'&&command.input.action==='confirmInterval'?{confirm:command.input.target,reason:command.input.reason}:{};
    return {...result,sections:calendar?calendar.canonicalizeIntervals(db,result.sections,ctx,timeOptions):result.sections,readSections:dependencies(command)};
  }
  return Object.freeze({apiVersion:1 as const,parseCommand,footprint,dependencies,plan});
}
