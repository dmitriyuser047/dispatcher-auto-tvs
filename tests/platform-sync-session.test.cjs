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

function screens() {
 const calls=[],host={innerHTML:'',contains:()=>true};
 const context={console:{warn:()=>{}},Object,Set,document:{activeElement:null,querySelector:()=>null,getElementById:()=>host},data:{vehicles:[],generators:[],tanks:[]},activeSection:'home',selectedVehicleId:null,selectedGeneratorId:null,selectedTankId:null,repairsJournalSummaryMode:false,fpView:'receipts',fpVehicle:null};
 const renders=['renderLaunchpad','renderPlatformSystem','renderPersonnelSection','renderWorkflows','renderToScheduleSection','renderReestrSection','renderDetail','renderVehicleCards','renderGenDetail','renderGeneratorCards','renderTankList','renderTankDetail','renderFinancesSection','renderCostsSection','renderProcurementSection','renderContragentsSection','renderReportsSection','renderRepairsSummary','renderRepairsJournal','renderPrintFormsSection','renderFuelReport','renderFuelPurchases','unifiedRefreshNav'];
 for(const name of renders)context[name]=(...args)=>calls.push({name,args});
 vm.createContext(context);
 for(const name of ['14-navigation.js','25f-sync.js'])vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../assets/js',name),'utf8'),context);
 vm.runInContext('globalThis.state=_sync;globalThis.refresh=syncRefreshView;',context);
 return {context,calls,host};
}

test('incoming changes refresh all workspace screens through the navigation registry',()=>{
 const {context:c,calls}=screens();
 const expected={home:'renderLaunchpad',system:'renderPlatformSystem',drivers:'renderPersonnelSection',operators:'renderPersonnelSection',workflows:'renderWorkflows',dispatch:'renderWorkflows',toSchedule:'renderToScheduleSection',reestr:'renderReestrSection',vehicles:'renderVehicleCards',generators:'renderGeneratorCards',tanks:'renderTankList',finances:'renderFinancesSection',costs:'renderCostsSection',procurement:'renderProcurementSection',contragents:'renderContragentsSection',reports:'renderReportsSection',repairs:'renderRepairsJournal',printForms:'renderPrintFormsSection',fuelReport:'renderFuelReport',fuelPurchases:'renderFuelPurchases'};
 for(const [section,name]of Object.entries(expected)){
  calls.length=0;c.activeSection=section;c.refresh(['records']);
  assert.equal(calls[0]?.name,name,section);assert.equal(c.state.needRefresh.length,0,section);
 }
});

test('sync preserves selected assets including numeric zero and clears a removed tank detail',()=>{
 const {context:c,calls,host}=screens();
 for(const [section,field,name]of [['vehicles','selectedVehicleId','renderDetail'],['generators','selectedGeneratorId','renderGenDetail'],['tanks','selectedTankId','renderTankDetail']]){
  c.data[section]=[{id:0,note:'new data'}];c[field]=0;c.activeSection=section;calls.length=0;c.refresh([section]);
  const rendered=calls.find(call=>call.name===name);assert.equal(rendered?.args[0].note,'new data',section);assert.equal(c[field],0,section);
 }
 c.data.tanks=[];calls.length=0;c.refresh(['tanks']);assert.equal(c.selectedTankId,null);assert.match(host.innerHTML,/Выберите ёмкость/);assert.ok(!calls.some(call=>call.name==='renderTankDetail'));
});

test('refresh stays queued during editing, after a render failure and for an unknown screen',()=>{
 const {context:c,calls}=screens();c.activeSection='finances';
 c.document.activeElement={tagName:'INPUT'};c.refresh(['payments']);assert.equal(calls.length,0);assert.deepEqual(Array.from(c.state.needRefresh),['payments']);
 c.document.activeElement=null;c.renderFinancesSection=()=>{throw Error('Synthetic render failure');};c.refresh(['budget']);assert.deepEqual(Array.from(c.state.needRefresh),['payments','budget']);
 c.activeSection='unknown';c.refresh([]);assert.equal(c.state.needRefresh.length,2);
 c.activeSection='finances';c.renderFinancesSection=()=>calls.push({name:'recovered'});c.refresh([]);assert.equal(calls[0].name,'recovered');assert.equal(c.state.needRefresh.length,0);
});

test('the real poll installs remote finance rows and renders the updated screen',async()=>{
 const {context:c,calls}=screens();c.activeSection='finances';c.data.payments=[{id:'payment',sum:10}];c.state.enabled=true;c.state.databaseToken='synthetic';c.state.revs={payments:1};c.state.synced={payments:JSON.stringify(c.data.payments)};
 c.window={electronAPI:{getRevisions:async()=>({payments:2,databaseToken:'synthetic'}),readSection:async()=>({rows:[{id:'payment',sum:25}],rev:2,databaseToken:'synthetic'})}};
 c.rebuildIndex=()=>{};c.showToast=()=>{};c.renderFinancesSection=()=>calls.push({name:'finance',sum:c.data.payments[0].sum});
 await c.syncPoll();await c.state.chain;
 assert.equal(c.state.revs.payments,2);assert.equal(calls.find(call=>call.name==='finance')?.sum,25);assert.equal(c.state.needRefresh.length,0);
});
