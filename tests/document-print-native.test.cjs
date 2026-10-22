'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createDocumentPrintRenderer}=require('../electron/document-print-renderer.cjs');
const {verifiedBytes}=require('../electron/document-print-export.cjs');
function fixture(options={}){
  const seen={windows:[],requests:[],cleared:0},isolated={setPermissionRequestHandler(handler){seen.permission=handler;},setPermissionCheckHandler(handler){seen.checkPermission=handler;},webRequest:{onBeforeRequest(filter,handler){seen.requests.push({filter,handler});}},async clearStorageData(){seen.cleared++;}};
  class Window {
    constructor(configuration){this.destroyed=false;seen.windows.push(this);seen.configuration=configuration;this.webContents={setWindowOpenHandler(handler){seen.popup=handler;},on(name,handler){seen[name]=handler;},async printToPDF(configuration){seen.print=configuration;if(options.hang)return new Promise(()=>{});return options.bytes||Buffer.from('%PDF-1.7\nSynthetic isolated document');}};}
    async loadURL(url){seen.url=url;if(options.loadFailure)throw Error('Synthetic load failure');}
    isDestroyed(){return this.destroyed;}destroy(){this.destroyed=true;}
  }
  const snapshot={synthetic:'sealed model'},engine={verify(value){assert.equal(value,snapshot);if(options.verifyFailure)throw Error('Synthetic bad seal');return value;},render(value){assert.equal(value,snapshot);return {html:options.html||'<!doctype html><html><head><title>Synthetic</title></head><body>Literal &lt;script&gt;</body></html>'};}};
  return {seen,snapshot,render:createDocumentPrintRenderer({BrowserWindow:Window,session:{fromPartition(name,configuration){seen.partition={name,configuration};return isolated;}},engine:()=>engine,timeoutMs:options.timeoutMs||1000})};
}
test('sealed print uses a hidden sandbox without scripts, preload, remote requests or filesystem loads',async()=>{
  const {seen,snapshot,render}=fixture(),bytes=await render(snapshot);
  assert.match(bytes.toString(),/^%PDF-/);assert.equal(seen.windows.length,1);assert.equal(seen.windows[0].destroyed,true);assert.equal(seen.cleared,1);
  assert.equal(seen.configuration.show,false);assert.deepEqual(seen.configuration.webPreferences,{session:seen.configuration.webPreferences.session,sandbox:true,contextIsolation:true,nodeIntegration:false,javascript:false,webSecurity:true,allowRunningInsecureContent:false,webviewTag:false});
  assert.match(seen.partition.name,/^tvs-print-[a-f0-9]{32}$/);assert.equal(seen.partition.configuration.cache,false);
  assert.match(decodeURIComponent(seen.url),/Content-Security-Policy/);assert.match(decodeURIComponent(seen.url),/script-src 'none'/);assert.match(decodeURIComponent(seen.url),/Literal &lt;script&gt;/);
  let denied;seen.permission(null,'camera',value=>denied=value);assert.equal(denied,false);assert.equal(seen.checkPermission(),false);assert.equal(seen.popup().action,'deny');
  const request=seen.requests[0];assert.deepEqual(request.filter.urls,['*://*/*','file://*/*']);request.handler({url:'https://example.invalid/private'},value=>denied=value.cancel);assert.equal(denied,true);assert.equal(seen.requests.at(-1).filter,null);
  assert.equal(seen.print.landscape,false);assert.equal(seen.print.preferCSSPageSize,true);
});
test('invalid seal or missing document header cannot create a print window',async()=>{
  for(const options of [{verifyFailure:true},{html:'No executable document header'}]){const {seen,snapshot,render}=fixture(options);await assert.rejects(render(snapshot));assert.equal(seen.windows.length,0);}
});
test('failed or timed-out PDF generation destroys its isolated window and session',async()=>{
  for(const options of [{loadFailure:true},{bytes:Buffer.from('Not a PDF')},{hang:true,timeoutMs:10}]){const {seen,snapshot,render}=fixture(options);await assert.rejects(render(snapshot));assert.equal(seen.windows[0].destroyed,true);assert.equal(seen.cleared,1);}
});
function artifact(format,bytes){return {ok:true,archiveId:'a'.repeat(64),format,size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),base64:bytes.toString('base64')};}
test('native saved-copy export binds exact archive, format, bytes, length and SHA256',()=>{
  for(const [format,bytes]of [['pdf',Buffer.from('%PDF-1.7\nSynthetic')],['xlsx',Buffer.from([0x50,0x4b,3,4,0,0])]]){
    const request={archiveId:'a'.repeat(64),format},result=artifact(format,bytes);assert.deepEqual(verifiedBytes(result,request),bytes);
    for(const patch of [{archiveId:'b'.repeat(64)},{format:format==='pdf'?'xlsx':'pdf'},{size:result.size+1},{sha256:'0'.repeat(64)},{base64:result.base64+'\n'},{base64:'!'+result.base64},{ok:false}])assert.throws(()=>verifiedBytes({...result,...patch},request),{code:'PRINT_ARTIFACT'});
  }
  for(const format of ['pdf','xlsx']){const bytes=Buffer.from('Synthetic wrong magic');assert.throws(()=>verifiedBytes(artifact(format,bytes),{archiveId:'a'.repeat(64),format}),{code:'PRINT_ARTIFACT'});}
});
