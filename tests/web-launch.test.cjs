'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),{EventEmitter}=require('node:events');
const {parseArgs,isReady,launchLocal}=require('../web/launch-local.cjs');
const {spawnSync}=require('node:child_process');
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-web-launch-')),stateDir=path.join(root,'outbox'),configDir=path.join(root,'config'),configPath=path.join(configDir,'server.json'),controlDir=path.join(configDir,'launch');
  fs.mkdirSync(stateDir);fs.mkdirSync(configDir);
  t.after(()=>{const target=fs.realpathSync(root);assert.equal(path.dirname(target),fs.realpathSync(os.tmpdir()));assert.match(path.basename(target),/^tvs-web-launch-/);assert.equal(fs.lstatSync(target).isSymbolicLink(),false);fs.rmSync(target,{recursive:true,force:true});});
  let clock=0;const events=[],child=new EventEmitter();child.pid=process.pid;child.unref=()=>events.push('unref');
  const dependencies={buildRuntime:()=>({configPath,config:{port:3381,stateDir}}),isReady:async()=>false,spawn:(...args)=>{events.push({spawn:args});return child;},openBrowser:async url=>events.push({open:url}),now:()=>clock,sleep:async ms=>{clock+=ms;},write:message=>events.push({message})};
  return {root,stateDir,configPath,controlDir,dependencies,events,child};
}
test('launcher opens an already ready server without another process or state files',async t=>{
  const f=fixture(t);f.dependencies.isReady=async()=>true;
  assert.equal((await launchLocal(f.configPath,{dependencies:f.dependencies})).alreadyRunning,true);
  assert.equal(f.events.filter(event=>event.spawn).length,0);assert.equal(f.events.filter(event=>event.open).length,1);assert.deepEqual(fs.readdirSync(f.stateDir),[]);
});
test('detached launch waits for verified readiness before opening and redirects logs',async t=>{
  const f=fixture(t);let reads=0;f.dependencies.isReady=async()=>++reads>=4;
  await launchLocal(f.configPath,{dependencies:f.dependencies,pollMs:1});
  const start=f.events.find(event=>event.spawn).spawn;
  assert.equal(start[0],process.execPath);assert.equal(start[2].detached,true);assert.equal(start[2].windowsHide,true);assert.equal(start[2].shell,false);
  assert.equal(f.events.filter(event=>event.open).length,1);assert.ok(f.events.includes('unref'));assert.ok(reads>=4);assert.equal(fs.existsSync(path.join(f.controlDir,'.web-launch.lock')),false);
  assert.equal(fs.existsSync(path.join(f.controlDir,'server.stderr.log')),true);assert.deepEqual(fs.readdirSync(f.stateDir),[]);
});
test('spawn failure and child exit report logs without opening a browser',async t=>{
  for(const mode of ['throw','exit']){const f=fixture(t);if(mode==='throw')f.dependencies.spawn=()=>{throw Error('Synthetic spawn failure');};else f.dependencies.isReady=async()=>{if(f.events.some(event=>event.spawn))f.child.emit('exit',1);return false;};
    await assert.rejects(launchLocal(f.configPath,{dependencies:f.dependencies}),error=>error.code==='WEB_LAUNCH_FAILED'&&error.message.includes('server.stderr.log'));
    assert.equal(f.events.filter(event=>event.open).length,0);assert.equal(fs.existsSync(path.join(f.controlDir,'.web-launch.lock')),false);assert.deepEqual(fs.readdirSync(f.stateDir),[]);
  }
});
test('timeout preserves the live child lock and prevents duplicate startup',async t=>{
  const f=fixture(t);await assert.rejects(launchLocal(f.configPath,{dependencies:f.dependencies,timeoutMs:3,pollMs:1}),{code:'WEB_LAUNCH_TIMEOUT'});
  assert.equal(f.events.filter(event=>event.open).length,0);assert.equal(fs.existsSync(path.join(f.controlDir,'.web-launch.lock')),true);assert.deepEqual(fs.readdirSync(f.stateDir),[]);
  await assert.rejects(launchLocal(f.configPath,{dependencies:f.dependencies,timeoutMs:3,pollMs:1}),{code:'WEB_LAUNCH_BUSY'});
  assert.equal(f.events.filter(event=>event.spawn).length,1);
});
test('a confirmed dead local launcher lock is recovered, but a foreign owner is preserved',async t=>{
  const ended=spawnSync(process.execPath,['-e',''],{windowsHide:true});assert.equal(ended.status,0);
  assert.throws(()=>process.kill(ended.pid,0),error=>error.code==='ESRCH');
  const owner={format:'tvs-web-launch',version:1,host:os.hostname(),pid:ended.pid,nonce:'b'.repeat(32)};
  const local=fixture(t);fs.mkdirSync(local.controlDir);fs.writeFileSync(path.join(local.controlDir,'.web-launch.lock'),JSON.stringify(owner));let reads=0;local.dependencies.isReady=async()=>++reads>=3;
  await launchLocal(local.configPath,{dependencies:local.dependencies,noOpen:true});assert.equal(local.events.filter(event=>event.spawn).length,1);assert.equal(fs.existsSync(path.join(local.controlDir,'.web-launch.lock.recovery')),false);
  const foreign=fixture(t);fs.mkdirSync(foreign.controlDir);const filename=path.join(foreign.controlDir,'.web-launch.lock'),bytes=JSON.stringify({...owner,host:owner.host+'-different'});fs.writeFileSync(filename,bytes);
  await assert.rejects(launchLocal(foreign.configPath,{dependencies:foreign.dependencies}),{code:'WEB_LAUNCH_BUSY'});assert.equal(fs.readFileSync(filename,'utf8'),bytes);assert.equal(foreign.events.filter(event=>event.spawn).length,0);
});
test('no-open leaves the browser untouched and arguments require an explicit absolute config',async t=>{
  const f=fixture(t);f.dependencies.isReady=async()=>true;await launchLocal(f.configPath,{dependencies:f.dependencies,noOpen:true});assert.equal(f.events.filter(event=>event.open).length,0);
  assert.deepEqual(parseArgs(['--config',f.configPath,'--no-open']),{configPath:f.configPath,noOpen:true});
  for(const args of [[],['--config','relative.json'],['--config',f.configPath,'--other'],['--config',f.configPath,'--no-open','--no-open']])assert.throws(()=>parseArgs(args),{code:'WEB_LAUNCH_ARGUMENT'});
});
test('readiness accepts only the local login document and sends no authentication',async t=>{
  let markup='<html><form id="webLoginForm"></form></html>';const received=[];
  const server=http.createServer((req,res)=>{received.push({method:req.method,url:req.url,authorization:req.headers.authorization,cookie:req.headers.cookie});res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(markup);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  assert.equal(await isReady(server.address().port),true);markup='<html>Other service</html>';assert.equal(await isReady(server.address().port),false);
  assert.deepEqual(received.map(item=>item.method),['GET','GET']);assert.ok(received.every(item=>item.url==='/login'&&!item.authorization&&!item.cookie));
});
test('launch controls stay outside the real outbox and overlapping configuration is rejected early',async t=>{
  const f=fixture(t);let reads=0;f.dependencies.isReady=async()=>++reads>=3;
  await launchLocal(f.configPath,{dependencies:f.dependencies,noOpen:true});
  const {createWebOutbox}=require('../web/outbox.cjs');
  const box=createWebOutbox({rootDir:f.stateDir,send:async()=>{throw Error('Read-only test');},lookup:async()=>null});
  assert.deepEqual(await box.list({databaseToken:'synthetic-database',access:{user:{id:'synthetic-launch-user',role:'admin'},policyStamp:'sha256:'+'a'.repeat(64)}}),[]);
  assert.deepEqual(fs.readdirSync(f.stateDir),['.command-outbox-owner.json']);
  assert.equal(fs.existsSync(path.join(f.controlDir,'server.stderr.log')),true);
  const invalid=fixture(t);invalid.dependencies.buildRuntime=()=>({configPath:path.join(invalid.stateDir,'server.json'),config:{port:3381,stateDir:invalid.stateDir}});
  await assert.rejects(launchLocal(invalid.configPath,{dependencies:invalid.dependencies}),{code:'WEB_LAUNCH_PATH'});assert.equal(invalid.events.length,0);assert.deepEqual(fs.readdirSync(invalid.stateDir),[]);
});
