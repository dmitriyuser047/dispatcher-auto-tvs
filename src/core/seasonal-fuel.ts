import type {DecimalCoreAPI} from './decimal-core';
import type {EffectivePeriodsAPI,EffectivePeriod,PeriodContainer,PeriodParameters,PeriodResolution} from './effective-periods';

export type SeasonalSection='vehicles'|'generators';
export type FuelSeason='summer'|'winter';
export type SeasonalAssetId=string|number;
export type VehicleSeasonParameters=Readonly<Record<'norm'|'normCity'|'normHighway'|'normIdle',number|null>>;
export type GeneratorSeasonParameters=Readonly<Record<'norm'|'norm100'|'norm50'|'normIdle',number|null>>;
export type SeasonParameters=VehicleSeasonParameters|GeneratorSeasonParameters;
export interface FuelSeasons {readonly version:1;readonly summer:SeasonParameters|null;readonly winter:SeasonParameters|null}
export interface SeasonalIssue {readonly code:string;readonly message:string;readonly field?:string;readonly id?:SeasonalAssetId;readonly section?:SeasonalSection;readonly recordId?:SeasonalAssetId;readonly date?:string;readonly beforeValue?:number|null;readonly afterValue?:number|null;readonly sourceRef?:Readonly<{section:'genRecords';id:SeasonalAssetId}>}
export interface SeasonalRequest {readonly section:SeasonalSection;readonly season:FuelSeason;readonly from:string;readonly basis:string;readonly operationId:string}
export interface SeasonalChange {
  readonly id:SeasonalAssetId;readonly label:string;readonly action:'add'|'replace';readonly before:PeriodContainer|null;readonly after:PeriodContainer;
  readonly baselineAdded:boolean;readonly parametersBefore:PeriodParameters|null;readonly parametersAfter:PeriodParameters;
  readonly periodBefore:EffectivePeriod|null;readonly periodAfter:EffectivePeriod;readonly toExclusive:string|null;
}
export interface SeasonalPreview extends SeasonalRequest {
  readonly canApply:boolean;readonly issues:readonly SeasonalIssue[];readonly warnings:readonly SeasonalIssue[];readonly changes:readonly SeasonalChange[];
  readonly counts:Readonly<{total:number;active:number;excluded:number;changed:number;unchanged:number;blocked:number}>;
}
export interface CurrentFuelSeason {
  readonly season:FuelSeason|null;readonly status:'seasonal'|'custom'|'missing';readonly from:string|null;readonly toExclusive:string|null;
  readonly periodId:SeasonalAssetId|null;readonly parameters:PeriodParameters|null;
}
export interface SeasonalFuelAPI {
  readonly apiVersion:1;
  validateProfiles(section:unknown,asset:unknown):FuelSeasons|undefined;
  prepare(database:unknown,input:unknown):SeasonalPreview;
  currentSeason(section:unknown,asset:unknown,date:unknown):CurrentFuelSeason;
  historicalIssues(section:unknown,beforeAsset:unknown,afterAsset:unknown,beforeRecords:unknown,afterRecords:unknown,beforeDate:unknown):readonly SeasonalIssue[];
}
export interface SeasonalGeneratorAPI {readonly apiVersion:1;generatorSpent(generator:unknown,record:unknown):number|null}
interface SeasonalError extends Error {code:string;field:string;status:number}
const MIN_DATE='1900-01-01';
const BASELINE_BASIS='Прежние нормы карточки до сезонного перехода';

/** A reviewed change of dated parameters. No clock, mutable mode or source writes. */
export function createSeasonalFuel(decimal:Readonly<DecimalCoreAPI>,periods:Readonly<EffectivePeriodsAPI>,getGenerator?:()=>Readonly<SeasonalGeneratorAPI>|undefined):SeasonalFuelAPI {
  const keys:Readonly<Record<SeasonalSection,readonly string[]>>={vehicles:['norm','normCity','normHighway','normIdle'],generators:['norm','norm100','norm50','normIdle']};
  function fail(field:string,message:string,code='INVALID_SEASON_PROFILE'):never {const error=new Error(message) as SeasonalError;error.name='SeasonalFuelError';error.code=code;error.field=field;error.status=400;throw error;}
  if(decimal?.apiVersion!==1||periods?.apiVersion!==1)fail('module','Не загружены десятичная арифметика и датированные параметры','MODULE_UNAVAILABLE');
  function section(value:unknown):SeasonalSection {if(value==='vehicles'||value==='generators')return value;return fail('section','Сезонные нормы доступны отдельно для транспорта и ДЭС','INVALID_SEASON_SECTION');}
  function object(value:unknown,field:string):Record<string,unknown> {
    if(!value||typeof value!=='object'||Array.isArray(value))fail(field,'Нужен объект сезонных норм');
    const prototype:unknown=Object.getPrototypeOf(value);if(!(prototype===null||typeof prototype==='object'&&prototype!==null&&Object.getPrototypeOf(prototype)===null))fail(field,'Недопустимый объект сезонных норм');
    return value as Record<string,unknown>;
  }
  function read(row:Record<string,unknown>,key:string,field=key):unknown {const descriptor=Object.getOwnPropertyDescriptor(row,key);if(descriptor&&(!descriptor.enumerable||descriptor.get||descriptor.set))fail(field,'Исполняемые и скрытые свойства недопустимы');return descriptor?.value;}
  function fields(row:Record<string,unknown>,allowed:readonly string[],field:string):void {for(const key of Reflect.ownKeys(row)){if(typeof key!=='string'||!allowed.includes(key))fail(field,'Неизвестное поле сезонных норм');read(row,key,field+'.'+key);}}
  function identifier(value:unknown,field:string):SeasonalAssetId {if(typeof value==='number'&&Number.isFinite(value)||typeof value==='string'&&value.trim()&&value.length<=200&&!['__proto__','constructor','prototype'].includes(value))return value;return fail(field,'Укажите устойчивый ID техники','SEASON_ASSET_ID');}
  function validDate(value:unknown):value is string {if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<MIN_DATE)return false;const date=new Date(value+'T12:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;}
  function parameter(value:unknown,field:string):number|null {
    if(value===null)return null;if(typeof value!=='number')return fail(field,'Норма должна быть числом или явно неизвестным значением null');
    try{decimal.parse(value,{scale:6,max:1e12,nonNegative:true});decimal.toNumberExact(value);}catch(error){fail(field,error instanceof Error?error.message:'Некорректная норма');}return value;
  }
  function profile(kind:SeasonalSection,value:unknown,field:string):SeasonParameters|null {
    if(value===null)return null;const input=object(value,field);fields(input,keys[kind],field);const result:Record<string,number|null>={};
    for(const key of keys[kind]){if(!Object.prototype.hasOwnProperty.call(input,key))fail(field+'.'+key,'Укажите полный снимок норм, включая неизвестные значения');result[key]=parameter(read(input,key),field+'.'+key);}
    return Object.freeze(result) as SeasonParameters;
  }
  function validateProfiles(value:unknown,asset:unknown):FuelSeasons|undefined {
    const kind=section(value),row=object(asset,'asset');if(!Object.prototype.hasOwnProperty.call(row,'fuelSeasons'))return undefined;
    const input=object(read(row,'fuelSeasons'),'fuelSeasons');fields(input,['version','summer','winter'],'fuelSeasons');
    if(read(input,'version')!==1)fail('fuelSeasons.version','Неизвестная версия сезонных профилей');
    for(const season of ['summer','winter'])if(!Object.prototype.hasOwnProperty.call(input,season))fail('fuelSeasons.'+season,'Укажите профиль или null');
    return Object.freeze({version:1 as const,summer:profile(kind,read(input,'summer'),'fuelSeasons.summer'),winter:profile(kind,read(input,'winter'),'fuelSeasons.winter')});
  }
  function snapshot(kind:SeasonalSection,resolution:PeriodResolution):PeriodParameters|null {
    if(resolution.status!=='known'||!resolution.parameters)return null;const output:Record<string,number|null>={};
    for(const key of kind==='generators'?['power',...keys[kind]]:keys[kind])output[key]=parameter(resolution.parameters[key],key);
    return Object.freeze(output);
  }
  function seasonFromId(id:unknown):FuelSeason|null {return typeof id==='string'&&id.startsWith('fuel-season:summer:')?'summer':typeof id==='string'&&id.startsWith('fuel-season:winter:')?'winter':null;}
  function currentSeason(value:unknown,asset:unknown,date:unknown):CurrentFuelSeason {
    const kind=section(value),selected=periods.resolve(kind,asset,date,'fuelNorms'),season=seasonFromId(selected.periodId);
    return Object.freeze({season,status:selected.status==='missing'?'missing':season?'seasonal':'custom',from:selected.from??null,toExclusive:selected.toExclusive??null,periodId:selected.periodId??null,parameters:selected.mode==='legacy'?legacySnapshot(kind,object(asset,'asset'),selected):snapshot(kind,selected)});
  }
  function request(value:unknown):SeasonalRequest {
    const input=object(value,'request');fields(input,['section','season','from','basis','operationId'],'request');const kind=section(read(input,'section')),season=read(input,'season'),from=read(input,'from'),basis=read(input,'basis'),operationId=read(input,'operationId');
    if(season!=='summer'&&season!=='winter')fail('season','Выберите летние или зимние нормы','INVALID_SEASON_REQUEST');
    if(!validDate(from))fail('from','Укажите действительную дату применения не раньше 01.01.1900','INVALID_SEASON_REQUEST');
    if(typeof basis!=='string'||!basis.trim()||basis.length>4000)fail('basis','Укажите основание применения норм','INVALID_SEASON_REQUEST');
    if(typeof operationId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(operationId))fail('operationId','Нужен устойчивый ID операции до 160 символов','INVALID_SEASON_REQUEST');
    return {section:kind,season,from,basis,operationId};
  }
  function legacySnapshot(kind:SeasonalSection,asset:Record<string,unknown>,selected:PeriodResolution):PeriodParameters {
    const output:Record<string,number|null>={};
    for(const key of kind==='generators'?['power',...keys[kind]]:keys[kind]){
      const value=read(asset,key);if(value==null||typeof value==='string'&&!value.trim()){output[key]=null;continue;}
      try{output[key]=decimal.toNumberExact(decimal.parse(value,{scale:6,max:1e12,nonNegative:true}));}catch{fail(key,'Прежняя норма или мощность не представима в датированной истории без изменения. Сверьте исходное значение','SEASON_LEGACY_INVALID');}
      if(selected.parameters?.[key]!==output[key])fail(key,'Прежние параметры не совпадают с разрешёнными значениями','SEASON_LEGACY_INVALID');
    }
    return Object.freeze(output);
  }
  function sameParameters(left:PeriodParameters|null,right:PeriodParameters):boolean {return !!left&&Object.keys(right).every(key=>left[key]===right[key]);}
  function physicalAsset(row:Record<string,unknown>):Record<string,unknown> {
    const output:Record<string,unknown>={};for(const key of ['id','power','norm','norm100','norm50','normIdle','fuelNorms'])if(Object.prototype.hasOwnProperty.call(row,key))output[key]=read(row,key);return output;
  }
  function historicalIssues(value:unknown,beforeValue:unknown,afterValue:unknown,beforeRecords:unknown,afterRecords:unknown,beforeDate:unknown):readonly SeasonalIssue[] {
    const kind=section(value);if(!validDate(beforeDate))fail('from','Укажите действительную дату применения','INVALID_SEASON_REQUEST');
    if(kind!=='generators')return Object.freeze([]);
    const beforeAsset=object(beforeValue,'beforeAsset'),afterAsset=object(afterValue,'afterAsset'),id=identifier(read(beforeAsset,'id'),'id');
    if(read(afterAsset,'id')!==id)fail('id','Для проверки истории нужна та же техника с тем же типом ID','SEASON_ASSET_ID');
    const issues:SeasonalIssue[]=[];
    const changed=(recordId?:SeasonalAssetId,date?:string,before?:number|null,after?:number|null,message='Сезонный переход изменяет ранее учтённый расход ДЭС. Сверьте старую запись: неизвестное значение нельзя молча заменить нулём или наоборот'):void=>{
      issues.push(Object.freeze({code:'SEASON_HISTORY_CHANGED',message,id,section:kind,field:'fuelNorms',...(recordId===undefined?{}:{recordId,sourceRef:Object.freeze({section:'genRecords' as const,id:recordId})}),...(date===undefined?{}:{date}),...(before===undefined?{}:{beforeValue:before}),...(after===undefined?{}:{afterValue:after})}));
    };
    try{
      // Only the ORIGINAL accounting boundary may exclude old rows. A raw
      // batch cannot move the new boundary forward to hide a changed result.
      let accountingFrom='';
      if(Object.prototype.hasOwnProperty.call(beforeAsset,'fuelAccounting')){
        const boundary=object(read(beforeAsset,'fuelAccounting'),'fuelAccounting'),from=read(boundary,'from');
        if(read(boundary,'version')!==1||!validDate(from))fail('fuelAccounting','Некорректная исходная дата начала учёта','SEASON_HISTORY_CHANGED');accountingFrom=from;
      }
      const collect=(input:unknown):Map<SeasonalAssetId,Record<string,unknown>>=>{
        if(!Array.isArray(input)||input.length>200000)fail('genRecords','Нужен полный журнал ДЭС','SEASON_HISTORY_CHANGED');
        for(const key of Reflect.ownKeys(input))if(key!=='length'&&(typeof key!=='string'||!/^(?:0|[1-9]\d*)$/.test(key)||Number(key)>=input.length))fail('genRecords','Недопустимые поля журнала ДЭС','SEASON_HISTORY_CHANGED');
        const result=new Map<SeasonalAssetId,Record<string,unknown>>();
        for(let index=0;index<input.length;index++){
          const descriptor=Object.getOwnPropertyDescriptor(input,String(index));if(!descriptor?.enumerable||descriptor.get||descriptor.set)fail('genRecords','Недопустимая строка журнала ДЭС','SEASON_HISTORY_CHANGED');
          const row=object(descriptor.value,'genRecords');
          if(read(row,'deleted')||read(row,'cancelled')||read(row,'status')==='cancelled'||read(row,'generatorId')!==id)continue;
          const date=read(row,'date');if(!validDate(date)||date>=beforeDate||accountingFrom&&date<accountingFrom)continue;
          const recordId=identifier(read(row,'id'),'genRecords.id');
          if(result.has(recordId)){changed(recordId,date,undefined,undefined,'Исторические записи ДЭС имеют повторный ID. Нельзя однозначно проверить сохранение расхода');continue;}
          try{
            const output:Record<string,unknown>={};for(const key of ['id','generatorId','date','hours','load','fuelActual','fuelUsed','fuelMovementId'])if(Object.prototype.hasOwnProperty.call(row,key))output[key]=read(row,key);
            result.set(recordId,output);
          }catch{changed(recordId,date,undefined,undefined,'Историческая запись ДЭС содержит исполняемые или скрытые значения. Сезонный переход не может безопасно подтвердить расход');}
        }
        return result;
      };
      const before=collect(beforeRecords),after=collect(afterRecords);if(issues.length||!before.size&&!after.size)return Object.freeze(issues);
      const generatorFuel=getGenerator?.();if(generatorFuel?.apiVersion!==1||typeof generatorFuel.generatorSpent!=='function')fail('module','Не загружена проверка фактического расхода ДЭС','SEASON_HISTORY_CHANGED');
      const oldAsset=physicalAsset(beforeAsset),newAsset=physicalAsset(afterAsset);
      for(const recordId of new Set([...before.keys(),...after.keys()])){
        const oldRecord=before.get(recordId),newRecord=after.get(recordId),date=(oldRecord?.date??newRecord?.date) as string;
        try{
          const oldSpent=oldRecord?generatorFuel.generatorSpent(oldAsset,oldRecord):0,newSpent=newRecord?generatorFuel.generatorSpent(newAsset,newRecord):0;
          if(oldSpent!==null&&(typeof oldSpent!=='number'||!Number.isFinite(oldSpent))||newSpent!==null&&(typeof newSpent!=='number'||!Number.isFinite(newSpent)))throw Error('Некорректный результат расхода ДЭС');
          if(oldSpent===null||newSpent===null?oldSpent!==newSpent:decimal.compare(oldSpent,newSpent)!==0)changed(recordId,date,oldSpent,newSpent);
        }catch{changed(recordId,date,undefined,undefined,'Нельзя подтвердить прежний фактический расход ДЭС. Сверьте историческую запись до применения сезонных норм');}
      }
    }catch{changed(undefined,undefined,undefined,undefined,'Нельзя безопасно проверить прежний расход ДЭС: журнал, исходные параметры или модуль расчёта недоступны');}
    return Object.freeze(issues);
  }
  function prepare(database:unknown,input:unknown):SeasonalPreview {
    const options=request(input),db=object(database,'database'),list=read(db,options.section);
    if(!Array.isArray(list)||list.length>200000)fail(options.section,'Нужен список техники выбранного раздела','INVALID_SEASON_DATABASE');
    for(const key of Reflect.ownKeys(list))if(key!=='length'&&(typeof key!=='string'||!/^(?:0|[1-9]\d*)$/.test(key)||Number(key)>=list.length))fail(options.section,'Недопустимые поля списка техники','INVALID_SEASON_DATABASE');
    const issues:SeasonalIssue[]=[],warnings:SeasonalIssue[]=[],changes:SeasonalChange[]=[],blocked=new Set<number>(),activeIndexes=new Set<number>();
    const entries:{row:Record<string,unknown>;id:SeasonalAssetId;index:number;active:boolean}[]=[],byId=new Map<SeasonalAssetId,number[]>();let active=0,excluded=0,unchanged=0;
    const issue=(error:unknown,index:number,id?:SeasonalAssetId):void=>{blocked.add(index);const source=error as Partial<SeasonalError>;issues.push(Object.freeze({code:typeof source.code==='string'?source.code:'SEASON_HISTORY_INVALID',message:error instanceof Error?error.message:'Некорректные сезонные данные',...(typeof source.field==='string'?{field:source.field}:{}),...(id===undefined?{}:{id}),section:options.section}));};
    for(let index=0;index<list.length;index++){
      let id:SeasonalAssetId|undefined;
      try{
        const descriptor=Object.getOwnPropertyDescriptor(list,String(index));if(!descriptor?.enumerable||descriptor.get||descriptor.set)fail(options.section,'Недопустимая строка списка техники','INVALID_SEASON_DATABASE');
        const row=object(descriptor.value,'asset'),enabled=!read(row,'archived')&&!read(row,'deleted');if(enabled){active++;activeIndexes.add(index);}else excluded++;
        id=identifier(read(row,'id'),'id');entries.push({row,id,index,active:enabled});const group=byId.get(id)||[];group.push(index);byId.set(id,group);
      }catch(error){issue(error,index,id);}
    }
    for(const [id,indexes]of byId)if(indexes.length>1){for(const index of indexes)if(activeIndexes.has(index))blocked.add(index);issues.push(Object.freeze({code:'SEASON_DUPLICATE_ID',message:'ID техники встречается несколько раз. Групповое применение заблокировано',id,section:options.section,field:'id'}));}
    for(const entry of entries){
      if(!entry.active||blocked.has(entry.index))continue;const {row,id}=entry;
      try{
        const profiles=validateProfiles(options.section,row),chosen=profiles?.[options.season];
        if(!chosen)fail('fuelSeasons.'+options.season,'Для техники не настроен выбранный сезонный профиль','SEASON_PROFILE_MISSING');
        if(options.section==='generators'?chosen.norm==null&&('norm100' in chosen?chosen.norm100:null)==null:Object.values(chosen).every(value=>value===null))fail('fuelSeasons.'+options.season,'В выбранном профиле нет применимой нормы. Явный ноль считается заданной нормой','SEASON_NORM_MISSING');
        const validated=periods.validate(options.section,row,'fuelNorms'),legacy='mode' in validated,selected=periods.resolve(options.section,row,options.from,'fuelNorms');
        const previous=legacy?legacySnapshot(options.section,row,selected):snapshot(options.section,selected),parameters:Record<string,number|null>={...chosen};
        if(options.section==='generators')parameters.power=previous?.power??null;
        const parametersAfter=Object.freeze(parameters);
        if(!legacy&&seasonFromId(selected.periodId)===options.season&&sameParameters(previous,parametersAfter)){unchanged++;continue;}
        const before=legacy?null:validated as PeriodContainer,existing=before?.periods||[],periodBefore=existing.find(period=>period.from===options.from)||null;
        const baselineAdded=legacy&&options.from>MIN_DATE;
        const baseline:EffectivePeriod={id:'fuel-season:baseline:'+options.operationId,from:MIN_DATE,basis:BASELINE_BASIS,parameters:previous!};
        const periodAfter:EffectivePeriod=Object.freeze({id:'fuel-season:'+options.season+':'+options.operationId,from:options.from,basis:options.basis,parameters:parametersAfter});
        const candidates=[...(baselineAdded?[baseline]:[]),...existing.filter(period=>period.from!==options.from),periodAfter];
        const after=periods.validate(options.section,{fuelNorms:{version:1,periods:candidates}},'fuelNorms') as PeriodContainer;
        if(options.section==='generators'){
          const afterAsset=physicalAsset(row);afterAsset.fuelNorms=after;
          const records=read(db,'genRecords')??[],history=historicalIssues(options.section,row,afterAsset,records,records,options.from);
          if(history.length){blocked.add(entry.index);issues.push(...history);continue;}
        }
        const resolved=periods.resolve(options.section,{fuelNorms:after},options.from,'fuelNorms');
        if(periodBefore)warnings.push(Object.freeze({code:'SEASON_PERIOD_REPLACED',message:'На выбранную дату уже есть период. Он будет явно заменён; прежние и новые значения показаны в проверке',id,section:options.section,field:'fuelNorms'}));
        if(baselineAdded)warnings.push(Object.freeze({code:'SEASON_LEGACY_BASELINE',message:'Прежние нормы сохраняются с технической нижней границы 01.01.1900 до даты сезонного перехода',id,section:options.section,field:'fuelNorms'}));
        if(options.section==='generators'&&parametersAfter.power===null)warnings.push(Object.freeze({code:'SEASON_POWER_UNKNOWN',message:'На дату применения не определена мощность ДЭС. Она сохранится неизвестной, без подстановки из текущей карточки',id,section:options.section,field:'power'}));
        const label=read(row,options.section==='vehicles'?'plate':'name');
        changes.push(Object.freeze({id,label:typeof label==='string'&&label.trim()?label:String(id),action:periodBefore?'replace':'add',before,after,baselineAdded,parametersBefore:previous,parametersAfter,periodBefore,periodAfter,toExclusive:resolved.toExclusive??null}));
      }catch(error){issue(error,entry.index,id);}
    }
    return Object.freeze({...options,canApply:issues.length===0,issues:Object.freeze(issues),warnings:Object.freeze(warnings),changes:Object.freeze(issues.length?[]:changes),counts:Object.freeze({total:list.length,active,excluded,changed:issues.length?0:changes.length,unchanged,blocked:blocked.size})});
  }
  return Object.freeze({apiVersion:1 as const,validateProfiles,prepare,currentSeason,historicalIssues});
}
