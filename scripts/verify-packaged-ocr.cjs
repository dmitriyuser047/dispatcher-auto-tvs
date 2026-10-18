// Проверка упакованного OCR в главном процессе Electron. Окна и рабочая база не открываются.
const {app}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
const workspace=path.resolve(__dirname,'..');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'tvs-ocr-package-')));
app.disableHardwareAcceleration();
const report={version:'3.2.0',synthetic:true,workingDatabaseTouched:false,browserWindowsCreated:0,checks:[]};
app.whenReady().then(async()=>{
 let lib;
 try{
  const archive=path.join(workspace,'dist','win-unpacked','resources','app.asar');
  report.archive=archive;
  for(const language of ['rus','eng'])assert.ok(fs.existsSync(path.join(archive+'.unpacked',language+'.traineddata')),'Unpacked model '+language);
  lib=await import(pathToFileURL(path.join(archive,'ReestrBuilder','lib.mjs')).href);
  const fixtureDir=path.join(workspace,'tests','fixtures','ocr');
  const expected=JSON.parse(fs.readFileSync(path.join(fixtureDir,'expected.json'),'utf8'));
  for(const name of ['synthetic-text.pdf','synthetic-scan-logo.pdf','synthetic-mixed.pdf']){
   const start=Date.now(),logs=[];
   const rows=await lib.parsePdfFiles([{name,buffer:fs.readFileSync(path.join(fixtureDir,name))}],lib.DEFAULT_CONFIG,entry=>logs.push(entry),()=>{},()=>{});
   assert.equal(rows.length,name==='synthetic-mixed.pdf'?2:1,name+' count');
   rows.forEach((row,index)=>{
    const scanned=name==='synthetic-scan-logo.pdf'||name==='synthetic-mixed.pdf'&&index===1;
    const document=scanned?expected.scan:expected.text;
    assert.equal(row.sum,document.sum,name+' amount');assert.equal(row.date,expected.date,name+' date');
    assert.equal(row.supplier,expected.supplier,name+' supplier');assert.equal(row.supplierInn,expected.supplierInn,name+' INN');
    const number=row.recognition.fields.number.value;
    assert.equal(number.replace(/T/g,'Т'),document.number,name+' number');
    if(number!==document.number)assert.ok(row.recognition.warnings.some(w=>w.code==='number_script_ambiguity'),'Script ambiguity warning');
    assert.equal(row.recognition.method,scanned?'ocr':'text',name+' method');
   });
   report.checks.push({input:name,seconds:(Date.now()-start)/1000,rows:rows.map(row=>({sum:row.sum,date:row.date,supplier:row.supplier,supplierInn:row.supplierInn,number:row.recognition.fields.number.value,method:row.recognition.method,confidence:row.recognition.confidence,warnings:row.recognition.warnings})),logs});
   if(name==='synthetic-text.pdf'){
    const result=await lib.buildXlsxFromRows(rows,lib.DEFAULT_CONFIG);
    const bytes=Buffer.from(result.buffer);
    assert.equal(result.total,expected.text.sum,'Registry export total');
    assert.equal(bytes.readUInt16LE(0),0x4b50,'Registry is an XLSX ZIP');
    const packedRequire=require('node:module').createRequire(path.join(archive,'package.json'));
    const workbookZip=new(packedRequire('adm-zip'))(bytes);
    assert.ok(workbookZip.getEntry('xl/worksheets/sheet1.xml'),'XLSX worksheet');
    assert.ok(workbookZip.readAsText('xl/worksheets/sheet1.xml').includes(String(expected.text.sum)),'XLSX amount');
    report.registryExport={status:'PASS',bytes:bytes.length,total:result.total};
   }
  }
  report.status='PASS';
 }catch(error){report.status='FAIL';report.error=error.stack||error.message;}
 finally{
  try{await lib?.disposeOcrWorker();}catch{}
  fs.writeFileSync(path.join(workspace,'audit','packaged-ocr-3.2.0.json'),JSON.stringify(report,null,2));
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  app.exit(report.status==='PASS'?0:1);
 }
});
