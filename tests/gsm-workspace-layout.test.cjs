'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const stock=require('../assets/core/fuel-stock.js');
const fuel=require('../assets/core/fuel-engine.js');
const decimal=require('../assets/core/decimal-core.js');
const root=path.resolve(__dirname,'..');

// Only source modules are read from disk. All stock and UI state are synthetic;
// no profile, application storage, browser, worker or user database is opened.
function database(extra={}){
  return {vehicles:[],records:[],fuelPurchases:[],fuelCards:[],monthlyFuel:[],fuelWriteoffs:[],
    tanks:[{id:0,name:'SYNTHETIC NUMBER TANK',org:'Synthetic A',fuel:'diesel',fuelGrade:'ДТ',balanceInit:100}],
    tankIncomes:[],fuelMovements:[],generators:[],genRecords:[],...extra};
}
function harness(db=database(),options={}){
  const before=JSON.stringify(db),calls={project:0,at:[],writes:0,navigation:[],renders:0,toasts:[]};
  const main={innerHTML:''};
  const ledger={from:'2026-09-01',to:'2026-09-30',organizations:[],receipts:[],rows:[],movements:[]};
  let readable=options.readable;
  const forbidden=()=>{calls.writes++;throw Error('Synthetic presentation must not write');};
  const context=vm.createContext({
    console,data:db,activeSection:'fuelPurchases',DecimalCore:decimal,
    FuelStock:{...stock,project(...args){calls.project++;return stock.project(...args);},
      at(snapshot,target,date,opts){calls.at.push({target,date});return stock.at(snapshot,target,date,opts);}},
    platformSessionContext:()=>({readable}),dispatcherLocalDate:()=>'2026-11-15',
    dispatcherBackgroundNeeded:()=>false,gsmBuildLedger:()=>ledger,
    gsmOrgKey:fuel.gsmOrgKey,gsmGrade:fuel.gsmGrade,
    gsmMonthRange:fuel.gsmMonthRange,
    fmtDate:value=>value,document:{addEventListener(){},getElementById:id=>id==='mainContent'?main:null},
    saveData:forbidden,platformExecuteCommand:forbidden,
    window:{electronAPI:{writeSections:forbidden,executeCommand:forbidden}},
    switchSection:section=>{calls.navigation.push(['section',section]);context.activeSection=section;},
    selectTank:id=>calls.navigation.push(['tank',id]),showToast:message=>calls.toasts.push(message)
  });
  for(const name of ['55-precision-input.js','25b-fuel-purchases.js','25j-gsm-workspace.js','60-tank-stock.js','25r-gsm-workspace-layout.js']){
    const file=path.join(root,'assets/js',name);
    vm.runInContext(fs.readFileSync(file,'utf8'),context,{filename:file});
  }
  // Navigation is observed at the production render boundary; rendering the
  // workspace itself below still executes the complete production function.
  context.renderFuelPurchases=()=>{calls.renders++;};
  vm.runInContext("fpView='tanks';fpMonth='2026-09';gsmOrg='';gsmFuel=''",context);
  return {context,calls,main,ledger,db,
    scope(org='',grade=''){context.scopeOrg=org;context.scopeGrade=grade;vm.runInContext('gsmOrg=scopeOrg;gsmFuel=scopeGrade',context);},
    readable(value){readable=value;},
    unchanged(){assert.equal(calls.writes,0);assert.equal(JSON.stringify(db),before);}
  };
}

test('physical tank stock uses the selected month end and excludes a future receipt',()=>{
  const h=harness(database({tankIncomes:[
    {id:'september',tankId:0,date:'2026-09-10',amount:25},
    {id:'future',tankId:0,date:'2026-10-01',amount:1000}
  ]}));
  const html=h.context.gsmPhysicalTanksHtml(h.ledger);
  assert.match(html,/Расчёт на конец 2026-09-30/);
  assert.match(html,/Расчётный остаток<\/dt><dd>125 л<\/dd>/);
  assert.doesNotMatch(html,/1125|1[\s\u00a0]125|2026-11-15/);
  assert.equal(h.calls.project,1);
  assert.deepEqual(h.calls.at.map(value=>[value.target.id,value.date]),[[0,'2026-09-30']]);
  h.unchanged();
});

test('missing source read access returns a notice before projecting or exposing private tank stock',()=>{
  const h=harness(database({tanks:[{id:0,name:'PRIVATE SYNTHETIC TANK',balanceInit:987.123}]}),
    {readable:stock.readSections.filter(name=>name!=='genRecords')});
  const html=h.context.gsmPhysicalTanksHtml(h.ledger);
  assert.match(html,/Недостаточно доступа/);
  assert.doesNotMatch(html,/PRIVATE SYNTHETIC TANK|987[,.]123|data-gsm-tank-index/);
  assert.equal(h.calls.project,0);assert.equal(h.calls.at.length,0);
  h.context.gsmOpenPhysicalTank(0);assert.deepEqual(h.calls.navigation,[]);
  h.unchanged();
});

test('physical tank navigation preserves numeric and string zero and refuses a stale database reference',()=>{
  const h=harness(database({tanks:[
    {id:0,name:'SYNTHETIC NUMBER TANK',fuel:'diesel',balanceInit:100},
    {id:'0',name:'SYNTHETIC STRING TANK',fuel:'diesel',balanceInit:200}
  ]}));
  const html=h.context.gsmPhysicalTanksHtml(h.ledger);
  assert.equal((html.match(/data-gsm-tank-index=/g)||[]).length,2);
  h.context.gsmOpenPhysicalTank(0);
  assert.deepEqual(h.calls.navigation,[['section','tanks'],['tank',0]]);
  h.context.activeSection='fuelPurchases';h.context.gsmOpenPhysicalTank(1);
  assert.deepEqual(h.calls.navigation.slice(-2),[['section','tanks'],['tank','0']]);
  h.context.activeSection='fuelPurchases';h.context.data=structuredClone(h.db);
  h.context.gsmOpenPhysicalTank(0);assert.equal(h.calls.navigation.length,4);
  h.context.data=h.db;h.readable([]);h.context.gsmOpenPhysicalTank(0);
  assert.equal(h.calls.navigation.length,4);
  h.unchanged();
});

test('workspace grade options and physical filters support a legacy gasoline tank and escape its caption',()=>{
  const hostile='<img src=x onerror="SYNTHETIC()">';
  const h=harness(database({tanks:[
    {id:7,name:hostile,location:'<script>SYNTHETIC()</script>',org:'Synthetic A',fuel:'gasoline',balanceInit:9},
    {id:'other-org',name:'OTHER SYNTHETIC GASOLINE',org:'Synthetic B',fuel:'gasoline',balanceInit:8},
    {id:'other-grade',name:'OTHER SYNTHETIC DIESEL',org:'Synthetic A',fuel:'diesel',balanceInit:7}
  ]}));
  // The grade must be offered before it is selected; adding gsmFuel itself to
  // the options would otherwise conceal a missing legacy tank grade option.
  h.scope('Synthetic A');h.context.gsmRenderWorkspace();
  assert.match(h.main.innerHTML,/<option>Бензин<\/option>/);
  const beforeFilter=h.calls.at.length;
  h.scope('Synthetic A','Бензин');h.context.gsmRenderWorkspace();
  const html=h.main.innerHTML;
  assert.match(html,/<option selected>Бензин<\/option>/);
  assert.equal((html.match(/data-gsm-tank-index=/g)||[]).length,1);
  assert.match(html,/&lt;img src=x onerror=&quot;SYNTHETIC\(\)&quot;&gt;/);
  assert.match(html,/&lt;script&gt;SYNTHETIC\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html,/<img|<script|OTHER SYNTHETIC GASOLINE|OTHER SYNTHETIC DIESEL/);
  assert.deepEqual(h.calls.at.slice(beforeFilter).map(value=>value.target.id),[7]);
  h.unchanged();
});

test('GSM action arguments preserve typed zero and a zero purchase ID remains a refuelling source',()=>{
  const h=harness();
  assert.equal(h.context.gsmArg(0),'0');
  assert.equal(h.context.gsmArg('0'),'&quot;0&quot;');
  const argument=value=>JSON.parse(h.context.gsmArg(value).replace(/&quot;/g,'"').replace(/&amp;/g,'&'));
  assert.equal(argument(0),0);assert.equal(argument('0'),'0');
  const row={kind:'grade-reconciliation',purchaseId:0,date:'2026-09-10',fromGrade:'АИ-95',toGrade:'АИ-92'};
  assert.match(h.context.gsmMovementSource(row),/^Заправка от 2026-09-10/);
  assert.match(h.context.gsmMovementSource({...row,purchaseId:null}),/^Замер остатка от 2026-09-10/);
  h.unchanged();
});

test('physical tank presentation keeps unknown and negative balances explicit without altering source facts',()=>{
  const h=harness(database({tanks:[
    {id:0,name:'SYNTHETIC UNKNOWN TANK',fuel:'diesel',balanceInit:100},
    {id:'negative',name:'SYNTHETIC NEGATIVE TANK',fuel:'diesel',balanceInit:2}
  ],tankIncomes:[{id:'unknown-quantity',tankId:0,date:'2026-09-10',amount:'unknown'}],
  fuelMovements:[{id:'draw',kind:'issue',fromTankId:'negative',date:'2026-09-11',qty:5,reason:'Synthetic documented issue'}]}));
  const html=h.context.gsmPhysicalTanksHtml(h.ledger);
  assert.match(html,/Расчётный остаток<\/dt><dd>Остаток не определён<\/dd>/);
  assert.match(html,/Расчётный остаток<\/dt><dd class="gsm-error">-3 л<\/dd>/);
  assert.doesNotMatch(html,/Расчётный остаток<\/dt><dd>0 л<\/dd>/);
  h.context.gsmSwitchView('operations');assert.equal(h.calls.renders,1);
  h.context.gsmSwitchView('unsupported');assert.equal(h.calls.renders,1);
  assert.equal(vm.runInContext('fpView',h.context),'operations');
  h.unchanged();
});
