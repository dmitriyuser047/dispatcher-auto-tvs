'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const schema=require('../assets/core/platform-schema.js'),identity=require('../assets/core/entity-identity.js'),graph=require('../assets/core/reference-graph.js'),merge=require('../assets/core/catalog-merge.js'),contracts=require('../assets/core/platform-contracts.js'),writeoff=require('../assets/core/writeoff-engine.js');
const copy=value=>JSON.parse(JSON.stringify(value)),today='2026-10-22',context={today,id:'synthetic-merge',now:today+'T12:00:00.000Z',actor:{id:'synthetic-admin',name:'Synthetic administrator',role:'admin'}};
const blank=()=>Object.fromEntries(schema.sections.map(name=>[name,[]]));
function fixture(){const db=blank();db.contragents=[{id:0,name:'Source organization'},{id:'0',name:'Target organization'}];db.payments=[{id:'paid',contragentId:0,date:'2026-09-01',sum:10,paid:true,paidAmount:10}];return db;}
const request=patch=>({section:'contragents',sourceId:0,targetId:'0',reason:'Synthetic confirmed duplicate',mutableRefs:[],...patch});
function plan(db,input=request()){return merge.plan(db,{...input,reviewFingerprint:merge.preview(db,input,context).fingerprint},context);}

test('entity identity exactly matches primitive contract IDs without stringifying user objects or conflating numeric and string zero',()=>{
 let hooks=0;const coercion={toString(){hooks++;return '7';},valueOf(){hooks++;return 7;}};
 for(const value of [0,-0,7,7.25,Number.MAX_SAFE_INTEGER+1,'0','7',' a\n', 'x'.repeat(1000),null,undefined,'',' ',NaN,Infinity,coercion])assert.equal(identity.identifier(value),contracts.identifier(value));
 assert.equal(identity.presentId(0),true);assert.equal(identity.presentId(''),false);assert.notEqual(identity.typedKey('vehicles',0),identity.typedKey('vehicles','0'));assert.notEqual(identity.typedKey('vehicles',7),identity.typedKey('drivers',7));
 assert.throws(()=>identity.typedKey('vehicles',coercion),{code:'INVALID_IDENTITY'});assert.equal(hooks,0);
});

test('legacy asset references resolve exactly one match across all rows, including archived collisions, without inventing a new format',()=>{
 const db={vehicles:[{id:0,name:'Numeric zero'},{id:'0',name:'Text zero',archived:true},{id:7.25},{id:'line\nbreak'}],generators:[],tanks:[]};
 assert.equal(identity.resolveAsset(db,'v:0').status,'ambiguous');assert.throws(()=>identity.assetRef(db,'vehicles',0),{code:'AMBIGUOUS_ASSET'});
 assert.equal(identity.assetRef(db,'vehicles',7.25),'v:7.25');assert.equal(identity.resolveAsset(db,'v:7.25').id,7.25);assert.equal(identity.resolveAsset(db,'v:line\nbreak').id,'line\nbreak');
 assert.equal(identity.resolveAsset(db,'v:missing').status,'missing');assert.equal(identity.resolveAsset(db,'x:0').status,'invalid');assert.equal(identity.resolveAsset(db,'v:0',{g:'generators'}).status,'invalid');assert.throws(()=>identity.assetRef(db,'vehicles','7.25'),{code:'ASSET_NOT_FOUND'});
 let calls=0;const hooked={get vehicles(){calls++;return [];}},row={get id(){calls++;return 7;}};assert.equal(identity.resolveAsset(hooked,'v:7').status,'invalid');assert.equal(identity.resolveAsset({vehicles:[row]},'v:7').status,'invalid');assert.equal(calls,0);
 assert.equal(Object.isFrozen(identity.resolveAsset(db,'v:7.25')),true);assert.equal(Object.isFrozen(db.vehicles[2]),false);
});

test('the graph inventories every registry relation and preserves typed live, advisory and historical references without rewriting input',()=>{
 const db=fixture();db.vehicles=[{id:7,org:'Organization text stays a fact',fuelcard:'111111'}];db.fuelCards=[{id:'card',number:'111111'}];db.records=[{id:0,vehicleId:7,fuelCardNum:'111111'}];db.auditLog=[{id:'audit',section:'vehicles',recordId:'7',before:{id:7,plate:'Old identity'}}];db.fuelWriteoffs=[{id:'historical',snapshot:{vehicles:[{id:7,plate:'Frozen identity'}]}}];const original=JSON.stringify(db),report=graph.inspect(db,context);
 assert.equal(report.relationCount,schema.relations.length);assert.ok(report.relationCount>=74);assert.equal(report.references.find(ref=>ref.relationId==='records.vehicleId').target.id,7);assert.equal(report.references.find(ref=>ref.relationId==='records.vehicleId').rowId,0);assert.equal(report.references.find(ref=>ref.relationId==='vehicles.fuelcard').classification,'advisory');
 assert.ok(report.references.some(ref=>ref.section==='fuelWriteoffs'&&ref.path==='snapshot.vehicles[0].id'&&ref.classification==='historical'&&ref.target.id===7));assert.ok(report.references.some(ref=>ref.section==='auditLog'&&ref.path==='before.id'&&ref.classification==='historical'));assert.equal(JSON.stringify(db),original);assert.equal(Object.isFrozen(report.references[0]),true);
});

test('graph classification never treats started, accepted, financial or stock facts as mutable drafts',()=>{
 const db=fixture();db.vehicles=[{id:'source'},{id:'target'}];db.dispatchJobs=[{id:'future',assetRef:'v:source',status:'assigned',start:'2026-10-23T08:00:00Z'},{id:'started',assetRef:'v:source',status:'started',start:'2026-10-23T08:00:00Z'}];db.shiftReports=[{id:'draft',assetRef:'v:source',date:today,status:'prepared'},{id:'accepted',assetRef:'v:source',date:today,status:'accepted'}];db.assetAssignments=[{id:'current',assetRef:'v:source',from:today},{id:'future-assignment',assetRef:'v:source',from:'2026-11-01'}];
 const report=graph.inspect(db,context),ref=id=>report.references.find(item=>item.rowId===id&&item.field==='assetRef');assert.equal(ref('future').mutable,true);assert.equal(ref('started').mutable,false);assert.equal(ref('draft').mutable,true);assert.equal(ref('accepted').mutable,false);assert.equal(ref('current').mutable,false);assert.equal(ref('future-assignment').mutable,true);assert.equal(report.references.find(item=>item.section==='payments').mutable,false);
});

test('unknown live references and ambiguous legacy asset strings are blockers rather than silently omitted targets',()=>{
 const db=fixture();db.contragents[0].alternateContragentId='0';let preview=merge.preview(db,request(),context);assert.equal(preview.canMerge,false);assert.ok(preview.blockers.some(issue=>issue.code==='UNCLASSIFIED_REFERENCE'));
 const assets=blank();assets.vehicles=[{id:7},{id:'7'}];assets.opsTasks=[{id:'task',assetRef:'v:7',status:'open'}];preview=merge.preview(assets,request({section:'vehicles',sourceId:7,targetId:'7'}),context);assert.equal(preview.canMerge,false);assert.ok(preview.blockers.some(issue=>issue.code==='AMBIGUOUS_ASSET'));assert.ok(preview.references.some(ref=>ref.candidates.length===2));
 const unknown=blank();unknown.drivers=[{id:7,name:'Source'},{id:8,name:'Target'}];unknown.opsTasks=[{id:'task',alternateDriverId:'7'}];assert.ok(merge.preview(unknown,request({section:'drivers',sourceId:7,targetId:8}),context).blockers.some(issue=>issue.code==='UNCLASSIFIED_REFERENCE'));
});

test('merge archives an empty duplicate as a trusted typed alias while keeping financial history and all original IDs byte for byte',()=>{
 const db=fixture(),original=JSON.stringify(db),output=plan(db);assert.deepEqual(output.writeSections,['contragents']);assert.deepEqual(output.readSections,schema.sections);assert.deepEqual(output.sections.contragents[0].mergedInto,{version:1,section:'contragents',id:'0',reason:request().reason,at:context.now,actor:context.actor,operationId:context.id});assert.equal(output.sections.contragents[0].id,0);assert.equal(output.sections.contragents[0].archived,true);assert.equal(output.sections.contragents[1].name,'Target organization');assert.equal(output.sections.payments,undefined);assert.equal(JSON.stringify(db),original);
 const input=request(),review=merge.preview(db,input,context),withExtra=merge.plan(db,{...input,reviewFingerprint:review.fingerprint},{...context,actor:{...context.actor,secret:'NOT METADATA'}});assert.deepEqual(Object.keys(withExtra.sections.contragents[0].mergedInto.actor).sort(),['id','name','role']);
});

test('only explicitly selected mutable references change; unselected and accepted facts remain attached to their source identity',()=>{
 const db=blank();db.vehicles=[{id:0,name:'Empty duplicate'},{id:1,name:'Actual vehicle'}];db.opsTasks=[{id:'selected',assetRef:'v:0',status:'open',title:'Selected task'},{id:'retained',assetRef:'v:0',status:'open',title:'Retained task'}];db.shiftReports=[{id:'accepted',assetRef:'v:0',status:'accepted',date:'2026-09-01',odoEnd:150}];const input=request({section:'vehicles',sourceId:0,targetId:1,mutableRefs:[{relationId:'opsTasks.assetRef',rowId:'selected',path:'assetRef'}]}),output=plan(db,input);
 assert.equal(output.sections.opsTasks[0].assetRef,'v:1');assert.equal(output.sections.opsTasks[1].assetRef,'v:0');assert.equal(output.sections.shiftReports,undefined);assert.equal(db.shiftReports[0].odoEnd,150);assert.deepEqual(output.writeSections,['opsTasks','vehicles']);
 const forbidden={...input,mutableRefs:[{relationId:'shiftReports.assetRef',rowId:'accepted',path:'assetRef'}]};assert.ok(merge.preview(db,forbidden,context).blockers.some(issue=>issue.code==='INVALID_MERGE_SELECTION'));
});

test('nested typed part requirements preserve quantities and indexes while selected draft links move',()=>{
 const db=blank();db.parts=[{id:0,name:'Duplicate part'},{id:'0',name:'Actual part'}];db.dispatchJobs=[{id:0,status:'new',start:'2026-10-23T08:00:00Z',partRequirements:[{partId:0,qty:3.013},{partId:'0',qty:0}]}];const input=request({section:'parts',sourceId:0,targetId:'0',mutableRefs:[{relationId:'dispatchJobs.partRequirements[].partId',rowId:0,path:'partRequirements[0].partId'}]}),output=plan(db,input);
 assert.deepEqual(output.sections.dispatchJobs[0].partRequirements,[{partId:'0',qty:3.013},{partId:'0',qty:0}]);assert.equal(db.dispatchJobs[0].partRequirements[0].partId,0);
});

test('a reviewed fingerprint binds every section including audit, reason and selection, but excludes its own fingerprint property',()=>{
 const db=fixture(),input=request(),preview=merge.preview(db,input,context);assert.equal(merge.preview(db,{...input,reviewFingerprint:preview.fingerprint},context).fingerprint,preview.fingerprint);
 for(const mutate of [next=>next.auditLog.push({id:'new-history'}),next=>next.contragents[1].name='Changed target',next=>next.payments[0].sum=11]){const next=copy(db);mutate(next);assert.throws(()=>merge.plan(next,{...input,reviewFingerprint:preview.fingerprint},context),{code:'STALE_REVIEW'});}
 assert.throws(()=>merge.plan(db,{...input,reason:'Different reason',reviewFingerprint:preview.fingerprint},context),{code:'STALE_REVIEW'});assert.throws(()=>merge.plan(db,input,context),{code:'REVIEW_REQUIRED'});
});

test('review fingerprints are portable across object property orders and non-business renderer fields without depending on locale collation',()=>{
 const db=fixture();db.auditLog=[{id:'historical',section:'contragents',before:{contragentId:0,id:0},after:{id:0,contragentId:0}}];
 const reverse=value=>Array.isArray(value)?value.map(reverse):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([key,child])=>[key,reverse(child)])):value;
 const original=merge.preview(db,request(),context),reordered=merge.preview(reverse(db),request(),context);assert.equal(original.fingerprint,reordered.fingerprint);assert.deepEqual(original.references,reordered.references);
 assert.equal(merge.preview({...db,rendererOnly:{schemaVersion:17},obsoleteTransientFlag:true},request(),context).fingerprint,original.fingerprint);
 const missing=copy(db);delete missing.connectors;assert.equal(merge.preview(missing,request(),context).fingerprint,original.fingerprint);
 const approved=merge.plan(reverse(db),{...request(),reviewFingerprint:original.fingerprint},context);assert.equal(approved.sections.contragents[0].mergedInto.id,'0');
 const refs=blank();refs.parts=[{id:0,unit:'шт'},{id:1,unit:'шт'}];refs.dispatchJobs=[{id:'я',status:'new',start:'2026-11-01T08:00',partRequirements:[{partId:0,qty:1}]},{id:'a',status:'new',start:'2026-11-01T08:00',partRequirements:[{partId:0,qty:1}]}];const mutableRefs=refs.dispatchJobs.map(row=>({relationId:'dispatchJobs.partRequirements[].partId',rowId:row.id,path:'partRequirements[0].partId'}));assert.equal(merge.preview(refs,request({section:'parts',targetId:1,mutableRefs}),context).fingerprint,merge.preview(refs,request({section:'parts',targetId:1,mutableRefs:[...mutableRefs].reverse()}),context).fingerprint);
});

test('physical opening and any unreconciled stock history block aliasing without adding, deleting or guessing balances',()=>{
 for(const section of ['vehicles','generators','tanks','parts']){
  const db=blank();db[section]=[{id:0,name:'Source'},{id:1,name:'Target'}];const input=request({section,sourceId:0,targetId:1});assert.equal(merge.preview(db,input,context).canMerge,true);
  const field=section==='tanks'?'balanceInit':'fuelBalance';db[section][0][field]=923.537;assert.ok(merge.preview(db,input,context).blockers.some(issue=>issue.code==='PHYSICAL_CARRY'));delete db[section][0][field];
  const [journal,key]=({vehicles:['records','vehicleId'],generators:['genRecords','generatorId'],tanks:['tankIncomes','tankId'],parts:['partMovements','partId']})[section];db[journal]=[{id:'actual-zero',date:'2026-09-01',[key]:0,qty:0,fuelActual:0}];assert.ok(merge.preview(db,input,context).blockers.some(issue=>issue.code==='PHYSICAL_HISTORY_REQUIRES_REVIEW'));
 }
});

test('an implicit historical DES tank link cannot be retargeted by merging tanks, while an explicit null receipt stays detached',()=>{
 const db=blank();db.tanks=[{id:0,name:'Source tank'},{id:1,name:'Target tank'}];db.generators=[{id:'g',tankId:0}];db.genRecords=[{id:'legacy-receipt',generatorId:'g',date:'2026-09-01',fuelIssued:100}];
 const input=request({section:'tanks',sourceId:0,targetId:1,mutableRefs:[{relationId:'generators.tankId',rowId:'g',path:'tankId'}]}),before=JSON.stringify(db),review=merge.preview(db,input,context);
 assert.equal(review.canMerge,false);assert.ok(review.blockers.some(issue=>issue.code==='PHYSICAL_HISTORY_REQUIRES_REVIEW'));assert.equal(review.references.find(ref=>ref.relationId==='generators.tankId').mutable,false);assert.equal(JSON.stringify(db),before);
  assert.equal(graph.classify('generators',db.generators[0],'tankId',today,db).classification,'pinned');
 db.genRecords[0].tankId=null;assert.equal(merge.preview(db,input,context).canMerge,true);assert.equal(plan(db,input).sections.generators[0].tankId,1);assert.equal(db.genRecords[0].tankId,null);
});

test('incompatible dimensions, physical fuels and known identifying metadata require correction rather than a hidden conversion',()=>{
 const parts=blank();parts.parts=[{id:0,name:'Source',unit:'шт'},{id:1,name:'Target',unit:'л'}];assert.ok(merge.preview(parts,request({section:'parts',targetId:1}),context).blockers.some(issue=>issue.code==='INCOMPATIBLE_UNIT'));
 for(const section of ['vehicles','generators','tanks']){const db=blank();db[section]=[{id:0,fuel:'diesel',fuelGrade:'ДТ'},{id:1,fuel:'gasoline',fuelGrade:'АИ-95'}];assert.ok(merge.preview(db,request({section,targetId:1}),context).blockers.some(issue=>issue.code==='INCOMPATIBLE_FUEL'));db[section][1].fuel='diesel';assert.ok(merge.preview(db,request({section,targetId:1}),context).blockers.some(issue=>issue.code==='INCONSISTENT_FUEL_METADATA'));}
 const party=fixture();party.contragents[0].inn='1111111111';party.contragents[1].inn='2222222222';assert.ok(merge.preview(party,request(),context).blockers.some(issue=>issue.code==='INCOMPATIBLE_CATALOG_METADATA'));
});

test('source and target aliases cannot form cycles, chains or silently change an existing alias root',()=>{
 const db=fixture();db.contragents.push({id:'old',archived:true,mergedInto:{version:1,section:'contragents',id:0,reason:'Old duplicate',at:context.now,actor:context.actor,operationId:'old'}});const preview=merge.preview(db,request(),context);assert.ok(preview.references.some(ref=>ref.relationId.startsWith('alias:')));assert.ok(preview.blockers.some(issue=>issue.code==='SOURCE_HAS_ALIASES'));db.contragents.pop();db.contragents[1].mergedInto={id:0};assert.ok(merge.preview(db,request(),context).blockers.some(issue=>issue.code==='TARGET_NOT_ACTIVE'));
});

test('a card present in a posted source cannot bypass any saved fingerprint merely by being marked an alias',()=>{
 for(const version of [1,2,3]){
  const db=blank();db.vehicles=[{id:'v',org:'A',fuel:'diesel',fuelGrade:'ДТ',fuelBalance:100,fuelcard:'111111'}];db.records=[{id:'r',vehicleId:'v',date:'2026-09-10',km:1,fuelActual:2,fuelCardNum:'111111'}];db.fuelCards=[{id:0,number:'111111',org:'A',assignments:[]},{id:1,number:'222222',org:'A',assignments:[]}];const api=writeoff.forVersion(version),scope={month:'2026-09',date:'2026-09-30'},prepared=api.prepare(db,scope);assert.equal(prepared.canPost,true);db.fuelWriteoffs=[api.post(db,scope,{id:'posted',number:'Synthetic',postedAt:'2026-10-01T12:00:00.000Z',postedBy:context.actor,expectedFingerprint:prepared.sourceFingerprint})];const original=JSON.stringify(db.fuelWriteoffs),preview=merge.preview(db,request({section:'fuelCards',sourceId:0,targetId:1}),context);assert.equal(preview.canMerge,false);assert.ok(preview.blockers.some(issue=>issue.code==='POSTED_SOURCE_LOCKED'));assert.equal(JSON.stringify(db.fuelWriteoffs),original);
 }
});

test('unreadable sections fail before reading hidden rows, and getters, malformed JSON and executable coercion are never interpreted',()=>{
 let calls=0;const hidden={get payments(){calls++;return [{secret:'Do not expose'}];}};assert.throws(()=>graph.inspect(hidden,{today,readable:['contragents']}),error=>error.code==='ACCESS_DENIED'&&!error.message.includes('secret'));assert.equal(calls,0);
 const db=fixture();Object.defineProperty(db.contragents[0],'name',{enumerable:true,get(){calls++;return 'secret';}});assert.throws(()=>graph.inspect(db,context),{code:'INVALID_GRAPH'});assert.equal(calls,0);assert.throws(()=>graph.inspect(fixture(),{}),{code:'INVALID_CONTEXT'});
 const hacked=request();Object.defineProperty(hacked,'sourceId',{get(){calls++;return 0;},enumerable:true});assert.throws(()=>merge.preview(fixture(),hacked,context));assert.equal(calls,0);
});

test('actual browser UMDs produce the same complete graph, preview fingerprint and pure plan without DOM, network or storage',()=>{
 const sandbox=vm.createContext({});for(const name of ['platform-schema','entity-identity','platform-contracts','business-calendar','decimal-core','effective-periods','temporal-policy','accounting-boundary','fuel-engine','writeoff-engine','reference-graph','platform-kernel','catalog-merge']){
  // Kernel is used only for its pure digest API here; its planning dependencies
  // are deliberately absent and must never be called by a catalog planner.
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/core',name+'.js'),'utf8'),sandbox,{filename:name});
 }
 const db=fixture(),input=request(),preview=merge.preview(db,input,context);assert.equal(JSON.stringify(sandbox.ReferenceGraph.inspect(db,context)),JSON.stringify(graph.inspect(db,context)));assert.equal(sandbox.MergeCatalog.preview(db,input,context).fingerprint,preview.fingerprint);assert.equal(JSON.stringify(sandbox.MergeCatalog.plan(db,{...input,reviewFingerprint:preview.fingerprint},context)),JSON.stringify(plan(db)));assert.equal(typeof sandbox.document,'undefined');assert.equal(typeof sandbox.fetch,'undefined');
});
