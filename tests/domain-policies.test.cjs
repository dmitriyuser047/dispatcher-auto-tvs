'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const policies=require('../assets/core/platform-policies.js');
const fuelPolicy=require('../assets/core/fuel-movement-policy.js');
const documents=require('../assets/core/document-lifecycle.js');
const storage=require('../electron/storage.js');
const clock={today:'2026-10-21',now:'2026-10-21T12:00:00.000Z'};
const clone=value=>structuredClone(value);
function db(){return {vehicles:[{id:'v',fuel:'diesel',fuelGrade:'ДТ',fuelBalance:0,norm:10}],records:[],generators:[{id:'g',fuel:'diesel',fuelBalance:0,tankId:'t'}],genRecords:[],tanks:[{id:'t',fuel:'diesel',balanceInit:100},{id:'other',fuel:'diesel',balanceInit:0}],tankIncomes:[],fuelMovements:[],parts:[{id:'p',name:'Деталь'}],partMovements:[],drivers:[{id:'d',name:'Водитель'},{id:'o',name:'Оператор',personnelRoles:['operator']}],shiftReports:[]};}
const move=(patch={})=>({id:'m',date:'2026-10-01',kind:'issue',fromTankId:'t',toTankId:'',qty:20,reason:'Синтетический документ',...patch});
function issue(db,patch={}){
  const movement=move({assetRef:'v:v',recordId:'fuel-movement:m',sourceSnapshot:{tankId:'t',fuel:'diesel'},...patch});
  const vehicle=movement.assetRef.startsWith('v:'),record={id:movement.recordId,date:movement.date,fuelIssued:movement.qty,fuelUsed:0,fuelActual:null,fuelMovementId:movement.id,note:'Связанный приход',fuelSourceSnapshot:movement.sourceSnapshot};
  if(vehicle)Object.assign(record,{vehicleId:movement.assetRef.slice(2),fuelGrade:'ДТ',km:0});else Object.assign(record,{generatorId:movement.assetRef.slice(2),hours:0,tankId:null,fuelActualSource:'movement'});
  db.fuelMovements.push(movement);db[vehicle?'records':'genRecords'].push(record);return {movement,record};
}
function reverse(db,id='m',reverseId='rev'){
  const original=db.fuelMovements.find(row=>row.id===id),at=clock.now;
  const reversal={id:reverseId,date:original.date,kind:'adjustment',fromTankId:original.toTankId||'',toTankId:original.fromTankId||'',qty:original.qty,reason:'Синтетическое сторно',originalMovementId:original.id,assetRef:original.assetRef||'',createdAt:at,sourceSnapshot:original.sourceSnapshot||null};
  original.reversedBy=reversal.id;original.reversedAt=at;
  for(const section of ['records','genRecords'])for(const row of db[section])if(row.fuelMovementId===original.id){row.originalFuelIssued=row.fuelIssued;row.fuelIssued=0;row.reversalId=reversal.id;row.reversedAt=at;}
  db.fuelMovements.push(reversal);return reversal;
}
function fails(callback,code){assert.throws(callback,error=>(error.issues||error.details?.issues||[]).some(issue=>issue.code===code));}
function check(previous,next){return policies.validateChanges(previous,next,clock);}
function temp(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-domain-policy-'));t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('tvs-domain-policy-'));fs.rmSync(dir,{recursive:true,force:true});});return dir;}
const principal={id:'domain-test-admin',name:'Проверка правил',role:'admin'};
function payload(dir,sections,id){return {databaseToken:storage.databaseToken(dir),base:storage.readRevisions(dir),sections,...(id?{operation:{id}}:{})};}

test('a tank with 100 litres cannot issue 200 through a shared trusted policy',()=>{
  const before=db(),next=clone(before);next.fuelMovements.push(move({qty:200}));
  fails(()=>check(before,next),'FUEL_STOCK_DEFICIT');assert.equal(before.tanks[0].balanceInit,100);assert.deepEqual(before.fuelMovements,[]);
  next.fuelMovements[0].qty=100;assert.equal(check(before,next),true);
});

test('tank stock is checked at every affected date, including a deficit hidden by a later receipt',()=>{
  const before=db();before.genRecords=[{id:'legacy',generatorId:'g',date:'2026-10-10',fuelIssued:80}];before.tankIncomes=[{id:'later',tankId:'t',date:'2026-10-20',amount:200}];
  const next=clone(before);next.fuelMovements=[move({qty:50})];
  assert.throws(()=>check(before,next),error=>error.issues.some(issue=>issue.code==='FUEL_STOCK_DEFICIT'&&issue.date==='2026-10-10'));
  const opening=clone(before);opening.tanks[0].balanceInit=50;fails(()=>check(before,opening),'FUEL_STOCK_DEFICIT');
  const receipt=clone(before);receipt.genRecords[0].fuelIssued=120;fails(()=>check(before,receipt),'FUEL_STOCK_DEFICIT');
  const rewritten=clone(before);rewritten.tankIncomes[0].date='2026-10-21';fails(()=>check(before,rewritten),'DOCUMENT_FROZEN');
});

test('legacy signed tank transfers conserve litres and respect source stock and fuel type',()=>{
  const before=db(),next=clone(before);
  next.tankIncomes=[{id:'out',linkId:'pair',kind:'out',tankId:'t',counterTankId:'other',date:'2026-10-01',amount:-20},{id:'in',linkId:'pair',kind:'in',tankId:'other',counterTankId:'t',date:'2026-10-01',amount:20}];
  assert.equal(check(before,next),true);
  const missing=clone(next);missing.tankIncomes.pop();fails(()=>check(before,missing),'FUEL_LEGACY_TRANSFER_PAIR');
  const inflated=clone(next);inflated.tankIncomes[1].amount=30;fails(()=>check(before,inflated),'FUEL_LEGACY_TRANSFER_PAIR');
  const mixed=clone(next);mixed.tanks[1].fuel='gasoline';fails(()=>check(before,mixed),'FUEL_LEGACY_TRANSFER_GRADE');
  const overdrawn=clone(next);overdrawn.tanks[0].balanceInit=10;fails(()=>check(before,overdrawn),'FUEL_STOCK_DEFICIT');
});

test('legacy gen-record source fallback is preserved and explicit null avoids a second tank debit',()=>{
  const before=db(),next=clone(before);next.genRecords=[{id:'legacy',generatorId:'g',date:'2026-10-01',fuelIssued:101}];
  fails(()=>check(before,next),'FUEL_STOCK_DEFICIT');
  next.genRecords[0].tankId=null;assert.equal(check(before,next),true);
  const linked=clone(before);issue(linked,{assetRef:'g:g',qty:60});assert.equal(check(before,linked),true);
  delete linked.genRecords[0].tankId;fails(()=>check(before,linked),'FUEL_JOURNAL_DOUBLE_DEBIT');
});

test('a new generator issue overlapping an existing legacy issue requires explicit additional-issue confirmation',()=>{
  const before=db();before.genRecords=[{id:'legacy',generatorId:'g',date:'2026-10-01',fuelIssued:10}];
  const next=clone(before);issue(next,{assetRef:'g:g'});fails(()=>check(before,next),'FUEL_LEGACY_ISSUE_OVERLAP');
  next.fuelMovements[0].legacyOverlapConfirmed=true;assert.equal(check(before,next),true);
});

test('old negative stock can be repaired partially without demanding invented balances or rejecting unrelated edits',()=>{
  const before=db();before.genRecords=[{id:'old',generatorId:'g',date:'2026-10-10',fuelIssued:120}];
  const unrelated=clone(before);unrelated.vehicles[0].note='Уточнена карточка';assert.equal(check(before,unrelated),true);
  const improved=clone(before);improved.fuelMovements=[move({kind:'receipt',fromTankId:'',toTankId:'t',qty:5})];assert.equal(check(before,improved),true);
  const worsened=clone(before);worsened.fuelMovements=[move({qty:1})];fails(()=>check(before,worsened),'FUEL_STOCK_DEFICIT');
  const later=clone(before);later.fuelMovements=[move({kind:'receipt',fromTankId:'',toTankId:'t',qty:5,date:'2026-10-11'})];assert.equal(check(before,later),true);
});

test('directions, quantities and reasons are validated for every new tank movement',()=>{
  const before=db();
  for(const patch of [{kind:'receipt'},{kind:'return'},{kind:'transfer',toTankId:'t'},{kind:'adjustment',toTankId:'other'},{fromTankId:'',toTankId:''}]){
    const next=clone(before);next.fuelMovements=[move(patch)];fails(()=>check(before,next),'FUEL_DIRECTION');
  }
  for(const qty of [0,-1,true,'garbage','1e309']){const next=clone(before);next.fuelMovements=[move({qty})];fails(()=>check(before,next),'FUEL_QUANTITY');}
  const nonJSON=clone(before);nonJSON.fuelMovements=[move({qty:Infinity})];assert.throws(()=>check(before,nonJSON),error=>error.code==='STOCK_JSON');
  const noReason=clone(before);noReason.fuelMovements=[move({reason:'  '})];fails(()=>check(before,noReason),'FUEL_REASON');
  const stringQty=clone(before);stringQty.fuelMovements=[move({qty:'10.125'})];assert.equal(check(before,stringQty),true);
});

test('incompatible fuel cannot be transferred, issued to other fuel equipment or disguised in a source snapshot',()=>{
  const before=db(),transfer=clone(before);transfer.tanks[1].fuel='gasoline';transfer.fuelMovements=[move({kind:'transfer',toTankId:'other'})];
  fails(()=>check(before,transfer),'FUEL_GRADE_MISMATCH');
  const vehicle=clone(before);vehicle.vehicles[0].fuel='gasoline';vehicle.vehicles[0].fuelGrade='АИ-95';issue(vehicle);fails(()=>check(before,vehicle),'FUEL_GRADE_MISMATCH');
  const snapshot=clone(before);issue(snapshot);snapshot.fuelMovements[0].sourceSnapshot={tankId:'t',fuel:'gasoline'};fails(()=>check(before,snapshot),'FUEL_SOURCE_MISMATCH');
  const unsupported=clone(before);unsupported.fuelMovements=[move({kind:'return',fromTankId:'',toTankId:'t',assetRef:'v:v'})];fails(()=>check(before,unsupported),'FUEL_ASSET_RETURN');
  const unknown=clone(before);unknown.tanks[0].fuel='unknown';unknown.fuelMovements=[move()];fails(()=>check(before,unknown),'FUEL_TYPE_UNKNOWN');
  const direct=clone(before);direct.tanks[0].fuel='gasoline';direct.genRecords=[{id:'direct',generatorId:'g',date:'2026-10-01',fuelIssued:20}];fails(()=>check(before,direct),'FUEL_GENERATOR_GRADE');
});

test('each issue to equipment has exactly one matching journal row and reciprocal reference',()=>{
  const before=db(),valid=clone(before);issue(valid);assert.equal(check(before,valid),true);
  for(const alter of [
    next=>{next.records=[];},next=>{next.records.push({...next.records[0],id:'duplicate'});},
    next=>{next.records[0].fuelMovementId='other';},next=>{next.fuelMovements[0].recordId='wrong';}
  ]){const next=clone(valid);alter(next);fails(()=>check(before,next),'FUEL_JOURNAL_LINK');}
  const wrongDate=clone(valid);wrongDate.records[0].date='2026-10-02';fails(()=>check(before,wrongDate),'FUEL_JOURNAL_TARGET');
  const wrongQty=clone(valid);wrongQty.records[0].fuelIssued=19;fails(()=>check(before,wrongQty),'FUEL_JOURNAL_QUANTITY');
  const wrongJournal=clone(valid);wrongJournal.genRecords.push({id:'also',generatorId:'g',date:'2026-10-01',fuelIssued:20,tankId:null,fuelMovementId:'m'});fails(()=>check(before,wrongJournal),'FUEL_JOURNAL_DUPLICATE');
});

test('posted fuel and part movements cannot be edited, hidden or deleted but attachment metadata may change',()=>{
  const before=db();before.fuelMovements=[move()];before.partMovements=[{id:'part-in',partId:'p',kind:'receipt',date:'2026-10-01',qty:3,reason:'Приход'}];
  for(const section of ['fuelMovements','partMovements'])for(const patch of [{qty:1},{reason:'Другое основание'},{cancelled:true},{deleted:true},{archived:true}]){
    const next=clone(before);Object.assign(next[section][0],patch);fails(()=>check(before,next),'DOCUMENT_FROZEN');
  }
  const deleted=clone(before);deleted.fuelMovements=[];fails(()=>check(before,deleted),'DOCUMENT_DELETE_FORBIDDEN');
  const files=clone(before);files.fuelMovements[0].attachments=[{id:'test.pdf',name:'Подтверждение'}];files.fuelMovements[0].updatedAt=clock.now;files.partMovements[0].attachments=[];assert.equal(check(before,files),true);
});

test('linked receipt dates, litres, source and identity are protected while consumption and notes remain editable',()=>{
  const before=db();issue(before);
  for(const patch of [{fuelIssued:10},{date:'2026-10-02'},{fuelMovementId:''},{fuelOrg:'Подмена'},{fuelSourceSnapshot:{fuel:'gasoline'}}]){
    const next=clone(before);Object.assign(next.records[0],patch);fails(()=>check(before,next),'FUEL_JOURNAL_FROZEN');
  }
  const edited=clone(before);edited.records[0].note='Описание работы';edited.records[0].fuelActual=5;assert.equal(check(before,edited),true);
  const deleted=clone(before);deleted.records=[];fails(()=>check(before,deleted),'FUEL_JOURNAL_DELETE');
});

test('a verified issue reversal restores tank stock and zeroes the original receipt without duplicating it',()=>{
  for(const assetRef of ['v:v','g:g']){
    const before=db();issue(before,{assetRef});const next=clone(before);reverse(next);
    assert.equal(check(before,next),true);const section=assetRef.startsWith('v:')?'records':'genRecords';
    assert.equal(next[section].length,1);assert.equal(next[section][0].fuelIssued,0);assert.equal(next[section][0].originalFuelIssued,20);
    assert.equal(next.fuelMovements.length,2);assert.equal(next.fuelMovements[0].qty,20);
  }
});

test('forged, partial and repeated reversals are rejected',()=>{
  const before=db();issue(before);const valid=clone(before);reverse(valid);
  for(const alter of [next=>{next.fuelMovements[1].qty=1;},next=>{next.fuelMovements[1].date='2026-10-02';},next=>{next.fuelMovements[1].reason='';},next=>{next.fuelMovements[0].qty=1;},next=>{next.records[0].fuelIssued=20;}]){
    const next=clone(valid);alter(next);assert.throws(()=>check(before,next),{code:'POLICY_VIOLATION'});
  }
  const duplicate=clone(valid);duplicate.fuelMovements.push({...duplicate.fuelMovements[1],id:'second-reversal'});fails(()=>check(valid,duplicate),'DOCUMENT_REVERSAL_INVALID');
  const unpaired=clone(before);unpaired.fuelMovements.push({...valid.fuelMovements[1]});fails(()=>check(before,unpaired),'DOCUMENT_REVERSAL_INVALID');
});

test('reversal cannot remove fuel already consumed by equipment even when a later measurement hides the deficit',()=>{
  const before=db();issue(before);before.records.push({id:'spent',vehicleId:'v',date:'2026-10-02',km:0,fuelActual:15},{id:'measured',vehicleId:'v',date:'2026-10-03',km:0,fuelActual:0,tankMeasured:10});
  const next=clone(before);reverse(next);fails(()=>check(before,next),'FUEL_REVERSAL_ASSET_DEFICIT');
  const gen=db();issue(gen,{assetRef:'g:g'});gen.genRecords.push({id:'spent',generatorId:'g',date:'2026-10-02',fuelActual:15,hours:0,tankId:null});
  const reversed=clone(gen);reverse(reversed);fails(()=>check(gen,reversed),'FUEL_REVERSAL_ASSET_DEFICIT');
});

test('receipt and transfer reversals must preserve source stock at every later date',()=>{
  const receipt=db();receipt.tanks[0].balanceInit=0;receipt.fuelMovements=[move({kind:'receipt',fromTankId:'',toTankId:'t',qty:100})];receipt.genRecords=[{id:'spent',generatorId:'g',date:'2026-10-02',fuelIssued:80}];
  const receiptNext=clone(receipt);reverse(receiptNext);fails(()=>check(receipt,receiptNext),'FUEL_STOCK_DEFICIT');
  const transfer=db();transfer.fuelMovements=[move({kind:'transfer',toTankId:'other',qty:100})];
  const valid=clone(transfer);reverse(valid);assert.equal(check(transfer,valid),true);
  transfer.genRecords=[{id:'spent',generatorId:'g',tankId:'other',date:'2026-10-02',fuelIssued:80}];
  const consumed=clone(transfer);reverse(consumed);fails(()=>check(transfer,consumed),'FUEL_STOCK_DEFICIT');
});

test('a part issue can be reversed once by a matching return while the posted original remains intact',()=>{
  const before=db();before.partMovements=[{id:'receipt',partId:'p',date:'2026-10-01',kind:'receipt',qty:3,reason:'Приход'},{id:'part-out',partId:'p',date:'2026-10-02',kind:'issue',qty:2,assetRef:'v:v',reason:'Выдача'}];
  const next=clone(before);next.partMovements[1].reversedBy='return';next.partMovements[1].reversedAt=clock.now;
  next.partMovements.push({id:'return',partId:'p',date:'2026-10-02',kind:'return',qty:2,assetRef:'v:v',originalMovementId:'part-out',createdAt:clock.now,reason:'Ошибочная выдача'});
  assert.equal(check(before,next),true);
  next.partMovements[2].qty=1;fails(()=>check(before,next),'DOCUMENT_REVERSAL_INVALID');
});

test('accepted shifts freeze all content and deletion while allowing attachment metadata',()=>{
  const before=db();before.shiftReports=[{id:'shift',date:'2026-10-01',assetRef:'v:v',driverId:'d',status:'accepted',acceptedBy:'Принимающий',odoStart:100,odoEnd:150,hours:2,result:'Работа'}];
  for(const patch of [{odoEnd:999},{result:'Другая работа'},{acceptedBy:'Другой'},{status:'prepared'},{custom:{hidden:'Изменено'}},{archived:true}]){
    const next=clone(before);Object.assign(next.shiftReports[0],patch);fails(()=>check(before,next),'DOCUMENT_FROZEN');
  }
  const deleted=clone(before);deleted.shiftReports=[];fails(()=>check(before,deleted),'DOCUMENT_DELETE_FORBIDDEN');
  const files=clone(before);files.shiftReports[0].attachments=[{id:'proof.pdf'}];files.shiftReports[0].updatedAt=clock.now;assert.equal(check(before,files),true);
  const missing=db();missing.shiftReports=[{id:'shift',status:'accepted'}];fails(()=>check(db(),missing),'DOCUMENT_PROOF');
  const unrelated=clone(missing);unrelated.vehicles[0].note='Описание';assert.equal(check(missing,unrelated),true);
});

test('native full and section writes reject overdraw, accepted shift edits and broken links before audit or revision changes',t=>{
  const dir=temp(t),initial=db();initial.shiftReports=[{id:'shift',date:'2026-10-01',assetRef:'v:v',driverId:'d',status:'accepted',acceptedBy:'Принимающий',odoStart:100,odoEnd:150}];
  require('./period-test-support.cjs').seedDatabase(dir,initial);const before=storage.readSnapshot(dir);
  fails(()=>storage.writeSections(dir,payload(dir,{fuelMovements:[move({qty:200})]}),{principal,now:clock.now}),'FUEL_STOCK_DEFICIT');
  const tampered=clone(before.data);tampered.shiftReports[0].odoEnd=999;fails(()=>storage.writeAll(dir,tampered,{principal,now:clock.now}),'DOCUMENT_FROZEN');
  assert.deepEqual(storage.readSnapshot(dir),before);
  const next=clone(before.data);issue(next);const first=payload(dir,{fuelMovements:next.fuelMovements,records:next.records},'fuel-test-once');
  assert.equal(storage.writeSections(dir,first,{principal,now:clock.now}).ok,true);assert.equal(storage.writeSections(dir,first,{principal,now:clock.now}).replayed,true);
  const stored=storage.readSnapshot(dir);assert.equal(stored.data.records.length,1);assert.equal(stored.data.fuelMovements.length,1);
  const link=clone(stored.data.records);link[0].fuelIssued=1;fails(()=>storage.writeSections(dir,payload(dir,{records:link}),{principal,now:clock.now}),'FUEL_JOURNAL_QUANTITY');
  assert.deepEqual(storage.readSnapshot(dir),stored);
  const reversed=clone(stored.data);reverse(reversed);assert.equal(storage.writeSections(dir,payload(dir,{fuelMovements:reversed.fuelMovements,records:reversed.records}),{principal,now:clock.now}).ok,true);
  const final=storage.readSnapshot(dir);assert.equal(final.data.records[0].fuelIssued,0);assert.equal(final.data.records.length,1);assert.equal(final.data.fuelMovements.length,2);
});

test('native storage catches an intermediate stock deficit created by a backdated issue',t=>{
  const dir=temp(t),initial=db();initial.genRecords=[{id:'spent',generatorId:'g',date:'2026-10-10',fuelIssued:80}];initial.tankIncomes=[{id:'later',tankId:'t',date:'2026-10-20',amount:200}];
  storage.writeAll(dir,initial,{principal,now:clock.now});const before=storage.readSnapshot(dir);
  fails(()=>storage.writeSections(dir,payload(dir,{fuelMovements:[move({qty:50})]}),{principal,now:clock.now}),'FUEL_STOCK_DEFICIT');assert.deepEqual(storage.readSnapshot(dir),before);
});

test('pure browser modules expose the same API and health inspection honors unreadable sections',()=>{
  const context=vm.createContext({});for(const name of ['platform-contracts.js','entity-identity.js','decimal-core.js','accounting-boundary.js','effective-periods.js','generator-fuel.js','fuel-stock.js','fuel-engine.js','fuel-movement-policy.js','document-facts.js','document-lifecycle.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/core',name),'utf8'),context);
  assert.equal(context.FuelMovementPolicy.apiVersion,1);assert.equal(context.DocumentLifecycle.apiVersion,1);assert.equal(Object.isFrozen(context.FuelMovementPolicy),true);
  const before=db(),next=clone(before);issue(next);const copy=JSON.stringify(next);context.FuelMovementPolicy.validateChanges(before,next);assert.equal(JSON.stringify(next),copy);
  const invalid=clone(next);invalid.records=[];assert.equal(fuelPolicy.inspect(invalid,{readable:['vehicles']}).issues.length,0);
  const full=documents.inspect({shiftReports:[{id:'accepted',status:'accepted'}]});assert.equal(full.issues[0].code,'DOCUMENT_ACCEPTANCE_REQUIRED');
  assert.equal(documents.inspect({shiftReports:[{id:'accepted',status:'accepted'}]},{readable:['vehicles']}).issues.length,0);
});
