'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),{spawn}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {ROOT}=require('./helpers/source-harness.cjs');
async function packagedResult(directory,html,executable){
 const {createRequire}=require('node:module');let pw;try{pw=require('playwright');}catch{pw=createRequire(path.join(process.env.TVS_PLAYWRIGHT_MODULES||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),'package.json'))('playwright');}
 const profile=path.join(directory,'profile'),dataDir=path.join(directory,'synthetic-database');require('../electron/storage').createJson(dataDir,{data:{vehicles:[],records:[]}});fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({users:[{name:'SYNTHETIC PDF component',dataDir}],activeUser:0,networkMode:'local',networkKey:'synthetic-pdf-component-key',remoteHost:'127.0.0.1',remotePort:3377,serverPort:3377}));let app;
 try{app=await pw._electron.launch({executablePath:executable,args:['--user-data-dir='+profile,'--tvs-test-hidden'],cwd:ROOT});await app.firstWindow();assert.equal(await app.evaluate(({app})=>app.getPath('userData')),profile);
  return await app.evaluate(async({app,BrowserWindow,session},configuration)=>{
   const path=process.getBuiltinModule('node:path'),fs=process.getBuiltinModule('node:fs'),load=process.getBuiltinModule('node:module').createRequire(path.join(app.getAppPath(),'package.json')),modulePath=load.resolve('./electron/safe-html-pdf.cjs'),{createSafeHtmlPdfRenderer}=load('./electron/safe-html-pdf.cjs'),initial=BrowserWindow.getAllWindows().length,result={appPath:app.getAppPath(),modulePath,executable:process.execPath,initialWindows:initial},render=createSafeHtmlPdfRenderer({BrowserWindow,session,timeoutMs:15000});
   const bytes=await render(configuration.html,{pageSize:'A4'});fs.writeFileSync(path.join(configuration.directory,'rendered.pdf'),bytes);result.bytes=bytes.length;result.windowsRemaining=BrowserWindow.getAllWindows().length-initial;
   let revoked=false;const markRevoked=(_event,window)=>window.webContents.once('did-finish-load',()=>{revoked=true;});app.on('browser-window-created',markRevoked);
   try{await render(configuration.html,{},()=>{if(revoked)throw Object.assign(Error('Synthetic context revoked'),{code:'SESSION_CHANGED'});});result.revokedSucceeded=true;}catch(error){result.revokedCode=error.code;}finally{app.removeListener('browser-window-created',markRevoked);}result.windowsAfterRevocation=BrowserWindow.getAllWindows().length-initial;
   revoked=false;function RevokingPrintWindow(options){const window=new BrowserWindow(options),print=window.webContents.printToPDF.bind(window.webContents);window.webContents.printToPDF=async options=>{const bytes=await print(options);revoked=true;return bytes;};return window;}
   const afterPrint=createSafeHtmlPdfRenderer({BrowserWindow:RevokingPrintWindow,session,timeoutMs:15000});try{await afterPrint(configuration.html,{},()=>{if(revoked)throw Object.assign(Error('Synthetic context revoked after print'),{code:'SESSION_CHANGED'});});result.revokedAfterPrintSucceeded=true;}catch(error){result.revokedAfterPrintCode=error.code;}result.windowsAfterPrintedRevocation=BrowserWindow.getAllWindows().length-initial;result.allHidden=BrowserWindow.getAllWindows().every(window=>!window.isVisible());return result;
  },{directory,html});
 }finally{if(app){await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(window=>window.destroy())).catch(()=>{});await app.close().catch(()=>{});}}
}
test('actual hidden Electron PDF never executes hostile markup or loads remote/local resources and destroys revoked windows',{timeout:process.env.TVS_PACKAGED_EXE?120000:60000},async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-safe-html-security-'));
 t.after(()=>{const resolved=path.resolve(directory);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.match(path.basename(resolved),/^tvs-safe-html-security-/);fs.rmSync(resolved,{recursive:true,force:true});});
 const requests=[],server=http.createServer((req,res)=>{requests.push(req.url);res.writeHead(200,{'Content-Type':'text/html'});res.end('<p>REMOTE_SECRET_MARKER</p>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const remote='http://127.0.0.1:'+server.address().port,privateFile=path.join(directory,'synthetic-private.html');fs.writeFileSync(privateFile,'<!doctype html><p>LOCAL_SECRET_MARKER</p>');
 const local=pathToFileURL(privateFile).href;
 const html='<!doctype html><img src="'+remote+'/pre-head"><head><meta http-equiv="Content-Security-Policy" content="default-src *"><base href="'+remote+'/"><style>@import url("'+remote+'/css");body{background:url("'+remote+'/background")}</style></head><body onload="document.body.append(\'ONLOAD_EXECUTED_MARKER\')"><p>VISIBLE_LITERAL_MARKER</p><script>document.body.append("SCRIPT_EXECUTED_MARKER");fetch("'+remote+'/script");</script><iframe src="'+local+'"></iframe><object data="'+local+'"></object><iframe src="'+remote+'/frame"></iframe><img src="'+remote+'/image"><img src="'+local+'"></body>';
 fs.mkdirSync(path.join(directory,'profile'));fs.mkdirSync(path.join(directory,'session'));
 let result;
 if(process.env.TVS_PACKAGED_EXE){result=await packagedResult(directory,html,process.env.TVS_PACKAGED_EXE);assert.equal(path.basename(result.appPath),'app.asar');assert.equal(result.modulePath,path.join(result.appPath,'electron/safe-html-pdf.cjs'));assert.equal(path.resolve(result.executable).toLowerCase(),path.resolve(process.env.TVS_PACKAGED_EXE).toLowerCase());assert.ok(result.initialWindows>=1);assert.equal(result.allHidden,true);}
 else{
 const configuration={directory,html,rendererPath:process.env.TVS_SECURITY_RENDERER_MODULE||path.join(ROOT,'electron/safe-html-pdf.cjs')},configurationPath=path.join(directory,'fixture.json');fs.writeFileSync(configurationPath,JSON.stringify(configuration));
 const environment={...process.env};delete environment.ELECTRON_RUN_AS_NODE;
 const executable=require('electron'),bootstrap=path.join(__dirname,'helpers/safe-html-pdf-electron-bootstrap.cjs');
 let output='';const child=spawn(executable,[bootstrap,'--user-data-dir='+path.join(directory,'profile'),'--security-fixture='+configurationPath],{env:environment,windowsHide:true,stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',chunk=>{if(output.length<32000)output+=chunk;});child.stderr.on('data',chunk=>{if(output.length<32000)output+=chunk;});
 let timeout=false;const timer=setTimeout(()=>{timeout=true;child.kill();},45000);
 const exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);}).finally(()=>clearTimeout(timer));
 assert.equal(timeout,false,'Hidden synthetic Electron timed out\n'+output);const resultPath=path.join(directory,'result.json');assert.ok(fs.existsSync(resultPath),'Synthetic Electron exited before result; code='+exitCode+'\n'+output);result=JSON.parse(fs.readFileSync(resultPath,'utf8'));assert.equal(exitCode,0,JSON.stringify(result)+'\n'+output);
 }
 assert.equal(result.error,undefined);assert.ok(result.bytes>100);assert.equal(result.windowsRemaining,0);assert.equal(result.revokedCode,'SESSION_CHANGED');assert.notEqual(result.revokedSucceeded,true);assert.equal(result.windowsAfterRevocation,0);assert.equal(result.revokedAfterPrintCode,'SESSION_CHANGED');assert.notEqual(result.revokedAfterPrintSucceeded,true);assert.equal(result.windowsAfterPrintedRevocation,0);assert.deepEqual(requests,[],'No remote resource request may reach even the synthetic loopback endpoint');
 const {loadPdfJs,pdfDocumentOptions}=require(path.join(ROOT,'electron/pdfjs-runtime.cjs')),{getDocument}=await loadPdfJs();let task;
 try{task=getDocument({...pdfDocumentOptions(),data:new Uint8Array(fs.readFileSync(path.join(directory,'rendered.pdf')))});const document=await task.promise,text=[];for(let index=1;index<=document.numPages;index++){const page=await document.getPage(index);text.push((await page.getTextContent()).items.map(item=>item.str).join(' '));}const literal=text.join('\n');assert.match(literal,/VISIBLE_LITERAL_MARKER/);for(const marker of ['REMOTE_SECRET_MARKER','LOCAL_SECRET_MARKER','SCRIPT_EXECUTED_MARKER','ONLOAD_EXECUTED_MARKER'])assert.equal(literal.includes(marker),false,marker);}
 finally{await task?.destroy();}
});
