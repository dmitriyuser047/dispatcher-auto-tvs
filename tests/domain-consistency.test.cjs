const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const sources=require('../assets/core/financial-recognition.js');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
function financeFixture(overrides={}){
  return {vehicles:[{id:'v1',plate:'ТЕСТ',org:'Синтетическая организация'}],generators:[],payments:[],repairs:[],vehicleTo:[],toRecords:[],workOrders:[],...overrides};
}
function finances(db,options={}){
  const calls={save:0,confirm:[],toast:[]};
  const context=vm.createContext({console,data:clone(db),DomainSources:sources,DecimalCore:require('../assets/core/decimal-core.js'),
    confirmAction:async text=>{calls.confirm.push(text);return options.confirm!==false;},
    saveData:async()=>{calls.save++;return true;},showToast:text=>calls.toast.push(text)});
  vm.runInContext(read('assets/js/21-finances.js'),context);
  vm.runInContext('renderFinancesSection=()=>{}',context);
  return {context,calls,run:()=>context.importPaymentsFromJournals()};
}
function repairAndOrder(){
  return financeFixture({repairs:[{id:'repair1',vehicleId:'v1',invoiceDate:'2026-10-20',cost:10000,description:'Замена узла'}],
    workOrders:[{id:'order1',assetRef:'v:v1',status:'accepted',repairId:'repair1',downtimeTo:'2026-10-20T18:00',actualCost:10000,title:'Тот же ремонт'}]});
}
function generators(db){
  let workbook;
  const context=vm.createContext({console,data:clone(db),DomainSources:sources,TvsFuelEngine:require('../assets/core/fuel-engine.js'),AccountingBoundary:require('../assets/core/accounting-boundary.js'),DecimalCore:require('../assets/core/decimal-core.js'),FuelMovementPolicy:require('../assets/core/fuel-movement-policy.js'),
    fmtDate:value=>value,cmpDateAsc:(a,b)=>String(a).localeCompare(String(b)),fqValue:value=>value==null?null:Number(value),
    alert:message=>{throw Error(message);},
    XLSX:{utils:{encode_cell:position=>position.r+','+position.c,encode_range:range=>JSON.stringify(range),
      book_new:()=>({}),book_append_sheet:(book,sheet)=>book.sheet=sheet},writeFile:book=>{workbook=book;}}});
  vm.runInContext('function genRecsFor(id){return data.genRecords.filter(row=>row.generatorId===id);}function tanksAll(){return data.tanks;}',context);
  vm.runInContext(read('assets/js/29-fuel-quality.js'),context);
  vm.runInContext(read('assets/js/16-generators.js'),context);
  return {context,export(){context.exportGenWriteOffAct('2026-09-01','2026-09-30',{actDate:'2026-09-30',loc:'__ALL__'});return workbook.sheet;}};
}
const values=sheet=>Object.values(sheet).filter(cell=>cell&&Object.hasOwn(cell,'v')).map(cell=>cell.v);

test('planned maintenance for 25000 creates no financial expense or payment',async()=>{
  const db=financeFixture({vehicleTo:[{id:'plan1',vehicleId:'v1',date:'2026-11-10',planned:true,cost:25000,type:'ТО'}]});
  const app=finances(db);await app.run();
  assert.deepEqual(clone(app.context.data.payments),[]);assert.equal(app.calls.save,0);assert.equal(app.calls.confirm.length,0);
  assert.equal(sources.projectFinancialSources(db).excluded[0].code,'planned-source');
});

test('one repair and its linked accepted work order import 10000 once and repeat is idempotent',async()=>{
  const app=finances(repairAndOrder());await app.run();
  assert.equal(app.context.data.payments.length,1);assert.equal(app.context.data.payments[0].sum,10000);
  assert.equal(app.context.data.payments[0].source,'repair');const before=JSON.stringify(app.context.data.payments);
  await app.run();assert.equal(JSON.stringify(app.context.data.payments),before);assert.equal(app.calls.save,1);
});

test('existing linked duplicate payments stay intact and require visible review',async()=>{
  const db=repairAndOrder();db.payments=[
    {id:'p1',source:'repair',sourceId:'repair1',sum:10000,paidAmount:2500,paid:false,note:'Ручная заметка',date:'2026-10-21'},
    {id:'p2',source:'workOrder',sourceId:'order1',sum:10000,paidAmount:10000,paid:true,paidDate:'2026-10-20'}];
  const app=finances(db);await app.run();assert.equal(app.context.data.payments.length,2);
  for(let i=0;i<2;i++){
    const actual=clone(app.context.data.payments[i]),review=actual.sourceReview;delete actual.sourceReview;
    assert.deepEqual(actual,db.payments[i]);assert.equal(review.origin,'financial-recognition');assert.ok(review.message);
  }
  const before=JSON.stringify(app.context.data.payments);await app.run();assert.equal(JSON.stringify(app.context.data.payments),before);assert.equal(app.calls.save,1);
});

test('a legacy paid work order does not cause a second primary payment to be created',async()=>{
  const db=repairAndOrder();db.payments=[{id:'legacy',source:'workOrder',sourceId:'order1',sum:10000,paid:true,paidAmount:10000}];
  const app=finances(db);await app.run();assert.equal(app.context.data.payments.length,1);
  assert.equal(app.context.data.payments[0].paidAmount,10000);assert.equal(app.context.data.payments[0].sourceReview.code,'linked-primary');
});

test('an old payment imported from a plan is reviewed without erasing its money or actual payment',async()=>{
  const db=financeFixture({vehicleTo:[{id:'plan',vehicleId:'v1',date:'2026-11-10',planned:true,cost:25000}],
    payments:[{id:'p',source:'to',sourceId:'plan',sum:25000,paidAmount:5000,paid:false,description:'Ручное описание'}]});
  const app=finances(db);await app.run();assert.equal(app.context.data.payments[0].sum,25000);assert.equal(app.context.data.payments[0].paidAmount,5000);
  assert.equal(app.context.data.payments[0].description,'Ручное описание');assert.equal(app.context.data.payments[0].sourceReview.code,'planned-source');
});

test('source refresh preserves manual amounts, descriptions, dates and partial payment',async()=>{
  const db=repairAndOrder();db.workOrders=[];db.repairs[0].cost=12000;
  db.payments=[{id:'p',source:'repair',sourceId:'repair1',sum:12500,description:'Мой текст',date:'2026-10-22',paidAmount:2000,paidDate:'2026-10-21',dueDate:'2026-11-01',
    sourceSnapshot:{sum:10000,description:'Замена узла',date:'2026-10-20'}}];
  const app=finances(db);await app.run();const payment=app.context.data.payments[0];
  assert.equal(payment.sum,12500);assert.equal(payment.description,'Мой текст');assert.equal(payment.date,'2026-10-22');
  assert.equal(payment.paidAmount,2000);assert.equal(payment.paidDate,'2026-10-21');assert.equal(payment.dueDate,'2026-11-01');assert.equal(payment.sourceSnapshot.sum,12000);
});

test('legacy fully paid flag is materialized at its old amount before source amount changes',async()=>{
  const db=repairAndOrder();db.workOrders=[];db.repairs[0].cost=12000;
  db.payments=[{id:'p',source:'repair',sourceId:'repair1',sum:10000,paid:true}];
  const app=finances(db);await app.run();const payment=app.context.data.payments[0];
  assert.equal(payment.sum,12000);assert.equal(payment.paidAmount,10000);assert.equal(payment.paid,false);
});

test('cancelled sources, invalid dates and plans do not import; actual generator maintenance uses its primary',async()=>{
  const db=financeFixture({repairs:[{id:'cancelled',invoiceDate:'2026-10-20',cost:100,cancelled:true},{id:'invalid',invoiceDate:'2026-02-30',cost:100}],
    toRecords:[{id:'done',generatorId:'g1',date:'2026-10-20',cost:300,type:'ТО ДЭС'},{id:'plan',generatorId:'g1',date:'2026-10-21',cost:900,planned:true}],
    workOrders:[{id:'w',status:'accepted',toRecordId:'done',actualCost:300,downtimeTo:'2026-10-20T12:00'}]});
  const before=JSON.stringify(db),projection=sources.projectFinancialSources(db);assert.equal(JSON.stringify(db),before);
  assert.deepEqual(projection.sources.map(row=>[row.source,row.sourceId,row.assetRef,row.sum]),[['toRecord','done','g:g1',300]]);
  const app=finances(db);await app.run();assert.equal(app.context.data.payments.length,1);assert.equal(app.context.data.payments[0].sum,300);
});

test('rejecting the import preview leaves all application data untouched',async()=>{
  const db=repairAndOrder(),app=finances(db,{confirm:false});await app.run();assert.deepEqual(clone(app.context.data),db);assert.equal(app.calls.save,0);
});

test('DES act and balance include a new receipt: 100 + 100 - 20 = 180 litres',()=>{
  const db={generators:[{id:'g1',name:'ДЭС тест',location:'Площадка',tankId:'t1',fuel:'diesel',fuelBalance:0}],
    genRecords:[{id:'r1',generatorId:'g1',date:'2026-09-15',hours:1,fuelIssued:20,fuelActual:10,tankId:'t1'}],
    tanks:[{id:'t1',name:'Ёмкость',balanceInit:100}],tankIncomes:[],
    fuelMovements:[{id:'receipt1',date:'2026-09-01',kind:'receipt',toTankId:'t1',qty:100,reason:'Поставка'}]};
  const app=generators(db),sheet=app.export(),cells=values(sheet);
  assert.equal(app.context.computeTankBalanceAt('t1','2026-09-30',true),180);
  assert.ok(cells.includes('Приход и движения топлива за отчётный период'));
  assert.ok(cells.some(value=>typeof value==='string'&&value.includes('receipt1')&&value.includes('Поставка')));
  assert.ok(!cells.includes('Нет прихода за период'));assert.deepEqual(clone(app.context.data),db);
  const sourceCell=Object.entries(sheet).find(([,cell])=>typeof cell?.v==='string'&&cell.v.includes('receipt1'));
  assert.equal(sheet[sourceCell[0].split(',')[0]+',2'].v,100);
});

test('tank projection keeps legacy signed transfers and both sides of reversal, excludes cancelled/deleted rows',()=>{
  const db={tankIncomes:[{id:'legacy',tankId:'t1',date:'2026-09-01',amount:40},{id:'old-out',tankId:'t1',date:'2026-09-02',amount:-10},{id:'old-in',tankId:'t2',date:'2026-09-02',amount:10}],
    fuelMovements:[{id:'r',date:'2026-09-03',kind:'receipt',toTankId:'t1',qty:100,reversedBy:'rev'},
      {id:'rev',date:'2026-09-03',kind:'adjustment',fromTankId:'t1',qty:100,originalMovementId:'r'},
      {id:'bad1',date:'2026-09-04',kind:'receipt',toTankId:'t1',qty:999,cancelled:true},
      {id:'bad2',date:'2026-09-04',kind:'receipt',toTankId:'t1',qty:999,deleted:true},
      {id:'outside',date:'2026-10-01',kind:'receipt',toTankId:'t1',qty:999},
      {id:'transfer',date:'2026-09-05',kind:'transfer',fromTankId:'t1',toTankId:'t2',qty:15}]};
  const before=JSON.stringify(db),all=sources.projectTankFlows(db,['t1','t2'],{from:'2026-09-01',to:'2026-09-30'});
  assert.deepEqual(all.map(row=>row.sourceId),['legacy','old-in','old-out','r','rev']);
  assert.equal(all.reduce((sum,row)=>sum+row.amount,0),40);assert.equal(new Set(all.map(row=>row.key)).size,all.length);
  assert.equal(sources.projectTankFlows(db,['t1'],{to:'2026-09-30'}).reduce((sum,row)=>sum+row.amount,0),15);
  assert.equal(JSON.stringify(db),before);
});

test('balance and exported movement breakdown agree on cancellation, reversal and period boundaries',()=>{
  const db={generators:[{id:'g1',name:'ДЭС',location:'Площадка',tankId:'t1'}],genRecords:[],tanks:[{id:'t1',balanceInit:100}],
    tankIncomes:[{id:'old',tankId:'t1',date:'2026-09-01',amount:30}],fuelMovements:[
      {id:'original',date:'2026-09-02',kind:'receipt',toTankId:'t1',qty:50,reversedBy:'reversal'},
      {id:'reversal',date:'2026-09-02',kind:'adjustment',fromTankId:'t1',qty:50,originalMovementId:'original'},
      {id:'deleted',date:'2026-09-03',kind:'receipt',toTankId:'t1',qty:700,deleted:true},
      {id:'cancelled',date:'2026-09-03',kind:'receipt',toTankId:'t1',qty:800,cancelled:true}]};
  const app=generators(db),sheet=app.export(),cells=values(sheet);
  assert.equal(app.context.computeTankBalanceAt('t1','2026-09-30',true),130);
  assert.equal(app.context.computeTankBalanceAt('t1','2026-09-01',false),100);
  assert.ok(cells.some(value=>typeof value==='string'&&value.includes('Сторно original')));
  assert.ok(!cells.some(value=>typeof value==='string'&&(value.includes('deleted')||value.includes('cancelled'))));
  const sourceRows=Object.entries(sheet).filter(([,cell])=>typeof cell?.v==='string'&&/^(Журнал ёмкости|Движение топлива)/.test(cell.v));
  assert.equal(sourceRows.reduce((sum,[key])=>sum+sheet[key.split(',')[0]+',2'].v,0),30);
});
