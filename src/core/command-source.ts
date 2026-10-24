import type {AssetTarget,Identifier,JsonRow,JsonValue,SectionRows,createPlatformContracts} from './platform-contracts';

export interface CommandActor { id: string; name: string; role: string }
export interface CommandContext { id: string; now: string; today: string; actor: CommandActor; readable?:string[]; writable?:string[]; calendar?:{version:1;mode:'compatibility'|'configured';timeZone:string;stamp:string};importSource?:JsonRow }
export interface CommandPlan { sections: SectionRows; readSections: string[]; writeSections: string[]; entityIds: Record<string, Identifier> }
type Contracts=ReturnType<typeof createPlatformContracts>;
interface CommandError extends Error {code:string;status:number;field?:string}

/** Shared, storage-free input boundaries for semantic command planners. */
export function createCommandSource(contracts:Contracts){
 if(contracts?.apiVersion!==1)throw Error('Не загружены общие границы команд');
  function fail(code: string,message: string,field?: string): never {
    const error=new Error(message) as CommandError;error.name='PlatformCommandError';error.code=code;error.status=400;
    if(field!==undefined)error.field=field;throw error;
  }
  function copy(value: JsonValue): JsonValue {
    if(value===null||typeof value!=='object')return value;
    if(Array.isArray(value))return value.map(copy);
    const result:JsonRow={};for(const key of Object.keys(value))result[key]=copy(value[key] as JsonValue);return result;
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
    if(checked.importSource!==undefined){if(checked.importSource===null||typeof checked.importSource!=='object'||Array.isArray(checked.importSource))fail('INVALID_COMMAND_CONTEXT','Некорректный проверенный исходник импорта','importSource');result.importSource=copy(checked.importSource) as JsonRow;}
    if(checked.calendar!==undefined){
      const value=checked.calendar;
      if(value===null||typeof value!=='object'||Array.isArray(value)||value.version!==1||(value.mode!=='compatibility'&&value.mode!=='configured')||typeof value.timeZone!=='string'||typeof value.stamp!=='string')fail('INVALID_COMMAND_CONTEXT','Некорректный учётный календарь','calendar');
      result.calendar={version:1,mode:value.mode,timeZone:value.timeZone,stamp:value.stamp};
    }
    for(const field of ['readable','writable'] as const)if(checked[field]!==undefined){const values=checked[field];if(!Array.isArray(values)||values.some(value=>typeof value!=='string'||!value.trim()))fail('INVALID_COMMAND_CONTEXT','Некорректные полномочия команды',field);result[field]=values.slice() as string[];}
    return result;
  }
  function noId(db:SectionRows,section:string,id:string):void {
    if(rows(db,section).some(row=>row.id===id))fail('COMMAND_ID_EXISTS','Запись с идентификатором команды уже существует',section);
  }
  function stamp(row:JsonRow,ctx:CommandContext,created:boolean):void {row.updatedAt=ctx.now;if(created)row.createdAt=ctx.now;}
 return Object.freeze({apiVersion:1 as const,fail,copy,database,rows,find,live,targetFor,validDate,context,noId,stamp});
}
export type CommandSourceAPI=ReturnType<typeof createCommandSource>;
