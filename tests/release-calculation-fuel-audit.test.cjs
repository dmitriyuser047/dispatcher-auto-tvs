'use strict';
// Independent release arithmetic checks. Fixtures are synthetic, held in memory,
// and never open a profile, application database, storage adapter or browser.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const fuel=require('../assets/core/fuel-engine.js'),writeoff=require('../assets/core/writeoff-engine.js');
const precision=require('../assets/core/precision-policy.js');
const range={from:'2026-09-01',to:'2026-09-30'},request={month:'2026-09',date:'2026-09-30'};
const author={id:'release-synthetic',name:'Synthetic calculation audit'};
const units=value=>BigInt(Math.round(value*1000));
const sum=(rows,field)=>rows.reduce((total,row)=>total+units(row[field]||0),0n);
const halfUp=(numerator,denominator)=>(numerator+denominator/2n)/denominator;
const base=extra=>({vehicles:[],records:[],fuelPurchases:[],fuelCards:[],monthlyFuel:[],fuelWriteoffs:[],...extra});
function stream(seed=1){
  let state=seed>>>0;const next=max=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state%max;};
  const db=base({vehicles:[0,'0'].map((id,index)=>({id,plate:'SYNTHETIC '+typeof id,org:'A',fuel:index?'gasoline':'diesel',fuelGrade:index?'АИ-95':'ДТ',fuelBalance:300,norm:(1000000+next(98000000))/1000000,
    fuelBalanceSources:[{org:'A',grade:index?'АИ-95':'ДТ',qty:100},{org:'B',grade:index?'АИ-92':'ДТ',qty:100},{org:'C',grade:index?'АИ-95':'ДТ',qty:100}]}))});
  const dates=['2026-08-28','2026-08-29','2026-08-30','2026-08-31','2026-09-01','2026-09-02','2026-09-03','2026-09-04'];
  for(const vehicle of db.vehicles)for(const [index,date]of dates.entries())db.records.push({id:typeof vehicle.id+'-'+index,vehicleId:vehicle.id,date,
    km:next(123456)/1000,kmGlonass:next(123456)/1000,fuelActual:(1+next(24000))/1000,fuelIdle:next(300)/1000,
    fuelIssued:index===0||index===4?3.333:0,fuelOrg:'A',fuelGrade:vehicle.fuelGrade});
  return db;
}
function post(db,scope={},id='release-synthetic-act'){
  const options={...request,...scope},preview=writeoff.prepare(db,options);
  assert.equal(preview.canPost,true,JSON.stringify(preview.issues));
  return writeoff.post(db,options,{id,number:id,postedAt:'2026-10-24T00:00:00Z',postedBy:author,expectedFingerprint:preview.sourceFingerprint});
}
function expectedNorm(records,rate){
  const micros=BigInt(Math.round(rate*1000000));
  return records.reduce((total,row)=>total+halfUp(units(row.km)*micros,100000000n),0n);
}
function statement(db,ledger,grade=''){
  const context=vm.createContext({data:db,TvsFuelEngine:fuel,gsmOrgKey:fuel.gsmOrgKey,gsmFamily:fuel.gsmFamily,gsmVisible:row=>!grade||row.grade===grade,fmtDate:value=>value,dispatcherAnalysisStamp:()=>JSON.stringify(db)});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/js/25p-gsm-statement.js'),'utf8'),context);
  return context.gsmVehicleStatementHtml(ledger);
}
function cell(html,field){return html.match(new RegExp('<td[^>]*data-gsm-value="'+field+'"[\\s\\S]*?<\\/td>'))?.[0]||'';}

test('seeded admitted source streams conserve physical litres, kilometres, GLONASS, idle and independently computed norms',()=>{
  for(let seed=1;seed<=24;seed++){
    const db=stream(seed),before=JSON.stringify(db),ledger=fuel.buildLedger(db,range),act=post(db);
    assert.deepEqual(precision.inspect(db).issues,[],'source precision seed '+seed);
    for(const vehicle of db.vehicles){
      const records=db.records.filter(row=>row.vehicleId===vehicle.id),current=records.filter(row=>row.date>=range.from),prior=records.filter(row=>row.date<range.from);
      const rows=ledger.rows.filter(row=>row.vehicleId===vehicle.id);
      const start=300000n+sum(prior,'fuelIssued')-sum(prior,'fuelActual')-sum(prior,'fuelIdle');
      const spent=sum(current,'fuelActual')+sum(current,'fuelIdle'),issued=sum(current,'fuelIssued');
      assert.equal(sum(rows,'start'),start,'opening seed '+seed);
      assert.equal(sum(rows,'spent'),spent,'spent seed '+seed);
      assert.equal(sum(rows,'issued'),issued,'issued seed '+seed);
      assert.equal(sum(rows,'end'),start+issued-spent,'closing seed '+seed);
      assert.equal(sum(rows,'km'),sum(current,'km'),'km seed '+seed);
      assert.equal(sum(rows,'glonass'),sum(current,'kmGlonass'),'GLONASS seed '+seed);
      assert.equal(sum(rows,'idle'),sum(current,'fuelIdle'),'idle seed '+seed);
      assert.equal(sum(rows,'norm'),expectedNorm(current,vehicle.norm),'norm seed '+seed);
    }
    for(const row of act.rows){
      const parts=act.consumption.filter(part=>part.vehicleId===row.vehicleId&&part.org===row.org&&part.grade===row.grade);
      for(const field of ['km','norm','idle'])assert.equal(sum(parts,field),units(row[field]),field+' act detail seed '+seed);
      assert.equal(sum(parts,'qty'),units(row.spent),'physical act detail seed '+seed);
    }
    assert.equal(JSON.stringify(db),before,'read-only seed '+seed);
  }
});

test('a monthly carry is the previous closing and adding another organisation act does not consume fuel again',()=>{
  const db=stream(71),before=JSON.stringify(db),august=fuel.buildLedger(db,{from:'2026-08-01',to:'2026-08-31'}),september=fuel.buildLedger(db,range);
  for(const vehicle of db.vehicles)assert.equal(sum(august.rows.filter(row=>row.vehicleId===vehicle.id),'end'),sum(september.rows.filter(row=>row.vehicleId===vehicle.id),'start'));
  const whole=post(db),documents=[];
  for(const org of ['A','B','C'])documents.push(post({...db,fuelWriteoffs:documents},{org},'release-org-'+org));
  for(const field of ['start','issued','spent','idle','end','km','glonass','norm'])assert.equal(documents.reduce((total,doc)=>total+units(doc.totals[field]),0n),units(whole.totals[field]),field);
  const after=fuel.buildLedger({...db,fuelWriteoffs:documents},range);assert.deepEqual(after,september);
  assert.equal(writeoff.validateDocuments(db,{...db,fuelWriteoffs:documents}),true);
  assert.equal(JSON.stringify(db),before);
});

test('end-of-day measurements apply once to their fuel family and retain the measured total tank amount',()=>{
  const db=base({vehicles:[{id:0,plate:'SYNTHETIC FAMILY TANKS',org:'A',fuel:'diesel',fuelGrade:'ДТ',norm:10,fuelBalance:100,
    fuelBalanceSources:[{org:'A',grade:'ДТ',qty:40},{org:'A',grade:'АИ-95',qty:60}]}],records:[
    {id:0,vehicleId:0,date:'2026-09-10',fuelGrade:'ДТ',km:10,fuelActual:1,tankMeasured:38},
    {id:'0',vehicleId:0,date:'2026-09-10',fuelGrade:'АИ-95',km:20,fuelActual:2,fuelIdle:1,tankMeasured:55},
    {id:'last-diesel',vehicleId:0,date:'2026-09-10',fuelGrade:'ДТ',km:10,fuelActual:2,fuelIdle:1,tankMeasured:35}
  ]}),before=JSON.stringify(db),ledger=fuel.buildLedger(db,range),act=post(db);
  for(const [grade,closing]of [['ДТ',35],['АИ-95',55]]){
    const rows=ledger.rows.filter(row=>row.grade===grade);assert.equal(sum(rows,'end'),BigInt(closing*1000));assert.equal(sum(rows,'spent'),5000n);
  }
  assert.equal(act.totals.spent,10);assert.equal(act.totals.idle,2);assert.equal(act.totals.km,40);
  assert.equal(act.consumption.filter(row=>row.measurementRecordId==='last-diesel').length,1);
  assert.equal(act.consumption.filter(row=>row.measurementRecordId==='0').length,1);
  assert.equal(JSON.stringify(db),before);
});

test('future malformed facts cannot change the closed month calculation, fingerprint or frozen saved act',()=>{
  const db=stream(17),document=post(db),later=structuredClone(db);
  later.records.push({id:'future-record',vehicleId:0,date:'2026-10-01',km:'bad',fuelActual:'bad',fuelGrade:'ДТ'});
  later.fuelPurchases.push({id:'future-purchase',vehicleId:0,recordId:'future-record',date:'2026-10-01',grade:'ДТ',qty:'bad',sourceOrg:'A'});
  const before=JSON.stringify(later);
  assert.deepEqual(fuel.buildLedger(later,range),fuel.buildLedger(db,range));
  assert.equal(writeoff.fingerprint(later,request),document.sourceFingerprint);
  assert.equal(writeoff.validateDocuments({...db,fuelWriteoffs:[document]},{...later,fuelWriteoffs:[structuredClone(document)]}),true);
  assert.equal(JSON.stringify(later),before);
});

test('statement distinguishes an unknown historical carry from a same-family measurement anchor and an explicit zero',()=>{
  const db=base({vehicles:[{id:0,plate:'SYNTHETIC OPENING',org:'A',fuel:'diesel',fuelGrade:'ДТ'}],records:[
    {id:'historical-gap',vehicleId:0,date:'2026-08-10',fuelGrade:'ДТ',km:10},
    {id:'current',vehicleId:0,date:'2026-09-10',fuelGrade:'ДТ',km:10,fuelActual:1}
  ]}),before=JSON.stringify(db);
  const unknown=statement(db,fuel.buildLedger(db,range));assert.match(cell(unknown,'opening'),/data-status="unknown"/);assert.match(cell(unknown,'end'),/data-status="unknown"/);
  const anchored=structuredClone(db);anchored.records.splice(1,0,{id:'prior-anchor',vehicleId:0,date:'2026-08-31',fuelGrade:'ДТ',km:0,tankMeasured:10});
  const known=statement(anchored,fuel.buildLedger(anchored,range));assert.match(cell(known,'opening'),/data-status="known"/);assert.match(cell(known,'opening'),/>10<\/td>/);assert.match(cell(known,'end'),/>9<\/td>/);
  const other=structuredClone(anchored);other.records[1].fuelGrade='Газ';assert.match(cell(statement(other,fuel.buildLedger(other,range),'ДТ'),'opening'),/data-status="unknown"/);
  const zero=base({vehicles:[{id:0,plate:'SYNTHETIC ZERO',org:'A',fuel:'diesel',fuelGrade:'ДТ',fuelBalance:0}],records:[{id:0,vehicleId:0,date:'2026-09-10',km:0,fuelActual:0}]});
  assert.match(cell(statement(zero,fuel.buildLedger(zero,range)),'opening'),/data-status="known"[^>]*>0<\/td>/);
  assert.equal(JSON.stringify(db),before);
});
