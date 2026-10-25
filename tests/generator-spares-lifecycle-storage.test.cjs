'use strict';
// Only synthetic, pinned temporary profiles. Exercise the trusted storage path.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const storage=require('../electron/storage'),sqlite=require('../electron/sqlite-storage.cjs');
const schema=require('../assets/core/platform-schema'),kernel=require('../assets/core/platform-kernel');
const commands=require('../assets/core/platform-commands'),maintenance=require('../assets/core/generator-maintenance');
const print=require('../assets/core/generator-maintenance-print'),inventory=require('../assets/core/inventory-stock');
const compatibility=require('../assets/core/platform-compatibility'),format=require('../electron/storage-format.cjs');
const admin={id:'spares-admin',name:'Synthetic stock administrator',role:'admin'};
const now='2026-10-25T12:00:00.000Z',today=now.slice(0,10),copy=structuredClone;
const part=(id,generatorId='g')=>({id,generatorId,name:'Synthetic filter '+id,unit:'шт',kind:'part'});
function initial(){return {...Object.fromEntries(schema.sections.map(name=>[name,[]])),
 generators:[{id:0,name:'Numeric DES',org:'A',site:'N',hoursInit:0},{id:'0',name:'Text DES',org:'A',site:'N',hoursInit:0},{id:'g',name:'Unique DES',org:'A',site:'N',hoursInit:0}],
 parts:[part(0,0),part('0','0'),part('history'),part('positive'),part('merge-source'),part('merge-target')],
 partMovements:[{id:'in',partId:'history',date:'2026-10-01',kind:'receipt',qty:2},{id:'out',partId:'history',date:'2026-10-02',kind:'issue',qty:2,assetRef:'g:g'},
 {id:'positive-in',partId:'positive',date:'2026-10-01',kind:'receipt',qty:5}],
 payments:[{id:'money',date:'2026-10-01',sum:923.537,description:'Synthetic unchanged finance'}]};}
function fixture(t,kind,change=()=>{}){
 const parent=fs.realpathSync.native(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'tvs-spare-lifecycle-')),pin=fs.lstatSync(root),dir=path.join(root,'db'),data=initial();change(data);
 if(kind==='sqlite')sqlite.create(dir,{data});else storage.createJson(dir,{data});
 t.after(()=>{const current=fs.lstatSync(root);assert.equal(path.dirname(root),parent);assert.match(path.basename(root),/^tvs-spare-lifecycle-/);assert.equal(fs.realpathSync.native(root),root);assert.equal(current.isSymbolicLink(),false);assert.equal(current.dev,pin.dev);assert.equal(current.ino,pin.ino);fs.rmSync(root,{recursive:true,force:true});});
 return dir;
}
const read=dir=>storage.readSnapshot(dir);
function body(source,sections,id){const value={databaseToken:source.databaseToken,base:source.revisions,sections};if(id){value.operation={id};value.operation.digest=kernel.requestDigest(value);}return value;}
function write(dir,sections,{source=read(dir),principal=admin,full=false,id,beforeCommit}={}){
 const options={principal,now,...(beforeCommit?{beforeCommit}:{})};
 return full?storage.writeAll(dir,{...source.data,...sections},{...options,base:source.revisions,requireBase:true,databaseToken:source.databaseToken}):storage.writeSections(dir,body(source,sections,id),options);
}
const changedParts=(snapshot,id,changes)=>snapshot.data.parts.map(row=>row.id===id?{...row,...changes}:row);
function unchangedBusiness(before,after){for(const name of schema.sections)if(name!=='parts'&&name!=='auditLog'){assert.deepEqual(after.data[name],before.data[name],name);assert.equal(after.revisions[name],before.revisions[name],name+' revision');}}
function command(dir,input,id){const source=read(dir),action={type:'GeneratorMaintenanceAction',version:1,input:{...input,reviewFingerprint:maintenance.preview(source.data,input,{today}).fingerprint}};
 return storage.executeCommand(dir,{protocolVersion:1,databaseToken:source.databaseToken,base:Object.fromEntries(commands.dependencies(action).map(name=>[name,source.revisions[name]])),operation:{id},command:action},{principal:admin,now});}
function approvePlan(dir){
 const payload={org:'A',year:2026,title:'Synthetic frozen schedule',rows:[{id:0,generatorId:'g',site:'N',type:'ТО-1',plannedHours:250,plannedDate:'2026-11-01',work:'Replace filter',note:'',components:[{partId:'history',qty:1}]}],commission:{chairman:{name:'Synthetic chair',position:'Engineer'},members:[]}};
 assert.equal(command(dir,{action:'saveDraft',payload,reason:'Synthetic plan'},'plan').ok,true);
 assert.equal(command(dir,{action:'approve',planId:'plan',date:today,document:'Synthetic commission decision',reason:'Synthetic actual approval'},'approve').ok,true);
}

test('lifecycle is optional and separately negotiated with older stock-capable peers',()=>{
 for(const older of ['client','server']){const {hello,serverProfile}=copy(compatibility.describe()),peer=older==='client'?hello:serverProfile;
  peer.capabilities=peer.capabilities.filter(item=>item.name!=='generatorSparesLifecycleV1');
  const result=compatibility.negotiate(hello,serverProfile,format.describe(6));assert.equal(result.mode,'read-write');
  assert.ok(result.selectedProfile.capabilities.some(item=>item.name==='generatorSparesV1'));
  assert.ok(!result.selectedProfile.capabilities.some(item=>item.name==='generatorSparesLifecycleV1'));
 }
 const {hello,serverProfile}=compatibility.describe(),result=compatibility.negotiate(hello,serverProfile,format.describe(6));
 assert.ok(result.selectedProfile.capabilities.some(item=>item.name==='generatorSparesLifecycleV1'&&item.version===1));
 assert.ok(!serverProfile.requiredReadCapabilities.some(item=>item.name==='generatorSparesLifecycleV1'));
 assert.ok(!serverProfile.requiredWriteCapabilities.some(item=>item.name==='generatorSparesLifecycleV1'));
});

for(const kind of ['json','sqlite']){
 test(kind+' removes only the exact unused typed position and replays its canonical receipt once',t=>{
  const dir=fixture(t,kind),before=read(dir),payload=body(before,{parts:before.data.parts.filter(row=>row.id!==0)},'delete-zero');let commits=0;
  const options={principal:admin,now,beforeCommit:()=>commits++};const result=storage.writeSections(dir,payload,options);assert.equal(result.ok,true);
  const after=read(dir);assert.ok(!after.data.parts.some(row=>row.id===0));assert.ok(after.data.parts.some(row=>row.id==='0'));unchangedBusiness(before,after);
  assert.deepEqual(result.canonicalSections.parts,after.data.parts);assert.equal(commits,1);
  assert.equal(storage.writeSections(dir,payload,options).replayed,true);assert.equal(commits,1);assert.deepEqual(read(dir),after);
  assert.equal(after.data.auditLog.filter(row=>row.type==='transaction'&&row.operationId==='delete-zero').length,1);
 });
 test(kind+' refuses physical and soft deletion of used stock and archive with a nonzero balance before any commit',t=>{
  const dir=fixture(t,kind),before=read(dir);let commits=0;
  for(const full of [false,true])for(const sections of [
   {parts:before.data.parts.filter(row=>row.id!=='history')},
   {parts:changedParts(before,'history',{deleted:true})},
   {parts:changedParts(before,'positive',{archived:true})},
   {parts:before.data.parts.filter(row=>row.id!=='history'),partMovements:before.data.partMovements.filter(row=>row.partId!=='history')}
  ]){assert.throws(()=>write(dir,sections,{full,beforeCommit:()=>commits++}));assert.deepEqual(read(dir),before);}
  assert.equal(commits,0);
 });
 test(kind+' preserves posted history, approved snapshot and exact old print bytes through archive and restore',t=>{
  const dir=fixture(t,kind);approvePlan(dir);const before=read(dir),html=print.render(print.prepare(before.data,'plan'),{document:'spares'});
  assert.equal(inventory.balanceAt(before.data,{section:'parts',id:'history'},today).balance,0);
  assert.equal(write(dir,{parts:changedParts(before,'history',{archived:true,archivedAt:now})}).ok,true);
  const archived=read(dir);assert.equal(archived.data.parts.find(row=>row.id==='history').archived,true);unchangedBusiness(before,archived);
  assert.equal(print.render(print.prepare(archived.data,'plan'),{document:'spares'}),html);
  const restoredParts=changedParts(archived,'history',{archived:false}).map(row=>{if(row.id==='history')delete row.archivedAt;return row;});
  assert.equal(write(dir,{parts:restoredParts}).ok,true);const restored=read(dir);unchangedBusiness(before,restored);
  assert.equal(restored.data.parts.find(row=>row.id==='history').generatorId,'g');assert.equal(print.render(print.prepare(restored.data,'plan'),{document:'spares'}),html);
 });
 test(kind+' hidden financial and draft references still prevent narrowed direct writes and bulk removal',t=>{
  const dir=fixture(t,kind,data=>{data.costEntries=[{id:'hidden-cost',amount:1,partId:0,note:'Synthetic hidden accounting link'}];data.documentDrafts=[{id:'hidden-draft',section:'partMovements',status:'discarded',payload:{partId:0}}];}),before=read(dir);
  const principal={...admin,readable:['generators','parts','partMovements']};let commits=0;
  for(const full of [false,true]){
   assert.throws(()=>write(dir,{parts:before.data.parts.filter(row=>row.id!==0)},{principal,full,beforeCommit:()=>commits++}));
   assert.deepEqual(read(dir),before);
   assert.throws(()=>write(dir,{parts:before.data.parts.filter(row=>row.id!==0),costEntries:[],documentDrafts:[]},{full,beforeCommit:()=>commits++}));assert.deepEqual(read(dir),before);
  }
  assert.equal(commits,0);
 });
 test(kind+' viewer, field restrictions, stale versions and failed precommit cannot change the catalog',t=>{
  const dir=fixture(t,kind),before=read(dir),parts=changedParts(before,'history',{archived:true});let commits=0;
  for(const principal of [{...admin,role:'viewer'},{...admin,writeFields:{parts:['name']}}]){assert.throws(()=>write(dir,{parts},{principal,beforeCommit:()=>commits++}));assert.deepEqual(read(dir),before);}
  assert.equal(commits,0);
  assert.throws(()=>write(dir,{parts},{beforeCommit:()=>{throw Error('Synthetic preparation failure');}}),/Synthetic preparation failure/);assert.deepEqual(read(dir),before);
  assert.equal(write(dir,{parts:changedParts(before,'history',{note:'Concurrent description'})}).ok,true);const newer=read(dir);
  const rejected=write(dir,{parts},{source:before});assert.equal(rejected.ok,false);assert.ok(rejected.conflicts.includes('parts'));assert.deepEqual(read(dir),newer);
 });
 test(kind+' a verified same-owner catalog merge retains its existing strict proof path',t=>{
  const dir=fixture(t,kind),before=read(dir),merge=require('../assets/core/catalog-merge');
  const input={section:'parts',sourceId:'merge-source',targetId:'merge-target',reason:'Synthetic duplicate stock card',mutableRefs:[]},preview=merge.preview(before.data,input,{today,readable:schema.sections});
  assert.equal(preview.canMerge,true,JSON.stringify(preview.blockers));const action={type:'MergeCatalog',version:1,input:{...input,reviewFingerprint:preview.fingerprint}},request={protocolVersion:1,databaseToken:before.databaseToken,base:before.revisions,operation:{id:'merge-owned'},command:action};
  const result=storage.executeCommand(dir,request,{principal:admin,now});assert.equal(result.ok,true);const after=read(dir),source=after.data.parts.find(row=>row.id==='merge-source');
  assert.equal(source.archived,true);assert.equal(source.mergedInto.id,'merge-target');unchangedBusiness(before,after);
 });
}
