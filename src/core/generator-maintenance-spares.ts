import type {Identifier,JsonRow,JsonValue} from './platform-contracts';
import type {DecimalCoreAPI} from './decimal-core';

interface Contracts {apiVersion:number;identifier(value:unknown):value is Identifier}
export interface MaintenanceSparesSource {rowId:Identifier;site:string;type:string;plannedDate:string;qtyDecimal:string|null}
export interface MaintenanceSparesItem {partId:Identifier;article:string;name:string;unit:string;qtyDecimal:string|null;qty:number|null;sources:MaintenanceSparesSource[]}
export interface MaintenanceSparesGenerator {id:Identifier;name:string;sites:string[];items:MaintenanceSparesItem[]}
export interface MaintenanceSparesDistribution {id:Identifier;name:string;qtyDecimal:string|null;qty:number|null;partIds:Identifier[]}
export interface MaintenanceSparesOrganization {article:string;name:string;unit:string;qtyDecimal:string|null;qty:number|null;generators:MaintenanceSparesDistribution[];positions:{generatorId:Identifier;partId:Identifier}[]}
export interface MaintenanceSparesIssue {severity:'warning';code:string;message:string;rowId?:Identifier;generatorId?:Identifier;partId?:Identifier;article?:string;name?:string;unit?:string}
export interface MaintenanceSparesProjection {version:1;generators:MaintenanceSparesGenerator[];organization:MaintenanceSparesOrganization[];issues:MaintenanceSparesIssue[];warnings:MaintenanceSparesIssue[]}
interface SparesError extends Error {code:string;status:number}

/** Exact planned demand from an already prepared print snapshot. It never
 * reads stock or live cards and creates neither a reservation nor an issue. */
export function createGeneratorMaintenanceSpares(contracts:Contracts,decimal:Readonly<DecimalCoreAPI>){
 function fail(code:string,message:string):never {const error=new Error(message) as SparesError;error.name='GeneratorMaintenanceSparesError';error.code=code;error.status=400;throw error;}
 if(contracts?.apiVersion!==1||decimal?.apiVersion!==1)fail('MODULE_UNAVAILABLE','Не загружены правила приложения ЗИП');
 const object=(value:unknown):value is JsonRow=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 function safe(value:unknown):JsonValue {
  const parents=new Set<object>();let nodes=0;
  function visit(item:unknown,depth:number):JsonValue {
   if(++nodes>1000000||depth>100)fail('SPARES_SNAPSHOT_LIMIT','Слишком большой снимок приложения ЗИП');
   if(item===null||typeof item==='string'||typeof item==='boolean'||typeof item==='number'&&Number.isFinite(item))return item;
   if(item===null||typeof item!=='object'||parents.has(item))fail('SPARES_SNAPSHOT_JSON','Нужны конечные JSON-значения без циклов');
   const array=Array.isArray(item),prototype:unknown=Object.getPrototypeOf(item);
   if(!array&&!(prototype===null||typeof prototype==='object'&&prototype!==null&&Object.getPrototypeOf(prototype)===null))fail('SPARES_SNAPSHOT_JSON','Недопустимый объект снимка ЗИП');
   parents.add(item);
   for(const key of Reflect.ownKeys(item)){
    if(array&&key==='length')continue;const descriptor=Object.getOwnPropertyDescriptor(item,key);
    if(typeof key!=='string'||!descriptor?.enumerable||descriptor.get||descriptor.set||['toJSON','__proto__','constructor','prototype'].includes(key)||array&&(!/^(?:0|[1-9]\d*)$/.test(key)||Number(key)>=item.length))fail('SPARES_SNAPSHOT_JSON','Исполняемые, скрытые и неизвестные свойства запрещены');
   }
   let result:JsonValue;
   if(array){if(item.length>200000)fail('SPARES_SNAPSHOT_LIMIT','Слишком много строк ЗИП');const output:JsonValue[]=[];for(let index=0;index<item.length;index++){const descriptor=Object.getOwnPropertyDescriptor(item,String(index));if(!descriptor)fail('SPARES_SNAPSHOT_JSON','Пропуск элемента массива ЗИП');output.push(visit(descriptor.value,depth+1));}result=output;}
   else {const output:JsonRow={};for(const key of Object.keys(item))output[key]=visit(Object.getOwnPropertyDescriptor(item,key)!.value,depth+1);result=output;}
   parents.delete(item);return result;
  }
  return visit(value,0);
 }
 function row(value:unknown):JsonRow {if(!object(value))fail('SPARES_SNAPSHOT_SHAPE','Нужен объект строки приложения ЗИП');return value;}
 function id(value:unknown):Identifier {if(!contracts.identifier(value))fail('SPARES_SNAPSHOT_ID','Нужен устойчивый типизированный ID снимка ЗИП');return value;}
 function text(value:unknown):string {if(typeof value!=='string')fail('SPARES_SNAPSHOT_TEXT','Реквизит приложения ЗИП должен быть текстом');return value.trim();}
 function quantity(value:unknown):string|null {if(value===null)return null;if(typeof value!=='number'||!Number.isFinite(value)||value<0)fail('SPARES_SNAPSHOT_QUANTITY','Количество ЗИП должно быть неотрицательным числом или явно неизвестным null');return decimal.parse(value,{nonNegative:true});}
 function freeze<T>(value:T):T {if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const nested of Object.values(value))freeze(nested);Object.freeze(value);}return value;}
 const add=(left:string|null,right:string|null):string|null=>left===null||right===null?null:decimal.add(left,right);
 const metadata=(value:{article:string;name:string;unit:string}):string=>JSON.stringify([value.article,value.name,value.unit]);
 function project(value:unknown):MaintenanceSparesProjection {
  const snapshot=row(safe(value));if(snapshot.version!==1||!Array.isArray(snapshot.rows))fail('SPARES_SNAPSHOT_VERSION','Нужен подготовленный снимок графика ТО версии 1');
  const generators:MaintenanceSparesGenerator[]=[],byGenerator=new Map<Identifier,MaintenanceSparesGenerator>(),itemsByGenerator=new Map<Identifier,Map<Identifier,MaintenanceSparesItem>>(),partOwners=new Map<Identifier,Identifier>(),seenRows=new Set<Identifier>(),warnings:MaintenanceSparesIssue[]=[];
  const exactNumber=(qtyDecimal:string|null,reference:Partial<MaintenanceSparesIssue>):number|null=>{if(qtyDecimal===null)return null;try{return decimal.toNumberExact(qtyDecimal);}catch{warnings.push({severity:'warning',code:'SPARES_TOTAL_NUMBER_RANGE',message:'Точное количество сохранено десятичной строкой; обычное число потеряло бы точность или вышло бы за пределы диапазона',...reference});return null;}};
  for(const raw of snapshot.rows){
   const entry=row(raw),rowId=id(entry.id),generatorId=id(entry.generatorId);if(seenRows.has(rowId))fail('SPARES_SNAPSHOT_ROW_DUPLICATE','ID строки ТО повторяется; потребность нельзя посчитать однозначно');seenRows.add(rowId);
   const generator=row(entry.generator);if(id(generator.id)!==generatorId)fail('SPARES_SNAPSHOT_BINDING','Снимок ДЭС противоречит типизированной строке графика');
   const generatorName=text(generator.name),site=text(entry.site),type=text(entry.type),plannedDate=text(entry.plannedDate);
   let selected=byGenerator.get(generatorId),items=itemsByGenerator.get(generatorId);
   if(!selected){selected={id:generatorId,name:generatorName,sites:[],items:[]};items=new Map<Identifier,MaintenanceSparesItem>();byGenerator.set(generatorId,selected);itemsByGenerator.set(generatorId,items);generators.push(selected);}
   else if(selected.name!==generatorName)fail('SPARES_SNAPSHOT_GENERATOR_CONFLICT','Одна ДЭС имеет противоречивые реквизиты в снимке');
   if(!selected.sites.includes(site))selected.sites.push(site);
   if(!Array.isArray(entry.components))fail('SPARES_SNAPSHOT_COMPONENTS','Нужен список комплектующих строки ТО');const seenParts=new Set<Identifier>();
   for(const rawComponent of entry.components){
    const component=row(rawComponent),partId=id(component.partId);if(seenParts.has(partId))fail('SPARES_SNAPSHOT_PART_DUPLICATE','Одна позиция ЗИП повторяется внутри строки ТО');seenParts.add(partId);
    const part=row(component.part);if(id(part.id)!==partId||id(part.generatorId)!==generatorId)fail('SPARES_SNAPSHOT_BINDING','Позиция ЗИП должна принадлежать той же ДЭС и сохранять тип ID');
    if(partOwners.has(partId)&&partOwners.get(partId)!==generatorId)fail('SPARES_SNAPSHOT_BINDING','Один типизированный ID позиции не может принадлежать двум ДЭС');partOwners.set(partId,generatorId);
    const fields={article:text(part.article),name:text(part.name),unit:text(part.unit)},qtyDecimal=quantity(component.qty);let item=items!.get(partId);
    if(!item){item={partId,...fields,qtyDecimal:'0',qty:0,sources:[]};items!.set(partId,item);selected.items.push(item);}
    else if(metadata(item)!==metadata(fields))fail('SPARES_SNAPSHOT_PART_CONFLICT','Одна складская позиция имеет противоречивые наименование, артикул или единицу');
    item.qtyDecimal=add(item.qtyDecimal,qtyDecimal);item.sources.push({rowId,site,type,plannedDate,qtyDecimal});
    if(qtyDecimal===null)warnings.push({severity:'warning',code:'SPARES_QUANTITY_UNKNOWN',message:'Плановое количество комплектующей неизвестно; итог по ней не заменён нулём',rowId,generatorId,partId});
   }
  }
  const organization:MaintenanceSparesOrganization[]=[],byMetadata=new Map<string,MaintenanceSparesOrganization>(),articles=new Map<string,Set<string>>();
  for(const generator of generators)for(const item of generator.items){
   item.qty=exactNumber(item.qtyDecimal,{generatorId:generator.id,partId:item.partId});
   // Incomplete identifying metadata is not a matching rule. The physical
   // stock position remains separate whenever any matching field is blank.
   const key=item.article&&item.name&&item.unit?'article:'+metadata(item):'position:'+JSON.stringify([typeof generator.id,generator.id,typeof item.partId,item.partId]);
   let group=byMetadata.get(key);if(!group){group={article:item.article,name:item.name,unit:item.unit,qtyDecimal:'0',qty:0,generators:[],positions:[]};byMetadata.set(key,group);organization.push(group);}
   group.qtyDecimal=add(group.qtyDecimal,item.qtyDecimal);group.positions.push({generatorId:generator.id,partId:item.partId});
   let distribution=group.generators.find(value=>value.id===generator.id);if(!distribution){distribution={id:generator.id,name:generator.name,qtyDecimal:'0',qty:0,partIds:[]};group.generators.push(distribution);}
   distribution.qtyDecimal=add(distribution.qtyDecimal,item.qtyDecimal);distribution.partIds.push(item.partId);
   if(item.article){const variants=articles.get(item.article)||new Set<string>();variants.add(metadata(item));articles.set(item.article,variants);}
  }
  for(const group of organization){group.qty=exactNumber(group.qtyDecimal,{article:group.article,name:group.name,unit:group.unit});for(const generator of group.generators)generator.qty=exactNumber(generator.qtyDecimal,{generatorId:generator.id,article:group.article,name:group.name,unit:group.unit});}
  for(const [article,variants]of articles)if(variants.size>1)warnings.push({severity:'warning',code:'SPARES_ARTICLE_CONFLICT',message:'Один артикул имеет разные наименования или единицы измерения. Потребность оставлена отдельными строками',article});
  return freeze({version:1 as const,generators,organization,issues:[],warnings});
 }
 return Object.freeze({apiVersion:1 as const,project});
}
export type GeneratorMaintenanceSparesAPI=ReturnType<typeof createGeneratorMaintenanceSpares>;
