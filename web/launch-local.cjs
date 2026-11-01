'use strict';
// A short-lived launcher; the server owns its own hidden process and logs.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),safe=require('../electron/safe-file.cjs');
const fail=(code,message)=>Object.assign(Error(message),{code});
function parseArgs(argv){
  let configPath,noOpen=false;
  for(let i=0;i<argv.length;i++){
    if(argv[i]==='--no-open'&&!noOpen){noOpen=true;continue;}
    if(argv[i]==='--config'&&!configPath&&typeof argv[i+1]==='string'&&!argv[i+1].startsWith('--')){configPath=argv[++i];continue;}
    throw fail('WEB_LAUNCH_ARGUMENT','Запуск: node web/launch-local.cjs --config ABSOLUTE_CONFIG_JSON [--no-open]');
  }
  if(!configPath||!path.isAbsolute(configPath)||configPath.includes('\0'))throw fail('WEB_LAUNCH_ARGUMENT','Укажите абсолютный путь конфигурации через --config.');
  return {configPath:path.resolve(configPath),noOpen};
}
function isReady(port,{timeoutMs=1000}={}){
  return new Promise(resolve=>{
    let done=false;const finish=value=>{if(!done){done=true;resolve(value);}};
    const req=http.get({hostname:'127.0.0.1',port,path:'/login',agent:false},res=>{
      if(res.statusCode!==200||!String(res.headers['content-type']).startsWith('text/html')){res.resume();finish(false);return;}
      let text='',size=0;res.setEncoding('utf8');res.on('data',chunk=>{size+=Buffer.byteLength(chunk);if(size>256*1024){res.destroy();finish(false);}else text+=chunk;});
      res.on('error',()=>finish(false));res.on('end',()=>finish(/\bid=["']webLoginForm["']/.test(text)));
    });
    req.setTimeout(timeoutMs,()=>{req.destroy();finish(false);});req.on('error',()=>finish(false));
  });
}
function openBrowser(url){
  return new Promise((resolve,reject)=>{
    const executable=process.platform==='win32'?path.join(process.env.SystemRoot||'C:\\Windows','System32','rundll32.exe'):process.platform==='darwin'?'open':'xdg-open';
    const args=process.platform==='win32'?['url.dll,FileProtocolHandler',url]:[url];
    const child=spawn(executable,args,{shell:false,detached:true,windowsHide:true,stdio:'ignore'});
    child.once('error',()=>reject(fail('WEB_BROWSER_OPEN','Сервер работает. Откройте в браузере: '+url)));
    child.once('spawn',()=>{child.unref();resolve();});
  });
}
function launchLock(stateDir){
  const directory=safe.verifiedDirectory(stateDir,{create:true}),file=path.join(stateDir,'.web-launch.lock'),recovery=file+'.recovery';
  const owner={format:'tvs-web-launch',version:1,host:os.hostname(),pid:process.pid,nonce:crypto.randomBytes(16).toString('hex')};
  const same=(a,b)=>a?.format==='tvs-web-launch'&&a.version===1&&a.host===b.host&&a.pid===b.pid&&a.nonce===b.nonce;
  const read=filename=>{try{return JSON.parse(safe.readRegularFileSync(filename,{maxBytes:4096}));}catch{return null;}};
  const dead=value=>{if(value?.format!=='tvs-web-launch'||value.version!==1||value.host!==owner.host||!Number.isSafeInteger(value.pid)||value.pid<1||typeof value.nonce!=='string'||!/^[a-f0-9]{32}$/.test(value.nonce))return false;try{process.kill(value.pid,0);return false;}catch(error){return error.code==='ESRCH';}};
  const write=filename=>{safe.assertDirectory(directory);const fd=fs.openSync(filename,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(owner));fs.fsyncSync(fd);return fd;}catch(error){fs.closeSync(fd);throw error;}};
  const busy=()=>fail('WEB_LAUNCH_BUSY','Запуск уже выполняется. Подождите немного и запустите ещё раз.');
  let fd;
  try{fd=write(file);}catch(error){
    if(error.code!=='EEXIST')throw error;
    const previous=read(file);if(!dead(previous))throw busy();
    let guard;try{guard=write(recovery);}catch(error){if(error.code==='EEXIST')throw busy();throw error;}
    try{const current=read(file);if(!same(current,previous)||!dead(current))throw busy();safe.assertDirectory(directory);fs.unlinkSync(file);fd=write(file);}
    finally{fs.closeSync(guard);if(same(read(recovery),owner))fs.unlinkSync(recovery);}
  }
  let closed=false;
  return {
    child(pid){if(!Number.isSafeInteger(pid)||pid<1)return;owner.pid=pid;fs.ftruncateSync(fd,0);fs.writeSync(fd,JSON.stringify(owner),0,'utf8');fs.fsyncSync(fd);},
    close(keep=false){if(closed)return;closed=true;fs.closeSync(fd);if(!keep&&same(read(file),owner)){safe.assertDirectory(directory);fs.unlinkSync(file);}},
  };
}
function logFile(stateDir,name){
  const filename=path.join(stateDir,name);let previous;
  try{previous=fs.lstatSync(filename);if(!previous.isFile()||previous.isSymbolicLink()||previous.nlink!==1)throw fail('WEB_LAUNCH_LOG','Недопустимый файл журнала запуска.');}catch(error){if(error.code!=='ENOENT')throw error;}
  const fd=fs.openSync(filename,'a',0o600),stat=fs.fstatSync(fd);
  if(!stat.isFile()||stat.nlink!==1){fs.closeSync(fd);throw fail('WEB_LAUNCH_LOG','Недопустимый файл журнала запуска.');}
  return fd;
}
async function launchLocal(configPath,{noOpen=false,timeoutMs=120000,pollMs=250,dependencies={}}={}){
  const deps={buildRuntime:require('./local-runtime.cjs').buildRuntime,isReady,spawn,openBrowser,now:Date.now,sleep:ms=>new Promise(resolve=>setTimeout(resolve,ms)),write:message=>process.stdout.write(message),...dependencies};
  const runtime=deps.buildRuntime(configPath),{port,stateDir}=runtime.config,url='http://127.0.0.1:'+port+'/objects';
  // The outbox owns every entry in stateDir. Launcher files belong beside the
  // protected configuration and must never enter that dedicated queue root.
  const controlDir=path.join(path.dirname(runtime.configPath),'launch');
  const inside=(parent,target)=>{const fold=value=>process.platform==='win32'?value.toLowerCase():value;const relative=path.relative(fold(path.resolve(parent)),fold(path.resolve(target)));return relative===''||!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep);};
  if(inside(stateDir,controlDir)||inside(controlDir,stateDir))throw fail('WEB_LAUNCH_PATH','Каталог запуска должен храниться отдельно от состояния очереди операций.');
  if(!Number.isSafeInteger(port)||port<1||port>65535)throw fail('WEB_LAUNCH_PORT','Для запуска укажите постоянный локальный порт от 1 до 65535.');
  if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>120000||!Number.isFinite(pollMs)||pollMs<1)throw TypeError('Invalid launcher timing');
  const open=async()=>{if(!noOpen)await deps.openBrowser(url);};
  if(await deps.isReady(port)){deps.write('Веб-диспетчер уже работает: '+url+'\n');await open();return {url,alreadyRunning:true};}
  let lock;
  try{lock=launchLock(controlDir);}catch(error){if(error.code==='WEB_LAUNCH_BUSY'&&await deps.isReady(port)){await open();return {url,alreadyRunning:true};}throw error;}
  let child,failed=false,ready=false;
  const logPath=path.join(controlDir,'server.stderr.log');
  try{
    if(await deps.isReady(port)){ready=true;await open();return {url,alreadyRunning:true};}
    deps.write('Запускаю веб-диспетчер. Проверка базы и резервной копии может занять некоторое время.\n');
    let outFd,errFd;
    try{
      outFd=logFile(controlDir,'server.stdout.log');errFd=logFile(controlDir,'server.stderr.log');
      child=deps.spawn(process.execPath,[path.join(__dirname,'local-runtime.cjs'),'--config',runtime.configPath],{cwd:path.resolve(__dirname,'..'),shell:false,detached:true,windowsHide:true,stdio:['ignore',outFd,errFd]});
      child.once('error',()=>{failed=true;});child.once('exit',()=>{failed=true;});lock.child(child.pid);child.unref();
    }catch{failed=true;throw fail('WEB_LAUNCH_FAILED','Сервер не запущен. Журнал: '+logPath);}
    finally{if(outFd!==undefined)fs.closeSync(outFd);if(errFd!==undefined)fs.closeSync(errFd);}
    const deadline=deps.now()+timeoutMs;
    while(deps.now()<deadline){
      if(failed)throw fail('WEB_LAUNCH_FAILED','Сервер не запущен. Журнал: '+logPath);
      const answer=await deps.isReady(port,{timeoutMs:Math.max(1,Math.min(1000,deadline-deps.now()))});
      if(failed)throw fail('WEB_LAUNCH_FAILED','Сервер не запущен. Журнал: '+logPath);
      if(answer){ready=true;deps.write('Веб-диспетчер готов: '+url+'\n');await open();return {url,alreadyRunning:false,pid:child.pid};}
      await deps.sleep(Math.min(pollMs,Math.max(1,deadline-deps.now())));
    }
    throw fail('WEB_LAUNCH_TIMEOUT','Сервер пока не подтвердил готовность. Журнал: '+logPath);
  }finally{lock.close(!!child?.pid&&!ready&&!failed);}
}
async function main(argv=process.argv.slice(2)){const {configPath,noOpen}=parseArgs(argv);return launchLocal(configPath,{noOpen});}
if(require.main===module)void main().catch(error=>{process.stderr.write('Запуск веб-диспетчера: '+error.message+'\n');process.exitCode=1;});
module.exports={parseArgs,isReady,launchLock,launchLocal,main};
