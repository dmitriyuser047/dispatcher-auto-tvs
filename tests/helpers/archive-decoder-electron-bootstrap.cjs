'use strict';
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),{fork}=require('node:child_process');
const argument=process.argv.find(value=>value.startsWith('--archive-fixture='));if(!argument)throw Error('Missing synthetic fixture');const configuration=JSON.parse(fs.readFileSync(argument.slice('--archive-fixture='.length),'utf8'));
if(!path.isAbsolute(configuration.directory)||!/^tvs-archive-electron-/.test(path.basename(configuration.directory)))throw Error('Invalid synthetic directory');
app.setPath('userData',path.join(configuration.directory,'profile'));app.setPath('sessionData',path.join(configuration.directory,'session'));app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{const result={};try{const decoder=require('../../electron/archive-decoder.cjs'),{rarStored}=require('./archive-fixture.cjs'),value=Buffer.from('SYNTHETIC RAR BYTES');let exit;
 const extract=decoder.createArchiveDecoder({forkProcess(...args){const child=fork(...args);exit=new Promise(resolve=>child.once('exit',resolve));return child;}});
 const entries=await extract(rarStored('synthetic.json',value));await exit;result.exact=entries.length===1&&entries[0].bytes.equals(value);
 const probe=decoder.createArchiveDecoder({workerPath:path.join(__dirname,'archive-memory-probe.cjs')});result.memory=JSON.parse((await probe(Buffer.from('probe')))[0].bytes.toString('utf8'));
 const child=fork(path.join(__dirname,'archive-supervisor-probe.cjs'),[],{execPath:process.execPath,execArgv:[...decoder.EXEC_ARGS],env:{ELECTRON_RUN_AS_NODE:'1',SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP},windowsHide:true,serialization:'advanced',stdio:['ignore','ignore','ignore','ipc']});let timer;
 try{const exited=new Promise(resolve=>child.once('exit',code=>resolve(code)));await new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('Synthetic WASM thread failed to start')),10000);child.once('error',reject);child.on('message',message=>{if(message?.kind==='synthetic-inner-running'){clearTimeout(timer);resolve();}});child.send({kind:'decode',id:'synthetic-disconnect',bytes:Buffer.from('probe'),limits:decoder.DEFAULT_LIMITS});});const started=Date.now();child.disconnect();timer=setTimeout(()=>child.kill('SIGKILL'),3000);result.disconnectExit=await exited;result.disconnectMs=Date.now()-started;}
 finally{clearTimeout(timer);try{child.kill('SIGKILL');}catch{}}
 result.windows=BrowserWindow.getAllWindows().length;fs.writeFileSync(path.join(configuration.directory,'result.json'),JSON.stringify(result));app.exit(0);
 }catch(error){fs.writeFileSync(path.join(configuration.directory,'result.json'),JSON.stringify({error:String(error.stack||error)}));app.exit(1);}});
