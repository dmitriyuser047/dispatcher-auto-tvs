'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {preparePdfRuntime,inspectPdfRuntime,parseArgs}=require('../scripts/prepare-web-pdf-runtime.cjs');
const {prepareWebDeployment,parseArgs:parseDeploymentArgs}=require('../scripts/prepare-web-deployment.cjs');
const PREFIX='tvs-web-pdf-runtime-test-';
function write(root,relative,value){const filename=path.join(root,relative);fs.mkdirSync(path.dirname(filename),{recursive:true});fs.writeFileSync(filename,typeof value==='object'&&!Buffer.isBuffer(value)?JSON.stringify(value):value);}
function electron(root){for(const [file,value]of Object.entries({'electron.exe':'MZSYNTHETIC_WINDOWS_EXECUTABLE','version':'44.9.0\n','icudtl.dat':'SYNTHETIC_ICU','resources.pak':'SYNTHETIC_RESOURCES','chrome_100_percent.pak':'SYNTHETIC_SCALE_ONE','chrome_200_percent.pak':'SYNTHETIC_SCALE_TWO','ffmpeg.dll':'SYNTHETIC_DLL','locales/en-US.pak':'SYNTHETIC_ENGLISH','locales/ru.pak':'SYNTHETIC_RUSSIAN','resources/default_app.asar':'SYNTHETIC_DEFAULT_APP','LICENSE':'SYNTHETIC_LICENSE'}))write(root,file,value);fs.mkdirSync(path.join(root,'empty-directory'));}
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),PREFIX)),source=path.join(root,'исходный Electron & [dist]'),target=path.join(root,'runtime with spaces');electron(source);
  t.after(()=>{const actual=fs.realpathSync(root);assert.equal(path.dirname(actual),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(actual).startsWith(PREFIX));assert.equal(fs.lstatSync(root).isSymbolicLink(),false);fs.rmSync(actual,{recursive:true,force:true});});
  return {root,source,target};
}
function files(root){const result=[];function walk(folder){for(const name of fs.readdirSync(folder).sort()){const filename=path.join(folder,name),stat=fs.lstatSync(filename);if(stat.isDirectory())walk(filename);else result.push([path.relative(root,filename).split(path.sep).join('/'),fs.readFileSync(filename)]);}}walk(root);return result;}

test('offline PDF runtime copies the complete Windows distribution and provides executable/version hashes',t=>{
  const f=fixture(t),before=files(f.source),result=preparePdfRuntime(f),manifest=JSON.parse(fs.readFileSync(result.manifestFile,'utf8'));
  assert.equal(result.version,'44.9.0');assert.equal(result.executable,path.join(f.target,'electron.exe'));assert.equal(result.files,before.length);
  assert.equal(manifest.networkUsed,false);assert.equal(manifest.businessDataCopied,false);assert.equal(manifest.electronVersion,'44.9.0');assert.equal(manifest.executable,'electron.exe');
  for(const entry of manifest.files){const bytes=fs.readFileSync(path.join(f.target,...entry.path.split('/')));assert.equal(bytes.length,entry.bytes);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),entry.sha256);assert.equal(path.isAbsolute(entry.path),false);}
  assert.ok(fs.statSync(path.join(f.target,'empty-directory')).isDirectory());
  assert.deepEqual(files(f.target).filter(([file])=>file!=='pdf-runtime-manifest.json'),before);assert.deepEqual(files(f.source),before);
  assert.ok(manifest.files.some(file=>file.path==='electron.exe'));assert.ok(manifest.files.some(file=>file.path==='version'));
});

test('PDF runtime accepts empty targets but refuses nonempty, source overlap, protected paths and managed database ancestors',t=>{
  const f=fixture(t);fs.mkdirSync(f.target);write(f.target,'keep.txt','KEEP');
  assert.throws(()=>preparePdfRuntime(f),/новой или пустой/);assert.deepEqual(fs.readdirSync(f.target),['keep.txt']);assert.equal(fs.readFileSync(path.join(f.target,'keep.txt'),'utf8'),'KEEP');
  assert.throws(()=>preparePdfRuntime({...f,target:path.join(f.source,'nested')}),/пересекаться с источником/);assert.equal(fs.existsSync(path.join(f.source,'nested')),false);
  const business=path.join(f.root,'business');fs.mkdirSync(business);
  assert.throws(()=>preparePdfRuntime({...f,target:path.join(business,'runtime'),protectedPaths:[business]}),/защищённым/);
  write(business,'platform.sqlite','SYNTHETIC_BUSINESS_DB');assert.throws(()=>preparePdfRuntime({...f,target:path.join(business,'runtime')}),/рабочей базы/);assert.equal(fs.readFileSync(path.join(business,'platform.sqlite'),'utf8'),'SYNTHETIC_BUSINESS_DB');
  const empty=path.join(f.root,'empty');fs.mkdirSync(empty);assert.equal(preparePdfRuntime({...f,target:empty}).target,fs.realpathSync.native(empty));
});

test('incomplete, invalid or private Electron sources fail before destination creation',t=>{
  const f=fixture(t);fs.unlinkSync(path.join(f.source,'resources.pak'));
  assert.throws(()=>preparePdfRuntime(f),/resources.pak/);assert.equal(fs.existsSync(f.target),false);write(f.source,'resources.pak','RESTORED');
  write(f.source,'version','not-a-version');assert.throws(()=>preparePdfRuntime(f),/версия Electron/);assert.equal(fs.existsSync(f.target),false);write(f.source,'version','44.9.0');
  write(f.source,'electron.exe','BAD_EXECUTABLE');assert.throws(()=>preparePdfRuntime(f),/Windows electron.exe/);assert.equal(fs.existsSync(f.target),false);write(f.source,'electron.exe','MZSYNTHETIC');
  write(f.source,'resources/users.json',{syntheticSecret:'DO_NOT_COPY'});assert.throws(()=>preparePdfRuntime(f),/Приватный файл/);assert.equal(fs.existsSync(f.target),false);
});

test('PDF runtime rejects links in sources, source ancestors and target ancestors',t=>{
  const f=fixture(t),outside=path.join(f.root,'outside');fs.mkdirSync(outside);write(outside,'private.txt','PRIVATE');
  const sourceLink=path.join(f.source,'linked');try{fs.symlinkSync(outside,sourceLink,process.platform==='win32'?'junction':'dir');}catch(error){if(['EPERM','EACCES','ENOTSUP'].includes(error.code)){t.skip('Symlink creation unavailable');return;}throw error;}
  assert.throws(()=>preparePdfRuntime(f),/Ссылка|Ссылки/);assert.equal(fs.existsSync(f.target),false);fs.unlinkSync(sourceLink);
  const targetLink=path.join(f.root,'target-link');fs.symlinkSync(outside,targetLink,process.platform==='win32'?'junction':'dir');assert.throws(()=>preparePdfRuntime({...f,target:path.join(targetLink,'new-runtime')}),/Ссылки/);assert.equal(fs.existsSync(path.join(outside,'new-runtime')),false);
  const sourceAncestor=path.join(f.root,'source-link');fs.symlinkSync(f.source,sourceAncestor,process.platform==='win32'?'junction':'dir');assert.throws(()=>inspectPdfRuntime(sourceAncestor),/Ссылки/);
});

test('web deployment --with-pdf preflights the native source and includes an independently portable runtime',t=>{
  const f=fixture(t),sourceRoot=path.join(f.root,'web-source'),target=path.join(f.root,'full deployment'),runtimePath=path.join(f.root,'node.exe');
  write(sourceRoot,'package.json',{name:'synthetic-web-pdf',version:'1.2.3',dependencies:{},build:{files:['index.html','package.json']}});write(sourceRoot,'index.html','SYNTHETIC_WEB');write(sourceRoot,'web/local-runtime.cjs','module.exports = {};');write(sourceRoot,'web/launch-local.cjs','module.exports = {};');write(f.root,'node.exe','SYNTHETIC_NODE');
  assert.throws(()=>prepareWebDeployment({sourceRoot,target,runtimePath,withPdf:true}));assert.equal(fs.existsSync(target),false);
  const electronSource=path.join(sourceRoot,'node_modules/electron/dist');electron(electronSource);
  const result=prepareWebDeployment({sourceRoot,target,runtimePath,withPdf:true});assert.equal(result.pdfRuntime.version,'44.9.0');assert.equal(result.pdfRuntime.executable,'runtime/electron/electron.exe');
  const manifest=JSON.parse(fs.readFileSync(path.join(target,'deployment-manifest.json'),'utf8'));
  assert.equal(manifest.pdfRuntime.version,'44.9.0');for(const file of files(electronSource))assert.ok(manifest.files.some(entry=>entry.path==='runtime/electron/'+file[0]));
  assert.ok(manifest.files.some(entry=>entry.path==='runtime/electron/pdf-runtime-manifest.json'));
  assert.match(fs.readFileSync(path.join(target,'Прочитайте.txt'),'utf8'),/runtime\\electron/);
  assert.deepEqual(parseDeploymentArgs(['--target',target,'--with-pdf']),{protectedPaths:[],target,withPdf:true});assert.throws(()=>parseDeploymentArgs(['--with-pdf','--with-pdf']),/дважды/);
});

test('PDF runtime CLI accepts only its explicit source/target flags',()=>{
  assert.deepEqual(parseArgs(['--target',path.resolve('target'),'--source',path.resolve('source')]),{target:path.resolve('target'),source:path.resolve('source')});
  assert.throws(()=>parseArgs(['--source']),/Использование/);assert.throws(()=>parseArgs(['--target','one','--target','two']),/дважды/);assert.throws(()=>parseArgs(['--unknown','x']),/Использование/);
});
