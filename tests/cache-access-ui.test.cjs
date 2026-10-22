'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const stamp=letter=>'sha256:'+letter.repeat(64);
const access=letter=>({user:{id:'same-user',name:'Synthetic',role:'admin'},policyStamp:stamp(letter),readable:['vehicles','records'],writable:['vehicles','records']});
const current=letter=>({version:1,mode:'client',identity:'endpoint:database',databaseToken:'database',access:access(letter),policyStamp:stamp(letter)});
const snapshot=(letter,id)=>({data:{vehicles:[{id}],records:[]},databaseToken:'database',revisions:{vehicles:1,records:1},scopeViews:{},access:access(letter),platform:{apiVersion:1,scopedAccess:1}});
function harness(){
 const cached=new Map(),state={snapshot:snapshot('a','PRIVATE-OLD'),current:current('a'),snapshotCalls:0,cacheReads:[],revisionCalls:0,closed:0,modal:false,contextError:null};
 const host={replaceChildren(){},append(){}};
 const api={readSnapshot:async()=>{state.snapshotCalls++;return state.snapshot?JSON.stringify(state.snapshot):null;},readData:async()=>{throw Error('Capable clients must not downgrade to bare data');},getDataCacheContext:async()=>{if(state.contextError)throw state.contextError;return structuredClone(state.current);},getDataIdentity:async()=>'endpoint:database',getRevisions:async()=>{state.revisionCalls++;return {databaseToken:'database',vehicles:1,records:1};}};
 const context={window:{electronAPI:api},console:{warn(){}},crypto:crypto.webcrypto,TextEncoder,setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){},showToast(){},debounce:fn=>fn,
  localStorage:{getItem:key=>{state.cacheReads.push(key);return cached.get(key)||null;},setItem:(key,value)=>cached.set(key,value)},
  document:{addEventListener(){},querySelector:()=>state.modal?{}:null,querySelectorAll:()=>state.modal?[{classList:{remove(){state.closed++;state.modal=false;}}}]:[],getElementById:()=>host,createElement:()=>({textContent:''})}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../assets/core/fuel-engine.js'),'utf8')+'\n'+fs.readFileSync(path.resolve(__dirname,'../assets/js/01-core.js'),'utf8')+'\n'+fs.readFileSync(path.resolve(__dirname,'../assets/js/25f-sync.js'),'utf8')+'\n'+
  'globalThis.load=async()=>{data=await loadData();return JSON.parse(JSON.stringify(data));};globalThis.poll=syncPoll;globalThis.backup=scheduleLocalBackup;globalThis.inspect=()=>({data:JSON.parse(JSON.stringify(data)),blocked:_loadWriteBlocked,key:localCacheKey,access:_sync.access,enabled:_sync.enabled});syncRefreshView=()=>{};populateOrgSelect=()=>{};',context);
 return {context,state,cached,api};
}
test('an old stamp-less network cache is never read after current permissions narrow',async()=>{
 const h=harness(),oldKey='fuel_tracker_v1:'+crypto.createHash('sha256').update('endpoint:database').digest('hex');h.cached.set(oldKey,JSON.stringify({vehicles:[{id:'PRIVATE-LEGACY'}],records:[]}));h.state.snapshot=null;h.state.current=current('b');
 const loaded=await h.context.load();assert.equal(loaded.vehicles.length,0);assert.equal(h.state.cacheReads.includes(oldKey),false);assert.equal(h.context.inspect().blocked,true);assert.equal(h.context.inspect().access.policyStamp,stamp('b'));
});
test('only freshly confirmed matching access can restore a network cache, always read-only',async()=>{
 const h=harness();await h.context.load();h.context.backup(JSON.stringify(h.context.inspect().data));await new Promise(resolve=>setTimeout(resolve,5));const oldKey=h.context.inspect().key;assert.ok(h.cached.has(oldKey));
 h.state.snapshot=null;h.state.current=current('b');assert.equal((await h.context.load()).vehicles.length,0);assert.notEqual(h.context.inspect().key,oldKey);
 h.state.current=current('a');assert.equal((await h.context.load()).vehicles[0].id,'PRIVATE-OLD');assert.equal(h.context.inspect().blocked,true);assert.equal(h.context.inspect().enabled,false);
 h.state.contextError=Object.assign(Error('revoked'),{code:'ACCESS_REVOKED',status:401});assert.equal((await h.context.load()).vehicles.length,0);assert.equal(h.context.inspect().key,null);
});
test('snapshot/ping access mismatch causes one bounded fresh read instead of relabeling old rows',async()=>{
 const h=harness();h.state.current=current('b');h.api.readSnapshot=async()=>JSON.stringify(++h.state.snapshotCalls===1?snapshot('a','PRIVATE-OLD'):snapshot('b','ALLOWED-NEW'));
 const loaded=await h.context.load();assert.equal(h.state.snapshotCalls,2);assert.deepEqual(JSON.parse(JSON.stringify(loaded.vehicles)),[{id:'ALLOWED-NEW'}]);assert.equal(h.context.inspect().access.policyStamp,stamp('b'));
 const failed=harness();failed.state.current=current('b');assert.equal((await failed.context.load()).vehicles.length,0);assert.equal(failed.state.snapshotCalls,2);assert.equal(failed.context.inspect().key,null);
});
test('polling checks rights before an open modal and replaces all rows without merging the former scope',async()=>{
 const h=harness();await h.context.load();h.state.current=current('b');h.state.snapshot=snapshot('b','ALLOWED-NEW');h.state.modal=true;
 await h.context.poll();const result=h.context.inspect();assert.equal(h.state.closed,1);assert.equal(h.state.revisionCalls,0);assert.deepEqual(JSON.parse(JSON.stringify(result.data.vehicles)),[{id:'ALLOWED-NEW'}]);assert.equal(result.blocked,false);assert.equal(result.access.policyStamp,stamp('b'));assert.doesNotMatch(JSON.stringify(result.data),/PRIVATE-OLD/);
});
test('revocation clears an open view; an offline check blocks writes and prevents new cache restoration',async()=>{
 const h=harness();await h.context.load();h.state.modal=true;h.state.contextError=Object.assign(Error('revoked'),{code:'ACCESS_REVOKED',status:403});await h.context.poll();assert.equal(h.context.inspect().data.vehicles.length,0);assert.equal(h.context.inspect().blocked,true);assert.equal(h.context.inspect().key,null);assert.equal(h.state.closed,1);
 const offline=harness();await offline.context.load();offline.state.contextError=Error('offline');await offline.context.poll();assert.equal(offline.context.inspect().blocked,true);assert.equal(offline.context.inspect().key,null);assert.equal(offline.context.inspect().enabled,false);
 offline.state.snapshot=null;assert.equal((await offline.context.load()).vehicles.length,0);
});
test('explicit legacy compatibility data stays read-only and cannot address any network cache',async()=>{
 const h=harness();h.state.snapshot={data:{vehicles:[{id:'LEGACY-READ'}],records:[]},databaseToken:null,revisions:null,readOnly:true,access:{user:{id:'legacy-readonly',role:'viewer'},readable:['vehicles','records'],writable:[]},platform:{legacyReadOnly:1,scopedAccess:1}};
 h.state.current={version:1,mode:'client',identity:'endpoint:legacy',databaseToken:null,legacy:true,readOnly:true,access:h.state.snapshot.access,policyStamp:null};
 assert.equal((await h.context.load()).vehicles[0].id,'LEGACY-READ');assert.equal(h.context.inspect().blocked,true);assert.equal(h.context.inspect().key,null);assert.equal(h.context.inspect().enabled,false);
});
test('ordinary browser mode can poll without an Electron bridge',async()=>{const h=harness();delete h.context.window.electronAPI;await assert.doesNotReject(h.context.poll());});
test('a temporary local database lock preserves the editable baseline and permits the next poll',async()=>{
 const h=harness();h.state.current={version:1,mode:'local',identity:'local:database',databaseToken:'database',access:null,policyStamp:null};h.state.snapshot={data:{vehicles:[{id:'LOCAL'}],records:[]},databaseToken:'database',revisions:{vehicles:1,records:1},platform:{apiVersion:1}};
 await h.context.load();const baseline=JSON.stringify(h.context.inspect().data);h.state.contextError=Object.assign(Error('busy'),{code:'DB_BUSY'});await h.context.poll();assert.equal(h.context.inspect().enabled,true);assert.equal(h.context.inspect().blocked,false);assert.equal(JSON.stringify(h.context.inspect().data),baseline);
 h.state.contextError=null;await h.context.poll();assert.equal(h.context.inspect().enabled,true);assert.equal(h.context.inspect().blocked,false);assert.equal(JSON.stringify(h.context.inspect().data),baseline);
});
test('a delayed old rights poll cannot replace a newer completed load',async()=>{
 const h=harness();await h.context.load();let release;h.api.getDataCacheContext=()=>new Promise(resolve=>{release=()=>resolve(current('a'));});const old=h.context.poll();
 h.state.current=current('b');h.state.snapshot=snapshot('b','ALLOWED-NEW');h.api.getDataCacheContext=async()=>structuredClone(h.state.current);await h.context.load();release();await old;
 assert.equal(h.context.inspect().data.vehicles[0].id,'ALLOWED-NEW');assert.equal(h.context.inspect().access.policyStamp,stamp('b'));
});
