'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'../assets/core'),schema=require(path.join(root,'platform-schema.js')),facts=require(path.join(root,'integrity-facts.js')),inventory=require(path.join(root,'inventory-stock.js')),repairs=require(path.join(root,'repair-process.js'));
const fixture=patch=>({...Object.fromEntries(schema.sections.map(name=>[name,[]])),vehicles:[{id:0,org:'A'},{id:'0',org:'B'}],parts:[{id:0,unit:'шт.'},{id:'0',unit:'шт.'}],records:[{id:'r',vehicleId:0,date:'2026-09-01',km:1}],workOrders:[{id:'wo',assetRef:'v:0',status:'repairing'}],...patch});
const outcome=run=>{try{return {result:run()};}catch(error){return {name:error.name,code:error.code,message:error.message,issues:error.issues,details:error.details};}};
const load=(name,overrides={})=>{const module={exports:{}},context=vm.createContext({module,require:relative=>overrides[path.basename(relative)]||require(path.join(root,relative))});vm.runInContext(fs.readFileSync(path.join(root,name),'utf8'),context,{filename:name});return module.exports;};
const normalized=value=>JSON.parse(JSON.stringify(value));

test('structural shared-reference reuse matches independent full scans for changed and reverse relationships',()=>{
 const base=fixture({parts:[{id:0,qty:-1},{id:0,qty:2},{id:'0',qty:1}],fuelPurchases:[{id:'p',vehicleId:0,date:'2026-09-01',grade:'ДТ',recordId:'legacy-stale'}],records:[{id:'r',vehicleId:0,date:'2026-09-01',fuelGrade:'ДТ',km:1}],fuelCards:[{id:'card',number:'123',assignments:[{vehicleId:0,from:'2026-09-01'}]}]});
 const changes=[db=>({...db,records:db.records.map(row=>({...row,note:'new'}))}),db=>({...db,vehicles:db.vehicles.filter(row=>row.id!==0)}),db=>({...db,records:[]}),db=>({...db,records:[...db.records,{id:'new',vehicleId:'missing',date:'2026-09-03',km:1}]}),db=>({...db,vehicles:db.vehicles.map(row=>({...row,archived:true})),records:db.records.map(row=>({...row,vehicleId:'0'}))}),db=>({...db,parts:[...db.parts,{id:'new',qty:'invalid'}]}),db=>({...db,records:[...db.records,...db.records]}),db=>({...db,fuelPurchases:db.fuelPurchases.map(row=>({...row,recordId:'another-stale'}))})];
 for(const change of changes){const after=change(base),saved=JSON.stringify([base,after]);for(const context of [{},{readable:['records','vehicles'],writable:['records']},{readable:['*'],writable:['*']}])assert.deepEqual(outcome(()=>facts.validateChanges(base,after,context)),outcome(()=>facts.validateChanges(structuredClone(base),structuredClone(after),context)));assert.equal(JSON.stringify([base,after]),saved);}
});

test('structural diagnostics for unchanged corrupt graphs and calendar-sensitive rows remain fresh',()=>{
 const cycle={id:'cycle'};cycle.loop=cycle;
 const before=fixture({parts:[cycle,{id:'bad',qty:NaN}],workOrders:[{id:'wo',assetRef:'v:0',status:'new',downtimeFrom:'2026-09-02T12:00Z',downtimeTo:'2026-09-01T12:00Z'}]}),after={...before,records:before.records.map(row=>({...row,note:'Allowed unrelated note'})),appMeta:[{id:'business-calendar',kind:'businessCalendar',version:1,timeZone:'UTC'}]};
 assert.deepEqual(outcome(()=>facts.validateChanges(before,after)),outcome(()=>facts.validateChanges(structuredClone(before),structuredClone(after))));
 const reversed={...before,workOrders:before.workOrders.map(row=>({...row,downtimeTo:'2026-08-31T12:00Z'}))};assert.equal(outcome(()=>facts.validateChanges(before,reversed)).code,'INTEGRITY_VIOLATION');
});

test('stock transition reports match fresh inspection and retain precise new-outflow guards',()=>{
 const before=fixture({partMovements:[{id:'in',partId:0,date:'2026-09-01',kind:'receipt',qty:.001}]}),same={...before,records:before.records.map(row=>({...row,note:'new'}))},next={...before,partMovements:[...before.partMovements,{id:'out',partId:0,date:'2026-09-02',kind:'issue',qty:.0010000000001}]};
 for(const after of [same,next]){const session=inventory.prepareValidation(before,after);assert.deepEqual(session.before.issues,inventory.inspect(before).issues);assert.deepEqual(session.after.issues,inventory.inspect(after).issues);assert.ok(Object.isFrozen(session.before.issues));assert.deepEqual(outcome(()=>session.validate()),outcome(()=>inventory.validateChanges(structuredClone(before),structuredClone(after))));}
 assert.equal(outcome(()=>inventory.validateChanges(before,next)).code,'POLICY_VIOLATION');
 let invoked=false;const corrupt={...before};Object.defineProperty(corrupt,'parts',{enumerable:true,get(){invoked=true;return [];}});const session=inventory.prepareValidation(before,corrupt);assert.equal(session.after.issues[0].code,'PART_SOURCE_INVALID');assert.deepEqual(outcome(()=>session.validate()),outcome(()=>inventory.validateChanges(before,corrupt)));assert.equal(invoked,false);
});

test('repair transition reuses owned models without changing material, source, context or permission failures',()=>{
 const before=fixture({vehicles:[{id:'a'},{id:'b'}],workOrders:[{id:'wo',assetRef:'v:a',status:'repairing'}],partMovements:[{id:'issue',partId:0,date:'2026-09-01',kind:'issue',qty:1,assetRef:'v:a',workOrderId:'wo'}]}),same={...before,records:[{id:'r',vehicleId:'a',date:'2026-09-01',km:2}]},bad={...before,partMovements:[...before.partMovements,{id:'return',partId:0,date:'2026-09-02',kind:'return',qty:2,assetRef:'v:a',workOrderId:'wo',repairReturn:{version:1,issueId:'issue'}}]};
 for(const after of [same,bad])for(const context of [{},{readable:['workOrders','parts','partMovements']},{readable:[]},{includeCosts:'invalid'}]){const session=repairs.prepareValidation(before,after,context);assert.deepEqual(session.before.issues,repairs.inspect(before,context).issues);assert.deepEqual(session.after.issues,repairs.inspect(after,context).issues);assert.ok(Object.isFrozen(session.after.issues));assert.deepEqual(outcome(()=>session.validate()),outcome(()=>repairs.validateChanges(structuredClone(before),structuredClone(after),context)));}
 assert.equal(outcome(()=>repairs.validateChanges(before,bad)).code,'POLICY_VIOLATION');
});

test('workflow owns one stock and repair transition per call and keeps public diagnostics uncached',()=>{
 const counts={stock:0,repair:0,stockGuard:0,repairGuard:0,stockInspect:0,repairInspect:0};
 const proxy=(api,label)=>({...api,inspect(...args){counts[label+'Inspect']++;return api.inspect(...args);},prepareValidation(...args){counts[label]++;const session=api.prepareValidation(...args);return {...session,validate(){counts[label+'Guard']++;return session.validate();}};}}),stock=proxy(inventory,'stock'),repair=proxy(repairs,'repair'),overrides={'inventory-stock.js':stock,'repair-process.js':repair},inspection=load('workflow-inspection.js',overrides),workflow=load('workflow-validation.js',{...overrides,'workflow-inspection.js':inspection});
 const before=fixture({workOrders:[]}),after={...before,records:before.records.map(row=>({...row,note:'revised'}))};assert.equal(workflow.validateChanges(before,after),true);assert.deepEqual(counts,{stock:1,repair:1,stockGuard:1,repairGuard:1,stockInspect:0,repairInspect:0});
 inspection.inspect(before);inspection.inspect(before);assert.equal(counts.stockInspect,2);assert.equal(counts.repairInspect,2);assert.equal(workflow.validateChanges(before,after),true);assert.equal(counts.stock,2);assert.equal(counts.repair,2);
 const oldStock={...inventory},oldRepair={...repairs};delete oldStock.prepareValidation;delete oldRepair.prepareValidation;const legacyInspection=load('workflow-inspection.js',{'inventory-stock.js':oldStock,'repair-process.js':oldRepair}),legacyWorkflow=load('workflow-validation.js',{'inventory-stock.js':oldStock,'repair-process.js':oldRepair,'workflow-inspection.js':legacyInspection});
 const bad={...before,partMovements:[{id:'bad',partId:0,date:'2026-09-01',kind:'issue',qty:2}]};assert.deepEqual(normalized(outcome(()=>workflow.validateChanges(before,bad))),normalized(outcome(()=>legacyWorkflow.validateChanges(before,bad))));
});


test('exported sessions reject in-place source and access mutation and never execute a newly installed getter',()=>{
 for(const api of [inventory,repairs]){
  const before=fixture({workOrders:[]}),after={...before,records:before.records.map(row=>({...row,note:'new'}))},context={readable:['*']},session=api.prepareValidation(before,after,context);
  after.parts[0].unit='changed';assert.throws(()=>session.validate(),{code:'VALIDATION_SOURCE_CHANGED'});
  const next=fixture({workOrders:[]}),ctx={readable:['*']},accessSession=api.prepareValidation(next,{...next},ctx);ctx.readable=[];assert.throws(()=>accessSession.validate(),{code:'VALIDATION_SOURCE_CHANGED'});
  const clean=fixture({workOrders:[]}),end={...clean},guard=api.prepareValidation(clean,end);let called=false;Object.defineProperty(end,'parts',{enumerable:true,get(){called=true;return [];}});assert.throws(()=>guard.validate(),{code:'VALIDATION_SOURCE_CHANGED'});assert.equal(called,false);
 }
});
