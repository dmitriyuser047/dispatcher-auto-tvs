'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('operations diagnostics share one tank snapshot and display unknown stock without treating it as a low zero balance',()=>{
 let snapshots=0;const database={tanks:[{id:0,name:'Numeric',reserveLevel:20},{id:'0',name:'Textual',reserveLevel:20}],vehicles:[],generators:[]},before=JSON.stringify(database);
 const sandbox=vm.createContext({data:database,tankStockWithSnapshot(fn){snapshots++;return fn();},computeTankBalance:()=>({balance:null,status:'invalid',diagnostics:[{code:'STOCK_ALIASES_CONFLICT',message:'Противоречивые количества'}]})});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/js/28-operations-center.js'),'utf8'),sandbox);const issues=sandbox.opsCollectIssues(new Date('2026-09-05T12:00:00Z'));
 assert.equal(snapshots,1);assert.equal(issues.length,2);assert.ok(issues.every(issue=>issue.label==='ОСТАТОК НЕ ОПРЕДЕЛЁН'&&issue.body==='Противоречивые количества'));assert.notEqual(issues[0].id,issues[1].id);assert.equal(JSON.stringify(database),before);
});
