'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const fuel=require('../assets/core/fuel-engine'),writeoff=require('../assets/core/writeoff-engine');
const fixtures=require('./fixtures/fuel-legacy-step13.json');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
for(const fixture of fixtures.cases)for(const version of [1,2,3])test(`step13 preserves frozen v${version} ${fixture.name} ledger/preview/post bytes`,()=>{
 const expected=fixture.expected[version],engine=fuel.forVersion(version),acts=writeoff.forVersion(version),before=JSON.stringify(fixture.db),preview=acts.prepare(fixture.db,fixture.request);
 assert.equal(hash(engine.buildLedger(fixture.db,fixture.range)),expected.ledger);assert.equal(hash(engine.recordBalances(fixture.db,fixture.db.vehicles[0].id)),expected.balances);
 assert.equal(hash(preview),expected.preview);assert.equal(preview.sourceFingerprint,expected.sourceFingerprint);
 if(expected.post)assert.equal(hash(acts.post(fixture.db,fixture.request,{...fixture.metadata,expectedFingerprint:preview.sourceFingerprint})),expected.post);
 assert.equal(JSON.stringify(fixture.db),before);
});
