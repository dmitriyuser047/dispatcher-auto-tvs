'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../assets/js/26-boot.js'),'utf8');
async function start(web){
  const events=[],settings={networkMode:'client',activeUser:0,users:[{name:'Synthetic shared database'}]};
  const context={console,window:{electronAPI:{async getSettings(){events.push('settings');return settings;}}},_appSettings:null,
    async loadData(){events.push('data');return {vehicles:[],records:[]};},
    rebuildIndex(){},populateOrgSelect(){},updateFilterUI(){},updateSidebarDataPath(){},
    switchSection(){events.push('desktop-route');assert.equal(context._appSettings,null);},
  };
  if(web)context.window.tvsWeb={active:true,async startRoute(){
    events.push('web-route');assert.equal(context._appSettings,settings,'Guarded card actions must see the final connection identity');
  }};
  await vm.runInNewContext(source,context);
  return events;
}
test('direct web card startup confirms connection settings before creating guarded action references',async()=>{
  assert.deepEqual(await start(true),['data','settings','web-route']);
});
test('desktop startup retains its home-first settings sequence',async()=>{
  assert.deepEqual(await start(false),['data','desktop-route','settings']);
});
