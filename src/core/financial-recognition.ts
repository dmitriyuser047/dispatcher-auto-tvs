/** Pure projections of untrusted source snapshots; no storage, DOM or IO. */
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
export function createDomainSources(): Readonly<DomainSourcesAPI> {
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
    const exclude = (source: FinancialSourceKind, row: IdentifiedRow,
      code: Exclude<ExclusionCode, 'linked-primary'>, message: string): void => {
      excluded.push({ source, sourceId: row.id, key: sourceKey(source, row.id), code, message });
    };
    const links: readonly (readonly [string, PrimarySourceKind])[] = [
      ['repairId', 'repair'], ['vehicleToId', 'to'], ['toRecordId', 'toRecord'],
    ];
    const add = (row: UnknownRow, source: FinancialSourceKind, section: FinancialSection): void => {
      if (!identified(row)) return;
      if (!live(row)) {
        exclude(source, row, 'cancelled-source', 'Источник отменён или удалён. Проверьте ранее импортированный расход.'); return;
      }
      if ((source === 'to' || source === 'toRecord') && row.planned) {
        exclude(source, row, 'planned-source', 'Плановое ТО не является фактическим расходом. Проверьте ранее импортированный платёж.'); return;
      }
      if (source === 'workOrder' && row.status !== 'accepted') {
        exclude(source, row, 'unaccepted-source', 'Ремонтный заказ не принят. Проверьте ранее импортированный расход.'); return;
      }
      const amount = source === 'workOrder'
        ? number(row.actualCost) ?? (row.incurred === true ? number(row.cost) : null) : number(row.cost);
      if (amount === null || amount <= 0) {
        exclude(source, row, 'unvalued-source', 'В источнике нет положительной фактической стоимости. Проверьте ранее импортированный расход.'); return;
      }
      if (source === 'workOrder') {
        if (links.some(([field]) => row[field] != null && row[field] !== '' && !isEntityId(row[field]))) {
          exclude(source, row, 'invalid-source-reference', 'У заказа некорректная ссылка на первичный документ. Проверьте связь перед импортом.'); return;
        }
        const link = links.find(([field]) => optionalId(row[field]) !== null);
        if (link) {
          const [field, primarySource] = link, primarySourceId = optionalId(row[field]);
          if (primarySourceId !== null) {
            excluded.push({ source, sourceId: row.id, key: sourceKey(source, row.id), code: 'linked-primary',
              message: 'Заказ связан с первичным журналом. Расход учитывается по первичному документу; проверьте ранее импортированный платёж.',
              primarySource, primarySourceId, primaryKey: sourceKey(primarySource, primarySourceId) });
            return;
          }
        }
      }
      const rawDate = source === 'repair' ? row.invoiceDate
        : source === 'workOrder' ? (text(row.downtimeTo) || text(row.completedAt)).slice(0, 10) : row.date;
      const day = date(rawDate);
      if (!day) {
        exclude(source, row, 'invalid-source-date', 'У источника нет действительной даты фактического расхода. Проверьте дату перед импортом.'); return;
      }
      const explicitRef = text(row.assetRef);
      const vehicleId = optionalId(row.vehicleId) ?? (explicitRef.startsWith('v:') ? explicitRef.slice(2) : null);
      const generatorId = optionalId(row.generatorId);
      const assetRef = explicitRef || (vehicleId !== null ? 'v:' + vehicleId
        : source === 'toRecord' && generatorId !== null ? 'g:' + generatorId : null);
      sources.push({ source, sourceId: row.id, sourceSection: section, key: sourceKey(source, row.id), date: day, sum: amount,
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
    for (const [section, source] of sections) rows(database, section).forEach(row => add(row, source, section));
    return { sources, excluded };
  }
  function projectTankFlows(database: unknown, tankIds: unknown, options: unknown = {}): TankFlowEntry[] {
    const ids: unknown[] = Array.isArray(tankIds) ? tankIds : [tankIds];
    const selected = new Set<EntityId>(ids.filter(isEntityId)), entries: TankFlowEntry[] = [];
    const scope = isRecord(options) ? options : {};
    const from = date(scope.from), to = date(scope.to);
    if (scope.from != null && scope.from !== '' && !from || scope.to != null && scope.to !== '' && !to || from && to && from > to)
      throw new TypeError('Некорректный период движений топлива');
    const inPeriod = (value: ISODate): boolean => (!from || value >= from) && (!to || value <= to);
    const add = (section: TankFlowSection, row: UnknownRow, amount: number | null, kind: string): void => {
      const day = date(row.date);
      if (!live(row) || !day || !inPeriod(day) || amount === null || amount === 0) return;
      const id = optionalId(row.id) ?? '';
      entries.push({ sourceSection: section, sourceId: id, key: sourceKey(section, id), date: day, amount, kind,
        reason: text(row.reason) || text(row.note), originalMovementId: optionalId(row.originalMovementId), reversedBy: optionalId(row.reversedBy) });
    };
    rows(database, 'tankIncomes').forEach(row => {
      if (isEntityId(row.tankId) && selected.has(row.tankId))
        add('tankIncomes', row, number(row.amount ?? row.liters ?? row.litres ?? row.qty), 'legacy');
    });
    rows(database, 'fuelMovements').forEach(row => {
      const qty = number(row.qty);
      if (qty === null || qty < 0) return;
      // Keep the original and opposite reversal. Internal transfers net to zero.
      const amount = (isEntityId(row.toTankId) && selected.has(row.toTankId) ? qty : 0)
        - (isEntityId(row.fromTankId) && selected.has(row.fromTankId) ? qty : 0);
      add('fuelMovements', row, amount, text(row.kind) || 'movement');
    });
    return entries.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  }
  return Object.freeze({ apiVersion: 1, projectFinancialSources, projectTankFlows, sourceKey });
}
