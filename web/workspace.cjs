'use strict';

// A workspace is a set of complete canonical sections, never query pages.
// History is loaded separately because validating its proofs is proportional
// to past operations rather than the business rows displayed on a page.
const storage = require('../electron/storage.js');
const sqlite = require('../electron/sqlite-storage.cjs');
const access = require('../electron/access-control.js');
const accessContext = require('../electron/access-context.cjs');
const documentAccess = require('../electron/document-access.cjs');
const platform = require('../electron/platform-service.cjs');
const format = require('../electron/storage-format.cjs');
const SECTIONS = storage.SECTIONS;
const DEFAULT_SECTIONS = Object.freeze(SECTIONS.filter(name => name !== 'auditLog'));
const fail = (code, message, status = 400) => Object.assign(Error(message), { code, status });
const CACHE_BYTES = 32 * 1024 * 1024, CACHE_ENTRIES = 16;
// Values are serialized here after trusted projection, never caller objects.
// Strings are immutable, and each response owns a newly parsed result tree.
const projected = new Map();
let projectedBytes = 0;
function remember(key, json) {
  const bytes = 2 * (key.length + json.length);
  if (bytes > CACHE_BYTES) return;
  if (projected.has(key)) { projectedBytes -= projected.get(key).bytes; projected.delete(key); }
  while (projected.size >= CACHE_ENTRIES || projectedBytes + bytes > CACHE_BYTES) {
    const oldest = projected.keys().next().value; projectedBytes -= projected.get(oldest).bytes; projected.delete(oldest);
  }
  projected.set(key, { json, bytes }); projectedBytes += bytes;
}
function projection(key) {
  const cached = projected.get(key);
  if (!cached) return null;
  projected.delete(key); projected.set(key, cached); return cached.json;
}

function normalizeSections(names) {
  if (names === undefined) return DEFAULT_SECTIONS.slice();
  if (!Array.isArray(names) || !names.length || names.length > SECTIONS.length || names.some(name => typeof name !== 'string' || !SECTIONS.includes(name)) || new Set(names).size !== names.length)
    throw fail('WORKSPACE_SECTIONS_INVALID', 'Нужен список известных разделов без повторов.');
  return SECTIONS.filter(name => names.includes(name));
}
function publicAccess(principal) {
  const normalized = accessContext.normalizePrincipal(principal);
  return {
    policyStamp: normalized.policyStamp, ...(normalized.accessPolicy !== undefined ? { accessPolicy: normalized.accessPolicy } : {}),
    user: { id: normalized.id, name: normalized.name, role: normalized.role, legacy: !!normalized.legacy },
    readable: SECTIONS.filter(name => documentAccess.permitted(normalized, 'read', name)),
    writable: SECTIONS.filter(name => documentAccess.permitted(normalized, 'write', name)),
    fieldPermissions: access.fieldPermissions(normalized), periodActions: require('../electron/period-access.cjs').actions(normalized),
    fuelActions: access.fuelActions(normalized), procurementActions: access.procurementActions(normalized), costActions: access.costActions(normalized),
    repairActions: access.repairActions(normalized), calendarActions: access.calendarActions(normalized), printActions: access.printActions(normalized), importActions: access.importActions(normalized),
  };
}
function hasRestrictions(principal) {
  return accessContext.hasNarrowing(principal) || ['readable', 'writable'].some(name => principal[name] && !principal[name].includes('*'));
}
function workspaceResult(dataJSON, envelope, framed) {
  // The frame crosses only the trusted server module boundary. Its large JSON
  // string was produced here from canonical rows; response metadata is fresh
  // and independently owned so compatibility can be attached before the ACK.
  return framed ? Object.freeze({ envelope, dataJSON }) : { data: JSON.parse(dataJSON), ...envelope };
}
function fullResult(snapshot, principal, framed) {
  const result = { ...snapshot, access: publicAccess(principal), loadedSections: SECTIONS.slice() };
  if (!framed) return result;
  const { data, ...envelope } = result;
  return workspaceResult(JSON.stringify(data), envelope, true);
}
function readWorkspaceResult(dataDir, { principal, sections } = {}, framed, consume) {
  if (!principal) throw fail('ACCESS_DENIED', 'Требуется действующая учётная запись.', 401);
  const current = accessContext.normalizePrincipal(principal), names = normalizeSections(sections);
  const publish = value => {
    if (!consume) return value;
    const result = consume(value);
    if (result && typeof result.then === 'function') {
      if (typeof result.catch === 'function') result.catch(() => {});
      throw fail('WORKSPACE_CONSUMER_ASYNC', 'Обработка снимка должна быть синхронной.', 500);
    }
    return result;
  };
  return storage.withDatabaseLock(dataDir, physical => {
    // Scoped projection needs ownership closure and a complete section witness.
    // Keep the established full reader until a narrower closure is proven.
    if (!sqlite.exists(physical) || hasRestrictions(current) || names.includes('auditLog')) {
      const snapshot = storage.readSnapshot(physical, { principal: current });
      return publish(fullResult(snapshot, current, framed));
    }
    const result = sqlite.transaction(physical, () => {
      const version = sqlite.schemaVersion(physical);
      if (version !== format.SCHEMA_VERSION) {
        const snapshot = storage.readSnapshot(physical, { principal: current });
        return fullResult(snapshot, current, framed);
      }
      const readable = new Set(SECTIONS.filter(name => documentAccess.permitted(current, 'read', name)));
      const selected = [...new Set([...names.filter(name => readable.has(name)), 'appMeta'])];
      const stored = sqlite.readRawSections(physical, selected);
      // Retain archive validation even when the page itself does not display
      // appMeta. Fresh stored archive bytes remain mandatory on every hit.
      const appMeta = stored.rows.filter(row => row.section === 'appMeta').map(row => JSON.parse(row.row_json));
      require('../electron/document-archive.cjs').validateState(physical, { appMeta });
      const key = JSON.stringify([version, names, current.role, current.policyStamp, stored.fingerprint]);
      let json = projection(key);
      if (json === null) {
        const raw = Object.fromEntries(names.map(name => [name, []]));
        for (const row of stored.rows) if (Object.hasOwn(raw, row.section)) raw[row.section].push(JSON.parse(row.row_json));
        const prepared = accessContext.create(raw, raw, current);
        const data = Object.fromEntries(names.map(name => [name, readable.has(name) ? platform.visibleRows(name, raw[name], current, raw, prepared) : []]));
        json = JSON.stringify(data); remember(key, json);
      }
      const revisions = sqlite.readRevisions(physical), descriptor = sqlite.readDescriptor(physical);
      return workspaceResult(json, {
        loadedSections: names, revisions: Object.fromEntries(SECTIONS.map(name => [name, readable.has(name) ? revisions[name] || 0 : 0])),
        databaseToken: storage.databaseToken(physical), access: publicAccess(current), scopeViews: {},
        platform: { apiVersion: 1, storageKind: 'sqlite', operations: 1, outbox: 1, receiptQuery: 1, commands: 1,
          schemaVersion: version, currentSchemaVersion: format.SCHEMA_VERSION, descriptor, readOnly: false,
          documentDrafts: 1, periods: 1, fuelOperations: 1, procurement: 1, costAccounting: 1, repairs: 1, calendar: 1,
          personnelPlanning: 1, documentPrint: 1, controlledImports: 1, needsSchemaUpgrade: false },
      }, framed);
    }, { readOnly: true });
    // Publish only after the read transaction completed, while the same
    // physical lock still prevents a managed writer from changing the source.
    return publish(result);
  });
}
function readWorkspace(dataDir, options) { return readWorkspaceResult(dataDir, options, false); }
function readWorkspaceFrame(dataDir, options) { return readWorkspaceResult(dataDir, options, true); }
function withWorkspaceFrame(dataDir, options, consume) {
  if (typeof consume !== 'function' || consume.constructor?.name === 'AsyncFunction')
    throw fail('WORKSPACE_CONSUMER_ASYNC', 'Нужен синхронный обработчик снимка.', 500);
  return readWorkspaceResult(dataDir, options, true, consume);
}

module.exports = Object.freeze({ DEFAULT_SECTIONS, normalizeSections, readWorkspace, readWorkspaceFrame, withWorkspaceFrame, publicAccess });
