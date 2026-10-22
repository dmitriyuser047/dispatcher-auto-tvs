'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createCommandOutbox}=require('../electron/command-outbox.cjs'),kernel=require('../assets/core/platform-kernel.js'),contracts=require('../assets/core/platform-contracts.js'),schema=require('../assets/core/platform-schema.js');
test('a reviewed full-view witness survives unknown ACK and restart as part of the immutable operation identity',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-scoped-outbox-'));t.after(()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.match(path.basename(root),/^tvs-scoped-outbox-/);fs.rmSync(root,{recursive:true,force:true});});const config={rootDir:path.join(root,'outbox')},scope='a'.repeat(64),box=createCommandOutbox(config);
 const body={base:{vehicles:3},sections:{vehicles:[{id:0,notes:'Reviewed'}]},databaseToken:'synthetic-db',scopeViews:{vehicles:{version:1,policyStamp:'sha256:'+'b'.repeat(64),revision:3,visibleFingerprint:'sha256:'+'c'.repeat(64)}},operation:{id:'reviewed-scope'}};body.operation.digest=kernel.requestDigest(body);const exact=JSON.stringify(body);
 box.stage(scope,body,{supportsOperations:true});box.updateOutcome(scope,body.operation.id,{status:'unknown',code:'TIMEOUT'});const restarted=createCommandOutbox(config),stored=restarted.getForRetry(scope,body.operation.id);assert.equal(stored.json,exact);assert.deepEqual(stored.payload.scopeViews,body.scopeViews);assert.equal(stored.requestDigest,body.operation.digest);
 const changed=structuredClone(body);changed.scopeViews.vehicles.policyStamp='sha256:'+'d'.repeat(64);assert.notEqual(kernel.requestDigest(changed),body.operation.digest);assert.throws(()=>restarted.stage(scope,changed,{supportsOperations:true}),{code:'OUTBOX_DIGEST'});
 const parsed=contracts.parseSectionWrite(body,schema.sections);body.scopeViews.vehicles.revision=99;assert.equal(parsed.scopeViews.vehicles.revision,3);assert.equal(stored.payload.scopeViews.vehicles.revision,3);
});
test('legacy raw digests stay exact while invalid view descriptors and executable properties are rejected',()=>{
 const body={base:{vehicles:3},sections:{vehicles:[{id:0}]}};assert.equal(kernel.requestDigest(body),'sha256:'+crypto.createHash('sha256').update(kernel.stableSerialize(body)).digest('hex'));
 assert.throws(()=>contracts.parseSectionWrite({...body,scopeViews:{vehicles:{version:1,policyStamp:'short',revision:3,visibleFingerprint:'sha256:'+'c'.repeat(64)}}},schema.sections),{code:'INVALID_SCOPE_VIEW'});
 let called=0;const views={};Object.defineProperty(views,'vehicles',{enumerable:true,get(){called++;return {};}});assert.throws(()=>contracts.parseSectionWrite({...body,scopeViews:views},schema.sections));assert.equal(called,0);
});
