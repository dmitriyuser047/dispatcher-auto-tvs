const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{createRequire}=require('node:module');
const commands=require('../assets/core/platform-commands.js'),schema=require('../assets/core/platform-schema.js');
let pw;try{pw=require('playwright');}catch{pw=createRequire(path.join(process.env.TVS_PLAYWRIGHT_MODULES||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),'package.json'))('playwright');}
let browser,page,errors;
function fixture(){
 const db=Object.fromEntries(schema.sections.map(name=>[name,[]]));
 db.vehicles=[{id:712,plate:'SYNTHETIC-712',make:'Synthetic car',fuel:'diesel',fuelGrade:'ДТ',fuelBalance:20,norm:10}];
 db.generators=[{id:913,name:'SYNTHETIC-DES',fuel:'diesel',fuelBalance:0,norm:2}];
 db.tanks=[{id:22,name:'SYNTHETIC-TANK',fuel:'diesel',balanceInit:500}];
 db.drivers=[{id:41,name:'Synthetic driver',personnelRoles:['driver']},{id:42,name:'Synthetic operator',personnelRoles:['operator']},{id:'dual',name:'Synthetic substitute',personnelRoles:['driver','operator']}];
 db.assetAssignments=[{id:81,driverId:41,assetRef:'v:712',from:'2026-09-01',to:'',site:'Synthetic site',org:'Original organization',status:'Working',reason:'Original order'}];
 db.shiftReports=[{id:91,title:'Synthetic shift',date:'2026-10-01',assetRef:'v:712',driverId:41,status:'sent',odoStart:100,odoEnd:110,result:'Original result'}];
 db.fuelCards=[{id:'fc_cash',number:'НАЛИЧКА',provider:'Наличка',assignments:[]}];db.appMeta=[{id:'meta',toPlanInit:'synthetic'}];return db;
}
before(async()=>{const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';browser=await pw.chromium.launch({headless:true,executablePath:process.env.TVS_TEST_BROWSER||(!process.env.CI&&fs.existsSync(edge)?edge:undefined)});});
after(async()=>{await browser?.close();});
beforeEach(async()=>{
 page=await browser.newPage({viewport:{width:1280,height:900}});errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await page.exposeFunction('__planSemantic',request=>{
  try{return {ok:true,...commands.plan(request.database,request.command,{id:request.operationId,now:'2026-10-22T12:00:00.000Z',today:'2026-10-22',actor:{id:'confirmed-server-user',name:'Confirmed server user',role:'admin'}})};}
  catch(error){return {ok:false,code:error.code,message:error.message,issues:error.issues};}
 });
 await page.addInitScript(({database,sections})=>{
  window.__disk=JSON.stringify(database);window.__rawWrites=0;window.__token='synthetic-semantic-ui-A';window.__revisions=Object.fromEntries(sections.map(name=>[name,1]));
  window.electronAPI={readSnapshot:async()=>JSON.stringify({data:JSON.parse(window.__disk),databaseToken:window.__token,revisions:window.__revisions,platform:{apiVersion:1,operations:1,commands:1,outbox:1,schemaVersion:2,documentDrafts:1,personnelPlanning:1,calendar:1}}),writeSections:async()=>{window.__rawWrites++;return{ok:false,error:'Unexpected raw save in a semantic UI test'};}};
 },{database:fixture(),sections:schema.sections});
 await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);await page.waitForFunction(()=>typeof wfExecuteSemanticCommand==='function'&&typeof data!=='undefined'&&data.vehicles[0]?.id===712);
 await page.evaluate(()=>{
  window.__semanticCalls=[];window.__semanticMode='ok';window.__semanticHold=false;window.__semanticReleases=[];
  // This is the helper contract, not a persistence fallback: prepare with the
  // actual pure command planner and apply canonical sections only after ACK.
  // Backend/IPC/outbox tests exercise the real helper separately.
  platformExecuteCommand=async(command,options)=>{
   const context=wfCommandContextStamp(),call={command:structuredClone(command),operationId:options.operationId};window.__semanticCalls.push(call);
   if(window.__semanticHold)await new Promise(resolve=>window.__semanticReleases.push(resolve));
   if(context!==wfCommandContextStamp())return{ok:false,code:'STALE_IDENTITY',message:'Synthetic stale context'};
   if(window.__semanticMode==='conflict')return{ok:false,code:'COMMAND_CONFLICT',message:'Источники изменились. Проверьте данные.',conflicts:['assetAssignments']};
   if(window.__semanticMode==='unknown')return{ok:false,code:'UNKNOWN_ACK',message:'Нет подтверждения сервера.',unknown:true};
   if(window.__semanticMode==='unsupported')return{ok:false,code:'COMMANDS_UNSUPPORTED',message:'Основная программа не поддерживает команды. Обновите её.'};
   const planned=await window.__planSemantic({database:JSON.parse(window.__disk),command:call.command,operationId:call.operationId});if(!planned.ok)return planned;
   if(context!==wfCommandContextStamp())return{ok:false,code:'STALE_IDENTITY',message:'Synthetic stale context'};
   const canonical=structuredClone(planned.sections);for(const[name,rows]of Object.entries(canonical)){data[name]=rows;window.__revisions[name]++;_sync.revs[name]=window.__revisions[name];_sync.synced[name]=JSON.stringify(rows);}
   window.__disk=JSON.stringify(data);_lastPersisted=window.__disk;rebuildIndex();return{ok:true,canonicalSections:canonical,entityIds:planned.entityIds,operationReceipt:{id:options.operationId,status:'committed'}};
  };
 });
});
afterEach(async()=>{await page?.close();assert.deepEqual(errors,[]);});
async function holdSubmit(form){if(await form.locator('[data-personnel-shift-preview]').count()){await form.locator('[data-personnel-shift-preview]').click();await form.locator('[data-personnel-confirm]').check();}await page.evaluate(()=>{window.__semanticHold=true;});await form.locator('[type="submit"]').click();await page.waitForFunction(()=>window.__semanticReleases.length===1);}
async function release(){await page.evaluate(()=>{window.__semanticHold=false;window.__semanticReleases.splice(0).forEach(resolve=>resolve());});}
async function waitClosed(){await page.waitForFunction(()=>!document.querySelector('#wfModal')?.classList.contains('open'));}
async function waitError(selector='#wfError'){await page.waitForFunction(selector=>!!document.querySelector(selector)?.textContent.trim(),selector);}
async function reviewDocument(form){await form.locator('[data-lc-preview]').click();await page.waitForFunction(()=>!!lifecycleSession.preview);assert.equal(await page.evaluate(()=>lifecycleSession.preview.preview.canPost),true);await form.locator('[name="confirm"]').check();}
for(const [assetRef,section,id]of [['v:712','records',712],['g:913','genRecords',913]])test('fuel draft '+assetRef+' posts both accounting sides atomically after explicit review and ACK',async()=>{
 await page.evaluate(()=>wfEdit('fuelMovements'));let form=page.locator('#lifecycleForm');await form.locator('[name="date"]').fill('2026-10-01');await form.locator('[name="kind"]').selectOption('issue');await form.locator('[name="fromTankId"]').selectOption('r0');await form.locator('[name="qty"]').fill('10');await form.locator('[name="assetRef"]').selectOption(assetRef);await form.locator('[name="documentReason"]').fill('Synthetic issue order');await reviewDocument(form);await form.locator('[type="submit"]').click();await page.waitForFunction(()=>!!lifecycleSession?.draft);assert.equal(await page.evaluate(()=>data.fuelMovements.length+data.records.length+data.genRecords.length),0);
 form=page.locator('#lifecycleForm');await reviewDocument(form);await page.evaluate(()=>window.__semanticCalls=[]);const before=await page.evaluate(()=>JSON.stringify(data));await holdSubmit(form);await form.evaluate(node=>node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));assert.deepEqual(await page.evaluate(()=>({calls:window.__semanticCalls.length,data:JSON.stringify(data),raw:window.__rawWrites})),{calls:1,data:before,raw:0});const command=await page.evaluate(()=>window.__semanticCalls[0].command);assert.equal(command.type,'DocumentAction');assert.equal(command.input.action,'postDraft');assert.equal(command.input.section,'fuelMovements');assert.match(command.input.reviewFingerprint,/^sha256:/);await release();await waitClosed();const after=await page.evaluate(section=>({movements:data.fuelMovements,rows:data[section],raw:window.__rawWrites}),section);assert.equal(after.movements.length,1);assert.equal(after.rows.length,1);assert.equal(after.rows[0].fuelMovementId,after.movements[0].id);assert.equal(after.rows[0].fuelIssued,10);assert.equal(after.rows[0][section==='records'?'vehicleId':'generatorId'],id);assert.equal(after.raw,0);if(section==='genRecords')assert.equal(after.rows[0].tankId,null);
});
test('AcceptShift submits unsaved form edits and manual receiver in one command, preserving separate trusted actor metadata',async()=>{
 await page.evaluate(()=>wfEdit('shiftReports',91));const form=page.locator('#wfForm');await form.locator('[name="status"]').selectOption('accepted');await form.locator('[name="acceptedBy"]').fill('Actual master at the site');await form.locator('[name="odoEnd"]').fill('125');await form.locator('[name="result"]').fill('Corrected actual shift result');await holdSubmit(form);
 assert.deepEqual(await page.evaluate(()=>({status:data.shiftReports[0].status,end:data.shiftReports[0].odoEnd,result:data.shiftReports[0].result,records:data.records.length,raw:window.__rawWrites})),{status:'sent',end:110,result:'Original result',records:0,raw:0});
 const command=await page.evaluate(()=>window.__semanticCalls[0].command);assert.equal(command.type,'AcceptShift');assert.equal(command.input.shiftId,91);assert.equal(command.input.changes.acceptedBy,'Actual master at the site');assert.equal(command.input.changes.odoEnd,125);assert.deepEqual(command.input.changes.target,{section:'vehicles',id:712});for(const field of ['status','acceptedActor','acceptedAt','rejectionReason'])assert.equal(field in command.input.changes,false);
 await release();await waitClosed();const after=await page.evaluate(()=>({shift:data.shiftReports[0],records:data.records.length,genRecords:data.genRecords.length,raw:window.__rawWrites}));assert.equal(after.shift.status,'accepted');assert.equal(after.shift.result,'Corrected actual shift result');assert.equal(after.shift.acceptedBy,'Actual master at the site');assert.equal(after.shift.acceptedActor.id,'confirmed-server-user');assert.equal(after.shift.acceptedAt,'2026-10-22T12:00:00.000Z');assert.equal(after.records,0);assert.equal(after.genRecords,0);assert.equal(after.raw,0);
});


test('AssignPerson replaces an explicit previous assignment atomically without closing it before ACK',async()=>{
 await page.evaluate(()=>{switchSection('drivers');personnelEditAssignment('dual');});const form=page.locator('#personnelAssignmentForm');await form.locator('[name="assetRef"]').selectOption('v:712');await form.locator('[name="from"]').fill('2026-10-01');await form.locator('[name="site"]').fill('New synthetic site');await form.locator('[name="reason"]').fill('Replacement order');await form.locator('[name="replacesAssignmentId"]').selectOption('81');await holdSubmit(form);
 assert.deepEqual(await page.evaluate(()=>({count:data.assetAssignments.length,to:data.assetAssignments[0].to,raw:window.__rawWrites})),{count:1,to:'',raw:0});const request=await page.evaluate(()=>window.__semanticCalls[0]);assert.equal(request.command.type,'AssignPerson');assert.equal(request.command.input.replacesAssignmentId,81);assert.equal(request.command.input.driverId,'dual');assert.equal('assignmentId'in request.command.input,false);
 await release();await waitClosed();const after=await page.evaluate(()=>data.assetAssignments);assert.equal(after.length,2);assert.equal(after.find(row=>row.id===81).to,'2026-09-30');assert.equal(after.find(row=>row.id===request.operationId)?.from,'2026-10-01');assert.equal(after.find(row=>row.id===request.operationId)?.driverId,'dual');
});

test('editing an assignment keeps its numeric identity and explicitly clears optional text fields',async()=>{
 await page.evaluate(()=>wfEdit('assetAssignments',81));const form=page.locator('#wfForm');await form.locator('[name="org"]').fill('');await form.locator('[name="status"]').fill('');await form.locator('[type="submit"]').click();await waitClosed();const result=await page.evaluate(()=>({assignment:data.assetAssignments[0],command:window.__semanticCalls[0].command,raw:window.__rawWrites}));assert.equal(result.command.type,'AssignPerson');assert.equal(result.command.input.assignmentId,81);assert.equal(result.command.input.org,'');assert.equal(result.command.input.status,'');assert.equal(result.assignment.id,81);assert.equal(result.assignment.org,'');assert.equal(result.assignment.status,'');assert.equal(result.raw,0);
});


test('a changed source shift is rejected before sending and its entered correction remains visible',async()=>{
 await page.evaluate(()=>wfEdit('shiftReports',91));const form=page.locator('#wfForm');await form.locator('[name="status"]').selectOption('accepted');await form.locator('[name="acceptedBy"]').fill('Actual master');await form.locator('[name="result"]').fill('My retained correction');await page.evaluate(()=>{data.shiftReports[0].result='Concurrent source update';});await form.locator('[type="submit"]').click();await waitError();assert.equal(await form.locator('[name="result"]').inputValue(),'My retained correction');assert.match(await page.locator('#wfError').innerText(),/Исходная запись/);assert.deepEqual(await page.evaluate(()=>({calls:window.__semanticCalls.length,status:data.shiftReports[0].status,raw:window.__rawWrites})),{calls:0,status:'sent',raw:0});
});
