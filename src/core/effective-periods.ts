import type {DecimalCoreAPI} from './decimal-core';
export type PeriodSection='vehicles'|'generators'|'costProfiles'|'fuelCards';
export type PeriodKind='fuelNorms'|'ratePeriods'|'orgHistory';
export type PeriodId=string|number;
export type PeriodParameters=Readonly<Record<string,number|null>>;
export interface EffectivePeriod {readonly id:PeriodId;readonly from:string;readonly basis:string;readonly parameters:PeriodParameters}
export interface PeriodContainer {readonly version:1;readonly periods:readonly EffectivePeriod[]}
export interface OrganizationPeriod {readonly from:string;readonly to:string;readonly org:string;readonly basis?:string}
export type ValidatedPeriods=PeriodContainer|readonly OrganizationPeriod[]|Readonly<{mode:'legacy'}>;
export interface PeriodResolution {
  readonly mode:'legacy'|'dated';readonly status:'known'|'missing';
  readonly parameters:Readonly<Record<string,number|string|null>>|null;
  readonly periodId?:PeriodId;readonly from?:string|null;readonly toExclusive?:string|null;
  readonly basis?:string;readonly sourceIndex?:number;readonly reason?:'before-first'|'gap'|'ambiguous';
}
export interface PeriodProjection {readonly status:'known'|'missing';readonly parameters:Readonly<Record<string,number|string|null>>|null}
export interface EffectivePeriodsAPI {
  readonly apiVersion:1;
  validate(section:unknown,row:unknown,kind:unknown):ValidatedPeriods;
  resolve(section:unknown,row:unknown,date:unknown,kind:unknown):PeriodResolution;
  projection(section:unknown,row:unknown,date:unknown,kind:unknown):PeriodProjection;
}
interface PeriodError extends Error {code:string;field:string;status:number}

/** Dates are supplied by the caller. This module has no clock or mutable mode. */
export function createEffectivePeriods(decimal?:Readonly<DecimalCoreAPI>):EffectivePeriodsAPI {
  const own=(value:object,key:PropertyKey):boolean=>Object.prototype.hasOwnProperty.call(value,key);
  const legacy=Object.freeze({mode:'legacy' as const}),validatedContainers=new WeakMap<object,string>();
  const keysBySection:Readonly<Record<string,readonly string[]>>=Object.freeze({
    vehicles:Object.freeze(['norm','normCity','normHighway','normIdle']),
    generators:Object.freeze(['power','norm','norm100','norm50','normIdle']),
    costProfiles:Object.freeze(['salaryRate','depreciationRate','fuelRate','fuelPrice']),
  });
  function fail(field:string,message:string,code='INVALID_PERIODS'):never {const error=new Error(message) as PeriodError;error.name='EffectivePeriodError';error.code=code;error.field=field;error.status=400;throw error;}
  function object(value: unknown,field:string):Record<string,unknown> {
    if(value===null||typeof value!=='object'||Array.isArray(value))fail(field,'Нужен объект истории параметров');
    const prototype:unknown=Object.getPrototypeOf(value);
    if(!(prototype===null||typeof prototype==='object'&&prototype!==null&&Object.getPrototypeOf(prototype)===null))fail(field,'Недопустимый объект истории');
    return value as Record<string,unknown>;
  }
  function fields(value:Record<string,unknown>,allowed:readonly string[],field:string):void {
    for(const key of Reflect.ownKeys(value)){
      if(typeof key!=='string'||!allowed.includes(key))fail(field,'Недопустимое поле истории');
      const descriptor=Object.getOwnPropertyDescriptor(value,key);
      if(!descriptor?.enumerable||descriptor.get||descriptor.set)fail(field+'.'+key,'Исполняемые и скрытые поля истории недопустимы');
    }
  }
  function array(value:unknown,field:string):readonly unknown[] {
    if(!Array.isArray(value)||value.length>1000)fail(field,'История должна содержать не более 1000 периодов');
    for(const key of Reflect.ownKeys(value))if(key!=='length'&&(typeof key!=='string'||!/^(?:0|[1-9]\d*)$/.test(key)||Number(key)>=value.length))fail(field,'Недопустимые поля списка истории');
    const result:unknown[]=[];
    for(let index=0;index<value.length;index++){const descriptor=Object.getOwnPropertyDescriptor(value,String(index));if(!descriptor?.enumerable||descriptor.get||descriptor.set)fail(field,'Недопустимые элементы истории');result.push(descriptor.value);}
    return result;
  }
  function validDate(value:unknown):value is string {
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'1900-01-01')return false;
    const date=new Date(value+'T12:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
  }
  function identifier(value:unknown,field:string):PeriodId {
    if(typeof value==='number'&&Number.isFinite(value)||typeof value==='string'&&value.trim()&&value.length<=200&&!['__proto__','constructor','prototype'].includes(value))return value;
    return fail(field,'Укажите устойчивый ID периода');
  }
  function text(value:unknown,field:string,required:boolean,max=4000):string {if(typeof value!=='string'||value.length>max||required&&!value.trim())fail(field,'Заполните основание или организацию периода');return value;}
  function contract(section:unknown,kind:unknown):{section:PeriodSection;kind:PeriodKind;fields:readonly string[]} {
    if(kind==='orgHistory'&&(section==='vehicles'||section==='fuelCards'))return {section,kind,fields:['org']};
    if(kind==='fuelNorms'&&(section==='vehicles'||section==='generators')||kind==='ratePeriods'&&section==='costProfiles')return {section,kind,fields:keysBySection[section]!};
    return fail('kind','История недоступна для этого раздела');
  }
  function descriptor(row:Record<string,unknown>,kind:PeriodKind):PropertyDescriptor|undefined {
    const value=Object.getOwnPropertyDescriptor(row,kind);if(value&&(!value.enumerable||value.get||value.set))fail(kind,'Исполняемая история недопустима');return value;
  }
  function validate(section:unknown,value:unknown,kind:unknown):ValidatedPeriods {
    const spec=contract(section,kind),row=object(value,'row'),input=descriptor(row,spec.kind);
    if(!input)return legacy;
    const contractKey=spec.section+'.'+spec.kind;
    if(input.value!==null&&typeof input.value==='object'&&validatedContainers.get(input.value as object)===contractKey)return input.value as PeriodContainer|readonly OrganizationPeriod[];
    if(spec.kind==='orgHistory'){
      const entries=array(input.value,'orgHistory');if(!entries.length)return legacy;
      const result=Object.freeze(entries.map((entry,index)=>{
        const item=object(entry,'orgHistory.'+index);fields(item,['from','to','org','basis'],'orgHistory.'+index);
        const from=item.from??'',to=item.to??'';
        if(from!==''&&!validDate(from)||to!==''&&!validDate(to)||typeof from!=='string'||typeof to!=='string'||from&&to&&from>to)fail('orgHistory.'+index,'Некорректный период организации');
        const result:OrganizationPeriod={from,to,org:text(item.org,'orgHistory.'+index+'.org',true,500)};
        if(own(item,'basis'))return Object.freeze({...result,basis:text(item.basis,'orgHistory.'+index+'.basis',false)});
        return Object.freeze(result);
      }));validatedContainers.set(result,contractKey);return result;
    }
    const container=object(input.value,spec.kind);fields(container,['version','periods'],spec.kind);
    if(container.version!==1)fail(spec.kind+'.version','Неизвестная версия истории');
    const entries=array(container.periods,spec.kind+'.periods');if(!entries.length)fail(spec.kind+'.periods','Добавьте хотя бы один датированный период');
    if(decimal?.apiVersion!==1)fail(spec.kind,'Не загружена десятичная арифметика','MODULE_UNAVAILABLE');
    const ids=new Set<PeriodId>(),dates=new Set<string>(),periods:EffectivePeriod[]=[];
    entries.forEach((entry,index)=>{
      const path=spec.kind+'.periods.'+index,item=object(entry,path);fields(item,['id','from','basis','parameters'],path);
      const id=identifier(item.id,path+'.id');if(ids.has(id))fail(path+'.id','Повторный ID периода');ids.add(id);
      if(!validDate(item.from)||dates.has(item.from))fail(path+'.from','Нужна действительная уникальная дата начала');dates.add(item.from);
      const parameters=object(item.parameters,path+'.parameters');fields(parameters,spec.fields,path+'.parameters');
      const output:Record<string,number|null>={};
      for(const key of spec.fields){
        if(!own(parameters,key))fail(path+'.parameters.'+key,'Нужен полный снимок параметров, включая неизвестные значения');
        const number=parameters[key];if(number===null){output[key]=null;continue;}
        if(typeof number!=='number')fail(path+'.parameters.'+key,'Параметр должен быть числом или null');
        try{decimal.parse(number,{scale:6,max:1e12,nonNegative:true});decimal.toNumberExact(number);}catch(error){fail(path+'.parameters.'+key,error instanceof Error?error.message:'Неверный параметр');}
        output[key]=number;
      }
      periods.push(Object.freeze({id,from:item.from,basis:text(item.basis,path+'.basis',true),parameters:Object.freeze(output)}));
    });
    periods.sort((a,b)=>a.from.localeCompare(b.from));const result=Object.freeze({version:1 as const,periods:Object.freeze(periods)});validatedContainers.set(result,contractKey);return result;
  }
  function legacyParameters(section:PeriodSection,row:Record<string,unknown>,kind:PeriodKind):Readonly<Record<string,number|string|null>> {
    if(kind==='orgHistory'){const descriptor=Object.getOwnPropertyDescriptor(row,'org');if(descriptor?.get||descriptor?.set)fail('org','Исполняемый параметр недопустим');return Object.freeze({org:typeof descriptor?.value==='string'?descriptor.value:''});}
    const result:Record<string,number|null>={};for(const key of keysBySection[section]||[]){
      const raw=Object.getOwnPropertyDescriptor(row,key);if(raw?.get||raw?.set)fail(key,'Исполняемый параметр недопустим');const value:unknown=raw?.value;
      result[key]=(typeof value==='number'||typeof value==='string'&&value.trim())&&Number.isFinite(Number(value))?Number(value):null;
    }return Object.freeze(result);
  }
  function resolve(section:unknown,value:unknown,day:unknown,kind:unknown):PeriodResolution {
    const spec=contract(section,kind);if(!validDate(day))fail('date','Нужна действительная дата разрешения параметров','INVALID_DATE');
    const row=object(value,'row'),validated=validate(section,row,kind);
    if('mode' in validated)return Object.freeze({mode:'legacy',status:'known',parameters:legacyParameters(spec.section,row,spec.kind)});
    if(spec.kind==='orgHistory'){
      const entries=validated as readonly OrganizationPeriod[],matches=entries.map((entry,index)=>({entry,index})).filter(({entry})=>(!entry.from||entry.from<=day)&&(!entry.to||entry.to>=day));
      if(matches.length!==1)return Object.freeze({mode:'dated',status:'missing',parameters:null,reason:matches.length?'ambiguous':'gap'});
      const selected=matches[0]!,entry=selected.entry;
      const until=entry.to&&entry.to!=='9999-12-31'?new Date(new Date(entry.to+'T12:00:00Z').getTime()+86400000).toISOString().slice(0,10):null;
      return Object.freeze({mode:'dated',status:'known',parameters:Object.freeze({org:entry.org}),sourceIndex:selected.index,from:entry.from||null,toExclusive:until,...(entry.basis===undefined?{}:{basis:entry.basis})});
    }
    const periods=(validated as PeriodContainer).periods;let selected=-1;
    periods.forEach((period,index)=>{if(period.from<=day)selected=index;});
    if(selected<0)return Object.freeze({mode:'dated',status:'missing',parameters:null,reason:'before-first'});
    const period=periods[selected]!;
    return Object.freeze({mode:'dated',status:'known',parameters:period.parameters,periodId:period.id,from:period.from,toExclusive:periods[selected+1]?.from??null,basis:period.basis});
  }
  function projection(section:unknown,row:unknown,day:unknown,kind:unknown):PeriodProjection {
    const selected=resolve(section,row,day,kind),values=selected.parameters?Object.values(selected.parameters):[];
    if(!values.length||values.every(value=>value===null)||kind==='orgHistory'&&typeof selected.parameters?.org==='string'&&!selected.parameters.org.trim())return Object.freeze({status:'missing',parameters:null});
    return Object.freeze({status:selected.status,parameters:selected.parameters});
  }
  return Object.freeze({apiVersion:1 as const,validate,resolve,projection});
}
