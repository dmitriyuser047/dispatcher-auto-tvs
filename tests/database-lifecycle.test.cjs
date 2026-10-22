'use strict';
const { test, before } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), child = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..');
const metadata = require('../electron/database-lifecycle.cjs');
const format = require('../electron/storage-format.cjs'), identity = require('../electron/database-identity.cjs'), sqlite = require('../electron/sqlite-storage.cjs');
const hash = value => crypto.createHash('sha256').update(value).digest('hex'), digest = value => 'sha256:' + hash(value);
const uuid = '11111111-1111-4111-8111-111111111111', otherUuid = '22222222-2222-4222-8222-222222222222';
const ident = (generation = 1, value = uuid) => ({ format: 'tvs-database-identity', version: 1, uuid: value, generation });
const head = (generation = 5) => ({ identity: ident(generation), physicalKey: 'synthetic:head', metadataStamp: digest('head-' + generation) });
const ctx = () => ({ operationId: 'synthetic-lifecycle', at: '2026-10-23T00:00:00.000Z', actor: { id: 'synthetic-admin', name: 'Synthetic administrator', role: 'admin' }, newUuid: otherUuid });
const input = (action = 'clone') => ({ action, source: { format: action === 'restoreContinuation' ? 'backup' : 'json', identity: ident(), descriptor: format.describe(format.SCHEMA_VERSION), fingerprint: digest('all-source-bytes'), physicalKey: 'synthetic:source' }, target: { format: 'sqlite', descriptor: format.describe(format.SCHEMA_VERSION), physicalKey: 'synthetic:new-target' }, reason: 'Explicit reviewed lifecycle', ...(action === 'restoreContinuation' ? { continuationOf: head(), knownHeads: [head()] } : {}) });
let engine;
before(() => { engine = require('../assets/core/database-lifecycle.js'); });
function temp(t) { const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'tvs-lifecycle23-staged-')); t.after(() => { assert.equal(path.dirname(folder), fs.realpathSync(os.tmpdir())); assert.ok(path.basename(folder).startsWith('tvs-lifecycle23-staged-')); fs.rmSync(folder, { recursive: true, force: true }); }); return folder; }
function tree(folder) { const entries = {}; function read(dir) { for (const item of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, item.name); if (item.isDirectory()) read(file); else entries[path.relative(folder, file)] = hash(fs.readFileSync(file)); } } read(folder); return entries; }
function jsonProfile(dir,savedIdentity=ident(),version=format.SCHEMA_VERSION){const storage=require('../electron/storage.js'),data=Object.fromEntries(storage.SECTIONS.map(name=>[name,[]]));if(version===format.SCHEMA_VERSION){storage.createJson(dir,{data,...(savedIdentity?{identity:savedIdentity}:{})});if(!savedIdentity)fs.unlinkSync(path.join(dir,identity.FILE));}else{fs.mkdirSync(path.join(dir,'sections'),{recursive:true});const revisions=Object.fromEntries(storage.SECTIONS.map(name=>[name,0]));fs.writeFileSync(path.join(dir,'sections/revisions.json'),JSON.stringify({format:format.FORMAT,formatVersion:1,schemaVersion:version,vehicles:null,records:null,revisions,...(version===3?{compatibility:format.describe(3)}:{})}));if(savedIdentity)fs.writeFileSync(path.join(dir,identity.FILE),JSON.stringify(savedIdentity));}fs.writeFileSync(path.join(dir,'sections/vehicles.json'),'{ deliberately malformed business rows');}

test('relocation preserves identity and generation but requires a new physical location and warns retained source', () => {
  const value = input('relocate'), before = structuredClone(value), preview = engine.preview(value, ctx()); assert.equal(preview.canApply, true); assert.deepEqual(preview.targetIdentity, ident()); assert.equal(preview.warnings[0].code, 'IDENTITY_RELOCATION_RETAINS_SOURCE'); assert.equal(preview.plan.constraints.retargetReceipts, false); assert.deepEqual(value, before); assert.equal(Object.isFrozen(value), false); assert.equal(Object.isFrozen(preview.plan.history.actor), true);
  assert.equal(engine.preview({ ...value, target: { ...value.target, physicalKey: value.source.physicalKey } }, ctx()).canApply, false);
});
test('independent clone uses the host-pinned new UUID once, with generation1 and no source identity invention', () => {
  const value = input(), preview = engine.preview(value, ctx()); assert.equal(preview.canApply, true); assert.deepEqual(preview.targetIdentity, ident(1, otherUuid));
  const planned = engine.plan({ ...value, reviewFingerprint: preview.reviewFingerprint }, ctx()); assert.deepEqual(planned, preview.plan);
  assert.equal(engine.preview(value, { ...ctx(), newUuid: uuid }).issues[0].code, 'IDENTITY_UUID_REUSED');
  const unknown = { ...value, source: { ...value.source, identity: null, descriptor: null } }, result = engine.preview(unknown, ctx()); assert.equal(result.canApply, true); assert.equal(result.history.sourceIdentity, null); assert.equal(result.history.sourceDescriptor, null);
});
test('restoring backup generation1 continues explicitly reviewed current generation5 as6', () => {
  const value = input('restoreContinuation'), preview = engine.preview(value, ctx()); assert.equal(preview.canApply, true); assert.deepEqual(preview.targetIdentity, ident(6)); assert.equal(preview.plan.constraints.headMetadataStamp, head().metadataStamp);
  const oldHead = { ...head(1), physicalKey: 'synthetic:older-profile' }, stale = { ...value, continuationOf: oldHead, knownHeads: [oldHead, head(5)] }; assert.equal(engine.preview(stale, ctx()).issues[0].code, 'IDENTITY_PREDECESSOR_STALE');
  assert.equal(engine.preview({ ...value, knownHeads: [] }, ctx()).issues[0].code, 'IDENTITY_HEAD_UNVERIFIED');
  assert.equal(engine.preview({ ...value, continuationOf: { ...head(), identity: ident(5, otherUuid) } }, ctx()).issues[0].code, 'IDENTITY_PREDECESSOR');
});
test('generation overflow, superseded relocation, missing legacy identity and reused independent UUID fail without mutation', () => {
  const value = input('restoreContinuation'), maximum = head(Number.MAX_SAFE_INTEGER); assert.equal(engine.preview({ ...value, continuationOf: maximum, knownHeads: [maximum] }, ctx()).issues[0].code, 'IDENTITY_GENERATION_LIMIT');
  assert.equal(engine.preview({ ...input('relocate'), knownHeads: [head()] }, ctx()).issues[0].code, 'IDENTITY_SOURCE_SUPERSEDED');
  assert.equal(engine.preview({ ...value, source: { ...value.source, identity: null } }, ctx()).issues[0].code, 'IDENTITY_SOURCE_UNVERIFIED');
  assert.equal(engine.preview({ ...input(), knownHeads: [{ ...head(), identity: ident(1, otherUuid) }] }, ctx()).issues[0].code, 'IDENTITY_UUID_REUSED');
});
test('review binds modes, formats, exact target, source fingerprint and predecessor metadata while clock comes from pinned host context', () => {
  const value = input('restoreContinuation'), preview = engine.preview(value, ctx());
  for (const changed of [{ ...value, source: { ...value.source, fingerprint: digest('changed') } }, { ...value, target: { ...value.target, format: 'json' } }, { ...value, target: { ...value.target, physicalKey: 'synthetic:another-target' } }, { ...value, reason: 'Different reviewed basis' }]) assert.throws(() => engine.plan({ ...changed, reviewFingerprint: preview.reviewFingerprint }, ctx()), { code: 'STALE_REVIEW' });
  const later = engine.preview(value, { ...ctx(), at: '2026-10-23T01:00:00.000Z' }); assert.equal(later.reviewFingerprint, preview.reviewFingerprint); assert.equal(later.history.at, '2026-10-23T01:00:00.000Z'); assert.notEqual(engine.preview(value, { ...ctx(), actor: { ...ctx().actor, id: 'other' } }).reviewFingerprint, preview.reviewFingerprint);
});
test('pure planner rejects executable, hidden, cyclic, nonfinite and unsupported descriptor inputs without invoking getters', () => {
  let calls = 0; const executable = input(); Object.defineProperty(executable, 'source', { enumerable: true, get() { calls++; return input().source; } }); assert.equal(engine.preview(executable, ctx()).canApply, false); assert.equal(calls, 0);
  const cycle = input(); cycle.circular = cycle; assert.equal(engine.preview(cycle, ctx()).canApply, false);
  assert.equal(engine.preview({ ...input(), target: { ...input().target, descriptor: { ...format.describe(format.SCHEMA_VERSION), features: [] } } }, ctx()).canApply, false);
  assert.equal(engine.preview(input(), { ...ctx(), at: '2026-02-31T00:00:00.000Z' }).canApply, false); assert.equal(engine.preview({ ...input(), source: { ...input().source, identity: ident(Infinity) } }, ctx()).canApply, false);
});
test('copy-only plan refuses a target occupied by any verified known profile', () => {
  for (const action of ['clone', 'relocate', 'restoreContinuation']) {
    const value = input(action), occupied = { ...head(), identity: ident(1, '33333333-3333-4333-8333-333333333333'), physicalKey: value.target.physicalKey };
    assert.equal(engine.preview({ ...value, knownHeads: [...(value.knownHeads || []), occupied] }, ctx()).issues[0].code, 'IDENTITY_TARGET_EXISTS');
  }
});

test('JSON metadata inspector ignores malformed business rows and never creates identity or file state', t => {
  const dir = path.join(temp(t), 'profile'); jsonProfile(dir); const before = tree(dir), read = fs.readFileSync; let businessReads = 0;
  fs.readFileSync = function (file) { if (String(file).endsWith('vehicles.json')) { businessReads++; throw Error('Business data must not be read'); } return read.apply(this, arguments); };
  let inspected; try { inspected = metadata.inspectMetadata(dir); } finally { fs.readFileSync = read; }
  assert.equal(inspected.state, 'known'); assert.equal(businessReads, 0); assert.deepEqual(inspected.identity, ident()); assert.deepEqual(tree(dir), before);
  fs.unlinkSync(path.join(dir, identity.FILE)); const missing = tree(dir); assert.equal(metadata.inspectMetadata(dir).state, 'corrupt'); assert.deepEqual(tree(dir), missing);
});
test('JSON metadata pair cannot mix revisions changed during the identity read', t => {
  const dir = path.join(temp(t), 'profile'); jsonProfile(dir); const revision = path.join(dir, 'sections/revisions.json'), savedIdentity = path.join(dir, identity.FILE), originalRead = fs.readFileSync; let changed = false;
  fs.readFileSync = function (file) { const bytes = originalRead.apply(this, arguments); if (String(file) === savedIdentity && !changed) { changed = true; const value = JSON.parse(originalRead(revision, 'utf8')); value.revisions.vehicles++; fs.writeFileSync(revision, JSON.stringify(value)); } return bytes; };
  let result; try { result = metadata.inspectMetadata(dir); } finally { fs.readFileSync = originalRead; }
  assert.equal(changed, true); assert.equal(result.state, 'busy'); assert.equal(result.identity, null); assert.equal(result.metadataStamp, null); assert.equal(result.issues[0].code, 'IDENTITY_METADATA_CHANGED');
});
test('legacy/null and missing profiles remain explicit without invented UUID or directory creation', t => {
  const base = temp(t), old = path.join(base, 'legacy'); jsonProfile(old, null, 2); const before = tree(base);
  const result = metadata.diagnoseKnownProfiles([{ id: 0, dataDir: old }, { id: '0', dataDir: path.join(base, 'not-created') }]); assert.equal(result.profiles[0].state, 'legacy'); assert.equal(result.profiles[0].identity, null); assert.equal(result.profiles[1].state, 'missing'); assert.deepEqual(tree(base), before);
});
test('profile projection distinguishes same location, independent copied identity and older generation without changing any profile', t => {
  const base = temp(t), first = path.join(base, 'first'), copied = path.join(base, 'copy'), later = path.join(base, 'later'); jsonProfile(first); jsonProfile(copied); jsonProfile(later, ident(5));
  const before = tree(base), result = metadata.diagnoseKnownProfiles([{ id: 'a', dataDir: first }, { id: 'alias', dataDir: path.join(first, '.') }, { id: 'copy', dataDir: copied }, { id: 'generation5', dataDir: later }]);
  assert.deepEqual(result.groups.map(group => group.kind).sort(), ['duplicateIdentity', 'multipleGenerations', 'sameLocation']); assert.deepEqual(result.groups.find(group => group.kind === 'sameLocation').profileIds, ['a', 'alias']); assert.equal(result.groups.find(group => group.kind === 'duplicateIdentity').generation, 1); assert.deepEqual(tree(base), before);
});
test('actual immutable SQLite metadata probe creates zero original sidecars and never loads business rows', t => {
  const dir = path.join(temp(t), 'sql'); sqlite.create(dir, { data: {}, identity: ident() }); const file = sqlite.filename(dir), db = new DatabaseSync(file); db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=WAL;'); db.close(); const before = tree(dir);
  let sqlReads = [];
  class ObservedDatabase extends DatabaseSync { prepare(sql) { sqlReads.push(sql); assert.doesNotMatch(sql, /section_rows|auditLog|payments/i); return super.prepare(sql); } }
  const result = metadata.createMetadataInspector({ DatabaseSync: ObservedDatabase }).inspectMetadata(dir); assert.equal(result.state, 'known'); assert.deepEqual(result.identity, ident()); assert.ok(sqlReads.some(sql => sql.includes('FROM metadata'))); assert.deepEqual(tree(dir), before);
});
test('unsupported immutable URI fails unverified without falling back to a normal source connection', t => {
  const dir = path.join(temp(t), 'sql'); sqlite.create(dir, { data: {} }); let calls = 0; const before = tree(dir);
  class Unsupported { constructor(uri) { calls++; assert.match(uri, /[?&]immutable=1/); throw Error('not supported'); } }
  const result = metadata.createMetadataInspector({ DatabaseSync: Unsupported }).inspectMetadata(dir); assert.equal(result.state, 'unverified'); assert.equal(result.metadataStamp, null); assert.equal(calls, 1); assert.deepEqual(tree(dir), before);
});
test('nonempty WAL cannot be silently classified using stale checkpoint identity', t => {
  const dir = path.join(temp(t), 'sql'); sqlite.create(dir, { data: {}, identity: ident() }); const db = new DatabaseSync(sqlite.filename(dir));
  try {
    db.prepare("UPDATE metadata SET value='5' WHERE key='generation'").run(); assert.ok(fs.statSync(sqlite.filename(dir) + '-wal').size > 0);
    const before = tree(dir), unknown = metadata.inspectMetadata(dir); assert.equal(unknown.state, 'busy'); assert.equal(unknown.identity, null); assert.deepEqual(tree(dir), before);
    const known = metadata.inspectMetadata(dir, { readActiveMetadata: ({ physicalKey }) => ({ physicalKey, identity: ident(5), descriptor: format.describe(format.SCHEMA_VERSION), metadataStamp: digest('trusted-live-head5') }) }); assert.equal(known.state, 'known'); assert.deepEqual(known.identity, ident(5)); assert.deepEqual(tree(dir), before);
  } finally { db.close(); }
});
test('SQLite inspector refuses a live rollback but accepts its committed PERSIST zero header without source writes', t => {
  const dir = path.join(temp(t), 'sql'); sqlite.create(dir, { data: {}, identity: ident() }); const file = sqlite.filename(dir), db = new DatabaseSync(file);
  try { db.exec('PRAGMA journal_mode=PERSIST; PRAGMA cache_size=1; BEGIN EXCLUSIVE;'); const insert = db.prepare('INSERT INTO metadata(key,value) VALUES(?,?)'); for (let index = 0; index < 100; index++) insert.run('spill-' + index, 'x'.repeat(8192)); const before = tree(dir), result = metadata.inspectMetadata(dir); assert.equal(result.state, 'busy'); assert.equal(result.identity, null); assert.deepEqual(tree(dir), before); db.exec('COMMIT;'); } finally { if (db.isTransaction) db.exec('ROLLBACK;'); db.close(); }
  const before = tree(dir), settled = metadata.inspectMetadata(dir); assert.equal(settled.state, 'known'); assert.deepEqual(settled.identity, ident()); assert.deepEqual(tree(dir), before);
});

test('actual Electron immutable SQLite metadata probe also preserves source directory bytes', { timeout: 15000 }, async t => {
  const dir = path.join(temp(t), 'sql'); sqlite.create(dir, { data: {}, identity: ident() }); const db = new DatabaseSync(sqlite.filename(dir)); db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=WAL;'); db.close(); const before = tree(dir);
  const code = `const result=require(${JSON.stringify(path.join(root, 'electron/database-lifecycle.cjs'))}).inspectMetadata(process.argv[1]);process.stdout.write(JSON.stringify({electron:!!process.versions.electron,result}));`;
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }; delete env.NODE_OPTIONS;
  const response = await new Promise((resolve, reject) => child.execFile(require('electron'), ['-e', code, dir], { env, windowsHide: true, timeout: 12000 }, (error, stdout) => error ? reject(error) : resolve(JSON.parse(stdout))));
  assert.equal(response.electron, true); assert.equal(response.result.state, 'known'); assert.deepEqual(response.result.identity, ident()); assert.deepEqual(tree(dir), before);
});
