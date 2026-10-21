export type AccountingSection = 'vehicles' | 'generators' | 'tanks';
export interface OpeningSource { org: string; grade: string; qty: number }
export interface FuelAccounting { version: 1; from: string; opening: number; basis: string; sources?: readonly OpeningSource[] }
export type ResolvedAccountingBoundary = Readonly<{mode:'legacy'}> | Readonly<FuelAccounting & {mode:'explicit'}>;
export interface AccountingWindow { status:'legacy'|'inside'|'partial'|'outside-accounting'; historyFrom:string|null; reportFrom:string|null; reportTo:string|null }
export interface AccountingBoundaryAPI {
  readonly apiVersion:1;
  resolve(section: unknown, asset: unknown): ResolvedAccountingBoundary;
  classify(boundary: unknown, date: unknown): 'current'|'historical'|'invalid-date';
  window(boundary: unknown, range?: unknown): AccountingWindow;
}
interface BoundaryError extends Error {code:string;field:string;status:number}

/** A fuel anchor only: journal distances, meters, repairs and cash are untouched. */
export function createAccountingBoundary():AccountingBoundaryAPI {
  const resolved=new WeakSet<object>(), legacy=Object.freeze({mode:'legacy' as const});resolved.add(legacy);
  const own=(value:object,key:PropertyKey):boolean=>Object.prototype.hasOwnProperty.call(value,key);
  function fail(field:string,message:string):never {const error=new Error(message) as BoundaryError;error.name='AccountingBoundaryError';error.code='INVALID_ACCOUNTING_BOUNDARY';error.field=field;error.status=400;throw error;}
  function object(value:unknown,field:string):Record<string,unknown> {
    if(value===null||typeof value!=='object'||Array.isArray(value))fail(field,'Нужен объект начала учёта ГСМ');
    const prototype:unknown=Object.getPrototypeOf(value);
    if(!(prototype===null||typeof prototype==='object'&&prototype!==null&&Object.getPrototypeOf(prototype)===null))fail(field,'Недопустимый объект начала учёта ГСМ');
    return value as Record<string,unknown>;
  }
  function fields(value:Record<string,unknown>,allowed:readonly string[],field:string):void {
    for(const key of Reflect.ownKeys(value)){
      if(typeof key!=='string'||!allowed.includes(key))fail(field,'Недопустимое поле начала учёта ГСМ');
      const descriptor=Object.getOwnPropertyDescriptor(value,key);
      if(!descriptor?.enumerable||descriptor.get||descriptor.set)fail(field+'.'+key,'Исполняемые и скрытые свойства недопустимы');
    }
  }
  function date(value:unknown):value is string {
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
    const day=new Date(value+'T12:00:00Z');return Number.isFinite(day.getTime())&&day.toISOString().slice(0,10)===value;
  }
  function text(value:unknown,field:string,max:number):string {if(typeof value!=='string'||!value.trim()||value.length>max)fail(field,'Заполните текстовое поле начала учёта ГСМ');return value;}
  function parse(value:unknown):ResolvedAccountingBoundary {
    const row=object(value,'fuelAccounting');fields(row,['version','from','opening','basis','sources'],'fuelAccounting');
    if(row.version!==1)fail('fuelAccounting.version','Версия начала учёта ГСМ не поддерживается');
    if(!date(row.from))fail('fuelAccounting.from','Укажите действительную дату начала учёта ГСМ');
    if(typeof row.opening!=='number'||!Number.isFinite(row.opening)||row.opening<0)fail('fuelAccounting.opening','Входящий остаток должен быть неотрицательным числом');
    const result:FuelAccounting & {mode:'explicit'}={mode:'explicit',version:1,from:row.from,opening:row.opening,basis:text(row.basis,'fuelAccounting.basis',4000)};
    if(own(row,'sources')){
      if(!Array.isArray(row.sources)||!row.sources.length||row.sources.length>1000)fail('fuelAccounting.sources','Укажите распределение входящего остатка');
      const sources:OpeningSource[]=[];
      for(let index=0;index<row.sources.length;index++){
        const descriptor=Object.getOwnPropertyDescriptor(row.sources,String(index));
        if(!descriptor?.enumerable||descriptor.get||descriptor.set)fail('fuelAccounting.sources','Недопустимое распределение входящего остатка');
        const source=object(descriptor.value,'fuelAccounting.sources');fields(source,['org','grade','qty'],'fuelAccounting.sources');
        if(typeof source.qty!=='number'||!Number.isFinite(source.qty)||source.qty<0)fail('fuelAccounting.sources.qty','Литры источника должны быть неотрицательным числом');
        const grade=text(source.grade,'fuelAccounting.sources.grade',50);
        if(!['ДТ','Газ','Бензин','АИ-92','АИ-95','АИ-98','АИ-100'].includes(grade))fail('fuelAccounting.sources.grade','Выберите известную марку входящего топлива');
        sources.push(Object.freeze({org:text(source.org,'fuelAccounting.sources.org',500),grade,qty:source.qty}));
      }
      if(Reflect.ownKeys(row.sources).some(key=>key!=='length'&&(typeof key!=='string'||!/^(?:0|[1-9]\d*)$/.test(key)||Number(key)>=sources.length)))fail('fuelAccounting.sources','Недопустимые поля распределения');
      const sum=sources.reduce((total,source)=>total+source.qty,0);
      if(!Number.isFinite(sum)||Math.abs(sum-result.opening)>0.001000001)fail('fuelAccounting.sources','Сумма источников не совпадает с входящим остатком');
      result.sources=Object.freeze(sources);
    }
    const output=Object.freeze(result);resolved.add(output);return output;
  }
  function resolve(section:unknown,asset:unknown):ResolvedAccountingBoundary {
    if(!['vehicles','generators','tanks'].includes(section as string))fail('section','Начало учёта доступно для транспорта, ДЭС и ёмкостей');
    const row=object(asset,'asset'),descriptor=Object.getOwnPropertyDescriptor(row,'fuelAccounting');
    if(!descriptor)return legacy;
    if(!descriptor.enumerable||descriptor.get||descriptor.set)fail('fuelAccounting','Недопустимые свойства начала учёта ГСМ');
    return parse(descriptor.value);
  }
  function boundary(value:unknown):ResolvedAccountingBoundary {
    if(value!==null&&typeof value==='object'&&resolved.has(value))return value as ResolvedAccountingBoundary;
    const row=object(value,'boundary');fields(row,['mode','version','from','opening','basis','sources'],'boundary');
    if(row.mode==='legacy'&&Object.keys(row).length===1)return legacy;
    if(row.mode!=='explicit')fail('boundary.mode','Не определён режим начала учёта ГСМ');
    const clone:Record<string,unknown>={};for(const key of Object.keys(row))if(key!=='mode')clone[key]=row[key];return parse(clone);
  }
  function classify(value:unknown,day:unknown):'current'|'historical'|'invalid-date' {
    const anchor=boundary(value);if(!date(day))return 'invalid-date';return anchor.mode==='legacy'||day>=anchor.from?'current':'historical';
  }
  function window(value:unknown,query:unknown={}):AccountingWindow {
    const anchor=boundary(value),range=object(query,'range');fields(range,['from','to'],'range');
    const from=range.from==null||range.from===''?null:range.from,to=range.to==null||range.to===''?null:range.to;
    if(from!==null&&!date(from)||to!==null&&!date(to)||typeof from==='string'&&typeof to==='string'&&from>to)fail('range','Проверьте период расчёта ГСМ');
    const first=from as string|null,last=to as string|null;
    if(anchor.mode==='legacy')return {status:'legacy',historyFrom:null,reportFrom:first,reportTo:last};
    if(last!==null&&last<anchor.from)return {status:'outside-accounting',historyFrom:null,reportFrom:null,reportTo:null};
    return {status:first!==null&&first<anchor.from?'partial':'inside',historyFrom:anchor.from,reportFrom:first===null||first<anchor.from?anchor.from:first,reportTo:last};
  }
  return Object.freeze({apiVersion:1 as const,resolve,classify,window});
}
