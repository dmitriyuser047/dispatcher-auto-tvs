'use strict';
// Business schema versions are independent of the JSON/SQLite container format.
const schema = require('../assets/core/platform-schema.js');
const FORMAT = 'tvs-platform-json', FORMAT_VERSION = 1, SCHEMA_VERSION = 3;
const SUPPORTED_READ_SCHEMAS = Object.freeze([1, 2, 3]);
const FEATURES = Object.freeze(['controlled-import-v1', 'document-lifecycle-v1', 'row-scope-v1', 'sealed-print-v1']);
const legacySections = () => schema.sections.filter(name => name !== 'documentDrafts');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function fail(code, message) { throw Object.assign(new Error(message), { code, status: 428 }); }
function isCurrent(version) { return version === SCHEMA_VERSION; }
function describe(version, features) {
  if (!SUPPORTED_READ_SCHEMAS.includes(version)) fail('STORAGE_FORMAT', 'Неподдерживаемая версия схемы базы');
  const wanted = features === undefined ? (version === 3 ? FEATURES : []) : features;
  if (!Array.isArray(wanted) || wanted.some(value => typeof value !== 'string') || new Set(wanted).size !== wanted.length || (version === 3 ? wanted.length !== FEATURES.length || wanted.some(value => !FEATURES.includes(value)) : wanted.length)) fail('STORAGE_CAPABILITY', 'Не поддерживаются обязательные возможности базы');
  return Object.freeze({ schemaVersion: version, minReader: version, minWriter: 3, features: Object.freeze(wanted.slice().sort()) });
}
function validateDescriptor(value, version = value?.schemaVersion) {
  if (!plain(value) || Object.keys(value).length !== 4 || Object.keys(value).some(key => !['schemaVersion', 'minReader', 'minWriter', 'features'].includes(key)) || value.schemaVersion !== version || value.minReader !== version || value.minWriter !== 3) fail('STORAGE_COMPATIBILITY', 'Повреждено подтверждение совместимости базы');
  const result = describe(version, value.features);
  if (JSON.stringify(value.features) !== JSON.stringify(result.features)) fail('STORAGE_COMPATIBILITY', 'Возможности базы должны быть в каноническом порядке');
  return result;
}
function decodeRevisions(raw) {
  if (!plain(raw)) fail('STORAGE_FORMAT', 'Повреждены версии разделов базы');
  if (Object.hasOwn(raw, 'format')) {
    const version = raw.schemaVersion;
    if (raw.format !== FORMAT || raw.formatVersion !== FORMAT_VERSION || ![2, 3].includes(version) || raw.vehicles !== null || raw.records !== null || !plain(raw.revisions) || Object.keys(raw).some(name => !['format', 'formatVersion', 'schemaVersion', 'vehicles', 'records', 'revisions', ...(version === 3 ? ['compatibility'] : [])].includes(name))) fail('STORAGE_FORMAT', 'Неподдерживаемая версия JSON базы');
    const descriptor = version === 3 ? validateDescriptor(raw.compatibility, version) : describe(version);
    const revisions = raw.revisions;
    if (Object.keys(revisions).length !== schema.sections.length || schema.sections.some(name => !Number.isSafeInteger(revisions[name]) || revisions[name] < 0) || Object.keys(revisions).some(name => !schema.sections.includes(name))) fail('STORAGE_REVISIONS', 'Повреждены версии разделов базы');
    return { schemaVersion: version, revisions: { ...revisions }, descriptor };
  }
  if (Object.keys(raw).some(name => !legacySections().includes(name)) || ['vehicles', 'records'].some(name => !Number.isSafeInteger(raw[name]) || raw[name] < 0) || Object.values(raw).some(value => !Number.isSafeInteger(value) || value < 0)) fail('STORAGE_REVISIONS', 'Неизвестная или повреждённая структура старой JSON базы');
  return { schemaVersion: 1, revisions: Object.fromEntries(schema.sections.map(name => [name, raw[name] ?? 0])), descriptor: describe(1) };
}
function encodeRevisions(revisions, descriptor = describe(3)) {
  const compatibility = validateDescriptor(descriptor, 3);
  const result = { format: FORMAT, formatVersion: FORMAT_VERSION, schemaVersion: 3, vehicles: null, records: null, revisions, compatibility };
  decodeRevisions(result); return result;
}
function upgradeRequired() { fail('SCHEMA_UPGRADE_REQUIRED', 'База открыта только для чтения. Создайте отдельную обновлённую копию. Исходная база останется без изменений.'); }
function assertWriter(options = {}) {
  if (options.requireWriterSchema === true && options.writerSchemaVersion !== SCHEMA_VERSION) fail('WRITER_SCHEMA_REQUIRED', 'Для записи требуется клиент с поддержкой схемы 3. Обновите программу.');
}
module.exports = Object.freeze({ FORMAT, FORMAT_VERSION, SCHEMA_VERSION, SUPPORTED_READ_SCHEMAS, FEATURES, legacySections, isCurrent, describe, validateDescriptor, decodeRevisions, encodeRevisions, upgradeRequired, assertWriter });
