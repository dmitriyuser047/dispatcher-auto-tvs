'use strict';
// In-memory source variants and synthetic seals only; no user archive is opened.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const schema=require('../assets/core/platform-schema.js'),writeoff=require('../assets/core/writeoff-engine.js'),kernel=require('../assets/core/platform-kernel.js');
const file=path.resolve(__dirname,'../assets/core/document-print.js'),currentSource=fs.readFileSync(file,'utf8').replace(/\r\n?/g,'\n'),frozenSource=fs.readFileSync(path.join(__dirname,'fixtures/document-print-v1-before-v5.cjs'),'utf8').replace(/\r\n?/g,'\n');
function load(source){const value=new Module(file,module);value.filename=file;value.paths=Module._nodeModulePaths(path.dirname(file));value._compile(source,file);return value.exports;}
const variants=source=>[['LF',source],['CRLF',source.replace(/\n/g,'\r\n')]];
const currentVariants=()=>[...variants(currentSource),['CR',currentSource.replace(/\n/g,'\r')]];
const actor={id:'synthetic-eol',name:'Synthetic EOL audit',role:'admin'},context={id:'synthetic-eol-seal',now:'2026-10-24T12:00:00.000Z',today:'2026-10-24',actor,timing:'late'};
function seals(api){
 const db={...Object.fromEntries(schema.sections.map(name=>[name,[]])),vehicles:[{id:0,plate:'SYNTHETIC EOL',org:'A',fuel:'diesel',fuelGrade:'ДТ',fuelBalance:10,norm:0}],records:[{id:'synthetic-r',vehicleId:0,date:'2026-09-01',km:0,fuelActual:0}],repairs:[{id:'synthetic-repair',vehicleId:0,cost:10,lifecycle:{version:1,postedAt:'2026-09-01T12:00:00.000Z'}}]},result=[];
 const capture=(request,ctx)=>{const before=JSON.stringify(db),snapshot=api.capture(db,request,ctx);assert.equal(JSON.stringify(db),before);return snapshot;};
 for(const form of ['waybill','fuelRequest','workAct'])result.push(capture({mode:'manual',form,target:{section:'vehicles',id:0},fields:{date:null,qty:0,description:'Synthetic fact\r\nPreserve original source line endings'},templateVersion:1},{...context,timing:'manual'}));
 result.push(capture({mode:'document',source:{section:'repairs',id:'synthetic-repair'},revision:'exact',templateId:'document',templateVersion:1},context));
 const v4=writeoff.forVersion(4),scope={month:'2026-09',date:'2026-09-30'},preview=v4.prepare(db,scope);assert.equal(preview.canPost,true);db.fuelWriteoffs=[v4.post(db,scope,{id:'synthetic-v4',number:'Synthetic',postedAt:context.now,postedBy:actor,expectedFingerprint:preview.sourceFingerprint})];
 result.push(capture({mode:'document',source:{section:'fuelWriteoffs',id:'synthetic-v4'},revision:'exact',templateId:'fuelWriteoff',templateVersion:1},context));
 const report=structuredClone(result[0]);report.mode='report';const {id,version,digest}=api.describe('report').templates[0];report.template={id,version,digest};delete report.snapshotFingerprint;report.snapshotFingerprint='sha256:'+writeoff.sha256(kernel.stableSerialize(report));api.verify(report);result.push(report);return result;
}
test('all six current print template identities are independent of LF, CRLF or CR source line endings',()=>{
 const canonical=load(frozenSource).describe().templates;for(const [ending,source]of currentVariants())assert.deepEqual(load(source).describe().templates,canonical,ending);
});
test('published LF and CRLF manual, document, report and v4-act seals render unchanged in either checkout and reject foreign template identities',()=>{
 for(const [oldEnding,source]of variants(frozenSource)){
  const old=load(source),snapshots=seals(old);for(const [newEnding,runtime]of currentVariants()){
   const current=load(runtime);for(const snapshot of snapshots){const before=JSON.stringify(snapshot),expected=JSON.stringify(old.render(snapshot));assert.equal(JSON.stringify(current.verify(snapshot)),before,oldEnding+' to '+newEnding);assert.equal(JSON.stringify(current.render(snapshot)),expected,oldEnding+' '+snapshot.template.id+' to '+newEnding);assert.equal(JSON.stringify(snapshot),before);}
   const forged=structuredClone(snapshots[0]);forged.template.digest=old.describe('document').templates[0].digest;delete forged.snapshotFingerprint;forged.snapshotFingerprint='sha256:'+writeoff.sha256(kernel.stableSerialize(forged));assert.throws(()=>current.verify(forged),{code:'PRINT_TEMPLATE_VERSION'});
  }
 }
});
test('line-ending compatibility never accepts arbitrary fingerprints or a changed model or renderer',()=>{
 for(const [,source]of variants(frozenSource)){
  const snapshot=seals(load(source))[0],before=JSON.stringify(snapshot),forged=structuredClone(snapshot);forged.template.digest='sha256:'+'f'.repeat(64);delete forged.snapshotFingerprint;forged.snapshotFingerprint='sha256:'+writeoff.sha256(kernel.stableSerialize(forged));
  for(const [,runtime]of currentVariants()){
   assert.throws(()=>load(runtime).verify(forged),{code:'PRINT_TEMPLATE_VERSION'});
   for(const [original,replacement]of [['ИСТОРИЧЕСКАЯ РЕДАКЦИЯ','ИСТОРИЧЕСКАЯ РЕДАКЦИЯ ИЗМЕНЕНА'],['font-family:Arial,sans-serif','font-family:Tahoma,sans-serif']]){assert.ok(runtime.includes(original));assert.throws(()=>load(runtime.replace(original,replacement)).verify(snapshot),{code:'PRINT_TEMPLATE_VERSION'});}
  }
  assert.equal(JSON.stringify(snapshot),before);
 }
});
