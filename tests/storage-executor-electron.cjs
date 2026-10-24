'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createRequire}=require('node:module');
const storage=require('../electron/storage'),sqlite=require('../electron/sqlite-storage.cjs');
const {observeDatabase}=require('./helpers/native-database-observer.cjs');
const root=path.resolve(__dirname,'..');
let pw;try{pw=require('playwright');}catch{pw=createRequire(path.join(process.env.TVS_PLAYWRIGHT_MODULES||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),'package.json'))('playwright');}

test('real Electron keeps servicing main timers while JSON and SQLite journals commit in a worker',{timeout:180000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-storage-worker-native-')),profile=path.join(dir,'profile'),json=path.join(dir,'json'),sql=path.join(dir,'sqlite');let app;
 t.after(async()=>{
  if(app){await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(win=>win.destroy())).catch(()=>{});await app.close().catch(()=>{});}
  assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('tvs-storage-worker-native-'));fs.rmSync(dir,{recursive:true,force:true});
 });
 const data=Object.fromEntries(storage.SECTIONS.map(name=>[name,[]]));
 data.vehicles=[{id:'synthetic-v',plate:'SYNTHETIC WORKER',make:'Synthetic',org:'Synthetic',norm:10,fuelGrade:'ДТ',fuelBalance:100}];
 data.records=Array.from({length:1500},(_,index)=>({id:'synthetic-r-'+index,vehicleId:'synthetic-v',date:'2026-10-01',km:1,fuelActual:0.1,note:'Synthetic baseline'}));
 data.appMeta=[{id:'meta',toPlanInit:'synthetic'}];
 storage.createJson(json,{data});sqlite.create(sql,{data});fs.mkdirSync(profile);
 fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({users:[{name:'Synthetic JSON',dataDir:json},{name:'Synthetic SQLite',dataDir:sql}],activeUser:0,networkMode:'local',serverPort:3377,remotePort:3377,remoteHost:'127.0.0.1',networkKey:'synthetic-worker-test-key'}));
 const bootstrap=path.join(dir,'bootstrap.cjs');
 // Consume a webContents ID without retaining a blank target which Playwright
 // could await during launch. The actual BrowserWindow must still have a
 // different window ID from its webContents ID for the quit regression.
 fs.writeFileSync(bootstrap,`const Module=require('node:module'),original=Module._load,electron=original('electron',module,false);const HiddenWindow=new Proxy(electron.BrowserWindow,{construct(Target,args){const win=new Target({...args[0],show:false});win.show=()=>{};win.showInactive=()=>{};return win;}});Module._load=function(request,parent,isMain){if(request==='electron')return {...electron,BrowserWindow:HiddenWindow};return original.apply(this,arguments);};electron.app.whenReady().then(()=>{const extra=new electron.WebContentsView();extra.webContents.close();});electron.app.setAppPath(${JSON.stringify(root)});require(${JSON.stringify(path.join(root,'electron/main.js'))});`);
 const args=['--user-data-dir='+profile,'--tvs-test-hidden'];if(!process.env.TVS_PACKAGED_EXE)args.unshift(bootstrap);
 app=await pw._electron.launch({executablePath:process.env.TVS_PACKAGED_EXE||require('electron'),args,cwd:root,timeout:30000});
 // Select the application explicitly even when launch observes another target.
 let page;const windowDeadline=Date.now()+30000;
 while(!page){page=app.windows().find(candidate=>/\/index\.html(?:[?#]|$)/.test(candidate.url()));if(!page){assert.ok(Date.now()<windowDeadline,'the application BrowserWindow must load index.html');await new Promise(resolve=>setTimeout(resolve,20));}}
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.waitForFunction(()=>typeof data!=='undefined'&&data.records.length===1500,null,{timeout:30000});
 assert.equal(await app.evaluate(({app})=>app.getPath('userData')),profile);
 if(!process.env.TVS_PACKAGED_EXE)assert.equal(await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];return win.id!==win.webContents.id;}),true,'window IDs must differ from webContents IDs in the quit regression');
 for(const [index,database]of [[0,json],[1,sql]]){
  if(index)await page.evaluate(()=>settingsSwitchUser(1));
  // A main-process timer cannot observe a lock held by a synchronous main
  // transaction. Observing it proves the actual IPC path yields to the worker.
  await app.evaluate((_electron,directory)=>{
   const fs=process.getBuiltinModule('node:fs'),path=process.getBuiltinModule('node:path');
   globalThis.__workerMainTicks=0;
   globalThis.__workerMainTimer=setInterval(()=>{if(fs.existsSync(path.join(directory,'.tvs-database.lock')))globalThis.__workerMainTicks++;},5);
  },database);
  const saved=await page.evaluate(async()=>{data.records[0].note='Synthetic worker change';return saveData(data);});
  const ticks=await app.evaluate(()=>{clearInterval(globalThis.__workerMainTimer);return globalThis.__workerMainTicks;});
  assert.equal(saved,true);assert.ok(ticks>0,'main timers must run while the physical write lock is held');
  t.diagnostic((index?'SQLite':'JSON')+': main timer ran '+ticks+' times while the write lock was held');
  const actual=await observeDatabase(()=>storage.readAll(database));assert.equal(actual.records[0].note,'Synthetic worker change');assert.equal(actual.records[0].km,1);assert.equal(actual.records.length,1500);
  const replaced=await page.evaluate(async index=>{
   const next=structuredClone(data);next.vehicles[0].note='Synthetic full write';
   return window.electronAPI.writeData(JSON.stringify({data:next,databaseToken:_sync.databaseToken,base:_sync.revs,operation:{id:'native-worker-full-'+index}}));
  },index);
  assert.equal(replaced,true);assert.equal((await observeDatabase(()=>storage.readAll(database))).vehicles[0].note,'Synthetic full write');
 }
 assert.deepEqual(errors,[]);
 await page.evaluate(async()=>{data=await loadData();rebuildIndex();});
 const pending=page.evaluate(async()=>{data.records[1].note='Synthetic quit flush';return saveData(data);}).catch(()=>null);
 const deadline=Date.now()+30000;
 while(!fs.existsSync(path.join(sql,'.tvs-database.lock'))){assert.ok(Date.now()<deadline,'write must reach its physical transaction before quit');await new Promise(resolve=>setTimeout(resolve,5));}
 const child=app.process(),exit=new Promise(resolve=>child.once('exit',code=>resolve(code)));
 await app.evaluate(({app})=>app.quit());
 await pending;assert.equal(await exit,0);app=null;
 assert.equal(fs.existsSync(path.join(sql,'.tvs-database.lock')),false);
 assert.equal(storage.readAll(sql).records[1].note,'Synthetic quit flush','application quit must drain the pending renderer save before killing workers');
});
