'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const api=require('../assets/core/asset-inventory.js');
const copy=value=>JSON.parse(JSON.stringify(value));
const context=id=>({id,now:'2026-10-25T12:00:00.000Z',today:'2026-10-25',actor:{id:'quantity-clerk',name:'Synthetic clerk',role:'admin'}});
function database(){return {
 inventoryOrgs:[{id:0,name:'Organization A',note:''},{id:'0',name:'Organization B',note:''}],
 inventoryObjects:[{id:0,name:'Site A',note:''},{id:'0',name:'Site B',note:''}],
 inventoryMols:[{id:0,name:'Keeper A',note:'',orgId:0,objectId:0,accountCode:'01'},{id:'0',name:'Keeper B',note:'',orgId:'0',objectId:0,accountCode:'10'},{id:2,name:'Keeper C',note:'',orgId:0,objectId:'0',accountCode:'01'}],
 inventoryItems:[{id:0,name:'Pump',code:'P',molId:0,unit:'шт',qty:0.1,cost:120,note:''},{id:'0',name:'Valve',code:'V',molId:0,unit:'шт',qty:0.2,cost:null,note:''},{id:2,name:'Cable',code:'C',molId:0,unit:'м',qty:10,cost:50,note:''},{id:3,name:'Spare pump',code:'P',molId:'0',unit:'шт',qty:0,cost:null,note:''},{id:4,name:'Other site',code:'O',molId:2,unit:'шт',qty:2,cost:20,note:''}],inventorySessions:[]};}
function action(db,input,id){const preview=api.preview(db,input,{today:'2026-10-25'});assert.equal(preview.canApply,true,JSON.stringify(preview.issues));return {...db,...copy(api.plan(db,{...input,reviewFingerprint:preview.fingerprint},context(id)).sections)};}
function count(db,sessionId,quantity){const session=db.inventorySessions.find(row=>row.id===sessionId);return action(db,{action:'saveDraft',sessionId,payload:{date:session.date,title:session.title,note:'',commission:{chairman:{name:'Counter',position:'Keeper'},members:[]},facts:session.rows.map(row=>({rowId:row.id,qtyFact:quantity(row),costFact:null,action:'',note:''}))},reason:'Physical verification'},'facts-'+sessionId);}
function approve(db,sessionId,approvalDate='2026-10-25'){return action(db,{action:'approve',sessionId,date:approvalDate,document:'Signed inventory',reason:'Approved physical verification'},'approval-'+sessionId);}
function observed(db,id='count-a',date='2026-10-20',quantity=row=>row.qtyAcct,approvalDate='2026-10-25'){
 db=action(db,{action:'createSession',objectId:0,date,title:'Count '+id,reason:'Object verification'},id);return approve(count(db,id,quantity),id,approvalDate);
}

test('object quantities retain exact decimals, typed IDs and independent organizations and units',()=>{
 const db=database(),before=JSON.stringify(db),model=api.quantityModel(db);
 assert.equal(JSON.stringify(db),before);assert.ok(Object.isFrozen(model)&&Object.isFrozen(model.rows));
 assert.equal(model.rows.length,5);assert.equal(model.totals.length,4);
 const group=model.totals.find(row=>row.objectId===0&&row.orgId===0&&row.unit==='шт');
 assert.equal(group.qtyAcctDecimal,'0.3');assert.equal(group.rows,2);assert.equal(group.qtyFact,null);
 assert.equal(model.rows.find(row=>row.itemId===3).qtyAcct,0);assert.equal(model.rows.find(row=>row.itemId===0).comparisonStatus,'unrecorded');
 assert.equal(model.rows.find(row=>row.itemId==='0').qtyAcct,0.2);assert.equal(model.summary.objects,2);assert.equal(model.summary.mols,3);
 assert.ok(model.rows.every(row=>!Object.hasOwn(row,'cost')&&!Object.hasOwn(row,'costAcct')));
});

test('unknown counts stay unknown, known zero stays zero, and missing units never combine',()=>{
 const db=database();db.inventoryItems[0].qty=null;db.inventoryItems[0].unit='';db.inventoryItems[1].unit='';
 const model=api.quantityModel(db,{objectId:0,orgId:0});assert.equal(model.summary.unknownAcct,1);
 const missing=model.totals.filter(row=>row.unit===null);assert.equal(missing.length,2);assert.equal(missing[0].qtyAcct,null);assert.equal(missing[1].qtyAcctDecimal,'0.2');
 assert.equal(api.quantityModel(db,{orgId:'0'}).rows[0].qtyAcctDecimal,'0');
});

test('filters respect typed zero IDs, search and account without modifying inventory',()=>{
 const db=database();assert.deepEqual(api.quantityModel(db,{objectId:'0'}).rows.map(row=>row.itemId),[4]);
 assert.deepEqual(api.quantityModel(db,{objectId:0,molId:'0',account:'10'}).rows.map(row=>row.itemId),[3]);
 assert.deepEqual(api.quantityModel(db,{orgId:0,search:'  pUmP  '}).rows.map(row=>row.itemId),[0]);
 assert.equal(api.quantityModel(db,{search:'site b'}).rows.length,1);
 assert.throws(()=>api.quantityModel(db,{}, {readable:['inventoryItems']}),error=>error.code==='ACCESS_DENIED');
 assert.throws(()=>api.quantityModel(db,{asOf:'2026-02-30'}),error=>error.code==='INVENTORY_DATE');
 assert.throws(()=>api.quantityModel(db,{objectId:null}),error=>error.code==='INVENTORY_ID');
});

test('archived items and any archived owner are absent from the active quantity register',()=>{
 for(const [section,id]of [['inventoryItems',0],['inventoryMols',0],['inventoryOrgs',0],['inventoryObjects',0]]){
  const db=database();db[section].find(row=>row.id===id).archived=true;
  assert.equal(api.quantityModel(db).rows.some(row=>row.itemId===0),false);
 }
});

test('approved facts compare with current quantities and never post a catalog adjustment',()=>{
 const db=observed(database(),'count-a','2026-10-20',row=>row.itemId===0?0:row.qtyAcct),before=JSON.stringify(db);
 const model=api.quantityModel(db),pump=model.rows.find(row=>row.itemId===0);
 assert.equal(pump.qtyAcctDecimal,'0.1');assert.equal(pump.qtyFact,0);assert.equal(pump.differenceDecimal,'-0.1');
 assert.equal(pump.inventoryDate,'2026-10-20');assert.equal(pump.sessionId,'count-a');assert.equal(pump.comparisonStatus,'known');
 assert.equal(model.rows.find(row=>row.itemId===4).qtyFact,null);assert.equal(JSON.stringify(db),before);
});

test('unapproved revisions retain approved facts; later approved revision supersedes its root',()=>{
 let db=observed(database());db=action(db,{action:'revise',sessionId:'count-a',reason:'Repeat verification'},'count-a-r2');
 db=count(db,'count-a-r2',()=>5);assert.equal(api.quantityModel(db).rows[0].qtyFact,0.1);
 db=approve(db,'count-a-r2');const row=api.quantityModel(db).rows[0];assert.equal(row.qtyFact,5);assert.equal(row.sessionId,'count-a-r2');assert.equal(row.comparisonStatus,'known');
});

test('latest physical count date wins and future approvals are excluded by cutoff',()=>{
 let db=observed(database(),'earlier','2026-10-18',()=>1,'2026-10-25');
 db=observed(db,'later','2026-10-20',()=>2,'2026-10-21');
 assert.equal(api.quantityModel(db).rows[0].sessionId,'later');
 assert.equal(api.quantityModel(db,{asOf:'2026-10-22'}).rows[0].sessionId,'later');
 assert.equal(api.quantityModel(db,{asOf:'2026-10-19'}).rows[0].qtyFact,null);
});

test('independent conflicting counts on the same date remain ambiguous without an arbitrary fact',()=>{
 let db=observed(database(),'first','2026-10-20',()=>1);db=observed(db,'second','2026-10-20',()=>2);
 const model=api.quantityModel(db),row=model.rows[0];assert.equal(row.comparisonStatus,'ambiguous');assert.equal(row.qtyFact,null);assert.equal(row.sessionId,null);assert.equal(model.totals[0].qtyFact,null);
 const equal=observed(observed(database(),'first','2026-10-20',()=>1),'second','2026-10-20',()=>1);
 assert.equal(api.quantityModel(equal).rows[0].qtyFact,1);
});

test('changed location, keeper or unit prevents using an old snapshot as a current comparable fact',()=>{
 for(const [field,value,status]of [['molId',2,'scopeChanged'],['unit','л','unitChanged']]){
  const db=observed(database());db.inventoryItems[0][field]=value;const row=api.quantityModel(db).rows.find(row=>row.itemId===0);
  assert.equal(row.comparisonStatus,status);assert.equal(row.qtyFact,null);assert.equal(row.difference,null);assert.equal(row.sessionId,'count-a');
 }
});

test('totals expose a date range when last observations belong to different count dates',()=>{
 let db=observed(database(),'earlier','2026-10-18');
 db.inventoryItems.find(row=>row.id==='0').archived=true;
 db=observed(db,'later','2026-10-20');
 db.inventoryItems.find(row=>row.id==='0').archived=false;
 const group=api.quantityModel(db).totals.find(row=>row.objectId===0&&row.orgId===0&&row.unit==='шт');
 assert.equal(group.qtyFactDecimal,'0.3');assert.equal(group.inventoryDate,null);
 assert.equal(group.inventoryDateFrom,'2026-10-18');assert.equal(group.inventoryDateTo,'2026-10-20');
});
