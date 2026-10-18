'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {validateMetadata,writeManifest}=require('../scripts/write-release-manifest.cjs');
const metadata=()=>({name:'dispatcher-tvs',version:'3.5.2',build:{appId:'com.tvs.dispatcher',productName:'Диспетчер ТВС',artifactName:'Dispatcher-Setup-${version}.${ext}'}});
const hash=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-release-guard-'));
  t.after(()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('tvs-release-guard-'));fs.rmSync(root,{recursive:true,force:true});});
  fs.mkdirSync(path.join(root,'audit'));
  fs.mkdirSync(path.join(root,'dist','win-unpacked','resources'),{recursive:true});
  const pkg=metadata(),archive=Buffer.from('synthetic packed app fixture');
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify(pkg));
  fs.writeFileSync(path.join(root,'.gitignore'),'dist/\naudit/\n');
  fs.writeFileSync(path.join(root,'version.json'),'{"version":"2.0.104","url":"https://example.invalid/stable.exe"}\n');
  fs.writeFileSync(path.join(root,'dist','win-unpacked','resources','app.asar'),archive);
  fs.writeFileSync(path.join(root,'dist','Dispatcher-Setup-3.5.2.exe'),Buffer.from('synthetic installer fixture'));
  fs.writeFileSync(path.join(root,'audit','package-source.json'),JSON.stringify({version:pkg.version,name:pkg.name,appId:pkg.build.appId,status:'PASS',archiveSha256:hash(archive),integrity:{files:1,unpackedFiles:0,mismatches:[]}}));
  const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
  git(['init','--quiet']);git(['add','package.json','version.json','.gitignore']);
  git(['-c','user.name=Release Guard Test','-c','user.email=test@example.invalid','-c','core.hooksPath=/dev/null','commit','--quiet','-m','synthetic fixture']);
  return {root,git};
}

test('stable build guard rejects prereleases, prototype identity and path-traversal artifact names',()=>{
  assert.equal(validateMetadata(metadata()),'Dispatcher-Setup-3.5.2.exe');
  for(const version of ['3.5.2-prototype.3','3.5.2-rc.1','3.5.2+build','03.5.2','3.5'])assert.throws(()=>validateMetadata({...metadata(),version}),/stable production/);
  assert.throws(()=>validateMetadata({...metadata(),prototype:true}),/stable production/);
  assert.throws(()=>validateMetadata({...metadata(),name:'dispatcher-tvs-prototype'}),/Production application identity/);
  for(const artifactName of ['../stable.exe','C:\\stable.exe','${unknown}.exe','stable/${version}.exe','Dispatcher-Prototype-${version}.exe'])assert.throws(()=>validateMetadata({...metadata(),build:{...metadata().build,artifactName}}),/Unsafe/);
});

test('local build manifest hashes the exact installer and leaves the stable update channel unchanged',t=>{
  const {root,git}=fixture(t),channel=fs.readFileSync(path.join(root,'version.json'));
  const manifest=writeManifest(root),installer=fs.readFileSync(path.join(root,'dist',manifest.installer));
  assert.equal(manifest.sourceCommit,git(['rev-parse','HEAD']));assert.equal(manifest.sourceDirty,false);
  assert.equal(manifest.sha256,hash(installer));assert.equal(manifest.sha512,crypto.createHash('sha512').update(installer).digest('base64'));
  assert.equal(manifest.bytes,installer.length);assert.equal(manifest.published,false);
  assert.deepEqual(fs.readFileSync(path.join(root,'version.json')),channel);
  assert.equal(fs.readFileSync(path.join(root,'dist','SHA256SUMS.txt'),'utf8'),manifest.sha256+'  '+manifest.installer+'\n');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'dist','release-manifest.json'),'utf8')),manifest);
  fs.appendFileSync(path.join(root,'package.json'),'\n');assert.equal(writeManifest(root).sourceDirty,true);
});

test('local manifest refuses changed package bytes and mismatched package verification',t=>{
  const {root}=fixture(t),reportFile=path.join(root,'audit','package-source.json');
  const report=JSON.parse(fs.readFileSync(reportFile,'utf8'));
  fs.writeFileSync(reportFile,JSON.stringify({...report,version:'3.5.1'}));
  assert.throws(()=>writeManifest(root),/matching successful package verification/);
  fs.writeFileSync(reportFile,JSON.stringify(report));
  fs.appendFileSync(path.join(root,'dist','win-unpacked','resources','app.asar'),'changed');
  assert.throws(()=>writeManifest(root),/archive changed after verification/);
  assert.equal(fs.existsSync(path.join(root,'dist','release-manifest.json')),false);
});
