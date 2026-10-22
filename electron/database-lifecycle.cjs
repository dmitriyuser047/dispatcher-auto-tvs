'use strict';
// Metadata inspection only. No application/storage reader, recovery, identity
// creation, directory enumeration, checkpoint or profile switch is permitted.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const format = require('./storage-format.cjs'), identities = require('./database-identity.cjs');
const rollbackJournals = require('./sqlite-rollback.cjs');
const fold = value => process.platform === 'win32' ? value.toLowerCase() : value;
const hash = value => 'sha256:' + crypto.createHash('sha256').update(value).digest('hex');
const stable = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? '[' + value.map(stable).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
function freeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function fail(code) { throw Object.assign(new Error(code), { code }); }
function info(file) { try { return fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
function regular(directory, name, maximum) {
  const file = path.join(directory, name), stat = info(file); if (!stat) return null;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || stat.size > maximum || fold(fs.realpathSync.native(file)) !== fold(file)) fail('IDENTITY_METADATA_FILE');
  return { file, stat };
}
function jsonMetadata(directory, name, maximum) {
  const found = regular(directory, name, maximum); if (!found) return null;
  const bytes = fs.readFileSync(found.file), after = fs.lstatSync(found.file);
  if (after.ino !== found.stat.ino || after.dev !== found.stat.dev || after.size !== found.stat.size || after.mtimeMs !== found.stat.mtimeMs) fail('IDENTITY_METADATA_CHANGED');
  let value; try { value = JSON.parse(bytes.toString('utf8')); } catch { fail('IDENTITY_METADATA_JSON'); }
  return { value, hash: hash(bytes) };
}
function createMetadataInspector({ DatabaseSync: suppliedDatabase } = {}) {
  function inspectMetadata(dataDir, options = {}) {
    const blank = { state: 'missing', format: null, descriptor: null, identity: null, metadataStamp: null, physicalKey: null, locationVerified: false, issues: [] };
    const issue = (code, state = 'corrupt') => freeze({ ...blank, state, issues: [{ code, message: ({ IDENTITY_SQLITE_CHECKPOINT_REQUIRED: 'Закройте прежнюю программу и завершите её сохранение, чтобы подтвердить метаданные профиля.', IDENTITY_SQLITE_ROLLBACK_REQUIRED: 'В профиле остался незавершённый журнал SQLite. Завершите сохранение в прежней программе.', IDENTITY_IMMUTABLE_UNAVAILABLE: 'Этот runtime не подтвердил безопасное чтение метаданных без изменения исходника.', IDENTITY_FORMAT_UNSUPPORTED: 'Не поддерживается формат базы в этом профиле.' })[code] || 'Не удалось подтвердить метаданные этого профиля.' }] });
    try {
      if (typeof dataDir !== 'string' || !dataDir || !path.isAbsolute(dataDir) || dataDir.includes('\0')) return issue('IDENTITY_PATH', 'unverified');
      const directoryInfo = info(dataDir); if (!directoryInfo) return freeze({ ...blank, physicalKey: fold(path.resolve(dataDir)), issues: [{ code: 'IDENTITY_PROFILE_MISSING', message: 'Каталог этого профиля отсутствует.' }] });
      const directory = fs.realpathSync.native(dataDir); if (!fs.statSync(directory).isDirectory()) return issue('IDENTITY_PATH', 'unverified');
      blank.physicalKey = fold(directory); blank.locationVerified = true;
      const sqlite = regular(directory, 'platform.sqlite', Number.MAX_SAFE_INTEGER);
      let descriptor, identity = null, proof;
      if (sqlite) {
        blank.format = 'sqlite'; const header = Buffer.alloc(100), fd = fs.openSync(sqlite.file, 'r'); try { if (fs.readSync(fd, header, 0, 100, 0) !== 100) return issue('IDENTITY_SQLITE_METADATA'); } finally { fs.closeSync(fd); }
        if (header.subarray(0, 16).toString('binary') !== 'SQLite format 3\0' || header.readUInt32BE(68) !== 0x54565331) return issue('IDENTITY_SQLITE_METADATA');
        const version = header.readUInt32BE(60); if (!format.SUPPORTED_READ_SCHEMAS.includes(version)) return issue('IDENTITY_FORMAT_UNSUPPORTED', 'unsupported');
        const rollback = rollbackJournals.assertQuiescent(sqlite.file);
        const wal = regular(directory, 'platform.sqlite-wal', Number.MAX_SAFE_INTEGER);
        if (wal && wal.stat.size > 0) {
          // A trusted live connection can provide its own current metadata. A
          // JSON hint from a renderer cannot provide this executable capability.
          if (typeof options.readActiveMetadata === 'function') {
            const live = options.readActiveMetadata({ physicalKey: blank.physicalKey });
            if (live && live.physicalKey === blank.physicalKey && live.identity && live.descriptor && /^sha256:[a-f0-9]{64}$/.test(live.metadataStamp || '')) { rollbackJournals.assertUnchanged(sqlite.file, rollback); return freeze({ ...blank, state: 'known', descriptor: format.validateDescriptor(live.descriptor), identity: identities.validate(live.identity), metadataStamp: live.metadataStamp, proof: 'active-connection' }); }
          }
          return issue('IDENTITY_SQLITE_CHECKPOINT_REQUIRED', 'busy');
        }
        let DatabaseSync; try { DatabaseSync = suppliedDatabase || require('node:sqlite').DatabaseSync; } catch { return issue('IDENTITY_IMMUTABLE_UNAVAILABLE', 'unverified'); }
        let db; try { db = new DatabaseSync(pathToFileURL(sqlite.file).href + '?mode=ro&immutable=1', { readOnly: true, allowExtension: false, enableDoubleQuotedStringLiterals: false, defensive: true }); } catch { return issue('IDENTITY_IMMUTABLE_UNAVAILABLE', 'unverified'); }
        try {
          db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;');
          if (db.prepare("SELECT type FROM sqlite_schema WHERE name='metadata'").get()?.type !== 'table') return issue('IDENTITY_SQLITE_METADATA');
          const rows = db.prepare("SELECT key,CASE WHEN length(CAST(value AS BLOB))<=16384 THEN value ELSE NULL END AS value FROM metadata WHERE key IN('format','format_version','schema_version','compatibility','database_uuid','generation') ORDER BY key").all();
          if (rows.some(row => typeof row.key !== 'string' || typeof row.value !== 'string')) return issue('IDENTITY_SQLITE_METADATA');
          const meta = Object.fromEntries(rows.map(row => [row.key, row.value]));
          if (meta.format !== 'tvs-platform-sqlite' || meta.format_version !== '1' || meta.schema_version !== String(version)) return issue('IDENTITY_SQLITE_METADATA');
          if (version >= 3) { let value; try { value = JSON.parse(meta.compatibility); } catch { return issue('IDENTITY_DESCRIPTOR'); } descriptor = format.validateDescriptor(value, version); }
          else { if (Object.hasOwn(meta, 'compatibility')) return issue('IDENTITY_DESCRIPTOR'); descriptor = format.describe(version); }
          if (meta.database_uuid !== undefined || meta.generation !== undefined) identity = identities.validate({ format: 'tvs-database-identity', version: 1, uuid: meta.database_uuid, generation: Number(meta.generation) });
          if (version >= 3 && !identity) return issue('IDENTITY_METADATA_MISSING');
          proof = { header: hash(header), metadata: rows };
        } finally { db.close(); }
        const after = fs.lstatSync(sqlite.file), afterWal = info(sqlite.file + '-wal'); rollbackJournals.assertUnchanged(sqlite.file, rollback);
        if (after.ino !== sqlite.stat.ino || after.dev !== sqlite.stat.dev || after.size !== sqlite.stat.size || after.mtimeMs !== sqlite.stat.mtimeMs || afterWal && afterWal.size > 0) return issue('IDENTITY_METADATA_CHANGED', 'busy');
      } else {
        const revisions = jsonMetadata(directory, path.join('sections', 'revisions.json'), 256 * 1024);
        if (revisions) { const decoded = format.decodeRevisions(revisions.value); descriptor = decoded.descriptor; proof = { revisions: revisions.hash }; blank.format = 'json'; }
        else {
          if (info(path.join(directory, 'sections', 'documentDrafts.json'))) return issue('IDENTITY_DESCRIPTOR');
          if (!info(path.join(directory, 'data.json')) && !info(path.join(directory, 'sections', 'vehicles.json')) && !info(path.join(directory, 'sections', 'records.json'))) return freeze(blank);
          blank.format = 'json'; descriptor = format.describe(1); proof = { legacy: true };
        }
        const savedIdentity = jsonMetadata(directory, identities.FILE, 4096);
        if (savedIdentity) { identity = identities.validate(savedIdentity.value); proof.identity = savedIdentity.hash; }
        if (descriptor.schemaVersion >= 3 && !identity) return issue('IDENTITY_METADATA_MISSING');
        const confirmedRevisions = jsonMetadata(directory, path.join('sections', 'revisions.json'), 256 * 1024), confirmedIdentity = jsonMetadata(directory, identities.FILE, 4096);
        if (revisions?.hash !== confirmedRevisions?.hash || savedIdentity?.hash !== confirmedIdentity?.hash) return issue('IDENTITY_METADATA_CHANGED', 'busy');
      }
      const metadataStamp = hash(stable({ physicalKey: blank.physicalKey, format: blank.format, descriptor, identity, proof }));
      return freeze({ ...blank, state: descriptor.schemaVersion === format.SCHEMA_VERSION ? 'known' : 'legacy', descriptor, identity, metadataStamp, proof: 'metadata-only' });
    } catch (caught) {
      if (['SQLITE_ROLLBACK_BUSY', 'SQLITE_ROLLBACK_CHANGED'].includes(caught.code)) return issue('IDENTITY_SQLITE_ROLLBACK_REQUIRED', 'busy');
      return issue(['STORAGE_FORMAT', 'SQLITE_FUTURE_FORMAT'].includes(caught.code) ? 'IDENTITY_FORMAT_UNSUPPORTED' : caught.code || 'IDENTITY_METADATA', ['STORAGE_FORMAT', 'SQLITE_FUTURE_FORMAT'].includes(caught.code) ? 'unsupported' : 'corrupt');
    }
  }
  function diagnoseKnownProfiles(profiles, options = {}) {
    if (!Array.isArray(profiles) || profiles.length > 1000 || profiles.some(profile => !profile || !(typeof profile.id === 'string' && profile.id || typeof profile.id === 'number' && Number.isFinite(profile.id)) || typeof profile.dataDir !== 'string')) throw Object.assign(new Error('Нужен явный список известных профилей'), { code: 'IDENTITY_PROFILES' });
    const cache = new Map(), output = profiles.map(profile => {
      const inspected = inspectMetadata(profile.dataDir, options), key = inspected.locationVerified ? inspected.physicalKey : null;
      if (key && cache.has(key)) return { id: profile.id, ...cache.get(key) };
      if (key) cache.set(key, inspected); return { id: profile.id, ...inspected };
    }), groups = [];
    const locations = new Map(), identitiesById = new Map();
    for (const row of output) {
      if (row.locationVerified) { const list = locations.get(row.physicalKey) || []; list.push(row); locations.set(row.physicalKey, list); }
      if (row.identity && ['known', 'legacy'].includes(row.state)) { const list = identitiesById.get(row.identity.uuid) || []; list.push(row); identitiesById.set(row.identity.uuid, list); }
    }
    for (const [physicalKey, rows] of locations) if (rows.length > 1) groups.push({ kind: 'sameLocation', profileIds: rows.map(row => row.id), physicalKeys: [physicalKey] });
    for (const [uuid, rows] of identitiesById) {
      const generations = [...new Set(rows.map(row => row.identity.generation))].sort((a, b) => a - b);
      if (generations.length > 1) groups.push({ kind: 'multipleGenerations', uuid, generations, profileIds: rows.map(row => row.id), physicalKeys: [...new Set(rows.map(row => row.physicalKey))] });
      for (const generation of generations) { const same = rows.filter(row => row.identity.generation === generation), physicalKeys = [...new Set(same.map(row => row.physicalKey))]; if (physicalKeys.length > 1) groups.push({ kind: 'duplicateIdentity', uuid, generation, profileIds: same.map(row => row.id), physicalKeys }); }
    }
    return freeze({ profiles: output, groups, issues: output.flatMap(row => row.issues.map(issue => ({ profileId: row.id, ...issue }))) });
  }
  return Object.freeze({ inspectMetadata, diagnoseKnownProfiles });
}
module.exports = Object.freeze({ ...createMetadataInspector(), createMetadataInspector });
