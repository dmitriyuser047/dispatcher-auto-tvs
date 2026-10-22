'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {schema,storage,currentFixture,tree}=require('./helpers/schema-format-support.cjs'),{seedDatabase,seedSections}=require('./period-test-support.cjs'),host=require('./helpers/operation-history25-host.cjs'),store=require('../electron/operation-store.cjs'),format=require('../electron/storage-format.cjs');

for(const kind of ['json','sqlite']){
 test(kind+' current new-target fixture preserves literal legacy facts and reserves unknown operations without inventing verified proof',t=>{
  const literal={id:0,section:'vehicles',operationId:'literal-old-operation',before:{id:0,org:'A'},after:{id:0,org:'B',note:'Untimed old fact'}},data=Object.fromEntries(schema.sections.map(name=>[name,[]]));data.auditLog=[literal];const f=currentFixture(t,kind,{data}),state=store.readState(f.dir),engine=store.engine(f.dir);assert.equal(storage.schemaVersion(f.dir),format.SCHEMA_VERSION);assert.deepEqual(storage.readSnapshot(f.dir).data.auditLog,[literal]);assert.deepEqual(engine.inspectReceipt(state.head,literal.operationId),{kind:'reserved-unknown',operationId:literal.operationId});assert.deepEqual(host.page(f.dir,host.A,{limit:10}).rows,[]);assert.deepEqual(host.page(f.dir,host.actor,{limit:10}).rows,[literal]);assert.deepEqual(host.page(f.dir,{...host.actor,readable:['auditLog','vehicles']},{limit:10}).rows,[]);assert.equal(Object.hasOwn(literal,'at'),false);assert.equal(Object.hasOwn(literal,'actorId'),false);
 });

 test(kind+' concurrent synthetic business seed retains authoritative history and frozen receipt ownership without certifying a new operation',t=>{
  const {dir}=host.fixture(t,kind),value=host.commit(dir,host.A,'before-synthetic-concurrency'),state=store.readState(dir),receipt=storage.readOperation(dir,value.query,host.A),before=storage.readSnapshot(dir);seedSections(dir,{vehicles:before.data.vehicles.map(row=>row.id===0?{...row,org:'B',note:'Synthetic concurrent physical state'}:row)});const next=store.readState(dir);assert.notEqual(next.transactionId,state.transactionId);assert.deepEqual(next.head,state.head);assert.deepEqual(storage.readSnapshot(dir).data.auditLog,before.data.auditLog);assert.deepEqual(storage.readOperation(dir,value.query,host.A),receipt);assert.equal(storage.readOperation(dir,value.query,host.B).operationReceipt,null);assert.equal(storage.readRevisions(dir).vehicles,before.revisions.vehicles+1);assert.equal(storage.readSnapshot(dir).data.vehicles.find(row=>row.id===0).org,'B');
 });

 test(kind+' synthetic section helper refuses authoritative audit replacement before touching the current database',t=>{
  const {dir}=host.fixture(t,kind);host.commit(dir,host.A,'immutable-test-helper');const before=tree(dir);assert.throws(()=>seedSections(dir,{auditLog:[]}),/Synthetic business sections required/);assert.deepEqual(tree(dir),before);
 });
}

test('historical JSON seed uses the production new-target builder and refuses to overwrite an occupied current database',t=>{
 const f=currentFixture(t,'json'),before=tree(f.dir);assert.throws(()=>seedDatabase(f.dir,f.data),error=>error.code==='JSON_TARGET_NOT_EMPTY');assert.deepEqual(tree(f.dir),before);assert.equal(path.basename(f.dir),'db');
});
