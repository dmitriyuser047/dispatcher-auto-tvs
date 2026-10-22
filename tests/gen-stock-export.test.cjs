'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const stock=require('../assets/core/fuel-stock.js'),decimal=require('../assets/core/decimal-core.js');
function context(database){let projects=0;const sandbox=vm.createContext({data:database,tanksAll:()=>database.tanks,dispatcherLocalDate:()=> '2026-09-30',FuelStock:{...stock,project(...args){projects++;return stock.project(...args);}},DecimalCore:decimal});vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/js/13-gen-export.js'),'utf8'),sandbox);return{sandbox,run:()=>sandbox.genExportTankStockSummary('2026-09-01','2026-09-30'),projects:()=>projects};}
test('generator summary exports physical tank flows from one dated snapshot without losing legacy precision or typed zero',()=>{
 const db={tanks:[{id:0,balanceInit:10},{id:'0',balanceInit:20}],tankIncomes:[{id:'exact',tankId:0,date:'2026-09-01',amount:.0004,archived:true},{id:'cancelled',tankId:0,date:'2026-09-02',amount:100,cancelled:true},{id:'future',tankId:0,date:'2026-10-01',amount:200}],generators:[{id:'g',tankId:0}],genRecords:[{id:'issue',generatorId:'g',tankId:0,date:'2026-09-02',fuelIssued:1}],fuelMovements:[{id:'transfer',kind:'transfer',fromTankId:0,toTankId:'0',qty:2,date:'2026-09-03'},{id:'measurement',kind:'measurement',date:'2026-09-30',qty:0,measurement:{version:1,target:{section:'tanks',id:0},observedQty:0}}]};
 const before=JSON.stringify(db),ctx=context(db),result=ctx.run();assert.equal(ctx.projects(),1);assert.equal(result.get(0).income,.0004);assert.equal(result.get(0).issued,3);assert.equal(result.get(0).balance,7.0004);assert.equal(result.get('0').income,2);assert.equal(result.get('0').balance,22);assert.equal(JSON.stringify(db),before);
});
test('unresolved source quantities cannot become partial known export totals',()=>{
 const db={tanks:[{id:0,balanceInit:10}],tankIncomes:[{id:'conflicting',tankId:0,date:'2026-09-01',amount:10,liters:20}],generators:[],genRecords:[],fuelMovements:[]},row=context(db).run().get(0);
 assert.equal(row.income,null);assert.equal(row.issued,null);assert.equal(row.balance,null);assert.match(row.label,/Нет достоверного остатка/);
});
