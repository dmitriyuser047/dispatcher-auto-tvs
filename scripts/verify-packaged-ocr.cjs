// Проверка упакованного OCR в главном процессе Electron. Окна и рабочая база не открываются.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const workspace=path.resolve(__dirname,'..');
const metadata=JSON.parse(fs.readFileSync(path.join(workspace,'package.json'),'utf8'));
const userData=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-ocr-package-'));
app.setPath('userData',userData);
app.disableHardwareAcceleration();
const report={version:metadata.version,electron:process.versions.electron,node:process.versions.node,userData,synthetic:true,workingDatabaseTouched:false,browserWindowsCreated:0,checks:[]};
app.on('browser-window-created',()=>report.browserWindowsCreated++);
app.whenReady().then(async()=>{
 let lib;
 try{
  assert.equal(process.versions.electron,metadata.devDependencies.electron.replace(/^[~^]/,''),'Verifier uses the application Electron version');
  const archive=path.resolve(process.env.TVS_PACKAGED_ASAR||path.join(workspace,'dist','win-unpacked','resources','app.asar'));
  report.archive=archive;
  const packedRequire=createRequire(path.join(archive,'package.json'));
  const packaged=JSON.parse(fs.readFileSync(path.join(archive,'package.json'),'utf8'));
  assert.equal(packaged.version,metadata.version,'Archive version matches current source');
  report.packagedVersion=packaged.version;
  // Resolve through the archive's own module tree. Reaching workspace native
  // bindings could hide a missing optional package in the installer stage.
  const canvasEntry=packedRequire.resolve('@napi-rs/canvas');
  assert.ok(canvasEntry.startsWith(archive+path.sep),'Canvas resolves inside the packaged dependency tree');
  const canvas=packedRequire('@napi-rs/canvas').createCanvas(8,8);
  canvas.getContext('2d').fillRect(0,0,8,8);
  assert.ok(canvas.toBuffer('image/png').length>20,'Packaged canvas native binding works');
  const nativeBindings=Object.keys(require.cache).filter(filename=>filename.endsWith('.node')&&filename.includes('@napi-rs'));
  assert.ok(nativeBindings.length,'Canvas actually loaded a native binding');
  for(const filename of nativeBindings){
   assert.ok(filename.startsWith(archive+path.sep)||filename.startsWith(archive+'.unpacked'+path.sep),'Native binding belongs to the archive');
   assert.ok(fs.existsSync(filename.replace(/([\\/])app\.asar(?=[\\/]|$)/i,'$1app.asar.unpacked')),'Native binding is physically unpacked');
  }
  report.canvas={entry:canvasEntry,nativeBindings};
  for(const language of ['rus','eng'])assert.ok(fs.existsSync(path.join(archive+'.unpacked',language+'.traineddata')),'Unpacked model '+language);
  lib=await import(pathToFileURL(path.join(archive,'ReestrBuilder','lib.mjs')).href);
  const fixtureDir=path.join(workspace,'tests','fixtures','ocr');
  const expected=JSON.parse(fs.readFileSync(path.join(fixtureDir,'expected.json'),'utf8'));
  for(const name of ['synthetic-text.pdf','synthetic-scan-logo.pdf','synthetic-mixed.pdf','synthetic-split.pdf']){
   const start=Date.now(),logs=[];
   const rows=await lib.parsePdfFiles([{name,buffer:fs.readFileSync(path.join(fixtureDir,name))}],lib.DEFAULT_CONFIG,entry=>logs.push(entry),()=>{},()=>{});
   assert.equal(rows.length,name==='synthetic-mixed.pdf'?2:1,name+' count');
   rows.forEach((row,index)=>{
    const scanned=name==='synthetic-scan-logo.pdf'||name==='synthetic-split.pdf'||name==='synthetic-mixed.pdf'&&index===1;
    const document=scanned?expected.scan:expected.text;
    assert.equal(row.sum,document.sum,name+' amount');assert.equal(row.date,expected.date,name+' date');
    assert.equal(row.supplier,expected.supplier,name+' supplier');assert.equal(row.supplierInn,expected.supplierInn,name+' INN');
    const number=row.recognition.fields.number.value;
    assert.equal(number.replace(/T/g,'Т'),document.number,name+' number');
    if(number!==document.number)assert.ok(row.recognition.warnings.some(w=>w.code==='number_script_ambiguity'),'Script ambiguity warning');
    assert.equal(row.recognition.method,scanned?'ocr':'text',name+' method');
    if(scanned){
     assert.ok(row.recognition.engineRuns?.length,'OCR engine provenance is returned');
     for(const run of row.recognition.engineRuns){
      assert.equal(run.coreVersion,'5.3.0-tvs1');
      assert.equal(run.nativeCore?.source,'custom-local-wasm');
      assert.equal(run.nativeCore?.stockFallback,false);
     }
    }
   });
   report.checks.push({input:name,seconds:(Date.now()-start)/1000,rows:rows.map(row=>({sum:row.sum,date:row.date,supplier:row.supplier,supplierInn:row.supplierInn,number:row.recognition.fields.number.value,method:row.recognition.method,confidence:row.recognition.confidence,warnings:row.recognition.warnings})),logs});
   if(name==='synthetic-text.pdf'){
    const result=await lib.buildXlsxFromRows(rows,lib.DEFAULT_CONFIG);
    const bytes=Buffer.from(result.buffer);
    assert.equal(result.total,expected.text.sum,'Registry export total');
    assert.equal(bytes.readUInt16LE(0),0x4b50,'Registry is an XLSX ZIP');
    const workbookZip=new(packedRequire('adm-zip'))(bytes);
    assert.ok(workbookZip.getEntry('xl/worksheets/sheet1.xml'),'XLSX worksheet');
    assert.ok(workbookZip.readAsText('xl/worksheets/sheet1.xml').includes(String(expected.text.sum)),'XLSX amount');
    report.registryExport={status:'PASS',bytes:bytes.length,total:result.total};
   }
  }
  const runtime=packedRequire('./electron/ocr-runtime.cjs').getSharedOcrRuntime();
  const info=await runtime.info({hashes:true});
  assert.equal(info.dependencyError,null,'Packaged native core manifest/bindings validate');
  for(const profile of ['default','accurate','codes'])assert.equal(info.profiles[profile].available,true,'Packaged model profile '+profile);
  assert.ok(info.workerPath.startsWith(archive+'.unpacked'+path.sep),'OCR worker runs from physical unpacked directory');
  assert.ok(info.corePath.startsWith(archive+'.unpacked'+path.sep),'WASM core runs from physical unpacked directory');
  report.runtime={workerPath:info.workerPath,corePath:info.corePath,observedCoreVersions:info.observedCoreVersions,profiles:Object.fromEntries(Object.entries(info.profiles).map(([name,profile])=>[name,{available:profile.available,directory:profile.directory}]))};
  assert.equal(BrowserWindow.getAllWindows().length,0);
  assert.equal(report.browserWindowsCreated,0);
  report.status='PASS';
 }catch(error){report.status='FAIL';report.error=error.stack||error.message;
  const causes=[];for(let cause=error.cause;cause&&causes.length<20;cause=cause.cause)causes.push({name:cause.name,message:cause.message,code:cause.code,stack:cause.stack});
  if(causes.length)report.causes=causes;
 }
 finally{
  try{await lib?.disposeOcrWorker();}catch{}
  fs.mkdirSync(path.join(workspace,'audit'),{recursive:true});
  fs.writeFileSync(path.join(workspace,'audit','packaged-ocr-'+metadata.version+'.json'),JSON.stringify(report,null,2));
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  app.exit(report.status==='PASS'?0:1);
 }
});
