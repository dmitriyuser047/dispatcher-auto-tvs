'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),path=require('node:path');
const filename=require.resolve('../assets/core/platform-kernel.js'),kernel=require(filename),reference=new Module(filename,module);
reference.filename=filename;reference.paths=Module._nodeModulePaths(path.dirname(filename));reference._compile(fs.readFileSync(filename,'utf8').replace('patch=reuseUnchangedRows(prior,patch);',''),filename);
const ctx={id:'synthetic-kernel-row-reuse',identity:'synthetic',actor:{id:'test',name:'Synthetic',role:'admin'},now:'2026-11-11T12:00:00.000Z'};
const outcome=fn=>{try{return {plan:JSON.stringify(fn())};}catch(error){return {error:{name:error.name,code:error.code,message:error.message,issues:error.issues,details:error.details}};}};
test('canonical row reuse keeps identical plans, hashes, row ordering and independent frozen outputs',()=>{
 const previous={vehicles:[{id:0,plate:'SYNTHETIC NUMERIC',org:'A'},{id:'0',plate:'SYNTHETIC TEXT',org:'B'}],records:[{id:0,vehicleId:0,date:'2026-09-01',km:10,note:'Original',legacy:{z:[null,0,'Тест 🚚'],a:1}},{id:'0',vehicleId:'0',date:'2026-09-02',km:20,note:'Keep'}]};
 const next={records:structuredClone(previous.records)};next.records[0].note='Reviewed';const source=JSON.stringify({previous,next}),expected=outcome(()=>reference.exports.prepare(previous,next,ctx)),actual=outcome(()=>kernel.prepare(previous,next,ctx));assert.deepEqual(actual,expected);assert.ok(actual.plan);
 const plan=kernel.prepare(previous,next,ctx);assert.equal(plan.sections.records[1],plan.sourceSnapshot.records[1]);assert.notEqual(plan.sections.records[1],previous.records[1]);assert.notEqual(plan.sections.records[0],plan.sourceSnapshot.records[0]);assert.equal(Object.isFrozen(plan.sections.records[1].legacy||plan.sections.records[1]),true);assert.equal(JSON.stringify({previous,next}),source);previous.records[1].note='Later caller mutation';assert.equal(plan.sections.records[1].note,'Keep');
});
test('reordered, duplicate, legacy and malformed rows retain the existing validation outcomes',()=>{
 const previous={vehicles:[{id:'v',plate:'SYNTHETIC',org:'A'}],records:[{id:'same',vehicleId:'v',date:'2026-09-01',km:1},{id:'same',vehicleId:'v',date:'2026-09-02',km:2},{vehicleId:'v',date:'2026-09-03',km:3}]};
 const variants=[previous.records.slice().reverse(),[...previous.records,{id:'new',vehicleId:'v',date:'2026-09-04',km:0}],previous.records.map((row,index)=>index===1?{...row,note:'Reviewed duplicate'}:row),[...previous.records,null],[...previous.records,{id:'bad',vehicleId:'missing',date:'2026-09-04',km:1}]];
 for(const records of variants){const next={records};assert.deepEqual(outcome(()=>kernel.prepare(previous,next,ctx)),outcome(()=>reference.exports.prepare(previous,next,ctx)));}
});
