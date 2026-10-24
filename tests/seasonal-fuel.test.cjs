'use strict';
// Synthetic source cards only. No storage, profile, application clock or GUI.
const {test}=require('node:test'),assert=require('node:assert/strict');
const api=require('../assets/core/seasonal-fuel.js'),periods=require('../assets/core/effective-periods.js');
const fuel=require('../assets/core/fuel-engine.js'),movement=require('../assets/core/fuel-movement-policy.js');
const vparams=(norm,extra={})=>({norm,normCity:null,normHighway:null,normIdle:null,...extra});
const gparams=(norm,extra={})=>({norm,norm100:null,norm50:null,normIdle:null,...extra});
const vehicle=(id=0,extra={})=>({id,plate:'SYNTHETIC '+String(id),norm:10,normCity:12,normHighway:8,normIdle:1,fuel:'diesel',fuelGrade:'ДТ',fuelSeasons:{version:1,summer:vparams(10),winter:vparams(12)},...extra});
const generator=(id=0,extra={})=>({id,name:'SYNTHETIC DES '+String(id),power:100,norm:2,norm100:4,norm50:3,normIdle:1,fuelSeasons:{version:1,summer:gparams(2),winter:gparams(4)},...extra});
const database=(extra={})=>({vehicles:[vehicle()],generators:[generator()],records:[{id:'fact',vehicleId:0,date:'2026-10-01',km:123,fuelActual:15}],genRecords:[{id:'gen-fact',generatorId:0,date:'2026-10-01',hours:2,fuelActual:4}],...extra});
const request=(extra={})=>({section:'vehicles',season:'winter',from:'2026-11-01',basis:'Synthetic confirmed winter transition',operationId:'synthetic-season-op',...extra});
const container=(...items)=>({version:1,periods:items});
const period=(id,from,parameters,basis='Synthetic confirmed dated parameters')=>({id,from,basis,parameters});
const gp=(power,norm100,norm50,normIdle=1,norm=null)=>({power,norm,norm100,norm50,normIdle});
const apply=(db,preview)=>({...db,[preview.section]:db[preview.section].map(row=>{const change=preview.changes.find(value=>value.id===row.id);return change?{...row,fuelNorms:change.after}:row;})});
const resolve=(section,asset,date)=>periods.resolve(section,asset,date,'fuelNorms');
function frozen(value){assert.ok(Object.isFrozen(value));if(value&&typeof value==='object')for(const nested of Object.values(value))if(nested&&typeof nested==='object')frozen(nested);}

test('profiles are full typed nullable snapshots with exact zero and no generator power',()=>{
  assert.equal(api.apiVersion,1);const absent={id:0};assert.equal(api.validateProfiles('vehicles',absent),undefined);
  const raw=vehicle(0,{fuelSeasons:{version:1,summer:vparams(0,{normIdle:0}),winter:null}}),before=JSON.stringify(raw);
  const profile=api.validateProfiles('vehicles',raw);assert.equal(profile.summer.norm,0);assert.equal(profile.summer.normCity,null);assert.equal(profile.winter,null);frozen(profile);assert.equal(JSON.stringify(raw),before);
  const invalid=[vparams('10'),vparams(true),vparams(-1),vparams(NaN),vparams(1.0000001),vparams(1e12+1),{norm:10},vparams(10,{norm100:4})];
  for(const params of invalid)assert.throws(()=>api.validateProfiles('vehicles',vehicle(0,{fuelSeasons:{version:1,summer:params,winter:null}})),{code:'INVALID_SEASON_PROFILE'});
  assert.throws(()=>api.validateProfiles('generators',generator(0,{fuelSeasons:{version:1,summer:gparams(2,{power:200}),winter:null}})),{code:'INVALID_SEASON_PROFILE'});
  assert.throws(()=>api.validateProfiles('tanks',raw),{code:'INVALID_SEASON_SECTION'});
});

test('a technical 1900 baseline conserves every supported legacy day before the chosen application date',()=>{
  const db=database(),before=JSON.stringify(db),preview=api.prepare(db,request()),change=preview.changes[0],next=apply(db,preview);
  assert.equal(preview.canApply,true);assert.equal(change.before,null);assert.equal(change.baselineAdded,true);assert.equal(change.after.periods.length,2);
  assert.equal(change.after.periods[0].from,'1900-01-01');assert.equal(change.after.periods[0].basis,'Прежние нормы карточки до сезонного перехода');
  for(const date of ['1900-01-01','1999-12-31','2025-01-01','2026-10-31'])assert.deepEqual(resolve('vehicles',next.vehicles[0],date).parameters,resolve('vehicles',db.vehicles[0],date).parameters);
  assert.equal(fuel.fqRecord({date:'2026-10-31',km:100},next.vehicles[0]).norm,10);
  assert.equal(fuel.fqRecord({date:'2026-11-01',km:100},next.vehicles[0]).norm,12);
  assert.equal(api.currentSeason('vehicles',next.vehicles[0],'2026-10-31').status,'custom');assert.equal(api.currentSeason('vehicles',next.vehicles[0],'2026-11-01').season,'winter');
  assert.equal(next.records,db.records);assert.equal(next.genRecords,db.genRecords);assert.equal(next.generators,db.generators);assert.equal(JSON.stringify(db),before);frozen(preview);assert.equal(Object.isFrozen(db.vehicles[0]),false);
});

test('vehicle and DES group switches select their own profiles and never touch the other catalogue or facts',()=>{
  const db=database(),before=JSON.stringify(db);
  const car=api.prepare(db,request({season:'summer',from:'2027-05-01'})),des=api.prepare(db,request({section:'generators'}));
  assert.equal(car.changes[0].parametersAfter.norm,10);assert.equal(des.changes[0].parametersAfter.norm,4);assert.equal(des.changes[0].parametersAfter.power,100);
  assert.equal(Object.hasOwn(car.changes[0].parametersAfter,'power'),false);assert.equal(des.changes[0].after.periods[0].parameters.power,100);
  const next=apply(db,des);assert.equal(next.vehicles,db.vehicles);assert.equal(next.records,db.records);assert.equal(next.genRecords,db.genRecords);assert.equal(JSON.stringify(db),before);
});

test('dated DES power is resolved on the application date and future periods remain unchanged',()=>{
  const old=period('prior','2026-10-01',gp(200,20,10,2)),future=period('future','2026-12-01',gp(300,10,4));
  const db=database({generators:[generator(0,{power:100,fuelNorms:container(old,future),fuelSeasons:{version:1,summer:gparams(null,{norm100:20,norm50:10,normIdle:2}),winter:gparams(null,{norm100:40,norm50:20,normIdle:2})}})]});
  const before=JSON.stringify(db),preview=api.prepare(db,request({section:'generators'})),change=preview.changes[0],next=apply(db,preview).generators[0];
  assert.equal(preview.canApply,true);assert.equal(change.parametersBefore.power,200);assert.equal(change.parametersAfter.power,200);assert.equal(change.toExclusive,'2026-12-01');assert.equal(change.baselineAdded,false);
  assert.deepEqual(change.after.periods.find(value=>value.id==='future'),future);assert.deepEqual(resolve('generators',next,'2026-10-31').parameters,old.parameters);assert.deepEqual(resolve('generators',next,'2026-12-01').parameters,future.parameters);
  assert.equal(movement.generatorNormSpent(next,{date:'2026-11-01',hours:2,load:150}),60);assert.equal(JSON.stringify(db),before);
});

test('a period on the exact date is replaced explicitly with its original snapshot in preview',()=>{
  const old=period('manual','2026-11-01',vparams(11)),future=period('future','2026-12-01',vparams(14));
  const db=database({vehicles:[vehicle(0,{fuelNorms:container(old,future)})]}),before=JSON.stringify(db),preview=api.prepare(db,request()),change=preview.changes[0];
  assert.equal(change.action,'replace');assert.deepEqual(change.periodBefore,old);assert.equal(change.periodAfter.from,'2026-11-01');assert.equal(change.periodAfter.parameters.norm,12);
  assert.equal(change.after.periods.length,2);assert.equal(change.toExclusive,'2026-12-01');assert.ok(preview.warnings.some(issue=>issue.code==='SEASON_PERIOD_REPLACED'&&issue.id===0));assert.equal(JSON.stringify(db),before);
});

test('the same seasonal parameters already effective on the requested day are an exact no-op',()=>{
  const db=database(),next=apply(db,api.prepare(db,request())),before=JSON.stringify(next);
  const again=api.prepare(next,request({from:'2026-11-15',basis:'Another reviewed request',operationId:'another-operation'}));
  assert.equal(again.canApply,true);assert.equal(again.changes.length,0);assert.equal(again.counts.unchanged,1);assert.equal(again.counts.changed,0);assert.equal(JSON.stringify(next),before);
  next.vehicles[0].fuelSeasons={...next.vehicles[0].fuelSeasons,winter:vparams(99)};
  assert.equal(api.currentSeason('vehicles',next.vehicles[0],'2026-11-15').parameters.norm,12,'editing a profile must not rewrite a saved period');
  const different=api.prepare(next,request({from:'2026-11-15',operationId:'new-profile'}));assert.equal(different.changes[0].parametersAfter.norm,99);
});

test('typed zero IDs remain separate; archived/deleted cards are excluded and duplicate IDs fail closed',()=>{
  const db=database({vehicles:[vehicle(0),vehicle('0'),vehicle('archived',{archived:true,fuelSeasons:null}),vehicle('deleted',{deleted:true,fuelSeasons:null})]}),before=JSON.stringify(db),preview=api.prepare(db,request());
  assert.equal(preview.canApply,true);assert.deepEqual(preview.changes.map(value=>value.id),[0,'0']);assert.deepEqual(preview.counts,{total:4,active:2,excluded:2,changed:2,unchanged:0,blocked:0});assert.equal(JSON.stringify(db),before);
  for(const rows of [[vehicle(0),vehicle(0)],[vehicle(0),vehicle(0,{archived:true})]]){
    const blocked=api.prepare(database({vehicles:rows}),request());assert.equal(blocked.canApply,false);assert.equal(blocked.changes.length,0);assert.ok(blocked.issues.some(issue=>issue.code==='SEASON_DUPLICATE_ID'&&issue.id===0));
  }
});

test('one missing, malformed or unusable selected profile prevents partial group application',()=>{
  for(const bad of [null,undefined,{version:1,summer:vparams(10),winter:null},{version:1,summer:vparams(10),winter:vparams(null)},{version:1,summer:vparams(10),winter:{norm:12}}]){
    const broken=vehicle('missing');if(bad===undefined)delete broken.fuelSeasons;else broken.fuelSeasons=bad;
    const db=database({vehicles:[vehicle(0),broken]}),before=JSON.stringify(db),preview=api.prepare(db,request());
    assert.equal(preview.canApply,false);assert.equal(preview.changes.length,0);assert.equal(preview.counts.changed,0);assert.equal(preview.counts.blocked,1);assert.equal(preview.issues[0].id,'missing');assert.equal(JSON.stringify(db),before);
  }
  const cityOnly=vehicle(0,{fuelSeasons:{version:1,summer:null,winter:vparams(null,{normCity:0,normHighway:12})}});
  assert.equal(api.prepare(database({vehicles:[cityOnly]}),request()).canApply,true);
  const idleOnly=generator(0,{fuelSeasons:{version:1,summer:null,winter:gparams(null,{norm50:0,normIdle:2})}});
  assert.ok(api.prepare(database({generators:[idleOnly]}),request({section:'generators'})).issues.some(issue=>issue.code==='SEASON_NORM_MISSING'));
  const explicitZero=generator(0,{fuelSeasons:{version:1,summer:null,winter:gparams(0)}});assert.equal(api.prepare(database({generators:[explicitZero]}),request({section:'generators'})).canApply,true);
});

test('the minimum supported date needs no baseline and invalid dates or request tokens never become periods',()=>{
  const preview=api.prepare(database(),request({from:'1900-01-01'}));assert.equal(preview.changes[0].baselineAdded,false);assert.equal(preview.changes[0].after.periods.length,1);
  for(const from of ['1899-12-31','2026-02-30','2026-9-1','bad',''])assert.throws(()=>api.prepare(database(),request({from})),{code:'INVALID_SEASON_REQUEST'});
  for(const operationId of ['', 'with space', 'x'.repeat(161)])assert.throws(()=>api.prepare(database(),request({operationId})),{code:'INVALID_SEASON_REQUEST'});
  assert.throws(()=>api.prepare(database(),request({basis:' '})),{code:'INVALID_SEASON_REQUEST'});assert.throws(()=>api.prepare(database(),request({section:'tanks'})),{code:'INVALID_SEASON_SECTION'});
});

test('legacy conversion retains valid decimal strings but refuses scalar reinterpretation or precision loss',()=>{
  const valid=vehicle(0,{norm:'10.125',normCity:'0',normHighway:'',normIdle:null}),preview=api.prepare(database({vehicles:[valid]}),request());
  assert.equal(preview.canApply,true);assert.deepEqual(preview.changes[0].after.periods[0].parameters,{norm:10.125,normCity:0,normHighway:null,normIdle:null});
  for(const norm of ['0x10',true,-1,10.0000001,'0.100000000000000005']){
    const db=database({vehicles:[vehicle(0,{norm})]}),before=JSON.stringify(db),result=api.prepare(db,request());assert.equal(result.canApply,false);assert.equal(result.changes.length,0);assert.ok(result.issues.some(issue=>issue.code==='SEASON_LEGACY_INVALID'&&issue.field==='norm'));assert.equal(JSON.stringify(db),before);
  }
});

test('season presentation comes only from a selected period prefix and missing dated power stays unknown',()=>{
  const db=database({generators:[generator(0,{power:999,fuelNorms:container(period('future','2026-12-01',gp(300,10,5)))})]}),preview=api.prepare(db,request({section:'generators'}));
  assert.equal(preview.canApply,true);assert.equal(preview.changes[0].parametersAfter.power,null);assert.ok(preview.warnings.some(issue=>issue.code==='SEASON_POWER_UNKNOWN'));
  assert.equal(api.currentSeason('generators',db.generators[0],'2026-10-01').status,'missing');
  const next=apply(db,preview).generators[0];assert.equal(api.currentSeason('generators',next,'2026-11-01').season,'winter');assert.equal(api.currentSeason('generators',next,'2026-12-01').status,'custom');
  assert.equal(api.currentSeason('generators',next,'2026-12-01').parameters.power,300);
});

test('hidden fields, getters, sparse lists and unknown profile versions fail without executing application code',()=>{
  let calls=0;const asset={id:0};Object.defineProperty(asset,'fuelSeasons',{enumerable:true,get(){calls++;return {version:1};}});
  assert.throws(()=>api.validateProfiles('vehicles',asset),{code:'INVALID_SEASON_PROFILE'});assert.equal(calls,0);
  const params=vparams(10);Object.defineProperty(params,'norm',{enumerable:true,get(){calls++;return 10;}});
  assert.throws(()=>api.validateProfiles('vehicles',vehicle(0,{fuelSeasons:{version:1,summer:params,winter:null}})),{code:'INVALID_SEASON_PROFILE'});assert.equal(calls,0);
  assert.throws(()=>api.validateProfiles('vehicles',vehicle(0,{fuelSeasons:{version:2,summer:vparams(10),winter:null}})),{code:'INVALID_SEASON_PROFILE'});
  const sparse=api.prepare(database({vehicles:new Array(1)}),request());assert.equal(sparse.canApply,false);assert.equal(sparse.changes.length,0);
});

test('a legacy physical zero cannot silently become dated unknown before a seasonal transition',()=>{
  const db=database({generators:[generator(0,{norm:2,power:100})],genRecords:[{id:'old-unconfirmed',generatorId:0,date:'2026-09-10',hours:1}]}),before=JSON.stringify(db);
  assert.equal(movement.generatorSpent(db.generators[0],db.genRecords[0]),0);
  const preview=api.prepare(db,request({section:'generators'})),issue=preview.issues.find(value=>value.code==='SEASON_HISTORY_CHANGED');
  assert.equal(preview.canApply,false);assert.equal(preview.changes.length,0);assert.equal(issue.id,0);assert.equal(issue.recordId,'old-unconfirmed');assert.equal(issue.field,'fuelNorms');
  assert.equal(issue.beforeValue,0);assert.equal(issue.afterValue,null);assert.deepEqual(issue.sourceRef,{section:'genRecords',id:'old-unconfirmed'});assert.equal(JSON.stringify(db),before);
});

test('recorded actuals, stored consumption and computable dated loads retain the historical physical result',()=>{
  for(const facts of [{fuelActual:0},{fuelActual:2},{fuelUsed:0},{fuelUsed:2},{load:50}]){
    const db=database({genRecords:[{id:0,generatorId:0,date:'2026-09-10',hours:1,...facts}]}),before=JSON.stringify(db),preview=api.prepare(db,request({section:'generators'}));
    assert.equal(preview.canApply,true,JSON.stringify(preview.issues));const next=apply(db,preview);
    assert.equal(movement.generatorSpent(next.generators[0],db.genRecords[0]),movement.generatorSpent(db.generators[0],db.genRecords[0]));assert.equal(JSON.stringify(db),before);
  }
});

test('one affected DES blocks the whole group while typed generator and record IDs remain distinct',()=>{
  const db=database({generators:[generator(0),generator('0')],genRecords:[
    {id:0,generatorId:0,date:'2026-09-10',hours:1},
    {id:'0',generatorId:0,date:'2026-09-11',hours:1},
    {id:'other',generatorId:'0',date:'2026-09-10',hours:1,fuelActual:0}
  ]}),before=JSON.stringify(db),preview=api.prepare(db,request({section:'generators'}));
  assert.equal(preview.canApply,false);assert.equal(preview.changes.length,0);assert.equal(preview.counts.blocked,1);
  assert.deepEqual(preview.issues.map(value=>value.recordId),[0,'0']);assert.ok(preview.issues.every(value=>value.id===0));assert.equal(JSON.stringify(db),before);
});

test('historical physical verification cannot be hidden by moving the new accounting boundary or replacing past facts',()=>{
  const before=generator(0),after={...before,fuelNorms:container(period('baseline','1900-01-01',gp(100,4,3,1,2)),period('fuel-season:winter:new','2026-11-01',gp(100,null,null,null,4))),fuelAccounting:{version:1,from:'2026-11-01',opening:0,basis:'Synthetic new boundary'}};
  const records=[{id:0,generatorId:0,date:'2026-09-10',hours:1}];
  const issues=api.historicalIssues('generators',before,after,records,records,'2026-11-01');assert.equal(issues.length,1);assert.equal(issues[0].beforeValue,0);assert.equal(issues[0].afterValue,null);
  const actual=[{id:0,generatorId:0,date:'2026-09-10',hours:1,fuelActual:2}];
  const removed=api.historicalIssues('generators',before,after,actual,[],'2026-11-01');assert.equal(removed.length,1);assert.equal(removed[0].beforeValue,2);assert.equal(removed[0].afterValue,0);
  assert.deepEqual(api.historicalIssues('vehicles',vehicle(0),vehicle(0),[],[],'2026-11-01'),[]);
});

test('old accounting exclusions, future and cancelled rows never read unused numeric getters',()=>{
  let executed=0;const hidden=extra=>{const row={id:'hidden',generatorId:0,date:'2026-09-10',hours:1,...extra};Object.defineProperty(row,'fuelActual',{enumerable:true,get(){executed++;return 0;}});return row;};
  const row=generator(0,{fuelAccounting:{version:1,from:'2026-10-01',opening:0,basis:'Synthetic existing opening'}});
  const records=[hidden({id:'before-accounting'}),hidden({id:'future',date:'2026-12-01'}),hidden({id:'deleted',deleted:true}),hidden({id:'cancelled',status:'cancelled'})];
  const preview=api.prepare(database({generators:[row],genRecords:records}),request({section:'generators'}));assert.equal(preview.canApply,true);assert.equal(executed,0);
  const relevant=hidden({id:0,date:'2026-10-10'}),blocked=api.prepare(database({generators:[row],genRecords:[relevant]}),request({section:'generators'}));
  assert.equal(blocked.canApply,false);assert.equal(blocked.issues[0].recordId,0);assert.equal(executed,0);
});
