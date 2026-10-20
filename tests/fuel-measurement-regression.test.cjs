const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
function context(db){
  const ctx=vm.createContext({console,window:{},document:{addEventListener(){},documentElement:{removeAttribute(){}},getElementById(){}},localStorage:{getItem(){}}});
  for(const file of ['01-core.js','29-fuel-quality.js','07-summary.js','25i-gsm-ledger.js'])vm.runInContext(fs.readFileSync(path.join(root,'assets/js',file),'utf8'),ctx,{filename:file});
  ctx.input=db;vm.runInContext('data=input;rebuildIndex();',ctx);return ctx;
}
function fixture(){return {vehicles:[{id:'v',org:'A',fuel:'gasoline',fuelGrade:'АИ-95',fuelBalance:0}],records:[],fuelPurchases:[],fuelCards:[],monthlyFuel:[]};}
function total(ledger,key){return ledger.rows.reduce((sum,row)=>sum+row[key],0);}

test('a petrol tank measurement does not reset gas stock from another row of the same day',()=>{
  const db=fixture();db.records=[
    {id:'petrol',vehicleId:'v',date:'2026-08-01',fuelGrade:'АИ-95',fuelIssued:100,fuelActual:20,tankMeasured:60},
    {id:'gas',vehicleId:'v',date:'2026-08-01',fuelGrade:'Газ',fuelIssued:50,fuelActual:10}
  ];
  const before=JSON.stringify(db),ctx=context(db),ledger=ctx.gsmBuildLedger(db,{from:'2026-08-01',to:'2026-08-31'});
  assert.equal(ledger.rows.find(row=>row.grade==='АИ-95').end,60);
  assert.equal(ledger.rows.find(row=>row.grade==='Газ').end,40);
  assert.equal(total(ledger,'spent'),50);assert.equal(total(ledger,'end'),100);
  assert.equal(ctx.computeFuelBalances('v').gas,100);
  assert.equal(JSON.stringify(db),before);
});

test('each family uses its last measurement once and includes subsequent rows of that family',()=>{
  const db=fixture();db.records=[
    {id:'p1',vehicleId:'v',date:'2026-08-01',fuelGrade:'АИ-95',fuelIssued:100,fuelActual:20,tankMeasured:70},
    {id:'gas',vehicleId:'v',date:'2026-08-01',fuelGrade:'Газ',fuelIssued:30,fuelActual:4,tankMeasured:22},
    {id:'p2',vehicleId:'v',date:'2026-08-01',fuelGrade:'АИ-92',fuelActual:5,tankMeasured:60},
    {id:'p3',vehicleId:'v',date:'2026-08-01',fuelGrade:'АИ-95',fuelActual:3}
  ];
  const ctx=context(db),ledger=ctx.gsmBuildLedger(db,{from:'2026-08-01',to:'2026-08-31'});
  assert.equal(ledger.rows.filter(row=>row.grade!=='Газ').reduce((sum,row)=>sum+row.end,0),60);
  assert.equal(ledger.rows.find(row=>row.grade==='Газ').end,22);
  assert.equal(total(ledger,'end'),82);assert.equal(total(ledger,'spent'),48);
  assert.equal(ctx.computeFuelBalances('v').p3,82);
});

test('a family measurement preserves independently declared opening stock in another tank',()=>{
  const db=fixture();Object.assign(db.vehicles[0],{fuelBalance:50,fuelBalanceSources:[{org:'A',grade:'АИ-95',qty:30},{org:'A',grade:'Газ',qty:20}]});
  db.records=[{id:'r',vehicleId:'v',date:'2026-08-01',fuelGrade:'АИ-95',fuelActual:5,tankMeasured:25}];
  const ctx=context(db),ledger=ctx.gsmBuildLedger(db,{from:'2026-08-01',to:'2026-08-31'});
  assert.equal(total(ledger,'end'),45);assert.equal(ctx.computeFuelBalances('v').r,45);
  assert.equal(ledger.rows.find(row=>row.grade==='Газ').end,20);
});
