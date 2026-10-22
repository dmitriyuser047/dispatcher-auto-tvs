const {writerHeaders}=require('./helpers/http-writer.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),vm=require('node:vm');
const storage=require('../electron/storage'),access=require('../electron/access-control'),server=require('../electron/server');
const root=path.resolve(__dirname,'..');
const planning=['costEntries','costProfiles','procurementOrders','procurementRules'];
const {seedSections}=require('./period-test-support.cjs');
function temp(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-planning-integration-'));t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('tvs-planning-integration-'));fs.rmSync(dir,{recursive:true,force:true});});return dir;}
function db(){return {vehicles:[{id:'v',plate:'TEST'}],records:[{id:'r',vehicleId:'v',date:'2026-10-01',km:100}],tanks:[{id:'t',name:'Test tank',balanceInit:100}],parts:[{id:'p',name:'Test part'}],costEntries:[{id:'cost',date:'2026-10-01',assetRef:'v:v',kind:'expense',amount:100,title:'Synthetic independent cost',category:'Прочее',independent:true}],costProfiles:[{id:'profile',assetRef:'v:v',salaryRate:5,fuelRate:10,fuelPrice:60}]};}
function order(){return {id:'o',kind:'tank',itemId:'t',supplier:'Test supplier',quantity:100,receivedQty:20,stockPostedQty:0,deliveryDate:'2026-10-20',status:'partial',note:''};}
function rule(){return {id:'rule',kind:'tank',itemId:'t',leadDays:3,reserveQty:50,coverDays:7,expectedDaily:10};}

test('planning data survives partial legacy saves, revision conflicts and daily backup',t=>{
 const dir=temp(t);storage.writeAll(dir,db());
 seedSections(dir,{procurementOrders:[order()]});
 const sections={procurementOrders:[{...order(),note:'Reviewed historical description'}],procurementRules:[rule()]};
 const baseline=storage.readRevisions(dir),token=storage.databaseToken(dir);
 assert.equal(storage.writeSections(dir,{base:baseline,sections,databaseToken:token}).ok,true);
 const stale=storage.writeSections(dir,{base:baseline,sections:{procurementOrders:[]},databaseToken:token});
 assert.equal(stale.ok,false);assert.deepEqual(stale.conflicts,['procurementOrders']);
 storage.writeAll(dir,{vehicles:db().vehicles,records:db().records});
 const restored=storage.readAll(dir);assert.deepEqual(restored.procurementOrders,sections.procurementOrders);assert.deepEqual(restored.procurementRules,sections.procurementRules);
 assert.deepEqual(restored.costEntries,db().costEntries);assert.deepEqual(restored.costProfiles,db().costProfiles);
 const backup=storage.makeDailyBackup(dir,path.join(dir,'backups'),30);
 assert.deepEqual(JSON.parse(fs.readFileSync(backup,'utf8')).procurementOrders,sections.procurementOrders);
 assert.equal(restored.tanks[0].balanceInit,100);assert.deepEqual(restored.tankIncomes,[]);assert.deepEqual(restored.partMovements,[]);
});

test('older split databases gain empty planning sections without changing journal revisions',t=>{
 const dir=temp(t);fs.mkdirSync(storage.sectionsDir(dir));
 fs.writeFileSync(storage.sectionFile(dir,'vehicles'),JSON.stringify(db().vehicles));fs.writeFileSync(storage.sectionFile(dir,'records'),JSON.stringify(db().records));
 fs.writeFileSync(storage.revisionsFile(dir),JSON.stringify({vehicles:4,records:7}));
 const loaded=storage.readAll(dir);for(const name of planning)assert.deepEqual(loaded[name],[]);
 assert.equal(storage.readRevisions(dir).records,7);assert.equal(loaded.records[0].km,100);
 for(const [file,symbol]of [['assets/js/25f-sync.js','SYNC_SECTIONS'],['assets/js/30-workflows.js','WF_SECTIONS']]){
  const source=fs.readFileSync(path.join(root,file),'utf8'),match=source.match(new RegExp('const '+symbol+' = ([\\s\\S]*?);'));
  assert.ok(match,file);const sections=vm.runInNewContext(match[1],{PlatformSchema:require('../assets/core/platform-schema.js')});for(const name of planning)assert.ok(sections.includes(name),file+': '+name);
  if(symbol==='SYNC_SECTIONS')assert.deepEqual(Array.from(sections),storage.SECTIONS);
 }
});

test('backend rejects malformed orders atomically and blocks new orders for archived items',t=>{
 const dir=temp(t);storage.writeAll(dir,db());
 for(const invalid of [{...order(),quantity:-1},{...order(),receivedQty:101},{...order(),stockPostedQty:21},{...order(),deliveryDate:'2026-02-30'},{...order(),status:'anything'},{...order(),itemId:'missing'}]){
  assert.throws(()=>storage.writeSections(dir,{base:storage.readRevisions(dir),sections:{procurementOrders:[invalid],procurementRules:[rule()]}}));
  assert.deepEqual(storage.readAll(dir).procurementRules,[]);
 }
 seedSections(dir,{procurementOrders:[order()]});
 storage.writeSections(dir,{base:storage.readRevisions(dir),sections:{tanks:[{...db().tanks[0],archived:true}]}});
 assert.throws(()=>storage.writeSections(dir,{base:storage.readRevisions(dir),sections:{procurementOrders:[order(),{...order(),id:'new'}]}}));
 const operations=require('../assets/core/procurement-operations'),current=storage.readSnapshot(dir),input={action:'saveOrder',payload:{kind:'tank',itemId:'t',supplier:'Test supplier',quantity:100,deliveryDate:'2026-10-22',status:'ordered',note:''},reason:'Explicit new order for an archived item'},preview=operations.preview(current.data,input,{today:'2026-10-22'});
 assert.equal(preview.canApply,false);assert.ok(preview.issues.some(issue=>issue.code==='PROCUREMENT_ITEM_ARCHIVED'));
 const described={...order(),note:'Archive preserves the existing order and its original claimed counters'};
 assert.equal(storage.writeSections(dir,{base:storage.readRevisions(dir),sections:{procurementOrders:[described]}}).ok,true);
 assert.equal(storage.readAll(dir).procurementOrders[0].receivedQty,20);
 assert.equal(storage.readAll(dir).tanks[0].balanceInit,100);
});

test('costs are financial while operational roles can manage nonfinancial purchase orders',()=>{
 for(const role of ['dispatcher','mechanic'])for(const name of ['costEntries','costProfiles']){
  assert.equal(access.authorize({role},'read',name),false);assert.equal(access.authorize({role},'write',name),false);
 }
 for(const role of ['dispatcher','mechanic','accountant'])for(const name of ['procurementOrders','procurementRules'])assert.equal(access.authorize({role},'write',name),true);
 for(const name of planning){assert.equal(access.authorize({role:'viewer'},'write',name),false);assert.equal(access.authorize({role:'viewer'},'read',name),true);assert.equal(access.authorize({role:'admin'},'write',name),true);}
 assert.equal(access.authorize({role:'accountant'},'write','costEntries'),true);
});

test('malformed financial rows cannot be persisted alongside valid procurement changes',t=>{
 const dir=temp(t);storage.writeAll(dir,db());
 seedSections(dir,{procurementOrders:[order()]});
 for(const entry of [{...db().costEntries[0],amount:-1},{...db().costEntries[0],amount:NaN},{...db().costEntries[0],date:'2026-02-30'},{...db().costEntries[0],assetRef:'v:missing'},{...db().costEntries[0],independent:false}]){
  assert.throws(()=>storage.writeSections(dir,{base:storage.readRevisions(dir),sections:{costEntries:[entry],procurementOrders:[{...order(),note:'A valid descriptive change in the same rejected batch'}]}}));
  assert.deepEqual(storage.readAll(dir).procurementOrders,[order()]);assert.equal(storage.readAll(dir).costEntries[0].amount,100);
 }
});

function request(port,token,route,body){return new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port,path:route,method:body?'POST':'GET',headers:{...writerHeaders(),Authorization:'Bearer '+token}},res=>{let text='';res.setEncoding('utf8');res.on('data',chunk=>text+=chunk);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(text)});}catch(error){reject(error);}});});req.on('error',reject);req.end(body?JSON.stringify(body):undefined);});}

test('HTTP roles cannot bypass planning validation or write financial costs as dispatcher',async t=>{
 const dir=temp(t);storage.writeAll(dir,db());
 seedSections(dir,{procurementOrders:[order()]});
 const tokens={dispatcher:access.issueToken(),accountant:access.issueToken(),viewer:access.issueToken()};
 const admin=access.issueToken();const settings={serverAccessConfigured:true,serverUsers:[...Object.entries(tokens).map(([role,token])=>({id:role,name:role,role,enabled:true,tokenHash:token.tokenHash})),{id:'admin',name:'Admin',role:'admin',enabled:true,tokenHash:admin.tokenHash}]};
 const started=await server.start({port:0,dataDir:dir,settings:()=>settings});assert.equal(started.ok,true);t.after(()=>server.stop());
 const token=storage.databaseToken(dir),port=started.port;
 const snapshot=await request(port,tokens.dispatcher.token,'/api/snapshot');
 assert.deepEqual(snapshot.body.data.costEntries,[]);assert.equal(snapshot.body.access.readable.includes('costEntries'),false);
 const financial=await request(port,tokens.accountant.token,'/api/snapshot');assert.equal(financial.body.data.costEntries[0].amount,100);
 const payload=sections=>({databaseToken:token,base:storage.readRevisions(dir),sections});
 assert.equal((await request(port,tokens.dispatcher.token,'/api/sections',payload({costEntries:[]}))).status,403);
 assert.equal((await request(port,tokens.viewer.token,'/api/sections',payload({procurementOrders:[{...order(),note:'A viewer cannot write this descriptive field'}]}))).status,403);
 assert.equal((await request(port,tokens.dispatcher.token,'/api/sections',payload({procurementOrders:[{...order(),receivedQty:1000}]}))).status,400);
 assert.equal((await request(port,tokens.dispatcher.token,'/api/sections',payload({procurementOrders:[{...order(),note:'Reviewed legacy description'}],procurementRules:[rule()]}))).status,200);
 assert.equal(storage.readAll(dir).procurementOrders[0].receivedQty,20);
 assert.ok(storage.readAll(dir).auditLog.some(row=>row.section==='procurementOrders'&&row.actorId==='dispatcher'));
});
