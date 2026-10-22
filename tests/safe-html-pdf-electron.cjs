'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),{spawn}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {ROOT}=require('./helpers/source-harness.cjs');
test('actual hidden Electron PDF never executes hostile markup or loads remote/local resources and destroys revoked windows',{timeout:60000},async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-safe-html-security-'));
 t.after(()=>{const resolved=path.resolve(directory);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.match(path.basename(resolved),/^tvs-safe-html-security-/);fs.rmSync(resolved,{recursive:true,force:true});});
 const requests=[],server=http.createServer((req,res)=>{requests.push(req.url);res.writeHead(200,{'Content-Type':'text/html'});res.end('<p>REMOTE_SECRET_MARKER</p>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const remote='http://127.0.0.1:'+server.address().port,privateFile=path.join(directory,'synthetic-private.html');fs.writeFileSync(privateFile,'<!doctype html><p>LOCAL_SECRET_MARKER</p>');
 const local=pathToFileURL(privateFile).href;
 const html='<!doctype html><img src="'+remote+'/pre-head"><head><meta http-equiv="Content-Security-Policy" content="default-src *"><base href="'+remote+'/"><style>@import url("'+remote+'/css");body{background:url("'+remote+'/background")}</style></head><body onload="document.body.append(\'ONLOAD_EXECUTED_MARKER\')"><p>VISIBLE_LITERAL_MARKER</p><script>document.body.append("SCRIPT_EXECUTED_MARKER");fetch("'+remote+'/script");</script><iframe src="'+local+'"></iframe><object data="'+local+'"></object><iframe src="'+remote+'/frame"></iframe><img src="'+remote+'/image"><img src="'+local+'"></body>';
 fs.mkdirSync(path.join(directory,'profile'));fs.mkdirSync(path.join(directory,'session'));
 const configuration={directory,html,rendererPath:process.env.TVS_SECURITY_RENDERER_MODULE||path.join(ROOT,'electron/safe-html-pdf.cjs')},configurationPath=path.join(directory,'fixture.json');fs.writeFileSync(configurationPath,JSON.stringify(configuration));
 const environment={...process.env};delete environment.ELECTRON_RUN_AS_NODE;
 const executable=require('electron'),bootstrap=path.join(__dirname,'helpers/safe-html-pdf-electron-bootstrap.cjs');
 let output='';const child=spawn(executable,[bootstrap,'--user-data-dir='+path.join(directory,'profile'),'--security-fixture='+configurationPath],{env:environment,windowsHide:true,stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',chunk=>{if(output.length<32000)output+=chunk;});child.stderr.on('data',chunk=>{if(output.length<32000)output+=chunk;});
 let timeout=false;const timer=setTimeout(()=>{timeout=true;child.kill();},45000);
 const exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);}).finally(()=>clearTimeout(timer));
 assert.equal(timeout,false,'Hidden synthetic Electron timed out\n'+output);const resultPath=path.join(directory,'result.json');assert.ok(fs.existsSync(resultPath),'Synthetic Electron exited before result; code='+exitCode+'\n'+output);const result=JSON.parse(fs.readFileSync(resultPath,'utf8'));assert.equal(exitCode,0,JSON.stringify(result)+'\n'+output);assert.equal(result.error,undefined);assert.ok(result.bytes>100);assert.equal(result.windowsRemaining,0);assert.equal(result.revokedCode,'SESSION_CHANGED');assert.notEqual(result.revokedSucceeded,true);assert.equal(result.windowsAfterRevocation,0);assert.equal(result.revokedAfterPrintCode,'SESSION_CHANGED');assert.notEqual(result.revokedAfterPrintSucceeded,true);assert.equal(result.windowsAfterPrintedRevocation,0);assert.deepEqual(requests,[],'No remote resource request may reach even the synthetic loopback endpoint');
 const {loadPdfJs,pdfDocumentOptions}=require(path.join(ROOT,'electron/pdfjs-runtime.cjs')),{getDocument}=await loadPdfJs();let task;
 try{task=getDocument({...pdfDocumentOptions(),data:new Uint8Array(fs.readFileSync(path.join(directory,'rendered.pdf')))});const document=await task.promise,text=[];for(let index=1;index<=document.numPages;index++){const page=await document.getPage(index);text.push((await page.getTextContent()).items.map(item=>item.str).join(' '));}const literal=text.join('\n');assert.match(literal,/VISIBLE_LITERAL_MARKER/);for(const marker of ['REMOTE_SECRET_MARKER','LOCAL_SECRET_MARKER','SCRIPT_EXECUTED_MARKER','ONLOAD_EXECUTED_MARKER'])assert.equal(literal.includes(marker),false,marker);}
 finally{await task?.destroy();}
});
