/** Pure projections of untrusted source snapshots; no storage, DOM or IO. */
import type { AccountingBoundaryAPI } from './accounting-boundary';
import type { DocumentEngineAPI } from './document-engine';
import type { FuelStockAPI } from './fuel-stock';
import type { DecimalCoreAPI } from './decimal-core';
import type { EntityIdentityAPI } from './entity-identity';
import type { JsonRow, JsonValue } from './platform-contracts';
export type EntityId = string | number;
export type ISODate = string & { readonly __isoDate: unique symbol };
export type SourceKey = `${string}:${string}`;
export type FinancialSourceKind = 'repair' | 'to' | 'toRecord' | 'workOrder';
export type FinancialSection = 'repairs' | 'vehicleTo' | 'toRecords' | 'workOrders';
export type PrimarySourceKind = Exclude<FinancialSourceKind, 'workOrder'>;
export type TankFlowSection = 'tankIncomes' | 'fuelMovements';
export type ExclusionCode = 'cancelled-source' | 'planned-source' | 'unaccepted-source'
  | 'unvalued-source' | 'linked-primary' | 'invalid-source-date' | 'invalid-source-reference';

export interface FinancialSource {
  source: FinancialSourceKind;
  sourceId: EntityId;
  sourceSection: FinancialSection;
  key: SourceKey;
  date: ISODate;
  sum: number;
  category: 'Ремонт' | 'ТО';
  description: string;
  vehicleId: EntityId | null;
  assetRef: string | null;
  org: string | undefined;
  object: string | undefined;
  invoiceNo: string;
  sourcePaid: boolean;
  revisionId?: EntityId;
  recognitionKey?: string;
}

interface ExclusionBase {
  source: FinancialSourceKind;
  sourceId: EntityId;
  key: SourceKey;
  message: string;
}

export type FinancialExclusion = ExclusionBase & (
  | { code: 'linked-primary'; primarySource: PrimarySourceKind; primarySourceId: EntityId; primaryKey: SourceKey }
  | { code: Exclude<ExclusionCode, 'linked-primary'>; primarySource?: never; primarySourceId?: never; primaryKey?: never }
);

export interface FinancialProjection {
  sources: FinancialSource[];
  excluded: FinancialExclusion[];
}

export interface TankFlowEntry {
  sourceSection: TankFlowSection;
  sourceId: EntityId;
  key: SourceKey;
  date: ISODate;
  /** Signed change of fuel in the selected tanks; never an unsigned receipt total. */
  amount: number;
  kind: string;
  reason: string;
  originalMovementId: EntityId | null;
  reversedBy: EntityId | null;
}

export interface DomainSourcesAPI {
  readonly apiVersion: 1;
  projectFinancialSources(database: unknown): FinancialProjection;
  projectTankFlows(database: unknown, tankIds: unknown, options?: unknown): TankFlowEntry[];
  sourceKey(source: string, id: EntityId): SourceKey;
  typedSourceKey(source: string, id: EntityId): string;
  projectExpenses(database: unknown): ExpenseProjection;
  resolveExpense(database: unknown, reference: unknown): ExpenseSource;
  indexExpenses(database: unknown): {projection:ExpenseProjection;resolve(reference:unknown):ExpenseSource};
  acquisitionObligation(database: unknown, reference: unknown): AcquisitionObligation;
  workOrderDate(value: unknown): string;
}
export interface ExpenseIssue {severity:'error'|'warning';section:string;recordId:EntityId|null;code:string;message:string}
export interface ExpenseSource {root:{section:string;id:EntityId};current:{section:string;id:EntityId};date:string;amount:number;assetRef:string|null;assetTarget:{section:'vehicles'|'generators';id:EntityId}|null;vehicleId:EntityId|null;recognitionKey:string;legacyKey:string;category:string;description:string;fingerprint:string;snapshot:JsonRow}
export interface ExpenseProjection {sources:ExpenseSource[];excluded:{section:string;id:EntityId|null;code:string}[];diagnostics:ExpenseIssue[];complete:boolean}
export interface AcquisitionObligation {root:{section:'tankIncomes'|'partMovements';id:EntityId};current:{section:'tankIncomes'|'partMovements';id:EntityId};date:string;amount:number|null;invoiceNo:string;description:string;snapshot:JsonRow;fingerprint:string}

type UnknownRow = Record<string, unknown>;
type IdentifiedRow = UnknownRow & { id: EntityId };

/** The build adapter exposes this frozen API identically in Node and browsers. */
export function createDomainSources(_accounting?: Readonly<AccountingBoundaryAPI>,getDocuments?:()=>Readonly<DocumentEngineAPI>|undefined,getStock?:()=>Readonly<FuelStockAPI>|undefined,decimal?:Readonly<DecimalCoreAPI>,identity?:Readonly<EntityIdentityAPI>,getWriteoff?:()=>{sha256(text:string):string}): Readonly<DomainSourcesAPI> {
  function workOrderDate(value:unknown):string {if(value===null||typeof value!=='object'||Array.isArray(value))return '';const ownValue=(name:string):unknown=>{const descriptor=Object.getOwnPropertyDescriptor(value,name);return descriptor&&!descriptor.get&&!descriptor.set?descriptor.value:undefined;},textValue=(name:string):string=>typeof ownValue(name)==='string'?ownValue(name) as string:'';return (Object.prototype.hasOwnProperty.call(value,'downtime')?textValue('completedAt'):textValue('downtimeTo')||textValue('completedAt')).slice(0,10);}
  const isRecord = (value: unknown): value is UnknownRow => {
    if(value===null||typeof value!=='object'||Array.isArray(value))return false;
    const prototype:unknown=Object.getPrototypeOf(value);return prototype===null||typeof prototype==='object'&&prototype!==null&&Object.getPrototypeOf(prototype)===null;
  };
  const isEntityId = (value: unknown): value is EntityId =>
    typeof value === 'string' || typeof value === 'number' && Number.isFinite(value);
  const identified = (row: UnknownRow): row is IdentifiedRow => isEntityId(row.id) && row.id !== '';
  const rows = (database: unknown, section: string): UnknownRow[] => {
    if (!isRecord(database)) return [];
    const value = database[section];
    return Array.isArray(value) ? value.filter(isRecord) : [];
  };
  const live = (row: UnknownRow): boolean => !row.deleted && !row.cancelled;
  const text = (value: unknown): string => typeof value === 'string' ? value : '';
  const nonemptyText = (value: unknown): string | undefined => text(value) || undefined;
  const optionalId = (value: unknown): EntityId | null => isEntityId(value) && value !== '' ? value : null;
  const number = (value: unknown): number | null => {
    if (typeof value !== 'number' && typeof value !== 'string' || value === '') return null;
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
  };
  const sourceKey = (source: string, id: EntityId): SourceKey => {
    if (typeof source !== 'string' || !isEntityId(id)) throw new TypeError('Некорректный ключ источника');
    return `${source}:${String(id)}`;
  };
  const typedSourceKey=(source:string,id:EntityId):string=>{
    if(typeof source!=='string'||!source.trim()||!isEntityId(id)||typeof id==='string'&&!id.trim())throw new TypeError('Некорректный типизированный ключ источника');
    return identity?.typedKey(source,id)??JSON.stringify([source,typeof id,id]);
  };
  function sourceReference(value:unknown):{section:string;id:EntityId} {
    if(!isRecord(value))throw Object.assign(Error('Нужен типизированный источник'),{code:'SOURCE_REFERENCE'});
    for(const key of Reflect.ownKeys(value)){const descriptor=Object.getOwnPropertyDescriptor(value,key);if(typeof key!=='string'||!['section','id'].includes(key)||!descriptor?.enumerable||descriptor.get||descriptor.set)throw Object.assign(Error('Исполняемая или неизвестная ссылка источника'),{code:'SOURCE_REFERENCE'});}
    const section=Object.getOwnPropertyDescriptor(value,'section')?.value,id=Object.getOwnPropertyDescriptor(value,'id')?.value;if(typeof section!=='string'||!section.trim()||!isEntityId(id)||typeof id==='string'&&!id.trim())throw Object.assign(Error('Нужен типизированный источник'),{code:'SOURCE_REFERENCE'});return {section,id};
  }
  function date(value: unknown): ISODate | null {
    if (typeof value !== 'string') return null;
    let valueText = value.trim();
    const match = valueText.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (match) valueText = `${match[3]}-${match[2]}-${match[1]}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(valueText)) return null;
    const parsed = new Date(valueText + 'T12:00:00Z');
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === valueText ? valueText as ISODate : null;
  }
  function projectFinancialSources(database: unknown): FinancialProjection {
    const sources: FinancialSource[] = [], excluded: FinancialExclusion[] = [];
    const sourceSections:FinancialSection[]=['repairs','vehicleTo','toRecords','workOrders'];
    const explicit=sourceSections.some(section=>rows(database,section).some(row=>Object.prototype.hasOwnProperty.call(row,'lifecycle')));
    const documents=explicit?getDocuments?.():undefined;
    if(explicit&&documents?.apiVersion!==1)throw Object.assign(new Error('Не загружен механизм исправлений документов'),{code:'MODULE_UNAVAILABLE'});
    const effective=new Map<FinancialSection,UnknownRow[]>(),identities=new Map<string,{rootId:EntityId;revisionId:EntityId;recognitionKey:string}>();
    const typed=(section:FinancialSection,id:EntityId):string=>JSON.stringify([section,typeof id,id]);
    if(documents)for(const section of sourceSections){
      const result=documents.resolveSection(database,section);
      if(result.diagnostics.length)throw Object.assign(new Error('Цепочка финансового документа требует сверки'),{code:'DOCUMENT_CHAIN',issues:result.diagnostics});
      effective.set(section,result.rows);
      for(const item of result.identities)identities.set(typed(section,item.id),{rootId:item.rootId,revisionId:item.id,recognitionKey:item.recognitionKey});
    }
    const exclude = (source: FinancialSourceKind, row: IdentifiedRow,
      code: Exclude<ExclusionCode, 'linked-primary'>, message: string): void => {
      excluded.push({ source, sourceId: row.id, key: sourceKey(source, row.id), code, message });
    };
    const links: readonly (readonly [string, PrimarySourceKind])[] = [
      ['repairId', 'repair'], ['vehicleToId', 'to'], ['toRecordId', 'toRecord'],
    ];
    const add = (row: UnknownRow, source: FinancialSourceKind, section: FinancialSection): void => {
      if (!identified(row)) return;
      const revision=identities.get(typed(section,row.id)),rootId=revision?.rootId??row.id;
      const projectedRow:IdentifiedRow={...row,id:rootId};
      if (!live(row)) {
        exclude(source, projectedRow, 'cancelled-source', 'Источник отменён или удалён. Проверьте ранее импортированный расход.'); return;
      }
      if ((source === 'to' || source === 'toRecord') && row.planned) {
        exclude(source, projectedRow, 'planned-source', 'Плановое ТО не является фактическим расходом. Проверьте ранее импортированный платёж.'); return;
      }
      if (source === 'workOrder' && row.status !== 'accepted') {
        exclude(source, projectedRow, 'unaccepted-source', 'Ремонтный заказ не принят. Проверьте ранее импортированный расход.'); return;
      }
      const amount = source === 'workOrder'
        ? number(row.actualCost) ?? (row.incurred === true ? number(row.cost) : null) : number(row.cost);
      if (amount === null || amount <= 0) {
        exclude(source, projectedRow, 'unvalued-source', 'В источнике нет положительной фактической стоимости. Проверьте ранее импортированный расход.'); return;
      }
      if (source === 'workOrder') {
        if (links.some(([field]) => row[field] != null && row[field] !== '' && !isEntityId(row[field]))) {
          exclude(source, projectedRow, 'invalid-source-reference', 'У заказа некорректная ссылка на первичный документ. Проверьте связь перед импортом.'); return;
        }
        const link = links.find(([field]) => optionalId(row[field]) !== null);
        if (link) {
          const [field, primarySource] = link, primarySourceId = optionalId(row[field]);
          if (primarySourceId !== null) {
            const primarySection=primarySource==='repair'?'repairs':primarySource==='to'?'vehicleTo':'toRecords',primaryRoot=identities.get(typed(primarySection,primarySourceId))?.rootId??primarySourceId;
            excluded.push({ source, sourceId: rootId, key: sourceKey(source, rootId), code: 'linked-primary',
              message: 'Заказ связан с первичным журналом. Расход учитывается по первичному документу; проверьте ранее импортированный платёж.',
              primarySource, primarySourceId:primaryRoot, primaryKey: sourceKey(primarySource, primaryRoot) });
            return;
          }
        }
      }
      const rawDate = source === 'repair' ? row.invoiceDate
        : source === 'workOrder' ? workOrderDate(row) : row.date;
      const day = date(rawDate);
      if (!day) {
        exclude(source, projectedRow, 'invalid-source-date', 'У источника нет действительной даты фактического расхода. Проверьте дату перед импортом.'); return;
      }
      const explicitRef = text(row.assetRef);
      const vehicleId = optionalId(row.vehicleId) ?? (explicitRef.startsWith('v:') ? explicitRef.slice(2) : null);
      const generatorId = optionalId(row.generatorId);
      const assetRef = explicitRef || (vehicleId !== null ? 'v:' + vehicleId
        : source === 'toRecord' && generatorId !== null ? 'g:' + generatorId : null);
      sources.push({ source, sourceId: rootId, sourceSection: section, key: sourceKey(source, rootId), date: day, sum: amount,
        revisionId:revision?.revisionId??row.id,recognitionKey:typedSourceKey(section,rootId),
        category: source === 'repair' || source === 'workOrder' ? 'Ремонт' : 'ТО',
        description: source === 'repair' ? text(row.description) || 'Ремонт'
          : source === 'workOrder' ? text(row.title) || 'Принятый ремонтный заказ'
            : 'ТО: ' + (text(row.type) || text(row.toType) || 'Техническое обслуживание'),
        vehicleId, assetRef, org: nonemptyText(row.org), object: nonemptyText(row.site) || nonemptyText(row.object),
        invoiceNo: text(row.invoiceNo), sourcePaid: source === 'workOrder' ? false : !!row.paid });
    };
    const sections: readonly (readonly [FinancialSection, FinancialSourceKind])[] = [
      ['repairs', 'repair'], ['vehicleTo', 'to'], ['toRecords', 'toRecord'], ['workOrders', 'workOrder'],
    ];
    for (const [section, source] of sections) (effective.get(section)||rows(database, section)).forEach(row => add(row, source, section));
    return { sources, excluded };
  }
  /** Canonical actual expenses. Acquisitions, settlements and allocations are separate ledgers. */
  function projectExpenses(database:unknown):ExpenseProjection {
    const names=['repairs','vehicleTo','toRecords','workOrders','payments','costEntries','vehicles','generators','tankIncomes','partMovements'];
    const safe=(value:unknown):JsonValue=>{
      const seen=new Set<object>();let count=0;
      const visit=(item:unknown,depth:number):JsonValue=>{
        if(++count>2000000||depth>100)throw Object.assign(Error('Слишком большой снимок источников'),{code:'SOURCE_LIMIT'});
        if(item===null||typeof item==='string'||typeof item==='boolean'||typeof item==='number'&&Number.isFinite(item))return item;
        if(item===null||typeof item!=='object'||seen.has(item))throw Object.assign(Error('Источники должны содержать конечный JSON'),{code:'SOURCE_JSON'});
        const array=Array.isArray(item),proto:unknown=Object.getPrototypeOf(item);
        if(!array&&!(proto===null||typeof proto==='object'&&proto!==null&&Object.getPrototypeOf(proto)===null))throw Object.assign(Error('Недопустимый объект источника'),{code:'SOURCE_JSON'});
        seen.add(item);for(const key of Reflect.ownKeys(item)){if(array&&key==='length')continue;const descriptor=Object.getOwnPropertyDescriptor(item,key);if(typeof key!=='string'||!descriptor?.enumerable||descriptor.get||descriptor.set||['__proto__','constructor','prototype','toJSON'].includes(key)||array&&!/^(0|[1-9]\d*)$/.test(key))throw Object.assign(Error('Исполняемые свойства источника недопустимы'),{code:'SOURCE_JSON'});}
        let output:JsonValue;if(array){const list:JsonValue[]=[];for(let index=0;index<item.length;index++){const descriptor=Object.getOwnPropertyDescriptor(item,String(index));if(!descriptor)throw Object.assign(Error('Пропуск строки источника'),{code:'SOURCE_JSON'});list.push(visit(descriptor.value,depth+1));}output=list;}else{const result:JsonRow={};for(const key of Object.keys(item))result[key]=visit(Object.getOwnPropertyDescriptor(item,key)!.value,depth+1);output=result;}seen.delete(item);return output;
      };return visit(value,0);
    };
    if(!isRecord(database))throw Object.assign(Error('Нужен снимок источников'),{code:'SOURCE_DATABASE'});
    const db:Record<string,JsonRow[]>={};for(const name of names){const descriptor=Object.getOwnPropertyDescriptor(database,name);if(descriptor?.get||descriptor?.set)throw Object.assign(Error('Исполняемый раздел недопустим'),{code:'SOURCE_JSON'});const value=safe(descriptor?descriptor.value:[]);if(!Array.isArray(value)||value.some(item=>!isRecord(item)))throw Object.assign(Error('Нужен массив источников'),{code:'SOURCE_DATABASE'});db[name]=value as JsonRow[];}
    const hash=getWriteoff?.();if(!hash||typeof hash.sha256!=='function')throw Object.assign(Error('Не загружено вычисление отпечатка источника'),{code:'MODULE_UNAVAILABLE'});
    const stable=(value:JsonValue):string=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(stable).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key]!)).join(',')+'}';
    const result:ExpenseProjection={sources:[],excluded:[],diagnostics:[],complete:true},effective=new Map<string,JsonRow[]>(),roots=new Map<string,EntityId>(),sourceSections:Record<string,string>={repair:'repairs',to:'vehicleTo',toRecord:'toRecords',workOrder:'workOrders',tankIncome:'tankIncomes',partReceipt:'partMovements'};
    const issue=(section:string,row:UnknownRow,code:string,message:string):void=>{result.diagnostics.push({severity:'error',section,recordId:optionalId(row.id),code,message});result.complete=false;};
    const documents=getDocuments?.();
    for(const name of [...names.slice(0,6),'tankIncomes','partMovements']){
      const raw=db[name]!,explicit=raw.some(row=>Object.prototype.hasOwnProperty.call(row,'lifecycle')||Object.prototype.hasOwnProperty.call(row,'paymentSettlements'));
      if(explicit&&documents?.apiVersion!==1)throw Object.assign(Error('Не загружены действующие версии источников'),{code:'MODULE_UNAVAILABLE'});
      if(explicit&&documents&&name!=='costEntries'){const projection=documents.resolveSection(db,name);effective.set(name,projection.rows);for(const item of projection.identities)roots.set(typedSourceKey(name,item.id),item.rootId);for(const diagnostic of projection.diagnostics){result.diagnostics.push(diagnostic);result.complete=false;}}
      else effective.set(name,raw);
    }
    const root=(section:string,row:JsonRow):EntityId|null=>identified(row)?roots.get(typedSourceKey(section,row.id))??row.id:null;
    const primaryIndex=new Map<string,JsonRow[]>();for(const [section,list]of effective)for(const row of list){const id=root(section,row);if(id===null)continue;const key=typedSourceKey(section,id),group=primaryIndex.get(key)||[];group.push(row);primaryIndex.set(key,group);}
    const hasPrimary=(section:string,id:EntityId):boolean=>primaryIndex.get(typedSourceKey(section,id))?.length===1;
    for(const name of names.slice(0,6))for(const row of effective.get(name)||[]){
      const id=root(name,row),exclude=(code:string):void=>{result.excluded.push({section:name,id,code});};
      if(!live(row)||row.status==='cancelled'){exclude('cancelled-source');continue;}
      if((name==='vehicleTo'||name==='toRecords')&&row.planned){exclude('planned-source');continue;}
      if(name==='workOrders'&&row.status!=='accepted'){exclude('unaccepted-source');continue;}
      if(name==='costEntries'&&(row.kind==='allocation'||row.costAllocation!==undefined||row.independent!==true||row.kind==='income')){exclude('not-independent-expense');continue;}
      if(id===null){issue(name,row,'SOURCE_ID','У расхода нет устойчивого типизированного ID');continue;}
      if((primaryIndex.get(typedSourceKey(name,id))||[]).length>1)issue(name,row,'SOURCE_AMBIGUOUS','Типизированный корень расхода повторяется; исходные суммы сохранены, источник распределения неоднозначен');
      if(name==='workOrders'){
        const links=[['repairId','repairs'],['vehicleToId','vehicleTo'],['toRecordId','toRecords']] as const;
        const selected=links.filter(([field])=>row[field]!==null&&row[field]!==undefined&&row[field]!=='');
        if(selected.length){for(const [field,section]of selected){const target=optionalId(row[field]);if(target===null||!hasPrimary(section,target))issue(name,row,'SOURCE_LINK','Первичный документ заказа не найден однозначно');}exclude('linked-primary');continue;}
      }
      if(name==='payments'&&typeof row.source==='string'&&Object.prototype.hasOwnProperty.call(sourceSections,row.source)&&row.sourceId!==null&&row.sourceId!==undefined&&row.sourceId!==''){
        const section=sourceSections[row.source]!,sourceId=optionalId(row.sourceId),acquisition=section==='tankIncomes'||section==='partMovements';if(sourceId===null||!hasPrimary(section,sourceId))issue(name,row,'SOURCE_LINK','Источник обязательства не найден; требуется сверка');else{const primary=primaryIndex.get(typedSourceKey(section,sourceId))![0]!;if(section==='partMovements'&&primary.kind!=='receipt')issue(name,row,'SOURCE_LINK','Обязательство закупки должно ссылаться на фактический приход');let amount=number(section==='workOrders'?primary.actualCost??(primary.incurred===true?primary.cost:null):primary.cost);if(acquisition){amount=number(primary.grossSum);const net=number(primary.sum),vat=number(primary.vatAmount);if(amount===null&&net!==null&&vat!==null&&decimal)amount=decimal.toNumberExact(decimal.add(net,vat));if(amount===null&&net!==null&&number(primary.vatRate)===0)amount=net;if(amount===null)result.diagnostics.push({severity:'warning',section:name,recordId:id,code:'SOURCE_PURCHASE_AMOUNT_UNKNOWN',message:'У закупки нет подтверждённой суммы с НДС; обязательство не переписано и не включено повторно в расход'});}const saved=number(row.sum);if(amount!==null&&saved!==null&&decimal&&decimal.compare(amount,saved)!==0)result.diagnostics.push({severity:'warning',section:name,recordId:id,code:'SOURCE_DISCREPANCY',message:'Сохранённое обязательство отличается от действующей стоимости первичного документа'});}exclude(acquisition?'inventory-acquisition-obligation':'linked-primary');continue;
      }
      const amount=number(name==='workOrders'?row.actualCost??(row.incurred===true?row.cost:null):name==='payments'?row.sum:name==='costEntries'?row.amount:row.cost);
      const day=date(name==='repairs'?row.invoiceDate:name==='workOrders'?workOrderDate(row):row.date);
      if(amount===null||amount<0){issue(name,row,'SOURCE_AMOUNT','Фактическая стоимость не задана или некорректна');continue;}
      if(!day){issue(name,row,'SOURCE_DATE','У фактического расхода нет действительной даты');continue;}
      let assetRef=typeof row.assetRef==='string'&&row.assetRef?row.assetRef:null;const vehicleId=optionalId(row.vehicleId),generatorId=optionalId(row.generatorId);let assetTarget:ExpenseSource['assetTarget']=null;
      if(vehicleId!==null||generatorId!==null){const section=vehicleId!==null?'vehicles':'generators',id=vehicleId??generatorId!,matches=(db[section]||[]).filter(value=>value.id===id);if(matches.length===1)assetTarget={section,id};else issue(name,row,'SOURCE_ASSET','Техника расхода не найдена однозначно по типизированной ссылке');}
      if(!assetRef&&identity&&assetTarget){try{assetRef=identity.assetRef(db,assetTarget.section,assetTarget.id);}catch{/* Exact typed binding remains known when the old string format cannot represent it. */}}
      if(assetRef&&identity){const resolved=identity.resolveAsset(db,assetRef);if(resolved.status==='known'){if(assetTarget&&(assetTarget.section!==resolved.section||assetTarget.id!==resolved.id))issue(name,row,'SOURCE_ASSET','Прямое назначение и строковая ссылка расхода противоречат друг другу');else assetTarget={section:resolved.section as 'vehicles'|'generators',id:resolved.id};}else if(!assetTarget)issue(name,row,'SOURCE_ASSET','Строковая ссылка техники расхода неоднозначна или не найдена');}
      const snapshot:JsonRow={};for(const [key,value]of Object.entries(row)){if(!['paid','paidAmount','paidDate','paymentSettlements','updatedAt','updatedBy'].includes(key))snapshot[key]=value;}
      const canonical:JsonRow={root:{section:name,id},current:{section:name,id:row.id!},date:day,amount,assetRef,assetTarget,snapshot};
      const aliases:Record<string,string>={repairs:'repair',vehicleTo:'to',toRecords:'toRecord',workOrders:'workOrder'};
      result.sources.push({root:{section:name,id},current:{section:name,id:row.id as EntityId},date:day,amount,assetRef,assetTarget,vehicleId,recognitionKey:typedSourceKey(name,id),legacyKey:sourceKey(aliases[name]??name,id),category:text(row.category)||(name==='vehicleTo'||name==='toRecords'?'ТО':name==='repairs'||name==='workOrders'?'Ремонт':'Прочее'),description:text(row.description)||text(row.title)||text(row.type),fingerprint:'sha256:'+hash.sha256(stable(canonical)),snapshot});
    }
    return result;
  }
  function indexExpenses(database:unknown):{projection:ExpenseProjection;resolve(reference:unknown):ExpenseSource} {
    const projection=projectExpenses(database),byRoot=new Map<string,ExpenseSource[]>(),problems=new Set(projection.diagnostics.filter(issue=>issue.severity==='error'&&issue.recordId!==null).map(issue=>typedSourceKey(issue.section,issue.recordId!)));
    for(const source of projection.sources){const key=typedSourceKey(source.root.section,source.root.id),list=byRoot.get(key)||[];list.push(source);byRoot.set(key,list);}
    const freeze=<T>(value:T):T=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;};freeze(projection);
    const resolve=(reference:unknown):ExpenseSource=>{const ref=sourceReference(reference),key=typedSourceKey(ref.section,ref.id),found=byRoot.get(key)||[];if(found.length!==1)throw Object.assign(Error('Источник не является единственным действующим самостоятельным расходом'),{code:found.length?'SOURCE_AMBIGUOUS':'SOURCE_NOT_RECOGNIZED',issues:projection.diagnostics});if(problems.has(key))throw Object.assign(Error('Источник расхода требует сверки'),{code:'SOURCE_INCOMPLETE',issues:projection.diagnostics});return found[0]!;};
    return Object.freeze({projection,resolve});
  }
  function resolveExpense(database:unknown,reference:unknown):ExpenseSource {return indexExpenses(database).resolve(reference);}
  function acquisitionObligation(database:unknown,reference:unknown):AcquisitionObligation {
    const ref=sourceReference(reference);if(ref.section!=='tankIncomes'&&ref.section!=='partMovements')throw Object.assign(Error('Выберите корневой приход по типизированной ссылке'),{code:'SOURCE_REFERENCE'});
    const documents=getDocuments?.(),hasher=getWriteoff?.();if(documents?.apiVersion!==1||!hasher||decimal?.apiVersion!==1)throw Object.assign(Error('Не загружены версии и суммы закупок'),{code:'MODULE_UNAVAILABLE'});
    const section=ref.section,resolution=documents.resolveDocument(database,{section,id:ref.id}),current=resolution.current;
    if(resolution.root.id!==ref.id||!live(current)||current.status==='cancelled'||section==='partMovements'&&current.kind!=='receipt')throw Object.assign(Error('Нужен корень действующего обычного прихода'),{code:'SOURCE_NOT_RECOGNIZED'});
    if(section==='tankIncomes'&&(['in','out'].includes(text(current.kind))||optionalId(current.linkId)!==null||optionalId(current.counterTankId)!==null))throw Object.assign(Error('Половина внутреннего перемещения не является закупкой'),{code:'SOURCE_NOT_RECOGNIZED'});
    const quantities=section==='partMovements'?[number(current.qty)]:['amount','liters','litres','qty'].filter(key=>current[key]!==undefined&&current[key]!==null&&current[key]!=='').map(key=>number(current[key]));
    if(!quantities.length||quantities.some(value=>value===null||value<=0)||quantities.some(value=>decimal.compare(value,quantities[0])!==0))throw Object.assign(Error('Количество прихода не подтверждено однозначными полями'),{code:'SOURCE_QUANTITY'});
    const active=documents.resolveSection(database,section);if(active.diagnostics.some(item=>resolution.history.some(row=>row.id===item.recordId))||!active.rows.some(row=>row.id===current.id))throw Object.assign(Error('Приход отменён или его версии требуют сверки'),{code:'SOURCE_NOT_RECOGNIZED'});
    const rawDate=date(current.date);if(!rawDate)throw Object.assign(Error('У прихода нет действительной даты'),{code:'SOURCE_DATE'});
    let amount=number(current.grossSum);const net=number(current.sum),vat=number(current.vatAmount);if(amount===null&&net!==null&&vat!==null)amount=decimal.toNumberExact(decimal.add(net,vat));if(amount===null&&net!==null&&number(current.vatRate)===0)amount=net;
    if(amount!==null&&amount<0)throw Object.assign(Error('Сумма закупки некорректна'),{code:'SOURCE_AMOUNT'});
    const snapshot:JsonRow={...current},root:AcquisitionObligation['root']={section,id:ref.id},revision:AcquisitionObligation['current']={section,id:current.id as EntityId},stable=(value:JsonValue):string=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(stable).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key]!)).join(',')+'}';
    return {root,current:revision,date:rawDate,amount,invoiceNo:text(current.invoiceNo),description:text(current.source)||text(current.reason)||text(current.note)||'Приход запасов',snapshot,fingerprint:'sha256:'+hasher.sha256(stable({root,current:revision,date:rawDate,amount,snapshot}))};
  }
  function projectTankFlows(database: unknown, tankIds: unknown, options: unknown = {}): TankFlowEntry[] {
    const ids: unknown[] = Array.isArray(tankIds) ? tankIds : [tankIds];
    const selected = new Set<EntityId>(ids.filter(isEntityId)), entries: TankFlowEntry[] = [];
    const scope = isRecord(options) ? options : {};
    if (scope.accounting !== undefined && typeof scope.accounting !== 'boolean') throw new TypeError('Некорректный режим учёта движений топлива');
    const from = date(scope.from), to = date(scope.to);
    if (scope.from != null && scope.from !== '' && !from || scope.to != null && scope.to !== '' && !to || from && to && from > to)
      throw new TypeError('Некорректный период движений топлива');
    const inPeriod = (value: ISODate): boolean => (!from || value >= from) && (!to || value <= to);
    if(scope.accounting===true){
      const stock=getStock?.();if(stock?.apiVersion!==1||decimal?.apiVersion!==1)throw Object.assign(new Error('Не загружен общий расчёт топливного запаса'),{code:'MODULE_UNAVAILABLE'});
      const projected=stock.project(database,{tankIds:[...selected],...(to?{to}:{})});
      if(projected.rows.some(row=>row.status==='unknown'||row.status==='invalid')||projected.diagnostics.some(issue=>issue.severity==='error'))throw Object.assign(new Error('Источники запаса требуют сверки; частичный список движений не выдаётся как полный'),{code:'FUEL_STOCK_UNKNOWN',issues:projected.diagnostics});
      const grouped=new Map<string,{section:TankFlowSection;id:EntityId;rowIndex:number;date:ISODate;kind:string;deltas:string[]}>();
      for(const tank of projected.rows)for(const event of tank.events){if(!event.stockAffects||event.deltaDecimal===null||!inPeriod(event.date as ISODate)||!['tankIncomes','fuelMovements'].includes(event.source.section))continue;const section=event.source.section as TankFlowSection,id=event.source.id??'',key=JSON.stringify([section,typeof id,id,event.source.rowIndex]);let item=grouped.get(key);if(!item){item={section,id,rowIndex:event.source.rowIndex,date:event.date as ISODate,kind:event.kind,deltas:[]};grouped.set(key,item);}item.deltas.push(event.deltaDecimal);}
      for(const item of grouped.values()){const amount=decimal.toNumberExact(decimal.sum(item.deltas));if(amount===0)continue;const raw=rows(database,item.section)[item.rowIndex]||{};entries.push({sourceSection:item.section,sourceId:item.id,key:sourceKey(item.section,item.id),date:item.date,amount,kind:item.kind,reason:text(raw.reason)||text(raw.note),originalMovementId:optionalId(raw.originalMovementId),reversedBy:optionalId(raw.reversedBy)});}
      return entries.sort((a,b)=>a.date.localeCompare(b.date)||a.key.localeCompare(b.key));
    }
    const currentLeg = (id: unknown, _value: unknown): boolean => {
      return isEntityId(id) && selected.has(id);
    };
    const add = (section: TankFlowSection, row: UnknownRow, amount: number | null, kind: string): void => {
      const day = date(row.date);
      if (!live(row) || !day || !inPeriod(day) || amount === null || amount === 0) return;
      const id = optionalId(row.id) ?? '';
      entries.push({ sourceSection: section, sourceId: id, key: sourceKey(section, id), date: day, amount, kind,
        reason: text(row.reason) || text(row.note), originalMovementId: optionalId(row.originalMovementId), reversedBy: optionalId(row.reversedBy) });
    };
    const rawIncomes=rows(database,'tankIncomes'),documents=rawIncomes.some(row=>Object.prototype.hasOwnProperty.call(row,'lifecycle'))?getDocuments?.():undefined;
    if(rawIncomes.some(row=>Object.prototype.hasOwnProperty.call(row,'lifecycle'))&&documents?.apiVersion!==1)throw Object.assign(new Error('Не загружены версии приходов'),{code:'MODULE_UNAVAILABLE'});
    (documents?documents.activeRows(database,'tankIncomes'):rawIncomes).forEach(row => {
      if (currentLeg(row.tankId,row.date))
        add('tankIncomes', row, number(row.amount ?? row.liters ?? row.litres ?? row.qty), 'legacy');
    });
    rows(database, 'fuelMovements').forEach(row => {
      const qty = number(row.qty);
      if (qty === null || qty < 0) return;
      // Decide each signed leg before netting. Tanks may begin accounting on
      // different dates; an excluded recipient must not erase a current issue.
      // Raw history remains the default, including the original and reversal.
      const amount = (currentLeg(row.toTankId,row.date) ? qty : 0)
        - (currentLeg(row.fromTankId,row.date) ? qty : 0);
      add('fuelMovements', row, amount, text(row.kind) || 'movement');
    });
    return entries.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  }
  return Object.freeze({ apiVersion: 1, projectFinancialSources, projectTankFlows, sourceKey,typedSourceKey,projectExpenses,resolveExpense,indexExpenses,acquisitionObligation,workOrderDate });
}
