'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const policy=require('../assets/core/fuel-movement-policy'),schema=require('../assets/core/platform-schema'),commands=require('../assets/core/platform-commands'),storage=require('../electron/storage'),sqlite=require('../electron/sqlite-storage.cjs');
const {seedDatabase}=require('./period-test-support.cjs');
const now='2026-10-22T12:00:00.000Z',principal={id:'synthetic-exact-fuel',name:'Synthetic exact fuel policy',role:'dispatcher'};
const clone=value=>structuredClone(value),has=code=>error=>(error.issues||error.details?.issues||[]).some(issue=>issue.code===code);
function database(){return {...Object.fromEntries(schema.sections.map(name=>[name,[]])),tanks:[{id:0,fuel:'diesel',fuelGrade:'ДТ',balanceInit:10}],vehicles:[{id:0,fuel:'diesel',fuelGrade:'ДТ',fuelBalance:0,norm:10}],generators:[{id:0,fuel:'diesel',fuelBalance:0,tankId:0}]};}
function issued(assetRef='v:0'){
 const db=database(),vehicle=assetRef[0]==='v',name=vehicle?'records':'genRecords';
 db.fuelMovements=[{id:0,kind:'issue',qty:1,fromTankId:0,toTankId:null,assetRef,recordId:'linked',date:'2026-09-01',reason:'Synthetic issue'}];
 db[name]=[{id:'linked',date:'2026-09-01',fuelIssued:1,fuelUsed:0,fuelMovementId:0,...(vehicle?{vehicleId:0,km:0,fuelGrade:'ДТ'}:{generatorId:0,hours:0,tankId:null})}];return db;
}
function reverse(db){
 const original=db.fuelMovements[0],vehicle=original.assetRef[0]==='v',row=db[vehicle?'records':'genRecords'][0];
 original.reversedBy='0';original.reversedAt=now;row.originalFuelIssued=row.fuelIssued;row.fuelIssued=0;row.reversalId='0';row.reversedAt=now;
 db.fuelMovements.push({id:'0',kind:'adjustment',qty:original.qty,fromTankId:null,toTankId:0,assetRef:original.assetRef,originalMovementId:0,date:original.date,reason:'Synthetic reversal',createdAt:now});return db;
}

test('a new tank deficit below former epsilon is rejected exactly, while unchanged and improved old negatives remain repairable',()=>{
 const before=database();before.tanks[0].balanceInit=0.0009999999999;const after=clone(before);after.fuelMovements=[{id:'tiny',kind:'issue',qty:0.001,fromTankId:0,toTankId:null,date:'2026-09-02',reason:'Synthetic exact threshold'}];
 assert.throws(()=>policy.validateChanges(before,after),has('FUEL_STOCK_DEFICIT'));const issue=policy.inspect(after).issues.find(item=>item.code==='FUEL_STOCK_DEFICIT');assert.equal(issue.deficitDecimal,'0.0000000000001');
 const unchanged=clone(after);unchanged.tanks[0].note='Only a description';assert.equal(policy.validateChanges(after,unchanged),true);
 const improved=clone(after);improved.fuelMovements.push({id:'return',kind:'receipt',qty:0.001,fromTankId:null,toTankId:0,date:'2026-09-02',reason:'Actual additional receipt'});assert.equal(policy.validateChanges(after,improved),true);
 const worsened=clone(after);worsened.fuelMovements.push({id:'worse',kind:'issue',qty:0.001,fromTankId:0,toTankId:null,date:'2026-09-03',reason:'Must not deepen old shortage'});assert.throws(()=>policy.validateChanges(after,worsened),has('FUEL_STOCK_DEFICIT'));
});

test('reciprocal journal quantities and legacy transfer halves require exact equality rather than an epsilon',()=>{
 const before=database(),after=issued();after.records[0].fuelIssued=1.00000000001;assert.throws(()=>policy.validateChanges(before,after),has('FUEL_JOURNAL_QUANTITY'));
 const old=clone(after),note=clone(after);note.records[0].note='Untouched legacy quantity remains visible';assert.equal(policy.validateChanges(old,note),true);
 after.records[0].fuelIssued=1;assert.equal(policy.validateChanges(before,after),true);
 const pair=database();pair.tanks.push({id:'0',fuel:'diesel',balanceInit:0});pair.tankIncomes=[{id:'out',kind:'out',linkId:0,tankId:0,counterTankId:'0',date:'2026-09-01',amount:-1},{id:'in',kind:'in',linkId:0,tankId:'0',counterTankId:0,date:'2026-09-01',amount:1.00000000001}];assert.throws(()=>policy.validateChanges(before,pair),has('FUEL_LEGACY_TRANSFER_PAIR'));
});

for(const assetRef of ['v:0','g:0'])test(assetRef+' reversal cannot hide even a sub-millilitre consumed quantity in rounded balances',()=>{
 for(const spent of [0.001,0.0004,0.0000000000001]){
  const before=issued(assetRef),vehicle=assetRef[0]==='v',section=vehicle?'records':'genRecords';
  before[section].push({id:'spent',date:'2026-09-02',fuelActual:spent,...(vehicle?{vehicleId:0,km:0,fuelGrade:'ДТ'}:{generatorId:0,hours:0,tankId:null})});
  if(vehicle)before.records.push({id:'later-measurement',vehicleId:0,date:'2026-09-03',km:0,fuelActual:0,tankMeasured:1,fuelGrade:'ДТ'});
  const after=reverse(clone(before));assert.throws(()=>policy.validateChanges(before,after),has('FUEL_REVERSAL_ASSET_DEFICIT'),String(spent));assert.equal(before[section][1].fuelActual,spent);
 }
});

test('exact asset reversal retains typed journal keys, manual zero and unknown dated norms without inventing a zero expense',()=>{
 const before=issued(),next=reverse(clone(before));next.records.push({id:0,vehicleId:0,date:'2026-09-02',km:0,fuelActual:0,fuelGrade:'ДТ'},{id:'0',vehicleId:0,date:'2026-09-03',km:0,fuelActual:0,fuelGrade:'ДТ'});assert.equal(policy.validateChanges(before,next),true);
 const dated=issued();dated.vehicles[0].fuelNorms={version:1,periods:[{id:'later',from:'2026-10-01',basis:'Future explicit norm',parameters:{norm:10,normCity:null,normHighway:null,normIdle:null}}]};dated.records.push({id:'missing-norm',vehicleId:0,date:'2026-09-02',km:1,fuelGrade:'ДТ'});assert.throws(()=>policy.validateChanges(dated,reverse(clone(dated))),has('FUEL_REVERSAL_ASSET_UNKNOWN'));
});

test('unrelated duplicate historical journal IDs cannot overwrite an earlier negative reversal balance',()=>{
 for(const assetRef of ['v:0','g:0']){const before=issued(assetRef),vehicle=assetRef[0]==='v',section=vehicle?'records':'genRecords',binding=vehicle?{vehicleId:0,km:0,fuelGrade:'ДТ'}:{generatorId:0,hours:0,tankId:null};before[section].push({id:'duplicate',date:'2026-09-02',fuelActual:0.0004,...binding},{id:'duplicate',date:'2026-09-03',fuelActual:0,fuelIssued:1,...binding});assert.throws(()=>policy.validateChanges(before,reverse(clone(before))),has('FUEL_REVERSAL_ASSET_DEFICIT'));}
});

test('valid reversal proof requires actual unique typed reciprocal inverse, exact quantity, date and live facts',()=>{
 const db=reverse(issued());assert.equal(policy.isValidReversal(db,db.fuelMovements[0]),true);
 for(const mutate of [value=>value.fuelMovements.pop(),value=>value.fuelMovements.push({...value.fuelMovements[1]}),value=>value.fuelMovements[1].qty=1.00000000001,value=>value.fuelMovements[1].originalMovementId='0',value=>value.fuelMovements[1].date='2026-09-02',value=>value.fuelMovements[1].cancelled=true,value=>value.fuelMovements[1].status='cancelled',value=>value.fuelMovements[1].sourceSnapshot={fuel:'gasoline'}]){const broken=clone(db);mutate(broken);assert.equal(policy.isValidReversal(broken,broken.fuelMovements[0]),false);}
});

for(const format of ['json','sqlite'])test(format+' trusted issue cannot commit a negative remainder below the former stock epsilon',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-fuel-exact-')),dir=path.join(root,'db'),data=database();data.tanks[0].balanceInit=0.0009999999999;
 t.after(()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('tvs-fuel-exact-'));fs.rmSync(root,{recursive:true,force:true});});
 if(format==='sqlite')sqlite.create(dir,{data});else seedDatabase(dir,data);const before=storage.readSnapshot(dir),command={type:'IssueFuel',version:1,input:{tankId:0,target:{section:'vehicles',id:0},date:'2026-09-02',qty:0.001,reason:'Synthetic exact stock validation'}},request={protocolVersion:1,databaseToken:before.databaseToken,base:Object.fromEntries(commands.dependencies(command).map(name=>[name,before.revisions[name]])),operation:{id:'tiny-negative'},command};let backups=0;
 assert.throws(()=>storage.executeCommand(dir,request,{principal,now,beforeCommit:()=>backups++}),has('FUEL_STOCK_DEFICIT'));assert.equal(backups,0);assert.deepEqual(storage.readSnapshot(dir),before);
});
