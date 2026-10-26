'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),{createRequire}=require('node:module');
// Exercise the current strict TS source without altering generated release files.
const entry=require('../scripts/build-typed-core.cjs').compileTypedCore().artifacts.find(value=>value.source==='src/core/asset-inventory.ts'),moduleValue={exports:{}};
vm.runInNewContext(entry.artifact,{module:moduleValue,exports:moduleValue.exports,require:createRequire(entry.outputPath)},{filename:entry.outputPath});
const api=moduleValue.exports,copy=value=>JSON.parse(JSON.stringify(value)),clock=id=>({id,now:'2026-10-26T12:00:00.000Z',today:'2026-10-26',actor:{id:'count-test',name:'Synthetic counter',role:'admin'}});
function database(qty=3,cost=10){return {inventoryOrgs:[{id:0,name:'Organisation',note:''}],inventoryObjects:[{id:0,name:'Object',note:''}],inventoryMols:[{id:0,name:'MOL',orgId:0,objectId:0,accountCode:'01',note:''}],inventoryItems:[{id:0,molId:0,name:'Item',code:'001',unit:'шт',qty,cost,note:''},{id:'legacy',molId:0,name:'Legacy item',code:'002',unit:'шт',qty:4,cost:40,note:''}],inventorySessions:[]};}
function execute(db,input,id='operation'){const preview=api.preview(db,input,{today:'2026-10-26'});assert.equal(preview.canApply,true,JSON.stringify(preview.issues));const result=api.plan(db,{...input,reviewFingerprint:preview.fingerprint},clock(id));return {...db,...copy(result.sections)};}
function draft(qty,cost){return execute(database(qty,cost),{action:'createSession',objectId:0,date:'2026-10-26',title:'Synthetic count',reason:'Synthetic new count'},'session');}
function input(db,overrides={}){const session=db.inventorySessions[0];return {action:'saveDraft',sessionId:session.id,reason:'Synthetic count decision',payload:{date:session.date,title:session.title,note:'',commission:{chairman:{name:'Chairman',position:'Position'},members:[]},facts:session.rows.map((row,index)=>({rowId:row.id,qtyFact:index===0?1:4,costFact:index===0?9999:17.35,action:'',note:'',...(index===0?overrides:{})}))}};}
const same=(matches=false)=>({countMode:'samePrice',matches});

test('matching copies the frozen accounting values, while manual counts use the same unit price',()=>{
 const base={qtyAcct:4,costAcct:40},matched=api.countValue(base,{matches:true,qtyFact:0});assert.equal(matched.qtyFact,4);assert.equal(matched.costFact,40);assert.equal(matched.matches,true);assert.equal(matched.unitPriceDecimal,'10');
 const manual=api.countValue(base,{matches:false,qtyFact:2});assert.equal(manual.qtyFact,2);assert.equal(manual.costFact,20);assert.equal(manual.unitPriceDecimal,matched.unitPriceDecimal);assert.equal(api.countValue(base,{matches:false,qtyFact:0}).costFact,0);assert.equal(api.countValue(base,{matches:false,qtyFact:null}).costFact,null);
});
test('money rounds only after the exact ratio, including repeating prices and fractional quantities',()=>{
 assert.equal(api.countValue({qtyAcct:3,costAcct:10},{matches:false,qtyFact:1}).costFact,3.33);
 assert.equal(api.countValue({qtyAcct:3,costAcct:1},{matches:false,qtyFact:3}).costFact,1);
 assert.equal(api.countValue({qtyAcct:3,costAcct:1},{matches:false,qtyFact:1000000000000}).costFact,333333333333.33);
 assert.equal(api.countValue({qtyAcct:2,costAcct:0.01},{matches:false,qtyFact:1}).costFact,0.01);
 assert.equal(api.countValue({qtyAcct:0.3,costAcct:0.1},{matches:false,qtyFact:0.1}).costFact,0.03);
 assert.equal(api.countValue({qtyAcct:0.001,costAcct:0.01},{matches:false,qtyFact:0.002}).costFact,0.02);
});
test('an independent integer cents oracle agrees with manual count totals',()=>{
 for(let quantity=1;quantity<=19;quantity++)for(let actual=0;actual<=23;actual+=3){const cents=quantity*7+5,expected=Number((2n*BigInt(cents)*BigInt(actual)+BigInt(quantity))/(2n*BigInt(quantity)))/100;assert.equal(api.countValue({qtyAcct:quantity,costAcct:cents/100},{matches:false,qtyFact:actual}).costFact,expected);}
});
test('unknown or zero accounting quantity never invents a unit price',()=>{
 for(const base of [{qtyAcct:null,costAcct:10},{qtyAcct:0,costAcct:0},{qtyAcct:0,costAcct:99},{qtyAcct:4,costAcct:null}])for(const actual of [0,2,null]){const value=api.countValue(base,{matches:false,qtyFact:actual});assert.equal(value.unitPriceDecimal,null);assert.equal(value.unitPrice,null);assert.equal(value.costFact,null);}
 assert.throws(()=>api.countValue({qtyAcct:null,costAcct:10},{matches:true,qtyFact:0}),error=>error.code==='INVENTORY_MATCH_UNKNOWN');assert.equal(api.countValue({qtyAcct:0,costAcct:0},{matches:true,qtyFact:null}).costFact,0);assert.equal(api.countValue({qtyAcct:0,costAcct:99},{matches:true,qtyFact:null}).costFact,99);assert.equal(api.countValue({qtyAcct:4,costAcct:0},{matches:false,qtyFact:2}).costFact,0);
});
test('the server computes new-mode totals independently of forged renderer cost or matching quantity',()=>{
 let db=draft(3,10);db=execute(db,input(db,same(false)),'manual');assert.equal(db.inventorySessions[0].rows[0].costFact,3.33);assert.equal(db.inventorySessions[0].rows[0].countMode,'samePrice');assert.equal(db.inventorySessions[0].rows[1].costFact,17.35);assert.equal(db.inventorySessions[0].rows[1].countMode,undefined);
 const request=input(db,{...same(true),qtyFact:0,costFact:999});db=execute(db,request,'matching');const row=db.inventorySessions[0].rows[0];assert.equal(row.qtyFact,3);assert.equal(row.costFact,10);assert.equal(row.matches,true);assert.equal(db.inventorySessions[0].rows[1].costFact,17.35);
});
test('legacy manual totals remain unchanged until that row enters the new count mode',()=>{
 let db=draft(3,10),request=input(db);request.payload.facts[0].costFact=17.35;db=execute(db,request,'legacy');const before=JSON.stringify(db.inventorySessions[0]);api.countValue(db.inventorySessions[0].rows[0],{matches:false,qtyFact:1});api.validate(db);assert.equal(JSON.stringify(db.inventorySessions[0]),before);assert.equal(db.inventorySessions[0].rows[0].costFact,17.35);assert.equal(db.inventorySessions[0].rows[0].countMode,undefined);
 db=execute(db,input(db,same(false)),'new-mode');assert.equal(db.inventorySessions[0].rows[0].costFact,3.33);assert.equal(db.inventorySessions[0].rows[1].costFact,17.35);
});
test('accounting amendments preserve observed facts and clear only the affected old matching decision',()=>{
 let db=draft(3,10);db=execute(db,input(db,same(true)),'count');const first=db.inventorySessions[0].rows[0],second=copy(db.inventorySessions[0].rows[1]);
 db=execute(db,{action:'amendDraft',sessionId:'session',corrections:[{rowId:first.id,unit:'шт',qtyAcct:6,costAcct:12}],reason:'Explicit source accounting correction'},'correction');const row=db.inventorySessions[0].rows[0];assert.equal(row.qtyAcct,6);assert.equal(row.costAcct,12);assert.equal(row.qtyFact,3);assert.equal(row.costFact,10);assert.equal(row.countMode,undefined);assert.equal(row.matches,undefined);assert.deepEqual(db.inventorySessions[0].rows[1],second);assert.equal(db.inventorySessions[0].amendments.length,1);
});
test('new-mode metadata and computed values are validated and frozen in the approved snapshot',()=>{
 let db=draft(3,10);assert.equal(db.inventorySessions[0].rows[0].qtyFact,null);assert.equal(db.inventorySessions[0].rows[0].matches,undefined);db=execute(db,input(db,same(false)),'count');const corrupted=copy(db);corrupted.inventorySessions[0].rows[0].costFact=123;assert.throws(()=>api.validate(corrupted),error=>error.code==='INVENTORY_COUNT_VALUE');
 db=execute(db,{action:'approve',sessionId:'session',date:'2026-10-26',document:'Synthetic approval',reason:'Explicit approval'},'approval');const session=db.inventorySessions[0],before=JSON.stringify(session);assert.equal(session.snapshot.rows[0].costFact,3.33);assert.equal(session.snapshot.rows[0].countMode,'samePrice');assert.equal(session.snapshot.rows[0].matches,false);assert.equal(api.exportModel(session).rows[0].costFact,3.33);assert.equal(JSON.stringify(session),before);const forbidden=input(db,same(true)),blocked=api.preview(db,forbidden,{today:'2026-10-26'});assert.equal(blocked.canApply,false);assert.ok(blocked.issues.some(issue=>issue.code==='INVENTORY_FROZEN'));assert.throws(()=>api.plan(db,{...forbidden,reviewFingerprint:blocked.fingerprint},clock('forbidden')),error=>error.code==='INVENTORY_BLOCKED'&&error.issues.some(issue=>issue.code==='INVENTORY_FROZEN'));
});
test('invalid modes, nonboolean matches and nondecimal quantities cannot become checked facts',()=>{
 const db=draft(3,10);for(const extra of [{matches:true},{countMode:'wrong',matches:false},{countMode:'samePrice',matches:'yes'}])assert.throws(()=>api.parse(input(db,extra),true),error=>error.code==='INVENTORY_COUNT_MODE');
 for(const qtyFact of [-1,1.0001,'2'])assert.throws(()=>api.countValue({qtyAcct:3,costAcct:10},{matches:false,qtyFact}),error=>error.code==='INVENTORY_NUMBER');assert.throws(()=>api.countValue({qtyAcct:3,costAcct:10},{matches:false,qtyFact:Infinity}),error=>error.code==='INVENTORY_JSON');
});
