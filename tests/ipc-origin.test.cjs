'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {ROOT,ipcWrapper,source}=require('./helpers/source-harness.cjs'),security=require(path.join(ROOT,'electron/security.js'));
function fixture(channel='write-sections'){
 const listeners=new Map(),calls=[],context={ipcMain:{},handle:(name,listener)=>listeners.set(name,listener),path,__dirname:path.join(ROOT,'electron'),app:{_localServerPort:8123},...security};vm.runInNewContext(ipcWrapper(),context,{filename:path.join(ROOT,'electron/main.js')});context.ipcMain.handle(channel,(_event,payload)=>{calls.push(payload);return 'trusted-listener';});return {invoke:(event,payload)=>listeners.get(channel)(event,payload),calls};
}
function event(url='http://127.0.0.1:8123/index.html',child=false){const frame={url};return {sender:{mainFrame:frame},senderFrame:child?{url}:frame};}
test('actual main IPC boundary refuses malicious HTML/data/file origins, sibling ports and iframes before any privileged listener',()=>{
 for(const channel of ['write-sections','save-settings','export-pdf']){const f=fixture(channel);for(const entry of [event('data:text/html,<img onerror=attack()>'),event('https://attacker.invalid/index.html'),event('http://127.0.0.1:8124/index.html'),event('http://localhost:8123/index.html'),event('http://127.0.0.1:8123/index.html#injected'),event('http://127.0.0.1:8123/index.html?injected'),event('http://127.0.0.1:8123/index.html',true),event(pathToFileURL(path.join(ROOT,'index.html')).href)])assert.throws(()=>f.invoke(entry,{html:'<script>attack()</script>'}));assert.deepEqual(f.calls,[]);assert.equal(f.invoke(event(),{synthetic:true}),'trusted-listener');assert.equal(f.calls.length,1);}
});
test('actual main IPC boundary keeps registry/PDF windows outside settings, database saves and legacy HTML export',()=>{
 for(const channel of ['save-settings','write-data','write-sections','execute-command','export-pdf'])for(const page of ['reestr-window.html','pdf-editor.html']){const f=fixture(channel);assert.throws(()=>f.invoke(event(pathToFileURL(path.join(ROOT,page)).href),{}));assert.equal(f.calls.length,0);}
 for(const [channel,page]of [['reestr-save-rows','reestr-window.html'],['pdf-studio-export','pdf-editor.html']]){const f=fixture(channel);assert.equal(f.invoke(event(pathToFileURL(path.join(ROOT,page)).href),{}),'trusted-listener');}
});
test('actual preload forwards malicious HTML only as data through the fixed export channel and exposes no raw IPC gateway',async()=>{
 let exposed;const calls=[];vm.runInNewContext(source('electron/preload.js'),{require:name=>{assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld(name,value){if(name==='electronAPI')exposed=value;}},ipcRenderer:{invoke(channel,...args){calls.push({channel,args});return Promise.resolve({ok:true});},on(){},removeListener(){}}};}},{filename:path.join(ROOT,'electron/preload.js')});
 assert.ok(exposed);for(const field of ['ipcRenderer','invoke','send','require','exec','eval'])assert.equal(exposed[field],undefined);const html='<script>window.electronAPI.saveSettings({networkMode:"server"})</script><img onerror="attack()">';await exposed.exportPdf(html,'synthetic.pdf');assert.equal(calls.length,1);assert.equal(calls[0].channel,'export-pdf');assert.equal(calls[0].args[0].html,html);assert.equal(calls[0].args[0].defaultFileName,'synthetic.pdf');
});
