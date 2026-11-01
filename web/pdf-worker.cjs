'use strict';

// A disposable server-only Electron process. The retained print renderer creates
// a hidden sandbox, disables script execution and blocks every external request.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {app,BrowserWindow,session}=require('electron');
const job=process.argv[2],base=fs.realpathSync.native(os.tmpdir());
if(typeof job!=='string'||path.dirname(path.resolve(job))!==base||!/^tvs-web-document-[A-Za-z0-9]+$/.test(path.basename(job))||fs.lstatSync(job).isSymbolicLink())app.exit(2);
app.setPath('userData',path.join(job,'profile'));app.setPath('sessionData',path.join(job,'session'));
app.commandLine.appendSwitch('disable-gpu');app.commandLine.appendSwitch('no-first-run');
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
  try{
    const safe=require('../electron/safe-file.cjs'),input=JSON.parse(safe.readRegularFileSync(path.join(job,'input.json'),{maxBytes:36*1024*1024}).toString('utf8'));
    const bytes=await require('../electron/safe-html-pdf.cjs').createSafeHtmlPdfRenderer({BrowserWindow,session,timeoutMs:45000})(input.html,input.options);
    fs.writeFileSync(path.join(job,'output.pdf'),bytes,{flag:'wx',mode:0o600});app.exit(0);
  }catch{app.exit(1);}
}).catch(()=>app.exit(1));
