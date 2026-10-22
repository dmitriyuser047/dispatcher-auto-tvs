'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const calendar=require('../assets/core/business-calendar.js'),fuel=require('../assets/core/fuel-engine.js');
function context(zone){
 const now='2026-10-22T22:30:00.000Z',NativeDate=Date,main={innerHTML:''},data={vehicles:[],appMeta:zone?[{id:'business-calendar',kind:'businessCalendar',calendar:{version:1,timeZone:zone},history:[{operationId:'synthetic-calendar',reason:'Explicit synthetic business zone',at:'2026-10-22T12:00:00.000Z',actor:{id:'synthetic',name:'Synthetic administrator',role:'admin'},previousTimeZone:'UTC',timeZone:zone}]}]:[]};
 const realm=vm.createContext({BusinessCalendar:calendar,TvsFuelEngine:fuel,EntityIdentity:require('../assets/core/entity-identity.js'),htmlEsc:value=>String(value),data,Date:class extends NativeDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return NativeDate.parse(now);}},document:{addEventListener(){},getElementById(id){assert.equal(id,'mainContent');return main;}}});
 for(const name of ['21-finances','24-print-forms','25j-gsm-workspace','25l-manual-fuel','57-catalog-merge','59-period-control','60-tank-stock','61-procurement-control','62-cost-control'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/js',name+'.js'),'utf8'),realm,{filename:name});
 return {realm,main};
}
test('new accounting dates share the configured business day while manual print dates remain explicit',()=>{
 for(const [zone,expected]of [[null,'2026-10-22'],['Europe/Moscow','2026-10-23'],['America/Anchorage','2026-10-22']]){
  const {realm,main}=context(zone);
  for(const name of ['finToday','gsmManualToday','catalogMergeToday','periodControlToday','tankFuelToday','procurementToday','costActionToday'])assert.equal(realm[name](),expected,name+' / '+zone);
  assert.equal(vm.runInContext('gsmActDateValue()',realm),expected);realm.renderPrintFormsSection();
  const dates=[...main.innerHTML.matchAll(/type="date"[^>]*value="([^"]+)"/g)].map(match=>match[1]);assert.deepEqual(dates,[],'manual print dates stay unknown until explicitly entered');assert.equal((main.innerHTML.match(/type="date"/g)||[]).length,3);
 }
});
test('a fuel act default resolves after the database loads while an explicitly selected date remains literal',()=>{
 const {realm}=context(null);assert.equal(realm.gsmActDateValue(),'2026-10-22');
 realm.data.appMeta=context('Europe/Moscow').realm.data.appMeta;assert.equal(realm.gsmActDateValue(),'2026-10-23');
 vm.runInContext("gsmActDate='2026-09-30'",realm);realm.data.appMeta=[];assert.equal(realm.gsmActDateValue(),'2026-09-30');
});
