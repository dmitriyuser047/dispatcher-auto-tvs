'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {functionDeclarations}=require('./helpers/source-harness.cjs'),schema=require('../assets/core/platform-schema.js'),contracts=require('../assets/core/platform-contracts.js');
const source=functionDeclarations('assets/js/51-platform-bridge.js',['platformVehicleRecordCommandAvailable','platformVehicleRecordCommandSourceClean']);
function fixture(){
 const database={...Object.fromEntries(schema.sections.map(name=>[name,[]])),vehicles:[{id:0,plate:'SYNTHETIC'}],records:[{id:'record',vehicleId:0,date:'2026-11-11',km:0}],parts:[{id:'part',custom:{zero:0,empty:null,enabled:false}}]};
 const context=vm.createContext({data:database,SYNC_SECTIONS:schema.sections,PlatformContracts:contracts,PlatformCommands:{dependencies:()=>['records','vehicles','fuelCards','fuelPeriods','appMeta']},_loadWriteBlocked:false,_sync:{enabled:true,access:{readable:schema.sections.slice()},synced:Object.fromEntries(Object.entries(database).map(([name,rows])=>[name,JSON.stringify(rows)])),platform:{apiVersion:1,vehicleRecordV1:1,commands:1,operations:1,outbox:1,negotiation:{writeCompatible:true}}},window:{electronAPI:{executeCommand(){}}}});
 vm.runInContext('function syncSectionLoaded(name){return Object.hasOwn(_sync.synced,name);}\n'+source,context);return context;
}
test('the optional journal command needs a fully negotiated writer and falls back for an older host',()=>{
 const c=fixture();assert.equal(c.platformVehicleRecordCommandAvailable(),true);for(const mutate of [x=>delete x._sync.platform.vehicleRecordV1,x=>x._sync.platform.vehicleRecordV1=2,x=>x._sync.platform.negotiation.writeCompatible=false,x=>delete x._sync.platform.outbox,x=>x._loadWriteBlocked=true,x=>delete x.window.electronAPI.executeCommand]){const next=fixture();mutate(next);assert.equal(next.platformVehicleRecordCommandAvailable(),false);}
});
test('any other dirty loaded section or deferred nonempty section keeps the original snapshot save semantics',()=>{
 const c=fixture(),before=JSON.stringify(c.data);assert.equal(c.platformVehicleRecordCommandSourceClean(c.data,{}),true);assert.equal(JSON.stringify(c.data),before);
 for(const mutate of [x=>x.data.records[0].km=1,x=>x.data.parts[0].custom.enabled=true,x=>{delete x._sync.synced.parts;x.data.parts=[{id:'unsaved'}];},x=>x.data.futureSection=[]]){const next=fixture();mutate(next);assert.equal(next.platformVehicleRecordCommandSourceClean(next.data,{}),false);}
});
test('a missing read dependency falls back even when its deferred display placeholder is empty',()=>{
 const c=fixture();delete c._sync.synced.fuelPeriods;assert.deepEqual(c.data.fuelPeriods,[]);assert.equal(c.platformVehicleRecordCommandSourceClean(c.data,{}),false);
});
test('restricted dependency grants or absent access metadata retain the compatible snapshot path',()=>{
 const c=fixture();c._sync.access.readable=['records','vehicles','appMeta','fuelPeriods'];assert.equal(c.platformVehicleRecordCommandSourceClean(c.data,{}),false);c._sync.access.readable=['*'];assert.equal(c.platformVehicleRecordCommandSourceClean(c.data,{}),true);delete c._sync.access;assert.equal(c.platformVehicleRecordCommandSourceClean(c.data,{}),false);
});
test('row scope or field masks select the existing projection-aware save rather than a narrow command',()=>{
 const c=fixture();c._sync.platform.scopedAccess=1;assert.equal(c.platformVehicleRecordCommandAvailable(),false);
});
test('nonportable JSON and a replaced live tree never qualify for the narrow command',()=>{
 for(const value of [new Date('2026-11-11'),NaN,undefined]){const c=fixture();c.data.parts[0].custom=value;c._sync.synced.parts=JSON.stringify(c.data.parts);assert.equal(c.platformVehicleRecordCommandSourceClean(c.data,{}),false);}
 const c=fixture(),copy=JSON.parse(JSON.stringify(c.data));assert.equal(c.platformVehicleRecordCommandSourceClean(copy,{}),false);
});
