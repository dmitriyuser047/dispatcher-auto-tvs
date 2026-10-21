'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {Worker}=require('node:worker_threads');
const audit=require('../assets/core/fuel-audit.js');
const fuel=require('../assets/core/fuel-engine.js');
const writeoff=require('../assets/core/writeoff-engine.js');
const application=require('../assets/core/application-engine.js');
const range={from:'2026-09-01',to:'2026-09-30'};
function base(){return {vehicles:[{id:'v',plate:'SYNTHETIC',org:'A',fuel:'gasoline',fuelGrade:'АИ-95',fuelBalance:10,norm:10}],records:[],fuelPurchases:[],fuelCards:[{id:'c',number:'111111',org:'A',assignments:[{vehicleId:'v'}]}],monthlyFuel:[]};}
function fixtures(){
  const negative=base();negative.records=[{id:'august-debt',vehicleId:'v',date:'2026-08-30',km:250,fuelActual:25,fuelGrade:'АИ-95'},
    {id:'september-receipt',vehicleId:'v',date:'2026-09-05',km:0,fuelActual:0,fuelIssued:5,fuelGrade:'АИ-95'},
    {id:'september-use',vehicleId:'v',date:'2026-09-10',km:30,fuelActual:3,fuelGrade:'АИ-95'}];
  negative.fuelPurchases=[{id:'supply',vehicleId:'v',recordId:'september-receipt',date:'2026-09-05',qty:5,grade:'АИ-95',cardNo:'111111'}];
  const measurement=base();measurement.vehicles[0].fuelBalance=1000;measurement.records=[{id:'august-measurement',vehicleId:'v',date:'2026-08-31',km:0,fuelActual:0,tankMeasured:923.537,fuelGrade:'АИ-95'},
    {id:'september-receipt',vehicleId:'v',date:'2026-09-05',km:100,fuelActual:10,fuelIssued:20,fuelGrade:'АИ-95'}];
  measurement.fuelPurchases=[{id:'supply',vehicleId:'v',recordId:'september-receipt',date:'2026-09-05',qty:20,grade:'АИ-95',cardNo:'111111'}];
  const duplicates=base();duplicates.records=[{id:'orphan',vehicleId:'missing',date:'2026-09-02',km:-1,fuelActual:'bad'},
    {id:'receipt',vehicleId:'v',date:'2026-09-03',km:0,fuelIssued:20,fuelActual:0,fuelGrade:'АИ-95'}];
  duplicates.fuelPurchases=[{id:'p1',vehicleId:'v',recordId:'receipt',date:'2026-09-03',qty:10,grade:'АИ-95',cardNo:'111111',time:'08:00'},
    {id:'p2',vehicleId:'v',recordId:'old-stale-record',date:'2026-09-03',qty:10,grade:'АИ-95',cardNo:'111111',time:'09:00',restored:true}];
  return {negative,measurement,duplicates};
}
// Captured by executing the original 25m-gsm-diagnostics.js BEFORE extraction.
// These cover the complete old output, including ordering, messages, numeric
// quantities, chronological causes and repair/source references.
const legacy={
  negative:{hash:'2172f33966a4e39842a5a2dfa51f075bb0ecdca74d1b2c4ddae9b56339c8b510',summary:{error:0,evidence:1,warning:1,total:2}},
  measurement:{hash:'e1c3403cad4a1a1e5fe8d10d2d6ff6799c2b3e25eff15fcaf5401bae99c44839',summary:{error:0,evidence:0,warning:1,total:1}},
  duplicates:{hash:'8e2fd745eb5ecbf21b7ed8ac3e11400ad49b3905e227776dbdcd600d1110254e',summary:{error:3,evidence:1,warning:2,total:6}}
};
const hash=value=>writeoff.sha256(writeoff.stableSerialize(value));
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

for(const [name,db]of Object.entries(fixtures()))test('portable audit matches complete pre-extraction '+name+' diagnostics and leaves all facts unchanged',()=>{
  const before=JSON.stringify(db),result=audit.buildModel(freeze(db),range);
  assert.equal(hash(result),legacy[name].hash);assert.deepEqual(result.summary,legacy[name].summary);assert.equal(JSON.stringify(db),before);
  const supplied=fuel.buildLedger(db,range),ledgerBefore=structuredClone(supplied),withLedger=audit.buildModel(db,{...range,ledger:supplied});
  assert.deepEqual(withLedger,result);assert.deepEqual(supplied,ledgerBefore);
  const engine=application.create(),snapshot=engine.capture(db,{identity:'synthetic-audit-'+name});
  assert.deepEqual(engine.querySnapshot('fuelAudit',snapshot,range),result);assert.equal(application.sections.fuelAudit,application.sections.fuel);
});

test('negative September stock retains its real August cause and does not invent an opening or target remainder',()=>{
  const db=fixtures().negative,result=audit.buildModel(db,range),negative=result.items.find(row=>row.code==='negative-ending');
  assert.equal(negative.earliestCauseDate,'2026-08-30');assert.deepEqual(negative.impact,{kind:'ending',qty:-13,opening:-15,closing:-13});assert.equal(negative.chronologyCount,5);
  assert.ok(negative.sourceRefs.some(ref=>ref.id==='august-debt'));assert.ok(negative.repairRefs.some(ref=>ref.type==='journal'&&ref.date==='2026-08-30'));
  assert.equal(db.vehicles[0].fuelBalance,10);assert.equal(db.records[0].km,250);assert.equal(db.records[0].fuelActual,25);
});

test('large actual measurement 923.537 is preserved and a possible duplicate remains a review issue',()=>{
  const data=fixtures(),measured=audit.buildModel(data.measurement,range),duplicate=audit.buildModel(data.duplicates,range);
  assert.equal(data.measurement.records[0].tankMeasured,923.537);assert.equal(measured.items.some(row=>row.code==='invalid-value'),false);assert.equal(measured.items[0].code,'ending-unmeasured');
  const review=duplicate.items.find(row=>row.code==='possible-duplicate');assert.equal(review.category,'evidence');assert.equal(review.impact.qty,10);
  assert.ok(review.sourceRefs.some(ref=>ref.id==='p1'));assert.ok(review.sourceRefs.some(ref=>ref.id==='p2'));assert.equal(data.duplicates.fuelPurchases.length,2);
  assert.ok(duplicate.items.some(row=>row.code==='record-vehicle-missing'));assert.ok(duplicate.items.some(row=>row.code==='stale-record-link'));
});

test('browser UMD and legacy UI shim require only the pure fuel core and return the unchanged model',()=>{
  const sandbox=vm.createContext({}),directory=path.resolve(__dirname,'../assets/core');
  for(const file of ['decimal-core.js','fuel-engine.js','fuel-audit.js'])vm.runInContext(fs.readFileSync(path.join(directory,file),'utf8'),sandbox,{filename:file});
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../assets/js/25m-gsm-diagnostics.js'),'utf8'),sandbox,{filename:'25m-gsm-diagnostics.js'});
  const result=sandbox.gsmAuditModel(fixtures().negative,range);assert.equal(hash(result),legacy.negative.hash);assert.equal(sandbox.TvsFuelAudit.apiVersion,1);
  assert.equal(Object.isFrozen(sandbox.TvsFuelAudit),true);assert.equal(Object.isFrozen(sandbox.TvsFuelAudit.rules),true);assert.equal(Object.isFrozen(sandbox.TvsFuelAudit.rules['negative-input']),true);
  assert.equal(typeof sandbox.document,'undefined');assert.equal(typeof sandbox.localStorage,'undefined');assert.equal(typeof sandbox.fetch,'undefined');
});

test('real calculation worker returns pre-extraction audit goldens for negative history, measurement and disputed sources',async t=>{
  const file=require.resolve('../assets/core/engine-worker.js'),worker=new Worker("const{parentPort}=require('node:worker_threads');const endpoint=require("+JSON.stringify(file)+").createHandler({postMessage:m=>parentPort.postMessage(m)});parentPort.on('message',m=>endpoint.handle(m));",{eval:true});
  t.after(()=>worker.terminate());
  const send=message=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{worker.removeListener('message',receive);reject(Error('Synthetic fuel audit worker timed out'));},10000);
    function receive(result){if(result.requestId!==message.requestId)return;worker.removeListener('message',receive);clearTimeout(timer);resolve(result);}worker.on('message',receive);worker.postMessage(message);});
  let generation=0;
  for(const [name,db]of Object.entries(fixtures())){
    generation++;const identity='worker-audit-'+name,loaded=await send({type:'load',requestId:'load-'+name,generation,database:db,context:{identity}});assert.equal(loaded.ok,true);
    const result=await send({type:'query',requestId:'audit-'+name,generation,identity,sourceFingerprint:loaded.sourceFingerprint,name:'fuelAudit',options:range});
    assert.equal(result.ok,true,JSON.stringify(result.error));assert.equal(hash(result.value),legacy[name].hash);assert.deepEqual(result.value.summary,legacy[name].summary);
  }
});
