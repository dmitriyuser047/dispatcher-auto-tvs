'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {prepareWebDeployment,parseArgs}=require('../scripts/prepare-web-deployment.cjs');
const PREFIX='tvs-web-deployment-test-';
function write(root,relative,value){const file=path.join(root,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='object'?JSON.stringify(value):value);}
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),PREFIX)),sourceRoot=path.join(root,'source'),runtimePath=path.join(root,'runtime','node.exe'),target=path.join(root,'deployment');
  fs.mkdirSync(sourceRoot);
  const metadata={name:'synthetic-web',version:'1.2.3',scripts:{start:'do not package development scripts'},dependencies:{alpha:'1',beta:'1',shared:'1'},optionalDependencies:{missing:'1'},devDependencies:{'development-only':'1'},build:{files:['index.html','electron/**','assets/**','package.json']}};
  write(sourceRoot,'package.json',metadata);write(sourceRoot,'index.html','Synthetic app');write(sourceRoot,'electron/server.js','module.exports = {};');write(sourceRoot,'assets/app.css','body{}');
  write(sourceRoot,'assets/.env','SYNTHETIC_SECRET=never-copy');write(sourceRoot,'assets/private-key.pem','SYNTHETIC_KEY');write(sourceRoot,'assets/settings.json',{networkKey:'SYNTHETIC_KEY'});
  write(sourceRoot,'web/local-runtime.cjs','module.exports = {};');write(sourceRoot,'web/launch-local.cjs','module.exports = {};');write(sourceRoot,'web/server.cjs','module.exports = {};');write(sourceRoot,'web/public/bridge.js','/* browser */');write(sourceRoot,'web/.local/demo/db/platform.sqlite','SYNTHETIC_DB');write(sourceRoot,'web/.local/demo/outbox/pending.json','SYNTHETIC_PENDING');write(sourceRoot,'web/private/users.json',{tokenHash:'SYNTHETIC_HASH'});write(sourceRoot,'web/config/server.json',{dataDir:'SYNTHETIC_PRIVATE_PATH'});
  write(sourceRoot,'.git/config','SYNTHETIC_REMOTE');write(sourceRoot,'development-data/data.json','SYNTHETIC_BUSINESS');
  const pkg=(relative,value)=>{write(sourceRoot,relative+'/package.json',value);write(sourceRoot,relative+'/index.js','module.exports = '+JSON.stringify(value.version)+';');write(sourceRoot,relative+'/LICENSE','Synthetic license');};
  pkg('node_modules/alpha',{name:'alpha',version:'1.0.0',exports:{'.':'./index.js'},dependencies:{shared:'1'}});
  pkg('node_modules/beta',{name:'beta',version:'1.0.0',dependencies:{shared:'2'}});
  pkg('node_modules/shared',{name:'shared',version:'1.0.0'});
  pkg('node_modules/beta/node_modules/shared',{name:'shared',version:'2.0.0'});
  pkg('node_modules/development-only',{name:'development-only',version:'9.0.0'});
  write(sourceRoot,'node_modules/alpha/.env','SYNTHETIC_DEP_SECRET');
  write(root,'runtime/node.exe','SYNTHETIC_NODE_RUNTIME');
  t.after(()=>{const actual=fs.realpathSync(root),parent=fs.realpathSync(os.tmpdir());assert.equal(path.dirname(actual),parent);assert.ok(path.basename(actual).startsWith(PREFIX));assert.equal(fs.lstatSync(root).isSymbolicLink(),false);fs.rmSync(actual,{recursive:true,force:true});});
  return {root,sourceRoot,runtimePath,target,metadata};
}
function tree(root){const rows=[];function walk(folder){for(const name of fs.readdirSync(folder).sort()){const file=path.join(folder,name),stat=fs.lstatSync(file),relative=path.relative(root,file).split(path.sep).join('/');if(stat.isSymbolicLink()){rows.push([relative,'link',fs.readlinkSync(file)]);}else if(stat.isDirectory())walk(file);else rows.push([relative,crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]);}}walk(root);return rows;}

test('web deployment copies the exact production graph, nested versions and local runtime without business or development data',t=>{
  const f=fixture(t),before=tree(f.sourceRoot);
  const result=prepareWebDeployment(f);
  assert.equal(result.configured,false);assert.equal(result.modules,4);assert.equal(result.skippedOptional,1);
  assert.equal(fs.readFileSync(path.join(f.target,'runtime/node.exe'),'utf8'),'SYNTHETIC_NODE_RUNTIME');
  const installed=JSON.parse(fs.readFileSync(path.join(f.target,'app/package.json'),'utf8'));
  assert.equal(installed.version,'1.2.3');for(const key of ['build','scripts','devDependencies'])assert.equal(key in installed,false);
  const requireInstalled=require('node:module').createRequire(path.join(f.target,'app/package.json'));
  assert.equal(requireInstalled('alpha'),'1.0.0');assert.equal(requireInstalled('shared'),'1.0.0');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.target,'app/node_modules/beta/node_modules/shared/package.json'),'utf8')).version,'2.0.0');
  assert.equal(fs.existsSync(path.join(f.target,'app/node_modules/alpha/node_modules/shared')),false);
  for(const relative of ['app/.git','app/development-data','app/node_modules/development-only','app/assets/.env','app/assets/private-key.pem','app/assets/settings.json','app/node_modules/alpha/.env','app/web/.local','app/web/private','app/web/config/server.json'])assert.equal(fs.existsSync(path.join(f.target,relative)),false,relative);
  assert.ok(fs.existsSync(path.join(f.target,'app/web/local-runtime.cjs')));
  assert.deepEqual(fs.readdirSync(path.join(f.target,'state')),[]);
  const config=JSON.parse(fs.readFileSync(result.configFile,'utf8'));assert.equal(config.dataDir,'');assert.equal(config.port,3381);assert.equal(config.stateDir,path.join(f.target,'state'));
  const launcher=fs.readFileSync(path.join(f.target,'Запустить.cmd'),'utf8');assert.match(launcher,/%~dp0runtime\\node\.exe/);assert.match(launcher,/web\\launch-local\.cjs" --config "%~dp0config\\server\.json/);assert.doesNotMatch(launcher,/start\s+\/|npm\s/i);
  const manifest=JSON.parse(fs.readFileSync(path.join(f.target,'deployment-manifest.json'),'utf8'));assert.equal(manifest.networkUsed,false);assert.equal(manifest.businessDataCopied,false);assert.equal(manifest.modules.length,4);assert.ok(manifest.files.every(file=>!path.isAbsolute(file.path)&&/^[a-f0-9]{64}$/.test(file.sha256)));
  const contents=tree(f.target);assert.equal(contents.some(row=>row[1]==='link'),false);assert.deepEqual(tree(f.sourceRoot),before);
});

test('deployment refuses nonempty targets and source overlap without changing existing files',t=>{
  const f=fixture(t);write(f.target,'keep.txt','KEEP');
  assert.throws(()=>prepareWebDeployment(f),/новым или пустым/);assert.deepEqual(fs.readdirSync(f.target),['keep.txt']);assert.equal(fs.readFileSync(path.join(f.target,'keep.txt'),'utf8'),'KEEP');
  assert.throws(()=>prepareWebDeployment({...f,target:path.join(f.sourceRoot,'new-install')}),/исходным проектом/);
  assert.equal(fs.existsSync(path.join(f.sourceRoot,'new-install')),false);
});

test('missing production dependencies and unsafe packaging paths fail before creating the destination',t=>{
  const f=fixture(t);write(f.sourceRoot,'package.json',{...f.metadata,dependencies:{absent:'1'}});
  assert.throws(()=>prepareWebDeployment(f),/производственная зависимость/);assert.equal(fs.existsSync(f.target),false);
  write(f.sourceRoot,'package.json',{...f.metadata,build:{files:['../escape/**']}});
  assert.throws(()=>prepareWebDeployment(f),/Небезопасный путь/);assert.equal(fs.existsSync(f.target),false);
});

test('explicit protected databases and recognized managed database ancestors cannot become installation targets',t=>{
  const f=fixture(t),business=path.join(f.root,'business');fs.mkdirSync(business);
  assert.throws(()=>prepareWebDeployment({...f,target:path.join(business,'new'),protectedPaths:[business]}),/защищённым каталогом/);assert.equal(fs.existsSync(path.join(business,'new')),false);
  write(f.root,'business/platform.sqlite','SYNTHETIC_PRIVATE_DB');
  assert.throws(()=>prepareWebDeployment({...f,target:path.join(business,'new')}),/внутри рабочей базы/);assert.equal(fs.readFileSync(path.join(business,'platform.sqlite'),'utf8'),'SYNTHETIC_PRIVATE_DB');
});

test('a source junction or symlink is rejected rather than traversed into private data',t=>{
  const f=fixture(t),outside=path.join(f.root,'outside');fs.mkdirSync(outside);write(outside,'hidden.txt','SYNTHETIC_PRIVATE');
  try{fs.symlinkSync(outside,path.join(f.sourceRoot,'assets','linked-private'),process.platform==='win32'?'junction':'dir');}catch(error){if(['EPERM','EACCES','ENOTSUP'].includes(error.code)){t.skip('Symlink creation unavailable');return;}throw error;}
  assert.throws(()=>prepareWebDeployment(f),/Ссылка|Символические ссылки/);assert.equal(fs.existsSync(f.target),false);
});

test('an existing empty target is accepted and the CLI accepts only explicit bounded paths',t=>{
  const f=fixture(t);fs.mkdirSync(f.target);assert.equal(prepareWebDeployment(f).target,fs.realpathSync.native(f.target));
  assert.deepEqual(parseArgs(['--target',f.target,'--protected-path',f.sourceRoot]),{target:f.target,protectedPaths:[f.sourceRoot]});
  assert.throws(()=>parseArgs(['--target',f.target,'--target',f.target]),/дважды/);assert.throws(()=>parseArgs(['--unknown','x']),/Использование/);
});
