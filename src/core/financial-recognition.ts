/** Pure projections of untrusted source snapshots; no storage, DOM or IO. */
import type { AccountingBoundaryAPI, ResolvedAccountingBoundary } from './accounting-boundary';
import type { DocumentEngineAPI } from './document-engine';
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
}

type UnknownRow = Record<string, unknown>;
type IdentifiedRow = UnknownRow & { id: EntityId };

/** The build adapter exposes this frozen API identically in Node and browsers. */
export function createDomainSources(accounting?: Readonly<AccountingBoundaryAPI>,getDocuments?:()=>Readonly<DocumentEngineAPI>|undefined): Readonly<DomainSourcesAPI> {
  const isRecord = (value: unknown): value is UnknownRow =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      && Object.prototype.toString.call(value) === '[object Object]';
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
        : source === 'workOrder' ? (text(row.downtimeTo) || text(row.completedAt)).slice(0, 10) : row.date;
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
        ...(revision?{revisionId:revision.revisionId,recognitionKey:revision.recognitionKey}:{}),
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
  function projectTankFlows(database: unknown, tankIds: unknown, options: unknown = {}): TankFlowEntry[] {
    const ids: unknown[] = Array.isArray(tankIds) ? tankIds : [tankIds];
    const selected = new Set<EntityId>(ids.filter(isEntityId)), entries: TankFlowEntry[] = [];
    const scope = isRecord(options) ? options : {};
    if (scope.accounting !== undefined && typeof scope.accounting !== 'boolean') throw new TypeError('Некорректный режим учёта движений топлива');
    const from = date(scope.from), to = date(scope.to);
    if (scope.from != null && scope.from !== '' && !from || scope.to != null && scope.to !== '' && !to || from && to && from > to)
      throw new TypeError('Некорректный период движений топлива');
    const inPeriod = (value: ISODate): boolean => (!from || value >= from) && (!to || value <= to);
    const boundaries = new Map<EntityId, ResolvedAccountingBoundary>();
    if (scope.accounting === true) for (const id of selected) {
      const matches=rows(database,'tanks').filter(row=>row.id===id);
      if (!matches.some(row=>Object.prototype.hasOwnProperty.call(row,'fuelAccounting'))) continue;
      if(matches.length!==1) throw new TypeError('Нельзя однозначно определить начало учёта ёмкости');
      if (!accounting || accounting.apiVersion!==1) throw Object.assign(new Error('Не загружены правила начала учёта топлива'),{code:'MODULE_UNAVAILABLE'});
      boundaries.set(id,accounting.resolve('tanks',matches[0]));
    }
    const currentLeg = (id: unknown, value: unknown): boolean => {
      if (!isEntityId(id) || !selected.has(id)) return false;
      const boundary=boundaries.get(id);
      return !boundary || accounting?.classify(boundary,date(value))==='current';
    };
    const add = (section: TankFlowSection, row: UnknownRow, amount: number | null, kind: string): void => {
      const day = date(row.date);
      if (!live(row) || !day || !inPeriod(day) || amount === null || amount === 0) return;
      const id = optionalId(row.id) ?? '';
      entries.push({ sourceSection: section, sourceId: id, key: sourceKey(section, id), date: day, amount, kind,
        reason: text(row.reason) || text(row.note), originalMovementId: optionalId(row.originalMovementId), reversedBy: optionalId(row.reversedBy) });
    };
    rows(database, 'tankIncomes').forEach(row => {
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
  return Object.freeze({ apiVersion: 1, projectFinancialSources, projectTankFlows, sourceKey });
}
