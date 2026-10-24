'use strict';
// Synthetic allocation only. No application profile or diagnostic copy is read.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const fuelRoot=require('../assets/core/fuel-engine.js'),writeoffRoot=require('../assets/core/writeoff-engine.js'),audit=require('../assets/core/fuel-audit.js'),application=require('../assets/core/application-engine.js'),precision=require('../assets/core/precision-policy.js'),storage=require('../electron/storage'),sqlite=require('../electron/sqlite-storage.cjs');
const fuel={...fuelRoot.forVersion(5),forVersion:fuelRoot.forVersion},writeoff={...writeoffRoot.forVersion(5),forVersion:writeoffRoot.forVersion};
const range={from:'2026-09-01',to:'2026-09-30'},request={month:'2026-09',date:'2026-09-30'},actor={id:'test',name:'Synthetic',role:'admin'},metadata={id:'synthetic-act',number:'Synthetic',postedAt:'2026-10-23T12:00:00.000Z',postedBy:{id:'test',name:'Synthetic'}};
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fixture(km=100){return {vehicles:[{id:'v',plate:'SYNTHETIC',org:'A',fuel:'diesel',fuelGrade:'ДТ',fuelBalance:3,fuelBalanceSources:[{org:'A',grade:'ДТ',qty:1},{org:'B',grade:'ДТ',qty:2}],norm:10}],records:[{id:'a',vehicleId:'v',date:'2026-09-01',km:1,kmGlonass:1,fuelActual:3},{id:'b',vehicleId:'v',date:'2026-09-02',km,kmGlonass:km,fuelIssued:20,fuelOrg:'A',fuelActual:20}],fuelPurchases:[],fuelCards:[],monthlyFuel:[],fuelWriteoffs:[]};}
function post(api,db){const prepared=api.prepare(db,request);assert.equal(prepared.canPost,true,JSON.stringify(prepared.issues));return api.post(db,request,{...metadata,expectedFingerprint:prepared.sourceFingerprint});}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function threeSources(){const db=fixture();db.vehicles[0].fuelBalanceSources=['A','B','C'].map(org=>({org,grade:'ДТ',qty:1}));db.records=[{id:'thirds',vehicleId:'v',date:'2026-09-01',km:1,kmGlonass:1,fuelActual:2.999,fuelIdle:.001}];return db;}

test('v5 derived norms retain decimal precision until the final quantum for admitted fields and legacy precision',()=>{
 const db=fixture();db.vehicles[0].norm=99.999999;db.vehicles[0].fuelBalance=10;delete db.vehicles[0].fuelBalanceSources;db.records=[{id:'norm',vehicleId:'v',date:'2026-09-01',km:100000.123,kmGlonass:100000.123,fuelActual:0,fuelIdle:.001}];const before=JSON.stringify(db);
 assert.deepEqual(precision.inspect(db).issues,[]);assert.throws(()=>fuel.forVersion(4).fqRecord(db.records[0],db.vehicles[0]),{code:'RANGE'});
 const value=fuel.fqRecord(db.records[0],db.vehicles[0]);assert.equal(value.norm,100000.122);assert.equal(value.total,.001);const ledger=fuel.buildLedger(db,range);assert.equal(ledger.rows[0].norm,100000.122);assert.equal(ledger.rows[0].glonass,100000.123);
 assert.equal(fuel.fqRecord({km:10000.12345,date:'2026-09-01'},{norm:12.3456789}).norm,1234.583);assert.equal(fuel.fqRecord({...db.records[0],fuelUsed:0},db.vehicles[0]).norm,0);assert.equal(JSON.stringify(db),before);
});

test('v5 conserves source kilometres, norm, idle and GLONASS across three organisations with explicit display adjustments',()=>{
 const db=threeSources(),before=JSON.stringify(db),ledger=fuel.buildLedger(db,range),a=ledger.rows.find(row=>row.org==='A');assert.deepEqual(precision.inspect(db).issues,[]);
 for(const [field,expected]of Object.entries({km:1,norm:.1,idle:.001,glonass:1}))assert.equal(fuel.gsmRound(ledger.rows.reduce((sum,row)=>sum+row[field],0)),expected,field);
 assert.equal(a.km,.334);assert.equal(a.norm,.034);assert.equal(a.idle,.001);assert.equal(a.roundingAdjustment.km,.001);assert.ok(ledger.issues.some(item=>item.code==='rounding-allocation'&&item.field==='km'));
 const document=post(writeoff,db);assert.equal(document.totals.km,1);assert.equal(document.totals.glonass,1);assert.equal(document.totals.norm,.1);assert.equal(document.totals.idle,.001);assert.equal(document.totals.spent,3);assert.ok(document.consumption.some(item=>item.roundingAdjustment?.km===.001));assert.equal(JSON.stringify(db),before);
 for(const row of document.rows){const items=document.consumption.filter(item=>item.org===row.org);assert.equal(fuel.gsmRound(items.reduce((sum,item)=>sum+item.km,0)),row.km);assert.equal(fuel.gsmRound(items.reduce((sum,item)=>sum+item.norm,0)),row.norm);}
});

test('v5 resolves negative half-quantum ties and repeated source splits deterministically without changing physical litres',()=>{
 const half=fixture();half.vehicles[0].fuelBalance=2;half.vehicles[0].fuelBalanceSources=['A','B'].map(org=>({org,grade:'ДТ',qty:1}));half.records=[{id:'half',vehicleId:'v',date:'2026-09-01',km:.001,kmGlonass:.001,fuelUsed:.001,fuelActual:2}];const result=fuel.buildLedger(half,range);assert.equal(result.rows.find(row=>row.org==='A').km,0);assert.equal(result.rows.find(row=>row.org==='B').km,.001);assert.equal(post(writeoff,half).totals.km,.001);
 const db=threeSources();db.vehicles[0].fuelBalance=0;delete db.vehicles[0].fuelBalanceSources;db.records=[];db.fuelPurchases=[];
 for(let index=1;index<=10;index++){const id='r'+index,date='2026-09-'+String(index).padStart(2,'0');db.records.push({id,vehicleId:'v',date,km:1,kmGlonass:1,fuelIssued:3,fuelActual:3});for(const [position,org]of ['A','B','C'].entries())db.fuelPurchases.push({id:id+org,vehicleId:'v',recordId:id,date,time:'08:0'+position,qty:1,grade:'ДТ',sourceOrg:org});}
 const before=JSON.stringify(db),first=fuel.buildLedger(db,range),again=fuel.buildLedger(structuredClone(db),range),document=post(writeoff,db);assert.deepEqual(again,first);assert.equal(document.totals.km,10);assert.equal(document.totals.norm,1);assert.equal(document.totals.spent,30);assert.equal(document.totals.end,0);assert.equal(JSON.stringify(db),before);
});

test('actual calculation worker preserves v5 decimal provenance and reconciled source totals',async t=>{
 const {Worker}=require('node:worker_threads'),file=require.resolve('../assets/core/engine-worker.js'),worker=new Worker("const{parentPort}=require('node:worker_threads');const endpoint=require("+JSON.stringify(file)+").createHandler({postMessage:m=>parentPort.postMessage(m)});parentPort.on('message',m=>endpoint.handle(m));",{eval:true});t.after(()=>worker.terminate());
 const send=message=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Synthetic v5 worker timeout')),10000);function receive(reply){if(reply.requestId!==message.requestId)return;worker.removeListener('message',receive);clearTimeout(timer);resolve(reply);}worker.on('message',receive);worker.postMessage(message);});
 const db=threeSources(),loaded=await send({type:'load',requestId:'load-v5',generation:1,database:db,context:{identity:'v5-synthetic'}});assert.equal(loaded.ok,true);
 for(const [name,options]of [['fuel',range],['writeoff',request]]){const reply=await send({type:'query',requestId:name,generation:1,identity:'v5-synthetic',sourceFingerprint:loaded.sourceFingerprint,name,options});assert.equal(reply.ok,true,JSON.stringify(reply.error));assert.deepEqual(reply.value,application.create().query(name,db,options));assert.deepEqual(JSON.parse(JSON.stringify(reply.value.movements||reply.value.snapshot?.ledger?.movements)),JSON.parse(JSON.stringify(application.create().query(name,db,options).movements||application.create().query(name,db,options).snapshot?.ledger?.movements)));}
});

test('v5 accumulates fractional historical allocation without Number range failures or rewritten source facts',()=>{
 const db=fixture(10000);db.records[0].date='2026-08-01';const before=JSON.stringify(db);freeze(db);
 assert.throws(()=>fuel.forVersion(4).buildLedger(db,{to:range.to}),{code:'RANGE'});
 const all=fuel.buildLedger(db,{to:range.to}),a=all.rows.find(row=>row.org==='A'),b=all.rows.find(row=>row.org==='B');
 assert.equal(fuel.calculationVersion,5);assert.equal(a.km,10000.333);assert.equal(b.km,.667);assert.equal(a.glonass,10000.333);assert.equal(a.norm,1000.033);assert.equal(all.rows.reduce((sum,row)=>sum+row.spent,0),23);assert.equal(all.rows.reduce((sum,row)=>sum+row.end,0),0);
 assert.ok(audit.buildModel(db,range).items.length>0);assert.equal(JSON.stringify(db),before);
});

test('v5 new acts retain decimal allocation provenance through JSON, runtime caches and largest-remainder reconciliation',()=>{
 const db=fixture(10000),before=JSON.stringify(db),runtime=application.create(),ledger=runtime.query('fuel',db,range),again=runtime.query('fuel',structuredClone(db),range);
 assert.deepEqual(again,ledger);assert.deepEqual(JSON.parse(JSON.stringify(ledger.movements)),ledger.movements);assert.deepEqual(structuredClone(ledger),ledger);
 const split=ledger.movements.find(row=>row.kind==='consumption'&&row.recordId==='a'&&row.org==='A');assert.equal(split.allocation.km,'0.333333333333');assert.equal(split.allocation.scale,12);
 const prepared=runtime.query('writeoff',db,request),document=post(writeoff,db);assert.equal(prepared.canPost,true);assert.equal(document.calculationVersion,5);assert.equal(document.totals.km,10001);assert.equal(document.totals.spent,23);
 for(const row of document.rows){const parts=document.consumption.filter(item=>item.org===row.org);for(const field of ['qty','idle','norm','km'])assert.equal(fuel.gsmRound(parts.reduce((sum,item)=>sum+(item[field]||0),0)),field==='qty'?row.spent:row[field]);}
 assert.equal(writeoff.validateDocuments(db,{...db,fuelWriteoffs:[document]}),true);assert.equal(JSON.stringify(db),before);
 for(const api of [fuel,writeoff])assert.throws(()=>api.forVersion(7),{code:'CALCULATION_VERSION'});
 assert.throws(()=>writeoff.validateDocuments(db,{...db,fuelWriteoffs:[{...document,calculationVersion:7}]}),{code:'CALCULATION_VERSION'});
 assert.throws(()=>writeoff.forVersion(4).validateDocuments({...db,fuelWriteoffs:[document]},{...db,fuelWriteoffs:[document]}),{code:'CALCULATION_VERSION'});
});

test('one-source records retain their exact numeric facts without duplicating allocation metadata in every movement',()=>{
 const db=fixture();db.vehicles[0].fuelBalanceSources=[{org:'A',grade:'ДТ',qty:3}];const before=JSON.stringify(db),ledger=fuel.buildLedger(db,range),movements=ledger.movements.filter(row=>row.kind==='consumption');assert.equal(movements.length,2);assert.ok(movements.every(row=>!Object.hasOwn(row,'allocation')));assert.deepEqual(movements.map(row=>row.km),db.records.map(row=>row.km));assert.equal(post(writeoff,db).totals.km,101);assert.equal(JSON.stringify(db),before);
});

const golden={
 1:['89745244119001f9568b25d1402cfbce210aa05d387bbac6252e9c772bbbfc73','a6195bbfb0235327b0162199ef1343d8b029a0559519955e7d326d15b23e7a97','1c6070ffca492d23ae498fd843f76748d092efa6c2f0874d1fab9f7fbd790308'],
 2:['47b0ceebea5feeec0e87358652ea7fcefd4f026f66e11009a6467292a6533903','33774e97e6b39e055f76582e344b2202ac5e5e54881a9d1f6f64b11c3f82a711','3428a94bb0c183a392ca5f604cb8a71692b1923dc77f33999e24c0bd7ebfcc35'],
 3:['47b0ceebea5feeec0e87358652ea7fcefd4f026f66e11009a6467292a6533903','39f7f2e371c2f91a3a9860d2362aaf4dd9c1d08848ab913b1d6b63d244a07208','272a8f432f351f2727e600f10918e5a2cb5f0aa51738ea28966d2f736d2ce5fb'],
 4:['47b0ceebea5feeec0e87358652ea7fcefd4f026f66e11009a6467292a6533903','a77160be65c82a362405244153939492bfb5b17cffcc80c43cfa1d973ecddd3d','80e081f3d3599e17a6277b88cb1eb1585566ae806f0a00c055b56417e947711c']
};
test('all four frozen ledger, preview and posted snapshot hashes reproduce their pre-v5 bytes',()=>{
 const db=fixture();for(const version of [1,2,3,4]){const f=fuel.forVersion(version),w=writeoff.forVersion(version);assert.deepEqual([hash(f.buildLedger(db,range)),hash(w.prepare(db,request)),hash(post(w,db))],golden[version]);const old=post(w,db);assert.equal(writeoff.validateDocuments({...db,fuelWriteoffs:[old]},{...db,fuelWriteoffs:[structuredClone(old)]}),true);}
});

test('browser UMD and CommonJS v5 calculation and posted snapshot bytes agree',()=>{
 const context=vm.createContext({});for(const file of ['decimal-core.js','accounting-boundary.js','effective-periods.js','fuel-engine.js','writeoff-engine.js','fuel-audit.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/core',file),'utf8'),context,{filename:file});const db=fixture(10000);
 assert.equal(JSON.stringify(context.TvsFuelEngine.forVersion(5).buildLedger(db,range)),JSON.stringify(fuel.buildLedger(db,range)));assert.equal(JSON.stringify(post(context.TvsWriteoffEngine.forVersion(5),db)),JSON.stringify(post(writeoff,db)));
});

for(const format of ['json','sqlite'])test(format+' canonical storage posts current v6 with trusted metadata and preserves old v4 snapshots',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-fuel-allocation-v5-')),dir=path.join(root,'db');t.after(()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.match(path.basename(root),/^tvs-fuel-allocation-v5-/);fs.rmSync(root,{recursive:true,force:true});});
 const small=fixture(),old=post(writeoff.forVersion(4),small),data={...Object.fromEntries(storage.SECTIONS.map(name=>[name,[]])),...small,fuelWriteoffs:[old]},revisions=Object.fromEntries(storage.SECTIONS.map(name=>[name,1]));if(format==='sqlite')sqlite.create(dir,{data,revisions});else storage.createJson(dir,{data,revisions});
 const before=storage.readSnapshot(dir),future=before.data.records.concat({id:'future',vehicleId:'v',date:'2026-10-01',km:1,fuelActual:0});assert.equal(storage.writeSections(dir,{databaseToken:before.databaseToken,base:before.revisions,sections:{records:future}},{principal:actor,now:metadata.postedAt}).ok,true);assert.equal(JSON.stringify(storage.readAll(dir).fuelWriteoffs[0]),JSON.stringify(old));
 const source=fixture(10000),nextDir=path.join(root,'new'),nextData={...Object.fromEntries(storage.SECTIONS.map(name=>[name,[]])),...source};if(format==='sqlite')sqlite.create(nextDir,{data:nextData,revisions});else storage.createJson(nextDir,{data:nextData,revisions});const snapshot=storage.readSnapshot(nextDir),document=post(writeoffRoot,source),result=storage.writeSections(nextDir,{databaseToken:snapshot.databaseToken,base:snapshot.revisions,sections:{fuelWriteoffs:[document]}},{principal:actor,now:metadata.postedAt});
 assert.equal(result.ok,true);const saved=storage.readSnapshot(nextDir);assert.equal(saved.data.fuelWriteoffs[0].calculationVersion,6);assert.deepEqual(saved.data.fuelWriteoffs[0].postedBy,actor);assert.deepEqual(saved.data.records,snapshot.data.records);assert.deepEqual(saved.data.vehicles,snapshot.data.vehicles);assert.equal(writeoffRoot.validateDocuments(saved.data,structuredClone(saved.data)),true);
 const unknown={...document,id:'future-engine',calculationVersion:7};assert.throws(()=>storage.writeSections(nextDir,{databaseToken:saved.databaseToken,base:saved.revisions,sections:{fuelWriteoffs:[...saved.data.fuelWriteoffs,unknown]}},{principal:actor,now:metadata.postedAt}),{code:'CALCULATION_VERSION'});assert.deepEqual(storage.readSnapshot(nextDir),saved);
});
