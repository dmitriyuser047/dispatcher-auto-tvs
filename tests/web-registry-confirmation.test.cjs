'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
for(const [file,workspace,exposed]of [['registry.js','registry','web.registry={render,addLink};'],['registries.js','registries','web.registries={render};']]){
  test(file+': confirmation survives its own input/change events and resets after an actual edit',()=>{
    const listeners={},elements=Object.fromEntries(['number','date','title','workspace','reason','duplicateReason','confirmed'].map(name=>[name,{name,value:'',checked:false}]));
    const close={},exportButton={},form={elements,querySelector:selector=>selector==='[data-registry-close]'?close:selector==='[data-registry-export-draft]'?exportButton:null,querySelectorAll:()=>[],addEventListener:(name,fn)=>listeners[name]=fn};
    const context=vm.createContext({window:{tvsWeb:{},addEventListener(){}},document:{querySelector:selector=>selector==='[data-registry-editor]'?form:null,querySelectorAll:()=>[],addEventListener(){}},RegistryImport:require('../assets/core/registry-import.js'),RegistryAccounting:require('../assets/core/registry-accounting.js'),htmlEsc:String,data:{savedReestrs:[]},URLSearchParams,location:{search:''}});
    const source=fs.readFileSync(path.join(__dirname,'../web/public',file),'utf8');assert.ok(source.includes(exposed));
    vm.runInContext(source.replace(exposed,`web.${workspace}={render,bindDraft};`),context,{filename:file});
    const draft={invoices:[],confirmed:false,dirty:false};context.window.tvsWeb[workspace].bindDraft(draft);
    elements.confirmed.checked=true;listeners.input({target:elements.confirmed});elements.confirmed.onchange();listeners.change({target:elements.confirmed});
    assert.equal(elements.confirmed.checked,true);assert.equal(draft.confirmed,true);assert.equal(draft.dirty,false);
    listeners.input({target:elements.reason});assert.equal(elements.confirmed.checked,false);assert.equal(draft.confirmed,false);assert.equal(draft.dirty,true);
  });
}
