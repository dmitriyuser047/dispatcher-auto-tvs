'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module');
const root=path.resolve(__dirname,'..'),original=path.join(root,'assets/core/generator-spares.js'),fixture=path.join(__dirname,'fixtures/generator-spares-before-batch'),pin=JSON.parse(fs.readFileSync(path.join(fixture,'source.json'),'utf8')),frozen=fs.readFileSync(path.join(fixture,'generator-spares.js'));
assert.equal(crypto.createHash('sha256').update(frozen).digest('hex'),pin.sha256);
function load(bytes,overrides={}){const mod=new Module(original,module),base=Module.createRequire(original);mod.filename=original;mod.paths=Module._nodeModulePaths(path.dirname(original));mod.require=name=>Object.hasOwn(overrides,name)?overrides[name]:base(name);mod._compile(bytes.toString('utf8'),original);return mod.exports;}
const old=load(frozen),current=require(original),schema=require('../assets/core/platform-schema.js'),inventory=require('../assets/core/inventory-stock.js'),contracts=require('../assets/core/platform-contracts.js'),context={today:'2026-10-30',now:'2026-10-30T12:00:00Z'};
function database(count=12,movements=60){const db=Object.fromEntries(schema.sections.map(name=>[name,[]]));db.generators=[{id:0,name:'SYNTHETIC NUMBER DES'},{id:'0',name:'SYNTHETIC TEXT DES'}];db.parts=Array.from({length:count},(_,index)=>({id:index===1?'0':index===0?0:'part-'+index,generatorId:index%2?'0':0,name:'SYNTHETIC PART '+index,unit:'шт',minStock:0}));db.partMovements=Array.from({length:movements},(_,index)=>({id:'movement-'+index,partId:db.parts[Math.floor(index/2)%count].id,date:index%2?'2026-10-02':'2026-10-01',kind:index%2?'issue':'receipt',qty:index%3?1.25:2.5,assetRef:'g:0'}));return db;}
const targets=db=>db.parts.map(part=>({generatorId:part.generatorId,partId:part.id}));
function compare(db,ctx=context){const before=JSON.stringify(db),selected=targets(db),expected=selected.map(target=>old.lifecycleState(db,target,ctx)),actual=current.lifecycleStates(db,selected,ctx);assert.deepEqual(actual,expected);assert.deepEqual(selected.map(target=>current.lifecycleState(db,target,ctx)),expected);assert.equal(JSON.stringify(db),before);return actual;}

test('batch stock states preserve all original references, blockers, balances, order and typed zero IDs',()=>{
 for(const status of ['new','approved','cancelled','accepted','archived']){const db=database();for(const [index,part]of db.parts.entries()){part.archived=index%4===0;db.generatorMaintenancePlans.push({id:'plan-'+index,status,rows:[{components:[{partId:part.id,qty:1}]}],snapshot:{rows:[{components:[{part:{id:part.id,name:'FROZEN'}}]}]}});db.procurementOrders.push({id:'order-'+index,status,kind:'part',itemId:part.id});db.savedReestrs.push({id:'saved-'+index,snapshot:{parts:[{id:part.id}]}});}compare(db);}
});

test('batch states keep unknown, negative-history, future and legacy opening stock blocked exactly as before',()=>{
 for(const change of [db=>{db.partMovements[0].qty=null;},db=>{db.partMovements[0].date='2026-11-01';},db=>{db.partMovements[0].kind='issue';},db=>{db.parts[0].stockInit=7;},db=>{db.parts[0].mergedInto={section:'parts',id:'0'};},db=>{db.generators[0].archived=true;},db=>{db.partMovements[0].date='INVALID';},db=>{db.partMovements[0].qty=0.10000000000000002;}]){const db=database();change(db);compare(db);}
});

test('batch verification never reuses an earlier snapshot or authority and rejects incomplete or executable inputs',()=>{
 const db=database(),selected=targets(db);compare(db);db.procurementRules=[{id:'new-hidden-link',kind:'part',itemId:0}];const changed=compare(db);assert.equal(changed[0].canArchive,false);assert.throws(()=>current.lifecycleStates(db,selected,{...context,readable:['parts']}),{code:'ACCESS_DENIED'});assert.throws(()=>current.lifecycleStates(db,[],{...context,readable:[]}),{code:'ACCESS_DENIED'});delete db.savedReestrs;assert.throws(()=>current.lifecycleStates(db,selected,context),{code:'SPARES_SOURCE_INCOMPLETE'});
 const executable=database();let reads=0;Object.defineProperty(executable.parts[0],'malicious',{get(){reads++;return 1;},enumerable:true});assert.throws(()=>current.lifecycleStates(executable,targets(executable),context));assert.equal(reads,0);
 const corruptTargets=[{generatorId:0,partId:0}];Object.defineProperty(corruptTargets[0],'generatorId',{get(){reads++;return 0;},enumerable:true});assert.throws(()=>current.lifecycleStates(database(),corruptTargets,context));assert.equal(reads,0);
});

test('one batch builds one stock projection and avoids validating the whole database for every position',()=>{
 const db=database(40,2000),selected=targets(db),stats={old:{projections:0,databaseValidations:0},batch:{projections:0,databaseValidations:0}};
 const counted=(bytes,name)=>load(bytes,{'./inventory-stock.js':{...inventory,project(...args){stats[name].projections++;return inventory.project(...args);}},'./platform-contracts.js':{...contracts,validateSections(value,names){if(names.includes('parts'))stats[name].databaseValidations++;return contracts.validateSections(value,names);}}});
 const oracle=counted(frozen,'old'),optimized=counted(fs.readFileSync(original),'batch');const before=performance.now(),expected=selected.map(target=>oracle.lifecycleState(db,target,context)),oldMs=performance.now()-before,start=performance.now(),actual=optimized.lifecycleStates(db,selected,context),batchMs=performance.now()-start;assert.deepEqual(actual,expected);assert.equal(stats.old.projections,40);assert.equal(stats.batch.projections,1);assert.equal(stats.old.databaseValidations,40);assert.equal(stats.batch.databaseValidations,1);
 console.log('SYNTHETIC_BATCH_BENCHMARK '+JSON.stringify({parts:40,movements:2000,oldMs:+oldMs.toFixed(2),batchMs:+batchMs.toFixed(2),stats}));
});

test('duplicate IDs, incorrect owners and unavailable inventory never grant an operation through batching',()=>{
 for(const edit of [db=>db.parts.push({...db.parts[0]}),db=>db.parts[0].generatorId='wrong']){const db=database();const selected=targets(db);edit(db);assert.throws(()=>current.lifecycleStates(db,selected,context),{code:'SPARES_TARGET'});}
 const db=database(),selected=targets(db),broken={...inventory,project(){throw Error('Synthetic invalid projection');}},oracle=load(frozen,{'./inventory-stock.js':broken}),optimized=load(fs.readFileSync(original),{'./inventory-stock.js':broken});assert.deepEqual(optimized.lifecycleStates(db,selected,context),selected.map(target=>oracle.lifecycleState(db,target,context)));
});

test('repeated targets return independent values and do not retain mutable input or results between calls',()=>{
 const db=database(),target=targets(db)[0],states=current.lifecycleStates(db,[target,target],context);assert.deepEqual(states[0],states[1]);states[0].references[0].path='OUTPUT ONLY';assert.notEqual(states[0].references[0].path,states[1].references[0].path);const again=current.lifecycleStates(db,[target],context);assert.deepEqual(again[0],old.lifecycleState(db,target,context));
});

module.exports={load,frozen,database,targets,context};
