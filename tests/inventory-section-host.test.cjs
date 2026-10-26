'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict'),vm=require('node:vm');
const artifact=require('../scripts/build-inventory-ui.cjs').compileInventoryUI().artifact;
const core=require('../assets/core/asset-inventory.js'),commands=require('../assets/core/platform-commands.js'),kernel=require('../assets/core/platform-kernel.js'),contracts=require('../assets/core/platform-contracts.js');
const clone=value=>JSON.parse(JSON.stringify(value)),sections=['inventoryOrgs','inventoryObjects','inventoryMols','inventoryItems','inventorySessions'];
function fixture(){return {inventoryOrgs:[{id:0,name:'Independent organization',note:''}],inventoryObjects:[{id:0,name:'Independent object',note:''}],inventoryMols:[{id:0,orgId:0,objectId:0,name:'Independent MOL',accountCode:'01',note:''}],inventoryItems:[],inventorySessions:[],appMeta:[]};}
function harness(){
 const state={database:fixture(),revisions:Object.fromEntries([...sections,'appMeta','auditLog'].map(name=>[name,0])),requests:[],receipts:new Map(),commits:0,lose:false,hold:null,release:null,readable:['*'],writable:['*'],blocked:true};
 const fleet={vehicles:[{id:0,plate:'FLEET DATA MUST STAY UNCHANGED'}],inventoryItems:[{id:'legacy-main',name:'GLOBAL INVENTORY MUST STAY UNCHANGED'}]},initial=JSON.stringify(fleet);
 const bridge=async payload=>{
  state.requests.push(clone(payload));if(state.hold)await new Promise(resolve=>{state.release=resolve;});
  if(payload.action==='snapshot')return {ok:true,data:clone(state.database),revisions:clone(state.revisions),databaseToken:'inventory-token',platform:{storageKind:'sqlite',schemaVersion:6,capabilities:[{name:'inventoryV1',version:1}]},access:{readable:['*'],writable:['*']}};
  if(payload.action!=='execute')return {ok:true,databaseToken:'inventory-token',marker:payload.action};
  const envelope=contracts.parseCommandEnvelope(payload.request,[...sections,'appMeta','auditLog']),prior=state.receipts.get(envelope.operation.id);
  if(prior)return {...clone(prior),operationReceipt:{...prior.operationReceipt,status:'replayed'}};
  assert.equal(envelope.databaseToken,'inventory-token');assert.equal(envelope.operation.digest,kernel.requestDigest(envelope));
  const now=new Date().toISOString(),plan=commands.plan(state.database,envelope.command,{id:envelope.operation.id,now,today:now.slice(0,10),actor:{id:'vm',name:'VM principal',role:'admin'}});
  for(const [name,rows] of Object.entries(plan.sections)){state.database[name]=clone(rows);state.revisions[name]=(state.revisions[name]||0)+1;}state.commits++;
  const reply={ok:true,databaseToken:'inventory-token',canonicalSections:clone(plan.sections),revisions:clone(state.revisions),operationReceipt:{id:envelope.operation.id,digest:envelope.operation.digest,status:'committed'}};state.receipts.set(envelope.operation.id,clone(reply));if(state.lose){state.lose=false;throw Error('Synthetic lost ACK');}return reply;
 };
 const context=vm.createContext({window:{electronAPI:{inventoryDatabase:bridge}},data:fleet,_sync:{databaseToken:'parent-token',epoch:1,platform:{storageKind:'json',schemaVersion:5,readOnly:true}},platformSessionContext:()=>({today:new Date().toISOString().slice(0,10),readable:state.readable,writable:state.writable,blocked:state.blocked}),PlatformCommands:commands,PlatformKernel:kernel,PlatformContracts:contracts,AssetInventory:core,wfId:()=> 'vm-operation',wfCommandContextStamp:()=> 'global-change-must-not-control-own-base',platformExecuteCommand:()=>{throw Error('Global command gateway must not be used');},lifecycleUpgradeOpen:()=>{throw Error('Global database upgrade must not be used');},showToast:()=>{},console,Date,Map,Set,Promise,JSON});
 vm.runInContext(artifact,context);
 return {state,context,fleet,initial,call:(code)=>vm.runInContext(code,context)};
}
function newOrg(h,id='new-independent-org'){
 h.context.input={action:'saveCatalog',section:'inventoryOrgs',payload:{name:'New independent organization',note:''},reason:'Explicit independent test'};
 h.call("input.reviewFingerprint=AssetInventory.preview(assetInventoryHostSnapshot().database,input,{today:assetInventoryHostSnapshot().today}).fingerprint");
 h.context.operationId=id;return h.call("assetInventoryExecuteCommand({type:'AssetInventoryAction',version:1,input},{operationId})");
}
test('inventory host opens own SQLite6 while parent JSON5 stays read-only and untouched',async()=>{
 const h=harness();await h.call('assetInventoryLoadDatabase()');const snapshot=h.call('assetInventoryHostSnapshot()');assert.equal(snapshot.databaseIndependent,true);assert.equal(snapshot.databaseLabel,'База инвентаризации');assert.equal(snapshot.schemaVersion,6);assert.equal(snapshot.isSQLite,true);assert.equal(snapshot.canWrite,true);assert.notEqual(snapshot.database,h.fleet);assert.equal(snapshot.database.inventoryItems.length,0);assert.equal(h.call('assetInventoryDatabaseToken()'),'inventory-token');assert.equal(JSON.stringify(h.fleet),h.initial);assert.equal(h.state.requests[0].action,'snapshot');assert.equal(h.state.requests[0].parentDatabaseToken,'parent-token');
 const identity=snapshot.database;await h.call('assetInventoryLoadDatabase()');assert.equal(h.call('assetInventoryHostSnapshot().database'),identity,'refresh keeps canonical database reference stable');
});
test('own semantic command uses sidecar revisions and receipt, only updates its own canonical rows',async()=>{
 const h=harness();await h.call('assetInventoryLoadDatabase()');const before=h.call('assetInventoryHostSnapshot().database');const reply=await newOrg(h);assert.equal(reply.ok,true,reply.error);assert.equal(h.call('assetInventoryHostSnapshot().database'),before);assert.equal(h.call('assetInventoryHostSnapshot().database.inventoryOrgs.length'),2);assert.equal(JSON.stringify(h.fleet),h.initial);const request=h.state.requests.at(-1);assert.equal(request.action,'execute');assert.equal(request.parentDatabaseToken,'parent-token');assert.equal(request.request.databaseToken,'inventory-token');assert.deepEqual(Object.keys(request.request.base).sort(),[...sections,'appMeta'].sort());assert.equal(h.state.commits,1);
});
test('lost own command ACK retries byte-equivalent intent and one physical write',async()=>{
 const h=harness();await h.call('assetInventoryLoadDatabase()');h.state.lose=true;const first=await newOrg(h,'retry-independent-org');assert.equal(first.ok,false);assert.equal(first.unknown,true);assert.equal(h.call('assetInventoryHostSnapshot().database.inventoryOrgs.length'),1);const second=await h.call("assetInventoryExecuteCommand({type:'AssetInventoryAction',version:1,input},{operationId})");assert.equal(second.ok,true,second.error);assert.equal(h.call('assetInventoryHostSnapshot().database.inventoryOrgs.length'),2);assert.equal(h.state.commits,1);assert.deepEqual(h.state.requests.filter(row=>row.action==='execute')[0],h.state.requests.filter(row=>row.action==='execute')[1]);assert.equal(JSON.stringify(h.fleet),h.initial);
});
test('import and report bridge requests retain independent and parent tokens',async()=>{
 const h=harness();await h.call('assetInventoryLoadDatabase()');await h.call("assetInventoryImportSource({action:'preview',profile:'asset-inventory',databaseToken:assetInventoryDatabaseToken(),sourceId:'a'.repeat(64),reason:'Explicit VM source'})");await h.call("assetInventoryExportRequest({format:'pdf',sessionId:0,databaseToken:assetInventoryDatabaseToken()})");assert.deepEqual(h.state.requests.slice(1).map(row=>row.action),['importSource','export']);for(const row of h.state.requests.slice(1)){assert.equal(row.parentDatabaseToken,'parent-token');assert.equal(row.request.databaseToken,'inventory-token');}assert.equal(h.state.requests.at(-1).request.sessionId,0);assert.equal(JSON.stringify(h.fleet),h.initial);
});
test('parent switch fences an in-flight own snapshot without installing old data',async()=>{
 const h=harness();h.state.hold=true;const pending=h.call('assetInventoryLoadDatabase()');h.context._sync.databaseToken='different-parent';h.state.release();await assert.rejects(pending,/изменились/);assert.equal(h.call('assetInventoryDatabaseToken()'),null);assert.equal(h.call('assetInventoryHostSnapshot().database.inventoryOrgs'),undefined);assert.equal(JSON.stringify(h.fleet),h.initial);
});
test('read-only access cannot send a sidecar write and cannot inherit main writable privileges',async()=>{
 const h=harness();await h.call('assetInventoryLoadDatabase()');h.state.writable=[];assert.equal(h.call('assetInventoryHostSnapshot().canWrite'),false);assert.equal(h.call('assetInventoryDatabaseToken()'),null);assert.equal(h.call('assetInventoryHostSnapshot().database.inventoryOrgs'),undefined);const reply=await newOrg(h);assert.equal(reply.ok,false);assert.match(reply.error,/дождитесь загрузки|Нет права/);assert.equal(h.state.requests.filter(row=>row.action==='execute').length,0);assert.equal(JSON.stringify(h.fleet),h.initial);
});
