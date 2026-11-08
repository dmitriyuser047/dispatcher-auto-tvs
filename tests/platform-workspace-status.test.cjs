const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../assets/js/52-platform-workspace.js'),'utf8');

function render({connected=true,needsSchemaUpgrade=false,compatibility,writable,error=null,issues=[]}={}){
  const elements=new Map(),node=()=>({innerHTML:'',append(){},setAttribute(){}});
  const document={getElementById(id){if(!elements.has(id))elements.set(id,node());return elements.get(id);},querySelector(){return null;},querySelectorAll(){return[];},createElement:node};
  const report={integrity:{counts:{error:issues.length,warning:0},issues},runtime:{recent:[],lastError:error},storage:{connected,needsSchemaUpgrade,compatibility,writable,readable:['vehicles']}};
  const context={document,window:{},data:{vehicles:[]},_sync:{platform:{}},PlatformSchema:{modules:[{id:'vehicles',label:'Транспорт',sections:['vehicles']}],sections:['vehicles'],descriptors:{vehicles:{label:'Транспорт'}}},dispatcherBackgroundNeeded:()=>false,platformSessionContext:()=>({actor:{role:'viewer'},readable:['vehicles']}),htmlEsc:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')};
  vm.createContext(context);vm.runInContext(source,context);
  context.platformHealthSnapshot=()=>report;
  for(const name of ['platformRenderRecoveryPanel','platformRenderDataBrowser','platformRenderHistory','platformRenderOperationalDiagnostics'])context[name]=()=>{};
  context.renderPlatformSystem();
  return elements.get('mainContent').innerHTML;
}

test('normal status keeps diagnostic details collapsed and points to ordinary sections',()=>{
  const html=render();
  assert.match(html,/База открыта/);
  assert.match(html,/сохраняйте изменения в нужном разделе/);
  for(const id of ['platformAdditionalActions','platformModuleDetails','platformDataChecks','platformRecentOperations'])assert.match(html,new RegExp('<details[^>]+id="'+id+'">'));
  assert.doesNotMatch(html,/role="alert"/);
});

test('load blocks and save failures remain visible outside collapsed details',()=>{
  const html=render({connected:false,error:{message:'LEDGER_LIMIT: размер <операции>'}});
  assert.match(html,/Только просмотр/);
  assert.match(html,/Сохранение изменений недоступно/);
  assert.match(html,/role="alert"><strong>Последнее сохранение не подтверждено<\/strong><p>LEDGER_LIMIT: размер &lt;операции&gt;/);
  assert.ok(html.indexOf('role="alert"')<html.indexOf('<details'));
  assert.match(html,/<details[^>]+id="platformRecentOperations" open>/);
});

test('data problems open their inspection and schema upgrade never advertises writable state',()=>{
  const html=render({needsSchemaUpgrade:true,issues:[{severity:'error',section:'vehicles',message:'Нет обязательного значения'}]});
  assert.match(html,/Только просмотр/);
  assert.doesNotMatch(html,/База открыта/);
  assert.match(html,/<details[^>]+id="platformDataChecks" open>/);
  assert.match(html,/Нет обязательного значения/);
});


test('negotiated read-only connections and viewers do not advertise writable state',()=>{
  for(const access of [{compatibility:{writeCompatible:false},writable:['vehicles']},{compatibility:{writeCompatible:true},writable:[]}]){
    const html=render(access);
    assert.match(html,/Только просмотр/);
    assert.doesNotMatch(html,/База открыта|сохраняйте изменения в нужном разделе/);
  }
  assert.match(render({compatibility:{writeCompatible:true},writable:['vehicles']}),/База открыта/);
});
