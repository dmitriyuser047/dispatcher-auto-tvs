'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {ROOT}=require('./helpers/source-harness.cjs');
const rendererPath=process.env.TVS_SECURITY_RENDERER_MODULE||path.join(ROOT,'electron/safe-html-pdf.cjs');
const {createSafeHtmlPdfRenderer}=require(rendererPath);
function fixture(options={}){
 const seen={windows:[],partitions:[],requests:[],cleared:0,destroyed:0,loads:0,prints:0},isolated={setPermissionRequestHandler(fn){seen.permission=fn;if(options.setupFailure)throw Error('Synthetic permission setup failure');},setPermissionCheckHandler(fn){seen.permissionCheck=fn;},webRequest:{onBeforeRequest(filter,fn){seen.requests.push({filter,fn});}},async clearStorageData(){seen.cleared++;if(options.clearFailure)throw Error('Synthetic session clear failure');}};
 class Window{constructor(configuration){seen.configuration=configuration;if(options.constructorFailure)throw Error('Synthetic constructor failure');this.destroyed=false;seen.windows.push(this);this.webContents={setWindowOpenHandler(fn){seen.popup=fn;},on(name,fn){seen[name]=fn;},async printToPDF(value){seen.prints++;seen.printOptions=value;if(options.printHang)return new Promise(()=>{});if(options.printFailure)throw Error('Synthetic print failure');options.onPrinted?.();return options.bytes||Buffer.from('%PDF-1.7\nSynthetic security output');}};}async loadURL(url){seen.loads++;seen.url=url;if(options.loadHang)return new Promise(()=>{});if(options.loadFailure)throw Error('Synthetic load failure');options.onLoaded?.();}isDestroyed(){return this.destroyed;}destroy(){this.destroyed=true;seen.destroyed++;}}
 const render=createSafeHtmlPdfRenderer({BrowserWindow:Window,session:{fromPartition(name,configuration){seen.partitions.push({name,configuration});return isolated;}},timeoutMs:options.timeoutMs||1000,maxHtmlBytes:options.maxHtmlBytes||1024*1024});return {seen,render};
}
const malicious='<!doctype html><img src="https://attacker.invalid/pre-head"><head><meta http-equiv="Content-Security-Policy" content="default-src *"><base href="file:///C:/"><script>require("electron").ipcRenderer.invoke("save-settings",{});fetch("http://attacker.invalid");</script></head><body onload="attack()"><iframe src="file:///C:/synthetic-private.html"></iframe><object data="https://attacker.invalid/object"></object><form action="https://attacker.invalid/upload"></form><img src="file:///C:/synthetic-private.png"><p>Visible synthetic literal</p></body>';
test('malicious HTML receives a leading restrictive CSP and an isolated scriptless window with no preload or filesystem/network gateway',async()=>{
 const {seen,render}=fixture();const bytes=await render(malicious,{landscape:true,pageSize:'A4',preferCSSPageSize:true});assert.match(bytes.toString(),/^%PDF-/);const prefs=seen.configuration.webPreferences;assert.equal(seen.configuration.show,false);assert.equal(prefs.javascript,false);assert.equal(prefs.nodeIntegration,false);assert.equal(prefs.contextIsolation,true);assert.equal(prefs.sandbox,true);assert.equal(prefs.webSecurity,true);assert.equal(prefs.webviewTag,false);assert.equal(prefs.allowRunningInsecureContent,false);assert.equal(prefs.preload,undefined);assert.ok(prefs.session);
 assert.equal(seen.partitions[0].configuration.cache,false);assert.equal(seen.partitions[0].name.startsWith('persist:'),false);const html=decodeURIComponent(seen.url.slice('data:text/html;charset=utf-8,'.length));assert.ok(html.indexOf('Content-Security-Policy')<html.indexOf('attacker.invalid/pre-head'));for(const rule of ["default-src 'none'","script-src 'none'","connect-src 'none'","frame-src 'none'","object-src 'none'","form-action 'none'","base-uri 'none'"])assert.ok(html.includes(rule),rule);assert.equal(seen.printOptions.landscape,true);assert.equal(seen.printOptions.pageSize,'A4');assert.equal(seen.destroyed,1);assert.equal(seen.cleared,1);
});
test('actual renderer denial handlers reject remote/file requests, permissions, popups and navigation before cleanup detaches them',async()=>{
 const {seen,render}=fixture();await render(malicious);const interceptor=seen.requests.find(entry=>typeof entry.fn==='function');assert.ok(interceptor);for(const url of ['https://attacker.invalid/exfil','http://127.0.0.1:3377/api/data','file:///C:/synthetic-private','ftp://attacker.invalid/file']){let response;interceptor.fn({url},value=>response=value);assert.equal(response.cancel,true,url);}for(const permission of ['camera','microphone','clipboard-read','filesystem']){let answer;seen.permission(null,permission,value=>answer=value);assert.equal(answer,false);assert.equal(seen.permissionCheck(null,permission),false);}assert.equal(seen.popup({url:'https://attacker.invalid'}).action,'deny');let prevented=0;seen['will-navigate']({preventDefault(){prevented++;}},'file:///C:/synthetic-private');assert.equal(prevented,1);assert.equal(seen.requests.at(-1).filter,null);
});
test('parallel renders use distinct nonpersistent partitions and cannot reuse one another\'s state',async()=>{
 const a=fixture(),b=fixture();await Promise.all([a.render('<p>A</p>'),b.render('<p>B</p>')]);assert.notEqual(a.seen.partitions[0].name,b.seen.partitions[0].name);assert.equal(a.seen.cleared,1);assert.equal(b.seen.cleared,1);
});
test('bounded UTF-8 HTML, primitive types and immutable print-option capabilities reject before opening a window/session',async()=>{
 for(const value of ['',null,{},[],Buffer.from('html'),'<p>'+('Ж'.repeat(100))+'</p>']){const {seen,render}=fixture({maxHtmlBytes:128});await assert.rejects(render(value));assert.equal(seen.windows.length,0);assert.equal(seen.partitions.length,0);}for(const options of [{javascript:true},{preload:'attacker.cjs'},{pageSize:'Letter'},{landscape:'true'},{preferCSSPageSize:1},{session:{}}]){const {seen,render}=fixture();await assert.rejects(render('<p>safe</p>',options));assert.equal(seen.windows.length,0);assert.equal(seen.partitions.length,0);}
});
test('load/print/constructor/magic failures and both timeout phases destroy windows and release their isolated sessions',async()=>{
 for(const options of [{loadFailure:true},{printFailure:true},{constructorFailure:true},{bytes:Buffer.from('NOT-PDF')},{loadHang:true,timeoutMs:10},{printHang:true,timeoutMs:10},{clearFailure:true}]){const {seen,render}=fixture(options);if(options.clearFailure)await render('<p>safe</p>');else await assert.rejects(render('<p>safe</p>'));assert.equal(seen.destroyed,options.constructorFailure?0:1);assert.equal(seen.cleared,1);assert.equal(seen.requests.at(-1).filter,null);if(options.loadHang)assert.equal(seen.prints,0);}
});
test('revoked print context cannot open a window, enter print after load or return bytes after printing',async()=>{
 for(const phase of ['initial','loaded','printed']){
  let revoked=phase==='initial',returned=false;
  const {seen,render}=fixture({onLoaded(){if(phase==='loaded')revoked=true;},onPrinted(){if(phase==='printed')revoked=true;}});
  const guard=()=>{if(revoked)throw Object.assign(Error('Synthetic session revoked'),{code:'SESSION_CHANGED'});};
  await assert.rejects(render(malicious,{},guard).then(value=>{returned=true;return value;}),error=>error.code==='SESSION_CHANGED');
  assert.equal(returned,false,phase);assert.equal(seen.prints,phase==='printed'?1:0,phase);
  assert.equal(seen.windows.length,phase==='initial'?0:1,phase);assert.equal(seen.partitions.length,phase==='initial'?0:1,phase);
  assert.equal(seen.destroyed,phase==='initial'?0:1,phase);assert.equal(seen.cleared,phase==='initial'?0:1,phase);
 }
});
test('invalid context guards reject before allocation and failed isolated-session setup still releases its session',async()=>{
 for(const guard of [null,true,{},'guard']){const {seen,render}=fixture();await assert.rejects(render('<p>safe</p>',{},guard));assert.equal(seen.windows.length,0);assert.equal(seen.partitions.length,0);}
 const {seen,render}=fixture({setupFailure:true});await assert.rejects(render('<p>safe</p>'),/Synthetic permission setup failure/);assert.equal(seen.windows.length,0);assert.equal(seen.cleared,1);assert.equal(seen.requests.at(-1).filter,null);
});
