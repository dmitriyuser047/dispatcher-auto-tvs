'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {PDFDocument}=require('pdf-lib'),studioModule=require('../web/pdf-studio.cjs'),sqlite=require('../electron/sqlite-storage.cjs'),storage=require('../electron/storage');
const admin={id:'synthetic-pdf-owner',name:'Synthetic PDF owner',role:'admin'},sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function pdf(text='SYNTHETIC SOURCE'){const doc=await PDFDocument.create(),page=doc.addPage([300,240]);page.drawText(text,{x:20,y:190,size:14});page.drawText('VISIBLE ZERO 0',{x:20,y:80,size:14});return Buffer.from(await doc.save());}
async function fixture(t){
  const base=fs.realpathSync.native(os.tmpdir()),root=fs.mkdtempSync(path.join(base,'tvs-web-studio-test-')),dataDir=path.join(root,'db'),pin=fs.lstatSync(root);sqlite.create(dataDir,{data:{vehicles:[{id:0,plate:'SYNTHETIC'}]}});const service=studioModule.createPdfStudio();let principal=admin;
  t.after(async()=>{await service.close();await require('../web/imports.cjs').close();const current=fs.lstatSync(root);assert.equal(path.dirname(path.resolve(root)),base);assert.match(path.basename(root),/^tvs-web-studio-test-/);assert.equal(current.ino,pin.ino);assert.equal(current.isSymbolicLink(),false);fs.rmSync(root,{recursive:true,force:true});});
  const ctx=()=>({dataDir,sessionId:'synthetic-first-session',principal,getPrincipal:()=>principal}),call=(action,payload,editorId,files)=>service.handle(ctx(),{action,databaseToken:storage.databaseToken(dataDir),...(payload===undefined?{}:{payload}),...(editorId?{editorId}:{}),...(files?{files}:{})});
  const bytes=await pdf(),created=await call('create',undefined,undefined,[{name:'Синтетический.pdf',base64:bytes.toString('base64')}]);assert.equal(created.ok,true,created.error);
  return {service,ctx,call,bytes,editorId:created.editorId,dataDir,created,setPrincipal(value){principal=value;}};
}
function verify(result){const bytes=Buffer.from(result.base64,'base64');assert.equal(bytes.length,result.bytes);assert.equal(bytes.length,result.size);assert.equal(sha(bytes),result.sha256);assert.equal(path.isAbsolute(result.path),false);return bytes;}
test('browser PDF editors reuse actual native open/save/font services and remain bound to authenticated session',async t=>{
  const f=await fixture(t),before=storage.readSnapshot(f.dataDir);assert.equal(f.created.fileName,'Синтетический.pdf');assert.equal(f.created.filePath,'Синтетический.pdf');assert.deepEqual(Buffer.from(f.created.pdfBase64,'base64'),f.bytes);
  const font=await f.call('pdf-editor-font','regular',f.editorId);assert.equal(font.ok,true,font.error);assert.ok(Buffer.from(font.base64,'base64').length>1000);
  const changed=await pdf('SYNTHETIC CHANGED');for(const method of ['pdf-editor-save','pdf-editor-save-as']){const saved=await f.call(method,{pdfBase64:changed.toString('base64')},f.editorId);assert.equal(saved.saved,true,saved.error);assert.deepEqual(verify(saved),changed);assert.deepEqual(Buffer.from((await f.call('pdf-editor-data',undefined,f.editorId)).pdfBase64,'base64'),changed);}
  const request={action:'pdf-editor-data',editorId:f.editorId,databaseToken:before.databaseToken};await assert.rejects(f.service.handle({...f.ctx(),sessionId:'synthetic-other-session'},request),{code:'WEB_PDF_MISSING'});
  f.setPrincipal({...admin,role:'viewer'});await assert.rejects(f.service.handle(f.ctx(),request),{code:'SESSION_CHANGED'});f.setPrincipal(admin);
  assert.deepEqual(storage.readSnapshot(f.dataDir),before);await f.service.closeSession(f.ctx().sessionId);await assert.rejects(f.service.handle(f.ctx(),request),{code:'WEB_PDF_MISSING'});
});
test('native pending-open tokens protect the current browser PDF until accepted and cancelled choices remain harmless',async t=>{
  const f=await fixture(t),candidate=await pdf('SYNTHETIC CANDIDATE'),files=[{name:'Следующий.pdf',base64:candidate.toString('base64')}];
  const pending=await f.call('pdf-editor-open',undefined,f.editorId,files);assert.equal(pending.ok,true,pending.error);assert.ok(pending.pendingToken);assert.equal((await f.call('pdf-editor-data',undefined,f.editorId)).fileName,'Синтетический.pdf');
  assert.equal((await f.call('pdf-editor-cancel-open',pending.pendingToken,f.editorId)).ok,true);assert.equal((await f.call('pdf-editor-commit-open',pending.pendingToken,f.editorId)).ok,false);
  const accepted=await f.call('pdf-editor-open',undefined,f.editorId,files);assert.equal((await f.call('pdf-editor-commit-open',accepted.pendingToken,f.editorId)).ok,true);assert.equal((await f.call('pdf-editor-data',undefined,f.editorId)).fileName,'Следующий.pdf');
  const merged=await f.call('pdf-editor-merge',undefined,f.editorId,[{name:'Первый.pdf',base64:f.bytes.toString('base64')},...files]);assert.equal(merged.ok,true);assert.equal(merged.files.length,2);assert.deepEqual(Buffer.from(merged.files[1].base64,'base64'),candidate);
  const compare=await f.call('pdf-studio-compare-file',undefined,f.editorId,files);assert.equal(compare.ok,true);assert.equal(compare.name,'Следующий.pdf');assert.deepEqual(Buffer.from(compare.bytesBase64,'base64'),candidate);
  const canvas=require('@napi-rs/canvas').createCanvas(32,32),paint=canvas.getContext('2d');paint.fillStyle='blue';paint.fillRect(0,0,32,32);const png=await canvas.encode('png');
  const inserted=await f.call('pdf-editor-insert-image',undefined,f.editorId,[{name:'Синтетическое изображение.png',base64:png.toString('base64')}]);assert.equal(inserted.ok,true);assert.equal(inserted.mimeType,'image/png');assert.equal(inserted.dataUrl,'data:image/png;base64,'+png.toString('base64'));
});
test('native Word, Excel, CSV and text export produce exact downloadable bytes and retain literal table values',async t=>{
  const f=await fixture(t),pages=[{number:1,width:300,height:240,blocks:[{kind:'text',text:'Синтетический документ 923,537',x:20,y:20,w:260,h:20}],tables:[{title:'Синтетическая таблица',rows:[['Код','Значение'],['000123','=1+1'],['0','923,537']]}]}];
  for(const format of ['docx','xlsx','txt','csv']){
    const result=await f.call('pdf-studio-export',{format,title:'Синтетический экспорт',pages},f.editorId);assert.equal(result.ok,true,result.error);const bytes=verify(result);assert.equal(path.extname(result.name),'.'+format);
    if(format==='docx'){const zip=new (require('adm-zip'))(bytes),xml=zip.readAsText('word/document.xml');assert.match(xml,/Синтетический документ 923,537/);assert.match(xml,/000123/);}
    if(format==='xlsx'){const book=new (require('exceljs').Workbook)();await book.xlsx.load(bytes);assert.equal(book.getWorksheet('Страница 1').getRow(3).getCell(1).value,'000123');assert.equal(book.getWorksheet('Страница 1').getRow(3).getCell(2).value,'=1+1');assert.equal(book.getWorksheet('Страница 1').getRow(3).getCell(2).type,require('exceljs').ValueType.String);}
    if(format==='txt')assert.match(bytes.toString('utf8'),/Синтетический документ 923,537/);
    if(format==='csv'){assert.match(bytes.toString('utf8'),/000123/);assert.match(bytes.toString('utf8'),/'=1\+1/);}
  }
});
test('native projects roundtrip, autosave and recover only inside their owning browser session',async t=>{
  const f=await fixture(t),project={schemaVersion:1,title:'Синтетический проект',sources:[{id:'source',name:'Синтетический.pdf',bytesBase64:f.bytes.toString('base64')}],pages:[{id:'page',sourceId:'source',sourcePage:0,width:300,height:240,rotation:0,elements:[{id:'text',type:'text',x:20,y:20,w:200,h:30,text:'Синтетическая правка',fontSize:14}]}],current:'page'};
  const saved=await f.call('pdf-studio-save-project',{project},f.editorId);assert.equal(saved.ok,true,saved.error);const bytes=verify(saved),opened=await f.call('pdf-studio-open-project',undefined,f.editorId,[{name:'Синтетический.tvspdf',base64:bytes.toString('base64')}]);assert.equal(opened.ok,true,opened.error);assert.deepEqual(opened.project,project);assert.equal(opened.base64,undefined);
  const autosave=await f.call('pdf-studio-autosave',{project},f.editorId);assert.equal(autosave.ok,true,autosave.error);assert.match(autosave.id,/^[a-f0-9]{64}$/);
  const list=await f.call('pdf-studio-recovery-list',undefined,f.editorId);assert.equal(list.entries.length,1);assert.equal(list.entries[0].title,project.title);
  const recovery=await f.call('pdf-studio-recovery-open',{id:autosave.id},f.editorId);assert.equal(recovery.ok,true,recovery.error);assert.deepEqual(recovery.project,project);
  const adopted=await f.call('pdf-editor-adopt-project',{title:project.title,pdfBase64:f.bytes.toString('base64')},f.editorId);assert.equal(adopted.ok,true,adopted.error);
  assert.equal((await f.call('pdf-studio-recovery-delete',{id:autosave.id},f.editorId)).ok,true);assert.equal((await f.call('pdf-studio-recovery-list',undefined,f.editorId)).entries.length,0);
});
test('browser destructive edits use the actual isolated PDFium engine and remove source text',{timeout:90000},async t=>{
  const f=await fixture(t),bytes=await pdf('SYNTHETIC-SECRET-TO-REMOVE'),result=await f.call('pdf-editor-process-content',{bytesBase64:bytes.toString('base64'),changes:[{pageIndex:0,kind:'redact',rectPDF:[15,185,285,210],fillColor:'#ffffff'}],rasterizePages:[]},f.editorId);assert.equal(result.ok,true,result.error);
  const output=Buffer.from(result.bytesBase64,'base64');assert.equal(output.subarray(0,5).toString(),'%PDF-');assert.equal((await PDFDocument.load(output)).getPageCount(),1);
  const runtime=require('../electron/pdfjs-runtime.cjs'),pdfjs=await runtime.loadPdfJs(),task=pdfjs.getDocument({...runtime.pdfDocumentOptions(),data:new Uint8Array(output)});
  try{const doc=await task.promise,page=await doc.getPage(1),text=(await page.getTextContent()).items.map(item=>item.str).join(' ');assert.doesNotMatch(text,/SECRET-TO-REMOVE/);
    // Full-page rasterization is the production engine's privacy-preserving
    // redaction path; retained visible text must still render below the cut.
    const canvas=require('@napi-rs/canvas').createCanvas(300,240),paint=canvas.getContext('2d');await page.render({canvasContext:paint,viewport:page.getViewport({scale:1})}).promise;
    const ink=(x,y,w,h)=>{const data=paint.getImageData(x,y,w,h).data;let pixels=0;for(let i=0;i<data.length;i+=4)if(data[i]+data[i+1]+data[i+2]<600)pixels++;return pixels;};assert.equal(ink(15,30,270,25),0);assert.ok(ink(15,140,250,40)>50);
  }finally{await task.destroy();}
});
test('studio pages and dependency assets have a precise allowlist and invalid sources never open an editor',async t=>{
  const f=await fixture(t),page=studioModule.renderPage({csrf:'a'.repeat(64)});assert.match(page,/web\/public\/pdf-bridge\.js/);assert.match(page,/assets\/js\/41-pdf-editor\.js/);assert.ok(page.indexOf('web/public/crypto.js')<page.indexOf('web/public/pdf-bridge.js'));assert.ok(page.indexOf('web/public/pdf-bridge.js')<page.indexOf('assets/js/38-pdf-runtime.js'));assert.doesNotMatch(page,/<base\b/);
  for(const filename of ['/node_modules/pdfjs-dist/legacy/build/pdf.mjs','/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs','/node_modules/pdf-lib/dist/pdf-lib.min.js','/node_modules/@pdf-lib/fontkit/dist/fontkit.umd.min.js'])assert.ok(studioModule.staticAsset(filename),filename);
  for(const filename of ['/node_modules/electron/package.json','/node_modules/pdfjs-dist/package.json','/node_modules/pdfjs-dist/../../electron/main.js','/electron/main.js'])assert.equal(studioModule.staticAsset(filename),null);
  const invalid=await f.call('create',undefined,undefined,[{name:'Invalid.pdf',base64:Buffer.from('Synthetic invalid PDF').toString('base64')}]);assert.equal(invalid.ok,false);assert.equal(invalid.editorId,undefined);
  const pathAttempt=await f.call('create',undefined,undefined,[{name:'../Private.pdf',base64:f.bytes.toString('base64')}]);assert.equal(pathAttempt.ok,false);assert.equal(pathAttempt.editorId,undefined);
  const zip=new (require('adm-zip'))();zip.addFile('manifest.json',Buffer.alloc(26*1024*1024,32));const compressed=zip.toBuffer();assert.ok(compressed.length<1024*1024);
  const oversized=await f.call('pdf-studio-open-project',undefined,f.editorId,[{name:'Oversized.tvspdf',base64:compressed.toString('base64')}]);assert.equal(oversized.ok,false);assert.equal(oversized.project,undefined);assert.equal((await f.call('pdf-editor-data',undefined,f.editorId)).fileName,'Синтетический.pdf');
});
