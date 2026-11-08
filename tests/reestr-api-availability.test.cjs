'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {functionDeclarations}=require('./helpers/source-harness.cjs');
const source=functionDeclarations('assets/js/20-to-schedule.js',['reestrParse']);

function harness({missing=false,incomplete=false,subscriptionError=false,cleanupError=false,cancel=false,empty=false}={}){
  const elements=new Map(),listeners=new Map(),calls=[];
  function element(){return {style:{display:'none'},disabled:false,textContent:'',innerHTML:'',querySelector(selector){assert.equal(selector,'.reestr-spinner');return this.spinner??=element();}};}
  const get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
  get('reestrParseBtnLabel').textContent='Распознать счета';
  const api={
    onProgress(callback){calls.push('onProgress');listeners.set('progress',callback);if(subscriptionError)throw Error('Synthetic progress subscription failure');},
    onOcrPage(callback){calls.push('onOcrPage');listeners.set('ocr',callback);},
    offProgress(){calls.push('offProgress');listeners.clear();if(cleanupError)throw Error('Synthetic progress cleanup failure');},
    async parseInvoices(){assert.fail('Unexpected archive decoder');},
    async parsePdfs(){calls.push('parsePdfs');throw Object.assign(Error(cancel?'Synthetic native operation cancelled':'Synthetic native decode failure'),cancel?{name:'AbortError'}:{});}
  };
  if(incomplete)delete api.parsePdfs;
  const database={reestrRows:[{id:'synthetic-existing',sum:17}]},files=empty?[]:[{type:'pdf',file:{name:'synthetic.pdf',arrayBuffer:async()=>new Uint8Array([37,80,68,70]).buffer}}];
  const context=vm.createContext({window:missing?{}:{reestrAPI:api},document:{getElementById:get},reestrFiles:files,reestrImportDraft:null,data:database,reestrRows:database.reestrRows,syncSessionStamp:()=> 'synthetic-session',showToast:()=>assert.fail('Unexpected toast'),structuredClone,Uint8Array});
  vm.runInContext(source,context,{filename:'assets/js/20-to-schedule.js'});
  return {context,get,calls,listeners,database,baseline:JSON.stringify(database)};
}
function idle(h){
  assert.equal(h.get('reestrParseBtn').disabled,false);assert.equal(h.get('reestrParseBtn').querySelector('.reestr-spinner').style.display,'none');
  assert.equal(h.get('reestrParseBtnLabel').textContent,'Распознать счета');assert.equal(h.get('reestrProgressWrap').style.display,'none');
  assert.equal(h.listeners.size,0);assert.equal(JSON.stringify(h.database),h.baseline);assert.equal(h.context.reestrImportDraft,null);
}

for(const mode of ['missing','incomplete'])test(mode+' recognition bridge displays an actionable message before disabling controls',async()=>{
  const h=harness({[mode]:true});
  for(let attempt=0;attempt<2;attempt++){await h.context.reestrParse();idle(h);assert.match(h.get('reestrError').textContent,/установленной программе/);assert.match(h.get('reestrError').textContent,/«Реестры»/);assert.equal(h.get('reestrError').style.display,'');}
  assert.deepEqual(h.calls,[]);
});
test('failed progress subscription releases partial listeners and restores the native upload controls',async()=>{
  const h=harness({subscriptionError:true});await h.context.reestrParse();idle(h);assert.deepEqual(h.calls,['onProgress','offProgress']);assert.match(h.get('reestrError').textContent,/Synthetic progress subscription failure/);
});
for(const cancel of [false,true])test('native '+(cancel?'cancellation':'decoder error')+' retains existing rows and permits another attempt',async()=>{
  const h=harness({cancel});
  for(let attempt=1;attempt<=2;attempt++){await h.context.reestrParse();idle(h);assert.equal(h.calls.filter(name=>name==='parsePdfs').length,attempt);assert.equal(h.calls.filter(name=>name==='offProgress').length,attempt);assert.match(h.get('reestrError').textContent,cancel?/operation cancelled/:/decode failure/);}
});
test('cleanup error cannot hide the original decode failure or strand the button',async()=>{
  const h=harness({cleanupError:true});await h.context.reestrParse();idle(h);assert.match(h.get('reestrError').textContent,/decode failure/);assert.doesNotMatch(h.get('reestrError').textContent,/cleanup failure/);
});
test('cancelled empty file selection does not require or call the native bridge',async()=>{
  const h=harness({empty:true,missing:true});await h.context.reestrParse();idle(h);assert.deepEqual(h.calls,[]);assert.equal(h.get('reestrError').textContent,'');
});
