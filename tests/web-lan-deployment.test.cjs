'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const windows=path.resolve(__dirname,'../web/deployment/windows');
const {parseArgs,checkConfiguration}=require('../web/deployment/windows/check-configuration.cjs');
const PREFIX='tvs-web-lan-deployment-test-';
function write(root,relative,content){const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,typeof content==='object'?JSON.stringify(content):content);}
function fixture(t){
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),PREFIX)),root=path.join(parent,'программа с пробелами & [LAN]');fs.mkdirSync(root);
  t.after(()=>{const actual=fs.realpathSync(parent);assert.equal(path.dirname(actual),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(actual).startsWith(PREFIX));assert.equal(fs.lstatSync(parent).isSymbolicLink(),false);fs.rmSync(actual,{recursive:true,force:true});});
  fs.cpSync(windows,path.join(root,'app/web/deployment/windows'),{recursive:true});
  write(root,'app/web/local-runtime.cjs',`'use strict';
const fs=require('node:fs'),path=require('node:path');
exports.buildRuntime=configPath=>{const config=JSON.parse(fs.readFileSync(configPath,'utf8'));if(!fs.existsSync(config.usersFile)||!fs.statSync(config.dataDir).isDirectory())throw Error('Synthetic invalid config');return {config,configPath};};
exports.prepareBackup=runtime=>{if(process.env.DISPATCHER_TEST_BACKUP_FAIL==='1')throw Error('Synthetic backup failure');fs.writeFileSync(path.join(runtime.config.dataDir,'synthetic-backup-checked'),'checked');return {path:'synthetic'};};
`);
  write(root,'app/web/launch-local.cjs',`'use strict';const fs=require('node:fs'),path=require('node:path');fs.writeFileSync(path.join(__dirname,'../../launch-arguments.json'),JSON.stringify(process.argv.slice(2)));process.stdout.write('Synthetic ready\\n');`);
  fs.mkdirSync(path.join(root,'runtime'));fs.copyFileSync(process.execPath,path.join(root,'runtime/node.exe'));
  const dataDir=path.join(parent,'синтетическая база & [data]'),usersFile=path.join(root,'config','персональные записи.json'),stateDir=path.join(root,'state');
  fs.mkdirSync(dataDir);fs.mkdirSync(stateDir);write(dataDir,'business-marker.txt','UNCHANGED');write(root,path.relative(root,usersFile),{synthetic:true});
  const original={dataDir,usersFile,stateDir,port:3381,backupDir:path.join(parent,'synthetic backups')};write(root,'config/server.json',original);
  return {parent,root,dataDir,usersFile,stateDir,original,configPath:path.join(root,'config/server.json'),scripts:path.join(root,'app/web/deployment/windows')};
}
function ps(script,args=[],extraEnv={}){const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,...args],{encoding:'utf8',timeout:30000,windowsHide:true,env:{...process.env,...extraEnv}});if(result.error)throw result.error;return result;}

test('Windows configuration check validates the candidate and verifies backup before returning without starting a server',()=>{
  const events=[],built={config:{synthetic:true}};
  assert.deepEqual(checkConfiguration(path.resolve('synthetic-config.json'),{backup:true,runtime:{buildRuntime:file=>{events.push(['validate',file]);return built;},prepareBackup:value=>{assert.equal(value,built);events.push(['backup']);}}}),{ok:true,backupVerified:true});
  assert.deepEqual(events.map(event=>event[0]),['validate','backup']);
  assert.throws(()=>checkConfiguration(path.resolve('synthetic-config.json'),{backup:true,runtime:{buildRuntime:()=>built,prepareBackup:()=>{throw Error('backup failed');}}}),/backup failed/);
  assert.deepEqual(parseArgs(['--config',path.resolve('config.json'),'--backup']),{configPath:path.resolve('config.json'),backup:true});
  assert.throws(()=>parseArgs(['--config','relative.json']),/ABSOLUTE_CONFIG_JSON/);
});

test('Windows scripts configure and launch a self-contained folder with spaces, Cyrillic and shell metacharacters', {skip:process.platform!=='win32'}, t=>{
  const f=fixture(t),configured=ps(path.join(f.scripts,'Configure-Dispatcher.ps1'),['-InstallationRoot',f.root,'-Lan','-TrustedHost','192.168.20.10']);
  assert.equal(configured.status,0,configured.stdout+'\n'+configured.stderr);
  const config=JSON.parse(fs.readFileSync(f.configPath,'utf8'));
  for(const key of ['dataDir','usersFile','stateDir','port','backupDir'])assert.equal(config[key],f.original[key]);
  assert.equal(config.host,'0.0.0.0');assert.deepEqual(config.allowedHosts,['127.0.0.1','localhost','192.168.20.10']);
  assert.equal(fs.readFileSync(path.join(f.dataDir,'business-marker.txt'),'utf8'),'UNCHANGED');
  assert.ok(fs.existsSync(path.join(f.dataDir,'synthetic-backup-checked')));
  assert.equal(fs.readdirSync(path.dirname(f.configPath)).filter(name=>name.endsWith('.previous.json')).length,1);
  assert.deepEqual(fs.readdirSync(f.stateDir),[]);assert.equal(fs.existsSync(path.join(f.root,'launch-arguments.json')),false);
  const started=ps(path.join(f.scripts,'Start-Dispatcher.ps1'),['-NoOpen']);
  assert.equal(started.status,0,started.stdout+'\n'+started.stderr);assert.match(started.stdout,/http:\/\/192\.168\.20\.10:3381\/objects/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root,'launch-arguments.json'),'utf8')),['--config',f.configPath,'--no-open']);
  const local=ps(path.join(f.scripts,'Configure-Dispatcher.ps1'));
  assert.equal(local.status,0,local.stdout+'\n'+local.stderr);const localConfig=JSON.parse(fs.readFileSync(f.configPath,'utf8'));assert.equal(localConfig.host,'127.0.0.1');assert.deepEqual(localConfig.allowedHosts,['127.0.0.1','localhost']);
});

test('Windows configurator preserves the existing config on backup failure and rejects public or URL trusted hosts', {skip:process.platform!=='win32'}, t=>{
  const f=fixture(t),before=fs.readFileSync(f.configPath),script=path.join(f.scripts,'Configure-Dispatcher.ps1');
  const failed=ps(script,['-InstallationRoot',f.root,'-Lan','-TrustedHost','192.168.20.10'],{DISPATCHER_TEST_BACKUP_FAIL:'1'});
  assert.equal(failed.status,1);assert.match(failed.stderr,/Synthetic backup failure/);assert.deepEqual(fs.readFileSync(f.configPath),before);assert.equal(fs.readdirSync(path.dirname(f.configPath)).some(name=>name.endsWith('.pending.json')||name.endsWith('.previous.json')),false);
  for(const candidate of ['8.8.8.8','10.1','010.0.0.1','http://192.168.1.20:3381','192.168.1.20:3381','*']){const result=ps(script,['-InstallationRoot',f.root,'-Lan','-TrustedHost',candidate]);assert.equal(result.status,1,candidate);assert.match(result.stderr,/TrustedHost/);assert.deepEqual(fs.readFileSync(f.configPath),before);}
  assert.deepEqual(fs.readdirSync(f.stateDir),[]);assert.equal(fs.readFileSync(path.join(f.dataDir,'business-marker.txt'),'utf8'),'UNCHANGED');
});

test('Windows setup cannot place its private configuration in the operation queue', {skip:process.platform!=='win32'}, t=>{
  const f=fixture(t),before=fs.readFileSync(f.configPath),result=ps(path.join(f.scripts,'Configure-Dispatcher.ps1'),['-InstallationRoot',f.root,'-StateDir',path.join(f.root,'config','queue')]);
  assert.equal(result.status,1);assert.deepEqual(fs.readFileSync(f.configPath),before);assert.equal(fs.readdirSync(path.dirname(f.configPath)).some(name=>name.endsWith('.pending.json')),false);
});
