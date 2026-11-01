'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto,createHash,randomBytes}=require('node:crypto');
const source=fs.readFileSync(path.resolve(__dirname,'../web/public/pdf-bridge.js'),'utf8');
const cryptoSource=fs.readFileSync(path.resolve(__dirname,'../web/public/crypto.js'),'utf8');
const EDITOR='a'.repeat(64),CSRF='b'.repeat(64);
const boot={ok:true,csrf:CSRF,databaseToken:'synthetic-pdf-database',access:{user:{id:'synthetic-pdf-user'}}};
const bytes=Buffer.from('%PDF-SYNTHETIC');
const fileResult=value=>({ok:true,saved:true,name:'Синтетический документ.pdf',path:'server-only.pdf',base64:value.toString('base64'),bytes:value.length,size:value.length,sha256:createHash('sha256').update(value).digest('hex')});
function fixture(handler,{editor=EDITOR,insecure=false}={}){
  const calls=[],nodes=[],downloads=[],replaced=[],stored=new Map();
  function node(tag){const result={tagName:tag.toUpperCase(),children:[],listeners:new Map(),style:{},clicks:0,append(...items){for(const item of items){this.children.push(item);item.parent=this;}},setAttribute(key,value){this[key]=value;},addEventListener(name,listener){this.listeners.set(name,listener);},remove(){this.removed=true;if(this.parent)this.parent.children=this.parent.children.filter(item=>item!==this);},close(){this.closed=true;},showModal(){this.open=true;},focus(){this.focused=true;},click(){this.clicks++;if(tag==='a'&&this.download)downloads.push(this);this.listeners.get('click')?.({preventDefault(){}});}};nodes.push(result);return result;}
  const document={querySelector:()=>({content:'initial-csrf'}),body:node('body'),createElement:node};
  class BrowserURL extends URL{static createObjectURL(blob){const url='blob:synthetic-'+nodes.length;downloads.blobs??=[];downloads.blobs.push(blob);return url;}static revokeObjectURL(){}}
  const crypto=insecure?{getRandomValues:value=>webcrypto.getRandomValues(value)}:{getRandomValues:value=>webcrypto.getRandomValues(value),randomUUID:()=>webcrypto.randomUUID(),subtle:webcrypto.subtle};
  const window={};const context=vm.createContext({window,document,location:{href:'http://192.168.20.10:3381/pdf-studio'+(editor?'?editorId='+editor:'')},history:{replaceState(...args){replaced.push(args);}},localStorage:{getItem:key=>stored.get(key),setItem:(key,value)=>stored.set(key,value)},crypto,URL:BrowserURL,Blob,Uint8Array,Uint32Array,ArrayBuffer,DataView,btoa,atob,console,setTimeout(){},fetch:async(url,request)=>{
    const payload=request.body?JSON.parse(request.body):undefined;calls.push({url,request,payload});const reply=url.endsWith('/bootstrap')?{body:boot}:await handler(url,request,payload);return {ok:(reply.status||200)<400,status:reply.status||200,json:async()=>reply.body};
  }});vm.runInContext(cryptoSource,context,{filename:'crypto.js'});vm.runInContext(source,context,{filename:'pdf-bridge.js'});
  return {api:window.pdfEditor,calls,nodes,downloads,replaced,stored,crypto,context};
}
const file=(name,data=bytes)=>({name,size:data.length,arrayBuffer:async()=>data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength)});
async function picker(f){for(let count=0;count<30;count++){const input=f.nodes.find(node=>node.tagName==='INPUT'&&!node.parent?.parent?.removed);if(input)return input;await new Promise(resolve=>setImmediate(resolve));}throw Error('Picker was not created');}
async function choose(f,files){const input=await picker(f);input.files=files;input.listeners.get('change')();return input;}

test('PDF browser bridge exposes the complete native preload API and creates a private editor after explicit file selection',async()=>{
  const f=fixture((_url,_request,payload)=>({body:payload.action==='create'?{ok:true,editorId:EDITOR,pdfBase64:bytes.toString('base64'),fileName:'Документ.pdf'}:{ok:true,pdfBase64:bytes.toString('base64')}}),{editor:null});
  const preload=fs.readFileSync(path.resolve(__dirname,'../electron/pdf-preload.js'),'utf8'),native=[...preload.matchAll(/^  ([A-Za-z][A-Za-z0-9]+):/gm)].map(match=>match[1]);assert.deepEqual(Object.keys(f.api).sort(),native.sort());
  const opening=f.api.getData(),input=await picker(f);assert.equal(input.clicks,0);assert.equal(f.calls.filter(call=>call.payload).length,0);assert.equal(input.accept,'.pdf,application/pdf');
  await choose(f,[file('Документ.pdf')]);const opened=await opening;assert.equal(opened.pdfBase64,bytes.toString('base64'));
  const create=f.calls.find(call=>call.payload);assert.deepEqual(create.payload,{action:'create',databaseToken:boot.databaseToken,files:[{name:'Документ.pdf',base64:bytes.toString('base64')}]});
  assert.equal(create.request.credentials,'same-origin');assert.equal(create.request.redirect,'error');assert.equal(create.request.headers['X-CSRF-Token'],CSRF);assert.equal(create.request.headers.Authorization,undefined);
  assert.match(f.replaced[0][2],new RegExp('editorId='+EDITOR));assert.equal(f.stored.size,0);
  await f.api.getData();assert.equal(f.calls.at(-1).payload.editorId,EDITOR);assert.equal(f.calls.at(-1).payload.action,'pdf-editor-data');
});

test('PDF browser bridge keeps native payload shapes and never forwards a save path',async()=>{
  const f=fixture((_url,_request,payload)=>({body:['pdf-editor-save','pdf-editor-save-as','pdf-studio-export','pdf-studio-save-project','pdf-studio-export-pages'].includes(payload.action)?fileResult(bytes):{ok:true,base64:'AA=='}}));
  const cases=[['getData',[],'pdf-editor-data',undefined],['commitOpen',['pending-token'],'pdf-editor-commit-open','pending-token'],['cancelOpen',['pending-token'],'pdf-editor-cancel-open','pending-token'],['getFont',['bold'],'pdf-editor-font','bold'],['save',['UERG','C:\\private\\other.pdf'],'pdf-editor-save',{pdfBase64:'UERG'}],['saveAs',['UERG'],'pdf-editor-save-as',{pdfBase64:'UERG'}],['ocrInfo',[],'pdf-editor-ocr-info',undefined],['processContent',[{bytesBase64:'UERG',changes:[]}],'pdf-editor-process-content',{bytesBase64:'UERG',changes:[]}],['adoptProject',[{title:'Project',pdfBase64:'UERG'}],'pdf-editor-adopt-project',{title:'Project',pdfBase64:'UERG'}],['exportDocument',[{format:'docx',pages:[]}],'pdf-studio-export',{format:'docx',pages:[]}],['saveProject',[{project:{title:'Synthetic'}}],'pdf-studio-save-project',{project:{title:'Synthetic'}}],['autosave',[{project:{title:'Synthetic'}}],'pdf-studio-autosave',{project:{title:'Synthetic'}}],['recoveryList',[],'pdf-studio-recovery-list',undefined],['recoveryOpen',['recovery-id'],'pdf-studio-recovery-open',{id:'recovery-id'}],['recoveryDelete',['recovery-id'],'pdf-studio-recovery-delete',{id:'recovery-id'}],['exportPages',[{bytesBase64:'UERG'}],'pdf-studio-export-pages',{bytesBase64:'UERG'}]];
  for(const [method,args,action,payload]of cases){await f.api[method](...args);const sent=f.calls.at(-1).payload;assert.equal(sent.action,action);assert.equal(sent.editorId,EDITOR);assert.equal(sent.databaseToken,boot.databaseToken);assert.deepEqual(sent.payload,payload);}
  assert.equal(f.calls.filter(call=>call.url.endsWith('/bootstrap')).length,1);assert.equal(f.downloads.length,5);
});

test('initial invalid PDFs can be chosen again and a missing editor after server restart asks for a new source',async()=>{
  let creates=0;const f=fixture((_url,_request,payload)=>({body:++creates===1?{ok:false,error:'Synthetic invalid PDF'}:{ok:true,editorId:EDITOR,pdfBase64:bytes.toString('base64')}}),{editor:null});
  const opening=f.api.getData();await choose(f,[file('bad.pdf')]);const retry=await picker(f);assert.ok(retry.parent.parent.children.some(node=>node.textContent==='Synthetic invalid PDF'));assert.equal(creates,1);await choose(f,[file('valid.pdf')]);assert.equal((await opening).ok,true);assert.equal(creates,2);
  const stale=fixture((_url,_request,payload)=>payload.action==='pdf-editor-data'?{status:404,body:{code:'WEB_PDF_MISSING',error:'Synthetic restart'}}:{body:{ok:true,editorId:EDITOR,pdfBase64:bytes.toString('base64')}});
  const reloading=stale.api.getData();await choose(stale,[file('reloaded.pdf')]);assert.equal((await reloading).ok,true);assert.deepEqual(stale.calls.filter(call=>call.payload).map(call=>call.payload.action),['pdf-editor-data','create']);assert.equal(stale.replaced.length,2);
});

test('browser PDF/image/project/merge pickers upload original bytes and cancel without server calls',async()=>{
  const f=fixture((_url,_request,payload)=>({body:{ok:true,action:payload.action}}));
  for(const [method,name,action,multiple]of [['openFile','source.pdf','pdf-editor-open',false],['mergePdf','source.pdf','pdf-editor-merge',true],['insertImage','source.png','pdf-editor-insert-image',false],['openProject','source.tvspdf','pdf-studio-open-project',false],['compareFile','source.pdf','pdf-studio-compare-file',false]]){
    const pending=f.api[method](),input=await choose(f,[file(name)]);await pending;assert.equal(input.multiple,multiple);assert.deepEqual(f.calls.at(-1).payload.files,[{name,base64:bytes.toString('base64')}]);assert.equal(f.calls.at(-1).payload.action,action);
  }
  const before=f.calls.length,pending=f.api.openFile();await picker(f);const cancel=f.nodes.filter(node=>node.tagName==='BUTTON'&&node.textContent==='Отмена'&&!node.parent?.parent?.removed).at(-1);cancel.click();assert.deepEqual(JSON.parse(JSON.stringify(await pending)),{ok:false,canceled:true});assert.equal(f.calls.length,before);
});

test('file picker guards reject oversized and path-like sources before reading or uploading them',async()=>{
  const f=fixture(()=>{throw Error('Upload must not occur');});let read=false;
  const pending=f.api.mergePdf();await choose(f,[{name:'large.pdf',size:25*1024*1024+1,arrayBuffer(){read=true;}}]);await assert.rejects(pending,/25 МБ/);assert.equal(read,false);assert.equal(f.calls.length,0);
  const invalid=f.api.openFile();await choose(f,[file('../private.pdf')]);await assert.rejects(invalid,/имя/);assert.equal(f.calls.length,0);
});

test('confirmed PDF and Office downloads check size and SHA256 before creating a browser download',async()=>{
  const f=fixture(()=>({body:fileResult(bytes)}));const result=await f.api.save(bytes.toString('base64'));
  assert.equal(result.saved,true);assert.equal(result.downloadStarted,true);assert.equal(result.base64,undefined);assert.equal(f.downloads[0].download,'Синтетический документ.pdf');assert.equal(f.downloads.blobs[0].type,'application/pdf');assert.deepEqual(Buffer.from(await f.downloads.blobs[0].arrayBuffer()),bytes);
  for(const patch of [{sha256:'0'.repeat(64)},{bytes:1},{sha256:undefined}]){const broken=fixture(()=>({body:{...fileResult(bytes),...patch}}));await assert.rejects(broken.api.exportDocument({format:'docx',pages:[]}));assert.equal(broken.downloads.length,0);}
});

test('HTTP LAN crypto fallback creates UUIDv4 and verifies SHA256 across padding and multi-block boundaries',async()=>{
  let value=bytes;const f=fixture(()=>({body:fileResult(value)}),{insecure:true});
  const ids=new Set();for(let index=0;index<10;index++){const id=f.crypto.randomUUID();assert.match(id,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);ids.add(id);}assert.equal(ids.size,10);
  for(const size of [1,3,55,56,63,64,65,127,128,1000]){value=randomBytes(size);assert.equal((await f.api.exportPages({bytesBase64:value.toString('base64')})).downloadStarted,true);}
  assert.equal(f.downloads.length,10);
});

test('PDF requests serialize editor operations and never retry an unknown save result',async()=>{
  let finish;const waiting=new Promise(resolve=>{finish=resolve;});const f=fixture((_url,_request,payload)=>payload.action==='pdf-studio-autosave'?waiting:{body:{ok:true}});
  const first=f.api.autosave({project:{}}),second=f.api.recoveryList();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.filter(call=>call.payload).length,1);finish({body:{ok:true}});await Promise.all([first,second]);assert.equal(f.calls.filter(call=>call.payload).length,2);
  const broken=fixture(()=>{throw Error('Synthetic lost acknowledgement');});await assert.rejects(broken.api.save('UERG'),error=>error.code==='WEB_TRANSPORT'&&error.unknown===true);assert.equal(broken.calls.filter(call=>call.payload).length,1);
  const revoked=fixture(()=>({status:403,body:{code:'SESSION_CHANGED',error:'Synthetic revoked session'}}));await assert.rejects(revoked.api.getData(),error=>error.code==='SESSION_CHANGED'&&error.status===403);assert.equal(revoked.calls.filter(call=>call.payload).length,1);
});

test('PDF theme and OCR progress subscriptions unsubscribe without persisting document data',async()=>{
  const f=fixture(()=>({body:{ok:true,text:'Synthetic OCR',progress:{status:'recognizing text',progress:.5}}}));const themes=[],progress=[];
  const offTheme=f.api.onThemeChanged(value=>themes.push(value)),offProgress=f.api.onOcrProgress(value=>progress.push(value.progress));assert.equal(await f.api.setTheme('light'),'light');assert.equal(await f.api.getTheme(),'light');offTheme();await f.api.setTheme('dark');assert.deepEqual(themes,['light']);
  await f.api.ocr('IMAGE',{language:'rus+eng'});assert.deepEqual(progress,[0,.5,1]);offProgress();await f.api.ocr('IMAGE');assert.deepEqual(progress,[0,.5,1]);assert.deepEqual(Array.from(f.stored.keys()),['theme']);assert.deepEqual(f.calls.at(-1).payload.payload,{imageBase64:'IMAGE',options:{}});
});
