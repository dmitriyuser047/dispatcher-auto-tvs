'use strict';
// Business schema versions are independent of the JSON/SQLite container format.
const schema = require('../assets/core/platform-schema.js');
const FORMAT = 'tvs-platform-json', FORMAT_VERSION = 1, SCHEMA_VERSION = 4;
const SUPPORTED_READ_SCHEMAS = Object.freeze([1, 2, 3, 4]);
const FEATURES_V3 = Object.freeze(['controlled-import-v1', 'document-lifecycle-v1', 'row-scope-v1', 'sealed-print-v1']);
const FEATURES = Object.freeze(['controlled-import-v1', 'document-lifecycle-v1', 'operation-receipts-v1', 'row-scope-v1', 'sealed-print-v1']);
const legacySections = () => schema.sections.filter(name => name !== 'documentDrafts');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function fail(code, message) { throw Object.assign(new Error(message), { code, status: 428 }); }
function isCurrent(version) { return version === SCHEMA_VERSION; }
function describe(version, features) {
  if (!SUPPORTED_READ_SCHEMAS.includes(version)) fail('STORAGE_FORMAT', 'Неподдерживаемая версия схемы базы');
  const expected = version === 4 ? FEATURES : version === 3 ? FEATURES_V3 : [];
  const wanted = features === undefined ? expected : features;
  if (!Array.isArray(wanted) || wanted.some(value => typeof value !== 'string') || new Set(wanted).size !== wanted.length || wanted.length !== expected.length || wanted.some(value => !expected.includes(value))) fail('STORAGE_CAPABILITY', 'Не поддерживаются обязательные возможности базы');
  return Object.freeze({ schemaVersion: version, minReader: version, minWriter: version === 4 ? 4 : 3, features: Object.freeze(wanted.slice().sort()) });
}
function validateDescriptor(value, version = value?.schemaVersion) {
  if (!plain(value) || Object.keys(value).length !== 4 || Object.keys(value).some(key => !['schemaVersion', 'minReader', 'minWriter', 'features'].includes(key)) || value.schemaVersion !== version || value.minReader !== version || value.minWriter !== (version === 4 ? 4 : 3)) fail('STORAGE_COMPATIBILITY', 'Повреждено подтверждение совместимости базы');
  const result = describe(version, value.features);
  if (JSON.stringify(value.features) !== JSON.stringify(result.features)) fail('STORAGE_COMPATIBILITY', 'Возможности базы должны быть в каноническом порядке');
  return result;
}
function decodeRevisions(raw) {
  if (!plain(raw)) fail('STORAGE_FORMAT', 'Повреждены версии разделов базы');
  if (Object.hasOwn(raw, 'format')) {
    const version = raw.schemaVersion;
    if (raw.format !== FORMAT || raw.formatVersion !== FORMAT_VERSION || ![2, 3, 4].includes(version) || raw.vehicles !== null || raw.records !== null || !plain(raw.revisions) || Object.keys(raw).some(name => !['format', 'formatVersion', 'schemaVersion', 'vehicles', 'records', 'revisions', ...(version >= 3 ? ['compatibility'] : []), ...(version === 4 ? ['operationState'] : [])].includes(name))) fail('STORAGE_FORMAT', 'Неподдерживаемая версия JSON базы');
    const descriptor = version >= 3 ? validateDescriptor(raw.compatibility, version) : describe(version);
    const revisions = raw.revisions;
    if (Object.keys(revisions).length !== schema.sections.length || schema.sections.some(name => !Number.isSafeInteger(revisions[name]) || revisions[name] < 0) || Object.keys(revisions).some(name => !schema.sections.includes(name))) fail('STORAGE_REVISIONS', 'Повреждены версии разделов базы');
    return { schemaVersion: version, revisions: { ...revisions }, descriptor, ...(version === 4 ? {operationState:validateOperationState(raw.operationState)} : {}) };
  }
  if (Object.keys(raw).some(name => !legacySections().includes(name)) || ['vehicles', 'records'].some(name => !Number.isSafeInteger(raw[name]) || raw[name] < 0) || Object.values(raw).some(value => !Number.isSafeInteger(value) || value < 0)) fail('STORAGE_REVISIONS', 'Неизвестная или повреждённая структура старой JSON базы');
  return { schemaVersion: 1, revisions: Object.fromEntries(schema.sections.map(name => [name, raw[name] ?? 0])), descriptor: describe(1) };
}
function validateOperationState(value) {
  if (!plain(value) || Object.keys(value).length !== 3 || Object.keys(value).some(key=>!['version','transactionId','head'].includes(key)) || value.version !== 1 || typeof value.transactionId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value.transactionId)) fail('STORAGE_OPERATION_STATE','Не подтверждено состояние истории операций');
  return Object.freeze({version:1,transactionId:value.transactionId,head:require('./operation-ledger.cjs').validateHead(value.head)});
}
function createOperationState(head) {
  return validateOperationState({version:1,transactionId:require('node:crypto').randomUUID(),head:head===undefined?{version:1,lastSeq:0,receiptRoot:null,auditHead:null,hot:[]}:head});
}
function encodeRevisions(revisions, descriptor = describe(SCHEMA_VERSION), operationState = createOperationState()) {
  const compatibility = validateDescriptor(descriptor, SCHEMA_VERSION);
  const result = { format: FORMAT, formatVersion: FORMAT_VERSION, schemaVersion: SCHEMA_VERSION, vehicles: null, records: null, revisions, compatibility, operationState:validateOperationState(operationState) };
  decodeRevisions(result); return result;
}
function upgradeRequired() { fail('SCHEMA_UPGRADE_REQUIRED', 'База открыта только для чтения. Создайте отдельную обновлённую копию. Исходная база останется без изменений.'); }
function assertWriter(options = {}) {
  if (options.requireWriterSchema === true && options.writerSchemaVersion !== SCHEMA_VERSION) fail('WRITER_SCHEMA_REQUIRED', 'Для записи требуется клиент с поддержкой схемы 4. Обновите программу.');
}
module.exports = Object.freeze({ FORMAT, FORMAT_VERSION, SCHEMA_VERSION, SUPPORTED_READ_SCHEMAS, FEATURES, FEATURES_V3, legacySections, isCurrent, describe, validateDescriptor, decodeRevisions, encodeRevisions, validateOperationState, createOperationState, upgradeRequired, assertWriter });
