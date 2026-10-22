'use strict';
// Standalone synthetic Electron entry: never imports production main/settings/storage.
const {app,BrowserWindow,session}=require('electron'),fs=require('node:fs'),path=require('node:path');
const configArg=process.argv.find(value=>value.startsWith('--security-fixture='));
if(!configArg)throw Error('Missing synthetic fixture');
const config=JSON.parse(fs.readFileSync(configArg.slice('--security-fixture='.length),'utf8'));
if(!path.isAbsolute(config.directory)||!/^tvs-safe-html-security-/.test(path.basename(config.directory)))throw Error('Invalid synthetic directory');
app.setPath('userData',path.join(config.directory,'profile'));
app.setPath('sessionData',path.join(config.directory,'session'));
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
 const result={};
 try{
  const {createSafeHtmlPdfRenderer}=require(config.rendererPath),render=createSafeHtmlPdfRenderer({BrowserWindow,session,timeoutMs:15000});
  const bytes=await render(config.html,{pageSize:'A4'});
  fs.writeFileSync(path.join(config.directory,'rendered.pdf'),bytes);
  result.bytes=bytes.length;result.windowsRemaining=BrowserWindow.getAllWindows().length;
  let revoked=false;
  const markRevoked=(_event,win)=>win.webContents.once('did-finish-load',()=>{revoked=true;});
  app.on('browser-window-created',markRevoked);
  try{await render(config.html,{},()=>{if(revoked)throw Object.assign(Error('Synthetic context revoked'),{code:'SESSION_CHANGED'});});result.revokedSucceeded=true;}
  catch(error){result.revokedCode=error.code;}
  finally{app.removeListener('browser-window-created',markRevoked);}
  result.windowsAfterRevocation=BrowserWindow.getAllWindows().length;
  revoked=false;
  function RevokingPrintWindow(configuration){const win=new BrowserWindow(configuration),print=win.webContents.printToPDF.bind(win.webContents);win.webContents.printToPDF=async options=>{const bytes=await print(options);revoked=true;return bytes;};return win;}
  const renderRevokedAfterPrint=createSafeHtmlPdfRenderer({BrowserWindow:RevokingPrintWindow,session,timeoutMs:15000});
  try{await renderRevokedAfterPrint(config.html,{},()=>{if(revoked)throw Object.assign(Error('Synthetic context revoked after print'),{code:'SESSION_CHANGED'});});result.revokedAfterPrintSucceeded=true;}
  catch(error){result.revokedAfterPrintCode=error.code;}
  result.windowsAfterPrintedRevocation=BrowserWindow.getAllWindows().length;
  fs.writeFileSync(path.join(config.directory,'result.json'),JSON.stringify(result));app.exit(0);
 }catch(error){fs.writeFileSync(path.join(config.directory,'result.json'),JSON.stringify({error:String(error.stack||error)}));app.exit(1);}
}).catch(error=>{fs.writeFileSync(path.join(config.directory,'result.json'),JSON.stringify({error:String(error.stack||error)}));app.exit(1);});
