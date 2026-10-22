'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),path=require('node:path'),crypto=require('node:crypto');
const {ROOT,functionDeclarations,ipcHandler}=require('./helpers/source-harness.cjs');
const main=process.env.TVS_SECURITY_MAIN_SOURCE||'electron/main.js';
const helperNames=['captureFileContext','assertFileContextSync','assertFileContext','sendFileProgress','capturedOperationContext','assertOperationContext','verifiedOperationContext','selectedFileName'];
const helpers=functionDeclarations(main,helperNames);
function fixture({client=true,registry=false}={}){
 const state={identity:'synthetic-db-A',token:'synthetic-token-A',url:registry?'file:///synthetic/reestr-window.html':'http://127.0.0.1:8123/index.html',destroyed:false,sent:[],pings:0,pingHook:null,dialogHook:null,writes:[],opened:[],rendered:[],renderHook:null,printRequests:[],sourceRequests:[]};
 const access={user:{id:'synthetic-user',name:'Synthetic',role:'admin'},readable:['vehicles'],writable:['vehicles'],policyStamp:'sha256:'+'a'.repeat(64)};
 const settings={networkMode:client?'client':'local',activeUser:0,remoteHost:'synthetic.invalid',remotePort:8123};
 const binding={identity:state.identity,databaseToken:state.token,notificationAccess:access,platform:{apiVersion:1,operations:1,outbox:1,commands:1,documentPrint:1,controlledImports:1}};
 const printBytes=Buffer.from('%PDF-synthetic-sealed-evidence'),archiveId='a'.repeat(64);
 state.printResult={ok:true,archiveId,format:'pdf',size:printBytes.length,sha256:crypto.createHash('sha256').update(printBytes).digest('hex'),base64:printBytes.toString('base64'),archiveHeadChanged:true,canonicalSections:{appMeta:[{privateArchiveMarker:'SYNTHETIC-PRIVATE-ACK'}]},revisions:{appMeta:9},databaseToken:binding.databaseToken};
 state.sourceResult={ok:true,source:{sourceArchive:{name:'SYNTHETIC-PRIVATE-ORIGINAL.txt',base64:Buffer.from('PRIVATE ORIGINAL BYTES').toString('base64')}},databaseToken:binding.databaseToken};
 const print=async input=>{state.printRequests.push(input);await state.printHook?.();return state.printResult;},source=async input=>{state.sourceRequests.push(input);await state.sourceHook?.();return state.sourceResult;};
 const dataBindings=new Map([[1,binding]]),reestrWindowData=new Map();
 if(registry)reestrWindowData.set(2,{ownerId:1,identity:state.identity,databaseToken:state.token});
 const sender={id:registry?2:1,mainFrame:{synthetic:true},isDestroyed:()=>state.destroyed,getURL:()=>state.url,send:(channel,payload)=>state.sent.push({channel,payload})},event={sender};
 const context={Buffer,path,structuredClone,ArrayBuffer,console:{log(){}},settings,dataBindings,reestrWindowData,networkConfigError:'',renderArchivedDocumentPdf:async()=>printBytes,require:name=>{
  if(name==='node:crypto')return require(name);
  if(name==='./safe-html-pdf.cjs')return {createSafeHtmlPdfRenderer:()=>async(html,options,guard)=>{guard();state.rendered.push({html,options});await state.renderHook?.();guard();return Buffer.from('%PDF-synthetic');}};
  if(name==='./safe-file.cjs')return {async writeRegularFileAtomic(filename,bytes,options){options.assertCurrent();if(state.writeError)throw state.writeError;state.writes.push({filename,bytes});await state.writeHook?.();options.assertCurrent();}};
  if(name==='./document-print-export.cjs')return require(path.join(ROOT,'electron/document-print-export.cjs'));
  if(name==='./document-archive.cjs')return {handle:(_directory,input)=>print(input)};
  if(name==='./import-source.cjs')return {handle:(_directory,input)=>source(input)};
  throw Error('Unexpected file helper dependency '+name);
 },settingsIdentity:()=>state.identity,getDataDir:()=>path.join(ROOT,'tests','synthetic-no-io'),getActiveUser:()=>({name:'Synthetic'}),assertDataBinding:entry=>{const value=dataBindings.get(entry.sender.id);if(!value)throw Error('No synthetic binding');return value;},storage:{databaseToken:()=>state.token},server:{async getJson(){state.pings++;await state.pingHook?.(state.pings);return {ok:true,databaseToken:state.token,access:state.serverAccess||access};},postDocumentPrint:(_host,_port,input)=>print(JSON.parse(input)),postImportSource:(_host,_port,input)=>source(JSON.parse(input))},BrowserWindow:{fromWebContents:()=>({synthetic:true})},session:{},app:{getPath:()=>path.join(ROOT,'tests','synthetic-no-io')},dialog:{async showSaveDialog(){await state.dialogHook?.();return {canceled:state.dialogCanceled===true,filePath:path.join(ROOT,'tests','synthetic-no-io','Synthetic.pdf')};}},shell:{async openPath(filename){state.opened.push(filename);}}};
 vm.createContext(context);vm.runInContext(helpers,context,{filename:path.join(ROOT,main)});
 return {state,context,event,binding,dataBindings,reestrWindowData,access,handler(channel){return vm.runInContext('('+ipcHandler(channel,main)+')',context,{filename:path.join(ROOT,main)});}};
}
const changed=error=>error?.code==='SESSION_CHANGED';
test('file context rejects sender navigation or same-URL frame replacement during initial remote verification',async()=>{
 for(const navigate of [f=>{f.state.url='data:text/html,<script>attack()</script>';},f=>{f.event.sender.mainFrame={synthetic:true,replaced:true};}]){const f=fixture();f.state.pingHook=()=>navigate(f);await assert.rejects(f.context.captureFileContext(f.event),changed);assert.deepEqual(f.state.sent,[]);}
});
test('file context binds sender, DB/account/ACL and registry owner across asynchronous work',async()=>{
 for(const mutate of [f=>{f.state.destroyed=true;},f=>{f.state.url='https://attacker.invalid';},f=>{f.event.sender.mainFrame={replaced:true};},f=>{f.state.identity='synthetic-db-B';},f=>{f.dataBindings.delete(1);},f=>{f.binding.notificationAccess={...f.access,policyStamp:'sha256:'+'b'.repeat(64)};},f=>{f.state.token='synthetic-token-B';},f=>{f.state.serverAccess={...f.access,writable:[]};}]){
  const f=fixture(),captured=await f.context.captureFileContext(f.event);mutate(f);await assert.rejects(f.context.assertFileContext(captured),changed);
 }
 for(const mutate of [f=>f.reestrWindowData.delete(2),f=>f.reestrWindowData.set(2,{...f.reestrWindowData.get(2)}),f=>{f.reestrWindowData.get(2).identity='synthetic-db-B';}]){const f=fixture({registry:true}),captured=await f.context.captureFileContext(f.event);assert.equal(captured.operation.senderId,1);mutate(f);await assert.rejects(f.context.assertFileContext(captured),changed);}
});
test('file context rechecks bindings after a ping awaited during output authorization',async()=>{
 const f=fixture(),captured=await f.context.captureFileContext(f.event);f.state.pingHook=()=>{f.state.url='file:///synthetic/replaced.html';};await assert.rejects(f.context.assertFileContext(captured),changed);
 const local=fixture({client:false}),localContext=await local.context.captureFileContext(local.event);local.state.token='synthetic-token-B';await assert.rejects(local.context.assertFileContext(localContext),changed);assert.equal(local.state.pings,0);
});
test('queued OCR progress is ordered, freshly authorized and stops permanently after rights change',async()=>{
 const f=fixture({registry:true}),captured=await f.context.captureFileContext(f.event);
 f.context.sendFileProgress(captured,'reestr-progress',{page:1});await captured.progress;
 assert.deepEqual(f.state.sent,[{channel:'reestr-progress',payload:{page:1}}]);
 f.state.serverAccess={...f.access,policyStamp:'sha256:'+'b'.repeat(64)};
 f.context.sendFileProgress(captured,'reestr-ocr-page',{text:'private next page'});f.context.sendFileProgress(captured,'reestr-progress',{page:2});await captured.progress;
 assert.equal(f.state.sent.length,1);assert.equal(captured.failure?.code,'SESSION_CHANGED');
 f.state.serverAccess=f.access;f.context.sendFileProgress(captured,'reestr-progress',{page:3});await captured.progress;assert.equal(f.state.sent.length,1);await assert.rejects(f.context.assertFileContext(captured),changed);
});
test('actual PDF IPC handler refuses dialog/render revocation before writing, opening or returning success',async()=>{
 const html='<img src="https://attacker.invalid"><script>require("electron")</script>';
 for(const phase of ['dialog','render']){
  const f=fixture();const revoke=()=>{f.state.serverAccess={...f.access,writable:[]};};f.state[phase==='dialog'?'dialogHook':'renderHook']=revoke;
  let result;try{result=await f.handler('export-pdf')(f.event,{html,defaultFileName:'Synthetic.pdf'});}catch(error){assert.equal(error.code,'SESSION_CHANGED');}
  assert.notEqual(result?.ok,true);assert.equal(f.state.rendered.length,phase==='dialog'?0:1);assert.deepEqual(f.state.writes,[]);assert.deepEqual(f.state.opened,[]);
 }
 const f=fixture(),result=await f.handler('export-pdf')(f.event,{html,defaultFileName:'Synthetic.pdf'});assert.equal(result.ok,true);assert.equal(f.state.writes.length,1);assert.equal(f.state.opened.length,1);assert.equal(f.state.rendered[0].html,html);assert.ok(f.state.pings>=5);
});
test('saved-print IPC never discloses an archive ACK or output after session revocation, including a committed server reply',async()=>{
 for(const client of [true,false])for(const phase of ['reply','dialog','write']){
  const f=fixture({client}),revoke=()=>{f.state.token='synthetic-token-B';};f.state[phase==='reply'?'printHook':phase==='dialog'?'dialogHook':'writeHook']=revoke;
  const result=await f.handler('document-print')(f.event,{action:'export',archiveId:f.state.printResult.archiveId,format:'pdf'});
  assert.equal(result.ok,false);assert.equal(result.code,'SESSION_CHANGED');for(const field of ['archiveHeadChanged','canonicalSections','revisions','databaseToken','base64','path','size','sha256'])assert.equal(Object.hasOwn(result,field),false,phase+':'+field);
  assert.equal(JSON.stringify(result).includes('SYNTHETIC-PRIVATE-ACK'),false);assert.equal(f.state.writes.length,phase==='write'?1:0);assert.deepEqual(f.state.opened,[]);
 }
 const f=fixture();f.state.writeError=Object.assign(Error('Synthetic disk denied'),{code:'EACCES'});const result=await f.handler('document-print')(f.event,{action:'export',archiveId:f.state.printResult.archiveId,format:'pdf'});assert.equal(result.ok,false);assert.equal(result.code,'EACCES');assert.equal(result.archiveHeadChanged,true);assert.deepEqual(result.canonicalSections,f.state.printResult.canonicalSections);assert.equal(result.databaseToken,f.binding.databaseToken);
});
test('saved-print read/list/preview replies are freshly authorized before their contents reach a changed window',async()=>{
 for(const action of ['read','list','preview']){
  const f=fixture();f.state.printResult={ok:true,snapshot:{privateText:'SYNTHETIC-PRIVATE-SNAPSHOT'},databaseToken:f.binding.databaseToken};f.state.printHook=()=>{f.event.sender.mainFrame={replaced:true};};const result=await f.handler('document-print')(f.event,{action,archiveId:'a'.repeat(64)});assert.equal(result.ok,false);assert.equal(result.code,'SESSION_CHANGED');assert.equal(JSON.stringify(result).includes('SYNTHETIC-PRIVATE-SNAPSHOT'),false);assert.equal(f.state.writes.length,0);
 }
});
test('source IPC does not return stale original bytes after stage/read/preview or fresh authorization failure',async()=>{
 for(const client of [true,false])for(const action of ['stage','read','preview']){
  const f=fixture({client});f.state.sourceHook=()=>{if(client)f.state.serverAccess={...f.access,writable:[]};else f.state.token='synthetic-token-B';};const result=await f.handler('import-source')(f.event,{action,profile:'json',sourceId:'a'.repeat(64),source:{name:'synthetic.txt',bytes:[1,2,3]}});assert.equal(result.ok,false);assert.equal(result.code,'SESSION_CHANGED');assert.equal(Object.hasOwn(result,'source'),false);assert.equal(Object.hasOwn(result,'databaseToken'),false);assert.equal(JSON.stringify(result).includes('SYNTHETIC-PRIVATE-ORIGINAL'),false);assert.equal(f.state.sourceRequests.length,1);
 }
 const f=fixture();f.state.sourceHook=()=>{f.state.pingHook=()=>{throw Object.assign(Error('Synthetic revoked HTTP authorization'),{status:401});};};const denied=await f.handler('import-source')(f.event,{action:'read',sourceId:'a'.repeat(64)});assert.equal(denied.code,'SESSION_CHANGED');assert.equal(Object.hasOwn(denied,'source'),false);
 const allowed=fixture(),result=await allowed.handler('import-source')(allowed.event,{action:'stage',profile:'json',source:{name:'synthetic.txt',bytes:[1,2,3]}});assert.equal(result.ok,true);assert.equal(result.source.sourceArchive.name,'SYNTHETIC-PRIVATE-ORIGINAL.txt');assert.equal(allowed.state.sourceRequests[0].source.base64,'AQID');assert.equal(allowed.state.sourceRequests[0].source.bytes,undefined);assert.equal(allowed.state.sourceRequests[0].databaseToken,allowed.binding.databaseToken);
});
