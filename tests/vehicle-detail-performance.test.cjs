'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {test}=require('node:test'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),file=path.join(root,'assets/js/02-vehicles-list.js');
function fixture(count=300,explicit=false){
 const v={id:0,plate:'SYNTHETIC-0',make:'Synthetic vehicle',driver:'Synthetic driver',org:'Synthetic org',fuel:'diesel',fuelGrade:'ДТ',norm:13.59,fuelBalance:100,odometer:1200};
 if(explicit)v.fuelAccounting={version:1,from:'2026-10-10',opening:60,basis:'Synthetic measurement'};
 return {vehicles:[v,{id:'0',plate:'OTHER',norm:10,fuelBalance:0}],records:Array.from({length:count},(_,i)=>({id:i===0?0:i===1?'0':i,vehicleId:0,date:'2026-10-'+String(i%31+1).padStart(2,'0'),km:i%13?100.125:0,odoStart:1200+i*100,odoEnd:1300+i*100,fuelIssued:i%5?0:100.28999999999999,fuelActual:i%7?13.59:null,fuelIdle:i%7?1.25:null,fuelUsed:14.125,driver:'Synthetic driver '+(i%3),fuelSum:i%5?0:100.12})),vehicleTo:[],repairs:[]};
}
function harness(source,count=300,explicit=false){
 const db=fixture(count,explicit),main={innerHTML:''},stats={balance:0,now:0,include:0},fuel=require(path.join(root,'assets/core/fuel-engine.js')),boundary=require(path.join(root,'assets/core/accounting-boundary.js'));
 class Clock extends Date {constructor(...args){super(...(args.length?args:['2026-10-26T12:00:00.000Z']));}static now(){return new Date('2026-10-26T12:00:00.000Z').getTime();}}
 const balances=new Map(db.records.map((r,i)=>[r.id,Math.max(0,100-i*.01)]));
 const ctx=vm.createContext({Date:Clock,console,Intl,data:db,activeSection:'vehicles',selectedVehicleId:0,vehicleDetailView:'cards',selectedYear:2026,selectedMonth:10,historyFullscreen:false,
 document:{getElementById:id=>id==='mainContent'?main:{style:{},textContent:''},querySelector:()=>null},
 recsFor:id=>db.records.filter(r=>r.vehicleId===id),vehicleToFor:()=>[],repairsFor:()=>[],costValuationCardHtml:()=>'',costValuationMountCards:()=>{},
 htmlEsc:v=>String(v??'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;'),htmlJs:v=>JSON.stringify(v),
 cmpDateAsc:(a,b)=>!a||!b?0:a<b?-1:a>b?1:0,fmtDate:v=>v,recordFuelGrade:()=> 'ДТ',vehicleFuelGrade:()=> 'ДТ',fuelTypeFromGrade:()=> 'diesel',
 TvsFuelEngine:{...fuel,recordBalanceAt:(map,id)=>map.get(id)},AccountingBoundary:boundary,dispatcherLocalDate:()=>{stats.now++;return '2026-10-26';},
 computeFuelBalances:()=>{stats.balance++;return balances;},renderVehicleToSection:()=>'<div>TO</div>',renderRepairSection:()=>'<div>REPAIRS</div>'
 });
 vm.runInContext(fs.readFileSync(path.join(root,'assets/js/29-fuel-quality.js'),'utf8'),ctx);vm.runInContext(source,ctx);
 return {ctx,db,main,stats,render(view){ctx.vehicleDetailView=view;vm.runInContext('renderDetail(data.vehicles[0])',ctx);return main.innerHTML;}};
}
const source=fs.readFileSync(file,'utf8');
// Frozen original renderDetail HTML, measured before this optimization on this
// synthetic fixture. Only new layout/accessibility attributes are normalized.
const originals={
 legacy:{cards:'a834a3ff3e0e5953296f70cf0ec361b6502984f67fc60ce3bd897bc9bde629f0',journal:'15687e4a3bc07532e24fcac6d14fbc4adb25560a721df46f60df05f1f01d325b',to:'54b868989f17cb65544a579c585d1b9624829d05db60e64424ac66c608f87a04',repairs:'c15864625add9f26f33939cdf6cf8e8df4a5f5262e2974e68d1251fada747290'},
 explicit:{cards:'1b9c84a7f03479dd06f80019d29c500469ef3cac55985b142d4261db18c7ddd6',journal:'36410eb3532b38ff58a05b44ec4d4f0983924c1ce5c9e13378a0247cf57c647c',to:'f0e7ac8f22a7b4301c965908898ed45be46cae5b3b01b222e143dfc1230dcb94',repairs:'9b2c8b67efd9b7c3706765dd736514b20731d7dff77036be24aa7c43c63321d0'}
};
for(const explicit of [false,true])test('vehicle views preserve original HTML, dates and source facts: '+(explicit?'explicit':'legacy'),t=>{
 const h=harness(source,1000,explicit),before=JSON.stringify(h.db),timings={};
 for(const view of ['cards','journal','to','repairs']){
  const start=performance.now(),html=h.render(view);timings[view]=+(performance.now()-start).toFixed(2);
  const normalized=html.replace(' class="vehicle-journal-months"','').replace(/ aria-pressed="(?:true|false)"/g,'');
  assert.equal(crypto.createHash('sha256').update(normalized).digest('hex'),originals[explicit?'explicit':'legacy'][view],view+' must retain the original visible values and all journal rows');
 }
 assert.equal(h.stats.now,explicit?8:0,'business date resolved twice per view, never once per record');
 assert.equal(JSON.stringify(h.db),before);t.diagnostic(JSON.stringify({records:1000,syntheticRenderMs:timings,businessDateReads:h.stats.now}));
});
test('journal number format reuse preserves Number locale rounding and legacy non-number display',()=>{
 const h=harness(source,0);
 for(const options of [undefined,{maximumFractionDigits:1},{maximumFractionDigits:2},{minimumFractionDigits:2,maximumFractionDigits:2},{minimumFractionDigits:2,maximumFractionDigits:3}]){
  for(const value of [0,-0,0.0004,1.005,100.28999999999999,923.537,-1234.56789,1e20,NaN,Infinity,'1234.567'])assert.equal(h.ctx.vehicleDetailNumber(value,options),value.toLocaleString('ru',options));
 }
});
test('repeated renders observe in-place mileage changes without caching business data',()=>{
 const h=harness(source,30,true),first=h.render('journal');h.db.records[1].km=9876.54321;const second=h.render('journal');
 assert.notEqual(second,first);assert.ok(second.includes((9876.54321).toLocaleString('ru',{maximumFractionDigits:1})));
 assert.equal(h.db.records[0].id,0);assert.equal(h.db.records[1].id,'0');
});
