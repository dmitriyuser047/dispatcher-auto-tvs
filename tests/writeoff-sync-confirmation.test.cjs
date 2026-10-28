const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

async function context(writeSections) {
  const writes = { sections:0, legacy:0 };
  const database = { vehicles:[], records:[], fuelWriteoffs:[] };
  const sandbox = {
    window:{ electronAPI:{
      readSnapshot:async () => JSON.stringify({ databaseToken:'test-database', data:database, revisions:{ vehicles:1, records:1, fuelWriteoffs:4 } }),
      writeSections:async raw => { writes.sections++; return writeSections(JSON.parse(raw)); },
      writeData:async () => { writes.legacy++; return true; }
    } },
    console, setInterval:() => 1, clearInterval:() => {}, document:{ querySelector:() => null },
    showToast:() => {}, rebuildIndex:() => {}
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/js/25f-sync.js'), 'utf8') +
    '\nglobalThis.load=syncLoad; globalThis.save=syncSave; globalThis.state=_sync;', sandbox);
  await sandbox.load();
  return { sandbox, writes, data:{ ...database, fuelWriteoffs:[{ id:'draft-from-client', status:'posted' }] } };
}
const required = { noMerge:true, requiredCanonicalSections:['fuelWriteoffs'] };

test('a writeoff command never falls back to full write when section persistence is unsupported', async () => {
  const { sandbox, writes, data } = await context(() => ({ ok:false, unsupported:true }));
  await assert.rejects(sandbox.save(data, required), /Сервер.*поддерживает/);
  assert.equal(writes.sections, 1); assert.equal(writes.legacy, 0);
  assert.equal(sandbox.state.enabled, true); assert.equal(sandbox.state.revs.fuelWriteoffs, 4);
  assert.equal(sandbox.state.synced.fuelWriteoffs, '[]');
});

test('missing canonical rows or invalid revisions cannot advance the optimistic sync baseline', async () => {
  const variants = [
    { ok:true, databaseToken:'test-database', revisions:{ fuelWriteoffs:5 } },
    { ok:true, databaseToken:'test-database', canonicalSections:{ fuelWriteoffs:[] } },
    { ok:true, databaseToken:'test-database', revisions:{ fuelWriteoffs:'5' }, canonicalSections:{ fuelWriteoffs:[] } },
    { ok:true, databaseToken:'test-database', revisions:{ fuelWriteoffs:-1 }, canonicalSections:{ fuelWriteoffs:[] } },
    { ok:true, databaseToken:'test-database', revisions:{ fuelWriteoffs:5 }, canonicalSections:{ fuelWriteoffs:{} } }
  ];
  for (const response of variants) {
    const { sandbox, writes, data } = await context(() => response);
    await assert.rejects(sandbox.save(data, required), /не подтвердил/);
    assert.equal(sandbox.state.revs.fuelWriteoffs, 4); assert.equal(sandbox.state.synced.fuelWriteoffs, '[]');
    assert.equal(writes.legacy, 0); assert.equal(data.fuelWriteoffs[0].id, 'draft-from-client');
  }
});

test('acknowledged writeoffs install backend canonical authors and revisions in both live data and baseline', async () => {
  const canonical = [{ id:'canonical-act', status:'posted', postedBy:{ id:'server-accountant', name:'Accountant' } }];
  const { sandbox, writes, data } = await context(() => ({ ok:true, databaseToken:'test-database',
    revisions:{ fuelWriteoffs:5 }, canonicalSections:{ fuelWriteoffs:canonical } }));
  assert.equal(await sandbox.save(data, required), true);
  assert.deepEqual(JSON.parse(JSON.stringify(data.fuelWriteoffs)), canonical);
  assert.equal(sandbox.state.synced.fuelWriteoffs, JSON.stringify(canonical)); assert.equal(sandbox.state.revs.fuelWriteoffs, 5);
  assert.equal(writes.legacy, 0);
});

test('ordinary saves cannot fall back to a whole-database write after an unsupported response', async () => {
  const { sandbox, writes, data } = await context(() => ({ ok:false, unsupported:true }));
  await assert.rejects(sandbox.save(data, { noMerge:true }),{code:'UNSUPPORTED_PROTOCOL'});
  assert.equal(writes.legacy, 0); assert.equal(sandbox.state.enabled, true);
});

test('canonical IPC acknowledgement cannot share a mutable live document with an earlier audit snapshot or the response', async () => {
  const row={id:'canonical-act',status:'posted',snapshot:{liters:923.537}},audit={id:'audit',section:'fuelWriteoffs',action:'create',after:row};
  const {sandbox,data}=await context(()=>({ok:true,databaseToken:'test-database',revisions:{fuelWriteoffs:5,auditLog:1},canonicalSections:{fuelWriteoffs:[row],auditLog:[audit]}}));
  assert.equal(await sandbox.save(data,required),true);assert.notEqual(data.fuelWriteoffs[0],data.auditLog[0].after);assert.notEqual(data.fuelWriteoffs[0],row);
  data.fuelWriteoffs[0].snapshot.liters=1;assert.equal(data.auditLog[0].after.snapshot.liters,923.537);assert.equal(row.snapshot.liters,923.537);
  data.auditLog[0].after.snapshot.liters=2;assert.equal(audit.after.snapshot.liters,923.537);assert.match(sandbox.state.synced.auditLog,/923\.537/);
});

test('compact section save omits local audit hints and installs an independent canonical delta',async()=>{
 const row={id:'compact-act',status:'posted',snapshot:{liters:20}},event={id:'server-event',section:'fuelWriteoffs',after:row},old={id:'confirmed-old',section:'vehicles'};
 const {sandbox,writes,data}=await context(payload=>{assert.equal(Object.hasOwn(payload.sections,'auditLog'),false);return {ok:true,databaseToken:'test-database',revisions:{fuelWriteoffs:5,auditLog:4},canonicalSections:{fuelWriteoffs:[row]},auditDelta:{version:1,baseRevision:3,revision:4,appended:[event]}};});
 sandbox.state.platform={compactAck:1};sandbox.state.revs.auditLog=3;sandbox.state.synced.auditLog=JSON.stringify([old]);data.auditLog=[old,{id:'untrusted-hint'}];
 assert.equal(await sandbox.save(data,{...required,requiredCanonicalSections:['fuelWriteoffs','auditLog']}),true);assert.equal(writes.sections,1);assert.deepEqual(JSON.parse(JSON.stringify(data.auditLog)),[old,event]);assert.equal(sandbox.state.revs.auditLog,4);
 data.fuelWriteoffs[0].snapshot.liters=99;assert.equal(data.auditLog[1].after.snapshot.liters,20);assert.equal(row.snapshot.liters,20);
});

test('an audit-only client hint cannot become a persisted no-op baseline in compact mode',async()=>{
 const {sandbox,writes,data}=await context(()=>{throw Error('No business changes may be sent');});sandbox.state.platform={compactAck:1};data.fuelWriteoffs=[];data.auditLog=[{id:'never-persisted'}];
 assert.equal(await sandbox.save(data),true);assert.equal(writes.sections,0);assert.deepEqual(JSON.parse(JSON.stringify(data.auditLog)),[]);assert.equal(sandbox.state.synced.auditLog,'[]');
});
