/** Runtime contracts shared by browser commands and the trusted storage boundary. */
export type Identifier = string | number;
export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [field: string]: JsonValue };
export type JsonRow = { [field: string]: JsonValue };
export type SectionRows = Record<string, JsonRow[]>;
export type Revisions = Record<string, number>;
export interface OperationDescriptor { id: string; digest?: string }
export interface SectionWrite { base: Revisions; sections: SectionRows; operation?: OperationDescriptor; databaseToken?: string }
export interface ContractError extends Error { code: string; field: string; status: number }

export function createPlatformContracts() {
  function fail(code: string, field: string, message: string): never {
    const error = new Error(message) as ContractError;
    error.name = 'PlatformContractError'; error.code = code; error.field = field; error.status = 400;
    throw error;
  }
  function object(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Object.prototype.toString.call(value) !== '[object Object]') return false;
    const prototype: unknown = Object.getPrototypeOf(value);
    return prototype === null || typeof prototype === 'object' && Object.getPrototypeOf(prototype) === null;
  }
  function identifier(value: unknown): value is Identifier {
    return typeof value === 'string' && value.trim().length > 0 || typeof value === 'number' && Number.isFinite(value);
  }
  function json(value: unknown, field: string, parents = new Set<object>(), depth = 0): asserts value is JsonValue {
    if (depth > 100) fail('INVALID_JSON', field, 'Слишком глубокая структура данных');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (typeof value !== 'object' || value === null || !Array.isArray(value) && !object(value))
      fail('INVALID_JSON', field, 'Значение нельзя сохранить как JSON');
    if (parents.has(value)) fail('INVALID_JSON', field, 'Циклическая структура данных');
    parents.add(value);
    for (const key of Object.keys(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('INVALID_JSON', field, 'Недопустимое имя поля');
      // JSON must mean the same thing in a digest, in memory and on disk.
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor?.get || descriptor?.set) fail('INVALID_JSON', field, 'В данных недопустимы исполняемые свойства');
      json(descriptor?.value, field ? field + '.' + key : key, parents, depth + 1);
    }
    parents.delete(value);
  }
  function validateOperation(value: unknown): OperationDescriptor {
    if (!object(value) || typeof value.id !== 'string' || !/^[a-zA-Z0-9._:-]{1,200}$/.test(value.id))
      fail('INVALID_OPERATION', 'operation.id', 'Некорректный идентификатор операции');
    if (value.digest !== undefined && (typeof value.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value.digest)))
      fail('INVALID_OPERATION', 'operation.digest', 'Некорректный отпечаток операции');
    return value.digest === undefined ? { id: value.id } : { id: value.id, digest: value.digest as string };
  }
  function validateSections(value: unknown, registry: readonly string[]): SectionRows {
    if (!object(value)) fail('INVALID_SECTIONS', 'sections', 'Некорректные разделы платформы');
    const names = new Set(registry);
    for (const [name, rows] of Object.entries(value)) {
      if (!names.has(name) || !Array.isArray(rows)) fail('INVALID_SECTIONS', name, 'Некорректный раздел платформы: ' + name);
      for (const [index, row] of rows.entries()) {
        if (!object(row)) fail('INVALID_SECTIONS', name + '.' + index, 'Запись раздела должна быть объектом');
        json(row, name + '.' + index);
      }
    }
    return value as SectionRows;
  }
  function validateRevisions(value: unknown, registry: readonly string[]): Revisions {
    if (!object(value)) fail('INVALID_BASE', 'base', 'Нужны исходные версии разделов');
    const names = new Set(registry);
    for (const [name, revision] of Object.entries(value)) {
      if (!names.has(name) || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0)
        fail('INVALID_BASE', 'base.' + name, 'Некорректная исходная версия раздела');
    }
    return value as Revisions;
  }
  function parseSectionWrite(value: unknown, registry: readonly string[]): SectionWrite {
    if (!object(value)) fail('INVALID_SECTIONS', '', 'Неверный запрос сохранения');
    const result: SectionWrite = { base: validateRevisions(value.base, registry), sections: validateSections(value.sections, registry) };
    if (value.operation !== undefined) result.operation = validateOperation(value.operation);
    if (value.databaseToken !== undefined) {
      if (typeof value.databaseToken !== 'string' || !value.databaseToken) fail('INVALID_DATABASE_TOKEN', 'databaseToken', 'Неверная идентичность базы');
      result.databaseToken = value.databaseToken;
    }
    return result;
  }
  return Object.freeze({ apiVersion: 1 as const, identifier, validateOperation, validateSections, validateRevisions, parseSectionWrite });
}
