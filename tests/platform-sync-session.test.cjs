const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function environment(api){
 const sandbox={window:{electronAPI:api},console,setInterval:()=>1,clearInterval:()=>{},document:{querySelector:()=>null},showToast:()=>{},rebuildIndex:()=>{}};
 vm.createContext(sandbox);vm.runInContext('let _loadWriteBlocked=false;let data={vehicles:[{id:"old"}],records:[]};'+fs.readFileSync(path.resolve(__dirname,'../assets/js/25f-sync.js'),'utf8')+'\nglobalThis.state=_sync;globalThis.poll=syncPoll;globalThis.getRows=()=>data.vehicles;globalThis.change=(token,role)=>{_sync.databaseToken=token;_sync.enabled=true;_sync.revs={vehicles:7};_sync.synced={vehicles:JSON.stringify([{id:"new"}])};_sync.access={user:{id:role,role},readable:["vehicles"],writable:[]};data={vehicles:[{id:"new"}],records:[]};};globalThis.blocked=()=>_loadWriteBlocked;',sandbox);
 sandbox.state.enabled=true;sandbox.state.databaseToken='old-db';sandbox.state.revs={vehicles:1};sandbox.state.synced={vehicles:'[{"id":"old"}]'};
 return sandbox;
}
test('a delayed revision response from a former database cannot disable the new connection',async()=>{
 let release;const c=environment({getRevisions:()=>new Promise(resolve=>{release=resolve;})});
 const polling=c.poll();c.change('new-db','viewer');release({vehicles:2,databaseToken:'old-db'});await polling;
 assert.equal(c.state.enabled,true);assert.equal(c.blocked(),false);assert.equal(c.state.revs.vehicles,7);assert.equal(c.getRows()[0].id,'new');
});
test('a delayed section response cannot install rows fetched under the former principal',async()=>{
 let release;const c=environment({getRevisions:async()=>({vehicles:2,databaseToken:'old-db'}),readSection:()=>new Promise(resolve=>{release=resolve;})});
 await c.poll();for(let i=0;i<10&&!release;i++)await Promise.resolve();assert.equal(typeof release,'function');
 c.change('old-db','viewer');release({rows:[{id:'former-admin-row'}],rev:2,databaseToken:'old-db'});await c.state.chain;
 assert.equal(c.state.enabled,true);assert.equal(c.blocked(),false);assert.equal(c.state.revs.vehicles,7);assert.equal(c.getRows()[0].id,'new');
});
