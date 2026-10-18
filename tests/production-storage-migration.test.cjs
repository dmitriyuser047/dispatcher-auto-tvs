const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const storage = require('../electron/storage');

// The exact split schema shipped in the previous production version 2.0.104.
const LEGACY_SECTIONS = [
  'vehicles', 'records', 'generators', 'genRecords', 'toRecords',
  'tanks', 'tankIncomes', 'vehicleTo', 'repairs',
  'reestrRows', 'savedReestrs', 'payments', 'budget', 'contragents',
  'fuelPurchases', 'fuelImports', 'fuelCards', 'fuelPeriods', 'monthlyFuel', 'appMeta',
];

function temporaryDatabase(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tvs-production-migration-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('tvs-production-migration-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function interruptedLegacyTransaction(dir, committed) {
  fs.mkdirSync(storage.sectionsDir(dir));
  const original = Object.fromEntries(LEGACY_SECTIONS.map(name => [name, []]));
  original.vehicles = [{ id: 'synthetic-vehicle', plate: 'TEST-ORIGINAL' }];
  original.records = [{ id: 'synthetic-record', vehicleId: 'synthetic-vehicle', km: 10 }];
  for (const name of LEGACY_SECTIONS) fs.writeFileSync(storage.sectionFile(dir, name), JSON.stringify(original[name]));
  const base = Object.fromEntries(LEGACY_SECTIONS.map(name => [name, 7]));
  const revisions = { ...base, vehicles: 8, records: 8 };
  const tx = {
    before: { vehicles: original.vehicles, records: original.records },
    sections: {
      vehicles: [{ ...original.vehicles[0], plate: 'TEST-CHANGED' }],
      records: [{ ...original.records[0], km: 20 }],
    },
    base, revisions,
  };
  // The process stopped after replacing the first file; recovery must either
  // undo it or finish replacing the second file, based on revisions.json.
  fs.writeFileSync(storage.sectionFile(dir, 'vehicles'), JSON.stringify(tx.sections.vehicles));
  fs.writeFileSync(storage.revisionsFile(dir), JSON.stringify(committed ? revisions : base));
  fs.writeFileSync(path.join(storage.sectionsDir(dir), '.transaction.json'), JSON.stringify(tx));
  return { original, tx };
}

for (const committed of [false, true]) {
  test(`production upgrade ${committed ? 'finishes committed' : 'rolls back uncommitted'} legacy transaction before adding new sections`, t => {
    const dir = temporaryDatabase(t);
    const { original, tx } = interruptedLegacyTransaction(dir, committed);
    const loaded = storage.readAll(dir);
    for (const name of LEGACY_SECTIONS) assert.deepEqual(loaded[name], committed && name in tx.sections ? tx.sections[name] : original[name]);
    for (const name of storage.SECTIONS.filter(name => !LEGACY_SECTIONS.includes(name))) assert.deepEqual(loaded[name], []);
    const revisions = storage.readRevisions(dir);
    for (const name of LEGACY_SECTIONS) assert.equal(revisions[name], committed ? tx.revisions[name] : tx.base[name]);
    assert.equal(fs.existsSync(path.join(storage.sectionsDir(dir), '.transaction.json')), false);
  });
}

test('production migration rejects malformed legacy journals without replacing any section or revision', t => {
  const corruptions = [
    tx => { delete tx.revisions.vehicles; },
    tx => { delete tx.revisions.records; },
    tx => { delete tx.revisions.generators; tx.sections.generators = []; tx.before.generators = []; },
    tx => { tx.revisions.fuelCards = -1; },
    tx => { tx.revisions.fuelCards = 1.5; },
    tx => { tx.revisions.fuelCards = '7'; },
    tx => { tx.base.records = -1; },
    tx => { delete tx.base.records; },
    tx => { tx.sections.records = null; },
    tx => { delete tx.before.records; },
    tx => { tx.before.records = {}; },
    tx => { tx.sections.unknownSection = []; tx.before.unknownSection = []; tx.revisions.unknownSection = 1; },
  ];
  for (const corrupt of corruptions) {
    const dir = temporaryDatabase(t);
    const { tx } = interruptedLegacyTransaction(dir, true);
    corrupt(tx);
    const journal = path.join(storage.sectionsDir(dir), '.transaction.json');
    fs.writeFileSync(journal, JSON.stringify(tx));
    const before = new Map(fs.readdirSync(storage.sectionsDir(dir)).map(name => [name, fs.readFileSync(path.join(storage.sectionsDir(dir), name))]));
    assert.throws(() => storage.readAll(dir), /Повреждён журнал сохранения/);
    for (const [name, bytes] of before) assert.deepEqual(fs.readFileSync(path.join(storage.sectionsDir(dir), name)), bytes, name);
    assert.deepEqual(fs.readdirSync(storage.sectionsDir(dir)).sort(), [...before.keys()].sort());
  }
});
