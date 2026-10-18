const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const storage=require('../electron/storage'),history=require('../electron/change-history');
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-history-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));storage.writeAll(dir,{vehicles:[{id:'v',driver:'A'}],records:[]},{actor:'Seed'});return dir;}
test('history records actual before/after and restores one operation without overwriting unrelated edits',t=>{
 const dir=setup(t),db=storage.readAll(dir);db.vehicles[0].driver='B';storage.writeAll(dir,db,{actor:'Диспетчер',action:'Смена водителя'});
 const event=storage.listHistory(dir).items.find(e=>e.actor==='Диспетчер');assert.ok(event);assert.equal(event.action,'Смена водителя');
 const detail=storage.readHistoryEntry(dir,event.id);assert.equal(detail.changes[0].before.driver,'A');assert.equal(detail.changes[0].after.driver,'B');
 const changed=storage.readAll(dir);changed.vehicles.push({id:'other',driver:'C'});storage.writeAll(dir,changed);
 storage.restoreHistoryEntry(dir,event.id,{actor:'Руководитель'});
 assert.deepEqual(storage.readAll(dir).vehicles,[{id:'v',driver:'A'},{id:'other',driver:'C'}]);
 const restore=storage.listHistory(dir).items.find(e=>e.reverts===event.id);assert.equal(restore.actor,'Руководитель');
});
test('later edits and later dependent documents block restoration without writing any rows',t=>{
 const dir=setup(t),db=storage.readAll(dir);db.vehicles.push({id:'added'});storage.writeAll(dir,db,{action:'Добавление'});
 const event=storage.listHistory(dir).items.find(e=>e.action==='Добавление');
 db.records.push({id:'r',vehicleId:'added',date:'2026-10-18',km:10});storage.writeAll(dir,db);
 const before=storage.readAll(dir);assert.throws(()=>storage.restoreHistoryEntry(dir,event.id),/связи/);assert.deepEqual(storage.readAll(dir),before);
 const next=storage.readAll(dir);next.vehicles[1].driver='Later';storage.writeAll(dir,next);
 assert.throws(()=>storage.restoreHistoryEntry(dir,event.id),/изменена/);
});
test('closed fuel months cannot be bypassed through history restoration',t=>{
 const dir=setup(t),db=storage.readAll(dir);db.records.push({id:'r',vehicleId:'v',date:'2026-10-18',km:10});storage.writeAll(dir,db,{action:'Пробег'});
 const event=storage.listHistory(dir).items.find(e=>e.action==='Пробег');db.fuelPeriods.push({month:'2026-10',closed:true});storage.writeAll(dir,db);
 assert.throws(()=>storage.restoreHistoryEntry(dir,event.id),/Месяц закрыт/);
});
test('history and rows roll back together if revision commit fails',t=>{
 const dir=setup(t),before=storage.readAll(dir),events=storage.listHistory(dir).items.length;let fail=true;
 const proxy=new Proxy(fs,{get(target,key){if(key==='renameSync')return(src,dst)=>{if(fail&&dst===storage.revisionsFile(dir)){fail=false;throw Error('revision disk failure');}return fs.renameSync(src,dst)};return target[key]}});
 const req=require('node:module').createRequire(path.resolve('electron/storage.js'));
 const context={require:id=>id==='fs'?proxy:req(id),module:{exports:{}},console};vm.runInNewContext(fs.readFileSync('electron/storage.js','utf8'),context);
 const changed=JSON.parse(JSON.stringify(before));changed.vehicles[0].driver='Lost';
 assert.throws(()=>context.module.exports.writeAll(dir,changed),/disk failure/);
 assert.deepEqual(storage.readAll(dir),before);assert.equal(storage.listHistory(dir).items.length,events);
});
test('crash recovery completes committed history and removes history from interrupted uncommitted writes',t=>{
 const dir=setup(t),previous=storage.readAll(dir),base=storage.readRevisions(dir),revisions={...base,vehicles:base.vehicles+1};
 const sections={vehicles:[{id:'v',driver:'B'}]},before={vehicles:previous.vehicles},audit=history.createEvent(before,sections,{actor:'A'});
 const tx={before,sections,base,revisions,audit},journal=path.join(storage.sectionsDir(dir),'.transaction.json');
 fs.writeFileSync(journal,JSON.stringify(tx));fs.writeFileSync(storage.sectionFile(dir,'vehicles'),JSON.stringify(sections.vehicles));
 fs.mkdirSync(path.join(dir,'history'),{recursive:true});fs.writeFileSync(path.join(dir,'history',audit.id+'.json'),JSON.stringify(audit));
 assert.deepEqual(storage.readAll(dir),previous);assert.throws(()=>storage.readHistoryEntry(dir,audit.id));
 fs.writeFileSync(journal,JSON.stringify(tx));fs.writeFileSync(storage.revisionsFile(dir),JSON.stringify(revisions));
 assert.equal(storage.readAll(dir).vehicles[0].driver,'B');assert.equal(storage.readHistoryEntry(dir,audit.id).actor,'A');
});
test('authenticated network history attributes a client profile and restores against the current server database',async t=>{
 const server=require('../electron/server');const dir=setup(t),key='history-test-key-123456789';
 const result=await server.start({port:0,dataDir:dir,key});assert.equal(result.ok,true);t.after(()=>server.stop());server.configureKey(key,'Профиль сети');
 const base=storage.readRevisions(dir);const saved=await server.postSections('127.0.0.1',result.port,JSON.stringify({base,sections:{vehicles:[{id:'v',driver:'Network'}]},meta:{action:'Тест сети'}}));assert.equal(saved.ok,true);
 const list=await server.getJson('127.0.0.1',result.port,'/api/history');const item=list.items.find(e=>e.action==='Тест сети');assert.equal(item.actor,'Профиль сети');
 const detail=await server.getJson('127.0.0.1',result.port,'/api/history/'+item.id);assert.equal(detail.changes[0].after.driver,'Network');
 const restored=await server.postSections('127.0.0.1',result.port,JSON.stringify({id:item.id,databaseToken:storage.databaseToken(dir)}),'/api/history/restore');assert.equal(restored.ok,true);assert.equal(restored.data.vehicles[0].driver,'A');
 const again=await server.postSections('127.0.0.1',result.port,JSON.stringify({id:item.id,databaseToken:storage.databaseToken(dir)}),'/api/history/restore');assert.equal(again.ok,false);assert.match(again.error,/изменена/);
});
test('later generator tank links and monthly fuel prevent deleting their parent through history',t=>{
 const dir=setup(t),db=storage.readAll(dir);db.tanks.push({id:'t'});storage.writeAll(dir,db,{action:'Добавили ёмкость'});
 const tank=storage.listHistory(dir).items.find(e=>e.action==='Добавили ёмкость');db.generators.push({id:'g',tankId:'t'});storage.writeAll(dir,db);
 assert.throws(()=>storage.restoreHistoryEntry(dir,tank.id),/связи/);
 db.vehicles.push({id:'v2'});storage.writeAll(dir,db,{action:'Добавили ТС'});const vehicle=storage.listHistory(dir).items.find(e=>e.action==='Добавили ТС');
 db.monthlyFuel.push({id:'mf',vehicleId:'v2',month:'2026-10'});storage.writeAll(dir,db);assert.throws(()=>storage.restoreHistoryEntry(dir,vehicle.id),/связи/);
});
test('restoring opening fuel inputs cannot recalculate a closed month but descriptive edits remain restorable',t=>{
 const dir=setup(t),db=storage.readAll(dir);db.vehicles[0].fuelBalance=100;storage.writeAll(dir,db);db.vehicles[0].fuelBalance=200;storage.writeAll(dir,db,{action:'Остаток'});
 const fuel=storage.listHistory(dir).items.find(e=>e.action==='Остаток');db.fuelPeriods.push({month:'2026-10',closed:true});storage.writeAll(dir,db);
 assert.throws(()=>storage.restoreHistoryEntry(dir,fuel.id),/исходные данные ГСМ/);
 db.vehicles[0].driver='B';storage.writeAll(dir,db,{action:'Водитель'});const descriptive=storage.listHistory(dir).items.find(e=>e.action==='Водитель');storage.restoreHistoryEntry(dir,descriptive.id);assert.equal(storage.readAll(dir).vehicles[0].driver,'A');
});
