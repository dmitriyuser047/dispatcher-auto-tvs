'use strict';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {launch}=require('./helpers/fuel-import-ui-harness.cjs'),{install}=require('./helpers/ui-snapshot-fixture.cjs');
let harness;before(async()=>{harness=await launch();});after(async()=>{await harness?.browser.close();});
async function fixture(t){
 const page=await harness.browser.newPage(),errors=[];t.after(()=>page.close());page.on('pageerror',error=>errors.push(error.message));
 const database={vehicles:[{id:0,plate:'SYNTHETIC',org:'Synthetic org',fuel:'diesel',fuelGrade:'ДТ',norm:10,fuelBalance:100}],records:[{id:0,vehicleId:0,date:'2026-10-01',km:100,fuelActual:1,fuelUsed:1,fuelOrg:'Original org',fuelProvider:'Original provider',importMetadata:{original:'Synthetic immutable details'}},{id:'0',vehicleId:0,date:'2026-10-02',km:50,fuelActual:1}],fuelCards:[{id:'cash',number:'НАЛИЧКА',provider:'Наличка',assignments:[]}],appMeta:[{id:'meta',toPlanInit:'synthetic'}]};
 await install(page,{database,token:'synthetic-record-command'});await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);await page.waitForFunction(()=>typeof data!=='undefined'&&data.vehicles[0]?.id===0);
 await page.evaluate(()=>{
  toAutoSetupOnce=async()=>{};selectedYear=2026;selectedMonth=10;switchSection('vehicles');selectVehicle(0);openVehicleJournal('journal');
  window.__commandCalls=[];window.__genericCalls=0;window.__rollbackCaptures=0;window.__commandResponse={ok:true};window.__delayedCommand=false;
  window.__available=true;window.__clean=true;platformVehicleRecordCommandAvailable=()=>__available;platformVehicleRecordCommandSourceClean=()=>__clean;
  const capture=captureSaveRollback;captureSaveRollback=(...args)=>{__rollbackCaptures++;return capture(...args);};
  saveData=async()=>{__genericCalls++;return true;};
  platformExecuteCommand=async(command,options)=>{
   __commandCalls.push({command:structuredClone(command),options:structuredClone(options),dataBefore:JSON.stringify(data.records)});
   const reply=__delayedCommand?await new Promise(resolve=>{window.__resolveCommand=resolve;}):__commandResponse;
   if(reply.throw)throw Error(reply.error||'Synthetic transport failure');
   if(reply.ok){const planned=structuredClone(command.input.record),old=data.records.find(row=>row.id===planned.id);data.records=old?data.records.map(row=>row.id===planned.id?{...row,...planned}:row):[...data.records,planned];rebuildIndex();}
   return reply;
  };
 });return {page,errors};
}
async function begin(page,code){await page.evaluate(code);await page.waitForFunction(()=>__commandCalls.length>0);}

test('an unchanged confirmed draft needs no write, while an unknown earlier edit cannot be dismissed as unchanged',async t=>{
 const {page,errors}=await fixture(t);const unchanged=await page.evaluate(async()=>{openEditRecord(0);const before=JSON.stringify(data.records);await saveRecord();return {commands:__commandCalls.length,generic:__genericCalls,closed:!document.getElementById('recordModal').classList.contains('open'),same:JSON.stringify(data.records)===before};});assert.deepEqual(unchanged,{commands:0,generic:0,closed:true,same:true});
 const unknown=await page.evaluate(async()=>{openEditRecord(0);document.getElementById('rec_km').value='111';__commandResponse={ok:false,unknown:true,queued:true,error:'Synthetic receipt missing'};await saveRecord();document.getElementById('rec_km').value='100';await saveRecord();return {commands:__commandCalls.length,generic:__genericCalls,open:document.getElementById('recordModal').classList.contains('open'),km:data.records[0].km};});assert.deepEqual(unknown,{commands:1,generic:0,open:true,km:100});assert.deepEqual(errors,[]);
});

test('one-record command carries typed zero and editable fields only, leaves data unchanged until ACK and refreshes canonical values', {timeout:20000},async t=>{
 const {page,errors}=await fixture(t);await begin(page,()=>{openEditRecord(0);document.getElementById('rec_km').value='123';__delayedCommand=true;window.__before=JSON.stringify(data.records);window.__save=saveRecord();});
 const pending=await page.evaluate(()=>{closeModal('recordModal');return {calls:__commandCalls,unchanged:JSON.stringify(data.records)===__before,generic:__genericCalls,rollback:__rollbackCaptures,open:document.getElementById('recordModal').classList.contains('open'),locked:[...document.querySelectorAll('#recordModal input,#recordModal select,#recordModal textarea,#recordModal button')].every(control=>control.disabled)};});
 assert.equal(pending.calls.length,1);const payload=pending.calls[0].command;assert.equal(payload.type,'VehicleRecordAction');assert.equal(payload.version,1);assert.equal(payload.input.action,'save');assert.equal(payload.input.record.id,0);assert.equal(payload.input.record.vehicleId,0);assert.equal(payload.input.record.km,123);assert.equal(Object.hasOwn(payload.input.record,'importMetadata'),false);assert.equal(Object.hasOwn(payload.input.record,'fuelOrg'),false);assert.equal(Object.hasOwn(payload.input.record,'fuelProvider'),false);assert.equal(Object.hasOwn(payload,'database'),false);assert.equal(pending.unchanged,true);assert.equal(pending.generic,0);assert.equal(pending.rollback,0);assert.equal(pending.open,true);assert.equal(pending.locked,true);
 const after=await page.evaluate(async()=>{__resolveCommand({ok:true});await __save;return {closed:!document.getElementById('recordModal').classList.contains('open'),row:data.records.find(row=>row.id===0),textRow:data.records.find(row=>row.id==='0'),calls:__commandCalls.length,unlock:!document.querySelector('#recordModal input').disabled};});
 assert.equal(after.closed,true);assert.equal(after.row.km,123);assert.deepEqual(after.row.importMetadata,{original:'Synthetic immutable details'});assert.equal(after.row.fuelOrg,'Original org');assert.equal(after.row.fuelProvider,'Original provider');assert.equal(after.textRow.km,50);assert.equal(after.calls,1);assert.equal(after.unlock,true);assert.deepEqual(errors,[]);
});

test('old connections and dirty neighboring sections use the full guarded legacy save rather than silently dropping edits',async t=>{
 const {page,errors}=await fixture(t);for(const reason of ['capability','dirty']){
  const result=await page.evaluate(async reason=>{__available=reason!=='capability';__clean=reason!=='dirty';openEditRecord(0);document.getElementById('rec_km').value=String(reason==='capability'?111:222);data.vehicles[0].note='Unsaved neighbor '+reason;await saveRecord();return {command:__commandCalls.length,generic:__genericCalls,rollback:__rollbackCaptures,km:data.records.find(row=>row.id===0).km,neighbor:data.vehicles[0].note};},reason);
  assert.equal(result.command,0);assert.equal(result.generic,reason==='capability'?1:2);assert.equal(result.rollback,reason==='capability'?1:2);assert.equal(result.km,reason==='capability'?111:222);assert.equal(result.neighbor,'Unsaved neighbor '+reason);
 }assert.deepEqual(errors,[]);
});

test('an unconfirmed new row keeps one record ID and operation ID; edits wait for recovery and an unchanged retry cannot duplicate it',async t=>{
 const {page,errors}=await fixture(t);const first=await page.evaluate(async()=>{openAddRecord();document.getElementById('rec_date').value='03.10.2026';document.getElementById('rec_km').value='10';document.getElementById('rec_note').value='Original draft';__commandResponse={ok:false,unknown:true,queued:true,error:'Synthetic receipt missing'};await saveRecord();return {call:__commandCalls[0],rows:data.records.length,open:document.getElementById('recordModal').classList.contains('open'),unlocked:!document.getElementById('rec_note').disabled};});
 assert.equal(first.rows,2);assert.equal(first.open,true);assert.equal(first.unlocked,true);assert.match(first.call.command.input.record.id,/^r_/);
 const changed=await page.evaluate(async()=>{document.getElementById('rec_note').value='Edited while receipt unknown';await saveRecord();return {calls:__commandCalls.length,draft:document.getElementById('rec_note').value,rows:data.records.length};});assert.equal(changed.calls,1);assert.equal(changed.draft,'Edited while receipt unknown');assert.equal(changed.rows,2);
 const retried=await page.evaluate(async()=>{document.getElementById('rec_note').value='Original draft';__commandResponse={ok:true};await saveRecord();return {calls:__commandCalls,rows:data.records.length,open:document.getElementById('recordModal').classList.contains('open')};});assert.equal(retried.calls.length,2);assert.deepEqual(retried.calls[1].command,first.call.command);assert.equal(retried.calls[1].options.operationId,first.call.options.operationId);assert.equal(retried.rows,3);assert.equal(retried.open,false);assert.deepEqual(errors,[]);
});

test('a known server rejection stays on the command path and changed fields allocate a new operation without losing the form',async t=>{
 const {page,errors}=await fixture(t);const first=await page.evaluate(async()=>{openEditRecord(0);document.getElementById('rec_km').value='111';__commandResponse={ok:false,code:'PERIOD_CLOSED',error:'Synthetic closed period'};await saveRecord();return {operation:__commandCalls[0].options.operationId,rows:JSON.stringify(data.records),open:document.getElementById('recordModal').classList.contains('open'),message:document.querySelector('[data-record-save-status]').textContent};});assert.equal(first.open,true);assert.match(first.message,/Synthetic closed period/);
 const next=await page.evaluate(async()=>{document.getElementById('rec_km').value='222';await saveRecord();return {operation:__commandCalls[1].options.operationId,rows:JSON.stringify(data.records),generic:__genericCalls,draft:document.getElementById('rec_km').value};});assert.notEqual(next.operation,first.operation);assert.equal(next.rows,first.rows);assert.equal(next.generic,0);assert.equal(next.draft,'222');assert.deepEqual(errors,[]);
});

test('changed source fields still reject stale drafts before command dispatch',async t=>{
 const {page,errors}=await fixture(t);const result=await page.evaluate(async()=>{openEditRecord(0);document.getElementById('rec_km').value='111';data.records.find(row=>row.id===0).km=222;await saveRecord();return {calls:__commandCalls.length,generic:__genericCalls,km:data.records.find(row=>row.id===0).km,draft:document.getElementById('rec_km').value,open:document.getElementById('recordModal').classList.contains('open')};});assert.equal(result.calls,0);assert.equal(result.generic,0);assert.equal(result.km,222);assert.equal(result.draft,'111');assert.equal(result.open,true);assert.deepEqual(errors,[]);
});


test('an unexpected executor failure is treated as an unknown outcome and never falls back to a second write',async t=>{
 const {page,errors}=await fixture(t);const first=await page.evaluate(async()=>{openEditRecord(0);document.getElementById('rec_km').value='111';__commandResponse={throw:true,error:'Synthetic transport failure'};await saveRecord();return {calls:__commandCalls.length,generic:__genericCalls,message:document.querySelector('[data-record-save-status]').textContent};});assert.equal(first.calls,1);assert.equal(first.generic,0);assert.match(first.message,/той же|ту же операцию/);
 const changed=await page.evaluate(async()=>{document.getElementById('rec_km').value='222';await saveRecord();return {calls:__commandCalls.length,generic:__genericCalls,draft:document.getElementById('rec_km').value};});assert.equal(changed.calls,1);assert.equal(changed.generic,0);assert.equal(changed.draft,'222');assert.deepEqual(errors,[]);
});
