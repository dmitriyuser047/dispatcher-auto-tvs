import type { JsonRow, JsonValue } from './platform-contracts';

export interface DatabaseIdentity { format: 'tvs-database-identity'; version: 1; uuid: string; generation: number }
export interface DatabaseDescriptor { schemaVersion: 1 | 2 | 3; minReader: number; minWriter: 3; features: readonly string[] }
export type DatabaseLifecycleAction = 'relocate' | 'clone' | 'restoreContinuation';
export interface DatabaseLifecycleHead { identity: DatabaseIdentity; physicalKey: string; metadataStamp: string }
export interface DatabaseLifecycleSource { format: 'json' | 'sqlite' | 'backup'; identity: DatabaseIdentity | null; descriptor: DatabaseDescriptor | null; fingerprint: string; physicalKey: string }
export interface DatabaseLifecycleTarget { format: 'json' | 'sqlite'; descriptor: DatabaseDescriptor; physicalKey: string }
export interface DatabaseLifecycleInput {
  action: DatabaseLifecycleAction; source: DatabaseLifecycleSource; target: DatabaseLifecycleTarget;
  reason: string; continuationOf?: DatabaseLifecycleHead; knownHeads?: readonly DatabaseLifecycleHead[]; reviewFingerprint?: string;
}
export interface DatabaseLifecycleContext { operationId: string; at: string; actor: { id: string; name: string; role: string }; newUuid?: string }
export interface DatabaseLifecycleIssue { severity: 'warning' | 'error'; code: string; message: string }
export interface DatabaseLifecycleHistory {
  version: 1; kind: 'database-lifecycle'; action: DatabaseLifecycleAction; operationId: string; at: string;
  actor: { id: string; name: string; role: string }; reason: string; sourceFingerprint: string;
  sourceIdentity: DatabaseIdentity | null; targetIdentity: DatabaseIdentity; sourceDescriptor: DatabaseDescriptor | null;
  targetDescriptor: DatabaseDescriptor; predecessor: DatabaseLifecycleHead | null;
}
export interface DatabaseLifecyclePlan {
  version: 1; action: DatabaseLifecycleAction; operationId: string; source: DatabaseLifecycleSource;
  target: DatabaseLifecycleTarget & { identity: DatabaseIdentity }; predecessor: DatabaseLifecycleHead | null;
  history: DatabaseLifecycleHistory; reviewFingerprint: string; warnings: readonly DatabaseLifecycleIssue[];
  constraints: { sourceFingerprint: string; sourcePhysicalKey: string; targetPhysicalKey: string; headMetadataStamp: string | null; copyOnly: true; preserveBusinessBytes: true; retargetReceipts: false };
}
export interface DatabaseLifecyclePreview {
  canApply: boolean; issues: readonly DatabaseLifecycleIssue[]; warnings: readonly DatabaseLifecycleIssue[]; reviewFingerprint: string | null;
  sourceIdentity: DatabaseIdentity | null; targetIdentity: DatabaseIdentity | null; sourceDescriptor: DatabaseDescriptor | null;
  targetDescriptor: DatabaseDescriptor | null; history: DatabaseLifecycleHistory | null; plan: DatabaseLifecyclePlan | null;
}
interface Contracts { apiVersion: number }
interface Hash { sha256(value: string): string }
interface LifecycleError extends Error { code: string; status: number }
const features = ['controlled-import-v1', 'document-lifecycle-v1', 'row-scope-v1', 'sealed-print-v1'];
const actions: readonly DatabaseLifecycleAction[] = ['relocate', 'clone', 'restoreContinuation'];
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;

/** Factual, clock-free control-plane planner. Only the host may inspect files,
 * authorize maintenance, generate a new UUID, or execute its copy-only plan. */
export function createDatabaseLifecycle(contracts: Contracts, getHash?: () => Hash) {
  function fail(code: string, message: string): never { const error = new Error(message) as LifecycleError; error.code = code; error.status = 409; throw error; }
  if (contracts?.apiVersion !== 1) fail('MODULE_UNAVAILABLE', 'Не загружены контракты жизненного цикла базы');
  function freeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
  function stable(value: unknown): string { return value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? '[' + value.map(stable).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable((value as Record<string, unknown>)[key])).join(',') + '}'; }
  function safe(value: unknown): JsonValue {
    const parents = new Set<object>(); let count = 0;
    function copy(item: unknown, depth: number): JsonValue {
      if (++count > 50000 || depth > 30) fail('IDENTITY_INPUT', 'Слишком большой план идентичности');
      if (item === null || typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) return item;
      if (!item || typeof item !== 'object' || parents.has(item)) fail('IDENTITY_INPUT', 'Нужны конечные данные JSON');
      const array = Array.isArray(item), proto: unknown = Object.getPrototypeOf(item);
      if (!array && !(proto === null || typeof proto === 'object' && proto !== null && Object.getPrototypeOf(proto) === null)) fail('IDENTITY_INPUT', 'Недопустимый объект плана');
      for (const key of Reflect.ownKeys(item)) {
        if (array && key === 'length') continue;
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype', 'toJSON'].includes(key) || !descriptor?.enumerable || descriptor.get || descriptor.set || array && !/^(0|[1-9]\d*)$/.test(key)) fail('IDENTITY_INPUT', 'Исполняемые и скрытые поля запрещены');
      }
      parents.add(item); let result: JsonValue;
      if (array) { if (item.length > 1000) fail('IDENTITY_INPUT', 'Слишком много профилей'); const values: JsonValue[] = []; for (let i = 0; i < item.length; i++) { const descriptor = Object.getOwnPropertyDescriptor(item, String(i)); if (!descriptor) fail('IDENTITY_INPUT', 'Пропуск строки массива'); values.push(copy(descriptor.value, depth + 1)); } result = values; }
      else { const row: JsonRow = {}; for (const key of Object.keys(item)) row[key] = copy(Object.getOwnPropertyDescriptor(item, key)!.value, depth + 1); result = row; }
      parents.delete(item); return result;
    }
    return copy(value, 0);
  }
  const object = (value: JsonValue | undefined): value is JsonRow => value !== null && typeof value === 'object' && !Array.isArray(value);
  function row(value: JsonValue | undefined): JsonRow { if (!object(value)) fail('IDENTITY_INPUT', 'Нужен объект плана'); return value; }
  function keys(value: JsonRow, allowed: readonly string[]): void { if (Object.keys(value).some(key => !allowed.includes(key))) fail('IDENTITY_INPUT', 'Неизвестное поле плана идентичности'); }
  function text(value: JsonValue | undefined, label: string, max = 32768): string { if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) fail('IDENTITY_INPUT', 'Не указан ' + label); return value; }
  function fingerprint(value: JsonValue | undefined): string { const result = text(value, 'отпечаток', 71); if (!digestPattern.test(result)) fail('IDENTITY_INPUT', 'Некорректный отпечаток'); return result; }
  function identity(value: JsonValue | undefined): DatabaseIdentity {
    const input = row(value); keys(input, ['format', 'version', 'uuid', 'generation']);
    if (input.format !== 'tvs-database-identity' || input.version !== 1 || typeof input.uuid !== 'string' || !uuidPattern.test(input.uuid) || !Number.isSafeInteger(input.generation) || (input.generation as number) < 1) fail('IDENTITY_INVALID', 'Не подтверждён UUID или поколение базы');
    return { format: 'tvs-database-identity', version: 1, uuid: input.uuid, generation: input.generation as number };
  }
  function descriptor(value: JsonValue | undefined): DatabaseDescriptor {
    const input = row(value); keys(input, ['schemaVersion', 'minReader', 'minWriter', 'features']);
    if (![1, 2, 3].includes(input.schemaVersion as number) || input.minReader !== input.schemaVersion || input.minWriter !== 3 || !Array.isArray(input.features) || input.features.some(item => typeof item !== 'string') || new Set(input.features).size !== input.features.length) fail('IDENTITY_DESCRIPTOR', 'Не подтверждена совместимость базы');
    const expected = input.schemaVersion === 3 ? features : [];
    if (stable(input.features) !== stable(expected)) fail('IDENTITY_DESCRIPTOR', 'Неизвестные или отсутствующие возможности базы');
    return { schemaVersion: input.schemaVersion as 1 | 2 | 3, minReader: input.minReader as number, minWriter: 3, features: input.features as string[] };
  }
  function head(value: JsonValue | undefined): DatabaseLifecycleHead { const input = row(value); keys(input, ['identity', 'physicalKey', 'metadataStamp']); return { identity: identity(input.identity), physicalKey: text(input.physicalKey, 'физический каталог'), metadataStamp: fingerprint(input.metadataStamp) }; }
  function build(raw: unknown, rawContext: unknown): DatabaseLifecyclePlan {
    const input = row(safe(raw)), ctx = row(safe(rawContext)); keys(input, ['action', 'source', 'target', 'reason', 'continuationOf', 'knownHeads', 'reviewFingerprint']); keys(ctx, ['operationId', 'at', 'actor', 'newUuid']);
    if (!actions.includes(input.action as DatabaseLifecycleAction)) fail('IDENTITY_ACTION', 'Выберите действие с базой');
    const action = input.action as DatabaseLifecycleAction, operationId = text(ctx.operationId, 'идентификатор операции', 200), at = text(ctx.at, 'время операции', 40), actorRow = row(ctx.actor);
    keys(actorRow, ['id', 'name', 'role']); const actor = { id: text(actorRow.id, 'учётная запись', 500), name: text(actorRow.name, 'имя исполнителя', 500), role: text(actorRow.role, 'роль', 100) };
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(at) || !Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at) fail('IDENTITY_CLOCK', 'Нужно явно подтверждённое время операции');
    const reason = text(input.reason, 'основание', 2000); if (reason.trim().length < 3) fail('IDENTITY_REASON', 'Укажите основание операции');
    const sourceRow = row(input.source), targetRow = row(input.target); keys(sourceRow, ['format', 'identity', 'descriptor', 'fingerprint', 'physicalKey']); keys(targetRow, ['format', 'descriptor', 'physicalKey']);
    if (!['json', 'sqlite', 'backup'].includes(sourceRow.format as string) || !['json', 'sqlite'].includes(targetRow.format as string)) fail('IDENTITY_FORMAT', 'Не поддерживается формат источника или цели');
    const source: DatabaseLifecycleSource = { format: sourceRow.format as DatabaseLifecycleSource['format'], identity: sourceRow.identity === null ? null : identity(sourceRow.identity), descriptor: sourceRow.descriptor === null ? null : descriptor(sourceRow.descriptor), fingerprint: fingerprint(sourceRow.fingerprint), physicalKey: text(sourceRow.physicalKey, 'каталог источника') };
    const target: DatabaseLifecycleTarget = { format: targetRow.format as DatabaseLifecycleTarget['format'], descriptor: descriptor(targetRow.descriptor), physicalKey: text(targetRow.physicalKey, 'целевой каталог') };
    if (target.descriptor.schemaVersion !== 3) fail('IDENTITY_TARGET_SCHEMA', 'Новая копия должна использовать текущую схему 3');
    if (source.physicalKey === target.physicalKey) fail('IDENTITY_TARGET_SOURCE', 'Для операции нужна отдельная новая цель');
    if (!Array.isArray(input.knownHeads ?? [])) fail('IDENTITY_INPUT', 'Некорректные метаданные известных профилей');
    const heads = ((input.knownHeads ?? []) as JsonValue[]).map(head).sort((a, b) => stable(a) < stable(b) ? -1 : stable(a) > stable(b) ? 1 : 0);
    const byPhysical = new Map<string, string>(); for (const item of heads) { const proof = stable(item); if (byPhysical.has(item.physicalKey) && byPhysical.get(item.physicalKey) !== proof) fail('IDENTITY_HEAD_AMBIGUOUS', 'Физический каталог имеет противоречивые метаданные'); byPhysical.set(item.physicalKey, proof); }
    if (byPhysical.has(target.physicalKey)) fail('IDENTITY_TARGET_EXISTS', 'Цель уже содержит известную базу; выберите отдельный новый каталог');
    let targetIdentity: DatabaseIdentity, predecessor: DatabaseLifecycleHead | null = null;
    const warnings: DatabaseLifecycleIssue[] = [];
    if (action === 'clone') {
      if (input.continuationOf !== undefined) fail('IDENTITY_INPUT', 'Независимая копия не продолжает прежнее поколение');
      const uuid = text(ctx.newUuid, 'новый UUID', 36); if (!uuidPattern.test(uuid)) fail('IDENTITY_INVALID', 'Новый UUID должен быть подтверждён хостом до просмотра');
      if (uuid === source.identity?.uuid || heads.some(item => item.identity.uuid === uuid)) fail('IDENTITY_UUID_REUSED', 'Независимой копии нужен новый UUID');
      targetIdentity = { format: 'tvs-database-identity', version: 1, uuid, generation: 1 };
    } else if (action === 'relocate') {
      if (!source.identity || source.descriptor?.schemaVersion !== 3 || source.format === 'backup') fail('IDENTITY_SOURCE_UNVERIFIED', 'Перемещение требует текущую базу с подтверждённой идентичностью');
      if (input.continuationOf !== undefined) fail('IDENTITY_INPUT', 'Перемещение сохраняет текущее поколение');
      if (heads.some(item => item.identity.uuid === source.identity!.uuid && item.identity.generation > source.identity!.generation)) fail('IDENTITY_SOURCE_SUPERSEDED', 'Известно более новое поколение этой базы');
      targetIdentity = { ...source.identity };
      warnings.push({ severity: 'warning', code: 'IDENTITY_RELOCATION_RETAINS_SOURCE', message: 'Исходная папка сохраняется. Переключение профиля выполняется отдельно; одновременная работа двух копий не подтверждается.' });
    } else {
      if (source.format !== 'backup' || !source.identity) fail('IDENTITY_SOURCE_UNVERIFIED', 'Продолжение требует резервный пакет с сохранённой идентичностью');
      predecessor = head(input.continuationOf);
      if (predecessor.identity.uuid !== source.identity.uuid || predecessor.identity.generation < source.identity.generation) fail('IDENTITY_PREDECESSOR', 'Выбранное поколение не подтверждает продолжение этого пакета');
      if (!heads.some(item => stable(item) === stable(predecessor))) fail('IDENTITY_HEAD_UNVERIFIED', 'Не подтверждены актуальные метаданные предшествующей базы');
      if (heads.some(item => item.identity.uuid === source.identity!.uuid && item.identity.generation > predecessor!.identity.generation)) fail('IDENTITY_PREDECESSOR_STALE', 'Известно более новое поколение; выберите и проверьте действующий источник');
      if (predecessor.identity.generation === Number.MAX_SAFE_INTEGER) fail('IDENTITY_GENERATION_LIMIT', 'Нельзя безопасно увеличить номер поколения');
      targetIdentity = { ...predecessor.identity, generation: predecessor.identity.generation + 1 };
    }
    const history: DatabaseLifecycleHistory = { version: 1, kind: 'database-lifecycle', action, operationId, at, actor, reason, sourceFingerprint: source.fingerprint, sourceIdentity: source.identity, targetIdentity, sourceDescriptor: source.descriptor, targetDescriptor: target.descriptor, predecessor };
    const hash = getHash?.(); if (!hash || typeof hash.sha256 !== 'function') fail('MODULE_UNAVAILABLE', 'Не загружена проверка отпечатка плана');
    const digest = hash.sha256(stable({ version: 1, action, operationId, actor, reason, source, target: { ...target, identity: targetIdentity }, predecessor, knownHeads: heads }));
    const reviewFingerprint = digest.startsWith('sha256:') ? digest : 'sha256:' + digest; if (!digestPattern.test(reviewFingerprint)) fail('MODULE_UNAVAILABLE', 'Некорректный отпечаток плана');
    return freeze({ version: 1, action, operationId, source, target: { ...target, identity: targetIdentity }, predecessor, history, reviewFingerprint, warnings,
      constraints: { sourceFingerprint: source.fingerprint, sourcePhysicalKey: source.physicalKey, targetPhysicalKey: target.physicalKey, headMetadataStamp: predecessor?.metadataStamp ?? null, copyOnly: true, preserveBusinessBytes: true, retargetReceipts: false } });
  }
  function preview(input: unknown, ctx: unknown): DatabaseLifecyclePreview {
    try { const plan = build(input, ctx); return freeze({ canApply: true, issues: [], warnings: plan.warnings, reviewFingerprint: plan.reviewFingerprint, sourceIdentity: plan.source.identity, targetIdentity: plan.target.identity, sourceDescriptor: plan.source.descriptor, targetDescriptor: plan.target.descriptor, history: plan.history, plan }); }
    catch (caught) { const error = caught as LifecycleError; return freeze({ canApply: false, issues: [{ severity: 'error', code: error.code || 'IDENTITY_INVALID', message: error.message }], warnings: [], reviewFingerprint: null, sourceIdentity: null, targetIdentity: null, sourceDescriptor: null, targetDescriptor: null, history: null, plan: null }); }
  }
  function plan(input: unknown, ctx: unknown): DatabaseLifecyclePlan { const value = row(safe(input)), result = build(value, ctx); if (value.reviewFingerprint !== result.reviewFingerprint) fail('STALE_REVIEW', 'План базы изменился после просмотра'); return result; }
  return freeze({ apiVersion: 1 as const, describe: () => freeze({ actions: actions.slice(), currentSchemaVersion: 3, copyOnly: true, sourceRemoval: false, automaticProfileSwitch: false, receiptRetargeting: false }), preview, plan });
}
export type DatabaseLifecycleAPI = ReturnType<typeof createDatabaseLifecycle>;
