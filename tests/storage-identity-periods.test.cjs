const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),vm=require('node:vm');
const storage=require('../electron/storage'),server=require('../electron/server');
function temp(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-bound-test-'));t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('tvs-bound-test-'));fs.rmSync(dir,{recursive:true,force:true});});return dir;}
function database(){return {vehicles:[{id:'v',fuelBalance:10,fuel:'diesel',fuelGrade:'ДТ',norm:10,org:'A',fuelcard:'123'}],records:[{id:'r',vehicleId:'v',date:'2026-08-15',km:100}],generators:[{id:'g',fuel:'diesel',norm100:30,norm50:20,normIdle:8,power:100,fuelBalance:10,tankId:'t'}],genRecords:[{id:'gr',generatorId:'g',date:'2026-09-02',hours:2,load:30}],tanks:[{id:'t',balanceInit:100,fuel:'diesel'}],fuelCards:[{id:'c',number:'123',org:'A',provider:'test',assignments:[{from:'2026-01-01',vehicleId:'v',org:'A'}]}],fuelPeriods:[{month:'2026-09',closed:true}]};}
test('closed fuel periods protect undated input fields while allowing descriptive asset edits',t=>{
 const dir=temp(t),db=database();storage.writeAll(dir,db);
 const changes={vehicles:{fuelBalance:11,norm:11,fuelGrade:'АИ-95',org:'B',fuelcard:'999',fuelBalanceSources:[{org:'B',grade:'ДТ',qty:10}]},generators:{norm100:31,norm50:21,normIdle:9,power:101,fuelBalance:11,tankId:'different'},tanks:{balanceInit:101,fuel:'gasoline'},fuelCards:{number:'456',org:'B',provider:'other',assignments:[]}};
 for(const [name,fields] of Object.entries(changes))for(const [key,value]of Object.entries(fields)){
   const rows=structuredClone(storage.readAll(dir)[name]);rows[0][key]=value;
   assert.throws(()=>storage.writeSections(dir,{base:storage.readRevisions(dir),sections:{[name]:rows}}),/закрыт/,name+'.'+key);
 }
 for(const name of Object.keys(changes)){
   const rows=structuredClone(storage.readAll(dir)[name]);rows[0].note='Description only';rows[0].name='Renamed';
   assert.equal(storage.writeSections(dir,{base:storage.readRevisions(dir),sections:{[name]:rows}}).ok,true);
 }
 // Forms may materialise equivalent opening sources or nullable numbers.
 const vehicles=structuredClone(storage.readAll(dir).vehicles);vehicles[0].fuelBalance='10';vehicles[0].fuelBalanceSources=[{org:'A',grade:'ДТ',qty:10}];
 assert.equal(storage.writeSections(dir,{base:storage.readRevisions(dir),sections:{vehicles}}).ok,true);
});
test('earlier journal rows cannot change the opening balance of a later closed month',t=>{
 const dir=temp(t),db=database();storage.writeAll(dir,db);
 const changed=structuredClone(db);changed.records[0].km=200;
 assert.throws(()=>storage.writeAll(dir,changed),/начальный остаток/);
 const future=structuredClone(storage.readAll(dir));future.records.push({id:'future',vehicleId:'v',date:'2026-10-01',km:10});
 assert.equal(storage.writeAll(dir,future).changed.includes('records'),true);
 const cards=structuredClone(storage.readAll(dir).fuelCards);cards[0].assignments[0].to='2026-09-30';cards[0].assignments.push({from:'2026-10-01',vehicleId:'future-v',org:'B'});
 const vehicles=structuredClone(storage.readAll(dir).vehicles);vehicles.push({id:'future-v',fuelBalance:0,norm:20,fuel:'diesel'});
 assert.equal(storage.writeSections(dir,{base:storage.readRevisions(dir),sections:{vehicles,fuelCards:cards}}).ok,true);
 vehicles.push({id:'new-opening',fuelBalance:1});
 assert.throws(()=>storage.writeSections(dir,{base:storage.readRevisions(dir),sections:{vehicles}}),/закрыт/);
});
test('new assets and cards cannot retroactively resolve closed unresolved fuel references',t=>{
 const dir=temp(t),db=database();db.fuelPurchases=[{id:'p',date:'2026-09-02',cardNo:'987-654',qty:10}];db.genRecords.push({id:'missing-tank-record',generatorId:'g',tankId:'missing-tank',date:'2026-09-02',fuelIssued:5});
 // Existing legacy corruption is loaded, rather than newly introduced through
 // a validated write. The closed-period guard must still reject a new binding.
 fs.writeFileSync(path.join(dir,'data.json'),JSON.stringify(db));storage.readAll(dir);
 for(const [name,row] of [['fuelCards',{id:'new-card',number:'987654',org:'B'}],['vehicles',{id:'new-vehicle',fuelcard:'987654',fuelBalance:0,org:'B'}],['tanks',{id:'missing-tank',balanceInit:0}]]){
  const rows=[...storage.readAll(dir)[name],row];assert.throws(()=>storage.writeSections(dir,{base:storage.readRevisions(dir),sections:{[name]:rows}}),/закрыт/,name);
 }
});
const key='identity-test-key-not-real-123456';
function request(port,route,body){return new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port,path:route,method:body?'POST':'GET',headers:{Authorization:'Bearer '+key}},res=>{let raw='';res.setEncoding('utf8');res.on('data',part=>raw+=part);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(raw)}));});req.on('error',reject);req.end(body?JSON.stringify(body):undefined);});}
test('server binds ping, snapshots, revisions, reads and both write protocols to the served database',async t=>{
 const dir=temp(t),other=temp(t);storage.writeAll(dir,{vehicles:[{id:'v'}],records:[]});storage.writeAll(other,{vehicles:[{id:'v'}],records:[]});
 const started=await server.start({port:0,dataDir:dir,key});assert.equal(started.ok,true);t.after(()=>server.stop());const token=storage.databaseToken(dir),foreign=storage.databaseToken(other),port=started.port;
 for(const route of ['/api/ping','/api/snapshot','/api/revisions','/api/section/vehicles'])assert.equal((await request(port,route)).body.databaseToken,token,route);
 for(const route of ['/api/sections','/api/data']){
   const unbound=await request(port,route,route.endsWith('sections')?{base:storage.readRevisions(dir),sections:{vehicles:[]}}:{vehicles:[],records:[]});assert.equal(unbound.status,428);assert.match(unbound.body.error,/Обновите клиент/);
   const payload=route.endsWith('sections')?{databaseToken:foreign,base:storage.readRevisions(dir),sections:{vehicles:[]}}:{databaseToken:foreign,data:{vehicles:[],records:[]}};
   const rejected=await request(port,route,payload);assert.equal(rejected.status,409);assert.equal(rejected.body.databaseChanged,true);
   assert.equal(storage.readAll(dir).vehicles.length,1);
 }
 const accepted=await request(port,'/api/data',{databaseToken:token,base:storage.readRevisions(dir),data:{vehicles:[{id:'v',note:'new'}],records:[]}});assert.equal(accepted.status,200);assert.equal(accepted.body.databaseToken,token);assert.equal(storage.readAll(dir).vehicles[0].note,'new');
});
function syncContext(api){const context={window:{electronAPI:api},console,setInterval:()=>1,clearInterval:()=>{},document:{querySelector:()=>null},showToast:()=>{},rebuildIndex:()=>{},data:{vehicles:[{id:'v'}],records:[]}};vm.createContext(context);vm.runInContext('let _loadWriteBlocked=false;\n'+fs.readFileSync(path.join(__dirname,'../assets/js/25f-sync.js'),'utf8')+'\nglobalThis.state=_sync;globalThis.load=syncLoad;globalThis.save=syncSave;globalThis.poll=syncPoll;',context);return context;}
test('sync refuses a different database before merging rows with equal revisions',async()=>{
 let sent;const db={vehicles:[{id:'v'}],records:[]};
 const c=syncContext({readSnapshot:async()=>JSON.stringify({databaseToken:'original',data:db,revisions:{vehicles:1}}),writeSections:async raw=>{sent=JSON.parse(raw);return{ok:false,conflicts:['vehicles'],databaseToken:'original'};},readSection:async()=>({databaseToken:'replacement',rev:1,rows:[{id:'v',note:'foreign'}]})});
 await c.load();const local={vehicles:[{id:'v',note:'mine'}],records:[]};
 await assert.rejects(c.save(local),/База данных на сервере изменилась/);assert.equal(sent.databaseToken,'original');assert.equal(local.vehicles[0].note,'mine');assert.equal(c.state.enabled,false);
});
test('poll checks database identity even when all revision numbers are unchanged',async()=>{
 const c=syncContext({readSnapshot:async()=>JSON.stringify({databaseToken:'original',data:{vehicles:[{id:'v'}],records:[]},revisions:{vehicles:1}}),getRevisions:async()=>({vehicles:1,databaseToken:'replacement'})});
 await c.load();await c.poll();assert.equal(c.state.enabled,false);assert.equal(c.data.vehicles[0].id,'v');
});
test('a transient save error preserves the binding and permits a later retry',async()=>{
 let fail=true;const c=syncContext({readSnapshot:async()=>JSON.stringify({databaseToken:'original',data:{vehicles:[{id:'v'}],records:[]},revisions:{vehicles:1}}),writeSections:async()=>fail?{ok:false,error:'timeout'}:{ok:true,databaseToken:'original',revisions:{vehicles:2}}});
 await c.load();const local={vehicles:[{id:'v',note:'retry'}],records:[]};await assert.rejects(c.save(local),/timeout/);assert.equal(c.state.enabled,true);fail=false;assert.equal(await c.save(local),true);
});
test('local cache never crosses a served database or account identity',async()=>{
 const cached=new Map(),api={};let token='original',account='account-A',available=true;
 api.readSnapshot=async()=>available?JSON.stringify({databaseToken:token,data:{vehicles:[{id:'private-A'}],records:[]},revisions:{vehicles:1}}):null;
 api.readData=async()=>null;api.getDataIdentity=async()=>account+':'+token;
 const context={window:{electronAPI:api},console,crypto:require('node:crypto').webcrypto,TextEncoder,setTimeout,clearTimeout,setInterval:()=>1,clearInterval:()=>{},document:{addEventListener:()=>{},querySelector:()=>null},localStorage:{getItem:key=>cached.get(key)||null,setItem:(key,value)=>cached.set(key,value)},showToast:()=>{},debounce:fn=>fn};
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/core/fuel-engine.js'),'utf8')+'\n'+fs.readFileSync(path.join(__dirname,'../assets/js/01-core.js'),'utf8')+'\n'+fs.readFileSync(path.join(__dirname,'../assets/js/25f-sync.js'),'utf8')+'\nglobalThis.load=loadData;globalThis.backup=scheduleLocalBackup;globalThis.cacheKey=()=>localCacheKey;globalThis.blocked=()=>_loadWriteBlocked;',context);
 const first=await context.load(),originalKey=context.cacheKey();context.backup(JSON.stringify(first));await new Promise(resolve=>setTimeout(resolve,10));assert.equal(cached.has(originalKey),true);
 token='replacement';available=false;const replacement=await context.load();assert.notEqual(context.cacheKey(),originalKey);assert.equal(replacement.vehicles.length,0);assert.equal(context.blocked(),true);
 token='original';account='account-B';const anotherAccount=await context.load();assert.notEqual(context.cacheKey(),originalKey);assert.equal(anotherAccount.vehicles.length,0);
 api.getDataIdentity=async()=>{throw Error('offline');};await context.load();assert.equal(context.cacheKey(),null);
});
test('loading closed cash history never creates a retroactive default card or blocks the first descriptive save',async t=>{
 for(const [section,row] of [
   ['fuelPurchases',{id:'cash-purchase',date:'2026-08-15',cardNo:' НАЛИЧКА ',vehicleId:'v',qty:10}],
   ['records',{id:'cash-record',date:'2026-09-15',fuelCardNum:'НАЛИЧКА',vehicleId:'v',fuelIssued:10}],
   ['monthlyFuel',{id:'cash-month',month:'2026-09',cardNumber:'НАЛИЧКА',vehicleId:'v',liters:10}],
 ]){
   const dir=temp(t),db=database();db[section]=[...(db[section]||[]),row];storage.writeAll(dir,db);const before=storage.readSnapshot(dir);
   const api={readSnapshot:async()=>JSON.stringify(storage.readSnapshot(dir)),getDataIdentity:async()=>'local:'+storage.databaseToken(dir),writeSections:async raw=>storage.writeSections(dir,JSON.parse(raw))};
   const context={window:{electronAPI:api},console,crypto:require('node:crypto').webcrypto,TextEncoder,setTimeout,clearTimeout,setInterval:()=>1,clearInterval:()=>{},document:{addEventListener:()=>{},querySelector:()=>null},localStorage:{getItem:()=>null},showToast:()=>{},debounce:fn=>fn};
   vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/core/fuel-engine.js'),'utf8')+'\n'+fs.readFileSync(path.join(__dirname,'../assets/js/01-core.js'),'utf8')+'\n'+fs.readFileSync(path.join(__dirname,'../assets/js/25f-sync.js'),'utf8')+'\nglobalThis.load=loadData;globalThis.save=syncSave;',context);
   const loaded=await context.load();assert.equal(loaded.fuelCards.some(card=>card.id==='fc_cash'),false,section);
   assert.deepEqual(storage.readAll(dir),before.data,'loading did not write '+section);
   loaded.vehicles[0].note='Description after loading cash history';assert.equal(await context.save(loaded),true,section);
   assert.deepEqual(storage.readAll(dir).fuelCards,before.data.fuelCards,section);assert.equal(storage.readAll(dir).vehicles[0].note,'Description after loading cash history');
 }
});
