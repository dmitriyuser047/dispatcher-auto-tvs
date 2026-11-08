'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),crypto=require('node:crypto');
const core=require('../assets/core/registry-import.js'),parties=require('../assets/core/registry-counterparties.js');
const clone=value=>JSON.parse(JSON.stringify(value));
const empty=()=>({savedReestrs:[],contragents:[],vehicles:[],generators:[],drivers:[],repairs:[],vehicleTo:[],auditLog:[]});
const originalBytes=Buffer.from('%PDF-SYNTHETIC-REGISTRY-SAVE-RETRY'),hash=crypto.createHash('sha256').update(originalBytes).digest('hex');
const original={id:hash+'.pdf',sha256:hash,size:originalBytes.length,name:'synthetic-registry.pdf'};

// Execute the real shared desktop/web controller. The DOM boundary is minimal;
// no test reimplements the import or save handler, registry rules, or storage.
function harness({database=empty(),showMain=false}={}){
  const fields={number:'SYNTHETIC-1',date:'2026-11-08',title:'Synthetic register',reason:'Synthetic checked import',duplicateReason:''};
  const form={elements:{...Object.fromEntries(Object.entries(fields).map(([name,value])=>[name,{name,value}])),confirmed:{name:'confirmed',checked:true}},querySelectorAll:()=>[]};
  let nodes={},markup='',failure=null,rebuilds=0;
  const main={querySelector:selector=>nodes[selector]||null,querySelectorAll:()=>[]};
  Object.defineProperty(main,'innerHTML',{get:()=>markup,set:value=>{markup=value;nodes={'[data-registry-pick]':{},'[data-registry-file]':{value:'',files:[],click(){}},'[data-registry-export]':{addEventListener(){}}};}});
  const context=vm.createContext({
    window:{tvsWeb:{},addEventListener(){},electronAPI:{}},
    document:{getElementById:id=>showMain&&id==='mainContent'?main:null,querySelector:selector=>selector==='[data-registry-editor]'?form:null,querySelectorAll:()=>[],addEventListener(){}},
    RegistryImport:core,RegistryCounterparties:parties,htmlEsc:String,data:clone(database),
    _sync:{access:{readable:['*'],writable:['savedReestrs','contragents']},platform:{negotiation:{writeCompatible:true}}},_loadWriteBlocked:false,
    syncSessionStamp:()=> 'synthetic-registry-session',platformRuntimeStatus:()=>({lastError:failure}),rebuildIndex:()=>{rebuilds++;},
    URLSearchParams,location:{search:''},crypto,Uint8Array,console
  });
  const source=fs.readFileSync(path.join(__dirname,'../web/public/registries.js'),'utf8');
  const exported='web.registries={render};';assert.ok(source.includes(exported));
  vm.runInContext(source.replace(exported,'web.registries={render,load,save,state,sourceStamp};'),context,{filename:'web/public/registries.js'});
  const api=context.window.tvsWeb.registries;api.render();
  function draft(extra={}){
    const result={id:'synthetic-registry',...fields,source:clone(original),invoices:[{supplier:'Synthetic supplier',description:'Synthetic invoice',invoiceNo:'SYNTHETIC-INVOICE-1',date:'2026-11-08',sum:100.1,allocations:[{kind:'other',sum:100.1,label:'Synthetic expense'}]}],database:context.data,stamp:context.syncSessionStamp(),sourceStamp:api.sourceStamp(),confirmed:true,dirty:true,...extra};
    api.state.draft=result;return result;
  }
  return {api,context,form,draft,main,get nodes(){return nodes;},get rebuilds(){return rebuilds;},setFailure:value=>{failure=value;}};
}

test('registry refusal keeps the original database, entered draft, exact error and source for retry',async()=>{
  const h=harness(),baseline=clone(h.context.data),live=h.context.data,draft=h.draft();let submitted,options;
  h.setFailure({code:'LEDGER_LIMIT',message:'LEDGER_LIMIT: synthetic operation ledger limit'});
  h.context.saveData=async(next,request)=>{submitted=next;options=request;if(next===h.context.data)h.context.data=clone(baseline);return false;};
  await h.api.save(draft);
  assert.notEqual(submitted,live);assert.equal(h.context.data,live);assert.deepEqual(clone(h.context.data),baseline);
  assert.equal(h.api.state.draft,draft);assert.equal(draft.source.id,original.id);assert.equal(draft.invoices[0].description,'Synthetic invoice');
  assert.match(h.api.state.error,/LEDGER_LIMIT/);assert.doesNotMatch(h.api.state.error,/Проверьте состояние операций/);assert.equal(h.api.state.pending,false);
  assert.deepEqual(clone(options.requiredCanonicalSections),['savedReestrs','contragents']);assert.ok(options.operation.id);assert.equal(h.rebuilds,0);
});

test('unchanged retry keeps operation and counterparty IDs, then installs only the confirmed canonical rows',async()=>{
  const h=harness(),live=h.context.data,draft=h.draft(),requests=[];
  h.setFailure({code:'SYNTHETIC_REFUSED',message:'Synthetic guaranteed refusal before commit'});
  h.context.saveData=async(next,options)=>{
    requests.push({next:clone(next),options:clone(options)});
    if(requests.length===1)return false;
    next.savedReestrs[0].title='Canonical title from storage';return true;
  };
  await h.api.save(draft);assert.equal(h.api.state.draft,draft);assert.equal(live.savedReestrs.length,0);assert.equal(live.contragents.length,0);
  await h.api.save(draft);
  assert.equal(requests.length,2);assert.deepEqual(requests[1],requests[0]);assert.equal(h.context.data,live);
  assert.equal(h.api.state.draft,null);assert.equal(h.api.state.error,'');assert.equal(live.savedReestrs.length,1);assert.equal(live.contragents.length,1);
  assert.equal(live.savedReestrs[0].title,'Canonical title from storage');assert.equal(live.savedReestrs[0].rows[0].contragentId,live.contragents[0].id);assert.equal(h.rebuilds,1);
});

test('changed reviewed contents allocate a fresh operation after a guaranteed refusal',async()=>{
  const h=harness(),draft=h.draft(),ids=[];
  h.context.saveData=async(_next,options)=>{ids.push(options.operation.id);return false;};
  await h.api.save(draft);h.form.elements.reason.value='Synthetic amended review reason';h.form.elements.confirmed.checked=true;await h.api.save(draft);
  assert.equal(ids.length,2);assert.notEqual(ids[0],ids[1]);assert.equal(h.api.state.draft,draft);assert.equal(h.context.data.savedReestrs.length,0);
});

test('retry of a newly uploaded original archives it once and waits for the same single save acknowledgement',async()=>{
  const h=harness(),draft=h.draft({source:undefined,hash,file:{name:original.name,size:original.size},bytes:new Uint8Array(originalBytes),tables:[{name:'Synthetic sheet'}],tableIndex:0}),requests=[];
  let archives=0,release;
  h.context.window.electronAPI.archiveImportSource=async()=>{archives++;return{ok:true,...original};};
  h.context.saveData=async(next,options)=>{requests.push({next:clone(next),options:clone(options)});return requests.length===1?false:new Promise(resolve=>{release=()=>resolve(true);});};
  await h.api.save(draft);assert.equal(archives,1);assert.equal(draft.source.id,original.id);assert.equal(draft.source.table,'Synthetic sheet');assert.equal(h.api.state.draft,draft);
  const retry=h.api.save(draft);await Promise.resolve();assert.equal(h.api.state.pending,true);assert.equal(h.context.data.savedReestrs.length,0);
  await h.api.save(draft);assert.equal(requests.length,2);assert.equal(archives,1);assert.deepEqual(requests[1],requests[0]);
  release();await retry;assert.equal(h.context.data.savedReestrs.length,1);assert.equal(h.api.state.draft,null);
});

test('a late confirmed write cannot install an old registry into a different live database',async()=>{
  const h=harness(),draft=h.draft(),other={...empty(),savedReestrs:[{id:'other-database-register',number:'KEEP'}]};
  h.context.saveData=async()=>{h.context.data=clone(other);return true;};
  await h.api.save(draft);
  assert.deepEqual(clone(h.context.data),other);assert.equal(h.rebuilds,0);assert.equal(h.api.state.draft,null);
});

test('cancelled selection does nothing and a rejected file can be selected again through the actual upload handler',async()=>{
  const h=harness({showMain:true});let decodes=0;
  h.context.window.electronAPI.decodeRegistry=async()=>{decodes++;return{ok:false,error:'Synthetic unreadable workbook'};};
  h.nodes['[data-registry-file]'].onchange({target:{files:[]}});await new Promise(resolve=>setImmediate(resolve));assert.equal(decodes,0);assert.equal(h.api.state.pending,false);
  const file={name:'same-source.xlsx',size:4,arrayBuffer:async()=>new Uint8Array([1,2,3,4]).buffer};
  for(let attempt=1;attempt<=2;attempt++){
    const input=h.nodes['[data-registry-file]'];input.value='synthetic-selected-file';input.files=[file];input.onchange({target:input});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(decodes,attempt);assert.equal(h.api.state.pending,false);assert.match(h.api.state.error,/Synthetic unreadable workbook/);
    assert.notEqual(h.nodes['[data-registry-file]'],input);assert.equal(h.nodes['[data-registry-file]'].value,'');assert.equal(h.context.data.savedReestrs.length,0);
  }
});

test('lost ACK retry replays one real SQLite commit without duplicate registers, counterparties or operations',async t=>{
  const storage=require('../electron/storage.js'),sqlite=require('../electron/sqlite-storage.cjs');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-registry-save-retry-')),owned=fs.lstatSync(root),dir=path.join(root,'db');
  t.after(()=>{const current=fs.lstatSync(root);assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.match(path.basename(root),/^tvs-registry-save-retry-/);assert.equal(current.isSymbolicLink(),false);assert.equal(current.dev,owned.dev);assert.equal(current.ino,owned.ino);fs.rmSync(root,{recursive:true,force:true});});
  sqlite.create(dir,{data:empty()});fs.mkdirSync(path.join(dir,'import-sources'),{recursive:true});fs.writeFileSync(path.join(dir,'import-sources',original.id),originalBytes);
  const snapshot=storage.readSnapshot(dir),h=harness({database:snapshot.data}),draft=h.draft(),requests=[],responses=[];
  h.setFailure({code:'SYNTHETIC_LOST_ACK',message:'Synthetic acknowledgement lost after commit'});
  h.context.saveData=async(next,options)=>{
    const names=Object.keys(next).filter(name=>JSON.stringify(next[name])!==JSON.stringify(snapshot.data[name]));
    const request={protocolVersion:1,databaseToken:snapshot.databaseToken,operation:clone(options.operation),base:Object.fromEntries(names.map(name=>[name,snapshot.revisions[name]])),sections:Object.fromEntries(names.map(name=>[name,clone(next[name])]))};requests.push(request);
    const result=storage.writeSections(dir,request);assert.equal(result.ok,true,JSON.stringify(result));responses.push(result);
    if(responses.length===1)return false;
    Object.assign(next,clone(result.canonicalSections));return true;
  };
  await h.api.save(draft);
  assert.equal(responses.length,1,h.api.state.error);assert.equal(h.api.state.draft,draft);assert.equal(h.context.data.savedReestrs.length,0);assert.match(h.api.state.error,/lost after commit/);
  const committed=storage.readSnapshot(dir);assert.equal(committed.data.savedReestrs.length,1);assert.equal(committed.data.contragents.length,1);
  await h.api.save(draft);
  assert.equal(responses.length,2,h.api.state.error);assert.deepEqual(requests[1],requests[0]);assert.equal(responses[0].operationReceipt.status,'committed');assert.equal(responses[1].operationReceipt.status,'replayed');
  const replayed=storage.readSnapshot(dir);assert.deepEqual(replayed.data,committed.data);assert.deepEqual(replayed.revisions,committed.revisions);
  assert.equal(h.context.data.savedReestrs.length,1);assert.equal(h.context.data.contragents.length,1);assert.equal(h.api.state.draft,null);assert.equal(h.api.state.error,'');
});
