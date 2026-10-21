'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const engine = require('../assets/core/writeoff-engine.js');

// Synthetic source documents only. No application data directory is opened.
const request = {month:'2026-09',org:'A',grade:'АИ-95',date:'2026-09-30'};
const author = {id:0,name:'Synthetic operator',role:'admin'};
const clone = value => JSON.parse(JSON.stringify(value));
function database() {
  return {vehicles:[{id:'v',org:'A',fuel:'gasoline',fuelGrade:'АИ-95',fuelBalance:50}],
    records:[{id:'r',vehicleId:'v',date:'2026-09-05',fuelGrade:'АИ-95',fuelIssued:40,fuelActual:20,fuelIdle:2,km:100}],
    fuelPurchases:[{id:'p',vehicleId:'v',recordId:'r',date:'2026-09-05',grade:'АИ-95',qty:40,manual:true,sourceOrg:'A'}],
    fuelCards:[],monthlyFuel:[],fuelWriteoffs:[]};
}
function post(db, options=request, extra={}) {
  const preview = engine.prepare(db,options);
  return engine.post(db,options,{id:'act',number:'Synthetic-1',postedAt:'2026-10-21T10:00:00.000Z',postedBy:author,expectedFingerprint:preview.sourceFingerprint,...extra});
}
function freeze(value) { if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);} return value; }
function code(expected) { return error => error && error.name==='FuelWriteoffError' && error.code===expected; }
function issue(db, expected, options=request) {
  const prepared = engine.prepare(db,options);
  assert.equal(prepared.canPost,false,JSON.stringify(prepared.issues));
  assert.ok(prepared.issues.some(item=>item.code===expected),JSON.stringify(prepared.issues));
}

test('writeoff module is versioned, portable, and uses standard SHA-256 UTF-8',()=>{
  assert.equal(engine.apiVersion,1);assert.ok(Object.isFrozen(engine));
  for(const text of ['', 'abc','Сентябрь 👋','\ud800','x'.repeat(1000)]) assert.equal(engine.sha256(text),crypto.createHash('sha256').update(text).digest('hex'));
  const sandbox = vm.createContext({});
  for(const file of ['decimal-core.js','fuel-engine.js','writeoff-engine.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/core',file),'utf8'),sandbox);
  assert.equal(sandbox.TvsWriteoffEngine.prepare(database(),request).totals.end,68);
});

test('preparation is an immutable source snapshot with one counted idle consumption',()=>{
  const db=database(),before=JSON.stringify(db),preview=engine.prepare(freeze(db),request);
  assert.equal(JSON.stringify(db),before);assert.ok(Object.isFrozen(preview.snapshot.records[0]));
  assert.equal(preview.canPost,true);assert.equal(preview.totals.start,50);assert.equal(preview.totals.issued,40);
  assert.equal(preview.totals.spent,22);assert.equal(preview.totals.idle,2);assert.equal(preview.totals.end,68);
  assert.equal(preview.totals.norm,null);assert.equal(preview.totals.basis.actual,22);
  assert.equal(preview.consumption[0].source,'actual');assert.equal(preview.consumption[0].enteredActual,20);
  assert.equal(preview.rows[0].start+preview.rows[0].issued+preview.rows[0].correction-preview.rows[0].spent,preview.rows[0].end);
  assert.ok(preview.sourceRefs.some(row=>row.section==='fuelPurchases'&&row.id==='p'));
  assert.throws(()=>{preview.snapshot.records[0].km=999;},TypeError);
});

test('strict calendar periods, date and diesel/gasoline scope cannot be bypassed',()=>{
  for(const value of ['2026-9','all','2026-13','2026-00','2026-09-01']) assert.throws(()=>engine.prepare(database(),{...request,month:value}),code('INVALID_PERIOD'));
  assert.throws(()=>engine.prepare(database(),{...request,from:'2026-09-02'}),code('INVALID_PERIOD'));
  assert.throws(()=>engine.prepare(database(),{...request,date:'2026-09-31'}),code('INVALID_DATE'));
  assert.throws(()=>engine.prepare(database(),{...request,grade:'Газ'}),code('INVALID_SCOPE'));
  const leap=engine.prepare(database(),{...request,month:'2028-02',date:'2028-02-29'});assert.equal(leap.scope.to,'2028-02-29');
});

test('missing source section permissions prohibit posting even if data looks clean',()=>{
  issue(database(),'access-incomplete',{...request,readable:['vehicles','records']});
  assert.equal(engine.prepare(database(),{...request,readable:engine.requiredSections}).canPost,true);
});

test('norm fallback remains explicit and posting requires a written basis',()=>{
  const db=database();delete db.records[0].fuelActual;db.vehicles[0].norm=10;
  const prepared=engine.prepare(db,request);assert.equal(prepared.canPost,true);assert.equal(prepared.requiresBasisNote,true);
  assert.equal(prepared.totals.basis.norm,12);assert.equal(prepared.totals.spent,12);
  assert.throws(()=>post(db),code('BASIS_REQUIRED'));
  const document=post(db,{...request,basisNote:'Расчёт по утверждённой норме'});assert.equal(document.basisNote,'Расчёт по утверждённой норме');
});

test('zero entered actual is preserved and unknown norm remains evidence',()=>{
  const db=database();db.records[0].fuelActual=0;db.records[0].fuelIdle=0;
  const prepared=engine.prepare(db,request);assert.equal(prepared.totals.spent,0);assert.equal(prepared.totals.norm,null);
  assert.equal(prepared.requiresBasisNote,false);assert.ok(prepared.issues.some(row=>row.code==='norm-unknown'));
});

test('malformed numeric types, negative values, absent quantity and IDs block posting',()=>{
  for(const [section,field,value,expected] of [['records','fuelActual',true,'invalid-number'],['records','fuelIdle',-1,'invalid-number'],['records','km','bad','invalid-number'],['records','tankMeasured',-5,'invalid-number'],['fuelPurchases','qty','', 'purchase-quantity-missing'],['fuelPurchases','sum',{},'invalid-number'],['vehicles','fuelBalance',-1,'invalid-number'],['records','id','','source-id-missing']]) {
    const db=database();db[section][0][field]=value;issue(db,expected);
  }
  const duplicate=database();duplicate.records.push({...duplicate.records[0]});issue(duplicate,'source-id-duplicate');
});

test('orphans, dates, receipt mismatches and stale purchase links remain blockers',()=>{
  const orphan=database();orphan.records.push({id:'orphan',vehicleId:'absent',date:'2026-09-07',fuelGrade:'АИ-95',fuelOrg:'A',fuelActual:1});issue(orphan,'source-vehicle-missing');
  const badDate=database();badDate.records[0].date='2026-09-31';issue(badDate,'source-date-invalid');
  const mismatch=database();mismatch.fuelPurchases[0].qty=41;issue(mismatch,'journal-difference');
  const stale=database();stale.fuelPurchases[0].recordId='missing';const resolved=engine.prepare(stale,request);assert.equal(resolved.canPost,true);assert.ok(resolved.issues.some(row=>row.code==='purchase-link-resolved'));
  stale.records.push({...stale.records[0],id:'r2'});issue(stale,'purchase-link-invalid');
  const grade=database();grade.fuelPurchases[0].grade='АИ-923';issue(grade,'source-grade-invalid',{...request,grade:''});
});

test('negative stock and missing consumption cannot be approved by a note',()=>{
  const db=database();db.records[0].fuelActual=100;issue(db,'negative-balance');
  assert.throws(()=>post(db,{...request,basisNote:'Любой текст'}),code('WRITE_OFF_BLOCKED'));
  const missing=database();delete missing.records[0].fuelActual;issue(missing,'consumption-basis-missing');
});

test('measurement trace identifies its source and surplus needs correction of evidence',()=>{
  const db=database();db.records[0].tankMeasured=60;
  const prepared=engine.prepare(db,request);assert.equal(prepared.totals.end,60);assert.equal(prepared.totals.spent,30);
  assert.equal(prepared.consumption[0].source,'measurement');assert.equal(prepared.consumption[0].measurement,60);
  assert.equal(prepared.consumption[0].measurementRecordId,'r');
  delete db.records[0].fuelActual;const measuredWithoutNorm=engine.prepare(db,request);assert.equal(measuredWithoutNorm.canPost,true,JSON.stringify(measuredWithoutNorm.issues));
  assert.equal(measuredWithoutNorm.consumption[0].enteredActual,null);assert.equal(measuredWithoutNorm.totals.spent,30);
  const surplus=database();surplus.records[0].tankMeasured=100;issue(surplus,'measurement-surplus');
});

test('source fingerprint is order-stable for properties, precise, and excludes later operations',()=>{
  const db=database(),first=engine.fingerprint(db,request),permuted={...db,records:db.records.map(row=>Object.fromEntries(Object.entries(row).reverse()))};
  assert.equal(engine.fingerprint(permuted,request),first);
  const changed=clone(db);changed.records[0].fuelActual+=0.001;assert.notEqual(engine.fingerprint(changed,request),first);
  const future=clone(db);future.records.push({...future.records[0],id:'future',date:'2026-10-01'});assert.equal(engine.fingerprint(future,request),first);
  const historical=clone(db);historical.records.push({...historical.records[0],id:'history',date:'2026-08-01',fuelIssued:0});assert.notEqual(engine.fingerprint(historical,request),first);
});

test('posting checks optimistic fingerprint and preserves the entire frozen calculation',()=>{
  const db=database(),preview=engine.prepare(db,request);db.records[0].fuelActual=21;
  assert.throws(()=>engine.post(db,request,{id:'act',number:'1',postedAt:'2026-10-21T10:00:00Z',postedBy:author,expectedFingerprint:preview.sourceFingerprint}),code('STALE_SOURCES'));
  const document=post(database());assert.equal(document.status,'posted');assert.equal(document.events[0].type,'posted');
  assert.equal(document.postedBy.id,0);assert.ok(Object.isFrozen(document));assert.equal(document.snapshot.ledger.rows[0].end,68);
});

test('posted source protection permits later records but requires void before earlier edits',()=>{
  const db=database(),document=post(db),saved={...db,fuelWriteoffs:[document]};
  assert.equal(engine.validateWriteoffChanges(db,saved),true);
  const changed=clone(saved);changed.records[0].fuelActual=21;
  assert.throws(()=>engine.validateDocuments(saved,changed),code('POSTED_SOURCE_LOCKED'));
  const future=clone(saved);future.records.push({...future.records[0],id:'future',date:'2026-10-01'});assert.equal(engine.validateDocuments(saved,future),true);
  const voided=engine.voidDocument(document,{voidedAt:'2026-10-21T11:00:00Z',voidedBy:author,reason:'Исправление первичного документа'});
  changed.fuelWriteoffs=[voided];assert.equal(engine.validateDocuments(saved,changed),true);
});

test('snapshots, metadata, events, deletion and revival are immutable',()=>{
  const db=database(),document=post(db),saved={...db,fuelWriteoffs:[document]};
  for(const change of [d=>d.snapshot.records[0].km++,d=>d.totals.spent++,d=>d.number='different',d=>d.events[0].by.name='Different']) {
    const altered=clone(saved);change(altered.fuelWriteoffs[0]);assert.throws(()=>engine.validateDocuments(saved,altered),code('DOCUMENT_IMMUTABLE'));
  }
  assert.throws(()=>engine.validateDocuments(saved,{...saved,fuelWriteoffs:[]}),code('DOCUMENT_DELETE_FORBIDDEN'));
  const voided=engine.voidDocument(document,{voidedAt:'2026-10-21T11:00:00Z',voidedBy:author,reason:'Проверка данных'});
  assert.throws(()=>engine.validateDocuments({...saved,fuelWriteoffs:[voided]},saved),code('DOCUMENT_IMMUTABLE'));
  assert.throws(()=>engine.voidDocument(document,{voidedAt:'2026-10-21T11:00:00Z',voidedBy:author,reason:' '}),code('VOID_REASON_REQUIRED'));
  const forged=clone(db);forged.fuelWriteoffs=[clone(document)];forged.fuelWriteoffs[0].totals.spent=999;
  assert.throws(()=>engine.validateDocuments(db,forged),code('DOCUMENT_RECALCULATION_FAILED'));
});

test('overlapping scope is blocked, void permits a new independently posted act',()=>{
  const db=database(),document=post(db),saved={...db,fuelWriteoffs:[document]};issue(saved,'writeoff-overlap');
  assert.throws(()=>post(saved,{...request,grade:''},{id:'new'}),code('WRITE_OFF_BLOCKED'));
  const voided=engine.voidDocument(document,{voidedAt:'2026-10-21T11:00:00Z',voidedBy:author,reason:'Проверка первичных данных'});
  const nextDb={...db,fuelWriteoffs:[voided]},replacement=post(nextDb,request,{id:'replacement',number:'2'});
  assert.equal(engine.validateDocuments(saved,{...nextDb,fuelWriteoffs:[voided,replacement]}),true);
});

test('duplicate purchases and initial-source mismatch are not hidden by authoritative totals',()=>{
  const duplicates=database();duplicates.fuelPurchases.push({...duplicates.fuelPurchases[0],id:'p2'});duplicates.records[0].fuelIssued=80;issue(duplicates,'possible-duplicate-purchases');
  const opening=database();opening.vehicles[0].fuelBalanceSources=[{org:'A',grade:'АИ-95',qty:49}];issue(opening,'opening-difference');
});

test('unrelated explicit organizations are isolated while unidentified source organizations remain global',()=>{
  const db=database();db.vehicles.push({id:'other',org:'B',fuel:'gasoline',fuelGrade:'АИ-95',fuelBalance:20});
  db.records.push({id:'other-record',vehicleId:'other',date:'2026-09-06',fuelIssued:10,fuelActual:1,fuelGrade:'АИ-95'});
  db.fuelPurchases.push({id:'other-purchase',vehicleId:'other',recordId:'other-record',date:'2026-09-06',grade:'АИ-95',qty:11,sourceOrg:'B'});
  assert.equal(engine.prepare(db,request).canPost,true);
  delete db.fuelPurchases[1].sourceOrg;issue(db,'source-org');
});

test('September audit starts from confirmed carry without replaying resolved historical problems',()=>{
  const db=database();db.records.unshift({id:'august',vehicleId:'v',date:'2026-08-31',fuelGrade:'АИ-95',fuelIssued:10,fuelActual:0,tankMeasured:50,km:0});
  db.fuelPurchases.unshift({id:'august-purchase',recordId:'august',vehicleId:'v',date:'2026-08-31',grade:'АИ-95',qty:15,sourceOrg:'A'});
  db.records.unshift({id:'old-invalid',vehicleId:'v',date:'2026-08-01',fuelActual:-2,km:0,fuelGrade:'АИ-95'});
  const preview=engine.prepare(db,request);assert.equal(preview.canPost,true,JSON.stringify(preview.issues));
  assert.equal(preview.totals.start,50);assert.equal(preview.totals.end,68);
  assert.ok(preview.issues.some(row=>row.code==='invalid-number'&&row.severity==='warning'));
  assert.ok(!preview.issues.some(row=>row.code==='journal-difference'));
});

test('future card assignments do not alter the protected historical fingerprint',()=>{
  const db=database();db.vehicles[0].fuelcard='123';db.records[0].fuelCardNum='123';db.fuelPurchases[0].cardNo='123';
  db.fuelCards=[{id:'card',number:'123',org:'A',assignments:[{vehicleId:'v',from:'2026-01-01',to:''}],orgHistory:[{org:'A',from:'2026-01-01',to:''}]}];
  const document=post(db),saved={...db,fuelWriteoffs:[document]},future=clone(saved);
  future.fuelCards[0].assignments[0].to='2026-10-31';future.fuelCards[0].assignments.push({vehicleId:'future',from:'2026-11-01',to:''});
  future.fuelCards[0].orgHistory[0].to='2026-10-31';future.fuelCards[0].orgHistory.push({org:'B',from:'2026-11-01',to:''});
  assert.equal(engine.fingerprint(future,request),document.sourceFingerprint);assert.equal(engine.validateDocuments(saved,future),true);
  future.fuelCards[0].assignments[0].to='2026-08-31';assert.notEqual(engine.fingerprint(future,request),document.sourceFingerprint);
});

test('LPG vehicles remain outside the diesel/gasoline act and its barrel totals',()=>{
  const db=database();db.vehicles.push({id:'lpg',org:'A',fuel:'gas',fuelGrade:'Газ',fuelBalance:100});
  db.records.push({id:'lpg-r',vehicleId:'lpg',date:'2026-09-05',fuelGrade:'Газ',fuelIssued:0,fuelActual:10,km:100});
  const preview=engine.prepare(db,{...request,grade:''});assert.equal(preview.canPost,true,JSON.stringify(preview.issues));
  assert.equal(preview.rows.length,1);assert.equal(preview.snapshot.vehicles.length,1);
  assert.equal(preview.snapshot.ledger.barrels.reduce((sum,row)=>sum+row.spent,0),preview.totals.spent);
  assert.equal(preview.totals.spent,22);
});

test('vehicle status and photos remain editable while fuel inputs and printed identity are protected',()=>{
  const db=database();db.vehicles[0].photo='Synthetic photo';db.vehicles[0].status='working';
  const document=post(db),saved={...db,fuelWriteoffs:[document]};
  const updated=clone(saved);updated.vehicles[0].status='repair';updated.vehicles[0].photo='Another synthetic photo';
  assert.equal(engine.validateDocuments(saved,updated),true);
  assert.equal(document.snapshot.vehicles[0].photo,undefined);assert.equal(document.rows[0].vehicle.photo,undefined);
  assert.equal(document.snapshot.ledger.rows[0].vehicle.status,undefined);
  for (const [field,value] of [['fuelBalance',51],['norm',12],['plate','OTHER']]) {
    const changed=clone(saved);changed.vehicles[0][field]=value;
    assert.throws(()=>engine.validateDocuments(saved,changed),code('POSTED_SOURCE_LOCKED'));
  }
});

test('invalid historical spending blocks a positive opening until a later valid measurement anchors that family',()=>{
  const db=database();db.records.unshift({id:'old-invalid',vehicleId:'v',date:'2026-08-01',fuelGrade:'АИ-95',fuelActual:'bad',km:0});
  const uncertain=engine.prepare(db,request);assert.ok(uncertain.totals.start>0);assert.equal(uncertain.canPost,false);
  const blocker=uncertain.issues.find(row=>row.code==='opening-source-invalid');assert.equal(blocker.date,'2026-09-01');assert.equal(blocker.earliestCauseDate,'2026-08-01');assert.equal(blocker.recordId,'old-invalid');
  assert.throws(()=>post(db),code('WRITE_OFF_BLOCKED'));
  db.records.unshift({id:'wrong-family',vehicleId:'v',date:'2026-08-31',fuelGrade:'ДТ',fuelActual:0,tankMeasured:0,km:0});
  issue(db,'opening-source-invalid');
  db.records.push({id:'invalid-anchor-grade',vehicleId:'v',date:'2026-08-31',fuelGrade:'bad',fuelActual:0,tankMeasured:50,km:0});
  issue(db,'opening-source-invalid');
  db.records.push({id:'valid-anchor',vehicleId:'v',date:'2026-08-31',fuelGrade:'АИ-95',fuelActual:0,tankMeasured:50,km:0});
  const anchored=engine.prepare(db,request);assert.equal(anchored.canPost,true,JSON.stringify(anchored.issues));
  assert.equal(anchored.totals.start,50);assert.ok(anchored.issues.some(row=>row.code==='invalid-number'&&row.severity==='warning'));
  assert.ok(!anchored.issues.some(row=>row.code==='opening-source-invalid'));
});

test('missing historical quantity, grade, and consumption basis cannot silently create a clean opening',()=>{
  for (const source of ['quantity','grade','basis']) {
    const db=database();
    if (source==='quantity') db.fuelPurchases.unshift({id:'old-purchase',vehicleId:'v',date:'2026-08-01',grade:'АИ-95',sourceOrg:'A',qty:''});
    if (source==='grade') db.records.unshift({id:'old-grade',vehicleId:'v',date:'2026-08-01',fuelGrade:'bad',fuelActual:2,km:0});
    if (source==='basis') db.records.unshift({id:'old-basis',vehicleId:'v',date:'2026-08-01',fuelGrade:'АИ-95',km:10});
    issue(db,'opening-source-invalid');
  }
});
