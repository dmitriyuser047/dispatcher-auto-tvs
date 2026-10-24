'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const state=require('../assets/core/document-state.js'),engine=require('../assets/core/document-engine.js');
const actor={id:'synthetic',name:'Synthetic author',role:'admin'},context={id:'synthetic-operation',now:'2026-10-22T12:00:00.000Z',today:'2026-10-22',actor};
const copy=value=>JSON.parse(JSON.stringify(value));

test('DocumentEngine preserves its public projection and metadata API through the one state implementation',()=>{
 for(const name of ['state','resolveSection','resolveDocument','activeRows','effectiveRow','rootId','isValidReversal','postedMetadata','voidMetadata'])assert.equal(engine[name],state[name],name);
 assert.ok(Object.isFrozen(state));assert.equal(state.plan,undefined);assert.equal(state.preview,undefined);assert.equal(state.validateChanges,undefined);
});

test('the lower document state module works alone in the browser without business planners',()=>{
 const browser=vm.createContext({});for(const name of ['platform-contracts','entity-identity','decimal-core','business-calendar','document-state'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/core',name+'.js'),'utf8'),browser,{filename:name+'.js'});
 const db={payments:[{id:0,sum:100,paidAmount:20},{id:'0',sum:200,paid:false}]};assert.deepEqual(copy(browser.DocumentState.resolveSection(db,'payments')),state.resolveSection(db,'payments'));
 assert.equal(browser.DocumentEngine,undefined);assert.equal(browser.PlatformCommands,undefined);assert.equal(browser.FuelOperations,undefined);
 assert.deepEqual(copy(browser.DocumentState.postedMetadata(context)),state.postedMetadata(context));
});

test('revision identity, settlements, void state and malformed chains preserve historical facts exactly',()=>{
 const root={id:0,date:'2026-09-01',sum:100,paidAmount:10,lifecycle:{version:1,postedAt:context.now},paymentSettlements:{version:1,events:[{operationId:'payment-event',amount:15,date:'2026-09-02',at:context.now,actor,reason:'Actual synthetic payment'}]}},correction={id:'0',date:'2026-09-01',sum:120,lifecycle:{version:1,postedAt:context.now,correctionOf:{section:'payments',id:0},reason:'Synthetic factual correction'}},db={payments:[root,correction]},before=JSON.stringify(db),resolved=state.resolveDocument(db,{section:'payments',id:0});
 assert.equal(resolved.root.id,0);assert.equal(resolved.current.id,'0');assert.deepEqual(resolved.history,[root,correction]);assert.equal(resolved.effective.paidAmount,25);assert.equal(resolved.effective.paid,false);assert.equal(resolved.effective.paidDate,'2026-09-02');assert.equal(JSON.stringify(db),before);
 const invalid={payments:[root,correction,{...correction,id:'fork'}]};assert.ok(state.resolveSection(invalid,'payments').diagnostics.some(issue=>issue.code==='DOCUMENT_FORK'));assert.throws(()=>state.resolveDocument(invalid,{section:'payments',id:0}),{code:'DOCUMENT_FORK'});
 const voided={...correction,lifecycle:{...correction.lifecycle,void:{at:context.now,actor,reason:'Synthetic cancellation'}}};assert.equal(state.state('payments',voided),'void');assert.deepEqual(state.activeRows({payments:[root,voided]},'payments'),[]);
});

test('versioned fuel writeoff snapshots and legacy values remain literal inputs to the state layer',()=>{
 for(const version of [1,2,3,4]){
  const document={id:'act-'+version,status:'posted',calculationVersion:version,snapshot:{algorithmVersion:version,ledger:{rows:[{vehicleId:0,start:923.537,spent:1,end:922.537}]}},rows:[{vehicleId:0,start:923.537,spent:1,end:922.537}]},legacy={id:0,status:'draft',note:'Legacy observable state'},db={fuelWriteoffs:[document,legacy]},before=JSON.stringify(db);
  assert.deepEqual(state.activeRows(db,'fuelWriteoffs'),[document,legacy]);assert.deepEqual(state.effectiveRow(db,'fuelWriteoffs',document.id),document);assert.equal(JSON.stringify(db),before);
 }
});

test('personnel workflow retains exact legacy role interpretation through lower shared facts',()=>{
 const kinds=require('../assets/core/personnel-kinds.js'),personnel=require('../assets/core/personnel-engine.js');
 for(const name of ['rolesOf','kindForAsset','matchesRole'])assert.equal(personnel[name],kinds[name]);
 for(const [row,expected]of [[{},['driver']],[{personnelRoles:['operator','driver','operator']},['driver','operator']],[{personnelRoles:[]},[]],[{personnelRoles:'driver'},[]],[null,[]]])assert.deepEqual(kinds.rolesOf(row),expected);
 assert.equal(kinds.kindForAsset('v:0'),'driver');assert.equal(kinds.kindForAsset('g:0'),'operator');assert.equal(kinds.kindForAsset('t:0'),null);assert.equal(kinds.matchesRole({personnelRoles:['operator']},'driver'),false);
});

test('stable record identity retains typed, natural, composite and positional legacy keys',()=>{
 const identities=require('../assets/core/record-identity.js'),integrity=require('../assets/core/platform-integrity.js');assert.equal(integrity.rowIdentity,identities.rowIdentity);
 assert.equal(identities.rowIdentity('vehicles',{id:0},7),'number:0');assert.equal(identities.rowIdentity('vehicles',{id:'0'},7),'string:0');assert.equal(identities.rowIdentity('vehicles',{},7),'@7');
 assert.equal(identities.rowIdentity('fuelCards',{number:'12 34-56'},0),'natural:string:123456');
 assert.equal(identities.rowIdentity('monthlyFuel',{vehicleId:0,month:'2026-09'},0),identities.rowIdentity('monthlyFuel',{vehicleId:0,month:'2026-09'},9));
});

test('public workflow APIs delegate unchanged read diagnostics to lower fact and inspection modules',()=>{
 const inspection=require('../assets/core/workflow-inspection.js'),validation=require('../assets/core/workflow-validation.js'),policies=require('../assets/core/platform-policies.js'),facts=require('../assets/core/document-facts.js'),lifecycle=require('../assets/core/document-lifecycle.js'),catalogFacts=require('../assets/core/catalog-facts.js'),catalog=require('../assets/core/catalog-policy.js');
 assert.equal(policies.inspect,inspection.inspect);assert.equal(policies.validateChanges,validation.validateChanges);assert.equal(lifecycle.inspect,facts.inspect);assert.equal(lifecycle.reversalCheck,facts.reversalCheck);assert.equal(catalog.inspect,catalogFacts.inspect);
 const db={shiftReports:[{id:0,status:'accepted'}],fuelMovements:[{id:'broken',originalMovementId:0,qty:1,date:'2026-09-01'}]},before=JSON.stringify(db);
 assert.deepEqual(facts.inspect(db,{readable:['shiftReports']}).issues,[{severity:'error',section:'shiftReports',recordId:0,code:'DOCUMENT_ACCEPTANCE_REQUIRED',field:'acceptedBy',message:'Для принятой сменной формы укажите принявшего',proof:undefined}]);
 assert.equal(facts.inspect(db,{readable:['fuelMovements']}).issues[0].code,'DOCUMENT_REVERSAL_INVALID');assert.equal(JSON.stringify(db),before);
});
