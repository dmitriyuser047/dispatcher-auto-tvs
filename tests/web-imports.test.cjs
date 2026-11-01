'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const imports=require('../web/imports.cjs'),storage=require('../electron/storage'),sqlite=require('../electron/sqlite-storage.cjs'),server=require('../electron/server.js');
const compatibility=require('../assets/core/platform-compatibility.js'),schema=require('../assets/core/platform-schema.js'),{rarStored}=require('./helpers/archive-fixture.cjs');
const admin={id:'synthetic-web-importer',name:'Synthetic web importer',role:'admin'};
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(t){
  const base=fs.realpathSync.native(os.tmpdir()),root=fs.mkdtempSync(path.join(base,'tvs-web-imports-')),dataDir=path.join(root,'db'),pin=fs.lstatSync(root);
  sqlite.create(dataDir,{data:{...Object.fromEntries(schema.sections.map(name=>[name,[]])),vehicles:[{id:0,plate:'SYNTHETIC-IMPORT',org:'А',site:'Север'}]}});let principal=admin,backups=0;
  t.after(async()=>{await imports.close();assert.equal(path.dirname(path.resolve(root)),base);assert.match(path.basename(root),/^tvs-web-imports-/);const current=fs.lstatSync(root);assert.equal(current.ino,pin.ino);assert.equal(current.isSymbolicLink(),false);fs.rmSync(root,{recursive:true,force:true});});
  return {root,dataDir,setPrincipal(value){principal=value;},get backups(){return backups;},ctx(){return {dataDir,principal,getPrincipal:()=>principal,beforeCommit(){backups++;},writeOptions:server.localWriteOptions({hello:compatibility.describe().hello,databaseToken:storage.databaseToken(dataDir),principal})};}};
}
function request(f,action,name,bytes,extra={}){return {action,databaseToken:storage.databaseToken(f.dataDir),source:{name,base64:bytes.toString('base64')},...extra};}
function rar(files){const parts=files.map(([name,value])=>rarStored(name,Buffer.from(JSON.stringify(value))));return Buffer.concat([parts[0].subarray(0,20),...parts.map(value=>value.subarray(20,-7)),parts[0].subarray(-7)]);}
test('RAR import reuses the real bounded decoder, preserves typed zero and supplies exact original bytes without changing business data',{timeout:45000},async t=>{
  const f=fixture(t),before=storage.readSnapshot(f.dataDir),bytes=rar([['data.json',{vehicles:[{id:0,plate:'MAIN-NUMERIC'}],records:[{id:'main-record',km:0}]}],['backups/copy.json',{vehicles:[{id:0,plate:'DUPLICATE-NUMERIC'},{id:'0',plate:'BACKUP-TEXT'},{id:1,plate:'BACKUP-ONE'}],records:[{id:0,km:923.537}]}]]);
  const result=await imports.handle(f.ctx(),request(f,'rar','Синтетический архив.rar',bytes));
  assert.equal(result.ok,true);assert.equal(result.backupCount,1);assert.equal(result.main.vehicles[0].id,0);assert.deepEqual(result.backupExtra.vehicles.map(row=>row.id),['0',1]);assert.equal(result.backupExtra.records[0].id,0);assert.equal(result.backupExtra.records[0].km,923.537);
  assert.equal(result.sha256,sha(bytes));assert.equal(result.bytes,bytes.length);assert.deepEqual(Buffer.from(result.source.base64,'base64'),bytes);assert.equal(result.source.name,result.fileName);assert.deepEqual(storage.readSnapshot(f.dataDir),before);assert.equal(f.backups,0);
});
test('PDF svodka and GLONASS return native coordinate schemas from a real PDF text layer',{timeout:45000},async t=>{
  const f=fixture(t),before=storage.readSnapshot(f.dataDir),bytes=fs.readFileSync(path.join(__dirname,'fixtures/ocr/synthetic-text.pdf'));
  for(const action of ['svodka','glonass']){
    const result=await imports.handle(f.ctx(),request(f,action,'Синтетический.pdf',bytes));assert.equal(result.ok,true);assert.ok(result.items.length>0);assert.match(result.items.map(item=>item.str).join(' '),/314/);
    assert.ok(result.items.every(item=>Number.isFinite(item.x)&&Number.isFinite(item.y)&&Number.isInteger(item.page)&&item.page>0));
    if(action==='svodka')assert.ok(result.items.every(item=>Number.isFinite(item.w)&&Number.isFinite(item.h)));else{assert.equal(result.kind,'pdf');assert.equal(Object.hasOwn(result.items[0],'w'),false);}
    assert.deepEqual(Buffer.from(result.source.base64,'base64'),bytes);
  }assert.deepEqual(storage.readSnapshot(f.dataDir),before);assert.equal(f.backups,0);
});
test('GLONASS Excel bytes enter the retained signed reviewed-source authority without trusting browser rows',{timeout:45000},async t=>{
  const f=fixture(t),before=storage.readSnapshot(f.dataDir),book=new (require('exceljs').Workbook)(),sheet=book.addWorksheet('Рейсы');sheet.addRow(['Дата','Госномер','Пробег']);sheet.addRow(['2026-10-28','SYNTHETIC-IMPORT',923.537]);const bytes=Buffer.from(await book.xlsx.writeBuffer());
  const loaded=await imports.handle(f.ctx(),request(f,'glonass','Синтетические рейсы.xlsx',bytes));assert.equal(loaded.kind,'xlsx');assert.equal(loaded.base64,bytes.toString('base64'));assert.equal(loaded.source.base64,loaded.base64);
  const staged=await require('../electron/import-source.cjs').handle(f.dataDir,{action:'stage',profile:'glonass',sections:['glonassTrips'],parser:{id:'glonass',version:1},databaseToken:before.databaseToken,source:loaded.source,mapping:{}},{principal:admin,...f.ctx().writeOptions});
  assert.equal(staged.ok,true);assert.match(staged.sourceId,/^[a-f0-9]{64}$/);assert.equal(staged.source.rows[0].normalized.km,923.537);assert.equal(staged.source.attestation.mode,'server-decoded');assert.equal(staged.source.sourceArchive.sha256,sha(bytes));assert.deepEqual(storage.readSnapshot(f.dataDir),before);
});
test('legacy source archival requires current import rights, trusted writer proof and a successful backup',async t=>{
  const f=fixture(t),before=storage.readSnapshot(f.dataDir),bytes=Buffer.from('Synthetic original source bytes'),input=request(f,'archiveSource','Synthetic.csv',bytes);
  await assert.rejects(imports.handle({...f.ctx(),beforeCommit(){throw Error('Synthetic backup failed');}},input),/backup failed/);assert.equal(fs.existsSync(path.join(f.dataDir,'import-sources')),false);
  await assert.rejects(imports.handle({...f.ctx(),writeOptions:{}},input),{code:'PROTOCOL_RENEGOTIATE'});
  const result=await imports.handle(f.ctx(),input);assert.equal(result.ok,true);assert.equal(result.id,sha(bytes)+'.csv');assert.deepEqual(fs.readFileSync(path.join(f.dataDir,'import-sources',result.id)),bytes);assert.equal(f.backups,1);
  assert.equal((await imports.handle(f.ctx(),input)).id,result.id);assert.equal(f.backups,1);assert.deepEqual(storage.readSnapshot(f.dataDir),before);
  f.setPrincipal({...admin,role:'viewer'});await assert.rejects(imports.handle(f.ctx(),input),{code:'ACCESS_DENIED'});
});
test('native imports reject stale database, revoked role, paths, malformed bytes and invalid documents without artifacts',async t=>{
  const f=fixture(t),before=storage.readSnapshot(f.dataDir),bytes=Buffer.from('not a PDF'),input=request(f,'svodka','Synthetic.pdf',bytes);
  await assert.rejects(imports.handle(f.ctx(),{...input,databaseToken:'synthetic-other-database'}),{code:'DATABASE_CHANGED'});
  await assert.rejects(imports.handle(f.ctx(),{...input,source:{...input.source,name:'../private.pdf'}}),{code:'WEB_IMPORT_NAME'});
  await assert.rejects(imports.handle(f.ctx(),{...input,source:{...input.source,base64:input.source.base64+'\n'}}),{code:'WEB_IMPORT_BYTES'});
  await assert.rejects(imports.handle(f.ctx(),input),{code:'WEB_IMPORT_PDF'});
  f.setPrincipal({...admin,role:'viewer'});await assert.rejects(imports.handle(f.ctx(),input),{code:'ACCESS_DENIED'});
  assert.deepEqual(storage.readSnapshot(f.dataDir),before);assert.equal(fs.existsSync(path.join(f.dataDir,'import-sources')),false);
});
test('revocation during actual PDF parsing withholds all extracted source data',{timeout:45000},async t=>{
  const f=fixture(t),before=storage.readSnapshot(f.dataDir),bytes=fs.readFileSync(path.join(__dirname,'fixtures/ocr/synthetic-text.pdf'));let count=0;
  const ctx={...f.ctx(),assertCurrent(){if(++count>5)throw Object.assign(Error('Synthetic access revoked during parse'),{code:'SESSION_CHANGED',status:409});}};
  await assert.rejects(imports.handle(ctx,request(f,'svodka','Synthetic.pdf',bytes)),{code:'SESSION_CHANGED'});assert.deepEqual(storage.readSnapshot(f.dataDir),before);
});
test('local OCR uses the actual bundled runtime, reports recognized text and leaks no server file paths',{timeout:120000},async t=>{
  const f=fixture(t),before=storage.readSnapshot(f.dataDir),canvas=require('@napi-rs/canvas').createCanvas(1000,240),paint=canvas.getContext('2d');paint.fillStyle='white';paint.fillRect(0,0,1000,240);paint.fillStyle='black';paint.font='bold 76px Arial';paint.fillText('SYNTHETIC 923537',32,145);const bytes=await canvas.encode('png');
  const info=await imports.handle(f.ctx(),{action:'ocrInfo'});assert.equal(info.ok,true);assert.equal(info.localOnly,true);assert.equal(Object.hasOwn(info,'workerPath'),false);assert.equal(Object.hasOwn(info.profiles.default,'directory'),false);assert.equal(JSON.stringify(info).includes(path.resolve(__dirname,'..')),false);
  const recognized=await imports.handle(f.ctx(),request(f,'ocr','Synthetic.png',bytes,{options:{language:'eng',profile:'default',decode:'document',psm:6}}));assert.equal(recognized.ok,true);assert.match(recognized.text,/SYNTHETIC\s+923537/);assert.ok(recognized.lines.length);assert.deepEqual(storage.readSnapshot(f.dataDir),before);
  await assert.rejects(imports.handle(f.ctx(),request(f,'ocr','Synthetic.png',bytes,{options:{decode:'amount'}})),{code:'WEB_OCR_REGION'});
});
