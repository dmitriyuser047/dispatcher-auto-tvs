'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Timesheet=require('../assets/core/personnel-timesheet.js'),Document=require('../assets/core/personnel-timesheet-document.js');
const vendor=vm.createContext({Buffer,Date,Uint8Array,ArrayBuffer,console});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../vendor/xlsx.bundle.js'),'utf8'),vendor,{filename:'xlsx-vendor'});
const XLSX=vendor.XLSX,book=XLSX.utils.book_new();
XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Synthetic file without a timesheet period']]),'Synthetic');
const invalidWorkbook=XLSX.write(book,{type:'array',bookType:'xlsx'});
const settle=()=>new Promise(resolve=>setImmediate(resolve));

// Run the actual shared controller and XLSX decoder. Only the DOM/file chooser
// boundary is synthetic; the existing-draft and malformed-workbook paths are real.
function harness(kind){
  let nodes={},markup='',reads=0,confirmations=0,allowReplace=false;
  const view={querySelector:selector=>nodes[selector]||null};
  const main={querySelector:selector=>selector==='[data-personnel-timesheet]'?view:null};
  Object.defineProperty(main,'innerHTML',{get:()=>markup,set:value=>{markup=value;nodes=Object.fromEntries(['cards','saved','new','import','file','editor','error'].map(name=>['[data-pt-'+name+']',{value:'',files:[],textContent:'',innerHTML:'',click(){}}]));}});
  const data={assetDocuments:[],drivers:[]};
  const context=vm.createContext({
    document:{getElementById:id=>id==='mainContent'?main:null,querySelector:selector=>nodes[selector]||null},
    htmlEsc:String,data,activeSection:kind==='operator'?'operatorTimesheets':'driverTimesheets',
    platformSessionContext:()=>({identity:'synthetic-timesheet-session'}),platformPrepareAccessStamp:()=> 'synthetic-timesheet-access',
    personnelCanRead:()=>true,personnelCanWrite:()=>true,renderPersonnelSection(){},switchSection(){},
    confirmAction:async()=>{confirmations++;return allowReplace;},showToast:message=>assert.fail('Unexpected toast: '+message),xpIcon:()=>'',fmtDate:String,
    PersonnelTimesheet:Timesheet,PersonnelTimesheetDocument:Document,XLSX,console
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/js/53a-personnel-timesheet.js'),'utf8'),context,{filename:'assets/js/53a-personnel-timesheet.js'});
  context.renderPersonnelTimesheets(kind);
  const state=context.ptView(kind),file={name:'same-timesheet.xlsx',size:invalidWorkbook.byteLength,arrayBuffer:async()=>{reads++;return invalidWorkbook;}};
  function choose(value=file){
    const input=nodes['[data-pt-file]'];
    // A native file input does not emit change for the same selected path.
    const selected=value?'synthetic-selected-'+value.name:'';
    if(value&&input.value===selected)return false;
    input.value=selected;input.files=value?[value]:[];input.onchange({target:input});return true;
  }
  return {context,state,data,file,choose,get input(){return nodes['[data-pt-file]'];},get error(){return nodes['[data-pt-error]'].textContent;},get reads(){return reads;},get confirmations(){return confirmations;},allowReplace:value=>{allowReplace=value;}};
}

for(const kind of ['driver','operator']){
  test(kind+': cancelling file selection leaves the timesheet and replace generation untouched',async()=>{
    const h=harness(kind),before=JSON.stringify(h.data),generation=h.state.generation;
    h.choose(null);await settle();
    assert.equal(h.reads,0);assert.equal(h.confirmations,0);assert.equal(h.state.generation,generation);assert.equal(h.state.model,null);assert.equal(h.error,'');assert.equal(h.input.value,'');assert.equal(JSON.stringify(h.data),before);
  });
  test(kind+': a rejected workbook can be selected again through the actual unchanged upload input',async()=>{
    const h=harness(kind),input=h.input,before=JSON.stringify(h.data);
    for(let attempt=1;attempt<=2;attempt++){
      assert.equal(h.choose(),true);await settle();
      assert.equal(h.reads,attempt);assert.equal(h.input,input);assert.equal(h.input.value,'');assert.match(h.error,/не найден табель/);
      assert.equal(h.state.model,null);assert.equal(h.state.original,null);assert.equal(h.state.pending,false);assert.equal(JSON.stringify(h.data),before);
    }
  });
  test(kind+': refusing draft replacement still permits selecting the same file later without losing entered data',async()=>{
    const h=harness(kind),model=Timesheet.create({kind,from:'2026-11-01',to:'2026-11-15',org:'Synthetic organisation',rows:[]});
    h.state.model=model;h.state.dirty=true;const before=JSON.stringify(model);
    assert.equal(h.choose(),true);await settle();
    assert.equal(h.confirmations,1);assert.equal(h.reads,0);assert.equal(h.state.model,model);assert.equal(h.input.value,'');assert.equal(h.error,'');
    h.allowReplace(true);assert.equal(h.choose(),true);await settle();
    assert.equal(h.confirmations,2);assert.equal(h.reads,1);assert.match(h.error,/не найден табель/);assert.equal(h.state.model,model);assert.equal(JSON.stringify(model),before);assert.equal(h.state.dirty,true);
  });
}
