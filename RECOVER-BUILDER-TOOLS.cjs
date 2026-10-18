'use strict';
// Restore the same official Windows resource editor used by this build.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
(async()=>{
  if(process.platform!=='win32')throw Error('This helper prepares a Windows build');
  const directory=path.join(__dirname,'.builder-cache/winCodeSign');
  const executable=path.join(directory,'rcedit-x64.exe');
  const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
  const editorHash='ab53500d556fd824636621bca7dbecd8583ba181891c3e9efdcf16b72a28b0cd';
  if(fs.existsSync(executable)&&hash(fs.readFileSync(executable))===editorHash){console.log('Windows resource editor is ready');return;}
  const url='https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z';
  const response=await fetch(url,{signal:AbortSignal.timeout(180000)});
  if(!response.ok)throw Error('Resource editor download HTTP '+response.status);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length!==5635384||hash(bytes)!=='cdaec7154dda7cc31f88d886e2489379a0625a737d610b5ae7f62a12f16743a4')throw Error('Resource editor archive checksum mismatch');
  fs.mkdirSync(directory,{recursive:true});const archive=path.join(directory,'winCodeSign-2.6.0.7z');fs.writeFileSync(archive,bytes);
  const result=cp.spawnSync(require('7zip-bin').path7za,['e',archive,'-o'+directory,'rcedit-x64.exe','-y'],{encoding:'utf8',windowsHide:true});
  if(result.status!==0)throw Error(result.stdout+result.stderr);
  if(hash(fs.readFileSync(executable))!==editorHash)throw Error('Resource editor checksum mismatch');
  console.log('Windows resource editor is ready');
})().catch(e=>{console.error(e);process.exitCode=1;});
