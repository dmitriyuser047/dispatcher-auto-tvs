'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const domain=require('../electron/des-object-domain.cjs'),schema=require('../assets/core/platform-schema.js'),commands=require('../assets/core/platform-commands.js'),calendar=require('../assets/core/business-calendar.js');
const central={id:'central-mechanic',name:'Central mechanic',role:'admin'},local={id:'object-operator',name:'Object operator',role:'admin'},now='2026-11-01T12:00:00.000Z',scope={org:'SYNTHETIC ORG',site:'SITE A'};
const clone=value=>JSON.parse(JSON.stringify(value));
function fixture(extra={}){return{...Object.fromEntries(schema.sections.map(name=>[name,[]])),appMeta:[{id:'business-calendar',kind:'businessCalendar',calendar:{version:1,timeZone:'Europe/Moscow'},history:[{operationId:'synthetic-calendar',reason:'Synthetic explicit calendar',at:now,actor:central,previousTimeZone:'UTC',timeZone:'Europe/Moscow'}]}],generators:[{id:'g',name:'Generator A',org:scope.org,site:scope.site},{id:'other',name:'Generator B',org:scope.org,site:'SITE B'}],parts:[{id:0,generatorId:'g',name:'Numeric filter',unit:'шт'},{id:'0',generatorId:'g',name:'String filter',unit:'шт'},{id:'foreign',generatorId:'other',name:'Foreign filter',unit:'шт'}],...extra};}
function operation(id=0,extra={}){return{operationId:'desop:synthetic-'+typeof id+'-'+id,section:'partMovements',id,before:null,beforeDigest:null,after:{id,date:'2026-10-31',partId:0,kind:'receipt',qty:3,reason:'Фактический приход',createdAt:'2026-10-31T09:00:00.000Z',createdBy:local,updatedAt:'2026-10-31T09:00:00.000Z',lifecycle:{version:1,postedAt:'2026-10-31T09:00:00.000Z',postedActor:local,operationId:'local-post'},...extra}};}
function tankFixture(extra={}){const database=fixture({tanks:[{id:0,name:'OWN TANK',org:scope.org,site:scope.site,object:scope.site,owner:'LITERAL LEGAL OWNER',fuel:'diesel',balanceInit:10,capacity:30000},{id:'0',name:'FOREIGN TANK',org:scope.org,site:'SITE B',fuel:'diesel',balanceInit:20}],...extra});database.generators=database.generators.map(generator=>({hoursInit:0,fuelBalance:0,...generator}));return database;}
function tankOperation(id=0,extra={}){return{operationId:'desop:synthetic-tank-'+typeof id+'-'+id,section:'tankIncomes',id,before:null,beforeDigest:null,after:{id,date:'2026-10-31',tankId:0,amount:100,source:'Synthetic factual delivery',note:'Actual new receipt',org:scope.org,grade:'ДТ',createdAt:'2026-10-31T09:00:00.000Z',createdBy:local,updatedAt:'2026-10-31T09:00:00.000Z',lifecycle:{version:1,postedAt:'2026-10-31T09:00:00.000Z',postedActor:local,operationId:'local-tank-post'},...extra}};}
const options=extra=>({principal:central,scope,now,...extra});
const hasCode=(result,code)=>result.issues.some(issue=>issue.code===code||issue.details?.some(detail=>detail.code===code));

test('new posted receipt derives only standard saveDraft/postDraft and receiver proof, preserving source typed identity in mapping',()=>{
 const db=fixture(),op=operation(),before=JSON.stringify({db,op}),result=domain.derive(db,op,options());
 assert.equal(result.supported,true);assert.equal(result.canApply,true,JSON.stringify(result.issues));assert.equal(JSON.stringify({db,op}),before);
 assert.deepEqual(result.steps.map(step=>[step.command.type,step.command.input.action]),[['DocumentAction','saveDraft'],['DocumentAction','postDraft']]);
 assert.equal(result.recordMapping.sourceId,0);assert.equal(result.recordMapping.targetId,result.steps[1].operationId);
 assert.equal(result.sections.partMovements.length,1);const posted=result.sections.partMovements[0];
 assert.equal(posted.qty,3);assert.equal(posted.partId,0);assert.equal(posted.lifecycle.operationId,result.steps[1].operationId);assert.equal(posted.lifecycle.postedAt,now);assert.deepEqual(posted.lifecycle.postedActor,central);assert.deepEqual(posted.createdBy,central);assert.equal(posted.createdAt,now);assert.equal(posted.scopeSnapshot,undefined);
 assert.equal(JSON.stringify(result.steps).includes('local-post'),false);assert.equal(JSON.stringify(result.steps).includes('object-operator'),false);
});

test('exact derived steps replay through ordinary planner with the fixed receiving clock',()=>{
 const db=fixture(),result=domain.derive(db,operation('r'),options());assert.equal(result.canApply,true,JSON.stringify(result.issues));let scratch=db;
 for(const step of result.steps){const planned=commands.plan(scratch,step.command,{id:step.operationId,now:result.now,today:result.today,calendar:calendar.resolve(scratch,result.now),actor:central,readable:schema.sections,writable:schema.sections});scratch={...scratch,...planned.sections};}
 assert.deepEqual(scratch.partMovements,result.sections.partMovements);assert.deepEqual(scratch.documentDrafts,result.sections.documentDrafts);
 const replay=domain.derive(scratch,operation('r'),options());assert.equal(replay.canApply,false);assert.ok(hasCode(replay,'DES_DOMAIN_RECOVERY'));assert.equal(scratch.partMovements.length,1);
});

test('origin IDs are deterministic across export retries and do not merge numeric/string IDs or changed facts',()=>{
 const db=fixture(),a=domain.derive(db,operation(0),options()),again=domain.derive(db,operation(0),options()),b=domain.derive(db,operation('0'),options()),changed=domain.derive(db,operation(0,{qty:4}),options());
 for(const value of [a,again,b,changed])assert.equal(value.canApply,true,JSON.stringify(value.issues));
 assert.deepEqual(a.steps,again.steps);assert.notEqual(a.recordMapping.targetId,b.recordMapping.targetId);assert.notEqual(a.recordMapping.targetId,changed.recordMapping.targetId);assert.equal(b.recordMapping.sourceId,'0');
});

test('issue uses actual central stock and matching approved central order; unsupported local approval is not invented',()=>{
 const db=fixture({partMovements:[{id:'opening',date:'2026-10-01',partId:0,kind:'receipt',qty:5}],workOrders:[{id:'approved-central',status:'approved',title:'Repair A',assetRef:'g:g'}]}),op=operation('issue',{kind:'issue',assetRef:'g:g',workOrderId:'approved-central',qty:2,reason:'Выдача на фактический ремонт'}),result=domain.derive(db,op,options());
 assert.equal(result.canApply,true,JSON.stringify(result.issues));assert.equal(result.sections.partMovements.length,2);assert.equal(result.sections.partMovements[1].workOrderId,'approved-central');
 for(const status of ['draft','accepted']){const blocked=domain.derive({...db,workOrders:[{...db.workOrders[0],status}]},op,options());assert.equal(blocked.canApply,false,status);assert.ok(blocked.issues.some(issue=>/согласованным заказом/.test(issue.message)),JSON.stringify(blocked.issues));}
});

test('stock shortage and closed receiving stock period block the entire recipe before any draft is committed',()=>{
 const insufficient=domain.derive(fixture(),operation('issue',{kind:'issue',assetRef:'g:g',qty:1}),options());assert.equal(insufficient.canApply,false);assert.equal(insufficient.steps.length,0);
 const closed=domain.derive(fixture({fuelPeriods:[{month:'2026-10',stockClosed:true}]}),operation(),options());assert.equal(closed.canApply,false);assert.equal(closed.steps.length,0);assert.ok(closed.issues.length);assert.deepEqual(closed.sections,{});
});

test('current receiver role, readable/writable restrictions and explicit scope are required',()=>{
 const db=fixture();
 for(const principal of [{...central,role:'viewer'},{...central,writable:['partMovements']},{...central,readable:['parts','partMovements','generators']}]){const blocked=domain.derive(db,operation(),options({principal}));assert.equal(blocked.canApply,false);assert.ok(hasCode(blocked,'ACCESS_DENIED'),JSON.stringify(blocked.issues));}
 assert.ok(hasCode(domain.derive(db,operation(),options({principal:null})),'ACCESS_DENIED'));
 assert.ok(hasCode(domain.derive(db,operation(),options({scope:null})),'DES_DOMAIN_SCOPE'));
 const foreign=domain.derive(db,operation('x',{partId:'foreign'}),options());assert.equal(foreign.canApply,false);assert.ok(hasCode(foreign,'DES_DOMAIN_SCOPE'));
});

test('typed part references and generator owner are preserved; ambiguous or mismatched asset strings never guess',()=>{
 const db=fixture({partMovements:[{id:'opening-string',date:'2026-10-01',partId:'0',kind:'receipt',qty:2}]}),string=domain.derive(db,operation('i',{partId:'0',kind:'issue',assetRef:'g:g',qty:1}),options());assert.equal(string.canApply,true,JSON.stringify(string.issues));assert.equal(string.sections.partMovements[1].partId,'0');
 const numeric=domain.derive(db,operation('i',{partId:0,kind:'issue',assetRef:'g:g',qty:1}),options());assert.equal(numeric.canApply,false);
 for(const assetRef of ['g:other','v:g',''])assert.ok(hasCode(domain.derive(db,operation('bad',{kind:'issue',assetRef,qty:1}),options()),'SPARES_TARGET'));
});

test('corrections, reversals, deletion, procurement authority and unsupported meaningful fields fail closed',()=>{
 const db=fixture();
 for(const op of [{...operation(),before:operation().after},{...operation(),after:null},operation(0,{lifecycle:{version:1,postedAt:now,postedActor:local,operationId:'local',correctionOf:{section:'partMovements',id:'old'}}}),operation(0,{lifecycle:{version:1,postedAt:now,postedActor:local,operationId:'local',void:{}}}),operation(0,{originalMovementId:'old'}),operation(0,{reversedBy:'reverse'}),operation(0,{procurementReceipt:{version:1}}),operation(0,{sourceSnapshot:{claimedAuthority:true}}),operation(0,{kind:'return'}),operation(0,{kind:'writeoff'})]){
  const result=domain.derive(db,op,options());assert.equal(result.canApply,false,JSON.stringify(op));assert.equal(result.steps.length,0);assert.equal(result.recordMapping,null);
 }
 assert.equal(domain.requiresDomainAction(operation()),true);assert.equal(domain.requiresDomainAction({section:'repairs'}),false);
});

test('no getters execute; source ID, origin ID, numeric precision and receiver clock validation cannot be skipped',()=>{
 const db=fixture();let invoked=0;const op=operation();Object.defineProperty(op.after,'qty',{get(){invoked++;return 9;},enumerable:true});assert.equal(domain.derive(db,op,options()).canApply,false);assert.equal(invoked,0);
 const mismatch=operation();mismatch.after.id='0';assert.ok(hasCode(domain.derive(db,mismatch,options()),'DES_DOMAIN_ID'));
 assert.ok(hasCode(domain.derive(db,operation(),options({originId:'other'})),'DES_DOMAIN_ORIGIN'));
 for(const qty of [null,0,-1,0.0001])assert.equal(domain.derive(db,operation(0,{qty}),options()).canApply,false,String(qty));
 assert.ok(hasCode(domain.derive(db,operation(),options({now:'not a clock'})),'DES_DOMAIN_CLOCK'));
 assert.ok(hasCode(domain.derive(db,operation(),options({today:'2026-10-31'})),'DES_DOMAIN_CLOCK'));
});

test('actual receiving SQLite executes the exact fixed recipe after a catalog addition, stamps its own scope and replays without duplicates',t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),storage=require('../electron/storage.js'),adapter=require('../electron/sqlite-storage.cjs'),server=require('../electron/server.js'),compat=require('../assets/core/platform-compatibility.js');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'des-object-domain-'));
 t.after(()=>{const resolved=path.resolve(root);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('des-object-domain-'));fs.rmSync(resolved,{recursive:true,force:true});});
 const dataDir=path.join(root,'receiving-synthetic-data');assert.equal(adapter.create(dataDir,{data:fixture()}).ok,true);
 let snapshot=storage.readSnapshot(dataDir),proof=server.localWriteOptions({hello:compat.describe().hello,databaseToken:snapshot.databaseToken,principal:central});
 const catalog=storage.writeSections(dataDir,{protocolVersion:1,databaseToken:snapshot.databaseToken,base:{parts:snapshot.revisions.parts},sections:{parts:[...snapshot.data.parts,{id:'new-filter',generatorId:'g',name:'New exact part',unit:'шт'}]},operation:{id:'synthetic-domain-catalog'}},{...proof,principal:central,now});assert.equal(catalog.ok,true,JSON.stringify(catalog));
 snapshot=storage.readSnapshot(dataDir);const result=domain.derive(snapshot.data,operation('local-new-filter',{partId:'new-filter',scopeSnapshot:{version:1,complete:true,owners:[{org:'FALSE SOURCE',site:'FALSE SOURCE'}]}}),options());assert.equal(result.canApply,true,JSON.stringify(result.issues));
 for(const step of result.steps){
  snapshot=storage.readSnapshot(dataDir);proof=server.localWriteOptions({hello:compat.describe().hello,databaseToken:snapshot.databaseToken,principal:central});
  const envelope={protocolVersion:1,databaseToken:snapshot.databaseToken,base:snapshot.revisions,command:step.command,operation:{id:step.operationId}},executed=storage.executeCommand(dataDir,envelope,{...proof,principal:central,now:result.now});assert.equal(executed.ok,true,JSON.stringify(executed));
  const beforeReplay=storage.readSnapshot(dataDir),replay=storage.executeCommand(dataDir,envelope,{...proof,principal:central,now:result.now});assert.equal(replay.ok,true,JSON.stringify(replay));assert.deepEqual(storage.readSnapshot(dataDir).revisions,beforeReplay.revisions);
 }
 const rows=storage.readSnapshot(dataDir).data.partMovements;assert.equal(rows.length,1);assert.equal(rows[0].id,result.recordMapping.targetId);assert.equal(rows[0].scopeSnapshot.complete,true);assert.deepEqual(rows[0].scopeSnapshot.owners,[scope]);assert.equal(rows[0].lifecycle.postedAt,now);assert.deepEqual(rows[0].lifecycle.postedActor,central);assert.equal(storage.readSnapshot(dataDir).data.documentDrafts[0].status,'posted');
});

test('new posted tank receipt is recreated through ordinary saveDraft/postDraft with central attribution and typed mapping',()=>{
 const db=tankFixture(),op=tankOperation(),before=JSON.stringify({db,op}),result=domain.derive(db,op,options());assert.equal(result.canApply,true,JSON.stringify(result.issues));assert.equal(result.supported,true);assert.equal(JSON.stringify({db,op}),before);assert.equal(domain.requiresDomainAction(op),true);
 assert.deepEqual(result.steps.map(step=>[step.command.type,step.command.input.section,step.command.input.action]),[['DocumentAction','tankIncomes','saveDraft'],['DocumentAction','tankIncomes','postDraft']]);assert.equal(result.recordMapping.section,'tankIncomes');assert.equal(result.recordMapping.sourceId,0);assert.equal(result.recordMapping.targetId,result.steps[1].operationId);
 const receipt=result.sections.tankIncomes[0];assert.equal(receipt.tankId,0);assert.equal(receipt.amount,100);assert.equal(receipt.id,result.recordMapping.targetId);assert.equal(receipt.lifecycle.postedAt,now);assert.deepEqual(receipt.lifecycle.postedActor,central);assert.deepEqual(receipt.createdBy,central);assert.equal(JSON.stringify(result.steps).includes('local-tank-post'),false);assert.equal(JSON.stringify(result.steps).includes('object-operator'),false);assert.equal(result.sections.tanks,undefined);
 const string=domain.derive(db,tankOperation('0'),options());assert.equal(string.canApply,true,JSON.stringify(string.issues));assert.notEqual(string.recordMapping.targetId,result.recordMapping.targetId);
});

test('ordinary receipts cannot import corrections, reversals, paired transfers, procurement authority or unposted legacy rows',()=>{
 const db=tankFixture();const unposted=tankOperation();delete unposted.after.lifecycle;
 for(const op of [unposted,{...tankOperation(),before:tankOperation().after},{...tankOperation(),after:null},tankOperation(0,{kind:'in'}),tankOperation(0,{kind:'out'}),tankOperation(0,{linkId:'pair'}),tankOperation(0,{counterTankId:'0'}),tankOperation(0,{procurementReceipt:{version:1}}),tankOperation(0,{procurementReturn:{version:1}}),tankOperation(0,{litres:100}),tankOperation(0,{lifecycle:{version:1,postedAt:now,postedActor:local,operationId:'local-post',correctionOf:{section:'tankIncomes',id:'old'}}}),tankOperation(0,{lifecycle:{version:1,postedAt:now,postedActor:local,operationId:'local-post',void:{}}})]){const result=domain.derive(db,op,options());assert.equal(result.canApply,false,JSON.stringify(op));assert.equal(result.steps.length,0);assert.equal(result.recordMapping,null);}
 for(const amount of [null,0,-1,0.0001,'100'])assert.equal(domain.derive(db,tankOperation(0,{amount}),options()).canApply,false,String(amount));
});

test('tank receipt rejects foreign or ambiguous target, wrong organisation, denied receiver and closed fuel month',()=>{
 const db=tankFixture();assert.ok(hasCode(domain.derive(db,tankOperation(0,{tankId:'0'}),options()),'DES_DOMAIN_SCOPE'));assert.ok(hasCode(domain.derive(db,tankOperation(0,{org:'OTHER ORG'}),options()),'DES_DOMAIN_SCOPE'));
 const ambiguous=clone(db);ambiguous.tanks.push(clone(ambiguous.tanks[0]));assert.equal(domain.derive(ambiguous,tankOperation(),options()).canApply,false);
 for(const principal of [{...central,role:'viewer'},{...central,readable:['tanks','tankIncomes']},{...central,writable:['tankIncomes']}])assert.equal(domain.derive(db,tankOperation(),options({principal})).canApply,false);
 const closed=domain.derive(tankFixture({fuelPeriods:[{month:'2026-10',closed:true}]}),tankOperation(),options());assert.equal(closed.canApply,false);assert.equal(closed.steps.length,0);assert.deepEqual(closed.sections,{});
});

test('framed tank receipt validates selected scope from private handover and still plans against unmodified host facts',()=>{
 const transfer=require('../electron/des-object-tanks.cjs'),db=tankFixture();delete db.tanks[0].org;delete db.tanks[0].site;db.generators[0].tankId=0;
 const before=JSON.stringify(db),frame=transfer.prepare(db,{scope,tankIds:[0],principal:central,today:'2026-11-01',now,databaseToken:'synthetic-central-token'}).frame,op=tankOperation('framed-income',{date:'2026-11-01'}),result=domain.derive(db,op,options({tankFrame:frame}));assert.equal(result.canApply,true,JSON.stringify(result.issues));assert.equal(JSON.stringify(db),before);assert.equal(result.sections.tanks,undefined);assert.equal(result.sections.generators,undefined);assert.equal(result.sections.tankIncomes[0].amount,100);
 const unframed=domain.derive(db,op,options());assert.equal(unframed.canApply,false);assert.ok(hasCode(unframed,'DES_DOMAIN_SCOPE'));
 const past=domain.derive(db,tankOperation('past',{date:'2026-10-31'}),options({tankFrame:frame}));assert.ok(hasCode(past,'DES_DOMAIN_RECEIPT_DATE'));
 const scoped={...central,accessPolicy:{version:1,grants:[scope]}};assert.ok(hasCode(domain.derive(db,op,options({tankFrame:frame,principal:scoped})),'ACCESS_DENIED'));
 assert.ok(hasCode(domain.derive(db,tankOperation('foreign',{tankId:'0',date:'2026-11-01'}),options({tankFrame:frame})),'DES_DOMAIN_SCOPE'));
});

test('actual receiving SQLite posts a framed tank receipt with fixed central commands and retries without duplicates',t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),storage=require('../electron/storage.js'),adapter=require('../electron/sqlite-storage.cjs'),server=require('../electron/server.js'),compat=require('../assets/core/platform-compatibility.js'),transfer=require('../electron/des-object-tanks.cjs'),fuelStock=require('../assets/core/fuel-stock.js');
 const parent=fs.realpathSync.native(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'des-object-domain-tank-')),pin=fs.lstatSync(root);t.after(()=>{const current=fs.lstatSync(root);assert.equal(path.dirname(root),parent);assert.match(path.basename(root),/^des-object-domain-tank-/);assert.equal(current.isSymbolicLink(),false);assert.equal(current.dev,pin.dev);assert.equal(current.ino,pin.ino);fs.rmSync(root,{recursive:true,force:true});});
 const data=tankFixture();delete data.tanks[0].org;delete data.tanks[0].site;data.generators[0].tankId=0;const frame=transfer.prepare(data,{scope,tankIds:[0],principal:central,today:'2026-11-01',now,databaseToken:'synthetic-central-token'}).frame,dataDir=path.join(root,'database');assert.equal(adapter.create(dataDir,{data}).ok,true);
 const result=domain.derive(data,tankOperation('source-tank-income',{date:'2026-11-01'}),options({tankFrame:frame}));assert.equal(result.canApply,true,JSON.stringify(result.issues));
 for(const step of result.steps){const before=storage.readSnapshot(dataDir),proof=server.localWriteOptions({hello:compat.describe().hello,databaseToken:before.databaseToken,principal:central}),envelope={protocolVersion:1,databaseToken:before.databaseToken,base:before.revisions,command:step.command,operation:{id:step.operationId}},saved=storage.executeCommand(dataDir,envelope,{...proof,principal:central,now});assert.equal(saved.ok,true,JSON.stringify(saved));const committed=storage.readSnapshot(dataDir),retry=storage.executeCommand(dataDir,envelope,{...proof,principal:central,now});assert.equal(retry.ok,true,JSON.stringify(retry));assert.deepEqual(storage.readSnapshot(dataDir).revisions,committed.revisions);}
 const after=storage.readSnapshot(dataDir);assert.equal(after.data.tankIncomes.length,1);const row=after.data.tankIncomes[0];assert.equal(row.id,result.recordMapping.targetId);assert.equal(row.tankId,0);assert.equal(row.amount,100);assert.equal(row.lifecycle.postedAt,now);assert.deepEqual(row.lifecycle.postedActor,central);assert.deepEqual(after.data.tanks,data.tanks);assert.deepEqual(after.data.generators,data.generators);assert.equal(fuelStock.balanceAt(after.data,{section:'tanks',id:0},'2026-11-01').balance,110);assert.deepEqual(row.scopeSnapshot.owners,[{org:scope.org,site:null}],'Standard host proof is retained literally; the recipe does not invent a historical site');const logical=transfer.overlay(after.data,frame);assert.equal(fuelStock.balanceAt(logical,{section:'tanks',id:0},'2026-11-01').balance,110);
});
