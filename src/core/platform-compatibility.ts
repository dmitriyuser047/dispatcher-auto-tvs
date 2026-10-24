/** Bounded compatibility negotiation only. The host owns authentication,
 * current access, signed transport tickets and immutable operation journals. */
export interface CompatibilityCapability { readonly name: string; readonly versions: readonly number[] }
export interface CompatibilityRequirement { readonly name: string; readonly version: number }
export interface PlatformCompatibilityHello {
  readonly version: 1;
  readonly protocolVersions: readonly number[];
  readonly readerSchemaVersions: readonly number[];
  readonly writerSchemaVersions: readonly number[];
  readonly capabilities: readonly CompatibilityCapability[];
}
export interface PlatformCompatibilityServerProfile {
  readonly version: 1;
  readonly protocolVersions: readonly number[];
  readonly writerSchemaVersions: readonly number[];
  readonly capabilities: readonly CompatibilityCapability[];
  readonly requiredReadCapabilities: readonly CompatibilityRequirement[];
  readonly requiredWriteCapabilities: readonly CompatibilityRequirement[];
  readonly readOnly: boolean;
}
export interface CompatibilityDatabaseDescriptor {
  readonly schemaVersion: 1 | 2 | 3 | 4 | 5;
  readonly minReader: 1 | 2 | 3 | 4 | 5;
  readonly minWriter: 3 | 4 | 5;
  readonly features: readonly string[];
}
export type CompatibilityMode = 'read-write' | 'read-only' | 'unsupported';
export type CompatibilityReasonCode =
  | 'HELLO_INVALID' | 'HELLO_VERSION_UNSUPPORTED' | 'SERVER_PROFILE_INVALID' | 'SERVER_PROFILE_VERSION_UNSUPPORTED'
  | 'DATABASE_DESCRIPTOR_INVALID' | 'DATABASE_SCHEMA_UNSUPPORTED' | 'DATABASE_FEATURE_UNSUPPORTED'
  | 'PROFILE_TOO_LARGE' | 'READER_UNVERIFIED' | 'READER_SCHEMA_UNSUPPORTED' | 'LEGACY_SERVER_READ_ONLY'
  | 'SERVER_UNVERIFIED' | 'DATABASE_READ_ONLY' | 'SERVER_READ_ONLY' | 'PROTOCOL_UNSUPPORTED'
  | 'WRITER_SCHEMA_UNSUPPORTED' | 'REQUIRED_READ_CAPABILITY_UNKNOWN' | 'REQUIRED_READ_CAPABILITY_UNAVAILABLE'
  | 'REQUIRED_READ_CAPABILITY_CONFLICT' | 'REQUIRED_WRITE_CAPABILITY_UNKNOWN'
  | 'REQUIRED_WRITE_CAPABILITY_UNAVAILABLE' | 'REQUIRED_WRITE_CAPABILITY_CONFLICT';
export interface CompatibilityReason {
  readonly code: CompatibilityReasonCode;
  readonly scope: 'hello' | 'server' | 'database' | 'read' | 'write';
  readonly capability?: string;
  readonly version?: number;
}
export interface CompatibilityAcceptedCapability { readonly name: string; readonly version: number }
export interface CompatibilitySelectedProfile {
  readonly protocolVersion: number | null;
  readonly readerSchemaVersion: 1 | 2 | 3 | 4 | 5;
  readonly writerSchemaVersion: 5 | null;
  readonly capabilities: readonly CompatibilityAcceptedCapability[];
}
export interface PlatformCompatibilityResult {
  readonly version: 1;
  readonly mode: CompatibilityMode;
  readonly readCompatible: boolean;
  readonly writeCompatible: boolean;
  readonly selectedProfile: CompatibilitySelectedProfile | null;
  readonly databaseDescriptor: CompatibilityDatabaseDescriptor | null;
  readonly reasons: readonly CompatibilityReason[];
  readonly constraints: {
    readonly compatibilityOnly: true; readonly requiresCurrentAccess: true; readonly requiresWriteTicket: true;
    readonly preserveIntent: true; readonly retargetOutbox: false;
  };
}
export interface PlatformCompatibilityDescription {
  readonly apiVersion: 1; readonly profileVersion: 1;
  readonly hello: PlatformCompatibilityHello;
  readonly serverProfile: PlatformCompatibilityServerProfile;
  readonly databaseFeatures: readonly string[];
  readonly limits: { readonly maxBytes: number; readonly maxNodes: number; readonly maxDepth: number; readonly maxCapabilities: number; readonly maxVersions: number; readonly maxNameLength: number; readonly maxVersion: number };
  readonly constraints: PlatformCompatibilityResult['constraints'];
}
interface Contracts { readonly apiVersion: number }
interface Schema { readonly apiVersion: number; readonly sections: readonly string[] }
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Row = { [key: string]: Json };
const FEATURES_V3 = ['controlled-import-v1', 'document-lifecycle-v1', 'row-scope-v1', 'sealed-print-v1'] as const;
const FEATURES_V4 = ['controlled-import-v1', 'document-lifecycle-v1', 'operation-receipts-v1', 'row-scope-v1', 'sealed-print-v1'] as const;
const FEATURES = ['controlled-import-v1', 'document-lifecycle-v1', 'generator-maintenance-v1', 'generator-spares-v1', 'operation-receipts-v1', 'row-scope-v1', 'sealed-print-v1'] as const;
const CAPABILITIES = ['commands', 'controlledImports', 'documentPrint', 'fuelCalculationsV5', 'fuelCalculationsV6', 'generatorSparesV1', 'generatorMaintenanceV1', 'operations', 'outbox', 'scopedAccess', 'seasonalFuelNormsV1', ...FEATURES].slice().sort();
const LIMITS = Object.freeze({ maxBytes: 32768, maxNodes: 4096, maxDepth: 8, maxCapabilities: 64, maxVersions: 8, maxNameLength: 64, maxVersion: 65535 });
const BASE_READ: readonly CompatibilityRequirement[] = [{ name: 'scopedAccess', version: 1 }];
const GENERATOR_READ: readonly CompatibilityRequirement[] = [{ name: 'generatorSparesV1', version: 1 }, { name: 'generatorMaintenanceV1', version: 1 }];
const BASE_WRITE: readonly CompatibilityRequirement[] = [{ name: 'commands', version: 1 }, { name: 'fuelCalculationsV5', version: 1 }, { name: 'fuelCalculationsV6', version: 1 }, { name: 'operations', version: 1 }, { name: 'outbox', version: 1 }];
const CONSTRAINTS = Object.freeze({ compatibilityOnly: true as const, requiresCurrentAccess: true as const, requiresWriteTicket: true as const, preserveIntent: true as const, retargetOutbox: false as const });
class CompatibilityValidationError extends Error {
  constructor(readonly reason: CompatibilityReason) { super(reason.code); this.name = 'CompatibilityValidationError'; }
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

export function createPlatformCompatibility(contracts: Contracts, schema?: Schema) {
  if (contracts?.apiVersion !== 1 || schema !== undefined && (schema.apiVersion !== 1 || !Array.isArray(schema.sections))) {
    throw Object.assign(new Error('Не загружены контракты совместимости платформы'), { code: 'MODULE_UNAVAILABLE', status: 503 });
  }
  const knownCapabilities = new Set(CAPABILITIES);
  function fail(code: CompatibilityReasonCode, scope: CompatibilityReason['scope']): never { throw new CompatibilityValidationError({ code, scope }); }
  function bytes(text: string): number {
    let size = 0;
    for (const char of text) { const code = char.codePointAt(0)!; size += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4; }
    return size;
  }
  function safe(input: unknown, code: CompatibilityReasonCode, scope: CompatibilityReason['scope']): Json {
    let size = 0, nodes = 0; const parents = new Set<object>();
    function add(value: number): void { size += value; if (size > LIMITS.maxBytes) fail('PROFILE_TOO_LARGE', scope); }
    function copy(value: unknown, depth: number): Json {
      if (++nodes > LIMITS.maxNodes || depth > LIMITS.maxDepth) fail('PROFILE_TOO_LARGE', scope);
      if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) { add(JSON.stringify(value).length); return value; }
      if (typeof value === 'string') { if (value.length > LIMITS.maxBytes) fail('PROFILE_TOO_LARGE', scope); add(bytes(JSON.stringify(value))); return value; }
      if (!value || typeof value !== 'object' || parents.has(value)) fail(code, scope);
      const array = Array.isArray(value), prototype: unknown = Object.getPrototypeOf(value);
      if (!array && !(prototype === null || typeof prototype === 'object' && prototype !== null && Object.getPrototypeOf(prototype) === null)) fail(code, scope);
      if (array && value.length > LIMITS.maxCapabilities) fail('PROFILE_TOO_LARGE', scope);
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.length > LIMITS.maxCapabilities + 1) fail('PROFILE_TOO_LARGE', scope);
      for (const key of ownKeys) {
        if (array && key === 'length') continue;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (typeof key !== 'string' || key.length > LIMITS.maxNameLength || ['__proto__', 'prototype', 'constructor', 'toJSON'].includes(key) || !descriptor?.enumerable || descriptor.get || descriptor.set || array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) fail(code, scope);
      }
      parents.add(value); add(2); let result: Json;
      if (array) {
        const output: Json[] = [];
        for (let index = 0; index < value.length; index++) { const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); if (!descriptor) fail(code, scope); if (index) add(1); output.push(copy(descriptor.value, depth + 1)); }
        result = output;
      } else {
        const output: Row = {}, keys = Object.keys(value);
        for (const [index, key] of keys.entries()) { add(bytes(JSON.stringify(key)) + 1 + (index ? 1 : 0)); output[key] = copy(Object.getOwnPropertyDescriptor(value, key)!.value, depth + 1); }
        result = output;
      }
      parents.delete(value); return result;
    }
    return copy(input, 0);
  }
  function row(value: Json | undefined, allowed: readonly string[], code: CompatibilityReasonCode, scope: CompatibilityReason['scope']): Row {
    if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) fail(code, scope);
    return value;
  }
  function version(value: Json | undefined, code: CompatibilityReasonCode, scope: CompatibilityReason['scope']): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > LIMITS.maxVersion) fail(code, scope);
    return value;
  }
  function versions(value: Json | undefined, code: CompatibilityReasonCode, scope: CompatibilityReason['scope']): number[] {
    if (!Array.isArray(value) || value.length > LIMITS.maxVersions) fail(code, scope);
    const values = value.map(item => version(item, code, scope)); if (new Set(values).size !== values.length) fail(code, scope);
    return values.slice().sort((a, b) => a - b);
  }
  function name(value: Json | undefined, code: CompatibilityReasonCode, scope: CompatibilityReason['scope']): string {
    if (typeof value !== 'string' || value.length > LIMITS.maxNameLength || !/^[a-z][a-zA-Z0-9:-]*$/.test(value)) fail(code, scope);
    return value;
  }
  function capabilities(value: Json | undefined, code: CompatibilityReasonCode, scope: CompatibilityReason['scope']): CompatibilityCapability[] {
    if (!Array.isArray(value) || value.length > LIMITS.maxCapabilities) fail(code, scope);
    const output = value.map(item => { const data = row(item, ['name', 'versions'], code, scope), values = versions(data.versions, code, scope); if (!values.length) fail(code, scope); return { name: name(data.name, code, scope), versions: values }; });
    if (new Set(output.map(item => item.name)).size !== output.length) fail(code, scope);
    return output.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  }
  function requirements(value: Json | undefined): CompatibilityRequirement[] {
    if (!Array.isArray(value) || value.length > LIMITS.maxCapabilities) fail('SERVER_PROFILE_INVALID', 'server');
    const output = value.map(item => { const data = row(item, ['name', 'version'], 'SERVER_PROFILE_INVALID', 'server'); return { name: name(data.name, 'SERVER_PROFILE_INVALID', 'server'), version: version(data.version, 'SERVER_PROFILE_INVALID', 'server') }; });
    if (new Set(output.map(item => item.name)).size !== output.length) fail('SERVER_PROFILE_INVALID', 'server');
    return output.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  }
  function hello(input: unknown): PlatformCompatibilityHello {
    const data = row(safe(input, 'HELLO_INVALID', 'hello'), ['version', 'protocolVersions', 'readerSchemaVersions', 'writerSchemaVersions', 'capabilities'], 'HELLO_INVALID', 'hello');
    if (data.version !== 1) fail('HELLO_VERSION_UNSUPPORTED', 'hello');
    return { version: 1, protocolVersions: versions(data.protocolVersions, 'HELLO_INVALID', 'hello'), readerSchemaVersions: versions(data.readerSchemaVersions, 'HELLO_INVALID', 'hello'), writerSchemaVersions: versions(data.writerSchemaVersions, 'HELLO_INVALID', 'hello'), capabilities: capabilities(data.capabilities, 'HELLO_INVALID', 'hello') };
  }
  function server(input: unknown): PlatformCompatibilityServerProfile {
    const data = row(safe(input, 'SERVER_PROFILE_INVALID', 'server'), ['version', 'protocolVersions', 'writerSchemaVersions', 'capabilities', 'requiredReadCapabilities', 'requiredWriteCapabilities', 'readOnly'], 'SERVER_PROFILE_INVALID', 'server');
    if (data.version !== 1) fail('SERVER_PROFILE_VERSION_UNSUPPORTED', 'server');
    if (typeof data.readOnly !== 'boolean') fail('SERVER_PROFILE_INVALID', 'server');
    const output: PlatformCompatibilityServerProfile = { version: 1, protocolVersions: versions(data.protocolVersions, 'SERVER_PROFILE_INVALID', 'server'), writerSchemaVersions: versions(data.writerSchemaVersions, 'SERVER_PROFILE_INVALID', 'server'), capabilities: capabilities(data.capabilities, 'SERVER_PROFILE_INVALID', 'server'), requiredReadCapabilities: requirements(data.requiredReadCapabilities), requiredWriteCapabilities: requirements(data.requiredWriteCapabilities), readOnly: data.readOnly };
    for (const required of [...output.requiredReadCapabilities, ...output.requiredWriteCapabilities]) if (!output.capabilities.some(item => item.name === required.name && item.versions.includes(required.version))) fail('SERVER_PROFILE_INVALID', 'server');
    return output;
  }
  function descriptor(input: unknown): CompatibilityDatabaseDescriptor {
    const data = row(safe(input, 'DATABASE_DESCRIPTOR_INVALID', 'database'), ['schemaVersion', 'minReader', 'minWriter', 'features'], 'DATABASE_DESCRIPTOR_INVALID', 'database');
    if (![1, 2, 3, 4, 5].includes(data.schemaVersion as number)) fail('DATABASE_SCHEMA_UNSUPPORTED', 'database');
    if (data.minReader !== data.schemaVersion || data.minWriter !== (data.schemaVersion === 5 ? 5 : data.schemaVersion === 4 ? 4 : 3) || !Array.isArray(data.features) || data.features.some(item => typeof item !== 'string') || new Set(data.features).size !== data.features.length) fail('DATABASE_DESCRIPTOR_INVALID', 'database');
    const expected: readonly string[] = data.schemaVersion === 5 ? FEATURES : data.schemaVersion === 4 ? FEATURES_V4 : data.schemaVersion === 3 ? FEATURES_V3 : [];
    if (data.features.length !== expected.length || data.features.some((item, index) => item !== expected[index])) fail('DATABASE_FEATURE_UNSUPPORTED', 'database');
    return { schemaVersion: data.schemaVersion as 1 | 2 | 3 | 4 | 5, minReader: data.schemaVersion as 1 | 2 | 3 | 4 | 5, minWriter: data.schemaVersion === 5 ? 5 : data.schemaVersion === 4 ? 4 : 3, features: data.features as string[] };
  }
  function result(mode: CompatibilityMode, databaseDescriptor: CompatibilityDatabaseDescriptor | null, selectedProfile: CompatibilitySelectedProfile | null, reasons: readonly CompatibilityReason[]): PlatformCompatibilityResult {
    return freeze({ version: 1, mode, readCompatible: mode !== 'unsupported', writeCompatible: mode === 'read-write', databaseDescriptor, selectedProfile, reasons, constraints: CONSTRAINTS });
  }
  function requiredMap(values: readonly CompatibilityRequirement[], scope: 'read' | 'write', reasons: CompatibilityReason[]): Map<string, number> {
    const output = new Map<string, number>();
    for (const item of values) { const previous = output.get(item.name); if (previous !== undefined && previous !== item.version) reasons.push({ code: scope === 'read' ? 'REQUIRED_READ_CAPABILITY_CONFLICT' : 'REQUIRED_WRITE_CAPABILITY_CONFLICT', scope, capability: item.name, version: item.version }); else output.set(item.name, item.version); }
    return output;
  }
  function accepted(client: PlatformCompatibilityHello, remote: PlatformCompatibilityServerProfile, required: Map<string, number>, scope: 'read' | 'write', reasons: CompatibilityReason[]): CompatibilityAcceptedCapability[] {
    const output: CompatibilityAcceptedCapability[] = [];
    for (const [capability, requiredVersion] of required) {
      if (!knownCapabilities.has(capability)) { reasons.push({ code: scope === 'read' ? 'REQUIRED_READ_CAPABILITY_UNKNOWN' : 'REQUIRED_WRITE_CAPABILITY_UNKNOWN', scope, capability, version: requiredVersion }); continue; }
      const available = requiredVersion === 1 && client.capabilities.some(item => item.name === capability && item.versions.includes(requiredVersion)) && remote.capabilities.some(item => item.name === capability && item.versions.includes(requiredVersion));
      if (!available) reasons.push({ code: scope === 'read' ? 'REQUIRED_READ_CAPABILITY_UNAVAILABLE' : 'REQUIRED_WRITE_CAPABILITY_UNAVAILABLE', scope, capability, version: requiredVersion });
    }
    for (const capability of CAPABILITIES) {
      const clientVersions = client.capabilities.find(item => item.name === capability)?.versions ?? [], serverVersions = remote.capabilities.find(item => item.name === capability)?.versions ?? [], expected = required.get(capability);
      if ((expected === undefined || expected === 1) && clientVersions.includes(1) && serverVersions.includes(1)) output.push({ name: capability, version: 1 });
    }
    return output;
  }
  function negotiate(rawHello: unknown, rawServerProfile: unknown, rawDescriptor: unknown): PlatformCompatibilityResult {
    let stage: CompatibilityReason['scope'] = 'database';
    try {
      const database = descriptor(rawDescriptor); stage = 'hello';
      if (rawHello === null || rawHello === undefined) return result('unsupported', database, null, [{ code: 'READER_UNVERIFIED', scope: 'read' }]);
      const client = hello(rawHello);
      if (!client.readerSchemaVersions.includes(database.minReader)) return result('unsupported', database, null, [{ code: 'READER_SCHEMA_UNSUPPORTED', scope: 'read' }]);
      stage = 'server';
      if (rawServerProfile === null || rawServerProfile === undefined) {
        if (database.schemaVersion >= 3) return result('unsupported', database, null, [{ code: 'SERVER_UNVERIFIED', scope: 'server' }]);
        return result('read-only', database, { protocolVersion: null, readerSchemaVersion: database.minReader, writerSchemaVersion: null, capabilities: [] }, [{ code: 'LEGACY_SERVER_READ_ONLY', scope: 'server' }, { code: 'DATABASE_READ_ONLY', scope: 'database' }]);
      }
      const remote = server(rawServerProfile), readReasons: CompatibilityReason[] = [];
      const readRequirements = requiredMap([...BASE_READ, ...(database.schemaVersion === 5 ? GENERATOR_READ : []), ...database.features.map(item => ({ name: item, version: 1 })), ...remote.requiredReadCapabilities], 'read', readReasons), readCapabilities = accepted(client, remote, readRequirements, 'read', readReasons);
      if (readReasons.length) return result('unsupported', database, null, readReasons);
      const writeReasons: CompatibilityReason[] = [], protocolVersion = client.protocolVersions.includes(1) && remote.protocolVersions.includes(1) ? 1 : null;
      if (database.schemaVersion !== 5) writeReasons.push({ code: 'DATABASE_READ_ONLY', scope: 'database' });
      if (remote.readOnly) writeReasons.push({ code: 'SERVER_READ_ONLY', scope: 'server' });
      if (protocolVersion === null) writeReasons.push({ code: 'PROTOCOL_UNSUPPORTED', scope: 'write' });
      if (!client.writerSchemaVersions.includes(database.minWriter) || !remote.writerSchemaVersions.includes(database.minWriter)) writeReasons.push({ code: 'WRITER_SCHEMA_UNSUPPORTED', scope: 'write' });
      const writeRequirements = requiredMap([...readRequirements].map(([name, version]) => ({ name, version })).concat(BASE_WRITE, remote.requiredWriteCapabilities), 'write', writeReasons), writeCapabilities = accepted(client, remote, writeRequirements, 'write', writeReasons);
      const mode = writeReasons.length ? 'read-only' : 'read-write';
      return result(mode, database, { protocolVersion, readerSchemaVersion: database.minReader, writerSchemaVersion: mode === 'read-write' ? 5 : null, capabilities: mode === 'read-write' ? writeCapabilities : readCapabilities }, writeReasons);
    } catch (caught) {
      const reason = caught instanceof CompatibilityValidationError ? caught.reason : { code: stage === 'database' ? 'DATABASE_DESCRIPTOR_INVALID' as const : stage === 'hello' ? 'HELLO_INVALID' as const : 'SERVER_PROFILE_INVALID' as const, scope: stage };
      return result('unsupported', null, null, [reason]);
    }
  }
  function describe(): PlatformCompatibilityDescription {
    const capabilities = CAPABILITIES.map(name => ({ name, versions: [1] }));
    return freeze({ apiVersion: 1 as const, profileVersion: 1 as const,
      hello: { version: 1 as const, protocolVersions: [1], readerSchemaVersions: [1, 2, 3, 4, 5], writerSchemaVersions: [5], capabilities },
      serverProfile: { version: 1 as const, protocolVersions: [1], writerSchemaVersions: [5], capabilities, requiredReadCapabilities: BASE_READ.map(item => ({ ...item })), requiredWriteCapabilities: BASE_WRITE.map(item => ({ ...item })), readOnly: false },
      databaseFeatures: FEATURES.slice(), limits: { ...LIMITS }, constraints: CONSTRAINTS });
  }
  return freeze({ apiVersion: 1 as const, describe, negotiate });
}
export type PlatformCompatibilityAPI = ReturnType<typeof createPlatformCompatibility>;
