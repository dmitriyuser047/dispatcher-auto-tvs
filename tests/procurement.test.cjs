const {test}=require('node:test');
const assert=require('node:assert/strict');
const engine=require('../assets/js/47-procurement-engine.js');
const DATE='2026-10-18';
function fixture(){return {tanks:[{id:'t',name:'ДТ',balanceInit:100,reserveLevel:20,capacity:1000}],parts:[{id:'p',name:'Фильтр',unit:'шт',minStock:2}],tankIncomes:[],genRecords:[],generators:[{id:'g',tankId:'t',norm:5}],fuelMovements:[],partMovements:[],dispatchJobs:[],procurementRules:[],procurementOrders:[]};}
function rule(patch={}){return {id:'rule',kind:'tank',itemId:'t',leadDays:2,coverDays:7,reserveQty:20,expectedDaily:10,...patch};}
function order(patch={}){return {id:'po',kind:'tank',itemId:'t',supplier:'Поставщик',quantity:100,receivedQty:0,stockPostedQty:0,deliveryDate:'2026-10-20',status:'ordered',note:'',...patch};}
function tank(db){return engine.plan(db,{date:DATE}).find(r=>r.kind==='tank');}

test('reserve plus lead and cover demand subtract real stock, not a guessed tank fill',()=>{
 const db=fixture();db.procurementRules=[rule()];const p=tank(db);
 assert.equal(p.stock,100);assert.equal(p.demand,90);assert.equal(p.suggestedQty,10);assert.equal(p.dailySource,'manual');assert.equal(p.reorderDate,'2026-10-24');
});
test('lack of usage remains unknown while configured reserve can still produce a recommendation',()=>{
 const db=fixture();db.tanks[0].balanceInit=5;const p=tank(db);
 assert.equal(p.dailySource,'missing');assert.equal(p.demand,0);assert.equal(p.suggestedQty,15);assert.match(p.warnings.join(' '),/неизвестен/);
});
test('30 calendar day history excludes old, future, cancelled, reversed and duplicate linked generation issues',()=>{
 const db=fixture();db.genRecords=[{id:'legacy',generatorId:'g',date:DATE,fuelIssued:30},{id:'linked',generatorId:'g',tankId:null,date:DATE,fuelIssued:60}];
 db.fuelMovements=[{kind:'issue',date:DATE,fromTankId:'t',qty:60},{kind:'issue',date:'2026-09-18',fromTankId:'t',qty:900},{kind:'issue',date:'2026-10-19',fromTankId:'t',qty:900},{kind:'issue',date:DATE,fromTankId:'t',qty:900,cancelled:true},{kind:'issue',date:DATE,fromTankId:'t',qty:900,reversedBy:'rev'}];
 const recent=engine.usage(db,'tank','t',DATE);assert.equal(recent.total,90);assert.equal(recent.daily,3);assert.equal(recent.count,2);
});
test('history follows explicit tank snapshots after generator changes its current tank',()=>{
 const db=fixture();db.genRecords=[{date:DATE,generatorId:'g',tankId:'old',fuelIssued:30},{date:DATE,generatorId:'g',tankId:null,fuelIssued:40}];
 assert.equal(engine.usage(db,'tank','t',DATE).total,0);assert.equal(tank(db).stock,100);
});
test('legacy paired tank transfer subtracts outgoing stock and conserves total fuel',()=>{
 const db=fixture();db.tanks.push({id:'other',name:'Приёмник',balanceInit:0});db.tankIncomes=[{id:'tr_out',linkId:'tr',kind:'out',tankId:'t',counterTankId:'other',date:DATE,amount:-30},{id:'tr_in',linkId:'tr',kind:'in',tankId:'other',counterTankId:'t',date:DATE,amount:30}];
 const plan=engine.plan(db,{date:DATE});assert.equal(plan.find(r=>r.itemId==='t').stock,70);assert.equal(plan.find(r=>r.itemId==='other').stock,30);assert.equal(plan.filter(r=>r.kind==='tank').reduce((sum,r)=>sum+r.stock,0),100);assert.equal(engine.usage(db,'tank','t',DATE).total,0);
});
test('partial delivery never counts received units twice or silently changes physical stock',()=>{
 const db=fixture();db.tanks[0].balanceInit=0;db.procurementRules=[rule({reserveQty:0})];db.procurementOrders=[order({status:'partial',receivedQty:40,stockPostedQty:10})];
 const p=tank(db);assert.equal(p.stock,0);assert.equal(p.undelivered,60);assert.equal(p.pendingPosting,30);assert.equal(p.coverage,90);assert.equal(p.suggestedQty,0);assert.match(p.warnings.join(' '),/не оприходовано/);
 db.tankIncomes.push({id:'posted',tankId:'t',date:DATE,amount:30});db.procurementOrders[0].stockPostedQty=40;
 const after=tank(db);assert.equal(after.stock,30);assert.equal(after.pendingPosting,0);assert.equal(after.undelivered,60);assert.equal(after.suggestedQty,0);
});
test('received status records progress only and prompts separate journal posting',()=>{
 const db=fixture();db.tanks[0].balanceInit=0;db.procurementOrders=[order({status:'received',receivedQty:100})];
 const before=JSON.stringify(db),p=tank(db);assert.equal(p.stock,0);assert.equal(p.undelivered,0);assert.equal(p.pendingPosting,100);assert.equal(JSON.stringify(db),before);
});
test('cancelled orders do not cover purchases and drafts hold quantity without promised arrivals',()=>{
 const db=fixture();db.tanks[0].balanceInit=0;db.procurementRules=[rule({reserveQty:0})];db.procurementOrders=[order({status:'cancelled'})];
 assert.equal(tank(db).suggestedQty,90);db.procurementOrders=[order({status:'draft',supplier:''})];const p=tank(db);
 assert.equal(p.suggestedQty,0);assert.equal(p.drafts,100);assert.equal(p.nextDelivery,null);assert.match(p.warnings.join(' '),/Черновики/);
});
test('a committed order after stockout warns about the gap although it suppresses duplicate purchase quantity',()=>{
 const db=fixture();db.tanks[0].balanceInit=50;db.procurementRules=[rule({reserveQty:0})];db.procurementOrders=[order({deliveryDate:'2026-11-07'})];
 const p=tank(db);assert.equal(p.suggestedQty,0);assert.equal(p.shortageBeforeDelivery,false);assert.equal(p.stockoutDate,'2026-10-23');assert.equal(p.nextDelivery,'2026-11-07');assert.equal(p.lateCoverage,true);assert.match(p.warnings.join(' '),/Разрыв поставки/);
});
test('overdue orders never become actual inventory at the calculation date',()=>{
 const db=fixture();db.tanks[0].balanceInit=0;db.procurementRules=[rule({reserveQty:0})];db.procurementOrders=[order({deliveryDate:'2026-10-17'})];
 const p=tank(db);assert.equal(p.stock,0);assert.equal(p.nextDelivery,null);assert.equal(p.shortageBeforeDelivery,true);assert.match(p.warnings.join(' '),/просроченная/);
});
test('a small early delivery does not hide a stockout before the later remainder arrives',()=>{
 const db=fixture();db.tanks[0].balanceInit=50;db.procurementRules=[rule({reserveQty:0,coverDays:14})];db.procurementOrders=[order({quantity:20,deliveryDate:'2026-10-19'}),order({id:'late',quantity:100,deliveryDate:'2026-11-07'})];
 const p=tank(db);assert.equal(p.suggestedQty,0);assert.equal(p.shortageBeforeDelivery,false);assert.equal(p.stockoutDate,'2026-10-25');assert.equal(p.nextDelivery,'2026-10-19');assert.equal(p.gapDelivery,'2026-11-07');assert.equal(p.lateCoverage,true);assert.match(p.warnings.join(' '),/Разрыв поставки/);
});
test('generator jobs require tank, flat norm and planned hours; max with daily avoids duplicate demand',()=>{
 const db=fixture();db.procurementRules=[rule({leadDays:0,coverDays:2,reserveQty:0,expectedDaily:10})];
 db.dispatchJobs=[{id:'j',status:'assigned',assetRef:'g:g',plannedHours:8,start:DATE+'T08:00',end:DATE+'T17:00'},{id:'unknown',status:'assigned',assetRef:'g:g',start:'2026-10-19T08:00',end:'2026-10-19T17:00'},{id:'cancelled',status:'cancelled',assetRef:'g:g',plannedHours:1000,start:DATE+'T08:00',end:DATE+'T17:00'}];
 const p=tank(db);assert.equal(p.demand,50);assert.equal(p.knownJobs,1);assert.equal(p.unknownJobs,1);
 db.generators[0].norm=null;db.generators[0].norm100=100;const unknown=tank(db);assert.equal(unknown.knownJobs,0);assert.equal(unknown.unknownJobs,2);assert.equal(unknown.demand,20);
});
test('multi-day jobs do not attribute their full planned hours only to the remaining interval',()=>{
 const db=fixture();db.procurementRules=[rule({leadDays:0,coverDays:1,reserveQty:0,expectedDaily:0})];db.dispatchJobs=[{id:'j',status:'started',assetRef:'g:g',plannedHours:30,start:'2026-10-17T08:00',end:'2026-10-19T17:00'}];
 assert.equal(tank(db).demand,50);
});
test('part stock, issue history and explicit part requirements remain independent of fuel',()=>{
 const db=fixture();db.partMovements=[{partId:'p',date:'2026-10-01',kind:'receipt',qty:20},{partId:'p',date:DATE,kind:'issue',qty:3},{partId:'p',date:DATE,kind:'return',qty:1},{partId:'p',date:DATE,kind:'writeoff',qty:1}];db.procurementRules=[rule({kind:'part',itemId:'p',reserveQty:2,leadDays:0,coverDays:1,expectedDaily:0})];db.dispatchJobs=[{status:'assigned',start:DATE+'T08:00',end:DATE+'T09:00',partRequirements:[{partId:'p',qty:20}]}];
 const p=engine.plan(db,{date:DATE}).find(r=>r.kind==='part');assert.equal(p.stock,17);assert.equal(p.recent.total,4);assert.equal(p.demand,20);assert.equal(p.suggestedQty,5);
});
test('explicit zero expected consumption overrides history but not quantifiable future assignments',()=>{
 const db=fixture();db.genRecords=[{generatorId:'g',date:DATE,fuelIssued:300}];db.procurementRules=[rule({expectedDaily:0})];const p=tank(db);assert.equal(p.daily,0);assert.equal(p.dailySource,'manual');assert.equal(p.demand,0);
});
test('unit quantities round up to whole pieces while bulk units keep two decimals',()=>{
 const db=fixture();db.procurementRules=[rule({kind:'part',itemId:'p',leadDays:0,coverDays:1,reserveQty:0,expectedDaily:0.25})];
 assert.equal(engine.plan(db,{date:DATE}).find(p=>p.kind==='part').suggestedQty,1);db.parts[0].unit='кг';assert.equal(engine.plan(db,{date:DATE}).find(p=>p.kind==='part').suggestedQty,0.25);
});
test('archived items are omitted from future planning while historic orders can still validate',()=>{
 const db=fixture();db.tanks[0].archived=true;db.procurementOrders=[order()];assert.equal(engine.plan(db,{date:DATE}).some(p=>p.kind==='tank'),false);assert.equal(engine.validateSection('procurementOrders',db.procurementOrders,db),true);
});
test('date math respects leap days and invalid dates are rejected',()=>{
 assert.equal(engine.shift('2028-02-28',2),'2028-03-01');assert.equal(engine.validDate('2026-02-29'),false);assert.equal(engine.validDate('2028-02-29'),true);assert.throws(()=>engine.plan(fixture(),{date:'2026-02-30'}),/дата/);
});
test('schema rejects invalid numbers, nonfinite quantities, unsafe dates and unknown fields',()=>{
 const db=fixture();for(const value of [-1,Infinity,NaN,'10',null])assert.throws(()=>engine.validateSection('procurementOrders',[order({quantity:value})],db));
 for(const patch of [{receivedQty:101},{stockPostedQty:1},{status:'unexpected'},{deliveryDate:'2026-02-30'},{supplier:7},{quantity:0},{__bad:true},{itemId:'deleted'},{id:'__proto__'}])assert.throws(()=>engine.validateSection('procurementOrders',[order(patch)],db));
});
test('receipt status quantities and cancellation must be consistent',()=>{
 const db=fixture();for(const patch of [{status:'ordered',receivedQty:10},{status:'partial',receivedQty:0},{status:'partial',receivedQty:100},{status:'received',receivedQty:99},{status:'cancelled',receivedQty:10,stockPostedQty:0}])assert.throws(()=>engine.validateSection('procurementOrders',[order(patch)],db));
 assert.equal(engine.validateSection('procurementOrders',[order({status:'cancelled',receivedQty:10,stockPostedQty:10})],db),true);
});
test('rules require bounded whole-day lead times, finite quantities and one active rule per item',()=>{
 const db=fixture();for(const patch of [{leadDays:-1},{leadDays:1.5},{leadDays:366},{coverDays:0},{coverDays:366},{reserveQty:Infinity},{expectedDaily:-1}])assert.throws(()=>engine.validateSection('procurementRules',[rule(patch)],db));
 assert.throws(()=>engine.validateSection('procurementRules',[rule(),rule({id:'duplicate'})],db),/уже есть/);assert.throws(()=>engine.validateSection('procurementOrders',[order(),order()],db),/повторный/);
});
