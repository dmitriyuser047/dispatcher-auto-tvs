'use strict';
// Synthetic object boundaries and exchange previews only. No storage or profiles.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const api=require('../assets/core/des-object-exchange.js'),maintenance=require('../assets/core/generator-maintenance.js');
const A={org:'Synthetic org',site:'Site A'},B={org:'Synthetic org',site:'Site B'};
const options=(extra={})=>({source:{installationId:'synthetic-installation',databaseToken:'synthetic-source'},targetDatabaseToken:'synthetic-central',scope:A,createdAt:'2026-11-01T12:00:00Z',...extra});
const ctx=extra=>({scope:A,targetDatabaseToken:'synthetic-central',...extra});
const clone=value=>structuredClone(value),resign=value=>{const result=clone(value);delete result.sha256;delete result.signature;result.sha256=api.digest(result);return result;};
function db(){return {generators:[{id:0,name:'Own DES',...A,location:A.site,hoursInit:0},{id:'0',name:'B-SECRET DES',...B,location:B.site,hoursInit:0}],genRecords:[{id:0,generatorId:0,date:'2026-10-31',...A,hours:24,meterStart:100,meterEnd:124,fuelActual:null,note:'Own journal'},{id:'0',generatorId:'0',date:'2026-10-31',...B,hours:24,meterStart:100,meterEnd:124,note:'B-SECRET journal'}],parts:[{id:0,generatorId:0,name:'Own filter',unit:'шт'},{id:'0',generatorId:'0',name:'B-SECRET filter',unit:'шт'},{id:'shared',name:'Shared catalogue without ownership'}],partMovements:[],generatorMaintenancePlans:[],auditLog:[{id:'never-export',secret:'AUDIT-SECRET'}],appMeta:[{id:'business-calendar',kind:'businessCalendar',calendar:{version:1,timeZone:'Europe/Moscow'},history:[{operationId:'synthetic-calendar',reason:'Synthetic explicit timezone',at:'2026-10-01T12:00:00.000Z',actor:{id:'synthetic-admin',name:'Synthetic admin',role:'admin'},previousTimeZone:'UTC',timeZone:'Europe/Moscow'}]},{id:'private-settings',token:'TOKEN-SECRET'}]};}
function multiPlan(database){const approval={date:'2026-10-30',document:'Synthetic committee',actor:'Synthetic approver',at:'2026-10-30T12:00:00Z'},rows=[{id:'own-service',generatorId:0,site:A.site,type:'ТО',work:'Own work',note:'',plannedDate:'2027-01-10',plannedHours:300,components:[{partId:0,qty:2,part:{id:0,generatorId:0,name:'Own filter',article:'A',unit:'шт'}}],generator:{id:0,name:'Own DES',site:A.site}},{id:'foreign-service',generatorId:'0',site:B.site,type:'ТО',work:'B-SECRET work',note:'',plannedDate:'2027-01-10',plannedHours:300,components:[{partId:'0',qty:3,part:{id:'0',generatorId:'0',name:'B-SECRET filter',article:'B',unit:'шт'}}],generator:{id:'0',name:'B-SECRET DES',site:B.site}}],snapshot={version:1,planId:'organization-plan',rootId:'organization-plan',revision:1,org:A.org,year:2027,title:'Organizational schedule',rows,approval},plan={id:'organization-plan',rootId:'organization-plan',revision:1,status:'approved',org:A.org,year:2027,title:snapshot.title,rows:rows.map(({generator,...row})=>row),approval,snapshot,fingerprint:maintenance.snapshotDigest(snapshot)};database.generatorMaintenancePlans.push(plan);return plan;}

test('projection exports only proved DES object rows and keeps numeric and string IDs independent',()=>{
 const database=db(),before=JSON.stringify(database),result=api.project(Object.freeze(database),A);
 assert.deepEqual(result.sections.generators.map(row=>row.id),[0]);assert.deepEqual(result.sections.genRecords.map(row=>row.id),[0]);assert.deepEqual(result.sections.parts.map(row=>row.id),[0]);
 assert.equal(result.sections.genRecords[0].fuelActual,null);assert.equal(Object.hasOwn(result.sections,'auditLog'),false);assert.doesNotMatch(JSON.stringify(result),/B-SECRET|AUDIT-SECRET|TOKEN-SECRET|Shared catalogue/);assert.equal(JSON.stringify(database),before);
 result.sections.generators[0].name='Caller edit';assert.equal(database.generators[0].name,'Own DES');
});

test('source credentials, attachments and local paths are omitted and cannot be injected into a packet',()=>{
 const database=db();Object.assign(database.generators[0],{secret:'NEVER',privateKey:'NEVER',filePath:'C:/private/file',attachments:[{id:'source',proof:{secret:'NEVER'}}]});
 const packet=api.snapshot(database,options());assert.doesNotMatch(JSON.stringify(packet),/NEVER|C:\/private|attachments|privateKey/);assert.ok(packet.payload.omissions.length);
 const forged=clone(packet);forged.payload.sections.generators[0].privateKey='injected';assert.throws(()=>api.validateBundle(resign(forged)),{code:'DES_PRIVATE'});
});

test('snapshot is deterministic for the same inputs, admits an unbound new target and validates its signature descriptor without granting authority',()=>{
 const database=db(),packet=api.snapshot(database,options({targetDatabaseToken:null}));assert.deepEqual(api.snapshot(database,options({targetDatabaseToken:null})),packet);assert.equal(packet.targetDatabaseToken,null);
 const signed={...packet,signature:{algorithm:'Ed25519',publicKey:'synthetic-public',keyId:'synthetic-key',value:'not-a-verified-signature'}};assert.deepEqual(api.validateBundle(signed),signed);
 const recipient=resign({...packet,payload:{...packet.payload,recipientInstallationId:'recipient',recipientKeyId:'recipient-key'}});assert.equal(api.validateBundle(recipient).payload.recipientInstallationId,'recipient');
});

test('malformed format, schema, checksum and executable JSON fail before preview',()=>{
 const packet=api.snapshot(db(),options());for(const mutate of [row=>row.version=2,row=>row.schemaVersion=7,row=>row.sha256='0'.repeat(64),row=>row.payload.sections.auditLog=[]]){const changed=clone(packet);mutate(changed);assert.throws(()=>api.validateBundle(changed));}
 let reads=0;const accessor=clone(packet);Object.defineProperty(accessor,'payload',{enumerable:true,get(){reads++;return {};}});assert.throws(()=>api.validateBundle(accessor));assert.equal(reads,0);
 const cyclic={};cyclic.self=cyclic;assert.throws(()=>api.digest(cyclic));assert.throws(()=>api.digest({value:Infinity}));assert.throws(()=>api.digest({value:undefined}));
});

test('row edits are stable origin operations, preserve foreign rows and expose no database mutation',()=>{
 const baseline=db(),current=clone(baseline);current.genRecords[0].note='Edited own note';current.genRecords[1].note='B-SECRET changed elsewhere';const packet=api.changes(baseline,current,options()),later=api.changes(baseline,current,options({createdAt:'2026-11-02T12:00:00Z'}));
 assert.equal(packet.payload.operations.length,1);assert.equal(packet.payload.operations[0].id,0);assert.equal(packet.payload.operations[0].operationId,later.payload.operations[0].operationId);
 const before=JSON.stringify(baseline),review=api.preview(baseline,packet,ctx());assert.equal(review.canApply,true,JSON.stringify(review.conflicts));assert.equal(review.sections.genRecords[0].note,'Edited own note');assert.deepEqual(review.sections.genRecords[1],baseline.genRecords[1]);assert.equal(JSON.stringify(baseline),before);assert.equal(review.changes[0].status,'apply');
 const again=api.preview({...baseline,...review.sections},packet,ctx());assert.equal(again.canApply,true);assert.deepEqual(again.sections,{});assert.equal(again.changes[0].status,'duplicate');
});

test('a persisted change epoch distinguishes a later A to B edit from an earlier acknowledged A to B cycle',()=>{
 const firstA=db(),firstB=clone(firstA);firstB.genRecords[0].note='B';
 const first=api.changes(firstA,firstB,options({changeEpoch:'epoch-1'})),retry=api.changes(firstA,firstB,options({changeEpoch:'epoch-1',createdAt:'2026-11-02T12:00:00Z'}));
 assert.equal(first.payload.changeEpoch,'epoch-1');assert.equal(first.payload.operations[0].operationId,retry.payload.operations[0].operationId);
 const ackB={...firstA,...api.preview(firstA,first,ctx()).sections},backA=clone(ackB);backA.genRecords[0].note=firstA.genRecords[0].note;
 const second=api.changes(ackB,backA,options({changeEpoch:'epoch-2'})),ackA={...ackB,...api.preview(ackB,second,ctx()).sections};
 const third=api.changes(ackA,firstB,options({changeEpoch:'epoch-3'}));assert.notEqual(first.payload.operations[0].operationId,third.payload.operations[0].operationId);assert.equal(api.preview(ackA,third,ctx()).sections.genRecords[0].note,'B');
 const tampered=clone(third);tampered.payload.changeEpoch='epoch-4';assert.throws(()=>api.validateBundle(resign(tampered)),{code:'DES_OPERATION'});
 assert.throws(()=>api.changes(firstA,firstB,options({changeEpoch:'x'.repeat(129)})));assert.throws(()=>api.changes(firstA,firstB,options({changeEpoch:'not an epoch'})));
});

test('deletion is explicit and absence of another section or snapshot row never removes it',()=>{
 const baseline=db(),current=clone(baseline);current.genRecords=current.genRecords.filter(row=>row.id!==0);const packet=api.changes(baseline,current,options());assert.equal(packet.payload.operations[0].after,null);
 const result=api.preview(baseline,packet,ctx());assert.equal(result.canApply,true);assert.deepEqual(result.sections.genRecords.map(row=>row.id),['0']);
 const empty=db();empty.genRecords=[];const snapshot=api.snapshot(empty,options()),snapshotReview=api.preview(baseline,snapshot,ctx());assert.equal(snapshotReview.canApply,true);assert.equal(Object.hasOwn(snapshotReview.sections,'genRecords'),false);
});

test('before-digest conflicts, wrong destination, wrong object and denied sections never provide writable output',()=>{
 const baseline=db(),current=clone(baseline);current.genRecords[0].note='Incoming';const packet=api.changes(baseline,current,options()),concurrent=clone(baseline);concurrent.genRecords[0].note='Concurrent';
 for(const [database,context]of [[concurrent,ctx()],[baseline,ctx({targetDatabaseToken:'other'})],[baseline,ctx({scope:B})],[baseline,ctx({writable:['generators']})]]){const result=api.preview(database,packet,context);assert.equal(result.canApply,false);assert.ok(result.conflicts.length);assert.deepEqual(result.sections,{});}
 const snapshot=api.snapshot(baseline,options());assert.equal(api.preview(concurrent,snapshot,ctx()).canApply,false);
});

test('a forged saved owner cannot make a foreign generator reference part of the object',()=>{
 const baseline=db(),current=clone(baseline);current.genRecords[0].note='Incoming';const packet=api.changes(baseline,current,options()),op=packet.payload.operations[0];op.after.generatorId='0';op.after.scopeSnapshot={version:1,complete:true,owners:[{org:A.org,site:A.site}]};op.afterDigest=api.digest(op.after);op.operationId=api.operationId(packet.source,op.section,op.id,op.before,op.after);
 assert.throws(()=>api.validateBundle(resign(packet)),{code:'DES_PRIVATE'});delete op.after.scopeSnapshot;op.afterDigest=api.digest(op.after);op.operationId=api.operationId(packet.source,op.section,op.id,op.before,op.after);const result=api.preview(baseline,resign(packet),ctx());assert.equal(result.canApply,false);assert.ok(result.conflicts.some(row=>row.code==='DES_SCOPE'));assert.deepEqual(result.sections,{});
 const moved=clone(baseline);Object.assign(moved.generators[0],B);assert.throws(()=>api.changes(baseline,moved,options()),{code:'DES_SCOPE'});
});

test('duplicate operation IDs, mismatched typed row IDs and altered operation hashes are rejected',()=>{
 const baseline=db(),current=clone(baseline);current.genRecords[0].note='Incoming';const packet=api.changes(baseline,current,options());
 for(const mutate of [row=>row.payload.operations.push(clone(row.payload.operations[0])),row=>row.payload.operations[0].after.id='0',row=>row.payload.operations[0].operationId='desop:'+'0'.repeat(64),row=>row.payload.operations[0].beforeDigest='0'.repeat(64)]){const bad=clone(packet);mutate(bad);assert.throws(()=>api.validateBundle(resign(bad)));}
});

test('known source metadata is retained on the host while unknown quantities stay null',()=>{
 const baseline=db();baseline.genRecords[0].importProvenance={sourceArchive:{id:'private-source'},sourceScopes:['genRecords']};const current=clone(baseline);current.genRecords[0].note='Changed';const result=api.preview(baseline,api.changes(baseline,current,options()),ctx());
 assert.equal(result.canApply,true);assert.deepEqual(result.sections.genRecords[0].importProvenance,baseline.genRecords[0].importProvenance);assert.equal(result.sections.genRecords[0].fuelActual,null);
});

test('a multi-object approved schedule is a clearly attributed read-only view without foreign rows or a counterfeit snapshot',()=>{
 const database=db(),original=multiPlan(database),result=api.project(database,A);assert.deepEqual(result.sections.generatorMaintenancePlans,[]);assert.equal(result.views.length,1);const view=result.views[0];assert.equal(view.readOnly,true);assert.equal(view.source.fingerprint,original.fingerprint);assert.equal(view.source.id,original.id);assert.equal(Object.hasOwn(view,'snapshot'),false);assert.equal(Object.hasOwn(view,'fingerprint'),false);assert.equal(view.rows.length,1);assert.equal(view.rows[0].generatorId,0);assert.equal(view.rows[0].components[0].qty,2);assert.doesNotMatch(JSON.stringify(view),/B-SECRET/);
 const packet=api.snapshot(database,options());assert.equal(api.validateBundle(packet).payload.views.length,1);database.generatorMaintenancePlans[0].fingerprint='broken';assert.deepEqual(api.project(database,A).views,[]);
});

test('bootstrap stays scoped and a draft preserves an explicitly unknown component quantity',()=>{
 const database=db();database.generatorMaintenancePlans.push({id:'draft-plan',rootId:'draft-plan',revision:1,status:'draft',org:A.org,year:2027,title:'Own draft',rows:[{id:'own-to',generatorId:0,site:A.site,type:'ТО',work:'Own service',note:'',plannedDate:'',plannedHours:null,components:[{partId:0,qty:null}]}],commission:{chairman:{name:'',position:''},members:[]}});
 const packet=api.snapshot(database,options({targetDatabaseToken:null})),review=api.preview({},packet,ctx({targetDatabaseToken:null}));assert.equal(review.canApply,true,JSON.stringify(review.conflicts));assert.deepEqual(review.sections.generators.map(row=>row.id),[0]);assert.equal(review.sections.generatorMaintenancePlans[0].rows[0].components[0].qty,null);assert.equal(database.generatorMaintenancePlans[0].rows[0].plannedHours,null);
});

test('a writer without access to required DES sources cannot apply an otherwise scoped journal edit',()=>{const baseline=db(),current=clone(baseline);current.genRecords[0].note='Incoming';const result=api.preview(baseline,api.changes(baseline,current,options()),ctx({readable:['genRecords'],writable:['genRecords']}));assert.equal(result.canApply,false);assert.deepEqual(result.sections,{});});

test('only operators or people with an unambiguous dated DES assignment belong in the DES personnel projection',()=>{
 const database=db();database.generators.push({id:'unique-own-des',name:'Unique own DES',...A});database.vehicles=[{id:'car',plate:'Private car',...A}];
 database.drivers=[{id:0,name:'Proved DES assignee',personnelRoles:['driver'],...A},{id:'0',name:'Operator',personnelRoles:['operator'],...A},{id:'road-driver',name:'ROAD-PRIVATE',personnelRoles:['driver'],...A,perDiem:{private:'ROAD-PER-DIEM'}},{id:'legacy',name:'LEGACY-PRIVATE',...A},{id:'ambiguous',name:'AMBIGUOUS-PRIVATE',personnelRoles:['driver'],...A}];
 database.assetAssignments=[{id:'des-binding',driverId:0,assetRef:'g:unique-own-des',from:'2026-10-01',...A},{id:'car-binding',driverId:'road-driver',assetRef:'v:car',from:'2026-10-01',...A},{id:'ambiguous-binding',driverId:'ambiguous',assetRef:'g:0',from:'2026-10-01',...A}];
 database.assetDocuments=[{id:'operator-doc',driverId:'0',title:'Operator permit',...A},{id:'road-doc',driverId:'road-driver',title:'ROAD-QUALIFICATION-PRIVATE',...A},{id:'legacy-doc',driverId:'legacy',title:'LEGACY-QUALIFICATION-PRIVATE',...A}];
 const result=api.project(database,A);assert.deepEqual(result.sections.drivers.map(row=>row.id),[0,'0']);assert.deepEqual(result.sections.assetAssignments.map(row=>row.id),['des-binding']);assert.deepEqual(result.sections.assetDocuments.map(row=>row.id),['operator-doc']);assert.doesNotMatch(JSON.stringify(result),/ROAD-PRIVATE|ROAD-PER-DIEM|LEGACY-PRIVATE|AMBIGUOUS-PRIVATE|QUALIFICATION-PRIVATE/);
 database.drivers[1].personnelPlanning={version:1,qualifications:[{id:'bad-link',code:'test',from:'2026-10-01',basis:'Synthetic',documentId:'road-doc'}]};assert.deepEqual(api.project(database,A).sections.drivers.map(row=>row.id),[0]);
 database.drivers.push({id:'foreign-operator',name:'FOREIGN-OPERATOR-PRIVATE',personnelRoles:['operator'],...B});database.assetDocuments.push({id:'foreign-doc',driverId:'foreign-operator',title:'FOREIGN-DOCUMENT-PRIVATE',...A});database.drivers[1].personnelPlanning.qualifications[0].documentId='foreign-doc';assert.deepEqual(api.project(database,A).sections.drivers.map(row=>row.id),[0]);
});

test('a local scope proof is not transported and an existing central proof survives an ordinary edit',()=>{
 const database=db(),proof={version:1,complete:true,owners:[A],capturedAt:'2026-10-31T12:00:00Z',capturedActor:{id:'central',name:'Central',role:'admin'},evidence:[],requiredReadSections:['parts']};
 database.partMovements=[{id:'movement',partId:0,kind:'receipt',date:'2026-10-31',qty:2,scopeSnapshot:proof}];const current=clone(database);current.partMovements[0].note='Edited';
 const packet=api.changes(database,current,options({changeEpoch:'proof-epoch'}));assert.equal(Object.hasOwn(packet.payload.operations[0].before,'scopeSnapshot'),false);assert.equal(Object.hasOwn(packet.payload.operations[0].after,'scopeSnapshot'),false);
 const result=api.preview(database,packet,ctx());assert.equal(result.canApply,true,JSON.stringify(result.conflicts));assert.deepEqual(result.sections.partMovements[0].scopeSnapshot,proof);assert.equal(result.sections.partMovements[0].note,'Edited');
});

test('a projected public business calendar preserves valid history for ordinary local writes',()=>{const packet=api.snapshot(db(),options()),calendar=require('../assets/core/business-calendar.js');assert.equal(packet.payload.sections.appMeta[0].history.length,1);const result=calendar.resolve(packet.payload.sections,'2026-11-01T12:00:00Z');assert.equal(result.timeZone,'Europe/Moscow');});

test('an unavailable central tank link does not remove its own DES or orphan its parts in a portable snapshot',async t=>{
 for(const [label,tankId,tanks]of [
  ['unowned','central-private-tank',[{id:'central-private-tank',name:'CENTRAL-PRIVATE-POOL'}]],
  ['foreign','central-private-tank',[{id:'central-private-tank',name:'CENTRAL-PRIVATE-POOL',...B}]],
  ['dangling','central-private-tank',[]],
  ['numeric zero',0,[{id:0,name:'CENTRAL-PRIVATE-POOL'}]],
  ['numeric/string distinction',0,[{id:'0',name:'Own different typed tank',...A}]]
 ])await t.test(label,()=>{
  const database=db();database.generators[0].tankId=tankId;database.tanks=tanks;const before=JSON.stringify(database),projected=api.project(database,A);
  assert.deepEqual(projected.sections.generators.map(row=>row.id),[0]);assert.deepEqual(projected.sections.parts.map(row=>row.id),[0]);assert.equal(Object.hasOwn(projected.sections.generators[0],'tankId'),false);
  assert.ok(projected.omissions.some(issue=>issue.code==='DES_CENTRAL_TANK_LINK'));assert.equal(JSON.stringify(database),before,'Projection must not change the central link');
  const ownIds=new Set(projected.sections.generators.map(row=>row.id));assert.ok(projected.sections.parts.every(part=>ownIds.has(part.generatorId)));
  assert.deepEqual(api.project(projected.sections,A).sections,projected.sections,'A portable projection must be closed and idempotent');
  const packet=api.snapshot(database,options({targetDatabaseToken:null}));assert.deepEqual(api.validateBundle(packet).payload.sections,projected.sections);assert.doesNotMatch(JSON.stringify(packet),/CENTRAL-PRIVATE-POOL|central-private-tank/);
 });
});

test('empty or null generator tank references remain explicit absences without a central-link omission',()=>{
 for(const tankId of ['',null]){const database=db();database.generators[0].tankId=tankId;const packet=api.snapshot(database,options());assert.equal(packet.payload.sections.generators[0].tankId,tankId);assert.equal(packet.payload.omissions.some(issue=>issue.code==='DES_CENTRAL_TANK_LINK'),false);assert.deepEqual(api.project(packet.payload.sections,A).sections,packet.payload.sections);}
});

test('portable closure removes unsupported dependency chains instead of exporting orphaned private stock',()=>{
 const database=db();database.toRecords=[{id:'blocked-to',generatorId:0,vehicleId:'unavailable-car',...A,date:'2026-10-30'}];database.parts[0].toRecordId='blocked-to';database.partMovements=[{id:'orphan-receipt',partId:0,date:'2026-10-31',kind:'receipt',qty:2}];
 const projected=api.project(database,A);assert.deepEqual(projected.sections.generators.map(row=>row.id),[0]);assert.deepEqual(projected.sections.toRecords,[]);assert.deepEqual(projected.sections.parts,[]);assert.deepEqual(projected.sections.partMovements,[]);assert.deepEqual(api.project(projected.sections,A).sections,projected.sections);
 assert.doesNotThrow(()=>api.snapshot(database,options({targetDatabaseToken:null})));
});

test('an object note edit retains the current invisible central tank association without mutating the review source',()=>{
 const central=db();central.generators[0].tankId='hidden-central-tank';central.tanks=[{id:'hidden-central-tank',name:'CENTRAL-PRIVATE-POOL'}];const baseline=api.project(central,A).sections,edited=clone(baseline);edited.generators[0].note='Object note with no access to the central tank';
 const packet=api.changes(baseline,edited,options({changeEpoch:'central-link-note'}));assert.equal(packet.payload.operations.length,1);assert.equal(Object.hasOwn(packet.payload.operations[0].before,'tankId'),false);assert.equal(Object.hasOwn(packet.payload.operations[0].after,'tankId'),false);
 const before=JSON.stringify(central),review=api.preview(central,packet,ctx());assert.equal(review.canApply,true,JSON.stringify(review.conflicts));assert.equal(review.sections.generators.find(row=>row.id===0).tankId,'hidden-central-tank');assert.equal(review.sections.generators.find(row=>row.id===0).note,edited.generators[0].note);assert.deepEqual(review.sections.generators.find(row=>row.id==='0'),central.generators[1]);assert.equal(JSON.stringify(central),before);
 const concurrent=clone(central);concurrent.generators[0].tankId='later-central-tank';concurrent.tanks.push({id:'later-central-tank',name:'LATER-PRIVATE-POOL'});const latest=api.preview(concurrent,packet,ctx());assert.equal(latest.canApply,true,JSON.stringify(latest.conflicts));assert.equal(latest.sections.generators.find(row=>row.id===0).tankId,'later-central-tank','An invisible concurrent link change must not be restored from stale object data');
});

test('a forged object edit cannot clear or replace a hidden central tank link',()=>{
 const central=db();central.generators[0].tankId='hidden-central-tank';central.tanks=[{id:'hidden-central-tank',name:'CENTRAL-PRIVATE-POOL'},{id:'own-tank',name:'Own allowed tank',...A}];const baseline=api.project(central,A).sections,edited=clone(baseline);edited.generators[0].note='Reviewed own note';const packet=api.changes(baseline,edited,options({changeEpoch:'central-link-protected'})),before=JSON.stringify(central);
 for(const tankId of [null,'','own-tank','hidden-central-tank']){const bad=clone(packet),operation=bad.payload.operations.find(op=>op.section==='generators'&&op.id===0);operation.after.tankId=tankId;operation.afterDigest=api.digest(operation.after);operation.operationId=api.operationId(bad.source,operation.section,operation.id,operation.before,operation.after,bad.payload.changeEpoch);const result=api.preview(central,resign(bad),ctx());assert.equal(result.canApply,false);assert.ok(result.conflicts.some(issue=>issue.code==='DES_CENTRAL_TANK_LINK'),JSON.stringify(result.conflicts));assert.deepEqual(result.sections,{});assert.equal(JSON.stringify(central),before);}
});

test('known object-owned tank links remain portable and an explicit own-tank change or unlink is allowed',()=>{
 const central=db();central.tanks=[{id:'own-tank-a',name:'Own tank A',...A},{id:'own-tank-b',name:'Own tank B',...A}];central.generators[0].tankId='own-tank-a';const baseline=api.project(central,A).sections;assert.equal(baseline.generators[0].tankId,'own-tank-a');assert.deepEqual(baseline.tanks.map(row=>row.id),['own-tank-a','own-tank-b']);
 for(const tankId of ['own-tank-b',null]){const edited=clone(baseline);edited.generators[0].tankId=tankId;const result=api.preview(central,api.changes(baseline,edited,options()),ctx());assert.equal(result.canApply,true,JSON.stringify(result.conflicts));assert.equal(result.sections.generators.find(row=>row.id===0).tankId,tankId);}
});

test('a direct snapshot containing a foreign or unproved tank reference still fails scope validation',()=>{
 const packet=api.snapshot(db(),options({targetDatabaseToken:null}));
 for(const tank of [null,{id:'injected-tank',name:'CENTRAL-PRIVATE-POOL'},{id:'injected-tank',name:'FOREIGN-PRIVATE-POOL',...B}]){const bad=clone(packet);bad.payload.sections.generators[0].tankId='injected-tank';if(tank)bad.payload.sections.tanks.push(tank);assert.throws(()=>api.validateBundle(resign(bad)),{code:'DES_SCOPE'});}
});

test('browser UMD and CommonJS create the same isolated object snapshot',()=>{
 const context=vm.createContext({});for(const file of ['platform-contracts','platform-schema','personnel-kinds','entity-identity','request-fingerprint','access-policy','access-scope','generator-maintenance','des-object-exchange'])vm.runInContext(fs.readFileSync(require.resolve('../assets/core/'+file+'.js'),'utf8'),context,{filename:file+'.js'});
 assert.deepEqual(JSON.parse(JSON.stringify(context.DesObjectExchange.snapshot(db(),options()))),api.snapshot(db(),options()));
});
