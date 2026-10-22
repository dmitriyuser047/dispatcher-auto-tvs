'use strict';
const {writerHeaders}=require('./helpers/http-writer.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const storage=require('../electron/storage'),sqlite=require('../electron/sqlite-storage.cjs'),server=require('../electron/server'),access=require('../electron/access-control');
const schema=require('../assets/core/platform-schema.js'),kernel=require('../assets/core/platform-kernel.js'),commands=require('../assets/core/platform-commands.js'),writeoff=require('../assets/core/writeoff-engine.js');
const principal={id:'precision-admin',name:'Synthetic precision admin',role:'admin'},now='2026-10-22T12:00:00.000Z',code=expected=>error=>!!(error.code===expected||error.issues?.some(row=>row.code===expected)||error.details?.issues?.some(row=>row.code===expected));
function rawWrite(dir,sections){require('./period-test-support.cjs').seedSections(dir,sections);}
function fixture(t,format,change=()=>{}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-precision-')),dir=path.join(root,'db'),data=Object.fromEntries(schema.sections.map(name=>[name,[]]));
 Object.assign(data,{vehicles:[{id:'v',plate:'SYNTHETIC PRECISION',org:'A',fuel:'diesel',fuelGrade:'ДТ',fuelBalance:923.537,norm:10}],records:[{id:'r',vehicleId:'v',date:'2026-09-10',km:100,fuelActual:10}],tanks:[{id:'t',name:'Synthetic tank',org:'A',fuel:'diesel',balanceInit:1000}],costEntries:[{id:'legacy',date:'2026-09-10',assetRef:'v:v',kind:'expense',amount:0.105,title:'Legacy primary amount',independent:true}],payments:[{id:'secret',date:'2026-09-10',sum:998877.6655,description:'PRIVATE-PRECISION-FACT'}]});
 const revisions=Object.fromEntries(schema.sections.map(name=>[name,1])),initialized=require('./helpers/literal-history25-seed.cjs').seedWithLiteralHistory(dir,format,{data,revisions,prepare:context=>change(data,context)});
 t.after(()=>{server.stop();assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('tvs-precision-'));fs.rmSync(root,{recursive:true,force:true});});return {dir,prepared:initialized.prepared};
}
function save(dir,sections,full=false,id){const old=storage.readSnapshot(dir),options={principal,now,...(id?{operation:{id}}:{})};return full?storage.writeAll(dir,{...old.data,...sections},{...options,databaseToken:old.databaseToken,base:old.revisions,requireBase:true}):storage.writeSections(dir,{databaseToken:old.databaseToken,base:old.revisions,sections,...(id?{operation:{id}}:{})},options);}
function issue(dir,qty=23.537,id='precision-command',source){const old=source||storage.readSnapshot(dir),command={type:'IssueFuel',version:1,input:{tankId:'t',target:{section:'vehicles',id:'v'},date:'2026-09-10',qty,reason:'Synthetic precision transfer'}};return {protocolVersion:1,databaseToken:old.databaseToken,base:Object.fromEntries(commands.dependencies(command).map(name=>[name,old.revisions[name]])),command,operation:{id}};}
function literalReceipt(payload,changed,revisions){return {id:'operation:'+payload.operation.id,type:'transaction',action:'transaction',source:'platform',section:'auditLog',recordId:payload.operation.id,operationId:payload.operation.id,requestDigest:kernel.requestDigest(payload),databaseToken:payload.databaseToken,at:'2026-09-01T00:00:00.000Z',actor:principal.name,actorId:principal.id,actorRole:principal.role,changedSections:changed,revisions};}
async function post(port,route,token,payload){
 const currentBody=typeof payload==='string'?payload:JSON.stringify(payload);
 const proofHeaders=await writerHeaders({host:'127.0.0.1',port:port,headers:{Authorization:'Bearer '+token},method:'POST'});
return new Promise((resolve,reject)=>{const raw=typeof payload==='string'?payload:currentBody,req=http.request({host:'127.0.0.1',port,path:route,method:'POST',agent:false,headers:{...proofHeaders,Authorization:'Bearer '+token,'Content-Type':'application/json','Content-Length':Buffer.byteLength(raw)}},res=>{let text='';res.setEncoding('utf8');res.on('data',part=>{text+=part;});res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(text),text});}catch(error){reject(error);}});});req.setTimeout(5000,()=>req.destroy(Error('Synthetic precision timeout')));req.on('error',reject);req.end(raw);});}

for(const format of ['json','sqlite']){
 test(format+' field precision is atomic across ordinary full and section writes while old extra-precision comments preserve facts',t=>{
  const {dir}=fixture(t,format),before=storage.readSnapshot(dir);
  const changes=[{records:before.data.records.map(row=>({...row,km:100.0001}))},{vehicles:before.data.vehicles.map(row=>({...row,norm:10.0000001}))},{costEntries:[...before.data.costEntries,{id:'bad',date:'2026-09-11',assetRef:'v:v',kind:'expense',amount:0.005,title:'New amount',independent:true}]},{payments:before.data.payments.map(row=>({...row,sum:1e12+0.01}))}];
  for(const full of [false,true])for(const sections of changes){assert.throws(()=>save(dir,sections,full),code('PRECISION_VIOLATION'));assert.deepEqual(storage.readSnapshot(dir),before);}
  assert.equal(save(dir,{costEntries:before.data.costEntries.map(row=>({...row,note:'Descriptive edit'}))},true).ok,true);assert.equal(storage.readSnapshot(dir).data.costEntries[0].amount,0.105);assert.deepEqual(storage.readSnapshot(dir).data.payments,before.data.payments);
  const current=storage.readSnapshot(dir);assert.equal(save(dir,{records:current.data.records.map(row=>({...row,km:923.537,fuelActual:0.001})),costEntries:[...current.data.costEntries,{id:'valid',date:'2026-09-11',assetRef:'v:v',kind:'expense',amount:1.01,title:'Valid cents',independent:true}]}).ok,true);assert.equal(storage.readSnapshot(dir).data.records[0].km,923.537);
 });

 test(format+' exact source allocations conserve 923.537 and legacy mismatches remain editable without silent repair',t=>{
  const {dir}=fixture(t,format,data=>{data.vehicles[0].fuelAccounting={version:1,from:'2026-09-01',opening:1,basis:'Historical anchor',sources:[{org:'A',grade:'ДТ',qty:1.001}]};}),before=storage.readSnapshot(dir);
  assert.equal(save(dir,{vehicles:before.data.vehicles.map(row=>({...row,note:'Inspect old mismatch'}))}).ok,true);const current=storage.readSnapshot(dir);
  assert.throws(()=>save(dir,{vehicles:current.data.vehicles.map(row=>({...row,fuelAccounting:{...row.fuelAccounting,sources:[{org:'B',grade:'ДТ',qty:1.001}]}}))}),code('NUMERIC_ALLOCATION_TOTAL'));assert.deepEqual(storage.readSnapshot(dir),current);
  assert.equal(save(dir,{vehicles:current.data.vehicles.map(row=>({...row,fuelAccounting:{...row.fuelAccounting,opening:923.537,sources:[{org:'A',grade:'ДТ',qty:923},{org:'B',grade:'ДТ',qty:0.537}]}}))}).ok,true);
 });

 test(format+' semantic fuel commands reject fourth-decimal input before all business, audit and receipt writes',t=>{
  const {dir}=fixture(t,format),before=storage.readSnapshot(dir);let backups=0;
  assert.throws(()=>storage.executeCommand(dir,issue(dir,23.5371),{principal,now,beforeCommit:()=>{backups++;}}),code('NUMERIC_PRECISION'));assert.deepEqual(storage.readSnapshot(dir),before);assert.equal(backups,0);
  const accepted=storage.executeCommand(dir,issue(dir),{principal,now,beforeCommit:()=>{backups++;}});assert.equal(accepted.ok,true);assert.equal(accepted.canonicalSections.records.at(-1).fuelIssued,23.537);assert.equal(accepted.canonicalSections.fuelMovements[0].qty,23.537);assert.equal(backups,1);
 });

 test(format+' committed historical raw and semantic intents replay before newly stricter precision, stale bases and replanning',t=>{
  const {dir,prepared}=fixture(t,format,(data,context)=>{data.records=data.records.map(row=>({...row,fuelActual:10.0001}));const raw={databaseToken:context.databaseToken,base:context.revisions,sections:{records:data.records},operation:{id:'old-raw-intent'}},semantic=issue(null,23.5371,'old-command-intent',{databaseToken:context.databaseToken,revisions:context.revisions,data});data.auditLog=[literalReceipt(raw,['records'],context.revisions),literalReceipt(semantic,['records','fuelMovements'],context.revisions)];const signed=payload=>({...payload,operation:{id:payload.operation.id,digest:kernel.requestDigest(payload)}});return{raw:signed(raw),semantic:signed(semantic)};}),before=storage.readSnapshot(dir);let backups=0;
  const result=storage.writeSections(dir,prepared.raw,{principal,now,beforeCommit:()=>{backups++;}});assert.equal(result.replayed,true);assert.equal(result.canonicalSections.records[0].fuelActual,10.0001);assert.deepEqual(storage.readSnapshot(dir),before);assert.equal(backups,0);
  const semantic=prepared.semantic,recorded=storage.readSnapshot(dir),replayed=storage.executeCommand(dir,semantic,{principal,now:'invalid-after-receipt',beforeCommit:()=>{backups++;}});assert.equal(replayed.replayed,true);assert.deepEqual(storage.readSnapshot(dir),recorded);assert.equal(backups,0);
  assert.throws(()=>storage.executeCommand(dir,{...semantic,operation:{id:'new-strict-intent'}},{principal,now}),code('NUMERIC_PRECISION'));assert.deepEqual(storage.readSnapshot(dir),recorded);
 });

 test(format+' new writeoffs use the current canonical version and saved v1 snapshots stay byte-exact through unrelated fact comments',t=>{
  const {dir}=fixture(t,format),old=storage.readSnapshot(dir),request={month:'2026-09',org:'A',grade:'ДТ',date:'2026-10-01',basisNote:'Synthetic'};
  const modern=writeoff.prepare(old.data,request),draft=writeoff.post(old.data,request,{id:'modern-act',number:'Synthetic-current',postedAt:now,postedBy:principal,expectedFingerprint:modern.sourceFingerprint});assert.equal(save(dir,{fuelWriteoffs:[draft]}).ok,true);const current=storage.readSnapshot(dir);assert.equal(current.data.fuelWriteoffs[0].calculationVersion,writeoff.calculationVersion);assert.deepEqual(current.data.records,old.data.records);
  const {dir:legacyDir}=fixture(t,format),legacy=storage.readSnapshot(legacyDir),v1=writeoff.forVersion(1),preview=v1.prepare(legacy.data,request),doc=v1.post(legacy.data,request,{id:'legacy-act',number:'Synthetic-1',postedAt:now,postedBy:principal,expectedFingerprint:preview.sourceFingerprint});rawWrite(legacyDir,{fuelWriteoffs:[doc]},legacy.revisions);const saved=JSON.stringify(storage.readSnapshot(legacyDir).data.fuelWriteoffs);assert.equal(save(legacyDir,{vehicles:legacy.data.vehicles.map(row=>({...row,note:'Unrelated description'}))}).ok,true);assert.equal(JSON.stringify(storage.readSnapshot(legacyDir).data.fuelWriteoffs),saved);
 });

 test('HTTP '+format+' full, sections and commands share precision refusal and never disclose hidden financial legacy issues',async t=>{
  const {dir}=fixture(t,format),tokens={admin:'synthetic-precision-admin-123456789',dispatcher:'synthetic-precision-dispatcher-123456789'},users=Object.keys(tokens).map(role=>({id:role==='admin'?principal.id:'precision-dispatcher',name:'Synthetic '+role,role,enabled:true,tokenHash:access.hashToken(tokens[role])}));const started=await server.start({port:0,dataDir:dir,settings:{serverAccessConfigured:true,serverUsers:access.normalizeServerUsers(users)},backupFn:()=>{}});assert.equal(started.ok,true);const old=storage.readSnapshot(dir);
  for(const route of ['/api/sections','/api/data']){const sections={records:old.data.records.map(row=>({...row,km:0.0001}))},payload={databaseToken:old.databaseToken,base:old.revisions,...(route.endsWith('/data')?{data:{...old.data,...sections}}:{sections})};const result=await post(started.port,route,tokens.admin,payload);assert.equal(result.status,400,result.text);assert.equal(result.body.ok,false);assert.equal(result.body.code,'PRECISION_VIOLATION');assert.deepEqual(storage.readSnapshot(dir),old);}
  const bad=await post(started.port,'/api/commands',tokens.dispatcher,issue(dir,0.0001));assert.equal(bad.status,400,bad.text);assert.doesNotMatch(bad.text,/PRIVATE-PRECISION-FACT|998877/);assert.deepEqual(storage.readSnapshot(dir),old);
  const malformedBody=JSON.stringify({databaseToken:old.databaseToken,base:old.revisions,sections:{records:[{id:'raw',km:'NONFINITE_SENTINEL'}]}}).replace('"NONFINITE_SENTINEL"','1e400'),malformed=await post(started.port,'/api/sections',tokens.admin,malformedBody);assert.equal(malformed.status,400);assert.deepEqual(storage.readSnapshot(dir),old);
 });
}
