'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture,CURRENT}=require('./helpers/platform-compatibility-fixtures.cjs');
const name='seasonalFuelNormsV1';
test('seasonal profiles advertise a version one capability without changing schema or ordinary write requirements',()=>{
 const {module,hello,server,descriptor}=fixture(),capability=hello.capabilities.find(value=>value.name===name);
 assert.deepEqual(capability,{name,versions:[1]});assert.equal(descriptor.schemaVersion,CURRENT);assert.equal(descriptor.features.some(value=>/season/i.test(value)),false);
 assert.equal(server.requiredReadCapabilities.some(value=>value.name===name),false);assert.equal(server.requiredWriteCapabilities.some(value=>value.name===name),false);
 const result=module.negotiate(hello,server,descriptor);assert.equal(result.mode,'read-write');assert.deepEqual(result.selectedProfile.capabilities.find(value=>value.name===name),{name,version:1});
});
for(const older of ['client','server'])test('a peer without seasonal profiles retains ordinary writes but cannot negotiate the new action: '+older,()=>{
 const {module,hello,server,descriptor}=fixture(),peer=older==='client'?hello:server;peer.capabilities=peer.capabilities.filter(value=>value.name!==name);
 const result=module.negotiate(hello,server,descriptor);assert.equal(result.mode,'read-write');assert.equal(result.writeCompatible,true);assert.equal(result.selectedProfile.capabilities.some(value=>value.name===name),false);assert.deepEqual(result.reasons,[]);
});
