'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const storage=require('../electron/storage'),server=require('../electron/server'),access=require('../electron/access-control'),periods=require('../assets/core/effective-periods'),policy=require('../assets/core/temporal-policy'),movement=require('../assets/core/fuel-movement-policy'),writeoff=require('../assets/core/writeoff-engine'),seasonal=require('../assets/core/seasonal-fuel');
const {writerHeaders}=require('./helpers/http-writer.cjs'),{seedWithLiteralHistory}=require('./helpers/literal-history25-seed.cjs');
const principal={id:'seasonal-admin',name:'Synthetic seasonal administrator',role:'admin'},now='2026-10-22T12:00:00.000Z',copy=structuredClone;
const vehicle=norm=>({norm,normCity:null,normHighway:null,normIdle:null}),generator=norm=>({norm,norm100:30,norm50:20,normIdle:1});
const profiles=(section,norm=10)=>({version:1,summer:(section==='vehicles'?vehicle:generator)(norm),winter:(section==='vehicles'?vehicle:generator)(norm+10)});
const rejected=code=>error=>error.code===code||error.issues?.some(issue=>issue.code===code)||error.details?.issues?.some(issue=>issue.code===code);
function fixture(t,kind,prepare=()=>{}){
 const parent=fs.realpathSync.native(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'tvs-seasonal-storage-')),dir=path.join(root,'db'),identity=fs.lstatSync(root),data={...Object.fromEntries(storage.SECTIONS.map(name=>[name,[]])),vehicles:[{id:0,plate:'SYNTHETIC NUMBER',org:'A',fuel:'diesel',fuelGrade:'ДТ',norm:10,fuelBalance:100},{id:'0',plate:'SYNTHETIC STRING',org:'B',fuel:'diesel',fuelGrade:'ДТ',norm:25,fuelBalance:0}],generators:[{id:0,name:'SYNTHETIC GENERATOR',org:'A',fuel:'diesel',fuelGrade:'ДТ',power:100,norm:2,norm100:30,norm50:20,normIdle:1,fuelBalance:100}],records:[{id:'distance',vehicleId:0,date:'2026-09-10',km:100,fuelActual:5}],genRecords:[{id:'hours',generatorId:0,date:'2026-09-10',hours:1,load:75,fuelActual:2}]};
 prepare(data);seedWithLiteralHistory(dir,kind,{data});t.after(async()=>{await server.stop();const current=fs.lstatSync(root);assert.equal(path.dirname(root),parent);assert.match(path.basename(root),/^tvs-seasonal-storage-/);assert.equal(current.isSymbolicLink(),false);assert.equal(current.dev,identity.dev);assert.equal(current.ino,identity.ino);fs.rmSync(root,{recursive:true,force:true});});return dir;
}
const snapshot=dir=>storage.readSnapshot(dir);
function ambiguousGenerator(data){data.generators=[{id:0,name:'SYNTHETIC LEGACY GENERATOR',org:'A',fuel:'diesel',fuelGrade:'ДТ',norm:2,power:100,fuelBalance:100}];data.genRecords=[{id:'legacy-hours',generatorId:0,date:'2026-09-10',hours:1}];}
function rawSeason(row){const parameters={power:100,norm:2,norm100:null,norm50:null,normIdle:null};return {...row,fuelNorms:{version:1,periods:[{id:'fuel-season:baseline:synthetic-raw',from:'1900-01-01',basis:'Synthetic confirmed legacy baseline',parameters},{id:'fuel-season:winter:synthetic-raw',from:'2026-11-01',basis:'Synthetic future winter order',parameters:{...parameters,norm:3}}]}};}
function save(dir,sections,full=false,actor=principal){const before=snapshot(dir);return full?storage.writeAll(dir,{...before.data,...sections},{principal:actor,now,databaseToken:before.databaseToken,base:before.revisions,requireBase:true}):storage.writeSections(dir,{databaseToken:before.databaseToken,base:before.revisions,sections},{principal:actor,now});}
function applied(db,section,from='2026-10-01'){
 const review=seasonal.prepare(db,{section,season:'winter',from,basis:'Synthetic signed winter order',operationId:'synthetic-seasonal-'+section+'-'+from});assert.equal(review.canApply,true,JSON.stringify(review.issues));
 const byId=new Map(review.changes.map(value=>[value.id,value.after]));return db[section].map(value=>byId.has(value.id)?{...value,fuelNorms:byId.get(value.id)}:value);
}
async function post(port,route,token,body){const json=JSON.stringify(body),headers=await writerHeaders({port,headers:{Authorization:'Bearer '+token}});return new Promise((resolve,reject)=>{const request=http.request({host:'127.0.0.1',port,path:route,method:'POST',agent:false,headers:{...headers,Authorization:'Bearer '+token,'Content-Type':'application/json','Content-Length':Buffer.byteLength(json)}},response=>{let text='';response.setEncoding('utf8');response.on('data',value=>text+=value);response.on('end',()=>{try{resolve({status:response.statusCode,body:JSON.parse(text),text});}catch(error){reject(error);}});});request.setTimeout(15000,()=>request.destroy(Error('Synthetic seasonal HTTP timeout')));request.on('error',reject);request.end(json);});}

for(const kind of ['json','sqlite']){
 test(kind+' rejects introduced malformed seasonal profiles through complete and section writes without changing any source',t=>{
  const dir=fixture(t,kind),before=snapshot(dir);
  for(const section of ['vehicles','generators']){
   const valid=profiles(section),invalid=[null,{}, {...valid,version:2},{version:1,summer:valid.summer},{...valid,extra:true},{...valid,summer:{...valid.summer,norm:'10'}},{...valid,summer:{...valid.summer,norm:-1}},{...valid,summer:{...valid.summer,norm:.0000001}},{...valid,summer:{...valid.summer,power:100}}];
   for(const full of [false,true])for(const value of invalid){const changed=before.data[section].map((row,index)=>index?row:{...row,fuelSeasons:value});assert.throws(()=>save(dir,{[section]:changed},full),rejected('TEMPORAL_SEASON_PROFILE_INVALID'));assert.deepEqual(snapshot(dir),before);}
  }
 });

 test(kind+' preserves unknown legacy profiles during unrelated saves and permits explicit repair',t=>{
  const dir=fixture(t,kind,data=>{data.vehicles[0].fuelSeasons={version:99,summer:{unknown:'legacy'}};}),before=snapshot(dir);
  assert.equal(policy.inspect(before.data).issues.some(value=>value.code==='TEMPORAL_SEASON_PROFILE_INVALID'),true);assert.equal(policy.inspect(before.data,{readable:['records']}).issues.length,0);
  assert.equal(save(dir,{vehicles:before.data.vehicles.map(row=>({...row,note:'A descriptive update'})),records:before.data.records.map(row=>({...row,km:101}))},true).ok,true);
  const legacy=snapshot(dir);assert.deepEqual(legacy.data.vehicles[0].fuelSeasons,before.data.vehicles[0].fuelSeasons);assert.equal(legacy.data.records[0].km,101);
  assert.equal(save(dir,{vehicles:legacy.data.vehicles.map(row=>{const next={...row};delete next.fuelSeasons;return next;})}).ok,true);
  const repaired=snapshot(dir);assert.equal(save(dir,{vehicles:repaired.data.vehicles.map(row=>({...row,fuelSeasons:{version:1,summer:null,winter:null}}))}).ok,true);
 });

 test(kind+' valid profiles cannot disappear through an older incomplete form while explicit clearing remains allowed',t=>{
  const dir=fixture(t,kind,data=>{data.vehicles[0].fuelSeasons=profiles('vehicles');data.generators[0].fuelSeasons=profiles('generators',2);}),before=snapshot(dir);
  for(const section of ['vehicles','generators'])for(const full of [false,true]){const dropped=before.data[section].map(row=>{const result={...row,note:'Old form'};delete result.fuelSeasons;return result;});assert.throws(()=>save(dir,{[section]:dropped},full),rejected('TEMPORAL_SEASON_PROFILE_REQUIRED'));assert.deepEqual(snapshot(dir),before);}
  assert.equal(save(dir,{vehicles:before.data.vehicles.map(row=>({...row,fuelSeasons:{version:1,summer:null,winter:null}})),generators:before.data.generators.map(row=>({...row,fuelSeasons:{version:1,summer:null,winter:null}}))},true).ok,true);
  const cleared=snapshot(dir);assert.equal(cleared.data.generators[0].power,100);assert.equal(cleared.data.generators[0].fuelNorms,undefined);assert.deepEqual(cleared.data.records,before.data.records);
 });

 test(kind+' seasonal metadata cannot bypass an otherwise valid scoped note-only field grant',t=>{
  const dir=fixture(t,kind),before=snapshot(dir),actor={...principal,id:'seasonal-note-only',accessPolicy:{version:1,grants:[{org:'A',site:{any:true}}],sections:{vehicles:{writeFields:['note']}}}},view=storage.readSnapshot(dir,{principal:actor});
  assert.deepEqual(view.data.vehicles.map(row=>row.id),[0]);
  const request=vehicles=>({databaseToken:view.databaseToken,base:view.revisions,scopeViews:view.scopeViews,sections:{vehicles}}),changed=view.data.vehicles.map(row=>({...row,fuelSeasons:profiles('vehicles')}));
  assert.throws(()=>storage.writeSections(dir,request(changed),{principal:actor,now}),rejected('ACCESS_DENIED'));assert.deepEqual(snapshot(dir),before);
  assert.equal(storage.writeSections(dir,request(view.data.vehicles.map(row=>({...row,note:'Permitted scoped note'}))),{principal:actor,now}).ok,true);const after=snapshot(dir);assert.equal(after.data.vehicles.find(row=>row.id===0).note,'Permitted scoped note');assert.deepEqual(after.data.vehicles.find(row=>row.id==='0'),before.data.vehicles.find(row=>row.id==='0'));
 });

 test(kind+' seasonal group application preserves typed identity, legacy baseline and protected closed projections',t=>{
  const dir=fixture(t,kind,data=>{data.fuelPeriods=[{month:'2026-09',closed:true}];for(const row of data.vehicles)row.fuelSeasons=profiles('vehicles',row.norm);data.generators[0].fuelSeasons=profiles('generators',2);}),before=snapshot(dir);
  const next={vehicles:applied(before.data,'vehicles'),generators:applied(before.data,'generators')};assert.equal(save(dir,next,true).ok,true);const done=snapshot(dir);
  for(const section of ['vehicles','generators'])for(const original of before.data[section]){const changed=done.data[section].find(row=>row.id===original.id);assert.equal(changed.norm,original.norm);assert.equal(changed.fuelNorms.version,1);assert.equal(changed.fuelNorms.periods[0].from,'1900-01-01');for(const date of ['1900-01-01','2026-08-05','2026-09-30'])assert.deepEqual(periods.projection(section,changed,date,'fuelNorms'),periods.projection(section,original,date,'fuelNorms'));assert.equal(periods.resolve(section,changed,'2026-10-01','fuelNorms').parameters.norm,original.norm+10);}
  assert.deepEqual(done.data.vehicles.map(value=>[typeof value.id,value.id]),[['number',0],['string','0']]);assert.equal(done.data.generators[0].power,100);assert.equal(done.data.generators[0].fuelNorms.periods[0].parameters.power,100);assert.equal(done.data.generators[0].fuelNorms.periods[1].parameters.power,100);assert.deepEqual(done.data.records,before.data.records);assert.deepEqual(done.data.genRecords,before.data.genRecords);
  for(const section of ['vehicles','generators'])assert.throws(()=>save(dir,{[section]:applied(done.data,section,'2026-09-01')}),rejected('TEMPORAL_CLOSED_IMPACT'));assert.deepEqual(snapshot(dir),done);
 });

 test(kind+' profile edits and future seasonal periods preserve every previously posted act version',t=>{
  for(const version of [1,2,3,4,5,6]){
   const dir=fixture(t,kind,data=>{const api=writeoff.forVersion(version),input={month:'2026-09',org:'A',grade:'ДТ',date:'2026-10-01',basisNote:'Synthetic immutable old act'},review=api.prepare(data,input);assert.equal(review.canPost,true,JSON.stringify(review.issues));data.fuelWriteoffs=[api.post(data,input,{id:'act-'+version,number:'SYNTHETIC-'+version,postedAt:now,postedBy:principal,expectedFingerprint:review.sourceFingerprint})];}),before=snapshot(dir),frozen=JSON.stringify(before.data.fuelWriteoffs);
   assert.equal(save(dir,{vehicles:before.data.vehicles.map(row=>({...row,fuelSeasons:profiles('vehicles',row.norm)}))}).ok,true);const configured=snapshot(dir);assert.equal(configured.data.vehicles[0].fuelNorms,undefined);assert.equal(JSON.stringify(configured.data.fuelWriteoffs),frozen);
   assert.equal(save(dir,{vehicles:applied(configured.data,'vehicles')},true).ok,true);const done=snapshot(dir);assert.equal(JSON.stringify(done.data.fuelWriteoffs),frozen);assert.deepEqual(done.data.records,before.data.records);
   assert.throws(()=>save(dir,{vehicles:applied(done.data,'vehicles','2026-09-01')}),error=>!!(rejected('TEMPORAL_POSTED_IMPACT')(error)||rejected('POSTED_SOURCE_LOCKED')(error)));assert.deepEqual(snapshot(dir),done);
  }
 });

 test(kind+' raw seasonal periods cannot silently convert an earlier legacy physical zero into an unknown consumption',t=>{
  const dir=fixture(t,kind,ambiguousGenerator),before=snapshot(dir),changed=rawSeason(before.data.generators[0]);
  assert.equal(movement.generatorSpent(before.data.generators[0],before.data.genRecords[0]),0);assert.equal(movement.generatorSpent(changed,before.data.genRecords[0]),null);
  for(const full of [false,true]){assert.throws(()=>save(dir,{generators:[changed]},full),rejected('SEASON_HISTORY_CHANGED'));assert.deepEqual(snapshot(dir),before);}
  const shifted={...changed,fuelAccounting:{version:1,from:'2026-11-01',opening:100,basis:'Synthetic later accounting boundary'}};
  assert.throws(()=>policy.validateChanges(before.data,{...before.data,generators:[shifted]}),rejected('SEASON_HISTORY_CHANGED'));
  assert.throws(()=>save(dir,{generators:[shifted]},true),rejected('SEASON_HISTORY_CHANGED'));assert.deepEqual(snapshot(dir),before);
  const confirmed=before.data.genRecords.map(row=>({...row,fuelActual:0}));assert.equal(save(dir,{generators:[changed],genRecords:confirmed},true).ok,true);assert.equal(snapshot(dir).data.genRecords[0].fuelActual,0);
 });

 test(kind+' seasonal history guards inspect final batch records and preserve explicit values and pre-accounting exclusions',t=>{
  const newFacts=fixture(t,kind,data=>{ambiguousGenerator(data);data.genRecords=[];}),old=snapshot(newFacts),incoming={id:'new-past-hours',generatorId:0,date:'2026-09-10',hours:1};
  assert.throws(()=>save(newFacts,{generators:old.data.generators.map(rawSeason),genRecords:[incoming]},true),rejected('SEASON_HISTORY_CHANGED'));assert.deepEqual(snapshot(newFacts),old);
  for(const facts of [{fuelActual:0},{fuelUsed:0},{fuelActual:2.5}]){const dir=fixture(t,kind,data=>{ambiguousGenerator(data);Object.assign(data.genRecords[0],facts);}),before=snapshot(dir);assert.equal(save(dir,{generators:before.data.generators.map(rawSeason)}).ok,true);assert.deepEqual(snapshot(dir).data.genRecords,before.data.genRecords);}
  const ignored=fixture(t,kind,data=>{ambiguousGenerator(data);data.generators[0].fuelAccounting={version:1,from:'2026-09-01',opening:100,basis:'Synthetic opening measurement'};data.genRecords[0].date='2026-08-10';}),before=snapshot(ignored);assert.equal(save(ignored,{generators:before.data.generators.map(rawSeason)}).ok,true);assert.deepEqual(snapshot(ignored).data.genRecords,before.data.genRecords);
 });

 test('HTTP '+kind+' uses the same seasonal validation and section rights with canonical acknowledgements',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse(now)});const dir=fixture(t,kind,ambiguousGenerator),token='synthetic-seasonal-admin-token-0123456789',viewer='synthetic-seasonal-viewer-token-0123456789',settings={serverAccessConfigured:true,serverUsers:access.normalizeServerUsers([{...principal,enabled:true,tokenHash:access.hashToken(token)},{id:'seasonal-viewer',name:'Synthetic readonly',role:'viewer',enabled:true,tokenHash:access.hashToken(viewer)}])},started=await server.start({port:0,dataDir:dir,settings,backupFn:()=>{}});assert.equal(started.ok,true);const before=snapshot(dir);
  for(const route of ['/api/sections','/api/data']){const sections={vehicles:before.data.vehicles.map(row=>({...row,fuelSeasons:{version:99}}))},body={databaseToken:before.databaseToken,base:before.revisions,...(route==='/api/data'?{data:{...before.data,...sections}}:{sections})},bad=await post(started.port,route,token,body);assert.equal(bad.status,400,bad.text);assert.equal(bad.body.code,'TEMPORAL_VIOLATION');assert.deepEqual(snapshot(dir),before);}
  const sections={vehicles:before.data.vehicles.map(row=>({...row,fuelSeasons:profiles('vehicles',row.norm)}))},body={databaseToken:before.databaseToken,base:before.revisions,sections},denied=await post(started.port,'/api/sections',viewer,body);assert.equal(denied.status,403,denied.text);assert.deepEqual(snapshot(dir),before);
  const accepted=await post(started.port,'/api/sections',token,body);assert.equal(accepted.status,200,accepted.text);assert.deepEqual(accepted.body.canonicalSections.vehicles[0].fuelSeasons,profiles('vehicles'));assert.equal(accepted.body.canonicalSections.vehicles[0].fuelNorms,undefined);assert.equal(accepted.body.canonicalSections.vehicles[0].norm,10);
  const current=snapshot(dir);for(const route of ['/api/sections','/api/data']){const sections={generators:current.data.generators.map(rawSeason)},bad=await post(started.port,route,token,{databaseToken:current.databaseToken,base:current.revisions,...(route==='/api/data'?{data:{...current.data,...sections}}:{sections})});assert.equal(bad.status,400,bad.text);assert.equal(bad.body.code,'TEMPORAL_VIOLATION');assert.deepEqual(snapshot(dir),current);}
 });
}
