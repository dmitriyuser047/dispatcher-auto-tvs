'use strict';

// Every source, managed file and database in this suite is synthetic and owned
// by the suite's temporary directory. Native PDF output uses production code.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),http=require('node:http');
const documents=require('../web/documents.cjs'),storage=require('../electron/storage'),sqlite=require('../electron/sqlite-storage.cjs'),backend=require('../electron/server.js');
const schema=require('../assets/core/platform-schema.js'),compatibility=require('../assets/core/platform-compatibility.js');
const admin={id:'synthetic-doc-admin',name:'Synthetic document owner',role:'admin'};
const limited={id:'synthetic-doc-limited',name:'Synthetic northern reader',role:'admin',accessPolicy:{version:1,grants:[{org:'А',site:'Север'}]}};
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function data(){return {...Object.fromEntries(schema.sections.map(name=>[name,[]])),vehicles:[{id:0,plate:'SYNTHETIC-WEB-ZERO',org:'А',site:'Север',fuel:'diesel',norm:0,fuelBalance:0},{id:'0',plate:'SYNTHETIC-PRIVATE-TEXT-ZERO',org:'Б',site:'Юг',fuel:'diesel',norm:0,fuelBalance:0}]};}
function fixture(t,format='sqlite',source=data()){
  const base=fs.realpathSync.native(os.tmpdir()),root=fs.mkdtempSync(path.join(base,'tvs-web-documents-')),dir=path.join(root,'db'),pin=fs.lstatSync(root);
  if(format==='sqlite')sqlite.create(dir,{data:source});else storage.createJson(dir,{data:source});
  t.after(()=>{const resolved=path.resolve(root),current=fs.lstatSync(resolved);assert.equal(path.dirname(resolved),base);assert.match(path.basename(resolved),/^tvs-web-documents-/);assert.equal(current.ino,pin.ino);assert.equal(current.isSymbolicLink(),false);fs.rmSync(resolved,{recursive:true,force:true});});
  let principal=admin,backups=0;
  const ctx=()=>({dataDir:dir,principal,getPrincipal:()=>principal,writeOptions:backend.localWriteOptions({hello:compatibility.describe().hello,databaseToken:storage.databaseToken(dir),principal}),beforeCommit(){backups++;}});
  return {dir,root,ctx,setPrincipal(value){principal=value;},get backups(){return backups;}};
}
function verify(result,format){const bytes=Buffer.from(result.base64,'base64');assert.equal(bytes.length,result.bytes);assert.equal(bytes.length,result.size);assert.equal(sha(bytes),result.sha256);if(format==='pdf')assert.equal(bytes.subarray(0,5).toString(),'%PDF-');if(format==='xlsx')assert.equal(bytes.readUInt32LE(),0x04034b50);return bytes;}
function saveAttachment(f,file){const prior=storage.readSnapshot(f.dir,{principal:admin});return storage.writeSections(f.dir,{databaseToken:prior.databaseToken,base:prior.revisions,scopeViews:prior.scopeViews,sections:{vehicles:prior.data.vehicles.map(row=>row.id===0?{...row,attachments:[file]}:row)}},{principal:admin,...f.ctx().writeOptions});}
for(const format of ['json','sqlite'])test(format+' browser upload issues a real typed ticket and downloads only its authorized exact bytes',async t=>{
  const f=fixture(t,format),before=storage.readSnapshot(f.dir),bytes=Buffer.from('Synthetic original attachment · 923.537 · русский текст');
  const upload=await documents.handle(f.ctx(),{action:'attachmentAdd',origin:{section:'vehicles',id:0},databaseToken:before.databaseToken,source:{name:'Синтетический документ.txt',base64:bytes.toString('base64')}});
  assert.equal(upload.ok,true);assert.equal(upload.file.name,'Синтетический документ.txt');assert.equal(upload.file.sha256,sha(bytes));assert.equal(upload.file.proof.binding.id,0);assert.equal(upload.file.proof.binding.section,'vehicles');assert.equal(upload.databaseToken,before.databaseToken);assert.equal(f.backups,1);
  assert.deepEqual(storage.readSnapshot(f.dir),before);assert.equal(saveAttachment(f,upload.file).ok,true);
  f.setPrincipal(limited);const download=await documents.handle(f.ctx(),{action:'attachmentRead',origin:{section:'vehicles',id:0,fileId:upload.file.id}});
  assert.deepEqual(verify(download),bytes);assert.equal(download.mime,'text/plain;charset=utf-8');assert.equal(download.name,upload.file.name);
  for(const origin of [{section:'vehicles',id:'0',fileId:upload.file.id},{section:'vehicles',id:0,fileId:'..\\settings.json'}])await assert.rejects(documents.handle(f.ctx(),{action:'attachmentRead',origin}),{code:'ATTACHMENT_ACCESS'});
  f.setPrincipal({...admin,readFields:{vehicles:['id','plate']}});await assert.rejects(documents.handle(f.ctx(),{action:'attachmentRead',origin:{section:'vehicles',id:0,fileId:upload.file.id}}),{code:'ATTACHMENT_ACCESS'});
  f.setPrincipal(admin);fs.writeFileSync(path.join(f.dir,'attachments',upload.file.id),'Synthetic tampered original');await assert.rejects(documents.handle(f.ctx(),{action:'attachmentRead',origin:{section:'vehicles',id:0,fileId:upload.file.id}}),{code:'ATTACHMENT_ACCESS'});
  assert.equal(f.backups,1);
});
test('upload rejects paths, executable types, noncanonical bytes, stale database and unconfirmed writers before storing files',async t=>{
  const f=fixture(t),before=storage.readSnapshot(f.dir),origin={section:'vehicles',id:0},source={name:'Synthetic.txt',base64:Buffer.from('Synthetic').toString('base64')};
  for(const changed of [{...source,name:'../Synthetic.txt'},{...source,name:'CON.txt'},{...source,name:'Synthetic.exe'},{...source,base64:source.base64+'\n'},{...source,base64:''}])await assert.rejects(documents.handle(f.ctx(),{action:'attachmentAdd',origin,source:changed}));
  await assert.rejects(documents.handle(f.ctx(),{action:'attachmentAdd',origin,source,databaseToken:'synthetic-other-database'}),{code:'DATABASE_CHANGED'});
  await assert.rejects(documents.handle({...f.ctx(),writeOptions:{}},{action:'attachmentAdd',origin,source}),{code:'PROTOCOL_RENEGOTIATE'});
  await assert.rejects(documents.handle({...f.ctx(),beforeCommit:undefined},{action:'attachmentAdd',origin,source}),{code:'WEB_DOCUMENT_BACKUP'});
  await assert.rejects(documents.handle({...f.ctx(),principal:null,getPrincipal:()=>null},{action:'attachmentRead',origin:{...origin,fileId:'a'.repeat(64)+'.txt'}}),{code:'ACCESS_DENIED'});
  f.setPrincipal(limited);await assert.rejects(documents.handle(f.ctx(),{action:'attachmentAdd',origin:{section:'vehicles',id:'0'},source}),{code:'ATTACHMENT_ACCESS'});
  assert.equal(fs.existsSync(path.join(f.dir,'attachments')),false);assert.equal(f.backups,0);assert.deepEqual(storage.readSnapshot(f.dir),before);
});
test('a failed mandatory backup prevents a managed attachment from being created',async t=>{
  const f=fixture(t),before=storage.readSnapshot(f.dir);
  await assert.rejects(documents.handle({...f.ctx(),beforeCommit(){throw Error('Synthetic backup unavailable');}},{action:'attachmentAdd',origin:{section:'vehicles',id:0},source:{name:'Synthetic.txt',base64:Buffer.from('Synthetic').toString('base64')}}),/backup unavailable/);
  assert.equal(fs.existsSync(path.join(f.dir,'attachments')),false);assert.deepEqual(storage.readSnapshot(f.dir),before);
});
test('the actual disposable HTML renderer returns a readable Cyrillic PDF with exact browser checksum and blocked scripts/network',{timeout:90000},async t=>{
  const f=fixture(t),before=storage.readSnapshot(f.dir);let requests=0;
  const trap=http.createServer((_request,response)=>{requests++;response.end('SYNTHETIC-REMOTE-LEAK');});await new Promise(resolve=>trap.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>trap.close(resolve)));
  const url='http://127.0.0.1:'+trap.address().port;
  const html='<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>body{font:16px Arial}td{border:1px solid #333;padding:8px}</style></head><body><h1>Синтетическая сводка ТВС</h1><table><tr><td>923,537</td><td>Нулевой остаток: 0</td></tr></table><img src="'+url+'/image"><script>fetch("'+url+'/script");document.body.textContent="SCRIPT_EXECUTED";</script></body></html>';
  const result=await documents.handle(f.ctx(),{action:'pdf',html,defaultFileName:'Синтетическая сводка.pdf'}),bytes=verify(result,'pdf');
  const pdf=await require('pdf-lib').PDFDocument.load(bytes);assert.equal(pdf.getPageCount(),1);assert.equal(result.name,'Синтетическая сводка.pdf');assert.equal(result.mime,'application/pdf');
  const {loadPdfJs,pdfDocumentOptions}=require('../electron/pdfjs-runtime.cjs'),pdfjs=await loadPdfJs(),task=pdfjs.getDocument({...pdfDocumentOptions(),data:new Uint8Array(bytes)});
  try{const doc=await task.promise,text=(await (await doc.getPage(1)).getTextContent()).items.map(item=>item.str).join(' ');assert.match(text,/Синтетическая сводка ТВС/);assert.match(text,/923,537/);assert.match(text,/Нулевой остаток: 0/);assert.doesNotMatch(text,/SCRIPT_EXECUTED|REMOTE-LEAK/);}finally{await task.destroy();}
  assert.equal(requests,0);assert.equal(f.backups,0);assert.deepEqual(storage.readSnapshot(f.dir),before);
});
test('document download is withheld when rights change during asynchronous rendering',async t=>{
  const f=fixture(t),before=storage.readSnapshot(f.dir);let resolveRender,started;
  const pending=new Promise(resolve=>started=resolve),ctx={...f.ctx(),renderHtmlPdf:async()=>{started();return new Promise(resolve=>resolveRender=resolve);}};
  const operation=documents.handle(ctx,{action:'pdf',html:'<h1>Synthetic pending</h1>',defaultFileName:'Synthetic.pdf'});await pending;f.setPrincipal({...admin,role:'viewer'});resolveRender(Buffer.from('%PDF-1.7\nSynthetic test boundary'));
  await assert.rejects(operation,{code:'SESSION_CHANGED'});assert.deepEqual(storage.readSnapshot(f.dir),before);
});
function inventoryData(){
  const core=require('../assets/core/asset-inventory.js'),today='2026-10-28';let db={...data(),inventoryOrgs:[{id:0,name:'Синтетическая организация',note:''}],inventoryObjects:[{id:0,name:'Синтетический объект',note:''}],inventoryMols:[{id:0,name:'Синтетический МОЛ',orgId:0,objectId:0,accountCode:'01',note:''}],inventoryItems:[{id:0,molId:0,name:'Синтетическая деталь',code:'000123',unit:'шт',qty:923.537,cost:923.53,note:''}]};
  const input={action:'createSession',objectId:0,date:today,title:'Синтетическая опись',reason:'Synthetic independently counted inventory'},review=core.preview(db,input,{today});assert.equal(review.canApply,true,JSON.stringify(review.issues));
  const plan=core.plan(db,{...input,reviewFingerprint:review.fingerprint},{id:'synthetic-web-inventory',today,now:today+'T09:00:00.000Z',actor:admin});return {...db,...structuredClone(plan.sections)};
}
test('inventory reports contain actual Excel/PDF bytes, checksum and authoritative fingerprint without database writes',{timeout:90000},async t=>{
  const f=fixture(t,'sqlite',inventoryData()),before=storage.readSnapshot(f.dir),input={sessionId:'synthetic-web-inventory',databaseToken:before.databaseToken};
  const xlsx=await documents.handle(f.ctx(),{action:'inventoryReport',request:{...input,format:'xlsx'}}),book=new (require('exceljs').Workbook)();await book.xlsx.load(verify(xlsx,'xlsx'));
  assert.equal(book.getWorksheet('Опись').getRow(8).getCell(7).value,'000123');assert.equal(book.getWorksheet('Опись').getRow(8).getCell(6).value,'Синтетическая деталь');assert.match(xlsx.sourceFingerprint,/^sha256:[a-f0-9]{64}$/);
  const pdf=await documents.handle(f.ctx(),{action:'inventoryReport',request:{...input,format:'pdf'}});assert.ok((await require('pdf-lib').PDFDocument.load(verify(pdf,'pdf'))).getPageCount()>=1);
  assert.equal(pdf.sourceFingerprint,xlsx.sourceFingerprint);assert.deepEqual(storage.readSnapshot(f.dir),before);assert.equal(f.backups,0);
  f.setPrincipal({...admin,role:'dispatcher'});await assert.rejects(documents.handle(f.ctx(),{action:'inventoryReport',request:{...input,format:'xlsx'}}),{code:'ACCESS_DENIED'});
});
test('inventory report rechecks the frozen source and rejects changes made during rendering',async t=>{
  const f=fixture(t,'sqlite',inventoryData()),before=storage.readSnapshot(f.dir);
  await assert.rejects(documents.handle({...f.ctx(),renderHtmlPdf:async()=>{
    require('./period-test-support.cjs').seedSections(f.dir,{inventorySessions:storage.readAll(f.dir).inventorySessions.map(row=>({...row,note:'Synthetic concurrent draft change'}))});return Buffer.from('%PDF-1.7\nSynthetic boundary');
  }},{action:'inventoryReport',request:{sessionId:'synthetic-web-inventory',databaseToken:before.databaseToken,format:'pdf'}}),{code:'INVENTORY_EXPORT_STALE'});
});
test('saved document export uses real archive seals and cached exact PDF/XLSX artifacts',{timeout:120000},async t=>{
  const f=fixture(t),request={mode:'manual',form:'fuelRequest',target:{section:'vehicles',id:0},fields:{date:'2026-10-28',qty:923.537,amount:0,org:null,driver:null},templateVersion:1};
  const preview=await documents.handle(f.ctx(),{action:'documentPrint',request:{action:'preview',request}});assert.equal(preview.prepared.canCapture,true,JSON.stringify(preview));
  const captured=storage.executeCommand(f.dir,{protocolVersion:1,databaseToken:preview.databaseToken,base:preview.base,operation:{id:'synthetic-web-document-capture'},command:{type:'PrintAction',version:1,input:{request,reviewFingerprint:preview.reviewFingerprint}}},{principal:admin,...f.ctx().writeOptions});assert.equal(captured.ok,true,captured.error);
  const listed=await documents.handle(f.ctx(),{action:'documentPrint',request:{action:'list'}});assert.equal(listed.archives.length,1);const archiveId=listed.archives[0].id;
  for(const format of ['pdf','xlsx']){
    const payload={action:'documentPrint',request:{action:'export',archiveId,format}},first=await documents.handle(f.ctx(),payload),bytes=verify(first,format),repeated=await documents.handle(f.ctx(),payload);
    assert.deepEqual(verify(repeated,format),bytes);assert.equal(first.archiveId,archiveId);assert.equal(first.archiveHeadChanged,true);
    if(format==='pdf')assert.equal((await require('pdf-lib').PDFDocument.load(bytes)).getPageCount(),1);
  }
  assert.equal(f.backups,2,'each first PDF/XLSX artifact must run its mandatory backup once; cached downloads do not write');
  assert.equal(require('../electron/document-archive.cjs').validateState(f.dir,storage.readAll(f.dir)),true);
});
