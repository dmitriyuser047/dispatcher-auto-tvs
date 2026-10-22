'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const schema=require('../assets/core/platform-schema.js'),storage=require('../electron/storage'),sqlite=require('../electron/sqlite-storage.cjs');
const platform=require('../electron/platform-service.cjs'),access=require('../electron/access-control'),contexts=require('../electron/access-context.cjs');
const service=require('../electron/command-service.cjs'),query=require('../electron/data-query.cjs'),commands=require('../assets/core/platform-commands.js');
const now='2026-10-22T12:00:00.000Z',any={any:true};
const policy=(extra={})=>({version:1,grants:[{org:'А',site:'Север'}],...extra});
const user=(extra={})=>({id:'boundary-user',name:'Synthetic restricted account',role:'admin',accessPolicy:policy(),...extra});
const legacy={id:'legacy-admin',name:'Synthetic unscoped administrator',role:'admin'};
const card=(id,org='А',site='Север',extra={})=>({id,plate:'SYNTHETIC-'+id,org,site,...extra});
function fixture(t,format,overrides={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-access-boundary-')),dir=path.join(root,'db');
 const data={...Object.fromEntries(schema.sections.map(name=>[name,[]])),vehicles:[card(0),card('private','Б','Юг',{note:'PRIVATE-ROW-TEXT'}),card('last')],...overrides};
 const revisions=Object.fromEntries(schema.sections.map(name=>[name,3]));
 if(format==='sqlite')sqlite.create(dir,{data,revisions});else{fs.mkdirSync(path.join(dir,'sections'),{recursive:true});for(const name of schema.sections)fs.writeFileSync(storage.sectionFile(dir,name),JSON.stringify(data[name]));fs.writeFileSync(path.join(dir,'sections','revisions.json'),JSON.stringify(storage.encodeRevisions(revisions)));}
 t.after(()=>{const resolved=path.resolve(root);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.match(path.basename(resolved),/^tvs-access-boundary-/);fs.rmSync(resolved,{recursive:true,force:true});});
 return {root,dir,data,revisions};
}
const write=(dir,principal,snapshot,rows,extra={})=>storage.writeSections(dir,{databaseToken:snapshot.databaseToken,base:snapshot.revisions,scopeViews:snapshot.scopeViews,sections:{vehicles:rows},...extra},{principal,now});
const denied=fn=>assert.throws(fn,error=>error.code==='ACCESS_DENIED'&&error.status===403&&!/PRIVATE|private\.xlsx/.test(error.message));

test('trusted current principals preserve narrowing through token authentication and cannot inherit a caller policyStamp',()=>{
 const token='synthetic-boundary-token-0123456789',configured=user({tokenHash:access.hashToken(token),enabled:true});
 const normalized=access.normalizeServerUsers([configured]),authenticated=access.authenticate(token,{serverAccessConfigured:true,serverUsers:normalized});
 assert.deepEqual(authenticated.accessPolicy,contexts.normalizePrincipal(configured).accessPolicy);
 assert.equal(authenticated.policyStamp,contexts.policyStamp(configured));
 assert.notEqual(contexts.normalizePrincipal({...configured,policyStamp:'sha256:'+'f'.repeat(64)}).policyStamp,'sha256:'+'f'.repeat(64));
 normalized[0].accessPolicy=policy({grants:[]});const current=access.authenticate(token,{serverAccessConfigured:true,serverUsers:normalized});
 assert.notEqual(current.policyStamp,authenticated.policyStamp);
 assert.equal(access.authorize(legacy,'replace'),true);assert.equal(access.authorize(configured,'replace'),false);
});

test('supplemental mechanic field ceilings intersect the role whitelist instead of expanding it',()=>{
 const db=Object.fromEntries(schema.sections.map(name=>[name,[]]));db.vehicles=[card(1)];
 const ctx=contexts.create(db,db,user({role:'mechanic',writeFields:{vehicles:['plate','maintenanceRules']}}));
 assert.deepEqual(ctx.context.writeFields.vehicles,['maintenanceRules']);
 assert.equal(ctx.context.writeFields.vehicles.includes('plate'),false);
});

for(const format of ['json','sqlite']){
 test(format+' snapshot, section and acknowledgement preserve the same current row/field projection',t=>{
  const f=fixture(t,format,{vehicles:[card(0,'А','Север',{note:'OLD',secret:'PRIVATE-FIELD',blank:'',zero:0,no:false,nil:null}),card('private','Б','Юг'),card('last')]});
  const principal=user({accessPolicy:policy({sections:{vehicles:{readFields:['id','plate','note','blank','zero','no','nil'],writeFields:['note']}}})});
  const visible=storage.readSnapshot(f.dir,{principal}),section=storage.readSection(f.dir,'vehicles',{principal});
  assert.deepEqual(section.rows,visible.data.vehicles);assert.deepEqual(section.scopeViews.vehicles,visible.scopeViews.vehicles);assert.deepEqual(section.rows.map(row=>row.id),[0,'last']);assert.doesNotMatch(JSON.stringify(visible),/PRIVATE/);
  const submitted=structuredClone(visible.data.vehicles);submitted[0].note='NEW';
  const result=write(f.dir,principal,visible,submitted);assert.equal(result.ok,true);
  assert.deepEqual(result.canonicalSections.vehicles,storage.readSnapshot(f.dir,{principal}).data.vehicles);assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
  const canonical=storage.readSnapshot(f.dir).data.vehicles;
  assert.deepEqual(canonical.map(row=>row.id),[0,'private','last']);assert.equal(canonical[0].secret,'PRIVATE-FIELD');assert.equal(canonical[0].note,'NEW');
  assert.deepEqual([canonical[0].blank,canonical[0].zero,canonical[0].no,canonical[0].nil],['',0,false,null]);
 });

 test(format+' raw saves require a genuine complete-view witness rather than a query-page fingerprint',t=>{
  const f=fixture(t,format),principal=user(),baseline=storage.readSnapshot(f.dir),visible=storage.readSnapshot(f.dir,{principal}),page=query.queryRows(f.dir,{section:'vehicles',limit:1},principal);
  assert.equal(page.rows.length,1);assert.equal(page.total,2);assert.equal(page.scopeViews,undefined);
  assert.throws(()=>write(f.dir,principal,visible,[{...page.rows[0],note:'change'}],{scopeViews:undefined}),{code:'SCOPE_VIEW_REQUIRED'});
  const forged=structuredClone(visible.scopeViews);forged.vehicles.visibleFingerprint='sha256:'+crypto.createHash('sha256').update(require('../assets/core/platform-kernel.js').stableSerialize(page.rows)).digest('hex');
  assert.throws(()=>write(f.dir,principal,visible,page.rows,{scopeViews:forged}),{code:'SCOPE_VIEW_REQUIRED'});
  const other=user({accessPolicy:policy({grants:[{org:'Б',site:'Юг'}]})});
  assert.throws(()=>write(f.dir,other,visible,page.rows),{code:'SCOPE_VIEW_REQUIRED'});
  assert.deepEqual(storage.readSnapshot(f.dir),baseline);
 });

 test(format+' search/count/page/cursor are calculated only from permitted rows and fields',t=>{
  const f=fixture(t,format,{vehicles:[card(0,'А','Север',{note:'PRIVATE-FIELD-SEARCH'}),card('private','Б','Юг',{note:'PRIVATE-ROW-SEARCH'}),card('last','А','Север',{note:'PRIVATE-FIELD-SEARCH'})]});
  const principal=user({accessPolicy:policy({sections:{vehicles:{readFields:['id','plate','org','site']}}})});
  for(const search of ['PRIVATE-FIELD-SEARCH','PRIVATE-ROW-SEARCH']){const result=query.queryRows(f.dir,{section:'vehicles',limit:1,search},principal);assert.equal(result.total,0);assert.deepEqual(result.rows,[]);assert.equal(result.nextCursor,null);}
  const first=query.queryRows(f.dir,{section:'vehicles',limit:1},principal);assert.equal(first.total,2);assert.equal(first.rows[0].id,0);assert.ok(first.nextCursor);
  const second=query.queryRows(f.dir,{section:'vehicles',limit:1,cursor:first.nextCursor},principal);assert.equal(second.total,2);assert.equal(second.rows[0].id,'last');assert.equal(second.nextCursor,null);
  const changed=user({accessPolicy:policy({grants:[{org:'Б',site:'Юг'}]})});assert.throws(()=>query.queryRows(f.dir,{section:'vehicles',limit:1,cursor:first.nextCursor},changed),{code:'CURSOR_STALE'});
  const revoked=user({accessPolicy:policy({grants:[]})});assert.throws(()=>query.queryRows(f.dir,{section:'vehicles',limit:1,cursor:first.nextCursor},revoked),error=>['CURSOR_STALE','ACCESS_DENIED'].includes(error.code));
 });

 test(format+' hidden typed string collisions yield a generic scope denial rather than identity details',t=>{
  const f=fixture(t,format,{vehicles:[card(0),card('0','Б','Юг')],records:[{id:'r',vehicleId:0,date:'2026-09-01',org:'А',site:'Север',km:1}]});
  denied(()=>query.queryRows(f.dir,{section:'records',assetRef:'v:0'},user()));
 });

 test(format+' filters cannot reveal whether an unreadable date or asset field exists',t=>{
  const principal=user({accessPolicy:policy({sections:{records:{readFields:['id','org','site','km']}}})});
  const absent=fixture(t,format,{records:[{id:'r',org:'А',site:'Север',km:1}]}),present=fixture(t,format,{records:[{id:'r',org:'А',site:'Север',km:1,date:'2026-09-01',vehicleId:0}]});
  const outcome=(dir,filter)=>{try{const result=query.queryRows(dir,{section:'records',...filter},principal);return {rows:result.rows,total:result.total};}catch(error){assert.ok(['ACCESS_DENIED','QUERY_FIELD_ACCESS'].includes(error.code));assert.doesNotMatch(error.message,/2026-09-01|PRIVATE/);return {code:error.code};}};
  for(const filter of [{from:'2026-09'},{assetRef:'v:0'}])assert.deepEqual(outcome(present.dir,filter),outcome(absent.dir,filter));
 });

 test(format+' a raw scope change, forged frozen scope and hidden-row collision leave the physical baseline intact',t=>{
  const f=fixture(t,format),principal=user(),visible=storage.readSnapshot(f.dir,{principal}),before=storage.readSnapshot(f.dir);
  denied(()=>write(f.dir,principal,visible,visible.data.vehicles.map(row=>row.id===0?{...row,org:'Б'}:row)));
  denied(()=>write(f.dir,principal,visible,[...visible.data.vehicles,card('private')]));
  assert.throws(()=>write(f.dir,principal,visible,visible.data.vehicles.map(row=>row.id===0?{...row,scopeSnapshot:{version:1,complete:true,owners:[{org:'А',site:'Север'}]}}:row)),error=>error.code==='ACCESS_SCOPE_IMMUTABLE');
  assert.deepEqual(storage.readSnapshot(f.dir),before);
 });

 test(format+' receipts and canonical replay use current field and ownership access, preserving idempotency',t=>{
  const f=fixture(t,format,{vehicles:[card(0,'А','Север',{note:'old',secret:'PRIVATE-FIELD'}),card('private','Б','Юг')]}),principal=user({accessPolicy:policy({sections:{vehicles:{readFields:['id','plate','note'],writeFields:['note']}}})});
  const snap=storage.readSnapshot(f.dir,{principal}),submitted=snap.data.vehicles.map(row=>({...row,note:'committed'})),payload={databaseToken:snap.databaseToken,base:snap.revisions,scopeViews:snap.scopeViews,sections:{vehicles:submitted},operation:{id:'boundary-idempotent'}};
  const first=storage.writeSections(f.dir,payload,{principal,now}),beforeReplay=storage.readSnapshot(f.dir),again=storage.writeSections(f.dir,payload,{principal,now:'invalid-on-replay'});
  assert.equal(first.ok,true);assert.equal(again.replayed,true);assert.doesNotMatch(JSON.stringify(again),/PRIVATE-FIELD|SYNTHETIC-private/);assert.deepEqual(storage.readSnapshot(f.dir),beforeReplay);
  const lookup={id:payload.operation.id,digest:first.operationReceipt.digest};assert.equal(storage.readOperation(f.dir,lookup,principal).operationReceipt.status,'committed');
  const revoked=user({accessPolicy:policy({grants:[]})});assert.equal(storage.readOperation(f.dir,lookup,revoked).operationReceipt,null);denied(()=>storage.writeSections(f.dir,payload,{principal:revoked,now}));
 });

 test(format+' unknown original metadata is closed even when its operational row has explicit allowed ownership',t=>{
  const f=fixture(t,format,{vehicles:[card(0,'А','Север',{note:'visible',sourceArchive:{name:'private.xlsx',size:123456,sha256:'PRIVATE-HASH'}})]}),principal=user();
  const projected=storage.readSection(f.dir,'vehicles',{principal});assert.equal(projected.rows.length,1);assert.equal(projected.rows[0].note,'visible');assert.doesNotMatch(JSON.stringify(projected),/private\.xlsx|123456|PRIVATE-HASH/);
  const result=write(f.dir,principal,storage.readSnapshot(f.dir,{principal}),projected.rows.map(row=>({...row,note:'new'})));assert.equal(result.ok,true);assert.deepEqual(storage.readSnapshot(f.dir).data.vehicles[0].sourceArchive,f.data.vehicles[0].sourceArchive);
 });
}

test('semantic preflight closes hidden contributing movements before the planner can expose balances or source names',()=>{
 const db={...Object.fromEntries(schema.sections.map(name=>[name,[]])),vehicles:[card('v','А','Север',{fuel:'diesel',fuelBalance:0})],tanks:[{id:'t',name:'Synthetic allowed tank',org:'А',site:'Север',fuel:'diesel',balanceInit:100}],tankIncomes:[{id:'private-receipt',tankId:'t',date:'2026-09-01',org:'Б',site:'Юг',amount:40,note:'PRIVATE-SOURCE-NAME'}]};
 const command={type:'IssueFuel',version:1,input:{tankId:'t',target:{section:'vehicles',id:'v'},date:'2026-09-02',qty:1,reason:'Synthetic boundary test'}};
 denied(()=>service.assertCommandScope(db,command,commands.dependencies(command),user()));
 assert.deepEqual(db.tankIncomes[0].note,'PRIVATE-SOURCE-NAME');
});

test('semantic preflight also authorizes contributing legacy rows without an ID',()=>{
 const db={...Object.fromEntries(schema.sections.map(name=>[name,[]])),vehicles:[card('v','А','Север',{fuel:'diesel'})],tanks:[{id:'t',name:'Synthetic tank',org:'А',site:'Север',fuel:'diesel',balanceInit:100}],tankIncomes:[{tankId:'t',date:'2026-09-01',org:'Б',site:'Юг',amount:40,note:'PRIVATE-IDLESS-SOURCE'}]};
 const command={type:'IssueFuel',version:1,input:{tankId:'t',target:{section:'vehicles',id:'v'},date:'2026-09-02',qty:1,reason:'Synthetic legacy source test'}};
 denied(()=>service.assertCommandScope(db,command,commands.dependencies(command),user()));
});

test('semantic action allowlists do not treat a generic update grant as approval permission',()=>{
 const row={id:'work',org:'А',site:'Север',status:'draft'},db={...Object.fromEntries(schema.sections.map(name=>[name,[]])),workOrders:[row]};
 const principal=user({accessPolicy:policy({sections:{workOrders:{actions:['read','create','update','delete']}}})});
 denied(()=>service.assertSemanticChanges(db,{workOrders:[{...row,status:'approved'}]},{type:'RepairAction',input:{action:'approve'}},principal));
});

test('legacy history projects current field ceilings and mixed-original metadata as strictly as ordinary rows',()=>{
 const vehicle=card('v','А','Север',{note:'PUBLIC-NOTE',secret:'PRIVATE-FIELD',importProvenance:{sourceId:'opaque-source',sourceScopes:['vehicles','payments'],sourceArchive:{name:'private.xlsx',size:7654,sha256:'PRIVATE-HASH'}}});
 const db={...Object.fromEntries(schema.sections.map(name=>[name,[]])),vehicles:[vehicle],auditLog:[{id:'old-event',section:'vehicles',action:'update',before:vehicle,after:{...vehicle,note:'new'}}]};
 const dispatcher={id:'dispatcher',role:'dispatcher'};
 assert.doesNotMatch(JSON.stringify(platform.visibleRows('vehicles',db.vehicles,dispatcher,db)),/private\.xlsx|7654|PRIVATE-HASH/);
 assert.doesNotMatch(JSON.stringify(platform.visibleAudit(db.auditLog,dispatcher,db)),/private\.xlsx|7654|PRIVATE-HASH/);
 const reader={id:'field-reader',role:'admin',readFields:{vehicles:['id','plate']}};
 assert.doesNotMatch(JSON.stringify(platform.visibleRows('vehicles',db.vehicles,reader,db)),/PRIVATE-FIELD/);
 assert.doesNotMatch(JSON.stringify(platform.visibleAudit(db.auditLog,reader,db)),/PRIVATE-FIELD/);
});

test('attachment opening checks its signed original owner after the containing row changes organization',t=>{
 const f=fixture(t,'json',{vehicles:[card(0)]}),attachments=require('../electron/attachment-access.cjs');
 const source=path.join(f.root,'private-source.txt');fs.writeFileSync(source,'SYNTHETIC PRIVATE ORIGINAL');
 const captured=attachments.capture(f.dir,{section:'vehicles',id:0},{principal:legacy}),file=attachments.add(f.dir,captured,source,{principal:legacy});
 const baseline=storage.readSnapshot(f.dir);write(f.dir,legacy,baseline,[{...baseline.data.vehicles[0],attachments:[file]}]);
 const withFile=storage.readSnapshot(f.dir);write(f.dir,legacy,withFile,[{...withFile.data.vehicles[0],org:'Б',site:'Юг'}]);
 const currentOwner=user({accessPolicy:policy({grants:[{org:'Б',site:'Юг'}]})});
 assert.equal(storage.readSnapshot(f.dir,{principal:currentOwner}).data.vehicles.length,1);
 assert.throws(()=>attachments.inspect(f.dir,{section:'vehicles',id:0,fileId:file.id},{principal:currentOwner}),error=>error.code==='ATTACHMENT_ACCESS'&&error.status===403&&!error.message.includes('private-source'));
 const withoutField=user({accessPolicy:policy({grants:[{org:'А',site:'Север'},{org:'Б',site:'Юг'}],sections:{vehicles:{readFields:['id','plate']}}})});
 assert.throws(()=>attachments.inspect(f.dir,{section:'vehicles',id:0,fileId:file.id},{principal:withoutField}),error=>error.code==='ATTACHMENT_ACCESS'&&error.status===403);
 assert.equal(attachments.inspect(f.dir,{section:'vehicles',id:0,fileId:file.id},{principal:legacy}).file.id,file.id);
});
