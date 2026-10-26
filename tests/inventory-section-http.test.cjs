'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const storage=require('../electron/storage'),server=require('../electron/server'),commands=require('../assets/core/platform-commands.js'),inventory=require('../assets/core/asset-inventory.js');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
test('network inventory uses its own SQLite store while the active fleet database stays JSON',{timeout:90000},async t=>{
 const parent=fs.realpathSync.native(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'tvs-inventory-section-http-')),pin=fs.lstatSync(root),directory=path.join(root,'main');
 t.after(async()=>{await server.stop();const current=fs.lstatSync(root);assert.equal(current.isSymbolicLink(),false);assert.equal(current.ino,pin.ino);assert.equal(path.dirname(root),parent);assert.match(path.basename(root),/^tvs-inventory-section-http-/);fs.rmSync(root,{recursive:true,force:true});});
 storage.createJson(directory,{data:{vehicles:[{id:'fleet-only',plate:'SYNTHETIC HTTP FLEET',fuelBalance:0}]}});
 const token=storage.databaseToken(directory),before=storage.readSnapshot(directory),files={};
 function capture(dir,prefix=''){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const name=prefix+entry.name;if(name==='inventory-data')continue;const filename=path.join(dir,entry.name);if(entry.isDirectory())capture(filename,name+'/');else files[name]=hash(fs.readFileSync(filename));}}
 capture(directory);const original=structuredClone(files),key='synthetic-section-http-key-long';
 const started=await server.start({port:0,dataDir:directory,key});assert.equal(started.ok,true,started.error);
 async function request(payload,credential=key){const response=await fetch('http://127.0.0.1:'+started.port+'/api/inventory-database',{method:'POST',headers:{authorization:'Bearer '+credential,'content-type':'application/json'},body:JSON.stringify(payload)});return {status:response.status,body:await response.json()};}
 const denied=await request({action:'snapshot',parentDatabaseToken:token},'invalid-key');assert.equal(denied.status,401);assert.equal(fs.existsSync(path.join(directory,'inventory-data')),false);
 const stale=await request({action:'snapshot',parentDatabaseToken:'wrong-parent'});assert.equal(stale.body.ok,false);assert.equal(stale.body.code,'DATABASE_CHANGED');
 const reply=await request({action:'snapshot',parentDatabaseToken:token});assert.equal(reply.status,200,JSON.stringify(reply.body));const snapshot=reply.body;
 assert.equal(snapshot.ok,true);assert.equal(snapshot.platform.storageKind,'sqlite');assert.equal(snapshot.platform.schemaVersion,6);assert.notEqual(snapshot.databaseToken,token);assert.equal(snapshot.data.vehicles,undefined);
 const input={action:'saveCatalog',section:'inventoryOrgs',payload:{name:'HTTP own inventory organisation',note:''},reason:'Synthetic independent HTTP inventory creation'};
 const preview=inventory.preview(snapshot.data,input,{today:'2026-10-26'});assert.equal(preview.canApply,true,JSON.stringify(preview.issues));
 const command={type:'AssetInventoryAction',version:1,input:{...input,reviewFingerprint:preview.fingerprint}},envelope={protocolVersion:1,databaseToken:snapshot.databaseToken,operation:{id:'http-own-inventory-operation'},base:Object.fromEntries(commands.dependencies(command).map(name=>[name,snapshot.revisions[name]])),command};
 const created=await request({action:'execute',parentDatabaseToken:token,request:envelope});assert.equal(created.status,200,JSON.stringify(created.body));assert.equal(created.body.ok,true);assert.equal(created.body.operationReceipt.id,envelope.operation.id);
 const again=await request({action:'execute',parentDatabaseToken:token,request:envelope});assert.equal(again.body.ok,true);assert.equal(again.body.replayed,true);
 const reopened=await request({action:'snapshot',parentDatabaseToken:token});assert.equal(reopened.body.data.inventoryOrgs.length,1);assert.equal(reopened.body.data.inventoryOrgs[0].name,input.payload.name);
 const invalidOwn=await request({action:'execute',parentDatabaseToken:token,request:{...envelope,databaseToken:token}});assert.equal(invalidOwn.body.ok,false);assert.equal(invalidOwn.body.code,'DATABASE_CHANGED');
 const invalidCommand=await request({action:'execute',parentDatabaseToken:token,request:{...envelope,command:{...command,type:'DeleteEntity'}}});assert.equal(invalidCommand.body.ok,false);
 assert.deepEqual(storage.readSnapshot(directory),before);for(const name of Object.keys(files))delete files[name];capture(directory);assert.deepEqual(files,original,'Main JSON database files changed');
});
