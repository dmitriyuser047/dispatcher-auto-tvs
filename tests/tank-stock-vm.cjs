'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
// Load the actual shared UI gateway into synthetic VM consumers; no storage or DOM IO.
module.exports=function installTankStock(context){
 context.FuelStock=require('../assets/core/fuel-stock.js');
 context.FuelOperations=require('../assets/core/fuel-operations.js');
 context.platformSessionContext??=()=>({actor:{id:'synthetic-admin',role:'admin'},readable:null,writable:null});
 context.document??={};context.document.addEventListener??=()=>{};
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/js/60-tank-stock.js'),'utf8'),context,{filename:'60-tank-stock.js'});
 return context;
};
