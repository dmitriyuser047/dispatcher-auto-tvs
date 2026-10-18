'use strict';
// Local metadata for the verified installer. Publishing and update-channel writes
// are separate release steps; running npm build never changes version.json.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');

function validateMetadata(pkg){
  if(!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(pkg.version)||pkg.prototype)throw Error('Only stable production versions may be built');
  if(!pkg.name||!pkg.build?.appId||!pkg.build?.productName||/prototype|прототип/i.test([pkg.name,pkg.build.appId,pkg.build.productName].join(' ')))throw Error('Production application identity is required');
  const installer=String(pkg.build.artifactName||'').replaceAll('${version}',pkg.version).replaceAll('${ext}','exe').replaceAll('${arch}','x64');
  if(!installer.endsWith('.exe')||/[\\/\x00-\x1f<>:"|?*$]/.test(installer)||/prototype|прототип/i.test(installer)||installer==='..')throw Error('Unsafe or unresolved installer artifact name');
  return installer;
}

function writeAtomic(file,text){fs.writeFileSync(file+'.next',text);fs.renameSync(file+'.next',file);}

function writeManifest(root){
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  const installer=validateMetadata(pkg),directory=path.join(root,'dist');
  const verification=JSON.parse(fs.readFileSync(path.join(root,'audit','package-source.json'),'utf8'));
  if(verification.status!=='PASS'||verification.version!==pkg.version||verification.name!==pkg.name||verification.appId!==pkg.build.appId||verification.integrity?.mismatches?.length!==0)throw Error('A matching successful package verification is required');
  const archive=fs.readFileSync(path.join(directory,'win-unpacked','resources','app.asar'));
  if(crypto.createHash('sha256').update(archive).digest('hex')!==verification.archiveSha256)throw Error('Packaged archive changed after verification');
  const bytes=fs.readFileSync(path.join(directory,installer));
  const sha256=crypto.createHash('sha256').update(bytes).digest('hex');
  const sha512=crypto.createHash('sha512').update(bytes).digest('base64');
  const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true}).trim();
  const sourceCommit=git(['rev-parse','HEAD']);
  if(!/^[a-f0-9]{40}$/i.test(sourceCommit))throw Error('Cannot identify the installer source commit');
  const manifest={version:pkg.version,sourceVersion:pkg.version,sourceCommit,sourceDirty:!!git(['status','--porcelain','--untracked-files=no']),name:pkg.name,appId:pkg.build.appId,installer,bytes:bytes.length,sha256,sha512,archiveSha256:verification.archiveSha256,packageIntegrity:{files:verification.integrity.files,unpackedFiles:verification.integrity.unpackedFiles,mismatches:0},published:false};
  writeAtomic(path.join(directory,'release-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  writeAtomic(path.join(directory,'SHA256SUMS.txt'),sha256+'  '+installer+'\n');
  return manifest;
}

module.exports={validateMetadata,writeManifest};
if(require.main===module){try{process.stdout.write(JSON.stringify(writeManifest(path.resolve(__dirname,'..')),null,2)+'\n');}catch(error){console.error(error);process.exitCode=1;}}
