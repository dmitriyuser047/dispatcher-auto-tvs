'use strict';
// All Git metadata and artifacts below belong to a private synthetic workspace.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync,spawnSync}=require('node:child_process');
const {writeManifest,assertCleanSource}=require('../scripts/write-release-manifest.cjs');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
test('release provenance cannot call untracked shipping code a clean commit while ignored local files remain irrelevant',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-release-source-provenance-'));
 t.after(()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.match(path.basename(root),/^tvs-release-source-provenance-/);assert.equal(fs.realpathSync(root),root);fs.rmSync(root,{recursive:true,force:true});});
 const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
 const pkg={name:'synthetic-release',version:'3.5.6',build:{appId:'com.synthetic.release',productName:'Synthetic release',artifactName:'Dispatcher-Setup-${version}.${ext}'}},archive=Buffer.from('Synthetic ASAR verification'),installer=Buffer.from('Synthetic installer, never executed');
 fs.mkdirSync(path.join(root,'dist/win-unpacked/resources'),{recursive:true});fs.mkdirSync(path.join(root,'audit'));
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify(pkg));fs.writeFileSync(path.join(root,'.gitignore'),'dist/\naudit/\nscratch/\n.builder-stage-*/\n.builder-stage-config.json\n');
 fs.writeFileSync(path.join(root,'dist/win-unpacked/resources/app.asar'),archive);fs.writeFileSync(path.join(root,'dist/Dispatcher-Setup-3.5.6.exe'),installer);
 fs.writeFileSync(path.join(root,'audit/package-source.json'),JSON.stringify({version:pkg.version,name:pkg.name,appId:pkg.build.appId,status:'PASS',archiveSha256:hash(archive),integrity:{files:1,unpackedFiles:0,mismatches:[]}}));
 fs.mkdirSync(path.join(root,'scripts'));for(const name of ['build-installer.cjs','write-release-manifest.cjs'])fs.copyFileSync(path.join(__dirname,'../scripts',name),path.join(root,'scripts',name));
 fs.writeFileSync(path.join(root,'scripts/vendor-tesseract-worker.cjs'),'require("node:fs").writeFileSync(require("node:path").resolve(__dirname,"../unexpected-build-side-effect"),"ran");\n');
 git(['init','--quiet']);git(['add','package.json','.gitignore','scripts']);
 const commit=message=>git(['-c','user.name=Synthetic release test','-c','user.email=test@example.invalid','-c','core.hooksPath=/dev/null','commit','--quiet','-m',message]);
 commit('Synthetic clean release');const original=writeManifest(root);assert.equal(original.sourceDirty,false);assert.equal(original.sha256,hash(installer));assert.equal(assertCleanSource(root),true);
 fs.mkdirSync(path.join(root,'scratch'));fs.writeFileSync(path.join(root,'scratch/local-note.txt'),'Ignored synthetic local state');fs.mkdirSync(path.join(root,'.builder-stage-synthetic'));fs.writeFileSync(path.join(root,'.builder-stage-synthetic/package.json'),'{}');fs.writeFileSync(path.join(root,'.builder-stage-config.json'),'{}');assert.equal(writeManifest(root).sourceDirty,false);assert.equal(assertCleanSource(root),true);
 fs.mkdirSync(path.join(root,'assets/core'),{recursive:true});fs.writeFileSync(path.join(root,'assets/core/new-runtime.js'),'globalThis.syntheticNewRuntime=true;\n');
 const untracked=writeManifest(root);assert.equal(untracked.sourceCommit,original.sourceCommit);assert.equal(untracked.sourceDirty,true,'assets/** is packaged even when new runtime files have not been added to the release commit');
 const beforeBuild=fs.readFileSync(path.join(root,'dist/release-manifest.json')),build=spawnSync(process.execPath,[path.join(root,'scripts/build-installer.cjs')],{cwd:root,encoding:'utf8',windowsHide:true,timeout:10000});assert.notEqual(build.status,0);assert.match(build.stderr,/DIRTY_RELEASE_SOURCE|clean source commit/);assert.equal(fs.existsSync(path.join(root,'unexpected-build-side-effect')),false,'the production entry point must refuse dirty source before executing vendor or builder tools');assert.deepEqual(fs.readFileSync(path.join(root,'dist/release-manifest.json')),beforeBuild);assert.deepEqual(fs.readFileSync(path.join(root,'dist/Dispatcher-Setup-3.5.6.exe')),installer);
 assert.throws(()=>assertCleanSource(root),{code:'DIRTY_RELEASE_SOURCE'});git(['add','assets/core/new-runtime.js']);assert.throws(()=>assertCleanSource(root),{code:'DIRTY_RELEASE_SOURCE'});commit('Include synthetic runtime in release');const committed=writeManifest(root);assert.equal(committed.sourceDirty,false);assert.notEqual(committed.sourceCommit,original.sourceCommit);assert.equal(committed.sha256,hash(installer));assert.equal(assertCleanSource(root),true);
 fs.appendFileSync(path.join(root,'assets/core/new-runtime.js'),'globalThis.syntheticNewRuntime=false;\n');assert.equal(writeManifest(root).sourceDirty,true);assert.throws(()=>assertCleanSource(root),{code:'DIRTY_RELEASE_SOURCE'});
});
