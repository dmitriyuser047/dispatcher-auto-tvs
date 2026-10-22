'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),vm=require('node:vm');
const storage=require('../electron/storage');
const sqlite=require('../electron/sqlite-storage.cjs');
const access=require('../electron/access-control');
const server=require('../electron/server');
const policy=require('../assets/core/fuel-movement-policy.js');
const commands=require('../assets/core/platform-commands.js');
const sources=require('../assets/core/financial-recognition.js');
const writeoff=require('../assets/core/writeoff-engine.js');
const admin={id:'boundary-admin',name:'Synthetic boundary account',role:'admin'},now='2026-10-22T09:00:00.000Z';
const anchor=(opening=923.537,from='2026-09-01')=>({version:1,from,opening,basis:'Synthetic signed opening document'});
const clone=value=>structuredClone(value);
function sample(){return {vehicles:[{id:'v',plate:'SYNTHETIC BOUNDARY',org:'A',fuel:'diesel',fuelGrade:'ДТ',norm:10,fuelBalance:100}],records:[{id:'aug-v',vehicleId:'v',date:'2026-08-31',km:0,fuelActual:0,tankMeasured:923.537},{id:'sep-v',vehicleId:'v',date:'2026-09-10',km:10,fuelActual:1}],generators:[{id:'g',name:'Synthetic generator',org:'A',fuel:'diesel',fuelBalance:100,tankId:'t'}],genRecords:[{id:'aug-g',generatorId:'g',date:'2026-08-31',hours:0,fuelIssued:10,fuelActual:0,tankId:null}],tanks:[{id:'t',name:'Synthetic tank',org:'A',fuel:'diesel',balanceInit:1000}],tankIncomes:[{id:'aug-in',tankId:'t',date:'2026-08-20',amount:200},{id:'sep-in',tankId:'t',date:'2026-09-05',amount:10}],fuelMovements:[],drivers:[],assetAssignments:[],fuelPeriods:[],fuelWriteoffs:[]};}
function fixture(t,format,change=()=>{}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-accounting-boundary-')),dir=path.join(root,'db'),input=sample();change(input);const data={...Object.fromEntries(storage.SECTIONS.map(name=>[name,[]])),...input},revisions=Object.fromEntries(storage.SECTIONS.map(name=>[name,1]));
 t.after(()=>{server.stop();assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('tvs-accounting-boundary-'));fs.rmSync(root,{recursive:true,force:true});});
 // Direct fixture creation deliberately preserves old invalid metadata exactly;
 // these are isolated legacy/import snapshots, not ordinary application saves.
 if(format==='sqlite')sqlite.create(dir,{data,revisions});else{fs.mkdirSync(path.join(dir,'sections'),{recursive:true});for(const name of storage.SECTIONS)fs.writeFileSync(storage.sectionFile(dir,name),JSON.stringify(data[name]));fs.writeFileSync(storage.revisionsFile(dir),JSON.stringify(storage.encodeRevisions(revisions)));}
 return {root,dir,data};
}
const snapshot=dir=>storage.readSnapshot(dir);
function save(dir,sections,full=false,principal=admin){const current=snapshot(dir),options={principal,now};return full?storage.writeAll(dir,{...current.data,...sections},{...options,databaseToken:current.databaseToken,base:current.revisions,requireBase:true}):storage.writeSections(dir,{databaseToken:current.databaseToken,base:current.revisions,sections},options);}
function issue(dir,input={},id='boundary-issue'){
 const command={type:'IssueFuel',version:1,input:{tankId:'t',target:{section:'vehicles',id:'v'},date:'2026-09-10',qty:23.537,reason:'Synthetic boundary transfer',...input}},current=snapshot(dir);
 return {protocolVersion:1,databaseToken:current.databaseToken,base:Object.fromEntries(commands.dependencies(command).map(name=>[name,current.revisions[name]])),operation:{id},command};
}
const execute=(dir,payload)=>storage.executeCommand(dir,payload,{principal:admin,now});
const code=expected=>error=>error.code===expected||error.issues?.some(row=>row.code===expected)||error.details?.issues?.some(row=>row.code===expected);
function request(port,route,token,body){return new Promise((resolve,reject)=>{const raw=JSON.stringify(body),req=http.request({host:'127.0.0.1',port,path:route,method:'POST',agent:false,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Content-Length':Buffer.byteLength(raw)}},res=>{let text='';res.setEncoding('utf8');res.on('data',part=>{text+=part;});res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(text),text});}catch(error){reject(error);}});});req.setTimeout(5000,()=>req.destroy(Error('Synthetic boundary HTTP timeout')));req.on('error',reject);req.end(raw);});}

for(const format of ['json','sqlite']){
 test(format+' explicit anchors preserve old opening fields, dated history, typed IDs and exact fractional metadata through full and section channels',t=>{
  const f=fixture(t,format),before=snapshot(f.dir),sections={vehicles:before.data.vehicles.map(row=>({...row,fuelAccounting:{...anchor(),sources:[{org:'A',grade:'ДТ',qty:923.537}]}})),generators:before.data.generators.map(row=>({...row,fuelAccounting:anchor(20)})),tanks:before.data.tanks.map(row=>({...row,fuelAccounting:anchor(100)}))};
  assert.equal(save(f.dir,sections).ok,true);const after=snapshot(f.dir);assert.equal(after.data.vehicles[0].fuelAccounting.opening,923.537);assert.equal(after.data.vehicles[0].fuelBalance,100);assert.equal(after.data.generators[0].fuelBalance,100);assert.equal(after.data.tanks[0].balanceInit,1000);
  for(const name of ['records','genRecords','tankIncomes','fuelMovements','drivers','assetAssignments','fuelPeriods','fuelWriteoffs'])assert.deepEqual(after.data[name],before.data[name],name);
  const full=save(f.dir,{vehicles:after.data.vehicles.map(row=>({...row,note:'Descriptive full edit'}))},true);assert.equal(full.ok,true);assert.deepEqual(snapshot(f.dir).data.vehicles[0].fuelAccounting,sections.vehicles[0].fuelAccounting);assert.equal(Object.hasOwn(snapshot(f.dir).data.generators[0],'accountingStart'),false);
  if(format==='sqlite'){assert.equal(sqlite.inspect(f.dir).formatVersion,1);assert.deepEqual(fs.readdirSync(storage.sectionsDir(f.dir)),['revisions.json']);}
 });

 test(format+' invalid anchors are rejected atomically in every asset section and both ordinary save protocols',t=>{
  const f=fixture(t,format),before=snapshot(f.dir),invalid=[null,{}, {...anchor(),version:2},{...anchor(),from:'2026-02-30'},{...anchor(),opening:'923.537'},{...anchor(),opening:-1},{...anchor(),opening:Infinity},{...anchor(),basis:'   '},{...anchor(),unknown:true},{...anchor(),sources:[]},{...anchor(),sources:[{org:'A',grade:'ДТ',qty:923.5}]}];
  for(const section of ['vehicles','generators','tanks'])for(const value of invalid)for(const full of [false,true]){
   const sections={[section]:before.data[section].map(row=>({...row,fuelAccounting:value}))};assert.throws(()=>save(f.dir,sections,full));assert.deepEqual(snapshot(f.dir),before,section+' '+String(full));
  }
  assert.equal(save(f.dir,{vehicles:before.data.vehicles.map(row=>({...row,fuelAccounting:anchor(0)}))}).ok,true);assert.equal(snapshot(f.dir).data.vehicles[0].fuelAccounting.opening,0);
 });

 test(format+' unchanged malformed legacy anchors remain inspectable and repairable without enabling new dependent fuel facts',t=>{
  const f=fixture(t,format,data=>{for(const section of ['vehicles','generators','tanks'])data[section][0].fuelAccounting={version:99,from:'broken',opening:923.537,basis:'Legacy unrecognized snapshot'};}),before=snapshot(f.dir);
  assert.equal(policy.inspect(before.data).issues.filter(row=>row.code==='FUEL_ACCOUNTING_INVALID').length,3);
  const descriptions={vehicles:before.data.vehicles.map(row=>({...row,note:'Review legacy configuration'})),records:before.data.records.map(row=>({...row,note:'Historical comment stays editable'}))};assert.equal(save(f.dir,descriptions,true).ok,true);const descriptive=snapshot(f.dir);
  for(const section of ['vehicles','generators','tanks'])assert.deepEqual(descriptive.data[section][0].fuelAccounting,before.data[section][0].fuelAccounting);
  assert.throws(()=>execute(f.dir,issue(f.dir)),code('FUEL_ACCOUNTING_CONTEXT_INVALID'));assert.deepEqual(snapshot(f.dir),descriptive);
  assert.throws(()=>save(f.dir,{records:descriptive.data.records.map((row,index)=>index===1?{...row,km:11}:row)}),code('FUEL_ACCOUNTING_CONTEXT_INVALID'));assert.deepEqual(snapshot(f.dir),descriptive);
  const repaired=Object.fromEntries(['vehicles','generators','tanks'].map(section=>[section,descriptive.data[section].map(row=>({...row,fuelAccounting:anchor(100)}))]));assert.equal(save(f.dir,repaired).ok,true);assert.equal(policy.inspect(snapshot(f.dir).data).issues.some(row=>row.code==='FUEL_ACCOUNTING_INVALID'),false);
 });

 test(format+' tank stock uses explicit opening and subsequent events, including future deficit checks, instead of earlier history',t=>{
  const f=fixture(t,format,data=>{data.tanks[0].fuelAccounting=anchor(100);data.fuelMovements=[{id:'future-out',date:'2026-09-20',kind:'issue',fromTankId:'t',toTankId:'',qty:100,reason:'Future synthetic external issue'}];}),before=snapshot(f.dir);
  assert.throws(()=>execute(f.dir,issue(f.dir,{qty:15})),code('FUEL_STOCK_DEFICIT'));assert.deepEqual(snapshot(f.dir),before);
  assert.equal(execute(f.dir,issue(f.dir,{qty:10})).ok,true);const after=snapshot(f.dir);assert.equal(after.data.tanks[0].balanceInit,1000);assert.equal(after.data.tanks[0].fuelAccounting.opening,100);assert.equal(after.data.fuelMovements.length,2);assert.equal(after.data.records.at(-1).fuelIssued,10);
 });

 test(format+' activating a boundary leaves old linked issues intact while new or materially changed pre-boundary movements reject',t=>{
  const f=fixture(t,format);assert.equal(execute(f.dir,issue(f.dir,{date:'2026-08-20',qty:20},'historical-issue')).ok,true);const old=snapshot(f.dir);
  assert.equal(save(f.dir,{tanks:old.data.tanks.map(row=>({...row,fuelAccounting:anchor(100)})),vehicles:old.data.vehicles.map(row=>({...row,fuelAccounting:anchor(923.537)}))}).ok,true);const current=snapshot(f.dir);assert.deepEqual(current.data.fuelMovements,old.data.fuelMovements);assert.deepEqual(current.data.records,old.data.records);
  assert.throws(()=>execute(f.dir,issue(f.dir,{date:'2026-08-21'},'new-history')),code('FUEL_BEFORE_ACCOUNTING'));assert.deepEqual(snapshot(f.dir),current);
  const incoming={id:'new-old-receipt',date:'2026-08-31',kind:'receipt',fromTankId:'',toTankId:'t',qty:1,reason:'Synthetic old new receipt'};assert.throws(()=>save(f.dir,{fuelMovements:[...current.data.fuelMovements,incoming]}),code('FUEL_BEFORE_ACCOUNTING'));assert.deepEqual(snapshot(f.dir),current);
  assert.throws(()=>save(f.dir,{fuelMovements:current.data.fuelMovements.map(row=>({...row,qty:21}))},true),/Проведённое движение неизменяемо/);assert.deepEqual(snapshot(f.dir),current);
  assert.throws(()=>policy.validateChanges(current.data,{...current.data,fuelMovements:current.data.fuelMovements.map(row=>({...row,qty:21}))}),code('FUEL_BEFORE_ACCOUNTING'));
  assert.equal(save(f.dir,{records:current.data.records.map((row,index)=>index===0?{...row,km:1}:row)}).ok,true,'Historical mileage entry remains independent of fuel accounting start');
 });

 test(format+' both source and recipient accounting dates constrain a new semantic issue',t=>{
  const f=fixture(t,format,data=>{data.tanks[0].fuelAccounting=anchor(100,'2026-09-01');data.vehicles[0].fuelAccounting=anchor(0,'2026-10-01');}),before=snapshot(f.dir);
  assert.throws(()=>execute(f.dir,issue(f.dir,{date:'2026-09-10'})),code('FUEL_BEFORE_ACCOUNTING'));assert.deepEqual(snapshot(f.dir),before);
  assert.equal(execute(f.dir,issue(f.dir,{date:'2026-10-01'})).ok,true);
 });

 test(format+' closed periods protect anchor addition, change and removal through section/full writes without property-order false conflicts',t=>{
  const f=fixture(t,format,data=>{for(const section of ['vehicles','generators','tanks'])data[section][0].fuelAccounting=anchor(100);data.fuelPeriods=[{month:'2026-09',closed:true}];}),before=snapshot(f.dir);
  for(const section of ['vehicles','generators','tanks'])for(const change of ['from','opening','basis','remove'])for(const full of [false,true]){
   const row=clone(before.data[section][0]);if(change==='remove')delete row.fuelAccounting;else row.fuelAccounting[change]=change==='opening'?100.001:change==='from'?'2026-10-01':'Changed basis';
   assert.throws(()=>save(f.dir,{[section]:[row]},full),/Месяц закрыт/);assert.deepEqual(snapshot(f.dir),before);
  }
  const reordered=Object.fromEntries(Object.entries(anchor(100)).reverse());assert.equal(save(f.dir,{vehicles:[{...before.data.vehicles[0],fuelAccounting:reordered,note:'Closed-period descriptive edit'}]},true).ok,true);
  const legacy=fixture(t,format,data=>{data.fuelPeriods=[{month:'2026-09',closed:true}];}),initial=snapshot(legacy.dir);assert.throws(()=>save(legacy.dir,{vehicles:initial.data.vehicles.map(row=>({...row,fuelAccounting:anchor()}))}),/Месяц закрыт/);assert.deepEqual(snapshot(legacy.dir),initial);
 });

 test(format+' asset ACL forbids a mechanic from changing anchors while dispatcher retains ordinary card ownership',t=>{
  const f=fixture(t,format),before=snapshot(f.dir),next={vehicles:before.data.vehicles.map(row=>({...row,fuelAccounting:anchor()}))};assert.throws(()=>save(f.dir,next,false,{id:'boundary-mechanic',name:'Mechanic',role:'mechanic'}),code('ACCESS_DENIED'));assert.deepEqual(snapshot(f.dir),before);
  assert.equal(save(f.dir,next,false,{id:'boundary-dispatcher',name:'Dispatcher',role:'dispatcher'}).ok,true);
 });

 test(format+' posted writeoff fingerprint protects adding, changing and removing an anchor without rewriting frozen snapshots',t=>{
  for(const explicit of [false,true]){
   const f=fixture(t,format,data=>{
    data.records=data.records.filter(row=>row.date>='2026-09-01');if(explicit)data.vehicles[0].fuelAccounting=anchor(100);
    const request={month:'2026-09',org:'A',grade:'ДТ',date:'2026-10-01',basisNote:'Synthetic posted basis'},preview=writeoff.prepare(data,request);assert.equal(preview.canPost,true,JSON.stringify(preview.issues));
    data.fuelWriteoffs=[writeoff.post(data,request,{id:'boundary-posted',number:'Synthetic-1',postedAt:now,postedBy:admin,expectedFingerprint:preview.sourceFingerprint})];
   }),before=snapshot(f.dir);
   for(const full of [false,true])for(const change of ['add-or-change','remove']){
    if(!explicit&&change==='remove')continue;const vehicle=clone(before.data.vehicles[0]);if(change==='remove')delete vehicle.fuelAccounting;else vehicle.fuelAccounting=anchor(100.001);
    assert.throws(()=>save(f.dir,{vehicles:[vehicle]},full),code('POSTED_SOURCE_LOCKED'));assert.deepEqual(snapshot(f.dir),before);
   }
   const frozen=before.data.fuelWriteoffs[0];assert.equal(save(f.dir,{vehicles:[{...before.data.vehicles[0],note:'Descriptive field outside frozen source projection'}]}).ok,true);assert.deepEqual(snapshot(f.dir).data.fuelWriteoffs[0],frozen);
  }
 });

 test('HTTP '+format+' raw section/full and command protocols share metadata, ACL, period and date guards',async t=>{
  const f=fixture(t,format),tokens={admin:'synthetic-boundary-admin-token-123456',mechanic:'synthetic-boundary-mechanic-token-123456'},users=Object.keys(tokens).map(role=>({id:'boundary-'+role,name:'Synthetic '+role,role,enabled:true,tokenHash:access.hashToken(tokens[role])}));let backups=0;
  const started=await server.start({port:0,dataDir:f.dir,settings:{serverAccessConfigured:true,serverUsers:access.normalizeServerUsers(users)},backupFn:()=>{backups++;}});assert.equal(started.ok,true);
  const before=snapshot(f.dir);for(const route of ['/api/sections','/api/data']){const rows=before.data.vehicles.map(row=>({...row,fuelAccounting:{...anchor(),opening:'923.537'}})),payload={databaseToken:before.databaseToken,base:before.revisions,...(route==='/api/data'?{data:{...before.data,vehicles:rows}}:{sections:{vehicles:rows}})};const result=await request(started.port,route,tokens.admin,payload);assert.equal(result.status,400,result.text);assert.equal(result.body.ok,false);assert.deepEqual(snapshot(f.dir),before);}
  const current=snapshot(f.dir),metadata={vehicles:current.data.vehicles.map(row=>({...row,fuelAccounting:anchor(0,'2026-10-01')})),tanks:current.data.tanks.map(row=>({...row,fuelAccounting:anchor(100)}))};
  const denied=await request(started.port,'/api/sections',tokens.mechanic,{databaseToken:current.databaseToken,base:current.revisions,sections:{vehicles:metadata.vehicles}});assert.equal(denied.status,403);assert.deepEqual(snapshot(f.dir),current);
  const accepted=await request(started.port,'/api/sections',tokens.admin,{databaseToken:current.databaseToken,base:current.revisions,sections:metadata});assert.equal(accepted.status,200,accepted.text);const anchored=snapshot(f.dir),command=await request(started.port,'/api/commands',tokens.admin,issue(f.dir));assert.equal(command.status,400,command.text);assert.equal(command.body.ok,false);assert.deepEqual(snapshot(f.dir),anchored);
  const raw={id:'http-prestart',date:'2026-08-31',kind:'receipt',fromTankId:'',toTankId:'t',qty:1,reason:'Synthetic raw prestart'};const rejected=await request(started.port,'/api/sections',tokens.admin,{databaseToken:anchored.databaseToken,base:anchored.revisions,sections:{fuelMovements:[raw]}});assert.equal(rejected.status,400,rejected.text);assert.deepEqual(snapshot(f.dir),anchored);
  const closed=snapshot(f.dir);assert.equal(save(f.dir,{fuelPeriods:[{month:'2026-10',closed:true}]}).ok,true);const sealed=snapshot(f.dir),blocked=await request(started.port,'/api/data',tokens.admin,{databaseToken:sealed.databaseToken,base:sealed.revisions,data:{...sealed.data,vehicles:sealed.data.vehicles.map(row=>({...row,fuelAccounting:{...row.fuelAccounting,opening:1}}))}});assert.equal(blocked.status,400,blocked.text);assert.deepEqual(snapshot(f.dir),sealed);assert.ok(backups>=1);assert.equal(closed.data.records.length,sealed.data.records.length);
 });
}

test('accounting tank-flow projection filters signed legs before netting tanks with different start dates while raw history remains exact',()=>{
 const data={tanks:[{id:7,fuelAccounting:anchor(100,'2026-09-01')},{id:'7',fuelAccounting:anchor(20,'2026-10-01')}],tankIncomes:[{id:'old',tankId:7,date:'2026-08-20',amount:5},{id:'old-out',tankId:7,date:'2026-09-03',amount:-2},{id:'future-owner',tankId:'7',date:'2026-09-03',amount:3}],fuelMovements:[{id:'transfer',date:'2026-09-15',kind:'transfer',fromTankId:7,toTankId:'7',qty:23.537,reason:'Synthetic cross-boundary transfer'},{id:'transfer-after',date:'2026-10-15',kind:'transfer',fromTankId:7,toTankId:'7',qty:4},{id:'reversal',date:'2026-09-20',kind:'adjustment',fromTankId:'7',toTankId:7,qty:23.537,originalMovementId:'transfer'},{id:'cancelled',date:'2026-09-16',fromTankId:7,qty:900,cancelled:true}]},before=JSON.stringify(data);
 const raw=sources.projectTankFlows(data,[7,'7']);assert.deepEqual(raw.map(row=>[row.sourceId,row.amount]),[['old',5],['future-owner',3],['old-out',-2]]);
 const accounting=sources.projectTankFlows(data,[7,'7'],{accounting:true});assert.deepEqual(accounting.map(row=>[row.sourceId,row.amount]),[['old-out',-2],['transfer',-23.537],['reversal',23.537]]);assert.equal(accounting.reduce((sum,row)=>sum+row.amount,0),-2);
 assert.deepEqual(sources.projectTankFlows(data,['7'],{accounting:true,to:'2026-09-30'}),[]);assert.equal(sources.projectTankFlows(data,['7'],{accounting:true,from:'2026-10-01'})[0].amount,4);assert.equal(JSON.stringify(data),before);
});

test('raw financial projections retain pre-boundary costs and do not require accounting metadata to be valid',()=>{
 const data={vehicles:[{id:'v',fuelAccounting:null}],tanks:[{id:'t',fuelAccounting:null}],repairs:[{id:'old-repair',vehicleId:'v',invoiceDate:'2026-08-01',cost:10000}],payments:[{id:'old-payment',date:'2026-08-01',sum:10000}],fuelPurchases:[{id:'old-purchase',date:'2026-08-01',qty:100,sum:5000}],tankIncomes:[{id:'old-in',tankId:'t',date:'2026-08-01',amount:100}]},before=JSON.stringify(data);
 assert.equal(sources.projectFinancialSources(data).sources[0].sum,10000);assert.equal(sources.projectTankFlows(data,['t'])[0].amount,100);assert.throws(()=>sources.projectTankFlows(data,['t'],{accounting:true}),{code:'INVALID_ACCOUNTING_BOUNDARY'});assert.equal(JSON.stringify(data),before);
});

test('accounting flow projection fails closed for selected invalid metadata or a missing helper, retaining legacy/raw compatibility',()=>{
 const file=path.join(__dirname,'../assets/core/financial-recognition.js'),context=vm.createContext({});vm.runInContext(fs.readFileSync(file,'utf8'),context,{filename:file});const legacy={tanks:[{id:'t'}],tankIncomes:[{id:'in',tankId:'t',date:'2026-09-01',amount:1}]};assert.equal(context.DomainSources.projectTankFlows(legacy,['t'],{accounting:true})[0].amount,1);
 const explicit={...legacy,tanks:[{id:'t',fuelAccounting:anchor(0)}]};assert.equal(context.DomainSources.projectTankFlows(explicit,['t'])[0].amount,1);assert.throws(()=>context.DomainSources.projectTankFlows(explicit,['t'],{accounting:true}),{code:'MODULE_UNAVAILABLE'});
 const bad={...legacy,tanks:[{id:'t',fuelAccounting:null},{id:'unselected',fuelAccounting:anchor()}]};assert.throws(()=>sources.projectTankFlows(bad,['t'],{accounting:true}),{code:'INVALID_ACCOUNTING_BOUNDARY'});assert.deepEqual(sources.projectTankFlows(bad,['unselected'],{accounting:true}),[]);assert.throws(()=>sources.projectTankFlows(legacy,['t'],{accounting:'true'}),TypeError);
});
