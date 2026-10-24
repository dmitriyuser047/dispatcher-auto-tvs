'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const seasons=require('../assets/core/seasonal-fuel.js'),fuel=require('../assets/core/fuel-engine.js'),movement=require('../assets/core/fuel-movement-policy.js'),writeoff=require('../assets/core/writeoff-engine.js'),schema=require('../assets/core/platform-schema.js');
const copy=value=>structuredClone(value),vnorm=norm=>({norm,normCity:null,normHighway:null,normIdle:0}),gnorm=norm=>({norm,norm100:norm*2,norm50:norm,normIdle:0});
const request=(section,from='2026-11-01',season='winter')=>({section,season,from,basis:'Synthetic approved seasonal transition',operationId:'synthetic-season-'+section+'-'+from+'-'+season});
function fixture(){return {...Object.fromEntries(schema.sections.map(name=>[name,[]])),vehicles:[{id:'v',plate:'SYNTHETIC',org:'A',fuel:'diesel',fuelGrade:'ДТ',fuelBalance:100,norm:10,normIdle:0,fuelSeasons:{version:1,summer:vnorm(10),winter:vnorm(14)}}],generators:[{id:'g',name:'SYNTHETIC DES',org:'A',fuel:'diesel',fuelGrade:'ДТ',fuelBalance:100,power:100,norm:2,norm100:4,norm50:2,normIdle:0,fuelSeasons:{version:1,summer:gnorm(2),winter:gnorm(4)}}],records:[{id:'sep',vehicleId:'v',date:'2026-09-10',km:100},{id:'oct',vehicleId:'v',date:'2026-10-31',km:100},{id:'nov',vehicleId:'v',date:'2026-11-01',km:100},{id:'manual-zero',vehicleId:'v',date:'2026-11-02',km:100,fuelActual:0}],genRecords:[{id:'gen-sep',generatorId:'g',date:'2026-09-10',hours:2,load:100},{id:'gen-manual-zero',generatorId:'g',date:'2026-09-11',hours:1,fuelActual:0},{id:'gen-nov',generatorId:'g',date:'2026-11-01',hours:2,load:100}]};}
function apply(database,plan){assert.equal(plan.canApply,true,JSON.stringify(plan.issues));const next=copy(database);for(const change of plan.changes){const found=next[plan.section].filter(row=>row.id===change.id);assert.equal(found.length,1);found[0].fuelNorms=copy(change.after);}return next;}

test('vehicle season changes actual fuel math only from the reviewed date while manual zero, facts and DES remain unchanged',()=>{
 const db=fixture(),before=JSON.stringify(db),next=apply(db,seasons.prepare(db,request('vehicles'))),asset=next.vehicles[0];
 for(const [id,norm,total]of [['sep',10,10],['oct',10,10],['nov',14,14],['manual-zero',14,0]]){const result=fuel.fqRecord(next.records.find(row=>row.id===id),asset);assert.equal(result.norm,norm,id);assert.equal(result.total,total,id);}
 const ledger=fuel.buildLedger(next,{from:'2026-11-01',to:'2026-11-30'}),row=ledger.rows.find(value=>value.vehicleId==='v');assert.ok(row);assert.equal(row.start,80);assert.equal(row.end,66);
 assert.deepEqual(next.records,db.records);assert.deepEqual(next.generators,db.generators);assert.deepEqual(next.genRecords,db.genRecords);assert.equal(JSON.stringify(db),before);
});

test('generator season changes real load interpolation while keeping old physical quantities, power and vehicle norms',()=>{
 const db=fixture(),next=apply(db,seasons.prepare(db,request('generators'))),old=db.generators[0],asset=next.generators[0];
 for(const row of db.genRecords.filter(row=>row.date<'2026-11-01'))assert.equal(movement.generatorSpent(asset,row),movement.generatorSpent(old,row));
 assert.equal(movement.generatorNormSpent(asset,db.genRecords.find(row=>row.id==='gen-nov')),16);
 assert.equal(asset.power,100);assert.equal(asset.fuelNorms.periods.at(-1).parameters.power,100);
 assert.deepEqual(next.vehicles,db.vehicles);assert.deepEqual(next.records,db.records);assert.deepEqual(next.genRecords,db.genRecords);
});

test('season switching preserves explicitly stored journal norms including zero after the application date',()=>{
 for(const stored of [0,9.75]){
  const db=fixture();db.records=[{id:'stored-norm',vehicleId:'v',date:'2026-11-10',km:100,fuelUsed:stored}];
  const next=apply(db,seasons.prepare(db,request('vehicles'))),result=fuel.fqRecord(next.records[0],next.vehicles[0]);
  assert.equal(result.norm,stored);assert.equal(result.total,stored);assert.deepEqual(next.records,db.records);
 }
});

for(const version of [1,2,3,4,5,6])test('seasonal templates and future activation preserve posted v'+version+' source proof and frozen snapshot bytes',()=>{
 const db=fixture(),api=writeoff.forVersion(version),input={month:'2026-09',org:'A',grade:'ДТ',date:'2026-09-30',basisNote:'Synthetic independent reviewed act'};
 const preview=api.prepare(db,input);assert.equal(preview.canPost,true,JSON.stringify(preview.issues));
 const act=api.post(db,input,{id:'synthetic-old-'+version,number:'SYNTHETIC-'+version,postedAt:'2026-10-01T10:00:00.000Z',postedBy:{id:'synthetic-reviewer',name:'Synthetic reviewer'},expectedFingerprint:preview.sourceFingerprint}),frozen=JSON.stringify(act);
 const changedProfile=copy(db);changedProfile.vehicles[0].fuelSeasons.winter=vnorm(18);assert.equal(api.prepare(changedProfile,input).sourceFingerprint,preview.sourceFingerprint);
 const next=apply(changedProfile,seasons.prepare(changedProfile,request('vehicles')));assert.equal(api.prepare(next,input).sourceFingerprint,preview.sourceFingerprint);
 assert.equal(writeoff.validateWriteoffChanges({...db,fuelWriteoffs:[act]},{...next,fuelWriteoffs:[act]}),true);assert.equal(JSON.stringify(act),frozen);
 assert.deepEqual(next.records,db.records);assert.deepEqual(next.genRecords,db.genRecords);
});

for(const entry of ['engine-worker.js','transaction-worker.js','health-worker.js'])test(entry+' loads the seasonal dependency and blocks historical DES mode drift without DOM or storage',()=>{
 const posts=[],tasks=[],imports=[],core=path.resolve(__dirname,'../assets/core'),realm=vm.createContext({structuredClone,setTimeout:fn=>tasks.push(fn),postMessage:message=>posts.push(message)});
 realm.importScripts=(...names)=>{for(const name of names){imports.push(name);vm.runInContext(fs.readFileSync(path.resolve(core,name),'utf8'),realm,{filename:name});}};
 vm.runInContext(fs.readFileSync(path.join(core,entry),'utf8'),realm,{filename:entry});assert.ok(imports.includes('./seasonal-fuel.js'));assert.equal(realm.SeasonalFuel.apiVersion,1);
 const db=fixture();delete db.generators[0].norm100;delete db.generators[0].norm50;delete db.genRecords[0].load;
 const before=JSON.stringify(db),preview=realm.SeasonalFuel.prepare(db,request('generators'));
 assert.equal(preview.canApply,false);assert.equal(preview.changes.length,0);assert.ok(preview.issues.some(issue=>issue.code==='SEASON_HISTORY_CHANGED'&&issue.recordId==='gen-sep'),JSON.stringify(preview.issues));
 assert.equal(JSON.stringify(db),before);assert.equal(typeof realm.document,'undefined');assert.equal(typeof realm.fetch,'undefined');assert.equal(typeof realm.XMLHttpRequest,'undefined');
});
