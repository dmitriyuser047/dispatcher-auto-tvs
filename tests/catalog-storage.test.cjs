'use strict';
const {writerHeaders}=require('./helpers/http-writer.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const storage=require('../electron/storage'),sqlite=require('../electron/sqlite-storage.cjs'),server=require('../electron/server'),access=require('../electron/access-control');
const schema=require('../assets/core/platform-schema.js'),contracts=require('../assets/core/platform-contracts.js'),commands=require('../assets/core/platform-commands.js'),kernel=require('../assets/core/platform-kernel.js'),policy=require('../assets/core/catalog-policy.js');
const admin={id:'catalog-admin',name:'Synthetic catalog administrator',role:'admin'},now='2026-10-22T12:00:00.000Z';
const merge=()=>require('../assets/core/catalog-merge.js');
const copy=value=>structuredClone(value),codes=code=>error=>error.code===code||error.issues?.some(issue=>issue.code===code)||error.details?.issues?.some(issue=>issue.code===code);
function sample(){return {...Object.fromEntries(schema.sections.map(name=>[name,[]])),contragents:[{id:0,name:'Synthetic duplicate party',inn:''},{id:'target',name:'Synthetic main party',inn:''}],payments:[{id:'payment',contragentId:0,contragent:'Historical party title',contragentAtIssue:'Historical party title',sum:7.01,date:'2026-09-10',sourceSnapshot:{contragentId:0,oldValue:923.537}}]};}
function raw(dir,data,revisions){if(sqlite.exists(dir)){sqlite.commitSections(dir,data,revisions);return;}for(const [name,rows]of Object.entries(data))fs.writeFileSync(storage.sectionFile(dir,name),JSON.stringify(rows));fs.writeFileSync(storage.revisionsFile(dir),JSON.stringify(storage.encodeRevisions(revisions)));}
function fixture(t,format,change=()=>{}){const root=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-catalog-storage-')),dir=path.join(root,'db'),data=sample();change(data);const revisions=Object.fromEntries(schema.sections.map(name=>[name,1]));if(format==='sqlite')sqlite.create(dir,{data,revisions});else{fs.mkdirSync(storage.sectionsDir(dir),{recursive:true});raw(dir,data,revisions);}t.after(()=>{server.stop();assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('tvs-catalog-storage-'));fs.rmSync(root,{recursive:true,force:true});});return {dir};}
const snapshot=dir=>storage.readSnapshot(dir);
function input(overrides={}){return {section:'contragents',sourceId:0,targetId:'target',reason:'Synthetic reviewed duplicate identity',mutableRefs:[],...overrides};}
function envelope(dir,overrides={},id='catalog-merge-once'){const old=snapshot(dir),value=input(overrides),preview=merge().preview(old.data,value,{today:now.slice(0,10),readable:schema.sections}),command={type:'MergeCatalog',version:1,input:{...value,reviewFingerprint:preview.fingerprint}};return {protocolVersion:1,databaseToken:old.databaseToken,operation:{id},base:old.revisions,command};}
const execute=(dir,request,options={})=>storage.executeCommand(dir,request,{principal:admin,now,...options});
function save(dir,sections,full=false){const old=snapshot(dir);return full?storage.writeAll(dir,{...old.data,...sections},{principal:admin,now,base:old.revisions,requireBase:true,databaseToken:old.databaseToken}):storage.writeSections(dir,{databaseToken:old.databaseToken,base:old.revisions,sections},{principal:admin,now});}
const alias=(target='target')=>({version:1,section:'contragents',id:target,reason:'Synthetic reviewed duplicate identity',at:now,actor:admin,operationId:'catalog-merge-once'});

test('MergeCatalog strict DTO owns typed IDs and refuses injected metadata, duplicate refs and unsupported paths',()=>{
 const value={type:'MergeCatalog',version:1,input:{...input(),reviewFingerprint:'sha256:'+'a'.repeat(64)}};assert.equal(contracts.validateCommand(value).input.sourceId,0);
 for(const changes of [{actor:admin},{mergedInto:alias()},{section:'records'},{sourceId:'target'},{reviewFingerprint:'bad'},{mutableRefs:[{relationId:'opsTasks.assetRef',rowId:0,path:'assetRef'},{relationId:'opsTasks.assetRef',rowId:0,path:'assetRef'}]},{mutableRefs:[{relationId:'opsTasks.assetRef',rowId:'row',path:'__proto__.polluted'}]}])assert.throws(()=>contracts.validateCommand({...value,input:{...value.input,...changes}}));
 const parsed=contracts.validateCommand({...value,input:{...value.input,mutableRefs:[{relationId:'x',rowId:7,path:'partRequirements[0].partId'},{relationId:'x',rowId:'7',path:'partRequirements[0].partId'}]}});assert.equal(parsed.input.mutableRefs.length,2);
 assert.throws(()=>commands.footprint({...value,input:{...value.input,mutableRefs:[{relationId:'auditLog.recordId',rowId:'old-audit',path:'recordId'}]}}),{code:'INVALID_COMMAND'});
});

for(const format of ['json','sqlite']){
 test(format+' audit prefixes accept object key portability without rewriting stored snapshots on section and full saves',t=>{
  const {dir}=fixture(t,format,data=>{data.contragents[0].legacyMeta={ids:[0,'0'],inner:{value:923.537,flag:true}};});
  const reverseKeys=value=>Array.isArray(value)?value.map(reverseKeys):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).reverse().map(key=>[key,reverseKeys(value[key])])):value;
  assert.equal(save(dir,{contragents:snapshot(dir).data.contragents.map(row=>row.id===0?{...row,note:'First description'}:row)}).ok,true);
  for(const full of [false,true]){
   const before=snapshot(dir),prefix=JSON.stringify(before.data.auditLog),auditLog=reverseKeys(before.data.auditLog);
   assert.notEqual(JSON.stringify(auditLog),prefix);assert.equal(kernel.stableSerialize(auditLog),kernel.stableSerialize(before.data.auditLog));
   assert.equal(save(dir,{auditLog,contragents:before.data.contragents.map(row=>row.id===0?{...row,note:full?'Third description':'Second description'}:row)},full).ok,true);
   const after=snapshot(dir);assert.equal(JSON.stringify(after.data.auditLog.slice(0,before.data.auditLog.length)),prefix);assert.deepEqual(after.data.contragents[0].legacyMeta,{ids:[0,'0'],inner:{value:923.537,flag:true}});
  }
 });

 test(format+' audit prefixes reject nested values, typed IDs, array order and deletions without changing any data or revision',t=>{
  const {dir}=fixture(t,format,data=>{data.contragents[0].legacyMeta={ids:[0,'0'],inner:{value:923.537,flag:true}};});
  assert.equal(save(dir,{contragents:snapshot(dir).data.contragents.map(row=>row.id===0?{...row,note:'First description'}:row)}).ok,true);
  const before=snapshot(dir),tamper=[rows=>{rows[0].after.legacyMeta.inner.value=923.538;},rows=>{rows[0].after.legacyMeta.ids[0]='0';},rows=>{rows[0].after.legacyMeta.ids.reverse();},rows=>{rows.reverse();},rows=>{rows.shift();},rows=>{delete rows[0].before.legacyMeta.inner.flag;}];
  for(const full of [false,true])for(const change of tamper){const auditLog=copy(before.data.auditLog);change(auditLog);assert.throws(()=>save(dir,{auditLog,contragents:before.data.contragents.map(row=>row.id===0?{...row,note:'Must not persist'}:row)},full),{code:'AUDIT_IMMUTABLE'});assert.deepEqual(snapshot(dir),before);}
 });

 test(format+' MergeCatalog archives numeric zero with trusted immutable metadata and preserves pinned financial facts byte for byte',t=>{
  const {dir}=fixture(t,format),old=snapshot(dir),request=envelope(dir),result=execute(dir,request),after=snapshot(dir);assert.equal(result.ok,true);assert.deepEqual(commands.dependencies(request.command).sort(),[...schema.sections].sort());assert.deepEqual(result.changed.slice().sort(),['auditLog','contragents']);
  const source=after.data.contragents.find(row=>row.id===0);assert.equal(source.archived,true);assert.equal(source.archivedAt,now);assert.deepEqual(source.mergedInto,alias());assert.deepEqual(after.data.contragents.find(row=>row.id==='target'),old.data.contragents[1]);assert.deepEqual(after.data.payments,old.data.payments);assert.equal(JSON.stringify(after.data.payments),JSON.stringify(old.data.payments));assert.equal(result.canonicalSections.contragents[0].id,0);
  for(const section of schema.sections.filter(name=>!result.changed.includes(name)))assert.deepEqual(after.data[section],old.data[section],section);
  const receipt=after.data.auditLog.filter(row=>row.type==='transaction'&&row.operationId===request.operation.id);assert.equal(receipt.length,1);assert.equal(receipt[0].requestDigest,kernel.requestDigest(request));assert.equal(receipt[0].actorId,admin.id);
 });

 test(format+' exact committed merge replays before stale audit dependency, new validators, backup and clock',t=>{
  const {dir}=fixture(t,format),request=envelope(dir);let backups=0;assert.equal(execute(dir,request,{beforeCommit:()=>{backups++;}}).ok,true);const committed=snapshot(dir);assert.equal(save(dir,{contragents:committed.data.contragents.map(row=>row.id==='target'?{...row,note:'Later description'}:row)}).ok,true);const before=snapshot(dir);
  const replay=execute(dir,request,{now:'must-not-read-clock',beforeCommit:()=>{backups++;throw Error('must not back up a replay');}});assert.equal(replay.replayed,true);assert.equal(replay.operationReceipt.digest,kernel.requestDigest(request));assert.equal(backups,1);assert.deepEqual(snapshot(dir),before);assert.deepEqual(replay.canonicalSections.contragents,before.data.contragents);
  assert.throws(()=>execute(dir,{...request,command:{...request.command,input:{...request.command.input,reason:'Different intent'}}}),{code:'OPERATION_REUSED'});assert.deepEqual(snapshot(dir),before);
 });

 test(format+' every dependency including audit is CAS checked, and an unreviewed source cannot commit',t=>{
  const {dir}=fixture(t,format),request=envelope(dir),old=snapshot(dir),withoutAudit=copy(request);delete withoutAudit.base.auditLog;assert.throws(()=>execute(dir,withoutAudit),{code:'COMMAND_BASE_REQUIRED'});assert.deepEqual(snapshot(dir),old);
  assert.equal(save(dir,{contragents:old.data.contragents.map(row=>row.id==='target'?{...row,note:'Concurrent edit'}:row)}).ok,true);const current=snapshot(dir),stale=execute(dir,request);assert.equal(stale.ok,false);assert.ok(stale.conflicts.includes('auditLog'));assert.deepEqual(snapshot(dir),current);
  const wrong=envelope(dir,{},'different-review');wrong.command.input.reviewFingerprint='sha256:'+'0'.repeat(64);assert.throws(()=>execute(dir,wrong));assert.deepEqual(snapshot(dir),current);
 });

 test(format+' raw full and section channels and ordinary kernel cannot forge, edit, restore or delete catalog aliases',t=>{
  const {dir}=fixture(t,format),old=snapshot(dir),forged=old.data.contragents.map(row=>row.id===0?{...row,mergedInto:alias(),archived:true,archivedAt:now}:row);
  for(const full of [false,true]){assert.throws(()=>save(dir,{contragents:forged},full),codes('CATALOG_ALIAS_COMMAND_REQUIRED'));assert.deepEqual(snapshot(dir),old);}
  assert.throws(()=>kernel.prepare(old.data,{contragents:forged},{id:'raw-alias',identity:old.databaseToken,actor:admin,now,readable:schema.sections,writable:schema.sections,revisions:old.revisions}),codes('CATALOG_ALIAS_COMMAND_REQUIRED'));
  assert.equal(execute(dir,envelope(dir)).ok,true);const merged=snapshot(dir);
  for(const changed of [merged.data.contragents.filter(row=>row.id!==0),merged.data.contragents.map(row=>row.id===0?{...row,archived:false}:row),merged.data.contragents.map(row=>row.id===0?{...row,mergedInto:{...row.mergedInto,reason:'Forged reason'}}:row),merged.data.contragents.map(row=>row.id===0?{...row,inn:'Unreviewed changed identity'}:row),merged.data.contragents.filter(row=>row.id!=='target')]){assert.throws(()=>save(dir,{contragents:changed}));assert.deepEqual(snapshot(dir),merged);}
  assert.equal(save(dir,{contragents:merged.data.contragents.map(row=>row.id==='target'?{...row,archived:true}:row)}).ok,true);assert.deepEqual(snapshot(dir).data.contragents[0].mergedInto,merged.data.contragents[0].mergedInto);
 });

 test(format+' retained alias history permits comments but refuses a new or factually changed dependent payment',t=>{
  const {dir}=fixture(t,format);assert.equal(execute(dir,envelope(dir)).ok,true);const old=snapshot(dir);assert.equal(save(dir,{payments:old.data.payments.map(row=>({...row,note:'Historical clarification'}))}).ok,true);const described=snapshot(dir);
  assert.throws(()=>save(dir,{payments:[...described.data.payments,{...described.data.payments[0],id:'new-payment'}]}),codes('archived-reference'));assert.deepEqual(snapshot(dir),described);
  for(const payments of [described.data.payments.map(row=>({...row,sum:8.01})),described.data.payments.map(row=>({...row,date:'2026-11-01'}))]){assert.throws(()=>save(dir,{payments}),codes('CATALOG_ALIAS_NEW_FACT'));assert.deepEqual(snapshot(dir),described);}
  for(const payments of [[],described.data.payments.map(row=>({...row,contragentId:'target'}))]){assert.throws(()=>save(dir,{payments}),codes('CATALOG_ALIAS_HISTORY_FROZEN'));assert.deepEqual(snapshot(dir),described);}
  assert.equal(save(dir,{payments:[...described.data.payments,{id:'new-to-main',contragentId:'target',date:'2026-11-01',sum:8.01}]}).ok,true);
 });

 test(format+' MergeCatalog requires a current full-read administrator and write permissions for the real footprint',t=>{
  const {dir}=fixture(t,format),request=envelope(dir),before=snapshot(dir);
  for(const principal of [{...admin,role:'viewer'},{...admin,role:'accountant'},{...admin,readable:schema.sections.filter(name=>name!=='payments')},{...admin,writable:[]}])assert.throws(()=>execute(dir,request,{principal}),{code:'ACCESS_DENIED'});
  assert.deepEqual(snapshot(dir),before);
 });

 test(format+' precommit failure leaves source, pinned facts, audit, receipt and all revisions unchanged',t=>{
  const {dir}=fixture(t,format),request=envelope(dir),before=snapshot(dir);assert.throws(()=>execute(dir,request,{beforeCommit:()=>{throw Error('Synthetic merge precommit fault');}}),/Synthetic merge precommit fault/);assert.deepEqual(snapshot(dir),before);assert.equal(execute(dir,request).ok,true);
 });

 test(format+' a selected nested draft reference rewires atomically while typed IDs and requested quantities remain unchanged',t=>{
  const {dir}=fixture(t,format,data=>{data.parts=[{id:0,name:'Synthetic duplicate part',unit:'шт',minStock:0},{id:'part-target',name:'Synthetic main part',unit:'шт',minStock:0}];data.dispatchJobs=[{id:0,title:'Synthetic future draft',status:'new',start:'2026-11-01T08:00',end:'2026-11-01T12:00',partRequirements:[{partId:0,qty:1.234}]}];}),old=snapshot(dir);
  const request=envelope(dir,{section:'parts',sourceId:0,targetId:'part-target',mutableRefs:[{relationId:'dispatchJobs.partRequirements[].partId',rowId:0,path:'partRequirements[0].partId'}]},'catalog-draft-ref');const result=execute(dir,request),after=snapshot(dir);assert.equal(result.ok,true);assert.deepEqual(result.changed.slice().sort(),['auditLog','dispatchJobs','parts']);assert.equal(after.data.dispatchJobs[0].id,0);assert.equal(after.data.dispatchJobs[0].partRequirements[0].partId,'part-target');assert.equal(after.data.dispatchJobs[0].partRequirements[0].qty,1.234);assert.deepEqual(after.data.payments,old.data.payments);assert.equal(after.data.parts[0].id,0);assert.equal(after.data.parts[0].minStock,0);assert.equal(after.data.parts[1].minStock,0);
 });

 test(format+' an old assignment to an alias can only close or narrow its interval without activating new work',t=>{
  const {dir}=fixture(t,format,data=>{data.drivers=[{id:0,name:'Synthetic archived duplicate',archived:true,archivedAt:now,personnelRoles:['driver'],mergedInto:{...alias('driver-target'),section:'drivers'}},{id:'driver-target',name:'Synthetic main driver',personnelRoles:['driver']}];data.vehicles=[{id:'v',plate:'SYNTHETIC',fuelBalance:0}];data.assetAssignments=[{id:'assignment',driverId:0,assetRef:'v:v',from:'2026-09-01',to:'',site:'Synthetic site',reason:'Historical assignment document'}];}),old=snapshot(dir);
  const narrowed=old.data.assetAssignments.map(row=>({...row,to:'2026-10-22'}));assert.equal(save(dir,{assetAssignments:narrowed}).ok,true);const current=snapshot(dir);
  for(const changes of [{to:''},{to:'2026-11-01'},{to:'2026-08-31'},{to:'2026-10-21',from:'2026-09-02'},{to:'2026-10-21',status:'active'},{to:'2026-10-21',driverId:'driver-target'}]){assert.throws(()=>save(dir,{assetAssignments:current.data.assetAssignments.map(row=>({...row,...changes}))}));assert.deepEqual(snapshot(dir),current);}
  assert.equal(save(dir,{assetAssignments:current.data.assetAssignments.map(row=>({...row,to:'2026-10-21',note:'Earlier confirmed end'}))}).ok,true);
 });

 test(format+' a future mutable assignment may be explicitly corrected away from an alias without changing its dates',t=>{
  const {dir}=fixture(t,format,data=>{data.drivers=[{id:0,name:'Synthetic archived duplicate',archived:true,archivedAt:now,personnelRoles:['driver'],mergedInto:{...alias('driver-target'),section:'drivers'}},{id:'driver-target',name:'Synthetic main driver',personnelRoles:['driver']}];data.vehicles=[{id:'v',plate:'SYNTHETIC',fuelBalance:0}];data.assetAssignments=[{id:'future-assignment',driverId:0,assetRef:'v:v',from:'2026-11-01',to:'',site:'Synthetic site',reason:'Future assignment document'}];}),old=snapshot(dir);
  assert.equal(save(dir,{assetAssignments:old.data.assetAssignments.map(row=>({...row,driverId:'driver-target'}))}).ok,true);const current=snapshot(dir);assert.equal(current.data.assetAssignments[0].driverId,'driver-target');assert.equal(current.data.assetAssignments[0].from,'2026-11-01');assert.equal(current.data.assetAssignments[0].to,'');assert.deepEqual(current.data.drivers,old.data.drivers);
 });
}

test('alias cycles and cross-section metadata are diagnosed without publishing values from unreadable catalogs',()=>{
 const db=sample();db.contragents=[{id:'a',archived:true,archivedAt:now,mergedInto:{...alias('b')}},{id:'b',archived:true,archivedAt:now,mergedInto:{...alias('a')}}];assert.ok(policy.inspect(db).issues.some(issue=>issue.code==='CATALOG_ALIAS_CYCLE'));
 db.contragents[0].mergedInto.section='drivers';assert.ok(policy.inspect(db).issues.some(issue=>issue.code==='CATALOG_ALIAS_INVALID'));assert.deepEqual(policy.inspect(db,{readable:['vehicles']}).issues,[]);
});

test('legacy monthly composite identities retain descriptive edits without allowing a historical alias binding change',()=>{
 const previous=sample();previous.vehicles=[{id:0,archived:true,archivedAt:now,mergedInto:{...alias('main-vehicle'),section:'vehicles'}},{id:'main-vehicle'}];previous.monthlyFuel=[{vehicleId:0,month:'2026-09',cardNumber:'123',liters:923.537},{vehicleId:0,month:'2026-10',cardNumber:'123',liters:1}];const next=copy(previous);next.monthlyFuel[0].note='Synthetic historical reconciliation comment';assert.equal(policy.validateChanges(previous,next,{now}),true);next.monthlyFuel[0].vehicleId='main-vehicle';assert.throws(()=>policy.validateChanges(previous,next,{now}),codes('CATALOG_ALIAS_HISTORY_FROZEN'));assert.equal(previous.monthlyFuel[0].vehicleId,0);const stock=copy(previous);stock.vehicles[0].fuelBalance=1;assert.throws(()=>policy.validateChanges(previous,stock,{now}),codes('CATALOG_ALIAS_SOURCE_FROZEN'));
});

test('pure kernel merge proof rederives the exact plan and cannot authorize altered actor metadata or unrelated target edits',t=>{
 const {dir}=fixture(t,'json'),old=snapshot(dir),request=envelope(dir),planned=commands.plan(old.data,request.command,{id:request.operation.id,now,today:now.slice(0,10),actor:admin}),context={id:request.operation.id,identity:old.databaseToken,actor:admin,now,revisions:old.revisions,readable:schema.sections,writable:schema.sections,commandIntent:request};
 assert.equal(kernel.prepare(old.data,planned.sections,context).changed.includes('contragents'),true);
 for(const transform of [sections=>{sections.contragents[0].mergedInto.actor.id='spoofed';},sections=>{sections.contragents[1].name='Unreviewed target rename';},sections=>{sections.contragents[0].mergedInto.operationId='other-operation';}]){const changed=copy(planned.sections);transform(changed);assert.throws(()=>kernel.prepare(old.data,changed,context),codes('CATALOG_ALIAS_COMMAND_REQUIRED'));}
 assert.deepEqual(snapshot(dir),old);
});

test('failed JSON audit publication rolls back the alias and receipt with all section versions',t=>{
 const {dir}=fixture(t,'json'),request=envelope(dir),before=snapshot(dir),original=fs.renameSync;let injected=false;
 try{fs.renameSync=function(from,to){if(!injected&&path.resolve(to)===storage.sectionFile(dir,'auditLog')){injected=true;throw Object.assign(Error('Synthetic catalog audit publication fault'),{code:'EIO'});}return original.apply(this,arguments);};assert.throws(()=>execute(dir,request),/Synthetic catalog audit publication fault/);}finally{fs.renameSync=original;}
 assert.equal(injected,true);assert.deepEqual(snapshot(dir),before);assert.equal(execute(dir,request).ok,true);
});

test('failed SQLite outer commit rolls back alias, links, audit and receipt together',t=>{
 const {dir}=fixture(t,'sqlite'),request=envelope(dir),before=snapshot(dir),original=sqlite.commitSections;let injected=false;
 try{sqlite.commitSections=function(dataDir,sections,revisions){const result=original.apply(this,arguments);if(path.resolve(dataDir)===path.resolve(dir)&&Object.hasOwn(sections,'contragents')){injected=true;throw Error('Synthetic catalog transaction fault');}return result;};assert.throws(()=>execute(dir,request),/Synthetic catalog transaction fault/);}finally{sqlite.commitSections=original;}
 assert.equal(injected,true);assert.deepEqual(snapshot(dir),before);assert.deepEqual(sqlite.inspect(dir).foreignKeyErrors,[]);assert.equal(execute(dir,request).ok,true);
});

function post(port,token,value,route='/api/commands'){return new Promise((resolve,reject)=>{const request=http.request({host:'127.0.0.1',port,path:route,method:'POST',agent:false,headers:{...writerHeaders(),Authorization:'Bearer '+token,'Content-Type':'application/json'}},response=>{let text='';response.setEncoding('utf8');response.on('data',part=>{text+=part;});response.on('end',()=>resolve({status:response.statusCode,body:JSON.parse(text),text}));});request.setTimeout(5000,()=>request.destroy(Error('Synthetic catalog HTTP timeout')));request.on('error',reject);request.end(JSON.stringify(value));});}
for(const format of ['json','sqlite'])test('HTTP '+format+' uses the same semantic merge, actor, replay and denied-role boundaries',async t=>{
 const {dir}=fixture(t,format),token='synthetic-catalog-admin-token-0123456789',viewer='synthetic-catalog-viewer-token-0123456789';let backups=0;const settings={serverAccessConfigured:true,serverUsers:access.normalizeServerUsers([{...admin,enabled:true,tokenHash:access.hashToken(token)},{id:'catalog-viewer',name:'Synthetic viewer',role:'viewer',enabled:true,tokenHash:access.hashToken(viewer)}])};
 const started=await server.start({port:0,dataDir:dir,settings:()=>settings,backupFn:()=>{backups++;}});assert.equal(started.ok,true);const request=envelope(dir),before=snapshot(dir),denied=await post(started.port,viewer,request);assert.equal(denied.status,403);assert.deepEqual(snapshot(dir),before);assert.equal(backups,0);
 const forged=commands.plan(before.data,request.command,{id:request.operation.id,now,today:now.slice(0,10),actor:admin}).sections,rawResponse=await post(started.port,token,{databaseToken:before.databaseToken,base:before.revisions,sections:forged,commandIntent:request},'/api/sections');assert.notEqual(rawResponse.status,200);assert.deepEqual(snapshot(dir),before);const previousBackups=backups;
 const committed=await post(started.port,token,request);assert.equal(committed.status,200,committed.text);assert.equal(committed.body.ok,true);const source=committed.body.canonicalSections.contragents.find(row=>row.id===0);assert.equal(source.mergedInto.actor.id,admin.id);assert.equal(source.mergedInto.operationId,request.operation.id);assert.equal(source.mergedInto.at,committed.body.operationReceipt.at);const saved=snapshot(dir);assert.deepEqual(saved.data.payments,before.data.payments);assert.equal(backups,previousBackups+1);
 const replay=await post(started.port,token,request);assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.deepEqual(snapshot(dir),saved);assert.equal(backups,previousBackups+1);
 const malformed=await post(started.port,token,{...request,command:{...request.command,input:{...request.command.input,actor:admin}}});assert.equal(malformed.status,400);assert.deepEqual(snapshot(dir),saved);
});
